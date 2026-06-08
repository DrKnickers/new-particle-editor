# Paste As ▸ Child — design (SEL-5 / MNU-4)

*2026-06-07 · new-particle-editor / lt-4 · native lane*

## 1. Goal + scope

Restore the legacy **"Paste As ▸ Child"** capability the React port dropped. After
copying or cutting an emitter, the user can right-click another emitter and paste the
clipboard emitter **into that emitter's lifetime or death child slot**, instead of as a
new root. This is the last HIGH-severity clipboard gap from the UI delta report
(SEL-5 / MNU-4); plain Cut/Copy/Paste and the keyboard path already shipped.

### In
- New host command `emitters/paste-as-child { parentId, slot }` → `{ newId }`.
- Bridge-schema entry + response-type mapping.
- MockBridge implementation (so the web suite + preview exercise it).
- Emitter-tree **context menu**: a `Paste As ▸` submenu with **Lifetime Child** /
  **Death Child** items, placed directly after the existing **Paste** item.
- Gating: each item enabled iff the session clipboard has content **and** that child
  slot on the right-clicked emitter is free.
- TDD on the web side (mock + menu); native a11y golden re-baseline for the dialog/tree
  surface that captures the context menu, if any; native harness 168/0 maintained.

### Out (with reasons)
- **Edit-menu Paste-As** — legacy only ever surfaced Paste-As in the tree context menu
  (`IDR_EMITTER_CONTEXT_MENU`); a global Edit-menu entry has no unambiguous target.
  (User-confirmed: context-menu only.)
- **Multi-emitter paste into a slot** — a slot holds exactly one child. When the
  clipboard holds several emitters, paste the **first** buffer only; ignore the rest.
  (User-confirmed.) No new "clipboard count" signal to React.
- **Slot-switch / overwrite an occupied slot** — refused, exactly like the existing
  Add-Lifetime/Death-Child commands. The menu item is disabled when the slot is filled;
  the host self-guards regardless.
- **Curve-key "Paste As"** — unrelated surface, separate finding.

## 2. What the codebase already gives us

**Legacy reference (authoritative behaviour).**
- `IDR_EMITTER_CONTEXT_MENU` (`src/ParticleEditor.en.rc:638-648`): `Paste As ▸` submenu
  → `ID_PASTEAS_LIFETIME` ("Child Emitter (Lifetime)") + `ID_PASTEAS_DEATH`
  ("Child Emitter (on Death)").
- Enable gates (`src/UI/EmitterList.cpp:3422-3423`): Lifetime enabled iff
  `selection && selection->spawnDuringLife == -1`; Death iff `spawnOnDeath == -1`.
- Dispatch (`EmitterList.cpp:3747-3748`): `PasteEmitter(hWnd, control, &EmitterList_AddLifetimeEmitter)`
  / `&EmitterList_AddDeathEmitter`. `PasteEmitter` (`:922`) deserialises **one**
  `CF_PARTICLE_EMITTER` blob, renames via `GenerateDuplicateName`, calls the attach func.

**Host building blocks (all present).**
- `m_emitterClipboard` — `std::vector<std::vector<uint8_t>>`, filled by `emitters/copy`/`cut`.
- Paste deserialisation already written in the `emitters/paste` handler
  (`BridgeDispatcher.cpp:4561-4595`): MemoryFile → `ChunkReader` → `Emitter staging(reader)`
  → `GenerateDuplicateName(sys, staging.name)`.
- `ParticleSystem::addLifetimeEmitter(parent, emitter)` / `addDeathEmitter(parent, emitter)`
  (`ParticleSystem.cpp:1271-1300`): attach into the slot; **return NULL (no-op) if the slot
  is already filled** — self-guarding.
- `getEmitterById(id)`, `captureUndo()`, `markDirty()`, `EmitEngineStateChanged()`,
  `EmitEmittersTreeChanged()` — the exact sequence used by `emitters/add-lifetime-child`
  (`BridgeDispatcher.cpp:4063-4085`), which this command mirrors.

**Web building blocks.**
- `emitters/add-lifetime-child { parentId } → { newId }` (`bridge-schema/src/index.ts:692`)
  is the closest existing command — same signature family.
- `useEmitterClipboardHasContent()` (`lib/emitter-clipboard.ts`) — the session
  clipboard-has-content flag the context-menu Paste already gates on.
- Per-row `hasLifetimeChild` / `hasDeathChild` (`EmitterTree.tsx:312-313`), already used to
  disable the existing **Add Lifetime/Death Child** items.
- `handleAddLifetimeChild` / `handleAddDeathChild` (`EmitterTree.tsx:419-430`) — the
  resolve-target + bridge-request pattern to mirror.
- Context-menu **Paste** item at `EmitterTree.tsx:724-730`; the submenu goes right after it.

## 3. Architecture / implementation approach

### 3.1 Host command (native)
```
emitters/paste-as-child { parentId: number; slot: "lifetime" | "death" }
  → { newId: number }      // child index, or -1 on refusal
```
Handler (new block in `BridgeDispatcher.cpp`, beside `emitters/paste`):
1. Resolve `parent = getEmitterById(parentId)`. Guard system + parent → `{newId:-1}`.
2. If `m_emitterClipboard.empty()` → `{newId:-1}` (silent; no undo/dirty).
3. Take the **first** buffer (`m_emitterClipboard.front()`). Empty → `{newId:-1}`.
4. `captureUndo();` deserialise: MemoryFile → `ChunkReader` → `Emitter staging(reader)` →
   `staging.name = GenerateDuplicateName(sys, staging.name)`.
5. `child = (slot == "death") ? sys->addDeathEmitter(parent, staging)
                              : sys->addLifetimeEmitter(parent, staging);`
6. `child == nullptr` (slot occupied / deser threw) → `{newId:-1}`. The `captureUndo`
   already ran, pushing a no-op snapshot — this is **exactly** the existing add-child
   behaviour (`add-lifetime-child` captures at `:4072` *before* the null-check at `:4075`),
   so it's parity, not a new wart. Accepted.
7. Else `{newId: child->index}`; `markDirty(); EmitEngineStateChanged(); EmitEmittersTreeChanged();`.

Wrap deser in try/catch (the `emitters/paste` handler does); a throw → `{newId:-1}`.

### 3.2 Bridge schema
- Add the request union member + `slot` literal type.
- Add the `R extends { kind: "emitters/paste-as-child" } ? { newId: number } :` response map
  (beside the add-child mappings at `:998`).

### 3.3 MockBridge
- `mock.ts` `isKnownKind`: add `emitters/paste-as-child` → true.
- `mock.ts` dispatch: a new `emitters/paste-as-child` case mirroring the
  `add-lifetime-child`/`add-death-child` cases (`mock.ts:938-962`), but seeding the child
  from `useMockEmitterClipboard.getState().buffer[0]` instead of a blank emitter.
- `mock-state.ts`: a new helper `pasteAsChildFromClipboard(tree, buffer, parentId, slot)
  → { tree, newId } | null` that combines the existing child-attach logic
  (`addLifetimeChildEmitter` / `addDeathChildEmitter`, `mock-state.ts:506/561` — both
  already return `null` on an occupied slot) with a clone of `buffer[0]` as the seed.
  Returns `null` on empty buffer or occupied slot → the mock case returns `{newId:-1}`,
  matching the host.

### 3.4 React context menu
- New handlers in `EmitterTree.tsx`, mirroring `handleAddLifetimeChild`:
  ```
  const handlePasteAsLifetime = () => { resolveTargetIds();
    void bridge.request({ kind:"emitters/paste-as-child",
      params:{ parentId: node.id, slot:"lifetime" } }); };
  // …Death analogous with slot:"death"
  ```
- JSX: a `ContextMenu.Sub` ("Paste As") inserted immediately after the Paste item
  (`:730`), with two `ContextMenu.Item`s:
  - "Lifetime Child" — `disabled={!hasClipboard || hasLifetimeChild}`
  - "Death Child" — `disabled={!hasClipboard || hasDeathChild}`
- The whole submenu trigger can also disable when `!hasClipboard` (both children unusable),
  keeping it greyed until something is copied — matches the Paste item's gating.

### 3.5 Data flow
right-click row → promote-to-select (`resolveTargetIds`) → bridge `paste-as-child` →
host attaches child + emits `emitters/tree/changed` → React re-renders the tree with the
new child node. No new event types; reuses the tree-changed broadcast every mutation uses.

## 4. Risks named up front + mitigations

1. **`captureUndo` on a refused paste leaves a redundant undo step.** The handler captures
   before the null-check (step 4 before 6), so a slot-occupied refusal that slips past the
   menu gate still pushes an undo snapshot. *Mitigation:* this is the existing add-child
   behaviour (it also captures before the null check), so it's parity, not a regression;
   and the menu gate makes the refusal path unreachable in normal use. Accepted. If we want
   it tighter, move the slot-free check before `captureUndo` — but that duplicates engine
   state the engine already owns; not worth it.

2. **First-buffer choice surprises a multi-select-copy user.** Copying 3 emitters then
   Paste-As-Lifetime silently pastes only the first. *Mitigation:* a slot is single-occupancy
   by definition; legacy pasted one too. Low-severity, user-confirmed. No silent data loss —
   the clipboard is unchanged, the user can paste-as-root for the rest.

3. **a11y golden fan-out from a new submenu.** A `ContextMenu.Sub` adds nodes to whatever
   golden captures the emitter-tree context menu. *Mitigation:* check which golden (if any)
   opens this context menu before coding; expect a surgical, single-surface delta. Follow
   L-068 (build dist before harness) + L-053 (one shared cause). If NO golden opens the
   context menu, there's zero native golden impact and only `test:native` 168/0 to re-confirm.

4. **Mock clipboard divergence from host.** The mock must model "first buffer + occupied-slot
   refusal" the same way the host does, or web tests pass while native differs.
   *Mitigation:* TDD the mock against the same scenarios the host handler implements
   (empty clipboard, free slot, occupied slot); keep the mock's child-attach path identical
   to its add-child cases.

5. **Native lane must be rebuilt** (this is a C++ change, not web-only). *Mitigation:* the
   lane is already restored in this worktree (packages/ + Debug x64 + dist this session);
   rebuild the `.sln` Debug x64 after the C++ edit, `pnpm build` before the harness (L-068).

## 5. Testing & verification

**Web unit (TDD, mock-driven):**
- [ ] `paste-as-child` with a free lifetime slot + non-empty clipboard → new lifetime child
      appears under the parent; returns a real `newId`.
- [ ] same for death slot.
- [ ] occupied slot → `newId:-1`, tree unchanged.
- [ ] empty clipboard → `newId:-1`, tree unchanged.
- [ ] Context menu: "Paste As ▸ Lifetime Child" disabled when no clipboard; enabled after a
      copy; disabled when the row already has a lifetime child. Death analogous.
- [ ] Clicking the item fires `emitters/paste-as-child` with the right `parentId`/`slot`.
- [ ] Full suite green; `tsc --noEmit` 0.

**Live (preview, MockBridge):** copy an emitter → right-click another → Paste As ▸ Lifetime
Child → child node appears; the slot's item is now greyed; Death slot still available.
(Not a drag feature — `preview_eval`/click navigation is fine; L-067 doesn't apply.)

**Native:**
- [ ] `.sln` Debug x64 rebuild clean.
- [ ] `pnpm build` + `grep` confirms the new menu strings in `dist` (L-068).
- [ ] `pnpm a11y:update`: review the golden diff — surgical, single surface (or none if the
      context menu isn't captured). `pnpm test:native` → **168/0**.
- [ ] Manual host round-trip if feasible: copy → paste-as-child → child attaches; undo
      removes it; redo restores.

**Debug instrumentation:** none anticipated (reuses logged host paths). If the mock/host
diverge during bring-up, add a temporary `#ifndef NDEBUG` printf tagged `[paste-as-child]`
in the handler and remove before handoff.
