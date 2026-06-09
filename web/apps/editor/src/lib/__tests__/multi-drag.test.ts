import { describe, it, expect } from "vitest";
import { selectedRootIdsInOrder, isMultiDrag, resolveMultiDropIntent } from "@/lib/multi-drag";
import type { EmitterTreeNode } from "@particle-editor/bridge-schema";

const roots: EmitterTreeNode[] = [0, 1, 2, 3].map((id) => ({
  id, name: String(id), role: "root", linkGroup: 0, visible: true, children: [],
}));

describe("selectedRootIdsInOrder", () => {
  it("returns selected roots in tree order, ignoring non-roots", () => {
    expect(selectedRootIdsInOrder([3, 0, 99], roots)).toEqual([0, 3]);
  });
});
describe("isMultiDrag", () => {
  it("is true only when the grabbed row is a root in a multi-root selection", () => {
    expect(isMultiDrag(1, [1, 2], roots)).toBe(true);
    expect(isMultiDrag(1, [1], roots)).toBe(false);
    expect(isMultiDrag(9, [1, 2], roots)).toBe(false);
  });
});
describe("resolveMultiDropIntent", () => {
  it("returns a reorder gap for a valid root drop", () => {
    expect(resolveMultiDropIntent([1, 2], roots[3]!, 3, "below", 4)).toEqual({ rootIndex: 4 });
  });
  it("refuses an onto (reparent) zone", () => {
    expect(resolveMultiDropIntent([1, 2], roots[3]!, 3, "onto", 4)).toBeNull();
  });
  it("returns 'noop' for the block's own footprint (leave it where it is)", () => {
    expect(resolveMultiDropIntent([1, 2], roots[1]!, 1, "above", 4)).toBe("noop");
    expect(resolveMultiDropIntent([1, 2], roots[2]!, 2, "below", 4)).toBe("noop");
  });
  it("refuses a non-root target (e.g. hovering a child row)", () => {
    const child: EmitterTreeNode = {
      id: 7, name: "c", role: "lifetime", linkGroup: 0, visible: true, children: [],
    };
    expect(resolveMultiDropIntent([1, 2], child, -1, "above", 4)).toBeNull();
  });
  it("refuses an out-of-range gap (defensive guard)", () => {
    // artificial targetRootIdx past the root list -> computeRootGapIndex > rootCount
    expect(resolveMultiDropIntent([1, 2], roots[3]!, 4, "below", 4)).toBeNull();
  });
});
