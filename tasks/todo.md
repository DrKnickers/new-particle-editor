# Plan: Undo / Redo for the particle editor

## Goal

Ctrl+Z / Ctrl+Y (also Ctrl+Shift+Z) walk the user back and forth through
edits. Toolbar icons next to File New/Open/Save. An Edit-menu Undo / Redo
pair. Greyed out at the ends of the stack.

## Scope (confirmed with user)

**Undoable** (anything that survives `.alo` save/load):

- Every emitter property edit (basic / appearance / physics tabs)
- Every track key add / move / delete
- Every random-parameter group field
- Structural ops: add / delete / duplicate / move / paste / rename
- `leaveParticles` system flag, system name (set on save from filename)

**Not undoable** (session / UI affordances):

- Selection, scroll, expand/collapse, tab-active
- Per-emitter `visible` flag (already documented as editor-only)
- Spawner config, camera, background color, ground, mod selection
- File ops (New / Open / Save) clear the stack instead of being undo
  steps within it

## Architecture

**Snapshot the whole `ParticleSystem` per edit boundary.** Reuses the
existing `ChunkWriter` / `ParticleSystem(IFile*)` round-trip — proven
correct by save/load and clipboard. `.alo` files are tiny (single-digit
KB), so a 100-deep stack is comfortably under 10 MB.

Rejected the command pattern: dozens of command classes for every
spinner / checkbox / combo / track-key op, plus the `Emitter*` pointer
re-resolution after delete-undo is exactly the landmine the snapshot
approach sidesteps (whole graph rebuilt fresh; pointers re-resolved by
index).

## Components

### 1. `src/UndoStack.{h,cpp}` (new)

```cpp
class UndoStack {
    struct Entry {
        std::vector<char> snapshot;
        size_t            selectedIndex;  // SIZE_MAX if none
        DWORD             coalesceKey;    // (notify-code << 16) | emitter-idx
        DWORD             timestamp;      // GetTickCount()
        bool              isSavedState;   // matches what's on disk
    };
    std::deque<Entry> m_entries;
    size_t            m_cursor;       // 0..m_entries.size()
    bool              m_applying;     // re-entrancy guard
    static const size_t MAX_ENTRIES = 100;
public:
    void Capture(const ParticleSystem& sys, size_t selIdx,
                 DWORD coalesceKey);
    bool CanUndo() const;
    bool CanRedo() const;
    bool Undo(/*out*/ std::vector<char>** snapshot,
              /*out*/ size_t* selIdx);
    bool Redo(/*out*/ std::vector<char>** snapshot,
              /*out*/ size_t* selIdx);
    void Clear();
    void MarkSaved();          // current cursor's entry == disk state
    bool IsAtSavedState() const;
    bool IsApplying() const { return m_applying; }
    void BeginApplying() { m_applying = true; }
    void EndApplying()   { m_applying = false; }
};
```

Snapshot helpers in `UndoStack.cpp`:

```cpp
static std::vector<char> Serialize(const ParticleSystem& sys) {
    MemoryFile* mf = new MemoryFile();
    sys.write(mf);
    std::vector<char> buf(mf->size());
    mf->seek(0);
    mf->read(buf.data(), mf->size());
    mf->Release();
    return buf;
}

static ParticleSystem* Deserialize(const std::vector<char>& buf) {
    MemoryFile* mf = new MemoryFile();
    mf->write(buf.data(), (unsigned long)buf.size());
    mf->seek(0);
    ParticleSystem* sys = new ParticleSystem(mf);
    mf->Release();
    return sys;
}
```

### 2. Edit boundaries in `main.cpp`

Three notification sites already funnel every change. Push a snapshot
**after** the change has landed in the model:

| Notify           | Source                       | Coalesce |
|------------------|------------------------------|----------|
| `EP_CHANGE`      | Property panel field         | yes      |
| `TE_CHANGE`      | Track key add/move/delete    | yes      |
| `ELN_LISTCHANGED`| Structural emitter-list op   | **no**   |

Plus `BN_CLICKED` on `hLeaveParticles` (single bool, no coalesce needed).

**Coalesce rule (simple version, time-based):**

> If previous entry's `coalesceKey` matches the new one AND the new
> timestamp is within 750 ms of the previous, replace the previous
> entry's snapshot in place instead of pushing a new one.

`coalesceKey = (notifyCode << 16) | selectedEmitterIdx`. Structural ops
always pass key 0 (never coalesce). For `TE_CHANGE`, fold the track ID
into the key so cross-track edits don't collapse into one step.

This is intentionally simple; can be tightened later if a particular
spinner produces too-coarse undo steps.

### 3. Restore path

```cpp
static void RestoreFromSnapshot(APPLICATION_INFO* info,
                                 const std::vector<char>& buf,
                                 size_t selIdx) {
    info->undoStack.BeginApplying();

    ParticleSystem* sys = UndoStack_Deserialize(buf);

    if (info->engine != NULL) info->engine->Clear();
    delete info->particleSystem;
    info->particleSystem  = sys;
    info->selectedEmitter = (selIdx < sys->getEmitters().size())
                            ? &sys->getEmitter(selIdx) : NULL;

    EmitterList_SetParticleSystem(info->hEmitterList, sys);
    SendMessage(info->hLeaveParticles, BM_SETCHECK,
                sys->getLeaveParticles() ? BST_CHECKED : BST_UNCHECKED, 0);
    SetEmitterInfo(info);

    if (info->engine != NULL) info->engine->OnParticleSystemChanged(-1);
    SetFileChanged(info, !info->undoStack.IsAtSavedState());
    UpdateUndoRedoUI(info);

    info->undoStack.EndApplying();
}
```

`engine->Clear()` kills all live `EmitterInstance`s pointing at the old
graph. `SpawnerDriver` holds no `Emitter*`s itself; its tick passes the
current `ParticleSystem*` per call, so it's automatically re-pointed.

### 4. UI surface

- **Edit menu**: `Undo\tCtrl+Z`, `Redo\tCtrl+Y` — at the **top** of the
  existing Edit menu, before Cut/Copy/Paste, with a separator.
- **Accelerators**: `Ctrl+Z` → `ID_EDIT_UNDO`, `Ctrl+Y` → `ID_EDIT_REDO`,
  `Ctrl+Shift+Z` → `ID_EDIT_REDO` (synonym).
- **Toolbar icons**: extend `src/Resources/toolbar1.bmp` from 5 cells
  (80×16) to 7 cells (112×16), reusing the pattern in
  `tasks/extend_toolbar_bitmap.ps1` — that script extended `toolbar2.bmp`
  for Move Up / Move Down. The two new cells are undo (counterclockwise
  curved arrow) and redo (clockwise curved arrow). Add them between the
  existing File group and the View toggles, with `BTNS_SEP` spacers.
- **Enable/disable**: refresh on every capture / undo / redo. Both
  toolbar (`TB_SETSTATE`) and menu (`EnableMenuItem` from
  `WM_INITMENUPOPUP`).
- **Tooltips**: `IDS_TOOLTIP_EDIT_UNDO`, `IDS_TOOLTIP_EDIT_REDO`.

### 5. Saved-state asterisk

Each entry has `isSavedState`. On `OnFileChange` (after Open / New) and
on successful save, call `m_undo.MarkSaved()` which sets the current
entry's bit and clears the bit on every other entry. After any restore,
set `info->changed = !current.isSavedState`. Undo back to disk-state
clears the asterisk; redo past it restores it. Edits past the cursor
clear the saved-state bit on whatever lay ahead (those snapshots are
about to be discarded anyway).

### 6. Initial baseline

`OnFileChange` clears the stack and pushes one initial entry with
`isSavedState = true`, so the first Ctrl+Z after opening rewinds back
into the loaded file rather than into nothing.

## Risks named up front

1. **Dangling `info->selectedEmitter` after swap.** Captured as index
   beforehand; re-resolved against the new system's `m_emitters`.
2. **Re-entrancy.** `EmitterProps_SetEmitter` and `EmitterList_SetPS`
   may dispatch their own `EP_CHANGE` / `ELN_LISTCHANGED` during
   restore. `m_applying` flag in the capture function guards against it.
3. **Coalescing across structural ops.** A spinner edit then a delete
   must not collapse together — so the rule is "structural ops pass
   coalesceKey = 0, which never matches anything".
4. **Visibility toggle.** Confirmed: `EmitterList_ToggleEmitterVisibility`
   does NOT send `ELN_LISTCHANGED`, so it correctly stays out of the
   undo stack. (There's a stale-feeling pre-existing call in
   `main.cpp:1554` that calls `SetFileChanged(true)` on rename — that's
   a separate concern; not our problem here.)
5. **Track-key drag** in CurveEditor fires many `TE_CHANGE`s; coalescing
   collapses them into one step. Mouse-up doesn't currently fire a
   distinct event, so the 750 ms timer is what closes the entry.
6. **Memory.** 100-entry cap × typical `.alo` size (10–50 KB) = a few
   MB worst case. Drop oldest on overflow.

## Implementation order

1. Build UndoStack (header + cpp), no UI yet.
2. Plumb capture in `WM_NOTIFY` for the three notify sites + the
   `leaveParticles` BN_CLICKED, gated by `m_applying`.
3. Implement RestoreFromSnapshot + selection re-resolution. Wire one
   debug hotkey first to validate end-to-end before menu.
4. Add `ID_EDIT_UNDO` / `ID_EDIT_REDO` IDs + tooltip string IDs in
   `resource.en.h` / `resource.de.h`.
5. Edit menu items, accelerators, en + de string tables.
6. Extend `toolbar1.bmp` (script in `tasks/`) and update toolbar
   button list in `main.cpp`.
7. Enable/disable on `WM_INITMENUPOPUP` + after each capture.
8. Saved-state asterisk + MarkSaved on save.
9. Smoke test (manual checklist below). Hand off to user.

## Smoke-test checklist

- [ ] Open a real `.alo`. Edit a spinner. Ctrl+Z → reverts. Ctrl+Y → redoes.
- [ ] Drag a track-key. One Ctrl+Z reverts the whole drag.
- [ ] Add an emitter. Undo → emitter gone. Redo → it's back. Selection
      lands on the right thing.
- [ ] Delete an emitter with children. Undo restores children too.
- [ ] Move emitter up. Undo. Redo.
- [ ] Toggle leaveParticles. Undo.
- [ ] Toggle visibility on an emitter. Ctrl+Z does NOT undo it.
- [ ] Open a different `.alo`. Stack cleared (Ctrl+Z is greyed out).
- [ ] Edit, save, edit, Ctrl+Z to saved state — title-bar asterisk gone.
      Ctrl+Y past saved state — asterisk back.
- [ ] Make >100 edits (rapid-fire), confirm no crash and oldest fall off.
- [ ] Edit, then redo-history is clipped after a new edit.

## Estimate

3/5 difficulty, 8–14 hours.

---

# Review

(Filled in after implementation lands.)
