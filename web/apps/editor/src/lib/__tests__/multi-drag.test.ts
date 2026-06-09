import { describe, it, expect } from "vitest";
import {
  selectedRootIdsInOrder,
  isMultiDrag,
  collectSubtreeIds,
  resolveGapFromGeometry,
  gapContentY,
  liftedBlockHeight,
  computeChipTarget,
  type RootBlockGeometry,
} from "@/lib/multi-drag";
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
describe("collectSubtreeIds", () => {
  it("returns the node's id plus every descendant id, depth-first", () => {
    const node: EmitterTreeNode = {
      id: 0, name: "A", role: "root", linkGroup: 0, visible: true,
      children: [
        {
          id: 1, name: "A1", role: "lifetime", linkGroup: 0, visible: true,
          children: [
            { id: 2, name: "A1a", role: "death", linkGroup: 0, visible: true, children: [] },
          ],
        },
        { id: 4, name: "A2", role: "lifetime", linkGroup: 0, visible: true, children: [] },
      ],
    };
    expect(collectSubtreeIds(node)).toEqual([0, 1, 2, 4]);
  });
  it("returns just the id for a leaf", () => {
    expect(collectSubtreeIds(roots[0]!)).toEqual([0]);
  });
});

// --- Geometric gap resolver (preview-polish session) ---
// (Replaced resolveMultiDropIntent — the hovered-row/zone resolver — whose
// footprint-noop contract lives on in resolveGapFromGeometry.)

// 4 root blocks in content space: block 1 is TALL (root + 2 children, 72px);
// the rest are single 24px rows. mids: 12, 60, 108, 132.
const geom: RootBlockGeometry = {
  tops:    [0, 24, 96, 120],
  bottoms: [24, 96, 120, 144],
};

describe("resolveGapFromGeometry", () => {
  it("midpoint rule with no gap rendered: the gap index = blocks whose midpoint is above the pointer", () => {
    // non-contiguous block so no probe lands in a noop footprint
    expect(resolveGapFromGeometry(geom, [0, 2], 5, null, 48)).toEqual({ rootIndex: 0 });
    expect(resolveGapFromGeometry(geom, [0, 2], 20, null, 48)).toEqual({ rootIndex: 1 });
    expect(resolveGapFromGeometry(geom, [0, 2], 70, null, 48)).toEqual({ rootIndex: 2 });
  });
  it("the contiguous block's own footprint resolves to 'noop'", () => {
    // blocks [1,2] → noop for gaps 1..3
    expect(resolveGapFromGeometry(geom, [1, 2], 70, null, 96)).toBe("noop");   // g=2
    expect(resolveGapFromGeometry(geom, [1, 2], 20, null, 96)).toBe("noop");   // g=1
    expect(resolveGapFromGeometry(geom, [1, 2], 5, null, 96)).toEqual({ rootIndex: 0 });
    expect(resolveGapFromGeometry(geom, [1, 2], 143, null, 96)).toEqual({ rootIndex: 4 });
  });
  it("a non-contiguous selection never no-ops", () => {
    expect(resolveGapFromGeometry(geom, [0, 2], 20, null, 48)).toEqual({ rootIndex: 1 });
  });
  it("un-shifts the pointer past the rendered gap; a pointer INSIDE the gap clamps to the same gap (fixed point)", () => {
    // gap rendered at 0 (H=96): block 0 renders at 96..120. Pointer 100 →
    // original-space 4 → still gap 0.
    expect(resolveGapFromGeometry(geom, [1, 2], 100, 0, 96)).toEqual({ rootIndex: 0 });
    // pointer 50 sits INSIDE the rendered gap [0,96] → clamps to boundary 0 → gap 0.
    expect(resolveGapFromGeometry(geom, [1, 2], 50, 0, 96)).toEqual({ rootIndex: 0 });
  });
  it("stability property: from any REACHABLE state, iteration converges with no cycles, and a resolved gap is itself a fixed point", () => {
    // "Reachable" = states the caller can actually render: no gap, or a gap
    // the resolver itself can return (never inside the block's own
    // footprint). A noop transition may take ONE transient hop (the clear
    // reflows the list, so the same pointer legitimately means something new
    // — on-screen-consistent at every step), but it must never cycle, and
    // wherever the gap lands must be stable for a stationary pointer. That
    // last clause is the anti-flicker guarantee.
    const blocks = [[0, 1], [1, 2], [2, 3], [0, 2]]; // contiguous + non-contiguous
    for (const blk of blocks) {
      const H = liftedBlockHeight(geom, blk);
      const first = blk[0]!;
      const last = blk[blk.length - 1]!;
      const contiguous = last - first + 1 === blk.length;
      const inFootprint = (g: number) => contiguous && g >= first && g <= last + 1;
      const reachable: Array<number | null> =
        [null, ...[0, 1, 2, 3, 4].filter((g) => !inFootprint(g))];
      for (let p = -10; p <= 250; p += 1) {
        for (const g0 of reachable) {
          let state: number | null = g0;
          const seen = new Set<string>([String(g0)]);
          for (let i = 0; i < 6; i++) {
            const r = resolveGapFromGeometry(geom, blk, p, state, H);
            const next = r === "noop" ? null : r.rootIndex;
            if (next === state) break; // converged
            expect(seen.has(String(next)), `cycle blk=[${blk}] p=${p} g0=${g0} revisits ${next}`).toBe(false);
            seen.add(String(next));
            state = next;
          }
          const settled = resolveGapFromGeometry(geom, blk, p, state, H);
          const settledNext = settled === "noop" ? null : settled.rootIndex;
          expect(settledNext, `did not converge blk=[${blk}] p=${p} g0=${g0}`).toBe(state);
        }
      }
    }
  });
});

describe("geometry helpers", () => {
  it("gapContentY returns the gap boundary: tops[g] for g<N, last bottom for g=N", () => {
    expect(gapContentY(geom, 0)).toBe(0);
    expect(gapContentY(geom, 2)).toBe(96);
    expect(gapContentY(geom, 4)).toBe(144);
  });
  it("liftedBlockHeight sums the dragged blocks' measured extents", () => {
    expect(liftedBlockHeight(geom, [1, 2])).toBe(96);  // 72 + 24
    expect(liftedBlockHeight(geom, [0, 3])).toBe(48);  // 24 + 24
  });
});

describe("computeChipTarget", () => {
  it("offsets from the pointer when no gap is active", () => {
    expect(computeChipTarget(100, 200, null, 0.6)).toEqual({ x: 112, y: 212 });
  });
  it("pulls the chip Y toward the gap center by the pull factor", () => {
    // baseY = 212, gap center 100 → 212 + (100-212)*0.5 = 156
    expect(computeChipTarget(100, 200, 100, 0.5)).toEqual({ x: 112, y: 156 });
  });
});
