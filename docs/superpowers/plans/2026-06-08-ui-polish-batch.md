# UI Polish Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship seven user-requested polish items on the now-default React UI: consistent tab padding, fixed field cut-offs, nicer curve keys, denser emitter list, a Preferences menu (3-way theme) replacing the toolbar toggle, and mod-aware Open/Import default directories.

**Architecture:** Mostly surgical CSS / React edits in `web/apps/editor/src`, verified by the existing vitest suite + the native a11y harness; plus one localized C++ host change for the file-dialog initial directory. Each task is independently shippable and committed on its own.

**Tech Stack:** React 18 + TypeScript + Tailwind (utility classes) + a hand-written `components.css`; Radix primitives (Tabs/Menubar/Select/Dialog); Win32 + WebView2 host (C++); vitest (jsdom) + a Playwright-driven native a11y harness.

Spec: [`docs/superpowers/specs/2026-06-08-ui-polish-batch-design.md`](../specs/2026-06-08-ui-polish-batch-design.md).

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `web/apps/editor/src/screens/EmitterPropertyTabs.tsx` | inspector tabs — drop Physics double-pad | 1 |
| `web/apps/editor/src/styles/components.css` | `.tree-actions` padding; unify `.form-row` spinner column | 2, 3 |
| `web/apps/editor/src/components/CurveEditorPanel.tsx` | widen Time/Value spinner cells | 3 |
| `web/apps/editor/src/screens/CurveEditor.tsx` | curve key drop-shadow (replace black outline) | 4 |
| `web/apps/editor/src/screens/EmitterTree.tsx` | row density + `ROW_HEIGHT_PX` | 5 |
| `web/apps/editor/src/lib/theme.ts` (new) | 3-way theme state (dark/light/system) | 6 |
| `web/apps/editor/src/screens/PreferencesDialog.tsx` (new) | Preferences modal (Theme v1) | 6 |
| `web/apps/editor/src/components/MenuBar.tsx` | Edit → Preferences… item | 6 |
| `web/apps/editor/src/App.tsx` | first-paint theme bootstrap (3-way) | 6 |
| `web/apps/editor/src/components/Toolbar.tsx` | remove ThemeToggle | 6 |
| `src/host/BridgeDispatcher.cpp` / `src/main.cpp` | Open/Import dialog initial dir → mod Models | 7 |

**Verification commands (run from `web/`):**
- vitest: `pnpm --filter @particle-editor/editor test`
- types: `pnpm --filter @particle-editor/editor exec tsc -b`
- build dist: `pnpm --filter @particle-editor/editor build`
- native a11y: `pnpm --filter @particle-editor/editor test:native`
- golden re-baseline (scoped): `pnpm --filter @particle-editor/editor a11y:update --grep "<name>"`

> **Note on TDD for polish:** pure CSS/visual changes can't be red-green TDD'd meaningfully; their "test" is (a) the existing suites staying green, (b) a scoped a11y-golden diff showing only the intended change, and (c) a before/after screenshot from the running editor (L-033 — arch-C visuals need the user's eye). Behavior changes (theme 3-way, host dir) get real tests, written first.

---

## Task 1: Physics tab padding (remove stale double-pad)

**Files:**
- Modify: `web/apps/editor/src/screens/EmitterPropertyTabs.tsx:274-306`

- [ ] **Step 1: Remove `p-3` from the Physics tab content + fix the stale comment**

In the `<Tabs.Content value="physics" …>` (line ~300), delete ` p-3` from the className so it reads identically to the Basic/Appearance content (which omit padding because `.inspector` supplies it). Replace the comment block at lines 274-278 with:

```tsx
      {/* All three tabs render <div className="inspector"> inside, which
          owns the padding — so the Tabs.Content wrappers omit Tailwind
          padding to avoid doubling. */}
```

And change line ~300-304 from:
```tsx
      <Tabs.Content
        value="physics"
        className="flex-1 min-h-0 overflow-y-auto p-3 outline-none scrollbar-stable"
        data-testid="tab-physics-content"
      >
```
to (drop `p-3`):
```tsx
      <Tabs.Content
        value="physics"
        className="flex-1 min-h-0 overflow-y-auto outline-none scrollbar-stable"
        data-testid="tab-physics-content"
      >
```

- [ ] **Step 2: Verify the web suite + types stay green**

Run: `pnpm --filter @particle-editor/editor test` then `pnpm --filter @particle-editor/editor exec tsc -b`
Expected: vitest all pass (no test asserts the `p-3`); `tsc -b` exit 0.

- [ ] **Step 3: Commit**

```bash
git add web/apps/editor/src/screens/EmitterPropertyTabs.tsx
git commit -m "fix(inspector): remove Physics tab double-padding (match Basic/Appearance)"
```

---

## Task 2: Emitter-tree toolbar vertical padding

> **Check-in item — resolve the element first.** The obvious target, `.tree-actions` ([components.css:419](web/apps/editor/src/styles/components.css:419)), *already* has `padding: 4px 8px`. So either (a) the user means a different bar, or (b) they want the 4px changed. Confirm against the running UI before editing (a screenshot at the pre-execution check-in settles it).

**Files:**
- Modify: `web/apps/editor/src/styles/components.css` (the confirmed toolbar rule)

- [ ] **Step 1: Identify the exact element in the preview**

Start the dev preview, locate the toolbar directly above the emitter list, read its computed top/bottom padding. Confirm whether it's `.tree-actions` (already 4px) or another element with 0 vertical padding. Record the selector + current padding.

- [ ] **Step 2: Apply the padding**

If `.tree-actions` is the target and the user wants it tighter/looser, set its `padding` to the agreed value (e.g. `padding: 1px 8px;`). If a different element, add `padding-top: 1px; padding-bottom: 1px;` to that rule. (Exact value confirmed with the user; "1px first.")

- [ ] **Step 3: Verify + screenshot**

Run: `pnpm --filter @particle-editor/editor test` (expect green — CSS only). Capture a before/after screenshot of the toolbar for the user.

- [ ] **Step 4: Commit**

```bash
git add web/apps/editor/src/styles/components.css
git commit -m "style(emitter-tree): adjust toolbar vertical padding"
```

---

## Task 3: Fix field cut-offs (curve Time/Value + unify inspector column)

**Files:**
- Modify: `web/apps/editor/src/styles/components.css:577,607-615`
- Modify: `web/apps/editor/src/components/CurveEditorPanel.tsx` (Time/Value spinner wrappers)

- [ ] **Step 1: Unify the default `.form-row` spinner column to 73px**

In `components.css`, change line 577 from:
```css
  grid-template-columns: 1fr 58px 40px;
```
to:
```css
  grid-template-columns: 1fr 73px 40px;
```
Update the comment above (lines 572-576) to note the column is 73px (matching all tabs). Then DELETE the now-redundant Basic-tab override and its comment (lines 607-615):
```css
/* Basic-tab-scoped default: … (whole comment block) */
.basic-tab .form-row { grid-template-columns: 1fr 73px 40px; }
```
(Leave the `.basic-tab [role="radiogroup"] .form-row .lbl { padding-left: 22px; }` rule at line 605 — that's indent, not column width.)

- [ ] **Step 2: Verify inspector suite stays green**

Run: `pnpm --filter @particle-editor/editor test`
Expected: green. The a11y goldens capture the accessible tree (labels/values), not pixel widths, so no golden change expected. If any golden shifts, regenerate scoped and diff to confirm it's only width-driven layout.

- [ ] **Step 3: Locate + widen the curve Time/Value spinner cells**

Find the edit-toolbar Time/Value `<Spinner>` instances in `CurveEditorPanel.tsx` (search `aria-label="Time"` / `aria-label="Value"` or the spinner cell wrappers). The `Spinner` primitive is `w-full` ([Spinner.tsx:343](web/apps/editor/src/primitives/Spinner.tsx:343)) — it fills its wrapper — so widen the wrapper (e.g. a fixed `style={{ width: 84 }}` or a `w-[84px]` utility, up from the current cramped width) so a 2-decimal value like `100.00` fits (needs ≈64-84px incl. the 14px arrow column). Apply to BOTH Time and Value cells for symmetry.

- [ ] **Step 4: Verify the curve field shows 2 decimals**

Run: `pnpm --filter @particle-editor/editor test`. Then start the preview, select an emitter with a curve, and screenshot the Time/Value fields showing full 2-decimal values uncut.

- [ ] **Step 5: Commit**

```bash
git add web/apps/editor/src/styles/components.css web/apps/editor/src/components/CurveEditorPanel.tsx
git commit -m "fix(ui): stop number-field cut-off — widen curve Time/Value + unify inspector spinner column to 73px"
```

---

## Task 4: Curve keys — drop shadow instead of black outline

**Files:**
- Modify: `web/apps/editor/src/screens/CurveEditor.tsx:964-978` (and the second circle site ~1767-1778)

- [ ] **Step 1: Add an SVG drop-shadow filter to the curve `<defs>`**

In each curve `<svg>` (there are two render paths — the single-channel editor ~line 890+ and the multi-channel one ~line 1680+), add a `<defs>` filter near the top of the SVG body:

```tsx
        <defs>
          <filter id="curve-key-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.2" floodColor="#000" floodOpacity="0.5" />
          </filter>
        </defs>
```

- [ ] **Step 2: Replace the black outline on regular keys with the shadow**

At line 964, the stroke is currently:
```tsx
        const stroke = isBorder ? BORDER_STROKE : "#0a0a0a";
        const strokeWidth = isBorder ? 1.5 : 1;
```
Change so regular (non-border) keys carry NO black outline (rely on the shadow for separation), while border/selected keys keep their accent ring AND gain the shadow:
```tsx
        const stroke = isBorder ? BORDER_STROKE : "none";
        const strokeWidth = isBorder ? 1.5 : 0;
```
Add `filter="url(#curve-key-shadow)"` to the `<circle>` element at line ~967 (and the second circle at ~1767). Keep `fill`, `r`, and the data-* attributes unchanged.

- [ ] **Step 3: Verify curve tests + visual**

Run: `pnpm --filter @particle-editor/editor test` (the track-editor/curve specs assert `data-border` / key counts / interactivity — these are unaffected; expect green). Start the preview, select a curve, and screenshot keys showing the soft shadow and no hard black ring. Tune `dy` / `stdDeviation` / `floodOpacity` with the user if too strong/subtle.

- [ ] **Step 4: Commit**

```bash
git add web/apps/editor/src/screens/CurveEditor.tsx
git commit -m "style(curve): give keys a soft drop-shadow instead of a black outline"
```

---

## Task 5: Emitter-list density

**Files:**
- Modify: `web/apps/editor/src/screens/EmitterTree.tsx:597` (row padding) and `:883` (`ROW_HEIGHT_PX`)
- Re-baseline: `web/apps/editor/tests/a11y-goldens/*emitter-tree*` (via the harness)

- [ ] **Step 1: Reduce row padding + keep the bracket math in lockstep**

At line ~597, the row button className starts:
```tsx
              "grid w-full items-center gap-1.5 py-1 pr-2 text-left text-sm transition-colors",
```
Change `py-1` → `py-0.5`. Then at line 883:
```tsx
const ROW_HEIGHT_PX     = 24;
```
change to:
```tsx
const ROW_HEIGHT_PX     = 20;
```
(These MUST change together — `ROW_HEIGHT_PX` drives the absolute link-group bracket-gutter layout; a mismatch misaligns the brackets.)

- [ ] **Step 2: Rebuild dist + run the native harness**

Run: `pnpm --filter @particle-editor/editor build` then `pnpm --filter @particle-editor/editor test:native`
Expected: a row-height change will FAIL the emitter-tree a11y golden(s) (and possibly the splitter/bracket specs if they assert pixel positions). Confirm the failure is the expected metrics shift, not a structural break.

- [ ] **Step 3: Regenerate the affected goldens + diff the blast radius**

Run: `pnpm --filter @particle-editor/editor a11y:update --grep "emitter-tree"` (add other failing spec names as needed). Then `git diff web/apps/editor/tests/a11y-goldens/` and confirm only row-metric/position values changed (no lost/renamed nodes).

- [ ] **Step 4: Re-run the native harness green + screenshot**

Run: `pnpm --filter @particle-editor/editor test:native` → expect 174/0 (or the current baseline). Screenshot the denser list with a multi-link-group tree to confirm brackets still align.

- [ ] **Step 5: Commit**

```bash
git add web/apps/editor/src/screens/EmitterTree.tsx web/apps/editor/tests/a11y-goldens/
git commit -m "style(emitter-tree): tighten row density (py-0.5, ROW_HEIGHT_PX 24->20) + rebaseline goldens"
```

---

## Task 6: Preferences menu + 3-way theme (replace toolbar toggle)

**Files:**
- Create: `web/apps/editor/src/lib/theme.ts`
- Create: `web/apps/editor/src/screens/PreferencesDialog.tsx`
- Create: `web/apps/editor/src/lib/__tests__/theme.test.ts`
- Create: `web/apps/editor/src/screens/__tests__/PreferencesDialog.test.tsx`
- Modify: `web/apps/editor/src/components/MenuBar.tsx` (Edit menu + open state)
- Modify: `web/apps/editor/src/App.tsx:79` (bootstrap)
- Modify: `web/apps/editor/src/components/Toolbar.tsx` (remove ThemeToggle)
- Modify/replace: `web/apps/editor/src/components/__tests__/ThemeToggle.test.tsx`, `Toolbar.test.tsx`

- [ ] **Step 1: Write failing tests for the 3-way theme module**

Create `web/apps/editor/src/lib/__tests__/theme.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resolveTheme, readStoredMode, applyMode, type ThemeMode } from "../theme";

describe("theme 3-way", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("resolves explicit modes verbatim", () => {
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("resolves system to the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");   // prefersDark = true
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("defaults to system when nothing is stored", () => {
    expect(readStoredMode()).toBe("system");
  });

  it("reads a stored explicit mode", () => {
    localStorage.setItem("alo:theme", "light");
    expect(readStoredMode()).toBe("light");
  });

  it("applyMode sets data-theme to the resolved value and persists the mode", () => {
    applyMode("dark", true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("alo:theme")).toBe("dark");
  });
});
```

Run: `pnpm --filter @particle-editor/editor test theme` — Expected: FAIL (module not found).

- [ ] **Step 2: Implement `lib/theme.ts`**

```ts
// theme.ts — 3-way theme (dark/light/system). `alo:theme` stores the MODE;
// "system" follows prefers-color-scheme live. Resolves to a concrete
// "dark"|"light" applied as <html data-theme>.
export type ThemeMode = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

const KEY = "alo:theme";

export function readStoredMode(): ThemeMode {
  const v = localStorage.getItem(KEY);
  return v === "dark" || v === "light" || v === "system" ? v : "system";
}

export function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(mode: ThemeMode, osPrefersDark: boolean): ResolvedTheme {
  if (mode === "dark" || mode === "light") return mode;
  return osPrefersDark ? "dark" : "light";
}

export function applyMode(mode: ThemeMode, osPrefersDark = prefersDark()): void {
  document.documentElement.dataset.theme = resolveTheme(mode, osPrefersDark);
  localStorage.setItem(KEY, mode);
}
```

Run: `pnpm --filter @particle-editor/editor test theme` — Expected: PASS.

- [ ] **Step 3: Write a failing test for PreferencesDialog**

Create `web/apps/editor/src/screens/__tests__/PreferencesDialog.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PreferencesDialog } from "../PreferencesDialog";

describe("PreferencesDialog", () => {
  beforeEach(() => localStorage.clear());

  it("renders a 3-way theme control", () => {
    render(<PreferencesDialog open onOpenChange={() => {}} />);
    expect(screen.getByRole("radio", { name: /dark/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /light/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /system/i })).toBeInTheDocument();
  });

  it("selecting Light applies + persists the mode", () => {
    render(<PreferencesDialog open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /light/i }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("alo:theme")).toBe("light");
  });
});
```

Run: `pnpm --filter @particle-editor/editor test PreferencesDialog` — Expected: FAIL (module not found).

- [ ] **Step 4: Implement `screens/PreferencesDialog.tsx`**

Mirror `AboutDialog.tsx`'s `Modal` usage. A radiogroup of three options driving `applyMode`. Read initial mode via `readStoredMode()`; track local state so the control reflects the choice.

```tsx
import { useState } from "react";
import { Modal } from "@/components/Modal";
import { applyMode, readStoredMode, type ThemeMode } from "@/lib/theme";

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

const MODES: { value: ThemeMode; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

export function PreferencesDialog({ open, onOpenChange }: Props) {
  const [mode, setMode] = useState<ThemeMode>(() => readStoredMode());
  const choose = (m: ThemeMode) => { setMode(m); applyMode(m); };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Preferences" size="sm">
      <Modal.Body>
        <div className="flex flex-col gap-3 text-sm">
          <div className="text-text-2">Theme</div>
          <div role="radiogroup" aria-label="Theme" className="inline-flex rounded border border-border-2 bg-bg-2 p-0.5">
            {MODES.map((m) => (
              <button
                key={m.value}
                role="radio"
                aria-checked={mode === m.value}
                aria-label={m.label}
                onClick={() => choose(m.value)}
                className={`px-3 py-1 rounded text-xs ${mode === m.value ? "bg-accent-soft text-accent" : "text-text-3"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Modal.OkButton onClick={() => onOpenChange(false)}>Close</Modal.OkButton>
      </Modal.Footer>
    </Modal>
  );
}
```

Run: `pnpm --filter @particle-editor/editor test PreferencesDialog` — Expected: PASS.

- [ ] **Step 5: Wire Preferences… into the Edit menu**

In `MenuBar.tsx`, add open state (`const [prefsOpen, setPrefsOpen] = useState(false)`), render `<PreferencesDialog open={prefsOpen} onOpenChange={setPrefsOpen} />`, and add at the bottom of the Edit menu (after a `<Menubar.Separator/>`):

```tsx
            <Menubar.Separator className={SEPARATOR} />
            <Menubar.Item className={ITEM} onSelect={() => setPrefsOpen(true)}>
              Preferences…
            </Menubar.Item>
```
(Use the existing `ITEM` / separator class names from MenuBar.tsx.)

- [ ] **Step 6: Update the App.tsx bootstrap for the 3-way**

At `App.tsx:79`, replace the early `alo:theme` read/apply with the shared helper so first paint resolves `system` correctly and subscribes to OS changes while in system mode:

```ts
import { readStoredMode, applyMode, prefersDark } from "@/lib/theme";
// …at bootstrap:
applyMode(readStoredMode());
// keep system mode live:
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (readStoredMode() === "system") applyMode("system");
});
```
(Adapt to the exact existing bootstrap shape at line 79 — match how it currently reads/applies.)

- [ ] **Step 7: Remove ThemeToggle from the toolbar**

In `Toolbar.tsx`, delete the `<ThemeToggle />` render + its import. Delete `components/ThemeToggle.tsx` and its test, OR keep the file unused — prefer deleting to avoid dead code. Update `Toolbar.test.tsx` to drop any assertion that the toggle is present; if a test asserted theme switching via the toolbar, move that coverage to `PreferencesDialog.test.tsx` (Step 3 already covers it).

- [ ] **Step 8: Verify web suite + types**

Run: `pnpm --filter @particle-editor/editor test` then `pnpm --filter @particle-editor/editor exec tsc -b`
Expected: green; tsc 0. Fix any test that referenced the removed toggle.

- [ ] **Step 9: Rebuild + native harness + rebaseline goldens**

Run: `pnpm --filter @particle-editor/editor build` then `pnpm --filter @particle-editor/editor test:native`. The toolbar golden loses the theme toggle → regenerate: `pnpm --filter @particle-editor/editor a11y:update --grep "toolbar"` (and any menu/dialog goldens). Diff to confirm only the toggle removal + new Preferences entry changed. Re-run `test:native` green.

- [ ] **Step 10: Commit**

```bash
git add web/apps/editor/src/lib/theme.ts web/apps/editor/src/screens/PreferencesDialog.tsx web/apps/editor/src/components/MenuBar.tsx web/apps/editor/src/App.tsx web/apps/editor/src/components/Toolbar.tsx web/apps/editor/src/lib/__tests__/theme.test.ts web/apps/editor/src/screens/__tests__/PreferencesDialog.test.tsx web/apps/editor/tests/a11y-goldens/
git rm web/apps/editor/src/components/ThemeToggle.tsx web/apps/editor/src/components/__tests__/ThemeToggle.test.tsx
git add web/apps/editor/src/components/__tests__/Toolbar.test.tsx
git commit -m "feat(prefs): Edit -> Preferences modal with 3-way (dark/light/system) theme; remove toolbar toggle"
```

---

## Task 7: Open / Import default directory → selected mod's Models folder (C++ host)

> **Scope boundary:** ONLY the `.alo` Open + Import Emitters dialogs. The texture Browse dialog (`textures/browse`) is a separate call site and stays unchanged.

**Files:**
- Modify: the new-UI Open + Import file-dialog call sites (located in Step 1 — `src/host/BridgeDispatcher.cpp` and/or `src/main.cpp`)

- [ ] **Step 1: Locate the new-UI Open + Import dialog call sites + confirm mod access**

Find which bridge `kind` the React `File → Open` (`handleOpen` in `MenuBar.tsx`) and `Import Emitters` fire, and where the host shows the `GetOpenFileName`/`OPENFILENAME` dialog for each (search `BridgeDispatcher.cpp` + `main.cpp` for the handlers; the legacy `OPENFILENAME` sites are at `main.cpp:1425,1459,7134+`). Confirm `info->modManager` (or the equivalent ModManager pointer) is in scope at each call site — `GetSelectedModPath()` is used at `main.cpp:2567,6941`, so the pattern is `info->modManager ? info->modManager->GetSelectedModPath() : L""`.

- [ ] **Step 2: Confirm the models subpath**

Determine the on-disk subpath where `.alo` model files live relative to a mod root. Mirror the texture/shader convention (`TextureManager(fileManager, "Data\\Art\\Textures\\")`, `ShaderManager(..., "Data\\Art\\Shaders\\")`) — search for the Models analogue. Record the exact relative path (expected: `"Data\\Art\\Models\\"`; verify).

- [ ] **Step 3: Set the initial directory with a fallback chain**

At each of the two call sites, before the `GetOpenFileName` call, compute the initial dir and assign `ofn.lpstrInitialDir`:

```cpp
// Default the picker to the selected mod's Models folder, if present.
std::wstring initialDir;
const std::wstring modRoot =
    info->modManager ? info->modManager->GetSelectedModPath() : std::wstring();
if (!modRoot.empty()) {
    std::wstring models = modRoot;
    if (!models.empty() && models.back() != L'\\') models += L'\\';
    models += L"Data\\Art\\Models";
    if (PathFileExistsW(models.c_str())) initialDir = models;   // <shlwapi.h>
}
// Fallback: leave initialDir empty so Win32 uses last-used / default.
ofn.lpstrInitialDir = initialDir.empty() ? nullptr : initialDir.c_str();
```
Ensure `initialDir` outlives the `GetOpenFileName` call (declare it in the same scope). Do NOT touch the texture Browse dialog.

- [ ] **Step 4: Build the host (Debug x64) clean**

Run the MSBuild VS18 Debug x64 build (per L-046). Expected: clean compile, exit 0. (Add `#include <shlwapi.h>` and link `shlwapi.lib` if `PathFileExistsW` isn't already available — check existing includes first; main.cpp already includes `<shlwapi.h>`.)

- [ ] **Step 5: User-verify the dialog directory (L-033)**

The host file dialog is native + arch-C — the user launches, selects a mod, and confirms File → Open and Import Emitters both open at that mod's `Data\Art\Models`, and that with no mod selected they fall back gracefully. (Agent can't reliably drive the native dialog.)

- [ ] **Step 6: Commit**

```bash
git add src/main.cpp src/host/BridgeDispatcher.cpp
git commit -m "feat(host): default Open/Import .alo dialogs to the selected mod's Models folder"
```

---

## Self-Review

- **Spec coverage:** items 1→T1, 4→T2, 2→T3, 3→T4, 7→T5, 5→T6, 6→T7. All seven covered.
- **Couplings honored:** ROW_HEIGHT_PX moves with `py` (T5 Step 1); theme bootstrap updated in lockstep (T6 Step 6); a11y goldens regenerated where structure/metrics change (T5, T6).
- **Known open spots (resolved within tasks, not placeholders):** the toolbar element (T2 Step 1, also a pre-execution check-in), the curve Time/Value wrapper (T3 Step 3), the host call sites + models subpath (T7 Steps 1-2). Each task resolves its unknown then applies a fully-specified edit.
- **Out of scope (guarded):** texture Browse dialog (T7 boundary note); broader visual/motion/theming sweeps (separate batches).
- **Verification:** every web task runs vitest + tsc; visual tasks add a screenshot; native-affecting tasks (T5, T6) rebuild dist + run the a11y harness + diff goldens; the host task (T7) builds Debug x64 + hands the visual confirm to the user.
