# Overload hard-guard — preemptive estimate gate with clear-on-refusal (design)

*2026-06-11 · designed with the user (session 38). Builds on the #121
runtime guard and the #123/#134 configurable cap. Architecture
(host-enforced gate, web-supplied estimate) picked explicitly by the
user over an engine-computed estimate.*

## Purpose

The existing overload guard is **reactive**: it lets a bomb start, then
suppresses per-frame spawning once the live count exceeds the cap, and
the population decays. The user wants a **preemptive** layer: when the
*estimated* particle load would exceed the guard cap, the editor should
refuse to make it worse and clean up — instead of grinding through a
heavy plateau first.

Three user requirements:

1. **Spawn-time gate, cumulative.** Placing a new instance (Shift-click
   OR the spawner panel) is refused when *(already-placed instances + the
   new one) × the effect's estimated alive-particles* exceeds the cap —
   the gate counts the whole preview, not just the new instance.
2. **Edit-time gate.** A parameter revision that raises the estimate so
   that *placed-instances × new-estimate* exceeds the cap also triggers
   the guard (cranking the rate on an already-placed effect).
3. **Clear on refusal.** When either gate fires, ALL already-spawned
   instances are cleared — the user sees "nothing spawned, the effect is
   too big," not a heavy partial scene. A banner explains why.

The existing **runtime budget stays as the backstop** (user-confirmed):
the static estimate cannot predict all runtime multiplication (deep
chains, death-spawn storms); the actual-count suppression + decay +
latch banner remain unchanged behind the new gate.

## Decisions (user-approved)

| Question | Decision |
|---|---|
| Gate model | **Preemptive estimate-gate added; reactive runtime budget kept** as backstop. Both compare against the same user-configurable cap (`maxParticles`, default 10k). |
| Clear timing | **Clear on refusal** (spawn-time or edit-time). After a clear the count is 0, so the next spawn re-checks from scratch; an effect whose single-instance estimate alone exceeds the cap is refused every time (banner says so). No persistent "locked" state. |
| Architecture | **Host enforces, web supplies the estimate.** The estimate formula (Little's law / NT-11 chain walk) lives ONLY in [`web/apps/editor/src/lib/chain-load.ts`](../../web/apps/editor/src/lib/chain-load.ts) — the same source that drives the ⚠ chain warning, so the gate and the glyph can never drift. The web pushes one number (estimated alive particles per placed instance) to the engine; the engine multiplies by its live placed-instance count and gates/clears. Engine-side C++ duplication of the formula was explicitly rejected. |
| Guard disabled | The hard gate is OFF when the guard is disabled (Preferences toggle) — consistent with #123's "uncapped is an explicit power-user choice." |

## §1 What the codebase already gives us

- **One spawn choke point.** Every placement path calls
  [`Engine::SpawnParticleSystem(system, parent)`](../../src/engine.h)
  (engine.h:135): the spawner driver
  ([`SpawnerDriver.cpp:190`](../../src/SpawnerDriver.cpp)) and both
  Shift-click sites ([`HostWindow.cpp:2784`](../../src/host/HostWindow.cpp),
  `:3032`). Gating inside that one function covers every current and
  future placement path.
- **Live placed count.** `Engine::GetNumInstances()` /
  `m_instances` (engine.h:371, :562) — the list of placed
  `ParticleSystemInstance`s. (Distinct from #121's *EmitterInstance*
  budget, which counts inner chain instances; the hard gate multiplies
  by PLACED systems.)
- **Clear.** `Engine::Clear()` already kills all instances (used by
  `file/new`, `engine/action/clear`).
- **The estimator.** NT-11's
  [`chain-load.ts`](../../web/apps/editor/src/lib/chain-load.ts):
  `estimatePerEmitter` (Little's law) + the `estimateChainLoad` tree
  walk computing each node's cumulative alive count. The web already
  recomputes this on every `tree/changed` (it drives the ⚠ glyph).
- **Config push pattern.** `engine/set/overload-guard` (#123): web owns
  persistence, pushes on change + once at mount; `BridgeDispatcher`
  caches and reapplies on `SetEngine`. The estimate push clones this
  exact pattern.
- **Refusal → UI surface pattern.** #121's overload latch is engine
  state polled by the host's 4 Hz stats path and emitted on
  `stats/tick`; [`OverloadBanner.tsx`](../../web/apps/editor/src/components/OverloadBanner.tsx)
  + `usePresence` render it with occlusion registration. The refusal
  banner reuses this plumbing with a one-shot event.

## §2 Architecture

### 2.1 Web — system-level estimate + push

New pure helper in `chain-load.ts` (NO formula duplication — reuses the
same walk/estimator the ⚠ uses):

```ts
/** Total estimated steady-state alive particles for ONE placed
 *  instance of the whole system: the sum of every node's cumulative
 *  alive estimate (A(node) = A(parent) × E(node); roots A = E). */
export function estimateSystemLoad(root: EmitterTreeNode): number;
```

New bridge command (schema + native + mock):

```
engine/set/estimated-load  { perInstance: number }   → { ok: true }
```

Push sites (one shared module, `lib/overload-gate.ts` or folded into the
existing tree-refetch path): recompute `estimateSystemLoad` wherever the
⚠ data is already computed (the `tree/changed` refetch) and push when
the value changes (epsilon-compare to avoid bridge spam); push once at
mount (after the guard-config push). Mock: accepted as a no-op (the
browser preview has no engine sim).

### 2.2 Engine — the gate

New runtime state alongside the #123 guard members: `m_estimatedPerInstance`
(double, default 0 = "no estimate yet" = gate inert; the runtime backstop
covers the window before the first push).

- **`Engine::SetEstimatedLoad(double perInstance)`** (clamped ≥ 0):
  stores the value, then runs the **edit-time check**: if the guard is
  enabled AND `GetNumInstances() > 0` AND
  `GetNumInstances() × perInstance > maxParticles` → `Clear()` + record
  a refusal event (below).
- **Spawn-time check** at the top of `SpawnParticleSystem`: if the
  guard is enabled AND `m_estimatedPerInstance > 0` AND
  `(GetNumInstances() + 1) × m_estimatedPerInstance > maxParticles` →
  `Clear()`, record the refusal, **return nullptr** (no instance
  placed).
- **Refusal record**: a small one-shot struct
  `{ estimated, cap, attemptedCount }` with a
  `TakeSpawnRefusal()` accessor (returns + clears). No engine→bridge
  coupling — same polling pattern as the overload latch.
- Callers must tolerate `nullptr` from `SpawnParticleSystem`. Survey at
  plan time: SpawnerDriver stores the pointer per spawned entry;
  HostWindow's shift-click paths bind the attached instance. Both must
  null-check (plan task verifies each call site; the #121 work already
  made `SpawnEmitter`-refusal callers null-safe — same discipline).

### 2.3 Host — event surfacing

The existing 4 Hz stats path in `BridgeDispatcher` additionally polls
`TakeSpawnRefusal()`; when present, emits a one-shot event:

```
engine/overload/refused  { estimated: number, cap: number, attemptedCount: number }
```

(≤250 ms banner latency — imperceptible.) `BridgeDispatcher` also caches
the last pushed estimate and reapplies on `SetEngine`, mirroring the
guard-config cache.

### 2.4 Spawner-driver churn stop

If the spawner panel is in interval/auto mode, a refused spawn would
otherwise retry every interval → refuse → clear → banner churn forever.
Decision: when `SpawnParticleSystem` returns nullptr,
**`SpawnerDriver` disables itself** (same state as `spawner/stop`), so
one refusal produces one banner. The user re-arms the spawner
deliberately after fixing the effect or raising the cap. (The Shift-click
path needs no equivalent — each click is a deliberate user action and
may re-refuse with a fresh banner.)

### 2.5 Web — the refusal banner

`OverloadBanner` gains a second, **transient** variant driven by the
`engine/overload/refused` event (the existing latch banner is
state-driven and unchanged): shows for ~5 s via the existing
`usePresence` machinery, amber filled pill, copy approximately:

> **Spawn blocked — this effect is estimated at ~{estimated} particles,
> over the {cap} preview limit. Preview cleared.**

(Numbers via the `fmtCount` helper from chain-load.ts. Exact copy
feel-tunable.) If the latch banner and a refusal overlap, the refusal
takes precedence for its 5 s (it carries more information; the latch
re-asserts itself afterwards if still latched).

## §3 Risks + mitigations

1. **Estimate staleness window.** The estimate push lags a parameter
   edit by one refetch round-trip (~tens of ms); a spawn landing in that
   window gates against the old estimate. *Mitigation:* accepted — the
   runtime backstop catches anything that slips through; the next push
   triggers the edit-time check and clears retroactively.
2. **Estimate inaccuracy (under- or over-count).** Little's law is a
   steady-state heuristic; bursts and deep chains deviate. *Mitigation:*
   under-count → runtime backstop; over-count → the user sees a refusal
   for an effect that might have fit — the banner names both numbers so
   the cap can be raised; the formula is shared with the ⚠ glyph so the
   user has already seen the same number there. Not worth a second
   formula.
3. **Boot/first-push ordering.** The engine may receive spawns (e.g. a
   default placed instance at file load) before the first estimate
   push. *Mitigation:* `m_estimatedPerInstance = 0` disables the gate
   until the first push; the push lands within the first refetch; the
   edit-time check then clears if over. Deliberate: never refuse on a
   number we don't have.
4. **Auto-spawner refusal churn.** Covered by §2.4 (driver disables
   itself on refusal). A test pins one-refusal-one-banner.
5. **Clear() inside SpawnParticleSystem re-entrancy.** `Clear()` deletes
   all instances while a spawn call is on the stack. *Mitigation:* the
   gate runs BEFORE any allocation/registration for the new instance, so
   Clear() touches only pre-existing instances; plan task verifies
   Clear() has no re-entrancy hazard from this call path (it's already
   called from `file/new` in arbitrary states).
6. **Mock divergence.** Browser mode has no engine, so the gate never
   fires there. *Mitigation:* accepted — the gate guards the native
   preview's health; the mock accepts the push command as a no-op so
   web code paths stay identical.

## §4 Testing & verification

Vitest (web):

- `estimateSystemLoad`: single root = its own estimate; chains multiply
  (A(parent)×E(child)) and SUM across nodes/roots; empty tree → 0;
  agreement property — for a tree with one over-threshold chain, the
  system load ≥ that chain's cumulative from `estimateChainLoad`.
- Push behavior: recompute-on-tree-changed pushes only on value change
  (epsilon), once at mount; mock accepts the command.
- Banner: `engine/overload/refused` event mounts the transient variant
  with both numbers in the copy; auto-dismisses ~5 s; latch banner
  unaffected; precedence rule.

Native harness (`tests/preview-overload.spec.ts` additions — keep caps
LOW per #134, ≤1–2k):

- **Cumulative spawn gate:** cap 1k, push estimate 400 → two spawns
  place (800), third refused → instances drop to 0 (cleared), refusal
  event observed, editor alive.
- **Edit-time clear:** place 2 instances at estimate 400 (cap 1k), push
  estimate 600 (2×600 > 1k) → preview clears + event.
- **Single-instance-too-big:** estimate 1.5k vs cap 1k → first spawn
  refused, repeat refusal on retry (no lock-out state).
- **Spawner churn stop:** interval auto-spawner + over-cap estimate →
  exactly one refusal event; spawner reports disabled.
- **Guard disabled:** estimate huge, guard off → spawns place normally.
- **Backstop intact:** the existing #134 bomb specs still pass
  unchanged (estimate 0 default keeps the gate inert for them — verify;
  if their flow pushes an estimate, pin it appropriately).

Gates: full web suite, `tsc -b` 0, vite build; native harness 180+new/0
(now ~2 min); host Debug x64 build (engine.h/cpp change).

User feel pass (L-033): Shift-click placement against a heavy effect
(refusal + clear + banner), spawner-panel refusal (one banner, spawner
stops), the rate-crank edit-time clear, raising the cap in Preferences
un-blocks, guard-off bypasses, and the old runtime banner still appears
for a chain the estimate undercounts.

## §5 Out of scope

- **Per-instance partial clears** (clear only the newest instances to
  fit budget) — all-or-nothing clear is the user's pick; revisit only
  on request.
- **Estimate display in the spawner panel** ("this effect ≈ N
  particles") — natural follow-up, not in this pass.
- **Legacy Win32 editor** — new-UI host only.
- **A persistent blocked-state UI** (e.g. a disabled spawn cursor while
  over cap) — the transient banner + repeat-refusal covers v1.
