#include "LayoutBroker.h"

#include "../engine.h"
#include "AlphaCompositor.h"
#include "Compositor.h"

namespace host {

void LayoutBroker::SetAlphaCompositor(AlphaCompositor* compositor)
{
    m_alphaCompositor = compositor;
    // If we acquired a compositor and already have occlusions cached,
    // replay them so the first paint after attach is correct.
    if (m_alphaCompositor) ReemitOcclusions();
}

void LayoutBroker::SetCompositor(Compositor* compositor)
{
    m_dcompCompositor = compositor;
    // Replay the cached scene-rect onto the newly-attached compositor
    // so the first frame post-attach is sized correctly — avoids a
    // 1-3 frame full-client glitch before React's first
    // layout/scene-rect dispatch arrives (sub-plan §3.5).
    //
    // T2 lands the setter; T4 extends ReemitOcclusions to actually
    // exercise Compositor::SetEngineVisualTransform (and Engine::
    // SetSceneViewport via the Compositor-gated path). Until T4 lands
    // this call is a no-op for the new Compositor path — the existing
    // AlphaCompositor replay continues to work unchanged.
    if (m_dcompCompositor) ReemitOcclusions();
}

bool LayoutBroker::GetSceneRect(int& x, int& y, int& w, int& h) const
{
    if (m_sceneW <= 0 || m_sceneH <= 0) return false;
    x = m_sceneX;
    y = m_sceneY;
    w = m_sceneW;
    h = m_sceneH;
    return true;
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

void LayoutBroker::ApplyFullClient()
{
    if (!m_viewport) return;
    HWND owner = GetWindow(m_viewport, GW_OWNER);
    if (!owner) return;
    RECT rc{};
    if (!GetClientRect(owner, &rc)) return;
    const int w = rc.right - rc.left;
    const int h = rc.bottom - rc.top;
    if (w <= 0 || h <= 0) return;
    Apply(0, 0, w, h);
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

    if (m_alphaCompositor && m_lastW > 0 && m_lastH > 0)
    {
        const RECT popupRect = {
            x - m_lastX,
            y - m_lastY,
            x - m_lastX + w,
            y - m_lastY + h
        };
        m_alphaCompositor->SetOcclusion(id, popupRect, feather);
    }
}

void LayoutBroker::RemoveOcclusion(const std::string& id)
{
    m_occlusions.erase(id);
    if (m_alphaCompositor) m_alphaCompositor->RemoveOcclusion(id);
}

void LayoutBroker::SetSceneRect(int x, int y, int w, int h)
{
    if (w <= 0 || h <= 0)
    {
        // Clear → disable compositor mask. Used when React hasn't
        // dispatched a scene rect yet, or when the centre quadrant
        // collapses.
        m_sceneX = m_sceneY = m_sceneW = m_sceneH = 0;
        if (m_alphaCompositor) m_alphaCompositor->SetSceneRect(0, 0, 0, 0);
        return;
    }
    m_sceneX = x;
    m_sceneY = y;
    m_sceneW = w;
    m_sceneH = h;

    if (m_alphaCompositor && m_lastW > 0 && m_lastH > 0)
    {
        // Translate main-client coords to popup-client. Same
        // arithmetic as SetOcclusion above.
        m_alphaCompositor->SetSceneRect(x - m_lastX, y - m_lastY, w, h);
    }
}

bool LayoutBroker::CaptureSnapshotPng(std::string& outBase64, int& outW, int& outH)
{
    if (!m_alphaCompositor) return false;
    return m_alphaCompositor->CaptureSnapshotPng(outBase64, outW, outH);
}

void LayoutBroker::ReemitOcclusions()
{
    if (!m_alphaCompositor) return;
    if (m_lastW <= 0 || m_lastH <= 0)
    {
        // Viewport collapsed — nothing to stamp; clear everything so
        // a stale set doesn't persist into the next non-degenerate
        // Apply. The compositor's own per-frame loop is a no-op when
        // the occlusion map is empty and the scene rect is zero.
        for (const auto& kv : m_occlusions)
            m_alphaCompositor->RemoveOcclusion(kv.first);
        m_alphaCompositor->SetSceneRect(0, 0, 0, 0);
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
        m_alphaCompositor->SetOcclusion(id, popupRect, occ.feather);
    }

    // B1.4 T4c: re-stamp the scene rect with a fresh translation
    // whenever the popup origin changes. If the React side hasn't
    // dispatched a scene rect yet (m_sceneW == 0), forward zeros to
    // keep the compositor mask disabled.
    if (m_sceneW > 0 && m_sceneH > 0)
    {
        m_alphaCompositor->SetSceneRect(
            m_sceneX - m_lastX, m_sceneY - m_lastY, m_sceneW, m_sceneH);
    }
    else
    {
        m_alphaCompositor->SetSceneRect(0, 0, 0, 0);
    }
}

} // namespace host
