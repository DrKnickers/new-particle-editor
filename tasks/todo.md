# tasks/todo.md — B1.4 [NT-8] Resizable splitters via `react-resizable-panels`

**Status:** plan drafted, awaiting user OK before any code.
**Predecessor session:** B1.3.2 (75081b4 on `origin/lt-4`).
**Difficulty estimate:** ★★★ (medium — single new dep, four splitters, conditional column, occlusion ripple is already free).

---

## 1. Goal + scope

When this ships, the user can drag any of four boundaries in the editor
shell and the new sizes survive a page reload:

1. **Left column ↔ centre column** — `Particle System` panel vs viewport stack.
2. **Centre column ↔ Spawner column** — viewport stack vs Spawner panel (only when Spawner is visible).
3. **Viewport ↔ Curve editor** — inside the centre column.
4. **Emitter tree ↔ Property tabs** — inside the left column's `.panel-body`.

Defaults match B1.3.2's resting state on first load and after a "reset
layout" gesture: left column 320 px, Spawner 320 px when on, curve editor
290 px, inner tree/tabs 25/75. Persistence is per-user via
`localStorage` under the `alo:layout:*` namespace (matches existing
`alo:theme` convention).

**In**

- Library: `react-resizable-panels` (chosen in pre-plan; confirmed during
  this plan's Task 1 by installing the latest 2.x and verifying API).
- Four draggable splitters per the list above, with min/max constraints.
- Persistence via the library's built-in `autoSaveId` (writes JSON to
  `localStorage`).
- Sensible min sizes so the user cannot drag any pane to unusable widths
  (see §3.4 for numbers).
- "Reset layout" hidden behind a View-menu item *Reset panel layout*
  that clears the layout keys.
- ARIA + keyboard nav (Tab → splitter focusable, arrow keys nudge size
  by 1 %). Library ships this for free; verified during Task 1.
- All existing `data-testid="quadrant-*"` testIDs preserved on the same
  semantic nodes (Modal portal lookup + Playwright specs depend on them).

**Out**

- No C++ changes. No bridge schema changes. (`ResizeObserver` on the
  existing `ViewportSlot` and `useViewportOcclusion` callsites already
  fans drag-state out to the host without further plumbing — see §2.4.)
- No per-project persistence (deliberate — user picked per-user; bundling
  layout into the `.alo` file is a separate dispatch if it ever lands).
- No collapsible-to-zero animation for the Spawner column — toggling the
  Spawner panel from its existing toolbar button continues to mount /
  unmount the panel (we just teach the surrounding `PanelGroup` to
  recompose). Reason: animation is out of scope for B1.4, and the
  library handles mount/unmount cleanly.
- No splitter on the bottom curve-editor row's *horizontal* axis (it
  already spans the centre column's full width — no second axis to
  resize).
- No reset gesture beyond the menu item (no double-click-handle reset
  for v1 — easy follow-up if requested).

---

## 2. What the codebase already gives us

### 2.1 Existing layout (`web/apps/editor/src/App.tsx`)

The relevant region is at [App.tsx:188-286](web/apps/editor/src/App.tsx:188-286).

- Outer wrapper: `<div className="flex flex-1 min-h-0 overflow-hidden">`.
- **Left column**: `<div className="panel w-80 shrink-0">` (320 px fixed)
  with header *"Particle System"*. Body is `panel-body flex min-h-0
  flex-col overflow-hidden`, with `EmitterTree` (`flex-1`) and
  `EmitterPropertyTabs` (`flex-[3_1_0%]`) yielding the 25 / 75 split that
  B1.3.1 introduced. The comment at
  [App.tsx:219](web/apps/editor/src/App.tsx:219) already says *"B1.4
  will make the boundary draggable via react-resizable-panels."*
- **Centre column**: `<div className="flex flex-1 min-w-0 flex-col">`.
  `ViewportSlot` is `flex-1`, curve editor is `h-[290px] shrink-0
  border-t border-border`.
- **Right (Spawner) column**: `<aside className="w-80 shrink-0 …
  border-l border-border bg-panel">` — only mounted when
  `spawnerVisible === true` from
  [lib/spawner-visibility.ts](web/apps/editor/src/lib/spawner-visibility.ts).

### 2.2 Existing testIDs (load-bearing — must be preserved)

- `quadrant-emitter-tree` — referenced by Playwright
  [property-tabs.spec.ts:57](web/apps/editor/tests/property-tabs.spec.ts:57).
- `quadrant-property-tabs` — Playwright + vitest.
- `quadrant-viewport` — Modal portal target in
  [Modal.tsx:84-90](web/apps/editor/src/components/Modal.tsx:84-90)
  (`document.querySelector('[data-testid="quadrant-viewport"]')`),
  Modal vitest, Playwright.
- `quadrant-curve-editor` — Playwright + CurveEditor vitest.
- `quadrant-spawner` — Playwright.

All five must remain on **DOM nodes whose `getBoundingClientRect`
semantically matches the rendered pane** (i.e. the testID goes on the
`Panel`'s inner div, not the `PanelResizeHandle` or any wrapping
component the library inserts).

### 2.3 Existing `localStorage` convention

The only key in use today is `alo:theme`
([App.tsx:70](web/apps/editor/src/App.tsx:70)). The plan adopts the
same prefix: `alo:layout` (single key — the library writes a JSON blob
keyed by panel group id when `autoSaveId` is set).

### 2.4 ResizeObserver wiring already covers drag-state propagation

- [ViewportSlot.tsx:11-37](web/apps/editor/src/components/ViewportSlot.tsx:11-37)
  attaches a `ResizeObserver` to its outer div and fires
  `layout/viewport-rect` on every resize. Splitter drags will fire it
  for free.
- [lib/viewport-occlusion.ts:46-92](web/apps/editor/src/lib/viewport-occlusion.ts:46-92)
  attaches `ResizeObserver` to every occlusion target. Splitter drags
  on a column boundary will resize the spawner / tool-panel
  occlusion-target divs and fire `viewport/occlude` updates for free.

This is the key risk-killer for the plan: **we do not need a single
new bridge call.** All host-side compositing stays correct because the
host already reacts to per-element resize.

### 2.5 Existing tests we will need to update or add

- [components/__tests__/Modal.test.tsx](web/apps/editor/src/components/__tests__/Modal.test.tsx)
  manually adds `<div data-testid="quadrant-viewport" />` to the DOM
  — no change needed unless we accidentally move the testID.
- [tests/property-tabs.spec.ts](web/apps/editor/tests/property-tabs.spec.ts)
  asserts all five quadrant testIDs are visible — no change needed.
- New: `tests/splitters.spec.ts` (Playwright) — drag each splitter,
  reload, assert sizes persist. **No new vitest spec needed** because
  the library's behaviour is library-tested; we test the *integration*
  end-to-end where the layout actually mounts.
- New: `src/components/__tests__/PanelLayout.test.tsx` (vitest) —
  smoke test that `<PanelLayout />` mounts, exposes the five
  testIDs, and reads/writes the `alo:layout` key.

---

## 3. Architecture / implementation approach

### 3.1 New components

```
web/apps/editor/src/components/
  PanelLayout.tsx        # Outer 2- or 3-column PanelGroup wrapping
                         # all of AppShell's main row. Renders the
                         # nested left-column + centre-column PanelGroups.
                         # Drives spawner mount/unmount based on
                         # useSpawnerVisible(), preserving testIDs.
```

App.tsx's main `<div className="flex flex-1 min-h-0 overflow-hidden">`
section becomes `<PanelLayout bridge={bridge} openPanel={openPanel} />`.
The five quadrant `data-testid` attributes move into `PanelLayout`, on
the same semantic nodes they sit on today.

### 3.2 Group nesting (post-T1 — adjusted for 4.x API)

**T1 finding:** `react-resizable-panels@4.11.1` is the installed version
(latest at time of plan). 4.x renames + reshapes the API. Corrections:

- `PanelGroup` → `Group`, with prop `direction` → `orientation`.
- `PanelResizeHandle` → `Separator`.
- `autoSaveId` is **gone** — persistence is DIY via `defaultLayout`
  (passed in on mount) + `onLayoutChanged` (called after pointer
  release). We use a small `usePersistedLayout(key, defaults)` hook.
- `Layout` type is `{[panelId: string]: number}` (percentages 0-100).
- `Panel` accepts `defaultSize`, `minSize`, `maxSize`, `collapsible`,
  `collapsedSize`, `id` — props the plan already used.
- `Separator` accepts `disableDoubleClick?: boolean`. Default
  behaviour is **double-click resets to default size** — a gesture the
  original plan §3.6 deferred to a follow-up. Now ships free; we
  leave `disableDoubleClick` unset.
- `data-resize-handle-active` attribute is **not** a 4.x thing. CSS
  uses `:hover` + `:active` pseudo-classes on `[data-separator]`
  instead.
- ARIA (`aria-orientation`, `aria-valuemax/min/now`, etc.) is auto-
  applied to the `Separator` — we don't add it ourselves.
- `Panel`'s `className` lands on a **nested** div, not the root div,
  to "avoid styles that interfere with Flex layout". The data-testid
  attribute is passed through to that same root div alongside
  `data-panel`. **For our quadrant testIDs we place them on a
  manually-rendered inner div** inside `Panel`'s children, not on
  the `Panel` element itself — keeps the rect semantics identical
  to today.

```tsx
<Group orientation="horizontal"
       defaultLayout={outerLayout}
       onLayoutChanged={persistOuter}>
  <Panel id="left" minSize={15} maxSize={40}>
    <div className="panel h-full"><div className="panel-header">…</div>
      <div className="panel-body flex min-h-0 flex-col overflow-hidden">
        <Group orientation="vertical"
               defaultLayout={leftLayout}
               onLayoutChanged={persistLeft}
               style={{ flex: 1, minHeight: 0 }}>
          <Panel id="tree" minSize={10}>
            <aside data-testid="quadrant-emitter-tree" …>
              <EmitterTree />
            </aside>
          </Panel>
          <Separator className="ce-splitter ce-splitter-h" />
          <Panel id="tabs" minSize={20}>
            <div data-testid="quadrant-property-tabs" …>
              <EmitterPropertyTabs />
            </div>
          </Panel>
        </Group>
      </div>
    </div>
  </Panel>

  <Separator className="ce-splitter ce-splitter-v" />

  <Panel id="center" minSize={30}>
    <Group orientation="vertical"
           defaultLayout={centerLayout}
           onLayoutChanged={persistCenter}>
      <Panel id="viewport" minSize={30}>
        <div data-testid="quadrant-viewport" className="relative h-full">
          <ViewportSlot /><ViewportPill />…tool-panels…
        </div>
      </Panel>
      <Separator className="ce-splitter ce-splitter-h" />
      <Panel id="curve" minSize={10}>
        <div data-testid="quadrant-curve-editor" …>
          <CurveEditorPanel />
        </div>
      </Panel>
    </Group>
  </Panel>

  {spawnerVisible && (
    <>
      <Separator className="ce-splitter ce-splitter-v" />
      <Panel id="spawner" minSize={12} maxSize={40}>
        <aside data-testid="quadrant-spawner" …><SpawnerPanel /></aside>
      </Panel>
    </>
  )}
</Group>
```

Persistence hook:

```ts
function usePersistedLayout(key: string, defaults: Layout) {
  const initial = useMemo(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw) as Layout;
      // Defensive: if any id is missing or ratios don't sum to ~100,
      // fall back to defaults (corrupted state, e.g. DevTools tampering).
      const sum = Object.values(parsed).reduce((a, b) => a + b, 0);
      const allKeys = Object.keys(defaults).every((k) => k in parsed);
      if (!allKeys || Math.abs(sum - 100) > 0.5) return defaults;
      return parsed;
    } catch {
      return defaults;
    }
  }, [key]);
  const onLayoutChanged = useCallback((layout: Layout) => {
    try { localStorage.setItem(key, JSON.stringify(layout)); }
    catch { /* localStorage full / disabled — drop silently */ }
  }, [key]);
  return { defaultLayout: initial, onLayoutChanged };
}
```

**2-col vs 3-col Spawner state.** Because we're DIY now, we use **two
separate outer keys** to avoid ratio drift between the states:
`alo:layout:outer:2col` (mounted when `spawnerVisible === false`) and
`alo:layout:outer:3col` (mounted when `true`). Picked at render time.
This was the fallback path in the original plan; with `autoSaveId`
gone we just take that path directly.

### 3.3 CSS — handle visuals (post-T1 adjusted)

New CSS rules in [web/apps/editor/src/styles/components.css](web/apps/editor/src/styles/components.css):

```css
[data-separator].ce-splitter {
  --ce-splitter-thickness: 4px;
  background: transparent;
  position: relative;
  transition: background 120ms ease;
}
[data-separator].ce-splitter:hover,
[data-separator].ce-splitter:active {
  background: var(--accent-soft);
}
[data-separator].ce-splitter-v {
  width: var(--ce-splitter-thickness); cursor: col-resize;
}
[data-separator].ce-splitter-h {
  height: var(--ce-splitter-thickness); cursor: row-resize;
}
[data-separator].ce-splitter:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
```

4 px thickness matches the existing 1 px-border-region; hover affordance
uses the existing `--accent-soft` token (already present in
`tokens.css`). Active-drag state piggybacks on the `:active`
pseudo-class because 4.x doesn't expose a `data-resize-handle-active`
attribute — `:active` while the user holds the pointer down works
equivalently for our visual.

### 3.4 Min/max sizing rationale

Percentages, because the library's `Panel` API takes percentages by
default and that's what `autoSaveId` persists.

| Pane         | default | min   | max  | Rationale (computed against a 1920-wide window)                         |
|--------------|---------|-------|------|--------------------------------------------------------------------------|
| left col     | 20 %    | 15 %  | 40 % | 15 % ≈ 288 px (legacy `w-80` = 320 px). Floor: tabs still readable.       |
| spawner col  | 20 %    | 12 %  | 40 % | 12 % ≈ 230 px (legacy `w-80` minus paddings → Spawner still usable).     |
| centre col   | (rest)  | 30 %  | —    | Min 30 % ≈ 576 px — viewport still wide enough to render a sane scene.  |
| inner tree   | 25 %    | 10 %  | —    | Tree of 1-2 emitters still visible.                                      |
| inner tabs   | 75 %    | 20 %  | —    | Smallest tab strip we want to allow.                                     |
| inner vp     | 75 %    | 30 %  | —    | Tied to centre min — viewport must stay usable.                          |
| inner curve  | 25 %    | 10 %  | —    | ≈ 100 px — fits one channel row, matches "below this it's pointless"     |

The library clamps drags to these bounds; the user cannot drag past min.

### 3.5 Reset layout (post-T1 adjusted)

New View-menu item *Reset panel layout* clears the four DIY
`localStorage` entries (`alo:layout:outer:2col`,
`alo:layout:outer:3col`, `alo:layout:left`, `alo:layout:center`) and
forces a re-render with the in-code defaults. Implementation: bump a
`useState` counter passed as `key={n}` to the outer `<Group>` so React
remounts the tree. `usePersistedLayout` on next mount sees an empty
key and returns the in-code `defaults`.

Note: 4.x also ships **double-click-handle reset for free** (the
`Separator` resets *its* panels to default size on double-click).
That's per-splitter; the menu item resets all four at once.

### 3.6 Out-of-scope items deliberately deferred

- **~~Reset gesture on the handle itself~~** — 4.x ships this by
  default. Promoted in scope; no work required.
- **Per-window-size scaling.** A user with a 4K monitor who sets
  ratios then plugs into a laptop will see those ratios honoured
  (because we store percentages, not pixels) — no extra work.
- **Cross-tab sync.** Two editor windows open at once won't see each
  other's drags. We don't expect dual windows in practice; if it ever
  matters, `StorageEvent` listener is a small follow-up.

---

## 4. Risks named up front + mitigations

### Risk 1 — `react-resizable-panels` API drift ✅ caught in T1

T1 found 4.11.1 is the installed version (4.x is a major reshape from
the 1.x/2.x API I sketched against). Names + persistence model
changed; §3.2 / §3.3 / §3.5 / §3.6 above rewritten to match. The
risk fired and the mitigation worked — caught at install time, not
at debug time.

Residual risk: persistence is now DIY, so `localStorage` corruption
handling moves from "library does it" to "our `usePersistedLayout`
hook does it". Hook validates: parses JSON, checks all default keys
present, checks ratios sum to ~100, otherwise returns defaults. T3
adds a unit test for the corrupted-blob branch.

### Risk 2 — `data-testid="quadrant-viewport"` rect semantics shift, breaking Modal.tsx

`Modal.tsx` does
`document.querySelector('[data-testid="quadrant-viewport"]')`
([Modal.tsx:90](web/apps/editor/src/components/Modal.tsx:90)) to find
the portal target for the frosted-glass snapshot
backdrop (NT-9 / B1.3.1.1, shipped this session). If splitters add
an intermediate wrapper that shifts the rect (e.g. a 4-px handle
counted as part of the viewport quadrant), the snapshot occlude rect
will be misaligned by a hair.

**Mitigation:** Place the testID on the **innermost** div that wraps
the `<ViewportSlot />` + `<ViewportPill />` stack — same node it sits
on today. The `Panel` from the library renders its own outer div; the
testID lives one level inside, identical to the current
`flex-1 min-h-0` div. Vitest's Modal test
([Modal.test.tsx:103-149](web/apps/editor/src/components/__tests__/Modal.test.tsx:103-149))
already pins the contract; pass it without modification.

### Risk 3 — Spawner mount/unmount mid-drag

The Spawner can be toggled off via the toolbar button while the user
is actively dragging the centre↔spawner handle. The library's
`onLayout` callback could fire after the spawner `Panel` has
unmounted, producing a "stale handle" warning.

**Mitigation:** Spawner toggle is a user gesture distinct from a drag
— they cannot both be in-flight. But to be defensive, the toolbar
button handler reads the library's `onLayoutChange` callback's last
sizes, commits them to `localStorage` synchronously, *then* flips
`spawnerVisible`. Confirm during Task 5 manual smoke.

### Risk 4 — Inner `PanelGroup` percentage drift on outer drag

When the user drags the *outer* left↔centre splitter, the **inner**
tree↔tabs `PanelGroup` keeps the same percentages — which means the
absolute pixel sizes of the tree and tabs both shrink proportionally.
This is the library's default and is the right behaviour, but worth
naming so the test plan checks it (rather than asserting absolute
pixel counts).

**Mitigation:** Playwright spec asserts *percentages within ±1 %* of
the post-drag layout, not absolute pixels.

### Risk 5 — Inner curve-editor `min-h-0` propagation

The curve editor's SVG canvas relies on its parent having `min-h-0`
so flex layout doesn't blow it up vertically. The library's
`Panel` element renders a wrapper that may or may not propagate
`flex` semantics — needs verifying in Task 1.

**Mitigation:** Library exposes a `className` prop on `Panel` that
threads onto the rendered div. Apply `min-h-0 min-w-0` as needed.
Task 4's smoke is "drag viewport↔curve to extremes; does the curve
canvas render without overflow?" — explicit check.

### Risk 6 — `localStorage` quota / corruption

`localStorage` is per-origin and tiny. Three layout blobs of <500 bytes
each is fine, but a corrupted JSON write (e.g. user opens DevTools and
manually writes garbage) would crash `PanelGroup`'s deserialise step.

**Mitigation:** Library's `autoSaveId` handles bad JSON gracefully
(falls back to `defaultSize`). Confirm during Task 1 by writing
garbage into the key and reloading. If it crashes, wrap the layout
in an error boundary that calls *Reset panel layout*.

### Risk 7 — Test selector regressions

CurveEditor and EmitterTree vitests use the inner testIDs of the
panels they render — those don't move. But any test that asserts a
quadrant's `getBoundingClientRect` will need to be re-checked, and
Playwright specs that rely on column widths could shift.

**Mitigation:** Pre-flight grep (Task 0) for every quadrant testID
and `getBoundingClientRect` usage; list each callsite the plan needs
to re-verify. Run full vitest + Playwright after Task 5 and before
Task 6 docs.

---

## 5. Testing & verification

### Manual checklist (happy paths)

- [ ] Drag left↔centre, see live resize, release, sizes hold.
- [ ] Drag centre↔spawner with spawner visible, see live resize, release.
- [ ] Drag viewport↔curve, see canvas redraw at new size.
- [ ] Drag tree↔tabs, see tab strip resize without horizontal scroll.
- [ ] Reload page — all four sizes restored.
- [ ] Toggle Spawner off (toolbar button) — centre column expands;
      previous outer ratio for the *2-col* state restored if it had
      been touched.
- [ ] Toggle Spawner on — 3-col ratio restored.
- [ ] *Reset panel layout* menu item restores all four to defaults
      and persists the reset.

### Edge cases

- [ ] Drag a handle until it hits its min; library refuses further.
- [ ] Drag a handle until it hits its max (left col, spawner col);
      library refuses further.
- [ ] Drag handle while a modal (e.g. About) is open — handle remains
      inert (library cancels its own pointer events when document
      pointer-events are blocked? confirm and document; if not, add a
      `pointerEvents: none` to handles when `aria-modal` is active).
- [ ] Drag rapidly back and forth — no flicker, no stutter, viewport
      occlusion stays glued to the moving rect (relies on
      `ResizeObserver` from §2.4).
- [ ] Drag while Spawner is invisible — only the left↔centre handle
      is present; viewport↔curve still works.
- [ ] Drag a column splitter while a tool panel (Lighting / Bloom) is
      open over the viewport — occlusion follows the viewport rect.
      (The tool panel itself is absolutely positioned over the
      `quadrant-viewport` node; it tracks via its own ResizeObserver.)
- [ ] Open Modal (e.g. About) — snapshot backdrop captures the
      *current* viewport rect at the moment of open (not the post-drag
      one if a drag is in-flight; modal blocks during dragging).

### Cancellation / undo

- [ ] Resizing a splitter has no undo entry — confirm it's not piped
      through the bridge undo stack (it shouldn't be — no bridge call
      is made by the library; only `localStorage` writes happen).

### Refused inputs

- [ ] Manually write `"not json"` to `alo:layout:outer` in DevTools,
      reload — library falls back to defaults, no crash.
- [ ] Set a `Panel`'s persisted size to 200 — library clamps to max
      on next render.

### Cleanup

- [ ] Unmount AppShell (e.g. `?demo=primitives` route) — no leftover
      `ResizeObserver` warnings in console.
- [ ] *Reset panel layout* — confirm `alo:layout:*` keys are
      removed from `localStorage` after the reset.

### Test suites

- [ ] `pnpm -F @particle-editor/editor test` — full vitest run; expect
      281 + 3 (new tests in `PanelLayout.test.tsx`) passing.
- [ ] `pnpm -F @particle-editor/editor playwright test` — full
      Playwright run; expect 83 + 1 = 84 (`splitters.spec.ts` adds
      one new spec asserting drag + reload).
- [ ] MSBuild Debug x64 — should be untouched (no C++), expect the
      same preexisting LIBCMTD warning.

### Debug instrumentation

`#ifndef NDEBUG` is C++-only and not applicable here. JS-side,
`[splitter]` log prefix: any console.log added during development gets
prefixed `[splitter]` so a quick grep cleans up before commit. Two
deliberate breadcrumbs likely:

- `[splitter] onLayout outer=[20.1, 60.2, 19.7]`
- `[splitter] persist write alo:layout:outer = {…}`

Strip both before merging.

---

## 6. Task list (execution order, ~2-5 min each)

> Plan author note: the writing-plans skill would prefer tight
> TDD-per-task bites. CLAUDE.md's plan structure prefers a numbered
> list at the foot. Compromise: tasks are tight, each calls out
> *write the test first* where applicable, and each ends with a
> commit.

- [ ] **T0 — Pre-flight grep.** Audit current quadrant-testID +
  `getBoundingClientRect` usage. Output: a short note appended below
  this section listing each consumer and whether splitter restructure
  affects it. No commit (planning only).
- [x] **T1 — Install + verify `react-resizable-panels`.** `pnpm -F
  editor add react-resizable-panels` → 4.11.1. **API drift caught
  via type declarations** (`dist/react-resizable-panels.d.ts`):
  `PanelGroup` → `Group`, `PanelResizeHandle` → `Separator`,
  `autoSaveId` removed. §3.2 / §3.3 / §3.5 / §3.6 / Risk 1 rewritten
  in place. `?demo=splitter` throwaway route dropped — the
  type-declaration walk-through covered every prop the plan needs.
  Commit: `chore(LT-4): B1.4 T1 — add react-resizable-panels@4.11.1`.
- [ ] **T2 — Write the vitest first.** New
  `src/components/__tests__/PanelLayout.test.tsx`:
  - mounts `<PanelLayout />` inside a MockBridge provider,
  - asserts five `quadrant-*` testIDs present in the DOM,
  - asserts `alo:layout:outer` is written on mount (library writes
    the default sizes immediately) — uses jsdom's `localStorage`.
  Run; expect failures. Commit: `test(LT-4): B1.4 T2 — PanelLayout
  vitest skeleton (failing)`.
- [ ] **T3 — Implement `PanelLayout.tsx`.** Build the three-PanelGroup
  structure from §3.2. Move quadrant testIDs onto the same semantic
  inner divs they live on today. Wire spawner mount/unmount via
  `useSpawnerVisible()`. Add CSS to `components.css`. Get vitest
  passing. Commit: `feat(LT-4): B1.4 T3 — PanelLayout with four
  draggable splitters`.
- [ ] **T4 — Swap `PanelLayout` into `App.tsx`.** Replace the existing
  main-row block at [App.tsx:188-286](web/apps/editor/src/App.tsx:188-286)
  with `<PanelLayout bridge={bridge} openPanel={openPanel} />`. Run
  vitest (281 + 3 = 284 expected), run dev server, manually smoke
  every checklist item in §5. Commit: `feat(LT-4): B1.4 T4 — wire
  PanelLayout into AppShell`.
- [ ] **T5 — Playwright spec.** New `tests/splitters.spec.ts` that
  drags each splitter via `page.mouse.down/move/up`, reloads, and
  asserts panel widths within ±1 % of the post-drag layout. Run
  full Playwright suite (84 expected). Commit: `test(LT-4): B1.4 T5
  — splitter persistence Playwright spec`.
- [ ] **T6 — *Reset panel layout* menu item.** Add to View menu via
  the existing menu plumbing. Clears the three `alo:layout:*` keys
  and bumps a `key={n}` on `<PanelLayout />` to force re-render with
  defaults. Vitest covers the clear-and-rerender behaviour. Commit:
  `feat(LT-4): B1.4 T6 — Reset panel layout View-menu item`.
- [ ] **T7 — Strip dev breadcrumbs.** `git grep '[splitter]'` and
  remove. Run full test suite once more. Commit only if anything was
  stripped.
- [ ] **T8 — Docs.** `CHANGELOG.md` entry per the project's three-part
  template, `ROADMAP.md` strikethrough + position move + tag
  vacation for `[NT-8]`, `HANDOFF.md` refresh for next session,
  review section appended at the foot of this `tasks/todo.md`.
  Commit: `docs(LT-4): B1.4 — resizable splitters shipped`.

Estimated total: 2-3 hours of focused work, plus manual smoke time.

---

## T0 pre-flight audit (output)

### Quadrant testID consumers

| Consumer                                                                    | Kind        | Affected by restructure?                                                                                      |
|-----------------------------------------------------------------------------|-------------|---------------------------------------------------------------------------------------------------------------|
| [App.tsx:208,221,234,260,280](web/apps/editor/src/App.tsx)                  | Production  | **Yes** — these are the source. They move into `PanelLayout.tsx` in T3 on the same semantic inner divs.       |
| [Modal.tsx:90](web/apps/editor/src/components/Modal.tsx:90)                 | Production  | **Critical** — `document.querySelector('[data-testid="quadrant-viewport"]')` portal lookup. Risk-2 mitigation in §4 applies. |
| [property-tabs.spec.ts:57-60](web/apps/editor/tests/property-tabs.spec.ts)  | Playwright  | No — only asserts `.toBeVisible()`, which holds.                                                              |
| [Modal.test.tsx:110,149](web/apps/editor/src/components/__tests__/Modal.test.tsx) | Vitest | No — fixture stub stays unchanged.                                                                            |
| [ViewportSlot.tsx:47](web/apps/editor/src/components/ViewportSlot.tsx)      | Comment     | No — code reference; update if comment becomes wrong.                                                         |

### `getBoundingClientRect` production callsites

| Callsite                                                                                  | Target               | Affected?                                                                |
|--------------------------------------------------------------------------------------------|----------------------|---------------------------------------------------------------------------|
| [ViewportSlot.tsx:16](web/apps/editor/src/components/ViewportSlot.tsx:16)                  | quadrant-viewport    | Already `ResizeObserver`-wrapped — splitter drags fire it for free.       |
| [viewport-occlusion.ts:52](web/apps/editor/src/lib/viewport-occlusion.ts:52)               | occluding elements   | Already `ResizeObserver`-wrapped — same story.                            |
| [EmitterTree.tsx:412](web/apps/editor/src/screens/EmitterTree.tsx:412)                     | tree row             | Inner-row math, not quadrant boundary. Unaffected.                        |
| [CurveEditor.tsx:319,1106](web/apps/editor/src/screens/CurveEditor.tsx)                    | SVG canvas / overlay | Inner SVG; redraws naturally on Panel size change. Unaffected semantically. |
| [Modal.tsx](web/apps/editor/src/components/Modal.tsx)                                      | (via Modal portal)   | Driven by quadrant-viewport rect — relies on Risk-2 mitigation.           |

### Other risk callsites

- `w-80` classes only appear at the **two sites being replaced**
  ([App.tsx:193](web/apps/editor/src/App.tsx:193) and
  [App.tsx:281](web/apps/editor/src/App.tsx:281)) plus
  [ToolPanel.tsx:55](web/apps/editor/src/components/ToolPanel.tsx:55) — the
  latter is an `absolute right-0` overlay tool panel inside the viewport
  region, not part of the workspace grid. Unaffected.
- No Playwright spec asserts absolute column widths (only
  `viewport-resize.spec.ts:48` references the literal `320`, which is an
  engine viewport rect fixture).

**Conclusion:** Pre-flight clean. Plan §3.2 + §4 mitigations cover every
identified consumer. Proceed to T1.

---

## T4b — drag-flag fix (ABANDONED, reverted at commit `0610f8f`)

The pointerdown/pointerup drag-flag approach worked in vitest but had
two visible failure modes against the native host:

- **Popup hidden after some drags.** pointerup didn't always reach the
  capture listener (likely intercepted by the library's own document
  handler that fires first during capture-phase) — flag stayed `true`,
  the offscreen-park rect was never replaced.
- **Popup at pre-drag size after release.** The `subscribeSeparatorDragging(false)`
  callback ran *synchronously* inside `pointerup` before React had
  committed the post-drag layout. `getBoundingClientRect()` returned
  stale geometry, so the popup landed at the pre-drag rect.

Both fixable, but the user redirected to a stronger architecture
(below). Reverted at `0610f8f` before any further patching to keep
the option-B re-architecture clean.

---

## 7. T4c — popup spans window, scene-rect drives alpha mask (★★★)

User-directed re-plan after T4b proved fragile. **User picked
popup-rect aspect** for the camera frustum (see questionnaire
below). This is the simpler shape:

- The engine popup HWND occupies the WebView's main-row area at all
  times. Splitter drag no longer resizes the popup.
- The engine renders at FULL popup backbuffer size with popup aspect
  ratio — **Engine code is unchanged**. The D3D9 device is sized to
  the popup (only changes on window resize); the camera frustum uses
  the popup aspect.
- `AlphaCompositor` reads a **scene rect** (the centre-quadrant rect
  in popup-local coords) and stamps `alpha=0` for the four bands
  *outside* the scene rect. Layered-window compositing makes those
  bands transparent for **both** rendering AND hit-testing (verified
  at [HostWindow.cpp:835](src/host/HostWindow.cpp:835): `WS_EX_LAYERED`
  + `UpdateLayeredWindow(ULW_ALPHA)`). So panels behind the alpha-zero
  regions receive their own mouse events — no `SetWindowRgn` cutout
  needed.
- The user sees a centre-rect "window" into the full-frame rendered
  scene. Mouse drag in the centre rotates the camera (popup gets the
  events); mouse interactions on panels go straight to WebView2 (alpha
  zero allows hit-through on layered windows).

**Why this is correct.** Today `LayoutBroker::Apply` calls
`Engine::Reset` on every non-degenerate size change ([LayoutBroker.cpp:42-58](src/host/LayoutBroker.cpp:42-58)),
which is ~10-30 ms per frame. During a splitter drag, ResizeObserver
fires `layout/viewport-rect` per frame; the resets stack and the popup
falls behind the WebView's flex layout. After the new architecture,
`Engine::Reset` only runs on actual window-resize (rare); splitter
drags just update the alpha mask (already runs per frame, just on a
different rect).

**Why no Engine changes.** The user picked popup-rect aspect: the
camera frustum's aspect ratio is the popup's, not the centre rect's.
Engine rendering is unchanged. The "centre rect" is purely an alpha-
mask concept inside AlphaCompositor.

### 7.1 In / Out

**In**

- Popup HWND is sized to the WebView client area below the title bar
  ("main row area"). Resized only on window resize.
- New bridge surface: `layout/scene-rect`, params `{ x, y, w, h }` in
  popup-local pixel coords.
- `Engine` exposes `SetSceneViewport(x, y, w, h)`. Wraps
  `IDirect3DDevice9::SetViewport` and caches the rect so RenderPass
  honours it across calls. Camera aspect = `w / h`.
- `AlphaCompositor` reads the scene rect from `LayoutBroker` and
  stamps the four bands (top / bottom / left / right of the scene
  rect) with `alpha=0` per composite pass, *before* the existing
  occlusion stamps.
- `LayoutBroker` gains a paired API: `SetSceneRect(x, y, w, h)`
  alongside the existing `Apply(x, y, w, h)` which keeps the
  popup-resize semantics. New scene-rect updates do **NOT** trigger
  `Engine::Reset`.
- React's `ViewportSlot` continues to track the `quadrant-viewport`
  div but now dispatches `layout/scene-rect`, not `layout/viewport-rect`.
- One new top-level dispatcher in `AppShell` (or a new
  `ViewportShell` component) tracks the main-row container and
  dispatches `layout/viewport-rect` once per resize. Cleaner: AppShell
  could just dispatch once at mount + on `window.resize`.

**Out**

- No change to the React PanelLayout / splitter mechanism itself
  (T0–T5 stay shipped as-is).
- No change to `viewport/occlude` (existing cutouts for tool panels,
  Modal backdrop, menubar dropdowns all keep working — they overlap
  the scene rect, which they did before too).
- Camera aspect is the **scene-rect** aspect, *not* the popup
  backbuffer aspect. The non-scene area of the backbuffer is rendered
  but masked to alpha=0; it's wasted pixels but trivially cheap on
  any GPU.
- No new persistence — scene-rect lives in popup memory only;
  derived from the same `quadrant-viewport` DOM rect we already
  observe.

### 7.2 What the codebase already gives us

- `LayoutBroker` already separates "viewport rect" from "occlusion
  rects" — we just split the former into "popup rect" (rare) and
  "scene rect" (frequent).
- `AlphaCompositor::Composite` already runs a per-frame DIB stamp pass
  for occlusions. Adding four more rect stamps for the outside-scene
  bands is the same code path.
- `Engine::Reset` is already conditional on size change at
  [LayoutBroker.cpp:42](src/host/LayoutBroker.cpp:42). We just need
  `SetSceneRect` to skip the Reset entirely — set the scene rect, let
  AlphaCompositor pick it up.
- `IDirect3DDevice9::SetViewport` is already used by `Engine::Render`
  for its own render passes; exposing a "permanent scene viewport
  override" is ~30 lines.
- `MockBridge` already accepts unknown kinds gracefully; the schema
  addition is a one-liner.

### 7.3 C++ surface changes (file by file)

**`src/host/LayoutBroker.h` / `.cpp`** — split state into
`PopupRect` (drives SetWindowPos + Engine::Reset path, rare) and
`SceneRect` (drives SetViewport + AlphaCompositor mask, frequent).
New method `SetSceneRect(x, y, w, h)`. The existing `Apply()`
keeps its semantics (the new top-level dispatcher uses it for
popup-rect updates). `GetSceneRect()` getter for the compositor.

**`src/Engine.cpp`** — `SetSceneViewport(x, y, w, h)` that:

  - sets `m_sceneViewportX/Y/W/H` instance state
  - on next `RenderPass`, applies `IDirect3DDevice9::SetViewport`
    with the rect for the actual scene-rendering passes (skip for
    fullscreen clears, etc.)
  - computes camera aspect from `w / h` instead of swap-chain
    backbuffer aspect.

**`src/host/AlphaCompositor.cpp`** — in `Composite`, before the
existing occlusion stamping, stamp four rectangles for the bands
outside the scene rect:

  - top band: `(0, 0, dibW, sceneY)`
  - bottom band: `(0, sceneY+sceneH, dibW, dibH - sceneY-sceneH)`
  - left band: `(0, sceneY, sceneX, sceneH)`
  - right band: `(sceneX+sceneW, sceneY, dibW-sceneX-sceneW, sceneH)`

Hard alpha=0 stamps (no smoothstep) — these are the popup's parent
chrome area, the WebView2 paints whatever DOM is at those screen
coords. The existing smoothstep cutouts continue to stamp on top
for tool panels / modal backdrop inside the scene rect.

**`src/host/BridgeDispatcher.cpp`** — new handler:

  ```cpp
  if (kind == "layout/scene-rect") {
      int x = params.value("x", 0);
      int y = params.value("y", 0);
      int w = params.value("w", 0);
      int h = params.value("h", 0);
      m_layout.SetSceneRect(x, y, w, h);
      m_engine->SetSceneViewport(x, y, w, h);
      sendOk(json::object());
      return res;
  }
  ```

**`src/host/HostWindow.cpp`** — on `WM_SIZE`, compute the popup HWND
target rect (= WebView's client area minus title bar) and call
`LayoutBroker::Apply` with it. Replaces / augments the existing
window-resize handling so that the popup is sized to the main row
area on every resize, not driven by React's quadrant-viewport rect.

### 7.4 React surface changes

- `web/packages/bridge-schema`: add `layout/scene-rect` to the schema.
- `web/apps/editor/src/bridge/mock.ts` (or wherever MockBridge handles
  unknown kinds): stub case logs + returns `{}`.
- `web/apps/editor/src/components/ViewportSlot.tsx`: change
  `kind: "layout/viewport-rect"` → `kind: "layout/scene-rect"`. The
  rect math stays identical (DOM rect of `quadrant-viewport` × DPR).
- `web/apps/editor/src/App.tsx`: add a one-time `useEffect` that
  dispatches `layout/viewport-rect` for the main-row container. Could
  also be a new `ViewportShell` wrapper — TBD during impl.
- `web/apps/editor/src/components/__tests__/Modal.test.tsx`:
  no change expected — the snapshot path's quadrant-viewport rect is
  still authoritative for the snapshot crop.
- `web/apps/editor/tests/viewport-resize.spec.ts`: update the
  expected message kind. Check this carefully — it asserts a
  sequence of `layout/viewport-rect` calls.

### 7.5 Risks named up front + mitigations

**Risk A — D3D9 device backbuffer size vs SetViewport.** The
backbuffer remains popup-sized (whole main-row area), so the device
sees a stable size and `Engine::Reset` doesn't fire on splitter drag.
`SetViewport` constrains where rasterization happens; pixels outside
the scene rect are whatever the previous frame's contents were
(undefined) and get masked by AlphaCompositor before
`UpdateLayeredWindow`. **Mitigation:** ensure AlphaCompositor masks
the outside-scene bands BEFORE the cutout pass — never present
undefined pixels.

**Risk B — Camera frustum on aspect change.** When scene rect
changes, the camera aspect changes. Today the user already sees the
frustum recompute on window resize; the new behaviour is the same
recompute on splitter drag — likely fine, but worth confirming
with a slow drag to see if any one-frame "scene snap" happens.
**Mitigation:** `SetSceneViewport` is synchronous within the host's
WM_PAINT loop — the next rendered frame uses the new frustum
immediately. No async snap.

**Risk C — Tool panel occlusion is now redundantly covered.** A tool
panel overlay (Lighting / Bloom) sits inside the scene rect. Its
existing `useViewportOcclusion` cuts a feathered hole. The new
outside-scene mask doesn't touch the inside of the scene rect, so
the existing path continues to drive tool panel cutouts. **No
mitigation needed** — re-verify by opening a tool panel during
manual smoke.

**Risk D — Modal frosted-glass snapshot crop.** B1.3.1.1's modal
backdrop snapshots the engine viewport. The snapshot is taken from
the `m_lastRawDib` cache, which is the FULL popup backbuffer (now
main-row sized, not centre-rect sized). The modal's image element
sizes to the `quadrant-viewport` div's rect. If the cached DIB
includes alpha-masked pixels from the new outside-scene bands, the
snapshot will look weird at the edges. **Mitigation:** cache the
DIB AFTER the alpha-mask pass (so the cached image already has
outside-scene = alpha 0), and have the snapshot crop the cached DIB
to the scene rect before encoding to PNG.

**Risk E — Spawner toggle invalidates scene aspect.** Toggling
Spawner changes the centre column from 60% to 80% of the window
width, so the scene rect resizes. This is the same as a splitter
drag for the purposes of `SetSceneViewport` — no special handling
needed.

**Risk F — `layout/viewport-rect` is used by `viewport-resize.spec.ts`.**
Re-purposing the channel name breaks that spec. **Mitigation:** keep
`layout/viewport-rect` as the popup-rect dispatch (now driven by
AppShell, not ViewportSlot). The spec asserts the host remains
responsive across a sequence of popup-rect resizes — still meaningful
under the new architecture; just driven by window resize, not by
RO on the quadrant.

**Risk G — Re-architecture scope drift.** This is bigger than B1.4's
original spec. **Mitigation:** dispatch as a separate sub-task chunk
T4c.1 through T4c.6 below, each shippable independently, each with
its own commit. Manual smoke after T4c.5; full test sweep after
T4c.6.

### 7.6 Testing & verification

**Manual checklist (happy paths)**

- [ ] Window resize: popup, scene rect, and panels all line up.
- [ ] Splitter drag left↔centre: scene shrinks/grows smoothly, no
      popup overlap on either side.
- [ ] Splitter drag centre↔spawner: same.
- [ ] Splitter drag viewport↔curve: scene height changes; aspect
      updates smoothly.
- [ ] Spawner toggle off → on → off: scene rect transitions
      correctly each time, no popup overlap.
- [ ] Camera rotation drag in the centre still works.
- [ ] Open Modal (About): frosted-glass backdrop still aligns with
      the (possibly resized) centre rect.
- [ ] Open Lighting tool panel: occlusion cutout still feathers
      correctly over the engine viewport pixels.
- [ ] Reload: scene rect is restored from the persisted layout
      ratios, no flash of misalignment.

**Edge cases**

- [ ] Toggle Spawner off while a tool panel is open inside the
      scene rect — tool panel re-occludes correctly at the new scene
      rect.
- [ ] Drag splitter ALL THE WAY to a min — scene rect approaches a
      narrow band; camera aspect stays sane.
- [ ] Window resize during an open Modal — snapshot was taken
      pre-resize; visual artefact tolerable.

**Test suites**

- [ ] Vitest: stays at 290 + N (N TBD — likely +2 for the
      new bridge surface stub case, +1 for ViewportSlot dispatch
      message kind).
- [ ] Playwright: `viewport-resize.spec.ts` updated to assert
      `layout/viewport-rect` is sent on **window** resize (not
      splitter), AND `layout/scene-rect` on splitter drag. Net
      count likely 89 + 1.
- [ ] MSBuild Debug x64 — Engine + LayoutBroker + AlphaCompositor +
      BridgeDispatcher + HostWindow all touched; preexisting LIBCMTD
      warning should be the only one.

### 7.7 Task list (post-questionnaire — 5 sub-tasks, Engine untouched)

- [ ] **T4c.1 — Bridge schema + MockBridge.** Add
  `layout/scene-rect` to `packages/bridge-schema/src/index.ts`,
  stub case in MockBridge. Vitest run to confirm typecheck +
  schema lint pass. Commit: `chore(LT-4): B1.4 T4c.1 — add
  layout/scene-rect to bridge schema`.
- [ ] **T4c.2 — `LayoutBroker::SetSceneRect` + AlphaCompositor band
  stamps.** New state + getter on `LayoutBroker` (no impact on
  `Apply()` semantics). `AlphaCompositor::Composite` stamps the
  four outside-scene bands (top / bottom / left / right of the
  scene rect) with hard `alpha=0` *before* the existing occlusion
  smoothstep pass. With no caller yet, the band stamps are no-ops
  (scene rect defaults to full popup → zero bands). Commit:
  `feat(LT-4): B1.4 T4c.2 — LayoutBroker scene-rect + compositor band masks`.
- [ ] **T4c.3 — BridgeDispatcher handler.** Wire
  `layout/scene-rect` to `m_layout.SetSceneRect`. At this point
  sending the message via DevTools should visibly mask out the
  popup pixels outside the scene rect. Commit:
  `feat(LT-4): B1.4 T4c.3 — layout/scene-rect bridge handler`.
- [ ] **T4c.4 — React rewire.** Flip `ViewportSlot` to dispatch
  `layout/scene-rect` instead of `layout/viewport-rect`. Add a new
  `useEffect` in AppShell that tracks the main-row container and
  dispatches `layout/viewport-rect` once on mount + on
  `window.resize`. Update `tests/viewport-resize.spec.ts` to
  assert the new channel split. Vitest + Playwright sweeps.
  Commit: `feat(LT-4): B1.4 T4c.4 — ViewportSlot dispatches scene-rect; AppShell drives popup-rect`.
- [ ] **T4c.5 — Modal snapshot crop.** Update
  `AlphaCompositor::CaptureSnapshotPng` to crop the cached DIB to
  the current scene rect before PNG encode. The Modal's portal
  `<img>` continues to size to `quadrant-viewport`. Confirm
  `Modal.test.tsx` still passes; manual smoke About dialog over a
  splitter-dragged centre rect. Commit:
  `fix(LT-4): B1.4 T4c.5 — Modal snapshot crops to scene rect`.

After T4c.5, manual smoke each item in §7.6. If clean, resume
T6 → T8 as originally planned.

### 7.8 User decisions (questionnaire, 2026-05-21)

- **Camera aspect:** popup-rect (not scene-rect). Camera frustum
  is the full popup's aspect; the centre rect is purely an alpha
  mask. Visual result: rendered scene extends behind the panels,
  user sees a centre-rect "window" into a larger 16:9-ish frame.
- **Modal snapshot:** crop-and-trust. One snapshot at modal open,
  cropped to the scene rect that existed at that moment. If user
  drags a splitter while a modal is open, the backdrop may drift
  relative to the new layout — documented as a known limitation,
  unusual gesture.
- **Ordering:** T4c first (regression fix blocks B1.4 ship), then
  T6 (menu item), then T8 (docs).

---

## Review (filled in after T8)

*Empty — to be filled in after work completes.*
