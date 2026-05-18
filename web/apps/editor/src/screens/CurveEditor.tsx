// CurveEditor — SVG renderer for a single track. Read-only in Screen 6
// Batch A; Screen 5 / Screen 6 Batch B-α adds:
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
// Selected-key styling: filled accent (sky-500 = #0EA5E9) + r=5 vs the
// unselected r=4. Border-key visual differentiation (legacy renders
// first/last keys differently) stays deferred to Batch B.
//
// Y-axis inversion: SVG origin is top-left; we flip per-coord via
// `H - normalisedY * H` rather than a group `transform="scale(1,-1)"`
// so future axis labels stay upright.

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
   *  (Ctrl/Cmd toggle, plain click replace). */
  onKeyClick?: (time: number, event: React.MouseEvent) => void;
  /** Click handler for the empty SVG canvas (anywhere not on a key
   *  circle). Convention: clear the selection. */
  onCanvasClick?: (event: React.MouseEvent) => void;
};

const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 300;
const DEFAULT_TIME_MIN = 0;
const DEFAULT_TIME_MAX = 100;

const SELECTED_FILL = "#0EA5E9";    // sky-500 — matches Screen 4 accent
const UNSELECTED_FILL = "#e5e5e5";

/** Linear-interpolate a value into 0..1 then map into 0..length.
 *  Clamps NaN/Infinity at the bounds to prevent broken SVG output. */
function project(value: number, min: number, max: number, length: number): number {
  if (!Number.isFinite(value) || max <= min) return 0;
  const t = (value - min) / (max - min);
  return Math.max(0, Math.min(1, t)) * length;
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
  }));

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

  return (
    <svg
      data-testid="curve-editor-svg"
      data-track={track.name}
      data-key-count={track.keys.length}
      data-interpolation={interp}
      role="img"
      aria-label={`${track.name} curve, ${track.keys.length} keys`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-full w-full select-none"
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
        onClick={(e) => {
          e.stopPropagation();
          onCanvasClick?.(e);
        }}
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
      {points.length >= 2 && interp === "smooth" && (
        <path
          data-testid="curve-path"
          fill="none"
          stroke="#e5e5e5"
          strokeWidth={1.5}
          d={buildSmoothPath(points)}
          pointerEvents="none"
        />
      )}
      {points.length >= 2 && interp === "step" && (
        <polyline
          data-testid="curve-polyline"
          data-interpolation="step"
          fill="none"
          stroke="#e5e5e5"
          strokeWidth={1.5}
          points={buildStepPolyline(points)}
          pointerEvents="none"
        />
      )}
      {points.length >= 2 && interp === "linear" && (
        <polyline
          data-testid="curve-polyline"
          data-interpolation="linear"
          fill="none"
          stroke="#e5e5e5"
          strokeWidth={1.5}
          points={points.map((p) => `${p.x},${p.y}`).join(" ")}
          pointerEvents="none"
        />
      )}

      {/* Per-key circles. r=4 (unselected) / r=5 (selected) — the
          enlarged hit target also makes the selected key
          visually pop. Click handler stops propagation so the SVG's
          canvas-click handler doesn't fire on the same gesture. */}
      {points.map((p, i) => {
        const selected = selectedKeyTimes?.has(p.time) ?? false;
        return (
          <circle
            key={i}
            data-testid="curve-key"
            data-key-time={p.time}
            data-selected={selected ? "true" : "false"}
            cx={p.x}
            cy={p.y}
            r={selected ? 5 : 4}
            fill={selected ? SELECTED_FILL : UNSELECTED_FILL}
            stroke="#0a0a0a"
            strokeWidth={1}
            style={{ cursor: onKeyClick ? "pointer" : undefined }}
            onClick={(e) => {
              e.stopPropagation();
              onKeyClick?.(p.time, e);
            }}
          />
        );
      })}
    </svg>
  );
}
