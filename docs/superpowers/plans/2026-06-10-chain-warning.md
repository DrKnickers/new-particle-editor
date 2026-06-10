# NT-11 Soft Chain Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A non-blocking amber ⚠ glyph on emitter-tree rows whose chain's estimated alive-particle count exceeds 10,000, with a per-generation breakdown tooltip.

**Architecture:** The host mirrors six spawn fields it already has onto every `EmitterTreeNode` (`spawn` sub-object); one pure TS function `estimateChainLoad()` walks the tree React already holds and returns a stableId→warning map; `EmitterTree.tsx` renders the glyph. No new events: `emitters/set-properties` already re-emits `emitters/tree/changed` ([BridgeDispatcher.cpp:3113](../../../src/host/BridgeDispatcher.cpp)), so param edits refresh the glyph for free.

**Tech Stack:** TypeScript (bridge-schema + React 18 + vitest), C++ (nlohmann::json in BridgeDispatcher), Playwright native harness.

**Spec:** [docs/superpowers/specs/2026-06-10-chain-warning-design.md](../specs/2026-06-10-chain-warning-design.md) — all sections user-approved.

**Repo conventions that govern this work:**
- Build host via PowerShell, never Git-Bash (L-046): `& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" ParticleEditor.sln /p:Configuration=Debug /p:Platform=x64 /m`
- Never run `vitest` and `vite build` concurrently (L-046).
- Web commands run from `web/`: `pnpm --filter @particle-editor/editor test`, `pnpm --filter @particle-editor/editor exec tsc -b`.
- Native harness: `node apps\editor\scripts\run-native-tests.mjs` from `web/` (needs Debug x64 exe + `pnpm build` dist).
- Feel/UI verification builds are launched by the USER, not the agent (L-033).
- Baseline at plan time: web 643/643, tsc 0, native 174/0, host Debug x64 clean (benign LNK4098).

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `web/packages/bridge-schema/src/index.ts` | Modify | `SpawnParamsDto`, `ZERO_SPAWN`, `spawn` on `EmitterTreeNode` |
| `web/apps/editor/src/lib/chain-load.ts` | Create | The formula: `estimatePerEmitter`, `estimateChainLoad`, `formatChainWarning`, `CHAIN_WARN_THRESHOLD` |
| `web/apps/editor/src/lib/__tests__/chain-load.test.ts` | Create | Formula unit suite |
| `web/apps/editor/src/bridge/mock-state.ts` | Modify | Tree-node literals gain `spawn: ZERO_SPAWN` (type satisfaction only) |
| `web/apps/editor/src/bridge/mock.ts` | Modify | Central spawn decoration (emit() + `emitters/list`) reading the properties overlay |
| `web/apps/editor/src/bridge/__tests__/bridge-contract.test.ts` | Modify | Spawn presence + set-properties reflection |
| `src/host/BridgeDispatcher.cpp` | Modify | `BuildEmitterTreeNode` (:535-543) + two synthetic roots (:2540, :2574) emit `spawn` |
| `web/apps/editor/src/screens/EmitterTree.tsx` | Modify | `chainWarnings` useMemo, `chainWarning` row prop, glyph render |
| `web/apps/editor/src/screens/__tests__/EmitterTree.test.tsx` | Modify | Glyph appears/absent component tests |
| `web/apps/editor/tests/emitter-tree.spec.ts` | Modify | Native spec: `emitters/list` carries `spawn` |
| `ROADMAP.md`, `CHANGELOG.md`, `tasks/HANDOFF.md` | Modify | Ship bookkeeping (final task) |
| various test fixtures (12 files, ~58 node literals) | Modify | `spawn: ZERO_SPAWN` sweep where TS demands it |

---

### Task 1: Schema — `spawn` on the tree DTO

**Files:**
- Modify: `web/packages/bridge-schema/src/index.ts` (EmitterTreeNode at :140; doc comment block at :120-137)
- Modify: every file `tsc` flags after the change. Known literal sites (from `role: "(root|lifetime|death)"` grep): `mock-state.ts` (11), `bridge-contract.test.ts` (4), `EmitterTree.test.tsx` (14), `EmitterTree.multidrag.test.tsx` (11), `SetLinkGroupDialog.test.tsx` (6), `multi-drag.test.ts` (5), `reorder-many-roots.test.ts` (2), `delete-emitters.test.ts`, `emitter-reorder.test.ts`, `emitter-tree.test.ts`, `ImportEmittersDialog.test.tsx` (1 each), `emitter-multi-mutations.spec.ts` (1).

- [ ] **Step 1: Add the types to bridge-schema**

In `web/packages/bridge-schema/src/index.ts`, directly above `export type EmitterTreeNode` (:140), add:

```ts
// Spawn-quantity params mirrored onto every tree node (NT-11 chain-load
// warning). Field names match EmitterPropertiesDto exactly so the host and
// the mock copy them verbatim; the consumer is estimateChainLoad() in
// web/apps/editor/src/lib/chain-load.ts.
export type SpawnParamsDto = Pick<
  EmitterPropertiesDto,
  | "lifetime"
  | "useBursts"
  | "nBursts"
  | "burstDelay"
  | "nParticlesPerSecond"
  | "nParticlesPerBurst"
>;

// All-zero spawn for synthetic roots and test fixtures that don't care
// about chain-load (estimate = 0 → never warns).
export const ZERO_SPAWN: SpawnParamsDto = {
  lifetime: 0,
  useBursts: false,
  nBursts: 0,
  burstDelay: 0,
  nParticlesPerSecond: 0,
  nParticlesPerBurst: 0,
};
```

Then add the field to `EmitterTreeNode` after `visible: boolean;` (:152):

```ts
  spawn: SpawnParamsDto;
```

(`Pick` of `EmitterPropertiesDto` defined later in the file is fine — type declarations hoist.)

- [ ] **Step 2: Enumerate the breakage**

Run from `web/`: `pnpm --filter @particle-editor/editor exec tsc -b`
Expected: FAIL with "Property 'spawn' is missing" errors at the fixture sites listed above.

- [ ] **Step 3: Sweep the fixtures**

In every flagged file, import `ZERO_SPAWN` from `@particle-editor/bridge-schema` and add `spawn: ZERO_SPAWN,` to each flagged node literal. Do NOT invent per-fixture values — the decoration in Task 3 overrides mock values at emit time, and lib-test fixtures don't exercise spawn. In `mock-state.ts`, also check the structural-clone helpers around :326, :339, :421, :433 — those that spread `...n` need no change; any that construct nodes field-by-field get `spawn: n.spawn`.

- [ ] **Step 4: Verify green**

Run from `web/`: `pnpm --filter @particle-editor/editor exec tsc -b` → exit 0,
then `pnpm --filter @particle-editor/editor test` → 643 passed (no behavior change yet).

- [ ] **Step 5: Commit**

```bash
git add web/packages/bridge-schema/src/index.ts web/apps/editor/src web/apps/editor/tests
git commit -m "feat(bridge-schema): spawn params on EmitterTreeNode (NT-11)"
```

---

### Task 2: `chain-load.ts` — the formula (TDD)

**Files:**
- Create: `web/apps/editor/src/lib/chain-load.ts`
- Create: `web/apps/editor/src/lib/__tests__/chain-load.test.ts`

- [ ] **Step 1: Write the failing test suite**

`web/apps/editor/src/lib/__tests__/chain-load.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { EmitterTreeNode, SpawnParamsDto } from "@particle-editor/bridge-schema";
import { ZERO_SPAWN } from "@particle-editor/bridge-schema";
import {
  CHAIN_WARN_THRESHOLD,
  estimateChainLoad,
  estimatePerEmitter,
  formatChainWarning,
} from "../chain-load";

const spawn = (s: Partial<SpawnParamsDto>): SpawnParamsDto => ({ ...ZERO_SPAWN, ...s });

let nextStable = 1;
const node = (
  name: string,
  s: Partial<SpawnParamsDto>,
  children: EmitterTreeNode[] = [],
  role: EmitterTreeNode["role"] = "root",
): EmitterTreeNode => ({
  id: nextStable, stableId: nextStable++, name, role,
  linkGroup: 0, visible: true, spawn: spawn(s), children,
});

const syntheticRoot = (children: EmitterTreeNode[]): EmitterTreeNode => ({
  id: -1, stableId: 0, name: "", role: "root",
  linkGroup: 0, visible: true, spawn: ZERO_SPAWN, children,
});

describe("estimatePerEmitter", () => {
  it("continuous: rate × lifetime", () => {
    expect(estimatePerEmitter(spawn({ nParticlesPerSecond: 12, lifetime: 1.5 }))).toBe(18);
  });
  it("burst: particlesPerBurst × concurrent bursts, capped by nBursts", () => {
    // lifetime 3s / delay 1s → floor(3)+1 = 4 concurrent, capped at nBursts=2
    expect(estimatePerEmitter(spawn({
      useBursts: true, nParticlesPerBurst: 10, nBursts: 2, burstDelay: 1, lifetime: 3,
    }))).toBe(20);
  });
  it("burst: nBursts=0 means infinite (no cap)", () => {
    expect(estimatePerEmitter(spawn({
      useBursts: true, nParticlesPerBurst: 10, nBursts: 0, burstDelay: 1, lifetime: 3,
    }))).toBe(40);
  });
  it("burst: burstDelay=0 degenerates to per-burst × nBursts", () => {
    expect(estimatePerEmitter(spawn({
      useBursts: true, nParticlesPerBurst: 7, nBursts: 5, burstDelay: 0, lifetime: 1,
    }))).toBe(35);
  });
  it("burst: infinite bursts at zero delay clamps finite (no Infinity/NaN)", () => {
    const e = estimatePerEmitter(spawn({
      useBursts: true, nParticlesPerBurst: 1, nBursts: 0, burstDelay: 0, lifetime: 1,
    }));
    expect(Number.isFinite(e)).toBe(true);
    expect(e).toBeGreaterThan(CHAIN_WARN_THRESHOLD);
  });
  it("zero-rate emitter estimates 0", () => {
    expect(estimatePerEmitter(ZERO_SPAWN)).toBe(0);
  });
});

describe("estimateChainLoad", () => {
  it("vanilla-scale tree produces no warnings", () => {
    const tree = syntheticRoot([
      node("smoke", { nParticlesPerSecond: 10, lifetime: 2 }, [
        node("embers", { nParticlesPerSecond: 5, lifetime: 1 }, [], "lifetime"),
      ]),
    ]);
    expect(estimateChainLoad(tree).size).toBe(0);
  });
  it("depth-3 product crossing the threshold marks the whole path", () => {
    // 18 × 30 × 40 = 21,600 > 10,000
    const leaf = node("smoke", { nParticlesPerSecond: 40, lifetime: 1 }, [], "death");
    const mid = node("highlight", { nParticlesPerSecond: 30, lifetime: 1 }, [leaf], "lifetime");
    const root = node("sparkle", { nParticlesPerSecond: 12, lifetime: 1.5 }, [mid]);
    const warnings = estimateChainLoad(syntheticRoot([root]));
    expect(warnings.size).toBe(3);
    for (const n of [root, mid, leaf]) {
      expect(warnings.get(n.stableId)?.estimate).toBeCloseTo(21_600);
    }
    expect(warnings.get(root.stableId)?.path.map((p) => p.name))
      .toEqual(["sparkle", "highlight", "smoke"]);
  });
  it("a sibling on a sane branch stays unmarked", () => {
    const bomb = node("bomb", { nParticlesPerSecond: 200, lifetime: 100 }, [], "lifetime"); // 20,000
    const calm = node("calm", { nParticlesPerSecond: 1, lifetime: 1 }, [], "death");
    const root = node("base", { nParticlesPerSecond: 10, lifetime: 1 }, [bomb, calm]);
    const warnings = estimateChainLoad(syntheticRoot([root]));
    expect(warnings.has(bomb.stableId)).toBe(true);
    expect(warnings.has(root.stableId)).toBe(true);
    expect(warnings.has(calm.stableId)).toBe(false);
  });
  it("an ancestor shared by two offending paths reports the WORST estimate", () => {
    const worse = node("worse", { nParticlesPerSecond: 5000, lifetime: 1 }, [], "lifetime"); // 50,000
    const bad = node("bad", { nParticlesPerSecond: 2000, lifetime: 1 }, [], "death");        // 20,000
    const root = node("base", { nParticlesPerSecond: 10, lifetime: 1 }, [worse, bad]);
    const warnings = estimateChainLoad(syntheticRoot([root]));
    expect(warnings.get(root.stableId)?.estimate).toBeCloseTo(50_000);
  });
  it("a zero-rate link breaks the chain (downstream estimates 0, no warning)", () => {
    const leaf = node("leaf", { nParticlesPerSecond: 1e9, lifetime: 10 }, [], "death");
    const dead = node("dead", {}, [leaf], "lifetime"); // E = 0
    const root = node("base", { nParticlesPerSecond: 100, lifetime: 10 }, [dead]);
    expect(estimateChainLoad(syntheticRoot([root])).size).toBe(0);
  });
  it("single emitter over threshold warns alone (chain of one)", () => {
    const solo = node("solo", { nParticlesPerSecond: 20_000, lifetime: 1 });
    const warnings = estimateChainLoad(syntheticRoot([solo]));
    expect(warnings.size).toBe(1);
    expect(warnings.get(solo.stableId)?.estimate).toBe(20_000);
  });
  it("never emits Infinity or NaN even on degenerate inputs", () => {
    const degenerate = node("degen", { useBursts: true, nParticlesPerBurst: 1, nBursts: 0, burstDelay: 0 });
    const warnings = estimateChainLoad(syntheticRoot([degenerate]));
    const w = warnings.get(degenerate.stableId);
    expect(w).toBeDefined();
    expect(Number.isFinite(w!.estimate)).toBe(true);
  });
});

describe("formatChainWarning", () => {
  it("renders header + one line per generation with running product", () => {
    const leaf = node("smoke", { nParticlesPerSecond: 40, lifetime: 1 }, [], "death");
    const root = node("sparkle", { nParticlesPerSecond: 500, lifetime: 1 }, [leaf]);
    const w = estimateChainLoad(syntheticRoot([root])).get(root.stableId)!;
    const text = formatChainWarning(w);
    expect(text).toContain("20,000");
    expect(text.split("\n")).toHaveLength(3); // header + 2 generations
    expect(text).toContain("sparkle");
    expect(text).toContain("→ smoke");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

From `web/`: `pnpm --filter @particle-editor/editor test -- chain-load`
Expected: FAIL — `Cannot find module '../chain-load'`.

- [ ] **Step 3: Implement `chain-load.ts`**

```ts
import type { EmitterTreeNode, SpawnParamsDto } from "@particle-editor/bridge-schema";

// NT-11 soft chain warning. Advisory only — nothing in the editor blocks
// on this. Spec: docs/superpowers/specs/2026-06-10-chain-warning-design.md.

// Vanilla effects run tens-to-hundreds alive; the v1 chain-test bomb was
// millions. 10k flags genuinely explosive chains without nagging
// legitimate dense effects.
export const CHAIN_WARN_THRESHOLD = 10_000;

// Degenerate infinite-bursts-at-zero-delay is unbounded; clamp so the
// tooltip never shows Infinity/NaN. Far above the threshold, so the
// warning still fires.
const DEGENERATE_CAP = 1_000_000_000;

// Steady-state alive-particle estimate for ONE emitter (Little's law).
// Continuous: rate × lifetime. Burst: particles-per-burst × the number of
// bursts whose particles coexist (lifetime / burstDelay, capped by
// nBursts; nBursts === 0 means infinite).
export function estimatePerEmitter(s: SpawnParamsDto): number {
  if (!s.useBursts) return s.nParticlesPerSecond * s.lifetime;
  const infinite = s.nBursts === 0;
  if (s.burstDelay <= 0) {
    if (infinite) return s.nParticlesPerBurst > 0 ? DEGENERATE_CAP : 0;
    return s.nParticlesPerBurst * s.nBursts;
  }
  const concurrent = Math.floor(s.lifetime / s.burstDelay) + 1;
  const bursts = infinite ? concurrent : Math.min(concurrent, s.nBursts);
  return s.nParticlesPerBurst * Math.max(1, bursts);
}

export type ChainWarning = {
  // Worst cumulative estimate among offending paths through this row.
  estimate: number;
  // Root→offender breakdown for the tooltip, one entry per generation.
  path: Array<{ name: string; perEmitter: number; cumulative: number }>;
};

// Walks the tree (synthetic root excluded) and returns stableId →
// ChainWarning for every row on a root→node path whose cumulative estimate
// crosses CHAIN_WARN_THRESHOLD. A(child) = A(parent) × E(child): every
// alive parent particle hosts one child-emitter instance. Life and death
// children deliberately share the rule — documented approximation, see
// spec §1.
export function estimateChainLoad(root: EmitterTreeNode): Map<number, ChainWarning> {
  const out = new Map<number, ChainWarning>();
  type TrailEntry = { stableId: number; name: string; perEmitter: number; cumulative: number };
  const visit = (node: EmitterTreeNode, parentCumulative: number, trail: TrailEntry[]): void => {
    const perEmitter = estimatePerEmitter(node.spawn);
    const cumulative = parentCumulative * perEmitter;
    const path = [...trail, { stableId: node.stableId, name: node.name, perEmitter, cumulative }];
    if (cumulative > CHAIN_WARN_THRESHOLD) {
      for (const entry of path) {
        const prev = out.get(entry.stableId);
        if (prev === undefined || cumulative > prev.estimate) {
          out.set(entry.stableId, {
            estimate: cumulative,
            path: path.map(({ name, perEmitter: e, cumulative: a }) => ({
              name, perEmitter: e, cumulative: a,
            })),
          });
        }
      }
    }
    node.children.forEach((c) => visit(c, cumulative, path));
  };
  root.children.forEach((c) => visit(c, 1, []));
  return out;
}

// Multi-line tooltip body (the native `title` attribute renders \n as
// line breaks).
export function formatChainWarning(w: ChainWarning): string {
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
  const lines = w.path.map((p, i) =>
    i === 0
      ? `${p.name}: ~${fmt(p.perEmitter)} alive`
      : `→ ${p.name}: ×${fmt(p.perEmitter)} → ~${fmt(p.cumulative)}`,
  );
  return [
    `Soft warning: ~${fmt(w.estimate)} particles estimated alive through this chain`,
    ...lines,
  ].join("\n");
}
```

- [ ] **Step 4: Run to verify green**

From `web/`: `pnpm --filter @particle-editor/editor test -- chain-load`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add web/apps/editor/src/lib/chain-load.ts web/apps/editor/src/lib/__tests__/chain-load.test.ts
git commit -m "feat(web): chain-load estimator for the NT-11 soft warning"
```

---

### Task 3: Mock parity — spawn decoration from the properties overlay

The mock's tree literals carry `ZERO_SPAWN`; live values come from ONE
decoration point so `set-properties` patches are reflected automatically
(no formula duplication, no per-handler edits across the 35
`tree/changed` emit sites).

**Files:**
- Modify: `web/apps/editor/src/bridge/mock.ts` (`emit()` at :219, `case "emitters/list"` at :911)
- Modify: `web/apps/editor/src/bridge/__tests__/bridge-contract.test.ts`

- [ ] **Step 1: Write the failing contract tests**

Add to `bridge-contract.test.ts`, following the file's existing setup conventions (mock construction, request helper):

```ts
describe("emitter tree spawn params (NT-11)", () => {
  it("emitters/list nodes mirror the properties overlay's spawn fields", async () => {
    const tree = await bridge.request({ kind: "emitters/list", params: {} });
    const first = tree.root.children[0];
    const { properties } = await bridge.request({
      kind: "emitters/get-properties", params: { id: first.id },
    });
    expect(first.spawn).toEqual({
      lifetime: properties.lifetime,
      useBursts: properties.useBursts,
      nBursts: properties.nBursts,
      burstDelay: properties.burstDelay,
      nParticlesPerSecond: properties.nParticlesPerSecond,
      nParticlesPerBurst: properties.nParticlesPerBurst,
    });
  });

  it("a set-properties spawn patch is reflected in the next tree/changed payload", async () => {
    const events: EmitterTreeDto[] = [];
    const off = bridge.on("emitters/tree/changed", (e) => events.push(e.payload));
    await bridge.request({
      kind: "emitters/set-properties",
      params: { id: 0, patch: { nParticlesPerSecond: 4242 } },
    });
    off();
    expect(events.length).toBeGreaterThan(0);
    const node = events.at(-1)!.root.children.find((n) => n.id === 0);
    expect(node?.spawn.nParticlesPerSecond).toBe(4242);
  });
});
```

- [ ] **Step 2: Run to verify failure**

From `web/`: `pnpm --filter @particle-editor/editor test -- bridge-contract`
Expected: FAIL — `spawn` is `ZERO_SPAWN` (literals), not the overlay values.

- [ ] **Step 3: Implement the decoration**

In `mock.ts`, add near the internals section:

```ts
// NT-11: live spawn values come from the properties overlay at emit time —
// ONE decoration point instead of mirroring into the tree store from every
// mutation handler. Tree-node literals carry ZERO_SPAWN purely to satisfy
// the type; this override is the source of truth.
function pickSpawn(id: number): SpawnParamsDto {
  const p = useMockEmitterProperties.getState().read(id);
  return {
    lifetime: p.lifetime,
    useBursts: p.useBursts,
    nBursts: p.nBursts,
    burstDelay: p.burstDelay,
    nParticlesPerSecond: p.nParticlesPerSecond,
    nParticlesPerBurst: p.nParticlesPerBurst,
  };
}

function decorateSpawn(node: EmitterTreeNode): EmitterTreeNode {
  return { ...node, spawn: pickSpawn(node.id), children: node.children.map(decorateSpawn) };
}
```

Change `emit()` (:219) to intercept tree payloads:

```ts
private emit(e: Event): void {
  if (e.kind === "emitters/tree/changed") {
    e = { ...e, payload: { root: decorateSpawn(e.payload.root) } };
  }
  const bucket = this.listeners.get(e.kind);
  bucket?.forEach((h) => h(e));
}
```

Change `case "emitters/list"` (:911):

```ts
case "emitters/list": {
  const cloned = JSON.parse(JSON.stringify(useMockEmitterTree.getState().tree)) as EmitterTreeDto;
  return { root: decorateSpawn(cloned.root) };
}
```

Import `SpawnParamsDto` (type) where needed.

- [ ] **Step 4: Run to verify green + no regressions**

From `web/`: `pnpm --filter @particle-editor/editor test`
Expected: full suite PASS (643 + Task 2/3 additions).

- [ ] **Step 5: Commit**

```bash
git add web/apps/editor/src/bridge
git commit -m "feat(mock): decorate tree nodes with live spawn params (NT-11 parity)"
```

---

### Task 4: Host — serialize `spawn` in the tree builder

**Files:**
- Modify: `src/host/BridgeDispatcher.cpp` — `BuildEmitterTreeNode` return (:535-543), synthetic roots (:2540-2548 and :2574-2582)

- [ ] **Step 1: Extend `BuildEmitterTreeNode`**

In the returned json (:535), add after `{"visible", emit.visible},`:

```cpp
        // NT-11 chain-load warning: spawn-quantity params mirrored onto
        // every tree node so the React side can estimate per-chain alive
        // counts without N get-properties round-trips. Field names match
        // EmitterPropertiesDto / SpawnParamsDto in bridge-schema.
        {"spawn", json{
            {"lifetime",            emit.lifetime},
            {"useBursts",           emit.useBursts},
            {"nBursts",             static_cast<unsigned int>(emit.nBursts)},
            {"burstDelay",          emit.burstDelay},
            {"nParticlesPerSecond", static_cast<unsigned int>(emit.nParticlesPerSecond)},
            {"nParticlesPerBurst",  static_cast<unsigned int>(emit.nParticlesPerBurst)},
        }},
```

- [ ] **Step 2: Extend BOTH synthetic roots**

At :2540 and :2574, add to each synthetic-root json (after `{"visible", true},`):

```cpp
            {"spawn", json{
                {"lifetime", 0.0}, {"useBursts", false}, {"nBursts", 0},
                {"burstDelay", 0.0}, {"nParticlesPerSecond", 0}, {"nParticlesPerBurst", 0},
            }},
```

- [ ] **Step 3: Build Debug x64**

PowerShell: `& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" ParticleEditor.sln /p:Configuration=Debug /p:Platform=x64 /m`
Expected: clean (benign LNK4098 only).

- [ ] **Step 4: Commit**

```bash
git add src/host/BridgeDispatcher.cpp
git commit -m "feat(host): emit spawn params on emitter tree nodes (NT-11)"
```

---

### Task 5: UI — warning glyph in `EmitterTree.tsx` (TDD)

**Files:**
- Modify: `web/apps/editor/src/screens/EmitterTree.tsx` (RowProps :310, EmitterRow :400, grid :713, link-dot block ends :835, parent tree state :1207)
- Modify: `web/apps/editor/src/screens/__tests__/EmitterTree.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Add to `EmitterTree.test.tsx`, mirroring the file's existing render/setup helpers and mock-reset hygiene (read 2-3 existing tests first and copy their setup exactly):

```tsx
describe("chain-load warning glyph (NT-11)", () => {
  it("renders no glyph at fixture-default spawn values", async () => {
    renderTree(); // the file's existing helper
    expect(await screen.findByText("Smoke")).toBeInTheDocument();
    expect(screen.queryByTestId(/emitter-chain-warning-/)).toBeNull();
  });

  it("shows the glyph with a breakdown tooltip when an emitter crosses the threshold", async () => {
    // Smoke is id 0 in the mock fixture; 20,000 × 1s = 20,000 > 10,000.
    useMockEmitterProperties.getState().patch(0, { nParticlesPerSecond: 20_000, lifetime: 1 });
    renderTree();
    const glyph = await screen.findByTestId("emitter-chain-warning-0");
    expect(glyph.getAttribute("title")).toContain("20,000");
    expect(glyph.getAttribute("title")).toContain("Soft warning");
  });
});
```

(If `queryByTestId` with a regex isn't supported by the version in use, use `screen.queryAllByTestId(/.../) → length 0` or query by title text — match the file's idioms.)

- [ ] **Step 2: Run to verify failure**

From `web/`: `pnpm --filter @particle-editor/editor test -- EmitterTree.test`
Expected: new tests FAIL (no glyph rendered); existing tests PASS.

- [ ] **Step 3: Implement**

(a) Parent component (near `setTree` usage, :1207): the tree lives in `useEmitterTreeStore`. Add:

```tsx
const tree = useEmitterTreeStore((s) => s.tree);
const chainWarnings = useMemo(
  () => (tree !== null ? estimateChainLoad(tree.root) : new Map<number, ChainWarning>()),
  [tree],
);
```

(If the parent doesn't already select `tree` from the store, add the selector; if it does, reuse it.)

(b) `RowProps` (:310) gains:

```ts
  // NT-11: non-null when this row sits on a chain whose estimated alive
  // count crosses CHAIN_WARN_THRESHOLD. Advisory only.
  chainWarning: ChainWarning | null;
```

Pass at every `<EmitterRow …>` render site: `chainWarning={chainWarnings.get(row.node.stableId) ?? null}`.

(c) In `EmitterRow`, destructure `chainWarning`. Make the grid template conditional (:713):

```tsx
gridTemplateColumns: chainWarning !== null
  ? "18px 18px 10px 1fr 16px"
  : "18px 18px 10px 1fr",
```

(d) Render the glyph LAST in DOM (after the link-dot block ending :835), placed visually in column 5 — same DOM-order-vs-grid-placement convention as the role glyph, so warned rows append "…chain load warning" to the accessible name and unwarned rows are byte-identical to today (a11y goldens unaffected):

```tsx
{chainWarning !== null && (
  <span
    style={{ gridColumn: 5, gridRow: 1 }}
    data-testid={`emitter-chain-warning-${node.id}`}
    title={formatChainWarning(chainWarning)}
    aria-label={`Chain load warning: about ${Math.round(chainWarning.estimate).toLocaleString("en-US")} particles estimated alive`}
    className="grid place-items-center w-4 h-4 shrink-0 justify-self-center text-amber-400"
  >
    <TriangleAlert className="size-3" />
  </span>
)}
```

Imports: `TriangleAlert` from `lucide-react` (the file already imports `Eye`/`EyeOff` from there); `estimateChainLoad`, `formatChainWarning`, type `ChainWarning` from `../lib/chain-load`; `useMemo` from react if not present.

- [ ] **Step 4: Run to verify green + full suite**

From `web/`: `pnpm --filter @particle-editor/editor test` → all PASS.
Then `pnpm --filter @particle-editor/editor exec tsc -b` → 0.

- [ ] **Step 5: Commit**

```bash
git add web/apps/editor/src/screens
git commit -m "feat(web): chain-load warning glyph on emitter tree rows (NT-11)"
```

---

### Task 6: Native harness spec — host serializes spawn

**Files:**
- Modify: `web/apps/editor/tests/emitter-tree.spec.ts`

- [ ] **Step 1: Add the spec**

Mirror the file's existing bridge-request pattern (read how neighbouring tests call `window.bridge`/the harness page helper, copy it):

```ts
test("emitters/list nodes carry spawn params (NT-11)", async ({ page }) => {
  const tree = await page.evaluate(() =>
    (window as any).bridge.request({ kind: "emitters/list", params: {} }),
  );
  const first = tree.root.children[0];
  expect(first).toBeDefined();
  expect(first.spawn).toMatchObject({
    lifetime: expect.any(Number),
    useBursts: expect.any(Boolean),
    nBursts: expect.any(Number),
    burstDelay: expect.any(Number),
    nParticlesPerSecond: expect.any(Number),
    nParticlesPerBurst: expect.any(Number),
  });
});
```

- [ ] **Step 2: Rebuild prerequisites + run the harness**

From `web/`: `pnpm --filter @particle-editor/editor build` (the harness serves `dist`; never concurrent with vitest), confirm the Debug x64 exe from Task 4 is current, then `node apps\editor\scripts\run-native-tests.mjs`.
Expected: 175 passed (174 + this one), 0 failed, zero a11y-golden diffs.

- [ ] **Step 3: Commit**

```bash
git add web/apps/editor/tests/emitter-tree.spec.ts
git commit -m "test(native): emitters/list carries spawn params (NT-11)"
```

---

### Task 7: Full verification + user feel pass

- [ ] **Step 1: Full suites** (sequentially, from `web/`)

1. `pnpm --filter @particle-editor/editor test` → all pass (expect 643 + ~12 new)
2. `pnpm --filter @particle-editor/editor exec tsc -b` → 0
3. `pnpm --filter @particle-editor/editor build` → clean
4. Host Debug **and** Release x64 via MSBuild → clean
5. `node apps\editor\scripts\run-native-tests.mjs` → 175/0

- [ ] **Step 2: User manual pass (L-033 — user launches)**

Hand the user this checklist:
- Open a real `.alo` with children (e.g. one of the 21 link users) → no glyphs at vanilla values.
- Crank a child's Particles/sec until rate × lifetime products cross 10k → amber ⚠ appears on the whole chain within one edit.
- Hover the glyph → tooltip shows total + per-generation lines, numbers read sensibly.
- Lower the rate back → glyph disappears.
- Confirm nothing blocks: save, undo, reparent all behave normally with the glyph showing.

- [ ] **Step 3: Record results in `tasks/todo.md` review section**

---

### Task 8: Ship bookkeeping + PR

**Files:**
- Modify: `ROADMAP.md`, `CHANGELOG.md`, `tasks/HANDOFF.md`, `tasks/todo.md`

- [ ] **Step 1: ROADMAP** — all five ship steps: strikethrough `1.1 [NT-11]` + `✅ Shipped (#NN)`, add *Actual:* line, move to Shipped §5 as 5.1 (shift the rest down), renumber §1 (Near term becomes empty or renumbers), vacate the NT-11 tag permanently.

- [ ] **Step 2: CHANGELOG** — new top entry per the header conventions (date line `*YYYY-MM-DD · hash-TODO · #NN-TODO*`, backfill after merge): what ships / how we tackled it (web-side formula + DTO widening + emit-time mock decoration as the architectural choice) / issues encountered.

- [ ] **Step 3: PR against `master`**

```bash
git push -u origin HEAD
gh pr create --base master --title "feat(new-ui): soft chain-load warning on the emitter tree (NT-11)" --body-file <tempfile>
```

(PowerShell quoting: use `--body-file`, never inline quotes — see project memory.)
Merge **only with explicit user OK** after CI is green. Backfill the CHANGELOG hash/PR number after merge.

---

## Self-review notes

- Spec coverage: §1 formula → Task 2; §2 DTO+flow → Tasks 1, 3, 4; §3 UI → Task 5; §4 testing → Tasks 2, 3, 5, 6, 7; shipping → Task 8. The "refresh on param edit" requirement needs no task — `set-properties` already emits `tree/changed` (host :3113, mock :774-777); the contract test in Task 3 pins it.
- Type consistency: `SpawnParamsDto` field names match `EmitterPropertiesDto` exactly (verified against index.ts:423-429); `ChainWarning`/`estimateChainLoad`/`formatChainWarning` names consistent across Tasks 2 and 5.
- Known judgment calls for the executor: test-file idioms (render helpers, regex testid queries) must mirror what's in each file — the snippets show intent, the file shows the house style.
