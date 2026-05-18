#include "LayoutBroker.h"

#include "../engine.h"

namespace host {

void LayoutBroker::Apply(int x, int y, int w, int h)
{
    if (!m_viewport) return;

    if (w <= 0 || h <= 0)
    {
        // Slot collapsed (e.g. sidebar fully expanded over viewport).
        // Move the viewport off-screen-ish but keep it valid so the next
        // non-degenerate rect re-shows it cleanly. Don't reset the
        // swap chain here — degenerate sizes would just throw.
        SetWindowPos(m_viewport, nullptr, x, y, 1, 1,
                     SWP_NOACTIVATE | SWP_NOZORDER);
        m_lastX = x;
        m_lastY = y;
        m_lastW = 0;
        m_lastH = 0;
        RefreshWebViewRegion();  // clear the cut-out
        return;
    }

    SetWindowPos(m_viewport, nullptr, x, y, w, h, SWP_NOACTIVATE | SWP_NOZORDER);
    InvalidateRect(m_viewport, nullptr, FALSE);

    // Reset the D3D9 swap chain so its backbuffer matches the new HWND
    // client size — otherwise the initial 320×240 backbuffer gets
    // stretched, producing blur on a larger / high-DPI viewport.
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
            // Swallow here — the next layout/viewport-rect will retry.
        }
    }

    m_lastX = x;
    m_lastY = y;
    m_lastW = w;
    m_lastH = h;

    // FD7 Option C: punch a hole in WebView2's HWND region over the
    // viewport rect so the D3D9 viewport sibling underneath shows
    // through. WebView2 stops painting in the hole; the parent main
    // HWND's child-window painting (the viewport HWND) fills the gap.
    RefreshWebViewRegion();
}

void LayoutBroker::RefreshWebViewRegion()
{
    if (!m_webView) return;

    RECT webRc;
    if (!GetClientRect(m_webView, &webRc)) return;
    const int webW = webRc.right - webRc.left;
    const int webH = webRc.bottom - webRc.top;
    if (webW <= 0 || webH <= 0) return;

    // Build "full WebView2 client" minus "viewport rect", in WebView2's
    // own client coordinates. The viewport rect (m_lastX, m_lastY, …)
    // is in main HWND's client coords; if the WebView2 fills the main
    // HWND's client area (it does — put_Bounds is set to the full
    // client rect), then main-client coords and WebView2-client coords
    // coincide modulo any non-zero WebView2 offset within main. We
    // don't translate further: WebView2's HWND is positioned at (0,0)
    // of main's client by put_Bounds.

    HRGN hFull = CreateRectRgn(0, 0, webW, webH);
    if (!hFull) return;

    if (m_lastW > 0 && m_lastH > 0)
    {
        HRGN hHole = CreateRectRgn(m_lastX, m_lastY,
                                   m_lastX + m_lastW,
                                   m_lastY + m_lastH);
        if (hHole)
        {
            CombineRgn(hFull, hFull, hHole, RGN_DIFF);
            DeleteObject(hHole);
        }
    }

    // SetWindowRgn takes ownership of hFull on success. On failure we
    // delete it ourselves. Pass bRedraw=TRUE so WebView2's surface
    // repaints with the new shape this frame.
    if (!SetWindowRgn(m_webView, hFull, TRUE))
    {
        DeleteObject(hFull);
    }
}

} // namespace host
