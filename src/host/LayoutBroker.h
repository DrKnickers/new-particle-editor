// LayoutBroker — applies the React-side `layout/viewport-rect` message
// to the D3D9 viewport HWND.
//
// FD8 (May 2026): the viewport is now a top-level WS_POPUP owned by
// the main HWND, not a WS_CHILD. React still reports the viewport
// quadrant rect in main-client coordinates; LayoutBroker converts to
// screen coordinates for SetWindowPos on the popup. The popup is
// composited by DWM as its own layer, above any child HWND including
// WebView2 — that's what makes the viewport visible.
//
// FD8 follow-up: also accepts `viewport/occlude` updates from React
// to punch holes in the POPUP's window region wherever chrome HTML
// (menus, tool panels, dialogs) overlaps the viewport rect. With
// holes in the popup, the HTML pixels behind it become visible.
#ifndef HOST_LAYOUT_BROKER_H
#define HOST_LAYOUT_BROKER_H

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <string>
#include <unordered_map>

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

    // FD8 polish: predict the viewport rect from main's CURRENT client
    // size + the layout offsets cached at the last Apply. Used by
    // HostWindow's WM_SIZE handler so the popup tracks main's resize
    // synchronously, before React's ResizeObserver fires the next
    // authoritative layout/viewport-rect. Without this, the popup
    // stays at its cached size during resize and exposes a strip of
    // the parent HWND brush along the bottom/right edge.
    //
    // The layout offsets (distance from main client's L/T/R/B edges
    // to the viewport quadrant edges) are cached at every Apply().
    // Predicted rect = (leftOff, topOff,
    //                    newClientW - leftOff - rightOff,
    //                    newClientH - topOff - bottomOff). React's
    // App.tsx layout is currently flex-based with a fixed left
    // sidebar, header, status bar, and track editor — so these
    // offsets remain constant under window resize.
    void PredictAndApply();

    // FD8 follow-up: register an occlusion rect (in main-client
    // coords) from React. `id` is a stable handle the React side
    // uses to refer to its own occluding component
    // (e.g. "tool-panel:background", "menu:file"). Passing a null
    // rect (w<=0 or h<=0) removes the occlusion for that id.
    // Triggers a popup region rebuild.
    void SetOcclusion(const std::string& id, int x, int y, int w, int h);
    void RemoveOcclusion(const std::string& id);

private:
    // FD8 follow-up: rebuild the popup window region from the cached
    // viewport rect + current occlusion map. Called from Apply,
    // RefreshScreenPosition, SetOcclusion, RemoveOcclusion.
    void RebuildPopupRegion();

    HWND    m_viewport;
    Engine* m_engine;
    // Occlusion rects from React (main-client coords). Each id maps
    // to one rect; null/zero-size removes the entry. Order doesn't
    // matter — we union them all to build the popup region.
    struct Occlusion { int x, y, w, h; };
    std::unordered_map<std::string, Occlusion> m_occlusions;
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
    // FD8 polish: cache main's client size at the moment of the last
    // Apply, so PredictAndApply can derive the edge-offsets (L/T/R/B)
    // and reapply them against the new client size on WM_SIZE.
    int     m_lastClientW = 0;
    int     m_lastClientH = 0;
};

} // namespace host

#endif // HOST_LAYOUT_BROKER_H
