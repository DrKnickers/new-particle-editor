# Plan: Linked emitters (shared parameters across a link group)

**Status**: shipped as `[MT-7]` (the `MT-5` referenced throughout this
plan was the proposed tag at planning time; by ship time `MT-5` and
`MT-6` were already retired by other shipped items, so the next free
tier tag was `MT-7`). See [`ROADMAP.md` §5.1](../ROADMAP.md) and the
`Linked emitters` entry in [`CHANGELOG.md`](../CHANGELOG.md).

Original tagging: medium-term `[MT-7]`, ★★★★☆ (4/5),
**16–24 hours** estimated (revised upward from 10–16h after deciding to
include tree multi-select and a visual link-bracket overlay in v1).
Touches data model, serialisation, edit paths, undo, UI controls,
and custom-draw rendering.

## 1. Goal + scope

Let the user mark N emitters in a particle system as a **link group** so
edits to non-textural parameters propagate to every member in lock-step.
Use case: 5 emitters with 5 different textures (atlas variants, or fire
vs. smoke colour pairs) that should otherwise move, scale, and rotate
identically. Today this requires N parallel edits per parameter change;
with link groups the user edits one emitter and the others follow.

**In:**
- Per-emitter "link group" membership (0 = unlinked, 1..N = group ID;
  each emitter belongs to at most one group)
- **Minimum group size: 2 members.** One-member groups cannot exist —
  the data model permits the value transiently during edits, but no
  user-visible operation produces or preserves a one-member group:
  - Creation requires `multiSelection.size() >= 2`
  - Removing the second-to-last member auto-dissolves the group (the
    remaining lone member also becomes unlinked, in the same undo step)
  - "Create link group" as a single-emitter operation is removed
    from the menu
- Shared parameters: every editable `Emitter` field **except**:
  - `colorTexture`, `normalTexture` (texture filenames)
  - `TRACK_INDEX` curve (atlas sub-frame curve)
  - `name` (every emitter keeps its own identifier)
- Edit propagation: editing any non-exempt field on a linked emitter
  writes the same value to every sibling **before** the undo snapshot
  is taken — one user action → one undo step covering the whole group
- **Tree multi-select**: Ctrl-click / Shift-click in the emitter tree
  builds a multi-selection. Right-click menu reflects the selection
  size and group state:
  - 0 selected: no link items
  - 1 selected, unlinked, no groups exist in the system: no link items
    (can't create a 1-member group, can't add to a non-existent group)
  - 1 selected, unlinked, ≥1 group exists:
    - **Add to link group →** dynamic submenu listing existing groups
  - 1 selected, linked:
    - **Remove from link group** (auto-dissolves the group if removal
      would leave a single member behind)
    - **Dissolve link group** (detaches every member)
  - 2+ selected, all unlinked:
    - **Link selected** → creates one new group containing all
    - **Add selected to link group →** submenu (if ≥1 group exists)
  - 2+ selected, all in the same group:
    - **Dissolve link group**
  - 2+ selected, mixed (some unlinked, some linked, possibly across
    groups): show menu items in the simplest form that reflects what
    the user can do without ambiguity:
    - If exactly one group is represented + some unlinked → **Add
      unlinked to Group N**
    - If multiple groups represented → no batch action; tooltip
      suggests "right-click individual emitters to manage"
- **Visual link bracket**: linked emitters are connected by a coloured
  bracket drawn in the right margin of the emitter tree. Each group
  gets a lane in the right margin and a stable colour derived from
  the group ID. The bracket spans the first-to-last linked row in the
  visible tree, with a small dot at each member's row. **No hard cap
  on lane count** — lane width and right-margin reservation scale
  dynamically as the active group count grows; see §3.5(d) for the
  layout algorithm. **Always drawn**, including under high-contrast
  themes (colour palette is chosen to remain legible across themes).
- **Bracket interactivity**:
  - **Hover any member dot or any bracket line** → all member rows
    of that group get a colour-tinted background (the group's
    palette colour at ~15% opacity); the bracket itself thickens
    slightly while hovered. Reveals group composition at a glance
    without right-clicking.
  - **Click any member dot or any bracket line** → multi-selection
    is replaced by `{ all members of this group }`, primary becomes
    the topmost visible member. Any subsequent right-click reflects
    the new selection. Saves Ctrl-clicking through individual
    members.
- **Interleaved ordering is a first-class use case.** Linked emitters
  need not be adjacent in the tree — a smoke group and a fire group
  can be interleaved row-by-row for layering. The bracket-lane layout
  is built around this.
- **Drag-drop reorder** acts on the primary selection only — a multi-
  selection's secondary members do not travel with the dragged
  primary. This is the v1 behaviour the user explicitly wants so that
  individual linked emitters can be repositioned independently for
  layering.
- Tree-view text affordance: `[L<n>]` prefix on linked-emitter names
  (always present; helps screen readers and provides a
  visualisation-independent identifier in the row text itself)
- Persistence: optional per-emitter chunk in the file; absent ⇒ unlinked
- All link-management operations are themselves undoable
- Backwards compatibility: pre-feature files load fully unlinked

**Out:**
- Per-field configurable exempt set — v1 hard-codes
  `colorTexture` / `normalTexture` / `TRACK_INDEX` / `name`.
  *Confirmed deferred per user direction*: future feature to toggle
  which fields are locked. Separate ROADMAP entry once v1 ships and
  the basic flow is exercised.
- Sharing parameters across files (link to a "master template") —
  out-of-scope; the LT-3 import flow is the natural home for that.
- Highlighting linked siblings in the preview viewport.
- Conflict-resolution UI when joining a group whose params already
  differ from the joiner's — v1 broadcasts from a canonical member
  with a confirmation dialog, not a merge UI.

## 2. What the codebase already gives us

| Piece | File:line |
|---|---|
| Emitter struct (per-emitter params) | [`src/ParticleSystem.h:68`](src/ParticleSystem.h:68) |
| Universal post-edit chokepoint | [`src/main.cpp:764`](src/main.cpp:764) `CaptureUndo()` |
| Snapshot-based undo (whole-system serialise) | [`src/UndoStack.cpp:64`](src/UndoStack.cpp:64) `Capture()` |
| Coalesce-key model (per-emitter discriminator) | [`src/main.cpp:2208`](src/main.cpp:2208) |
| Chunk reader skips unknown chunks | [`src/ChunkFile.h:38`](src/ChunkFile.h:38) |
| Per-emitter binary write/read pair | [`src/ParticleSystem.cpp:96`](src/ParticleSystem.cpp:96) |
| Emitter context-menu dispatch | [`src/UI/EmitterList.cpp:1144`](src/UI/EmitterList.cpp:1144) |
| Tree-control item display | [`src/UI/EmitterList.cpp:56`](src/UI/EmitterList.cpp:56) |
| Existing track aliasing pattern | [`src/ParticleSystem.h:140`](src/ParticleSystem.h:140) (`tracks[]` vs `trackContents[]`) |
| Duplicate-emitter precedent for "fresh emitter from copy" | [`src/UI/EmitterList.cpp:1678`](src/UI/EmitterList.cpp:1678) |
| Existing drag-drop reorder (will interact with multi-select) | [`src/UI/EmitterList.cpp:77`](src/UI/EmitterList.cpp:77) |

**Not yet in the codebase — must be added:**
- **Custom-draw infrastructure on the emitter tree.** The control
  currently uses default Win32 tree painting; no `NM_CUSTOMDRAW`
  handler exists. Adding one is a prerequisite for both the visual
  link bracket and any custom-painted multi-select indication.
- **Multi-select state.** The tree is single-select today
  (`info->selectedEmitter` is a single pointer). v1 introduces a
  `std::set<HTREEITEM>` (or equivalent) extra-selection set.

**Unknown to confirm before writing code:**
1. The cleanest signature for `Emitter::CopySharedParamsFrom(const Emitter&)`
   — particularly whether track aliasing (the `tracks[]` pointers into
   `trackContents[]`) needs to be reconstructed or whether v1 can assume
   no aliasing is in use (the UI never creates aliased tracks today).
2. The next free chunk-type ID in the emitter body. Grep all
   `0x00xx` literals in `ParticleSystem.cpp` and `Effect.cpp` and pick
   above the high-water mark. `0x0014` is a candidate but verify.
3. Whether `TVS_SHOWSELALWAYS` plus a custom-draw selection background
   gives a clean Ctrl/Shift-click multi-select, or whether we need to
   intercept `WM_LBUTTONDOWN` / `WM_LBUTTONUP` and synthesise selection
   ourselves to override the tree's built-in single-select reset.
   Prior art exists in MFC `CTreeCtrl` extensions; verify before
   choosing an approach.

## 3. Architecture / implementation approach

Seven changes: the original five (data model, helpers, propagation hook,
serialisation, basic menu UI) plus tree multi-select and custom-draw
for the link bracket. A new free-function module `src/LinkGroup.cpp/h`
keeps the group helpers out of `ParticleSystem.cpp`'s already-long
footprint.

### 3.1 Data model

Add to `ParticleSystem::Emitter`
([`src/ParticleSystem.h:68`](src/ParticleSystem.h:68)):

```cpp
// 0 = unlinked. Non-zero IDs are unique within a ParticleSystem and
// stable across save/load. Never read by the game engine.
uint32_t linkGroup;
```

- Initialise to `0` in `setDefaults()`.
- **Copy constructor** preserves the value (so an in-system clone
  preserves group membership — but see §3.5 for paste behaviour).
- **Duplicate menu** and **paste from clipboard** explicitly reset
  to `0` after construction; cross-context linkage is meaningless.

### 3.2 Group helpers (`src/LinkGroup.cpp/h`)

```cpp
// Assign emitter to a fresh, never-before-used ID in this system.
uint32_t CreateLinkGroup(ParticleSystem&, Emitter*);

// Add emitter to an existing group. Overwrites the joiner's non-exempt
// params with a canonical member's so the group stays in sync.
void JoinLinkGroup(ParticleSystem&, Emitter* joiner, uint32_t groupId);

// Remove emitter from its group. If the group becomes empty, the ID is
// retired (not reused within this session).
void LeaveLinkGroup(ParticleSystem&, Emitter*);

// Detach every member from the given group; ID retires.
void DissolveLinkGroup(ParticleSystem&, uint32_t groupId);

// Enumerate members of a group (returns empty vector if id == 0).
std::vector<Emitter*> GetLinkGroupMembers(const ParticleSystem&,
                                           uint32_t groupId);

// Hard-coded v1 exempt set; will become configurable later.
struct LinkExemptFlags {
    bool colorTexture  = true;
    bool normalTexture = true;
    bool trackIndex    = true;
    bool name          = true;
};
const LinkExemptFlags& GetExemptFlags();
```

And a new `Emitter` member:

```cpp
// Copy every non-exempt field from `src` into `*this`. Deep-copies
// track keymaps. Does not touch linkGroup.
void Emitter::CopySharedParamsFrom(const Emitter& src,
                                    const LinkExemptFlags&);
```

ID allocation strategy: `max(linkGroup) + 1` across all emitters in
the system. Retired IDs never come back within a session; reload from
disk renumbers naturally because the saved IDs are the source of truth.

### 3.3 Edit propagation hook

In `CaptureUndo` ([`src/main.cpp:764`](src/main.cpp:764)), **before**
`info->undoStack.Capture(...)`:

```cpp
static void CaptureUndo(APPLICATION_INFO* info, DWORD coalesceKey)
{
    if (info == NULL || info->particleSystem == NULL) return;
    if (info->undoStack.IsApplying()) return;

    // Propagate the edited emitter's shared params to its link siblings
    // before snapshotting. One user edit → one undo step that captures
    // the whole group's new state.
    if (info->selectedEmitter && info->selectedEmitter->linkGroup != 0) {
        auto siblings = GetLinkGroupMembers(*info->particleSystem,
                                            info->selectedEmitter->linkGroup);
        for (auto* sibling : siblings) {
            if (sibling != info->selectedEmitter) {
                sibling->CopySharedParamsFrom(*info->selectedEmitter,
                                              GetExemptFlags());
            }
        }
#ifndef NDEBUG
        printf("[Link] propagate group=%u members=%zu edited=%s\n",
               info->selectedEmitter->linkGroup, siblings.size(),
               info->selectedEmitter->name.c_str());
#endif
    }

    size_t selIdx = IndexOfEmitter(info->particleSystem, info->selectedEmitter);
    bool pushed   = info->undoStack.Capture(*info->particleSystem,
                                             selIdx, coalesceKey);
    /* ...existing logging + UpdateUndoRedoUI... */
}
```

This relies on two confirmed facts:
1. `CaptureUndo` is the universal post-edit funnel — every UI mutation
   reaches it before the next redraw.
2. The undo snapshot covers the whole `ParticleSystem`, so the
   post-propagation sibling state lands in the snapshot for free —
   no "undo across N emitters" plumbing required.

### 3.4 Serialisation

Add one new optional chunk inside each emitter's body. Type ID picked
above the current high-water mark (verify pre-coding; placeholder
`0x0014`).

```
EMITTER_LINKGROUP {
    uint32_t linkGroup;
}
```

Writer: emit only when `linkGroup != 0`. Reader: read if present,
default `0` otherwise. The game engine never sees this field —
`ChunkReader::next()` skips unknown chunks, confirmed.

### 3.5 UI

Five pieces, all in [`src/UI/EmitterList.cpp`](src/UI/EmitterList.cpp:1)
and the `.rc` files:

**(a) Tree multi-select state**

Add to `EmitterListControl`:

```cpp
std::set<ParticleSystem::Emitter*> multiSelection;
// Anchor for Shift-click range selection; updated on Ctrl/plain click.
ParticleSystem::Emitter* selectionAnchor = nullptr;
```

The existing `info->selectedEmitter` remains the "primary" selection
(drives the inspector panel — only one set of values is shown at a
time). `multiSelection` is a superset that always includes the
primary; it's what right-click handlers consult for batch operations.

Implementation route (chosen after spike, see §2 unknown #3):
intercept `WM_LBUTTONDOWN` on the tree, hit-test to identify the
clicked item, then update `multiSelection` according to modifier
keys before passing the message through (or eating it and updating
the primary selection manually). Custom-draw paints the secondary
selection background for items in `multiSelection` but not equal to
the primary.

Modifier semantics:
- **Plain click**: `multiSelection = { item }`, primary = `item`,
  anchor = `item`.
- **Ctrl-click**: toggle `item` in `multiSelection`. If `item`
  becomes the only member, also make it the primary. Anchor = `item`.
- **Shift-click**: `multiSelection = range(anchor, item)` (tree
  pre-order). Primary = `item`. Anchor unchanged.

Interaction with existing drag-drop: dragging starts from the
*primary* selection; drag does not act on the multi-selection set
in v1 (deferred — same model as Windows Explorer's tree). Document
in CHANGELOG.

**(b) Resource: emitter context-menu items**

Items added at the top of the existing right-click menu, gated
dynamically at `WM_INITMENUPOPUP` based on multi-selection size and
group-membership state:

```
MENUITEM "Link selected",                  ID_EMITTER_LINK_SELECTED
POPUP    "Add to link group"               // dynamic (singular)
POPUP    "Add selected to link group"      // dynamic (multi)
MENUITEM "Remove from link group",         ID_EMITTER_LINK_REMOVE
MENUITEM "Dissolve link group",            ID_EMITTER_LINK_DISSOLVE
MENUITEM SEPARATOR
... existing items (Duplicate, etc.) ...
```

Gating rules (driven by selection size and group-membership):

| Selection state | Enabled items |
|---|---|
| `size==1`, unlinked, no groups exist | (none — no link items shown) |
| `size==1`, unlinked, ≥1 group exists | Add to link group → |
| `size==1`, linked | Remove from link group, Dissolve link group |
| `size>=2`, all unlinked | Link selected; Add selected to link group → (if any group exists) |
| `size>=2`, all in the same group | Dissolve link group |
| `size>=2`, exactly one group represented + some unlinked | Add unlinked to Group N |
| `size>=2`, multiple groups represented | (none — tooltip directs user to one-at-a-time) |

**Auto-dissolve on remove**: `Remove from link group` checks if the
remaining membership would be exactly 1 after removal. If so, the
remaining lone member is also detached (group fully dissolves). One
undo step covers both detachments. The CHANGELOG entry calls this
out explicitly so it's not a surprise.

**No "Create link group" single-emitter command**: one-member groups
are not permitted, so the only path to a new group is multi-select
2+ unlinked emitters → "Link selected". Documented in CHANGELOG.

**No "merge two existing groups" command in v1**: workaround is to
dissolve one group and add its (former) members to the other one at
a time. If this proves painful, it's a v1.1 follow-up.

**(c) Confirmation dialog on Join / Link-into-existing only**

Pre-diff (per §4 mitigation): compute non-exempt field diff between
joiner(s) and canonical group member. Skip the dialog when the diff
is empty. When non-empty:

> *N emitter(s) will have their parameters (except texture, atlas
> index, and name) overwritten to match Group K's. Affected fields:
> gravity, lifetime, red curve, …. Continue?*

Single confirmation per join action regardless of joiner count.
Skipped entirely for Create, Remove, Dissolve, and Link-selected
(no overwrite happens — the group seeds from the first selection).

**(d) Custom-draw: visual link bracket**

A new `NM_CUSTOMDRAW` handler on the emitter tree, in
`EmitterList.cpp`. Wired into the existing `WM_NOTIFY` plumbing.

**Visual vocabulary** (locked per user direction):
- **Filled dot** at each member row: ~5 px radius (DPI-scaled), colour
  = `palette[groupId % 12]`.
- **Horizontal stub** ~6 px from dot pointing toward row text. Same
  colour as the dot. Disambiguates which row owns the dot.
- **Vertical line** in the lane spanning topmost-to-bottommost
  visible member dots. 1–2 px stroke (DPI-scaled). Same colour.
- **No end caps**: the line stops at the topmost/bottommost dot.
  Dots are the boundary.
- **Sparse membership**: solid line through gaps. Non-member rows in
  between have no marks in this lane (other lanes may paint there).
- **One-member group**: not permitted by the data model in v1 (see
  §1). Defensive: if one is encountered (e.g. mid-edit transient
  state), draw the lone dot but no line, and don't crash.
- **Same-lane reuse** (non-overlapping groups sharing lane 0): blank
  vertical space between the two groups' spans; colour change
  signals "different group." No divider tick.

**Lane assignment algorithm** (greedy interval scheduling):

```
// Per paint, after CDDS_PREPAINT:
visibleGroups = groups with >=1 visible member,
                sorted ascending by topmost-visible-member Y
lanes = []  // each lane stores its last-placed group's maxY

for group in visibleGroups:
    placed = False
    for laneIdx, laneMaxY in enumerate(lanes):
        if group.minY > laneMaxY:
            // Group fits in this lane after the previous occupant.
            lanes[laneIdx] = group.maxY
            laneOf[group] = laneIdx
            placed = True
            break
    if not placed:
        lanes.append(group.maxY)
        laneOf[group] = len(lanes) - 1
```

Y-sorted ordering (per user direction) ensures the lane that the
eye expects to "be group A's lane" is consistently the leftmost one
the moment A becomes visible.

**Lane sizing**:
- Default `lane_width = round(6 * dpi / 96)` px
- Right-margin reservation = `numLanes × lane_width + 4 px` padding
- If reservation would exceed `0.25 × tree_client_width`, shrink
  `lane_width` proportionally down to a 2 px floor
- Below 2 px, lanes are allowed to overlap; dot colour still
  distinguishes groups but vertical-line clarity degrades

**Layout cache for hit-testing**:

The bracket layout state (`laneOf`, per-group dot rects, per-group
line rects) is computed once per paint and stored in
`EmitterListControl::bracketLayout`. The same struct is read by the
hover and click handlers (§3.5(e)) without recomputation. Cache is
invalidated on any tree change (item add/remove/reorder/expand/
collapse, scroll) — but since we recompute every paint anyway, the
cache lifetime is just "current frame's layout."

**Draw flow**:
1. `CDDS_PREPAINT` → compute lane layout into the cache. Return
   `CDRF_NOTIFYITEMDRAW | CDRF_NOTIFYPOSTPAINT`.
2. `CDDS_ITEMPREPAINT` → return `CDRF_NOTIFYPOSTPAINT` if the row's
   emitter is in `multiSelection` (need to paint secondary-select
   background), or is a hover-group member (need to paint hover
   tint), or is a link-group member (need to paint dot + stub).
3. `CDDS_ITEMPOSTPAINT` for a linked item: paint the row's hover
   tint (if applicable), the dot, and the horizontal stub at the
   X position dictated by `laneOf[emitter->linkGroup]`.
4. `CDDS_POSTPAINT` (whole-tree, fires after all items): for each
   visible group with ≥2 visible members, draw the vertical line in
   the assigned lane. Use `SelectClipRgn` to clip to tree-client
   bounds so lines never bleed into adjacent UI.

**Colour palette**: 12 entries, hand-tuned for legibility against:
- Default light tree background (typical `COLOR_WINDOW` white)
- Dark Win32 themes if/when applied
- High-contrast theme window-colour

Each colour must clear ~4.5:1 contrast against the lightest expected
background. `palette[groupId % 12]` with lane assignment biased to
not place same-colour groups in adjacent lanes when possible.

**Tree scrolling / collapse**: `CDDS_POSTPAINT` re-runs every paint;
scroll and collapse work for free. Members hidden inside collapsed
parents contribute nothing to top/bottom. If a group has zero visible
members (all hidden), nothing is drawn for that group this frame.

**(e) Bracket interactivity (hover and click)**

Adds `WM_MOUSEMOVE` and `WM_LBUTTONDOWN` handling to the tree
control's window-proc (or subclass, depending on what's idiomatic in
the existing code).

**Hit-testing**:

```cpp
struct BracketHitTest {
    enum Kind { None, Dot, Line };
    Kind         kind;
    uint32_t     groupId;
    Emitter*     memberAtDot;  // only valid for Dot
};

BracketHitTest HitTestBracket(POINT clientPt) const;
```

Walks the cached `bracketLayout`:
- **Dot hit**: cursor inside any member-dot rect (with a ±2 px
  inflation for finger-friendly target).
- **Line hit**: cursor within ±2 px of any group's vertical line,
  AND between that group's topmost and bottommost member Y.
- **None**: cursor is outside any bracket geometry.

**Hover lifecycle**:
- Track `EmitterListControl::hoveredGroupId` (initially 0).
- On `WM_MOUSEMOVE` over the tree: call `HitTestBracket`. If the hit
  resolves to a group different from `hoveredGroupId`, update and
  `InvalidateRect` on the rows that need repainting (old hover
  group's member rows + new hover group's member rows). Avoid full
  control invalidation to prevent flicker.
- Set `TME_LEAVE` via `TrackMouseEvent` so we get `WM_MOUSELEAVE`
  when the cursor exits the tree control; on leave, clear
  `hoveredGroupId` and invalidate the previously-hovered group's
  rows.
- Hover paint effect: in `CDDS_ITEMPOSTPAINT`, when the row's
  emitter belongs to `hoveredGroupId`, fill the row's background
  rect (left of the dot) with the group's palette colour at ~15%
  opacity using `AlphaBlend()` or a colour-mixed `FillRect`. Also
  thicken the group's bracket line stroke from 1–2 px to 2–3 px
  in `CDDS_POSTPAINT` when this is the hovered group.

**Click handling**:
- On `WM_LBUTTONDOWN`: call `HitTestBracket` first. If the hit is
  `Dot` or `Line`:
  - Compute the group's full member list.
  - Set `multiSelection = members`, primary = topmost visible member.
  - Update the tree's `TVI_SELECTED` state for the primary so the
    inspector pane refreshes.
  - `InvalidateRect` on the affected rows.
  - **Eat the message** (return without calling `CallWindowProc` /
    forwarding to the default handler) so the tree control doesn't
    also try to interpret the click as a row selection.
- Otherwise (hit == None): fall through to the existing tree click
  handling, which manages the primary/secondary selection per
  §3.5(a).

**Interaction with multi-select primitives**:
- Clicking a bracket replaces the multi-selection entirely (no
  Ctrl-click semantics from bracket-click). Rationale: bracket-
  click is a "select the group" operation, not a "modify selection"
  operation. Consistent with most file managers' folder-icon clicks.
- Ctrl-click on a bracket: same behaviour as plain click for v1
  (always replaces). Could become "add group to multi-set" in v2.

**(f) Tree-item text affordance**

Prefix linked emitter names with `[L<groupId>] ` in the
`TVN_GETDISPINFO` handler. Always present — provides a
visualisation-independent identifier in the row text itself,
and helps screen readers.

**Undo for group operations**

All link menu handlers end with `CaptureUndo(info, 0)` — group
changes are full-snapshot, no coalescing. They run **after** the
mutation, so the snapshot captures the new `linkGroup` IDs.

## 4. Risks named up front + mitigations

Each risk is paired with a concrete code-level mitigation. The first
three carry the highest mitigation value — they eliminate the risk
through architectural choice rather than detecting it after the fact.

1. **Track-aliasing breakage in `CopySharedParamsFrom`.** The emitter
   has `Track trackContents[NUM_TRACKS]` plus `Track* tracks[NUM_TRACKS]`
   pointers. A naïve `tracks[i] = src.tracks[i]` would point a sibling
   at the source's memory, causing double-free on destruction or
   aliased edits afterward.
   *Mitigation — eliminate by reuse*: don't hand-write field-by-field
   copy. Use the existing emitter copy constructor `Emitter(const
   Emitter&)` (already exercised by Duplicate) to build a full clone
   of `src`, then selectively restore the destination's exempt fields
   (`name`, `colorTexture`, `normalTexture`, `tracks[TRACK_INDEX]`,
   `linkGroup`, `parent`, `spawnOnDeath`, `spawnDuringLife`) and
   `move`-assign the clone into `*this`. The copy ctor already
   handles aliasing correctly because Duplicate exercises that path.
   Fallback if the copy ctor turns out incomplete: chunk round-trip
   via `ChunkWriter` → buffer → `ChunkReader` into a fresh `Emitter`,
   same selective-restore pattern. Either route inherits tested
   aliasing logic.

2. **Undo of group operations losing pre-action state.** When Join
   overwrites the joiner's params, the pre-Join values must survive
   in the undo stack or `Undo` after `Join` can't restore what was
   lost.
   *Mitigation — eliminate via the existing snapshot-undo pattern*:
   snapshot-undo always holds the state at the time of the previous
   capture. Provided the document-load path captures an initial
   snapshot (standard for snapshot-undo editors), every action runs
   `mutate → CaptureUndo` and undo naturally returns to the
   preceding snapshot — no special pre-action capture needed.
   **Pre-coding task**: grep the document-load path for an initial
   `CaptureUndo` invocation. If absent, add one. With that confirmed,
   the four group operations are each three lines: mutate, capture,
   redraw.

3. **Joining a group whose members' params already differ from the
   joiner's.** Silent overwrite would lose work.
   *Mitigation — pre-diff, only confirm when something is at stake*:
   before showing the confirmation dialog, compute the non-exempt
   field diff between the joiner and the canonical group member.
   If the diff is empty, join silently (common case: a just-duplicated
   emitter joining its source's group, or two emitters that were
   manually tuned identically). If non-empty, the dialog reads
   *"B's parameters differ from Group 1's. Joining will overwrite
   N fields: gravity, lifetime, red curve, …. Continue?"* — informed
   consent only when there's actual data loss. Concrete API:
   `std::vector<std::string> DiffNonExemptParams(const Emitter&,
   const Emitter&)` returning field names.

4. **Propagation fires on edits that don't change the edited
   emitter's value.** Some UI paths call `CaptureUndo` defensively
   after spinner ticks that snap back to the previous value. For an
   unlinked emitter this is harmless (coalesced no-op). For a linked
   emitter it still overwrites siblings, but with their existing
   values — also a no-op because the group invariant says they're
   already equal.
   *Mitigation — debug-build invariant check*: in `CaptureUndo`
   after propagation, `#ifndef NDEBUG` walk the edited emitter's
   group and assert every member's non-exempt fields are byte-equal
   to the edited emitter's. Production builds skip the check. The
   first time any future edit path drifts (bypasses propagation,
   forgets a field), the assert fires with the field name in scope.

5. **Spawn-on-death / spawn-during-life indices.** These are
   structural (`size_t spawnOnDeath`, `size_t spawnDuringLife`),
   not parametric. Linking does **not** propagate them — every linked
   emitter keeps its own children. Risk is user expectation that
   linked emitters share a child chain.
   *Mitigation — documentation only*: explicit in the CHANGELOG
   entry, plus a tooltip on the Link submenu: *"Shares motion and
   animation parameters only — not child emitters, texture, or
   atlas index."* No code mitigation; the data-model behaviour is
   correct.

6. **Reorder / delete a linked emitter.** Group membership is stored
   by ID, not index — reorder via drag-drop is safe. Delete removes
   the member; an empty group retires its ID.
   *Mitigation — debug-build invariant check*: after any emitter
   deletion, `#ifndef NDEBUG` walk the system and assert no surviving
   emitter holds a `linkGroup` ID whose group is empty. (Shouldn't
   be possible given the field-on-emitter design — the ID can only
   be empty if no emitter holds it — but cheap to check, and it
   catches future code that adds an out-of-band group table.)

7. **Duplicate / paste / NT-4-duplicate-with-index inheriting group
   membership.** A copy in any of the three paths should arrive
   unlinked; otherwise users get surprise propagation.
   *Mitigation — centralise the reset in one helper*: add
   `Emitter::detachFromLinkGroup()` (sets `linkGroup = 0`,
   `#ifndef NDEBUG` log line). Call it in exactly three places:
   clipboard paste in `EmitterList.cpp`, the existing Duplicate menu
   handler, and the NT-4 duplicate-with-index handler. A grep audit
   for `new Emitter(*` or `Emitter(const Emitter&)` confirms coverage.
   `#ifndef NDEBUG` assert in the duplicate / paste finalisers that
   the new emitter has `linkGroup == 0` catches any path that
   forgets the call.

8. **Engine-side compatibility of the new chunk.** Type ID must not
   collide with anything the game reads. The skip-unknown-chunks
   reader protects us, but a collision with a real engine chunk
   would mis-parse.
   *Mitigation — pick a high ID after a deliberate grep*: grep all
   `0x00..` chunk-type literals in `ParticleSystem.cpp`, `Effect.cpp`,
   and `ChunkFile.h`. Pick a value clearly above the high-water mark
   (e.g. `0x0100` if everything currently is `<0x00FF`), leaving
   headroom for future first-party engine additions. Add the new
   constant alongside the existing ones with a comment naming it
   editor-only. Verify empirically by saving a link-grouped file and
   loading it in EaW/FoC (testing step §5).

9. **Group ID exhaustion.** `uint32_t`, allocated as `max + 1` across
   live emitters, retired on dissolve, never reused within a session.
   Theoretical overflow at 4 billion creates per session.
   *Mitigation — accepted, no design effort*. Not worth designing
   around.

10. **Performance of propagation in `CaptureUndo`.** O(siblings ×
    params) per edit; params ≈ 50 scalars + 7 track keymaps × small
    key counts. Cheap in absolute terms.
    *Mitigation — accepted, no preemptive work*. Profile only if a
    user reports lag with very large groups.

11. **Multiple editor windows.** Each `APPLICATION_INFO` owns its own
    `ParticleSystem` — link groups are intrinsically per-system. No
    cross-window contamination possible by construction.
    *Mitigation — none needed*; included for completeness.

12. **Multi-select fighting the tree's built-in single-select.** The
    Win32 tree control's default behaviour resets selection on every
    click, and `TVN_SELCHANGING` fires before we see modifier keys
    cleanly. Hand-rolled multi-select can drift out of sync with the
    primary selection (e.g. arrow-key navigation moves the primary
    but leaves the multi-set untouched, or vice versa).
    *Mitigation — invariants enforced on every selection update*:
    a single helper `UpdateMultiSelection(primary, modifiers)` is the
    only writer; it always re-establishes `multiSelection.contains
    (primary)`. Arrow-key navigation routes through the same helper
    (synthesise a "plain click" on the new primary). `#ifndef NDEBUG`
    assert in the helper: `multiSelection` is non-empty iff
    `primary != nullptr`, and `multiSelection.contains(primary)`.
    Fall-back if drift still occurs: a `RebuildMultiSelectionFromPrimary()`
    that clears multi to just `{primary}`, called from any handler
    that's unsure of state.

13. **Custom-draw painting cost / flicker / scroll glitches.** Heavy
    work in `NM_CUSTOMDRAW` can cause perceptible flicker on scroll
    or when many items repaint; misplaced rectangles leave artefacts.
    *Mitigation — bounded work + clipping*: the bracket pass is O(groups
    × visible members) per paint, capped by `MAX_LANES = 4`. Use
    `TreeView_GetItemRect` only for items returning a visible rect;
    clip drawing to the tree's client rect via `SelectClipRgn` before
    drawing the vertical bracket lines. If flicker proves visible
    after a smoke test, enable `TVS_EX_DOUBLEBUFFER` on the tree
    (single `TreeView_SetExtendedStyle` call, no other code changes).
    Document the toggle in CHANGELOG.

14. **HiDPI / theme rendering.** Hard-coded pixel widths and palette
    colours can render poorly on 150–200% scaling or under high-
    contrast themes.
    *Mitigation — DPI-aware constants + theme-tested palette*:
    derive lane width, tick length, dot radius, and stroke width
    from `GetDpiForWindow()` at paint time (scale base values by
    `dpi / 96`). Query `GetSysColor(COLOR_HIGHLIGHT)` and use it as
    the secondary-select background instead of a hard-coded blue.
    Pick the 12-colour palette by hand-testing against both the
    default light tree-background and a high-contrast theme's
    window-colour, ensuring each colour passes a minimum contrast
    threshold (WCAG AA ≈ 4.5:1) against both. *No theme-based
    suppression*: the bracket draws under every theme; the palette
    earns its place by being legible.

15. **Unbounded concurrent groups.** With no lane cap, an unusually
    busy file (say 20+ concurrently-overlapping link groups) could
    chew up the entire right margin and crowd row text.
    *Mitigation — dynamic lane sizing with a soft margin budget*:
    lane width starts at 6 px (DPI-scaled) and shrinks proportionally
    once the natural margin reservation would exceed ~25% of the
    tree's client width. Floor of 2 px per lane. Below the floor,
    lanes are allowed to overlap with reduced contrast — the per-row
    dot at each member's tick still differentiates groups by colour
    even when the vertical line is partially obscured. *Implicit
    cap by readability, not by code*: the user sees degraded clarity
    long before any catastrophic failure mode. Documented in
    CHANGELOG with a "for very dense link layouts, consider
    separating into multiple files" note.

16. **Multi-select interaction with drag-drop reorder.** The existing
    tree supports drag-drop reorder of single emitters. With multi-
    select, what does "drag the primary" do to the rest?
    *Mitigation — explicit decision, confirmed by user*: drag-drop
    in v1 acts on the primary selection only. The multi-set is
    unaffected by drag. This is the desired behaviour, not a
    fallback: the user wants to position linked emitters independently
    so that interleaved layering (smoke / fire / smoke / fire) is
    achievable. Multi-drag-reorder would actively get in the way of
    that workflow. Documented in CHANGELOG.

17. **Bracket-click conflicting with the tree's built-in click handling.**
    Clicking a dot or bracket line needs to suppress the tree's
    default "click selects this row" behaviour, otherwise the click
    would both select-the-group AND change-the-primary-to-the-clicked
    row in a way that fights itself.
    *Mitigation — hit-test before forwarding*: `WM_LBUTTONDOWN` handler
    calls `HitTestBracket(clientPt)` first. If the hit is `Dot` or
    `Line`, the handler returns without forwarding the message to the
    tree's default procedure (or to `CallWindowProc` if subclassed).
    The handler itself sets the primary via `TreeView_SelectItem`, so
    the inspector pane updates. If the hit is `None`, message
    forwards unchanged and the tree handles selection normally.
    `#ifndef NDEBUG` assert: after a bracket-click, `multiSelection`
    equals the group's full member list and `primary` is its topmost
    visible member.

18. **Hover flicker / leak from missed `WM_MOUSELEAVE`.** If
    `TrackMouseEvent` registration is forgotten or the message is
    swallowed (some hooks eat `WM_MOUSELEAVE`), the hover tint can
    "stick" after the cursor has left the tree.
    *Mitigation — defensive clear on focus loss + paint*: clear
    `hoveredGroupId` in the `WM_KILLFOCUS` handler too, and re-arm
    `TrackMouseEvent` at the start of each `WM_MOUSEMOVE` (the
    `TME_LEAVE` registration is one-shot; re-arming is the documented
    Win32 pattern). `#ifndef NDEBUG` log on every hover state
    transition tag `[Link]` to surface stuck-state quickly during
    development.

19. **Auto-dissolve on remove surprising the user.** "Remove from
    link group" silently dissolving a 2-member group could feel like
    losing state if the user expected the group to remain "as a
    1-member group I'll add to later."
    *Mitigation — explicit feedback + undo safety*: the menu item
    label changes dynamically when removal would auto-dissolve:
    *"Remove from link group (dissolves Group N)"*. The action is a
    single undo step that fully restores the 2-member group on Undo,
    so any surprise is cheap to reverse. Documented in the CHANGELOG.

### Regression coverage

A scripted `.alo` fixture in `tasks/` (precedent:
[`tasks/build_dual_life_fixture.py`](tasks/build_dual_life_fixture.py))
producing a 3-emitter system with 2 linked + 1 unlinked. Test script
exercises:

- save → reload → assert linked emitters' non-exempt fields match
- mutate emitter A → save → reload → assert B still in sync
- delete linked emitter B → save → reload → assert A's group has
  shrunk to one member; reload again and assert state is stable
- duplicate a linked emitter via NT-4 path → assert the new emitter
  has `linkGroup == 0`

Becomes the smoke test for every future code change in this area.

## 5. Testing & verification

Manual checklist. Each line is a verifiable claim.

**Happy paths:**
- [ ] System with emitters A/B/C. Right-click A → Create link group.
  A's tree row shows `[L1]` and a one-tick coloured marker in the
  right margin.
- [ ] Right-click B → Add to link group → Group 1. Confirmation
  appears (or is auto-skipped if params already matched); accept.
  B's tree row shows `[L1]`. Bracket extends to connect A and B.
  B's gravity now matches A's.
- [ ] Multi-select A and B with Ctrl-click (both unlinked) →
  Right-click → "Link selected". One new group created with both
  emitters; bracket appears.
- [ ] Multi-select A, B, C with Ctrl-click → "Link selected". All
  three in one group; bracket spans all three rows.
- [ ] Edit A's gravity. B matches A; C unchanged.
- [ ] Edit A's `colorTexture`. B's `colorTexture` unchanged (exempt).
- [ ] Edit A's `TRACK_INDEX` keys. B's `TRACK_INDEX` unchanged (exempt).
- [ ] Edit A's red curve. B's red curve matches A.
- [ ] Edit A's scale curve via the curve editor. B matches A.
- [ ] Edit A's random-rotation flag. B matches.
- [ ] Add C to the group with confirmation. C's params overwrite to
  match A/B.
- [ ] Save → close → reopen. All three still in `[L1]`. Edit A's
  lifetime; B and C update.

**Edge cases:**
- [ ] Drag-drop reorder linked emitters in the tree. Group integrity
  preserved; `[L]` tags still correct.
- [ ] Delete one linked emitter (B). A and C still in `[L1]`.
- [ ] Delete the last member of a group. Group ID retired; next Create
  gets a fresh ID.
- [ ] Existing Duplicate menu on a linked emitter → new emitter has
  no `[L]` tag.
- [ ] Duplicate-with-index (NT-4) on a linked emitter → new emitter
  unlinked; the group's existing members are untouched.
- [ ] Copy a linked emitter, paste into a second editor window → paste
  arrives unlinked.

**Multi-select behaviour:**
- [ ] Plain click on an emitter: `multiSelection = {that}`.
- [ ] Ctrl-click adds to set; Ctrl-click same item again removes it.
- [ ] Shift-click selects pre-order range from anchor to clicked item.
- [ ] Arrow-key navigation moves the primary AND replaces the multi-set
  with `{newPrimary}` (Explorer-style; documented behaviour).
- [ ] Drag-drop reorder on a multi-selected primary moves only the
  primary — secondary multi-selection is untouched.
- [ ] Right-click on the primary preserves multi-selection while the
  menu is up; "Link selected" reflects the multi-set count.

**Visual link bracket:**
- [ ] One group with 2 visible members → vertical bracket connects
  the two rows in lane 0; dots at both members; horizontal stubs
  point toward row text.
- [ ] Scroll the tree; bracket repaints correctly each frame, no
  artefacts.
- [ ] Collapse a parent containing a linked emitter → that member
  contributes nothing to the bracket; bracket re-spans the remaining
  visible members.
- [ ] Two overlapping groups (interleaved members, e.g. smoke at
  rows 1/3/5 and fire at rows 2/4/6) → each gets its own lane,
  drawn in distinct colours.
- [ ] Two non-overlapping groups (stacked, e.g. smoke at rows 1–5
  and fire at rows 10–15) → both placed in lane 0 (interval-
  scheduling reuse). Distinct colours, blank vertical space between
  the two spans.
- [ ] Sparse membership (group A at rows 1, 5, 9; rows 2–4 and 6–8
  unlinked) → solid vertical line spans rows 1–9 in lane 0, dots
  only at 1/5/9.
- [ ] Twelve concurrent groups → all twelve drawn, lane width may
  shrink, no crash, no truncation of group membership data.
- [ ] Twenty concurrent groups (palette wraps) → all drawn, colours
  repeat from the palette but adjacent same-colour groups land in
  different lanes when the assignment allows.
- [ ] HiDPI 175% scaling: lane widths, dot radii, stub lengths, and
  stroke widths all scale up.
- [ ] High-contrast theme active: bracket still drawn, palette
  colours legible against the theme background, `[L<n>]` prefix
  also present.

**Bracket interactivity:**
- [ ] Hover a dot → all member rows of that group tint with the
  group's colour at low opacity; bracket line thickens.
- [ ] Hover a vertical line (between dots) → same as hovering a dot
  in that group.
- [ ] Move cursor out of the tree control → hover tint clears within
  one paint.
- [ ] Hover-switch from group A to group B (cursor moves directly
  from A's dot to B's dot) → only A's old members and B's new
  members repaint; no flicker on unaffected rows.
- [ ] Click a dot → `multiSelection` becomes that group's full member
  list; primary = topmost visible member; inspector pane shows the
  primary's values.
- [ ] Click a vertical line → same effect as clicking a member dot
  of that group.
- [ ] Click outside any bracket (e.g. on row text) → existing tree
  selection behaviour, multi-set replaced by `{clicked}`.

**Group minimum-size rules:**
- [ ] Single-emitter selection with no existing groups → no link
  menu items appear at all.
- [ ] Two-member group → "Remove from link group" menu item label
  reads *"Remove from link group (dissolves Group N)"*.
- [ ] Apply that Remove → both emitters become unlinked; group ID
  retires; Undo restores both as group members.
- [ ] Three-member group → remove one → group survives with two
  members; menu label on remaining members no longer mentions
  dissolve.

**Cancellation / refused inputs:**
- [ ] Add-to-group dialog → Cancel → no state change, no undo entry
  pushed.
- [ ] Right-click an unlinked emitter → Remove and Dissolve menu items
  are disabled.
- [ ] "Link selected" disabled when multi-set is empty or has only
  one member.

**Undo round-trip:**
- [ ] Edit A's gravity (linked). Undo → A and B both revert. Redo →
  both reapply.
- [ ] Create link group → Undo → group gone. Redo → group back with
  the same ID.
- [ ] Join group → Undo → joiner unlinked, joiner's pre-join params
  restored. Redo → joined again.
- [ ] Dissolve group → Undo → all members re-linked with the same ID.

**Cleanup:**
- [ ] After dissolving a group, save → reload → no `EMITTER_LINKGROUP`
  chunks on any emitter (writer skips when `linkGroup == 0`).
  Verified with a hex diff against a minimal pre-feature save.

**Backwards compatibility:**
- [ ] Open an old particle file. All emitters unlinked. No crash, no
  `[L]` tags.
- [ ] Save the same file unchanged → byte-identical (or only the
  pre-existing whitespace/timestamp churn) compared to the original.

**Game engine smoke test:**
- [ ] Load a saved-with-link file in EaW/FoC. Particles render
  identically to the same effect without link metadata.

**Debug instrumentation:**
- `#ifndef NDEBUG` log lines:
  - `[Link] propagate group=N members=M edited=name` in `CaptureUndo`
  - `[Link] create/join/leave/dissolve group=N` in the four menu
    handlers
  - `[Link] auto-dissolve group=N (removal would leave 1)` in the
    Remove handler when this branch fires
  - `[Link] hover group=N (was M)` on hover-state transitions
  - `[Link] click select group=N members=M` on bracket-click
  - `[Link] detach (was group=N)` in `Emitter::detachFromLinkGroup()`
- `#ifndef NDEBUG` invariant asserts (per mitigations 4, 6, 7):
  - In `CaptureUndo` after propagation: all group members have
    byte-identical non-exempt fields
  - In duplicate / paste finalisers: newly-constructed emitter has
    `linkGroup == 0`
  - In emitter deletion: no surviving emitter holds an orphan group ID
- Grep tag: `[Link]`.

**Regression fixture** (per §4 closing block): `tasks/build_link_group_fixture.py`
builds a 3-emitter `.alo` with 2 linked + 1 unlinked, plus a replay
script that round-trips the file through the editor's save/load and
asserts the four properties listed in §4.

---

## Review (post-ship)

**What landed**: §1 In list except for tree multi-select and the visual
link bracket. The plan's "Out" deferrals (per-field exempt
configurability, cross-file linking, in-viewport highlighting,
multi-direction merge UI) remain Out.

**What was deferred to a future PR (mention in CHANGELOG)**:

- **Tree multi-select** (plan §3.5(a)) — *"Ctrl-click N emitters, Link
  selected in one step"* workflow. The data model and helpers
  (`CreateLinkGroup` taking a `std::vector<Emitter*>`) already accept
  N members; only the UI plumbing is missing.
- **Visual link-group bracket** (plan §3.5(d)) — lane-allocated
  colour-coded bracket in the tree's right margin, with greedy interval
  scheduling and an unbounded lane count. Includes hover-highlight and
  click-to-select-group from §3.5(e).
- **Per-field configurable exempt set** — exempt set is hard-coded in
  v1 to texture filenames + atlas index curve + name; the
  `LinkExemptFlags` struct is ready for runtime toggles.
- **Regression fixture script** (`tasks/build_link_group_fixture.py`)
  — deferred until at least one of the above lands and there's enough
  surface area to make a scripted round-trip worth maintaining.

**Deviations from the plan worth recording**:

- Tier tag changed from the plan's `MT-5` (which was occupied by an
  already-shipped item) to `MT-7`. The plan text still says `MT-5`
  because it was written before the audit; the ROADMAP and CHANGELOG
  carry the correct `MT-7`.
- Plan §3.5(c) said *"Skipped entirely for Create"* — i.e. no
  confirmation when linking two unlinked emitters. Per user direction
  during testing, added a matching `ConfirmLinkOverwrite` dialog to
  the Link-with path so both Create and Join show the diff and the
  overwrite direction. Dialog wording shifted from the plan's draft
  *"This emitter's parameters differ from Group N's. Joining will
  overwrite N field(s)…"* to the plainer *"X will be overwritten to
  match Y. Affected fields (N): …"* form (Option A from the design
  discussion).
- Menu UI built dynamically per right-click rather than statically in
  the `.rc` file. Saved touching both `.en.rc` and `.de.rc` and made
  the gating logic naturally driven by selection state. The static
  menu's last entry (`ID_EDIT_DELETE`) serves as the cleanup-walk
  sentinel.
- Used existing copy-and-restore pattern (operator= + offset
  arithmetic into `trackContents`) for `copySharedParamsFrom` instead
  of writing the field-by-field copy the plan hedged toward. The
  existing pattern handles aliasing correctly because the Duplicate
  path has been using it since PR #19.

**Actual effort**: ~5 hours (against 16–24h estimate). The plan's risk
list and pre-coding survey both paid off — `CaptureUndo` was confirmed
as the universal chokepoint up front, the load-time `CaptureUndo` was
spotted in the survey so no new pre-action capture was needed, and the
copy-and-restore pattern reused tested code rather than writing
field-by-field. The deferred multi-select + visual bracket work
accounts for most of the gap between estimate and actual.

**Bugs caught pre-ship in the audit**:

1. Double-free in dynamic menu cleanup (`DestroyMenu` + `DeleteMenu`
   on the same popup). Fixed.
2. Unused `affectedGroup` variable left over from an earlier draft of
   the Remove handler. Fixed.
3. Dead forward declaration of `EmitterListControl` at the top of the
   file. Removed.
