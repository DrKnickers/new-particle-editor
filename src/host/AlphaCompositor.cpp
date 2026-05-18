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

void AlphaCompositor::Resize(int /*w*/, int /*h*/) {}
IDirect3DSurface9* AlphaCompositor::GetRenderTarget() const { return m_impl->offscreenRT.Get(); }
void AlphaCompositor::SetOcclusion(std::string /*id*/, RECT /*rectClient*/, int /*feather*/) {}
void AlphaCompositor::RemoveOcclusion(const std::string& /*id*/) {}
void AlphaCompositor::Composite(HWND /*layeredHwnd*/) {}

} // namespace host
