# Session Handoff — AloParticleEditor / LT-4 UI overhaul (post-FD10)

**Last updated:** 2026-05-19
**Last conversation context:** Single session focused on Phase 4.1 polish dispatches. Picked up mid-FD9 (the plan was committed but no code shipped), pivoted to FD9b (software alpha-stamp instead of full pipeline rework), then ran FD10 Group A (legacy parity polish) + FD10 Group D (close out disabled-stub menu items) + several organically-discovered bug fixes.

---

## Read first

If you are a fresh Claude session resuming this project:

1. **This file** — top to bottom.
2. **[CLAUDE.md](../CLAUDE.md)** — project conventions, plan structure, handoff discipline.
3. **[tasks/lessons.md](lessons.md)** — L-001 through L-006. **Read L-002, L-003, L-004, L-006 carefully before any test/build/optimistic-state work.**
4. **[tasks/lt4_phase_4_1_acceptance.md](lt4_phase_4_1_acceptance.md)** — parity acceptance checklist. Section 16 lists intentional divergences from legacy.
5. **[CHANGELOG.md](../CHANGELOG.md)** — top two entries are FD9b (layered viewport) and FD10 (Group A + Group D). Read them to understand the current architecture.
6. Recent `git log --oneline -30` — 25 commits in this session, all in the LT-4 Phase 4.1 polish line.

---

## Resumable state (snapshot)

| Thing | Value |
|---|---|
| **Worktree** | `C:\Modding\Particle Editor\.claude\worktrees\goofy-shtern-ded61e` |
| **Branch** | `claude/goofy-shtern-ded61e` |
| **HEAD** | `14f1fe0` — `fix(LT-4): set IDC_ARROW on the viewport popup's window class` |
| **Working tree** | clean |
| **Behind master** | unknown — check with `git log --oneline master..HEAD` |
| **Open PRs** | none |
| **Build status** | MSBuild Debug x64 clean (LIBCMTD warning is preexisting). Vitest 183/183. Playwright 77/77. |
| **Phase status** | Phase 4.1 — FD9b shipped, FD10 Group A shipped, FD10 Group D shipped + several follow-ups |

`git worktree list` shows multiple worktrees. The other one (`laughing-tereshkova-32e22a`) is an older parallel investigation — DO NOT confuse it for this one. The cursor-access tooling caches paths and may try to send input to the wrong exe; if visual-gate tests fail to open the right window, check the running PID.

---

## What landed in this session (25 commits)

### FD9b — Layered viewport with software alpha-stamp cut-outs (15 commits)

Replaced the FD7/FD8 `SetWindowRgn` HRGN-based cut-out plumbing with `WS_EX_LAYERED` + `UpdateLayeredWindow(ULW_ALPHA)`. The viewport popup is now a layered window; engine renders to an off-screen `D3DFMT_A8R8G8B8` RT; per-frame readback + alpha-stamping at chrome occlusion rects + UpdateLayeredWindow push.

T1–T8 land the architecture. T9 + four post-T9 follow-ups fix gnarly issues uncovered during the visual gate:
- `D3DPOOL_DEFAULT` lifetime vs `m_pDevice->Reset` (compositor RT must release before reset).
- MSAA depth restore onto MS_NONE compositor RT silently dropped the distort quad → solid-black viewport.
- Smoothstep feather initially carved the menu's own outline → fix landed alongside per-occlusion pad+feather via bridge schema extension.
- Clipped-edge feather logic re-computed from the ORIGINAL rect, not the clipped bounds, to fix asymmetric purple-halo on near-popup-edge menus.

Full architectural prose in `CHANGELOG.md` under the FD9b entry.

### FD10 Group A — EmitterTree panel toolbar + 3D cursor in status bar (1 commit)

Restored the legacy `EmitterList` panel toolbar: `[New ▾] [Delete] [▲][▼] [👁] [Show All] [Hide All]`. New bridge requests `emitters/set-visible` + `emitters/set-all-visible`. Status bar gains a 5th column for the 3D ground-plane intersection of the viewport mouse cursor, throttled to ~30 Hz host-side.

### FD10 Group D — Close out disabled-stub menu items (1 commit + follow-ups)

Four items became real:
- **File → Exit** — new `app/quit` bridge request → host `PostMessage(WM_CLOSE)`. Reuses the dirty-prompt path.
- **View → Reset Camera** — one-line dispatch with legacy default vectors via existing `engine/set/camera`.
- **View → Reset View Settings** — new `engine/action/reset-view-settings` cascades 9 engine setters in one host action; React shows a Modal confirm.
- **Lighting → Force Align Fill Lights** — restored checkbox with sun-az → fill-az cascade. Constants from `main.cpp:6238-6240`.

### FD10 organic finds (8 commits)

Surfaced during normal use of the FD10-shipped build:
- ContextMenu on EmitterTree rows needed the same occlusion registration the menubar uses (clipping at the viewport popup edge).
- FPS counter swung 0/1024 because `FPSMeasurer` used `GetTickCount` — fine for vsync'd legacy, useless on FD9b's uncapped UpdateLayeredWindow path. Switched to `QueryPerformanceCounter`.
- Insert-mode key insertion left Time/Value spinners stuck at 0 — fixed with sticky optimistic override (L-006), proper SVG-onClick guard in Insert mode, and explicit-clear-on-selection-change.
- Right-click on empty curve canvas now drops back to Select mode (legacy-style escape gesture).
- Right-click on a curve key opens a small floating menu with Delete (disabled for border keys).
- Viewport popup's window class was missing `hCursor = IDC_ARROW` — main HWND's resize-edge cursor was leaking into the viewport.
- L-006 captured in `tasks/lessons.md`: "Don't clear React optimistic state on every host-data refresh" (this pattern bit us three times across FD9b and FD10).
- Force Align toggle now persists to `localStorage` (key `alo:lighting:force-align`). Full registry parity with legacy `LightingForceFillAlignment` REG_DWORD is deferred.

---

## What's left

### Phase 4.1 acceptance items still deferred

D5 and D6 are the two remaining "make a stub work" items from Group D:

- **D5 — Skydome custom-slot file picker.** Background picker's Custom slots 9/10/11 are currently no-ops. Needs a new `engine/skydome/pick-custom-slot { slot }` bridge call that opens `GetOpenFileName` host-side, filtered to `*.dds;*.tga`. Pattern parallel to `file/open`'s native picker. Medium scope.

- **D6 — Mods menu detection + selection.** Mods menu shows `(none)` placeholder. Needs C++-side detection (EaW/FoC mod directories via `FileManager`'s resolution chain) + bridge surface (`mods/list`, `mods/activate`) + React menu population. Sizable enough to be its own dispatch.

### Larger Group B / C work (design conversation first)

These are documented divergences from legacy that the user flagged as "the new UI diverges too heavily" — Group A and Group D were the agreed first waves. Whether to keep, partially restore, or fully revert each is a judgment call. From `[tasks/lt4_phase_4_1_acceptance.md §16]`:

**Group B — layout-shape divergences**
- Tool panels: legacy = independent modeless windows; new-UI = single mutually-exclusive sliding panel.
- Inline rename (F2/dbl-click) vs legacy's modal input.

**Group C — replaced-with-different**
- Native `ChooseColor` dialog (legacy) → Radix Popover (new) — every `ColorButton` site.
- Drag/drop reparent slot picker (legacy popup) → auto-picks lifetime (new).
- Multi-lane bracket rendering → single-lane (new).

### Phase 4.2 cutover (4 tasks, gated on parity)

- 4.1 Hybrid-vs-legacy parity acceptance run — partial (Group A + D done, B/C unaddressed)
- 4.2 Delete legacy chrome (`src/UI/`, legacy `main.cpp` paths) — gated on §17 GO
- 4.3 ROADMAP + CHANGELOG ship entry (LT-4 → §5 Shipped, renumber per CLAUDE.md tier-tag rules)
- 4.4 Release zip update (bundle `MicrosoftEdgeWebview2Setup.exe` + `web/apps/editor/dist/`)

### Recommended next moves

1. **Triage Groups B/C with the user before touching either.** They're not bugs — they're design decisions Claude made and the user might or might not agree with. The Group A "tackle this first" pattern worked because the user explicitly listed Group A's items as parity gaps; Groups B/C need the same user-driven prioritization.
2. **D5 and D6 are independently small enough to ship anytime** without unblocking anything. Pick whichever feels more useful to the user — D5 is faster, D6 has broader workflow value.
3. **Organic find-and-fix runs continue to be high-yield.** Two of this session's most important fixes (FPS, cursor) came from "play with the editor and report what looks off" prompts, not from any tracked plan item.

---

## Hard-won lessons (preserve!)

All in `tasks/lessons.md`. **Read L-002, L-003, L-004, L-006 carefully before any test or schema or optimistic-state work.**

- **L-001** — Don't infer binary provenance from bitness + timestamp alone (Petroglyph 64-bit patch incident).
- **L-002** — Repo-root `.gitignore` `**/packages/*` eats `web/packages/*` source; use scoped negation.
- **L-003** — WebView2 silently drops `chrome.webview.postMessage` after CDP attachment. Playwright contract tests route through `chrome.webview.hostObjects.hostBridge` instead.
- **L-004** — `pnpm test` (Vitest) doesn't type-check. `tsc --noEmit` (single-project) ≠ `tsc -b` (build mode with project references). Truth is `pnpm build`. Verification sequence: `pnpm build` → `pnpm test` → `pnpm test:native`.
- **L-005** — pnpm v11 `allowBuilds:` block wants a boolean, not the literal placeholder string. Edit the workspace yaml directly; the interactive approve-builds TUI doesn't work via piped stdin.
- **L-006** — *NEW.* Don't clear React optimistic state on every host-data refresh. Use sticky overrides cleared only on explicit user-action selection-change.

### Pattern-level things worth knowing

#### The recurring optimistic-state pattern (see L-006)

This bit us THREE times in subtly different surfaces:
- FD9b LayoutBroker re-emitting occlusion rects when the popup moves (rather than letting the React rect arrive stale).
- FD10 TrackEditor Time/Value optimistic override.
- FD10 sticky-selection after Insert-mode key add (which exposed a fourth-cause: the SVG-container onClick firing on click events whose `e.target === e.currentTarget` resolved to the SVG itself when down-target and up-target differed).

If you see "the boxes/state flashes correct then reverts to a stale default after an async mutation," the override is being cleared too aggressively. L-006 has the durable pattern.

#### FPS measurement on uncapped frame rates

`GetTickCount()` is ~15.6 ms resolution. Fine for vsync'd legacy (~60 FPS) but useless on FD9b's `UpdateLayeredWindow` path (200-500 FPS uncapped). Use `QueryPerformanceCounter` for any sub-millisecond timing. The `FPSMeasurer` in `src/host/HostWindow.cpp` is now QPC; the legacy editor's `src/main.cpp:56-99` still uses GetTickCount — fine because legacy is vsync'd, but if anyone ever extends legacy's render path the same fix applies.

#### Win32 cursor inheritance

Top-level window classes need an explicit `hCursor` in their WNDCLASSEXW. Without one, the previous window's cursor (e.g., the main HWND's resize-edge cursor) leaks into the new window's client area. The viewport popup's class was missing this for a long time — the fix is one line: `vc.hCursor = LoadCursor(nullptr, IDC_ARROW)`.

#### Compositor RT lifetime around D3D9 device reset

Any `D3DPOOL_DEFAULT` resource (RT, vertex buffer, texture) must be released BEFORE `IDirect3DDevice9::Reset` or the call returns `D3DERR_INVALIDCALL`. The compositor's off-screen RT is POOL_DEFAULT (it has to be — POOL_MANAGED can't be RT). FD9b's `AlphaCompositor::ReleaseGpuResources` is wired into `Engine::Reset` just after the shader OnLostDevice block. Don't add new POOL_DEFAULT resources without thinking about their Reset story.

#### MS multisample matching for RT + depth pair

D3D9 requires the bound RT and depth-stencil surface to have matching multisample type/quality. The engine's auto-depth-stencil is multisampled (highest type the device supports, picked by `GetMultiSampleType`). The compositor's RT is `D3DMULTISAMPLE_NONE` (`GetRenderTargetData` can't read multisampled surfaces). In FD9b mode, `Engine::Render` skips restoring the auto-depth at the end — it keeps `m_pDepthStencilSurface` (also MS_NONE) bound, which is MS-compatible with the compositor RT. The legacy Present path still restores the auto-depth.

#### Production dist must be rebuilt after React edits

`ParticleEditor.exe --new-ui` (without `--dev-ui`) navigates to `https://app.local/index.html` which maps to `web/apps/editor/dist/`. Edits to React source don't reach the binary until you re-run `pnpm --filter @particle-editor/editor build`. Always rebuild dist before `test:native`.

#### Test launch order matters (Playwright)

Playwright runs specs alphabetically and shares a browser context across tests within a file. Be careful with state restoration in earlier specs — `View > Bloom` flips state but restores it; if you forget the restore, later specs break opaquely. This bit us in FD9b T9 — three specs (skydome-slot, ground-texture, spawner/active-count) appeared to fail in a related cluster, all because the compositor RT lifetime bug broke device reset, leaving the engine in a half-initialized state.

---

## Conversation context the new session needs

### What the user prefers (delegation pattern)

- **Design decisions** — the user delegates most design calls. The Background picker, App shell, Toolbar, Main menu, AlphaCompositor pad/feather defaults, and Modal vs AlertDialog all had their design made by Claude with "push back if wrong" framing. The user occasionally redirects (FD9 plan → FD9b pivot), so make conservative legacy-mimicking calls and document them.
- **Pacing** — short, iterative cycles. One dispatch → relaunch → user verifies visually → next dispatch. Multi-dispatch batches (like FD10 Group A) work but the user appreciates being able to inspect intermediate state.
- **Legacy parity is the rule.** The user explicitly flagged "the UI diverges too heavily" mid-session and we course-corrected to Group A. When in doubt about a design call, match legacy.
- **Visual verification** — the user runs the editor and reports what looks off. The `request_access` flow for screenshots is unreliable in this environment (cached bundleId from a previous worktree intercepts). Don't depend on screenshots; rely on the user's eyes.
- **Verification rigor** — vitest count + native count are the hard floor. 183/183 + 77/77 is the current bar. Don't ship work that drops the count.

### What the user did NOT delegate

- **Architecture pivots** — the FD9 → FD9b call was the user explicitly picking option 3 (software alpha-stamp) after Claude flagged that the original plan had a load-bearing logic gap. New cross-cutting calls need explicit OK.
- **Phase boundaries** — Phase 4.2 (delete legacy) is gated on the user signing off on parity acceptance. Don't auto-advance.

### Technical surface the user cares about

- **The `--legacy-ui` path stays clean.** Zero regression. Verified each cycle.
- **Test counts go up** every dispatch where coverage is meaningful. Vitest 180 → 183 (+3 from FD9b + Force Align spec). Native 76 → 77 (one new spec).
- **No silent failures.** Items not yet implemented log a TODO, not a silent no-op. Disabled stubs (Reset Camera was the canonical example before D2) are explicit `disabled` props with TODO comments — not invisible.

---

## Authoritative pointers

- **Commit log:** `git log --oneline -30`
- **Acceptance checklist:** [tasks/lt4_phase_4_1_acceptance.md](lt4_phase_4_1_acceptance.md) — §16 lists known divergences; §17 awaits a final pass.
- **Lessons:** [tasks/lessons.md](lessons.md) — L-001 through L-006.
- **Build (full):** `"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" "ParticleEditor.sln" //p:Configuration=Debug //p:Platform=x64 //v:m 2>&1 | tail -10`
- **TS build + lint:** `pnpm --filter @particle-editor/editor build` (REQUIRED — see L-004)
- **Vitest:** `pnpm --filter @particle-editor/editor test`
- **Playwright (live host):** `pnpm --filter @particle-editor/editor test:native`
- **Dev server:** `pnpm --filter @particle-editor/editor dev` (browser mode, port 5174)
- **Native dev mode:** `ParticleEditor.exe --new-ui --dev-ui` (HMR from running dev server)
- **Native prod mode:** `ParticleEditor.exe --new-ui` (loads `web/apps/editor/dist/`)
- **Native test mode:** `ParticleEditor.exe --new-ui --test-host` (CDP on :9222, exposes `chrome.webview.hostObjects.hostBridge`)

---

## File-level breadcrumbs (current surface)

| Need | Where to look |
|---|---|
| Top-level React shell | `web/apps/editor/src/App.tsx` |
| MenuBar | `web/apps/editor/src/components/MenuBar.tsx` |
| Toolbar | `web/apps/editor/src/components/Toolbar.tsx` |
| StatusBar (5-column) | `web/apps/editor/src/components/StatusBar.tsx` |
| EmitterTree + panel toolbar (FD10 Group A) | `web/apps/editor/src/screens/EmitterTree.tsx` |
| EmitterPropertyPanel + EmitterPropertyTabs | `web/apps/editor/src/screens/EmitterPropertyPanel.tsx`, `EmitterPropertyTabs.tsx` |
| TrackEditor (FD10 optimistic override, per-key context menu) | `web/apps/editor/src/screens/TrackEditor.tsx` |
| CurveEditor (FD10 Insert-mode + right-click) | `web/apps/editor/src/screens/CurveEditor.tsx` |
| LightingPanel (FD10 Force Align) | `web/apps/editor/src/screens/LightingPanel.tsx` |
| Background picker | `web/apps/editor/src/screens/BackgroundPicker.tsx` |
| Save-changes prompt | `web/apps/editor/src/screens/SaveChangesPrompt.tsx` |
| Modal primitive | `web/apps/editor/src/components/Modal.tsx` |
| Bridge schema | `web/packages/bridge-schema/src/index.ts` |
| MockBridge | `web/apps/editor/src/bridge/mock.ts` + `mock-state.ts` |
| NativeBridge | `web/apps/editor/src/bridge/native.ts` |
| TestHostBridge | `web/apps/editor/src/bridge/test-host.ts` |
| **AlphaCompositor (FD9b)** | `src/host/AlphaCompositor.{h,cpp}` |
| C++ host window + Engine ownership + viewport popup | `src/host/HostWindow.cpp` |
| C++ bridge dispatcher | `src/host/BridgeDispatcher.cpp` |
| C++ host-object proxy | `src/host/HostBridgeProxy.cpp` |
| C++ accelerator pre-translate | `src/host/AcceleratorBridge.cpp` |
| C++ layout broker (popup positioning + occlusion forwarding) | `src/host/LayoutBroker.cpp` |
| C++ `--new-ui` / `--dev-ui` / `--test-host` flag parsing | `src/main.cpp` (in `WinMain`) |
| Engine — alpha compositor injection + Render swap + Reset hook | `src/engine.cpp` lines ~625, ~870, ~1226 |
| Playwright test orchestration | `web/apps/editor/scripts/run-native-tests.mjs` |

---

## Pre-flight checklist for next session

Run these in order before touching code:

```bash
# 1. Confirm worktree is current.
cd "/c/Modding/Particle Editor/.claude/worktrees/goofy-shtern-ded61e"
git worktree list
git log --oneline -5    # HEAD should be 14f1fe0 if nothing's changed
git status              # clean

# 2. Confirm builds and tests are still green.
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" \
  "ParticleEditor.sln" //p:Configuration=Debug //p:Platform=x64 //v:m 2>&1 | tail -10
cd web/apps/editor
pnpm install     # may re-inject the allowBuilds block — see L-005
pnpm build       # 0 errors expected
pnpm test        # 183/183 expected
pnpm test:native # 77/77 expected
```

If anything regressed, the most likely culprits in order:
- pnpm-workspace.yaml `allowBuilds:` block malformed (L-005 — edit yaml, set per-package to `true`).
- A worktree confusion — `request_access` and similar tools may cache a path from `laughing-tereshkova-32e22a` (the other parallel worktree). Verify the running PID's exe path matches `goofy-shtern-ded61e`.
- WebView2 runtime unavailable (Edge dependency on the host machine).
- node_modules out of sync — re-run `pnpm install`.

---

## Open questions / deferrals (do *not* silently address)

- **D5 — Skydome custom-slot file picker.** Background picker's Custom slots 9/10/11 are no-ops. Needs `engine/skydome/pick-custom-slot` bridge + host `GetOpenFileName`.
- **D6 — Mods menu detection.** Placeholder `(none)`. Needs registry/disk scan + bridge surface.
- **Group B / C divergences** — see "What's left" above. Each is a design conversation before code.
- **Force Align registry persistence.** Currently `localStorage` only — doesn't sync with legacy `LightingForceFillAlignment` REG_DWORD. Cross-mode persistence needs a host registry helper + new bridge kind.
- **Per-key context menu future entries.** Only Delete is wired. Snap-to-grid / Reset value / etc. are natural follow-ups but no one's asked for them yet.
- **Phase 4.1 acceptance final pass.** The doc's §17 "Findings summary" is still empty. A full walkthrough comparing legacy vs new-UI side-by-side would close it out.
