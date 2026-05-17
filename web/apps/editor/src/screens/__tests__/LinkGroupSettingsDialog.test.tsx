// Vitest unit test for the LinkGroupSettingsDialog (Screen 4 Batch B1).
// Verifies that:
//   1. The dialog mounts and renders checkboxes from the mock fixture
//      after `linkGroups/list-exempt-fields` resolves.
//   2. Reset All clears all checkboxes (in local state) — clicking OK
//      after Reset fires `linkGroups/set-exempt-fields` with the empty
//      set.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { LinkGroupSettingsDialog } from "../LinkGroupSettingsDialog";
import { useTreeContextStore } from "@/lib/tree-context";
import type { Bridge } from "@particle-editor/bridge-schema";

function makeStubBridge(): Bridge & {
  request: ReturnType<typeof vi.fn>;
} {
  return {
    request: vi.fn().mockImplementation((req: { kind: string }) => {
      if (req.kind === "linkGroups/list-exempt-fields") {
        return Promise.resolve({
          fields: ["colorTexture", "normalTexture", "trackIndex"],
        });
      }
      return Promise.resolve({});
    }),
    on: vi.fn().mockReturnValue(() => {}),
  } as unknown as Bridge & { request: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  useTreeContextStore.getState().close();
});

describe("LinkGroupSettingsDialog", () => {
  it("renders exempt-field checkboxes and Reset All + OK commits an empty exempt set", async () => {
    const bridge = makeStubBridge();
    await act(async () => {
      useTreeContextStore.getState().openDialog("link-group", 0, 1);
    });
    render(<LinkGroupSettingsDialog bridge={bridge} />);

    // Wait for the async fetch to resolve and the checkboxes to render.
    await waitFor(() => {
      expect(screen.getByLabelText("Color texture")).toBeTruthy();
    });

    // Default exempts are colorTexture / normalTexture / trackIndex —
    // those checkboxes should be UNCHECKED (exempt = unchecked / per-emitter).
    const colorTexture = screen.getByLabelText("Color texture") as HTMLInputElement;
    expect(colorTexture.checked).toBe(false);

    // A non-exempt field (e.g. Lifetime) should be CHECKED (shared).
    const lifetime = screen.getByLabelText("Lifetime") as HTMLInputElement;
    expect(lifetime.checked).toBe(true);

    // Reset All — every field becomes SHARED (no exempts).
    fireEvent.click(screen.getByRole("button", { name: "Reset All" }));
    expect(colorTexture.checked).toBe(true);

    // OK commits.
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(bridge.request).toHaveBeenCalledWith({
      kind: "linkGroups/set-exempt-fields",
      params: { groupId: 1, fields: [] },
    });
  });
});
