# Screen 6 Batch A — Foundation (read-only) (2026-05-17)

## Goal & scope

**In:** 1 new read-only bridge call (`emitters/get-tracks`), right-side
EmitterPropertyPanel that appears on emitter selection, TrackEditor
shell (toolbar + lock-to combo — visual only, "Batch B" tooltips), and
a pure-presentational SVG CurveEditor sub-component. This is also the
SVG-vs-canvas profiling vehicle.

**Out:** Any interaction (click/drag/add/delete/interpolation toggle,
lock-to functional behaviour) — all deferred to Batch B / Screen 5.
No mutations. No smooth/step rendering nuance (drawn as polyline).
Legacy `TrackEditor.cpp` / `CurveEditor.cpp` untouched.

## What the codebase gives us

- `ParticleSystem::Emitter::tracks[NUM_TRACKS]` (=7) at
  [src/ParticleSystem.h:151]; each is `Track*` aliasing
  `trackContents[i]`. Track shape: `KeyMap keys` (`std::multiset<Key>`),
  `InterpolationType interpolation`.
- Track order (verified by `LinkGroup.cpp:359-362` labels): Red, Green,
  Blue, Alpha, Scale, Index, Rotation.
- Interpolation enum at [src/ParticleSystem.h:78-81]: IT_UNKNOWN=-1,
  IT_LINEAR=0, IT_SMOOTH=1, IT_STEP=2.
- BridgeDispatcher: `getEmitters()`, snapshot patterns in
  `emitters/list` at [src/host/BridgeDispatcher.cpp:1475].
- Mock fixture tree has emitters with ids 0..5.
- Existing screens / dialogs use ToolPanel pattern, Radix Select via
  `@radix-ui/react-select`.

## Architecture

**Schema** (`web/packages/bridge-schema/src/index.ts`):
- New types: `InterpolationType = "linear" | "smooth" | "step"`,
  `TrackKey = { time, value }`, `TrackDto = { name, keys, interpolation }`.
- `TRACK_NAMES` constant export array of 7 lowercase names so the React
  side has a single source of truth.
- New Request kind `emitters/get-tracks { id: number }` →
  `{ tracks: TrackDto[] }`.

**MockBridge** (`web/apps/editor/src/bridge/mock.ts`, `mock-state.ts`):
- Add a fixture-track function that generates 7 deterministic tracks
  per emitter id (seed by id so different selections show distinct
  curves). Keys typically <20 per track to match expected usage.
- Mock handler in `mock.ts` for `emitters/get-tracks`. Validates the id
  by walking the tree via `findEmitterNode`; returns
  `{ tracks: [...] }` always (empty tracks for missing ids).

**C++ host** (`src/host/BridgeDispatcher.cpp`):
- New handler: `emitters/get-tracks`. Resolve emitter by id (bounds-
  check), iterate `tracks[0..6]`, emit each `Track*`'s keys (sorted
  ascending by time — `std::multiset<Key>` already orders by time),
  and the interpolation enum mapped to wire strings. Returns
  `{ tracks: [] }` on missing emitter (graceful fallback) rather than
  ok:false — matches the read-only semantics of the contract.

**React** (`web/apps/editor/src/screens/`):
- `EmitterPropertyPanel.tsx`: subscribes to `emitters/selected` +
  `emitters/tree/changed`, reads `engine/state/snapshot` on mount for
  initial selection. When selectedEmitterId !== null, fetches tracks
  and renders `<TrackEditor tracks={tracks} />`. When null, renders
  nothing (panel is hidden — parent App.tsx handles the layout
  collapse).
- `TrackEditor.tsx`: 7 track-toggle buttons (active track = local
  state, default "red"), tool toggles (Select/Insert + interp picker +
  Delete) all disabled with title="Batch B", Radix Select for lock-to
  (per-track option list), and `<CurveEditor track={track}
  valueRange={range} />` below.
- `CurveEditor.tsx`: pure SVG. viewBox = "0 0 W H" (default 600x300).
  Renders axes, gridlines (10 ticks per axis), polyline through keys,
  circles at each key. Y inversion via per-coordinate flip
  (`H - normalisedY * H`) — simpler than a transform and keeps text
  upright if axis labels are added later.

**App.tsx layout**:
- Main row goes from `[Sidebar | Viewport]` to
  `[Sidebar | Viewport | PropertyPanel?]`. When PropertyPanel is
  visible it's a fixed-width (320px) right column; viewport flex-1
  shrinks. When hidden, viewport remains flex-1. The conditional
  mount handles the collapse cleanly — no flicker.

## Risks named up front + mitigations

1. **Radix Select in jsdom won't open during Vitest tests.** Tests
   would assert the trigger button is visible (which is enough for
   "renders per-track options" coverage — the option list is
   constructed pre-render and lives in props of `<Select.Item>`
   children that we can query as DOM nodes). Mitigation: don't try to
   open the combo in jsdom; assert structural presence and trigger
   text instead.

2. **Track order drift between C++ and React.** Mitigation: the
   `TRACK_NAMES` export in bridge-schema is the single source. Both
   the C++ test harness and React code use the same fixed-order
   names. Bridge-contract test asserts the names verbatim.

3. **SVG performance with very large key counts.** Stated as accepted
   for this batch — typical use is <20 keys/track. We render with
   plain SVG elements (no virtualisation) and revisit if profiling
   shows lag.

4. **Layout reflow when panel appears could shift the viewport size,
   triggering layout/viewport-rect updates and confusing the host.**
   Mitigation: existing layout-broker already handles dynamic
   viewport rects (sidebar already does this); the new property
   panel slot is structurally identical to the sidebar's pattern.

## Testing & verification

**Vitest (+6 specs target):**
- `bridge-contract.test.ts` (+1): `emitters/get-tracks` returns 7
  tracks; names match TRACK_NAMES verbatim; interpolation is one of
  three values; keys is an array.
- `EmitterPropertyPanel.test.tsx` (2):
  1. Renders placeholder when no selection.
  2. Renders TrackEditor when selectedEmitterId !== null.
- `TrackEditor.test.tsx` (2):
  1. Renders 7 track-toggle buttons.
  2. Clicking a track switches the active-track attribute.
- `CurveEditor.test.tsx` (1): renders polyline + N circles for
  N-key fixture.

**Playwright (+2 specs target):**
- `track-editor.spec.ts`:
  1. Selecting an emitter shows panel by `data-testid="emitter-
     property-panel"`.
  2. CurveEditor SVG renders (polyline or circle inside the panel).

**Build + native:** pnpm build, pnpm test (≥125), MSBuild Debug x64,
pnpm test:native (≥64).
