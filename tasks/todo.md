# LT-4 Phase 4.1 FD10 — Group A legacy parity polish

## Goal & scope

Restore the legacy `EmitterList` panel-header toolbar (6 buttons) and
the 5-column status bar's cursor-coordinates column. Closes the most
visible muscle-memory gaps between new-UI and legacy. Per-row eye
toggle is NOT pursued — legacy doesn't have one either; the panel
toolbar's [👁] button operates on the selected emitter and that's the
parity target.

**In**
- EmitterTree panel-header toolbar with: `[New ▾] [Delete] [▲][▼]
  [👁] [Show All][Hide All]` matching the legacy ordering from
  [`src/UI/EmitterList.cpp:3016`](src/UI/EmitterList.cpp:3016).
- Bridge surface for visibility: `emitters/set-visible { id, visible }`
  and `emitters/set-all-visible { visible }` (host + mock + tests).
- StatusBar cursor-coords column. The host emits `cursor/position-3d`
  on viewport mouse-move, the React side renders the values in a new
  5th column.

**Out**
- Per-row eye-icon affordance (not legacy parity).
- Bulk-select panel toolbar variations.
- Re-doing the legacy's `IDR_NEW_EMITTER_MENU` exact submenu — Radix
  DropdownMenu is the right idiom in React.

## What the codebase gives us

- `emitters/add-root` / `emitters/add-lifetime-child` /
  `emitters/add-death-child` / `emitters/delete` /
  `emitters/move { direction: "up" | "down" }` — all exist in the
  schema and are tested.
- `useEmitterSelectionStore` — primary + multi-select state.
- `ParticleSystem::Emitter::visible` field exists; legacy
  `EmitterList_ToggleEmitterVisibility` /
  `EmitterList_SetAllEmitterVisibility` show the recursion pattern
  for "Show All/Hide All" (cascade through children).
- Legacy `GetCursorPos3D(engine, screenX, screenY, &outPos)` exists
  in `src/main.cpp` — same helper can be lifted into the host for
  the viewport popup's WndProc.
- `HostViewportWndProc` in `src/host/HostWindow.cpp` already handles
  the viewport popup's mouse events for camera drag — adding a
  WM_MOUSEMOVE → emit-event branch is a small extension.

## Tasks

- [ ] **T1.** EmitterTree panel-header toolbar with the 4 existing-
      bridge buttons: `[New ▾] [Delete] [▲][▼]`. Pure React.
      Disabled states match legacy: New ▾ Lifetime/Death gray when
      no primary; Delete gray when no primary; Move gray when not a
      root or no neighbour in the move direction.
- [ ] **T2.** Visibility bridge surface — schema + mock + C++ host
      + vitest contract specs:
      - `emitters/set-visible { id: number; visible: boolean }`
        — sets `Emitter::visible` for that emitter only (not its
        children). Matches legacy `ToggleEmitterVisibility` which
        flips the selected node only.
      - `emitters/set-all-visible { visible: boolean }` — recurses
        through the entire tree. Matches legacy
        `SetAllEmitterVisibility`.
      - Both emit `engine/state/changed` so the engine re-renders.
- [ ] **T3.** Panel-toolbar visibility buttons: `[👁] [Show All]
      [Hide All]`. The eye-icon button uses the selected emitter's
      current visible state to render Eye vs EyeOff and dispatches
      `emitters/set-visible` with the negated value.
- [ ] **T4.** Cursor-coords status bar column:
      - Add `cursor/position-3d { x: number; y: number; z: number }`
        event to the bridge schema.
      - Lift `GetCursorPos3D` from `main.cpp` to a host helper.
      - Hook `HostViewportWndProc`'s WM_MOUSEMOVE; throttle to
        ~30 Hz to avoid spamming React; emit the event.
      - React StatusBar: 5-column layout (currently 4); fifth column
        formats `(x, y, z)` to 1 decimal.
- [ ] **T5.** Verification gates: `pnpm build` + `pnpm test`
      (vitest) + MSBuild Debug x64 + `pnpm test:native`.
- [ ] **T6.** CHANGELOG entry for FD10. Single subsection capturing
      "panel toolbar restored + cursor coords + 2 new bridge
      requests."

## Risks named up front

1. **Move Up/Down on non-root emitters.** EmitterTree's existing
   context-menu Move Up/Down gates on `isRoot && …`. The bridge
   `emitters/move` likely accepts any emitter; legacy would too —
   reordering siblings within a parent's lifetime-children list.
   *Mitigation*: keep the same gate as the context menu for now;
   if the parity target needs sibling reordering at lifetime/death
   level, that's a separate follow-up.
2. **Cursor-coords event spam.** WM_MOUSEMOVE fires on every pixel
   of mouse motion (potentially hundreds of times per second). A
   raw bridge event would saturate the WebView2 message channel.
   *Mitigation*: throttle to ~30 Hz via QPC timing in the host;
   the user's eye can't read coordinates faster than that anyway.
3. **GetCursorPos3D wants the engine's camera + viewport.** The
   host already has both via `engine->GetCamera()` and the popup
   HWND's client rect. *Mitigation*: write the helper as a free
   function that takes `(engine, screenX, screenY)` and returns
   the world-space ground-plane intersection. Same shape as
   legacy.
4. **`emitters/set-all-visible` recursion.** The legacy walks the
   tree via TreeView APIs; the host has the live `ParticleSystem`
   model. *Mitigation*: simple recursion through
   `ParticleSystem::Emitter::lifetimeChildren / deathChildren`
   matches the legacy's intent.

## Testing & verification

- **Vitest target +6**: 4 new contract specs for the 2 new bridge
  kinds (request + state-changed event) and 2 specs for the panel
  toolbar's selection-driven disabled state.
- **Playwright target +1**: end-to-end "click [New ▾] → Root →
  emitter added" against the live host.
- **MSBuild Debug x64**: 0 errors, 0 warnings (the LIBCMTD
  preexisting warning stays).
- **Visual smoke**: launch editor, open the EMITTERS panel,
  exercise each toolbar button against a known-state file.

## Review

(filled in after execution)
