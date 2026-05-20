// Vitest unit tests for the link-group bracket palette + range
// computation (Phase 3 Screen 4 Batch C).

import { describe, it, expect } from "vitest";
import {
  BRACKET_PALETTE_SIZE,
  colorForGroup,
  computeLinkGroupBrackets,
} from "../link-group-colors";

describe("link-group-colors", () => {
  it("colorForGroup returns null for unlinked (group 0) and cycles through 8 colours for non-zero groups", () => {
    expect(BRACKET_PALETTE_SIZE).toBe(8);
    expect(colorForGroup(0)).toBeNull();
    // Group 1 → palette[0]; group 9 wraps back to palette[0].
    const c1 = colorForGroup(1)!;
    const c9 = colorForGroup(9)!;
    expect(c1).toBeTruthy();
    expect(c1).toBe(c9);
    // Group 2..8 should each be distinct from group 1.
    const seen = new Set([c1]);
    for (let g = 2; g <= 8; g++) {
      const c = colorForGroup(g)!;
      expect(c).toBeTruthy();
      seen.add(c);
    }
    expect(seen.size).toBe(8);
  });

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

  it("filters single-member groups — they never appear in the result", () => {
    const rows = [
      { linkGroup: 5 },  // only member of group 5
      { linkGroup: 0 },
      { linkGroup: 7 },  // only member of group 7
    ];
    const brackets = computeLinkGroupBrackets(rows);
    expect(brackets).toHaveLength(0);
  });

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
});
