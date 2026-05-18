# LT-4 Phase 4.1 FD9b — Layered viewport with software alpha-stamp cut-outs

## Goal & scope

Replace FD7/FD8's `SetWindowRgn(hViewport, HRGN)` binary cut-out with
`WS_EX_LAYERED` + `UpdateLayeredWindow(ULW_ALPHA)` on the viewport popup,
plus software alpha-stamping inside `AlphaCompositor::Composite` so the
occluded chrome rects get a *soft-edged* alpha falloff instead of a hard
pixel boundary. Keep the existing occlusion bridge plumbing — the
chrome still reports rect updates via `viewport/occlude`, only the
mechanism downstream changes.

**In**
- New `host::AlphaCompositor` module: off-screen `D3DFMT_A8R8G8B8` RT,
  `D3DPOOL_SYSTEMMEM` readback surface, `CreateDIBSection` bitmap +
  memDC, `UpdateLayeredWindow(ULW_ALPHA)` per-frame.
- `Engine::SetAlphaCompositor` injection; `Render` swaps slot-0 RT to
  the compositor's off-screen RT, replaces `Present` with `Composite`.
- `WS_EX_LAYERED` style on the viewport popup; revert parent-class
  brush to `nullptr`.
- `AlphaCompositor::SetOcclusion(id, rect, feather)` /
  `RemoveOcclusion(id)` — owns the occlusion map; stamps alpha to 0
  inside the rect, smoothstep-ramps from 0 → 0xFF over a configurable
  feather band at the rect's outer edge (default 3 px).
- `LayoutBroker` forwards `SetOcclusion`/`RemoveOcclusion` to
  `AlphaCompositor`; the old HRGN-building path
  (`RebuildPopupRegion` + `SetWindowRgn`) is deleted.
- `MenuBar`'s `CONTENT` class regains `shadow-xl` — the layered popup
  composites it cleanly inside occluded regions.

**Out**
- Engine pipeline alpha rework (FD9 option a). Engine still renders
  fully opaque pixels inside the viewport; transparency comes from
  the alpha-stamp at occluded chrome rects.
- Removing `viewport/occlude` from the bridge schema (FD9 option a's
  original cleanup) — we still need this protocol.
- Throttling readback to 60 FPS / async readback / front-buffer
  alternatives — performance follow-up if FPS regresses below 60.

## What the codebase gives us

- `src/engine.cpp:567` `Engine::Render`: captures slot-0 RT into
  `pScreenSurface` at line 627, restores it at line 845, calls
  `Present` at line 876. Inserting a `SetRenderTarget(0, off-screen)`
  before line 627 redirects the captured pScreenSurface, so the
  whole composite chain flows through our RT without other edits.
- `src/engine.h:121` `Engine::GetDevice()` — public accessor for
  `IDirect3DDevice9*`. No new accessor needed.
- `src/host/HostWindow.cpp:792` viewport popup CreateWindowExW —
  the spot where `WS_EX_LAYERED` is added.
- `src/host/HostWindow.cpp:1281` `wc.hbrBackground = CreateSolidBrush
  (RGB(40, 22, 56))` — FD8 polish under-paint; can revert.
- `src/host/LayoutBroker.{h,cpp}` already has `SetOcclusion`,
  `RemoveOcclusion`, `RebuildPopupRegion`, `m_occlusions`. The first
  two stay (forwarding); the third is deleted and the map moves to
  `AlphaCompositor`.
- `src/ParticleEditor.vcxproj` host ItemGroups at lines 195–252 are
  the pattern for adding a new host TU with `Win32` exclusion.

## Architecture / implementation approach

### Pipeline per frame

```
Engine::Render
├── SetRenderTarget(0, alphaCompositor->GetRenderTarget())   [new preamble]
├── (existing render passes: scene → bloom → distort → final)
└── alphaCompositor->Composite(hViewport)                    [replaces Present]
        ├── device->GetRenderTargetData(offscreenRT, sysMem)
        ├── lock sysMem, memcpy into DIB (matching pitch)
        ├── stampOcclusions(dib, occlusionMap)               [NEW]
        └── UpdateLayeredWindow(hViewport, …, dib, ULW_ALPHA)
```

### `AlphaCompositor` interface

```cpp
namespace host {

class AlphaCompositor {
public:
    explicit AlphaCompositor(IDirect3DDevice9* device);
    ~AlphaCompositor();

    AlphaCompositor(const AlphaCompositor&) = delete;
    AlphaCompositor& operator=(const AlphaCompositor&) = delete;

    void Resize(int width, int height);
    IDirect3DSurface9* GetRenderTarget() const;

    // Stamp the layered alpha to 0 inside `rectClient` with a
    // `feather` px smoothstep falloff at the boundary. `rectClient`
    // is in popup-client coords (same coords as the DIB). Replaces
    // any prior occlusion with the same id. Thread-safe? — single
    // thread (UI), no locking.
    void SetOcclusion(std::string id, RECT rectClient, int feather = 3);
    void RemoveOcclusion(const std::string& id);

    // Per-frame: GPU readback + alpha stamp + UpdateLayeredWindow.
    void Composite(HWND layeredHwnd);

private:
    struct Impl;
    std::unique_ptr<Impl> m_impl;
};

} // namespace host
```

### Alpha stamp math

For each occlusion rect `R` (inset by the feather band on the outer
edge):
- For pixels inside `R` strictly: write `alpha = 0`.
- For pixels in the `feather`-pixel ring outside `R`: write
  `alpha = lerp(0, currentAlpha, smoothstep(0, feather, d))` where
  `d` is the Chebyshev distance from the rect's outer edge.

Implementation: for each scanline that intersects `R`'s feather
zone, walk columns once and either zero the pixel's A byte or
multiply it by a precomputed smoothstep weight (LUT of size
`feather + 1`). The DIB byte order is `BGRA` little-endian =
`B G R A` in memory; A is the 4th byte. Direct `dst[x*4 + 3] = α`.

### `Engine::Render` changes

Preamble (top of function, after the cooperative-level check):

```cpp
if (m_pAlphaCompositor && m_pAlphaCompositor->GetRenderTarget()) {
    m_pDevice->SetRenderTarget(0, m_pAlphaCompositor->GetRenderTarget());
}
```

Replace `m_pDevice->Present(NULL, NULL, NULL, NULL);` with:

```cpp
if (m_pAlphaCompositor) {
    m_pAlphaCompositor->Composite(m_presentationParameters.hDeviceWindow);
} else {
    m_pDevice->Present(NULL, NULL, NULL, NULL);
}
```

`Engine::Reset` end-of-function:

```cpp
if (m_pAlphaCompositor) {
    RECT rc{};
    if (GetClientRect(m_presentationParameters.hDeviceWindow, &rc)) {
        m_pAlphaCompositor->Resize(rc.right - rc.left, rc.bottom - rc.top);
    }
}
```

### `LayoutBroker` changes

- Keep `SetOcclusion(id, rect)` / `RemoveOcclusion(id)` signatures.
- Delete `m_occlusions` map (moves to `AlphaCompositor`).
- Delete `RebuildPopupRegion` (and the calls to it in `Apply`,
  `RefreshScreenPosition`, `PredictAndApply`).
- Add `void SetAlphaCompositor(host::AlphaCompositor*)`.
- `SetOcclusion` / `RemoveOcclusion` forward to the compositor (when
  installed). When `m_compositor == nullptr` (viewport_poc / pre-init),
  silently no-op — matches today's behaviour where occlusion calls
  before viewport-rect arrival are also harmless.

### `HostWindow` integration

After `engine = std::make_unique<Engine>(...)`:

```cpp
try {
    alphaCompositor = std::make_unique<host::AlphaCompositor>(engine->GetDevice());
    RECT vrc{};
    GetClientRect(hViewport, &vrc);
    alphaCompositor->Resize(vrc.right - vrc.left, vrc.bottom - vrc.top);
    engine->SetAlphaCompositor(alphaCompositor.get());
    layout.SetAlphaCompositor(alphaCompositor.get());
    Log("[host] AlphaCompositor up\n");
} catch (const std::exception& e) {
    Log("[host] AlphaCompositor init failed: %s — falling back\n", e.what());
    alphaCompositor.reset();
}
```

`hViewport = CreateWindowExW(…)` gets `WS_EX_LAYERED` added.

`wc.hbrBackground = nullptr` (revert the FD8 polish under-paint).

Shutdown ordering (WM_DESTROY): detach Engine + LayoutBroker pointers
to compositor BEFORE destroying compositor:

```cpp
if (engine) engine->SetAlphaCompositor(nullptr);
layout.SetAlphaCompositor(nullptr);
alphaCompositor.reset();
engine.reset();
```

## Risks named up front

1. **Engine alpha = 0xFF everywhere, so the popup is fully opaque
   outside occlusion rects.** *Mitigation*: that's by design — the
   viewport pixels SHOULD be opaque against the WebView. Occlusion
   rects are the only places where we want WebView to show through.
2. **Composite-shader writes alpha differently than expected.** Risk:
   the final composite quad at engine.cpp:851–873 runs the distort
   shader which writes RGBA. If the shader writes alpha=0 somewhere,
   we'd accidentally cut out a hole in the viewport. *Mitigation*:
   verify visually at task 5 step 6 (viewport should look like a
   fully-opaque rectangle, no random transparent patches).
3. **Modal sizemove resize storm.** Risk: continuous resize triggers
   `Engine::Reset` → `AlphaCompositor::Resize` → reallocate RT/DIB
   every frame. Could be slow or cause flicker. *Mitigation*:
   `Resize` is idempotent on unchanged (w, h). For continuous resize,
   the resize-per-event cost is dominated by the device Reset anyway.
4. **Performance: full-frame readback every tick.** ~944×337×4 ≈
   1.3 MB/frame; readback ~1–4 ms. Current FPS 200+; expected 80–150.
   *Mitigation*: acceptable for a particle editor at 60 FPS floor;
   step 8 measures. If FPS < 60 with the default scene, defer to a
   follow-up (throttle / async).
5. **Occlusion map race.** Risk: `SetOcclusion` could be called from
   a non-render thread. *Mitigation*: today's `LayoutBroker` is only
   touched from the UI thread; `BridgeDispatcher` runs requests on
   that thread via WebView2 message routing. Document with a comment;
   single-thread invariant.
6. **`engine->GetDevice()` returns nullptr if Engine init failed.**
   The HostWindow already wraps Engine construction in try/catch; if
   it fails, `engine` is reset. *Mitigation*: also guard the
   compositor construction — only attempt if `engine && engine->GetDevice()`.

## Testing & verification

**Per-task build:** MSBuild x64 Debug clean, 0 warnings, 0 errors,
after each task's commit.

**Final visual gate (at task 6):**
- Launch `x64/Debug/ParticleEditor.exe --new-ui`.
- Open each top-level menu in turn — File / Edit / Emitters / Mods
  / View / Help. The dropdown should appear with `shadow-xl` soft
  shadow visible, and the edges where the dropdown overlaps the
  viewport should blend smoothly (no hard pixel seam).
- Open each tool panel (Lighting, Bloom, Background, Ground Texture,
  Spawner). The panel sits over the viewport with smooth edges.
- Resize the editor by dragging — viewport tracks, no flash.
- Status-bar FPS — record the value with the default empty scene
  (ground plane + skybox). Acceptance: ≥ 60.
- Camera drag in the viewport for ~30 s — smooth, no stutter.

**Native test gate (at task 8):**
- `pnpm test:native` — current count 76 passing. Expect 76 still
  passing; no test specifically targets the cut-out mechanism so
  the change should be invisible.

## Tasks

- [ ] **T1.** Create `AlphaCompositor.{h,cpp}` skeleton + vcxproj
  entries (Win32-excluded mirror of other host TUs). Builds.
- [ ] **T2.** Implement `AlphaCompositor::Resize` — RT, SysMem
  surface, DIB section + memDC. Idempotent on unchanged size.
- [ ] **T3.** Implement `AlphaCompositor::Composite` (readback +
  memcpy + `UpdateLayeredWindow`). No occlusion stamp yet.
- [ ] **T4.** Implement `AlphaCompositor::SetOcclusion` /
  `RemoveOcclusion` + the stamp pass in `Composite` with
  smoothstep feather.
- [ ] **T5.** Hook into `Engine` — `SetAlphaCompositor`, Render RT
  swap + Composite, Reset re-resize.
- [ ] **T6.** Wire `HostWindow`: `WS_EX_LAYERED`, compositor
  construction, attach to Engine + LayoutBroker, shutdown order.
  Revert parent-class brush. **Visual gate here.**
- [ ] **T7.** Strip `LayoutBroker::RebuildPopupRegion` +
  `m_occlusions`; forward `SetOcclusion`/`RemoveOcclusion` to
  `AlphaCompositor`. Add `SetAlphaCompositor`.
- [ ] **T8.** Restore `shadow-xl` on `MenuBar` `CONTENT` class.
- [ ] **T9.** Final native-test pass + visual recheck. Commit a
  polish patch if anything surfaced. Update `CHANGELOG.md` +
  `ROADMAP.md` (LT-4 Phase 4.1 closer commit).

## Review

(filled in after execution)
