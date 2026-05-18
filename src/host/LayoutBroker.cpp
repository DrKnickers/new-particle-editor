#include "LayoutBroker.h"

#include "../engine.h"

namespace host {

void LayoutBroker::Apply(int x, int y, int w, int h)
{
    if (!m_viewport) return;

    // FD8: the viewport is a top-level WS_POPUP owned by main HWND.
    // React's layout/viewport-rect coordinates are in MAIN HWND CLIENT
    // coords; we convert to SCREEN coords for SetWindowPos on the
    // popup. The owner main HWND is obtained from the popup's
    // GetWindow(GW_OWNER).
    HWND owner = GetWindow(m_viewport, GW_OWNER);
    POINT screenPt = { x, y };
    if (owner) ClientToScreen(owner, &screenPt);

    if (w <= 0 || h <= 0)
    {
        // Slot collapsed — move popup off-screen-ish but keep it
        // valid. Don't reset the swap chain for degenerate sizes.
        SetWindowPos(m_viewport, nullptr, screenPt.x, screenPt.y, 1, 1,
                     SWP_NOACTIVATE | SWP_NOZORDER);
        m_lastX = x;
        m_lastY = y;
        m_lastW = 0;
        m_lastH = 0;
        return;
    }

    SetWindowPos(m_viewport, nullptr, screenPt.x, screenPt.y, w, h,
                 SWP_NOACTIVATE | SWP_NOZORDER);
    InvalidateRect(m_viewport, nullptr, FALSE);

    // Reset the D3D9 swap chain so its backbuffer matches the new HWND
    // client size.
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
            // Swallow — Engine::Reset can throw on device-lost.
        }
    }

    m_lastX = x;
    m_lastY = y;
    m_lastW = w;
    m_lastH = h;
}

void LayoutBroker::RefreshScreenPosition()
{
    // FD8: re-apply the last cached client-coord rect, which converts
    // to a fresh screen-coord position based on the OWNER'S current
    // location. Called from HostWindowImpl's WM_MOVE handler when the
    // main window is dragged so the popup follows.
    if (!m_viewport || m_lastW <= 0 || m_lastH <= 0) return;

    HWND owner = GetWindow(m_viewport, GW_OWNER);
    POINT screenPt = { m_lastX, m_lastY };
    if (owner) ClientToScreen(owner, &screenPt);
    SetWindowPos(m_viewport, nullptr, screenPt.x, screenPt.y, m_lastW, m_lastH,
                 SWP_NOACTIVATE | SWP_NOZORDER);
}

} // namespace host
