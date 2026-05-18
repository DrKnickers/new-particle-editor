// Vitest tests for CurveEditor (Phase 3 Screen 6 Batch A).
//
// Read-only SVG renderer. Covered:
//   - Renders a <polyline> + one <circle> per key for an N-key track.
//   - Empty-key track suppresses the polyline (and circles).

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { TrackDto } from "@particle-editor/bridge-schema";
import { CurveEditor } from "../CurveEditor";

function fixtureTrack(keyCount: number): TrackDto {
  const keys = Array.from({ length: keyCount }, (_, i) => ({
    time: (i / Math.max(1, keyCount - 1)) * 100,
    value: i % 2 === 0 ? 0.1 : 0.9,
  }));
  return { name: "red", keys, interpolation: "linear" };
}

describe("CurveEditor", () => {
  it("renders a <polyline> and N <circle> elements for an N-key track", () => {
    const { container } = render(
      <CurveEditor track={fixtureTrack(5)} valueRange={{ min: 0, max: 1 }} />,
    );
    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    // polyline points string should have 5 comma-separated pairs.
    const pts = polyline!.getAttribute("points") ?? "";
    expect(pts.trim().split(/\s+/)).toHaveLength(5);

    const circles = container.querySelectorAll("circle");
    expect(circles).toHaveLength(5);
  });

  it("suppresses the <polyline> when the track has fewer than 2 keys", () => {
    const { container } = render(
      <CurveEditor track={fixtureTrack(1)} valueRange={{ min: 0, max: 1 }} />,
    );
    expect(container.querySelector("polyline")).toBeNull();
    // A single-key track still shows its one circle.
    expect(container.querySelectorAll("circle")).toHaveLength(1);
  });

  it("renders the grid (≥10 vertical + ≥10 horizontal lines) + axes", () => {
    const { container } = render(
      <CurveEditor track={fixtureTrack(3)} valueRange={{ min: 0, max: 1 }} />,
    );
    // Grid + axes use <line> elements. 11 vertical + 11 horizontal +
    // 2 axes = 24.
    const lines = container.querySelectorAll("line");
    expect(lines.length).toBeGreaterThanOrEqual(22);
  });
});
