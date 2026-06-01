# Next-session prompt — audit-P1 thread is CLOSED (both branches); resume LT-4 roadmap

You're picking up `new-particle-editor` (the **AloParticleEditor** rewrite —
Win32 + WebView2/React + D3D9Ex-via-DComp particle editor for Star Wars:
Empire at War), branch **`lt-4`**. Context is in the handoff docs; treat them as
primary but **verify every important claim against the actual code** before acting
(file:line refs drift — and "remaining work" can be already-done — L-022).

## Status: audit-P1 is done on both branches

- **lt-4:** F1–F5 shipped session 7 (`05f7228..f848c86`); **GUI round-trip verified
  PASS** session 8 (user-driven open→save→reload identity, L-033).
- **master:** F1–F5 + G9 **already shipped 2026-05-24 via PR #89** (`709bd82`,
  independent master-side implementation). **There is no master forward-port to do** —
  the session-6/7 handoffs claimed one, but master has carried these for a week
  (the L-022 trap; see session-8 HANDOFF for the full finding). **Do not cherry-pick
  F1–F5 to master** — it would duplicate/conflict.
- **lt-4 ↔ master F1–F5 diverge** (exception type, F4 coverage, F5 gate) — a
  reconciliation note for the eventual LT-4→master integration, NOT a task now.
  Details in the session-8 HANDOFF entry.

So: the audit-P1 thread is closed. Resume normal **LT-4 roadmap** work
(`ROADMAP.md`) or whatever the user directs.

## Pre-flight (run before touching anything)
```
git fetch origin lt-4 --quiet
git rev-parse --abbrev-ref HEAD                            # lt-4 or a fresh claude/* off lt-4
git log --oneline origin/lt-4..HEAD | wc -l               # expect 0
git log --oneline HEAD..origin/lt-4 | wc -l               # expect 0
git status --porcelain                                     # expect clean
```
If lineage doesn't match, STOP and reconcile per `CLAUDE.md` branch-workflow.

## Baseline
- From `web/`: `pnpm --filter @particle-editor/editor test` → **384 passed** (44 files).
- `pnpm --filter @particle-editor/editor build` → clean. **This also produces
  `web/apps/editor/dist/`, which the native `--new-ui` editor serves via the
  `app.local` virtual-host mapping.** On a fresh worktree you MUST run this before
  launching `--new-ui`, or the WebView shows `ERR_NAME_NOT_RESOLVED` for `app.local`
  (the `dist` folder is missing). See **L-040**.
- Native `.sln` Debug + Release x64 (absolute path; the Debug `LNK4098 LIBCMTD`
  warning is pre-existing/benign):
  `& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" "<repo>\ParticleEditor.sln" /p:Configuration=Debug /p:Platform=x64 /nologo /verbosity:minimal /m`
  - **Fresh worktree?** NuGet restore with no `nuget.exe` on PATH: copy
    `~/.nuget/packages/microsoft.web.webview2/1.0.3967.48/*` →
    `packages/Microsoft.Web.WebView2.1.0.3967.48/` (the `packages.config` layout).
    See **L-039**. Then build.

## Primary context (read first, then VERIFY against code)
- **[`tasks/HANDOFF.md`](HANDOFF.md)** — top "session 8" section: the GUI round-trip
  result, the master-already-has-F1–F5 finding, and the divergence note. Session 7
  below it: what shipped on lt-4.
- **[`tasks/post-audit-followups.md`](post-audit-followups.md)** — full finding text.
  F1–F5 + G9 are now marked shipped on both branches.
- **[`tasks/lessons.md`](lessons.md)** — esp. **L-040** (fresh-worktree `--new-ui`
  needs the React `dist`), **L-038** (native logic gated by `pnpm a11y`, not
  vitest+build), **L-033** (agent native launches misrender — verify via the user;
  the 4 `splitters` a11y failures are this artifact), **L-039** (fresh-worktree
  NuGet restore), **L-022** (handoff "remaining work" is a claim — verify it isn't
  already done), **L-023/L-025** (.sln).
- `CLAUDE.md` — working principles, plan-mode, LT-4 branch flow (FF into lt-4).

## Process (per CLAUDE.md)
- For any native fix: build Debug+Release, run `pnpm --filter @particle-editor/editor
  a11y` (the 4 `splitters` failures are the known L-033 artifact, not yours).
- When an item lands: update `CHANGELOG.md`, append any lesson, FF-push to the right
  branch. **Never `master` without explicit OK.**

Before changing anything, summarize your understanding of the project state and
your approach, and wait for confirmation.
