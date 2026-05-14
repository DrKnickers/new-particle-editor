# [MT-9] Visual link-group bracket

**Status (2026-05-13):** ✅ implementation complete on branch `claude/exciting-easley-6a20e4` (worktree `.claude/worktrees/exciting-easley-6a20e4`). Awaiting interactive verification + PR. See [§Review (end of file)](#review) for the per-milestone summary, what to test live, and known gaps.

> **Format note (2026-05-13).** This plan adopts the planning conventions
> used in the [`max2alamo-2026`](https://github.com/DrKnickers/max2alamo-2026)
> sister project: a Context block before scope, per-artefact Architecture
> subsections, named tripwires for each risk, and a verifier-first
> Verification section where each assertion says *what regression it
> catches*, not just *what feature it confirms*. If this shape works,
> [CLAUDE.md](../CLAUDE.md) is the next thing to update so MT-10 + future
> work inherits the convention.

---

## Status of the surrounding work

- ✅ **[MT-7]** Linked emitters — shipped ([#58](https://github.com/DrKnickers/new-particle-editor/pull/58)). Group membership, propagation, exempt set, undo/redo, file format `0x0100` chunk all in place.
- ✅ **[MT-8]** Tree multi-select — shipped ([#60](https://github.com/DrKnickers/new-particle-editor/pull/60)). `multiSelection`, modifier-aware clicks, marquee, `NM_CUSTOMDRAW` handler, `EmitterTreeViewWindowProc` subclass, `TVS_EX_DOUBLEBUFFER` all landed. *MT-9 is the load-bearing reuser of this infrastructure.*
- 🚧 **[MT-9]** Visual link-group bracket — **this plan**.
- 🚧 **[MT-10]** Configurable exempt set per link group — independent of MT-9; touches data model + file format. Plan is at the bottom of this file as a pointer; full plan reopens after MT-9 lands.

---

## Context

MT-7 made link groups exist; MT-8 made bulk selection ergonomic; MT-9 makes group membership *legible at scroll-speed*. Today the only signal that two emitters are linked is the `[L<n>]` prefix in `FormatEmitterDisplayName`. That works for 2–3 groups but fails fast on real particle systems where a single linked group can span 4+ emitters separated by intervening unlinked rows (`smoke_a`, then 3 other emitters, then `smoke_b`, then 4 more, then `smoke_c`). The user can't see the group at a glance, can't tell two `[L3]`s apart from interleaved `[L4]` members in a list of 30, and can't multi-select a whole group with a single click.

MT-9 closes that gap with a coloured bracket in the tree's right margin per group, lane-allocated so non-overlapping groups share columns, with hover-to-tint and click-to-select-group as the interaction layer on top.

After MT-9 the only open link-group work for v1 is MT-10 (per-group exempt configurability), which is unblocked by neither MT-9 nor MT-8 and can ship in either order — though MT-9 first is preferred because it's purely UI and won't touch the file format.

**Why now**: MT-8 left a `NM_CUSTOMDRAW` handler at [src/UI/EmitterList.cpp:1841](src/UI/EmitterList.cpp:1841), a tree subclass at [src/UI/EmitterList.cpp:1013](src/UI/EmitterList.cpp:1013), and `TVS_EX_DOUBLEBUFFER` enabled at [src/UI/EmitterList.cpp:1726](src/UI/EmitterList.cpp:1726). All three are exactly what MT-9 needs. Delaying MT-9 means the plumbing sits unused while users keep hunting for group members visually.

---

## Goal + scope

Add a per-group coloured bracket painted in the tree's right margin, lane-allocated via greedy interval scheduling, with hover-highlight (member rows tint, bracket line thickens) and click-to-select-group (multi-set := group members, primary := topmost visible).

**In:**

- New layout cache on `EmitterListControl`: `bracketLayout` struct holding `(groupId → laneIndex)`, per-lane X offset, and `(groupId → vector<row Y, member emitter>)` so hit-tests don't re-walk the tree.
- `NM_CUSTOMDRAW` extensions on the existing handler at [src/UI/EmitterList.cpp:1841](src/UI/EmitterList.cpp:1841):
  - `CDDS_PREPAINT`: rebuild `bracketLayout` from current visible tree state (one walk of `TreeView_GetItemRect` per linked-emitter row, then greedy interval-schedule by `minY` per group).
  - `CDDS_ITEMPOSTPAINT`: paint per-member dot + horizontal stub at the row's `(laneX, centreY)` in the group's palette colour.
  - `CDDS_POSTPAINT`: draw the vertical lane line connecting topmost-to-bottommost dot per group, plus the existing marquee frame.
- Hover state on `EmitterListControl`: `hoveredGroupId` (0 = none), `mouseTrackingArmed` (re-arm `TrackMouseEvent` per move).
- `WM_MOUSEMOVE` extension in `EmitterTreeViewWindowProc` at [src/UI/EmitterList.cpp:1188](src/UI/EmitterList.cpp:1188): hit-test against `bracketLayout`; on change, repaint old + new group's rows + lane lines. *Only fires when no marquee is active* — marquee path is untouched.
- `WM_MOUSELEAVE` + `TrackMouseEvent` / `TME_LEAVE` to clear hover on cursor exit.
- `WM_KILLFOCUS` and `WM_CAPTURECHANGED` clear hover defensively (matches the existing marquee-cancel pattern).
- `WM_LBUTTONDOWN` extension at [src/UI/EmitterList.cpp:1036](src/UI/EmitterList.cpp:1036): hit-test against `bracketLayout` BEFORE the multi-select / marquee dispatch; on hit (`Dot` or `Line`), replace `multiSelection` with `GetLinkGroupMembers(...)`, set primary to topmost visible member, `selectionAnchor = primary`, fire `ELN_SELCHANGED`, eat the message.
- Per-paint hover tint: member rows of `hoveredGroupId` get a `~15%` alpha fill in the group's palette colour at `CDDS_ITEMPOSTPAINT`. The existing multi-select `COLOR_HIGHLIGHT` paint at `CDDS_ITEMPREPAINT` is preserved unchanged — hover tint and multi-select highlight stack.
- 12-colour palette (Tableau-derived, luminance-adjusted for thin-line work on white) in `EmitterList.cpp`, reordered so the first 6 entries have maximum perceptual distance (real systems mostly use ≤ 6 simultaneous groups). Each colour verified ≥ 3:1 against `COLOR_WINDOW` (WCAG 2.1 SC 1.4.11 for graphical objects) via a debug-only contrast printer.
- **High Contrast theme override**: when `SystemParametersInfo(SPI_GETHIGHCONTRAST, ...)` reports HC active, paint all brackets in `GetSysColor(COLOR_HIGHLIGHT)`. Group identity in HC mode comes from lane position + the existing `[L<n>]` prefix in `FormatEmitterDisplayName`. Re-check on `WM_THEMECHANGED`.
- DPI-aware sizing: lane width, dot radius, stub length, stroke width all `MulDiv(base, GetDpiForWindow(hTree), 96)`.
- Unbounded lane count: when `numLanes × baseLaneWidth > clientWidth / 4`, lane width scales down to `max(2, reservedMax / numLanes)`.
- Debug instrumentation under `#ifndef NDEBUG`: `[Link] layout groups=N lanes=M`, `[Link] hover group=N (was M)`, `[Link] click select group=N members=M`.

**Out:**

- **Multi-drag-reorder** (moving N selected emitters with one drop). *Reason: out-of-scope slot-switch; separate ROADMAP entry if friction proves real after MT-9 ships.*
- **Persisted lane assignment across re-orderings** (a group "owns" lane 2 forever). *Reason: every paint recomputes lanes from current Y order; recomputation is fast and the alternative requires a stable-lane data model that the file format doesn't support.*
- **Bracket painting in a separate overlay window**. *Reason: the post-MT-8 lessons note that a layered overlay loses paint races against children with their own `WM_PAINT`. `NM_CUSTOMDRAW` on the tree itself is the right tier — no overlay needed because the bracket lives inside the tree's client area, not over the inspector.*
- **Right-click on bracket → group menu** (Dissolve, Settings, etc.). *Reason: the right-click menu builder at [src/UI/EmitterList.cpp:1929](src/UI/EmitterList.cpp:1929) (`NM_RCLICK`) already exposes these actions on group members. Adding a second entry point doubles the surface area for marginal value; revisit if MT-10's group-settings dialog needs a discovery affordance.*
- **MT-10's `Group settings…` menu item.** *Reason: separate phase. MT-9 ships UI only.*

## What we already have

| Piece | File:line |
|---|---|
| `EmitterListControl` struct (multi-select + marquee state) | [src/UI/EmitterList.cpp:220](src/UI/EmitterList.cpp:220) |
| `multiSelection` set + `selectionAnchor` | [src/UI/EmitterList.cpp:229](src/UI/EmitterList.cpp:229) |
| `UpdateMultiSelectionFromClick` (modifier-aware) | [src/UI/EmitterList.cpp:350](src/UI/EmitterList.cpp:350) |
| `FindTreeItemByEmitter` (lParam → HTREEITEM, recursive) | [src/UI/EmitterList.cpp:551](src/UI/EmitterList.cpp:551) |
| `EmitterTreeViewWindowProc` tree subclass | [src/UI/EmitterList.cpp:1013](src/UI/EmitterList.cpp:1013) |
| `WM_LBUTTONDOWN` intercept (before tree's default selection) | [src/UI/EmitterList.cpp:1036](src/UI/EmitterList.cpp:1036) |
| `WM_MOUSEMOVE` (currently marquee-only) | [src/UI/EmitterList.cpp:1188](src/UI/EmitterList.cpp:1188) |
| `WM_LBUTTONUP` (marquee commit) | [src/UI/EmitterList.cpp:1400](src/UI/EmitterList.cpp:1400) |
| `WM_CAPTURECHANGED` (marquee cancel) | [src/UI/EmitterList.cpp:1604](src/UI/EmitterList.cpp:1604) |
| Tree subclass install + `TVS_EX_DOUBLEBUFFER` enable | [src/UI/EmitterList.cpp:1719](src/UI/EmitterList.cpp:1719) |
| `NM_CUSTOMDRAW` handler (CDDS_PREPAINT → ITEMPREPAINT → POSTPAINT) | [src/UI/EmitterList.cpp:1841](src/UI/EmitterList.cpp:1841) |
| `TVN_SELCHANGED` handler (keeps multi-set primary-consistent) | [src/UI/EmitterList.cpp:2643](src/UI/EmitterList.cpp:2643) |
| Right-click menu builder (multi-size-aware) | [src/UI/EmitterList.cpp:2045](src/UI/EmitterList.cpp:2045) |
| `GetLinkGroupMembers(system, groupId) → vector<Emitter*>` | [src/LinkGroup.cpp:24](src/LinkGroup.cpp:24) |
| `Emitter::linkGroup` field (0 = unlinked) | [src/ParticleSystem.h:135](src/ParticleSystem.h:135) |
| `ELN_SELCHANGED` notification id | [src/UI/UI.h:150](src/UI/UI.h:150) |
| `EmitterList_GetMultiSelectionSize` accessor | [src/UI/EmitterList.cpp:3263](src/UI/EmitterList.cpp:3263) |
| `FormatEmitterDisplayName` (where `[L<n>]` prefix lives — palette ground truth) | [src/UI/EmitterList.cpp](src/UI/EmitterList.cpp) (top) |

**Not yet in the codebase — to add:**

- `BracketLayout` struct (private to `EmitterList.cpp`).
- Greedy interval scheduler (~15-line static helper).
- `HitTestBracket(layout, clientPt) → BracketHit` (~20 lines).
- Hover-paint branch in `CDDS_ITEMPOSTPAINT` (the slot exists; today only `CDDS_ITEMPREPAINT` does work — MT-9 adds the postpaint branch).
- `WM_MOUSELEAVE` + `TME_LEAVE` wiring.
- 12-colour palette `const COLORREF[12]`.

**Unknown to confirm before coding:**

1. **Whether `CDDS_ITEMPOSTPAINT` fires when `CDDS_ITEMPREPAINT` returned `CDRF_NEWFONT`.** MT-8's prepaint branch returns `CDRF_NEWFONT` (not `CDRF_NEWFONT | CDRF_NOTIFYPOSTPAINT`) — needs `CDRF_NEWFONT | CDRF_NOTIFYPOSTPAINT` if we want the postpaint to fire on multi-select rows. **Action**: smoke-test by adding a `printf` in the new postpaint branch and confirming it fires on multi-select rows before painting anything.
2. **Whether `TreeView_GetItemRect(hTree, hItem, &r, FALSE)` returns a rect that extends to the full client width**, or just to the right edge of the label. The bracket needs to paint to the right of the label area, in margin space. **Action**: print rects in debug and visually confirm against `GetClientRect`.
3. **Whether `TVN_ITEMEXPANDED` triggers an automatic tree invalidate.** Plan assumes yes (so cache rebuilds next paint with collapsed/expanded children correctly accounted). **Action**: smoke-test with a parent emitter containing a child that's in a link group with a non-child sibling — collapse the parent, observe bracket recomputes.

---

## Architecture

Three new pieces of state, two new helpers, one extension to the existing custom-draw handler, and three extensions to the existing tree subclass. No new files.

### `EmitterListControl` additions

```cpp
// In the struct at src/UI/EmitterList.cpp:220:
struct BracketLayout {
    struct Member { LONG centreY; ParticleSystem::Emitter* emitter; };
    struct Group  {
        uint32_t           groupId;
        int                lane;          // 0..numLanes-1
        COLORREF           colour;
        std::vector<Member> members;       // sorted by centreY
        LONG               minY, maxY;
    };
    std::vector<Group> groups;             // index in this vector is stable per-paint
    int                numLanes;
    int                laneWidth;          // pixels, DPI-aware
    int                dotRadius;
    int                stubLength;
    int                strokeWidth;
    int                rightEdgeOffset;    // tree client right - margin start
    POINT              scrollOrigin;       // for stale detection in hit-test
    bool               valid;              // false = needs rebuild
};

BracketLayout bracketLayout;
uint32_t      hoveredGroupId;     // 0 = none
bool          mouseTrackingArmed;
```

Invariant: `bracketLayout.valid` is the only signal of cache freshness. Anything that changes tree state (selection change unrelated to bracket, expand/collapse, scroll, system swap) sets `valid = false`. `CDDS_PREPAINT` rebuilds if `!valid`.

### Layout builder (~40 lines)

```cpp
static void RebuildBracketLayout(EmitterListControl* control)
{
    BracketLayout& L = control->bracketLayout;
    L.groups.clear();
    L.valid = true;

    // 1. Walk visible linked emitters via TreeView_GetItemRect.
    //    Group by linkGroup. Skip groups with < 2 visible members
    //    (single member visible = no bracket needed).
    std::map<uint32_t, BracketLayout::Group> byId;
    HTREEITEM hItem = TreeView_GetRoot(control->hTree);
    while (hItem) {
        WalkVisibleLinkedEmitters(hItem, byId, control);
        hItem = TreeView_GetNextSibling(control->hTree, hItem);
    }
    for (auto& kv : byId) if (kv.second.members.size() >= 2) L.groups.push_back(kv.second);

    // 2. Greedy interval scheduling: sort by minY ascending,
    //    assign each group the lowest-index lane whose previous
    //    occupant ended before this group's minY.
    std::sort(L.groups.begin(), L.groups.end(),
              [](const auto& a, const auto& b) { return a.minY < b.minY; });
    std::vector<LONG> laneEnd;             // maxY of last group assigned to lane i
    for (auto& g : L.groups) {
        int lane = -1;
        for (size_t i = 0; i < laneEnd.size(); ++i) {
            if (laneEnd[i] < g.minY) { lane = (int)i; laneEnd[i] = g.maxY; break; }
        }
        if (lane < 0) { lane = (int)laneEnd.size(); laneEnd.push_back(g.maxY); }
        g.lane   = lane;
        g.colour = kBracketPalette[g.groupId % 12];
    }
    L.numLanes = (int)laneEnd.size();

    // 3. Lane sizing — DPI base × scale-down floor.
    int dpi = GetDpiForWindow(control->hTree);
    int baseLane = MulDiv(6, dpi, 96);
    RECT cr; GetClientRect(control->hTree, &cr);
    int reservedMax = (cr.right - cr.left) / 4;
    L.laneWidth = (L.numLanes * baseLane > reservedMax)
        ? max(2, reservedMax / L.numLanes)
        : baseLane;
    L.dotRadius   = MulDiv(3, dpi, 96);    // smaller than mockup so two adjacent lanes don't kiss
    L.stubLength  = MulDiv(5, dpi, 96);
    L.strokeWidth = MulDiv(1, dpi, 96);    // hover thickens to 2
    L.rightEdgeOffset = cr.right - 4;      // 4 px gutter from client edge
    GetScrollPos(control->hTree, SB_VERT, &L.scrollOrigin.y); // for stale detection
}
```

### Palette

`kBracketPalette` is a `static const COLORREF[12]`, Tableau-derived but luminance-adjusted for thin-line work on white (Tableau 10 as-published is designed for filled categorical viz; several entries — yellow, pink, light orange — fail the 3:1 contrast threshold for 1 px lines on `COLOR_WINDOW`). The first 6 entries are ordered for maximum perceptual distance, since realistic particle systems mostly use ≤ 6 simultaneous link groups; entries 7–12 cover the tail.

```cpp
// Lane colours. First 6: max perceptual distance for the common case.
// Entries 7-12: extended palette. All verified >= 3:1 contrast against
// COLOR_WINDOW (white default) per WCAG 2.1 SC 1.4.11 (Non-text Contrast).
// Source: Tableau 10 hues, luminance-shifted toward Material 700-tier
// where the raw Tableau value didn't hit thin-line contrast on white.
static const COLORREF kBracketPalette[12] = {
    RGB(0x1F, 0x4E, 0x79),   //  0  blue       (Tableau blue, darkened)
    RGB(0xC7, 0x57, 0x0A),   //  1  orange     (Tableau orange, darkened)
    RGB(0x2E, 0x7D, 0x32),   //  2  green      (Material 700 green)
    RGB(0xC6, 0x28, 0x28),   //  3  red        (Material 700 red)
    RGB(0x6A, 0x1B, 0x9A),   //  4  purple     (Material 700 purple)
    RGB(0x5D, 0x40, 0x37),   //  5  brown      (Material 700 brown)
    RGB(0xAD, 0x14, 0x57),   //  6  magenta    (Material 700 pink)
    RGB(0x00, 0x69, 0x5C),   //  7  teal       (Material 800 teal)
    RGB(0x82, 0x77, 0x17),   //  8  olive      (Material 800 lime)
    RGB(0x28, 0x35, 0x93),   //  9  indigo     (Material 800 indigo)
    RGB(0x00, 0x83, 0x8F),   // 10  cyan       (Material 800 cyan)
    RGB(0x88, 0x0E, 0x4F),   // 11  rose       (Material 900 pink)
};
```

**Adjacent-on-the-wheel check.** Positions 0–5 cycle blue → orange → green → red → purple → brown. No red-green adjacency (positions 2 and 3 are green and red, but the user typically sees these as "lane 2 vs lane 3" not "the red one vs the green one" — and the brown at position 5 isn't perceptually similar to red for deuteranopes).

**High Contrast override.** Before painting, check `SystemParametersInfo(SPI_GETHIGHCONTRAST, ...)`. If active, `colour = GetSysColor(COLOR_HIGHLIGHT)` for every group, ignoring `kBracketPalette`. Re-check on `WM_THEMECHANGED` (set `bracketLayout.valid = false` to force layout rebuild with new colours). Group differentiation in HC mode comes from lane position + the `[L<n>]` prefix; the brackets become a structural element rather than a colour-coded one. This is the accessibility-correct behaviour — the user opted into HC for a reason, we don't paint over it with custom RGB.

### `NM_CUSTOMDRAW` extension

Modifications to the existing handler at [src/UI/EmitterList.cpp:1841](src/UI/EmitterList.cpp:1841):

- **`CDDS_PREPAINT`**: now also calls `RebuildBracketLayout(control)` if `!control->bracketLayout.valid`. Return value unchanged: `CDRF_NOTIFYITEMDRAW | CDRF_NOTIFYPOSTPAINT`.
- **`CDDS_ITEMPREPAINT`**: existing multi-select highlight branch unchanged. **Bug fix here**: the existing return `CDRF_NEWFONT` must become `CDRF_NEWFONT | CDRF_NOTIFYPOSTPAINT` so the bracket dot can paint on top of the multi-select highlight (see "Unknown 1" above). Verify via the smoke-test before relying on it.
- **`CDDS_ITEMPOSTPAINT`** (new): for each row, look up the emitter's group in `bracketLayout`. If found:
  - Paint hover tint (`~15%` alpha blend of group colour over row rect) if `groupId == hoveredGroupId`.
  - Paint the dot at `(rightEdgeOffset - lane × laneWidth, rowCentreY)` and the horizontal stub from `dotX - stubLength` to `dotX` at row centre Y.
  - Return `CDRF_DODEFAULT` (no further per-item action).
- **`CDDS_POSTPAINT`**: existing marquee frame paint preserved. Add a pre-marquee block: for each group with `members.size() >= 2`, draw vertical line from `(dotX, topY)` to `(dotX, bottomY)`. Stroke `strokeWidth` (or `strokeWidth × 2` if hovered). Use `SelectClipRgn` to clip to tree client bounds.

### Hit-test (~20 lines)

```cpp
struct BracketHit { enum Kind { None, Dot, Line }; Kind kind; uint32_t groupId; };

static BracketHit HitTestBracket(const BracketLayout& L, POINT pt)
{
    const int dotRect = L.dotRadius + 2;   // ±2 px hit slop
    for (const auto& g : L.groups) {
        int dotX = L.rightEdgeOffset - g.lane * L.laneWidth;
        // Dot hits first — they're more specific.
        for (const auto& m : g.members) {
            if (abs(pt.x - dotX) <= dotRect && abs(pt.y - m.centreY) <= dotRect)
                return { BracketHit::Dot, g.groupId };
        }
        // Line hit: in the lane column, between topY and bottomY.
        if (abs(pt.x - dotX) <= max(2, L.strokeWidth + 1)
            && pt.y >= g.minY && pt.y <= g.maxY)
            return { BracketHit::Line, g.groupId };
    }
    return { BracketHit::None, 0 };
}
```

`HitTestBracket` first checks staleness: if `L.scrollOrigin` ≠ current scroll position, return `None` (paint will rebuild next frame; the user's click between paint and scroll-change is rare enough to discard).

### `EmitterTreeViewWindowProc` extensions

Three additions to the tree subclass at [src/UI/EmitterList.cpp:1013](src/UI/EmitterList.cpp:1013):

**1. `WM_LBUTTONDOWN` — bracket click intercept** (insert at the top of the existing case, before any marquee/multi-select dispatch at [src/UI/EmitterList.cpp:1036](src/UI/EmitterList.cpp:1036)):

```cpp
POINT pt = { GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam) };
BracketHit hit = HitTestBracket(control->bracketLayout, pt);
if (hit.kind != BracketHit::None) {
    auto members = GetLinkGroupMembers(*control->system, hit.groupId);
    if (!members.empty()) {
        control->multiSelection.clear();
        for (auto* m : members) control->multiSelection.insert(m);
        control->selection       = members[0];   // topmost visible by paint order
        control->selectionAnchor = members[0];
        HTREEITEM hi = FindTreeItemByEmitter(hWnd,
            TreeView_GetRoot(hWnd), members[0]);
        if (hi) TreeView_SelectItem(hWnd, hi);
        InvalidateRect(hWnd, NULL, FALSE);
        NotifyParent(control, ELN_SELCHANGED);
    }
    return 0;   // eat the click
}
// Fall through to existing multi-select / marquee dispatch.
```

**2. `WM_MOUSEMOVE` — hover hit-test** (extend the existing branch at [src/UI/EmitterList.cpp:1188](src/UI/EmitterList.cpp:1188), gated to *not* run when marquee is active):

```cpp
if (!control->marqueeActive) {
    POINT pt = { GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam) };
    BracketHit hit = HitTestBracket(control->bracketLayout, pt);
    uint32_t newHover = (hit.kind != BracketHit::None) ? hit.groupId : 0;
    if (newHover != control->hoveredGroupId) {
        uint32_t oldHover = control->hoveredGroupId;
        control->hoveredGroupId = newHover;
        InvalidateGroupRows(control, oldHover);    // each helper InvalidateRects only the affected rows
        InvalidateGroupRows(control, newHover);
    }
    if (!control->mouseTrackingArmed) {
        TRACKMOUSEEVENT tme = { sizeof(tme), TME_LEAVE, hWnd, 0 };
        TrackMouseEvent(&tme);
        control->mouseTrackingArmed = true;
    }
}
// Continue to existing marquee branch.
```

**3. `WM_MOUSELEAVE` / `WM_KILLFOCUS` — clear hover** (new cases; `WM_CAPTURECHANGED` at [src/UI/EmitterList.cpp:1604](src/UI/EmitterList.cpp:1604) extends to also clear hover):

```cpp
case WM_MOUSELEAVE:
case WM_KILLFOCUS:
    if (control->hoveredGroupId != 0) {
        uint32_t old = control->hoveredGroupId;
        control->hoveredGroupId = 0;
        InvalidateGroupRows(control, old);
    }
    control->mouseTrackingArmed = false;
    break;
```

### Cache invalidation triggers

`bracketLayout.valid = false` is set from:

- `WM_SIZE` on the tree (client width changed → reservedMax changed → lane width must recompute). New handler.
- `WM_VSCROLL` / `WM_HSCROLL` on the tree (rows moved → minY/maxY changed). New handler.
- `TVN_ITEMEXPANDED` on the parent (rows added/removed). New `case` in the existing `WM_NOTIFY` switch.
- `EmitterList_Refresh` (system swap, batch add/remove). Existing function; one line to add.
- Any code path that mutates `linkGroup` on any emitter (Link Selected, Dissolve, Add to group, Remove from group). Audit these call sites in `LinkGroup.cpp` and the `NM_RCLICK` menu handlers; add invalidation.

The cost of over-invalidation is one extra layout walk per paint (~50 µs for hundreds of emitters). The cost of under-invalidation is stale-cached clicks landing on wrong groups. **Bias to over-invalidate.**

---

## Risks named up front + mitigations + tripwires

Each risk: what breaks, when, why → code-level mitigation → the verification step that bites if the mitigation regresses.

1. **`CDDS_ITEMPREPAINT` return value gates `CDDS_ITEMPOSTPAINT`.** If MT-8's `CDRF_NEWFONT` return doesn't allow postpaint to fire, multi-selected rows won't get a bracket dot and the bracket *line* will pass through them invisibly.
   - *Mitigation*: change the return at [src/UI/EmitterList.cpp:1882](src/UI/EmitterList.cpp:1882) to `CDRF_NEWFONT | CDRF_NOTIFYPOSTPAINT`. Verify with a debug printf in the postpaint branch before committing.
   - *Tripwire V1*: with two linked emitters both in `multiSelection`, the dot is visible on both rows (not just the unselected siblings). If the dot is missing on selected rows, the prepaint return was wrong.

2. **Tree subclass eats bracket click before tree's selection runs.** The existing `WM_LBUTTONDOWN` path forwards to the default proc after running `UpdateMultiSelectionFromClick` so tree selection bookkeeping stays consistent. Eating the message on bracket-hit skips that.
   - *Mitigation*: when eating, manually run the bookkeeping we're skipping — call `TreeView_SelectItem(hWnd, hi)` to update tree's idea of primary, fire `ELN_SELCHANGED` explicitly. Don't return without doing this.
   - *Tripwire V2*: after clicking a bracket dot for a 3-emitter group, the inspector shows the topmost member's parameters (not blank, not the previous selection). If blank, `ELN_SELCHANGED` wasn't fired.

3. **`HitTestBracket` false positives in row-text area.** If a group's lane index × `laneWidth` is small enough, the dot's `dotX` lands inside a row's text. A user clicking a long emitter name could trigger group-select.
   - *Mitigation*: paint and hit-test only in the right-edge gutter — `dotX = rightEdgeOffset - lane × laneWidth`, where `rightEdgeOffset = clientRect.right - 4`. Tree rows render text starting from `indentX + iconWidth + 2`; with sane tree-client widths (≥ 200 px) and the lane scaling clamped to ≤ `clientWidth / 4`, the bracket area can never overlap text. Add an `assert(dotX > 2 × indentX)` in debug builds to catch pathological narrow trees.
   - *Tripwire V3*: with the tree resized to 200 px wide and 8 active groups (max lanes packed), clicking the right edge of any *visible label text* must select the emitter row, not a group.

4. **`WM_MOUSELEAVE` swallowed during drag-drop capture.** Drag-drop sets capture; `TrackMouseEvent`'s leave message may not fire while another window holds capture. Hover state goes stale.
   - *Mitigation*: clear `hoveredGroupId` in `WM_CAPTURECHANGED` (already handled by the marquee path at [src/UI/EmitterList.cpp:1604](src/UI/EmitterList.cpp:1604); the existing case extends to clear hover too). Also clear at the start of `TVN_BEGINDRAG`. Re-arm `TrackMouseEvent` on next `WM_MOUSEMOVE` (the `mouseTrackingArmed = false` reset handles this).
   - *Tripwire V4*: hover a bracket, start a drag, drop on another row. After release, the *previous* hover tint is no longer painted. If it persists, `WM_CAPTURECHANGED` didn't clear hover.

5. **Layout cache and hit-test diverging when tree scrolls mid-frame.** Paint computed lane layout at scroll position Y; user scrolls before clicking; click hit-tests against now-wrong Y coordinates.
   - *Mitigation*: stamp `scrollOrigin` into the cache at rebuild. `HitTestBracket` checks the stamp against current scroll; if mismatched, return `None` and let the user click again after the next repaint. The lost click is preferable to a wrong-group select.
   - *Tripwire V5*: scroll a group's members out of view via wheel mid-hover (cursor over the dot). The hover tint clears on next paint. If clicking the original cursor position still selects the group, the staleness check didn't bite.

6. **Bracket layout cache invalidation on expand/collapse missed.** Collapsing a parent removes some linked children from the visible set; if cache isn't invalidated, the bracket line still spans the now-invisible Y range.
   - *Mitigation*: hook `TVN_ITEMEXPANDED` to set `valid = false`. Tree control should automatically invalidate its visible area on expand, which triggers paint, which rebuilds. Verify the auto-invalidate happens — if not, also call `InvalidateRect` explicitly.
   - *Tripwire V6*: build a particle system with a parent emitter that has a child in link group X, plus a non-child sibling also in X. Collapse the parent. The bracket now spans only the sibling row (no bracket at all if it's the only visible X member, since `members.size() < 2`).

7. **Palette colours unreadable under user theme.** A user with a dark Windows theme or high-contrast theme sees the custom palette blend in.
   - *Mitigation (default theme)*: the 12 colours in `kBracketPalette` are Tableau-derived and pre-tuned (Tableau hues, luminance-shifted to Material 700/800/900 where raw Tableau failed thin-line contrast on white). Debug build prints each colour's WCAG contrast vs `GetSysColor(COLOR_WINDOW)` at startup; failing any 3:1 threshold is a build-time signal to revisit.
   - *Mitigation (High Contrast theme)*: detect via `SystemParametersInfo(SPI_GETHIGHCONTRAST, ...)`. In HC mode, paint *all* brackets in `COLOR_HIGHLIGHT`. Group identification comes from lane position + the `[L<n>]` prefix in `FormatEmitterDisplayName`. Don't override the user's HC theme with custom RGB.
   - *Tripwire V7a*: under Windows default theme with 12 active groups, all 12 lines distinguishable in a screenshot. *V7b*: under Windows HC "Aquatic" theme, all brackets paint in the system highlight colour; lane positions remain distinguishable; the `[L<n>]` prefix is the canonical group identifier.

8. **Click-to-select-group competes with single-emitter selection.** User clicking just past a bracket dot intending to select an emitter row triggers group-select instead.
   - *Mitigation*: `HitTestBracket` uses `±dotRadius + 2 = ±5 px` slop and only the dot rect; missing a dot falls through to row-click. With `rightEdgeOffset = clientRect.right - 4` and `dotRadius = 3` at 96 DPI, the bracket's effective hit zone is x ∈ `[clientRect.right - 9, clientRect.right - 1]` — strictly the right margin, never label area.
   - *Tripwire V8*: click 1 pixel left of a dot (still in bracket gutter, on the stub) → group select. Click 10 pixels left (in label area) → row select.

9. **Hover repaint thrashing causes scroll-time stutter.** `WM_MOUSEMOVE` fires dozens of times per scroll-wheel tick; if hover hit-test mismatches and invalidates rows each frame, paints amplify.
   - *Mitigation*: hover-state mutation only fires `InvalidateRect` when `newHover != oldHover`. The `if (newHover != control->hoveredGroupId)` branch in §Architecture's WM_MOUSEMOVE block. `TVS_EX_DOUBLEBUFFER` (already on at [src/UI/EmitterList.cpp:1726](src/UI/EmitterList.cpp:1726)) suppresses any flicker that does occur.
   - *Tripwire V9*: hover a dot, then scroll the tree with the wheel. The hover tint should track the dot's new screen position (or clear if dot scrolls off). Frame rate stays smooth — if it stutters, hover is reinvalidating per scroll event.

10. **Greedy interval scheduler producing too many lanes.** A pathological case with N groups all overlapping in Y could need N lanes; if N is large enough, lane width scales to 2 px and the bracket becomes visually unreadable.
    - *Mitigation*: this is acceptable degraded behaviour at the design floor. The 2 px floor still paints; the user has feedback that "too many overlapping groups exist." We do not cap lane count to a small number because doing so would force two groups onto the same lane and they'd visually conflate.
    - *Tripwire V10*: construct a 12-group system where every group has members at the same set of row indices (e.g. groups 1–12 each contain rows 1, 3, 5). Confirm all 12 lanes paint at narrowed widths, all 12 colours distinguishable, no visual conflation.

---

## Verification

Every row says **the regression it catches** (not "the feature works"). Categories ordered from cheapest setup at the top (just paint and look) to costliest at the bottom (composite multi-feature workflows). Within each category, items go cheap → expensive. The bar is *"would a staff engineer accept this as the test suite"* — if reviewing this list, would they ask "what about X?" and find X already covered.

### A. Layout & paint correctness (no interaction)

- **A1.** Empty system (no emitters) → no bracket painted, no crash. *Catches: layout walker crashing on null tree root; div-by-zero in lane sizing when numLanes=0.*
- **A2.** System with 5 unlinked emitters, no groups → no bracket painted, no overhead in repaint. *Catches: paint loop running on `members.size() == 0`; allocating the BracketLayout unnecessarily.*
- **A3.** Single-member "group" (one emitter with `linkGroup = 1`, no other members) → no bracket painted (per design: `members.size() >= 2` gate). *Catches: paint firing on solo-member groups; the gate misplaced.*
- **A4.** Two-member group spread over visible rows → vertical line in lane 0 with dots at both rows, ~5 px horizontal stub pointing leftward toward row text from each dot. *Catches: layout walker not picking up both members; lane assignment returning -1; paint loop skipping the `members.size() == 2` case.*
- **A5.** Three groups, two overlapping in Y, one disjoint below the overlap → overlapping pair in lanes 0 and 1; disjoint group reuses lane 0. Three distinct palette colours, in palette positions 0/1/2 (blue, orange, green). *Catches: greedy scheduler not reusing lanes; `laneEnd[i] < g.minY` off-by-one; palette index drift.*
- **A6.** Sparse membership: group A has members at rows 1, 5, 9; intervening rows are unlinked → bracket line is solid (not dashed) from row 1's dot to row 9's dot; dots only at members, never on rows 2/3/4/6/7/8. *Catches: paint loop drawing dots on intervening rows; line-end clipping to wrong Y; line painted in `CDDS_ITEMPOSTPAINT` per-row instead of once in `CDDS_POSTPAINT`.*
- **A7.** Two non-overlapping groups stacked vertically (group X rows 1–3, group Y rows 5–7) → both in lane 0; visible mid-line gap between maxY of X and minY of Y; colour change at the gap. *Catches: lane reuse not happening for non-overlapping groups; line painted as a single span from minY of X to maxY of Y.*
- **A8.** Stub orientation: horizontal stubs point *from* the lane *toward* the row text (leftward, since bracket is on the right margin). *Catches: stub painted rightward (into nothing), or omitted entirely.*
- **A9.** Dot–line junction: line passes through the dot's centre; line does not have a visible gap at the dot. *Catches: line clipped at dot bounding box instead of dot centre; subpixel rendering artefact.*
- **A10.** 12 concurrent overlapping groups → all 12 lanes painted; lane width visibly narrower than the 2-group case but still ≥ 2 px; each lane uses its expected palette colour (blue/orange/green/red/purple/brown/magenta/teal/olive/indigo/cyan/rose). *Catches: lane sizing not adapting; palette index wrap-around at 12; lane reservation reaching 0 px.*
- **A11.** 13 concurrent overlapping groups → 13 lanes; group 13 reuses group 1's colour (`13 % 12 == 1`). User has lane position to differentiate. *Catches: palette wrap-around using wrong modulus; crash on index 12.*
- **A12.** 25 emitters all in the same one group → single bracket line spanning all 25 rows, 25 dots, single lane. *Catches: layout walker truncating member list; paint loop bailing after some row count.*
- **A13.** Group with members spread across deeply-nested parents (a 5-level-deep child of root A linked with a 5-level-deep child of root B) → bracket Y coordinates correctly sample the visible row centres regardless of indent depth. *Catches: layout using indent X for Y math; mistaking indent depth for visibility.*

### B. Cache invalidation

- **B1.** Build a 2-member bracket, drag the lower member above the upper via reorder → bracket re-paints with correct dot order on next frame. *Catches: reorder pipeline not invalidating cache.*
- **B2.** Build a parent with a child in group X plus a non-child sibling also in X. Collapse the parent → bracket disappears (only 1 visible member, no bracket painted). Re-expand → bracket returns. *Catches: TVN_ITEMEXPANDED not invalidating cache (R6 V6 tripwire).*
- **B3.** Build a bracket spanning 20 rows, scroll the tree by wheel → bracket Y positions track the scroll; dot at row 1 leaves the top of the viewport, dot at row 20 enters from bottom; line follows. *Catches: scroll handler not invalidating cache; scroll-stamp mismatch causing wrong-Y paint.*
- **B4.** Resize the main window to halve the tree width with 8 active groups (lanes packed) → lane width scales down without lane overlap; lane count unchanged. *Catches: WM_SIZE not invalidating cache (R6).*
- **B5.** Two particle systems open. Switch the active system to one with different groups → bracket reflects the new system's groups, not stale state from the previous. *Catches: system-swap not invalidating cache or clearing `hoveredGroupId`.*
- **B6.** Link two emitters via right-click "Link selected" → bracket appears immediately on next paint, no manual refresh needed. *Catches: link-creation pathway not invalidating cache.*
- **B7.** Dissolve a group via right-click "Dissolve link group" → bracket disappears immediately. *Catches: dissolve pathway not invalidating cache.*
- **B8.** Add an unlinked emitter to an existing group via "Add to link group" → bracket extends to include the new row immediately. *Catches: add-to-group pathway not invalidating cache.*
- **B9.** Rename an emitter (F2) → no bracket movement; cache is *not* invalidated (label change doesn't affect Y or membership). *Catches: over-invalidation costing a layout rebuild per keystroke.*
- **B10.** Toggle an emitter's visibility via icon click → no bracket change; cache *not* invalidated. *Catches: over-invalidation on visibility toggle.*
- **B11.** Plain-click an emitter to select it → no bracket change; cache *not* invalidated. *Catches: over-invalidation on selection.*

### C. Hover

- **C1.** Hover a dot → that group's member rows tint with the group colour at ~15% opacity; bracket line thickens from 1 px to 2 px. *Catches: WM_MOUSEMOVE branch not firing; line-thickening branch missing; InvalidateGroupRows not picking up tinted rows.*
- **C2.** Move cursor off → tint and line-thickening clear within one paint (< 50 ms perceived). *Catches: clear path missing; old hover not invalidated when new hover is None.*
- **C3.** Hover line between two dots → same effect as hovering a dot. *Catches: HitTestBracket only matching Dot, not Line.*
- **C4.** Hover dot of group A, slide cursor to dot of group B → only A's rows + B's rows repaint (not the whole tree). *Catches: full-tree invalidation in hover-change path; over-invalidation.*
- **C5.** Hover dot of group A, then immediately to a non-bracket area without exiting the tree → tint on A clears; no new hover. *Catches: stale hover when newHover == 0.*
- **C6.** Hover dot, move cursor out of tree client area → hover clears within one paint. *Catches: WM_MOUSELEAVE not wired; TrackMouseEvent not re-armed (R4).*
- **C7.** Hover dot, Alt-Tab to another window → hover clears via WM_KILLFOCUS. *Catches: WM_KILLFOCUS not wired.*
- **C8.** Hover dot, start drag-drop (drag a different emitter), drop on another row → hover state cleared by WM_CAPTURECHANGED. *Catches: capture-change not clearing hover (R4 V4 tripwire).*
- **C9.** Hover boundary: cursor sitting exactly on the boundary between two adjacent lanes — pixel where lane 0 ends and lane 1 begins → exactly one group hovers (the one whose `dotX` is nearest); doesn't oscillate between the two. *Catches: hit-test ambiguity at lane boundaries; both groups simultaneously hovered.*
- **C10.** Rapid hover sweep — drag cursor across 5 dots in one second without stopping → final hover state matches the last dot's group; no stale tint left behind on any intermediate group. *Catches: paint races; stale tint when WM_MOUSEMOVE delivery falls behind cursor movement.*
- **C11.** Hover a bracket while a modal dialog is open (e.g. "Link selected" confirm) → tree is disabled; no hover should fire. *Catches: WM_MOUSEMOVE on the disabled tree still mutating hover state.*
- **C12.** Hover then scroll the tree by wheel → hover tracks the dot's new screen position if dot stays visible, or clears if dot scrolls out. *Catches: scroll not invalidating hover-relevant cache; hover persisting on now-invisible dot.*

### D. Click-to-select-group

- **D1.** Click a dot → multi-selection becomes the group's full member list; primary = topmost visible member; inspector shows primary's params (not blank). *Catches: HitTestBracket missing; multi-set mutation skipped; ELN_SELCHANGED not fired (R2 V2 tripwire).*
- **D2.** Click a line segment between two dots → same as clicking a dot. *Catches: Line-kind branch in HitTestBracket missing; click handler ignoring Line.*
- **D3.** Click 1 px to the left of a dot (still in stub area) → group select fires. *Catches: hit slop too tight or asymmetric on the stub side.*
- **D4.** Click 10 px left of a dot (in label area) → regular emitter select, NOT group select. *Catches: false-positive in row-text area (R3 V3 tripwire).*
- **D5.** Resize the tree to 200 px width with 8 packed lanes. Click the right edge of the longest visible label → emitter select, not group select. *Catches: lane scaling allowing brackets to bleed into label area (R3 V3 tripwire).*
- **D6.** Scroll the tree mid-frame (by wheel between paint and click) → click harmlessly does nothing (or selects whichever emitter is now at that screen Y); does NOT select a stale group. *Catches: scroll-stamp staleness check not biting (R5 V5 tripwire).*
- **D7.** Click a bracket of a group that contains the currently-selected emitter → multi-set expands to all members; primary unchanged. *Catches: click handler clearing the primary unnecessarily.*
- **D8.** Click a bracket twice in succession (same group) → second click is idempotent; multi-set unchanged after the second click. *Catches: handler mutating state on every call without checking current state; flicker if InvalidateRect fires redundantly.*
- **D9.** Click a bracket dot that's at the topmost row of the visible viewport (no upper stub space) → group select fires correctly; no clipping artefacts. *Catches: dot at viewport boundary failing hit-test due to clipped paint vs. logical layout.*
- **D10.** Click a bracket of a group whose members are scrolled partially out of view (top member scrolled above viewport) → primary becomes the topmost *visible* member (per design), not the absolute-topmost member that's scrolled away. *Catches: `members[0]` ordering using absolute order instead of visible order.*

### E. Interaction with MT-8 multi-select

- **E1.** Build a 3-member bracket. Click an unrelated emitter outside the group → multi-set becomes `{clicked}`, bracket painting unchanged (still anchored to `linkGroup`, not multi-set). *Catches: bracket painting branched off multi-set instead of linkGroup.*
- **E2.** Ctrl-click two emitters from the same group (manually building a multi-set of 2 of 3 members) → bracket painted, but the *third* member's row is NOT secondary-highlighted. Click the bracket line → multi-set expands to all three; the third member's row picks up the MT-8 highlight. *Catches: bracket-click not respecting `GetLinkGroupMembers`; multi-select highlight not extending after group-select.*
- **E3.** Multi-select two unlinked emitters via marquee, hover the bracket of an *unrelated* third group → multi-set unchanged (hover is read-only). Hover tint paints on the unrelated group's rows on top of the existing MT-8 highlight on the original two. *Catches: hover mutating multi-set; hover tint hiding MT-8 highlight.*
- **E4.** Marquee-drag across rows that include a linked emitter → multi-select gathers them; bracket painting on the group is unchanged. *Catches: bracket painting depending on multi-set state.*
- **E5.** Bracket-select a 3-member group, then Shift-click the next unlinked emitter below → range-select from anchor (per MT-8 Shift semantics) replaces multi-set with the range. Bracket on the original group remains painted (still linked). *Catches: Shift-click misbehaving when anchor was set by bracket-click; bracket-painting depending on multi-set.*
- **E6.** Bracket-select a 3-member group, then arrow-key down → multi-set replaces with `{newPrimary}` per MT-8 keyboard nav semantics. Bracket remains painted (still linked). *Catches: arrow-key nav clearing bracket painting; keyboard nav not clearing multi-set.*
- **E7.** Bracket-select a 3-member group, then drag-reorder the primary → primary moves; multi-set is untouched per MT-8 design. Bracket re-lays out post-drop (cache invalidation). *Catches: drag-reorder operating on multi-set instead of primary; cache not invalidated post-drop.*

### F. Degenerate / boundary states

- **F1.** Tree with width = 0 (theoretical / window minimised before first paint) → no crash; no paint. *Catches: div-by-zero in `reservedMax = clientWidth / 4`; layout walker accessing negative dimensions.*
- **F2.** Tree with width < 50 px (extreme narrow drag) → lane width clamps to 2 px floor; paint still runs; no overlap of paint with row text (label area shrinks to ~0 but render doesn't crash). *Catches: lane floor not enforced; integer underflow.*
- **F3.** A single linked group of 100 members, all visible → bracket paints with 100 dots and one tall vertical line; no perf cliff or stack-overflow from the layout walker. *Catches: O(n²) interval scheduler; recursive walk blowing stack on tall trees.*
- **F4.** 100 active link groups, all 2-member, all overlapping in Y → lane count = 100; lane width = floor (2 px); paint runs; user sees a "barcode" right margin. *Catches: lane data structure not sized to handle large numLanes; greedy scheduler scaling badly.*
- **F5.** Bracket painted while tree is in a "no items" state (e.g. brand-new system created via File→New) → no crash; bracket cache is cleared/never built. *Catches: paint code accessing emitter pointers after a system reset.*
- **F6.** Click within the bracket gutter X range, but on an empty row area (below the last emitter) → no group select, no crash. *Catches: click-handler hit-test not bounds-checking against the last row.*
- **F7.** Click within bracket gutter at a Y inside a group's `[minY, maxY]` span but on a row that's NOT a member of that group (a non-linked row between members) → group select fires (line hit), per design. *Catches: HitTestBracket distinguishing Line wrongly.*

### G. Performance & rendering

Target: paint stays under one VSync interval (16 ms) under normal conditions. Bracket layout walk is dominated by `TreeView_GetItemRect` calls, which are cheap (cached by the tree control) — should not move the needle.

- **G1.** Cold paint of a system with 200 emitters, 20 groups → first paint completes in < 50 ms (acceptable startup cost). *Catches: O(n²) blowup in layout walker; pathological palette computation.*
- **G2.** Steady-state repaint during cursor hover sweep at 60 fps → repaint stays under 16 ms per frame even when hover transitions invalidate 2 groups per frame. *Catches: full-tree invalidation in hover; layout rebuild firing on every WM_MOUSEMOVE.*
- **G3.** Scroll a 200-emitter tree by wheel for 5 seconds continuously → frame rate stays steady; no visible flicker; bracket follows scroll smoothly. *Catches: scroll-stamp invalidation causing repeated rebuilds; cache thrashing.*
- **G4.** Memory: bracket layout cache size with 100 groups × 10 members each → expected footprint ~50 KB (each member is two ints + a pointer). No leak across system swaps (verify with a baseline RSS snapshot before/after 100 system-swap cycles). *Catches: cache not freed on system swap; vector reserves growing unboundedly.*

### H. Theme & DPI

App is System-DPI-aware (no manifest, no `WM_DPICHANGED` handler). HiDPI verification only needs app launch at the target DPI, not mid-session change.

- **H1.** Launch app at Windows 100% scaling → dot radius ~3 px, lane width ~6 px, stub ~5 px. *Catches: hardcoded pixel constants; DPI multiplier inverted.*
- **H2.** Launch app at Windows 175% scaling → dot radius ~5 px, lane width ~11 px, stub ~9 px. Visibly larger than 100% baseline. *Catches: DPI multiplier not applied to any of dot/lane/stub/stroke; mixed scaled+unscaled values.*
- **H3.** Launch app at Windows 100% with default theme + 12 active groups → all 12 palette colours visibly distinct; debug-build contrast printer reports ≥ 3:1 for each entry against `COLOR_WINDOW`. *Catches: palette regression introducing a sub-threshold colour; palette wrap-around using wrong index.*
- **H4.** Switch Windows to High Contrast "Aquatic" theme while app is running → on next paint, all brackets render in `GetSysColor(COLOR_HIGHLIGHT)`; palette colours are not used. *Catches: HC detection missing; `WM_THEMECHANGED` not invalidating bracket layout cache.*
- **H5.** Switch HC theme back to default → brackets return to palette colours. *Catches: one-way HC detection; cache not refreshed on theme-revert.*
- **H6.** Launch app under HC theme (start with it active) → first paint already in HC mode; brackets in `COLOR_HIGHLIGHT`. *Catches: HC detection only firing on the transition, not on startup.*

### I. MT-7 link-group mutation interaction

These exercise the bracket as side-effect of operations the user performs on linked groups via the existing MT-7 menu items.

- **I1.** Right-click a single linked emitter → "Dissolve link group" → bracket disappears on next paint. *Catches: dissolve not invalidating cache (B7).*
- **I2.** Right-click an unlinked emitter → "Add to link group → N" → bracket extends to include the row. *Catches: add not invalidating cache (B8).*
- **I3.** Right-click a linked emitter → "Remove from link group" → bracket shortens; if the group is now < 2 members, bracket disappears entirely. *Catches: remove not invalidating cache; group-of-1 still painting.*
- **I4.** Edit a propagating parameter on a member of a 5-member group (MT-7 propagation fires) → bracket and palette unchanged; no flicker. *Catches: MT-7 propagation triggering bracket repaint; cache invalidated needlessly.*
- **I5.** Confirm-overwrite dialog from MT-7 (when linking emitters with diverging params) shown and accepted → bracket appears on next paint; cache rebuilt with new group. *Catches: dialog blocking propagation also blocking bracket update.*
- **I6.** Confirm-overwrite dialog cancelled (user picks Cancel) → no group created; no bracket. *Catches: cache invalidated speculatively before the operation succeeded.*

### J. Undo / redo

Undo state interactions with bracket layout cache.

- **J1.** Link two emitters → undo → bracket disappears. Redo → bracket reappears. *Catches: undo not invalidating cache; redo using stale post-undo state.*
- **J2.** Dissolve a group → undo → bracket reappears with all original members. *Catches: undo restoring `linkGroup` field but cache not rebuilt.*
- **J3.** Hover-select a group, then trigger undo of an *unrelated* operation (e.g. an emitter rename) → bracket painting unchanged; hover preserved. *Catches: every undo invalidating bracket cache.*
- **J4.** Bracket-select a group, then undo deleting one of its members → multi-set should update to include the restored emitter (or not — see Open Q below); bracket extends. *Catches: undo restoring an emitter that's in a stale multi-set with dangling pointer.* **Note: open Q5.**

### N. File / particle-system operations

- **N1.** File → New → empty system → no bracket painted. *Catches: stale cache from previous system.*
- **N2.** File → Open a .alo with link groups → brackets paint on first display of the loaded system. *Catches: cache not invalidated on file load.*
- **N3.** File → Save → no UI change; bracket painting continues unaffected. *Catches: save triggering a tree refresh that drops the cache.*
- **N4.** Save a .alo, close, re-open → brackets match pre-save state (linkGroup field is persisted in the `0x0100` chunk; bracket follows). *Catches: not strictly an MT-9 test — verifies MT-7 file format integration. But the user will hit this together with MT-9, so worth confirming.*
- **N5.** Open two .alo files in sequence (system swap) → brackets refresh to the new system on the swap. *Catches: cache not invalidated on system swap (B5).*

### W. Window state & focus

- **W1.** Minimise the window with brackets visible → restore → brackets paint correctly. *Catches: cache invalidated to garbage during minimise; paint queue dropping.*
- **W2.** Alt-Tab away from the editor → return → brackets paint correctly; no stale hover. *Catches: hover not cleared on focus loss (C7).*
- **W3.** Drag the window across two monitors (System-DPI app: OS bitmap-scales, no `WM_DPICHANGED` to handle) → brackets visually scale via OS; no per-monitor paint logic needed. *Catches: System-DPI assumption wrong; some monitor-DPI code path that wasn't expected.*
- **W4.** Resize the window with brackets visible — slow drag of the right edge → brackets re-lay out continuously; no flicker; tree client width tracks correctly. *Catches: WM_SIZE not invalidating; live-resize repaint too slow.*
- **W5.** Maximise the window → brackets re-lay out to wider tree; lane reservation grows back to base size. *Catches: lane sizing locked to initial width.*

### M. Modal dialog & context menu

- **M1.** Open a right-click context menu on an emitter → tree is technically still painted (menu is a separate window); brackets paint unchanged. *Catches: context menu suppressing tree paint.*
- **M2.** Open "Link selected" confirm dialog → tree is disabled; hover should NOT fire on the tree; brackets keep painting in their last state. *Catches: hover firing through disabled state (C11); paint loop blocked by modal pump.*
- **M3.** Close the dialog by clicking OK → tree re-enabled; brackets re-paint with new group included. *Catches: paint not resumed after dialog dismissal.*
- **M4.** Cancel the dialog → no group change; brackets unchanged. *Catches: cancel still mutating cache.*
- **M5.** Open File → Open dialog → close it without selecting a file → return to editor; brackets paint unchanged. *Catches: cache invalidated by non-mutating modal dismissal.*

### R. Drag-drop and reorder interaction

- **R1.** Drag-reorder a bracketed emitter to a new position → drop completes; bracket re-lays out reflecting the new Y order. *Catches: drag pipeline not invalidating cache (B1).*
- **R2.** Start a drag from an unlinked emitter, cursor moves *over a bracket* during the drag → bracket painting unchanged; no hover triggered (we're in drag mode); no group-select (we're not in a click). *Catches: WM_MOUSEMOVE during drag firing hover; drag-drop hit-test confused by bracket geometry.*
- **R3.** Marquee-drag from empty space, sweep over a bracket and emitter rows → marquee builds multi-set from rows; bracket painting unchanged. *Catches: marquee path triggering bracket hover; bracket hit-test eating the marquee start.*
- **R4.** Drag-reorder a member of a 5-group across to a position above the topmost member → bracket extends upward; topmost dot now at the new top. *Catches: layout walker not picking up the moved row's new position.*
- **R5.** Cancel a drag by pressing Esc → drop reverted; bracket lays out reflecting *original* positions; no half-state. *Catches: cache invalidated speculatively during drag, then not re-invalidated on cancel.*

### X. Composite / exploratory scenarios

End-to-end "real workflow" scenarios that exercise multiple features together. Each catches *whatever combination of regressions* is most likely to slip past category tests above.

- **X1.** *Build the demo system from scratch.* Create 8 emitters. Multi-select 3 via Ctrl-click, "Link selected". Marquee-select the next 3, "Link selected" (new group). Click on group 1's bracket to select all members. Verify primary is the topmost group-1 member; inspector shows its params. Change one of group 1's params; MT-7 propagates to all 3 members; bracket painting unchanged. Save the file. Reopen — brackets should match pre-save state.
- **X2.** *Stress the cache.* Open a system with 6 link groups. Resize the window 20 times rapidly. Scroll up and down the tree. Open and close 3 right-click menus. Hover several different brackets. Multi-select via Ctrl-click. Final state: all brackets correctly painted; no leaks (compare RSS to baseline); no stale hover.
- **X3.** *HC theme switch mid-workflow.* Build a 3-group system in default theme. Hover a bracket. Switch Windows to HC mode via Win+U → High Contrast → On. Verify all brackets immediately switch to highlight colour; hover continues to work (just in HC colour). Switch HC off. Verify return to palette.
- **X4.** *Refusal paths combined.* Build a 4-member group. Click the bracket → all 4 selected. Right-click → "Dissolve link group" → confirm. Bracket disappears. Press Ctrl-Z → group restored; bracket reappears; multi-set is in some state (open Q5 covers what state). Press Ctrl-Y → group gone again.
- **X5.** *Many-group system from real data.* Open a particle system with ~30 emitters and ~8 link groups (a real EaW asset if available; otherwise build it). Scroll, hover, click, link, unlink. Confirm no visual glitches, no performance cliffs, no inspector mismatches.

### Debug instrumentation

Under `#ifndef NDEBUG`, these tags appear during normal use and can be greped to spot misbehaviour. The set is intentionally small — too many tags drown the log.

- `[Link] layout groups=N lanes=M visibleLinkedEmitters=K` — fires on each layout rebuild. If N or M is wildly wrong (e.g. groups > number of `linkGroup != 0` emitters), the walker is reading wrong state. If layout rebuild fires on every paint when nothing relevant changed, cache invalidation is too aggressive.
- `[Link] hover group=N (was M)` — fires on hover transitions. If it fires per WM_MOUSEMOVE (not per transition), the `if (newHover != oldHover)` gate is broken.
- `[Link] click select group=N members=M anchor=<name>` — fires on group-select click. `M` should match `GetLinkGroupMembers(...).size()`.
- `[Link] palette contrast: i=N rgb=#RRGGBB ratio=R.RR` — startup-only. Fires once for each of the 12 palette entries; threshold gate is 3.0:1 against `COLOR_WINDOW`. Below-threshold prints with a `LOW_CONTRAST` warning.
- `[Link] HC mode active=true|false` — fires on startup and on `WM_THEMECHANGED` / `WM_SETTINGCHANGE`. Confirms HC detection is firing.

These tags use the `[Link]` prefix — shared with MT-7's existing instrumentation — so a single grep covers all link-group work.

## Implementation order (test-as-you-go)

Order the implementation so test categories can pass milestone-by-milestone, surfacing regressions early.

1. **State + cache + layout** (no paint yet): add `BracketLayout`, `RebuildBracketLayout`, palette array, debug contrast printer. Verify A1, A2 ("no crash on empty/no-linked systems"); H1, H3 ("palette contrast logged at startup"). **Commit boundary.**
2. **Paint at `CDDS_ITEMPOSTPAINT` + `CDDS_POSTPAINT`** (no hover, no click): bracket renders. Verify A3–A13, B1–B11, F1–F7, G1, G4. **Commit boundary.**
3. **Hover state + `WM_MOUSEMOVE` + `WM_MOUSELEAVE` + `WM_KILLFOCUS` + `WM_CAPTURECHANGED`**: hover tints fire. Verify C1–C12, G2. **Commit boundary.**
4. **Click intercept in `WM_LBUTTONDOWN`**: group-select fires. Verify D1–D10, E1–E7. **Commit boundary.**
5. **MT-7 / MT-10 / file / undo / window / drag integration**: hook cache invalidation everywhere it's needed. Verify I, J, N, R, W, M categories. **Commit boundary.**
6. **HC theme detection + `WM_THEMECHANGED` / `WM_SETTINGCHANGE`**: HC mode works. Verify H4–H6. **Commit boundary.**
7. **Composite scenarios** as a final pre-PR sweep. X1–X5. **Squash to single MT-9 commit on the feature branch before merge.**

If any milestone's tests fail, **stop and fix before proceeding**. The cost of layering on top of a broken foundation is much higher than fixing in-tier.

---

## Delivery shape

- **Branch**: `feat/mt9-link-bracket` off `master`.
- **Files touched**: [src/UI/EmitterList.cpp](src/UI/EmitterList.cpp) (sole code file). Expected delta: ~250–350 lines added (struct fields ~15, palette ~15, layout builder ~50, hit-test ~25, postpaint paint ~40, WM_MOUSEMOVE hover ~25, WM_MOUSELEAVE/KILLFOCUS/CAPTURECHANGED clear ~20, WM_LBUTTONDOWN bracket intercept ~25, cache-invalidation hooks ~30, debug printfs ~15).
- **No file format changes**, no new resource IDs.
- **Single PR.** The phases (state, paint, hover, click) are tractable to review as one diff because they're co-located and share `BracketLayout`. Splitting into 4 PRs would make each leaf reviewer-incomprehensible without the others.
- **ROADMAP / CHANGELOG** updates per repo convention in [CLAUDE.md](../CLAUDE.md): strikethrough the `[MT-9]` entry in ROADMAP.md §2, move to §5, renumber surrounding items; CHANGELOG entry covering what ships + how-we-tackled-it (the layout cache pattern is the architecturally interesting bit) + issues encountered (likely: prepaint→postpaint return value, hit-test staleness handling, palette tuning for high-contrast).

---

## Open questions for the user

**All resolved (2026-05-13). Plan locked. Proceeding to implementation per §Implementation order.**

- ✅ Palette → Tableau-derived 12-colour palette baked into [Architecture §Palette](#palette). First 6 entries ordered for max perceptual distance.
- ✅ High Contrast theme → all brackets paint in `COLOR_HIGHLIGHT`; lane position + `[L<n>]` prefix carry group identity. Don't override user theme with custom RGB.
- ✅ Bracket side → right margin. *Reason: simpler X math; avoids fighting tree's built-in indent guides; `[L<n>]` prefix already carries the at-a-glance group ID in the label area.*
- ✅ Hover tint opacity → 15%. *Reason: hover already has two cues (tint + line-thickening); subtle tint keeps line-thickening as the primary visual signal.*
- ✅ Click semantics → eat + manual. *Reason: matches MT-8's existing pattern; forwarding risks `TVHT_ONITEMRIGHT` selecting the wrong row.*
- ✅ Q1 Modifier-clicks → Ctrl = union (toggle group membership in/out of multi-set); Shift + Alt = treat as plain click.
- ✅ Q2 Right-click on bracket → row passthrough (default NM_RCLICK on row whose centre Y is closest); no new menu authoring.
- ✅ Q3 Double-click on bracket → same as single-click for now; MT-10 can repurpose to open group settings.
- ✅ Q4 Delete with bracket-selection → fix `EmitterList_DeleteEmitter` in the MT-9 PR to iterate `multiSelection` instead of just `selection`. Adds ~2 hr to the plan; closes a visible MT-8 gap.
- ✅ Q5 Multi-set after undo of deleted members → leave multi-set empty; user re-selects. Avoids dangling-pointer hazards in the undo stack.
- ✅ Q6 Bracket during drag-drop → frozen (pre-drag layout continues to render; cache invalidates on drop). Escalate to "hidden during drag" only if testing shows the frozen state looks broken.

### Scope addition from Q4

The MT-9 PR will now also touch [src/UI/EmitterList.cpp:3121](src/UI/EmitterList.cpp:3121) (`EmitterList_DeleteEmitter`) to iterate `multiSelection` rather than acting only on `selection`. This is functionally an MT-8 follow-up but ships with MT-9 because bracket-select makes it the most visible gap. Test additions (insert into §J Undo / redo and §D Click-to-select-group):

- **D11.** Bracket-select a 3-member group → press Delete → all 3 emitters deleted; multi-set empty; tree shortens. *Catches: Delete still operating on `selection` alone after the fix.*
- **D12.** Bracket-select a 3-member group → press Delete → Ctrl-Z (undo) → all 3 restored; multi-set is **empty** (per Q5); user must re-select to bracket-pick again. *Catches: undo restoring multi-set state (against design); restored emitters being unselectable.*
- **D13.** Multi-select 2 unlinked + 1 linked emitter via Ctrl-click → press Delete → all 3 deleted (mixed-state multi-set, not just group members). *Catches: Q4 fix being scoped to linked emitters only.*

(Old text below preserved for historical reference of the unresolved-question form. Skip past it.)

### Q1. Modifier-clicks on a bracket — semantics?

Plain click is settled: replace multi-set with group members. But what about Ctrl/Shift/Alt-click on a bracket?

| Modifier | Option A (group-augmented) | Option B (group-aware extension) | Option C (passthrough) |
|---|---|---|---|
| **Ctrl + bracket-click** | Toggle: if all group members in multi-set, remove them; else add them | Union: add group members to existing multi-set (don't remove if already in) | Treat as plain click (replace) — ignore Ctrl |
| **Shift + bracket-click** | Range from anchor to topmost group member (then add group members) | Replace with group members + extend anchor to topmost | Treat as plain click — ignore Shift |
| **Alt + bracket-click** | Reserved — no behaviour | Reserved — no behaviour | Treat as plain click |

My recommendation: **Option A (group-augmented)** for Ctrl, **Option C (treat as plain)** for Shift and Alt. Reason: Ctrl-click being toggle-style mirrors how multi-select Ctrl-click works for individual rows — it's the user's "I want to compose this group into a larger set" gesture. Shift-click semantics get confusing with groups (anchor + group = what range?); cleaner to make Shift behave like plain click on brackets. Alt is unbound today.

### Q2. Right-click on a bracket — what menu?

The bracket gutter is right-clickable. Three options:

| | Option A (group menu) | Option B (row passthrough) | Option C (no menu) |
|---|---|---|---|
| **What shows** | Group-specific menu: "Dissolve link group", "Add to link group", future MT-10 "Group settings…" | Default `NM_RCLICK` row menu, anchored on the row whose centre Y is closest | No menu at all; right-click on bracket is a no-op |
| **Multi-set side effect** | None (read-only) | Per MT-8: right-click outside multi-set replaces it with the clicked row | Untouched |
| **Pro** | Discoverable; bracket is a natural anchor for group ops | Consistent with current behaviour; zero new menu code | Lowest surface area; no risk of menu confusion |
| **Con** | Need to author a new menu; duplicates existing right-click-on-member-row entries | Bracket loses an obvious right-click affordance the user might expect | Bracket is a one-trick affordance — left-click only |

My recommendation: **Option B (row passthrough)**. Reason: MT-7 already exposes Dissolve/Add/Remove on every member row's right-click menu; duplicating those on the bracket adds menu authoring + maintenance burden for marginal value. Right-clicking a bracket then conceptually right-clicks "a row of the group" — the user gets the same menu they would have from any group member.

### Q3. Double-click on a bracket — same as single-click, or a different gesture?

The bracket affords a few possible double-click gestures:
- **Same as single-click** (idempotent re-select).
- **Open MT-10 group settings dialog** (when MT-10 ships).
- **Toggle expansion of all parent emitters containing group members** (utility for finding hidden members in a collapsed-parent tree).
- **Eat double-click** (no behaviour).

My recommendation: **same as single-click** for now. Reason: double-click is conventionally "open / drill in" on UI, but we don't have a drill-in target until MT-10 lands. Treating double-click as `single + single` is the safe default; MT-10 can repurpose it.

### Q4. Delete key with a bracket-selected group — what happens?

Today (MT-8 reality): `EmitterList_DeleteEmitter` at [src/UI/EmitterList.cpp:3121](src/UI/EmitterList.cpp:3121) deletes only `control->selection` (the primary), regardless of multi-set size. So a 5-member bracket-select followed by Delete kills only the primary; the other 4 stay multi-selected.

This is an MT-8 gap, not an MT-9 regression. But bracket-click → Delete is a very natural workflow ("select the group, kill it"), and the broken-feeling result will be noticed immediately by anyone testing MT-9. Three options:

| | Option A (status quo) | Option B (fix in MT-9 PR) | Option C (block + warn) |
|---|---|---|---|
| **Behaviour** | Delete kills primary; multi-set survives | Delete kills every member of multi-set; multi-set clears | Delete kills primary; show a status-bar notice "Delete operates on the primary emitter only" |
| **Scope** | Zero MT-9 work | 1–2 hr addition to MT-9 (find `EmitterList_DeleteEmitter`, iterate, watch undo) | Same as A, plus a notification surface |
| **Risk** | User confusion; bug visible in every MT-9 demo | Multi-emitter delete touches undo, file dirty state, possibly the selected-emitter pump in main.cpp — non-trivial test surface | Same as A; the notification might also bug users for whom A is fine |

My recommendation: **Option B (fix in MT-9 PR)** if you're OK expanding MT-9's scope by a couple hours. Otherwise file as a follow-on ticket and call out the gap in the MT-9 PR description. Either is defensible; B makes for a more polished demo.

### Q5. Undo restores a deleted emitter that was in a stale multi-set — what state?

This is an existing MT-8 / undo-stack interaction question that bracket-select makes more salient.

Scenario: user bracket-selects a 5-member group → presses Delete (assuming Q4-B, all 5 deleted) → presses Ctrl-Z (undo).

- **Option A**: undo restores the 5 emitters AND the multi-set is also restored (multi-set was captured in the undo state).
- **Option B**: undo restores the 5 emitters; multi-set is empty (the undo doesn't track UI state).
- **Option C**: undo restores; multi-set holds the restored emitters as-if they were freshly selected.

My recommendation: **Option B (multi-set empty after undo)** unless multi-set persistence in the undo stack is already there. Reason: keeping UI selection state in the undo stack is a separate, non-trivial design decision. Default behaviour of "undo restores data, user re-selects" matches most editors and avoids dangling-pointer hazards.

### Q6. Bracket painting during an active drag-drop — frozen, live, or hidden?

When the user mid-drags an emitter that's a group member, the dragged row's Y position is "in flight." How does the bracket render?

- **Option A (frozen)**: bracket continues to render the pre-drag layout. After drop, cache invalidates, bracket follows. *Simplest. Bracket may briefly point at a now-wrong Y for the dragged member.*
- **Option B (live recompute)**: every drag-move, recompute layout using the tentative drop position. *Highest visual quality. Thrashes the cache.*
- **Option C (hidden)**: while drag is active and the dragged emitter is a group member, hide that emitter's group's bracket entirely. Restore on drop. *Cleanest visually. Requires drag-aware cache logic.*

My recommendation: **Option A (frozen)**. Reason: drag-drop reorder is a brief gesture (≤ 1 second typical); the brief visual mismatch is tolerable; complexity of B/C is hard to justify. If user testing shows it looks broken, escalate to C as a follow-on tweak.

---

# [MT-10] Configurable exempt set per link group — follow-on

**Pointer**, not a full plan. MT-10 plan was previously written in this file; it has been moved into git history (see prior `tasks/todo.md` content via `git log`). When MT-9 lands, reopen MT-10 as a fresh top-level plan in this file using the same ALO conventions:

- Context: MT-7 hard-codes 4 exempt fields; MT-10 makes per-group exempts user-toggleable. UI dialog + file-format chunk + dialog disagreement-resolver.
- Files touched: [src/LinkGroup.cpp](src/LinkGroup.cpp), [src/LinkGroup.h](src/LinkGroup.h), [src/ParticleSystem.cpp](src/ParticleSystem.cpp), [src/UI/EmitterList.cpp](src/UI/EmitterList.cpp) (menu wire-up), new dialog resource in both `.en.rc` and `.de.rc`, new `0x0901` system chunk.
- Estimated ★★★ / 6–10h. Independent of MT-9 but lower priority — v1 exempts cover the user's stated use case.

---

# Review

Per [CLAUDE.md](../CLAUDE.md) "Plan mode → append a review section to the same `todo.md`."

## What landed (per milestone)

All six implementation milestones from the plan's §Implementation order are complete. The Debug x64 build is clean across every milestone.

| # | Milestone | Files touched | Status |
|---|---|---|---|
| 1 | State + cache + layout walker + palette + debug contrast printer | [src/UI/EmitterList.cpp](src/UI/EmitterList.cpp) | ✅ |
| 2 | Paint bracket at `CDDS_POSTPAINT` (lane line + per-member dots + stubs) | [src/UI/EmitterList.cpp](src/UI/EmitterList.cpp) | ✅ |
| 3 | Hover state + 15% alpha tint + line-thicken; `WM_MOUSELEAVE`/`WM_KILLFOCUS`/`WM_CAPTURECHANGED` clear paths | [src/UI/EmitterList.cpp](src/UI/EmitterList.cpp) | ✅ |
| 4 | Click intercept in `WM_LBUTTONDOWN` for bracket dot/line hits; Ctrl-click = union, plain/Shift/Alt = replace | [src/UI/EmitterList.cpp](src/UI/EmitterList.cpp) | ✅ |
| 5 | High-Contrast theme detection + `WM_THEMECHANGED` / `WM_SETTINGCHANGE(SPI_SETHIGHCONTRAST)` handling | [src/UI/EmitterList.cpp](src/UI/EmitterList.cpp) | ✅ |
| 6 (Q4 scope) | `EmitterList_DeleteEmitter` iterates `multiSelection` (closes a pre-existing MT-8 gap) | [src/UI/EmitterList.cpp](src/UI/EmitterList.cpp) | ✅ |

ROADMAP and CHANGELOG also updated per the [CLAUDE.md](../CLAUDE.md) "Roadmap items ship" convention: new `5.1 [MT-9]` entry added to [§5 Shipped](../ROADMAP.md), existing shipped entries renumbered 5.2..5.15, and a new top-of-changelog entry authored in [CHANGELOG.md](../CHANGELOG.md). PR number + merge hash backfill TODOs are flagged in both files.

## Architectural decisions worth remembering

1. **Always-rebuild the bracket layout at `CDDS_PREPAINT`.** Original plan had `bracketLayout.valid` gated invalidation via every mutation path (system swap, link/dissolve/add/remove, expand/collapse, scroll, resize, theme). Switched mid-implementation to "always rebuild." Walk is < 1 ms for realistic systems; sidesteps an entire bug class. The `valid` flag stays in the struct as a future-optimization seat.

2. **Bracket painting belongs in `CDDS_POSTPAINT`, not per-row.** Original plan had dots in `CDDS_ITEMPOSTPAINT` and lines in `CDDS_POSTPAINT`. Consolidating everything in `CDDS_POSTPAINT` lets the line paint UNDER the dots (paint lines first, then dots on top) without per-row `CDRF_NOTIFYPOSTPAINT` returns just for non-hover rows.

3. **`CDDS_ITEMPOSTPAINT` is still used — but only for hover tint.** Hover-row alpha-blend needs a per-row paint hook, gated by `CDRF_NOTIFYPOSTPAINT` returned from `CDDS_ITEMPREPAINT` when the row is a hovered-group member. The bitwise return `CDRF_NEWFONT | CDRF_NOTIFYPOSTPAINT` stacks multi-select highlight + hover tint correctly.

4. **`AlphaBlend` over manual blend.** Hover tint over a multi-select-highlighted row needed to blend against `COLOR_HIGHLIGHT`, not `COLOR_WINDOW`. Manual precomputed-blend palette wouldn't handle this. `#pragma comment(lib, "msimg32.lib")` keeps the project's `.vcxproj` unchanged.

5. **Q4's `EmitterList_DeleteEmitter` fix is a multi-set iteration over a snapshot with `std::find` against the live emitter list per iteration.** Tolerates `ParticleSystem::deleteEmitter`'s recursive child cascade without dangling-pointer hazards.

6. **HC theme is checked every paint** via `IsHighContrastActive()` inside `RebuildBracketLayout`. `WM_THEMECHANGED` and `WM_SETTINGCHANGE(SPI_SETHIGHCONTRAST)` just invalidate the tree to force the next paint; the layout walker picks up the change.

## What needs interactive verification

The build is clean and the logic was inspected against the plan section by section, but **none of the runtime behaviour has been exercised live**. The user needs to run the editor and walk through §Verification's categories A–X — particularly the ones that are visual or interaction-sensitive:

- **A. Layout & paint correctness**: open a system with link groups, confirm brackets paint as described (right margin, lane allocation, colours).
- **C. Hover**: hover dots and lines, confirm tint + line-thickening; move cursor out, confirm clear; Alt-Tab away and back.
- **D. Click**: click dots and lines; click 10 px left of a dot (should NOT trigger group select); Ctrl-click to union with existing multi-set.
- **H. Theme**: switch to/from High Contrast theme via Win+U, confirm brackets switch to `COLOR_HIGHLIGHT` and back.
- **The debug palette contrast log** (printed to the AllocConsole window at first emitter list creation, under `#ifndef NDEBUG`). All 12 entries should print `OK`. Any `LOW_CONTRAST` entry needs investigation.

The composite scenarios X1–X5 are the right pre-merge sweep — they exercise the cross-feature interactions that single-category tests don't catch.

## Known gaps + deviations from the plan

- **R4 (drag-drop hover clear)**: relies on `WM_CAPTURECHANGED` clearing hover. The existing marquee path already handles this case; I extended the existing `WM_CAPTURECHANGED` to also `ClearBracketHover`. Drag-drop reorders go through different capture, but the capture-change message fires the same way. **Verify in interactive testing C8 / R2**.
- **Q6 (bracket during drag-drop)**: frozen-during-drag per the plan. Since cache rebuilds every paint (and drag's `WM_MOUSEMOVE` triggers paints via marquee invalidation but not for non-marquee drag), the bracket may either follow the drag's ghost or stay frozen. **Verify R1 / R4 live.**
- **Composite tests X1–X5**: not yet exercised. These are the highest-value pre-merge checks.
- **MT-7 mutation invalidation (I1–I6)**: the always-rebuild approach makes these "just work" — but the bracket should appear / disappear correctly after every link / dissolve / add / remove. **Verify live.**

## Open follow-on tasks (not blocking MT-9 merge)

- **MT-10** (per-group configurable exempt set) — pointer at [§MT-10 follow-on](#mt-10-configurable-exempt-set-per-link-group--follow-on). Independent of MT-9; can ship next.
- **Backfill PR number + merge hash** in [ROADMAP.md §5.1](../ROADMAP.md) and the [CHANGELOG.md](../CHANGELOG.md) MT-9 entry once the PR merges to master. See PR [#27](https://github.com/DrKnickers/people-particle-editor/pull/27) for prior art on the backfill flow.
- **`Actual:` line in ROADMAP** also needs backfill (currently `TODO`).

## Files touched in this PR

- [src/UI/EmitterList.cpp](src/UI/EmitterList.cpp) — sole code file. +~600 lines (struct + helpers + palette + layout walker + hit-test + paint additions + WM_LBUTTONDOWN intercept + WM_MOUSEMOVE/LEAVE/KILLFOCUS/THEMECHANGED/SETTINGCHANGE cases + multi-emitter delete rewrite).
- [ROADMAP.md](../ROADMAP.md) — §5 Shipped entry added; 5.2..5.15 renumbered.
- [CHANGELOG.md](../CHANGELOG.md) — new top-of-changelog entry.
- [tasks/todo.md](todo.md) — plan + this review section.

No file format changes, no resource ID changes, no new files.
