# Session Handoff — AloParticleEditor / LT-4 UI overhaul (mid-flight)

**Last updated:** 2026-05-16 (later in the day; same calendar date as the prior handoff but a long session apart)
**Last conversation context:** Single long session that opened LT-4. Wrote the implementation plan, shipped Phases 0/1/2, then three Phase 3 screens (Screen 1 App shell, Screen 2 Main menu, Screen 3 Toolbar). Paused for handoff with five screens remaining and the architecture fully validated.

---

## Read first

If you are a fresh Claude session resuming this project:

1. **This file** — top to bottom.
2. **[CLAUDE.md](../CLAUDE.md)** — project conventions, plan structure, handoff discipline.
3. **[tasks/lt4_ui_overhaul.md](lt4_ui_overhaul.md)** — the implementation plan for LT-4. Use it as the spec; mid-flight scope refinements live here.
4. **[tasks/lt4_ui_overhaul_audit.md](lt4_ui_overhaul_audit.md)** — `WM_COMMAND` / Engine-API / dialog inventory. The schema mirrors §6.
5. **[tasks/lt4_design_parking_lot.md](lt4_design_parking_lot.md)** — per-screen design state. Screens 1/2/3 are ✅; Screens 4-8 are 🟡 pending.
6. **[tasks/lessons.md](lessons.md)** — L-001 through L-004. **Read L-002, L-003, L-004 carefully before any test/build work.**
7. Recent `git log --oneline -30` — 27 LT-4 commits since `a9da573` (master).

---

## Resumable state (snapshot)

| Thing | Value |
|---|---|
| **Worktree** | `C:\Modding\Particle Editor\.claude\worktrees\elegant-chatelet-56cde4` |
| **Branch** | `claude/elegant-chatelet-56cde4` |
| **HEAD** | `fe315a7` — `chore(LT-4): sync pnpm-lock.yaml after Radix menubar install` |
| **Working tree** | clean |
| **Behind master** | 0 (master at `a9da573` — last shipped: PR #81 docs handoff) |
| **Open PRs** | none |
| **Build status** | Debug+Release x64 clean. Vitest 28/28. Playwright 21/21. |
| **Phase 3 progress** | 3 of 8 screens done (App shell, Main menu, Toolbar) |

Two worktrees per `git worktree list`: main `C:/Modding/Particle Editor` (on `master`) and this one. Master is untouched.

---

## What landed in this session — 27 commits

### Phase 0 — audit + scaffolding (7 commits)

`fcac2cf` audit doc · `3fc1b5b` 3 audit fixes · `c24d698` engine API + bridge candidates · `4defb00` audit prose · `3dfb1aa` parking lot seed · `fb82c44` web/ monorepo + design tokens · `3918549` L-002 gitignore lesson

### Phase 1 — hybrid host scaffolding (8 commits)

`aa50b7c` viewport-poc Vite app · `cf39762` viewport-poc C++ host · `4b23425` PoC visual-gate fixes · `6c43499` web/apps/editor + bridge-schema · `d488cc5` real C++ host behind `--new-ui` · `2c931a1` `--dev-ui` flag · `afbf309` WebView2 runtime detection · `7b56061` accelerator pre-translate

### Phase 2 — bridge surface + Background picker (5 commits)

`2e27558` 22-command bridge fleshout + 25 Vitest contract tests · `f26cd5a` COLORREF byte-order note · `e9e5068` Playwright infrastructure (--test-host, CDP) · `6c55abd` `AddHostObjectToScript` unblock (postMessage drops under CDP — see L-003) · `17a8aa6` Background picker React · `c58442c` Background picker native wire-up + `undo/perform` + `file/open`

### Phase 3 — 3 screens (7 commits)

`8d83dc3` Screen 1 App shell (stats/tick @ 4 Hz + StatusBar) · `56fb11c` harness glob + mock fix · `f07d410` Screen 3 Toolbar (10 buttons, lucide-react, pause/step schema) · `ee4df22` Screen 2 Main menu (Radix Menubar) · `d5ea388` Screen 2 test follow-ups · `fe315a7` pnpm-lock sync

---

## Architecture in five facts (the parts that matter)

1. **The binary has two modes.** `ParticleEditor.exe` (no flag) runs the **legacy** UI exactly as before — zero regression. `ParticleEditor.exe --new-ui` runs the **hybrid** mode: WebView2 + D3D9 sibling HWND composition, React app inside WebView2 talking to the C++ Engine through a JSON bridge.

2. **The bridge has three implementations sharing one schema.**
   - `web/packages/bridge-schema/src/index.ts` — single source of truth (`Request` / `Event` / `Bridge` types).
   - **MockBridge** (browser mode, `pnpm dev` against `localhost:5174`) — full in-memory Zustand store; covers every `engine/*` Request. Drives Vitest contract tests.
   - **NativeBridge** (production WebView2) — `chrome.webview.postMessage` for Requests, push-events via `addEventListener("message")`.
   - **TestHostBridge** (Playwright via `--test-host`) — `chrome.webview.hostObjects.hostBridge.dispatchRequest` because postMessage silently drops under CDP attachment. See **L-003** in lessons.md.

3. **C++ host structure.** `src/host/` has: `HostWindow` (window + Engine + UndoStack), `BridgeDispatcher` (`Dispatch` async via WebView2, `DispatchSync` for the host-object channel; both route through one `DispatchInternal` kind-string ladder), `LayoutBroker` (positions D3D9 sibling), `AcceleratorBridge` (registered combo dictionary + pre-translate from `ICoreWebView2Controller::AcceleratorKeyPressed`), `HostBridgeProxy` (COM IDispatch exposing `dispatchRequest`).

4. **22 engine bridge commands + 3 host commands are implemented and tested.** Every `engine/set/*`, `engine/action/*`, `engine/query/*` that the audit catalogued is wired both directions (Vitest against Mock, Playwright against the live host). Plus `undo/perform`, `register-accelerators`, `layout/viewport-rect`, `file/open` (native file picker), `engine/set/paused`, `engine/action/step-frames` (added per Screen 3 needs).

5. **Three React screens are live in the hybrid.** Top bar (title + 5-menu Menubar + Background pill) → Toolbar (10 buttons) → Sidebar (Emitters placeholder) + Viewport-slot + Background picker panel (when open) → StatusBar (live stats/tick at 4 Hz).

---

## The Phase 3 cadence (use this for every remaining screen)

Per screen, exactly this sequence:

1. **Make design decisions** — the parking lot's "Design notes / sketches" section lists the open questions per screen. Either ask the user OR make the call yourself and document it in the "Decisions locked" block. The user has been delegating design heavily; defaulting to "follow legacy unless told otherwise" is the safe move.
2. **Dispatch one comprehensive subagent task** with locked design + every file path + every bridge call. Include the **Critical workflow note** about `pnpm build` (L-004). Use `opus` for cross-cutting tasks (schema + C++ + React + tests), `sonnet` for React-only tasks.
3. **Implementer runs**: `pnpm build` → `pnpm test` → `pnpm test:native` → `MSBuild` (if C++ changed). Reports back.
4. **Controller verifies**: re-run `pnpm test:native` from the harness (the subagent might not have done this). If green, commit. If red, surgical fix + commit.
5. **Mark parking-lot row ✅** and update todo list.

**Verification gate ordering matters.** `pnpm test` (Vitest) doesn't type-check. `tsc --noEmit` is NOT the same as `tsc -b` (build mode). Production `dist/` must be rebuilt before `test:native` because WebView2 navigates to it (unless `--dev-ui`). See L-004.

---

## What's left

### Phase 3 — 5 screens remaining

| Screen | Effort | Risk | Open design questions |
|---|---|---|---|
| **4 — Emitter tree** | **~1 week** | **High** | Replaces 4955-LOC `EmitterList.cpp`. Drag-reorder, multi-select, link-group badges, inline rename. **The load-bearing screen.** |
| 5 — Curve editor | Large | Medium | Replaces `CurveEditor.cpp` (1044 LOC). SVG vs canvas (profile first). |
| 6 — Track editor | Medium-large | Medium | Replaces `TrackEditor.cpp` (483 LOC). Shares primitives with #5. |
| 7 — Form primitives | Medium | Low | Spinner / ColorButton / TexturePalette / RandomParam. **Unlocks Screens 4-6.** |
| 8 — Remaining dialogs | Medium (×10 sub-dialogs) | Low | Lighting, Ground, Import Emitters, Rescale, Increment Index, Mod Nickname, Spawner, Link Group Settings, About. Plus the file-ops backbone (New / Open / Save / Save As / file-history bridge). |

### Phase 4 — cutover (4 tasks)

- 4.1 Hybrid-vs-legacy parity acceptance run
- 4.2 Delete legacy chrome (`src/UI/`, legacy `main.cpp` paths)
- 4.3 ROADMAP + CHANGELOG ship entry (LT-4 → §5 Shipped, renumber)
- 4.4 Release zip update (bundle `MicrosoftEdgeWebview2Setup.exe` + `web/apps/editor/dist/`)

### Recommended order

Pragmatic order, smallest-first within a strategic frame:

1. **Screen 7 (Form primitives) first** — unblocks 4/5/6. Spinner / ColorButton / TexturePalette / RandomParam are reusable building blocks. Skipping them forces ad-hoc inputs in the larger screens.
2. **Screen 8 — pick the dialogs that aren't blocked by Screen 7** — Lighting (uses Spinner + ColorButton), Rescale (uses Spinner), About (trivial). The "Mod" infrastructure depends on the file-history bridge, which is also Screen 8 territory.
3. **Screen 6 (Track editor)** — smaller of the curve/track pair. Use as a profiling vehicle to decide SVG vs canvas for both.
4. **Screen 5 (Curve editor)** — applies the SVG-vs-canvas decision from Screen 6.
5. **Screen 4 (Emitter tree)** — last because it's biggest and benefits from having every other surface settled.
6. **Phase 4** — once every screen is ✅ wired up.

This is debatable. The plan's original ordering had 4 first; I'm suggesting 7 → 8 → 6 → 5 → 4 because **finishing the small foundations protects the big screens from churn**. If you'd rather take the risk now and ship 4 first, that's also defensible — the rest then has clear primitives requirements.

---

## Hard-won lessons (preserve!)

### From this session — L-002, L-003, L-004

Already in `tasks/lessons.md`. **Read them before doing any test or schema work.**

- **L-002** — Repo-root `.gitignore` has `**/packages/*` (NuGet boilerplate) that eats `web/packages/*` source. Use scoped negation in `web/.gitignore`.
- **L-003** — WebView2 silently drops `chrome.webview.postMessage` after CDP attachment. Playwright contract tests must route through `ICoreWebView2::AddHostObjectToScript` (TestHostBridge channel) instead.
- **L-004** — `pnpm test` (Vitest) doesn't type-check. `tsc --noEmit` (single-project mode) is not the same as `tsc -b` (build mode with project references). The truth is `pnpm build`. Verification sequence is `pnpm build` → `pnpm test` → `pnpm test:native`.

### Pattern-level things worth knowing

#### Radix menubar's DOM structure

Each `Menubar.Trigger` renders as a direct `<button>` child of the menubar root — there is **no wrapping `<div>`**. If a Playwright spec selects `:scope > div > button` it returns `[]`. Use `:scope > button`. Mind this when porting other Radix primitives (`Menubar.Item` is `[role="menuitem"]`, content is `[role="menu"]`, dialog is `[role="dialog"]`).

#### pnpm v11 build-script approval

pnpm 11 introduced an interactive approval flow for build scripts (esbuild's post-install in particular). It WANTS to write a malformed `allowBuilds:` block into `pnpm-workspace.yaml` ("set this to true or false" — literal placeholder, breaks subsequent installs). **Keep only `onlyBuiltDependencies: [esbuild]`** in the workspace yaml. If pnpm re-injects the block during a future install, strip it before committing.

#### Production dist must be rebuilt after React edits

`ParticleEditor.exe --new-ui` (without `--dev-ui`) navigates to `https://app.local/index.html` which maps to `web/apps/editor/dist/`. Edits to React source don't reach the binary until you re-run `pnpm --filter @particle-editor/editor build`. Two Phase 3 cycles wasted ~10 minutes diagnosing this. **Always rebuild dist before `test:native`.**

#### Test launch order matters

Playwright runs specs alphabetically. Current order: `app-shell` → `background-picker` → `bridge-native` → `menu-bar` → `toolbar`. Tests share a browser context. Be careful with state restoration in earlier specs — `View > Bloom` flips state but restores it; if you forget the restore, later specs break opaquely.

#### Background picker's selector for the BackgroundButton

In Phase 2 the test used `header > button:first` because BackgroundButton was the only button in the header. Screen 2 added the MenuBar so now the first button is "File". The right selector is `button[aria-label="Background"]`. Note: any future screen adding a `<button>` to the header without unique `aria-label` will trip the same trap.

---

## Conversation context the new session needs

### What the user prefers (delegation pattern)

- **Design decisions** — the user has been delegating heavily this session. The Background picker, App shell, Toolbar, and Main menu all had their design calls made by me (Claude), with "I'm making these calls — push back if wrong" framing. The user pushed back exactly zero times. **Trust the pattern: make conservative legacy-mimicking calls, document them in the parking lot, and let the user redirect if needed.**
- **Pacing** — the user picked "smallest screen first" three times in a row (1 → 3 → 2). For Phase 3.7+, expect the same preference unless they say otherwise.
- **Visual verification** — the user has been hands-off on the visual side. They tried computer-use for the PoC gate once; it kept getting blocked by Windows `TextInputHost`. After that, headless verification via logs + Playwright was the path. The Preview MCP (`mcp__Claude_Preview__*`) is loaded and works for browser-mode UI verification — use it for design checkpoints if you build a new screen.
- **Verification rigor** — the user trusts the test counts. 49 tests is the current bar. Don't ship Phase 3 work that drops the count.

### What the user did NOT delegate

- **Architecture decisions** — the WebView2-vs-CEF, Radix-vs-shadcn, lucide-vs-Phosphor calls all got user buy-in indirectly through the plan acceptance. New cross-cutting calls (e.g., switching from `nlohmann::json` to something else) need explicit OK.
- **Phase boundaries** — Phase acceptance gates are explicit user-signoff moments per the plan. Phase 2 wrap and Phase 3.1 / 3.2 / 3.3 wraps were all "PASS, proceed" moments the user voiced. **Don't auto-advance phases.**

### Technical surface the user cares about

- **The `--legacy-ui` path stays clean** through every Phase 3 screen. Zero regression. Verified each cycle.
- **Test counts go up** every screen. Currently 49. Phase 3.7 should land ~55+ assuming similar coverage.
- **No silent failures.** Items that aren't yet implemented (File ops, etc.) log a `[Menu] X — Phase 3 Screen 8` TODO, not silent no-ops.

---

## Authoritative pointers

- **Commit log:** `git log --oneline -30`
- **Plan:** [tasks/lt4_ui_overhaul.md](lt4_ui_overhaul.md)
- **Audit:** [tasks/lt4_ui_overhaul_audit.md](lt4_ui_overhaul_audit.md)
- **Parking lot:** [tasks/lt4_design_parking_lot.md](lt4_design_parking_lot.md)
- **Lessons:** [tasks/lessons.md](lessons.md)
- **Build (full):** `"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" "ParticleEditor.sln" -p:Configuration=Debug -p:Platform=x64 -nologo -clp:Summary 2>&1 | tail -15`
- **TS build + lint:** `pnpm --filter @particle-editor/editor build` (REQUIRED — see L-004)
- **Vitest:** `pnpm --filter @particle-editor/editor test`
- **Playwright (live host):** `pnpm --filter @particle-editor/editor test:native`
- **Dev server:** `pnpm --filter @particle-editor/editor dev` (browser mode, port 5174)
- **Native dev mode:** `ParticleEditor.exe --new-ui --dev-ui` (HMR from running dev server)
- **Native prod mode:** `ParticleEditor.exe --new-ui` (loads `web/apps/editor/dist/`)
- **Native test mode:** `ParticleEditor.exe --new-ui --test-host` (CDP on :9222, exposes `chrome.webview.hostObjects.hostBridge`)

---

## File-level breadcrumbs (Phase 3 surface)

| Need | Where to look |
|---|---|
| Top-level React shell | [`web/apps/editor/src/App.tsx`](../web/apps/editor/src/App.tsx) |
| MenuBar (Phase 3 Screen 2) | [`web/apps/editor/src/components/MenuBar.tsx`](../web/apps/editor/src/components/MenuBar.tsx) |
| Toolbar (Phase 3 Screen 3) | [`web/apps/editor/src/components/Toolbar.tsx`](../web/apps/editor/src/components/Toolbar.tsx) |
| StatusBar (Phase 3 Screen 1) | [`web/apps/editor/src/components/StatusBar.tsx`](../web/apps/editor/src/components/StatusBar.tsx) |
| Background picker (Phase 2) | [`web/apps/editor/src/screens/BackgroundPicker.tsx`](../web/apps/editor/src/screens/BackgroundPicker.tsx) + [`BackgroundButton.tsx`](../web/apps/editor/src/screens/BackgroundButton.tsx) |
| Bridge schema | [`web/packages/bridge-schema/src/index.ts`](../web/packages/bridge-schema/src/index.ts) |
| MockBridge | [`web/apps/editor/src/bridge/mock.ts`](../web/apps/editor/src/bridge/mock.ts) + [`mock-state.ts`](../web/apps/editor/src/bridge/mock-state.ts) |
| NativeBridge | [`web/apps/editor/src/bridge/native.ts`](../web/apps/editor/src/bridge/native.ts) |
| TestHostBridge | [`web/apps/editor/src/bridge/test-host.ts`](../web/apps/editor/src/bridge/test-host.ts) |
| Bridge factory | [`web/apps/editor/src/bridge/index.ts`](../web/apps/editor/src/bridge/index.ts) + [`expose.ts`](../web/apps/editor/src/bridge/expose.ts) |
| COLORREF helpers | [`web/apps/editor/src/lib/colorref.ts`](../web/apps/editor/src/lib/colorref.ts) |
| C++ host window + Engine ownership | [`src/host/HostWindow.cpp`](../src/host/HostWindow.cpp) |
| C++ bridge dispatcher | [`src/host/BridgeDispatcher.cpp`](../src/host/BridgeDispatcher.cpp) |
| C++ host-object proxy | [`src/host/HostBridgeProxy.cpp`](../src/host/HostBridgeProxy.cpp) |
| C++ accelerator pre-translate | [`src/host/AcceleratorBridge.cpp`](../src/host/AcceleratorBridge.cpp) |
| C++ layout broker (D3D9 sibling positioning) | [`src/host/LayoutBroker.cpp`](../src/host/LayoutBroker.cpp) |
| C++ `--new-ui` / `--dev-ui` / `--test-host` flag parsing | [`src/main.cpp`](../src/main.cpp) (in `WinMain`) |
| Playwright test orchestration | [`web/apps/editor/scripts/run-native-tests.mjs`](../web/apps/editor/scripts/run-native-tests.mjs) |
| Vitest config | [`web/apps/editor/vitest.config.ts`](../web/apps/editor/vitest.config.ts) |
| Playwright config | [`web/apps/editor/playwright.config.ts`](../web/apps/editor/playwright.config.ts) |
| WebView2 NuGet config | [`src/packages.config`](../src/packages.config) |

---

## Open questions / deferrals (do *not* silently address)

- **Alt-key menu navigation** (Screen 2 deferred to Phase 4 polish). Modern apps don't rely on it; if a user complains, revisit then.
- **Native title bar dirty indicator** (Screen 1 deferred). Needs real edit operations from Screen 4 (emitter tree). Title stays "AloParticleEditor" until then.
- **Undo of engine setters.** `undo/perform` handler exists but `UndoStack` only tracks `ParticleSystem` snapshots, not engine setters. Phase 3.4 (emitter tree) will start wrapping mutating handlers with `m_undo->Capture(...)`; for now `undo/perform` reports `applied: false` on engine-only state. Documented and tested.
- **Recent files menu.** Empty submenu shows "(none)" placeholder. Needs a file-history bridge (Phase 3.8 territory).
- **Cut/Copy/Paste/Delete in menu.** Disabled in the Edit menu until Phase 3.4 wires per-screen handling for the emitter tree.
- **File ops (New / Open / Save / Save As / Import / Exit).** Console-log TODOs. Phase 3.8.
- **Tools menu items (Lighting / Mods / Spawner).** Console-log TODOs. Phase 3.8.
- **Help > About.** Console-log TODO. Phase 3.8.

None of these are blockers for Phase 3.4-3.7. They're all bookkeeping that Phase 3.8 closes out.

---

## Pre-flight checklist for next session

Run these in order before touching code:

```bash
# 1. Confirm worktree is current.
git worktree list
git log --oneline -5    # HEAD should be fe315a7 if nothing's changed
git status               # clean

# 2. Confirm builds and tests are still green.
cd "C:/Modding/Particle Editor/.claude/worktrees/elegant-chatelet-56cde4"
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" "ParticleEditor.sln" -p:Configuration=Debug -p:Platform=x64 -nologo -clp:Summary 2>&1 | tail -10
cd web/apps/editor
pnpm install              # may re-inject the allowBuilds block — see L-004
pnpm build                # 0 errors expected
pnpm test                 # 28/28 expected
pnpm test:native          # 21/21 expected

# 3. If any test fails, do NOT proceed to new work. Diagnose first.
```

If anything regressed, the most likely culprits in order: pnpm-workspace.yaml malformed `allowBuilds:` block (re-strip it), WebView2 runtime unavailable (it's an Edge dependency), node_modules out of sync (re-run `pnpm install`).
