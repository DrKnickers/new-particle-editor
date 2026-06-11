# Curve lock — airtight read-only for mirrored channels (design)

*2026-06-10 · designed with the user via brainstorming. Part A of a
two-part curve-editor effort; Part B (sample-and-tween curve morph
animation) ships as a separate later PR and gets its own spec. This
spec is the bug fix, shipped first as a small standalone PR.*

## Purpose

When Green and/or Blue are **locked to** an earlier channel (Red), the
intended behaviour is a **live one-way mirror**: the follower displays
the master's curve, follows the master's edits, and can never push an
edit back up to the master or its siblings. Today it doesn't hold —
**a follower curve is still draggable**, and because "lock" is
implemented as a pointer alias to the master's single storage buffer,
dragging a key on a locked Green curve mutates Red's buffer and the
whole RGB trio moves together. That is the bug the user reported
(observed in the new WebView2/React UI).

Root cause: the lock makes the read-only state *half-enforced*. The
panel disables the toolbar's interpolation / Delete / Paste affordances
when the focus channel is locked
([`focusLocked`](src/components/CurveEditorPanel.tsx:1076)), but it
still wires the **key-drag handlers** and **insert-add handler** to the
renderer unconditionally
([`CurveEditorPanel.tsx:1503-1523`](src/components/CurveEditorPanel.tsx:1503)),
and the **Select / Insert tool toggle**
([`CurveEditorPanel.tsx:1200-1226`](src/components/CurveEditorPanel.tsx:1200))
has no locked-disable. So the user can grab a key on the locked curve
and drag it, or switch to Insert mode and click-add — both commit
`emitters/set-track-key` / `emitters/add-track-key` against the
aliased master buffer.

Fix in one sentence: **make a locked focus channel genuinely
non-interactive in the renderer, and add a clear read-only cue suited
to the multi-curve display.** Once no follower edit path exists, the
existing pointer alias *is* a correct one-way mirror — only the master
is ever editable, so the master drives the followers and nothing leaks
upward.

## Decisions (user-approved)

| Question | Decision |
|---|---|
| Lock semantics | **Live one-way mirror.** Follower shows + follows the master; follower is read-only; follower can never mutate the master. |
| Data model | **Keep the pointer alias** (`tracks[i] == &trackContents[j]`). No separate per-follower buffer — once read-only is airtight the alias yields the mirror for free, with no master→follower re-sync duty and no save/load reconciliation risk. |
| Read-only cue | Legacy greys the whole page; the multi-curve overlay can't (colour = channel identity, and opacity is already the dim-the-unfocused signal). Instead: the locked focus curve renders as a **dashed line in the follower's OWN colour** (green stays green) at the emphasized stroke width + full opacity, with **hollow (outline-only) key markers**. The Select/Insert toggle disables, and a small **lock glyph** beside the Lock-to dropdown carries the worded explanation as an NT-12 `Tip` (replaces the earlier verbose pill — the dropdown already shows "Lock to: Red"). A **hover tooltip on the curve itself** is an optional bonus, not the primary cue. |
| Dash colour rationale | The follower aliases the master's buffer, so a locked Green renders the **same points** as Red — the two curves are coincident. Colouring the dash green (not red) preserves "which channel is the mirror" and avoids a redundant red-on-red line; the green dashes over the dimmed solid red read as the lock relationship. Dash array `7 5` (recommended), feel-tunable. |
| Scope | New React UI only — panel **and** a small renderer branch in `MultiChannelCurves` (the dashed/hollow treatment). No bridge command, no schema change, **no native/C++ change**: legacy Win32 `TrackEditor` already greys the page correctly (`control->editable = (sel == 0)` + toolbar disable at [`TrackEditor.cpp:184-193`](src/UI/TrackEditor.cpp:184)). |

## §1 What the codebase already gives us

- **`focusLocked`** ([`CurveEditorPanel.tsx:1076`](src/components/CurveEditorPanel.tsx:1076))
  — `focusedTrack !== null && focusedTrack.lockedTo !== null`. Already
  the single source of truth for "the focused channel is a read-only
  mirror"; already gates `interpDisabled`, `deleteDisabled`, and
  `handlePasteKeys`. We extend its reach, we don't add a new flag.
- **`lockedTo` on the TrackDto** — derived host-side by pointer identity
  ([`BridgeDispatcher.cpp:2753-2790`](src/host/BridgeDispatcher.cpp:2753)),
  capitalised for display in `lockToValue`
  ([`CurveEditorPanel.tsx:1042`](src/components/CurveEditorPanel.tsx:1042)).
  Gives us the master's name for the indicator copy for free.
- **The renderer's focus-mode interactivity is handler-driven, not
  flag-driven.** `MultiChannelCurves` emphasizes the `focusChannel`
  curve (thick stroke, full opacity) purely from `focusChannel` being
  set; the *interactive* behaviour (drag, click-select, insert) comes
  from the handler props the panel passes. So withholding the handlers
  makes the curve read-only **while keeping it emphasized** — exactly
  the cue we want — with no renderer change to the emphasis path.
- **The lock dropdown already paints a locked state** — `data-locked`
  drives an accent border/text on the trigger
  ([`CurveEditorPanel.tsx:1280-1281`](src/components/CurveEditorPanel.tsx:1280)).
  The new indicator complements this; we don't duplicate it.
- **`handleLockToChange` already clears selection on lock**
  ([`CurveEditorPanel.tsx:1066-1069`](src/components/CurveEditorPanel.tsx:1066)),
  so there's no stale-selection edge to design around at the lock
  transition.

## §2 Implementation approach

Most changes are in `CurveEditorPanel.tsx` (panel→renderer boundary);
one small render branch is added to `MultiChannelCurves` in
`CurveEditor.tsx` for the dashed/hollow locked-curve treatment.

1. **Gate the mutation handlers on `focusLocked`.** At the
   `<CurveEditor>` render
   ([`CurveEditorPanel.tsx:1493-1525`](src/components/CurveEditorPanel.tsx:1493)),
   when `focusLocked`:
   - `insertMode={false}` (never enter insert on a locked curve);
   - omit `onCanvasAdd`, `onKeyDragStart`, `onKeyDragMove`,
     `onKeyDragEnd`, `onGroupDragEnd` (pass `undefined`) so the
     renderer's drag machinery has nothing to commit;
   - omit `onKeyClick` (selection is meaningless on a read-only mirror;
     this also drops the `pointer` cursor on the markers, which is the
     non-interactive visual cue at the marker level);
   - keep `onCanvasClick` / `onCanvasContextMenu` (harmless; preserves
     "right-click clears" and click-on-empty semantics).

   The clean way to express this is a single derived
   `interactiveHandlers` object spread into the element, `{}` when
   `focusLocked`. Avoids five inline `focusLocked ? undefined : fn`
   ternaries.

2. **Force `mode` to `select` on lock and disable the toggle.** Add a
   `disabled={focusLocked}` to the Select **and** Insert tool buttons
   ([`CurveEditorPanel.tsx:1200-1226`](src/components/CurveEditorPanel.tsx:1200))
   with the existing `disabled:opacity-40 disabled:cursor-not-allowed`
   treatment, and an effect (or fold into the lock dispatch /
   focus-change) that sets `mode` back to `"select"` whenever
   `focusLocked` becomes true — so a curve locked while Insert is
   active can't leave a live crosshair on a read-only canvas.

3. **Read-only indicator (toolbar).** When `focusLocked`, render a
   compact **lock glyph** (Tabler `ti-lock`-equivalent / the icon set
   already in use) beside the Lock-to dropdown, accent-toned, wrapped in
   an NT-12 `Tip`: "Green is locked to Red and shows Red's curve. Unlock
   to edit." No verbose pill — the dropdown already reads "Lock to: Red",
   so the glyph + tooltip is the minimal always-on, keyboard-reachable
   worded cue (a `Tip` on a disabled-looking glyph rides an
   `inline-block`/`span` shim per the NT-12 disabled-trigger pattern).

4. **Locked-curve render treatment (`MultiChannelCurves`).** Thread a
   `focusReadOnly` boolean (true when the focus channel's track is
   locked) into the renderer. When set, the focus layer draws:
   - the curve `<path>`/`<polyline>` with `stroke-dasharray` (`7 5`
     default, feel-tunable) in the channel's **own** colour at the
     emphasized stroke width + full opacity — NOT greyed, NOT faded;
   - key markers as **hollow rings** (`fill="none"`, channel-colour
     stroke) instead of filled grabbable dots, and without the
     `cursor: pointer` (which is already gone once `onKeyClick` is
     withheld).
   The non-focus dimmed layers are unchanged. This is the only renderer
   change; the emphasis/dim machinery and projection are untouched.

A hover tooltip on the curve itself was considered and **cut** (user
call) — see §5. The dashed line + toolbar lock glyph are the read-only
cue.

No new bridge command, no schema change, no native change.

## §3 Risks + mitigations

1. **A non-handler edit path slips through.** The fix enumerates the
   known mutation entry points (drag, group-drag, insert-add). If some
   *other* path can mutate a locked track (a future feature, an
   accelerator), the leak reopens. *Mitigation:* the test matrix (§4)
   asserts the bridge receives **zero** `set-track-key` /
   `add-track-key` for the locked channel across drag, insert-click,
   and group-drag; a defense-in-depth guard in `handleKeyDragEnd` /
   `handleCanvasAdd` (early-return when `focusLocked`) backstops the
   handler-omission so the commit is blocked even if a handler is
   wired by mistake. Cheap, and it makes the read-only contract local
   to the commit site, not only the render site.
2. **Locking a channel mid-drag.** A lock can't be dispatched while a
   pointer drag is in flight (the lock dropdown isn't reachable
   mid-drag), so there's no live-drag-then-lock race. *Accepted —* not
   worth designing around.
3. **Insert mode left active across a focus switch onto a locked
   channel.** Switching focus to an already-locked channel while in
   Insert mode would otherwise leave a crosshair on a read-only canvas.
   *Mitigation:* the `mode → select` reset keys off `focusLocked`
   (channel-change-driven), not only the lock-dispatch, so any path
   into "focused + locked" lands in Select.
4. **Indicator copy drifts from the dropdown.** The glyph tooltip names
   "Red"; the dropdown says "Lock to: Red". *Mitigation:* both derive
   from the same `lockToValue` memo — single source, no drift.
5. **Two followers locked to the same master overlap.** Green and Blue
   both locked to Red render coincident dashes. *Mitigation:* only the
   focus channel is emphasized at a time (the others dim), so the user
   inspects one mirror at a time over the dimmed master — no two bright
   dashed lines compete. Accepted.

## §4 Testing & verification

Vitest (`CurveEditorPanel.test.tsx` / `CurveEditor.test.tsx`), with a
locked focus channel (`focusedTrack.lockedTo = "red"`):

- **Read-only enforcement (the regression):**
  - Pointer-drag a marker on the locked focus curve → bridge sees **no**
    `emitters/set-track-key` for that channel; the trio is unchanged.
  - Insert toggle is **disabled** while locked; programmatically forcing
    Insert + canvas-click commits **no** `emitters/add-track-key`.
  - Group-drag of a multi-selection on a locked curve commits nothing.
  - Defense-in-depth: `handleKeyDragEnd` / `handleCanvasAdd` early-return
    under `focusLocked` (unit-level).
- **Mirror still works (no regression):** editing the **master** (Red)
  still updates the followers' rendered curves (alias unchanged) — a
  `set-track-key` on Red, refetch, assert Green/Blue render Red's keys.
- **Mode reset:** locking the focus channel while `mode === "insert"`
  flips `mode` to `"select"`; `data-state` on the Insert button reflects
  it.
- **Indicator + render treatment:** the lock glyph renders only when
  `focusLocked`, its tooltip copy matches `lockToValue`, and it's gone
  after unlock. The focus curve carries `stroke-dasharray` and hollow
  (`fill="none"`) markers only when `focusReadOnly`; an unlocked focus
  curve is solid with filled markers. (Assert via the rendered
  `stroke-dasharray` attr + marker `fill`.)
- **Unlock round-trip:** unlock restores interactivity (drag commits a
  `set-track-key` again; Insert re-enables).

Suites & gates: web full run (700 + new), `tsc -b` 0, vite build clean;
native harness 180/0 (no native change — confirm no a11y golden drift,
or regenerate from the full suite per L-081 if the toolbar DOM shifts);
host Debug x64 build.

User feel pass (L-033 — user-launched): in the real host, lock
Green→Red and Blue→Red, confirm the locked curves can't be dragged or
inserted-into, the read-only pill reads clearly, editing Red still
carries Green/Blue, and unlocking restores editing. Both themes for the
pill styling.

## §5 Out of scope (deferred to Part B / elsewhere)

- **Curve morph animation** (sample-and-tween across add/delete/mirror/
  interp-change + key pop) — separate later PR, own spec.
- **Separate per-follower storage buffer** — explicitly rejected above;
  revisit only if a hard leak-back guarantee is wanted beyond read-only
  enforcement.
- **Hover tooltip on the curve line itself** — cut (user call). A
  hover-only cue can't announce read-only before an edit attempt, and
  the thin `pointerEvents="none"` stroke would need a fat hit-area +
  pointer-events handling that competes with the backdrop's
  marquee/click. The dashed line + toolbar lock glyph cover the cue.
- **Legacy Win32 `TrackEditor` changes** — already correct; untouched.
