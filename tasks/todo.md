# Multi-drag preview polish (session 32) — PR #106 branch

## 1. Goal + scope

Polish the multi-select drag-reorder *preview* so the gesture reads clearly:
the whole lifted subtree dims, the cursor chip stays compact and visually
"flows into" the destination gap, and the make-room gap tracks the pointer
smoothly instead of sticking ~block-height on tall blocks. All on
`claude/multiselect-drag` (PR #106, still open); user judges feel live in the
host after each batch (L-033).

**In:**
1. **Subtree dimming** — children of dragged roots dim with their parent
   (single-drag subtree dims too, for consistency).
2. **Dim opacity differentiation** — lifted rows read differently from
   hidden rows (both are `opacity-50` today).
3. **Chip cap + styling** — cap the cursor chip at 4 names + "+k more".
4. **Geometric gap resolver** — multi-drag drop target computed from a
   drag-start geometry snapshot (pure math), replacing live DOM hit-testing
   and the hold-on-dead-zone workaround.
5. **Chip magnetize** (user's new idea) — the chip is attracted toward the
   active gap so the emitters visually "go into" it; springs back to the
   pointer when there's no gap.

**Out:**
- The glide animation on commit — deferred, needs stable emitter ids
  (`tasks/next-reorder-glide-animation.md`).
- Single-drag indicator changes — the 2px line + onto-ring stay as-is
  (only the *dimming* touches the single path).
- Reconcile/merge of #106 + CHANGELOG TODO backfills — after the user is
  happy with the feel (handoff NEXT item 2/3).

## 2. What the codebase already gives us

- `web/apps/editor/src/screens/EmitterTree.tsx` — the pointer-drag
  controller (`startDrag`, ~:1326), `updateDropTarget` (~:1361, the HOLD
  logic lives here), the gap spacer render (~:1828), the chip render
  (~:1996), row dimming `isDragging` (:531, `opacity-50` :627).
  `flatRows` (depth-first `FlatRow { node, depth, siblings, indexInSiblings }`,
  :126) + `rootChildren`. Rows carry `data-emitter-id`; the scroll viewport
  is `treeScrollRef`.
- `web/apps/editor/src/lib/multi-drag.ts` — pure, unit-tested
  `isMultiDrag` / `selectedRootIdsInOrder` / `resolveMultiDropIntent`
  (3-state: gap | "noop" | null). The footprint-noop rule mirrors
  `mock-state.ts::reorderManyRoots`.
- `lib/drop-zone.ts` `computeDropZone`/`computeRootGapIndex`;
  `lib/drag-autoscroll.ts` `computeAutoscrollDelta` (the rAF tick).
- Animation prior art: hand-rolled rAF lerp in `PanelLayout.tsx` (incl.
  `prefers-reduced-motion` handling ~:236). No animation library.
- `EmitterTreeNode.children` — recursion source for descendant-id collection.

## 3. Architecture / implementation approach

### Batch A — cheap visuals (items 1–3)

- **Subtree dim:** at drag activation, expand the dim set to descendants:
  `collectSubtreeIds(node) = [node.id, ...node.children.flatMap(collectSubtreeIds)]`.
  Multi: `setDraggingIds(blockIds.flatMap(collect))`; single:
  `setDraggingIds(collect(source))` (so `isDragging` at :531 needs no change;
  `draggingId` stays the grabbed row for the existing single-drag logic).
- **Opacity:** dragged rows get a distinct treatment from hidden
  (`opacity-50`): start with `opacity-40` + `saturate-50` on dragged; tune
  live with the user.
- **Chip cap:** render `names.slice(0, 4)` + `+{n-4} more` row when
  `names.length > 4`. Data (`chipNames`) unchanged; cap at render.

### Batch B — geometric resolver (item 4)

New pure function in `lib/multi-drag.ts`:

```ts
/** Geometry snapshot captured at drag activation (content space, px). */
type RootBlockGeometry = { tops: number[]; bottoms: number[] };
// boundaries: Y_g = tops[g] for g<N, Y_N = bottoms[N-1]
// midpoints:  mid_k = (tops[k] + bottoms[k]) / 2

/** Resolve the drop gap for pointer content-Y `p`, given the gap currently
 *  rendered (`currentGap`, null = none) of height `gapHeight`. Returns the
 *  same footprint-noop contract as resolveMultiDropIntent. */
export function resolveGapFromGeometry(
  geom: RootBlockGeometry,
  blockRootIdxs: number[],
  p: number,
  currentGap: number | null,
  gapHeight: number,
): { rootIndex: number } | "noop"
```

- **Un-shift mapping:** with a gap at `g` (top `Y_g`, height `H`), rendered
  content below `Y_g` is shifted +H. Map pointer back to original space:
  `origY = p <= Y_g ? p : max(Y_g, p - H)` (pointer inside the gap clamps to
  the boundary → resolves back to `g` → **stable fixed point**, no flicker).
- **Midpoint rule:** `g' = count of blocks k with mid_k < origY` (the classic
  sortable-list rule; continuous in `p`, no dead zones at all — every pointer
  Y resolves, so the HOLD workaround and the `null` dead-zone state go away
  for the multi path).
- **Footprint noop:** unchanged rule — contiguous block and
  `g' ∈ [first, last+1]` → `"noop"` (gap clears; release = leave it).
- **Snapshot capture:** at drag activation (gap not yet rendered), read each
  root block's span from the live rows: group `flatRows` into root subtree
  ranges, take `offsetTop`/`offsetTop+offsetHeight` of the first/last row
  elements (content space — scroll-invariant, measured not assumed).
  Pointer → content space: `clientY - scrollRect.top + scrollTop` (live each
  move, so autoscroll keeps working; the rAF tick reuses the same resolve).
- **Indicator shape:** multi indicator becomes `{ multi: true, gapIndex,
  blockSize, rowHeight }` — render the spacer *by root index* (before root
  `g`'s row for `g < N`; after the final flat row for `g === N`). This also
  fixes the current quirk where a "below" gap on a root with children renders
  between the root and its own subtree.
- Single-drag path untouched (`resolveDropIntent` + line/ring as today).

### Batch C — chip magnetize (item 5)

- Chip gets a **target**: gap active → `{ x: pointerX + 12,
  y: blend(pointerY + 12, gapScreenCenterY, k) }` with `k ≈ 0.6` vertical
  pull (tune live); no gap / noop → plain pointer offset. Gap screen Y is
  computed from the geometry snapshot (`Y_g` + scroll rect − scrollTop),
  not a DOM query.
- **Smoothing:** rAF spring on a ref (`pos += (target − pos) * 0.25` per
  frame), chip rendered from the spring state; loop runs only while a multi
  drag is active (piggyback on the existing drag lifecycle).
  `prefers-reduced-motion`: skip the spring (chip jumps to target) — the
  *position blend* is information, the *glide* is decoration.

### Sequencing

Batch A → `pnpm build` → user smokes in host while Batch B is built →
Batch B+C → build → user smokes → iterate values (opacity, `k`, spring
factor) live → full verify → commit(s) on `claude/multiselect-drag` → push
(refreshes PR #106).

## 4. Risks + mitigations

1. **Resolver oscillation at gap boundaries** (the un-shift correction
   depends on the *current* gap → potential feedback loop): the clamp
   `max(Y_g, p − H)` makes in-gap pointers resolve to the same gap, and the
   midpoint rule is monotonic in `origY`. Mitigation: vitest **fixed-point
   property** — for sampled `p` over tall/short block layouts,
   `resolve(p, resolve(p, g).gap) === resolve(p, g)`; plus hand-traced
   boundary cases (tall block over short rows, the wf-pass lesson).
2. **Indicator shape change breaks existing multi-drag tests** (they assert
   `drop-gap-<targetId>` / targetId+zone): update the affected tests with
   the new gap-index test-ids; single-drag tests must pass *unchanged* —
   that's the regression canary.
3. **Mixed row heights / density drift** (ROW_HEIGHT assumptions bit the
   wf design pass): the snapshot *measures* every row's `offsetTop`/
   `offsetHeight`; no constant is assumed. Accepted: a mid-drag density
   change invalidates the snapshot — not worth designing around (the tree
   doesn't mutate mid-gesture today by the same argument the controller
   already relies on).
4. **Autoscroll + magnetize fighting** (chip springs while content scrolls
   under a stationary pointer): gap screen-Y is recomputed each tick from
   live `scrollTop`, so the target moves with the content; the spring
   follows. Verify by user smoke (drag to list edge, hold).
5. **`prefers-reduced-motion` split** (glide skipped but state must stay
   correct): position updates always happen; only the easing is gated —
   same pattern as `PanelLayout.tsx`.
6. **A11y goldens** — spacer/chip stay `aria-hidden`, row `data-*` only;
   no accessible-tree change expected. Native harness re-run confirms
   (174/0).

## 5. Testing & verification

**Pre-flight baseline (done, this worktree):** web 604/604, `tsc -b` 0,
host Debug x64 clean (VS18), dist built, native 174/0.

- **Happy paths:** [ ] drag a 2-block and a tall (≥6-row incl. children)
  block up/down — gap tracks each pointer crossing of a block midpoint, no
  stick, no flicker; [ ] chip shows ≤4 names + "+k more"; [ ] chip pulls
  toward the gap when one is active, returns to pointer on noop;
  [ ] children of every dragged root dim; single-drag subtree dims too.
- **Edge cases:** [ ] gap index 0 (top) and N (very end, after the last
  root's subtree — not between a root and its children); [ ] footprint
  hover → gap clears, release = no-op, no wire call; [ ] non-contiguous
  selection over its own interleaved footprint; [ ] hidden (`opacity-50`)
  + dragged row renders the *dragged* treatment.
- **Cancellation:** [ ] Esc and right-click mid-drag clear gap + chip +
  dimming; [ ] release over the gap commits to the held gap index.
- **Refused inputs:** [ ] child-row grab in a multi selection stays a
  single drag (`isMultiDrag` false) — unchanged behavior.
- **Undo round-trip:** [ ] one Ctrl+Z restores the pre-drop order
  (existing `reorder-many` undo — regression check only).
- **Suites:** [ ] new resolver unit tests incl. fixed-point property;
  [ ] full `pnpm --filter @particle-editor/editor test` (L-074: full suite,
  not scoped); [ ] `tsc -b` 0; [ ] `pnpm build`; [ ] native 174/0 after
  final build (L-068: dist before harness).
- **User smoke in the real host (L-033):** every feel item above — I
  cannot judge stick/flicker/magnetic pull from tests.

## Progress

- [x] Pre-flight (restore + 604/604 + tsc 0 + host build + dist + 174/0)
- [x] Plan written, user scope confirmed (all 5 items + magnetize; partial
      pull; subtree dim on both paths)
- [x] Batch A: subtree dim + opacity + chip cap
- [x] Batch B: geometric resolver
- [x] Batch C: chip magnetize
- [x] Full verify (615/615, tsc 0, native 174/0, browser-preview drive)
- [ ] User smoke in the real host (feel verdict + value tuning)

## Review (session 32)

**Shipped on `claude/multiselect-drag` (extends PR #106).** All five polish
items built TDD-style and verified:

- **Subtree dimming** — `collectSubtreeIds` (lib/multi-drag.ts); the dim set
  expands to all descendants at drag activation, both drag paths.
- **Dragged ≠ hidden** — lifted rows are `opacity-40 saturate-50`; hidden
  stays `opacity-50`.
- **Chip cap** — 4 names + "+k more".
- **Geometric resolver** — `RootBlockGeometry` snapshot at activation
  (`captureRootBlockGeometry`, measured not assumed) +
  `resolveGapFromGeometry` (un-shift + midpoint rule). No dead zones, no
  HOLD. The gap spacer now sizes to the lifted block's TRUE measured height
  and renders by gap index (also fixing the old quirk where a "below" gap on
  a parent rendered between the root and its own children; the end gap now
  renders after the last subtree). Superseded `resolveMultiDropIntent`
  (deleted).
- **Chip magnetize** — `computeChipTarget` blend (CHIP_PULL 0.6) + rAF
  spring (CHIP_SPRING 0.25); reduced-motion skips the glide, keeps the
  position.

**Verification evidence.**
- vitest **615/615** full suite (the 5 superseded resolver tests removed,
  16 added incl. the fixed-point stability property — which caught a real
  transient on its first run, exactly its job); `tsc -b` 0; vite build
  clean; native harness **174/0** (no a11y surface change — spacer + chip
  stay `aria-hidden`).
- **Browser preview (MockBridge) drive**: selection [Smoke, Flash] →
  dimmed rows `[0,1,2,5]` (children included), gap `drop-gap-at-1` at
  80px (= 4 measured lifted rows), chip settled at 211.59px = the computed
  blend target (pointer 196 / gap-center 222 / pull 0.6) to the pixel; Esc
  cleared gap + chip + dimming; zero console errors/warnings.
- **Gotcha logged**: synthetic `pointerdown` with default `pointerType: ""`
  held on a Radix ContextMenu.Trigger fires the touch long-press → menu
  opens. Real mice send `pointerType: "mouse"`. Noted in CHANGELOG.

**Remaining (user's eye, L-033):** feel verdict in the real host — gap
tracking on tall blocks, magnet strength (CHIP_PULL), spring speed
(CHIP_SPRING), dim opacity. All single-constant tweaks + `pnpm build`.
