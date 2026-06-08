# Particle Editor 2026 redesign — design spec

**Date:** 2026-05-19
**Status:** Approved — ready for `writing-plans` transition
**Target branch:** `lt-4` (integration), shipped via phased commits
**Source design bundle:** `C:\Users\antho\AppData\Local\Temp\nu-particle-editor\nuparticle-editor\` (extracted from the gzip tar served by `https://api.anthropic.com/v1/design/h/GIBHWYCgKK_8z2Zs_5G2Ow`); permanent copy of relevant artifacts referenced inline below.

---

## 1. Goal & context

Redesign the LT-4 new-UI React shell (`web/apps/editor/`) to match the Particle Editor 2026 design produced via Claude.ai's design tool. The redesign is **visual + structural**: a token-system overhaul (new colors, typography, spacing, radii) plus restructuring of the workspace shell (Background and Ground move from sliding panels into toolbar dropdowns; Spawner becomes a permanent right column; left panel hosts both the emitter tree and the Basic/Appearance/Physics inspector; curve editor moves to an always-on 260px bottom area).

The legacy `--legacy-ui` Win32 mode is **untouched** by this work. The redesign is React-only.

### What the user gets

- A modern, dark-mode-default editor with a consistent 2026 design system (Inter typography, accent-blue palette, 6-tier neutral backgrounds, soft-bordered panels, 8px panel radii).
- A toggleable **light theme** (driven by `prefers-color-scheme` at first launch; persists to `localStorage` after first user toggle).
- Background and Ground accessible as compact toolbar dropdowns (instead of sliding side panels), Spawner permanently visible in a toggleable right column.
- Bottom always-on curve editor showing all 7 emitter channels (Scale / R / G / B / A / Rotation / Index) overlaid in one canvas, with per-channel visibility checkboxes.
- Viewport overlay with a 3-toggle pill: Show ground / Toggle bloom / Leave particles after instance death.
- Right-click on a Mods menu entry opens a nickname dialog (wiring up the previously unwired `ModNicknameDialog`).

### Out of scope

- **Tweaks panel** — exists in the design bundle (`tweaks-panel.jsx`) but explicitly excluded from this redesign. Easy to revive later if requested.
- **Lighting / Bloom Settings restructure** — these tool panels stay as `ToolPanel` slide-ins (re-skinned to new tokens in Phase 1, structure unchanged). The design doesn't address them.
- **Live OS-theme subscription** mid-session (the theme locks in at mount + user toggle; doesn't auto-flip when OS toggles).
- **Visual regression / screenshot diffing** test infrastructure. Deferred.
- **Phase 4.2 cutover** (deleting legacy chrome) — unaffected by this redesign; gated on separate parity acceptance.

---

## 2. Phasing

Three phases on `lt-4`, each independently shippable. Each phase ends with `pnpm build` clean + vitest green + Playwright green + MSBuild clean + Claude visual verification via computer-use.

### Phase 1 — Token system + theme toggle (no structural changes)

- Port the design's `styles.css` token system into the app.
- Bundle Inter font locally (variable woff2, ~250 KB, `font-display: block` + `<link rel="preload">` so no flash of system font).
- Add `[data-theme]` mechanism on `<html>`; theme toggle in the toolbar reads/writes `localStorage['alo:theme']`.
- Extend `tailwind.config.ts` so existing Tailwind utilities resolve to the new tokens (`bg-bg-2`, `text-text-2`, `border-border`, `accent`, etc.). This lets Phase 1 do an incremental color/typography/spacing sweep without restructuring component class architecture.
- Sweep existing components to replace legacy Tailwind color/typography/spacing utilities with their token-backed equivalents.
- **No structural divergence** — every panel, dropdown, dialog stays in the exact same DOM location it does today.

### Phase 2 — Structural moves (7 sub-commits)

Each sub-commit moves + restyles + rewrites tests for one structural unit. Suite stays green at every commit boundary.

1. Toolbar reorganization (New/Open/Save/Save As / Play|Pause/Step/Step 10 / Spawner toggle / spacer / Ground/Background/theme).
2. Background slide-in panel → toolbar dropdown popover.
3. Ground Texture slide-in panel → toolbar dropdown popover (with the existing Ground Z spinner inlined).
4. Spawner slide-in panel → permanent right column (toggleable; persists visibility to `localStorage`).
5. Left panel restructure: EmitterPropertyTabs (Basic/Appearance/Physics) migrates from the right panel into the left panel below the EmitterTree.
6. Curve editor: TrackEditor moves from inline-in-EmitterPropertyPanel to always-on bottom 260px panel; multi-channel overlay; visibility checkboxes.
7. Viewport overlay: top-left 3-toggle pill (Show ground / Toggle bloom / Leave particles).

### Phase 3 — Cleanup + dialog re-skin

- Modal primitive (`Modal.tsx`) re-aligned with new tokens (cascades to every consuming dialog).
- Per-dialog visual passes: ImportEmittersDialog, ModNicknameDialog (now wired), RescaleDialog, RescaleEmitterDialog, AboutDialog, SaveChangesPrompt, IncrementIndexDialog, LinkGroupSettingsDialog.
- ModNicknameDialog wiring: new `mods/set-nickname` bridge call, right-click-on-mod-menu-entry trigger.
- Leftover Tailwind cleanup: grep + sweep for remaining `bg-neutral-*`, `border-neutral-*`, `text-neutral-*`, `sky-500`, etc. that weren't reached in Phase 1 or 2.
- HANDOFF.md refresh, CHANGELOG entries (one per phase or one comprehensive — decided at ship time).

---

## 3. Phase 1 — Token system + theme toggle (detail)

### 3.1 Files added

| Path | Purpose |
|---|---|
| `web/apps/editor/src/styles/tokens.css` | The design's `:root` and `[data-theme="light"]` blocks, ported verbatim. 24 CSS variables (6-tier backgrounds, 3-tier text, accents, axes, radii, row heights, shadow). |
| `web/apps/editor/src/styles/base.css` | The design's body/html/scrollbar rules, font-feature-settings, `* { box-sizing: border-box; }` reset, `@font-face` declaration for Inter. |
| `web/apps/editor/src/styles/components.css` | The design's component-class rules (`.panel`, `.panel-header`, `.tree-row`, `.form-row`, `.num-input`, `.tabs`, `.tab`, `.section`, `.checkbox`, `.radio`, etc.) for components to consume in Phase 2/3 rewrites. |
| `web/apps/editor/public/fonts/inter/Inter-VariableFont_slnt,wght.woff2` | Inter variable font, single file ~250 KB, covers all weights via `font-variation-settings`. |
| `web/apps/editor/src/components/ThemeToggle.tsx` | Small toolbar widget — Sun/Moon icon buttons, shared active-pill backdrop. Reads/writes `localStorage['alo:theme']` and sets `document.documentElement.dataset.theme = 'dark' \| 'light'`. |

### 3.2 Files modified

| Path | Change |
|---|---|
| `web/apps/editor/src/index.css` | Replace existing `@import` chain with imports of `tokens.css`, `base.css`, `components.css` (in that order, after `@tailwind base/components/utilities`). |
| `web/apps/editor/tailwind.config.ts` | Extend `theme.colors` to alias the new CSS variables (`bg: 'var(--bg)'`, `bg-2: 'var(--bg-2)'`, `text: 'var(--text)'`, `accent: 'var(--accent)'`, etc.) so existing components can incrementally swap `bg-neutral-900` → `bg-bg-2` without losing utility-class ergonomics. |
| `web/apps/editor/index.html` | Add `<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/inter/Inter-VariableFont_slnt,wght.woff2">` so font is requested before first paint. |
| `web/apps/editor/src/App.tsx` | One-time `useEffect` at mount: read `localStorage['alo:theme']`; if absent, check `window.matchMedia('(prefers-color-scheme: dark)').matches` for default; set `document.documentElement.dataset.theme` accordingly. |
| Every component that uses hardcoded color/typography/spacing Tailwind utilities | Class swap to token-backed equivalents. Bulk-renames where safe: `bg-neutral-900` → `bg-bg-2`, `text-neutral-300` → `text-text`, `text-neutral-500` → `text-text-2`, `border-neutral-800` → `border-border`, `sky-500` → `accent`. |

### 3.3 Tailwind disposition

**Keep Tailwind, alias new tokens into Tailwind's color palette.** Strip-Tailwind would force a class-architecture rewrite for every component at once — out of scope for Phase 1. The alias approach lets Phase 1 ship as a token swap; later phases may incidentally rewrite some components to use semantic CSS classes from the design (`.panel` instead of `bg-bg-2 border border-border rounded-lg`), but Phase 1 doesn't force it.

### 3.4 Theme persistence wiring

- **Storage:** `localStorage['alo:theme']` with values `'dark' | 'light' | null`.
- **Default at first launch (no stored value):** `window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'`. Reads the OS preference once at mount.
- **After user toggle:** explicit choice persists to `localStorage`. Subsequent launches respect the stored value regardless of OS preference.
- **Bridge surface:** zero. Theme is a pure React-side concern; legacy `--legacy-ui` has no light variant and ignores the value.

### 3.5 Phase 1 verification gates

1. `pnpm build` clean (0 TS errors from auto-generated Tailwind types after config change).
2. Vitest **191 / 191** — same as today, since no DOM-semantic changes.
3. Playwright **80 / 80** — same as today.
4. MSBuild Debug x64 clean.
5. Computer-use visual check by Claude: launch `--new-ui`, screenshot in dark mode, toggle theme, screenshot in light mode, close + relaunch, confirm theme persisted.
6. **No structural divergence** — every panel, button, dropdown, tab, modal lives in the exact same DOM location it does today. If anything moved, that's a Phase-2 bleed-over and needs reverting before Phase 1 ships.

---

## 4. Phase 2 — Structural moves (detail)

Seven sub-commits. Each commit moves + restyles + rewrites tests for one structural unit; suite stays green at every commit boundary.

### 4.1 Toolbar reorganization

**Old:** scattered buttons in `Toolbar.tsx` — playback, View menu triggers, color/skydome buttons, status indicators.

**New:** ordered groups matching `toolbar.jsx` from the design:
- Group 1: `New / Open / Save / Save As`
- Divider
- Group 2: `Play|Pause / Step / Step 10` (Play|Pause is a single toggle; Step 10 reuses existing `engine/action/step-frames { frames: 10 }`)
- Divider
- Group 3: `Spawner toggle` (sets React state for right-column visibility, persists to `localStorage['alo:spawner-visible']`)
- Spacer (`flex: 1`)
- Group 4: `Ground: [dropdown]` `Background: [dropdown]` `ThemeToggle`

The `Stop` and `Restart` buttons (currently present) are removed per the design chat decisions. The `Mods` toolbar dropdown (if currently present) is also removed; Mods lives in the menubar.

**Bridge surface:** no new kinds.

**Tests:** rewrite `tools.spec.ts` and portion of `toolbar.spec.ts` to assert against the new button set.

### 4.2 Background slide-in panel → toolbar dropdown popover

**Old:** `BackgroundPicker.tsx` is a slide-in `ToolPanel` opened from a toolbar button.

**New:** Toolbar button `Background: [preview swatch + chevron]` opens a Radix Popover anchored to the button. The popover renders the existing picker contents (solid color row, bundled gradient grid, custom slots) in a compact panel-shaped layout matching `background_popover.jsx`. `ToolPanel` wrapper is removed for Background; `ToolPanel` itself remains in the codebase for the other panels that still use it.

**Occlusion:** the new Radix Popover registers as a viewport occlusion via the existing `useViewportOcclusion` pattern (a generalization of `OccludingMenubarContent` — likely renamed/expanded to `OccludingPopover`). This ensures the `AlphaCompositor` stamps the cut-out so the dropdown shadow blends correctly against the D3D9 viewport edge.

**Bridge surface:** no new kinds. Existing `engine/set/skydome-slot`, `set/skydome-custom-path`, `set/background` cover everything.

**Tests:** rewrite `background-picker.spec.ts` to assert against the popover instead of the slide-in panel.

### 4.3 Ground Texture slide-in panel → toolbar dropdown popover

Same pattern as Background. Mirrors `ground_popover.jsx`. Notable change: the existing `ground-z` spinner (currently in the Ground sliding panel or elsewhere) inlines into the Ground popover, labeled "Ground Height:" with up/down arrows.

**Bridge surface:** no new kinds.

**Tests:** rewrite the GroundTexturePanel-related specs.

### 4.4 Spawner slide-in panel → permanent right column

**Old:** `SpawnerPanel` is a slide-in `ToolPanel` opened from Emitters → Spawner….

**New:** Right column of the workspace grid (`320px 1fr 340px` layout). Renders as `.panel` with header carrying an X close button. Toolbar button (commit 4.1) toggles its visibility via React state, persisted to `localStorage['alo:spawner-visible']`.

When hidden: workspace becomes 2-column (`320px 1fr`), giving the viewport + curve editor more horizontal space.

**Bridge surface:** no new kinds.

**Tests:** rewrite `spawner-import-mod.spec.ts` portions that assert sliding-panel rendering.

### 4.5 Left panel restructure

**Old:** Left panel = `EmitterTree` only (320px). Right panel = `EmitterPropertyPanel` with `EmitterPropertyTabs` (Basic/Appearance/Physics).

**New:** Left panel = `EmitterTree` on top + tabs (Basic/Appearance/Physics) + form-row inspector below, all in one 320px column. Right panel becomes Spawner-only (per 4.4).

This is the largest restructure of Phase 2. `EmitterPropertyTabs.tsx` + `EmitterPropertyPanel.tsx` need surgery: tabs container moves into the left panel; form-row rendering converts from current Tailwind classes to the design's `.form-row` 3-column grid (`1fr 92px 56px`).

**Bridge surface:** no new kinds.

**Tests:** `EmitterPropertyTabs.test.tsx` (18 specs) — rewrite to assert against the new layout. The field-set itself doesn't change, only the DOM nesting + classes. Most specs need query adjustments.

### 4.6 Curve editor restructure

**Old:** `TrackEditor.tsx` is rendered inline inside `EmitterPropertyPanel`. Per-track editing — one curve at a time. Seven tracks: R, G, B, A, Scale, Index, RotationSpeed.

**New:** Fixed-bottom 260px panel in the workspace grid's center column. Split: 160px left curve-list + 1fr canvas. Curve-list shows checkboxes for each channel (Scale / Red / Green / Blue / Alpha / Rotation / **Index**). Canvas shows all enabled curves overlaid at once.

**Index channel:** kept as 7th checkbox (defaulted to off). Preserves engine feature parity for texture animation; doesn't contradict the design (Index just becomes an additional toggle alongside the 6 the design author specified).

**Bridge surface:** no new kinds. Existing `emitters/set-track-key`, `add-track-key`, `set-track-interpolation` cover all editing.

**Tests:** `TrackEditor.test.tsx` (8 specs) — rewrite to assert against the multi-curve overlay rendering. Add: visibility checkbox specs, multi-curve render correctness.

### 4.7 Viewport overlay — 3-toggle pill

**Old:** Viewport has various overlays (cursor 3D position, FPS counter, etc.).

**New:** Add the top-left vertical pill per the design — three toggles top-to-bottom:
1. **Show ground** → existing `engine/set/ground { enabled }`
2. **Toggle bloom** → existing `engine/set/bloom { enabled }`
3. **Leave particles after instance death** → **new bridge call** (see below)

The viewport-overlay FPS readout is removed per design chat (FPS stays on the status bar).

**"Leave particles" bridge surface (new):**
- `engine/set/leave-particles { enabled: boolean }` — calls `(*m_pParticleSystem)->setLeaveParticles(enabled)`. The flag is per-`ParticleSystem` (see [`src/ParticleSystem.h:343-347`](src/ParticleSystem.h:343)).
- `EngineStateDto` gains `leaveParticles: boolean`.
- Dispatcher's snapshot builder reads through `(*m_pParticleSystem)->getLeaveParticles()`.
- MockBridge: `leaveParticles: false` default in `mock-state.ts`; new case in `mock.ts`.

**Custom SVG icons:** copy from design bundle `/assets/icon-ground.svg`, `/assets/icon-bloom.svg`, `/assets/icon-particles.svg` into `web/apps/editor/public/icons/`. Inline as `<svg>` so they pick up `currentColor` for active/inactive states.

**Tests:** add new specs for the pill rendering + each toggle's dispatch + the new bridge call's mock + a Playwright contract spec for `engine/set/leave-particles` round-trip.

---

## 5. Phase 3 — Cleanup + dialog re-skin (detail)

### 5.1 Modal primitive re-style

`web/apps/editor/src/components/Modal.tsx` uses Radix Dialog with Tailwind classes. Update its className strings to consume the new design tokens (`bg-panel border-border-2 rounded-lg shadow-[var(--shadow)]`). This is the cheapest cascade — touching one file restyles every consuming dialog automatically.

### 5.2 Per-dialog visual passes

Eight dialog components get a read + className sweep + manual smoke verification:

- `ImportEmittersDialog`
- `ModNicknameDialog` (newly wired — see 5.3)
- `RescaleDialog`
- `RescaleEmitterDialog`
- `AboutDialog`
- `SaveChangesPrompt`
- `IncrementIndexDialog`
- `LinkGroupSettingsDialog`

Most should need only minor changes since the Modal primitive (5.1) handles the chrome — only the body content's typography/inputs/buttons need attention.

### 5.3 ModNicknameDialog wiring

**Currently:** `ModNicknameDialog.tsx` exists but is UI-only — no backing bridge call, never opened from anywhere.

**New wiring:**
- **Trigger:** right-click on a Mods menu entry opens the dialog with that mod's path + current nickname pre-filled. Mirrors the legacy WM_MENURBUTTONUP pattern at [`src/main.cpp:2470-2486`](src/main.cpp:2470).
- **Bridge surface (new):** `mods/set-nickname { path: string; nickname: string }`. Response shape: `{ ok: true; mods: ModDescriptor[]; activePath: string | null }` (same shape as `mods/list` so React can replace its cache atomically).
- **Dispatcher handler:** calls `WriteModNickname(path, nickname)` (already exported from `ModManager.h`), then `m_modManager->DiscoverMods()` for a full rescan to pick up the updated nickname into the cached `mods` vector. Returns the refreshed mod list.
- **MockBridge:** new `mods/set-nickname` case — updates the synthetic fixture entry's nickname in memory, returns the updated array.
- **React:** MenuBar's mods menu entries gain `onContextMenu` handlers. The right-click opens the dialog; on submit, dispatches `mods/set-nickname` + updates the local `mods` cache from the response.

**Tests:**
- Vitest: MenuBar mods context-menu spec, ModNicknameDialog submission spec.
- Playwright: `mods/set-nickname` round-trip spec — sets a nickname, reads it back via `mods/list`, confirms persistence.

### 5.4 Leftover Tailwind cleanup

After Phase 1 + 2 sweeps, some components will still have hardcoded color/typography Tailwind classes that weren't reached. Grep + audit:

```
grep -RE "bg-neutral-|border-neutral-|text-neutral-|sky-500|rounded-md" web/apps/editor/src
```

Convert each to its token equivalent. Goal: no Tailwind utility class in the codebase that refers to a hardcoded color or radius; anything that's a styling primitive resolves to a design token.

### 5.5 Theme persistence Playwright spec (new)

One new spec covering the localStorage flow end-to-end:
- Set theme to light via the toggle
- Read `localStorage['alo:theme']` to confirm `'light'` was written
- Reload the page (or trigger the App.tsx mount logic)
- Confirm `document.documentElement.dataset.theme === 'light'` after reload

### 5.6 Docs

- **CHANGELOG.md:** at minimum one comprehensive entry covering the redesign; possibly one entry per phase if the diffs are large enough to warrant separate prose. Each follows the partial-backfill convention (`lt-4` commit hash, PR# TODO until master merge).
- **HANDOFF.md:** refresh — new test counts, redesign listed under "what landed," any redesign-specific gotchas captured.
- **ROADMAP.md:** probably no change. LT-4 redesign ≠ LT-4 shipping (Phase 4.2 cutover still pending). Confirm at ship time.

### 5.7 Phase 3 verification gates

1. `pnpm build` clean.
2. Vitest green at whatever the new total is (~197-200 after Phase 2 rewrites + Phase 3 additions).
3. Playwright green (~82-84).
4. MSBuild Debug x64 clean.
5. Computer-use visual check by Claude: open every dialog (File→New on dirty system shows SaveChanges; Help→About shows AboutDialog; right-click→Rescale; right-click on Mods menu entry shows ModNicknameDialog; etc.) and confirm visual consistency with the rest of the app in both themes.
6. `grep -RE "bg-neutral-|border-neutral-|text-neutral-|sky-" web/apps/editor/src` returns zero matches.

---

## 6. Bridge / mock / test impact summary

### 6.1 New bridge surface (total: 2 request kinds + 1 DTO field)

| Surface | Phase | Purpose |
|---|---|---|
| `EngineStateDto.leaveParticles: boolean` | 2.7 | Per-`ParticleSystem` flag for the viewport pill toggle |
| `engine/set/leave-particles { enabled }` | 2.7 | Sets the flag on the current `ParticleSystem` |
| `mods/set-nickname { path; nickname } → { ok; mods; activePath }` | 5.3 | Wires `ModNicknameDialog` — writes registry + refreshes ModManager cache |

### 6.2 MockBridge changes

- **Phase 1:** zero.
- **Phase 2:** `leaveParticles: false` default in `mock-state.ts`; `engine/set/leave-particles` case in `mock.ts`.
- **Phase 3:** `mods/set-nickname` case in `mock.ts` — updates fixture in memory, returns updated array.

### 6.3 Test impact (estimated)

| Suite | Today | Touch (rewrites) | New | Rough end-state |
|---|---|---|---|---|
| Vitest | 191 | ~30-50 in Phase 2 (form rows, panel positions, queries shift) | +6-8 (curve editor multi-channel, viewport pill, nickname dialog, theme toggle) | ~197-200 |
| Playwright | 80 | ~10-15 (background, ground, spawner, tools rewrites) | +2 (theme persistence; nickname round-trip) | ~82-84 |

### 6.4 Per-commit "stay shippable" property

Every commit on `lt-4` after Phase 1.x, 2.x, 3.x is a working editor: a user pulling `lt-4` between commits gets a green build with `pnpm test` and `pnpm test:native` passing. No commit ends with a known-red test suite.

---

## 7. Cross-phase risks

1. **Style drift between phases.** If Phase 2 lands while Phase 1 has remnants (e.g., a panel that didn't get its token swap), Phase 2's new components will look right but adjacent unchanged panels won't. *Mitigation:* Phase 1's gate #6 ("no structural divergence") is mirrored by Phase 2's per-commit gates that verify unchanged components still render correctly with the new tokens.

2. **Test rewrites that ratify wrong behavior.** Rewriting tests to pass against new DOM can accidentally test the wrong thing if done mechanically. *Mitigation:* each Phase 2.x commit's rewrite re-reads the spec, understands intent, and expresses it against the new DOM — not a search-and-replace.

3. **CSS specificity collisions.** Mixing Tailwind utility classes with the design's component classes (`.panel`, `.tree-row`) can produce surprises. *Mitigation:* design's component classes go in `components.css`, imported *after* Tailwind's utility layer — if a conflict shows up, the design class wins (later in source = higher precedence at equal specificity).

4. **Light theme rendering surprises.** Most light-theme bugs only manifest in light mode and aren't caught by dark-only test passes. *Mitigation:* Claude's computer-use visual check at each phase end toggles to light mode and walks through every panel/dialog.

5. **Mods menu's `OccludingMenubarContent` pattern needs to extend to popovers.** Phase 2.2 is the first toolbar-popover that overlaps the D3D9 viewport. *Mitigation:* generalize the wrapper to `OccludingPopover` (or create a parallel `OccludingPopoverContent`) in Phase 2.2 — Phase 2.3 reuses it.

6. **`request_access` grants the wrong binary.** The computer-use resolver caches the v0.2.0 release in Downloads under the same name as our dev binary. *Mitigation (documented):* the visual-verification call pattern is `Bash run_in_background launch → request_access(["particleeditor.exe"])` while it's running → the resolver picks the running PID's actual path (`c:\modding\particle editor\.claude\worktrees\awesome-morse-5ea5c3\x64\debug\particleeditor.exe`). Already established in this session — the dev binary is granted.

---

## 8. Definition of "done"

The redesign is done when ALL of:

1. All 3 phases shipped on `lt-4` with their CHANGELOG entries (hashes recorded per the partial-backfill convention until master merge).
2. `pnpm build` clean.
3. Vitest at ~197-200 (depending on rewrites).
4. Playwright at ~82-84.
5. MSBuild Debug x64 clean.
6. **Manual smoke by user:** launch `--new-ui`, walk through every panel, dialog, dropdown — confirm visual consistency with the design source. Toggle light theme, repeat. Close + relaunch, confirm theme persists.
7. **Computer-use visual verification by Claude:** comprehensive end-to-end walkthrough — launch, screenshot the initial state, click through every menu / dropdown / dialog / tab / panel toggle, screenshot each, compare to design source. Toggle theme, repeat. Any deltas filed as follow-up commits before signoff.
8. **Legacy smoke by user:** launch `--legacy-ui` (no flag) — confirm legacy still works exactly as before. The redesign doesn't touch legacy code paths in any meaningful way, but the verification catches accidental damage.
9. `HANDOFF.md` reflects the new state.
10. `CHANGELOG.md` has the redesign entry/entries.

### Visual verification mechanics

At each phase-end gate + the final comprehensive walkthrough, Claude uses computer-use tools:

1. `Bash run_in_background` launches `./x64/Debug/ParticleEditor.exe --new-ui` (and waits a moment for the window to come up).
2. `mcp__computer-use__request_access(["particleeditor.exe"])` if the dev binary isn't already in the allowlist for the session. The resolver picks the running PID's actual path and grants it.
3. `mcp__computer-use__screenshot` to capture the initial state.
4. Click-through via `left_click` (or `computer_batch` for predictable sequences) — open dropdowns, switch themes, open dialogs, screenshot each.
5. Compare against the design source: `styles.css` for tokens, the design's JSX components for structural patterns, the chat transcript for design decisions captured during iteration.
6. Any visual delta gets filed as a follow-up commit in the same phase before signoff.

---

## 9. Source-of-truth artifacts

These are the inputs the redesign holds itself accountable to:

- **`styles.css`** (design's `:root` and `[data-theme="light"]` blocks) — authoritative for tokens, spacing, radii, typography.
- **`toolbar.jsx`, `left_panel.jsx`, `right_panel.jsx`, `viewport.jsx`, `curve_editor.jsx`, `background_popover.jsx`, `ground_popover.jsx`** — authoritative for component structure and composition.
- **`chat1.md`** — captures the design author's iterative decisions (button removal, restructure, icon swaps, etc.). Used to resolve "why is X this way" questions during implementation.
- **`Particle Editor 2026.html`** — the assembled mockup. Reference for assembled layout; the JSX files are the granular truth.
- **`assets/icon-ground.svg`, `assets/icon-bloom.svg`, `assets/icon-particles.svg`** — copy into `web/apps/editor/public/icons/` for the viewport pill.

All extracted from the design bundle at `C:\Users\antho\AppData\Local\Temp\nu-particle-editor\nuparticle-editor\` for the duration of implementation.

---

## 10. Out of scope / deferrals

Items explicitly NOT in the redesign, captured here so future questions about them have an answer:

- **Tweaks panel** — `tweaks-panel.jsx` exists in the bundle but skipped per user decision.
- **Bloom Settings as toolbar dropdown** — kept as `ToolPanel` sliding panel (View → Bloom Settings…).
- **Lighting as toolbar dropdown** — kept as `ToolPanel` sliding panel (View → Lighting…).
- **Live OS-theme subscription** mid-session — theme locks in at mount + user toggle.
- **Visual regression testing infrastructure** (screenshot diffing, snapshot tests) — deferred.
- **Multi-mod stacks, Workshop mod detection, per-key context menu Snap-to-grid** — pre-existing deferred items, unaffected.
- **Phase 4.2 legacy chrome cutover** — separate concern; gated on parity acceptance.

---

## 11. Open items to revisit post-redesign

Don't block the redesign but become more interesting once it ships:

1. **Phase 4.2 cutover** (delete legacy `src/UI/*.cpp` and legacy menu code) — after the redesign, the user has a finished new-UI to compare against; that may resolve the cutover decision either way.
2. **ROADMAP `[LT-4]` shipping entry** — update if the redesign crosses a "done enough" threshold; probably not until cutover.
3. **Master merge of `lt-4`** — eventually. Redesign ships via PR from `lt-4` to `master`; partial-backfill CHANGELOG entries get rewritten with merge-commit hashes + PR number at that point.
4. **Tweaks panel revival** — if user changes their mind, the design source includes it.

---

## 12. Appendix — design tokens (verbatim from `styles.css`)

### 12.1 Dark theme (default `:root`)

```css
:root {
  --bg: #0e1116;
  --bg-2: #141821;
  --bg-3: #1a1f2b;
  --panel: #161b25;
  --panel-2: #1c2230;
  --panel-3: #232a3a;
  --border: #252b38;
  --border-2: #2e3547;
  --hover: #1f2532;
  --selected: #213149;
  --selected-border: #355385;
  --text: #d8dee9;
  --text-2: #a3acbd;
  --text-3: #6b7488;
  --accent: #4ea3ff;
  --accent-2: #2f7fd4;
  --accent-soft: rgba(78, 163, 255, 0.16);
  --danger: #e06c75;
  --success: #6fbf7a;
  --warning: #e0a14b;
  --x-axis: #ef5350;
  --y-axis: #66bb6a;
  --z-axis: #42a5f5;
  --shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
  --radius: 8px;
  --radius-sm: 5px;
  --row-h: 26px;
  --row-h-sm: 22px;
}
```

### 12.2 Light theme overrides

```css
[data-theme="light"] {
  --bg: #e9ecf2;
  --bg-2: #f0f2f6;
  --bg-3: #ffffff;
  --panel: #f6f7fa;
  --panel-2: #ffffff;
  --panel-3: #eef0f5;
  --border: #d8dce4;
  --border-2: #c4c9d4;
  --hover: #e6e9ef;
  --selected: #d5e4f8;
  --selected-border: #79a8e6;
  --text: #1a1f29;
  --text-2: #4a5366;
  --text-3: #7c8497;
  --accent: #2f7fd4;
  --accent-2: #1f63b0;
  --accent-soft: rgba(47, 127, 212, 0.14);
}
```

### 12.3 Typography

- Font stack: `"Inter", "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Base size: `12px`
- Font features: `"ss01", "cv11"` (alternate stylistic sets — tabular numerals + alternates)
- Smoothing: `-webkit-font-smoothing: antialiased`
- User-select: `none` globally on `body` (text fields opt in)

### 12.4 App shell grid

```css
.app {
  display: grid;
  grid-template-rows: 36px 44px 1fr 22px;  /* menubar / toolbar / workspace / statusbar */
  height: 100vh;
  background: var(--bg);
}

.workspace {
  display: grid;
  grid-template-columns: 320px 1fr 340px;  /* left / center / right */
  gap: 6px;
  padding: 6px;
  min-height: 0;
}

.workspace-center {
  display: grid;
  grid-template-rows: 1fr 260px;  /* viewport / curve editor */
  gap: 6px;
  min-height: 0;
  min-width: 0;
}
```

When Spawner is hidden, `workspace` becomes `grid-template-columns: 320px 1fr` (no right column).

---

## 13. Approval history

- Brainstorming session: 2026-05-19 (this same day)
- Phasing strategy: Option B (3 phases by layer) — approved
- Test discipline: Option A (rewrite tests per commit, suite stays green) — approved
- Theme persistence: Option A (`localStorage` only, `prefers-color-scheme` default at first launch) — approved
- Lighting / Bloom Settings disposition: Option A (keep as ToolPanel, re-skin only) — approved
- Curve editor Index channel: keep as 7th channel, default off — approved
- "Leave particles" toggle: confirmed engine support exists, add bridge call — approved
- ModNicknameDialog: wire up rather than skip — approved
- Visual verification by Claude via computer-use: added to Definition of Done — approved
- Tailwind disposition: stays in Phase 1 with token aliases — approved
- Inter font: variable woff2, bundled locally, `font-display: block` (no FOUT) — approved

---

End of spec.
