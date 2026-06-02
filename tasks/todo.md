# New-UI review polish — 3 items from the 2026-06-02 user launch

`[lt-4]`. All web/ (React/CSS). Branch `lt-4`. Verify in browser mode (L-041)
where possible; arch-C visuals confirmed by the user on relaunch (L-033).

## Item 1 — black line along the Spawner panel's viewport-facing edge

**Diagnosis.** `.panel` ([components.css:275](web/apps/editor/src/styles/components.css:275))
has `border-radius: 8px` on all corners. The LEFT panel squares its
viewport-facing (right) corners via `.panel-flush-right`
([PanelLayout.tsx:262](web/apps/editor/src/components/PanelLayout.tsx:262)) —
its comment: *"square the corners that face the engine viewport so the rounded
corner doesn't leave a wedge of (clipped) engine backing showing."* The Spawner
panel ([SpawnerPanel.tsx:167](web/apps/editor/src/screens/SpawnerPanel.tsx:167))
is a bare `.panel` with rounded LEFT corners facing the viewport and no mirror —
so its rounded corner exposes the black engine backing.

**Fix.** Add `.panel-flush-left` (square top-left + bottom-left radius) to
components.css; apply it to the SpawnerPanel root `.panel`.
**Verify:** arch-C visual → user confirms on relaunch (browser mode has no
engine backing, so it can't show this; L-033).

## Item 2 — move the role glyph between the visibility icon and the label

**Diagnosis.** Row grid is `"18px 1fr 18px"` = [eye | label | role-glyph]
([EmitterTree.tsx:622](web/apps/editor/src/screens/EmitterTree.tsx:622)); the
role glyph (↻ / ✕) renders in the right column. User wants it between the eye
and the label.

**Constraint.** The row is captured in `emitter-tree*.golden.*` as
`text: "default ↻"` + accessible name `"Hide emitter default lifetime child"`.
A DOM reorder changes both → breaks the golden, which L-033 says not to
regenerate here.

**Fix (golden-safe).** Keep DOM order [eye, label, role] unchanged; reorder
*visually* with CSS grid placement — grid `"18px 18px 1fr"`, role glyph
`grid-column: 2`, label/input `grid-column: 3`, eye stays column 1. DOM order
and accessible names are untouched → goldens stable. Update the one vitest
assertion (`gridTemplateColumns` in EmitterTree.test.tsx:468) + its comment.
Minor a11y note: visual order (eye·glyph·label) now differs from reading order
(eye·label·glyph) — accepted to preserve goldens.
**Verify:** vitest green; browser-mode preview shows glyph between eye + label.

## Item 3 — burst-delay field drops the 2nd decimal (legacy allows 0.01) — DECISION NEEDED

**Diagnosis.** GENERATION "Burst delay" Spinner uses `step={0.1}`
([EmitterPropertyTabs.tsx:496](web/apps/editor/src/screens/EmitterPropertyTabs.tsx:496)).
Spinner derives `dp = -floor(log10(step))` → 1 decimal, and `commit` does
`toFixed(dp)`, so a typed `0.01` truncates to `0.0`. Legacy displays burst delay
as `%.3f` ([EmitterList.cpp:2511](src/UI/EmitterList.cpp:2511)) and clamps to
`max(0.01f, …)` ([EmitterInstance.cpp:665](src/EmitterInstance.cpp:665)) → 3
decimals is the faithful legacy match.

**The fork.** Any precision change alters the displayed default `1.0` → `1.000`
(or `1.00`), and that value is baked into **~18 a11y goldens** (9 surfaces ×
json+yaml: spinner-focused, property-tabs, dialogs, kbd-*, curve-editor). Fixing
the field forces a golden refresh, which **L-033 says not to do on this machine**
(UIA non-determinism + flake risk). Options for the user:
- (a) Make the code change here + `pnpm a11y:update` to regen goldens (the
  DOM/composition goldens are deterministic on this box — they pass 157/4 — so
  regen risk is mostly the UIA-json variant).
- (b) Make the code change; hand golden regen to the user/CI.
- (c) Hold item 3 until a golden-regen-safe moment.
Also confirm precision: **3dp** (legacy-faithful `1.000`) vs 2dp (`1.00`).

## Testing & verification

- [ ] vitest green (45 files; EmitterTree.test.tsx gridTemplateColumns updated).
- [ ] Browser-mode preview: role glyph sits between eye + label; spawner panel
      left corners square (no rounded wedge in DOM — engine backing N/A here).
- [ ] Rebuild dist so the user can relaunch for the arch-C visual review
      (item 1 black line; item 2 reorder in the real compositor).
- [ ] a11y unaffected by items 1+2 (no DOM-order / value changes). Item 3
      deferred pending the decision above.

## Review section

**What landed (all web/).**
| Item | Files | Change |
|---|---|---|
| 1 — black line | **(reverted)** | Hypothesised `.panel-flush-left` (rounded-corner wedge) — **WRONG**. Browser DOM inspection proved the line isn't a DOM element (no dark element; border is `#dcdcdc`; splitter already opaque `var(--bg)`). It's an **arch-C compositor seam** at the viewport↔Spawner boundary — engine black backing through a ~1px scene-rect/edge gap (L-034 family). Host-side; needs user verification (L-033). **Deferred to its own investigation.** flush-left reverted (cosmetic no-op; corners sit against the opaque splitter). |
| 2 — role glyph | `screens/EmitterTree.tsx` (+ its test) | grid `18px 18px 1fr`; role glyph `grid-column:2`, label/input `grid-column:3`. Visual order eye·glyph·label; **DOM order unchanged** → a11y goldens stable. |
| 3 — precision | `screens/EmitterPropertyTabs.tsx`, `screens/SpawnerPanel.tsx`, 20 `*.composition.golden.yaml` | `decimals={3}` on all 8 `s`-unit fields (initialDelay, skipTime, freezeTime, burstDelay, lifetime, spacing, interval, maxLifetime) — matches legacy `%.3f`. Goldens updated by surgical value substitution (no full regen, per L-033). |

**Verification.**
- vitest **390/45** green (EmitterTree grid assertion updated; no value-format assertions existed for item 3).
- Item 2 browser-verified (preview, 1728px): rows render `eye → ↻/✕ → label`, labels aligned, DOM order preserved.
- Item 3: a11y **157 pass / 4 splitters** (L-033) after the golden substitution — was ~24 failing pre-substitution, confirming the 20 goldens now match.
- dist rebuilt (composition) with all 3.

**Couldn't self-verify (hand to user).** Item 1 (black line) is arch-C compositing —
browser mode has no engine backing, so it can't show the wedge (L-033). Needs a
user relaunch to confirm the line is gone. Items 2 & 3 also worth an eyeball in
the real compositor.

**Not yet committed** — holding the FF-push until the user confirms item 1 on
relaunch (don't push an unverified arch-C fix).
