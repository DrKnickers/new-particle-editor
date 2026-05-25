# [MT-11] Phase 3 Stage 5 — Sub-plan: scene-rect transform on the engine visual

**Status:** USER-APPROVED — §3.2 Option A locked (DComp offset+clip); §1.1
resolved as Variant **B-γ** (engine viewport tracks scene-rect, RT stays
full-client). Code execution gated on T1 start.

**Risk grade:** ★★★★ (bumped from ★★★ when B-γ was added — new Engine API,
projection-matrix aspect handling, post-process bleeding risk). Still
materially smaller than Stage 4 (no new GPU pipeline, no new device/swap-
chain creation). Per CLAUDE.md ★★★★ rule, risks list iterated with user
pre-coding.

**Author:** session `claude/affectionate-euclid-5d1c8f` · 2026-05-25 ·
branched off `origin/lt-4@b6daff4`.

---

## 1. Goal + scope

### Goal

Constrain the DXGI engine visual to the LayoutBroker's scene-rect quadrant
so engine pixels stop bleeding into chrome-panel regions. After Stage 5,
chrome panels show their OWN backgrounds where they currently leak engine
clear-color; only the centre-quadrant area composites engine pixels.

User-observable success condition: with default chrome (left/right/bottom
panels populated), the panel regions show solid panel backgrounds with
NO engine clear-color leaking through. Resize a pane: the engine visual's
visible region tracks the new scene-rect. Resize the window: the scene-
rect (and thus the engine visual's visible region) tracks accordingly.

### In scope

1. **New `Compositor::SetEngineVisualTransform(int x, int y, int w, int h)`
   method.** Takes scene-rect in host-client coords. Calls
   `engineVisual->SetOffsetX(float(x))` + `SetOffsetY(float(y))` +
   `engineVisual->SetClip({0, 0, float(w), float(h)})` (clip in the
   visual's OWN coord space, post-offset, per DComp semantics) +
   `device->Commit()`. Idempotent on identical args. Logs
   `[COMP-engine-transform] x=… y=… w=… h=…` on actual changes.

2. **Wire LayoutBroker → Compositor.** Mirror the existing
   `SetAlphaCompositor` seam:
   - Add `LayoutBroker::SetCompositor(host::Compositor*)` setter +
     `m_compositor` field.
   - HostWindow wires it at the same site where it wires
     `SetAlphaCompositor` (HostWindow.cpp:1469-ish), AFTER the Compositor
     is fully `Init()`'d and `AttachWebView2`'d, so we don't seed a
     transform onto a partially-built tree.
   - `LayoutBroker::SetSceneRect`: under composition mode (m_compositor
     != nullptr && IsReady), ALSO call
     `m_compositor->SetEngineVisualTransform(x, y, w, h)` with the SAME
     main-client coords React just dispatched. The Compositor's engine
     visual is a direct child of the root visual whose coordinate space
     is host-client coords — no translation needed.
   - `LayoutBroker::ReemitOcclusions`: re-emit the scene-rect via
     `Compositor::SetEngineVisualTransform` too, so popup-moves /
     viewport-applies refresh the engine-visual transform alongside the
     AlphaCompositor stamps.

3. **Seed the initial transform at attach time.** In
   `HostWindowImpl::OnCompositionControllerReady`, after the existing
   `AttachEngineVisual` call (~line 1268), call
   `m_compositor->SetEngineVisualTransform` with whatever scene-rect
   LayoutBroker currently has (or `(0,0,clientW,clientH)` if React
   hasn't dispatched scene-rect yet). Without this seed, the first frame
   under composition mode renders at full-client size until React's
   first `layout/scene-rect` arrives — a 1-3 frame visible glitch.

4. **NEW (B-γ): `Engine::SetSceneViewport(int x, int y, int w, int h)`.**
   Stashes a scene-rect in engine state + recomputes `m_projection` with
   scene-rect aspect ratio. `Engine::Render` calls
   `m_pDevice->SetViewport(...)` with the stashed rect at the start of
   the scene pass (after the existing `SetRenderTarget(0, offscreenRT)`).
   Idempotent on identical args. A zero or negative rect resets to "use
   full RT" (current behavior — back-compat for canvas-jpeg / arch-A
   paths that don't have a scene-rect concept).

5. **Wire LayoutBroker → Engine.** Mirror `SetEngine` (already exists).
   `LayoutBroker::SetSceneRect`: in addition to the AlphaCompositor +
   Compositor calls, also call
   `m_engine->SetSceneViewport(x, y, w, h)` so the engine's next frame
   renders at scene-rect aspect into the scene-rect sub-region of its
   RT.

6. **Playwright spec — `dxgi-scene-rect.spec.ts`** (composition-mode
   conditional, mirrors `dxgi-transport.spec.ts` skip-pattern). Drives
   three different scene-rect sizes via `bridge.dispatch("layout/scene-rect", ...)`,
   asserts matching `[COMP-engine-transform]` AND
   `[engine] SetSceneViewport` log lines for each. Optionally inspects
   engine-frame composite count grows between transforms (no stall).

7. **Smoke evidence file `tasks/stage-5-smoke-result.md`.** Per the
   Stage 4 smoke template: launch composition build, observe scene-rect
   constrained engine visual + scene drawn at correct aspect ratio,
   capture screenshot.

### Out of scope (explicitly deferred)

- **`AlphaCompositor` + `FramePublisher` removal.** Phase 3 Stage 7.

- **Swapchain `ResizeBuffers` per scene-rect change** (Option B in §3).

- **Input pathway changes.** Phase 2's viewport input bridge handles
  pointer/keyboard input through the canvas overlay regardless of
  hosting mode; user verified Shift+spawn etc. during Stage 4c.

- **`canvas-architecture.spec.ts` fixme** (L-012 instrumentation issue,
  pre-Phase-3).

- **Stage 4 sub-stage 4e** (first-frame ClearRenderTargetView guard).

- **L-019 + L-020 lesson retro-docs.**

### 1.1 RESOLVED — Variant B-γ chosen

User check-in 2026-05-25: Option B locked, with variant selection between:

- **B-α** (decouple AlphaCompositor RT from engine RT via SetSceneRect-
  driven Resize): **discarded** — won't work. The engine's projection
  matrix, scene texture, distort texture, and depth stencil are all
  sized to `m_presentationParameters.BackBufferWidth/Height` (engine.cpp:
  1448, 1453, 1458, 1464). Making AlphaCompositor's offscreenRT a
  different size from the engine's own pipeline targets breaks the
  CopyRects/blit shape — the engine renders at full-client but blits
  into a scene-rect-sized RT.

- **B-β** (popup tracks scene-rect — LayoutBroker.SetSceneRect calls
  Apply, popup shrinks, full Engine::Reset cascade): **discarded** —
  every pane-drag tick triggers Engine::Reset, which is heavy (release
  all D3DPOOL_DEFAULT resources, swap-chain re-create, OnLost/OnReset
  every effect, recreate skydome buffers, reload ground/skydome
  textures). Stage 4d's lazy-handle re-open fires on every tick. Plus
  the architectural reversal of the post-NT-8-T4c "popup-spans-window"
  consolidation.

- **B-γ** (engine viewport tracks scene-rect, RT stays full-client):
  **CHOSEN.** New `Engine::SetSceneViewport(x, y, w, h)` stashes a
  scene-rect; `Engine::Render` calls `m_pDevice->SetViewport(...)` with
  it at the scene-pass start; the projection matrix is recomputed with
  the scene-rect aspect ratio (see §3.4 for the per-call recompute).
  Engine RT, AlphaCompositor RT, popup HWND all stay full-client-sized
  — no new Engine::Reset triggers, no resize storms. DComp engine visual
  uses Option A (offset + clip) to crop the unused full-client periphery
  away on-screen.

  **Net visible result:** scene drawn at scene-rect aspect, filling the
  scene-rect sub-region of the engine RT; DComp clips the rest. Same
  pixel-perfect outcome as B-β with materially lower implementation +
  runtime risk.

---

## 2. What the codebase already gives us

### LayoutBroker (`src/host/LayoutBroker.h`, `LayoutBroker.cpp`)

- `SetSceneRect(x, y, w, h)` already exists (`LayoutBroker.cpp:199`).
  Today it caches `(m_sceneX, m_sceneY, m_sceneW, m_sceneH)` and
  forwards translated rect (subtract popup origin `m_lastX/Y`) to
  `m_compositor->SetSceneRect` (the AlphaCompositor, not the DComp
  Compositor — naming collision, see Risk R1).
- `ReemitOcclusions` (`LayoutBroker.cpp:229`) is the re-translate site
  triggered by Apply / PredictAndApply / RefreshScreenPosition. The
  pattern to mirror.
- `SetAlphaCompositor` (`LayoutBroker.cpp:8`) is the canonical
  "inject-pointer-after-construction" pattern. New `SetCompositor` for
  the DComp Compositor follows the same shape.
- `m_compositor` field name is already used for AlphaCompositor —
  see Risk R1 for the renaming plan.

### Compositor (`src/host/Compositor.h`, `Compositor.cpp`)

- Public surface: `Init`, `AttachWebView2`, `SetSize`, `Commit`,
  `AttachEngineVisual`, `CompositeEngineFrame`, `RefreshEngineSharedHandle`,
  `IsReady`, `HostHwnd`. Adding `SetEngineVisualTransform` slots
  naturally into the "Stage 4 — engine visual" block (lines 114-191 of
  the header).
- Internal `Impl::engineVisual` is the `IDCompositionVisual*` we'll
  call SetOffsetX/Y/SetClip on. Already in pImpl (line 126 of .cpp).
- `Impl::device` exposes `Commit()` (already used by SetSize at
  Compositor.cpp:335). Single device commit at end of SetEngineVisualTransform.
- DComp `SetClip` precedent: `Compositor::SetSize` clips the ROOT
  visual via `D2D_RECT_F` (lines 325-333). Same API for the engine
  visual.
- `engineVisualAttached` flag (Impl line 133) — early-return guard for
  SetEngineVisualTransform when engine visual isn't attached (e.g.
  LUID-mismatch state from §3.8 / D7).

### HostWindowImpl (`src/host/HostWindow.cpp`)

- `m_compositor` field at line 470 — std::unique_ptr<host::Compositor>.
  Pass `m_compositor.get()` into `layout.SetCompositor(...)`.
- `layout` field at line 362 — `LayoutBroker layout;` (value member).
- `OnCompositionControllerReady` at ~1010-1310 — wires AttachWebView2,
  SetSize, AttachEngineVisual. Append SetEngineVisualTransform seed
  after AttachEngineVisual (line 1277-ish).
- WM_SIZE handler at ~1538 already calls `m_compositor->SetSize(...)`
  — this resizes ROOT clip + commits but doesn't touch the engine
  visual transform. After Stage 5: WM_SIZE doesn't need engine-visual-
  transform update because React's ResizeObserver will dispatch a
  fresh `layout/scene-rect` immediately, which propagates through
  LayoutBroker. (Worth verifying in smoke — Risk R3.)
- WM_DESTROY at ~1611 already `m_compositor.reset()`s before the engine
  teardown. We should also call `layout.SetCompositor(nullptr)` before
  the reset so LayoutBroker doesn't hold a dangling pointer past WM_DESTROY
  if any late SetSceneRect dispatch slips through. (See §3 for the
  ordering.)

### Playwright (`web/apps/editor/tests/`)

- `dxgi-transport.spec.ts` is the closest skip-pattern template. Skip
  predicate looks at `process.env.ALO_WEBVIEW2_HOSTING !== "composition"`.
- `host-log.ts` helper (or equivalent — see `dxgi-transport.spec.ts`
  imports) reads `%LOCALAPPDATA%\AloParticleEditor\host.log` and grep-
  matches for `[COMP-…]` lines. New spec greps for
  `[COMP-engine-transform]`.
- `scripts/run-native-tests.mjs` registry — new spec added next to
  the dxgi-* siblings.

### BridgeDispatcher (`src/host/BridgeDispatcher.cpp:803-825`)

- Already routes `layout/scene-rect` → `m_layout.SetSceneRect(x, y, w, h)`.
  No change here — Stage 5's wiring is downstream of this call.

---

## 3. Architecture / implementation approach

### 3.1 The transform itself — Option A (recommended)

```cpp
HRESULT Compositor::SetEngineVisualTransform(int x, int y, int w, int h) noexcept
{
    if (!m_impl->engineVisualAttached) return S_FALSE;       // no engine visual yet
    if (!m_impl->engineVisual || !m_impl->device) return E_NOT_VALID_STATE;
    if (w <= 0 || h <= 0) return E_INVALIDARG;               // degenerate scene-rect

    // Idempotence.
    if (x == m_impl->engineLastX && y == m_impl->engineLastY &&
        w == m_impl->engineLastTransformW && h == m_impl->engineLastTransformH)
    {
        return S_OK;
    }

    HRESULT hr;
    hr = m_impl->engineVisual->SetOffsetX(static_cast<float>(x));
    if (FAILED(hr)) { LogLine("[COMP-engine-fail] SetOffsetX hr=" + …); return hr; }
    hr = m_impl->engineVisual->SetOffsetY(static_cast<float>(y));
    if (FAILED(hr)) { LogLine("[COMP-engine-fail] SetOffsetY hr=" + …); return hr; }

    // SetClip is in the visual's OWN coord space (post-offset). Clipping
    // to {0, 0, w, h} means "from the visual's local origin, show w×h."
    // The visual's content (the swapchain) is stretched-to-fit by
    // DXGI_SCALING_STRETCH, so a w×h clip on a swapchain currently sized
    // to full-client effectively "windows" the top-left w×h of the
    // stretched output. Under B-γ the engine draws into the scene-rect
    // sub-region of its full-client RT (via Engine::SetSceneViewport),
    // so this w×h clip windows the engine's actual scene output and
    // the surrounding clear-color edges of the full-client RT are
    // hidden. (See §3.2 for why we don't ResizeBuffers per scene-rect.)
    D2D_RECT_F clip = {
        0.0f, 0.0f,
        static_cast<float>(w),
        static_cast<float>(h)
    };
    hr = m_impl->engineVisual->SetClip(clip);
    if (FAILED(hr)) { LogLine("[COMP-engine-fail] SetClip hr=" + …); return hr; }

    hr = m_impl->device->Commit();
    if (FAILED(hr)) { LogLine("[COMP-engine-fail] SetEngineVisualTransform Commit hr=" + …); return hr; }

    m_impl->engineLastX = x;
    m_impl->engineLastY = y;
    m_impl->engineLastTransformW = w;
    m_impl->engineLastTransformH = h;

    char buf[160];
    snprintf(buf, sizeof(buf),
             "[COMP-engine-transform] offset=(%d,%d) clip=%dx%d", x, y, w, h);
    m_impl->LogLine(buf);
    return S_OK;
}
```

New `Impl` fields (4 ints): `engineLastX`, `engineLastY`,
`engineLastTransformW`, `engineLastTransformH`. All zero-initialized
in the struct body.

### 3.2 Why Option A over Option B

| Aspect | Option A (offset + clip, fixed swapchain) | Option B (ResizeBuffers per scene-rect) |
|---|---|---|
| Swapchain size | Stays at engine-RT size (full client) | Tracks scene-rect |
| Per-update cost | 3 DComp calls + 1 Commit (nanoseconds) | ResizeBuffers + GetBuffer (D3D11 driver round-trip, ~100µs-1ms) |
| Resize-storm behavior | Cheap; mid-drag pane resizes barely register | Each drag tick triggers a full back-buffer release/re-acquire |
| VRAM | Wastes (clientW - sceneW) × (clientH - sceneH) × 4 bytes | Minimal — exact scene-rect size |
| Interaction with Stage 4d lazy re-open | Untouched — Stage 4d's path only fires on engine-RT handle change, which scene-rect-only doesn't trigger | Conflicts — every scene-rect change explicitly drives the same ResizeBuffers that 4d's lazy path triggers, doubling the work and tangling the cache state |
| Implementation surface | ~30 LoC of Compositor change + ~10 LoC of LayoutBroker wiring | Above + a new Compositor::ResizeEngineSwapchain(w, h) + lifecycle interaction with RefreshEngineSharedHandle |

Option B's only advantage (VRAM efficiency) is irrelevant at typical
scene-rect sizes — even 3440×1440 × 4 bytes = ~19 MB is a rounding
error against the GPU memory the engine itself occupies. Option A
gives us the strictly cheaper update path and avoids tangling with
Stage 4d's resize machinery.

### 3.3 Wiring map

```
React: layout/scene-rect dispatch
  ↓
BridgeDispatcher::Dispatch (line 818)
  ↓
LayoutBroker::SetSceneRect(x, y, w, h)
  ├─→ m_alphaCompositor->SetSceneRect(translated)        [LEGACY, KEPT — popup band-mask]
  ├─→ m_dcompCompositor->SetEngineVisualTransform(...)   [NEW — DComp engine visual]
  │    └─→ Compositor::Impl::engineVisual->SetOffset/SetClip + device->Commit
  └─→ m_engine->SetSceneViewport(x, y, w, h)             [NEW B-γ — engine viewport+projection]
       └─→ next Engine::Render's SetViewport + projection matrix use scene-rect
```

LayoutBroker keeps its existing `SetAlphaCompositor` plumbing untouched;
the two new paths are purely additive. The popup-origin translation step
is NOT applied to either new path:
- Compositor's engine visual lives in host-client coord space (root
  visual at (0,0,clientW,clientH); engine-visual offset is relative
  to root, which equals host-client coords).
- Engine's `SetSceneViewport` receives the rect in main-client coords;
  since the engine RT IS sized to full host client, those coords map
  1:1 to the engine RT's coordinate space — no translation.

### 3.4 Engine::SetSceneViewport (B-γ — new engine API)

```cpp
// engine.h additions (public)
void SetSceneViewport(int x, int y, int w, int h);  // (0,0,0,0) clears → use full RT
void GetSceneViewport(int& x, int& y, int& w, int& h) const;  // for diagnostics + idempotence

// engine.h additions (private state)
int  m_sceneViewportX = 0;
int  m_sceneViewportY = 0;
int  m_sceneViewportW = 0;     // 0 = "use full RT (BackBufferWidth/Height)"
int  m_sceneViewportH = 0;
bool m_sceneViewportActive = false;
```

```cpp
// engine.cpp implementation sketch
void Engine::SetSceneViewport(int x, int y, int w, int h)
{
    const bool clearing = (w <= 0 || h <= 0);
    if (clearing)
    {
        if (!m_sceneViewportActive) return;     // idempotent no-op
        m_sceneViewportActive = false;
        m_sceneViewportX = m_sceneViewportY = m_sceneViewportW = m_sceneViewportH = 0;
        // Recompute projection at full-RT aspect — matches Reset's setup.
        if (m_presentationParameters.BackBufferWidth > 0 &&
            m_presentationParameters.BackBufferHeight > 0)
        {
            float aspect = (float)m_presentationParameters.BackBufferWidth /
                           (float)m_presentationParameters.BackBufferHeight;
            D3DXMatrixPerspectiveFovRH(&m_projection,
                D3DXToRadian(45), aspect, /*near*/0.5f, /*far*/1000.0f);
        }
        LogHostLine("[engine] SetSceneViewport CLEARED (full-RT)\n");
        return;
    }

    // Idempotent on identical args.
    if (m_sceneViewportActive &&
        x == m_sceneViewportX && y == m_sceneViewportY &&
        w == m_sceneViewportW && h == m_sceneViewportH) return;

    m_sceneViewportX = x; m_sceneViewportY = y;
    m_sceneViewportW = w; m_sceneViewportH = h;
    m_sceneViewportActive = true;

    // Recompute projection at scene-rect aspect.
    float aspect = (float)w / (float)h;
    D3DXMatrixPerspectiveFovRH(&m_projection,
        D3DXToRadian(45), aspect, /*near*/0.5f, /*far*/1000.0f);

    char buf[160];
    snprintf(buf, sizeof(buf),
        "[engine] SetSceneViewport x=%d y=%d w=%d h=%d (aspect=%.3f)\n",
        x, y, w, h, aspect);
    LogHostLine(buf);
}
```

In `Engine::Render`, the viewport binding slots in between the existing
full-RT `Clear` (engine.cpp:670) and the first scene draw (skydome at
~line 679). The **ordering is load-bearing** per Decision D12 — Clear
runs at default (full-RT) viewport so the entire `m_pSceneTexture` is
filled with engine-clear color; SetViewport(scene-rect) follows so
only the scene-rect sub-region receives scene draws. After all scene
draws, viewport is restored to full-RT before the bloom + distort
post-process passes.

```cpp
// engine.cpp around line 670, after the existing Clear:
m_pDevice->Clear(0, NULL, D3DCLEAR_TARGET | D3DCLEAR_ZBUFFER, clearColor, 1.0f, 0);

// B-γ Option A ordering rule (D12): full-RT Clear DONE; now constrain
// scene draws to scene-rect via SetViewport. Cache + restore the
// previous viewport so post-process passes resume at full-RT.
D3DVIEWPORT9 prevViewport = {};
bool restoreViewport = false;
if (m_sceneViewportActive)
{
    m_pDevice->GetViewport(&prevViewport);
    D3DVIEWPORT9 vp = {};
    vp.X      = (DWORD)m_sceneViewportX;
    vp.Y      = (DWORD)m_sceneViewportY;
    vp.Width  = (DWORD)m_sceneViewportW;
    vp.Height = (DWORD)m_sceneViewportH;
    vp.MinZ   = 0.0f;
    vp.MaxZ   = 1.0f;
    m_pDevice->SetViewport(&vp);
    restoreViewport = true;
}

// ... existing skydome / ground / particle render code ...

// After all scene draws, BEFORE the bloom pass at ~engine.cpp:717,
// restore the full-RT viewport so post-process samples + writes at the
// full intermediate texture resolution (post-process textures stay
// full-RT-sized per §3.4 "post-process at full-RT" decision).
if (restoreViewport)
{
    m_pDevice->SetViewport(&prevViewport);
}
```

**Why this ordering eliminates the bloom-bleed concern (R5b dissolved
by D12):** because Clear hits the full RT BEFORE we narrow the
viewport, the area of `m_pSceneTexture` outside scene-rect is filled
with the engine clear color every frame. Bloom's gaussian taps near
the inner scene-rect edge sample this uniform clear color — identical
to the bloom behavior at the actual screen edge today. No "stale pixels
from last frame's scene-pass" hazard. The visible result is a bloom
halo that dims toward the inner scene-rect edge by exactly the same
amount it dims at the screen edge today — visually unremarkable.

**Why recompute projection at every SetSceneViewport call:** the
projection matrix's aspect ratio MUST match the viewport's aspect, or
the scene gets stretched. Recompute is one D3DXMatrixPerspectiveFovRH
call (a few dozen FP operations) — well under a microsecond.

**Why we only `SetViewport` on the scene pass, not on post-process
passes:** post-process passes (bloom, distort) use full-RT-sized
intermediate textures (`m_pSceneTexture`, `m_pDistortTexture`,
`m_pBloomTexture[]`). They read + write at full-RT resolution. With
the D12 ordering rule, the regions outside scene-rect in those
intermediates contain engine clear color (frame-fresh from the
full-RT Clear), so post-process reads predictable values. The
final blit to `offscreenRT` paints post-processed pixels at full RT;
DComp's SetClip at scene-rect crops the periphery away on-screen.

This is the central B-γ trade-off: we waste post-process work outside
scene-rect (rendering pixels DComp clips), but avoid the complexity
of resizing all the intermediate textures per scene-rect change.
Stage 6+ can shrink the post-process pipeline if profiling shows it
as a problem.

### 3.5 Initial-transform seed at attach

In `HostWindowImpl::OnCompositionControllerReady`, immediately after
`m_compositor->AttachEngineVisual(...)` (line ~1268), call:

```cpp
// Seed initial engine-visual transform so first frame sits at the
// scene-rect quadrant. React's first layout/scene-rect dispatch will
// override this — but for the 1-3 frames before that arrives, we want
// it sized correctly. Use the LayoutBroker's cached scene-rect if any;
// fall back to full-client.
int sx, sy, sw, sh;
if (!layout.GetSceneRect(sx, sy, sw, sh))  // new accessor
{
    sx = sy = 0;
    sw = clientW; sh = clientH;
}
HRESULT thr = m_compositor->SetEngineVisualTransform(sx, sy, sw, sh);
if (FAILED(thr) && thr != S_FALSE)
{
    Log("[host] composition: initial SetEngineVisualTransform hr=0x%08lx (non-fatal)\n", thr);
}

// B-γ: also seed the engine viewport so the first scene-pass render
// uses the scene-rect aspect. Without this seed, the first frame
// post-attach renders at full-RT aspect, then snaps to scene-rect
// aspect on React's first layout/scene-rect — visible as a brief
// aspect-ratio pop.
if (engine)
{
    engine->SetSceneViewport(sx, sy, sw, sh);
}
```

New `LayoutBroker::GetSceneRect(int& x, int& y, int& w, int& h)`
accessor — returns `true` if a scene-rect is cached (sceneW > 0),
populates outs; returns `false` otherwise. Trivial.

### 3.6 Late wiring order at attach

The Compositor's `SetCompositor` setter must be called AFTER
`AttachWebView2` + `AttachEngineVisual` so `IsReady()` returns true
when SetSceneRect later tries to dispatch. Place the call in
OnCompositionControllerReady right after the AttachEngineVisual block:

```cpp
// After AttachEngineVisual succeeds (or after the engine-visual skip
// branch — either way, the Compositor is ready to receive transforms).
layout.SetCompositor(m_compositor.get());
```

### 3.7 Teardown order at WM_DESTROY

Current order (HostWindow.cpp:1611):
```cpp
m_compositor.reset();     // releases DComp visual tree
```

New order:
```cpp
layout.SetCompositor(nullptr);   // ★ NEW — clears LayoutBroker's pointer FIRST
m_compositor.reset();
```

Same shape as the existing `layout.SetAlphaCompositor(nullptr)` at line
1813. Without the clear-first, a stray SetSceneRect dispatch
post-WM_DESTROY could dereference a freed Compositor.

### 3.8 Why not use SetTransform (full affine)

`IDCompositionVisual::SetTransform(IDCompositionTransform*)` accepts a
3×2 matrix that can encode scale, rotation, skew, translation. We could
use a scale transform to map engine-RT (lastW × lastH) into scene-rect
(sceneW × sceneH). But that:
1. Distorts the engine RT non-uniformly when aspect ratios differ.
2. Requires creating an IDCompositionScaleTransform object per change.
3. Doesn't address the deferred engine-frustum-vs-scene-rect mismatch
   (it scales the WHOLE RT into the scene-rect, so you'd see the entire
   engine-RT contents squished — including engine clear-color edges).

Plain SetOffset + SetClip preserves 1:1 pixel mapping on the visible
region, which is what we want.

---

## 4. Risks named up front + mitigations

### R1 — Naming collision: `m_compositor` means two things

`LayoutBroker` currently has `AlphaCompositor* m_compositor` (line 136
of the header). The new pointer is `host::Compositor*`. Two pointers
in the same class with the same prefix is a maintenance hazard — a
future reader scanning for "m_compositor" will get false hits.

**Mitigation:** Rename the existing field to `m_alphaCompositor` and
add the new one as `m_dcompCompositor`. The rename is local to
LayoutBroker.{h,cpp} (the field is private). Update the existing
references inside LayoutBroker.cpp (Apply, SetAlphaCompositor,
SetOcclusion, RemoveOcclusion, SetSceneRect, ReemitOcclusions,
CaptureSnapshotPng — ~10 sites). Setter renames stay
`SetAlphaCompositor` (caller-visible) — only the FIELD renames.

**Risk-of-mitigation:** trivial mechanical rename, low risk. Test gate
catches any miss.

### R2 — Coord-space confusion under non-zero popup origin

Currently the popup spans the full client (origin 0,0). If at any
future point the popup gets a non-zero origin, LayoutBroker's
SetSceneRect → AlphaCompositor::SetSceneRect path subtracts
`m_lastX/Y`, but the new `Compositor::SetEngineVisualTransform` path
does NOT (because the engine visual lives in host-client coords, not
popup-client coords).

If the popup ever sits at non-zero (0,0) relative to host-client, the
two paths receive different coordinate spaces. AlphaCompositor sees
popup-client; Compositor sees main-client. That's actually CORRECT —
the AlphaCompositor's band-mask is over the popup, the Compositor's
visual is over the host-client — but it could confuse a future reader.

**Mitigation:** Comment in `LayoutBroker::SetSceneRect` documenting the
two coord spaces and why no translation is applied to the Compositor
path. Mirror in `Compositor::SetEngineVisualTransform`'s doc.

### R3 — WM_SIZE doesn't update engine-visual transform

Today WM_SIZE calls `m_compositor->SetSize(W, H)` (resizes root clip).
The engine visual's offset+clip stays at the LAST scene-rect issued by
React. Between WM_SIZE and React's next `layout/scene-rect` dispatch,
the engine visual is sized for the OLD scene-rect inside a NEW host-
client — visible as a brief mis-rendering during window resize storms.

**Mitigation:** Document this as expected. React's ResizeObserver
fires within 1-3 frames of WM_SIZE; the visible glitch is brief and
matches the existing Stage 4 resize behavior (which has the same gap).
If smoke shows it as objectionable, fall-back: also seed
`SetEngineVisualTransform(0, 0, W, H)` from WM_SIZE when no scene-rect
is cached, deliberately undoing the constraint for the transient
frames so the engine fills the new client until React catches up. Add
this only if smoke proves the need.

### R4 — Engine visual sits at root coord space, but root has SetClip

Compositor::SetSize calls `rootVisual->SetClip({0,0,W,H})`. The engine
visual is a child of root and inherits root's clip. So an engine-visual
SetOffset(scene.x, scene.y) + SetClip({0,0,scene.w,scene.h}) puts the
engine visual at scene.x/scene.y in root's coord space, then root's
clip (full client) doesn't constrain further (scene-rect is always
inside full client). No interaction.

But: if root's SetClip were ever changed to a sub-rect of client (it
isn't today; line 325-333 of Compositor.cpp explicitly clips to
0..W,0..H), the engine visual would also be clipped to that sub-rect.

**Mitigation:** Documented invariant — root clip stays at full host
client. Stage 5 sub-plan comment in Compositor.cpp asserts this.

### R5 — Engine-frustum mismatch — DISSOLVED by B-γ

Resolved by §1.1 Variant B-γ. The Engine's per-frame `SetViewport` +
projection-aspect recompute means the scene IS drawn at scene-rect
dimensions into the scene-rect sub-region of the RT. No clear-color
gap inside the scene-rect.

(Slot kept to preserve risk numbering across past references; logically
empty.)

### R5b — Post-process bleed — DISSOLVED by D12

Resolved by Decision D12 (the Clear-then-SetViewport ordering rule in
§3.4). Because the full-RT `Clear` runs BEFORE the scene-rect viewport
narrows, regions of `m_pSceneTexture` outside scene-rect are filled
with engine clear color every frame. Bloom's gaussian taps near the
inner scene-rect edge sample uniform clear color — same predictable
edge behavior the bloom has at the actual screen edge today.

(Slot kept to preserve risk numbering across past references; logically
empty. No smoke verification required for this risk.)

### R5c — Projection aspect ratio coupling with bloom + distort

The bloom + distort shaders use `m_presentationParameters.BackBufferWidth/Height`
to compute texel offsets (e.g. `engine.cpp:755-756` for the bloom
weights). These offsets correspond to pixel-space sampling distances
on the full-RT-sized intermediates. They DON'T depend on the scene-pass
viewport aspect — they depend on the intermediate texture's pixel
dimensions, which remain full-RT.

**Risk:** none, actually — the offsets are computed against the
intermediate texture dimensions (full RT), which match the actual
texture dimensions. The shaders are correct as-is.

**Mitigation:** none needed. Documented here to head off future
"shouldn't we update the bloom offsets" reflexes.

### R6 — DComp `SetClip` accepts D2D_RECT_F; clip values must be sane

`D2D_RECT_F` is left/top/right/bottom (not x/y/w/h). The clip rect we
pass is `{0, 0, w, h}` which is "from local origin, width × height" —
correct semantics. Easy to mis-write as `{x, y, x+w, y+h}` which would
be "in PARENT coord space, this rect" — WRONG (parent coord space
doesn't apply to SetClip; SetClip is in the visual's OWN coord space
post-offset).

**Mitigation:** Comment in the code; test by inspecting the host.log
`[COMP-engine-transform]` output against the expected coords.

### R7 — Composition-mode dist/ rebuild discipline (unchanged)

The HWND baseline (99 + 22 skipped) requires default-mode `dist/`; the
118 + 3 + 0 composition gate requires composition-mode `dist/`. Running
the wrong dist/ produces confusing partial passes (see Stage 4f
session notes on canvas-architecture.spec.ts failures).

**Mitigation:** Stage 5's verification §5 explicitly rebuilds dist/
between the HWND baseline run and the composition-mode run, in both
directions. Same discipline as Stage 4. (L-021 candidate if this bites
again — env-var consistency check in the harness.)

### R8 — Engine::Reset must restore the scene viewport projection

`Engine::Reset` rebuilds `m_projection` from
`m_presentationParameters.BackBufferWidth/Height` at line 1448, AFTER
the device reset. This overwrites the scene-rect-aspect projection
that SetSceneViewport set last. If a scene-rect was active before
Reset, the next post-Reset frame will use the wrong (full-RT-aspect)
projection until React's next layout/scene-rect re-applies.

**Visible:** one-frame aspect-ratio glitch at every window resize
(because window resize triggers Engine::Reset via LayoutBroker.Apply).

**Mitigation:** at the END of Engine::Reset, after the existing
projection-matrix rebuild at line 1448, re-apply the cached scene
viewport state:

```cpp
// Re-apply cached scene viewport (B-γ) so projection aspect survives
// Reset. SetSceneViewport recomputes the projection matrix internally.
if (m_sceneViewportActive)
{
    int sx = m_sceneViewportX, sy = m_sceneViewportY;
    int sw = m_sceneViewportW, sh = m_sceneViewportH;
    m_sceneViewportActive = false;  // force the SetSceneViewport idempotent guard to re-fire
    SetSceneViewport(sx, sy, sw, sh);
}
```

The SetViewport call itself happens in Render and doesn't need to be
re-issued from Reset — Render handles it every frame from
`m_sceneViewportActive`.

### R9 — SetSceneViewport during canvas-jpeg / arch-A paths

LayoutBroker::SetSceneRect fires under all transports (canvas-jpeg,
canvas-bgra, arch-A, composition). Under non-composition modes, the
engine viewport doesn't need to track scene-rect — the legacy
AlphaCompositor + popup path handles visibility via band-masks, and
the engine RT is consumed via ULW which expects full-RT content.

If we always call `m_engine->SetSceneViewport` from
LayoutBroker.SetSceneRect, the engine will constrain itself to
scene-rect under canvas-jpeg too — visible result: rendered scene
shrinks into the scene-rect sub-region of the full-popup popup, and
the rest of the popup shows engine clear-color through the
AlphaCompositor's band-mask that DOESN'T paint alpha=0 over those
regions (because the bands are at chrome edges, not at scene-rect
edges).

**Mitigation:** Gate the `m_engine->SetSceneViewport` call on
composition mode. Either:
- (a) Plumb `m_compositionMode` into LayoutBroker (via HostWindow,
  same shape as `SetCompositor`), and call SetSceneViewport only
  when in composition mode.
- (b) Always call SetSceneViewport; have Engine internally check
  whether composition mode is active (via a "transport hint" set by
  HostWindow at boot).
- (c) Simplest: have LayoutBroker call SetSceneViewport only when
  `m_dcompCompositor != nullptr` (which is exactly the composition-
  mode-active condition).

Going with (c) — the Compositor's presence in LayoutBroker is the
composition-mode signal. No new flag needed.

---

## 5. Testing & verification

### 5.1 Pre-coding gate (before any production-code edit)

- [ ] `pnpm -w typecheck` — 0 errors
- [ ] `pnpm -w test` — vitest **338 / 338**
- [ ] MSBuild Debug + Release x64 clean
- [ ] Playwright HWND baseline: **99 passed + 22 skipped** under
      default dist/ (no env vars), 0 failed
- [ ] (Optional) Composition-mode native baseline: rebuild dist/ with
      VITE_VIEWPORT_TRANSPORT=canvas-jpeg + VITE_WEBVIEW2_HOSTING=composition;
      run with ALO_* matching: **118 + 3 + 0**
- [ ] (Optional) `shared_texture_test.exe` — PASS
- [ ] (Optional) `dxgi_spike.exe` — smoke at 1080p

### 5.2 Per-step (TDD-flavored)

Each step in §6 has its own verification — listed inline there. The
big-picture acceptance gates:

- [ ] **Compile gate** after `SetEngineVisualTransform` lands.
- [ ] **Unit-ish gate** — temporary main() in Compositor.cpp or a
      gtest if we have the framework wired (we don't; skip — rely on
      Playwright + smoke).
- [ ] **Wiring gate** — host.log shows `[COMP-engine-transform]` line
      on first scene-rect dispatch from React.
- [ ] **Idempotence gate** — repeat the same scene-rect; second call
      logs no second `[COMP-engine-transform]` line (early-return
      hits).

### 5.3 Playwright spec — `dxgi-scene-rect.spec.ts`

Three scenarios:

1. **Initial transform seeded.** Boot the editor under composition
   mode, parse host.log, assert at least one
   `[COMP-engine-transform]` line appears before the first
   `[COMP-engine-frame]` line.
2. **Scene-rect change drives transform.** Dispatch
   `layout/scene-rect` with `{x: 100, y: 50, w: 800, h: 600}` via
   `window.bridge.request("layout/scene-rect", ...)`. Assert host.log
   gains `[COMP-engine-transform] offset=(100,50) clip=800x600`.
3. **Three-step sweep.** Dispatch scene-rect at three different sizes
   sequentially; assert three matching transform log lines in order.

Skip-pattern: `test.skip(process.env.ALO_WEBVIEW2_HOSTING !== "composition", ...)`.
Register in `scripts/run-native-tests.mjs`.

### 5.4 Manual smoke (user-driven)

Per the Stage 4 smoke template, captured into `tasks/stage-5-smoke-result.md`:

- [ ] **Default chrome smoke.** Launch with composition env vars +
      composition dist/. Open default scene. Verify chrome panels
      (left tree, right inspector, bottom panel if any) show solid
      panel backgrounds — NO engine clear-color leaking through.
- [ ] **Pane resize.** Drag a pane divider. Engine visual's visible
      region tracks the new scene-rect. (Caveat per R5: scene contents
      may not fill the new region if frustum mismatch — that's the
      deferred symptom; visible at the EDGE of the new scene-rect.)
- [ ] **Window resize.** Maximize, then restore. Engine visual tracks
      scene-rect within the new host-client size. No persistent
      mis-rendering after the React ResizeObserver settles.
- [ ] **Interactive smoke.** Shift+click in viewport spawns
      particle — verify the click reaches the engine at the correct
      scene-rect coordinates. (This validates that the engine's input
      pathway, which operates in popup-client coords, still produces
      correct scene coordinates when the scene-rect transform shifts
      the visible engine output.)
- [ ] **Screenshot.** Capture the final state. Embed in
      `tasks/stage-5-smoke-result.md`.

### 5.5 Regression gates

- [ ] HWND baseline reproducible after Stage 5: rebuild dist/ in
      default mode, run native, **99 + 22 skipped + 0 failed**.
- [ ] Composition mode: **119 + 3 + 0** (adds the 1 new
      dxgi-scene-rect spec to the previous 118).
- [ ] No new failure-class log entries in host.log under either mode.
- [ ] tsc -b 0 errors; vitest 338/338.
- [ ] MSBuild Debug + Release x64 clean.

### 5.6 Debug instrumentation tags

- `[COMP-engine-transform]` — every actual transform change (idempotent
  cases are silent).
- `[COMP-engine-fail]` — any HRESULT failure (Set\* / Commit), same as
  Stage 4's failure tag.

Grep prefix for the user: `[COMP-engine-transform]` for normal flow,
`[COMP-engine-fail]` for any error.

---

## 6. Bite-sized task breakdown

(Plan-execution outline. Each task is a 5-15 min unit; commits land
after each verification step passes.)

### T1 — Add `SetEngineVisualTransform` to Compositor (no wiring yet)

- T1.1 Add method declaration to `Compositor.h` (Stage 4 block).
- T1.2 Add `Impl::engineLastX/Y/TransformW/TransformH` fields,
       zero-init.
- T1.3 Add `Compositor::SetEngineVisualTransform` body in `.cpp` per
       §3.1.
- T1.4 Build Debug x64 — expect clean.
- T1.5 Build Release x64 — expect clean.
- T1.6 Commit: `feat(LT-4): [MT-11] Phase 3 Stage 5 T1 — Compositor::SetEngineVisualTransform`.

### T2 — Add `LayoutBroker::SetCompositor` + `GetSceneRect`, plus rename `m_compositor` → `m_alphaCompositor`

- T2.1 Rename `m_compositor` → `m_alphaCompositor` in `LayoutBroker.h`
       (private field).
- T2.2 Update all in-file references in `LayoutBroker.cpp` (~10 sites).
- T2.3 Add forward declaration `class Compositor;` to `LayoutBroker.h`
       in the `host` namespace.
- T2.4 Add `m_dcompCompositor` field + `SetCompositor(host::Compositor*)`
       setter.
- T2.5 Add `GetSceneRect(int&, int&, int&, int&)` accessor.
- T2.6 Build Debug x64.
- T2.7 vitest + tsc passing.
- T2.8 Commit: `refactor(LT-4): [MT-11] Phase 3 Stage 5 T2 — LayoutBroker DComp seam`.

### T3 — Add `Engine::SetSceneViewport` + Render hook + Reset re-apply (B-γ)

- T3.1 Add `SetSceneViewport` + `GetSceneViewport` declarations to
       `engine.h` (public). Add `m_sceneViewportX/Y/W/H` + `m_sceneViewportActive`
       to private state (zero-init).
- T3.2 Implement `Engine::SetSceneViewport` body per §3.4 (stash rect,
       recompute `m_projection` with scene-rect aspect via
       `D3DXMatrixPerspectiveFovRH`, log `[engine] SetSceneViewport …`).
       Clearing branch (w<=0 || h<=0) restores full-RT aspect projection.
- T3.3 In `Engine::Render`, apply the **D12 ordering rule**: AFTER the
       existing full-RT `Clear` at ~engine.cpp:670 (which fills the
       entire `m_pSceneTexture` with engine clear color), GetViewport
       + SetViewport(scene-rect) gated on `m_sceneViewportActive`.
       Before the bloom pass at ~line 717, restore the cached viewport.
       See §3.4 code sketch.
- T3.4 In `Engine::Reset` (engine.cpp:1260), AFTER the projection matrix
       rebuild at ~line 1448, re-apply cached SetSceneViewport per R8
       mitigation.
- T3.5 Build Debug x64 — expect clean.
- T3.6 Build Release x64.
- T3.7 Manual sanity: launch editor in default (HWND) mode. With no
       SetSceneViewport callers wired yet, nothing should change. Native
       HWND baseline still **99 + 22 skipped + 0 failed**.
- T3.8 Commit: `feat(LT-4): [MT-11] Phase 3 Stage 5 T3 — Engine::SetSceneViewport (B-γ)`.

### T4 — Wire `LayoutBroker::SetSceneRect` → Compositor + Engine

- T4.1 In `LayoutBroker::SetSceneRect`, add the composition-mode
       Compositor call per §3.3 (no translation).
- T4.2 In the same path, also call `m_engine->SetSceneViewport(x, y, w, h)`
       gated on `m_dcompCompositor != nullptr` per Risk R9 mitigation (c).
- T4.3 In `LayoutBroker::ReemitOcclusions`, add the parallel scene-rect
       call to the Compositor path. (SetSceneViewport doesn't depend on
       popup origin so doesn't need re-emit.)
- T4.4 Build Debug x64 (no consumer yet — wires sit dormant until
       HostWindow calls SetCompositor in T5).
- T4.5 Commit: `feat(LT-4): [MT-11] Phase 3 Stage 5 T4 — LayoutBroker scene-rect → Compositor + Engine`.

### T5 — HostWindow wiring: attach + seed + teardown

- T5.1 In `HostWindowImpl::OnCompositionControllerReady`, after
       AttachEngineVisual (success or skip both branches), call
       `layout.SetCompositor(m_compositor.get())`.
- T5.2 Seed the initial DComp transform per §3.5 — gated on engine-visual
       attach success.
- T5.3 Seed the initial engine viewport per §3.5 (B-γ addendum) — gated
       on engine non-null + composition mode.
- T5.4 In WM_DESTROY before `m_compositor.reset()`, add
       `layout.SetCompositor(nullptr)`.
- T5.5 Build Debug x64.
- T5.6 Native HWND baseline still **99 + 22 skipped + 0 failed**.
- T5.7 Commit: `feat(LT-4): [MT-11] Phase 3 Stage 5 T5 — HostWindow attach/teardown`.

### T6 — Composition-mode smoke (user check-in)

- T6.1 Rebuild dist/ in composition mode.
- T6.2 Launch editor under composition.
- T6.3 Visually verify chrome no longer bleeds engine pixels.
- T6.4 Visually verify scene drawn at scene-rect aspect (not stretched
       or cropped) — pan/zoom to confirm.
- T6.5 Pane-resize smoke. (R5b dissolved structurally by D12 — no
       bloom-edge check required.)
- T6.6 Window-resize smoke (R3 + R8). Watch for one-frame aspect glitch.
       If persistent, debug R8 cached-viewport re-apply.
- T6.7 Interactive smoke (Shift+click spawn at scene-rect edges).
- T6.8 Screenshot → `tasks/stage-5-smoke-result.md`.
- T6.9 (USER check-in point — confirms visual result matches B-γ
       expected behavior.)

### T7 — Playwright spec

- T7.1 Add `web/apps/editor/tests/dxgi-scene-rect.spec.ts` per §5.3.
       Asserts both `[COMP-engine-transform]` AND `[engine] SetSceneViewport`
       log lines per scene-rect dispatch.
- T7.2 Register in `scripts/run-native-tests.mjs`.
- T7.3 Run composition-mode native — expect **119 + 3 + 0**.
- T7.4 Rebuild dist/ in default mode; re-run native HWND — expect
       **99 + 22 skipped + 0** (new spec skips cleanly).
- T7.5 Commit: `test(LT-4): [MT-11] Phase 3 Stage 5 T7 — dxgi-scene-rect spec`.

### T8 — Docs

- T8.1 Append CHANGELOG entry per `CLAUDE.md` Roadmap-update rules
       (Stage 5 in-progress notes; backfill PR hash post-merge).
- T8.2 Refresh `tasks/HANDOFF.md` — Phase 3 Stage 5 SHIPPED section.
- T8.3 Update `tasks/todo.md` umbrella Stage 5 acceptance checks.
- T8.4 If R5b smoke surfaced post-process bleed → document under
       Stage 6 candidate work.
- T8.5 Commit: `docs(LT-4): [MT-11] Phase 3 Stage 5 — CHANGELOG + HANDOFF refresh`.

### T9 — End-of-session FF + push

- T9.1 `git switch lt-4 && git pull --ff-only origin lt-4` (sync).
- T9.2 `git merge --ff-only claude/affectionate-euclid-5d1c8f`.
- T9.3 `git push origin lt-4`.
- T9.4 Verify origin/lt-4 tip matches the expected Stage 5 close-out
       commit.

---

## 7. Decision log (pre-coding)

Tracking the decisions surfaced during this sub-plan so future readers
have the why-not-X:

- **D1: Option A (offset+clip, fixed swapchain) over Option B
  (ResizeBuffers per scene-rect).** §3.2 table. **LOCKED 2026-05-25.**
- **D2: Plain SetOffset+SetClip over SetTransform full affine.** §3.8.
  Preserves 1:1 pixel mapping; avoids object-creation churn.
- **D3: Rename `LayoutBroker::m_compositor` → `m_alphaCompositor`** to
  disambiguate from the new `m_dcompCompositor`. R1.
- **D4: No coord translation on the Compositor path.** Engine visual
  is in host-client coords (root-visual child); LayoutBroker's existing
  popup-coord translation applies only to AlphaCompositor. R2 + §3.3.
- **D5: Seed initial transform from LayoutBroker's cached scene-rect
  at attach time.** Avoids 1-3 frame mis-render before React's first
  layout/scene-rect dispatch. §3.5.
- **D6: WM_SIZE does NOT need engine-visual-transform update.** React's
  ResizeObserver fills the gap. R3. Fallback documented if smoke
  proves the need.
- **D7: Variant B-γ (engine viewport tracks scene-rect, RT stays
  full-client) over B-α (decoupled RT — won't work) and B-β (popup
  tracks — heavy Reset storms).** §1.1 + §3.4. **LOCKED 2026-05-25.**
- **D8: SetSceneViewport recomputes projection at scene-rect aspect.**
  §3.4. Without this, the scene gets stretched. Recompute is cheap
  (one D3DXMatrixPerspectiveFovRH per call).
- **D9: Only the scene pass gets the constrained SetViewport; post-
  process passes stay at full-RT.** §3.4. Wastes post-process work
  outside scene-rect, but DComp clip hides it. R5b notes the bloom-
  bleed-across-boundary risk + smoke mitigation.
- **D10: SetSceneViewport gated on composition mode** via the presence
  of `m_dcompCompositor != nullptr` in LayoutBroker. R9 mitigation (c).
  Canvas-jpeg / arch-A paths see no behavior change.
- **D11: Engine::Reset re-applies cached SetSceneViewport** after
  the projection matrix rebuild at engine.cpp:1448. R8 mitigation.
- **D12: Engine::Render Clear-then-SetViewport ordering rule.**
  Clear runs at default (full-RT) viewport BEFORE the scene-rect
  SetViewport narrows the scope. Outside scene-rect of
  `m_pSceneTexture` is filled with engine clear color every frame;
  post-process passes that sample across the scene-rect boundary
  read predictable uniform values. Dissolves R5b structurally — no
  smoke check needed for bloom bleed.

---

## 8. Time estimate (B-γ revised)

- T1 (Compositor SetEngineVisualTransform): ~30 min including build + commit
- T2 (LayoutBroker rename + setter + accessor): ~45 min
- T3 (Engine::SetSceneViewport + Render hook + Reset re-apply): ~75 min
  (touches engine.h + 3 sites in engine.cpp; new state + projection +
  per-frame viewport + Reset re-apply)
- T4 (LayoutBroker call sites for both Compositor and Engine): ~30 min
- T5 (HostWindow wiring): ~30 min
- T6 (smoke + user check-in, includes R5b bloom-bleed check): ~45 min
  user + ~30 min Claude
- T7 (Playwright spec): ~60 min
- T8 (docs): ~45 min
- T9 (FF + push): ~10 min

**Total: ~5-6 hours Claude work + 45 min user smoke.** Still within
parent-plan §4 Stage 5 estimate (2-3 days) by a comfortable margin —
B-γ adds an Engine API but stays clear of the resize-storm hazards
that would have made B-β stretch toward the full 2-3 days.
