# Preview overload guard — plan (session 35, part 2)

_2026-06-10. Triggered by the NT-11 feel test: a Shift-×10 spinner step
committed a huge Particles/sec, the preview simulated the bomb, and the
editor died (OOM, host.log stops mid-stream, no exception). Root cause
traced (no global budget on live particles/instances; chains multiply
child EmitterInstances per particle; FP-precision burst-doubling trap at
[`EmitterInstance.cpp:919-924`](../src/EmitterInstance.cpp)). User-approved
behavior: suppress spawning over budget + auto-clearing banner; separate
PR (branch `claude/preview-overload-guard` off `e67e5e5`). Status:
**EXECUTING.**_

---

## 1. Goal + scope

When the live preview's particle population would exceed a hard budget,
the engine **stops spawning** (existing particles live out their lives)
and the UI shows a **non-modal, auto-clearing banner**. When the
population decays under budget (user lowers the rate), spawning resumes
and the banner clears itself. The editor survives ANY spawn parameters —
typed, Shift-×10'd, or chain-multiplied.

**In:** engine-wide live-particle + instance budgets, spawn suppression
at both allocation choke points, overload latch → `stats/tick` payload →
React banner, native regression spec (rate=huge → plateau ≤ budget +
flag), null-safety on refused child spawns.
**Out (deliberate):**
- No clamping of authored values — the `.alo` data model is never
  touched (the engine guard makes any value survivable).
- No fix for the FP burst-doubling trap itself — its blast radius is
  contained by the budget; noted for a future pass.
- No modal dialog (user chose banner).
- Spinner Shift-step behavior unchanged (it's a feature; the guard makes
  it safe).

## 2. What the codebase already gives us

- `EmitterInstance::m_engine` is an `Engine&` ([`EmitterInstance.h:38`](../src/EmitterInstance.h))
  — both spawn paths can reach a budget API without plumbing.
- Engine already does live accounting: `m_numParticles` (delta-updated in
  `Engine::Update`, [`engine.cpp:561`](../src/engine.cpp)), `m_numEmitters`
  via `OnEmitterCreated` ([`engine.h:348`](../src/engine.h)).
- The 4 Hz stats timer already ships `GetNumParticles()` to the UI
  ([`HostWindow.cpp:2241-2248`](../src/host/HostWindow.cpp), `EmitStatsTick`).
- Per-instance uint16 index cap (16,383) exists
  ([`EmitterInstance.cpp:273`](../src/EmitterInstance.cpp)) — necessary but
  insufficient (instances multiply).
- `useViewportOcclusion` (EmitterTree.tsx's OccludingContextMenuContent
  pattern) lets a DOM banner render over the D3D viewport without being
  overpainted.
- Browser mock emits NO `stats/tick` (mock.ts:405 comment) — banner is
  host-only; component tests drive it with a stub bridge.

## 3. Architecture

**Engine (`engine.h`/`engine.cpp`):** constants `kMaxLivePreviewParticles
= 100'000`, `kMaxLiveEmitterInstances = 5'000` (tunable). A per-frame
spawn budget: `Engine::Update()` start computes
`m_spawnBudget = max(0, kMaxLivePreviewParticles - m_numParticles)`.
New API: `bool TryConsumeSpawnBudget()` (decrement, false at 0 → latch
overload) and `bool TryConsumeInstanceBudget()` (checks
`m_numEmitters < kMaxLiveEmitterInstances`). Overload flag recomputed per
frame (any refusal this frame ⇒ active), exposed as
`bool IsSpawnOverloadActive() const`. Resume hysteresis: budget refills
only below 90% of cap so the boundary doesn't flicker.

**Suppression points:**
- `EmitterInstance::SpawnParticles` burst loop: per particle,
  `if (!m_engine.TryConsumeSpawnBudget()) break;` and on refusal advance
  `m_nextSpawnTime` to currentTime (drop missed spawns — NO catch-up
  burst on resume).
- `ParticleSystemInstance::SpawnEmitter`: refuse (return nullptr) when
  instance budget exhausted. Callers made null-safe: `SpawnParticle`
  (assigns to `m_childEmitter` — already null-tolerant downstream at
  KillParticle:638; audit other `m_childEmitter->` derefs) and
  `KillParticle:650-652` (currently derefs unconditionally — add guard).

**Wire:** `stats/tick` payload gains `overload: boolean` (schema +
`EmitStatsTick` signature + HostWindow call site reads
`engine->IsSpawnOverloadActive()`).

**Web:** small `OverloadBanner` component (new file), subscribes to
`stats/tick`, renders a fixed banner over the viewport top (with
`useViewportOcclusion` so the D3D popup doesn't overpaint it); text:
"Preview spawning paused — live particle budget exceeded. Lower spawn
rates (⚠ marks the offending chain)." Auto-hides when `overload` is
false. StatusBar particle counter turns amber while overloaded.

## 4. Risks

1. **Hot-path overhead** — a per-spawn budget check is an int decrement;
   negligible vs the allocation it guards. Accepted.
2. **Refused child spawns break pointer assumptions** — `KillParticle`
   derefs `SpawnEmitter`'s return unconditionally. Mitigation: nullptr
   guard there + audit every `m_childEmitter->` use; native spec
   exercises death-children under overload.
3. **Catch-up burst on resume** — if `m_nextSpawnTime` lags while
   suppressed, resume spawns the backlog at once. Mitigation: advance
   `m_nextSpawnTime` on refusal (drop, don't defer).
4. **Banner over the composited viewport gets overpainted** — mitigated
   by `useViewportOcclusion` (the context-menu precedent).
5. **Stats payload widening breaks consumers** — StatusBar + schema +
   ViewportSlot read stats/tick; sweep with tsc; mock emits none.
6. **Budget too low annoys legitimate heavy effects** — 100k is ~6× the
   per-instance render cap and far beyond vanilla (tens-to-hundreds);
   constant is one line to tune.

## 5. Testing & verification

- **Native spec (the crash regression, replaces "editor dies"):** via
  test-host bridge — set a chained emitter's rate to 1e9 → poll
  `stats/tick`/snapshot → particles plateau ≤ 100k AND `overload: true`
  AND the process stays alive; set rate back to 10 → overload clears
  (poll with timeout). Death-child variant included.
- **Host build** Debug + Release x64 clean; harness 175→176+/0.
- **Web:** banner component tests (stub bridge emits stats/tick
  overload true → banner visible; false → gone); tsc 0; full vitest.
- **Manual (user):** repeat the Shift-×10 accident — editor survives,
  banner appears, lowering the rate clears it; FPS stays interactive
  during overload.

---

## Progress (part 2)

- [ ] Task A: engine budget + suppression + host wire + native spec
- [ ] Task B: web banner + StatusBar tint + component tests
- [ ] Task C: verification + docs + PR (+ CHANGELOG #120 merge-hash
      backfill `e67e5e5` rider)

---

# NT-11 soft chain warning — plan (session 35, part 1) — ✅ SHIPPED #120 (`e67e5e5`)

_2026-06-10. Spec (user-approved section-by-section):
[`docs/superpowers/specs/2026-06-10-chain-warning-design.md`](../docs/superpowers/specs/2026-06-10-chain-warning-design.md).
Executable task plan:
[`docs/superpowers/plans/2026-06-10-chain-warning.md`](../docs/superpowers/plans/2026-06-10-chain-warning.md).
Status: **MERGED — feel-approved by the user; the feel test exposed the
pre-existing preview-crash handled in part 2 above.**_

---

## 1. Goal + scope

When this ships, authoring a chain whose per-particle multiplication
explodes (the v1 chain-test bomb class) shows an amber ⚠ on every row of
the offending chain with a per-generation breakdown tooltip — purely
advisory, nothing blocks. Threshold: 10,000 estimated alive particles.

**In:** spawn params on the tree DTO (host + mock), pure-TS estimator
(`chain-load.ts`), glyph + tooltip in `EmitterTree.tsx`, full test
coverage (vitest / contract / component / native spec), ROADMAP +
CHANGELOG ship bookkeeping.

**Out:**
- Live `stats/tick` escalation backstop — user chose static-formula-only;
  future item if the estimate proves insufficient.
- Any depth guard — chains are engine-legitimate (in-game verified).
- Save-time interception — warning is glyph-only by design.
- Precise death-child semantics — uniform life/death rule accepted in
  spec §1 (documented approximation).

## 2. What the codebase already gives us

- Six spawn fields live on `Emitter` (`src/ParticleSystem.h:175-204`) and
  are already surfaced on `EmitterPropertiesDto` (bridge-schema :423-429)
  with identical names → `SpawnParamsDto = Pick<…>`.
- `BuildEmitterTreeNode` (`src/host/BridgeDispatcher.cpp:511-544`) is the
  single host serializer; two synthetic roots at :2540/:2574.
- **`emitters/set-properties` already ends with `EmitEmittersTreeChanged()`
  (host :3113; mock mirrors at mock.ts:774-777)** → spawn-param edits
  refresh the glyph with ZERO new mechanism. Resolves spec risk 2.
- Mock properties live in a fixture+overlay store
  (`useMockEmitterProperties`, mock-state.ts:1445) → decorate tree nodes
  at the mock's single `emit()` choke point (mock.ts:219) instead of
  touching 35 emit sites.
- Tree rows render a 4-column grid (`EmitterTree.tsx:713`) with an
  established DOM-order-vs-grid-placement convention that keeps a11y
  goldens stable; native `title` tooltips are the house pattern.
- A11y goldens snapshot the DOM, not the DTO; fixture defaults
  (E = 10–50/emitter) never warn → goldens unaffected. Resolves spec
  risk 1.

## 3. Architecture / approach

Approach A from the spec: host mirrors raw spawn fields onto
`EmitterTreeNode.spawn`; one pure function
`estimateChainLoad(root): Map<stableId, ChainWarning>` in
`web/apps/editor/src/lib/chain-load.ts` (Little's law per emitter,
product down the chain, node+ancestors marked when A > 10k);
`EmitterTree.tsx` computes it in a `useMemo` over the existing tree store
and passes `chainWarning` per row. Full signatures + code in the plan doc.

## 4. Risks

1. **~58 `EmitterTreeNode` literals across 12 files break** when `spawn`
   becomes required. Mitigation: shared `ZERO_SPAWN` constant; tsc
   enumerates every site; mock literals are type-satisfaction only
   (decoration overrides).
2. **Mock spawn drift vs properties overlay.** Mitigation: single
   decoration point inside `emit()` + `emitters/list`, reading the
   overlay; contract test pins set-properties → tree/changed reflection.
3. **Glyph changes row accessible names** → golden fragility. Mitigation:
   glyph renders last in DOM (house convention) and ONLY on offending
   rows; no golden scenario crosses the threshold. Verified by zero-diff
   harness run.
4. **Degenerate spawn values (infinite bursts, zero delay) → Infinity/NaN
   in tooltips.** Mitigation: explicit clamps + a no-NaN unit test.
5. **False positives training users to ignore the glyph.** Accepted at
   the 10k threshold (vanilla ≈ tens-to-hundreds alive); threshold is a
   web-side constant, trivially tunable.

## 5. Testing & verification

- **Formula (vitest):** continuous / burst / infinite-burst / zero-delay /
  depth-3 product / ancestor marking / worst-path-wins / zero-rate break /
  no-NaN.
- **Contract:** spawn mirrors properties; set-properties patch reflected
  in next tree/changed.
- **Component:** no glyph at fixture defaults; glyph + tooltip text after
  threshold-crossing patch.
- **Native spec:** `emitters/list` carries spawn (real host), harness
  175/0, zero golden diffs.
- **Suites:** vitest all-green, `tsc -b` 0, vite build clean, host
  Debug+Release x64 clean.
- **Manual (user-launched, L-033):** vanilla file → no glyphs; crank a
  rate past 10k → chain lights up within one edit; tooltip math sane;
  revert → glyph clears; save/undo/reparent unaffected.

---

## Progress

- [x] Spec written + user-approved (`ff8c517`)
- [x] Implementation plan written (`7c41128`)
- [x] Task 1 schema + sweep (`c2e0fe1` + freeze follow-up `a9bd7c4`)
- [x] Task 2 chain-load TDD (`b30ee3d` + formatter/clamp follow-up `9971e04`)
- [x] Task 3 mock decoration (`7063019` + payload-spread `54ddf94`)
- [x] Task 4 host serialization (`a5bec9c` + comment `c3ea2d4`)
- [x] Task 5 glyph UI (`9c48c18` + test hardening `2f4e7ac`)
- [x] Task 6 native spec (`245cb2f` + header `db80032`)
- [x] Task 7 automated verification (user feel pass PENDING — checklist below)
- [x] Task 8 ship bookkeeping (PR number backfilled on PR creation)

## Review

**Executed subagent-driven: 6 implementation tasks, each spec-reviewed +
quality-reviewed by fresh agents, plus a final whole-range integration
review.** Review-driven fixes folded in: frozen `ZERO_SPAWN` (shared-mutable
singleton hazard), sub-1 tooltip multipliers rendering `×0`, negative-input
clamp, mock `emit()` payload spread (future DTO fields), glyph-wiring
negative assertions + ancestor-path component test, mock synthetic-root
spawn parity, two spec-deviation notes (n-prefixed field names, one-line
aria-label).

**Plan-vs-reality deltas worth remembering:**
- The plan named TWO synthetic-root literals in BridgeDispatcher.cpp; a
  THIRD lives in `EmitEmittersTreeChanged()` (the event payload — the
  most-trafficked path). Caught by the Task 4 implementer.
- 4 of the 12 predicted fixture files were never flagged by tsc (they build
  nodes via `as unknown as` casts) — "every file tsc flags" was the right
  rule, the prediction list was advisory.
- PS 5.1 `Get-Content -Raw`/`Set-Content` mojibake'd ROADMAP.md's UTF-8
  during renumbering → use `[System.IO.File]::ReadAllText/WriteAllText`
  with `UTF8Encoding($false)`.

**Verification (all re-run on the final tree):** web vitest **664/664**
(72 files), `tsc -b` 0, vite build clean, host Debug **and** Release x64
clean (benign LNK4098), native harness **175/0** (30 skipped, zero golden
diffs — the new spec is #175).

**User feel pass (pending — L-033, user launches):**
- [ ] Open a real `.alo` with children at vanilla values → no glyphs.
- [ ] Crank a child's Particles/sec until the chain product crosses 10k →
      amber ⚠ on the whole chain within one edit.
- [ ] Hover → tooltip total + per-generation lines read sensibly.
- [ ] Revert the rate → glyph disappears.
- [ ] Save / undo / reparent behave normally with the glyph showing.
