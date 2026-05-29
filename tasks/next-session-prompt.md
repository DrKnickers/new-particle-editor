# Next-session prompt — implement the toolbar consolidation + lucide icon refresh

You are resuming `new-particle-editor`, branch `lt-4`. The previous session
(2026-05-29) shipped feature-parity B (texture palette) + two resize/label
fixes, then **wrote and got user-approval for a plan it did NOT implement**.
Your job is to implement that plan. **`origin/lt-4` is at `ae22c64`.**

## Pre-flight (run before touching anything)

```
git fetch origin lt-4 --quiet
git rev-parse --abbrev-ref HEAD                            # lt-4 or a fresh claude/* off lt-4
git log --oneline origin/lt-4..HEAD | Measure-Object -Line # expect 0
git log --oneline HEAD..origin/lt-4 | Measure-Object -Line # expect 0
git status --porcelain                                     # expect empty
git rev-parse origin/lt-4                                  # expect ae22c64 (or newer)
```
If lineage doesn't match, STOP and reconcile per `CLAUDE.md` branch-workflow.

Then build + verify baseline:
- `Set-Location web; pnpm --filter @particle-editor/editor test` → expect **366 passed**.
- `pnpm --filter @particle-editor/editor build` → tsc + dist clean.
- (No C++ changes are needed for this task, so MSBuild isn't on the
  critical path — but the a11y harness launches `ParticleEditor.exe`, so
  a current `x64\Release` build helps for the regen/smoke.)

## The task — PLAN IS WRITTEN AND APPROVED; IMPLEMENT IT

Read **[`tasks/todo.md`](todo.md)** — the full 5-section plan, user-approved.
**Do not re-brainstorm or redesign; implement it.** The icon set and toolbar
grouping are already decided. Verify file:line references against the code
before acting (they may have drifted — L-022), and summarize your
understanding before changing anything.

**One-paragraph what:** remove the floating viewport pill; move its three
engine toggles into the toolbar as lucide icon buttons; change the Spawner
toggle from text to an icon. Icon set (all lucide-react, themeable via
`currentColor`): **Show ground = `Grid2x2`, Bloom = `Sun`, Leave particles =
`Sparkles`, Spawner = `CirclePlus`.** Delete the old hardcoded-blue
`public/icons/icon-{ground,bloom,particles}.svg`. The three toggles go in
their own toolbar group between playback and the Spawner button.

**The hard part is the a11y goldens, not the UI move.** The toolbar is
captured in ~every a11y golden (both lanes), so this is gated on the **L-030
harness fix**: force a known UI state (light theme + Spawner-visible — the
canonical capture state) in the a11y setup so a blanket regen is
deterministic, then regenerate BOTH lanes and use `git diff --stat` as the
gate — the ONLY changes allowed are the toolbar region (in every surface) +
the removed `viewport-pill.*` files. If unrelated surfaces drift, the L-030
fix is incomplete — STOP. Remove the dedicated `viewport-pill` a11y surface
(driver + 2 goldens). See plan §3b / §3c / §4 and lessons **L-026 / L-028 /
L-030**.

## Build / test gotchas (unchanged; see lessons.md L-025..L-030)

- **MSBuild via PowerShell**, not Git Bash (L-025); against the `.sln` at the
  worktree root (the PowerShell CWD may drift — use absolute paths):
  `& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" .\ParticleEditor.sln /p:Configuration=Release /p:Platform=x64 /nologo /verbosity:minimal /m`
- **pnpm from `web/`**. vitest: `pnpm --filter @particle-editor/editor test`
  (baseline **366**). Type-check / dist: `pnpm --filter @particle-editor/editor build`.
- **a11y goldens (the meat):**
  - Composition lane (default): `pnpm --filter @particle-editor/editor a11y:update`
    (dist already composition).
  - HWND/legacy lane: `node ./scripts/run-native-tests.mjs --legacy --update --rebuild`
    (the `--rebuild` flips dist to legacy). **Then `pnpm build` again to
    restore composition dist** — else the live editor loads a legacy dist
    (plan Risk 3).
  - HWND goldens: full-suite `--update` only, NEVER `--grep` (Radix `useId`
    render-sequence dependence — L-028).
  - After regen: `git diff --stat web/apps/editor/tests/a11y-goldens/` must
    show only toolbar-region + removed-pill changes (plan Risk 1). Run the
    read-only a11y lane twice and confirm identical (determinism check).
- **dist/ mode gate**: `run-native-tests.mjs` fail-fasts on a hosting-mode
  mismatch; `--rebuild` builds the right one.
- **Live smoke**: `x64\Release\ParticleEditor.exe --new-ui`, **mod selected**
  (L-029). Confirm: no pill; 3 toggles + Spawner icon in the toolbar; each
  flips engine state + shows pressed; icons correct in BOTH dark and light.

## Process (per CLAUDE.md — non-negotiable)

- The plan is already written + approved → skip brainstorm; go straight to
  implement (vitest-first for the toolbar toggles) → verify (build + vitest +
  a11y regen + live smoke) → CHANGELOG + lessons (note the L-030 fix landing)
  → todo.md review section → commit → FF-push to `origin/lt-4`
  (`git push origin HEAD:lt-4`; `lt-4` is checked out in the main worktree, so
  push to the remote directly).
- Archive `tasks/todo.md` to `tasks/todo-toolbar-consolidation-archive.md`
  before writing any future plan.

## The broader program (make arch-C daily-drivable, to retire 0.2)

| Front | Status |
|---|---|
| Rendering fidelity | ✅ resolved (was mod textures) |
| Feature parity | A (Browse) ✅ · B (palette) ✅ · + more to discover (parity-gap audit recommended next) |
| Performance (legacy hit 200–400 fps maximized) | open |
| UI polish | **toolbar consolidation ← THIS task** · then open |

User still daily-drives the 0.2 legacy build; arch-C must reach parity +
perf before they migrate. (MT-13 arch-A deletion stays gated on that.) After
this UI task, the highest-leverage next step is a **feature-parity gap audit**
(enumerate what the legacy editor still has that the new UI lacks).
