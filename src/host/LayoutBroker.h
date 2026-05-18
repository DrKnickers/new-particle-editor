// LayoutBroker — applies the React-side `layout/viewport-rect` message
// to the D3D9 viewport child HWND. Trivial wrapper around SetWindowPos
// + InvalidateRect; lives as its own type so the dispatcher doesn't
// reach into HostWindow internals.
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

    // x/y/w/h are device pixels in the parent window's client coordinates,
    // exactly what React's ViewportSlot sends from getBoundingClientRect.
    // With per-monitor-v2 DPI awareness, child-window coordinates are in
    // physical pixels — we pass through to SetWindowPos.
    //
    // When the viewport's client size actually changes, the Engine's
    // D3D9 swap chain is reset so the backbuffer matches the new HWND
    // size (otherwise the 320×240 initial backbuffer would be stretched
    // and produce upscale blur).
    void Apply(int x, int y, int w, int h);

private:
    HWND    m_viewport;
    Engine* m_engine;
    // Track the last applied size so we only fire a (relatively
    // expensive) D3D9 device Reset when the size actually changed.
    // Move-only updates (sidebar collapse/expand at fixed viewport size
    // still report new x/y) don't churn the swap chain.
    int     m_lastW;
    int     m_lastH;
};

} // namespace host

#endif // HOST_LAYOUT_BROKER_H
