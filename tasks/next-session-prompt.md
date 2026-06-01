# Next-session prompt — LT-4, the F1–F9 UI follow-up backlog

You're picking up `new-particle-editor` (the **AloParticleEditor** rewrite —
Win32 + WebView2/React + D3D9Ex-via-DComp particle editor for Star Wars:
Empire at War), branch **`lt-4`**. Context was handed off in two documents;
treat them as primary context but **verify important claims against the actual
code before acting** (file:line refs drift — L-022).

Last session (5) shipped an arch-C perf fix (~26× faster maximized) plus a run
of inspector UI polish, all on `origin/lt-4` and **user-confirmed**. No
in-flight bug. This session is a fresh pick from the **F1–F9 follow-up backlog**
in [`tasks/followups.md`](followups.md) — the user listed these from a live
review. Confirm which item(s) to take before coding; several need a 1-minute
clarification or design call first (flagged in the file).

## Pre-flight (run before touching anything)

```
git fetch origin lt-4 --quiet
git rev-parse --abbrev-ref HEAD                            # lt-4 or a fresh claude/* off lt-4
git log --oneline origin/lt-4..HEAD | Measure-Object -Line # expect 0
git log --oneline HEAD..origin/lt-4 | Measure-Object -Line # expect 0
git status --porcelain                                     # empty
git rev-parse --short origin/lt-4                          # expect 63fb7f2 (or newer)
```
If lineage doesn't match, STOP and reconcile per `CLAUDE.md` branch-workflow.

Then baseline (a **fresh worktree has no `x64\` binaries**; build the **.sln**,
NOT the `.vcxproj`, L-023; restore NuGet first on a fresh worktree):
- From `web/`: `pnpm --filter @particle-editor/editor test` → expect **371 passed** (44 files).
- `pnpm --filter @particle-editor/editor build` → tsc + dist clean, `dist/` composition.
- Native only if running the editor / a11y harness:
  `& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" .\ParticleEditor.sln /p:Configuration=Release /p:Platform=x64 /nologo /verbosity:minimal /m`
  (restore first if it fails on the WebView2 NuGet target:
  `MSBuild .\ParticleEditor.sln /t:Restore /p:RestorePackagesConfig=true /p:Configuration=Release /p:Platform=x64`).

## Primary context (read first, then VERIFY against code)

- **[`tasks/followups.md`](followups.md)** — the F1–F9 backlog. Each item has a
  type tag (bug/feat/polish), code pointers, and the clarification/design call
  needed. **This is the work queue.**
- **[`tasks/HANDOFF.md`](HANDOFF.md)** — top "2026-06-01 (session 5)" section is
  the latest snapshot (the perf fix + the UI-polish run + the deferred pacing).
- **[`tasks/lessons.md`](lessons.md)** — esp. **L-035** (profile per-stage
  before optimising; code-reading mis-points), **L-033** (agent launches *can*
  misrender arch-C — verify visuals via the user, not agent screenshots; it
  didn't bite session 5 but can), **L-030/L-031** (a11y goldens), standing L-022+.
- `CLAUDE.md` — working principles, plan-mode rules, LT-4 branch flow (FF into
  `lt-4`, never `master` without explicit OK).
- **[`tasks/todo.md`](todo.md)** — the DEFERRED arch-C frame-pacing plan (only
  if the editor is ever seen running hot; idle cost measured low, ~20% of a core).

## Suggested first moves (F1–F9)

- **Fast visible wins (CSS):** F2 (center + size the emitter-tree controls like
  the main toolbar), F3 (LMB-pressed icon state on toolbar buttons), F5 (link
  brackets closer to the emitter text, v0.2-style).
- **Bugs:** F4 (**link groups don't actually work** though brackets render —
  investigate host link-group state vs the React bracket render; pairs with F5),
  F6 (number-field **drag scrubs the value instead of selecting text** —
  `Spinner` mousedown, [Spinner.tsx:162](../web/apps/editor/src/primitives/Spinner.tsx:162)).
- **Features (small design call first):** F7 (wheel-adjust step — legacy=0.1),
  F8 (curve-editor multi-key = average, adjustable), F9 (Index channel
  auto-deselects RGBA — extend the existing Scale-exclusivity).
- **Needs a layout sketch:** F1 (emitter-row icon placement — eye left,
  lifetime/on-death right for children; exact layout ambiguous).

**Note the natural pairings:** F4+F5 (both in the link-group/bracket code);
F6+F7 (one "how do number fields respond to mouse" decision).

## Process (per CLAUDE.md — non-negotiable)

- Treat HANDOFF + followups + lessons as primary context, but **verify any
  important claim against the actual code before acting** (file:line drifts).
- **Summarize your understanding of the chosen item(s) before changing
  anything**, and wait for the user to confirm scope. Settle the F1/F7/F8/F9
  clarifications up front.
- 3+ step work → plan mode → `tasks/todo.md` (note: it currently holds the
  deferred pacing plan — archive or work alongside it, don't clobber).
- Web UI changes: rebuild `dist` + clear the WebView2 cache before relaunch
  (L-030); they're CSS/DOM — check whether a captured a11y surface changes
  before regenerating goldens (most inspector changes don't render in goldens).
- When an item ships: update `CHANGELOG.md` (reverse-chron, date-line + 3
  sections; `TODO` hash to backfill at master merge), append a `lessons.md` rule
  after any correction, FF-push to `origin/lt-4` (`git push origin HEAD:lt-4`).
  **Never `master` without explicit OK.**
- Native golden/Playwright runs are single-instance + fixed-port (CDP 9222) —
  run serially (L-031). For CDP use `127.0.0.1`, not `localhost` (L-034).

Before making any changes, summarize your understanding of the project state,
the chosen follow-up item(s), and your planned approach, and wait for me to
confirm.
