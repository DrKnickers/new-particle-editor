// LayoutBroker — applies the React-side `layout/viewport-rect` message
// to the D3D9 viewport HWND.
//
// FD8 (May 2026): the viewport is now a top-level WS_POPUP owned by
// the main HWND, not a WS_CHILD. React still reports the viewport
// quadrant rect in main-client coordinates; LayoutBroker converts to
// screen coordinates for SetWindowPos on the popup. The popup is
// composited by DWM as its own layer, above any child HWND including
// WebView2 — that's what makes the viewport visible.
#ifndef HOST_LAYOUT_BROKER_H
#define HOST_LAYOUT_BROKER_H

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

class Engine;

namespace host {

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

private:
    HWND    m_viewport;
    Engine* m_engine;
    // Track the last applied size so we only fire a (relatively
    // expensive) D3D9 device Reset when the size actually changed.
    // Move-only updates (sidebar collapse/expand at fixed viewport size
    // still report new x/y) don't churn the swap chain.
    int     m_lastW;
    int     m_lastH;
    // FD8: cache the last viewport rect (in main-client coords) so
    // RefreshScreenPosition can rebuild the screen-coord rect on
    // owner move.
    int     m_lastX = 0;
    int     m_lastY = 0;
};

} // namespace host

#endif // HOST_LAYOUT_BROKER_H
