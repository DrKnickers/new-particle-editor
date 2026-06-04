# Next-session prompt — new-UI legacy-parity fix sweep (P7 link-groups shipped → next: P8 color/texture)

You're picking up `new-particle-editor` (the **AloParticleEditor** rewrite — Win32 +
WebView2/React + D3D9Ex-via-DComp particle editor for Star Wars: Empire at War),
branch **`lt-4`**. Treat the handoff docs as primary context but **verify important
claims against the actual code** before acting. Traps that have fired here: **L-022**
(docs say X, code ships Y), **L-057** (browser-preview PASS ≠ native PASS, and
native-only bugs are invisible to the web lane), **L-058** (a fresh worktree has NO
built binaries), **L-060** (interactive overlay over a full-width row steals clicks),
**L-061** (don't gate a must-succeed action behind an informational query).

## The work
A **full UI-vs-legacy delta audit** ([tasks/ui-delta-report.md](ui-delta-report.md), ~95
findings) drives a **phased defect-fix sweep** ([tasks/fix-plan.md](fix-plan.md) = plan +
per-phase progress). **Shipped through P7:** P1→P6, P6-rest, and **P7 link-groups**
(LNK-2 dot / LNK-6 visual-brackets+row-hover / LNK-8 Dissolve / LNK-10 inline join-warning)
plus a native engine crash-fix and a WebView2 context-menu fix. **The loop is user-driven:**
the user launches the faithful `--new-ui`, exercises a feature, reports what's off; you
root-cause (often empirically in the browser preview) + fix + the user re-verifies on-screen.

**Remaining queue (pick with the user — see HANDOFF "NEXT TASK options"):**
- **P8 — Color/texture (PAL-2/3/14)** ← the next fix-plan phase. Color picker live-preview +
  cancel/revert (PAL-2/3); broken-vs-missing texture thumbnails (PAL-14).
- **LNK follow-up:** the settings-OK un-exempt disagreement warning (the 2nd legacy surface;
  reuses the `linkGroups/diff-membership` host command added in P7).
- **Deferred polish:** curve marquee-from-axis-margins (user request — needs the curve canvas
  reworked to a margin-inclusive viewBox); SEL-12 drag-autoscroll; SEL-13 reorder-drag cancel.
- **Native track (own effort):** VPT-2 undo capture-wiring + VPT-3 autosave port.

## Pre-flight + baseline (before changing anything)
```
git fetch origin lt-4 --quiet
git rev-parse --short origin/lt-4      # the session-15 docs commit or newer
git log --oneline origin/lt-4..HEAD    # expect 0
git log --oneline HEAD..origin/lt-4    # expect 0
git status --porcelain                 # expect clean
```
- From `web/`: `pnpm install` if `node_modules` absent, then
  `pnpm --filter @particle-editor/editor test` → **454 passed** (49 files).
- `pnpm --filter @particle-editor/editor build` → clean (+`dist/`).
- `pnpm --filter @particle-editor/editor lint` → `tsc --noEmit`, exit 0 (the
  `NativeCommandError` in PowerShell is just stderr-wrapping; check exit code, L-046).

## Native build is NOT present in a fresh worktree (L-058)
A per-session worktree is a clean checkout — `node_modules`, NuGet `packages/`, and
`x64/Debug/ParticleEditor.exe` are all ABSENT. To run the native a11y harness or launch
the faithful `--new-ui`:
1. **WebView2 package (L-039):** restore `~/.nuget/packages/microsoft.web.webview2/1.0.3967.48/*`
   → `packages/Microsoft.Web.WebView2.1.0.3967.48/`. **Use `robocopy $src $dst /E`** — PowerShell
   `Copy-Item -Recurse "$src\*"` silently skips nested dirs when the dst exists (cost me a build).
2. **MSBuild Debug x64 (L-046):** `& "C:\Program Files\Microsoft Visual Studio\18\Community\
   MSBuild\Current\Bin\MSBuild.exe" "<repo>\ParticleEditor.sln" /p:Configuration=Debug
   /p:Platform=x64 /m /nologo /v:minimal`. **The `.sln` is at the REPO ROOT, not `web/`.** ~45s cold.
3. Rebuild `dist/` (`pnpm --filter @particle-editor/editor build`) before launch.
4. Launch: kill stray `ParticleEditor.exe` first, then `x64\Debug\ParticleEditor.exe --new-ui`.
   Confirm via `host.log` (`%LOCALAPPDATA%\AloParticleEditor\host.log`): real `fps=…` +
   `[COMP-engine-frame]`, NOT the L-033 ~4 FPS state.

## Verify mechanism (you CANNOT fully trust the browser preview — L-057)
- **React UI structure/behaviour:** vitest + browser preview (`pnpm dev` + MockBridge, L-041).
  The preview is great for empirically pinning interaction bugs (this session: click the bracket,
  read the selection store → confirmed the overlay click-steal in one shot).
- **Engine state / native crashes / final pixels:** hand to the **user** (L-033). Native-only
  bugs (cursor crash, WebView2 context menu, async-OK first-click) are structurally invisible to
  the web lane — the MockBridge returns instantly and has no live engine.

## Read first (then VERIFY)
- **`tasks/HANDOFF.md`** top "session 15" entry — the 4 commits, what shipped, the 5 fixes,
  NEXT-TASK options, verified baseline.
- **`tasks/fix-plan.md`** — phased plan + progress (P1–P7 done) + the explicit KEEP list.
- **`tasks/ui-delta-report.md`** — the ~95-finding catalog; PAL-* rows for P8.
- **`tasks/lessons.md`** — **L-060** (overlay click-steal, NEW), **L-061** (decouple action
  from query, NEW), L-059 (cursor-reseat incl. link-group paths), L-057/L-058, L-052/L-053
  (a11y two lanes + golden cascade), L-056 (2dp display policy).
- `CLAUDE.md` — LT-4 branch flow (commit on a session branch / FF into `lt-4` + push; never
  `master` without explicit OK).

## Process (per CLAUDE.md)
Summarize understanding + approach and confirm scope before changing anything; for a 3+-item
phase write a plan to `tasks/todo.md` first. TDD for web logic. On landing: re-baseline a11y
goldens per golden-touching phase (composition lane only, L-052) + lesson if non-obvious +
FF-push `lt-4`. Never `master` without OK. The user still daily-drives legacy/arch-A — these
fixes build arch-C trust toward the eventual LT-4→master cutover.
