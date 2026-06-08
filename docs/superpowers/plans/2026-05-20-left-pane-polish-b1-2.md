# Left-pane polish (B1.2) implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the left pane's interior fidelity closer to the design reference — collapsible section headers in each inspector tab, tighter form-row spacing, full-width Name input, revised tree toolbar (Duplicate added; Show All / Hide All become icons), and a CSS audit syncing against the design source's `styles.css`.

**Architecture:** Two new surfaces — a tiny `Section` component (entire-header-clickable collapsible, session-only state) and a small `wide?: boolean` extension to `FieldText` so the Name row can use the design's custom `60px 1fr` grid. Inspector tabs gain section wrapping; tree toolbar gains a Duplicate button and converts Show All / Hide All to Lucide icons. CSS audit + sync against `styles.css` values.

**Tech Stack:** TypeScript + React 18 + Vitest + @testing-library/react. Lucide icons (already used in this file). `components.css` design tokens. No bridge schema changes, no C++ changes.

**Predecessor spec:** [docs/superpowers/specs/2026-05-20-left-pane-polish-b1-2-design.md](../specs/2026-05-20-left-pane-polish-b1-2-design.md)

**Target branch:** `lt-4`. FF from current session branch at end. `--legacy-ui` path is untouched.

---

## File structure (responsibilities)

| File | Role in B1.2 | Status |
|---|---|---|
| `web/apps/editor/src/styles/components.css` | CSS audit + sync `.inspector`, `.section`, `.section-header`, `.section-divider`, `.form-row`, `.text-input` rules against design source `styles.css` (lines 505–608). Add `.section-*` family if missing. | Modify |
| `web/apps/editor/src/App.tsx` | Audit inspector wrapper for stray Tailwind padding conflicting with `.inspector`. | Modify (conditional, ≤1 line) |
| `web/apps/editor/src/components/Section.tsx` | New `Section` primitive: collapsible header (entire row clickable + keyboard accessible), chevron, session-only state. | Create |
| `web/apps/editor/src/components/__tests__/Section.test.tsx` | Vitest specs for the Section component. | Create |
| `web/apps/editor/src/screens/EmitterPropertyTabs.tsx` | Wrap BasicTab fields in `<Section>`. Add Name row's custom `60px 1fr` grid override. Add `wide?: boolean` to `FieldText`. Appearance/Physics placeholders unchanged. | Modify |
| `web/apps/editor/src/screens/__tests__/EmitterPropertyTabs.test.tsx` | Add specs: Name row's custom grid, BasicTab section headers rendered, sections collapse on click. | Modify |
| `web/apps/editor/src/screens/EmitterTree.tsx` | Add Duplicate button between New ▾ and Delete. Replace Show All / Hide All text labels with Lucide `Eye` / `EyeOff` icon buttons. | Modify |
| `web/apps/editor/src/screens/__tests__/EmitterTree.test.tsx` | Add specs: Duplicate button position, dispatch, disabled-state; Show/Hide icon-not-text. | Modify |
| `ROADMAP.md` | (No change anticipated — B1.2's roadmap candidates from spec § 3.3 are minor enough to file inline if real use surfaces them.) | (No change) |
| `CHANGELOG.md` | Add B1.2 entry following partial-backfill convention. | Modify |
| `tasks/HANDOFF.md` | Refresh test counts + what landed + next moves. | Modify |

No new files outside of the Section component + its test. No bridge schema changes. No C++ changes.

---

## Pre-flight check (do this once before Task 1)

- [ ] **Confirm starting state.** From the worktree root:

  ```
  git status
  git log --oneline lt-4..HEAD
  ```

  Expected: working tree clean. `lt-4..HEAD` shows two commits: `85503ae docs(LT-4): brainstorm spec — left-pane polish (B1.2)` plus any prior session commit that hasn't been FF'd. If `lt-4..HEAD` count differs, stop and reconcile.

- [ ] **Run baseline gates** to confirm green starting state:

  ```
  cd web/apps/editor
  pnpm install                                  # may re-inject allowBuilds (L-005)
  pnpm build                                    # 0 errors
  pnpm test --reporter=basic                    # 239 / 239 (B1's final count)
  ```

  If any gate is red, stop and investigate before touching code.

- [ ] **C++ binary not required for B1.2.** This is React-only. Skip MSBuild unless you want a sanity check.

---

## Task 1: CSS audit + sync against design source

**Why first:** The Section component (Task 2) consumes `.section`, `.section-header`, `.section-divider` CSS rules from `components.css`. If those rules are missing or drifted from the design source, Section will render with broken styling. Land the CSS sync first so subsequent tasks have correct styling to consume.

**Files:**
- Modify: `web/apps/editor/src/styles/components.css` — audit + sync rules.
- Modify (conditional): `web/apps/editor/src/App.tsx` — remove conflicting Tailwind padding on the inspector wrapper if found.

### Steps

- [ ] **Step 1: Audit `components.css`.**

  Open `web/apps/editor/src/styles/components.css` and search for these selectors. For each, compare the body against the design source's `styles.css` (lines 505–608, available at `C:\Users\antho\AppData\Local\Temp\nu-particle-editor\nuparticle-editor\project\styles.css`).

  | Selector | Design source value |
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

  For each rule that exists in our `components.css`:
  - If it matches the design source exactly → no change.
  - If it has drifted → sync. Record the drift in a note for the commit message.

  For each rule that does NOT exist in our `components.css`:
  - Add it verbatim from the design source.

  The `.section-*` family is most likely missing entirely (Phase 1 ported the design's `components.css` but the spec notes don't explicitly confirm `.section-*` rules made it in). Add them at the end of the section that handles inspector/form styling.

- [ ] **Step 2: Audit App.tsx's inspector wrapper.**

  Open `web/apps/editor/src/App.tsx` and find the element with `data-testid="quadrant-property-tabs"`. Its current className (post-B1) is `h-72 shrink-0`. Verify there are no conflicting Tailwind padding utilities like `p-3`, `px-2`, etc. on this element OR on its parent (`<div className="panel-body ...">`).

  If you find a conflicting padding utility (Tailwind padding inside the inspector wrapper or its parent that would compete with `.inspector { padding: 8px 10px 12px }`), remove just the Tailwind padding token. **Do NOT remove other classes** like `h-72`, `shrink-0`, `flex`, `min-h-0`, `flex-col`, or `overflow-hidden`.

  If no conflict is found, no App.tsx change is needed.

- [ ] **Step 3: Verify the build + suite are still green.**

  This task makes no behavioral changes, so all 239 specs should still pass:

  ```
  cd web/apps/editor
  pnpm build
  pnpm test --reporter=basic
  ```

  Expected: 0 TS errors. 239/239 passing.

  If anything breaks, the most likely cause is removing a Tailwind padding token that other code transitively depended on. Restore the change and reconsider.

- [ ] **Step 4: Commit.**

  ```bash
  git add web/apps/editor/src/styles/components.css web/apps/editor/src/App.tsx
  git commit -m "$(cat <<'EOF'
  chore(LT-4): sync inspector + form-row + section CSS against design source

  Phase 1 imported the design source's components.css but the
  .section-* family of rules wasn't fully ported. B1.2's Section
  primitive (Task 2) consumes those rules, so land the CSS sync
  first so Section renders with the correct chevron rotation,
  section-divider hairline, and hover state.

  Also adds .form-row.full for the Name row's full-width input
  variant (Task 3), and confirms .inspector + .form-row + .text-input
  values match the design source's styles.css (lines 505-608) for
  visual fidelity against the reference.

  If found, removes conflicting Tailwind padding on the App.tsx
  inspector wrapper that would compete with .inspector's own
  padding. No behaviour changes; vitest 239/239 still green.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

  If App.tsx wasn't modified, only stage `components.css`.

---

## Task 2: Create the `Section` component (TDD)

**Why second:** Section is the foundation that Task 3 wires into BasicTab. Land it standalone with its own tests so its contract is clear before consumers depend on it.

**Files:**
- Create: `web/apps/editor/src/components/Section.tsx`
- Create: `web/apps/editor/src/components/__tests__/Section.test.tsx`

### Steps

- [ ] **Step 1: Write the failing test file.**

  Create `web/apps/editor/src/components/__tests__/Section.test.tsx` with these specs:

  ```tsx
  import { describe, it, expect } from "vitest";
  import { render, screen, fireEvent } from "@testing-library/react";
  import { Section } from "../Section";

  describe("Section", () => {
    it("renders open by default with children visible", () => {
      render(<Section title="Emitter Timing"><div>child</div></Section>);
      expect(screen.getByText("Emitter Timing")).toBeInTheDocument();
      expect(screen.getByText("child")).toBeInTheDocument();
    });

    it("clicking the header collapses the section (children hidden)", () => {
      render(<Section title="Generation"><div>child</div></Section>);
      const header = screen.getByTestId("section-generation");
      fireEvent.click(header);
      expect(screen.queryByText("child")).not.toBeInTheDocument();
    });

    it("clicking again expands the section back", () => {
      render(<Section title="Forces"><div>child</div></Section>);
      const header = screen.getByTestId("section-forces");
      fireEvent.click(header);
      fireEvent.click(header);
      expect(screen.getByText("child")).toBeInTheDocument();
    });

    it("pressing Enter on the focused header toggles", () => {
      render(<Section title="Render"><div>child</div></Section>);
      const header = screen.getByTestId("section-render");
      fireEvent.keyDown(header, { key: "Enter" });
      expect(screen.queryByText("child")).not.toBeInTheDocument();
    });

    it("pressing Space on the focused header toggles", () => {
      render(<Section title="Texture"><div>child</div></Section>);
      const header = screen.getByTestId("section-texture");
      fireEvent.keyDown(header, { key: " " });
      expect(screen.queryByText("child")).not.toBeInTheDocument();
    });

    it("aria-expanded reflects open/closed state", () => {
      render(<Section title="Color"><div>child</div></Section>);
      const header = screen.getByTestId("section-color");
      expect(header).toHaveAttribute("aria-expanded", "true");
      fireEvent.click(header);
      expect(header).toHaveAttribute("aria-expanded", "false");
    });

    it("collapsed state applies the .collapsed class for chevron rotation", () => {
      render(<Section title="Collision"><div>child</div></Section>);
      const header = screen.getByTestId("section-collision");
      expect(header.className).not.toContain("collapsed");
      fireEvent.click(header);
      expect(header.className).toContain("collapsed");
    });

    it("respects defaultOpen=false", () => {
      render(<Section title="Turbulence" defaultOpen={false}><div>child</div></Section>);
      expect(screen.queryByText("child")).not.toBeInTheDocument();
      const header = screen.getByTestId("section-turbulence");
      expect(header).toHaveAttribute("aria-expanded", "false");
    });
  });
  ```

- [ ] **Step 2: Run — expect failure.**

  ```
  cd web/apps/editor
  pnpm vitest run src/components/__tests__/Section.test.tsx --reporter=basic
  ```

  Expected: FAIL with "Cannot find module '../Section'" (component doesn't exist yet). All 8 specs fail at the import step.

- [ ] **Step 3: Create the Section component.**

  Create `web/apps/editor/src/components/Section.tsx` with this exact content:

  ```tsx
  // Section — collapsible header for inspector tabs.
  //
  // Entire header row is clickable (per user spec — bigger hit target
  // than chevron-only). Keyboard accessibility via role="button" +
  // tabIndex={0} + onKeyDown handling Enter / Space. Space gets
  // preventDefault to suppress page scroll.
  //
  // State is local + session-only — defaults to defaultOpen=true on
  // every mount. The inspector remounts when the user selects a
  // different emitter, which intentionally resets every section to
  // its default state. If state persistence becomes desirable later,
  // the upgrade path is a single lifted useState or a per-tab
  // persistence map.

  import { useState, type ReactNode } from "react";
  import { ChevronDown } from "lucide-react";

  type Props = {
    title: string;
    defaultOpen?: boolean;
    children: ReactNode;
  };

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

- [ ] **Step 4: Re-run the test file — expect pass.**

  ```
  pnpm vitest run src/components/__tests__/Section.test.tsx --reporter=basic
  ```

  Expected: PASS. All 8 specs green.

- [ ] **Step 5: Sanity check + commit.**

  ```
  pnpm build
  pnpm test --reporter=basic
  ```

  Expected: 0 TS errors. 247/247 (was 239 + 8 new).

  ```bash
  git add web/apps/editor/src/components/Section.tsx \
          web/apps/editor/src/components/__tests__/Section.test.tsx
  git commit -m "$(cat <<'EOF'
  feat(LT-4): Section primitive for collapsible inspector groupings

  New component at src/components/Section.tsx. Renders a header row
  (entire row clickable + Enter / Space when focused) with chevron
  icon and a section-divider hairline. Local useState; defaults to
  defaultOpen=true on every mount. No localStorage — session-only
  state per spec.

  The intentional reset-on-mount behaviour means switching emitters
  in the tree re-expands every section. Trade-off documented in the
  component's leading comment.

  Test count: 239 → 247 (+8 new specs covering default state,
  click toggle, keyboard activation, aria-expanded, collapsed
  className, defaultOpen=false).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 3: Wire Sections into BasicTab + Name row custom grid + FieldText `wide` prop

**Why third:** The Section primitive is ready. This task is the main visual restructure — wraps existing BasicTab fields into three sections, adds the Name row's custom grid override, and extends `FieldText` with the `wide?: boolean` prop. This is the largest single commit in B1.2.

**Files:**
- Modify: `web/apps/editor/src/screens/EmitterPropertyTabs.tsx`
- Modify: `web/apps/editor/src/screens/__tests__/EmitterPropertyTabs.test.tsx`

### Steps

- [ ] **Step 1: Add failing specs to `EmitterPropertyTabs.test.tsx`.**

  Find the existing `describe` block for the Basic tab (the file already has BasicTab specs). Append the following inside that describe:

  ```tsx
    it("BasicTab renders three section headers in order: Emitter Timing, Generation, Connection", async () => {
      const bridge = makeStubBridge();
      const { container } = render(<EmitterPropertyTabs bridge={bridge} />);
      // Wait for Basic tab content to populate.
      await waitFor(() => {
        expect(screen.getByTestId("section-emitter-timing")).toBeInTheDocument();
      });
      expect(screen.getByTestId("section-generation")).toBeInTheDocument();
      expect(screen.getByTestId("section-connection")).toBeInTheDocument();
      // DOM order: Emitter Timing first, then Generation, then Connection.
      const timing     = screen.getByTestId("section-emitter-timing");
      const generation = screen.getByTestId("section-generation");
      const connection = screen.getByTestId("section-connection");
      expect(timing.compareDocumentPosition(generation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(generation.compareDocumentPosition(connection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("clicking a BasicTab section header collapses its children", async () => {
      const bridge = makeStubBridge();
      render(<EmitterPropertyTabs bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByTestId("section-emitter-timing")).toBeInTheDocument();
      });
      // Initially "Lifetime" (an Emitter Timing field) is visible.
      expect(screen.getByLabelText("Lifetime")).toBeInTheDocument();
      // Collapse Emitter Timing.
      fireEvent.click(screen.getByTestId("section-emitter-timing"));
      // Lifetime field is no longer in the DOM.
      expect(screen.queryByLabelText("Lifetime")).not.toBeInTheDocument();
    });

    it("Name row uses the custom 60px 1fr grid template", async () => {
      const bridge = makeStubBridge();
      render(<EmitterPropertyTabs bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByLabelText("Name")).toBeInTheDocument();
      });
      // The Name field's <input> is inside a div with the custom grid template.
      const nameInput = screen.getByLabelText("Name");
      const row = nameInput.closest('div.form-row') as HTMLElement | null;
      expect(row).not.toBeNull();
      expect(row!.style.gridTemplateColumns).toBe("60px 1fr");
    });
  ```

  Note: this assumes the test file already has `makeStubBridge()`, `screen`, `render`, `waitFor`, `fireEvent` imported. If any are missing, add the imports from `@testing-library/react` and `vitest`.

- [ ] **Step 2: Run — expect failure.**

  ```
  cd web/apps/editor
  pnpm vitest run src/screens/__tests__/EmitterPropertyTabs.test.tsx --reporter=basic
  ```

  Expected: FAIL on all 3 new specs.

- [ ] **Step 3: Extend `FieldText` with the `wide` prop.**

  Open `web/apps/editor/src/screens/EmitterPropertyTabs.tsx`. Find `FieldText` (around line 452). Replace its definition with:

  ```tsx
  function FieldText({
    label,
    value,
    onCommit,
    wide,
  }: {
    label: string;
    value: string;
    onCommit: (value: string) => void;
    /** When true, render just the <input> (no .form-row wrapper, no
     *  label span). Caller owns the outer row container and the label.
     *  Used by the Name row, which needs the design source's custom
     *  60px 1fr grid template. */
    wide?: boolean;
  }) {
    // Local text state so the user can type freely; commit on blur or
    // Enter to avoid per-keystroke bridge spam.
    const [text, setText] = useState(value);
    const lastProp = useRef(value);
    // Sync from prop when external value changes (and we're not editing).
    if (lastProp.current !== value) {
      lastProp.current = value;
      setText(value);
    }
    const input = (
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== value) onCommit(text);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            (e.currentTarget as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setText(value);
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        className="text-input"
        aria-label={label}
        spellCheck={false}
        autoComplete="off"
      />
    );
    if (wide) {
      return input;
    }
    return (
      <div className="form-row">
        <span className="lbl">{label}</span>
        {input}
        <span className="unit" />
      </div>
    );
  }
  ```

  Two changes from the original:
  1. New `wide?: boolean` prop in the destructure.
  2. The input is extracted into a local `input` variable. If `wide`, return just the input; otherwise, wrap in the `.form-row` as before.

- [ ] **Step 4: Wrap BasicTab fields in `<Section>` and add the Name row.**

  Still in `EmitterPropertyTabs.tsx`, find `BasicTab` (around line 286). Add `Section` to the imports near the top of the file:

  ```tsx
  import { Section } from "@/components/Section";
  ```

  Replace the `BasicTab` function's return JSX with the version below. The field set is unchanged — only the grouping and the Name row's container change.

  ```tsx
  function BasicTab({
    properties,
    onCommit,
  }: {
    properties: EmitterPropertiesDto;
    onCommit: (patch: Partial<EmitterPropertiesDto>) => void;
  }) {
    // Mutex enabling per legacy: useBursts toggles between burst-mode
    // fields and rate-mode field.
    const burstsEnabled = properties.useBursts;
    const rateEnabled = !properties.useBursts;
    const rotationEnabled = properties.randomRotation;
    return (
      <div className="inspector">
        {/* Name row — custom 60px 1fr grid per design source's
            left_panel.jsx:100. Outside any Section so it always
            shows at the top of the tab. */}
        <div
          className="form-row"
          style={{ gridTemplateColumns: "60px 1fr" }}
        >
          <span className="lbl">Name</span>
          <FieldText
            value={properties.name}
            onCommit={(v) => onCommit({ name: v })}
            label="Name"
            wide
          />
        </div>

        <Section title="Emitter Timing">
          <FieldSpinner
            label="Lifetime"
            value={properties.lifetime}
            min={0}
            step={0.1}
            unit="s"
            onCommit={(v) => onCommit({ lifetime: v })}
          />
          <FieldSpinner
            label="Initial Delay"
            value={properties.initialDelay}
            min={0}
            step={0.1}
            unit="s"
            onCommit={(v) => onCommit({ initialDelay: v })}
          />
          <FieldSpinner
            label="Skip Time"
            value={properties.skipTime}
            min={0}
            step={0.1}
            unit="s"
            onCommit={(v) => onCommit({ skipTime: v })}
          />
          <FieldSpinner
            label="Freeze Time"
            value={properties.freezeTime}
            min={0}
            step={0.1}
            unit="s"
            onCommit={(v) => onCommit({ freezeTime: v })}
          />
          <FieldSpinner
            label="Random Lifetime"
            value={properties.randomLifetimePerc}
            min={0}
            max={100}
            step={1}
            unit="%"
            onCommit={(v) => onCommit({ randomLifetimePerc: v })}
          />
        </Section>

        <Section title="Generation">
          <FieldCheckbox
            label="Use Bursts"
            checked={properties.useBursts}
            onCheckedChange={(v) => onCommit({ useBursts: v })}
          />
          <FieldSpinner
            label="Bursts"
            value={properties.nBursts}
            min={1}
            step={1}
            decimals={0}
            disabled={!burstsEnabled}
            onCommit={(v) => onCommit({ nBursts: Math.round(v) })}
          />
          <FieldSpinner
            label="Burst Delay"
            value={properties.burstDelay}
            min={0}
            step={0.1}
            unit="s"
            disabled={!burstsEnabled}
            onCommit={(v) => onCommit({ burstDelay: v })}
          />
          <FieldSpinner
            label="Particles / Burst"
            value={properties.nParticlesPerBurst}
            min={1}
            step={1}
            decimals={0}
            disabled={!burstsEnabled}
            onCommit={(v) => onCommit({ nParticlesPerBurst: Math.round(v) })}
          />
          <FieldSpinner
            label="Particles / Second"
            value={properties.nParticlesPerSecond}
            min={0}
            step={1}
            decimals={0}
            disabled={!rateEnabled}
            onCommit={(v) => onCommit({ nParticlesPerSecond: Math.round(v) })}
          />
          <FieldSpinner
            label="Random Scale"
            value={properties.randomScalePerc}
            min={0}
            max={100}
            step={1}
            unit="%"
            onCommit={(v) => onCommit({ randomScalePerc: v })}
          />
          <FieldCheckbox
            label="Random Rotation"
            checked={properties.randomRotation}
            onCheckedChange={(v) => onCommit({ randomRotation: v })}
          />
          <FieldCheckbox
            label="Random Rotation Direction"
            checked={properties.randomRotationDirection}
            disabled={!rotationEnabled}
            onCheckedChange={(v) => onCommit({ randomRotationDirection: v })}
          />
          <FieldSpinner
            label="Rotation Average"
            value={properties.randomRotationAverage}
            step={0.1}
            disabled={!rotationEnabled}
            onCommit={(v) => onCommit({ randomRotationAverage: v })}
          />
          <FieldSpinner
            label="Rotation Variance"
            value={properties.randomRotationVariance}
            step={0.1}
            disabled={!rotationEnabled}
            onCommit={(v) => onCommit({ randomRotationVariance: v })}
          />
          <FieldSpinner
            label="Index"
            value={properties.index}
            min={0}
            step={1}
            decimals={0}
            onCommit={(v) => onCommit({ index: Math.round(v) })}
          />
        </Section>

        <Section title="Connection">
          <FieldCheckbox
            label="Link to System"
            checked={properties.linkToSystem}
            onCheckedChange={(v) => onCommit({ linkToSystem: v })}
          />
          <FieldSpinner
            label="Parent Link Strength"
            value={properties.parentLinkStrength}
            min={0}
            step={0.01}
            onCommit={(v) => onCommit({ parentLinkStrength: v })}
          />
        </Section>
      </div>
    );
  }
  ```

  Key changes:
  - Outer wrapper switches from `<div className="space-y-3">` to `<div className="inspector">`. This applies the design source's `.inspector { padding: 8px 10px 12px }` to the tab content.
  - Name row is hoisted out of any Section and rendered with the custom `60px 1fr` grid via inline style. Uses `FieldText` with `wide` prop so the input renders inline without its own form-row wrapper.
  - **Emitter Timing** section wraps: Lifetime, Initial Delay, Skip Time, Freeze Time, Random Lifetime.
  - **Generation** section wraps: Use Bursts, Bursts, Burst Delay, Particles / Burst, Particles / Second, Random Scale, Random Rotation, Random Rotation Direction, Rotation Average, Rotation Variance, Index.
  - **Connection** section wraps: Link to System, Parent Link Strength.

  Three Section wrappers means three `data-testid` values: `section-emitter-timing`, `section-generation`, `section-connection`. These match the test specs in Step 1.

- [ ] **Step 5: Re-run the BasicTab specs — expect pass.**

  ```
  pnpm vitest run src/screens/__tests__/EmitterPropertyTabs.test.tsx --reporter=basic
  ```

  Expected: PASS for the 3 new specs. Existing BasicTab specs (rendering each field, commit behavior, etc.) should ALSO pass — the field set is unchanged, only their layout container changed.

  If an existing spec breaks because it queried for a field by something other than `getByLabelText`, update the query to use `getByLabelText` (which is more robust to layout container changes). Document any spec rewrites in the commit message.

- [ ] **Step 6: Sanity check + commit.**

  ```
  pnpm build
  pnpm test --reporter=basic
  ```

  Expected: 0 TS errors. 250/250 (was 247 after P2 + 3 new = 250).

  ```bash
  git add web/apps/editor/src/screens/EmitterPropertyTabs.tsx \
          web/apps/editor/src/screens/__tests__/EmitterPropertyTabs.test.tsx
  git commit -m "$(cat <<'EOF'
  feat(LT-4): BasicTab gains collapsible sections + full-width Name input

  BasicTab's flat field list groups into three collapsible Sections
  matching the design source's left_panel.jsx structure:

    - Emitter Timing: Lifetime, Initial Delay, Skip Time,
      Freeze Time, Random Lifetime
    - Generation: Use Bursts, Bursts, Burst Delay,
      Particles / Burst, Particles / Second, Random Scale,
      Random Rotation, Random Rotation Direction,
      Rotation Average, Rotation Variance, Index
    - Connection: Link to System, Parent Link Strength

  The outer wrapper switches from <div className="space-y-3"> to
  <div className="inspector">, applying the design source's
  padding: 8px 10px 12px.

  Name field gets a custom 60px 1fr grid override (matching design
  source left_panel.jsx:100) so the text input fills available
  width instead of using the default 92px input slot. Introduces a
  small wide?: boolean prop on FieldText for this case — when set,
  FieldText renders just the <input>, and the caller owns the
  form-row container.

  Appearance and Physics tabs are unchanged in this commit
  (placeholders today; B2 sections them when wiring real fields).

  Test count: 247 → 250 (+3 BasicTab section + Name grid specs).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 4: Add Duplicate button to the tree toolbar

**Why fourth:** Independent of Tasks 1–3. The toolbar is in a different file (`EmitterTree.tsx`) and touches no shared surface with the inspector work. Could be done in parallel; sequencing here keeps the commit graph linear.

**Files:**
- Modify: `web/apps/editor/src/screens/EmitterTree.tsx`
- Modify: `web/apps/editor/src/screens/__tests__/EmitterTree.test.tsx`

### Steps

- [ ] **Step 1: Add failing specs.**

  Append these to the EmitterTree.test.tsx file inside the existing `describe("EmitterTree", () => { ... })`:

  ```tsx
    it("toolbar renders a Duplicate button between New and Delete in DOM order", async () => {
      const bridge = makeStubBridge();
      render(<EmitterTree bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByText("Smoke")).toBeInTheDocument();
      });

      const newBtn = screen.getByLabelText("New Emitter");
      const dupBtn = screen.getByLabelText("Duplicate emitter");
      const delBtn = screen.getByLabelText("Delete emitter");

      // newBtn comes before dupBtn comes before delBtn.
      expect(newBtn.compareDocumentPosition(dupBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(dupBtn.compareDocumentPosition(delBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("clicking Duplicate dispatches emitters/duplicate with the primary's id", async () => {
      const bridge = makeStubBridge();
      render(<EmitterTree bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByText("Smoke")).toBeInTheDocument();
      });

      // Select Smoke (id=0) first.
      fireEvent.click(screen.getByText("Smoke"));
      await waitFor(() => {
        expect(useEmitterSelectionStore.getState().primary).toBe(0);
      });

      fireEvent.click(screen.getByLabelText("Duplicate emitter"));

      const calls = (bridge.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
      const dup = calls.find((c) => c.kind === "emitters/duplicate");
      expect(dup).toBeDefined();
      expect(dup!.params).toEqual({ id: 0 });
    });

    it("Duplicate button is disabled when no emitter is selected", async () => {
      const bridge = makeStubBridge();
      render(<EmitterTree bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByText("Smoke")).toBeInTheDocument();
      });

      // No selection at this point (beforeEach clears the store).
      const dupBtn = screen.getByLabelText("Duplicate emitter");
      expect(dupBtn).toBeDisabled();
    });
  ```

- [ ] **Step 2: Run — expect failure.**

  ```
  cd web/apps/editor
  pnpm vitest run src/screens/__tests__/EmitterTree.test.tsx --reporter=basic
  ```

  Expected: FAIL. The data-testid / label lookups for "Duplicate emitter" fail because the button doesn't exist yet.

- [ ] **Step 3: Add the Duplicate button to `EmitterTreeToolbar`.**

  Open `web/apps/editor/src/screens/EmitterTree.tsx`. Find the `EmitterTreeToolbar` function component. At the top of the file, ensure `Copy` is imported from `lucide-react` — add it to the existing Lucide import:

  ```tsx
  import { ChevronDown, ChevronUp, Copy, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
  ```

  (Existing imports likely have most of these — only `Copy` is new.)

  Inside the `EmitterTreeToolbar` function, add a handler for the duplicate action. After the existing `addRoot` / `del` / `moveUp` / `moveDown` declarations (or wherever the click handlers are defined for the other toolbar buttons), add:

  ```tsx
    const duplicatePrimary = () => {
      if (primaryId === null) return;
      void bridge.request({
        kind: "emitters/duplicate",
        params: { id: primaryId },
      });
    };
  ```

  In the JSX, insert a new `<button>` between the New Emitter Menubar block and the Delete button. The current order is `<Menubar>...New emitter</Menubar> <button>Delete</button>`. After inserting, the order becomes `<Menubar>...New</Menubar> <button>Duplicate</button> <button>Delete</button>`.

  Insert this:

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

- [ ] **Step 4: Re-run the 3 new specs — expect pass.**

  ```
  pnpm vitest run src/screens/__tests__/EmitterTree.test.tsx --reporter=basic
  ```

  Expected: PASS for the 3 new specs. All existing EmitterTree specs still pass — no removal of existing buttons in this task.

- [ ] **Step 5: Sanity check + commit.**

  ```
  pnpm build
  pnpm test --reporter=basic
  ```

  Expected: 0 TS errors. 253/253 (was 250 + 3 new = 253).

  ```bash
  git add web/apps/editor/src/screens/EmitterTree.tsx \
          web/apps/editor/src/screens/__tests__/EmitterTree.test.tsx
  git commit -m "$(cat <<'EOF'
  feat(LT-4): Duplicate button on tree toolbar

  Adds a Duplicate button between New ▾ and Delete. Dispatches
  emitters/duplicate (existing bridge surface, also consumed by the
  context-menu Duplicate item) on the primary emitter. Disabled
  when no primary is selected. Icon: Lucide Copy.

  Test count: 250 → 253 (+3 specs: DOM order, dispatch, disabled-
  state).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 5: Swap Show All / Hide All text labels to icon buttons

**Why fifth:** Smallest single change in B1.2. Two text spans become two icon buttons. Same handlers, same dispatch paths — only the visual + click target changes.

**Files:**
- Modify: `web/apps/editor/src/screens/EmitterTree.tsx`
- Modify: `web/apps/editor/src/screens/__tests__/EmitterTree.test.tsx`

### Steps

- [ ] **Step 1: Add failing specs.**

  Append to `EmitterTree.test.tsx` inside the same `describe`:

  ```tsx
    it("Show All / Hide All render as icon buttons (no SHOW / HIDE text)", async () => {
      const bridge = makeStubBridge();
      render(<EmitterTree bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByText("Smoke")).toBeInTheDocument();
      });

      // Tooltips / aria-labels still find the buttons.
      expect(screen.getByLabelText("Show all emitters")).toBeInTheDocument();
      expect(screen.getByLabelText("Hide all emitters")).toBeInTheDocument();

      // The literal text "SHOW" and "HIDE" no longer appears in the toolbar.
      // (The legacy implementation rendered uppercase letter-spaced spans.)
      const toolbar = screen.getByTestId("emitter-tree-toolbar");
      expect(toolbar.textContent).not.toMatch(/SHOW/);
      expect(toolbar.textContent).not.toMatch(/HIDE/);

      // The Eye / EyeOff Lucide icons should be present inside the
      // Show All / Hide All buttons (svg elements).
      const showAll = screen.getByLabelText("Show all emitters");
      const hideAll = screen.getByLabelText("Hide all emitters");
      expect(showAll.querySelector("svg")).not.toBeNull();
      expect(hideAll.querySelector("svg")).not.toBeNull();
    });
  ```

- [ ] **Step 2: Run — expect failure.**

  ```
  pnpm vitest run src/screens/__tests__/EmitterTree.test.tsx --reporter=basic
  ```

  Expected: FAIL. The current Show All / Hide All elements are spans / text-style buttons with "SHOW" / "HIDE" text content; the spec asserts these no longer match.

- [ ] **Step 3: Convert Show All / Hide All to icon buttons.**

  In `EmitterTree.tsx`, find the current Show All and Hide All elements in `EmitterTreeToolbar`. They look something like:

  ```tsx
        <button
          type="button"
          className="ml-0.5 h-6 rounded px-1.5 text-[10px] uppercase tracking-wide text-text-2 hover:bg-panel-2 hover:text-text outline-none"
          title="Show All Emitters"
          aria-label="Show all emitters"
          onClick={showAll}
        >
          Show All
        </button>
        <button
          type="button"
          className="h-6 rounded px-1.5 text-[10px] uppercase tracking-wide text-text-2 hover:bg-panel-2 hover:text-text outline-none"
          title="Hide All Emitters"
          aria-label="Hide all emitters"
          onClick={hideAll}
        >
          Hide All
        </button>
  ```

  Replace those two `<button>` blocks with the icon-button versions below. Reuse the existing `TOOLBAR_BTN` className (the same one used by every other icon button in the toolbar). `Eye` and `EyeOff` are already imported.

  ```tsx
        <button
          type="button"
          className={TOOLBAR_BTN}
          title="Show All Emitters"
          aria-label="Show all emitters"
          onClick={showAll}
        >
          <Eye className="size-4" />
        </button>
        <button
          type="button"
          className={TOOLBAR_BTN}
          title="Hide All Emitters"
          aria-label="Hide all emitters"
          onClick={hideAll}
        >
          <EyeOff className="size-4" />
        </button>
  ```

  The `ml-0.5` on the first text button (which acted as a gap from the divider) goes away — `TOOLBAR_BTN` already has consistent spacing baked in via `gap-0.5` on the toolbar's outer container or equivalent. If visual inspection during smoke testing later shows the spacing looks off, revisit.

- [ ] **Step 4: Re-run the spec — expect pass.**

  ```
  pnpm vitest run src/screens/__tests__/EmitterTree.test.tsx --reporter=basic
  ```

  Expected: PASS. Existing EmitterTree specs continue to pass.

- [ ] **Step 5: Sanity check + commit.**

  ```
  pnpm build
  pnpm test --reporter=basic
  ```

  Expected: 0 TS errors. 254/254 (was 253 + 1 new = 254).

  ```bash
  git add web/apps/editor/src/screens/EmitterTree.tsx \
          web/apps/editor/src/screens/__tests__/EmitterTree.test.tsx
  git commit -m "$(cat <<'EOF'
  feat(LT-4): Show All / Hide All toolbar buttons become icons

  Replaces the legacy uppercase text spans for Show All and Hide
  All with Lucide Eye / EyeOff icon buttons using the same
  TOOLBAR_BTN className as every other toolbar icon. Tooltips and
  aria-labels preserve the full text for screen readers and
  discoverability.

  Visual disambiguation from the per-row eye affordance comes from
  context (toolbar vs row) plus the tooltip. If the duplicated
  icon glyph causes confusion in real use, the upgrade path is a
  custom Eye+plus / EyeStrike SVG.

  Test count: 253 → 254 (+1 spec asserting icons render + no SHOW
  / HIDE text in the toolbar).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 6: Docs — CHANGELOG + HANDOFF

**Why sixth:** All code changes have landed. Docs capture what shipped.

**Files:**
- Modify: `CHANGELOG.md` — B1.2 entry following partial-backfill convention.
- Modify: `tasks/HANDOFF.md` — refresh test counts + what landed + reorder next moves.

### Steps

- [ ] **Step 1: Add CHANGELOG entry.**

  Open `CHANGELOG.md`. Find the `## Changelog` section. The B1 entry sits at the top; the B1.2 entry goes immediately above it (newest first). Use the date / hash format conventions from CLAUDE.md and prior entries.

  Insert this entry just below the `## Changelog` heading:

  ```markdown
  ### Left-pane polish (B1.2) — collapsible sections, Name input width, toolbar Duplicate + icon Show/Hide All

  *TODO-DATE · [`TODO-HASH`](https://github.com/DrKnickers/new-particle-editor/commit/TODO-HASH) · [#TODO-PR](https://github.com/DrKnickers/new-particle-editor/pull/TODO-PR)*

  Tightens the left pane's interior fidelity against the design
  source. New `Section` primitive at
  [`src/components/Section.tsx`](src/components/Section.tsx) (entire
  header row clickable, plus Enter/Space when focused; defaults to
  `defaultOpen=true`; session-only state — re-mounting on emitter
  selection re-expands every section). BasicTab gains three section
  groupings (Emitter Timing / Generation / Connection) matching the
  design source's `left_panel.jsx` layout; field set unchanged.
  Name field gets a custom 60px 1fr grid override (also matching
  the design source) so the text input fills available width;
  `FieldText` learns a small `wide?: boolean` prop so callers can
  embed it in a custom-grid row without the default `.form-row`
  wrapper. Tree toolbar gains a Duplicate button between New ▾ and
  Delete (dispatches the existing `emitters/duplicate`; disabled
  when no primary is selected). Show All / Hide All become Lucide
  `Eye` / `EyeOff` icon buttons; tooltips preserve the full text.
  CSS audit syncs `.inspector`, `.section`, `.form-row`, and
  `.text-input` rules in our [`components.css`](src/styles/components.css)
  against the design source's `styles.css` (lines 505–608).

  **How we tackled it.** Section primitive is ~40 lines:
  `useState<boolean>`, `role="button" tabIndex={0}` with
  `onKeyDown` for Enter/Space (preventDefault on Space), and
  `aria-expanded` reflecting state. The `data-testid` is derived
  from the title so individual sections are test-addressable. The
  intentional reset-on-mount behaviour means switching emitters
  re-expands sections — documented as a comment in the component
  with the upgrade path (lift state or per-tab persistence map) if
  the trade-off proves wrong in real use. BasicTab's restructure
  is purely wrapping: existing field components untouched, only
  their parent containers change. The Name row sits outside any
  Section (top-of-tab) with an inline `gridTemplateColumns: "60px
  1fr"` override mirroring the design source's
  `left_panel.jsx:100`. `FieldText`'s `wide` prop is a four-line
  diff: extract the `<input>` into a local variable, return it
  directly if `wide`. The toolbar's Duplicate button uses the
  existing `emitters/duplicate` bridge surface (consumed by the
  context-menu Duplicate item before this) and the existing
  `TOOLBAR_BTN` className for visual consistency. Show All / Hide
  All swap from custom text-button classNames to `TOOLBAR_BTN`
  with `Eye` / `EyeOff` icons.

  **Issues encountered and resolutions.** *(any issues caught
  during implementation get logged here at commit time)*

  Test count: vitest **254 / 254** (was 239; +15 across all the new
  specs), Playwright unchanged at **83 / 83**.

  ---
  ```

  The `*(any issues caught...)*` placeholder is intentional — fill in actual issues from the dispatch's commit history when committing this docs commit. If no notable issues, replace with a sentence like "No issues of note during implementation."

- [ ] **Step 2: Refresh HANDOFF.**

  Open `tasks/HANDOFF.md`. Apply these updates while preserving the rest of the document:

  - **Header date** → `2026-05-20` (or actual completion date if later).
  - **Last conversation context paragraph** → mention B1.2 shipped (polish dispatch with section primitive, Name row, toolbar Duplicate / Show-Hide icons, CSS audit). Note that B1.3 (resizable splitters with `react-resizable-panels`) is the next dispatch.
  - **Resumable state table**:
    - HEAD points to the latest B1.2 commit.
    - Ahead of `lt-4` by the count of B1.2 commits (5 code commits + this docs commit + spec commit + plan commit = 8 commits added since B1 closed).
    - Test counts: vitest **254 / 254**; Playwright **83 / 83**; MSBuild Debug x64 clean (no C++ touched).
  - **"What landed this session" section** → add a new sub-table for B1.2 commits listed in order with one-line descriptions:
    - `85503ae` — brainstorm spec (B1.2)
    - (plan commit hash) — implementation plan
    - (Task 1 hash) — CSS audit + sync
    - (Task 2 hash) — Section primitive
    - (Task 3 hash) — BasicTab sectioning + Name row
    - (Task 4 hash) — Toolbar Duplicate
    - (Task 5 hash) — Show/Hide icon swap
    - (Task 6 hash — THIS commit) — CHANGELOG + HANDOFF
  - **Open items / Next moves** → B1.3 (resizable splitters) becomes the top item. B2 (Appearance + Physics wiring) stays as the secondary follow-up.

- [ ] **Step 3: Commit.**

  ```bash
  git add CHANGELOG.md tasks/HANDOFF.md
  git commit -m "$(cat <<'EOF'
  docs(LT-4): CHANGELOG + HANDOFF for B1.2 left-pane polish

  - CHANGELOG gains the B1.2 entry following the partial-backfill
    convention (hash + PR# TODO until master merge).
  - HANDOFF refreshed: test counts now 254/254 vitest + 83/83
    Playwright; B1.2 listed under what landed; B1.3 (resizable
    splitters via react-resizable-panels) is the top next move.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 7: Final verification + user-gated FF

**Why last:** Single end-to-end pass before requesting user OK to fast-forward into `lt-4`.

**Files:** none modified.

### Steps

- [ ] **Step 1: Run all verification gates.**

  ```
  cd web/apps/editor
  pnpm build
  pnpm test --reporter=basic
  ```

  Expected:
  - `pnpm build` — 0 TS errors.
  - `pnpm test` — 254/254.

- [ ] **Step 2: Playwright (optional — B1.2 is React-only).**

  If the binary is already built (likely from B1's verification), run native:

  ```
  pnpm test:native
  ```

  Expected: 83/83. If the binary doesn't exist, this step is skippable — B1.2 changed no C++ or bridge schema, so the count should be unchanged.

- [ ] **Step 3: Manual smoke test (you or the user).**

  Launch `x64/Debug/ParticleEditor.exe --new-ui` and verify in order:

  - Left pane shows: title header → tree → tree toolbar at bottom with 7 buttons + 1 divider (`+ Duplicate Delete ▲ ▼ | Show Hide`, all icons).
  - Click Duplicate with no emitter selected — disabled (no dispatch fires; check by selecting an emitter then clicking; a copy appears in the tree).
  - Click Show All — the visibility of all rows shifts to "on". Click Hide All — all rows become opacity-50.
  - Basic tab has three section headers with chevrons: "Emitter Timing", "Generation", "Connection".
  - Click each header — section content collapses with the chevron rotating; click again expands.
  - Click between two different emitters — sections snap back to expanded (session-only state).
  - Name field input fills available width (compare against the reference image — should now match).
  - Inspector right edge sits close to the field inputs (tightened padding).
  - Vertical spacing between form rows is tighter than before B1.2.
  - Toggle theme to light — section headers + chevrons + form rows render correctly.

- [ ] **Step 4: Legacy regression.**

  Launch with `--legacy-ui` (or no flag). Verify legacy left pane unchanged.

- [ ] **Step 5: Lineage check.**

  ```
  git log --oneline lt-4..HEAD
  ```

  Expected: 8 new commits since the prior dispatch:
  1. brainstorm spec (`85503ae`)
  2. implementation plan
  3. CSS audit + sync
  4. Section primitive
  5. BasicTab sectioning + Name row
  6. Toolbar Duplicate
  7. Show/Hide icon swap
  8. CHANGELOG + HANDOFF

  Plus any commits from prior sessions on the branch. `git log --oneline HEAD..lt-4` should return 0.

- [ ] **Step 6: Request user OK to FF + push.**

  Per CLAUDE.md, never push to `origin/lt-4` without explicit user OK. Surface the verification results to the user and ask.

- [ ] **Step 7: On user OK, FF + push.**

  Since `lt-4` may be checked out in another worktree, push the session branch HEAD directly to `origin/lt-4`:

  ```bash
  git push origin claude/<current-session-name>:lt-4
  ```

  If push succeeds, the remote `lt-4` is now at the latest B1.2 commit. The local `lt-4` in the other worktree will sync on its next `git pull`.

- [ ] **Step 8: Backfill the CHANGELOG entry's hash + date.**

  Open `CHANGELOG.md`. Replace `TODO-DATE` with the actual completion date (e.g., `2026-05-21`). Replace `TODO-HASH` (in both the linked text and the URL) with the SHA of the docs commit pushed in Step 7 (the one that includes the CHANGELOG entry itself; that's the commit on `lt-4` that "wraps up" B1.2). Leave `TODO-PR` as-is until master merge.

  ```bash
  git add CHANGELOG.md
  git commit -m "docs(LT-4): backfill B1.2 CHANGELOG date + lt-4 commit hash"
  git push origin claude/<current-session-name>:lt-4
  ```

---

## Verification matrix (use as a final checklist)

| Item | Source | Expected |
|---|---|---|
| `.section-*` rules present in components.css | Task 1 | Verified by visual smoke (chevron rotates, divider hairline visible) |
| `.inspector` / `.form-row` / `.text-input` synced | Task 1 | Match design source values |
| Section component exists with correct API | Task 2 | 8 unit tests pass |
| Section header is keyboard-accessible | Task 2 | Enter / Space tests pass |
| `aria-expanded` reflects state | Task 2 | Test passes |
| BasicTab renders 3 sections in expected order | Task 3 | Test passes |
| BasicTab sections collapse on click | Task 3 | Test passes |
| Name row uses 60px 1fr grid | Task 3 | Inline style assertion passes |
| Name field input fills available width | Task 3 | Manual smoke (compared to reference) |
| Duplicate button between New and Delete | Task 4 | DOM-order test passes |
| Duplicate dispatches with primary id | Task 4 | Mock dispatch test passes |
| Duplicate disabled when no primary | Task 4 | Disabled-state test passes |
| Show All / Hide All render as icons | Task 5 | SHOW/HIDE text absent + svg present |
| Show All / Hide All tooltips preserve full text | Task 5 | aria-label assertion |
| CHANGELOG entry added | Task 6 | Top of `## Changelog` section |
| HANDOFF refreshed | Task 6 | Test counts + B1.2 listed + next moves reordered |
| All gates green | Task 7 | build 0 err; vitest 254/254; Playwright 83/83 |
| Legacy regression OK | Task 7 | `--legacy-ui` mode unchanged |

---

## Notes for the engineer following this plan

- **Sequential by design.** Task 2 (Section component) blocks Task 3 (consumes Section). Task 1 (CSS audit) should land first so Task 2's styling is correct. Tasks 4 and 5 are independent of each other and of 1-3; they're sequenced for linear history.
- **TDD discipline.** Each task's failing test verifies the change is real. Don't skip Steps 2 (run-and-watch-fail) — it's how you know the new spec actually exercises the new path.
- **Commit per task.** Don't bundle multiple tasks into one commit. The plan's per-task commits produce a clean reviewable history.
- **L-005 (pnpm allowBuilds).** If `pnpm install` re-injects the placeholder string, edit `pnpm-workspace.yaml` directly to set per-package values to `true`.
- **L-004 (vitest != tsc).** `pnpm test` doesn't type-check. Always run `pnpm build` (which is `tsc -b`) before declaring victory.
- **CLAUDE.md branch workflow.** Session branch FF into `lt-4`, then push, all with explicit user OK. Never push to `master`.

---
