# Plan: Drag-and-drop reordering in the emitter tree

ROADMAP entry: near-term, ★★★☆☆ (3/5), 4-6 hours estimated. Reuses
the swap logic from the Move Up / Move Down buttons (PR #25).

## Goal

Let the user pick up a root emitter in the tree, drag it past one or
more sibling roots, and drop it into a new position. Dropping between
two siblings reorders. Dragging is **reorder-only** in this PR —
reparenting (dropping onto another emitter to make it a child) is the
next roadmap entry and stays out of scope.

## Scope (locked in with user)

**In:**

- Drag a root emitter onto a gap between two other roots, or above
  the first root, or below the last root. Drop reorders the source's
  whole subtree as a block.
- Visual feedback: drag-image ghost (`ImageList_BeginDrag` /
  `…DragMove`) **and** insertion-mark line (`TVM_SETINSERTMARK`).
- `IDC_NO` cursor over invalid drop targets.
- Auto-scroll near top / bottom edges (16-pixel hot zones, timer-
  driven at 50 ms).
- Esc cancels mid-drag.
- One Ctrl+Z reverts the whole drop (already handled — drop fires
  one `ELN_LISTCHANGED` which our undo capture treats as a structural
  op, never coalesced).

**Out (deferred):**

- Reparenting (drop-onto-emitter).
- Dragging child emitters as the source — refuse to start.
- Dropping a root *onto* an emitter (not a gap) — `IDC_NO`, no-op.
- Multi-select drag.

## API changes

### One new `ParticleSystem` method

```cpp
// Move `emitter` (must be a root) so its position in the root sequence
// becomes `targetRootIndex` (the N-th root, counting only emitters
// with parent==NULL). Drags the full subtree as a block, mirroring
// moveEmitter's behavior but in one shot rather than swap-by-swap.
//
// Returns true on success, false if the emitter isn't a root, the
// target is out of range, or the move would be a no-op (target
// position == current position).
bool moveEmitterToRootIndex(Emitter* emitter, size_t targetRootIndex);
```

### Removal: `TVS_DISABLEDRAGDROP`

In both [`src/ParticleEditor.en.rc:326`](src/ParticleEditor.en.rc:326)
and [`src/ParticleEditor.de.rc:352`](src/ParticleEditor.de.rc:352).

### One new `APPLICATION_INFO` flag

```cpp
// True while a drag-drop reorder is in progress in the emitter tree.
// Pump checks before TranslateAccelerator to keep destructive
// accelerators (Ctrl+Z, Ctrl+S, Ctrl+N, ...) from firing mid-drag —
// see Risk #8 / mitigation below.
bool dragInProgress;
```

## State machine

`EmitterListControl` gets these fields:

```cpp
ParticleSystem::Emitter* dragSource;        // emitter being dragged
HIMAGELIST               dragImageList;     // owned during drag
HTREEITEM                dragInsertTarget;  // current insertion target
bool                     dragInsertAfter;   // false = above, true = below
UINT_PTR                 dragScrollTimer;   // 0 if no autoscroll active
int                      dragScrollDir;     // -1 = up, +1 = down
```

Idle → Dragging on `TVN_BEGINDRAG`:

1. Pull source from `nmtv->itemNew.lParam`.
2. Refuse if `source->parent != NULL`, or only one root exists, or
   `TreeView_GetEditControl(hTree) != NULL` (label edit active).
3. `SetCapture(hTree)`; `TreeView_CreateDragImage` +
   `ImageList_BeginDrag` + `ImageList_DragEnter`.
4. Set `info->dragInProgress = true`.

Dragging tracking on `WM_MOUSEMOVE`:

1. `ImageList_DragMove(x, y)`.
2. Auto-scroll hot-zone check — start / kill / leave timer running.
3. `ComputeDropTarget(...)` (helper — see Mitigation #5).
4. No-op detection (Mitigation #6) — set `IDC_NO`, clear insertion
   mark.
5. Otherwise `TreeView_SetInsertMark`, default cursor.

Dragging → Idle on `WM_LBUTTONUP`:

1. If valid drop target: `moveEmitterToRootIndex` →
   `OnParticleSystemChange` → re-select + `ELN_LISTCHANGED`.
2. `EndDrag(commit)`.

Cancel paths (all → `EndDrag(false)`):

- Esc in `WM_KEYDOWN`.
- `WM_CAPTURECHANGED`.
- Drop on invalid target / outside tree.

## Auto-scroll

Hot zones: 16 px from top/bottom of tree client area. `SetTimer` at
50 ms while cursor is in zone; `KillTimer` on exit / drag end.

`WM_TIMER` handler does **all four updates atomically** so the ghost
and insertion mark stay synchronized as items scroll under the
cursor (see Mitigation #10):

```cpp
case WM_TIMER:
    if (wParam == AUTOSCROLL_TIMER_ID) {
        SendMessage(hTree, WM_VSCROLL,
                    c->dragScrollDir < 0 ? SB_LINEUP : SB_LINEDOWN, 0);
        POINT pt; GetCursorPos(&pt); ScreenToClient(hTree, &pt);
        UpdateInsertMark(c, pt);              // hit-test + TVM_SETINSERTMARK
        ImageList_DragMove(pt.x, pt.y);       // re-anchor ghost to absolute coords
    }
```

`WM_VSCROLL` is a no-op when at scroll limits; the timer keeps
firing harmlessly until cursor leaves the zone.

---

## Risks and mitigations

### 1, 2, 3 — capture / GDI / timer leaks

Single root cause: any exit path that forgets to clean up. **Three
layered defenses:**

**(a) One canonical cleanup function.** Every exit path —
`WM_LBUTTONUP`, Esc, `WM_CAPTURECHANGED`, drop-outside, drop-on-self
— calls exactly one helper. Each step **null-checks first and
clears after**, so calling `EndDrag` twice is a no-op (handles
`WM_CAPTURECHANGED` followed by a stray `WM_LBUTTONUP`):

```cpp
static void EndDrag(EmitterListControl* c) {
    if (c->dragScrollTimer) { KillTimer(c->hTree, c->dragScrollTimer); c->dragScrollTimer = 0; }
    if (c->dragImageList)   { ImageList_DragLeave(c->hTree); ImageList_EndDrag();
                              ImageList_Destroy(c->dragImageList); c->dragImageList = NULL; }
    TreeView_SetInsertMark(c->hTree, NULL, FALSE);
    if (GetCapture() == c->hTree) ReleaseCapture();
    c->dragSource = NULL;
    c->dragInsertTarget = NULL;
    /* info->dragInProgress flag also cleared by the caller, who has the info* */
}
```

**(b) `WM_CAPTURECHANGED` as backstop.** Win32 fires this whenever
capture is lost (Alt+Tab, focus theft, our own `ReleaseCapture`).
Even if the rest of our teardown logic has a bug, this leaves the
system in a clean state.

**(c) Verification in `#ifndef NDEBUG`.** Snapshot
`GetGuiResources(GetCurrentProcess(), GR_GDIOBJECTS)` at drag start
and shortly after `EndDrag`; assert equality. Catches image-list
leaks immediately during smoke testing.

### 4 — `TVS_DISABLEDRAGDROP` removed from only one `.rc` file

Process mitigation: `git diff src/ParticleEditor.en.rc src/ParticleEditor.de.rc | grep TVS_DISABLEDRAGDROP` should show two `-` lines and zero `+` lines before commit. Add to PR self-review checklist.

### 5 — insertion-mark math wrong at edges

Pin down the math with a small documented helper rather than
computing inline:

```cpp
// "Gap index" 0..numRoots:
//   gap 0          = above first root
//   gap numRoots   = below last root
//   gap K (0<K<N)  = between root K-1 and root K
struct DropTarget { size_t gap; bool valid; };
static DropTarget ComputeDropTarget(HWND hTree, POINT pt, size_t numRoots);
```

Four code paths (above-first / between / below-last / outside),
each one explicitly tested. The four-zone enumeration lives in one
function, not scattered across the WM_MOUSEMOVE handler.

### 6 — drop-into-same-gap dirties the file

Source at root index S occupies the gap range [S, S+1]. Drop at
gap S or S+1 leaves the layout unchanged:

```cpp
if (target.gap == sourceRootIdx || target.gap == sourceRootIdx + 1) {
    // No-op: cursor IDC_NO, clear insertion mark, EndDrag(false) on mouse-up.
}
```

Source's root index uses **the root-only sequence**, not the flat
`m_emitters` index (children sit between roots and would skew the
count):

```cpp
size_t RootIndexOf(const ParticleSystem*, const Emitter* root);
```

### 7 — coexistence with F2 label edit

Win32's drag threshold (`SM_CXDRAG`/`SM_CYDRAG`) handles
click-pause-click rename for free — `TVN_BEGINDRAG` doesn't fire
until cursor moves past the threshold. Two belt-and-braces
additions:

- In `TVN_BEGINDRAG`, refuse to start if
  `TreeView_GetEditControl(hTree) != NULL`.
- Smoke test: F2 to start rename, type, click outside (commits),
  then drag the same item — both gestures still work.

### 8 — accelerator translation mid-drag *(the dangerous one)*

Hazard: Ctrl+Z mid-drag → pump translates → `DoUndo` →
`RestoreFromSnapshot` → `delete info->particleSystem` while we
hold `dragSource` pointing into the freed object. Use-after-free
on the next mouse-move's hit-test.

**Three layers, smallest blast radius first:**

**(a) Block at the pump.** One `if` at
[`main.cpp:3143`](src/main.cpp:3143):

```cpp
if (!consumed
    && (info->dragInProgress || !TranslateAccelerator(info->hMainWnd, hAccel, &msg))
    && !IsDialogMessage(info->hMainWnd, &msg))
{
    TranslateMessage(&msg);
    DispatchMessage(&msg);
}
```

When `dragInProgress` is true, we skip `TranslateAccelerator`
entirely. Catches Ctrl+Z, Ctrl+Y, Ctrl+N, Ctrl+O, Ctrl+S, Delete,
F5, F6, F7 — all destructive accelerators in one stroke.

**(b) Defense in depth at `DoUndo` / `DoRedo`.**

```cpp
static void DoUndo(APPLICATION_INFO* info) {
    if (info->dragInProgress) return;   // belt-and-braces
    /* ... */
}
```

Two lines, value is "we don't crash even if the pump regresses."

**(c) Esc routing.** The pump skip means Esc still reaches
`IsDialogMessage` and `DispatchMessage`. Main window isn't a dialog
(registered class), so `IsDialogMessage` returns FALSE without
eating Esc. Confirmed by reading
[`main.cpp:3143`](src/main.cpp:3143). Debug-build assertion: print
"[DnD] esc reached WM_KEYDOWN" the first time, sanity-check.

### 9 — undo restoration of selection

Already handled by `EmitterList_SelectEmitter` (PR #31). Smoke
checklist explicit: drop a parent-bearing root (sparks → smoke
trail), Ctrl+Z, confirm sparks selected and smoke trail child still
under it.

### 10 — auto-scroll fights insertion-mark math

The pattern from the Auto-scroll section above: WM_TIMER does all
four updates atomically (scroll, refresh cursor coords, recompute
insertion mark, re-anchor ghost). The critical bit is
`GetCursorPos` (not the timer-message coords) so the ghost
re-anchors to absolute screen coords and doesn't smear as items
scroll under it.

Verification: "hold cursor in hot zone for 2 s" — ghost stays
attached to cursor, insertion mark moves to track newly-visible
items.

### 11 — resize during drag

Explicitly accepted; document in the code comment so a future
contributor doesn't waste time on it.

### 12 — collapsed source

Comparison logic uses root indices, not tree-visible position.
`RootIndexOf` walks `m_emitters` filtering on `parent == NULL` —
collapsed-ness of the tree view is irrelevant.

---

## Process-level mitigations spanning multiple risks

- **Single `EndDrag` exit + `WM_CAPTURECHANGED` backstop** — covers
  #1, #2, #3 simultaneously.
- **`#ifndef NDEBUG` GDI-handle-count snapshot** — catches all
  leak-class regressions (#1, #2, #3, plus future ones).
- **Helper functions with documented contracts** (`ComputeDropTarget`,
  `RootIndexOf`) — make #5, #6, #12 testable in isolation rather
  than as state-machine emergent behavior.

---

## Testing & verification

Drive interactively on `P_explosion_med06.alo` (8 emitters with one
parent/child pair: sparks → smoke trail) plus a synthetic file with
≥6 standalone roots and no children.

### Happy paths

- [ ] Drag root #2 above root #0 → list reordered; selection
      follows; title-bar asterisk appears.
- [ ] Drag root #0 below root #4 (last) → reordered.
- [ ] Drag a root with a child subtree (sparks → smoke trail) past
      another root → both move; smoke trail's `parent` still
      resolves to sparks; sparks's `spawnDuringLife` still points at
      smoke trail's new index.
- [ ] Drag-drop past one neighbor produces the same final layout as
      `Alt+Up` / `Alt+Down`.
- [ ] Multi-step drag past 3 siblings reorders to the exact target
      gap.
- [ ] Drop on the gap above first / below last works.

### Cancel / no-op paths

- [ ] Esc mid-drag → tree unchanged, no asterisk, no capture leak.
- [ ] Drop outside tree client area → tree unchanged.
- [ ] Drop in same gap as source → no-op, no asterisk, no
      `ELN_LISTCHANGED`.
- [ ] Quick click without crossing system drag threshold → no drag.
- [ ] Drop on the source itself → no-op.

### Refused sources

- [ ] Drag-press on a child emitter → no drag starts.
- [ ] Drag-press on a root in a single-root system → no drag starts.
- [ ] Drag-press while F2 label edit is active → no drag starts.

### Refused targets

- [ ] Drag onto a child emitter → `IDC_NO`, no insertion mark,
      drop is a no-op.
- [ ] Drag onto itself → `IDC_NO`.
- [ ] Drag onto the tree's vertical scrollbar / non-client area →
      `IDC_NO`, drop is a no-op.

### Coexistence with existing UI

- [ ] F2 in-place rename still works.
- [ ] Right-click context menu still works.
- [ ] Selection click still works.
- [ ] Toolbar Move Up / Move Down state correct after drop.
- [ ] Visibility-toggle click on eye icon still works.

### Undo / redo

- [ ] One Ctrl+Z reverts the move (selection back on source at
      original position; subtree intact).
- [ ] Ctrl+Y redoes.
- [ ] Drop, save, drop again, Ctrl+Z back to saved state →
      asterisk clears.

### Auto-scroll

- [ ] Scroll-down: tall list scrolled to top, drag a root, hold
      cursor in bottom hot zone → tree scrolls smoothly.
- [ ] Scroll-up: same but bottom-anchored.
- [ ] Hot-zone exit stops scroll mid-stream.
- [ ] Drop while auto-scrolling lands at the visible insertion
      target.
- [ ] Esc while auto-scrolling stops the timer and cancels.
- [ ] Reaching scroll limits doesn't crash or busy-loop.
- [ ] Short list (no scrollbar) — cursor in hot zone is harmless
      no-op.

### Edge cases — accelerator interaction (Risk #8)

- [ ] **Ctrl+Z mid-drag** → blocked; cursor stays in drag mode;
      no crash.
- [ ] Ctrl+S mid-drag → blocked.
- [ ] Ctrl+N mid-drag → blocked.
- [ ] After drag ends, accelerators work normally.

### Edge cases — focus / capture

- [ ] Alt+Tab away mid-drag → `WM_CAPTURECHANGED` fires; clean
      cancellation.
- [ ] Click another window mid-drag (Spawner if open) → clean
      cancellation.
- [ ] Mouse leaves window during drag, returns → drag continues.

### Edge cases — repeated drags / leaks

- [ ] 20 drags in a row → GDI handle count stable in Debug build's
      `GetGuiResources` snapshot.
- [ ] Drag, then close the editor mid-drag (Alt+F4) → no leak.
- [ ] Drop, immediately File → Open another file → tree rebuilds
      cleanly; no stale drag state.
- [ ] Drag in a German build (`de.rc`) — same code path, just
      checking the `.rc` edit didn't typo the style flags.

## Implementation order

1. Remove `TVS_DISABLEDRAGDROP` from both `.rc` files. Build,
   confirm `TVN_BEGINDRAG` fires (printf to verify).
2. Add `ParticleSystem::moveEmitterToRootIndex`. Smoke-test
   indirectly via the new DnD path; can also re-implement
   `EmitterList_MoveEmitter` in terms of it for confidence.
3. `info->dragInProgress` flag + accelerator gate at
   [`main.cpp:3143`](src/main.cpp:3143) + `DoUndo`/`DoRedo`
   guards.
4. Wire `TVN_BEGINDRAG` (refuse children / single-root / active
   label edit; capture; image list begin; set
   `dragInProgress`).
5. Subclass handlers for `WM_MOUSEMOVE`, `WM_LBUTTONUP`,
   `WM_KEYDOWN` (Esc), `WM_CAPTURECHANGED`. Centralized cleanup
   in `EndDrag(control)`.
6. `ComputeDropTarget` + `RootIndexOf` helpers; no-op detection.
7. `TreeView_CreateDragImage` + ghost wiring.
8. Auto-scroll: timer + WM_TIMER handler with atomic
   scroll/hit-test/ghost-move.
9. `#ifndef NDEBUG` GDI-handle leak check around drag start/end.
10. Verify undo round-trip on a parent-bearing drop.
11. Run full smoke checklist above.
12. Hand off to user. CHANGELOG entry only after user confirms.

## Estimate

3/5 difficulty, **4-6 hours** consistent with the roadmap.

---

# Review

(Filled in after implementation lands.)
