# NT-12 Tooltips + Motion Family Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every native `title` hover hint with one shared styled+animated tooltip primitive (rich tier for the NT-11 ⚠ chain-warning glyph), give the Modal and OverloadBanner real entrance/exit animations, and ship a theme-consistent `--shadow-soft` token — one motion family.

**Architecture:** New `Tip` primitive wraps `@radix-ui/react-tooltip` (asChild trigger, portaled content, opt-in `useViewportOcclusion`). Motion = hand-rolled CSS keyframes keyed to Radix `data-state`/`data-side` (the shipped `popover-animate` pattern), driven by new duration/easing/slip tokens in tokens.css. The banner gets a `usePresence` shim so its exit can play; the Modal swaps its dead `animate-in` utility strings for real keyframes.

**Tech Stack:** React 18 + Radix primitives, Tailwind v4 (CSS-config, NO tailwindcss-animate), vitest + @testing-library/react (jsdom), pnpm workspace (`@particle-editor/editor`).

**Spec:** `docs/superpowers/specs/2026-06-10-nt12-tooltips-motion-design.md` (user-approved; the four core decisions were validated visually).

**Two verified deviations from the spec** (agent-explored, confirmed against code):

- **A11y goldens will NOT churn.** The harness serializes only the allowlist in `web/apps/editor/tests/helpers/a11y-allowlist.json` (`Name`, `ControlType`, …); `HelpText` — where the HTML `title` surfaces — is volatile-listed and never written to goldens. Expectation flips from "budgeted regeneration" to **zero golden diff**; any diff is investigated, not regenerated blind.
- **The census is ~42 production sites, not ~95.** The raw grep counted `<Modal title=>` component props and test files. The authoritative completion check is the Task 12 grep gate, not the count (L-022).

**Branch:** work continues on the session branch (`claude/tender-satoshi-5ff472`, on the master tip `b1a945c`; the spec commit `6f9e576` is already on it).

---

## Site-class conversion rules (referenced by Tasks 6–11)

| Class | Pattern | Conversion |
|---|---|---|
| **T1** | Icon button, `title` + `aria-label` both present | Wrap in `<Tip content={titleText}>`, delete `title=`, keep `aria-label`. |
| **T2** | Icon button, `title` only | Wrap in `<Tip content={titleText}>`, delete `title=`, **add** `aria-label={titleText}`. |
| **T3** | Truncation label — `title` text === visible text (`<span className="lbl" title={label}>{label}</span>`) | Wrap in `<Tip content={label}>`, delete `title=`. NO aria-label added (visible text is already the accessible name; adding one would change a11y goldens). |
| **T4** | Conditional title (`title={cond ? "…" : undefined}`) | `<Tip content={cond ? "…" : undefined}>` — Tip renders the bare child when content is nullish/empty. |
| **T5** | `title` inside a Radix menu/context-menu item that duplicates the item's visible text | **Delete the `title=` outright. No Tip.** Tooltips inside open Radix menus fight the menu's pointer capture, and the text is already visible. |
| **T6** | Tooltip must show on a **disabled** control | Wrap the disabled element in a `<span className="inline-block">` shim and put `<Tip>` on the span (disabled elements fire no pointer events). |

Occlusion rule (spec §3): any site whose tooltip can plausibly overlap the viewport quadrant gets `occlusionId="tip:<area>:<what>"` — emitter tree (opens toward viewport), toolbar (bottom-side tooltips hang over the viewport), status bar (top-side), property tabs (left-side), anything inside the viewport quadrant. When in doubt, opt in. Sites inside modals don't need it (the modal already occludes the full viewport).

---

### Task 0: Worktree restore + web baseline

**Files:** none modified.

- [ ] **Step 1: Install web deps + build check**

```bash
cd "C:\Modding\Particle Editor\.claude\worktrees\tender-satoshi-5ff472\web"
pnpm install
```

Expected: clean install (lockfile up to date). L-039 (WebView2 NuGet) is already done for this worktree; `pnpm build` (L-040) is deferred to Task 12 where the host run needs it.

- [ ] **Step 2: Baseline web suite + types**

```bash
pnpm --filter @particle-editor/editor test
pnpm --filter @particle-editor/editor exec tsc -b
```

Expected: **670 passed**, tsc exit 0. If not, STOP — the worktree is not at the verified baseline; investigate before any change.

---

### Task 1: Motion + shadow tokens

**Files:**
- Modify: `web/apps/editor/src/styles/tokens.css` (insert after the `--shadow` line, ~line 47, and in the `[data-theme="light"]` block)

- [ ] **Step 1: Add the tokens**

In `:root`, directly under the existing `--shadow:` line:

```css
  /* [NT-12] Motion family. Fast tier = tooltips (matches the shipped
     popover-pop timings); slow tier = modal/banner (larger elements).
     Entrances decelerate (ease-out), exits accelerate (ease-in). */
  --motion-fast-in: 130ms;
  --motion-fast-out: 110ms;
  --motion-slow-in: 180ms;
  --motion-slow-out: 150ms;
  --ease-entrance: ease-out;
  --ease-exit: ease-in;
  --slip-tooltip: 4px;
  --slip-banner: 6px;
  --slip-modal: 8px;
  /* [NT-12] Soft two-layer drop shadow: wide ambient + tight contact.
     Unlike --shadow (dark-only), this HAS a light-theme override so it
     reads equally soft on both themes. Worn by tooltips + the overload
     banner. */
  --shadow-soft: 0 4px 16px rgba(0, 0, 0, 0.45), 0 1px 3px rgba(0, 0, 0, 0.35);
```

In `[data-theme="light"]`, at the end of the block:

```css
  --shadow-soft: 0 4px 16px rgba(0, 0, 0, 0.14), 0 1px 3px rgba(0, 0, 0, 0.10);
```

- [ ] **Step 2: Build check**

```bash
pnpm --filter @particle-editor/editor exec vite build
```

Expected: clean build (the known-benign >500 kB chunk warning only).

- [ ] **Step 3: Commit**

```bash
git add web/apps/editor/src/styles/tokens.css
git commit -m "feat(nt-12): motion + soft-shadow design tokens"
```

---

### Task 2: Install @radix-ui/react-tooltip + first-party data-state verification

**Files:**
- Modify: `web/apps/editor/package.json`, `web/pnpm-lock.yaml`

- [ ] **Step 1: Add the dependency**

```bash
cd "C:\Modding\Particle Editor\.claude\worktrees\tender-satoshi-5ff472\web"
pnpm --filter @particle-editor/editor add @radix-ui/react-tooltip
```

Expected: resolves to `^1.x` (caret pin, matching the other seven Radix deps).

- [ ] **Step 2: Verify the data-state vocabulary against the INSTALLED package (trust-but-verify — spec §2 flags that Tooltip's states differ from Dialog/Popover and have shifted across Radix majors)**

```bash
grep -rn "delayed-open\|instant-open\|data-state" node_modules/@radix-ui/react-tooltip/dist/index.mjs | head -20
```

Expected: occurrences of `closed`, `delayed-open`, `instant-open` (the three Tooltip states). **Record what you actually find in the Task 3 CSS selectors** — if the names differ, the CSS in Task 3 Step 3 must match reality, not this plan.

- [ ] **Step 3: Commit**

```bash
git add web/apps/editor/package.json web/pnpm-lock.yaml
git commit -m "feat(nt-12): add @radix-ui/react-tooltip"
```

---

### Task 3: The Tip primitive (TDD)

**Files:**
- Create: `web/apps/editor/src/primitives/Tip.tsx`
- Create: `web/apps/editor/src/primitives/__tests__/Tip.test.tsx`
- Modify: `web/apps/editor/src/styles/components.css` (new section after the drag-chip block, ~line 145)

- [ ] **Step 1: Write the failing tests**

`web/apps/editor/src/primitives/__tests__/Tip.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Tip } from "../Tip";
import { BridgeContext } from "@/lib/bridge-context";
import type { Bridge } from "@particle-editor/bridge-schema";

// Render helper: Radix Tooltip requires a Provider. delayDuration=0 so
// tests don't need fake timers. Opening via focus() is the reliable
// jsdom path (hover needs real pointer events Radix sniffs for).
function renderTip(ui: React.ReactElement, bridge: Bridge | null = null) {
  return render(
    <BridgeContext.Provider value={bridge}>
      <Tooltip.Provider delayDuration={0} skipDelayDuration={0}>{ui}</Tooltip.Provider>
    </BridgeContext.Provider>,
  );
}

function makeBridge() {
  const request = vi.fn().mockResolvedValue({ ok: true });
  const on = vi.fn().mockReturnValue(() => {});
  return { bridge: { request, on } as unknown as Bridge, request };
}

describe("Tip", () => {
  it("renders the trigger unchanged (asChild — no wrapper element)", () => {
    renderTip(
      <Tip content="Save the file"><button aria-label="Save">S</button></Tip>,
    );
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn.parentElement?.tagName).not.toBe("SPAN"); // no shim injected
    expect(btn).not.toHaveAttribute("title");
  });

  it("opens on focus and shows the styled content", () => {
    renderTip(
      <Tip content="Save the file"><button aria-label="Save">S</button></Tip>,
    );
    act(() => screen.getByRole("button", { name: "Save" }).focus());
    // Radix renders the visible content + a duplicate inside a visually
    // hidden live-region span; getAllBy tolerates both.
    const contents = screen.getAllByText("Save the file");
    expect(contents.length).toBeGreaterThan(0);
    const surface = document.querySelector(".tip-surface");
    expect(surface).not.toBeNull();
    expect(surface!.className).toContain("tip-animate");
  });

  it("renders the bare child when content is nullish or empty (T4 conditional sites)", () => {
    renderTip(
      <Tip content={undefined}><button aria-label="Plain">P</button></Tip>,
    );
    act(() => screen.getByRole("button", { name: "Plain" }).focus());
    expect(document.querySelector(".tip-surface")).toBeNull();
  });

  it("registers a viewport occlusion while open when occlusionId is set, and releases on close", async () => {
    const { bridge, request } = makeBridge();
    renderTip(
      <Tip content="hint" occlusionId="tip:test:x"><button aria-label="T">T</button></Tip>,
      bridge,
    );
    const btn = screen.getByRole("button", { name: "T" });
    act(() => btn.focus());
    await act(async () => {}); // flush the occlusion request effect
    const occlude = request.mock.calls
      .map((c) => c[0] as { kind: string; params: { id: string; rect: unknown } })
      .filter((r) => r.kind === "viewport/occlude");
    expect(occlude.length).toBeGreaterThan(0);
    expect(occlude[0]!.params.id).toBe("tip:test:x");
    expect(occlude[0]!.params.rect).not.toBeNull();

    request.mockClear();
    act(() => { btn.blur(); fireEvent.pointerLeave(btn); });
    await act(async () => {});
    const release = request.mock.calls
      .map((c) => c[0] as { kind: string; params: { id: string; rect: unknown } })
      .filter((r) => r.kind === "viewport/occlude" && r.params.rect === null);
    expect(release.length).toBe(1);
  });

  it("makes no bridge traffic without an occlusionId", async () => {
    const { bridge, request } = makeBridge();
    renderTip(
      <Tip content="hint"><button aria-label="T">T</button></Tip>,
      bridge,
    );
    act(() => screen.getByRole("button", { name: "T" }).focus());
    await act(async () => {});
    expect(request).not.toHaveBeenCalled();
  });

  it("forwards side and align to the content", () => {
    renderTip(
      <Tip content="hint" side="right" align="start"><button aria-label="T">T</button></Tip>,
    );
    act(() => screen.getByRole("button", { name: "T" }).focus());
    const surface = document.querySelector(".tip-surface");
    expect(surface).toHaveAttribute("data-side", "right");
    expect(surface).toHaveAttribute("data-align", "start");
  });

  it("wraps plain-string content in the padded tip-body (rich JSX brings its own padding)", () => {
    renderTip(
      <Tip content="plain hint"><button aria-label="T">T</button></Tip>,
    );
    act(() => screen.getByRole("button", { name: "T" }).focus());
    expect(document.querySelector(".tip-surface .tip-body")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @particle-editor/editor exec vitest run src/primitives/__tests__/Tip.test.tsx
```

Expected: FAIL — `Cannot find module '../Tip'`.

- [ ] **Step 3: Implement the primitive + CSS**

`web/apps/editor/src/primitives/Tip.tsx`:

```tsx
// Tip — the [NT-12] shared styled+animated tooltip primitive, replacing
// native `title` attributes app-wide.
//
//   <Tip content="Save the file"><button aria-label="Save">…</button></Tip>
//
// - Trigger is asChild: the existing element IS the trigger; no wrapper.
// - content: string → padded plain tier; JSX → rich tier (brings its own
//   padding, e.g. ChainWarningTip's amber band). Nullish/empty → the bare
//   child renders with no tooltip at all (conditional T4 sites).
// - occlusionId (opt-in): registers a viewport occlusion while open so the
//   D3D-composited viewport popup doesn't overpaint the portaled tooltip
//   (the OccludingPopover precedent — see spec §3). Sites that can't reach
//   the viewport skip it; when in doubt, opt in.
// - Motion/styling: `tip-surface tip-animate` in components.css — fast-tier
//   fade + 4px directional slip keyed off Radix data-state/data-side,
//   reduced-motion guarded. Surface wears --shadow-soft.
//
// Disabled triggers (T6): disabled elements fire no pointer events — wrap
// the disabled element in <span className="inline-block"> at the call site
// and put <Tip> on the span.

import * as Tooltip from "@radix-ui/react-tooltip";
import { useRef, type ReactNode, type ReactElement } from "react";
import { useBridge } from "@/lib/bridge-context";
import { useViewportOcclusion } from "@/lib/viewport-occlusion";

type TipProps = {
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  occlusionId?: string;
  children: ReactElement;
};

// Hooks live in a child component so they only run while the content is
// mounted (Radix mounts Content only while open) — same shape as
// OccludingPopover. pad/feather 12/12: the soft shadow's extent is smaller
// than the menus' shadow-xl, so the 24/24 enclosure would be oversized.
function OccludingTipBody({ id, children }: { id: string; children: ReactNode }) {
  const bridge = useBridge();
  const ref = useRef<HTMLDivElement | null>(null);
  useViewportOcclusion(bridge ?? undefined, id, ref, 12, 12);
  return <div ref={ref}>{children}</div>;
}

export function Tip({ content, side = "top", align = "center", occlusionId, children }: TipProps) {
  // No hooks above this return — the early-out is render-order safe even
  // when a conditional site's content flips between string and undefined.
  if (content === null || content === undefined || content === "") return children;
  const body = typeof content === "string" ? <span className="tip-body">{content}</span> : content;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tip-surface tip-animate" side={side} align={align} sideOffset={6} collisionPadding={8}>
          {occlusionId ? <OccludingTipBody id={occlusionId}>{body}</OccludingTipBody> : body}
          <Tooltip.Arrow className="tip-arrow" width={10} height={5} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
```

`web/apps/editor/src/styles/components.css` — new section directly after the drag-chip block (~line 145):

```css
/* ---- [NT-12] Tooltip surface + motion family ----
   The shared Tip primitive (primitives/Tip.tsx). Surface is theme-following
   (panel-3 + border-2; flips with [data-theme]) and wears --shadow-soft.
   Motion = fast-tier fade + 4px slip AWAY from the trigger, keyed off
   Radix data-state/data-side. NOTE: Tooltip's data-state vocabulary is
   `closed` / `delayed-open` / `instant-open` — NOT Dialog/Popover's plain
   `open` (verified against the installed package, Task 2). Radix Presence
   keeps Content mounted through the closing animation, so the exit plays.
   Plain-string content gets padding via .tip-body; rich content (the
   chain-warning band) brings its own padding so headers can run
   edge-to-edge. */
.tip-surface {
  background: var(--panel-3);
  color: var(--text);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-soft);
  font-size: 12px;
  line-height: 1.5;
  max-width: 320px;
  z-index: 60;
  overflow: hidden; /* rich-tier bands clip to the rounded corner */
}
.tip-body { display: block; padding: 5px 9px; }
.tip-arrow { fill: var(--panel-3); }

.tip-animate { --tip-slip-x: 0px; --tip-slip-y: 0px; }
.tip-animate[data-side="top"]    { --tip-slip-y: var(--slip-tooltip); }
.tip-animate[data-side="bottom"] { --tip-slip-y: calc(-1 * var(--slip-tooltip)); }
.tip-animate[data-side="left"]   { --tip-slip-x: var(--slip-tooltip); }
.tip-animate[data-side="right"]  { --tip-slip-x: calc(-1 * var(--slip-tooltip)); }
@keyframes tip-in {
  from { opacity: 0; transform: translate(var(--tip-slip-x), var(--tip-slip-y)); }
  to   { opacity: 1; transform: translate(0, 0); }
}
@keyframes tip-out {
  from { opacity: 1; transform: translate(0, 0); }
  to   { opacity: 0; transform: translate(var(--tip-slip-x), var(--tip-slip-y)); }
}
.tip-animate[data-state="delayed-open"],
.tip-animate[data-state="instant-open"] {
  animation: tip-in var(--motion-fast-in) var(--ease-entrance);
}
.tip-animate[data-state="closed"] {
  animation: tip-out var(--motion-fast-out) var(--ease-exit);
}
@media (prefers-reduced-motion: reduce) {
  .tip-animate[data-state="delayed-open"],
  .tip-animate[data-state="instant-open"],
  .tip-animate[data-state="closed"] { animation: none; }
}
```

(If Task 2 Step 2 found different state names, use those here and update this comment.)

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @particle-editor/editor exec vitest run src/primitives/__tests__/Tip.test.tsx
```

Expected: 7 PASS. If the occlusion test flakes on effect timing, wrap the focus in `await act(...)` — the hook registers in a layout effect.

- [ ] **Step 5: Full suite + types, then commit**

```bash
pnpm --filter @particle-editor/editor test
pnpm --filter @particle-editor/editor exec tsc -b
git add web/apps/editor/src/primitives/Tip.tsx web/apps/editor/src/primitives/__tests__/Tip.test.tsx web/apps/editor/src/styles/components.css
git commit -m "feat(nt-12): Tip tooltip primitive (Radix + occlusion + slip motion)"
```

Expected: 677 passed (670 + 7), tsc 0.

---

### Task 4: App-level Tooltip.Provider

**Files:**
- Modify: `web/apps/editor/src/App.tsx` (AppShell, ~line 139)

- [ ] **Step 1: Wrap the shell**

In `App.tsx`, import and wrap immediately inside `BridgeContext.Provider`:

```tsx
import * as Tooltip from "@radix-ui/react-tooltip";
```

```tsx
<BridgeContext.Provider value={bridge}>
  {/* [NT-12] One app-level tooltip provider: first hover waits 400ms;
      moving between tooltipped controls within 300ms opens instantly
      (the "sweep the toolbar" feel native title can't give). Values are
      feel-tunable — adjust at the user smoke if flagged. */}
  <Tooltip.Provider delayDuration={400} skipDelayDuration={300}>
    <div data-testid="app-shell" className="flex h-full w-full flex-col text-text">
      …existing children unchanged…
    </div>
    …existing dialog mounts unchanged…
  </Tooltip.Provider>
</BridgeContext.Provider>
```

(Exact placement: the provider must enclose EVERYTHING that will contain a Tip — the shell div AND the app-level dialogs.)

- [ ] **Step 2: Suite + types + commit**

```bash
pnpm --filter @particle-editor/editor test
pnpm --filter @particle-editor/editor exec tsc -b
git add web/apps/editor/src/App.tsx
git commit -m "feat(nt-12): app-level Tooltip.Provider (400ms delay, 300ms skip)"
```

Expected: 677 passed, tsc 0. (Existing component tests mount their own Provider via the Task 3 helper; App-level tests exercise the real one.)

---

### Task 5: ChainWarningTip — the rich ⚠ tier (TDD)

**Files:**
- Create: `web/apps/editor/src/screens/ChainWarningTip.tsx`
- Create: `web/apps/editor/src/screens/__tests__/ChainWarningTip.test.tsx`
- Modify: `web/apps/editor/src/lib/chain-load.ts` (export the two formatters)
- Modify: `web/apps/editor/src/screens/EmitterTree.tsx:852-862` (the glyph)

- [ ] **Step 1: Export the number formatters from chain-load.ts**

In `formatChainWarning`, the two local helpers become module-level exports (rules unchanged — same rounding, same sub-10 decimal):

```ts
// Number formatting shared by the plain-text tooltip body and the
// [NT-12] rich ChainWarningTip — one set of rules, two presentations.
export const fmtCount = (n: number) => Math.round(n).toLocaleString("en-US");
export const fmtMultiplier = (n: number) =>
  n >= 10 ? fmtCount(n) : n.toLocaleString("en-US", { maximumFractionDigits: 1 });
```

…and `formatChainWarning` uses `fmtCount`/`fmtMultiplier` instead of its local `fmt`/`fmtSmall`.

- [ ] **Step 2: Write the failing tests**

`web/apps/editor/src/screens/__tests__/ChainWarningTip.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChainWarningTip } from "../ChainWarningTip";
import type { ChainWarning } from "@/lib/chain-load";

const warning: ChainWarning = {
  estimate: 864_000,
  path: [
    { name: "flash", perEmitter: 12, cumulative: 12 },
    { name: "detail", perEmitter: 60, cumulative: 720 },
    { name: "Smoke", perEmitter: 1200, cumulative: 864_000 },
  ],
};

describe("ChainWarningTip", () => {
  it("leads with the meaning and the soft-warning disclaimer", () => {
    render(<ChainWarningTip warning={warning} />);
    expect(screen.getByText("This chain may spawn far too many particles")).toBeInTheDocument();
    expect(screen.getByText("Soft warning — nothing is blocked")).toBeInTheDocument();
  });

  it("renders one row per generation with formatChainWarning's number rules", () => {
    render(<ChainWarningTip warning={warning} />);
    expect(screen.getByText("flash")).toBeInTheDocument();
    expect(screen.getByText("~12 alive")).toBeInTheDocument();
    expect(screen.getByText("→ detail")).toBeInTheDocument();
    expect(screen.getByText("×60 → ~720")).toBeInTheDocument();
    expect(screen.getByText("→ Smoke")).toBeInTheDocument();
    expect(screen.getByText("×1,200 → ~864,000")).toBeInTheDocument();
  });

  it("keeps the sub-10 decimal rule (×0.4 must not render as ×0)", () => {
    render(
      <ChainWarningTip
        warning={{
          estimate: 12_000,
          path: [
            { name: "a", perEmitter: 30_000, cumulative: 30_000 },
            { name: "b", perEmitter: 0.4, cumulative: 12_000 },
          ],
        }}
      />,
    );
    expect(screen.getByText("×0.4 → ~12,000")).toBeInTheDocument();
  });

  it("highlights only the final cumulative", () => {
    render(<ChainWarningTip warning={warning} />);
    const final = screen.getByText("×1,200 → ~864,000");
    expect(final.className).toContain("text-warning");
    expect(screen.getByText("×60 → ~720").className).not.toContain("text-warning");
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
pnpm --filter @particle-editor/editor exec vitest run src/screens/__tests__/ChainWarningTip.test.tsx
```

Expected: FAIL — `Cannot find module '../ChainWarningTip'`.

- [ ] **Step 4: Implement**

`web/apps/editor/src/screens/ChainWarningTip.tsx`:

```tsx
// ChainWarningTip — the [NT-12] rich tooltip body for the NT-11 ⚠
// chain-load glyph (user-picked layout: amber header band + aligned
// name/math rows; spec §4). Consumes ChainWarning.path directly — the
// estimation formula lives only in chain-load.ts, and the number
// formatting is the exported fmtCount/fmtMultiplier pair shared with
// formatChainWarning, so the plain-text and rich presentations can
// never drift.
//
// Rendered INSIDE Tip's .tip-surface (rich tier: no .tip-body padding —
// the band runs edge-to-edge; .tip-surface's overflow:hidden clips it
// to the rounded corner).

import type { ChainWarning } from "@/lib/chain-load";
import { fmtCount, fmtMultiplier } from "@/lib/chain-load";

export function ChainWarningTip({ warning }: { warning: ChainWarning }) {
  return (
    <div data-testid="chain-warning-tip">
      <div className="border-b border-warning/35 bg-warning/15 px-2.5 py-1.5">
        <div className="font-semibold">This chain may spawn far too many particles</div>
        <div className="text-[11px] text-text-2">Soft warning — nothing is blocked</div>
      </div>
      <div className="px-2.5 py-1.5">
        {warning.path.map((p, i) => (
          <div key={i} className="flex items-baseline justify-between gap-4">
            <span>{i === 0 ? p.name : `→ ${p.name}`}</span>
            <span
              className={`font-mono text-[11px] tabular-nums ${
                i === warning.path.length - 1 ? "text-warning font-semibold" : "text-text-2"
              }`}
            >
              {i === 0
                ? `~${fmtMultiplier(p.perEmitter)} alive`
                : `×${fmtMultiplier(p.perEmitter)} → ~${fmtCount(p.cumulative)}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the new tests + the chain-load tests**

```bash
pnpm --filter @particle-editor/editor exec vitest run src/screens/__tests__/ChainWarningTip.test.tsx src/lib/__tests__
```

Expected: ChainWarningTip 4 PASS; all existing chain-load tests still PASS (the formatter extraction is behaviour-neutral).

- [ ] **Step 6: Convert the glyph**

In `EmitterTree.tsx` (~line 852), the warned-row glyph — `title` goes away, `aria-label` switches to the full `formatChainWarning` text (spec §4: screen readers keep the complete breakdown), and the element gains the rich Tip:

```tsx
{chainWarning !== null && (
  <Tip
    content={<ChainWarningTip warning={chainWarning} />}
    side="right"
    occlusionId={`tip:chain-warn:${node.id}`}
  >
    <span
      style={{ gridColumn: 5, gridRow: 1 }}
      data-testid={`emitter-chain-warning-${node.id}`}
      aria-label={formatChainWarning(chainWarning)}
      className="grid place-items-center w-4 h-4 shrink-0 justify-self-center text-amber-400"
    >
      <TriangleAlert className="size-3" />
    </span>
  </Tip>
)}
```

Imports to add in EmitterTree.tsx: `import { Tip } from "@/primitives/Tip";` and `import { ChainWarningTip } from "./ChainWarningTip";` (and `formatChainWarning` is already imported).

NOTE the aria-label change: the goldens capture `Name`. If any golden snapshot covers a warned tree, Task 12's native run will diff — that diff is EXPECTED for this one element and is hand-reviewed + regenerated (`pnpm a11y:update`), not investigated as a regression. NT-11's golden work kept warned rows out of the goldens (DOM-order-last), so the expected outcome is zero diff.

- [ ] **Step 7: Full suite + types + commit**

```bash
pnpm --filter @particle-editor/editor test
pnpm --filter @particle-editor/editor exec tsc -b
git add web/apps/editor/src/screens/ChainWarningTip.tsx web/apps/editor/src/screens/__tests__/ChainWarningTip.test.tsx web/apps/editor/src/lib/chain-load.ts web/apps/editor/src/screens/EmitterTree.tsx
git commit -m "feat(nt-12): rich chain-warning tooltip (amber band + aligned breakdown)"
```

Expected: 681 passed, tsc 0. (If an existing EmitterTree test asserted the glyph's `title` attribute, update it to assert the Tip mounts instead — check `src/screens/__tests__/EmitterTree.test.tsx` for `formatChainWarning` / `title` assertions and convert them to `aria-label` assertions.)

---

### Task 6: Sweep — Toolbar.tsx (9 sites, all T1)

**Files:**
- Modify: `web/apps/editor/src/components/Toolbar.tsx` (lines ~69, 82, 95, 104, 119, 129, 138, 156, 166)

- [ ] **Step 1: Convert all 9 buttons**

Every site is class **T1** (icon button with `title` + matching `aria-label`). Worked example — line 69:

Before:
```tsx
<button … aria-label="New" title="New" …>
```
After:
```tsx
<Tip content="New" occlusionId="tip:toolbar:new">
  <button … aria-label="New" …>
</Tip>
```

Apply identically to: Open (82), Save (95), Save As (104), Step one frame (129), Step 10 frames (138), Show ground (156), Toggle bloom (166) — each with `occlusionId="tip:toolbar:<kebab-name>"`. The conditional Play/Pause button (119) is the same transform with computed content:

```tsx
<Tip content={paused ? "Play" : "Pause"} occlusionId="tip:toolbar:play-pause">
  <button … aria-label={paused ? "Play" : "Pause"} …>
</Tip>
```

All toolbar Tips get occlusionIds: the toolbar sits directly above the viewport quadrant and the default `side="top"` keeps tooltips out of it, BUT Radix collision-flips to `bottom` near the window's top edge — which is exactly over the viewport. Import: `import { Tip } from "@/primitives/Tip";`.

- [ ] **Step 2: Targeted tests + grep gate for the file**

```bash
pnpm --filter @particle-editor/editor exec vitest run src/components/__tests__
grep -n " title=" web/apps/editor/src/components/Toolbar.tsx
```

Expected: component tests PASS (update any that asserted `title=` on toolbar buttons to assert the aria-label or Tip presence instead); grep returns nothing.

- [ ] **Step 3: Commit**

```bash
git add web/apps/editor/src/components/Toolbar.tsx
git commit -m "feat(nt-12): convert Toolbar titles to Tip"
```

---

### Task 7: Sweep — EmitterTree.tsx remainder (9 sites: 1×T1 eye, 7 footer/menu, 1 link-group)

**Files:**
- Modify: `web/apps/editor/src/screens/EmitterTree.tsx` (lines ~751, 1135, 1173, 1183, 1193, 1203, 1213, 1222, 2301)

- [ ] **Step 1: Convert the eye toggle (line ~751, T1+T4)**

Before:
```tsx
<span … role="button" aria-label={node.visible ? "Hide emitter" : "Show emitter"} title={node.visible ? "Hide emitter" : "Show emitter"} …>
```
After:
```tsx
<Tip content={node.visible ? "Hide emitter" : "Show emitter"} side="right" occlusionId={`tip:tree-eye:${node.id}`}>
  <span … role="button" aria-label={node.visible ? "Hide emitter" : "Show emitter"} …>
</Tip>
```

`side="right"` + occlusionId: tree rows open toward the viewport.

- [ ] **Step 2: Classify and convert the seven buttons at lines ~1135-1222 by inspection**

Read each site. Decision rule:
- If the button is **icon-only** (footer mini-toolbar): class T1/T2 → `<Tip content="…" side="top" occlusionId="tip:tree-footer:<name>">`, keep/add `aria-label`.
- If the button is a **menu item with visible text** (inside Radix ContextMenu content): class **T5 → delete the `title=` line, no Tip** (tooltips fight menu pointer capture; the text is visible).

Same rule for the link-group button at ~2301 (`title={`Select link group ${b.groupId}`}`): if it shows the group id as visible text → T5 delete; if it's a colored dot/badge → T1 convert with `side="right"` + occlusionId.

- [ ] **Step 3: Tests + grep gate + commit**

```bash
pnpm --filter @particle-editor/editor exec vitest run src/screens/__tests__/EmitterTree.test.tsx
grep -n " title=" web/apps/editor/src/screens/EmitterTree.tsx
```

Expected: PASS (update any title-asserting tests to aria-label), grep empty.

```bash
git add web/apps/editor/src/screens/EmitterTree.tsx
git commit -m "feat(nt-12): convert EmitterTree titles to Tip (T5 menu titles deleted)"
```

---### Task 8: Sweep — EmitterPropertyTabs.tsx (11 sites: 8×T3 labels, 2×T1 buttons, 1 static label)

**Files:**
- Modify: `web/apps/editor/src/screens/EmitterPropertyTabs.tsx` (lines ~428, 681, 748, 757, 766, 852, 898, 949, 1114, 1384, 1620)

- [ ] **Step 1: Convert the truncation labels (T3 — title === visible text)**

Worked example — line 428:

Before:
```tsx
<span className="lbl" title="Name">Name</span>
```
After:
```tsx
<Tip content="Name" side="left" occlusionId="tip:props:lbl-name">
  <span className="lbl">Name</span>
</Tip>
```

Apply to all `lbl` sites (428, 681, 748, 852, 898, 949, 1114, 1384, 1620; computed ones use `content={label}`). NO aria-label added (visible text is the name; adding one would churn goldens). `side="left"`: the right-dock tooltips open AWAY from the panel edge — but toward the viewport, hence occlusionIds (derive unique ids from the label where computed: `` occlusionId={`tip:props:lbl-${label}`} ``).

- [ ] **Step 2: Convert the two buttons (T1) — lines ~757, 766**

```tsx
<Tip content="Browse for a texture file" occlusionId="tip:props:texture-browse">…</Tip>
<Tip content="Frequently-used textures" occlusionId="tip:props:texture-palette">…</Tip>
```

(keep/add aria-labels per T1/T2.)

- [ ] **Step 3: Tests + grep + commit**

```bash
pnpm --filter @particle-editor/editor exec vitest run src/screens/__tests__
grep -n " title=" web/apps/editor/src/screens/EmitterPropertyTabs.tsx
```

Expected: PASS, grep empty.

```bash
git add web/apps/editor/src/screens/EmitterPropertyTabs.tsx
git commit -m "feat(nt-12): convert EmitterPropertyTabs titles to Tip"
```

---

### Task 9: Sweep — CurveEditorPanel, MenuBar, StatusBar (6 sites)

**Files:**
- Modify: `web/apps/editor/src/components/CurveEditorPanel.tsx` (~1204, 1220, 1247)
- Modify: `web/apps/editor/src/components/MenuBar.tsx` (~439, 851)
- Modify: `web/apps/editor/src/components/StatusBar.tsx` (~69)

- [ ] **Step 1: CurveEditorPanel — 3×T1**

All three are tool buttons with aria-labels. The titles carry MORE text than the labels (e.g. "Select (click a key to select; click empty area to clear)") — the Tip keeps the long explanatory text as content, aria-label unchanged:

```tsx
<Tip content="Select (click a key to select; click empty area to clear)" occlusionId="tip:curve:select">…</Tip>
<Tip content="Insert (click empty canvas to add a key)" occlusionId="tip:curve:insert">…</Tip>
<Tip content={`${label} interpolation`} occlusionId={`tip:curve:interp-${label}`}>…</Tip>
```

- [ ] **Step 2: MenuBar — 1×T5 delete + 1×T1**

- Line ~439 `<Menubar.Item … title={path}>` (Recent Files; the path is already the visible text): **T5 — delete the title, no Tip** (tooltips inside open Radix menus fight pointer capture).
- Line ~851 `<button … title="Reset View Settings">` (inside a dialog): T1 → `<Tip content="Reset View Settings">…</Tip>` — no occlusionId (the modal already occludes the full viewport).

- [ ] **Step 3: StatusBar — 1×T4 conditional**

The `cell` helper (line ~58-74) takes the warn title. Change the value span:

Before:
```tsx
<span className={…} title={warn ? "preview spawn limit reached — spawning paused" : undefined}>{value}</span>
```
After:
```tsx
<Tip content={warn ? "preview spawn limit reached — spawning paused" : undefined} occlusionId={`tip:status:${label}`}>
  <span className={…}>{value}</span>
</Tip>
```

Tip renders the bare span when content is undefined (T4) — unwarned cells get zero tooltip machinery in the a11y tree. `side` stays default `"top"` (opens toward the viewport → occlusionId).

- [ ] **Step 4: Tests + grep + commit**

```bash
pnpm --filter @particle-editor/editor test
pnpm --filter @particle-editor/editor exec tsc -b
grep -n " title=" web/apps/editor/src/components/CurveEditorPanel.tsx web/apps/editor/src/components/MenuBar.tsx web/apps/editor/src/components/StatusBar.tsx
```

Expected: full suite PASS, tsc 0, grep empty.

```bash
git add web/apps/editor/src/components/CurveEditorPanel.tsx web/apps/editor/src/components/MenuBar.tsx web/apps/editor/src/components/StatusBar.tsx
git commit -m "feat(nt-12): convert CurveEditorPanel/MenuBar/StatusBar titles to Tip"
```

---

### Task 10: Sweep — remaining files (6 sites)

**Files:**
- Modify: `web/apps/editor/src/primitives/ColorButton.tsx` (~175, 193)
- Modify: `web/apps/editor/src/primitives/TexturePalette.tsx` (~77)
- Modify: `web/apps/editor/src/screens/TexturePalettePopover.tsx` (~244)
- Modify: `web/apps/editor/src/screens/LightingPanel.tsx` (~526)
- Modify: `web/apps/editor/src/screens/ImportEmittersDialog.tsx` (~189)

- [ ] **Step 1: ColorButton (2×T1, hex-value tooltips inside the color popover)**

```tsx
<Tip content={rgbToHex(color).toUpperCase()} occlusionId="tip:color:swatch">…</Tip>
<Tip content={color ? rgbToHex(color).toUpperCase() : "Empty"} occlusionId="tip:color:slot">…</Tip>
```

(occlusionIds because the popover's own occlusion ring may not cover a tooltip extending past it.)

- [ ] **Step 2: TexturePalette + TexturePalettePopover (2×T1, filename tooltips)**

```tsx
<Tip content={item.label ?? item.path} occlusionId="tip:texpal:item">…</Tip>
<Tip content={entry.filename} occlusionId="tip:texpop:entry">…</Tip>
```

- [ ] **Step 3: LightingPanel (1×T6 — tooltip on a DISABLED control)**

Line ~526: `title={forceAlign ? "Disabled while Force Align is on" : undefined}` with `disabled={forceAlign}`. Disabled buttons fire no pointer events — span shim:

```tsx
<Tip content={forceAlign ? "Disabled while Force Align is on" : undefined} occlusionId="tip:lighting:force-align">
  <span className="inline-block">
    <button … disabled={forceAlign} …>…</button>
  </span>
</Tip>
```

CHECK: if the button's layout breaks inside the span (flex/grid parent), move the existing layout classes onto the span. Verify in the browser dev run (Task 12).

- [ ] **Step 4: ImportEmittersDialog (1×T3/T4 — source path display)**

```tsx
<Tip content={sourcePath ?? undefined}>
  <span …>{…}</span>
</Tip>
```

No occlusionId — inside a modal (full-viewport occlusion already active).

- [ ] **Step 5: Tests + grep + commit**

```bash
pnpm --filter @particle-editor/editor test
pnpm --filter @particle-editor/editor exec tsc -b
grep -rn " title=" web/apps/editor/src --include="*.tsx" | grep -v __tests__ | grep -v "\.test\.tsx"
```

Expected: full suite PASS, tsc 0. Grep: ONLY component-prop `title=` lines remain (`<Modal title=`, `<ToolPanel title=` — these are props, not DOM attributes; verify by eye that every remaining hit is uppercase-component or a prop signature).

```bash
git add web/apps/editor/src/primitives/ColorButton.tsx web/apps/editor/src/primitives/TexturePalette.tsx web/apps/editor/src/screens/TexturePalettePopover.tsx web/apps/editor/src/screens/LightingPanel.tsx web/apps/editor/src/screens/ImportEmittersDialog.tsx
git commit -m "feat(nt-12): convert remaining titles to Tip (sweep complete)"
```

---

### Task 11: Modal retrofit + usePresence + OverloadBanner (TDD)

**Files:**
- Modify: `web/apps/editor/src/components/Modal.tsx` (~252, 261)
- Create: `web/apps/editor/src/lib/use-presence.ts`
- Create: `web/apps/editor/src/lib/__tests__/use-presence.test.ts`
- Modify: `web/apps/editor/src/components/OverloadBanner.tsx`
- Modify: `web/apps/editor/src/components/__tests__/OverloadBanner.test.tsx`
- Modify: `web/apps/editor/src/components/__tests__/Modal.test.tsx`
- Modify: `web/apps/editor/src/styles/components.css` (after the [NT-12] tooltip section)

- [ ] **Step 1: Modal — delete the dead utilities, add real classes**

Overlay (line ~252): `data-[state=open]:animate-in data-[state=open]:fade-in-0` → `modal-overlay-animate`.
Content (line ~261): `data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95` → `modal-animate`. The static `-translate-x-1/2 -translate-y-1/2` centering classes STAY (the keyframes repeat the centering transform in from/to so the element never jumps when the animation starts or ends).

- [ ] **Step 2: Modal + banner keyframes in components.css**

```css
/* ---- [NT-12] Modal + overload-banner motion (slow tier) ----
   Same family as the tooltips: fade + slip away from the resting
   position. Modal rises 8px into center; banner drops 6px from the
   viewport's top edge. Radix Dialog's Presence plays the modal exit;
   the banner's exit needs usePresence (lib/use-presence.ts) because it
   custom-unmounts. The modal keyframes must repeat the -translate-x/y-1/2
   centering so the transform composes instead of replacing it. */
@keyframes modal-overlay-in  { from { opacity: 0; } to { opacity: 1; } }
@keyframes modal-overlay-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes modal-in {
  from { opacity: 0; transform: translate(-50%, calc(-50% + var(--slip-modal))); }
  to   { opacity: 1; transform: translate(-50%, -50%); }
}
@keyframes modal-out {
  from { opacity: 1; transform: translate(-50%, -50%); }
  to   { opacity: 0; transform: translate(-50%, calc(-50% + var(--slip-modal))); }
}
.modal-overlay-animate[data-state="open"]   { animation: modal-overlay-in var(--motion-slow-in) var(--ease-entrance); }
.modal-overlay-animate[data-state="closed"] { animation: modal-overlay-out var(--motion-slow-out) var(--ease-exit); }
.modal-animate[data-state="open"]   { animation: modal-in var(--motion-slow-in) var(--ease-entrance); }
.modal-animate[data-state="closed"] { animation: modal-out var(--motion-slow-out) var(--ease-exit); }

@keyframes banner-in {
  from { opacity: 0; transform: translate(-50%, calc(-1 * var(--slip-banner))); }
  to   { opacity: 1; transform: translate(-50%, 0); }
}
@keyframes banner-out {
  from { opacity: 1; transform: translate(-50%, 0); }
  to   { opacity: 0; transform: translate(-50%, calc(-1 * var(--slip-banner))); }
}
/* The banner's Tailwind -translate-x-1/2 centering persists outside the
   animation; the keyframes repeat it in from/to. box-shadow lives here
   (not a Tailwind arbitrary value) so it stays var()-driven. */
.banner-animate { box-shadow: var(--shadow-soft); }
.banner-animate[data-state="open"]   { animation: banner-in var(--motion-slow-in) var(--ease-entrance) both; }
.banner-animate[data-state="closed"] { animation: banner-out var(--motion-slow-out) var(--ease-exit) both; }

@media (prefers-reduced-motion: reduce) {
  .modal-overlay-animate[data-state="open"], .modal-overlay-animate[data-state="closed"],
  .modal-animate[data-state="open"], .modal-animate[data-state="closed"],
  .banner-animate[data-state="open"], .banner-animate[data-state="closed"] { animation: none; }
}
```

- [ ] **Step 3: Modal.test.tsx — add the class assertions**

Add to the existing describe (the current tests assert `bg-bg-2` present and `shadow-xl` absent — unaffected):

```tsx
it("uses the NT-12 motion classes, not the dead animate-in utilities", () => {
  render(<Modal open onOpenChange={() => {}} title="T"><Modal.Body>b</Modal.Body></Modal>);
  const content = screen.getByRole("dialog");
  expect(content.className).toContain("modal-animate");
  expect(content.className).not.toContain("animate-in");
  const overlay = screen.getByTestId("modal-overlay");
  expect(overlay.className).toContain("modal-overlay-animate");
  expect(overlay.className).not.toContain("animate-in");
});
```

- [ ] **Step 4: usePresence — failing tests first**

`web/apps/editor/src/lib/__tests__/use-presence.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePresence } from "../use-presence";

describe("usePresence", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("mounts immediately on a rising edge", () => {
    const { result, rerender } = renderHook(({ v }) => usePresence(v, 150), { initialProps: { v: false } });
    expect(result.current.mounted).toBe(false);
    rerender({ v: true });
    expect(result.current.mounted).toBe(true);
    expect(result.current.state).toBe("open");
  });

  it("stays mounted in state=closed during exit, unmounts on onAnimationEnd", () => {
    const { result, rerender } = renderHook(({ v }) => usePresence(v, 150), { initialProps: { v: true } });
    rerender({ v: false });
    expect(result.current.mounted).toBe(true);
    expect(result.current.state).toBe("closed");
    act(() => result.current.onAnimationEnd());
    expect(result.current.mounted).toBe(false);
  });

  it("unmounts via the timeout fallback when no animationend arrives (reduced motion)", () => {
    const { result, rerender } = renderHook(({ v }) => usePresence(v, 150), { initialProps: { v: true } });
    rerender({ v: false });
    expect(result.current.mounted).toBe(true);
    act(() => vi.advanceTimersByTime(150 + 50 + 1));
    expect(result.current.mounted).toBe(false);
  });

  it("re-latch mid-exit cancels the unmount", () => {
    const { result, rerender } = renderHook(({ v }) => usePresence(v, 150), { initialProps: { v: true } });
    rerender({ v: false });
    rerender({ v: true }); // overload flickers back during the exit
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.mounted).toBe(true);
    expect(result.current.state).toBe("open");
  });
});
```

Run, expect FAIL (module missing). Then implement `web/apps/editor/src/lib/use-presence.ts`:

```ts
// usePresence — keeps an element mounted through its CSS exit animation
// ([NT-12]; built for OverloadBanner, generic for any custom-unmount
// surface). Radix components get this from Presence for free; this is
// the shim for `cond ? <El/> : null` mounts.
//
// The unmount fires on animationend OR a timeout fallback (exitMs +
// 50ms slack) — reduced-motion sets `animation: none`, which fires NO
// animationend, and a dropped event must never leak a mounted ghost
// (or its viewport-occlusion registration).

import { useEffect, useRef, useState } from "react";

export function usePresence(visible: boolean, exitMs: number): {
  mounted: boolean;
  state: "open" | "closed";
  onAnimationEnd: () => void;
} {
  const [mounted, setMounted] = useState(visible);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (visible) {
      // Rising edge (or re-latch mid-exit): cancel any pending unmount.
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      setMounted(true);
      return;
    }
    // Falling edge: let the exit animation play, then force-unmount.
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setMounted(false);
    }, exitMs + 50);
    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [visible, exitMs]);

  const onAnimationEnd = () => {
    if (!visible) {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      setMounted(false);
    }
  };

  return { mounted, state: visible ? "open" : "closed", onAnimationEnd };
}
```

Run the 4 tests → PASS.

- [ ] **Step 5: OverloadBanner — shim + soft shadow**

`web/apps/editor/src/components/OverloadBanner.tsx` — the body gains `data-state` + `onAnimationEnd` + the `banner-animate` class (which now carries the soft shadow; `shadow-xl ring-1 ring-black/15` deleted), the wrapper drives `usePresence`:

```tsx
import { usePresence } from "@/lib/use-presence";

// EXIT_MS must equal --motion-slow-out (tokens.css). The +50ms slack
// lives inside usePresence.
const EXIT_MS = 150;

function OverloadBannerBody({ bridge, state, onAnimationEnd }: {
  bridge: Bridge;
  state: "open" | "closed";
  onAnimationEnd: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useViewportOcclusion(bridge, "banner:preview-overload", ref, 12, 12, true);
  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      data-testid="preview-overload-banner"
      data-state={state}
      onAnimationEnd={(e) => { if (e.animationName === "banner-out") onAnimationEnd(); }}
      className="banner-animate pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 select-none rounded-md bg-warning px-3 py-1.5 text-xs font-medium text-[#1a1200]"
    >
      Preview spawning limited — lower spawn rates to resume. ⚠ marks
      heavy emitters.
    </div>
  );
}

export function OverloadBanner({ bridge }: { bridge: Bridge }) {
  const [overload, setOverload] = useState(false);
  useEffect(
    () => bridge.on("stats/tick", (e) => setOverload(e.payload.overload)),
    [bridge],
  );
  const { mounted, state, onAnimationEnd } = usePresence(overload, EXIT_MS);
  if (!mounted) return null;
  return <OverloadBannerBody bridge={bridge} state={state} onAnimationEnd={onAnimationEnd} />;
}
```

(All existing header comments stay; add a paragraph noting the [NT-12] presence shim + that the occlusion now outlives the latch by one ~150ms exit.)

- [ ] **Step 6: Update OverloadBanner.test.tsx**

The existing "releases occlusion on clear" test now needs the exit to complete before asserting the release. With real timers, the timeout fallback (150+50ms) fires the unmount; jsdom plays no CSS animations so NO animationend arrives — the fallback is the unmount path under test:

```tsx
// In the clear-path assertions, after emit("stats/tick", tick(false)):
// banner is still mounted (exit playing)
expect(screen.getByTestId("preview-overload-banner")).toHaveAttribute("data-state", "closed");
// fast-forward past EXIT_MS + slack (use vi.useFakeTimers() in this test,
// or await a ~250ms real-timer wait)
await act(async () => { await new Promise((r) => setTimeout(r, 250)); });
expect(screen.queryByTestId("preview-overload-banner")).not.toBeInTheDocument();
// …then the existing occlusion-release assertions run unchanged.
```

Also add: the banner element carries `banner-animate` and does NOT carry `shadow-xl`:

```tsx
it("wears the soft-shadow motion class instead of shadow-xl", () => {
  const { bridge, emit } = makeBridge();
  render(<OverloadBanner bridge={bridge} />);
  emit("stats/tick", tick(true));
  const banner = screen.getByTestId("preview-overload-banner");
  expect(banner.className).toContain("banner-animate");
  expect(banner.className).not.toContain("shadow-xl");
  expect(banner.className).not.toContain("ring-1");
});
```

- [ ] **Step 7: Full suite + types + commit**

```bash
pnpm --filter @particle-editor/editor test
pnpm --filter @particle-editor/editor exec tsc -b
git add web/apps/editor/src/components/Modal.tsx web/apps/editor/src/lib/use-presence.ts web/apps/editor/src/lib/__tests__/use-presence.test.ts web/apps/editor/src/components/OverloadBanner.tsx web/apps/editor/src/components/__tests__/OverloadBanner.test.tsx web/apps/editor/src/components/__tests__/Modal.test.tsx web/apps/editor/src/styles/components.css
git commit -m "feat(nt-12): modal + overload-banner entrance/exit animations (usePresence shim, soft shadow)"
```

Expected: ~686+ passed (681 + usePresence 4 + new assertions), tsc 0.

---

### Task 12: Full verification gates

**Files:** none modified (except possible golden regeneration — see Step 4).

- [ ] **Step 1: The authoritative title-grep gate**

```bash
grep -rn " title=" web/apps/editor/src --include="*.tsx" | grep -v __tests__ | grep -v "\.test\.tsx"
```

Expected: every remaining hit is a component PROP (`<Modal title=`, `<ToolPanel title=`, `<Dialog.Title`) — zero DOM-element `title=` attributes. Any stragglers the census missed get converted by class rules now (the census count is advisory; this gate is authoritative — L-022).

- [ ] **Step 2: Web gates**

```bash
pnpm --filter @particle-editor/editor test
pnpm --filter @particle-editor/editor exec tsc -b
pnpm --filter @particle-editor/editor exec vite build
```

Expected: all green. Record the final test count.

- [ ] **Step 3: Build for the host (L-040) + host Debug x64 (L-046: MSBuild via PowerShell, VS18)**

```bash
cd "C:\Modding\Particle Editor\.claude\worktrees\tender-satoshi-5ff472\web"
pnpm build
```

Then via PowerShell:

```powershell
& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" ParticleEditor.sln /p:Configuration=Debug /p:Platform=x64 /m
```

Expected: clean build (benign LNK4098 only).

- [ ] **Step 4: Native harness (a11y goldens — expect ZERO diff)**

```bash
cd web && pnpm --filter @particle-editor/editor test:native   # runs scripts/run-native-tests.mjs
```

Expected: **177 passed / 0 failed** (30 skipped) with zero golden diffs — `HelpText` is volatile-listed, aria-labels were preserved per the class rules. IF a diff appears: hand-review it against the class rules (T2 added labels and the Task 5 glyph aria-label change are the only legitimate Name changes); only after confirming each diff is intentional, regenerate via `pnpm a11y:update` and commit the goldens with an explanation.

- [ ] **Step 5: Browser-mode smoke (L-041 — agent CAN verify the web lane)**

`pnpm dev` + MockBridge in a browser: hover a toolbar button (tooltip after ~400ms, instant on sweep), the props labels, the ⚠ glyph in a warned mock tree (rich band renders, side=right), open/close a modal (rise + fade both ways), reduced-motion via devtools emulation (no animation, everything still mounts/unmounts). Screenshot the rich tooltip for the PR.

- [ ] **Step 6: Commit anything Step 1/4 changed; push; CI**

```bash
git push -u origin claude/tender-satoshi-5ff472
gh pr create --base master --title "feat(nt-12): styled/animated tooltips app-wide + modal/banner motion family" --body-file <tempfile per memory project_powershell_git_commit_quoting>
```

PR body: what shipped, the two spec deviations (golden no-churn finding, census), test counts, the feel-test checklist for the user.

---

### Task 13: ROADMAP + CHANGELOG + handoff

**Files:**
- Modify: `ROADMAP.md` (NT-12 → Shipped §5.1, renumber §1, vacate the tag)
- Modify: `CHANGELOG.md` (new top entry, `TODO` hash placeholder until merge)
- Modify: `tasks/todo.md` (review section)

- [ ] **Step 1: ROADMAP per the CLAUDE.md five-step ship rule** — strikethrough + `✅ Shipped (#NN)`, *Actual:* line, move to Shipped §5.1 (shift the rest down), renumber §1 (1.2→1.1 etc.), NT-12 tag retired. **Use .NET File IO per memory `project_ps51_utf8_file_edits` — the file contains ★ and — characters.**

- [ ] **Step 2: CHANGELOG entry** (three sections: what ships / how we tackled it / issues encountered), date-line with `TODO` hash + PR number, backfill after merge (prior-art #27 pattern).

- [ ] **Step 3: Append the review section to `tasks/todo.md`** (what shipped, deviations, what the user still needs to feel-test), commit:

```bash
git add ROADMAP.md CHANGELOG.md tasks/todo.md
git commit -m "docs: NT-12 ships — ROADMAP + CHANGELOG"
```

- [ ] **Step 4: USER GATE — feel test + merge OK.** The user launches the editor themselves (L-033/L-078: feel-test builds are USER-launched). Checklist for them: tooltip delay + sweep feel; slip direction; ⚠ rich tooltip over the real viewport (occlusion); a modal open/close; banner appear/clear (spinner-bomb then lower the rate); both themes; reduced-motion if convenient. Merge only on explicit OK.
