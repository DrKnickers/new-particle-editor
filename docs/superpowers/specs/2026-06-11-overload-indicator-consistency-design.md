# Overload indicator consistency — cap-tracking ⚠ glyph, system-load chip, banner exit fix (design)

*2026-06-11 · designed with the user (session 38). Follow-up to the #138
preemptive hard-guard: closes the two feel-test gaps the user reported
(silent gate-blocks, stale-latch banner reveal). Placement of the new
system indicator (emitter-tree chip) picked by the user from three
mockups (status bar / viewport banner / tree chip).*

## Purpose

The #138 gate and the NT-11 ⚠ glyph share one estimator
([`chain-load.ts`](../../web/apps/editor/src/lib/chain-load.ts)) but not
one *threshold*, and the gate additionally multiplies by placed-instance
count while the glyph is per-row / per-single-instance. Result: gate
refusals the UI never foreshadows. Separately, every transient refusal
banner ends with a jarring flash of the runtime-latch copy.

User repro (cap 1000, continuous 2000 particles/sec, attempt to spawn):

1. **Silent block.** The spawn is refused (2000 > 1000) but the ⚠ glyph
   stays dark (2000 < the fixed `CHAIN_WARN_THRESHOLD` 10k).
2. **Stale latch reveal.** As the 5 s refusal banner expires, the latch
   copy ("Preview spawning limited…") flashes during the fade-out.

Three coupled changes, **all web-side — zero C++**:

- **Part 1:** the per-row ⚠ glyph warns at the configurable guard cap.
- **Part 2:** a system-load chip at the top of the emitter tree warns
  whenever the *next placement would be refused* — covering the two
  multipliers the per-row glyph cannot (sum across roots, × placed
  instances).
- **Part 3:** the refusal banner freezes its rendered variant for the
  exit animation, and a refusal authoritatively clears the web-side
  latch state.

## Decisions (user-approved)

| Question | Decision |
|---|---|
| Solve system-total silence now or later? | **Now** — the per-row fix alone leaves the common 2-instance case silently gated; the user would re-report it. |
| System indicator placement | **Emitter-tree chip** (option C of three mockups). The transient refusal banner already covers the viewport, so the chip is the persistent authoring-context complement — not a second banner. Status-bar segment and a third banner variant rejected (weakest contrast; couples to the banner precedence stack being fixed in Part 3). |
| Chip trigger | **Predictive**: chip visible ⟺ the next spawn attempt would be refused, i.e. `(instances + 1) × estimateSystemLoad > cap` (guard enabled). Chosen over current-placed-state semantics because the engine *clears* any over-cap placed state (edit-time check), making a current-state condition self-erasing — it could only ever show at 0 instances. Identical to the approved mockup when nothing is placed. |
| Chip number | The **projected total** the gate compares (`(instances+1) × load`), not the per-instance estimate — the chip's job is the system view. It may differ from a glyph tooltip's per-chain number once instances are placed; accepted. |
| Glyph threshold source | `guard.enabled ? maxParticles : CHAIN_WARN_THRESHOLD`. **Deliberate semantic change:** with a cap above 10k, effects between 10k and the cap lose their old advisory glyph — the glyph now means "will be gated", not "heavy". The inverse (min(cap, 10k)) was rejected: a lit glyph on a spawnable effect re-creates the same inconsistency mirrored. Guard **off** keeps the NT-11 advisory 10k. |
| Config reactivity | A `useOverloadGuardConfig()` hook fed by an `alo:overload-guard-changed` window CustomEvent **dispatched inside `writeOverloadGuard()`** (covers every future writer). Chosen over lifting config into React context (App refactor, larger blast radius). Same-tab only — fine, the editor is a single WebView. |
| Issue-2 fix | **Web-only.** The handoff suggested an engine-side latch reset in `Engine::Clear()` — that reset *already exists* ([engine.cpp:247](../../src/engine.cpp)). The remaining bug is in the web render layer (§2.3). |

## §1 What the codebase already gives us

- **Estimator + walk.** `estimateChainLoad` (per-row cumulative, fixed
  `CHAIN_WARN_THRESHOLD = 10_000`) and `estimateSystemLoad` (system
  total per instance) in [`chain-load.ts`](../../web/apps/editor/src/lib/chain-load.ts).
  `estimateChainLoad` has exactly **one production caller**
  ([`EmitterTree.tsx:1277`](../../web/apps/editor/src/screens/EmitterTree.tsx),
  memoized on `tree`), so an optional threshold param is fully
  backward-compatible.
- **Live placed-instance count on the web.** `stats/tick` (4 Hz)
  carries `instances` = `Engine::GetNumInstances()`
  ([HostWindow.cpp:2247](../../src/host/HostWindow.cpp)) — the same
  count the gate multiplies by ([engine.cpp:202](../../src/engine.cpp)).
  No new bridge plumbing needed. (`spawner/active-count` is
  change-driven and also available, but one 4 Hz subscription confined
  to a leaf component is simpler.)
- **Guard config.** [`overload-guard.ts`](../../web/apps/editor/src/lib/overload-guard.ts):
  localStorage-persisted `{enabled, maxParticles}`; `writeOverloadGuard`
  is the single write choke point (PreferencesDialog `commitGuard`).
  Currently **no reactive consumer** — read once at App mount + locally
  in Preferences. (`theme.ts` doesn't need JS reactivity — it flips a
  DOM attribute; the cap drives JS computation, hence the new hook.)
- **Banner machinery.** [`OverloadBanner.tsx`](../../web/apps/editor/src/components/OverloadBanner.tsx):
  one surface, two states (`overload` from `stats/tick`, transient
  `refusal` from `engine/overload/refused`), exit animation via
  `usePresence` (150 ms, body stays mounted in `data-state="closed"`).
- **Engine/host behaviour relevant to Part 3** (verified): both refusal
  paths call `Clear()` ([engine.cpp:207](../../src/engine.cpp), `:287`),
  which resets the runtime latch (`:247`); the host emits the refusal
  event and `stats/tick` in the **same** 4 Hz poll, with stats captured
  after the synchronous `Clear()`
  ([BridgeDispatcher.cpp:5345](../../src/host/BridgeDispatcher.cpp)) —
  so every refusal arrives alongside `overload=false`.
- **Number formatting.** `fmtCount` in `chain-load.ts` (shared by the
  banner + ⚠ tooltip; the chip reuses it).
- **Warning styling precedent.** `--warning` (#e0a14b, theme-independent)
  + the #121 lesson: amber *text* needs a darker stop on light surfaces
  or a filled treatment; the chip uses an amber-tinted band
  (`--warning` at low alpha) + amber text per the approved mockup.

## §2 Architecture

### 2.1 `useOverloadGuardConfig()` — reactive guard config

In `overload-guard.ts`:

```ts
/** Live overload-guard config. Seeds from readOverloadGuard(); re-renders
 *  when writeOverloadGuard() dispatches alo:overload-guard-changed. */
export function useOverloadGuardConfig(): OverloadGuardConfig;
```

`writeOverloadGuard()` additionally dispatches
`window.dispatchEvent(new CustomEvent("alo:overload-guard-changed"))`
after the localStorage write. The hook subscribes on mount, re-reads on
event. No payload on the event — the read path already exists and
clamps.

### 2.2 Part 1 — cap-tracking glyph; Part 2 — system-load chip

**`estimateChainLoad(root, threshold = CHAIN_WARN_THRESHOLD)`** gains an
optional threshold (pure, default keeps every existing test green).

**`EmitterTree`** computes
`threshold = guard.enabled ? guard.maxParticles : CHAIN_WARN_THRESHOLD`
(via the hook) and passes it into the existing `chainWarnings` memo
(deps gain `guard`). The glyph stays per-row / per-single-instance — it
must **not** multiply by instance count (an authoring hint shouldn't
flicker as instances are placed).

**`SystemLoadChip`** — new small component rendered between the
emitter-tree panel header and the rows (non-scrolling, like the
approved mockup). Props: `bridge`, `systemLoad: number` (computed in
`EmitterTree` via a `useMemo` on `tree` — same value
`useEstimatedLoadPush` pushes). Internally:

- subscribes to `stats/tick` for `instances` (confining the 4 Hz
  re-render to this leaf; null until the first tick → treat as 0);
- reads the guard config via `useOverloadGuardConfig()`;
- visible ⟺ `guard.enabled && systemLoad > 0 &&
  (instances + 1) × systemLoad > guard.maxParticles`;
- copy (numbers via `fmtCount`, wording feel-tunable):
  - `instances === 0`:
    **⚠ This effect ≈ {systemLoad} particles — over the {cap} preview limit**
  - `instances ≥ 1`:
    **⚠ Another instance would exceed the preview limit (≈ {(instances+1)×systemLoad} of {cap})**
- hidden → renders `null` (no a11y-golden churn in default scenarios);
  visible → amber band per the approved mockup (`bg-warning` low-alpha
  tint + amber text, `role="status"`), reusing the ⚠ glyph's triangle.

Browser/mock mode: no `stats/tick` → `instances = 0` → the chip still
works as a pure per-instance authoring signal. Deliberate.

### 2.3 Part 3 — banner exit fix (issue 2)

**Root cause (verified in code, supersedes the handoff hypothesis):**
when the 5 s refusal window expires, `refusal` becomes null and
`visible` goes false — but `usePresence` keeps the body mounted for the
150 ms exit, and the body's ternary
(`refusal !== null ? refusalCopy : latchCopy`) falls through to the
**latch copy for the entire fade-out**. Every refusal expiry flashes
the stale latch text. The engine is not involved (its latch reset on
`Clear()` already exists and the host emits `overload=false` alongside
every refusal — §1).

Two changes in `OverloadBanner.tsx`:

1. **Freeze the rendered variant at exit start.** Render from a "last
   visible content" value: while `visible`, it tracks the live
   `refusal`-vs-latch choice; when `visible` drops, the exiting body
   keeps rendering the content it showed last (a ref updated only while
   visible). Precedence behaviour is preserved: if the runtime latch is
   *genuinely* still set when the refusal expires (estimate
   undercount), `visible` stays true and the copy legitimately switches
   to the latch — that path is untouched (and pinned by a test).
2. **`setOverload(false)` inside the `engine/overload/refused`
   handler.** A refusal means the engine cleared the preview, so any
   web-held latch state is stale. Belt-and-suspenders against
   delivery-order races; self-correcting if wrong (a genuine latch
   re-asserts via the next 4 Hz tick, ≤250 ms).

## §3 Risks + mitigations

1. **Predictive chip reads as a false alarm** (visible while the
   current preview is healthy, e.g. one 600-particle instance placed,
   cap 1000). *Mitigation:* the `instances ≥ 1` copy variant is
   explicitly prospective ("Another instance would exceed…"); final
   wording is a feel-test item. If the user vetoes the predictive case
   at feel test, the fallback is trigger-at-`instances === 0`-only — a
   one-line condition change.
2. **Instance-count lag.** `instances` updates at 4 Hz, so the chip can
   lag a placement/clear by ≤250 ms. *Mitigation:* accepted — it's a
   warning chip, not a gate; the estimate side (the volatile input) is
   recomputed synchronously on every tree change.
3. **Glyph semantic change above 10k** (cap 100k → 10k–100k effects
   lose the old advisory glyph). *Mitigation:* deliberate and
   documented (Decisions); guard-off retains the 10k advisory;
   CHANGELOG records the new meaning ("glyph ⟺ gate").
4. **Banner freeze vs. genuine latch precedence.** Freezing exit
   content must not suppress the designed "latch re-asserts after the
   refusal window if still latched" behaviour. *Mitigation:* the freeze
   applies only while `visible === false` (exit in flight); a dedicated
   test pins the genuine-latch path.
5. **a11y golden churn.** The chip inserts DOM above the rows; the
   glyph's aria-label content depends on the threshold. *Mitigation:*
   default cap (10k) equals `CHAIN_WARN_THRESHOLD` and harness effects
   are tiny, so the chip renders null and labels are unchanged; verify
   with the **full** golden run, never a `--grep` regen (L-081).
6. **CustomEvent signal is invisible to the type system** (a stringly
   cross-module contract). *Mitigation:* the event name lives as an
   exported constant in `overload-guard.ts` next to dispatcher and
   subscriber — single file owns both ends.

## §4 Testing & verification

All web (Vitest) — **no C++ changes, no new native specs**; the native
harness stays 180/0 untouched.

- `chain-load`: `estimateChainLoad` honours a passed threshold (cap
  1000 flags a 2000-estimate emitter; same tree silent at default 10k);
  default-param call sites unchanged (existing tests stay green).
- `useOverloadGuardConfig`: seeds from storage; updates on
  `writeOverloadGuard` (event dispatched by the lib, not the dialog).
- `SystemLoadChip`: hidden under cap; visible at
  `(instances+1)×load > cap` with the `instances === 0` copy; visible
  with the prospective copy after a `stats/tick` carrying
  `instances: 1`; hidden when guard disabled; reacts to a cap change
  event; numbers formatted via `fmtCount`.
- `EmitterTree` (existing chain-warning test extended): glyph lights at
  the configured cap, not 10k, when the guard is enabled.
- `OverloadBanner` (fake timers):
  - refusal fires → 5 s expiry → during the 150 ms exit the body still
    renders the **refusal** copy/variant (the regression this fixes);
  - latch latched (`stats/tick` overload:true) then refusal →
    `overload` cleared → after expiry the banner exits with no latch
    reveal;
  - genuine still-latched case: refusal expires while ticks keep
    reporting overload:true → latch copy legitimately shows (precedence
    preserved).

Gates: full web suite + `tsc -b` 0 + vite build; full a11y golden run
(L-081); native harness 180/0 (regression only); host Debug x64 builds
(unchanged C++, sanity only).

User feel pass (L-033, user-launched):

- Repro: cap 1000, continuous 2000/s → chip visible before any spawn
  attempt, ⚠ glyph lit, Shift-click → refusal banner → **no latch flash
  at the 5 s fade**.
- Multi-instance: cap 1000, effect ≈ 600 → first placement succeeds,
  chip switches to the prospective copy, second placement refused as
  foreshadowed.
- Raising the cap in Preferences clears the chip + glyph live (no
  reload); guard off → chip gone, glyph back at the 10k advisory.
- Estimate-undercount path: a chain the estimate misses still lights
  the runtime latch banner after the refusal window (precedence).

## §5 Out of scope

- **Status-bar echo of the chip** — rejected placement; revisit only on
  request.
- **A third persistent banner variant** — rejected (couples to the
  precedence stack this spec is fixing).
- **Estimate display in the spawner panel** — still the natural
  follow-up from the #138 spec, still not in this pass.
- **Engine/bridge changes of any kind** — the engine side is verified
  correct as-is.
- **Legacy Win32 editor** — new-UI host only.
