# Next-session prompt — new-UI legacy-parity fix sweep (P1–P8 + LNK follow-up shipped → next: deferred polish or native track)

You're picking up `new-particle-editor` (the **AloParticleEditor** rewrite — Win32 +
WebView2/React + D3D9Ex-via-DComp particle editor for Star Wars: Empire at War),
branch **`lt-4`**. Treat the handoff docs as primary context but **verify important
claims against the actual code** before acting. Traps that have fired here: **L-022**
(docs say X, code ships Y — bit us again this session: a handoff said "reuses
`diff-membership`" but that primitive answered a different question), **L-057** (browser-
preview PASS ≠ native PASS; native-only bugs invisible to the web lane), **L-058** (a fresh
worktree has NO built binaries), **L-062** (preview reads right after an event see
pre-React-flush DOM), **L-063** (classify a "doesn't work" report before coding).

## The work
A **full UI-vs-legacy delta audit** ([tasks/ui-delta-report.md](ui-delta-report.md), ~95
findings) drives a **phased defect-fix sweep** ([tasks/fix-plan.md](fix-plan.md) = plan +
per-phase progress). **Shipped: P1→P8** (P8a color picker live-preview/cancel-revert + 3 UX
extras; P8b broken-vs-missing thumbnails) **+ the LNK settings-OK warn+resolve** follow-up,
all **user-verified in `--new-ui`**. The loop is user-driven: the user launches the faithful
`--new-ui`, exercises a feature, reports what's off; you root-cause (web suite + browser
preview + native compile) + fix + the user re-verifies on-screen.

**Remaining queue (pick with the user — see HANDOFF "NEXT TASK options"):**
- **Deferred polish:** curve marquee-from-axis-margins (user request — needs the curve canvas
  reworked to a margin-inclusive viewBox); SEL-12 drag-autoscroll; SEL-13 reorder-drag cancel.
  All drag/native-lane (poorly web-verifiable).
- **Native track (own effort):** VPT-2 undo capture-wiring (the P8a color-picker `originalColor`
  open-snapshot is a ready hook — capture ONE undo entry per picker session, not per tick);
  VPT-3 autosave port; verify Reset-Camera vectors (MNU-7).

## Pre-flight + baseline (before changing anything)
```
git fetch origin lt-4 --quiet
git rev-parse --short origin/lt-4      # b3871c6 or newer (session-16)
git log --oneline origin/lt-4..HEAD    # expect 0
git log --oneline HEAD..origin/lt-4    # expect 0
git status --porcelain                 # expect clean
```
- Note: the session branch was synced to `lt-4` (`claude/practical-moore-1a19a1 == lt-4`); a
  fresh session gets a new branch — confirm it forked from `b3871c6`.
- From `web/`: `pnpm install` if `node_modules` absent, then
  `pnpm --filter @particle-editor/editor test` → **471 passed** (49 files).
- `pnpm --filter @particle-editor/editor build` → clean (+`dist/`).
- `pnpm --filter @particle-editor/editor lint` → `tsc --noEmit`, exit 0 (the
  `NativeCommandError` in PowerShell is just stderr-wrapping; check exit code, L-046).

## Native build is NOT present in a fresh worktree (L-058)
A per-session worktree is a clean checkout — `node_modules`, NuGet `packages/`, and
`x64/Debug/ParticleEditor.exe` are all ABSENT. To run the native a11y harness or launch
the faithful `--new-ui`:
1. **WebView2 package (L-039):** robocopy `~/.nuget/packages/microsoft.web.webview2/1.0.3967.48/*`
   → `packages/Microsoft.Web.WebView2.1.0.3967.48/`. **Use `robocopy $src $dst /E`** — PowerShell
   `Copy-Item -Recurse "$src\*"` silently skips nested dirs when the dst exists. (nuget cache IS
   present.)
2. **MSBuild Debug x64 (L-046):** `& "C:\Program Files\Microsoft Visual Studio\18\Community\
   MSBuild\Current\Bin\MSBuild.exe" "<repo>\ParticleEditor.sln" /p:Configuration=Debug
   /p:Platform=x64 /m /nologo /v:minimal`. **The `.sln` is at the REPO ROOT, not `web/`.** ~45s cold.
   The `LNK4098 defaultlib` warning is pre-existing/benign.
3. Rebuild `dist/` (`pnpm --filter @particle-editor/editor build`) before launch.
4. Launch: kill stray `ParticleEditor.exe` first, then `x64\Debug\ParticleEditor.exe --new-ui`.
   Confirm via `host.log` (`%LOCALAPPDATA%\AloParticleEditor\host.log`): real `fps=…` +
   `[COMP-engine-frame]` + a valid `[COMP-engine-handle-hash]` (sharedTex/backBuffer), NOT the
   L-033 ~4 FPS state. (For a web-only change you only need to rebuild `dist/` + relaunch — no
   MSBuild.)

## Verify mechanism (you CANNOT fully trust the browser preview — L-057)
- **React UI structure/behaviour:** vitest + browser preview (`pnpm dev` via launch.json
  `editor` config + MockBridge, L-041). Great for empirically pinning interaction bugs — this
  session a GREEN repro (click+ctrl-click → 2 selected, right-click selected row → kept 2) ruled
  out "selection is broken" and pointed at the silent 1-emitter no-op. **Read settled state in a
  SEPARATE eval after each event (L-062).**
- **Engine state / native crashes / final pixels / contrast / host-invariant enforcement:** hand
  to the **user** (L-033). Native-only bugs (color recolor, thumbnail decode, L-059 clobber
  crash, warning contrast) are structurally invisible to the web lane.

## Read first (then VERIFY)
- **`tasks/HANDOFF.md`** top "session 16" entry — the 4 commits, what shipped, the 2 fixes +
  1 non-bug, NEXT-TASK options, verified baseline (471).
- **`tasks/fix-plan.md`** — phased plan + progress (P1–P8 + LNK follow-up done) + the KEEP list.
- **`tasks/ui-delta-report.md`** — the ~95-finding catalog.
- **`tasks/lessons.md`** — **L-062** (preview pre-flush read, NEW), **L-063** (classify a
  "doesn't work" report + UI mirrors host invariants + green-repro-is-evidence + contrast is
  native-only, NEW); L-059 (link-group cursor reseat), L-057/L-058, L-052/L-053 (a11y two lanes).
- `CLAUDE.md` — LT-4 branch flow (commit on a session branch / FF into `lt-4` + push; never
  `master` without OK).

## Process (per CLAUDE.md)
Summarize understanding + approach and confirm scope before changing anything; for a 3+-item
phase write a plan to `tasks/todo.md` first. TDD for web logic. On landing: re-baseline a11y
goldens per golden-touching phase (composition lane only, L-052) + lesson if non-obvious +
FF-push `lt-4`. Never `master` without OK. The user still daily-drives legacy/arch-A — these
fixes build arch-C trust toward the eventual LT-4→master cutover (MT-13 gate).
