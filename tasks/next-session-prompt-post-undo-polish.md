# Next-session prompt — post-undo/perform polish chain

> **Copy the block below into the next session's first message.**
>
> Three commits shipped on `origin/lt-4` this session:
> [`e750142`](https://github.com/DrKnickers/new-particle-editor/commit/e750142)
> (undo/perform snap-restore — Ctrl+Z / Ctrl+Shift+Z rewinds the
> ParticleSystem; un-fixme's the NT-5 atomicity Playwright test),
> [`fb57acc`](https://github.com/DrKnickers/new-particle-editor/commit/fb57acc)
> (content-compare dirty bit via `m_savedSnapshot` byte buffer), and
> [`ef164f3`](https://github.com/DrKnickers/new-particle-editor/commit/ef164f3)
> (boot-state baseline init in `BindHostState` + Edit menu Undo/Redo
> enable-state via `canUndo` / `canRedo` on `EngineStateDto` + HANDOFF
> refresh). The undo subsystem on the host is now structurally
> complete and surfaces correctly in the UI.

---

The new-UI undo chain is live on `origin/lt-4` at `ef164f3`. Ctrl+Z /
Ctrl+Shift+Z rewinds the ParticleSystem, selection follows, the
dirty bit clears on undo-back-to-saved-content, and the Edit menu's
Undo/Redo items grey out when nothing is available. Default new-UI
path is byte-identical to the pre-undo baseline for everything
*except* the snap-restore + dirty-compare invariants. Vitest 343/343,
Playwright native **103 + 26 skipped + 0 failed** under default dist/,
MSBuild Debug + Release x64 clean via `.\ParticleEditor.sln` (per
L-023, never against the .vcxproj without `/p:SolutionDir=`).

## Pre-flight (in order)

1. `CLAUDE.md` — working principles, branch workflow, plan
   structure. Pre-handoff discipline applies tighter now since the
   undo subsystem is user-facing and a regression would be loud.
2. `tasks/HANDOFF.md` — current state. Read "What shipped today
   (2026-05-25 — undo/perform polish chain)" + "Known follow-ups".
   Apply [L-022](lessons.md#l-022--handoff-notes-and-next-session-prompts-carry-claims-not-facts--verify-against-current-code-before-any-claim-enters-a-dispatchs-plan)
   verification BEFORE scoping any carry-forward TODO into a plan.
3. `tasks/lessons.md` — L-016 through L-023. L-023 especially:
   invoke MSBuild against `.\ParticleEditor.sln`, never the
   .vcxproj directly without `/p:SolutionDir=<workspace-root>\`.
4. `CHANGELOG.md` top three entries — undo polish (`ef164f3`),
   content-compare (`fb57acc`), snap-restore (`e750142`). All three
   still have `TODO-HASH` / `TODO-PR` placeholders pending the
   eventual master-merge backfill.
5. `tasks/todo.md` (the snap-restore dispatch plan, with the
   §6 "Review (post-impl)" section appended). Useful as the
   reference for the design (Option C+ head-of-history auto-cap) if
   any future work touches the undo subsystem.

## Lineage check

```powershell
git fetch origin lt-4 --quiet
git log --oneline origin/lt-4..HEAD   # 0 if session branched cleanly
git log --oneline HEAD..origin/lt-4   # 0 if session has all the lt-4 work
```

Both should be 0 at session start.

## Pre-coding gate (before any production code edits)

- `pnpm --filter @particle-editor/editor lint` — 0 errors (`tsc --noEmit`)
- `pnpm --filter @particle-editor/editor test` — **343 passed / 343**
- MSBuild Debug + Release x64 clean via
  `MSBuild .\ParticleEditor.sln /p:Configuration=Debug|Release /p:Platform=x64 /m`
  (LIBCMTD warning is the preexisting baseline; unchanged)
- (Optional) Playwright native HWND baseline: **103 passed + 26
  skipped + 0 failed** under default dist/ + no env vars

**dist/-build-mode caveat (still applies)**: the HWND baseline
requires default-mode dist/. Composition mode (122 + 3 + 0) requires
composition-mode dist/. Always rebuild dist/ between modes.

## Open candidate directions

The HANDOFF's "Known follow-ups" list has the full menu. Quick
sizing reference, in increasing effort:

### Tiny (≤30 min) — easy wins

- **F17 P2 verification.** From `tasks/post-audit-followups.md`:
  confirm/refute that `attachedParticleSystem` isn't cleared on
  `LoadFile` / `RestoreFromAutosave`. Pure-verification dispatch
  per L-022. May spawn a small fix or close as non-bug.

### Small (~1-2h)

- **NT-6 visual-stability lane assignment** (ROADMAP §1.2). Add
  opt-in stability-by-groupId lane assignment in
  `computeLinkGroupBrackets` so a bracket's `lane` field doesn't
  bounce between renders. Explicitly user-gated per ROADMAP — only
  worth scoping if lane-bouncing has been observed as a real
  ergonomic issue. Cheap to ship; user-signal required.
- **Coalesce-key tuning for spinner-drag undo.** Today's
  `captureUndo` lambda hard-codes `coalesceKey=0` (never coalesce),
  so a 100-tick spinner drag produces 100 undo entries. Wire the
  `UndoStack::COALESCE_WINDOW_MS` mechanism through with appropriate
  per-mutation keys (mirror legacy `MakeCoalesceKey(EP_CHANGE,
  emitterIdx)`-style keys). Spawned by today's snap-restore work.

### Medium (~3-5h)

- **Full mock-side undo round-trip.** Today's mock `undo/perform`
  is a documented no-op (`{applied: false}`). A real mock undo
  requires snapshotting multiple Zustand stores (engine state,
  emitter tree, emitter properties, link-group exempt, track
  overlay, clipboard) per mutation + deep-cloning restore.
  Non-trivial but well-scoped; would let vitest exercise undo
  semantics in unit tests instead of relying on Playwright.
- **G3 P2 — sendOk(`{ok:false}`) → sendErr migration.** Mechanical
  C++ migration across ~17 sites; breaking change for JS callers
  that await without `.catch()`. Needs caller audit first.

### Large (~1d)

- **Phase 3 a11y close-out.** Stage 3h Playwright
  `page.accessibility.snapshot()` golden suite + Stage 3i
  user-driven Narrator/IME manual. Largest remaining hygiene piece.
- **G1 P2 — `emitters/import-from-file` native handler.** UI
  already calls it; needs UX decisions on parent-child preservation
  with subtree selection, link-group remapping across documents,
  undo granularity. Medium with significant UX conversation.

### Carry-forward / verification needed (per L-022)

- **Stage 4 sub-stage 4e — first-frame `ClearRenderTargetView` guard.**
- **`canvas-architecture.spec.ts` test.fixme markers** (L-012
  instrumentation issue, 3 documented fix approaches).
- **Test harness env-var pre-flight check** (Stage 4f follow-up).

## Recommendation

Most natural pick-up given today's work is finished and the queue
has no urgent dependencies:

- **Quickest contained dispatch**: F17 verification (~30 min). Pure
  L-022 verification work; either closes a P2 as non-bug or spawns
  a small fix.
- **Highest user-perceived polish**: coalesce-key tuning (~1-2h).
  Spinner drags currently produce one undo entry per tick — a real
  ergonomic wart. Spawned by today's snap-restore work, so the
  context is fresh.
- **Largest remaining hygiene**: Phase 3 a11y close-out (~1d).
  Bigger commitment; benefits from a fresh planning window.

If user bandwidth is short: **F17 verification**. If bandwidth is
moderate and undo subsystem polish is the priority: **coalesce-key
tuning**. If bandwidth is long and hygiene is the goal: **Phase 3
a11y close-out**.

## Local master lag

Local `master` in the main worktree at
`C:\Modding\Particle Editor` is still **4 commits behind
origin/master** (carried from the prior session — same lag).
`git pull --ff-only` over there catches it up; no rush.

## Build environment note (per L-023)

Always invoke MSBuild via
`MSBuild .\ParticleEditor.sln /p:Configuration=<Debug|Release> /p:Platform=x64 /m`.
**Do not** invoke it against `src\ParticleEditor.vcxproj` directly —
`$(SolutionDir)` will resolve to `src\` instead of the workspace
root, breaking every `AdditionalIncludeDirectories` entry. NuGet
restore must also be against the .sln
(`MSBuild .\ParticleEditor.sln /t:Restore /p:Configuration=Debug /p:Platform=x64`).
Full explanation at [`lessons.md` L-023](lessons.md#l-023--invoke-msbuild-against-the-sln-not-the-vcxproj-directly-when-the-project-uses-solutiondir-macros-in-include--library-paths).

## Context window note

This session burned a moderate amount of context across three
medium-sized ships (snap-restore + content-compare + boot-baseline /
menu-enable-state). A fresh session has plenty of room for any of
the candidate directions above with margin for sub-planning + a
moderate iteration loop.

## Notes on today's undo subsystem (cross-reference for any future undo work)

- **Convention**: new-UI mutation handlers call `captureUndo()`
  **PRE-mutation** at 22 call sites in
  [`BridgeDispatcher.cpp`](../src/host/BridgeDispatcher.cpp). The
  snapshot at `entries[cursor-1]` represents the state *before*
  the mutation runs. Different from legacy `main.cpp:864 CaptureUndo`
  which runs POST-mutation. The convention mismatch is handled by
  the head-of-history auto-cap inside `undo/perform`.
- **`undo/perform` design (Option C+)**: when `Cursor() == Depth()`
  (live end of history) and stack is non-empty, the handler
  auto-captures the current live state before calling `Undo()`.
  This restores the cursor invariant locally so `UndoStack::Undo`'s
  math returns the correct snapshot. See [`tasks/todo.md`](todo.md)
  §3 for the full trace.
- **`ApplyUndoSnapshot` teardown order**: kill attached PS pointer →
  `Engine::Clear` → swap unique_ptr → `OnParticleSystemChanged(-1)`
  → `ReloadTextures`. Mirrors legacy [`RestoreFromSnapshot`](../src/main.cpp:916)
  at `src/main.cpp:916`. Wrapped in
  `UndoStack::BeginApplying`/`EndApplying`.
- **Dirty-bit content-compare**: `m_savedSnapshot` byte buffer on
  `BridgeDispatcher`. Refreshed on `file/new` + `file/open` +
  `file/save` + `file/save-as` success + at boot via
  `ResetSavedBaseline()`. `ApplyUndoSnapshot` uses
  `SetDirty(buf != m_savedSnapshot)`. Bypasses legacy
  `UndoStack::MarkSaved` / `IsAtSavedState`, which doesn't fit the
  PRE-mutation captureUndo convention.
- **Edit menu enable-state**: `canUndo` / `canRedo` fields on
  `EngineStateDto`, populated via
  `BridgeDispatcher::ComputeCanUndo()` (auto-cap-aware: returns true
  when `cursor==depth && depth>=1` OR `cursor>=2`). React
  `MenuBar.tsx` binds `disabled={!state?.canUndo}` /
  `disabled={!state?.canRedo}` on the Edit menu items.
- **Mock-side**: `undo/perform` returns `{applied: false}` (no-op);
  `canUndo` / `canRedo` default to false. Documented limitation.
