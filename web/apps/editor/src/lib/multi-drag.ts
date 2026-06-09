// multi-drag.ts — pure helpers for multi-selection drag-reorder of the emitter
// tree. No React/DOM, so they unit-test directly; the pointer controller in
// EmitterTree.tsx calls them. Reorder-only, root-only — reparent stays a
// single-emitter-drag affordance.
import type { EmitterTreeNode } from "@particle-editor/bridge-schema";
import { computeRootGapIndex, type DropZone } from "@/lib/drop-zone";

/** The selected ids that are CURRENTLY roots, in tree (top-to-bottom) order. */
export function selectedRootIdsInOrder(
  selectedIds: number[],
  rootChildren: EmitterTreeNode[],
): number[] {
  const sel = new Set(selectedIds);
  return rootChildren.filter((c) => sel.has(c.id)).map((c) => c.id);
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

/** Resolve a multi-drag drop to a target gap, or null when refused:
 *    - "onto" (middle third) → refused (reparent is single-only),
 *    - non-root target → refused,
 *    - own-footprint no-op (an already-contiguous block in [first, last+1]).
 *  `blockRootIdxs` = the dragged block's current root indices, ascending. */
export function resolveMultiDropIntent(
  blockRootIdxs: number[],
  target: EmitterTreeNode,
  targetRootIdx: number,
  zone: DropZone,
  rootCount: number,
): { rootIndex: number } | null {
  if (zone === "onto") return null;
  if (target.role !== "root" || targetRootIdx === -1) return null;
  const gap = computeRootGapIndex(targetRootIdx, zone);
  if (gap < 0 || gap > rootCount) return null;
  const first = blockRootIdxs[0]!;
  const last = blockRootIdxs[blockRootIdxs.length - 1]!;
  const M = blockRootIdxs.length;
  // Mirrors the no-op guard in mock-state.ts::reorderManyRoots — keep in sync.
  if (last - first + 1 === M && gap >= first && gap <= last + 1) return null;
  return { rootIndex: gap };
}
