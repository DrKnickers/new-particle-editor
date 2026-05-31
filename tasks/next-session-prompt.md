# Next-session prompt — LT-4, root-cause the 1px viewport edge seam

You are resuming `new-particle-editor`, branch `lt-4`. **Your primary task this
session: execute the systematic-debugging investigation plan in
[`tasks/todo.md`](todo.md)** to root-cause a 1px light-grey (`#C0C0C0`) hairline
that frames the arch-C viewport (jarring in dark mode). It is **not yet fixed** —
read todo.md fully; a first fix attempt was reverted because it rested on an
unverified assumption. Do NOT jump to a fix — gather evidence first (the keystone
is host-side readback of the engine backbuffer edge column; todo.md §4 step 1).

The previous session (2026-05-31 session 3) shipped four things, all on
`origin/lt-4`, tree clean: the **theme-coloured composition backing** (corner
wedges, user-confirmed), a CHANGELOG backfill, the **spawner single-panel
cleanup**, and **sphere/cylinder distribution-field parity** (edge spinner →
"Constrain to surface" checkbox + radius/height one row). The viewport-seam
investigation is the only open thread.

**`origin/lt-4` is at `9400234` or newer.** (Not on `master` — user wants it left
on `lt-4`.) **Note:** the local `x64\Release\ParticleEditor.exe` may be stale (built
with a since-reverted 1px inset) — rebuild from clean HEAD before trusting a local
capture.

## Pre-flight (run before touching anything)

```
git fetch origin lt-4 --quiet
git rev-parse --abbrev-ref HEAD                            # lt-4 or a fresh claude/* off lt-4
git log --oneline origin/lt-4..HEAD | Measure-Object -Line # expect 0
git log --oneline HEAD..origin/lt-4 | Measure-Object -Line # expect 0
git status --porcelain                                     # empty
git rev-parse origin/lt-4                                  # expect 9400234 (or newer)
```
If lineage doesn't match, STOP and reconcile per `CLAUDE.md` branch-workflow.

Then baseline (a **fresh worktree has no `x64\` binaries** — build both up front,
MSBuild via PowerShell against the `.sln`, per L-025/L-023):
- `Set-Location web; pnpm --filter @particle-editor/editor test` → expect **371 passed**.
- `pnpm --filter @particle-editor/editor build` → tsc + dist clean, `dist/` composition
  (this also refreshes `dist/build-meta.json` to HEAD).
- Release: `& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" .\ParticleEditor.sln /p:Configuration=Release /p:Platform=x64 /nologo /verbosity:minimal /m`
  (Debug too if you'll run the a11y harness). If the build fails on a missing
  `Microsoft.Web.WebView2` NuGet target, restore first:
  `MSBuild .\ParticleEditor.sln /t:Restore /p:RestorePackagesConfig=true /p:Configuration=Release /p:Platform=x64`
  (fresh worktrees need this — see this session's notes; build the **.sln**, not the
  `.vcxproj`, or it looks for `src\packages\`).

## Primary context (read first, then VERIFY against code — file:line drifts, L-022)

- **[`tasks/HANDOFF.md`](HANDOFF.md)** — the "2026-05-31 (session 3)" section at the
  top is the latest snapshot (theme-coloured composition backing: the DComp
  rear-visual fix, the `host/backing-color` bridge path, and the
  verify-via-host.log method). The "session 2" section below it covers the
  skydome fix + theme/viewport polish + reusable verification tricks.
- **[`CHANGELOG.md`](../CHANGELOG.md)** — top entry is the backing fix; **Open
  Issues** lists megafiles + d3dx9-redist.
- **[`tasks/lessons.md`](lessons.md)** — read **L-033** (agent-driven native
  launches misrender arch-C compositing at ~4 FPS — verify the DComp path via
  host.log + CDP + the user, NOT agent screenshots; native a11y/dxgi lanes are
  noisy on this machine) and **L-032** (vertex declaration / FVF is NOT in the
  `ID3DXEffect` state block). Also standing L-022..L-031.
- `CLAUDE.md` — working principles, plan-mode rules, LT-4 branch flow (FF into
  `lt-4`, never `master` without explicit OK).
- **[`tasks/todo.md`](todo.md) — THE ACTIVE PLAN: the viewport-seam investigation.**
  Read it fully before touching anything. Completed plans are archived
  (`todo-backing-color-archive.md`, `todo-skydome-alpha-archive.md`).

## What's next

**THIS SESSION: the viewport-seam investigation in [`tasks/todo.md`](todo.md).**
Execute it (evidence first — do not jump to a fix). When it's resolved + the fix
landed + user-confirmed, the standing candidates below remain (pick with the user).

After the seam is done — highest-leverage candidates (discuss → brainstorm → plan):

1. **Feature-parity gap audit** (the standing recommended next step). Enumerate
   what the legacy 0.2 editor still has that the new UI lacks; scopes the remaining
   parity items before MT-13 (arch-A deletion) can be unblocked. Mostly
   discovery/read — output is a prioritized gap list, not code. (Note: sphere/
   cylinder distribution-field parity shipped this session.)
2. **arch-C performance** — profile the render loop (D3D9Ex + DComp path) vs
   legacy's 200–400 fps maximized. Open-ended; profile before committing scope.
   (Caveat: this dev machine ran the engine at ~4 FPS under agent-driven launch,
   L-033 — profile on a healthy interactive session.)
3. **Smaller polish** the user surfaces live.

## Build / test gotchas (unchanged + new this session; see lessons L-022..L-032)

- **MSBuild via PowerShell** (L-025), against the `.sln` at the worktree root.
  Fresh worktree → NuGet restore first (above).
- **pnpm from `web/`.** vitest baseline **371**. Type-check/dist: `pnpm build`.
- **a11y goldens** only if your change renders in a captured surface (L-030) —
  CSS-token / engine-only changes are golden-neutral. Native lanes SERIAL only
  (L-031); HWND `--update` full-suite, never `--grep` (L-028).
- **Live smoke:** `x64\Release\ParticleEditor.exe --new-ui`, **mod selected**
  (L-029). Launcher: `Start-Process -FilePath <exe> -ArgumentList "--new-ui" -WorkingDirectory <worktree>`.
- **EaWX mod for repro:** `D:\SteamLibrary\steamapps\common\Star Wars Empire at War\corruption\Mods\EmpireAtWarExpanded`.
  Smoke/explosion `.alo`s under `…\Data\Art\Models\` (e.g. `p_capital_deathsmoke00.ALO`,
  `P_EXPLOSION_BIG00.ALO`). The `--capture <alo> <png> [--frames N] [--skydome <slot>]`
  headless tool auto-selects the owning mod by path prefix (L-029).
- **NEW verification tricks (see HANDOFF):** native-window screenshot via
  `System.Drawing.CopyFromScreen` PowerShell; live CSS/theme read over CDP
  (`--test-host` → port 9222 → `ClientWebSocket` `Runtime.evaluate`); WebView2
  cache-clear after a dist rebuild (`…\WebView2\EBWebView\Default\{Cache,Code Cache,
  GPUCache}`, needs `dangerouslyDisableSandbox`); theme follows OS
  `prefers-color-scheme` when `alo:theme` localStorage unset.
- **Known flakes:** `splitters.spec.ts` (L-014) fails 4 on full-suite native runs,
  passes in isolation; intermittent a11y read-only Cursor-cell drift — both
  pre-existing, 0 real golden mismatches.

## Process (per CLAUDE.md — non-negotiable)

- Treat HANDOFF + CHANGELOG + lessons as primary context, but **verify any
  important claim against the actual code before acting** (file:line drifts).
- **Summarize your understanding of the chosen task before changing anything.**
- 3+ step work → plan mode → `tasks/todo.md`, check in with the user before
  starting. Archive the old `tasks/todo.md` first (prior plans are
  `tasks/todo-*-archive.md`).
- When an item ships: update `ROADMAP.md` (if tagged) + `CHANGELOG.md`
  (reverse-chronological, with the date-line + 3 sections; backfill hash/PR),
  append a `lessons.md` rule after any correction, FF-push to `origin/lt-4`
  (`git push origin HEAD:lt-4`). **Never `master` without explicit OK.**
