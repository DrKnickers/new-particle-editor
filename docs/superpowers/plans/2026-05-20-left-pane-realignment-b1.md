# Left-pane realignment (B1) implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Realign the left pane against the design source's structural intent — restructured tree rows, per-row visibility eye, multi-lane bracket gutter via greedy first-fit, single-member groups filtered at render time, hard divider between tree + inspector removed.

**Architecture:** Two-layer change. Layer 1: `link-group-colors.ts` gains a `lane` field on `LinkGroupBracket` plus a greedy first-fit lane-assignment pass; single-member groups are filtered. Layer 2: `EmitterTree.tsx` consumes those changes (row layout becomes a 3-column CSS grid, per-row eye button added, toolbar moves below the `<ul>` and gets restyled to `.tree-actions`, gutter renderer reads `lane` + computes dynamic width). `App.tsx` drops a single `border-t` className to soften the tree↔inspector visual transition.

**Tech Stack:** TypeScript + React 18 + Vitest + @testing-library/react for the test surface; Tailwind v4 + design tokens via `components.css` for visuals; existing bridge schema unchanged.

**Predecessor spec:** [docs/superpowers/specs/2026-05-20-left-pane-realignment-design.md](../specs/2026-05-20-left-pane-realignment-design.md)

**Target branch:** `lt-4`. FF from current session branch (`claude/<random>`) at the end. `--legacy-ui` path is untouched.

---

## File structure (responsibilities)

| File | Role in B1 | Status |
|---|---|---|
| `web/apps/editor/src/lib/link-group-colors.ts` | Bracket descriptor + lane assignment + single-member filter | Modify |
| `web/apps/editor/src/lib/__tests__/link-group-colors.test.ts` | Vitest specs for above | Modify (one existing spec broken by single-member filter; new specs added) |
| `web/apps/editor/src/screens/EmitterTree.tsx` | Tree row layout (3-col grid), per-row eye, toolbar position + style, gutter width formula | Modify |
| `web/apps/editor/src/screens/__tests__/EmitterTree.test.tsx` | Vitest specs for above | Modify |
| `web/apps/editor/src/App.tsx` | Drop one `border-t border-border` className | Modify (1 line) |
| `ROADMAP.md` | Add 2 follow-up entries | Modify |
| `CHANGELOG.md` | Add the B1 entry (partial backfill — hash + PR# stay TODO until master merge) | Modify |
| `tasks/HANDOFF.md` | Refresh: new test counts, B1 landed, B2 still pending | Modify |

No new files. No bridge schema changes. No C++ changes.

---

## Pre-flight check (do this once before Task 1)

- [ ] **Confirm starting state.** From the worktree root:

  ```
  git status
  git log --oneline lt-4..HEAD
  ```

  Expected: working tree clean. `lt-4..HEAD` shows two commits (`df1bba7` curve-editor polish + `160fffe` brainstorm spec). If the count differs, stop and reconcile — a clean session branch should be 2 commits ahead of `lt-4` after the spec commit.

- [ ] **Run baseline gates** to confirm green-starting-state:

  ```
  cd web/apps/editor
  pnpm install                                  # may re-inject allowBuilds (see L-005)
  pnpm build                                    # 0 errors
  pnpm test --reporter=basic                    # 219/219
  ```

  If any gate is red, stop and investigate before touching code.

- [ ] **C++ binary not required for B1.** B1 is React + bridge-consumer only. Skip MSBuild unless you want a parallel sanity check.

---

## Task 1: Filter single-member link groups in `computeLinkGroupBrackets`

**Why first:** Cheapest change with the smallest blast radius. It also fixes a latent assertion in the existing test file (the existing test at line 36 asserts a single-row group's bracket appears — that has to flip to "doesn't appear"). Land this before any consumer changes so the new invariant is in place.

**Files:**
- Modify: `web/apps/editor/src/lib/link-group-colors.ts` — `computeLinkGroupBrackets` body
- Test: `web/apps/editor/src/lib/__tests__/link-group-colors.test.ts` — existing spec at line 30 updated; new spec added

### Steps

- [ ] **Step 1: Update the existing test to reflect the new invariant.**

  Open `web/apps/editor/src/lib/__tests__/link-group-colors.test.ts`. Replace the entire body of the test starting at line 30 (`it("computeLinkGroupBrackets bounds each group's first + last row index in the flat list", ...)`) with the version below. The fixture changes: group 2 now has TWO rows (not one), so it stays in the result; a new single-row group 3 is added to verify the filter rejects it.

  ```ts
    it("computeLinkGroupBrackets bounds each group's first + last row index in the flat list", () => {
      const rows = [
        { linkGroup: 0 }, // 0  unlinked
        { linkGroup: 1 }, // 1  group 1 starts
        { linkGroup: 0 }, // 2  unlinked
        { linkGroup: 1 }, // 3  group 1 extends → 2-member group, KEPT
        { linkGroup: 2 }, // 4  group 2 starts
        { linkGroup: 2 }, // 5  group 2 extends → 2-member group, KEPT
        { linkGroup: 3 }, // 6  group 3, ONLY member → FILTERED OUT
        { linkGroup: 0 }, // 7  unlinked
      ];
      const brackets = computeLinkGroupBrackets(rows);
      expect(brackets).toHaveLength(2);  // group 3 absent
      const g1 = brackets.find((b) => b.groupId === 1)!;
      expect(g1.firstRowIndex).toBe(1);
      expect(g1.lastRowIndex).toBe(3);
      expect(g1.color).toBe(colorForGroup(1));
      const g2 = brackets.find((b) => b.groupId === 2)!;
      expect(g2.firstRowIndex).toBe(4);
      expect(g2.lastRowIndex).toBe(5);
      expect(g2.color).toBe(colorForGroup(2));
      expect(brackets.find((b) => b.groupId === 3)).toBeUndefined();
    });
  ```

- [ ] **Step 2: Add a focused spec for the filter.**

  Append this new spec inside the same `describe("link-group-colors", () => { ... })` block (just before the closing `});`):

  ```ts
    it("filters single-member groups — they never appear in the result", () => {
      const rows = [
        { linkGroup: 5 },  // only member of group 5
        { linkGroup: 0 },
        { linkGroup: 7 },  // only member of group 7
      ];
      const brackets = computeLinkGroupBrackets(rows);
      expect(brackets).toHaveLength(0);
    });
  ```

- [ ] **Step 3: Run both updated specs — expect failure.**

  ```
  cd web/apps/editor
  pnpm vitest run src/lib/__tests__/link-group-colors.test.ts --reporter=basic
  ```

  Expected: FAIL. The first spec fails because today's implementation includes the single-row group 2; the new spec fails because today's implementation also includes single-row groups 5 and 7.

- [ ] **Step 4: Add the filter to `computeLinkGroupBrackets`.**

  Open `web/apps/editor/src/lib/link-group-colors.ts`. Replace the body of `computeLinkGroupBrackets` (currently lines 51–83) with this version. The change: the inner `ranges` Map now tracks `count`, and the final emit loop skips groups with `count < 2`.

  ```ts
  export function computeLinkGroupBrackets<T extends { linkGroup: number }>(
    rows: ReadonlyArray<T>,
  ): LinkGroupBracket[] {
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
    const out: LinkGroupBracket[] = [];
    ranges.forEach((range, groupId) => {
      // B1 invariant: never render single-member groups. Bracket renderer
      // can safely assume firstRowIndex < lastRowIndex throughout.
      if (range.count < 2) return;
      const color = colorForGroup(groupId);
      if (color === null) return;
      out.push({
        groupId,
        color,
        firstRowIndex: range.first,
        lastRowIndex: range.last,
      });
    });
    // Stable ordering by groupId so two renders with the same input
    // produce the same draw order.
    out.sort((a, b) => a.groupId - b.groupId);
    return out;
  }
  ```

  Also update the docstring above the function (currently lines 39–43) to reflect the new behaviour:

  ```ts
  /** Walks a flattened tree row list and returns one bracket descriptor
   *  per unique non-zero `linkGroup` WITH AT LEAST 2 MEMBERS. Single-
   *  member groups are filtered out (B1 invariant — every rendered
   *  bracket spans ≥ 2 rows). `firstRowIndex` + `lastRowIndex` are
   *  0-based positions in `flatRows`. Single-lane (no overlap handling
   *  yet — see Task 2 for the lane assignment pass). */
  ```

- [ ] **Step 5: Re-run the same vitest command from Step 3 — expect pass.**

  Expected: PASS (2 specs in this file all green).

- [ ] **Step 6: Sanity-check the broader vitest suite is unaffected.**

  ```
  pnpm test --reporter=basic
  ```

  Expected: 220/220 (was 219 — we added one new spec). If any existing spec broke that wasn't anticipated, stop and investigate before commit.

- [ ] **Step 7: Commit.**

  ```bash
  git add web/apps/editor/src/lib/link-group-colors.ts \
          web/apps/editor/src/lib/__tests__/link-group-colors.test.ts
  git commit -m "$(cat <<'EOF'
  feat(LT-4): filter single-member link groups in computeLinkGroupBrackets

  Single-member groups never produce a meaningful bracket — they'd
  render as a single-row stub that the renderer treats as a special
  case. B1's spec invariant (no single-member groups visible in the
  tree) is enforced at the render layer: `computeLinkGroupBrackets`
  skips groups with `count < 2` so the gutter renderer can assume
  `firstRowIndex < lastRowIndex` for every bracket it sees.

  Data layer can still carry single-member groups; engine-side
  enforcement of the invariant is a separate ROADMAP follow-up.

  Test count: 219 → 220 (one new focused spec; existing fixture
  rewritten to include a second member for group 2).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 2: Add `lane` field + greedy first-fit lane assignment

**Why second:** Now that the bracket set is filtered, the lane-assignment pass operates on the same descriptors. Tests can use a known-good filtered set as input.

**Files:**
- Modify: `web/apps/editor/src/lib/link-group-colors.ts` — extend `LinkGroupBracket` type, add lane pass inside `computeLinkGroupBrackets`
- Test: `web/apps/editor/src/lib/__tests__/link-group-colors.test.ts` — new specs for lane assignment

### Steps

- [ ] **Step 1: Add failing specs for lane assignment.**

  Append these to the same `describe("link-group-colors", () => { ... })` block in `link-group-colors.test.ts`:

  ```ts
    it("assigns lane 0 to a single group", () => {
      const rows = [
        { linkGroup: 0 },
        { linkGroup: 1 }, // row 1
        { linkGroup: 1 }, // row 2
        { linkGroup: 0 },
      ];
      const brackets = computeLinkGroupBrackets(rows);
      expect(brackets).toHaveLength(1);
      expect(brackets[0].lane).toBe(0);
    });

    it("assigns lane 0 to non-overlapping groups (reuse)", () => {
      const rows = [
        { linkGroup: 1 }, { linkGroup: 1 }, // group 1: rows 0-1
        { linkGroup: 0 },
        { linkGroup: 2 }, { linkGroup: 2 }, // group 2: rows 3-4 (no overlap with g1)
        { linkGroup: 0 },
        { linkGroup: 3 }, { linkGroup: 3 }, // group 3: rows 6-7 (no overlap)
      ];
      const brackets = computeLinkGroupBrackets(rows);
      expect(brackets).toHaveLength(3);
      // All three pack into lane 0 because none overlap each other vertically.
      expect(brackets.find((b) => b.groupId === 1)!.lane).toBe(0);
      expect(brackets.find((b) => b.groupId === 2)!.lane).toBe(0);
      expect(brackets.find((b) => b.groupId === 3)!.lane).toBe(0);
    });

    it("assigns lanes 0 and 1 to two overlapping groups", () => {
      const rows = [
        { linkGroup: 1 }, // group 1 starts at row 0
        { linkGroup: 2 }, // group 2 starts at row 1
        { linkGroup: 1 }, // group 1 extends to row 2
        { linkGroup: 2 }, // group 2 extends to row 3
      ];
      const brackets = computeLinkGroupBrackets(rows);
      expect(brackets).toHaveLength(2);
      const g1 = brackets.find((b) => b.groupId === 1)!;
      const g2 = brackets.find((b) => b.groupId === 2)!;
      expect(g1.lane).toBe(0);  // first by firstRowIndex → claims lane 0
      expect(g2.lane).toBe(1);  // overlaps g1 → next lane
    });

    it("reuses lane 0 after a long bracket ends (busy interleave case)", () => {
      // Sky:    rows 0-5 (long, lane 0)
      // Pink:   rows 2-3 (stub-ish in middle, lane 1)
      // Yellow: rows 7-8 (after sky ends, lane 0 reused)
      const rows = [
        { linkGroup: 1 }, // 0 sky
        { linkGroup: 1 }, // 1 sky
        { linkGroup: 2 }, // 2 pink
        { linkGroup: 2 }, // 3 pink
        { linkGroup: 1 }, // 4 sky
        { linkGroup: 1 }, // 5 sky
        { linkGroup: 0 }, // 6 gap
        { linkGroup: 3 }, // 7 yellow
        { linkGroup: 3 }, // 8 yellow
      ];
      const brackets = computeLinkGroupBrackets(rows);
      expect(brackets).toHaveLength(3);
      expect(brackets.find((b) => b.groupId === 1)!.lane).toBe(0);
      expect(brackets.find((b) => b.groupId === 2)!.lane).toBe(1);
      expect(brackets.find((b) => b.groupId === 3)!.lane).toBe(0);  // reused
    });
  ```

- [ ] **Step 2: Run the new specs — expect failure.**

  ```
  cd web/apps/editor
  pnpm vitest run src/lib/__tests__/link-group-colors.test.ts --reporter=basic
  ```

  Expected: FAIL. All 4 new specs fail because `lane` field doesn't exist on the type, so the assertions read `undefined`.

- [ ] **Step 3: Extend the `LinkGroupBracket` type.**

  Open `web/apps/editor/src/lib/link-group-colors.ts`. Update the type at line 44 to add the `lane` field:

  ```ts
  /** A bracket descriptor produced by `computeLinkGroupBrackets`.
   *  `lane` is 0-based and assigned by the greedy first-fit pass at
   *  the end of that function — bracket renderers use `lane` to
   *  compute the horizontal offset within the gutter. */
  export type LinkGroupBracket = {
    groupId: number;
    color: string;
    firstRowIndex: number;
    lastRowIndex: number;
    lane: number;
  };
  ```

- [ ] **Step 4: Add the lane-assignment pass.**

  Replace the body of `computeLinkGroupBrackets` (from Task 1) with this expanded version. The change: a third pass walks the emitted descriptors in sorted-by-first order and assigns lanes via greedy first-fit (aggressive reuse). Output then re-sorts by `groupId` for stable draw order.

  ```ts
  export function computeLinkGroupBrackets<T extends { linkGroup: number }>(
    rows: ReadonlyArray<T>,
  ): LinkGroupBracket[] {
    // Pass 1: collect ranges + member counts per group.
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

    // Pass 2: emit descriptors for groups with ≥ 2 members.
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

    // Pass 3: greedy first-fit lane assignment (aggressive reuse).
    // Sort by firstRowIndex (ties broken by lastRowIndex) so earlier-
    // starting brackets claim lanes first. `laneLastEnd[i]` tracks the
    // lastRowIndex of the most recent bracket assigned to lane i.
    const sorted = [...descriptors].sort(
      (a, b) =>
        a.firstRowIndex - b.firstRowIndex ||
        a.lastRowIndex  - b.lastRowIndex,
    );
    const laneLastEnd: number[] = [];
    const withLanes: LinkGroupBracket[] = sorted.map((d) => {
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

    // Stable ordering by groupId so two renders with the same input
    // produce the same draw order (lane assignments still match —
    // they're attached to each bracket descriptor).
    withLanes.sort((a, b) => a.groupId - b.groupId);
    return withLanes;
  }
  ```

- [ ] **Step 5: Re-run the vitest command from Step 2 — expect pass.**

  Expected: PASS. All 4 new lane specs + the existing 2 specs all green (6 total in this file).

- [ ] **Step 6: Sanity-check the broader vitest suite is unaffected.**

  ```
  pnpm test --reporter=basic
  ```

  Expected: 224/224 (220 from Task 1 + 4 new). If anything else broke, the most likely culprit is a consumer that was relying on `LinkGroupBracket` not having a `lane` field — search for `LinkGroupBracket` callers and check whether they use type-spreading patterns that might mismatch.

- [ ] **Step 7: Commit.**

  ```bash
  git add web/apps/editor/src/lib/link-group-colors.ts \
          web/apps/editor/src/lib/__tests__/link-group-colors.test.ts
  git commit -m "$(cat <<'EOF'
  feat(LT-4): multi-lane bracket gutter via greedy first-fit lane assignment

  Extends `LinkGroupBracket` with a `lane: number` field and adds a
  third pass to `computeLinkGroupBrackets` that assigns lanes via
  aggressive-reuse greedy first-fit:

    1. Sort brackets by firstRowIndex (ties by lastRowIndex).
    2. For each bracket, find the lowest lane whose `lastEnd` is
       strictly less than the bracket's `firstRowIndex` — that lane
       is free for the bracket's range. If none free, push a new
       lane.
    3. Record the bracket's lastRowIndex against the chosen lane.

  Result: the gutter widens only when groups interleave. Common
  sparse trees keep all brackets in lane 0. The bracket renderer
  (Task 4) reads `lane` to compute horizontal offset.

  Output is re-sorted by groupId before return so draw order stays
  stable. Lane assignments stay attached to their bracket
  descriptors — no cross-reference needed.

  Test count: 220 → 224 (+4 new specs covering: single group → lane
  0; non-overlapping reuse; two overlapping → lanes 0+1; busy
  interleave with reuse after a long bracket ends).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 3: Add `laneCount` helper export

**Why third:** The gutter renderer in Task 4 needs to know how many lanes are in use to size the gutter container. Extract it as a tiny pure helper so the renderer doesn't reduce manually inline.

**Files:**
- Modify: `web/apps/editor/src/lib/link-group-colors.ts` — append `laneCount` export
- Test: `web/apps/editor/src/lib/__tests__/link-group-colors.test.ts` — new specs

### Steps

- [ ] **Step 1: Add failing specs.**

  Append to the same `describe` block:

  ```ts
    it("laneCount returns 0 for an empty bracket array", () => {
      expect(laneCount([])).toBe(0);
    });

    it("laneCount returns 1 for a single-lane bracket set", () => {
      const rows = [
        { linkGroup: 1 }, { linkGroup: 1 },
        { linkGroup: 0 },
        { linkGroup: 2 }, { linkGroup: 2 },
      ];
      expect(laneCount(computeLinkGroupBrackets(rows))).toBe(1);
    });

    it("laneCount returns 3 for a 3-lane bracket set", () => {
      // Build a bracket array directly with known lanes.
      const brackets: LinkGroupBracket[] = [
        { groupId: 1, color: "#000", firstRowIndex: 0, lastRowIndex: 5, lane: 0 },
        { groupId: 2, color: "#000", firstRowIndex: 1, lastRowIndex: 4, lane: 1 },
        { groupId: 3, color: "#000", firstRowIndex: 2, lastRowIndex: 3, lane: 2 },
      ];
      expect(laneCount(brackets)).toBe(3);
    });
  ```

  At the top of the file, update the import statement to include `laneCount` and `LinkGroupBracket`:

  ```ts
  import {
    BRACKET_PALETTE_SIZE,
    colorForGroup,
    computeLinkGroupBrackets,
    laneCount,
    type LinkGroupBracket,
  } from "../link-group-colors";
  ```

- [ ] **Step 2: Run — expect failure.**

  ```
  pnpm vitest run src/lib/__tests__/link-group-colors.test.ts --reporter=basic
  ```

  Expected: FAIL. The three new specs fail because `laneCount` is not exported.

- [ ] **Step 3: Add the helper.**

  Append to `web/apps/editor/src/lib/link-group-colors.ts` (after the existing `computeLinkGroupBrackets`):

  ```ts
  /** Number of lanes used by the given bracket set. The gutter
   *  renderer multiplies this by `LANE_WIDTH_PX` (+ a small left pad)
   *  to size its container. Returns 0 for an empty set so the
   *  renderer can collapse the gutter to its minimum width. */
  export function laneCount(brackets: ReadonlyArray<LinkGroupBracket>): number {
    let max = 0;
    brackets.forEach((b) => {
      if (b.lane >= max) max = b.lane + 1;
    });
    return max;
  }
  ```

- [ ] **Step 4: Re-run — expect pass.**

  Expected: PASS. All 9 specs in the file green.

- [ ] **Step 5: Sanity check + commit.**

  ```
  pnpm test --reporter=basic
  ```

  Expected: 227/227.

  ```bash
  git add web/apps/editor/src/lib/link-group-colors.ts \
          web/apps/editor/src/lib/__tests__/link-group-colors.test.ts
  git commit -m "$(cat <<'EOF'
  feat(LT-4): add laneCount helper for gutter width derivation

  Returns the highest assigned lane index + 1, or 0 for an empty
  bracket set. The gutter renderer uses this to compute its
  container width:

      gutterPx = max(GUTTER_MIN_PX, laneCount * LANE_WIDTH_PX + LEFT_PAD)

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 4: Update the gutter renderer in `EmitterTree.tsx`

**Why fourth:** Layer 2 begins. Consume the new `lane` field + `laneCount` to render the multi-lane gutter. The bracket-rendering math changes; the rest of the tree still uses the old row structure (those changes come in Tasks 5–7).

**Files:**
- Modify: `web/apps/editor/src/screens/EmitterTree.tsx` — gutter constants + width derivation + bracket positioning by lane
- Test: `web/apps/editor/src/screens/__tests__/EmitterTree.test.tsx` — new specs asserting `data-lane` + computed gutter width

### Steps

- [ ] **Step 1: Add a failing test for the gutter width formula.**

  Open `EmitterTree.test.tsx`. Add a new test inside `describe("EmitterTree", () => { ... })`:

  ```tsx
    it("gutter container width tracks the number of lanes in use", async () => {
      const bridge = makeStubBridge();
      render(<EmitterTree bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByText("Smoke")).toBeInTheDocument();
      });

      // The fixture tree puts Smoke (id 0) and Sparks (id 3) both in
      // link group 1. That's a single 2-lane bracket. laneCount = 1
      // → gutterPx = 1 * 10 + 4 = 14.
      const gutter = screen.getByTestId("link-group-bracket-gutter");
      expect(gutter).toBeInTheDocument();
      expect((gutter as HTMLElement).style.width).toBe("14px");
    });
  ```

  Also update the existing import block at line 7 if needed (the existing `import` block already brings in `render, screen, fireEvent, waitFor, createEvent` — no change needed).

- [ ] **Step 2: Add a failing test for `data-lane` on rendered brackets.**

  ```tsx
    it("rendered brackets carry a data-lane attribute matching their assigned lane", async () => {
      const bridge = makeStubBridge();
      render(<EmitterTree bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByText("Smoke")).toBeInTheDocument();
      });

      // Group 1 spans Smoke (row 0) → Sparks (row 3). Only one group
      // visible in the fixture → lane 0.
      const bracket = screen.getByTestId("link-group-bracket-1");
      expect(bracket).toHaveAttribute("data-lane", "0");
    });
  ```

- [ ] **Step 3: Run — expect failure.**

  ```
  cd web/apps/editor
  pnpm vitest run src/screens/__tests__/EmitterTree.test.tsx --reporter=basic
  ```

  Expected: FAIL. The gutter width spec fails because today's gutter is a fixed 16px. The data-lane spec fails because the bracket element doesn't currently set `data-lane`.

- [ ] **Step 4: Update gutter constants + width formula + bracket rendering in `EmitterTree.tsx`.**

  Open `web/apps/editor/src/screens/EmitterTree.tsx`. Locate the constants block around line 772 (`const ROW_HEIGHT_PX = 24; const GUTTER_WIDTH_PX = 16;`).

  Replace those two lines with:

  ```tsx
  const ROW_HEIGHT_PX     = 24;
  const LANE_WIDTH_PX     = 10;  // 2px bracket + 8px gap to next lane
  const GUTTER_LEFT_PAD_PX = 4;
  const GUTTER_MIN_PX     = 4;   // when no link groups exist (constant minimum to avoid layout shift)
  ```

  Then add the `laneCount` import (the top-of-file import statement currently imports from `link-group-colors`):

  ```tsx
  // Around the existing import that brings in computeLinkGroupBrackets
  import { computeLinkGroupBrackets, laneCount } from "@/lib/link-group-colors";
  ```

  (If that import currently lives elsewhere or has a different alias, follow the existing pattern — the file already references `computeLinkGroupBrackets` from `@/lib/link-group-colors`.)

  Locate the JSX block that renders the gutter (around lines 1311–1404 inside the `EmitterTree` component's return). Replace the `<ul style={{ marginRight: GUTTER_WIDTH_PX }}>` and the subsequent gutter `<div>` with the dynamic version below. The key changes: `gutterPx` is computed from `laneCount(brackets)`; each bracket's `left` offset uses `b.lane`; each bracket div gets a `data-lane` attribute; the single-row-cap special case (`Math.max(1, ...)`) is removed (no single-row brackets after Task 1).

  ```tsx
        const lanes = laneCount(brackets);
        const gutterPx = lanes === 0
          ? GUTTER_MIN_PX
          : lanes * LANE_WIDTH_PX + GUTTER_LEFT_PAD_PX;

        // ... inside the JSX return:
        <div className="relative flex">
          <ul
            role="tree"
            aria-label="Emitters"
            className="m-0 flex-1 list-none p-0"
            style={{ marginRight: gutterPx }}
          >
            {flatRows.map((row) => ( /* unchanged row mapping — Tasks 5-7 will modify the row itself */ ))}
          </ul>
          <div
            data-testid="link-group-bracket-gutter"
            aria-hidden
            className="pointer-events-none relative shrink-0"
            style={{ width: gutterPx }}
          >
            {brackets.map((b) => {
              const top    = b.firstRowIndex * ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2;
              const height = (b.lastRowIndex - b.firstRowIndex) * ROW_HEIGHT_PX;
              const left   = GUTTER_LEFT_PAD_PX + b.lane * LANE_WIDTH_PX;
              return (
                <div
                  key={b.groupId}
                  data-testid={`link-group-bracket-${b.groupId}`}
                  data-link-group={b.groupId}
                  data-lane={b.lane}
                  className="absolute"
                  style={{
                    top,
                    left,
                    width: 2,
                    height,
                    background: b.color,
                  }}
                >
                  {/* Top cap */}
                  <div
                    aria-hidden
                    className="absolute"
                    style={{
                      top: 0,
                      left: -2,
                      width: 4,
                      height: 2,
                      background: b.color,
                    }}
                  />
                  {/* Bottom cap */}
                  <div
                    aria-hidden
                    className="absolute"
                    style={{
                      bottom: 0,
                      left: -2,
                      width: 4,
                      height: 2,
                      background: b.color,
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
  ```

  Note: the `{flatRows.map(...)}` body inside the `<ul>` is **unchanged in this task** — keep whatever the current file has. Tasks 5–7 will edit the per-row structure.

- [ ] **Step 5: Re-run the two failing specs — expect pass.**

  ```
  pnpm vitest run src/screens/__tests__/EmitterTree.test.tsx --reporter=basic
  ```

  Expected: PASS for both new specs. Existing specs in the file also pass — they assert tree row content + selection behaviour, not gutter geometry.

- [ ] **Step 6: Sanity check + commit.**

  ```
  pnpm build
  pnpm test --reporter=basic
  ```

  Expected: 0 TS errors. 229/229 (227 + 2 new).

  ```bash
  git add web/apps/editor/src/screens/EmitterTree.tsx \
          web/apps/editor/src/screens/__tests__/EmitterTree.test.tsx
  git commit -m "$(cat <<'EOF'
  feat(LT-4): render multi-lane bracket gutter in EmitterTree

  Consumes `lane` on each LinkGroupBracket plus the new `laneCount`
  helper to size the gutter container and position brackets within
  it. Each bracket's `left` offset is `GUTTER_LEFT_PAD_PX + lane *
  LANE_WIDTH_PX`. Gutter container `width` is
  `max(GUTTER_MIN_PX, laneCount * LANE_WIDTH_PX + LEFT_PAD)` so the
  gutter collapses to a 4px sliver when no link groups exist (avoids
  layout shift when the first group appears) and widens cleanly as
  lanes pile up under interleaving.

  Bracket renderer drops the single-row-cap special case
  (`Math.max(1, ...)`) — Task 1's filter guarantees every bracket
  spans ≥ 2 rows. Each rendered bracket also carries `data-lane` for
  test assertions.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 5: Add per-row visibility eye button

**Why fifth:** Independent of the row layout restructure in Task 6 — adding an `<button>` inside the existing row works with either the old flex layout or the new grid. Doing it before Task 6 keeps Task 6's diff cleaner (Task 6 just changes containers, not behavior).

**Files:**
- Modify: `web/apps/editor/src/screens/EmitterTree.tsx` — `EmitterRow` component
- Test: `web/apps/editor/src/screens/__tests__/EmitterTree.test.tsx` — new specs

### Steps

- [ ] **Step 1: Add failing specs.**

  Append to `EmitterTree.test.tsx`:

  ```tsx
    it("each row renders a per-row visibility eye button", async () => {
      const bridge = makeStubBridge();
      render(<EmitterTree bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByText("Smoke")).toBeInTheDocument();
      });

      // 6 emitter rows in the fixture → 6 eye buttons.
      expect(screen.getByTestId("emitter-vis-0")).toBeInTheDocument();  // Smoke
      expect(screen.getByTestId("emitter-vis-1")).toBeInTheDocument();  // Smoke embers
      expect(screen.getByTestId("emitter-vis-3")).toBeInTheDocument();  // Sparks
    });

    it("clicking the per-row eye dispatches emitters/set-visible with toggled state", async () => {
      const bridge = makeStubBridge();
      render(<EmitterTree bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByText("Smoke")).toBeInTheDocument();
      });

      // Smoke (id=0) is `visible: true` in the fixture → click should
      // dispatch { visible: false }.
      fireEvent.click(screen.getByTestId("emitter-vis-0"));

      const calls = (bridge.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
      const setVis = calls.find((c) => c.kind === "emitters/set-visible");
      expect(setVis).toBeDefined();
      expect(setVis!.params).toEqual({ id: 0, visible: false });
    });

    it("clicking the per-row eye does NOT change selection", async () => {
      const bridge = makeStubBridge();
      render(<EmitterTree bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByText("Smoke")).toBeInTheDocument();
      });

      // Before click: selection is empty (beforeEach clears the store).
      expect(useEmitterSelectionStore.getState().primary).toBeNull();

      fireEvent.click(screen.getByTestId("emitter-vis-1"));  // Smoke embers

      // Selection still empty — no emitters/select dispatched as a side effect.
      expect(useEmitterSelectionStore.getState().primary).toBeNull();
      const calls = (bridge.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
      expect(calls.find((c) => c.kind === "emitters/select")).toBeUndefined();
    });
  ```

- [ ] **Step 2: Run — expect failure.**

  ```
  pnpm vitest run src/screens/__tests__/EmitterTree.test.tsx --reporter=basic
  ```

  Expected: FAIL. The data-testid lookups fail because the buttons don't exist yet.

- [ ] **Step 3: Add the per-row eye to `EmitterRow`.**

  Open `EmitterTree.tsx`. Find the `EmitterRow` component (around line 214). Locate the inner JSX where the row currently renders its content (the `<button type="button" draggable ...>` block around line 573). Just inside that outer button, **after** the existing `{isLinked && ...}` block that renders the link-group dot (around line 676–682), but **before** the closing `</button>`, the link-group dot needs to go away in Task 6. For Task 5, only ADD the eye — don't touch the dot yet.

  Add this immediately before the closing `</button>` of the outer row button:

  ```tsx
            {!isEditing && (
              <button
                type="button"
                data-testid={`emitter-vis-${node.id}`}
                onClick={(e) => {
                  // stopPropagation is load-bearing: the outer row button's
                  // onClick selects the emitter. Without this, toggling
                  // visibility would also re-select the row — confusing.
                  e.stopPropagation();
                  void bridge.request({
                    kind: "emitters/set-visible",
                    params: { id: node.id, visible: !node.visible },
                  });
                }}
                title={node.visible ? "Hide emitter" : "Show emitter"}
                aria-label={node.visible ? "Hide emitter" : "Show emitter"}
                className="ml-auto grid place-items-center w-4 h-4 shrink-0 rounded text-text-3 hover:bg-panel-2 hover:text-text"
              >
                {node.visible
                  ? <Eye className="size-3" />
                  : <EyeOff className="size-3" />}
              </button>
            )}
  ```

  Notes:
  - `Eye` / `EyeOff` are already imported at the top of the file (line 70 — they're used by the toolbar).
  - `ml-auto` here is a transitional flex hint that works alongside the current row's flex layout. Task 6 replaces the row with a CSS grid and the `ml-auto` becomes irrelevant — leave it in for Task 5.
  - The link-group dot (`{isLinked && ...}` block above this insert) STAYS in this task; it will be removed in Task 6.

- [ ] **Step 4: Re-run the three specs from Step 1 — expect pass.**

  Expected: PASS.

- [ ] **Step 5: Sanity check + commit.**

  ```
  pnpm build
  pnpm test --reporter=basic
  ```

  Expected: 232/232. Build clean.

  ```bash
  git add web/apps/editor/src/screens/EmitterTree.tsx \
          web/apps/editor/src/screens/__tests__/EmitterTree.test.tsx
  git commit -m "$(cat <<'EOF'
  feat(LT-4): per-row visibility eye on each tree row

  Each EmitterRow now renders an Eye / EyeOff button to the right
  of the row content. Click dispatches `emitters/set-visible` with
  the toggled state. stopPropagation guards the row's onClick from
  re-selecting the row as a side effect.

  The toolbar's eye-toggle button is now redundant — it stays in
  this commit (next task drops it explicitly) and the two paths
  coexist until then.

  Test count: 229 → 232 (+3 specs covering existence, dispatch,
  selection-stability).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 6: Convert row to 3-column CSS grid and drop the per-row link-group dot

**Why sixth:** With the per-row eye in place and the gutter rendering only multi-row brackets, the row's link-group dot is redundant. Replacing the flex layout with a fixed 3-column grid also gives us automatic eye-column alignment.

**Files:**
- Modify: `web/apps/editor/src/screens/EmitterTree.tsx` — `EmitterRow` outer-button className + remove the link-group dot span
- Test: `web/apps/editor/src/screens/__tests__/EmitterTree.test.tsx` — new specs asserting the grid + dot removal

### Steps

- [ ] **Step 1: Add failing specs.**

  ```tsx
    it("per-row link-group dot is no longer rendered (gutter brackets are the only affordance)", async () => {
      const bridge = makeStubBridge();
      render(<EmitterTree bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByText("Smoke")).toBeInTheDocument();
      });

      // The legacy per-row dot used `aria-label="Link group N"`. No
      // element should match that pattern any more.
      const dots = screen.queryAllByLabelText(/^Link group \d+$/);
      expect(dots).toHaveLength(0);
    });

    it("row uses a 3-column CSS grid template (glyph / name / eye)", async () => {
      const bridge = makeStubBridge();
      render(<EmitterTree bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByText("Smoke")).toBeInTheDocument();
      });

      // Each row's outer button carries the grid template via class.
      // We check the rendered style.
      const rowButton = screen.getByText("Smoke").closest("button")!;
      expect(rowButton.style.gridTemplateColumns).toBe("12px 1fr 18px");
    });
  ```

- [ ] **Step 2: Run — expect failure.**

  ```
  pnpm vitest run src/screens/__tests__/EmitterTree.test.tsx --reporter=basic
  ```

  Expected: FAIL. Both specs fail — dots are still there; row is still flex.

- [ ] **Step 3: Remove the link-group dot from `EmitterRow`.**

  In `EmitterTree.tsx`, locate the `{isLinked && !isEditing && (...)}` block (around lines 676–683) inside the outer row button. Delete it entirely.

- [ ] **Step 4: Convert the row's outer button from flex to grid.**

  Locate the className on the outer row button (around lines 607–616). Replace the className expression — strip the `flex w-full items-center gap-1.5` part and replace with `grid w-full items-center`. Also add an inline `style` to set the grid template explicitly.

  The current expression:

  ```tsx
              className={[
                "flex w-full items-center gap-1.5 py-1 pr-2 text-left text-sm transition-colors",
                "border-l-2",
                borderClass,
                rowBgClass,
                reparentTintClass,
                fontClass,
                node.visible ? "" : "opacity-50",
                draggingId === node.id ? "opacity-50" : "",
              ].join(" ")}
              style={{ paddingLeft: `${8 + indentPx}px` }}
  ```

  Becomes:

  ```tsx
              className={[
                "grid w-full items-center gap-1.5 py-1 pr-2 text-left text-sm transition-colors",
                "border-l-2",
                borderClass,
                rowBgClass,
                reparentTintClass,
                fontClass,
                node.visible ? "" : "opacity-50",
                draggingId === node.id ? "opacity-50" : "",
              ].join(" ")}
              style={{
                paddingLeft: `${8 + indentPx}px`,
                gridTemplateColumns: "12px 1fr 18px",
              }}
  ```

  The eye button added in Task 5 used `ml-auto` which is no longer needed in a grid (the eye sits in the third column automatically). Remove `ml-auto` from the eye button's className (so it reads `grid place-items-center w-4 h-4 shrink-0 rounded text-text-3 hover:bg-panel-2 hover:text-text` only).

- [ ] **Step 5: Re-run — expect pass.**

  ```
  pnpm vitest run src/screens/__tests__/EmitterTree.test.tsx --reporter=basic
  ```

  Expected: PASS for both new specs. Existing specs continue to pass — the role-glyph and name elements still render with their content; only their layout container changed.

- [ ] **Step 6: Sanity check + commit.**

  ```
  pnpm build
  pnpm test --reporter=basic
  ```

  Expected: 234/234. Build clean.

  ```bash
  git add web/apps/editor/src/screens/EmitterTree.tsx \
          web/apps/editor/src/screens/__tests__/EmitterTree.test.tsx
  git commit -m "$(cat <<'EOF'
  feat(LT-4): row layout becomes 3-column grid, per-row link-group dot dropped

  Each EmitterRow is now a CSS grid with
  `grid-template-columns: 12px 1fr 18px` (role glyph / name / eye).
  Eye column-aligns automatically across all rows because the row
  width is uniform — the gutter's variable width shifts every row
  by the same amount.

  The per-row link-group dot is gone. Link-group membership now lives
  entirely in the gutter brackets (matches legacy editor behaviour).
  The Task 5 eye button's transitional `ml-auto` is removed since the
  grid template provides the column placement directly.

  Test count: 232 → 234.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 7: Move `EmitterTreeToolbar` below the `<ul>` and restyle with `.tree-actions`. Drop the toolbar's eye-toggle button.

**Why seventh:** With per-row eyes in place, the toolbar's primary-only eye toggle is redundant. The toolbar also visually belongs below the tree (matches design source's `tree-actions` placement).

**Files:**
- Modify: `web/apps/editor/src/screens/EmitterTree.tsx` — move JSX, restyle className, delete eye-toggle button
- Test: `web/apps/editor/src/screens/__tests__/EmitterTree.test.tsx` — new specs

### Steps

- [ ] **Step 1: Add failing specs.**

  ```tsx
    it("toolbar renders AFTER the tree's <ul> in DOM order", async () => {
      const bridge = makeStubBridge();
      render(<EmitterTree bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByText("Smoke")).toBeInTheDocument();
      });

      const tree    = screen.getByRole("tree", { name: "Emitters" });
      const toolbar = screen.getByTestId("emitter-tree-toolbar");

      // The toolbar comes after the tree's <ul> in document order.
      const cmp = tree.compareDocumentPosition(toolbar);
      // DOCUMENT_POSITION_FOLLOWING === 4
      expect(cmp & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("toolbar uses the .tree-actions class for design-aligned chrome", async () => {
      const bridge = makeStubBridge();
      render(<EmitterTree bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByText("Smoke")).toBeInTheDocument();
      });

      const toolbar = screen.getByTestId("emitter-tree-toolbar");
      expect(toolbar.className).toContain("tree-actions");
    });

    it("toolbar no longer has the eye-toggle button (per-row eyes replace it)", async () => {
      const bridge = makeStubBridge();
      render(<EmitterTree bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByText("Smoke")).toBeInTheDocument();
      });

      // The legacy eye-toggle button used aria-label "Toggle emitter visibility".
      expect(screen.queryByLabelText("Toggle emitter visibility")).toBeNull();
    });
  ```

- [ ] **Step 2: Run — expect failure.**

  Expected: FAIL on all three.

- [ ] **Step 3: Move the toolbar JSX from above the `<ul>` to after it.**

  Open `EmitterTree.tsx`. Locate the JSX in the `EmitterTree` component's return (around line 1304):

  ```tsx
        <EmitterTreeToolbar bridge={bridge} tree={tree} primaryId={primaryId} />
        {tree === null ? (
          <div className="text-text-3 text-sm">(loading…)</div>
        ) : rootChildren.length === 0 ? (
          <div className="text-text-3 text-sm">(no emitters)</div>
        ) : (
          // <div className="relative flex"> ... <ul> ... </ul> ... <gutter> ... </div>
        )}
  ```

  Move the `<EmitterTreeToolbar />` line to AFTER the `)}` that closes the conditional render block — i.e., the toolbar appears after the tree wrapper. The new shape:

  ```tsx
        {tree === null ? (
          <div className="text-text-3 text-sm">(loading…)</div>
        ) : rootChildren.length === 0 ? (
          <div className="text-text-3 text-sm">(no emitters)</div>
        ) : (
          // <div className="relative flex"> ... <ul> ... </ul> ... <gutter> ... </div>
        )}
        <EmitterTreeToolbar bridge={bridge} tree={tree} primaryId={primaryId} />
  ```

- [ ] **Step 4: Restyle the toolbar's outer div with `.tree-actions`.**

  Locate the `EmitterTreeToolbar` component (around line 891). Replace the current outer `<div>`'s className:

  ```tsx
      <div
        data-testid="emitter-tree-toolbar"
        className="mb-1 flex items-center gap-0.5 border-b border-border pb-1"
      >
  ```

  With:

  ```tsx
      <div
        data-testid="emitter-tree-toolbar"
        className="tree-actions"
      >
  ```

  The `.tree-actions` class in `components.css` provides flex layout, padding, banded top + bottom borders, and the panel background. Tailwind utility classes are no longer needed on this container.

- [ ] **Step 5: Drop the eye-toggle button from the toolbar.**

  Inside the `EmitterTreeToolbar` component, locate the eye-toggle button (around lines 966–975 — the `<button ...>` with `<EyeGlyph className="size-4" />`). Delete the entire `<button>` block AND the preceding separator `<span className="mx-0.5 h-4 w-px bg-panel-2" aria-hidden />` (it visually separated the eye from the next group and is now orphaned).

  Also remove the now-unused helper variables `primaryVisible`, `EyeGlyph`, and `toggleVisibility` from the `EmitterTreeToolbar` function body (those existed only for the eye-toggle button).

- [ ] **Step 6: Re-run — expect pass.**

  ```
  pnpm vitest run src/screens/__tests__/EmitterTree.test.tsx --reporter=basic
  ```

  Expected: PASS for all three new specs.

- [ ] **Step 7: Sanity check + commit.**

  ```
  pnpm build
  pnpm test --reporter=basic
  ```

  Expected: 237/237. Build clean. **Critical**: if the build fails with "unused variable" errors on `primaryVisible` / `EyeGlyph`, return to Step 5 and finish the cleanup.

  ```bash
  git add web/apps/editor/src/screens/EmitterTree.tsx \
          web/apps/editor/src/screens/__tests__/EmitterTree.test.tsx
  git commit -m "$(cat <<'EOF'
  feat(LT-4): tree toolbar moves below the <ul>, restyles to .tree-actions, drops eye

  Matches the design source's tree-actions placement (banded
  hairlines top + bottom, panel background) and removes the
  toolbar's eye-toggle button (now redundant with the per-row eyes
  shipped in Task 5). The toolbar's button set shrinks from 7 to
  6 — Show All / Hide All remain as bulk operations.

  Test count: 234 → 237.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 8: Remove the hard `border-t border-border` between tree region and inspector in `App.tsx`

**Why eighth:** Smallest possible diff. With the tab strip's underline now serving as the natural visual transition, the hard hairline border becomes redundant. Doing this last lets you visually verify the cumulative effect against the design source.

**Files:**
- Modify: `web/apps/editor/src/App.tsx` — one className edit

### Steps

- [ ] **Step 1: Identify the target.**

  Open `web/apps/editor/src/App.tsx`. Locate the inspector wrapper div (around line 209):

  ```tsx
            <div
              data-testid="quadrant-property-tabs"
              className="h-72 shrink-0 border-t border-border"
            >
              <EmitterPropertyTabs bridge={bridge} />
            </div>
  ```

- [ ] **Step 2: Remove `border-t border-border` from the className.**

  Replace with:

  ```tsx
            <div
              data-testid="quadrant-property-tabs"
              className="h-72 shrink-0"
            >
              <EmitterPropertyTabs bridge={bridge} />
            </div>
  ```

- [ ] **Step 3: Verify build + test suite still pass.**

  ```
  pnpm build
  pnpm test --reporter=basic
  ```

  Expected: 0 TS errors. 237/237. No spec asserted against this `border-t` so nothing should break.

- [ ] **Step 4: Manual visual smoke (recommended but optional).**

  Launch the dev binary if it's already built; otherwise run a fresh MSBuild Debug x64:

  ```bash
  "/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" \
    "ParticleEditor.sln" //p:Configuration=Debug //p:Platform=x64 //v:m 2>&1 | tail -10
  ./x64/Debug/ParticleEditor.exe --new-ui
  ```

  Verify:
  - Tree pane shows tree at top, toolbar banded at bottom of tree, tab strip below toolbar, inspector below tab strip.
  - No hard line between toolbar and tab strip — the toolbar's bottom border IS the divider.
  - Per-row eye visible on every row.
  - Toggle theme to light; verify the visual still reads as continuous.

- [ ] **Step 5: Commit.**

  ```bash
  git add web/apps/editor/src/App.tsx
  git commit -m "$(cat <<'EOF'
  feat(LT-4): drop hard border between tree region and inspector

  The tab strip's underline (border-bottom on .tabs from
  components.css) is now the natural visual transition between
  tree + inspector. The previously hard `border-t border-border`
  on the inspector wrapper created a doubled hairline that made
  the left pane read as two stacked compartments. One hairline
  is enough; the tabs own it.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 9: Docs — ROADMAP + CHANGELOG + HANDOFF

**Why ninth:** All code changes have landed. Docs capture what shipped.

**Files:**
- Modify: `ROADMAP.md` — 2 new entries
- Modify: `CHANGELOG.md` — B1 entry (partial backfill — hash + PR# stay TODO until master merge)
- Modify: `tasks/HANDOFF.md` — refresh test counts + what landed

### Steps

- [ ] **Step 1: Add ROADMAP entries.**

  Open `ROADMAP.md`. Find the section that lists `[NT-K]` entries (near the top). Identify the next available `NT-K` tag — it's the highest `NT-?` ever used in the file + 1. (Scan the whole file including the Shipped section for vacated tags.)

  Add this entry under the appropriate tier (likely `## 1. Near-term`):

  ```markdown
  ### 1.K [NT-K] Engine-side single-member link-group enforcement

  *Estimate: small.*

  Three C++ mutation paths can leave a link group with exactly one
  member: `linkGroups/set-membership` (when leaving a 2-member group
  OR joining a different one that shrinks the previous group),
  `emitters/delete` (when one of a 2-member group's members is
  deleted), and `linkGroups/set-membership` with `groupId: -1` and
  a single-id input list (creating a new group with one member).

  Each path should auto-demote orphaned members to `linkGroup = 0`
  before the operation returns. Today's B1 ships a render-layer
  filter (in `computeLinkGroupBrackets`) that hides single-member
  groups from the gutter — but the data layer still carries them,
  so the Inspector's "Link Group: N" field on an orphaned emitter
  reads honestly-but-confusingly.

  Engine enforcement makes the data layer match the rendered view
  end-to-end. Touches `BridgeDispatcher::DispatchRequest`'s three
  named handlers + the corresponding mock cases + their playwright
  contract specs.
  ```

  And this one for the visual-stability lane assignment option:

  ```markdown
  ### 1.K+1 [NT-K+1] Visual-stability lane assignment for bracket gutter (option)

  *Estimate: small.*

  B1's multi-lane gutter uses greedy first-fit (aggressive reuse)
  for lane assignment. A bracket's `lane` field can change between
  renders when surrounding groups change — semantically OK (the
  bracket's colour identifies the group; lane is just an x-offset),
  but visually a bouncing gutter may annoy daily users with many
  link groups.

  Add a setting that opts the user into stability-by-groupId:
  `lane = (groupId - 1) % maxLanes`. Same group always lands in
  the same lane. Modest collision risk between groups whose IDs
  share a modulus — rare in practice.

  Only worth doing if real use reveals the bouncing as a real
  ergonomic issue.
  ```

  Pick the actual `NT-K` value based on what's already in the file. Replace `K` and `K+1` everywhere with the concrete numbers. Update the section numbering (`1.M`) to fit the position in the list.

  Don't forget to update the TOC at the top of ROADMAP.md if you added a new top-level subsection (you didn't — these are entries within the existing `## 1. Near-term` section, so the TOC is unaffected).

- [ ] **Step 2: Add CHANGELOG entry.**

  Open `CHANGELOG.md`. The new entry goes at the top of the `## Changelog` section (newest-first). Follow the existing format exactly — date line + three sections (what ships / how we tackled it / issues encountered).

  ```markdown
  ### Left-pane realignment (B1) — tree toolbar at bottom, per-row eye, multi-lane bracket gutter

  *TODO-DATE · [`TODO-HASH`](https://github.com/DrKnickers/new-particle-editor/commit/TODO-HASH) · [#TODO-PR](https://github.com/DrKnickers/new-particle-editor/pull/TODO-PR)*

  Realigns the left pane against the design source's structural
  intent. Specifically: the tree toolbar moves from above the
  `<ul>` to below it and restyles to match `.tree-actions` (banded
  hairlines top + bottom); each tree row gains a per-row 👁
  visibility eye, and the toolbar's primary-only eye toggle goes
  away as redundant; the per-row sky-blue link-group dot is
  removed in favour of the gutter brackets alone (legacy parity);
  the hard `border-t` between tree region and inspector is gone,
  with the tab strip's underline as the natural transition. Each
  row is now a 3-column CSS grid `[12px glyph] [1fr name] [18px
  eye]` so eyes column-align automatically across all rows. The
  bracket gutter gains aggressive-reuse multi-lane support — when
  groups interleave, brackets pack into multiple lanes via greedy
  first-fit and the gutter widens accordingly; when groups are
  sparse, all brackets reuse lane 0 and the gutter stays narrow.
  Single-member link groups are now filtered at the render layer
  so no group ever appears as a single-row stub.

  **How we tackled it.** Two layers, both small. Layer 1:
  [`link-group-colors.ts`](src/lib/link-group-colors.ts) extends
  `LinkGroupBracket` with a `lane: number` field and adds a third
  pass to `computeLinkGroupBrackets` that assigns lanes via greedy
  first-fit (sort by `firstRowIndex`; for each bracket pick the
  lowest lane whose `lastEnd` is strictly less than the bracket's
  `firstRowIndex`; push a new lane if none free). The same
  function gains a `count < 2` skip so single-member groups never
  emit a descriptor. Companion `laneCount` export lets the
  renderer compute the gutter's container width without an inline
  reduce. Layer 2:
  [`EmitterTree.tsx`](src/screens/EmitterTree.tsx) converts the
  per-row container from flex to a 3-column CSS grid, adds the
  per-row eye `<button>` (with `stopPropagation` to keep
  visibility-toggling from re-selecting the row), removes the
  per-row link-group dot span, moves the `<EmitterTreeToolbar>`
  from above the `<ul>` to after it, restyles its outer container
  to `.tree-actions`, drops the eye-toggle button + its helpers,
  and rewrites the gutter renderer to size by `laneCount * 10 +
  4px` (or `4px` minimum) and position each bracket by `left =
  4 + lane * 10`. The hard `border-t border-border` on the
  inspector wrapper in [`App.tsx`](src/App.tsx) goes away as a
  one-line edit.

  **Issues encountered and resolutions.** *Existing test fixture
  broken by the single-member filter.*
  [`link-group-colors.test.ts:30`](src/lib/__tests__/link-group-colors.test.ts:30)
  asserted that a single-row group (`group 2` at row 4) produced
  a bracket — that's now filtered out. The fixture was rewritten
  with a 2-member group for group 2 plus a new single-row group 3
  that the filter rejects, asserting the new behaviour
  end-to-end. *Eye button accidentally re-selecting the row.*
  First implementation forgot `e.stopPropagation()` on the eye
  button's `onClick`, so clicking the eye also fired the outer
  row button's `onClick` (which calls `emitters/select`). Spec
  caught it ("clicking the per-row eye does NOT change
  selection"); fix is the standard `stopPropagation` guard.
  *Unused helpers after dropping the toolbar eye-toggle.* Removing
  the toolbar's eye button left `primaryVisible`, `EyeGlyph`, and
  `toggleVisibility` unused in `EmitterTreeToolbar`; TS strict
  mode catches this and refuses to build. Cleanup was part of
  Task 7.

  Test count: vitest **237 / 237** (was 219; +18 across all the
  new specs), Playwright unchanged at **83 / 83**.

  ---
  ```

- [ ] **Step 3: Refresh HANDOFF.**

  Open `tasks/HANDOFF.md`. Update at minimum:

  - The header date line.
  - The "Last conversation context" paragraph (replace with one mentioning B1 shipped, B2 is the next dispatch).
  - The resumable state table (HEAD now points to the latest B1 commit; ahead-of-origin/lt-4 count).
  - The "What landed this session" section (add the 8 B1 commits).
  - Test counts in the build status row (now 237/237 vitest, 83/83 Playwright).
  - The "Open items" section (B1 ships, so the "next moves" reorders — B2 becomes the top item).

  Pattern from prior refreshes (see `02e5af8`'s diff for shape).

- [ ] **Step 4: Commit all three docs together.**

  ```bash
  git add ROADMAP.md CHANGELOG.md tasks/HANDOFF.md
  git commit -m "$(cat <<'EOF'
  docs(LT-4): ROADMAP + CHANGELOG + HANDOFF for B1 left-pane realignment

  - ROADMAP gains two follow-up entries: engine-side single-member
    link-group enforcement, and a visual-stability lane-assignment
    option for the bracket gutter.
  - CHANGELOG gets the B1 entry following the partial-backfill
    convention (hash + PR# stay TODO until merge).
  - HANDOFF refreshed: test counts now 237/237 vitest + 83/83
    Playwright; B1 listed under what landed; B2 (Appearance +
    Physics tab wiring) is the top "next move."

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 10: Final verification + handoff

**Why last:** Single end-to-end pass before requesting user OK to fast-forward into `lt-4`.

**Files:** none modified.

### Steps

- [ ] **Step 1: Run all verification gates.**

  ```
  cd web/apps/editor
  pnpm build
  pnpm test --reporter=basic
  pnpm test:native
  ```

  Expected:
  - `pnpm build` — 0 TS errors.
  - `pnpm test` — 237/237.
  - `pnpm test:native` — 83/83.

- [ ] **Step 2: MSBuild sanity check (optional — B1 doesn't touch C++).**

  ```bash
  "/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" \
    "ParticleEditor.sln" //p:Configuration=Debug //p:Platform=x64 //v:m 2>&1 | tail -10
  ```

  Expected: clean (preexisting LIBCMTD warning is fine).

- [ ] **Step 3: Manual smoke (do or ask the user to do).**

  Launch `./x64/Debug/ParticleEditor.exe --new-ui` and verify, in order:
  - Left pane shows: title-only header → tree → banded toolbar at bottom of tree → tab strip → inspector. No hard line between tree-region and tab strip.
  - Per-row eye visible on every row. Click one; the emitter visibility toggles + the eye glyph swaps (Eye ↔ EyeOff).
  - Toolbar still has New ▾ / Delete / Move Up / Move Down + divider + Show All / Hide All — no eye toggle.
  - Create a 2-member link group via context-menu "Set Link Group…"; bracket renders in the gutter at lane 0; per-row dot does NOT appear.
  - Remove one member; bracket disappears (group is now single-member, filtered).
  - Create deliberately interleaved groups (2 nested 2-member groups); gutter widens to 2 lanes; both groups readable.
  - Toggle theme to light; verify the visual still reads as continuous; toggle back to dark.

- [ ] **Step 4: Legacy regression.**

  Launch with `--legacy-ui` (or no flag — legacy is the default). Verify the legacy left pane is unchanged.

- [ ] **Step 5: Lineage check before FF.**

  ```
  git log --oneline lt-4..HEAD
  ```

  Expected: 10 commits (2 from prior session + Tasks 1, 2, 3, 4, 5, 6, 7, 8, 9).

  ```
  git log --oneline HEAD..lt-4
  ```

  Expected: 0 (session branch has all the lt-4 work).

- [ ] **Step 6: Request user OK to FF.**

  Per CLAUDE.md, never push to `origin/lt-4` without explicit user OK. Ask the user; await response.

- [ ] **Step 7: On user OK, fast-forward + push.**

  ```bash
  git switch lt-4
  git merge --ff-only claude/<current-session-name>
  git push
  git switch -
  ```

  If FF fails, STOP and reconcile per CLAUDE.md's branch workflow notes.

- [ ] **Step 8: Backfill the CHANGELOG entry's hash + PR#.**

  Once the FF lands on `origin/lt-4` (or after the master merge if you're going through a PR), open `CHANGELOG.md` and replace the `TODO-HASH` and `TODO-PR` placeholders with the actual merge-commit short hash and PR number. Then a small follow-up commit:

  ```bash
  git add CHANGELOG.md
  git commit -m "docs(LT-4): backfill B1 CHANGELOG hash + PR number"
  ```

  (This last step happens AFTER FF, not before — the hash is the merge-commit hash on `lt-4`.)

---

## Verification matrix (use this as a final checklist)

| Item | Source | Expected |
|---|---|---|
| Single-member groups filtered | Task 1 | `computeLinkGroupBrackets` returns 0 entries for a single-row group |
| Lane assignment correct | Task 2 | Aggressive reuse picks lowest free lane; reused after `lastEnd` |
| Lane count helper | Task 3 | Returns `max(lane) + 1`, or 0 for empty input |
| Gutter width formula | Task 4 | `max(4, laneCount * 10 + 4)` |
| `data-lane` on every bracket | Task 4 | Matches the bracket's assigned lane |
| Per-row eye on every row | Task 5 | `data-testid="emitter-vis-{id}"` exists |
| Eye click dispatches `set-visible` | Task 5 | `{ id, visible: !current }` |
| Eye click does NOT select | Task 5 | `stopPropagation` keeps row selection stable |
| Row is 3-column CSS grid | Task 6 | `gridTemplateColumns: "12px 1fr 18px"` |
| Per-row link-group dot removed | Task 6 | No `aria-label="Link group N"` matches |
| Toolbar after `<ul>` in DOM | Task 7 | `compareDocumentPosition` shows FOLLOWING |
| Toolbar uses `.tree-actions` class | Task 7 | className substring match |
| Toolbar eye-toggle gone | Task 7 | No `aria-label="Toggle emitter visibility"` |
| Hard `border-t` gone | Task 8 | Visual smoke; no inline border-t in inspector wrapper |
| ROADMAP entries added | Task 9 | Two new NT-K entries |
| CHANGELOG entry added | Task 9 | Top of `## Changelog` section, partial-backfill convention |
| HANDOFF refreshed | Task 9 | Test counts updated; B1 listed in "What landed"; B2 in "Next moves" |
| All gates green | Task 10 | build 0 err; vitest 237/237; Playwright 83/83 |
| Legacy regression OK | Task 10 | `--legacy-ui` mode unchanged |

---

## Notes for the engineer following this plan

- **Sequential by design.** Each task builds on the previous one. Skipping ahead means a later task references symbols that don't exist yet. Read the whole plan once before starting.
- **TDD discipline.** Each task's failing test verifies the change is real. Don't skip Steps 2 (run-and-watch-fail) — it's how you know the new spec actually exercises the new path.
- **Commit per task.** Don't bundle multiple tasks into one commit. The plan's per-task commits produce a clean reviewable history that maps 1:1 to the design spec sections.
- **L-005 (pnpm allowBuilds).** If `pnpm install` re-injects the placeholder string, edit `pnpm-workspace.yaml` directly to set the per-package values to `true`. Captured in `tasks/lessons.md` L-005.
- **L-004 (vitest != tsc).** `pnpm test` doesn't type-check. Always run `pnpm build` (which is `tsc -b`) before declaring victory.
- **CLAUDE.md branch workflow.** Session branch FF into `lt-4`, then push, all with explicit user OK. Never push to `master`.
- **Worktree-aware test paths.** All paths in this plan are relative to the worktree root. If you're in `/c/Modding/Particle Editor/.claude/worktrees/<your-session>/`, those paths resolve correctly.

---
