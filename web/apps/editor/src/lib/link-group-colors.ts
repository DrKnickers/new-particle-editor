// link-group-colors.ts — palette for the EmitterTree's link-group
// bracket gutter (Phase 3 Screen 4 Batch C).
//
// Mirrors the legacy `kBracketPalette` (MT-9 visual port): 8 colours
// cycled by `linkGroup % 8`. Group 0 is "unlinked" and never gets a
// bracket — colorForGroup(0) returns null so callers know to skip
// rendering.
//
// Chosen for contrast against the tree's `bg-neutral-950` background
// AND visual distinction across adjacent groups. Hex literals rather
// than Tailwind class names so the renderer can drop them straight
// into inline `style` props (Tailwind purges unused arbitrary
// values, which would break per-group colours derived at runtime).

const BRACKET_PALETTE: readonly string[] = Object.freeze([
  "#38bdf8", // sky-400
  "#f472b6", // pink-400
  "#a78bfa", // violet-400
  "#facc15", // yellow-400
  "#34d399", // emerald-400
  "#fb923c", // orange-400
  "#f87171", // red-400
  "#22d3ee", // cyan-400
]);

/** Number of distinct colours cycled by `colorForGroup`. */
export const BRACKET_PALETTE_SIZE = BRACKET_PALETTE.length;

/** Returns the bracket colour for `linkGroup`. Returns null for
 *  group 0 (unlinked emitters never render a bracket). For non-zero
 *  groups, cycles through the 8-colour palette via `(group-1) % 8` —
 *  starting at 0 so group 1 → palette[0]. */
export function colorForGroup(group: number): string | null {
  if (group <= 0) return null;
  const idx = (group - 1) % BRACKET_PALETTE_SIZE;
  return BRACKET_PALETTE[idx] ?? null;
}

/** Walks a flattened tree row list and returns one bracket descriptor
 *  per unique non-zero `linkGroup` WITH AT LEAST 2 MEMBERS. Single-
 *  member groups are filtered out (B1 invariant — every rendered
 *  bracket spans ≥ 2 rows). `firstRowIndex` + `lastRowIndex` are
 *  0-based positions in `flatRows`. Single-lane (no overlap handling
 *  yet — see Task 2 for the lane assignment pass). */
export type LinkGroupBracket = {
  groupId: number;
  color: string;
  firstRowIndex: number;
  lastRowIndex: number;
};

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
