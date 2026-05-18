// Vitest tests for CurveEditor (Phase 3 Screen 6 Batch A foundation +
// Screen 5 / Screen 6 Batch B-α interaction).
//
// Covered:
//   - Renders a <polyline> + one <circle> per key for an N-key linear track.
//   - Empty-key track suppresses the polyline.
//   - Grid + axes render the expected ≥22 lines.
//   - Clicking a key fires onKeyClick; selected-key styling applies
//     (fill + radius).
//   - Ctrl/Cmd+click toggles selection without losing the prior one
//     (verified by passing in a multi-selection set).
//   - Smooth interpolation renders a <path> with cubic-Bezier (C)
//     commands; step interpolation renders the staircase polyline.

import type { InterpolationType, TrackDto } from "@particle-editor/bridge-schema";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { CurveEditor } from "../CurveEditor";

function fixtureTrack(
  keyCount: number,
  interpolation: InterpolationType = "linear",
): TrackDto {
  const keys = Array.from({ length: keyCount }, (_, i) => ({
    time: (i / Math.max(1, keyCount - 1)) * 100,
    value: i % 2 === 0 ? 0.1 : 0.9,
  }));
  return { name: "red", keys, interpolation };
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

  // ─── Screen 5 / Screen 6 Batch B-α ────────────────────────────────

  it("clicking a key fires onKeyClick + the selected key renders with accent fill + r=5", () => {
    const track = fixtureTrack(3); // times 0, 50, 100
    const onKeyClick = vi.fn();
    const { container, rerender } = render(
      <CurveEditor
        track={track}
        valueRange={{ min: 0, max: 1 }}
        onKeyClick={onKeyClick}
      />,
    );
    const circles = container.querySelectorAll("[data-testid='curve-key']");
    expect(circles).toHaveLength(3);
    // Click the middle key (time=50).
    fireEvent.click(circles[1]!);
    expect(onKeyClick).toHaveBeenCalledTimes(1);
    expect(onKeyClick.mock.calls[0]![0]).toBe(50);

    // Re-render with the click's time in the selected set; the
    // matching circle should pick up the accent fill + larger r.
    rerender(
      <CurveEditor
        track={track}
        valueRange={{ min: 0, max: 1 }}
        selectedKeyTimes={new Set([50])}
        onKeyClick={onKeyClick}
      />,
    );
    const middle = container.querySelectorAll("[data-testid='curve-key']")[1]!;
    expect(middle.getAttribute("data-selected")).toBe("true");
    expect(middle.getAttribute("r")).toBe("5");
    expect(middle.getAttribute("fill")).toBe("#0EA5E9");
    // Sanity: the unselected siblings stay at r=4.
    const first = container.querySelectorAll("[data-testid='curve-key']")[0]!;
    expect(first.getAttribute("r")).toBe("4");
    expect(first.getAttribute("data-selected")).toBe("false");
  });

  it("Ctrl+click on a second key adds it to the selection (multi-selection styling)", () => {
    const track = fixtureTrack(3);
    const onKeyClick = vi.fn();
    // Start with the first key selected (time=0). Render then simulate
    // the second key being clicked with the ctrlKey modifier.
    const { container, rerender } = render(
      <CurveEditor
        track={track}
        valueRange={{ min: 0, max: 1 }}
        selectedKeyTimes={new Set([0])}
        onKeyClick={onKeyClick}
      />,
    );
    const circles = container.querySelectorAll("[data-testid='curve-key']");
    fireEvent.click(circles[1]!, { ctrlKey: true });
    expect(onKeyClick).toHaveBeenCalledTimes(1);
    // The handler received the click with ctrlKey set on the event.
    const evt = onKeyClick.mock.calls[0]![1] as { ctrlKey: boolean };
    expect(evt.ctrlKey).toBe(true);

    // Now render with both keys in the selection set and assert both
    // circles paint as selected. (The parent owns the actual toggle
    // logic; CurveEditor is presentational from the selection-set's
    // point of view.)
    rerender(
      <CurveEditor
        track={track}
        valueRange={{ min: 0, max: 1 }}
        selectedKeyTimes={new Set([0, 50])}
        onKeyClick={onKeyClick}
      />,
    );
    const post = container.querySelectorAll("[data-testid='curve-key']");
    expect(post[0]!.getAttribute("data-selected")).toBe("true");
    expect(post[1]!.getAttribute("data-selected")).toBe("true");
    expect(post[2]!.getAttribute("data-selected")).toBe("false");
  });

  it("smooth interpolation renders a <path> with cubic-Bezier (C) commands; step renders a staircase polyline", () => {
    // Smooth.
    const { container: smoothContainer } = render(
      <CurveEditor
        track={fixtureTrack(3, "smooth")}
        valueRange={{ min: 0, max: 1 }}
      />,
    );
    const path = smoothContainer.querySelector("[data-testid='curve-path']") as SVGPathElement | null;
    expect(path).not.toBeNull();
    const d = path!.getAttribute("d") ?? "";
    // 2 segments → 2 cubic-Bezier C commands.
    const cCount = (d.match(/C /g) ?? []).length;
    expect(cCount).toBe(2);
    // No straight-line linear polyline in the smooth branch.
    expect(
      smoothContainer.querySelector("polyline[data-interpolation='linear']"),
    ).toBeNull();

    // Step. The staircase polyline expands to 1 + 2*(N-1) points
    // (start key + 2 per segment).
    const { container: stepContainer } = render(
      <CurveEditor
        track={fixtureTrack(3, "step")}
        valueRange={{ min: 0, max: 1 }}
      />,
    );
    const stepPoly = stepContainer.querySelector(
      "polyline[data-interpolation='step']",
    ) as SVGPolylineElement | null;
    expect(stepPoly).not.toBeNull();
    const pts = (stepPoly!.getAttribute("points") ?? "").trim().split(/\s+/);
    // For N=3 keys → 5 points in the staircase.
    expect(pts).toHaveLength(5);
    // Sanity: the linear <path> isn't drawn here.
    expect(stepContainer.querySelector("[data-testid='curve-path']")).toBeNull();
  });
});
