# Left-pane realignment (B1) — design spec

**Phase:** Particle Editor 2026 redesign, follow-up dispatch after Phase 2 shipped
**Date:** 2026-05-20
**Predecessor spec:** [2026-05-19 Particle Editor 2026 redesign](2026-05-19-particle-editor-2026-redesign.md)
**Target branch:** `lt-4`

> Brainstorm wireframes (transient working artifacts) lived at
> `.superpowers/brainstorm/<session>/content/`. Not committed; that
> directory should be `.gitignore`d before any commit.

---

## 1. Why this exists

The Particle Editor 2026 redesign Phase 2.5 ("Left panel restack") moved the
property-tabs inspector from the right panel into the left panel and wrapped the
column in `.panel` chrome. That dispatch optimized for structural movement and
shipped at commit [`0fd093d`](https://github.com/DrKnickers/new-particle-editor/commit/0fd093d).

When the user lived with the result, the panel "didn't look like the design
reference." Diffing the design source's [`left_panel.jsx`](../../../../../Users/antho/AppData/Local/Temp/nu-particle-editor/nuparticle-editor/project/left_panel.jsx)
against the shipped React revealed six concrete gaps. Some are stylistic; two
are structural; one is a real UX flaw (multi-group bracket rendering is
ambiguous when groups interleave).

This spec captures the realignment work. It also folds in a small algorithmic
improvement (multi-lane bracket gutter via aggressive lane reuse) that addresses
a "future polish" item already flagged in the existing code comments at
[`link-group-colors.ts:42`](../../web/apps/editor/src/lib/link-group-colors.ts:42).

The work is intentionally scoped *down* from the original Phase 2.5 vision —
several design-source affordances (search bar, header actions, per-row lock,
per-row swatch, kind-colored icons) are dropped because they either don't have
engine backing or were judged unnecessary by the user during brainstorming.

---

## 2. Goal

Make the left pane visually match the design reference's structural intent
while staying honest about which design-source affordances actually map to
real engine concepts. Specifically:

- The tree + property-tabs feel like one continuous panel, not two stacked
  compartments separated by a hard divider.
- The tree toolbar matches the design's bottom-anchored placement and visual
  treatment (banded with thin hairlines top + bottom).
- Per-row visibility is exposed on each tree row (per-row 👁), not only via
  a toolbar action that targets the primary selection.
- Multiple link groups in the gutter can be read unambiguously even when
  the groups interleave, via a multi-lane gutter rendered with aggressive
  lane reuse.

Single sentence: **the left pane should feel like a coherent, design-aware
single column of content, with link-group affordances that scale gracefully
under interleaving.**

---

## 3. Scope

### 3.1 In scope (B1)

1. **Tree-pane realignment.** Move `EmitterTreeToolbar` from above the
   `<ul>` to below it. Restyle it to match the design's `.tree-actions`
   class (banded with thin hairlines top + bottom). Drop the eye-toggle
   button from the toolbar — the per-row eye in (3) replaces it.
   `Show All` / `Hide All` stay (bulk operations remain on the toolbar).
2. **Tree + inspector visual flow.** Remove the hard `border-t border-border`
   between the tree region and the property-tabs compartment. The tab
   strip itself becomes the natural visual transition. The tab strip
   currently lives inside `EmitterPropertyTabs.tsx`; it stays there
   (no structural moves), but the surrounding chrome gets simplified.
3. **Per-row visibility eye.** Each tree row renders a small 👁 button in
   the rightmost row cell. Click toggles the emitter's `visible` via the
   existing `emitters/set-visible` request. Closed-eye icon when hidden;
   open-eye when visible. Greyed when the row is greyed (already-hidden
   emitters render at 50% opacity).
4. **Drop the per-row link-group dot.** The current per-row sky-blue dot
   (visible when `linkGroup !== 0`) goes away. Link-group membership is
   communicated entirely via the right-gutter bracket / stub, matching
   legacy editor behaviour.
5. **Multi-lane bracket gutter.** `computeLinkGroupBrackets` returns
   brackets annotated with a `lane: number` field assigned by greedy
   first-fit (aggressive reuse). The gutter renderer reads `lane` to
   compute the bracket's `left` offset. The gutter container's `width` is
   derived from the maximum lane count assigned in the current render.
6. **Single-member link groups never render.** `computeLinkGroupBrackets`
   skips any group whose member count is exactly 1. Stubs (single-row
   brackets) never appear in the gutter. The bracket renderer can drop
   its single-row-cap special case entirely — every rendered bracket has
   a true `firstRowIndex < lastRowIndex`.
7. **Eye column alignment.** Each row is a 3-column grid:
   `[12px glyph] [1fr name] [18px eye]`. The eye is the rightmost element
   in the row. Because the row width is uniform across all rows and only
   the gutter (outside the row) varies, eyes column-align automatically
   under any data state.
8. **Tests.** Update Vitest specs that previously asserted against the
   old layout. Add specs for: per-row eye toggle dispatch, multi-lane
   lane assignment correctness, single-member filter, gutter width
   derivation.

### 3.2 Out of scope (deferred)

| Item | Reason / disposition |
|---|---|
| Appearance + Physics tab wiring (~100 form fields) | **Dispatch B2.** Separate brainstorm + spec. The schema-side DTO already carries the fields; only the React rendering is missing. Doing both visual + wiring in one dispatch makes the diff harder to review and couples a visual-correctness signoff to a feature-correctness signoff. |
| Panel-header action buttons (＋ / 📁 / 🗑) | User dropped during brainstorming. Header stays title-only. |
| Search bar at top of tree | User dropped during brainstorming. |
| Per-row lock icon | No engine backing. Dropped along with per-row swatch + per-row kind icon. |
| Per-row color swatch | No engine backing (real emitters have R/G/B/A *curves*, not a single color). |
| Kind-colored icons (flame / cloud / sparkle / cube) | No engine `kind` field; would be a UI-only invention. Dropped. |
| Reset / Settings / Solo buttons in the tree toolbar | No engine equivalents. The design source had them as placeholders. Dropped. |
| Single scroll for the entire panel | User preferred independent scroll (tree scrolls in its region; inspector scrolls in its own). Visual smoothing — yes; behavioural change — no. |
| **Engine-side single-member-group invariant enforcement** | **Roadmap follow-up.** Render-layer filter handles B1's stub-rendering need. Engine-side auto-demote (at `linkGroups/set-membership`, `emitters/delete`, group-creation -1 with 1 id) is a separate dispatch — touches multiple C++ mutation points + needs its own undo capture + tests. Filed as a roadmap item (NT-? — assign on entry). |
| Visual-stability lane assignment (group → permanent lane) | Roadmap follow-up. Aggressive reuse picked because it keeps the gutter narrowest when groups are sparse, which is the common case. Stability is more useful with many co-existing groups, which is rare in real particle effects. |
| Right gutter rendering past the bracket — vertical scrollbar position | Untouched. Tree's internal `overflow-y-auto` produces a scrollbar that lives to the right of the gutter today; it stays there. |

### 3.3 Out of scope, but recorded as roadmap candidates

These bubble up as natural follow-ups to B1; ROADMAP.md should gain entries
for them at B1 ship time:

- **Engine-side single-member group invariant.** As above. Without it, the
  data carries orphan groups that the gutter filters out — the Inspector's
  "Link Group: N" field on such an emitter says N but no bracket renders.
- **Visual-stability lane assignment as an option.** If aggressive reuse's
  lane-shifting between renders becomes a daily-use annoyance, give the
  user a setting to opt into stability.
- **Multi-membership link groups** (one emitter in multiple groups). Schema
  change. Would surface as multiple stubs / brackets per row. B1's row grid
  already accommodates this — the gutter widens uniformly to fit.

---

## 4. Source-of-truth artifacts

The realignment holds itself accountable to:

- **`left_panel.jsx`** (design bundle) at
  `C:\Users\antho\AppData\Local\Temp\nu-particle-editor\nuparticle-editor\project\left_panel.jsx`
  — authoritative for panel structure, row composition, toolbar position.
- **`styles.css`** (design bundle) at same directory — authoritative for
  `.panel`, `.tree-actions`, `.tabs`, `.row`, `.inspector` styling. Already
  imported into `web/apps/editor/src/styles/components.css` via Phase 1.
- **`tasks/lessons.md`** L-006 — sticky optimistic override pattern for
  per-row controls that round-trip through the bridge. The per-row eye
  inherits this pattern for the toggle's optimistic update.

---

## 5. Architecture

### 5.1 Top-level structure

The left column today:

```
<div className="panel w-80 shrink-0">
  <div className="panel-header">Particle System</div>
  <div className="panel-body flex flex-col">
    <aside className="flex-1 overflow-y-auto p-3">
      <EmitterTree />               <!-- contains the top toolbar internally -->
    </aside>
    <div className="h-72 border-t">  <!-- HARD BORDER + FIXED 288px -->
      <EmitterPropertyTabs />        <!-- contains tab strip + body -->
    </div>
  </div>
</div>
```

After B1:

```
<div className="panel w-80 shrink-0">
  <div className="panel-header">Particle System</div>
  <div className="panel-body flex flex-col">
    <div className="flex-1 min-h-0 overflow-y-auto">
      <EmitterTree />                <!-- toolbar now BELOW the <ul>, banded -->
    </div>
    <!-- NO border-t here. The tab strip in EmitterPropertyTabs is the
         visual transition. -->
    <div className="h-72 shrink-0">  <!-- still fixed-ish, but no hard divider -->
      <EmitterPropertyTabs />
    </div>
  </div>
</div>
```

The structural change is just: **delete the `border-t border-border`** on
the inspector wrapper. The dual-scroll behaviour stays. The fixed-height
inspector compartment stays (user preferred independent scroll).

The "feels like two panels" complaint resolves because (a) no hard divider
between regions and (b) the tab strip's intrinsic underline pattern at the
top of the inspector region creates a softer visual transition than a 1px
hairline border.

### 5.2 Tree row layout

Each tree row's grid changes from the current freeform flex layout to a
3-column CSS grid:

```
grid-template-columns: 12px 1fr 18px
                       │     │    └─ eye (always rightmost)
                       │     └────── name (flex, truncates with ellipsis)
                       └──────────── role glyph (●↻✕)
gap: 6px
```

The current layout uses `ml-auto` on the link-group dot to push it right.
That pattern is gone — the dot itself is gone. The eye is now the rightmost
column, always present, fixed width.

**Eye column-alignment is automatic** because every row has identical
column geometry. Whatever horizontal space the gutter consumes outside the
row is uniformly applied (the gutter is a sibling of the `<ul>`), so every
row's rightmost edge — and therefore every eye — sits at the same x-offset.

### 5.3 Per-row eye affordance

```tsx
// Inside EmitterRow component
<button
  type="button"
  data-testid={`emitter-vis-${node.id}`}
  className="grid place-items-center w-4 h-4 text-text-3 hover:text-text"
  onClick={(e) => {
    e.stopPropagation();  // prevent row-click selection from firing
    void bridge.request({
      kind: "emitters/set-visible",
      params: { id: node.id, visible: !node.visible },
    });
  }}
  title={node.visible ? "Hide emitter" : "Show emitter"}
  aria-label={node.visible ? "Hide emitter" : "Show emitter"}
>
  {node.visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
</button>
```

Notes:
- `Eye` / `EyeOff` icons already imported at
  [`EmitterTree.tsx:70`](../../web/apps/editor/src/screens/EmitterTree.tsx:70) for the
  toolbar — same icons, smaller size.
- `e.stopPropagation()` is load-bearing: the row's `onClick` selects the
  emitter; without it, toggling visibility also re-selects (annoying).
- Bridge response is fire-and-forget; the `emitters/tree/changed` event
  will arrive and re-render with the new `visible` value. No optimistic
  state needed because the change applies on a per-row property; the L-006
  pattern is overkill here.

### 5.4 Tree toolbar move + restyle

Today the toolbar renders before the `<ul>` and uses `mb-1 ... border-b`.
After B1 it renders after the `<ul>` and uses the design's `.tree-actions`
class:

```css
.tree-actions {
  display: flex;
  padding: 4px 8px;
  gap: 1px;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}
```

Result: the toolbar visually caps the tree from below, with a thin hairline
separating it from the tree above AND from the tabs below. Already present
in `web/apps/editor/src/styles/components.css` from Phase 1's import — no
new CSS needed.

The eye toggle button (currently between Move Down and Show All) drops out
of the toolbar. Show All / Hide All stay. New button order:

```
[New ▾] [Delete] [▲] [▼] | [Show All] [Hide All]
```

### 5.5 Multi-lane gutter — algorithm

**Type extension** (in `link-group-colors.ts`):

```ts
export type LinkGroupBracket = {
  groupId: number;
  color: string;
  firstRowIndex: number;
  lastRowIndex: number;
  lane: number;        // NEW — 0-based lane index assigned by packLanes
};
```

**`computeLinkGroupBrackets` changes**:

```ts
export function computeLinkGroupBrackets<T extends { linkGroup: number }>(
  rows: ReadonlyArray<T>,
): LinkGroupBracket[] {
  // 1. Collect ranges as before, BUT also track membership count per group.
  const ranges = new Map<number, { first: number; last: number; count: number }>();
  rows.forEach((row, idx) => {
    const g = row.linkGroup;
    if (g <= 0) return;
    const existing = ranges.get(g);
    if (existing === undefined) {
      ranges.set(g, { first: idx, last: idx, count: 1 });
    } else {
      existing.last = idx;
      existing.count += 1;
    }
  });

  // 2. Build descriptors for groups with COUNT >= 2 only. Single-member
  //    groups never render (B1 invariant — see § 5.6).
  const descriptors: Omit<LinkGroupBracket, "lane">[] = [];
  ranges.forEach((range, groupId) => {
    if (range.count < 2) return;
    const color = colorForGroup(groupId);
    if (color === null) return;
    descriptors.push({
      groupId,
      color,
      firstRowIndex: range.first,
      lastRowIndex: range.last,
    });
  });

  // 3. Assign lanes via greedy first-fit (aggressive reuse).
  const sorted = [...descriptors].sort(
    (a, b) =>
      a.firstRowIndex - b.firstRowIndex ||
      a.lastRowIndex  - b.lastRowIndex,
  );
  const laneLastEnd: number[] = [];
  const out: LinkGroupBracket[] = sorted.map((d) => {
    let lane = -1;
    for (let i = 0; i < laneLastEnd.length; i++) {
      if (laneLastEnd[i] < d.firstRowIndex) {
        lane = i;
        break;
      }
    }
    if (lane === -1) {
      lane = laneLastEnd.length;
      laneLastEnd.push(d.lastRowIndex);
    } else {
      laneLastEnd[lane] = d.lastRowIndex;
    }
    return { ...d, lane };
  });

  // 4. Stable sort by groupId so two renders with the same input produce
  //    the same draw order (matches existing behaviour).
  out.sort((a, b) => a.groupId - b.groupId);
  return out;
}
```

**Lane count export** (new export):

```ts
/** Returns the number of lanes needed to render the given brackets. */
export function laneCount(brackets: ReadonlyArray<LinkGroupBracket>): number {
  let max = 0;
  brackets.forEach((b) => { if (b.lane >= max) max = b.lane + 1; });
  return max;
}
```

**Gutter renderer** in `EmitterTree.tsx`:

```tsx
const LANE_WIDTH_PX = 10;        // 2px bracket + 8px gap to next lane
const GUTTER_LEFT_PAD_PX = 4;    // margin from the row's right edge
const GUTTER_MIN_PX = 4;         // when no groups exist (constant minimum)

const lanes = laneCount(brackets);
const gutterPx = lanes === 0
  ? GUTTER_MIN_PX
  : lanes * LANE_WIDTH_PX + GUTTER_LEFT_PAD_PX;

// ...

<ul style={{ marginRight: gutterPx }}>
  {/* rows */}
</ul>
<div className="pointer-events-none relative shrink-0"
     style={{ width: gutterPx }}>
  {brackets.map((b) => (
    <div
      key={b.groupId}
      data-testid={`link-group-bracket-${b.groupId}`}
      data-link-group={b.groupId}
      data-lane={b.lane}
      className="absolute"
      style={{
        top: b.firstRowIndex * ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2,
        left: GUTTER_LEFT_PAD_PX + b.lane * LANE_WIDTH_PX,
        width: 2,
        height: (b.lastRowIndex - b.firstRowIndex) * ROW_HEIGHT_PX,
        background: b.color,
      }}
    >
      <div className="absolute" style={{ top: 0,    left: -2, width: 6, height: 2, background: b.color }} />
      <div className="absolute" style={{ bottom: 0, left: -2, width: 6, height: 2, background: b.color }} />
    </div>
  ))}
</div>
```

Notes:
- The bracket's `left` offset is computed per-bracket from its assigned
  lane. The gutter's outer width is computed once.
- The single-row-cap special case (`Math.max(1, ...)` for height in the
  current renderer) goes away — every bracket has at least 2 rows of span,
  so `(lastRowIndex - firstRowIndex)` is always ≥ 1 row of height.
- The `data-lane` attribute on each rendered bracket makes lane-assignment
  test assertions straightforward.
- `GUTTER_MIN_PX = 4` is a deliberate choice: when no link groups exist,
  the gutter stays at 4px to prevent layout-shift when the first group
  appears mid-session. The 4px of "empty" space is below visual-noise
  threshold (one CSS pixel of margin is invisible against a uniform panel
  background).

### 5.6 Single-member group filter — rationale

The user's invariant ("never a single-member link group") is enforced at
the **render layer only** in B1:

- `computeLinkGroupBrackets` skips groups with `count < 2`.
- The gutter therefore never renders a stub.
- Bracket-rendering code can assume `firstRowIndex < lastRowIndex` strictly.

The data layer can still carry orphan groups. If the user opens an emitter
in the Inspector and reads its "Link Group" field, the value may be `5`
even though no bracket renders for group 5. This is a known inconsistency
that the engine-side enforcement roadmap item resolves.

For B1 specifically, the inconsistency is **acceptable** because:
- The Inspector field is rarely consulted; users rely on the gutter for
  link-group recognition.
- Filing the engine work as a roadmap item preserves the discovery so the
  user-driven correction (e.g., "I see Link Group 5 on this emitter but
  no bracket") becomes actionable.

If the user prefers immediate enforcement, B1 can promote it from roadmap
to in-scope — adds ~30 lines of C++ + tests across three mutation points.
Captured here so the cost-benefit tradeoff is explicit.

---

## 6. Component impact

Files modified by B1 (in expected commit order):

| File | Change |
|---|---|
| `web/apps/editor/src/lib/link-group-colors.ts` | Extend `LinkGroupBracket` with `lane`. Update `computeLinkGroupBrackets`: skip single-member groups, add greedy first-fit lane assignment. Add `laneCount` helper. |
| `web/apps/editor/src/lib/link-group-colors.test.ts` | Add specs: single-member filter (groups with count=1 not in result), 1-lane sparse case, 2-lane interleave case, 3-lane busy case, lane reuse case (lane 1 freed by row N, reused by next non-overlapping bracket). |
| `web/apps/editor/src/screens/EmitterTree.tsx` | Convert each row to the 3-column grid. Add per-row 👁 button. Remove per-row link-group dot. Move `EmitterTreeToolbar` from before `<ul>` to after, restyle to use `.tree-actions`. Drop eye-toggle button from toolbar. Update gutter renderer to read `lane` + width formula. |
| `web/apps/editor/src/screens/EmitterTree.test.tsx` | Update existing specs that referenced the per-row dot. Add: per-row eye toggle dispatch, eye column-alignment under varied data states, toolbar position assertion. |
| `web/apps/editor/src/App.tsx` | Remove `border-t border-border` from the inspector wrapper div. (1-line change.) |

No bridge schema changes. No C++ changes. No new Playwright specs strictly
required, but a small contract spec for the per-row eye toggle is worth
adding (mirrors existing `emitters/set-visible` toolbar spec).

---

## 7. Bridge / mock / test impact

### 7.1 Bridge surface

No new request kinds. No DTO changes. The `emitters/set-visible` request
already exists; per-row eye reuses it.

### 7.2 MockBridge

No changes.

### 7.3 Test deltas (estimated)

| Suite | Today | Touch | New | Rough end-state |
|---|---|---|---|---|
| Vitest | 219 | ~6-10 (existing dot specs need update, toolbar-position-assertion needs rewrite) | +6-8 (multi-lane packing specs, per-row eye, single-member filter, gutter-width formula) | ~225 |
| Playwright | 83 | 0 | +1 optional (per-row eye round-trip) | 83-84 |

---

## 8. Risks + mitigations

1. **Lane-assignment instability under common reorder operations.**
   Aggressive reuse can shift a group's lane index when surrounding groups
   change. E.g., Group A at rows 2–6 (lane 0), Group B at row 4 (stub
   filtered out — count=1 hypothetical), Group C at rows 8–10. Adding a
   new bracket between A and C may push C from lane 0 to lane 1.
   *Mitigation:* the bracket's *colour* and *vertical position* are
   stable; only the horizontal offset moves. Source-of-truth for membership
   is the bracket itself, not its lane. Documented in code comment near
   `packLanes`. If daily use turns this into a real annoyance, the
   stability-by-group-id variant is a one-export-flip away.

2. **Single-member groups carried in data but not rendered.**
   Inspector field shows "Link Group: N" for an emitter whose group has
   no bracket. *Mitigation:* documented in § 5.6 + filed as a roadmap
   item. Render-layer filter is the cheap fix; engine enforcement is the
   real fix. The roadmap entry is the breadcrumb so we don't forget.

3. **`e.stopPropagation` on the per-row eye click missed.**
   Without it, toggling visibility also re-selects the emitter — confusing
   double-action. *Mitigation:* documented in § 5.3 with a comment in the
   handler. Test asserts that the row's `onClick` does NOT fire when the
   eye is clicked (verified via selection-state inspection post-click).

4. **Removing `border-t` makes the inspector region "float."**
   The visual transition becomes the tab strip's underline alone, which
   might be too subtle in some themes. *Mitigation:* Phase 1's tokens
   define `--border` consistently across dark + light themes; the tab
   strip's `border-bottom: 1px solid var(--border)` is the same hairline
   as the removed `border-t` — net visual hairline count stays at one,
   just attached to the tabs instead of free-floating between the regions.
   Light-theme spot-check is part of the verification checklist.

5. **Eye column shifts mid-session as gutter width changes.**
   When the user joins/leaves a link group, the lane count may change,
   shifting all eyes left/right by 10px. *Mitigation:* this is the
   designed behaviour (the user's alignment principle) — eyes shift in
   unison and stay column-aligned with each other. The shift is intentional;
   what's avoided is *eyes shifting differently row-by-row* (the bug
   today).

6. **Performance of `packLanes` on long trees.**
   The algorithm is O(N×L) where N = bracket count and L = lane count.
   For realistic trees (≤100 emitters, ≤10 groups), this is microseconds
   per render. *Mitigation:* `useMemo` the brackets computation by
   `flatRows` reference identity (already done today). No O(N²) trap.

7. **`emitters/tree/changed` re-fetches the tree on every visibility
   toggle.**
   Today's per-toolbar eye toggle already fires this; per-row eyes do the
   same. The tree DTO is small (≤100 rows) and the round-trip is sub-ms,
   so the re-render is cheap. *Mitigation:* none needed — same shape as
   existing behaviour.

8. **`tasks/lt4_phase_4_1_acceptance.md` parity baseline drift.**
   The acceptance checklist freezes legacy `--legacy-ui` parity. The
   redesigned new-UI path naturally drifts further from legacy with each
   dispatch. *Mitigation:* B1 doesn't touch `--legacy-ui` at all. The
   parity checklist remains valid for what it covers (legacy mode).

---

## 9. Testing & verification

### 9.1 Vitest

- **`link-group-colors.test.ts` additions:**
  - [ ] Single-member group with `linkGroup === 5`, count = 1 → not in result.
  - [ ] One multi-row group at rows 0–2 → lane 0.
  - [ ] Two non-overlapping groups (rows 0–2, rows 5–7) → both lane 0.
  - [ ] Two overlapping groups (rows 0–4, rows 2–6) → lanes 0, 1.
  - [ ] Three groups with reuse (A rows 0–3, B rows 1–4, C rows 5–7) → lanes 0, 1, 0.
  - [ ] Lane assignment stable under input shuffling (sort first, assign
        deterministically — two identical inputs produce identical lanes).
  - [ ] `laneCount` returns 0 for empty input, returns max+1 for a 3-lane
        bracket set.

- **`EmitterTree.test.tsx` updates:**
  - [ ] Per-row eye is rendered on every row (count assertion).
  - [ ] Click on per-row eye dispatches `emitters/set-visible` with the
        row's id + flipped `visible`.
  - [ ] Click on per-row eye does NOT change selection (row's `onClick`
        guarded by `stopPropagation`).
  - [ ] Tree toolbar is now rendered AFTER the `<ul>` (DOM order assertion).
  - [ ] Tree toolbar has no eye-toggle button (eye exists per-row now).
  - [ ] Single-member group → no bracket rendered.
  - [ ] Multi-row group → bracket rendered with `data-lane` attribute.
  - [ ] Interleaved groups → lane assignments match expected.
  - [ ] Gutter width formula: `gutterPx === 4` when no groups; `4 + N*10`
        when N lanes.

### 9.2 Playwright (optional)

- [ ] Click per-row eye via test-host bridge, observe
      `emitters/set-visible` round-trip, verify `engine/state/changed`
      reflects the new visibility.

### 9.3 Manual smoke (Claude computer-use)

- [ ] Launch `x64/Debug/ParticleEditor.exe --new-ui`.
- [ ] Verify left pane visually matches design source's column rhythm.
- [ ] Toggle visibility on three emitters via per-row eye; confirm visible
      / hidden state in the viewport.
- [ ] Create a link group of 2 emitters via "Set Link Group…" context-menu;
      confirm bracket renders.
- [ ] Remove one member from the 2-member group; confirm bracket disappears
      (group becomes single-member, filtered out).
- [ ] Create a deliberately-interleaved scenario (2 nested 2-member groups);
      confirm multi-lane gutter expands.
- [ ] Toggle theme to light; repeat the above; confirm visual consistency.
- [ ] Toggle theme back to dark; close + reopen the editor; confirm theme
      persists.

### 9.4 Legacy regression

- [ ] Launch with `--legacy-ui` (or no flag); confirm legacy left pane
      unchanged.

### 9.5 Verification gates (all must pass before commit)

1. `pnpm build` clean (0 TS errors).
2. `pnpm test` (Vitest) ~225 / ~225.
3. `pnpm test:native` (Playwright) 83 / 83 (84 if optional spec added).
4. MSBuild Debug x64 clean.
5. Light + dark theme visual spot-check by Claude via computer-use.

---

## 10. Open items at spec-write time

None remaining. All brainstorming decisions are baked in:

- Drop the per-row link-group dot. ✓ (User: "let's drop the dot symbol")
- Aggressive lane reuse. ✓ (User: "let's do aggressive reuse")
- Single-member groups filtered at render (engine enforcement = roadmap). ✓ (User: Approach 3)
- Independent scroll for tree vs inspector. ✓ (User: "Independent scroll — keep dual")
- No header actions, no search bar. ✓ (User: "i do not care about the +, folder, and trash icons in the header" + "i don't care about the searchbar")
- No lock / swatch / kind / sticky tabs. ✓ (User: "Drop all three")

---

## 11. Definition of "done" for B1

- All files in § 6 modified.
- All Vitest specs in § 9.1 added or updated and passing.
- All verification gates in § 9.5 pass.
- One CHANGELOG entry covering: what shipped, how we tackled it
  (multi-lane via greedy first-fit, single-member filter), issues
  encountered + resolutions.
- HANDOFF.md refreshed.
- ROADMAP.md gains two entries: engine-side single-member-group
  enforcement (NT-? or MT-? to be assigned at entry time), and
  visual-stability lane assignment as an option.
- Commit on session branch, fast-forward into `lt-4`, push to
  `origin/lt-4` with explicit user OK.

---
