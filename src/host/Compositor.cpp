// Compositor — see Compositor.h for the design overview.
//
// Most of this file is a port of src/host/spike/dxgi_spike.cpp's
// InitDComp + BuildVisualTree + Shutdown sections (the working
// Stage 0 spike on user's RTX 3080). The spike topology is
// preserved exactly; only the wrapping changes (LogFn callback
// instead of LogDbg, ComPtr members on a pImpl struct, idempotency
// guards).
//
// IMPORTANT — translation-unit isolation. This .cpp is the ONLY
// place dcomp.h / d3d11.h / dxgi1_2.h are included in the
// ParticleEditor binary. ParticleEditor.vcxproj's project-level
// AdditionalIncludeDirectories puts $(DXSDK_DIR)Include first so
// the engine can find DXSDK June 2010's d3dx9.h, but DXSDK also
// has stale DXGI.h / D3D11.h / Dcommon.h that predate Direct2D 1.1
// and DirectComposition. If those are included BEFORE the Win10
// SDK versions, the modern types (D2D_VECTOR_2F,
// DXGI_COLOR_SPACE_TYPE, etc.) come up undeclared and dcomp.h hits
// syntax errors. The per-file <AdditionalIncludeDirectories> on
// this Compositor.cpp entry in the vcxproj REPLACES (not appends
// to) the project default with a Win10-SDK-only path, so dxgi.h /
// d3d11.h / dcommon.h / d2d1_1.h all resolve to the modern Win10
// SDK versions. dcomp.h then has the types it needs.
//
// Consumers of Compositor.h (HostWindow.cpp in Stage 3b) don't pay
// this cost — Compositor.h's pImpl hides every DComp type behind
// `struct Impl`, so HostWindow.cpp's translation unit never sees
// dcomp.h. HostWindow.cpp keeps the project's DXSDK-first include
// path unchanged and the engine still finds d3dx9.h normally.

#define _WIN32_WINNT 0x0A00
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wrl.h>

// Include order mirrors dxgi_spike.cpp. dcomp.h transitively
// references DXGI types (DXGI_COLOR_SPACE_TYPE, IDXGI* interfaces)
// that must be declared first via <d3d11.h> + <dxgi1_2.h>.
#include <d3d11.h>
#include <dxgi1_2.h>

// D2D_USE_C_DEFINITIONS — opt out of d2d1's inline C++ helper
// classes (D2D1::Matrix3x2F, Matrix4x3F, Matrix4x4F, etc.).
// dcomp.h transitively pulls in <d2d1_1helper.h>, whose
// helper-class constructors reference struct member names like
// _11/_12/_13. We don't use the C++ helpers — only the plain C
// struct types like D2D_RECT_F for SetClip — so skipping them
// avoids any helper-related parse work that depends on Win10 SDK
// header layout being clean.
#ifndef D2D_USE_C_DEFINITIONS
#define D2D_USE_C_DEFINITIONS
#endif

#include <dcomp.h>

#include "WebView2.h"

#include "Compositor.h"

#pragma comment(lib, "dcomp.lib")

#include <cstdio>

namespace host {

namespace {

// Format an HRESULT into a string for logging. Matches the format
// spike uses ([SPIKE-ERROR] ... hr=0x%08lX).
std::string FormatHresult(HRESULT hr)
{
    char buf[32];
    snprintf(buf, sizeof(buf), "0x%08lX", static_cast<unsigned long>(hr));
    return std::string(buf);
}

} // namespace

// pImpl — keeps every DComp / WebView2 ComPtr off the public header
// surface so consumers (HostWindow.cpp) don't have to pull in
// dcomp.h. Also keeps the dxgi.h / d2d1.h transitive includes
// scoped to this single translation unit.
struct Compositor::Impl
{
    HWND  hwnd;
    Compositor::LogFn log;

    Microsoft::WRL::ComPtr<IDCompositionDevice>  device;
    Microsoft::WRL::ComPtr<IDCompositionTarget>  target;
    Microsoft::WRL::ComPtr<IDCompositionVisual>  rootVisual;
    Microsoft::WRL::ComPtr<IDCompositionVisual>  webviewVisual;

    // The WebView2 composition controller that owns the
    // RootVisualTarget binding. Retained so the dtor can clear the
    // binding (put_RootVisualTarget(nullptr)) before releasing the
    // visual; without this the WebView2 internal reference to
    // webviewVisual would dangle. Set by AttachWebView2.
    Microsoft::WRL::ComPtr<ICoreWebView2CompositionController> controller;

    int  lastW = 0;
    int  lastH = 0;
    bool treeBuilt = false;

    void LogLine(const std::string& s) const
    {
        if (log) log(s);
    }
};

Compositor::Compositor(HWND hostHwnd, LogFn log) noexcept
    : m_impl(std::make_unique<Impl>())
{
    m_impl->hwnd = hostHwnd;
    m_impl->log  = std::move(log);
}

Compositor::~Compositor()
{
    // Spike's Shutdown order, lines 783-818. WebView2 controller
    // teardown is the CALLER's responsibility (HostWindow.cpp
    // WM_DESTROY); we trust that's already done by the time we get
    // here. Belt-and-suspenders: clear put_RootVisualTarget anyway
    // so a misordered teardown doesn't crash.
    if (m_impl && m_impl->controller && m_impl->webviewVisual)
    {
        m_impl->controller->put_RootVisualTarget(nullptr);
    }
    // ~unique_ptr<Impl>() releases the Impl, which releases each
    // ComPtr in the documented order (member declaration order
    // reversed): controller, webviewVisual, rootVisual, target,
    // device. Matches the spike's Shutdown sequence.
    if (m_impl) m_impl->LogLine("[COMP] dtor complete");
}

HRESULT Compositor::Init()
{
    if (m_impl->device)
    {
        m_impl->LogLine("[COMP] Init: already up, no-op");
        return S_OK;
    }

    // V2 factory function, V1 IID — same shape as WebView2APISample
    // and dxgi_spike.cpp:InitDComp. FD6 v2 tried V2
    // IDCompositionDesktopDevice and still produced white; v3
    // reverted to V1. The spike confirmed V1 works on this rig.
    HRESULT hr = DCompositionCreateDevice2(
        nullptr, IID_PPV_ARGS(m_impl->device.GetAddressOf()));
    if (FAILED(hr) || !m_impl->device)
    {
        m_impl->LogLine("[COMP-fail] DCompositionCreateDevice2 hr=" + FormatHresult(hr));
        return hr;
    }
    m_impl->LogLine("[COMP-init] DComp V1 device created");
    return S_OK;
}

HRESULT Compositor::AttachWebView2(ICoreWebView2CompositionController* ctl)
{
    if (!ctl)
    {
        m_impl->LogLine("[COMP-fail] AttachWebView2 called with null controller");
        return E_POINTER;
    }
    if (m_impl->treeBuilt)
    {
        m_impl->LogLine("[COMP] AttachWebView2: tree already built, no-op");
        return S_OK;
    }
    if (!m_impl->device)
    {
        m_impl->LogLine("[COMP-fail] AttachWebView2 before Init");
        return E_NOT_VALID_STATE;
    }
    HRESULT hr;

    // Create the target. Topmost=TRUE matches spike line 440 +
    // sample line 919. FD6 v1 tried both TRUE and FALSE; topmost
    // wasn't the failure mode but matches the working sample.
    hr = m_impl->device->CreateTargetForHwnd(
        m_impl->hwnd, TRUE, m_impl->target.GetAddressOf());
    if (FAILED(hr))
    {
        m_impl->LogLine("[COMP-fail] CreateTargetForHwnd hr=" + FormatHresult(hr));
        return hr;
    }

    // Root visual.
    hr = m_impl->device->CreateVisual(m_impl->rootVisual.GetAddressOf());
    if (FAILED(hr))
    {
        m_impl->LogLine("[COMP-fail] CreateVisual(root) hr=" + FormatHresult(hr));
        return hr;
    }
    hr = m_impl->target->SetRoot(m_impl->rootVisual.Get());
    if (FAILED(hr))
    {
        m_impl->LogLine("[COMP-fail] SetRoot hr=" + FormatHresult(hr));
        return hr;
    }

    // WebView2 visual. Spike adds the engine visual FIRST (so the
    // WebView2 added below renders ABOVE it via list-order). Stage 3
    // has no engine visual yet — only the WebView2. Stage 4 will
    // insert the engine visual BEFORE this one so the z-order stays
    // engine-behind-WebView2 (which is what we want — chrome on top,
    // viewport pixels showing through transparent DOM regions).
    hr = m_impl->device->CreateVisual(m_impl->webviewVisual.GetAddressOf());
    if (FAILED(hr))
    {
        m_impl->LogLine("[COMP-fail] CreateVisual(webview) hr=" + FormatHresult(hr));
        return hr;
    }

    // AddVisual with insertAbove=FALSE + referenceVisual=nullptr puts
    // this visual at the END of the children list, which DComp
    // renders LAST — in front of all siblings (DComp draws children
    // list-order, last-drawn-on-top). The MSDN naming is
    // counterintuitive: "insertAbove=TRUE + NULL ref" actually means
    // "behind all," NOT "above all." Bisected via the spike's
    // --no-engine smoke mode; see dxgi_spike.cpp:489-494 for the
    // long-form comment.
    hr = m_impl->rootVisual->AddVisual(m_impl->webviewVisual.Get(), FALSE, nullptr);
    if (FAILED(hr))
    {
        m_impl->LogLine("[COMP-fail] root->AddVisual(webview) hr=" + FormatHresult(hr));
        return hr;
    }

    // Plug WebView2's surface into the visual. This is the
    // load-bearing call — if put_RootVisualTarget returns S_OK and
    // the tree still produces opaque white, we are in FD6
    // territory.
    hr = ctl->put_RootVisualTarget(m_impl->webviewVisual.Get());
    if (FAILED(hr))
    {
        m_impl->LogLine("[COMP-fail] put_RootVisualTarget hr=" + FormatHresult(hr));
        return hr;
    }
    m_impl->controller = ctl;
    m_impl->LogLine("[COMP-attach] webview visual attached (RootVisualTarget set)");

    hr = m_impl->device->Commit();
    if (FAILED(hr))
    {
        m_impl->LogLine("[COMP-fail] Commit hr=" + FormatHresult(hr));
        return hr;
    }

    m_impl->treeBuilt = true;
    m_impl->LogLine("[COMP-tree] tree committed (Stage 3: webview-only)");
    return S_OK;
}

HRESULT Compositor::SetSize(int width, int height)
{
    if (!m_impl->device || !m_impl->rootVisual)
    {
        return E_NOT_VALID_STATE;
    }
    if (width == m_impl->lastW && height == m_impl->lastH)
    {
        return S_OK;
    }
    m_impl->lastW = width;
    m_impl->lastH = height;

    // Root visual offset + clip. Stage 3 anchors the WebView2
    // visual at (0,0) covering the full host client; SetOffsetX/Y
    // at zero is the no-op default but documented here for Stage 4
    // (which will offset the engine visual by the scene-rect
    // origin).
    HRESULT hr = m_impl->rootVisual->SetOffsetX(0.0f);
    if (FAILED(hr))
    {
        m_impl->LogLine("[COMP-fail] SetOffsetX hr=" + FormatHresult(hr));
        return hr;
    }
    hr = m_impl->rootVisual->SetOffsetY(0.0f);
    if (FAILED(hr))
    {
        m_impl->LogLine("[COMP-fail] SetOffsetY hr=" + FormatHresult(hr));
        return hr;
    }

    D2D_RECT_F clip = { 0.0f, 0.0f,
                        static_cast<float>(width),
                        static_cast<float>(height) };
    hr = m_impl->rootVisual->SetClip(clip);
    if (FAILED(hr))
    {
        m_impl->LogLine("[COMP-fail] SetClip hr=" + FormatHresult(hr));
        return hr;
    }

    hr = m_impl->device->Commit();
    if (FAILED(hr))
    {
        m_impl->LogLine("[COMP-fail] SetSize Commit hr=" + FormatHresult(hr));
        return hr;
    }
    return S_OK;
}

HRESULT Compositor::Commit()
{
    if (!m_impl->device)
    {
        return E_NOT_VALID_STATE;
    }
    return m_impl->device->Commit();
}

// ---------- [MT-11] Phase 3 Stage 4 — engine visual stubs ----------
// 4a: declarations exist on the public surface (see Compositor.h's
// engine-visual block); these bodies are no-ops returning the
// documented "not yet attached" / "no-op success" status codes so
// callers can wire their per-frame and OnCompositionControllerReady
// call sites against the real signatures without behavioral effect.
// 4b/4c/4d ship the real D3D11 device + DXGI swapchain + DComp
// engine visual + per-frame composite + lazy handle re-open.

HRESULT Compositor::AttachEngineVisual(HANDLE sharedTexture,
                                       int    w,
                                       int    h) noexcept
{
    (void)sharedTexture;
    (void)w;
    (void)h;
    if (m_impl) m_impl->LogLine("[COMP-engine-init] AttachEngineVisual stub (4a — no D3D11 device yet)");
    return S_OK;
}

HRESULT Compositor::CompositeEngineFrame() noexcept
{
    // 4a: no engine visual attached → return S_FALSE per the documented
    // contract (S_OK = composited, S_FALSE = no engine visual). Host's
    // per-frame loop will treat S_FALSE as "skip the composite step
    // this frame." Real implementation lands in 4c.
    return S_FALSE;
}

HRESULT Compositor::RefreshEngineSharedHandle(HANDLE sharedTexture,
                                              int    w,
                                              int    h) noexcept
{
    (void)sharedTexture;
    (void)w;
    (void)h;
    // 4a: no D3D11 alias to refresh. The lazy detection in
    // CompositeEngineFrame is the primary path under D4; this method
    // gets a real implementation in 4d alongside resize-robustness
    // work + the 50-resize stress smoke.
    return S_OK;
}

// ---------------------------------------------------------------

bool Compositor::IsReady() const noexcept
{
    return m_impl && m_impl->treeBuilt;
}

HWND Compositor::HostHwnd() const noexcept
{
    return m_impl ? m_impl->hwnd : nullptr;
}

} // namespace host
