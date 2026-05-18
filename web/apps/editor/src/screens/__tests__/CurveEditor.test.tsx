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

  // ─── Screen 6 Batch B-β ────────────────────────────────────────────

  it("pointer-down + move + up on an interior key fires onKeyDragEnd with the new (time, value)", () => {
    const track = fixtureTrack(3);            // times 0, 50, 100; values 0.1, 0.9, 0.1
    const onDragEnd = vi.fn();
    const onKeyClick = vi.fn();
    const { container } = render(
      <CurveEditor
        track={track}
        valueRange={{ min: 0, max: 1 }}
        width={600}
        height={300}
        onKeyClick={onKeyClick}
        onKeyDragEnd={onDragEnd}
      />,
    );
    const svg = container.querySelector(
      "[data-testid='curve-editor-svg']",
    ) as SVGSVGElement;
    // jsdom returns 0×0 for getBoundingClientRect; stub it so the
    // viewBox <-> client-coord mapping has a valid scale.
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 600, bottom: 300, width: 600, height: 300, x: 0, y: 0, toJSON: () => "" } as DOMRect);

    const circles = container.querySelectorAll("[data-testid='curve-key']");
    const middle = circles[1]! as SVGCircleElement;
    // Pointer-down on the middle key (time=50, value=0.9).
    fireEvent.pointerDown(middle, { pointerId: 1, button: 0, clientX: 300, clientY: 30 });
    // Pointer-move on the SVG itself (the source's pointer is captured
    // by the SVG-level handler). New target client coords: (270, 60)
    // → x=270 → time=45; y=60 → height-y=240 → value=0.8.
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 270, clientY: 60 });
    // Pointer-up commits.
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 270, clientY: 60 });

    expect(onDragEnd).toHaveBeenCalledTimes(1);
    const [oldTime, newTime, newValue] = onDragEnd.mock.calls[0] as [number, number, number];
    expect(oldTime).toBe(50);
    // newTime should be clamped within (0, 100) exclusive; 45 falls in
    // range so it's preserved (or very close — pixel math).
    expect(newTime).toBeGreaterThan(0);
    expect(newTime).toBeLessThan(100);
    expect(newTime).toBeCloseTo(45, 1);
    // newValue should map to 0.8 (within float epsilon).
    expect(newValue).toBeCloseTo(0.8, 2);
    // The plain click handler is NOT invoked when a drag actually
    // moved.
    expect(onKeyClick).not.toHaveBeenCalled();
  });

  it("pointer-down then pointer-up on a key without movement fires onKeyClick (not onKeyDragEnd)", () => {
    const track = fixtureTrack(3);
    const onDragEnd = vi.fn();
    const onKeyClick = vi.fn();
    const { container } = render(
      <CurveEditor
        track={track}
        valueRange={{ min: 0, max: 1 }}
        width={600}
        height={300}
        onKeyClick={onKeyClick}
        onKeyDragEnd={onDragEnd}
      />,
    );
    const svg = container.querySelector("[data-testid='curve-editor-svg']") as SVGSVGElement;
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 600, bottom: 300, width: 600, height: 300, x: 0, y: 0, toJSON: () => "" } as DOMRect);
    const middle = container.querySelectorAll("[data-testid='curve-key']")[1]!;
    // Pointer down + up at the same coords (no movement past slop).
    fireEvent.pointerDown(middle, { pointerId: 3, button: 0, clientX: 300, clientY: 30 });
    fireEvent.pointerUp(svg, { pointerId: 3, clientX: 300, clientY: 30 });
    expect(onDragEnd).not.toHaveBeenCalled();
    expect(onKeyClick).toHaveBeenCalledTimes(1);
    expect(onKeyClick.mock.calls[0]![0]).toBe(50);
  });

  it("border keys render with the accent stroke ring + darker fill", () => {
    const track = fixtureTrack(3);
    const { container } = render(
      <CurveEditor track={track} valueRange={{ min: 0, max: 1 }} />,
    );
    const circles = container.querySelectorAll("[data-testid='curve-key']");
    // First + last keys are border.
    const first = circles[0]!;
    const last = circles[2]!;
    const middle = circles[1]!;
    expect(first.getAttribute("data-border")).toBe("true");
    expect(last.getAttribute("data-border")).toBe("true");
    expect(middle.getAttribute("data-border")).toBe("false");
    // Stroke + stroke-width attributes confirm the visual.
    expect(first.getAttribute("stroke")).toBe("#0EA5E9");
    expect(first.getAttribute("stroke-width")).toBe("1.5");
    expect(first.getAttribute("fill")).toBe("#94A3B8");
    expect(last.getAttribute("stroke")).toBe("#0EA5E9");
    expect(last.getAttribute("stroke-width")).toBe("1.5");
    // Interior key keeps the default stroke + the lighter fill.
    expect(middle.getAttribute("stroke")).toBe("#0a0a0a");
    expect(middle.getAttribute("fill")).toBe("#e5e5e5");
  });

  it("pointer-down on empty canvas in Insert mode fires onCanvasAdd with the projected (time, value)", () => {
    const track = fixtureTrack(2);
    const onCanvasAdd = vi.fn();
    const { container } = render(
      <CurveEditor
        track={track}
        valueRange={{ min: 0, max: 1 }}
        width={600}
        height={300}
        insertMode
        onCanvasAdd={onCanvasAdd}
      />,
    );
    const svg = container.querySelector(
      "[data-testid='curve-editor-svg']",
    ) as SVGSVGElement;
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 600, bottom: 300, width: 600, height: 300, x: 0, y: 0, toJSON: () => "" } as DOMRect);
    const backdrop = container.querySelector(
      "[data-testid='curve-canvas-backdrop']",
    ) as SVGRectElement;
    // Click the canvas at (180, 90) → x=180 → time=30; height-y=210 → value=0.7.
    fireEvent.pointerDown(backdrop, { pointerId: 2, button: 0, clientX: 180, clientY: 90 });
    expect(onCanvasAdd).toHaveBeenCalledTimes(1);
    const [time, value] = onCanvasAdd.mock.calls[0] as [number, number];
    expect(time).toBeCloseTo(30, 1);
    expect(value).toBeCloseTo(0.7, 2);
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
