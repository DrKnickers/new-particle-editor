# B1.3.1.1 — Frosted-glass modal backdrop via engine-snapshot capture (NEXT DISPATCH)

**Status:** planning — pending user sign-off before P2 begins. Plan refined from a long investigation in the prior B1.3.1 session — see Hand-off context section below for why this is the right approach.

**Started:** 2026-05-21
**HEAD at planning:** `52bb032` (B1.3.1 polish rounds 7-9 commit). Predecessor on `origin/lt-4` is `f12d6f2`; the in-flight session branch `claude/agitated-margulis-854108` has 10 commits ahead, all under the B1.3.1 dispatch banner.
**Goal:** Replace the failed modal-mask + edge-feather approach with a captured engine snapshot rendered as an `<img>` in the WebView2 DOM, so `Dialog.Overlay`'s existing `bg-black/60 backdrop-blur-sm` blurs both panels AND the snapshot uniformly — the "snapshot the UI, blur it, use as popup background" intent the user finally articulated.

**Tech stack:** C++ (HostWindow / AlphaCompositor / BridgeDispatcher / LayoutBroker), GDI+ for PNG encoding, bridge-schema TypeScript, React Modal primitive.

---

## 1. Goal + scope

### Goal

Eliminate the "inner-shadow halo" artifact around modals' popup boundary by frosted-glassing the entire visible background — engine viewport + WebView2 panels — through a single CSS path (`Dialog.Overlay`'s `backdrop-blur-sm bg-black/60`). Engine viewport is captured to a PNG snapshot, sent to React, rendered as an `<img>` inside the viewport-quadrant DOM, and the engine popup is fully alpha-cut while the modal is open. CSS then blurs panels + snapshot uniformly, and the popup HWND boundary becomes invisible because both sides of it are now WebView2-rendered.

### Hand-off context (read first if you're a fresh session)

The prior dispatch (B1.3.1 polish rounds 7-9) added a server-side compositor pipeline that blurs + dims the engine viewport pixels directly, plus an edge-feather of the popup HWND boundary. The dim/blur work. The edge-feather produces a visible **inner-shadow vignette** because:

- Pixel math (with `globalAlpha=0.4`, Dialog.Overlay `bg-black/60` over panels):
  - Popup center luminance ≈ `engine*0.4 + panel*0.24` ≈ ~60
  - Popup mid-fade band luminance ≈ `engine*0.2 + panel*0.8 * dst-luminance` ≈ ~35 (mid-fade has LESS engine + MORE dst showing through)
  - Popup outermost edge / just outside popup ≈ `panel * 0.4` ≈ ~10
- A smooth visual transition would have endpoints at the same luminance. Mine doesn't — center is bright (engine + slight panel), edge is dim (pure panel via dst). The mid-fade band hits a luminance VALLEY where dst dominates, reading as a dark vignette.
- Algebraically can't be tuned away — the cause is structural: CSS effects can't span the engine compositing layer, so any attempt to bridge the popup boundary by feathering its alpha reveals the underlying dim instead of bridging gradients.

The snapshot-into-DOM approach lifts the engine into the WebView2 DOM tree (frozen at one frame), so CSS effects sample it natively. No layer boundary. No algebra needed.

### In scope (B1.3.1.1)

1. **C++ snapshot capture surface.** New `viewport/capture-snapshot` bridge request that returns the current engine DIB as a base64-encoded PNG + dimensions.
2. **React Modal rewiring.** On open: request snapshot, render an `<img>` into the viewport-quadrant DOM via `createPortal`, send a full-quadrant `viewport/occlude` so the engine popup goes fully transparent. On window resize: re-capture and re-send (rAF-throttled). On close: undo everything.
3. **Remove the modal-mask compositor path.** Delete the now-dead `SetModalMask`, `BoxBlurDibBgra`, `MultiplyDibAlphaBgra`, `FadePopupEdges`, `Smoothstep01Edge`, the `m_globalAlpha`/`m_blurRadius`/`m_blurScratch` fields, the `viewport/set-modal-mask` bridge surface, the schema, the MockBridge case, the Modal dispatch, and the regression test.

### Out of scope

- Nested modals — not currently a use case; skip.
- Pausing the engine while a modal is open — wasted CPU/GPU but doesn't break anything; defer until perf becomes a real complaint.
- Refresh-while-modal-open for engine state changes (e.g., spawner auto-firing while About is up) — the snapshot is intentionally frozen during modal lifecycle. Resize is the only re-capture trigger.
- Raw BGRA over the bridge — start with PNG; only fall back if encode latency proves user-visible.

---

## 2. What the codebase already gives us

| Surface | Where | What it provides |
|---|---|---|
| AlphaCompositor's DIB | [`src/host/AlphaCompositor.cpp`](../src/host/AlphaCompositor.cpp) | Engine pixels are already memcpy'd to a CPU-side DIB on every `Composite()`. Snapshot just needs to copy that buffer before chrome-stamps. |
| GDI+ on Windows SDK | system | PNG encoding via `Gdiplus::Bitmap::Save` + PNG encoder CLSID. Requires one-time `GdiplusStartup` / matching `GdiplusShutdown`. |
| Bridge dispatcher | [`src/host/BridgeDispatcher.cpp`](../src/host/BridgeDispatcher.cpp) | Pattern: `if (kind == "...") { read params; do work; sendOk(json); return; }`. Match existing `viewport/occlude` shape. |
| LayoutBroker | [`src/host/LayoutBroker.h`](../src/host/LayoutBroker.h) | Already forwards occlusion calls to the compositor. The capture path can bypass LayoutBroker — the dispatcher can call AlphaCompositor directly since the host owns a pointer. |
| MockBridge | [`web/apps/editor/src/bridge/mock.ts`](../web/apps/editor/src/bridge/mock.ts) | Pattern: switch case on `req.kind`. Return a stub (empty PNG, w=0, h=0) so MockBridge satisfies the schema for unit tests. |
| BridgeContext | [`web/apps/editor/src/lib/bridge-context.ts`](../web/apps/editor/src/lib/bridge-context.ts) | New file from B1.3.1 polish round 8. Provides the live NativeBridge to deep consumers without `window.bridge` (which is broken under TestHostBridge swap). |
| Quadrant-viewport DOM node | [`web/apps/editor/src/App.tsx`](../web/apps/editor/src/App.tsx) (`data-testid="quadrant-viewport"`) | The `<div>` that holds the engine viewport overlay. The snapshot `<img>` will be portaled into here. |
| Modal callback-ref pattern | [`web/apps/editor/src/components/Modal.tsx`](../web/apps/editor/src/components/Modal.tsx) | Already established for handling Radix Dialog.Content's delayed mount via Portal+Presence — useState + callback ref forces a re-render when the node attaches. Reuse the same pattern for the quadrant-viewport lookup. |

No new dependencies. GDI+ is in `gdiplus.lib` from the Windows SDK; one extra `#pragma comment(lib, "gdiplus.lib")` in the host project.

---

## 3. Architecture / implementation approach

### Phase 1 — C++ capture path

**1.1 AlphaCompositor caches a pre-stamp DIB.**
Add a `std::vector<uint8_t> m_lastRawDib` field plus `int m_lastRawW, m_lastRawH`. On every `Composite()`, after the memcpy from sysmem but BEFORE the occlusion-stamp loop, copy the freshly-read pixels into `m_lastRawDib`. This is the "what the engine actually rendered this frame" before any chrome cuts. ~1-2 ms/frame extra cost on a typical viewport size.

**1.2 New method `AlphaCompositor::CaptureSnapshotPng(std::string& outBase64, int& outW, int& outH)`.**
Returns `bool` (false if no DIB cached yet — engine never composited). On success:
- Wrap `m_lastRawDib` in a `Gdiplus::Bitmap` constructed with `PixelFormat32bppPARGB` (premultiplied — matches the DIB format).
- Create an `IStream*` via `CreateStreamOnHGlobal`.
- Call `bitmap.Save(stream, &pngClsid, nullptr)` where pngClsid comes from `GetEncoderClsid(L"image/png", ...)`.
- Read stream into a `std::vector<uint8_t>`.
- Base64-encode (inline 30-line encoder, no new dep).
- Write to `outBase64`, set `outW = m_lastRawW`, `outH = m_lastRawH`.

**1.3 GDI+ initialization.**
In `HostWindow::Run`'s startup: `Gdiplus::GdiplusStartup(&token, &input, nullptr)`. Matching `Gdiplus::GdiplusShutdown(token)` at teardown. Both calls bracket the entire app lifecycle — once per process.

**1.4 BridgeDispatcher handler.**
Add `if (kind == "viewport/capture-snapshot") { ... }`:

```cpp
std::string pngBase64;
int w = 0, h = 0;
if (m_alphaCompositor && m_alphaCompositor->CaptureSnapshotPng(pngBase64, w, h)) {
    sendOk(json{{"pngBase64", pngBase64}, {"w", w}, {"h", h}});
} else {
    sendOk(json{{"pngBase64", ""}, {"w", 0}, {"h", 0}});
}
```

The compositor pointer wiring: check what's already in BridgeDispatcher. If LayoutBroker holds the compositor reference, route through it (`m_layout.GetCompositor()`); otherwise add a direct setter `SetAlphaCompositor` paralleling `SetEngine` / `SetModManager`.

**1.5 Bridge schema additions.**

```ts
| { kind: "viewport/capture-snapshot"; params: Record<string, never> }

// ResponseFor:
R extends { kind: "viewport/capture-snapshot" } ? { pngBase64: string; w: number; h: number } :
```

**1.6 MockBridge stub.**
`case "viewport/capture-snapshot": return { pngBase64: "", w: 0, h: 0 };`

### Phase 2 — React Modal rewiring

**2.1 Drop the existing occlusion + modal-mask code in Modal.**
- Remove the `useEffect` that fires `viewport/occlude` with Dialog.Content's rect.
- Remove the `useEffect` (same block) that fires `viewport/set-modal-mask`.
- Both get replaced with a single unified flow in 2.2.

**2.2 New Modal useEffect — snapshot capture + full-quadrant occlude.**

State:
```ts
const [snapshot, setSnapshot] = useState<{ pngBase64: string; w: number; h: number } | null>(null);
const [viewportEl, setViewportEl] = useState<HTMLElement | null>(null);
```

Effect (deps: `[open, bridge]`):
- If `!open || !bridge`: return early.
- Look up the quadrant-viewport node: `document.querySelector('[data-testid="quadrant-viewport"]')`. Set `viewportEl`.
- Define an async `capture()`: request `viewport/capture-snapshot`, set into `snapshot` state.
- Define `occlude()`: read `viewportEl.getBoundingClientRect()`, send `viewport/occlude` with the full quadrant rect (id `"modal-backdrop"`).
- Fire `capture()` + `occlude()` immediately.
- Subscribe to window `resize` with a single rAF-throttled handler that calls both. Cancel the rAF on cleanup.
- Return cleanup: cancel rAF, remove listener, clear `snapshot`, send `viewport/occlude` with `rect: null`.

**2.3 Render the snapshot via `createPortal`.**
At the end of the Modal component's JSX, before the `Dialog.Root`:

```tsx
{open && viewportEl && snapshot && createPortal(
  <img
    src={`data:image/png;base64,${snapshot.pngBase64}`}
    alt=""
    aria-hidden
    style={{
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      pointerEvents: "none",
    }}
  />,
  viewportEl,
)}
```

The img sits inside the quadrant-viewport DOM node, at z-index 0 (default), below Dialog.Overlay (z-40) and Dialog.Content (z-50). Dialog.Overlay's `bg-black/60 backdrop-blur-sm` blurs everything in the DOM behind it — including this img — uniformly with the panels. **This is the win condition.**

### Phase 3 — Delete the dead modal-mask code

After 2.x is shipping the snapshot path successfully:

**3.1 C++ removals.**
- `AlphaCompositor.{h,cpp}`: `SetModalMask`, `BoxBlurDibBgra`, `MultiplyDibAlphaBgra`, `FadePopupEdges`, `Smoothstep01Edge`, the `m_globalAlpha` / `m_blurRadius` / `m_blurScratch` fields, the corresponding calls in `Composite`.
- `LayoutBroker.{h,cpp}`: `SetModalMask` declaration + forwarding.
- `BridgeDispatcher.cpp`: the `viewport/set-modal-mask` handler.

**3.2 Schema / mock removals.**
- `web/packages/bridge-schema/src/index.ts`: the `viewport/set-modal-mask` request + response.
- `web/apps/editor/src/bridge/mock.ts`: the `viewport/set-modal-mask` case.

**3.3 Test updates.**
- `Modal.test.tsx`: remove `dispatches viewport/set-modal-mask on open ...`. Add `dispatches viewport/capture-snapshot when open and clears occlusion on close`.

---

## 4. Risks named up front + mitigations

1. **PNG encode latency under drag.**
   - **Hazard:** GDI+ PNG encode at 1280×720 takes ~10-30 ms. At 60 fps drag, that's 600-1800 ms/sec of CPU just on encoding, plus a similar cost in base64 + bridge transit. The drag might feel laggy.
   - **Mitigation:** Throttle re-capture to rAF (~16 ms) instead of every resize event — this already coalesces multiple ResizeObserver fires per frame into one. If that's still too slow, fall back to raw BGRA (skip PNG encode, accept 3-6 MB base64 per capture). Measure first.

2. **Bridge payload size.**
   - **Hazard:** A 1280×720 PNG of dense 3D content can hit 200-500 KB; base64 inflates to 270-680 KB. `chrome.webview.postMessage` handles big payloads but it's not instant.
   - **Mitigation:** Compare PNG vs raw BGRA on a representative scene. Pick whichever is faster end-to-end. Document the choice.

3. **Snapshot misalignment during fast drag.**
   - **Hazard:** Between the user's drag tick and React's rAF, the snapshot is one frame stale. If the engine viewport position has moved 50 pixels in that frame, the snapshot is offset.
   - **Mitigation:** Use the *current* `getBoundingClientRect` of the quadrant element when positioning the img (which is `position: absolute; inset: 0` inside the parent — so it tracks the parent's natural CSS rect, which DOES update in real time). Only the *content* of the snapshot is one frame stale, not its position. Imperceptible at human reaction times.

4. **Engine keeps rendering under the modal.**
   - **Hazard:** Wasted CPU / GPU during modal lifecycle. Spawner auto-mode could be firing into a viewport the user can't see.
   - **Mitigation:** Accepted — out of scope. Pausing the engine could break legitimate flows (the user might WANT the spawner to keep going while reading a modal). Document as a known cost; revisit if it becomes a real complaint.

5. **GDI+ shutdown race.**
   - **Hazard:** If `GdiplusShutdown` is called before the AlphaCompositor's destructor runs, any GDI+ object held by the compositor leaks or crashes.
   - **Mitigation:** Order matters. `GdiplusStartup` runs first in `HostWindow::Run`; `GdiplusShutdown` runs after all compositor / engine teardown in the matching destructor path. The compositor doesn't hold any GDI+ objects between calls — each `CaptureSnapshotPng` creates and releases its own. So the only risk is calling `CaptureSnapshotPng` AFTER `GdiplusShutdown`, which can't happen if we shut down in the right order.

6. **MockBridge returns empty PNG; what does React do?**
   - **Hazard:** Modal renders an `<img src="data:image/png;base64,">` — broken image. Visible in dev / unit tests.
   - **Mitigation:** Modal's render guard already checks `snapshot && snapshot.pngBase64`. Empty string falsy short-circuits the portal render. Tests don't see a broken img.

---

## 5. Testing & verification

### Manual smoke-test

- [ ] Open Help → About. Modal renders. Engine viewport behind modal is replaced by a static snapshot, dimmed + blurred uniformly with the panels via Dialog.Overlay's CSS. **No visible rectangular popup boundary, no inner-shadow vignette.**
- [ ] Resize the window while modal is open: backdrop tracks resize seamlessly (snapshot re-captures on each rAF tick).
- [ ] Close modal: engine returns to full opacity instantly, runs at normal fps.
- [ ] Open then immediately close modal: no orphaned occlusion (engine fully visible).
- [ ] Two modals in sequence (About → close → SaveChangesPrompt via dirty doc → close): both work, no state leaks.
- [ ] With the curve editor active: open About, snapshot captures the engine but NOT the curve editor (which is below the popup) — verify the snapshot doesn't include curve editor pixels.

### Vitest

- [ ] `pnpm test` clean (expect 281 → 282; +1 for new capture-snapshot test, the modal-mask test deletes).
- [ ] New focused test: Modal dispatches `viewport/capture-snapshot` on open, dispatches `viewport/occlude { rect: <quadrant-rect> }`, and on close dispatches `viewport/occlude { rect: null }`.
- [ ] Existing regression guards (opaque pill, no backdrop-filter, no shadow-xl/2xl) keep passing.

### Playwright

- [ ] `pnpm test:native` 83/83. The snapshot path uses the same `viewport/occlude` surface Playwright already exercises, plus a new request that mock returns an empty stub for — no contract-level changes expected.

### MSBuild

- [ ] Debug x64 clean. GDI+ link via `#pragma comment(lib, "gdiplus.lib")` in HostWindow.cpp.

---

## 6. Implementation steps

- [ ] **P1 — Pre-flight.** Confirm baseline green (vitest 281/281, Playwright 83/83, MSBuild clean). Read this todo top-to-bottom. Read [`tasks/HANDOFF.md`](HANDOFF.md) section 0 for the dispatch context.
- [ ] **P2 — AlphaCompositor snapshot path.** Add `m_lastRawDib` field, the pre-stamp copy in `Composite`, the `CaptureSnapshotPng` method, GDI+ startup/shutdown in HostWindow. Build + manual test by adding a temporary `viewport/capture-snapshot` handler returning a fixed-size dummy PNG to verify the bridge round-trip.
- [ ] **P3 — Bridge surface.** Schema + dispatcher + mock. Vitest contract test exercises the round-trip via MockBridge (empty PNG).
- [ ] **P4 — React Modal rewiring.** Replace the existing useEffect with the new snapshot + full-quadrant-occlude flow. Render the img via createPortal. Add the new vitest regression test. **DO NOT remove the modal-mask path yet** — keep both running so the smoke-test can A/B compare.
- [ ] **P5 — Smoke-test.** Run through the manual checklist. Confirm the snapshot path produces the intended frosted-glass look. If issues surface, fix them while modal-mask is still available as a fallback.
- [ ] **P6 — Phase 3 cleanup.** Delete the modal-mask path top-to-bottom (3.1, 3.2, 3.3). One commit, clearly labelled `refactor(LT-4): drop modal-mask compositor path (replaced by snapshot backdrop)`.
- [ ] **P7 — Docs.** CHANGELOG entry (frosted-glass approach + reasoning); HANDOFF refresh; ROADMAP strike B1.3.1.1 + move to Shipped if user OKs the FF.

Three commits total in this dispatch (P2-P3 squash into one, P4 + P6 + P7 each one commit).

---

## Review (filled in during execution)

**Dispatch:** B1.3.1.1 [NT-9] — Frosted-glass modal backdrop via engine-snapshot capture.
**Status:** ✅ shipped on session branch `claude/bold-volhard-e0e0f0`, pending FF to `origin/lt-4` at user's OK.

**Commits landed (4):**

| Commit | Phase | Summary |
|---|---|---|
| [`1e49d37`](https://github.com/DrKnickers/new-particle-editor/commit/1e49d37) | P2 + P3 | AlphaCompositor snapshot path (pre-stamp DIB cache, GDI+ PNG encode, inline base64) + bridge surface (schema + dispatcher + LayoutBroker forwarding + MockBridge stub) + GDI+ startup/shutdown in HostWindow. |
| [`f3570d3`](https://github.com/DrKnickers/new-particle-editor/commit/f3570d3) | P4 | React Modal rewiring — snapshot capture + full-quadrant occlude + `createPortal` `<img>` backdrop. Modal regression test pivoted from `set-modal-mask` assertion to the new contract + `expect.not.toHaveBeenCalledWith` lock against set-modal-mask. |
| [`cb7b4c7`](https://github.com/DrKnickers/new-particle-editor/commit/cb7b4c7) | P5 polish | Sentinel-rect occlude + one-shot capture. Driven by two smoke-test findings (drag-resize leaks opaque engine pixels; drag stutter from per-frame PNG encodes). Mental shift from "fix the trigger" to "encode the state durably" — captured as L-013. |
| [`c287033`](https://github.com/DrKnickers/new-particle-editor/commit/c287033) | P6 | Drop modal-mask compositor pipeline — `SetModalMask`, `BoxBlurDibBgra`, `MultiplyDibAlphaBgra`, `FadePopupEdges`, `Smoothstep01Edge`, the `m_globalAlpha`/`blurRadius`/`blurScratch` fields, the `viewport/set-modal-mask` bridge surface + schema + dispatcher + mock. 256 lines deleted from `AlphaCompositor.cpp`. |

**Plan deviations from original §6 commit slicing:**

- Original plan said three commits (P2-P3 squash + P4 + P6). Actual is four because P5's smoke-test surfaced two structural fixes worth their own traceable commit (sentinel rect + one-shot capture), not just polish on top of P4.
- The plan's mention of keeping the modal-mask path live during P5 ("DO NOT remove the modal-mask path yet — keep both running so the smoke-test can A/B compare") wasn't load-bearing in practice — the snapshot path worked on first smoke-test, the only fallback need was the in-binary code (not a runtime A/B), and P6 deleted it cleanly without ever needing the fallback. The plan note was a safety hedge that turned out unnecessary; recording for future plans considering similar hedges.

**Risks status:**

- §4.1 PNG encode latency under drag — INVALIDATED by P5's one-shot capture. No per-frame encode at all.
- §4.2 Bridge payload size — observed PNG sizes during smoke-test were ~50-150 KB (base64 ~70-200 KB) for the default skydome scene. Well under the 270-680 KB risk band; rAF coalescing wasn't needed because we don't re-capture at all. PNG encoding choice validated.
- §4.3 Snapshot misalignment during fast drag — IRRELEVANT under one-shot capture. The img tracks the parent's CSS rect in real time; only the content is frozen, which is intentional.
- §4.4 Engine keeps rendering under the modal — accepted as documented. No complaint surfaced.
- §4.5 GDI+ shutdown race — no incident; the ordering (Startup after CoInitializeEx + WebView2 check, Shutdown right before CoUninitialize after the message pump drains) held cleanly.
- §4.6 MockBridge empty-PNG render guard — exercised by all vitest specs that mount Modal in isolation (MockBridge returns `{ pngBase64: "", w: 0, h: 0 }`, render guard short-circuits the portal). No broken-img warnings in test output.

**New risk surfaced (not in original §4):** the Win32 modal sizing loop starves WebView2 IPC for the duration of a drag-resize. Renderer→host bridge messages can't land until release. Documented in L-013; the fix (host-state-durable design) is the same pattern any future "follow the popup during resize" surface should adopt.

**Test counts:**

- vitest **281 / 281** (no count change — Modal.test.tsx's modal-mask spec reshaped to the new contract; +1 `expect.not.toHaveBeenCalledWith` assertion to lock the deletion).
- Playwright **83 / 83** (no spec touched the deleted `viewport/set-modal-mask` surface).
- MSBuild Debug x64 clean (preexisting LIBCMTD warning only).

**Smoke-test verdicts:**

- ✅ Help → About: modal renders, frosted-glass backdrop blurs panels + snapshot uniformly, no popup-boundary seam, no inner-shadow vignette.
- ✅ Drag-resize while modal open: no opaque engine bands, no stutter.
- ✅ Modal close: engine returns to full opacity instantly.

**Lessons added:** L-013 (Win32 modal sizing loop starves WebView2 IPC).
**Lessons reinforced:** L-011 (CSS effects can't span engine compositing layer — the whole reason this dispatch exists).

**Cleanup performed:**

- modal-mask C++ machinery deleted (P6).
- `viewport/set-modal-mask` schema entry + MockBridge case + dispatcher handler removed (P6).
- ROADMAP NT-9 struck, *Actual:* line added, moved to position 5.1 in Shipped; 22 existing Shipped entries shifted to 5.2 - 5.23; Near-term entries 1.2 / 1.3 / 1.4 renumbered to 1.1 / 1.2 / 1.3.
- CHANGELOG entry added at top.
- HANDOFF refreshed for next session.
