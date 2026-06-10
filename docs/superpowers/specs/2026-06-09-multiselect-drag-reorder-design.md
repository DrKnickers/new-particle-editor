# Multi-select drag-reorder for the emitter tree — design spec

*2026-06-09 · feature branch `claude/multiselect-drag` · brainstormed with the user and
verified by a 15-agent adversarial design pass (workflow run `wf_4479ffea-4ec`: map → draft →
adversarially break). The algorithm below is the **post-verification** version — the draft's
no-op rule was wrong and is corrected here.*

## 1. Goal & scope

Make the emitter-tree click-drag reorder **multi-selection-aware**, consistent with the
keyboard/toolbar/context-menu move that already operates on the whole selection. Dragging any row
that is part of the current multi-selection reorders the **entire selection as a contiguous
block**; the highlight follows the moved emitters; movement obeys the same root-only rules as the
Move arrows.

**In scope**
- New host op `emitters/reorder-many { ids, rootIndex } → { newIds }` — atomic batch
  absolute-position root reorder — plus mock parity.
- Web multi-drag branch in the emitter tree: promotion rule, target-gap computation, dispatch,
  selection-follow.
- Drag preview **D**: insertion line + destination band (N-row reservation) + cursor chip
  (carried row names + count) — rendered **statically** (snaps between gaps; no motion tween).
- Reorder-only, root-only. Reparent ("onto" a parent slot) stays exclusive to single-emitter drag.

**Out of scope — deferred follow-up**
- **Smooth glide animation** of rows to their new positions on reorder (all paths). Deferred
  because the data model has **no stable emitter identity** (see §6); a robust glide would be a
  fragile imperative controller fighting React's positional keys. The follow-up should first add a
  stable per-emitter id, turning the glide into a simple React FLIP. To be captured as
  `tasks/next-reorder-glide-animation.md` + a ROADMAP polish item.
- Single-emitter drag (reorder + reparent) — unchanged.

## 2. What the codebase already gives us (verified map)

- **Host single reorder:** `ParticleSystem::moveEmitterToRootIndex(Emitter*, size_t)`
  ([`ParticleSystem.cpp:1450`](src/ParticleSystem.cpp:1450)). Roots live in
  `std::vector<Emitter*> m_emitters` (all emitters in layout order; roots = `parent == NULL`;
  `Emitter::index` = position). No-op rule at [`:1469`](src/ParticleSystem.cpp:1469); subtree
  reassembly + index reassignment + spawn-field rewrite at `:1486-1545`. The `emitters/drop`
  reorder branch wraps it ([`BridgeDispatcher.cpp:4574`](src/host/BridgeDispatcher.cpp:4574));
  newIds pattern at `BridgeDispatcher.cpp:4615` (paste).
- **Host batch sibling:** `emitters/move-many { ids, direction } → { newIds }` (±1 block move,
  preserve-order) — `reorder-many` is its absolute-gap cousin.
- **Web drag:** [`EmitterTree.tsx`](web/apps/editor/src/screens/EmitterTree.tsx) `startDrag` /
  `updateDropTarget` / `finish` (1292-1412), `computeDropZone`
  ([`drop-zone.ts`](web/apps/editor/src/lib/drop-zone.ts)), `resolveDropIntent` → `DropParams`
  union (`reorder | reparent`), the 2px insertion indicator (549-560), autoscroll
  ([`drag-autoscroll.ts`](web/apps/editor/src/lib/drag-autoscroll.ts)). Root rows render with
  `key={row.node.id}` (positional) at `:1750`.
- **Web reorder helpers:** `applyNewSelection(bridge, inputIds, oldPrimary, newIds)`
  ([`emitter-reorder.ts:16`](web/apps/editor/src/lib/emitter-reorder.ts)) — re-selects `newIds`,
  preserves which was primary, syncs the host single-selection. `canMoveSelection(targetIds,
  rootIdsInOrder, direction)` ([`move-enabled.ts:13`](web/apps/editor/src/lib/move-enabled.ts)) —
  root-only predicate. `resolveTargetIds()` promotion (`EmitterTree.tsx:392`).
- **Selection store:** [`emitter-selection.ts`](web/apps/editor/src/lib/emitter-selection.ts)
  (`ids`, `primary`, `setIds`, `setSingle`).

## 3. Host op `emitters/reorder-many`

**Schema** ([`bridge-schema/src/index.ts`](web/packages/bridge-schema/src/index.ts), beside
`move-many`/`duplicate-many`):
`{ kind: "emitters/reorder-many"; params: { ids: number[]; rootIndex: number } }`, with the
`ResponseFor` conditional → `{ ok: true; newIds: number[] } | { ok: false; error: string }`.
`rootIndex` is the target **gap** in the current rendered root list: gap `K` = "land before
current root K", gap `N` = "after the last root".

**Engine** — new `bool ParticleSystem::reorderManyRootsToIndex(const std::vector<Emitter*>&
selection, size_t gap, std::vector<size_t>& outNewIds)`:

1. Build current root order (`parent == NULL`, `m_emitters` order); `N` = root count. Refuse
   `gap > N`.
2. Map `selection` → ascending source root indices `S`. Refuse empty selection, an id resolving
   to no emitter, or any non-root (`parent != NULL`).
3. **No-op refusal (corrected from the draft).** Let `first = min(S)`, `last = max(S)`,
   `M = |S|`. Refuse iff the selection is **already contiguous** (`last − first + 1 == M`) **and**
   `first ≤ gap ≤ last + 1` — i.e. *any* gap on the block's own footprint, both edges **and the
   `M−1` interior gaps**. (The draft refused only the two edges; verified by trace that interior
   gaps reinsert the block into its own vacated span → identical layout → must also be refused, or
   the dispatcher would `markDirty()` on a no-change move.)
4. Compute the final order in **one pass** (no per-id loop): `rest` = unselected roots in order;
   `block` = selected roots in tree order; `insertAt = gap − (count of selected roots with
   rootIdx < gap)`; splice `block` into `rest` at `insertAt`.
5. Reassemble `m_emitters` by subtree — reuse `moveEmitterToRootIndex`'s machinery verbatim
   (collect each root's subtree in `m_emitters` order, concatenate per the new root order,
   reassign `index = position`, rewrite each parent's `spawnDuringLife`/`spawnOnDeath`).
6. `outNewIds` = the block roots' final positional `index` values (a contiguous ascending run).

**Dispatcher** ([`BridgeDispatcher.cpp`](src/host/BridgeDispatcher.cpp), beside `emitters/drop`):
resolve each id → `Emitter*` (refuse missing / non-root); refuse `rootIndex < 0` as
`"invalid rootIndex"`; `captureUndo()` **before** mutation; call `reorderManyRootsToIndex`; on
false → `{ ok:false, error:"reorder refused" }`; on true → `{ ok:true, newIds }` then
`markDirty()` + `EmitEngineStateChanged()` + `EmitEmittersTreeChanged()`.

**Index-shift correctness.** Subtract the count of selected roots **strictly before** the gap
(`< gap`, not `<= gap`: a root *at* gap K is at-or-after it, so removing it doesn't shift the gap
left). With `M == 1` this reduces byte-for-byte to the proven single-drop formula
(`gap > s ? gap−1 : gap`) — the new op is a **strict superset** of existing, verified code.

**Mock** ([`mock.ts`](web/apps/editor/src/bridge/mock.ts)): mirror the engine exactly — same
no-op rule, same `removedBeforeGap` shift, same `newIds` — over the mock tree, beside the existing
reorder / `move-many` mocks. The vitest parity tests are the guard against drift.

## 4. Web — multi-drag + static preview

- **Promotion (pointerdown).** Multi-drag iff the grabbed row is a **root** in the current
  selection **and** the selection has > 1 member; otherwise the existing single drag (reorder or
  reparent). The dragged block = the selected **root** ids in tree order — non-root selected items
  are not reorderable (consistent with the Move arrows' root-only model), and the post-drop
  highlight follows the moved roots.
- **Target + validity (pointermove).** For root gaps (zone `above`/`below` a root) compute
  `rootIndex = computeRootGapIndex(targetRootIdx, zone)`. The target is **invalid** (no indicator,
  no drop) when the zone is `onto` (reparent is single-only) or when the gap falls on the dragged
  block's own footprint (would be the §3 no-op).
- **Preview D (static).** Insertion line at the gap (reuse the existing indicator); a destination
  **band** reserving N rows at the gap; a **cursor chip** following the pointer with carried row
  names (capped, "+N more") + count. No motion tween — band/line snap between gaps as the pointer
  moves, exactly like today's indicator. Exact visual treatment tuned in the real host (L-033).
- **Commit (pointerup).** `bridge.request({ kind:"emitters/reorder-many", params:{ ids:
  selectedRootIds, rootIndex } })`; on `{ ok, newIds }` → `applyNewSelection(bridge,
  selectedRootIds, oldPrimary, newIds)`. A refused (no-op) drop is silently ignored
  (fire-and-forget, like `emitters/drop`).
- Autoscroll path reused unchanged.

## 5. Risks named up front + mitigations

1. **Index-shift arithmetic** — the canonical batch-reorder bug (wrong target after the block is
   removed). *Mitigation:* single-pass remove-then-insert with explicit `removedBeforeGap`
   accounting; adversarially verified on `[A..F]` (non-contiguous, inside-span, both ends, no-op,
   single-element); proven equivalent to the single path at `M == 1`. One vitest case per branch.
2. **No-op breadth** — every interior gap of a contiguous block is also a no-op. *Mitigation:* the
   corrected whole-footprint guard `first ≤ gap ≤ last+1` (verified by trace). vitest case.
3. **Mock / host divergence** — two implementations of one algorithm. *Mitigation:* the algorithm
   is specified once here; vitest parity tests pin mock behaviour; the host mirrors it line for
   line.
4. **Mixed root + child selection** — only roots reorder. *Mitigation:* the web filters to selected
   roots before dispatch (the host refuses non-roots regardless); the selection follows the moved
   roots.
5. **Animation scope creep** — explicitly deferred (§6); this PR's preview is static, so no glide
   controller, no positional-id FLIP, no concurrency token enter this change.

## 6. Why the glide is deferred (for the follow-up)

No stable emitter identity exists: the DTO is `{ id, name, role, linkGroup, visible, children }` —
`id` is **positional** (reshuffles on every reorder) and `name` is user-editable / non-unique. So a
robust glide cannot use a React-keyed FLIP; it needs an imperative controller that FLIPs in
**flat-index** space off measured rects, owns a predicted-order chain + a monotonic op-token (to
survive rapid re-drags and out-of-order async tree refetches), and splits prefers-reduced-motion
(skip the glide, keep the bookkeeping). The adversarial pass broke all four draft cases on exactly
these points. **Recommended follow-up:** add a stable per-emitter id to the host/DTO first; the
glide then becomes a standard React FLIP — far simpler and robust. (Today's animation tooling is
hand-rolled CSS transitions / `@keyframes` plus the dock-slide pattern in
[`PanelLayout.tsx`](web/apps/editor/src/components/PanelLayout.tsx) with host wall-clock lerp;
`prefers-reduced-motion` is already handled there.)

## 7. Testing & verification

- **vitest** (the mock is the suite's source of truth):
  - `reorder-many` algorithm: non-contiguous collapse → contiguous in tree order; drop inside the
    block's own span → refused; gap `0` and gap `N`; **interior-footprint no-op → refused** (the
    corrected rule); single-element behaves like a single reorder; index-shift across the gap.
  - drag → reorder → reselect: multi-drag dispatches `reorder-many` with the selected root ids +
    gap; `applyNewSelection` re-selects `newIds`; primary preserved.
  - promotion: grab an unselected row → single drag; grab a selected root → multi-drag.
  - validity: `onto` zones and own-footprint gaps show no indicator.
- **Host:** rebuild Debug x64 (MSBuild **VS18**, L-046); on the real host exercise undo round-trip
  (`captureUndo`), the dirty flag, and tree refresh; smoke the drag *feel* + preview with the
  user's eye (L-033).
- **Native a11y harness 174/0** — no a11y surface change expected; rebuild confirms (L-068: `pnpm
  build` before the harness).
- **Full web suite green** — reorder touches shared selection/tree state, so run the **full** suite,
  not a scoped subset (L-074).
- **CI** gates the PR: web (pnpm + Vitest) + C++ x64 Debug/Release.
