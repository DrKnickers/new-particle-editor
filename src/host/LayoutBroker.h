// LayoutBroker — applies the React-side `layout/viewport-rect` message
// to the D3D9 viewport HWND.
//
// FD8 (May 2026): the viewport is a top-level WS_POPUP owned by the
// main HWND, not a WS_CHILD. React reports the viewport quadrant rect
// in main-client coordinates; LayoutBroker converts to screen
// coordinates for SetWindowPos on the popup. The popup is composited
// by DWM as its own layer, above any child HWND including WebView2 —
// that's what makes the viewport visible.
//
// FD9b (May 2026): the popup is also WS_EX_LAYERED. Occlusion updates
// from React (`viewport/occlude`) used to drive a SetWindowRgn HRGN
// cut-out; they now translate the occlusion rect into popup-client
// coords and forward to AlphaCompositor::SetOcclusion, which
// per-frame stamps alpha (with a smoothstep feather) into the
// readback DIB before UpdateLayeredWindow. LayoutBroker keeps the
// main-client-coord map so it can re-emit translated rects whenever
// the popup moves or resizes.
#ifndef HOST_LAYOUT_BROKER_H
#define HOST_LAYOUT_BROKER_H

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <string>
#include <unordered_map>

class Engine;

namespace host {

class AlphaCompositor;

class LayoutBroker
{
public:
    explicit LayoutBroker(HWND viewport = nullptr) : m_viewport(viewport), m_engine(nullptr), m_lastW(0), m_lastH(0) {}

    void SetViewport(HWND viewport) { m_viewport = viewport; }

    // Inject the live Engine after construction (mirrors
    // BridgeDispatcher::SetEngine). Null is treated as "engine not
    // ready"; Apply still performs the SetWindowPos so layout works,
    // but skips the D3D9 swap-chain reset.
    void SetEngine(Engine* engine) { m_engine = engine; }

    // FD9b: inject the layered-window compositor. SetOcclusion /
    // RemoveOcclusion forward to it after translating the rect from
    // main-client coords to popup-client coords. Null is treated as
    // "compositor not installed" — occlusion updates are recorded
    // (so a later attach can replay them) but no stamping happens.
    void SetAlphaCompositor(AlphaCompositor* compositor);

    // x/y/w/h are device pixels in the OWNER MAIN HWND'S client
    // coordinates, exactly what React's ViewportSlot sends from
    // getBoundingClientRect. With per-monitor-v2 DPI awareness,
    // child-window coordinates are in physical pixels.
    //
    // FD8 converts to screen coords via ClientToScreen(owner, …)
    // before SetWindowPos because the viewport is now a top-level
    // popup, not a child.
    void Apply(int x, int y, int w, int h);

    // FD8: re-apply the last-cached client-coord rect, with a fresh
    // ClientToScreen translation. Called from HostWindow's WM_MOVE
    // handler when the main window is dragged across the desktop so
    // the popup viewport follows. Skips the Engine::Reset path
    // (size didn't change, only position).
    void RefreshScreenPosition();

    // FD8 polish: predict the viewport rect from main's CURRENT client
    // size + the layout offsets cached at the last Apply. Used by
    // HostWindow's WM_SIZE handler so the popup tracks main's resize
    // synchronously, before React's ResizeObserver fires the next
    // authoritative layout/viewport-rect.
    void PredictAndApply();

    // Register an occlusion rect (in main-client coords) from React.
    // `id` is a stable handle the React side uses (e.g.
    // "tool-panel:background", "menu:file"). Passing a null rect
    // (w<=0 or h<=0) removes the occlusion for that id. `feather` is
    // the AlphaCompositor smoothstep band width (in physical pixels)
    // at the rect's unclipped edges — 0 for a hard cut, ~padding-px
    // when the React caller padded the rect to absorb a shadow.
    void SetOcclusion(const std::string& id, int x, int y, int w, int h, int feather = 0);
    void RemoveOcclusion(const std::string& id);

private:
    // FD9b: forward all currently-registered occlusions to the
    // compositor, translated to popup-client coords using the current
    // popup origin (m_lastX, m_lastY). Called after Apply /
    // PredictAndApply / RefreshScreenPosition because moving the
    // popup changes the popup-client coord of every occlusion.
    void ReemitOcclusions();

    HWND    m_viewport;
    Engine* m_engine;
    AlphaCompositor* m_compositor = nullptr;
    // Occlusion rects from React (main-client coords). Each id maps
    // to one rect; null/zero-size removes the entry.
    struct Occlusion { int x, y, w, h; int feather; };
    std::unordered_map<std::string, Occlusion> m_occlusions;
    // Track the last applied size so we only fire a (relatively
    // expensive) D3D9 device Reset when the size actually changed.
    int     m_lastW;
    int     m_lastH;
    // FD8: last viewport rect (in main-client coords).
    int     m_lastX = 0;
    int     m_lastY = 0;
    // FD8 polish: main's client size at the last Apply.
    int     m_lastClientW = 0;
    int     m_lastClientH = 0;
};

} // namespace host

#endif // HOST_LAYOUT_BROKER_H
