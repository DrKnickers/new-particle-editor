# Resize performance investigation — root causes + fix proposals

_2026-06-10 (session 33). Multi-agent audit (run `wf_249936bf-ee0`: 61 agents,
6 dimensions, every finding adversarially verified — 33 confirmed / 21 refuted /
0 unverified). Symptom: performance tanks while resizing the app window or
dragging panel splitters; the spawner/lighting dock slide stays smooth. The
dock slide was used as the differential control. INVESTIGATION ONLY — no fixes
built yet; proposals below await scoping._

## TL;DR

The two scenarios share a symptom but have **different dominant causes**:

- **Window resize** has a single dominant root cause: a **full D3D9Ex device
  reset on every mouse-move tick** of the OS modal sizemove loop
  (10–100+ ms × 30–60/sec), with a long chained tail (texture-cache wipe +
  disk re-decode, ~40 MB realloc minting a new NT shared handle,
  `OpenSharedResource` + DXGI `ResizeBuffers`, cold-frame render with a
  busy-spin GPU drain) — all serialized on the UI thread inside the modal loop.
- **Splitter drag** never resets the device. Its tank is the **interaction**
  of three medium costs: an **uncapped render loop + busy-spin GPU sync**
  pegging a core and saturating the GPU (so WebView2 has no headroom), a
  **60–144 msgs/sec ResizeObserver→bridge stream** (no dedupe, discarded
  responses, synchronous log flush per message), and **multi-clock judder**
  (the engine viewport edge moves on the render-loop clock while the DOM edge
  moves on the browser vsync clock — named in the code's own comment at
  `BridgeDispatcher.cpp:931-935`).

The dock slide avoids all of it by construction: ONE `animate-scene-rect`
message, RO suppression for the gesture, host-side QPC-clocked interpolation
(`SetSceneViewport` + deferred DComp `SetClip` — zero alloc, zero reset, zero
per-tick IPC), one settle commit. **It is the proven fix template.**

## Window-resize causal chain (dominant)

Every modal-loop tick (`WM_WINDOWPOSCHANGED`, [HostWindow.cpp:2344-2348](../src/host/HostWindow.cpp)):

1. `LayoutBroker::PredictAndApply` sees a changed client size →
   **`m_engine->Reset()`** ([LayoutBroker.cpp:251-254](../src/host/LayoutBroker.cpp)).
2. `Engine::Reset` ([engine.cpp:1351-1473](../src/engine.cpp)) per tick:
   `OnLostDevice` on all shaders/effects; release+recreate scene/distort/bloom
   RTs + depth-stencil + skydome VB/IB; **`TextureManager::OnLostDevice` wipes
   the ENTIRE particle-texture cache** ([main.cpp:240-244](../src/main.cpp)) →
   lazily re-decoded from disk/MEG on the very next render;
   `ReloadGroundTexture`/`ReloadSkydomeTexture` (D3DX decode per tick);
   `IDirect3DDevice9Ex::Reset` (GPU pipeline drain).
3. `AlphaCompositor::Resize` ([AlphaCompositor.cpp:115-183](../src/host/AlphaCompositor.cpp))
   inside the Reset: new shared RT (**new NT handle every tick**) + a SYSTEMMEM
   readback surface + a GDI DIB section (~40 MB realloc/tick at 2560×1440 —
   the latter two are arch-A leftovers arch-C never uses per frame).
4. The new handle forces, same tick:
   `RefreshEngineSharedHandle` ([Compositor.cpp:1047, 1166-1253](../src/host/Compositor.cpp))
   → D3D11 `OpenSharedResource` + `IDXGISwapChain1::ResizeBuffers` + `GetBuffer`.
5. The forced `RenderD3D9` renders a **cold post-reset frame** (cache wiped) and
   **busy-spins `WaitEndFrameQuery`** ([engine.cpp:1521-1535](../src/engine.cpp),
   100k-iteration `GetData` poll, no yield) until the GPU drains it.

One tick exceeds the 16 ms frame budget by 5–10×, at mouse-move rate.
Secondary (absorbed once the storm is gone): `put_Bounds` full Chromium
re-raster per `WM_SIZE` (~5–30 ms off-thread), `WM_ERASEBKGND` full-client GDI
fill (~1–2 ms/tick), duplicate scene-rect IPC.

**Red herring (confirmed dead):** the `layout/viewport-rect` →
`Engine::Reset` bridge binding ([BridgeDispatcher.cpp:894-903](../src/host/BridgeDispatcher.cpp))
is test/poc-only — no production web code sends it. The live reset driver is
the NATIVE `PredictAndApply` path. (The comment at :916-919 misleads; hygiene
fix queued.) FramePublisher / per-frame `GetRenderTargetData` / the `<img>`
transport are all confirmed dormant under arch-C.

## Splitter-drag causal model (no reset involved)

1. **Baseline amplifier** — the idle pump free-runs (`PeekMessage` + render,
   no cap, no vsync, [HostWindow.cpp:3357-3428](../src/host/HostWindow.cpp);
   `Present1(0,…)`) and every frame busy-spins `WaitEndFrameQuery`: one core
   at 100%, GPU saturated continuously. Chromium's per-frame relayout/re-raster
   of the panels must contend with this; every bridge message interleaves into
   the same 100%-busy pump. The dock slide survives it only because it adds
   near-zero work per frame.
2. **The stream** — `ViewportSlot`'s RO ([ViewportSlot.tsx:87-91](../web/apps/editor/src/components/ViewportSlot.tsx))
   emits a full `bridge.request` round-trip per display frame (60–144/sec;
   ~2× during window resize via a redundant `window resize` listener), no
   last-rect dedupe, response discarded. Each message: JSON parse, UTF16↔8,
   synchronous host-log `fflush`, `OutputDebugStringA` ×2 (~0.05–0.5 ms each,
   ms-class with a debugger attached) — ~5–50 ms/sec stolen from the pump.
3. **The judder** — each scene-rect applies on the engine-frame/DComp-commit
   clock while the DOM edge tweens on browser vsync → up to ~5–20 ms spatial
   phase error between the viewport edge and the panel edge. This is why the
   drag FEELS bad even when fps stays high.

Notable refuted-but-real (immaterial alone, candidates for hygiene): per-message
host-log fflush, `Engine::SetSceneViewport`'s ungated `printf`+`fflush`
([engine.cpp:1705-1711](../src/engine.cpp)), React panel-layout re-render claims
(memoization holds), autosave-timer-mid-drag.

## Fix proposals (ranked)

**A — defer `Engine::Reset` to gesture settle (window-resize dominant; ~1-2 d).**
Track `WM_ENTERSIZEMOVE`/`WM_EXITSIZEMOVE`; while in sizemove,
`PredictAndApply` skips the Reset and the DComp engine visual stretches the
last-presented surface (the dock slide's `SetEngineVisualTransform` path,
proven smooth); ONE Reset + render + composite on exit, plus a ~100 ms
quiescence-timer fallback for snap/maximize/keyboard resizes. Collapses
30–60 resets/sec → 1/gesture. **Single highest-leverage change.**

**A2 — make the one settle-reset cheap (~2-3 d, after A).** Switch the resize
path to `IDirect3DDevice9Ex::ResetEx` semantics (DEFAULT-pool survives —
verify against first-party docs which pools the engine uses), stop wiping the
texture cache + re-decoding ground/skydome on resize-only resets, and make
`AlphaCompositor`'s SYSTEMMEM+DIB allocations lazy (first-snapshot) under
composition. Settle reset: 10–100 ms → low-single-digit ms.

**B — pace the render loop + unblock the GPU sync (splitter dominant; ~2-3 d).**
Cap the idle pump to composition cadence (`MsgWaitForMultipleObjectsEx` with a
frame budget / DComp-commit wait) and make `WaitEndFrameQuery` yield
(`SwitchToThread` between polls, or skip-composite-and-reuse-frame when
unsignalled). Frees a core + caps GPU at display rate → WebView2 gets headroom.

**C — scene-rect stream: dedupe → one-way → host-clocked (escalating).**
(1) ~half-day: last-rect dedupe in `send()` + drop the redundant window-resize
listener. (2) fire-and-forget post instead of `bridge.request` + gate the
per-message log flush and the `SetSceneViewport` printf under NDEBUG.
(3) ~2-3 d, fixes the judder: extend the dock-slide pattern to splitter drags —
suppression signal on splitter pointer-down, host treats incoming rects as
TARGETS and lerps on its QPC clock via the existing `AdvanceSceneAnim`
machinery, one authoritative settle rect on pointer-up.

**D — cheap riders (batch into A's PR; ~half-day).** `WM_ERASEBKGND → return 1`
+ null background brush + drop `CS_HREDRAW|CS_VREDRAW`; throttle `put_Bounds`
to ~30 Hz during sizemove; fix the misleading viewport-rect comment.

## Instrumentation to confirm ranking BEFORE building (~half-day)

1. QPC bracket around `m_engine->Reset()` in `PredictAndApply` — count +
   min/avg/max ms at 1 Hz. Expect 30–60/sec × 10–100 ms during border drag;
   0 during splitter/dock. Confirms or kills the window-resize ranking alone.
2. Sub-stage split inside one Reset (texture wipe/reload vs `AlphaCompositor::Resize`
   vs device `Reset`) — sizes the A2 payoff.
3. scene-rect msgs/sec counter + per-message host cost (with and without
   DebugView attached) — expect ~60–144 (splitter) / ~120+ (window) / ~1 (dock).
4. `WaitEndFrameQuery` spin time + idle-loop fps at 1 Hz — proves the uncapped
   loop and the contention growth during drags.

## Full audit data

Run `wf_249936bf-ee0` (session 33). 33 confirmed findings across 6 dimensions
(react-resize-source, host-viewport-rect-sink, engine-reset-and-rt,
wm-size-and-webview, dock-slide-contrast, render-loop-interaction); the
dominant ones are inlined above. 21 refuted findings were mostly
"real mechanism, immaterial magnitude" (log flushes, printf, React re-render
claims disproven by memoization) — kept in the run output for reference.
