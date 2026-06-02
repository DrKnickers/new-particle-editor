# Next-session prompt — new-UI parity gaps / bug-testing

You're picking up `new-particle-editor` (the **AloParticleEditor** rewrite — Win32 +
WebView2/React + D3D9Ex-via-DComp particle editor for Star Wars: Empire at War),
branch **`lt-4`**, at `origin/lt-4 = 9585b4e`. Treat the handoff docs as primary
context but **verify every important claim against the actual code** before acting
(the L-022 "docs say open but it shipped" trap has fired repeatedly here).

## What just shipped (session 10 — all on `lt-4`)
Three arch-C/new-UI bug fixes, all found by the user testing the faithful build:
- `28c1a41` **black line** on the Spawner viewport edge — D3D9Ex→D3D11 shared-surface
  edge incoherency; fixed with a guard-band overscan in `LayoutBroker::SetSceneRect`
  (→ L-048).
- `9ae4d9e` **bloom** "no visible effect" — host wasn't restoring bloom settings from
  the registry (strength stuck at 0); `HostWindow.cpp` now does (→ L-049).
- `9585b4e` **emitter drag-reorder** "won't pick up" — HTML5 DnD is dead under arch-C
  composition hosting; rebuilt on pointer events in `EmitterTree.tsx` (→ L-050).

## The task (pick with the user)
The session's loop was **user-driven new-UI bug-testing**: user launches `--new-ui`,
exercises a feature, reports what's off; you root-cause (host.log + CDP + faithful
grabs) and fix. Continue that, OR take the concrete known gap:

**Ground-settings registry-restore parity gap** (same class as the bloom fix, L-049).
Legacy restores ground state from the registry at startup — `src/main.cpp:7636-7644`
(`ReadGroundSlotPath`, `ReadGroundSolidColor(...)`, `ReadGroundTexture(...)`). The
new-UI `HostWindow` restores **none** of it (only recent-files + last mod), so a user's
tuned ground may reset to defaults in the new UI. Fix mirrors the bloom restore:
`HostWindow.cpp` right after the `Engine` is constructed (~:1797, next to the bloom
block I added), reading the same registry key/value names/types. **Gate on
`!useTestHost`** only if an a11y golden captures a ground value (grep
`web/apps/editor/tests/a11y-goldens/dialog-*` first; bloom needed the gate because
`dialog-bloom-settings` captures the strength textbox).

## Verify mechanism (arch-C: you CANNOT trust agent screenshots — L-033)
- **Drive the bridge without the user** over the `--test-host` CDP **host-object**
  channel: launch `x64\Release\ParticleEditor.exe --new-ui --test-host`, then
  `chromium.connectOverCDP('http://127.0.0.1:9222')` (IPv4 — NOT `localhost`) →
  `page.evaluate(() => window.bridge.request({ kind: ..., params: ... }))`. Read state
  back via `engine/state/snapshot`. Unaffected by the L-003 postMessage drop.
- **Faithful on-screen grab** (when a visual must be measured): launch normally, then
  `SetWindowPos` topmost + `CopyFromScreen` over `GetClientRect`/`ClientToScreen`, drop
  topmost; measure pixels with `System.Drawing.GetPixel` (L-034 — measure, don't
  eyeball). This machine's agent-launched `--new-ui` rendered faithfully this session,
  but still hand the final on-screen confirm to the **user** (L-033).

## Pre-flight + baseline (before changing anything)
```
git fetch origin lt-4 --quiet
git rev-parse --short origin/lt-4      # expect 9585b4e or newer
git log --oneline origin/lt-4..HEAD    # expect 0
git log --oneline HEAD..origin/lt-4    # expect 0
git status --porcelain                 # expect clean
```
- From `web/`: `pnpm install` if `node_modules` absent (fresh worktree), then
  `pnpm --filter @particle-editor/editor test` → **392 passed** (45 files).
- `pnpm --filter @particle-editor/editor build` → clean (+`dist/`, needed for `--new-ui`).
- `.sln` Debug + Release x64 via **PowerShell** (L-046, NOT Git-Bash). Fresh worktree →
  materialise the WebView2 NuGet pkg into `packages/` (L-039). MSBuild on this box:
  `C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe`.
- `pnpm --filter @particle-editor/editor a11y` → **157 passed / 4 splitters** (L-033).
  CDP is **flaky/slow** to come up — retry; kill stray `--test-host` first.

## Read first (then VERIFY)
- **`tasks/HANDOFF.md`** top "session 10" entry — the 3 fixes, verification, tooling
  notes (CDP IPv4, MSBuild path, PowerShell `$y:`/`git -F` traps).
- **`tasks/lessons.md`** — **L-048** (D3D9Ex→D3D11 readback ladder), **L-049** (host
  registry-restore parity — directly relevant to the ground gap), **L-050** (pointer
  events vs HTML5 DnD), **L-033/L-034** (arch-C verification), **L-039/L-040/L-046**.
- `CLAUDE.md` — LT-4 branch flow (FF into `lt-4`; never `master` without explicit OK).

## Process (per CLAUDE.md)
Summarize your understanding + approach and confirm scope before changing anything.
On landing: CHANGELOG + lesson if the gotcha is non-obvious + FF-push `lt-4`. Never
`master` without OK. The user still daily-drives legacy/arch-A — these new-UI fixes
build arch-C trust toward the eventual LT-4→master cutover, but it's not ready yet.
