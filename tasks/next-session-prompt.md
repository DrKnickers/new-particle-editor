# Next-session prompt — LT-4, after the toolbar consolidation

You are resuming `new-particle-editor`, branch `lt-4`. The previous session
(2026-05-30) **shipped the toolbar consolidation + lucide icon refresh** and
four follow-on UI polish fixes the user found during smoke-testing. All of it
is on `origin/lt-4`; there is **no half-finished work**. This session you pick
the next LT-4 item (see "What's next" below).

**`origin/lt-4` is at `6ec99ff`.**

## Pre-flight (run before touching anything)

```
git fetch origin lt-4 --quiet
git rev-parse --abbrev-ref HEAD                            # lt-4 or a fresh claude/* off lt-4
git log --oneline origin/lt-4..HEAD | Measure-Object -Line # expect 0
git log --oneline HEAD..origin/lt-4 | Measure-Object -Line # expect 0
git status --porcelain                                     # empty (ignore .claude/scheduled_tasks.lock)
git rev-parse origin/lt-4                                  # expect 6ec99ff (or newer)
```
If lineage doesn't match, STOP and reconcile per `CLAUDE.md` branch-workflow.

Then baseline (note: a **fresh worktree has no `x64\` binaries** — the a11y
harness needs Debug, live smoke needs Release; build both up front if missing,
MSBuild via PowerShell against the `.sln`, per L-025/L-023):
- `Set-Location web; pnpm --filter @particle-editor/editor test` → expect **367 passed**.
- `pnpm --filter @particle-editor/editor build` → tsc + dist clean, `dist/` composition.

## Primary context (read first, then VERIFY against code — file:line drifts, L-022)

- **[`tasks/HANDOFF.md`](HANDOFF.md)** — the "2026-05-30 session" section at the
  top is the full snapshot of what just shipped, the known issues, and the
  environment quirks (tool-output stalls; serial-only native runs).
- **[`CHANGELOG.md`](../CHANGELOG.md)** — top entry documents the toolbar
  consolidation in detail; the **Open Issues** section now lists the
  skydome/particle-alpha bug.
- **[`tasks/lessons.md`](lessons.md)** — read **L-030** (now resolved; the
  `seedCanonicalUiState` a11y-seed pattern) and the new **L-031** (never run
  native/Playwright runs in parallel — single-instance, fixed CDP port 9222).
  Also the standing L-022..L-029 build/test gotchas.
- `CLAUDE.md` — working principles, plan-mode rules, LT-4 branch flow (FF into
  `lt-4`, never `master` without explicit OK).

## What's next (pick one with the user; nothing is pre-decided)

The toolbar UI-polish front is **done**. The broader program is making arch-C
daily-drivable so the user can retire the 0.2 legacy build:

| Front | Status |
|---|---|
| Rendering fidelity | ✅ resolved (was mod textures) — but see skydome-alpha bug below |
| Feature parity | A (Browse) ✅ · B (palette) ✅ · **more to discover** |
| Performance (legacy hit 200–400 fps maximized) | open |
| UI polish | toolbar consolidation ✅ · then open |

Highest-leverage candidates (discuss with the user, brainstorm→plan→implement):

1. **Feature-parity gap audit** — enumerate what the legacy editor still has
   that the new UI lacks. This was the recommended next step at the end of the
   toolbar work; it scopes the remaining parity items before MT-13 (arch-A
   deletion) can be unblocked.
2. **Skydome → particle alpha-blending bug** (filed in `CHANGELOG.md` Open
   Issues). Engine-level, self-contained, user-visible. Applying a background
   skydome (Background slots 1–11) breaks particle alpha; solid-colour bg is
   fine. Likely a D3D9 render-state the skydome pass leaves changed
   (`Engine::RenderSkydome` in [`src/engine.cpp`](../src/engine.cpp) +
   [`src/Resources/Engine/Skydome.fx`](../src/Resources/Engine/Skydome.fx)).
   First step: frame-diff (RenderDoc/PIX or the `--capture` headless tool) at
   the particle draw call, with vs without a skydome.
3. **Performance** — legacy hit 200–400 fps maximized; profile arch-C.

## Build / test gotchas (unchanged; see lessons L-022..L-031)

- **MSBuild via PowerShell** (L-025), against the `.sln` at the worktree root,
  absolute path:
  `& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" .\ParticleEditor.sln /p:Configuration=Release /p:Platform=x64 /nologo /verbosity:minimal /m`
  (and `Configuration=Debug` for the a11y harness binary).
- **pnpm from `web/`.** vitest: `pnpm --filter @particle-editor/editor test`
  (baseline **367**). Type-check/dist: `pnpm --filter @particle-editor/editor build`.
- **a11y goldens** (only if your change renders in a captured surface — L-030):
  - Composition lane: `pnpm --filter @particle-editor/editor a11y:update`.
  - HWND/legacy lane: `node ./scripts/run-native-tests.mjs --legacy --update --rebuild`,
    **then `pnpm build` again** to restore composition dist.
  - **Run native lanes SERIALLY (L-031)** — one host at a time, port 9222 is
    fixed and the exe is single-instance. Parallel runs collide → spurious exit 1.
  - The a11y `seedCanonicalUiState` seed (light + Spawner-visible) is now in
    every a11y spec's `beforeAll`; goldens are pinned to that canonical state.
  - HWND goldens: full-suite `--update` only, never `--grep` (L-028).
  - `git diff --stat` the goldens as the gate — only your surface should change.
- **Known flake:** `splitters.spec.ts` fails 4 on full-suite native runs (L-014
  `react-resizable-panels` measurement flake) but passes 6/6 in isolation —
  makes the run exit 1 with **0 a11y mismatches**; don't misread it.
- **Live smoke:** `x64\Release\ParticleEditor.exe --new-ui`, **mod selected**
  (L-029). From-anywhere PowerShell launcher:
  `Start-Process -FilePath "<worktree>\x64\Release\ParticleEditor.exe" -ArgumentList "--new-ui" -WorkingDirectory "<worktree>"`

## Process (per CLAUDE.md — non-negotiable)

- Treat HANDOFF + CHANGELOG + lessons as primary context, but **verify any
  important claim against the actual code before acting** (file:line drifts).
- **Summarize your understanding of the chosen task before changing anything.**
- 3+ step work → plan mode → `tasks/todo.md`, check in with the user before
  starting. Archive the old `tasks/todo.md` before writing a new plan (the
  prior one is at `tasks/todo-toolbar-consolidation-archive.md`).
- When an item ships: update `ROADMAP.md` (if tagged) + `CHANGELOG.md`, append
  a `lessons.md` rule after any correction, FF-push to `origin/lt-4`
  (`git push origin HEAD:lt-4`).

## Tooling note from last session

The tool-output channel stalled intermittently (commands ran but output didn't
always render; a few parallel batches were cancelled). If you hit it: run
native/build steps **one at a time**, write results to a temp file, and confirm
against `git` (authoritative) rather than a possibly-dropped echo. Early on,
the Read tool also returned fabricated content for non-existent paths once —
cross-check file existence with `ls`/`git` before trusting a Read of an
unfamiliar path.
