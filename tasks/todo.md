# Phase 3 a11y close-out — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Predecessor:** [docs/superpowers/specs/2026-05-25-phase-3-a11y-closeout-design.md](../docs/superpowers/specs/2026-05-25-phase-3-a11y-closeout-design.md)
**Target branch:** `lt-4`
**Difficulty:** ★★★★ (upper edge)
**Effort estimate:** ~3-4 days; possibly 5 with surface-driver complexity.

**Architecture (one paragraph):** Playwright spec-per-category captures
the Win32 UI Automation tree for each chrome surface via a small UIA
inspector (Node lib if Phase 0 finds one, else a C++ standalone exe
matching `dxgi_spike.cpp`). A normalizer drops volatile UIA fields and
sorts deterministically; a custom `toMatchJSONGolden` matcher diffs
against committed JSON goldens with `pnpm a11y:update` regeneration. A
dedicated cross-mode equality spec asserts byte-equality between the
HWND golden and composition golden for each surface — the FD6-class
regression gate, encoded. Stage 3i manual checklist + Narrator-speech
recording archive the one-time confidence pass.

**Tech stack:** TypeScript (Playwright + Vitest), C++ (only if Phase 0
rules out Node UIA lib), Windows UI Automation API, Radix UI ARIA
primitives already in chrome.

---

## 1. Goal + scope

**When this ships:** the new-UI chrome has a durable Playwright a11y
regression gate covering ~30 interactive surfaces, runs in both HWND
default mode and composition mode, asserts cross-mode equality as an
explicit invariant, and has a one-time manual Narrator-speech recording
archived. Phase 3 acceptance can be declared closed.

**In scope:** Phase 0 spike (Node-lib search + cross-mode probe); UIA
inspector tool; normalizer + allowlist + custom matcher; surface
drivers (~30); 4 spec files (chrome / dialogs / keyboard / curve-spinner);
cross-mode equality spec; Stage 3i manual checklist + Narrator
recording; ROADMAP + CHANGELOG + HANDOFF updates.

**Out of scope:** programmatic Narrator-speech automation (out-of-spec
deferral); a11y *improvements* (this dispatch measures; fixes are
separate dispatches); surfaces requiring >30 min of fixture setup
(drop + file follow-up per R3); per-Windows-version test matrix.

**Explicitly not happening:** silently allowing per-mode goldens to
diverge to make the cross-mode spec pass. R2 mitigation handles this.

---

## 2. What the codebase already gives us

| Existing | How it's relevant |
|---|---|
| `web/apps/editor/tests/*.spec.ts` (~32 specs) | Native test harness; pattern + `pnpm test:native` invocation. |
| `dxgi-transport.spec.ts` + `composition-hosting.spec.ts` | Composition-mode-gated spec pattern; existing mode lane wired. |
| `dxgi_spike.cpp` + `viewport_poc.vcxproj` | Template for `uia_inspector.cpp` if Phase 0 rules out Node libs. |
| `@radix-ui/react-menubar` + Radix Dialog | Provide most ARIA semantics out of the box; 268 explicit `aria/role` attrs across 44 files supplement. |
| `ALO_WEBVIEW2_HOSTING=composition` env-var pattern | Composition lane mechanism already in place. |
| Existing bridge surface (`window.bridge.request(...)`) + `--gen-nt5-fixture` CLI tooling pattern | Surface drivers (C4) drive state via `page.evaluate(() => window.bridge.request(...))`; fixture loaded via existing `file/open` bridge call against a committed `.alo` (or a new `--gen-a11y-fixture` CLI flag mirroring NT-5's). |
| Test harness pattern in [`dxgi-transport.spec.ts`](web/apps/editor/tests/dxgi-transport.spec.ts:45) — `chromium.connectOverCDP(CDP_ENDPOINT)` with `beforeAll` browser connect + shared `page` across tests in a file | The a11y specs follow this exact pattern. The harness orchestrates the binary launch; specs assume it's already running and connect via CDP at `http://localhost:9222`. |
| `package.json` scripts | Add `a11y` + `a11y:update` alongside; no new tooling deps. |

---

## 3. Architecture / implementation approach

See spec §4 for full diagrams. Key points reproduced here:

- **Three lanes:** HWND default lane + composition lane + cross-mode
  equality spec (pure file IO, doesn't need either mode).
- **Test contract behind a seam:** `helpers/uia.ts#captureUIA(hwnd,
  surfaceId)` hides whether the impl is Node lib or C++ exe.
- **Normalization pipeline:** drop non-allowlist + drop explicit
  volatile + drop always-strip wrappers + sort children deterministically
  + canonical JSON.
- **Phase 0 hard gate:** if cross-mode wrapper-visual probe reveals
  structurally different tree shapes, STOP and re-plan.

---

## 4. Risks + mitigations (summary; full text in spec §7)

- **R1** — No Node UIA lib found. **Mitigation:** budget C++ inspector
  (~3-4h) as expected case.
- **R2** — Cross-mode equality not feasible. **Mitigation:** Phase 0
  probe answers before any helper code; normalizer's "always strip"
  step handles wrapper-visual case; structural divergence triggers
  STOP-and-replan.
- **R3** — Surface drivers (C4) 2-4× harder than they look.
  **Mitigation:** hard 4h cap on C4; drop surfaces needing >30 min
  setup; file as follow-up.
- **R4** — Surface count doubles to 30-50 per mode. **Mitigation:**
  per-surface `pnpm a11y:update --grep` bounds regen cost; stop at 50.
- **R5** — Narrator-speech reproducibility. **Mitigation:** Stage 3i
  checklist documents assumed Narrator config; recording archives both.
- **R6** — Plan assumes harness shape (CDP-connect, `bridge.request("file/open", ...)`,
  `discoverHostHwnd()` via PowerShell) that may not match reality
  end-to-end. **Mitigation:** T9.0 pre-flight verifies each assumption
  against the existing `dxgi-transport.spec.ts` pattern + the actual
  bridge surface before any spec is written. Surface drivers (T5–T8)
  also bake in assumptions about `data-testid` selectors that need
  source-side additions; T5.1 step 2 calls this out explicitly.

---

## 5. Testing & verification (summary; full categories in spec §8)

Verification gate for "Phase 3 a11y close-out is done":

1. Vitest still 343/343 + N new tests for the normalizer.
2. Playwright HWND lane gains new specs; total stays green.
3. Playwright composition lane gains new specs; total stays green.
4. Cross-mode equality spec passes.
5. MSBuild Debug + Release x64 clean (matters only if C++ inspector ships).
6. Stage 3i checklist all checked; recording committed.
7. ROADMAP MT-11 Phase 3 marked closed.
8. CHANGELOG entry written per CLAUDE.md formatting.
9. HANDOFF refreshed.

---

## 6. Task breakdown

Tasks are sequenced; **T0 is a hard gate** before T3+. T1–T2 can run in
parallel with T0 (don't depend on Phase 0 outcome). T5–T8 (surface
drivers) and T9 (specs) need T1–T4 done.

### Task T0: Phase 0 spike — Node-lib search + cross-mode probe

**Why:** spec §4.2 / R1 / R2. Answers two architectural questions
before any helper code exists.

**Files:**
- Create: `tasks/phase-0-a11y-uia-node-lib-search.md`
- Create: `tasks/phase-0-a11y-cross-mode-probe.md`

#### T0.1 — Pre-flight + lineage check

- [ ] **Step 1:** Verify lineage clean.

```powershell
git fetch origin lt-4 --quiet
git log --oneline origin/lt-4..HEAD   # should be 0
git log --oneline HEAD..origin/lt-4   # should be 0
```

- [ ] **Step 2:** Run pre-coding gate (vitest + lint + MSBuild).

```powershell
pnpm --filter @particle-editor/editor lint
pnpm --filter @particle-editor/editor test
MSBuild .\ParticleEditor.sln /p:Configuration=Debug /p:Platform=x64 /m
MSBuild .\ParticleEditor.sln /p:Configuration=Release /p:Platform=x64 /m
```

Expected: lint 0 errors, vitest 343/343, both MSBuild configs clean
(LIBCMTD warning unchanged baseline).

#### T0.2 — Node-lib search

- [ ] **Step 1:** Search npm registry for Win32 UIA bindings.

Search terms to try:
- `npm search "ui automation windows"`
- `npm search "uiautomation"`
- `npm search "win32 accessibility"`
- Look at: `@nut-tree/nut-js` (cross-platform desktop automation),
  `node-uiautomation`, `winax` (Windows ActiveX bridge).

- [ ] **Step 2:** For each candidate, evaluate:
  - Last published date (< 12 months = likely maintained)
  - Weekly downloads (> 1k = some adoption)
  - Whether README shows `IUIAutomation::ElementFromHandle` or
    equivalent tree-walk API
  - GitHub issues/PRs activity

- [ ] **Step 3:** Write findings to `tasks/phase-0-a11y-uia-node-lib-search.md`.

Template:
```markdown
# Phase 0 — Node-side UIA library search

**Date:** 2026-05-25
**Question:** Is there a maintained Node binding for Win32 UI
Automation usable from Playwright tests?

## Candidates evaluated

| Lib | Last published | Weekly DL | UIA tree walk? | Verdict |
|---|---|---|---|---|
| ... | ... | ... | ... | ... |

## Decision

[GO with <lib name>] OR [NO usable lib; ship C++ uia_inspector.cpp]

## Reasoning

...
```

- [ ] **Step 4:** Commit the findings doc.

```powershell
git add tasks/phase-0-a11y-uia-node-lib-search.md
git commit -m @'
docs(LT-4): [MT-11 a11y] Phase 0 — Node-side UIA lib search

Search results for Win32 UIA Node bindings. Decision: <GO/NO>.
'@
```

#### T0.3 — Cross-mode wrapper-visual probe

- [ ] **Step 1:** Build current dist/ in default HWND mode.

```powershell
cd web
Remove-Item Env:VITE_VIEWPORT_TRANSPORT -ErrorAction SilentlyContinue
Remove-Item Env:VITE_WEBVIEW2_HOSTING -ErrorAction SilentlyContinue
pnpm --filter @particle-editor/editor build
cd ..
```

- [ ] **Step 2:** Launch editor, capture HWND of host window.

```powershell
./x64/Debug/ParticleEditor.exe --new-ui
# In another terminal:
# Use the editor's known window title to find HWND via:
$proc = Get-Process ParticleEditor | Select-Object -First 1
$hwnd = $proc.MainWindowHandle
"HWND: 0x{0:X}" -f $hwnd.ToInt64()
```

- [ ] **Step 3:** Run `inspect.exe` (Windows SDK tool) against the
  HWND. Navigate to menubar, capture properties.

Path to inspect.exe (likely):
`C:\Program Files (x86)\Windows Kits\10\bin\<sdk-ver>\x64\inspect.exe`

If inspect.exe not available, use PowerShell:
```powershell
Add-Type -AssemblyName UIAutomationClient
$auto = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
$auto | Format-List Name, ControlType, ClassName, IsKeyboardFocusable
$auto.FindAll(
  [System.Windows.Automation.TreeScope]::Children,
  [System.Windows.Automation.Condition]::TrueCondition
) | ForEach-Object {
    $_ | Format-List Name, ControlType, ClassName
}
```

Save output to `tasks/phase-0-hwnd-menubar-uia.txt`.

- [ ] **Step 4:** Close editor. Rebuild dist/ in composition mode.

```powershell
cd web
$env:VITE_VIEWPORT_TRANSPORT = "canvas-jpeg"
$env:VITE_WEBVIEW2_HOSTING = "composition"
pnpm --filter @particle-editor/editor build
cd ..
```

- [ ] **Step 5:** Launch in composition mode.

```powershell
$env:ALO_VIEWPORT_TRANSPORT = "canvas-jpeg"
$env:ALO_WEBVIEW2_HOSTING = "composition"
./x64/Debug/ParticleEditor.exe --new-ui
```

- [ ] **Step 6:** Repeat T0.3 step 3 against the new HWND. Save to
  `tasks/phase-0-composition-menubar-uia.txt`.

- [ ] **Step 7:** Diff the two captures. Look for:
  - Extra root-level wrapper visual in composition mode → normalizer
    "always strip" entry needed; cross-mode contract holds.
  - Structurally different tree (different child counts at multiple
    levels, different ControlTypes) → cross-mode contract NOT feasible.
  - Identical tree shapes → cleanest case; no special handling needed.

- [ ] **Step 8:** Write findings to `tasks/phase-0-a11y-cross-mode-probe.md`.

Template:
```markdown
# Phase 0 — Cross-mode UIA-tree wrapper-visual probe

**Date:** 2026-05-25
**Question:** Does composition mode expose a different UIA tree than
HWND mode for the same surface?

## Capture method

[inspect.exe / PowerShell UIAutomationClient]

## Surface tested

Menubar at boot (no menus open).

## HWND-mode tree (top 3 levels)

[paste]

## Composition-mode tree (top 3 levels)

[paste]

## Diff

[describe]

## Decision

[GO with cross-mode equality contract, with these normalizer rules: ...]
OR
[STOP and re-plan — cross-mode contract NOT feasible because ...]
```

- [ ] **Step 9:** Commit probe doc.

```powershell
git add tasks/phase-0-*.md tasks/phase-0-*.txt
git commit -m @'
docs(LT-4): [MT-11 a11y] Phase 0 — cross-mode UIA probe

Captured UIA trees for menubar in HWND vs composition mode.
Decision: <GO/STOP>.
'@
```

- [ ] **Step 10:** GATE CHECK — if probe says STOP, halt this plan
  and notify user. Else proceed to T1.

#### T0.4 — Reset to default HWND mode for subsequent work

- [ ] **Step 1:** Clear composition env vars + rebuild default dist/.

```powershell
Remove-Item Env:ALO_VIEWPORT_TRANSPORT
Remove-Item Env:ALO_WEBVIEW2_HOSTING
Remove-Item Env:VITE_VIEWPORT_TRANSPORT
Remove-Item Env:VITE_WEBVIEW2_HOSTING
cd web
pnpm --filter @particle-editor/editor build
cd ..
```

---

### Task T1: Normalizer + allowlist + unit tests (TDD)

**Why:** spec §5 C2/C3 + §4.4. Pure-TS, no UIA dependency, fully
unit-testable. Foundation for T9+ specs.

**Files:**
- Create: `web/apps/editor/tests/helpers/a11y-allowlist.json`
- Create: `web/apps/editor/tests/helpers/a11y-normalizer.ts`
- Create: `web/apps/editor/src/lib/__tests__/a11y-normalizer.test.ts`

#### T1.1 — Allowlist config

- [ ] **Step 1:** Create the allowlist with initial stable / volatile
  / always-strip sets.

`web/apps/editor/tests/helpers/a11y-allowlist.json`:
```json
{
  "stable": [
    "Name",
    "ControlType",
    "AutomationId",
    "IsKeyboardFocusable",
    "IsEnabled",
    "IsOffscreen",
    "HasKeyboardFocus",
    "LocalizedControlType",
    "LegacyAccessible.Role",
    "LegacyAccessible.State",
    "ExpandCollapse.ExpandCollapseState",
    "SelectionItem.IsSelected",
    "Toggle.ToggleState"
  ],
  "volatile": [
    "BoundingRectangle",
    "RuntimeId",
    "ProcessId",
    "HelpText",
    "ItemStatus",
    "FrameworkId"
  ],
  "alwaysStripWrappers": [
  ]
}
```

Note: `alwaysStripWrappers` starts empty. T0.3 probe outcome
populates it (e.g. `["WebView2CompositionRoot"]` if such a wrapper
exists).

#### T1.2 — Normalizer test scaffolding (TDD step 1)

- [ ] **Step 1:** Write failing test.

`web/apps/editor/src/lib/__tests__/a11y-normalizer.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { normalize } from "@/lib/a11y-normalizer";
import allowlist from "../../../tests/helpers/a11y-allowlist.json";

describe("a11y-normalizer", () => {
  it("drops properties not in the stable set", () => {
    const raw = {
      Name: "File",
      ControlType: "MenuItem",
      BoundingRectangle: "0,0,100,20",
      RuntimeId: "12,345",
      children: [],
    };
    const out = normalize(raw, allowlist);
    expect(out).toEqual({
      Name: "File",
      ControlType: "MenuItem",
      children: [],
    });
  });
});
```

- [ ] **Step 2:** Run test, verify it fails.

```powershell
pnpm --filter @particle-editor/editor test -- a11y-normalizer
```

Expected: FAIL with "Cannot find module '@/lib/a11y-normalizer'".

#### T1.3 — Normalizer implementation (TDD step 2)

- [ ] **Step 1:** Implement normalizer.

`web/apps/editor/tests/helpers/a11y-normalizer.ts`:
```typescript
export type UIANode = {
  Name?: string;
  ControlType?: string;
  AutomationId?: string;
  IsKeyboardFocusable?: boolean;
  IsEnabled?: boolean;
  IsOffscreen?: boolean;
  HasKeyboardFocus?: boolean;
  LocalizedControlType?: string;
  ["LegacyAccessible.Role"]?: string;
  ["LegacyAccessible.State"]?: string;
  ["ExpandCollapse.ExpandCollapseState"]?: string;
  ["SelectionItem.IsSelected"]?: boolean;
  ["Toggle.ToggleState"]?: string;
  children?: UIANode[];
  [k: string]: unknown;
};

export type Allowlist = {
  stable: string[];
  volatile: string[];
  alwaysStripWrappers: string[];
};

export function normalize(node: UIANode, allowlist: Allowlist): UIANode {
  const stable = new Set(allowlist.stable);
  const stripped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "children") continue;
    if (stable.has(k)) stripped[k] = v;
  }
  let children = (node.children ?? []).map((c) => normalize(c, allowlist));
  // Strip wrapper visuals: if a child's AutomationId or ControlType
  // matches alwaysStripWrappers, replace it with its children.
  const wrappers = new Set(allowlist.alwaysStripWrappers);
  children = children.flatMap((c) => {
    const isWrapper =
      (c.AutomationId && wrappers.has(c.AutomationId)) ||
      (c.ControlType && wrappers.has(c.ControlType));
    return isWrapper ? (c.children ?? []) : [c];
  });
  // Deterministic sort: AutomationId first, then Name, then ControlType.
  children.sort((a, b) => {
    const ka = `${a.AutomationId ?? ""}|${a.Name ?? ""}|${a.ControlType ?? ""}`;
    const kb = `${b.AutomationId ?? ""}|${b.Name ?? ""}|${b.ControlType ?? ""}`;
    return ka.localeCompare(kb);
  });
  stripped.children = children;
  return stripped as UIANode;
}
```

Also re-export from `web/apps/editor/src/lib/a11y-normalizer.ts` so
vitest can import via `@/lib/a11y-normalizer`:
```typescript
export {
  normalize,
  type UIANode,
  type Allowlist,
} from "../../tests/helpers/a11y-normalizer";
```

- [ ] **Step 2:** Re-run test, verify it passes.

```powershell
pnpm --filter @particle-editor/editor test -- a11y-normalizer
```

Expected: PASS.

#### T1.4 — More normalizer tests (TDD: add then implement)

- [ ] **Step 1:** Add test for deterministic child sorting.

```typescript
it("sorts children deterministically by AutomationId then Name", () => {
  const raw = {
    Name: "Root",
    ControlType: "Pane",
    children: [
      { Name: "Zeta", ControlType: "Button", AutomationId: "btn-z", children: [] },
      { Name: "Alpha", ControlType: "Button", AutomationId: "btn-a", children: [] },
    ],
  };
  const out = normalize(raw, allowlist);
  expect(out.children?.[0]?.AutomationId).toBe("btn-a");
  expect(out.children?.[1]?.AutomationId).toBe("btn-z");
});
```

Run, verify PASS (sorting was already in the impl).

- [ ] **Step 2:** Add test for wrapper-visual stripping.

```typescript
it("strips wrapper visuals listed in alwaysStripWrappers", () => {
  const customAllowlist = { ...allowlist, alwaysStripWrappers: ["WebView2Wrapper"] };
  const raw = {
    Name: "Host",
    ControlType: "Window",
    children: [
      {
        Name: "wrapper",
        ControlType: "WebView2Wrapper",
        children: [
          { Name: "MenuBar", ControlType: "MenuBar", children: [] },
        ],
      },
    ],
  };
  const out = normalize(raw, customAllowlist);
  expect(out.children).toHaveLength(1);
  expect(out.children?.[0]?.ControlType).toBe("MenuBar");
});
```

Run, verify PASS.

- [ ] **Step 3:** Add test for recursive normalization.

```typescript
it("recursively normalizes descendants", () => {
  const raw = {
    Name: "Root",
    ControlType: "Pane",
    BoundingRectangle: "0,0,100,100",
    children: [
      {
        Name: "Child",
        ControlType: "Button",
        BoundingRectangle: "5,5,50,50",
        children: [],
      },
    ],
  };
  const out = normalize(raw, allowlist);
  expect(out.BoundingRectangle).toBeUndefined();
  expect(out.children?.[0]?.BoundingRectangle).toBeUndefined();
});
```

Run, verify PASS.

#### T1.5 — Commit

- [ ] **Step 1:** Commit T1 work.

```powershell
git add web/apps/editor/tests/helpers/a11y-allowlist.json `
        web/apps/editor/tests/helpers/a11y-normalizer.ts `
        web/apps/editor/src/lib/a11y-normalizer.ts `
        web/apps/editor/src/lib/__tests__/a11y-normalizer.test.ts
git commit -m @'
test(LT-4): [MT-11 a11y] T1 — UIA normalizer + allowlist + vitest

Drop volatile UIA fields, sort children deterministically, strip
configured wrapper visuals. 4 vitest tests; vitest count moves 343 → 347.
'@
```

---

### Task T2: Custom `toMatchJSONGolden` matcher

**Why:** spec §5 C11. Playwright `expect.extend()` matcher with
`UPDATE_A11Y_GOLDENS=1` regeneration path and pre-normalization JSON
dump on failure.

**Files:**
- Create: `web/apps/editor/tests/helpers/toMatchJSONGolden.ts`
- Create: `web/apps/editor/tests/native/fixtures/.gitignore` (ignores
  `a11y-failures/`)

#### T2.1 — Matcher implementation

- [ ] **Step 1:** Write matcher.

`web/apps/editor/tests/helpers/toMatchJSONGolden.ts`:
```typescript
import { expect, type MatcherReturnType } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const UPDATE = process.env.UPDATE_A11Y_GOLDENS === "1";
const FAILURE_DIR = path.join(
  __dirname,
  "..",
  "a11y-failures"
);

expect.extend({
  toMatchJSONGolden(
    received: unknown,
    goldenPath: string,
    options?: { rawForDebug?: unknown }
  ): MatcherReturnType {
    const absPath = path.resolve(__dirname, "..", goldenPath);
    const serialized = JSON.stringify(received, null, 2) + "\n";

    if (UPDATE) {
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, serialized, "utf8");
      return {
        pass: true,
        message: () => `wrote golden: ${goldenPath}`,
      };
    }

    if (!fs.existsSync(absPath)) {
      return {
        pass: false,
        message: () =>
          `A11y golden missing: ${goldenPath}\n` +
          `  Hint: run \`pnpm a11y:update\` to create it.`,
      };
    }

    const expected = fs.readFileSync(absPath, "utf8");
    const pass = expected === serialized;
    if (!pass && options?.rawForDebug !== undefined) {
      fs.mkdirSync(FAILURE_DIR, { recursive: true });
      const base = path.basename(goldenPath, ".json");
      fs.writeFileSync(
        path.join(FAILURE_DIR, `${base}.raw.json`),
        JSON.stringify(options.rawForDebug, null, 2) + "\n",
        "utf8"
      );
    }

    return {
      pass,
      message: () => {
        if (pass) return `Matched: ${goldenPath}`;
        return (
          `A11y golden mismatch: ${goldenPath}\n` +
          `  Expected (committed) vs Received (current run) differ.\n` +
          `  Hint: if intended, run \`pnpm a11y:update --grep "<surface>"\`\n` +
          (options?.rawForDebug
            ? `  Raw pre-normalization JSON written to a11y-failures/${path.basename(
                goldenPath,
                ".json"
              )}.raw.json\n`
            : "")
        );
      },
    };
  },
});

declare module "@playwright/test" {
  interface Matchers<R> {
    toMatchJSONGolden(goldenPath: string, options?: { rawForDebug?: unknown }): R;
  }
}
```

#### T2.2 — Failure dir .gitignore

- [ ] **Step 1:** Create gitignore.

Add to `web/apps/editor/tests/.gitignore` (create if missing):
```
a11y-failures/
```

#### T2.3 — Commit

- [ ] **Step 1:** Commit T2 work.

```powershell
git add web/apps/editor/tests/helpers/toMatchJSONGolden.ts `
        web/apps/editor/tests/native/.gitignore
git commit -m @'
test(LT-4): [MT-11 a11y] T2 — toMatchJSONGolden custom matcher

Diff-or-write semantics gated on UPDATE_A11Y_GOLDENS=1; raw
pre-normalization JSON dumped to tests/a11y-failures/ on
mismatch (gitignored).
'@
```

---

### Task T3: UIA inspector (branches on T0 outcome)

**Why:** spec §5 C1 + C1a. The wrapper in T4 hides this choice from
specs; this task delivers whichever underlying impl Phase 0 selected.

#### T3.A — IF Phase 0 found a Node lib

**Files:**
- Modify: `web/apps/editor/package.json` (add dep)
- Create: minimal smoke test invoking the lib against current editor

- [ ] **Step 1:** Install lib.
  ```powershell
  cd web/apps/editor
  pnpm add -D <lib-name>
  ```
- [ ] **Step 2:** Write smoke that captures menubar UIA of a freshly
  launched editor; assert non-empty result.
- [ ] **Step 3:** Commit.

#### T3.B — IF Phase 0 chose C++ inspector (expected case per R1)

**Files:**
- Create: `src/host/spike/uia_inspector.cpp`
- Create: `src/host/spike/UiaInspector.vcxproj`
- Modify: `ParticleEditor.sln` (add the new project)

##### T3.B.1 — Create the inspector source

- [ ] **Step 1:** Create `src/host/spike/uia_inspector.cpp`.

```cpp
// UIA inspector — emits the Win32 UI Automation subtree rooted at a
// given HWND as JSON to stdout. Used by Playwright a11y specs.
//
// CLI: uia_inspector.exe --hwnd 0xNNNN --capture <id> [--depth N]
//   --hwnd     target window handle (hex)
//   --capture  surface identifier (informational; embedded in output)
//   --depth    max tree depth (default 8)
//
// Exit codes: 0 success; 1 bad args; 2 UIA init failed; 3 HWND invalid.

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <UIAutomation.h>
#include <atlbase.h>
#include <comdef.h>
#include <cstdio>
#include <cstring>
#include <string>
#include <sstream>

static std::string EscapeJson(const std::wstring& s) {
    std::string out;
    out.reserve(s.size() + 2);
    for (wchar_t wc : s) {
        if (wc < 0x80) {
            char c = static_cast<char>(wc);
            switch (c) {
                case '"':  out += "\\\""; break;
                case '\\': out += "\\\\"; break;
                case '\n': out += "\\n"; break;
                case '\r': out += "\\r"; break;
                case '\t': out += "\\t"; break;
                default:
                    if (static_cast<unsigned char>(c) < 0x20) {
                        char buf[8]; sprintf_s(buf, "\\u%04x", c);
                        out += buf;
                    } else {
                        out += c;
                    }
            }
        } else {
            // UTF-8 encode the codepoint
            char buf[8];
            int n = WideCharToMultiByte(CP_UTF8, 0, &wc, 1, buf, sizeof(buf), nullptr, nullptr);
            if (n > 0) out.append(buf, n);
        }
    }
    return out;
}

static std::string BstrToUtf8(BSTR b) {
    if (!b) return {};
    return EscapeJson(std::wstring(b, SysStringLen(b)));
}

static const wchar_t* ControlTypeName(CONTROLTYPEID id) {
    switch (id) {
        case UIA_ButtonControlTypeId: return L"Button";
        case UIA_CheckBoxControlTypeId: return L"CheckBox";
        case UIA_ComboBoxControlTypeId: return L"ComboBox";
        case UIA_EditControlTypeId: return L"Edit";
        case UIA_HyperlinkControlTypeId: return L"Hyperlink";
        case UIA_ImageControlTypeId: return L"Image";
        case UIA_ListItemControlTypeId: return L"ListItem";
        case UIA_ListControlTypeId: return L"List";
        case UIA_MenuControlTypeId: return L"Menu";
        case UIA_MenuBarControlTypeId: return L"MenuBar";
        case UIA_MenuItemControlTypeId: return L"MenuItem";
        case UIA_ProgressBarControlTypeId: return L"ProgressBar";
        case UIA_RadioButtonControlTypeId: return L"RadioButton";
        case UIA_ScrollBarControlTypeId: return L"ScrollBar";
        case UIA_SliderControlTypeId: return L"Slider";
        case UIA_SpinnerControlTypeId: return L"Spinner";
        case UIA_StatusBarControlTypeId: return L"StatusBar";
        case UIA_TabControlTypeId: return L"Tab";
        case UIA_TabItemControlTypeId: return L"TabItem";
        case UIA_TextControlTypeId: return L"Text";
        case UIA_ToolBarControlTypeId: return L"ToolBar";
        case UIA_ToolTipControlTypeId: return L"ToolTip";
        case UIA_TreeControlTypeId: return L"Tree";
        case UIA_TreeItemControlTypeId: return L"TreeItem";
        case UIA_CustomControlTypeId: return L"Custom";
        case UIA_GroupControlTypeId: return L"Group";
        case UIA_ThumbControlTypeId: return L"Thumb";
        case UIA_DataGridControlTypeId: return L"DataGrid";
        case UIA_DataItemControlTypeId: return L"DataItem";
        case UIA_DocumentControlTypeId: return L"Document";
        case UIA_SplitButtonControlTypeId: return L"SplitButton";
        case UIA_WindowControlTypeId: return L"Window";
        case UIA_PaneControlTypeId: return L"Pane";
        case UIA_HeaderControlTypeId: return L"Header";
        case UIA_HeaderItemControlTypeId: return L"HeaderItem";
        case UIA_TableControlTypeId: return L"Table";
        case UIA_TitleBarControlTypeId: return L"TitleBar";
        case UIA_SeparatorControlTypeId: return L"Separator";
        default: return L"Unknown";
    }
}

static void EmitNode(IUIAutomationElement* elem, int depth, int maxDepth, std::ostringstream& out, const char* indent) {
    if (!elem) { out << "null"; return; }

    out << "{\n";
    CComBSTR name;
    elem->get_CurrentName(&name);
    out << indent << "  \"Name\": \"" << BstrToUtf8(name) << "\",\n";

    CONTROLTYPEID ctid = 0;
    elem->get_CurrentControlType(&ctid);
    out << indent << "  \"ControlType\": \"";
    BstrToUtf8(CComBSTR(ControlTypeName(ctid)));
    out << EscapeJson(ControlTypeName(ctid)) << "\",\n";

    CComBSTR autoId;
    elem->get_CurrentAutomationId(&autoId);
    out << indent << "  \"AutomationId\": \"" << BstrToUtf8(autoId) << "\",\n";

    BOOL focusable = FALSE;
    elem->get_CurrentIsKeyboardFocusable(&focusable);
    out << indent << "  \"IsKeyboardFocusable\": " << (focusable ? "true" : "false") << ",\n";

    BOOL enabled = FALSE;
    elem->get_CurrentIsEnabled(&enabled);
    out << indent << "  \"IsEnabled\": " << (enabled ? "true" : "false") << ",\n";

    BOOL offscreen = FALSE;
    elem->get_CurrentIsOffscreen(&offscreen);
    out << indent << "  \"IsOffscreen\": " << (offscreen ? "true" : "false") << ",\n";

    out << indent << "  \"children\": [";

    if (depth >= maxDepth) {
        out << "]\n" << indent << "}";
        return;
    }

    CComPtr<IUIAutomation> uia;
    elem->QueryInterface(IID_PPV_ARGS(&uia));  // not exactly right; we'll use the global
    // For simplicity, use TreeWalker via the element's children property.
    CComPtr<IUIAutomationTreeWalker> walker;
    CComPtr<IUIAutomation> g_uia;
    CoCreateInstance(__uuidof(CUIAutomation), nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&g_uia));
    g_uia->get_ControlViewWalker(&walker);

    CComPtr<IUIAutomationElement> child;
    walker->GetFirstChildElement(elem, &child);
    bool first = true;
    while (child) {
        if (!first) out << ",";
        first = false;
        out << "\n" << indent << "    ";
        std::string deeper(indent);
        deeper += "    ";
        EmitNode(child, depth + 1, maxDepth, out, deeper.c_str());
        CComPtr<IUIAutomationElement> next;
        walker->GetNextSiblingElement(child, &next);
        child = next;
    }
    if (!first) out << "\n" << indent << "  ";
    out << "]\n" << indent << "}";
}

int wmain(int argc, wchar_t* argv[]) {
    HWND hwnd = nullptr;
    std::wstring capture;
    int maxDepth = 8;

    for (int i = 1; i < argc; ++i) {
        if (wcscmp(argv[i], L"--hwnd") == 0 && i + 1 < argc) {
            hwnd = reinterpret_cast<HWND>(static_cast<intptr_t>(wcstoull(argv[++i], nullptr, 16)));
        } else if (wcscmp(argv[i], L"--capture") == 0 && i + 1 < argc) {
            capture = argv[++i];
        } else if (wcscmp(argv[i], L"--depth") == 0 && i + 1 < argc) {
            maxDepth = static_cast<int>(wcstol(argv[++i], nullptr, 10));
        } else if (wcscmp(argv[i], L"--help") == 0) {
            wprintf(L"uia_inspector --hwnd 0xNNNN --capture <id> [--depth N]\n");
            return 0;
        }
    }

    if (!hwnd) { fprintf(stderr, "missing --hwnd\n"); return 1; }
    if (!IsWindow(hwnd)) { fprintf(stderr, "invalid HWND\n"); return 3; }

    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(hr)) { fprintf(stderr, "CoInitializeEx failed\n"); return 2; }

    CComPtr<IUIAutomation> uia;
    hr = CoCreateInstance(__uuidof(CUIAutomation), nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&uia));
    if (FAILED(hr)) { fprintf(stderr, "CUIAutomation create failed\n"); return 2; }

    CComPtr<IUIAutomationElement> root;
    hr = uia->ElementFromHandle(hwnd, &root);
    if (FAILED(hr) || !root) { fprintf(stderr, "ElementFromHandle failed\n"); return 3; }

    fprintf(stderr, "[A11Y-CAPTURE] surface=%ls hwnd=0x%llx\n",
            capture.c_str(), reinterpret_cast<uint64_t>(hwnd));

    std::ostringstream out;
    EmitNode(root, 0, maxDepth, out, "");

    fputs(out.str().c_str(), stdout);
    fputc('\n', stdout);

    CoUninitialize();
    return 0;
}
```

##### T3.B.2 — Create .vcxproj

- [ ] **Step 1:** Copy `src/host/spike/dxgi_spike.vcxproj` (if exists)
  or `src/viewport_poc.vcxproj` as the starting template.

- [ ] **Step 2:** Modify to:
  - Project name: `UiaInspector`
  - Single source file: `uia_inspector.cpp`
  - Link against: `UIAutomationCore.lib`, `ole32.lib`, `oleaut32.lib`
  - Configuration types: Debug + Release; Platform: x64
  - Output: `$(SolutionDir)x64\$(Configuration)\uia_inspector.exe`
  - Use `$(SolutionDir)` correctly per L-023

##### T3.B.3 — Add to .sln

- [ ] **Step 1:** Add the new project entry to `ParticleEditor.sln`
  matching the existing project format.

##### T3.B.4 — Build + smoke

- [ ] **Step 1:** Build.

```powershell
MSBuild .\ParticleEditor.sln /p:Configuration=Debug /p:Platform=x64 /m
MSBuild .\ParticleEditor.sln /p:Configuration=Release /p:Platform=x64 /m
```

Expected: both configs clean. New artifact: `x64/Debug/uia_inspector.exe`.

- [ ] **Step 2:** Smoke against a known window (e.g. notepad).

```powershell
$proc = Start-Process notepad -PassThru
Start-Sleep -Seconds 1
$hwnd = $proc.MainWindowHandle
$hex = "0x{0:X}" -f $hwnd.ToInt64()
./x64/Debug/uia_inspector.exe --hwnd $hex --capture smoke --depth 3 | Out-File -Encoding utf8 smoke-out.json
Get-Content smoke-out.json
Stop-Process $proc
Remove-Item smoke-out.json
```

Expected: valid JSON, includes notepad's edit area with `ControlType: "Edit"`.

- [ ] **Step 3:** Smoke against `--hwnd 0xDEAD --capture x` (invalid).

Expected: exit code 3, stderr "invalid HWND".

##### T3.B.5 — Commit

```powershell
git add src/host/spike/uia_inspector.cpp `
        src/host/spike/UiaInspector.vcxproj `
        ParticleEditor.sln
git commit -m @'
feat(LT-4): [MT-11 a11y] T3 — UIA inspector C++ tool

Standalone exe emitting UIA subtree JSON for a given HWND. Used by
Playwright a11y specs via child_process.spawn. ~200 LoC.
'@
```

---

### Task T4: UIA wrapper (helpers/uia.ts)

**Why:** spec §5 C1. Single seam hiding whether the impl is Node lib
or C++ exe. Specs only see `captureUIA(hwnd, surfaceId)`.

**Files:**
- Create: `web/apps/editor/tests/helpers/uia.ts`

#### T4.1 — Wrapper for C++ exe path (default expected case)

- [ ] **Step 1:** Implement wrapper.

`web/apps/editor/tests/helpers/uia.ts`:
```typescript
import { spawn } from "node:child_process";
import * as path from "node:path";
import type { UIANode } from "./a11y-normalizer";

const INSPECTOR_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "x64",
  process.env.A11Y_BUILD_CONFIG ?? "Debug",
  "uia_inspector.exe"
);

export async function captureUIA(
  hwnd: bigint | number,
  surfaceId: string,
  options?: { depth?: number; timeoutMs?: number }
): Promise<UIANode> {
  const hex = "0x" + BigInt(hwnd).toString(16);
  const args = [
    "--hwnd", hex,
    "--capture", surfaceId,
    "--depth", String(options?.depth ?? 8),
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(INSPECTOR_PATH, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`uia_inspector timeout (${options?.timeoutMs ?? 5000}ms) for surface=${surfaceId}`));
    }, options?.timeoutMs ?? 5000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`uia_inspector exited ${code} for surface=${surfaceId}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as UIANode);
      } catch (e) {
        reject(new Error(`uia_inspector produced invalid JSON for surface=${surfaceId}: ${(e as Error).message}\nstdout: ${stdout.slice(0, 500)}`));
      }
    });
  });
}
```

(If T3.A Node-lib path was taken instead, the implementation is a thin
wrapper over the lib's tree-walk API; same exported signature.)

- [ ] **Step 2:** Add `discoverHostHwnd()` helper to the same file.

```typescript
export async function discoverHostHwnd(
  options?: { processName?: string; timeoutMs?: number }
): Promise<bigint> {
  const procName = options?.processName ?? "ParticleEditor";
  const cmd =
    `(Get-Process ${procName} -ErrorAction SilentlyContinue | ` +
    `Where-Object MainWindowHandle -ne 0 | ` +
    `Select-Object -First 1).MainWindowHandle`;
  return new Promise((resolve, reject) => {
    const ps = spawn("powershell.exe", ["-NoProfile", "-Command", cmd], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const t = setTimeout(() => {
      ps.kill();
      reject(new Error(`discoverHostHwnd timeout for process ${procName}`));
    }, options?.timeoutMs ?? 5000);
    ps.stdout.on("data", (c) => { out += c.toString("utf8"); });
    ps.stderr.on("data", (c) => { err += c.toString("utf8"); });
    ps.on("close", () => {
      clearTimeout(t);
      const v = out.trim();
      if (!v) {
        reject(new Error(
          `Could not find ${procName} HWND. ` +
          `Is the editor running? stderr: ${err}`
        ));
      } else {
        resolve(BigInt(v));
      }
    });
  });
}
```

#### T4.2 — Commit

- [ ] **Step 1:**

```powershell
git add web/apps/editor/tests/helpers/uia.ts
git commit -m @'
test(LT-4): [MT-11 a11y] T4 — captureUIA() seam over inspector

Single wrapper that specs call; spawns uia_inspector.exe with HWND +
surface ID; parses JSON; surfaces timeouts and error messages cleanly.
'@
```

---

### Task T5: Surface drivers — chrome (5 surfaces)

**Why:** spec §5 C4. Chrome surfaces: MenuBar (closed), MenuBar (each
of 6 menus opened), Toolbar, EmitterTree, EmitterPropertyTabs (each
tab), ViewportPill. Realistic ~12 captures.

**Time budget per R3:** under 1.5h. If any surface needs >30 min
setup, drop and file as follow-up.

**Files:**
- Create: `web/apps/editor/tests/helpers/a11y-surfaces.ts`

#### T5.1 — Helper skeleton + chrome drivers

- [ ] **Step 1:** Create file with type + skeleton.

```typescript
import type { Page } from "@playwright/test";

export type SurfaceCapture = {
  id: string;          // matches golden filename: a11y-goldens/<id>.golden.json
  setup: (page: Page) => Promise<void>;
  teardown: (page: Page) => Promise<void>;
};

async function dismissModals(page: Page) {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
}

export const CHROME_SURFACES: SurfaceCapture[] = [
  {
    id: "menubar-closed",
    setup: async (page) => {
      await page.locator('[data-testid="app-shell"]').focus();
    },
    teardown: async (page) => { await dismissModals(page); },
  },
  {
    id: "menubar-file-open",
    setup: async (page) => {
      await page.locator('button:has-text("File")').click();
      await page.waitForSelector('[role="menu"]');
    },
    teardown: async (page) => { await dismissModals(page); },
  },
  {
    id: "menubar-edit-open",
    setup: async (page) => {
      await page.locator('button:has-text("Edit")').click();
      await page.waitForSelector('[role="menu"]');
    },
    teardown: async (page) => { await dismissModals(page); },
  },
  {
    id: "menubar-emitters-open",
    setup: async (page) => {
      await page.locator('button:has-text("Emitters")').click();
      await page.waitForSelector('[role="menu"]');
    },
    teardown: async (page) => { await dismissModals(page); },
  },
  {
    id: "menubar-mods-open",
    setup: async (page) => {
      await page.locator('button:has-text("Mods")').click();
      await page.waitForSelector('[role="menu"]');
    },
    teardown: async (page) => { await dismissModals(page); },
  },
  {
    id: "menubar-view-open",
    setup: async (page) => {
      await page.locator('button:has-text("View")').click();
      await page.waitForSelector('[role="menu"]');
    },
    teardown: async (page) => { await dismissModals(page); },
  },
  {
    id: "menubar-help-open",
    setup: async (page) => {
      await page.locator('button:has-text("Help")').click();
      await page.waitForSelector('[role="menu"]');
    },
    teardown: async (page) => { await dismissModals(page); },
  },
  {
    id: "toolbar",
    setup: async (page) => {
      await page.locator('[data-testid="toolbar"]').focus();
    },
    teardown: async (_page) => { /* no-op */ },
  },
  {
    id: "emitter-tree",
    setup: async (page) => {
      // Assumes fixture has at least one root emitter loaded.
      await page.locator('[data-testid="emitter-tree"]').focus();
    },
    teardown: async (_page) => { /* no-op */ },
  },
  {
    id: "property-tabs-basic",
    setup: async (page) => {
      await page.locator('[role="tab"]:has-text("Basic")').click();
    },
    teardown: async (_page) => { /* no-op */ },
  },
  {
    id: "property-tabs-appearance",
    setup: async (page) => {
      await page.locator('[role="tab"]:has-text("Appearance")').click();
    },
    teardown: async (_page) => { /* no-op */ },
  },
  {
    id: "property-tabs-physics",
    setup: async (page) => {
      await page.locator('[role="tab"]:has-text("Physics")').click();
    },
    teardown: async (_page) => { /* no-op */ },
  },
  {
    id: "viewport-pill",
    setup: async (page) => {
      await page.locator('[data-testid="viewport-pill"]').focus();
    },
    teardown: async (_page) => { /* no-op */ },
  },
];
```

- [ ] **Step 2:** Audit `data-testid` selectors against current React
  code. Any missing — add to the relevant component file in the same
  commit. Pattern (example for app-shell):

  ```tsx
  <div data-testid="app-shell" ...>
  ```

  Don't change other behavior; this is purely a test-affordance addition.

#### T5.2 — Verification

- [ ] **Step 1:** Hand-test each driver against a live editor.
  Manually run each setup, eyeball the editor state, confirm the
  expected UI is in the captured state.

#### T5.3 — Commit

- [ ] **Step 1:**

```powershell
git add web/apps/editor/tests/helpers/a11y-surfaces.ts
# Also add any source files that gained data-testid attributes
git add web/apps/editor/src/...
git commit -m @'
test(LT-4): [MT-11 a11y] T5 — surface drivers for chrome (12 captures)

MenuBar (closed + each menu open), Toolbar, EmitterTree, PropertyTabs
(each tab), ViewportPill. Added data-testid affordances to N components
to support deterministic selection.
'@
```

---

### Task T6: Surface drivers — dialogs

**Why:** spec §5 C4. 13 dialog components, each captured once
freshly-opened. Per R3, drop any requiring >30 min of fixture setup.

**Files:**
- Modify: `web/apps/editor/tests/helpers/a11y-surfaces.ts`

#### T6.1 — Driver pattern + add 13 dialog surfaces

- [ ] **Step 1:** Extend `a11y-surfaces.ts` with `DIALOG_SURFACES`.
  Pattern per dialog (uses Modal + Radix Dialog roles):

```typescript
export const DIALOG_SURFACES: SurfaceCapture[] = [
  {
    id: "dialog-save-changes",
    setup: async (page) => {
      // Trigger via File > New on a dirty document
      await page.evaluate(() => (window as any).bridge.request("editor/markDirty"));
      await page.locator('button:has-text("File")').click();
      await page.locator('[role="menuitem"]:has-text("New")').click();
      await page.waitForSelector('[role="dialog"]');
    },
    teardown: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
  {
    id: "dialog-mod-nickname",
    setup: async (page) => {
      await page.locator('button:has-text("Mods")').click();
      await page.locator('[role="menuitem"]:has-text("Set Nickname")').click();
      await page.waitForSelector('[role="dialog"]');
    },
    teardown: async (page) => { await page.keyboard.press("Escape"); },
  },
  // ... repeat for each of:
  //   dialog-increment-index
  //   dialog-rescale
  //   dialog-rescale-emitter
  //   dialog-import-emitters    ← R3 candidate to drop if setup > 30 min
  //   dialog-lighting
  //   dialog-bloom
  //   dialog-background-picker
  //   dialog-ground-texture
  //   dialog-primitives-gallery
  //   dialog-spawner
  //   dialog-modal-generic
];
```

- [ ] **Step 2:** For each dialog, identify and implement the open
  trigger. Document in code comments any dialog whose trigger requires
  prior bridge state.

- [ ] **Step 3:** **R3 4h cap check.** If any dialog has consumed
  >30 min of setup work, STOP, remove it from the list, and add to
  `tasks/a11y-deferred-surfaces.md`:

```markdown
# A11y surfaces deferred from this dispatch (R3)

- **dialog-import-emitters** — requires multi-emitter sample loaded
  with non-root selection. Skipped because setup exceeded 30 min cap.
  Filed as follow-up.
```

#### T6.2 — Commit

- [ ] **Step 1:**

```powershell
git add web/apps/editor/tests/helpers/a11y-surfaces.ts
# Add deferred-surfaces doc if any were skipped
git add tasks/a11y-deferred-surfaces.md
git commit -m @'
test(LT-4): [MT-11 a11y] T6 — surface drivers for dialogs

13 dialog surfaces (or N if any deferred per R3 30-min-setup cap).
Each captured once freshly opened. Deferred surfaces (if any) logged
in tasks/a11y-deferred-surfaces.md.
'@
```

---

### Task T7: Surface drivers — keyboard / interaction paths

**Why:** spec §2 in-scope item 3. Captures the UIA tree after a
sequence of key events: Tab cycle stopping points, F2 rename mode,
Escape post-dialog, arrow-key tree nav.

**Files:**
- Modify: `web/apps/editor/tests/helpers/a11y-surfaces.ts`

#### T7.1 — Keyboard scenario drivers

- [ ] **Step 1:** Add `KEYBOARD_SURFACES`:

```typescript
export const KEYBOARD_SURFACES: SurfaceCapture[] = [
  {
    id: "kbd-tab-cycle-stop-1",
    setup: async (page) => {
      await page.locator('[data-testid="app-shell"]').focus();
      await page.keyboard.press("Tab");
    },
    teardown: async (_page) => { /* no-op */ },
  },
  {
    id: "kbd-tab-cycle-stop-2",
    setup: async (page) => {
      await page.locator('[data-testid="app-shell"]').focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
    },
    teardown: async (_page) => { /* no-op */ },
  },
  {
    id: "kbd-emitter-rename-mode",
    setup: async (page) => {
      await page.locator('[data-testid="emitter-tree"] [role="treeitem"]').first().click();
      await page.keyboard.press("F2");
    },
    teardown: async (page) => { await page.keyboard.press("Escape"); },
  },
  {
    id: "kbd-arrow-tree-expanded",
    setup: async (page) => {
      await page.locator('[data-testid="emitter-tree"] [role="treeitem"]').first().focus();
      await page.keyboard.press("ArrowRight");
    },
    teardown: async (_page) => { /* no-op */ },
  },
];
```

#### T7.2 — Commit

```powershell
git add web/apps/editor/tests/helpers/a11y-surfaces.ts
git commit -m @'
test(LT-4): [MT-11 a11y] T7 — surface drivers for keyboard paths

Tab-cycle stops, F2 rename mode, arrow-key tree expand. Captures UIA
state after each key sequence.
'@
```

---

### Task T8: Surface drivers — CurveEditor + Spinner

**Why:** spec §2 in-scope item 4. Custom canvas/keyboard interaction
outside the Radix primitives.

**Files:**
- Modify: `web/apps/editor/tests/helpers/a11y-surfaces.ts`

#### T8.1 — Custom-primitive drivers

- [ ] **Step 1:** Add `CUSTOM_PRIMITIVE_SURFACES`:

```typescript
export const CUSTOM_PRIMITIVE_SURFACES: SurfaceCapture[] = [
  {
    id: "curve-editor-focused",
    setup: async (page) => {
      await page.locator('[role="tab"]:has-text("Basic")').click();
      await page.locator('[data-testid="curve-editor-canvas"]').click();
    },
    teardown: async (_page) => { /* no-op */ },
  },
  {
    id: "spinner-focused",
    setup: async (page) => {
      await page.locator('[data-testid="spinner-emit-rate"] input').focus();
    },
    teardown: async (_page) => { /* no-op */ },
  },
];
```

- [ ] **Step 2:** If `data-testid` attrs are missing, add them to the
  React components in the same commit.

#### T8.2 — Commit

```powershell
git add web/apps/editor/tests/helpers/a11y-surfaces.ts
git add web/apps/editor/src/screens/CurveEditor.tsx
git add web/apps/editor/src/primitives/Spinner.tsx
git commit -m @'
test(LT-4): [MT-11 a11y] T8 — surface drivers for CurveEditor + Spinner

Captures UIA state for the custom-canvas curve editor and a focused
spinner primitive.
'@
```

---

### Task T9: Spec files (4 categories) + initial HWND goldens

**Why:** spec §5 C5 + C7. Each spec parametrizes over its surface
list, generates goldens via `pnpm a11y:update` on first run.

**Files:**
- Create: `web/apps/editor/tests/a11y-chrome.spec.ts`
- Create: `web/apps/editor/tests/a11y-dialogs.spec.ts`
- Create: `web/apps/editor/tests/a11y-keyboard.spec.ts`
- Create: `web/apps/editor/tests/a11y-curve-spinner.spec.ts`
- Create (via update flag): `web/apps/editor/tests/a11y-goldens/*.golden.json` (~30 files)
- Create: `web/apps/editor/tests/fixtures/a11y-base-state.alo` (committed binary fixture)

#### T9.0 — Harness pattern verification (L-022 pre-flight)

- [ ] **Step 1:** Read [`dxgi-transport.spec.ts:45-100`](web/apps/editor/tests/dxgi-transport.spec.ts:45)
      to confirm the CDP-connect harness pattern matches what the T9.1
      template assumes. Specifically verify:
  - `chromium.connectOverCDP(CDP_ENDPOINT)` with `CDP_ENDPOINT` from
    `process.env.CDP_ENDPOINT` defaulting to `http://localhost:9222`.
  - `browser.contexts()[0].pages()[0]` or `waitForEvent("page")`
    fallback for `page` acquisition.
  - `page.waitForFunction(() => typeof window.bridge !== "undefined")`
    for ready signal.
  - The harness orchestrates binary launch — specs assume it's
    running.

- [ ] **Step 2:** Confirm `bridge.request("file/open", { path })`
      exists and is callable from `page.evaluate(...)`. Grep
      `src/host/BridgeDispatcher.cpp` for `"file/open"` handler;
      confirm it takes a `{path}` payload and tolerates relative paths.
      If path-handling is absolute-only, the T9.1 template's
      `tests/fixtures/a11y-base-state.alo` needs to be expanded to an
      absolute path via `path.resolve()` in the spec.

- [ ] **Step 3:** Confirm `discoverHostHwnd()` (from T4.1 step 2)
      actually returns a non-zero HWND when the editor is running.
      Quick local check:

```powershell
(Get-Process ParticleEditor | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1).MainWindowHandle
```

Expected: a positive integer. If multiple `ParticleEditor` processes
exist (rare; only if a prior crashed instance leaks), tighten the
PowerShell filter with `--Id <pid>` (engineer adds based on test
runner conventions).

- [ ] **Step 4:** If any of the above three checks fails, STOP T9 and
      either: (a) fix the harness assumption in `helpers/uia.ts` or the
      spec template; (b) file a small T4.5 sub-task to add the
      missing bridge surface and run it before resuming T9.

#### T9.1 — Spec template (per file)

- [ ] **Step 1:** Create `a11y-chrome.spec.ts`:

```typescript
import { test, expect, chromium, type Page, type Browser } from "@playwright/test";
import { captureUIA, discoverHostHwnd } from "./helpers/uia";
import { normalize } from "./helpers/a11y-normalizer";
import { CHROME_SURFACES } from "./helpers/a11y-surfaces";
import allowlist from "./helpers/a11y-allowlist.json";
import "./helpers/toMatchJSONGolden";

const CDP_ENDPOINT = process.env.CDP_ENDPOINT ?? "http://localhost:9222";
const MODE = process.env.ALO_WEBVIEW2_HOSTING === "composition"
  ? "composition"
  : "default";

let browser: Browser;
let page: Page;
let hostHwnd: bigint;

test.beforeAll(async () => {
  browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  const context = browser.contexts()[0];
  if (!context) throw new Error("CDP: no browser contexts attached");
  page = context.pages()[0] ?? (await context.waitForEvent("page"));
  await page.waitForFunction(
    () => typeof (window as { bridge?: unknown }).bridge !== "undefined",
    null,
    { timeout: 15_000 }
  );
  hostHwnd = await discoverHostHwnd();  // PowerShell-based discovery; see helpers/uia.ts
});

test.afterAll(async () => {
  await browser?.close();
});

test.beforeEach(async () => {
  // Reset to known-clean state — close any open menus / dialogs left
  // by the previous test. Cheaper than relaunching the binary.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  // Load deterministic base state from fixture. Mirror the existing
  // `file/open` bridge call pattern used in other native specs.
  await page.evaluate(async () => {
    const bridge = (window as { bridge: { request: (k: string, p: unknown) => Promise<unknown> } }).bridge;
    await bridge.request("file/open", { path: "tests/fixtures/a11y-base-state.alo" });
  });
});

test.describe("a11y/chrome", () => {
  for (const surface of CHROME_SURFACES) {
    test(`${surface.id} [${MODE}]`, async () => {
      try {
        await surface.setup(page);
        const raw = await captureUIA(hostHwnd, surface.id);
        const normalized = normalize(raw, allowlist);
        const goldenPath =
          MODE === "default"
            ? `a11y-goldens/${surface.id}.golden.json`
            : `a11y-goldens/${surface.id}.composition.golden.json`;
        expect(normalized).toMatchJSONGolden(goldenPath, { rawForDebug: raw });
      } finally {
        await surface.teardown(page);
      }
    });
  }
});
```

**Important harness notes for the implementer:**
- The CDP-connect pattern requires the editor binary to be already
  running (launched by the test harness, not by Playwright). This
  matches every existing native spec — see [`dxgi-transport.spec.ts:45-77`](web/apps/editor/tests/dxgi-transport.spec.ts:45)
  for the canonical example to copy.
- `bridge.request("file/open", ...)` is the assumed fixture-loading
  call. If the path-handling differs (relative-to-CWD vs absolute),
  inspect what `file/open` actually expects in
  [`BridgeDispatcher.cpp`](src/host/BridgeDispatcher.cpp:1) and
  adjust the path resolution to match.
- The `page.keyboard.press("Escape")` double-tap is a coarse reset;
  if it leaves the editor in a weird state (e.g. mid-rename, mid-IME)
  add a `bridge.request("editor/clearTransientState")` call (or
  similar) — likely needs adding to the bridge in a small T4.5
  sub-task discovered during T9 verification.

- [ ] **Step 2:** Repeat for `a11y-dialogs.spec.ts`, importing
  `DIALOG_SURFACES`. Same shape, different import.

- [ ] **Step 3:** Repeat for `a11y-keyboard.spec.ts` and
  `a11y-curve-spinner.spec.ts`.

#### T9.2 — Fixture file

- [ ] **Step 1:** Generate or copy a representative `.alo` fixture
  with a small tree (~3 emitters: 1 root, 1 lifetime child, 1 death
  child) to `web/apps/editor/tests/fixtures/a11y-base-state.alo`.

Use the existing `--gen-nt5-fixture` pattern as a model. May add a
new `--gen-a11y-fixture` CLI flag to `main.cpp` if needed.

#### T9.3 — Generate HWND goldens

- [ ] **Step 1:** Run with update flag.

```powershell
cd web
$env:UPDATE_A11Y_GOLDENS = "1"
pnpm --filter @particle-editor/editor test:native -- --grep "a11y/"
Remove-Item Env:UPDATE_A11Y_GOLDENS
cd ..
```

Expected: ~30 golden files written under
`web/apps/editor/tests/a11y-goldens/`.

- [ ] **Step 2:** Eyeball goldens. Each should have nested
  `children` arrays with the expected MenuItem / TabItem / TreeItem
  ControlTypes.

#### T9.4 — Re-run for green

- [ ] **Step 1:** Re-run without the update flag.

```powershell
pnpm --filter @particle-editor/editor test:native -- --grep "a11y/"
```

Expected: all green.

- [ ] **Step 2:** Run a SECOND time to verify determinism.

Expected: still all green. If any flake — investigate sorting /
timing in the normalizer or surface drivers BEFORE committing.

#### T9.5 — Commit

```powershell
git add web/apps/editor/tests/a11y-*.spec.ts `
        web/apps/editor/tests/fixtures/a11y-base-state.alo `
        web/apps/editor/tests/a11y-goldens/
# If main.cpp gained --gen-a11y-fixture:
git add src/main.cpp
git commit -m @'
test(LT-4): [MT-11 a11y] T9 — 4 spec files + HWND goldens

a11y-chrome / a11y-dialogs / a11y-keyboard / a11y-curve-spinner specs
parametrize over their surface lists, capture UIA via the inspector,
normalize, diff against committed goldens. N goldens generated for
HWND mode.
'@
```

---

### Task T10: Composition-mode goldens

**Why:** spec §4.1, second lane. Same spec files; different mode
env vars + dist/ build; produces parallel set of goldens.

#### T10.1 — Build composition-mode dist/

```powershell
cd web
$env:VITE_VIEWPORT_TRANSPORT = "canvas-jpeg"
$env:VITE_WEBVIEW2_HOSTING = "composition"
pnpm --filter @particle-editor/editor build
cd ..
```

#### T10.2 — Run with composition env vars + update flag

```powershell
$env:ALO_VIEWPORT_TRANSPORT = "canvas-jpeg"
$env:ALO_WEBVIEW2_HOSTING = "composition"
$env:UPDATE_A11Y_GOLDENS = "1"
cd web
pnpm --filter @particle-editor/editor test:native -- --grep "a11y/"
Remove-Item Env:UPDATE_A11Y_GOLDENS
cd ..
```

Expected: ~30 `*.composition.golden.json` files written.

#### T10.3 — Re-run for green

```powershell
pnpm --filter @particle-editor/editor test:native -- --grep "a11y/"
```

Expected: all green under composition mode.

#### T10.4 — Reset to default mode

```powershell
Remove-Item Env:ALO_VIEWPORT_TRANSPORT
Remove-Item Env:ALO_WEBVIEW2_HOSTING
Remove-Item Env:VITE_VIEWPORT_TRANSPORT
Remove-Item Env:VITE_WEBVIEW2_HOSTING
cd web
pnpm --filter @particle-editor/editor build
cd ..
```

Verify default-mode HWND goldens still pass:

```powershell
pnpm --filter @particle-editor/editor test:native -- --grep "a11y/"
```

#### T10.5 — Commit

```powershell
git add web/apps/editor/tests/a11y-goldens/*.composition.golden.json
git commit -m @'
test(LT-4): [MT-11 a11y] T10 — composition-mode UIA goldens

Same 4 specs re-run under ALO_WEBVIEW2_HOSTING=composition; N parallel
*.composition.golden.json files generated. HWND lane unaffected.
'@
```

---

### Task T11: Cross-mode equality spec

**Why:** spec §4.5 / §5 C6. The FD6-class regression gate, encoded.

**Files:**
- Create: `web/apps/editor/tests/a11y-cross-mode.spec.ts`

#### T11.1 — Implementation

- [ ] **Step 1:** Write spec.

```typescript
import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { normalize } from "./native/helpers/a11y-normalizer";
import allowlist from "./native/a11y-allowlist.json";

const GOLDENS = path.resolve(__dirname, "native", "a11y-goldens");

function listSurfaces(): string[] {
  const all = fs.readdirSync(GOLDENS);
  return all
    .filter((f) => f.endsWith(".golden.json") && !f.endsWith(".composition.golden.json"))
    .map((f) => f.replace(".golden.json", ""));
}

test.describe("a11y/cross-mode equality", () => {
  for (const surface of listSurfaces()) {
    test(`${surface}: HWND === composition`, () => {
      const hwndPath = path.join(GOLDENS, `${surface}.golden.json`);
      const compPath = path.join(GOLDENS, `${surface}.composition.golden.json`);

      if (!fs.existsSync(compPath)) {
        throw new Error(
          `Composition golden missing for surface "${surface}". ` +
          `Run \`pnpm a11y:update\` under composition mode.`
        );
      }

      const hwndRaw = JSON.parse(fs.readFileSync(hwndPath, "utf8"));
      const compRaw = JSON.parse(fs.readFileSync(compPath, "utf8"));

      const hwndN = normalize(hwndRaw, allowlist);
      const compN = normalize(compRaw, allowlist);

      if (JSON.stringify(hwndN) !== JSON.stringify(compN)) {
        throw new Error(
          `A11y cross-mode divergence: ${surface}\n` +
          `  HWND golden:        ${hwndPath}\n` +
          `  Composition golden: ${compPath}\n` +
          `  This is the FD6-class regression gate. Investigate before forcing.`
        );
      }
      expect(JSON.stringify(compN)).toBe(JSON.stringify(hwndN));
    });
  }
});
```

#### T11.2 — Run

```powershell
pnpm --filter @particle-editor/editor test:native -- --grep "a11y/cross-mode"
```

Expected: all surfaces pass. If a surface fails, you've hit R2 in
practice. Open the two goldens, diff them, decide whether to:
1. Add the divergent property to the `volatile` allowlist (cosmetic).
2. Add the divergent wrapper to `alwaysStripWrappers` (structural).
3. Treat as a real bug — fix the chrome to expose identical UIA
   semantics in both modes.

#### T11.3 — Commit

```powershell
git add web/apps/editor/tests/a11y-cross-mode.spec.ts
# If allowlist tuning happened: commit separately per the two-step pattern
git commit -m @'
test(LT-4): [MT-11 a11y] T11 — cross-mode equality spec

Asserts each surface's HWND golden equals its composition golden after
re-normalization. FD6-class regression gate. Pure file IO; doesn't need
either dist/ active.
'@
```

---

### Task T12: Package scripts + lint hygiene

**Why:** spec §5 C10. Make `pnpm a11y` and `pnpm a11y:update` work.

**Files:**
- Modify: `web/apps/editor/package.json`

#### T12.1 — Add scripts

- [ ] **Step 1:** Add to `scripts` block:

```json
{
  "a11y": "playwright test --grep \"a11y/\"",
  "a11y:update": "cross-env UPDATE_A11Y_GOLDENS=1 playwright test --grep \"a11y/\""
}
```

If `cross-env` isn't already a dep, add it (`pnpm add -D cross-env`)
or use the platform-specific env-var prefix that the rest of the
package uses.

#### T12.2 — Verify

```powershell
pnpm --filter @particle-editor/editor a11y
```

Expected: matches the full a11y suite (chrome + dialogs + keyboard +
curve-spinner + cross-mode).

#### T12.3 — Commit

```powershell
git add web/apps/editor/package.json
git commit -m @'
chore(LT-4): [MT-11 a11y] T12 — pnpm a11y / a11y:update scripts

Wrappers around playwright --grep for the a11y suite. Update variant
sets UPDATE_A11Y_GOLDENS=1.
'@
```

---

### Task T13: Stage 3i manual checklist

**Why:** spec §5 C8 + §8 manual section.

**Files:**
- Create: `tasks/stage-3i-a11y-manual.md`

#### T13.1 — Write checklist

- [ ] **Step 1:** Create checklist with all sections from spec §8.

```markdown
# Stage 3i — A11y manual verification checklist

**One-time confidence pass, executed at ship. Re-run on demand if
suspicion arises.**

**Prerequisite Narrator config** (set before starting):
- Verbosity level 1 (default)
- Default voice (Microsoft David / Zira / etc.)
- "Read by character" mode OFF
- Capture a screenshot of Narrator Settings panel for the recording

## Tab cycle (in each mode)

- [ ] Launch editor in HWND mode. Press Tab from app load.
- [ ] Tab through every interactive element: menubar items → toolbar →
      emitter tree → property tab list → first focused input in tabs →
      ... back to menubar. Verify:
  - [ ] Focus indicator visible on every stop
  - [ ] No Tab traps (focus eventually cycles back)
  - [ ] No phantom Tab stops on non-interactive elements
- [ ] Open each modal dialog (Save Changes, Lighting, Bloom, etc.) and
      verify Tab cycles within the dialog only (focus trap is correct).
- [ ] Repeat the above under `ALO_WEBVIEW2_HOSTING=composition`.

## F2 inline rename

- [ ] Select an emitter in the tree.
- [ ] Press F2 → edit mode enters; cursor in field; existing name selected.
- [ ] Type new name; press Enter → commit.
- [ ] Press F2 again; type new name; press Escape → cancel.

## Escape close

- [ ] Open any menu via mouse; press Escape → menu closes; focus
      returns to menubar button.
- [ ] Open Save Changes dialog; press Escape → dialog closes (treated
      as Cancel).
- [ ] Escape on an empty app state → no-op (does not close the app).

## Arrow-key tree nav

- [ ] Focus tree. Up/Down arrows navigate sibling rows.
- [ ] Right expands collapsed node; Left collapses expanded node.
- [ ] Right on a leaf is no-op; Left on a root is no-op.

## IME compose smoke

- [ ] Install a Japanese IME (Windows Settings > Time & Language >
      Language > Add a language > Japanese).
- [ ] Open `ModNicknameDialog`.
- [ ] Switch IME on. Type a Hiragana sequence.
- [ ] Composition popup appears under the cursor.
- [ ] Press Space → IME suggests Kanji conversions.
- [ ] Press Enter → composition commits to the field.

## Narrator-speech pass

For each surface in `a11y-goldens/`, launch the editor, set Narrator
config per Prerequisite above, navigate to the surface, and verify
Narrator's announcement matches the UIA tree's `Name` + `ControlType`.

- [ ] menubar-closed
- [ ] menubar-file-open
- [ ] menubar-edit-open
- [ ] ... (one bullet per surface in a11y-goldens/)

**Recording:** screen+audio capture of the Narrator-speech pass saved
to `tasks/stage-3i-narrator-recording.mp4`. Include a brief opening
showing Narrator Settings (per Prerequisite above) so future operators
can reproduce config.
```

#### T13.2 — Commit

```powershell
git add tasks/stage-3i-a11y-manual.md
git commit -m @'
docs(LT-4): [MT-11 a11y] T13 — Stage 3i manual checklist

Tab cycle, F2 rename, Escape close, arrow-key tree nav, IME smoke,
Narrator-speech pass. Documents prerequisite Narrator config for
reproducibility.
'@
```

---

### Task T14: Narrator-speech recording (manual, user-driven)

**Why:** spec §5 C9. One-time confidence pass.

**This task is executed by the user, not the agent.** Agent role here
is to prepare the environment and confirm the artifact lands.

**Files:**
- Create: `tasks/stage-3i-narrator-recording.mp4` (binary, ~5 min,
  user records)

#### T14.1 — Pre-recording prep

- [ ] **Step 1:** Verify editor builds + launches cleanly in HWND
  mode.
- [ ] **Step 2:** Confirm Narrator config matches T13.1 prerequisite.

#### T14.2 — User records

User runs the Narrator-speech pass section of `stage-3i-a11y-manual.md`
with a screen+audio recorder (OBS, Windows Game Bar, etc.). Saves to
`tasks/stage-3i-narrator-recording.mp4`.

#### T14.3 — Verify + commit

- [ ] **Step 1:** Confirm file is < 50 MB (git-friendly). If larger,
  re-encode at lower bitrate.

- [ ] **Step 2:** Commit.

```powershell
git add tasks/stage-3i-narrator-recording.mp4
git commit -m @'
docs(LT-4): [MT-11 a11y] T14 — Narrator-speech recording

One-time confidence pass: screen+audio capture confirming Narrator
announces what the UIA tree says it announces, across all
a11y-goldens/ surfaces.
'@
```

---

### Task T15: ROADMAP + CHANGELOG + HANDOFF updates

**Why:** CLAUDE.md ROADMAP+CHANGELOG rules. Phase 3 a11y close-out
completes Phase 3 hygiene.

**Files:**
- Modify: `ROADMAP.md` (MT-11 Phase 3 close-out reference)
- Modify: `CHANGELOG.md` (top entry per formatting rules)
- Modify: `tasks/HANDOFF.md` (refresh for next session)

#### T15.1 — CHANGELOG

- [ ] **Step 1:** Add entry at the TOP of the `## Changelog` section,
  following the formatting in `CHANGELOG.md`'s header notes.

```markdown
### Phase 3 a11y close-out — UIA-tree regression gate + manual smoke

*2026-05-25 · [`TODO-HASH`](https://github.com/DrKnickers/new-particle-editor/commit/TODO-HASH) · [#TODO-PR](https://github.com/DrKnickers/new-particle-editor/pull/TODO-PR)*

Phase 3 acceptance hygiene closes: the new-UI chrome now has a durable
Playwright a11y regression gate covering ~30 interactive surfaces,
runs in both HWND default mode and composition mode, and asserts
cross-mode equality as an explicit invariant.

**How we tackled it.** [Playwright spec-per-category](web/apps/editor/tests/a11y-chrome.spec.ts:1)
structure captures the Win32 UIA tree for each chrome surface via a
small standalone C++ inspector tool [`src/host/spike/uia_inspector.cpp`](src/host/spike/uia_inspector.cpp:1)
(Phase 0 ruled out maintained Node libs). A
[normalizer](web/apps/editor/tests/helpers/a11y-normalizer.ts:1)
drops volatile UIA fields and sorts deterministically, then a custom
`toMatchJSONGolden` matcher diffs against committed JSON goldens.
A dedicated [cross-mode equality spec](web/apps/editor/tests/a11y-cross-mode.spec.ts:1)
asserts byte-equality between HWND and composition goldens — the
FD6-class regression gate, encoded.

**Issues encountered and resolutions.** [fill in during build-out]

---
```

#### T15.2 — ROADMAP

- [ ] **Step 1:** Locate MT-11 entry in ROADMAP. If MT-11 was already
  shipped as a whole, add a sub-bullet noting a11y close-out shipped
  separately. If MT-11 was still "in progress" tracking a11y as the
  last item, mark it shipped (strikethrough + ✅ Shipped + move to
  Shipped section per CLAUDE.md ROADMAP rules).

#### T15.3 — HANDOFF refresh

- [ ] **Step 1:** Replace the "What shipped today" section with the
  a11y close-out summary. Keep the "Known follow-ups" list updated:
  drop "Phase 3 a11y close-out" from the list (since it just shipped);
  promote any surfaces deferred by T6 (R3) into a new follow-up entry.

#### T15.4 — Commit (docs-only)

```powershell
git add ROADMAP.md CHANGELOG.md tasks/HANDOFF.md
git commit -m @'
docs(LT-4): [MT-11 a11y] T15 — CHANGELOG + ROADMAP + HANDOFF refresh

Phase 3 a11y close-out shipped: UIA-tree regression gate + cross-mode
equality spec + Stage 3i manual + Narrator recording. ROADMAP MT-11
marked closed; deferred surfaces (if any from T6) carry forward.
'@
```

---

### Task T16: Pre-handoff test sweep + verification gate

**Why:** spec §8 verification gate, all 9 items.

#### T16.1 — Verification gate items 1-5

- [ ] **Step 1:** Vitest:

```powershell
pnpm --filter @particle-editor/editor test
```

Expected: 343 + N passing (N = normalizer unit tests added in T1.4).

- [ ] **Step 2:** Playwright HWND lane (default dist/):

```powershell
pnpm --filter @particle-editor/editor test:native
```

Expected: baseline 103 + 26 + 0 + N new a11y tests passing + 1 cross-mode
spec passing.

- [ ] **Step 3:** Rebuild composition-mode dist/ + Playwright composition
  lane:

```powershell
cd web
$env:VITE_VIEWPORT_TRANSPORT = "canvas-jpeg"
$env:VITE_WEBVIEW2_HOSTING = "composition"
pnpm --filter @particle-editor/editor build
$env:ALO_VIEWPORT_TRANSPORT = "canvas-jpeg"
$env:ALO_WEBVIEW2_HOSTING = "composition"
pnpm --filter @particle-editor/editor test:native
Remove-Item Env:ALO_VIEWPORT_TRANSPORT
Remove-Item Env:ALO_WEBVIEW2_HOSTING
Remove-Item Env:VITE_VIEWPORT_TRANSPORT
Remove-Item Env:VITE_WEBVIEW2_HOSTING
pnpm --filter @particle-editor/editor build
cd ..
```

Expected: 122 + 3 + 0 + N a11y tests passing.

- [ ] **Step 4:** MSBuild Debug + Release x64 clean (per L-023):

```powershell
MSBuild .\ParticleEditor.sln /p:Configuration=Debug /p:Platform=x64 /m
MSBuild .\ParticleEditor.sln /p:Configuration=Release /p:Platform=x64 /m
```

Expected: both clean. New artifact: `x64/{Debug,Release}/uia_inspector.exe`.

#### T16.2 — Verification gate items 6-9

- [ ] **Step 6:** Stage 3i checklist: every checkbox in
  `tasks/stage-3i-a11y-manual.md` is checked.

- [ ] **Step 7:** ROADMAP MT-11 Phase 3 marked closed.

- [ ] **Step 8:** CHANGELOG entry written; placeholder
  `TODO-HASH` / `TODO-PR` strings present (backfilled post-merge).

- [ ] **Step 9:** HANDOFF refreshed; "Known follow-ups" updated.

#### T16.3 — Pre-handoff smoke

- [ ] **Step 1:** Launch editor from `x64/Debug/ParticleEditor.exe`
  in HWND mode; open + close several menus; load a sample `.alo`; no
  visible regressions.

- [ ] **Step 2:** Launch in composition mode (same env-var dance);
  repeat smoke.

#### T16.4 — Final report

- [ ] **Step 1:** Summarize for the user:
  - All 9 verification gate items met
  - Vitest count: 343 + N
  - Playwright HWND: 103 + 26 + 0 + N
  - Playwright composition: 122 + 3 + 0 + N
  - MSBuild clean
  - Stage 3i manual + recording in place
  - Deferred surfaces (if any) filed in `tasks/a11y-deferred-surfaces.md`
  - Ready for FF to `origin/lt-4`

---

## 7. Sequencing summary

```
T0 (Phase 0 spike) ───┬──> T3 (UIA inspector)
                      │
T1 (normalizer) ──────┤
T2 (matcher) ─────────┘
                      │
                      └──> T4 (wrapper)
                              │
                              └──> T5/T6/T7/T8 (surface drivers)
                                       │
                                       └──> T9 (specs + HWND goldens)
                                                │
                                                └──> T10 (composition goldens)
                                                         │
                                                         └──> T11 (cross-mode spec)
                                                                  │
                                                                  └──> T12 (scripts)
                                                                           │
                                                                           └──> T13 (manual md)
                                                                                    │
                                                                                    └──> T14 (recording)
                                                                                             │
                                                                                             └──> T15 (docs)
                                                                                                      │
                                                                                                      └──> T16 (verify)
```

T0 is a **hard gate**. T1 + T2 + T3 can run in parallel after T0.
T5 + T6 + T7 + T8 can run in parallel after T4 (all modify the same
`a11y-surfaces.ts` so coordinate merge points; or land in sequence to
avoid trivial conflicts).

---

## 8. Stop-and-replan triggers

Per CLAUDE.md "If something goes sideways: STOP and re-plan
immediately":

- **T0.3 step 7** — cross-mode UIA trees structurally different →
  cross-mode contract not feasible → re-plan.
- **R3 4h cap exceeded during T5/T6/T7/T8** → stop dropping surfaces,
  re-plan whether to defer the whole dispatch or trim further.
- **R4 limit (50 goldens per mode) reached during T9/T10** → stop
  generating, re-scope.
- **Vitest red after any task** → stop, fix root cause, don't
  proceed.
- **Cross-mode spec fails on a surface in T11 that can't be normalized
  away** → that's R2 manifest; investigate whether it's a real chrome
  bug or a normalizer gap; do not silently allow divergence.
