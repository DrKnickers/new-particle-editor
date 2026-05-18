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

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
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
  /** Drag-end handler. Fires after pointer-up when a drag actually
   *  produced a position change. The parent fires
   *  `emitters/set-track-key { oldTime: keyTime, newTime, newValue }`.
   *  When the drag ends with no net movement, this is NOT called;
   *  the original click path fires instead. */
  onKeyDragEnd?: (keyTime: number, newTime: number, newValue: number) => void;
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
  onKeyDragEnd,
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

  /** Pointer-move during an active drag. Re-projects the pointer's
   *  client coords into (time, value), applies the per-key bounds,
   *  stores the new live position, and bumps the render tick. */
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
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

  /** Pointer-up — commit drag or treat as click. */
  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
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

  /** Pointer cancel — drop the drag without committing. */
  const onPointerCancel = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag === null) return;
    if (event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    setDragTick((n) => n + 1);
  };

  /** Pointer-down on the canvas backdrop (empty area). In Insert
   *  mode, computes (time, value) and fires `onCanvasAdd`. In
   *  Select mode, falls through to the click path (parent clears
   *  selection). */
  const onCanvasPointerDown = (event: ReactPointerEvent<SVGRectElement>) => {
    if (event.button !== 0) return;
    if (!insertMode || !onCanvasAdd) return;
    const svg = event.currentTarget.ownerSVGElement;
    if (svg === null) return;
    const { x, y } = eventToViewBox(svg, event.clientX, event.clientY, width, height);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const time = unproject(x, timeMin, timeMax, width);
    const value = unproject(height - y, vMin, vMax, height);
    event.stopPropagation();
    onCanvasAdd(time, value);
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
        if (e.target === e.currentTarget) {
          onCanvasClick?.(e);
        }
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
        onClick={(e) => {
          e.stopPropagation();
          // In Insert mode the pointer-down branch already fired
          // onCanvasAdd — don't double-fire onCanvasClick here.
          if (!insertMode) {
            onCanvasClick?.(e);
          }
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
    </svg>
  );
}

