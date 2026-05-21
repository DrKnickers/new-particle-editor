// AlphaCompositor implementation. See AlphaCompositor.h for the
// high-level pipeline. FD9b.

#include "AlphaCompositor.h"

#include <d3d9.h>
#include <wrl/client.h>

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <stdexcept>
#include <unordered_map>
#include <vector>

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

    // B1.3.1 modal mask. Identity values (1.0f, 0) skip the post-
    // process entirely so the per-frame cost is zero when no modal is
    // open.
    float    globalAlpha = 1.0f;
    int      blurRadius  = 0;
    // Scratch buffer for the separable box-blur. Lazily allocated to
    // the DIB's pixel-count when blur becomes active, never freed
    // until destruction — modal toggle is interactive, so the
    // alloc-once approach avoids GC churn during open/close cycles.
    std::vector<uint8_t> blurScratch;
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
void AlphaCompositor::ReleaseGpuResources()
{
    m_impl->offscreenRT.Reset();
    m_impl->sysMemSurface.Reset();
    if (m_impl->dibBitmap) { DeleteObject(m_impl->dibBitmap); m_impl->dibBitmap = nullptr; }
    if (m_impl->memDC)     { DeleteDC(m_impl->memDC);         m_impl->memDC     = nullptr; }
    m_impl->dibPixels = nullptr;
    // Clear cached size so the next Resize doesn't short-circuit on
    // "(w,h) unchanged" — width and height stay 0 until the next
    // successful allocation.
    m_impl->width  = 0;
    m_impl->height = 0;
}

IDirect3DSurface9* AlphaCompositor::GetRenderTarget() const { return m_impl->offscreenRT.Get(); }
void AlphaCompositor::SetOcclusion(std::string id, RECT rectClient, int feather)
{
    if (feather < 0) feather = 0;
    m_impl->occlusions[std::move(id)] = Occlusion{ rectClient, feather };
}

void AlphaCompositor::RemoveOcclusion(const std::string& id)
{
    m_impl->occlusions.erase(id);
}

void AlphaCompositor::SetModalMask(float alpha, int blurRadius)
{
    if (alpha < 0.0f) alpha = 0.0f;
    if (alpha > 1.0f) alpha = 1.0f;
    if (blurRadius < 0)  blurRadius = 0;
    if (blurRadius > 32) blurRadius = 32; // hard cap; larger is a perf cliff
    m_impl->globalAlpha = alpha;
    m_impl->blurRadius  = blurRadius;
}

namespace {

// smoothstep(0, w, x) — classic cubic, clamped.
inline float smoothstep01(float x)
{
    if (x <= 0.0f) return 0.0f;
    if (x >= 1.0f) return 1.0f;
    return x * x * (3.0f - 2.0f * x);
}

// Apply a single occlusion to the DIB. Pixels strictly inside the
// rect, beyond the `feather` inset, are zeroed (RGBA = 0). Pixels
// in the `feather` band along the inner edge get RGBA *= weight,
// where weight ramps from 0 (deepest inside) to 1 (at the rect's
// outer edge), so alpha falls off smoothly and the premultiplied
// RGB matches the new alpha. Pixels outside the rect are untouched.
void ApplyOcclusion(uint8_t* dib, int dibW, int dibH,
                    const RECT& rect, int feather)
{
    // Clip the iteration range to DIB bounds, but compute the
    // feather distance from the ORIGINAL rect edges. When the rect
    // extends past the popup (e.g. a menu whose top is above the
    // viewport), the distance from popup-edge pixels to the
    // original rect edge is already > feather, so weight=0 falls
    // out naturally — no purple halo at the popup edge. When the
    // rect is fully inside, distance == clipped distance, so this
    // also matches the inside-popup case.
    const int x0 = (std::max)(static_cast<int>(rect.left),   0);
    const int y0 = (std::max)(static_cast<int>(rect.top),    0);
    const int x1 = (std::min)(static_cast<int>(rect.right),  dibW);
    const int y1 = (std::min)(static_cast<int>(rect.bottom), dibH);
    if (x1 <= x0 || y1 <= y0) return;

    const int rectLeft   = static_cast<int>(rect.left);
    const int rectTop    = static_cast<int>(rect.top);
    const int rectRight  = static_cast<int>(rect.right);
    const int rectBottom = static_cast<int>(rect.bottom);

    const int rowBytes = dibW * 4;

    for (int y = y0; y < y1; ++y)
    {
        const int dyTop = y - rectTop;             // ≥ 0 inside, larger near popup edge
        const int dyBot = (rectBottom - 1) - y;
        const int dy    = (dyTop < dyBot) ? dyTop : dyBot;

        uint8_t* row = dib + y * rowBytes;
        for (int x = x0; x < x1; ++x)
        {
            const int dxLeft  = x - rectLeft;
            const int dxRight = (rectRight - 1) - x;
            const int dx      = (dxLeft < dxRight) ? dxLeft : dxRight;

            // Chebyshev distance to the rect's nearest outer edge.
            const int d = (dx < dy) ? dx : dy;

            // d=0 at the rect's outer edge → keep pixel mostly opaque.
            // d=feather → fully cut (weight 0). Pixels beyond the
            // feather band (deeper inside the rect, or in a region
            // where the nearest rect edge sits outside the popup) get
            // weight=0 → full alpha cut.
            float weight = 0.0f;
            if (feather > 0 && d < feather)
            {
                weight = 1.0f - smoothstep01(static_cast<float>(d) / static_cast<float>(feather));
            }

            uint8_t* px = row + x * 4;
            if (weight <= 0.0f)
            {
                px[0] = px[1] = px[2] = px[3] = 0;
            }
            else
            {
                // Multiply RGB and A by `weight` to preserve the
                // premultiplied-alpha invariant ULW_ALPHA requires.
                px[0] = static_cast<uint8_t>(px[0] * weight);
                px[1] = static_cast<uint8_t>(px[1] * weight);
                px[2] = static_cast<uint8_t>(px[2] * weight);
                px[3] = static_cast<uint8_t>(px[3] * weight);
            }
        }
    }
}

// B1.3.1 modal mask helpers.
//
// Separable box blur on a BGRA DIB. Two passes: horizontal then
// vertical. Each output pixel = average of source pixels in
// [-radius, +radius] along the pass axis, with hard clamping at the
// borders. Box blur instead of Gaussian because three iterations of
// box blur visually approximate Gaussian at a fraction of the cost,
// and we only need one for a soft modal-mask look.
//
// Runs on the engine-side DIB BEFORE the occlusion stamps so the
// chrome holes get a crisp edge against the blurred engine (the
// shadow of the modal renders against a blurred background, matching
// the panel-side `backdrop-blur-sm` treatment).
void BoxBlurDibBgra(uint8_t* dib, int w, int h, int radius,
                    std::vector<uint8_t>& scratch)
{
    if (radius <= 0 || w <= 0 || h <= 0) return;
    const size_t pixels = static_cast<size_t>(w) * static_cast<size_t>(h);
    if (scratch.size() < pixels * 4) scratch.resize(pixels * 4);

    // Horizontal pass: dib → scratch.
    const int rowBytes = w * 4;
    for (int y = 0; y < h; ++y)
    {
        const uint8_t* srcRow = dib     + y * rowBytes;
        uint8_t*       dstRow = scratch.data() + y * rowBytes;
        for (int x = 0; x < w; ++x)
        {
            const int x0 = (std::max)(x - radius, 0);
            const int x1 = (std::min)(x + radius, w - 1);
            const int n  = x1 - x0 + 1;
            int b = 0, g = 0, r = 0, a = 0;
            for (int sx = x0; sx <= x1; ++sx)
            {
                const uint8_t* p = srcRow + sx * 4;
                b += p[0]; g += p[1]; r += p[2]; a += p[3];
            }
            uint8_t* d = dstRow + x * 4;
            d[0] = static_cast<uint8_t>(b / n);
            d[1] = static_cast<uint8_t>(g / n);
            d[2] = static_cast<uint8_t>(r / n);
            d[3] = static_cast<uint8_t>(a / n);
        }
    }

    // Vertical pass: scratch → dib.
    for (int y = 0; y < h; ++y)
    {
        uint8_t* dstRow = dib + y * rowBytes;
        const int y0 = (std::max)(y - radius, 0);
        const int y1 = (std::min)(y + radius, h - 1);
        const int n  = y1 - y0 + 1;
        for (int x = 0; x < w; ++x)
        {
            int b = 0, g = 0, r = 0, a = 0;
            for (int sy = y0; sy <= y1; ++sy)
            {
                const uint8_t* p = scratch.data() + sy * rowBytes + x * 4;
                b += p[0]; g += p[1]; r += p[2]; a += p[3];
            }
            uint8_t* d = dstRow + x * 4;
            d[0] = static_cast<uint8_t>(b / n);
            d[1] = static_cast<uint8_t>(g / n);
            d[2] = static_cast<uint8_t>(r / n);
            d[3] = static_cast<uint8_t>(a / n);
        }
    }
}

// Multiply per-pixel RGB + A by `alpha` (premultiplied invariant
// preserved). Runs AFTER the occlusion stamps so the chrome holes
// (already alpha=0) stay holes — multiplying 0 by 0.4 is still 0.
// In the non-occluded engine pixels, this scales the popup's overall
// opacity, letting WebView2's Dialog.Overlay `bg-black/60` blend in
// from underneath via UpdateLayeredWindow.
void MultiplyDibAlphaBgra(uint8_t* dib, int w, int h, float alpha)
{
    if (alpha >= 0.999f || w <= 0 || h <= 0) return;
    const int total = w * h;
    for (int i = 0; i < total; ++i)
    {
        uint8_t* p = dib + i * 4;
        p[0] = static_cast<uint8_t>(p[0] * alpha);
        p[1] = static_cast<uint8_t>(p[1] * alpha);
        p[2] = static_cast<uint8_t>(p[2] * alpha);
        p[3] = static_cast<uint8_t>(p[3] * alpha);
    }
}

inline float Smoothstep01Edge(float x)
{
    if (x <= 0.0f) return 0.0f;
    if (x >= 1.0f) return 1.0f;
    return x * x * (3.0f - 2.0f * x);
}

// Fade the popup's per-pixel alpha to 0 in a `featherPx`-wide band
// along the popup's outer rectangle. Smooths the visible seam between
// the popup (engine pixels, blurred+dimmed by modal-mask) and the
// WebView2 panels beyond it (CSS-dimmed by Dialog.Overlay) — without
// this, the popup's hard rectangular HWND boundary draws a visible
// line where the two compositing surfaces meet. Runs AFTER occlusion
// stamps + global-alpha so the inner alpha-cuts and the dim are
// already baked in; this just additionally tapers the outer ring.
void FadePopupEdges(uint8_t* dib, int w, int h, int featherPx)
{
    if (featherPx <= 0 || w <= 0 || h <= 0) return;
    const int rowBytes = w * 4;
    for (int y = 0; y < h; ++y)
    {
        const int dyTop = y;
        const int dyBot = (h - 1) - y;
        const int dy    = (dyTop < dyBot) ? dyTop : dyBot;
        uint8_t* row = dib + y * rowBytes;
        for (int x = 0; x < w; ++x)
        {
            const int dxLeft  = x;
            const int dxRight = (w - 1) - x;
            const int dx      = (dxLeft < dxRight) ? dxLeft : dxRight;
            const int d       = (dx < dy) ? dx : dy;
            if (d >= featherPx) continue;
            const float weight = Smoothstep01Edge(
                static_cast<float>(d) / static_cast<float>(featherPx));
            uint8_t* px = row + x * 4;
            px[0] = static_cast<uint8_t>(px[0] * weight);
            px[1] = static_cast<uint8_t>(px[1] * weight);
            px[2] = static_cast<uint8_t>(px[2] * weight);
            px[3] = static_cast<uint8_t>(px[3] * weight);
        }
    }
}

} // namespace

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

    // B1.3.1 modal-mask: blur the engine pixels FIRST so the chrome
    // holes stamp crisply against a blurred background. Identity
    // skip (radius=0) keeps the per-frame cost at zero when no modal
    // is open.
    if (m_impl->blurRadius > 0)
    {
        BoxBlurDibBgra(dst, m_impl->width, m_impl->height,
                       m_impl->blurRadius, m_impl->blurScratch);
    }

    // Stamp the alpha (and premultiplied RGB) for each occluded
    // chrome rect. Outside occlusions the DIB keeps the engine's
    // fully-opaque pixels.
    for (const auto& kv : m_impl->occlusions)
    {
        ApplyOcclusion(dst, m_impl->width, m_impl->height,
                       kv.second.rect, kv.second.feather);
    }

    // B1.3.1 modal-mask: scale the popup's overall alpha so the
    // engine viewport dims to match Dialog.Overlay's `bg-black/60`
    // dim of the WebView2 panels. Runs AFTER occlusion stamps so
    // chrome holes stay holes. Identity (alpha=1.0) is skipped
    // inside MultiplyDibAlphaBgra via a fast-path check.
    MultiplyDibAlphaBgra(dst, m_impl->width, m_impl->height,
                         m_impl->globalAlpha);

    // B1.3.1 modal-mask edge-feather: smooth the seam between the
    // popup (engine + my dim/blur) and the WebView2 panels beyond it
    // (CSS dim+blur from Dialog.Overlay). Only when modal-mask is
    // active — without it, the rectangular popup HWND has crisp edges
    // by design and the engine paints opaque content right up to its
    // boundary. 24 px feather matches the design's general chrome-
    // shadow extent and is plenty to blend the dim engine into the
    // dim panel underneath.
    if (m_impl->globalAlpha < 0.999f)
    {
        FadePopupEdges(dst, m_impl->width, m_impl->height, 24);
    }

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
