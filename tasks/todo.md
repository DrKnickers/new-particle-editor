# Plan: NT-4 — Duplicate with index increment

ROADMAP entry: near-term `[NT-4]`, ★★☆☆☆ (2/5), 2–4 hours estimated.

## 1. Goal + scope

Two new entries in the emitter right-click context menu, directly below
the existing *Duplicate* item:

1. **Duplicate (increment index)** — duplicates the selected emitter and
   adds +1.0 to every keyframe value on its `TRACK_INDEX` track. No prompt.
2. **Duplicate (increment index…)** — same, but first shows a small dialog
   asking *"Increment by: [N]"* with an integer spin control and OK / Cancel.
   Default value pre-filled to 1.

The motivating use case is atlas-texture variation: a 4×4 sprite sheet
needs 16 emitters, each pinned to a different frame. Currently that requires
a manual loop of Duplicate → open track editor → change the index value →
close. With this feature the loop collapses to a right-click per copy.

**In:**
- `TRACK_INDEX` (track ID 5) keyframe values shifted by the given delta
- If the track has no explicit keyframes (using its default value of 0.0),
  a single keyframe at t=0 is written with value `0 + delta`
- Both operations are a single undo step (mutation happens before the undo
  snapshot is committed, same pattern as name generation in the existing
  duplicate flow)
- The `…` dialog variant: a minimal Win32 dialog resource with a label,
  a EDIT + UPDOWN (spin) control, and OK / Cancel; default 1, minimum 1

**Out:**
- Wrap-around / clamping against atlas grid size — the engine already
  handles out-of-range indices with `% gridSize` UV arithmetic, so no guard
  needed (deliberate non-work)
- "Duplicate N times with incrementing index" bulk operation — separate
  future feature if anyone asks
- Incrementing any track other than `TRACK_INDEX`
- Fractional increments — integer only; the index is always a whole frame

## 2. What the codebase already gives us

| Piece | File:line |
|---|---|
| Existing duplicate entry point | [`src/UI/EmitterList.cpp:1615`](src/UI/EmitterList.cpp:1615) `EmitterList_DuplicateEmitter()` |
| Serialise/deserialise round-trip | [`src/ParticleSystem.cpp:253`](src/ParticleSystem.cpp:253) `write(ChunkWriter&, bool copy)` |
| Name generation | [`src/UI/EmitterList.cpp:16`](src/UI/EmitterList.cpp:16) `GenerateDuplicateName()` |
| `TRACK_INDEX` constant (= 5) | [`src/ParticleSystem.h:36`](src/ParticleSystem.h:36) |
| `ID_EMITTER_DUPLICATE` (existing menu ID) | [`src/Resources/resource.en.h:205`](src/Resources/resource.en.h:205) |
| Context menu dispatch | [`src/UI/EmitterList.cpp:1144`](src/UI/EmitterList.cpp:1144) |
| Track default value and IT_STEP interpolation | [`src/ParticleSystem.cpp:568,571`](src/ParticleSystem.cpp:568) |
| UV atlas math (confirms out-of-range is safe) | [`src/EmitterInstance.cpp:588`](src/EmitterInstance.cpp:588) |

**Unknown to confirm before writing code:** the exact mutator API for
keyframe values on a track after deserialization. Need to read the Track /
Emitter header to find the right accessor (iterate keyframes and set value,
vs. a bulk shift method, vs. writing the default-value field if there are
no keyframes). This is step zero of implementation.

## 3. Architecture / implementation approach

Four small surgical changes; no new files.

### 3.1 New resource IDs (`resource.en.h` / `resource.de.h`)

```c
#define ID_EMITTER_DUPLICATE_INC_INDEX    <next-free-ID>
#define ID_EMITTER_DUPLICATE_INC_INDEX_N  <next-free-ID+1>
#define IDD_INCREMENT_INDEX_DIALOG        <next-free-dialog-ID>
```

### 3.2 Context menu resource

Directly below the existing `ID_EMITTER_DUPLICATE` item in the emitter
right-click menu in both `.rc` files:

```
MENUITEM "Duplicate (increment index)",    ID_EMITTER_DUPLICATE_INC_INDEX
MENUITEM "Duplicate (increment index\x2026)", ID_EMITTER_DUPLICATE_INC_INDEX_N
```

(`\x2026` = `…` in the resource file, matching the Windows ellipsis
convention for "opens a dialog".)

### 3.3 Small dialog resource (`IDD_INCREMENT_INDEX_DIALOG`)

Minimal dialog: static label "Increment by:", an EDIT control (ID
`IDC_INCREMENT_EDIT`) paired with an UPDOWN control (min 1, max 999,
default 1), then standard OK / Cancel. No tab stops beyond the edit
and the two buttons. Same visual style as the existing spawner dialog.

### 3.4 `EmitterList.cpp` — dispatch + helper

**Helper function** (file-local, near `EmitterList_DuplicateEmitter`):

```cpp
// Adds `delta` to every keyframe value on the TRACK_INDEX track of `e`.
// If the track has no keyframes, inserts one at t=0 with value delta.
static void ShiftIndexTrack(Emitter* e, float delta);
```

Implementation depends on the track API confirmed in step 0, but the
shape is:
- Get the track at index `TRACK_INDEX`
- If keyframe count == 0: insert keyframe (t=0, value=delta)
- Else: for each keyframe, value += delta

**Two new WM_COMMAND cases** in the context-menu dispatch:

```cpp
case ID_EMITTER_DUPLICATE_INC_INDEX:
{
    EmitterList_DuplicateEmitter(...);   // existing logic, produces copy
    ShiftIndexTrack(newEmitter, 1.0f);
    break;
}
case ID_EMITTER_DUPLICATE_INC_INDEX_N:
{
    int n = ShowIncrementDialog(hWnd);  // returns 0 on Cancel
    if (n > 0) {
        EmitterList_DuplicateEmitter(...);
        ShiftIndexTrack(newEmitter, (float)n);
    }
    break;
}
```

`ShowIncrementDialog` is a thin wrapper around `DialogBox` using
`IDD_INCREMENT_INDEX_DIALOG`; the dialog proc reads the EDIT/UPDOWN
value on OK.

**Undo:** the mutation happens immediately after deserialization and
before the new emitter node is appended to the UI tree, so it's
baked into the same undo step as the duplicate. No separate undo entry.

## 4. Risks named up front + mitigations

1. **Track keyframe API unknown.** If the track object doesn't expose
   a simple per-keyframe value setter, the helper may need to manipulate
   the raw keyframe array directly. **Mitigation:** read the Track header
   before writing a single line of `ShiftIndexTrack`; confirm the exact
   field names. Trivially discoverable — not a blocker, just step zero.

2. **Default-value track (no keyframes) stored separately from the
   keyframe array.** If `Emitter::write()` serialises a separate
   "default value" field alongside the keyframe list, and the read-back
   stores it independently, inserting a keyframe at t=0 may leave both
   the old default-0 and the new keyframe coexisting (resulting in no
   visible change at t=0). **Mitigation:** after reading the track
   API, also read the read/write paths for the default-value field and
   check whether a keyframe at t=0 overrides or coexists with it.
   If it coexists, write the default-value field instead of inserting a
   keyframe.

3. **Undo granularity.** If `EmitterList_DuplicateEmitter` commits an
   undo snapshot internally before returning, the subsequent
   `ShiftIndexTrack` call produces a second undo step, meaning undo
   undoes the index change but leaves the duplicate. **Mitigation:**
   trace the undo commit point in the existing duplicate flow before
   writing the handler; if needed, defer `ShiftIndexTrack` to before
   the commit, or combine into a single undo action explicitly.

4. **Dialog integer overflow / invalid input.** The UPDOWN control
   enforces min/max at the control level, but the user can type
   directly into the paired EDIT. **Mitigation:** clamp in
   `ShowIncrementDialog` on OK: `n = max(1, min(999, parsed_value))`.
   If parse fails (non-numeric), treat as Cancel.

## 5. Testing & verification

**Happy path — +1 variant**
- [ ] Right-click emitter with index at default (0) → "Duplicate
      (increment index)" → copy appears, open its track editor →
      `TRACK_INDEX` shows a keyframe at t=0, value 1.
- [ ] Repeat three times starting from the copy → consecutive copies
      have indices 2, 3, 4.
- [ ] Verify original emitter's index track is unchanged (still 0).

**Happy path — prompt variant**
- [ ] Right-click → "Duplicate (increment index…)" → dialog opens with
      default value 1 in the spin field.
- [ ] Change to 4, click OK → copy's index is 4.
- [ ] Click Cancel → no duplicate is created.

**Animated index track (multiple keyframes)**
- [ ] Set up an emitter with an animated `TRACK_INDEX` track: three
      keyframes at t=0/0.5/1.0 with values 0/3/7.
- [ ] "Duplicate (increment index)" → copy's keyframes are 1/4/8.
- [ ] "Duplicate (increment index…)" with N=2 → keyframes are 2/5/9.

**Undo**
- [ ] Duplicate (increment index) → Ctrl+Z → both the duplicate and the
      index change are undone in a single step (no "ghost" duplicate
      with a non-incremented index left behind).

**Input validation**
- [ ] In the dialog, type "abc" → OK → treated as Cancel (or clamped to
      1 — whichever the implementation chooses; document which).
- [ ] Type 0 → clamped to 1.
- [ ] Type 1000 → clamped to 999.

**No regression**
- [ ] Existing "Duplicate" (without index increment) still works and
      produces an unmodified copy.
- [ ] The two new items appear below "Duplicate" in the context menu,
      not above or elsewhere.
- [ ] Name generation is unchanged — copy gets the `_1`/`_2` suffix
      from `GenerateDuplicateName` regardless of the index variant used.
- [ ] Out-of-range index (e.g. index 16 on a 4×4 atlas) — preview
      renders without crash; UV wraps gracefully via the existing
      `% gridSize` arithmetic.
