# Next-session prompt — LT-4, after the skydome-alpha fix + theme/viewport polish

You are resuming `new-particle-editor`, branch `lt-4`. The previous session
(2026-05-30 session 2) **fixed the skydome→particle alpha blowout** (engine
vertex-declaration leak) and shipped three UI-polish changes (neutral-grey theme
ramp, opaque splitter gutters, squared viewport-facing panel corners). All of it
is on `origin/lt-4`; there is **no half-finished work**, tree is clean. This
session you pick the next LT-4 item (see "What's next").

**`origin/lt-4` is at `4e05b00`.** (Not on `master` — user wants it left on
`lt-4`.)

## Pre-flight (run before touching anything)

```
git fetch origin lt-4 --quiet
git rev-parse --abbrev-ref HEAD                            # lt-4 or a fresh claude/* off lt-4
git log --oneline origin/lt-4..HEAD | Measure-Object -Line # expect 0
git log --oneline HEAD..origin/lt-4 | Measure-Object -Line # expect 0
git status --porcelain                                     # empty
git rev-parse origin/lt-4                                  # expect 4e05b00 (or newer)
```
If lineage doesn't match, STOP and reconcile per `CLAUDE.md` branch-workflow.

Then baseline (a **fresh worktree has no `x64\` binaries** — build both up front,
MSBuild via PowerShell against the `.sln`, per L-025/L-023):
- `Set-Location web; pnpm --filter @particle-editor/editor test` → expect **367 passed**.
- `pnpm --filter @particle-editor/editor build` → tsc + dist clean, `dist/` composition
  (this also refreshes `dist/build-meta.json` to HEAD; it currently reads `6c32be5`,
  one commit behind — content is fine, just a stale stamp).
- Release: `& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" .\ParticleEditor.sln /p:Configuration=Release /p:Platform=x64 /nologo /verbosity:minimal /m`
  (Debug too if you'll run the a11y harness). If the build fails on a missing
  `Microsoft.Web.WebView2` NuGet target, restore first:
  `MSBuild .\ParticleEditor.sln /t:Restore /p:RestorePackagesConfig=true /p:Configuration=Release /p:Platform=x64`
  (fresh worktrees need this — see this session's notes; build the **.sln**, not the
  `.vcxproj`, or it looks for `src\packages\`).

## Primary context (read first, then VERIFY against code — file:line drifts, L-022)

- **[`tasks/HANDOFF.md`](HANDOFF.md)** — the "2026-05-30 (session 2)" section at the
  top is the full snapshot: the skydome root cause (vertex-declaration leak), the
  three UI-polish fixes, and the reusable verification tricks (native-window
  screenshot via .NET, live CSS read over CDP, WebView2 cache-clear, the theme/
  prefers-color-scheme gotcha).
- **[`CHANGELOG.md`](../CHANGELOG.md)** — top 4 entries are this session; **Open
  Issues** now lists only megafiles + d3dx9-redist (skydome-alpha removed).
- **[`tasks/lessons.md`](lessons.md)** — read **L-032** (vertex declaration / FVF
  is NOT in the `ID3DXEffect` state block; identical render-state ⇒ suspect
  input-assembler state). Also standing L-022..L-031.
- `CLAUDE.md` — working principles, plan-mode rules, LT-4 branch flow (FF into
  `lt-4`, never `master` without explicit OK).
- The completed skydome plan is archived at
  [`tasks/todo-skydome-alpha-archive.md`](todo-skydome-alpha-archive.md); `todo.md`
  is clear for the next plan.

## What's next (pick one with the user; nothing is pre-decided)

The skydome rendering bug is **fixed**. The broader program is still making arch-C
daily-drivable so the user can retire the 0.2 legacy build.

| Front | Status |
|---|---|
| Rendering fidelity | ✅ skydome-alpha fixed this session; mod-texture issue fixed earlier |
| Feature parity | A (Browse) ✅ · B (palette) ✅ · **gap audit still to do** |
| Performance (legacy hit 200–400 fps maximized) | open, never profiled |
| UI polish | toolbar consolidation ✅ · theme grey ✅ · viewport seams ✅ · then open |

Highest-leverage candidates (discuss → brainstorm → plan → implement):

1. **Feature-parity gap audit** (the standing recommended next step). Enumerate
   what the legacy 0.2 editor still has that the new UI lacks; scopes the remaining
   parity items before MT-13 (arch-A deletion) can be unblocked. Mostly
   discovery/read — output is a prioritized gap list, not code.
2. **arch-C performance** — profile the render loop (D3D9Ex + DComp path) vs
   legacy's 200–400 fps maximized. Open-ended; profile before committing scope.
3. **Smaller polish** the user may surface live (this session was driven by the
   user smoke-testing the editor and pointing at things).

## Build / test gotchas (unchanged + new this session; see lessons L-022..L-032)

- **MSBuild via PowerShell** (L-025), against the `.sln` at the worktree root.
  Fresh worktree → NuGet restore first (above).
- **pnpm from `web/`.** vitest baseline **367**. Type-check/dist: `pnpm build`.
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
