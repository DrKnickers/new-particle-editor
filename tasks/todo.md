# NT-11 soft chain warning — plan (session 35)

_2026-06-10. Spec (user-approved section-by-section):
[`docs/superpowers/specs/2026-06-10-chain-warning-design.md`](../docs/superpowers/specs/2026-06-10-chain-warning-design.md).
Executable task plan:
[`docs/superpowers/plans/2026-06-10-chain-warning.md`](../docs/superpowers/plans/2026-06-10-chain-warning.md).
Status: **PLAN — awaiting user execution-mode choice.**_

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
- [x] Implementation plan written
- [ ] Tasks 1–8 (see plan doc)

## Review

_(to be appended at completion)_
