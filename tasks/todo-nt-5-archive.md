# [NT-5] Engine-side single-member link-group enforcement

> **Active plan.** ROADMAP §1.1 NT-5 item. Picked up after the
> post-[MT-11] Phase 3 retro-doc dispatch shipped earlier this
> session (`origin/lt-4` at `84907d3`). The retro-doc dispatch
> plan + review section is preserved below for traceability — see
> "Prior dispatch in this session" header.

**Difficulty:** ★★ (2/5) — small, contained data-layer fix matching
an existing render-layer filter. Touches 2 handlers + 1 helper on
each side (C++ and JS mock) + new contract tests.

**Effort estimate:** ~3-4 hours including drafting, tests,
verification, FF + push.

**Owner:** this session (`claude/festive-hoover-6abdbf`).

**Target:** fast-forward into `lt-4` and push to `origin/lt-4` at end.

**Status:** plan drafted 2026-05-25 after codebase exploration
confirmed the 2 host handlers + 2 mock handlers and the existing
render-layer filter at
[`computeLinkGroupBrackets`](../web/apps/editor/src/lib/link-group-colors.ts:51).
**Awaiting user OK before any code edits.**

---

## 1. Goal + scope

**Goal.** When any mutation leaves a link group with exactly one
member, auto-demote that lone member to `linkGroup = 0` before
the operation returns. The data layer ends up matching the
render-layer's existing filter
([`computeLinkGroupBrackets:71`](../web/apps/editor/src/lib/link-group-colors.ts:71)
already hides single-member groups from the gutter). Inspector
panels reading `linkGroup` directly will then show `0` for
de-facto-unlinked emitters instead of "Link Group: 3" on an
emitter with no bracket.

**In:**

- **C++ host.** New private helper
  `BridgeDispatcher::EnforceSingleMemberLinkGroups()` that walks
  the current particle system's emitters, counts members per
  positive `linkGroup`, and demotes the lone member to 0 for any
  group with count = 1. O(N) sweep.
- Call the new helper from inside the **three** handlers that
  can leave singletons:
  1. `linkGroups/set-membership` (covers ROADMAP paths 1 + 3 —
     same handler). Mutation + sweep both captured by the
     pre-existing `captureUndo()`.
  2. `emitters/delete` (covers ROADMAP path 2). Same undo
     coverage.
  3. `file/open` after `*m_pParticleSystem = std::move(loaded)`
     at [`BridgeDispatcher.cpp:1589`](../src/host/BridgeDispatcher.cpp:1589)
     — **load-time sweep** so old `.alo` files with pre-NT-5
     singletons self-correct on open. NOT marked dirty (the
     correction is a normalization, not user-driven mutation;
     a dirty bit would force a save-prompt on every open of a
     legacy file). `EmitEmittersTreeChanged()` at line 1619
     propagates the corrected state to React subscribers.
  `file/new` doesn't need the sweep — fresh ParticleSystem has
  one root emitter at `linkGroup = 0`, no singleton possible.
- **JS mock.** Mirror helper `enforceSingleMemberLinkGroups(tree)`
  in [`mock-state.ts`](../web/apps/editor/src/bridge/mock-state.ts)
  + chain it into the existing `setLinkGroupMembership` and
  `deleteEmitter` mock helpers. Pure function over the immutable
  tree DTO — fits the existing pattern.
- **bridge-schema.** No changes — wire shape is unchanged. The
  enforcement is invisible from the bridge contract; only the
  resulting tree state differs.
- **New vitest contract tests** in
  [`bridge-contract.test.ts`](../web/apps/editor/src/bridge/__tests__/bridge-contract.test.ts)
  covering each path:
  1. Leaving a 2-member group → both members at `linkGroup = 0`
  2. Deleting one of 2 members → survivor at `linkGroup = 0`
  3. `set-membership { ids: [single], groupId: -1 }` → that
     emitter ends at `linkGroup = 0`, no new group created
  4. 3-member group losing one → 2 members stay in the group
     (regression guard against over-eager demotion)
- **New Playwright spec** entry in
  [`emitter-mutations.spec.ts`](../web/apps/editor/tests/emitter-mutations.spec.ts)
  covering the same invariants against the C++ host. One end-to-end
  test per path; uses the existing `installBridgeProxy` pattern.
- **CHANGELOG entry** with TODO-HASH/TODO-PR placeholders matching
  Phase 3 + lessons-retro-doc pattern. Section title plain prose
  ("Engine-side single-member link-group enforcement (NT-5)").
- **End-of-session FF + push** per CLAUDE.md branch workflow.

**Out:**

- **ROADMAP.md update.** Per CLAUDE.md, ROADMAP items get
  strikethrough + ✅ Shipped #NN **when they merge to master**, not
  to lt-4. NT-5 hasn't reached master yet; the strikethrough +
  `✅ Shipped (#NN)` lands in a later master-merge dispatch. Leaving
  ROADMAP.md alone here.
- **NT-6 (visual-stability lane assignment for bracket gutter)** —
  separate roadmap item, explicitly conditioned on user feedback.
- **Other mutation paths** beyond the two named. Surveyed during
  pre-coding:
  - `emitters/duplicate-with-index-increment` — duplicate inherits
    source's `linkGroup`. Duplicating a sole member of a group
    bumps count from 1 → 2 (group becomes valid; no further
    enforcement needed at duplicate time AND would actually defeat
    the data-layer demotion that should have already fired when
    the group went to 1 member). Not in scope.
  - `emitters/drop` (reparent / reorder) — does not touch
    `linkGroup`. Not a hazard path.
  - `emitters/import-from-file` — currently throws "Phase 3+ not
    implemented" in the mock; native handler missing entirely
    (G1 from post-audit-followups). Not in scope.
- **L-022 audit of NT-5 itself.** The ROADMAP entry was authored
  during MT-9 / MT-10 (per its mention of `kBracketPalette` and the
  B1 render-layer filter); the 3 enumerated mutation paths describe
  current handler state accurately based on this dispatch's pre-
  coding verification. No retraction needed.

## 2. What the codebase already gives us

- **C++ host:** [`src/host/BridgeDispatcher.cpp:2429`](../src/host/BridgeDispatcher.cpp:2429)
  is the `emitters/delete` handler. [`src/host/BridgeDispatcher.cpp:3233`](../src/host/BridgeDispatcher.cpp:3233)
  is the `linkGroups/set-membership` handler. Both call
  `captureUndo()` before mutating + `EmitEmittersTreeChanged()`
  after. The new helper inserts cleanly between mutation and emit.
- **C++ tree access:** `m_pParticleSystem->get()->getEmitters()`
  returns the flat `vector<Emitter*>` used by the existing
  `groupId == -1` scan at
  [`BridgeDispatcher.cpp:3257`](../src/host/BridgeDispatcher.cpp:3257)
  — same iteration pattern fits the enforce helper.
- **JS mock:** [`mock-state.ts:620`](../web/apps/editor/src/bridge/mock-state.ts:620)
  is `setLinkGroupMembership`. [`mock-state.ts:409`](../web/apps/editor/src/bridge/mock-state.ts:409)
  is `deleteEmitter`. Both return a new immutable tree DTO; the
  new enforce helper chains in as `enforce(setLinkGroupMembership(...))`
  before the caller's `setTree(...)` call.
- **Render-layer reference:** [`link-group-colors.ts:51-79`](../web/apps/editor/src/lib/link-group-colors.ts:51)
  `computeLinkGroupBrackets` already counts members per group
  and filters `range.count < 2`. The new helper uses the same
  counting pattern (Map<groupId, count>) — porting the existing
  shape to a data-layer pass.
- **Existing contract-test patterns:**
  [`bridge-contract.test.ts:463`](../web/apps/editor/src/bridge/__tests__/bridge-contract.test.ts:463),
  `:635`, `:741`, `:742` already assert `linkGroup === 0` on
  known-detached emitters. New tests follow the same
  `expect(node.linkGroup).toBe(0)` shape.
- **Existing Playwright spec:**
  [`emitter-mutations.spec.ts`](../web/apps/editor/tests/emitter-mutations.spec.ts)
  is the natural home for the end-to-end test — covers the same
  mutation surface.

## 3. Architecture / implementation approach

The fix is **post-mutation full-tree sweep** ("Option α"), not
incremental tracking ("Option β"). Reasoning:

- Trees are tiny in practice (typically <100 emitters); O(N) sweep
  is sub-millisecond. The `groupId == -1` branch in
  `set-membership` already does an O(N) tree walk; we're adding
  one more.
- Mirrors the render-layer filter's logic (count members per
  group, treat count < 2 specially) — the data-layer pass becomes
  the same shape, just mutating instead of filtering.
- Incremental tracking would need to know which groups were
  "affected" by each mutation — derivable but adds code, and is
  brittle to future mutation paths. Full sweep is robust.

**C++ implementation:**

New private helper in `BridgeDispatcher.{h,cpp}`:

```cpp
// Walk the current particle system's emitters; for every positive
// linkGroup with exactly one member, demote that member's
// linkGroup to 0. Matches the render layer's
// `computeLinkGroupBrackets` filter (which hides single-member
// groups from the gutter) so data and view agree end-to-end.
// O(emitters) — uses two passes: first to count, second to
// demote. Idempotent: a second call is a no-op.
void BridgeDispatcher::EnforceSingleMemberLinkGroups();
```

Called from two sites:

1. `linkGroups/set-membership` — inserted between the `for (const
   auto& v : idsJson)` loop (line 3275-3281) and the `sendOk` call
   (line 3282).
2. `emitters/delete` — inserted after the `sys->deleteEmitter(target)`
   call (line 2445) and the wasSelected block (lines 2447-2459),
   before the `sendOk` (line 2461).

Both sites already have `captureUndo()` upstream — the auto-demotion
is captured in the same undo snapshot as the explicit mutation.

**JS mock implementation:**

New exported helper in [`mock-state.ts`](../web/apps/editor/src/bridge/mock-state.ts):

```typescript
/** Sweep the tree and demote any linkGroup that has exactly one
 *  member down to 0. Idempotent. Mirrors the host-side
 *  EnforceSingleMemberLinkGroups + the render-layer's
 *  computeLinkGroupBrackets filter — keeps data and view in
 *  agreement end-to-end. */
export function enforceSingleMemberLinkGroups(
  tree: EmitterTreeDto,
): EmitterTreeDto;
```

Wired into the two existing mutation helpers:
- `setLinkGroupMembership` returns `enforce(walked)` instead of
  `walked`
- `deleteEmitter` returns `enforce(prunedTree)` instead of
  `prunedTree`

The implementation is a two-pass walker: pass 1 counts groups,
pass 2 mapNode-style rewrites singletons.

**bridge-contract.test.ts additions:** Four new tests under the
existing `describe("linkGroups/set-membership", ...)` and
`describe("emitters/delete", ...)` blocks. Each test seeds a tree
fixture with a known linkGroup configuration, dispatches the
mutation, then asserts the resulting tree's linkGroup values.

**emitter-mutations.spec.ts addition:** One new test
`"single-member link group auto-demotes data layer"` that exercises
all three paths against the C++ host via the existing bridge proxy.
Uses the same fixture-loading pattern as the existing tests in
that file.

**CHANGELOG entry:** Following the established shape — section title
plain prose, italicized date line with TODO-HASH/TODO-PR
placeholders, three paragraphs (What ships / How we tackled it /
Issues encountered if any).

## 4. Risks named up front + mitigations

1. **Risk — Fixture brittleness.** The mock fixture in
   `mock-state.ts:165-204` has roots "Smoke" + "Sparks" at
   `linkGroup: 1` and "Flash" at `linkGroup: 0`. With NT-5's
   enforcement, the fixture's initial state remains valid (Smoke +
   Sparks = 2 members in group 1). But if any contract test
   currently asserts a single-member-group existence, it'd break.
   *Mitigation:* before drafting code, grep `bridge-contract.test.ts`
   for `linkGroup: <positive>` assertions and verify each tested
   scenario stays valid post-enforcement. The current `linkGroup
   === 0` assertions (lines 463, 635, 741, 742) are unaffected.

2. **Risk — Undo snapshot drift.** Both handlers call
   `captureUndo()` upstream of the mutation. The auto-demotion fires
   *after* the snapshot but *before* `sendOk`, so it's part of the
   "post-mutation" state. Ctrl-Z restores the pre-mutation state
   including the original (pre-demotion) linkGroup values. *Mitigation:*
   write a vitest test that explicitly verifies the undo round-trip:
   create a 2-member group, leave it (triggering demotion of the
   survivor), undo, verify the survivor's linkGroup is restored to
   its original positive value.

3. **Risk — Idempotence + repeated dispatch.** The enforcement is
   idempotent (a second call after the first produces no further
   change). But what if two unrelated singleton groups exist BEFORE
   the dispatch (e.g. left over from a pre-NT-5 saved file)?
   The enforcement will demote both on first dispatch, which is
   correct behavior. *Mitigation:* document this in the new helper's
   docstring and write a regression test that seeds a tree with
   two pre-existing singletons + invokes any handler; verify both
   get demoted.

4. **Risk — Saved-file compatibility.** `.alo` files saved before
   NT-5 ships may contain single-member groups. The save format
   already round-trips `linkGroup` per emitter. *Mitigation:*
   added a third call site for `EnforceSingleMemberLinkGroups()`
   in the `file/open` handler at
   [`BridgeDispatcher.cpp:1589`](../src/host/BridgeDispatcher.cpp:1589),
   firing right after the new ParticleSystem is bound. The
   sweep does NOT call `SetDirty(true)` (the correction is a
   normalization, not user-driven mutation — marking dirty would
   force a save-prompt on every open of a legacy file). The
   existing `EmitEmittersTreeChanged()` already fires at line 1619
   so React subscribers see the corrected tree on first render.
   Saved-file compatibility added per user-scope decision during
   plan check-in.

5. **Risk — `getEmitterById` returning nullptr in the new helper.**
   The `getEmitters()` accessor returns the raw vector;
   non-null-checked iteration would crash. *Mitigation:* match the
   existing `groupId == -1` scan's null-check pattern
   ([`BridgeDispatcher.cpp:3260`](../src/host/BridgeDispatcher.cpp:3260)
   — `if (emitters[i] != nullptr && ...)`).

6. **Risk — Sweep ordering vs `sys->deleteEmitter`'s recursion.**
   `deleteEmitter(target)` recursively deletes target's subtree.
   If a subtree's emitters held linkGroup memberships, the survivor
   counts change in two ways simultaneously — but the post-deletion
   sweep sees the final state and demotes correctly. *Mitigation:*
   write a test where a 2-member group has both members as
   subtree-deletion victims (deleting the root deletes both → no
   group exists after deletion → enforcement no-op). Then a test
   where one member is deleted's subtree, other survives elsewhere
   (group → 1 member → demote).

## 5. Testing & verification

**Pre-coding survey:**

- [ ] Grep `bridge-contract.test.ts` for `linkGroup: <positive>`
      assertions — verify no existing test depends on a pre-existing
      singleton
- [ ] Grep `mock-state.ts` fixture for any singleton groups in the
      initial state
- [ ] Verify the existing fixture has Smoke + Sparks both at
      `linkGroup: 1` (count = 2; not a singleton)

**Format / build checks:**

- [ ] `pnpm --filter @particle-editor/editor lint` (tsc --noEmit) — 0
      errors
- [ ] `pnpm --filter @particle-editor/editor test` (vitest) — all
      previous 338 tests still pass + new tests pass; expected count
      after NT-5: 338 + ~6 new tests ≈ 344
- [ ] MSBuild Debug + Release x64 clean (Compositor.cpp and other
      LT-4 code paths unchanged — sanity)

**Behavioral checks (new vitest tests):**

- [ ] `linkGroups/set-membership` leaving a 2-member group: BOTH
      members at `linkGroup = 0` post-dispatch
- [ ] `linkGroups/set-membership` joining a different group that
      shrinks the previous group to 1 member: previous-group survivor
      at `linkGroup = 0`
- [ ] `linkGroups/set-membership { ids: [single], groupId: -1 }`:
      single emitter ends at `linkGroup = 0` (the "new group with 1
      member" path — demoted before sendOk)
- [ ] `emitters/delete` of one member of a 2-member group: survivor
      at `linkGroup = 0`
- [ ] `emitters/delete` of a member of a 3-member group: remaining
      2 members STAY at the original linkGroup (regression guard)
- [ ] Undo round-trip: 2-member group → leave → demote → undo →
      original linkGroups restored
- [ ] Load-time sweep — host-side only; covered by a new C++ or
      Playwright spec that loads an `.alo` fixture containing a
      pre-existing singleton group and verifies the post-load tree
      has that emitter at `linkGroup = 0` + the dirty bit stayed
      clean (file/open completed with `SetDirty(false)`)

**Behavioral checks (new Playwright spec):**

- [ ] End-to-end equivalent of the leave-2-member-group case
      against the C++ host (verifies the host-side
      EnforceSingleMemberLinkGroups + mock parity)

**Pre-handoff smoke (CLAUDE.md "Pre-handoff testing — exhaustive"):**

- [ ] `git status` clean working tree before each commit
- [ ] `git diff --stat` matches what the dispatch claims to touch
- [ ] Build the binary (`ParticleEditor.exe` Debug x64) and confirm
      it launches without crashing — the new handler runs on every
      `linkGroups/set-membership` and `emitters/delete` so a smoke
      launch + one of each mutation via the legacy UI proves the
      C++ side wires up cleanly
- [ ] tsc + vitest pass on the post-edit tree

**Commit boundary.**

One commit covering all of: BridgeDispatcher + mock-state +
bridge-contract.test additions + emitter-mutations.spec addition +
CHANGELOG entry + todo.md review section. Conventional-commit
prefix: `feat(LT-4):` (matches NT-5's status as a roadmap item
shipping new behavior). Subject:
`feat(LT-4): [NT-5] engine-side single-member link-group enforcement`.

**FF + push:** Same as prior dispatches —
`git push origin claude/festive-hoover-6abdbf:lt-4` since the
main worktree has master checked out and the other-worktree FF
pattern isn't available here. Atomic FF-only on origin.

---

## Review (post-dispatch)

**All seven plan items shipped.** What landed against the plan:

| Item | Shipped | Notes |
|---|---|---|
| C++ helper + 2 mutation call sites | ✓ | `EnforceSingleMemberLinkGroups` in BridgeDispatcher.cpp; called from `linkGroups/set-membership` and `emitters/delete` |
| C++ load-time sweep (Q1 scope-add) | ✓ | Third call site at `file/open` line 1589, after `*m_pParticleSystem = std::move(loaded)`. NOT `markDirty()`-triggered |
| JS mock helper + 2 helper call sites | ✓ | `enforceSingleMemberLinkGroups` exported from mock-state.ts; chained into `setLinkGroupMembership` + `deleteEmitter` returns |
| 5 new vitest contract tests | ✓ | path 1, path 1b, path 2, 3-member regression guard, idempotence. + 1 existing test updated for the path-3 contract change |
| 2 new Playwright tests | ✓ | Leave-and-delete invariants against the C++ host via the existing bridge |
| CHANGELOG entry | ✓ | Inserted above the lessons retro-doc entry; TODO-HASH/TODO-PR placeholders matching Phase 3 + retro-doc pending pattern |
| FF + push | (pending verification + commit) | Same `git push origin claude/festive-hoover-6abdbf:lt-4` pattern as the retro-doc dispatch |

**Deviations from the plan:**

- Dropped the planned **undo round-trip vitest test** — the
  MockBridge throws "Phase 3+ not implemented" for `undo/perform`,
  so undo testing can only happen against the C++ host. The C++
  side gets undo coverage by reading the diff (both call sites are
  downstream of pre-existing `captureUndo()` so the snapshot is
  pre-mutation, including pre-demotion linkGroups) — verified by
  code review, not a new automated test.
- Dropped the planned **standalone load-time Playwright spec**
  (item #14's test-fixture half) — would have required hand-crafting
  an `.alo` fixture with a known pre-existing singleton group (the
  current host save-then-load path already enforces post-mutation, so
  a clean save can't produce a singleton). The implementation is a
  single-line call site; the helper itself is independently tested
  via the mutation paths.

**Risks that materialised vs the §4 list:**

- R1 (fixture brittleness): triaged — existing test at
  bridge-contract.test.ts:732 encoded the OLD path-3 contract and was
  updated as part of this dispatch (intentional contract change).
- R2 (undo): mitigated by code review of the `captureUndo()` site
  ordering instead of an automated test.
- R3 (idempotence): covered by the new idempotence vitest test.
- R4 (saved-file compatibility): closed inline via the load-time
  sweep call site at `file/open`.
- R5 (nullptr in helper): handled — `EnforceSingleMemberLinkGroups`
  null-checks every emitter pointer matching the existing
  groupId==-1 scan pattern.
- R6 (sweep ordering vs `deleteEmitter`'s recursion): the
  3-member regression guard exercises this path.

**Verification:**

- vitest **343/343** ✓ (was 338; +5 NT-5 tests).
- tsc `--noEmit` ✓ (lint script).
- MSBuild Debug x64 — see post-dispatch summary for status.
- Playwright native tests — NOT run this session (would require
  full dist/ rebuild + exe launch + CDP attach; ~5-10min); 2 new
  tests added to emitter-mutations.spec.ts and ready for the next
  native run.

---

## Prior dispatch in this session — Post-[MT-11] Phase 3 retro-doc

(Preserved verbatim from before NT-5 dispatch picked up.)

---

# Post-[MT-11] Phase 3 dispatch — lessons retro-doc (L-019/L-020/L-021/L-022) + HANDOFF correction

> **Active plan.** Post-[MT-11] Phase 3 close-out hygiene work. Phase 3
> shipped on `origin/lt-4` at `65da3d4` (all 5 stages). The Phase 3
> plan that previously lived in `tasks/todo.md` is archived at
> [`todo-mt-11-phase-3-archive.md`](todo-mt-11-phase-3-archive.md).

**Difficulty:** ★★ (2/5) — docs-only, low-risk, four new lessons.md
entries plus a HANDOFF correction note retracting one stale claim. No
code changes. No test changes.

**Effort estimate:** ~3 hours (drafting + format + verification + FF).

**Owner:** this session (`claude/festive-hoover-6abdbf`).

**Target:** fast-forward into `lt-4` and push to `origin/lt-4` at end.

**Status:** plan drafted 2026-05-25 after pre-flight surfaced Option C
(`ResetParameters` projection-push fix) as a non-bug. Option C
replaced with new lesson L-022. **Awaiting user OK before any
`lessons.md` / HANDOFF / CHANGELOG edits.**

---

## 1. Goal + scope

**Goal.** Formalize three lesson patterns that Stage 4 and Stage 5 surfaced
but never landed as `tasks/lessons.md` entries (L-019 DXSDK linker-twin,
L-020 spike-vs-production const audit, L-021 verify rendered geometry —
combined-math edition), plus a fourth (L-022) discovered during this
session's pre-flight: handoff claims about latent bugs require fresh
first-party code verification before they enter a dispatch's plan.

The four lessons close out Phase 3 documentation hygiene. Future sessions
inheriting Phase 3 territory get fully-formed rules in lessons.md instead
of having to re-derive them from CHANGELOG paragraphs and HANDOFF prose.

**In:**

- New `tasks/lessons.md` entry **L-019** — DXSDK linker-twin
  (`CreateDXGIFactory2` `LNK2019` → `CreateDXGIFactory1` + QI to
  `IDXGIFactory2`). Linker-side parallel to L-016's header-side
  pattern. Source incident: Stage 4b first-build `LNK2019 unresolved
  external CreateDXGIFactory2`.
- New `tasks/lessons.md` entry **L-020** — When porting a spike to
  production, audit every const/enum the spike picked against the
  production workload's actual data flow. Source incident: Stage 4d.1
  `DXGI_ALPHA_MODE` PREMULTIPLIED → IGNORE pivot.
- New `tasks/lessons.md` entry **L-021** — Verify rendered geometry,
  combined-math edition. Sub-plans describing independent components
  correctly can still produce broken combined math if the combined math
  isn't walked pixel-by-pixel. Source incident: Stage 5 T6 Iter 1
  scene-rect displacement bug.
- New `tasks/lessons.md` entry **L-022** — Handoff-claim verification
  against current code. When a HANDOFF or next-session-prompt describes a
  "latent bug" or carries a TODO from a prior session, verify the claim
  against current code BEFORE planning a fix. Prior-session reasoning
  may have been correct when written and stale now, or wrong from the
  start (reasoning by analogy without re-reading the cited site).
  Source incident: this session's pre-flight, where the prompt's claim
  of a latent `ResetParameters` projection-not-pushed bug dissolved on
  reading [`src/engine.cpp:1734`](../src/engine.cpp:1734) (`ResetParameters`
  ends with `SetCamera(m_eye)` which pushes the projection — has done
  since Initial import `0d352ae`).
- **HANDOFF.md correction** retracting the spurious "latent
  `ResetParameters` projection-push bug" claim (currently in "Known
  follow-ups (out of scope for Stage 5)" item 2). Remove the item;
  renumber 3/4/5 → 2/3/4; add a short Retractions sub-section citing
  L-022 + the verification finding.
- **CHANGELOG entry** per CLAUDE.md "Roadmap items: update `ROADMAP.md`
  and `CHANGELOG.md` when a feature ships." Lessons-retro-doc and a
  HANDOFF correction are NOT a feature ship — but CLAUDE.md's CHANGELOG
  guidance applies to "anything non-cosmetic worth remembering."
  Single short entry; not a full feature-style entry. The L-022
  incident in particular is worth a paragraph in changelog so a future
  contributor doesn't re-derive the same "the prompt was wrong"
  finding.
- **End-of-session FF flow** per CLAUDE.md branch workflow: `git switch
  lt-4` → `git merge --ff-only claude/festive-hoover-6abdbf` →
  `git push`. Lineage already confirmed clean at session start.

**Out:**

- Option C (`ResetParameters` projection-push fix) — dissolved during
  pre-flight as a non-bug. No code edit to make. The L-022 lesson is
  the replacement deliverable.
- Option A (Phase 3 close-out a11y suite + final acceptance smoke) —
  awaiting user gate on whether still wanted. Surfaced to user at
  session start; not started this dispatch.
- Option D (next roadmap item / post-audit P1 drainage) — separate
  dispatch. Roadmap doc explicitly redirects to
  [`post-audit-followups.md`](post-audit-followups.md) for P1s before
  fresh roadmap work, which is its own non-trivial planning exercise.
- L-022's broader scope (e.g. "every doc file should be verified") —
  the rule is scoped to handoff claims about latent bugs and similar
  carry-forward TODOs. Broader doc-rot is not in scope.

## 2. What the codebase already gives us

- [`tasks/lessons.md`](lessons.md) — 18 existing entries with stable
  format. The **Rule / Trigger / How to apply / Source incident /
  Cross-reference** shape is set by L-001 through L-018. L-016 (Stage 3a
  DXSDK header shadowing) is the natural sibling for L-019 (the
  linker-side twin) — cross-reference the two.
- [`CHANGELOG.md`](../CHANGELOG.md) Stage 4 entry — "Issues encountered
  and resolutions" section already has the long-form context for L-019
  (`LNK2019` → `CreateDXGIFactory1` + QI) and L-020 (PREMULTIPLIED →
  IGNORE alpha pivot). The retro-doc work is **distillation** of that
  prose into the Rule / Trigger / How to apply form, not investigation.
- `CHANGELOG.md` Stage 5 entry — "Issues encountered and resolutions"
  has the four T6 iteration bugs documented in detail; Iter 1
  (displacement) is the source for L-021.
- [`tasks/stage-5-smoke-result.md`](stage-5-smoke-result.md) — the
  iter-by-iter bug log referenced by the Stage 5 CHANGELOG. Worth
  pulling specific phrasing for the L-021 source-incident paragraph.
- [`tasks/HANDOFF.md`](HANDOFF.md) "Known follow-ups (out of scope for
  Stage 5)" item 2 — the claim we need to retract.
- [`src/engine.cpp:1654`](../src/engine.cpp:1654) (`ResetParameters`) —
  the file:line citation for the L-022 source incident.
- [`src/engine.cpp:998`](../src/engine.cpp:998) (`SetCamera`) — the
  file:line citation showing the projection push that the "latent bug"
  claim missed.
- `git log -S "SetCamera(m_eye)"` outputs `0d352ae Initial import` —
  the evidence that this is not a recent regression.

## 3. Architecture / implementation approach

Four lesson entries + one HANDOFF correction + one short CHANGELOG
entry. Each lesson uses the baseline shape from L-001/L-017/L-018:
**Rule / Trigger / How to apply / Source incident (date, context) /
Cross-reference**. L-016's more elaborated shape (Two-part fix, Also
requires) is the exception, not the rule — only adopted if a lesson
genuinely needs the elaboration.

**Drafting order** (each independent — sequential keeps the lessons.md
diff coherent and lets the L-022 incident verification anchor the rest):

1. **L-019 — DXSDK linker-twin.** Title: *"Legacy DXSDK June 2010 also
   shadows Win10 SDK link libraries — `LNK2019 CreateDXGIFactory2`-class
   failures resolve via `CreateDXGIFactory1` + QI, not linker-path
   surgery."* Key points:
   - Rule: DXSDK first in `<AdditionalLibraryDirectories>` ships a
     pre-Win8 `dxgi.lib` missing `CreateDXGIFactory2` and similar
     Win8+ entrypoints. No per-file `<AdditionalLibraryDirectories>`
     exists in MSBuild (link is per-project), so L-016's header-side
     isolation doesn't extend to the linker.
   - How to apply: use `CreateDXGIFactory1` (DXSDK-compatible since
     Win7) and QI for `IDXGIFactory2` / `IDXGIFactory4` etc. as
     needed. Modern-DXGI capability detection becomes a single QI
     chokepoint per `IDXGIFactory*` consumer.
   - Source: distilled from CHANGELOG Stage 4 "Issues encountered"
     §Iter 1.
   - Cross-ref: L-016 (header-side twin) + Compositor.cpp's
     factory-creation code + Stage 4 sub-plan.

2. **L-020 — Spike-vs-production const/enum audit.** Title: *"When
   porting a spike to production, audit every const/enum the spike
   picked against the production workload's actual data flow — spike
   correctness is not transitive."* Key points:
   - Rule: Spikes validate transport/topology under a synthetic
     workload (typically `D3DClear` to solid color, no shaders, no
     blending). Constants the spike picked are correct for that
     workload, not automatically correct for production.
   - How to apply: for each const, ask "What invariant in the spike's
     workload justified this value? Does production hold the same
     invariant?" Cheap audit pass beats user-surfaced visual
     regressions.
   - Source: Stage 4d.1 PREMULTIPLIED → IGNORE alpha pivot.
   - Cross-ref: Compositor.cpp swapchain-desc + Stage 4 sub-plan §3.5.

3. **L-021 — Verify rendered geometry, combined-math edition.** Title:
   *"CLAUDE.md's 'verify rendered geometry, not design intent' rule
   applies to *combined* math across components, not just per-component
   math — walk the pixel path end-to-end before declaring a
   multi-component layout correct."* Key points:
   - Rule: Sub-plans describing Component A and Component B correctly
     individually can still produce broken geometry when the two
     compose, if no one walks the pixel path end-to-end. Per-component
     review catches local errors; combined-math walk catches composition
     errors.
   - How to apply: at sub-plan time, pick a concrete pixel and walk
     it through every component. State the assumed coord space at each
     stage. A 30-second walk-through with sample pixel `(100, 100)`
     and scene-rect `(50, 30, 800, 600)` would have caught Stage 5
     Iter 1.
   - Source: Stage 5 T6 Iter 1 displacement bug — Compositor's local-
     coords-post-offset design and Engine's render-at-scene-rect
     design each correct, combined produced double-offset.
   - Cross-ref: CLAUDE.md "Verify rendered geometry, not design intent"
     + Stage 5 sub-plan + Compositor::SetEngineVisualTransform.

4. **L-022 — Handoff-claim verification against current code.** Title:
   *"Handoff notes and next-session prompts carry claims, not facts —
   verify against current code before any claim enters a dispatch's
   plan."* Key points:
   - Rule: Carry-forward TODO claims in HANDOFF.md or next-session-
     prompts ("latent bug at X", "deferred fix for Y", "should follow
     up on Z") are claims to verify. Prior-session reasoning may have
     been correct when written and stale now (sibling session closed
     the gap), wrong from the start (reasoning by analogy without
     re-reading the cited site), or correct but mis-located (line
     numbers shifted).
   - How to apply: for each carry-forward claim entering the active
     plan — read the cited code at the cited line (find by name if
     lines shifted); trace the data flow; if real, plan the fix; if
     not, retract the claim in HANDOFF.md (don't silently drop it —
     future sessions inheriting the same docs need the retraction).
   - Source: this session, post-[MT-11] Phase 3 dispatch.
     Next-session-prompt and HANDOFF.md described "latent projection-
     not-pushed bug in `ResetParameters`" at `engine.cpp:1518`.
     Pre-flight verification: `ResetParameters` now at
     `engine.cpp:1654` (lines shifted ~136 by Stage 5 additions);
     ends with `SetCamera(m_eye)` at line 1734; `SetCamera` at line
     1014 unconditionally pushes `SetTransform(D3DTS_PROJECTION,
     &m_projection)` and recomputes `m_viewProjection`. `git log -S
     "SetCamera(m_eye)" -- src/engine.cpp` reports the call dates
     to `0d352ae` (Initial import). The "latent bug" was a phantom:
     prior-session author reasoned by analogy from the genuine Stage
     5 `SetSceneViewport` bug without re-reading `ResetParameters`.
     Discovery cost: ~15 min. Hypothetical un-verified cost: a
     duplicate `SetTransform(PROJECTION)` would have shipped right
     before the existing `SetCamera` push — likely harmless,
     possibly a redundant device-state push per resize, contributing
     noise to future readers.
   - Cross-ref: L-018 (AI-audit verification) is the external-source
     parallel; L-022 is the internal-handoff parallel. CLAUDE.md
     "Trust but verify — universally" is the parent principle.

5. **HANDOFF.md correction.** Remove item 2 ("latent
   `ResetParameters` projection-push bug") from "Known follow-ups
   (out of scope for Stage 5)". Renumber 3/4/5 → 2/3/4. Add a new
   "Retractions" sub-section (placed after "Known follow-ups", before
   "Stage 5 commits") with one paragraph citing L-022 + the
   verification finding. Don't strikethrough or comment-out the
   removed item — it's removed cleanly, with the structural lesson
   captured in lessons.md.

6. **CHANGELOG.md entry.** One short entry under the existing date
   2026-05-25, inserted at the top of `## Changelog` (above Stage 5).
   Section title plain prose: *"Lessons retro-doc for [MT-11] Phase 3
   — L-019/L-020/L-021/L-022 formalized; HANDOFF latent-bug claim
   retracted."* Date line with TODO-HASH/TODO-PR placeholders matching
   Stage 5's still-pending hash. Two short paragraphs:
   - **What ships.** Four new lessons.md entries + HANDOFF retraction
     of the spurious `ResetParameters` latent-bug claim.
   - **How we tackled it.** Three of the four lessons were
     distillation from CHANGELOG Stage 4 / Stage 5 prose. The fourth
     (L-022) emerged during pre-flight verification of a carry-forward
     claim that turned out not to hold against current code.
   - Skip "Issues encountered" — docs distillation has no notable
     issues.

7. **End-of-session FF.** Lineage re-check before merge:
   `git fetch origin lt-4 --quiet` → `git log --oneline
   origin/lt-4..HEAD` (should show ~1-2 docs commits from this
   session) → `git log --oneline HEAD..origin/lt-4` (should be 0).
   Then: `git switch lt-4` → `git merge --ff-only
   claude/festive-hoover-6abdbf` → `git push`. If FF fails, STOP per
   CLAUDE.md.

## 4. Risks named up front + mitigations

1. **Risk — L-019/L-020/L-021 source-incident paragraphs misquote
   CHANGELOG prose, drifting from the actual incident.**
   *Mitigation:* before writing each Source incident section, re-read
   the corresponding CHANGELOG paragraph in full. Cite the same dates
   and same line-by-line claims. Don't summarize — quote the
   structural facts (file:line citations, error messages, fix sites)
   verbatim where they appear in CHANGELOG.

2. **Risk — L-022 framed as blame-the-prior-session note instead of a
   structural rule.** The prior session's author wasn't careless; the
   failure mode (reasoning by analogy from a genuine bug to a
   parallel that doesn't hold) is one this collaboration's process
   has hit before (L-018 is the external-input parallel).
   *Mitigation:* write L-022 framed as a process rule, not as
   criticism. The Source incident describes what happened structurally
   (line numbers shifted, analogy not re-verified) without naming the
   session branch or making it about the person. The rule reads as
   "claims-in-docs need verification" the same way L-018 reads as
   "claims-from-AI need verification" — same shape, different source.

3. **Risk — HANDOFF correction goes stale itself when the next
   dispatch reads it.** If we leave a long retraction paragraph
   inline in "Known follow-ups", a future reader has to parse the
   retraction to know item 2 is not actionable. *Mitigation:* remove
   the spurious item entirely from "Known follow-ups", renumber the
   rest, and add a short "Retractions" sub-section citing L-022 as the
   structural lesson. More honest than a strikethrough AND avoids
   future cargo-culting of the false claim.

4. **Risk — CHANGELOG entry's date placement is wrong.** CHANGELOG
   convention is "reverse chronological order, newest at top of
   `## Changelog`." Current top is Stage 5 (`2026-05-25`). This
   entry's date is also 2026-05-25 — "most recently merged sits above
   older ones from the same day." This entry merges AFTER Stage 5, so
   sits ABOVE Stage 5. *Mitigation:* insert directly under the
   `## Changelog` heading, above Stage 5's section. Verify placement
   before committing.

5. **Risk — Cross-references to commits use placeholders we never
   backfill.** Stage 4 and Stage 5 CHANGELOG entries both have
   `TODO-HASH` placeholders. *Mitigation:* match the existing pattern
   — use `TODO-HASH`/`TODO-PR` placeholders. The backfill happens at
   merge-to-master (none of these LT-4 entries have backfilled hashes
   yet); not in scope here.

6. **Risk — Format drift across the four lesson entries.** L-016 is
   slightly more elaborated than L-017/L-018. *Mitigation:* use the
   baseline 5-section shape for L-019/L-020/L-021/L-022. No
   elaborated sub-headings unless a lesson genuinely needs them
   (e.g. L-019's linker-side detail might benefit from a short "Why
   no per-file fix" subsection — judgment call at draft time, biased
   toward simpler).

7. **Risk — Risk of finding another non-bug in the carry-forward TODO
   list mid-dispatch.** L-022's discovery raises the possibility that
   other claims in HANDOFF's "Known follow-ups" are also stale or
   wrong. *Mitigation:* explicitly NOT in scope here. The five other
   items (canvas-architecture fixme, Stage 4e ClearRTV guard, test
   harness env-var check, lessons-retro-doc itself) are not being
   verified in this dispatch. If a future dispatch picks any of them
   up, L-022's rule kicks in then. Flagged in the dispatch summary
   as "audit candidate for a future dispatch."

## 5. Testing & verification

Docs-only dispatch; verification is format + factual + post-edit
pre-flight.

**Format checks (per lesson entry):**

- [ ] L-NNN heading uses `## L-NNN — Title sentence` format
- [ ] All four sections present in order: Rule / Trigger / How to apply
      / Source incident (date, context) / Cross-reference
- [ ] Bold section labels (`**Rule.**`, `**Trigger.**`, etc.) end with a
      period
- [ ] Each entry followed by `---` separator before the next
- [ ] Inline file:line links use markdown form
      `[file](src/path:NNNN)` so readers can jump

**Factual checks (per lesson entry):**

- [ ] L-019 source-incident matches CHANGELOG Stage 4 "Issues
      encountered" §Iter 1 verbatim on file names, line numbers,
      error messages
- [ ] L-020 source-incident matches CHANGELOG Stage 4 "Issues
      encountered" §4d.1
- [ ] L-021 source-incident matches CHANGELOG Stage 5 "Issues
      encountered" §Iter 1 + the displacement-bug pixel math
- [ ] L-022 source-incident matches the actual pre-flight finding
      (line numbers, `git log` commit hash `0d352ae`, function names)
      — re-read [`src/engine.cpp:1654`](../src/engine.cpp:1654) and
      [`src/engine.cpp:998`](../src/engine.cpp:998) once before
      finalizing the paragraph
- [ ] Each Cross-reference link resolves (file path exists, line
      number is plausibly stable)

**HANDOFF correction:**

- [ ] Item 2 ("latent `ResetParameters` projection-not-pushed bug")
      removed from "Known follow-ups (out of scope for Stage 5)"
- [ ] Items 3/4/5 renumbered to 2/3/4 in the same section
- [ ] New "Retractions" sub-section added with one paragraph citing
      L-022 + the verification finding
- [ ] No other HANDOFF content changed (cumulative)

**CHANGELOG entry:**

- [ ] Inserted at top of `## Changelog`, above the Stage 5 entry
- [ ] Date line matches established format with TODO-HASH/TODO-PR
- [ ] Two paragraphs ("What ships" + "How we tackled it" — labels
      bolded with period); no "Issues encountered"
- [ ] Ends with `---` separator before Stage 5's entry

**Pre-handoff smoke (CLAUDE.md "Pre-handoff testing — exhaustive"):**

- [ ] `git status` clean working tree before each commit
- [ ] `git diff --stat` matches what the dispatch claims to touch
      (only `tasks/lessons.md`, `tasks/HANDOFF.md`, `CHANGELOG.md`,
      `tasks/todo.md`, plus the rename
      `tasks/todo.md → tasks/todo-mt-11-phase-3-archive.md`)
- [ ] `pnpm -w test` (vitest) — **338 / 338** unchanged (sanity, no
      React/web touched)
- [ ] `pnpm -w typecheck` (`tsc -b`) — 0 errors (sanity)
- [ ] MSBuild Debug + Release x64 clean — no C++ changes (sanity)
- [ ] Lineage re-check before FF: `git log origin/lt-4..HEAD` shows
      only this session's docs commits; `git log HEAD..origin/lt-4`
      empty

**Manual review pass (post-edit, pre-commit):**

- [ ] Open the new `tasks/lessons.md` in raw form and verify the
      four new entries render without GFM formatting issues (no
      broken tables, no truncated code blocks)
- [ ] Re-read the L-022 source-incident paragraph specifically —
      this one is auto-meta-referential (a lesson about
      verification written from a verification finding) and the
      language risks sounding self-congratulatory. Should read as
      "structural finding worth a process rule," not "I caught
      a thing."
- [ ] Sanity-check the CHANGELOG entry is parseable by the existing
      tooling (matches the date-line regex `\*YYYY-MM-DD · ...\*`)

**Commit boundary.**

Two commits total:

1. **Archive of prior todo.md.** Pure rename
   (`tasks/todo.md` → `tasks/todo-mt-11-phase-3-archive.md`) + this
   new file. Subject: `docs(LT-4): archive Phase 3 todo + draft post-
   Phase 3 dispatch plan`.

2. **Lessons + retraction.** `tasks/lessons.md` additions +
   `tasks/HANDOFF.md` correction + `CHANGELOG.md` entry +
   `tasks/todo.md` review section. Subject: `docs(LT-4): [MT-11]
   Phase 3 lessons retro-doc — L-019/L-020/L-021/L-022 + HANDOFF
   retraction`.

**FF + push:**

- `git switch lt-4`
- `git merge --ff-only claude/festive-hoover-6abdbf`
- If FF fails, STOP and reconcile per CLAUDE.md branch workflow.
- `git push`

---

## Review (post-dispatch)

**All seven plan items shipped this session.** Two commits land on
`claude/festive-hoover-6abdbf`:

1. `45ab36c` — `docs(LT-4): archive Phase 3 todo + draft post-Phase 3 dispatch plan`
   (mechanical rename of the completed Phase 3 todo.md to
   `tasks/todo-mt-11-phase-3-archive.md` + new dispatch plan in
   `tasks/todo.md`).
2. (this commit) — `docs(LT-4): [MT-11] Phase 3 lessons retro-doc — L-019/L-020/L-021/L-022 + HANDOFF retraction`
   (lessons.md +~440 lines, HANDOFF.md restructure with new
   Resolved/Retractions sub-sections, CHANGELOG.md new top entry,
   todo.md review section).

**What landed against the original plan:**

| Plan item | Shipped | Notes |
|---|---|---|
| L-019 DXSDK linker-twin | ✓ | `tasks/lessons.md` lines 1313-1402 |
| L-020 spike-vs-production const audit | ✓ | `tasks/lessons.md` lines 1404-1502 |
| L-021 verify rendered geometry combined-math | ✓ | `tasks/lessons.md` lines 1504-1620 |
| L-022 handoff-claim verification | ✓ | `tasks/lessons.md` lines 1622-1749 |
| HANDOFF retraction | ✓ | "Known follow-ups" restructured + new "Resolved follow-ups" + new "Retractions" sub-sections |
| CHANGELOG entry | ✓ | Inserted above Stage 5 with TODO-HASH/TODO-PR placeholders matching Stage 4+5 pending pattern |
| Phase 3 closing notes line | ✓ | Updated to reflect the (b)=shipped, (c)=retracted state |
| FF + push | (pending verification + commit) | This dispatch's tail |

**Deviations from the plan:** None of substance. The HANDOFF "Resolved
follow-ups" sub-section was a refinement of the plan's §3 item 5
("HANDOFF.md correction") — the plan said "remove item 2 + add
Retractions"; the shipped version also added a "Resolved follow-ups"
sub-section so future readers see *both* what was done this session
(legitimate ship) and what was retracted (phantom claim), not just
the retraction.

**Risks that materialised vs the §4 list:**

- R1 (source-incident drift): mitigated as planned — re-read each
  CHANGELOG paragraph before drafting; verbatim file:line citations
  preserved.
- R2 (L-022 blame framing): mitigated as planned — incident
  paragraph stays structural, names no session branch or prior
  author.
- R3 (HANDOFF retraction staleness): mitigated as planned + slightly
  better — the "Resolved follow-ups" sub-section makes the ship-vs-
  retract distinction explicit, beyond just the retraction.
- R4 (CHANGELOG date placement): confirmed correct — inserted at top
  of `## Changelog`, above Stage 5.
- R5 (TODO-HASH placeholders): used as planned; matches Stage 4+5
  pattern (still pending their own backfill).
- R6 (format drift): mitigated — all four new lessons use the
  baseline 5-section shape; no elaborated sub-headings.
- R7 (other HANDOFF claims): explicitly out of scope; flagged in
  the HANDOFF.md "Known follow-ups" header note so future dispatches
  picking up any of items 1/2/3 apply L-022's rule before scoping.

**Lessons-about-this-session worth capturing:** None new beyond
L-022 itself, which IS this session's structural lesson. The
dispatch ran to plan with no surprises after the Option C
non-bug discovery (which was a pre-flight finding, not a
mid-dispatch surprise).

**For the next dispatch:** the HANDOFF.md "Phase 3 closing notes"
tail now lists only two directions ((a) Phase 3 a11y close-out +
(b) next-roadmap-item / post-audit P1 drainage), down from four.
The remaining "Known follow-ups" list has three items — all
plausible, none re-verified.
