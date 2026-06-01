# Fix two ground-control bugs in the new UI (GroundTexturePanel)

## 1. Goal + scope
Two user-reported bugs in the `--new-ui` ground controls:
- **Bug 1** — the solid-colour ground option doesn't raise a colour picker.
- **Bug 2** — there's no ground-height parameter to change.

**Root causes (verified, Phase-1 debugging):**
- Bug 1 is **not** a React logic bug — the Radix `ColorButton` picker opens
  fine in browser mode. It's a discoverability defect (the prominent wide
  "Solid colour" tile only *selects* the slot; the real picker is a small
  secondary swatch below) **and/or** an arch-C native occlusion of the Radix
  DOM popover (unverifiable by agent, L-033). `BackgroundPicker` avoids both by
  using a **native `<input type="color">`** (an OS dialog — always on top, no
  occlusion) triggered by its wide tile. User confirmed Background works natively.
- Bug 2: engine `SetGroundZ` + bridge `engine/set/ground-z` + dispatcher handler
  all exist; the legacy NT-2 (#45) control was **never ported** to React. No
  component reads/writes `groundZ`.

**In:** mirror Background's solid-colour pattern in `GroundTexturePanelBody`
(wide tile → native colour input; remove the secondary Radix `ColorButton`);
add a ground-height `Spinner` to the same panel (user chose "inside the Ground
dropdown").
**Out:** native visual verification (user-driven, L-033 — agent can't see arch-C);
auditing/occlusion-fixing other `ColorButton` usages (Lighting etc. — separate,
only if confirmed broken natively); ground-Z persistence (legacy is session-only —
match that).

## 2. What the codebase already gives us
- `BackgroundPicker.tsx:100-178` — the proven wide-tile→`colorInputRef.click()`→
  hidden `<input type="color">` pattern. Mirror it verbatim.
- `Spinner` primitive (`primitives/Spinner.tsx`) — `value/onChange/min/max/step/
  decimals/disabled/density/aria-label`; commit-on-blur, no bridge spam.
- `colorref` helpers — `hexToColorref(hex)`, `colorrefToHex(c)` (Background uses
  the same for encoding; COLORREF channel order proven correct).
- Bridge handlers already live: `engine/set/ground-solid-color` (BridgeDispatcher
  :1202), `engine/set/ground-z` (:1184); mock handles both (mock.ts:215,223).
- Legacy ground-Z spinner spec (main.cpp:2157-2165): float, **−100…100, step 0.1**,
  default 0, **enabled only when ground shown** (lockstep with the toggle).

## 3. Approach
Edit `web/apps/editor/src/screens/GroundTexturePanel.tsx` (`GroundTexturePanelBody`):
- Imports: drop `ColorButton` + `RgbColor` + the `hexToRgbColor/rgbColorToHex`
  helpers; add `useRef` + `Spinner`.
- Add `colorInputRef`, `groundZ = snapshot?.groundZ ?? 0`.
- `handleSolidColorChange(hex: string)` (was RgbColor) → `engine/set/ground-solid-color`
  with `hexToColorref(hex)`; `handleSolidColorClick()` selects slot + `.click()`s
  the input; `handleGroundZChange(z)` → `engine/set/ground-z`.
- JSX: wide tile `onClick={handleSolidColorClick}`; replace the `ColorButton` block
  with a hidden `<input type="color" ref={colorInputRef} value={solidHex} …>`; add
  a "Height" `Spinner` row (−100..100, step 0.1, dp 1, `disabled={!groundOn}`) under
  the Show-ground toggle.
- Update `GroundTexturePanel.test.tsx`: height field → `engine/set/ground-z`;
  solid-colour input change → `engine/set/ground-solid-color`; tile click selects
  slot 4.

## 4. Risks + mitigations
1. **Losing the rich palette picker (basic/custom/hex/sliders).** Replacing the
   Radix `ColorButton` with the native OS picker is a feature downgrade. *Mitigation:*
   accepted — it matches Background (consistency), is the only mechanism *proven* to
   work in the native host, and fixes the bug under both hypotheses. Flagged for the
   user to veto on review.
2. **Native occlusion unconfirmed.** If the Radix popover *did* work natively, this
   is "merely" a consistency/discoverability change. *Mitigation:* native input is
   strictly safer regardless; no downside to converging.
3. **jsdom can't open a real OS picker.** *Mitigation:* test the observable contract
   (onChange → bridge dispatch, slot-select on tile click), not the OS dialog.

## 5. Testing & verification
- **vitest:** new specs (height→ground-z, solid input change→ground-solid-color,
  tile click→ground-texture slot 4); full `editor` suite stays green (was 384).
- **Browser repro (preview):** click wide "Solid colour" tile → native picker
  fires (input present + click wired); Height spinner change → `engine/set/ground-z`
  in the bridge log; Height disabled when ground off.
- **Build:** `pnpm --filter @particle-editor/editor build` clean.
- **Native (user-driven, L-033):** in `--new-ui`, click the Ground "Solid colour"
  tile → OS colour dialog appears; adjust Height → ground plane moves. Deferred to
  the user; agent can't see arch-C.

---

## Review (2026-06-01, session 8)

**Both bugs fixed in one file** (`web/apps/editor/src/screens/GroundTexturePanel.tsx`),
consistent with the goal.

- **Bug 1 (solid-colour picker).** Replaced the split "wide tile selects / small Radix
  swatch picks" with Background's pattern: the wide "Solid colour" tile now selects
  slot 4 **and** triggers a hidden native `<input type="color">`. Removed the Radix
  `ColorButton` + its `RgbColor`/hex helpers. Fixes the bug under both live hypotheses
  (discoverability **and** arch-C occlusion of a DOM popover) by using the OS dialog.
- **Bug 2 (ground height).** Added a "Height" `Spinner` (−100…100, step 0.1, dp 1) under
  the Show-ground toggle, `disabled` in lockstep with it (legacy `main.cpp:1662`
  parity), wired to the pre-existing `engine/set/ground-z`. Session-only (matches legacy).

**Verification.**
- vitest: **386 passed** (44 files; +2 new ground specs; `GroundDropdown.test.tsx`
  still green). Build (`tsc -b && vite build`): **clean**.
- Browser (preview, mock bridge): Height `0.0→0.1` on increment (round-trips via
  `engine/set/ground-z` + mock broadcast); Height **disables** when ground hidden;
  clicking the wide "Solid colour" tile fires the native colour input **and** selects
  slot 4; no render/console errors.
- **Deferred to user (L-033):** in `--new-ui`, confirm the OS colour dialog actually
  paints over the arch-C viewport and the ground plane visibly moves with Height.

**Decision flagged:** dropped the rich Radix palette picker (basic/custom/hex/sliders)
for the native OS picker — accepted for consistency with Background + proven native
visibility. Veto-able on review.

**Process notes →** new lesson **L-041** (browser-mode repro sidesteps L-033;
native-input vs Radix popover over the arch-C viewport; `preview_click` pointer-event
gotcha). Root-caused via the systematic-debugging skill (4 phases; the browser repro
*refuted* the nested-popover-logic hypothesis before any code changed).
