// CurveEditor — SVG renderer for a single track.
//
// Phase 3 Screen 6 Batch A: read-only foundation.
// Screen 5 / Screen 6 Batch B-α:
//   - Key selection (click + Ctrl/Cmd+click toggle, click empty SVG to
//     clear). Selection state is OWNED by the parent (TrackEditor or
//     EmitterPropertyPanel) and identified by key TIME — not array
//     index — so a future drag-to-move (Batch B) can re-order keys in
//     the underlying multiset without invalidating the selection.
//   - Smooth (cubic-Bezier) + step (staircase) rendering branches.
//     The control-point formula matches the legacy implementation at
//     [src/UI/CurveEditor.cpp:289-292]:
//       cp1 = (p1.x + (p2.x - p1.x) / 4, p1.y)
//       cp2 = (p1.x + (p2.x - p1.x) * 3 / 4, p2.y)
//     Step expands each segment as [p1, (p2.x, p1.y), p2] so a single
//     <polyline> can render the staircase.
//
// Screen 6 Batch B-β adds:
//   - Drag-to-move via pointer events. Pointer-down on a key starts a
//     drag (local state); pointer-move re-projects the dragged key to
//     the new screen position, clamped to:
//       * border keys (first + last by time order): time fixed; value
//         clamped to [valueRange.min, valueRange.max].
//       * interior keys: time clamped to `(prev.time, next.time)`
//         EXCLUSIVE; value clamped to track range.
//     Pointer-up commits via `onKeyDragEnd` so the parent can fire
//     `emitters/set-track-key`. We rely on `setPointerCapture` to
//     receive pointer-move events even when the cursor leaves the
//     element. jsdom doesn't implement setPointerCapture; we guard
//     each call with a `typeof` check so the Vitest pointer-event
//     specs still exercise the drag math without throwing.
//   - Click-to-add via canvas pointer-down in Insert mode. The parent
//     passes `insertMode` and the canvas inverse-maps the pointer's
//     (x, y) to (time, value) before invoking `onCanvasAdd`.
//   - Border-key visual: first + last keys (by time order) render
//     with a stroke ring (sky-500 accent + 1.5 stroke-width) and a
//     slightly darker un-selected fill so they read as "anchor"
//     points distinct from interior keys. When selected they keep
//     the selected styling (filled accent + r=5) and the ring stroke
//     as a layered cue.
//
// Phase 4.1 Fix dispatch 5 adds:
//   - Marquee (rubber-band) select on empty-canvas pointer-down in
//     Select mode. While dragging, a semi-transparent rectangle with
//     a dashed border tracks the cursor. At pointer-up every key
//     whose projected (x, y) falls inside the rectangle (INCLUSIVE
//     on both edges in viewBox space) is collected and passed to
//     `onCanvasMarqueeSelect`. Shift-held marquee passes
//     `shift: true` so the parent appends rather than replaces.
//     Esc during an active marquee cancels — the rectangle is
//     cleared and the callback is NOT fired. When the gesture never
//     grows past `DRAG_SLOP` between down and up we treat it as a
//     plain click and fire `onCanvasClick` (preserves the existing
//     "click empty area to clear selection" UX from FD3). Insert
//     mode is unchanged: empty-canvas pointer-down still fires
//     `onCanvasAdd` and marquee is suppressed.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { TrackDto } from "@particle-editor/bridge-schema";

type Props = {
  /** The track to render. `keys` are expected sorted ascending by
   *  time but the component doesn't re-sort — it trusts the wire
   *  contract. */
  track: TrackDto;
  /** Y-axis range, derived from the track + per-track value-range
   *  mapping (see TrackEditor). Min defaults to 0 and max to 1 so an
   *  uninitialised range still renders something sensible. */
  valueRange: { min: number; max: number };
  /** SVG drawable area in viewBox units. Defaults to 600×300; tests
   *  pin these to deterministic numbers when asserting positions. */
  width?: number;
  height?: number;
  /** Time range. Locked to 0..100 to match legacy
   *  `CurveEditor_SetHorzRange(hEditor, 0.0f, 100.0f, true)` at
   *  [src/UI/CurveEditor.cpp]. Exposed as a prop so future panels
   *  (lifetime-curve sub-editors) can override. */
  timeMin?: number;
  timeMax?: number;
  /** Set of key times currently selected. Identified by TIME (not
   *  array index) so selection survives future key-time mutations. */
  selectedKeyTimes?: ReadonlySet<number>;
  /** Click handler for a single key circle. Receives the key's time
   *  + the raw mouse event so the parent can branch on modifier keys
   *  (Ctrl/Cmd toggle, plain click replace). Click fires only when
   *  the pointer-down did NOT begin a drag (i.e. the pointer didn't
   *  move beyond a small threshold between down and up). */
  onKeyClick?: (time: number, event: React.MouseEvent | React.PointerEvent) => void;
  /** Click handler for the empty SVG canvas (anywhere not on a key
   *  circle). Convention: clear the selection in Select mode. */
  onCanvasClick?: (event: React.MouseEvent) => void;
  /** Insert-mode flag from the parent. When true, pointer-down on
   *  empty canvas computes (time, value) from the pointer position
   *  and fires `onCanvasAdd` instead of `onCanvasClick`. */
  insertMode?: boolean;
  /** Insert-mode add handler. Called with the (time, value) computed
   *  from the pointer position. The parent should fire
   *  `emitters/add-track-key` and (typically) auto-select the new
   *  key. */
  onCanvasAdd?: (time: number, value: number) => void;
  /** Right-click on the empty canvas — convention is "drop back to
   *  Select mode" (legacy parity; matches Photoshop/Blender pen-mode
   *  right-click escape). Called on empty backdrop only — right-click
   *  on a key is reserved for a future per-key context menu and
   *  doesn't fire this. The browser context menu is suppressed
   *  (preventDefault) when this is wired. */
  onCanvasContextMenu?: () => void;
  /** Drag-end handler. Fires after pointer-up when a drag actually
   *  produced a position change. The parent fires
   *  `emitters/set-track-key { oldTime: keyTime, newTime, newValue }`.
   *  When the drag ends with no net movement, this is NOT called;
   *  the original click path fires instead. */
  onKeyDragEnd?: (keyTime: number, newTime: number, newValue: number) => void;
  /** Marquee-select handler (Phase 4.1 Fix dispatch 5). Fires at
   *  pointer-up when a Select-mode rubber-band drag has covered at
   *  least one key. `times` is the set of key TIMES inside the
   *  rectangle (inclusive on both axes in viewBox space). `shift`
   *  reflects whether Shift was held at marquee-start; the parent
   *  should append to the existing selection when true, replace when
   *  false. When the gesture is too short to qualify as a drag the
   *  marquee is treated as a click and `onCanvasClick` fires
   *  instead. */
  onCanvasMarqueeSelect?: (times: number[], shift: boolean) => void;
};

const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 300;
const DEFAULT_TIME_MIN = 0;
const DEFAULT_TIME_MAX = 100;

const SELECTED_FILL = "#0EA5E9";    // sky-500 — matches Screen 4 accent
const UNSELECTED_FILL = "#e5e5e5";
const BORDER_FILL = "#94A3B8";      // slate-400 — slightly darker than unselected
const BORDER_STROKE = "#0EA5E9";    // accent ring, same hue as selected fill

/** Below this many pixels (in viewBox units) of pointer movement
 *  between down and up, we treat it as a click — not a drag. Matches
 *  legacy CurveEditor's hit-test slop. */
const DRAG_SLOP = 1.5;

/** Linear-interpolate a value into 0..1 then map into 0..length.
 *  Clamps NaN/Infinity at the bounds to prevent broken SVG output. */
function project(value: number, min: number, max: number, length: number): number {
  if (!Number.isFinite(value) || max <= min) return 0;
  const t = (value - min) / (max - min);
  return Math.max(0, Math.min(1, t)) * length;
}

/** Inverse of project — pixel position back to data coordinate. */
function unproject(px: number, min: number, max: number, length: number): number {
  if (length <= 0) return min;
  const t = px / length;
  return min + Math.max(0, Math.min(1, t)) * (max - min);
}

/** Build the SVG path `d` string for a smooth (cubic-Bezier) curve
 *  through the given points. Mirrors the legacy formula at
 *  [src/UI/CurveEditor.cpp:289-292]: control points sit at 1/4 and
 *  3/4 of the horizontal distance, sharing y with the segment's
 *  start / end key respectively. Returns "" when there are fewer
 *  than 2 points (no segment to render). */
function buildSmoothPath(points: ReadonlyArray<{ x: number; y: number }>): string {
  if (points.length < 2) return "";
  const first = points[0]!;
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length; i++) {
    const p1 = points[i - 1]!;
    const p2 = points[i]!;
    const dx = p2.x - p1.x;
    const cp1x = p1.x + dx / 4;
    const cp1y = p1.y;
    const cp2x = p1.x + (dx * 3) / 4;
    const cp2y = p2.y;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/** Build the staircase polyline points for step interpolation. For
 *  each (p1, p2) pair, emits the horizontal leg at p1.y then the
 *  vertical jump to p2.y. Per legacy [src/UI/CurveEditor.cpp:300-318]
 *  the horizontal leg uses the "line pen" and the vertical leg the
 *  "step pen" — visual differentiation is deferred to Batch B; the
 *  shape is identical either way. */
function buildStepPolyline(points: ReadonlyArray<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  const parts: string[] = [`${points[0]!.x},${points[0]!.y}`];
  for (let i = 1; i < points.length; i++) {
    const p1 = points[i - 1]!;
    const p2 = points[i]!;
    // Horizontal leg, then the key itself.
    parts.push(`${p2.x},${p1.y}`);
    parts.push(`${p2.x},${p2.y}`);
  }
  return parts.join(" ");
}

/** Map a DOM event's (clientX, clientY) to viewBox-space (x, y) using
 *  the SVG element's getBoundingClientRect. Returns (NaN, NaN) when
 *  the bounds aren't measurable (e.g. unmounted element). */
function eventToViewBox(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return { x: NaN, y: NaN };
  const x = ((clientX - rect.left) / rect.width) * width;
  const y = ((clientY - rect.top) / rect.height) * height;
  return { x, y };
}

export function CurveEditor({
  track,
  valueRange,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  timeMin = DEFAULT_TIME_MIN,
  timeMax = DEFAULT_TIME_MAX,
  selectedKeyTimes,
  onKeyClick,
  onCanvasClick,
  insertMode,
  onCanvasAdd,
  onCanvasContextMenu,
  onKeyDragEnd,
  onCanvasMarqueeSelect,
}: Props) {
  const { min: vMin, max: vMax } = valueRange;

  // Pre-compute the projected positions once so the curve and the
  // circles share the same coordinate calculation.
  const points = track.keys.map((k) => ({
    x: project(k.time, timeMin, timeMax, width),
    // Y inversion: SVG origin is top-left. Subtract from height so
    // larger values render higher on the canvas.
    y: height - project(k.value, vMin, vMax, height),
    time: k.time,
    value: k.value,
  }));

  // Border keys (first + last by time order). With keys-ascending-by-
  // time as the wire contract these are simply indices 0 and N-1.
  const borderTimes = new Set<number>();
  if (track.keys.length > 0) {
    borderTimes.add(track.keys[0]!.time);
    borderTimes.add(track.keys[track.keys.length - 1]!.time);
  }

  // Drag state. Held in refs (not useState) so pointer-move handlers
  // can read the latest values without triggering re-renders on every
  // pixel of movement. We DO call setState on the live drag
  // (currentTime/currentValue) so the dragged circle re-renders at the
  // new position — kept in `dragLive` so the read in onPointerMove is
  // ref-backed but the render path is state-backed.
  const dragRef = useRef<{
    keyTime: number;
    startTime: number;
    startValue: number;
    startClientX: number;
    startClientY: number;
    currentTime: number;
    currentValue: number;
    moved: boolean;
    pointerId: number;
    target: Element | null;
  } | null>(null);

  // Force re-render trigger for in-flight drag. dragRef carries the
  // live drag state across pointer-move events without React state's
  // batching delays; we bump a tiny counter to flush a re-render so
  // the dragged circle's cx/cy reflects the latest cursor position.
  const [, setDragTick] = useState(0);

  // Phase 4.1 Fix dispatch 5 — marquee state. Held as React state
  // (not a ref) because the rectangle rendering already needs a
  // re-render on every pointer-move; useState gives us both the
  // value-tracking and the render side-effect in one. Coordinates
  // are stored in VIEWBOX SPACE — same coordinate system as the
  // projected key points, so the hit test at pointer-up is a direct
  // numeric compare with no extra projection step. `clientStartX/Y`
  // is the raw pointer-down client position; we use it to compute
  // movement-past-slop without re-deriving from the viewBox values.
  type MarqueeState = {
    startX: number;       // viewBox space anchor
    startY: number;
    currX: number;        // viewBox space current cursor
    currY: number;
    clientStartX: number; // raw client for slop test
    clientStartY: number;
    shift: boolean;       // shift held at marquee-start
    pointerId: number;
    target: Element | null;
    movedPastSlop: boolean;
  };
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  // After a Select-mode pointer-up handled the click-vs-drag decision,
  // the browser still fires a synthetic `click` event on the captured
  // backdrop. We set this ref on every consume from the pointer-up
  // path; the backdrop's onClick reads + clears it before deciding
  // whether to forward to onCanvasClick. Without this, plain clicks
  // would double-fire (once from marquee, once from backdrop click).
  const marqueeConsumedClickRef = useRef(false);

  // Grid: 10 evenly-spaced cells on each axis → 11 lines including
  // the bordering ones. The outer axes (left + bottom) are stroked
  // darker for readability.
  const gridCells = 10;
  const verticalLines: number[] = [];
  for (let i = 0; i <= gridCells; i++) {
    verticalLines.push((i / gridCells) * width);
  }
  const horizontalLines: number[] = [];
  for (let i = 0; i <= gridCells; i++) {
    horizontalLines.push((i / gridCells) * height);
  }

  const interp = track.interpolation;

  /** Begin a drag on a key. Captures the pointer so move/up events
   *  return to the source element even when the cursor leaves it.
   *  jsdom doesn't implement setPointerCapture; we guard with a
   *  `typeof` check so the Vitest pointer specs still exercise the
   *  drag math without throwing. */
  const startDrag = (
    event: ReactPointerEvent<SVGCircleElement>,
    keyTime: number,
    keyValue: number,
  ) => {
    if (event.button !== 0) return;
    // Ctrl/Cmd modifier: defer to the click handler (toggle selection).
    // Pointer-up will fire onKeyClick because moved=false.
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }
    dragRef.current = {
      keyTime,
      startTime: keyTime,
      startValue: keyValue,
      startClientX: event.clientX,
      startClientY: event.clientY,
      currentTime: keyTime,
      currentValue: keyValue,
      moved: false,
      pointerId: event.pointerId,
      target: event.currentTarget,
    };
    const t = event.currentTarget;
    // setPointerCapture is undefined in jsdom — guard.
    if (typeof t.setPointerCapture === "function") {
      try {
        t.setPointerCapture(event.pointerId);
      } catch {
        // setPointerCapture can throw in some browsers when the
        // pointer is no longer active; swallow — the drag still
        // works via the document-level fallback.
      }
    }
  };

  /** Pointer-move during an active drag OR marquee. Key drag takes
   *  priority — `dragRef.current !== null` is checked first. Marquee
   *  and key-drag are mutually exclusive in practice because marquee
   *  only begins on the empty backdrop and key-drag only begins on a
   *  circle; the priority is defensive. */
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    // ── Marquee branch ────────────────────────────────────────────
    if (dragRef.current === null && marquee !== null
        && event.pointerId === marquee.pointerId) {
      const svg = event.currentTarget;
      const { x, y } = eventToViewBox(svg, event.clientX, event.clientY, width, height);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const dx = event.clientX - marquee.clientStartX;
      const dy = event.clientY - marquee.clientStartY;
      const movedNow = Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP;
      setMarquee({
        ...marquee,
        currX: x,
        currY: y,
        movedPastSlop: marquee.movedPastSlop || movedNow,
      });
      return;
    }
    // ── Key-drag branch (original behaviour) ──────────────────────
    const drag = dragRef.current;
    if (drag === null) return;
    if (event.pointerId !== drag.pointerId) return;
    const svg = event.currentTarget;
    const { x, y } = eventToViewBox(svg, event.clientX, event.clientY, width, height);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    let nextTime = unproject(x, timeMin, timeMax, width);
    // Y inversion: pixel y=0 is the top (high value).
    let nextValue = unproject(height - y, vMin, vMax, height);
    // Bounds. Border keys: time fixed to start. Interior keys: time
    // clamped to (prev.time, next.time) exclusive.
    const isBorder = borderTimes.has(drag.startTime);
    if (isBorder) {
      nextTime = drag.startTime;
    } else {
      // Find neighbours in the original keys array (sorted by time).
      const idx = track.keys.findIndex((k) => k.time === drag.startTime);
      if (idx > 0 && idx < track.keys.length - 1) {
        const prevT = track.keys[idx - 1]!.time;
        const nextT = track.keys[idx + 1]!.time;
        // Exclusive bound — pull in by a tiny epsilon so equality with
        // a neighbour is impossible (which would corrupt the multiset).
        const eps = 1e-4;
        nextTime = Math.max(prevT + eps, Math.min(nextT - eps, nextTime));
      } else {
        // Defensive: if findIndex failed (shouldn't happen on an
        // active drag), fall back to the start time.
        nextTime = drag.startTime;
      }
    }
    // Value clamp to track range.
    nextValue = Math.max(vMin, Math.min(vMax, nextValue));
    drag.currentTime = nextTime;
    drag.currentValue = nextValue;
    // Track whether the pointer actually moved past the slop
    // threshold; pointer-up uses this to decide click-vs-drag.
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    if (Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP) {
      drag.moved = true;
    }
    setDragTick((n) => n + 1);
  };

  /** Pointer-up — commit drag, commit marquee, or treat as click. */
  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    // ── Marquee branch ────────────────────────────────────────────
    if (dragRef.current === null && marquee !== null
        && event.pointerId === marquee.pointerId) {
      const { startX, startY, currX, currY, shift, movedPastSlop, target } = marquee;
      // Release pointer capture if held.
      if (target !== null) {
        const el = target as Element & { releasePointerCapture?: (id: number) => void };
        if (typeof el.releasePointerCapture === "function") {
          try { el.releasePointerCapture(event.pointerId); } catch { /* swallow */ }
        }
      }
      setMarquee(null);
      // The synthetic `click` event will fire on the backdrop right
      // after this pointer-up. Set the suppress flag so the backdrop
      // onClick doesn't re-invoke onCanvasClick — we own the click-
      // vs-drag decision here.
      marqueeConsumedClickRef.current = true;
      if (!movedPastSlop) {
        // Treat as a plain canvas click — preserve the "click empty
        // area clears selection" UX (existing FD3 behaviour). The
        // backdrop's onClick handler would normally fire this; we do
        // it explicitly here because pointer-down on the backdrop
        // started a marquee and the click event won't reliably reach
        // the backdrop onClick after a captured pointer-up.
        onCanvasClick?.(event as unknown as React.MouseEvent);
        return;
      }
      // Compute inclusive rectangle bounds in viewBox space.
      const xMin = Math.min(startX, currX);
      const xMax = Math.max(startX, currX);
      const yMin = Math.min(startY, currY);
      const yMax = Math.max(startY, currY);
      // Hit test: a key is selected when its projected (x, y)
      // satisfies xMin ≤ x ≤ xMax AND yMin ≤ y ≤ yMax (INCLUSIVE on
      // both ends — a key exactly on the edge is selected). The
      // points list was already projected at render time; reuse those
      // numbers instead of re-projecting.
      const hits: number[] = [];
      for (const p of points) {
        if (p.x >= xMin && p.x <= xMax && p.y >= yMin && p.y <= yMax) {
          hits.push(p.time);
        }
      }
      onCanvasMarqueeSelect?.(hits, shift);
      return;
    }
    // ── Key-drag branch (original behaviour) ──────────────────────
    const drag = dragRef.current;
    if (drag === null) return;
    if (event.pointerId !== drag.pointerId) return;
    const { keyTime, currentTime, currentValue, moved, target } = drag;
    dragRef.current = null;
    // Release pointer capture if held.
    if (target !== null) {
      const el = target as Element & { releasePointerCapture?: (id: number) => void };
      if (typeof el.releasePointerCapture === "function") {
        try {
          el.releasePointerCapture(event.pointerId);
        } catch {
          /* see startDrag — swallow */
        }
      }
    }
    setDragTick((n) => n + 1);
    if (moved && onKeyDragEnd) {
      onKeyDragEnd(keyTime, currentTime, currentValue);
    } else if (!moved && onKeyClick) {
      // No movement — treat as a plain click on the key. We
      // synthesise the React event object enough for the modifier
      // checks the parent does (ctrlKey/metaKey).
      onKeyClick(keyTime, event);
    }
  };

  /** Pointer cancel — drop the drag OR marquee without committing. */
  const onPointerCancel = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (marquee !== null && event.pointerId === marquee.pointerId) {
      setMarquee(null);
      return;
    }
    const drag = dragRef.current;
    if (drag === null) return;
    if (event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    setDragTick((n) => n + 1);
  };

  // Esc-cancel for marquee. Window-level keydown listener is mounted
  // ONLY while a marquee is active so we don't leak handlers when
  // idle. The marquee state clears without firing the callback —
  // selection is left untouched.
  useEffect(() => {
    if (marquee === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMarquee(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => { window.removeEventListener("keydown", handler); };
  }, [marquee]);

  /** Pointer-down on the canvas backdrop (empty area). In Insert
   *  mode, computes (time, value) and fires `onCanvasAdd`. In
   *  Select mode (FD5), starts a marquee — pointer-move grows the
   *  rectangle; pointer-up commits the selection or, if no drag past
   *  slop, fires the click path (clears selection). */
  const onCanvasPointerDown = (event: ReactPointerEvent<SVGRectElement>) => {
    if (event.button !== 0) return;
    const svg = event.currentTarget.ownerSVGElement;
    if (svg === null) return;
    if (insertMode) {
      if (!onCanvasAdd) return;
      const { x, y } = eventToViewBox(svg, event.clientX, event.clientY, width, height);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const time = unproject(x, timeMin, timeMax, width);
      const value = unproject(height - y, vMin, vMax, height);
      event.stopPropagation();
      onCanvasAdd(time, value);
      return;
    }
    // ── Select mode — start a marquee. Even when no marquee callback
    // is wired we still capture the pointer so a pointer-up with no
    // movement past slop can fire onCanvasClick at the right moment
    // (rather than letting the backdrop's onClick race with the
    // captured pointer-up).
    const { x, y } = eventToViewBox(svg, event.clientX, event.clientY, width, height);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const t = event.currentTarget;
    if (typeof t.setPointerCapture === "function") {
      try { t.setPointerCapture(event.pointerId); } catch { /* swallow */ }
    }
    event.stopPropagation();
    setMarquee({
      startX: x,
      startY: y,
      currX: x,
      currY: y,
      clientStartX: event.clientX,
      clientStartY: event.clientY,
      shift: event.shiftKey,
      pointerId: event.pointerId,
      target: t,
      movedPastSlop: false,
    });
  };

  // Build the render-time points list, overriding the dragged key's
  // position so the circle + curve track the cursor mid-drag. The
  // dragged point's `time` stays at its original value for the
  // selection match; only the display position shifts.
  const drag = dragRef.current;
  const renderPoints = points.map((p) => {
    if (drag !== null && p.time === drag.keyTime) {
      const dx = project(drag.currentTime, timeMin, timeMax, width);
      const dy = height - project(drag.currentValue, vMin, vMax, height);
      return { ...p, x: dx, y: dy };
    }
    return p;
  });

  return (
    <svg
      data-testid="curve-editor-svg"
      data-track={track.name}
      data-key-count={track.keys.length}
      data-interpolation={interp}
      data-insert-mode={insertMode ? "true" : "false"}
      data-dragging={drag !== null ? "true" : "false"}
      role="img"
      aria-label={`${track.name} curve, ${track.keys.length} keys`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-full w-full select-none"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={(e) => {
        // Click handler fires on the SVG itself — child clicks
        // (circles) bubble up too. We only want to treat THIS event
        // as a canvas click when the actual target is the SVG (i.e.
        // not a key circle). Child click handlers stopPropagation so
        // they never reach here.
        if (e.target !== e.currentTarget) return;
        // FD10 (Group D follow-up): in Insert mode, pointer-down on
        // the backdrop fires onCanvasAdd. If the bridge response
        // renders a new key circle before pointer-up, the synthetic
        // click event's target becomes the SVG (LCA of backdrop-down
        // and circle-up), and without this guard onCanvasClick would
        // fire → clear the selection we just established. Mirrors
        // the same guard on the backdrop's onClick below.
        if (insertMode) return;
        onCanvasClick?.(e);
      }}
    >
      {/* Background rect so empty-area clicks are reliably caught by
          the SVG's own onClick (target === SVG). Some browsers route
          clicks through the topmost SVG child even when there's no
          shape under the cursor; an explicit transparent backdrop
          fixes that consistently. */}
      <rect
        data-testid="curve-canvas-backdrop"
        x={0}
        y={0}
        width={width}
        height={height}
        fill="transparent"
        onPointerDown={onCanvasPointerDown}
        onContextMenu={(e) => {
          // FD10 (Group D follow-up): right-click on empty canvas
          // drops the parent back to Select mode. preventDefault to
          // suppress the browser's native context menu, since we
          // own the gesture.
          if (onCanvasContextMenu) {
            e.preventDefault();
            e.stopPropagation();
            onCanvasContextMenu();
          }
        }}
        onClick={(e) => {
          e.stopPropagation();
          // In Insert mode the pointer-down branch already fired
          // onCanvasAdd — don't double-fire onCanvasClick here.
          if (insertMode) return;
          // After a Select-mode pointer-up the marquee branch already
          // decided whether to fire onCanvasClick. Skip the
          // synthetic-click double-fire by consuming the ref flag.
          if (marqueeConsumedClickRef.current) {
            marqueeConsumedClickRef.current = false;
            return;
          }
          onCanvasClick?.(e);
        }}
        style={{ cursor: insertMode ? "crosshair" : undefined }}
      />

      {/* Grid */}
      <g data-testid="curve-grid" stroke="#262626" strokeWidth={1} pointerEvents="none">
        {verticalLines.map((x, i) => (
          <line key={`v${i}`} x1={x} y1={0} x2={x} y2={height} />
        ))}
        {horizontalLines.map((y, i) => (
          <line key={`h${i}`} x1={0} y1={y} x2={width} y2={y} />
        ))}
      </g>

      {/* Outer axes (left + bottom darker for orientation) */}
      <g data-testid="curve-axes" stroke="#525252" strokeWidth={1.5} pointerEvents="none">
        <line x1={0} y1={0} x2={0} y2={height} />
        <line x1={0} y1={height} x2={width} y2={height} />
      </g>

      {/* The curve. Hidden when there are <2 keys (a single point
          doesn't form a segment). Smooth → cubic-Bezier <path>;
          step → staircase <polyline>; linear → straight-line
          <polyline>. Track-specific colouring (red curve in red,
          etc.) is a future polish pass. */}
      {renderPoints.length >= 2 && interp === "smooth" && (
        <path
          data-testid="curve-path"
          fill="none"
          stroke="#e5e5e5"
          strokeWidth={1.5}
          d={buildSmoothPath(renderPoints)}
          pointerEvents="none"
        />
      )}
      {renderPoints.length >= 2 && interp === "step" && (
        <polyline
          data-testid="curve-polyline"
          data-interpolation="step"
          fill="none"
          stroke="#e5e5e5"
          strokeWidth={1.5}
          points={buildStepPolyline(renderPoints)}
          pointerEvents="none"
        />
      )}
      {renderPoints.length >= 2 && interp === "linear" && (
        <polyline
          data-testid="curve-polyline"
          data-interpolation="linear"
          fill="none"
          stroke="#e5e5e5"
          strokeWidth={1.5}
          points={renderPoints.map((p) => `${p.x},${p.y}`).join(" ")}
          pointerEvents="none"
        />
      )}

      {/* Per-key circles. r=4 (unselected) / r=5 (selected) — the
          enlarged hit target also makes the selected key
          visually pop. Border keys (first + last by time) carry an
          accent stroke ring + darker un-selected fill so they read
          as "anchor" points distinct from interior keys. Pointer
          handlers route through onPointerDown (drag) + the SVG-
          level onPointerMove/Up so the drag math works even when
          the cursor leaves the circle. */}
      {renderPoints.map((p, i) => {
        const selected = selectedKeyTimes?.has(p.time) ?? false;
        const isBorder = borderTimes.has(p.time);
        const fill = selected
          ? SELECTED_FILL
          : isBorder
            ? BORDER_FILL
            : UNSELECTED_FILL;
        const stroke = isBorder ? BORDER_STROKE : "#0a0a0a";
        const strokeWidth = isBorder ? 1.5 : 1;
        return (
          <circle
            key={i}
            data-testid="curve-key"
            data-key-time={p.time}
            data-selected={selected ? "true" : "false"}
            data-border={isBorder ? "true" : "false"}
            cx={p.x}
            cy={p.y}
            r={selected ? 5 : 4}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            style={{ cursor: onKeyClick ? "pointer" : undefined }}
            onPointerDown={(e) => startDrag(e, p.time, p.value)}
            onClick={(e) => {
              // The pointer-up handler on the SVG handles drag-end +
              // click-vs-drag detection. The plain click handler is
              // still wired so that environments without pointer
              // events (older test harnesses firing fireEvent.click
              // directly) keep working. To avoid double-firing in
              // pointer-event environments we only invoke the click
              // path here when no drag was just active.
              e.stopPropagation();
              if (dragRef.current === null) {
                onKeyClick?.(p.time, e);
              }
            }}
          />
        );
      })}

      {/* Marquee rectangle (FD5). Rendered last so it draws over the
          keys. `pointerEvents="none"` keeps the captured backdrop in
          control of the gesture — the rect is purely visual. The
          fill colour follows the design lock: sky-500 at 15% opacity
          with a dashed sky-500 border. */}
      {marquee !== null && marquee.movedPastSlop && (
        <rect
          data-testid="curve-marquee"
          x={Math.min(marquee.startX, marquee.currX)}
          y={Math.min(marquee.startY, marquee.currY)}
          width={Math.abs(marquee.currX - marquee.startX)}
          height={Math.abs(marquee.currY - marquee.startY)}
          fill="rgb(14 165 233 / 0.15)"
          stroke="#0EA5E9"
          strokeDasharray="4 4"
          strokeWidth={1}
          pointerEvents="none"
        />
      )}
    </svg>
  );
}

