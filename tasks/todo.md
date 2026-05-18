# LT-4 Phase 4.1 — Fix dispatch 1: Layout reshuffle + Basic-tab property panel

## Goal & scope

Land the four-quadrant layout matching legacy + the Basic tab of a new
`EmitterPropertyTabs` component. Closes parity findings #2 (missing
emitter property panel) and #3 (curve editor on right instead of legacy
bottom). Schema is complete for Basic + Appearance + Physics + groups so
follow-up dispatches just add UI without schema churn.

**In:** Four-quadrant App.tsx; EmitterPropertyTabs with Radix Tabs (3
tabs); Basic tab — 18 fields wired via `emitters/set-properties`;
Appearance + Physics tab placeholders; EmitterPropertiesDto with every
Basic + Appearance + Physics + groups field; `emitters/get-properties` +
`emitters/set-properties` bridge calls; C++ handlers; MockBridge
overlay; +8 Vitest, +2 Playwright.

**Out:** Appearance UI (dispatch 2), Physics UI + Group distribution
(dispatch 3), D3D viewport bugs (dispatch 4), marquee select / menus
(dispatch 5). Legacy `src/UI/Emitter.cpp` untouched.

## Approach

- Schema: `EmitterPropertiesDto` (all Basic/Appearance/Physics + groups),
  `GroupDto`, +2 Request kinds.
- MockBridge: id-keyed overlay store layered on `makeFixtureProperties`,
  mirroring `useMockTrackOverlay` pattern.
- C++ host: `emitters/get-properties` walks the emitter; `emitters/
  set-properties` iterates patch keys, captures undo once, emits events
  once. Pattern mirrors `emitters/get-tracks` + `emitters/rename` from
  Screens 4/6.
- React: new `EmitterPropertyTabs` mounted in lower-left quadrant. Old
  `EmitterPropertyPanel` repurposed as lower-right TrackEditor mount.
  `App.tsx` layout becomes 2x2 grid.

## Risks

1. Radix Tabs flaky in jsdom — assert via `data-state` + Basic default-open.
2. Schema bloat — group fields by tab, cross-ref struct line ranges.
3. C++ partial patch — iterate `patch.items()`, not field-by-field.
4. Optimistic local update vs engine echo — tree/changed re-fetch wins.
5. Tool-panel overlay positioning — keep ToolPanels inside viewport
   quadrant which becomes their positioned ancestor.
6. Delete-key handler on EmitterPropertyPanel — unchanged; routes Delete
   to TrackEditor.deleteSelected.
7. Panel sidebar styling — drop `w-80` + `border-l` from inner panel.

## Verification

- pnpm build (0 exit).
- pnpm test 155+ (was 147).
- MSBuild Debug x64 (0 exit).
- pnpm test:native 71+ (was 69).

## Progress

- [x] Add deps `@radix-ui/react-tabs` + `@radix-ui/react-checkbox`.
- [x] Schema: GroupDto + EmitterPropertiesDto + get/set-properties.
- [x] mock-state: fixture + overlay store.
- [x] mock.ts: 2 handlers.
- [x] bridge-contract.test: +2 specs.
- [x] EmitterPropertyTabs.tsx: new component.
- [x] EmitterPropertyTabs.test: 5 specs.
- [x] App.tsx: four-quadrant layout.
- [x] EmitterPropertyPanel.tsx: drop sidebar styling.
- [x] EmitterPropertyPanel.test: update assertions if needed.
- [x] Playwright spec: tests/property-tabs.spec.ts (+ register).
- [x] C++ host: get-properties + set-properties handlers.
- [x] Verify all four gates green.

## Review

- **Deps:** `@radix-ui/react-tabs@^1` + `@radix-ui/react-checkbox@^1`
  added to `web/apps/editor/package.json`.
- **Schema:** added `GroupDto`, `EmitterPropertiesDto` (covers Basic +
  Appearance + Physics + 3 groups), 2 new Request kinds + 2 ResponseFor
  arms.
- **MockBridge:** `makeFixtureProperties(id)` + `useMockEmitterProperties`
  overlay store mirror the `useMockTrackOverlay` pattern from Screen 6.
  Properties patch via `name` also mirrors onto the tree node so the
  emitter tree label updates without a separate rename round-trip.
- **C++ host:** `emitters/get-properties` walks the emitter (~45 fields
  + 3 Group entries) and emits the DTO; `emitters/set-properties`
  iterates patch keys with type guards, captures undo once, fires
  state/changed + tree/changed + markDirty once. MSBuild Debug x64
  clean.
- **App.tsx:** 2x2 grid; left column `w-80`; right column flex-1; left
  bottom `h-72`, right bottom `h-80`. All four quadrants tagged with
  `data-testid="quadrant-<role>"`.
- **EmitterPropertyPanel:** repurposed — drops `w-80` / `border-l`,
  now fills the lower-right quadrant naturally.
- **EmitterPropertyTabs:** new component, Basic tab fully wired (18
  fields), Appearance + Physics show "Coming in Fix dispatch N"
  placeholders. `useBursts` and `randomRotation` enable/disable the
  related fields per legacy mutex behaviour.
- **Vitest:** 147 → 155 (+8). +2 bridge-contract, +5
  EmitterPropertyTabs, +1 EmitterPropertyPanel layout assert.
- **Playwright:** 69 → 71 (+2). `tests/property-tabs.spec.ts`.
- **All four gates green.**
