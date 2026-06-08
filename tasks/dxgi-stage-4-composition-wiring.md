# tasks/dxgi-stage-4-composition-wiring.md — [MT-11] Phase 3 Stage 4

> **Active sub-plan.** Awaiting user OK + risks iteration before any production code.
>
> Parent plan: [`tasks/todo.md`](todo.md) §4 Stage 4 + §6 Stage 4 acceptance.
> Predecessor: [Stage 3 composition hosting](dxgi-stage-3-composition-hosting.md) (shipped 3a–3g on `origin/lt-4`).
> Working reference: [`src/host/spike/dxgi_spike.cpp`](../src/host/spike/dxgi_spike.cpp) — the GPU pipeline this stage productionizes.

**Difficulty:** ★★★★ (one star less than Stage 3 — the spike already
validated the GPU pipeline end-to-end on the user's RTX 3080; Stage 4
ports proven topology into a stable class, doesn't invent new GPU
shape).

**Effort estimate:** 3-4 days per parent plan §4.

**Stage gate semantics.** Per parent §8, between sub-stages 4a-4f
explicit user check-ins at **4b** (first engine pixels — load-bearing
gate, equivalent to 3b's FD6 gate but for the GPU pipeline) and **4f**
(Stage 4 → Stage 5 handover). Other sub-stages commit-only.

**Bounded-iteration protocol.** If 4b lands and engine pixels don't
appear (or appear corrupted), apply the same 24-hour cap that Stage 3
used: spend time on documented bisect (env-var to disable engine visual
isolation, instrument every HRESULT, compare against
`shared_texture_test.exe` on identical hardware), then STOP and surface
to the user. The spike already cleared the GPU pipeline on this rig
once — so a production-mode-only failure is a new bug class, not the
same one that bit FD6.

---

## 1. Goal + scope

**When this ships:** With `ALO_WEBVIEW2_HOSTING=composition` set, the
host's WebView2 chrome AND the engine's particle viewport BOTH render
through the DComp tree. The engine visual is a sibling of the WebView2
visual; chrome with opaque backgrounds occludes engine pixels, chrome
with transparent backgrounds shows them through. Stage 3's
[`tasks/stage-3b-smoke-screenshot.png`](stage-3b-smoke-screenshot.png)
captures the "no engine pixels yet" state; Stage 4's success screenshot
shows the dark viewport quadrant area filled with engine pixels
(animated particle systems if any are emitting, or at minimum the
engine's dark-purple clear color, distinguishable from Stage 3's
ViewportSlot placeholder text).

Performance gate: the spike measured 0.30 ms total frame-transport at
3440×1440 (~3000+ FPS theoretical). Production overhead (`Engine::Render`,
render loop scheduling, OS) brings this down substantially, but the
acceptance bar is generous: mean FPS > 80 at 1080p AND > 60 at 3440×1440
(vs Phase 2's 40-50 FPS at 3440×1440 with the readback path).

Without the env var, behaviour is byte-identical to today — no D3D11
device created, no DXGI swapchain, no engine visual; AlphaCompositor's
arch-A readback path continues as today.

**In scope:**

- **`host::Compositor` gains engine-side ownership.** New public
  methods `AttachEngineVisual(HANDLE sharedTexture, int w, int h)`
  and `CompositeEngineFrame()`. Internally the Compositor's pImpl
  acquires: an `ID3D11Device` + immediate context, an `IDXGIFactory2`,
  an `ID3D11Texture2D` opened from the engine's shared handle, an
  `IDXGISwapChain1` (composition mode), a cached back-buffer
  reference, and a new `IDCompositionVisual` for the engine. No new
  .cpp file — Compositor.cpp already has the L-016 DXSDK-isolation
  override, so adding `<d3d11.h>` + `<dxgi1_2.h>` includes there is
  free (they're already pulled in by `<dcomp.h>`).
- **Engine visual inserted FIRST in the children list**, so the
  WebView2 visual (added in Stage 3) renders on top per DComp
  list-order. This requires `AttachEngineVisual` to either run before
  `AttachWebView2` OR re-stack via `RemoveVisual` + re-`AddVisual` —
  ordering decision below.
- **Auto-attach under composition mode.** Inside
  `OnCompositionControllerReady` (HostWindow.cpp:1090 post-F8 / post-host-polish-bundle), after
  `AttachWebView2` succeeds (~line 1203), call `m_compositor->AttachEngineVisual(
  engine->GetSharedTextureHandle(), aSize.cx, aSize.cy)`. No
  separate env var — composition mode IS DXGI mode for engine
  pixels. The existing `ALO_VIEWPORT_TRANSPORT=canvas-jpeg` env-var
  pair Stage 3 requires (per its risk #15) stays as the input-bridge
  enabler; Stage 4 doesn't unwire it.
- **Per-frame composite step.** HostWindow's RenderD3D9 path (today
  calls `engine->Render()` then `m_framePublisher->OnFrameComposited()`)
  gets a new branch under composition mode: after `engine->Render()`,
  call `m_compositor->CompositeEngineFrame()` which does the D3D9
  end-frame sync + D3D11 `CopyResource(backBuffer, sharedAlias)` +
  `swapChain->Present1(0, 0, &pp)`.
- **Cross-device GPU sync.** Production port of the spike's D3D9
  event-query spin-loop ([dxgi_spike.cpp:687-697](../src/host/spike/dxgi_spike.cpp:687)).
  Lives in the Compositor (which holds the swapchain) but needs the
  D3D9 device — passed via the AttachEngineVisual signature or via
  a separate `Engine::EndFrameAndSync()` call exposed to the host.
  See §3.3 for the design choice.
- **Resize handling.** Every `AlphaCompositor::Resize()` creates a
  NEW shared HANDLE (the old one is invalidated). Compositor must
  detect this and re-open. Two valid implementations: explicit
  notification on the WM_SIZE path, or lazy per-frame
  handle-equality check in `CompositeEngineFrame`. Recommend lazy
  per-frame check — single pointer compare per frame, naturally
  handles any handle invalidation regardless of source.
- **New Playwright specs** per parent §6: `tests/dxgi-transport.spec.ts`,
  `tests/dxgi-vs-jpeg.spec.ts`, `tests/dxgi-perf.spec.ts`, resize
  stress within transport or perf spec. All registered in
  [`scripts/run-native-tests.mjs`](../web/apps/editor/scripts/run-native-tests.mjs)
  with the composition env-var pair set.
- **D3D11 debug layer in Debug builds** (matching the spike at
  [dxgi_spike.cpp:308](../src/host/spike/dxgi_spike.cpp:308)). Falls
  back gracefully if SDK layers aren't installed.
- **Diagnostic logging tags** following Stage 3's pattern:
  `[COMP-engine-init]`, `[COMP-engine-attach]`, `[COMP-engine-frame]`
  (1 Hz throttled), `[COMP-engine-resize]`, `[COMP-engine-fail]`.

**Out of scope:**

- **Scene-rect transform on the engine visual.** Engine pixels fill
  the FULL host client under Stage 4 — the swapchain stretches the
  engine-rendered texture to host-client size, and the engine visual
  sits at (0,0,W,H). Chrome occludes; transparent regions show
  engine. Visual appearance differs from the eventual scene-rect-
  constrained quadrant rendering. **Deferred to Stage 5** (input
  routing rework, which already needs the LayoutBroker scene-rect
  surface).
- **AlphaCompositor + FramePublisher removal.** Both keep running
  under composition mode — `AlphaCompositor::Composite` does its
  readback + DIB copy + UpdateLayeredWindow on the hidden popup, and
  FramePublisher publishes JPEGs to a renderer-side canvas nobody
  reads. Wasted CPU/GPU work but harmless. Stage 7 deletes both.
- **ID3D11Fence-based sync.** The spike's spin-loop is cheap at
  measured 0.30 ms; fence-based sync is an optional optimization if
  profiling shows the spin dominates. Default to spike-equivalent
  spin; revisit if perf gate fails.
- **Multi-adapter / multi-GPU edge cases.** If D3D11 LUID doesn't
  match D3D9Ex's, log the mismatch and skip engine-visual attach —
  user falls back to no-engine-pixels-under-composition (chrome
  works, viewport area is blank). Production fallback to legacy
  arch-A on full failure is Stage 6/7's territory; Stage 4's
  failure mode is "chrome works, no engine pixels visible."
- **Engine `Reset` interaction with shared-handle re-creation.** L-007's
  pattern (OnLost/OnReset wiring) is for D3DPOOL_DEFAULT resources
  the engine itself owns. The shared texture is owned by
  AlphaCompositor (D3DPOOL_DEFAULT) and its lifecycle is via
  AlphaCompositor::Resize/ReleaseGpuResources — already wired into
  HostWindow's WM_SIZE path. Stage 4 piggybacks on that lifecycle
  (lazy per-frame handle check); does NOT add new D3D9 device-loss
  recovery wiring. If `Engine::Reset` invalidates the handle, lazy
  re-open picks it up on the next composite.

**Explicitly not happening:**

- **No production-default change.** `ALO_WEBVIEW2_HOSTING=composition`
  stays opt-in. Default new-UI path is byte-identical to today (no
  D3D11 device created, no engine visual attached).
- **No new env vars.** Composition mode is the master switch.
  Auto-attach engine visual when composition mode is on; there's no
  "composition without engine visual" production case (Stage 3's
  state is interim, not a supported config).
- **No engine-side rendering changes.** Engine renders to the same
  shared-handle RT as today; only the OUTPUT path changes (was: CPU
  readback → DIB → UpdateLayeredWindow on popup; now also: D3D11
  alias → CopyResource → DXGI Present → DComp visual).

---

## 2. What the codebase already gives us

| Surface | Where | Role for Stage 4 |
|---|---|---|
| `Engine::GetSharedTextureHandle()` | [src/engine.cpp:1347](../src/engine.cpp:1347) | Returns the NT-handle alias for the engine's render-target texture. Stage 2 already shipped this. Stage 4's `AttachEngineVisual` consumes it. |
| `AlphaCompositor::GetSharedHandle()` | [src/host/AlphaCompositor.cpp:201](../src/host/AlphaCompositor.cpp:201) | Underlying handle source. Engine::GetSharedTextureHandle forwards to this. |
| `AlphaCompositor::Resize` | [src/host/AlphaCompositor.cpp:131-150](../src/host/AlphaCompositor.cpp:131) | Releases old shared texture + creates new one each call. New handle each time. Stage 4's lazy per-frame handle check picks up the change. |
| `host::Compositor` class | [src/host/Compositor.h](../src/host/Compositor.h) + [.cpp](../src/host/Compositor.cpp) | pImpl design + L-016 isolation already set up. Adding D3D11/DXGI ComPtrs to `Impl` and new public methods to the header is the entire Stage 4 surface for this class. |
| `Compositor::AttachWebView2` | [src/host/Compositor.cpp:158](../src/host/Compositor.cpp:158) | Reference shape for `AttachEngineVisual`: build the visual, AddVisual to root, set the content (here: SetContent(swapchain) instead of put_RootVisualTarget), Commit. |
| Spike's `InitD3D11AndSwapchain` | [src/host/spike/dxgi_spike.cpp:305-405](../src/host/spike/dxgi_spike.cpp:305) | Line-by-line reference. Production differs in: error logging (LogFn instead of LogDbg), ComPtr lifetime (pImpl members instead of globals), failure recovery (return HRESULT vs abort). Otherwise identical. |
| Spike's `BuildVisualTree` engine block | [src/host/spike/dxgi_spike.cpp:460-477](../src/host/spike/dxgi_spike.cpp:460) | Engine-visual creation + `engineVisual->SetContent(swapchain)` + `AddVisual(engine, TRUE, nullptr)` (insertAbove=TRUE+NULL = behind all per L-016/spike-line-488 inversion). |
| Spike's `RenderD3D9Frame` + `CompositeD3D11Frame` | [src/host/spike/dxgi_spike.cpp:665-708](../src/host/spike/dxgi_spike.cpp:665) | Per-frame sequence: engine draws into shared surface → D3D9 event query Issue(END) + spin GetData → D3D11 CopyResource(back, alias) → swapChain->Present1. Production split: engine half stays in Engine::Render (where the D3D9 device is); D3D11 half is `Compositor::CompositeEngineFrame`. |
| HostWindow's `RenderD3D9` path | grep `m_framePublisher->OnFrameComposited` in [HostWindow.cpp](../src/host/HostWindow.cpp) | The per-frame seam where the new `m_compositor->CompositeEngineFrame()` call lands. Today the path is: engine->Render() → engine present-equivalent (D3D9 doesn't Present to anything when render target is the shared texture) → FramePublisher encodes JPEG → AlphaCompositor stamps + UpdateLayeredWindow. Stage 4 adds: → Compositor::CompositeEngineFrame (under composition mode). |
| `OnCompositionControllerReady` | [src/host/HostWindow.cpp:1090](../src/host/HostWindow.cpp:1090) | Stage 3's wire-up site (line shifted from 1029 → 1090 post-F8 + host-polish bundle). After `m_compositor->AttachWebView2(ctl)` succeeds at ~line 1203, Stage 4 adds the `AttachEngineVisual` call. Engine + AlphaCompositor are already up by the time this callback fires (constructed synchronously in WM_CREATE before InitWebView2's async chain). |
| WM_DESTROY teardown order | [src/host/HostWindow.cpp:1690-1730](../src/host/HostWindow.cpp:1690) | Already correctly drops `webMessageTok` (G5 cleanup) → `webController->Close()` → `m_compositionController` → `m_compositor` (reset at line 1724) → framePublisher → inputDispatcher → alphaCompositor → engine. Stage 4 needs NO additional teardown wiring — Compositor's dtor releases the engine visual + swapchain + D3D11 alias + D3D11 device via Impl's ComPtr destruction order. AlphaCompositor still owns the underlying shared D3D9 texture and releases it last. |
| F8 `WM_APP_COMPOSITION_FALLBACK` | [src/host/HostWindow.cpp:1526](../src/host/HostWindow.cpp:1526) (handler) + 1100/1118/1127 (PostMessage sites) | Stage 3h-equivalent fallback that tears down composition state and re-dispatches via HWND mode when the controller-creation chain fails async. Stage 4 adds a NEW failure surface (`AttachEngineVisual`) that DOES NOT use this mechanism — see §3.8 for the two-level failure design. |
| L-016 per-file include override | [src/ParticleEditor.vcxproj](../src/ParticleEditor.vcxproj) Compositor.cpp entry | Already in place. Stage 4 adds no new TU; the existing override already excludes DXSDK June 2010 from Compositor.cpp's include path, so `<d3d11.h>`, `<dxgi1_2.h>`, etc. resolve to Win10 SDK. |
| `shared_texture_test.exe` | [src/host/spike/shared_texture_test.cpp](../src/host/spike/shared_texture_test.cpp) | Stage 2's bit-exact validator (PASS on user's RTX 3080). Stays valid Stage-4-relevant regression: if engine pixels show garbage under composition, run this exe first to confirm the D3D9 → D3D11 path itself still works in isolation. |
| Playwright native-CDP harness | [run-native-tests.mjs](../web/apps/editor/scripts/run-native-tests.mjs) | Stage 3g's `composition-hosting.spec.ts` pattern (skip when env-var absent, registered next to alpha-compositor specs) is the template for the four new dxgi-* specs. |

---

## 3. Architecture / implementation approach

### 3.1 Compositor.h surface additions

Three new public methods on the existing `host::Compositor` class:

```cpp
// In Compositor.h, alongside AttachWebView2 / SetSize / Commit:

// Stage 4. Stand up the D3D11 device + DXGI factory, open the
// engine's shared texture as a D3D11 alias, create a composition
// swapchain, build the engine IDCompositionVisual, insert it BEFORE
// the WebView2 visual (children-list order = z-order; first added =
// behind), and SetContent(swapchain). Idempotent; second call with
// unchanged (handle, w, h) is no-op. Different handle triggers
// re-open via lazy detection on the next CompositeEngineFrame.
//
// engineDeviceWindow: the engine's D3D9Ex device window (the popup
// HWND). Captured for the cross-device sync's D3D9 event query
// owner. Pass engine->GetViewportHwnd() or similar.
//
// engineDevice: optional ID3D9Device9Ex* (passed as void* to keep
// d3d9.h out of Compositor.h). The Compositor uses this to create
// the sync event query. nullptr → spin-loop sync disabled (rely on
// DWM vsync; may tear). See §3.3.
//
// Returns S_OK on success. On failure (D3D11 device create, shared-
// resource open, swapchain create), engine visual is NOT attached
// — caller can continue with chrome-only rendering.
HRESULT AttachEngineVisual(HANDLE sharedTexture,
                          int    w,
                          int    h,
                          void*  d3d9DeviceForSync = nullptr) noexcept;

// Per-frame composite step. Called from HostWindow's RenderD3D9
// path AFTER engine->Render() under composition mode. Sequence:
//   1. Issue + spin on the D3D9 sync query (if AttachEngineVisual
//      got a device).
//   2. Check engine->GetSharedTextureHandle() against cached handle;
//      re-open D3D11 alias if changed (handles AlphaCompositor::Resize
//      invalidation).
//   3. D3D11 immediate context: CopyResource(backBuffer, alias).
//   4. swapChain->Present1(0, 0, &emptyParams).
//
// Returns S_OK on success. No-op + S_FALSE return if no engine
// visual is attached.
HRESULT CompositeEngineFrame() noexcept;

// Update the engine swapchain's known handle to current. Called
// implicitly by CompositeEngineFrame's lazy check, but exposed for
// explicit invalidation (e.g. on WM_SIZE if eager re-open is
// preferred over lazy detection later). Returns S_OK / S_FALSE
// (no-op if handle unchanged).
HRESULT RefreshEngineSharedHandle(HANDLE sharedTexture,
                                   int    w,
                                   int    h) noexcept;
```

The `Impl` struct gains:

```cpp
// Inside Compositor::Impl in Compositor.cpp:
Microsoft::WRL::ComPtr<ID3D11Device>          d3d11Device;
Microsoft::WRL::ComPtr<ID3D11DeviceContext>   d3d11Context;
Microsoft::WRL::ComPtr<IDXGIFactory2>         dxgiFactory;
Microsoft::WRL::ComPtr<IDXGISwapChain1>       engineSwapChain;
Microsoft::WRL::ComPtr<ID3D11Texture2D>       engineBackBuffer;
Microsoft::WRL::ComPtr<ID3D11Texture2D>       sharedTexD3D11;
Microsoft::WRL::ComPtr<IDCompositionVisual>   engineVisual;

// D3D9 sync query — held via void* in the header design above to
// keep d3d9.h out of Compositor.h. The Impl uses the real type.
Microsoft::WRL::ComPtr<IDirect3DQuery9>       d3d9SyncQuery;
Microsoft::WRL::ComPtr<IDirect3DDevice9Ex>    d3d9DeviceForSync;  // weak-ish: engine owns lifetime

HANDLE engineHandleCached = nullptr;
int    engineWidthCached  = 0;
int    engineHeightCached = 0;
bool   engineVisualAttached = false;
```

`Compositor.cpp` already includes `<d3d11.h>` and `<dxgi1_2.h>`
transitively via `<dcomp.h>`. Adding direct `#include <d3d9.h>` to
Compositor.cpp is the only new include needed — and the L-016 override
makes that resolve to the legacy DXSDK D3D9 header (which is fine —
d3d9.h is the same across DXSDK and Win10 SDK for our usage; the
shadowing problem L-016 documented is specifically the post-D3D9
headers).

**Risk on the d3d9.h include path.** The L-016 override REPLACES the
project's include dirs with Win10-SDK-only paths. The Win10 SDK no
longer ships d3d9.h (it lives in DXSDK June 2010 only on this system).
So including `<d3d9.h>` in Compositor.cpp under the L-016 override
will fail. **Mitigation:** add `$(DXSDK_DIR)Include` back to
Compositor.cpp's per-file `<AdditionalIncludeDirectories>` ONLY for
d3d9.h, AFTER the Win10 SDK paths so dxgi.h etc. still resolve to the
modern versions. Path-search order matters here; verify in 4a.

Alternative: pass the sync query in as an opaque `void*` already
created by the engine, and don't include d3d9.h in Compositor.cpp at
all. Engine exposes `Engine::CreateAndIssueEndFrameQuery(void** out)`
and `Engine::WaitEndFrameQuery(void* q)`. Cleaner separation; one more
indirection. **Recommend:** start with engine-owned sync query
(opaque pointer through Compositor) — keeps the L-016 override clean.

### 3.2 Per-frame composite seam in HostWindow

Today's RenderD3D9 sketch (composition-mode-relevant part):

```cpp
// HostWindowImpl::RenderD3D9 (pseudo):
if (engine) engine->Render();
if (m_framePublisher) m_framePublisher->OnFrameComposited();
if (alphaCompositor)  alphaCompositor->Composite();  // existing arch-A path
```

Stage 4 adds:

```cpp
if (engine) engine->Render();
if (m_compositionMode && m_compositor && m_compositor->IsReady())
{
    // Engine visual auto-attached in OnCompositionControllerReady;
    // CompositeEngineFrame is a per-frame no-op if attach failed.
    m_compositor->CompositeEngineFrame();
}
if (m_framePublisher) m_framePublisher->OnFrameComposited();
if (alphaCompositor)  alphaCompositor->Composite();
```

Note: AlphaCompositor::Composite keeps running. The popup is hidden
(via existing m_archCMode/composition-mode logic), so its
UpdateLayeredWindow output is unobserved. Wasted work; Stage 7 removes.

### 3.3 Cross-device GPU sync

The spike's pattern ([dxgi_spike.cpp:687](../src/host/spike/dxgi_spike.cpp:687)):

```cpp
g_d3d9SyncQuery->Issue(D3DISSUE_END);
BOOL done = FALSE;
while (g_d3d9SyncQuery->GetData(&done, sizeof(done), D3DGETDATA_FLUSH) == S_FALSE) {
    if (++spins > 100000) break;
}
```

Issued AFTER the engine's D3D9 draws, BEFORE the D3D11 CopyResource.
Guarantees the GPU has finished D3D9 work so the D3D11 alias reads
committed VRAM.

**Where this lives in production.** Options:

(a) Inside `Engine::Render()` itself. Engine owns the D3D9 device,
already does Issue+Spin internally, exposes nothing to the host. Pros:
encapsulates the GPU sync close to where the engine knows it's done
drawing. Cons: adds a spin to every Render() call, even when no
compositor is attached (wasted CPU on the canvas-jpeg / arch-A paths).

(b) Engine exposes `void IssueEndFrameQuery()` + `void WaitEndFrameQuery()`
(or one combined call). Host calls them only under composition mode,
between `engine->Render()` and `m_compositor->CompositeEngineFrame()`.
Pros: zero overhead on non-composition paths. Cons: more wiring.

(c) Compositor owns the query (created via the void* d3d9 device
passed at AttachEngineVisual). Compositor::CompositeEngineFrame issues
+ spins before its D3D11 work. Pros: query lives next to its consumer.
Cons: requires Compositor to include d3d9.h (see §3.1 path-order risk).

**Recommendation:** (b) — engine exposes thin Issue/Wait helpers;
host calls them under composition mode. Clean separation, no
non-composition overhead, no d3d9.h needed in Compositor.cpp. Engine
already has `IDirect3DQuery9` member room (Stage 1's D3D9Ex device
construction is the natural location). ~10 lines in engine.cpp.

### 3.4 Z-order — engine visual BEHIND WebView2

`OnCompositionControllerReady` order today:

```
AttachWebView2(ctl)  // builds tree: root → webview visual
```

The Stage 3 Compositor builds the tree with WebView2 as the SOLE child
of root. To put engine BEHIND WebView2, two paths:

(i) Re-stack via `RemoveVisual(webview) → AddVisual(engine, ...) →
AddVisual(webview, ...)`. Restores list-order behaviour exactly per the
spike (engine first, webview last → webview on top).

(ii) Use `AddVisual(engine, TRUE, nullptr)` — per L-016 / spike-line-488,
`insertAbove=TRUE + referenceVisual=NULL` means "behind ALL siblings,"
which puts engine behind webview without touching webview. Counter-
intuitive MSDN naming but bisected-validated.

**Recommendation:** (ii) — minimal-surface fix, doesn't disturb the
already-Committed WebView2 visual. Spike's `BuildVisualTree` did engine
first because it was building greenfield; production builds incrementally
and (ii) matches the constraint.

### 3.5 Resize handling — lazy handle re-open

`AlphaCompositor::Resize` invalidates the shared HANDLE every call
(line 144: `CreateTexture` with new pSharedHandle out-param). HostWindow's
WM_SIZE flow triggers AlphaCompositor::Resize via existing code paths
(LayoutBroker / engine reset).

Stage 4's `CompositeEngineFrame` does, before the CopyResource:

```cpp
HANDLE current = m_engine_get_handle_callback();  // wired in AttachEngineVisual
if (current != m_impl->engineHandleCached) {
    // Re-open. Drop old D3D11 alias texture. OpenSharedResource on the
    // new handle. If size changed, ResizeBuffers on the swapchain and
    // re-acquire the back-buffer. Update engineVisual->SetContent if
    // the swapchain was recreated (ResizeBuffers preserves the
    // swapchain identity; recreate only when format changes).
    RefreshEngineSharedHandle(current, newW, newH);
}
```

Production handle callback: a `std::function<HANDLE()>` stashed at
AttachEngineVisual time, or a raw `Engine*` pointer to call
`GetSharedTextureHandle()` on. Recommend `std::function` — keeps
Compositor's dependency on Engine purely behavioral.

**Resize size mismatch.** The engine's shared texture is at popup-
client size (the AlphaCompositor's last Resize argument). The
compositor's swapchain is at the size passed to AttachEngineVisual.
If they differ, D3D11 CopyResource fails (or partial-copies, depending
on driver). Mitigation: AttachEngineVisual stashes the current
(handle, w, h) tuple; CompositeEngineFrame's lazy check looks at all
three. Any mismatch → drop alias, swapchain ResizeBuffers if needed,
re-open. The swapchain's DXGI_SCALING_STRETCH (matching spike line
386) means a same-aspect mismatch is visually OK; size mismatch is
strict.

Simpler alternative: subscribe to AlphaCompositor's resize via the
existing layout callback chain, push the new (handle, w, h) to
Compositor explicitly. Less per-frame work, more wiring. **Recommend
lazy per-frame** for Stage 4 — minimal code, naturally handles any
invalidation source, 1 pointer compare + 2 int compares per frame is
free.

### 3.6 Teardown — no new wiring required

WM_DESTROY today (HostWindow.cpp:1690-1730 post-G5) drops `m_compositor` AFTER
webMessageTok cleanup / webController->Close() / cursor handler / m_compositionController,
BEFORE framePublisher → inputDispatcher → alphaCompositor → engine.

Stage 4's additions to `Compositor::Impl` (D3D11 device, swapchain,
visual, shared-resource alias) destruct via the Impl's ComPtr
destruction order when `m_compositor.reset()` runs:

```
m_compositor.reset()
  ~Impl()
    engineVisual.Reset()          // releases swapchain SetContent ref
    sharedTexD3D11.Reset()        // D3D11 alias → underlying D3D9 VRAM still owned by AlphaCompositor
    engineBackBuffer.Reset()
    engineSwapChain.Reset()
    dxgiFactory.Reset()
    d3d11Context.Reset()
    d3d11Device.Reset()
    d3d9SyncQuery.Reset()         // D3D9 query — engine still alive
    d3d9DeviceForSync.Reset()     // ComPtr; engine owns the real lifetime
    // (existing) webviewVisual, rootVisual, target, device.Reset()
```

Then framePublisher / inputDispatcher / alphaCompositor / engine
tear down. AlphaCompositor.reset() releases the underlying D3D9
shared texture (line 124); by then no D3D11 alias references it.
engine.reset() tears down the D3D9Ex device. Order is correct.

**Verify in 4b:** D3D11 debug-layer warnings on shutdown must be
zero. The spike's debug-layer flag (line 308) catches any straggling
references.

### 3.7 Diagnostic logging

Following Stage 3's `[COMP-...]` convention, Stage 4 tags:

- `[COMP-engine-init]` D3D11 device + DXGI factory creation
- `[COMP-engine-open]` OpenSharedResource with handle + tex size
- `[COMP-engine-swap]` CreateSwapChainForComposition
- `[COMP-engine-attach]` engine visual added to tree
- `[COMP-engine-frame]` per-frame composite (1 Hz throttled, like
  Stage 3's [COMP-input])
- `[COMP-engine-resize]` handle / size invalidation + re-open
- `[COMP-engine-fail]` any failure HRESULT — un-throttled

Removed pre-ship per CLAUDE.md debug-instrumentation lifecycle (Stage 7).
1 Hz throttle on per-frame line keeps the log readable.

### 3.8 Interaction with F8's `WM_APP_COMPOSITION_FALLBACK`

Stage 3h (shipped as `f0a8695` in the post-audit autonomous queue)
added a fallback path that tears down composition state and
re-dispatches via HWND mode when async controller-creation fails.
The mechanism is a `WM_APP_COMPOSITION_FALLBACK = WM_APP + 1` custom
message, posted from three sites inside `OnCompositionControllerReady`
when the chain breaks (controller completion, base-controller QI,
FinishWebView2ControllerSetup). The handler at
[HostWindow.cpp:1526](../src/host/HostWindow.cpp:1526) tears down
`webController` / `m_compositionController` / `m_compositor` /
`m_compositionMode` and re-dispatches via the stashed `webEnv`
through `DispatchHwndModeController`.

**Stage 4 introduces a fourth failure surface — `AttachEngineVisual`
— but explicitly does NOT chain into this F8 mechanism.** Two-level
failure design:

| Failure class | Where | Action | User-visible outcome |
|---|---|---|---|
| **Chrome itself broken.** Controller-creation chain fails async. | HostWindow.cpp:1100 / 1118 / 1127 (F8 sites) | `PostMessage(WM_APP_COMPOSITION_FALLBACK)` → F8 handler tears down + re-dispatches HWND mode | Chrome works in HWND mode; no engine visual; full Phase 2 / arch-A behaviour. |
| **AttachWebView2 fails** (Stage 3 case). | OnCompositionControllerReady, ~line 1206 | Existing inline path: log + return; chrome stays in composition mode but tree never commits | (Recovered to F8 path by line-1127 PostMessage at FinishWebView2ControllerSetup failure.) |
| **`AttachEngineVisual` fails** (Stage 4 new case). LUID mismatch, D3D11 device create fail, OpenSharedResource fail, swapchain create fail. | OnCompositionControllerReady, after Stage 4 wires the AttachEngineVisual call | Log `[COMP-engine-fail]` + skip-engine-attach. Composition mode + WebView2 chrome stay intact; engine visual just isn't in the tree. | Chrome works in **composition** mode; viewport quadrant is empty (no engine pixels). User sees mostly-working editor; a runtime warning surfaces the GPU mismatch. |

**Rationale for NOT chaining into F8.** F8's fallback is for "chrome
itself unusable" — the React UI can't load, the controller can't be
queried. When `AttachEngineVisual` fails, chrome is fine; only the
GPU bridge to the engine's pixels is broken. Demoting the user from
composition-mode-WebView2 to HWND-mode-WebView2 would lose all of
Stage 3's chrome composition wins (no cutout artifact in dropdowns,
correct DComp-tree z-order, etc.) for no benefit — the engine
pixels still wouldn't appear.

The runtime warning at attach-failure time (e.g. LUID mismatch
diagnostic per risk #1) tells the user "your GPU configuration
doesn't support the DXGI bridge; viewport will be empty." A future
Stage 6/7 dispatch could add a full arch-A fallback at this point
(unhide popup, re-enable AlphaCompositor's UpdateLayeredWindow
consumer), but that's out of scope for Stage 4.

**Code shape.** Inside `OnCompositionControllerReady` after
`AttachWebView2`:

```cpp
if (m_compositor)
{
    HRESULT bhr = m_compositor->AttachWebView2(ctl);
    if (FAILED(bhr)) { /* existing Stage 3 path */ return bhr; }

    // Stage 4 addition — no PostMessage(WM_APP_COMPOSITION_FALLBACK)
    // on failure; skip-engine-attach is the design.
    HRESULT ehr = m_compositor->AttachEngineVisual(
        engine->GetSharedTextureHandle(), w, h, engine->GetDeviceForSync());
    if (FAILED(ehr))
    {
        Log("[COMP-engine-fail] AttachEngineVisual hr=0x%08lx — composition mode "
            "continues without engine visual (viewport area will be empty)\n", ehr);
        // No PostMessage. No state teardown. Chrome continues in composition mode.
    }
}
```

---

## 4. Sub-stage decomposition

| Sub | Deliverable | Effort | Reversibility | User OK gate? |
|---|---|---|---|---|
| **4a** | Compositor.h public-method declarations (`AttachEngineVisual`, `CompositeEngineFrame`, `RefreshEngineSharedHandle`) + Compositor.cpp stubs returning S_OK / S_FALSE without doing anything. Engine.h/.cpp adds `IssueEndFrameQuery` + `WaitEndFrameQuery` thin helpers (opaque IDirect3DQuery9 via void*). MSBuild clean. Vitest / tsc / native 99/99 unchanged. No env-var path consumes the new methods. | 0.5 day | trivial single-commit revert | No (additive) |
| **4b** | Compositor::AttachEngineVisual real implementation — D3D11 device + DXGI factory + OpenSharedResource + composition swapchain + engine visual + insertAbove=TRUE+null AddVisual. Called from OnCompositionControllerReady after AttachWebView2. **No per-frame composite yet** (CompositeEngineFrame stays a stub). Smoke launch composition mode: log shows `[COMP-engine-attach] engine visual attached`, screenshot still has React chrome but viewport quadrant remains empty (no Present yet). **HARD GATE — first place D3D11/DXGI/DComp interactions can fail in production context.** | 1 day | one revert commit | **Yes** (load-bearing — equivalent to Stage 3's 3b for the GPU pipeline) |
| **4c** | Compositor::CompositeEngineFrame real implementation — D3D9 sync (via engine's Issue/Wait) → D3D11 CopyResource → Present1. HostWindow's RenderD3D9 path calls it under composition mode. **Adds `[COMP-engine-handle-hash]` diagnostic** logging a hash of the shared texture's first few bytes after each successful CopyResource (1 Hz throttled) — defensive against the spike's [dxgi_spike.cpp:355-357](../src/host/spike/dxgi_spike.cpp:355) warning that OpenSharedResource on a wrong handle silently returns a different texture. If 4c smoke shows chrome but no engine pixels, the hash distinguishes "CopyResource ran on wrong texture" from "CopyResource ran on right texture but Present didn't make it to screen." Smoke: launch, see engine pixels in viewport area. This is the headline "Stage 4 ships" moment. Visual confirmation screenshot committed to `tasks/stage-4c-smoke-screenshot.png`. | 1 day | one revert commit | Yes (after smoke confirms engine pixels) |
| **4d** | Lazy handle / size invalidation in CompositeEngineFrame — RefreshEngineSharedHandle real impl. 50-resize stress smoke (Playwright will formalize in 4f; manual smoke at 4d via drag-resize). No crashes, no log errors, engine pixels stay visible across resizes. | 0.5 day | one revert commit | No (smoke-only) |
| **4e** | Engine swapchain initial-frame guard — clear back buffer to (0,0,0,0) in AttachEngineVisual via D3D11 ClearRenderTargetView so the first Present doesn't show uninitialized VRAM. Defence-in-depth fix; visible-flicker safety. | 0.25 day | additive | No |
| **4f** | New Playwright specs per parent §6: `tests/dxgi-transport.spec.ts` (boot composition, assert `[COMP-engine-attach]`, screenshot non-uniform pixel histogram), `tests/dxgi-vs-jpeg.spec.ts` (canvas-jpeg vs composition pixel-diff via SSIM > 0.95), `tests/dxgi-perf.spec.ts` (FPS > 80 at 1080p + > 60 at 3440×1440), resize stress as the fourth spec (50 programmatic resizes, no crash, FPS recovers). Registered in `run-native-tests.mjs`. Run all under composition env-var pair. | 1 day | additive | **Yes** (Stage 4 → Stage 5 gate; per parent §6 acceptance) |

**Total: 4.25 days budget; 3-4 day stretch matches parent estimate.**
Add 0.5d buffer for D3D11 debug-layer chases or pixel-histogram
threshold tuning.

---

## 5. Risks named up front + mitigations

**Iteration target.** Stage 4 is ★★★★; per CLAUDE.md "★★★★+ iterates
the risks list with the user before writing code." Surface this section
verbatim to the user before sub-stage 4a starts.

1. **D3D11 adapter LUID mismatch on multi-GPU systems.** Engine's
   D3D9Ex device picks an adapter at construction; the D3D11 device
   in Compositor picks `D3D_DRIVER_TYPE_HARDWARE` which on hybrid
   laptops may select a different adapter. Shared-handle open across
   adapters fails (or returns a different texture silently).
   *Mitigation:* log both adapters' LUIDs (engine side via
   IDirect3DDevice9Ex::GetCreationParameters → AdapterOrdinal lookup;
   D3D11 side via IDXGIDevice → GetAdapter → GetDesc). On mismatch:
   log a warning, do NOT attach engine visual; chrome works, viewport
   stays empty. User on multi-GPU sees half-functional editor but no
   crash. Production fallback to legacy arch-A is parent plan's
   Stage 6/7 territory. The user's RTX 3080 is single-GPU; risk
   detection is real-world-low but worth instrumenting.

2. **Shared-handle invalidation race on AlphaCompositor::Resize.**
   The window from "old handle released" → "new handle assigned" is
   a few microseconds, but if a CompositeEngineFrame happens in
   between (it shouldn't — Resize is synchronous on the host
   message-pump thread), D3D11 OpenSharedResource on the freed
   handle returns garbage. *Mitigation:* lazy per-frame handle
   check; on null-or-mismatch, drop the alias + try again next
   frame. Worst case: one stale or skipped frame per resize. Visually
   acceptable.

3. **Cross-device sync correctness — D3D9 query OR no sync.** The
   spike spins on a D3D9 event query. Production without the spin
   means the D3D11 CopyResource may read VRAM the D3D9 driver
   hasn't finished writing. Symptom: visible tearing, half-frame
   updates, or one-frame-stale appearance. *Mitigation:* ship WITH
   the spike's spin-loop (path (b) in §3.3 — Engine::Issue/Wait
   exposed). If profiling shows the spin dominates frame time
   (unlikely — spike measured 0.30 ms total at 3440×1440), swap to
   ID3D11Fence in a follow-up. Don't ship without sync.

4. **D3D11 debug layer not installed.** Same fallback the spike
   uses (line 322 of [dxgi_spike.cpp](../src/host/spike/dxgi_spike.cpp:322))
   — try with DEBUG flag, fall back to without. Logged as a one-line
   warning. No production impact.

5. **GPU memory pressure under composition.** At 3440×1440 the
   shared-handle texture (~19 MB) + DXGI swapchain back buffer
   (2× buffered = ~38 MB) + AlphaCompositor's sysmem readback
   surface (~19 MB system RAM) all coexist. Total VRAM cost
   roughly doubled vs arch-A alone. Acceptable on modern hardware
   (RTX 3080 has 10 GB); flagged for the eventual Stage 7 cleanup
   that removes AlphaCompositor's redundant readback.

6. **Engine visual z-order inversion.** Per §3.4, using
   `AddVisual(engine, TRUE, nullptr)` to insert engine BEHIND
   existing webview visual relies on the spike-bisected MSDN-naming
   inversion (`insertAbove=TRUE + NULL ref` = "behind all,"
   counterintuitively). If MSDN semantics change in a future
   Windows update, engine visual could end up in front of WebView2
   chrome — visible as engine pixels painting over the React UI.
   *Mitigation:* Stage 4b's smoke explicitly verifies chrome
   visible on top of engine pixels. If z-order ever inverts, swap
   to the explicit Remove + re-Add path (§3.4 option i) which has
   no MSDN-naming ambiguity. Document the choice in code comment.

7. **First-frame black flash on attach.** The DXGI swapchain's back
   buffer is uninitialized at creation. The first Present after
   AttachEngineVisual but before the first CopyResource will show
   garbage/black VRAM. *Mitigation:* clear the back buffer to
   transparent (0,0,0,0) in AttachEngineVisual via D3D11
   ClearRenderTargetView immediately after creating the swapchain
   + acquiring the back buffer. Sub-stage 4e covers this explicitly.

8. **Compositor's per-frame work serializes with engine's render.**
   The D3D9 sync spin in §3.3 blocks the host thread until D3D9
   finishes its frame. If engine work is slow (heavy particle
   counts), the spin grows. *Mitigation:* the spin has a 100k-iteration
   cap (matching spike line 693) → break + log + continue. Worst
   case: one frame's CopyResource reads partially-finished VRAM
   (tearing). Visually acceptable as a degraded mode.

9. **`AlphaCompositor::Composite` keeps running and races for the
   D3D9 device.** The hidden popup's UpdateLayeredWindow path also
   does GetRenderTargetData → memcpy → ULW. Now happens concurrently
   with the new D3D11 CopyResource. D3D9 GetRenderTargetData
   semantics: it blocks on its own readback, doesn't serialize
   subsequent D3D9 work. So engine→AlphaCompositor and engine→Compositor
   both observe the same shared texture, neither blocks the other's
   subsequent work. Spike validated this exact dual-output pattern
   ([dxgi_spike.cpp:665-708](../src/host/spike/dxgi_spike.cpp:665)).
   *Mitigation:* trust the spike's validation; visual A/B test at
   4c confirms no race-visible artifacts.

10. **HostWindow's `m_compositor->IsReady()` gate is the only
    safety net before per-frame work.** If something destroys the
    Compositor's D3D11 device between IsReady() and CompositeEngineFrame
    (impossible on single-threaded message-pump), we crash.
    *Mitigation:* per-frame work is on the same message-pump thread
    as construction + destruction. No race. CompositeEngineFrame's
    own null-checks (d3d11Context, engineSwapChain, sharedTexD3D11)
    are belt-and-suspenders.

11. **4b smoke shows chrome works but engine area stays empty even
    after CompositeEngineFrame ships (4c).** Possible root causes:
    swapchain Present succeeds but visual isn't being composited
    (z-order wrong → webview opaque covers it), CopyResource silently
    fails (no log without debug layer), shared-handle re-open
    silently returns a different texture (per [dxgi_spike.cpp:355-357](../src/host/spike/dxgi_spike.cpp:355)
    warning about passing wrong handle). *Mitigation:* Stage 4 ships
    D3D11 debug layer in Debug builds; any silent CopyResource
    failure logs to OutputDebugString. Bisect via the standalone
    `shared_texture_test.exe` (still passes on user's rig) — if the
    test exe passes but production doesn't, the difference is
    Compositor's tree topology, not the GPU plumbing.

12. **Scope creep into Stage 5 (scene-rect transform on engine
    visual).** Tempting to add the LayoutBroker → engine-visual
    transform under "while we're here." *Mitigation:* explicit §1
    "Out of scope" includes the scene-rect transform. Stage 4 ships
    with engine visual at (0,0,W,H) full host client. Visual
    appearance shows engine pixels filling the whole window behind
    chrome — that IS the acceptable Stage 4 state per parent §4.

13. **L-007 echo — engine D3DPOOL_DEFAULT resource lifecycle.** The
    shared texture is owned by AlphaCompositor with proper
    Resize/Release wiring (already shipped Stage 2). Stage 4 adds
    no D3DPOOL_DEFAULT engine-side resources. The D3D11 alias is
    re-opened on handle change (lazy per-frame). So L-007 doesn't
    grow a new "watch this resource on Reset" item.

14. **Cross-session worktree state — local `lt-4` ref is stale.**
    Per HANDOFF, the local `lt-4` branch in this worktree is at
    `35c19c8` while origin/lt-4 is at `b4d981a`. Lineage check at
    session start confirmed `origin/lt-4..HEAD = 0` and
    `HEAD..origin/lt-4 = 0`, so HEAD == origin/lt-4 at b4d981a.
    *Mitigation:* end-of-session FF flow targets `origin/lt-4`
    directly via `git push` after `git switch lt-4 && git merge
    --ff-only`; the worktree's local `lt-4` ref doesn't gate
    anything.

---

## 6. Testing & verification (per CLAUDE.md verifiable-claims rule)

Automated gates dominate; manual reserved for visual confirmation.

### Pre-coding gate (all green BEFORE 4a)

- [ ] vitest 338/338 pass (was 335 pre-`d3f0fae`; the CI-allowlist guard added +3 tests)
- [ ] tsc -b 0 errors
- [ ] MSBuild Debug + Release x64 clean
- [ ] Playwright native HWND baseline 99/99 (composition specs
      skip cleanly)
- [ ] (Optional) Composition-mode native 106/107 with env-var pair
      set (1 self-skip on curve-editor-wheel when no emitter
      selected — known Stage 3 state)
- [ ] (Optional) shared_texture_test.exe PASS on RTX 3080
- [ ] (Optional) dxgi_spike.exe runs + shows live FPS at 1080p

### Sub-stage 4a (skeleton + Engine sync helpers) — additive

- [ ] MSBuild Debug + Release x64 clean
- [ ] vitest 338/338 / tsc / native 99/99 unchanged
- [ ] `Compositor::AttachEngineVisual` + `CompositeEngineFrame` +
      `RefreshEngineSharedHandle` declared in header, stubs in .cpp
      returning S_OK/S_FALSE
- [ ] `Engine::IssueEndFrameQuery` + `Engine::WaitEndFrameQuery`
      declared in engine.h, real D3D9Ex query implementation in
      engine.cpp
- [ ] No consumer wires the new APIs yet — verified by grep

### Sub-stage 4b (real AttachEngineVisual) — HARD GATE

- [ ] MSBuild + tsc + vitest unchanged
- [ ] **WITHOUT env var:** native 99/99 baseline preserved
- [ ] **WITH composition env-var pair:** smoke launch produces React
      chrome correctly (Stage 3b screenshot reproduces). Log shows:
      - [ ] `[COMP-engine-init] D3D11 device created`
      - [ ] `[COMP-engine-open] OpenSharedResource handle=... size=...`
      - [ ] `[COMP-engine-swap] composition swapchain created`
      - [ ] `[COMP-engine-attach] engine visual attached`
      - [ ] No `[COMP-engine-fail]` lines, no D3D11 debug-layer warnings
- [ ] Screenshot at `tasks/stage-4b-smoke-screenshot.png` — chrome
      identical to Stage 3b; viewport quadrant remains empty (no
      Present yet, expected)
- [ ] Adapter LUID match logged for engine D3D9Ex side and
      Compositor D3D11 side
- [ ] If LUID mismatch: log warning, skip attach, smoke still PASS
      (chrome works, viewport empty) — multi-GPU fallback documented

### Sub-stage 4c (real CompositeEngineFrame) — HEADLINE SHIP MOMENT

- [ ] MSBuild + tsc + vitest unchanged
- [ ] Composition smoke: engine pixels visible in viewport quadrant
      area
- [ ] Visual confirmation screenshot at `tasks/stage-4c-smoke-screenshot.png`
      — must show engine pixels distinguishable from Stage 3's "D3D9
      viewport" placeholder text (engine clear color filling the area
      at minimum; animated particles if anything is emitting)
- [ ] FPS counter in status bar shows live updates (engine + composite
      both ticking)
- [ ] No tearing / black flash on attach (4e covers this if observed)
- [ ] `[COMP-engine-frame]` log line appears at 1 Hz throttle
- [ ] Default HWND mode 99/99 still PASS

### Sub-stage 4d (resize robustness) — manual smoke

- [ ] Drag-resize the window 20+ times; engine pixels stay visible
- [ ] No `[COMP-engine-fail]` log entries
- [ ] FPS recovers to baseline after the drag settles
- [ ] `[COMP-engine-resize]` log line appears on each handle change

### Sub-stage 4e (first-frame clear)

- [ ] Launch composition build; no black/garbage flash between chrome
      appearing and first engine frame composited

### Sub-stage 4f (Playwright specs) — STAGE 4 → STAGE 5 GATE

Four new specs registered in `run-native-tests.mjs`:

- [ ] **`tests/dxgi-transport.spec.ts`** — boot composition mode,
      assert log contains `[COMP-engine-attach]` AND
      `[COMP-engine-frame]`, take a screenshot, assert non-uniform
      pixel histogram across the viewport quadrant region (proves
      engine pixels arrived, not just a clear color). Pass under
      composition env-var pair; auto-skip on plain HWND mode.
- [ ] **`tests/dxgi-vs-jpeg.spec.ts`** — capture same engine state
      under canvas-jpeg mode and composition mode; SSIM > 0.95 on
      the viewport-quadrant crop. Allows minor compositing
      differences (DXGI alpha mode vs JPEG quantization) but flags
      structural breaks. Same env-var skip pattern.
- [ ] **`tests/dxgi-perf.spec.ts`** — drive FPS for 10s at 1080p
      AND 3440×1440 under composition. Assert mean FPS > 80 at
      1080p, > 60 at 3440×1440. Generous gates — spike measured
      far higher; production overhead the headroom.
- [ ] **Resize stress** — 50 programmatic SetWindowPos calls
      between 1080p / 1440p / 3440×1440 / back to 1080p; assert no
      crash, no `[COMP-engine-fail]` log lines, FPS recovers to
      baseline within 2s of settling. Either a separate spec or a
      describe block in dxgi-transport.spec.ts.
- [ ] All four specs PASS under composition env-var pair
- [ ] All four specs auto-skip cleanly under plain HWND mode
- [ ] Composition-mode total: was 106/107 (Stage 3), now ~110-114
      depending on how spec counts shake out
- [ ] HWND-mode total unchanged at 99/99

### Final acceptance (Stage 4 → Stage 5 handover)

- [ ] All sub-stage acceptance checklists green
- [ ] Visual confirmation screenshot at `tasks/stage-4-final-screenshot.png`
      — chrome + engine pixels both visible, side-by-side comparison
      with Stage 3b's chrome-only screenshot
- [ ] HANDOFF.md refreshed with Stage 4 ship state, Stage 5 entry
      points (scene-rect transform on engine visual)
- [ ] CHANGELOG entry drafted (TODO-HASH placeholder per
      [`CHANGELOG.md`](../CHANGELOG.md) header convention)
- [ ] Sub-plan §4f acceptance signed off by user

### Cross-sub-stage debug instrumentation

`#ifndef NDEBUG` printfs tagged `[COMP-engine-*]` (per §3.7). 1 Hz
throttle on per-frame line. Removed pre-Stage-4 ship per CLAUDE.md
debug-instrumentation lifecycle. Specifically:

- `[COMP-engine-init]` D3D11 device creation
- `[COMP-engine-open]` OpenSharedResource HANDLE + size
- `[COMP-engine-swap]` CreateSwapChainForComposition success
- `[COMP-engine-attach]` engine visual added + SetContent + Commit
- `[COMP-engine-frame]` per-frame composite (1 Hz)
- `[COMP-engine-resize]` handle/size invalidation + re-open
- `[COMP-engine-fail]` any failure HRESULT (un-throttled)
- `[COMP-engine-luid]` adapter LUIDs at attach time

---

## 7. Open questions before code starts

1. **Cross-device sync placement — Engine-exposed helpers (path b)
   vs Compositor-owned query (path c).** Recommendation: path (b)
   per §3.3. Surface for OK at 4a-start.

2. **Engine swapchain back-buffer count + format.** Spike uses 2-buffer
   FLIP_SEQUENTIAL, BGRA8_UNORM, ALPHA_MODE_PREMULTIPLIED. Match
   exactly. Confirmed in §3 already, but if a smoke surfaces flicker
   we could try 3-buffer.

3. **Resize handling — lazy per-frame (recommended) vs explicit
   notification.** Per §3.5. Lazy is simpler; revisit only if a
   profile shows the per-frame compare is a non-trivial cost
   (extremely unlikely).

4. **D3D11 debug layer in Release builds?** Spike falls back; production
   Release should NOT request the debug flag at all (cleaner
   shutdown, no log noise). Stage 4 ships Debug-only debug layer.

5. **Engine visual position — full host client (0,0,W,H) vs partial.**
   Stage 4 ships full client per §1 Out-of-scope. Stage 5 adds the
   scene-rect transform.

6. **Sub-stage 4f spec count — four specs (recommended) vs one
   monolithic dxgi.spec.ts.** Four specs match parent plan §6
   structure and let CI surface specific failures distinctly.

---

## 8. Decisions for user before coding

These need OK before sub-stage 4a starts:

**D1. Sub-stage gate cadence.** 2 load-bearing check-ins (4b first
engine visual attached + 4f final acceptance). Other sub-stages
commit-only. Stage 3 used 5 gates; Stage 4's smaller risk surface
justifies fewer. *Surface for OK.*

**D2. Cross-device sync.** Path (b) — Engine exposes
IssueEndFrameQuery + WaitEndFrameQuery; host calls them under
composition mode only. Default to shipping WITH sync (matches spike).
*Surface for OK before 4a.*

**D3. Z-order — `AddVisual(engine, TRUE, nullptr)` (behind-all
inversion, single AddVisual) vs Remove+Re-add (explicit ordering).**
Recommend the single AddVisual per §3.4 / §5 risk #6. Smaller diff
to Stage 3's working tree. *Surface for OK before 4b.*

**D4. Resize handling — lazy per-frame check vs explicit notification.**
Recommend lazy per §3.5 / §5 risk #2. *Surface for OK before 4d.*

**D5. Sub-plan scope — 6 sub-stages (4a-4f) vs fewer-bigger.** Recommend
6 — matches Stage 3's small-commit-reversibility hedge. *Surface for
OK.*

**D6. Adapter LUID mismatch fallback — skip-engine-attach (recommended)
vs hard-fail launch (forces user to set env var unset).** Recommend
skip-attach: chrome works, viewport empty. Single-GPU systems
unaffected. *Surface for OK before 4b.*

**D7. `AttachEngineVisual` failure handling — skip-engine-attach
(recommended) vs chain into F8's `WM_APP_COMPOSITION_FALLBACK`.** Per
§3.8, Stage 4's recommended path is: on AttachEngineVisual failure
(LUID mismatch, D3D11 device, OpenSharedResource, swapchain create),
log `[COMP-engine-fail]` and leave composition mode intact with no
engine visual in the tree (chrome works, viewport area is empty).
Do NOT post `WM_APP_COMPOSITION_FALLBACK` — that mechanism is for
chrome-itself-broken failures (F8 paths A/B/C). The two-level design
preserves Stage 3's chrome composition wins (no cutout artifact in
dropdowns, DComp z-order) when only the engine-pixels bridge is
broken. *Surface for OK before 4b. This decision generalizes D6's
LUID-mismatch case to all AttachEngineVisual failure modes.*

---

## 9. Stage gate (per CLAUDE.md "Verification before done")

Stage 4 ships when:

- [ ] All sub-stage acceptance checklists green
- [ ] Final composition-mode screenshot shows engine pixels behind
      WebView2 chrome
- [ ] Default new-UI HWND path unchanged (99/99 native PASS,
      vitest 338/338, MSBuild clean)
- [ ] Perf gate met: > 80 FPS at 1080p AND > 60 FPS at 3440×1440
      under composition mode
- [ ] 50-resize stress without crash, log errors, or perf drift
- [ ] HANDOFF + CHANGELOG drafted + committed
- [ ] Stage 5 prep documented (scene-rect transform on engine visual
      is the seam — `Compositor::SetEngineVisualTransform(x,y,w,h)`
      method shape sketched in HANDOFF)

User explicit OK after sub-stage 4f = Stage 4 → Stage 5 handover.
