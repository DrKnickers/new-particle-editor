# [LT-4 UI polish] Consolidate viewport pill into the toolbar + lucide icon refresh

**Context:** Post-parity-B UI cleanup. The viewport-pill (floating top-left
overlay with Show-ground / Bloom / Leave-particles toggles) is being
removed and its toggles moved into the toolbar; the Spawner toggle becomes
an icon button; and the three toggle icons + Spawner icon are refreshed to
lucide. Because the toolbar is captured in ~every a11y golden, this also
requires fixing the a11y harness's shared-profile state pollution (L-030)
so the goldens can be regenerated deterministically.

**Target branch:** `lt-4`  **Difficulty:** ★★–★★★ (the React/CSS move is
small; the L-030 harness fix + clean golden regen across both lanes is the
bulk and the risk).
**Effort:** ~half day. UI move + icons (~1.5h), L-030 harness fix (~1.5h),
golden regen both lanes + verify deterministic (~1h), tests + docs (~1h).

---

## 1. Goal + scope

**When this ships:** The floating viewport pill is gone; its three engine
toggles (**Show ground**, **Toggle bloom**, **Leave particles after instance
death**) live in the toolbar as icon buttons. The **Spawner** toggle is an
icon button instead of text. All four use lucide icons that follow the
dark/light theme:

| Action | Icon (lucide) | Bridge |
|---|---|---|
| Show ground | `Grid2x2` | `engine/set/ground` |
| Toggle bloom | `Sun` | `engine/set/bloom` |
| Leave particles | `Sparkles` | `engine/set/leave-particles` |
| Toggle Spawner panel | `CirclePlus` | `useSpawnerVisibility().toggle` |

**In scope:**
- Delete `ViewportPill.tsx` + its `.vp-tools` CSS + the `viewport-pill`
  occlusion call; remove its render in `PanelLayout`.
- Add the three toggles to `Toolbar.tsx` (it already subscribes to the
  engine snapshot, so they read `state.ground/bloom/leaveParticles` and
  dispatch the existing setters). Keep `aria-pressed` + the exact
  `aria-label`s the pill used (so behaviour/a11y semantics are preserved).
- Swap the Spawner button's text for `CirclePlus`; keep
  `aria-label="Toggle Spawner panel"` + `aria-pressed`.
- Delete the now-unused `public/icons/icon-{ground,bloom,particles}.svg`.
- **L-030 fix:** force a known UI state (light theme + Spawner visible)
  in the a11y capture setup so goldens are deterministic regardless of the
  shared WebView2 profile's persisted state.
- Regenerate a11y goldens (both lanes); remove the dedicated `viewport-pill`
  a11y surface (driver + 2 goldens + spec references).
- Update vitest (`Toolbar` toggles; delete `ViewportPill.test.tsx`) and the
  Playwright `toolbar.spec.ts` (drop pill references, cover the new toggles).

**Out of scope (deliberate):**
- The accent-glow-on-hover nod to the original spawner art — not requested;
  skip unless asked.
- Re-theming any OTHER hardcoded-colour assets — only the three pill icons
  are in play here.
- The broader a11y deferred-surfaces backlog (HANDOFF follow-up #1) — the
  L-030 fix here is just state-forcing, not new surface coverage.
- Base-game palette / `.meg` browser (separate items).

**Toolbar grouping (design decision, confirm in review):** place the three
viewport toggles as a new group between playback (Group 2) and the Spawner
button, then spacer, then the Ground/Background dropdowns + ThemeToggle.
Rationale: ground/bloom/leave are *viewport state* toggles, grouped together
and distinct from the right-aligned environment *pickers*.

---

## 2. What the codebase already gives us

- **`ViewportPill`** ([web/apps/editor/src/components/ViewportPill.tsx](web/apps/editor/src/components/ViewportPill.tsx))
  — the three toggles, each `engine/set/*` + `aria-pressed`, synced via
  `engine/state/changed`. Source of the exact labels/behaviour to port.
- **`Toolbar`** ([web/apps/editor/src/components/Toolbar.tsx](web/apps/editor/src/components/Toolbar.tsx))
  — already subscribes to the snapshot (`state`) + `engine/state/changed`;
  the toggles drop in reading `state.ground/bloom/leaveParticles`. The
  Spawner button is at lines 130-141 (`useSpawnerVisibility`).
- **lucide-react** is a dependency; `Grid2x2`, `Sun`, `Sparkles`,
  `CirclePlus` are standard exports. Toolbar icons already use the
  `const ICON = { className: "size-3.5" }` convention.
- **`PanelLayout`** renders `<ViewportPill>` inside the viewport quadrant
  ([PanelLayout.tsx](web/apps/editor/src/components/PanelLayout.tsx)) — one
  render site + the import to remove.
- **a11y harness:** the `viewport-pill` surface driver is at
  [tests/helpers/a11y-surfaces.ts:126](web/apps/editor/tests/helpers/a11y-surfaces.ts:126);
  goldens at `tests/a11y-goldens/viewport-pill.{golden.json,composition.golden.yaml}`.
  The harness is `run-native-tests.mjs` (`--update` regenerates;
  `--legacy` + `--rebuild` for the HWND/legacy dist).
- **The L-030 root cause (already diagnosed):** theme falls back to OS
  `prefers-color-scheme` when `alo:theme` is unset
  ([ThemeToggle.tsx:13-16](web/apps/editor/src/components/ThemeToggle.tsx:13)),
  spawner visibility persists to `alo:spawner-visible`
  ([spawner-visibility.ts:12](web/apps/editor/src/lib/spawner-visibility.ts:12)),
  and the host uses a STABLE WebView2 profile shared with interactive runs
  ([HostWindow.cpp:205](src/host/HostWindow.cpp:205)). So a capture inherits
  whatever the last live session left. Goldens were captured at
  **light theme + Spawner visible** — that's the canonical state to force.

---

## 3. Architecture / implementation approach

### 3a. React — move toggles + icons
- **Toolbar.tsx:** add a `tb-group` with three `tb-btn`s (Grid2x2/Sun/
  Sparkles), each `aria-label` = the pill's label, `aria-pressed` bound to
  `state?.X`, `onClick` dispatching the matching `engine/set/*`. Swap the
  Spawner button's `Spawner` text child for `<CirclePlus {...ICON} />`
  (label/pressed unchanged). Update the file's header comment (it currently
  says "Bloom toggle moves to the viewport pill" — now the reverse).
- **PanelLayout.tsx:** remove `<ViewportPill bridge={bridge} />` + its import.
- **Delete:** `ViewportPill.tsx`, `.vp-tools` block in `components.css`,
  `public/icons/icon-{ground,bloom,particles}.svg`.

### 3b. a11y harness determinism (L-030)
Force the canonical UI state before each surface capture so the shared
profile can't pollute it. Approach (verify the cleanest of these in T-impl):
- In the composition lane (Playwright `page.evaluate` over CDP): in the
  a11y spec's setup, set `localStorage.setItem("alo:theme","light")` +
  `localStorage.setItem("alo:spawner-visible","true")` then reload, before
  the surface loop. The capture then always reflects light + Spawner-open.
- The HWND/UIA lane drives the same host; the localStorage write applies
  process-wide, so a single seed before the inspector runs covers it.
- Document the forced state in `a11y-surfaces.ts` (or the harness) so future
  readers know the goldens are pinned to light + Spawner-visible.

Cross-ref **L-030**: this is the "force a known state at capture" fix that
makes blanket regen safe.

### 3c. a11y goldens
- Remove the `viewport-pill` surface from `a11y-surfaces.ts` + delete its two
  golden files + any spec reference.
- After 3a + 3b, regenerate **both lanes**: composition (`pnpm a11y:update`,
  dist already composition) and HWND/legacy
  (`node scripts/run-native-tests.mjs --legacy --update --rebuild`, which
  flips dist to legacy). **Then rebuild dist back to composition**
  (`pnpm build`) so the shipped state is correct.
- `git diff --stat` the goldens — the ONLY expected changes are the toolbar
  region (in every surface) + the removed viewport-pill files. If unrelated
  surfaces drift, the L-030 fix is incomplete — STOP and fix it.

---

## 4. Risks named up front + mitigations

1. **L-030 fix doesn't fully pin state → blanket regen still drifts.**
   *Mitigation:* after the fix, regenerate and `git diff --stat`; the diff
   must be limited to the toolbar region + removed pill files. If theme/
   Spawner subtrees still flip in unrelated surfaces, the seed isn't taking
   (wrong timing / not reloaded) — iterate the seed mechanism before
   committing any goldens. Verify by running the read-only a11y lane twice
   and confirming identical results.

2. **HWND/UIA golden churn + Radix `useId` (L-028).** Regenerating the HWND
   lane full-suite (not `--grep`) keeps render-sequence-dependent Radix IDs
   stable. Do NOT `--grep`-refresh individual HWND goldens.
   *Mitigation:* full-suite `--update` only; the toolbar buttons are plain
   (no Radix `useId`), so the delta should be limited to button nodes.

3. **dist left in legacy mode after the legacy regen.** The `--legacy
   --rebuild` flips dist to legacy; forgetting to rebuild composition would
   ship a legacy-mode dist to the live editor.
   *Mitigation:* always finish with `pnpm build` (composition) and confirm
   `dist/build-meta.json` reads composition before the live smoke.

4. **Occlusion removal regressions.** The pill registered a
   `viewport-pill` occlusion rect; removing it must not leave a dangling
   occlusion. *Mitigation:* the occlusion is scoped to the unmounted
   component (cleared on unmount via `useViewportOcclusion`'s cleanup), so
   deleting the component removes it cleanly — verify no `viewport-pill`
   occlusion id remains referenced.

5. **Spawner button loses its text label for screen readers.** Changing
   text→icon: the `aria-label="Toggle Spawner panel"` already carries the
   accessible name, so SR users are unaffected. *Mitigation:* keep the
   `aria-label` + `title` (tooltip for sighted users).

---

## 5. Testing & verification

**vitest:**
- [ ] New `Toolbar` toggle tests: each of the 3 toggles renders with its
  `aria-label`, reflects `aria-pressed` from a mocked snapshot, and
  dispatches the right `engine/set/*` on click.
- [ ] Spawner button: renders `CirclePlus` (icon present, no "Spawner"
  text), `aria-label`/`aria-pressed` intact, toggles visibility.
- [ ] Delete `ViewportPill.test.tsx`.
- [ ] Full suite green (`pnpm test`).

**Build:** `pnpm build` (tsc + dist) clean. MSBuild not needed (no C++).

**Playwright native:**
- [ ] `toolbar.spec.ts` updated: pill references removed; the 3 toolbar
  toggles dispatch + reflect state.
- [ ] Composition lane passes post-regen (`pnpm a11y` read-only) — run
  twice, identical (determinism check, Risk 1).

**a11y goldens:**
- [ ] `git diff --stat` after regen shows only toolbar-region changes +
  removed `viewport-pill.*` files (Risk 1 gate).
- [ ] Both lanes regenerated; dist restored to composition (Risk 3).

**Live smoke (`x64\Release\ParticleEditor.exe --new-ui`):**
- [ ] No floating pill; the 3 toggles + Spawner icon are in the toolbar.
- [ ] Each toggle flips engine state (ground/bloom/leave) + shows pressed.
- [ ] Spawner icon toggles the panel; carry-over resize still smooth.
- [ ] Icons correct in BOTH dark and light theme.

---

## Review

_(to be appended after implementation)_
