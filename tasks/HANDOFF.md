# Session Handoff — AloParticleEditor / LT-4 (left-pane polish B1.2)

**Last updated:** 2026-05-20 (end-of-session — B1.2 left-pane polish shipped: Section primitive, BasicTab restructured into Emitter Timing / Generation / Connection, `.name-row` modifier class, Name input full-width, toolbar Duplicate button, Show/Hide icon swap)
**Last conversation context:** Polish dispatch executing the B1.2 plan on top of B1. All five implementation P-tasks landed plus brainstorm spec + plan + this docs commit (P1 audit was a no-op — no commit). New `Section` primitive at `src/components/Section.tsx` gives BasicTab three collapsible groupings (Emitter Timing / Generation / Connection) matching the design source's `left_panel.jsx`. Name field gets a custom `60px 1fr` grid via a new `.form-row.name-row` modifier class in `components.css` so the input fills available width; `FieldText` learns a `wide?: boolean` prop for embedding in custom-grid rows. Tree toolbar gains a Duplicate button between New ▾ and Delete (dispatches existing `emitters/duplicate`). Show All / Hide All become Lucide `Eye` / `EyeOff` icon buttons. Cumulative vitest delta 239 → **254** (+15); Playwright stable at 83/83. Next dispatch is **B1.3** — resizable splitters via `react-resizable-panels`. **B2** (Appearance + Physics wiring) is the secondary follow-up.

Test counts: vitest **254 / 254**, Playwright **83 / 83**, MSBuild Debug x64 clean (no C++ change this dispatch).

---

## Read first

If you are a fresh Claude session resuming this project:

1. **This file** — top to bottom.
2. **[CLAUDE.md](../CLAUDE.md)** — project conventions, plan structure, handoff discipline. The `## Branch workflow` section is load-bearing: `lt-4` is the integration branch; new sessions land on `claude/<random>` and FF into `lt-4` at session end.
3. **[CHANGELOG.md](../CHANGELOG.md)** — the top entry (B1.2 left-pane polish) covers what just shipped; the B1 entry below covers the structural realignment this polish sits on; entries further down (curve editor polish, Phase 2.8 focus-channel restore, Phase 2.1–2.7 structural moves, Phase 1 tokens + theme) cover the architectural foundation.
4. **If picking up B1.3 / B2 / Phase 3** (most likely next step):
   - **[docs/superpowers/specs/2026-05-19-particle-editor-2026-redesign.md](../docs/superpowers/specs/2026-05-19-particle-editor-2026-redesign.md)** — full design spec.
   - **[docs/superpowers/plans/2026-05-19-particle-editor-2026-redesign.md](../docs/superpowers/plans/2026-05-19-particle-editor-2026-redesign.md)** — step-by-step plan. **Phase 3 still references `tailwind.config.ts` in a few places — those need the same Tailwind v4 / `globals.css` translation Phase 1 got** (see the re-plan note at the top of Phase 1 for the pattern).
5. **[tasks/lessons.md](lessons.md)** — L-001 through L-006. **L-006 (don't clear React optimistic state on every host-data refresh) is now load-bearing in `CurveEditorPanel.tsx` — the spinners' optimistic override comes from that pattern.**
6. **[tasks/lt4_phase_4_1_acceptance.md](lt4_phase_4_1_acceptance.md)** — parity acceptance checklist. §16 lists intentional divergences from legacy. The 2026 redesign's structural moves don't update this doc; treat it as parity baseline for the legacy `--legacy-ui` path only.
7. Recent `git log --oneline -20` — Phase 1 + 2 of the redesign at the tip, prior LT-4 dispatch history below.

---

## Resumable state (snapshot)

| Thing | Value |
|---|---|
| **Worktree** | `C:\Modding\Particle Editor\.claude\worktrees\sweet-vaughan-dc78c1` (this session's; next session gets a fresh `claude/<random>` path) |
| **Branch** | `claude/sweet-vaughan-dc78c1` → integrates back into `lt-4` per the standard end-of-session FF. Tracks `origin/lt-4`. |
| **HEAD (committed)** | This docs commit at the top of the session branch (B1.2 P6). Top non-docs commit is `a2d1fb6` (`feat(LT-4): Show All / Hide All become Eye / EyeOff icon buttons`). |
| **Working tree** | clean. |
| **Ahead of origin/lt-4** | The B1 trailing commits (FF'd at session start, see below) plus the B1.2 stack: brainstorm spec + plan + 5 implementation commits (P2 Section, P3 BasicTab restructure, P3-fix `.name-row` refactor, P4 Duplicate button, P5 Show/Hide icons) + this P6 docs commit. Needs FF + push at end of this session OR start of next. |
| **Behind master** | `lt-4` is ~353+ commits ahead of `master` (`b28f624`); none merged yet, all backed up to `origin/lt-4`. |
| **Open PRs** | none |
| **Build status** | MSBuild Debug x64 clean (preexisting LIBCMTD warning; no C++ change this dispatch). Vitest **254 / 254**. Playwright **83 / 83**. |
| **Phase status** | Particle Editor 2026 redesign — **Phase 1 + Phase 2 + curve editor polish + B1 left-pane realignment + B1.2 left-pane polish shipped. Phase 3 not started; next dispatch is B1.3 (resizable splitters via `react-resizable-panels`); B2 (Appearance + Physics wiring) is the secondary follow-up.** Legacy `--legacy-ui` mode is untouched throughout. |

**Worktree note.** The Claude Code desktop app provisions a fresh worktree on every session start; this session is in `sweet-vaughan-dc78c1`, succeeding `charming-williams-0efd47`. Branch name follows the worktree name. The commit lineage is preserved — only the path / branch label change.

**NuGet pre-flight (fresh worktrees only).** `.gitignore` excludes `packages/`, so the first MSBuild in a fresh worktree fails with *"missing Microsoft.Web.WebView2.targets"*. Restore explicitly before the first build:

```bash
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" \
  "ParticleEditor.sln" //t:Restore //v:m
```

Then the standard Debug x64 build works. Skip this step on a worktree that's already been built in once.

---

## What landed this session — B1.2 left-pane polish (on top of B1, which FF'd to `origin/lt-4` at session start)

In execution order (oldest → newest):

| Commit | What |
|---|---|
| `85503ae` | **docs(LT-4): brainstorm spec — left-pane polish (B1.2)** — captured intent + scope + tradeoffs for the polish dispatch before any plan was written. |
| `27f2877` | **docs(LT-4): implementation plan — left-pane polish (B1.2)** — 6-task plan (P1 CSS audit → P6 docs). Goal + scope, codebase-survey, architecture, risks, testing checklist per CLAUDE.md plan structure. |
| *(no commit)* | **P1 CSS audit — no-op.** Audit found `components.css` already in sync with the design source. No commit needed. |
| `7ce9155` | **feat(LT-4): Section primitive — collapsible header with keyboard support** (P2) — ~40-line `Section` component at `src/components/Section.tsx`. Entire header row clickable; Enter/Space when focused; `aria-expanded` reflects state; `data-testid` derived from title. 8 specs covering toggle behaviour, default open, keyboard activation, testid derivation, reset-on-remount. |
| `efda121` | **feat(LT-4): BasicTab restructure — Emitter Timing / Generation / Connection sections + Name row** (P3) — BasicTab wraps existing field components in three `Section`s matching the design source's `left_panel.jsx`. Name row sits outside any Section using a custom `60px 1fr` grid. 3 specs covering section presence, field counts, Name-row placement. |
| `a79086a` | **refactor(LT-4): Name row uses `.form-row.name-row` modifier class** (P3-fix) — caught in code review: the inline `style={{ gridTemplateColumns: "60px 1fr" }}` on the Name row broke the established `.form-row.full` / `.with-radio` / `.with-check` modifier-class convention. Refactored to a new `.form-row.name-row` class in `components.css`; `FieldText` gained a `wide?: boolean` prop so callers can embed in custom-grid rows without the default `.form-row` wrapper. |
| `12d01c4` | **feat(LT-4): Duplicate button on tree toolbar** (P4) — between New ▾ and Delete. Dispatches the existing `emitters/duplicate` bridge surface (consumed by the context-menu Duplicate item before this). Disabled when no primary is selected. Uses the existing `TOOLBAR_BTN` className. 3 specs covering presence, dispatch, disabled-state. |
| `a2d1fb6` | **feat(LT-4): Show All / Hide All become Eye / EyeOff icon buttons** (P5) — swap from custom text-button classNames to `TOOLBAR_BTN` with Lucide `Eye` / `EyeOff` icons. Tooltips preserve the full text. Toolbar disambiguates from per-row eye via size (`size-4` vs `size-3`), brightness (`text-text-2` vs `text-text-3`), and cardinality (paired action vs per-row toggle). 1 spec covering icon presence + tooltip text. |

Plus this P6 docs commit refreshing CHANGELOG + HANDOFF.

### B1 trailing commits (FF'd to `origin/lt-4` at session start, kept for context)

In execution order (oldest → newest):

| Commit | What |
|---|---|
| `df1bba7` | **feat(LT-4): curve editor — unified range, scale solo, drag UX, layout robustness** — prior session's curve-editor polish that hadn't been FF'd to `lt-4` yet. Carried into this session at the base of the branch. |
| `160fffe` | **docs(LT-4): brainstorm spec — left-pane realignment (B1)** — captured intent + scope + alternative paths considered for the B1 work before any plan was written. |
| `0c61139` | **docs(LT-4): implementation plan — left-pane realignment (B1)** — 9-task plan (P1 single-member filter → P9 docs). Goal + scope, codebase-survey, architecture, risks, testing checklist per CLAUDE.md plan structure. |
| `7133709` | **feat(LT-4): filter single-member link groups in computeLinkGroupBrackets** (P1) — `count < 2` skip at the render layer so no group renders as a single-row stub. Existing test fixture rewritten to assert the new behaviour. |
| `ad90459` | **feat(LT-4): multi-lane bracket gutter via greedy first-fit lane assignment** (P2) — `LinkGroupBracket` gains a `lane: number` field; a third pass in `computeLinkGroupBrackets` sorts by `firstRowIndex` and assigns the lowest free lane (aggressive reuse). |
| `c03df1d` | **feat(LT-4): add laneCount helper for gutter width derivation** (P3) — companion `laneCount` export so the renderer can size the gutter container without inline reduces. |
| `212bcd6` | **feat(LT-4): render multi-lane bracket gutter in EmitterTree** (P4) — `EmitterTree.tsx` gutter renderer sized by `laneCount * 10 + 4px` (or `4px` minimum) with each bracket positioned at `left = 4 + lane * 10`. |
| `49f6a39` | **feat(LT-4): per-row visibility eye on each tree row** (P5 initial) — per-row 👁 eye added to every row. *Was* implemented as a nested `<button>` per the plan, which Task 6 below corrects. |
| `e6ffbdc` | **fix(LT-4): per-row eye is a span, not a nested button** (P5 fix) — caught in self-review: nested `<button>` is invalid HTML and browsers hoist the inner button out at parse time. Switched to `<span role="button" tabIndex={0}>` with explicit `onClick` + `onKeyDown` (Enter/Space). |
| `46dba1b` | **feat(LT-4): row layout becomes 3-column grid, per-row link-group dot dropped** (P6) — row container converted from flex to a 3-column CSS grid `[12px glyph] [1fr name] [18px eye]` so eyes column-align across all rows. The per-row sky-blue link-group dot is removed in favour of the gutter brackets alone (legacy parity). |
| `6a804b0` | **feat(LT-4): tree toolbar moves below the `<ul>`, restyles to .tree-actions, drops eye** (P7) — `<EmitterTreeToolbar>` moves from above the tree to after it; outer container restyled to `.tree-actions` (banded hairlines top + bottom); the toolbar's primary-only eye-toggle button + its `primaryVisible` / `EyeGlyph` / `toggleVisibility` helpers (now unused) are removed. |
| `9b6326b` | **feat(LT-4): drop hard border between tree region and inspector** (P8) — one-line edit removing `border-t border-border` on the inspector wrapper in `App.tsx`. The tab strip's underline carries the transition naturally. |

Plus the B1 P9 docs commit refreshing ROADMAP + CHANGELOG + HANDOFF (FF'd to `origin/lt-4` at the start of this session alongside the rest of the B1 stack).

---

## Previously landed (kept for context)

The earlier Phase 1 + Phase 2 + curve-editor-polish dispatches are still the structural foundation under B1 + B1.2. In execution order (oldest → newest):

| Commit | What |
|---|---|
| `c92c76e` | **docs(LT-4): re-plan Phase 1 for Tailwind v4 reality** — rewrote Phase 1 of the plan in place when the original draft turned out to assume Tailwind v3 with a JS `tailwind.config.ts` that doesn't exist (project is on Tailwind v4, CSS-first `@theme`). Phase 1 renumbered to 7 tasks (was 8); the deleted Task 1.3 ("Extend Tailwind config") folded into the new Task 1.1's `@theme inline` block. |
| `9df821d` | **feat(LT-4): Phase 1 — token system + theme toggle** — single squashed commit. New CSS files under `src/styles/` (`tokens.css` with `:root` + `[data-theme="light"]` + `@theme inline`; `base.css` with `@font-face` for Inter + scrollbar styling; `components.css` from the design bundle's reusable classes). Inter variable woff2 bundled at `public/fonts/inter/InterVariable.woff2` (note rename from the spec's stale filename). `globals.css` drops the legacy `@theme` block (verified zero consumers) and imports the three new files. `ThemeToggle.tsx` is a Sun / Moon segmented control; theme persists to `localStorage('alo:theme')` with a `matchMedia('(prefers-color-scheme: dark)')` fallback. `App.tsx` applies the same logic at mount so first paint is themed. `test-setup.ts` gains `localStorage` + `matchMedia` stubs and an `afterEach localStorage.clear()`. 30-file utility-class sweep replaces `bg-neutral-*` / `text-neutral-*` / `border-neutral-*` / `sky-*` with token-backed equivalents per a fixed substitution table. |
| `24179ec` | **fix(LT-4): align five View-menu items missing the CheckSlot indent** — Step Forward / Reset Camera / Reload Shaders / Reload Textures / Reset View Settings were rendering text flush against the menu's left padding while sibling items with checkboxes had 14 px of indent. Fix is one empty `<CheckSlot active={false} />` per item. Pre-existing alignment bug; surfaced during Phase 1 visual verification. |
| `64b49ed` | **feat(LT-4): Phase 2.1 — toolbar reorganization** — Toolbar.tsx uses the design's semantic classes (`.toolbar` / `.tb-group` / `.tb-btn` / `.tb-divider` / `.tb-spacer`); four groups (File · Playback · Spawner toggle · spacer · Environment + ThemeToggle); removes Undo/Redo/Bloom/Reload (they live in the menubar); adds Save As and Step 10; new `useSpawnerVisibility` per-component hook (upgraded in 2.4). |
| `6aa6206` | **feat(LT-4): Phase 2.2 — Background → toolbar dropdown popover** — new `BackgroundDropdown` + `OccludingPopover` (generalisation of `OccludingMenubarContent` so the popover registers as a viewport occlusion). `BackgroundPicker` body extracted as `BackgroundPickerBody`. Slide-in mount removed from App.tsx. `BackgroundButton.tsx` deleted. |
| `2a77249` | **feat(LT-4): Phase 2.3 — Ground → toolbar dropdown popover** — same pattern. New `GroundDropdown`; `GroundTexturePanelBody` extracted. |
| `2759c27` | **chore(LT-4): remove dead Background/Ground Texture entries from View menu** — small follow-up to 2.2/2.3. The View menu's "Background…" and "Ground Texture…" items had been left in place during the per-task commits; they were no-ops after the slide-ins came out. Now removed along with their `onOpen*` props. |
| `17768b6` | **feat(LT-4): Phase 2.4 — Spawner permanent right column** — `useSpawnerVisibility` upgraded to a Zustand store (`useSpawnerVisible` / `useToggleSpawner` / `toggleSpawner` + a `useSpawnerVisibility` compat shim + `__resetSpawnerVisibilityForTests`). SpawnerPanel uses `.panel` / `.panel-header` (X-close → toggleSpawner) / `.panel-body` instead of ToolPanel. App.tsx workspace becomes 3-column when visible. Emitters menu's "Spawner…" rewired to `toggleSpawner`. |
| `0fd093d` | **feat(LT-4): Phase 2.5 — left panel restack with .panel chrome + .form-row grid** — left column wraps in `.panel` chrome (header "Particle System"). The 46-ish form rows across Basic / Appearance / Physics tabs convert to the design's `.form-row` 3-column grid (label / input / unit) via the existing `FieldText` / `FieldSpinner` / `FieldCheckbox` primitives. Multi-spinner clusters (Random Colours, Acceleration, Vec3Row) use `gridColumn: "2 / span 2"` inline as a tactical workaround. |
| `329c595` | **feat(LT-4): Phase 2.6 — curve editor moves to always-on bottom 260px** — new `CurveEditorPanel.tsx` in the centre column's bottom row; 7-channel curve-list (Scale / R / G / B / A / Rotation / Index — Index defaults off); multi-channel SVG overlay rendering one `<g data-testid="curve-layer-${id}">` per visible channel. **This commit deleted `TrackEditor.tsx` (866 lines) and `EmitterPropertyPanel.tsx` (176 lines) entirely**, losing the entire curve edit surface (Time/Value spinners, marquee, drag, Insert mode, interpolation toggle, lock-to combo, per-key context menu, panel-level Delete handler). Phase 2.8 restores them on top of this rendering substrate. |
| `83ee7a5` | **feat(LT-4): Phase 2.7 — viewport pill + engine/set/leave-particles bridge** — new top-left vertical pill in the viewport with three engine toggles (Show ground / Toggle bloom / Leave particles after instance death). The leave-particles bridge surface is new end-to-end (schema + MockBridge + C++ dispatcher), wired to ParticleSystem's existing `getLeaveParticles()` / `setLeaveParticles()` methods — the runtime path was already chunk-serialised + honoured at `Engine::KillParticleSystem`. |
| `3cd840a` | **feat(LT-4): hybrid focus-channel curve editor — restore edit surface** — restores everything Task 2.6 deleted on top of the multi-channel overlay using a focus-channel model. Clicking a channel row sets that channel as the edit focus (visible indicator: `data-focus="true"` + `bg-accent-soft`); the focus channel's curve renders thick + opaque + interactive while the other visible channels render thin + dimmed + non-interactive as background context. New `.ce-toolbar` row above the canvas with Select / Insert mode toggle, Linear / Smooth / Step interpolation, Lock-to combo, Time / Value spinners (L-006 sticky optimistic override). Window-scoped Delete keyboard handler with `TYPING_TAGS` guard. Vitest +19 (200 → 219); Playwright +4 (78 → 82 passing). |
| `339ab95` | **feat(LT-4): curve editor polish — lock-to, axis labels, theme grid, robust spinners, spawner bg fix** — the dispatch immediately preceding B1, FF'd to `origin/lt-4`. Lock-to wired end-to-end (`emitters/set-track-lock`), HTML axis labels, theme-aware grid via CSS variables, native-wheel-listener spinners, Spawner panel bg opacity. Vitest 219 → 221. |

---

## Open items (load-bearing — read before resuming)

### 0. B1.3 — Resizable splitters via `react-resizable-panels` (next dispatch)

The next move. B1 finished the structural realignment, B1.2 tightened the interior fidelity; B1.3 makes the left / centre / right column boundaries draggable so users can size the panes to taste. Target library is `react-resizable-panels` (battle-tested, accessible drag handles, persistence hooks). Specifics will be defined in a separate brainstorm + plan pair. Standard CLAUDE.md plan structure expected. Persistence target is `localStorage` like the theme toggle; default sizes match the current fixed widths.

### 0b. B2 — Appearance + Physics tab wiring (secondary follow-up)

After B1.3. B1.2 finished the BasicTab restructure; B2 wires the Appearance and Physics inspector tabs to the live model so the form-row controls actually drive engine state through the bridge instead of being placeholder visuals. Specifics will be defined in a separate brainstorm + plan pair; the spec source is the design bundle's `appearance.html` + `physics.html`. Standard CLAUDE.md plan structure expected.

### 1. ~~Ground-texture engine bug~~ ✅ FIXED 2026-05-20 (commit `92ed1db`)

The ground-texture lockup is fixed. Root cause: `m_pSkydomeEffect` (added in MT-3) was missing from `Engine::Reset`'s `OnLostDevice` / `OnResetDevice` pattern, leaving `D3DPOOL_DEFAULT` references active across `IDirect3DDevice9::Reset` → device latched at `D3DERR_DEVICENOTRESET` → all subsequent `D3DX*` calls failed with `D3DERR_NOTAVAILABLE`. Two-line fix in [`engine.cpp:1360`](src/engine.cpp:1360). Belt-and-suspenders: `Engine::RecoverDeviceIfNeeded()` ([`engine.h:123`](src/engine.h:123)) + `LayoutBroker::Apply` catch-path fallback. Full diagnostic trail in [`tasks/lessons.md` L-007](lessons.md).

**`abort()` dialog (user-reported, prior handoff).** Not reproduced. Probably a separate code path; could have been a stale capture. Worth checking if it resurfaces.

### 1b. ~~Curve editor polish~~ ✅ SHIPPED 2026-05-20 (commit `339ab95` FF'd to `origin/lt-4`)

A round of interactive smoke-testing through the curve editor surfaced a stack of issues the user wanted addressed. All fixed and verified through `pnpm build` + `pnpm test` + MSBuild + `pnpm test:native` (83/83). See top-of-CHANGELOG entry for the full breakdown; high-level summary:

- **Spawner panel transparent leak** → `bg-panel` on the right aside.
- **Curve editor strip layout** → `minmax(0, 1fr)` row/col templates, `h-[290px]`, `flex: 1` on `.curve-editor`.
- **Lock-to feature wired end-to-end** → new schema kind `emitters/set-track-lock`, C++ handler swapping `emit->tracks[i]` pointer, `TrackDto.lockedTo` derived from pointer equality, React dispatches on dropdown change, edit affordances disable when locked.
- **Per-channel value-range rules** → RGBA fixed `{0,1}`, Scale/Index auto-grow upper, Rotation auto-grows both ways with no caps.
- **Spinner-bounds vs display-range split** → fixed the "can't push Scale past 20" deadlock.
- **Toolbar icons** (Lucide + inline SVG glyphs for the interp modes) with `flex-wrap` fallback for narrow windows.
- **Spinner improvements** → always-visible arrows, native-wheel-listener-with-`{passive:false}` (bypasses React 18 passive default), wheel works anywhere over the spinner including the arrow column.
- **HTML axis labels** in a CSS-grid sibling cell (avoids `preserveAspectRatio="none"` glyph distortion).
- **Theme-aware grid colours** via `--curve-grid` / `--curve-axis` CSS variables (dimmer in light theme).
- **`overflow="visible"` on the SVG** so endpoint key circles draw their full body even when their centre is on the grid edge.

**Status:** FF'd to `origin/lt-4` at the start of this session as `339ab95`. No outstanding work.

### 1c. ~~B1 left-pane realignment~~ ✅ SHIPPED (FF'd to `origin/lt-4` at the start of this session)

P1–P8 implementation + brainstorm + plan + the B1 P9 docs commit. FF + push completed at session start. Full breakdown in the "B1 trailing commits" table above and the second CHANGELOG entry.

Two ROADMAP follow-ups filed for B1 work that's worth doing later but deliberately out-of-scope:

- **[NT-5] Engine-side single-member link-group enforcement.** B1 ships a render-layer filter; the data layer can still carry single-member groups. NT-5 makes the data layer match the rendered view end-to-end across the three C++ mutation paths.
- **[NT-6] Visual-stability lane assignment for bracket gutter (option).** B1 uses aggressive-reuse greedy first-fit; a setting that opts the user into `lane = (groupId - 1) % maxLanes` would keep lanes stable across renders. Only worth doing if the bouncing turns out to be a real ergonomic issue.

### 1d. ~~B1.2 left-pane polish~~ ✅ SHIPPED this session (uncommitted FF — needs FF into `lt-4` + push)

P2 Section + P3 BasicTab restructure + P3-fix `.name-row` refactor + P4 Duplicate + P5 Show/Hide icon swap, plus brainstorm + plan + this P6 docs commit (P1 audit was a no-op). Per CLAUDE.md branch workflow, fast-forward into `lt-4` and push to `origin/lt-4` with explicit user OK. Full breakdown in the "What landed this session" table above and the top CHANGELOG entry.

### 2. Phase 2 / 3 references to `tailwind.config.ts` in the plan still need v4 translation

Phase 1 of the plan was rewritten in place ([`c92c76e`](https://github.com/DrKnickers/new-particle-editor/commit/c92c76e)) when the original draft assumed Tailwind v3. Phase 2 and Phase 3 of the same plan still reference `tailwind.config.ts` in a few spots — those need the same translation (config moves to a `@theme inline` block in CSS; entry stylesheet is `src/styles/globals.css` not `src/index.css`; the `body { bg-transparent }` FD4 invariant must be preserved). Search the plan for `tailwind.config.ts` to find the spots; the Phase 1 re-plan note documents the translation pattern.

### 3. Phase 3 outstanding work

Per [the plan](../docs/superpowers/plans/2026-05-19-particle-editor-2026-redesign.md), Phase 3 is the cleanup pass:

- **3.1** Modal primitive re-style (cascades to every consuming dialog).
- **3.2** ModNicknameDialog wiring + new `mods/set-nickname` bridge surface (right-click on a Mods menu entry → opens the nickname dialog → writes nickname → re-scans + propagates).
- **3.3** Per-dialog visual passes (ImportEmittersDialog / ModNicknameDialog / RescaleDialog / RescaleEmitterDialog / AboutDialog / SaveChangesPrompt / IncrementIndexDialog / LinkGroupSettingsDialog) — re-skin each dialog body against the new tokens.
- **3.4** Tailwind leftover cleanup sweep (grep for any remaining `bg-neutral-*` / `sky-*` etc. that the Phase 1.6 sweep missed).
- **3.5** Theme persistence Playwright spec (`tests/theme-persistence.spec.ts` driving the ThemeToggle and asserting via `localStorage` + `dataset.theme`).
- **3.6** Docs + final verification + ship — CHANGELOG entries already exist from Phase 1 / 2 / 2.8; Phase 3 adds its own.

Phase 3 is mostly mechanical and smaller surface than Phase 2. Reasonable to do in one session.

### 4. Phase 4.2 cutover still gated

The redesign work is on `lt-4`; legacy `--legacy-ui` Win32 mode is untouched. Phase 4.2 (delete legacy chrome at `src/UI/` and the legacy `main.cpp` paths) is still gated on the user signing off on parity acceptance at [`tasks/lt4_phase_4_1_acceptance.md`](lt4_phase_4_1_acceptance.md) §17 (currently empty). The 2026 redesign may shift the parity conversation — much of the "is parity good enough" question gets resolved by the new design hitting production polish.

---

## Hard-won lessons (preserve!)

All in `tasks/lessons.md`. **Read L-002, L-003, L-004, L-006 carefully before any test / build / optimistic-state work.**

- **L-001** — Don't infer binary provenance from bitness + timestamp alone (Petroglyph 64-bit patch incident).
- **L-002** — Repo-root `.gitignore` `**/packages/*` eats `web/packages/*` source; use scoped negation.
- **L-003** — WebView2 silently drops `chrome.webview.postMessage` after CDP attachment. Playwright contract tests route through `chrome.webview.hostObjects.hostBridge` instead.
- **L-004** — `pnpm test` (Vitest) doesn't type-check. `tsc --noEmit` (single-project) ≠ `tsc -b` (build mode with project references). Truth is `pnpm build`. Verification sequence: `pnpm build` → `pnpm test` → `pnpm test:native`.
- **L-005** — pnpm v11 `allowBuilds:` block wants a boolean, not the literal placeholder string. Edit the workspace yaml directly.
- **L-006** — Don't clear React optimistic state on every host-data refresh. Use sticky overrides cleared only on explicit user-action selection-change. **Now load-bearing in `CurveEditorPanel.tsx` — Phase 2.8's Time/Value spinners use this pattern.**
- **L-007** — When a Playwright contract test fails and the "obvious fix" is to rewrite what the test asserts, verify the rewrite *in-situ under the failing conditions* before relying on it. The bigger test failing while the smaller passes can mean either (a) the bigger was too brittle, or (b) the engine has a real bug that the smaller test ALSO can't see in isolation. Always check (b) before declaring (a). Caught the ground-texture engine bug this session — without the in-situ check, the test-rewrite "fix" would have shipped a silent regression.

### Patterns from this session worth remembering

#### Tailwind v4 vs v3 — CSS-first vs JS-config

Tailwind v4 generates utility classes from CSS variables in `@theme {}` blocks; there is no `tailwind.config.ts`. The pattern: declare design tokens as plain `:root` vars (`--bg: #0e1116`), then in a sibling `@theme inline { --color-bg: var(--bg); }` block republish them as `--color-X` names. The `inline` keyword keeps values as `var()` references so `[data-theme="light"]` overrides flip at runtime. Result: `bg-bg`, `text-text-3`, `border-border-2`, `accent` etc. utility classes work alongside Tailwind defaults (`bg-neutral-900` still resolves until swept). When the plan / spec references `tailwind.config.ts` it's stale — do the v4 translation in CSS.

#### jsdom in this project doesn't expose Web Storage or matchMedia

`window.localStorage` and `window.matchMedia` are both undefined in jsdom v25 as configured here. Test-setup.ts (`src/test-setup.ts`) has stubs for both alongside the existing ResizeObserver / PointerEvent / scrollIntoView stubs. The `afterEach(() => localStorage.clear())` is what prevents per-component persistence from leaking across tests. If a new feature reaches for `window.X` and jsdom doesn't have it, add the stub to that file matching the existing pattern.

#### Popover dropdowns need OccludingPopover, not stock Radix Popover.Content

The viewport popup is FD9b's layered window with software alpha-stamp cut-outs at chrome occlusion rects. A stock Radix `Popover.Content` would render *behind* the engine viewport because the host doesn't know to punch an alpha cut at its rect. Use `OccludingPopover` (in `src/components/OccludingPopover.tsx`) — same `(bridge, occlusionId)` props as `OccludingMenubarContent`, with 24px padding + smoothstep feather to enclose the shadow-xl drop shadow.

#### Multi-channel curve overlay + focus channel = one SVG branch

When the user picked "hybrid focus-channel" for the curve editor restore, the natural-looking decomposition (multi-channel `MultiChannelCurves` for visualisation + single-channel `CurveEditor` for editing, layered) would have doubled the grid / axis / backdrop nodes and complicated pointer routing. The chosen shape is one SVG with a focus-aware render branch: each `<g data-testid="curve-layer-${id}">` renders either focus-styled (thick + opaque + key markers + pointer-events: auto) or background-styled (thin + dim + no markers + pointer-events: none). Single pointer-capture owner, single backdrop, single test-stable layer-per-channel selector.

#### Phase 2.1's per-component useState → Phase 2.4's Zustand store

When a piece of state needs to be shared across a toolbar button, a workspace grid, a panel header X-close, a menu item, and a keyboard shortcut, the per-component `useState` placeholder you wrote in an early sub-task should upgrade to a Zustand store as soon as the second consumer comes online. The pattern in `lib/spawner-visibility.ts`: store with persisted-to-localStorage `visible: boolean` + `toggle()` + `setVisible(v)` + a `__resetForTests` reset, plus a `useSpawnerVisibility()` compat shim returning `{visible, toggle}` so the older callsite keeps working without restructure.

#### Plan re-write before code, not during

The original Phase 1 plan referenced Tailwind v3 + `tailwind.config.ts` + `src/index.css`. Spotting this at the start of execution forced a stop-and-reconsider. The fix was a docs-only commit rewriting Phase 1 in place (with a "Re-plan note" at the top explaining the v3 → v4 translation) **before** any implementation code landed. Diff stays readable; future readers see the rewrite as its own commit with a clear motivation. Alternative ("substitute Tailwind v4 syntax on-the-fly while implementing") would have left the plan stale and the diffs hard to follow.

---

## Pre-flight checklist for next session

Run these in order before touching code:

```bash
# 1. Confirm worktree is current. (The path may be different — the
#    desktop app provisions a fresh worktree each session.)
cd "/c/Modding/Particle Editor/.claude/worktrees/$WORKTREE_NAME"
git worktree list
git log --oneline -5    # HEAD should be the B1.2 P6 docs commit (this one) or the next dispatch's
git status              # clean
git log --oneline lt-4..HEAD   # 0 if session branched cleanly from lt-4 (assuming B1 FF'd)
git log --oneline HEAD..lt-4   # 0 if session has all the lt-4 work

# 2. Restore NuGet (ONLY needed on a fresh worktree — see header note).
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" \
  "ParticleEditor.sln" //t:Restore //v:m

# 3. Confirm builds and tests are still green.
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" \
  "ParticleEditor.sln" //p:Configuration=Debug //p:Platform=x64 //v:m 2>&1 | tail -10
cd web/apps/editor
pnpm install     # may re-inject the allowBuilds block — see L-005
pnpm build       # 0 errors expected
pnpm test        # 254/254 expected
pnpm test:native # 83/83 expected
```

If anything regressed (no known failing specs at session end), the most likely culprits in order:

- pnpm-workspace.yaml `allowBuilds:` block malformed (L-005 — edit yaml, set per-package to `true`).
- WebView2 runtime unavailable (Edge dependency on the host machine).
- node_modules out of sync — re-run `pnpm install`.

---

## File-level breadcrumbs (current surface)

| Need | Where to look |
|---|---|
| Top-level React shell | `web/apps/editor/src/App.tsx` |
| MenuBar | `web/apps/editor/src/components/MenuBar.tsx` |
| Toolbar (Particle Editor 2026 4-group layout) | `web/apps/editor/src/components/Toolbar.tsx` |
| ThemeToggle | `web/apps/editor/src/components/ThemeToggle.tsx` |
| StatusBar | `web/apps/editor/src/components/StatusBar.tsx` |
| EmitterTree | `web/apps/editor/src/screens/EmitterTree.tsx` |
| EmitterPropertyTabs (Basic/Appearance/Physics in `.form-row` grid) | `web/apps/editor/src/screens/EmitterPropertyTabs.tsx` |
| **CurveEditorPanel (focus-channel host)** | `web/apps/editor/src/components/CurveEditorPanel.tsx` |
| **CurveEditor (multi-channel SVG + focus-aware interactive scaffolding)** | `web/apps/editor/src/screens/CurveEditor.tsx` |
| BackgroundDropdown + body | `web/apps/editor/src/components/BackgroundDropdown.tsx` + `src/screens/BackgroundPicker.tsx` (BackgroundPickerBody) |
| GroundDropdown + body | `web/apps/editor/src/components/GroundDropdown.tsx` + `src/screens/GroundTexturePanel.tsx` (GroundTexturePanelBody) |
| OccludingPopover (viewport occlusion machinery) | `web/apps/editor/src/components/OccludingPopover.tsx` |
| Spawner permanent column | `web/apps/editor/src/screens/SpawnerPanel.tsx` + `src/lib/spawner-visibility.ts` (Zustand store) |
| ViewportPill (top-left 3-toggle pill) | `web/apps/editor/src/components/ViewportPill.tsx` |
| Save-changes prompt | `web/apps/editor/src/screens/SaveChangesPrompt.tsx` |
| Modal primitive (Phase 3.1 will re-skin) | `web/apps/editor/src/components/Modal.tsx` |
| Design tokens | `web/apps/editor/src/styles/tokens.css` |
| Design base CSS (font-face, scrollbars) | `web/apps/editor/src/styles/base.css` |
| Design component CSS (`.panel`, `.tb-btn`, `.form-row`, `.ce-toolbar`, etc.) | `web/apps/editor/src/styles/components.css` |
| Globals (Tailwind + FD4 transparency + body font/size) | `web/apps/editor/src/styles/globals.css` |
| Test setup (localStorage/matchMedia stubs, afterEach clear) | `web/apps/editor/src/test-setup.ts` |
| Bridge schema | `web/packages/bridge-schema/src/index.ts` |
| MockBridge | `web/apps/editor/src/bridge/mock.ts` + `mock-state.ts` |
| NativeBridge | `web/apps/editor/src/bridge/native.ts` |
| TestHostBridge | `web/apps/editor/src/bridge/test-host.ts` |
| AlphaCompositor (FD9b) | `src/host/AlphaCompositor.{h,cpp}` |
| C++ host window + Engine ownership + viewport popup | `src/host/HostWindow.cpp` |
| C++ bridge dispatcher (including engine/set/leave-particles + BuildEngineStateSnapshot) | `src/host/BridgeDispatcher.cpp` |
| C++ host-object proxy | `src/host/HostBridgeProxy.cpp` |
| C++ accelerator pre-translate | `src/host/AcceleratorBridge.cpp` |
| C++ layout broker | `src/host/LayoutBroker.cpp` |
| ParticleSystem (m_leaveParticles, setLeaveParticles, getLeaveParticles) | `src/ParticleSystem.{h,cpp}` |
| Engine — alpha compositor + KillParticleSystem leave-particles honor | `src/engine.cpp` lines ~197, ~625, ~870, ~1226 |
| Playwright test orchestration (spec allowlist) | `web/apps/editor/scripts/run-native-tests.mjs` |

---

## Recommended next moves

0. **FF + push the B1.2 dispatch.** Brainstorm + plan + 5 implementation commits + this docs commit ahead of `origin/lt-4`. Standard CLAUDE.md flow: fast-forward into `lt-4`, push to `origin/lt-4` with explicit user OK. Do this before anything else so the work doesn't get lost.
1. **Execute B1.3 — Resizable splitters via `react-resizable-panels`** (next dispatch). Make the left / centre / right column boundaries draggable so users can size the panes to taste. Persistence to `localStorage` like the theme toggle; defaults match current fixed widths. Specifics defined in a separate brainstorm + plan pair.
2. **Execute B2 — Appearance + Physics tab wiring** (secondary follow-up). The form rows are in place from Phase 2.5; B2 makes them drive engine state through the bridge. Specifics defined in a separate brainstorm + plan pair; spec source is the design bundle's `appearance.html` + `physics.html`.
3. **Execute Phase 3** (Tasks 3.1–3.6). Mostly mechanical (dialog re-skins + a sweep + a Playwright spec). Should fit in one session. **Remember to translate Phase 3 plan references to `tailwind.config.ts` to the v4 CSS-first equivalent before dispatching.** Can run in parallel with B1.3 / B2 if helpful.
4. **Phase 4.2 cutover** comes after Phase 3 ships and the user signs off on parity acceptance (`tasks/lt4_phase_4_1_acceptance.md` §17).
5. **ROADMAP follow-ups from B1 (NT-5, NT-6).** Engine-side single-member link-group enforcement (NT-5) and the visual-stability lane assignment option (NT-6). Both small. NT-6 only worth doing if the bouncing-gutter turns out to be a real ergonomic issue in daily use.
6. **Organic find-and-fix runs continue to be high-yield.** Visual issues discovered during the user's daily use of the build fold cleanly into small fix commits on `lt-4`. This session's B1.2 dispatch is a good example of the shape.
7. **(Watch-list)** If the `abort()` dialog the user observed pre-2026-05-20 resurfaces during a Playwright run, capture the assertion text immediately — it was *not* the same bug as `:192` (engine resource-leak fixed in `92ed1db`), so it's still unknown what fires it.

---

## Conversation context the new session needs

### What the user prefers

- **Iterative cycles with visual verification at each phase boundary.** This session shipped Phase 1 → user visually verified → push; then Phase 2 → user visually verified → restore decision → push. The "let's continue" handoff cadence works well.
- **Design fidelity matters but not at the cost of feature parity.** Task 2.6's "delete TrackEditor and replace with view-only overlay" was explicitly rejected; the user picked the hybrid focus-channel restore even though it was the most engineering work. Lossy structural moves get pushback.
- **Plan / spec re-writes when reality diverges from the plan.** The user explicitly picked "pause and re-plan Phase 1 fully" when the original plan referenced Tailwind v3. Plans are contracts, not just guidance.
- **CHANGELOG entries are detailed.** Three sections per entry (what ships / how we tackled it / issues encountered), per CLAUDE.md. The Phase 1 / 2 / 2.8 entries set the bar — long, conversational, name files + commits + sub-decisions.

### What the user did NOT delegate

- **Push to `origin/lt-4`** — needs explicit OK each time. This docs commit + the FF have been authorized via "let's handover for a new session".
- **Phase advances** — each phase boundary is a check-in moment.
- **Major lossiness decisions** (Task 2.6's TrackEditor deletion). The user catches these and forces alternatives.

### Technical surface the user cares about

- **The `--legacy-ui` path stays clean.** Zero regression. Verified each cycle.
- **Test counts go up where coverage is meaningful.** Phase 1: 191 → 195. Phase 2: 195 → 200. Phase 2.8: 200 → 219. Don't drop counts without explicit reason.
- **The known failing native spec is documented in HANDOFF + CHANGELOG and tracked, not hidden.**
- **No silent failures.** Items not yet implemented log a TODO marker, not a silent no-op.
