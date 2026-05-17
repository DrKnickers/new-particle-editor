// Vitest unit test for the SetLinkGroupDialog (Screen 4 Batch B2).
// Verifies that opening the modal renders both radios, that "Join
// existing group" is disabled when no groups exist in the fetched
// tree, and that OK with the default "Create new" radio fires
// linkGroups/set-membership with the captured selection ids and
// groupId: -1 (the host-side sentinel for "pick smallest unused").

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Bridge, EmitterTreeDto } from "@particle-editor/bridge-schema";
import { SetLinkGroupDialog } from "../SetLinkGroupDialog";
import { useTreeContextStore } from "@/lib/tree-context";
import { useEmitterSelectionStore } from "@/lib/emitter-selection";

function fixtureTree(): EmitterTreeDto {
  return {
    root: {
      id: -1, name: "", role: "root", linkGroup: 0, visible: true,
      children: [
        { id: 0, name: "A", role: "root", linkGroup: 0, visible: true, children: [] },
        { id: 1, name: "B", role: "root", linkGroup: 0, visible: true, children: [] },
      ],
    },
  };
}

function makeStubBridge(tree: EmitterTreeDto): Bridge & { request: ReturnType<typeof vi.fn> } {
  return {
    request: vi.fn().mockImplementation((req: { kind: string }) => {
      if (req.kind === "emitters/list") return Promise.resolve(tree);
      return Promise.resolve({});
    }),
    on: vi.fn().mockReturnValue(() => {}),
  } as unknown as Bridge & { request: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  useTreeContextStore.getState().close();
  useEmitterSelectionStore.getState().clear();
});

describe("SetLinkGroupDialog", () => {
  it("renders Create new + Join existing radios; existing is disabled when no groups exist", async () => {
    const bridge = makeStubBridge(fixtureTree());
    useEmitterSelectionStore.getState().setIds([0, 1], 0);
    useTreeContextStore.getState().openDialog("set-link-group", 0);
    render(<SetLinkGroupDialog bridge={bridge} />);

    // Both radios render.
    const radioNew = await screen.findByTestId("set-link-group-radio-new");
    const radioExisting = screen.getByTestId("set-link-group-radio-existing");
    expect(radioNew).toBeChecked();
    // Wait for the emitters/list response to flow in, then the "Join
    // existing" radio should be disabled because the fixture has no
    // groups > 0.
    await waitFor(() => {
      expect(radioExisting).toBeDisabled();
    });
  });

  it("OK with the default Create new radio fires linkGroups/set-membership with groupId: -1", async () => {
    const bridge = makeStubBridge(fixtureTree());
    useEmitterSelectionStore.getState().setIds([0, 1], 0);
    useTreeContextStore.getState().openDialog("set-link-group", 0);
    render(<SetLinkGroupDialog bridge={bridge} />);

    // Wait for the dialog to capture selection + finish the list fetch.
    await screen.findByTestId("set-link-group-radio-new");

    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    const calls = (bridge.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const membership = calls.find((c) => c.kind === "linkGroups/set-membership");
    expect(membership).toBeDefined();
    expect(membership.params).toEqual({ ids: [0, 1], groupId: -1 });
  });
});
