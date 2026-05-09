# Plan: "Buttons to reorder emitters" (ROADMAP near-term item)

## Goal

Add **Move Up** / **Move Down** buttons to the emitter-list toolbar that swap
the selected emitter with its neighbor in the underlying `m_emitters` vector,
keeping all spawn-field cross-references valid.

Per ROADMAP: "The same logic underlies drag-and-drop reordering, so shipping
the buttons first de-risks that work." Treat this as the foundation for the
DnD reorder item that follows.

---

## Proposed button placement

Existing emitter-list toolbar (left → right, from
[src/UI/EmitterList.cpp:232-241](src/UI/EmitterList.cpp:232)):

```
[New ▾] | [Delete] [👁] | [Show All] [Hide All]
```

The toolbar already groups buttons by intent, separated by `TBBUTTON`
separators:

| Group | Buttons | Operates on |
|---|---|---|
| **Create/Delete** | New (dropdown), Delete | selection (or new top-level) |
| **Visibility** | Toggle 👁, Show All, Hide All | selection / all |

Move Up / Down is its own intent — *reorder selection in-place* — and operates
on the selected emitter. Cleanest fit: a third group inserted **between the
Create/Delete group and the Visibility group**, separators on both sides:

```
[New ▾] | [Delete] | [▲] [▼] | [👁] | [Show All] [Hide All]
```

Rationale:

- **Adjacent to Delete**, because both are selection-targeted destructive-ish
  operations and the user's mental flow is "I picked this emitter, what
  actions can I take on it?" Putting them next to Delete reads naturally.
- **Up before Down** matches keyboard arrow key order and reading order.
- **Not at the far right** with Show All / Hide All — those are bulk actions,
  unrelated to the current selection.
- **Not in a dropdown** — these are first-class operations, not a fallback
  menu like the New ▾ split-button.

Right-click context menu: add the same two items (between **Rename** and
**Rescale** — i.e., in the "operate on this emitter" cluster) so keyboard /
mouse parity exists.

Keyboard accelerators worth wiring up while we're here: `Alt+Up` / `Alt+Down`
(matches VS Code, JetBrains, etc. for reorder).

---

## Steps

### 1. Backend — `ParticleSystem::moveEmitter(emitter, direction)`

Mirrors the index-shift pattern from `deleteEmitter` /
`insertEmitterAfter` ([src/ParticleSystem.cpp:792-827](src/ParticleSystem.cpp:792)),
but for an adjacent-pair swap.

Signature:

```cpp
// Swap `emitter` with its neighbor at offset `direction` in m_emitters.
// direction = -1 moves up (toward index 0), +1 moves down. Returns false
// if the swap would be a no-op (top moving up / bottom moving down) or
// would violate a parent-must-precede-child invariant; in that case
// nothing changes.
bool moveEmitter(Emitter* emitter, int direction);
```

Implementation:
1. Compute `i = emitter->index` and `j = i + direction`. Bounds-check
   both. If out of range → return false.
2. **Verify**: file format / runtime requires children to come after their
   parents in `m_emitters`. Need to confirm by reading the post-load
   validation loop and the writer; if confirmed, refuse swaps that would
   put an emitter before its parent or its parent after its child. (See
   "Open questions" below — must answer before coding.)
3. Walk every emitter; for each one that has `parent != NULL`, if the
   parent's `spawnDuringLife == i` → set to `j`; else if `== j` → set to
   `i`. (This correctly swaps any references to either slot.) Same for
   `spawnOnDeath`.
4. Swap `m_emitters[i]` and `m_emitters[j]`.
5. Update the two emitters' own `index` fields.

### 2. UI — `EmitterList_MoveEmitter(hWnd, int direction)`

In `src/UI/EmitterList.cpp`. Calls `system->moveEmitter(selection, dir)`.
On success, refresh the tree using the existing `OnParticleSystemChange`
full-rebuild path ([src/UI/EmitterList.cpp:598](src/UI/EmitterList.cpp:598)),
restore selection (the moved emitter's pointer is still valid; just
`TreeView_SelectItem` for the matching `HTREEITEM`), notify parent
`ELN_LISTCHANGED`.

Why full rebuild rather than two `TreeView_DeleteItem` + `TreeView_InsertItem`
pairs: the rebuild path already exists and has been used on load for years;
correctness > a microscopic perf gain on a list of ≤ ~50 emitters. Drag-and-
drop reorder will likely follow the same pattern.

Wire into:
- `WM_COMMAND` handler in the toolbar / context-menu dispatch
  (~[src/UI/EmitterList.cpp:266-373](src/UI/EmitterList.cpp:266)).
- Keyboard accelerator pump (Alt+Up / Alt+Down) — most likely in
  `EmitterTreeViewWindowProc`'s `WM_CHAR` block alongside the existing
  Ctrl+C/X/V handlers ([src/UI/EmitterList.cpp:170](src/UI/EmitterList.cpp:170)).

### 3. Button enable/disable

`NotifyParent(ELN_SELCHANGED)`
([src/UI/EmitterList.cpp:24-26](src/UI/EmitterList.cpp:24)) currently enables
Delete and Visibility-toggle based on whether anything is selected. Extend
the same call site to set Up/Down state via `TB_ENABLEBUTTON`:
- Up: enabled iff selection != NULL **and** selection->index > 0 **and**
  the swap target (if computed) wouldn't violate the parent-precedence
  invariant.
- Down: same with `< m_emitters.size() - 1` and the inverse precedence
  check.

Re-evaluate on every selection change and after every reorder.

### 4. Resources

**Toolbar bitmap.** `IDR_EMITTER_TOOLBAR` is currently 5 icons × 16×15 px
(80×15 total) in `resources/toolbar2.bmp`. Need to extend to 7 icons
(112×15 px) with up-arrow and down-arrow glyphs at indices 5 and 6.

I'll author the bitmap in code (PowerShell + System.Drawing) so the source
of truth is reproducible — record the generator script in `tasks/` next to
`fix_rc_encoding.ps1`. Use the same chroma key (`RGB(0,128,128)`) the
existing toolbar uses for transparency. The 16×15 size is awkwardly
non-square but matches what's already there — don't break the existing
icons by changing dimensions.

**Resource IDs.** New constants in both `src/Resources/resource.en.h` and
`src/Resources/resource.de.h`:
- `ID_MOVE_EMITTER_UP`
- `ID_MOVE_EMITTER_DOWN`

Pick numbers in the same range as the other emitter-list IDs (~40080-90).

**Right-click context menu.** Two new `MENUITEM` entries in both
`ParticleEditor.en.rc` and `ParticleEditor.de.rc` for `IDR_EMITTER_CONTEXT_MENU`
(or whichever the emitter context menu is named). German strings:
"Nach &oben verschieben" / "Nach &unten verschieben".

**Accelerator table.** Add Alt+Up / Alt+Down to the same accelerator table
that hosts the existing emitter accelerators (Delete, F2, etc.). Locate
in main.cpp / .rc.

### 5. Test plan

- Move Up on the top-most root emitter: button greyed; if invoked anyway
  (e.g., via accelerator), no-op.
- Move Down on the bottom-most emitter: same.
- Move a root emitter that has Lifetime + Death children:
  - Children remain attached (parent pointers unchanged).
  - In the vector: root and its children move as a block? Or just the root,
    with children staying put? **This depends on what the file format
    requires** — see Open questions.
- Move an emitter past an unrelated sibling: spawn-field references on
  every parent still resolve to the same logical child after the swap.
- Save → reload: tree is identical to pre-save state. (Round-trip test.)
- Multi-step: move A down, then up — back to original state. Idempotent
  pair of operations.

### 6. CHANGELOG + ROADMAP updates

Per CLAUDE.md, on ship:
- Mark `### Buttons to reorder emitters` shipped in [ROADMAP.md](ROADMAP.md):
  strikethrough, append `✅ Shipped (#NN)`, add an *Actual:* line.
- Move the entry to the **Shipped** section per the convention established
  in PR [#21](https://github.com/DrKnickers/new-particle-editor/pull/21).
- Add a CHANGELOG entry describing the button placement, the
  parent-precedence invariant (whatever we settle on), and the keyboard
  shortcuts.

---

## Open questions to resolve **before** coding

These need answers before step 1 can land cleanly. I'll dig into the code
and answer them as the first action of the implementation phase, but
flagging here so the user can correct any wrong assumptions.

1. **Does the file format / runtime require children to appear after their
   parents in `m_emitters`?** Look at the post-load validation
   loop in `ParticleSystem::ParticleSystem` and the chunk writer. If yes,
   `moveEmitter` must refuse swaps that would invert parent/child order.
   If no, we can swap freely and only the spawn-field index references need
   to update.

2. **When a parent moves, do its children move with it, or stay put?** If
   children must follow their parent in the vector (likely, given typical
   .alo conventions), then "move root with N children down by 1" means
   shifting N+1 entries, not 1. The roadmap entry says "swaps with its
   neighbor" — implying single-slot swap — but that may need refinement
   for parents with children.

3. **Tree-level semantics for child emitters.** Can a Lifetime child be
   moved Up past a sibling Death child of the same parent? Both occupy
   different *slots* (`spawnDuringLife` vs `spawnOnDeath`) — there's no
   "order" between them in the file format. So Up/Down on a child emitter
   is meaningful only for sibling re-ordering within the same parent's
   `spawnDuringLife` chain (if children chain), which I haven't verified
   exists.

The simplest scope-tight version of this feature: **Up/Down only move
top-level (root) emitters, and only past other top-level emitters.**
Children move with their parent when the parent moves. Buttons grey out
when the selected emitter is a child. Defer "reorder children within a
parent" to the drag-and-drop item that follows.

I lean toward starting with that scoped version. Roadmap calls for more
general reordering eventually, but matching it 1:1 in the first cut adds
complexity (children chains, slot semantics) that isn't needed to land
the feature usefully.

---

## Recommendation

- Resolve the three open questions above by reading the code (≤ 30 min).
- Implement the **roots-only** scoped version first.
- File a follow-up roadmap entry for "reorder children within a parent"
  if it turns out to be desirable separately from drag-and-drop.

Awaiting confirmation before starting step 1.
