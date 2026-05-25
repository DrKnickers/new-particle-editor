# [MT-11] Phase 3 Stage 5 — T6 smoke evidence

**Date**: 2026-05-25
**Session**: claude/affectionate-euclid-5d1c8f
**Tester**: user, on dev rig at maximized 3440×1440
**Build**: composition-mode dist/ (VITE_VIEWPORT_TRANSPORT=canvas-jpeg
+ VITE_WEBVIEW2_HOSTING=composition) + Debug x64 binary + ALO_*
matching env vars

## Result: PASS (after 4 user-driven correction iterations)

Stage 5 ships with the user's headline UX requirement met: pane resize
under composition mode "cleanly reveals more of the scene" without
distortion. Per-pixel angular extent stays constant across resize;
existing world content keeps its pixel position and scale while new
world content appears at the widened scene-rect edges. Maximized
idle FPS comparable to pre-Stage-5 (~70 fps at 3440×1440).

## What was tested

1. **Boot under composition mode**: chrome composites correctly, no
   blue-bar bleed at scene-rect edges, engine pixels visible at the
   centre viewport quadrant.
2. **Pane resize**: drag the right/left chrome panel boundaries —
   engine output tracks the new scene-rect dimensions cleanly. Aspect
   ratio of existing world content unchanged during drag; new world
   appears at the trailing edges.
3. **Window maximize/restore**: engine RT resizes with the window
   (via Engine::Reset path); R8 re-apply rebuilds projection at
   per-pixel-FoV with the new RT height. No visible "aspect snap"
   glitch.
4. **Click into preview**: triggers camera op which fires SetCamera
   → no longer corrects a stale projection (because SetSceneViewport
   now pushes the projection to the device directly).
5. **Idle FPS at maximized**: ~70 fps (composite rate from
   host.log), comparable to pre-Stage-5's 79.1 mean. No perf
   regression at large window sizes despite engine viewport scoping.

## Bug iterations (T6 → T6 corrections)

The smoke surfaced four independent issues, fixed in sequence:

### Iter 1 — Displacement bug

**Symptom**: Engine scene rendered in the bottom-right corner of the
scene-rect quadrant; top/left areas showed engine clear color.

**Root cause**: Coordinate-space inconsistency between the sub-plan's
description of T1 (Compositor used SetOffset + local-coord clip) and
T3 (engine rendered at scene-rect viewport in RT). Both followed the
sub-plan as written but the sub-plan itself was internally
inconsistent — double-offset.

**Fix**: Compositor uses SetOffset(0, 0) + SetClip with absolute
host-client coords. Visual local-coord space equals parent coord
space; the clip rectangle directly carves the visible region out of
the (full-RT-sized) swapchain.

### Iter 2 — Aspect distortion on resize

**Symptom**: existing world content shrank toward the center as the
viewport widened; user perceived as distortion.

**Root cause**: Engine's projection used fixed `fovY=45°` with
aspect-driven horizontal FoV. Wider viewport → wider fovX → each
pixel covered less angular extent → existing world objects' pixel
positions shifted toward center.

**Fix**: Per-pixel-FoV-constant projection. fovY scales linearly with
viewport-H against the engine RT's height (`fovY = 45° × sceneH /
RT_H`). At scene-rect = RT, fovY = 45° (pre-Stage-5 default). At
scene-rect < RT, fovY < 45° — engine renders LESS world per frame,
not more. Per-pixel angular extent stays constant across resizes.

### Iter 3 — Blue bar during fast drag

**Symptom**: trailing edge of the scene-rect showed a transient
engine-clear-color strip during drag, "snapping" when the drag
released.

**Root cause**: DComp clip widened immediately on Commit, but engine
rendering of the new viewport region lagged by one render-pump
iteration. Visible during the gap.

**Iter 3a fix attempt — sync render callback**: LayoutBroker drove
RenderD3D9 synchronously from the bridge dispatch path. Eliminated
the lag but TANKED FPS at large windows (sub-30 FPS at maximized)
because engine.Render fires 2× per drag tick (sync + message-pump
natural cadence). REVERTED.

**Iter 3b fix — deferred clip in Compositor**: SetEngineVisualTransform
queues the new clip args on Impl::pending* fields. CompositeEngineFrame's
tail applies the queued transform AFTER Present1, so swapchain content
and DComp clip change on the same DWM cycle. Mitigates the lag without
the perf hit. (One-frame residual lag at the leading edge during very
fast drags is acceptable.)

### Iter 4 — "Aspect snaps on click" after resize

**Symptom**: After releasing the drag, the displayed aspect was
wrong. Clicking into the preview area "snapped" the aspect to
correct.

**Root cause**: `Engine::SetSceneViewport` updated `m_projection` and
`m_viewProjection` only as member variables — never called
`SetTransform(D3DTS_PROJECTION, &m_projection)` to push to the
device. Click on viewport triggered a camera operation, which called
`SetCamera`, which DOES push the projection — explaining the
"snap." Latent bug also exists in pre-Stage-5 `ResetParameters`
(window resize → projection rebuilt in member but not pushed) but
nobody noticed because window resize was always followed by camera
interaction.

**Fix**: SetSceneViewport (both active and clearing branches)
explicitly calls `m_pDevice->SetTransform(D3DTS_PROJECTION,
&m_projection)` and recomputes `m_viewProjection = m_view *
m_projection` so the shader-effect consumers (engine.cpp:613, 616)
see the fresh matrix.

## What's NOT covered by this smoke

- Multi-monitor DPI changes (R5b — DPI awareness already tested in
  Stage 3e; not re-tested in Stage 5)
- Alt-Tab cycles during drag
- Other transports (canvas-jpeg without composition; arch-A) —
  Stage 5 changes are gated on m_dcompCompositor presence; these
  paths verified neutral via HWND Playwright baseline 99 + 22
  skipped + 0 failed
- Stress testing (1000s of pane drags in succession)

## Resulting design (post-T6 corrections)

Variant **B-γ** with **per-pixel-FoV-vs-current-RT** + **deferred
clip commit**:

- LayoutBroker.SetSceneRect (under composition mode):
  - AlphaCompositor.SetSceneRect (legacy popup band-mask, unchanged)
  - Engine.SetSceneViewport (updates state, recomputes projection,
    pushes to device)
  - Compositor.SetEngineVisualTransform (queues pending transform)
- Compositor.CompositeEngineFrame (next frame):
  - engine.Render fires with new viewport + projection → fresh pixels
    in scene-rect sub-region of engine RT
  - CopyResource → Present1
  - Apply pending transform (SetClip + Commit) AFTER Present1
- DWM next cycle: composites with fresh pixels + fresh clip
  simultaneously

## Files touched (T6 corrections)

- `src/engine.cpp` — SetSceneViewport: per-pixel-FoV-vs-RT,
  SetTransform(PROJECTION), viewProjection recompute. Both active
  and clearing branches.
- `src/engine.h` — removed referenceFovY* fields (no longer needed,
  reference = current RT H read inline).
- `src/host/Compositor.cpp` — SetEngineVisualTransform: SetOffset(0,
  0) + absolute clip coords. New Impl::pending* fields + Impl::
  ApplyTransform helper. CompositeEngineFrame applies pending after
  Present1. New `immediate` param on SetEngineVisualTransform.
- `src/host/Compositor.h` — updated docstring + new `immediate`
  parameter default.
- `src/host/HostWindow.cpp` — boot seed passes `immediate=true`,
  also calls engine.SetSceneViewport for seed.
- `src/host/LayoutBroker.cpp` — restored B-γ engine wiring; clear
  branch also calls SetSceneViewport(0,0,0,0); removed sync-render
  callback machinery (reverted).
- `src/host/LayoutBroker.h` — clean (Iter 3a's SetRenderCallback
  field/method were added then reverted; final state has no new
  surface vs T2 baseline).

## Verification

- Pre-handoff: `tasks/stage-5-smoke-result.md` written before
  CHANGELOG + HANDOFF update (T8).
- HWND baseline regression gate (pre-T6 commit, validates that
  composition-mode-gated changes don't affect non-composition
  transports): 99 passed + 22 skipped + 0 failed under default
  dist/ + no env vars (run at T5).
- Composition mode at maximized: ~70 fps composite rate, no
  [COMP-engine-fail] log lines.
- User-visual confirmation: "wow that's fantastic. that resize
  behavior is perfect" + idle FPS confirmed acceptable at
  maximized.
