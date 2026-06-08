# a11y surfaces deferred from Phase 3 close-out (T6 / T7)

The Phase 3 a11y close-out plan listed 13 candidate dialog surfaces (T6)
and a set of additional content / popover surfaces (T7). The R3 risk
mitigation explicitly caps per-surface setup work at 30 minutes — any
surface needing more is dropped here for a future polish pass rather
than blowing the time budget.

Format: one entry per deferred surface, with the reason and a one-line
sketch of what re-introducing it would take.

---

## T6 — dialog surfaces

### `dialog-save-changes`

**Reason.** Open state lives on the file-state atom's `pendingAction`
slot. Production trigger: File → New (or Open / Recent) while the
in-memory document is dirty. Driving to a dirty state under the
MockBridge requires either:
- A real file-load + mutation round-trip (engine round-trip in
  Playwright, ~25 min to plumb), or
- Direct atom poke via `page.evaluate` after exposing
  `useFileStateStore` on `window` (small source change, plus a
  follow-up to make sure exposure is test-only).

Both exceed the 30-min cap once you account for verifying the prompt
renders the expected body copy. Defer to a "save-changes a11y" follow-
up once one of the two routes is committed.

**Re-introducing it.** Either expose the file-state store on `window`
behind a test-only flag and poke `setPendingAction(() => Promise.resolve())`
in the surface driver, or build a Playwright helper that loads a fixture
and applies one mutation through `window.bridge` before the surface
driver opens the prompt.

### `dialog-link-group-settings`

**Reason.** The context-menu item "Link Group Settings…" is `disabled`
unless the right-clicked row has `linkGroup > 0` (`isLinked`). The
default fixture (`tests/fixtures/a11y-base-state.alo`, assumed) does
not guarantee a link-group-bearing emitter, and the dialog also needs
both `targetEmitterId` AND `targetLinkGroupId` populated on the
tree-context store.

**Re-introducing it.** Add a small fixture variant
(`a11y-link-group.alo`) that ships at least one root emitter with
`linkGroup=1`, OR drive selection + atom directly after exposing
`useTreeContextStore` on `window`:
```ts
window.useTreeContextStore.getState().openDialog("link-group", 1, 1);
```

### `dialog-background-picker` / `dialog-ground-texture`

**Reason.** No longer Modal-based dialogs. NT-5 (the toolbar redesign)
replaced both with toolbar Radix Popover dropdowns
(`BackgroundDropdown`, `GroundDropdown`). They render as `[role=
"dialog"]` from Radix Popover's content but conceptually they're
popover surfaces, not dialogs. Capturing them belongs in T7 or a
dedicated popover surface list, not T6.

**Re-introducing it.** Add them to T7's POPOVER_SURFACES (or whatever
the next non-dialog surface bucket ends up being). Drivers click the
"Background:" / "Ground:" toolbar buttons; teardown clicks the trigger
again to close.

### `dialog-primitives-gallery`

**Reason.** Reached via `?demo=primitives`, which fully replaces
`AppShell` with `PrimitivesGallery` — it's a route, not an overlay.
Not a dialog surface; capturing it requires its own root-page
treatment (separate `goto`, separate baseline, no chrome to compare
against).

**Re-introducing it.** If gallery a11y is wanted at all, give it a
dedicated `DEMO_SURFACES` list in a future task, with its own
baseline pass that doesn't try to share chrome-state with the editor
surfaces.

### `dialog-spawner`

**Reason.** SpawnerPanel is the always-on rightmost column of the
PanelLayout grid (gated by `useSpawnerVisible()`, not by a dialog
open state). It is not rendered through `<Modal>` or `<ToolPanel
role="dialog">`; it's a `<aside data-testid="quadrant-spawner">`.

**Re-introducing it.** Capture as a quadrant / panel surface in
CHROME_SURFACES (or a panel-surfaces bucket), not as a dialog.
Driver focuses `[data-testid="quadrant-spawner"]`.
