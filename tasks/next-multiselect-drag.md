# Next: multi-select click-drag reordering (design note)

_Captured 2026-06-09 by the save/delete-safety + reorder session. This is a
**future-session** item — not started. It builds directly on the multi-aware
move/duplicate work landed this session (see CHANGELOG + the commits
`5887ddc` … `364c68d` on `claude/modest-hypatia-ebdbc4`)._

## Goal

Make the emitter-tree **click-drag reorder** multi-selection-aware, consistent
with the keyboard/toolbar/context-menu move that now operates on the whole
selection. Today drag-reorder is single-item.

## Requirements (from the user)

1. **Drag moves the whole selection.** Dragging any selected row reorders the
   entire current selection as a group (not just the grabbed row). Dragging an
   *un*selected row should behave as today (single-row drag) — mirror the
   `resolveTargetIds()` rule the context menu / delete already use (act on the
   selection iff the grabbed row is part of it, else promote to single).
2. **Selection stays on the originally-selected items.** After the drop, the
   highlight remains on the same emitters that were selected before the drag
   (at their new positions) — the same "selection follows" behaviour the
   arrow/`move-many` path got this session (re-select the returned `newIds`).
   Do **not** collapse the selection to the dropped row.
3. **Same movement constraints as the arrows.** Apply the **preserve-order**
   rule: the selection moves as a unit; a group can't be dropped in a way that
   would require splitting it past the edge / deforming it. Reuse the same
   semantics as `emitters/move-many` (root-only; edge-anchored; no compacting)
   and the `canMoveSelection` predicate where a "can this land here?" check is
   needed. Decide the precise rule for dropping a non-contiguous selection at
   an arbitrary gap (likely: the group lands contiguous at the drop point, or
   the drop is refused if it can't preserve order — needs a design call).
4. **Drop preview.** Show a preview of **where the whole selection group will
   land** before releasing — not just a single insertion line. E.g. a
   multi-row ghost / a highlighted target band spanning the group's future
   position, plus the insertion indicator.

## What the codebase already gives us

- **Pointer-drag controller** (HTML5 DnD doesn't fire under arch-C composition,
  L-…): `startDrag` / the document-level pointermove/up listeners in
  [`EmitterTree.tsx`](../web/apps/editor/src/screens/EmitterTree.tsx) (search
  `pointerDrag`, `draggingId`, `indicator`, `computeDropIntent`), plus
  [`lib/drop-zone.ts`](../web/apps/editor/src/lib/drop-zone.ts),
  [`lib/drag-autoscroll.ts`](../web/apps/editor/src/lib/drag-autoscroll.ts),
  [`lib/marquee.ts`](../web/apps/editor/src/lib/marquee.ts). Today it computes a
  single `{mode:"reorder", id, rootIndex}` intent and dispatches a single move.
- **Batch move with selection-follow (this session):**
  - Host `emitters/move-many { ids, direction } -> { newIds }`
    ([`BridgeDispatcher.cpp`](../src/host/BridgeDispatcher.cpp), preserve rule).
    A drag is an arbitrary reorder (not just ±1), so this likely needs a new/
    extended host op — e.g. `emitters/reorder-many { ids, beforeRootIndex }` or
    reuse `moveEmitterToRootIndex` (`ParticleSystem.h`) for an
    absolute-position batch move that returns `newIds`. **Designing that host
    op is the main new piece.**
  - [`lib/emitter-reorder.ts`](../web/apps/editor/src/lib/emitter-reorder.ts) —
    `moveEmitters` / the `applyNewSelection` helper (re-select `newIds` + sync
    host primary). The drag handler should funnel through the same
    re-selection path.
  - [`lib/move-enabled.ts`](../web/apps/editor/src/lib/move-enabled.ts) —
    `canMoveSelection` (preserve-rule predicate) for drop validity.
- **Selection store** [`lib/emitter-selection.ts`](../web/apps/editor/src/lib/emitter-selection.ts)
  — `ids` / `primary` / `setIds`.

## Open design questions to resolve first

1. **Host op for absolute-position batch reorder.** `move-many` is ±1 only. A
   drag drops at an arbitrary index → need a batch "move these ids to land
   starting before root index N" that preserves order and returns `newIds`.
   `ParticleSystem::moveEmitterToRootIndex` exists; compose it (careful with
   index shifts — same pointer-stable trick as `move-many`).
2. **Non-contiguous drop semantics.** If `{A, C}` is dragged to between `D` and
   `E`, do they land contiguous (`…D A C E…`) or keep their relative gaps? The
   user wants order preserved — almost certainly "land contiguous in selection
   order at the drop point," but confirm.
3. **Preview rendering.** Single insertion line today; multi needs a group
   ghost or a banded target. Decide visual treatment with the user (L-033 —
   tune in the real host).

## Verification when built

vitest for the new host op (mock parity) + the drag→reorder→reselect flow;
native rebuild + harness 174/0; user smoke-test of the drag feel + preview in
the real host (L-033). See `tasks/lessons.md` L-074 (integration tasks run the
FULL suite) and L-075 (grep the wire-kind to find all call sites).
