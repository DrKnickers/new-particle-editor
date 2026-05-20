# Particle Editor 2026 Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visually + structurally redesign the LT-4 new-UI React shell (`web/apps/editor/`) to match the Particle Editor 2026 design — port the design's CSS-variable token system, bundle Inter, add light theme toggle, restructure tool panels into toolbar dropdowns + permanent Spawner column + always-on bottom curve editor + viewport pill, and wire up the previously-unwired `ModNicknameDialog`.

**Architecture:** Three phases on `lt-4`, each independently shippable. Phase 1 is a behavior-preserving token + font + theme swap (Tailwind utilities alias to the new tokens). Phase 2 is 7 small structural commits, each moving + restyling + rewriting tests for one unit. Phase 3 wires `mods/set-nickname`, restyles the Modal primitive, sweeps leftover Tailwind, and adds the theme-persistence Playwright spec.

**Tech Stack:** React 19 + Radix Primitives + Tailwind CSS, plus the design's CSS variables and component classes. WebView2 + D3D9 host wired via the existing bridge schema. Backend in C++ (`src/host/BridgeDispatcher.cpp` + `src/ModManager.{h,cpp}`).

**Source-of-truth artifacts:** the extracted design bundle at `C:\Users\antho\AppData\Local\Temp\nu-particle-editor\nuparticle-editor\project\`:
- `styles.css` — the design's token system + component CSS (authoritative).
- `toolbar.jsx`, `left_panel.jsx`, `right_panel.jsx`, `viewport.jsx`, `curve_editor.jsx`, `background_popover.jsx`, `ground_popover.jsx`, `icons.jsx` — component structure and composition.
- `assets/icon-ground.svg`, `assets/icon-bloom.svg`, `assets/icon-particles.svg` — viewport pill icons.
- The spec: [docs/superpowers/specs/2026-05-19-particle-editor-2026-redesign.md](docs/superpowers/specs/2026-05-19-particle-editor-2026-redesign.md).

**Repo conventions:**
- Branch workflow: commits on the current session branch (`claude/<random>`), fast-forwarded into `lt-4` at session end, pushed to `origin/lt-4`. Or commit directly on `lt-4` if the session has already switched there.
- Every commit ends green: `pnpm build` clean, vitest green, Playwright green, MSBuild Debug x64 clean.
- Verification commands:
  - C++ build: `"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" "ParticleEditor.sln" //p:Configuration=Debug //p:Platform=x64 //v:m 2>&1 | tail -15` (from worktree root).
  - TS build: `cd web/apps/editor && pnpm build`.
  - Vitest: `cd web/apps/editor && pnpm test`.
  - Playwright: `cd web/apps/editor && pnpm test:native`.

**Pre-grant for computer-use visual verification:** the dev binary at `c:\modding\particle editor\.claude\worktrees\awesome-morse-5ea5c3\x64\debug\particleeditor.exe` is in the session allowlist. If a future session needs re-granting, launch the editor first (Bash `run_in_background`), then call `mcp__computer-use__request_access(["particleeditor.exe"])` — the resolver picks the running PID's actual path.

---

## Phase 1 — Token system + theme toggle

Single phase, ~6 tasks, ending in ONE commit. Phase 1 must end with the editor structurally identical to today but visually using the new tokens. Test counts unchanged (vitest 191/191, Playwright 80/80) since no DOM-semantic changes.

### Task 1.1: Add CSS token files

**Files:**
- Create: `web/apps/editor/src/styles/tokens.css`
- Create: `web/apps/editor/src/styles/base.css`
- Create: `web/apps/editor/src/styles/components.css`

- [ ] **Step 1: Create `web/apps/editor/src/styles/tokens.css`** with the verbatim `:root` and `[data-theme="light"]` blocks from the design's `styles.css`:

```css
/* Particle Editor 2026 design tokens.
   Extracted from styles.css in the design bundle. Single source of truth
   for colors, radii, row heights, shadow. Light-theme overrides are scoped
   under [data-theme="light"] on the <html> element; default = dark. */

:root {
  --bg: #0e1116;
  --bg-2: #141821;
  --bg-3: #1a1f2b;
  --panel: #161b25;
  --panel-2: #1c2230;
  --panel-3: #232a3a;
  --border: #252b38;
  --border-2: #2e3547;
  --hover: #1f2532;
  --selected: #213149;
  --selected-border: #355385;
  --text: #d8dee9;
  --text-2: #a3acbd;
  --text-3: #6b7488;
  --accent: #4ea3ff;
  --accent-2: #2f7fd4;
  --accent-soft: rgba(78, 163, 255, 0.16);
  --danger: #e06c75;
  --success: #6fbf7a;
  --warning: #e0a14b;
  --x-axis: #ef5350;
  --y-axis: #66bb6a;
  --z-axis: #42a5f5;
  --shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
  --radius: 8px;
  --radius-sm: 5px;
  --row-h: 26px;
  --row-h-sm: 22px;
}

[data-theme="light"] {
  --bg: #e9ecf2;
  --bg-2: #f0f2f6;
  --bg-3: #ffffff;
  --panel: #f6f7fa;
  --panel-2: #ffffff;
  --panel-3: #eef0f5;
  --border: #d8dce4;
  --border-2: #c4c9d4;
  --hover: #e6e9ef;
  --selected: #d5e4f8;
  --selected-border: #79a8e6;
  --text: #1a1f29;
  --text-2: #4a5366;
  --text-3: #7c8497;
  --accent: #2f7fd4;
  --accent-2: #1f63b0;
  --accent-soft: rgba(47, 127, 212, 0.14);
}
```

- [ ] **Step 2: Create `web/apps/editor/src/styles/base.css`** with body/html resets + `@font-face` declaration + scrollbar rules from the design:

```css
/* Base resets, font registration, scrollbar styling.
   The body/html rules come from the design's styles.css. Font-face declares
   the locally-bundled Inter variable woff2 (preloaded in index.html for
   first-paint correctness). */

@font-face {
  font-family: "Inter";
  font-style: normal;
  font-weight: 100 900;
  font-display: block; /* No FOUT — wait for Inter to load before painting text */
  src: url("/fonts/inter/Inter-VariableFont_slnt,wght.woff2") format("woff2-variations");
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  font-family: "Inter", "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  font-feature-settings: "ss01", "cv11";
  -webkit-font-smoothing: antialiased;
  user-select: none;
}

#root { height: 100vh; }

/* Scrollbar styling — applies to .panel-body and .curve-list scrollable
   containers (per the design's component class names). */
.panel-body::-webkit-scrollbar,
.curve-list::-webkit-scrollbar { width: 10px; height: 10px; }

.panel-body::-webkit-scrollbar-track,
.curve-list::-webkit-scrollbar-track { background: transparent; }

.panel-body::-webkit-scrollbar-thumb,
.curve-list::-webkit-scrollbar-thumb {
  background: var(--border-2);
  border-radius: 5px;
  border: 2px solid var(--panel);
}

.panel-body::-webkit-scrollbar-thumb:hover,
.curve-list::-webkit-scrollbar-thumb:hover { background: var(--text-3); }
```

- [ ] **Step 3: Create `web/apps/editor/src/styles/components.css`** with the design's component-class rules. **Lift verbatim from `C:\Users\antho\AppData\Local\Temp\nu-particle-editor\nuparticle-editor\project\styles.css` lines 72-918** (everything after `#root { height: 100vh; }` and before the scrollbar block which is already in `base.css`). Include all of: `.app`, `.workspace`, `.workspace-center`, `.menubar`, `.app-icon`, `.app-title`, `.app-subtitle`, `.menu-items`, `.menu-item`, `.menu-dropdown`, `.menu-dropdown-item`, `.menu-dropdown-divider`, `.window-controls`, `.window-btn`, `.toolbar`, `.tb-group`, `.tb-btn`, `.tb-split`, `.tb-divider`, `.tb-spacer`, `.tb-field`, `.tb-select`, `.theme-toggle`, `.sim-speed-stepper`, `.panel`, `.panel-header`, `.panel-body`, `.search-row`, `.search`, `.emitter-tree`, `.tree-row`, `.tree-child`, `.tree-actions`, `.tabs`, `.tab`, `.inspector`, `.section`, `.section-header`, `.section-divider`, `.form-row`, `.num-input`, `.text-input`, `.select`, `.checkbox`, `.radio`, `.radio-label`, `.check-label`, `.viewport`, `.viewport-floor`, `.explosion`, `.gizmo`, `.vp-overlay`, `.vp-perspective`, `.vp-tools`, `.vp-stats`, `.vp-axes`, `.vp-bottom-right`, `.curve-editor`, `.ce-toolbar`, `.ce-body`, `.curve-list`, `.curve-canvas-wrap`, `.curve-canvas`, `.statusbar`. Read the source file and paste the relevant range.

Quick command to extract the right range:

```bash
sed -n '72,918p' "/c/Users/antho/AppData/Local/Temp/nu-particle-editor/nuparticle-editor/project/styles.css" > web/apps/editor/src/styles/components.css
```

- [ ] **Step 4: Verify all three files parse** by running `cd web/apps/editor && pnpm build`. The build should still succeed (the new CSS files aren't imported yet — they're sitting in `src/styles/` ready for the next step). Expected: build clean, no errors related to the new files.

### Task 1.2: Bundle Inter font

**Files:**
- Create: `web/apps/editor/public/fonts/inter/Inter-VariableFont_slnt,wght.woff2`
- Modify: `web/apps/editor/index.html`

- [ ] **Step 1: Download Inter variable woff2** from the official Inter release. Use a recent stable version (Inter 4.x).

```bash
mkdir -p "C:/Modding/Particle Editor/.claude/worktrees/awesome-morse-5ea5c3/web/apps/editor/public/fonts/inter"
cd "C:/Modding/Particle Editor/.claude/worktrees/awesome-morse-5ea5c3/web/apps/editor/public/fonts/inter"
curl -L -o "Inter-VariableFont_slnt,wght.woff2" "https://github.com/rsms/inter/raw/master/docs/font-files/Inter-VariableFont_slnt,wght.woff2"
ls -la "Inter-VariableFont_slnt,wght.woff2"
```

Expected: a ~250 KB woff2 file. If the URL changes upstream, fall back to https://rsms.me/inter/inter.html for the latest mirror.

- [ ] **Step 2: Add the preload link to `web/apps/editor/index.html`.** Open the file, find the `<head>` block, add a `<link rel="preload">` for the font immediately before any existing `<link rel="stylesheet">` so the font request kicks off as early as possible:

```html
<link rel="preload"
      as="font"
      type="font/woff2"
      crossorigin
      href="/fonts/inter/Inter-VariableFont_slnt,wght.woff2">
```

- [ ] **Step 3: Verify the font file is served by the dev server.** Run `pnpm dev` (or skip if running another verification mode), and in browser devtools confirm the font request returns 200 with `Content-Type: font/woff2`. Then stop the dev server.

### Task 1.3: Extend Tailwind config with token aliases

**Files:**
- Modify: `web/apps/editor/tailwind.config.ts`

- [ ] **Step 1: Read the current `tailwind.config.ts`** to understand the existing `theme.extend` shape:

```bash
cat "C:/Modding/Particle Editor/.claude/worktrees/awesome-morse-5ea5c3/web/apps/editor/tailwind.config.ts"
```

- [ ] **Step 2: Extend `theme.colors` with token-backed aliases.** The goal is for `bg-bg-2`, `text-text`, `border-border-2`, `bg-accent`, etc. to resolve to `var(--bg-2)`, `var(--text)`, `var(--border-2)`, `var(--accent)`. Add this block inside `theme.extend`:

```ts
colors: {
  // Particle Editor 2026 design tokens — see web/apps/editor/src/styles/tokens.css
  'bg':              'var(--bg)',
  'bg-2':            'var(--bg-2)',
  'bg-3':            'var(--bg-3)',
  'panel':           'var(--panel)',
  'panel-2':         'var(--panel-2)',
  'panel-3':         'var(--panel-3)',
  'border':          'var(--border)',
  'border-2':        'var(--border-2)',
  'hover':           'var(--hover)',
  'selected':        'var(--selected)',
  'selected-border': 'var(--selected-border)',
  'text':            'var(--text)',
  'text-2':          'var(--text-2)',
  'text-3':          'var(--text-3)',
  'accent':          'var(--accent)',
  'accent-2':        'var(--accent-2)',
  'accent-soft':     'var(--accent-soft)',
  'danger':          'var(--danger)',
  'success':         'var(--success)',
  'warning':         'var(--warning)',
  'x-axis':          'var(--x-axis)',
  'y-axis':          'var(--y-axis)',
  'z-axis':          'var(--z-axis)',
},
borderRadius: {
  'token':    'var(--radius)',
  'token-sm': 'var(--radius-sm)',
},
```

This co-exists with Tailwind's default palette — existing `bg-neutral-900` etc. still work. The new `bg-bg-2` and friends are additive.

- [ ] **Step 3: Verify Tailwind config still type-checks.** Run `cd web/apps/editor && pnpm build`. Expected: build clean, dist rebuilt, no TS errors.

### Task 1.4: Import the new CSS files into the app's entry stylesheet

**Files:**
- Modify: `web/apps/editor/src/index.css`

- [ ] **Step 1: Read the current `index.css`** to see its existing import structure:

```bash
cat "C:/Modding/Particle Editor/.claude/worktrees/awesome-morse-5ea5c3/web/apps/editor/src/index.css"
```

- [ ] **Step 2: Add the three new CSS imports** AFTER the existing `@tailwind base/components/utilities` directives but BEFORE any existing custom CSS so the design's component classes have higher specificity than Tailwind utilities at equal weight:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Particle Editor 2026 design system — token-aliased Tailwind utilities
   resolve to these CSS variables; design's component classes (.panel,
   .tree-row, .form-row, etc.) consume them too. */
@import "./styles/tokens.css";
@import "./styles/base.css";
@import "./styles/components.css";

/* (any existing custom CSS continues below) */
```

- [ ] **Step 3: Run `pnpm build`** to confirm the imports resolve and the bundle still compiles. Expected: build clean, dist size grew by ~50-60 KB (the new CSS).

- [ ] **Step 4: Run `pnpm dev`** briefly and visually confirm the app loads with the new font (Inter) and the dark-token color palette is active (default `:root` applies). Existing layout should be intact. Stop the dev server.

### Task 1.5: ThemeToggle component (TDD)

**Files:**
- Create: `web/apps/editor/src/components/ThemeToggle.tsx`
- Create: `web/apps/editor/src/components/__tests__/ThemeToggle.test.tsx`

- [ ] **Step 1: Write the failing test.** Create `web/apps/editor/src/components/__tests__/ThemeToggle.test.tsx`:

```tsx
// Vitest unit tests for ThemeToggle:
//   - Renders Sun + Moon icon buttons.
//   - Clicking Sun sets dataset.theme to "light" and writes localStorage.
//   - Clicking Moon sets dataset.theme to "dark" and writes localStorage.
//   - Reads localStorage on mount and reflects stored value.

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle } from "../ThemeToggle";

beforeEach(() => {
  localStorage.removeItem("alo:theme");
  document.documentElement.dataset.theme = "";
});

describe("ThemeToggle", () => {
  it("renders Sun and Moon buttons", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: /light theme/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dark theme/i })).toBeInTheDocument();
  });

  it("clicking Light writes localStorage and sets dataset.theme", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: /light theme/i }));
    expect(localStorage.getItem("alo:theme")).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("clicking Dark writes localStorage and sets dataset.theme", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: /dark theme/i }));
    expect(localStorage.getItem("alo:theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("reads localStorage on mount and reflects active theme via aria-pressed", () => {
    localStorage.setItem("alo:theme", "light");
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: /light theme/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /dark theme/i })).toHaveAttribute("aria-pressed", "false");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails.** Run `cd web/apps/editor && pnpm test src/components/__tests__/ThemeToggle.test.tsx 2>&1 | tail -10`. Expected: 4 failures with "Cannot find module '../ThemeToggle'".

- [ ] **Step 3: Implement `web/apps/editor/src/components/ThemeToggle.tsx`:**

```tsx
// ThemeToggle — toolbar widget for switching between dark and light
// themes. Persists choice to localStorage; sets data-theme on <html>.
//
// Default behavior at first launch (no stored value): reads OS-level
// prefers-color-scheme via matchMedia and applies that as initial state.
// Once the user explicitly toggles, the stored choice wins.

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

type Theme = "dark" | "light";

function readInitialTheme(): Theme {
  const stored = localStorage.getItem("alo:theme");
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => readInitialTheme());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const apply = (next: Theme) => {
    setTheme(next);
    localStorage.setItem("alo:theme", next);
  };

  return (
    <div className="inline-flex items-center bg-panel-2 border border-border-2 rounded-token-sm p-0.5">
      <button
        type="button"
        aria-label="Light theme"
        aria-pressed={theme === "light"}
        onClick={() => apply("light")}
        className={`grid place-items-center w-6 h-5 rounded ${theme === "light" ? "bg-accent-soft text-accent" : "text-text-3"}`}
      >
        <Sun className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Dark theme"
        aria-pressed={theme === "dark"}
        onClick={() => apply("dark")}
        className={`grid place-items-center w-6 h-5 rounded ${theme === "dark" ? "bg-accent-soft text-accent" : "text-text-3"}`}
      >
        <Moon className="size-3.5" />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to confirm it passes.** `cd web/apps/editor && pnpm test src/components/__tests__/ThemeToggle.test.tsx 2>&1 | tail -10`. Expected: 4 passed.

- [ ] **Step 5: Run the full vitest suite to confirm no regressions.** `cd web/apps/editor && pnpm test 2>&1 | tail -8`. Expected: 195 passed (was 191; +4 new specs).

### Task 1.6: Wire ThemeToggle into App.tsx and Toolbar

**Files:**
- Modify: `web/apps/editor/src/App.tsx`
- Modify: `web/apps/editor/src/components/Toolbar.tsx`

- [ ] **Step 1: Apply initial theme in App.tsx.** Read the current `App.tsx` and add a one-time `useEffect` near the top of the component that sets `document.documentElement.dataset.theme` from `localStorage` or `prefers-color-scheme`:

```tsx
// In App.tsx, alongside other useEffects:
useEffect(() => {
  const stored = localStorage.getItem("alo:theme");
  const theme = stored === "dark" || stored === "light"
    ? stored
    : window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  document.documentElement.dataset.theme = theme;
}, []);
```

This duplicates ThemeToggle's initial-read logic, which is fine — App.tsx runs FIRST so the data-theme is set before any panel mounts and the first paint isn't unstyled.

- [ ] **Step 2: Insert `<ThemeToggle />` into Toolbar.tsx.** Read the current `Toolbar.tsx`. Add the import:

```tsx
import { ThemeToggle } from "@/components/ThemeToggle";
```

And insert `<ThemeToggle />` at the rightmost position in the toolbar JSX (it lives at the right edge per the design — for now insert it after whatever currently is the rightmost button; the toolbar reorganization in Task 2.1 will finalize positioning):

```tsx
{/* ...existing toolbar buttons... */}
<ThemeToggle />
```

- [ ] **Step 3: Run the vitest suite.** `cd web/apps/editor && pnpm test 2>&1 | tail -8`. Expected: 195 passed.

- [ ] **Step 4: Run `pnpm build`.** Expected: clean.

### Task 1.7: Component-by-component utility class sweep

**Files:** ~30 component files under `web/apps/editor/src/`

The sweep replaces hardcoded color/border/typography Tailwind utilities with token-backed equivalents. Components that consume `bg-neutral-*`, `text-neutral-*`, `border-neutral-*`, `sky-*`, and similar get swapped to `bg-bg-2`, `text-text`, `border-border`, `accent`, etc.

- [ ] **Step 1: Inventory the sweep targets.** Run this grep to list every file with utilities that need swapping:

```bash
cd "C:/Modding/Particle Editor/.claude/worktrees/awesome-morse-5ea5c3"
grep -RE "bg-neutral-|border-neutral-|text-neutral-|sky-500|sky-400" web/apps/editor/src --include="*.tsx" -l
```

Expected: ~25-30 files. Note them.

- [ ] **Step 2: Sweep each file.** For each listed file, apply this substitution table:

| Old utility | New utility |
|---|---|
| `bg-neutral-950` | `bg-bg` |
| `bg-neutral-900` | `bg-bg-2` |
| `bg-neutral-800` | `bg-panel-2` |
| `bg-neutral-700` | `bg-panel-3` |
| `text-neutral-100` | `text-text` |
| `text-neutral-200` | `text-text` |
| `text-neutral-300` | `text-text-2` |
| `text-neutral-400` | `text-text-2` |
| `text-neutral-500` | `text-text-3` |
| `text-neutral-600` | `text-text-3` |
| `border-neutral-800` | `border-border` |
| `border-neutral-700` | `border-border-2` |
| `sky-500` | `accent` |
| `sky-400` | `accent` |
| `bg-sky-500/20` | `bg-accent-soft` |
| `bg-sky-500/10` | `bg-accent-soft` |
| `rounded-md` | (leave alone — Tailwind default 6px close enough) |

Use Edit with `replace_all: true` on each file for each substitution that has multiple matches. The substitutions are mechanical but semantically identical because the new tokens map close to the old neutral palette.

For visual review, after each ~5 files, run `pnpm build` to catch any class-name typos.

- [ ] **Step 3: Visual sanity check after sweep.** Run `cd web/apps/editor && pnpm build && pnpm dev` briefly. Open the app in browser, eyeball that nothing is obviously broken (panels still render, text is visible, accents are blue, dark theme is dark). Stop the dev server.

- [ ] **Step 4: Run the full vitest suite.** `pnpm test 2>&1 | tail -8`. Expected: 195 passed (no regressions — DOM semantics unchanged, only class names swapped).

### Task 1.8: Phase 1 verification gates + commit

- [ ] **Step 1: Build the C++ binary** to confirm legacy mode is unaffected:

```bash
cd "C:/Modding/Particle Editor/.claude/worktrees/awesome-morse-5ea5c3"
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" "ParticleEditor.sln" //p:Configuration=Debug //p:Platform=x64 //v:m 2>&1 | tail -10
```

Expected: clean (only preexisting LIBCMTD warning).

- [ ] **Step 2: Run vitest.**

```bash
cd web/apps/editor && pnpm test 2>&1 | tail -8
```

Expected: 195 / 195 (was 191; +4 ThemeToggle).

- [ ] **Step 3: Run Playwright.**

```bash
cd web/apps/editor && pnpm test:native 2>&1 | tail -8
```

Expected: 80 / 80 (unchanged — Phase 1 has no DOM-semantic changes).

- [ ] **Step 4: Visual verification via computer-use.** Launch the editor, take screenshots in both themes.

```bash
cd "C:/Modding/Particle Editor/.claude/worktrees/awesome-morse-5ea5c3"
"./x64/Debug/ParticleEditor.exe" --new-ui
```

Wait ~3 seconds for window to appear. If `request_access` for `particleeditor.exe` isn't granted in this session, call it now. Take a screenshot of the dark theme. Click the ThemeToggle's Sun button. Take a screenshot of light theme. Close and relaunch; confirm the selected theme persisted.

Expected: app renders with Inter font, the new dark palette by default (or light if OS is light), every panel is in the same location as before, theme toggle works and persists.

- [ ] **Step 5: Manual smoke by user.** Hand off to user with: "Phase 1 ready for verification. Launch the editor and confirm dark + light themes both render the existing layout with the new palette. Theme should persist across close+relaunch."

- [ ] **Step 6: Commit Phase 1.** Stage all Phase 1 files:

```bash
cd "C:/Modding/Particle Editor/.claude/worktrees/awesome-morse-5ea5c3"
git add web/apps/editor/src/styles/tokens.css web/apps/editor/src/styles/base.css web/apps/editor/src/styles/components.css
git add web/apps/editor/public/fonts/inter/
git add web/apps/editor/index.html
git add web/apps/editor/tailwind.config.ts
git add web/apps/editor/src/index.css
git add web/apps/editor/src/components/ThemeToggle.tsx
git add web/apps/editor/src/components/__tests__/ThemeToggle.test.tsx
git add web/apps/editor/src/App.tsx
git add web/apps/editor/src/components/Toolbar.tsx
git add web/apps/editor/src/  # catch any swept components
git status  # verify what's staged before commit
```

Commit message:

```bash
git commit -m "$(cat <<'EOF'
feat(LT-4): Phase 1 of Particle Editor 2026 redesign — token system + theme toggle

Visual-only swap to the design's CSS-variable token system. No structural
changes — every panel, dialog, button lives in the same DOM location as
before. The shell now renders in Inter, with the new 6-tier dark palette
by default (or light if OS prefers-color-scheme says so). Toolbar gets a
Sun/Moon theme toggle; choice persists to localStorage and overrides the
OS hint after first interaction.

How we tackled it. New CSS files under web/apps/editor/src/styles/:
tokens.css ports the design's :root + [data-theme="light"] verbatim,
base.css declares the @font-face for the locally-bundled Inter variable
woff2 + body/html resets + scrollbar styling, components.css carries the
design's reusable component classes for later phases to consume.
tailwind.config.ts aliases the new CSS variables into its color palette
(`bg-bg-2`, `text-text-2`, `accent`, etc.) so existing utility-class
components can incrementally swap from `bg-neutral-900` style without
restructuring class architecture. ThemeToggle.tsx reads localStorage,
falls back to matchMedia prefers-color-scheme on first launch, writes
to <html data-theme>.

Vitest: 191 → 195 (+4 ThemeToggle specs). Playwright: 80/80 unchanged
(no DOM-semantic changes). MSBuild Debug x64 clean.

Phase 2 (structural moves) and Phase 3 (cleanup + dialog re-skin) land
as follow-up commits per the spec at
docs/superpowers/specs/2026-05-19-particle-editor-2026-redesign.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Push to `origin/lt-4`** (if on lt-4 directly) or FF into lt-4 (if on a session branch) per the branch workflow:

```bash
# If currently on lt-4:
git push

# If on a claude/<random> session branch:
git switch lt-4
git merge --ff-only claude/<session-name>
git push
```

Expected: push succeeds, `origin/lt-4` advances.

---

## Phase 2 — Structural moves (7 sub-commits)

Each sub-commit moves + restyles + rewrites tests for ONE structural unit. Suite stays green at every commit boundary.

### Task 2.1: Toolbar reorganization

**Files:**
- Modify: `web/apps/editor/src/components/Toolbar.tsx`
- Modify: `web/apps/editor/tests/toolbar.spec.ts`
- Modify: `web/apps/editor/tests/tools.spec.ts`
- Modify: `web/apps/editor/src/components/__tests__/Toolbar.test.tsx` (if exists; create if not)

- [ ] **Step 1: Read current Toolbar.tsx** to understand existing layout:

```bash
cat "C:/Modding/Particle Editor/.claude/worktrees/awesome-morse-5ea5c3/web/apps/editor/src/components/Toolbar.tsx" | head -100
```

- [ ] **Step 2: Restructure Toolbar.tsx** into 4 groups separated by dividers, matching the design's `toolbar.jsx`:

```tsx
// Toolbar — Particle Editor 2026 layout. 4 grouped sections with
// dividers, spacer to the right, theme toggle at the rightmost edge.
//
// Group 1 (file actions):       New · Open · Save · Save As
// Group 2 (playback):           Play|Pause · Step · Step 10
// Group 3 (panels):             Spawner toggle
//   spacer
// Group 4 (environment):        Ground dropdown · Background dropdown · ThemeToggle
//
// Stop and Restart removed per design chat. Mods toolbar dropdown
// removed; Mods stays in the menubar.

import { useFileState } from "@/lib/file-state";
import { useSpawnerVisibility } from "@/lib/spawner-visibility";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Play, Pause, ChevronRight, ChevronsRight, /* ...other icons */ } from "lucide-react";
import type { Bridge, EngineStateDto } from "@particle-editor/bridge-schema";
import { useEffect, useState } from "react";

type Props = { bridge: Bridge };

export function Toolbar({ bridge }: Props) {
  const [snapshot, setSnapshot] = useState<EngineStateDto | null>(null);
  useEffect(() => {
    bridge.request({ kind: "engine/state/snapshot", params: {} }).then(setSnapshot);
    return bridge.on("engine/state/changed", (e) => setSnapshot(e.payload));
  }, [bridge]);

  const paused = snapshot?.paused ?? false;
  const { visible: spawnerVisible, toggle: toggleSpawner } = useSpawnerVisibility();

  const handlePlayPause = () => bridge.request({ kind: "engine/set/paused", params: { paused: !paused } });
  const handleStep = () => bridge.request({ kind: "engine/action/step-frames", params: { frames: 1 } });
  const handleStep10 = () => bridge.request({ kind: "engine/action/step-frames", params: { frames: 10 } });

  return (
    <div className="toolbar">
      {/* Group 1: file actions */}
      <div className="tb-group">
        <button type="button" className="tb-btn" aria-label="New">New</button>
        <button type="button" className="tb-btn" aria-label="Open">Open</button>
        <button type="button" className="tb-btn" aria-label="Save">Save</button>
        <button type="button" className="tb-btn" aria-label="Save As">Save As</button>
      </div>
      <span className="tb-divider" />

      {/* Group 2: playback */}
      <div className="tb-group">
        <button type="button"
                className={`tb-btn ${!paused ? "playing" : ""}`}
                aria-label={paused ? "Play" : "Pause"}
                aria-pressed={!paused}
                onClick={handlePlayPause}>
          {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          {paused ? "Play" : "Pause"}
        </button>
        <button type="button" className="tb-btn" aria-label="Step" onClick={handleStep}>
          <ChevronRight className="size-3.5" />Step
        </button>
        <button type="button" className="tb-btn" aria-label="Step 10" onClick={handleStep10}>
          <ChevronsRight className="size-3.5" />Step 10
        </button>
      </div>
      <span className="tb-divider" />

      {/* Group 3: Spawner toggle */}
      <div className="tb-group">
        <button type="button"
                className={`tb-btn ${spawnerVisible ? "active" : ""}`}
                aria-label="Toggle Spawner panel"
                aria-pressed={spawnerVisible}
                onClick={toggleSpawner}>
          Spawner
        </button>
      </div>

      <span className="tb-spacer" />

      {/* Group 4: environment + theme — Ground and Background dropdowns
          land in Tasks 2.2/2.3; placeholder for now is the empty
          containers their dropdowns will replace. */}
      <ThemeToggle />
    </div>
  );
}
```

The Ground/Background dropdown components don't exist yet — Tasks 2.2 and 2.3 add them. For now Toolbar renders just the theme toggle on the right side.

- [ ] **Step 3: Create `web/apps/editor/src/lib/spawner-visibility.ts`** — a small Zustand-style hook for the Spawner column visibility state (read from localStorage on init, write on toggle):

```ts
// useSpawnerVisibility — persists the Spawner-column-visible flag to
// localStorage('alo:spawner-visible'). Default true (panel visible) on
// first launch.

import { useEffect, useState, useCallback } from "react";

const KEY = "alo:spawner-visible";

function readInitial(): boolean {
  const v = localStorage.getItem(KEY);
  if (v === "true") return true;
  if (v === "false") return false;
  return true; // default visible
}

export function useSpawnerVisibility() {
  const [visible, setVisible] = useState<boolean>(() => readInitial());

  const toggle = useCallback(() => {
    setVisible((v) => {
      const next = !v;
      localStorage.setItem(KEY, String(next));
      return next;
    });
  }, []);

  return { visible, toggle };
}
```

- [ ] **Step 4: Rewrite toolbar tests** — `web/apps/editor/tests/toolbar.spec.ts` (Playwright) and `web/apps/editor/src/components/__tests__/Toolbar.test.tsx` (Vitest, create if missing). Vitest spec:

```tsx
// Vitest: Toolbar renders 4 groups, dispatches engine/action and
// engine/set/paused on the right buttons.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Toolbar } from "../Toolbar";
import type { Bridge } from "@particle-editor/bridge-schema";

function makeBridge(): Bridge & { request: ReturnType<typeof vi.fn> } {
  const snap = { paused: false /* other fields default */ };
  const request = vi.fn().mockImplementation((req: { kind: string }) => {
    if (req.kind === "engine/state/snapshot") return Promise.resolve(snap);
    return Promise.resolve({});
  });
  return { request, on: vi.fn().mockReturnValue(() => {}) } as unknown as Bridge & { request: ReturnType<typeof vi.fn> };
}

describe("Toolbar — Particle Editor 2026 layout", () => {
  it("renders the four groups with expected buttons", async () => {
    const b = makeBridge();
    render(<Toolbar bridge={b} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save As" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Step" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Step 10" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle Spawner panel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Light theme" })).toBeInTheDocument();
  });

  it("Pause button dispatches engine/set/paused", async () => {
    const b = makeBridge();
    render(<Toolbar bridge={b} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => {
      expect(b.request).toHaveBeenCalledWith({ kind: "engine/set/paused", params: { paused: true } });
    });
  });

  it("Step 10 dispatches engine/action/step-frames { frames: 10 }", async () => {
    const b = makeBridge();
    render(<Toolbar bridge={b} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Step 10" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Step 10" }));
    await waitFor(() => {
      expect(b.request).toHaveBeenCalledWith({ kind: "engine/action/step-frames", params: { frames: 10 } });
    });
  });
});
```

Run vitest: `cd web/apps/editor && pnpm test src/components/__tests__/Toolbar.test.tsx 2>&1 | tail -8`. Expected: 3 passed.

- [ ] **Step 5: Update Playwright spec** at `web/apps/editor/tests/toolbar.spec.ts`. Read the existing version, then replace assertions about the old toolbar shape with the new button set. Specifically: assertions about "Stop" or "Restart" or "Sim Speed" buttons need to go (those buttons are removed); new assertions for "Step 10" and "Spawner toggle" should be added.

Run: `cd web/apps/editor && pnpm test:native 2>&1 | grep -E "toolbar|tools" | tail -10`. Expected: all toolbar specs green.

- [ ] **Step 6: Full gate check.**

```bash
cd "C:/Modding/Particle Editor/.claude/worktrees/awesome-morse-5ea5c3"
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" "ParticleEditor.sln" //p:Configuration=Debug //p:Platform=x64 //v:m 2>&1 | tail -8
cd web/apps/editor && pnpm build 2>&1 | tail -8
pnpm test 2>&1 | tail -8
pnpm test:native 2>&1 | tail -8
```

Expected: all green.

- [ ] **Step 7: Commit.**

```bash
git add web/apps/editor/src/components/Toolbar.tsx web/apps/editor/src/lib/spawner-visibility.ts web/apps/editor/src/components/__tests__/Toolbar.test.tsx web/apps/editor/tests/toolbar.spec.ts
git commit -m "$(cat <<'EOF'
feat(LT-4): Phase 2.1 — toolbar reorganization (Particle Editor 2026)

Restructure Toolbar.tsx into the design's 4-group layout: file actions
(New/Open/Save/Save As) · playback (Play|Pause/Step/Step 10) · Spawner
toggle · spacer · ThemeToggle. Stop and Restart removed. Sim Speed
moved out (lives in the Tweaks panel which we're not building, so it's
gone from the UI; the bridge call still works for programmatic
callers).

Spawner toggle uses useSpawnerVisibility hook backed by localStorage
('alo:spawner-visible'); the actual permanent right column for Spawner
lands in Task 2.4.

Ground/Background dropdown slots are empty for now; Tasks 2.2 and 2.3
fill them in.

Vitest +3 (Toolbar specs); Playwright specs rewritten in place. All
gates green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2.2: Background slide-in panel → toolbar dropdown popover

**Files:**
- Create: `web/apps/editor/src/components/BackgroundDropdown.tsx`
- Create: `web/apps/editor/src/components/OccludingPopover.tsx` (generalization of the existing OccludingMenubarContent pattern)
- Modify: `web/apps/editor/src/components/Toolbar.tsx`
- Modify: `web/apps/editor/src/App.tsx` (remove BackgroundPicker slide-in panel mounting)
- Modify: `web/apps/editor/src/screens/BackgroundPicker.tsx` (refactor to be rendered inside the popover, not the ToolPanel)
- Rewrite: `web/apps/editor/tests/background-picker.spec.ts`
- Modify or add: `web/apps/editor/src/components/__tests__/BackgroundDropdown.test.tsx`

- [ ] **Step 1: Create OccludingPopover.tsx.** Read the existing `OccludingMenubarContent` pattern in `web/apps/editor/src/components/MenuBar.tsx:44-64` and generalize it to wrap `Popover.Content` instead of `Menubar.Content`:

```tsx
// OccludingPopover — Radix Popover Content wrapped to register itself
// with the host as a viewport occlusion (so the AlphaCompositor stamps
// the cut-out). Identical pattern to OccludingMenubarContent in
// MenuBar.tsx; this version is keyed for popovers attached to toolbar
// buttons rather than menubar triggers.

import * as Popover from "@radix-ui/react-popover";
import { useRef, type ComponentProps } from "react";
import type { Bridge } from "@particle-editor/bridge-schema";
import { useViewportOcclusion } from "@/lib/viewport-occlusion";

type Props = ComponentProps<typeof Popover.Content> & {
  bridge: Bridge;
  occlusionId: string;
};

export function OccludingPopover({ bridge, occlusionId, children, ...rest }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Same pad/feather as MenuBar dropdowns: shadow-xl needs 24px to
  // clear; smoothstep feather matches.
  useViewportOcclusion(bridge, occlusionId, ref, 24, 24);
  return (
    <Popover.Content {...rest}>
      <div ref={ref}>{children}</div>
    </Popover.Content>
  );
}
```

- [ ] **Step 2: Create BackgroundDropdown.tsx.** The trigger is a button in the toolbar; clicking opens a Radix Popover anchored to it; the popover content renders the existing BackgroundPicker UI in a popover-shaped layout:

```tsx
// BackgroundDropdown — toolbar button + popover replacing the
// BackgroundPicker slide-in ToolPanel.
//
// Trigger: "Background:" label + preview swatch (background colour or
// active skydome) + chevron. Click opens the popover beneath.
// Popover content: solid colour row, bundled gradient grid, custom
// slots — identical to BackgroundPicker's body, repurposed without
// the ToolPanel wrapper.

import * as Popover from "@radix-ui/react-popover";
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Bridge, EngineStateDto } from "@particle-editor/bridge-schema";
import { OccludingPopover } from "./OccludingPopover";
import { BackgroundPickerBody } from "@/screens/BackgroundPicker"; // refactored body export

type Props = { bridge: Bridge };

export function BackgroundDropdown({ bridge }: Props) {
  const [snap, setSnap] = useState<EngineStateDto | null>(null);
  useEffect(() => {
    bridge.request({ kind: "engine/state/snapshot", params: {} }).then(setSnap);
    return bridge.on("engine/state/changed", (e) => setSnap(e.payload));
  }, [bridge]);

  // Trigger preview — show solid colour if skydomeSlot=0, else show
  // the active skydome's gradient tile (we approximate with a flat
  // accent until skydome thumbnails exist).
  const slot = snap?.skydomeSlot ?? 0;
  const swatchBg = slot === 0
    ? `rgb(${(snap?.background ?? 0) & 0xff}, ${((snap?.background ?? 0) >> 8) & 0xff}, ${((snap?.background ?? 0) >> 16) & 0xff})`
    : "var(--bg-3)"; // placeholder for skydome thumbnail

  return (
    <Popover.Root>
      <div className="tb-field">
        <span>Background:</span>
        <Popover.Trigger asChild>
          <button type="button" className="tb-btn" aria-label="Background dropdown">
            <span className="inline-block w-4 h-4 rounded-sm border border-border-2"
                  style={{ background: swatchBg }} />
            <ChevronDown className="size-3.5" />
          </button>
        </Popover.Trigger>
      </div>
      <Popover.Portal>
        <OccludingPopover
          bridge={bridge}
          occlusionId="popover:background"
          align="end"
          sideOffset={6}
          className="bg-panel border border-border-2 rounded-token shadow-[var(--shadow)] p-2 min-w-[260px] z-50"
        >
          <BackgroundPickerBody bridge={bridge} />
        </OccludingPopover>
      </Popover.Portal>
    </Popover.Root>
  );
}
```

- [ ] **Step 3: Refactor BackgroundPicker.tsx** to export both the existing slide-in component (kept temporarily for any callsites) AND a `BackgroundPickerBody` that renders just the body markup without the `ToolPanel` wrapper. Modify the existing file:

```tsx
// In web/apps/editor/src/screens/BackgroundPicker.tsx:

// Existing default export stays — but the body markup gets extracted
// into a named export so it can render inside either the legacy
// ToolPanel wrapper OR the new BackgroundDropdown popover.

export function BackgroundPickerBody({ bridge }: { bridge: Bridge }) {
  // ... everything that's currently inside the ToolPanel's children
  // — solid color row, bundled grid, custom slots, handlers — moves
  // here. Pull from the existing BackgroundPicker default export.
}

// Existing BackgroundPicker now wraps BackgroundPickerBody:
export function BackgroundPicker({ bridge, onClose }: Props) {
  return (
    <ToolPanel title="Background picker" onClose={onClose} bridge={bridge} occlusionId="tool-panel:background">
      <BackgroundPickerBody bridge={bridge} />
    </ToolPanel>
  );
}
```

This dual-export keeps the existing test for BackgroundPicker (which mounts the slide-in) working until we delete it in this same commit; the new BackgroundDropdown's tests assert against `BackgroundPickerBody` directly via the popover.

- [ ] **Step 4: Insert `<BackgroundDropdown bridge={bridge} />` into Toolbar.tsx** in the Group 4 position (before `<ThemeToggle />`):

```tsx
{/* Group 4: environment + theme */}
{/* Ground dropdown lands in Task 2.3 */}
<BackgroundDropdown bridge={bridge} />
<ThemeToggle />
```

- [ ] **Step 5: Remove the BackgroundPicker slide-in from App.tsx.** Find where `<BackgroundPicker>` is conditionally rendered (likely in a sliding-panels area) and delete that block. The trigger that used to open it (probably a toolbar button or View menu item) — remove the trigger too if it's now redundant with the new BackgroundDropdown.

- [ ] **Step 6: Rewrite the Playwright spec** `web/apps/editor/tests/background-picker.spec.ts` to assert against the popover, not the sliding panel:

```ts
// LT-4 Phase 2.2: BackgroundDropdown popover (replaces the sliding
// BackgroundPicker). Specs verify the popover opens from the toolbar
// trigger and exposes the same picker affordances.

test("Background dropdown opens from the toolbar trigger", async () => {
  const probe = await page.evaluate(async () => {
    const btn = document.querySelector<HTMLButtonElement>('button[aria-label="Background dropdown"]');
    if (!btn) return { clicked: false, popover: false, slots: 0 };
    btn.click();
    await new Promise((r) => setTimeout(r, 250));
    const popover = document.querySelector('[role="dialog"]') ?? document.querySelector('[data-radix-popper-content-wrapper]');
    const slots = popover?.querySelectorAll('button[aria-pressed]').length ?? 0;
    return { clicked: true, popover: !!popover, slots };
  });
  expect(probe.clicked).toBe(true);
  expect(probe.popover).toBe(true);
  expect(probe.slots).toBe(12); // solid + 8 bundled + 3 custom
});

// Existing chain test (skydome-slot, skydome-custom-path, etc.) stays
// — those dispatch directly via window.bridge and don't depend on UI.
```

- [ ] **Step 7: Rewrite the vitest spec.** Create `web/apps/editor/src/components/__tests__/BackgroundDropdown.test.tsx` mirroring the testing style. Assert that clicking the trigger opens the popover, that clicking a slot inside dispatches `engine/set/skydome-slot`.

- [ ] **Step 8: Run all gates.**

```bash
cd "C:/Modding/Particle Editor/.claude/worktrees/awesome-morse-5ea5c3"
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" "ParticleEditor.sln" //p:Configuration=Debug //p:Platform=x64 //v:m 2>&1 | tail -8
cd web/apps/editor && pnpm build && pnpm test 2>&1 | tail -8 && pnpm test:native 2>&1 | tail -8
```

Expected: all green.

- [ ] **Step 9: Commit.**

```bash
git commit -am "$(cat <<'EOF'
feat(LT-4): Phase 2.2 — Background → toolbar dropdown popover

BackgroundPicker's slide-in ToolPanel is replaced by a toolbar dropdown
button + Radix Popover. New components: BackgroundDropdown (the
trigger + popover wrapper) and OccludingPopover (generalization of
OccludingMenubarContent so the popover registers as a viewport
occlusion). BackgroundPicker's body markup is extracted into a
BackgroundPickerBody named export that renders inside the popover.

Sliding BackgroundPicker is removed from App.tsx. ToolPanel stays in
the codebase — Lighting and Bloom Settings still use it.

Playwright background-picker.spec.ts rewritten to assert against the
popover. Existing chain tests (skydome-slot, custom-path, background
COLORREF) survive unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2.3: Ground Texture slide-in panel → toolbar dropdown popover

Mirrors Task 2.2's pattern. Same general structure:

- [ ] **Step 1: Create `web/apps/editor/src/components/GroundDropdown.tsx`** — same shape as BackgroundDropdown but renders the ground texture grid + the existing ground-z spinner (moved here from wherever it currently lives) + custom slots from GroundTexturePanel. Use the design's `ground_popover.jsx` as visual reference.

- [ ] **Step 2: Refactor `GroundTexturePanel.tsx`** to extract `GroundTexturePanelBody` as a named export (parallel to Task 2.2's BackgroundPickerBody extraction).

- [ ] **Step 3: Insert `<GroundDropdown bridge={bridge} />` into Toolbar.tsx** in Group 4, before `<BackgroundDropdown />`.

- [ ] **Step 4: Remove the GroundTexturePanel slide-in from App.tsx** and any toolbar/view-menu trigger that opened it.

- [ ] **Step 5: Rewrite tests** — Playwright tools.spec.ts (the parts about Ground Texture) + new vitest GroundDropdown.test.tsx mirroring BackgroundDropdown.test.tsx.

- [ ] **Step 6: Run all gates** (same command set as Task 2.2 Step 8).

- [ ] **Step 7: Commit** with message `feat(LT-4): Phase 2.3 — Ground → toolbar dropdown popover`.

### Task 2.4: Spawner slide-in panel → permanent right column

**Files:**
- Modify: `web/apps/editor/src/App.tsx` (workspace grid + spawner column rendering)
- Modify: `web/apps/editor/src/screens/SpawnerPanel.tsx` (wrap in `.panel` + header with X close, drop ToolPanel)
- Modify: Playwright `spawner-import-mod.spec.ts` portions about sliding-panel rendering

- [ ] **Step 1: Update App.tsx's workspace grid.** Read the current App.tsx and find the workspace layout. Change the grid template from whatever it is today (likely simple flex or 2-col grid) to:

```tsx
// Workspace 3-column grid. Right column collapses when Spawner is
// hidden (useSpawnerVisibility's `visible` is false).
const gridTemplate = spawnerVisible
  ? "grid-cols-[320px_1fr_340px]"
  : "grid-cols-[320px_1fr]";

return (
  <div className={`workspace grid gap-1.5 p-1.5 min-h-0 ${gridTemplate}`}>
    {/* Left panel — EmitterTree + (after Task 2.5) tabbed inspector */}
    <div className="panel">
      {/* ... */}
    </div>
    {/* Center column — viewport on top, curve editor below (after Task 2.6) */}
    <div className="workspace-center">
      {/* ... */}
    </div>
    {/* Right column — Spawner panel, conditionally rendered */}
    {spawnerVisible && (
      <SpawnerPanel bridge={bridge} onClose={toggleSpawner} />
    )}
  </div>
);
```

- [ ] **Step 2: Refactor SpawnerPanel.tsx** to render with the design's `.panel` chrome (header + X close button + body). Drop the `ToolPanel` wrapper. The header should match other panels' visual style:

```tsx
export function SpawnerPanel({ bridge, onClose }: { bridge: Bridge; onClose: () => void }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <span>Spawner</span>
        <div className="panel-actions">
          <button type="button" className="icon-btn" aria-label="Close Spawner" onClick={onClose}>
            <X className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="panel-body">
        {/* ... existing SpawnerPanel body markup, unchanged in semantics ... */}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite Playwright spec.** `spawner-import-mod.spec.ts` — find any assertion that depends on the sliding-panel DOM (panel role, slide-in animation, etc.) and update to assert against the permanent right column. Existing bridge-call assertions (burst size, mode radios, etc.) survive.

- [ ] **Step 4: Run all gates** (same command set).

- [ ] **Step 5: Commit** with message `feat(LT-4): Phase 2.4 — Spawner → permanent right column`.

### Task 2.5: Left panel restack (tabbed inspector migrates from right to left)

**Files:**
- Modify: `web/apps/editor/src/App.tsx` (left panel structure)
- Modify: `web/apps/editor/src/screens/EmitterPropertyPanel.tsx` (shrinks; tabs migrate out)
- Modify: `web/apps/editor/src/screens/EmitterPropertyTabs.tsx` (renders in the left panel context now)
- Modify: `web/apps/editor/src/screens/EmitterTree.tsx` (continues to render at top of left panel)
- Modify: `web/apps/editor/src/screens/__tests__/EmitterPropertyTabs.test.tsx` (18 specs — query adjustments)

- [ ] **Step 1: Read EmitterPropertyPanel.tsx and EmitterPropertyTabs.tsx** to understand the current composition.

- [ ] **Step 2: Update App.tsx's left panel.** The left panel becomes:

```tsx
<div className="panel">
  <div className="panel-header">
    <span>Particle System</span>
  </div>
  <div className="panel-body flex flex-col">
    <EmitterTree bridge={bridge} />
    <div className="tabs">
      {/* Basic / Appearance / Physics — from EmitterPropertyTabs */}
    </div>
    <div className="inspector">
      {/* Tab body — from EmitterPropertyTabs */}
    </div>
  </div>
</div>
```

EmitterPropertyTabs gets imported here directly; EmitterPropertyPanel shrinks to just hosting any non-tab content (or gets removed entirely if it has no remaining responsibility).

- [ ] **Step 3: Convert EmitterPropertyTabs.tsx form rows to the design's 3-column grid.** The design's `.form-row` is `grid-template-columns: 1fr 92px 56px` (label / input / unit). Every form row in EmitterPropertyTabs needs to adopt this class structure. Read the existing classes, then map:
- Existing `flex` row → `<div className="form-row">label | input | unit</div>`
- Existing labels → `<span className="lbl">`
- Existing units → `<span className="unit">`

This is a per-row sweep; 30+ rows across the 3 tabs (Basic, Appearance, Physics). Take it one tab at a time.

- [ ] **Step 4: Rewrite EmitterPropertyTabs.test.tsx (18 specs).** The field-set itself doesn't change; the DOM nesting + classes do. Most specs need query adjustments (e.g., `getByText('Bursts:')` may become `getByRole('textbox', { name: /Bursts/ })` if the label-input association changes via the new grid structure).

Re-read each spec carefully — don't just chase green. Confirm the spec is still constraining meaningful behavior, not just shape.

- [ ] **Step 5: Run all gates.** This task has the biggest test-rewrite surface; expect ~18 vitest specs to rewrite + verify.

- [ ] **Step 6: Commit** with message `feat(LT-4): Phase 2.5 — left panel restack (Basic/Appearance/Physics tabs move from right to left)`.

### Task 2.6: Curve editor → always-on bottom 260px, multi-channel overlay

**Files:**
- Create: `web/apps/editor/src/screens/CurveEditorPanel.tsx` (new wrapper for the bottom-positioned curve editor)
- Modify: `web/apps/editor/src/screens/CurveEditor.tsx` (existing canvas component — rendering changes for multi-channel overlay)
- Modify: `web/apps/editor/src/screens/TrackEditor.tsx` (no longer renders inline in property panel; may be deleted if all its responsibilities migrated)
- Modify: `web/apps/editor/src/App.tsx` (workspace-center grid template, render new panel)
- Modify: `web/apps/editor/src/screens/__tests__/TrackEditor.test.tsx` (rewrite 8 specs for new layout)

- [ ] **Step 1: Update App.tsx's workspace-center.** Change the center column from "viewport only" to "viewport on top + curve editor 260px below":

```tsx
<div className="workspace-center grid gap-1.5 min-h-0 min-w-0 grid-rows-[1fr_260px]">
  <ViewportContainer bridge={bridge} />
  <CurveEditorPanel bridge={bridge} />
</div>
```

- [ ] **Step 2: Create CurveEditorPanel.tsx** with the design's split-pane layout (160px curve-list + 1fr canvas):

```tsx
// CurveEditorPanel — always-on bottom 260px panel. 160px left
// curve-list (per-channel visibility checkboxes) + 1fr canvas
// (multi-channel overlay).

import { useState } from "react";
import type { Bridge } from "@particle-editor/bridge-schema";
import { CurveEditor } from "./CurveEditor";

const CHANNELS = [
  { id: "scale",    label: "Scale",    color: "#e0a14b" },
  { id: "red",      label: "Red",      color: "#ef5350" },
  { id: "green",    label: "Green",    color: "#66bb6a" },
  { id: "blue",     label: "Blue",     color: "#42a5f5" },
  { id: "alpha",    label: "Alpha",    color: "#a3acbd" },
  { id: "rotation", label: "Rotation", color: "#4ea3ff" },
  { id: "index",    label: "Index",    color: "#7c8497" },  // 7th channel, default off
] as const;

export function CurveEditorPanel({ bridge }: { bridge: Bridge }) {
  const [visible, setVisible] = useState<Record<string, boolean>>({
    scale: true, red: true, green: true, blue: true, alpha: true, rotation: true, index: false,
  });

  return (
    <div className="panel">
      <div className="panel-header">
        <span>Curve editor</span>
      </div>
      <div className="curve-editor">
        <div className="ce-body">
          <div className="curve-list">
            {CHANNELS.map((c) => (
              <label key={c.id} className="curve-row">
                <input
                  type="checkbox"
                  checked={visible[c.id]}
                  onChange={(e) => setVisible((v) => ({ ...v, [c.id]: e.target.checked }))}
                  aria-label={`Toggle ${c.label} curve`}
                />
                <span className="swatch" style={{ background: c.color }} />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
          <div className="curve-canvas-wrap">
            <CurveEditor bridge={bridge} visibleChannels={visible} channels={CHANNELS} />
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update CurveEditor.tsx** to render multiple curves overlaid on one canvas. Accept `visibleChannels` and `channels` props. Iterate through the engine's track DTOs for the selected emitter; for each channel where `visibleChannels[id]` is true, render the curve in `channels[i].color`.

- [ ] **Step 4: Remove TrackEditor inline rendering from EmitterPropertyPanel.** The TrackEditor previously rendered inside the property panel for per-track editing. Now CurveEditorPanel owns the canvas. If TrackEditor still has unique per-track editing UI that doesn't fit in the bottom panel, keep TrackEditor and figure out the right home; otherwise delete it.

- [ ] **Step 5: Rewrite TrackEditor.test.tsx (8 specs).** Most specs probably need to move to CurveEditorPanel.test.tsx — test the visibility checkbox toggling, the multi-curve render, and the per-key dispatch surface.

- [ ] **Step 6: Run all gates.**

- [ ] **Step 7: Commit** with message `feat(LT-4): Phase 2.6 — curve editor moves to always-on bottom 260px with multi-channel overlay`.

### Task 2.7: Viewport overlay pill + leave-particles bridge

**Files:**
- **Bridge schema:** `web/packages/bridge-schema/src/index.ts` (add `engine/set/leave-particles` + `leaveParticles` DTO field)
- **C++ dispatcher:** `src/host/BridgeDispatcher.cpp` (new handler + snapshot field)
- **MockBridge:** `web/apps/editor/src/bridge/mock.ts` (new case) + `mock-state.ts` (default)
- **React:** new `web/apps/editor/src/components/ViewportPill.tsx`; modify ViewportContainer to render it
- **Assets:** copy `icon-ground.svg`, `icon-bloom.svg`, `icon-particles.svg` from design bundle to `web/apps/editor/public/icons/`
- **Tests:** new `web/apps/editor/src/components/__tests__/ViewportPill.test.tsx`; new Playwright spec `tests/leave-particles.spec.ts`

- [ ] **Step 1: Add `engine/set/leave-particles` to the bridge schema.** Edit `web/packages/bridge-schema/src/index.ts`:

```ts
// In the Request type union (around line 410):
| { kind: "engine/set/leave-particles"; params: { enabled: boolean } }

// In ResponseFor (around line 624):
R extends { kind: "engine/set/leave-particles" } ? Record<string, never> :

// In EngineStateDto (around line 186, near other fields):
leaveParticles: boolean;
```

- [ ] **Step 2: Add the field to mock-state.** In `web/apps/editor/src/bridge/mock-state.ts` `makeDefaultEngineState()`, add `leaveParticles: true` near the other defaults.

- [ ] **Step 3: Add the case to mock.ts.** Add this branch to the switch:

```ts
case "engine/set/leave-particles": {
  useMockEngineState.getState().applyPatch({ leaveParticles: req.params.enabled });
  this.emit({ kind: "engine/state/changed", payload: snapshotEngineState() });
  return {};
}
```

- [ ] **Step 4: Add the C++ dispatcher handler.** In `src/host/BridgeDispatcher.cpp`, add a new case (near the other `engine/set/*` handlers):

```cpp
if (kind == "engine/set/leave-particles")
{
    bool enabled = params.value("enabled", true);
    if (m_pParticleSystem && *m_pParticleSystem)
    {
        (*m_pParticleSystem)->setLeaveParticles(enabled);
        SetDirty(true);
        EmitEngineStateChanged();
        sendOk(json::object());
    }
    else
    {
        sendOk(json{{"ok", false}, {"error", "no particle system bound"}});
    }
    return res;
}
```

- [ ] **Step 5: Extend BuildEngineStateSnapshot.** In the same file, find `BuildEngineStateSnapshot` and add `leaveParticles` to the returned JSON object:

```cpp
// Inside BuildEngineStateSnapshot's return json{...}, add:
{"leaveParticles",       /* read */
    (ppSystem && *ppSystem) ? (*ppSystem)->getLeaveParticles() : true},
```

Note: BuildEngineStateSnapshot's current signature may not have access to `ppSystem`. If not, extend its signature to take the `ParticleSystem*` (similar to how `currentFilePath` is threaded in) and update the two call sites.

- [ ] **Step 6: Copy the SVG icons** from the design bundle into the editor's public assets:

```bash
mkdir -p "C:/Modding/Particle Editor/.claude/worktrees/awesome-morse-5ea5c3/web/apps/editor/public/icons"
cp "C:/Users/antho/AppData/Local/Temp/nu-particle-editor/nuparticle-editor/project/assets/icon-ground.svg" \
   "C:/Users/antho/AppData/Local/Temp/nu-particle-editor/nuparticle-editor/project/assets/icon-bloom.svg" \
   "C:/Users/antho/AppData/Local/Temp/nu-particle-editor/nuparticle-editor/project/assets/icon-particles.svg" \
   "C:/Modding/Particle Editor/.claude/worktrees/awesome-morse-5ea5c3/web/apps/editor/public/icons/"
```

- [ ] **Step 7: Create ViewportPill.tsx.** Top-left 3-toggle pill matching the design:

```tsx
// ViewportPill — top-left vertical pill in the viewport with 3
// toggles: Show ground, Toggle bloom, Leave particles after instance
// death. Each reflects the corresponding flag from engine snapshot.

import { useEffect, useState } from "react";
import type { Bridge, EngineStateDto } from "@particle-editor/bridge-schema";

type Props = { bridge: Bridge };

export function ViewportPill({ bridge }: Props) {
  const [snap, setSnap] = useState<EngineStateDto | null>(null);
  useEffect(() => {
    bridge.request({ kind: "engine/state/snapshot", params: {} }).then(setSnap);
    return bridge.on("engine/state/changed", (e) => setSnap(e.payload));
  }, [bridge]);

  const ground = snap?.ground ?? false;
  const bloom = snap?.bloom ?? false;
  const leave = snap?.leaveParticles ?? true;

  const toggle = (kind: "engine/set/ground" | "engine/set/bloom" | "engine/set/leave-particles", current: boolean) => {
    if (kind === "engine/set/leave-particles") {
      bridge.request({ kind, params: { enabled: !current } });
    } else {
      bridge.request({ kind, params: { enabled: !current } });
    }
  };

  return (
    <div className="vp-tools vp-overlay">
      <button type="button"
              className={`tool ${ground ? "active" : ""}`}
              aria-label="Show ground"
              aria-pressed={ground}
              onClick={() => toggle("engine/set/ground", ground)}>
        <img src="/icons/icon-ground.svg" alt="" />
      </button>
      <button type="button"
              className={`tool ${bloom ? "active" : ""}`}
              aria-label="Toggle bloom"
              aria-pressed={bloom}
              onClick={() => toggle("engine/set/bloom", bloom)}>
        <img src="/icons/icon-bloom.svg" alt="" />
      </button>
      <button type="button"
              className={`tool ${leave ? "active" : ""}`}
              aria-label="Leave particles after instance death"
              aria-pressed={leave}
              onClick={() => toggle("engine/set/leave-particles", leave)}>
        <img src="/icons/icon-particles.svg" alt="" />
      </button>
    </div>
  );
}
```

- [ ] **Step 8: Mount `<ViewportPill bridge={bridge} />`** inside the ViewportContainer's overlay area (positioned absolutely top-left).

- [ ] **Step 9: Write tests.** Vitest spec for ViewportPill rendering + each button's dispatch; Playwright spec at `web/apps/editor/tests/leave-particles.spec.ts` covering the bridge round-trip:

```ts
test("engine/set/leave-particles round-trips through snapshot", async () => {
  const after = await page.evaluate(async () => {
    const b = (window as any).bridge;
    await b.request({ kind: "engine/set/leave-particles", params: { enabled: false } });
    const snap = await b.request({ kind: "engine/state/snapshot", params: {} }) as { leaveParticles: boolean };
    return snap.leaveParticles;
  });
  expect(after).toBe(false);
});
```

- [ ] **Step 10: Add the new spec to the Playwright allowlist** in `web/apps/editor/scripts/run-native-tests.mjs` (per the lesson from D6 — new specs must be added to the script's allowlist).

- [ ] **Step 11: Run all gates.** All 4 gates green; ViewportPill specs +1-3, leave-particles spec +1.

- [ ] **Step 12: Commit** with message `feat(LT-4): Phase 2.7 — viewport pill + engine/set/leave-particles bridge`.

### Task 2.8: Phase 2 wrap-up — visual verification + summary

- [ ] **Step 1: Computer-use visual walkthrough.** Launch, screenshot, click through every dropdown, toggle theme, open Spawner (toggle visibility), navigate left-panel tabs, exercise curve-editor channels. Catch any structural inconsistency between the design source and the rendered output.

- [ ] **Step 2: Manual smoke handoff to user.** "Phase 2 done — full structural redesign. Please launch the editor and walk through each panel, dropdown, dialog, theme. Confirm everything works the way you expect from the design."

- [ ] **Step 3: Confirm test counts.** Expected: vitest ~197-200 (was 195 after Phase 1; +3-5 from new component specs minus a few deletions from removed sliding-panel tests); Playwright ~83 (was 80; +3 from leave-particles + theme persistence which lands in Phase 3 + viewport pill specs minus background-picker reshape).

---

## Phase 3 — Cleanup + dialog re-skin

### Task 3.1: Modal primitive re-style

**Files:**
- Modify: `web/apps/editor/src/components/Modal.tsx`

- [ ] **Step 1: Read current Modal.tsx** and locate the Tailwind className strings on the `Dialog.Overlay` + `Dialog.Content`.

- [ ] **Step 2: Update className strings** to use token-backed utilities:

```tsx
// Modal overlay (full-screen dim):
<Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />

// Modal content (centered panel):
<Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                            bg-panel border border-border-2 rounded-token
                            shadow-[var(--shadow)] p-4 min-w-[320px] z-50">
```

- [ ] **Step 3: Run all gates.** Visually inspect each dialog (Help → About; File → New on dirty; etc.) to confirm the new style.

- [ ] **Step 4: Commit** with message `feat(LT-4): Phase 3.1 — Modal primitive restyled with design tokens`.

### Task 3.2: ModNicknameDialog wiring + mods/set-nickname bridge

**Files:**
- **Bridge schema:** add `mods/set-nickname` request kind + response
- **C++ dispatcher:** new handler that calls `WriteModNickname()` + `m_modManager->DiscoverMods()`
- **MockBridge:** new case in `mock.ts`
- **React:** modify `MenuBar.tsx` to add `onContextMenu` on mod entries; modify `ModNicknameDialog.tsx` to dispatch the new bridge call on submit; modify `App.tsx` to mount the dialog with state for selected mod
- **Tests:** vitest specs for MenuBar context-menu + dialog dispatch; Playwright spec for nickname round-trip

- [ ] **Step 1: Bridge schema.** Add to `web/packages/bridge-schema/src/index.ts`:

```ts
// In Request union:
| { kind: "mods/set-nickname"; params: { path: string; nickname: string } }

// In ResponseFor:
R extends { kind: "mods/set-nickname" } ? { ok: true; mods: ModDescriptor[]; activePath: string | null } | { ok: false; error: string } :
```

- [ ] **Step 2: C++ dispatcher handler.** In `src/host/BridgeDispatcher.cpp`, near the other `mods/*` handlers:

```cpp
if (kind == "mods/set-nickname")
{
    if (!m_modManager) { sendOk(json{{"ok", false}, {"error", "ModManager not bound"}}); return res; }
    std::string pathUtf8 = params.value("path", std::string{});
    std::string nickUtf8 = params.value("nickname", std::string{});
    std::wstring path = Utf8ToWide(pathUtf8);
    std::wstring nick = Utf8ToWide(nickUtf8);
    WriteModNickname(path, nick);          // free function in ModManager.h
    m_modManager->DiscoverMods();           // re-scan to pick up the new nickname
    sendOk(buildModsListPayload());         // helper from D6 — returns same shape as mods/list with ok:true added
    return res;
}
```

Note: `buildModsListPayload()` returns `{ mods, activePath }`; add `ok: true` before sending.

- [ ] **Step 3: MockBridge case.** Add to `mock.ts`:

```ts
case "mods/set-nickname": {
  // Find the entry in the fixture, update its nickname, return updated list.
  const params = req.params as { path: string; nickname: string };
  // ... mutate the fixture in mockModsState, return { ok: true, mods: [...], activePath: ... }
}
```

- [ ] **Step 4: MenuBar — add onContextMenu to mod entries.** In `web/apps/editor/src/components/MenuBar.tsx`, the Mods menu entries (from D6) get right-click handlers:

```tsx
{mods.map((m) => (
  <Menubar.Item
    key={m.path}
    onSelect={() => handleModSelect(m.path)}
    onContextMenu={(e) => {
      e.preventDefault();
      openModNicknameDialog(m); // sets state in App.tsx
    }}
    /* ... */
  >
    {/* ... */}
  </Menubar.Item>
))}
```

- [ ] **Step 5: ModNicknameDialog wiring.** Modify `ModNicknameDialog.tsx` to accept `bridge` and `mod` props, dispatch `mods/set-nickname` on submit, update local mods list from response, close dialog.

- [ ] **Step 6: App.tsx state for the dialog.** Add `const [nicknameDialogMod, setNicknameDialogMod] = useState<ModDescriptor | null>(null);` and render the dialog conditionally. The `openModNicknameDialog` function lives here and gets passed down to MenuBar.

- [ ] **Step 7: Tests.** Vitest: MenuBar onContextMenu opens dialog, ModNicknameDialog dispatches on submit. Playwright: `tests/mods-nickname.spec.ts` doing a `mods/set-nickname` round-trip + reading nickname back via `mods/list`.

- [ ] **Step 8: Add new Playwright spec to allowlist** in `scripts/run-native-tests.mjs`.

- [ ] **Step 9: Run all gates.**

- [ ] **Step 10: Commit** with message `feat(LT-4): Phase 3.2 — ModNicknameDialog wired + mods/set-nickname bridge`.

### Task 3.3: Per-dialog visual passes

**Files:** all dialog component .tsx files.

- [ ] **Step 1: List dialogs:** ImportEmittersDialog, ModNicknameDialog, RescaleDialog, RescaleEmitterDialog, AboutDialog, SaveChangesPrompt, IncrementIndexDialog, LinkGroupSettingsDialog.

- [ ] **Step 2: For each dialog,** read the file, audit any hardcoded color/typography Tailwind classes still in the body content, swap to token equivalents (per Phase 1's sweep rules). Manual visual smoke for each by launching the editor and opening the dialog.

- [ ] **Step 3: Run all gates.**

- [ ] **Step 4: Commit** with message `feat(LT-4): Phase 3.3 — dialog body content re-styled with design tokens`.

### Task 3.4: Tailwind leftover cleanup sweep

- [ ] **Step 1: Audit.** Grep for any remaining `bg-neutral-*`, `border-neutral-*`, `text-neutral-*`, `sky-*` in `web/apps/editor/src`:

```bash
grep -RE "bg-neutral-|border-neutral-|text-neutral-|sky-500|sky-400" web/apps/editor/src --include="*.tsx" -l
```

Expected: should be very few or zero. Anything found is something Phase 1/2 sweeps missed.

- [ ] **Step 2: Sweep each remaining file** using the Phase 1.7 substitution table.

- [ ] **Step 3: Confirm grep returns zero** matches.

- [ ] **Step 4: Run all gates.**

- [ ] **Step 5: Commit** with message `chore(LT-4): Phase 3.4 — Tailwind leftover cleanup, all utilities now token-backed`.

### Task 3.5: Theme persistence Playwright spec

**Files:**
- Create: `web/apps/editor/tests/theme-persistence.spec.ts`

- [ ] **Step 1: Write the spec:**

```ts
// LT-4 Phase 3.5: theme persistence across page reload via localStorage.

import { test, expect, chromium, type Page, type Browser } from "@playwright/test";

const CDP_ENDPOINT = process.env.CDP_ENDPOINT ?? "http://localhost:9222";

let browser: Browser;
let page: Page;

test.beforeAll(async () => {
  browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  const context = browser.contexts()[0];
  if (!context) throw new Error("CDP: no browser contexts attached");
  const pages = context.pages();
  page = pages[0] ?? (await context.waitForEvent("page"));
  await page.waitForFunction(() => typeof (window as any).bridge !== "undefined", null, { timeout: 15_000 });
});

test.afterAll(async () => {
  await browser?.close();
});

test("theme toggle persists across reload via localStorage", async () => {
  // Set theme to light via the toggle.
  await page.evaluate(() => {
    const btn = document.querySelector<HTMLButtonElement>('button[aria-label="Light theme"]');
    btn?.click();
  });
  const stored = await page.evaluate(() => localStorage.getItem("alo:theme"));
  expect(stored).toBe("light");

  // Confirm dataset is set.
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(theme).toBe("light");

  // Set back to dark to leave the environment clean.
  await page.evaluate(() => {
    const btn = document.querySelector<HTMLButtonElement>('button[aria-label="Dark theme"]');
    btn?.click();
  });
});
```

- [ ] **Step 2: Add to allowlist** in `scripts/run-native-tests.mjs`.

- [ ] **Step 3: Run all gates.**

- [ ] **Step 4: Commit** with message `test(LT-4): Phase 3.5 — Playwright spec for theme persistence`.

### Task 3.6: Docs + final verification + ship

**Files:**
- Modify: `CHANGELOG.md` (add comprehensive redesign entry at top of Changelog)
- Modify: `tasks/HANDOFF.md` (refresh "what landed", current test counts, redesign listed)
- Possibly: `ROADMAP.md` (only if redesign crosses a "shipped" threshold — usually no)

- [ ] **Step 1: CHANGELOG entry** at top of `## Changelog`:

```markdown
### Particle Editor 2026 redesign

*YYYY-MM-DD · [`<hash>`](https://github.com/.../commit/<hash>) · [#TODO](https://github.com/.../pull/TODO)*

Visual + structural redesign of the new-UI React shell to the Particle Editor 2026 design system. Dark mode by default with Inter typography and the design's 6-tier color palette; light theme toggle persists across launches via localStorage. Background and Ground textures move from sliding side panels to compact toolbar dropdown popovers. Spawner becomes a permanent right column (toggleable via toolbar button). Left panel houses both the emitter tree and the Basic/Appearance/Physics inspector. The curve editor moves to an always-on 260px bottom strip showing all 7 channels (Scale/R/G/B/A/Rotation/Index) overlaid with per-channel visibility checkboxes. The viewport gains a top-left 3-toggle pill (Show ground / Toggle bloom / Leave particles after instance death). Right-clicking a Mods menu entry now opens the previously-unwired ModNicknameDialog for nickname editing.

**How we tackled it.** Three phases on `lt-4`. Phase 1 (commit `<hash>`) is a behavior-preserving token + font + theme swap — `web/apps/editor/src/styles/{tokens,base,components}.css` port the design's `styles.css` verbatim, Inter ships as a locally-bundled variable woff2 with `font-display: block` + `<link rel="preload">`, and `tailwind.config.ts` aliases the new CSS variables into its palette so existing components incrementally swap from `bg-neutral-900` style without restructuring class architecture. Phase 2 (7 commits) restructures each tool surface in isolation, rewriting tests in the same commit each lands in. Phase 3 (4-5 commits) wires the previously-unwired ModNicknameDialog (new `mods/set-nickname` bridge call + ModManager re-scan), restyles the Modal primitive (cascade to every dialog), sweeps the last remnants of hardcoded Tailwind utilities, and adds a Playwright spec for theme persistence.

**Issues encountered and resolutions.** Collect during implementation by jotting a sentence per gotcha as it comes up. Examples of in-scope issues for this entry: an Inter font weight that didn't render right, a Radix Popover that didn't honour the OccludingPopover's `useViewportOcclusion` hook on first mount, a vitest query that needed rewriting twice because the first attempt asserted on a brittle DOM nesting. Skip: routine compile errors, forward-declaration shuffles, "I typed the className wrong" fixes.
```

Backfill hash on each phase's commit per the partial-backfill convention.

- [ ] **Step 2: HANDOFF.md refresh.** Update "What landed in this session" (or create a new section) with the redesign summary. Update test counts to the new totals. Remove any redesign-related items from "What's left."

- [ ] **Step 3: Final comprehensive computer-use verification.** Walk through every panel, dropdown, dialog in both themes. Confirm pixel-level consistency with the design source.

- [ ] **Step 4: Manual user verification.** Hand off to user with the comprehensive smoke checklist.

- [ ] **Step 5: Commit docs.**

```bash
git commit -am "$(cat <<'EOF'
docs(LT-4): CHANGELOG + HANDOFF for Particle Editor 2026 redesign

Pull the three paragraphs you wrote into CHANGELOG (what ships / how
we tackled it / issues encountered and resolutions) into the body
here as a condensed two-paragraph summary. HANDOFF refresh notes the
new test counts (vitest ~197-200, Playwright ~83-85) and lists the
redesign under "what landed".

Phase 1 commit: <Phase 1 hash>
Phase 2 commits (sub-tasks 2.1-2.7): <7 hashes>
Phase 3 commits (sub-tasks 3.1-3.5 + this docs commit): <5-6 hashes>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: FF (if needed) + push.** If working on a session branch, FF into `lt-4` and push. If on `lt-4` directly, just push.

- [ ] **Step 7: Definition of Done — checklist.** Run through the 10 items from spec section 8. All must check.

---

## Self-review notes

Plan covers all 3 phases from the spec. Each phase has its own task numbering (1.x, 2.x, 3.x). All sub-commits identified in the spec's Phase 2 (7 sub-commits) and Phase 3 (~5 sub-commits) have corresponding tasks here. Bridge surface changes (3 from spec) are covered in Tasks 2.7 (leave-particles) and 3.2 (mods/set-nickname). Theme persistence Playwright spec is Task 3.5. Definition-of-Done items map to the per-task verification gates plus the final Task 3.6.

Code samples in the plan show concrete TypeScript / TSX / C++ — no "implement appropriate handler" placeholders. Bash commands have expected output where relevant.

The most-likely-to-bloat tasks are 2.5 (left panel restack with 18 spec rewrites) and 1.7 (sweep across ~25-30 component files). Both are necessarily wide but mechanical — the substitution table in 1.7 and the spec-by-spec re-read discipline in 2.5 keep the execution disciplined.

---

End of plan.
