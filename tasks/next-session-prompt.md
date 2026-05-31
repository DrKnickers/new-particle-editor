# Next-session prompt — LT-4, post viewport-seam fix

You're picking up `new-particle-editor` (the **AloParticleEditor** rewrite —
a Win32 + WebView2/React + D3D9Ex-via-DComp particle editor for Star Wars:
Empire at War), branch **`lt-4`**. Context was handed off in two documents;
treat them as primary context but **verify important claims against the actual
code before acting** (file:line refs drift — L-022).

**The 1px viewport-edge seam is DONE** (session 4, commit `3728967`, on
`origin/lt-4`, user-confirmed). There is **no carried-over bug**. This session
is a fresh pick from the standing LT-4 backlog — the recommended item is the
**feature-parity gap audit** (mostly discovery/read; output is a prioritized
list of what the legacy 0.2 editor still has that the new UI lacks). Confirm
with the user before committing to it — they may have something else in mind.

## Pre-flight (run before touching anything)

```
git fetch origin lt-4 --quiet
git rev-parse --abbrev-ref HEAD                            # lt-4 or a fresh claude/* off lt-4
git log --oneline origin/lt-4..HEAD | Measure-Object -Line # expect 0
git log --oneline HEAD..origin/lt-4 | Measure-Object -Line # expect 0
git status --porcelain                                     # empty
git rev-parse origin/lt-4                                  # expect 3728967 (or newer)
```
If lineage doesn't match, STOP and reconcile per `CLAUDE.md` branch-workflow.

Then baseline (a **fresh worktree has no `x64\` binaries**; build the **.sln**,
NOT the `.vcxproj` — the latter looks for `src\packages\`, L-023):
- `Set-Location web; pnpm --filter @particle-editor/editor test` → expect **371 passed** (44 files).
- `pnpm --filter @particle-editor/editor build` → tsc + dist clean, `dist/` composition.
- Native (only if you'll run the editor or the a11y harness):
  `& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" .\ParticleEditor.sln /p:Configuration=Release /p:Platform=x64 /nologo /verbosity:minimal /m`
  — if it fails on a missing `Microsoft.Web.WebView2` NuGet target, restore first:
  `MSBuild .\ParticleEditor.sln /t:Restore /p:RestorePackagesConfig=true /p:Configuration=Release /p:Platform=x64`.

## Primary context (read first, then VERIFY against code)

- **[`tasks/HANDOFF.md`](HANDOFF.md)** — top "2026-05-31 (session 4)" section is
  the latest snapshot (the viewport-seam root-cause + fix + the reusable
  CDP/grab/headless-keystone tooling). Session 3 below it covers the
  theme-coloured backing + sphere/cylinder parity.
- **[`tasks/lessons.md`](lessons.md)** — read **L-034** (a "compositor seam" can
  be a transparent DOM element's own fractional-edge AA; isolate the layer by
  recolouring over CDP, measure grabs with PIL not by eye), **L-033** (this
  machine misrenders arch-C compositing under *agent-driven* launches at ~4 FPS
  — verify visuals via host.log + CDP + the user, never agent screenshots; the
  native a11y/dxgi lanes are noisy here), plus standing **L-022..L-032**.
- **[`CHANGELOG.md`](../CHANGELOG.md)** — top entry is the seam fix (hash is a
  `TODO` placeholder — backfill at merge to master). **Open Issues** lists
  mod-bundled megafiles + `d3dx9_43.dll` redist.
- `CLAUDE.md` — working principles, plan-mode rules, LT-4 branch flow (FF into
  `lt-4`, never `master` without explicit OK).
- Completed plans are archived as `tasks/todo-*-archive.md` (the seam plan is
  `tasks/todo-viewport-edge-seam-archive.md`). `tasks/todo.md` does not exist
  right now — create it when you start the next 3+ step task.

## What's next (discuss with the user → brainstorm → plan)

Highest-leverage standing candidates:

1. **Feature-parity gap audit** (recommended). Enumerate what the legacy 0.2
   editor still has that the new UI lacks; scopes the remaining parity items
   before MT-13 (arch-A deletion) can be unblocked. Mostly discovery/read —
   output is a prioritized gap list, not code. (Already shipped recently:
   texture Browse picker, frequently-used texture palette, sphere/cylinder
   distribution fields.)
2. **arch-C performance** — profile the D3D9Ex + DComp render loop vs legacy's
   200–400 fps maximized. The user's *normal* launch was seen at **274 FPS**
   this session (healthy), so the path is viable; profile on an interactive
   session, NOT an agent-driven launch (L-033 degrades it to ~4 FPS).
3. **Smaller polish** the user surfaces live.

## Optional cleanup the seam fix surfaced (low priority)

The `<img data-testid="viewport-img">` in
[`ViewportSlot.tsx`](../web/apps/editor/src/components/ViewportSlot.tsx:340) is
now gated `!compositionMode`, which is **always false** in current builds
(`archCEnabled === compositionMode === !legacyMode`). So the `<img>`, `imgRef`
(line 50), and the `viewport/frame-ready` effect body (~176–197) are **dead code
today** — deliberately kept (option A) to preserve the canvas-jpeg affordance for
the **MT-13 arch-A deletion**. If MT-13 is on the table, delete all three then.
Don't do it as a standalone change unless asked.

## Process (per CLAUDE.md — non-negotiable)

- Treat HANDOFF + CHANGELOG + lessons as primary context, but **verify any
  important claim against the actual code before acting** (file:line drifts).
- **Summarize your understanding of the chosen task before changing anything**,
  and wait for the user to confirm scope.
- 3+ step work → plan mode → `tasks/todo.md`, check in with the user before
  starting.
- When an item ships: update `ROADMAP.md` (if tagged) + `CHANGELOG.md`
  (reverse-chronological, date-line + 3 sections; backfill hash/PR), append a
  `lessons.md` rule after any correction, FF-push to `origin/lt-4`
  (`git push origin HEAD:lt-4`). **Never `master` without explicit OK.**
- Native golden/Playwright runs are single-instance + fixed-port (CDP 9222) —
  **run them serially**, never in parallel (L-031). For CDP, use `127.0.0.1`,
  not `localhost` (L-034 note — `localhost` resolves slowly here).

Before making any changes, summarize your understanding of the project state,
the chosen task, and your planned approach, and wait for me to confirm.
