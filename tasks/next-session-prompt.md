# Next-session prompt — resume feature-parity B (frequently-used texture palette)

You are resuming work on `new-particle-editor`, branch `lt-4`. The
previous session (2026-05-29) shipped a lot; this picks up the next
feature-parity item. **`origin/lt-4` is at `b80fd7b`.**

## Pre-flight (run before touching anything)

```
git fetch origin lt-4 --quiet
git rev-parse --abbrev-ref HEAD                            # lt-4 or a fresh claude/* off lt-4
git log --oneline origin/lt-4..HEAD | Measure-Object -Line # expect 0 (fresh session)
git log --oneline HEAD..origin/lt-4 | Measure-Object -Line # expect 0
git status --porcelain                                     # expect empty
git rev-parse origin/lt-4                                  # expect b80fd7b (or newer)
```
If lineage doesn't match, STOP and reconcile per `CLAUDE.md` branch-workflow.

## What shipped 2026-05-29 (all on `origin/lt-4`, `a405bf1..b80fd7b`)

1. **[item 4] dist/ build-mode test gate** (`b4765bd`, `1d7787a`) —
   `run-native-tests.mjs` fail-fasts (or `--rebuild`s) when the baked
   `dist/` hosting mode doesn't match the lane. Marker:
   `dist/build-meta.json` stamped by a Vite plugin in `vite.config.ts`.
2. **Headless frame-capture tool** (`7af4b5c`, `e9e9bc1`) —
   `ParticleEditor.exe --new-ui --capture <alo> <png> [--frames N]`:
   auto-selects the `.alo`'s mod, spawns + fills the effect, writes the
   engine RT (`<png>`) AND the final composite (`<png>-composite.png`,
   via `PrintWindow(PW_RENDERFULLCONTENT)`). Default 180 frames ≈ 3 s.
   **Use this for any rendering-fidelity check** — read the PNGs
   directly; no manual screenshots. Code: `src/host/HostWindow.cpp`
   (`HostWindowImpl::Run` capture block + `CaptureWindowToPng`),
   `AlphaCompositor::CaptureSnapshotToFile`, `src/host/Run.h`, `src/main.cpp`.
3. **L-029 lesson** (`ef0a898`) — verify the CORRECT (mod) assets are
   loaded before suspecting the render pipeline.
4. **Feature-parity A — texture Browse picker** (`e7c6318` plan,
   `ab1d340` feature, `a3a1a6a` changelog, `3bcdd55` CSS, `b80fd7b`
   review). DONE + user-verified. New `textures/browse` bridge request +
   host `GetOpenFileNameW` handler (opens in active mod's
   `Data\Art\Textures`); React `TexturePickerField` (in
   `EmitterPropertyTabs.tsx`) = `FieldText` + a FolderOpen Browse button.

**Big finding this session:** the "additive black-background / hard
square edges" rendering bug was NOT a renderer regression — it was
base-game textures loading because the capture/editor didn't have the
mod selected. With the mod selected, arch-C renders **1:1 with the 0.2
legacy build** (engine RT AND composite). Rendering fidelity (front #1
of the daily-drive blockers) is effectively resolved.

## Resume here: feature-parity B — frequently-used texture palette

The second half of texture-selection parity. Legacy had a per-mod
pinned/recent texture palette popup (color/bump filter, thumbnails)
that the new UI lacks. **Start a fresh brainstorm→plan→implement cycle
for B** (it's bigger than A: ~★★★–★★★★).

**What the codebase already gives us (from last session's Explore):**
- The C++ data layer ALREADY EXISTS: `TexturePalette::Store` singleton
  (`src/UI/TexturePalette.h:58-128`) — per-mod pinned + recent (LRU)
  entries, `slotMask` (color/bump), persisted to
  `%APPDATA%\AloParticleEditor\texture-palettes.ini`. Methods:
  `TouchRecent(filename, usedAs)`, `TogglePin(filename)`,
  `Pins(filter)`, `Recents(filter)`. **Not exposed to the new UI** —
  no bridge request reads/mutates it.
- `TexturePickerField` (`web/apps/editor/src/screens/EmitterPropertyTabs.tsx`)
  was built in A **structured to receive a palette button** next to the
  Browse button — that's the integration point.
- Legacy wiring reference: `src/UI/Emitter.cpp:411` (IDC_BUTTON_PALETTE)
  + `:462-468` (EN_KILLFOCUS → `TouchRecent`).

**Likely shape of B (confirm in brainstorm):**
1. Bridge requests over the existing `Store`: e.g.
   `textures/palette/list { filter } → { pins[], recents[] }`,
   `textures/palette/touch-recent { filename, slot }`,
   `textures/palette/toggle-pin { filename }`. Host handlers in
   `BridgeDispatcher.cpp` call `TexturePalette::Store::Instance()`.
2. React palette popup component (pinned + recent sections, color/bump
   filter, pin toggle, click-to-apply) + a palette button on
   `TexturePickerField`.
3. Track usage: on any texture commit (Browse, palette, or manual entry)
   call `textures/palette/touch-recent` so recents stay warm — mirrors
   legacy's EN_KILLFOCUS tracking.
4. Thumbnails: the host could load the texture → base64 PNG (reuse the
   `CaptureSnapshotPng`/GDI+ pattern) OR React renders a filename list
   first (thumbnails are the bigger lift — likely an MVP/v2 split).

Open design questions for the user: thumbnails vs filename-list MVP;
where the palette popup anchors (Radix Popover, like the existing
Background/Ground pickers).

## Build / test gotchas (unchanged; see lessons.md L-025..L-029)

- **MSBuild via PowerShell**, not Git Bash (L-025):
  `& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" .\ParticleEditor.sln /p:Configuration=Debug /p:Platform=x64 /nologo /verbosity:minimal /m`
  Always verify `x64\Debug\ParticleEditor.exe` exists; Release builds clean too.
- **Fresh worktree:** `& $msbuild .\ParticleEditor.sln /t:Restore ...` first (WebView2 NuGet not shared); `pnpm install` in `web/` (node_modules not shared).
- **pnpm from `web/`** (`Set-Location web`), not repo root. Vitest: `pnpm --filter @particle-editor/editor test` (was **350 passed** at session end). Type-check: `pnpm --filter @particle-editor/editor lint` (`tsc --noEmit`).
- **dist/ mode**: the running editor loads `web/apps/editor/dist`; rebuild it (`pnpm --filter @particle-editor/editor build`) after React changes or the live launch shows stale UI. The new gate fail-fasts on a mode mismatch in the test harness.
- **Live smoke**: launch `x64\Release\ParticleEditor.exe --new-ui` (Release = no debug console). **Select the mod via Mods menu** so textures resolve (the no-mod case is what made textures look broken). For automated visual checks, prefer the `--capture` tool.

## Process (per CLAUDE.md — non-negotiable)

- B is 3+ steps → brainstorm (superpowers:brainstorming) → write the
  5-section plan to `tasks/todo.md` → check in with the user → implement
  (vitest-first for React) → verify (build + vitest + live smoke) →
  CHANGELOG + lessons → commit → FF-push to `origin/lt-4`
  (`git push origin HEAD:lt-4`; `lt-4` is checked out in the main
  worktree, so push to the remote directly from a session worktree).
- The current `tasks/todo.md` holds the (DONE) feature-parity-A plan;
  archive it (`tasks/todo-feature-parity-a-archive.md`) before writing B's.

## The broader program (make arch-C daily-drivable, to retire 0.2)

| Front | Status |
|---|---|
| Rendering fidelity | ✅ resolved (was mod textures) |
| Feature parity | A (Browse picker) ✅ · **B (palette) ← next** · + more to discover |
| Performance (legacy hit 200–400 fps maximized) | open |
| UI polish | open (not migration-gating) |

User still daily-drives the 0.2 legacy build; arch-C must reach parity
+ perf before they migrate. (MT-13 arch-A deletion stays gated on that.)
