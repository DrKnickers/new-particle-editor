// Vitest unit test for the RenameEmitterDialog (Screen 4 Batch B1).
// Verifies that the modal renders a text input pre-filled with the
// current name and OK fires `emitters/rename`.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RenameEmitterDialog } from "../RenameEmitterDialog";
import { useTreeContextStore } from "@/lib/tree-context";
import type { Bridge } from "@particle-editor/bridge-schema";

function makeStubBridge(): Bridge & { request: ReturnType<typeof vi.fn> } {
  return {
    request: vi.fn().mockResolvedValue({}),
    on: vi.fn().mockReturnValue(() => {}),
  } as unknown as Bridge & { request: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  useTreeContextStore.getState().close();
});

describe("RenameEmitterDialog", () => {
  it("renders the text input pre-filled with the current name and OK fires emitters/rename", () => {
    const bridge = makeStubBridge();
    useTreeContextStore.getState().openDialog("rename", 7);
    render(<RenameEmitterDialog bridge={bridge} initialName="Smoke" />);

    const input = screen.getByTestId("rename-emitter-input") as HTMLInputElement;
    expect(input.value).toBe("Smoke");

    fireEvent.change(input, { target: { value: "Smoke 2" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    expect(bridge.request).toHaveBeenCalledWith({
      kind: "emitters/rename",
      params: { id: 7, name: "Smoke 2" },
    });
  });
});
