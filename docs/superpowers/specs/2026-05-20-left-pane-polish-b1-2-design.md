# Left-pane polish (B1.2) — design spec

**Phase:** Particle Editor 2026 redesign, follow-up to B1
**Date:** 2026-05-20
**Predecessor spec:** [2026-05-20 left-pane realignment (B1)](2026-05-20-left-pane-realignment-design.md)
**Successor spec:** B1.3 (resizable splitters) — separate brainstorm, follows this dispatch
**Target branch:** `lt-4`

---

## 1. Why this exists

B1 shipped the structural realignment of the left pane against the design
source. When the user lived with it, several visual fidelity gaps emerged on
side-by-side comparison with `Particle Editor 2026.html`:

1. The Basic / Appearance / Physics tab strip sits too low in the panel,
   with empty space between the tree's bottom toolbar and the tabs.
2. The inspector has excessive right padding compared to the reference.
3. Vertical spacing between form rows is too loose; readability suffers.
4. The "Name" field is rendered with the same narrow input width as the
   numeric fields; in the reference it spans the full available width.
5. Sections in each tab (Emitter Timing, Generation, Connection, Render,
   Texture, etc.) have no collapsible headers — they're flat lists.
6. The tree-toolbar button set doesn't match the reference: missing
   Duplicate, and Show All / Hide All are rendered as text labels rather
   than icons.

A seventh observation — the tree fills available vertical space and the
inspector is capped at a fixed 288px — is the structural shape underlying
gap #1. It will only be fully resolved by B1.3 (resizable splitters),
which is the next dispatch. B1.2 polishes everything *inside* the panels
so that B1.3's default widths can be calibrated against the post-polish
content density.

---

## 2. Goal

Bring the visual fidelity of the left pane closer to the design source's
`left_panel.jsx` + `styles.css` reference, by tightening spacing,
introducing collapsible section headers, full-width text inputs, and a
revised tree toolbar — without touching the structural shape of the panel
(which is B1.3's concern).

Single sentence: **the left pane reads like the reference photo at the
inspector and tree-toolbar level of fidelity, before any structural
resizing work.**

---

## 3. Scope

### 3.1 In scope (B1.2)

1. **Collapsible section primitive.** New `Section` component at
   `web/apps/editor/src/components/Section.tsx`. Renders a header row
   (entire row clickable + Space/Enter keyboard) with chevron icon, a
   thin section-divider hairline, and the children content. State:
   local `useState<boolean>` per Section, defaulting to `defaultOpen =
   true`. **Session-only** — no localStorage, no engine state. The
   component remounts when the inspector mounts (i.e., on emitter
   selection change), which is the desired reset behaviour.
2. **Wire sections into each tab.** `BasicTab`, `AppearanceTab`,
   `PhysicsTab` get their existing field lists grouped into `<Section
   title="...">` wrappers per the design source's groupings.
   Specifically:
   - **BasicTab:** "Emitter Timing" / "Generation" / "Connection"
   - **AppearanceTab:** "Render" / "Texture" / "Color"
   - **PhysicsTab:** "Forces" / "Collision" / "Turbulence"
   Field-to-section assignments derive from the legacy
   `src/UI/Emitter.cpp` groupings cross-referenced with the design
   source's `left_panel.jsx`. Detailed field-by-section assignment lives
   in § 5.3.
3. **Name field full-width.** The Name row in `BasicTab` switches from
   the default `.form-row` 3-column grid (`1fr 92px 56px`) to a custom
   `60px 1fr` override matching the design source's
   `left_panel.jsx:100`. The text input occupies the remaining flex
   space; no unit cell.
4. **Tree toolbar revision.** In `EmitterTree.tsx`:
   - Add a **Duplicate** button between New ▾ and Delete. Dispatches
     `emitters/duplicate` on the primary emitter. Disabled when
     `primaryId === null`. Icon: Lucide `Copy`.
   - Replace **Show All** and **Hide All** text labels with icon
     buttons. Icons: Lucide `Eye` (Show All), `EyeOff` (Hide All).
     Tooltips preserve the full text. Button order:
     `New ▾ │ Duplicate │ Delete │ Move Up │ Move Down │ divider │ Show All │ Hide All`.
     7 buttons + 1 divider (was 5 + 1 + 2 text buttons).
5. **CSS spacing audit.** Verify `components.css`'s `.inspector` rule
   matches the design source's `padding: 8px 10px 12px`. Verify
   `.form-row`'s `padding: 3px 0` matches. If our copy has drifted from
   the design source values, sync. Inspect the App.tsx inspector
   wrapper for stale Tailwind padding (e.g., `p-3` on a parent) that
   would conflict with the inspector's own padding; remove if present.

### 3.2 Out of scope (deferred)

| Item | Reason / disposition |
|---|---|
| Resizable splitter bars (left pane width, viewport ↔ curve editor split, viewport ↔ spawner split) | **B1.3 dispatch.** This is the structural fix for gap #1 (tabs too low + empty space above). Needs its own brainstorm because it introduces new feature surface (drag handlers, persistence, min/max constraints) and `react-resizable-panels` as a new dependency. |
| Per-row link-group dot, color swatch, kind icons, lock icons | Already dropped in B1 brainstorm — no engine backing for those concepts. |
| Search bar at top of tree | Dropped in B1 brainstorm. |
| Reset / Settings / Solo toolbar buttons (in the reference's 8-button set) | No engine equivalents (Solo could be invented but the user dropped it). Roadmap-worthy if someone wants to invent meaning later. |
| Collapsible state persistence (localStorage / engine state) | **Session-only** is the user's call. Each mount of the inspector starts with `defaultOpen = true`. |
| Per-section configurable defaults (some sections start collapsed) | User picked "all expanded" as the default. Section-by-section default-state config is YAGNI for B1.2. |
| Re-skinning toolbar button visuals (size, hover state) beyond Show/Hide icon swap | Existing `TOOLBAR_BTN` className stays. Visual tweaks to button hit area / hover sit out unless they become a problem in B1.3 alongside the new splitter visuals. |

### 3.3 Out of scope, will become roadmap candidates if not already filed

- **Section state persistence** if user later wants the collapse state
  to outlive a session. Cheap to add later (one localStorage key) but
  not in B1.2.
- **Solo button + bulk "show only" semantics**. The user dropped it in
  B1.2 brainstorm; could become an `[NT-K]` entry later.

---

## 4. Source-of-truth artifacts

- **`styles.css`** (design bundle, lines 505–608 for inspector / section
  / form-row / text-input definitions) — authoritative for visual
  values.
- **`left_panel.jsx`** (design bundle) — authoritative for section
  ordering and the Name-row width override.
- **`src/UI/Emitter.cpp`** — legacy editor's field-to-section grouping
  for legacy parity reference (the field set is unchanged; only
  visual grouping changes).
- **`components.css`** (in this repo, imported via Phase 1) — Phase 1
  imported the design source's component classes here. B1.2 should
  *audit* this file against the design source rather than add new
  rules.

---

## 5. Architecture

### 5.1 New component — `Section`

File: `web/apps/editor/src/components/Section.tsx`. Tiny — ~40 lines
including imports and types.

```tsx
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type Props = {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
};

/** Collapsible section header for the inspector tabs. Click anywhere
 *  on the header (or Space/Enter when focused) toggles the section.
 *  State is local + session-only — defaults to `defaultOpen = true` on
 *  every mount. Re-mounting (e.g., switching emitters) resets every
 *  section to its default state. */
export function Section({ title, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = () => setOpen((o) => !o);
  return (
    <div className="section">
      <div
        className={`section-header ${open ? "" : "collapsed"}`}
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
        aria-expanded={open}
        data-testid={`section-${title.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <ChevronDown className="chev size-3" />
        <span>{title}</span>
      </div>
      <div className="section-divider" aria-hidden />
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}
```

**Notes on the design:**
- `role="button"` + `tabIndex={0}` makes the header keyboard-accessible
  without nesting a `<button>` inside the form structure (which would
  invalidate HTML if a button-containing field were inside).
- `aria-expanded` exposes state to assistive tech.
- The chevron uses `ChevronDown` and is rotated -90° via the existing
  `.section-header.collapsed .chev { transform: rotate(-90deg); }`
  rule in `components.css`. No additional CSS work needed.
- `data-testid` is derived from the title so individual sections are
  test-addressable: `getByTestId("section-emitter-timing")`.
- Resetting on remount is **desired** — when the user selects a
  different emitter, the inspector remounts (or at least its content
  remounts), and all sections snap back to expanded. This is the
  "discoverable on every change" UX the user picked.

### 5.2 Inspector tab restructure

Each of `BasicTab`, `AppearanceTab`, `PhysicsTab` currently renders a
flat list of `<FieldText>` / `<FieldSpinner>` / `<FieldCheckbox>` /
`<FieldSelect>`. B1.2 wraps groups of fields in `<Section>` per the
authoritative groupings.

The field components themselves are unchanged. They already render
`.form-row` with the design source's grid template. The Section
wrapping is purely structural — no field-level CSS or logic changes.

The Name row in `BasicTab` gets a custom inline-style override (the
design's `60px 1fr` template) instead of going through the standard
`<FieldText>` rendering path. See § 5.4.

### 5.3 Field-to-section assignments

These assignments derive from cross-referencing the design source's
`left_panel.jsx` against the legacy `src/UI/Emitter.cpp` to ensure
every shipped field lands in a sensible section.

**BasicTab** (Name row stands alone; rest grouped):

| Section | Fields |
|---|---|
| (no section — top-of-tab) | Name (custom-grid row) |
| Emitter Timing | Initial Delay, Skip time, Freeze time |
| Generation | Use Bursts, Bursts, Burst Delay, Particles/Burst, Particles/Second, Maximum Lifetime, Minimum Lifetime, Random Rotation, Random Rotation Direction, Random Rotation Average, Random Rotation Variance, Initial Position Average, Initial Position Variance |
| Connection | (placeholder — empty for now; the legacy editor's "Connection" section maps to lifetime/death/parent semantics that the new-UI exposes through the tree, not the inspector. If field-set audit reveals genuine fields here, they get added; otherwise this section may not render.) |

Notes:
- The existing Basic tab has ~18 fields wired (per the existing file's
  comment at line 5). Implementation audits each one against this
  grouping and assigns it to its section.
- The "Connection" section's emptiness is fine if confirmed during
  implementation — empty sections simply don't render. The
  implementation rule: if a section has zero fields after the audit,
  don't render the `<Section>` wrapper at all.

**AppearanceTab** (Appearance is unwired in shipped — but the design
defines the structural shape it will take when B2 wires it):

| Section | Fields (per design source) |
|---|---|
| Render | Blend mode, Sort mode, Soft particles, Cast shadows |
| Texture | Atlas frames, Frame rate, Loop mode |
| Color | Tint, Opacity |

**PhysicsTab** (Physics is also unwired):

| Section | Fields (per design source) |
|---|---|
| Forces | Gravity, Drag, Wind X / Y / Z |
| Collision | Collide with world, Bounce, Friction |
| Turbulence | Strength, Frequency |

**Critical scoping note:** B1.2 only adds `<Section>` wrappers where
the tab is *already wired* with real engine fields. Appearance and
Physics are placeholders in shipped code. The placeholder text in each
gets wrapped in a single un-titled section (no section header — just
the placeholder text). The full sectioning structure for Appearance +
Physics lands in **B2** when those tabs are actually wired with real
fields. The structure is documented here for completeness.

### 5.4 Name row treatment

In `BasicTab`, the Name row is rendered as a custom `<div
className="form-row">` with an inline `gridTemplateColumns: "60px
1fr"` override, hosting a `<FieldText>` with the full-width input. The
existing `<FieldText>` component's `<input>` already has
`className="text-input"` and the `.text-input { width: 100% }` rule
from `components.css`, so the input expands to fill the 1fr cell.

The structure mirrors the design source's `left_panel.jsx:100`:
```jsx
<div className="form-row" style={{ gridTemplateColumns: "60px 1fr" }}>
  <span className="lbl">Name</span>
  <input className="text-input" ... />
</div>
```

`FieldText` will need a small option to render in this "compact" mode
(no unit cell, no default grid template). A `wide?: boolean` prop is
the minimum-surface API:
- `wide={true}` → renders the inner `<input>` directly, expecting the
  caller to own the row's container + grid.
- Default (`wide={false}`, current behavior) → unchanged.

Implementation: `FieldText` gets a new optional prop; the default code
path remains the same; the Name row in `BasicTab` becomes:

```tsx
<div className="form-row" style={{ gridTemplateColumns: "60px 1fr" }}>
  <span className="lbl">Name</span>
  <FieldText
    value={properties.name}
    onCommit={(v) => commit({ name: v })}
    wide
  />
</div>
```

Field tests get one new spec asserting the Name row's grid template
overrides the default.

### 5.5 Toolbar revision

In `EmitterTree.tsx`'s `EmitterTreeToolbar`:

**Add Duplicate button** between New ▾ and Delete:
```tsx
<button
  type="button"
  className={TOOLBAR_BTN}
  title="Duplicate"
  aria-label="Duplicate emitter"
  disabled={!hasPrimary}
  onClick={duplicatePrimary}
>
  <Copy className="size-4" />
</button>
```
Where `duplicatePrimary` is:
```tsx
const duplicatePrimary = () => {
  if (primaryId === null) return;
  void bridge.request({ kind: "emitters/duplicate", params: { id: primaryId } });
};
```
The bridge surface `emitters/duplicate` already exists (consumed by the
context-menu Duplicate item). No bridge work.

**Replace Show All / Hide All text spans with icon buttons:**
- Show All becomes `<button className={TOOLBAR_BTN}
  title="Show All Emitters" aria-label="Show all emitters"
  onClick={showAll}><Eye className="size-4" /></button>`.
- Hide All becomes the same pattern with `<EyeOff>` and `hideAll`.

`Copy` is imported from `lucide-react`. `Eye` and `EyeOff` are already
imported. The two text-style spans go away (no className entries
needed any more).

**Final button order** (left-to-right):
1. New ▾ (Menubar trigger; opens dropdown for Root / Lifetime / Death)
2. Duplicate (new)
3. Delete
4. Move Up
5. Move Down
6. Divider span (unchanged)
7. Show All (now icon)
8. Hide All (now icon)

### 5.6 CSS audit

Read `web/apps/editor/src/styles/components.css` and verify these rules
exactly match the design source's `styles.css`:

| Class | Design source value |
|---|---|
| `.inspector` | `padding: 8px 10px 12px;` |
| `.section` | `margin-top: 4px;` |
| `.section-header` | `display: flex; align-items: center; gap: 6px; padding: 8px 2px 6px; font-size: 12px; font-weight: 600; color: var(--text); letter-spacing: 0.1px; cursor: pointer; user-select: none;` |
| `.section-header .chev` | `color: var(--text-3); transition: transform 0.12s;` |
| `.section-header.collapsed .chev` | `transform: rotate(-90deg);` |
| `.section-header:hover` | `color: var(--text);` |
| `.section-divider` | `height: 1px; background: var(--border); margin: 2px 0 6px;` |
| `.form-row` | `display: grid; grid-template-columns: 1fr 92px 56px; align-items: center; gap: 8px; padding: 3px 0; font-size: 12px; color: var(--text-2);` |
| `.form-row .lbl` | `color: var(--text-2); min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;` |
| `.form-row .unit` | `color: var(--text-3); font-size: 11px;` |
| `.form-row.full` | `grid-template-columns: 1fr;` |
| `.text-input` | `background: var(--bg-3); border: 1px solid var(--border-2); border-radius: 4px; height: 22px; padding: 0 8px; color: var(--text); font-size: 12px; font-family: inherit; outline: none; width: 100%;` |

If any rule has drifted in our `components.css` (i.e., differs from
the design source), sync to the design source. If a rule is missing
entirely (e.g., the `.section-*` family), add it.

Also: audit App.tsx's inspector wrapper (the `<div
data-testid="quadrant-property-tabs">` element) and any inner wrapper
for stray Tailwind padding like `p-3` / `px-3` / `py-2` that would
fight the `.inspector` padding. Remove any conflicting Tailwind
padding. The `h-72 shrink-0` height stays unchanged (B1.3 makes it
resizable).

---

## 6. Component impact

Files touched by B1.2 (in expected commit order):

| File | Change | Type |
|---|---|---|
| `web/apps/editor/src/styles/components.css` | Audit + sync `.inspector`, `.section`, `.section-header`, `.section-divider`, `.form-row`, `.text-input` rules against design source `styles.css` (lines 505–608). Add `.section-*` if missing. | Modify |
| `web/apps/editor/src/components/Section.tsx` | New file. ~40 lines. | Create |
| `web/apps/editor/src/components/__tests__/Section.test.tsx` | New file. Tests: open by default, toggle on click, toggle on Enter / Space, aria-expanded reflects state, children hidden when collapsed. | Create |
| `web/apps/editor/src/screens/EmitterPropertyTabs.tsx` | Wrap Basic tab fields in `<Section>` per § 5.3. Wrap Appearance / Physics placeholder text in an untitled `<Section>` (or no Section if placeholder is one line — leave bare). Add Name row's custom-grid override. Add `wide?: boolean` to `FieldText`. | Modify |
| `web/apps/editor/src/screens/__tests__/EmitterPropertyTabs.test.tsx` | Add specs: Name row uses `60px 1fr` template; Basic tab renders three sections with correct titles; sections collapse + expand on click. | Modify |
| `web/apps/editor/src/screens/EmitterTree.tsx` | Add Duplicate button; swap Show All / Hide All text → icon buttons. | Modify |
| `web/apps/editor/src/screens/__tests__/EmitterTree.test.tsx` | Add specs: Duplicate button exists and dispatches `emitters/duplicate`; Duplicate disabled when no primary; Show All / Hide All render as icons not text. | Modify |
| `web/apps/editor/src/App.tsx` | (Maybe) remove conflicting Tailwind padding from the inspector wrapper — pending audit result. | Modify (conditional) |

No bridge schema changes. No C++ changes.

---

## 7. Bridge / mock / test impact

### 7.1 Bridge surface

No new request kinds. No DTO changes. `emitters/duplicate` already
exists (consumed by the context-menu Duplicate item).

### 7.2 MockBridge

No changes.

### 7.3 Test deltas (estimated)

| Suite | Today (post-B1) | Touch | New | Rough end-state |
|---|---|---|---|---|
| Vitest | 239 | ~2-4 (toolbar set assertions in EmitterTree, layout assertions in EmitterPropertyTabs) | +8-12 (Section primitive 5 specs; Name row 1 spec; Section wrapping in BasicTab 3 specs; toolbar Duplicate + icon-swap 2-3 specs) | ~248-251 |
| Playwright | 83 | 0 | 0 | 83 |

---

## 8. Risks + mitigations

1. **`<Section>` remount-on-emitter-change is desirable for state
   reset, but might lose user collapse state during a routine
   selection move.** Selecting emitter A, collapsing "Generation",
   selecting emitter B → A's collapse state is gone. When the user
   returns to A, "Generation" is expanded again.
   *Mitigation:* this is the **chosen** behaviour (session-only, no
   persistence). Documented in § 5.1 with a comment in the Section
   component explaining the trade-off. If real use reveals this is
   too aggressive, the upgrade path is a single `useState` lifted to a
   parent or a small per-tab persistence map.

2. **CSS audit might find drift from the design source's values, but
   those values may have been intentionally adjusted post-Phase 1.**
   *Mitigation:* the audit reads what's currently in
   `components.css` AND compares to the design source. Any divergence
   gets evaluated — if the existing value was an intentional
   adjustment for the new-UI (e.g., for theme contrast in light
   mode), keep it. If it's just drift, sync. The implementation logs
   any decisions made during the audit in the commit message.

3. **The "Connection" section in BasicTab may end up empty** after
   field audit (it maps to the legacy "Connection" group, which in
   the new-UI is exposed via the tree's parent-child structure, not
   per-emitter fields).
   *Mitigation:* implementation rule — empty sections don't render
   the `<Section>` wrapper. The audit step in implementation reports
   which sections ended up with fields and which were dropped.

4. **The Name row's custom grid override is one-off — every other
   form row uses the default `1fr 92px 56px` template.** Establishing
   a `wide?: boolean` prop on `FieldText` is a small API expansion.
   *Mitigation:* the alternative (inlining the row's JSX without
   `FieldText`) duplicates the input + commit logic. The `wide` prop
   is the cleanest extension. If a second wide-text field appears
   later (unlikely for emitter properties; possible elsewhere in the
   app), the prop is already there.

5. **Duplicate button without engine work — but the engine handler's
   undo capture is identical to context-menu Duplicate.** When the
   user clicks the toolbar Duplicate, the dispatcher captures undo +
   does the work + emits tree-changed events. Same path the context
   menu took.
   *Mitigation:* no risk; same bridge path. Test asserts the dispatch
   shape directly.

6. **Show All / Hide All icons reuse the per-row Eye / EyeOff
   icons.** Visual disambiguation comes from context (toolbar vs
   row) + tooltips.
   *Mitigation:* tooltips preserve the full text ("Show All
   Emitters" / "Hide All Emitters"). Visual context is sufficient
   for daily use. If accessibility audit later flags this as
   confusing, the upgrade is a different icon (e.g., `EyeIcon` with
   a subtle `+` overlay for Show All).

7. **Conflicting Tailwind padding in App.tsx may not exist; the
   audit might find nothing to remove.** That's fine — the audit is
   conditional. The spec lists "audit" not "definitely remove".
   *Mitigation:* the spec documents the audit as a verification
   step. If no conflict found, no change needed. The implementation
   reports the audit's outcome.

---

## 9. Testing & verification

### 9.1 Vitest

**New file: `Section.test.tsx`**:
- [ ] Renders with default state (children visible, chevron pointing down).
- [ ] Toggling click on the header collapses (children hidden,
  `.section-header.collapsed` class applied).
- [ ] Pressing Enter when the header is focused toggles.
- [ ] Pressing Space when the header is focused toggles + prevents
  default page scroll.
- [ ] `aria-expanded` reflects state (true when open, false when
  collapsed).

**Updates to `EmitterPropertyTabs.test.tsx`**:
- [ ] Basic tab renders three section headers: "Emitter Timing",
  "Generation", "Connection" (or fewer if Connection is empty —
  spec deferred-decision).
- [ ] Clicking a section header collapses its children.
- [ ] Name row's `<div className="form-row">` carries the custom
  `gridTemplateColumns: "60px 1fr"` inline style.
- [ ] Name field's `<input>` width fills available space (verified
  via `.text-input` class presence; layout pixel asserts on
  computed style are jsdom-flaky and avoided).

**Updates to `EmitterTree.test.tsx`**:
- [ ] Toolbar renders a Duplicate button between New and Delete in
  DOM order (use `compareDocumentPosition` chain).
- [ ] Clicking Duplicate dispatches `emitters/duplicate` with
  primary's id.
- [ ] Duplicate is disabled (`hasAttribute("disabled")`) when no
  primary is selected.
- [ ] Show All / Hide All buttons render the Lucide `Eye` / `EyeOff`
  icon (assert via SVG presence inside the button — testing-library's
  `getByRole("button", { name: "Show all emitters" })` finds it via
  aria-label).
- [ ] Show All / Hide All buttons no longer contain the literal text
  "SHOW" / "HIDE" (negative assertion via `queryByText(/^SHOW$/)`).

### 9.2 Playwright (no changes expected)

No native suite changes needed — B1.2 is React-only.

### 9.3 Manual smoke

- [ ] Launch `x64/Debug/ParticleEditor.exe --new-ui`.
- [ ] Verify Basic tab shows three section headers with chevrons.
- [ ] Click each header — section content collapses + expands;
  chevron rotates.
- [ ] Select a different emitter — all sections snap back to
  expanded (session-only state).
- [ ] Name field input fills available width (compare against
  reference image — should match).
- [ ] Inspector right padding tighter than before; no excessive
  margin between the form's right edge and the panel's right edge.
- [ ] Vertical spacing between form rows feels tighter — eyeball
  test against reference.
- [ ] Tree toolbar has 7 buttons + 1 divider: New ▾, Duplicate,
  Delete, Move Up, Move Down, │, Show All (icon), Hide All (icon).
- [ ] Hover on Show All / Hide All — tooltip reads "Show All
  Emitters" / "Hide All Emitters".
- [ ] Duplicate button is greyed when no emitter selected; click
  with a selection creates a duplicate of the primary.
- [ ] Toggle theme to light — section headers + form rows render
  correctly in light mode.

### 9.4 Legacy regression

- [ ] Launch with `--legacy-ui` — verify legacy left pane is
  unchanged.

### 9.5 Verification gates

1. `pnpm build` clean.
2. Vitest at ~248-251 (depending on whether Connection section ships).
3. Playwright unchanged at 83 / 83.
4. MSBuild Debug x64 clean (no C++ work in B1.2; this is a sanity
   check that nothing else broke).
5. Light + dark theme spot-check.

---

## 10. Open items at spec-write time

None — every brainstorm decision is baked in:

- Click target: entire header row ✓
- Default state: all expanded ✓
- Persistence: session-only ✓
- Toolbar extras: only Duplicate ✓ (per user's multi-select)
- Show All / Hide All disposition: keep on toolbar as icons ✓

---

## 11. Definition of "done" for B1.2

- All files in § 6 modified or created.
- All Vitest specs in § 9.1 added or updated and passing.
- All verification gates in § 9.5 pass.
- Manual smoke checklist in § 9.3 walked through.
- One CHANGELOG entry covering what shipped + how + issues
  encountered.
- HANDOFF.md refreshed.
- Commit on session branch, fast-forward into `lt-4`, push to
  `origin/lt-4` with explicit user OK.

---
