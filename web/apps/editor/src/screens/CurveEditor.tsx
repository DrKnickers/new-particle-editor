// CurveEditor — read-only SVG renderer for a single track.
//
// Phase 3 Screen 6 Batch A foundation: pure presentational, no
// interaction. Renders:
//   - viewBox sized canvas (default 600×300).
//   - 11×11 grid lines + outer axes (10 ticks/axis).
//   - Polyline connecting consecutive keys in time order.
//   - A circle at each key position.
//
// SVG-vs-canvas profiling vehicle: locked to SVG this batch because the
// expected key counts are <20/track and DOM-level testability matters
// for Vitest + Playwright. If profiling at Batch B shows 100+ keys
// render slowly, we revisit the choice with data.
//
// Smooth + step interpolation refinements are deferred to Batch B —
// the polyline approximation is honest about the data shape but loses
// the "this curve is stepped" / "this curve is smooth" visual hint.
// Wiring those is part of the same change that adds key-drag editing.
//
// Y axis inversion: SVG origin is top-left, but values increase
// upward in the UI. We flip per-coordinate (`H - normalisedY * H`)
// rather than applying a `transform="scale(1,-1)"` on the whole group
// so future axis labels / tick text stay upright without further
// counter-transforms.

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
};

const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 300;
const DEFAULT_TIME_MIN = 0;
const DEFAULT_TIME_MAX = 100;

/** Linear-interpolate a value into 0..1 then map into 0..length.
 *  Clamps NaN/Infinity at the bounds to prevent broken SVG output. */
function project(value: number, min: number, max: number, length: number): number {
  if (!Number.isFinite(value) || max <= min) return 0;
  const t = (value - min) / (max - min);
  return Math.max(0, Math.min(1, t)) * length;
}

export function CurveEditor({
  track,
  valueRange,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  timeMin = DEFAULT_TIME_MIN,
  timeMax = DEFAULT_TIME_MAX,
}: Props) {
  const { min: vMin, max: vMax } = valueRange;

  // Pre-compute the projected positions once so the polyline and the
  // circles share the same coordinate calculation.
  const points = track.keys.map((k) => ({
    x: project(k.time, timeMin, timeMax, width),
    // Y inversion: SVG origin is top-left. Subtract from height so
    // larger values render higher on the canvas.
    y: height - project(k.value, vMin, vMax, height),
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

  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <svg
      data-testid="curve-editor-svg"
      data-track={track.name}
      data-key-count={track.keys.length}
      role="img"
      aria-label={`${track.name} curve, ${track.keys.length} keys`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-full w-full select-none"
    >
      {/* Grid */}
      <g data-testid="curve-grid" stroke="#262626" strokeWidth={1}>
        {verticalLines.map((x, i) => (
          <line key={`v${i}`} x1={x} y1={0} x2={x} y2={height} />
        ))}
        {horizontalLines.map((y, i) => (
          <line key={`h${i}`} x1={0} y1={y} x2={width} y2={y} />
        ))}
      </g>

      {/* Outer axes (left + bottom darker for orientation) */}
      <g data-testid="curve-axes" stroke="#525252" strokeWidth={1.5}>
        <line x1={0} y1={0} x2={0} y2={height} />
        <line x1={0} y1={height} x2={width} y2={height} />
      </g>

      {/* The curve. Hidden when there are <2 keys (a single point
          doesn't form a polyline). Stroke uses a neutral colour this
          batch; track-specific colouring (red curve in red, green in
          green, etc.) is part of the Batch B polish pass. */}
      {points.length >= 2 && (
        <polyline
          data-testid="curve-polyline"
          fill="none"
          stroke="#e5e5e5"
          strokeWidth={1.5}
          points={polylinePoints}
        />
      )}

      {/* Per-key circles. r=4 matches the legacy CurveEditor's hit
          tolerance; we keep the same size so Batch B's click-to-
          select migration doesn't need a separate "interaction" pass
          to enlarge them. */}
      {points.map((p, i) => (
        <circle
          key={i}
          data-testid="curve-key"
          cx={p.x}
          cy={p.y}
          r={4}
          fill="#e5e5e5"
          stroke="#0a0a0a"
          strokeWidth={1}
        />
      ))}
    </svg>
  );
}
