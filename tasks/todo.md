# LT-4 Phase 4.1 — Fix dispatch 5: Marquee select + MenuBar restructure

## Goal & scope

Close findings #4 (no marquee select on curve editor) and #5 (top-level
Emitters + Mods menus missing). Polish dispatch — one new CurveEditor
interaction + a menubar reshuffle.

**In:**
- Marquee select on CurveEditor in Select mode (rubber-band rectangle
  → keys inside ⇒ selection; shift-held appends; Esc cancels).
- MenuBar restructure to legacy order **File / Edit / Emitters / Mods
  / View / Help**.
- New top-level `Emitters` menu (New Emitter submenu, Rename, Rescale,
  Spawner, plus deferred items grayed out).
- Promote `Mods` from Tools-submenu to top-level (placeholder list
  stays).
- Move `Lighting…` + `Bloom Settings…` from Tools to View.
- Remove `Tools` menu entirely.
- New bridge call `emitters/add-root` (no params, returns `{ newId }`)
  wrapping `ParticleSystem::addRootEmitter()` — option 1 from spec.
- Atom for menu→tree-rename plumbing (`tree-action.ts`).

**Out:**
- Toggle Visibility / Show All / Hide All wiring (per-row eye affordance
  + bridge calls deferred to future polish batch). Items rendered
  disabled with TODO comments.
- Reset Camera implementation (disabled + TODO).
- Reset View Settings (already disabled).
- Any D3D viewport work (Fix dispatch 4).
- Property panel components (FD1-3 frozen).

## What the codebase gives us

- `CurveEditor.tsx` — existing pointer handlers (`startDrag` on key,
  `onCanvasPointerDown` on backdrop for Insert-mode adds), the
  `eventToViewBox()` helper, `setPointerCapture` guards for jsdom,
  `DRAG_SLOP` constant for click-vs-drag detection.
- `TrackEditor.tsx` (parent) — owns `selectedKeyTimes` state +
  `handleCanvasClick` (currently clears on canvas click). We'll thread
  a `onCanvasMarqueeSelect(times, shift)` callback through.
- `MenuBar.tsx` — current Radix Menubar with 5 top-level menus; the
  TRIGGER/CONTENT/ITEM Tailwind constants + Hint/CheckSlot helpers
  + the `todo()` helper for placeholder items.
- `tree-context.ts` — Zustand atom for Rescale Emitter dialog target.
  We'll reuse it for Rescale Emitter menu item.
- `tool-panel.ts` — `setOpenToolPanel("lighting" | "bloom" | "spawner"
  | ...)` for the View / Emitters menu items.
- `EmitterTree.tsx` — owns inline rename (local state + `beginEdit`).
  Triggered by F2 / dbl-click / context-menu Rename. We'll add a tiny
  action atom that EmitterTree subscribes to and the menu writes into.
- `BridgeDispatcher.cpp:2540` — `emitters/add-lifetime-child` handler
  is the pattern template for `emitters/add-root` (parameter-less +
  emits both events).
- `ParticleSystem.h:273` — `addRootEmitter(const Emitter& = {})` is
  public; no header change.
- `mock-state.ts:459` — `addLifetimeChildEmitter` is the template for
  the mock helper.

## Architecture / implementation approach

### Marquee select

**State (local to CurveEditor):**
```ts
const [marquee, setMarquee] = useState<{
  startX: number; startY: number;   // viewBox-space anchor
  currX: number; currY: number;     // viewBox-space cursor
  shift: boolean;                   // shift held at marquee-start
  pointerId: number;
} | null>(null);
```
Held as `useState` (not a ref) so the rectangle re-renders without a
separate render-tick state. Stays component-local — never leaks into
Zustand.

**Pointer-event sequence:**
1. **`onCanvasPointerDown`** (on backdrop `<rect>`): if `insertMode` →
   existing Insert-mode-add path. Else (Select mode): record start
   coords + shift state + pointerId, set marquee state, capture pointer.
2. **`onPointerMove`** (on SVG): if marquee active + matching pointerId
   → update `currX/currY` (via `eventToViewBox`). The existing drag
   branch still wins when `dragRef.current !== null` (key drag takes
   priority — they can't be active simultaneously since marquee only
   starts on the backdrop).
3. **`onPointerUp`** (on SVG): if marquee active → compute selected
   times via inclusive `(time, value) ∈ rect` test in viewBox space
   (rectangle is in viewBox units; project each key's `time` →
   `x`, `value` → `height - y` and check `xMin ≤ x ≤ xMax && yMin ≤ y
   ≤ yMax`). Call `onCanvasMarqueeSelect(times, shift)`. Clear marquee.
4. **Esc keydown** (window-level listener attached only while marquee
   active): cancel — clear marquee state without firing the callback.

**Inclusivity rule:** a key is selected when its projected `(x, y)`
satisfies `xMin ≤ x ≤ xMax AND yMin ≤ y ≤ yMax` in viewBox units
(with `xMin = min(startX, currX)` etc.). Inclusive on both ends; a
key exactly on the rect edge is selected.

**Empty-canvas-click semantics:**
- In Select mode, the existing `onCanvasClick` (which fires from
  the backdrop `onClick` handler) currently clears selection. With
  marquee in place: pointer-down starts the marquee; if there's no
  drag past `DRAG_SLOP` between down and up, treat as "click" — clear
  selection (preserving FD3 behaviour). The cleanest implementation:
  if marquee never grew past slop, fire `onCanvasClick`-equivalent at
  pointer-up.

**Render:**
```tsx
{marquee && (
  <rect
    data-testid="curve-marquee"
    x={Math.min(marquee.startX, marquee.currX)}
    y={Math.min(marquee.startY, marquee.currY)}
    width={Math.abs(marquee.currX - marquee.startX)}
    height={Math.abs(marquee.currY - marquee.startY)}
    fill="rgb(14 165 233 / 0.15)"
    stroke="#0EA5E9"
    strokeDasharray="4 4"
    strokeWidth={1}
    pointerEvents="none"
  />
)}
```

**TrackEditor wiring:**
```ts
const handleCanvasMarqueeSelect = useCallback(
  (times: number[], shift: boolean) => {
    setSelectedKeyTimes((prev) => {
      if (shift) {
        const next = new Set(prev);
        for (const t of times) next.add(t);
        return next;
      }
      return new Set(times);
    });
  },
  [],
);
```

### MenuBar restructure

Final top-level order: **File / Edit / Emitters / Mods / View / Help**.

**Emitters menu items:**
- New Emitter ▶ (submenu)
  - Root Emitter → `emitters/add-root { }` (newly added bridge call)
  - Lifetime Child → `emitters/add-lifetime-child { parentId: primary }`
    (disabled when no primary selected)
  - Death Child → `emitters/add-death-child { parentId: primary }`
    (disabled when no primary selected)
- Rename Emitter (F2 hint) → fires `useTreeActionStore.getState()
  .requestRename(primary)`; EmitterTree's effect catches the request,
  begins inline edit. Disabled when no primary.
- Rescale Emitter… → `useTreeContextStore.getState()
  .openDialog("rescale", primary)`. Disabled when no primary.
- ─── separator
- Toggle Visibility (disabled, TODO)
- Show All Emitters (disabled, TODO)
- Hide All Emitters (disabled, TODO)
- ─── separator
- Spawner… (F7 hint) → `setOpenToolPanel("spawner")`.

**Mods menu (promoted to top-level):**
- Single disabled `(none)` placeholder item — same as today's Tools >
  Mods submenu content. Detection wiring stays out-of-scope.

**View menu finalised (existing items + Lighting + Bloom Settings
moved in):**
- Ground (existing toggle)
- Bloom Settings… → `setOpenToolPanel("bloom")` (moved from Tools)
- Lighting… → `setOpenToolPanel("lighting")` (moved from Tools)
- Bloom (existing toggle, disabled when !bloomAvailable)
- ─── separator
- Pause (existing toggle)
- Step Forward (existing, disabled when !paused)
- Reset Camera (disabled, TODO)
- ─── separator
- Reload Shaders / Reload Textures (existing)
- ─── separator
- Heat Debug (existing toggle)
- Background… → `setOpenToolPanel("background")` (already wired via
  prop)
- Ground Texture… → `setOpenToolPanel("ground")` (already wired)
- Reset View Settings (already disabled with todo)

**Tools menu:** removed entirely. Props `onOpenLightingPanel`,
`onOpenBloomPanel`, `onOpenSpawnerPanel`, `onOpenGroundTexturePanel`,
`onOpenBackgroundPanel` stay in the Props signature (called from new
locations) — no caller-side change.

### `tree-action.ts` atom (new file)

Minimal:
```ts
import { create } from "zustand";

type TreeActionStore = {
  /** When non-null, EmitterTree should begin inline rename for this
   *  emitter id. EmitterTree clears this back to null after consuming. */
  renameRequest: number | null;
  requestRename: (id: number) => void;
  consumeRenameRequest: () => void;
};

export const useTreeActionStore = create<TreeActionStore>((set) => ({
  renameRequest: null,
  requestRename: (id) => set({ renameRequest: id }),
  consumeRenameRequest: () => set({ renameRequest: null }),
}));
```

EmitterTree subscribes via a `useEffect` that watches `renameRequest`
+ calls `beginEdit(id, name)` + `consumeRenameRequest()`.

### `emitters/add-root` bridge call

**Schema (`bridge-schema/src/index.ts`):**
```ts
| { kind: "emitters/add-root"; params: Record<string, never> }
// ...
R extends { kind: "emitters/add-root" } ? { newId: number } :
```

**Mock (`mock.ts` + `mock-state.ts`):**
- `addRootEmitterMock(tree): { tree, newId }` — append a new empty
  root with `role: "root"`, `linkGroup: 0`, `visible: true`. Always
  succeeds.
- mock.ts handler: similar to add-lifetime-child.
- Dirty flag list: add `"emitters/add-root"`.

**C++ (`BridgeDispatcher.cpp`):**
```cpp
if (kind == "emitters/add-root") {
    if (m_pParticleSystem == nullptr || !*m_pParticleSystem) {
        sendOk(json{{"newId", -1}});
        return res;
    }
    captureUndo();
    auto* e = (*m_pParticleSystem)->addRootEmitter();
    sendOk(json{{"newId", e ? static_cast<int>(e->index) : -1}});
    markDirty();
    EmitEngineStateChanged();
    EmitEmittersTreeChanged();
    return res;
}
```

## Risks named up front

1. **Marquee + key-click conflict.** Risk: pointer-down on a key
   currently calls `startDrag` (key drag); pointer-down on backdrop
   would start a marquee. If both bind to the same SVG `onPointerMove`
   /`onPointerUp` handler, the move handler needs to branch on which
   gesture is active.
   *Mitigation*: `dragRef.current !== null` takes priority in
   `onPointerMove`; if no key drag is active and marquee state is
   non-null, run the marquee branch. They're mutually exclusive
   because marquee only starts on the backdrop and key-drag on a
   circle. Document with a comment.

2. **Empty-canvas click clear-selection regression.** Risk: replacing
   the existing `onCanvasClick` path with marquee might lose the
   "click empty area to clear" UX.
   *Mitigation*: if pointer never moved past `DRAG_SLOP` between
   down + up, call `onCanvasClick?.(event)` from `onPointerUp` so the
   existing clear-selection handler still fires. Tested via a Vitest
   spec.

3. **Esc handler leak.** Risk: a window-level `keydown` listener
   could leak if the component unmounts mid-marquee.
   *Mitigation*: attach + detach in a `useEffect([marquee !== null])`
   so the listener is only mounted while marquee is active and the
   cleanup tears it down on unmount.

4. **MenuBar prop order / test brittleness.** Risk: existing
   Playwright `menu-bar.spec.ts` asserts `["File", "Edit", "View",
   "Tools", "Help"]` — Tools is gone.
   *Mitigation*: update the assertion to `["File", "Edit", "Emitters",
   "Mods", "View", "Help"]`. Add a Vitest spec asserting the same
   in jsdom (faster feedback loop than Playwright).

5. **`emitters/add-root` C++ wiring across Mock + Host.** Risk: the
   mock + host could drift if either gets the success/failure
   semantics wrong.
   *Mitigation*: contract test exercises round-trip
   (request → response shape + `emitters/tree/changed` emission).
   Native test confirms host parity.

6. **Rename plumbing via atom.** Risk: a single-shot atom value can
   race if EmitterTree hasn't mounted yet (e.g. user opens menu before
   the tree finishes loading).
   *Mitigation*: the atom holds the requested id until EmitterTree
   consumes it (no auto-expiry). EmitterTree's effect uses
   `flatRows.find(...)` and silently ignores requests that don't
   resolve to a row — same defensive guard as the existing F2
   handler. Worst case = a no-op, not a crash.

7. **Inclusive vs exclusive marquee bound at edges.** Risk: a key on
   the exact rect boundary could be missed depending on float-precision
   in `eventToViewBox`.
   *Mitigation*: use `<=` on both ends explicitly. Test with keys
   placed exactly at `(0, 0)` / `(100, 1)`.

## Testing & verification

**Vitest (target +5-7 → 173+):**
- `CurveEditor.test.tsx`:
  1. Pointer-down on backdrop in Select mode + move + up — collects
     keys inside the rect and fires `onCanvasMarqueeSelect`.
  2. Shift held during marquee passes `shift: true` to the callback.
  3. Esc keydown during active marquee cancels — callback NOT fired,
     marquee `<rect>` removed.
  4. Marquee inactive in Insert mode (pointer-down still routes to
     `onCanvasAdd`).
- `MenuBar.test.tsx`:
  1. Top-level triggers render in order `[File, Edit, Emitters, Mods,
     View, Help]`.
  2. No `Tools` trigger present.
  3. Opening Emitters menu shows New Emitter / Rename / Rescale /
     Spawner items.
  4. Opening View menu shows `Lighting…` + `Bloom Settings…`.
- (optional) `bridge-contract.test.ts`: `emitters/add-root` round-trip
  returns `newId`, emits tree-changed.

**Playwright (target +1-2 → 76+):**
- Update existing "All 5 menu triggers" → "All 6 menu triggers with
  Emitters + Mods" (the existing spec must not regress).
- New spec: marquee drag on the curve editor in Select mode selects
  keys (use `page.mouse.down/move/up`).

**Build / native gate:**
- `pnpm build` → 0
- `pnpm test` → 173+ passing
- MSBuild x64 Debug → 0
- `pnpm test:native` → 76+ passing

## Subagent decision: `emitters/add-root`

**Picked: option 1 (new bridge call).** Reason: the C++ side is a
trivial wrapper (the method is public + parameter-less), the mock
helper is ~10 lines, and the user-facing surface ("New Root Emitter"
menu item works) is materially better than gray-out. Option 3
(reuse duplicate) would create a copy of an existing root, which
doesn't match the legacy "New Root Emitter" semantics (creates an
*empty* root). Option 1 wins on parity.

## Plan summary for the user

Two deliverables in one commit:

1. **Marquee select** — rubber-band rectangle on empty curve editor
   canvas in Select mode. Inclusive `(time, value) ∈ rect` test at
   pointer-up. Shift appends; Esc cancels. Click-to-clear preserved
   when there's no drag past slop.

2. **MenuBar restructure to legacy order** — File / Edit / Emitters
   / Mods / View / Help. Tools removed (Lighting + Bloom Settings →
   View; Spawner → Emitters). Emitters gets New Emitter submenu +
   Rename + Rescale + Spawner + 3 disabled visibility items. Mods
   promoted to top-level (placeholder list unchanged). New
   `emitters/add-root` bridge call wired through mock + C++.

Biggest risks: marquee/key-drag pointer routing (mitigated by
`dragRef` priority); rename plumbing race (mitigated by atom +
defensive guard); Playwright menu-bar trigger spec update.

## Tasks

- [ ] Schema: add `emitters/add-root` Request + ResponseFor entries.
- [ ] Mock: add `addRootEmitterMock` to `mock-state.ts`; wire handler
      in `mock.ts`; add to dirty-flag list.
- [ ] C++: add `emitters/add-root` handler in `BridgeDispatcher.cpp`.
- [ ] Atom: `tree-action.ts` with `renameRequest` channel.
- [ ] EmitterTree: subscribe to `renameRequest`, call `beginEdit`,
      consume.
- [ ] CurveEditor: add marquee state + handlers + SVG `<rect>`.
- [ ] TrackEditor: pass `onCanvasMarqueeSelect` callback (append or
      replace based on shift).
- [ ] MenuBar: restructure top-level order; remove Tools; add
      Emitters + Mods top-level; move Lighting + Bloom Settings to
      View. Wire Emitters items via existing atoms + new add-root.
- [ ] Vitest specs for marquee (4 tests) + MenuBar (4 tests).
- [ ] Playwright: update menu-bar trigger spec; new marquee spec.
- [ ] Optional: bridge-contract spec for `emitters/add-root`.
- [ ] Run all four verification gates green.
- [ ] Commit.

## Review

All four verification gates green:

- `pnpm build` → 0 (no TypeScript errors).
- `pnpm test` → 180 passing (was 168, +12: marquee +5, MenuBar +5,
  bridge-contract +1; existing CurveEditor specs untouched).
- MSBuild Debug x64 → 0 warnings, 0 errors.
- `pnpm test:native` → 76 passing (was 74, +2: new marquee
  Playwright spec + new emitters/add-root spec; 3 Tools-menu specs
  updated to point at the new menu locations).

### What landed

**Marquee select on CurveEditor.**

State shape: `MarqueeState { startX, startY, currX, currY,
clientStartX, clientStartY, shift, pointerId, target, movedPastSlop }`
in viewBox space. Held as `useState` (renders update the rectangle
naturally). Pointer-event sequence: `onCanvasPointerDown` on the
backdrop in Select mode captures the pointer and seeds marquee
state; `onPointerMove` on the SVG (with `dragRef.current === null`
priority guard) grows `currX/currY` and flips `movedPastSlop`;
`onPointerUp` collects keys whose projected `(x, y)` satisfies
`xMin ≤ x ≤ xMax && yMin ≤ y ≤ yMax` inclusively, fires
`onCanvasMarqueeSelect(times, shift)`, clears the state. When the
gesture never moves past `DRAG_SLOP` (1.5 viewBox units) pointer-up
calls `onCanvasClick` instead — preserves the FD3 "click empty
canvas to clear selection" UX. A `marqueeConsumedClickRef` flag
prevents the backdrop's synthetic `onClick` from double-firing the
clear path. Esc keydown (window listener, mounted only while
marquee is active) cancels — clears the rectangle, leaves selection
untouched. Insert mode is unchanged: backdrop pointer-down still
routes to `onCanvasAdd`.

TrackEditor's new `handleCanvasMarqueeSelect(times, shift)`
replaces or appends to `selectedKeyTimes` based on shift.

**MenuBar restructure.**

Final top-level order: **File / Edit / Emitters / Mods / View /
Help**. Tools menu removed. New Emitters menu wires:
- New Emitter ▶ Root → `emitters/add-root { }`; Lifetime Child →
  `emitters/add-lifetime-child { parentId }`; Death Child →
  `emitters/add-death-child { parentId }`. Child items disabled
  when no primary selected.
- Rename Emitter (F2) → `requestEmitterRename(primary)` →
  `tree-action` atom → EmitterTree's effect calls `beginEdit`.
- Rescale Emitter… → `useTreeContextStore.getState().openDialog(
  "rescale", primary)` — reuses the existing modal flow.
- Spawner… (F7) → existing `onOpenSpawnerPanel` prop (which
  fires `setOpenToolPanel("spawner")`).
- Toggle Visibility / Show All / Hide All — rendered disabled
  with TODO comments.

Mods promoted to top-level (placeholder list unchanged). Lighting
+ Bloom Settings moved into View. Reset Camera + Reset View
Settings stay disabled placeholders.

**`emitters/add-root` bridge call.**

Option 1 chosen. Schema: `kind: "emitters/add-root", params: {}` →
`{ newId: number }`. Mock helper `addRootEmitterMock` in mock-state.ts
appends an empty root with `role: "root"`. C++ handler in
BridgeDispatcher.cpp wraps `(*m_pParticleSystem)->addRootEmitter()`,
captures undo, returns `child->index`, emits both
`engine/state/changed` + `emitters/tree/changed`. Round-trip
contract test confirms append + role + linkGroup + child count.

### Design surprises

1. **Backdrop click double-fire** — in real browsers, after a
   captured pointer-up the backdrop still receives a synthetic
   `click` event. Without suppression, both the marquee pointer-up
   no-slop branch AND the backdrop's `onClick` would fire
   `onCanvasClick`. Fixed with `marqueeConsumedClickRef` consumed
   in the backdrop onClick.
2. **Pointer-move priority** — key drag (`dragRef.current !== null`)
   and marquee must not run simultaneously. In practice they can't
   (key drag starts on circle; marquee starts on backdrop), but the
   move handler explicitly checks `dragRef.current === null` before
   running the marquee branch as defensive coverage.
3. **Hit-test inclusivity** — `xMin ≤ x ≤ xMax && yMin ≤ y ≤ yMax`
   with `<=` on both ends so a key exactly on the rect boundary is
   selected. Documented in the comment block above the hit-test
   loop.
4. **Marquee + EmitterTree rename plumbing** — chose a dedicated
   tiny `tree-action.ts` atom over extending `tree-context.ts`. The
   two stores cleanly separate "open a modal" from "trigger inline
   rename inside the tree" — different lifetimes, different
   ownership.
5. **3 existing native tests referenced "Tools" menu** — updated
   them to the new locations (Lighting → View, Spawner → Emitters)
   instead of leaving stubs.

### Deferred items

- Toggle Visibility / Show All / Hide All — in the menu but
  disabled, with TODO comments. Per-row eye-icon affordance + the
  emit-toggle bridge call are out of FD5 scope.
- Reset Camera — in the menu but disabled with TODO. Bridge call
  + C++ handler deferred.
- Reset View Settings — was already disabled; left in place.

### Verification proof (final tails)

`pnpm build`:
```
✓ 1878 modules transformed.
✓ built in 3.14s
```

`pnpm test`:
```
Test Files  28 passed (28)
     Tests  180 passed (180)
```

`MSBuild`:
```
Build succeeded.
    0 Warning(s)
    0 Error(s)
```

`pnpm test:native`:
```
76 passed (35.7s)
```
