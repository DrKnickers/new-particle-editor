# Polish batch — session 22 cont.

Four independent new-UI polish items. Web-first; one native a11y re-baseline at
the end (covers the golden-touching changes: labels + the details→controlled
conversion). Each item is its own commit + TDD where there's logic.

## 1. Appearance tab labels "Color texture:"→"Color:", "Bump texture:"→"Bump:"
- **Where:** [EmitterPropertyTabs.tsx:1072,1080](web/apps/editor/src/screens/EmitterPropertyTabs.tsx).
- **In:** the two `label=` props on the Appearance-tab `TexturePickerField`s.
- **Out:** `LinkGroupSettingsDialog`'s "Color texture" exempt-field label (different
  surface); the `TexturePickerField.test.tsx` fixtures (they pass arbitrary labels to
  unit-test the component generically — not the Appearance tab).
- **Tests:** update `EmitterPropertyTabs.test.tsx:179-180` expectations.
- **Golden:** `property-tabs-appearance` captures the field labels → re-baseline.
- **Verify:** vitest; the label drives the textbox name + "Browse for …"/"Open texture
  palette for …" button names — confirm those derive correctly.

## 3. Rotation curve exclusive (like Index/Scale)
- **Where:** [CurveEditorPanel.tsx:94](web/apps/editor/src/components/CurveEditorPanel.tsx) —
  `EXCLUSIVE_CHANNELS = new Set(["scale","index"])` → add `"rotation"`. The 3 read-sites
  (checkbox toggle, row-click, enableExclusively) cascade automatically.
- **Tests:** mirror the Index exclusivity tests (`CurveEditorPanel.test.tsx:275-334`):
  rotation-checkbox solos; clicking Rotation while Index solo swaps; non-rotation row exits.
- **Golden:** none — default channel state (RGB on, rotation off) unchanged; exclusivity
  is interaction-only.

## 4. Click link-group bracket → select all members (wider hit-zone, replace)
- **Where:** [EmitterTree.tsx:~1779-1826](web/apps/editor/src/screens/EmitterTree.tsx) bracket
  render; selection via `useEmitterSelectionStore.setIds(ids, primary)` +
  `bridge.request({kind:"emitters/select", params:{id: primary}})`.
- **LNK-6 guard (the landmine):** the bracket is `pointer-events-none` because it overlays
  the row buttons; a naive clickable bracket wiped selection. Mitigation: put
  `pointer-events:auto` + `onClick` on a slightly-widened hit-zone on the BRACKET element
  only (gutter stays `pointer-events-none`), and `stopPropagation()` so the click never
  reaches a row button. Hit-zone lives in the right gutter, clear of row content.
- **Behavior:** collect `flatRows.filter(r => r.node.linkGroup === groupId).map(id)` (the
  same pattern as `handleDissolveLinkGroup`), `setIds(members, members[0])`, sync primary.
  Replace (not additive). Add `role="button"` + `aria-label` + keyboard (Enter/Space) for
  a11y; `cursor:pointer`.
- **Tests:** EmitterTree.test.tsx — clicking the bracket selects all members (extend the
  existing "bracket is NON-interactive" test region — that test now changes: the bracket
  IS interactive, but must still not steal a *row* click).
- **Verify LIVE (Playwright, L-067):** click bracket selects all members; clicking a row
  still selects just that row (no regression); pointer-events don't steal row clicks.
- **Golden:** the bracket isn't in a captured surface → none expected (confirm).

## 2. Animated hide/reveal for all caret sections (CSS grid-rows, no dep)
- **Mechanism:** a shared CSS animated body — `display:grid; grid-template-rows:0fr;
  transition:grid-template-rows .2s ease; overflow:hidden` collapsed → `1fr` open; inner
  wrapper `min-height:0; overflow:hidden`. Content stays MOUNTED (so it can tween).
- **a11y correctness:** collapsed content currently UNMOUNTS (absent from a11y tree). Keeping
  it mounted must NOT leak collapsed content into the a11y tree / goldens → add
  `visibility:hidden` (transitionable, removes from a11y tree) on the collapsed body, with a
  transition-delay so it hides only after the collapse finishes. (Verify open-section goldens
  are unchanged; closed sections stay out of the a11y tree.)
- **Three patterns to update:**
  - `Section.tsx` (inspector property tabs): `{open && <body>}` → always-render body wrapper
    with the animated CSS, keyed off `data-open`.
  - `LinkGroupSettingsDialog` `CategorySection`: same treatment.
  - `ToolPanel.Section` (Lighting/Spawner): **convert `<details>/<summary>` → controlled
    `useState` + button header** (native details can't animate reliably). Preserve
    `aria-expanded`, Enter/Space, the chevron rotation, and `alwaysOpen` variant.
- **Golden:** `dialog-lighting` changes (details/summary → button/region role) — surgical,
  expected. `property-tabs-*` should be UNCHANGED if visibility management keeps collapsed
  content out of the a11y tree (verify). Spawner panel isn't a captured surface.
- **Verify LIVE (preview):** every caret section (Lighting Sun/Fill/Bloom, Spawner sections,
  property-tab sections, link-group dialog categories) expands/collapses with a smooth height
  tween; chevron rotates; no content flash/jump; rapid toggling doesn't break.

## Native pass (after all four web items, once)
- `pnpm build` dist (L-068) + grep the new strings; `pnpm a11y:update`; review the COMBINED
  golden diff (expect: property-tabs-appearance label change + dialog-lighting details→button;
  nothing else). `pnpm test:native` → expect 169/0 (+ any web-only count unchanged).

## Review

All four shipped, TDD where there was logic. Web suite **513/0**, `tsc -b` clean,
native harness **169/0**.

- **1. Labels** (`59238a6`): "Color:" / "Bump:". Zero golden impact — the a11y captures
  select no emitter, so the Textures section never renders; covered by the vitest test.
- **3. Rotation exclusive** (`fea98d2`): one entry in `EXCLUSIVE_CHANNELS`; +3 tests
  mirroring Index. No golden impact (interaction-only).
- **4. Bracket → select group** (`84a6d79`): 10px hit-zone, replace selection, LNK-6
  guarded (pointer-events only on the hit-zone + stopPropagation). **Live-verified via
  `elementFromPoint`** — bracket owns only its 10px band, row owns all other x. Replaced
  the old "non-interactive" test.
- **2. Animation** (`0f0e4d3` + `e5898b3` fix + `d621fca` goldens): shared `.collapse-anim`
  grid-rows utility; converted ToolPanel.Section `<details>`→controlled. **Live-verified**
  the tween (Spawner 96↔0, property-tab 108↔0, `visibility:hidden` when collapsed, clean
  round-trip, zero console errors). Re-baselined **19 goldens** (one shared cause: the
  Spawner panel's section conversion in every full-page golden + Lighting dialog); fixed 2
  native specs' `summary`→`[role=button]` Bloom selectors.

**Lessons captured:** L-070 (`tsc --noEmit` skips test files; the build's `tsc -b` is the
real gate — caught a test-file type error that shipped green).

**Verification gaps (for the user's eye):** the *feel* of the animation timing (0.2s ease)
over the live D3D viewport, and whether a pasted/selected link-group behaves right in the
real engine — agent arch-C visuals are untrustworthy (L-033).
