# TODO — Lighting becomes a docked pane (shared right slot) with Bloom folded in (session 11)

Branch `lt-4` @ `4526ab6`. Design approved by user. **Pure web-layer change — no
native rebuild** (the lighting/bloom overlays' viewport hole-punch simply stops
being registered; host C++ untouched).

## 1. Goal + scope

**Goal.** Promote the **Lighting** panel from a floating `ToolPanel` overlay to a
**docked, full-height column** that behaves exactly like the Spawner panel (carves
space from the centre column → pushes the viewport + curve editor narrower), and
**fold the Bloom settings into it** as a collapsible section. Lighting and Spawner
**share one right-dock slot** (exclusive: opening one closes the other).

**In:**
- New `right-dock` store: `dock: "spawner" | "lighting" | null`, exclusive `toggle(target)`.
- `PanelLayout` right column renders Spawner *or* Lighting based on `dock`; reuses the
  existing 2col/3col persistence + `deriveOuterLayoutOnToggle` width-carry unchanged.
- `ToolPanel` gains `variant: "overlay" | "docked"` (docked = `h-full w-full`, no occlusion).
- Extract `BloomSection.tsx` (bloom controls as a `ToolPanel.Section`, owns its own
  snapshot + `bloom-available` subscription); render it inside `LightingPanel`.
- Delete `BloomPanel.tsx` + its test + its a11y goldens; remove the View → "Bloom
  Settings…" menu item.
- Keep the docked Lighting header `×` (closes the dock).
- Update all affected unit tests + Playwright specs + the `dialog-lighting` golden.

**Out (with reasons):**
- **Background / Ground panels** stay `ToolPanel variant="overlay"` — user scoped only
  Lighting. (Their overlay + occlusion path is unchanged.)
- **Bloom enable/disable controls** (toolbar "Toggle bloom" button + View → "Bloom"
  checkbox) — unchanged; they toggle the *effect*, orthogonal to the settings pane.
- **4-column coexistence** — explicitly rejected (user chose shared exclusive slot).
- **Lighting toolbar toggle button** — not requested; Lighting stays menu-opened
  (View → Lighting). Could add later for Spawner-parity if asked.
- **`role="dialog"` → `region` reclassification** for the docked pane — deferred;
  keeping `role="dialog"` minimises a11y-harness churn and ToolPanel is already
  non-modal/non-Esc. Revisit if the semantics bother us.
- **Native / legacy Win32 UI** — untouched (legacy keeps its own dialogs until Phase 4.2).

## 2. What the codebase already gives us

- **Docking mechanism** — `PanelLayout.tsx` already docks the Spawner as a 3rd column:
  `deriveOuterLayoutOnToggle` ([PanelLayout.tsx:141](web/apps/editor/src/components/PanelLayout.tsx:141))
  carries widths on open/close; `:2col`/`:3col` localStorage keys; the outer `Group` is
  `key`'d on visibility so it remounts cleanly. The right column renders at
  [PanelLayout.tsx:356-382](web/apps/editor/src/components/PanelLayout.tsx:356). **The
  logic is content-agnostic — it only cares whether the column exists**, so generalising
  `spawnerVisible` → `dockVisible = dock !== null` reuses it wholesale.
- **Lighting/Bloom overlays** mount at [PanelLayout.tsx:326-337](web/apps/editor/src/components/PanelLayout.tsx:326)
  inside the viewport quadrant (`openPanel === "lighting"`).
- **`ToolPanel`** ([components/ToolPanel.tsx](web/apps/editor/src/components/ToolPanel.tsx)) —
  the shell (header + `×` + scrollable body) and the `.Section`/`.Row`/`.Footer` compound
  pieces both panels already use. Outer container is `absolute right-0 ... w-80`; the
  `variant` prop swaps that for `h-full w-full` and skips `useViewportOcclusion`.
- **`spawner-visibility.ts`** ([lib/spawner-visibility.ts](web/apps/editor/src/lib/spawner-visibility.ts)) —
  the Zustand + localStorage pattern (`alo:spawner-visible`, `__resetForTests`, compat
  shim) to model `right-dock.ts` on. Consumers: Toolbar (`useSpawnerVisibility`), MenuBar
  (`toggleSpawner`, F7), PanelLayout (`useSpawnerVisible`), SpawnerPanel (X-close).
- **`tool-panel.ts`** ([lib/tool-panel.ts](web/apps/editor/src/lib/tool-panel.ts)) — overlay
  store; strip `"lighting"`/`"bloom"` from `ToolPanelId`, leaving `"background"|"ground"|null`.
- **Bloom logic to lift** — [BloomPanel.tsx:36-141](web/apps/editor/src/screens/BloomPanel.tsx:36)
  (snapshot + `engine/query/bloom-available` + 4 controls). Zero new bridge surface.
- **a11y surface registry** — `tests/helpers/a11y-surfaces.ts`: `dialog-lighting`
  ([:240-255](web/apps/editor/tests/helpers/a11y-surfaces.ts:240)) opens via menu, waits
  on `[role="dialog"][aria-label="Lighting"]`, closes via `×`; `dialog-bloom-settings`
  ([:256-268](web/apps/editor/tests/helpers/a11y-surfaces.ts:256)) to be removed.
  `seedCanonicalUiState` ([:38](web/apps/editor/tests/helpers/a11y-surfaces.ts:38)) seeds
  `alo:spawner-visible=true` — update to seed the new dock key.

## 3. Architecture / implementation approach

**New `lib/right-dock.ts`** (models on `spawner-visibility.ts`):
```ts
export type RightDock = "spawner" | "lighting" | null;
// store: { dock, setDock(d), toggle(target) }   // toggle: dock===target ? null : target
// persist to localStorage('alo:right-dock'); migrate from 'alo:spawner-visible'
//   on first read (true→"spawner", false→null) so existing users keep their column.
// hooks: useRightDock(), useToggleDock(); imperative toggleDock(target), setDock(d);
//        __resetRightDockForTests().  default "spawner".
```
`spawner-visibility.ts` is **deleted**; its consumers repoint to `right-dock`.

**`PanelLayout.tsx`** — replace `spawnerVisible` with `dockVisible = useRightDock() !== null`
through the outer-Group/persistence logic (the `:2col`/`:3col` keys + `deriveOuterLayoutOnToggle`
stay verbatim). The right `Panel` body becomes:
```tsx
{dock === "spawner" ? <SpawnerPanel bridge/> : <LightingPanel bridge onClose={() => setDock(null)} />}
```
Drop the in-viewport `LightingPanel`/`BloomPanel` overlay mounts (lines 326-337). Background/
Ground overlays are NOT here (they mount elsewhere via tool-panel) — confirm during impl.

**`ToolPanel.tsx`** — add `variant?: "overlay" | "docked"` (default `"overlay"`). Container
className branches; in `"docked"` the `useViewportOcclusion` call is skipped (pass empty id
/ guard). `role="dialog"` + header `×` retained in both.

**`BloomSection.tsx`** (new) — `<ToolPanel.Section title="Bloom">` with the lifted
snapshot/available logic + the 4 controls (Enable / Strength / Cutoff / Size). Self-contained.

**`LightingPanel.tsx`** — `variant="docked"`, drop `occlusionId`; insert `<BloomSection bridge/>`
after the Shadow section, before the Footer. `onClose` now collapses the dock.

**`MenuBar.tsx` / `Toolbar.tsx` / `App.tsx`** — Spawner entries call `toggleDock("spawner")`;
View → Lighting calls `toggleDock("lighting")`; remove "Bloom Settings…" item +
`onOpenBloomPanel` prop + `onOpenLightingPanel`'s `setOpenToolPanel("lighting")` (now dock).
Toolbar Spawner button `aria-pressed={dock==="spawner"}`.

**Deletions:** `BloomPanel.tsx`, `BloomPanel.test.tsx`, `dialog-bloom-settings.golden.json`,
`dialog-bloom-settings.composition.golden.yaml`, `spawner-visibility.ts`.

## 4. Risks named up front + mitigations

1. **a11y golden churn masking a real regression.** Overlay→docked changes the
   `dialog-lighting` tree (container differences + new Bloom section); the blanket
   `a11y:update` would rewrite it. **Mitigation:** regenerate, then **read the golden diff
   line-by-line** — confirm every change is explained by (a) the added Bloom section or (b)
   the docked container, and nothing else (e.g. a dropped aria-label). Delete
   `dialog-bloom-settings` deliberately, not via blanket update.
2. **Right-dock persistence migration breaks existing users.** Users have
   `alo:spawner-visible`; a naive new key defaults them to a different state. **Mitigation:**
   `right-dock` reads `alo:right-dock` first, falls back to migrating `alo:spawner-visible`
   (true→"spawner"). Unit-test the migration both ways + the missing-key default.
3. **Width-carry logic assumes the column is the Spawner.** `deriveOuterLayoutOnToggle` +
   the `:2col`/`:3col` keys must fire on dock *presence*, not spawner specifically, else
   switching spawner↔lighting (column stays open) wrongly reflows or mis-persists.
   **Mitigation:** the toggled-detection keys on `dockVisible` (present↔absent) only; a
   content swap (spawner→lighting, both non-null) is NOT a toggle → no reflow. Add a
   PanelLayout test: spawner→lighting keeps the column width; lighting→closed restores 2col.
4. **`engine/set/bloom` snapshot Playwright specs open the old Bloom panel.**
   `composition-hosting.spec.ts` clicks a "Bloom"/"Bloom Settings" menu item to reach the
   "Enable bloom" checkbox. **Mitigation:** repoint those specs to open Lighting (the
   checkbox now lives in its Bloom section); the `aria-label="Enable bloom"` selector is
   unchanged, so only the open-path edits.
5. **SpawnerPanel X-close + F7 still target the old store.** **Mitigation:** repoint
   SpawnerPanel's close + the F7 handler to `toggleDock("spawner")`/`setDock(null)`; grep
   every `spawner-visibility` importer before deleting the file.
6. **Occlusion guard when `variant="docked"`.** `useViewportOcclusion(bridge, id, ref)` is
   a hook — can't be called conditionally. **Mitigation:** keep the call unconditional but
   pass `""`/skip when docked (the hook already no-ops on empty id per its own contract at
   ToolPanel.tsx:50-51); verify that contract holds before relying on it.

## 5. Testing & verification

**Build / typecheck:**
- [ ] `pnpm --filter @particle-editor/editor build` → clean (+dist/, needed for the host).
- [ ] No native rebuild expected; if any host file is touched, that's a red flag — stop & re-scope.

**Unit (vitest) — expect a NEW total (bloom test deleted, dock tests added):**
- [ ] `right-dock.test.ts` (new): toggle exclusivity, migration from `alo:spawner-visible`, default.
- [ ] `LightingPanel.test.tsx`: docked variant renders; Bloom section present + controls wired.
- [ ] `BloomSection.test.tsx` (new, lifted from BloomPanel.test): enable/strength/cutoff/size
      dispatch the right bridge kinds; unavailable → disabled.
- [ ] `MenuBar.test.tsx`: no "Bloom Settings" item; Lighting toggles dock; Spawner toggles dock.
- [ ] `Toolbar.test.tsx`: Spawner button `aria-pressed` tracks `dock==="spawner"`.
- [ ] `PanelLayout.test.tsx`: spawner→lighting keeps column open + width; lighting→closed → 2col;
      right column renders the correct child per `dock`.
- [ ] `ToolPanel.test.tsx`: docked variant container classes; overlay unchanged.
- [ ] `BloomPanel.test.tsx` deleted; grep shows no dangling import.
- [ ] `pnpm --filter @particle-editor/editor test` → all green (record the new file/test counts).

**a11y goldens:**
- [ ] Remove `dialog-bloom-settings` from `DIALOG_SURFACES`; delete its 2 goldens.
- [ ] Update `seedCanonicalUiState` to seed `alo:right-dock`.
- [ ] Regenerate `dialog-lighting` (.json + .composition.yaml); **diff-review** every change (Risk 1).
- [ ] `pnpm --filter @particle-editor/editor a11y` → passes (new count = 157 − bloom surface;
      4 splitters baseline). CDP flaky → retry, `127.0.0.1:9222`.

**Playwright specs:**
- [ ] `composition-hosting.spec.ts`, `tools.spec.ts`, `menu-bar.spec.ts`: repoint bloom-open
      paths to Lighting; remove Bloom-Settings assertions.
- [ ] `splitters.spec.ts`, `spawner-import-mod.spec.ts`: spawner-visibility → right-dock; still pass.

**Manual / arch-C (hand on-screen confirm to user — L-033):**
- [ ] Faithful `--new-ui`: View → Lighting docks a full-height right column, curve editor
      narrows (like Spawner); Bloom section present + sliders affect glow; toolbar Spawner
      button toggles the same slot exclusively; closing restores the 2-col layout.

**On landing:** CHANGELOG + lesson (if a non-obvious gotcha) + FF-push `lt-4`. No `master`.

## Progress (live)

- [x] `right-dock.ts` store + test (8/8).
- [x] `ToolPanel` `variant` prop + tests.
- [x] `BloomSection.tsx` + test (lifted from BloomPanel).
- [x] `LightingPanel` docked + Bloom section.
- [x] `PanelLayout` right-dock wiring (Spawner/Lighting shared slot) + tests.
- [x] MenuBar / Toolbar / App / SpawnerPanel / tool-panel repointed.
- [x] Deleted BloomPanel.tsx + test, spawner-visibility.ts.
- [x] vitest: **403 passed / 46 files** (was 392); build/typecheck clean.
- [x] Playwright specs repointed (composition-hosting, tools, spawner-import-mod).
- [x] a11y-surfaces: seed `alo:right-dock`; bloom surface removed; bloom goldens deleted.
- [x] a11y:update (composition) → **155 passed / 4 splitters** (155 = 157 − 2 removed
      bloom surface; the 4 splitter fails are the *identical* L-033 baseline lines
      125/163/227/258 that also fail in unrelated runs — not a regression).
- [x] **Risk-1 diff-review PASSED.** Only 2 composition goldens changed, both fully
      explained: `menubar-view-open` = exactly one line removed (`Bloom Settings…`);
      `dialog-lighting` = (a) Spawner toggle loses `[pressed]` (Lighting took the
      exclusive slot → closed Spawner ✓), (b) Lighting block moved overlay→`complementary`
      (docked ✓), (c) Spawner content replaced by Lighting (shared slot ✓), (d)
      `group: Bloom` added (new section ✓), (e) every lighting control label preserved.
- [x] a11y:update:legacy churned ~25 unrelated UIA goldens → legacy lane is unmaintained;
      reverted it wholesale (kept only the removed-bloom `.golden.json` deletion). **L-052.**
- [x] Rebuilt composition dist; `pnpm a11y` (verify) → **155 passed / 4 splitters** — the
      committed composition goldens PASS.
- [ ] arch-C on-screen confirm (hand to user).

## Review

**Shipped.** Lighting promoted from a floating `ToolPanel` overlay to a **docked, full-
height pane** sharing the Spawner's right-dock slot (exclusive), with Bloom settings folded
in as a collapsible section. Pure web-layer change, **no native rebuild**.

**Design decisions that held:** (1) make the dock slot *content-agnostic* and reuse the
Spawner's entire width/persistence/reflow machinery — the toggle-detection keys on dock
*presence*, so a spawner↔lighting swap reflows nothing; (2) `ToolPanel variant="docked"`
(fills column, skips occlusion) instead of a parallel component; (3) extract `BloomSection`
to keep `LightingPanel` focused; (4) `right-dock` migrates the legacy `alo:spawner-visible`
key. Net **−215 lines** in touched files.

**Verification (all green):**
- vitest **403 / 46 files** (was 392: −2 BloomPanel, +8 right-dock, +2 BloomSection, +2 ToolPanel, +1 PanelLayout).
- build + typecheck clean.
- Composition a11y **155 / 4 splitters** (155 = 157 − removed bloom surface; 4 splitters = L-033 baseline, not a regression — toggle logic covered green by PanelLayout unit tests).
- **Risk-1 diff-review PASSED** — only `dialog-lighting` + `menubar-view-open` composition goldens changed, every line explained (Lighting overlay→docked, Spawner toggle un-pressed from the exclusive swap, `group: Bloom` added, one menu line removed).

**Deliberate non-action:** the legacy UIA (`*.golden.json`) lane is unmaintained — a full
regen churned ~25 unrelated surfaces, so it was left as-is (only the removed-bloom golden
dropped). Documented in **L-052** + CHANGELOG.

**Lessons:** **L-052** (the two a11y lanes diverge; never blanket-regenerate the legacy
lane for an unrelated change).

**Outstanding:** arch-C on-screen confirm by the user (L-033).
