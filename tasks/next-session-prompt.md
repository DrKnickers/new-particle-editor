# Next-session dispatch prompt — post HANDOFF item 16 close-out

> Copy the block below into the next session's first message.
> `origin/lt-4` is at `4c20e32`. This file replaces the old [MT-11]
> Phase 4 prompt (long since shipped). Keep it current: when a
> dispatch lands, rewrite this with the new tip + the next candidates.

---

You are picking up work on the `new-particle-editor` repository on branch `lt-4`.
The previous session resolved HANDOFF item 16 (a11y golden drift — root cause was
autocrlf + a runtime BUILD_DATE, NOT a React regression) across four commits, ending
with the volatile-build-date follow-up. `origin/lt-4` is at `4c20e32`.

## Pre-flight (run before touching anything)

```
git fetch origin lt-4 --quiet
git rev-parse --abbrev-ref HEAD                              # lt-4 or a fresh claude/* off lt-4
git log --oneline origin/lt-4..HEAD | Measure-Object -Line   # expect 0 (fresh session)
git log --oneline HEAD..origin/lt-4 | Measure-Object -Line   # expect 0
git status --porcelain                                       # expect empty
git rev-parse origin/lt-4                                    # expect 4c20e32 (or newer)
```
If lineage doesn't match, STOP and reconcile per the branch-workflow section in `CLAUDE.md`.

## CRITICAL build/test gotchas (all learned the hard way — see lessons.md L-025..L-028)

1. **MSBuild MUST be invoked via PowerShell, NOT Git Bash (L-025).** Bash's MSYS path
   translation mangles `/p:` `/nologo` `/m` switches; MSBuild prints MSB1008 but the
   response file gives exit code 0, so the build SILENTLY no-ops and produces no binary.
   Use the PowerShell tool:
   ```
   $msbuild = "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe"
   & $msbuild .\ParticleEditor.sln /p:Configuration=Debug   /p:Platform=x64 /nologo /verbosity:minimal /m
   & $msbuild .\ParticleEditor.sln /p:Configuration=Release /p:Platform=x64 /nologo /verbosity:minimal /m
   ```
   ALWAYS verify `x64\Debug\ParticleEditor.exe` exists after — don't trust exit code 0.
2. **A fresh worktree needs NuGet restore first** (WebView2 package isn't shared across
   worktrees): `& $msbuild .\ParticleEditor.sln /t:Restore /p:Configuration=Debug /p:Platform=x64`
   before the first build. Symptom if skipped: "references NuGet package(s) that are missing …
   Microsoft.Web.WebView2.targets".
3. **pnpm commands run from `web/` (or `web/apps/editor`), not repo root.** From repo root
   pnpm errors `ERR_PNPM_NO_PKG_MANIFEST`. From PowerShell, `Set-Location web` first.
4. **Two dist/ builds, two lanes.** Composition (default, no env var) → `pnpm test:native`.
   Legacy needs a `VITE_HOSTING_MODE=legacy` dist/ rebuild → `pnpm test:native:legacy`.
   The harness does NOT auto-rebuild dist/ on mode change (carry-forward item 4).
   Baselines: composition **157/0/31**, legacy **132/0/56**. Both are 0-failed at `4c20e32`.
5. **`pnpm a11y:update --grep "<id>"` now scopes correctly (L-027), BUT (L-028):**
   - Safe for the **composition** lane (ariaSnapshot = role+name, no IDs).
   - **UNSAFE for the HWND lane** — UIA captures Radix `useId` AutomationIds
     (`radix-_r_1k_`) that depend on render SEQUENCE. A scoped refresh runs the surface
     in isolation → different IDs → a huge bogus diff that only matches in isolation.
     To change one node in an HWND golden, hand-edit it; to regenerate HWND goldens,
     run a FULL-suite `pnpm a11y:update:legacy` (no `--grep`).
6. **Build-environment values in goldens are normalized as volatile (L-028).** The About
   dialog's "Build date" is stripped to `<DATE>` by `normalizeVolatile()` in
   `tests/helpers/toMatchJSONGolden.ts`. If you add another build-stamped value to a
   captured surface, add it to that normalizer rather than chasing the golden.
7. **Known flake:** `a11y-uia-composition-reachable.spec.ts` ("React backbone") is
   Blink-accessibility-warmup-timing-sensitive and flakes on a loaded/laggy machine
   (NOT a golden — doesn't use toMatchJSONGolden). Re-run the single spec via
   `pnpm test:native --grep "React backbone"`; it passes in <1s. Also the documented
   `emitter-mutations.spec.ts:84` flake — same "re-run once" disposition.

## Read these in order

1. `CLAUDE.md` (repo root) — working principles, branch flow, plan-mode + verification +
   handoff rules. Non-negotiable.
2. `tasks/HANDOFF.md` "Known follow-ups" — items 11 (arch-A deletion) and 4 (test-harness
   rebuild gate) are the main open threads. Item 16 is ✅ resolved (fix `610d5dd`,
   completed `a315245`).
3. `tasks/lessons.md` L-025 / L-026 / L-027 / L-028 — the build/test gotchas above.

## Choose your dispatch (ASK the user before locking in — don't assume)

* Candidate A (recommended-large): **Architecture-A deletion (HANDOFF item 11).** The headline
  MT-11/MT-12 cleanup. ★★★★, ~1-1.5 days, needs a full `tasks/todo.md` 5-section plan.
  **GATED:** the user condition is "only delete arch A after C is confirmed stable in default
  daily use." As of 2026-05-28 the user said they were "not really" daily-driving composition
  mode yet. **Confirm the user is now daily-driving architecture C before scoping this.** No
  known runtime blockers remain (items 14 + 15 + 16 all resolved).

* Candidate B (recommended-mid): **Test-harness dist/ rebuild pre-flight gate (carry-forward
  item 4).** The harness should fail-fast or auto-rebuild dist/ on a mode mismatch — would have
  prevented several past sessions' silent dist/mode-mismatch failures. Adjacent to last
  session's `--grep` forwarding fix in the same `run-native-tests.mjs`. ★★, ~half-day.

* Candidate C (other roadmap): NT-6 visual-stability lane assignment (user-gated), B2
  obsolescence audit, MT-1 follow-up texture-picker buttons, the 6 deferred a11y surfaces
  (HANDOFF item 1), or Narrator speech-shaping verification (item 9). See `ROADMAP.md` and
  the HANDOFF "Known follow-ups" list.

## Before making changes, summarise back to the user

1. Which dispatch candidate you've picked and why.
2. Your read of the relevant files (paths + ~one sentence each).
3. Risks you've identified.
4. Any clarifying questions.

Per `CLAUDE.md`: any 3+ step task needs a `tasks/todo.md` plan with all 5 sections
(goal+scope / what-codebase-gives-us / architecture / risks / testing) AND a check-in with
the user before code changes.

## End-of-session flow (worktree note)

`lt-4` is checked out in the main worktree, so `git switch lt-4` fails from a session
worktree. FF directly to the remote instead:
```
git push origin HEAD:lt-4   # FF-only; rejects if not a fast-forward
```
After this, the main-worktree local `lt-4` ref is stale — `git pull --ff-only` there when
convenient.
