# FD9 — Viewport Alpha Compositing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the FD8 `SetWindowRgn` cut-out plumbing with `WS_EX_LAYERED` per-pixel alpha on the viewport popup so WebView2 chrome (menus, tool panels, dialogs) renders over the viewport with proper alpha blending — drop shadows, anti-aliased edges, semi-transparent overlays all blend naturally against the D3D9 viewport pixels.

**Architecture:** The viewport popup becomes a layered window. D3D9 renders the scene to an off-screen ARGB render target instead of the swap chain back buffer. A new `host::AlphaCompositor` reads the RT back through a `D3DPOOL_SYSTEMMEM` surface into a `CreateDIBSection`-allocated bitmap, then calls `UpdateLayeredWindow` with `ULW_ALPHA` to push the alpha-aware frame to the screen each tick. The cut-out region/occlusion bridge protocol is removed entirely — alpha makes it obsolete.

**Tech Stack:**
- C++17 host, Direct3D 9 (`d3d9.lib`)
- Win32 layered windows (`WS_EX_LAYERED`, `UpdateLayeredWindow`)
- GDI bitmap interop (`CreateDIBSection`)
- React + Vite frontend (cleanup phase)
- WRL ComPtr for D3D9 lifetime

---

## Context & Decisions

**Why `UpdateLayeredWindow` + readback path** instead of DComp:

- DComp visual hosting was attempted in FD6 (3 reverted attempts; see `tasks/lt4_phase_4_1_fd6_visual_hosting_plan.md`). WebView2's surface never composited correctly on this machine despite matching the working `WebView2APISample` line-by-line. No appetite to revisit.
- `UpdateLayeredWindow` is a 2000s-era API but deterministic, well-trodden, and untouched by the DWM/DComp interaction that broke FD6.
- The per-frame readback cost (GPU → SYSTEMMEM → GDI bitmap → `UpdateLayeredWindow`) is real but bounded. At 944×337×4 bytes = 1.27 MB/frame, the readback is roughly 1–4 ms on modern GPUs (chipset-dependent), with another ~0.5 ms for `UpdateLayeredWindow`. Total overhead ~2–5 ms/frame. Current FPS is 200+; expected post-FD9 FPS is 100–150. For a particle editor that's a non-issue.

**What FD9 deletes** (the cut-out plumbing was a workaround for the missing alpha):

- `host::LayoutBroker::SetOcclusion` / `RemoveOcclusion` / `RebuildPopupRegion` + the `m_occlusions` map + the `m_webView` HWND + the `Occlusion` struct.
- `host::BridgeDispatcher` handler for `viewport/occlude`.
- `viewport/occlude` kind in the bridge schema.
- `web/apps/editor/src/lib/viewport-occlusion.ts` (deleted entirely).
- `useViewportOcclusion` calls + `bridge` / `occlusionId` props on `ToolPanel`.
- `OccludingMenubarContent` wrapper in `MenuBar.tsx` (revert to plain `Menubar.Content`).
- The `viewport/occlude` mock case in `bridge/mock.ts`.

**What FD9 restores:**

- `shadow-xl` on `MenuBar.tsx`'s `CONTENT` class (it was removed when the cut-out couldn't represent soft shadows).

**What FD9 adds:**

- `src/host/AlphaCompositor.{h,cpp}` — owns the off-screen RT, the SystemMem readback surface, the DIBSection, the memDC, and the `UpdateLayeredWindow` call.
- `Engine::SetAlphaCompositor(host::AlphaCompositor*)` — injection point.
- `Engine` switches the device's RT to the off-screen RT at the start of `Render`, and replaces `Present` with `compositor->Composite(hViewport)`.
- `WS_EX_LAYERED` style on the viewport `CreateWindowExW`.
- The viewport's parent class brush goes back to `nullptr` — no longer used because the popup paints its own alpha pixels.

**Performance acceptance criteria:**

- FPS ≥ 60 with the default empty scene + ground plane + skydome at the full editor size (around 1280×800 client).
- No visible stutter during camera drag.
- No visible regression in shift-click spawn responsiveness.

---

## File Structure

**New files:**

- `src/host/AlphaCompositor.h` — PIMPL'd public interface: `Resize(int, int)`, `GetRenderTarget()`, `Composite(HWND)`.
- `src/host/AlphaCompositor.cpp` — D3D9 + GDI implementation.

**Modified files:**

- `src/ParticleEditor.vcxproj` — add `host\AlphaCompositor.{h,cpp}` to ItemGroups; gated `ExcludedFromBuild=true` on Win32 platforms matching the rest of `host\*.cpp`.
- `src/engine.h` — add `m_pAlphaCompositor` member + `SetAlphaCompositor` method declaration.
- `src/engine.cpp` — implement `SetAlphaCompositor`; in `Render` at the top, swap the device's RT to the off-screen RT; replace `Present` with a `Composite` call; in `Reset`, also resize the compositor.
- `src/host/HostWindow.cpp` — add `WS_EX_LAYERED` to viewport `CreateWindowExW`; construct `AlphaCompositor` after `Engine`; pass it to `Engine::SetAlphaCompositor`; revert parent class brush to `nullptr`.
- `src/host/LayoutBroker.h` — remove occlusion-related members + methods.
- `src/host/LayoutBroker.cpp` — remove `SetOcclusion`, `RemoveOcclusion`, `RebuildPopupRegion`, the `<unordered_map>` and `<string>` includes if unused, the occlusion-tracking calls in `Apply` / `RefreshScreenPosition` / `PredictAndApply`.
- `src/host/BridgeDispatcher.cpp` — remove the `viewport/occlude` handler block.
- `web/packages/bridge-schema/src/index.ts` — remove the `viewport/occlude` `kind` from the discriminated union; remove its response-type clause.
- `web/apps/editor/src/bridge/mock.ts` — remove the `case "viewport/occlude":` handler.
- `web/apps/editor/src/components/ToolPanel.tsx` — remove `bridge` + `occlusionId` props, the `useViewportOcclusion` hook call, the `ref`, the wrapper. Plain Menubar.Content style.
- `web/apps/editor/src/components/MenuBar.tsx` — delete `OccludingMenubarContent` component, replace all six call sites with `Menubar.Content` directly, restore `shadow-xl` on the `CONTENT` class.
- `web/apps/editor/src/screens/BackgroundPicker.tsx` — remove `bridge` / `occlusionId` props from `<ToolPanel>`.
- `web/apps/editor/src/screens/BloomPanel.tsx` — same.
- `web/apps/editor/src/screens/GroundTexturePanel.tsx` — same.
- `web/apps/editor/src/screens/LightingPanel.tsx` — same.
- `web/apps/editor/src/screens/SpawnerPanel.tsx` — same.

**Deleted files:**

- `web/apps/editor/src/lib/viewport-occlusion.ts`.

---

## Task 1: Create AlphaCompositor skeleton (no integration)

Sets up the new module with public interface stubs that build clean. No use yet — this is a "does it compile" checkpoint.

**Files:**
- Create: `src/host/AlphaCompositor.h`
- Create: `src/host/AlphaCompositor.cpp`
- Modify: `src/ParticleEditor.vcxproj`

- [ ] **Step 1: Write `AlphaCompositor.h`**

```cpp
// src/host/AlphaCompositor.h
//
// AlphaCompositor — bridges D3D9 rendering to a WS_EX_LAYERED top-level
// popup via UpdateLayeredWindow. Replaces the back-buffer Present path
// on the viewport popup so per-pixel alpha is preserved and chrome HTML
// (drop shadows, anti-aliased edges) blends naturally against the D3D9
// scene pixels.
//
// Pipeline per frame:
//   1. Engine renders the scene into an off-screen D3DFMT_A8R8G8B8 RT
//      we own (GetRenderTarget()).
//   2. Engine calls Composite(layeredHwnd).
//   3. We GetRenderTargetData → D3DPOOL_SYSTEMMEM surface.
//   4. LockRect, memcpy into a CreateDIBSection-allocated bitmap.
//   5. UpdateLayeredWindow(ULW_ALPHA) pushes the bitmap to the popup.
//
// Resize() must be called whenever the popup HWND's client area changes.
// The RT, system-mem surface, and DIB are all reallocated to match.
// FD9 introduces this. See docs/superpowers/plans/2026-05-18-fd9-...md.
#ifndef HOST_ALPHA_COMPOSITOR_H
#define HOST_ALPHA_COMPOSITOR_H

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <memory>

struct IDirect3DDevice9;
struct IDirect3DSurface9;

namespace host {

class AlphaCompositor
{
public:
    // Construct against an existing D3D9 device. The device must outlive
    // the AlphaCompositor (HostWindow guarantees this: Engine owns the
    // device, and the AlphaCompositor is owned by HostWindowImpl alongside
    // the Engine).
    explicit AlphaCompositor(IDirect3DDevice9* device);
    ~AlphaCompositor();

    AlphaCompositor(const AlphaCompositor&)            = delete;
    AlphaCompositor& operator=(const AlphaCompositor&) = delete;

    // Resize the internal RT/DIB to match the popup's client size.
    // Idempotent when (w, h) hasn't changed. Throws std::runtime_error
    // if the underlying D3D9 / GDI allocations fail.
    void Resize(int width, int height);

    // The off-screen ARGB render target Engine should set on slot 0 at
    // the start of Render(). Returns nullptr until Resize() has been
    // called with a non-degenerate size.
    IDirect3DSurface9* GetRenderTarget() const;

    // Read the RT back and push it to the layered popup. Called once
    // per Engine::Render at the point where the old Present() lived.
    // No-op if Resize() hasn't been called or the HWND is null.
    void Composite(HWND layeredHwnd);

private:
    struct Impl;
    std::unique_ptr<Impl> m_impl;
};

} // namespace host

#endif // HOST_ALPHA_COMPOSITOR_H
```

- [ ] **Step 2: Write `AlphaCompositor.cpp` skeleton (stubs)**

```cpp
// src/host/AlphaCompositor.cpp
#include "AlphaCompositor.h"

#include <d3d9.h>
#include <wrl/client.h>

#include <stdexcept>
#include <string>

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

} // namespace

struct AlphaCompositor::Impl
{
    Microsoft::WRL::ComPtr<IDirect3DDevice9>  device;
    Microsoft::WRL::ComPtr<IDirect3DSurface9> offscreenRT;     // D3DPOOL_DEFAULT, ARGB
    Microsoft::WRL::ComPtr<IDirect3DSurface9> sysMemSurface;   // D3DPOOL_SYSTEMMEM, readback
    HDC      memDC      = nullptr;
    HBITMAP  dibBitmap  = nullptr;
    void*    dibPixels  = nullptr;
    int      width      = 0;
    int      height     = 0;
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
void AlphaCompositor::Composite(HWND /*layeredHwnd*/) {}

} // namespace host
```

- [ ] **Step 3: Add to vcxproj**

In `src/ParticleEditor.vcxproj`, add to the `<ItemGroup>` containing `ClInclude` entries (the same one with `host\AcceleratorBridge.h`, `host\BridgeDispatcher.h`, etc.), insert this line alphabetically near `host\BridgeDispatcher.h`:

```xml
<ClInclude Include="host\AlphaCompositor.h" />
```

In the `<ItemGroup>` containing `ClCompile` entries (alongside `host\AcceleratorBridge.cpp` etc.), add this block right after `host\BridgeDispatcher.cpp`'s ClCompile entry:

```xml
<ClCompile Include="host\AlphaCompositor.cpp">
  <ExcludedFromBuild Condition="'$(Configuration)|$(Platform)'=='Debug|Win32'">true</ExcludedFromBuild>
  <ExcludedFromBuild Condition="'$(Configuration)|$(Platform)'=='Release|Win32'">true</ExcludedFromBuild>
</ClCompile>
```

(The Win32 exclusion mirrors how the other `host\*.cpp` files are gated — the host TUs are x64-only.)

- [ ] **Step 4: Build and verify**

Run from the worktree root:
```
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" ParticleEditor.sln //p:Configuration=Debug //p:Platform=x64 //m //v:m
```

Expected: clean build with `AlphaCompositor.cpp` in the compilation list. No regression in other files.

- [ ] **Step 5: Commit**

```bash
git add src/host/AlphaCompositor.h src/host/AlphaCompositor.cpp src/ParticleEditor.vcxproj
git commit -m "feat(LT-4): FD9 step 1 — AlphaCompositor skeleton

Stub for the layered-window alpha-compositing pipeline that
replaces the FD7/FD8 SetWindowRgn cut-out. Real Resize +
Composite implementations land in the next two commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Implement `AlphaCompositor::Resize`

Creates the off-screen RT, the SystemMem readback surface, and the DIB section + memDC.

**Files:**
- Modify: `src/host/AlphaCompositor.cpp`

- [ ] **Step 1: Replace the stub Resize with the real implementation**

In `src/host/AlphaCompositor.cpp`, replace `void AlphaCompositor::Resize(int /*w*/, int /*h*/) {}` with:

```cpp
void AlphaCompositor::Resize(int w, int h)
{
    if (w == m_impl->width && h == m_impl->height) return;
    if (w <= 0 || h <= 0) return;

    // Release old resources first. ComPtr::Reset() releases the COM
    // ref; the GDI handles need manual cleanup.
    m_impl->offscreenRT.Reset();
    m_impl->sysMemSurface.Reset();
    if (m_impl->dibBitmap) { DeleteObject(m_impl->dibBitmap); m_impl->dibBitmap = nullptr; }
    if (m_impl->memDC)     { DeleteDC(m_impl->memDC); m_impl->memDC = nullptr; }
    m_impl->dibPixels = nullptr;

    // D3DFMT_A8R8G8B8 keeps alpha through the scene's render passes
    // so the final composite ends up with meaningful alpha values.
    // Multisample NONE because UpdateLayeredWindow can't consume
    // multisampled surfaces — we accept the aliasing here (the
    // viewport content has its own anti-aliasing via texturing).
    HRESULT hr = m_impl->device->CreateRenderTarget(
        w, h, D3DFMT_A8R8G8B8, D3DMULTISAMPLE_NONE, 0,
        FALSE /*lockable*/, &m_impl->offscreenRT, nullptr);
    ThrowIfFailed(hr, "CreateRenderTarget");

    // Readback target. D3DPOOL_SYSTEMMEM is the only pool that
    // GetRenderTargetData can write to.
    hr = m_impl->device->CreateOffscreenPlainSurface(
        w, h, D3DFMT_A8R8G8B8, D3DPOOL_SYSTEMMEM,
        &m_impl->sysMemSurface, nullptr);
    ThrowIfFailed(hr, "CreateOffscreenPlainSurface");

    // Top-down DIB so its row order matches D3D9's. Negative biHeight
    // = top-down.
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
```

- [ ] **Step 2: Build and verify**

Run:
```
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" ParticleEditor.sln //p:Configuration=Debug //p:Platform=x64 //m //v:m
```

Expected: clean build. Resize isn't called yet from anywhere, but the code path is in place.

- [ ] **Step 3: Commit**

```bash
git add src/host/AlphaCompositor.cpp
git commit -m "feat(LT-4): FD9 step 2 — AlphaCompositor::Resize allocates RT/DIB

Creates the off-screen ARGB render target, the SYSTEMMEM
readback surface, and the top-down DIBSection + memDC.
Idempotent when (w, h) is unchanged. Still unused.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Implement `AlphaCompositor::Composite`

The per-frame readback + `UpdateLayeredWindow` push.

**Files:**
- Modify: `src/host/AlphaCompositor.cpp`

- [ ] **Step 1: Replace the stub Composite with the real implementation**

In `src/host/AlphaCompositor.cpp`, replace `void AlphaCompositor::Composite(HWND /*layeredHwnd*/) {}` with:

```cpp
void AlphaCompositor::Composite(HWND layeredHwnd)
{
    if (!layeredHwnd) return;
    if (!m_impl->offscreenRT || !m_impl->sysMemSurface || !m_impl->dibBitmap) return;
    if (m_impl->width <= 0 || m_impl->height <= 0) return;

    // GPU → SYSTEMMEM. This is the readback. Costs ~1-3 ms on
    // modern hardware for a typical viewport size.
    HRESULT hr = m_impl->device->GetRenderTargetData(
        m_impl->offscreenRT.Get(), m_impl->sysMemSurface.Get());
    if (FAILED(hr)) return;

    D3DLOCKED_RECT locked = {};
    hr = m_impl->sysMemSurface->LockRect(&locked, nullptr, D3DLOCK_READONLY);
    if (FAILED(hr)) return;

    // D3DFMT_A8R8G8B8 stores pixels as BB GG RR AA in memory; GDI
    // BI_RGB 32bpp uses the same byte order. Direct memcpy works,
    // accounting for pitch.
    auto* dst = static_cast<uint8_t*>(m_impl->dibPixels);
    const auto* src = static_cast<const uint8_t*>(locked.pBits);
    const int rowBytes = m_impl->width * 4;
    for (int y = 0; y < m_impl->height; ++y)
    {
        memcpy(dst + y * rowBytes, src + y * locked.Pitch, rowBytes);
    }

    m_impl->sysMemSurface->UnlockRect();

    // UpdateLayeredWindow drives the popup's screen pixels. We pass
    // psize but not pptDst so position is unchanged (LayoutBroker
    // already moved the window via SetWindowPos before this commit).
    POINT srcPoint = { 0, 0 };
    SIZE  bmpSize  = { m_impl->width, m_impl->height };
    BLENDFUNCTION blend = {};
    blend.BlendOp             = AC_SRC_OVER;
    blend.BlendFlags          = 0;
    blend.SourceConstantAlpha = 0xFF;
    blend.AlphaFormat         = AC_SRC_ALPHA;

    UpdateLayeredWindow(layeredHwnd, nullptr /*hdcDst*/,
                        nullptr /*pptDst*/, &bmpSize,
                        m_impl->memDC, &srcPoint,
                        0 /*crKey*/, &blend, ULW_ALPHA);
}
```

- [ ] **Step 2: Build and verify**

Run:
```
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" ParticleEditor.sln //p:Configuration=Debug //p:Platform=x64 //m //v:m
```

Expected: clean build. Composite is implemented but still unused.

- [ ] **Step 3: Commit**

```bash
git add src/host/AlphaCompositor.cpp
git commit -m "feat(LT-4): FD9 step 3 — AlphaCompositor::Composite readback + ULW

Implements the per-frame readback path: GetRenderTargetData
into SYSTEMMEM, LockRect/memcpy into the DIB, UpdateLayeredWindow
with ULW_ALPHA. Still unused — wiring lands in step 4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Hook `AlphaCompositor` into Engine

Adds the injection point and modifies `Engine::Render` and `Engine::Reset`.

**Files:**
- Modify: `src/engine.h`
- Modify: `src/engine.cpp`

- [ ] **Step 1: Forward-declare and add the member to engine.h**

In `src/engine.h`, near the top (after the existing includes and forward declarations, before the `class Engine` declaration), add:

```cpp
namespace host { class AlphaCompositor; }
```

In the `private:` section of the `Engine` class, add a member declaration. Find a reasonable spot — alongside other compositor / render-state fields. Add:

```cpp
    // FD9: optional alpha compositor. When non-null, Render() redirects
    // its final scene composite to the compositor's off-screen RT and
    // calls compositor->Composite(m_hDevice) instead of Present().
    // When null, the legacy Present path runs (used by viewport_poc and
    // any host that doesn't enable the layered popup).
    host::AlphaCompositor* m_pAlphaCompositor = nullptr;
```

In the `public:` section of the `Engine` class, add (near other setters like `SetBackground`):

```cpp
    // FD9: install/clear the layered-window compositor. Pass nullptr to
    // restore the legacy Present-to-swapchain path.
    void SetAlphaCompositor(host::AlphaCompositor* c) { m_pAlphaCompositor = c; }
```

- [ ] **Step 2: Include AlphaCompositor.h in engine.cpp**

Open `src/engine.cpp`. Find the existing host includes (if any) or just the regular includes near the top. Add:

```cpp
#include "host/AlphaCompositor.h"
```

- [ ] **Step 3: Switch the RT at the top of Render(), replace Present with Composite**

Find `bool Engine::Render()` in `src/engine.cpp`. Near line 614 (just before `sort(m_instances.begin(), ...)` or wherever the function body starts), insert this preamble:

```cpp
    // FD9: when alpha compositing is enabled, redirect the device's
    // default RT to the compositor's off-screen ARGB surface for the
    // duration of this Render call. The existing pScreenSurface
    // capture below picks this up as the "screen" target, the final
    // composite pass writes to it, and Composite() pushes it to the
    // layered popup instead of Present().
    if (m_pAlphaCompositor && m_pAlphaCompositor->GetRenderTarget())
    {
        m_pDevice->SetRenderTarget(0, m_pAlphaCompositor->GetRenderTarget());
    }
```

Find the existing `m_pDevice->Present(NULL, NULL, NULL, NULL);` line (near line 876, just before `return true;` at the end of `Render`). Replace it with:

```cpp
    if (m_pAlphaCompositor)
    {
        m_pAlphaCompositor->Composite(m_presentationParameters.hDeviceWindow);
    }
    else
    {
        m_pDevice->Present(NULL, NULL, NULL, NULL);
    }
```

(`m_presentationParameters.hDeviceWindow` is the viewport popup HWND — set in Engine's ctor at line 1685. Engine doesn't have a dedicated `m_hDevice` member.)

- [ ] **Step 4: Resize the compositor in Engine::Reset**

Find `void Engine::Reset()` in `src/engine.cpp` (near line 1202). At the very end of the function, after `ResetParameters()`, add:

```cpp
    // FD9: when alpha compositing is on, the off-screen RT must
    // match the new client size. ResetParameters() rebuilt all the
    // D3DPOOL_DEFAULT resources but the compositor's RT lives in its
    // own module, so push the new size in explicitly.
    if (m_pAlphaCompositor)
    {
        RECT rc{};
        if (GetClientRect(m_presentationParameters.hDeviceWindow, &rc))
        {
            m_pAlphaCompositor->Resize(rc.right - rc.left, rc.bottom - rc.top);
        }
    }
```

- [ ] **Step 5: Build and verify**

```
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" ParticleEditor.sln //p:Configuration=Debug //p:Platform=x64 //m //v:m
```

Expected: clean build. No behavior change yet — `m_pAlphaCompositor` is nullptr unless someone calls `SetAlphaCompositor`, so the legacy Present path still runs.

- [ ] **Step 6: Commit**

```bash
git add src/engine.h src/engine.cpp
git commit -m "feat(LT-4): FD9 step 4 — Engine learns the AlphaCompositor injection

Adds SetAlphaCompositor + the renderer-side switching. When the
compositor is set, Render() redirects the device's RT to the
off-screen ARGB surface (so the existing pScreenSurface capture
flows through it unchanged) and replaces Present() with
compositor->Composite(hDevice). Reset() also resizes the
compositor's RT to match the new client area.

When the compositor is null, legacy Present-to-swapchain runs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: HostWindow integration — `WS_EX_LAYERED` + compositor construction

The flip-the-switch commit. This is the one that visibly changes rendering.

**Files:**
- Modify: `src/host/HostWindow.cpp`

- [ ] **Step 1: Add the include and member**

In `src/host/HostWindow.cpp`, near the existing host includes (e.g. `#include "BridgeDispatcher.h"`), add:

```cpp
#include "AlphaCompositor.h"
```

Find the `HostWindowImpl` struct definition (around line 260). In its members section, near `std::unique_ptr<Engine> engine;`, add:

```cpp
    // FD9: layered-window alpha compositor. Constructed after the
    // Engine, lifetime-coupled to it. Engine receives the pointer via
    // SetAlphaCompositor so its Render() targets our off-screen RT.
    std::unique_ptr<host::AlphaCompositor> alphaCompositor;
```

- [ ] **Step 2: Add `WS_EX_LAYERED` to the viewport popup**

Find the `hViewport = CreateWindowExW(` call (around line 1096). It currently looks like:

```cpp
hViewport = CreateWindowExW(
    WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
    kHostViewportClassName, L"",
    WS_POPUP | WS_VISIBLE,
    16, 16, 320, 240, hwnd /* owner */, nullptr,
    hInstance, nullptr);
```

Change the extended style flag to add `WS_EX_LAYERED`:

```cpp
hViewport = CreateWindowExW(
    WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_LAYERED,
    kHostViewportClassName, L"",
    WS_POPUP | WS_VISIBLE,
    16, 16, 320, 240, hwnd /* owner */, nullptr,
    hInstance, nullptr);
```

- [ ] **Step 3: Construct AlphaCompositor after Engine, hand it to Engine**

Find the Engine construction block (in WM_CREATE, around line 791):

```cpp
try
{
    engine = std::make_unique<Engine>(
        hwnd, hViewport, textureManager, shaderManager, fileManager);
    if (dispatcher) dispatcher->SetEngine(engine.get());
    layout.SetEngine(engine.get());
    Log("[host] Engine constructed OK\n");
}
catch (...) { /* unchanged */ }
```

Right after `Log("[host] Engine constructed OK\n");`, add:

```cpp
    // FD9: stand up the alpha compositor against the Engine's D3D9
    // device. Engine::Reset will resize it on the first layout/
    // viewport-rect message; we still bootstrap a non-degenerate
    // size now so the first Render finds a valid RT.
    try
    {
        alphaCompositor = std::make_unique<host::AlphaCompositor>(engine->GetDevice());
        RECT vrc{};
        GetClientRect(hViewport, &vrc);
        alphaCompositor->Resize(vrc.right - vrc.left, vrc.bottom - vrc.top);
        engine->SetAlphaCompositor(alphaCompositor.get());
        Log("[host] AlphaCompositor up\n");
    }
    catch (const std::exception& e)
    {
        Log("[host] AlphaCompositor init failed: %s — falling back to legacy Present\n", e.what());
        alphaCompositor.reset();
    }
```

`Engine::GetDevice()` already exists (returns `IDirect3DDevice9*`, defined at `engine.h:121`). No new accessor needed.

- [ ] **Step 4: Revert the parent class brush to nullptr**

The dark-purple parent brush was an FD8 polish for the cut-out path. With alpha compositing, the popup paints its own pixels alpha-aware and the parent brush is never visible. Find the `wc.hbrBackground = (HBRUSH)CreateSolidBrush(...)` call (around line 1281 in `RegisterClasses`). Replace with:

```cpp
wc.hbrBackground = nullptr;  // FD9: layered popup paints its own pixels
```

- [ ] **Step 5: Drop the compositor before the engine in shutdown**

Find the destructor of `HostWindowImpl` (`~HostWindowImpl`) or the explicit shutdown sequence at `WM_DESTROY`. Anywhere the engine is reset/destroyed, the compositor must be reset *first* (so the Engine's `m_pAlphaCompositor` pointer doesn't dangle). If `WM_DESTROY` already calls `engine.reset()`, add `alphaCompositor.reset()` just before it. Specifically, find:

```cpp
case WM_DESTROY:
    KillTimer(hwnd, kStatsTimerId);
    // ... webController teardown ...
    webView.Reset();
    engine.reset();
    PostQuitMessage(0);
    return 0;
```

Change to:

```cpp
case WM_DESTROY:
    KillTimer(hwnd, kStatsTimerId);
    // ... webController teardown ...
    webView.Reset();
    // FD9: detach the compositor from Engine BEFORE either is destroyed
    // so Engine::Render (if still in flight) can't dereference a freed
    // compositor. The actual reset order then drops compositor first
    // since Engine still holds a raw pointer.
    if (engine) engine->SetAlphaCompositor(nullptr);
    alphaCompositor.reset();
    engine.reset();
    PostQuitMessage(0);
    return 0;
```

- [ ] **Step 6: Build, launch, and visually verify**

Build:
```
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" ParticleEditor.sln //p:Configuration=Debug //p:Platform=x64 //m //v:m
```

Expected: clean build.

Launch:
```
x64/Debug/ParticleEditor.exe --new-ui &
```

Visual checks:
- The editor opens with the full chrome and viewport visible (same as FD8).
- The viewport shows the ground plane + skybox.
- Open the **Emitters** menu. The dropdown's drop shadow (currently absent, will be restored in task 8) should NOT show a dark-purple halo — the cut-out machinery is bypassed.
- Resize the editor by dragging an edge. The viewport tracks (same as FD8 — `PredictAndApply` still runs).
- Status bar FPS — note the current value. Expected: 80–150 depending on hardware (down from 200+ pre-FD9).

If the viewport is blank/black or the editor crashes on launch, capture the host log (`%LOCALAPPDATA%\AloParticleEditor\host.log`) — the most likely culprits are: AlphaCompositor::Resize threw (look for "AlphaCompositor init failed"), or Engine's GetDevice accessor doesn't exist (compile error).

- [ ] **Step 7: Commit**

```bash
git add src/host/HostWindow.cpp src/engine.h
git commit -m "feat(LT-4): FD9 step 5 — wire AlphaCompositor + WS_EX_LAYERED viewport

Flip the rendering path. The viewport popup is now WS_EX_LAYERED
and HostWindowImpl constructs an AlphaCompositor against the
Engine's D3D9 device. Engine::Render targets the compositor's
off-screen ARGB RT and Composite() pushes via UpdateLayeredWindow
instead of Present.

The parent class brush goes back to nullptr — alpha is preserved
end-to-end so a dark-purple under-paint is no longer needed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Remove `SetWindowRgn` cut-out plumbing (host side)

Strips the now-obsolete occlusion infrastructure from LayoutBroker and BridgeDispatcher.

**Files:**
- Modify: `src/host/LayoutBroker.h`
- Modify: `src/host/LayoutBroker.cpp`
- Modify: `src/host/BridgeDispatcher.cpp`

- [ ] **Step 1: Strip LayoutBroker.h**

In `src/host/LayoutBroker.h`, remove the FD7/FD8 occlusion comment paragraph from the header banner (keep the FD8 popup paragraph). Remove `#include <string>` and `#include <unordered_map>` if they were added for occlusions.

Inside `class LayoutBroker`, remove:
- the `SetOcclusion` declaration
- the `RemoveOcclusion` declaration
- the `RebuildPopupRegion` private declaration
- the `struct Occlusion` and `m_occlusions` field

The final shape of the class should keep: `Apply`, `RefreshScreenPosition`, `PredictAndApply`, `SetViewport`, `SetEngine`, and the cached state (`m_lastX/Y/W/H`, `m_lastClientW/H`).

- [ ] **Step 2: Strip LayoutBroker.cpp**

In `src/host/LayoutBroker.cpp`:

- Remove the entire `void LayoutBroker::SetOcclusion(...)` body.
- Remove the entire `void LayoutBroker::RemoveOcclusion(...)` body.
- Remove the entire `void LayoutBroker::RebuildPopupRegion()` body.
- In `Apply()`, remove the `RebuildPopupRegion();` calls at the end of the degenerate-size branch and at the end of the main branch.
- In `RefreshScreenPosition()`, remove the `RebuildPopupRegion();` call at the end.
- In `PredictAndApply()`, remove the `RebuildPopupRegion();` call at the end.

The file's `#include` list should no longer need `<unordered_map>` or `<string>` — drop those if present.

- [ ] **Step 3: Strip the BridgeDispatcher handler**

In `src/host/BridgeDispatcher.cpp`, find the `// -------- viewport/occlude --------` block (around the dispatcher's request switch, near the `layout/viewport-rect` handler). Delete the entire block including the comment header, leaving the surrounding handlers intact.

- [ ] **Step 4: Build**

```
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" ParticleEditor.sln //p:Configuration=Debug //p:Platform=x64 //m //v:m
```

Expected: clean build. Behavior unchanged from task 5 because the React side is still sending `viewport/occlude` requests (host now silently rejects them with the `unknown kind` path, which is fine).

- [ ] **Step 5: Commit**

```bash
git add src/host/LayoutBroker.h src/host/LayoutBroker.cpp src/host/BridgeDispatcher.cpp
git commit -m "refactor(LT-4): FD9 step 6 — remove SetWindowRgn cut-out plumbing

The viewport popup now composites with per-pixel alpha; the
occlusion-rect-driven SetWindowRgn cut-outs are obsolete. Strip
LayoutBroker::SetOcclusion / RemoveOcclusion / RebuildPopupRegion,
the m_occlusions map, and the BridgeDispatcher viewport/occlude
handler.

React still sends viewport/occlude requests until task 7 cleans
them up; the host responds with the dispatcher's default
unknown-kind path. Functionally inert.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Remove `viewport/occlude` from the bridge surface

Strips the kind from the schema, the mock case, and the React-side hook + call sites.

**Files:**
- Modify: `web/packages/bridge-schema/src/index.ts`
- Modify: `web/apps/editor/src/bridge/mock.ts`
- Modify: `web/apps/editor/src/components/ToolPanel.tsx`
- Modify: `web/apps/editor/src/screens/BackgroundPicker.tsx`
- Modify: `web/apps/editor/src/screens/BloomPanel.tsx`
- Modify: `web/apps/editor/src/screens/GroundTexturePanel.tsx`
- Modify: `web/apps/editor/src/screens/LightingPanel.tsx`
- Modify: `web/apps/editor/src/screens/SpawnerPanel.tsx`
- Delete: `web/apps/editor/src/lib/viewport-occlusion.ts`

- [ ] **Step 1: Remove the kind from the schema**

In `web/packages/bridge-schema/src/index.ts`, find the line `| { kind: "viewport/occlude"; ...` in the request-kind discriminated union and delete that whole line (plus its leading multi-line comment about "FD8 follow-up: tell the host that a chrome region overlaps...").

In the response-type clause section further down, find the matching line `R extends { kind: "viewport/occlude" } ? Record<string, never> :` and delete it.

- [ ] **Step 2: Remove the mock case**

In `web/apps/editor/src/bridge/mock.ts`, find:

```ts
case "viewport/occlude":
  // Mock: no native HWND to clip. Acknowledge silently.
  return {};
```

Delete those three lines.

- [ ] **Step 3: Strip ToolPanel.tsx**

In `web/apps/editor/src/components/ToolPanel.tsx`:

- Remove the `useViewportOcclusion` import.
- Remove the `Bridge` import if it was added only for the props.
- Remove the `bridge` and `occlusionId` props from `ToolPanelProps`.
- Remove the `useRef`/`useViewportOcclusion` call from the component body.
- Remove `ref={ref}` from the root `<div>`.

The component reverts to its pre-FD8 shape.

- [ ] **Step 4: Strip the tool-panel screens**

In each of `BackgroundPicker.tsx`, `BloomPanel.tsx`, `GroundTexturePanel.tsx`, `LightingPanel.tsx`, `SpawnerPanel.tsx`, find the `<ToolPanel ...>` call and remove the `bridge={bridge}` and `occlusionId="tool-panel:XXX"` props (only those — leave `title` and `onClose` intact). For SpawnerPanel the props span two lines; remove both lines.

- [ ] **Step 5: Delete the viewport-occlusion hook**

```bash
rm web/apps/editor/src/lib/viewport-occlusion.ts
```

- [ ] **Step 6: Build the bridge schema + React**

```
cd web/packages/bridge-schema && pnpm build
cd /c/Modding/Particle\ Editor/.claude/worktrees/laughing-tereshkova-32e22a/web/apps/editor && pnpm build
```

Expected: clean builds. If there's a stray reference to `useViewportOcclusion` somewhere not on this list, the build will catch it.

- [ ] **Step 7: Commit**

```bash
git add web/packages/bridge-schema/src/index.ts \
        web/apps/editor/src/bridge/mock.ts \
        web/apps/editor/src/components/ToolPanel.tsx \
        web/apps/editor/src/screens/BackgroundPicker.tsx \
        web/apps/editor/src/screens/BloomPanel.tsx \
        web/apps/editor/src/screens/GroundTexturePanel.tsx \
        web/apps/editor/src/screens/LightingPanel.tsx \
        web/apps/editor/src/screens/SpawnerPanel.tsx
git rm web/apps/editor/src/lib/viewport-occlusion.ts
git commit -m "refactor(LT-4): FD9 step 7 — remove viewport/occlude from bridge

Strips the now-dead viewport/occlude request kind from the
schema, mock, ToolPanel/MenuBar instrumentation, and the
useViewportOcclusion hook itself.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Restore drop shadow on `MenuBar.tsx` + replace `OccludingMenubarContent`

The headline visual win of FD9 — menus get their soft drop shadow back.

**Files:**
- Modify: `web/apps/editor/src/components/MenuBar.tsx`

- [ ] **Step 1: Restore `shadow-xl` on the CONTENT class**

In `web/apps/editor/src/components/MenuBar.tsx`, find the FD8 comment "FD8 follow-up: no drop-shadow..." and the line below it. Replace both with:

```ts
const CONTENT =
  "min-w-[200px] bg-neutral-900 border border-neutral-800 rounded-md shadow-xl p-1 z-50";
```

- [ ] **Step 2: Delete `OccludingMenubarContent`**

Remove:
- the `useViewportOcclusion` import
- the `useRef`, `type ComponentProps` imports (if they're not used elsewhere — leave them otherwise)
- the entire `MenuContentProps` type
- the entire `OccludingMenubarContent` function component (the FD8 follow-up comment + the function body)

- [ ] **Step 3: Replace all `<OccludingMenubarContent>` call sites**

Find every `<OccludingMenubarContent bridge={bridge} occlusionId="menu:XXX"` opening tag. Replace each with `<Menubar.Content` and remove the `bridge` + `occlusionId` lines.

Find every `</OccludingMenubarContent>` closing tag. Replace with `</Menubar.Content>`.

There are six opening tags (File/Edit/Emitters/Mods/View/Help) and six closing tags.

- [ ] **Step 4: Build**

```
cd web/apps/editor && pnpm build
```

Expected: clean build.

- [ ] **Step 5: Launch and verify**

```
cd /c/Modding/Particle\ Editor/.claude/worktrees/laughing-tereshkova-32e22a
x64/Debug/ParticleEditor.exe --new-ui &
```

Visual checks:
- Open the Emitters menu. The dropdown should appear with a SOFT DROP SHADOW visible against the viewport — the shadow should look natural, fading into the ground plane / skybox content beneath. No dark-purple halo.
- Open the Background tool panel. The panel renders over the viewport with anti-aliased edges and any internal drop shadows (e.g. on the color swatches) should also render naturally.
- Resize the window. No flash, no jitter.
- Click in the viewport and drag to verify camera input still works.

If the menu's shadow has visible banding or pixel-aliased fringing, the issue is likely that the off-screen RT format is wrong — should be `D3DFMT_A8R8G8B8`, not RGB. Double-check task 2's CreateRenderTarget call.

- [ ] **Step 6: Commit**

```bash
git add web/apps/editor/src/components/MenuBar.tsx
git commit -m "feat(LT-4): FD9 step 8 — restore soft drop shadows on MenuBar dropdowns

The viewport popup is now WS_EX_LAYERED with per-pixel alpha; the
OccludingMenubarContent wrapper + cut-out workaround is obsolete.
Restore shadow-xl on the menu CONTENT class. Menus drop into the
viewport area with soft shadows that blend naturally against the
D3D9 scene content.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Performance & cleanup pass

Final QA pass: measure FPS, exercise the editor, decide whether the readback overhead is acceptable.

**Files:**
- None (this task is verification only — no code changes unless something needs fixing)

- [ ] **Step 1: Launch with a stopwatch on FPS**

```
x64/Debug/ParticleEditor.exe --new-ui &
```

Note the FPS reading in the status bar with the default empty scene. Expected: 80–200, well above the 60 FPS floor.

- [ ] **Step 2: Stress test**

- Spawn a particle system with shift-click and watch FPS dip — should still stay ≥60.
- Open + close each tool panel rapidly — no visible artifacts.
- Open each top-level menu — shadows render against viewport content.
- Drag the camera continuously for ~30 seconds — FPS should be stable.
- Resize the window by dragging an edge — no flash, smooth transitions.

If FPS is consistently below 60 with the default scene, the readback is likely a bottleneck. Mitigations to consider (NOT part of this task — separate follow-up):
- Throttle Render to a 60 FPS cap via QPC timing.
- Use `D3DPOOL_DEFAULT` + `IDirect3DDevice9::GetFrontBufferData` instead of GetRenderTargetData (different perf profile on some hardware).
- Move readback to a separate thread with a 1-frame latency.

- [ ] **Step 2.5: Verify the host log is quiet**

Check `%LOCALAPPDATA%\AloParticleEditor\host.log` for any new error or warning lines introduced by FD9. Expected: a single `[host] AlphaCompositor up` line during startup, nothing else FD9-related.

- [ ] **Step 3: Final commit if any tweaks landed**

If steps 1–2 surfaced fixable issues (e.g. a stray log line, a missing edge case), make the fix and commit:

```bash
git add <files>
git commit -m "polish(LT-4): FD9 follow-up — <description>"
```

If everything is clean, no commit needed.

---

## Self-review checklist

Run through this mentally before handing off:

- [x] **Spec coverage**:
  - WS_EX_LAYERED viewport popup → task 5
  - D3D9 → off-screen ARGB RT → tasks 2, 4
  - Per-frame readback + UpdateLayeredWindow → task 3
  - Cleanup of cut-out plumbing → tasks 6, 7
  - Restore drop shadows → task 8
  - Performance verification → task 9
- [x] **No placeholders**: each step has the actual code/command/expected output.
- [x] **Type consistency**: `AlphaCompositor::GetRenderTarget` returns `IDirect3DSurface9*` consistently across tasks 1, 2, 4. `SetAlphaCompositor(host::AlphaCompositor*)` matches. `Engine::GetDevice()` is assumed and noted to verify in task 5 step 3.

## Risks worth re-stating

1. **Engine HWND access.** Confirmed: `Engine::GetDevice()` exists (`engine.h:121`) and the viewport HWND is in `m_presentationParameters.hDeviceWindow` (set in Engine's ctor at `engine.cpp:1685`). The plan uses both directly.

3. **Off-screen RT must include alpha** (`D3DFMT_A8R8G8B8`). If the existing engine pipeline (Clear/SceneTexture/Bloom/etc.) stores opaque colors with `A = 0xFF` in the back buffer slot, the final composite will be fully opaque — which is fine. If anywhere it writes `A = 0`, the popup will become transparent there. Check Clear at line 640 of engine.cpp: the call clears with `D3DCOLOR_XRGB(...)` which sets alpha to `0xFF`. Good — that's the correct semantic. Be alert if you find any `D3DCOLOR_ARGB(0, ...)` clears or `BlendOp` writes that set alpha to 0.

4. **Modal sizemove during resize.** Task 4's `Engine::Reset` change runs the compositor resize too — but the modal sizemove loop calls Reset inside `PredictAndApply` indirectly. Watch for "device not reset" warnings or crashes during continuous resize. The likely fix would be to debounce or skip the alpha compositor's Resize during the modal loop (it's safe to lag — `UpdateLayeredWindow` accepts mismatched sizes for a frame). Defer to step 9.

5. **Cursor/input through layered window.** `WS_EX_LAYERED` doesn't affect input by default; the layered window still receives clicks. Shouldn't be a regression, but verify in task 9.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-18-fd9-viewport-alpha-compositing.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
