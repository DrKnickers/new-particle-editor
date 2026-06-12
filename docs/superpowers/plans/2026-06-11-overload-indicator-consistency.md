# Overload Indicator Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ⚠ chain-warning glyph track the configurable overload-guard cap, add a predictive system-load chip to the emitter tree so no gate refusal is ever silently foreshadowed, and fix the stale-latch copy flash at refusal-banner exit.

**Architecture:** Entirely web-side (zero C++). Three parts per the spec ([2026-06-11-overload-indicator-consistency-design.md](../specs/2026-06-11-overload-indicator-consistency-design.md)): (1) `estimateChainLoad` gains an optional threshold threaded from a new reactive `useOverloadGuardConfig()` hook (CustomEvent dispatched by `writeOverloadGuard`); (2) a new `SystemLoadChip` leaf component above the emitter-tree rows warns when `(instances + 1) × estimateSystemLoad > cap`; (3) `OverloadBanner` freezes its rendered variant during the exit animation and clears the web-side latch on refusal.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react (jsdom), Tailwind v4, the existing bridge schema (no new commands/events).

**Verification baseline (pre-flight, Task 0):** web 780/780, `tsc -b` 0, native harness 180/0, host Debug x64 clean.

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `web/apps/editor/src/lib/chain-load.ts` | Modify | `estimateChainLoad(root, threshold?)` — optional threshold, default `CHAIN_WARN_THRESHOLD` |
| `web/apps/editor/src/lib/__tests__/chain-load.test.ts` | Modify | Threshold-param tests |
| `web/apps/editor/src/lib/overload-guard.ts` | Modify | `OVERLOAD_GUARD_CHANGED_EVENT` constant, dispatch in `writeOverloadGuard`, `useOverloadGuardConfig()` hook (this file owns both ends of the event — spec risk 6) |
| `web/apps/editor/src/lib/__tests__/overload-guard.test.ts` | Modify | Event-dispatch + hook tests |
| `web/apps/editor/src/components/SystemLoadChip.tsx` | Create | Predictive system-total warning chip (subscribes to `stats/tick` itself, confining the 4 Hz re-render to this leaf) |
| `web/apps/editor/src/components/__tests__/SystemLoadChip.test.tsx` | Create | Chip visibility/copy tests |
| `web/apps/editor/src/screens/EmitterTree.tsx` | Modify | Thread cap into the `chainWarnings` memo; compute `systemLoad`; mount the chip |
| `web/apps/editor/src/screens/__tests__/EmitterTree.test.tsx` | Modify | Glyph-at-cap tests |
| `web/apps/editor/src/components/OverloadBanner.tsx` | Modify | Exit-variant freeze + `setOverload(false)` on refusal |
| `web/apps/editor/src/components/__tests__/OverloadBanner.test.tsx` | Modify | Exit-freeze regression test, stale-latch-clear test, precedence test updated to the real 4 Hz contract |
| `CHANGELOG.md` | Modify (Task 7) | Ship entry per repo convention |

Run all `pnpm` commands **from `web/`**. Run vitest file filters as positional args, e.g. `pnpm --filter @particle-editor/editor test chain-load`. **L-080:** never gate on a piped exit code — run the command bare and read its own exit status. **L-046:** never run `vitest` and `vite build` concurrently.

---

### Task 0: Pre-flight — worktree restore + green baseline

Fresh worktree: NuGet layout (L-039) and web deps must be materialised before anything builds.

**Files:** none modified.

- [ ] **Step 1: NuGet restore via cache copy (L-039)**

```powershell
# Only Microsoft.Web.WebView2 1.0.3967.48 is referenced (packages.config).
# Copy the global-cache package into the solution-local layout:
New-Item -ItemType Directory -Force "packages\Microsoft.Web.WebView2.1.0.3967.48" | Out-Null
Copy-Item -Recurse -Force "$env:USERPROFILE\.nuget\packages\microsoft.web.webview2\1.0.3967.48\*" "packages\Microsoft.Web.WebView2.1.0.3967.48\"
Test-Path "packages\Microsoft.Web.WebView2.1.0.3967.48\build\native\Microsoft.Web.WebView2.targets"
```
Expected: `True`.

- [ ] **Step 2: Web install + baseline suite**

```powershell
cd web
pnpm install
pnpm --filter @particle-editor/editor test
```
Expected: **780 passed**. Then `pnpm exec tsc -b` (from `web/`) → 0 errors.

- [ ] **Step 3: Dist build (L-040) — needed later for the native harness + feel test**

```powershell
pnpm --filter @particle-editor/editor build
```
Expected: vite build clean.

- [ ] **Step 4: Host Debug x64 build (L-046 — PowerShell, the `.sln`, VS18 path)**

```powershell
& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" ParticleEditor.sln /p:Configuration=Debug /p:Platform=x64 /m
```
Expected: build succeeds (benign LNK4098 warning OK).

- [ ] **Step 5: Native harness baseline**

```powershell
cd web
pnpm --filter @particle-editor/editor a11y
```
Expected: **180 passed / 0 failed** (~2 min).

---

### Task 1: `estimateChainLoad` optional threshold

**Files:**
- Modify: `web/apps/editor/src/lib/chain-load.ts` (function at ~line 53)
- Test: `web/apps/editor/src/lib/__tests__/chain-load.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("estimateChainLoad", …)` block (the `node`/`spawn`/`syntheticRoot` helpers at the top of the file are reused):

```ts
  it("honours a passed threshold below the default (cap-tracking glyph)", () => {
    // 2,000/s × 1 s = 2,000 — silent at the default 10k, flagged at cap 1,000.
    const root = node("stream", { nParticlesPerSecond: 2_000, lifetime: 1 });
    expect(estimateChainLoad(syntheticRoot([root])).size).toBe(0);
    const warnings = estimateChainLoad(syntheticRoot([root]), 1_000);
    expect(warnings.get(root.stableId)?.estimate).toBe(2_000);
  });
  it("honours a passed threshold above the default", () => {
    // 20,000 estimate: flagged at the default 10k, silent at cap 50k —
    // the deliberate semantic change (glyph ⟺ gate, not "heavy").
    const root = node("big", { nParticlesPerSecond: 20_000, lifetime: 1 });
    expect(estimateChainLoad(syntheticRoot([root])).size).toBe(1);
    expect(estimateChainLoad(syntheticRoot([root]), 50_000).size).toBe(0);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @particle-editor/editor test chain-load`
Expected: the two new tests FAIL (extra argument ignored → both calls behave like the default); every existing test passes.

- [ ] **Step 3: Implement**

In `chain-load.ts`, change the `estimateChainLoad` signature and the comparison (currently `cumulative > CHAIN_WARN_THRESHOLD` at ~line 60):

```ts
export function estimateChainLoad(
  root: EmitterTreeNode,
  // Configurable guard cap when the overload guard is enabled; the NT-11
  // advisory default otherwise. The glyph means "will be gated" whenever
  // a cap is passed — see the consistency spec (Decisions).
  threshold: number = CHAIN_WARN_THRESHOLD,
): Map<number, ChainWarning> {
```

and inside `visit`:

```ts
    if (cumulative > threshold) {
```

Also update the stale doc comment above the function: replace the sentence "whose cumulative estimate crosses CHAIN_WARN_THRESHOLD" with "whose cumulative estimate crosses `threshold` (default `CHAIN_WARN_THRESHOLD`)".

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @particle-editor/editor test chain-load`
Expected: all pass (existing default-call tests untouched).

- [ ] **Step 5: Commit**

```bash
git add web/apps/editor/src/lib/chain-load.ts web/apps/editor/src/lib/__tests__/chain-load.test.ts
git commit -m "feat(chain-load): estimateChainLoad accepts an optional warning threshold"
```

---

### Task 2: Reactive guard config — event dispatch + `useOverloadGuardConfig()`

**Files:**
- Modify: `web/apps/editor/src/lib/overload-guard.ts`
- Test: `web/apps/editor/src/lib/__tests__/overload-guard.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `overload-guard.test.ts`. Extend the existing import from `../overload-guard` with `OVERLOAD_GUARD_CHANGED_EVENT` and `useOverloadGuardConfig`, and add:

```ts
import { renderHook, act } from "@testing-library/react";
```

New describe block at the end of the file:

```ts
describe("useOverloadGuardConfig", () => {
  it("writeOverloadGuard dispatches the change event", () => {
    const seen = vi.fn();
    window.addEventListener(OVERLOAD_GUARD_CHANGED_EVENT, seen);
    writeOverloadGuard({ enabled: true, maxParticles: 5_000 });
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener(OVERLOAD_GUARD_CHANGED_EVENT, seen);
  });

  it("seeds from storage and updates live on writeOverloadGuard", () => {
    writeOverloadGuard({ enabled: true, maxParticles: 2_000 });
    const { result } = renderHook(() => useOverloadGuardConfig());
    expect(result.current).toEqual({ enabled: true, maxParticles: 2_000 });
    act(() => {
      writeOverloadGuard({ enabled: false, maxParticles: 9_000 });
    });
    expect(result.current).toEqual({ enabled: false, maxParticles: 9_000 });
  });

  it("stops listening after unmount", () => {
    writeOverloadGuard({ enabled: true, maxParticles: 2_000 });
    const { result, unmount } = renderHook(() => useOverloadGuardConfig());
    unmount();
    act(() => {
      writeOverloadGuard({ enabled: true, maxParticles: 3_000 });
    });
    // The unmounted hook's last value is unchanged (no setState-after-unmount).
    expect(result.current).toEqual({ enabled: true, maxParticles: 2_000 });
  });
});
```

Note: this test file has no `localStorage.clear()` `beforeEach`; tests above already write the key freely and each new test writes its own value first, so no isolation step is needed.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @particle-editor/editor test overload-guard`
Expected: FAIL — `OVERLOAD_GUARD_CHANGED_EVENT` / `useOverloadGuardConfig` are not exported.

- [ ] **Step 3: Implement**

In `overload-guard.ts`:

Add to the imports at the top:

```ts
import { useEffect, useState } from "react";
```

Add the event constant next to `KEY` (~line 26):

```ts
// Same-tab change signal for useOverloadGuardConfig — the `storage` event
// only fires in OTHER tabs, and the editor is a single WebView anyway.
// Constant lives here so this file owns both ends of the contract.
export const OVERLOAD_GUARD_CHANGED_EVENT = "alo:overload-guard-changed";
```

Extend `writeOverloadGuard` (currently lines 47–52) to dispatch after the write:

```ts
export function writeOverloadGuard(c: OverloadGuardConfig): void {
  localStorage.setItem(
    KEY,
    JSON.stringify({ enabled: c.enabled, maxParticles: clampMaxParticles(c.maxParticles) }),
  );
  window.dispatchEvent(new CustomEvent(OVERLOAD_GUARD_CHANGED_EVENT));
}
```

Add the hook at the end of the file:

```ts
/** Live overload-guard config for React consumers (the cap-tracking ⚠
 *  glyph + the system-load chip). Seeds from readOverloadGuard(); re-reads
 *  whenever writeOverloadGuard() dispatches the change event. */
export function useOverloadGuardConfig(): OverloadGuardConfig {
  const [config, setConfig] = useState<OverloadGuardConfig>(() => readOverloadGuard());
  useEffect(() => {
    const onChange = () => setConfig(readOverloadGuard());
    window.addEventListener(OVERLOAD_GUARD_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(OVERLOAD_GUARD_CHANGED_EVENT, onChange);
  }, []);
  return config;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @particle-editor/editor test overload-guard`
Expected: all pass. Also run `pnpm --filter @particle-editor/editor test` once here — `writeOverloadGuard` gained a side effect, so check no other suite trips on the dispatch.
Expected: 780 + new = all pass.

- [ ] **Step 5: Commit**

```bash
git add web/apps/editor/src/lib/overload-guard.ts web/apps/editor/src/lib/__tests__/overload-guard.test.ts
git commit -m "feat(overload-guard): change event + useOverloadGuardConfig reactive hook"
```

---

### Task 3: EmitterTree threads the cap into the glyph

**Files:**
- Modify: `web/apps/editor/src/screens/EmitterTree.tsx` (imports ~line 97; `chainWarnings` memo at ~line 1276; stale comment at ~line 347)
- Test: `web/apps/editor/src/screens/__tests__/EmitterTree.test.tsx` (after the NT-11 glyph describe ending ~line 1100)

- [ ] **Step 1: Write the failing tests**

In `EmitterTree.test.tsx`, add to the existing `../../lib/…` imports (match the file's existing import style — it already imports `useMockEmitterProperties`, `MockBridge`, `renderWithTooltips`, `waitFor`, `screen`):

```ts
import { writeOverloadGuard } from "@/lib/overload-guard";
```

New describe after the NT-11 glyph describe:

```tsx
// ── Cap-tracking glyph (overload-indicator-consistency spec, Part 1) ──
// The glyph threshold follows the configurable guard cap when the guard
// is enabled, and falls back to the NT-11 advisory 10k when disabled.
describe("chain-warning glyph tracks the configurable guard cap", () => {
  beforeEach(() => {
    useMockEmitterProperties.getState().reset();
    localStorage.clear();
  });

  it("fires at the guard cap, below the fixed 10k advisory", async () => {
    // 2,000/s × 1 s = 2,000: silent at 10k, gated (and now glyphed) at cap 1,000.
    useMockEmitterProperties.getState().patch(0, { nParticlesPerSecond: 2_000, lifetime: 1 });
    writeOverloadGuard({ enabled: true, maxParticles: 1_000 });
    renderWithTooltips(<EmitterTree bridge={new MockBridge()} />);
    await screen.findByTestId("emitter-chain-warning-0");
  });

  it("falls back to the 10k advisory when the guard is disabled", async () => {
    useMockEmitterProperties.getState().patch(0, { nParticlesPerSecond: 2_000, lifetime: 1 });
    writeOverloadGuard({ enabled: false, maxParticles: 1_000 });
    renderWithTooltips(<EmitterTree bridge={new MockBridge()} />);
    await waitFor(() => expect(screen.getByText("Smoke")).toBeInTheDocument());
    expect(screen.queryAllByTestId(/^emitter-chain-warning-/)).toHaveLength(0);
  });

  it("reacts live to a cap change (Preferences edit, no reload)", async () => {
    useMockEmitterProperties.getState().patch(0, { nParticlesPerSecond: 2_000, lifetime: 1 });
    writeOverloadGuard({ enabled: true, maxParticles: 10_000 });
    renderWithTooltips(<EmitterTree bridge={new MockBridge()} />);
    await waitFor(() => expect(screen.getByText("Smoke")).toBeInTheDocument());
    expect(screen.queryAllByTestId(/^emitter-chain-warning-/)).toHaveLength(0);
    act(() => {
      writeOverloadGuard({ enabled: true, maxParticles: 1_000 });
    });
    await screen.findByTestId("emitter-chain-warning-0");
  });
});
```

(`act` is already imported in this test file via `@testing-library/react`; if not, add it to that import.)

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @particle-editor/editor test EmitterTree`
Expected: tests 1 and 3 FAIL (no glyph — threshold still fixed at 10k); test 2 passes incidentally (2,000 < 10,000 either way) — that's fine, it pins the fallback against regressions.

- [ ] **Step 3: Implement**

In `EmitterTree.tsx`:

Add to imports:

```ts
import { useOverloadGuardConfig } from "@/lib/overload-guard";
```

In the tree component body, directly above the `chainWarnings` memo (~line 1276), add the hook and rework the memo:

```tsx
  // [indicator-consistency] Live guard config: the glyph threshold follows
  // the configurable cap while the guard is enabled (glyph ⟺ gate), and
  // falls back to the NT-11 advisory 10k when disabled.
  const guard = useOverloadGuardConfig();

  // NT-11: stableId → soft chain-load warning, recomputed whenever the
  // tree refetches (spawn values ride the tree DTO, so a properties edit
  // that matters lands here via emitters/tree/changed → setTree).
  const chainWarnings = useMemo(
    () =>
      tree !== null
        ? estimateChainLoad(tree.root, guard.enabled ? guard.maxParticles : undefined)
        : new Map<number, ChainWarning>(),
    [tree, guard],
  );
```

Also update the stale row-prop comment at ~line 347 (`// count crosses CHAIN_WARN_THRESHOLD. Advisory only.`) to `// count crosses the warning threshold (guard cap, or the 10k advisory).`

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @particle-editor/editor test EmitterTree`
Expected: all pass, including the pre-existing NT-11 describe. (Isolation note: the NT-11 describe never writes the guard key, so `readOverloadGuard()` returns the default 10k there; the new describe clears `localStorage` in its own `beforeEach`, so its cap writes can't leak into other tests.)

- [ ] **Step 5: Commit**

```bash
git add web/apps/editor/src/screens/EmitterTree.tsx web/apps/editor/src/screens/__tests__/EmitterTree.test.tsx
git commit -m "feat(emitter-tree): chain-warning glyph threshold tracks the configurable guard cap"
```

---

### Task 4: `SystemLoadChip` component

**Files:**
- Create: `web/apps/editor/src/components/SystemLoadChip.tsx`
- Test: `web/apps/editor/src/components/__tests__/SystemLoadChip.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `SystemLoadChip.test.tsx` (stub-bridge pattern copied from `OverloadBanner.test.tsx`):

```tsx
// Vitest: SystemLoadChip (overload-indicator-consistency spec, Part 2).
// Predictive system-total warning: visible exactly when the NEXT spawn
// attempt would be refused by the #138 gate —
// (instances + 1) × systemLoad > cap, guard enabled.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { SystemLoadChip } from "../SystemLoadChip";
import { writeOverloadGuard } from "@/lib/overload-guard";
import type { Bridge } from "@particle-editor/bridge-schema";

function makeBridge() {
  const handlers = new Map<string, (e: { payload: unknown }) => void>();
  const request = vi.fn().mockResolvedValue({ ok: true });
  const on = vi.fn().mockImplementation(
    (event: string, cb: (e: { payload: unknown }) => void) => {
      handlers.set(event, cb);
      return () => handlers.delete(event);
    },
  );
  const emit = (event: string, payload: unknown) => {
    act(() => handlers.get(event)?.({ payload }));
  };
  return { bridge: { request, on } as unknown as Bridge, emit };
}

const tick = (instances: number) => ({
  fps: 30, emitters: 1, particles: 0, instances, overload: false,
});

describe("SystemLoadChip", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("hidden while the next placement fits the cap", () => {
    const { bridge } = makeBridge();
    writeOverloadGuard({ enabled: true, maxParticles: 1_000 });
    render(<SystemLoadChip bridge={bridge} systemLoad={400} />);
    expect(screen.queryByTestId("system-load-chip")).not.toBeInTheDocument();
  });

  it("hidden for a zero-load effect", () => {
    const { bridge } = makeBridge();
    writeOverloadGuard({ enabled: true, maxParticles: 1_000 });
    render(<SystemLoadChip bridge={bridge} systemLoad={0} />);
    expect(screen.queryByTestId("system-load-chip")).not.toBeInTheDocument();
  });

  it("warns with the effect-too-big copy at zero instances", () => {
    const { bridge } = makeBridge();
    writeOverloadGuard({ enabled: true, maxParticles: 1_000 });
    render(<SystemLoadChip bridge={bridge} systemLoad={2_000} />);
    const chip = screen.getByTestId("system-load-chip");
    expect(chip).toHaveAttribute("role", "status");
    expect(chip.textContent).toContain("This effect ≈ 2,000 particles");
    expect(chip.textContent).toContain("1,000 preview limit");
  });

  it("switches to the prospective copy once an instance is placed", () => {
    const { bridge, emit } = makeBridge();
    writeOverloadGuard({ enabled: true, maxParticles: 1_000 });
    render(<SystemLoadChip bridge={bridge} systemLoad={600} />);
    // 1 × 600 fits, so nothing shows yet…
    expect(screen.queryByTestId("system-load-chip")).not.toBeInTheDocument();
    // …but with one placed, the NEXT placement (2 × 600 = 1,200) would refuse.
    emit("stats/tick", tick(1));
    const chip = screen.getByTestId("system-load-chip");
    expect(chip.textContent).toContain("Another instance would exceed");
    expect(chip.textContent).toContain("1,200");
    expect(chip.textContent).toContain("1,000");
  });

  it("hidden when the guard is disabled, regardless of load", () => {
    const { bridge } = makeBridge();
    writeOverloadGuard({ enabled: false, maxParticles: 1_000 });
    render(<SystemLoadChip bridge={bridge} systemLoad={1_000_000_000} />);
    expect(screen.queryByTestId("system-load-chip")).not.toBeInTheDocument();
  });

  it("reacts live to a cap change", () => {
    const { bridge } = makeBridge();
    writeOverloadGuard({ enabled: true, maxParticles: 1_000 });
    render(<SystemLoadChip bridge={bridge} systemLoad={2_000} />);
    expect(screen.getByTestId("system-load-chip")).toBeInTheDocument();
    act(() => {
      writeOverloadGuard({ enabled: true, maxParticles: 10_000 });
    });
    expect(screen.queryByTestId("system-load-chip")).not.toBeInTheDocument();
  });

  it("clears back below the cap when instances drop (preview cleared)", () => {
    const { bridge, emit } = makeBridge();
    writeOverloadGuard({ enabled: true, maxParticles: 1_000 });
    render(<SystemLoadChip bridge={bridge} systemLoad={600} />);
    emit("stats/tick", tick(1));
    expect(screen.getByTestId("system-load-chip")).toBeInTheDocument();
    emit("stats/tick", tick(0));
    expect(screen.queryByTestId("system-load-chip")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @particle-editor/editor test SystemLoadChip`
Expected: FAIL — module `../SystemLoadChip` does not exist.

- [ ] **Step 3: Implement**

Create `SystemLoadChip.tsx`:

```tsx
// SystemLoadChip — predictive system-total overload warning at the top of
// the emitter tree (overload-indicator-consistency spec, Part 2).
//
// The per-row ⚠ glyph is per-emitter / per-single-instance; the #138 gate
// compares SYSTEM total × placed-instance count. This chip covers the two
// multipliers the glyph can't: visible exactly when the NEXT spawn attempt
// would be refused — (instances + 1) × systemLoad > cap, guard enabled.
// (Current-placed-state semantics would be self-erasing: the engine
// CLEARS any over-cap placed state via the edit-time check, so the only
// persistent over-cap state is instances = 0.)
//
// `instances` comes from the 4 Hz stats/tick — subscribing HERE confines
// the 4 Hz re-render to this leaf instead of the whole tree. Browser
// MockBridge emits no stats/tick → instances stays 0 → the chip still
// works as a per-instance authoring signal in browser dev.
//
// Styling: amber-tinted band + normal text colour (readable in both
// themes for free — the #121 light-mode amber-text lesson), with the
// TriangleAlert in the same amber as the per-row glyph.
import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { Bridge } from "@particle-editor/bridge-schema";
import { fmtCount } from "@/lib/chain-load";
import { useOverloadGuardConfig } from "@/lib/overload-guard";

export function SystemLoadChip({
  bridge,
  systemLoad,
}: {
  bridge: Bridge;
  // estimateSystemLoad(tree.root) — computed by EmitterTree's memo, the
  // same value useEstimatedLoadPush pushes to the engine.
  systemLoad: number;
}) {
  const guard = useOverloadGuardConfig();
  const [instances, setInstances] = useState(0);
  useEffect(
    () => bridge.on("stats/tick", (e) => setInstances(e.payload.instances)),
    [bridge],
  );
  if (!guard.enabled || systemLoad <= 0) return null;
  const projected = (instances + 1) * systemLoad;
  if (projected <= guard.maxParticles) return null;
  return (
    <div
      role="status"
      data-testid="system-load-chip"
      className="mb-1 flex shrink-0 items-center gap-1.5 rounded-sm bg-warning/15 px-2 py-1 text-xs text-text-2"
    >
      <TriangleAlert className="size-3.5 shrink-0 text-amber-400" aria-hidden />
      <span className="tabular-nums">
        {instances === 0 ? (
          <>This effect ≈ {fmtCount(systemLoad)} particles — over the {fmtCount(guard.maxParticles)} preview limit</>
        ) : (
          <>Another instance would exceed the preview limit (≈ {fmtCount(projected)} of {fmtCount(guard.maxParticles)})</>
        )}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @particle-editor/editor test SystemLoadChip`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add web/apps/editor/src/components/SystemLoadChip.tsx web/apps/editor/src/components/__tests__/SystemLoadChip.test.tsx
git commit -m "feat(system-load-chip): predictive system-total overload warning component"
```

---

### Task 5: Mount the chip in `EmitterTree`

**Files:**
- Modify: `web/apps/editor/src/screens/EmitterTree.tsx` (imports ~line 97; component body near the `chainWarnings` memo ~line 1276; render root ~line 2208)
- Test: `web/apps/editor/src/screens/__tests__/EmitterTree.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to the Task-3 describe (`chain-warning glyph tracks the configurable guard cap`) — same fixtures, same `beforeEach`:

```tsx
  it("mounts the system-load chip when the effect exceeds the cap (system view)", async () => {
    useMockEmitterProperties.getState().patch(0, { nParticlesPerSecond: 2_000, lifetime: 1 });
    writeOverloadGuard({ enabled: true, maxParticles: 1_000 });
    renderWithTooltips(<EmitterTree bridge={new MockBridge()} />);
    const chip = await screen.findByTestId("system-load-chip");
    expect(chip.textContent).toContain("preview limit");
  });

  it("no chip at fixture-default spawn values (a11y-stability guard)", async () => {
    renderWithTooltips(<EmitterTree bridge={new MockBridge()} />);
    await waitFor(() => expect(screen.getByText("Smoke")).toBeInTheDocument());
    expect(screen.queryByTestId("system-load-chip")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify the first fails**

Run: `pnpm --filter @particle-editor/editor test EmitterTree`
Expected: the mount test FAILS (chip not rendered anywhere); the default-values test passes vacuously (pins the no-churn property for the a11y goldens).

- [ ] **Step 3: Implement**

In `EmitterTree.tsx`:

Add imports (extend the existing `@/lib/chain-load` import at line 97 with `estimateSystemLoad`, and add the component import):

```ts
import { estimateChainLoad, estimateSystemLoad, formatChainWarning, type ChainWarning } from "@/lib/chain-load";
import { SystemLoadChip } from "@/components/SystemLoadChip";
```

Below the `chainWarnings` memo, add:

```tsx
  // [indicator-consistency] System-total estimate for the chip — the same
  // walk useEstimatedLoadPush(bridge, tree) runs for the engine push below;
  // recomputing the pure O(nodes) walk here is cheaper than widening the
  // hook's signature.
  const systemLoad = useMemo(
    () => (tree !== null ? estimateSystemLoad(tree.root) : 0),
    [tree],
  );
```

In the render root (the `className="flex h-full flex-col outline-none"` div at ~line 2208), insert the chip as the first child, before the `{tree === null ? …}` conditional — non-scrolling, pinned above the rows:

```tsx
      {tree !== null && <SystemLoadChip bridge={bridge} systemLoad={systemLoad} />}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @particle-editor/editor test EmitterTree`
Expected: all pass (including every pre-existing EmitterTree spec — the chip renders null in default scenarios).

- [ ] **Step 5: Commit**

```bash
git add web/apps/editor/src/screens/EmitterTree.tsx web/apps/editor/src/screens/__tests__/EmitterTree.test.tsx
git commit -m "feat(emitter-tree): mount the predictive system-load chip above the rows"
```

---

### Task 6: `OverloadBanner` exit freeze + authoritative latch clear

**Files:**
- Modify: `web/apps/editor/src/components/OverloadBanner.tsx`
- Test: `web/apps/editor/src/components/__tests__/OverloadBanner.test.tsx`

**Order matters:** Step 1 updates an existing test to the corrected event contract *first* (it stays green before and after the implementation); Steps 2–3 add the red tests; Step 4 implements.

- [ ] **Step 1: Update the precedence test to the real 4 Hz contract (stays green)**

The existing test `"refusal takes precedence over latch copy while the refusal window is active"` emits `tick(true)` once and never again. In reality the host re-reports a genuine latch at 4 Hz; once the implementation force-clears `overload` on refusal, a *genuinely* still-latched engine re-asserts via the next tick. Update the test to model that — insert one re-assertion tick after the refusal assertions, before the 5 s wait:

```tsx
    // Fire refusal — should show refusal copy
    emit("engine/overload/refused", { estimated: 24000, cap: 10000, attemptedCount: 1 });
    expect(screen.getByTestId("preview-overload-banner").textContent).toContain("Spawn blocked");
    expect(screen.getByTestId("preview-overload-banner").textContent).toContain("24,000");
    // The engine is GENUINELY still latched (estimate undercount case):
    // the 4 Hz stream keeps reporting overload=true after the refusal.
    // (The refusal handler force-clears the web latch — this re-assert is
    // how a real latch survives it.)
    emit("stats/tick", tick(true));
    // After 5s window with latch still active → banner returns to latch copy.
```

Run: `pnpm --filter @particle-editor/editor test OverloadBanner`
Expected: all pass (pre-implementation, the extra tick is a no-op — `overload` was already true).

Commit:

```bash
git add web/apps/editor/src/components/__tests__/OverloadBanner.test.tsx
git commit -m "test(overload-banner): precedence test models the real 4 Hz latch re-assert"
```

- [ ] **Step 2: Write the two failing tests**

Append to the refusal describe section of `OverloadBanner.test.tsx`:

```tsx
  it("keeps the refusal copy through the exit fade — no stale latch flash (the s37 bug)", async () => {
    const { bridge, emit } = makeBridge();
    render(<OverloadBanner bridge={bridge} />);
    emit("engine/overload/refused", { estimated: 2000, cap: 1000, attemptedCount: 1 });
    // Past REFUSAL_MS: refusal nulls, visible drops, exit window begins.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5050));
    });
    const banner = screen.getByTestId("preview-overload-banner");
    expect(banner).toHaveAttribute("data-state", "closed");
    // The exiting banner must keep showing what it was showing — never
    // fall through to the latch copy.
    expect(banner.textContent).toContain("Spawn blocked");
    expect(banner.textContent).not.toContain("Preview spawning limited");
  }, 10_000);

  it("a refusal clears a stale web-side latch (engine cleared the preview)", async () => {
    const { bridge, emit } = makeBridge();
    render(<OverloadBanner bridge={bridge} />);
    // Stale latch arrives first (e.g. a tick emitted just before the clear)…
    emit("stats/tick", tick(true));
    // …then the refusal. The engine's Clear() reset its latch; no further
    // tick re-asserts it.
    emit("engine/overload/refused", { estimated: 2000, cap: 1000, attemptedCount: 1 });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5050));
    });
    // Without the force-clear, the stale `overload` keeps visible=true and
    // the latch copy shows here. With it, the banner is exiting…
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    // …and fully unmounts.
    expect(screen.queryByTestId("preview-overload-banner")).not.toBeInTheDocument();
  }, 10_000);
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm --filter @particle-editor/editor test OverloadBanner`
Expected: both new tests FAIL —
- exit-freeze test: `textContent` contains "Preview spawning limited" during the exit (the ternary falls through to the latch copy);
- stale-latch test: the banner is still in the document with the latch copy after the refusal window.

- [ ] **Step 4: Implement**

In `OverloadBanner.tsx`, two changes inside the `OverloadBanner` function (lines 116–163):

(a) In the `engine/overload/refused` handler, clear the latch alongside setting the refusal (after the `clearTimeout` block, next to `setRefusal`):

```tsx
      setRefusal({ estimated, cap });
      // A refusal means the engine Clear()'d the preview — its latch reset
      // with it (engine.cpp Clear()), so any web-held `overload` is stale.
      // Force-clear it; a GENUINELY still-latched engine re-asserts via the
      // next 4 Hz tick (≤250 ms). Kills the delivery-order race outright.
      setOverload(false);
```

(b) Freeze the rendered variant for the exit. Replace the block from `const visible = …` through the `<OverloadBannerBody …/>` return with:

```tsx
  // The banner is visible when a refusal is active OR when the latch is set.
  // usePresence drives the exit animation for both cases off a single boolean.
  const visible = refusal !== null || overload;
  // [s37 bug] Freeze the rendered variant for the exit: when the refusal
  // window expires and visible drops, usePresence keeps the body mounted
  // for the 150 ms fade — and the raw `refusal ?? latch` ternary would
  // fall through to the LATCH copy for the whole fade. While visible,
  // track the live choice; while exiting, render what was shown last.
  // (Render-time ref write is safe: idempotent "last rendered value".)
  const lastShownRef = useRef<RefusalState | null>(null);
  if (visible) lastShownRef.current = refusal;
  const shownRefusal = visible ? refusal : lastShownRef.current;
  const { mounted, state, onAnimationEnd } = usePresence(visible, EXIT_MS);
  if (!mounted) return null;
  return (
    <OverloadBannerBody
      bridge={bridge}
      state={state}
      onAnimationEnd={onAnimationEnd}
      refusal={shownRefusal}
    />
  );
```

(`useRef` is already imported in this file.)

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @particle-editor/editor test OverloadBanner`
Expected: all pass — the two new tests, the updated precedence test (latch re-asserts via the re-emitted tick), and every pre-existing latch/occlusion/motion test.

- [ ] **Step 6: Commit**

```bash
git add web/apps/editor/src/components/OverloadBanner.tsx web/apps/editor/src/components/__tests__/OverloadBanner.test.tsx
git commit -m "fix(overload-banner): freeze exit variant + clear stale latch on refusal (s37 feel-test bug 2)"
```

---

### Task 7: Full gates + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md` (new top entry under `## Changelog`)

- [ ] **Step 1: Full web suite + types + build (sequentially — L-046)**

From `web/`:

```powershell
pnpm --filter @particle-editor/editor test
```
Expected: **780 + ~17 new, 0 failed.** Then:

```powershell
pnpm exec tsc -b
```
Expected: 0 errors. Then:

```powershell
pnpm --filter @particle-editor/editor build
```
Expected: vite build clean (the dist is also what the native harness + feel test serve — L-040).

- [ ] **Step 2: Native harness (full run — L-081: never a `--grep` subset for goldens)**

```powershell
pnpm --filter @particle-editor/editor a11y
```
Expected: **180 passed / 0 failed** — the chip renders null and the glyph labels are unchanged at the default 10k cap, so the a11y goldens must be byte-stable. If any golden diffs, STOP and investigate (it means a default scenario unexpectedly renders the chip or altered a label) — do NOT regen goldens to make it pass.

- [ ] **Step 3: Host build sanity (no C++ changed — cheap insurance only)**

```powershell
& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" ParticleEditor.sln /p:Configuration=Debug /p:Platform=x64 /m
```
Expected: clean (benign LNK4098).

- [ ] **Step 4: CHANGELOG entry**

Add at the **top** of the `## Changelog` section, matching the house format (date line backfilled at merge — leave the TODO):

```markdown
### Overload indicators made consistent — cap-tracking ⚠ glyph, predictive system-load chip, banner exit fix

*TODO(backfill): YYYY-MM-DD · merge hash · PR #NN*

The two #138 feel-test bugs. The emitter-tree ⚠ glyph now warns at the **configurable** guard cap (Preferences → Preview) instead of the fixed 10,000, so an effect the gate refuses is always marked (guard off restores the 10k advisory). A new **system-load chip** above the emitter rows warns when the *next* placement would be refused — `(placed + 1) × estimated total > cap` — covering the two multipliers the per-row glyph can't see (sum across roots, × placed instances), with copy that names both numbers. And the refusal banner no longer flashes the stale "Preview spawning limited" latch copy as it fades out.

**How we tackled it.** Entirely web-side — zero engine/bridge changes. [`estimateChainLoad`](src/lib/chain-load.ts) gained an optional threshold; a new `useOverloadGuardConfig()` hook in [`overload-guard.ts`](src/lib/overload-guard.ts) makes the localStorage config reactive via an `alo:overload-guard-changed` CustomEvent dispatched inside `writeOverloadGuard()` (the lib owns both ends). [`SystemLoadChip`](src/components/SystemLoadChip.tsx) subscribes to `stats/tick` itself, confining the 4 Hz re-render to the leaf; its trigger is deliberately *predictive* (`(instances+1) × load > cap`) because the engine clears any over-cap placed state, making current-state semantics self-erasing. Semantic note: the glyph now means "will be gated", not "heavy" — raising the cap above 10k removes glyphs from effects between 10k and the cap.

**Issues encountered and resolutions.** The handoff blamed bug 2 on a spawn leaking through the estimate-push staleness window and suggested an engine-side latch reset in `Engine::Clear()` — that reset already existed, and the host emits the refusal and `overload=false` in the same 4 Hz poll. The real bug was in the web render layer: when the 5 s refusal window expires, `usePresence` keeps the banner mounted for the 150 ms exit fade, and the `refusal ?? latch` ternary fell through to the latch copy for the whole fade. Fix: freeze the rendered variant at exit start (render-time ref), plus `setOverload(false)` on refusal as a delivery-order belt-and-suspenders (a genuinely latched engine re-asserts on the next tick). The precedence contract — latch re-asserts after the refusal window if still latched — is pinned by an updated test that models the real 4 Hz re-assert stream.

---
```

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): overload indicator consistency entry (hash backfill at merge)"
```

- [ ] **Step 6: Hand off to the user feel test (L-033 — USER launches the build)**

Report the full verification evidence (suite counts, golden stability, build status) and ask the user to run the feel pass from the spec §4:

- cap 1000 + continuous 2000/s → chip visible before any spawn attempt, glyph lit, Shift-click refusal → **no latch flash at the 5 s fade**;
- cap 1000 + effect ≈ 600 → first placement OK, chip flips to the prospective copy, second placement refused as foreshadowed;
- raising the cap clears chip + glyph live; guard off → chip gone, glyph at 10k;
- estimate-undercount chain → runtime latch banner still appears after the refusal window.

PR against `master` only after the feel pass + explicit user OK.

---

## Self-review notes

- **Spec coverage:** Part 1 → Tasks 1+3; Part 2 (hook) → Task 2; Part 2 (chip) → Tasks 4+5; Part 3 → Task 6; spec §4 gates + feel list → Task 7. Spec risks: 1 (feel-test item, Task 7 step 6), 2 (accepted, chip test "clears when instances drop"), 3 (Task 1 above-default test + CHANGELOG note), 4 (Task 6 step 1 precedence update), 5 (Task 5 no-chip-at-defaults test + Task 7 step 2 golden gate), 6 (constant exported from the lib, Task 2).
- **Type consistency:** `useOverloadGuardConfig(): OverloadGuardConfig`, `estimateChainLoad(root, threshold?: number)`, `SystemLoadChip({ bridge, systemLoad })`, `shownRefusal: RefusalState | null` — names match across tasks.
- **Known intentional choices:** duplicate `estimateSystemLoad` walk in EmitterTree vs `useEstimatedLoadPush` (O(nodes), cheaper than widening the hook signature — noted in code comment); chip styling feel-tunable (band + normal text per the #121 contrast lesson).
