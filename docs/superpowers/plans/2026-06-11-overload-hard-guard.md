# Overload Hard-Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **L-081 applies:** one tree-touching agent at a time; reviewers read-and-run-tests only.

**Goal:** Preemptive overload gate — refuse to place a preview instance (Shift-click or spawner) when *(placed + 1) × estimated alive-particles* exceeds the guard cap, clear the preview on refusal, also clear when a parameter edit pushes *placed × estimate* over the cap, and surface a transient explanatory banner — while keeping the existing runtime suppress/decay budget as the backstop.

**Architecture:** Host enforces, web supplies the estimate. The web computes `estimateSystemLoad` (new sum-over-nodes helper in `chain-load.ts` — same walk/Little's-law estimator as the ⚠ glyph) and pushes it via a new `engine/set/estimated-load` command on every change. The engine gates inside the single `SpawnParticleSystem` choke point and re-checks on every estimate push; refusals are a one-shot record polled by the dispatcher's 4 Hz stats path and emitted as `engine/overload/refused`, which drives a transient (~5 s) variant of the existing OverloadBanner.

**Tech Stack:** C++ (engine + host dispatcher), TypeScript/React (schema, mock, push hook, banner), Playwright native harness specs.

**Spec:** [`docs/superpowers/specs/2026-06-11-overload-hard-guard-design.md`](../specs/2026-06-11-overload-hard-guard-design.md)

**Verified code facts** (re-verify if the tree moved past `e8c1a14`):
- `Engine::SpawnParticleSystem` (engine.cpp:190) is 4 lines — unconditional `make_unique` + `push_back` + return; it **never returns null today**, so after this plan a `nullptr` return ⟺ gate refusal, unambiguous.
- All three placement paths call it: `SpawnerDriver.cpp:190` (already null-checks `inst != NULL` around `MarkSpawnerOwned/SetMaxLifetime/Detach`), `HostWindow.cpp:2784` and `:3032` (both assign straight into `m_attachedParticleSystem`; the codebase already tolerates a null attached pointer — guards like `if (m_ppAttachedParticleSystem && *m_ppAttachedParticleSystem)` exist — but Task 3 verifies every deref).
- Guard runtime state: `m_overloadGuardEnabled` / `m_maxPreviewParticles` (engine.h:573-574), setter `Engine::SetOverloadGuard` (engine.cpp:232). Placed-instance count: `GetNumInstances()` (engine.h:371). `Engine::Clear()` exists (used by `file/new`).
- Dispatcher: `engine/set/overload-guard` handler at BridgeDispatcher.cpp:1462 with cache fields `m_overloadGuardCached/Enabled/MaxParticles` reapplied in `SetEngine` (:765-774) — the estimate clone follows this exactly. 4 Hz stats emission: `BridgeDispatcher::EmitStatsTick` (:5321) — the refusal poll goes in its caller (find the call site; it runs on the 4 Hz cadence).
- Schema: command union at `web/packages/bridge-schema/src/index.ts:607` (overload-guard), response map `:1002`, event union `:1129` (`stats/tick`).
- Mock: `mock.ts:87` lists `engine/set/overload-guard` as non-persisted (`return false`), handled in the switch at `:411` — clone both for `estimated-load`.
- Estimator: `chain-load.ts` — `estimatePerEmitter(spawn)` + the `estimateChainLoad` walk (cumulative = parentCumulative × perEmitter, roots start at 1). The system total = Σ over EVERY node of its cumulative. `fmtCount` exported for banner copy.
- Push site: `EmitterTree.tsx:1276` already memoizes `estimateChainLoad(tree.root)` per tree update — the push hook hangs off the same `tree` state.
- Banner: `OverloadBanner.tsx` — `usePresence` + `useViewportOcclusion(bridge, "banner:preview-overload", ref, 12, 12, true)`, `EXIT_MS = 150`, body component + a `stats/tick` listener in the exported `OverloadBanner({ bridge })`.
- Harness: overload specs in `web/apps/editor/tests/preview-overload.spec.ts` pin caps LOW per #134 (bombs at 1k). New specs MUST follow that rule (≤2k everywhere).

---

### Task 1: Web pure — `estimateSystemLoad`

**Files:**
- Modify: `web/apps/editor/src/lib/chain-load.ts`
- Test: `web/apps/editor/src/lib/__tests__/chain-load.test.ts` (exists — extend)

- [ ] **Step 1: Failing tests** (match the file's existing fixture idioms — it has `EmitterTreeNode` builders for the chain-warning tests; reuse them):

```ts
describe("estimateSystemLoad", () => {
  it("empty tree → 0", () => {
    expect(estimateSystemLoad(rootWith([]))).toBe(0);
  });
  it("single root = its own per-emitter estimate", () => {
    const root = rootWith([node("a", spawnWith({ /* rate/lifetime giving E=12 */ }))]);
    expect(estimateSystemLoad(root)).toBeCloseTo(estimatePerEmitter(/* same spawn */), 6);
  });
  it("chains multiply and SUM across nodes (A(parent)+A(parent)×E(child))", () => {
    // parent E=10, child E=5 → total = 10 + 10×5 = 60
  });
  it("multiple roots sum", () => {
    // two roots E=10 and E=20 → 30
  });
  it("agreement: a tree with an over-threshold chain has system load >= that chain's cumulative", () => {
    // build the same fixture an existing estimateChainLoad test uses;
    // compare against the max estimate in the returned Map
  });
});
```

Write all bodies fully using the file's real spawn-fixture helpers. Run from `web/`: `pnpm --filter @particle-editor/editor test -- --run chain-load` → FAIL (no export). Explicit exit code (L-080).

- [ ] **Step 2: Implement** in `chain-load.ts` (beside `estimateChainLoad`, sharing `estimatePerEmitter` — no formula duplication):

```ts
/** Total estimated steady-state alive particles for ONE placed instance
 *  of the whole system: Σ over every node of its cumulative alive
 *  estimate (A(node) = A(parent) × E(node); roots start at A = E).
 *  Drives the preemptive overload gate (engine/set/estimated-load) —
 *  the SAME walk + estimator as the ⚠ chain warning, so the gate and
 *  the glyph can never disagree. */
export function estimateSystemLoad(root: EmitterTreeNode): number {
  let total = 0;
  const visit = (node: EmitterTreeNode, parentCumulative: number): void => {
    const cumulative = parentCumulative * estimatePerEmitter(node.spawn);
    total += cumulative;
    node.children.forEach((c) => visit(c, cumulative));
  };
  root.children.forEach((c) => visit(c, 1));
  return total;
}
```

- [ ] **Step 3: Green** — chain-load spec + `tsc -b` exit 0.
- [ ] **Step 4: Commit** `feat(overload-gate): estimateSystemLoad — system-total alive estimate (shared walk with the chain warning)`

---

### Task 2: Schema + mock + push hook

**Files:**
- Modify: `web/packages/bridge-schema/src/index.ts`, `web/apps/editor/src/bridge/mock.ts`
- Create: `web/apps/editor/src/lib/use-estimated-load-push.ts`
- Modify: `web/apps/editor/src/screens/EmitterTree.tsx` (call the hook)
- Test: `web/apps/editor/src/lib/__tests__/use-estimated-load-push.test.ts` (new), bridge-contract additions

- [ ] **Step 1: Failing tests.** (a) Contract test: mock accepts `engine/set/estimated-load` and resolves ok. (b) Hook test (stub bridge + fake tree): pushes once on mount with the computed value; re-render with an unchanged-estimate tree → NO second push (epsilon); re-render with a changed tree → pushes the new value. Run → FAIL.
- [ ] **Step 2: Schema.** Beside `:607`:

```ts
| { kind: "engine/set/estimated-load";      params: { perInstance: number } }
```

Response map (`:1002` area): `Record<string, never>`. Event union (`:1129` area):

```ts
| { kind: "engine/overload/refused";  payload: { estimated: number; cap: number; attemptedCount: number } }
```

- [ ] **Step 3: Mock.** Clone the overload-guard handling: add to the non-persisted list (`:87` area, `return false`) and a no-op success case in the switch (`:411` area) — the browser preview has no engine sim; document that in a one-line comment.
- [ ] **Step 4: Hook.**

```ts
// use-estimated-load-push — recompute the system-total estimate on every
// tree update and push it to the engine (engine/set/estimated-load) when
// it actually changed. The engine multiplies by its live placed-instance
// count to run the preemptive overload gate; pushing here (the same
// place the ⚠ data is computed) keeps the gate's number identical to
// the glyph's. Push on mount too — BridgeDispatcher caches + reapplies
// across SetEngine, mirroring the overload-guard config push.
const EPS = 0.5;
export function useEstimatedLoadPush(bridge: Bridge, tree: { root: EmitterTreeNode } | null): void {
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (tree === null) return;
    const perInstance = estimateSystemLoad(tree.root);
    if (last.current !== null && Math.abs(perInstance - last.current) < EPS) return;
    last.current = perInstance;
    void bridge.request({ kind: "engine/set/estimated-load", params: { perInstance } })
      .catch(() => { /* mock/no-engine: harmless */ });
  }, [bridge, tree]);
}
```

Call it from `EmitterTree.tsx` right where the `estimateChainLoad` memo lives (`:1276` area): `useEstimatedLoadPush(bridge, tree);` (the component already has `bridge` + `tree`).

- [ ] **Step 5: Green** — full web suite + `tsc -b` 0 (schema change ripples; fix type errors). Commit `feat(overload-gate): estimated-load schema/mock + tree-driven push hook`.

---

### Task 3: Engine — the gate (C++)

**Files:**
- Modify: `src/engine.h`, `src/engine.cpp`, `src/SpawnerDriver.cpp`, `src/host/HostWindow.cpp`

- [ ] **Step 1: Engine state + API** (engine.h, beside the guard members at :572):

```cpp
// [hard-guard] Estimated alive particles for ONE placed instance,
// pushed by the web (engine/set/estimated-load; chain-load.ts owns
// the formula). 0 = no estimate yet → the gate is INERT (never refuse
// on a number we don't have; the runtime budget below is the backstop).
double m_estimatedPerInstance = 0.0;
// One-shot spawn-refusal record for the dispatcher's 4 Hz poll.
struct SpawnRefusal { double estimated; int cap; int attemptedCount; };
bool m_spawnRefusalPending = false;
SpawnRefusal m_spawnRefusal{};
```

Public API (beside `SetOverloadGuard` at :432):

```cpp
void SetEstimatedLoad(double perInstance);
// Returns true once per refusal and clears the record (4 Hz poll).
bool TakeSpawnRefusal(SpawnRefusal* out);
```

- [ ] **Step 2: Implement** (engine.cpp, beside `SetOverloadGuard` at :232):

```cpp
void Engine::SetEstimatedLoad(double perInstance)
{
    if (perInstance < 0.0 || !std::isfinite(perInstance)) perInstance = 0.0;
    m_estimatedPerInstance = perInstance;
    // [hard-guard edit-time check] A parameter revision can push the
    // already-placed preview over budget: clear it and record the
    // refusal so the banner explains what happened.
    const int n = GetNumInstances();
    if (m_overloadGuardEnabled && perInstance > 0.0 && n > 0 &&
        n * perInstance > (double)m_maxPreviewParticles)
    {
        m_spawnRefusal = { n * perInstance, m_maxPreviewParticles, n };
        m_spawnRefusalPending = true;
        Clear();
    }
}

bool Engine::TakeSpawnRefusal(SpawnRefusal* out)
{
    if (!m_spawnRefusalPending) return false;
    if (out) *out = m_spawnRefusal;
    m_spawnRefusalPending = false;
    return true;
}
```

Gate at the TOP of `SpawnParticleSystem` (engine.cpp:190), before the allocation:

```cpp
// [hard-guard spawn-time check] Refuse the placement (and clear the
// rest of the preview) when the estimated TOTAL — already-placed
// instances plus this one — exceeds the guard cap. Estimate 0 = no
// estimate pushed yet = gate inert (runtime budget is the backstop).
if (m_overloadGuardEnabled && m_estimatedPerInstance > 0.0)
{
    const double projected = (GetNumInstances() + 1) * m_estimatedPerInstance;
    if (projected > (double)m_maxPreviewParticles)
    {
        m_spawnRefusal = { projected, m_maxPreviewParticles, GetNumInstances() + 1 };
        m_spawnRefusalPending = true;
        Clear();
        return nullptr;
    }
}
```

(`Clear()` runs before any allocation for the new instance — only pre-existing instances are touched; same call `file/new` already makes. Include `<cmath>` if `std::isfinite` needs it.)

- [ ] **Step 3: Caller null-safety.**
  - `SpawnerDriver.cpp:190` block: already null-checks. ADD the churn stop — on `inst == NULL`, treat as gate refusal (the only null source): `m_cfg.enabled = false; m_burstRemaining = 0; m_phase = Phase::Waiting;` + a comment ("hard-guard refusal: disable the driver so an interval spawner doesn't refuse-and-clear every cycle; the user re-arms deliberately"). Also `break` out of the burst loop.
  - `HostWindow.cpp:2784` and `:3032`: the result lands in `m_attachedParticleSystem`. AUDIT every deref of `m_attachedParticleSystem` between assignment and the existing null-guards (the file already has `if (...m_attachedParticleSystem)` patterns); add `if (m_attachedParticleSystem != nullptr)` guards around any unguarded immediate use (e.g. follow-up `Detach`/`SetPosition` calls in the same blocks). The existing `Log(... result=%p)` lines are null-safe as-is.
- [ ] **Step 4: Build** host Debug x64 (MSBuild VS18) — exit 0. Commit `feat(overload-gate): engine estimate gate — refuse + clear at SpawnParticleSystem, edit-time clear, spawner self-disable`.

---

### Task 4: Dispatcher — command, cache, refusal event (C++)

**Files:**
- Modify: `src/host/BridgeDispatcher.cpp`, `src/host/BridgeDispatcher.h`

- [ ] **Step 1: Command handler** (clone the `engine/set/overload-guard` block at :1462):

```cpp
// -------- engine/set/estimated-load (hard-guard) -----------------
// Web-computed estimate of alive particles per placed instance
// (chain-load.ts owns the formula — see the hard-guard spec). Cached
// and reapplied on SetEngine like the guard config.
if (kind == "engine/set/estimated-load")
{
    double perInstance = params.value("perInstance", 0.0);
    if (perInstance < 0.0) perInstance = 0.0;
    m_estimatedLoadCached = true;
    m_estimatedLoadPerInstance = perInstance;
    if (m_engine) m_engine->SetEstimatedLoad(perInstance);
    sendOk(json::object());
    return res;
}
```

Header: `bool m_estimatedLoadCached = false; double m_estimatedLoadPerInstance = 0.0;`. In `SetEngine` (:765-774), after the guard reapply: `if (m_engine && m_estimatedLoadCached) m_engine->SetEstimatedLoad(m_estimatedLoadPerInstance);`

- [ ] **Step 2: Refusal poll + event.** At `EmitStatsTick`'s call site (the 4 Hz cadence), poll and emit BEFORE the tick:

```cpp
Engine::SpawnRefusal refusal;
if (m_engine && m_engine->TakeSpawnRefusal(&refusal))
{
    EmitEvent(json{
        {"kind", "engine/overload/refused"},
        {"payload", {
            {"estimated",      refusal.estimated},
            {"cap",            refusal.cap},
            {"attemptedCount", refusal.attemptedCount},
        }},
    });
}
```

(Match the file's actual event-emission helper — find how `stats/tick`/`tree/changed` are emitted (`EmitStatsTick` builds a json + posts; there will be a shared `Emit...`/post helper) and use the same mechanism; the JSON shape above is the contract.)

- [ ] **Step 3: Build** host Debug x64 — exit 0. Commit `feat(overload-gate): estimated-load dispatch + cached reapply + refusal event on the 4Hz stats path`.

---

### Task 5: Web — transient refusal banner

**Files:**
- Modify: `web/apps/editor/src/components/OverloadBanner.tsx`
- Test: `web/apps/editor/src/components/__tests__/OverloadBanner.test.tsx`

- [ ] **Step 1: Failing tests.** With the file's existing stub-bridge idiom: (a) an `engine/overload/refused` event mounts the banner with copy containing both `fmtCount(estimated)` and `fmtCount(cap)`; (b) it auto-dismisses after ~5 s (use the test idiom the existing banner tests use for usePresence timing — real timers + waitFor, or fake timers if that's the file's pattern); (c) the latch behavior (stats/tick overload=true mounts the latch copy) is unchanged; (d) precedence: refusal event while latched → refusal copy shows; after the 5 s window with overload still true → latch copy again.
- [ ] **Step 2: Implement.** In `OverloadBanner`: add a `refusal` state `{ estimated: number; cap: number } | null` set by a `bridge.on("engine/overload/refused", ...)` subscription; a `REFUSAL_MS = 5_000` timeout clears it (cancel on re-fire — a second refusal restarts the window). Render: `refusal !== null` takes precedence over the latch flag; copy:

```tsx
{`Spawn blocked — this effect is estimated at ~${fmtCount(refusal.estimated)} particles, over the ${fmtCount(refusal.cap)} preview limit. Preview cleared.`}
```

Same pill styling/occlusion/usePresence plumbing — the banner body is shared; only the message source differs. Keep the latch copy byte-identical.

- [ ] **Step 3: Green** — banner spec + full suite + `tsc -b` 0. Commit `feat(overload-gate): transient refusal banner (5s, precedence over the latch)`.

---

### Task 6: Native harness specs + gates + CHANGELOG

**Files:**
- Modify: `web/apps/editor/tests/preview-overload.spec.ts`, `CHANGELOG.md`

- [ ] **Step 1: New specs** (append after the existing guard-config specs; reuse `bridgeRequest`/`waitForOverload`/`cleanupStep` helpers; ALL caps ≤2k per #134; every spec restores guard 10k + estimate 0 + `engine/action/clear` in its finally):
  1. **Cumulative spawn gate:** guard 1k; push `engine/set/estimated-load {perInstance: 400}`; spawner manual burstSize 1 → trigger twice (2 placed, 800 est) → third trigger refused: assert an `engine/overload/refused` event arrives (subscribe via page.evaluate like `waitForOverload`), `engine/state/snapshot` (or stats) shows 0 instances after, editor alive (a follow-up bridge request resolves).
  2. **Edit-time clear:** guard 1k, estimate 400, place 2 → push estimate 600 → refusal event + cleared.
  3. **Single-instance-too-big repeat:** estimate 1.5k vs cap 1k → first trigger refused; trigger again → refused AGAIN (two events; no lock-out).
  4. **Spawner churn stop:** auto/interval spawner armed + over-cap estimate → exactly ONE refusal event across a multi-interval observation window; `engine/state/snapshot` spawner state shows disabled.
  5. **Guard disabled:** estimate huge, guard `{enabled:false}` → trigger places an instance (count ≥1, no refusal event).
  6. **Backstop intact:** confirm the existing #134 bomb specs run unchanged — they never push an estimate, but earlier NEW specs in the same shared-host run DO; each new spec's cleanup must push `{perInstance: 0}` so the gate is inert for the bombs. Add the same defensive `{perInstance: 0}` reset at the TOP of the two bomb specs (mirroring their existing defensive unpause).
- [ ] **Step 2: Gates** (explicit exit codes — L-080): web full suite; `tsc -b` 0; vite build; host Debug x64 MSBuild; `pnpm --filter @particle-editor/editor test:native` → 180+new/0 (~2-3 min post-#134).
- [ ] **Step 3: CHANGELOG** entry per house format (`TODO-hash · TODO-PR` backfill): what ships (preemptive gate, cumulative, edit-time clear, clear-on-refusal, transient banner, spawner self-disable, backstop kept); how (host-enforced/web-supplied split, the SpawnParticleSystem choke point, nullptr ⟺ refusal invariant); issues (whatever execution surfaces).
- [ ] **Step 4: Commit + push + PR** against `master`; PR body summarizes the spec decisions + gates; **merge only after the user's feel pass** (Shift-click refusal + clear + banner; spawner one-banner stop; rate-crank edit clear; cap raise un-blocks; guard-off bypass; backstop banner still appears on an estimate-undercounting chain).

---

## Self-review notes (plan time)

- **Spec coverage:** §2.1 → Tasks 1-2; §2.2 → Task 3; §2.3 → Task 4; §2.4 → Task 3 Step 3; §2.5 → Task 5; §4 → each task's tests + Task 6. The §3 risks map: staleness/inaccuracy (backstop, no task needed), boot ordering (estimate-0 inert — Task 3 code + Task 6 spec 6), churn (Task 3 + spec 4), Clear re-entrancy (gate-before-allocation — Task 3 comment), mock divergence (Task 2 no-op).
- **Type consistency:** `SpawnRefusal{estimated,cap,attemptedCount}` (engine) ⇄ event payload (Task 4) ⇄ schema (Task 2) ⇄ banner fields (Task 5, uses estimated+cap only — attemptedCount is wire-available for the future, harmless).
- **Soft spots for the executor:** the exact 4 Hz call site name (Task 4 Step 2 says find `EmitStatsTick`'s caller); `EmitterTree.tsx`'s `tree` state name for the hook call; the banner test-file's timing idiom; HostWindow's deref audit is judgment work — escalate if the attached-pointer lifecycle looks more entangled than the existing null-guards suggest.
- **Execution gate:** per the user's instruction, this plan is WRITTEN but NOT executed — confirm with the user before dispatching Task 1.
