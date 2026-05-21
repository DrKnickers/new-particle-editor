# B1.3.2 — Unify collapsible-section styling via shared CSS class

**Status:** planning — pending user sign-off before execution.

**Started:** 2026-05-22
**HEAD at planning:** `37a99fb` (B1.3.1.1 docs commit, on `origin/lt-4`). Session branch is clean / in sync.
**Goal:** Adopt the Spawner-panel section aesthetic (uppercase, muted, right-chevron, bordered-box) for the inspector tabs by extracting a **shared CSS class** consumed by both `Section.tsx` and `ToolPanel.Section`. Aligns with the project's "reuse classes where possible for maintainability" principle.

**Tech stack:** React + TypeScript + Tailwind v4 + CSS-first (`@theme` + custom utilities in `components.css`).

---

## 1. Goal + scope

### Goal

The inspector tabs (Basic / Appearance / Physics) currently render section headers with one visual treatment (title-case, full-color text, left chevron, flat divider); the Spawner / Lighting / Bloom tool panels render them with another (uppercase, muted text, right chevron, bordered-box). The user wants the Spawner aesthetic everywhere. Rather than restyling `Section.tsx` in place and leaving two parallel implementations, this dispatch **extracts the common visual to a shared CSS class** consumed by both component shapes. Single source of truth; future style tweaks land in one place.

### In scope

1. **Shared CSS** (`web/apps/editor/src/styles/components.css`): new `.panel-section` / `.panel-section-header` / `.panel-section-body` rules covering the bordered-box container, uppercase muted header, right-aligned chevron with rotation. Targets both the controlled `<div>` shape and the native `<details>` shape via two-selector rotation rule.
2. **`Section.tsx` migration**: swap `.section` / `.section-header` / `.section-divider` / `.section-body` → new classes; move chevron from before-title to after-title with `justify-content: space-between`; flip rotation semantics so the chevron points down when expanded; switch the rotation source from a `.collapsed` modifier class to a `data-open={open}` attribute on the outer `.panel-section` element.
3. **`ToolPanel.Section` migration**: drop the inline Tailwind utility classes (`mb-3 rounded-md border …`); consume the shared class; swap ASCII `›` glyph for Lucide `<ChevronDown>` for visual consistency with the inspector side.
4. **Deletion of legacy CSS**: remove `.section`, `.section-header`, `.section-divider`, `.section-body` and the now-stale "20px chevron-aligned indent" comment block; update the `.form-row.name-row` comment that referenced the old indent.
5. **Vitest spec audit** for any selector references to `.section-header` / `.section-body` / `[data-testid^="section-"]` etc. Update spec selectors if needed (likely a trivial data-testid bump if anything).

### Out of scope

- Any change to `Section`'s reset-on-mount state behavior (the `Section.tsx:9-12` comment documents this as intentional — preserved).
- Any change to `ToolPanel.Section`'s native `<details>` state model (browser-managed; preserved).
- Restyling of other inspector surfaces (`.form-row`, axis-cell, panel-header, etc.) — out of scope here, separate dispatch if wanted.
- Lighting / Bloom panel internals beyond the section header (their content rows stay unchanged).
- Width-tuning of the inspector column (B1.4 will make the column draggable; default split stays at 25/75).
- Refactoring `Section` and `ToolPanel.Section` into a single primitive — kept as two thin shells over shared CSS so each can keep its distinct state model. (Convergence at the visual layer; divergence at the state layer.)

---

## 2. What the codebase already gives us

| Surface | Where | What it provides |
|---|---|---|
| Current `Section` component | [`src/components/Section.tsx`](../web/apps/editor/src/components/Section.tsx) | Controlled-by-`useState` collapsible; Lucide `ChevronDown` on left; `role="button"` + `tabIndex` + Enter/Space keyboard + `aria-expanded` + `data-testid` derived from title. Single consumer: `EmitterPropertyTabs.tsx`. |
| Current `ToolPanel.Section` | [`src/components/ToolPanel.tsx:96-129`](../web/apps/editor/src/components/ToolPanel.tsx) | Native `<details>` collapsible; ASCII `›` glyph rotating 90° on open; uppercase 11px muted title via inline Tailwind. Consumers: Spawner, Lighting, Bloom. |
| Legacy section CSS | [`src/styles/components.css:444-478`](../web/apps/editor/src/styles/components.css) | `.section`, `.section-header`, `.section-divider`, `.section-body` rules plus the 20px chevron-alignment indent comment. Inspector-only today. |
| Design tokens | `src/styles/tokens.css` | `--border`, `--bg-2`, `--text`, `--text-2`, `--text-3` — already cover everything the bordered-box + uppercase-muted style needs. No new tokens required. |
| Lucide `ChevronDown` | Already imported by `Section.tsx` | Reused as the unified chevron icon. Removes ASCII `›` from `ToolPanel.Section`. |
| Vitest test setup | `src/test-setup.ts` | ResizeObserver / matchMedia / localStorage stubs in place. No new stubs needed. |
| Existing inspector specs | `src/screens/__tests__/EmitterPropertyTabs*.test.tsx` etc. | Anchor on `getByText("Emitter Timing")` etc. — text content stays the same (uppercase via CSS, not JSX), so these specs survive without changes. |
| Existing Spawner / Lighting / Bloom specs | `src/screens/__tests__/SpawnerPanel.test.tsx` etc. | Anchor on `getByText` for section titles too. Same survival argument. |

Per `grep`, `Section` is consumed only by [`EmitterPropertyTabs.tsx`](../web/apps/editor/src/screens/EmitterPropertyTabs.tsx) — clean restyle.

---

## 3. Architecture / implementation approach

### Phase 1 — Shared CSS

Add to [`components.css`](../web/apps/editor/src/styles/components.css) (replacing the legacy `.section-*` rules):

```css
/* Collapsible section primitive — shared by Section.tsx (controlled via
 * useState + data-open) and ToolPanel.Section (native <details>). The
 * rotation rule covers both state representations so each consumer
 * keeps its own state model while sharing the visual. */
.panel-section {
  border: 1px solid var(--border);
  background: var(--bg-2);
  border-radius: 6px;
  margin-bottom: 12px;
}

.panel-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-2);
  cursor: pointer;
  user-select: none;
  outline: none;
}
/* Hide native <details> disclosure marker on Blink/Webkit + everywhere else. */
.panel-section-header::-webkit-details-marker { display: none; }
.panel-section-header { list-style: none; }

.panel-section-header:hover { color: var(--text); }
.panel-section-header:focus-visible { color: var(--text); }

.panel-section-header .chev {
  color: var(--text-3);
  flex-shrink: 0;
  transition: transform 0.12s;
}
/* Two selectors cover both consumer shapes: `[data-open="false"]` for the
 * controlled <div> in Section.tsx; `:not([open])` for native <details>. */
.panel-section[data-open="false"] .chev,
.panel-section:not([open]) .chev {
  transform: rotate(-90deg);
}

.panel-section-body {
  padding: 12px;
}
```

Drop the legacy `.section`, `.section-header`, `.section-divider`, `.section-body` rules entirely. Update the `.form-row.name-row` comment that referenced the "20px chevron indent" — the new sections have their own internal `padding: 12px` so the name row's prior alignment story changes (the name row sits OUTSIDE any section, so it now uses 12px from the panel edge for consistency; verify visually).

### Phase 2 — `Section.tsx` migration

```tsx
export function Section({ title, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = () => setOpen((o) => !o);
  return (
    <div className="panel-section" data-open={open}>
      <div
        className="panel-section-header"
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
        <span>{title}</span>
        <ChevronDown className="chev size-3" />
      </div>
      {open && <div className="panel-section-body">{children}</div>}
    </div>
  );
}
```

Changes from current shape:
- Outer `<div>` becomes `.panel-section` with `data-open={open}` attribute (replaces the `.collapsed` modifier class).
- Header is `.panel-section-header` instead of `.section-header`.
- Chevron moves AFTER the title `<span>` (right side, `justify-content: space-between` does the rest).
- `.section-divider` `<div>` removed (the bordered-box header's `border-bottom` from `.panel-section-header` handles the separation).
- Body is `.panel-section-body` instead of `.section-body`.
- Same `role="button"`, `tabIndex={0}`, keyboard handler, `aria-expanded`, `data-testid` — vitest specs and a11y unaffected.

### Phase 3 — `ToolPanel.Section` migration

```tsx
function ToolPanelSection({
  title,
  defaultOpen = false,
  alwaysOpen = false,
  children,
}: ToolPanelSectionProps) {
  if (alwaysOpen) {
    return (
      <section className="panel-section">
        <div className="panel-section-header" style={{ cursor: "default" }}>
          {title}
        </div>
        <div className="panel-section-body">{children}</div>
      </section>
    );
  }
  return (
    <details className="panel-section" open={defaultOpen}>
      <summary className="panel-section-header">
        <span>{title}</span>
        <ChevronDown className="chev size-3" />
      </summary>
      <div className="panel-section-body">{children}</div>
    </details>
  );
}
```

Changes from current shape:
- Outer `<details>` / `<section>` gets `.panel-section` (replaces inline `mb-3 rounded-md border …`).
- Header `<summary>` / `<div>` gets `.panel-section-header` (replaces inline `flex cursor-pointer …`).
- Chevron switches from ASCII `›` to Lucide `<ChevronDown>` — visual unification with the inspector side.
- Body `<div>` gets `.panel-section-body` (replaces inline `space-y-2 p-3`).
- The `alwaysOpen` branch (used by sections like Lighting's Ambient / Shadow that don't collapse) renders without a chevron and with `cursor: default` override on the header. The `<section>` element naturally lacks the `open` attribute, so the rotation selector won't trigger on it — but there's no chevron to rotate either, so safe.

Note: lose the `space-y-2` rhythm between items inside ToolPanel.Section's body. The current Spawner spec for vertical rhythm may want a follow-up `.panel-section-body > * + * { margin-top: 8px }` (or similar). **Decide during smoke-test** — if rows feel too tight without `space-y-2`, add a body-child margin rule to the shared CSS.

### Phase 4 — Delete legacy CSS

Remove from `components.css`:

- `.section { … }`
- `.section-header { … }` + `.section-header .chev` + `.section-header.collapsed .chev` + `.section-header:hover` 
- `.section-divider { … }`
- `.section-body { padding-left: 20px; padding-right: 12px; }`
- The "Inspector contents indent" comment block (24-ish lines explaining the 20px chevron-alignment).

Update the `.form-row.name-row` comment in the same file — it references the deleted 20px indent. New behavior: Name row sits at the panel's natural left edge (12px from `.panel-body`'s padding); section bodies start their inner padding at 12px from the `.panel-section` border. Verify visually that this still reads cleanly; if it looks misaligned, add a small `.form-row.name-row { padding-left: 12px }` to match.

### Phase 5 — Test audit + adjust

Pre-flight grep:

```bash
grep -rn "section-header\|section-body\|\.section[ \"'>]" web/apps/editor/src/
```

For each hit:
- CSS rules in `components.css` — deleted by Phase 4.
- TSX class consumers — covered by Phase 2 / 3.
- Vitest selectors — if any spec queries `.section-header` directly (`container.querySelector('.section-header')` etc.), update to `.panel-section-header`.
- Playwright selectors — same audit on `tests/`.

The `[data-testid="section-…"]` selector on the inspector survives unchanged (the data-testid logic in `Section.tsx` stays).

---

## 4. Risks named up front + mitigations

1. **Width pressure on the inspector at narrow column widths.**
   - **Hazard:** Each section gains ~14px of horizontal cost from the 1px border + 12px inner padding × 2. The inspector column at the default 25/75 split is ~25% of the workspace minus the left tree pane — roughly 250-300px in a typical window. The current `.form-row` grid (`1fr 58px 40px`) was tuned for the no-border layout; the inner-width shrink may push spinner cells against unit suffixes.
   - **Mitigation:** Visual smoke-test the inspector at default and minimum realistic column widths before committing. If form rows truncate or wrap, tune `.panel-section-body` padding down (e.g. `8px` instead of `12px`) or adjust the `.form-row` grid columns. Worst case: keep the bordered visual but drop the body padding to match the legacy chevron-aligned width.

2. **Spawner / Lighting / Bloom visual regression.**
   - **Hazard:** Migrating `ToolPanel.Section`'s inline Tailwind to shared CSS changes the precise pixel padding, color, and chevron glyph. A pre-shipping panel that worked might pixel-shift. Particularly Lighting (which uses the `alwaysOpen` branch for Ambient / Shadow) — the inline Tailwind included `border-b border-border` on the alwaysOpen header that we'd replicate via the shared CSS, but the body's `space-y-2 p-3` rhythm doesn't carry over.
   - **Mitigation:** Side-by-side screenshot diff each tool panel before/after. If `space-y-2` is load-bearing, add `.panel-section-body > * + * { margin-top: 8px }` to the shared CSS. If the alwaysOpen path needs different padding, add a `.panel-section[data-always-open] .panel-section-header { padding: …; cursor: default }` modifier and set it from the `alwaysOpen` branch.

3. **Vitest selector collisions.**
   - **Hazard:** Specs that grep on `.section-*` selectors break when the classes are renamed. Pre-flight grep in §3 Phase 5 catches them, but the audit must actually run.
   - **Mitigation:** Run `grep -rn "section-header\|section-body" web/apps/editor/src/__tests__ web/apps/editor/tests` before TSX changes; update selectors as the first sub-step of Phase 5. Vitest 281/281 must hold post-migration; any failure means an audit gap.

4. **`<details>` indent / inset quirk.**
   - **Hazard:** Native `<summary>` elements have an inner indent for the disclosure marker. `list-style: none` plus the Webkit pseudo-marker hide cover the visible glyph, but some browsers still reserve a small inset before the summary's content box (~15px). On Chrome/WebView2 specifically, `summary { padding: 0 }` may not be enough — needs `display: flex` on the summary to override the default `display: list-item`.
   - **Mitigation:** `.panel-section-header` already declares `display: flex` which overrides `list-item`. Verify by inspecting in WebView2's DevTools post-migration; if a leading inset persists, add an explicit `margin-left: 0; padding-inline-start: 12px` to the summary.

5. **Chevron icon swap regression in Spawner.**
   - **Hazard:** Spawner users (= the user) are accustomed to the ASCII `›` chevron rotating 90° on open. The migration to Lucide `<ChevronDown>` rotates -90° on close. Same visual semantics (chevron points right when collapsed, down when expanded) but a slightly different glyph shape.
   - **Mitigation:** Confirm during smoke-test that the Lucide chevron at `size-3` (12px) renders crisply at the Spawner's typical font size. If it looks worse, revert to ASCII `›` in the shared CSS — both shapes have equivalent rotation behavior so either works; the unification target is the *position*, not the glyph.

6. **Visual rhythm loss in tool-panel bodies.**
   - **Hazard:** `ToolPanel.Section` currently applies `space-y-2` to its body (8px gap between direct children). The shared `.panel-section-body { padding: 12px }` doesn't include child-margin rules, so consumers like Spawner's vertical Vec3 row stack may collapse to touching siblings.
   - **Mitigation:** Add `.panel-section-body > * + * { margin-top: 8px }` to the shared CSS upfront — matches the existing Tailwind `space-y-2` semantic and applies uniformly to both consumers. The inspector tabs use `.form-row` which has its own grid layout, so a sibling margin won't conflict.

7. **Plan-deviation discovery during execution.**
   - **Hazard:** Any of the above mitigations may need to land as a sub-task during execution rather than as a clean upfront change. The dispatch could end up touching more lines than estimated.
   - **Mitigation:** If a risk fires beyond a 5-minute fix, STOP and re-plan per CLAUDE.md's "if something goes sideways, STOP and re-plan" guidance. Better to capture the divergence in the plan than to soldier on against shifted assumptions.

---

## 5. Testing & verification

### Pre-flight (before any code change)

- [ ] Confirm baseline green: vitest 281/281, Playwright 83/83, MSBuild Debug x64 clean.
- [ ] Grep audit: `grep -rn "section-header\|section-body\|\.section[ \"'>]" web/apps/editor/src/ web/apps/editor/tests/` — produces the complete list of selectors that will need updates.

### Per-phase verification

- [ ] After Phase 1 (shared CSS added, legacy CSS still in place): nothing visible yet. `pnpm build` clean.
- [ ] After Phase 2 (`Section.tsx` migrated): launch the editor, open the inspector tabs, confirm sections render with bordered-box + uppercase title + right chevron. No regression in the test counts. Spawner UNCHANGED at this point.
- [ ] After Phase 3 (`ToolPanel.Section` migrated): Spawner / Lighting / Bloom now also use the shared class. Confirm all three render with the same visual as the inspector tabs.
- [ ] After Phase 4 (legacy CSS deleted): full regression sweep — every panel that previously consumed `.section-*` must now look correct. The inspector + the tool panels are the only consumers; verify both.
- [ ] After Phase 5 (test audit complete): vitest 281/281, Playwright 83/83 — same counts as baseline.

### Manual smoke-test checklist (per L-013 / CLAUDE.md pre-handoff discipline)

- [ ] Inspector → Basic tab: 3 sections (Emitter Timing / Generation / Connection), all collapsible, render uppercase muted titles with right chevron, bordered-box container, no overflow against the form-row spinners at the default 25/75 column split.
- [ ] Inspector → Appearance tab: 5 sections (Textures / Random color / Tail / Rotation / Rendering).
- [ ] Inspector → Physics tab: 4 sections (Initial position / Initial speed / Acceleration / Ground interaction).
- [ ] Spawner pane: 5 sections (Position / Velocity / Lifetime / Jitter position / Jitter velocity), all render same visual as the inspector tabs. Lifetime stays alwaysOpen (no chevron).
- [ ] Lighting panel: Sun / Fill 1 / Fill 2 / Ambient / Shadow sections all render correctly. alwaysOpen branches (Ambient / Shadow) render without chevron.
- [ ] Bloom panel: section structure preserved.
- [ ] Keyboard: Tab focus moves into each section header; Enter / Space toggles collapse; focus indicator visible.
- [ ] At minimum realistic inspector column width (drag the eventual splitter, or just narrow the window): form rows still fit, no horizontal scroll.
- [ ] Modal-over-engine: open Help → About while inspector is visible behind. Sections in the inspector should be visible (dimmed by Dialog.Overlay's `bg-black/60`) and the frosted-glass backdrop from B1.3.1.1 still works. The new bordered-box style should integrate cleanly with the dim — no harsh borders showing through.

### Cleanup

- [ ] No dead CSS (`grep -n "section-header\|section-divider\|section-body" components.css` returns zero hits in the rules section, only the deletion-history comment if any).
- [ ] No orphaned references to the old class names anywhere in `src/`.

---

## 6. Implementation steps

- [ ] **P1 — Pre-flight.** Baseline verification + grep audit. Confirm `Section.tsx` has exactly one consumer.
- [ ] **P2 — Shared CSS.** Add `.panel-section` / `.panel-section-header` / `.panel-section-body` + child-margin rule + rotation selectors to `components.css`. Legacy `.section-*` rules STAY in this commit — no consumer touches them yet.
- [ ] **P3 — `Section.tsx` migration.** Swap class names, move chevron to right, switch from `.collapsed` modifier to `data-open` attribute. `pnpm build` + vitest. Manual smoke-test the inspector tabs visually.
- [ ] **P4 — `ToolPanel.Section` migration.** Replace inline Tailwind utilities with shared classes; swap ASCII `›` for Lucide `<ChevronDown>`. `pnpm build` + vitest + Playwright. Manual smoke-test Spawner / Lighting / Bloom.
- [ ] **P5 — Legacy CSS deletion.** Remove `.section`, `.section-header`, `.section-divider`, `.section-body` rules from `components.css`; update the `.form-row.name-row` comment. `pnpm build` + vitest + Playwright. Visual smoke-test once more to confirm nothing slipped.
- [ ] **P6 — Test selector updates** (if any surfaced in P1 grep). Most likely none.
- [ ] **P7 — Docs.** CHANGELOG entry describing the unification. ROADMAP doesn't need touching (no [TIER-K] tag for this polish-style change). HANDOFF refresh on session-end.
- [ ] **P8 — FF + push** when user signs off.

**Commit slicing:** one focused commit covering P2-P6 (CSS addition + both component migrations + legacy deletion + test updates) — they're internally coherent and shouldn't be bisected separately. Plus a docs commit (P7) on top. Two commits total.

**Estimated effort:** ~1-2 hours, ~100 lines net (60 CSS + 30 TSX + 10 deletions).

---

## Review (filled in during execution)

**Status:** ✅ shipped on session branch `claude/bold-volhard-e0e0f0`, pending FF to `origin/lt-4`.

**Commits landed (2):**

| Commit | Phase | Summary |
|---|---|---|
| [`65a5eae`](https://github.com/DrKnickers/new-particle-editor/commit/65a5eae) | P2+P3+P4+P5+P6 squashed | Shared `.panel-section` CSS + Section.tsx migration + ToolPanel.Section migration + legacy CSS deletion + test-selector update — landed as one focused implementation commit. 15 inspector polish items folded in across three smoke-test rounds. |
| `TODO-HASH` | P7 | Docs (CHANGELOG + HANDOFF + todo.md review). |

**Plan deviations:**

- **Single commit instead of "one impl + one docs" upfront slicing.** The plan said P2 keeps legacy CSS in place; I rolled the deletion into the same commit because the legacy `.section-*` rules and the new `.panel-section-*` rules can't coexist without consumer-side switching, and the consumer (Section.tsx) switches in the same commit. Three intermediate states (legacy CSS + old consumer / both CSS / new CSS + new consumer / new CSS only) didn't have intermediate utility. The actual progression was: edit components.css (legacy → shared), edit Section.tsx, edit ToolPanel.tsx, edit Section.test.tsx, single commit.
- **Polish items folded in.** The plan was strictly the section-header unification (Out of scope: any restyling beyond the section header). When the user smoke-tested the unification, they surfaced 8 polish items in round 1; I executed them. The user then surfaced 5 more in round 2; I executed those too. And then 2 alignment-fix iterations in round 3. All folded into the same commit because they touch the same files (components.css + EmitterPropertyTabs.tsx + SpawnerPanel.tsx) and the same conceptual surface (inspector visual polish). Per CLAUDE.md "if something goes sideways, STOP and re-plan" — but these weren't structural shifts, just visual fine-tuning; the dispatch shape didn't need to change.
- **Three smoke-test rounds, not one.** Original plan §5 expected one smoke-test pass. Actual was three: (1) initial unification + first 8 polish items pass; (2) second-round widening / RGBA layout changes; (3) third-round checkbox right-edge alignment (two attempts — first aligned to unit-cell right edge, second corrected to spinner-input right edge per user clarification). Each round took ~5 minutes of edit + verify + smoke-test.

**Risks status:**

- §4.1 Width pressure — didn't fire. Section bordered-box at the default 25/75 inspector split fits all form rows cleanly. Body padding stayed at 12 px (the plan's mitigation of dropping to 8 px wasn't needed).
- §4.2 Spawner / Lighting / Bloom visual regression — didn't fire. Migration from inline Tailwind to shared CSS rendered visually identical (modulo the deliberate Lucide chevron swap). User's smoke-test of the Spawner showed it consistent with the inspector tabs.
- §4.3 Vitest selector collisions — partial fire. The pre-flight grep audit caught `.section-divider` (kept as standalone) but missed the `.collapsed` modifier-class assertion in Section.test.tsx (which is a JS string, not a CSS selector). Caught by post-migration vitest run; fix was one assertion rewrite. **Procedural takeaway** worth carrying forward: grep for modifier-class names as JS strings too, not just as CSS selectors.
- §4.4 `<details>` indent quirk — didn't fire. `display: flex` + `list-style: none` + `::-webkit-details-marker { display: none }` together fully suppress the native disclosure marker on Chrome/WebView2.
- §4.5 Chevron icon swap regression in Spawner — didn't fire. User's smoke-test accepted the Lucide chevron at `size-3` as visually equivalent.
- §4.6 Visual rhythm loss in tool-panel bodies — didn't fire. The shared `.panel-section-body > * + * { margin-top: 8px }` rule preserves Spawner's previous `space-y-2` semantics.

**Test counts:**

- vitest **281 / 281** (no count change — Section.test.tsx's "collapsed state" assertion reshaped from class-presence to attribute-presence)
- Playwright **83 / 83**
- MSBuild Debug x64 clean (no C++ touched)

**Cleanup performed:**

- Legacy `.section`, `.section-header`, `.section-divider` rules deleted from components.css.
- `.section-divider` retained as standalone hairline primitive (used by `CurveEditorPanel.tsx:1138`).
- ASCII `›` glyph removed from `ToolPanel.Section`; Lucide ChevronDown used everywhere.
- CHANGELOG entry added at top.
- HANDOFF refreshed for next session.

**Procedural patterns worth carrying:**

- **Folding polish into the same dispatch.** Three rounds of smoke-test-surfaced polish (8 + 5 + 2 items) all landed in the same commit because they touch the same files and the same conceptual surface. Mid-session smoke-test-driven iteration is a high-yield shape for inspector visual work; the alternative (separate "polish" dispatches per round) would have produced ~3 commits with no architectural difference.
- **Grep audits for class-rename dispatches: include modifier-class JS string references.** The `.collapsed` miss in pre-flight grep was a one-line oversight that cost a one-line test fix — cheap to recover but cheaper to anticipate. Future dispatch checklists: grep for the modifier class name as a JS string, in addition to grep for it as a CSS selector.
- **Width-boost prop scaffolding scales linearly.** Adding `widthBoost?: "mid" | "wide" | "x2"` to FieldSelect + FieldSpinner gave us 6 distinct width variants (default 58, mid 73, wide 87, x2 116; plus the Basic-tab-scoped 73) without proliferating per-call props. The CSS modifier-class pattern (`form-row-mid-input` etc.) matches the existing modifier family (`.full`, `.name-row`, `.form-row-cluster`, `.form-row-text`).
- **Checkbox right-edge alignment via `grid-column: 2; justify-self: end`.** Single CSS rule pins every checkbox's right edge to the spinner-input column right edge across every form-row width variant — the alignment is structural, not per-case. The `grid-column: 2 / -1` first attempt aligned to a different column (unit cell right edge); the one-character swap to `grid-column: 2` corrected to the spinner column right edge. Worth remembering as the canonical pattern for "align this single-cell content to the right of a multi-cell row layout."
