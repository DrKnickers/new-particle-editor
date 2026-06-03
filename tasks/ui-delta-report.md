# UI Delta Report — Legacy native UI vs. New React UI

**AloParticleEditor (new-particle-editor) · branch `lt-4` @ `a1e8120` · 2026-06-03**

A complete, source-grounded map of where the new React UI (`web/apps/editor/src/`)
diverges from the legacy Win32 UI it replaces (`src/`, esp. `src/UI/*` + `main.cpp`).
**Report only — nothing has been changed.** Findings are flagged for discussion
before any implementation.

---

## How to read this

Each finding has an ID (`SEL-`, `SPN-`, `PRM-`, `LNK-`, `PAL-`, `CRV-`, `MNU-`,
`VPT-`), a **severity**, a **confidence**, and a **verification tag**:

| Tag | Meaning |
|---|---|
| 🟣 **TRIPLE** | Confirmed across all three layers (legacy C++ + host bridge + new TSX). Highest certainty. |
| 🔴 **LIVE** | I drove the running new UI in the browser preview and observed the behavior. |
| 🟢 **SOURCE** | Read both sides' source (and the host where relevant); behavior is unambiguous in code. |
| ⚪ **USER** | Depends on legacy *feel*/pixels I can't derive from source — needs your eye (you daily-drive legacy; agent arch-C screenshots are untrustworthy, L-033). |

**Severity:** `CRITICAL` (data loss / file corruption / silent wrong values) ·
`HIGH` (workflow-breaking missing interaction) · `MED` (notable behavioral
divergence) · `LOW` (minor divergence) · `COSMETIC` · `EXTRA` (new-only capability,
listed for confirmation, not a regression).

**Verification method.** 8 parallel read-only source-extraction passes (one per
dimension group), then: live-driving the new UI in the dev preview (MockBridge,
L-041) for the headline interactions; three-layer source reads for the sharpest
bugs; and cross-agent reconciliation of contradictions. The legacy side is
source-authoritative for *logic*; legacy *feel/pixels* are routed to you as Open
Questions.

---

## Executive summary

The new UI is a **faithful subset** of the legacy editor with a deliberately
modernized shell (resizable docking, dark theme, multi-channel curve overlay). The
core parameter set is essentially complete and the spawn-volume editor, texture
palette, link-group model, and emitter inspector are all ported. The deltas cluster
into a few clear themes:

### Top findings (act on these first)

| # | ID | Severity | What | Verify |
|---|---|---|---|---|
| 1 | **PRM-4 / PRM-5** | 🟥 CRITICAL | **Rotation average & variance are displayed and written back WITHOUT the legacy `/360` and `/100` scaling.** Editing these in the new UI writes wrong values to `.alo`; the displayed number is meaningless (shows `0.25°` where legacy shows `90`). | 🟣 TRIPLE |
| 2 | **VPT-2** | 🟥 CRITICAL | **Undo/redo is inert in the new UI** — the host stack exists but no edit ever calls `Capture()`; `undo/perform` always returns `applied:false`. | 🟢 SOURCE |
| 3 | **VPT-3** | 🟧 HIGH | **No autosave / crash-recovery** anywhere in the new UI — legacy had 30 s + 5 min tiers + orphan recovery. | 🟢 SOURCE |
| 4 | **SEL-1** | 🟧 HIGH | **Marquee (rubber-band) emitter selection is entirely absent.** | 🔴 LIVE |
| 5 | **MNU-2** | 🟧 HIGH | **Most global keyboard accelerators are stubbed** — only Ctrl+Z / Ctrl+Shift+Z work. Ctrl+S, Ctrl+N/O, F5–F10, F7, Ctrl+Space, Ctrl+G/H/B, Ctrl+Home, Alt+Up/Down do nothing; menu shows the hints anyway. | 🟢 SOURCE |
| 6 | **MNU-1 / SEL-5** | 🟧 HIGH | **Edit-menu Cut/Copy/Paste/Delete are permanently disabled**, and the tree context menu has no Cut/Copy/Paste/Paste-As. Clipboard works only with the tree focused, via keyboard. | 🟢 SOURCE |
| 7 | **CRV-2** | 🟧 HIGH | **Curve-key Copy/Cut/Paste removed** (legacy had a registered clipboard format for cross-track key paste). | 🟢 SOURCE |
| 8 | **CRV-1** | 🟧 HIGH | **Multi-key group-drag on the curve canvas dropped** (group move is spinner-only now). | 🟢 SOURCE |
| 9 | **SPN-4** | 🟨 MED | **Spinner drag-modifier is inverted** vs the keyboard & wheel (drag Shift=fine, everything else Shift=coarse). The code comment even claims it matches the keyboard — it doesn't. Likely a bug. | 🟢 SOURCE |
| 10 | **SPN-5** | 🟨 MED | **Spinner up/down buttons lost hold-to-repeat** (no auto-ramp). | 🟢 SOURCE |

### Confirmed non-issues (do NOT re-investigate — verified parity / false alarms)

- **Spawn-volume editor is fully ported** (`GroupBody` = legacy `RandomParam` 1:1).
  An earlier pass mis-flagged it as unported; the scalar `primitives/RandomParam.tsx`
  it compared against is **gallery-only**, not in the live editor.
- **Parameter set is complete.** Every editable legacy panel parameter maps to the
  new UI. `weatherFadeoutDistance`, `nTriangles`, `groups[LIFETIME]` are absent in
  **both** UIs (parity — never editable). No legacy parameter is missing except via
  the scaling bug (PRM-4/5) and minor range clamps (PRM-6/10).
- **Camera controls are byte-identical** — both UIs route to the same C++
  `ViewportWndProc`; only the DOM→Win32 encoding layer differs (feel-check only).
- **`affectedByWind` / rotation-block regrouping**: final tab placement matches
  legacy (transient mid-development layouts, since corrected).

### Cross-cutting themes

1. **Keyboard/accelerator layer is mostly aspirational** (MNU-2, VPT-1, SEL-14) —
   menu shortcut hints are shown but unwired. This is the single largest functional gap.
2. **Clipboard is half-wired** — emitter Cut/Copy/Paste exists only as tree-focused
   keystrokes; curve-key clipboard and "Paste As child" are gone entirely.
3. **"Commit-as-you-go" lost its safety net** — color picker has no cancel/revert
   (PAL-3) and spinners no longer preview live as you type (SPN-9); combined with the
   inert undo (VPT-2) there's limited ability to back out an exploratory edit.
4. **Link-group is functionally present but visually & interactively reduced** —
   no `[L<n>]` text marker, no bracket click/hover, no "Dissolve", no join-conflict
   warning. The user explicitly called out link-group appearance.
5. **Deliberate modernization** (docking, multi-channel curves, dark theme,
   single-click texture apply) — real UX changes that need a yes/no, not bugs.

**Counts:** ~95 findings — 2 CRITICAL, 6 HIGH, ~20 MED, ~30 LOW/COSMETIC, ~20 EXTRA
(new-only), plus the parity/non-issue confirmations above.

---

## 1. Selection, marquee, tree, context menu  (`EmitterList.cpp` ↔ `EmitterTree.tsx` + `emitter-selection.ts`)

| ID | Sev | Verify | Delta |
|---|---|---|---|
| **SEL-1** | HIGH | 🔴 LIVE | **Marquee rubber-band selection absent.** Legacy: drag empty labels-area → sticky box-select, Ctrl-additive ([EmitterList.cpp:392-411,1644-1881](src/UI/EmitterList.cpp:392)). New: rows are `<button>`s, empty-space pointerdown does nothing ([EmitterTree.tsx:491,1140](web/apps/editor/src/screens/EmitterTree.tsx:491)). *Live-proven: dragging across the tree changed nothing, no marquee element in DOM.* |
| **SEL-5** | HIGH | 🟢 SOURCE | **Context-menu Cut/Copy/Paste + "Paste As ▸ Child" missing.** Legacy had all four + a Paste-As-lifetime/death submenu ([rc:638-648](src/ParticleEditor.en.rc:638)). New menu has no clipboard items; clipboard is keyboard-only and "paste as child" has no equivalent ([EmitterTree.tsx:651-718](web/apps/editor/src/screens/EmitterTree.tsx:651)). See also MNU-4. |
| **SEL-17** | MED | 🟢 SOURCE | **Delete key is now a batch op** (deletes the whole multi-selection); legacy keyboard Delete removed only the primary ([EmitterTree.tsx:1336-1349](web/apps/editor/src/screens/EmitterTree.tsx:1336) vs [EmitterList.cpp:4324](src/UI/EmitterList.cpp:4324)). |
| **SEL-2** | MED | 🟢 SOURCE | **Ctrl-toggle can empty the selection** (primary→null clears the inspector); legacy guaranteed ≥1 member ([emitter-selection.ts:60-67](web/apps/editor/src/lib/emitter-selection.ts:60) vs [EmitterList.cpp:832-837](src/UI/EmitterList.cpp:832)). |
| **SEL-6** | LOW | 🟢 SOURCE | **No "New Root Emitter" in the row context menu** (toolbar-only); legacy had it ([rc:634](src/ParticleEditor.en.rc:634)). |
| **SEL-7** | LOW | ⚪ USER | **Duplicate-increment variants reduced** — legacy had Duplicate / Duplicate+increment / Duplicate+increment… (3); new has Duplicate + a standalone "Increment Index…" dialog. The one-click "+1 increment duplicate" has no equivalent. |
| **SEL-9** | LOW | 🟢 SOURCE | **"Toggle Visibility" command removed** from menu *and* toolbar; replaced by a per-row eye + Show All/Hide All ([EmitterTree.tsx:543-572](web/apps/editor/src/screens/EmitterTree.tsx:543)). |
| **SEL-12** | LOW | ⚪ USER | **Drag autoscroll near list edges missing** — long-list reorder past the viewport may need manual scroll. |
| **SEL-13** | LOW | ⚪ USER | **Esc / right-click no longer cancel an in-progress drag** (only pointercancel does). |
| **SEL-14** | LOW | 🟢 SOURCE | **Alt+Up / Alt+Down move accelerators absent** (legacy [rc:519-520](src/ParticleEditor.en.rc:519)). |
| **SEL-16 / SEL-18** | LOW | 🟢 SOURCE | **Tree is always fully expanded** (no collapse, no Left/Right expand keys); double-click a row now starts rename instead of toggling expansion. Deliberate (shallow tree). |
| **SEL-3 / SEL-4 / SEL-11 / SEL-15** | LOW | 🟢 SOURCE | Minor parity-ish divergences: survivor-primary rule on Ctrl-remove; right-click-empty-area "clear" gesture gone; drag-gap edge cases; arrow-nav collapses to single-select (matches legacy net). |
| **SEL-19 / SEL-20** | EXTRA | 🟢 SOURCE | New-only: toolbar **Duplicate** button; menu-bar-driven Rename plumbing. |
| **SEL-21** | — | ⚪ USER | Cut/paste *name-suffixing* + descending-delete ordering live host-side; not verifiable from these files. |

---

## 2. Spinners / numeric entry  (`Spinner.cpp` ↔ `Spinner.tsx`)

> **Reconciliation note:** the legacy 3-D spawn-volume "RandomParam" maps to the new
> **`GroupBody`** (covered in §3), NOT `primitives/RandomParam.tsx` (gallery-only).
> The earlier "RandomParam is a different control / spawn-volume unported" alarm is a
> **false positive** — spawn-volume parity is intact.

| ID | Sev | Verify | Delta |
|---|---|---|---|
| **SPN-4** | MED | 🟢 SOURCE | **Drag-modifier inverted & internally inconsistent.** Drag: Shift=fine(`step/10`), Ctrl=coarse(`step*10`) ([Spinner.tsx:212](web/apps/editor/src/primitives/Spinner.tsx:212)). Keyboard ([:129](web/apps/editor/src/primitives/Spinner.tsx:129)) & wheel ([:175](web/apps/editor/src/primitives/Spinner.tsx:175)) use Shift=coarse. The drag comment ([:192](web/apps/editor/src/primitives/Spinner.tsx:192)) claims it matches the keyboard — it's the opposite. Legacy drag ignored modifiers entirely. **Likely a bug.** |
| **SPN-5** | MED | 🟢 SOURCE | **Up/down buttons lost hold-to-repeat.** Legacy auto-repeated at the OS key-repeat cadence ([Spinner.cpp:438-455](src/UI/Spinner.cpp:438)); new is one-step-per-click ([Spinner.tsx:294-315](web/apps/editor/src/primitives/Spinner.tsx:294)). |
| **SPN-2** | MED | ⚪ USER | **Drag-scrub region shrank to the 14px arrow column.** Legacy scrubbed from anywhere on the spinner body incl. the number; new restricts scrub to the arrows so the text field supports selection ([Spinner.tsx:187-194](web/apps/editor/src/primitives/Spinner.tsx:187)). |
| **SPN-6** | MED | 🔴 LIVE | **Wheel granularity ignores `step` magnitude** — flat `0.1` (float) / `1` (whole) regardless of the field's actual step ([Spinner.tsx:174](web/apps/editor/src/primitives/Spinner.tsx:174)). Legacy wheel used the field's `Increment`. *Live: wheel handler fires `onChange`; granularity is the flat value.* Diverges from the new drag/keyboard, which DO honor `step`. |
| **SPN-9** | MED | ⚪ USER | **No live-as-you-type preview.** Legacy fired `SN_CHANGE` per keystroke (engine updated mid-type); new commits only on Enter/blur ([Spinner.tsx:100-115](web/apps/editor/src/primitives/Spinner.tsx:100)). Deliberate (avoids bridge spam) — confirm acceptable. |
| **SPN-7** | LOW | 🟢 SOURCE | **Wheel Ctrl=fine (`×0.1`) missing** (keyboard has it; wheel doesn't). |
| **SPN-11** | LOW | 🟢 SOURCE | **No read-only-but-visible state** — only fully-disabled (40% fade). Derived/force-aligned fields would look disabled, not "shown but locked". |
| **SPN-12** | LOW | 🟢 SOURCE | **No int/float type flag** — integer fields rely on the caller passing `decimals={0}`; a missed call site would render `5.00` / allow fractions. (Audit of live call sites: integer fields display correctly — *LIVE-confirmed `1`/`10`/`100` vs `0.00`/`4.00`*.) |
| **SPN-8 / SPN-10 / SPN-13** | LOW/EXTRA | 🟢 SOURCE | New-only/permissive: keyboard arrow modifiers added; free-text + scientific-notation entry; optional unbounded min/max. |
| **SPN-15 / SPN-16** | COSMETIC | 🔴 LIVE | 2dp display (decoupled from step) — *live-confirmed correct*; `ns-resize` vs `IDC_SIZENS` cursor (neither hides/warps). |

---

## 3. Parameter completeness  (`Emitter.cpp` + model ↔ `EmitterPropertyTabs.tsx`)

**Field-set parity is essentially complete** — every editable legacy panel parameter
is present in the new UI, and the host field table mirrors the legacy 50-field set.
The exceptions:

| ID | Sev | Verify | Delta |
|---|---|---|---|
| **PRM-4** | 🟥 CRITICAL | 🟣 TRIPLE | **Rotation average: missing `/360` ↔ `×360` scaling.** Legacy stores `randomRotationAverage = degrees/360`, displays `×360` as integer −180..180° ([Emitter.cpp:498,828](src/UI/Emitter.cpp:498)). Host serializes the value **raw** ([BridgeDispatcher.cpp:2653,2765](src/host/BridgeDispatcher.cpp:2653)). New UI binds it raw with unit "°", step 0.1, no clamp ([EmitterPropertyTabs.tsx:1201-1208](web/apps/editor/src/screens/EmitterPropertyTabs.tsx:1201)). **Result: shows `0.25°` where legacy shows `90`; typing "90°" stores 32400° of effective rotation → corrupts the `.alo`.** |
| **PRM-5** | 🟥 CRITICAL | 🟣 TRIPLE | **Rotation variance: missing `/100` ↔ `×100` scaling** — identical class to PRM-4. Legacy 0–100% ↔ stored `×0.01` ([Emitter.cpp:499,829](src/UI/Emitter.cpp:499)); new binds raw with unit "± °" ([EmitterPropertyTabs.tsx:1209-1216](web/apps/editor/src/screens/EmitterPropertyTabs.tsx:1209)). |
| **PRM-6** | LOW | 🟢 SOURCE | **Bounciness clamped to `[0,1]` step 0.05**; legacy allowed any float. A legacy file with out-of-range bounciness can't be reproduced. |
| **PRM-10** | LOW | 🟢 SOURCE | **`min=0` added to weatherCubeDistance / weatherCubeSize / tailSize**; legacy allowed negatives (nonsensical but technically a round-trip clamp). |
| **PRM-3** | COSMETIC | 🟢 SOURCE | RGBA labels shortened `Red/Green/Blue/Alpha` → `R/G/B/A` (aria-labels preserved; same fields, %, range). |
| **PRM-1/2/7/8/9** | — | 🟢 SOURCE | **Non-deltas / parity:** affectedByWind & rotation-block tab placement match legacy final state; `weatherFadeoutDistance`, `nTriangles`, `groups[LIFETIME]` are absent in **both** UIs (round-tripped on the wire, never editable). |

> **Animation tracks** (color/scale/index/rotation-speed curves) + the Lifetime
> random-param group are edited via the **Curve editor** (§6), not the property panel
> — present in both UIs. Not a gap.

---

## 4. Link groups  (`LinkGroup.cpp` + tree ↔ `LinkGroup*Dialog.tsx` + `link-group-colors.ts`)

Model and field set are byte-identical to legacy (host `kLinkFieldTable` mirrors
`kLinkSettingsFields`). The deltas are visual + interactive:

| ID | Sev | Verify | Delta |
|---|---|---|---|
| **LNK-8 / MNU-5** | MED | 🟢 SOURCE | **No "Dissolve link group" action** — the new menu can't ungroup a 3+ member group in one step (only per-member Leave, which auto-dissolves only at size 2). Legacy had explicit Dissolve + named "Link with…" quick-pick + rich labels ([EmitterList.cpp:3446-3718](src/UI/EmitterList.cpp:3446) vs [EmitterTree.tsx:698-718](web/apps/editor/src/screens/EmitterTree.tsx:698)). |
| **LNK-6** | MED | 🟢 SOURCE | **Bracket gutter is non-interactive** (`pointer-events-none`). Legacy: click a bracket = select the whole group (Ctrl=union); hover = tint members + thicken lane ([EmitterList.cpp:1522-1620,3168-3247](src/UI/EmitterList.cpp:1522)). |
| **LNK-1** | MED | ⚪ USER | **No `[L<n>]` group-id text prefix** on linked rows — legacy showed `[L3] Name` ([EmitterList.cpp:172-188](src/UI/EmitterList.cpp:172)); new shows raw names. Group id is now only in the gutter position + dialog titles. |
| **LNK-2** | MED | 🟢 SOURCE | **Promised per-row link dot not rendered** — the file header comment describes a `bg-accent` dot per linked row, but no element exists; `isLinked` only gates the Settings menu item ([EmitterTree.tsx:33-36,280,714](web/apps/editor/src/screens/EmitterTree.tsx:280)). Dead doc or dropped feature. |
| **LNK-10 / MNU-13** | MED | 🟢 SOURCE | **No join/field-disagreement confirmation.** Legacy listed differing fields before a join and on settings-OK warned before overwriting disagreeing members ([LinkGroup.cpp:267-371](src/LinkGroup.cpp:267); `IDD_LINK_GROUP_DISAGREEMENT`). New dialogs fire `set-membership`/`set-exempt-fields` directly — the host silently clobbers joiners to the canonical member. No React counterpart to the disagreement modal was found. |
| **LNK-3** | MED | ⚪ USER | **Different bracket palette** — 12 darkened hues for white bg (legacy) vs 8 bright Tailwind-400 hues for dark bg (new). A given group id maps to a different color across UIs. |
| **LNK-4 / LNK-5** | LOW | 🟢 SOURCE | Palette index math differs (`%12` 0-based vs `(group-1)%8`); lane allocation is one-lane-per-group (new) vs shared greedy packing (legacy) → wider gutter, but stable lanes. |
| **LNK-7** | LOW | 🟢 SOURCE | No High-Contrast bracket branch (legacy forced `COLOR_HIGHLIGHT`). |
| **LNK-9** | LOW | ⚪ USER | Gutter "hugs longest name" via runtime text-measurement at `+8px` (new) vs DPI label-rect `+12px` (legacy); fixed 24px row-height constant can misalign stubs if row height changes. |
| **LNK-11 / LNK-12** | EXTRA | 🟢 SOURCE | Settings dialog re-categorizes 8 legacy groups → 4 + "Other" bucket, adds collapsible sections, tri-state "share all", share-counts. Same 50 fields. |

---

## 5. Color & texture pickers  (`ColorButton.cpp` / `TexturePalette.cpp` ↔ counterparts)

> ColorButton (PAL-1…7) is used by the **Lighting panel** (light colors), not emitter
> appearance (which uses RGBA spinners + texture). The **live** texture palette is
> `TexturePalettePopover.tsx`; the standalone `TexturePalette.tsx` primitive (with its
> Browse/Clear context menu) is **gallery/test-only** (PAL-16/17) — not in production.

| ID | Sev | Verify | Delta |
|---|---|---|---|
| **PAL-2** | MED | 🟢 SOURCE | **Lost live-drag color preview.** Legacy hook fired `CBN_CHANGE` per R/G/B edit change (engine updated as you drag in the picker); new fires only on slider *release* ([ColorButton.cpp:22-55](src/UI/ColorButton.cpp:22) vs [ColorButton.tsx:102-111](web/apps/editor/src/primitives/ColorButton.tsx:102)). |
| **PAL-3** | MED | 🟢 SOURCE | **No Cancel/revert.** Legacy ChooseColor Cancel restored the original; new is commit-as-you-go with no rollback (combine with VPT-2 inert undo). |
| **PAL-9** | MED | 🟢 SOURCE | **Texture apply gesture changed** — legacy single-click=select, **double-click=commit+close**; new **single-click applies & closes** (no select-without-applying state) ([TexturePalette.cpp:700-739](src/UI/TexturePalette.cpp:700) vs [TexturePalettePopover.tsx:234-254](web/apps/editor/src/screens/TexturePalettePopover.tsx:234)). |
| **PAL-8** | MED | ⚪ USER | **Texture palette is a transient anchored popover**, not a movable/persisted tool window — loses the "park it and keep tweaking" workflow. |
| **PAL-1** | MED | 🟢 SOURCE | **Native ChooseColor → custom Radix popover** (no HSV wheel/luminance bar; has basic+custom grids, hex, R/G/B sliders). Deliberate, for CDP testability. |
| **PAL-4** | MED | 🟢 SOURCE | **Custom colors persist to localStorage, not registry** — native-shell persistence explicitly deferred ([palette-store.ts:2-3](web/apps/editor/src/primitives/palette-store.ts:2)); custom colors may not survive a native restart yet. |
| **PAL-14** | LOW | 🟢 SOURCE | **Broken vs missing thumbnail placeholders collapsed** — legacy drew magenta-X (broken) vs grey-X (missing); new shows one plain block for loading/missing/broken alike. |
| **PAL-11 / PAL-10** | LOW | 🟢 SOURCE | Hover feedback reduced (whole-cell tint+frame → border-color only); pin star now always-visible vs hover-revealed badge. |
| **PAL-5 / PAL-15 / PAL-13** | LOW/COSMETIC | 🟢 SOURCE | Custom-slot overflow "always clobber slot 15"; pins-full copy + no auto-clear timer; 128px vs 140px thumbnail decode. |
| **PAL-6 / PAL-7 / PAL-16** | EXTRA | 🟢 SOURCE | New-only: hardcoded 32-swatch "Basic colors" grid; right-click-clears-custom-slot; (gallery-only) palette context menu. |

---

## 6. Curve / track editor  (`CurveEditor.cpp` + `TrackEditor.cpp` ↔ `CurveEditor.tsx` + panel)

> The new panel always renders the **multi-channel overlay** (`MultiChannelCurves`);
> the single-track branch in `CurveEditor.tsx` is implemented but unreachable.

| ID | Sev | Verify | Delta |
|---|---|---|---|
| **CRV-1** | HIGH | 🟢 SOURCE | **Multi-key group-drag on the canvas dropped** — legacy dragged the whole selection together ([CurveEditor.cpp:655-664,927-978](src/UI/CurveEditor.cpp:927)); new drags a single key ([CurveEditor.tsx:1288-1328](web/apps/editor/src/screens/CurveEditor.tsx:1288)). Group *shift* survives only via the spinners. |
| **CRV-2** | HIGH | 🟢 SOURCE | **Key Copy/Cut/Paste removed entirely** — legacy had a registered clipboard format for cross-track key paste ([CurveEditor.cpp:414-470](src/UI/CurveEditor.cpp:414)); new keydown handles only Delete. |
| **CRV-4** | MED | ⚪ USER | **One-editor-per-track → single overlaid focus canvas** with visibility checkboxes + a focus channel. Deliberate redesign; biggest behavioral shift — confirm it's the intended model. |
| **CRV-7** | MED | 🟢 SOURCE | **Right-click no longer clears the selection** in Select mode (legacy deselect shortcut); new right-click opens a Delete menu / drops to Select mode. |
| **CRV-3** | LOW | 🟢 SOURCE | Interior-key time clamp differs — legacy clamps to global first/last & lets keys re-order past neighbors; new pins each key between immediate neighbors. |
| **CRV-8** | LOW | ⚪ USER | Time spinner is integer-grained (`step 1, decimals 0`); legacy used 0.1. Drag still yields fractional times. |
| **CRV-14 / CRV-15** | LOW/COSMETIC | 🟢 SOURCE | Vertical auto-scale math differs (stale "1.2× headroom" comment doesn't match code); step interpolation lost its dotted vertical-leg styling. |
| **CRV-5 / CRV-10 / CRV-11 / CRV-6** | EXTRA | 🟢 SOURCE | New-only: Scale/Index "solo" channels; Shift-append marquee; Ctrl-click additive select; right-click-on-key Delete menu. |
| **CRV-12** | LOW | ⚪ LIVE | Insert-mode hit-test on an existing key routes via the key's handlers, not backdrop-add — likely no double-insert, but worth a live click-test. |

---

## 7. Menus / toolbar / accelerators / dialogs  (`main.cpp` + `.rc` ↔ `MenuBar.tsx` / `Toolbar.tsx` / `*Dialog.tsx`)

| ID | Sev | Verify | Delta |
|---|---|---|---|
| **MNU-2** | HIGH | 🟢 SOURCE | **Global accelerators mostly stubbed.** Only Ctrl+Z / Ctrl+Shift+Z wired ([App.tsx:126-145](web/apps/editor/src/App.tsx:126)). Missing/unwired: **Ctrl+S, Ctrl+N, Ctrl+O, Ctrl+Del, Ctrl+G, Ctrl+H, Ctrl+B, Ctrl+Home, F5, F6, F7, F8, F9, F10, Ctrl+Space, Alt+Up/Down.** Menu items still display the hints. F2/Delete/Ctrl+C/X/V work only with tree focus. |
| **MNU-1** | HIGH | 🟢 SOURCE | **Edit-menu Cut/Copy/Paste/Delete hard-disabled** ([MenuBar.tsx:412-423](web/apps/editor/src/components/MenuBar.tsx:412)) — ops work only via tree context/keyboard. |
| **MNU-4** | HIGH | 🟢 SOURCE | **Context menu: Cut/Copy/Paste/Paste-As/Toggle-Visibility/immediate-increment all missing or restructured** (see SEL-5/SEL-9). |
| **MNU-3** | MED | 🟢 SOURCE | **Emitters menu: Toggle Visibility / Show All / Hide All are disabled placeholders** (`console.log` TODOs) ([MenuBar.tsx:501-521](web/apps/editor/src/components/MenuBar.tsx:501)). |
| **MNU-5** | MED | 🟢 SOURCE | Link-group menu simplified (see LNK-8). |
| **MNU-13** | MED | ⚪ USER | **`IDD_LINK_GROUP_DISAGREEMENT` has no React counterpart** (see LNK-10) — un-exempting conflicting fields may silently pick a winner. |
| **MNU-7** | MED | ⚪ USER | **Reset Camera** uses hard-coded vectors `[0,-250,125]/[0,0,0]/[0,0,1]` ([MenuBar.tsx:662-675](web/apps/editor/src/components/MenuBar.tsx:662)); confirm they equal the legacy `ID_VIEW_RESETCAMERA` engine default. No `Ctrl+Home`. |
| **MNU-6** | LOW | 🟢 SOURCE | View → Bloom… (`Ctrl+B`) + Bloom dialog removed (relocated to toolbar toggle + Lighting pane). Intentional. |
| **MNU-12** | LOW | 🟢 SOURCE | **Import Emitters dialog is missing the legacy "Clear" button** (has Select All only). Other dialogs (Rescale ×2, Increment Index, Mod Nickname, Link Group Settings) are at field parity. |
| **MNU-8 / MNU-11** | LOW/COSMETIC | 🟢 SOURCE | About dialog: different product name/author, **dropped Expat license text**; Mods menu drops the `folder (nickname)` parenthetical. |
| **MNU-9 / MNU-10** | EXTRA | 🟢 SOURCE | New-only/relocated: Recent Files submenu, Reset panel layout, Leave-particles + Ground/Background dropdowns + Theme toggle on the toolbar; **Save As added** to toolbar; **Undo/Redo + Debug Heat removed** from toolbar (menu-only). |

---

## 8. Viewport / docking / status / undo / autosave  (`host/*` + `main.cpp` ↔ `PanelLayout.tsx` / `viewport-input.ts` / `StatusBar.tsx`)

| ID | Sev | Verify | Delta |
|---|---|---|---|
| **VPT-2** | 🟥 CRITICAL | 🟢 SOURCE | **Undo/redo inert.** Host `UndoStack` exists but no new-UI edit calls `Capture()`; `undo/perform` returns `applied:false`, menu items never enable ([HostWindow.cpp:432-438](src/host/HostWindow.cpp:432)). Acknowledged deferred in-code — but a hard regression for anyone on the new UI today. |
| **VPT-3** | HIGH | 🟢 SOURCE | **No autosave / crash-recovery** anywhere in `web/` or `src/host/`. Legacy: 30 s + 5 min tiers + orphan-recovery prompt ([Autosave.h:41-44](src/Autosave.h:41), [main.cpp:2227-2249](src/main.cpp:2227)). No unsaved-work safety net. |
| **VPT-1** | MED | 🟢 SOURCE | **Ctrl+Y redo dropped** (classic Windows redo) — only Ctrl+Z / Ctrl+Shift+Z registered. |
| **VPT-10** | MED | ⚪ USER | **Right-dock is exclusive (Spawner XOR Lighting)** — legacy floating dialogs could both be open at once. |
| **VPT-6** | LOW | 🟢 SOURCE | **"Press SHIFT to spawn an instance" status hint gone** — the only on-screen cue for shift-to-spawn (the feature still works). |
| **VPT-7** | LOW | 🟢 SOURCE | **PAUSED indicator dropped from the status bar** (only the toolbar Play/Pause button shows pause state). |
| **VPT-5 / VPT-8** | LOW/COSMETIC | 🟢 SOURCE | Status-bar pane order reversed/regrouped (Emitters now its own cell); cursor readout `2dp → 1dp`, "Mouse:" → "Cursor", throttled ~30 Hz. |
| **VPT-9 / VPT-4** | EXTRA | ⚪ USER | New-only: 4 draggable + persisted splitters, docked resizable panes, reset-layout; Undo/Redo toolbar buttons removed (menu-only). |
| **VPT-11 / VPT-12** | — | ⚪ USER | Camera math is the shared C++ host (identical); only DOM→Win32 wheel/pointer encoding differs — feel-check wheel direction/magnitude on trackpad/natural-scroll. |

---

## Open questions for you (legacy feel / pixels / intent)

These I deliberately did **not** guess — they need your call or your eye on the
legacy build:

**Data-correctness (please confirm priority):**
1. **PRM-4 / PRM-5 (rotation scaling)** — this writes wrong values to `.alo` files
   the moment a user edits rotation average/variance in the new UI. Is this a
   launch-blocker to fix now, or are these fields rarely touched?
2. **VPT-2 / VPT-3 (undo + autosave)** — confirmed intentionally deferred (you still
   daily-drive legacy), or should they be treated as blocking before any wider use?

**Missing interactions — keep or restore?**
3. **Marquee box-select (SEL-1)** — required parity, or acceptable to drop?
4. **Global accelerators (MNU-2)** — is full keyboard wiring (esp. Ctrl+S, F7,
   F8–F10, Ctrl+Space) a tracked follow-up or expected to ship?
5. **Clipboard in menus + "Paste As child" (SEL-5/MNU-1/MNU-4)** and **curve-key
   copy/paste (CRV-2)** — restore, or keyboard-only/dropped?
6. **Spinner hold-to-repeat (SPN-5)** and **scrub-on-number (SPN-2)** — wanted back?
7. **Link-group: Dissolve action (LNK-8), bracket click/hover (LNK-6), `[L<n>]`
   prefix / dot (LNK-1/2), join-conflict warning (LNK-10)** — which matter to you?
8. **Color picker live-preview + cancel/revert (PAL-2/3)** and **texture
   single-click-applies (PAL-9)** — acceptable simplifications?

**Likely bugs — want fixes?**
9. **SPN-4** drag modifier inverted vs keyboard/wheel (and the wrong comment).
10. **MNU-7** Reset-Camera vectors — verify they match legacy exactly.
11. **CRV-14** stale "1.2× headroom" comment that doesn't match the code.

**Intentional evolution — thumbs up/down?**
12. Docking model (VPT-9/10), multi-channel curve overlay (CRV-4), single-click
    texture apply (PAL-9), dark-bg link palette (LNK-3).

---

## Appendix — component map & verification log

**Component map:** `EmitterList.cpp`↔`EmitterTree.tsx`+`emitter-selection.ts` ·
`Spinner.cpp`↔`Spinner.tsx` · `Emitter.cpp`+model↔`EmitterPropertyTabs.tsx`(+`GroupBody`) ·
`LinkGroup.cpp`↔`LinkGroup*Dialog.tsx`+`link-group-colors.ts` ·
`ColorButton.cpp`/`TexturePalette.cpp`↔`primitives/*`+`TexturePalettePopover.tsx` ·
`CurveEditor.cpp`+`TrackEditor.cpp`↔`CurveEditor.tsx`+`CurveEditorPanel.tsx` ·
`main.cpp`+`.rc`↔`MenuBar.tsx`/`Toolbar.tsx`/`*Dialog.tsx` ·
`host/*`+`main.cpp`↔`PanelLayout.tsx`/`viewport-input.ts`/`StatusBar.tsx`.

**Live-driving performed (browser preview, MockBridge):** tree selection;
inspector population (Basic + Appearance tabs); display formatting (2dp float /
integer / percent); spinner wheel-fires + commit round-trip; marquee absence
(negative test — drag across tree, no selection change, no marquee DOM); rotation
fields present + disabled-when-off.

**Three-layer (TRIPLE) verification:** PRM-4/PRM-5 confirmed in legacy `Emitter.cpp`
(scaling), host `BridgeDispatcher.cpp` (raw passthrough), and new
`EmitterPropertyTabs.tsx` (raw bind).

**Reconciliations (subagent contradictions resolved):** spawn-volume editor IS
ported (`GroupBody` 1:1) — the "unported" alarm was a scoping error against the
gallery-only `primitives/RandomParam.tsx`. Animation tracks ARE editable (Curve
editor, §6).

**Not verified (host-side, out of this audit's read scope):** `emitters/cut|copy|
paste|drop|duplicate` name-suffixing & ordering semantics; exact legacy ChooseColor
custom-slot overwrite rule; live trackpad wheel-zoom feel.
