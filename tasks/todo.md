# Black line on the Spawner panel's left (viewport-facing) edge — arch-C seam

Session 10. Branch `lt-4` @ `d57c3cc`. Scope confirmed by user:
**diagnose → fix → verify**; evidence loop is **"user launches + reports"**
(L-033 — agent arch-C launches misrender; agent screenshots are not evidence).

## 1. Goal + scope
**Goal.** Eliminate the 1px **black** vertical line on the Spawner panel's
**left (viewport-facing) edge only** (user-confirmed: only that edge, not all
viewport edges, not the window edge) in a faithful arch-C launch (light theme),
without regressing the existing seam fixes.

**In:** root-cause the layer the black belongs to; the minimal host- or
engine-side fix; CHANGELOG; FF-push `lt-4`.
**Out:** the broad arch-A deletion (MT-13, gated on arch-C trust — user still
daily-drives legacy); any React-side change (the React dispatch is exhausted —
`ViewportSlot.tsx` rounding reverted, `SLOT_BORDER_PX=0`, DOM inspection clean);
`master` (never without explicit OK).

## 2. What the codebase already gives us (verified this session)
- `LayoutBroker::Apply` → `Engine::SetSceneViewport(x,y,w,h)` +
  `Compositor::SetEngineVisualTransform(x,y,w,h)` (`LayoutBroker.cpp:284-288`).
- Engine clip = `D2D_RECT_F{x, y, x+w, y+h}` from **integer** device-px — exact,
  no sub-pixel error at the clip itself (`Compositor.cpp:234-240`). Logged as
  `[COMP-engine-transform] clip=(L,T,R,B)`.
- Visual z-order = **`[backing, engine, webview]`** front-to-back = WebView2 on
  top, engine middle, backing rearmost (`Compositor.cpp:337-344`). Engine shows
  only through WebView2's transparent viewport hole.
- Backing is provably recoloured **`#ECECEC`** (light) and scaled to the full
  client (`host.log [COMP-backing] recolor #ECECEC applied (rearmost visual)`;
  `host/backing-color` handler `BridgeDispatcher.cpp:910`, param `{color:"#rrggbb"}`).
  ⇒ **A clip gap reveals grey, never black** — refutes the handoff's "black
  backing through a ~1px gap" mechanism.
- Engine clears the full RT to **`m_background` = `RGB(0x14,0x08,0x34)`** (near-
  black dark indigo; `engine.cpp:2177`, reset `BridgeDispatcher.cpp:1414`), THEN
  narrows the D3D viewport to the scene rect (`engine.cpp:684-714`). So the
  engine's own pixels outside the 3D content are ≈black — a 1px column of that
  would read as the black line.
- Engine projection is **symmetric** (`D3DXMatrixPerspectiveFovRH`,
  `engine.cpp:1660-1662`) — the engine cannot intrinsically paint a vertical
  1px line on *only* the right edge. ⇒ right-only asymmetry implies a
  **compositing-boundary** cause, not engine geometry.
- `engine/set/background` (UI: Background → "Solid colour" tile → native colour
  picker; `BackgroundPicker.tsx:108-113`) recolours the engine clear — the
  L-034 layer-isolation probe, reachable with **no DevTools**.

## 3. Approach — evidence first (systematic-debugging Phase 1; NO fix yet)
The two facts in tension — backing is `#ECECEC` (gap ⇒ grey) vs the line is
**black**, and the engine projection is symmetric (can't be right-only) — mean
the handoff's stated mechanism is wrong and the real source must be isolated
empirically before any fix.

**Decisive test A (user, UI-only): recolour the engine clear.**
Set engine background → vivid **magenta** via the Background picker.
- Line turns **magenta** ⇒ source is the engine's clear colour at the scene-rect
  right edge (engine-side). Dig: why the rightmost scene-rect column shows clear
  colour while interior is covered (rasterization right-edge / bloom full-RT
  post-process tap across the boundary, `engine.cpp:763-773`).
- Line **stays black** ⇒ compositor-injected. Go to test B.
- Line **disappears** ⇒ unexpected; re-plan.

**Test B (only if black persists): recolour the backing + clip border mode.**
`host/backing-color {color:"#00ff00"}` (needs DevTools / a bridge call). Line
turns green ⇒ backing gap after all (revisit z-order). Unchanged ⇒ test DComp
engine-visual `SetBorderMode(HARD)` (L-034) by *measured* pixels.

**Mechanism cross-check (host.log, every real launch):** read the LAST session's
`[COMP-engine-transform] clip=(L,T,R,B)`; compute viewport-right device-px from
the panel layout; compare clip-R to the opaque-DOM boundary.

## 4. Risks
1. **L-033 — agent screenshots lie.** Mitigation: every on-screen go/no-go is the
   user's eyes; agent verifies only mechanism (host.log) + agent-measurable files
   (engine-RT PNG via `--capture`, never the `-composite.png` under agent launch).
2. **L-022 — trusting the handoff.** The "black backing gap" mechanism already
   failed verification (backing is `#ECECEC`). Mitigation: drive the fix from the
   recolour test result, not the handoff's stated cause.
3. **Masking vs fixing (L-034 trap).** Insetting the clip 1px to hide the line is
   a mask, not a fix. Mitigation: only ship a fix that addresses the proven layer;
   if it's the engine edge, fix the edge, don't crop it.
4. **Fix regresses prior seam fixes** (opaque splitter, `#ECECEC` backing).
   Mitigation: the magenta/green probes confirm those layers stay correct; user
   confirms on-screen post-fix.

## 5. Testing & verification
- [x] Pre-flight: `HEAD = d57c3cc = origin/lt-4`, 0/0, clean.
- [x] Baseline: vitest 391; web build clean (+dist); native Debug+Release x64
      0 errors; a11y 157/4-splitters (L-033).
- [ ] Test A result (user): magenta follows the line? → bifurcate.
- [ ] Fresh real-launch `host.log` clip-R vs computed viewport-right.
- [ ] (branch) engine-side or compositor-side minimal fix.
- [ ] Rebuild dist + native; user on-screen confirm line is gone AND no new seam.
- [ ] CHANGELOG; FF-push `lt-4`. Never `master` without OK.

## Review

**Root cause (definitively measured, overturns the handoff).** The black line is
NOT a compositor clip seam, backing gap, or DOM element. It is the engine's near-
black background (`RGB(0x14,0x08,0x34)`) showing through a strip at the scene-rect's
**right edge** where the **D3D9Ex shared render target is incoherent in its D3D11
alias**. Evidence chain (faithful CopyFromScreen grabs + D3D9/D3D11 readbacks, all
measured per L-034):
1. Engine-background recolour (user's magenta/red test) → line stayed black ⇒ not
   the engine clear *as seen on screen*.
2. Symmetry: left/top/bottom fill content to the clip; only the right edge has the
   ~3-4px bg strip.
3. `m_pSceneTexture` (D3D9 dump) and the AlphaComp RT (D3D9 dump) both have **content**
   at the strip ⇒ engine render + composite are correct.
4. The **same shared texture read via its D3D11 alias** (and the swapchain backbuffer,
   and the screen) shows **bg** at the strip ⇒ the break is exactly at the D3D9Ex→D3D11
   shared-surface boundary.
5. The cross-device flush (`WaitEndFrameQuery`, `D3DGETDATA_FLUSH`) is correctly
   ordered before the D3D11 read ⇒ not a missing-flush bug; a legacy shared-handle
   coherency quirk (keyed-mutex sync isn't available with a D3D9Ex producer).
6. The incoherent band width is **proportional to the rendered width** (~0.5%: ~4px
   at w=666, ~10px at w=1820).

**Fix (guard band / overscan).** `LayoutBroker::SetSceneRect` now renders the engine
scene viewport a few px LARGER than the DComp clip so the incoherent band falls in the
clipped-off margin; the clip shows only coherent interior pixels. Proportional +
aspect-preserving: `GBx = max(12, w/64)`, `GBy = GBx·h/w`. Under the engine's
per-pixel-FoV projection this keeps both per-pixel angles constant ⇒ visible framing is
pixel-identical (verified: viewport centre byte-identical pre/post; edges within capture
noise). `Engine::SetSceneViewport` gained a defensive RT clamp (chrome margin keeps the
band in-bounds in practice). No per-frame copy, no masking, no grey edge.

**Verification.** Black line gone at **default (1264×761)** AND **maximized
(3440×1369)** — measured: content runs to the clip edge, chrome at the next pixel, no
`(20,8,52)` strip. Baseline green: vitest **391**, native **Debug + Release x64** clean,
a11y **157 / 4-splitters** (L-033 artifact). On-screen confirm handed to the user.

**Follow-ups noted:** the proper cure (keyed-mutex or a D3D11-side render) is a larger
arch change tracked separately if the guard band ever proves insufficient; the `w/64`
constant carries ~3x margin over the measured band.
