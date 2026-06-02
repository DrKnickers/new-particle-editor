# Next-session prompt — the black line (arch-C compositor seam)

You're picking up `new-particle-editor` (the **AloParticleEditor** rewrite — Win32 +
WebView2/React + D3D9Ex-via-DComp particle editor for Star Wars: Empire at War),
branch **`lt-4`**, at `origin/lt-4 = f501201`. Treat the handoff docs as primary
context but **verify every important claim against the actual code** before acting —
this matters here (last sessions hit the L-022 "docs say open but it shipped" trap).

## The task: the black line on the Spawner panel's viewport edge
A 1px **black** vertical line runs along the **Spawner panel's LEFT (viewport-facing)
edge** in a correct arch-C launch (light theme). User-confirmed: **only that edge**
(not all viewport edges, not the window edge), and it's a real seam, not an L-033
misrender.

**Already ruled out (do NOT redo — both reverted after the user relaunched and the
line persisted):**
- Rounded-corner wedge (`.panel-flush-left` on the Spawner `.panel`) — corners sit
  against the opaque splitter, not engine backing.
- React scene-rect rounding in `ViewportSlot.tsx` `send()` (independent `round(x)` +
  `round(w)`) — fixed to round each edge from absolute coords; line persisted, so the
  React dispatch is NOT the cause. (`SLOT_BORDER_PX = 0`.)
- It is **not a DOM element**: browser inspection found no dark element near the
  boundary; the panel border is `#dcdcdc`; the `ce-splitter-v` is already opaque
  `var(--bg)` `#ECECEC` from a prior seam fix (`components.css:1173`).

⇒ It's the engine's **black DComp backing** through a ~1px gap where the engine
scene-rect **clip** doesn't meet the opaque DOM — **host-side**.

## Start here (host-side)
1. `LayoutBroker.cpp:286-288` — `m_engine->SetSceneViewport(x,y,w,h)` +
   `m_dcompCompositor->SetEngineVisualTransform(x,y,w,h)` on each `layout/scene-rect`.
2. `Compositor.cpp:230-261` — `ApplyTransform` → `engineVisual->SetClip(D2D_RECT_F clip)`,
   `clip = {x, y, x+w, y+h}` (float from int device-px). Emits `[COMP-engine-transform]
   clip=(L,T,R,B)` to `host.log`. Suspects: float clip sub-pixel edge; clip-R vs the
   WebView2 visual's left edge (1px gap); what's behind the engine at the seam + why black.
3. `Compositor.cpp:627-648` (root visual clip) + the backing-color path.

## Verify (you CANNOT trust agent screenshots — L-033)
- Mechanism: `%LOCALAPPDATA%\AloParticleEditor\host.log` → `[COMP-engine-transform]
  clip=(L,T,R,B)`; compare clip-R to the computed viewport-right device-px.
- L-034 isolation: recolour each candidate layer over CDP (engine clear
  `engine/set/background`, rear backing `host/backing-color`, the visual clip) and ask
  the user which recolour the line follows — that layer is the source.
- Hand the on-screen confirm to the **user**; iterate via host.log + their eyes.

## Pre-flight + baseline (before changing anything)
```
git fetch origin lt-4 --quiet
git rev-parse --short origin/lt-4      # expect f501201 or newer
git log --oneline origin/lt-4..HEAD    # expect 0
git log --oneline HEAD..origin/lt-4    # expect 0
git status --porcelain                 # expect clean
```
- From `web/`: `pnpm --filter @particle-editor/editor test` → **391 passed** (45 files).
- `pnpm --filter @particle-editor/editor build` → clean (also builds `dist/`, needed
  for `--new-ui`; L-040).
- `.sln` Debug + Release x64 via **PowerShell** (L-046, NOT Git-Bash — it mangles
  `/p:` switches); fresh worktree → NuGet restore (L-039).
- `pnpm --filter @particle-editor/editor a11y` → **157 passed / 4 splitters** (L-033).
  CDP fails to come up? A stale `--test-host` may hold :9222 — scoped-kill it (the
  cleanup filter spares the user's legacy editor).

## Read first (then VERIFY)
- **`tasks/HANDOFF.md`** top "session 9" entry — full black-line state + the 8 commits.
- **`tasks/lessons.md`** — **L-033** (agent arch-C launches misrender; verify via
  host.log + user), **L-034** (compositor-seam layer isolation by recolour), **L-046**
  (PowerShell MSBuild), **L-047** (verify reorders on both axes).
- `CLAUDE.md` — LT-4 branch flow (FF into `lt-4`; never `master` without OK).

## Process (per CLAUDE.md)
Summarize your understanding + approach and confirm scope before changing anything.
Because this is arch-C-visual, lean on host.log mechanism verification + the user for
the on-screen confirm. On landing: CHANGELOG + FF-push `lt-4`. Never `master` without OK.
