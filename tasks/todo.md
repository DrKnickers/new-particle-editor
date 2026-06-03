# UI Delta Audit — Legacy native UI vs. New React UI

**Status:** PLAN — awaiting scope confirmation before execution.
**Deliverable:** a single rigorous report of every behavioral / parameter /
structural delta between the legacy Win32 UI (`src/`, esp. `src/UI/*` + `main.cpp`)
and the new React UI (`web/apps/editor/src/`). **No code changes** — findings are
flagged and discussed before anything is implemented.

---

## 1. Goal + scope

**Goal.** When this ships, the user has a complete, source-grounded map of where the
new UI diverges from the legacy UI it is meant to replace — every interaction
behavior, every exposed parameter, every structural/visual element — each finding
classified by severity + confidence + how-verified, with file:line refs on both
sides. This is the gating artifact for arch-C trust toward the eventual LT-4→master
cutover.

**In scope (the 10 audit dimensions):**
1. Selection & marquee (emitter tree)
2. Spinners / numeric entry (click-drag, wheel, modifiers, edit/commit)
3. Link groups (appearance, coloring, set/leave flow, dialogs)
4. Parameter completeness (every emitter/particle field, tab grouping, labels, units)
5. Color & texture pickers + random params
6. Curve / track editor
7. Menus / toolbar / keyboard accelerators / enable-disable logic
8. Dialogs (rescale, increment-index, import, mod-nickname, about, save-changes)
9. Viewport input & docking / layout / splitters
10. Undo/redo, autosave, status bar, and any misc behavior not covered above

**Out of scope (named so a future reader knows it was deliberate):**
- *Implementing* any fix — separate follow-up after discussion (user: "do not
  implement changes before discussing").
- Engine/render-pixel fidelity beyond UI chrome (particle look, bloom, lighting
  *rendering*) — separate arch-C visual-parity track, needs the user (L-033); this
  audit covers UI *behavior/structure*, flagging pixel items as user-needed open
  questions.
- Performance/timing parity — out of scope unless a behavior depends on it.
- Legacy MFC-era code paths already removed pre-rewrite.

## 2. What the codebase already gives us

Clean 1:1 component map (legacy `src/UI/*.cpp` ↔ new counterpart):

| Dimension | Legacy | New |
|---|---|---|
| Tree + marquee | `src/UI/EmitterList.cpp` (4955) | `screens/EmitterTree.tsx`, `lib/emitter-selection.ts` |
| Spinners | `src/UI/Spinner.cpp` (583) | `primitives/Spinner.tsx` |
| Link groups | `src/LinkGroup.cpp`, EmitterList ctx-menu | `screens/{LinkGroupSettings,SetLinkGroup}Dialog.tsx`, `lib/link-group-colors.ts` |
| Parameters | `src/UI/Emitter.cpp` (873) | `screens/EmitterPropertyTabs.tsx` |
| Color button | `src/UI/ColorButton.cpp` | `primitives/ColorButton.tsx` |
| Texture palette | `src/UI/TexturePalette.cpp` (1019) | `primitives/TexturePalette.tsx`, `screens/TexturePalettePopover.tsx` |
| Random param | `src/UI/RandomParam.cpp` | `primitives/RandomParam.tsx` |
| Curve/track | `src/UI/CurveEditor.cpp` (1044), `TrackEditor.cpp` (483) | `screens/CurveEditor.tsx`, `components/CurveEditorPanel.tsx` |
| Menus/accel/toolbar | `src/main.cpp` (8274) menu + accel tables | `components/{MenuBar,Toolbar,StatusBar}.tsx` |
| Dialogs | `src/main.cpp` dialog procs | `screens/*Dialog.tsx` |
| Viewport/docking | `src/host/*`, `main.cpp` layout | `components/PanelLayout.tsx`, `lib/viewport-input.ts`, `lib/right-dock.ts` |

Already-confirmed candidate finding (proves the method): legacy marquee rubber-band
select (`EmitterList.cpp:392-410`, MT-8/MT-9) has **no** new-UI counterpart in the
emitter tree (`emitter-selection.ts` does click/ctrl/shift only).

## 3. Methodology / approach

**Three-column extraction per surface:**
1. **Legacy contract** — read the C++ message handler(s); enumerate EVERY interaction:
   mouse down/move/up, double-click, wheel, drag (+ thresholds/axes/sensitivity),
   right-click/context menu, keyboard, modifiers (Ctrl/Shift/Alt), hit-testing,
   clamps, edge cases.
2. **New contract** — read the TSX/lib; enumerate the same.
3. **Delta** — classify each difference.

**Severity rubric:** `MISSING` (legacy-only) · `DIVERGENT` (both, behaves
differently) · `EXTRA` (new-only enhancement) · `COSMETIC` (appearance/layout) ·
`PARAM-GAP` (field absent/renamed) · `UNVERIFIED` (needs user/live test).
Plus **Confidence** (High/Med/Low) and **How-verified** (source-only / live-CDP /
user-needed).

**Verification matrix (per project rules):**
- Legacy *logic* → C++ source authoritative. Legacy *feel/pixels* → user (daily-
  drives legacy; L-033 — never trust agent arch-C screenshots).
- New *logic* → TSX source authoritative; **live-drive** new UI over CDP/browser-
  preview (L-041) for high-impact / ambiguous interaction findings (marquee, spinner
  drag) + render-only divergences. Headless preview can't advance CSS transitions
  (L-055).
- Registry round-trips, if relevant → `verify-force-align.mjs` pattern.

**Execution:** parallel read-only **Explore** subagents, one per dimension, each
given the legacy + new file refs, the extraction template, and the rubric; each
returns a structured findings list. I synthesize, de-dup, live-verify the
highest-impact/ambiguous items myself, and assemble the report. (No Workflow-tool
orchestration unless the user opts in.)

**Report structure (`tasks/ui-delta-report.md`):**
- Executive summary — counts by severity, top risks.
- Methodology + sources + confidence legend.
- Per-dimension finding tables: ID · area · legacy behavior (file:line) · new
  behavior (file:line) · delta · severity · confidence · how-verified.
- "Open questions for the user" — legacy-feel/pixel confirmations I won't guess.
- Appendix: component map + file index.

## 4. Risks + mitigations

1. **Source-only misread of legacy behavior.** C++ handlers are dense
   (`EmitterList.cpp` is 4955 LOC); a misread produces a false delta. *Mitigation:*
   every legacy claim carries a file:line ref; ambiguous ones are flagged Low-
   confidence + routed to the user rather than asserted.
2. **New-UI source ≠ rendered behavior.** A handler may exist but be wired wrong.
   *Mitigation:* live-CDP / browser-preview spot-checks on high-impact findings, not
   source-only for those.
3. **Audit fatigue → shallow coverage of the long tail** (parameters, menu items).
   *Mitigation:* parameter & menu dimensions get an *exhaustive enumerated* pass
   (every field/item listed, present-or-absent), not a sampled one.
4. **Scope creep into implementation.** *Mitigation:* hard rule — report only, no
   edits; fixes discussed after.
5. **Arch-C screenshot trap (L-033).** *Mitigation:* no agent screenshots of the
   faithful build as evidence; pixel items → user.

## 5. Testing & verification (of the audit itself)

- [ ] Component map complete — every `src/UI/*.cpp` and every
      `web/.../screens|primitives|components` file is accounted for in a dimension.
- [ ] Each finding has both-side file:line refs.
- [ ] Each finding has severity + confidence + how-verified.
- [ ] High-impact interaction findings (marquee, spinner drag) live-verified on the
      new side (CDP or browser-preview), not source-only.
- [ ] Parameter dimension is an exhaustive enumerated list (no sampling).
- [ ] Legacy-feel/pixel items collected into "Open questions for the user", not
      guessed.
- [ ] No code changed; `git status` clean except the report + this todo.

---

## Review

**Executed 2026-06-03.** Deliverable: [ui-delta-report.md](ui-delta-report.md)
(~95 findings across all 10 dimensions). Method: 8 parallel read-only
source-extraction subagents → live-driving the new UI (browser preview / MockBridge)
for headline interactions → three-layer source reads for the sharpest bugs →
cross-agent reconciliation.

Verification checklist:
- [x] Component map complete — every `src/UI/*.cpp` + new `screens|primitives|components` accounted for.
- [x] Each finding has both-side file:line refs.
- [x] Each finding has severity + confidence + how-verified tag.
- [x] High-impact interaction findings live-verified (marquee absence 🔴; spinner display/wheel/commit 🔴).
- [x] Parameter dimension is an exhaustive enumerated list (50-field inventory, no sampling).
- [x] Legacy-feel/pixel items collected into "Open questions for you", not guessed.
- [x] No code changed (audit only) — `git status` clean except the report + this todo.

**Headline outcomes:**
- 2 CRITICAL: PRM-4/PRM-5 rotation scaling (🟣 triple-confirmed data-fidelity bug —
  writes wrong values to `.alo`); VPT-2 inert undo.
- Cross-agent catch: spawn-volume editor IS ported (`GroupBody` 1:1) — the
  "unported" alarm was a false positive (gallery-only `primitives/RandomParam.tsx`).
- Largest theme: keyboard/accelerator layer mostly stubbed (MNU-2).

**Next:** discuss findings with the user; no implementation until prioritized.
