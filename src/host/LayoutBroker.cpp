#include "LayoutBroker.h"

#include "../engine.h"
#include "AlphaCompositor.h"

namespace host {

void LayoutBroker::SetAlphaCompositor(AlphaCompositor* compositor)
{
    m_compositor = compositor;
    // If we acquired a compositor and already have occlusions cached,
    // replay them so the first paint after attach is correct.
    if (m_compositor) ReemitOcclusions();
}

void LayoutBroker::Apply(int x, int y, int w, int h)
{
    if (!m_viewport) return;

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
        ReemitOcclusions();
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
        bool resetOk = false;
        try
        {
            m_engine->Reset();
            resetOk = true;
        }
        catch (...)
        {
            // Swallow — Engine::Reset can throw on device-lost.
            // The device is now in DEVICENOTRESET. In interactive use
            // Render()'s next-frame guard recovers; in --test-host mode
            // the viewport HWND is hidden so Render() isn't pumped,
            // which would leave the device stuck (HANDOFF Open Items §1
            // pre-2026-05-20). Recover explicitly here so any later
            // bridge call that touches D3D — engine/set/ground-texture
            // is the canonical example — sees a live device.
            resetOk = false;
        }
        if (!resetOk)
        {
            m_engine->RecoverDeviceIfNeeded();
        }
    }

    m_lastX = x;
    m_lastY = y;
    m_lastW = w;
    m_lastH = h;

    if (owner)
    {
        RECT mc{};
        GetClientRect(owner, &mc);
        m_lastClientW = mc.right - mc.left;
        m_lastClientH = mc.bottom - mc.top;
    }

    ReemitOcclusions();
}

void LayoutBroker::PredictAndApply()
{
    if (!m_viewport) return;
    if (m_lastClientW <= 0 || m_lastClientH <= 0) return;

    HWND owner = GetWindow(m_viewport, GW_OWNER);
    if (!owner) return;
    RECT mc{};
    GetClientRect(owner, &mc);
    const int curW = mc.right - mc.left;
    const int curH = mc.bottom - mc.top;
    if (curW <= 0 || curH <= 0) return;

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

    if (newX == m_lastX && newY == m_lastY &&
        newW == m_lastW && newH == m_lastH &&
        curW == m_lastClientW && curH == m_lastClientH)
    {
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

    if (m_engine && sizeChanged)
    {
        try { m_engine->Reset(); } catch (...) {}
    }

    ReemitOcclusions();
}

void LayoutBroker::RefreshScreenPosition()
{
    if (!m_viewport || m_lastW <= 0 || m_lastH <= 0) return;

    HWND owner = GetWindow(m_viewport, GW_OWNER);
    POINT screenPt = { m_lastX, m_lastY };
    if (owner) ClientToScreen(owner, &screenPt);
    SetWindowPos(m_viewport, nullptr, screenPt.x, screenPt.y, m_lastW, m_lastH,
                 SWP_NOACTIVATE | SWP_NOZORDER);

    // Popup origin in main-client coords hasn't changed (m_lastX/Y
    // unchanged), so the popup-client coords of cached occlusions
    // are unchanged either. Skip re-emit.
}

void LayoutBroker::SetOcclusion(const std::string& id, int x, int y, int w, int h, int feather)
{
    if (w <= 0 || h <= 0)
    {
        RemoveOcclusion(id);
        return;
    }
    m_occlusions[id] = { x, y, w, h, feather };

    if (m_compositor && m_lastW > 0 && m_lastH > 0)
    {
        const RECT popupRect = {
            x - m_lastX,
            y - m_lastY,
            x - m_lastX + w,
            y - m_lastY + h
        };
        m_compositor->SetOcclusion(id, popupRect, feather);
    }
}

void LayoutBroker::RemoveOcclusion(const std::string& id)
{
    m_occlusions.erase(id);
    if (m_compositor) m_compositor->RemoveOcclusion(id);
}

void LayoutBroker::SetModalMask(float alpha, int blurRadius)
{
    if (m_compositor) m_compositor->SetModalMask(alpha, blurRadius);
}

bool LayoutBroker::CaptureSnapshotPng(std::string& outBase64, int& outW, int& outH)
{
    if (!m_compositor) return false;
    return m_compositor->CaptureSnapshotPng(outBase64, outW, outH);
}

void LayoutBroker::ReemitOcclusions()
{
    if (!m_compositor) return;
    if (m_lastW <= 0 || m_lastH <= 0)
    {
        // Viewport collapsed — nothing to stamp; clear them so a
        // stale set doesn't persist into the next non-degenerate
        // Apply. The compositor's own per-frame loop is a no-op
        // when the map is empty.
        for (const auto& kv : m_occlusions)
            m_compositor->RemoveOcclusion(kv.first);
        return;
    }

    for (const auto& [id, occ] : m_occlusions)
    {
        const RECT popupRect = {
            occ.x - m_lastX,
            occ.y - m_lastY,
            occ.x - m_lastX + occ.w,
            occ.y - m_lastY + occ.h
        };
        m_compositor->SetOcclusion(id, popupRect, occ.feather);
    }
}

} // namespace host
