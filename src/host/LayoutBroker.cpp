#include "LayoutBroker.h"

#include "../engine.h"

namespace host {

void LayoutBroker::Apply(int x, int y, int w, int h)
{
    if (!m_viewport) return;

    // FD8: the viewport is a top-level WS_POPUP owned by main HWND.
    // React's coords are in main-client; convert to screen for the
    // popup via ClientToScreen(owner, …).
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
        RebuildPopupRegion();
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

    // Cache main client size at this Apply so PredictAndApply can
    // derive constant L/T/R/B offsets later.
    if (owner)
    {
        RECT mc{};
        GetClientRect(owner, &mc);
        m_lastClientW = mc.right - mc.left;
        m_lastClientH = mc.bottom - mc.top;
    }

    RebuildPopupRegion();
}

void LayoutBroker::PredictAndApply()
{
    if (!m_viewport) return;
    if (m_lastClientW <= 0 || m_lastClientH <= 0) return;  // nothing cached yet

    HWND owner = GetWindow(m_viewport, GW_OWNER);
    if (!owner) return;
    RECT mc{};
    GetClientRect(owner, &mc);
    const int curW = mc.right - mc.left;
    const int curH = mc.bottom - mc.top;
    if (curW <= 0 || curH <= 0) return;

    // Constant edge offsets derived from the cached state.
    const int leftOff   = m_lastX;
    const int topOff    = m_lastY;
    const int rightOff  = m_lastClientW - (m_lastX + m_lastW);
    const int bottomOff = m_lastClientH - (m_lastY + m_lastH);

    int newX = leftOff;
    int newY = topOff;
    int newW = curW - leftOff - rightOff;
    int newH = curH - topOff - bottomOff;
    if (newW < 1) newW = 1;
    if (newH < 1) newH = 1;

    // No-op when nothing actually changed — avoid Engine::Reset spam
    // (WM_WINDOWPOSCHANGED fires on every focus / activate / move
    // too, not just real resizes).
    if (newX == m_lastX && newY == m_lastY &&
        newW == m_lastW && newH == m_lastH &&
        curW == m_lastClientW && curH == m_lastClientH)
    {
        // Just refresh screen position in case owner moved.
        RefreshScreenPosition();
        return;
    }

    POINT screenPt = { newX, newY };
    ClientToScreen(owner, &screenPt);

    SetWindowPos(m_viewport, nullptr, screenPt.x, screenPt.y, newW, newH,
                 SWP_NOACTIVATE | SWP_NOZORDER);

    const bool sizeChanged = (newW != m_lastW || newH != m_lastH);

    m_lastX = newX;
    m_lastY = newY;
    m_lastW = newW;
    m_lastH = newH;
    m_lastClientW = curW;
    m_lastClientH = curH;

    // Only Reset the D3D9 swap chain when SIZE actually changed —
    // pure moves don't need it and Reset is expensive.
    if (m_engine && sizeChanged)
    {
        try { m_engine->Reset(); } catch (...) {}
    }

    RebuildPopupRegion();
}

void LayoutBroker::RefreshScreenPosition()
{
    if (!m_viewport || m_lastW <= 0 || m_lastH <= 0) return;

    HWND owner = GetWindow(m_viewport, GW_OWNER);
    POINT screenPt = { m_lastX, m_lastY };
    if (owner) ClientToScreen(owner, &screenPt);
    SetWindowPos(m_viewport, nullptr, screenPt.x, screenPt.y, m_lastW, m_lastH,
                 SWP_NOACTIVATE | SWP_NOZORDER);

    RebuildPopupRegion();
}

void LayoutBroker::SetOcclusion(const std::string& id, int x, int y, int w, int h)
{
    if (w <= 0 || h <= 0)
    {
        RemoveOcclusion(id);
        return;
    }
    m_occlusions[id] = { x, y, w, h };
    RebuildPopupRegion();
}

void LayoutBroker::RemoveOcclusion(const std::string& id)
{
    if (m_occlusions.erase(id) > 0)
        RebuildPopupRegion();
}

void LayoutBroker::RebuildPopupRegion()
{
    if (!m_viewport) return;
    if (m_lastW <= 0 || m_lastH <= 0)
    {
        // Viewport collapsed — no popup region needed.
        SetWindowRgn(m_viewport, nullptr, TRUE);
        return;
    }

    // Region in popup-CLIENT coords. Popup-client origin is (0,0) at
    // the popup's top-left; React's occlusion rects are in main-client
    // coords. The popup itself is positioned at (m_lastX, m_lastY) in
    // main-client coords. So:
    //   holeX_popup = occlusionX_mainClient - m_lastX
    //   holeY_popup = occlusionY_mainClient - m_lastY
    HRGN full = CreateRectRgn(0, 0, m_lastW, m_lastH);
    if (!full) return;

    for (const auto& [id, occ] : m_occlusions)
    {
        int hx = occ.x - m_lastX;
        int hy = occ.y - m_lastY;
        int hr = hx + occ.w;
        int hb = hy + occ.h;
        // Clip to popup bounds (CombineRgn would tolerate
        // out-of-range, but a clean clip avoids accidentally creating
        // a region with negative dims).
        if (hr <= 0 || hb <= 0 || hx >= m_lastW || hy >= m_lastH) continue;
        if (hx < 0) hx = 0;
        if (hy < 0) hy = 0;
        if (hr > m_lastW) hr = m_lastW;
        if (hb > m_lastH) hb = m_lastH;

        HRGN hole = CreateRectRgn(hx, hy, hr, hb);
        if (hole)
        {
            CombineRgn(full, full, hole, RGN_DIFF);
            DeleteObject(hole);
        }
    }

    // SetWindowRgn takes ownership of the region on success.
    if (!SetWindowRgn(m_viewport, full, TRUE))
        DeleteObject(full);
}

} // namespace host
