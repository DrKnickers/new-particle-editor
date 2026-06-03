# Next-session prompt — new-UI legacy-parity fix sweep (continue)

You're picking up `new-particle-editor` (the **AloParticleEditor** rewrite — Win32 +
WebView2/React + D3D9Ex-via-DComp particle editor for Star Wars: Empire at War),
branch **`lt-4`**, at `origin/lt-4 = 91f3617`. Treat the handoff docs as primary
context but **verify important claims against the actual code** before acting (the
L-022 "docs say open but it shipped" trap, and the L-057 "preview PASS ≠ native PASS"
trap, have both fired here).

## The work
Session 13 ran a **full UI-vs-legacy delta audit** ([tasks/ui-delta-report.md](ui-delta-report.md),
~95 findings = the authoritative catalog) and then a **phased defect-fix sweep**
([tasks/fix-plan.md](fix-plan.md) = the plan + per-phase progress). Shipped P1→P6/CRV-1
(rotation-scaling CRITICAL fix, spinners, global accelerators, menu/clipboard, marquee,
curve multi-key group-drag). **The loop is user-driven:** the user launches the faithful
`--new-ui`, exercises a feature, reports what's off; you root-cause + fix + verify.

**Remaining (pick with the user — see HANDOFF "NEXT TASK options"):**
- **Fix-plan queue:** P6-rest (curve copy/cut/paste CRV-2, right-click deselect CRV-7,
  decimal time CRV-8) · P7 link-groups (LNK-1/2/6/8/10) · P8 color/texture (PAL-2/3/14).
- **Deferred polish:** curve **marquee-from-the-axis-margins** (user request — needs the
  curve-canvas coordinate/layout reworked to a margin-inclusive viewBox) · SEL-12
  drag-autoscroll · SEL-13 reorder-drag cancel.
- **Native track (own effort, now unblocked):** undo capture-wiring (VPT-2) + autosave
  (VPT-3).

## Launch the new UI (faithful arch-C, for the user to test)
```
# kill any stray instance first (editor is single-instance)
powershell "Get-Process ParticleEditor -EA SilentlyContinue | Stop-Process -Force"
x64\Debug\ParticleEditor.exe --new-ui      # Debug exe is built; or build Release
```
Rebuild `dist/` (`pnpm --filter @particle-editor/editor build`) before relaunch so the
exe loads your latest web changes. Confirm via `host.log`
(`%LOCALAPPDATA%\AloParticleEditor\host.log`: `[host] Engine constructed OK`,
`[lighting-restore]`, `[view-restore]`, `fps=…` — NOT ~4 FPS). Agent-launch rendered fine
this session (240 FPS); if it ever shows the L-033 ~4 FPS / engine-fills-window state, the
user relaunches it themselves.

## Verify mechanism (you CANNOT fully trust the browser preview for drag interactions — L-057)
- **React UI structure/behaviour:** browser preview (`pnpm dev` + MockBridge, L-041) over
  `preview_*`, OR `--new-ui --test-host` over CDP. **L-057 caveats:** synthetic
  pointer-drags omit the trailing `click` (dispatch it!), the MockBridge stores exact
  doubles where the engine stores float32 (selection-by-time drifts natively), and the
  headless preview throttles rAF (`await rAF` hangs — read state in a separate eval).
- **A registry/`settings/*` round-trip:** `node web/apps/editor/scripts/verify-force-align.mjs`
  pattern.
- **Engine state / gated restore:** faithful non-`--test-host` launch + `host.log` (L-051).
- **Engine pixels / drag feel / final look:** hand to the **user** (L-033).

## Pre-flight + baseline (before changing anything)
```
git fetch origin lt-4 --quiet
git rev-parse --short origin/lt-4      # expect 91f3617 or newer
git log --oneline origin/lt-4..HEAD    # expect 0
git log --oneline HEAD..origin/lt-4    # expect 0
git status --porcelain                 # expect clean
```
- From `web/`: `pnpm install` if `node_modules` absent, then
  `pnpm --filter @particle-editor/editor test` → **428 passed** (49 files).
- `pnpm --filter @particle-editor/editor build` → clean (+`dist/`, composition).
- `pnpm --filter @particle-editor/editor a11y` → **155 passed / 4 splitters** (L-033
  artifact; needs the native Debug exe — **already built this worktree**; kill stray
  `ParticleEditor.exe` first; binds `127.0.0.1:9222`; CDP flaky → retry).
- Native build is **set up**: `x64/Debug/ParticleEditor.exe` built, `packages/` has
  WebView2 1.0.3967.48 (L-039 done). Release not built; build it if you want the smoother
  faithful exe. MSBuild via PowerShell (L-046).

## Read first (then VERIFY)
- **`tasks/HANDOFF.md`** top "session 13" entry — the 9 commits, how each was verified,
  the NEXT-TASK options, the verified baseline.
- **`tasks/fix-plan.md`** — the phased plan + progress (P1–P6 done, P6-rest/P7/P8 +
  native track remaining) + the explicit KEEP list (intentional redesigns not to revert).
- **`tasks/ui-delta-report.md`** — the full ~95-finding catalog (severity/confidence/
  verify-channel) for the remaining deltas.
- **`tasks/lessons.md`** — **L-057** (preview-vs-native drag/float verification gap, NEW),
  L-033/L-034 (arch-C truth), L-039/L-046 (NuGet / PowerShell MSBuild), L-052/L-053
  (a11y two lanes + golden cascade), L-055 (headless transitions).
- `CLAUDE.md` — LT-4 branch flow (commit on `lt-4` / FF a session branch; never `master`
  without explicit OK).

## Process (per CLAUDE.md)
Summarize understanding + approach and confirm scope before changing anything. On landing:
re-baseline a11y goldens per golden-touching phase (composition lane only, L-052) +
lesson if non-obvious + FF-push `lt-4`. Never `master` without OK. The user still
daily-drives legacy/arch-A — these fixes build arch-C trust toward the eventual
LT-4→master cutover, not ready yet.
