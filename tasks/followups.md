# LT-4 follow-up backlog (captured 2026-06-01)

User-reported items from a live review session. Not yet scoped/scheduled.
Tags: **[bug]** broken behaviour · **[feat]** new behaviour · **[polish]**
visual/UX refinement · **[?]** needs a clarification before building.

---

## Emitter list & its controls

### F1 [polish][?] Emitter row icons — visibility on the left, lifetime/on-death on the right for children
- **Want:** replace the colored dot on the left of each emitter row with the
  **visible/hidden (eye) icon**. For **child** emitters, also show the
  **lifetime / on-death** icon on the right, adjacent to the visibility icon.
- **Today:** row is `[role glyph/dot] [name] [eye toggle]`
  ([EmitterTree.tsx:607](../web/apps/editor/src/screens/EmitterTree.tsx:607),
  glyph at :624, eye at :683).
- **[?] Clarify:** final layout — does the eye move to the **left** (replacing
  the dot) and the right slot show lifetime/on-death for children? Or does the
  eye stay right and the dot just becomes a second eye? Sketch the target row
  for parent vs child before building. Also: which icon represents
  "lifetime / on death" (leave-particles-after-death?).

### F2 [polish] Emitter-tree toolbar — center it, size/space like the main toolbar
- **Want:** the controls under the emitter list (`+`, duplicate, delete, move
  up/down, show/hide-all) are too small and look lopsided when panes resize.
  Center the group and match the **main toolbar** icon-button sizing +
  horizontal spacing.
- **Where:** `.tree-actions` / `.tree-actions .icon-btn`
  ([components.css:422](../web/apps/editor/src/styles/components.css:422)),
  toolbar ref `.tb-btn` (~28px, [components.css:141](../web/apps/editor/src/styles/components.css:141)),
  markup [EmitterTree.tsx:924](../web/apps/editor/src/screens/EmitterTree.tsx:924).
- **Effort:** small CSS (size tokens + `justify-content: center`).

---

## Toolbar interaction

### F3 [polish] Pressed (LMB-down) icon state on toolbar buttons
- **Want:** toolbar buttons — **including** the emitter-tree controls (F2) —
  show a distinct icon/visual state while the left mouse button is held down
  (`:active`), not just hover/`aria-pressed`.
- **Where:** `.tb-btn` / `.icon-btn` / `.tree-actions .icon-btn` in
  [components.css](../web/apps/editor/src/styles/components.css). Add `:active`
  styling (bg/scale). Pure CSS.

---

## Link groups

### F4 [bug] Link groups don't work (brackets render but functionality is dead)
- **Want:** linking emitters into a group should actually link them; right now
  the bracket gutter draws but the behaviour doesn't take effect. **Investigate
  root cause** (host link-group state vs the React bracket render).
- **Where:** bracket render in [EmitterTree.tsx](../web/apps/editor/src/screens/EmitterTree.tsx)
  (gutter ~:1353+, `b.lane`/`LANE_WIDTH_PX`); `src/LinkGroup.h`,
  `LinkGroupSettingsDialog.tsx`, `SetLinkGroupDialog.tsx`; host link-group
  bridge handlers in `BridgeDispatcher.cpp`. Start by confirming whether the
  link request reaches the host and mutates state, vs a web-only no-op.

### F5 [polish] Move link-group brackets closer to the emitter text (match v0.2)
- **Want:** the bracket gutter sits too far from the names; pull it in close to
  the emitter text like legacy 0.2.
- **Where:** gutter geometry in [EmitterTree.tsx](../web/apps/editor/src/screens/EmitterTree.tsx)
  (`gutterPx`, `GUTTER_LEFT_PAD_PX`, `LANE_WIDTH_PX`, the `marginRight` on the
  `<ul>` at ~:1358). Likely a CSS/constant tweak; pairs naturally with F4.

---

## Numerical fields (Spinner)

### F6 [bug/UX] Drag-on-text shouldn't change the value — it blocks text selection
- **Want:** dragging the cursor across a number field's text should **select
  text** (to retype/edit part of it), not scrub the value. Today the
  drag-to-adjust gesture hijacks the text, making partial edits hard.
- **Where:** `Spinner` `handleMouseDown` + drag logic
  ([Spinner.tsx:162](../web/apps/editor/src/primitives/Spinner.tsx:162)).
  Options: restrict drag-scrub to a dedicated affordance (the arrows or a
  label-grip), require a modifier, or only scrub when the input isn't focused/
  text isn't being selected. Preserve the scrub for users who rely on it.

### F7 [feat] Scroll-wheel adjust — revisit; legacy stepped by 0.1
- **Want:** reconsider wheel-to-adjust on number fields **and** the curve
  editor value fields. Legacy adjusted by **0.1** per wheel notch.
- **Where:** `Spinner` wheel handler (native `wheel` listener,
  [Spinner.tsx:143](../web/apps/editor/src/primitives/Spinner.tsx:143), L-008)
  currently steps by the field's `step`. Decide: fixed 0.1 vs per-field step;
  apply consistently to inspector + curve-editor Time/Value spinners.
- **Note:** ties into F6 (both are number-field interaction model).

---

## Curve editor

### F8 [feat] Multi-key edit = average; adjusting the average moves the group
- **Want:** when >1 key is selected, the Time/Value fields show the **average**
  of the selected keys, and editing that average **adjusts all selected keys**
  (e.g. relative offset / scale to the new average).
- **Where:** selection + spinner wiring in
  [CurveEditorPanel.tsx](../web/apps/editor/src/components/CurveEditorPanel.tsx)
  (`selectedKeyTimes`, the optimistic Time/Value override, `Math.fround` L-009).
  **[design]** decide the adjust semantics: set-all-to-value vs preserve
  spread (shift by delta). Legacy behaviour worth checking.

### F9 [feat] Selecting the Index channel auto-deselects RGBA
- **Want:** picking the **Index** curve should turn off the **R/G/B/A**
  channels (mutually exclusive), mirroring how Scale already works.
- **Where:** channel visibility logic in
  [CurveEditorPanel.tsx](../web/apps/editor/src/components/CurveEditorPanel.tsx)
  — there's already an `enableScaleExclusively()` (CurveEditor.tsx) for Scale;
  extend the same exclusivity to Index vs RGBA. Confirm legacy: is Index
  exclusive with *everything* (like Scale) or just RGBA?

---

## Rough grouping

- **Quick CSS/polish:** F2, F3, F5
- **Bugs to investigate:** F4 (link groups), F6 (drag-vs-select)
- **Features (need a small design decision):** F7, F8, F9
- **Needs clarification before build:** F1 (icon layout), and the design notes on F7/F8/F9
