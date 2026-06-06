# Curve marquee-from-axis-margins (CRV deferred polish)

(Prior tasks MNU-7 `9f8a7d0`, SEL-12/13 `e168ba9` — reviews in HANDOFF/git.)

## 1. Goal + scope

**Goal.** Let a curve-editor marquee selection **start from the axis-label
gutters** (36px Y-label column on the left, 22px X-label row at the bottom),
not just from inside the plot. A gutter-origin marquee begins AT the press point
in the margin (no snapping to the grid edge) and sweeps + selects normally.

**In:** unify the marquee in **`MultiChannelCurves`** (the focus-channel editor
the panel actually renders) onto a document-listener controller; expose an
imperative `startMarquee` via `forwardRef` threaded `CurveEditor → MultiChannelCurves`;
initiate it from the `CanvasWithAxisLabels` gutters via an `onGutterPointerDown`
prop wired through `CurveEditorPanel`; clamp gutter/overflow coords to the plot.

**Out:**
- **Single-track `CurveEditor` branch** (lines ~360-1001) + its 4 marquee tests
  — a SEPARATE, test-only path the app never renders (only the multi-channel
  branch is used in `CurveEditorPanel`). Left untouched. NOT de-duplicated here
  (out-of-scope refactor).
- Margin-inclusive viewBox rework — moot: `MultiChannelCurves` already uses a
  CSS-pixel-measured viewBox (no `preserveAspectRatio="none"`).
- Key-drag / insert / right-click / Esc semantics — unchanged.
- Bridge/schema/native — none.

## 2. What the codebase already gives us

- **`MultiChannelCurves`** (CurveEditor.tsx:1071+) is the real interactive
  editor (`CurveEditorPanel` passes `focusChannel`, so `CurveEditor` early-returns
  it at :405). It already has:
  - a `svgRef` (:1107) and measures CSS dims via `useLayoutEffect`; **in jsdom
    the measurement is rejected and it falls back to the `width`/`height` props
    (default 600×300)** (:1103-1110) → the marquee IS unit-testable deterministically.
  - its own marquee: `onCanvasPointerDown` (:1482) `setMarquee` (:1507),
    `onPointerMove/Up/Cancel` (:1583-1585), Esc via a window keydown (:1475),
    backdrop rect (:1600) with `setPointerCapture`. Mirrors the single-track impl.
  - `eventToViewBox` (:315) maps client→viewBox from the SVG rect.
- The marquee **already tracks into the margins** once started (pointer capture);
  only the gutter *start* is missing (no pointerdown reaches the SVG there).
- Wiring: `CurveEditorPanel` renders `<CanvasWithAxisLabels><CurveEditor …/>`
  (:1446-1482); `mode` ("select"|"insert") at :386; commit via `onCanvasMarqueeSelect`.
- `CanvasWithAxisLabels` (CurveEditorPanel.tsx:263): CSS grid `36px | 1fr` ×
  `1fr | 22px`; SVG in the center cell; HTML-span labels in the gutters.
- **No marquee tests on the multi-channel path** (`CurveEditorPanel.test.tsx`
  has none; the 4 marquee tests in `CurveEditor.test.tsx` render the single-track
  branch). So this task ADDS the first multi-channel marquee unit coverage.

## 3. Architecture / implementation approach

**Bridge:** `CurveEditor` becomes `forwardRef<CurveMarqueeHandle, Props>`; it
forwards `ref` to `<MultiChannelCurves ref={ref} …/>` (single-track branch
ignores the ref — unused by the app). `MultiChannelCurves` becomes
`forwardRef` + `useImperativeHandle(ref, () => ({ startMarquee }))`.
`CurveEditorPanel` holds `curveRef` and passes `onGutterPointerDown` to
`CanvasWithAxisLabels`.

**Additive entry point (inside `MultiChannelCurves`) — REUSE the existing
state machine, don't rewrite it.** MultiChannelCurves' marquee already tracks
everywhere via `setPointerCapture` on the backdrop; the only gap is the gutter
*start*. So:
1. `startMarquee(clientX, clientY, shift, pointerId)` (exposed via the handle):
   no-op when `!focusEnabled`; map via `eventToViewBox(svgRef.current, …, width,
   height)` — UN-clamped, so a gutter origin begins in the margin (renders via the
   SVG `overflow="visible"`), not snapped to the edge; set the marquee state with
   `target = svgRef.current`; call `svgRef.current.setPointerCapture(pointerId)`
   (cross-element capture is valid — the pointer is active from the gutter
   pointerdown). Subsequent move/up dispatch to the SVG → the **existing,
   UNCHANGED** `onPointerMove`/`onPointerUp`/`onPointerCancel` marquee branches +
   Esc `useEffect` run. No document listeners, no handler rewrite.
2. The plot backdrop pointerdown path is untouched (already works).

**Gutter initiation (`CanvasWithAxisLabels`):** outer grid `<div>` gets
`onPointerDown`: primary button + target NOT inside `[data-testid="curve-editor-svg"]`
→ `onGutterPointerDown(e)`. `CurveEditorPanel` passes
`(e) => { if (mode==="select") curveRef.current?.startMarquee(e.clientX, e.clientY, e.shiftKey); }`.
Backdrop already `stopPropagation`s → no double-fire.

## 4. Risks + mitigations

1. **Regressing the (untested) multi-channel marquee.** *Mitigation:* ADD unit
   tests for it FIRST (render `<CurveEditor>` with channels+focusChannel+width/
   height so the 600×300 fallback applies), locking baseline behaviour before
   the refactor; they survive the document move (bubbling events, as confirmed
   for the single-track tests).
2. **Coord mapping after the move to document** (`currentTarget` is now
   `document`). *Mitigation:* always map via `svgRef.getBoundingClientRect`.
3. **Listener leak.** One `cleanup()`, called from every terminal path + an
   unmount `useEffect` guard.
4. **Wrong-target gutter starts.** `closest('[data-testid="curve-editor-svg"]')`
   guard + backdrop `stopPropagation`.
5. **Insert mode in a gutter** → no-op (gutter handler acts only in Select mode).
6. **Editing the wrong (single-track) branch.** Already averted by mapping the
   render path; all edits target `MultiChannelCurves` + `CanvasWithAxisLabels`.

## 5. Testing & verification

**Unit (vitest, jsdom — multi-channel path uses the 600×300 prop fallback):**
- [x] NEW gutter (CurveEditor): imperative `startMarquee` from a gutter origin
      (clientX<0) sweeps + selects the covered keys (this also exercises the
      multi-channel marquee commit — the first such unit coverage).
- [x] NEW clamp (CurveEditor): a gutter-origin marquee renders its rect at x=0
      (anchored at the plot edge).
- [x] NEW `CanvasWithAxisLabels`: a primary `pointerDown` outside the SVG calls
      `onGutterPointerDown`; one inside the SVG does not; a right-button press does not.
- [x] The 4 single-track marquee tests stay green (untouched branch).
- [x] Full suite **496** (was 491; +2 CurveEditor +3 CanvasWithAxisLabels), 0 failed.

**Live (browser preview — jsdom can't do real layout/measurement):**
- [x] Left Y-gutter start → marquee anchors at the plot edge (`mqX="0"`) and
      selecting the full plot picks **4/4** keys.
- [x] Bottom X-gutter start → marquee initiates.
- [x] Esc mid-drag → rect removed, selection unchanged.

**Static:** `tsc --noEmit` exit 0.

## Review

**Outcome.** A curve marquee can now start from the axis-label gutters, web-only,
purely additive — no rewrite of the marquee state machine, no bridge/schema/native.

**The decisive discovery (re-plan mid-task).** The app's interactive curve editor is
`MultiChannelCurves`, NOT the single-track `CurveEditor` branch whose marquee the docs
(and the existing 4 marquee tests) describe. `MultiChannelCurves` already uses a
CSS-pixel-measured viewBox (so the deferral's "fight preserveAspectRatio" concern was
moot) and already has a `svgRef` + pointer-capture marquee. Retargeting there made the
fix additive: a `startMarquee` imperative handle (`marqueeRef` prop, threaded through
`CurveEditor`) + an `onGutterPointerDown` on `CanvasWithAxisLabels`, reusing the existing
capture/move/up/Esc machinery. The single-track branch + its tests are untouched.

**Why a `marqueeRef` prop, not `forwardRef`.** Both `CurveEditor` and `MultiChannelCurves`
are ~600-line functions; wrapping them in `forwardRef` risks brace-matching errors for no
functional gain. A `Ref` carried as a normal prop + `useImperativeHandle` is equivalent and
a safer edit.

**Built test-first** (RED → GREEN), and live-verified the parts jsdom can't reach (real
ResizeObserver measurement): Y-gutter start clamps to x=0 and selects 4/4, X-gutter starts,
Esc cancels.

**Files:** `CurveEditor.tsx` (handle + `startMarquee`), `CurveEditorPanel.tsx` (export +
`onGutterPointerDown` + wiring), `CurveEditor.test.tsx` (+2), NEW
`CanvasWithAxisLabels.test.tsx` (+3); docs (fix-plan, CHANGELOG).

**Post-review fix (user-surfaced).** First hand-off to the user failed: "cannot begin a click
drag outside the grid." My `preview_eval` "verification" was a FALSE POSITIVE — synthetic
`dispatchEvent` bypasses pointer capture AND never fires the trailing synthetic `click`.
Root-caused with Playwright real input + console instrumentation: the marquee committed the
right keys, but the trailing click (landing on the SVG, since the gutter marquee captures the
SVG not the backdrop) hit an `onClick` that only guarded `dragConsumedClickRef`, so it cleared
the selection. Fix: SVG `onClick` now also honours `marqueeConsumedClickRef` (mirrors the
backdrop). New RED→GREEN test (`a trailing click after a gutter marquee does NOT clear…`);
suite **497**; real-input re-verified (gutter drag selects + persists). Lesson **L-067**.

**Second user correction.** "it snaps my marquee to the grid instead of beginning in the
outskirts." The approved design CLAMPED the start to the plot edge — which read as snapping.
Dropped the clamp: `startMarquee` now keeps the raw press coordinate, so the rectangle begins
in the margin (renders via the SVG's `overflow="visible"`) and the inclusive hit-test still only
matches in-plot keys. Test updated (RED→GREEN, now asserts the rect starts at the raw gutter x
`-50`, not `0`); real-input re-verified (gutter press → `rectX=-18`, begins 18px into the gutter).
