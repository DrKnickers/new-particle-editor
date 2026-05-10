# Plan: Drag-and-drop to reparent (make an emitter a child of another)

ROADMAP entry: near-term, ★★★★☆ (4/5), 6-10 hours estimated. Extends
the drag-drop reorder work from PR #35.

## Goal

Drop emitter S onto emitter T to make S a child of T (occupying T's
`spawnDuringLife` or `spawnOnDeath` slot). The full subtree under S
moves with it. If S was a root, S is no longer a root. If S was a
child of some other emitter P, S is detached from P (P's spawn slot
that referenced S becomes -1) and reattached to T.

This is "extension" — not "replacement" — of PR #35. Drop *between
gaps* still does reorder (root sources only); drop *onto an emitter*
is the new reparent gesture.

## Scope

**In:**

- Drop S onto T → reparent. S can be a root or a child.
- Slot decision:
  - **Both T slots free** → small popup menu at the cursor: "Reparent
    as Lifetime child" / "Reparent as Death child" / cancel.
  - **One T slot free** → use that slot; no popup.
  - **Both T slots occupied** → `IDC_NO`, refuse.
- Visual feedback when hovering an "onto" target: `TVIS_DROPHILITED`
  on the target item via `TreeView_SetItem`. Insertion mark cleared.
- Three-zone hit-test on each item rect: top 1/3 = insert-above,
  middle 1/3 = drop-onto, bottom 1/3 = insert-below.
- Cycle protection: drop on self / on a descendant / on the source's
  current parent → all refused with `IDC_NO`.

**Out (refused with `IDC_NO` or skipped):**

- **Drop a child between root gaps** (would mean "promote to root +
  reorder"). Refuse for v1; user can still right-click → Cut → Paste
  to do the same effect manually. Could land as a follow-up PR.
- **Drop onto same parent** (slot-switching: source already at
  spawnDuringLife, drop onto same parent picking spawnOnDeath). Refuse
  to keep semantics simple. Document as known limitation.
- Multi-select drag.
- Auto-expand of collapsed targets on hover (Win32 trees don't do this
  by default; not adding it).

## What the codebase already gives us

- **`ParticleSystem::deleteEmitter`** already shows the index-rewrite
  pattern for invalidating a parent's spawn-field reference and
  fixing up indices when an emitter leaves a slot. Reparent does the
  detach half of that.
- **`ParticleSystem::addLifetimeEmitter` / `addDeathEmitter`** show
  the attach side — set `parent->spawnXxx = child->index`, set
  `child->parent = parent`. We don't need to allocate a new emitter,
  but the linkage code is the model.
- **`OnParticleSystemChange`** rebuilds the tree from
  `parent==NULL` roots and descends via spawn fields. Reparent must
  ensure (a) source's old parent's slot is cleared so source isn't
  reachable from its old subtree, AND (b) target's slot is set so
  source IS reachable from its new subtree. Otherwise source becomes
  orphaned (visible nowhere).
- **`EndDrag` + `WM_CAPTURECHANGED` backstop + `EmitterList_IsDragging`
  accelerator gate** from PR #35 carry over unchanged. The
  `dragInProgress` semantic still applies during the slot-picker
  popup.
- **`TrackPopupMenuEx` + `TPM_RETURNCMD`** is already the in-house
  pattern for context menus — see
  [`EmitterList.cpp:828, 902`](src/UI/EmitterList.cpp:828) for the
  emitter context menu and the new-emitter dropdown.

## API changes

### One new `ParticleSystem` method

```cpp
// Reparent `source` (must be in this system) so it becomes a child of
// `target` via `target->spawnDuringLife` (if useSpawnDuringLife is
// true) or `target->spawnOnDeath` (false). The full subtree under
// source is preserved — children stay attached to source.
//
// Validation:
//   - source != NULL, target != NULL, source != target
//   - target's chosen slot must currently be -1 (free)
//   - target must not be a descendant of source (cycle check)
//   - source's old parent's spawn slot referencing source is cleared
//     to -1 as part of the operation
//
// Returns true on success, false on any validation failure (the
// system is left untouched).
//
// Doesn't relocate source within m_emitters; addLifetimeEmitter /
// addDeathEmitter already establish that the vector layout doesn't
// follow tree layout, so leaving source in place avoids unrelated
// index churn.
bool reparentEmitter(Emitter* source, Emitter* target, bool useSpawnDuringLife);
```

### A new helper (internal to ParticleSystem.cpp)

```cpp
// True if `candidate` is `ancestor` or appears anywhere in
// `ancestor`'s subtree (reachable via spawn fields). Cheap O(depth)
// walk via parent pointers — and source's parent chain is bounded
// by the number of emitters, which is in the dozens at most.
static bool IsInSubtreeOf(const Emitter* candidate, const Emitter* ancestor);
```

Implementation walks `candidate->parent` chain looking for `ancestor`
(or `candidate == ancestor` as the trivial case). Equivalent to
checking `candidate` is reachable from `ancestor` via spawn fields,
just done bottom-up.

### Two new menu strings (en.rc + de.rc)

```
IDS_MENU_REPARENT_LIFETIME  "Reparent as &Lifetime child"
IDS_MENU_REPARENT_DEATH     "Reparent as on-&Death child"
```

Plus the corresponding ID_REPARENT_AS_LIFETIME / ID_REPARENT_AS_DEATH
WM_COMMAND IDs in `resource.en.h` / `resource.de.h`. The popup itself
is built at runtime via `CreatePopupMenu` + `AppendMenu` (no new
.rc resource needed; same approach used for some existing dynamic
context entries).

## State-machine extensions

Existing fields on `EmitterListControl` (from PR #35):

```cpp
ParticleSystem::Emitter* dragSource;
HIMAGELIST               dragImageList;
HTREEITEM                dragInsertTarget;   // insertion-mark anchor
bool                     dragInsertAfter;
UINT_PTR                 dragScrollTimer;
int                      dragScrollDir;
```

New field:

```cpp
HTREEITEM                dragDropHighlight;  // currently TVIS_DROPHILITED'd item, NULL if none
```

The existing `DropTarget` struct grows a kind field:

```cpp
enum DropKind {
    DROP_INVALID,
    DROP_BETWEEN_GAP,    // existing reorder semantic
    DROP_ONTO_EMITTER,   // new reparent semantic
};

struct DropTarget {
    DropKind  kind;
    HTREEITEM hTarget;                          // tree item the action concerns; NULL when DROP_INVALID
    size_t    gap;                              // valid for DROP_BETWEEN_GAP
    bool      after;                            // valid for DROP_BETWEEN_GAP
    ParticleSystem::Emitter* targetEmitter;     // valid for DROP_ONTO_EMITTER
};
```

`ComputeDropTarget` upgrades from the existing four-zone enumeration
(above-first / between / below-last / over-child / outside) to a
five-zone enumeration that uses **thirds** within each item's rect:

- Top 1/3 → insertion-mark above.
- Middle 1/3 → drop onto.
- Bottom 1/3 → insertion-mark below.

For a `DROP_ONTO_EMITTER` target, validity is computed eagerly by
`UpdateDropFeedback` (renamed from `UpdateInsertMark`):

- Refuse if source == target.
- Refuse if target is in source's subtree (cycle).
- Refuse if target IS source's current parent (slot-switching case).
- Refuse if target's both spawn slots are occupied.

Otherwise valid. The visual feedback then sets `TVIS_DROPHILITED` on
the target item; the insertion mark is cleared. `IDC_NO` cursor on
invalid drops; default cursor on valid drops.

For `DROP_BETWEEN_GAP`, source-must-be-root rule from PR #35 stays —
between-gap drops with a child source get `IDC_NO`.

## Drop-commit flow

`WM_LBUTTONUP`:

```cpp
DropTarget t = UpdateDropFeedback(control, pt);
ParticleSystem::Emitter* moved = control->dragSource;
bool committed = false;

// Tear down visual feedback BEFORE the slot-picker popup so the
// ghost / insertion mark / drop-highlight don't linger. Keep
// dragSource set so EmitterList_IsDragging still returns true and
// the accelerator gate keeps Ctrl+Z out of our hair during the popup.
ImageList_DragLeave + ImageList_EndDrag + ImageList_Destroy;
TreeView_SetInsertMark(NULL); ClearDropHighlight(control);
ReleaseCapture(); KillTimer(autoscroll);

if (t.kind == DROP_ONTO_EMITTER && t.targetEmitter != NULL) {
    bool useSpawnDuringLife = false;
    bool slotADL = (t.targetEmitter->spawnDuringLife == (size_t)-1);
    bool slotADD = (t.targetEmitter->spawnOnDeath    == (size_t)-1);
    if (slotADL && slotADD) {
        // Popup. TPM_RETURNCMD so we get the picked ID directly.
        // Returns 0 on cancel (Esc / click outside).
        useSpawnDuringLife = ShowSlotPickerPopup(...);
        if (cancelled) goto cleanup;
    } else {
        useSpawnDuringLife = slotADL;  // pick the only free slot
    }
    committed = system->reparentEmitter(moved, t.targetEmitter, useSpawnDuringLife);
}
else if (t.kind == DROP_BETWEEN_GAP && moved->parent == NULL) {
    committed = system->moveEmitterToRootIndex(moved, t.gap);
}

cleanup:
control->dragSource = NULL;  // now EmitterList_IsDragging returns false
... clear other state fields ...

if (committed) {
    OnParticleSystemChange(control, control->system);
    re-select moved via FindTreeItemByEmitter;
    NotifyParent(control, ELN_LISTCHANGED);
}
```

The crucial bit is the **`dragSource` field timing**: we tear down
visual feedback before the popup, but keep `dragSource` set until the
popup returns, so the accelerator gate (`EmitterList_IsDragging`)
keeps Ctrl+Z / Ctrl+S / etc. blocked during the popup. The capture
release before the popup is necessary because `TrackPopupMenuEx`
takes its own capture.

## Risks and mitigations

### 1 — Cycle detection bug → infinite recursion in `deleteEmitter`

`deleteEmitter` recurses via `spawnDuringLife` / `spawnOnDeath`.
`OnParticleSystemChange_AddChildren` does the same. If reparent
introduces a cycle (S becomes child of T, but T is in S's subtree),
either of those will spin forever / blow the stack.

**Mitigation**:
- `IsInSubtreeOf(target, source)` walks via parent pointers (bottom-
  up), so it can't itself recurse into a malformed cycle. Caught
  before mutation.
- Belt-and-braces: even after the up-front check, `reparentEmitter`
  re-validates the cycle property as the very last step before
  mutation. Defensive but cheap.
- Manual test cases: drop on self, on direct child, on grandchild,
  on great-grandchild, on a sibling-of-self that has source's other
  sibling under it (sanity).

### 2 — Detach goes wrong → orphan emitter

If we don't clear the old parent's spawn slot during detach, the
old parent will still reference source's index. After reparent, both
old parent's and new parent's spawn fields will point at source.
The tree-rebuild then visits source twice — once under old subtree,
once under new — and TreeView_InsertItem with the same lParam fires
twice, leaving dangling state. Or maybe just visual duplication.

**Mitigation**:
- Explicit comparison in `reparentEmitter` for which slot (Lifetime
  vs Death) the old parent had source in. Don't rely on assumption.
- Test case: drag a child from `spawnDuringLife` to a new target
  with `spawnOnDeath` free. Verify old parent's `spawnDuringLife`
  becomes `-1` and source ONLY appears under the new target in the
  rebuilt tree.

### 3 — Dropping source onto its current parent

Detach + reattach to same parent is mechanically valid (the old slot
clears, the new slot fills, possibly different slot than before).
But it's confusing UX — "I dragged my child onto its parent, what
just happened?"

**Mitigation**: explicitly refuse this case in `UpdateDropFeedback`'s
validity check. `IDC_NO` cursor when source.parent == target. User
sees clearly that the gesture has no effect. Documented as a
known-limitation in the CHANGELOG.

### 4 — TrackPopupMenu interferes with capture / accelerator state

`TrackPopupMenuEx` runs its own modal pump and takes its own mouse
capture. If we still had the drag's mouse capture, it'd be
overridden, firing `WM_CAPTURECHANGED` to our subclass mid-popup.
Our handler would then call `EndDrag`, which would clear
`dragSource` — but the popup hasn't returned yet, so the accelerator
gate would re-enable, and a stray accelerator could hit before we
finish committing.

**Mitigation**:
- Release capture and tear down image list / insertion mark / etc.
  *before* `TrackPopupMenuEx`. The visual feedback was already
  torn down anyway because the user has clicked.
- Keep `dragSource` set until the popup returns and we've decided
  what to commit. `EmitterList_IsDragging` still returns true; the
  accelerator gate keeps Ctrl+Z blocked.
- The `WM_CAPTURECHANGED` we'll inevitably receive when the popup
  takes capture is a harmless no-op because EndDrag is idempotent
  AND because we've already released our capture by that point —
  `GetCapture() == hTree` is false, so the cleanup is mostly
  no-ops. The `dragSource = NULL` line in EndDrag would clear our
  flag prematurely, though, which is the actual bug. **Fix**: split
  EndDrag into `EndDragVisual()` (capture, image list, insertion
  mark, highlight, timer) and `EndDragLogical()` (clears
  `dragSource`). Visual cleanup is idempotent; logical cleanup
  happens exactly once at the very end of `WM_LBUTTONUP`'s flow.
  `WM_CAPTURECHANGED` calls EndDragVisual only.

### 5 — Stale `TVIS_DROPHILITED` on old target

User drags over item A → highlight A. Cursor moves to item B →
need to clear A and highlight B. If we forget the clear, both look
highlighted.

**Mitigation**:
- Track currently-highlighted item in
  `control->dragDropHighlight`. Before setting a new one, clear the
  old one. Always clear on EndDragVisual.

### 6 — Reparenting a root with no children = degenerate

If S was a single-emitter root (no subtree), reparent is just "S
becomes T's child." Mechanically same as the subtree case; the
"subtree" is just S alone. No special-casing needed.

### 7 — Slot-picker popup at edge of screen

`TrackPopupMenuEx` repositions automatically if the cursor is too
close to a screen edge. No mitigation needed — Win32 handles it.

### 8 — Right-click during drag

The user could right-click while dragging. Tree's default behavior
on right-click is to show the context menu, which would conflict
with our drag. Capture is on the tree, so right-click WM_RBUTTONDOWN
goes to our subclass — by default we don't handle it, fall through
to default tree proc, which... might or might not pop the context
menu.

**Mitigation**: explicitly handle `WM_RBUTTONDOWN` in the subclass
during drag — treat as cancel (`EndDrag` + return 0). Right-click
shouldn't be a drag-drop interaction.

### 9 — User scrolls the tree during drag (mousewheel)

Tree handles mousewheel natively — items scroll. The drag-image
ghost stays anchored to the cursor (we re-anchor on each
`WM_MOUSEMOVE`), but the insertion mark / drop-highlight need to
recompute. WM_MOUSEMOVE doesn't fire on a wheel event with a
stationary cursor.

**Mitigation**: handle `WM_MOUSEWHEEL` in the subclass during drag.
After forwarding to default proc (so the tree scrolls), recompute
drop feedback as if a mousemove happened.

### 10 — Engine-instance staleness after reparent

After reparent, the engine's live `EmitterInstance`s reference the
old parent / spawn-field structure. Specifically: if a parent had a
particle alive when the user reparented its child away, the parent's
existing `EmitterInstance::m_emitter.spawnDuringLife` is now -1. The
parent's existing live particles' `m_childEmitter` field points at
already-spawned child instances which are still alive — those don't
get re-evaluated.

This is consistent with how every other structural change works in
this codebase: live instances continue with their spawned children;
new particles spawned after the change pick up new structure.
Engine::OnParticleSystemChanged is called on `ELN_LISTCHANGED` to
re-sync. **Mitigation**: same pattern as PR #25's reorder and
PR #35's reparent — fire `ELN_LISTCHANGED` post-commit, let the
existing pump handle it.

### 11 — Re-entry into reparentEmitter via the popup's modal pump

The popup is modal; while it's up, the tree window doesn't process
its own messages. Our subclass can't get re-entered. Safe.

### 12 — Source = dialog's "selected" emitter is now a non-root

Toolbar's Move Up / Move Down state is recomputed on
`ELN_LISTCHANGED` + `ELN_SELCHANGED` based on whether the current
selection is a root. After reparent, the moved emitter is no longer
a root, so the buttons grey out correctly.

**Mitigation**: nothing extra. Existing logic in
[`EmitterList.cpp:80-93`](src/UI/EmitterList.cpp:80) already
recomputes per-selection state on every `ELN_LISTCHANGED` /
`ELN_SELCHANGED`. Verified by smoke test.

### 13 — Undo of a reparent

The undo system captures the whole `ParticleSystem` via
`ELN_LISTCHANGED`. Reparent fires that notification → one undo entry
→ Ctrl+Z reverts the entire reparent in one step. Already
covered by PR #31's snapshot mechanism. **Mitigation**: just verify
in the smoke checklist.

## Process-level mitigations spanning multiple risks

- **Single canonical commit/cleanup flow** for `WM_LBUTTONUP` —
  one function (`CommitDrop` or inline) so the popup-or-no-popup
  branch and the cancel-via-popup-Esc path all converge into a
  single "clear drag state, optionally rebuild + re-select +
  notify" tail.
- **Split EndDrag into Visual + Logical** as in Risk #4. Visual
  cleanup is idempotent and safe to call from
  `WM_CAPTURECHANGED` mid-popup. Logical cleanup
  (`dragSource = NULL`) is deferred to the very end so the
  accelerator gate stays armed.
- **Reuse `EmitterList_SelectEmitter`** (PR #31) for re-selecting
  the moved emitter after rebuild. No new selection helper needed.

## Testing & verification

Drive on `P_explosion_med06.alo` (sparks → smoke trail, plus 6
standalone roots) and a synthetic 3-deep tree (A → B → C).

### Happy paths

- [ ] Drag root R onto root T (T's both slots free) → popup; pick
      Lifetime → R becomes T's spawn-during-life child; subtree
      preserved; tree shows R under T.
- [ ] Same, but pick Death → R becomes T's spawn-on-death child.
- [ ] Drag root R onto root T (T's spawnDuringLife free, spawnOnDeath
      occupied) → no popup; auto-pick Lifetime; reparent succeeds.
- [ ] Drag root R onto root T (only spawnOnDeath free) → auto-pick
      Death.
- [ ] Drag root R with subtree (R has children) onto root T → R's
      whole subtree moves under T; R's children's `parent` still
      resolves to R; R's `spawnDuringLife`/`spawnOnDeath` unchanged.
- [ ] Drag child C onto root T → C detaches from old parent (old
      parent's slot becomes -1), C reattaches under T.
- [ ] Drag child C onto another child D (D has free slot) → reparent;
      both detach+attach work.
- [ ] After reparent, drop the moved emitter onto its old parent's
      old slot (now free) → reparent back. Verify round-trip.

### Refused targets

- [ ] Drag onto self → `IDC_NO`, no commit.
- [ ] Drag onto direct child → `IDC_NO` (cycle).
- [ ] Drag onto grandchild → `IDC_NO` (cycle).
- [ ] Drag onto great-grandchild → `IDC_NO` (cycle).
- [ ] Drag onto current parent → `IDC_NO` (out-of-scope slot-switch).
- [ ] Drag onto target with both slots occupied → `IDC_NO`, no popup.

### Slot picker

- [ ] Both slots free → popup appears at cursor; both menu items
      enabled.
- [ ] Pick Lifetime → reparent commits; spawnDuringLife = source.
- [ ] Pick Death → reparent commits; spawnOnDeath = source.
- [ ] Press Esc in popup → no commit; tree unchanged.
- [ ] Click outside popup → no commit.
- [ ] Popup near screen edge → repositions automatically (Win32).

### Coexistence with reorder

- [ ] Drag a root between two other roots (top 1/3 or bottom 1/3
      of an item's rect) → reorder, NOT reparent (same as PR #35).
- [ ] Drag a root onto middle 1/3 of an item → reparent.
- [ ] Drag a root above the first root (cursor above all items) →
      reorder to position 0.
- [ ] Drag a child between gaps → `IDC_NO` (out of scope:
      promote-to-root).

### Cancellation

- [ ] Esc mid-drag (before mouse-up) → no change, no leak.
- [ ] WM_CAPTURECHANGED mid-drag → cancel, EndDragVisual fires.
- [ ] Right-click mid-drag → cancel.
- [ ] Mousewheel mid-drag → tree scrolls, drop feedback recomputes.

### Undo / redo

- [ ] Reparent root onto root, Ctrl+Z → S back to root, T's slot
      back to -1. Selection lands on S.
- [ ] Reparent child between parents, Ctrl+Z → C back under old P.
- [ ] Reparent + reparent + Ctrl+Z + Ctrl+Z → fully reverted.
- [ ] Save, reparent, save → asterisk clears at second save.

### Engine-instance behaviour

- [ ] Hold Shift to spawn live preview (root R has children, child
      C is rendering). Reparent C to a different root T. Existing
      live particles continue (don't crash). New Shift+spawn shows
      C under T.

### Edge cases

- [ ] Reparent then immediately File → Open another file → tree
      rebuilds cleanly; no stale state.
- [ ] Drag start, slot-picker open, Alt+Tab away mid-popup → popup
      dismisses (Win32 default); no commit; clean state.
- [ ] 20 reparents in a row → GDI handle count stable in Debug
      build.
- [ ] Reparent in German (`de.rc`) build — same code path; verify
      menu strings show in German.

### Cycle / orphan detection

- [ ] After every reparent in the smoke test above, walk
      `m_emitters` and verify: every non-root emitter is reachable
      from exactly one root via spawn fields; no emitter has
      `parent != NULL` while its parent's spawn fields don't
      reference it.

## Debugging hooks

`#ifndef NDEBUG` printf at:

- `TVN_BEGINDRAG` (existing): also prints whether source is root or
  child.
- `WM_LBUTTONUP` commit: prints "REPARENT src='X' target='Y' slot=L/D"
  or "REORDER src='X' gap=N".
- `reparentEmitter` validation failures: print which check failed
  (cycle / slot-occupied / current-parent).

Tag with `[DnD]` for grep alongside the existing PR #35 logs.

## Implementation order

1. Add `ParticleSystem::reparentEmitter` + `IsInSubtreeOf` helper.
   Unit-style smoke test by re-implementing the existing emitter
   context-menu Cut+Paste flow as a chain of reparent calls.
   Confirm equivalent behaviour in isolation before wiring DnD.
2. Add menu strings + IDs (`ID_REPARENT_AS_LIFETIME`,
   `ID_REPARENT_AS_DEATH`,
   `IDS_MENU_REPARENT_LIFETIME`, `IDS_MENU_REPARENT_DEATH`) in
   en.rc + de.rc + resource.en.h + resource.de.h.
3. Extend `DropTarget` struct with `kind` + `targetEmitter`;
   refactor `ComputeDropTarget` to do thirds-based hit-test;
   rename `UpdateInsertMark` → `UpdateDropFeedback` and add
   drop-highlight handling.
4. Split `EndDrag` into `EndDragVisual` + `EndDragLogical`
   (Risk #4 mitigation).
5. Add `dragDropHighlight` field; clear in EndDragVisual.
6. Add `WM_RBUTTONDOWN` cancel handler (Risk #8) and
   `WM_MOUSEWHEEL` re-feedback handler (Risk #9).
7. Update `TVN_BEGINDRAG` to allow children as source (drop the
   `parent != NULL` refusal). Single-root + label-edit refusals
   stay only for root sources targeting reorder.
8. Update `WM_LBUTTONUP` to dispatch on `t.kind`: reorder for
   between-gap (existing behavior, root sources only); reparent
   for onto-emitter (with slot picker for both-free case).
9. Add `ShowSlotPickerPopup` helper (TrackPopupMenuEx with a
   runtime-built menu).
10. Manual smoke checklist above.
11. ROADMAP strikethrough + ✅ Shipped (#NN). CHANGELOG entry per
    the conventions only after user confirms.

## Estimate

★★★★☆ (4/5), **6-10 hours** consistent with the roadmap. Most of
the time goes into:

- The cycle-and-orphan correctness pass (Risks #1, #2).
- Splitting EndDrag and threading `dragSource` lifetime through
  the popup correctly (Risk #4).
- Smoke testing the full matrix of source-types × target-types
  × slot-occupancy.

The data-layer change (`reparentEmitter`) is mechanically simple —
~30 lines.

---

# Review

(Filled in after implementation lands.)
