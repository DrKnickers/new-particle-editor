# Session Handoff — AloParticleEditor / LT-4 (post-redesign spec + plan)

**Last updated:** 2026-05-19 (end-of-session — spec + plan committed, redesign implementation pending)
**Last conversation context:** Long session that shipped D5 (texture-aware `file/open` filter) and D6 (Mods menu detection + selection — both refactor + feature commits), then set up the `lt-4` integration branch (replaces ad-hoc `claude/*` accumulation; pushed to `origin/lt-4` as off-machine backup). Documented the branch workflow in `CLAUDE.md`. Cleaned up 7 redundant `claude/*` branches. Then the user provided a Claude Design bundle for a full Particle Editor 2026 UI redesign — brainstormed scope through 6 design sections, wrote a comprehensive spec ([`docs/superpowers/specs/2026-05-19-particle-editor-2026-redesign.md`](../docs/superpowers/specs/2026-05-19-particle-editor-2026-redesign.md)), wrote a 1700-line step-by-step implementation plan ([`docs/superpowers/plans/2026-05-19-particle-editor-2026-redesign.md`](../docs/superpowers/plans/2026-05-19-particle-editor-2026-redesign.md)). **No implementation code shipped yet** — the redesign is in spec-and-plan state, ready for a fresh session to execute Phase 1.

---

## Read first

If you are a fresh Claude session resuming this project:

1. **This file** — top to bottom.
2. **[CLAUDE.md](../CLAUDE.md)** — project conventions, plan structure, handoff discipline. **The new `## Branch workflow` section** (added this session) is load-bearing: `lt-4` is the integration branch; new sessions land on `claude/<random>` and FF into `lt-4` at session end.
3. **If picking up the Particle Editor 2026 redesign** (most likely next step):
   - **[docs/superpowers/specs/2026-05-19-particle-editor-2026-redesign.md](../docs/superpowers/specs/2026-05-19-particle-editor-2026-redesign.md)** — full design spec. 13 sections including token system, structural moves, bridge surface delta, definition of done.
   - **[docs/superpowers/plans/2026-05-19-particle-editor-2026-redesign.md](../docs/superpowers/plans/2026-05-19-particle-editor-2026-redesign.md)** — step-by-step implementation plan, 13 commits across 3 phases. Each task has concrete code + commands + verification gates. **Phase 1 is the recommended first session.**
4. **[tasks/lessons.md](lessons.md)** — L-001 through L-006. **Read L-002, L-003, L-004, L-006 carefully before any test/build/optimistic-state work.**
5. **[tasks/lt4_phase_4_1_acceptance.md](lt4_phase_4_1_acceptance.md)** — parity acceptance checklist. Section 16 lists intentional divergences from legacy.
6. **[CHANGELOG.md](../CHANGELOG.md)** — top entries (D6, D5, FD10 Group A/D, FD9b, Playwright host-object) are all `lt-4`-only with `[#TODO]` PR placeholders; see the "Note on the LT-4 / new-UI entries" at the top of the Changelog section for the partial-backfill convention.
7. Recent `git log --oneline -30` — the LT-4 dispatch history, ~340+ commits ahead of master, all on `lt-4`.

---

## Resumable state (snapshot)

| Thing | Value |
|---|---|
| **Worktree** | `C:\Modding\Particle Editor\.claude\worktrees\awesome-morse-5ea5c3` (this session's; next session likely gets a fresh `claude/<random>` path) |
| **Branch** | `lt-4` (integration; this session committed directly on it after the dry-run FF earlier) — also tracks `origin/lt-4` |
| **HEAD** | `52f381c` (`docs(LT-4): implementation plan — Particle Editor 2026 redesign`) |
| **Working tree** | clean post-commit |
| **Behind master** | `lt-4` is **343 commits ahead of `master`** (`b28f624`); none merged yet, all backed up to `origin/lt-4` |
| **Open PRs** | none |
| **Build status** | MSBuild Debug x64 clean (LIBCMTD warning is preexisting). Vitest **191/191**. Playwright **80/80**. |
| **Phase status** | Phase 4.1 — all "make a stub work" items closed (D1-D6). **Particle Editor 2026 redesign — spec + plan committed, implementation not yet started.** |

**Worktree note.** The Claude Code desktop app provisions a fresh worktree on every session start; this session inherited `awesome-morse-5ea5c3` from the harness, replacing the previous `goofy-shtern-ded61e` (now pruned). Branch name follows the worktree name. The commit lineage is preserved — only the path / branch label change. If you want to resume in a specific worktree directory rather than getting a fresh one each time, the CLI workflow `claude --continue` from inside the desired worktree path is the only way today (the desktop app has no equivalent setting). Documented in the conversation log for the D5 session.

**NuGet pre-flight (fresh worktrees only).** `.gitignore` excludes `packages/`, so the first MSBuild in a fresh worktree fails with *"missing Microsoft.Web.WebView2.targets"*. Restore explicitly before the first build:

```bash
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" \
  "ParticleEditor.sln" //t:Restore //v:m
```

Then the standard Debug x64 build works. Skip this step on a worktree that's already been built in once.

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

## What landed in this session

### Particle Editor 2026 redesign — spec + plan (no implementation yet)

User provided a Claude Design bundle (extracted to `C:\Users\antho\AppData\Local\Temp\nu-particle-editor\nuparticle-editor\project\` — `styles.css`, 8 JSX components, chat transcript with 30+ iteration decisions). Brainstormed scope through 6 design sections — settled on visual + structural overhaul in 3 phases (token system + theme → 7 structural sub-commits → cleanup + dialog re-skin). Wrote the spec ([commit `7e9a34e`](../docs/superpowers/specs/2026-05-19-particle-editor-2026-redesign.md)) and the implementation plan ([commit `52f381c`](../docs/superpowers/plans/2026-05-19-particle-editor-2026-redesign.md)).

Implementation deferred to next session(s) because this session was already long (28% of 1M context remaining). The plan is written to be picked up cleanly by a fresh session — each task has concrete code + verification gates + commit instructions. Phase 1 (token swap + theme toggle, no structural changes) is ~70-80K parent-side and a natural single-session unit.

**Key decisions captured in the spec** (so the next session doesn't need to re-litigate them):
- 3-phase rollout, each phase independently shippable; per-commit gates keep suite green.
- Tailwind stays in Phase 1 with token aliases (`bg-bg-2`, `text-text-2`, `accent`, etc.); components incrementally swap from `bg-neutral-900`-style.
- Inter as variable woff2, bundled locally at `web/apps/editor/public/fonts/inter/`, `font-display: block` + `<link rel="preload">` so no FOUT.
- Light theme via `[data-theme]` on `<html>`; `localStorage('alo:theme')` persistence; default = `prefers-color-scheme` at first launch.
- Lighting and Bloom Settings stay as sliding ToolPanels (only re-skinned), not new toolbar dropdowns — the design didn't explicitly address them.
- Curve editor: Index kept as 7th channel (default off) so feature parity is preserved.
- Tweaks panel: skipped per user decision.
- ModNicknameDialog: wired up via new `mods/set-nickname` bridge call + right-click on Mods menu entry.
- New bridge surface total: 2 request kinds + 1 DTO field (`engine/set/leave-particles`, `mods/set-nickname`, `EngineStateDto.leaveParticles`).
- Definition of done includes Claude visual verification via computer-use. Pre-grant for the dev binary was established in this session (path: `c:\modding\particle editor\.claude\worktrees\awesome-morse-5ea5c3\x64\debug\particleeditor.exe`). Grants likely don't persist across sessions — re-establishing involves launching the editor first then calling `request_access(["particleeditor.exe"])` so the resolver picks the running PID's actual path (not the cached v0.2.0 install in Downloads).

### lt-4 integration branch setup

User requested an integration branch separate from `master`. Created `lt-4` from the then-current HEAD, pushed to `origin/lt-4`. Cleaned up 7 redundant `claude/*` branches (all were subsets of `lt-4`'s history). Documented the branch workflow in [CLAUDE.md](../CLAUDE.md)'s new `## Branch workflow` section: long-lived `lt-4` for all LT-4 / new-UI work; per-session `claude/<random>` containers that fast-forward into `lt-4` at session end; `master` stays untouched until explicit user OK.

Also did a partial CHANGELOG backfill — the 6 LT-4 entries previously had `TODO TODO TODO` date/hash/PR triples; now they have real `lt-4` commit hashes + dates, with PR# staying TODO. A note at the top of the Changelog section explains the partial-backfill state (self-deletes when LT-4 eventually merges to master).

### D5 + D6 (shipped)

**D5 — Texture-aware `file/open` for skydome + ground custom slots.** Replaces the hardcoded `*.alo` filter on the Background and Ground Texture custom-slot pickers with `*.dds;*.tga`. Skydome slots 9/10/11 used to silently misfilter; ground texture slots 5/6/7 were genuine no-ops. Both surfaces now work. See CHANGELOG entry "Texture-aware `file/open` for skydome + ground custom slots (D5)".

**D6 — Mods menu detection + selection.** Two commits. Step 1 (`ea0ed40`) extracted `ModManager` from `src/main.cpp` into `src/ModManager.{h,cpp}` — single source of truth for mod discovery + active-mod state, shared between legacy and new-UI. Behaviour-preserving refactor with zero functional change. Step 2 added the `mods/list` / `mods/select` / `mods/refresh` bridge surface, the `activeModPath` DTO field, MockBridge stubs, and a full React MenuBar rewrite replacing the `(none)` placeholder. Cross-mode persistence via the existing `HKCU\Software\AloParticleEditor\LastMod` registry key — both UI modes read/write the same key and agree on the active mod across restarts. See CHANGELOG entry "Mods menu detection + selection (D6)" for the full design.

This closes out **all four "make a stub work" items** from FD10 Group D (D1 Exit, D2 Reset Camera, D3 Reset View Settings, D4 Force Align in earlier dispatch; D5 + D6 in this session).

## What's left

### Particle Editor 2026 redesign — IMPLEMENTATION (3 phases)

Spec + plan committed; no code written yet. See [`docs/superpowers/plans/2026-05-19-particle-editor-2026-redesign.md`](../docs/superpowers/plans/2026-05-19-particle-editor-2026-redesign.md). Phase 1 (Tasks 1.1–1.8): tokens + theme toggle, no structural changes. Phase 2 (Tasks 2.1–2.7): 7 small structural commits. Phase 3 (Tasks 3.1–3.6): cleanup + dialog re-skin + ModNicknameDialog wiring.

**Note on Groups B/C:** the redesign's structural changes (Background + Ground as toolbar dropdowns; permanent Spawner right column) resolve most of Group B. Group C (native ChooseColor → Radix Popover, drag/drop reparent picker, multi-lane brackets) is *unaffected* by the redesign and still on the deferred list.

### Phase 4.2 cutover (4 tasks, gated on parity)

- 4.1 Hybrid-vs-legacy parity acceptance run — partial (Group A + D done, B/C unaddressed)
- 4.2 Delete legacy chrome (`src/UI/`, legacy `main.cpp` paths) — gated on §17 GO
- 4.3 ROADMAP + CHANGELOG ship entry (LT-4 → §5 Shipped, renumber per CLAUDE.md tier-tag rules)
- 4.4 Release zip update (bundle `MicrosoftEdgeWebview2Setup.exe` + `web/apps/editor/dist/`)

Cutover is still gated on the user signing off on parity acceptance (§17 of `tasks/lt4_phase_4_1_acceptance.md` is empty). After the redesign ships, much of the "is parity good enough" conversation may be settled by the new-UI's polish reaching production quality.

### Recommended next moves

1. **Execute Phase 1 of the redesign** ([plan Tasks 1.1–1.8](../docs/superpowers/plans/2026-05-19-particle-editor-2026-redesign.md)). This is the obvious next session — the plan is written for it, the spec captures all the decisions, no design work needed. ~70-80K parent-side; comfortably one session. Sub-agent-driven execution recommended (each task is small enough for a single dispatch + review).
2. **After Phase 1: Phase 2 in a fresh session** (the seven structural sub-commits — Tasks 2.1–2.7). Phase 2 is the biggest cognitive lift; benefit most from a clean context.
3. **Then Phase 3** in another fresh session. Cleanup + dialog re-skin + ship docs.
4. **Triage Group C divergences** (native ChooseColor, drag/drop reparent, multi-lane brackets) only after the redesign ships, if they're still relevant. The redesign's pattern (Radix popovers everywhere) likely makes the ChooseColor question moot in practice.
5. **Phase 4.2 cutover** comes after the redesign ships.
6. **Organic find-and-fix runs continue to be high-yield.** Visual issues discovered during the redesign's per-phase computer-use verification fold cleanly into the next commit.

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
# 1. Confirm worktree is current. (The path may be different — the
#    desktop app provisions a fresh worktree each session.)
cd "/c/Modding/Particle Editor/.claude/worktrees/$WORKTREE_NAME"
git worktree list
git log --oneline -5    # HEAD should be the latest D5 / FD10 commit
git status              # clean

# 2. Restore NuGet (ONLY needed on a fresh worktree — see header note).
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" \
  "ParticleEditor.sln" //t:Restore //v:m

# 3. Confirm builds and tests are still green.
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" \
  "ParticleEditor.sln" //p:Configuration=Debug //p:Platform=x64 //v:m 2>&1 | tail -10
cd web/apps/editor
pnpm install     # may re-inject the allowBuilds block — see L-005
pnpm build       # 0 errors expected
pnpm test        # 188/188 expected
pnpm test:native # 77/77 expected
```

If anything regressed, the most likely culprits in order:
- pnpm-workspace.yaml `allowBuilds:` block malformed (L-005 — edit yaml, set per-package to `true`).
- A worktree confusion — `request_access` and similar tools may cache a path from `laughing-tereshkova-32e22a` (the other parallel worktree). Verify the running PID's exe path matches `goofy-shtern-ded61e`.
- WebView2 runtime unavailable (Edge dependency on the host machine).
- node_modules out of sync — re-run `pnpm install`.

---

## Open questions / deferrals (do *not* silently address)

(D5 + D6 both shipped this session. Force Align registry persistence remains noted in the FD10 entry; the per-key context-menu future entries are still natural follow-ups but no one's asked.)
- **Group B / C divergences** — see "What's left" above. Each is a design conversation before code.
- **Force Align registry persistence.** Currently `localStorage` only — doesn't sync with legacy `LightingForceFillAlignment` REG_DWORD. Cross-mode persistence needs a host registry helper + new bridge kind.
- **Per-key context menu future entries.** Only Delete is wired. Snap-to-grid / Reset value / etc. are natural follow-ups but no one's asked for them yet.
- **Phase 4.1 acceptance final pass.** The doc's §17 "Findings summary" is still empty. A full walkthrough comparing legacy vs new-UI side-by-side would close it out.
