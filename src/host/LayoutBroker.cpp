#include "LayoutBroker.h"

#include "../engine.h"

namespace host {

void LayoutBroker::Apply(int x, int y, int w, int h)
{
    if (!m_viewport) return;

    // SWP_NOZORDER is critical: passing HWND_TOP without it would
    // re-promote the viewport above its WebView2 sibling on every
    // layout update, undoing the natural sibling z-order that puts
    // WebView2 on top (so opaque HTML — menus, modals — covers the
    // viewport). See HostWindow.cpp WM_CREATE for the rationale.

    if (w <= 0 || h <= 0)
    {
        // Slot collapsed (e.g. sidebar fully expanded over viewport).
        // Move the viewport off-screen-ish but keep it valid so the next
        // non-degenerate rect re-shows it cleanly. Don't reset the
        // swap chain here — degenerate sizes would just throw.
        SetWindowPos(m_viewport, nullptr, x, y, 1, 1,
                     SWP_NOACTIVATE | SWP_NOZORDER);
        return;
    }

    SetWindowPos(m_viewport, nullptr, x, y, w, h, SWP_NOACTIVATE | SWP_NOZORDER);
    InvalidateRect(m_viewport, nullptr, FALSE);

    // Reset the D3D9 swap chain so its backbuffer matches the new HWND
    // client size — otherwise the initial 320×240 backbuffer gets
    // stretched, producing blur on a larger / high-DPI viewport.
    //
    // Engine::Reset() reads the new client size off m_presentationParameters.hDeviceWindow
    // (BackBufferWidth/Height set to 0 → D3D9 auto-derives from the
    // hDeviceWindow client rect, which is our viewport HWND that we
    // just resized via SetWindowPos). It also releases/recreates all
    // D3DPOOL_DEFAULT resources (scene RT, distortion RT, depth-stencil,
    // bloom ping/pong) — same code path the legacy WM_SIZE handler uses
    // at src/main.cpp WM_SIZE.
    //
    // Debounce by tracking the last applied size: ResizeObserver can
    // fire move-only updates that shouldn't churn the device.
    if (m_engine && (w != m_lastW || h != m_lastH))
    {
        m_lastW = w;
        m_lastH = h;
        try
        {
            m_engine->Reset();
        }
        catch (...)
        {
            // Engine::Reset can throw on device-lost / out-of-memory.
            // Swallow here — the next layout/viewport-rect will retry,
            // and Engine state is left in whatever consistent state
            // Reset reached before the throw.
        }
    }
}

} // namespace host
