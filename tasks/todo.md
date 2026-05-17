# Screen 4 Batch B2 — Add child + Move + Link-group membership + multi-select (2026-05-17)

## Goal & scope

**In:** Four new bridge call kinds (add-lifetime-child, add-death-child,
move, linkGroups/set-membership), one new modal (SetLinkGroupDialog),
six new context-menu items on EmitterTree rows with disabled states,
React-side multi-select via a new Zustand atom (`emitter-selection`).

**Out:** Drag/drop (Batch B3), inline rename / keyboard nav / link-group
bracket visualisation (Batch C), legacy EmitterList.cpp edits (stays for
`--legacy-ui` until Phase 4.2).

## What the codebase gives us

- `ParticleSystem::addLifetimeEmitter` / `::addDeathEmitter` at
  [src/ParticleSystem.cpp:1110/1125] — both no-op if slot is filled,
  return new emitter or NULL.
- `ParticleSystem::moveEmitter(emitter, direction)` at
  [src/ParticleSystem.h:297] — already swap-adjacent-roots; returns
  false at edge / non-root. Direct fit.
- `Emitter::linkGroup` direct field write. `detachFromLinkGroup()`
  sets it to 0.
- Dispatcher helpers: `getEmitterById`, `captureUndo`, `markDirty`,
  `EmitEngineStateChanged`, `EmitEmittersTreeChanged`.
- Mock-side: `findEmitterNode`, helpers in mock-state, tree-context
  atom.
- Tree DTO already exposes `linkGroup` per node and children with
  roles — sufficient to derive Add-Lifetime/Death disabled states
  without DTO extension.

## Implementation approach

### Schema (4 new bridge calls)

- `emitters/add-lifetime-child { parentId }` → `{ newId }`
- `emitters/add-death-child   { parentId }` → `{ newId }`
- `emitters/move              { id, direction: "up"|"down" }` → `{}`
- `linkGroups/set-membership  { ids: number[], groupId: number | null }` → `{}`

### Mock

Helpers in `mock-state.ts`:
- `addLifetimeChildEmitter(tree, parentId): { tree, newId } | null`
- `addDeathChildEmitter(tree, parentId): { tree, newId } | null`
- `moveEmitterInTree(tree, id, dir): EmitterTreeDto | null`
- `setLinkGroupMembership(tree, ids, groupId): EmitterTreeDto`
- `findUnusedLinkGroupId(tree): number`

Handlers in `mock.ts`: 4 new arms, each emits `emitters/tree/changed`.
`isMutating` gains entries for all four.

### C++ host

4 new arms in `DispatchInternal`:
- add-lifetime-child / add-death-child: invoke ParticleSystem helper,
  return `{ newId: emitter->index }`. Refuse with ok:false if slot
  filled / parent not found.
- move: `(*m_pParticleSystem)->moveEmitter(target, dir)` (dir: up=-1,
  down=+1). Always returns `{}` (engine refusal is a no-op, not error).
- set-membership: walk `ids`. For groupId === -1 scan all emitters for
  max linkGroup and assign `max+1`. For null/0 set 0. Else set groupId.

Each emits `engine/state/changed`, `emitters/tree/changed`, marks dirty.

### React — multi-select atom (`lib/emitter-selection.ts`)

Zustand:
```
ids: number[]               // ordered, set semantics via actions
primary: number | null
setSingle(id)
toggle(id)                  // updates primary to id when adding,
                            // keeps primary if removed (or clears if
                            // removed was primary)
range(toId, orderedIds)     // uses current primary; updates primary
                            // to toId
clear()
```

Selector hooks return scalars (or stable arrays via shallow-equality
selectors).

### React — EmitterTree

- Compute memoized `orderedIds` (in-order walk).
- Pass to rows. Click handler reads `event.ctrlKey || event.metaKey`,
  `event.shiftKey`.
- plain: setSingle + bridge select.
- ctrl/meta: toggle (still bridge select with the new primary).
- shift: range against current primary + orderedIds.
- Right-click on a row not in selection: promote to single-select before
  opening menu (matches OS behaviour).
- Add 6 context items + 3 separators after existing menu. Disabled
  states:
  - Add Lifetime Child: `children.some(c => c.role === "lifetime")`
  - Add Death Child: `children.some(c => c.role === "death")`
  - Move Up: `role !== "root" || siblingIndex === 0`
  - Move Down: `role !== "root" || siblingIndex === siblings.length - 1`
  - Set Link Group…: never disabled (always usable)
  - Leave Link Group: every selected emitter has linkGroup === 0
- Container exposes `data-selected-count` and `data-primary-id` for
  Playwright.
- Row primary vs non-primary border style.

### React — SetLinkGroupDialog

New screen. `tree-context.open === "set-link-group"`. Body has
plain HTML radios (no new dep) and a `<select>` of existing groups.
OK uses current selection ids from emitter-selection atom.

### tree-context + App

Extend `open` union with `"set-link-group"`; mount dialog in App.tsx.

## Risks + mitigations

1. **Tree DTO lacks `spawnDuringLife/spawnOnDeath`** — for Add child
   disabled state. Mitigated by deriving from children roles.
2. **moveEmitter children are no-ops on engine** — UI disables Move
   Up/Down for non-root emitters; matches engine refusal.
3. **Bridge-contract test's "rejects" assertion** uses
   `emitters/update` (still unimplemented) — leave as-is.
4. **Radix jsdom limitations** — multi-select tests fire DOM click
   events with modifier flags directly via `fireEvent.click(row, {
   ctrlKey: true })` (these don't go through Radix's portal); the row's
   own onClick is regular React, so it works.
5. **Context-menu when right-clicked row isn't in selection** —
   promote to single-select first (lazy, on menu-item-select handlers
   that operate on `ids`). Implement by reading current selection at
   handler time and falling back to `[node.id]` if empty.

## Testing & verification

### Vitest (90 → 98+)
- bridge-contract.test.ts (+4)
- SetLinkGroupDialog.test.tsx (+1)
- EmitterTree.test.tsx (+2: Ctrl+click, Shift+click)
- emitter-selection.test.ts (+1)

### Playwright (54 → 57+)
- Add Lifetime Child via context menu
- Move Down via bridge swaps adjacent roots (host has 1 root by
  default; we duplicate first to grow the tree)
- Ctrl+click multi-selects (via DOM + data-selected-count assertion)

### Build gates
- pnpm build → 0
- pnpm test → 98+
- MSBuild Debug x64 → 0
- pnpm test:native → 57+

## Review

All four verification gates passed:

- `pnpm build` exits 0 (1869 modules transformed, 421 KB output).
- `pnpm test` 105/105 (target 98+, delta +15).
- MSBuild Debug x64 0 warnings / 0 errors.
- `pnpm test:native` 57/57 (target 57+).

The dispatcher implementation slotted straight onto the existing
ParticleSystem API — `addLifetimeEmitter` / `addDeathEmitter` /
`moveEmitter` all had the exact semantics the schema needs. The
unused-link-group-id picker is a single linear scan; the React
multi-select atom uses a small `number[]` + `primary` shape so
tests can compare against arrays directly.

One surprise during Playwright authoring: `moveEmitter` rewrites
emitter indices, so a spec that captured the duplicate's `newId`
before the move couldn't use that id to locate the row afterward.
Workaround: identify the duplicate by its auto-suffixed name
(`_<digits>` regex) in both pre- and post-move trees. Documented
in the lt4_design_parking_lot.md iteration log.

Batch B3 (drag/drop) and Batch C (link-group brackets, inline
rename, keyboard nav) remain open on Screen 4.

