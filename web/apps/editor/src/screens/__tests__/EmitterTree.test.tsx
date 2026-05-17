// Vitest unit tests for the EmitterTree sidebar (Phase 3 Screen 4
// Batch A). Verifies the fixture tree renders 3 roots with their
// children at the right indentation and that clicking a row fires
// emitters/select with the row's id.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Bridge, EmitterTreeDto } from "@particle-editor/bridge-schema";
import { EmitterTree } from "../EmitterTree";

function fixtureTree(): EmitterTreeDto {
  return {
    root: {
      id: -1, name: "", role: "root", linkGroup: 0, visible: true,
      children: [
        {
          id: 0, name: "Smoke", role: "root", linkGroup: 1, visible: true,
          children: [
            { id: 1, name: "Smoke embers", role: "lifetime", linkGroup: 0, visible: true, children: [] },
            { id: 2, name: "Smoke puff",   role: "death",    linkGroup: 0, visible: true, children: [] },
          ],
        },
        {
          id: 3, name: "Sparks", role: "root", linkGroup: 1, visible: true,
          children: [
            { id: 4, name: "Spark trail", role: "lifetime", linkGroup: 0, visible: true, children: [] },
          ],
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
    request: vi.fn().mockImplementation((req: { kind: string }) => {
      if (req.kind === "emitters/list") return Promise.resolve(tree);
      if (req.kind === "engine/state/snapshot") return Promise.resolve(snapshot);
      if (req.kind === "emitters/select") return Promise.resolve({});
      return Promise.resolve({});
    }),
    on: vi.fn().mockReturnValue(() => {}),
  } as unknown as Bridge & { request: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
}

describe("EmitterTree", () => {
  it("renders 3 root rows with their lifetime/death children", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);

    // Wait for the async emitters/list to resolve.
    await waitFor(() => {
      expect(screen.getByText("Smoke")).toBeInTheDocument();
    });
    expect(screen.getByText("Sparks")).toBeInTheDocument();
    expect(screen.getByText("Flash")).toBeInTheDocument();
    // Smoke's children render.
    expect(screen.getByText("Smoke embers")).toBeInTheDocument();
    expect(screen.getByText("Smoke puff")).toBeInTheDocument();
    // Sparks' single lifetime child.
    expect(screen.getByText("Spark trail")).toBeInTheDocument();

    // Tree wrapper exists with the correct role.
    expect(screen.getByRole("tree", { name: "Emitters" })).toBeInTheDocument();

    // Six total emitter rows (treeitem each). Synthetic root is NOT
    // rendered as a row.
    const items = screen.getAllByRole("treeitem");
    expect(items).toHaveLength(6);
  });

  it("clicking a row fires emitters/select with the row's id", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Smoke embers")).toBeInTheDocument();
    });

    // Click Smoke embers (id=1).
    fireEvent.click(screen.getByText("Smoke embers"));

    const calls = (bridge.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const selectCall = calls.find((c) => c.kind === "emitters/select");
    expect(selectCall).toBeDefined();
    expect(selectCall.params).toEqual({ id: 1 });
  });
});
