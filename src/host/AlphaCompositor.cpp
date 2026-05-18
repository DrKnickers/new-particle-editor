// AlphaCompositor implementation. See AlphaCompositor.h for the
// high-level pipeline. FD9b.

#include "AlphaCompositor.h"

#include <d3d9.h>
#include <wrl/client.h>

#include <cstdint>
#include <cstdio>
#include <stdexcept>
#include <unordered_map>

namespace host {

namespace {

void ThrowIfFailed(HRESULT hr, const char* what)
{
    if (FAILED(hr))
    {
        char buf[256];
        _snprintf_s(buf, _TRUNCATE,
                    "AlphaCompositor: %s failed hr=0x%08lX", what,
                    static_cast<unsigned long>(hr));
        throw std::runtime_error(buf);
    }
}

struct Occlusion
{
    RECT rect;
    int  feather;
};

} // namespace

struct AlphaCompositor::Impl
{
    Microsoft::WRL::ComPtr<IDirect3DDevice9>  device;
    Microsoft::WRL::ComPtr<IDirect3DSurface9> offscreenRT;   // D3DPOOL_DEFAULT, ARGB
    Microsoft::WRL::ComPtr<IDirect3DSurface9> sysMemSurface; // D3DPOOL_SYSTEMMEM, readback
    HDC      memDC      = nullptr;
    HBITMAP  dibBitmap  = nullptr;
    void*    dibPixels  = nullptr;
    int      width      = 0;
    int      height     = 0;

    std::unordered_map<std::string, Occlusion> occlusions;
};

AlphaCompositor::AlphaCompositor(IDirect3DDevice9* device)
    : m_impl(std::make_unique<Impl>())
{
    if (!device) throw std::invalid_argument("AlphaCompositor: null device");
    m_impl->device = device;
}

AlphaCompositor::~AlphaCompositor()
{
    if (m_impl->dibBitmap) DeleteObject(m_impl->dibBitmap);
    if (m_impl->memDC)     DeleteDC(m_impl->memDC);
}

void AlphaCompositor::Resize(int w, int h)
{
    if (w == m_impl->width && h == m_impl->height) return;
    if (w <= 0 || h <= 0) return;

    // Drop old resources first. ComPtr::Reset releases the COM ref;
    // GDI handles need explicit cleanup.
    m_impl->offscreenRT.Reset();
    m_impl->sysMemSurface.Reset();
    if (m_impl->dibBitmap) { DeleteObject(m_impl->dibBitmap); m_impl->dibBitmap = nullptr; }
    if (m_impl->memDC)     { DeleteDC(m_impl->memDC);         m_impl->memDC     = nullptr; }
    m_impl->dibPixels = nullptr;

    // D3DFMT_A8R8G8B8 because UpdateLayeredWindow needs an alpha
    // channel. D3DMULTISAMPLE_NONE because GetRenderTargetData rejects
    // multisampled source surfaces — the viewport accepts the
    // aliasing here (scene content has its own AA via texturing).
    HRESULT hr = m_impl->device->CreateRenderTarget(
        static_cast<UINT>(w), static_cast<UINT>(h),
        D3DFMT_A8R8G8B8, D3DMULTISAMPLE_NONE, 0,
        FALSE /*lockable*/, &m_impl->offscreenRT, nullptr);
    ThrowIfFailed(hr, "CreateRenderTarget");

    // Readback target. SYSTEMMEM is the only pool that
    // GetRenderTargetData can write to.
    hr = m_impl->device->CreateOffscreenPlainSurface(
        static_cast<UINT>(w), static_cast<UINT>(h),
        D3DFMT_A8R8G8B8, D3DPOOL_SYSTEMMEM,
        &m_impl->sysMemSurface, nullptr);
    ThrowIfFailed(hr, "CreateOffscreenPlainSurface");

    // Top-down DIB (negative biHeight) so row 0 matches D3D9's row 0.
    BITMAPINFO bi = {};
    bi.bmiHeader.biSize        = sizeof(BITMAPINFOHEADER);
    bi.bmiHeader.biWidth       = w;
    bi.bmiHeader.biHeight      = -h;
    bi.bmiHeader.biPlanes      = 1;
    bi.bmiHeader.biBitCount    = 32;
    bi.bmiHeader.biCompression = BI_RGB;

    HDC screenDC = GetDC(nullptr);
    m_impl->dibBitmap = CreateDIBSection(screenDC, &bi, DIB_RGB_COLORS,
                                         &m_impl->dibPixels, nullptr, 0);
    ReleaseDC(nullptr, screenDC);
    if (!m_impl->dibBitmap || !m_impl->dibPixels)
        throw std::runtime_error("AlphaCompositor: CreateDIBSection failed");

    m_impl->memDC = CreateCompatibleDC(nullptr);
    if (!m_impl->memDC) throw std::runtime_error("AlphaCompositor: CreateCompatibleDC failed");
    SelectObject(m_impl->memDC, m_impl->dibBitmap);

    m_impl->width  = w;
    m_impl->height = h;
}
IDirect3DSurface9* AlphaCompositor::GetRenderTarget() const { return m_impl->offscreenRT.Get(); }
void AlphaCompositor::SetOcclusion(std::string /*id*/, RECT /*rectClient*/, int /*feather*/) {}
void AlphaCompositor::RemoveOcclusion(const std::string& /*id*/) {}
void AlphaCompositor::Composite(HWND layeredHwnd)
{
    if (!layeredHwnd) return;
    if (!m_impl->offscreenRT || !m_impl->sysMemSurface || !m_impl->dibBitmap) return;
    if (m_impl->width <= 0 || m_impl->height <= 0) return;

    // GPU → SYSTEMMEM. The actual readback cost (~1-3 ms on modern
    // hardware for a typical viewport size).
    HRESULT hr = m_impl->device->GetRenderTargetData(
        m_impl->offscreenRT.Get(), m_impl->sysMemSurface.Get());
    if (FAILED(hr)) return;

    D3DLOCKED_RECT locked = {};
    hr = m_impl->sysMemSurface->LockRect(&locked, nullptr, D3DLOCK_READONLY);
    if (FAILED(hr)) return;

    // D3DFMT_A8R8G8B8 stores pixels as BB GG RR AA in memory; GDI
    // BI_RGB 32bpp shares that byte order. Direct memcpy works,
    // accounting for the source pitch (locked.Pitch >= w * 4).
    auto*       dst      = static_cast<uint8_t*>(m_impl->dibPixels);
    const auto* src      = static_cast<const uint8_t*>(locked.pBits);
    const int   rowBytes = m_impl->width * 4;
    for (int y = 0; y < m_impl->height; ++y)
    {
        memcpy(dst + y * rowBytes, src + y * locked.Pitch, rowBytes);
    }

    m_impl->sysMemSurface->UnlockRect();

    // Occlusion stamp happens here in T4.

    POINT srcPoint = { 0, 0 };
    SIZE  bmpSize  = { m_impl->width, m_impl->height };
    BLENDFUNCTION blend = {};
    blend.BlendOp             = AC_SRC_OVER;
    blend.BlendFlags          = 0;
    blend.SourceConstantAlpha = 0xFF;
    blend.AlphaFormat         = AC_SRC_ALPHA;

    // pptDst = nullptr → screen position unchanged (LayoutBroker has
    // already SetWindowPos'd the viewport popup).
    UpdateLayeredWindow(layeredHwnd, nullptr /*hdcDst*/,
                        nullptr /*pptDst*/, &bmpSize,
                        m_impl->memDC, &srcPoint,
                        0 /*crKey*/, &blend, ULW_ALPHA);
}

} // namespace host
