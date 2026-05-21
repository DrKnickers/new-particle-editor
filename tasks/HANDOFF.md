# Session Handoff — AloParticleEditor / LT-4 (B1.3 tab parity reorg + bundled correctness fix + two polish rounds)

**Last updated:** 2026-05-21 (end-of-session — B1.3 tab parity reorg shipped: three property tabs restructured to legacy `IDD_EMITTER_PROPS1/2/3` shape; tri-state Generation radio mutex; `displayInvertedPercent` correctness fix; trailing-colon label convention; per-axis X/Y/Z micro-labels across every Vec3 cluster; SpawnerPanel scroll fix. Two two-stage-review fix commits + two post-smoke-test polish rounds folded in.)
**Last conversation context:** Long session executing the B1.3 plan via `superpowers:subagent-driven-development`. Brainstorm + spec landed at session start (`5dd9d75`); plan at `9d1ac1f`. P2 → P8 executed bottom-up: P2 `displayInvertedPercent` standalone first; P3 tri-state mutex on the unchanged tab structure; P4–P6 restructured Basic / Appearance / Physics each in turn against the legacy `.rc` source-of-truth; P7 reconciled the spec corpus + caught two label-coupled Playwright specs (now lessons.md L-010); P8 (this) lands the docs. Two review-driven fix commits caught real issues — P3 follow-up `b929e47` extracted a `RadioRow` component with `role="radiogroup"` + roving tabIndex + arrow-key cycling once code review flagged the a11y gap; P6 follow-up `3b191fd` corrected the weather-disable cascade after the reviewer cross-referenced legacy `src/UI/Emitter.cpp:175-190` line-by-line and found three inverted disables. Two polish rounds followed the user's smoke test: `3ae940e` (dark scrollbar inside Tabs.Content, tightened form-row template) and `82917f0` (Vec3 X/Y/Z axis labels across all clusters, texture input widening, SpawnerPanel scroll fix). Five questions about field disposition / label convention were resolved by source-reading the legacy `.rc` + `Emitter.cpp` before brainstorm — that pre-work shrank the brainstorm phase to a single confirmation pass. Ten implementation commits + two docs commits (spec, plan) total before this P8 docs commit.

**Test counts:** vitest **277 / 277** (was 254 at B1.2 close; +23 net across the dispatch), Playwright **83 / 83**, MSBuild Debug x64 clean (no C++ change this dispatch — still clean since the prior session's verified state, since no C++ files were touched).

**Next dispatch:** **B1.3.1** — inspector layout follow-ups (tabs always visible with placeholder when no emitter selected; tab strip height bumped to ~50% of left column; emitter list flex-grows to fill above the tabs). Three issues from B1.3's smoke test, deferred when the user chose to bundle CSS-only fixes inline and queue these for a separate brainstorm + plan. **B1.4** (resizable splitters via `react-resizable-panels`) queued behind B1.3.1. **B2** (Appearance + Physics wiring) is likely largely obsolete now — the B1.3 restructure wired every field on those tabs through the existing `commit()` helper; worth a check in the next session before re-scoping.

---

## Read first

If you are a fresh Claude session resuming this project:

1. **This file** — top to bottom.
2. **[CLAUDE.md](../CLAUDE.md)** — project conventions, plan structure, handoff discipline. The `## Branch workflow` section is load-bearing: `lt-4` is the integration branch; new sessions land on `claude/<random>` and FF into `lt-4` at session end.
3. **[CHANGELOG.md](../CHANGELOG.md)** — the top entry (B1.3 tab parity reorg) covers what just shipped; the B1.2 entry below covers the left-pane polish; the B1 entry covers the structural realignment B1.2 / B1.3 sit on; entries further down (curve editor polish, Phase 2.8 focus-channel restore, Phase 2.1–2.7 structural moves, Phase 1 tokens + theme) cover the architectural foundation.
4. **If picking up B1.3.1 / B1.4 / Phase 3** (most likely next step):
   - **[docs/superpowers/specs/2026-05-20-b1-3-tab-parity.md](../docs/superpowers/specs/2026-05-20-b1-3-tab-parity.md)** — B1.3 spec (reference for B1.3.1's place in the sequence).
   - **[docs/superpowers/specs/2026-05-19-particle-editor-2026-redesign.md](../docs/superpowers/specs/2026-05-19-particle-editor-2026-redesign.md)** — original full design spec.
   - **[docs/superpowers/plans/2026-05-19-particle-editor-2026-redesign.md](../docs/superpowers/plans/2026-05-19-particle-editor-2026-redesign.md)** — step-by-step plan. **Phase 3 still references `tailwind.config.ts` in a few places — those need the same Tailwind v4 / `globals.css` translation Phase 1 got** (see the re-plan note at the top of Phase 1 for the pattern).
5. **[tasks/lessons.md](lessons.md)** — L-001 through L-010. **L-006 (don't clear React optimistic state on every host-data refresh) is load-bearing in `CurveEditorPanel.tsx` — the spinners' optimistic override comes from that pattern.** **L-010 (sweep BOTH vitest and Playwright on every label rename) was filed this session — apply to any future inspector field rename.**
6. **[tasks/lt4_phase_4_1_acceptance.md](lt4_phase_4_1_acceptance.md)** — parity acceptance checklist. §16 lists intentional divergences from legacy. The 2026 redesign's structural moves don't update this doc; treat it as parity baseline for the legacy `--legacy-ui` path only.
7. Recent `git log --oneline -20` — Phase 1 + 2 of the redesign at the tip, prior LT-4 dispatch history below.

---

## Resumable state (snapshot)

| Thing | Value |
|---|---|
| **Worktree** | `C:\Modding\Particle Editor\.claude\worktrees\brave-buck-1295c8` (this session's; next session gets a fresh `claude/<random>` path) |
| **Branch** | `claude/brave-buck-1295c8` → integrates back into `lt-4` per the standard end-of-session FF. Tracks `origin/lt-4`. |
| **HEAD (committed)** | This P8 docs commit at the top of the session branch. Top non-docs commit is `82917f0` (`fix(LT-4): inspector + Spawner polish round 2 — Vec3 axis labels, cluster widening, Spawner scroll`). |
| **Working tree** | clean (after this P8 docs commit). |
| **Ahead of origin/lt-4** | 13 commits — the full B1.3 stack: spec + plan + 10 implementation commits + this P8 docs commit. All 13 to be FF'd into `lt-4` and pushed at the user's explicit OK. |
| **Behind master** | `lt-4` is ~365+ commits ahead of `master` (`b28f624`); none merged yet, all backed up to `origin/lt-4`. |
| **Open PRs** | none |
| **Build status** | MSBuild Debug x64 clean (preexisting LIBCMTD warning; no C++ change this dispatch — last C++-touching commit was the prior session). Vitest **277 / 277**. Playwright **83 / 83**. |
| **Phase status** | Particle Editor 2026 redesign — **Phase 1 + Phase 2 + curve editor polish + B1 left-pane realignment + B1.2 left-pane polish + B1.2.1 label-truncation polish + B1.3 tab parity reorg shipped. Phase 3 not started.** Next dispatch is **B1.3.1 (inspector layout follow-ups — tabs always visible + tab strip height + emitter list flex-grow)**. After that: **B1.4 (resizable splitters via `react-resizable-panels`)**. **B2 (Appearance + Physics wiring)** is likely largely obsolete after B1.3 wired both tabs through the restructure — worth verifying before re-scoping. Legacy `--legacy-ui` mode is untouched throughout. |

**Worktree note.** The Claude Code desktop app provisions a fresh worktree on every session start; this session is in `sweet-vaughan-dc78c1`, succeeding `charming-williams-0efd47`. Branch name follows the worktree name. The commit lineage is preserved — only the path / branch label change.

**NuGet pre-flight (fresh worktrees only).** `.gitignore` excludes `packages/`, so the first MSBuild in a fresh worktree fails with *"missing Microsoft.Web.WebView2.targets"*. Restore explicitly before the first build:

```bash
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" \
  "ParticleEditor.sln" //t:Restore //v:m
```

Then the standard Debug x64 build works. Skip this step on a worktree that's already been built in once.

---

## What landed this session — B1.3 tab parity reorg (12 commits + this P8 docs commit)

In execution order (oldest → newest):

| Commit | What |
|---|---|
| `5dd9d75` | **docs(LT-4): brainstorm spec — tab parity reorg (B1.3)** — full spec at [`docs/superpowers/specs/2026-05-20-b1-3-tab-parity.md`](../docs/superpowers/specs/2026-05-20-b1-3-tab-parity.md). Five owner questions resolved before brainstorm — Q1 (`index`: drop), Q2 (`nTriangles`: drop, retain in schema), Q3 (`weatherFadeoutDistance`: drop, retain), Q4 (`groups[1]` Lifetime random-param: drop, retain), Q5 (trailing colons: yes, fields only) — by source-reading `src/UI/Emitter.cpp` + `src/ParticleEditor.en.rc` directly. |
| `9d1ac1f` | **docs(LT-4): implementation plan — tab parity reorg (B1.3)** — 8-task plan (P1 pre-flight → P8 docs). Goal + scope, codebase-survey, architecture, risks, testing checklist per CLAUDE.md plan structure. Plan deliberately bottom-up: P2 standalone prop → P3 tri-state on unchanged tabs → P4–P6 restructure each tab → P7 spec corpus reconciliation → P8 docs. |
| `109125a` | **feat(LT-4): displayInvertedPercent prop on FieldSpinner** (P2) — new prop on `FieldSpinner` handles the legacy `100 - perc * 100` display math; commit transform `value = (100 - displayed) / 100`. Standalone with focused unit specs before either consumer adopts. Bundled correctness fix — the new UI was previously interpreting `randomLifetimePerc=0.25` as `0.25%` instead of legacy's `75%` minimum. |
| `6a5df27` | **feat(LT-4): tri-state Generation radio mutex on BasicTab** (P3) — three radios (Bursts / Continuous stream / Weather particle) deriving from `(useBursts, isWeatherParticle)` with atomic two-key bridge patches. Landed on the *unchanged* Basic-tab structure so the radio chrome's diff is isolated from the larger tab-restructure diffs. |
| `b929e47` | **refactor(LT-4): tri-state Generation radios — a11y + DRY follow-up** (P3-fix) — code review caught the initial radios missing every a11y requirement. Extracted a hand-rolled `RadioRow` component owning a `role="radiogroup"` wrapper, roving `tabIndex` (focused = 0, others = -1), and arrow-key cycling via `onKeyDown`. |
| `07c88c4` | **feat(LT-4): Basic tab restructure to match legacy IDD_EMITTER_PROPS1** (P4) — three Sections (Emitter Timing / Generation / Connection) matching legacy GROUPBOX structure section-for-section. Generation includes the Weather sub-block + Maximum/Minimum lifetime; Connection adds Emit mode + Emit offset (moved from Physics). Rotation cluster (4 fields), parent link strength, random scale, and Index dropped from Basic. Trailing-colon label convention applied. |
| `c894a2b` | **feat(LT-4): Appearance tab restructure to match legacy IDD_EMITTER_PROPS2** (P5) — five Sections (Textures / Random color addition / Tail / Rotation / Rendering). Rotation fields land here (from Basic); random scale lands inside Textures (with `displayInvertedPercent`); `nTriangles` + Affected by Wind drop. "World Oriented" renamed "Always face camera" with semantic flip applied (`checked = !isWorldOriented`); BLEND_BUMP cascade preserved. `GroupSection` → `GroupBody` rename — wraps inside the parent `Section` primitive; fieldset/legend chrome dropped. |
| `8b41ea5` | **feat(LT-4): Physics tab restructure to match legacy IDD_EMITTER_PROPS3** (P6) — four Sections (Initial position / Initial speed / Acceleration / Ground interaction). Initial speed consolidates Inward speed + Parent speed inherit (moved from Basic) + Affected by wind (moved from Appearance). Weather + Emit fields move out. `groups[1]` Lifetime random-param drops entirely. |
| `3b191fd` | **fix(LT-4): Physics tab weather-disable cascade matches legacy** (P6-fix) — code review caught the initial P6 commit disabling Parent speed inherit / Inward speed / Affected by wind all three under `isWeatherParticle === true`. Legacy `src/UI/Emitter.cpp:175-190` actually disables only Parent speed inherit under weather; Inward speed and Affected by wind stay enabled. Fixed once the reviewer cross-referenced the disable cascade line-by-line against the legacy source. |
| `49544d6` | **test(LT-4): spec corpus reconciliation for B1.3 tab parity** (P7) — final spec sweep. 1 spec converted from a `.todo` marker to a real absence-assertion on `Triangles`. 2 specs in [`tests/property-tabs.spec.ts`](../web/apps/editor/tests/property-tabs.spec.ts) updated for "Lifetime" → "Maximum lifetime:" and "Gravity" → "Gravity acceleration:" label renames. The B1.3 spec's §5 + §8 had stated "Playwright native tests untouched" — reality was two specs needed updates. Captured as **lessons.md L-010** (Inspector field labels are public API; sweep BOTH vitest and Playwright on every rename). |
| `3ae940e` | **fix(LT-4): inspector polish — dark scrollbar + form-row truncation** (P7.5) — user smoke-test round 1. Extended dark-mode scrollbar treatment to the inspector's Tabs.Content; form-row template tweaks (spinner cell 56→52→58, unit cell 32→40, label hover-tooltips via `title=`). |
| `82917f0` | **fix(LT-4): inspector + Spawner polish round 2 — Vec3 axis labels, cluster widening, Spawner scroll** (P7.6) — user smoke-test round 2. New `.form-row.form-row-cluster` modifier (60px label + 1fr cluster) for Vec3 multi-spinner rows; new `.axis-cell` + `.axis-lbl` for per-axis X/Y/Z micro-labels above every Vec3 cluster (PhysicsTab Vec3Row + Acceleration, AppearanceTab RGBA, all four SpawnerPanel Vec3 sections); texture inputs widened (92→180px) and font tightened (12→11px); SpawnerPanel `.panel h-full` fix so its body scrolls when content overflows. |

Plus this P8 docs commit (CHANGELOG + HANDOFF + ROADMAP + lessons.md L-010 + todo.md Review).

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

### 0. B1.3.1 — Inspector layout follow-ups (NEXT DISPATCH — start in new session)

Three smoke-test findings from B1.3 that the user explicitly deferred to a separate brainstorm + plan (rather than bundling into B1.3's polish rounds, which stayed CSS-only by intent):

1. **Tabs hidden until an emitter is selected.** Today the property tabs only render when an emitter is selected; with no selection the centre column is empty. Should always render with a placeholder inside ("Select an emitter to edit its properties" or similar) so the user sees the tab strip and can navigate before any selection.
2. **Tab strip too short.** Currently a small slice at the top of the centre column. Should be roughly 50% of the left column's vertical extent so the tab strip dominates the visual hierarchy and the inspector body has more breathing room.
3. **Emitter list doesn't adjust to content.** The tree's `<ul>` container has a fixed-ish height; should `flex-grow` to fill the space above the tabs so long emitter lists scroll within a generous viewport rather than spilling tight.

Standard CLAUDE.md plan structure expected. No bridge schema changes anticipated. No C++ work. Estimated ~3–5 commits.

### 0b. MT-1 follow-up — Texture picker "..." buttons still unimplemented

Legacy `IDC_BUTTON1` / `IDC_BUTTON2` at [`src/ParticleEditor.en.rc:387-389`](../src/ParticleEditor.en.rc) (the "..." browse buttons next to the Color and Bump texture filename inputs) are not wired in the new UI. The MT-1 frequently-used textures palette covers the common case (pick from recents / pinned), but the "..." browse path — `GetOpenFileName` filtered to `*.dds;*.tga;*.png;*.jpg` — needs the same React equivalent to land. Worth filing as a separate dispatch once B1.3.1 / B1.4 ship. Comment marker `TODO(MT-1)` exists in `EmitterPropertyTabs.tsx` for grep-ability.

### 0c. B1.4 — Resizable splitters via `react-resizable-panels` (queued behind B1.3.1)

Previously labeled B1.3 (the splitter dispatch, pre-rename); now B1.4 and queued behind B1.3.1. B1 finished the structural realignment, B1.2 tightened the interior fidelity, B1.3 aligned tab structure with legacy, B1.3.1 will fix the layout follow-ups; B1.4 then makes the left / centre / right column boundaries draggable so users can size panes to taste. Target library is `react-resizable-panels` (battle-tested, accessible drag handles, persistence hooks). Standard CLAUDE.md plan structure expected. Persistence target is `localStorage` like the theme toggle; default sizes match the current fixed widths.

### 0d. B2 — Appearance + Physics tab wiring (likely largely obsolete after B1.3)

B1.3 wired every field on the Appearance and Physics tabs through the existing `commit()` helper as part of the restructure — they now drive engine state through the bridge identically to BasicTab. Before re-scoping or executing B2 as originally planned, the next session should diff the current Appearance + Physics implementations against B2's original target spec and verify what (if anything) remains undone. A quick "audit B2 scope" sub-task probably resolves the entire item.

### 1. ~~B1.3 tab parity reorg~~ ✅ SHIPPED this session (FF + push pending user OK)

P1 (pre-flight) → P8 (this docs commit), 10 implementation commits + 2 docs commits (spec, plan). Two two-stage-review fix commits caught real issues — P3 follow-up `b929e47` (a11y RadioRow extraction) and P6 follow-up `3b191fd` (weather-disable cascade parity). Two polish rounds folded user smoke-test findings (`3ae940e` dark scrollbar + form-row truncation; `82917f0` Vec3 axis labels + cluster widening + Spawner scroll). See top-of-CHANGELOG entry for the full breakdown; high-level summary:

- **Three property tabs match legacy `IDD_EMITTER_PROPS1/2/3` section structure** (Basic: Emitter Timing / Generation / Connection; Appearance: Textures / Random color / Tail / Rotation / Rendering; Physics: Initial position / Initial speed / Acceleration / Ground interaction).
- **Twelve field placements migrated to legacy homes** — rotation cluster, parent link strength, random scale, affected-by-wind, emit mode/offset, weather particle + cube size + fadeout distance.
- **Tri-state Generation radio mutex** with atomic two-key bridge patches; hand-rolled `RadioRow` component with `role="radiogroup"` + roving tabIndex + arrow-key cycling.
- **`displayInvertedPercent` prop** on `FieldSpinner` — bundled correctness fix for "Minimum lifetime:" and "Minimum scale:" (the new UI was displaying `0.25` as `0.25%` instead of legacy's `75%` minimum).
- **"Always face camera"** label replaces "World Oriented" with semantic flip; BLEND_BUMP cascade preserved.
- **Trailing-colon label convention** applied to every field; section titles stay colon-less.
- **`GroupSection` renamed `GroupBody`** — wraps inside parent `Section`; fieldset/legend chrome dropped.
- **Per-axis X/Y/Z micro-labels** above every Vec3 cluster (inspector + Spawner).
- **Four fields dropped from UI** (`nTriangles`, `weatherFadeoutDistance`, `groups[1]`, `index`) — all four stay on the wire for round-trip safety.

**Status:** 13 commits ready to FF into `lt-4` at user's explicit OK.

### 1b. ~~B1 left-pane realignment~~ ✅ SHIPPED (FF'd to `origin/lt-4` two sessions ago)

P1–P8 implementation + brainstorm + plan + the B1 P9 docs commit. Full breakdown in CHANGELOG entry from earlier this month.

Two ROADMAP follow-ups filed for B1 work that's worth doing later but deliberately out-of-scope:

- **[NT-5] Engine-side single-member link-group enforcement.** B1 ships a render-layer filter; the data layer can still carry single-member groups. NT-5 makes the data layer match the rendered view end-to-end across the three C++ mutation paths.
- **[NT-6] Visual-stability lane assignment for bracket gutter (option).** B1 uses aggressive-reuse greedy first-fit; a setting that opts the user into `lane = (groupId - 1) % maxLanes` would keep lanes stable across renders. Only worth doing if the bouncing turns out to be a real ergonomic issue.

### 1c. ~~B1.2 left-pane polish + B1.2.1 label-truncation polish~~ ✅ SHIPPED (FF'd to `origin/lt-4` prior session)

Full breakdown in the corresponding CHANGELOG entry. Predecessor on `lt-4` is `4edcc3a` (`docs(LT-4): handoff for new session — B1.3 reorg proposal + B1.2.1 polish in HANDOFF`).

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

### 1d. ~~B1.2 left-pane polish~~ ✅ SHIPPED earlier this session (FF'd to `origin/lt-4` at `e99e7b5`)

P2 Section + P3 BasicTab restructure + P3-fix `.name-row` refactor + P4 Duplicate + P5 Show/Hide icon swap + P6 CHANGELOG/HANDOFF + partial-backfill commit. Full breakdown in the "What landed this session" table above and the second CHANGELOG entry from the top.

### 1e. ~~B1.2.1 inspector label-truncation polish~~ ✅ SHIPPED this session (uncommitted FF + handoff docs — needs push)

Single follow-up fix commit `3a7a159` ("inspector label-truncation polish") catching three layered causes of label truncation that user-testing surfaced after B1.2 landed: double padding on Basic-tab Tabs.Content + design-source form-row template tuned for shorter labels + section bodies missing the indent needed to align with section title text. No new tests, no test count delta. User accepted the fix mid-session.

This handoff-refresh docs commit + the `tasks/b1.3_legacy_parity_reorg_proposal.md` commit are the docs for this round; all three (polish fix + proposal doc + this HANDOFF) push together to `origin/lt-4` at session close.

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
- **L-008** — React 18 attaches `wheel` listeners as passive at the root; use a native `addEventListener` with `{ passive: false }` when you need `preventDefault()` to actually work. Otherwise the wheel scroll leaks to the parent pane.
- **L-009** — Never use raw floats as identity keys across the JS/C++ boundary; pre-round at the source with `Math.fround`. The JS `double` ↔ C++ `float` round-trip silently drifts ~1 ULP-of-float32 and breaks any `===` or `Set/Map` keyed lookup.
- **L-010** — Inspector field labels are public API; sweep BOTH vitest and Playwright on every rename. Vitest specs under `src/**/__tests__/` and Playwright specs under `tests/` run via different harnesses, but both can hard-code field labels as DOM selectors. Filed this session after B1.3's P7 caught two label-coupled Playwright specs the spec hadn't anticipated.

### Patterns from this session worth remembering

#### `displayInvertedPercent` prop for legacy inverted-percent fields

The legacy editor's `randomLifetimePerc` and `randomScalePerc` display the *minimum* percentage rather than the random-fraction directly: `displayedPercent = 100 - value * 100`. When wiring legacy fields whose label reads "Minimum X:" but whose schema field stores a 0..1 random-fraction, the inversion is part of the contract — not a UI quirk. The pattern lives on `FieldSpinner` as `displayInvertedPercent?: boolean`; consumers just pass the prop and the spinner handles both render-side (`displayed = 100 - value * 100`) and commit-side (`value = (100 - displayed) / 100`) transforms. Audit before adding any new "Minimum ..." label against the legacy `.rc` to see if the same inversion applies.

#### `.axis-cell` / `.axis-lbl` micro-labels above Vec3 clusters

Three side-by-side spinners (X / Y / Z, R / G / B / A, etc.) become much more legible with tiny dimmed letters directly above each spinner cell. The pattern is `.form-row.form-row-cluster` (60px label + 1fr cluster) wrapping a row of `.axis-cell` containers, each with a `.axis-lbl` text node above its spinner. Pixel-tight and zero-impact on test selectors (labels stay aria-attached to the spinner inputs). Applied across PhysicsTab Vec3Row + Acceleration, AppearanceTab RGBA, and all four SpawnerPanel Vec3 sections in `82917f0`.

#### Source-resolve open questions before brainstorm

B1.3's five open questions could have entered brainstorm as "needs decision"; instead they were resolved by reading `src/UI/Emitter.cpp:480-560` (the WM_COMMAND handler that maps each IDC_SPINNER to a schema field) and `src/ParticleEditor.en.rc` (the dialog templates) directly. Brainstorm then ran in a single confirmation pass rather than a multi-round Q-and-A. Pattern: when the work touches a legacy surface that's already in the repo, the questions worth asking the user are the *taste* questions ("trailing colons?"), not the *fact* questions ("what schema field does IDC_SPINNER2 bind to?"). Source-read first.

#### Two-stage review on every implementation phase

P3 and P6 each shipped twice: first the implementation pass, then a code-review pass that caught a real issue (P3: missing a11y; P6: inverted weather-disable cascade). The two-stage cadence isn't formality — it's the difference between "looks right" and "matches the legacy contract line-by-line". Bake into every multi-tab dispatch.

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
git log --oneline -5    # HEAD should be this P8 docs commit on the FF'd `lt-4`
git status              # clean
git log --oneline lt-4..HEAD   # 0 if session branched cleanly from lt-4
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
pnpm test        # 277/277 expected
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

0. **Execute B1.3.1 — Inspector layout follow-ups** (NEXT DISPATCH). Three smoke-test findings deferred from B1.3: tabs always visible with placeholder when no emitter selected; tab strip height bumped to ~50% of left column; emitter list flex-grows to fill above the tabs. Standard CLAUDE.md plan structure expected. ~3–5 commits.
1. **Execute B1.4 — Resizable splitters via `react-resizable-panels`** (queued behind B1.3.1). Make the left / centre / right column boundaries draggable so users can size the panes to taste. Persistence to `localStorage` like the theme toggle; defaults match current fixed widths.
2. **Audit B2 — Appearance + Physics tab wiring.** B1.3 wired both tabs through the restructure; B2 may be largely obsolete. A quick diff of the current Appearance + Physics implementations against B2's original target spec should resolve the entire item before re-scoping.
3. **MT-1 follow-up — Texture picker "..." buttons.** Legacy `IDC_BUTTON1` / `IDC_BUTTON2` at `src/ParticleEditor.en.rc:387-389` still unimplemented in the new UI. `TODO(MT-1)` comment marker in `EmitterPropertyTabs.tsx`. Worth filing as a separate dispatch once B1.3.1 / B1.4 ship.
4. **Execute Phase 3** (Tasks 3.1–3.6). Mostly mechanical (dialog re-skins + a sweep + a Playwright spec). Should fit in one session. **Remember to translate Phase 3 plan references to `tailwind.config.ts` to the v4 CSS-first equivalent before dispatching.** Can run in parallel with B1.3.1 / B1.4 if helpful.
5. **Phase 4.2 cutover** comes after Phase 3 ships and the user signs off on parity acceptance (`tasks/lt4_phase_4_1_acceptance.md` §17).
6. **ROADMAP follow-ups from B1 (NT-5, NT-6).** Engine-side single-member link-group enforcement (NT-5) and the visual-stability lane assignment option (NT-6). Both small. NT-6 only worth doing if the bouncing-gutter turns out to be a real ergonomic issue in daily use.
7. **Organic find-and-fix runs continue to be high-yield.** Visual issues discovered during the user's daily use of the build fold cleanly into small fix commits on `lt-4`. This session's two polish rounds (`3ae940e` + `82917f0`) are the latest example of the shape.
8. **(Watch-list)** If the `abort()` dialog the user observed pre-2026-05-20 resurfaces during a Playwright run, capture the assertion text immediately — it was *not* the same bug as `:192` (engine resource-leak fixed in `92ed1db`), so it's still unknown what fires it.

---

## Conversation context the new session needs

### What the user prefers

- **Iterative cycles with visual verification at each phase boundary.** This session shipped P1 → P8 with a smoke-test pass after P7 surfacing five issues the user then folded into two polish commits. The "let's continue" handoff cadence works well.
- **Source-resolve fact questions before brainstorm.** B1.3's five open questions were resolved by source-reading the legacy `.rc` + `Emitter.cpp` directly rather than entering brainstorm with "needs decision" markers. The user appreciated that brainstorm ran in a single confirmation pass rather than a Q-and-A.
- **Two-stage review on multi-tab dispatches catches real issues.** P3 (a11y) and P6 (weather-disable cascade) each needed a fix commit after the implementer's first pass — both caught only because the dispatch protocol called for code review after each phase. Bake into multi-step plans.
- **Bundled correctness fixes are welcome when discovered during prep.** The `displayInvertedPercent` math was a pre-existing bug surfaced while reading legacy source for Q2; bundling it into B1.3 (rather than filing a separate dispatch) was the right call.
- **CHANGELOG entries are detailed.** Three sections per entry (what ships / how we tackled it / issues encountered), per CLAUDE.md. The B1, B1.2, B1.3 entries set the bar — long, conversational, name files + commits + sub-decisions.

### What the user did NOT delegate

- **Push to `origin/lt-4`** — needs explicit OK each time. This docs commit + the FF have been authorized via "let's handover for a new session".
- **Phase advances** — each phase boundary is a check-in moment.
- **Major lossiness decisions** (Task 2.6's TrackEditor deletion). The user catches these and forces alternatives.

### Technical surface the user cares about

- **The `--legacy-ui` path stays clean.** Zero regression. Verified each cycle.
- **Test counts go up where coverage is meaningful.** Phase 1: 191 → 195. Phase 2: 195 → 200. Phase 2.8: 200 → 219. Don't drop counts without explicit reason.
- **The known failing native spec is documented in HANDOFF + CHANGELOG and tracked, not hidden.**
- **No silent failures.** Items not yet implemented log a TODO marker, not a silent no-op.
