// Vitest render tests for the EmitterTree multi-selection drag preview
// (Tasks 6 + 7). With a multi-root selection, a pointer drag past the
// activation threshold over another root must:
//   - dispatch emitters/reorder-many on release (Task 6),
//   - render a make-room gap at the drop point + a cursor chip following the
//     pointer (Task 7 — preview D).
//
// The single-drag path (emitters/drop) is covered by EmitterTree.test.tsx;
// here we only exercise the additive multi-drag branch.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Bridge, EmitterTreeDto } from "@particle-editor/bridge-schema";
import { EmitterTree } from "../EmitterTree";
import { useEmitterSelectionStore } from "@/lib/emitter-selection";

function fixtureTree(): EmitterTreeDto {
  return {
    root: {
      id: -1, name: "", role: "root", linkGroup: 0, visible: true,
      children: [
        {
          id: 0, name: "Smoke", role: "root", linkGroup: 0, visible: true,
          children: [],
        },
        {
          id: 3, name: "Sparks", role: "root", linkGroup: 0, visible: true,
          children: [],
        },
        {
          id: 5, name: "Flash", role: "root", linkGroup: 0, visible: true,
          children: [],
        },
      ],
    },
  };
}

function makeStubBridge() {
  const tree = fixtureTree();
  const snapshot = { selectedEmitterId: null };
  return {
    request: vi.fn().mockImplementation((req: { kind: string; params?: unknown }) => {
      if (req.kind === "emitters/list") return Promise.resolve(tree);
      if (req.kind === "engine/state/snapshot") return Promise.resolve(snapshot);
      if (req.kind === "emitters/select") return Promise.resolve({});
      // reorder-many resolves with the block's new contiguous indices so
      // applyNewSelection (in reorderManyEmitters) doesn't throw.
      if (req.kind === "emitters/reorder-many") {
        const ids = (req.params as { ids: number[] }).ids;
        return Promise.resolve({ ok: true, newIds: ids });
      }
      return Promise.resolve({});
    }),
    on: vi.fn().mockReturnValue(() => {}),
  } as unknown as Bridge & { request: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
}

/** Stub a row button's rect so the drop-zone third math is deterministic. */
function stubRect(el: HTMLElement, top: number, height: number) {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    writable: true,
    value: () => ({
      top, bottom: top + height, left: 0, right: 200, width: 200, height,
      x: 0, y: top, toJSON: () => "{}",
    }),
  });
}

beforeEach(() => {
  useEmitterSelectionStore.getState().clear();
});

describe("EmitterTree multi-drag preview", () => {
  it("dragging a multi-root selection renders the destination band + cursor chip and commits reorder-many", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => expect(screen.getByText("Smoke")).toBeInTheDocument());

    // Multi-root selection: Smoke(0) + Flash(5) — two roots, non-contiguous.
    fireEvent.click(screen.getByText("Smoke"));
    fireEvent.click(screen.getByText("Flash"), { ctrlKey: true });
    expect(useEmitterSelectionStore.getState().ids).toEqual([0, 5]);

    const flashBtn  = screen.getByText("Flash").closest("button")!;
    const sparksBtn = screen.getByText("Sparks").closest("button")!;
    stubRect(sparksBtn, 100, 30); // thirds at 10px; y=3 → "above"

    // pointerdown at y=0, then a move (y=103, past the 4px threshold) over
    // Sparks' upper third — multi branch resolves a destination gap (gap=1,
    // above Sparks) and shows the preview while the drag is still live.
    fireEvent.pointerDown(flashBtn, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(sparksBtn, { button: 0, clientX: 40, clientY: 103 });

    // Preview D: cursor chip (vertical name list) following the pointer + a
    // make-room gap at the drop point (above Sparks, id=3).
    const chip = screen.getByTestId("drag-chip");
    expect(chip).toBeInTheDocument();
    expect(chip.textContent).toContain("Smoke");
    expect(chip.textContent).toContain("Flash");
    expect(screen.getByTestId("drop-gap-3")).toBeInTheDocument();
    // The single-drag insertion line must NOT render for a multi-drag.
    expect(screen.queryByTestId("drop-indicator-above-3")).toBeNull();

    // Release commits the block reorder via the reorder-many bridge message
    // (NOT emitters/drop, which is the single-drag path).
    fireEvent.pointerUp(sparksBtn, { button: 0, clientX: 40, clientY: 103 });
    const calls = (bridge.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const reorder = calls.find((c) => c.kind === "emitters/reorder-many");
    expect(reorder).toBeDefined();
    expect(reorder.params).toEqual({ ids: [0, 5], rootIndex: 1 });
    expect(calls.find((c) => c.kind === "emitters/drop")).toBeUndefined();

    // Chip + band clear once the drag finishes.
    expect(screen.queryByTestId("drag-chip")).toBeNull();
    expect(screen.queryByTestId("drop-gap-3")).toBeNull();
  });

  it("a single-root drag still uses the insertion line + emitters/drop (no band/chip)", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => expect(screen.getByText("Smoke")).toBeInTheDocument());

    // Single selection of the dragged root — NOT a multi-drag.
    fireEvent.click(screen.getByText("Flash"));

    const flashBtn  = screen.getByText("Flash").closest("button")!;
    const sparksBtn = screen.getByText("Sparks").closest("button")!;
    stubRect(sparksBtn, 100, 30);

    fireEvent.pointerDown(flashBtn, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(sparksBtn, { button: 0, clientX: 0, clientY: 103 });

    // No multi preview; the single-drag insertion line shows instead.
    expect(screen.queryByTestId("drag-chip")).toBeNull();
    expect(screen.queryByTestId("drop-gap-3")).toBeNull();
    expect(screen.getByTestId("drop-indicator-above-3")).toBeInTheDocument();

    fireEvent.pointerUp(sparksBtn, { button: 0, clientX: 0, clientY: 103 });
    const calls = (bridge.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(calls.find((c) => c.kind === "emitters/drop")).toBeDefined();
    expect(calls.find((c) => c.kind === "emitters/reorder-many")).toBeUndefined();
  });
});
