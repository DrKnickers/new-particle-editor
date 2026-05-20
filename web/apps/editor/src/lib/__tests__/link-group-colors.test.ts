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
});
