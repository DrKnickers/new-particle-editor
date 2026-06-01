# Next-session prompt — verify audit-P1 (F1–F5), then master forward-port

You're picking up `new-particle-editor` (the **AloParticleEditor** rewrite —
Win32 + WebView2/React + D3D9Ex-via-DComp particle editor for Star Wars:
Empire at War), branch **`lt-4`**. Context is in the handoff docs; treat them as
primary but **verify every important claim against the actual code** before acting
(file:line refs drift — L-022).

Last session (7) **shipped the 5 audit-P1 fixes (F1–F5)** on `origin/lt-4`
(`05f7228..f848c86`), build + a11y verified. **Two things remain**, in order:
**(1)** a user-driven GUI round-trip that last session couldn't self-run (L-033),
and **(2)** the master forward-port of F1–F5 (the user's call on timing).

## Pre-flight (run before touching anything)
```
git fetch origin lt-4 --quiet
git rev-parse --abbrev-ref HEAD                            # lt-4 or a fresh claude/* off lt-4
git log --oneline origin/lt-4..HEAD | wc -l               # expect 0
git log --oneline HEAD..origin/lt-4 | wc -l               # expect 0
git status --porcelain                                     # expect clean
git rev-parse --short origin/lt-4                          # expect f848c86 (or newer)
```
If lineage doesn't match, STOP and reconcile per `CLAUDE.md` branch-workflow.

## Baseline
- From `web/`: `pnpm --filter @particle-editor/editor test` → **384 passed** (44 files).
- `pnpm --filter @particle-editor/editor build` → clean.
- Native `.sln` Debug + Release x64 (absolute path; the Debug `LNK4098 LIBCMTD`
  warning is pre-existing/benign):
  `& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" "<repo>\ParticleEditor.sln" /p:Configuration=Debug /p:Platform=x64 /nologo /verbosity:minimal /m`
  - **Fresh worktree?** NuGet restore with no `nuget.exe` on PATH: copy
    `~/.nuget/packages/microsoft.web.webview2/1.0.3967.48/*` →
    `packages/Microsoft.Web.WebView2.1.0.3967.48/` (the `packages.config` layout).
    See **L-039**. Then build.

## Primary context (read first, then VERIFY against code)
- **[`tasks/HANDOFF.md`](HANDOFF.md)** — top "session 7" section: what shipped, the
  five commits, verified state, and the exact NEXT steps.
- **[`tasks/todo.md`](todo.md)** — the audit-P1 plan + the Review section (per-item
  commits, scope decisions, verification, the iterative-DFS note).
- **[`tasks/post-audit-followups.md`](post-audit-followups.md)** — full finding text.
  **G9** (`.meg` index OOB, `[both]` P1) is the audit's recommended bundle-mate for
  the master P1 PR — same untrusted-binary class as F2/F3.
- **[`tasks/lessons.md`](lessons.md)** — esp. **L-038** (native logic gated by
  `pnpm a11y`, not vitest+build), **L-033** (agent native launches misrender —
  verify via the user; the 4 `splitters` a11y failures are this artifact, not a
  regression), **L-039** (fresh-worktree NuGet restore), **L-023/L-025** (.sln).
- `CLAUDE.md` — working principles, plan-mode, LT-4 branch flow (FF into lt-4).

## The work
1. **GUI round-trip verification (user-driven, L-033).** In
   `x64\Release\ParticleEditor.exe --new-ui`: open a real **multi-emitter** `.alo`,
   **save**, **reload**, confirm it loads identically (F2/F3/F4 don't reject valid
   data; the a11y fixture load already covers "valid files load" — this confirms the
   write→reload identity). Optionally force a **save failure** (read-only target) and
   confirm the dirty asterisk + autosave survive and the close is aborted (**F1**).
   If a problem surfaces, fix-forward on lt-4 (FF-push).
2. **Master forward-port of F1–F5** (user decides when). These are `[both]`; cherry-
   pick / port the five fixes onto `master` and **backfill the CHANGELOG `TODO`
   hash/PR** at merge. Strongly consider bundling **G9** (`.meg` index validation)
   into the same PR per the audit's suggested ordering. **Never push `master`
   without explicit OK.**

## Process (per CLAUDE.md)
- Summarize your understanding + confirm scope before doing the forward-port; it's a
  branch operation with merge implications, so align first.
- For any native fix: build Debug+Release, run `pnpm --filter @particle-editor/editor
  a11y` (the 4 `splitters` failures are the known L-033 artifact, not yours).
- When an item lands: update `CHANGELOG.md`, append any lesson, FF-push to the right
  branch. **Never `master` without explicit OK.**

Before changing anything, summarize your understanding of the project state, the
remaining work, and your approach, and wait for me to confirm.
