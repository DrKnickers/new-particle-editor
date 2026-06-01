# Next-session prompt — audit P1 fixes (F1–F5) on lt-4

You're picking up `new-particle-editor` (the **AloParticleEditor** rewrite —
Win32 + WebView2/React + D3D9Ex-via-DComp particle editor for Star Wars:
Empire at War), branch **`lt-4`**. Context is in the handoff docs; treat them as
primary but **verify every important claim against the actual code** before acting
(file:line refs drift — L-022).

Last session (6) shipped the whole F1–F9 UI follow-up backlog + the native
link-group fix (F4), all on `origin/lt-4` and user-validated. **This session:
the 5 audit P1 bug fixes** — a plan is already written in `tasks/todo.md` and
the work is **NOT started** (sites were verified, no fix code written).

## Pre-flight (run before touching anything)
```
git fetch origin lt-4 --quiet
git rev-parse --abbrev-ref HEAD                            # lt-4 or a fresh claude/* off lt-4
git log --oneline origin/lt-4..HEAD | wc -l               # expect 0
git log --oneline HEAD..origin/lt-4 | wc -l               # expect 0
git status --porcelain                                     # expect clean
git rev-parse --short origin/lt-4                          # expect 5bf0645 (or newer)
```
If lineage doesn't match, STOP and reconcile per `CLAUDE.md` branch-workflow
(last session hit a 2-commit divergence — see HANDOFF for how it was rebased).

## Baseline
- From `web/`: `pnpm --filter @particle-editor/editor test` → **384 passed** (44 files).
- `pnpm --filter @particle-editor/editor build` → tsc + dist clean.
- Native (these fixes are native — you WILL need this): build the **`.sln`**
  (NOT the `.vcxproj`, L-023; restore NuGet first on a fresh worktree) Debug AND
  Release x64:
  `& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" "<repo>\ParticleEditor.sln" /p:Configuration=Debug /p:Platform=x64 /nologo /verbosity:minimal /m`
  (Debug `LNK4098 LIBCMTD` warning is pre-existing/benign.) Use the **absolute**
  .sln path — the PowerShell tool's cwd can drift.

## Primary context (read first, then VERIFY against code)
- **[`tasks/todo.md`](todo.md)** — the audit-P1 plan (goal/scope, per-item fix
  shape, risks, testing). **This is the work queue.**
- **[`tasks/HANDOFF.md`](HANDOFF.md)** — top "2026-06-01 (session 6)" section:
  the verified site details for each fix + the test/build state.
- **[`tasks/post-audit-followups.md`](post-audit-followups.md)** — full P1 finding
  text. **The audit's own F1–F5 numbering ≠ the UI F1–F9** (naming collision).
- **[`tasks/lessons.md`](lessons.md)** — esp. **L-038** (native host logic is
  gated by `pnpm a11y`, NOT vitest+build — run the native suite before pushing),
  **L-033** (agent native launches misrender/differ — verify via the user),
  **L-030** (don't blanket-regen a11y goldens), **L-023/L-025** (build the .sln).
- `CLAUDE.md` — working principles, plan-mode, LT-4 branch flow (FF into lt-4).

## The work (all in shared legacy `src/`, land on lt-4 per the user)
1. **F1** save-failure data loss — [main.cpp:1466](../src/main.cpp:1466): gate the
   post-save bookkeeping on `bool ok = SaveParticleSystem(...)`. Audit the host
   path too ([BridgeDispatcher.cpp:1620](../src/host/BridgeDispatcher.cpp:1620)).
2. **F2** `ChunkReader::readString()` heap over-read — [ChunkReader.cpp:90](../src/ChunkReader.cpp:90).
3. **F3** chunk-depth overflow — [ChunkReader.cpp:65](../src/ChunkReader.cpp:65) +
   [ChunkWriter.cpp:8](../src/ChunkWriter.cpp:8) ([ChunkFile.h:27](../src/ChunkFile.h:27)).
4. **F4** cyclic/multi-parent loader guard — [ParticleSystem.cpp:1071](../src/ParticleSystem.cpp:1071), new `ValidateEmitterGraph()`.
5. **F5** uint16 particle-index cap — [EmitterInstance.cpp:133](../src/EmitterInstance.cpp:133) `AllocateParticle()`.

Out of scope: audit-F6 (TextureManager/Reset, needs a `--test-host` repro first),
audit-F7 (already fixed on lt-4). Forward-port to master is the user's later call.

## Process (per CLAUDE.md — non-negotiable)
- The plan exists; **summarize your understanding + re-verify the first site before
  editing**, then proceed item by item (each is independently committable).
- **Verify natively (L-038):** after building Debug+Release, run
  `pnpm --filter @particle-editor/editor a11y` — `emitter-mutations`/`bridge-native`
  must pass; the **4 `splitters` failures are a known agent-window artifact**
  (L-033), not your change. Round-trip save→load a real `.alo` in the running
  editor (`x64\Release\ParticleEditor.exe --new-ui`) so F2/F3/F4 don't reject
  valid files. (Web UI relaunch needs a WebView2 cache clear, L-030; CDP uses
  127.0.0.1 not localhost, L-034.)
- When an item lands: update `CHANGELOG.md` (TODO hash placeholder), append any
  lesson, FF-push to `origin/lt-4` (`git push origin HEAD:lt-4`). **Never `master`
  without explicit OK.**

Before changing anything, summarize your understanding of the project state, the
chosen fixes, and your approach, and wait for me to confirm.
