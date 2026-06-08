# tasks/mt-11-phase-3-stage-1-followup-cache-deferral.md

[MT-11] Phase 3 Stage 1 follow-up — AlphaCompositor `lastRawDib`
per-frame cache deferral.

**Status:** plan drafted 2026-05-22, branched off `origin/lt-4`
at `ad7d294` (Phase 3 Stage 1g shipped).

**Difficulty:** ★★ (single-file logic change with a tested boundary).

**Effort estimate:** ~3-4 hours including tests + perf re-verify.

**Predecessor:** Phase 3 Stage 1 (D3D9Ex migration, `ad7d294`).
**Successor:** unblocks clean baseline for Phase 3 Stage 4 (the
dibCopy fix — architectural, separate plan).

---

## 1. Goal + scope

**What ships:** per-frame `lastRawDib` memcpy at
[src/host/AlphaCompositor.cpp:597-612](src/host/AlphaCompositor.cpp:597-612)
no longer runs in the FD9b WS_EX_LAYERED (arch B) path. Expected
gain at maximized 3440×1440: ~50 → ~58 FPS (~15%, ~2-5 ms/frame
reclaimed). The MT-11 Phase 1 canvas-JPEG (arch C) path continues
to maintain the cache because `EncodeFrameJpeg` depends on it.

**In scope:**

- Gate the `lastRawDib` refresh in `Composite()` on an explicit
  flag, default off.
- `FramePublisher` constructor flips the flag on (arch-C-only
  consumer of the cache).
- Rewrite `CaptureSnapshotPng` to be self-sufficient: re-issue
  `GetRenderTargetData(offscreenRT → sysMemSurface)` + LockRect
  + GDI+ encode on demand, no `lastRawDib` dependency.
- Preserve scene-rect cropping behavior (T4c.5).
- Preserve the L-013 sentinel-rect / one-shot-capture polish
  (commit `cb7b4c7`) for modals during Win32 drag-resize.
- New native test asserting the cache flag default-off behavior
  + the on-demand snapshot path.

**Out of scope:**

- The dibCopy (~12 ms) bottleneck — Phase 3 Stage 4 architectural
  fix.
- Any DXGI / D3D11 / DComp work.
- Engine rendering optimizations.
- Removing `lastRawDib` entirely — `EncodeFrameJpeg` still needs
  it for the arch-C per-frame frame-server.
- Touching `HostWindow.cpp` — the parallel webview-hosting
  migration session is in there; we route the flag flip through
  `FramePublisher`'s constructor instead.

---

## 2. What the codebase already gives us

- [`AlphaCompositor::Impl`](src/host/AlphaCompositor.cpp:45-78) —
  already has the `lastRawDib` / `lastRawW` / `lastRawH` fields
  and the scene-rect fields. No new fields needed beyond one
  boolean.
- [`AlphaCompositor::Composite`](src/host/AlphaCompositor.cpp:568-672) —
  the existing flow already separates the readback (lines 576-595)
  from the cache update (597-612) from the stamps (614-656). The
  cache block is a clean inline section we can wrap in `if`.
- [`AlphaCompositor::CaptureSnapshotPng`](src/host/AlphaCompositor.cpp:477-566) —
  already does scene-rect cropping + GDI+ PNG encode + base64. We
  just need to prepend a fresh `GetRenderTargetData` + LockRect +
  memcpy into a local buffer instead of reading `lastRawDib`.
- [`FramePublisher` constructor](src/host/FramePublisher.cpp) — already
  receives `AlphaCompositor*`. One-line call site for the setter.
- The `offscreenRT` invariant: stamps mutate `dibPixels` only, never
  the GPU render target. So `offscreenRT` always holds clean
  pre-stamp engine pixels between `Engine::Render` calls — safe to
  re-readback any time.

---

## 3. Architecture / implementation approach

### 3.1 New public API on AlphaCompositor

```cpp
// AlphaCompositor.h
//
// Enable the per-frame pre-stamp DIB cache used by
// EncodeFrameJpeg in arch-C (canvas-JPEG transport). Off by
// default — the legacy FD9b layered-popup path doesn't need the
// cache and reclaims ~2-5 ms/frame at large viewport sizes by
// skipping it.
//
// Idempotent. Disabling clears the cache buffer.
void SetPerFrameCacheEnabled(bool enabled);
```

Implementation: stores a bool on `Impl`; the disable path
`lastRawDib.clear()` + `shrink_to_fit()` to release the ~19 MB.

### 3.2 Gated cache block in Composite

```cpp
// AlphaCompositor.cpp:597-612 — wrapped in flag check
if (m_impl->perFrameCacheEnabled)
{
    const size_t bytes = static_cast<size_t>(m_impl->width) *
                         static_cast<size_t>(m_impl->height) * 4u;
    if (m_impl->lastRawDib.size() != bytes)
        m_impl->lastRawDib.resize(bytes);
    memcpy(m_impl->lastRawDib.data(), dst, bytes);
    m_impl->lastRawW = m_impl->width;
    m_impl->lastRawH = m_impl->height;
}
```

Nothing else in `Composite()` changes.

### 3.3 Self-sufficient CaptureSnapshotPng

Pseudocode:

```cpp
bool AlphaCompositor::CaptureSnapshotPng(std::string& outBase64,
                                          int& outW, int& outH)
{
    if (!m_impl->offscreenRT || !m_impl->sysMemSurface) return false;
    if (m_impl->width <= 0 || m_impl->height <= 0) return false;

    // Fresh readback. offscreenRT holds the most recent
    // Engine::Render output unmutated; stamps mutate dibPixels only.
    HRESULT hr = m_impl->device->GetRenderTargetData(
        m_impl->offscreenRT.Get(), m_impl->sysMemSurface.Get());
    if (FAILED(hr)) return false;

    D3DLOCKED_RECT locked = {};
    hr = m_impl->sysMemSurface->LockRect(&locked, nullptr, D3DLOCK_READONLY);
    if (FAILED(hr)) return false;

    // Snapshot is one-shot — copy into a local buffer so the
    // LockRect window is as short as possible (we don't want to
    // hold the SYSTEMMEM surface lock through PNG encoding).
    const int srcW = m_impl->width;
    const int srcH = m_impl->height;
    const int stride = srcW * 4;
    std::vector<uint8_t> rawDib(static_cast<size_t>(stride) *
                                static_cast<size_t>(srcH));
    const auto* src = static_cast<const uint8_t*>(locked.pBits);
    for (int y = 0; y < srcH; ++y)
        memcpy(rawDib.data() + y * stride, src + y * locked.Pitch, stride);

    m_impl->sysMemSurface->UnlockRect();

    // ... existing scene-rect crop + GDI+ Bitmap + PNG encode +
    // base64 (unchanged, just sourced from rawDib instead of
    // m_impl->lastRawDib)
}
```

The fallback for `sceneW <= 0 || sceneH <= 0` (boot state /
vitest harness) stays identical.

### 3.4 FramePublisher flip

In `FramePublisher::FramePublisher(...)`:

```cpp
FramePublisher::FramePublisher(AlphaCompositor* compositor,
                               EmitFn emit, int quality)
    : m_compositor(compositor), m_emit(std::move(emit)),
      m_quality(quality)
{
    if (m_compositor) m_compositor->SetPerFrameCacheEnabled(true);
}
```

Symmetric clear could go in `~FramePublisher()` but
`FramePublisher` is destroyed in WM_DESTROY just before the
compositor — clearing is wasted. Skip it.

---

## 4. Risks named up front + mitigations

1. **Modal-open latency increase.** Today (cache hit): 0 ms. After:
   ~12-15 ms (one-shot GetRenderTargetData + LockRect). The user
   triggers modal-opens via Help → About, dialogs, etc. — actions
   that already have visible user-time on the order of 50-100 ms
   (DOM mount + React reflow). Adding ~12 ms is imperceptible.
   **Mitigation: accept.**

2. **Stale snapshot during drag-resize (L-013 / cb7b4c7 path).**
   When the Win32 modal sizing loop owns the message pump,
   `Composite` doesn't run, but `Engine::Render` also doesn't run
   — so `offscreenRT` holds the pre-resize frame. Our re-readback
   in `CaptureSnapshotPng` gets that frame, which is exactly what
   the existing one-shot-capture polish at `cb7b4c7` already
   relied on. **Mitigation: no behavior change vs. today; the
   existing dialogs.spec / canvas-architecture.spec coverage
   exercises this path.**

3. **D3DERR_DEVICELOST in the snapshot path.** If the device is
   lost between Composite and the snapshot call,
   `GetRenderTargetData` returns failure. Today the cached path
   would still return a stale-but-valid PNG; after this change it
   returns `false` and the React backdrop falls back to its
   solid-color base. **Mitigation: this is the correct behavior
   — a stale PNG after device-lost would be from a previous
   resolution / state. Accept.**

4. **vitest harnesses that drive `CaptureSnapshotPng` directly
   without prior `Composite`.** Today: `lastRawDib.empty()` →
   returns false. After: same outer guard structure — `offscreenRT
   == nullptr` → returns false. The harness must have called
   `Resize()` first (it does). **Mitigation: keep the guard at
   the top of the function (lines 478-481 equivalent).**

5. **Textual merge conflict with the parallel webview-hosting
   migration session on CHANGELOG.md / ROADMAP.md.** Both will
   append at the top. **Mitigation: trivial to resolve at FF
   time. Coordinate via the session names in the commit messages
   so the order is unambiguous.**

---

## 5. Testing & verification

### 5.1 Happy paths

- [ ] Build clean: MSBuild Debug + Release x64 zero warnings/errors.
- [ ] vitest: 335/335 green.
- [ ] Playwright native: 96/96 green, including the modal-backdrop
      spec (`dialogs.spec.ts` and/or `canvas-architecture.spec.ts`).

### 5.2 Native test (new)

Add a test in `web/apps/editor/tests/native/` (likely
`alpha-compositor-cache.spec.ts` or extend
[d3d9ex.spec.ts](web/apps/editor/tests/native/d3d9ex.spec.ts)) that:

- [ ] Boots the host without arch-C env var.
- [ ] Drives a frame through Composite (or asserts via a debug log
      surface that `lastRawDib` stays empty after N frames).
- [ ] Invokes the `viewport/capture-snapshot` bridge command.
- [ ] Asserts a non-empty base64 PNG comes back AND the snapshot
      dimensions match the popup client area / scene rect.

### 5.3 Manual smoke (3440×1440 maximized)

- [ ] Open Help → About modal. Backdrop is engine pixels (not
      opaque/black/wrong). Frosted-glass effect intact.
- [ ] Open a non-modal dialog (File Open, etc.) — same.
- [ ] Drag-resize the main window with a modal open (L-013
      regression path). Backdrop remains the pre-resize frame.

### 5.4 Manual perf re-verify

- [ ] Re-instrument with the per-phase timing pattern from the
      original investigation (the one the user removed from
      working tree). Confirm `cacheCopy` phase reads ~0.00 ms
      every frame in arch-B mode.
- [ ] Confirm total frame time < 17 ms at maximized 3440×1440.
- [ ] Confirm FPS ≥ 58 (steady state, no scene churn).
- [ ] Revert the instrumentation before the final commit (debug
      print blocks are tagged for grep; remove tag prefix
      `[CACHE-DEFERRAL-PERF]`).

### 5.5 Arch-C regression check

- [ ] Run editor with `ALO_VIEWPORT_TRANSPORT=canvas-jpeg`.
      `FramePublisher` constructs, calls
      `SetPerFrameCacheEnabled(true)`, viewport renders normally
      via the canvas-JPEG path. No regression vs. pre-fix.

### 5.6 Acceptance (per task spec)

- [x] vitest 335/335 — *to be confirmed at ship*
- [x] Playwright native 96/96 — *to be confirmed at ship*
- [x] MSBuild Debug + Release x64 clean — *to be confirmed*
- [x] Modal backdrop visually intact — *manual smoke above*
- [x] cacheCopy phase ~0 ms, total < 17 ms, FPS ≥ 58 — *manual perf*
- [x] Same modal backdrop appearance as today — *manual smoke above*

---

## 6. Execution order

1. Plan checked in (this file). ✓
2. Implement `SetPerFrameCacheEnabled` on `AlphaCompositor.h/.cpp` +
   `perFrameCacheEnabled` field on `Impl`.
3. Gate the cache block in `Composite()`.
4. Rewrite `CaptureSnapshotPng()` (fresh readback path).
5. Wire `FramePublisher` constructor to flip the flag on.
6. New native test for cache-flag-off + snapshot path.
7. Manual build + smoke + perf re-verify.
8. CHANGELOG + ROADMAP entries (Shipped section).
9. FF into `lt-4` (coordinate with webview-hosting session for
   ordering on shared files: CHANGELOG.md, ROADMAP.md).

Each step has a verify gate before the next starts.

---

## 7. Files touched (full enumeration)

- `src/host/AlphaCompositor.h` — public API addition.
- `src/host/AlphaCompositor.cpp` — flag field, gated cache,
  rewritten `CaptureSnapshotPng`.
- `src/host/FramePublisher.cpp` — constructor flips flag.
- `web/apps/editor/tests/native/<spec>.ts` — new coverage.
- `CHANGELOG.md` — Shipped entry.
- `ROADMAP.md` — N/A unless this lands a tagged item (this is a
  follow-up perf polish, not a tagged ROADMAP line).

**Explicitly NOT touched:** `HostWindow.cpp`, `BridgeDispatcher.cpp`,
`LayoutBroker.cpp`, any WebView2-adjacent file. This keeps the
diff disjoint from the parallel webview-hosting migration session.

---

## 8. Coordination notes for parallel session

The other in-flight session is doing the WebView2 hosting migration,
which touches `HostWindow.cpp` heavily. Decoupling decisions:

- We route the cache-flag flip through `FramePublisher`'s
  constructor, NOT through a new line in `HostWindow.cpp`.
- The only files at risk of textual conflict are `CHANGELOG.md`
  and `ROADMAP.md`. Both append-at-top; conflicts are trivial.
- No shared logic / state — both changes can land in either order.
