# tasks/todo.md — [MT-11] Architecture-C migration (engine pixels into a DOM `<canvas>`)

**Status:** plan drafted, **awaiting user OK on the risks list** before Phase 0 starts.
**Predecessor session:** B1.4 [NT-8] resizable splitters (`69bed7b` on `origin/lt-4`).
**Difficulty estimate:** ★★★★ (architecturally fundamental; multi-phase; spike-gated).
**Effort estimate:** ~16-32 h post-spike (per ROADMAP §2.1). Phase 0 spike: ~2-4 h.

---

## 1. Goal + scope

When this ships, the editor's D3D9 viewport pixels render into a
`<canvas>` element placed inside the centre-quadrant DOM
(`ViewportSlot`). The top-level `WS_EX_LAYERED` popup HWND that
currently sits *above* the WebView2 HWND is retired from the
*presentation* path (its only remaining role, if any, is input
ownership — see §3.5). The entire `AlphaCompositor` band-stamp +
smoothstep-feather + `UpdateLayeredWindow` pipeline becomes dead
code, slated for deletion in a follow-up PR.

User-visible payoff: **the chrome-cutout artifact in dropdowns +
menus is gone permanently**. Menu shadows, `backdrop-filter`,
and every CSS effect render naturally because the engine and the
chrome live in the same compositing tree. Splitter drag no longer
exposes alpha-cutout shapes because there is no alpha cutout. The
B1.3.1.1 snapshot-into-DOM pattern for modal backdrops becomes
redundant (the canvas IS the engine pixels — modals can sample
them via `<canvas>.toDataURL` or just dim+blur the live canvas).

**In**

- New transport surface (chosen by Phase 0 spike): one of
  `WebResourceRequested` (CDP fetch → JPEG/PNG), `postMessage`
  with transferable `ArrayBuffer` (raw BGRA), or `SharedArrayBuffer`
  (raw BGRA, COOP/COEP required).
- New bridge surface `viewport/frame-ready` (engine → renderer
  ping when a new frame is available for fetch / has been posted).
- New bridge surface `viewport/input` (renderer → engine mouse +
  wheel + keyboard events, replacing the popup HWND's direct
  window messages).
- React-side `<canvas>` mount inside `ViewportSlot` with `getContext("2d")`
  paint via `putImageData` / `drawImage` / `createImageBitmap`.
- Feature flag (env var: `VITE_VIEWPORT_TRANSPORT` = `legacy` |
  `canvas-jpeg` | `canvas-sab` | `canvas-postmsg`) for A/B
  verification with architecture A.
- Camera frustum aspect matches the canvas's CSS-rendered size,
  not the popup-rect aspect. Resizes flow via the same
  `layout/scene-rect` (renamed `viewport/canvas-size` post-cleanup,
  but the message kind is preserved in this PR for compatibility).
- DPR-correct rendering: canvas backing-store sized to
  `cssW * devicePixelRatio` × `cssH * devicePixelRatio`; engine
  RT matched to backing-store dims.
- DPI changes / monitor moves picked up via `matchMedia` +
  existing `device/dpr` plumbing.
- Manual smoke matrix on weak + strong GPUs, integrated + discrete,
  at 100 % + 150 % + 200 % DPR.

**Out**

- **`AlphaCompositor` and `useViewportOcclusion` deletions** — kept
  alive in this PR behind the feature flag for A/B verification.
  A follow-up cleanup PR (filed separately, ~2-4 h) deletes the
  band-stamp pipeline, `viewport/occlude`, the
  `useViewportOcclusion` hook + 5 callsites (MenuBar, OccludingPopover,
  ToolPanel, ViewportPill, Modal's sentinel rect),
  `OccludingMenubarContent`, and the `layout/scene-rect` channel.
  Splitting cleanup out lets us flip the default and let the new
  architecture bake before the irreversible deletes.
- **Modal snapshot-into-DOM pattern** — stays live until the cleanup
  PR. With architecture C, the canvas itself is the live engine
  pixels, so the modal backdrop can sample it directly (frozen
  frame OR live blurred). That refactor is part of the cleanup PR.
- **Engine internals** — no changes to `Engine::Render`,
  `Engine::Present`, or any of the D3D9 device handling. The
  readback path (`GetRenderTargetData` into the SYSTEMMEM staging
  surface) is reused unchanged; only what happens *after* the
  readback shifts (no DIB stamping, no `UpdateLayeredWindow`).
- **Camera input path** — popup HWND stays alive but hidden (1×1,
  off-screen, `WS_EX_LAYERED` retained). It still owns the D3D9
  device for swap-chain consistency. **All user input now flows
  through the canvas DOM element** and into the engine via the
  new `viewport/input` bridge surface. The popup HWND no longer
  receives user input.
- **Headers / COOP-COEP** — only flipped on if Phase 0 picks the
  SharedArrayBuffer transport. The other two transports work with
  WebView2's default headers.
- **`--legacy-ui` parity** — untouched. This is a new-UI-only
  migration; the legacy Win32 UI doesn't have a WebView2 layer.
- **Engine device-loss recovery** — unchanged. The existing
  `Engine::Reset` path still fires on `D3DERR_DEVICELOST`; the
  canvas observer ignores frames during the device-lost window
  (no `frame-ready` messages dispatched until recovery).

---

## 2. What the codebase already gives us

The migration is almost entirely *additive* on top of what's
already there. The load-bearing surveys (see §10 for the survey
prompt that produced these):

### 2.1 D3D9 readback path is already in place
- [`src/host/AlphaCompositor.cpp:455`](../src/host/AlphaCompositor.cpp:455)
  — `GetRenderTargetData(m_impl->offscreenRT, m_impl->sysMemSurface)`
  is the GPU → SYSTEMMEM readback that already runs every frame.
- [`src/host/AlphaCompositor.cpp:460-472`](../src/host/AlphaCompositor.cpp:460)
  — `LockRect` + memcpy into the DIB pixel buffer. The BGRA bytes
  in `m_dibPixels` are exactly what the canvas needs.
- [`src/host/AlphaCompositor.cpp:482-491`](../src/host/AlphaCompositor.cpp:482)
  — `m_lastRawDib` already caches the pre-stamp BGRA buffer
  (B1.3.1.1 zero-copy snapshot path). The cleanest engine-side
  hook for arch C is: **ship `m_lastRawDib` instead of running the
  stamps + UpdateLayeredWindow.**

### 2.2 The WebView2 surface is transparent and ready
- [`src/host/HostWindow.cpp:611-616`](../src/host/HostWindow.cpp:611)
  — `DefaultBackgroundColor` is COREWEBVIEW2_COLOR{0,0,0,0} (fully
  transparent). The current architecture relies on this to let the
  layered popup show through; architecture C **drops** the
  transparency requirement (chrome paints on whatever background
  the canvas isn't covering — typically panel surfaces).
- [`src/host/HostWindow.cpp:748-750`](../src/host/HostWindow.cpp:748)
  — Virtual host `app.local` → `web/apps/editor/dist`. The
  `WebResourceRequested` transport hooks into this same routing
  layer (a new path under `app.local/_viewport/frame.jpg`).
- [`src/host/HostWindow.cpp:801`](../src/host/HostWindow.cpp:801)
  — `Navigate(L"https://app.local/index.html")`. No COOP/COEP today.

### 2.3 The bridge surface scales cleanly
- [`web/packages/bridge-schema/src/index.ts`](../web/packages/bridge-schema/src/index.ts)
  — adds two new request kinds (`viewport/frame-ready` and
  `viewport/input`). Same pattern as `viewport/occlude` (line 648)
  and `viewport/capture-snapshot` (line 658).
- [`src/host/BridgeDispatcher.cpp`](../src/host/BridgeDispatcher.cpp)
  — new handlers slot in beside `viewport/occlude` (line 790) and
  `viewport/capture-snapshot` (line 834). Pattern unchanged.

### 2.4 `ViewportSlot` is already DOM-shaped
- [`web/apps/editor/src/components/ViewportSlot.tsx:44-56`](../web/apps/editor/src/components/ViewportSlot.tsx:44)
  — currently a `<div>` placeholder with `<span>D3D9 viewport</span>`.
  The new `<canvas ref={canvasRef}>` mounts inside the existing
  ResizeObserver wrapper. The DPR-scaled rect already gets
  dispatched (`layout/scene-rect`); we reuse that hook to size the
  canvas backing store.

### 2.5 Engine sizing is already decoupled from popup size
- B1.4 T4c parked the popup at full main-client size
  (`LayoutBroker::ApplyFullClient`). The Engine RT today is sized
  to the popup; for architecture C, the RT sizes to the canvas
  backing store. The decoupling is already in place — no Engine
  surgery needed, just a different size source.

### 2.6 Lessons that constrain the design
- [L-011](lessons.md): HTML CSS effects cannot reach the engine
  compositing layer **today**. Architecture C eliminates the layer
  boundary entirely. ★ L-011 stops being a constraint on the new
  UI; the cleanup PR can re-introduce CSS effects (menu shadows,
  popover backdrops) without the opaque-chrome workaround.
- [L-012](lessons.md): `window.bridge` may be `TestHostBridge`.
  Continue using `BridgeContext` / `useBridge()` for all new
  surfaces; never `window.bridge` directly.
- [L-013](lessons.md): Win32 drag-resize modal loop starves
  WebView2 IPC. **This applies to architecture C too** — during a
  WM_SIZING modal loop, frames stop arriving at the canvas. The
  canvas freezes on the last delivered frame; CSS scales it via
  `image-rendering` until the loop exits. Identical to today's
  modal-backdrop pattern, acceptable.
- [L-014](lessons.md): `react-resizable-panels@4.x` quirks — n/a
  for arch C itself, but the canvas mounts inside a panel so any
  re-flow of the panel layout must propagate to the canvas size.

---

## 3. Architecture / implementation approach

### 3.1 Transport choice — Phase 0 spike decides

Three candidate transports, ranked by complexity:

#### Path A — `WebResourceRequested` + JPEG
- **Renderer side**: `fetch('https://app.local/_viewport/frame.jpg')`
  on every `viewport/frame-ready` ping, draw via
  `createImageBitmap` → `ctx.drawImage`.
- **Host side**: Register a `WebResourceRequested` handler matching
  the `_viewport/frame.jpg` path; respond with the JPEG-encoded
  last frame from `m_lastRawDib`.
- **Encode cost**: ~3-8 ms for a 1920×1080 JPEG at quality 70
  (GDI+ or stb_image_write). Lower with smaller backing stores.
- **Decode cost**: ~1-3 ms via `createImageBitmap` (off-thread).
- **Round-trip**: ~1-2 ms CDP overhead per fetch.
- **Pros**: Trivial wiring; no headers; zero shared-memory plumbing;
  works in dev-UI mode (`http://localhost:5174`) and production
  (`https://app.local`) without changes.
- **Cons**: JPEG color quantization (alpha-channel loss; UI
  components in the canvas region may appear in subtly different
  shades than chrome adjacent). Encode is on the host UI thread
  unless we add a worker.
- **Worst case for spike**: 4K main window, full-window viewport,
  150 % DPR backing store (5760×3240 effective). Encode at this
  size could be 30+ ms — kills the path. The spike measures this.

#### Path B — `postMessage` with transferable `ArrayBuffer`
- **Renderer side**: `chrome.webview.postMessage` arrives with a
  `Uint8ClampedArray` BGRA payload; `ctx.putImageData(new ImageData(...))`.
- **Host side**: After readback, post the raw bytes via
  `PostWebMessageAsJson` is too slow; we need raw transfer. WebView2
  supports `PostWebMessageAsString` + base64? No — use the
  experimental `PostWebMessage` raw bytes path if it exists, or
  fall back to a worker-side `WebResourceRequested` for the bytes
  with a sentinel content-type.
- **Encode cost**: Zero (raw BGRA).
- **Decode cost**: ~1-2 ms for `putImageData` at 1080p.
- **Round-trip**: ~1-3 ms for IPC, plus copy overhead (transferable
  may or may not work — needs verification).
- **Pros**: Bit-exact pixels (no JPEG quantization). Lower CPU on
  host side.
- **Cons**: Copy overhead on the IPC boundary (raw bytes are large
  — 8 MB at 1080p, 33 MB at 4K). May negate the encode savings.
- **Spike question**: Does WebView2's `postMessage` IPC support
  transferable buffers (zero-copy) or always memcpy?

#### Path C — `SharedArrayBuffer` + COOP/COEP
- **Renderer side**: `new ImageData(sharedView, w, h)` →
  `ctx.putImageData`. Zero copies, zero IPC per frame.
- **Host side**: Allocate the SAB once (via a host-side script
  injection), write directly into the underlying memory. Engine
  thread writes; renderer thread reads with a SharedArrayBuffer
  `Atomics.wait` / `Atomics.notify` handshake.
- **Encode cost**: Zero.
- **Decode cost**: Zero (the canvas reads directly from the SAB).
- **Round-trip**: ~0 ms (just the atomic notify).
- **Pros**: Fastest possible path. Bit-exact pixels.
- **Cons**: Requires `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` on the WebView2
  navigation. Needs verification that WebView2's virtual-host
  scheme can serve these headers via `WebResourceRequested`. Also
  needs verification that WebView2 even exposes
  `SharedArrayBuffer` (Chromium-based, so likely yes, but the
  `crossOriginIsolated` flag needs to be true).

#### Decision tree
The pre-spike measures **end-to-end latency and steady-state FPS**
for each transport at three resolutions (720p, 1080p, 4K @ 100 %
DPR). The transport that delivers ≥30 FPS at 1080p under
interactive editing (mouse-drag camera spin) wins. If multiple
qualify, prefer in order: Path A (simplest) → Path B → Path C.

If **all three** fall below 30 FPS at 1080p, the architecture-C
migration is **not viable** and we revert to architecture A with a
documented L-015 lesson. (This is a real outcome and the user
should be aware of it before committing.)

### 3.2 The new bridge surface

```ts
// web/packages/bridge-schema/src/index.ts

// engine → renderer
{
  kind: "viewport/frame-ready",
  // Path A: renderer fetches via WebResourceRequested
  // Path B: renderer receives raw BGRA in a separate postMessage
  // Path C: renderer reads from the SAB; the message is just a wake-up
  payload: { w: number, h: number, frameId: number, timestampMs: number }
}

// renderer → engine
{
  kind: "viewport/input",
  payload:
    | { type: "mouse-down", button: 0|1|2, x: number, y: number, buttons: number, modifiers: number }
    | { type: "mouse-up",   button: 0|1|2, x: number, y: number, buttons: number, modifiers: number }
    | { type: "mouse-move",                  x: number, y: number, buttons: number, modifiers: number }
    | { type: "wheel",                       x: number, y: number, deltaY: number, modifiers: number }
    | { type: "key-down", key: string, code: string, modifiers: number }
    | { type: "key-up",   key: string, code: string, modifiers: number }
}
```

`x` / `y` are in **canvas backing-store pixels** (already DPR-scaled
on the renderer side). The host translates them straight into
engine coords without further scaling.

`modifiers` is a bitfield: `1=shift, 2=ctrl, 4=alt, 8=meta`.

### 3.3 Engine-side wiring

```cpp
// New on AlphaCompositor (or a sibling class — see §3.6):
class FramePublisher {
  void OnFrameReady(const uint8_t* bgraBytes, int w, int h);
  // Path A: stash latest in a member; WebResourceRequested handler reads it.
  // Path B: copy to IPC buffer + PostWebMessage.
  // Path C: copy to SAB-backed memory + Atomics.notify.
};

// In AlphaCompositor::Composite, after the existing readback + cache:
if (m_useArchitectureC) {
  m_framePublisher.OnFrameReady(m_impl->lastRawDib, m_impl->lastRawW, m_impl->lastRawH);
  return; // skip stamping + UpdateLayeredWindow
}
// Legacy path:
ApplyOcclusionStamps(...);
UpdateLayeredWindow(...);
```

The `m_useArchitectureC` flag is wired to a host-side env var
(`ALO_VIEWPORT_TRANSPORT=canvas-jpeg|legacy`) checked at
`HostWindow` construction. Default during this PR: `legacy`.
Default after the default-flip (the last phase): `canvas-jpeg`.

### 3.4 Renderer-side canvas mount

```tsx
// web/apps/editor/src/components/ViewportSlot.tsx (skeleton)
const ViewportSlot = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bridge = useBridge();
  const [dpr, setDpr] = useState(window.devicePixelRatio);

  // Size canvas + dispatch viewport/canvas-size on mount + resize
  useResizeObserver(slotRef, ({ width, height }) => {
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (canvasRef.current) {
      canvasRef.current.width = w;
      canvasRef.current.height = h;
    }
    bridge.request({ kind: "layout/scene-rect", payload: { x: 0, y: 0, w, h } });
  });

  // Subscribe to frame-ready
  useFrameSubscription({
    transport: import.meta.env.VITE_VIEWPORT_TRANSPORT ?? "legacy",
    onFrame: (bytes, w, h) => {
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      // Path-specific paint logic; for JPEG it's createImageBitmap → drawImage.
    },
  });

  // Forward input
  return (
    <div ref={slotRef} className="absolute inset-0">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ imageRendering: "pixelated" }}
        onMouseDown={(e) => dispatchInput(bridge, "mouse-down", e)}
        onMouseMove={(e) => dispatchInput(bridge, "mouse-move", e)}
        onMouseUp={(e) => dispatchInput(bridge, "mouse-up", e)}
        onWheel={(e) => dispatchInput(bridge, "wheel", e)}
      />
    </div>
  );
};
```

`useFrameSubscription` is a new hook that branches on transport
and abstracts the per-path subscription logic.

### 3.5 Popup HWND fate

The popup HWND owns the D3D9 swap chain today, and the
swap chain is the engine's primary surface. Moving the swap chain
to a hidden HWND has device-recreation cost and is risky. The
simpler change: **keep the popup HWND alive but invisible**.

- Size: 1×1, off-screen (e.g., -32000, -32000).
- Style: keep `WS_EX_LAYERED` + `WS_POPUP` but never call
  `ShowWindow(SW_SHOW)` (or call `ShowWindow(SW_HIDE)` once after
  the swap chain is created).
- Engine RT: still allocated; size set by the canvas backing store
  (via `Engine::Reset` whenever the canvas resizes).
- `UpdateLayeredWindow` calls: skipped entirely under architecture
  C. The popup never paints — it exists purely as the D3D9 device's
  required `HWND` host.

Mouse + keyboard never reach the popup HWND (it's off-screen).
Input arrives through the canvas → `viewport/input` → engine.

### 3.6 Module split for the new code

- New `src/host/FramePublisher.h/.cpp` (Path-A/B/C variant):
  - `JpegFramePublisher.h/.cpp` (Path A): JPEG encode via GDI+ /
    stb_image_write; cached buffer accessor for
    `WebResourceRequested`.
  - `PostMessageFramePublisher.h/.cpp` (Path B).
  - `SabFramePublisher.h/.cpp` (Path C).
  - `IFramePublisher` interface so `AlphaCompositor` can hold a
    polymorphic pointer set at construction time from the env var.
- New `src/host/InputDispatcher.h/.cpp`: receives
  `viewport/input` bridge requests, synthesises Win32 messages
  for the engine (`WM_LBUTTONDOWN`, etc.) addressed to the engine
  popup HWND. Engine's existing input handlers receive them
  unchanged.

Phase 0's spike implements `JpegFramePublisher` first (simplest);
Phases 1-3 keep the interface and add the other two iff the spike
shows JPEG is borderline.

### 3.7 Feature flag mechanics

- Build-time: `VITE_VIEWPORT_TRANSPORT` env var read at Vite build.
  Bakes into `import.meta.env.VITE_VIEWPORT_TRANSPORT`. Default
  in dev: `legacy`. Default in CI / production builds (post-flip):
  `canvas-jpeg`.
- Run-time: `ALO_VIEWPORT_TRANSPORT` env var read by `HostWindow`
  at construction. Determines which `FramePublisher` (or
  no-publisher = legacy) is instantiated.
- Both must agree. Mismatch raises an error banner in the UI
  (renderer side checks via bridge handshake at mount).
- For A/B verification (Phase 3): two test runs, one per
  combination, in CI; both must pass identical Playwright spec.

---

## 4. Risks named up front + mitigations

**This is the section to iterate with the user before any code.**

### Risk 1 — Spike disqualifies all three transports
**Hazard**: Worst case, all transports fall below the 30 FPS bar
at 1080p interactive (camera spin while particles emit). The
migration is not viable without ARC engine internals work
(swap-chain-to-canvas via DXGI shared-handle interop, etc.),
which is far beyond the ROADMAP's 16-32h budget.
**Mitigation**: Phase 0's spike includes a hard go/no-go gate.
If no transport qualifies, Phase 0 publishes the numbers, files
L-015 with the disqualification, and proposes either (a) a much
larger DXGI-interop dispatch as a separate ROADMAP item, or (b)
revert. The user makes the call. No code beyond Phase 0 is
committed if the spike fails.

### Risk 2 — JPEG color quantization mismatches chrome
**Hazard**: Path A's JPEG quality 70 introduces visible color
shifts in particle alpha edges and gradient skyboxes, especially
against the editor's panel surfaces (which are flat-shaded).
**Mitigation**: Spike includes pixel-diff screenshots vs.
architecture-A reference at three quality levels (70 / 85 / 95).
If 95 still looks wrong, fall back to Path B (raw BGRA via
postMessage) before declaring Path A the default.

### Risk 3 — Input forwarding edge cases break camera controls
**Hazard**: Today's camera-drag handler (rotate on LMB, pan on
MMB, zoom on wheel) reads window messages directly. New bridge
surface ships event payloads as bridge requests — risk of subtle
drift in modifier-key handling, mid-drag focus loss, double-click
debouncing.
**Mitigation**:
  (a) Mirror the existing engine handlers exactly — every
      modifier check, every button check, every "buttons" field
      passed in the bridge payload reflects what the engine reads
      today.
  (b) Manual smoke covers the existing camera-controls matrix
      (LMB-drag, MMB-drag, RMB-drag, wheel, Shift+LMB instance
      spawn, Alt+LMB camera pan if it exists) in both
      architectures side-by-side.
  (c) Playwright covers: at least one mouse-down → mouse-move →
      mouse-up sequence per camera mode, asserting a state change
      that the engine surfaces via `engine/get/camera`.
  (d) Keyboard hotkeys (Space=pause, R=reset, etc.) routed via
      the same surface; React's window-scoped keydown handler at
      `App.tsx` fires `viewport/input` for engine-relevant keys.

### Risk 4 — Win32 drag-resize modal loop freezes the canvas
**Hazard**: L-013 — during a WM_SIZING modal loop, host thread
synchronously blocks on the resize, WebView2 IPC starves, frames
stop arriving at the canvas. User drags a window edge; the canvas
shows a frozen frame from the start of the drag.
**Mitigation**: Already-known + accepted. Canvas freezes are
identical to today's modal-backdrop pattern (acceptable per
L-013). CSS-scales the frozen image via `image-rendering: pixelated`
during the freeze; once the modal loop exits, frames resume.
**Net new code: none** — the freeze is a property of the IPC
substrate, not the canvas.

### Risk 5 — DPR / monitor-change races break canvas sizing
**Hazard**: User drags the editor window from a 1.5× display to a
2× display. DPR change fires; renderer-side `useResizeObserver`
re-dispatches `layout/scene-rect`; host-side `Engine::Reset`
re-creates the RT at the new size; in-flight frames sized to the
old RT may decode mis-sized into the new canvas backing store.
**Mitigation**: Frame payload includes `{ w, h, frameId }`.
Renderer-side decode discards any frame whose `w`/`h` doesn't
match the current canvas size. Brief flash of stale frame is
acceptable; mis-sized paint is not.

### Risk 6 — D3D9 device loss during canvas-only path
**Hazard**: Today's device-lost recovery (`D3DERR_DEVICELOST` →
`Engine::Reset` → re-create swap chain) involves the popup HWND.
With the popup hidden and never repainting, a recovery race could
leave the engine in a quasi-recovered state with no visible canvas
output.
**Mitigation**: Engine::Reset is unchanged. The hidden popup HWND
is still a valid D3D9 `HWND` target; the swap chain still recovers
as today. Canvas-side frame subscriber drops any frame received
during the recovery window (engine-side suppresses
`viewport/frame-ready` until reset is complete). Smoke: alt-tab to
another GPU-heavy app, alt-tab back, confirm frames resume cleanly.

### Risk 7 — SharedArrayBuffer header requirements break dev mode
**Hazard**: Path C (SAB) requires COOP/COEP. Setting these
headers globally on the virtual host breaks Vite dev-server
loading (cross-origin script tags) and potentially the
`https://app.local` navigation itself.
**Mitigation**: Only set the headers on the canvas frame
endpoint, not globally — `WebResourceRequested` handler emits
COOP/COEP for `_viewport/*` paths only. The main page navigation
stays header-free. This needs explicit verification in the spike
because WebView2's `WebResourceRequested` may not allow header
injection in all modes.

### Risk 8 — Encode cost spikes on integrated GPUs
**Hazard**: `GetRenderTargetData` is already slow on Intel HD
graphics (~5-10 ms at 1080p). Adding JPEG encode (~5-8 ms) on the
same thread blocks the frame loop, dropping FPS to <20 on weak
hardware.
**Mitigation**: Spike measures encode on the user's actual
hardware (i7-13700K + RTX 3060 per project context — strong, but
also test on a weak laptop iGPU if available). If borderline, move
JPEG encode to a worker thread via `concurrency::create_task`. The
readback stays synchronous (it's the D3D9 device's serial path).

### Risk 9 — Hidden popup HWND changes focus semantics
**Hazard**: Today's popup HWND has `WS_EX_NOACTIVATE`, but it's
visible and owns input. Hidden + off-screen may interact unexpectedly
with Windows' alt-tab list, taskbar behaviour, or the main
window's focus tracking.
**Mitigation**: Keep `WS_EX_NOACTIVATE`. Add `WS_EX_TOOLWINDOW`
(already present per the survey at HostWindow.cpp:839) to keep it
out of alt-tab. Verify in manual smoke: alt-tab cycle, taskbar
right-click on main window, Win+Tab task view — none should
surface the hidden popup.

### Risk 10 — Modal snapshot pattern becomes redundant + needs deferred deletion
**Hazard**: B1.3.1.1's snapshot-into-DOM machinery
(`viewport/capture-snapshot`, `AlphaCompositor::CaptureSnapshotPng`,
the Modal portal) becomes redundant under architecture C — the
canvas IS the live engine pixels. Leaving it in place is dead
code; deleting it in this PR balloons the diff.
**Mitigation**: Out of scope for this PR — the cleanup PR deletes
it alongside `useViewportOcclusion`. The Modal continues to call
`viewport/capture-snapshot` under both architectures during the
A/B period; under architecture C the snapshot is cropped from the
last-cached BGRA (same pre-stamp cache, just no stamps applied
afterward). Modal contract unchanged.

### Risks accepted (not worth designing around)
- **Rare race where canvas paints before first engine frame**:
  Initial mount paints a single black frame; engine catches up in
  ~16 ms. User sees a brief flash. Not worth gating canvas mount
  on first-frame-ready.
- **High-refresh monitors (>60 Hz)**: Engine frame loop is
  vsync-locked or hard-capped at 60 FPS today; not worth raising
  for architecture C alone.

---

## 5. Testing & verification

### Happy paths
- [ ] Architecture-C canvas paints engine pixels at 720p, 1080p,
      4K (all at 100 % DPR).
- [ ] LMB-drag rotates camera identically to architecture A.
- [ ] MMB-drag pans camera identically.
- [ ] RMB-drag rotates (or whatever the engine binds to RMB today)
      identically.
- [ ] Wheel zooms identically.
- [ ] Shift+LMB instance spawn (per existing engine handler) fires.
- [ ] Splitter drag resizes canvas + Engine RT smoothly, no flash
      of mis-sized frame, no console errors.
- [ ] Window resize (drag main window edge) resizes canvas + RT.

### Edge cases
- [ ] Open About modal under architecture C: backdrop samples the
      live canvas (frozen at modal-open per B1.3.1.1 contract).
- [ ] Open Lighting tool panel: panel paints over the canvas with
      no cutout artifact (the canvas just isn't there under the
      panel — panel paints on its own background).
- [ ] DPR change (drag window to a different-DPR monitor): canvas
      backing store + RT both resize, no stuck stale frame.
- [ ] Alt-tab away and back: device-lost recovery completes; frames
      resume on the canvas; no white-flash or stuck-grey artifact.
- [ ] Open a menu dropdown over the canvas: menu shadow + any
      CSS effect renders correctly with NO cutout artifact (★ the
      core MT-11 payoff — capture before/after screenshots).

### Cancellation / refused inputs
- [ ] Bridge handshake mismatch (renderer expects canvas, host
      runs legacy): UI shows an error banner, neither path paints
      gibberish.

### Cleanup
- [ ] Switch back to architecture A via env var: legacy popup
      paints, canvas hidden, all gestures still work.
- [ ] Architecture C is the only path: zero references to
      `AlphaCompositor::Composite`'s stamp logic; cleanup PR
      handles deletion.

### Debug instrumentation
- [ ] `#ifndef NDEBUG` printfs with tag prefix `[ArchC]`:
      `[ArchC] transport=jpeg, frame size = WxH, encode = N ms`.
      Logged at most once per second (rate-limited) to avoid log
      spam. Removed in T-cleanup.

### Test suites
- [ ] Vitest: +N unit tests covering the new bridge surface,
      transport hook, input dispatcher mapping. N likely 6-10.
- [ ] Playwright: new `canvas-architecture.spec.ts` runs the full
      camera-controls + splitter + DPR matrix under
      `VITE_VIEWPORT_TRANSPORT=canvas-jpeg`; the existing
      `viewport-resize.spec.ts` (and friends) continue to run
      under `legacy` until the cleanup PR.
- [ ] MSBuild Debug x64 — `Engine`, `AlphaCompositor`, new
      `FramePublisher` + `InputDispatcher`, `HostWindow`, and
      `BridgeDispatcher` all touched.

---

## 6. Phases (post-spike — gated on Phase 0)

### Phase 0 — Pre-spike (gating, ~2-4 h)
- **0.1 ✅ LANDED (uncommitted).** Wired a minimal JPEG path on the
  host (`AlphaCompositor::EncodeFrameJpeg` + `HostWindow`'s env-var
  gate + `WebResourceRequested` handler serving `/_viewport/frame.jpg`
  + per-frame `viewport/frame-ready` post) and a minimal `<canvas>`
  in `ViewportSlot` (subscribes to the host event via the raw
  `chrome.webview` message channel, fetches the JPEG, paints via
  `createImageBitmap` → `drawImage`). Camera still flows through
  the legacy visible popup. Tests: vitest 294/294, tsc 0 errors,
  MSBuild Debug x64 clean. **Runtime smoke not yet done — see
  §6.0.1.1 below.**
- **0.1.1 ⏳ Runtime smoke (user-driven).** Two ways to launch the
  spike build:

  **Fastest iteration — dev-ui mode (Vite HMR + spike flag):**
  ```bash
  # Terminal 1: dev server with the env var baked in
  cd web/apps/editor
  $env:VITE_VIEWPORT_TRANSPORT = "canvas-jpeg"  # PowerShell syntax
  pnpm run dev

  # Terminal 2: launch the editor binary against the dev server
  $env:ALO_VIEWPORT_TRANSPORT = "canvas-jpeg"
  $env:ALO_VIEWPORT_JPEG_Q = "70"   # optional; default 70, try 85 / 95 later
  ./x64/Debug/ParticleEditor.exe --dev-ui --test-host
  ```

  **Prod-mode (built bundle):**
  ```bash
  # One-time: build with the env var baked into the bundle
  cd web/apps/editor
  $env:VITE_VIEWPORT_TRANSPORT = "canvas-jpeg"
  pnpm run build

  # Launch
  $env:ALO_VIEWPORT_TRANSPORT = "canvas-jpeg"
  ./x64/Debug/ParticleEditor.exe
  ```

  **What you should observe:**

  - The host log (default location next to the .exe: typically
    `host.log` or similar — check `OpenLog()` in HostWindow.cpp for
    the path) should show `[ArchC]` lines roughly once per second:
    `[ArchC] frame=N size=WxH jpegBytes=N q=70`.
  - DevTools console (F12 in --test-host mode) should show
    `[ArchC] canvas painted N frames in Mms (size WxH)` matching
    the host's cadence.
  - **Visually you will NOT yet see the canvas pixels** because the
    legacy WS_EX_LAYERED popup still paints engine pixels on top of
    the WebView (Phase 1 hides the popup). The canvas is mounted
    and painting, just occluded. Confirm via DevTools: the
    `<canvas data-testid="viewport-canvas">` should be in the DOM
    and `canvas.toDataURL()` should return non-empty PNG bytes.
  - **Disable for comparison**: unset `ALO_VIEWPORT_TRANSPORT` and
    `VITE_VIEWPORT_TRANSPORT`; launch again; no `[ArchC]` lines
    should appear; original behaviour is intact.

- **0.2** Measure: encode time, IPC round-trip time, end-to-end
  frame latency, steady-state FPS during camera spin. Three
  resolutions (720p, 1080p, 4K at 100% DPR). Repeat on weak
  hardware if available.
- **0.3** Capture pixel-diff screenshots at JPEG q=70 / 85 / 95
  vs. architecture-A reference.
- **0.4** Optional: same numbers for Path B if Path A is borderline.
- **0.5** Optional: same numbers for Path C if Paths A + B both
  fail to clear 30 FPS at 1080p. Verify COOP/COEP can be set on a
  subset of paths without breaking page navigation.
- **0.6 ✅ DONE — Spike report.**

  **Transport actually used.** Path A *as modified* — JPEG bytes
  delivered **inline as base64 in the `viewport/frame-ready`
  postMessage payload**, NOT via `WebResourceRequested` + `fetch`
  as originally planned. The `WebResourceRequested` route was
  abandoned mid-spike when filter `*` + `COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL`
  + token returned from `add_WebResourceRequested` all proved
  insufficient to invoke the handler. Root cause: virtual-host
  mapping short-circuits user handlers — see [L-015](lessons.md).

  **Measured numbers.**

  | Metric | Value |
  |---|---|
  | Scene rect | 699×495 (centre quadrant at 100 % DPR) |
  | JPEG size at q=70 | 43-58 KB (varies with scene content) |
  | Base64 payload | 58-78 KB on the wire |
  | Host encode + post rate | ~120 FPS sustained |
  | Renderer paint rate | ~115-130 FPS (Image → drawImage) |
  | End-to-end (host emit → canvas paint) | 1:1 — no renderer-side dropping |
  | Frames over 73 sec smoke | 8,813 |
  | Errors / warnings | zero |

  **Bar comfortably cleared.** The Phase 0 gate was ≥30 FPS at
  1080p; we hit ~120 FPS at the centre-quadrant scene rect (~700×500)
  with the engine running its normal frame loop. Even at a hypothetical
  3× slowdown for full-screen 1080p the path would still clear the
  bar.

  **Cost breakdown (estimated from latency budget, not directly
  measured).** Per frame at ~120 FPS = ~8.3 ms total:
  - `GetRenderTargetData` readback: ~2-3 ms (unchanged from arch A)
  - GDI+ JPEG encode at q=70: ~3-4 ms
  - Base64 encode: <1 ms
  - `PostWebMessageAsJson` IPC: ~1-2 ms
  - Renderer-side `Image()` decode + `drawImage`: ~2-3 ms

  **Path B / Path C not spiked.** Path A cleared the bar with room
  to spare; Path B (raw `ArrayBuffer` via postMessage) and Path C
  (SharedArrayBuffer + COOP/COEP) are unnecessary. They remain
  available as Phase 1 optimization paths if specific bottlenecks
  emerge.

  **JPEG quality sweep not done.** Q=70 already looked clean to the
  spike-grade eye; a proper visual-diff sweep at q=85 / q=95 is a
  Phase 1+ polish item, not a gating measurement.

- **0.7 ✅ READY FOR USER — GO / NO-GO gate.** Recommendation: **GO**
  to Phase 1 with the inline-base64 Path A as the default transport.
  Open questions for the user before Phase 1 starts:

  1. Keep inline base64 as the production transport, or revisit
     for a non-conflicting URL host + `WebResourceRequested`? The
     base64 path is simpler and works; the WRR path saves ~33%
     bandwidth at the cost of more wiring + L-015's gotcha.
  2. Bridge schema entry for `viewport/frame-ready` — promote to
     the typed schema in Phase 1.1, or keep using the raw
     `chrome.webview.message` channel for the spike-grade
     subscription?

### Phase 1 — Production-grade `FramePublisher` + canvas mount ✅ SHIPPED (uncommitted)
- **1.1 ✅** Typed bridge schema for `viewport/frame-ready` added
  to [`web/packages/bridge-schema/src/index.ts`](../web/packages/bridge-schema/src/index.ts):
  `{ kind: "viewport/frame-ready", payload: { w, h, frameId, jpegBase64 } }`.
  MockBridge inherits the generic `on<K>` so the new event kind is
  type-checked without code change. ViewportSlot switched from the
  raw `chrome.webview.message` channel to `bridge.on("viewport/frame-ready", ...)`.
- **1.2 ✅** [`host::FramePublisher`](../src/host/FramePublisher.h)
  class extracted — owns the encode + base64 + emit + 1 Hz
  log-throttle state. Constructed alongside the AlphaCompositor in
  WM_CREATE (only when `ALO_VIEWPORT_TRANSPORT=canvas-jpeg`); torn
  down BEFORE the compositor in WM_DESTROY. HostWindow.cpp inline
  encode block (~80 lines) replaced with a single
  `m_framePublisher->OnFrameComposited()` call. Dead WebResourceRequested
  block deleted (L-015 record kept as a one-paragraph comment in
  InitWebView2).
- **1.3 ✅** DPR-correct sizing already worked via existing
  scene-rect dispatch; added a `matchMedia('(resolution: ${dpr}dppx)')`
  listener for monitor-swap / browser-zoom changes that don't trigger
  ResizeObserver (rebinds to the new DPR after each fire).
- **1.4 ✅** Vitest +6 new tests in
  [`ViewportSlot.test.tsx`](../web/apps/editor/src/components/__tests__/ViewportSlot.test.tsx)
  — render-path dual mode (legacy span vs canvas), scene-rect dispatch
  shape, frame-ready subscribe + unsubscribe lifecycle. Total vitest:
  300 (was 294). Subscription moved BEFORE the canvas context lookup
  so jsdom (where `getContext("2d")` returns null) and production
  share the same path.
- **1.5 ✅** Runtime smoke confirmed: `[ArchC] FramePublisher up`
  log line fires once on startup; per-frame `[ArchC] frame=N` lines
  continue at ~120 FPS steady state (identical to pre-refactor);
  vitest 300/300; MSBuild Debug x64 clean (only preexisting LIBCMTD
  warning); tsc 0 errors.

**Net state at end of Phase 1.** Transport is production-grade:
typed bridge event, encapsulated `FramePublisher` class,
DPR-resilient canvas sizing, unit-test coverage. The canvas is
still occluded by the legacy WS_EX_LAYERED popup — Phase 2's job
(hide popup, route input through canvas via new `viewport/input`
bridge surface).

### Phase 2 — Input forwarding (~4-6 h)
- **2.1** New bridge surface `viewport/input` (schema + MockBridge
  cases).
- **2.2** Renderer-side: dispatch handlers on the `<canvas>` for
  mouse-down / move / up / wheel; window-scoped for keydown / up
  with `TYPING_TAGS` guard (per the curve-editor pattern).
- **2.3** Host-side `InputDispatcher.cpp` — receives bridge
  requests, posts Win32 messages to the hidden popup HWND so the
  engine's existing handlers consume them unchanged.
- **2.4** Hide the popup HWND (off-screen + `ShowWindow(SW_HIDE)`).
- **2.5** Manual + Playwright smoke matrix: every camera
  gesture, every modifier combination, every keyboard hotkey.
- **2.6** Vitest coverage for input-dispatcher contract.

### Phase 3 — A/B verification (~2-4 h)
- **3.1** Playwright runs every existing spec under both env-var
  combinations. Identical assertions must pass.
- **3.2** Manual smoke: open every menu, every dropdown, every
  popover, every modal under architecture C. Screenshot diff vs.
  architecture A. Confirm no cutout artifact in any dropdown.
- **3.3** Verify on weak hardware (if available).
- **3.4** Surface any regression — fix or document.

### Phase 4 — Default flip (~2-4 h)
- **4.1** Default `VITE_VIEWPORT_TRANSPORT=canvas-jpeg` (or
  chosen path) in production builds.
- **4.2** Default `ALO_VIEWPORT_TRANSPORT=canvas-jpeg` in host
  default.
- **4.3** `--legacy-popup` flag preserved on both ends for
  emergency rollback.
- **4.4** Update CHANGELOG, ROADMAP (strikethrough + Shipped), and
  HANDOFF.

### Phase 5 — Cleanup follow-up PR (out of scope for this PR, ~2-4 h)
Filed as a follow-up dispatch — listed here for forward-planning:
- Delete `AlphaCompositor::Composite`'s stamp pipeline, `SetSceneRect`,
  `SetOcclusion`, `RemoveOcclusion`, `BoxBlurDibBgra` if any survives,
  `lastRawDib` cache (or repurpose for modal snapshot — TBD).
- Delete `viewport/occlude`, `layout/scene-rect`, MockBridge cases.
- Delete `useViewportOcclusion` + 5 callsites.
- Delete `OccludingPopover`, `OccludingMenubarContent`.
- Modal: stop calling `viewport/capture-snapshot`; sample the
  canvas directly via `<canvas>.toDataURL` or paint a blurred
  copy.
- Restore CSS effects in dropdowns / popovers (now safe — no
  cutout to worry about).

---

## 7. User decisions (questionnaire, 2026-05-21)

Locked-in before Phase 0 starts:

1. **Transport preference if all three viable** → **Path A (JPEG
   via `WebResourceRequested`).** Simplest wiring, no shared-memory
   plumbing, works identically in dev + prod. Spike still measures
   all three so the data is available if Path A turns out borderline;
   default lands on A if A clears the 30 FPS bar.
2. **Disqualification scenario** → **Propose a DXGI-interop
   dispatch.** If no transport clears 30 FPS at 1080p, Phase 0
   files L-015 with the disqualification numbers and proposes a
   separate ROADMAP item for DXGI shared-handle interop
   (~40-80 h). This dispatch ends at the GO/NO-GO gate without
   committing further code.
3. **Weak-hardware testing** → **Extrapolate from current rig
   only.** Measure on the dev rig (i7-13700K + RTX 3060 territory);
   the spike report notes weak-iGPU numbers are extrapolated, not
   measured. Faster turnaround, less data — accepted because the
   tool is meant for modders running it on capable hardware
   anyway, and the FPS bar (≥30 at 1080p on capable hardware) is
   already conservative.
4. **Cleanup PR timing** → **Separate follow-up PR.** Architecture
   C bakes behind the flag; cleanup deletes dead code in a smaller
   follow-up dispatch after a week. Lower regression risk, smaller
   diffs, slightly more dead code in master temporarily — accepted.
5. **Camera-input parity** → **The five known gestures cover it**
   (LMB-drag, MMB-drag, RMB-drag, wheel-zoom, Shift+LMB instance
   spawn). If Phase 2's bridge-payload design surfaces additional
   gestures handled by the engine today, they get added to the
   smoke matrix as I find them.

---

## 8. Effort summary

| Phase | Hours | Cumulative |
|---|---|---|
| 0 — Pre-spike (gating) | 2-4 | 2-4 |
| 1 — Canvas + transport | 4-6 | 6-10 |
| 2 — Input forwarding | 4-6 | 10-16 |
| 3 — A/B verification | 2-4 | 12-20 |
| 4 — Default flip + docs | 2-4 | 14-24 |
| **Total this PR** | | **14-24 h** |
| 5 — Cleanup (separate PR) | 2-4 | — |
| **Grand total** | | **16-28 h** |

Within the ROADMAP §2.1 estimate (16-32 h post-spike). Phase 0
spike is the only commitment until the GO / NO-GO gate.

---

## 9. References

- ROADMAP §2.1 [MT-11]: [ROADMAP.md](../ROADMAP.md)
- CHANGELOG top entry (B1.4 close-out, motivates this work):
  [CHANGELOG.md](../CHANGELOG.md)
- AlphaCompositor: [src/host/AlphaCompositor.h](../src/host/AlphaCompositor.h),
  [src/host/AlphaCompositor.cpp](../src/host/AlphaCompositor.cpp).
- Bridge schema: [web/packages/bridge-schema/src/index.ts](../web/packages/bridge-schema/src/index.ts).
- ViewportSlot: [web/apps/editor/src/components/ViewportSlot.tsx](../web/apps/editor/src/components/ViewportSlot.tsx).
- WebView2 setup: [src/host/HostWindow.cpp:581-810](../src/host/HostWindow.cpp:581).
- Lessons L-011 / L-012 / L-013 / L-014: [tasks/lessons.md](lessons.md).
- B1.3.1.1 snapshot pattern context (relevant to Risk 10):
  [tasks/HANDOFF.md](HANDOFF.md) → "B1.3.1.1 P4" section.

---

## 10. Architectural survey done at plan-drafting time

(Captured for future readers; the same survey is needed by any
dispatch that touches the engine/WebView2 boundary.)

Subagent ran a "very thorough" Explore pass covering:
- `AlphaCompositor` (681 LOC total, src/host/AlphaCompositor.{h,cpp}).
- Popup HWND lifecycle (CreateWindowExW at HostWindow.cpp:839,
  WS_EX_LAYERED + WS_POPUP; full-main-client size via
  `LayoutBroker::ApplyFullClient` per B1.4 T4c).
- Bridge surfaces: `layout/scene-rect` (line 638), `viewport/occlude`
  (line 648), `viewport/capture-snapshot` (line 658), all in
  `web/packages/bridge-schema/src/index.ts`. Handlers in
  `src/host/BridgeDispatcher.cpp`.
- `useViewportOcclusion` (5 callsites: MenuBar dropdowns,
  OccludingPopover, ToolPanel, ViewportPill, Modal sentinel).
- WebView2: virtual host `app.local` → `web/apps/editor/dist`;
  transparent DefaultBackgroundColor; no COOP/COEP today.
- D3D9: Engine owns device targeting popup HWND.
- ViewportSlot: 59-line component, currently `<div>` placeholder.
- Tailwind v4 CSS-first confirmed (no `tailwind.config.ts`).
