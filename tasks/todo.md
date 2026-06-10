# Session 32 — Part 3: reorder glide animation (stable id + FLIP)

_User-directed start while they work elsewhere; design pre-agreed in
[next-reorder-glide-animation.md](next-reorder-glide-animation.md) (fix the
root cause — stable id — then a standard React FLIP, all reorder paths).
Branch: `claude/reorder-glide` stacked on `claude/multiselect-drag` (#106)._

## 1. Goal + scope

When the emitter list reorders (single drag, multi drag, Move Up/Down), rows
**glide** to their new positions (~200ms ease) instead of snapping.

**In:** host-side stable per-emitter id surfaced on the DTO; React rows keyed
by it; a FLIP pass on flat-list order changes; `prefers-reduced-motion` skips
the glide. **Out:** persisting stable ids into `.alo` (runtime-only — undo
restore rebuilds emitters, so a glide doesn't play across undo/redo: rows
remount, acceptable); animating expand/collapse or add/delete (only moves);
the chain investigation (deferred, see next-emitter-chain-investigation.md).

## 2. What the codebase already gives us

- `ParticleSystem::Emitter` has exactly 3 constructors
  ([ParticleSystem.cpp:478](../src/ParticleSystem.cpp:478) reader, :529
  default, :534 copy) — a static counter assignment in each covers every
  creation path (load, add-root, add-child, duplicate, paste, import, undo).
- DTO built in BridgeDispatcher (`BuildEmitterTree`-style walker for
  `emitters/list`); schema `EmitterTreeNode` in
  `web/packages/bridge-schema/src/index.ts`; mock tree in `mock-state.ts`
  (mock node ids are ALREADY stable — mirror `stableId = id`).
- Rows render in `EmitterTree.tsx` flatRows map, currently keyed by
  `row.node.id` (positional — the thing to replace).
- Animation prior art: hand-rolled rAF (PanelLayout dock-slide; this
  session's chip spring); `prefers-reduced-motion` pattern established.
- Native tests assert tree *structure* from `emitters/list`, not strict DTO
  goldens → adding a field is additive.

## 3. Architecture

- **Host:** `unsigned int stableId` on `Emitter`, assigned in all 3 ctors
  from a process-monotonic counter. Surfaced as `stableId` in the
  `emitters/list` JSON.
- **Schema:** `EmitterTreeNode.stableId: number` (required).
- **Mock:** `stableId: id` at fixture-build + wherever new nodes are created
  (duplicate/paste assign fresh ids already → fresh stableIds).
- **Web:** rows keyed `key={row.node.stableId}`; new `useFlipReorder` hook in
  EmitterTree: `useLayoutEffect` per flatRows change — read each row's
  `offsetTop` (layout position, transform-immune), diff vs a ref-map keyed by
  stableId, apply inverted `translateY`, force reflow, transition to 0 over
  ~200ms ease; update the map every pass. Reduced-motion: update map only.
  Pure delta math in `lib/flip.ts`, unit-tested.

## 4. Risks + mitigations

1. **FLIP fights the drag preview** (gap spacer insertion also reflows rows
   mid-drag): gate the glide to fire only when NOT dragging (`draggingId ===
   null`) — the make-room shift stays instant, the post-drop settle glides.
2. **Transform-polluted measurements:** read `offsetTop`, never
   `getBoundingClientRect`, and cancel in-flight transitions before
   re-measuring.
3. **Undo/redo rebuilds emitters → new stableIds → remount, no glide:**
   accepted (out of scope); keyed remount is correct, just unanimated.
4. **DTO field fan-out:** additive; bridge contract tests updated; native
   harness re-run to prove 174/0.

## 5. Testing & verification

- vitest: `lib/flip.ts` delta math; schema/mock contract (stableId present,
  stable across reorder, fresh on duplicate); EmitterTree render keyed by
  stableId (reorder does NOT remount rows — spy via element identity).
- `tsc -b` 0; full suite; native 174/0; host Debug x64 clean.
- User smoke (L-033): glide feel on all three paths; reduced-motion off
  switch; no glide mid-drag.

## Part 3 progress
- [x] Host stableId (all 3 Emitter ctors + fresh-on-copy; counter at
      ParticleSystem.cpp top) + DTO (`BuildEmitterTreeNode` + both synthetic
      roots) + schema (required field) + mock (offset counter 1001+ so
      id≠stableId fails fast; fresh ids in duplicate/paste reassign walks)
- [x] Web: rows keyed by stableId + `lib/flip.ts` (pure deltas, tested) +
      FLIP layout effect in EmitterTree (offsetTop measure, gated off-drag,
      reduced-motion = bookkeeping only)
- [x] Verify: web 624/624 (incl. element-identity no-remount test), tsc 0,
      host Debug x64 clean, native 174/0; browser-verified live glide
      (Move Up mid-animation transform translateY(40px)→0 observed)
- [ ] User smoke (L-033): glide feel on all three paths; the drop-path
      double-motion question (gap collapse + reorder are two renders — does
      it read as one glide or a stutter? tune/suppress if it stutters)

---

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

---

## Part 2 (session 32 cont.) — single drag gets gap+chip + highlight-follow

User feedback after the host smoke: (a) the make-room gap + chip should also
apply to **single** drag, not just multi; (b) after a single drop the
highlight does **not** follow the dropped emitter.

**Root cause of (b) (verified, host + mock):** `emitters/drop` returns only
`{ ok }` and never re-selects — `m_selectedEmitterId` is untouched, no
`emitters/selected` emitted. The stale positional id then highlights the old
slot (now a different emitter). The multi path follows only because
`reorder-many` returns `newIds` and `reorderManyEmitters` re-selects.

**Scope (user-confirmed):**
- Reorder zones (drop a root above/below another root) → **gap + chip**, same
  geometric machinery as multi (a single root = a size-1 block). Commit via
  `reorderManyEmitters([id], gap)` → highlight follows (newIds, host+mock), no
  host change.
- Reparent (drop a root **onto** a row to nest it) → **keep the onto-ring**;
  highlight follows via a small **host change** (`emitters/drop` re-selects the
  moved emitter + emits `emitters/selected`; mock parity). Covers both
  reorder and reparent follow.

**Design — unify single+multi on the geometric controller.**
- A single-root drag becomes `blockIds = [source.id]`, reusing
  `captureRootBlockGeometry` + `resolveGapFromGeometry` for the reorder gap
  and the chip (`chipNames = [source.name]`).
- Single drag additionally supports **onto** (reparent), which multi doesn't.
  Onto needs per-row hit-testing; to stay flicker-free I snapshot **per-row**
  geometry at activation (`RowGeometry`) and resolve onto from it (un-shift +
  middle-third), never live DOM. The onto branch reuses the existing,
  tested `resolveDropIntent` for reparent validation (slot / cycle /
  same-parent); only the hit-test moves to geometry.
- The single-drag **2px insertion line is replaced by the make-room gap**; the
  DropIndicator becomes a clean union `{kind:"gap"|"onto"}`.
- **Oscillation risk** (onto has no gap, reorder has a gap → toggling reflows
  the list by the gap height under a stationary pointer): pinned by extending
  the **no-cycle property test** to the single-root resolver. Implement the
  simple version first; only add transition-confirmation/hysteresis if the
  property test finds a cycle (test-driven, no speculative complexity).

**Files:** `lib/multi-drag.ts` (RowGeometry + `resolveSingleRootDrop`),
`screens/EmitterTree.tsx` (rowGeom capture, single-drag geometric resolution,
unify reorder commit, chip for single, indicator union, drop the line),
`src/host/BridgeDispatcher.cpp` (drop re-selects), `bridge/mock.ts` (parity),
+ vitest. Verify: full suite, tsc, browser smoke at the onto/reorder
boundary, native 174/0, host Debug build, then user host smoke.

### Part 2 progress
- [x] lib resolver + no-cycle property (test-first; simple resolver converged,
      no hysteresis needed)
- [x] EmitterTree wiring (gap+chip+onto, unify commit via reorder-many, drop
      the 2px line, indicator union {gap|onto})
- [x] host + mock drop re-select (BridgeDispatcher scans for the moved
      `Emitter*`'s new index + emits `emitters/selected`; mock parity)
- [x] full verify: web 620/620, tsc 0, build clean, native 174/0 (both
      emitter-drag bridge tests pass), host Debug x64 clean
- [x] browser smoke: single reorder gap+chip+subtree-dim+follow; reparent
      onto-ring (no gap) + nest + follow; no console errors
- [ ] user host smoke (feel verdict)

### Part 2 review

Shipped single-drag parity + the highlight-follow fix on `claude/multiselect-drag`:
- **Unified controller** — a single root is a size-1 block; reorder reuses
  `resolveGapFromGeometry` + `reorderManyEmitters` (so the highlight follows via
  `newIds`). Single drag adds `resolveSingleRootDrop` (geometric, one pass →
  reorder gap OR reparent onto) backed by a per-row `captureRowGeometry`
  snapshot, reusing the tested `resolveDropIntent` for reparent validity. The
  2px insertion line is gone; the indicator is now `{kind:"gap"|"onto"}`.
- **Highlight-follow** — host `emitters/drop` now re-selects the moved emitter
  (scan for the dragged `Emitter*`'s new index) + emits `emitters/selected`;
  mock mirrors it. Reorder already followed via reorder-many.
- **No-cycle gate** — the onto↔gap toggle reflows the list; the property test
  was extended to the single resolver and the simplest un-shift resolver passed
  with no hysteresis (test-driven, no speculative complexity).
- **Verification:** web 620/620 (incl. the extended no-cycle property + updated
  single-drag component tests), tsc 0, vite build clean, native 174/0, host
  Debug x64 clean; browser-preview drove both paths (reorder + reparent) with
  the highlight following and zero console errors.
