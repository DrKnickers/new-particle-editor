import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteConfirmModal } from "@/components/DeleteConfirmModal";
import { useDeleteConfirmStore } from "@/lib/delete-emitters";
import type { Bridge } from "@particle-editor/bridge-schema";

function recordingBridge() {
  const calls: number[] = [];
  const bridge = {
    request: (req: { kind: string; params: { id?: number } }) => {
      if (req.kind === "emitters/delete" && typeof req.params.id === "number") calls.push(req.params.id);
      return Promise.resolve({});
    },
    on: () => () => {},
  } as unknown as Bridge;
  return { bridge, calls };
}

beforeEach(() => useDeleteConfirmStore.setState({ pending: null }));

describe("DeleteConfirmModal", () => {
  it("is hidden with no pending delete", () => {
    const { bridge } = recordingBridge();
    render(<DeleteConfirmModal bridge={bridge} />);
    expect(screen.queryByText(/delete/i)).toBeNull();
  });

  it("shows subtree copy and deletes on confirm", async () => {
    const { bridge, calls } = recordingBridge();
    useDeleteConfirmStore.setState({ pending: { ids: [0], impact: { affectedCount: 3, primaryName: "a", isDestructive: true } } });
    render(<DeleteConfirmModal bridge={bridge} />);
    expect(screen.getByText('Delete "a" and its 2 child emitters?')).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(calls).toEqual([0]);
    expect(useDeleteConfirmStore.getState().pending).toBeNull();
  });

  it("shows multi-select copy and cancels without deleting", async () => {
    const { bridge, calls } = recordingBridge();
    useDeleteConfirmStore.setState({ pending: { ids: [1, 2, 3], impact: { affectedCount: 3, primaryName: "a1", isDestructive: true } } });
    render(<DeleteConfirmModal bridge={bridge} />);
    expect(screen.getByText("Delete 3 emitters?")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(calls).toEqual([]);
    expect(useDeleteConfirmStore.getState().pending).toBeNull();
  });
});
