# Next-session prompt — new-UI bug-testing / parity & UX polish

You're picking up `new-particle-editor` (the **AloParticleEditor** rewrite — Win32 +
WebView2/React + D3D9Ex-via-DComp particle editor for Star Wars: Empire at War),
branch **`lt-4`**, at `origin/lt-4 = 61fddd6`. Treat the handoff docs as primary
context but **verify every important claim against the actual code** before acting
(the L-022 "docs say open but it shipped" trap has fired repeatedly here).

## What just shipped (session 11 — 4 commits on `lt-4`)
All user-driven, found/requested while testing the faithful `--new-ui`:
- `4526ab6` **ground/background/skydome registry-restore** parity in the new-UI host
  (`HostWindow.cpp` ~:1799, folded into the bloom `!useTestHost` block) → **L-051**.
- `560c71b` **Lighting → docked pane** sharing one exclusive right-dock slot with the
  Spawner; **Bloom folded into Lighting**. New `lib/right-dock.ts`, `ToolPanel
  variant="docked"`, `BloomSection.tsx`; deleted `BloomPanel.tsx` + `spawner-visibility.ts`.
  Pure web-layer, no native rebuild. → **L-052**.
- `9ca6a20` removed the View-menu **Bloom** on/off item (toolbar covers it); moved
  **Force Align** next to the Fill lights; moved **Bloom** to the pane bottom.
- `61fddd6` 9px gap above the Bloom section (matches the collapsed inter-section gap).

## The task (pick with the user)
The session's loop was **user-driven new-UI testing**: user launches `--new-ui`,
exercises/looks at a feature, reports what's off or what to change; you root-cause via
host.log + CDP DOM + faithful grabs and fix. **No concrete known parity gap remains**
(ground / background / skydome / bloom / lighting all done) — the next item comes from
the user. Adjacent-but-unrequested: Force Align is session-only (localStorage, not the
legacy `LightingForceFillAlignment` registry key) — cross-mode sync is a follow-up if
asked.

## Verify mechanism (arch-C: you CANNOT trust agent screenshots — L-033)
- **React-UI structure/layout** (menus, panel docking, element order, pixel *offsets*):
  drive the live `--test-host` build over CDP and read the **DOM** — trustworthy under
  arch-C (L-033 is about engine *pixels*, not WebView2 DOM). Launch
  `x64\Release\ParticleEditor.exe --new-ui --test-host`, `chromium.connectOverCDP(
  'http://127.0.0.1:9222')` (IPv4), `page.evaluate(() => document.querySelector(...)
  .getBoundingClientRect())`. A throwaway `web/apps/editor/verify-*.mjs` driver (using
  `@playwright/test`'s `chromium`) works well — delete it after.
- **Engine state / a `!useTestHost`-gated restore:** faithful **non**-test-host launch +
  read `%LOCALAPPDATA%\AloParticleEditor\host.log` (e.g. the `[view-restore]` line). The
  `--test-host` bridge can't see a gated restore — the gate disables it (**L-051**).
- **Engine pixels / final look:** hand to the **user** (L-033).

## Pre-flight + baseline (before changing anything)
```
git fetch origin lt-4 --quiet
git rev-parse --short origin/lt-4      # expect 61fddd6 or newer
git log --oneline origin/lt-4..HEAD    # expect 0
git log --oneline HEAD..origin/lt-4    # expect 0
git status --porcelain                 # expect clean
```
- From `web/`: `pnpm install` if `node_modules` absent (fresh worktree), then
  `pnpm --filter @particle-editor/editor test` → **403 passed** (46 files).
- `pnpm --filter @particle-editor/editor build` → clean (+`dist/`, composition mode,
  needed for `--new-ui`).
- `pnpm --filter @particle-editor/editor a11y` → **~155 passed / 4 splitters** (L-033
  artifact; CDP flaky/slow → retry, kill stray `--test-host` first; count varies ±a few).
- `.sln` Debug + Release x64 via **PowerShell** (L-046) ONLY if touching native — most
  new-UI work is web-only. Fresh worktree → WebView2 NuGet into `packages/` (L-039).

## Read first (then VERIFY)
- **`tasks/HANDOFF.md`** top "session 11" entry — the 4 commits, how each was verified,
  the CDP-DOM-measurement pattern, the two a11y lanes, the splitter-artifact note.
- **`tasks/lessons.md`** — **L-051** (gated-restore verify channel), **L-052** (a11y
  composition vs legacy lanes — never blanket-regen legacy), **L-049/L-050** (host
  parity-restore / pointer-events drag), **L-033/L-034** (arch-C verification truth),
  **L-039/L-046** (NuGet / PowerShell MSBuild).
- `CLAUDE.md` — LT-4 branch flow (commit on `lt-4` or FF a session branch in; never
  `master` without explicit OK).

## Process (per CLAUDE.md)
Summarize your understanding + approach and confirm scope before changing anything.
On landing: CHANGELOG + lesson if the gotcha is non-obvious + push `lt-4`. Never
`master` without OK. The user still daily-drives legacy/arch-A — these new-UI changes
build arch-C trust toward the eventual LT-4→master cutover, but it's not ready yet.
