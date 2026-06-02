# Plan — Link-group bracket polish (3 parts) + deferred items

`[lt-4]`, web/. From the 2026-06-02 review. **Plan-first per user request — no code
until confirmed.**

## Deferred from this review (not lost)
- **Black line** along the Spawner's viewport edge — arch-C compositor seam. Ruled
  OUT: rounded corners (flush-left, reverted) and React scene-rect rounding
  (ViewportSlot, reverted — both relaunched, line persisted). **Next dig is
  host-side**: the DComp clip / scene-rect stamp — `LayoutBroker.cpp` →
  `Compositor::SetEngineVisualTransform` (DComp clip) and `AlphaCompositor`
  scene-rect. Arch-C-verification-gated (L-033) → iterative with the user.

## Context — what exists today
- `computeLinkGroupBrackets` ([link-group-colors.ts:51](web/apps/editor/src/lib/link-group-colors.ts:51))
  returns per group: `{groupId, color, firstRowIndex, lastRowIndex, lane}`. Groups
  with `<2` members are skipped. **lane = greedy first-fit (aggressive REUSE)** —
  non-overlapping groups share a lane; a group's lane can move between renders.
- Render ([EmitterTree.tsx:1399](web/apps/editor/src/screens/EmitterTree.tsx:1399)):
  a 2px vertical bar per bracket (first→last row) + a 4px **top cap** and **bottom
  cap** only. Gutter is a `shrink-0` flex column AFTER `<ul flex-1>`, so the rows
  fill the panel width and shove the gutter to the **far right** (the big gap you saw).
- `ROADMAP NT-6` already flags "dedicated/stable lanes" as a parked option.

## Part 1 — per-member stubs  (clear)
Each member of a group gets a short horizontal stub off the bracket (today only the
first + last rows get caps). *Why:* signifies membership at every row, not just the
ends.
- `computeLinkGroupBrackets`: also collect `memberRowIndices: number[]` per group
  (every row where `linkGroup === g`).
- Render: draw a stub (≈4×2px, group colour) at each member row's centre-y, replacing
  the first/last-only caps. (Test: extend `link-group-colors` unit test for the new
  field; `EmitterTree.test.tsx` already asserts bracket testids.)

## Part 2 — move bracket closer to the names  (DESIGN CHOICE — needs your pick)
The gutter is pinned to the panel's right edge because `<ul>` is `flex-1`. To bring
brackets near the names, options:
- **(A) Fixed gutter right after a fixed name column.** Change the row grid to give
  the name a fixed/`minmax` width and place the bracket gutter immediately right of
  it. Predictable; long names truncate sooner.
- **(B) Absolute overlay at a fixed offset.** Keep rows full-width; absolutely
  position the bracket layer at a fixed x close to the name start (e.g. ~8px past the
  glyph column). Simplest; long names could pass under the bracket.
- **(C) Right-align the bracket to the longest visible name** (measure widest row).
  Truest "hugs the names", but needs a measure pass (ResizeObserver) — most code.
I lean **(A)** (deterministic, no measuring, matches a fixed-tree-column feel). Your call.

## Part 3 — dedicated lanes (NT-6)  (clear once "dedicated" is confirmed)
Today lanes are REUSED across non-overlapping groups. "Dedicated" = each group keeps
its **own** stable lane.
- Replace pass-3 greedy first-fit with a stable assignment: one lane per group,
  ordered by `groupId` (lane = index of the group in the sorted active-group list).
  Gutter widens to `#groups × LANE_WIDTH`. No bouncing; each group has a fixed column.
- (Alt, NT-6's literal form: `lane = (groupId-1) % maxLanes` — caps width but can
  collide. I recommend the one-lane-per-group form unless you want a hard width cap.)

## Verify (when built)
- Browser mode, **check x AND y** (lesson from the glyph-wrap miss): stubs align to
  each member row; bracket sits near the names; each group in its own lane.
- vitest (link-group-colors + EmitterTree); a11y stays 157/4 (bracket gutter is
  `aria-hidden`, so goldens shouldn't move — confirm).

## Decisions (locked 2026-06-02)
1. **Part 2 positioning**: **C — hug the longest name (measure pass)**. Bracket layer
   absolute within the scroll container at `left = max(name-text right) + gap`;
   re-measure on tree change + ResizeObserver + font load. Name text width via
   `Range.selectNodeContents(span).getBoundingClientRect()` (the 1fr name column fills,
   so the column edge ≠ text edge — must measure the text node).
2. **Part 3**: **one lane per group**, stable, ordered by `groupId` (lane = index in
   sorted active-group list). No reuse. Gutter width = `#groups × LANE_WIDTH`.
3. Order: all 3 together.

## Review section

**Implemented (all 3, web/).**
| Part | Files | Change |
|---|---|---|
| 1 — per-member stubs | `lib/link-group-colors.ts` (+test), `screens/EmitterTree.tsx` | `computeLinkGroupBrackets` now returns `memberRowIndices`; renderer draws a stub at every member row (was top/bottom caps only). |
| 2 — hug the names | `screens/EmitterTree.tsx` | Bracket layer is `absolute` at `left = measured longest-name right + 8px` (Range-measured per name, capped at the truncation edge; re-measured on tree change / ResizeObserver / font load; jsdom-guarded). Replaced the fixed flex gutter. |
| 3 — dedicated lanes | `lib/link-group-colors.ts` (+test) | One lane per group, stable by `groupId` (no greedy reuse → no bouncing). Closes NT-6's intent. |

**Verified.**
- vitest **391/45** (link-group-colors 11 tests incl. memberRowIndices + dedicated-lane; EmitterTree bracket/stub/hug tests). build/tsc clean.
- Browser (1728px, **x AND y**): group 1 (Smoke row0 + Sparks row3) → gutter `left=163` = longest-name right (155) + 8; stubs at cy 128 & 200 (match member row centres); bar `data-lane=0` spanning rows 0→3. Brackets sit beside the names, not at the panel edge (301).
- a11y **157/4** (splitters L-033) — bracket layer is `aria-hidden`, goldens unaffected.

**Not yet committed** — holding for the user's visual confirmation on relaunch (design feel: stub length, gap, lane spacing).
