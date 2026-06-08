# UI polish batch — design spec

*2026-06-08 · branch `claude/ui-polish-batch` (off `master` @ `e902344`, new-UI-default trunk)*

Seven user-requested polish items on the now-default React UI, grouped by
subsystem/risk. Parity work is complete; this is open-ended refinement. The
overall arc the user named (visual consistency, motion, theming) frames the
work; this batch is the concrete starting set.

## Scope

**In:** the seven items below (Groups A–E). **Out:** unrelated refactors, the
broader visual/motion/theming sweeps (future batches), and — explicitly — the
**texture Browse dialog's** directory (item 6 only touches the `.alo`
Open/Import dialogs; the texture picker legitimately points at textures and
stays unchanged).

## Items, grouped

### Group A — trivial CSS (near-zero risk)

**(1) Physics tab padding — stale double-padding bug.**
The Physics `Tabs.Content` carries `p-3` ([EmitterPropertyTabs.tsx:302](../../../web/apps/editor/src/screens/EmitterPropertyTabs.tsx:302))
*and* `PhysicsTab` renders `<div className="inspector">` (its own padding),
so Physics double-pads vs Basic/Appearance (which rely on `.inspector`
alone). **Fix:** delete `p-3` from the Physics `Tabs.Content`; update the now-
stale comment at lines 274–278 (it claims Physics "keeps p-3 until B2 wires it
through .inspector" — already done).

**(4) Main toolbar vertical padding (breathing room above the viewport).**
*(User-clarified: the main toolbar above the preview viewport, `.toolbar` —
NOT the emitter-tree button row.)* A pressed/active toolbar button
(`.tb-btn[aria-pressed="true"]`, filled `accent-soft`) sits flush against the
viewport: `.toolbar` has only `padding: 1px 8px` ([components.css:121](../../../web/apps/editor/src/styles/components.css:121)),
leaving ~2px (1px pad + 1px border) between the colored button and the viewport
pixels. **Fix:** bump `.toolbar` vertical padding (start ~4px, tune visually).
Note: a taller toolbar shifts the arch-C viewport down via the layout's
reported rect — verify against the native harness + the user's eye, not just
vitest.

### Group B — curve editor

**(2) Time field clips 2nd decimal — + UI-wide cut-off audit.**
*Mechanism (audited):* the `Spinner` primitive is **container-width**
(`w-full`, [Spinner.tsx:343](../../../web/apps/editor/src/primitives/Spinner.tsx:343)),
reserving ~14px for the arrow column + the unit; a value clips only when its
column is too narrow. `100.00` needs ≈64px (text + arrows + left pad).
- *Primary fix:* widen the curve editor's **Time** and **Value** spinner cells
  in CurveEditorPanel.tsx so 2 decimals fit (exact width pinned in the plan;
  verify in the real viewport).
- *Audit conclusion (other clips):* the inspector is largely protected — the
  default `.form-row` spinner column is 58px ([components.css:570](../../../web/apps/editor/src/styles/components.css:570)),
  but Basic overrides to 73px (line 615) and wide fields use `widthBoost`
  (mid 73 / wide 87 / x2 116px, lines 707–709). The **unmitigated** risk is
  2-decimal values ≥ 3 integer digits (`100.00`, `-50.00`) in **Appearance/
  Physics** non-boosted spinners (Gravity, Inward accel/speed, Bounciness, Tail
  length, Weather distance/size at 100+). *Secondary fix (CONFIRMED in scope):*
  unify the default `.form-row` spinner column from 58px to **73px** (matching
  Basic, [components.css:570](../../../web/apps/editor/src/styles/components.css:570))
  so the whole inspector is consistently safe in one rule; Basic's explicit 73px
  override (line 615) then becomes redundant and can be dropped. The
  `sim-speed-stepper`
  (56px, overflow:hidden) stays ≤ `4.00×` → low risk, no change. Label ellipsis
  (with `title` tooltips) is intentional and excluded.

**(3) Curve keys: drop shadow instead of black outline.**
Key circles currently render with a stroke/ring for contrast
([CurveEditor.tsx](../../../web/apps/editor/src/screens/CurveEditor.tsx) —
`BORDER_STROKE`, the selected/border key styling ~lines 35–39, 216). **Fix:**
replace the black stroke/outline on the key circles with a subtle SVG
`drop-shadow` filter (`feDropShadow`, e.g. dy≈1, blur≈1.5, ~50% black). Keep
the accent fill for selected/border keys (the shadow replaces the *outline*,
not the selection color). Tune the exact filter against the real viewport
(L-033) and capture before/after.

### Group C — emitter-list density

**(7) Increase information density.**
Rows use `py-1` + `text-sm` ([EmitterTree.tsx:597](../../../web/apps/editor/src/screens/EmitterTree.tsx:597)).
**Coupling:** `ROW_HEIGHT_PX = 24` ([EmitterTree.tsx:883](../../../web/apps/editor/src/screens/EmitterTree.tsx:883))
feeds the absolute link-group bracket-gutter math — it MUST move with the row
height or the brackets misalign. **Fix (first try, user-approved):** `py-1 →
py-0.5` (~24px → ~20px), keep `text-sm`; set `ROW_HEIGHT_PX = 20`. If 20px feels
too tight, fall back to font (`text-sm → text-xs`). Tune visually. Expect the
emitter-tree a11y golden to re-baseline (regenerate + diff to confirm only the
row metrics changed).

### Group D — settings menu (the real feature)

**(5) Replace the always-visible theme toggle with a Preferences menu.**
- *Entry point:* add **`Preferences…`** to the **Edit** menu (bottom, after a
  separator) in MenuBar.tsx — Windows convention.
- *Form:* a new **`PreferencesDialog`** screen reusing `Modal` (like
  AboutDialog), opened from the menu item.
- *Contents (v1):* **Theme** only, upgraded to a **3-way: Dark / Light /
  System** (segmented control). `System` follows `prefers-color-scheme` live
  (re-applies on OS change while in System mode).
- *Theme logic:* extract from ThemeToggle into a small shared hook/store
  (`useTheme` or `lib/theme.ts`): state is `"dark" | "light" | "system"`,
  persisted in `alo:theme`; `system` resolves via `matchMedia` and subscribes
  to changes. Update the early bootstrap in [App.tsx:79](../../../web/apps/editor/src/App.tsx:79)
  to handle the 3-way (avoid first-paint flash). **Remove `ThemeToggle` from
  the toolbar** (Toolbar.tsx); delete the component or fold it into the dialog.
- *Tests:* new `PreferencesDialog.test.tsx` (renders, 3-way switch dispatches +
  persists, System follows matchMedia); update/replace `ThemeToggle.test.tsx`
  and `Toolbar.test.tsx` (toggle no longer in the toolbar). The native a11y
  harness will re-baseline (toolbar loses the toggle; a new dialog golden may
  be added).

### Group E — host change (C++)

**(6) Open / Import default directory → selected mod's Models folder.**
*Grounded facts:* `ModManager::GetSelectedModPath()` exists
([ModManager.h:102](../../../src/ModManager.h:102)) and is reached via
`info->modManager->GetSelectedModPath()` (main.cpp:2567, 6941). The `.alo`
dialogs use `OPENFILENAME` / `GetOpenFileName` (main.cpp:1425, 1459, …);
Import has its own picker (`DoImportEmittersFromFile`, main.cpp:7134+). The
texture Browse dialog is a **separate** call site (`textures/browse`) — **not
touched**.
- *Fix:* at the new-UI **Open** and **Import Emitters** file-dialog call sites,
  set `ofn.lpstrInitialDir` to `<GetSelectedModPath()>` + the models subpath.
- *Open questions to pin in the plan (verify, don't assume):*
  1. The exact new-UI Open/Import file-dialog call sites (which bridge `kind`
     the React `handleOpen` / Import fires, and where the host shows the dialog —
     a dedicated host handler vs. reusing the legacy `LoadFile`). Confirm
     `info->modManager` is in scope there.
  2. The exact models subpath relative to a mod root (analogous to
     `"Data\\Art\\Textures\\"` / `"Data\\Art\\Shaders\\"` — likely
     `"Data\\Art\\Models\\"`; confirm against FileManager resolution).
- *Fallback chain:* selected-mod Models folder → (if no mod / folder missing)
  last-used dir → current default. Don't error if the folder is absent.

## Sequencing

A → B → C → D (all web; vitest + native a11y harness) → E (native/C++; needs
the host build + the user's eye on the real dialog, L-033). Each group is
independently shippable; we can land A–D as web commits and E separately.

## Risks + mitigations

1. **Density ↔ bracket math (item 7).** Changing row height without
   `ROW_HEIGHT_PX` misaligns the link-group gutter. *Mitigation:* change both in
   the same commit; visually verify a multi-link-group tree.
2. **Theme bootstrap flash (item 5).** A 3-way that mishandles `system` at first
   paint flashes the wrong theme. *Mitigation:* update the App.tsx:79 bootstrap
   in lockstep; test all three modes + an OS-change while in System.
3. **a11y golden churn (items 5, 7).** Toolbar loses the toggle; tree row
   metrics change. *Mitigation:* regenerate via `a11y:update --grep` and diff
   the blast radius (only the intended nodes change).
4. **Host scope unknowns (item 6).** The new-UI Open/Import call site + models
   subpath are not yet pinned. *Mitigation:* the plan resolves them by reading
   the actual handlers before coding; fallback chain prevents breakage if the
   mod/folder is absent.
5. **Inspector column unify (item 2 secondary).** Bumping the default spinner
   column 58→73px narrows the label column slightly. *Mitigation:* verify label
   truncation doesn't worsen at min pane width; it's already ellipsis+tooltip.

## Testing & verification

- **Web:** `pnpm --filter @particle-editor/editor test` (vitest) green; `tsc -b`
  → 0. New PreferencesDialog tests; updated ThemeToggle/Toolbar tests.
- **Native a11y harness:** `pnpm --filter @particle-editor/editor test:native`
  → green after `pnpm build`; regenerate goldens for items 5 + 7 and diff.
- **Visual (L-033, user's eye):** curve key shadow (3), density (7), the
  Preferences dialog (5), and the real Open/Import dialog directory (6) —
  screenshot before/after from the running editor; the host dialog + arch-C
  visuals need the user to confirm.
- **Native build:** Debug x64 clean for the item-6 C++ change.
- **Per-item checklist** built in the implementation plan (writing-plans).
