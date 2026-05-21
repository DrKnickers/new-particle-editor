// AlphaCompositor — bridges D3D9 rendering to a WS_EX_LAYERED top-level
// popup via UpdateLayeredWindow. Replaces FD7/FD8's SetWindowRgn cut-out
// with software alpha-stamping: the engine still renders fully opaque
// pixels into an off-screen ARGB RT, the readback path stamps alpha=0
// (with a smoothstep feather) inside chrome occlusion rectangles, and
// the layered popup composites with the WebView2 underneath so menu
// dropdowns / tool panels show through cleanly.
//
// Pipeline per frame:
//   1. Engine renders the scene into the off-screen D3DFMT_A8R8G8B8 RT
//      we own (GetRenderTarget()).
//   2. Engine calls Composite(layeredHwnd).
//   3. We GetRenderTargetData → D3DPOOL_SYSTEMMEM surface.
//   4. LockRect, memcpy into a CreateDIBSection-allocated bitmap.
//   5. For each registered occlusion, stamp the DIB alpha bytes to 0
//      inside the rect, smoothstep-ramp on the feather band.
//   6. UpdateLayeredWindow(ULW_ALPHA) pushes the bitmap to the popup.
//
// Resize() must be called whenever the popup HWND's client area changes.
// The RT, system-mem surface, and DIB are all reallocated to match.
//
// SetOcclusion / RemoveOcclusion are single-threaded (UI thread only)
// — they match the existing LayoutBroker invariant. The map is mutated
// only between Render frames.
//
// FD9b. See tasks/todo.md.
#ifndef HOST_ALPHA_COMPOSITOR_H
#define HOST_ALPHA_COMPOSITOR_H

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <memory>
#include <string>

struct IDirect3DDevice9;
struct IDirect3DSurface9;

namespace host {

class AlphaCompositor
{
public:
    // The device must outlive the AlphaCompositor. HostWindowImpl
    // guarantees this: Engine owns the device, the compositor is
    // detached on WM_DESTROY before either is destroyed.
    explicit AlphaCompositor(IDirect3DDevice9* device);
    ~AlphaCompositor();

    AlphaCompositor(const AlphaCompositor&)            = delete;
    AlphaCompositor& operator=(const AlphaCompositor&) = delete;

    // Resize the internal RT/sysmem/DIB to match the popup's client
    // size. Idempotent when (w, h) is unchanged. Throws
    // std::runtime_error on allocation failure.
    void Resize(int width, int height);

    // Release the D3DPOOL_DEFAULT render target (and friends) so
    // IDirect3DDevice9::Reset can succeed — Reset returns
    // D3DERR_INVALIDCALL if any POOL_DEFAULT resource is still
    // outstanding. Engine::Reset must call this BEFORE m_pDevice->Reset,
    // and the post-Reset Resize() recreates everything at the new
    // back-buffer size.
    void ReleaseGpuResources();

    // The off-screen ARGB render target Engine should set on slot 0
    // at the start of Render(). Returns nullptr until Resize() has
    // been called with a non-degenerate size.
    IDirect3DSurface9* GetRenderTarget() const;

    // Register / replace an occlusion rectangle. `rectClient` is in
    // popup-client coords (same coord space as the DIB). `feather`
    // is the smoothstep band (in pixels) at the rect's outer edge;
    // 0 disables feathering (hard rectangular alpha cut, same shape
    // as the old SetWindowRgn).
    void SetOcclusion(std::string id, RECT rectClient, int feather = 3);

    // Remove a previously registered occlusion. No-op if id unknown.
    void RemoveOcclusion(const std::string& id);

    // B1.3.1: modal-mask post-process. When a modal opens, React calls
    // viewport/set-modal-mask with alpha < 1 and blurRadius > 0; the
    // compositor blurs the engine pixels (separable box blur, runs on
    // the DIB before stamps) and multiplies the popup's per-pixel
    // alpha by `alpha` (runs after stamps). The visible result is a
    // dimmed + blurred engine viewport that matches the panels'
    // `bg-black/60 backdrop-blur-sm` Dialog.Overlay treatment, since
    // HTML's CSS effects can't reach into the engine popup layer
    // directly.
    //
    // Identity (no effect) is alpha=1.0, blurRadius=0 — the cheap
    // fast-path that runs every frame when no modal is open.
    void SetModalMask(float alpha, int blurRadius);

    // B1.3.1.1: capture the most recent pre-stamp engine frame as a
    // base64-encoded PNG. `outBase64` is filled with the PNG payload
    // (no "data:image/png;base64," prefix — the caller adds that).
    // `outW` / `outH` are the snapshot pixel dimensions. Returns
    // `false` and leaves outputs untouched when no frame has been
    // composited yet (e.g. the engine never rendered or the device
    // just reset). Safe to call from the UI thread between frames;
    // GDI+ must have been initialized by the host (HostWindow::Run).
    //
    // The snapshot reflects the engine's raw output BEFORE chrome
    // occlusion stamps and BEFORE modal-mask dim/blur — exactly the
    // pixels React's <img src=...> backdrop wants to see, so CSS
    // effects above can dim + blur it uniformly with the panels.
    bool CaptureSnapshotPng(std::string& outBase64, int& outW, int& outH);

    // Per-frame readback + occlusion stamp + UpdateLayeredWindow push.
    // No-op if Resize hasn't run or the HWND is null.
    void Composite(HWND layeredHwnd);

private:
    struct Impl;
    std::unique_ptr<Impl> m_impl;
};

} // namespace host

#endif // HOST_ALPHA_COMPOSITOR_H
