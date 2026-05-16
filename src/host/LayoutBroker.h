// LayoutBroker — applies the React-side `layout/viewport-rect` message
// to the D3D9 viewport child HWND. Trivial wrapper around SetWindowPos
// + InvalidateRect; lives as its own type so the dispatcher doesn't
// reach into HostWindow internals.
#ifndef HOST_LAYOUT_BROKER_H
#define HOST_LAYOUT_BROKER_H

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

namespace host {

class LayoutBroker
{
public:
    explicit LayoutBroker(HWND viewport = nullptr) : m_viewport(viewport) {}

    void SetViewport(HWND viewport) { m_viewport = viewport; }

    // x/y/w/h are device pixels in the parent window's client coordinates,
    // exactly what React's ViewportSlot sends from getBoundingClientRect.
    // With per-monitor-v2 DPI awareness, child-window coordinates are in
    // physical pixels — we pass through to SetWindowPos.
    void Apply(int x, int y, int w, int h);

private:
    HWND m_viewport;
};

} // namespace host

#endif // HOST_LAYOUT_BROKER_H
