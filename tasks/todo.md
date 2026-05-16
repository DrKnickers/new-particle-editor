# [LT-3] Import emitters from other particle files

**Status (2026-05-16):** plan draft, awaiting risk pass with user before
implementation. Target branch: `feat/lt3-import-emitters`.

Generalises the existing single-emitter clipboard copy/paste into a file-driven
multi-emitter import flow. New **File → Import Emitters from File…** entry
opens a `.alo` picker, then a modal dialog with a checkbox tree of the source
file's emitters; selected emitters get cloned into the current system with
spawn-field cross-references re-mapped so parent/child chains stay intact.

---

## 1. Goal + scope

**Goal.** Lower the activation energy for assembling a complex `.alo` from
pieces of existing ones. Today: copy an emitter from one editor window,
switch to another, paste — repeat per emitter. After LT-3: File → Import,
pick file, tick the emitters you want, OK.

**In scope.**
- New **File → Import Emitters from File…** menu entry (en + de).
- New modal dialog `IDD_IMPORT_EMITTERS` containing:
  - File path label + `Browse…` button (so the user can change the source
    file without re-opening the dialog).
  - `TVS_CHECKBOXES` TreeView listing all emitters in the source file as a
    parent/child tree, mirroring `EmitterListControl`'s shape.
  - **Select all** and **Clear** buttons under the tree.
  - **Auto-include children** checkbox (default on): when ticked, ticking
    a parent emitter automatically ticks all its descendants; unticking
    a parent unticks them. When off, every emitter is independently
    selectable.
  - OK / Cancel.
- Spawn-field re-mapping during import: when an emitter's
  `spawnDuringLife` / `spawnOnDeath` source-index points at *another
  imported emitter*, rewrite to the new destination index. When the source
  child isn't imported, set the spawn field to `-1` (matches single-paste
  behaviour).
- Name-collision avoidance per import: re-use `GenerateDuplicateName()`
  from the existing paste path; each imported emitter gets a unique name
  in the destination system.
- Import is a single undo step — wraps in one `CaptureUndo` so Ctrl+Z
  rolls back the entire batch atomically.
- Imported emitters become **root emitters in the destination** unless their
  spawn-parent was also imported (in which case the parent-pointer chain is
  rebuilt from the re-mapped spawn fields, same as how the existing
  `ParticleSystem(IFile*)` constructor rebuilds parent pointers from spawn
  indices at load time).
- Source `.alo` file resolution goes through normal `GetOpenFileName`
  (absolute file path). No FileManager / MEG-archive resolution — the user
  picks a file from disk.

**Link-group preservation (in scope per 2026-05-16 design call).**
Imported linked emitters are *re-grouped* in the destination: for each
source `linkGroup` ID that has ≥2 imported members, the destination
gets a fresh `linkGroup` ID (next-free in the destination's ID space)
and all imported members of that source group are joined to it via
`CreateLinkGroup` / `JoinLinkGroup`. Source groups where only 1
member was imported arrive unlinked (data model disallows 1-member
groups in UI). Source IDs never propagate verbatim to the destination
— always fresh allocations to prevent silent merges with unrelated
existing destination groups.

**Out of scope.**
- **Importing into a parent emitter's child slot directly.** Today the user
  imports as roots and then re-parents via drag-and-drop. Adding a
  destination-parent picker to the dialog is UX overhead with marginal
  value. Future PR if requested.
- **Cross-particle-system references** (e.g. an emitter referencing another
  `.alo` file). Doesn't exist in the data model — every reference is local
  to the current `ParticleSystem`. No work needed.
- **Preview / thumbnail in the picker tree.** The tree shows emitter names
  + tree shape only. Adding per-emitter thumbnails would require partially
  loading + rendering each one in isolation — significant effort for a
  picker that already has the emitter name as a strong identifier.
- **Multi-file selection.** Pick one source file per import. Repeat the
  dialog for a second source file. Future PR if anyone asks.
- **Mod-archive `.alo` source.** Source file picker is OS file system only;
  not browsing inside mod `.meg` archives. Out of scope; rare workflow.

---

## 2. What the codebase already gives us

| Need | Existing artefact | Location |
|---|---|---|
| Clipboard format + `Emitter::write(writer, copy=true)` that strips spawn indices to `-1` and suppresses linkGroup | `EmitterList.cpp:170` (registered format), `ParticleSystem.cpp:249–310` (write path) | `EmitterList.cpp`, `ParticleSystem.cpp` |
| `Emitter(ChunkReader&)` deserialiser used by paste | `ParticleSystem.cpp:476–515` | `ParticleSystem.cpp` |
| `GenerateDuplicateName(...)` for name-collision avoidance | `EmitterList.cpp:945`-adjacent | `EmitterList.cpp` |
| `ParticleSystem(IFile*)` constructor that rebuilds parent pointers from spawn-field indices at load time | `ParticleSystem.cpp:1000+`, parent rebuild at `1088–1089`, spawn-index validation at `1075–1085` | `ParticleSystem.cpp` |
| `EmitterListControl` tree-view rendering pattern (`HTREEITEM` with `lParam = (LPARAM)Emitter*`, parent/child via `InsertTreeItem`) | `EmitterList.cpp:370+` | `EmitterList.cpp` |
| Modal dialog plumbing pattern | `IDD_MOD_NICKNAME` (`NicknameDialogProc` in `main.cpp:7052+`) | `main.cpp` |
| Undo capture for batched edits | `UndoStack::MakeCoalesceKey`, `CaptureUndo` already used elsewhere in `main.cpp` | `main.cpp` |
| File-picker invocation pattern | `SkydomePicker_PickCustomFile` (`OPENFILENAMEW` + `GetOpenFileNameW`) at `main.cpp:4836` | `main.cpp` |
| Adding new emitters to `ParticleSystem::m_emitters` at runtime — exists via the New Emitter and Paste paths | `EmitterList.cpp` | `EmitterList.cpp` |

What we have to build new:
- The `IDD_IMPORT_EMITTERS` dialog template (en + de `.rc`).
- A `TVS_CHECKBOXES` TreeView with parent/child checkbox propagation
  (auto-tick descendants on parent tick). No existing pattern.
- A `LoadParticleSystemFromFile(path)` helper that parses a `.alo` into an
  in-memory `ParticleSystem` *without* installing it as the active system.
  The existing `ParticleSystem(IFile*)` constructor does this; we just need
  a wrapper that opens the file and constructs.
- The import-engine: source-index → destination-index map, spawn-field
  re-mapping pass, single undo capture, batch insert into the destination.

---

## 3. Architecture / implementation approach

### 3.1 Dialog flow

```
File → Import Emitters from File…
   ↓
GetOpenFileNameW (filter: *.alo)
   ↓                                              ┌──── (user clicks Browse… → reopen GetOpenFileNameW with current file as default)
ParticleSystem source(file)  ←───────────────────┤
   ↓                                              │
DialogBoxParam IDD_IMPORT_EMITTERS               │
  • path label + Browse button ─────────────────┤
  • TVS_CHECKBOXES TreeView (built from source.m_emitters)
  • Auto-include-children checkbox (default on)
  • Select all / Clear buttons
  • OK / Cancel
   ↓ (OK: collect ticked emitter source-indices → vector<size_t> picks)
ImportEmitters(picks, source, destination)
   ↓
For each pick: clone via in-memory ChunkWriter→ChunkReader round-trip
(reuses Emitter::write(copy=true) + Emitter(ChunkReader&))
   ↓
Build source-index → destination-index map
   ↓
Pass 2: for each newly-imported emitter, look at its source spawn-field
indices; if a source index is in the picks set, rewrite to the destination
index from the map; else leave as -1 (set by the copy=true write path)
   ↓
Rebuild parent pointers on the destination (mirror ParticleSystem.cpp:1088–1089)
   ↓
EmitterListControl refresh + select first imported emitter
```

### 3.2 New code organisation

- **`src/main.cpp`** gets the dialog handler `ImportEmittersDialogProc`,
  the entry point `DoImportEmittersFromFile(APPLICATION_INFO* info)`, the
  `WM_COMMAND` dispatch case, the helper `LoadParticleSystemFromFile`,
  and the import engine `ImportEmittersIntoSystem`. ~500–700 LOC.
- **`src/Resources/resource.en.h`** + **`resource.de.h`** get new IDs:
  `ID_FILE_IMPORT_EMITTERS`, `IDD_IMPORT_EMITTERS`, `IDC_IMPORT_PATH_LABEL`,
  `IDC_IMPORT_BROWSE`, `IDC_IMPORT_TREE`, `IDC_IMPORT_AUTO_CHILDREN`,
  `IDC_IMPORT_SELECT_ALL`, `IDC_IMPORT_CLEAR`.
- **`src/ParticleEditor.en.rc`** + **`.de.rc`** get the new menu item under
  File and the dialog template `IDD_IMPORT_EMITTERS`.

### 3.3 Spawn-field re-mapping in detail

After the user OKs the dialog we have `picks: vector<size_t>` — the source
indices the user ticked. The import is then two passes over the picks:

**Pass 1 (clone + record).** For each `srcIdx` in `picks`, in order:
1. Serialise the source emitter via `Emitter::write(writer, copy=true)`
   into a temporary in-memory buffer. This produces the *unlinked /
   detached* form: all spawn fields are `-1` and the linkGroup chunk is
   absent.
2. Deserialise via `Emitter(ChunkReader&)` into a freshly-allocated
   `Emitter` on the destination's `m_emitters` vector. Its destination
   index is `destination.m_emitters.size()` at the moment of insertion.
3. Apply `GenerateDuplicateName()` against the destination's existing
   names to avoid collisions.
4. Record `srcIdx → destIdx` in a map.

**Pass 2 (re-map spawn fields).** Walk the picks again. For each
`srcIdx`, look at the *source* emitter's `spawnDuringLife` and
`spawnOnDeath` (values may be `-1` or another source index). For each
non-`-1` source-spawn-index `s`:
- If `s` is in the `srcIdx → destIdx` map (i.e. we also imported `s`),
  rewrite the *destination* emitter's spawn field to `destIdx` for `s`.
- Else leave it `-1` (the import is rooted; the source child is not part
  of this import).

**Parent pointers.** After Pass 2, walk the newly-imported emitters and
rebuild parent pointers from the (now-correct) spawn-field indices,
mirroring the load-time logic at `ParticleSystem.cpp:1088–1089`.

**Pass 3 (link-group re-creation).** Walk the picks one more time. For
each source emitter with a non-zero `linkGroup`, group the picks by
their source `linkGroup` ID into a `map<uint32_t srcGroup,
vector<size_t destIdx>>`. For each entry where the vector has ≥2
entries, allocate a new destination `linkGroup` ID
(`max(existingDestGroupIds) + 1`, treating 0 as "no group") and call
the existing `CreateLinkGroup` / `JoinLinkGroup` helpers in
`LinkGroup.h` to bind all destination members to it. Single-member
buckets leave their imports unlinked. Imports whose source
`linkGroup == 0` are skipped.

### 3.4 Checkbox tree behaviour

- TreeView gets `TVS_CHECKBOXES` style at create time.
- We handle `TVN_ITEMCHANGED` to detect checkbox-state transitions
  (`uChanged & TVIF_STATE`, examine `INDEXTOSTATEIMAGEMASK(state)`).
- **Auto-include-children mode (default on):** when a parent's state
  transitions, recursively set all descendants' state to match. Suppress
  recursion via a re-entry guard so the cascade doesn't fight itself.
- **Manual mode:** no recursion; each item is independent.
- **Select all** button sets every checkbox to checked.
- **Clear** button sets every checkbox to unchecked.

### 3.5 Undo integration

`ImportEmittersIntoSystem` wraps the whole batch in `CaptureUndo` with a
fresh coalesce key (e.g. `MakeCoalesceKey(0xFFFD, 0)` — distinct from
existing batched operations). Ctrl+Z rolls back the entire import.

### 3.6 Failure modes

- **Source file fails to open / parse**: `ParticleSystem(IFile*)` throws.
  Catch in `LoadParticleSystemFromFile`; show MessageBox `L"Couldn't read
  particle file: <reason>"`; bail before opening the dialog.
- **Source file has zero emitters**: dialog opens with empty tree; OK is
  disabled. User can Browse… to a different file.
- **User OKs with zero ticked**: OK button disabled until ≥1 emitter
  ticked.
- **Destination's emitter cap exceeded**: if the `.alo` format / engine
  has a hard cap on emitter count (need to verify; search), refuse the
  import with a MessageBox naming the cap. If no cap exists, proceed.

### 3.7 Resource IDs

| ID | Value (suggested) | Purpose |
|---|---|---|
| `ID_FILE_IMPORT_EMITTERS` | `40122` (next free after `ID_VIEW_STEP_10_FRAMES = 40116` and `ID_EMITTER_DUPLICATE_INC_INDEX_N = 40118`) | File menu command |
| `IDD_IMPORT_EMITTERS` | `190` | Dialog template |
| `IDC_IMPORT_PATH_LABEL` | `1730` | Static showing current source path |
| `IDC_IMPORT_BROWSE` | `1731` | Pushbutton: reopen file picker |
| `IDC_IMPORT_TREE` | `1732` | TVS_CHECKBOXES TreeView |
| `IDC_IMPORT_AUTO_CHILDREN` | `1733` | Checkbox: auto-include children |
| `IDC_IMPORT_SELECT_ALL` | `1734` | Pushbutton: select all |
| `IDC_IMPORT_CLEAR` | `1735` | Pushbutton: clear all |

---

## 4. Risks named up front + mitigations

1. **Risk: name collisions silently produce two emitters with identical
   names.** If `GenerateDuplicateName()` is called once per imported
   emitter against the *destination* list, but the destination doesn't see
   the previously-imported emitter until insert-time, two imports of the
   same source name could both pick the same "(2)" suffix.
   - **Mitigation:** insert each cloned emitter into the destination's
     `m_emitters` vector *before* running `GenerateDuplicateName` on the
     next one. The function sees the previous insert and bumps the
     suffix.

2. **Risk: spawn-field re-mapping breaks when a source emitter's child
   chain has a circular structure.** The data model says exactly one
   child per type per emitter; the source loader at
   `ParticleSystem.cpp:1075–1085` already validates spawn indices. A
   well-formed source file can't have cycles, but a malformed one might.
   - **Mitigation:** validate before re-mapping — for each pick, detect
     if its spawn fields point at indices outside `[0, source.m_emitters.size())`;
     if so, treat as `-1`. (The source loader will have already cleaned
     these on `.alo` parse, but a defensive check costs nothing.)

3. **Risk: importing a parent-without-child gives an emitter that
   spawns nothing.** If user ticks parent A whose `spawnDuringLife`
   points at source-B but doesn't tick B, A arrives in the destination
   with `spawnDuringLife = -1`. This is the same as the existing
   single-paste behaviour — explicitly accepted.
   - **Mitigation (UX, not code):** the *auto-include-children* checkbox
     defaults to on so ticking A also ticks B. User has to opt out of
     the safe behaviour. Documented in the dialog tooltip.

4. **Risk: importing N emitters where N is large (50+) makes the
   destination's emitter tree hard to navigate.** Bulk imports could
   produce visually cluttered destinations.
   - **Mitigation (accepted, not designed around):** the user opted in
     by ticking 50+ emitters. Cleanup is via the existing multi-select
     delete (MT-8). Not worth a special UI surface.

5. **Risk: source file references a texture that the active mod's
   FileManager can't resolve.** Will render with the `IDB_MISSING`
   placeholder.
   - **Mitigation:** acceptable — existing emitter texture path already
     handles this case. User sees the missing-texture magenta and knows
     to fix the texture reference (already a familiar workflow when
     switching mods).

6. **Risk: source file has a different `.alo` format version than the
   destination's `ParticleSystem` understands.** Throws on parse.
   - **Mitigation:** `LoadParticleSystemFromFile` catches the exception
     and shows a descriptive MessageBox. No partial import; nothing is
     touched on the destination side until the picker dialog OK fires.

7. **Risk: linkGroup IDs from source clash with destination linkGroup
   IDs.** The destination already has `linkGroup` IDs in active use; if
   we used source IDs verbatim, a source-group=5 import would silently
   merge with the destination's unrelated linkGroup=5.
   - **Mitigation:** Pass 3 always allocates *new* destination IDs via
     `max(existingDestGroupIds) + 1`. Source IDs are only used to bucket
     picks together; they never propagate into destination state.

11. **Risk: partial-group import surfaces a 1-member group in
    destination.** If user picks only 1 emitter from a 3-member source
    group, the data model says 1-member groups aren't UI-producible.
    - **Mitigation:** Pass 3 skips buckets with `<2` entries. Single-
      member picks from a multi-member source group arrive unlinked
      (linkGroup = 0). User can manually link them via MT-7 if desired.

8. **Risk: undo doesn't fully roll back because some imported emitters
   are reachable from re-mapped parent pointers and others aren't.**
   - **Mitigation:** capture undo *before* the first insert, restore
     wipes the whole `m_emitters` snapshot. The existing UndoStack
     already snapshots/restores `m_emitters` for similar batch ops
     (multi-select delete in MT-8).

9. **Risk: `TVS_CHECKBOXES` parent/child auto-tick recursion fires
   infinite loops via `TVN_ITEMCHANGED` self-notifications.**
   - **Mitigation:** thread-local re-entry guard (`static bool
     s_inAutoTick = false`) around the recursion. Same pattern that
     MT-7's linked-emitter spinner cascade uses.

10. **Accepted risk: source `.alo` paths with non-ASCII characters might
    fail to display in the path label.** Existing dialogs in the editor
    handle wide strings throughout; no special treatment needed.

---

## 5. Testing & verification

**Build.**
- Debug + Release x64 clean (0/0).

**Happy paths.**
- Import one root emitter from a simple `.alo` → arrives as a root in the
  destination. Original spawn fields stripped to `-1` (no descendants
  imported).
- Import a parent + its single child (`spawnDuringLife`) → parent arrives
  with `spawnDuringLife` re-mapped to the imported child's destination
  index. Tree view shows the parent/child shape preserved.
- Import a deeper chain (grandparent → parent → child) → all three arrive,
  all spawn-field re-mappings correct, tree shows three-level hierarchy
  under the destination roots.
- Import only the leaf child (without parent or grandparent) → leaf
  arrives as a root in the destination (no parent pointer).
- Import same emitter from same file twice → second import gets a
  unique name (e.g. `"smoke (2)"`).

**Edge cases.**
- Source `.alo` with zero emitters → dialog opens with empty tree, OK
  disabled.
- Source `.alo` that fails to parse → MessageBox, no dialog opened, no
  state mutated.
- User cancels the file picker → no dialog, no state mutated.
- User clicks Browse… in the dialog, picks a different file → tree
  rebuilds from new file, previous checkbox state is discarded
  (acceptable — explicit user action).
- User cancels the import dialog → no state mutated, undo stack
  unchanged.
- User clicks OK with zero ticked → button is disabled; can't reach
  this state.
- Auto-include-children OFF, user ticks only the middle of a chain →
  middle emitter arrives with parent and child spawn fields both
  stripped to `-1`.
- Source file has 100 emitters → tree renders, scrolls; performance is
  fine (Win32 TreeView handles thousands of items).

**Undo round-trip.**
- After import, Ctrl+Z → all imported emitters removed atomically.
  `m_emitters.size()` returns to pre-import value. Tree view reflects
  rollback.
- Ctrl+Y after undo → all imports re-appear with same names and same
  parent pointers.

**Cross-mod.**
- Active mod = Base Game, source `.alo` = a file from a mod folder →
  emitters import; their texture references resolve in Base Game's
  FileManager chain (loose files / MEGs / mod overlay). Any texture not
  resolvable shows the missing-texture placeholder, *not* an editor
  crash.

**Code-quality static checks.**
- All new `IDC_IMPORT_*` and `ID_FILE_IMPORT_EMITTERS` constants are
  defined in both `resource.en.h` *and* `resource.de.h`.
- `.de.rc` mirrors `.en.rc` structurally (English placeholder strings per
  project convention).
- No new `ColorButton`, `Spinner`, or other custom-control instances —
  this dialog uses only stock Win32.
- `ImportEmittersIntoSystem` is the only writer to `m_emitters` during
  the import path; no in-place spawn-field re-mapping happens outside it.

**Debug instrumentation.**
- `#ifndef NDEBUG`: per-import printf with tag prefix `[Import]`:
  `[Import] N emitters from <path>: src→dst {0→5, 1→6, 2→7, ...}`. Grep
  prefix `[Import]`. Remove before ship or leave gated.

**Pre-handoff smoke run.**
- Cold launch x64 Debug → File → Import Emitters from File… opens picker
  → pick a real `.alo` from `C:\Modding\` → tree populates → tick a
  parent + child → OK → see emitters in the destination, spawn chain
  preserved → Ctrl+Z → emitters gone → Ctrl+Y → back.

---

## Task breakdown (execution order)

1. **Resource scaffolding.** Add new IDs to `resource.en.h` / `.de.h`. Add
   File menu entry to both `.rc` files. Add `IDD_IMPORT_EMITTERS` dialog
   template (en + de). ~30 min.
2. **`LoadParticleSystemFromFile` helper.** Opens a path via
   `new PhysicalFile`, constructs `ParticleSystem` via the existing
   `(IFile*)` constructor, catches `IOException` / parser exceptions.
   Returns `ParticleSystem*` or `NULL`. ~20 min.
3. **`ImportEmittersDialogProc` skeleton.** Modal dialog, `WM_INITDIALOG`
   loads the file + populates the tree, OK gathers ticked indices into
   a `vector<size_t>`. Cancel returns nothing. ~60 min.
4. **TreeView build from source `ParticleSystem`.** Mirror
   `EmitterListControl`'s tree-population pattern, but using a separate
   tree. Store `(LPARAM)source_index` instead of `(LPARAM)Emitter*` —
   we don't keep pointers to the temporary source system after the
   dialog closes. ~60 min.
5. **Checkbox propagation with auto-include-children.** `TVN_ITEMCHANGED`
   handler with re-entry guard; recursion when the checkbox is set. ~45 min.
6. **Select all / Clear / Browse buttons.** Mechanical. ~30 min.
7. **`ImportEmittersIntoSystem` engine.** Two passes per §3.3, parent
   pointer rebuild, name collision handling, undo capture wrap. ~90 min.
8. **Hook File → Import Emitters from File… in `WM_COMMAND`.** Calls
   `DoImportEmittersFromFile(info)` which invokes the picker → loads file
   → opens dialog → calls `ImportEmittersIntoSystem` on OK. ~30 min.
9. **EmitterListControl refresh after import.** Existing emitters-changed
   notification or direct refresh call. ~20 min.
10. **Build Debug x64.** Fix errors / warnings. ~20 min loop.
11. **Build Release x64.** ~5 min.
12. **Smoke-walk every test row in §5.** Document results. ~45 min.
13. **DEVELOPMENT_LOG + ROADMAP entries.** New shipped entry; LT-3 moves from §3
    to §5 (shifts long-term §3.4 LT-4 to §3.3, vacates `[LT-3]` tag). ~30 min.
14. **Commit (2 commits: feature + docs), push, PR, merge, backfill.** ~30 min.

Total: ~8.5 hours assuming no surprises in the checkbox-tree UX or the
spawn-field re-mapping. Buffer to ~10–12 hours for the inevitable
"oh wait, the tree needs ___" iterations.

---

## Open questions to resolve before implementation

1. **Should the dialog be modal or modeless?** Modal is simpler (no
   mod-switch concerns, no stale source-system pointer if the user
   changes mods mid-import). I'm assuming modal. The other modeless
   pickers in this codebase (skydome, ground, palette) all carry state
   across sessions, which makes them benefit from modeless. The import
   dialog is a one-shot — modal fits better.

2. **What's the right default for *auto-include-children*?** I'm assuming
   **on** (safe default: ticking a parent gets you a working sub-effect).
   The minority case is "I want one specific emitter from this file and
   none of its descendants", which still works by unticking afterwards.

3. **Where in the File menu should the entry sit?** Suggested position:
   between *Save As* and the separator before *Exit* (or after *Open*
   alongside other "file in / file out" commands). Either reads
   naturally.

4. **Should the destination's existing emitters be visible in the
   dialog?** I.e. show the *destination*'s tree on one side of the
   picker, the *source* tree on the other. Adds clarity ("here's where
   they'll land") but doubles the dialog complexity. v1 default: no,
   destination is implicit. Future PR if users ask.

5. **Should there be a "preserve link groups within this import" mode?**
   If the user imports 3 emitters that were all in linkGroup=7 in the
   source, the v1 behaviour strips all linkGroups. A "re-create the group
   in destination" option would preserve the intent. **Recommended:
   defer to a follow-up PR.** Implementing it correctly requires also
   handling: "the source linkGroup had 4 members but only 3 were
   imported — re-link the imported 3 as a new group?" — yes/no UX that
   adds complexity for a feature most imports won't need.
