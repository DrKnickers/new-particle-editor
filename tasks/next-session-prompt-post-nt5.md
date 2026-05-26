# Next-session prompt — post-[NT-5] + post-Phase-3 retro-doc

> **Copy the block below into the next session's first message.**
>
> Three commits shipped on `origin/lt-4` in the prior session:
> Phase 3 retro-doc + L-019/L-020/L-021/L-022 lessons, NT-5
> engine-side single-member link-group enforcement, and the NT-5
> follow-up verification pass with the load-time fixture and
> `--gen-nt5-fixture` CLI tool. Plus L-023 on MSBuild
> `$(SolutionDir)` resolution. Worktree cleanup recovered ~1.2 GB.

---

[NT-5] shipped — engine-side single-member link-group enforcement is
live on `origin/lt-4` at `<TIP-HASH>` (replace at session start;
prior session's final tip was `b2abe27` + the L-023 commit on top).
Default new-UI path (env vars unset) is byte-identical to the
pre-NT-5 baseline for everything except the four NT-5 invariants
(mutation-paths + load-time sweep). Vitest **343/343**, Playwright
native **102 + 27 + 0** under default dist/, MSBuild Debug + Release
x64 clean via `.\ParticleEditor.sln` (per L-023, never via the
.vcxproj directly without `/p:SolutionDir=`).

## Pre-flight (in order)

1. `CLAUDE.md` — working principles, branch workflow, plan
   structure. Pre-handoff discipline applies tighter post-NT-5 since
   the data-layer-matches-render-layer invariant is now load-bearing
   in user-visible behaviour.
2. `tasks/HANDOFF.md` — current state. Read "Resolved follow-ups"
   (lessons retro-doc shipped, NT-5 shipped), "Retractions" (the
   spurious `ResetParameters` claim), and "Known follow-ups" (still
   3 items: Stage 4 ClearRTV guard, canvas-architecture fixme, test
   harness env-var pre-flight). Apply [L-022](lessons.md#l-022--handoff-notes-and-next-session-prompts-carry-claims-not-facts--verify-against-current-code-before-any-claim-enters-a-dispatchs-plan)
   before scoping any of them.
3. `tasks/lessons.md` — L-016 through L-023. L-019/L-020/L-021/L-022
   are the post-Phase-3 retro-doc additions; L-023 is the build-
   environment finding from this session. Read L-023 BEFORE invoking
   MSBuild — the canonical incantation is
   `MSBuild .\ParticleEditor.sln /p:Configuration=Debug /p:Platform=x64 /m`,
   not the .vcxproj.
4. `CHANGELOG.md` top two entries — the NT-5 ship + the NT-5 follow-
   up. Both still have `TODO-HASH` / `TODO-PR` placeholders pending
   the eventual master-merge backfill.
5. `ROADMAP.md` — `[NT-5]` is shipped but not yet struck through
   (per CLAUDE.md, ROADMAP updates fire on the master-merge, not the
   lt-4 ship). [NT-6] (visual-stability lane assignment) is the next
   queued §1 item but explicitly conditioned on user feedback;
   probably skip unless that signal exists.

## Lineage check

```powershell
git fetch origin lt-4 --quiet
git log --oneline origin/lt-4..HEAD   # 0 if session branched cleanly from origin/lt-4
git log --oneline HEAD..origin/lt-4   # 0 if session has all the lt-4 work
```

Both should be 0 at session start.

## Pre-coding gate (before any production code edits)

- `pnpm --filter @particle-editor/editor lint` — 0 errors (`tsc --noEmit`)
- `pnpm --filter @particle-editor/editor test` — **343 passed / 343**
- MSBuild Debug + Release x64 clean via
  `MSBuild .\ParticleEditor.sln /p:Configuration=Debug|Release /p:Platform=x64 /m`
  (LIBCMTD warning is the preexisting baseline; unchanged)
- (Optional) Playwright native HWND baseline: **102 passed + 27
  skipped + 0 failed** under default dist/ + no env vars
- (Optional) Composition-mode native rebuild — see
  `tasks/HANDOFF.md` "How to run composition mode locally"

**dist/-build-mode caveat (still applies)**: the HWND baseline (102 +
27 skipped) requires default-mode dist/; composition mode (122 + 3 +
0 — pre-NT-5 count; NT-5's 3 new tests may also land in composition
mode making it 125 + 3) requires composition-mode dist/. Always
rebuild dist/ between modes.

## Open candidate directions

Pick whichever fits your bandwidth and the user's priority. The
first two are small close-outs; the third is moderate; the fourth
opens new feature work.

### Option A — Implement `undo/perform` snap-restore

The host-side `undo/perform` handler at
[`BridgeDispatcher.cpp:1405-1430`](../src/host/BridgeDispatcher.cpp:1405)
routes the request through `UndoStack::Undo()` but doesn't apply the
snapshot. The comment block at lines 1421-1425 names the missing
work: "Deserialize the snapshot, hand it to the engine, fire
EmitEngineStateChanged." Closing this completes a long-standing
deferred Phase 3 piece AND un-fixmes the NT-5 atomicity test at
[`web/apps/editor/tests/emitter-mutations.spec.ts`](../web/apps/editor/tests/emitter-mutations.spec.ts)
(the `test.fixme(...)` for "NT-5: undo restores the pre-mutation
linkGroups").

Effort: ~3-4h. Needs to understand `UndoStack`'s snapshot
serialization (probably mirrors `ParticleSystem::write` from
ParticleSystem.cpp), wire deserialize+swap into the handler,
verify the round-trip preserves NT-5's atomicity contract.

### Option B — Phase 3 a11y close-out

`tasks/HANDOFF.md`'s Phase 3 closing notes still list Stage 3h (UI
Automation a11y suite) + Stage 3i (Narrator/IME manual smoke) as
deferred. F8 (composition-controller async-failure fallback) shipped
via PR #88, so the fallback half of Stage 3h is done; the
UI-Automation test surface is what's left.

Effort: 3h ~1d cheap (Playwright `page.accessibility.snapshot()` +
golden file); 3i ~0.5d user-driven Narrator+IME.

### Option C — `[NT-6]` visual-stability lane assignment

ROADMAP §1.2. Add an opt-in "stability-by-groupId" lane assignment
in `computeLinkGroupBrackets` so a bracket's `lane` field doesn't
bounce between renders when surrounding groups change. The ROADMAP
entry explicitly says "Only worth doing if real use reveals the
bouncing as a real ergonomic issue" — needs user signal before
scoping.

Effort: small (~1-2h including tests).

### Option D — Drain a P2 from `tasks/post-audit-followups.md`

P1s all shipped via PRs #86-#91. Remaining P2 items per the doc:

- **F17** UNVERIFIED `attachedParticleSystem` not cleared on
  LoadFile / RestoreFromAutosave — apply L-022 verification first.
- **G1** `emitters/import-from-file` native handler missing (UX
  decisions needed on parent-child preservation, link group
  remapping, undo granularity).
- **G3** `sendOk({"ok": false, ...})` migration to proper `sendErr`
  — breaking change for JS callers without `.catch()`; needs caller
  audit.

Effort: varies. F17 verification is ~30 min; G1 is medium with UX
conversation; G3 is mechanical but breaking.

### Option E — Take this session's known follow-ups seriously

`tasks/HANDOFF.md` "Known follow-ups" lists three remaining items
inherited from the Stage 5 dispatch (all still unverified per the
L-022 rule):

1. Stage 4 sub-stage 4e — first-frame `ClearRenderTargetView` guard.
   Not observed during smoke; ship-if-surfaces.
2. `canvas-architecture.spec.ts` test.fixme markers — pre-existing
   Phase 2 instrumentation fault, three fix approaches documented.
3. Test harness env-var pre-flight check — harness should fail-fast
   or auto-rebuild on ALO_* / VITE_* mismatch.

Each is a candidate dispatch. Verify the claim against current code
first per L-022 before scoping.

## Recommendation

If user bandwidth is short: **Option C ([NT-6])** is the smallest
contained win, but explicitly user-gated. **Option A
(`undo/perform` snap-restore)** is the most valuable structural fix
and closes a real deferred TODO. **Option D F17 verification** is
the cheapest pure-verification dispatch (~30 min).

If user bandwidth is long: **Option B (Phase 3 a11y close-out)** is
the largest remaining hygiene piece and benefits from a fresh
planning window.

## Known follow-ups Stage 5 did NOT close (still open)

Carried forward in `tasks/HANDOFF.md` "Known follow-ups":

1. **Stage 4 sub-stage 4e** (first-frame ClearRenderTargetView guard).
2. **`canvas-architecture.spec.ts` test.fixme markers** (L-012
   instrumentation issue) — three documented fix approaches.
3. **Test harness env-var pre-flight check** (Stage 4f follow-up).

## Worktree note

This session ran in
`C:\Modding\Particle Editor\.claude\worktrees\festive-hoover-6abdbf`.
The next session will get a fresh `claude/<random>` worktree
branched from `origin/lt-4` automatically. Local `master` in the
main worktree at `C:\Modding\Particle Editor` is **4 commits behind
origin/master** as of this session's wrap — a `git pull --ff-only`
over there catches it up; no rush.

## Build environment note (per L-023)

Always invoke MSBuild via
`MSBuild .\ParticleEditor.sln /p:Configuration=<Debug|Release> /p:Platform=x64 /m`.
**Do not** invoke it against `src\ParticleEditor.vcxproj` directly —
`$(SolutionDir)` will resolve to `src\` instead of the workspace
root, breaking every `AdditionalIncludeDirectories` entry. Full
explanation at [`lessons.md` L-023](lessons.md#l-023--invoke-msbuild-against-the-sln-not-the-vcxproj-directly-when-the-project-uses-solutiondir-macros-in-include--library-paths).
NuGet restore must also be against the .sln
(`MSBuild .\ParticleEditor.sln /t:Restore /p:Configuration=Debug /p:Platform=x64`).

## Context window note

The prior session burned ~50% of 1M context across the retro-doc,
NT-5 ship, NT-5 follow-up, worktree cleanup, and L-023. A fresh
session should have plenty of room for any of Options A-E above,
with margin for sub-planning + a moderate iteration loop.
