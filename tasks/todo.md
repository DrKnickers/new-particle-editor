# Plan: MT-7 follow-up work

Three items were deferred from the MT-7 link-emitters PR ([#58](https://github.com/DrKnickers/new-particle-editor/pull/58)):

1. Tree multi-select on the emitter list
2. Visual link-group bracket in the tree's right margin
3. Per-field configurable exempt set

These ship as three separate PRs under three tier tags:

- **[MT-8] Tree multi-select on the emitter list** — item #1. Adds
  `multiSelection` state, modifier-aware click semantics, "Link
  selected" menu item, secondary-select background paint. Foundation
  for the bracket work below (shares the `NM_CUSTOMDRAW` handler) but
  independently valuable on its own.
- **[MT-9] Visual link-group bracket** — item #2. Custom-draw bracket
  in the tree's right margin, lane-allocated via greedy interval
  scheduling, with hover-highlight and click-to-select-group. Builds
  on MT-8's custom-draw infrastructure.
- **[MT-10] Configurable exempt set per link group** — item #3.
  Orthogonal to the UI work; touches the data model + file format.

Estimates and difficulty below. The ordering reflects user value
(multi-select is the biggest UX win for the shipped feature), risk
(MT-8 and MT-9 change no file-format chunks; MT-10 does), and
dependency (MT-9 reuses MT-8's tree custom-draw plumbing).

---

# [MT-8] + [MT-9] Link-group UX v2 (split-delivery plan)

Shared plan for the multi-select and visual-bracket work. Both
features touch the same `EmitterListControl` and the same new
`NM_CUSTOMDRAW` handler, so they're planned together. At delivery
they split into two PRs:

- **[MT-8] Tree multi-select on the emitter list** — ★★★☆☆ (3/5),
  **4–7 hours**. Phases §3.1 (multi-select state), §3.2 (menu
  gating), and the secondary-select-background slice of §3.3. Does
  not add the bracket painting; the `NM_CUSTOMDRAW` handler installed
  in MT-8 handles only the secondary-select fill.
- **[MT-9] Visual link-group bracket** — ★★★★☆ (4/5), **6–10
  hours**. Phases §3.3 (full bracket draw on top of MT-8's handler),
  §3.4 (hover), §3.5 (click). Builds directly on MT-8 — no MT-8
  rework, just additions.

The split is clean because MT-8's `NM_CUSTOMDRAW` handler returns
early for non-multi-select rows; MT-9 adds the bracket branches at
`CDDS_ITEMPOSTPAINT` and the `CDDS_POSTPAINT` lane lines. Risks and
testing below are tagged `[MT-8]` / `[MT-9]` for which PR they
attach to.

## 1. Goal + scope

Make link-group workflow ergonomic and visually legible:

- **[MT-8] Tree multi-select**: Ctrl-click and Shift-click in the
  emitter tree build a multi-selection. The right-click menu reflects
  the selection size — a `Link selected` command appears when 2+
  unlinked emitters are selected, creating one new group in a single
  click.
- **[MT-9] Visual link-group bracket**: linked emitters are connected
  by a coloured bracket drawn in the tree's right margin, lane-
  allocated per group via greedy interval scheduling (so non-
  overlapping groups share a lane and the lane count stays small
  even with many groups). Hover any member dot or bracket line → all
  member rows tint with the group's colour; click → multi-selection
  becomes the group's full member list.

**In:**

- `std::set<ParticleSystem::Emitter*> multiSelection` (or equivalent)
  on `EmitterListControl`, with anchor for Shift-range
- Ctrl-click / Shift-click semantics (toggle / range)
- Keyboard nav (arrow keys) replaces multi-set with `{newPrimary}`
- Drag-drop reorder acts on primary only (multi-set untouched), per
  the MT-7 plan
- Menu gating updated for 2+ selection: `Link selected`,
  `Add selected to link group → existing group N`
- One `NM_CUSTOMDRAW` handler on the tree, doing both:
  - Secondary-select background fill for items in `multiSelection`
    that aren't the primary
  - Bracket painting for linked emitters (dot + horizontal stub + lane
    line)
- Lane assignment via greedy interval scheduling, sorted by topmost
  visible member Y (per MT-7 design discussion)
- Layout cache built once per paint; reused by hover and click
  hit-tests
- Hover state: `hoveredGroupId`, `WM_MOUSEMOVE` + `TrackMouseEvent`
  with `TME_LEAVE`, member-row tint at ~15% opacity, bracket line
  thickens on hover
- Click on dot or line: replace multi-selection with the group's
  members, primary = topmost visible
- 12-colour palette, contrast-tested under default + high-contrast
- DPI-aware: lane width, dot radius, stroke width derived from
  `GetDpiForWindow()`
- Unbounded lane count: width scales down with a 2 px floor; right-
  margin reservation soft-capped at ~25% of tree client width

**Out:**

- Multi-drag-reorder (moving N selected emitters with one drop) —
  separate ROADMAP item if friction proves real
- Bracket layout that survives across re-orderings as a "named lane"
  per group — v2 recomputes lanes every paint based on Y order
- Tree multi-select participation in label-edit or other tree
  commands beyond the link-group menu items
- Persisted multi-selection state across particle-system swaps —
  swapping the loaded system clears the multi-set

## 2. What the codebase already gives us

| Piece | File:line |
|---|---|
| Emitter list control struct | [`src/UI/EmitterList.cpp:56`](src/UI/EmitterList.cpp:56) |
| Single-selection field | `EmitterListControl::selection` |
| TVN\_SELCHANGED handler (current path that updates primary) | [`src/UI/EmitterList.cpp:1296`](src/UI/EmitterList.cpp:1296) |
| Drag-drop reorder pipeline (TVN\_BEGINDRAG + mouse handlers) | [`src/UI/EmitterList.cpp:1281`](src/UI/EmitterList.cpp:1281) |
| Right-click menu builder (dynamic) | [`src/UI/EmitterList.cpp:1142`](src/UI/EmitterList.cpp:1142) (NM\_RCLICK) |
| Link-group helpers | [`src/LinkGroup.cpp`](src/LinkGroup.cpp), [`.h`](src/LinkGroup.h) |
| `FindTreeItemByEmitter` (lParam → HTREEITEM) | [`src/UI/EmitterList.cpp:1945`](src/UI/EmitterList.cpp:1945) |
| `FormatEmitterDisplayName` (`[L<n>]` prefix already in place) | [`src/UI/EmitterList.cpp`](src/UI/EmitterList.cpp) (near top) |
| Existing AnsiToWide / WideToAnsi conversions | [`src/utils.h`](src/utils.h) |

**Not yet in the codebase — must be added:**

- **`NM_CUSTOMDRAW` handler on the tree.** No custom-draw infrastructure
  today; default Win32 painting only.
- **Tree subclassing** for `WM_LBUTTONDOWN` interception. The existing
  `LabelEditProc` subclass is for the edit control only, not the tree.
- **`WM_MOUSEMOVE` / `WM_MOUSELEAVE` + `TrackMouseEvent`** wiring on
  the tree for hover.

**Unknown to confirm before coding:**

1. Whether `TVS_FULLROWSELECT` (or its absence) affects how
   `NM_CUSTOMDRAW` reports item rects for the right margin. The
   bracket needs the row's actual height even when the tree is
   indented.
2. Whether subclassing the tree's `WM_LBUTTONDOWN` conflicts with the
   tree control's built-in label-click-to-rename behaviour (single
   click on an already-selected item starts a label edit).
3. Whether `TVS_EX_DOUBLEBUFFER` is already enabled. If not, custom-
   draw may flicker on scroll and we should enable it.

## 3. Architecture / implementation approach

Three phases. Each phase builds and tests independently; consider
landing them as three commits in one PR or three separate PRs if
review tractability matters more than atomicity.

### 3.1 Tree multi-select state

New members on `EmitterListControl`:

```cpp
std::set<ParticleSystem::Emitter*> multiSelection;
ParticleSystem::Emitter*           selectionAnchor;  // for Shift-range
```

Invariant: `multiSelection` is non-empty iff `selection != NULL`, and
`selection ∈ multiSelection`. Maintained by a single helper:

```cpp
// Modifier-aware: reads GetKeyState(VK_CONTROL) and (VK_SHIFT) at
// call time. Updates multiSelection, selection, and selectionAnchor
// per Ctrl/Shift/plain semantics. Also fires ELN_SELCHANGED.
static void UpdateMultiSelection(EmitterListControl*       control,
                                  ParticleSystem::Emitter*  clicked);
```

Modifier semantics:

- **Plain click**: `multiSelection = {clicked}`, primary = clicked,
  anchor = clicked.
- **Ctrl-click**: toggle `clicked` in `multiSelection`. If `clicked`
  becomes the only member, also make it primary. Anchor = clicked.
- **Shift-click**: `multiSelection = range(anchor, clicked)` in tree
  pre-order. Primary = clicked. Anchor unchanged.

Wiring: subclass the tree's wndproc to intercept `WM_LBUTTONDOWN`:

```cpp
case WM_LBUTTONDOWN:
{
    TVHITTESTINFO ht = { 0 };
    ht.pt.x = GET_X_LPARAM(lParam);
    ht.pt.y = GET_Y_LPARAM(lParam);
    HTREEITEM hHit = TreeView_HitTest(hTree, &ht);
    if (hHit != NULL && (ht.flags & TVHT_ONITEM))
    {
        ParticleSystem::Emitter* clicked = ...get from lParam...;
        UpdateMultiSelection(control, clicked);
        // Forward to default proc so the tree does its own selection
        // bookkeeping, which we then mirror via UpdateMultiSelection.
    }
    break;
}
```

Forward all other tree messages unchanged. Keyboard nav (`TVN_KEYDOWN`
+ arrow keys) calls `UpdateMultiSelection(control, newPrimary)` with
no modifiers, replacing the set. Drag-drop unchanged (acts on primary
only; multi-set untouched).

`#ifndef NDEBUG` assert in `UpdateMultiSelection`:
- `multiSelection.empty() == (primary == NULL)`
- `primary == NULL || multiSelection.count(primary) > 0`

### 3.2 Right-click menu gating

Extend the existing dynamic menu builder ([`src/UI/EmitterList.cpp:1142`](src/UI/EmitterList.cpp:1142)) to consult `multiSelection.size()`. New menu items
follow the MT-7 plan's §3.5(b) gating table, simplified for what
multi-select adds:

| State | Enabled items (added) |
|---|---|
| 2+ selected, all unlinked | **Link selected** (creates new group), **Add selected to link group → existing N** |
| 2+ selected, all in same group | **Dissolve link group** (already enabled via single-select path; now also responds to 2+ from the group) |
| 2+ selected, mixed (some linked, some not, in different groups) | (none; one-at-a-time required, tooltip suggests right-clicking individual emitters) |

`Link selected` calls `CreateLinkGroup(*system, multiSelectionVec)`.
The existing `ConfirmLinkOverwrite` dialog (from MT-7) is shown when
the diff between the canonical member and any subsequent member is
non-empty — wording adapts to "N emitters will be overwritten to
match X". `multiSelectionVec` is `multiSelection` flattened in tree
order, so the canonical is the topmost selected emitter.

New resource IDs: one `ID_EMITTER_LINK_SELECTED` (a fixed ID, not a
range). The "Add selected to link group → N" submenu reuses the
existing `ID_EMITTER_LINK_ADD_FIRST..LAST` range; it just operates on
the multi-set instead of the single primary.

### 3.3 `NM_CUSTOMDRAW` handler + layout cache

New handler in the tree's parent `WM_NOTIFY` plumbing. Returns
`CDRF_NOTIFYITEMDRAW | CDRF_NOTIFYPOSTPAINT` at prepaint.

Per paint:

1. **`CDDS_PREPAINT`**: compute the bracket layout into a
   `EmitterListControl::bracketLayout` cache:
   - Walk visible emitters via `TreeView_GetItemRect`. Collect
     `(emitter, hItem, rect)` for everything with `linkGroup != 0`.
   - Group by `linkGroup`. For each group, derive `(minY, maxY)` from
     its members.
   - Run greedy interval scheduling (per MT-7 plan §3.5(d.i)). Output
     `laneOf[groupId]` and `(dotX, lineX)` per lane.
2. **`CDDS_ITEMPREPAINT`** for each row: request
   `CDRF_NOTIFYPOSTPAINT` if the row is in `multiSelection` (need
   secondary-select background), or is hover-group member (need
   tint), or is a linked emitter (need dot + stub).
3. **`CDDS_ITEMPOSTPAINT`** for the row:
   - If secondary-selected and not primary: fill row rect with
     `GetSysColor(COLOR_HIGHLIGHT)` blended at ~30% opacity.
   - If hover-group member: fill row rect with the group's palette
     colour at ~15% opacity (use `AlphaBlend`).
   - If linked: paint the dot + horizontal stub at
     `(laneX, rowCentreY)`, using the group's palette colour.
4. **`CDDS_POSTPAINT`** (whole tree): for each group with ≥2 visible
   members, draw the vertical line in the assigned lane from the
   topmost dot to the bottommost. Use `SelectClipRgn` to clip to
   tree-client bounds so lines never bleed.

**Lane sizing**:

```cpp
const int dpi = GetDpiForWindow(hTree);
const int baseLaneWidth = MulDiv(6, dpi, 96);    // 6 px at 96 DPI
const int baseStub      = MulDiv(6, dpi, 96);
const int baseDot       = MulDiv(5, dpi, 96);    // radius
const int baseStroke    = MulDiv(2, dpi, 96);

RECT clientRect;
GetClientRect(hTree, &clientRect);
int reservedMax = (clientRect.right - clientRect.left) / 4;

int laneWidth = baseLaneWidth;
if (numLanes * laneWidth > reservedMax)
{
    laneWidth = max(2, reservedMax / numLanes);
}
```

**Colour palette**: 12 entries, hand-tested against light and high-
contrast backgrounds. Stored as a const `COLORREF[12]` in the
`EmitterList.cpp` (or factor to `LinkGroup.cpp` if shared elsewhere).
`palette[groupId % 12]`.

### 3.4 Hover state

```cpp
uint32_t hoveredGroupId;     // 0 = none
bool     mouseTrackingArmed; // for re-arming TME_LEAVE per move
```

Wiring on `WM_MOUSEMOVE` on the tree:

```cpp
BracketHit hit = HitTestBracket(layout, clientPt);
uint32_t newHover = (hit.kind != BracketHit::None) ? hit.groupId : 0;
if (newHover != control->hoveredGroupId)
{
    uint32_t old = control->hoveredGroupId;
    control->hoveredGroupId = newHover;
    InvalidateGroupRows(control, old);     // repaint old hover's rows
    InvalidateGroupRows(control, newHover); // repaint new hover's rows
}
if (!control->mouseTrackingArmed)
{
    TRACKMOUSEEVENT tme = { sizeof(tme), TME_LEAVE, hTree, 0 };
    TrackMouseEvent(&tme);
    control->mouseTrackingArmed = true;
}
```

On `WM_MOUSELEAVE` and `WM_KILLFOCUS`: `hoveredGroupId = 0`,
`mouseTrackingArmed = false`, invalidate the previously-hovered
group's rows.

### 3.5 Click on bracket

In the `WM_LBUTTONDOWN` subclass, before `UpdateMultiSelection`:

```cpp
BracketHit hit = HitTestBracket(layout, clientPt);
if (hit.kind == BracketHit::Dot || hit.kind == BracketHit::Line)
{
    auto members = GetLinkGroupMembers(*control->system, hit.groupId);
    control->multiSelection.clear();
    for (auto* m : members) control->multiSelection.insert(m);
    control->selection = members.empty() ? NULL : members[0];
    control->selectionAnchor = control->selection;
    TreeView_SelectItem(control->hTree, FindTreeItemByEmitter(...));
    InvalidateRect(control->hTree, NULL, FALSE);
    NotifyParent(control, ELN_SELCHANGED);
    return 0;  // eat the message
}
```

Otherwise fall through to the existing modifier-aware
`UpdateMultiSelection`.

## 4. Risks named up front + mitigations

1. **Tree subclassing breaks the built-in label-click-to-rename
   gesture.** Win32 tree starts a label edit when the user clicks an
   already-selected item. If our subclass eats `WM_LBUTTONDOWN` or
   forwards it after our own work, the timer-based rename detection
   may break.
   *Mitigation*: always forward `WM_LBUTTONDOWN` to
   `CallWindowProc(prevProc, ...)` after our own bookkeeping (unless
   the click landed on a bracket dot/line, in which case we eat it
   intentionally). The tree's own selection logic still runs and we
   mirror it. Smoke-test rename via F2 + single-click-on-selected.

2. **`UpdateMultiSelection` drift from primary.** Arrow-key nav
   changes the primary via TVN\_SELCHANGED, which fires from the
   tree's internal logic, not via our subclass. If we don't hook
   that path, the multi-set goes stale.
   *Mitigation*: also call `UpdateMultiSelection` (no modifiers) from
   `TVN_SELCHANGED` when the new selection isn't in the current
   multi-set. The `#ifndef NDEBUG` invariant asserts catch any
   remaining drift in development.

3. **Custom-draw flicker on scroll.** Heavy paint work in `NM_CUSTOMDRAW`
   can cause visible flicker.
   *Mitigation*: enable `TVS_EX_DOUBLEBUFFER` on the tree via
   `TreeView_SetExtendedStyle`. Keep the lane-layout cache invalidation
   minimal (recompute per paint, but only when the cache is
   stale-stamped).

4. **`HitTestBracket` false positives in the row-text area.** If lane
   layout puts dots near the tree's text column, a click in the
   "name area" could be misread as a bracket click.
   *Mitigation*: the first lane is offset by at least
   `baseLaneWidth × 2` from the row's right edge (or a hard pixel
   minimum like 12 px). Hit-test rect inflated by ±2 px only —
   doesn't bleed into the text area.

5. **`WM_MOUSELEAVE` swallowed by capture changes during drag-drop.**
   Drag-drop sets capture via `SetCapture`; the `WM_MOUSELEAVE` from
   `TrackMouseEvent` may not fire while captured.
   *Mitigation*: clear `hoveredGroupId` on `WM_CAPTURECHANGED` and
   on drag start (`TVN_BEGINDRAG`). Re-arm `TrackMouseEvent` on
   drag end.

6. **Bracket layout cache invalidation on tree expand/collapse.**
   Expanding or collapsing a parent changes which rows are visible.
   If the cache isn't refreshed, the bracket would point at
   stale Y coordinates.
   *Mitigation*: the cache is recomputed every paint, so expand/
   collapse just works as long as the tree triggers a paint. Verify
   the tree does — `TVN_ITEMEXPANDED` should cause an automatic
   invalidate. If not, hook it.

7. **Palette colours unreadable under user theme.** A user with a
   dark Windows theme or a high-contrast theme might see the palette
   blend into the background.
   *Mitigation*: hand-pick the 12 colours with WCAG AA contrast (≥
   4.5:1) against both `GetSysColor(COLOR_WINDOW)` and the standard
   high-contrast window colour. Verify by checking via a screenshot
   under each theme.

8. **Click-to-select-group conflicting with single-emitter selection.**
   The user might click near a bracket dot intending to select the
   emitter row, not the group.
   *Mitigation*: `HitTestBracket` only returns `Dot` or `Line` for
   pixel-accurate hits (±2 px). Misses fall through to the regular
   row-click path which selects the emitter, not the group.

9. **Layout cache and hit-test diverging.** If the layout computed at
   `CDDS_PREPAINT` doesn't match what the hit-test sees on a
   subsequent click (e.g. tree was scrolled mid-paint), clicks could
   miss or hit the wrong group.
   *Mitigation*: store the cache's tree-scroll-offset. Recompute lazily
   in `HitTestBracket` if the current scroll doesn't match.

## 5. Testing & verification

**Multi-select:**
- [ ] Plain click: `multiSelection = {clicked}`, primary = clicked.
- [ ] Ctrl-click adds to set; same item again removes (still has primary if removed).
- [ ] Shift-click selects pre-order range from anchor to clicked.
- [ ] Arrow keys: multi-set replaced with `{newPrimary}`.
- [ ] Drag-drop: only the primary moves; multi-set untouched.
- [ ] F2 / rename still works on the primary.
- [ ] `Link selected` enabled when 2+ selected and all unlinked;
  disabled otherwise.
- [ ] `Link selected` with 5 unlinked → one new group of 5; confirm
  dialog appears if params differ.
- [ ] `Add selected to link group → N`: each unlinked member joins
  group N; the existing group's members untouched.

**Visual bracket:**
- [ ] One 2-member group → vertical line in lane 0 with dots at both
  rows and horizontal stubs pointing toward row text.
- [ ] Two overlapping groups (interleaved members) → each in its own
  lane; distinct colours.
- [ ] Two non-overlapping groups (stacked vertical spans) → both in
  lane 0; visible gap with colour change marking the lane reuse.
- [ ] Sparse membership (rows 1, 5, 9 in same group) → solid line
  through gaps; dots only at members.
- [ ] Scroll the tree: bracket repaints, no artefacts.
- [ ] Collapse a parent containing a linked emitter: that member
  contributes nothing; bracket re-spans the remaining visible
  members.
- [ ] 12+ concurrent groups: all draw; lane width may shrink.
- [ ] HiDPI 175%: lane width, dots, stubs all scale up.
- [ ] High-contrast theme: bracket still visible; palette legible.

**Interactivity:**
- [ ] Hover a dot: all member rows tint with the group's colour at
  ~15% opacity; bracket line thickens.
- [ ] Hover line (between dots): same effect.
- [ ] Move cursor out of tree: hover clears within one paint.
- [ ] Hover-switch group A → B (cursor over A's dot, then B's): only
  A's rows and B's rows repaint.
- [ ] Click a dot: `multiSelection = group.members`; primary = topmost
  visible; inspector shows primary's values.
- [ ] Click a line: same as clicking a member dot.
- [ ] Click outside any bracket: regular row selection.

**Debug instrumentation:** `[Link] hover group=N (was M)`,
`[Link] click select group=N members=M`, plus the existing MT-7 tags.

---

# [MT-10] Configurable exempt set per link group

ROADMAP entry: **proposed** medium-term `[MT-10]`, ★★★☆☆ (3/5),
**6–10 hours** estimated.

## 1. Goal + scope

Let the user choose, per group, which non-textural fields participate
in propagation. v1's hard-coded exempt set (`colorTexture`,
`normalTexture`, `TRACK_INDEX`, `name`) becomes the default; everything
else is user-toggleable.

**In:**

- Per-group `LinkExemptFlags` state, stored on the `ParticleSystem`
  (not on each emitter — exempts are a group property)
- "Group settings…" item in the right-click menu when the selected
  emitter is linked, opening a dialog
- Dialog: checkbox list of every emitter field, grouped by category
  (textures, scalars, curves, random params, flags), with the four
  default exempts pre-checked
- "Reset to defaults" button in the dialog
- Persistence: per-group exempt-flags chunk in the particle system
  body (separate from the per-emitter `0x0100` link-group chunk)
- "Sync now" affordance when toggling a field FROM exempt TO shared
  while members already disagree on that field — user picks which
  member's value to use
- Backwards compat: files without the per-group exempt chunk default
  every group to the v1 hard-coded set
- Propagation hook in `CaptureUndo` consults the per-group flags
  instead of the static `GetLinkExemptFlags()` return

**Out:**

- **Per-emitter exempt overrides** ("link everything except lifetime
  on *this one*") — group-wide only in v1. *Tabled to future work
  per user direction*: if/when this becomes needed, file a separate
  ROADMAP item to extend `LinkExemptFlags` to a per-emitter override
  layer on top of the per-group baseline. Data model is already
  set up so that override is additive — no v1 rework required.
- Templated exempt sets ("save these exempts as a named preset")
- Cross-file exempt-set sharing
- A "sync all linked groups to default" bulk action

## 2. What the codebase already gives us

| Piece | File:line |
|---|---|
| `LinkExemptFlags` struct | [`src/LinkGroup.h:32`](src/LinkGroup.h:32) |
| `GetLinkExemptFlags()` (current static return) | [`src/LinkGroup.cpp:7`](src/LinkGroup.cpp:7) |
| `Emitter::copySharedParamsFrom` (already takes a `LinkExemptFlags&`) | [`src/ParticleSystem.cpp:555`](src/ParticleSystem.cpp:555) |
| `DiffNonExemptParams` (already consults `LinkExemptFlags`) | [`src/LinkGroup.cpp:158`](src/LinkGroup.cpp:158) |
| Chunk-based file format with skip-on-unknown | [`src/ChunkFile.h`](src/ChunkFile.h), [`src/ParticleSystem.cpp:640`](src/ParticleSystem.cpp:640) (`write`) |
| Propagation hook | [`src/main.cpp:764`](src/main.cpp:764) (`CaptureUndo`) |

**Unknown to confirm before coding:**

1. Whether `LinkExemptFlags` should grow to enumerate every field, or
   keep the v1 four bools + add a generic "any other exemption"
   mechanism. Likely the former — only ~40 emitter fields, and the
   dialog needs to show each one anyway.
2. Whether to store exempts as a sparse representation ("non-default
   exempts only") or a full snapshot. Sparse keeps files smaller;
   full is simpler.

## 3. Architecture / implementation approach

### 3.1 Data model

`LinkExemptFlags` grows from 4 bools to one bool per emitter field
that's eligible for exemption. Stays POD; no virtual dispatch.

Stored per-group via a new map on `ParticleSystem`:

```cpp
class ParticleSystem
{
    // ... existing fields ...
private:
    std::map<uint32_t, LinkExemptFlags> m_linkExempts;

public:
    // Returns the exempts for `groupId`, falling back to v1 defaults
    // if the group has no custom override.
    const LinkExemptFlags& getLinkExemptFlags(uint32_t groupId) const;
    void                   setLinkExemptFlags(uint32_t groupId,
                                              const LinkExemptFlags& flags);
};
```

`GetLinkExemptFlags()` in `LinkGroup.cpp` becomes
`GetDefaultLinkExemptFlags()` and remains the source of v1 defaults.

### 3.2 Serialisation

New optional chunk inside the system body. Type ID picked above the
existing range (e.g. `0x0901` — system-level, above the existing
`0x0900` system header).

```
SYSTEM_LINK_EXEMPTS {
    uint32_t count
    [ uint32_t groupId, uint8_t[N] flags ] * count
}
```

`N` is the size of the `LinkExemptFlags` struct on disk (packed,
one byte per bool, no padding). If `LinkExemptFlags` grows later,
the chunk's per-entry size grows; readers verify the chunk size
matches expectations and tolerate larger entries by truncating to
known fields.

Writer: emit only when at least one group has non-default exempts.

### 3.3 Propagation hook update

In [`src/main.cpp:764`](src/main.cpp:764):

```cpp
const LinkExemptFlags& exempt
    = info->particleSystem->getLinkExemptFlags(
        info->selectedEmitter->linkGroup);
for (auto* sibling : siblings) { ... }
```

Same change in `JoinLinkGroup` and `CreateLinkGroup`.

### 3.4 Dialog UI

New dialog resource `IDD_LINK_GROUP_SETTINGS` in both
`ParticleEditor.en.rc` and `.de.rc`:

```
- Title: "Link group N settings"
- ListView in checkbox mode, with field-name column + category
  column (Textures, Scalars, Curves, etc.)
- Buttons: OK, Cancel, Reset to defaults
```

Field categories (grouping rows in the list):

1. **Textures** (default exempt): `colorTexture`, `normalTexture`
2. **Identity** (default exempt): `name`
3. **Curves** (`TRACK_INDEX` default exempt; others shared): index,
   red/green/blue/alpha/scale/rotation curves
4. **Lifetime / spawning**: lifetime, initialDelay, burstDelay,
   nBursts, nParticlesPerBurst, nParticlesPerSecond
5. **Physics**: gravity, acceleration, inwardSpeed, inwardAcceleration,
   bounciness, groundBehavior, objectSpaceAcceleration, affectedByWind
6. **Appearance**: blendMode, textureSize, nTriangles,
   randomScalePerc, randomLifetimePerc, hasTail, tailSize
7. **Weather**: isWeatherParticle, weatherCubeSize,
   weatherCubeDistance, weatherFadeoutDistance
8. **Rotation**: randomRotation, randomRotationDirection,
   randomRotationAverage, randomRotationVariance
9. **Misc**: linkToSystem, parentLinkStrength, doColorAddGrayscale,
   isHeatParticle, noDepthTest, isWorldOriented, freezeTime,
   skipTime, emitFromMesh, emitFromMeshOffset, randomColors,
   groups (random param boxes)

Right-click menu addition (only when selected emitter is linked):
**Group settings…** opens the dialog.

### 3.5 Sync-when-unexempting

When the user clears a field's exempt flag while group members
already disagree on that field, ask which value should win:

> *Field `gravity` is currently different across Group 1's members:*
> *  - "smoke\_a": 0.5*
> *  - "smoke\_b": 1.0*
> *  - "smoke\_c": 0.5*
> *Which value should govern?*
> *  ( ) 0.5  (used by "smoke\_a", "smoke\_c")*
> *  ( ) 1.0  (used by "smoke\_b")*

The dialog presents unique values + which members use each, with a
radio. On OK, the chosen value propagates to every member.

Implementation: a `BuildFieldDisagreement(const ParticleSystem&,
uint32_t groupId, FieldId field)` helper that returns a
`std::vector<std::pair<value, std::vector<Emitter*>>>` of unique
values and their owners.

## 4. Risks named up front + mitigations

1. **Chunk-size mismatch on read.** If `LinkExemptFlags` grows
   between editor versions, the on-disk chunk size won't match the
   reader's expectations.
   *Mitigation*: write `sizeof(LinkExemptFlags)` as the first uint8\_t
   in each per-group entry; reader reads that many bytes, truncates
   to known fields (newer files loaded in older editors lose the
   extra exempts gracefully).

2. **Disagreement-resolution UX overload.** A user who clears 10
   exempt flags at once would see 10 disagreement dialogs in
   sequence.
   *Mitigation*: collect all disagreements at OK time, show one
   summary dialog with a row per disagreeing field. Single Apply
   resolves them all.

3. **Backwards compat with files that used v1 link groups.** Files
   saved by the MT-7 build have no `SYSTEM_LINK_EXEMPTS` chunk;
   readers must default to the v1 hard-coded set, not "all fields
   shared".
   *Mitigation*: `getLinkExemptFlags(groupId)` returns
   `GetDefaultLinkExemptFlags()` when the group has no map entry.

4. **Propagation already-fired before the user sees the disagreement
   prompt.** If the user opens the dialog AFTER a propagation has
   already synced fields, the disagreement state is gone.
   *Mitigation*: this is fine by design — the dialog only fires when
   the user actively clears an exempt flag, and at that moment we
   look at the current member state. If they've already converged,
   no prompt.

5. **Game-engine reading the new chunk.** The system-body chunk
   `0x0901` would be at a level the game engine parses.
   *Mitigation*: choose ID carefully (verify by greping system-level
   chunk IDs in `ParticleSystem.cpp`). Picking `0x0901` puts us
   directly after the existing `0x0900` system header, but verify
   the engine's reader tolerates unknown chunks at the system level
   (it must, given the existing optional `0x0002` leaveParticles
   chunk is similar).

## 5. Testing & verification

**Default behaviour (no user override):**
- [ ] Open a v1 file with link groups → all groups use default
  exempts (textures, index, name); propagation matches MT-7.
- [ ] Create a new group, don't open settings dialog → defaults
  apply.

**Custom exempts:**
- [ ] Open settings for a group, exempt `lifetime` → edit lifetime
  on one member → others NOT updated.
- [ ] Save → reload → exempt persists → editing lifetime still
  doesn't propagate.
- [ ] Un-exempt `lifetime` while members agree → no dialog → future
  edits propagate.
- [ ] Un-exempt `lifetime` while members disagree → disagreement
  dialog appears with options → pick a value → all members
  converge → future edits propagate.

**Multi-field changes:**
- [ ] Toggle 3 exempt flags at once with member disagreements →
  single summary dialog → resolve all → apply.

**Persistence:**
- [ ] Two groups with different exempt sets → save → reload →
  per-group exempts preserved.
- [ ] File saved by a future editor with more exempt flags than
  current → load in current editor → unknown flags ignored, known
  flags applied.

**Game engine compat:**
- [ ] File with `SYSTEM_LINK_EXEMPTS` chunk loads + renders
  identically in EaW/FoC (engine skips unknown system-level chunk).

**Debug instrumentation:** `[Link] exempt set group=N flags=0x...`
on dialog OK; existing MT-7 tags continue to fire.

---

# Suggested delivery order

1. **[MT-8] multi-select** first. Biggest UX impact on the shipped
   MT-7 feature — unlocks the "link 5 emitters in one click"
   workflow the user wanted from the start. Modest scope (no
   custom-draw beyond the secondary-select background fill), no
   file-format changes.
2. **[MT-9] visual bracket** second. Reuses MT-8's `NM_CUSTOMDRAW`
   handler so the marginal cost is just the bracket-painting
   branches plus hover/click. Makes group membership legible at
   scroll-speed.
3. **[MT-10] configurable exempts** third. Lowest urgency — v1's
   hard-coded exempts cover the user's stated use case ("textures
   different, motion same"). Per-field configurability is a power-
   user feature. Touches data model + file format.
