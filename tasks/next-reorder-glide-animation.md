# Next: smooth glide animation for emitter-tree reorders (design note)

_Captured 2026-06-09 by the multi-select drag-reorder session. **Deferred** out of
that feature with the user's explicit OK — it is the dominant complexity/risk of
the work, and rooted in a data-model gap (no stable emitter identity). This note
records why, and the approach a future session should take._

## Goal

When the emitter root list reorders — via **single drag**, the **Move Up/Down**
arrows, **or** the new **multi-select drag** — the rows should **glide** smoothly
to their new positions instead of snapping. Today every reorder snaps (the host
mutates, `emitters/tree/changed` fires, React re-renders the new order instantly).

## Why it was deferred (the root cause)

There is **no stable per-emitter identity**. The `EmitterTreeDto` /
`EmitterTreeNode` is `{ id, name, role, linkGroup, visible, children }`, and:
- `id` is a **positional index** that reshuffles on every structural change (it is
  *why* the batch ops return `newIds`).
- `name` is user-editable and non-unique (host default names collide).

So the clean approach — key the React rows by a stable id and let a FLIP/CSS
transition animate them across the data change — is **impossible**: after a
reorder the same emitter carries a different `id`, so React unmounts/remounts the
rows (a flicker) rather than moving them.

A 15-agent adversarial design pass (workflow `wf_4479ffea-4ec`, 2026-06-09) drafted
the imperative alternative and **broke all four** of its cases. The robust version
needs an imperative controller layered over React that:
1. **FLIPs in flat-index space off measured rects** — so a root hopping over a
   *parent's subtree* (and the ride-along children) lands correctly; root-slot
   deltas are wrong, and ROW_HEIGHT must be measured, not assumed (~24px, and it
   changes with density settings).
2. Owns a **predicted-order chain + a monotonic op-token** — to survive rapid
   re-drags and out-of-order async `emitters/tree/changed` refetches (the prediction
   base must be controller-owned, not the lagging `rootChildren`).
3. **Splits `prefers-reduced-motion`** — skip the *glide* but still run the
   bookkeeping (op-token advance / refetch arming), or the token chain develops a
   gap that corrupts a later animated op.

That is a fragile subsystem fighting the data model — more code and risk than the
reorder itself.

## Recommended approach for the follow-up

**Fix the root cause first.** Add a **stable per-emitter id** to the host emitter
model and surface it on the DTO (a monotonic handle assigned at creation, stable
across reorder/reparent — distinct from the positional `index`/`id`). With a
stable key, the glide becomes a **standard React FLIP**: key the rows by the
stable id, measure rects before/after the `tree/changed` re-render, transform the
deltas to zero over ~200ms with an `ease` curve. This is far simpler and robust
than the imperative controller, and it benefits any future tree animation.

Then apply the FLIP to all three reorder paths (single drag, arrows, multi-drag)
so the list never snaps in one path and glides in another (the user's call: all
paths).

## What the codebase already gives us

- The reorder ops + selection-follow are done: `emitters/move-many`,
  `emitters/duplicate-many`, and `emitters/reorder-many` (this session) all return
  `newIds`; [`lib/emitter-reorder.ts`](../web/apps/editor/src/lib/emitter-reorder.ts)
  `applyNewSelection` re-selects them.
- Animation prior art (hand-rolled — there is no framer-motion / react-spring):
  CSS `@keyframes` + transitions throughout, and the dock-slide pattern in
  [`PanelLayout.tsx`](../web/apps/editor/src/components/PanelLayout.tsx) (rAF capture
  → `animate-scene-rect` bridge → host wall-clock lerp). `prefers-reduced-motion`
  is already handled there (`PanelLayout.tsx` ~line 236).
- The row render + drag controller live in
  [`EmitterTree.tsx`](../web/apps/editor/src/screens/EmitterTree.tsx) (rows keyed
  today by `row.node.id` — the positional id; that key is the thing to replace).

## Verification when built

vitest for the stable-id assignment + the FLIP delta math (pure); native rebuild +
harness 174/0 (no a11y surface change expected); **user smoke of the glide *feel*
in the real host (L-033)** — the band/chip/glide tuning is the user's eye, not an
agent screenshot.
