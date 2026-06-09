// multi-drag.ts — pure helpers for multi-selection drag-reorder of the emitter
// tree. No React/DOM, so they unit-test directly; the pointer controller in
// EmitterTree.tsx calls them. Reorder-only, root-only — reparent stays a
// single-emitter-drag affordance.
import type { EmitterTreeNode } from "@particle-editor/bridge-schema";

/** The selected ids that are CURRENTLY roots, in tree (top-to-bottom) order. */
export function selectedRootIdsInOrder(
  selectedIds: number[],
  rootChildren: EmitterTreeNode[],
): number[] {
  const sel = new Set(selectedIds);
  return rootChildren.filter((c) => sel.has(c.id)).map((c) => c.id);
}

/** All ids in `node`'s subtree (the node itself + every descendant,
 *  depth-first). Drives the lifted-block dimming: the whole subtree of a
 *  dragged root reads as "in hand", not just the root row. */
export function collectSubtreeIds(node: EmitterTreeNode): number[] {
  return [node.id, ...node.children.flatMap(collectSubtreeIds)];
}

/** Whether a drag begun on `grabbedId` should move the whole selection: true
 *  iff the grabbed row is a root AND part of a multi-root selection. */
export function isMultiDrag(
  grabbedId: number,
  selectedIds: number[],
  rootChildren: EmitterTreeNode[],
): boolean {
  const roots = selectedRootIdsInOrder(selectedIds, rootChildren);
  return roots.length > 1 && roots.includes(grabbedId);
}

/** Own-footprint no-op test: a CONTIGUOUS block dropped anywhere inside
 *  [first, last+1] lands exactly where it already is. Mirrors the guard in
 *  mock-state.ts::reorderManyRoots — keep in sync. */
function isOwnFootprint(blockRootIdxs: number[], gap: number): boolean {
  const first = blockRootIdxs[0]!;
  const last = blockRootIdxs[blockRootIdxs.length - 1]!;
  return last - first + 1 === blockRootIdxs.length && gap >= first && gap <= last + 1;
}

// --- Geometric gap resolution (preview polish) ---
// The drop gap is computed from a geometry snapshot captured at drag
// activation instead of live DOM hit-testing. The live-DOM approach needed a
// HOLD workaround (inserting the make-room gap reflows the list, the pointer
// lands on the pointer-events-none gap, the target resolves null, the gap
// clears, the rows snap back — flicker), which in turn made the gap "stick"
// for ~a block height of travel on tall blocks. Resolving against fixed
// geometry has no dead zones at all: every pointer Y maps to a gap or the
// footprint no-op, continuously.

/** Root-block extents at drag activation, in scroll-CONTENT space (px from
 *  the top of the scrollable content — scroll-invariant). Block k spans the
 *  root row + its whole subtree: [tops[k], bottoms[k]). */
export type RootBlockGeometry = {
  tops: number[];
  bottoms: number[];
};

/** Content-space Y of gap boundary `g`: the top of block `g`, or the bottom
 *  of the last block for the end gap (g = N). This is also where the rendered
 *  make-room spacer's top edge sits. */
export function gapContentY(geom: RootBlockGeometry, g: number): number {
  return g < geom.tops.length ? geom.tops[g]! : geom.bottoms[geom.bottoms.length - 1]!;
}

/** Total measured height of the dragged blocks — the make-room spacer's
 *  height, so the gap previews the true size of what will land there. */
export function liftedBlockHeight(geom: RootBlockGeometry, blockRootIdxs: number[]): number {
  return blockRootIdxs.reduce((sum, k) => sum + (geom.bottoms[k]! - geom.tops[k]!), 0);
}

/** Resolve the drop gap for a pointer at content-space `pointerY`, given the
 *  gap currently rendered (`currentGap`, null = none) of height `gapHeight`.
 *
 *  Two steps:
 *  1. **Un-shift**: content at/below the rendered gap is shifted down by
 *     `gapHeight`; map the pointer back into the snapshot's original space.
 *     A pointer INSIDE the gap clamps to the gap's boundary, which resolves
 *     back to the same gap — the stability fixed point (no flicker; verified
 *     by a fixed-point property test).
 *  2. **Midpoint rule**: the gap index = the number of blocks whose midpoint
 *     lies above the pointer (the classic sortable-list rule — you displace a
 *     block by crossing its midpoint).
 *
 *  Returns `"noop"` on the block's own footprint (caller clears the gap so a
 *  release leaves the order unchanged); otherwise the target gap. Never null —
 *  there are no dead zones in geometric space. */
export function resolveGapFromGeometry(
  geom: RootBlockGeometry,
  blockRootIdxs: number[],
  pointerY: number,
  currentGap: number | null,
  gapHeight: number,
): { rootIndex: number } | "noop" {
  let y = pointerY;
  if (currentGap !== null) {
    const boundary = gapContentY(geom, currentGap);
    if (y > boundary) y = Math.max(boundary, y - gapHeight);
  }
  let g = 0;
  for (let k = 0; k < geom.tops.length; k++) {
    if ((geom.tops[k]! + geom.bottoms[k]!) / 2 < y) g++;
  }
  if (isOwnFootprint(blockRootIdxs, g)) return "noop";
  return { rootIndex: g };
}

/** Where the cursor chip wants to be: anchored at the pointer (+12px offset,
 *  clear of the cursor glyph), with its Y pulled `pull` of the way toward the
 *  active gap's screen-space center — the chip "flows into" the gap. No gap
 *  (or footprint no-op) → plain pointer offset. */
export function computeChipTarget(
  pointerX: number,
  pointerY: number,
  gapScreenCenterY: number | null,
  pull: number,
): { x: number; y: number } {
  const x = pointerX + 12;
  const y = pointerY + 12;
  if (gapScreenCenterY === null) return { x, y };
  return { x, y: y + (gapScreenCenterY - y) * pull };
}
