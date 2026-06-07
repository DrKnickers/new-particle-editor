# MNU-12 — Import Emitters dialog "Clear" button

## Goal + scope
Add the legacy **"Clear"** button to the new-UI Import Emitters dialog so it
reaches the legacy dialog's footer parity. Legacy ships **two** selection
buttons ("Select &all" + "&Clear", `ParticleEditor.en.rc:295-296`); the new UI
has only "Select All" (`ImportEmittersDialog.tsx:240-248`). "Clear" deselects
every emitter in one click (the inverse of Select All).

**In:**
- A "Clear" button in the dialog footer, placed immediately right of
  "Select All" (legacy order: Select All at x=170, Clear at x=226).
- `handleClear = () => setPicks(new Set())` — deselect all (legacy
  `IDC_IMPORT_CLEAR` → `SetCheckRecursive(..., FALSE)`, `main.cpp:7326`).
- Re-baseline the one a11y golden the dialog feeds (composition mode).

**Out:**
- Win32 `&` mnemonics (the new UI's "Select All" already drops them — keep
  consistent; no `Alt+C`).
- Tri-state / "select children only" behaviours (not in legacy).
- Paste-As-Child (SEL-5/MNU-4) — separate native-lane item, not this.

**One deliberate divergence (flagged for OK):** legacy's Clear is *always*
enabled; I propose disabling it when `picks.size === 0` (nothing to clear),
mirroring how the new UI already disables "Select All" on an empty tree and
"Import" on an empty selection. Harmless, better affordance, reversible.

## What the codebase already gives us
- `ImportEmittersDialog.tsx:51` `picks: Set<number>` state + `setPicks`.
- `:132` `handleSelectAll = () => setPicks(new Set(allIds))` — exact mirror site.
- `:240-248` the "Select All" footer button (styling to copy verbatim).
- `:252` "Import" button already `disabled={picks.size === 0}` — the disable
  predicate to reuse.
- `Modal.Footer` = `flex justify-end gap-2` (`Modal.tsx:292`); "Select All" uses
  `mr-auto` to pin left. Moving `mr-auto` to the new (rightmost-of-the-pair)
  Clear button keeps both grouped at the far left with `gap-2` between them.
- Test patterns: `ImportEmittersDialog.test.tsx` (RTL + stub bridge).
- Native a11y lane: `pnpm a11y:update` after `pnpm build` (L-068); lane needs
  restore in this fresh worktree (L-039 NuGet copy + L-046 MSBuild Debug x64 +
  L-040 dist build).

## Implementation approach
1. Add `const handleClear = () => setPicks(new Set());` next to `handleSelectAll`.
2. Footer: remove `mr-auto` from "Select All"; add a "Clear" button right after
   it carrying `mr-auto`, same button classes, `aria-label="Clear selection"`,
   `disabled={picks.size === 0}`.

## Risks + mitigations
1. **Stale-dist false-green a11y (L-068).** The harness `--rebuild` won't pick
   up a source-only change. → `pnpm --filter @particle-editor/editor build` then
   `grep "Clear selection" dist/assets/*.js` (expect ≥1) BEFORE `a11y:update`.
2. **Native lane not restored (fresh worktree).** Golden re-baseline + 168/0
   need the host binary + dist. → L-039 NuGet copy, L-046 MSBuild Debug x64,
   L-040 dist build, in that order, before `a11y:update`/`test:native`.
3. **Golden fan-out.** Adding a footer button mutates the dialog's a11y subtree.
   Expect a *surgical* diff: the Import-Emitters dialog golden(s) only, one
   added `button "Clear selection"` node. Anything broader = investigate (L-053).
4. **Footer layout regression.** Moving `mr-auto` could mis-align the row. →
   live-verify in preview: `[Select All][Clear] …… [Cancel][Import]`.

## Testing & verification
- [ ] TDD: failing test — Clear deselects all (seed picks via Select All, click
      Clear, assert no checkboxes checked); Clear disabled when picks empty.
- [ ] `pnpm --filter @particle-editor/editor test` → 500 + N green; `tsc` 0.
- [ ] Live (preview, MockBridge): Browse→tree→Select All→Clear deselects;
      footer order correct; Clear disabled with empty selection.
- [ ] Native lane restored; `pnpm build` + grep confirms "Clear selection" in
      dist; `pnpm a11y:update` → surgical golden diff reviewed; `test:native`
      → 168/0.
- [ ] Docs: CHANGELOG entry; fix-plan + ui-delta-report MNU-12 → ✅ shipped;
      HANDOFF session 21.

## Review

**Shipped.** "Clear" button added to the Import Emitters dialog footer, right of
"Select All" (legacy `IDC_IMPORT_CLEAR` order). `handleClear = () => setPicks(new
Set())`; `disabled={picks.size === 0}` (user OK'd the disable-when-empty divergence
from legacy's always-enabled). `mr-auto` moved from Select All onto Clear to keep
the pair grouped at the footer's left.

**Verification (all green):**
- TDD: 2 new tests (Clear deselects all; Clear disabled-when-empty / enables on
  first tick). Watched them fail (no "Clear selection" button) → implemented →
  pass. Full web suite **502/0**; `tsc --noEmit` 0.
- Live preview (MockBridge): footer DOM order + pixel x-edges confirmed `Select
  All (117) │ Clear (204) … Cancel (588) │ Import (661)`; `mr-auto` resolves to
  319px on Clear; both selection buttons disabled on the empty (no-tree) state.
  Screenshot captured.
- Native lane restored in this fresh worktree (L-039 NuGet copy → `packages/`;
  L-046 MSBuild VS18 Debug x64 → `x64\Debug\ParticleEditor.exe`; L-040 `pnpm
  build` → `dist/`). L-068 guard: `grep "Clear selection" dist/assets/*.js` → 1.
- a11y golden: surgical single-file, single-line diff —
  `dialog-import-emitters.composition.golden.yaml` gains
  `button "Clear selection" [disabled]: Clear`. No spurious diff from the `mr-auto`
  move (YAML goldens don't capture className). Native harness **168/0**.

**Docs updated:** CHANGELOG (top entry, lt-4 TODO-hash), fix-plan (P3
golden-touching → ✅ DONE), ui-delta-report (MNU-12 off the open table, into
"Already shipped"), lessons (L-046 MSBuild-on-VS18 addendum).

**Not done / deferred:** commit + FF-push to `lt-4` pending user OK (outward-facing).
