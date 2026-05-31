# Session Handoff — AloParticleEditor / LT-4

## 2026-05-31 (session 3) — theme-coloured composition backing SHIPPED (kills the dark corner wedges) (resume: feature-parity gap audit, the recommended next LT-4 item)

**`origin/lt-4` → `77a3309`** (was `2431d6f` at session start). Branch is linear;
FF-pushed (`git push origin HEAD:lt-4`). Working tree clean. **Not on `master`.**

### What shipped (2 commits)

1. **`a545559` feat(ui) — theme-coloured composition backing.** The user was
   still seeing dark triangular wedges at rounded-panel corners that meet the
   engine (curve-editor **top** corners, left-pane **outer** corners, the
   spawner). Root cause: in arch-C the DComp engine visual is clipped to the
   scene rect, so any transparent DOM pixel *outside* it (gaps, splitter seams,
   rounded-corner wedges) falls through to the **black host window backing**.
   There is no shared opaque ancestor to fix in CSS — the viewport's whole
   ancestor chain must stay transparent for the engine to show — so the fix is
   host-side: insert a **rearmost solid-colour DComp visual** (a 1×1 composition
   swapchain on its OWN D3D11 device — engine device/LUID path untouched —
   scaled to the full client) behind the engine visual, recoloured to the theme
   `--bg`. New [`Compositor::SetBackingColor`](../src/host/Compositor.cpp:435) +
   `InsertBackingRearmost` (re-prepends after each engine attach) +
   `ApplyBackingTransform` (rescale in `SetSize`) + deferred-apply at the tail of
   `AttachWebView2`. New **`host/backing-color`** bridge request
   ([schema](../web/packages/bridge-schema/src/index.ts:721) → MockBridge no-op →
   [`BridgeDispatcher`](../src/host/BridgeDispatcher.cpp) parser →
   [`LayoutBroker::SetBackingColor`](../src/host/LayoutBroker.cpp) → compositor).
   Web hook [`useBackingColorSync`](../web/apps/editor/src/lib/backing-color-sync.ts)
   reads the resolved `--bg` and pushes on mount + every `data-theme` change.
   User chose this **root-cause** approach over the web-only per-panel CSS option;
   corners stay rounded (the wedge fills with `--bg`). **User-confirmed live:
   "looks great"** in both themes.
2. **`77a3309` docs(CHANGELOG)** — hash backfill for the entry.
3. **`aba25f6` fix(ui) — collapse the spawner's redundant nested panel.** The
   spawner column was wrapped in panel chrome twice (`<aside bg-panel border-l>`
   at [PanelLayout.tsx:368](../web/apps/editor/src/components/PanelLayout.tsx:368)
   wrapping a full `.panel` from
   [SpawnerPanel.tsx:167](../web/apps/editor/src/screens/SpawnerPanel.tsx:167)),
   giving it a redundant inset border ring. Stripped the panel styling from the
   aside (now a plain layout container); the single `.panel` is the card,
   matching the curve editor. **CSS-only ⇒ a11y goldens unaffected** (ARIA
   snapshots are CSS-independent; corrects the earlier "will change the golden"
   note). Verified the single-card look in browser/MockBridge mode via Playwright
   (engine-independent). The earlier spawned follow-up chip is now redundant.
4. **`e89c1cc` fix(ui) — sphere/cylinder distribution fields match legacy.**
   User found the Physics tab's Initial position / Initial speed didn't match
   legacy for Sphere/Cylinder types. The numeric "edge" spinner exposed
   `sphereEdge`/`cylinderEdge`, which the engine uses as a **boolean**
   ([EmitterInstance.cpp:205,215](../src/EmitterInstance.cpp:205): nonzero ⇒ full
   radius / surface, zero ⇒ random radius / volume) — legacy renders it as a
   **"Constrain to surface" checkbox**. So "add the checkbox" and "remove the edge
   param" were the same field. Replaced the spinner with `FieldCheckbox` (writes
   1/0), put cylinder Radius+Height on one row, shortened labels. All in
   `GroupBody` ([EmitterPropertyTabs.tsx:1506](../web/apps/editor/src/screens/EmitterPropertyTabs.tsx:1506)).
   **a11y-golden-neutral** (goldens use the default "Exact" group type; no
   sphere/cylinder branch is captured). Verified the layout in browser/MockBridge
   via Playwright. vitest 371 (sphere test updated + cylinder test added).
   Brainstormed the design with the user first — the edge=boolean insight reframed
   the request into a single relabel/re-widget change.

### Test / build state

- **vitest 370/370** (44 files) — +3 `backing-color-sync` tests.
- **Release + Debug** x64 both built clean (fresh worktree needed a NuGet restore
  per-config first — `MSBuild .sln /t:Restore /p:RestorePackagesConfig=true`; the
  Debug `LNK4098 LIBCMTD` warning is pre-existing/benign).
- **dist** rebuilt (composition); WebView2 cache cleared so the running editor
  loads it.
- **a11y goldens NOT regenerated** (correct). arch-C lane: 148 pass / 30 skip /
  9 fail, all env/known-flake (4× splitters L-014; 3× `dxgi-*` from this machine's
  ~4 FPS GPU env — `dxgi-perf` read 4.3 FPS vs 30 floor; 2× nondeterministic UIA
  goldens, L-024). Change adds zero DOM and the engine-path edit was a no-op for
  the single engine attach in the run → none attributable to it. See **L-033**.

### Verification method (see new L-033 — important for the next arch-C visual change)

This machine **misrenders arch-C compositing under agent-driven launches** (~4
FPS, engine fills the window, panels transparent) — the user's normal launch
composites correctly. So the backing fix was verified host-side via `host.log`
(`[COMP-backing]` created rearmost-behind-engine; recolor `#ECECEC` light /
`#111111` dark on a live CDP theme toggle) + a CDP `--bg` read, with the on-screen
look handed to the user. Don't trust agent screenshots of the running editor for
compositing.

### Lessons added

- **L-033 (new)** — agent-driven native launches misrender arch-C compositing;
  verify the DComp path via host.log + CDP + the user, not agent screenshots; the
  native a11y/dxgi lanes are noisy on this machine.

### Carried forward

- **Spawner double-panel cleanup — DONE this session** (`aba25f6`, above). The
  spawned follow-up chip is redundant.
- **Open Issues** (CHANGELOG): mod-bundled megafiles; `d3dx9_43.dll` redist.
- **arch-C performance** never profiled on a healthy machine (legacy hit 200–400
  fps maximized) — a next-step candidate.

---

## 2026-05-30 (session 2) — skydome→particle alpha bug FIXED (engine) + theme/viewport UI polish (resume: feature-parity gap audit, the recommended next LT-4 item)

**`origin/lt-4` → `4e05b00`** (was `ce366ae` at session start). Branch is linear;
FF-pushed throughout (`git push origin HEAD:lt-4`). Working tree clean. **Not on
`master`** — user explicitly said leave it on `lt-4`, no PR.

### What shipped this session (7 commits — 4 changes + 3 CHANGELOG hash-backfills)

1. **`e1f12a4` fix(engine) — skydome→particle alpha blowout. THE big one.**
   The Open-Issues bug: a background skydome (Background → any slot 1–11) made
   additive particles (explosion fire/glow) blow out to a **white dome** and
   alpha particles (smoke) render white-tinted; solid-colour bg was fine.
   **Root cause (NOT what the issue was filed as):**
   [`Engine::RenderSkydome`](../src/engine.cpp:2002) bound its own vertex
   declaration `m_pSkydomeDecl` (a `SkydomeVertex` layout — position/normal/
   texcoord, **no diffuse-colour element**) and never restored it. The vertex
   declaration is **not** part of the `ID3DXEffect` state block, and the
   engine's real `m_pDeclaration` is set only at device-reset
   ([engine.cpp:1706](../src/engine.cpp:1706)), not per frame — so the ground +
   particle draws after the skydome inherited the skydome declaration. With no
   colour stream the fixed-function pipeline defaulted every vertex's diffuse to
   **white (0xFFFFFFFF)** → additive particles blew out, alpha particles lost
   colour. **The ground was spared because its vertices are already white** —
   which is exactly why it masqueraded as a skydome-only *blend* bug.
   **Fix:** 4-line `GetVertexDeclaration`/`SetVertexDeclaration` save-restore
   around the skydome pass, mirroring its existing Z/cull save-restore. Shared
   `Engine::Render` → fixes arch-C **and** legacy. Lesson **L-032** records the
   trap (input-assembler state is invisible to render-state probes + the effect
   state block). Also added a **`--skydome <slot>`** flag to the headless
   `--capture` tool (kept as a regression tool; all other diagnostic scaffolding
   removed — net-zero on `engine.h`/`EmitterInstance.cpp`).
2. **`63d402e` style(theme) — desaturate neutral ramp to grey.** Dark theme
   panels read as "dark purple" (cool navy-slate `--panel #161b25`, blue channel
   highest). Both themes' neutral ramps (`--bg*`/`--panel*`/`--border*`/`--hover`/
   `--text*`) in [`tokens.css`](../web/apps/editor/src/styles/tokens.css)
   desaturated to **pure grey**, lightness preserved (contrast/hierarchy
   unchanged). Accent + selection stay blue; semantic colours unchanged.
3. **`a41d869` fix(ui) — opaque splitter gutters.** The `.ce-splitter` resize
   gutters were `background: transparent`; in arch-C the engine DComp visual is
   clipped to the scene rect and shows through transparent DOM, so a transparent
   gutter next to the viewport revealed the **black engine backing** (stark in
   light theme = the "black border around the curve editor"). Painted them
   `var(--bg)` in [`components.css`](../web/apps/editor/src/styles/components.css).
4. **`4e05b00` fix(ui) — square left pane's viewport-facing corners.** The left
   pane is the only rounded `.panel` adjacent to the rectangular engine; its 8px
   rounded right corners left a small dark wedge of clipped engine backing. Added
   `.panel-flush-right` ([PanelLayout.tsx](../web/apps/editor/src/components/PanelLayout.tsx)
   + components.css) to square the viewport-facing (right) corners; outer corners
   stay rounded.

### How the skydome bug was cracked (so the next session trusts the method)

Filed hypothesis was "skydome leaves a D3D9 **blend** state dirty — add a
save/restore." Refuted it + 3 follow-ons by **direct measurement** via an
instrumented `--capture`: a per-draw device-state probe proved every render
state, the live particle count, AND the per-frame `dt` were **byte-identical**
slot-0 vs slot-5; a no-particles background capture proved the white dome was the
*particles* over the (identical) ground, not the skydome backdrop → pointed at
**vertex state**, the one thing the render-state probe couldn't see. Pixel-diffs
of engine-RT PNGs (`%white` 6.2→0.0 after fix) verified. This `--capture --skydome`
+ Python/PIL pixel-analysis loop is the reusable tool for the next D3D9 fidelity bug.

### Test / build state (end of session)

- **vitest 367/367** (43 files) — unchanged; ran it after every web change.
- **Release + Debug** both built clean this session (MSBuild via PowerShell
  against `.sln`; the `LNK4098 LIBCMTD` Debug warning is pre-existing/benign).
  `x64\Release\ParticleEditor.exe` + `x64\Debug\ParticleEditor.exe` present.
- **dist** is **composition** mode and current with HEAD's source (token +
  splitter + corner changes). NOTE: `dist/build-meta.json` `commit` reads
  `6c32be5` (built one commit before the `4e05b00` corner fix) — *content* is
  correct; a `pnpm --filter @particle-editor/editor build` refreshes the stamp.
- **a11y goldens:** untouched. The engine fix is C++ + a CLI flag (no DOM); the
  theme/splitter/corner changes are CSS tokens + a className. None render into a
  captured a11y surface, so **zero golden drift** — did not regen (correct).
- **User-confirmed live:** skydome fix looks correct in the editor (user tested);
  grey theme + viewport-seam fixes verified by **screen-capture + pixel analysis**
  (the native window can't be driven by computer-use this session — MCP was down —
  so I screenshotted via a .NET `CopyFromScreen` PowerShell one-liner; see below).

### Build/UI verification tricks discovered this session (reusable)

- **Screenshot the native editor window** without computer-use: PowerShell
  `Add-Type` a `GetWindowRect`/`SetForegroundWindow` P/Invoke, then
  `System.Drawing.Graphics.CopyFromScreen` over the window rect → PNG. Crop/zoom
  + measure with Python/PIL+numpy (installed this session via `pip`). This is how
  the seam/wedge fixes were verified pixel-exactly.
- **Read the LIVE computed CSS/theme from the running WebView2** over CDP:
  launch with `--test-host` (CDP on `http://localhost:9222`), `Invoke-RestMethod`
  `/json/list` for the page's `webSocketDebuggerUrl`, then a `ClientWebSocket`
  `Runtime.evaluate` (`returnByValue:true`). Used to confirm `--panel` resolved to
  the new grey live, and that the splitter went opaque. (Reading `getComputedStyle`
  is fine under CDP; the L-003 bridge-drop only affects page→host postMessage.)
- **WebView2 caches the bundled dist across relaunches** (shared user-data folder,
  L-030). After a `dist` rebuild, a fresh process alone shows STALE UI. Clear
  `%LOCALAPPDATA%\AloParticleEditor\WebView2\EBWebView\Default\{Cache,Code Cache,
  GPUCache}` then relaunch — the harness blocks `Remove-Item` on that path unless
  you pass `dangerouslyDisableSandbox`. (localStorage is NOT in those folders, so
  theme/panel prefs survive.)
- **Theme gotcha that ate ~20 min:** the app follows OS `prefers-color-scheme`
  when `localStorage['alo:theme']` is unset (`ThemeToggle.readInitialTheme`). The
  user's OS is light, so relaunches kept landing in LIGHT theme — where the
  navy→grey change is near-invisible (light panels were already near-white). The
  user's "dark purple" complaint is the DARK theme. Setting `alo:theme` via CDP
  then force-killing the process does NOT persist (localStorage isn't flushed on
  `Stop-Process`). Easiest: have the user click the Moon icon, or just verify the
  dark value via CDP token read.

### Known issues / not-mine (carried forward — verify per L-022 before scoping)

- **CHANGELOG Open Issues** (still open): mod-bundled megafiles not loaded;
  `d3dx9_43.dll` redistribution. The skydome-alpha entry was **removed** (fixed).
- **`splitters.spec.ts` flake (L-014)** + **intermittent a11y read-only Cursor-cell
  flake** — both pre-existing, unrelated; see prior session sections below.
- **arch-C performance** never profiled (legacy hit 200–400 fps maximized) — one
  of the next-step candidates.

### Lessons added this session

- **L-032 (new)** — the vertex declaration / FVF / stream sources are NOT in the
  `ID3DXEffect` state block; a pass that binds its own must restore it or
  following fixed-function draws lose per-vertex diffuse → default white. Includes
  the full skydome diagnosis + the "identical render-state ⇒ suspect
  input-assembler state" disposition.

---

## 2026-05-30 session — toolbar consolidation SHIPPED + 4 UI polish fixes (resume: next LT-4 item / parity-gap audit)

**`origin/lt-4` → `6ec99ff`** (was `1df999b` at session start). Branch is
linear; FF-pushed throughout. Working tree clean (the only untracked item is
`.claude/scheduled_tasks.lock`, a harness artifact — ignore it).

### What shipped this session (7 commits, all on `origin/lt-4`)

The queued-and-approved **toolbar consolidation** plan (was in `tasks/todo.md`,
now archived to `tasks/todo-toolbar-consolidation-archive.md`) plus four polish
fixes the user found during live smoke-testing:

1. **`42dd06f` feat — viewport pill → toolbar + lucide icons (the main task).**
   Deleted the floating `ViewportPill`; its 3 engine toggles now live in
   [`Toolbar.tsx`](../web/apps/editor/src/components/Toolbar.tsx) as lucide
   icon buttons in their own `tb-group` between playback and Spawner:
   **Show ground = `Grid2x2`**, **Toggle bloom = `Sun`**, **Leave particles
   after instance death = `Sparkles`**. Spawner toggle changed from "Spawner"
   text to **`CirclePlus`** icon. `aria-label` + `aria-pressed` ported verbatim
   (each reads `state.ground/bloom/leaveParticles`, dispatches the existing
   `engine/set/{ground,bloom,leave-particles}` with `{enabled: !cur}`). Removed
   pill render+import from
   [`PanelLayout.tsx`](../web/apps/editor/src/components/PanelLayout.tsx);
   deleted `ViewportPill.tsx`, `ViewportPill.test.tsx`, the `.vp-tools` CSS
   block, and `public/icons/icon-{ground,bloom,particles}.svg`.
   **L-030 harness fix landed:** new `seedCanonicalUiState(page)` in
   [`tests/helpers/a11y-surfaces.ts`](../web/apps/editor/tests/helpers/a11y-surfaces.ts)
   forces light theme + Spawner-visible + reload in every a11y spec's
   `beforeAll` (8 specs), so a blanket golden regen is deterministic. Removed
   the dedicated `viewport-pill` a11y surface (driver + 2 goldens). Both lanes
   regenerated — diff was toolbar-region-only across all 40 goldens, zero
   theme/spawner drift.
2. **`ab2a0d7` fix — hover tooltips (`title`) on icon-only toolbar buttons.**
   `aria-label` gives the accessible name but no visual tooltip; `title` does.
   Added `title` to all 11 icon buttons in `Toolbar.tsx` + 2 in
   [`ThemeToggle.tsx`](../web/apps/editor/src/components/ThemeToggle.tsx). The
   Ground/Background dropdowns already show visible text, so they were skipped.
   Golden-neutral (verified 0 drift).
3. **`3aa6858`+`2dccbd5` docs — skydome alpha bug filed.** See "Known issues"
   below. Two near-identical commits (a trailing-newline hiccup on the first);
   harmless, offered to squash, user hasn't requested it.
4. **`0fe8797` fix — persistent pressed state on toggle buttons.** The toggles
   set `aria-pressed` but no CSS styled it (the old pill used a `.tool.active`
   class). Added `.tb-btn[aria-pressed="true"]` alongside the existing
   `.tb-btn.active` in
   [`components.css`](../web/apps/editor/src/styles/components.css) (accent-soft
   bg + accent fg). Driving the visual off `aria-pressed` keeps one source of
   truth. Also lights up Play|Pause while running. Golden-neutral (verified 0
   drift — attribute selector, no DOM/className change).
5. **`6ec99ff` style — 1px vertical toolbar padding.** `.toolbar` `padding:
   0 8px` → `1px 8px`. Pure geometry; goldens are semantic-tree only, unaffected.

### Test / build state (end of session)

- **vitest 367/367** (43 files). Baseline was 366; net +1 (Toolbar gained 5
  toggle tests, ViewportPill's 3 deleted, +others = 367).
- **`pnpm --filter @particle-editor/editor build`** clean; `dist/` is
  **composition** (`dist/build-meta.json` confirmed). Both binaries built this
  session: `x64\Debug\ParticleEditor.exe` (a11y harness) + `x64\Release\…`
  (live smoke) — this is a fresh worktree that had neither at start.
- **a11y goldens canonical** — both lanes regenerated; all 40 toolbar-region
  diffs are intentional and committed. Read-only composition lane verified.
- **User-confirmed live (screenshots):** light AND dark theme look correct;
  all 4 new icons render; tooltips present; pressed state visible; padding good.

### Known issues / not-mine (carried forward — verify per L-022 before scoping)

- **Skydome breaks particle alpha blending** (user-reported, filed in
  `CHANGELOG.md` Open Issues). Applying a background skydome (Background slots
  1–11, anything but slot 0 "Solid colour") makes particle alpha render wrong;
  solid-colour background is fine. **Engine-level, out of scope for this UI
  work — NOT fixed.** Likely a D3D9 render-state (alpha-blend enable / blend
  factors) the skydome pass leaves changed and the particle pass depends on.
  Suspects: `Engine::RenderSkydome` in [`src/engine.cpp`](../src/engine.cpp) +
  [`src/Resources/Engine/Skydome.fx`](../src/Resources/Engine/Skydome.fx).
  First step: RenderDoc/PIX (or the `--capture` headless tool) frame-diff at the
  particle draw call, with vs without a skydome. Plausibly a small save/restore
  fix mirroring the pass's existing scoped state-restore.
- **`splitters.spec.ts` flake (L-014)** — 4 tests fail on full-suite native
  runs but pass 6/6 in isolation; pre-existing `react-resizable-panels`
  measurement flake, unrelated to this work (`splitters.spec.ts` unmodified).
  Makes the a11y regen run exit 1 even though **0 a11y golden mismatches** —
  don't misread the exit code (see L-031).
- **Intermittent a11y read-only flake** — the curve/spinner composition
  surfaces occasionally capture a stray `cursor/position-3d` value in the
  StatusBar `contentinfo` Cursor cell (different surface each run, never the
  toolbar). Pre-existing L-024-class source non-determinism; committed goldens
  are correct (0 drift). A clean tiny follow-up would freeze/normalize the
  Cursor cell like the FPS cells already are.

### Lessons added this session

- **L-030 resolution** appended (the "force a known UI state" follow-up is now
  implemented via `seedCanonicalUiState`).
- **L-031 (new)** — native golden/Playwright runs are single-instance +
  fixed-port (CDP 9222); **never run them in parallel**, they collide and
  report spurious exit 1. Run every native invocation serially.

### Process notes for next session (environment quirks hit this session)

- **Tool-output channel stalled intermittently** all session — commands
  succeeded but their output sometimes didn't render, and a few parallel
  batches got cancelled. Mitigation that worked: run native/build steps **one
  at a time**, write results to a temp file, and confirm against `git`
  (authoritative) rather than trusting a possibly-dropped echo. The Read tool
  also briefly returned *fabricated* content for non-existent paths early on —
  cross-check file existence with `ls`/`git` before trusting a Read.
- **Fresh worktree builds.** This worktree started with no `x64\` binaries;
  the a11y harness needs Debug, live smoke needs Release. Build both up front
  (MSBuild via PowerShell against `.sln`, L-025/L-023) before any native run.

---

## 2026-05-29 session 2 — feature-parity B shipped + 2 resize/label fixes (resume: toolbar consolidation, PLAN READY)

**`origin/lt-4` → `ae22c64`** (was `f2f84ba`). Tree clean except the
queued plan; local `lt-4` ref in the main worktree was fast-forwarded to
`ae22c64` too (main worktree is checked out on `master`, untouched).

### Shipped this session (all on `origin/lt-4`)

1. **Feature-parity B — frequently-used texture palette** (`59cfb27` feat,
   `2196181` docs). The legacy per-mod pinned/recent texture palette, now in
   the new UI: a Radix Popover on each emitter texture field (beside Browse)
   with Color/Bump filter, Pinned + Recent thumbnail grids (12-cap),
   click-to-apply, star pin/unpin, slot-aware filter default, honest no-mod
   hint. Four bridge requests (`textures/palette/{list,thumbnail,toggle-pin,
   touch-recent}`) over the existing `TexturePalette::Store`; new
   [`src/UI/PaletteThumbs.cpp`](../src/UI/PaletteThumbs.cpp)
   (`GetThumbnailDataUri` + `ClearBridgeThumbCache`) decodes textures →
   base64 PNG (reuses legacy `DecodeThumbnail` technique + GDI+; resolves
   `.meg`-packed textures for free); React
   [`TexturePalettePopover.tsx`](../web/apps/editor/src/screens/TexturePalettePopover.tsx)
   + palette button / touch-recent funnel on `TexturePickerField`.
   **User-verified live** (real thumbnails, slot-aware, pin/recent). Path A:
   base-game palette + `.meg` content browser deferred.
2. **Inspector label readability on resize** (`1fa0254`). Pixel min-size
   floors on the left (330px) + Spawner (260px) panes; checkbox rows use a
   tight `1fr auto` grid (`.form-row-check`) so the 18px checkbox no longer
   reserves the spinner's 58px+40px columns and squeezes long labels.
3. **Spawner-toggle pane carry-over** (`ae22c64`). Toggling the Spawner no
   longer snaps panes to a preset — `deriveOuterLayoutOnToggle` carries the
   current widths across (left fixed, center absorbs/releases the spawner
   space). Pure helper, TDD'd.
4. **L-030 lesson** (in `2196181`) — don't blanket-regenerate a11y goldens
   for a UI change that doesn't render in a captured surface; beware the
   shared-WebView2-profile state pollution (theme/spawner) at capture time.

**Test state:** vitest **366/366**; `pnpm build` (tsc) clean; MSBuild
Debug+Release clean (no C++ changes since the palette); a11y goldens are
**canonical / untouched** (the palette was golden-neutral).

### RESUME HERE: toolbar consolidation + lucide icon refresh — PLAN APPROVED, NOT STARTED

The full 5-section plan is written + user-approved in
[`tasks/todo.md`](todo.md). **Do not redesign — implement it.** Summary:

- **Remove the floating viewport pill**; move its 3 toggles into the toolbar
  as lucide icon buttons; change the Spawner toggle from text to an icon.
  **Icon set is decided** (all lucide-react, themeable via `currentColor`):
  Show ground = `Grid2x2`, Bloom = `Sun`, Leave particles = `Sparkles`,
  Spawner = `CirclePlus`. Delete the old hardcoded-blue
  `web/apps/editor/public/icons/icon-{ground,bloom,particles}.svg`.
- **Toolbar grouping (approved):** the 3 viewport toggles go in their own
  group between playback and the Spawner button.
- **The bulk + the risk is the a11y side, not the UI move.** The toolbar is
  captured in ~every a11y golden, so this is gated on fixing the **L-030
  harness pollution**: force a known state (light theme + Spawner-visible —
  the canonical capture state) in the a11y setup, then regenerate BOTH lanes
  and use `git diff --stat` as the gate (only the toolbar region + the
  removed `viewport-pill.*` files may change). Remove the dedicated
  `viewport-pill` a11y surface (driver + 2 goldens). Full plan §3b/§3c/§4.

Key files: [`Toolbar.tsx`](../web/apps/editor/src/components/Toolbar.tsx),
[`ViewportPill.tsx`](../web/apps/editor/src/components/ViewportPill.tsx)
(delete), [`PanelLayout.tsx`](../web/apps/editor/src/components/PanelLayout.tsx)
(remove pill render), [`a11y-surfaces.ts`](../web/apps/editor/tests/helpers/a11y-surfaces.ts:126)
(viewport-pill surface), [`ThemeToggle.tsx`](../web/apps/editor/src/components/ThemeToggle.tsx:13)
+ [`spawner-visibility.ts`](../web/apps/editor/src/lib/spawner-visibility.ts:12)
+ [`HostWindow.cpp`](../src/host/HostWindow.cpp:205) (the L-030 state sources).

---

## 2026-05-29 session — dist-gate + capture tool + feature-parity A (resume: parity B)

**`origin/lt-4` → `b80fd7b`** (was `a405bf1`). Full resume instructions
in [`tasks/next-session-prompt.md`](next-session-prompt.md). Tree clean,
all work pushed. Shipped this session:

- **[item 4] dist/ build-mode test gate** (`b4765bd`) — `run-native-tests.mjs`
  fail-fasts / `--rebuild`s on a `dist/` hosting-mode mismatch
  (`dist/build-meta.json` marker from a `vite.config.ts` plugin).
- **Headless frame-capture tool** (`7af4b5c`) —
  `--new-ui --capture <alo> <png> [--frames N]`: mod-aware, spawns+fills
  the effect, writes engine RT + final composite PNGs. The
  rendering-fidelity automation; use it instead of manual screenshots.
- **Feature-parity A — texture Browse picker** (`ab1d340` + CSS `3bcdd55`,
  user-verified) — `textures/browse` bridge request + host dialog (opens
  in active mod's texture folder) + React `TexturePickerField`.
- **L-029** (`ef0a898`) — verify the CORRECT (mod) assets are loaded
  before suspecting the render pipeline.

**Headline finding:** the reported "additive black-background / hard
square edges" was **mod textures not loaded** (base-game art), NOT an
arch-C renderer bug. With the mod selected, arch-C renders **1:1 with
the 0.2 legacy build** (engine RT + composite, verified). Rendering
fidelity — the #1 daily-drive blocker — is effectively resolved.

**Resume:** feature-parity **B = frequently-used texture palette** (the
legacy per-mod pinned/recent popup). Fresh brainstorm→plan→implement
cycle. The C++ `TexturePalette::Store` already exists
(`src/UI/TexturePalette.h`); B exposes it via new bridge requests + a
React popup on the `TexturePickerField` built in A. Details in the
next-session prompt. User still daily-drives 0.2; remaining blockers
after B: more parity items + performance (legacy hit 200–400 fps).

---

**Prior context — 2026-05-26.** Two ships landed on `lt-4`:

1. **[MT-11] Phase 3 a11y close-out** — dual-mode Playwright a11y
   regression gate (HWND Win32 UIA via standalone C++ inspector +
   composition `page.accessibility.snapshot()` over CDP, ~29 surfaces
   × 2 modes = ~58 committed goldens), plus the
   [`a11y-uia-composition-reachable.spec.ts`](../web/apps/editor/tests/a11y-uia-composition-reachable.spec.ts)
   backbone-reachability spec, the [`pnpm a11y`](../web/apps/editor/package.json) /
   `a11y:update` scripts, and the Stage 3i manual checklist
   (Narrator-speech recording deferred per Option C). FF'd to `lt-4`
   at `7a4404d`.
2. **[MT-12] flip default to architecture C** — the DXGI composition
   path that [MT-11] proved out is now the default; architecture A
   (legacy AlphaCompositor popup) is opt-in via `ALO_HOSTING_MODE=legacy`.
   The four pre-MT-12 env vars (`ALO_WEBVIEW2_HOSTING` /
   `ALO_VIEWPORT_TRANSPORT` / their VITE_* twins) are retired and
   replaced by a single `ALO_HOSTING_MODE` (runtime) / `VITE_HOSTING_MODE`
   (build-time) pair. Session branch `claude/mt12-flip-default-archc`;
   FF pending T11 verification.

## What shipped today (2026-05-26 — [MT-12] flip default to architecture C)

- **C++ host default flip.** `m_archCMode` + `m_compositionMode`
  default to `true` in [`src/host/HostWindow.cpp:520`](../src/host/HostWindow.cpp);
  the env-var read at the same site flips them to `false` only when
  `ALO_HOSTING_MODE=legacy`. Unknown values warn and fall through to
  default. The pre-MT-11 desync warning at the same site is deleted
  (single var eliminates the failure mode it guarded against).
- **React build-mode default flip.** Two helpers
  (`isArchCEnabled` + `isCompositionMode`) collapsed into a single
  `isLegacyMode()` in
  [`web/apps/editor/src/components/ViewportSlot.tsx:29`](../web/apps/editor/src/components/ViewportSlot.tsx).
  Callers compute `archCEnabled = !legacyMode` and `compositionMode = !legacyMode`
  (kept as distinct named aliases for code clarity; future architecture-A
  deletion can collapse them).
- **Boot-mode log lines (R1 mitigation).** Host emits
  `[host] hosting mode: composition (architecture C, default)` (or
  legacy variant) at startup; React emits
  `[mode] React build mode: composition (architecture C, default)`
  (or legacy variant) on `App` mount. Both unconditional (release
  builds too) so issue reports include the active mode in their
  first log line. Grep these to diagnose runtime/build mode
  mismatches.
- **Deprecated env-var detection (R7 mitigation).** Host emits a
  loud warning at startup if any of the four retired env-var names
  is set in the environment. ~10 lines of defensive code in the
  same boot block. Remove in the future architecture-A-deletion
  dispatch.
- **Test harness flip.** `pnpm test:native` (no args) now runs the
  composition lane by default (was: HWND lane). New
  `pnpm test:native:legacy` script runs the legacy HWND lane via
  the new `--legacy` flag in
  [`scripts/run-native-tests.mjs`](../web/apps/editor/scripts/run-native-tests.mjs).
  Sister `pnpm a11y:legacy` / `pnpm a11y:update:legacy` added for
  the legacy a11y lane symmetry.
- **Spec mode-gate migration.** 17 spec files migrated from the
  old env-var pattern (`process.env.ALO_WEBVIEW2_HOSTING === "composition"`)
  to the new pattern (`process.env.ALO_HOSTING_MODE !== "legacy"`).
  Skip annotations updated to reference the new env-var name. New
  helper [`tests/helpers/mode.ts`](../web/apps/editor/tests/helpers/mode.ts)
  exposes `isLegacyMode()` + `isCompositionMode()` for any new spec
  that wants a cleaner API.
- **Test count baselines change.** Default Playwright (composition):
  **~157 / 0 / 31** (was the *opt-in* number pre-MT-12; now the
  *default*). Legacy Playwright: **~132 / 0 / 56** (was the
  *default* number; now the *opt-in*). Vitest: **347 / 347**
  (348 → 347 net: removed redundant subscribe/unsubscribe pair under
  default mode; replaced with a single "does NOT subscribe under
  architecture C" assertion).
- **Mode-consistency banner deferred (R2 scope-trim).** The plan
  called for a top-of-app banner on build/runtime mode mismatch
  via a `viewport/mode-claim` bridge surface; trimmed to the
  log-only approach (above) since both log lines surface the
  mismatch immediately and the symptom (broken viewport rendering)
  is self-evident. Filed as "Known follow-ups" item below for
  promotion if mismatches happen in practice.

**Test counts at end of session (composition default):**

| Lane | Result |
|---|---|
| vitest | **347 / 347** (348 pre-MT-12; net -1 from collapsed redundant ViewportSlot test under composition default) |
| Playwright default mode (composition / architecture C) | Verified during T9 — see commit message for exact counts |
| Playwright legacy mode (architecture A, opt-in via `--legacy` + matching `VITE_HOSTING_MODE=legacy` dist/) | Verified during T9 — see commit message for exact counts |
| MSBuild Debug + Release x64 via .sln | clean ✓ |
| Live-binary smoke (both modes) | See T10 |

## What shipped today (2026-05-26 — [MT-11] Phase 3 a11y close-out)

- **HWND lane a11y regression gate.** Win32 UIA tree capture for
  ~29 interactive surfaces (chrome / menubar × 7 menus / toolbar /
  emitter tree / property tabs × 3 / 10 dialogs / 4 keyboard
  scenarios / 2 focused inputs) via the new standalone C++ inspector
  at [`src/host/spike/uia_inspector.cpp`](../src/host/spike/uia_inspector.cpp)
  (~200 LoC, links `UIAutomationCore.lib`; output: `x64/{Debug,Release}/uia_inspector.exe`).
  Wrapper at [`web/apps/editor/tests/helpers/uia.ts`](../web/apps/editor/tests/helpers/uia.ts)
  spawns the exe and parses JSON; specs only see `captureUIA(hwnd, surfaceId)`.
  Per-spec drivers at
  [`web/apps/editor/tests/helpers/a11y-surfaces.ts`](../web/apps/editor/tests/helpers/a11y-surfaces.ts)
  set up each surface (focus, open menu, open dialog) so capture is
  deterministic. Normalizer at
  [`web/apps/editor/tests/helpers/a11y-normalizer.ts`](../web/apps/editor/tests/helpers/a11y-normalizer.ts)
  + allowlist
  ([`a11y-allowlist.json`](../web/apps/editor/tests/helpers/a11y-allowlist.json))
  strips Chromium chrome wrappers (`Chrome_WidgetWin_1`,
  `BrowserRootView`, `NonClientView`, `EmbeddedBrowserTabRootView`)
  so goldens focus on the React tree's semantic content. Custom
  [`toMatchJSONGolden`](../web/apps/editor/tests/helpers/toMatchJSONGolden.ts)
  matcher with `UPDATE_A11Y_GOLDENS=1` regeneration; raw
  pre-normalization JSON dumped to `tests/a11y-failures/`
  (gitignored) on mismatch. 29 JSON goldens at
  [`web/apps/editor/tests/a11y-goldens/*.golden.json`](../web/apps/editor/tests/a11y-goldens/).
- **Composition lane a11y regression gate.** Same ~29 surfaces
  re-parametrised via Playwright's
  `page.accessibility.snapshot()` (CDP-based; works regardless of
  WebView2 hosting mode). YAML goldens at
  [`a11y-goldens/*.composition.golden.yaml`](../web/apps/editor/tests/a11y-goldens/).
  4 composition spec files mirror the HWND lane's structure.
- **Composition backbone-reachability spec.**
  [`tests/a11y-uia-composition-reachable.spec.ts`](../web/apps/editor/tests/a11y-uia-composition-reachable.spec.ts)
  asserts that under composition mode, Win32 UIA (via the same
  inspector) reaches the React landmark roles (menubar, toolbar,
  app-shell) at known depths once Blink accessibility is warmed up.
  Catches the Blink-lazy-init regression class. *Note: Phase 0
  initially read composition-mode UIA as zero-descendant; T9.3
  discovered `--force-renderer-accessibility`
  ([`src/host/HostWindow.cpp`](../src/host/HostWindow.cpp)) + a
  one-time `GetFocusedElement` warmup
  ([`src/host/spike/uia_inspector.cpp`](../src/host/spike/uia_inspector.cpp))
  makes the React tree reachable at depth ~20. The dual-API design
  was kept (DOM snapshot is faster + more stable) but T11 was
  re-shaped from negative-contract into positive backbone-reachability.*
- **StatusBar volatility solved at the source.**
  [`stats/set-frozen { frozen: bool }`](../web/packages/bridge-schema/src/index.ts)
  bridge request gates `EmitStatsTick` host-side
  ([`src/host/BridgeDispatcher.cpp`](../src/host/BridgeDispatcher.cpp))
  AND emits a `stats/frozen-changed` event; React StatusBar
  ([`web/apps/editor/src/components/StatusBar.tsx`](../web/apps/editor/src/components/StatusBar.tsx))
  listens and clears local state. The existing `placeholder = s === null`
  render path produces deterministic `—` values for FPS / Emitters /
  Particles / Cursor — StatusBar a11y stays captured in goldens.
  *Anti-pattern explicitly rejected during recovery: an
  `alwaysDropSubtrees` normalizer concept that would have dropped
  the StatusBar entirely (cost StatusBar a11y coverage permanently;
  every future live-data cell would need to opt in). See
  [L-024](lessons.md#l-024).*
- **Cross-spec contamination fix.** All 5 a11y specs (4 HWND + 1
  composition backbone) call `stats/set-frozen { frozen: false }`
  AND `file/new {}` in `afterAll` to leave the shared host process
  clean for downstream specs (`app-shell.spec.ts`,
  `emitter-mutations.spec.ts`). Mirror the pattern in any new spec
  that mutates host state.
- **`pnpm a11y` / `pnpm a11y:update` scripts.** Added to
  [`web/apps/editor/package.json`](../web/apps/editor/package.json);
  `--update` flag plumbed through
  [`web/apps/editor/scripts/run-native-tests.mjs`](../web/apps/editor/scripts/run-native-tests.mjs)
  to set `UPDATE_A11Y_GOLDENS=1` for the run. Use `pnpm a11y:update --grep <id>`
  for a single surface.
- **Stage 3i manual checklist.**
  [`tasks/stage-3i-a11y-manual.md`](stage-3i-a11y-manual.md) —
  prerequisite Narrator config, Tab cycle (each mode), F2 inline
  rename, Escape close, arrow-key tree navigation, IME compose
  smoke, Narrator-speech pass enumerating all 29 surfaces grouped
  by UI state. The checklist exists as an on-demand interactive
  smoke; not gating this close-out (see next bullet).
- **Narrator-speech recording — deferred (Option C).** The Narrator
  is a UIA client and the 29 UIA goldens already pin every surface's
  `Name` + `ControlType` + state, so the per-surface Narrator-speech
  pass is structurally redundant with automated coverage. The bits
  not covered — Narrator's *speech-shaping* layer (image alt-text,
  "1 of 7" list-position synthesis, punctuation/symbol announcement,
  group/landmark traversal voiceover) — are filed as a follow-up
  below, not gating Phase 3 close-out. The
  [`tasks/stage-3i-a11y-manual.md`](stage-3i-a11y-manual.md)
  Narrator-speech section is kept intact so it can be re-activated
  at any later sit-down by recording the .mp4 and ticking through
  it; just remove the top deferral notice when doing so.
- **L-024 lesson.** UIA non-determinism: WebView2 topology drift
  goes in `alwaysStripWrappers` (allowlist); live React subscriptions
  go in a source-side freeze (bridge knob + React listener). Solve
  at the right layer.

**Test counts at end of session (steady-state, post-recovery):**

| Lane | Result |
|---|---|
| vitest | **348 / 348** (343 pre-T1 baseline + 5 normalizer unit tests) |
| Playwright HWND mode (default dist/) | **132 passed / 0 failed / 56 skipped** twice consecutively (29 composition + T11 backbone specs auto-skip cleanly) |
| Playwright composition mode (`VITE_VIEWPORT_TRANSPORT=canvas-jpeg` + `VITE_WEBVIEW2_HOSTING=composition` dist/ + matching `ALO_*` runtime env) | **157 passed / 0 failed / 31 skipped** twice consecutively (29 composition a11y + T11 backbone + other native specs) |
| MSBuild Debug + Release x64 via .sln (per L-023) | clean |
| Live-binary smoke | HWND mode boot + menu open/close + sample `.alo` load + composition mode boot + same smoke |

**Residual flake:** `emitter-mutations.spec.ts:84` ("delete via
context menu") flakes intermittently — pre-existing per prior
commit history, mitigated by a11y `afterAll` cleanup. Re-run once
on hit; second run almost always passes.

**Local `master` lag:** still behind origin/master from prior
sessions — run `git pull --ff-only` in
`C:\Modding\Particle Editor` when convenient.

## Known follow-ups (out of scope for this session)

Carried forward + spawned during this dispatch. Per
[L-022](lessons.md#l-022--handoff-notes-and-next-session-prompts-carry-claims-not-facts--verify-against-current-code-before-any-claim-enters-a-dispatchs-plan):
verify each carry-forward claim against current code before scoping
it into a dispatch.

1. **Deferred a11y surfaces (T6 R3 cap).** Six dialog / chrome
   surfaces were dropped from Phase 3 a11y coverage because their
   setup exceeded the per-surface 30-minute cap. Catalogued at
   [`tasks/a11y-deferred-surfaces.md`](a11y-deferred-surfaces.md)
   with the re-introduction sketch for each: `dialog-save-changes`
   (needs dirty-state plumbing), `dialog-link-group-settings`
   (needs a link-group-bearing fixture or atom-poke seam),
   `dialog-background-picker` + `dialog-ground-texture` (now Radix
   Popovers; belong in a popover-surfaces bucket, not dialogs),
   `dialog-primitives-gallery` (route, not overlay — needs its own
   demo-surfaces lane), `dialog-spawner` (always-on panel, not a
   dialog — belongs in chrome surfaces). Each is independently
   shippable as a small dispatch.
2. **Stage 4 sub-stage 4e — first-frame `ClearRenderTargetView`
   guard.** Inherited from Stage 5. Not observed during smoke;
   ship-if-surfaces.
3. **`canvas-architecture.spec.ts` test.fixme markers.** Inherited
   from Phase 2 (L-012 instrumentation issue). Three documented
   fix approaches.
4. ~~**Test harness env-var pre-flight check.**~~ ✅ **RESOLVED**
   (2026-05-29). The native-test harness now gates on the baked
   `dist/` hosting mode. A Vite plugin (`buildMetaPlugin` in
   [`vite.config.ts`](../web/apps/editor/vite.config.ts)) stamps
   `dist/build-meta.json` with the build-time `VITE_HOSTING_MODE`;
   [`run-native-tests.mjs`](../web/apps/editor/scripts/run-native-tests.mjs)
   reads it in a new `ensureDistMode()` pre-flight and **fail-fasts
   before host launch** when the marker's `hostingMode` doesn't match
   the requested lane (`--legacy` ⇒ legacy, else composition), or when
   `dist/` is missing / unmarked. The fail-fast message prints the
   exact rebuild command. Opt-in `--rebuild` runs the correct
   `pnpm build` (shell-free `tsc -b` + `vite build`, then re-reads the
   marker to confirm — never trusts exit 0, cf. L-025) and proceeds.
   Verified: composition `157/0/31`, legacy `132/0/56`, both fail-fast
   directions, missing-marker fail-fast, and `--grep`/`--update`
   forwarding (item 16 fix) untouched. **First-adoption note:** a
   `dist/` built before this change has no marker, so the gate
   fail-fasts on first run — rebuild once (or `--rebuild`) to stamp it.
5. **Coalesce-key tuning for spinner-drag undo.** Today's
   `captureUndo` lambda uses key=0 (never coalesce), so a 100-tick
   spinner drag produces 100 undo entries. Separate dispatch worth
   its own design thought.
6. **Full mock-side undo.** Today's mock `undo/perform` returns
   `{applied:false}` (no-op). Implementing a real mock undo requires
   snapshotting multiple Zustand stores per mutation — non-trivial,
   not gating native behaviour.
7. **F17 P2 verification.** Per-`post-audit-followups.md`:
   confirm/refute that `attachedParticleSystem` isn't cleared on
   LoadFile/RestoreFromAutosave. Pure-verification dispatch
   (~30 min); may spawn a small fix or close as non-bug.
8. **NT-6 visual-stability lane assignment** (ROADMAP §1.2).
   Explicitly user-gated — only worth it if lane-bouncing has been
   observed as a real ergonomic issue.
9. **Narrator speech-shaping verification (Stage 3i Option C
   deferral).** The 29 UIA goldens pin structural a11y across both
   modes, but Narrator's speech-shaping layer is not covered —
   image alt-text handling, "1 of 7" list-position synthesis,
   punctuation/symbol announcement, group/landmark traversal
   voiceover. Re-activate the Narrator-speech section in
   [`tasks/stage-3i-a11y-manual.md`](stage-3i-a11y-manual.md) by
   removing its top deferral notice + recording the
   `tasks/stage-3i-narrator-recording.mp4` artefact in a single
   sit-down (~5-10 min with Narrator + Game Bar / OBS). Or
   automate via Option A from the 2026-05-26 deferral discussion
   (PowerShell / Playwright driver that walks the 29 surfaces
   with timed pauses while user records). Single-session work
   when convenient.
10. **Stage 3i interactive smoke (non-Narrator sections).** Tab
    cycle / F2 inline rename / Escape close / arrow-key tree
    navigation / IME compose — covered by the checklist at
    [`tasks/stage-3i-a11y-manual.md`](stage-3i-a11y-manual.md),
    not covered by any automated lane. ~5-10 min interactive pass.
    Not gating Phase 3 close-out (the automated gates already
    catch structural regressions); run on demand when suspicion
    arises or before a release tag.
11. **Architecture A deletion ([MT-12] Phase 2).** User condition
    for this dispatch: only delete architecture A *after* C is
    confirmed stable in default daily use. The work: drop
    `AlphaCompositor` + band-mask render path + `viewport/occlude`
    bridge surface + smoothstep-feather pipeline + every
    `useViewportOcclusion` callsite + FramePublisher (wasted-work
    JPEG encoder under composition) + the `ALO_HOSTING_MODE=legacy`
    opt-out + the deprecated-env-var warning + the HWND-only test
    specs. Sized at ~1-1.5 days. Tag candidate `[MT-13]`. Do NOT
    pull until the user reports daily-use confidence in architecture
    C as the default.
12. **Mode-consistency banner ([MT-12] R2 deferred).** Plan §6 T4
    called for a top-of-app React banner on build/runtime hosting-
    mode mismatch via a `viewport/mode-claim` bridge surface (~100
    LoC across schema + C++ + mock + React). Trimmed to log-only
    in the shipped version — `[host] hosting mode:` (host startup)
    + `[mode] React build mode:` (App mount) bracket the mismatch
    for grep-based diagnosis. Promote to full banner if mismatches
    happen frequently in practice; the symptom (broken viewport)
    is self-evident so the banner is quality-of-life, not safety-
    critical.
13. ~~**FramePublisher dead-code elimination ([MT-12] cosmetic).**~~
    ✅ **RESOLVED** at `d3a4776` — one-line `!m_compositionMode`
    guard at [`src/host/HostWindow.cpp:751`](../src/host/HostWindow.cpp:751)
    skips the per-frame JPEG encode call under composition. Turned
    out not to be cosmetic — see resolved item 15. Construction of
    `m_framePublisher` stays coupled to `m_archCMode` for now;
    full removal is part of the future architecture-A deletion.
14. ~~**Cursor-bound spawn offset under architecture C ([MT-12] T10
    smoke).**~~ ✅ **RESOLVED** at `40b53c3`. Root cause was a
    viewport / projection mismatch in `GetCursorPos3D`
    ([`src/MouseCursor.h:54`](../src/MouseCursor.h:54)) — the helper
    read the D3D9 device's *current* viewport (which `Engine::Render`
    restores to FULL-RT at [`src/engine.cpp:687-699`](../src/engine.cpp:687)
    before returning) and unprojected against `m_projection` (which
    `SetSceneViewport` builds at scene-rect aspect with per-pixel
    FoV referenced to scene-H). `D3DXVec3Unproject` normalised
    `(x - 0) / RT_W` to NDC and fed it into a projection expecting
    `(x - sceneX) / sceneW`, off by the scene-rect offset every
    time. Fix: when `Engine::GetSceneViewport()` returns true, build
    a `D3DVIEWPORT9` from the scene rect and pass it to
    `D3DXVec3Unproject` (which subtracts viewport.X/Y internally, so
    input coords stay popup-client). Architecture A never activates
    the scene viewport so the fallback branch runs unchanged — same
    behaviour as before this fix. The status-bar `cursor/position-3d`
    emit also goes through `GetCursorPos3D` so it auto-fixes; the
    "status-bar correct, spawn offset" framing in the original
    handoff was a measurement artefact (both were wrong by the same
    amount, but world coords as raw floats are hard to eyeball).
    Three call sites in `HostWindow.cpp` (`WM_MOUSEMOVE`,
    `WM_KEYDOWN VK_SHIFT`, `WM_LBUTTONDOWN` SHIFT-fallback)
    additionally got `#ifndef NDEBUG` `[cursor-unproject]` diagnostic
    lines so future regressions land in `host.log` with both input
    coords and viewport choice.
15. ~~**Composition-mode perf regression on maximize ([MT-12] T10
    smoke).**~~ ✅ **RESOLVED** at `d3a4776`. The hypothesis was
    correct on the first test: skipping FramePublisher's per-frame
    JPEG encode under composition mode recovers maximized FPS at
    3440×1440 from "substantial drop" to ~90 fps (windowed
    mid-100s) — close to legacy-mode parity. Same one-line guard
    resolved item 13. Daily-use composition mode no longer has the
    perf cliff that was blocking the architecture-A deletion
    (item 11) on this axis.
16. ~~**A11y golden drift (29 mismatches per lane, pre-existing on
    `lt-4 @ da58968`).**~~ ✅ **RESOLVED** at `610d5dd` (fix
    commit). Root cause was **not** drift in the React DOM or any
    MT-12 commit, but two latent test-infrastructure issues that
    were never caught because the goldens were committed on a
    non-Windows host (or with `core.autocrlf=false`) and the
    dispatch chain since never re-ran them on a fresh Windows
    checkout. Diagnosis:
    - **28 of 29 surfaces in each lane: LF/CRLF line-ending
      mismatch.** `core.autocrlf=true` (default Windows git
      install) smudges the LF-stored goldens to CRLF on checkout.
      `toMatchJSONGolden` does byte-exact compare
      (`expected === serialized`) so every mass byte-level
      mismatch failed. `git ls-files --eol <golden>` showed
      `i/lf w/crlf attr/` on every committed JSON/YAML golden
      file; `git diff HEAD` showed empty content with a *"LF will
      be replaced by CRLF the next time Git touches it"* warning.
    - **1 of 29 surfaces (`dialog-about`) in each lane: build
      date drift.** `vite.config.ts:12` used
      `new Date().toISOString().slice(0, 10)` to compute
      `BUILD_DATE`, so every rebuild on a new calendar day shifted
      the value baked into `import.meta.env.VITE_BUILD_DATE` and
      into the About dialog's "Build date: YYYY-MM-DD" text.
      Captured on 2026-05-26, the golden showed `2026-05-26`;
      rebuild today (2026-05-27) showed `2026-05-27`.
    - **Bonus finding:** `pnpm a11y:update --grep "<id>"` silently
      regenerated ALL goldens, not the scoped subset. The harness
      [`run-native-tests.mjs`](../web/apps/editor/scripts/run-native-tests.mjs)
      hard-coded the Playwright spec list and dropped unrecognised
      args. Fixed in same dispatch.
    Three fixes, one dispatch:
    1. `.gitattributes` at repo root with `text eol=lf` for
       `*.golden.json` / `*.golden.yaml` / `*.snap` (and explicit
       `web/apps/editor/tests/a11y-goldens/` paths) — forces LF
       on checkout regardless of autocrlf, fixes 28 of 29 surfaces
       in both lanes.
    2. [`vite.config.ts`](../web/apps/editor/vite.config.ts) pins
       `BUILD_DATE` to `git show -s --format=%cs HEAD` (commit
       date) instead of `new Date()`. Stable across rebuilds of
       the same commit; About dialog now shows when the code was
       committed, not when somebody happened to run `pnpm build`.
       This is the user-facing half of the dialog-about fix.
    3. [`run-native-tests.mjs`](../web/apps/editor/scripts/run-native-tests.mjs)
       forwards `process.argv.slice(2)` extras (minus `--update` /
       `--legacy`) to the Playwright spawn. `pnpm a11y:update
       --grep "<id>"` now scopes correctly.
    4. **(follow-up `a315245`, 2026-05-29)** [`toMatchJSONGolden.ts`](../web/apps/editor/tests/helpers/toMatchJSONGolden.ts)
       `normalizeVolatile()` strips the build date to a `<DATE>`
       placeholder on both the live capture AND the golden before
       byte-comparison; both `dialog-about` goldens hold `<DATE>`.
       **Why this was needed even after fix 2:** pinning to HEAD's
       commit date can NEVER keep a committed golden green — the
       commit that records the date becomes the parent of a LATER
       commit, so the next rebuild's `BUILD_DATE` always exceeds
       the golden's frozen date by one commit's worth. Fix 2 alone
       passed verification only because HEAD hadn't advanced yet;
       it silently broke the moment the fix/docs commits landed.
       The pin (fix 2) is the right *user-facing* behaviour; the
       normalizer (fix 4) is the *test-stability* half. See
       [L-028](lessons.md#l-028). The HWND golden's date node was
       hand-edited (not `--grep`-refreshed) because Radix `useId`
       AutomationIds in the UIA tree are render-sequence-dependent
       and a scoped refresh captures different IDs — also L-028.
    Verification: composition lane **157 passed / 0 failed / 31
    skipped** (one re-run of the warmup-sensitive
    `a11y-uia-composition-reachable` backbone spec — a pre-existing
    load-dependent flake, not a golden) and HWND lane **132 passed
    / 0 failed / 56 skipped** — both match the pre-drift baselines
    from the MT-12 ship. Re-verified after the fix-4 rebuild at
    HEAD with commit date 2026-05-27, so the normalizer (not a
    coincidental date match) is what's carrying it.
    Four new lessons captured: [L-025](lessons.md#l-025) MSBuild
    via PowerShell, [L-026](lessons.md#l-026) byte-exact snapshots
    need `text eol=lf`, [L-027](lessons.md#l-027) test wrapper
    must forward unknown CLI args, [L-028](lessons.md#l-028)
    commit-date build stamps must be normalized as volatile + Radix
    `useId` goldens can't be `--grep`-refreshed. L-025 surfaced as
    a Phase A incident (Git Bash mangling MSBuild `/switch` args)
    that doesn't appear in the bug itself but was discovered while
    diagnosing it.

## Prior session work (2026-05-25 — undo/perform polish chain, retained for context)

- **undo/perform snap-restore.** Real `BridgeDispatcher::ApplyUndoSnapshot`
  + head-of-history auto-cap in the handler reconciles new-UI's
  PRE-mutation captureUndo convention with `UndoStack`'s POST-mutation
  cursor invariant. No 22-site refactor needed. NT-5 atomicity test
  un-fixme'd; Playwright native moved from 102 + 27 + 0 to **103 +
  26 + 0**. Mock returns `{applied:false}` (documented no-op).
- **Content-compare dirty bit.** New `m_savedSnapshot` byte buffer on
  BridgeDispatcher; refreshed on `file/new` + `file/open` + `file/save`
  + `file/save-as` success. ApplyUndoSnapshot does
  `SetDirty(buf != m_savedSnapshot)` instead of unconditional
  `SetDirty(true)`. Ctrl+Z back to saved content now clears the
  title-bar/save-prompt dirty gate. Bypasses legacy
  `UndoStack::MarkSaved/IsAtSavedState` (which doesn't fit new-UI's
  PRE-mutation captureUndo).
- **Boot-state baseline.** `m_savedSnapshot` seeded in `BindHostState`
  via new `ResetSavedBaseline()` method on `BridgeDispatcher`, called
  from `HostWindow.cpp` right after the initial ParticleSystem is
  bound. Ctrl+Z back to the boot-state content now clears dirty
  without requiring a File → New first.
- **Edit menu Undo/Redo enable-state.** `canUndo` + `canRedo` fields
  added to `EngineStateDto` (bridge-schema). C++ snapshot builder
  populates them with auto-cap-aware logic via new
  `BridgeDispatcher::ComputeCanUndo()` helper. React MenuBar binds
  `disabled={!state?.canUndo}` / `disabled={!state?.canRedo}` on
  the items. Mock defaults to `false`/`false` (browser-mode undo is
  a no-op).

Three commits in the prior session:
[`e750142`](https://github.com/DrKnickers/new-particle-editor/commit/e750142)
(undo/perform snap-restore — Ctrl+Z / Ctrl+Shift+Z rewinds the
ParticleSystem; un-fixme's the NT-5 atomicity Playwright test),
[`fb57acc`](https://github.com/DrKnickers/new-particle-editor/commit/fb57acc)
(content-compare dirty bit — Ctrl+Z back to saved content clears
the asterisk via `m_savedSnapshot` byte buffer), and a TODO-HASH
commit (boot-state baseline init in BindHostState + Edit menu
Undo/Redo enable-state via canUndo/canRedo on engine snapshot).
Test counts at end of prior session: vitest **343 / 343**,
Playwright HWND **103 / 26 / 0** (was 102 / 27 / 0; un-fixme'd
NT-5 atomicity moved skip → pass), MSBuild Debug + Release x64
clean via .sln.

## Pre-undo/perform session prior state (retained for context)

`origin/lt-4` tip was `2f793c1` before this session — the L-023
docs commit on top of the [NT-5] follow-up chain. Three commits
from the post-Phase-3 session preceded this work:
[`84927d3`](https://github.com/DrKnickers/new-particle-editor/commit/84927d3)
(lessons retro-doc L-019/L-020/L-021/L-022 + HANDOFF retraction),
[`5d4a9ba`](https://github.com/DrKnickers/new-particle-editor/commit/5d4a9ba)
([NT-5] engine-side single-member link-group enforcement — the
ROADMAP §1.1 item shipped), and
[`b2abe27`](https://github.com/DrKnickers/new-particle-editor/commit/b2abe27)
([NT-5] follow-up: native verification, load-time fixture spec,
`--gen-nt5-fixture` CLI tool, undo-round-trip `test.fixme`). One more
docs commit on top with L-023 (MSBuild `$(SolutionDir)` lesson) +
the prior HANDOFF refresh + the post-NT-5 next-session prompt.

**Session-end state:** Phase 3 fully shipped (5 stages), Phase 3
documentation hygiene closed via the retro-doc dispatch, [NT-5] ROADMAP
item shipped end-to-end (data layer matches render layer for link
group enforcement), worktree cleanup recovered ~1.2 GB (3 registered
worktrees removed, 22 stale claude/* session branches deleted,
20 [gone] remote-tracking refs pruned, local `lt-4` ref FF'd from
the long-stale `339ab95` to current tip), 5 new lessons.md entries
(L-019 through L-023). Local `master` in the main worktree at
`C:\Modding\Particle Editor` is 4 commits behind origin/master and
needs `git pull --ff-only` over there (out of reach from this
session's worktree).

**Test counts at handoff:** vitest **343/343** (was 338; +5 NT-5
mock contract tests, 1 existing test updated for the path-3 contract
change). Playwright native HWND baseline (default dist/, no env
vars): **102 passed + 27 skipped + 0 failed** (was 99 + 26 + 0; +3
new tests pass — 2 NT-5 mutation paths + 1 load-time fixture; +1
NT-5 atomicity test sits in the 27 skipped as `test.fixme(...)`
pending the `undo/perform` snap-restore implementation). MSBuild
Debug + Release x64 clean (preexisting LIBCMTD warning unchanged).
Per [L-023](lessons.md#l-023--invoke-msbuild-against-the-sln-not-the-vcxproj-directly-when-the-project-uses-solutiondir-macros-in-include--library-paths),
build invocation MUST be against `.\ParticleEditor.sln`, not the
.vcxproj.

## What shipped this session

- **[MT-11] Phase 3 retro-doc** — four new lessons.md entries:
  L-019 (DXSDK linker-twin), L-020 (spike-vs-production const
  audit), L-021 (verify rendered geometry — combined-math edition),
  L-022 (handoff-claim verification). The HANDOFF "Known
  follow-ups" item 2 (spurious "latent ResetParameters projection-
  push bug") was retracted after pre-flight verification revealed
  it as a phantom claim.
- **[NT-5] engine-side single-member link-group enforcement** —
  `BridgeDispatcher::EnforceSingleMemberLinkGroups()` helper + 3
  call sites (linkGroups/set-membership, emitters/delete, file/open
  load-time sweep); JS-mock parallel; 5 new vitest tests + 1
  updated for path-3 contract change; 2 new Playwright tests; 1
  fixme'd undo round-trip test; load-time `.alo` fixture +
  `--gen-nt5-fixture` CLI tool in main.cpp for regeneration.
- **L-023 MSBuild `$(SolutionDir)` lesson** — discovered during
  NT-5 verification. The right invocation form is
  `MSBuild .\ParticleEditor.sln`, not the .vcxproj.
- **Worktree cleanup** — 3 worktrees + 10 orphan directories
  removed; 22 `claude/*` session branches + 20 `[gone]`
  remote-tracking branches deleted; local lt-4 FF'd to current tip;
  remote tracking refs pruned via `git fetch --prune`.

## Prior session work (pre-this-session, retained for context)

[MT-11] Phase 3 **Stages 0–5 all shipped on `origin/lt-4`.** Stage 5 (scene-rect transform on engine visual) closes Phase 3: under composition mode, React-side `layout/scene-rect` dispatches now wire into both `Compositor::SetEngineVisualTransform` (DComp clip to scene-rect on screen) and `Engine::SetSceneViewport` (engine viewport + per-pixel-FoV projection scoped to scene-rect). User-observable result: chrome panels no longer bleed engine pixels, and pane / window resize "cleanly reveals more of the scene" rather than distorting existing content. Variant **B-γ** with per-pixel-FoV-vs-current-RT keeps `fovY ≤ 45°` always — engine renders at-or-LESS world than pre-Stage-5 across all window sizes. Composite rate ~70 fps at 3440×1440 (Stage 4's 79.1 mean baseline, within parity).

**Test counts at handoff:** vitest **338 / 338** · Playwright native HWND baseline **99 passed + 26 skipped + 0 failed** (default dist/, no env vars; new dxgi-scene-rect + Stage 4's dxgi-* + composition-hosting specs all auto-skip cleanly) · composition mode **122 passed + 3 skipped + 0 failed** (composition-built dist/ + `ALO_WEBVIEW2_HOSTING=composition` + `ALO_VIEWPORT_TRANSPORT=canvas-jpeg`) · MSBuild Debug + Release x64 clean · tsc -b 0 errors.

**Repo state at handoff:**

| | |
|---|---|
| **`origin/lt-4` HEAD** | (post-FF target) Stage 5 T8 commit chain on top of `936d937` |
| **Session branch** | `claude/affectionate-euclid-5d1c8f`, T1-T8 committed |
| **Working tree** | clean |
| **Phase 2 status** | Shipped at `4896aa7` behind `ALO_VIEWPORT_TRANSPORT=canvas-jpeg`. Default new-UI uses arch-A (visible popup with AlphaCompositor + UpdateLayeredWindow). |
| **Phase 3 status** | **All 5 stages shipped.** Stages 0 (spike + GO), 1 (D3D9Ex), 2 (shared-handle infrastructure), 3 (composition hosting), 4 (DXGI engine bridge), 5 (scene-rect transform on engine visual). Sub-stage 4e (first-frame ClearRenderTargetView guard) deferred — not observed during smoke. |
| **Stage 5 sub-stages** | T1 (Compositor::SetEngineVisualTransform) + T2 (LayoutBroker DComp seam) + T3 (Engine::SetSceneViewport B-γ) + T4 (LayoutBroker fan-out) + T5 (HostWindow attach + seed + teardown) + T6 (corrections + smoke) + T7 (Playwright spec) + T8 (docs). 8 commits on session branch. |

## Stage 5 — what shipped, in plain English

Under `ALO_WEBVIEW2_HOSTING=composition` + `ALO_VIEWPORT_TRANSPORT=canvas-jpeg`:

- React's `layout/scene-rect` bridge dispatch (already used to drive AlphaCompositor's band-mask + scene-rect cache) now also routes into `Engine::SetSceneViewport` and `Compositor::SetEngineVisualTransform` via the new LayoutBroker fan-out, gated on `m_dcompCompositor != nullptr` (the composition-mode signal per the sub-plan's R9 mitigation c).
- **Engine viewport scoping (B-γ).** `Engine::SetSceneViewport(x, y, w, h)` stashes the rect, recomputes `m_projection` at per-pixel-FoV with reference = current `BackBufferHeight` (`fovY = 45° × sceneH / RT_H` — sceneH ≤ RT_H always, so fovY ≤ 45°), pushes the new projection to the device via `SetTransform(D3DTS_PROJECTION, ...)`, recomputes `m_viewProjection = m_view * m_projection` for shader-effect consumers. `Engine::Render`'s scene pass scopes `SetViewport` to the scene-rect AFTER the existing full-RT `Clear` (the **D12 ordering rule** — Clear at default viewport ensures m_pSceneTexture outside scene-rect is filled with engine clear color every frame, eliminating post-process bleed across the scene-rect boundary). Post-process passes (bloom, distort) restore the cached viewport so they still operate at full-RT-sized intermediates.
- **DComp clip transform.** `Compositor::SetEngineVisualTransform(x, y, w, h)` sets the engine visual to `SetOffsetX/Y(0, 0) + SetClip({x, y, x+w, y+h})` (clip in ABSOLUTE host-client coords since the visual's local-coord space equals the parent root visual's coord space). Defaults to `immediate=false`, which queues the transform on `Impl::pending*` fields; `CompositeEngineFrame`'s tail applies it after `Present1` so swapchain content + DComp clip arrive at the same DWM cycle (the **deferred-clip mechanism**). Boot-time seed callers pass `immediate=true` to bypass the queue.
- **Engine::Reset re-apply (R8).** After `ResetParameters` rebuilds `m_projection` at full-RT-aspect on window resize, `Engine::Reset`'s tail re-fires `SetSceneViewport` with the cached state so the per-pixel-FoV projection survives the device reset.
- **HostWindow attach seed.** `OnCompositionControllerReady` calls `layout.SetCompositor(m_compositor.get())` after `AttachEngineVisual` succeeds + seeds initial DComp clip + engine viewport at full-client values (so per-pixel-FoV computes `fovY = 45°` at attach, matching pre-Stage-5 projection exactly).
- **Symmetric teardown.** WM_DESTROY + `WM_APP_COMPOSITION_FALLBACK` clear `layout.SetCompositor(nullptr)` before `m_compositor.reset()` so a late SetSceneRect dispatch can't dereference a freed Compositor.

## What's verified end-to-end (T6 smoke + T7 spec)

Manual smoke (user-driven during T6, four bug-iteration corrections shaped the final design):

- ✓ Chrome panels no longer bleed engine pixels (engine fills the scene-rect sub-region of its RT; DComp clip carves the scene-rect quadrant on screen).
- ✓ Pane resize reveals more world content at the widened edges; existing world content stays at the same pixel position + scale (per-pixel angular extent constant via per-pixel-FoV).
- ✓ Window maximize / restore tracks cleanly through Engine::Reset → R8 re-apply.
- ✓ Click into preview no longer causes "aspect snap to correct" (projection now pushed to device synchronously on SetSceneViewport instead of relying on next SetCamera).
- ✓ Idle FPS at maximized 3440×1440: ~70 fps composite rate (Stage 4 baseline 79.1 mean — close to parity).
- ✓ User verdict: "wow that's fantastic. that resize behavior is perfect."

Automated regression gate (Stage 5 T7, 4 new dxgi-scene-rect assertions):

- ✓ Boot seed produced [COMP-engine-transform] with non-degenerate clip
- ✓ `layout/scene-rect` dispatch produces matching `[COMP-engine-transform] clip=(L,T,R,B)` line
- ✓ Three sequential dispatches produce three transform lines in order
- ✓ No `[COMP-engine-fail]` lines from SetEngineVisualTransform / ApplyTransform

## Known follow-ups (out of scope for Stage 5)

Surfaced during Stage 5 work but not part of the Stage 5 ship:

1. **Stage 4 sub-stage 4e — first-frame ClearRenderTargetView guard.** Sub-plan queued this; not observed during smoke; ship-if-surfaces.
2. **`canvas-architecture.spec.ts` test.fixme markers (L-012 instrumentation issue).** Pre-existing Phase 2 fault; three documented fix approaches.
3. **Test harness env-var pre-flight check.** Stage 4f surfaced — harness should fail-fast or auto-rebuild on ALO_*/VITE_* mismatch.

> **Future dispatches picking up any of these:** apply [L-022](lessons.md#l-022--handoff-notes-and-next-session-prompts-carry-claims-not-facts--verify-against-current-code-before-any-claim-enters-a-dispatchs-plan)'s
> verification rule before committing to scope. The list above has not
> been re-audited as part of the L-022 sweep — only the spurious
> `ResetParameters` claim was verified and retracted. Each remaining
> item is a *plausible* follow-up at time of writing, not a *verified*
> one.

## Resolved follow-ups (post-Stage-5)

1. **Lessons retro-doc (L-019 / L-020 / L-021 / L-022 / L-023).**
   Shipped 2026-05-25. L-019 (DXSDK linker-twin), L-020 (spike-vs-
   production const audit), L-021 (verify rendered geometry —
   combined-math edition) distilled from CHANGELOG Stage 4 + Stage 5
   prose. L-022 (handoff-claim verification) surfaced by the same
   dispatch's pre-flight (see Retractions below). L-023 (MSBuild
   `$(SolutionDir)` resolution) added later in the same session
   after the NT-5 dispatch's MSBuild verification surfaced the
   build-environment behaviour.

2. **[NT-5] engine-side single-member link-group enforcement.**
   Shipped 2026-05-25 in the post-retro-doc dispatch. ROADMAP §1.1
   item. Mutation handlers (`linkGroups/set-membership`,
   `emitters/delete`) and `file/open` all run through the new
   `BridgeDispatcher::EnforceSingleMemberLinkGroups()` helper. Mock
   parallel in `enforceSingleMemberLinkGroups()` chained into the
   mock-state's mutation helpers. Five new vitest tests + 3 new
   Playwright tests verifying mutation paths + load-time sweep
   against the C++ host. Pre-NT-5 `.alo` files self-correct on load
   without dirtying. The atomicity contract (captureUndo ⟶ sweep)
   is encoded as a `test.fixme(...)` pending the
   `undo/perform` snap-restore implementation. Saved-file fixture
   at [`web/apps/editor/tests/fixtures/nt-5-singleton.alo`](../web/apps/editor/tests/fixtures/nt-5-singleton.alo)
   regeneratable via `ParticleEditor.exe --gen-nt5-fixture <path>`.

## Retractions

The pre-Stage-5 HANDOFF flagged a "**latent projection-not-pushed bug
in `ResetParameters`**" as a single-line follow-up fix. Pre-flight
verification during the 2026-05-25 post-Phase-3 dispatch dissolved
the claim: [`Engine::ResetParameters`](../src/engine.cpp:1654) ends
with `SetCamera(m_eye)`, and
[`Engine::SetCamera`](../src/engine.cpp:998) unconditionally executes
`SetTransform(D3DTS_PROJECTION, &m_projection)` at line 1014 — has
done since commit `0d352ae` (Initial import). The "latent bug" was
a phantom produced by reasoning by analogy from the genuine Stage 5
`SetSceneViewport` bug (which legitimately rebuilt `m_projection`
without pushing) to a parallel in `ResetParameters` that doesn't
hold (because `ResetParameters` calls `SetCamera`, which
`SetSceneViewport` doesn't). The verification finding and the
structural process rule live at
[`lessons.md` L-022](lessons.md#l-022--handoff-notes-and-next-session-prompts-carry-claims-not-facts--verify-against-current-code-before-any-claim-enters-a-dispatchs-plan).
**No code change was made for the retracted item; none was needed.**

## Stage 5 commits (session branch)

```
T1 — feat(LT-4): [MT-11] Phase 3 Stage 5 T1 — Compositor::SetEngineVisualTransform
T2 — refactor(LT-4): [MT-11] Phase 3 Stage 5 T2 — LayoutBroker DComp seam + GetSceneRect
T3 — feat(LT-4): [MT-11] Phase 3 Stage 5 T3 — Engine::SetSceneViewport + Render hook + Reset re-apply (B-γ)
T4 — feat(LT-4): [MT-11] Phase 3 Stage 5 T4 — LayoutBroker scene-rect → Compositor + Engine
T5 — feat(LT-4): [MT-11] Phase 3 Stage 5 T5 — HostWindow attach + seed + teardown
T6 — fix(LT-4): [MT-11] Phase 3 Stage 5 T6 — corrections + smoke evidence
T7 — test(LT-4): [MT-11] Phase 3 Stage 5 T7 — dxgi-scene-rect Playwright gate
T8 — docs(LT-4): [MT-11] Phase 3 Stage 5 T8 — CHANGELOG + HANDOFF refresh (this commit)
```

T6 contains the lion's share of the work — four user-driven correction iterations (displacement coord-space, aspect distortion, blue-bar lag, snap-on-click projection-push) reshaped T1's and T3's design before stabilization. See [`tasks/stage-5-smoke-result.md`](stage-5-smoke-result.md) for the iter-by-iter bug log.

## Phase 3 closing notes

With Stage 5 shipped, Phase 3's full scope ("migrate engine rendering to architecture C via DComp") is delivered:

- **Stages 0-2**: Spike + GO decision, D3D9Ex migration, shared-handle texture infrastructure
- **Stage 3**: WebView2 composition hosting migration (`ALO_WEBVIEW2_HOSTING=composition`)
- **Stage 4**: DXGI engine bridge (engine pixels reach screen via shared texture → D3D11 alias → DXGI composition swapchain → DComp engine visual)
- **Stage 5**: Scene-rect transform on engine visual (chrome panel backgrounds visible; pane/window resize reveals more scene without distortion)

Next dispatch could pick up: (a) Phase 3 close-out (Stage 3h a11y suite + Stage 3i final acceptance smoke if not yet done); (b) next-roadmap-item from [`ROADMAP.md`](../ROADMAP.md), bearing in mind that the roadmap doc redirects to [`post-audit-followups.md`](post-audit-followups.md) for P1 drainage before pulling fresh roadmap work. The lessons retro-doc previously suggested as (b) shipped 2026-05-25; the "latent `ResetParameters` projection push fix" previously suggested as (c) was retracted as a non-bug — see Retractions above and [`lessons.md` L-022](lessons.md#l-022--handoff-notes-and-next-session-prompts-carry-claims-not-facts--verify-against-current-code-before-any-claim-enters-a-dispatchs-plan).

## Stage 4 — what shipped, in plain English

Under `ALO_WEBVIEW2_HOSTING=composition` + `ALO_VIEWPORT_TRANSPORT=canvas-jpeg` + a `dist/` built with the matching `VITE_*` env-var pair:

- Engine renders its scene to the AlphaCompositor's shared D3D9Ex texture (unchanged from Stage 2).
- Compositor stands up a parallel D3D11 device, opens that texture via `OpenSharedResource`, creates a DXGI `CreateSwapChainForComposition` back buffer, builds a DComp engine visual, inserts it BEHIND the Stage 3 WebView2 visual via `AddVisual(engine, TRUE, nullptr)` (the MSDN-naming inversion at L-016 / dxgi_spike.cpp:488).
- Per frame: `engine->Render()` → `engine->IssueEndFrameQuery()` (D3D9 event-query marker) → `engine->WaitEndFrameQuery()` (spin on GetData, spike's 100k cap) → `Compositor::CompositeEngineFrame()` does the D3D11 `CopyResource(backBuffer, sharedAlias)` → `swapChain->Present1(0, 0, &empty)`. DComp picks up the new content on the next composition cycle.
- **Resize robustness via lazy per-frame handle check.** Every AlphaCompositor::Resize creates a new shared HANDLE; CompositeEngineFrame compares against cached, calls RefreshEngineSharedHandle on mismatch which drops the old D3D11 alias + re-opens + ResizeBuffers on the swapchain. Single-frame stutter at resize boundary, steady-state resumes.
- **Multi-GPU LUID guard.** `Engine::GetAdapterLuid()` (new accessor) compared against the D3D11 device's adapter LUID via IDXGIDevice → GetAdapter → GetDesc. Mismatch returns `DXGI_ERROR_GRAPHICS_VIDPN_SOURCE_IN_USE`, skips engine attach, composition mode stays intact with chrome-only viewport (sub-plan §3.8 / D7 — explicit no-chain-into-F8: engine-attach failures don't trigger the chrome-itself-broken fallback).
- **ViewportSlot composition opt-out (4c.1).** Build-time `VITE_WEBVIEW2_HOSTING` env var mirrors runtime `ALO_WEBVIEW2_HOSTING`. When set to `composition`, the canvas-jpeg `<img>` element's `viewport/frame-ready` subscription is SKIPPED — `<img>` stays empty/transparent, DXGI engine pixels show through the WebView2 visual where it's transparent. The `<canvas>` overlay's input listeners stay active either way (Phase 2's input bridge is still the engine input pathway).
- **DXGI ALPHA_MODE_IGNORE (4d.1).** Originally PREMULTIPLIED per spike (its workload was D3DClear → clean alpha). Production engine's particle blend states leave the RT alpha in arbitrary states the engine never cared about (legacy arch-A used stamped popup alpha, not RT alpha). Under PREMULTIPLIED, DComp's compositing math darkened additive sprites over alpha-blended smoke. IGNORE matches legacy semantics.

## What's verified end-to-end

Manual smoke (user-driven during 4c/4d/4d.1):
- ✓ Engine pixels visible behind transparent canvas via DXGI
- ✓ Shift+click in viewport spawns cursor-bound particle instance correctly
- ✓ Camera drag (LMB/MMB/RMB), wheel zoom, click in viewport — all interactive
- ✓ Loaded `.alo` file with smoke + additive fire emitters renders correctly (no dark-rectangle artifacts post-4d.1)
- ✓ Window resize: engine pixels track new viewport size without freezing
- ✓ Repeated resize-then-interact cycles work

Automated regression gate (Stage 4f, 10 new dxgi-* assertions, all PASS under composition mode):
- ✓ `dxgi-transport.spec.ts` (7 tests) — `[COMP-engine-attach]` present + composite count grows + handle stability + no failure lines + format / bind / share flags correct
- ✓ `dxgi-resize-stress.spec.ts` (2 tests) — 50 layout/viewport-rect cycles + targeted resize, both pass
- ✓ `dxgi-perf.spec.ts` (1 test) — mean FPS 79.1 over 10s (floor: 30)

## Known follow-ups (out of scope for Stage 4 — Stage 5 has since shipped, see top of file)

Surfaced during Stage 4 work but not part of the Stage 4 ship:

1. **`canvas-architecture.spec.ts` test.fixme markers (L-012 instrumentation issue).** Pre-existing Phase 2 fault: spec proxies `window.bridge.request` (TestHostBridge under `--test-host`) but ViewportSlot dispatches via its `bridge` prop (NativeBridge from App.tsx's useMemo). Different objects. Proper fix is rewiring the spec to use host-side log inspection (the dxgi-transport pattern) OR exposing NativeBridge on window.bridge in test mode OR using a Playwright init-script to replace React's bridge prop. Three approaches documented in the spec's FIXME comment block.
2. **Stage 4 sub-stage 4e — first-frame ClearRenderTargetView guard.** Sub-plan queued this as defence-in-depth against uninitialized back-buffer flash on first attach. Not observed during user-driven smoke; ship-if-surfaces. Implementation would be a 5-line addition to Compositor::AttachEngineVisual after CreateSwapChainForComposition: `D3D11_RENDER_TARGET_VIEW_DESC` → `CreateRenderTargetView` → `ClearRenderTargetView(rtv, {0,0,0,0})` → release the RTV.
3. **L-019 (DXSDK linker-twin) + L-020 (spike-config-vs-production audit) candidate.** Stage 4 surfaced two lesson patterns worth retro-documenting alongside L-016/L-017/L-018. The DXSDK lib-path shadowing on `CreateDXGIFactory2` (resolved via `CreateDXGIFactory1` + QI) is L-016's exact twin on the linker side. The PREMULTIPLIED-vs-IGNORE alpha pivot is "audit every const/enum the spike picked AGAINST the production workload's data flow — don't assume spike choices are correct for production just because the spike was a passing reference."
4. **Test harness env-var pre-flight check.** The harness should fail-fast (or auto-rebuild) when runtime ALO_* env vars and dist/ build-time VITE_* env vars are inconsistent. Surfaced during Stage 4f when my own composition-mode smoke ran against a default-built dist/ (and vice versa). Pragmatic fix: harness reads dist/ manifest for baked env vars + compares against process.env, errors out on mismatch.

## How to run modes locally ([MT-12])

**Default (architecture C, DXGI composition + DComp engine visual)** — no env vars needed, no special build:

```powershell
cd web
pnpm --filter @particle-editor/editor build   # default dist = composition mode
cd ..
./x64/Debug/ParticleEditor.exe --new-ui       # default runtime = composition mode

# OR run native tests (composition lane, the new default; expects ~157/0/31)
cd web
pnpm --filter @particle-editor/editor test:native
```

**Opt-out to legacy mode (architecture A, AlphaCompositor popup + HWND-hosted WebView2)** — single env var, both at build time and runtime:

```powershell
# Build dist/ in legacy mode
cd web
$env:VITE_HOSTING_MODE = "legacy"
pnpm --filter @particle-editor/editor build
Remove-Item Env:VITE_HOSTING_MODE   # clear so subsequent builds default to composition

# Launch in legacy mode
$env:ALO_HOSTING_MODE = "legacy"
cd ..
./x64/Debug/ParticleEditor.exe --new-ui

# OR run native tests (legacy lane, opt-in; expects ~132/0/56)
cd web
pnpm --filter @particle-editor/editor test:native:legacy
```

**Mode-mismatch diagnosis.** If the viewport doesn't render correctly (placeholder span where engine pixels should be, or DXGI engine showing behind an empty `<canvas>`), the dist/ build-mode and runtime mode disagree. Both modes log their state on startup; grep the editor's stderr / host.log for `[host] hosting mode:` (runtime) and the browser console / DevTools for `[mode] React build mode:` (build) — they should agree. To fix: either rebuild dist/ in the matching mode or set/unset `$env:ALO_HOSTING_MODE` to match the dist.

**Test-harness mode gate (HANDOFF item 4, 2026-05-29).** `pnpm test:native` / `test:native:legacy` (and the `a11y*` aliases) now refuse to run when the baked `dist/` mode doesn't match the lane — they read `dist/build-meta.json` (stamped by `buildMetaPlugin` in `vite.config.ts`) and fail-fast with the exact rebuild command *before* launching the host. So a wrong-mode `dist/` can no longer silently produce a meaningless pass/fail. Pass `--rebuild` to have the harness build the matching `dist/` itself and proceed. A `dist/` with no marker (pre-gate build, or never built) fail-fasts the same way — rebuild once to stamp it.

**Pre-MT-12 env vars retired.** `ALO_WEBVIEW2_HOSTING`, `ALO_VIEWPORT_TRANSPORT`, `VITE_WEBVIEW2_HOSTING`, `VITE_VIEWPORT_TRANSPORT` no longer have any effect. The boot-time host will log a deprecation warning if any is set in the environment. Use `ALO_HOSTING_MODE` / `VITE_HOSTING_MODE` instead.

---

## Autonomous queue execution — final summary (2026-05-24)

**Six PRs opened, one slot deferred.** All branches pushed to origin.

| PR | Slot | Target | Status | Items |
|---|---|---|---|---|
| **#86** | 1 | master | open | F1 (DoSaveFile data-loss), F2 (ChunkReader::readString), F3 (chunk depth overflow), F4 (cyclic emitter graph), F5 (uint16 particle index wrap) |
| **#87** | 2 | lt-4 | open | F6 (TextureManager cache vs D3D9Ex Reset) |
| **#88** | 3 | lt-4 | open | F8 (composition controller async-failure fallback / Stage 3h) |
| **#89** | 4 | master | open | F12 (WM_PAINT BeginPaint/EndPaint), F13+F14 (ReadAndRelease helper, 4 sites), F15 (Emitter copy-ctor m_instances), F16 (blend mode 6/7 break) |
| **#90** | 5 | lt-4 | open | G2 (DispatchInternal exception safety), G4 (HostBridgeProxy JSON envelope). G1 + G3 deferred (see PR body) |
| **#91** | 6 | lt-4 | open | F10 (WM_MOUSELEAVE), F11 (env-var warning), G5 (WebMessageReceived token), G6 (DPR listener leak), G8 (CreateSolidBrush leak). F9 + G7 deferred (see PR body) |

All six PRs built clean on both MSBuild Debug|x64 and Release|x64. LNK4098 LIBCMTD warning baseline unchanged. Each PR has a plan + per-fix review doc under `tasks/post-audit-slot<N>-*.md` for traceability.

### Deferred items (not shipped this run)

Documented in their respective PR bodies + slot docs; summary here for visibility:

- **G1** (emitters/import-from-file native handler, PR #90) — needs UX call on parent-child preservation when selection includes subtrees, link group remapping across documents, undo granularity. Current UX is dead-end-with-inline-error; not data-loss.
- **G3** (17 `sendOk({ok:false})` → `sendErr` migration, PR #90) — breaking change for any JS caller that awaits without `.catch()`. Mechanical C++ migration is straightforward; needs JS-side caller audit before shipping.
- **F9** (hardcoded SDK `10.0.26100.0` in vcxproj, PR #91) — needs cross-SDK CI verification. Only one SDK installed on this box.
- **G7** (`AlphaCompositor::Resize` transactional rebuild, PR #91) — P3 ("rare on healthy systems"); the fix is a ~50 LoC refactor worth its own focused PR.
- **Slot 7** (bridge capability-manifest test) — the followups doc was specific that the test must target the real C++ dispatcher (not the mock — that's already covered by `bridge-contract.test.ts`). Doing so via Playwright is substantial design work with open questions about what counts as "implemented" (`ok:false, error:"particle system not bound"` — implemented or not?), parametrization for kinds that need live state, and the deferral exception list maintenance pattern. Better deferred than rushed.

### What's needed before merging the open PRs

User-driven smoke testing for each PR. The PR bodies list the specific test scenarios. Pre-handoff discipline was held to the build-clean-plus-code-walk bar; runtime confirmation is yours.

### Worktrees left behind

Each slot ran in its own worktree under `.claude/worktrees/post-audit-*`. The session branch (`claude/zen-haibt-fd8521`) is also still there. Clean up at your leisure with `git worktree remove`.

### Lessons from the run

Beyond L-018 (verify before acting), two new patterns surfaced:

1. **Direction-of-divergence misread** (mid-session correction commit `e6f3e92`): treating a `git log A..B` result as "B is ahead of A" without confirming the reverse direction was empty. With diverged refs you need both `A..B` AND `B..A` to know which way it points. Candidate for a lessons.md entry if this kind of misread recurs.
2. **Per-slot review documentation dominates wall-clock**, not LoC. Each slot took roughly the same time regardless of code size because the planning + verification + review docs were the bottleneck. Worth knowing when sequencing future autonomous runs.

---

## Autonomous queue execution — correction: original "blocked" note was based on a misread; FF'd cleanly (2026-05-24, follow-up)

The "Slot 2+ blocked on lt-4 reconciliation" note immediately below was wrong on the direction of divergence. After fetching origin/lt-4, `git log origin/lt-4..lt-4` returned EMPTY — local lt-4 (`339ab95`) is **behind** origin/lt-4 by ~100 commits, not ahead. The 10 commits I described as "your in-progress unpushed work" are all *in origin already*; they're just absent from the stale local lt-4 branch ref. The `92ed1db` skydome fix referenced in F7 is on origin/lt-4 like the followups doc already claimed.

The push rejection was because `git push origin lt-4:lt-4` tried to rewind origin/lt-4 to the older local-lt-4 ref. Not a "diverged unpushed work" scenario — just a stale local pointer.

**What actually happened.** Session branch `claude/zen-haibt-fd8521` is a clean fast-forward of origin/lt-4 — the docs commit (`674d6e6`) sits directly on top of origin/lt-4's tip (`d3f0fae`). Standard end-of-session FF flow applies, no reconciliation needed. Pushed `claude/zen-haibt-fd8521` → origin/lt-4 as FF, which advances origin/lt-4 by 2 commits (audit-infrastructure docs + the original "blocked" handoff note + this correction).

**Note for future sessions:** when describing branch divergence, always verify direction with BOTH `git log A..B` AND `git log B..A`. The first being non-empty doesn't tell you which side is ahead — only the asymmetry between the two does. Candidate for a `lessons.md` entry if this kind of misread recurs.

## Autonomous queue execution — Slot 1 SHIPPED, Slot 2+ BLOCKED on lt-4 reconciliation (2026-05-24) [SUPERSEDED — see correction above]

Started the autonomous-prompt queue execution per `tasks/post-audit-followups.md` "Suggested ordering."

**Completed:**
- **Setup** — committed audit-infrastructure docs (L-018, `post-audit-followups.md`, HANDOFF/ROADMAP pointers) to session branch `claude/zen-haibt-fd8521` at commit `674d6e6`.
- **Slot 1 (Master P1s F1–F5)** — branched `post-audit/master-p1s` off `master` (`b28f624`) in a separate worktree. Implemented all five fixes, built clean (Debug|x64 + Release|x64), opened **[PR #86](https://github.com/DrKnickers/new-particle-editor/pull/86)** with plan + per-fix review doc at `tasks/post-audit-slot1-master-p1s.md`.

**Blocked on Slot 2 (lt-4 reconciliation required):**

Local `lt-4` is at **`339ab95`**, ahead of `origin/lt-4` (`d3f0fae`) by 10 commits — your in-progress work that hasn't been pushed:

```
339ab95 feat(LT-4): curve editor polish — lock-to, axis labels, theme grid, robust spinners, spawner bg fix
92ed1db fix(LT-4): add m_pSkydomeEffect OnLost/OnReset to Engine::Reset — ground-texture lockup fixed
8d13dea test(LT-4): mark tools.spec.ts:192 test.fixme — engine bug filed
02e5af8 docs(LT-4): HANDOFF + CHANGELOG refresh — Phase 1 + 2 shipped, focus-channel restore landed
3cd840a feat(LT-4): hybrid focus-channel curve editor — restore edit surface
83ee7a5 feat(LT-4): Phase 2.7 — viewport pill + engine/set/leave-particles bridge
329c595 feat(LT-4): Phase 2.6 — curve editor moves to always-on bottom 260px
0fd093d feat(LT-4): Phase 2.5 — left panel restack with .panel chrome + .form-row grid
17768b6 feat(LT-4): Phase 2.4 — Spawner permanent right column
2759c27 chore(LT-4): remove dead Background/Ground Texture entries from View menu
```

Note: `92ed1db` is the skydome OnLost/OnReset fix that `tasks/post-audit-followups.md` F7 documents as "already fixed on lt-4." Confirms — but the fix is in *local* lt-4, not on origin yet.

My session branch (`claude/zen-haibt-fd8521`) was branched from `d3f0fae` (the session-start origin/lt-4 tip) and is 1 commit ahead of THAT, but those 10 lt-4 commits aren't in it. The session-start system reminder showed origin/lt-4 as the upstream, which is why I branched from there.

**Why I stopped autonomously:** CLAUDE.md's Branch workflow §"End-of-session flow for LT-4 dispatches" says explicitly: *"If the FF fails, STOP and reconcile... Don't paper over it with a merge commit or a rebase without understanding what diverged."* Three plausible reconciliation paths exist; the right one depends on intent for those 10 commits:

1. **Push local lt-4 → origin first, then rebase session branch onto it.** Treats local lt-4 as ground truth. Subsequent LT-4 slot branches (Slots 2/3/5/6/7) branch from updated origin/lt-4. Most natural if those 10 commits were ready-to-ship work that just lacked a `git push`.
2. **Cherry-pick the audit-infrastructure commit (`674d6e6`) onto local lt-4, then push.** Same outcome as #1, different mechanic. Cleaner history if the rebase would be noisy.
3. **Hold the 10 local lt-4 commits private for now; carry on the audit-followups queue against `origin/lt-4` (`d3f0fae`).** Defers reconciliation but means LT-4 slot PRs will be reviewable against a tip that's stale relative to your local. Probably not what you want.

**Recommended: option 1**, but I'm not going to act on this without your call. The 10 commits include real feature work (Phase 2.4–2.7, curve editor polish, focus-channel restore) and an authoring decision about when they ship.

**Other observable state from the worktree survey:**
- ~20 stale `claude/<adjective>-<name>-XXXXXX` branches accumulated across past sessions, most marked `[behind N]` against their upstream. Not blocking; mentioned for cleanup awareness if you ever want a sweep.

**To resume autonomous execution:** pick a reconciliation path, run the corresponding git operations (or tell me to), and re-invoke the autonomous prompt. The remaining 6 slots (F6/F8 prereqs, master polish, LT-4 bridge contract, LT-4 host polish, capability-manifest test) can drain straightforwardly once lt-4's branch state is unambiguous.

---

## Audit follow-ups awaiting triage (added 2026-05-24)

Five AI audits (ChatGPT × 4, Gemini × 1) ran against the codebase on 2026-05-24, covering both `master` (legacy C++) and `lt-4` (host layer + React bridge). Every finding that survived first-party verification (per [`lessons.md` L-018](lessons.md)) is queued in [`tasks/post-audit-followups.md`](post-audit-followups.md), tagged by branch ([master] / [lt-4] / [both]) and severity (P1/P2/P3).

**Master-side headlines:** data-loss bug in `DoSaveFile` (failed save clears dirty flag AND deletes autosave), two parser memory-safety bugs in `ChunkReader`, a cyclic-emitter-graph crash, and a 16-bit particle index wrap.

**LT-4-side headlines:** `emitters/import-from-file` native handler missing while UI calls it, `DispatchInternal` exception-safety gap, ~20 sites using `sendOk({"ok": false})` nested-failure pattern (contract drift), host-object exception envelope hand-rolling JSON.

**Stage 4 prereqs** (TextureManager-vs-Reset, composition fallback) are listed alongside the correctness items. The recommended PR sequencing is in the doc's "Suggested ordering" section. **Read that doc before sequencing the next non-LT-4 PR or the next host-side bridge work.**

## Stage 3 — what's left before FF

**Before user FF to `lt-4`:**

1. **3f manual keyboard smoke** (load-bearing per the 5-gate cadence) — launch composition build, click File menu, press Escape, expect menu to close. Also: click in a spinner, type digits, expect spinner updates. ~2 min user-driven. See [`tasks/dxgi-stage-3-composition-hosting.md`](dxgi-stage-3-composition-hosting.md) §7.1 for why this is the only verification path (SendKeyboardInput is a phantom API — see L-017).

**Pending (deferrable to Stage 3 close-out dispatch or split out):**

2. **3h a11y automated suite** — sub-plan §6 sub-stage 3h calls for UI Automation-driven Narrator-equivalent assertions. Recommendation: scaffold via Playwright's `page.accessibility.snapshot()` (cheaper than UI Automation Node bindings — about half of what 3h gates on) and defer real Narrator-driving to a follow-up dispatch if the user wants it.

3. **3i final acceptance** — manual a11y smoke with real Narrator on user's rig + IME smoke (if installed) + keyboard nav stress + visual confirmation screenshot. Fully manual; user-driven.

**Stage 4 prep (deferrable to its own dispatch):** the Compositor class explicitly models Stage 4's engine-visual as a second child of the root visual; `AttachEngineVisual(IDXGISwapChain1*)` is the seam. Not pre-added in this session (would have required input on architectural detail) but the Stage 4 dispatch's diff will be small as a result.

## What landed this session — [MT-11] Phase 3 Stages 3a + 3b + 3c + 3d + 3e + 3f + 3g (11 commits)

Cumulative session-branch lineage beyond `b5fd14f`:

```
2b33829  docs(LT-4): sub-plan §7.1 SUPERSEDED + lessons.md L-017
6077fbb  test(LT-4): Stage 3g composition-hosting A/B parity spec
7fe3075  feat(LT-4): Stage 3f keyboard focus transfer (path b+)
c5542ba  feat(LT-4): Stage 3e DPI handling under composition
97d1c16  feat(LT-4): Stage 3d cursor sync under composition
f0d8c7e  feat(LT-4): Stage 3c mouse forwarding under composition
ba3fbc4  fix(LT-4): unblock Release x64 build — match Debug's _CRT_SECURE_NO_WARNINGS
d9b1cb0  docs(LT-4): Stage 3b smoke evidence — FD6 gate PASSED
d95e08e  feat(LT-4): Stage 3b composition controller swap
e24320c  feat(LT-4): Stage 3a host::Compositor skeleton
0d2cc9c  docs(LT-4): Stage 3 sub-plan
```

### Stage 3a — `host::Compositor` skeleton (`e24320c`)

- New [src/host/Compositor.{h,cpp}](../src/host/Compositor.h) ports the working DComp tree topology from [src/host/spike/dxgi_spike.cpp](../src/host/spike/dxgi_spike.cpp). pImpl in the header keeps `dcomp.h` / `d3d11.h` / `dxgi1_2.h` scoped to a single TU so HostWindow.cpp doesn't transitively pull them in (and thus doesn't need its own DXSDK-vs-Win10-SDK isolation).
- [src/ParticleEditor.vcxproj](../src/ParticleEditor.vcxproj) gains the new file entries with a **per-file `<AdditionalIncludeDirectories>` that REPLACES (no `%(...)` inheritance) the project default** — Win10-SDK-only path for Compositor.cpp so the legacy DXSDK doesn't shadow modern `dcommon.h` / `dxgi.h`. Filed as [tasks/lessons.md L-016](lessons.md) for any future src/host/ file with modern Windows headers.
- Verification at the time of commit: MSBuild clean, vitest 335/335, tsc 0 errors, native 96/96 (unchanged — no consumer yet).

### Stage 3b — composition controller swap (`d95e08e` + `d9b1cb0` smoke evidence)

- [src/host/HostWindow.cpp](../src/host/HostWindow.cpp): three new fields (`m_compositionMode`, `m_compositor`, `m_compositionController`), env-var read in ctor (`ALO_WEBVIEW2_HOSTING=composition`), `InitWebView2` refactored — the ~220-line inner controller-ready lambda is hoisted into `FinishWebView2ControllerSetup(ICoreWebView2Controller*)` so both modes share it. Composition path takes `CreateCoreWebView2EnvironmentWithOptions` → QI Environment3 → `CreateCoreWebView2CompositionController` → `OnCompositionControllerReady` → QI to base controller → shared setup → `Compositor::AttachWebView2` + tree commit.
- Per the 5-load-bearing-gate cadence, **3b is the FD6-class gate**. Smoke evidence at [tasks/stage-3b-smoke-screenshot.png](stage-3b-smoke-screenshot.png) + [tasks/stage-3b-smoke-result.md](stage-3b-smoke-result.md): chrome composites correctly under composition hosting, log shows clean `[host] composition hosting ready (DComp tree committed)`, 21 `[host] WebMsg` lines prove React loaded + boot canary fired. **FD6 failure mode did NOT reproduce.** Calibration note: needs ~8s wait for React mount; a 5s smoke shows dark purple (DComp committed before React mounted) and looks FD6-class but isn't.

### Stage 3c — mouse forwarding via `SendMouseInput` (`f0d8c7e`)

- New `ForwardMouseToCompositionWebView2(UINT msg, WPARAM wp, LPARAM lp)` private method + MainWndProc case block for WM_MOUSE*. Direct-cast `msg` → `COREWEBVIEW2_MOUSE_EVENT_KIND` (enum values are numerically identical to WM_* constants). MK_* low-word bits → `COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS` (same numeric identity). Wheel-message coords translated via `ScreenToClient` (WM_MOUSEWHEEL/HMOUSEWHEEL ship in screen coords; all other WM_MOUSE* are client). `SetCapture(hMain)` on any button-down; `ReleaseCapture()` when up-event leaves wParam's MK_* bits at zero.
- Native 99/99 PASS under composition mode (A/B against HWND baseline at `ba3fbc4`).
- **Manual smoke evidence** at [tasks/stage-3c-smoke-screenshot.png](stage-3c-smoke-screenshot.png) + [tasks/stage-3c-smoke-result.md](stage-3c-smoke-result.md): real OS WM_LBUTTONDOWN at (86, 34) opened File menu, `[Occlude] SET id=menu:file rect=(119,17,238,243)` bridge log proves the click reached React's onOpenChange handler. Click outside at (300, 250) closed it; `[Occlude] CLEAR id=menu:file` log confirms. **CAVEAT:** Playwright's `.click()` etc. dispatch via CDP at the renderer level — bypasses OS WM_* path entirely. So the 99-test gate proves the rest of the composition stack works; only the manual smoke proves `SendMouseInput` itself.

### Stage 3d — cursor sync (`97d1c16`)

- Two new fields (`m_webViewCursor`, `m_cursorChangedTok`). `OnCompositionControllerReady` subscribes via `add_CursorChanged` + primes `m_webViewCursor` from `get_Cursor`. MainWndProc `WM_SETCURSOR` case gated on `m_compositionMode + cached cursor + LOWORD(lp) == HTCLIENT` returns the cached HCURSOR via `SetCursor`. The HTCLIENT gate keeps non-client (title bar, resize edges) cursors with DefWindowProc. `remove_CursorChanged` in WM_DESTROY before `m_compositionController.Reset()` so the lambda (captures `this`) can't fire mid-destruction.

### Stage 3e — DPI handling (`c5542ba`)

- Initial `put_RasterizationScale(GetDpiForWindow(hMain)/96.0)` in `OnCompositionControllerReady`. QI baseController to `ICoreWebView2Controller3` (the interface generation that exposes `put_RasterizationScale`); silent skip on QI failure (best-effort for older runtimes).
- New `WM_DPICHANGED` case in MainWndProc, gated on `m_compositionMode + m_compositionController`. HIWORD(wp) → new DPI, update rasterization scale, resize host HWND to Windows's suggested rect in lParam (per-monitor-v2 best-practice flow).

### Stage 3f — keyboard focus transfer (`7fe3075`)

- **THE ONLY AVAILABLE PATH** for composition-mode keyboard. WebView2 SDK does NOT expose `SendKeyboardInput` in any version (verified against MS docs across 100+ historical SDK releases — see [tasks/lessons.md L-017](lessons.md) for the meta-lesson). DOM keyboard works under composition only when WebView2 has *logical* keyboard focus.
- `OnCompositionControllerReady` ends with `baseController->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC)` to grant initial logical focus. New `WM_SETFOCUS` case in MainWndProc calls MoveFocus again whenever the host HWND gains Win32 focus (initial show, Alt-Tab back, click into title bar).
- IME works automatically once WebView2 owns focus (OS routes WM_IME_* to focused window's input thread).
- **3f IS a load-bearing user check-in gate. The manual keyboard smoke is pending the user.** Native 99/99 PASS under composition is the regression bar; the actual keyboard correctness needs a real OS WM_KEYDOWN that only the user can drive. Smoke procedure: click File menu → press Escape → expect menu close. Click spinner → type digits → expect spinner updates.

### Stage 3g — composition-hosting A/B parity spec (`6077fbb`)

- New [web/apps/editor/tests/composition-hosting.spec.ts](../web/apps/editor/tests/composition-hosting.spec.ts) (8 specs). Each test skips with a clear annotation when `ALO_WEBVIEW2_HOSTING != "composition"`, so the harness runs cleanly in both modes:
  - HWND baseline (no env var): 99 passed, 8 skipped
  - Composition (env vars set): 106 passed, 1 skipped (curve editor SVG not mounted when no emitter is selected at test time)
- Registered in [scripts/run-native-tests.mjs](../web/apps/editor/scripts/run-native-tests.mjs) next to `alpha-compositor-snapshot.spec.ts`.
- **CAVEAT (documented in the file header):** Playwright's `.click()` / `.keyboard.press()` dispatch through CDP at the renderer level — they bypass the OS WM_* path. So these specs validate the BRIDGE layer (controller wiring, host-object proxy, postMessage round-trips, React event handling) under composition. They do NOT validate the host's SendMouseInput / MoveFocus forwarding — that's the manual smoke's job.

### Bonus fix — Release x64 unblocked (`ba3fbc4`)

- Sibling session's heads-up: Release x64 had been failing since `fd5481a` due to C4996 (`_wgetenv`) under /WX. Two-line vcxproj fix matching the Debug pattern: add `_CRT_SECURE_NO_WARNINGS` to both Release `<PreprocessorDefinitions>`. `ParticleEditor.exe` now links in Release for the first time this session.

### Sub-plan + lessons updates (`2b33829`)

- [tasks/dxgi-stage-3-composition-hosting.md](dxgi-stage-3-composition-hosting.md) §7.1 + D4: SUPERSEDED notes documenting the WebFetch-verified finding that `SendKeyboardInput` doesn't exist in any SDK version. Phantom "path (a)" retired permanently.
- [tasks/lessons.md L-017](lessons.md): "Before planning around an SDK bump, verify the target API actually exists via authoritative docs." Captures the meta-lesson — local-header grep proves "not in THIS version"; vendor docs prove "not in ANY version." Conflating those cost ~1h of planning effort this session.

## Critical references for the next dispatch

In priority order:

1. **[tasks/dxgi-stage-3-composition-hosting.md](dxgi-stage-3-composition-hosting.md)** — the sub-plan. §6 sub-stage 3f manual smoke section explains what 3f needs; §7.1 explains the SDK-bump-path-doesn't-exist finding; §4 lists 3h / 3i acceptance.
2. **[tasks/stage-3b-smoke-result.md](stage-3b-smoke-result.md)** + **[tasks/stage-3c-smoke-result.md](stage-3c-smoke-result.md)** — the load-bearing smoke evidence (FD6 cleared, mouse forwarding works end-to-end).
3. **[tasks/lessons.md L-016 + L-017](lessons.md)** — L-016: DXSDK shadowing pattern for any new src/host/ file with modern Windows headers; L-017: verify SDK bump assumptions via authoritative docs before committing to one.
4. **[src/host/Compositor.h](../src/host/Compositor.h)** — pImpl-style class; Stage 4 adds engine-visual via `AttachEngineVisual(IDXGISwapChain1*)` as a sibling of the WebView2 visual. Architectural seam already designed.
5. **[src/host/HostWindow.cpp](../src/host/HostWindow.cpp)** `InitWebView2` (~line 606), `OnCompositionControllerReady` (~line 1000), `FinishWebView2ControllerSetup` (factored shared per-controller setup), `ForwardMouseToCompositionWebView2` (~line 1090) — all the Stage 3 surface.
6. **[web/apps/editor/tests/composition-hosting.spec.ts](../web/apps/editor/tests/composition-hosting.spec.ts)** — 3g spec; new specs added here for 3h/3i should follow its skip-when-not-composition pattern.

## Resumable state (snapshot)

| Thing | Value |
|---|---|
| **Worktree** | `C:\Modding\Particle Editor\.claude\worktrees\upbeat-diffie-24f7fc` (this session's; next session gets a fresh `claude/<random>` from `origin/lt-4`) |
| **HEAD (committed)** | `2b33829` (sub-plan + lessons updates) |
| **Ahead of origin/lt-4** | 11 (the Stage 3 session-branch sequence above) |
| **Behind master** | `lt-4` is many commits ahead of `master`; nothing merged to master from Phase 3 work yet. |
| **Open PRs** | none |
| **Build status** | All targets clean: ParticleEditor (Debug + Release x64), expatw_static, viewport_poc, dxgi_spike, shared_texture_test. **Release x64 is FIXED this session** (was broken since `fd5481a`). |
| **Phase status** | Phase 3 Stages 0/1/2 on lt-4 (`b5fd14f` tip); Stages 3a–3g on session branch behind `ALO_WEBVIEW2_HOSTING=composition` (default unset = HWND mode, byte-identical to today). 3f manual smoke + 3h/3i pending. |

**End-of-session FF flow** (per [CLAUDE.md branch workflow](../CLAUDE.md)):

```
git switch lt-4
git merge --ff-only claude/upbeat-diffie-24f7fc
git push
```

**Recommend:** wait until 3f manual keyboard smoke is run + passes before FF. If smoke surfaces an issue with MoveFocus, easier to fix on the session branch than as a follow-up commit on lt-4. If user wants to FF immediately and treat 3f smoke as a post-merge gate, the code is conservative (defaults stay byte-identical without the env var), so the risk is bounded.

## Next dispatch options after Stage 3 closes out

Below in priority order:

| Option | Why next | Effort |
|---|---|---|
| **Stage 4 — DXGI composition wiring** | Engine visual attaches to the DComp tree as second child of root. Architectural seam already exists at `Compositor::AttachEngineVisual`. Headline payoff: engine pixels visible under composition, performance gate vs canvas-jpeg baseline. | 3-4 days per parent plan §4 |
| **Stage 3 close-out (3h a11y + 3i final)** | Sub-plan obligations not yet shipped. 3h a11y scaffolding via Playwright's `page.accessibility.snapshot()` is the cheap variant; UI Automation driving is the comprehensive option. 3i is manual user smoke. | 3h ~1d cheap / ~2d comprehensive; 3i ~0.5d user-driven |
| **Spawned task — Defer lastRawDib cache copy** | Was the chip from a prior session; sibling session resolved it directly (commits `fd41dfa` + `b5fd14f` already on lt-4 — the Stage 1 follow-up cache deferral). ✅ DONE, no action needed. | n/a |

---

## Pre-Stage-3 — what was active before this session

The sections below predate this session's Stage 3 work. Kept verbatim for archive purposes. **Read top-of-file for current state.**

---

## Next dispatch — [MT-11] Phase 3 Stage 3 (WebView2 composition hosting migration)

**Per [`tasks/todo.md`](todo.md) §4 Stage 3 + §6 Stage 3 acceptance.** This is the LOAD-BEARING risk of the entire plan — FD6 v1/v2/v3 each attempted variants of this transition and produced opaque-white output. The Stage 0 spike proved the composition path works on the user's RTX 3080, but the production-code migration is substantially larger than the spike.

**In scope:**
- Swap `CreateCoreWebView2Controller(hwnd, …)` → `CreateCoreWebView2CompositionController(hwnd, …)` in `src/host/HostWindow.cpp:InitWebView2` (around line 692).
- Stand up a `host::Compositor` class (new) owning the DComp device + target + visual tree. Reference pattern in the working `dxgi_spike.cpp` at `src/host/spike/`.
- Wire WebView2's `RootVisualTarget` to a DComp visual.
- Input routing rework: under composition hosting, host HWND receives input directly. Phase 2's `viewport/input` bridge surface keeps the renderer-routed keyboard path; mouse may shift to host WNDPROC + `ICoreWebView2CompositionController::SendMouseInput` forwarding (see todo.md §3.4).
- Cursor sync via `add_CursorChanged` + `WM_SETCURSOR`.
- DPI handling via `put_RasterizationScale`.
- Gate behind a new env var (e.g. `ALO_WEBVIEW2_HOSTING=composition`) so default still uses HWND-mode hosting and the existing 96-test harness can A/B.

**Acceptance gates (todo.md §6 Stage 3):**
- All 96 Playwright tests pass under visual hosting (gated by env var for A/B). CRITICAL — FD6 failure point.
- New `tests/composition-hosting.spec.ts`: assert clicks/keys reach renderer with identical coords/values as HWND mode.
- **Rigorous a11y suite** (per user direction): Narrator drives UI Automation; verifies menubar, tree rows, dialog modals, form-field labels. Compare against a golden file with minor-wording tolerance.
- A11y manual smoke: Narrator reads chrome, tab cycles, F2 inline rename, Escape closes modal/menu.
- IME composition under visual hosting (manual; irreducible).
- Keyboard nav stress: 100 random tabs / arrow keys / accelerators; no crash, focus always visible.

**Risk mitigation (FD6 lessons applied):**
- Bisect harness in `dxgi_spike.cpp` (`--no-engine` / `--no-webview2`) proved its weight in Stage 0 by catching the DComp z-order gotcha — keep that diagnostic mode available.
- Defer `CreateTargetForHwnd` + visual-tree construction until INSIDE the composition-controller completion callback (FD6 v3 attributed at least part of the failure to early tree construction).
- Don't claim "works" from clean API logs alone. FD6 v1-v3 all returned `S_OK` everywhere with opaque-white output. **Visual confirmation via screenshot is mandatory.**

## What landed this dispatch — [MT-11] Phase 3 Stages 0 + 1 + 2 (7 commits + 1 spawned task)

Cumulative session-branch lineage beyond Phase 2 baseline `4896aa7`:

```
e5f3a40  feat(LT-4): Stage 2 — shared-handle texture infrastructure
ad7d294  test(LT-4): Stage 1g — d3d9ex.spec.ts (init + reset + L-007)
29bf484  feat(LT-4): Stage 1c-f — 4× D3DPOOL_MANAGED → D3DPOOL_DEFAULT
f2e610d  feat(LT-4): Stage 1b — D3D9 → D3D9Ex device swap
f9bee59  docs(LT-4): Stage 1 sub-plan doc
6c00536  feat(LT-4): Stage 0 GO decision (z-order + screenshots)
6ad32b8  feat(LT-4): Stage 0 spike skeleton + post-mortem
```

### Stage 0 — Spike + GO decision

- [docs/superpowers/research/dxgi-fd6-fd9-history.md](../docs/superpowers/research/dxgi-fd6-fd9-history.md) — post-mortem of FD6 v1/v2/v3 + FD7 + FD8/FD9. Identifies the architectural distinction (Phase 3 has both engine + WebView2 as DComp visuals, vs FD6's mixed paradigm) and the FD6 failure mode (clean S_OK + opaque white).
- [docs/superpowers/research/dxgi-stage-0-decision.md](../docs/superpowers/research/dxgi-stage-0-decision.md) — locked GO criteria + per-resolution measurements (3000+ FPS at all 4 resolutions on RTX 3080; transport latency 0.30-0.34 ms across 720p/1080p/1440p/3440×1440).
- [docs/superpowers/research/dxgi-stage-0-run-procedure.md](../docs/superpowers/research/dxgi-stage-0-run-procedure.md) — how to run the spike + interpret results.
- [src/host/spike/dxgi_spike.cpp](../src/host/spike/dxgi_spike.cpp) — standalone exe (~590 LOC) proving D3D9Ex shared handle → D3D11 → DComp + WebView2 composition controller pipeline end-to-end. **Bisect modes (`--no-engine`, `--no-webview2`) caught the DComp `insertAbove` z-order bug** — keep this harness alive for Stage 3.
- Screenshots at [docs/superpowers/research/spike-screenshots/](../docs/superpowers/research/spike-screenshots/) — 720p/1080p/1440p/3440x1440 PNGs, all showing correct composite.

### Stage 1 — D3D9Ex migration on production engine

- [src/engine.h](../src/engine.h) — `m_pDirect3D` / `m_pDevice` types promoted to `IDirect3D9Ex*` / `IDirect3DDevice9Ex*` (covariant; existing call sites compile unchanged).
- [src/engine.cpp](../src/engine.cpp) — `Direct3DCreate9` → `Direct3DCreate9Ex`, `CreateDevice` → `CreateDeviceEx` + `D3DCREATE_MULTITHREADED` flag. **Hard-fail on D3D9Ex unavailable** (per dispatch decision #1; production fallback is legacy arch-A at Stage 6+, not silent D3D9 downgrade).
- Four D3DPOOL_MANAGED migrations to D3DPOOL_DEFAULT (engine.cpp:1044 ground solid-colour helper, 1511/1522 skydome VB/IB, 1608 custom skydome texture). All wired into `Engine::Reset` via new `CreateSkydomeMeshBuffers` / `ReleaseSkydomeMeshBuffers` helpers + `ReloadGroundTexture` / `ReloadSkydomeTexture` post-Reset re-invokes.
- New `Engine::GetSharedTextureHandle()` (Stage 2b portion, but committed together).
- [web/apps/editor/tests/d3d9ex.spec.ts](../web/apps/editor/tests/d3d9ex.spec.ts) — 6 new Playwright specs: bridge-attached smoke, ground cycle (L-007 regression), solid-colour ground (slot 4), skydome cycle, **10× resize cycle (Engine::Reset stress)**, L-007 polluter pair + ground set.

### Stage 2 — Shared-handle texture infrastructure

- [src/host/AlphaCompositor.cpp](../src/host/AlphaCompositor.cpp) — `offscreenRT` promoted from `CreateRenderTarget` to `CreateTexture(USAGE_RENDERTARGET, D3DPOOL_DEFAULT, &sharedHandle)`. The level-0 surface is still used as the engine's render target; arch-A behavior unchanged. New `AlphaCompositor::GetSharedHandle()` exposes the NT-handle alias.
- [src/engine.cpp](../src/engine.cpp) — `Engine::GetSharedTextureHandle()` forwards to the compositor's handle (returns nullptr when compositor not installed, e.g. canvas-jpeg mode).
- [src/host/spike/shared_texture_test.cpp](../src/host/spike/shared_texture_test.cpp) — new standalone CLI exe (~260 LOC). Creates D3D9Ex device, shared-handle texture, Clears to known color, opens in D3D11 via `OpenSharedResource`, CopyResource → staging → Map → byte-compare every pixel. Exit 0/1/2 for PASS/FAIL/init-error. **Five PASS runs verified on user's RTX 3080**: 256×256 / 3440×1440 / 1920×1080 (alpha=0) / 1280×720 / 3440×1440-Release with various colors.

### Perf investigation findings (user-asked mid-dispatch)

User reported ~40 FPS at maximized 3440×1440. Investigation via temporary `[Perf]` instrumentation in `AlphaCompositor::Composite` (reverted before commit) measured:

- `readback` (GetRenderTargetData submit): ~0.00 ms (async).
- `dibCopy` (LockRect + memcpy SYSTEMMEM→DIB): **~12 ms** ← dominant; LockRect blocks for the GPU readback.
- `cacheCopy` (DIB → lastRawDib for modal snapshot cache): ~2-5 ms ← wasted on 99.9% of frames.
- `stamps` (band + occlusion alpha): ~1 ms.
- `ulw` (UpdateLayeredWindow): ~3.5 ms.
- TOTAL: ~19 ms → ~50 FPS at maximize.

**Stage 1 was ruled OUT as the cause** — D3DCREATE_MULTITHREADED adds sub-microsecond mutex on ~3 D3D calls per frame. The 40-50 FPS matches the documented FD9 baseline ([dxgi-fd6-fd9-history.md §5](../docs/superpowers/research/dxgi-fd6-fd9-history.md#5-fd8--fd9--the-path-that-shipped)). The proper fix is Phase 3 Stage 4 (shared-handle GPU→GPU eliminates the readback path entirely; spike measured 0.30 ms total at 3440×1440 vs current 19 ms).

The `cacheCopy` is genuinely wasted work — **spawned as a separate task** for a future dispatch (~15% FPS gain, ~1-2 hour fix; user chose "do it as a separate dispatch"). See the chip for `Defer lastRawDib cache copy (~15% FPS at maximize)`.

## Critical references for Stage 3

In priority order:

1. **[docs/superpowers/research/dxgi-fd6-fd9-history.md](../docs/superpowers/research/dxgi-fd6-fd9-history.md)** — must read end-to-end before any composition-hosting code is written. §1-3 cover FD6 v1/v2/v3 failure modes; §9 has the concrete "lessons for the spike" that apply equally to Stage 3 production code (defer tree construction until controller exists, instrument every API for non-S_OK, screenshot before declaring success, mirror sample topology).
2. **[src/host/spike/dxgi_spike.cpp](../src/host/spike/dxgi_spike.cpp)** — working reference. Particularly: `OnCompositionControllerReady` callback structure, `BuildVisualTree` deferred-construction pattern, DComp `AddVisual` z-order gotcha (insertAbove=FALSE with NULL ref = "in front of all siblings"). The bisect modes (`--no-engine`, `--no-webview2`) paid for themselves in Stage 0; Stage 3 should have analogous diagnostic env vars.
3. **[tasks/lt4_phase_4_1_fd6_visual_hosting_plan.md](lt4_phase_4_1_fd6_visual_hosting_plan.md)** — the original FD6 plan with all three attempts' postmortems inline. Background reading.
4. **[tasks/todo.md](todo.md) §4 Stage 3 + §6 Stage 3 acceptance** — the active sub-plan headers. The new dispatch writes its own CLAUDE.md-shaped sub-plan before coding.
5. **[tasks/lessons.md](lessons.md) L-003** — postMessage drops under CDP attach; the test-host bridge uses host-object channel to work around this. Stage 3's composition-mode WebView2 may interact differently with CDP — explicitly verify before declaring tests pass.
6. **[web/apps/editor/scripts/run-native-tests.mjs](../web/apps/editor/scripts/run-native-tests.mjs)** — harness for the 96-test native CDP suite. Stage 3 must keep all 96 green under the new hosting mode.

## Resumable state (snapshot)

| Thing | Value |
|---|---|
| **Worktree** | `C:\Modding\Particle Editor\.claude\worktrees\keen-perlman-619e2c` (this dispatch's; next session gets a fresh `claude/<random>` from `origin/lt-4`) |
| **HEAD (committed)** | `e5f3a40` (Stage 2 — shared-handle infrastructure) |
| **Ahead of origin/lt-4** | 0 (FF'd) |
| **Behind master** | `lt-4` is many commits ahead of `master`; nothing merged to master from Phase 3 work yet, per user direction. |
| **Open PRs** | none |
| **Build status** | All targets clean: ParticleEditor, expatw_static, viewport_poc, dxgi_spike, shared_texture_test (Debug + Release x64). |
| **Phase status** | Phase 3 Stages 0, 1, 2 shipped behind no env-var (Stage 1 changes are always-on D3D9Ex; Stage 2's shared-handle promotion of AlphaCompositor RT is also always-on — verified by 96/96 Playwright pass). Stage 3 introduces the first env-var-gated change in Phase 3. |

---

## Phase 2 smoke matrix — reference if smoke surfaces a regression

Phase 2 was user-verified working before commit. Reference matrix for diagnostic / regression-test purposes:

**Launch (PowerShell):**

```powershell
$env:VITE_VIEWPORT_TRANSPORT = "canvas-jpeg"
cd web/apps/editor; pnpm run build; cd ../../..
$env:ALO_VIEWPORT_TRANSPORT = "canvas-jpeg"
./x64/Debug/ParticleEditor.exe --new-ui
```

Or two-terminal dev mode (Vite HMR):

```powershell
cd web/apps/editor
$env:VITE_VIEWPORT_TRANSPORT = "canvas-jpeg"
pnpm run build
$env:ALO_VIEWPORT_TRANSPORT = "canvas-jpeg"
./x64/Debug/ParticleEditor.exe
```

**The matrix.**

| Gesture | Expected | Verifies |
|---|---|---|
| LMB-drag in viewport | Camera MOVE (target translates) | mousedown/move/up + MK_LBUTTON encoded |
| RMB-drag in viewport | Camera ROTATE (orbit around target) | RMB encoding + drag continuity past canvas edge |
| MMB-drag | Camera MOVE | MMB encoding |
| Ctrl+LMB-drag | ZOOM | MK_CONTROL bit reassembled per event |
| Ctrl+RMB-drag | ZOOM | as above |
| Wheel up | Zoom in | deltaY sign convention correct |
| Wheel down | Zoom out | as above |
| Shift+LMB-click | Cursor-bound instance spawns | MK_SHIFT on mousedown + VK_SHIFT keydown reaches host |
| Release Shift | Instance dies | VK_SHIFT keyup |
| Alt-Tab while holding Shift | Instance dies (defensive) | window.blur → WM_KILLFOCUS path |
| Open File menu while canvas active | No cutout artifact in the dropdown | popup hidden, canvas is the only visible viewport |
| Open Mods → submenu with chrome | No cutout artifact | **the headline payoff** |
| Open a modal (Help → About) | Frosted-glass backdrop unchanged | snapshot-into-DOM path still works alongside archC |

**Diagnostics.** In archC mode the host logs `[ArchC] InputDispatcher up (popup=...)` + `[ArchC] viewport popup hidden (canvas-in-DOM is the visible surface)` lines on startup. Diagnostic logging from this session (`[ArchC-input]` per-event, `[ArchC-engine]` per-LBUTTONDOWN, `[ArchC-kill]` per-attached-instance kill, `[ArchC] frame=N` at 1 Hz) is retained in the code as a Stage-4/5 regression detection aid — slated for removal in Phase 3 Stage 7 per the [`tasks/todo.md`](todo.md) cleanup plan.

## Alternative next-dispatch options (if not starting DXGI)

Below in priority order if the user chooses to defer Stage 0. The primary recommendation remains Stage 0.

| Option | Why next | Effort |
|---|---|---|
| **B2 obsolescence audit** | Older HANDOFF §0b suspected B1.3 already absorbed B2's scope; a quick diff probably retires B2 entirely | ~30 min |
| **MT-1 follow-up — texture-picker `…` buttons** | New-UI never wired the legacy `IDC_BUTTON1` / `IDC_BUTTON2` browse buttons; comment marker `TODO(MT-1)` in [EmitterPropertyTabs.tsx](../web/apps/editor/src/screens/EmitterPropertyTabs.tsx) | ~2-4 h |
| **[NT-5] Engine-side single-member link-group enforcement** | Top of Near-term (position 1.1). Data-layer parity with the B1 render-layer filter | small |
| **[NT-6] Visual-stability lane assignment** | Optional bracket-gutter ergonomic improvement (position 1.2) | small |

## What landed this session — [MT-11] Phase 2 close-out + DXGI plan

- **`viewport/input` bridge surface** — single kind with discriminated `ViewportInputEvent` union ([bridge-schema/src/index.ts](../web/packages/bridge-schema/src/index.ts) + MockBridge no-op arm).
- **Renderer encoders** — new [`web/apps/editor/src/lib/viewport-input.ts`](../web/apps/editor/src/lib/viewport-input.ts) with pure-function helpers (`encodeMkButtons`, `quantiseWheelDelta`, `toPopupClientCoords`, `isTypingTarget`, `makeMouseEvent` / `makeWheelEvent` / `makeKeyEvent`).
- **ViewportSlot DOM handlers** — third `useEffect` in [`ViewportSlot.tsx`](../web/apps/editor/src/components/ViewportSlot.tsx) wiring pointerdown/move/up/cancel + contextmenu + native `wheel` listener `{ passive: false }` on the canvas; window-scoped keydown / keyup / blur with TYPING_TAGS guard. `setPointerCapture` on pointerdown for drag continuity.
- **Host InputDispatcher** — new [`src/host/InputDispatcher.{h,cpp}`](../src/host/InputDispatcher.h) switches on payload type, decodes into `WM_*` / `wParam` / `lParam`, `PostMessage`s to the popup HWND. Wired through [`BridgeDispatcher`](../src/host/BridgeDispatcher.cpp) (`SetInputDispatcher` + `viewport/input` arm). Constructed in `WM_CREATE` alongside `FramePublisher` when `m_archCMode`; torn down before the compositor.
- **Popup hide** — `LayoutBroker::GetViewport()` + `HostWindowImpl::Run` calls `ShowWindow(SW_HIDE)` after `ApplyFullClient` when `m_archCMode`. Popup still spans full main client so `LayoutBroker` scene-rect math + D3D9 swapchain stay valid; `UpdateLayeredWindow` becomes a wasted no-op.
- **Shift+LMB regression fix** — `SetFocus(hwnd)` at the top of WM_LBUTTONDOWN was triggering a spurious `WM_KILLFOCUS` cascade on the hidden popup that killed cursor-bound spawns within ~2ms. Gated `SetFocus` (LMB + RMB) + the `WM_KILLFOCUS` defensive kill on `!m_archCMode` to break the focus-thrash → kill loop.
- **Legacy placement gesture preserved** — Added `OBJECT_Z` drag mode to `HostWindow.cpp` matching legacy `src/main.cpp:2877-2934`: WM_LBUTTONDOWN with attached preview enters OBJECT_Z (Z-axis drag, X/Y frozen), WM_MOUSEMOVE adjusts `cursor.z = -y * camDist / 1000`, WM_LBUTTONUP calls `engine->DetachParticleSystem(attached)`. The cursor-bound preview becomes a free-running placed system. User-verified: chain-clicks place multiple, Shift release ends gesture.
- **DXGI plan drafted** — [`tasks/todo.md`](todo.md) restructured as the Phase 3 DXGI plan; Phase 0+1+2 planning content moved to [`tasks/todo-mt-11-phase-0-1-2-archive.md`](todo-mt-11-phase-0-1-2-archive.md). Phase 3 was originally "A/B verification" (~2-4h) but redirected to "DXGI shared-handle compositing" (~5 weeks) after Phase 2 perf smoke showed canvas-JPEG bandwidth-bound at 20 FPS on maximized 3440×1440. Stage 0 of the new plan is a 2-day hard gate; NO-GO falls back to legacy arch-A.
- **Tests** — vitest +35 (26 encoder unit tests in new `viewport-input.test.ts`, 9 DOM-integration tests in `ViewportSlot.test.tsx`'s new Phase 2 describe block); new Playwright [`tests/canvas-architecture.spec.ts`](../web/apps/editor/tests/canvas-architecture.spec.ts) with 3 cases that self-skip in legacy CI.

Decisions captured for next session:

1. Single `viewport/input` kind with discriminator (vs per-event-type kinds) — matches Win32 MSG shape, one dispatch arm per side.
2. `SW_HIDE` only, popup stays sized to full main client (vs move off-screen) — preserves T4c.4 scene-rect math.
3. Include `window.blur` → `viewport/input { type: "blur" }` so cursor-bound spawn dies on Alt-Tab.
4. Forward all keys that pass TYPING_TAGS guard — engine wndproc default-cases unknowns, broad forward is safe + forward-compat.
5. Phase 3 = DXGI, not A/B verification. Fallback = legacy arch-A (not SharedBuffer, not canvas-JPEG).
6. Rigorous a11y testing in Stage 3 (per user direction).

The chrome-cutout artifact that motivated [MT-11] IS gone in Phase 2 (verified). The remaining gap is performance at maximized resolution — Phase 3 DXGI plan addresses that. See [`tasks/todo.md`](todo.md) for the active plan.

---

## What landed this session — [MT-11] Phase 0 + Phase 1 (one combined commit)

### Phase 0 — Spike
JPEG inline-in-payload transport chosen over WebResourceRequested mid-spike when **L-015** ([SetVirtualHostNameToFolderMapping short-circuits user `WebResourceRequested`](lessons.md#l-015)) surfaced. Spike numbers: **~120 FPS sustained** at 699×495 (centre-quadrant scene rect), JPEG ~58 KB / base64 ~78 KB per frame, 1:1 host:renderer with no dropping. Gate was ≥30 FPS — cleared by 4×.

### Phase 1 — Production-grade hookup
- **[`web/packages/bridge-schema/src/index.ts`](../web/packages/bridge-schema/src/index.ts)**: new `viewport/frame-ready` event kind, typed payload `{ w, h, frameId, jpegBase64 }`.
- **[`src/host/FramePublisher.h`](../src/host/FramePublisher.h)** + **[`.cpp`](../src/host/FramePublisher.cpp)**: new class owning the encode → base64 → emit → 1 Hz log-throttle pipeline. Constructed alongside `AlphaCompositor` in `WM_CREATE` when `ALO_VIEWPORT_TRANSPORT=canvas-jpeg`; torn down before the compositor in `WM_DESTROY`.
- **[`src/host/AlphaCompositor.h`](../src/host/AlphaCompositor.h)** + **[`.cpp`](../src/host/AlphaCompositor.cpp)**: new `EncodeFrameJpeg(quality, outBytes, w, h)` — GDI+ JPEG encode with scene-rect crop, same shape as the existing `CaptureSnapshotPng`.
- **[`src/host/HostWindow.cpp`](../src/host/HostWindow.cpp)**: env-var gate, `m_framePublisher` member, one-line `OnFrameComposited()` call per frame in `RenderD3D9`. Dead WebResourceRequested attempt deleted with a one-paragraph reference to L-015.
- **[`web/apps/editor/src/components/ViewportSlot.tsx`](../web/apps/editor/src/components/ViewportSlot.tsx)**: dual render path (legacy span vs `<canvas data-testid="viewport-canvas">`); typed `bridge.on("viewport/frame-ready", ...)`; `matchMedia('(resolution)')` listener for DPR-on-monitor-change; subscribe-before-context ordering so jsdom tests share the same code path.
- **[`web/apps/editor/src/components/__tests__/ViewportSlot.test.tsx`](../web/apps/editor/src/components/__tests__/ViewportSlot.test.tsx)**: new — +6 vitest tests covering both render paths + subscription lifecycle.

---

## Phase 2 — what's queued

The plan in [`tasks/todo.md` §6](todo.md) lays out Phase 2 (~4-6 h):

1. **`viewport/input` bridge surface** (schema + MockBridge cases) for mouse-down/up/move, wheel, keyboard.
2. **Renderer-side**: dispatch handlers on the `<canvas>` for mouse + wheel; window-scoped for keydown/up with `TYPING_TAGS` guard.
3. **Host-side `InputDispatcher.cpp`**: synthesize Win32 messages from bridge requests, post to the hidden popup HWND so the engine's existing input handlers consume them unchanged.
4. **Hide the popup HWND** (off-screen + `ShowWindow(SW_HIDE)`).
5. **Manual + Playwright smoke matrix**: LMB-drag rotate, MMB-drag pan, RMB-drag, wheel zoom, Shift+LMB instance spawn, keyboard hotkeys.

When Phase 2 ships, the canvas becomes the visible source of truth and the chrome-cutout artifact in dropdowns is gone permanently.

---

## What landed this session — B1.4 [NT-8] T0 → T4c.4 (11 commits, all ready for FF)

In execution order (oldest → newest):

| Commit | What |
|---|---|
| [`302f942`](https://github.com/DrKnickers/new-particle-editor/commit/302f942) | **T1 — install `react-resizable-panels@4.11.1`.** Pre-flight via type declarations caught major API drift from the plan's 2.x sketch: `PanelGroup`→`Group`, `PanelResizeHandle`→`Separator`, `autoSaveId` removed (DIY `defaultLayout` + `onLayoutChanged`), double-click handle reset is now built-in. Plan §3 rewritten in place. T0 pre-flight audit (quadrant testIDs + getBoundingClientRect callsites) folded into the same commit. |
| [`56a1110`](https://github.com/DrKnickers/new-particle-editor/commit/56a1110) | **T2 — failing PanelLayout vitest skeleton.** Pins persistence-helper contract (`loadLayout`/`saveLayout` for corruption/missing-key/sum-drift cases) + the five quadrant testIDs + spawner mount/unmount under `useSpawnerVisible`. |
| [`ceab4f8`](https://github.com/DrKnickers/new-particle-editor/commit/ceab4f8) | **T3 — implement PanelLayout.** Three nested `<Group>`s (outer horizontal + left vertical + centre vertical). Per-Panel `defaultSize` derived from the loaded layout map. Persistence via `usePersistedLayout` (lazy `useMemo` load + `useCallback` write). |
| [`e3471bd`](https://github.com/DrKnickers/new-particle-editor/commit/e3471bd) | **T4 — wire PanelLayout into AppShell + 4.x sizing fix.** App.tsx swaps the main-row block for `<PanelLayout bridge={bridge} />`. Two 4.x quirks discovered mid-T4: numeric size props are PIXELS not percentages (use `${value}%` strings); `Group.defaultLayout` is effectively an SSR hint, `Panel.defaultSize` is the canonical client-mount knob. **L-014 captures both quirks** with cross-references to the exact lines of `react-resizable-panels.js` that drive the behaviour. |
| [`de83749`](https://github.com/DrKnickers/new-particle-editor/commit/de83749) | **T5 — Playwright splitter spec (+ 6 tests).** Drag-persistence, defaults, corrupted-localStorage fallback, spawner toggle 2col↔3col. `readLayout` helper derives orientation from computed flex-direction (4.x puts aria-orientation on `[data-separator]` only, not `[data-group]`). |
| [`be46d90`](https://github.com/DrKnickers/new-particle-editor/commit/be46d90) | **T4b — drag-flag popup-overlap fix (ABANDONED).** Tried to park the popup offscreen via `pointerdown` capture + restore on `pointerup`. Worked in vitest, failed in user smoke: popup stuck offscreen on some drags, popup at pre-drag rect on others (synchronous `pointerup` read of `getBoundingClientRect` happened before React committed the post-drag layout). Reverted at next commit. |
| [`0610f8f`](https://github.com/DrKnickers/new-particle-editor/commit/0610f8f) | **T4b revert.** Drag-flag approach abandoned in favour of the cleaner architectural fix below. |
| [`3caaf78`](https://github.com/DrKnickers/new-particle-editor/commit/3caaf78) | **T4c.1 — add `layout/scene-rect` to bridge schema.** Re-plan §7 documents the popup-spans-window architecture: popup HWND always sized to main client; the centre-quadrant rect drives an alpha-mask via `AlphaCompositor` so panels behind the popup's alpha-zero bands show through (and receive their own mouse events, courtesy of WS_EX_LAYERED+ULW_ALPHA hit-test semantics). Camera frustum stays at popup-rect aspect per user direction. |
| [`e115883`](https://github.com/DrKnickers/new-particle-editor/commit/e115883) | **T4c.2 — LayoutBroker scene-rect + AlphaCompositor band masks.** `LayoutBroker::SetSceneRect` translates main-client → popup-client and forwards to the compositor. `AlphaCompositor::Composite` stamps alpha=0 for the four outside-scene bands (top/bottom/left/right of the scene rect) AFTER the `lastRawDib` snapshot cache and BEFORE the per-id smoothstep occlusion pass. Hard cut, no smoothstep — band mask is the popup's parent chrome area where WebView paints whatever DOM is at those screen coords. |
| [`2dc147a`](https://github.com/DrKnickers/new-particle-editor/commit/2dc147a) | **T4c.3 — BridgeDispatcher `layout/scene-rect` handler.** Routes the message to `LayoutBroker::SetSceneRect`. No `Engine::Reset` involved (that's the load-bearing perf win — splitter drag fires per-frame `layout/scene-rect` without stacking expensive D3D9 device resets). |
| [`bd0fab2`](https://github.com/DrKnickers/new-particle-editor/commit/bd0fab2) | **T4c.4 — popup spans window, scene-rect drives mask.** ViewportSlot dispatches `layout/scene-rect` (replacing the previous `layout/viewport-rect`). New `LayoutBroker::ApplyFullClient` plus a one-shot call from `HostWindowImpl::Run` just before `ShowWindow` sizes the popup to the main HWND's full client rect at startup. Without this, the popup is stuck at CreateWindowExW's bootstrap rect (screen 16,16,320,240) and renders as a tiny preview at the monitor's top-left corner. Dialogs spec's rescale test reshaped into two tests: one for the DOM gesture (menu→modal→OK), one for the bridge contract (rescale-system → state/changed) — the previous form routed through React's NativeBridge → postMessage and was sensitive to per-T4c boot-time event volume (L-003 + the postMessage drop semantics under CDP). |
| [`ba8a3de`](https://github.com/DrKnickers/new-particle-editor/commit/ba8a3de) | **T4c.5 — Modal snapshot crops to scene rect.** `AlphaCompositor::CaptureSnapshotPng` now crops the cached BGRA buffer to (sceneX, sceneY, sceneW, sceneH) before PNG encode via the GDI+ subregion-view idiom (scan0 offset + parent stride; zero-copy). Falls back to the full DIB when no scene rect has been set (boot state, vitest harnesses that drive CaptureSnapshotPng without dispatching layout/scene-rect first). The Modal portal `<img>` continues to size to quadrant-viewport via CSS; only the PNG bytes change. Modal.test.tsx untouched — the contract is shape-only. |
| [`f3e2ea0`](https://github.com/DrKnickers/new-particle-editor/commit/f3e2ea0) | **T6 — Reset panel layout View-menu item.** New View → Reset panel layout menu item clears the four `alo:layout:*` keys and bumps an epoch counter passed as `key={n}` to `<PanelLayout />` so React remounts and the new mount's `loadLayout` calls read defaults. Exports `PANEL_LAYOUT_KEYS` + `resetPanelLayoutStorage` from PanelLayout (helper stays close to the persistence layer; unit test asserts key-set coverage to guard against drift). MenuBar threads `onResetPanelLayout` per existing `onOpen*` pattern. Vitest +4 (3 PanelLayout helpers + 1 MenuBar integration). Browser smoke verified end-to-end: seeded non-default splitter values, clicked the menu item, separators restored to in-code defaults with zero console errors. |
| **(T7)** | **Strip `[splitter]` dev breadcrumbs — no-op.** `git grep '[splitter]'` across web/ surfaced zero hits in source — only doc references in HANDOFF/todo.md. No commit. |
| `TODO-HASH` | **T8 — docs.** This dispatch's CHANGELOG entry (B1.4 [NT-8]); ROADMAP strikethrough + Shipped move + tag vacation for [NT-8] + new [MT-11] architecture-C migration entry at 2.1; tasks/HANDOFF refresh for next session; tasks/todo.md review section appended. |

---

## Open items — none

All four T4c-area close-out pieces shipped this session. The B1.4 [NT-8] arc is complete and ready for end-of-session FF + push to `origin/lt-4`. The next dispatch picks from the **Next dispatch options** table at the top of this file.

**Architecture observations carried forward (filed as ROADMAP [MT-11] + lessons.md L-014).**

1. **The user-visible cutout artifact under T4c is a hard limit of architecture A** (engine popup above WebView, alpha-cutout for HTML chrome). It's not a tuning problem; it's the cutout shape becoming visible. L-011 captures the rule; this session added *why* the rule has no clean workaround under T4c. [MT-11] (architecture C — canvas-in-DOM) is the migration path.
2. **Architecture B (FD6 DComp visual hosting) was attempted 3 times historically and abandoned.** Don't re-spike unless WebView2's DComp story changes. See [`docs/superpowers/plans/2026-05-18-fd9-viewport-alpha-compositing.md:22`](../docs/superpowers/plans/2026-05-18-fd9-viewport-alpha-compositing.md:22).
3. **L-013's "Win32 drag-resize starves WebView2 IPC" extends to splitter drag inside WebView**, not just modal sizing loops. T4c sidesteps this by removing the popup-resize step from the splitter-drag path entirely (scene-rect is alpha-mask-only, no Engine::Reset).
4. **`react-resizable-panels@4.x` quirks** are now in lessons.md L-014: numeric `Panel.defaultSize` props are PIXELS not percentages (use `"NN%"` strings); `Group.defaultLayout` is effectively an SSR hint, `Panel.defaultSize` is the canonical client knob.

---

## Test counts + verification at handoff

- **Vitest:** 294 / 294 (was 281 baseline pre-B1.4; +9 PanelLayout from session 1, +4 T6 from this session).
- **Native Playwright:** 90 / 90 (was 83 baseline pre-B1.4; +6 from `tests/splitters.spec.ts`, +1 from the dialogs.spec.ts rescale split).
- **MSBuild Debug x64:** clean (preexisting LIBCMTD warning unchanged).
- **Manual smoke (T4c.4 build):** drag works smoothly across all four splitters; startup popup appears correctly inside the main window (no monitor-corner artifact); cutout artifact visible in chrome dropdowns (the architecture-A limit — [MT-11] migration path filed).
- **Browser smoke (T6, this session):** seeded non-default splitter values via `localStorage.setItem`, clicked View → Reset panel layout, verified separator aria-valuenow restored to in-code defaults (25/20/75/60), zero console errors.

---

## Read first

If you are a fresh Claude session resuming this project:

1. **This file** — top to bottom.
2. **[CLAUDE.md](../CLAUDE.md)** — project conventions, plan structure, handoff discipline. The `## Branch workflow` section is load-bearing: `lt-4` is the integration branch; new sessions land on `claude/<random>` and FF into `lt-4` at session end.
3. **[CHANGELOG.md](../CHANGELOG.md)** — the top entry (B1.4 resizable splitters) covers what just shipped; the B1.3.2 entry below covers the section-header unification + inspector polish; the B1.3.1.1 entry below covers the frosted-glass modal backdrop; entries further down (B1.3 tab parity, B1 left-pane realignment, Phase 2 redesign, Phase 1 tokens + theme) cover the architectural foundation.
4. **If picking up B1.3.1 / B1.4 / Phase 3** (most likely next step):
   - **[docs/superpowers/specs/2026-05-20-b1-3-tab-parity.md](../docs/superpowers/specs/2026-05-20-b1-3-tab-parity.md)** — B1.3 spec (reference for B1.3.1's place in the sequence).
   - **[docs/superpowers/specs/2026-05-19-particle-editor-2026-redesign.md](../docs/superpowers/specs/2026-05-19-particle-editor-2026-redesign.md)** — original full design spec.
   - **[docs/superpowers/plans/2026-05-19-particle-editor-2026-redesign.md](../docs/superpowers/plans/2026-05-19-particle-editor-2026-redesign.md)** — step-by-step plan. **Phase 3 still references `tailwind.config.ts` in a few places — those need the same Tailwind v4 / `globals.css` translation Phase 1 got** (see the re-plan note at the top of Phase 1 for the pattern).
5. **[tasks/lessons.md](lessons.md)** — L-001 through L-014. **L-006 (don't clear React optimistic state on every host-data refresh) is load-bearing in `CurveEditorPanel.tsx`.** **L-010 (sweep BOTH vitest and Playwright on every label rename) applies to any future inspector field rename.** **L-011 + L-012 + L-013 are the load-bearing context for the new Modal architecture — read them before touching the snapshot-backdrop path or any other engine-popup-overlapping surface.** L-013 specifically: the Win32 modal sizing loop starves WebView2 IPC; design host-durable state for anything that must survive a drag-resize. **L-014 (react-resizable-panels 4.x quirks)** matters any time PanelLayout is restructured: numeric `Panel.defaultSize` props are PIXELS not percentages (use `"NN%"` strings); `Group.defaultLayout` is effectively an SSR hint, `Panel.defaultSize` is the canonical client knob.
6. **[tasks/lt4_phase_4_1_acceptance.md](lt4_phase_4_1_acceptance.md)** — parity acceptance checklist. §16 lists intentional divergences from legacy. The 2026 redesign's structural moves don't update this doc; treat it as parity baseline for the legacy `--legacy-ui` path only.
7. Recent `git log --oneline -20` — Phase 1 + 2 of the redesign at the tip, prior LT-4 dispatch history below.

---

## Resumable state (snapshot)

| Thing | Value |
|---|---|
| **Worktree** | `C:\Modding\Particle Editor\.claude\worktrees\angry-hypatia-6a4efe` (this session's; next session gets a fresh `claude/<random>` path) |
| **Branch** | `claude/angry-hypatia-6a4efe` → integrates back into `lt-4` per the standard end-of-session FF. Tracks `origin/lt-4`. |
| **HEAD (committed)** | `TODO-HASH` (this T8 docs commit). Session has 3 close-out commits ahead of `origin/lt-4`: `ba8a3de` (T4c.5) + `f3e2ea0` (T6) + this docs commit. Plus the 12 mid-arc commits already on `origin/lt-4` at `962e5f4` (the prior session's mid-arc handoff). |
| **Working tree** | clean (after docs commit). |
| **Ahead of origin/lt-4** | 3 (T4c.5 + T6 + this docs commit) — pending FF + push to `origin/lt-4` with the user's OK. Pre-FF `origin/lt-4` HEAD is `962e5f4` (prior session's mid-arc handoff commit). |
| **Behind master** | `lt-4` is ~380+ commits ahead of `master` (`b28f624`); none merged yet, all backed up to `origin/lt-4`. |
| **Open PRs** | none |
| **Build status** | MSBuild Debug x64 clean (preexisting LIBCMTD warning). C++ touched this session: `AlphaCompositor::CaptureSnapshotPng` crop (T4c.5). Vitest **294 / 294**. Playwright **90 / 90**. |
| **Phase status** | Particle Editor 2026 redesign — **Phase 1 + Phase 2 + curve editor polish + B1 + B1.2 + B1.2.1 + B1.3 + B1.3.1 + B1.3.1.1 + B1.3.2 + B1.4 [NT-8] SHIPPED.** B1.4 pending FF (3 commits). Next dispatch options listed at top of file. Phase 3 of the 2026 redesign (dialog re-skin, Tailwind cleanup, theme-persistence test) remains not started. Legacy `--legacy-ui` mode is untouched throughout. |

**Worktree note.** The Claude Code desktop app provisions a fresh worktree on every session start; this session was in `agitated-margulis-854108`, succeeding `brave-buck-1295c8`. Branch name follows the worktree name. The commit lineage is preserved — only the path / branch label change.

**Sister-worktree sync note.** Prior sessions noted `lt-4` checked out at `C:/Modding/Particle Editor/.claude/worktrees/great-varahamihira-b66cf4` with a stale local ref. The fresh `claude/<random>` worktree the desktop app provisions for the next session branches directly from `origin/lt-4` so the per-worktree local ref doesn't matter; only the sister-worktree case (someone manually checking out `lt-4`) needs `git fetch && git merge --ff-only origin/lt-4` before working there.

**NuGet pre-flight (fresh worktrees only).** `.gitignore` excludes `packages/`, so the first MSBuild in a fresh worktree fails with *"missing Microsoft.Web.WebView2.targets"*. Restore explicitly before the first build:

```bash
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" \
  "ParticleEditor.sln" //t:Restore //v:m
```

Then the standard Debug x64 build works. Skip this step on a worktree that's already been built in once.

---

## What landed this session — B1.3.2 (1 impl commit + 1 docs commit, PENDING FF)

In execution order (newest first):

| Commit | What |
|---|---|
| `TODO-HASH` | **docs(LT-4): B1.3.2 handoff — shared section CSS + 15 polish items shipped.** This docs commit. Adds CHANGELOG entry; refreshes HANDOFF + todo.md review. |
| [`65a5eae`](https://github.com/DrKnickers/new-particle-editor/commit/65a5eae) | **feat(LT-4): B1.3.2 — unify section headers + inspector polish rounds.** Shared `.panel-section` CSS class consumed by both `Section.tsx` (controlled `useState` + `data-open`) and `ToolPanel.Section` (native `<details>`); rotation selector bridges the two state shapes. Lucide ChevronDown replaces ASCII `›` in ToolPanel.Section. Legacy `.section-*` CSS deleted; `.section-divider` kept as standalone hairline primitive. Same commit folds 15 inspector polish items: dropdowns widened where long labels truncated (Physics Type / Appearance Blend mode / Basic Emit mode / Physics Behavior); Tail length spinner +25 % width; RGBA cluster gains R/G/B/A micro-labels + 2x2 layout; long-label checkboxes (Link particles to instance + Object space acceleration) adopt `inlineLabel` prop with label-wraps-not-truncates; ALL checkboxes right-edge-align via `grid-column: 2; justify-self: end` (pins right edge to spinner number-input column's right edge across every form-row width variant); Basic-tab numeric spinners get +25 % width via single scoped `.basic-tab .form-row` CSS rule; Spawn now button moves into Mode section (manual-only); Burst becomes collapsible. New `widthBoost?: "mid" \| "wide" \| "x2"` prop on FieldSelect / FieldSpinner maps to .form-row-mid-input / -wide-input / -x2-input CSS modifiers (73 / 87 / 116 px input columns). |

---

## What landed this session — B1.3.1.1 (4 impl commits + 1 docs commit, FF'd mid-session at `37a99fb`)

In execution order (oldest → newest):

| Commit | What |
|---|---|
| [`1e49d37`](https://github.com/DrKnickers/new-particle-editor/commit/1e49d37) | **feat(LT-4): B1.3.1.1 P2+P3 — engine viewport snapshot bridge surface.** AlphaCompositor caches a pre-stamp BGRA DIB in `m_lastRawDib` each frame (after readback memcpy, before stamps). New `CaptureSnapshotPng(outBase64, outW, outH)` method wraps the cached pixels zero-copy in a `Gdiplus::Bitmap` (`PixelFormat32bppARGB`, BGRA byte order matches), saves to PNG via in-memory IStream, base64-encodes via inline 30-line encoder. LayoutBroker.CaptureSnapshotPng forwards to the compositor. BridgeDispatcher adds the `viewport/capture-snapshot` handler returning `{ pngBase64, w, h }` on success or empty payload when no frame has composited yet. HostWindow brackets the message pump with `Gdiplus::GdiplusStartup/Shutdown`. Schema entry + MockBridge stub (empty-PNG short-circuits the render guard). |
| [`f3570d3`](https://github.com/DrKnickers/new-particle-editor/commit/f3570d3) | **feat(LT-4): B1.3.1.1 P4 — Modal frosted-glass backdrop via engine snapshot.** Modal's useEffect drives snapshot capture + full-quadrant occlude on open; renders the returned PNG as an `<img position:absolute; inset:0>` via `createPortal` into the quadrant-viewport DOM; cleanup on close. Regression test pivots from `set-modal-mask` assertion to the new contract + `expect.not.toHaveBeenCalledWith({ kind: "viewport/set-modal-mask" })` to lock the upcoming deletion. The existing opaque-bg / no-backdrop-filter / no-shadow-xl regression guards stay. |
| [`cb7b4c7`](https://github.com/DrKnickers/new-particle-editor/commit/cb7b4c7) | **fix(LT-4): B1.3.1.1 P5 polish — sentinel-rect occlude + one-shot capture.** Two smoke-test findings, same root cause (Win32 modal sizing loop starves WebView2 IPC — L-013). (1) Drag-resize leaks opaque engine pixels because the renderer-side rect can't reach the host during the modal loop. Fix: sentinel rect (-1e5, -1e5, 2e5, 2e5) — `ApplyOcclusion` clips to current DIB bounds, resize-resilient by construction without needing fresh round-trips. (2) Drag-resize stutters because per-frame ~10-30 ms GDI+ encodes stack on the engine's per-WM_SIZE D3D9 Reset. Fix: capture once on modal open, never re-capture — img scales via CSS, blur hides content staleness. |
| [`c287033`](https://github.com/DrKnickers/new-particle-editor/commit/c287033) | **refactor(LT-4): B1.3.1.1 P6 — drop modal-mask compositor pipeline.** Deletes the now-dead server-side machinery: `SetModalMask`, `BoxBlurDibBgra`, `MultiplyDibAlphaBgra`, `FadePopupEdges`, `Smoothstep01Edge` helpers; `m_globalAlpha` / `m_blurRadius` / `m_blurScratch` fields; the modal-mask call sites in Composite; LayoutBroker's SetModalMask declaration + forwarding; BridgeDispatcher's viewport/set-modal-mask handler; schema entry; MockBridge case. **256 lines net deleted from AlphaCompositor.cpp.** The Modal regression test from P4 already asserts no set-modal-mask dispatch via `expect.not.toHaveBeenCalledWith`, locking the deletion. |
| `TODO-HASH` | **docs(LT-4): handoff — B1.3.1.1 shipped.** This docs commit. CHANGELOG entry at top; ROADMAP strikes NT-9 + moves to position 5.1 in Shipped (renumbering Near-term 1.x and Shipped 5.x throughout); lessons.md L-013 added (Win32 modal sizing loop starves WebView2 IPC); todo.md gets a review section; HANDOFF refreshed for next session. |

---

## Previously landed (kept for context)

B1.3.1 + 9 polish rounds (shipped at `386c37b` on `origin/lt-4` via the prior session's FF — the dispatch directly preceding this one). Core B1.3.1 landed always-mounted tab strip + flex split between tree and tabs (25/75 favouring tabs). Polish rounds 1-9 covered: split-ratio tuning, inspector right-padding + toolbar File wiring + tree-toolbar pinning, file-open emit tree-changed + ReloadTextures, ViewportPill + Recents submenu occlusion registration, Shift+LMB cursor-bound spawn, Modal overlay occlusion + diagnostic-logs round, opaque chrome where HTML effects can't reach engine, BridgeContext (replacing broken `window.bridge`), modal-mask compositor pipeline (interim — DELETED in this session's B1.3.1.1 dispatch). 11 commits total + a docs commit. Lessons.md L-011 (HTML CSS effects can't reach engine compositing layer) and L-012 (`window.bridge` → use BridgeContext) filed.

B1.3 (the dispatch before that, shipped at `f12d6f2`) restructured the three property tabs to legacy `IDD_EMITTER_PROPS1/2/3` shape — three Sections per tab matching legacy GROUPBOX structure section-for-section, twelve field placements migrated to legacy homes, tri-state Generation radio mutex with full a11y plumbing (`role="radiogroup"` + roving tabIndex + arrow-key cycling), a bundled `displayInvertedPercent` correctness fix on `FieldSpinner` (the new UI was reading `randomLifetimePerc=0.25` as `0.25%` instead of legacy's `75%` minimum), trailing-colon label convention applied to every field, "World Oriented" → "Always face camera" with semantic flip, four fields dropped from UI but retained on the wire (`nTriangles`, `weatherFadeoutDistance`, `groups[1]` Lifetime random-param, `index`). Two two-stage-review fix commits caught real issues — `b929e47` (a11y RadioRow extraction) and `3b191fd` (weather-disable cascade parity per legacy `src/UI/Emitter.cpp:175-190`). Two polish rounds folded user smoke-test findings — `3ae940e` (dark scrollbar inside Tabs.Content + form-row template tuning) and `82917f0` (per-axis X/Y/Z micro-labels above every Vec3 cluster + texture-input widening + SpawnerPanel scroll fix). 14 commits total, FF'd to `origin/lt-4` at the end of that session. **Lessons.md L-010** filed: inspector field labels are public API; sweep BOTH vitest and Playwright on every rename.

The earlier Phase 1 + Phase 2 + curve-editor-polish dispatches are still the structural foundation under B1 + B1.2 + B1.3. In execution order (oldest → newest):

| Commit | What |
|---|---|
| `c92c76e` | **docs(LT-4): re-plan Phase 1 for Tailwind v4 reality** — rewrote Phase 1 of the plan in place when the original draft turned out to assume Tailwind v3 with a JS `tailwind.config.ts` that doesn't exist (project is on Tailwind v4, CSS-first `@theme`). Phase 1 renumbered to 7 tasks (was 8); the deleted Task 1.3 ("Extend Tailwind config") folded into the new Task 1.1's `@theme inline` block. |
| `9df821d` | **feat(LT-4): Phase 1 — token system + theme toggle** — single squashed commit. New CSS files under `src/styles/` (`tokens.css` with `:root` + `[data-theme="light"]` + `@theme inline`; `base.css` with `@font-face` for Inter + scrollbar styling; `components.css` from the design bundle's reusable classes). Inter variable woff2 bundled at `public/fonts/inter/InterVariable.woff2` (note rename from the spec's stale filename). `globals.css` drops the legacy `@theme` block (verified zero consumers) and imports the three new files. `ThemeToggle.tsx` is a Sun / Moon segmented control; theme persists to `localStorage('alo:theme')` with a `matchMedia('(prefers-color-scheme: dark)')` fallback. `App.tsx` applies the same logic at mount so first paint is themed. `test-setup.ts` gains `localStorage` + `matchMedia` stubs and an `afterEach localStorage.clear()`. 30-file utility-class sweep replaces `bg-neutral-*` / `text-neutral-*` / `border-neutral-*` / `sky-*` with token-backed equivalents per a fixed substitution table. |
| `24179ec` | **fix(LT-4): align five View-menu items missing the CheckSlot indent** — Step Forward / Reset Camera / Reload Shaders / Reload Textures / Reset View Settings were rendering text flush against the menu's left padding while sibling items with checkboxes had 14 px of indent. Fix is one empty `<CheckSlot active={false} />` per item. Pre-existing alignment bug; surfaced during Phase 1 visual verification. |
| `64b49ed` | **feat(LT-4): Phase 2.1 — toolbar reorganization** — Toolbar.tsx uses the design's semantic classes (`.toolbar` / `.tb-group` / `.tb-btn` / `.tb-divider` / `.tb-spacer`); four groups (File · Playback · Spawner toggle · spacer · Environment + ThemeToggle); removes Undo/Redo/Bloom/Reload (they live in the menubar); adds Save As and Step 10; new `useSpawnerVisibility` per-component hook (upgraded in 2.4). |
| `6aa6206` | **feat(LT-4): Phase 2.2 — Background → toolbar dropdown popover** — new `BackgroundDropdown` + `OccludingPopover` (generalisation of `OccludingMenubarContent` so the popover registers as a viewport occlusion). `BackgroundPicker` body extracted as `BackgroundPickerBody`. Slide-in mount removed from App.tsx. `BackgroundButton.tsx` deleted. |
| `2a77249` | **feat(LT-4): Phase 2.3 — Ground → toolbar dropdown popover** — same pattern. New `GroundDropdown`; `GroundTexturePanelBody` extracted. |
| `2759c27` | **chore(LT-4): remove dead Background/Ground Texture entries from View menu** — small follow-up to 2.2/2.3. The View menu's "Background…" and "Ground Texture…" items had been left in place during the per-task commits; they were no-ops after the slide-ins came out. Now removed along with their `onOpen*` props. |
| `17768b6` | **feat(LT-4): Phase 2.4 — Spawner permanent right column** — `useSpawnerVisibility` upgraded to a Zustand store (`useSpawnerVisible` / `useToggleSpawner` / `toggleSpawner` + a `useSpawnerVisibility` compat shim + `__resetSpawnerVisibilityForTests`). SpawnerPanel uses `.panel` / `.panel-header` (X-close → toggleSpawner) / `.panel-body` instead of ToolPanel. App.tsx workspace becomes 3-column when visible. Emitters menu's "Spawner…" rewired to `toggleSpawner`. |
| `0fd093d` | **feat(LT-4): Phase 2.5 — left panel restack with .panel chrome + .form-row grid** — left column wraps in `.panel` chrome (header "Particle System"). The 46-ish form rows across Basic / Appearance / Physics tabs convert to the design's `.form-row` 3-column grid (label / input / unit) via the existing `FieldText` / `FieldSpinner` / `FieldCheckbox` primitives. Multi-spinner clusters (Random Colours, Acceleration, Vec3Row) use `gridColumn: "2 / span 2"` inline as a tactical workaround. |
| `329c595` | **feat(LT-4): Phase 2.6 — curve editor moves to always-on bottom 260px** — new `CurveEditorPanel.tsx` in the centre column's bottom row; 7-channel curve-list (Scale / R / G / B / A / Rotation / Index — Index defaults off); multi-channel SVG overlay rendering one `<g data-testid="curve-layer-${id}">` per visible channel. **This commit deleted `TrackEditor.tsx` (866 lines) and `EmitterPropertyPanel.tsx` (176 lines) entirely**, losing the entire curve edit surface (Time/Value spinners, marquee, drag, Insert mode, interpolation toggle, lock-to combo, per-key context menu, panel-level Delete handler). Phase 2.8 restores them on top of this rendering substrate. |
| `83ee7a5` | **feat(LT-4): Phase 2.7 — viewport pill + engine/set/leave-particles bridge** — new top-left vertical pill in the viewport with three engine toggles (Show ground / Toggle bloom / Leave particles after instance death). The leave-particles bridge surface is new end-to-end (schema + MockBridge + C++ dispatcher), wired to ParticleSystem's existing `getLeaveParticles()` / `setLeaveParticles()` methods — the runtime path was already chunk-serialised + honoured at `Engine::KillParticleSystem`. |
| `3cd840a` | **feat(LT-4): hybrid focus-channel curve editor — restore edit surface** — restores everything Task 2.6 deleted on top of the multi-channel overlay using a focus-channel model. Clicking a channel row sets that channel as the edit focus (visible indicator: `data-focus="true"` + `bg-accent-soft`); the focus channel's curve renders thick + opaque + interactive while the other visible channels render thin + dimmed + non-interactive as background context. New `.ce-toolbar` row above the canvas with Select / Insert mode toggle, Linear / Smooth / Step interpolation, Lock-to combo, Time / Value spinners (L-006 sticky optimistic override). Window-scoped Delete keyboard handler with `TYPING_TAGS` guard. Vitest +19 (200 → 219); Playwright +4 (78 → 82 passing). |
| `339ab95` | **feat(LT-4): curve editor polish — lock-to, axis labels, theme grid, robust spinners, spawner bg fix** — the dispatch immediately preceding B1, FF'd to `origin/lt-4`. Lock-to wired end-to-end (`emitters/set-track-lock`), HTML axis labels, theme-aware grid via CSS variables, native-wheel-listener spinners, Spawner panel bg opacity. Vitest 219 → 221. |

---

## Open items (load-bearing — read before resuming)

### 0. ~~B1.3.1.1 [NT-9]~~ ✅ SHIPPED on session branch (NOT YET FF'd)

Full breakdown in the "What landed this session" table above and the top-of-CHANGELOG entry. The snapshot-into-DOM approach landed cleanly across four commits; the modal-mask C++ machinery is gone. The end-of-session FF + push to `origin/lt-4` is pending the user's OK.

### 0a. B1.4 [NT-8] — Resizable splitters via `react-resizable-panels` (NEXT DISPATCH)

Now top of Near-term. Same scope as previously planned: drag the left/centre/right column boundaries (and the tree/tabs split inside the left column) via `react-resizable-panels`, persist to `localStorage`. Defaults match B1.3.1's 25/75 inner split and the existing fixed-width column sizes. No bridge schema, no C++. Standard CLAUDE.md plan expected.

### 0b. B2 obsolescence audit (small warm-up alternative)

B1.3 wired every field on the Appearance and Physics tabs through the existing `commit()` helper as part of the restructure — they now drive engine state through the bridge identically to BasicTab. Before re-scoping or executing B2 as originally planned, the next session should diff the current Appearance + Physics implementations against B2's original target spec and verify what (if anything) remains undone. A quick "audit B2 scope" sub-task probably resolves the entire item to "retire B2 — fully covered by B1.3".

### 0c. MT-1 follow-up — Texture picker "..." buttons still unimplemented

Legacy `IDC_BUTTON1` / `IDC_BUTTON2` at [`src/ParticleEditor.en.rc:387-389`](../src/ParticleEditor.en.rc) are not wired in the new UI. MT-1 covers the recents/pinned case; the "..." browse path needs the same React equivalent. Comment marker `TODO(MT-1)` exists in `EmitterPropertyTabs.tsx` for grep-ability.

### 0d. Legacy B1.3.1.1 planning notes (kept for reference if you need the design rationale)

**Why the snapshot-into-DOM approach is the right one** (investigated across the prior B1.3.1 polish rounds + this session's smoke-tests):
- HTML CSS effects (`backdrop-filter`, `box-shadow` of any large extent) can't sample engine viewport pixels — engine is a separate compositing layer (FD9b layered Win32 popup), not a DOM element. L-011 has the full rationale.
- Server-side dim+blur of the engine (the modal-mask path) works for the engine pixels themselves, but the popup HWND boundary against the CSS-dimmed panels still draws a visible rectangle.
- The snapshot-into-DOM approach lifts engine pixels INTO the WebView2 DOM tree (frozen at one frame), so CSS effects sample them natively. No layer boundary visible.

**Open implementation choices flagged (decided in prior session):**
- PNG encoding via GDI+ (already in Windows SDK).
- Live re-capture on window resize (rAF-throttled).
- Skip nested-modals concern (not a current use case).

### 0a. ~~B1.4 [NT-8]~~ — Resizable splitters via `react-resizable-panels` (queued behind B1.3.1.1)

Now the second-priority. Same scope as previously planned: drag the left/centre/right column boundaries (and the tree/tabs split inside the left column) via `react-resizable-panels`, persist to `localStorage`. Defaults match B1.3.1's 25/75 inner split and the existing fixed-width column sizes. No bridge schema, no C++. Standard CLAUDE.md plan expected.

### 0b. B2 obsolescence audit (small warm-up alternative)

B1.3 wired every field on the Appearance and Physics tabs through the existing `commit()` helper as part of the restructure — they now drive engine state through the bridge identically to BasicTab. Before re-scoping or executing B2 as originally planned, the next session should diff the current Appearance + Physics implementations against B2's original target spec and verify what (if anything) remains undone. A quick "audit B2 scope" sub-task probably resolves the entire item to "retire B2 — fully covered by B1.3".

### 0c. MT-1 follow-up — Texture picker "..." buttons still unimplemented

Legacy `IDC_BUTTON1` / `IDC_BUTTON2` at [`src/ParticleEditor.en.rc:387-389`](../src/ParticleEditor.en.rc) (the "..." browse buttons next to the Color and Bump texture filename inputs) are not wired in the new UI. The MT-1 frequently-used textures palette covers the common case (pick from recents / pinned), but the "..." browse path — `GetOpenFileName` filtered to `*.dds;*.tga;*.png;*.jpg` — needs the same React equivalent to land. Worth filing as a separate dispatch once B1.4 ships. Comment marker `TODO(MT-1)` exists in `EmitterPropertyTabs.tsx` for grep-ability.

### 1. ~~B1.3.1 inspector layout follow-ups~~ + 9 polish rounds ✅ SHIPPED on the session branch (NOT YET FF'd)

12 commits total on the session branch — see the "What landed this session" table above for the full breakdown. The core B1.3.1 work (always-mounted tab strip + 25/75 flex split) ships clean; the 9 subsequent polish rounds cover everything from inspector right-padding to the modal-mask compositor pipeline. **Round 9 has a known visual artifact** (inner-shadow halo at the popup boundary when a modal is open) — explicitly documented as superseded by the next session's B1.3.1.1 dispatch.

**Status:** 12 commits ready to FF; user has not yet OK'd the push. The FF decision is itself a choice — either FF now (interim state with the inner-shadow artifact lands on `lt-4`) or wait for B1.3.1.1 to complete then FF the whole arc together.

**Recommended:** FF now. The artifact is real but tolerable, the B1.3.1 core is genuinely shipped + valuable, and `origin/lt-4` is a backup branch (not master) so the cost of having an interim state there is low.

### 1b. ~~B1.3 tab parity reorg~~ ✅ SHIPPED previous session (FF'd to `origin/lt-4` at `f12d6f2`)

P1 (pre-flight) → P8 (this docs commit), 10 implementation commits + 2 docs commits (spec, plan). Two two-stage-review fix commits caught real issues — P3 follow-up `b929e47` (a11y RadioRow extraction) and P6 follow-up `3b191fd` (weather-disable cascade parity). Two polish rounds folded user smoke-test findings (`3ae940e` dark scrollbar + form-row truncation; `82917f0` Vec3 axis labels + cluster widening + Spawner scroll). See top-of-CHANGELOG entry for the full breakdown; high-level summary:

- **Three property tabs match legacy `IDD_EMITTER_PROPS1/2/3` section structure** (Basic: Emitter Timing / Generation / Connection; Appearance: Textures / Random color / Tail / Rotation / Rendering; Physics: Initial position / Initial speed / Acceleration / Ground interaction).
- **Twelve field placements migrated to legacy homes** — rotation cluster, parent link strength, random scale, affected-by-wind, emit mode/offset, weather particle + cube size + fadeout distance.
- **Tri-state Generation radio mutex** with atomic two-key bridge patches; hand-rolled `RadioRow` component with `role="radiogroup"` + roving tabIndex + arrow-key cycling.
- **`displayInvertedPercent` prop** on `FieldSpinner` — bundled correctness fix for "Minimum lifetime:" and "Minimum scale:" (the new UI was displaying `0.25` as `0.25%` instead of legacy's `75%` minimum).
- **"Always face camera"** label replaces "World Oriented" with semantic flip; BLEND_BUMP cascade preserved.
- **Trailing-colon label convention** applied to every field; section titles stay colon-less.
- **`GroupSection` renamed `GroupBody`** — wraps inside parent `Section`; fieldset/legend chrome dropped.
- **Per-axis X/Y/Z micro-labels** above every Vec3 cluster (inspector + Spawner).
- **Four fields dropped from UI** (`nTriangles`, `weatherFadeoutDistance`, `groups[1]`, `index`) — all four stay on the wire for round-trip safety.

**Status:** 13 commits ready to FF into `lt-4` at user's explicit OK.

### 1b. ~~B1 left-pane realignment~~ ✅ SHIPPED (FF'd to `origin/lt-4` two sessions ago)

P1–P8 implementation + brainstorm + plan + the B1 P9 docs commit. Full breakdown in CHANGELOG entry from earlier this month.

Two ROADMAP follow-ups filed for B1 work that's worth doing later but deliberately out-of-scope:

- **[NT-5] Engine-side single-member link-group enforcement.** B1 ships a render-layer filter; the data layer can still carry single-member groups. NT-5 makes the data layer match the rendered view end-to-end across the three C++ mutation paths.
- **[NT-6] Visual-stability lane assignment for bracket gutter (option).** B1 uses aggressive-reuse greedy first-fit; a setting that opts the user into `lane = (groupId - 1) % maxLanes` would keep lanes stable across renders. Only worth doing if the bouncing turns out to be a real ergonomic issue.

### 1c. ~~B1.2 left-pane polish + B1.2.1 label-truncation polish~~ ✅ SHIPPED (FF'd to `origin/lt-4` prior session)

Full breakdown in the corresponding CHANGELOG entry. Predecessor on `lt-4` is `4edcc3a` (`docs(LT-4): handoff for new session — B1.3 reorg proposal + B1.2.1 polish in HANDOFF`).

### 1. ~~Ground-texture engine bug~~ ✅ FIXED 2026-05-20 (commit `92ed1db`)

The ground-texture lockup is fixed. Root cause: `m_pSkydomeEffect` (added in MT-3) was missing from `Engine::Reset`'s `OnLostDevice` / `OnResetDevice` pattern, leaving `D3DPOOL_DEFAULT` references active across `IDirect3DDevice9::Reset` → device latched at `D3DERR_DEVICENOTRESET` → all subsequent `D3DX*` calls failed with `D3DERR_NOTAVAILABLE`. Two-line fix in [`engine.cpp:1360`](src/engine.cpp:1360). Belt-and-suspenders: `Engine::RecoverDeviceIfNeeded()` ([`engine.h:123`](src/engine.h:123)) + `LayoutBroker::Apply` catch-path fallback. Full diagnostic trail in [`tasks/lessons.md` L-007](lessons.md).

**`abort()` dialog (user-reported, prior handoff).** Not reproduced. Probably a separate code path; could have been a stale capture. Worth checking if it resurfaces.

### 1b. ~~Curve editor polish~~ ✅ SHIPPED 2026-05-20 (commit `339ab95` FF'd to `origin/lt-4`)

A round of interactive smoke-testing through the curve editor surfaced a stack of issues the user wanted addressed. All fixed and verified through `pnpm build` + `pnpm test` + MSBuild + `pnpm test:native` (83/83). See top-of-CHANGELOG entry for the full breakdown; high-level summary:

- **Spawner panel transparent leak** → `bg-panel` on the right aside.
- **Curve editor strip layout** → `minmax(0, 1fr)` row/col templates, `h-[290px]`, `flex: 1` on `.curve-editor`.
- **Lock-to feature wired end-to-end** → new schema kind `emitters/set-track-lock`, C++ handler swapping `emit->tracks[i]` pointer, `TrackDto.lockedTo` derived from pointer equality, React dispatches on dropdown change, edit affordances disable when locked.
- **Per-channel value-range rules** → RGBA fixed `{0,1}`, Scale/Index auto-grow upper, Rotation auto-grows both ways with no caps.
- **Spinner-bounds vs display-range split** → fixed the "can't push Scale past 20" deadlock.
- **Toolbar icons** (Lucide + inline SVG glyphs for the interp modes) with `flex-wrap` fallback for narrow windows.
- **Spinner improvements** → always-visible arrows, native-wheel-listener-with-`{passive:false}` (bypasses React 18 passive default), wheel works anywhere over the spinner including the arrow column.
- **HTML axis labels** in a CSS-grid sibling cell (avoids `preserveAspectRatio="none"` glyph distortion).
- **Theme-aware grid colours** via `--curve-grid` / `--curve-axis` CSS variables (dimmer in light theme).
- **`overflow="visible"` on the SVG** so endpoint key circles draw their full body even when their centre is on the grid edge.

**Status:** FF'd to `origin/lt-4` at the start of this session as `339ab95`. No outstanding work.

### 1c. ~~B1 left-pane realignment~~ ✅ SHIPPED (FF'd to `origin/lt-4` at the start of this session)

P1–P8 implementation + brainstorm + plan + the B1 P9 docs commit. FF + push completed at session start. Full breakdown in the "B1 trailing commits" table above and the second CHANGELOG entry.

Two ROADMAP follow-ups filed for B1 work that's worth doing later but deliberately out-of-scope:

- **[NT-5] Engine-side single-member link-group enforcement.** B1 ships a render-layer filter; the data layer can still carry single-member groups. NT-5 makes the data layer match the rendered view end-to-end across the three C++ mutation paths.
- **[NT-6] Visual-stability lane assignment for bracket gutter (option).** B1 uses aggressive-reuse greedy first-fit; a setting that opts the user into `lane = (groupId - 1) % maxLanes` would keep lanes stable across renders. Only worth doing if the bouncing turns out to be a real ergonomic issue.

### 1d. ~~B1.2 left-pane polish~~ ✅ SHIPPED earlier this session (FF'd to `origin/lt-4` at `e99e7b5`)

P2 Section + P3 BasicTab restructure + P3-fix `.name-row` refactor + P4 Duplicate + P5 Show/Hide icon swap + P6 CHANGELOG/HANDOFF + partial-backfill commit. Full breakdown in the "What landed this session" table above and the second CHANGELOG entry from the top.

### 1e. ~~B1.2.1 inspector label-truncation polish~~ ✅ SHIPPED this session (uncommitted FF + handoff docs — needs push)

Single follow-up fix commit `3a7a159` ("inspector label-truncation polish") catching three layered causes of label truncation that user-testing surfaced after B1.2 landed: double padding on Basic-tab Tabs.Content + design-source form-row template tuned for shorter labels + section bodies missing the indent needed to align with section title text. No new tests, no test count delta. User accepted the fix mid-session.

This handoff-refresh docs commit + the `tasks/b1.3_legacy_parity_reorg_proposal.md` commit are the docs for this round; all three (polish fix + proposal doc + this HANDOFF) push together to `origin/lt-4` at session close.

### 2. Phase 2 / 3 references to `tailwind.config.ts` in the plan still need v4 translation

Phase 1 of the plan was rewritten in place ([`c92c76e`](https://github.com/DrKnickers/new-particle-editor/commit/c92c76e)) when the original draft assumed Tailwind v3. Phase 2 and Phase 3 of the same plan still reference `tailwind.config.ts` in a few spots — those need the same translation (config moves to a `@theme inline` block in CSS; entry stylesheet is `src/styles/globals.css` not `src/index.css`; the `body { bg-transparent }` FD4 invariant must be preserved). Search the plan for `tailwind.config.ts` to find the spots; the Phase 1 re-plan note documents the translation pattern.

### 3. Phase 3 outstanding work

Per [the plan](../docs/superpowers/plans/2026-05-19-particle-editor-2026-redesign.md), Phase 3 is the cleanup pass:

- **3.1** Modal primitive re-style (cascades to every consuming dialog).
- **3.2** ModNicknameDialog wiring + new `mods/set-nickname` bridge surface (right-click on a Mods menu entry → opens the nickname dialog → writes nickname → re-scans + propagates).
- **3.3** Per-dialog visual passes (ImportEmittersDialog / ModNicknameDialog / RescaleDialog / RescaleEmitterDialog / AboutDialog / SaveChangesPrompt / IncrementIndexDialog / LinkGroupSettingsDialog) — re-skin each dialog body against the new tokens.
- **3.4** Tailwind leftover cleanup sweep (grep for any remaining `bg-neutral-*` / `sky-*` etc. that the Phase 1.6 sweep missed).
- **3.5** Theme persistence Playwright spec (`tests/theme-persistence.spec.ts` driving the ThemeToggle and asserting via `localStorage` + `dataset.theme`).
- **3.6** Docs + final verification + ship — CHANGELOG entries already exist from Phase 1 / 2 / 2.8; Phase 3 adds its own.

Phase 3 is mostly mechanical and smaller surface than Phase 2. Reasonable to do in one session.

### 4. Phase 4.2 cutover still gated

The redesign work is on `lt-4`; legacy `--legacy-ui` Win32 mode is untouched. Phase 4.2 (delete legacy chrome at `src/UI/` and the legacy `main.cpp` paths) is still gated on the user signing off on parity acceptance at [`tasks/lt4_phase_4_1_acceptance.md`](lt4_phase_4_1_acceptance.md) §17 (currently empty). The 2026 redesign may shift the parity conversation — much of the "is parity good enough" question gets resolved by the new design hitting production polish.

---

## Hard-won lessons (preserve!)

All in `tasks/lessons.md`. **Read L-002, L-003, L-004, L-006 carefully before any test / build / optimistic-state work.**

- **L-001** — Don't infer binary provenance from bitness + timestamp alone (Petroglyph 64-bit patch incident).
- **L-002** — Repo-root `.gitignore` `**/packages/*` eats `web/packages/*` source; use scoped negation.
- **L-003** — WebView2 silently drops `chrome.webview.postMessage` after CDP attachment. Playwright contract tests route through `chrome.webview.hostObjects.hostBridge` instead.
- **L-004** — `pnpm test` (Vitest) doesn't type-check. `tsc --noEmit` (single-project) ≠ `tsc -b` (build mode with project references). Truth is `pnpm build`. Verification sequence: `pnpm build` → `pnpm test` → `pnpm test:native`.
- **L-005** — pnpm v11 `allowBuilds:` block wants a boolean, not the literal placeholder string. Edit the workspace yaml directly.
- **L-006** — Don't clear React optimistic state on every host-data refresh. Use sticky overrides cleared only on explicit user-action selection-change. **Now load-bearing in `CurveEditorPanel.tsx` — Phase 2.8's Time/Value spinners use this pattern.**
- **L-007** — When a Playwright contract test fails and the "obvious fix" is to rewrite what the test asserts, verify the rewrite *in-situ under the failing conditions* before relying on it. The bigger test failing while the smaller passes can mean either (a) the bigger was too brittle, or (b) the engine has a real bug that the smaller test ALSO can't see in isolation. Always check (b) before declaring (a). Caught the ground-texture engine bug this session — without the in-situ check, the test-rewrite "fix" would have shipped a silent regression.
- **L-008** — React 18 attaches `wheel` listeners as passive at the root; use a native `addEventListener` with `{ passive: false }` when you need `preventDefault()` to actually work. Otherwise the wheel scroll leaks to the parent pane.
- **L-009** — Never use raw floats as identity keys across the JS/C++ boundary; pre-round at the source with `Math.fround`. The JS `double` ↔ C++ `float` round-trip silently drifts ~1 ULP-of-float32 and breaks any `===` or `Set/Map` keyed lookup.
- **L-010** — Inspector field labels are public API; sweep BOTH vitest and Playwright on every rename. Vitest specs under `src/**/__tests__/` and Playwright specs under `tests/` run via different harnesses, but both can hard-code field labels as DOM selectors. Filed this session after B1.3's P7 caught two label-coupled Playwright specs the spec hadn't anticipated.

### Patterns from this session worth remembering

#### `displayInvertedPercent` prop for legacy inverted-percent fields

The legacy editor's `randomLifetimePerc` and `randomScalePerc` display the *minimum* percentage rather than the random-fraction directly: `displayedPercent = 100 - value * 100`. When wiring legacy fields whose label reads "Minimum X:" but whose schema field stores a 0..1 random-fraction, the inversion is part of the contract — not a UI quirk. The pattern lives on `FieldSpinner` as `displayInvertedPercent?: boolean`; consumers just pass the prop and the spinner handles both render-side (`displayed = 100 - value * 100`) and commit-side (`value = (100 - displayed) / 100`) transforms. Audit before adding any new "Minimum ..." label against the legacy `.rc` to see if the same inversion applies.

#### `.axis-cell` / `.axis-lbl` micro-labels above Vec3 clusters

Three side-by-side spinners (X / Y / Z, R / G / B / A, etc.) become much more legible with tiny dimmed letters directly above each spinner cell. The pattern is `.form-row.form-row-cluster` (60px label + 1fr cluster) wrapping a row of `.axis-cell` containers, each with a `.axis-lbl` text node above its spinner. Pixel-tight and zero-impact on test selectors (labels stay aria-attached to the spinner inputs). Applied across PhysicsTab Vec3Row + Acceleration, AppearanceTab RGBA, and all four SpawnerPanel Vec3 sections in `82917f0`.

#### Source-resolve open questions before brainstorm

B1.3's five open questions could have entered brainstorm as "needs decision"; instead they were resolved by reading `src/UI/Emitter.cpp:480-560` (the WM_COMMAND handler that maps each IDC_SPINNER to a schema field) and `src/ParticleEditor.en.rc` (the dialog templates) directly. Brainstorm then ran in a single confirmation pass rather than a multi-round Q-and-A. Pattern: when the work touches a legacy surface that's already in the repo, the questions worth asking the user are the *taste* questions ("trailing colons?"), not the *fact* questions ("what schema field does IDC_SPINNER2 bind to?"). Source-read first.

#### Two-stage review on every implementation phase

P3 and P6 each shipped twice: first the implementation pass, then a code-review pass that caught a real issue (P3: missing a11y; P6: inverted weather-disable cascade). The two-stage cadence isn't formality — it's the difference between "looks right" and "matches the legacy contract line-by-line". Bake into every multi-tab dispatch.

#### Tailwind v4 vs v3 — CSS-first vs JS-config

Tailwind v4 generates utility classes from CSS variables in `@theme {}` blocks; there is no `tailwind.config.ts`. The pattern: declare design tokens as plain `:root` vars (`--bg: #0e1116`), then in a sibling `@theme inline { --color-bg: var(--bg); }` block republish them as `--color-X` names. The `inline` keyword keeps values as `var()` references so `[data-theme="light"]` overrides flip at runtime. Result: `bg-bg`, `text-text-3`, `border-border-2`, `accent` etc. utility classes work alongside Tailwind defaults (`bg-neutral-900` still resolves until swept). When the plan / spec references `tailwind.config.ts` it's stale — do the v4 translation in CSS.

#### jsdom in this project doesn't expose Web Storage or matchMedia

`window.localStorage` and `window.matchMedia` are both undefined in jsdom v25 as configured here. Test-setup.ts (`src/test-setup.ts`) has stubs for both alongside the existing ResizeObserver / PointerEvent / scrollIntoView stubs. The `afterEach(() => localStorage.clear())` is what prevents per-component persistence from leaking across tests. If a new feature reaches for `window.X` and jsdom doesn't have it, add the stub to that file matching the existing pattern.

#### Popover dropdowns need OccludingPopover, not stock Radix Popover.Content

The viewport popup is FD9b's layered window with software alpha-stamp cut-outs at chrome occlusion rects. A stock Radix `Popover.Content` would render *behind* the engine viewport because the host doesn't know to punch an alpha cut at its rect. Use `OccludingPopover` (in `src/components/OccludingPopover.tsx`) — same `(bridge, occlusionId)` props as `OccludingMenubarContent`, with 24px padding + smoothstep feather to enclose the shadow-xl drop shadow.

#### Multi-channel curve overlay + focus channel = one SVG branch

When the user picked "hybrid focus-channel" for the curve editor restore, the natural-looking decomposition (multi-channel `MultiChannelCurves` for visualisation + single-channel `CurveEditor` for editing, layered) would have doubled the grid / axis / backdrop nodes and complicated pointer routing. The chosen shape is one SVG with a focus-aware render branch: each `<g data-testid="curve-layer-${id}">` renders either focus-styled (thick + opaque + key markers + pointer-events: auto) or background-styled (thin + dim + no markers + pointer-events: none). Single pointer-capture owner, single backdrop, single test-stable layer-per-channel selector.

#### Phase 2.1's per-component useState → Phase 2.4's Zustand store

When a piece of state needs to be shared across a toolbar button, a workspace grid, a panel header X-close, a menu item, and a keyboard shortcut, the per-component `useState` placeholder you wrote in an early sub-task should upgrade to a Zustand store as soon as the second consumer comes online. The pattern in `lib/spawner-visibility.ts`: store with persisted-to-localStorage `visible: boolean` + `toggle()` + `setVisible(v)` + a `__resetForTests` reset, plus a `useSpawnerVisibility()` compat shim returning `{visible, toggle}` so the older callsite keeps working without restructure.

#### Plan re-write before code, not during

The original Phase 1 plan referenced Tailwind v3 + `tailwind.config.ts` + `src/index.css`. Spotting this at the start of execution forced a stop-and-reconsider. The fix was a docs-only commit rewriting Phase 1 in place (with a "Re-plan note" at the top explaining the v3 → v4 translation) **before** any implementation code landed. Diff stays readable; future readers see the rewrite as its own commit with a clear motivation. Alternative ("substitute Tailwind v4 syntax on-the-fly while implementing") would have left the plan stale and the diffs hard to follow.

---

## Pre-flight checklist for next session

Run these in order before touching code:

```bash
# 1. Confirm worktree is current. (The path may be different — the
#    desktop app provisions a fresh worktree each session.)
cd "/c/Modding/Particle Editor/.claude/worktrees/$WORKTREE_NAME"
git worktree list
git log --oneline -5    # HEAD should be this P8 docs commit on the FF'd `lt-4`
git status              # clean
git log --oneline lt-4..HEAD   # 0 if session branched cleanly from lt-4
git log --oneline HEAD..lt-4   # 0 if session has all the lt-4 work

# 2. Restore NuGet (ONLY needed on a fresh worktree — see header note).
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" \
  "ParticleEditor.sln" //t:Restore //v:m

# 3. Confirm builds and tests are still green.
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" \
  "ParticleEditor.sln" //p:Configuration=Debug //p:Platform=x64 //v:m 2>&1 | tail -10
cd web/apps/editor
pnpm install     # may re-inject the allowBuilds block — see L-005
pnpm build       # 0 errors expected
pnpm test        # 277/277 expected
pnpm test:native # 83/83 expected
```

If anything regressed (no known failing specs at session end), the most likely culprits in order:

- pnpm-workspace.yaml `allowBuilds:` block malformed (L-005 — edit yaml, set per-package to `true`).
- WebView2 runtime unavailable (Edge dependency on the host machine).
- node_modules out of sync — re-run `pnpm install`.

---

## File-level breadcrumbs (current surface)

| Need | Where to look |
|---|---|
| Top-level React shell | `web/apps/editor/src/App.tsx` |
| MenuBar | `web/apps/editor/src/components/MenuBar.tsx` |
| Toolbar (Particle Editor 2026 4-group layout) | `web/apps/editor/src/components/Toolbar.tsx` |
| ThemeToggle | `web/apps/editor/src/components/ThemeToggle.tsx` |
| StatusBar | `web/apps/editor/src/components/StatusBar.tsx` |
| EmitterTree | `web/apps/editor/src/screens/EmitterTree.tsx` |
| EmitterPropertyTabs (Basic/Appearance/Physics in `.form-row` grid) | `web/apps/editor/src/screens/EmitterPropertyTabs.tsx` |
| **CurveEditorPanel (focus-channel host)** | `web/apps/editor/src/components/CurveEditorPanel.tsx` |
| **CurveEditor (multi-channel SVG + focus-aware interactive scaffolding)** | `web/apps/editor/src/screens/CurveEditor.tsx` |
| BackgroundDropdown + body | `web/apps/editor/src/components/BackgroundDropdown.tsx` + `src/screens/BackgroundPicker.tsx` (BackgroundPickerBody) |
| GroundDropdown + body | `web/apps/editor/src/components/GroundDropdown.tsx` + `src/screens/GroundTexturePanel.tsx` (GroundTexturePanelBody) |
| OccludingPopover (viewport occlusion machinery) | `web/apps/editor/src/components/OccludingPopover.tsx` |
| Spawner permanent column | `web/apps/editor/src/screens/SpawnerPanel.tsx` + `src/lib/spawner-visibility.ts` (Zustand store) |
| ViewportPill (top-left 3-toggle pill) | `web/apps/editor/src/components/ViewportPill.tsx` |
| Save-changes prompt | `web/apps/editor/src/screens/SaveChangesPrompt.tsx` |
| Modal primitive (Phase 3.1 will re-skin) | `web/apps/editor/src/components/Modal.tsx` |
| Design tokens | `web/apps/editor/src/styles/tokens.css` |
| Design base CSS (font-face, scrollbars) | `web/apps/editor/src/styles/base.css` |
| Design component CSS (`.panel`, `.tb-btn`, `.form-row`, `.ce-toolbar`, etc.) | `web/apps/editor/src/styles/components.css` |
| Globals (Tailwind + FD4 transparency + body font/size) | `web/apps/editor/src/styles/globals.css` |
| Test setup (localStorage/matchMedia stubs, afterEach clear) | `web/apps/editor/src/test-setup.ts` |
| Bridge schema | `web/packages/bridge-schema/src/index.ts` |
| MockBridge | `web/apps/editor/src/bridge/mock.ts` + `mock-state.ts` |
| NativeBridge | `web/apps/editor/src/bridge/native.ts` |
| TestHostBridge | `web/apps/editor/src/bridge/test-host.ts` |
| AlphaCompositor (FD9b) | `src/host/AlphaCompositor.{h,cpp}` |
| C++ host window + Engine ownership + viewport popup | `src/host/HostWindow.cpp` |
| C++ bridge dispatcher (including engine/set/leave-particles + BuildEngineStateSnapshot) | `src/host/BridgeDispatcher.cpp` |
| C++ host-object proxy | `src/host/HostBridgeProxy.cpp` |
| C++ accelerator pre-translate | `src/host/AcceleratorBridge.cpp` |
| C++ layout broker | `src/host/LayoutBroker.cpp` |
| ParticleSystem (m_leaveParticles, setLeaveParticles, getLeaveParticles) | `src/ParticleSystem.{h,cpp}` |
| Engine — alpha compositor + KillParticleSystem leave-particles honor | `src/engine.cpp` lines ~197, ~625, ~870, ~1226 |
| Playwright test orchestration (spec allowlist) | `web/apps/editor/scripts/run-native-tests.mjs` |

---

## Recommended next moves

0. **Execute B1.4 — Resizable splitters via `react-resizable-panels`** (NEXT DISPATCH). Make the left / centre / right column boundaries draggable so users can size the panes to taste, including the tree/tabs split inside the left column. Persistence to `localStorage` like the theme toggle; defaults match B1.3.1's 25/75 inner split and the existing fixed-width column sizes. No bridge schema, no C++. Standard CLAUDE.md plan structure expected.
2. **Audit B2 — Appearance + Physics tab wiring.** B1.3 wired both tabs through the restructure; B2 may be largely obsolete. A quick diff of the current Appearance + Physics implementations against B2's original target spec should resolve the entire item before re-scoping.
3. **MT-1 follow-up — Texture picker "..." buttons.** Legacy `IDC_BUTTON1` / `IDC_BUTTON2` at `src/ParticleEditor.en.rc:387-389` still unimplemented in the new UI. `TODO(MT-1)` comment marker in `EmitterPropertyTabs.tsx`. Worth filing as a separate dispatch once B1.3.1 / B1.4 ship.
4. **Execute Phase 3** (Tasks 3.1–3.6). Mostly mechanical (dialog re-skins + a sweep + a Playwright spec). Should fit in one session. **Remember to translate Phase 3 plan references to `tailwind.config.ts` to the v4 CSS-first equivalent before dispatching.** Can run in parallel with B1.3.1 / B1.4 if helpful.
5. **Phase 4.2 cutover** comes after Phase 3 ships and the user signs off on parity acceptance (`tasks/lt4_phase_4_1_acceptance.md` §17).
6. **ROADMAP follow-ups from B1 (NT-5, NT-6).** Engine-side single-member link-group enforcement (NT-5) and the visual-stability lane assignment option (NT-6). Both small. NT-6 only worth doing if the bouncing-gutter turns out to be a real ergonomic issue in daily use.
7. **Organic find-and-fix runs continue to be high-yield.** Visual issues discovered during the user's daily use of the build fold cleanly into small fix commits on `lt-4`. This session's two polish rounds (`3ae940e` + `82917f0`) are the latest example of the shape.
8. **(Watch-list)** If the `abort()` dialog the user observed pre-2026-05-20 resurfaces during a Playwright run, capture the assertion text immediately — it was *not* the same bug as `:192` (engine resource-leak fixed in `92ed1db`), so it's still unknown what fires it.

---

## Conversation context the new session needs

### What the user prefers

- **Iterative cycles with visual verification at each phase boundary.** This session shipped P1 → P8 with a smoke-test pass after P7 surfacing five issues the user then folded into two polish commits. The "let's continue" handoff cadence works well.
- **Source-resolve fact questions before brainstorm.** B1.3's five open questions were resolved by source-reading the legacy `.rc` + `Emitter.cpp` directly rather than entering brainstorm with "needs decision" markers. The user appreciated that brainstorm ran in a single confirmation pass rather than a Q-and-A.
- **Two-stage review on multi-tab dispatches catches real issues.** P3 (a11y) and P6 (weather-disable cascade) each needed a fix commit after the implementer's first pass — both caught only because the dispatch protocol called for code review after each phase. Bake into multi-step plans.
- **Bundled correctness fixes are welcome when discovered during prep.** The `displayInvertedPercent` math was a pre-existing bug surfaced while reading legacy source for Q2; bundling it into B1.3 (rather than filing a separate dispatch) was the right call.
- **CHANGELOG entries are detailed.** Three sections per entry (what ships / how we tackled it / issues encountered), per CLAUDE.md. The B1, B1.2, B1.3 entries set the bar — long, conversational, name files + commits + sub-decisions.

### What the user did NOT delegate

- **Push to `origin/lt-4`** — needs explicit OK each time. This docs commit + the FF have been authorized via "let's handover for a new session".
- **Phase advances** — each phase boundary is a check-in moment.
- **Major lossiness decisions** (Task 2.6's TrackEditor deletion). The user catches these and forces alternatives.

### Technical surface the user cares about

- **The `--legacy-ui` path stays clean.** Zero regression. Verified each cycle.
- **Test counts go up where coverage is meaningful.** Phase 1: 191 → 195. Phase 2: 195 → 200. Phase 2.8: 200 → 219. Don't drop counts without explicit reason.
- **The known failing native spec is documented in HANDOFF + CHANGELOG and tracked, not hidden.**
- **No silent failures.** Items not yet implemented log a TODO marker, not a silent no-op.
