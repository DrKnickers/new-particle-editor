# Next-session prompt — new-UI legacy-parity fix sweep (continue → P7 link groups)

You're picking up `new-particle-editor` (the **AloParticleEditor** rewrite — Win32 +
WebView2/React + D3D9Ex-via-DComp particle editor for Star Wars: Empire at War),
branch **`lt-4`**, at `origin/lt-4 = 8f4ec58`. Treat the handoff docs as primary
context but **verify important claims against the actual code** before acting. Three traps
have fired in this effort: **L-022** (docs say X, code ships Y), **L-057** (browser-preview
PASS ≠ native PASS), and **L-058** (a fresh worktree has NO built binaries even when a
handoff says "already built").

## The work
A **full UI-vs-legacy delta audit** ([tasks/ui-delta-report.md](ui-delta-report.md), ~95
findings = the authoritative catalog) drives a **phased defect-fix sweep**
([tasks/fix-plan.md](fix-plan.md) = plan + per-phase progress). Shipped through P6-rest:
P1→P6 (rotation-scaling CRITICAL fix, spinners, accelerators, menu/clipboard, marquee,
curve multi-key group-drag) + **P6-rest (CRV-2/7/8: curve-key Copy/Cut/Paste, right-click
deselect, decimal time)** + a **native engine crash fix** (orphaned particle-cursor
iterators on curve-key edits — see HANDOFF session-14 deep-dive + L-059). **The loop is
user-driven:** the user launches the faithful `--new-ui`, exercises a feature, reports
what's off; you root-cause + fix + the user re-verifies on-screen.

**Remaining queue (pick with the user — see HANDOFF "NEXT TASK options"):**
- **P7 — Link groups (LNK-1/2/6/8/10)** ← the next fix-plan phase. `[L<n>]` name prefix /
  per-row dot (LNK-1/2), interactive bracket click-select + hover (LNK-6), Dissolve action
  (LNK-8), join-conflict warning (LNK-10). Legacy ref: `src/LinkGroup.cpp`,
  `src/UI/EmitterList.cpp`; host already has link-group plumbing (`propagateLinkGroup`,
  `GetLinkGroupMembers`, `getLinkExemptFlags`, `LinkExemptFlags`).
- **P8 — Color/texture (PAL-2/3/14):** color picker live-preview + cancel/revert (PAL-2/3),
  broken-vs-missing texture thumbnails (PAL-14).
- **Deferred polish:** curve **marquee-from-the-axis-margins** (user request — needs the
  curve canvas reworked to a margin-inclusive viewBox) · SEL-12 drag-autoscroll · SEL-13
  reorder-drag cancel.
- **Native track (own effort):** VPT-2 undo capture-wiring + VPT-3 autosave port.

## Pre-flight + baseline (before changing anything)
```
git fetch origin lt-4 --quiet
git rev-parse --short origin/lt-4      # expect 8f4ec58 or newer
git log --oneline origin/lt-4..HEAD    # expect 0
git log --oneline HEAD..origin/lt-4    # expect 0
git status --porcelain                 # expect clean
```
- From `web/`: `pnpm install` if `node_modules` absent, then
  `pnpm --filter @particle-editor/editor test` → **440 passed** (49 files).
- `pnpm --filter @particle-editor/editor build` → clean (+`dist/`).
- `pnpm --filter @particle-editor/editor lint` → `tsc --noEmit`, exit 0 (the
  `NativeCommandError` in PowerShell is just stderr-wrapping; check exit code, L-046).

## Native build is NOT present in a fresh worktree (L-058)
A per-session worktree is a clean checkout — `node_modules`, NuGet `packages/`, and
`x64/Debug/ParticleEditor.exe` are all ABSENT regardless of what a prior session built.
To run the native a11y harness or launch the faithful `--new-ui`:
1. **WebView2 package (L-039):** copy `~/.nuget/packages/microsoft.web.webview2/1.0.3967.48/*`
   → `packages/Microsoft.Web.WebView2.1.0.3967.48/` (no `nuget.exe` needed; offline).
2. **MSBuild Debug x64 (L-046):** via PowerShell with the `&` call operator —
   `& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" "<repo>\ParticleEditor.sln" /p:Configuration=Debug /p:Platform=x64 /m /nologo /v:minimal`
   (find MSBuild via `vswhere` / VS18 Community if the path differs). ~45s cold, ~5s incremental.
3. Rebuild `dist/` (`pnpm --filter @particle-editor/editor build`) before launch.
4. Launch: kill stray `ParticleEditor.exe` first (single-instance), then
   `x64\Debug\ParticleEditor.exe --new-ui`. Confirm via `host.log`
   (`%LOCALAPPDATA%\AloParticleEditor\host.log`): real `fps=…` + `[COMP-engine-frame]`,
   NOT the L-033 ~4 FPS state.

## Verify mechanism (you CANNOT fully trust the browser preview for drag/native — L-057)
- **React UI structure/behaviour:** vitest (`pnpm test`) + browser preview (`pnpm dev` +
  MockBridge, L-041), OR `--new-ui --test-host` over CDP. **L-057 caveats:** synthetic
  pointer-drags omit the trailing `click`; MockBridge stores exact doubles vs the engine's
  float32; headless preview throttles rAF.
- **Engine state / gated restore:** faithful non-`--test-host` launch + `host.log` (L-051).
- **Engine pixels / drag feel / native crashes / final look:** hand to the **user** (L-033).
  Native-only bugs (like the session-14 cursor crash) are structurally invisible to the web
  lane — when an STL iterator-debug assert fires in the sim after an edit, suspect a cached
  iterator the editor invalidated; verify default-vs-orphaned before theorizing (L-059).

## Read first (then VERIFY)
- **`tasks/HANDOFF.md`** top "session 14" entry — the 3 commits, the crash deep-dive +
  debugging technique, NEXT-TASK options, verified baseline.
- **`tasks/fix-plan.md`** — phased plan + progress (P1–P6-rest done; P7/P8 + deferred +
  native track remaining) + the explicit KEEP list (intentional redesigns not to revert).
- **`tasks/ui-delta-report.md`** — the ~95-finding catalog; LNK-* rows for P7.
- **`tasks/lessons.md`** — **L-059** (cursor-reseat invariant + MSVC orphaned-iterator trap
  + assert-hook/DbgHelp technique, NEW), **L-058** (fresh-worktree no binaries, NEW),
  L-057 (preview≠native), L-033/L-034 (arch-C truth), L-039/L-046 (NuGet / PowerShell
  MSBuild), L-052/L-053 (a11y two lanes + golden cascade), L-056 (2dp display policy).
- `CLAUDE.md` — LT-4 branch flow (commit on a session branch / FF into `lt-4` + push; never
  `master` without explicit OK).

## Process (per CLAUDE.md)
Summarize understanding + approach and confirm scope before changing anything; for P7 (3+
items) write a plan to `tasks/todo.md` first. TDD for web logic. On landing: re-baseline
a11y goldens per golden-touching phase (composition lane only, L-052) + lesson if
non-obvious + FF-push `lt-4`. Never `master` without OK. The user still daily-drives
legacy/arch-A — these fixes build arch-C trust toward the eventual LT-4→master cutover.
