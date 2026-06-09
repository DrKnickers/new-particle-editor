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

/** Resolve a multi-drag drop over a hovered row to one of three outcomes:
 *    - `{ rootIndex }` — a valid drop gap (move the block there);
 *    - `"noop"`        — the block's OWN footprint (an already-contiguous block
 *                        in [first, last+1]); a deliberate "leave it where it
 *                        is", distinct from a dead zone;
 *    - `null`          — a dead zone: the "onto" middle third (reparent is
 *                        single-only), a non-root target, or an out-of-range gap.
 *  The caller CLEARS the gap on `"noop"` (so a release leaves the order
 *  unchanged — you're not forced to move the block once you grab it) but HOLDS
 *  the last gap on `null` (so the preview doesn't flicker as the shifted rows /
 *  the gap pass under the pointer). `blockRootIdxs` = the dragged block's current
 *  root indices, ascending. */
export function resolveMultiDropIntent(
  blockRootIdxs: number[],
  target: EmitterTreeNode,
  targetRootIdx: number,
  zone: DropZone,
  rootCount: number,
): { rootIndex: number } | "noop" | null {
  if (zone === "onto") return null;
  if (target.role !== "root" || targetRootIdx === -1) return null;
  const gap = computeRootGapIndex(targetRootIdx, zone);
  if (gap < 0 || gap > rootCount) return null;
  const first = blockRootIdxs[0]!;
  const last = blockRootIdxs[blockRootIdxs.length - 1]!;
  const M = blockRootIdxs.length;
  // Own-footprint no-op. Mirrors the guard in mock-state.ts::reorderManyRoots —
  // keep in sync. Returned as "noop" (not null) so the caller distinguishes a
  // deliberate leave-it-here from a dead zone.
  if (last - first + 1 === M && gap >= first && gap <= last + 1) return "noop";
  return { rootIndex: gap };
}
