# Next-session prompt — new-UI bug-testing / parity & UX polish

You're picking up `new-particle-editor` (the **AloParticleEditor** rewrite — Win32 +
WebView2/React + D3D9Ex-via-DComp particle editor for Star Wars: Empire at War),
branch **`lt-4`**, at `origin/lt-4 = 4d9496d`. Treat the handoff docs as primary
context but **verify every important claim against the actual code** before acting
(the L-022 "docs say open but it shipped" trap has fired repeatedly here).

## What just shipped (session 12 — 4 commits on `lt-4`)
All user-driven, found/requested while testing the faithful `--new-ui`:
- `8ea203c` **full lighting registry restore** (host `!useTestHost` block, mirrors legacy
  `PushLightingToEngine`) + **Force Align cross-mode sync** (`settings/lighting-force-align/set`
  → `LightingForceFillAlignment` REG_DWORD; `useTestHost` plumbed into `BridgeDispatcher`)
  + **Lighting toolbar toggle** (Lightbulb, shares the Spawner dock slot). → L-051/52/53.
- `031e5fa` **raw-lighting panel display** (unified `settings/lighting` get returns the raw
  intensity/colour split; panel seeds from it, not the lossy engine snapshot) + the
  **`ALO_SETTINGS_LIVE` CDP test seam** (lifts the `--test-host` settings gate) +
  `web/apps/editor/scripts/verify-force-align.mjs`. → L-054.
- `1e1023a` **property-tab chevron animation fix** (CSS selector `:not([open])` was matching
  the controlled `<div>`; scoped to `details`). → L-055.
- `4d9496d` **app-wide 2dp numeric display** (Spinner defaults to `decimals ?? 2`, decoupled
  from wheel/step granularity; integer/% fields keep `decimals={0}`). → L-056.

## The task (pick with the user)
The session's loop was **user-driven new-UI testing**: user launches `--new-ui`, exercises
a feature, reports what's off; you root-cause via host.log + CDP DOM + browser-preview and
fix. **No concrete known parity gap remains** (ground/background/skydome/bloom/lighting all
restored *and* displayed correctly; chevrons consistent; numbers 2dp) — the next item comes
from the user. Adjacent-but-unrequested (see HANDOFF "NEXT TASK options"): new-UI lighting
*value* write-back (restore-on-launch + flag-write exist; value edits aren't persisted back).

## Launch the new UI (faithful arch-C, for the user to test)
```
# kill any stray instance first (editor is single-instance)
powershell "Get-Process ParticleEditor -EA SilentlyContinue | Stop-Process -Force"
x64\Release\ParticleEditor.exe --new-ui
```
Don't screenshot it (L-033 — agent-launched arch-C misrenders). Confirm via host.log
(`%LOCALAPPDATA%\AloParticleEditor\host.log`: `[lighting-restore]`, `[view-restore]`,
`[host] Engine constructed OK`); hand pixels to the user.

## Verify mechanism (arch-C: you CANNOT trust agent screenshots — L-033)
- **React-UI structure/layout** (menus, docking, element order, pixel offsets, CSS):
  drive `--new-ui --test-host` over CDP and read the DOM, OR use the **browser preview**
  (`pnpm dev` + MockBridge, L-041 — sidesteps arch-C). Caveat: the headless preview does
  NOT advance CSS transitions (L-055) — `getComputedStyle` after a toggle reads the start
  frame; verify transitioned end-states with `transition:none` or an initially-in-state element.
- **A registry round-trip / `settings/*` handler:** `node web/apps/editor/scripts/verify-force-align.mjs`
  is the reusable pattern (launch `--test-host` + `ALO_SETTINGS_LIVE=1`, CDP-drive the real
  UI, read/write the registry via `reg`, restore in `finally`). No user needed.
- **Engine state / a `!useTestHost`-gated restore:** faithful non-test-host launch + host.log
  (the `--test-host` bridge can't see a gated restore — L-051).
- **Engine pixels / final look:** hand to the **user** (L-033).

## Pre-flight + baseline (before changing anything)
```
git fetch origin lt-4 --quiet
git rev-parse --short origin/lt-4      # expect 4d9496d or newer
git log --oneline origin/lt-4..HEAD    # expect 0
git log --oneline HEAD..origin/lt-4    # expect 0
git status --porcelain                 # expect clean
```
- From `web/`: `pnpm install` if `node_modules` absent (fresh worktree), then
  `pnpm --filter @particle-editor/editor test` → **406 passed** (46 files).
- `pnpm --filter @particle-editor/editor build` → clean (+`dist/`, composition mode,
  needed for `--new-ui`).
- `pnpm --filter @particle-editor/editor a11y` → **~155 passed / 4 splitters** (L-033
  artifact; CDP flaky → retry, kill stray `ParticleEditor.exe` first — the editor is
  single-instance so an open `--new-ui` blocks the harness; binds `127.0.0.1:9222`).
- `.sln` Debug + Release x64 via **PowerShell** (L-046) ONLY if touching native — most
  new-UI work is web-only. Fresh worktree → WebView2 NuGet into `packages/` (L-039).

## Read first (then VERIFY)
- **`tasks/HANDOFF.md`** top "session 12" entry — the 4 commits, how each was verified,
  the test-seam pattern, the single-instance + headless-transition gotchas.
- **`tasks/lessons.md`** — **L-051** (gated-restore verify channel), **L-052** (a11y two
  lanes), **L-053** (toolbar→~19-golden cascade), **L-054** (env-liftable test seam + seed
  display from registry raw), **L-055** (`:not([open])` cross-element footgun + headless
  transitions), **L-056** (audit "correct-by-accident" defaults; decouple display vs step),
  **L-033/L-034** (arch-C verification truth), **L-039/L-046** (NuGet / PowerShell MSBuild).
- `CLAUDE.md` — LT-4 branch flow (commit on `lt-4` or FF a session branch in; never
  `master` without explicit OK).

## Process (per CLAUDE.md)
Summarize your understanding + approach and confirm scope before changing anything.
On landing: CHANGELOG + lesson if the gotcha is non-obvious + push `lt-4`. Never
`master` without OK. The user still daily-drives legacy/arch-A — these new-UI changes
build arch-C trust toward the eventual LT-4→master cutover, but it's not ready yet.
