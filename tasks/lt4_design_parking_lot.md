# LT-4 — Design parking lot

Per-screen design notes for the UI overhaul. **Iterate in browser mode**
(`pnpm dev` against the MockBridge) before any native wire-up. Lock a screen
by flipping its **Design checkpoint** status from 🟡 to ✅; only then does
Phase 3.N.3 (native wire-up) become unblocked.

Status legend:
- 🟡 pending — needs design iteration
- 🟢 in progress — actively iterating
- ✅ design complete — ready for native wire-up
- ✅ wired up — native bridge connected, smoke green
- ⬛ shipped — merged to master

This file is the source of truth for "have we decided what this screen
looks like?". Future implementers read it before touching the screen's
React code. The audit doc (`tasks/lt4_ui_overhaul_audit.md`) tells them
*what the screen has to do*; this file tells them *how it should look
and feel*.

---

## Global tokens

**Design checkpoint status:** 🟡 iterating

Color / spacing / typography / density / radius / shadow primitives that
every screen inherits from. Initial values in
`web/packages/design-tokens/src/tokens.ts` (placeholders — iterate before
locking).

**Design notes / sketches:**

> _User: drop tone-of-voice references, palette pulls, density preference
> (tight / default / loose), typography pairings, etc. here as you iterate._

**Decisions locked once ✅:**

> _(empty)_

---

## Screen 1 — App shell

**Replaces:** `WinMain`, top-level window class, status-bar code in
`main.cpp`. Owns the frame around everything else.

**Design checkpoint:** ✅

**Wire-up:** ✅

**Current behaviour (legacy):**

Top-level resizable window. Title bar shows the loaded file path with a
trailing `*` when dirty. Status bar at bottom shows FPS, emitter count,
particle count, instance count (updated 4 Hz). Menu bar + toolbar +
emitter tree (left) + property panel (right) + D3D9 viewport
(center-right) fill the client area. Min size 860×750. Bounded by
`MIN_WINDOW_WIDTH` / `MIN_WINDOW_HEIGHT` in `main.cpp`.

**Design notes / sketches:**

> _User: layout preference (resizable panes? fixed grid? dockable?),
> dark-mode default vs system, title-bar style (native vs custom), status
> bar redesign (do we even keep it? combined into a header?), where the
> viewport sits relative to side panels._

**Bridge surface used:** `stats/tick` event (subscribed). No requests
fired by this screen.

**Decisions locked once ✅:**

**Status bar layout.** 4-column readout `FPS · Emitters · Particles ·
Instances`. Dot separators between columns. Mono font (`font-mono
tabular-nums`) for the number, regular weight for the label. Height
28px (`h-7`) — matches the existing placeholder footer.

**Update cadence.** 4 Hz (250 ms `SetTimer` in `HostWindow`), matching
the legacy `FPSMeasurer` in `src/main.cpp`. FPS measured via a 32-frame
ring buffer of `GetTickCount`-based timestamps (same window as legacy).

**Separator style.** Unicode middle dot `·` (`text-neutral-700`), not a
pipe or slash. Renders as a low-contrast divider that doesn't compete
with the numbers.

**Placeholder state.** Until the first `stats/tick` arrives (browser
mode or pre-connection), each value shows `—` (em dash) in
`text-neutral-700`. Live values render in `text-neutral-300`. The colour
shift is the visual signal that the host is connected.

**Title bar.** Native Windows title bar — no custom chrome.

**Min window size.** 860×750 (legacy `MIN_WINDOW_WIDTH` /
`MIN_WINDOW_HEIGHT` constants in `src/main.cpp`).

**Dirty indicator.** Deferred to Phase 3 Screen 4 (emitter tree) —
needs real edit operations to trigger it. No dirty state in this screen.

---

## Screen 2 — Main menu

**Replaces:** `IDR_MENU1` resource + the giant `DoMenuItem` `WM_COMMAND`
switch in `main.cpp`. ~30 menu commands across File / Edit / View / Tools /
Help.

**Design checkpoint:** ✅

**Wire-up:** ✅

**Current behaviour (legacy):**

Native Win32 menu bar. Alt-key access keys, accelerator hints next to
each item (`Ctrl+S` etc.), recent-files submenu auto-rebuilt at runtime,
mod-switching submenu under Tools. Standard items: New / Open / Save /
Save As / Import Emitters / recent files / Exit; Undo / Redo / Cut /
Copy / Paste / Delete / Rescale / Clear All Particles; ground / skydome
toggles, bloom toggle, pause/step, reload shaders/textures; Tools menu
hosts the Lighting dialog launcher, the Mods submenu, the Spawner
toggle; Help menu hosts About.

**Design notes / sketches:**

> _User: native `SetMenu` vs. React-rendered menu bar — which? Recent
> files: still in File menu, or moved to a "recent files" panel? Menu
> placement: top bar (classic) or app-header dropdown (modern)? Keep
> Alt-key navigation as a hard requirement, or soft?_

**Bridge surface used.**

Request kinds fired from menu items (no new schema additions — all
existed before this screen):

- `engine/state/snapshot` — initial DTO snapshot on mount.
- `engine/set/ground { enabled }` — View › Ground toggle.
- `engine/set/bloom { enabled }` — View › Bloom toggle.
- `engine/set/paused { paused }` — View › Pause toggle.
- `engine/set/heat-debug { enabled }` — View › Heat Debug toggle.
- `engine/action/clear` — Edit › Clear All Particles.
- `engine/action/reload-shaders` — View › Reload Shaders.
- `engine/action/reload-textures` — View › Reload Textures.
- `engine/action/step-frames { frames: 1 }` — View › Step Forward.
- `undo/perform { direction: "undo" }` — Edit › Undo.
- `undo/perform { direction: "redo" }` — Edit › Redo.
- Event `engine/state/changed` — drives toggle check glyphs (Ground /
  Bloom / Pause / Heat Debug) and the Step Forward disabled state.

**Decisions locked once ✅:**

**Renderer.** React-rendered via `@radix-ui/react-menubar` (headless).
No native `SetMenu` — the React layer owns the entire menu bar. Integrated
into the existing 40 px top bar between the `AloParticleEditor` title and
the Background pill. No Alt-key navigation — deferred to Phase 4 polish.

**Trigger style.** `px-2 py-1 text-xs font-medium text-neutral-300
hover:bg-neutral-900 rounded` quiet triggers; open state: `bg-neutral-900
text-neutral-100` via Radix `data-[state=open]` attribute.

**Content style.** `min-w-[200px] bg-neutral-900 border border-neutral-800
rounded-md shadow-xl p-1 z-50`. Items: `text-xs text-neutral-200`,
hover/focus `bg-neutral-800`. Disabled: `text-neutral-600
cursor-not-allowed`. Accelerator hints: `ml-auto text-[10px]
text-neutral-500`. Separators: `h-px bg-neutral-800`.

**Toggle items.** `<Check />` (lucide-react 3.5) in a fixed-width
`size-3.5` slot to the left. Slot is always rendered (preserves indent
alignment); icon appears only when `active`. Bloom auto-disables (Radix
`disabled` prop) when `!bloomAvailable`. Step Forward auto-disables when
`!paused`.

**Background…** item calls the `onOpenBackgroundPanel` callback prop
(lifting to App.tsx's `setPanelOpen(true)`) rather than firing a bridge
request — the panel is pure React state.

**Per-menu item bucket list.**

- *File* (New / Open / Save / Save As / Import Emitters / Recent Files → /
  Exit) — all `console.log("[Menu] X — Phase 3 Screen 8")` placeholders.
  Recent Files submenu contains a single disabled `(none)` item.
- *Edit* (Undo / Redo wired; Cut / Copy / Paste / Delete disabled — Screen 4
  territory; Rescale TODO; Clear All Particles wired).
- *View* (Ground / Bloom / Pause / Step Forward / Reload Shaders / Reload
  Textures / Heat Debug all wired; Background… via callback; Reset View
  Settings TODO).
- *Tools* (Lighting… TODO; Mods → submenu with disabled `(none)`; Spawner…
  TODO).
- *Help* (About TODO).

**Out of scope (deferred).**

- Alt-key / access-key navigation — Phase 4 polish.
- File / Tools / Help real implementations — Phase 3 Screen 8.
- Cut / Copy / Paste / Delete — Screen 4 (emitter tree selection context).
- Recent Files runtime rebuild — Screen 8.
- Mods submenu auto-populate — Screen 8.

---

## Screen 3 — Toolbar

**Replaces:** main rebar toolbar (`TOOLBARCLASSNAME`) + toolbar bitmaps
in `src/Resources/toolbar1.bmp` / `toolbar2.bmp`. Buttons: New / Open /
Save / Undo / Redo / Pause / Step / Bloom toggle / Reload / Background
picker / Ground picker / others.

**Design checkpoint:** ✅

**Wire-up:** ✅

**Current behaviour (legacy):**

Horizontal toolbar below the menu. Owner-drawn buttons for color
swatches (background, ground). Click-to-pick (background, ground), with
each picker opening a custom dialog. Pause / Step are stateful toggle
buttons (pressed when paused). Bloom toggle is enabled only when
`IsBloomAvailable()` reports true. Tooltips on every button.

**Design notes / sketches:**

> _User: do we keep a toolbar at all, or move actions into the menu and
> screen-specific affordances? Icon set — keep the existing 16×15 bitmaps
> or switch to an SVG icon library (Lucide / Phosphor / Tabler)? Background
> + Ground picker buttons: keep as swatches that open dialogs, or
> something else?_

**Bridge surface used.**

- Request `engine/state/snapshot` — initial DTO read on mount.
- Request `engine/set/paused { paused }` — View-group pause/resume.
- Request `engine/action/step-frames { frames }` — View-group step.
- Request `engine/set/bloom { enabled }` — Render-group bloom toggle.
- Request `engine/action/reload-shaders` — Render-group action.
- Request `engine/action/reload-textures` — Render-group action.
- Request `undo/perform { direction }` — Edit-group undo / redo.
- Event `engine/state/changed` — drives Pause glyph / Bloom active
  state.

**Decisions locked once ✅:**

**Layout.** Horizontal toolbar below the existing top bar (which has
the "AloParticleEditor" title + Background pill) and above the main
row (sidebar + viewport + Background panel). Height 36 px (`h-9`),
`bg-neutral-950`, bottom border `border-b border-neutral-800`. Four
groups in this order: **File · Edit · View · Render**, separated by
1 px × 20 px `bg-neutral-800` dividers vertically centred.

**Button anatomy.** 28 × 28 px square (`size-7`), icon-only (no
labels), 16 px icon (`size-4`). Tooltip via HTML `title` attribute —
no floating-ui / tippy dependency. Hover state: `bg-neutral-800` +
brighter text. Disabled state: `opacity-40 cursor-not-allowed`.
Active / pressed state (Pause when paused, Bloom when enabled):
`bg-sky-500/20 text-sky-300`.

**Icon set.** `lucide-react` (~4 KB tree-shaken). Specific imports:
`FilePlus / FolderOpen / Save / Undo / Redo / Pause / Play /
StepForward / Sparkles / RefreshCw`. Legacy `toolbar1.bmp` /
`toolbar2.bmp` bitmaps are not reused.

**Group contents.**

- **File** (3 buttons): New, Open, Save. Console-log placeholders
  until Phase 3 Screen 8 (real file ops). Tooltips reference
  `Ctrl+N` / `Ctrl+O` / `Ctrl+S` to signal future intent; the
  AcceleratorBridge does not yet register those combos.
- **Edit** (2 buttons): Undo, Redo. Dispatches `undo/perform`. The
  undo stack is currently empty (no captures wired) so `applied`
  returns false until Phase 3 emitter work begins capturing
  mutations.
- **View** (2 buttons): Pause / Resume (toggle), Step Forward. The
  Pause icon flips between `<Pause />` and `<Play />` based on
  `state.paused`. Step Forward is disabled when not paused. Step
  dispatches `engine/action/step-frames { frames: 1 }`; the host
  handler does NOT broadcast `engine/state/changed` because the
  action produces zero or more state ticks via the normal render
  loop.
- **Render** (3 buttons): Bloom (toggle), Reload shaders, Reload
  textures. Bloom is dimmed when `state.bloomAvailable === false`.
  Two `RefreshCw` icons are distinguished by tooltip text only.

**Stateful buttons.** Pause and Bloom carry `aria-pressed`. All
buttons have unique `aria-label` for Playwright DOM presence checks.

**Out of scope (Screen 8 / future).**

- New / Open / Save real implementations — console TODO for now.
- Keyboard shortcuts beyond `Ctrl+Z` / `Ctrl+Shift+Z` (already
  registered with AcceleratorBridge in Task 2.4). `F8` / `Ctrl+S` /
  `Ctrl+N` / `Ctrl+O` referenced in tooltips but not wired.
- Reload-Shaders progress / spinner UI — the action fires and the
  host re-loads in the background. No status feedback.
- Background / Ground picker buttons — Background lives on the
  header pill (Task 2.3); Ground picker is its own Screen 8
  sub-screen.

---

## Screen 4 — Emitter tree

**Replaces:** `src/UI/EmitterList.cpp` (**4955 LOC** — the biggest single
chunk in the codebase). Drag-and-drop reordering, multi-select,
context menu, link-group glyph badges, checkbox visibility toggles,
inline-edit rename, parent/child hierarchy (root → lifetime / death
children).

**Design checkpoint:** 🟡 pending

**Wire-up:** 🟡 pending

**Current behaviour (legacy):**

Tree-view control on the left side. Each node has: a name, an
emitter-type glyph (visible/hidden, child-type), a link-group badge
(when grouped), a context menu (rename, duplicate, add lifetime child,
add death child, set link group, leave link group, etc.). Multi-select
via Ctrl/Shift+click. Drag-and-drop reorders siblings and re-parents.
Inline-edit rename via F2 / double-click. Has its own embedded toolbar
(add / delete / move-up / move-down / link group). Talks to the
property panel on selection change.

**Design notes / sketches:**

> _User: load-bearing screen — this is where most user time is spent.
> Tree style (classic Windows tree-view vs. macOS-style outline vs.
> something custom)? Drag-and-drop visual feedback (insertion line vs.
> tinted target)? Link-group representation (badge color, glyph, group
> name on hover, group-membership view)? Multi-select visual style?
> Inline-edit affordance (single-click vs. double-click vs. F2-only)?
> Where does the embedded toolbar live — top of tree, contextual, both?_

**Bridge surface used:** filled in at Task 3.4.1.

**Decisions locked once ✅:**

> _(empty)_

---

## Screen 5 — Curve editor

**Replaces:** `src/UI/CurveEditor.cpp` (1044 LOC). 2D interactive curve
editor for per-track value curves (lifetime, size, color, opacity,
rotation, etc.). Bezier-style handles, snap modes, interpolation modes
(linear / smooth / step), insert / select modes.

**Design checkpoint:** 🟡 pending

**Wire-up:** 🟡 pending

**Current behaviour (legacy):**

Canvas-style editing surface. X axis = time, Y axis = value. Keyframes
shown as dots; bezier handles when a keyframe is selected. Click to
add (insert mode) or select (select mode). Drag keyframes to move.
Drag handles to shape tangents. Right-click for per-keyframe options
(set interpolation, delete). Toolbar at top: mode toggles, snap
options, time-range display. Three custom interpolation icons:
`curve_interpolate_linear.ico`, `_smooth.ico`, `_step.ico`.

**Design notes / sketches:**

> _User: rendering — SVG (easier interaction state, slow at 1000+ kf) or
> canvas (faster, manual hit-testing)? Decide after profiling a
> fireworks `.alo` with many keyframes. Snap behaviour (grid? other
> keyframes? both)? Handle visualisation style? Interpolation mode
> indicator placement (per-keyframe glyph vs. selected-keyframe
> property)?_

**Bridge surface used:** filled in at Task 3.5.1.

**Decisions locked once ✅:**

> _(empty)_

---

## Screen 6 — Track editor

**Replaces:** `src/UI/TrackEditor.cpp` (483 LOC). The "outer" frame
around the CurveEditor — track list, per-track toggle, lock-to combo,
keyframe-mode buttons.

**Design checkpoint:** 🟡 pending

**Wire-up:** 🟡 pending

**Current behaviour (legacy):**

Embedded as a child dialog inside the emitter property tabs. Hosts the
CurveEditor + a "Lock To" combo (links a track's curve to another
track) + a toolbar with select/insert mode + per-keyframe ops + an
optional preview overlay. 7 tracks total (`N_TRACKS` in `main.cpp`).

**Design notes / sketches:**

> _User: shares primitives with Screen 5 — same SVG/canvas decision
> applies. Track list on the side or above the curve? Lock-to UX
> (dropdown vs. drag-link visual)? Active-track indicator?_

**Bridge surface used:** filled in at Task 3.6.1.

**Decisions locked once ✅:**

> _(empty)_

---

## Screen 7 — Form-field primitives

**Replaces:** `src/UI/Spinner.cpp` (583 LOC), `src/UI/ColorButton.cpp`
(189 LOC), `src/UI/TexturePalette.cpp` (1019 LOC),
`src/UI/RandomParam.cpp` (269 LOC), `src/UI/PaletteStore.cpp` (563
LOC). The form-field building blocks used by emitter property panels
and dialogs.

**Design checkpoint:** ✅ shipped 2026-05-17 — commits `58b3b46`
(feat) + `4650c50` (deps sync). Vitest 28 → 40 (+12 specs across
4 primitive test files); Playwright 21 → 26 (+5 specs in
`tests/primitives.spec.ts`). Demo route reachable at
`?demo=primitives`.

**Wire-up:** N/A (primitives have no native side — they're consumer
components. Native wire-up happens per-screen when Screens 4/5/6/8
mount them.)

**Current behaviour (legacy):**

- **Spinner**: numeric input with up/down arrows, drag-to-adjust,
  parses scientific notation, range clamps, displays the unit suffix.
- **ColorButton**: rectangular swatch button that opens `ChooseColor`
  on click. Has a shared 16-slot custom-color palette persisted in
  the registry and surfaced across all instances (MT-2 / MT-3 / MT-4
  refactor).
- **TexturePalette**: grid of texture thumbnails for the emitter's
  `Texture` field. Loads thumbnails via the FileManager (mod-aware).
  Right-click for "browse for file", "clear", "open texture folder".
- **RandomParam**: combo + spinners for parameters that can be
  constant, uniform-random in range, normal-random with mean/stddev,
  etc.
- **PaletteStore**: backing store for ColorButton's custom palette;
  registry-persisted.

**Design notes / sketches:**

> _User: shadcn/ui has Number Input, Color Picker, Tabs, Combobox
> primitives — start from those? RandomParam is unique (no obvious
> shadcn equivalent — custom component). Density: form fields at
> 26px vs. 22px row height? Texture thumbnail size in the palette
> (current 64×64)? Persistent custom color palette: same 16-slot
> shape, or expanded?_

**Bridge surface used:**

**None in Phase 3.7.** Primitives are pure consumer components — they
accept `value` + `onChange` props (plus item arrays for grid-style
primitives) and do not own bridge calls. Their callers (Screens 4/5/6/8
dialogs) wrap the `onChange` callback with the appropriate
`bridge.request(...)` and pass in the data needed for grids.

This keeps Phase 3.7 surgical: zero new bridge Requests, zero new
MockBridge handlers, zero new C++ handlers. The bridge shape for
texture thumbnails / color palette persistence is paid in Phase 3.4
(emitter tree) and Phase 3.8 (Lighting dialog) respectively, when the
real consumer pattern is known. Premature schema additions in 3.7 would
likely need rework once a real consumer exercises them.

The demo route built in Phase 3.7 supplies its own static fixture data
(inline data URIs for TexturePalette thumbnails, in-memory custom
palette for ColorButton). No bridge round-trip from primitives in the
demo.

**Decisions locked (2026-05-17):**

1. **Primitive library** — Headless Radix where applicable
   (`@radix-ui/react-popover`, `@radix-ui/react-context-menu`,
   `@radix-ui/react-select`); custom-from-scratch where Radix has no
   analogue (Spinner numeric+drag handle, ColorButton swatch grid,
   TexturePalette thumbnail grid). **No shadcn/ui** — stays consistent
   with the Radix Menubar choice from Screen 2. Tailwind classes +
   `design-tokens` for styling.
2. **Module location** — New directory `web/apps/editor/src/primitives/`
   (sibling to `components/` and `screens/`). Primitives are reusable
   across screens; the existing `components/` is for app-shell parts
   (MenuBar, Toolbar, StatusBar, ViewportSlot) and `screens/` is for
   feature surfaces (BackgroundButton, BackgroundPicker). The
   distinction matters for Screens 4/5/6/8 wanting to import these
   without crossing screen boundaries.
3. **Density** — `26px` default row height (matches
   `tokens.density.rowHeight.default`); each primitive accepts a
   `density?: "tight" | "default" | "loose"` prop for the per-call
   override the legacy doesn't have. Default avoids retro-fitting
   density-aware layouts onto Screens 4-6 later.
4. **Spinner behaviors** — port the entire legacy behavior set so
   Screens 4/5/6 don't regress muscle memory:
   - Up/down arrow buttons (on hover; hidden otherwise to reduce
     visual noise — matches modern numeric-input patterns).
   - Scroll-wheel adjust (NT-1 feature; preserve magnitude on
     `Shift` modifier per legacy convention).
   - Drag-to-adjust (vertical mouse-Y drag from the input rect,
     `Shift` for fine-step, `Ctrl` for coarse-step).
   - Scientific notation parse (`1e-3`, `2.5E4` etc.).
   - Range clamp (`min`, `max` props; clamp on blur, not on every
     keystroke).
   - Unit suffix display (greyed-out, after the number, e.g.
     `12.5 deg/s`).
   - `onChange` fires on commit (Enter / blur / arrow / wheel / drag
     release), NOT on every keystroke — matches legacy and avoids
     bridge spam.
5. **ColorButton flow** — clicking the swatch opens a Radix Popover
   containing:
   - 16-slot custom-color grid (in-memory Zustand slice, persisted
     to localStorage in browser mode; persistence to host registry
     deferred to Screen 8 wiring).
   - 32-slot "basic colors" preset row (matches Win32 `ChooseColor`'s
     left side).
   - Hex input + RGB sliders for custom entry.
   - "Add to custom" button stores the current color in the next
     empty custom slot.
   - Clicking a custom slot fires `onChange(rgb)` immediately;
     popover stays open until the user commits (matches BackgroundPicker
     sticky-on-commit pattern from Screen 2).
   - **NOT** routed through native `ChooseColor` — keeps everything
     in React, avoids a CDP-blocking native dialog under test mode.
6. **TexturePalette flow** —
   - Grid of `64×64` thumbnails (matches legacy default; configurable
     via `cellSize?: number` prop for future zoom support).
   - **Items provided by caller** as a typed array:
     `{ path: string; label?: string; thumbnailSrc: string | null }[]`.
     Primitive doesn't fetch anything. `thumbnailSrc === null` renders
     a "missing" placeholder cell. Demo supplies inline data URIs.
   - Selected cell (`value === item.path`) gets `accent.primary`
     border.
   - Right-click → Radix ContextMenu with three slots:
     **Browse for file…**, **Clear**, **Open texture folder**.
     Each fires a typed callback (`onBrowse?`, `onClear?`, `onReveal?`).
     Caller decides what to do with each (typically a bridge call);
     primitive doesn't know about the bridge. Items with no callback
     wired render the menu entry as disabled.
   - Empty palette state: greyed "(no textures)" placeholder.
7. **RandomParam** — wrapper that renders:
   - `Mode` select (`@radix-ui/react-select`) with options
     `Constant` / `UniformRange` / `Normal`.
   - Below the select, mode-conditional spinner row(s):
     - `Constant`: 1 Spinner (value).
     - `UniformRange`: 2 Spinners (min, max) side-by-side with a
       small `–` separator.
     - `Normal`: 2 Spinners (mean, σ) side-by-side with `µ` and `σ`
       letter labels.
   - Single `onChange({ mode, ...values })` callback; consumer
     decides bridge shape.
8. **Custom color palette persistence** — 16 slots (matches Win32
   `ChooseColor` + every existing legacy use site). Expanding the
   palette is a one-line change later if Screens 4/8 want it; not
   worth diverging from legacy now.
9. **Demo / design checkpoint route** — Add a `?demo=primitives`
   query-param branch in `App.tsx` that renders a single
   `PrimitivesGallery` component (one section per primitive, with
   2-3 live instances each at varying configs). Reachable in browser
   mode at `http://localhost:5174/?demo=primitives` and in native dev
   mode at `https://app.local/?demo=primitives`. Removed once Screens
   4/5/6/8 ship and we have real consumption sites.
10. **Test surface** —
    - **Vitest** (`src/primitives/__tests__/*.test.tsx`): one spec
      per primitive covering keyboard + mouse + commit semantics.
      Target +12 specs (current baseline 28 → 40+).
    - **Playwright** (`tests/primitives.spec.ts`): minimal smoke
      against the demo route. Each primitive: render + one
      happy-path interaction + one edge case (clamp / paste / etc).
      Target +5 specs (current baseline 21 → 26+).

---

## Screen 8 — Remaining dialogs

**Replaces:** every other `…DialogProc` in `main.cpp` plus the inline
modal templates in `.rc` files. Specifically:

- **Lighting** (`LightingDlgProc`, modeless tool window, MT-4) —
  RGB + intensity + angles for sun/fill1/fill2 + ambient + shadow.
- **Background picker** (`SkydomePickerProc`) — already validated in
  Phase 2 as the first end-to-end screen; documented here for
  completeness.
- **Ground picker** (custom ListView modal) — 8 slots: 5 bundled
  textures + 3 custom + 1 solid-colour.
- **Import Emitters** (`ImportEmittersDialogProc`, LT-3) — file
  picker → tree-view of source `.alo` emitters with checkboxes →
  Select All / Clear + auto-include-children.
- **Rescale** (`RescaleDialogProc`) — duration + size scalars for
  the whole particle system.
- **Increment Index** (`IDD_INCREMENT_INDEX`, EmitterList-owned) —
  single integer spinner for "duplicate + increment index by N".
- **Mod Nickname** (`NicknameDialogProc`) — single text field; shown
  when opening a file with an unknown mod-data path.
- **Spawner** (`SpawnerDlgProc`, LT-1's v1 + future v2 polish) — the
  programmable spawner driver UI.
- **Link Group Settings** (`LinkGroupSettingsProc`,
  `src/UI/EmitterList.cpp:2781`) — per-field exempt overrides for a
  link group; Reset All button.
- **About** (`AboutProc`) — version / build date / license credits.

**Design checkpoint:** 🟡 iterating — sub-dialogs land in batches
(About + Rescale System locked 2026-05-17; others pending).

**Wire-up:** 🟡 iterating — per-sub-dialog. Legacy chrome stays in
`src/main.cpp` until Phase 4.2 cutover; Phase 3 dispatches add the
React surface without removing the legacy launcher.

**Current behaviour (legacy):**

Each dialog is a separate Win32 modal (or modeless tool window for
Lighting). Consistent OK / Cancel button placement. Some use
owner-drawn controls (Lighting's RGB swatches, Spawner's curve
preview). All have keyboard navigation (Tab cycle, Esc to cancel,
Enter to OK).

**Sub-dialog batching strategy:**

Screen 8 contains 9 unshipped sub-dialogs + the file-ops backbone.
The Phase 3 "one comprehensive dispatch per screen" cadence doesn't
fit; we ship in batches, each batch being a coherent unit of work
that's small enough for one subagent dispatch and one controller
verification pass. Each sub-dialog has its own checkbox above.

- **Batch 1** (2026-05-17): Shared `Modal` foundation + **About** +
  **Rescale System**. Smallest sub-dialogs with React menu triggers
  already in place and no dependency on other screens.
- **Batch 2+** (TBD): Lighting / Bloom-settings / Ground Texture
  Picker / file-ops backbone / Spawner / Import Emitters / Increment
  Index / Mod Nickname / Rescale Emitter / Link Group Settings.
  Several of these depend on Screen 4 (Emitter tree) for their
  trigger sites and should batch after Screen 4 lands.

**Design notes / sketches:**

> _User: tackle each dialog as a sub-checkpoint within this screen.
> Modeless tool windows (Lighting) — embed as a panel in main shell,
> or separate floating window? "OK / Cancel" affordance style? Form
> validation style (inline errors vs. summary toast)?_

**Sub-screens to check off individually:**

- [x] Lighting dialog — ✅ shipped Batch 2
- [x] Background picker — ✅ design complete (Task 2.3, browser-mode picker against MockBridge); refactored to ToolPanel shell in Batch 2
- [x] Ground picker — ✅ shipped Batch 2 (View → Ground Texture…)
- [x] Bloom settings — ✅ shipped Batch 2 (View → Bloom Settings…)
- [x] Import Emitters — ✅ shipped Batch 4 (component + bridge contract; real preview-from-file deferred to file-load batch)
- [x] Rescale System — ✅ shipped Batch 1
- [ ] Rescale Emitter — 🟡 pending (waits on Screen 4 for trigger site)
- [ ] Increment Index — 🟡 pending (waits on Screen 4 for trigger site)
- [x] Mod Nickname — ✅ shipped Batch 4 (component + usePromptModNickname hook + ?demo=mod-nickname route; real auto-trigger deferred to file-load batch)
- [x] Spawner — ✅ shipped Batch 4 (panel + schema; real SpawnerDriver wiring deferred to file-load batch)
- [ ] Link Group Settings — 🟡 pending (waits on Screen 4 for trigger site)
- [x] About — ✅ shipped Batch 1
- [x] File-ops backbone (New / Open / Save / Save As / recent-files) — ✅ shipped Batch 3

**Bridge surface used:** filled in at Task 3.8.1 (per sub-screen).

**Decisions locked once ✅:**

### Batch 1 — Modal foundation + About + Rescale System (locked 2026-05-17)

**Modal foundation (shared across all Screen 8 sub-dialogs):**

- **Library**: `@radix-ui/react-dialog` (matches the Radix pattern
  established by Menubar / Popover / Select / ContextMenu in earlier
  screens). No headless-ui, no shadcn.
- **Location**: `web/apps/editor/src/components/Modal.tsx`. Lives
  under `components/` (app-shell-style) rather than `primitives/`
  (form-field-style) because it's a container, not a form field.
- **Component shape**:
  ```tsx
  <Modal open onOpenChange title="…" size="sm|md|lg">
    <Modal.Body>…</Modal.Body>
    <Modal.Footer>
      <Modal.CancelButton>Cancel</Modal.CancelButton>
      <Modal.OkButton onClick disabled>OK</Modal.OkButton>
    </Modal.Footer>
  </Modal>
  ```
  Compound-component pattern matches the Radix idiom and gives
  callers explicit control over which buttons render (info modals
  drop `CancelButton`).
- **Sizes**: `sm` = 320 px wide, `md` = 480 px, `lg` = 640 px. Height
  is `auto`, clamped to `max-h-[80vh]` with body scroll.
- **Styling**: dark surface (`bg-neutral-900`, `border border-neutral-800`,
  `rounded-lg`, `shadow-2xl`). Header 48 px tall, title left
  (`font-semibold text-sm`), `×` close glyph right. Body 16 px
  padding. Footer 56 px tall, right-aligned button row, top border.
- **Dismissal**: Esc + overlay click + close glyph all fire
  `onOpenChange(false)`. Caller decides whether that maps to
  "Cancel" or "OK" semantics (typically Cancel for dismissable
  modals).
- **Keyboard**: Tab cycles interactive elements (Radix handles).
  Enter on a focused button activates. No "Enter commits on input"
  shortcut at the Modal level — leave that to consumers like
  Rescale that want a specific commit behaviour.

**About sub-dialog:**

- **Affordance**: triggered by `Help → About` menu item (currently
  `todo("About")` at [web/apps/editor/src/components/MenuBar.tsx:324]).
  Replace the no-op with `setAboutOpen(true)`.
- **Layout**: `size="sm"`, title "About AloParticleEditor", info-only
  modal. Body contents (in order):
  1. App name (`AloParticleEditor`) — large heading.
  2. Version line (e.g. `Version 1.5`) — pulled from build-time
     constants via Vite `define` (`import.meta.env.VITE_APP_VERSION`).
  3. Build date — pulled from `import.meta.env.VITE_BUILD_DATE`
     (Vite plugin or `define` injects `new Date().toISOString().slice(0,10)`
     at build time).
  4. Short license / credits paragraph (legacy uses `IDS_DISCLAIMER`
     + `IDS_EXPAT_COPYRIGHT` resource strings — bring those over as
     literal strings in the React component; no need for i18n here).
  5. Link to the GitHub repo (DrKnickers/new-particle-editor) as an
     `<a target="_blank">` styled with `text-sky-400 underline`.
- **Footer**: single `<Modal.OkButton>Close</Modal.OkButton>` (no
  Cancel — info modal).
- **Bridge call**: **none**. Version + build date are baked at build
  time; nothing round-trips through the bridge.
- **Legacy delete**: NOT done in Batch 1. `AboutProc` at
  [src/main.cpp:400] stays for the `--legacy-ui` path. Phase 4.2
  removes it during cutover.

**Rescale System sub-dialog:**

- **Affordance**: triggered by `Edit → Rescale…` menu item (currently
  `todo("Rescale")` at [web/apps/editor/src/components/MenuBar.tsx:164]).
  Replace the no-op with `setRescaleOpen(true)`.
- **Layout**: `size="sm"`, title "Rescale Particle System". Body has
  two Spinner rows stacked vertically, each with a label-on-left
  layout:
  - Row 1: label "Duration scale", Spinner (`value={100}`,
    `min={1}`, `max={1000}`, `step={1}`, `unit="%"`).
  - Row 2: label "Size scale", Spinner (`value={100}`, `min={1}`,
    `max={1000}`, `step={1}`, `unit="%"`).
  - Below the spinners: small grey hint text — "Applies to the
    entire particle system. Use *Rescale Emitter…* to rescale a
    single emitter." (cross-references the deferred Rescale Emitter
    sub-dialog so users know it exists.)
- **Footer**: `<Modal.CancelButton>Cancel</Modal.CancelButton>` and
  `<Modal.OkButton>OK</Modal.OkButton>`. OK enabled when both values
  are valid (Spinner clamps to range; valid = inside range).
- **Bridge call**: new `engine/action/rescale-system` Request with
  params `{ durationScalePercent: number; sizeScalePercent: number }`,
  returns `Record<string, never>`. MockBridge implements as a no-op
  (no DTO state to mutate; just logs the call so Vitest can assert
  on it). C++ host implements as a wrapper that calls the existing
  rescale helpers in `src/Rescale.cpp` against `info->particleSystem`.
  Capture-before-call via existing `UndoStack` so the action is
  undoable.
- **Commit flow**: click OK → fire bridge call → on success, close
  modal. On bridge failure (shouldn't happen for this Request),
  show an inline error in the modal body and keep it open.
- **Legacy delete**: NOT done in Batch 1. `RescaleParticleSystem`
  launcher at [src/main.cpp:1524-1525] stays for the `--legacy-ui`
  path. The underlying transform function in `src/Rescale.cpp` is
  shared by both paths — the new C++ bridge handler calls it
  alongside the legacy `WM_COMMAND` handler.

**Test surface for Batch 1:**

- **Vitest** (+5 specs, target 40 → 45+):
  - `Modal.test.tsx`: opens/closes on `open` prop change; clicking
    overlay fires `onOpenChange(false)`; pressing Esc fires
    `onOpenChange(false)`.
  - `AboutDialog.test.tsx`: renders the version + build date from
    `import.meta.env`.
  - `RescaleDialog.test.tsx`: renders 2 Spinners; clicking OK fires
    `bridge.request({ kind: "engine/action/rescale-system", … })`
    with the current spinner values.
- **Playwright** (+2 specs, target 26 → 28+):
  - `Help → About opens the modal and shows version`.
  - `Edit → Rescale… → set durationScale=200 → OK → bridge call
    arrives with durationScalePercent=200`.
- **Bridge contract** (+1 spec in `bridge-contract.test.ts`):
  - `engine/action/rescale-system` round-trips through MockBridge
    and returns `{}`.

**Sub-dialog checkbox updates after Batch 1 ships:**

- About sub-dialog: `[x] About — ✅ shipped Batch 1 (#NN)`
- (no other Screen 8 sub-dialog changes — Rescale System gets its
  own checkbox added now since the inventory list didn't include
  it; "Rescale" in the existing list refers to the not-yet-built
  Rescale Emitter dialog — both will land before Phase 4)

### Batch 4 — Spawner + Import Emitters + Mod Nickname (locked 2026-05-17)

**Schema additions:**

- **Real `SpawnerParamsDto`** mirroring `SpawnerConfig` from
  [src/SpawnerDriver.h:18]:
  ```ts
  type SpawnerMode = "manual" | "auto";
  type SpawnerParamsDto = {
    mode: SpawnerMode;
    enabled: boolean;
    burstSize: number;          // 1..10 (MAX_BURST_SIZE)
    spacingSec: number;         // 0..10 (MAX_SPACING_SEC)
    intervalSec: number;        // 0..60 (auto only)
    position: Vec3;
    velocity: Vec3;
    maxLifetimeSec: number;     // 0..600 (MAX_LIFETIME_SEC)
    jitterPosition: Vec3;
    jitterVelocity: Vec3;
  };
  ```
  Replaces the `Record<string, unknown>` placeholder.
- **New Request**: `spawner/trigger` → `Record<string, never>`.
  Fires the Manual-mode "Spawn now" button. Auto-mode behaviour:
  C++ host treats it as a no-op + logs.
- **Extend `EngineStateDto`** with `spawner: SpawnerParamsDto`
  (defaults to `SpawnerConfig()`'s default values per the legacy
  struct).
- **New Request**: `emitters/preview-from-file` → `{ ok: true;
  tree: EmitterTreeNode } | { ok: false; error: string }`.
- **Define minimal `EmitterTreeNode`** (and drop the
  `EmitterTreeDto = Record<string, unknown>` placeholder, or keep
  it as `EmitterTreeDto = { root: EmitterTreeNode }` if that's
  cleaner):
  ```ts
  type EmitterTreeNode = {
    id: number;
    name: string;
    children: EmitterTreeNode[];
  };
  ```
  Minimal-but-extensible: Screen 4 will add fields (texture path,
  link-group id, etc.) when it lands. Importing only needs id +
  name + children to render the checkbox tree.

**Spawner panel** (largest deliverable; ToolPanel-style slide-in):

- **Location**: `web/apps/editor/src/screens/SpawnerPanel.tsx`.
- **Trigger**: Tools → Spawner menu item (currently `todo("Spawner")`
  at [web/apps/editor/src/components/MenuBar.tsx:401]). Replace
  with `setOpenToolPanel("spawner")`.
- **Atom value**: `"spawner"` is a new value for the existing
  `openToolPanel` atom from `lib/tool-panel.ts`. Mutual exclusion
  with background / lighting / bloom / ground.
- **Panel body layout** (top to bottom):
  1. **Mode** — Radix radio group (`"manual"` / `"auto"`). Width-full.
  2. **Enabled** (auto-only, hidden in manual) — checkbox row.
  3. **Burst size** — Spinner (1..10, step 1).
  4. **Spacing** — Spinner (0..10, step 0.05, unit `s`).
  5. **Interval** (auto-only) — Spinner (0..60, step 0.5, unit `s`).
  6. **Position (x, y, z)** — 3 Spinners side-by-side. Range
     unbounded but step 0.1.
  7. **Velocity (x, y, z)** — 3 Spinners, step 0.1.
  8. **Max lifetime** — Spinner (0..600, step 0.5, unit `s`).
  9. **Jitter position** — 3 Spinners, step 0.05.
  10. **Jitter velocity** — 3 Spinners, step 0.05.
  11. **Spawn now** button (manual-only, hidden in auto).
- **State sync**: on mount, read `engine/state/snapshot.spawner`.
  Subscribe to `engine/state/changed` so external mutations
  (legacy, devtools) are picked up. Local edits commit immediately
  via `spawner/start { params: <full config> }`. The handler
  treats `spawner/start` as "set config" (matches legacy's
  `SpawnerDriver::SetConfig` semantics).
- **Header badge** — show current `spawner/active-count` event
  value as a small pill in the ToolPanel header (right of title).
  Subscribes to the event on mount.
- **Stop button** — small `Stop` icon button in header, fires
  `spawner/stop`. Disabled when count == 0.

**Import Emitters modal** (medium-sized; Modal-primitive):

- **Location**: `web/apps/editor/src/screens/ImportEmittersDialog.tsx`.
- **Trigger**: File → Import Emitters menu item (currently
  `todo("Import Emitters")` at
  [web/apps/editor/src/components/MenuBar.tsx:160]). Replace with
  the open-modal call.
- **Modal layout** (`size="lg"`):
  1. Top row: "Source file:" label + path display (read-only) +
     "Browse…" button. Path display shows basename + tooltip with
     full path; empty state = "(not selected)".
  2. Below: tree-view widget (only renders when path is set and
     preview has arrived). Each node has a checkbox + indent per
     depth. Leaf nodes have no expand-arrow; non-leaf nodes do
     (Radix Collapsible).
  3. Below the tree: "Auto-include children" checkbox (default
     on, matches LT-3 legacy). When on, ticking a parent
     auto-ticks descendants.
  4. Footer: "Select All" button (left) + Cancel (middle-right)
     + OK (right). OK label is dynamic: "Import N selected"
     (N = count of ticked emitters); disabled when N=0.
- **Flow**:
  1. Modal opens; "Browse…" is the only enabled control.
  2. Browse click → `bridge.request({ kind: "file/open", params: {} })`.
     If `ok: false`, modal stays open, user can retry.
  3. On `ok: true; path`, fire
     `bridge.request({ kind: "emitters/preview-from-file", params: { path } })`.
     Loading state visible during the call (spinner glyph or
     subtle pulse on the panel area).
  4. On preview success, render tree. User picks. OK click →
     `bridge.request({ kind: "emitters/import-from-file", params:
     { path, selected: <ids> } })` → close modal on success.
  5. Cancel any time → close modal, discard state.
- **C++ preview handler**: legacy `DoImportEmittersFromFile` at
  [src/main.cpp:7525] reads the .alo into a temporary `ParticleSystem`
  for the legacy tree-view; the bridge handler can mirror that
  pattern (read into a temporary, walk emitters, build
  `EmitterTreeNode`, return). Or forward-defer like rescale —
  return a stub tree until the host has file-load primitives
  available. **Subagent decision: factor the read-into-temporary
  helper out of `DoImportEmittersFromFile` if it's clean, else
  forward-defer with a "not yet implemented" error response that
  the React modal handles gracefully ("Preview not available in
  --new-ui yet; this is on the file-load batch's TODO list").

**Mod Nickname modal** (smallest deliverable; deferred real
trigger):

- **Location**:
  `web/apps/editor/src/screens/ModNicknameDialog.tsx`.
- **Layout** (`size="sm"`):
  1. Title: "Set mod nickname".
  2. Body: text input + label "Nickname:" + a brief explanation
     ("Give this mod's data directory a human-readable name.").
  3. Footer: Cancel / OK. OK disabled when input is empty.
- **Trigger**: NO menu item. Real trigger (auto-fire when
  file-load encounters an unknown mod-data path) is deferred to
  the file-load batch. For this batch, expose a
  `usePromptModNickname()` hook from `lib/file-state.ts` (or a
  new `lib/mod-nickname.ts` — subagent decides) returning
  `Promise<string | null>`. Add a small `?demo=mod-nickname` route
  branch in App.tsx so the design checkpoint can render it. Vitest
  + Playwright cover the component-only path.

**MockBridge implementations:**

- `spawner/start` — update `mock-state.spawner`, emit
  `engine/state/changed`. Debounce repeated calls.
- `spawner/trigger` — bump a mock "active count" counter
  (starts at 0, increments by `burstSize`), emit
  `spawner/active-count`. Mock doesn't simulate physics; the count
  decays after a fixed timeout.
- `spawner/stop` — set active count to 0, emit `spawner/active-count`.
- `emitters/preview-from-file` — return a fixed mock tree (3
  emitters with children) regardless of path. Lets the React tree
  widget be exercised in browser mode.
- `emitters/import-from-file` — already exists; no change.

**C++ host work:**

- New cases in `src/host/BridgeDispatcher.cpp` for:
  - `spawner/start` — forward-deferred no-op (host has no
    `SpawnerDriver*` yet); log + emit `engine/state/changed`.
    Update `m_spawnerConfig` for snapshot parity.
  - `spawner/trigger` — forward-deferred no-op + log.
  - `spawner/stop` — forward-deferred no-op + log.
  - `emitters/preview-from-file` — subagent decision: factor read-
    into-temporary out of `DoImportEmittersFromFile`, or
    forward-defer with `{ ok: false; error: "Preview not available
    in --new-ui yet" }`. The latter is safer if the factoring would
    require non-trivial refactor.
- Snapshot builder: include `spawner: <default config>` (or whatever
  the host's cached `m_spawnerConfig` is).
- `engine/state/snapshot` event payload mirrors.

**React side wiring:**

- `MenuBar.tsx` — wire Tools → Spawner and File → Import Emitters
  (Mod Nickname has no menu entry).
- `App.tsx` — mount SpawnerPanel + ImportEmittersDialog +
  ModNicknameDialog (the last one as a demo-route gate).
- `lib/tool-panel.ts` — extend the union to include `"spawner"`.
- `?demo=mod-nickname` branch in App.tsx — single-purpose demo
  for the ModNicknameDialog component.

**Test surface for Batch 4:**

- **Vitest** (+9 specs, target 63 → 72+):
  - `bridge-contract.test.ts` (+3): `spawner/start` round-trips
    with the new DTO; `spawner/trigger` returns `{}`;
    `emitters/preview-from-file` returns the mock tree.
  - `SpawnerPanel.test.tsx` (3): renders all sections; mode switch
    Manual→Auto shows/hides Interval + Enabled + Spawn now;
    changing burstSize fires `spawner/start` with the new value.
  - `ImportEmittersDialog.test.tsx` (2): Browse button fires
    `file/open`; OK is disabled when 0 selected.
  - `ModNicknameDialog.test.tsx` (1): renders text input + OK
    disabled when empty.
- **Playwright** (+4 specs, target 38 → 42+):
  - Tools → Spawner opens panel; mutual exclusion with Background.
  - Spawner: changing burst-size value triggers
    `engine/state/changed` with the new value.
  - File → Import Emitters opens modal.
  - `?demo=mod-nickname` renders the Mod Nickname dialog.

**Legacy delete:**

NOT in this batch. `SpawnerDlgProc` at [src/main.cpp:5824],
`ImportEmittersDialogProc` at [src/main.cpp:7378], `NicknameDialogProc`
at [src/main.cpp:7069] all stay for `--legacy-ui`. Phase 4.2.

### Batch 3 — File-ops backbone (locked 2026-05-17)

Largest bridge surface addition so far. Covers the entire File menu
(New / Open / Save / Save As / Recent Files / Exit), the dirty-state
tracking that ripples through window title + save-changes prompt,
and the C++ persistence handlers that wrap legacy `DoNewFile` /
`DoOpenFile` / `DoSaveFile` at [src/main.cpp:1289+]. Legacy code stays
for `--legacy-ui`.

**Schema additions:**

- **New Request kinds**:
  - `file/new` → `Record<string, never>` response. Clears the
    in-memory `ParticleSystem`, sets current file path to null, sets
    dirty to false.
  - `file/save-as` → same response shape as `file/save`
    (`{ ok: true; path?: string } | { ok: false; error: string }`).
    ALWAYS opens the native save picker. Distinct from `file/save`
    which uses the current path when available.
- **`EngineStateDto` extensions** (added at the top of the struct
  alongside the existing fields):
  - `currentFilePath: string | null` — null when untitled.
  - `dirty: boolean` — true if any engine mutation has occurred since
    the last file/new/open/save success.
- **New Event**:
  - `recent/changed` → `{ paths: string[] }` payload. Fires when the
    recent-files list changes (after open/save). Mirrors the
    existing `dirty/changed` event pattern.
- **No changes to existing `file/open`, `file/save`,
  `file/recent/list`** — schema stays; only the C++ handler
  implementations are new (or extended).

**MockBridge implementations:**

- Extend `mock-state.ts`:
  - `currentFilePath: string | null` (default null).
  - `dirty: boolean` (default false).
  - `recentFiles: string[]` (default `[]`).
- Implement `file/new` — clear emitters tree, set dirty=false,
  set currentFilePath=null. Emit `dirty/changed { dirty: false }`.
- Implement `file/save` — if `path` provided, use it; else if
  `currentFilePath` is set, use that; else simulate a picker by
  returning `{ ok: true, path: "/mock/untitled.alo" }`. Update
  `currentFilePath`, push to `recentFiles` (dedupe, cap at 9),
  set dirty=false, emit `dirty/changed` + `recent/changed`.
- Implement `file/save-as` — always simulate picker: return
  `{ ok: true, path: "/mock/saved-as.alo" }`. Same side effects as
  file/save.
- Implement `file/recent/list` — return current `recentFiles`.
- Implement `file/open` — if `path` provided use it; else simulate
  picker (`/mock/opened.alo`). Update `currentFilePath`,
  push to `recentFiles`, set dirty=false, emit `dirty/changed` +
  `recent/changed`.
- Engine setters / actions in mock-state — set dirty=true and emit
  `dirty/changed`. Don't fire if already dirty (avoid spam).

**C++ host implementations:**

- **New file** `src/host/handlers/FileHandler.cpp` + `.h` (matches
  the convention started in earlier batches if any; else inline in
  `BridgeDispatcher.cpp`). Subagent decides based on existing
  conventions — match what's there.
- **Wrap legacy** `DoNewFile` / `DoOpenFile` / `DoSaveFile` at
  [src/main.cpp:1289-1356] where possible. These are
  `APPLICATION_INFO*`-coupled. Either:
  1. Factor pure-IO helpers out of the legacy functions
     (preferred — read/write to a path, no UI side effects), and
     call them from both the legacy `WM_COMMAND` and the new bridge
     handler.
  2. Or call the legacy `Do*` directly from the bridge handler if
     they don't pop up dialogs (some don't — `DoSaveFile` only
     prompts when `saveas=true` or no current path).
- **Native pickers** — `file/save` with no current path AND
  `file/save-as` use `GetSaveFileNameW` (legacy `DoSaveFile`
  already does this). `file/open` with no path uses
  `GetOpenFileNameW` (already in legacy `DoOpenFile`). Don't
  reinvent — match legacy behaviour.
- **Recent-files persistence** — registry under
  `HKEY_CURRENT_USER\Software\AloParticleEditor\History` (matches
  legacy's `info->history` map; subagent should grep for `History`
  / `GetHistory` to confirm the registry path and serialization
  format).
- **Dirty flag** — track at `HostWindow` level. New
  `void SetDirty(bool)` + getter. Set true on any engine
  setter/action call route (forward-compatible no-op style — the
  exact set of mutating calls grows over time). Set false on
  file/new, file/open, file/save success. Emit `dirty/changed`
  event on every transition.
- **Snapshot** — `BuildEngineStateDto` (or wherever the snapshot is
  built) reads the current `dirty` + `currentFilePath` and includes
  them.
- **Capture-before-action** — for now, the file/save C++ handler
  doesn't capture an undo (undo applies to in-memory edits, not
  saves). Same for file/new — clearing is a destructive operation
  and skipping undo is intentional (matches legacy behaviour).

**React side:**

- **MenuBar wiring** — replace every File-menu TODO at
  [web/apps/editor/src/components/MenuBar.tsx:81-116] with real
  handlers:
  - `New` → if dirty, prompt → `file/new`.
  - `Open` → if dirty, prompt → `file/open { }` (host picker).
  - `Save` → `file/save { }` (host decides path).
  - `Save As` → `file/save-as { }` (always prompts).
  - `Import Emitters` — leave the existing wiring alone (already
    works; Batch 1+).
  - `Recent Files` submenu — dynamic. Subscribe to `recent/changed`
    (and seed from initial snapshot's `file/recent/list` query on
    mount). Each entry: basename click → if dirty, prompt →
    `file/open { path }`. Cap at 9 entries (legacy convention).
    Empty: show disabled "(none)" placeholder.
  - `Exit` → if dirty, prompt → `window.close()` (or equivalent;
    legacy `DestroyWindow(info->hMainWnd)` is the model). NOTE:
    closing the host window from React requires a bridge call —
    add `app/quit` Request? Or defer? **Subagent decision**: defer
    Exit to a future batch (just log a TODO); closing the WebView2
    window cleanly is a separate concern (involves saving window
    placement, etc.).
- **Save-changes prompt** at
  `web/apps/editor/src/screens/SaveChangesPrompt.tsx`. Uses the
  Modal primitive. Title "Save changes?", body "Do you want to save
  changes to <basename or 'this particle system'>?". Footer: three
  buttons: **Save** (returns `"save"`), **Don't Save** (returns
  `"discard"`), **Cancel** (returns `"cancel"`). Modal returns a
  Promise via a `usePrompt()` hook OR via a callback prop — match
  whatever ergonomics work cleanly with the rest of the codebase.
  Pattern hint: the BackgroundPicker holds its own open/close
  state via Zustand atom; SaveChangesPrompt can do the same with
  a `pendingAction: () => Promise<void>` slot that fires after
  Save/Discard, or null on Cancel.
- **Window title** — App.tsx subscribes to `currentFilePath` +
  `dirty` from snapshot + events. `useEffect` updates
  `document.title`. Format:
  - Dirty, untitled: `* AloParticleEditor`
  - Dirty, named: `* foo.alo — AloParticleEditor`
  - Clean, untitled: `AloParticleEditor`
  - Clean, named: `foo.alo — AloParticleEditor`
- **New hook** `useFileState()` at
  `web/apps/editor/src/lib/file-state.ts` — selectors for
  `currentFilePath`, `dirty`, `recentFiles`. Subscribes to the
  three relevant events on mount.

**Test surface for Batch 3:**

- **Vitest** (+8 specs, target 55 → 63+):
  - `bridge-contract.test.ts` (+3): `file/new`, `file/save-as`,
    `recent/changed` event all round-trip through MockBridge.
  - `SaveChangesPrompt.test.tsx` (3): renders 3 buttons; each
    button fires the right callback.
  - `MenuBar.test.tsx` (or split — depends on existing structure)
    (+2): File → New on dirty system shows the prompt; Recent
    Files submenu renders entries from snapshot.
- **Playwright** (+4 specs, target 34 → 38+):
  - `file-ops.spec.ts`:
    - `File → New on a clean system fires file/new without prompt`.
    - `File → New on a dirty system shows the Save Changes prompt`.
    - `File → Save fires file/save with the current path` (via
      pre-seed: open a mock path then save).
    - `Window title shows the basename when currentFilePath is set`.

**Legacy delete:**

NOT in this batch. `DoNewFile` / `DoOpenFile` / `DoSaveFile` /
`OpenHistoryFile` and all the `ID_FILE_*` `WM_COMMAND` handlers stay
for `--legacy-ui`. Phase 4.2 removes them.

### Batch 2 — Modeless tool windows: Lighting + Bloom + Ground Texture (locked 2026-05-17)

**Shared `ToolPanel` host pattern (the architectural call):**

- **Single open panel at a time.** Zustand atom
  `openToolPanel: "background" | "lighting" | "bloom" | "ground" | null`
  drives `App.tsx`'s right-sidebar slot. Opening any panel (via menu,
  via BackgroundButton, via any future trigger) sets the atom and
  closes whichever was previously open.
- **Why not multi-panel tabbed sidebar or stacked panels?** Tabbed
  is a bigger architectural change — defer to a later refactor if
  user feedback says one-at-a-time is too restrictive. Stacked has
  layout-math complexity and matches a Win32 affordance (floating
  HWNDs) that doesn't map well to WebView2. One-at-a-time matches
  the existing BackgroundPicker pattern and ships in this batch.
- **`ToolPanel` shell** at
  `web/apps/editor/src/components/ToolPanel.tsx`. Compound
  component: `<ToolPanel title="…" onClose={…}>…</ToolPanel>`.
  Same chrome as BackgroundPicker (320 px wide, dark surface, 48 px
  header with title + `×` close glyph, scrollable body). The
  existing BackgroundPicker is refactored to use this shell in this
  batch — it's currently inline in `BackgroundPicker.tsx`.
- **Migration plan for BackgroundPicker.** Extract its panel shell
  into `ToolPanel`; BackgroundPicker stays a screen but uses the
  shell. The existing `panelOpen` state in App.tsx becomes the
  Zustand atom's `"background"` value. All existing Background
  Playwright specs must still pass — this refactor is invisible
  externally.

**Lighting panel (largest sub-dialog):**

- **Trigger**: Tools → Lighting menu item (currently `todo("Lighting")`
  at [web/apps/editor/src/components/MenuBar.tsx:288]). Replace with
  `setOpenToolPanel("lighting")`.
- **Section layout** (top to bottom in the panel body):
  1. **Sun light** (expanded by default, `<details>` collapsible):
     intensity Spinner (`0..2`, step `0.05`), azimuth Spinner
     (`-180..180`, suffix `°`), altitude Spinner (`-90..90`, suffix
     `°`), diffuse ColorButton, specular ColorButton.
  2. **Fill light 1** (collapsed by default): intensity, azimuth,
     altitude, diffuse (no specular for fill lights — matches legacy).
  3. **Fill light 2** (collapsed by default): same as Fill 1.
  4. **Ambient** (always visible): ColorButton (the global ambient
     tint, `engine/set/ambient`).
  5. **Shadow** (always visible): ColorButton (the global shadow
     tint, `engine/set/shadow`).
  6. **Footer row**: `Mirror Sun` button (copies sun direction to
     Fill 1 — composed in React via `engine/set/light` calls; no new
     bridge), `Reset` button (resets all lights to default values
     baked into the component), `Force Align` checkbox (Lighting-tab
     toggle — if no bridge call exists for this, omit it from this
     batch and TODO it).
- **State sync**: subscribe to `engine/state/changed`. Each
  ColorButton / Spinner derives its `value` from the latest snapshot.
  Local edits commit immediately to the bridge (no draft state) so
  the engine re-renders live.
- **Bridge surface**: `engine/set/light { which, ...LightDto }`
  (per-light intensity/angles/colours — note: legacy stores
  intensity separately from the LightDto's diffuse/specular RGB;
  the React layer either folds intensity into the diffuse alpha
  channel of `Vec4` or maintains it as a local computed value
  multiplied into the bridge call. **Defer to the subagent's read
  of the legacy LightingDlgProc to make the right call**).
  `engine/set/ambient { color: Vec4 }`. `engine/set/shadow { color:
  Vec4 }`.
- **Vec4 ↔ COLORREF helpers**: ColorButton works in COLORREF; bridge
  takes Vec4 for lights. Add a `colorrefToVec4(rgb): Vec4` /
  `vec4ToColorref(v): Color` pair in `web/apps/editor/src/lib/colorref.ts`
  (companion to the existing helpers).
- **Legacy delete**: NOT in this batch. `LightingDlgProc` at
  [src/main.cpp:6574] stays for `--legacy-ui`.

**Bloom Settings panel (smallest sub-dialog):**

- **Trigger**: new "View → Bloom Settings…" menu item. The existing
  View → Bloom item stays as a toggle (do not replace). The new
  item is inserted directly under it. Replace its `todo(...)` with
  `setOpenToolPanel("bloom")`.
- **Section layout**:
  1. **Enable Bloom** checkbox (mirrors `engine/set/bloom`; gives the
     panel a master toggle independent of the menu).
  2. **Strength** Spinner (`0..5`, step `0.05`).
  3. **Cutoff** Spinner (`0..1`, step `0.01`).
  4. **Size** Spinner (`0..32`, step `0.5`).
- **Bloom-available gate**: call `engine/query/bloom-available` on
  mount. If false, render a disabled-state body with greyed Spinners
  and a small "(Bloom is not supported on this device)" placeholder.
  Subscribe to `engine/state/changed` to re-derive in case bloom
  availability flips (rare but possible after reload-shaders).
- **Bridge surface**: existing `engine/set/bloom`,
  `engine/set/bloom-strength`, `engine/set/bloom-cutoff`,
  `engine/set/bloom-size`, `engine/query/bloom-available`. No
  additions.
- **Legacy delete**: NOT in this batch. `BloomDlgProc` at
  [src/main.cpp:5987] stays for `--legacy-ui`.

**Ground Texture Picker panel (mirrors Background pattern):**

- **Trigger**: the existing ground-affordance in the toolbar /
  whatever surface the audit cites as the launcher. Inspect the
  current code (legacy uses `hGroundTexturePreview` button BN_CLICKED
  → `ShowGroundTexturePicker`); the React UI doesn't yet have a
  ground-preview button in the toolbar, so EITHER add a menu item
  under View → "Ground Texture…" OR add a small pill in the toolbar
  matching BackgroundButton. **Subagent decision: pick the smaller
  one (menu item) and TODO the toolbar pill for a future batch.**
- **Section layout** (mirrors BackgroundPicker's slot grid):
  1. **Show Ground** master checkbox at top (mirrors `engine/set/ground`).
  2. **Grid** of `groundSlotCustomPaths.length + bundled-count + 1`
     slot tiles. Read `groundTexture` snapshot for current selection,
     `groundSolidColor` for slot 0's swatch.
  3. **Slot 0 (Solid colour)** — wide tile showing the current
     `groundSolidColor` swatch; click switches to slot 0 + opens the
     ColorButton popover (composes existing Screen 7 ColorButton).
     On color commit → `engine/set/ground-solid-color { rgb }` +
     `engine/set/ground-texture { slot: 0 }`.
  4. **Bundled slots** — square tiles with placeholder colour
     gradients (same approach as BackgroundPicker). Click →
     `engine/set/ground-texture { slot }`.
  5. **Custom slots** — empty tiles say "+ Browse"; populated show
     basename. Click empty → no-op for now (file picker requires
     native host wiring, defer as TODO matching BackgroundPicker's
     custom-slot deferred behavior). Click populated → switches to
     that slot.
- **Selection visual**: `border-2 border-sky-500` on selected tile,
  `border-neutral-800` otherwise (matches BackgroundPicker).
- **Bridge surface**: existing `engine/set/ground`,
  `engine/set/ground-texture`, `engine/set/ground-solid-color`,
  `engine/query/ground-slot-empty`. No additions.
- **Legacy delete**: NOT in this batch. `GroundTexturePickerProc` at
  [src/main.cpp:3799] stays for `--legacy-ui`.

**Test surface for Batch 2:**

- **Vitest** (+9 specs, target 46 → 55+):
  - `ToolPanel.test.tsx` (3 specs): renders the title; close glyph
    fires onClose; switching between panels closes the previous one.
  - `LightingPanel.test.tsx` (3 specs): Sun section renders 3
    Spinners + 2 ColorButtons; changing Sun intensity fires
    `engine/set/light` with the correct `which: "sun"`; Mirror Sun
    button copies sun → fill1 via two `engine/set/light` calls.
  - `BloomPanel.test.tsx` (2 specs): renders 3 Spinners; changing
    Strength fires `engine/set/bloom-strength`.
  - `GroundTexturePanel.test.tsx` (1 spec): clicking a bundled slot
    fires `engine/set/ground-texture` with the right slot index.
- **Playwright** (+6 specs, target 28 → 34+):
  - `tools.spec.ts` (6 specs):
    - Lighting: Tools → Lighting opens the panel; opening Background
      closes Lighting (mutual exclusion).
    - Bloom: View → Bloom Settings opens the panel; toggling Enable
      fires `engine/set/bloom` and updates the menu's check glyph.
    - Ground: View → Ground Texture opens the panel; clicking a
      bundled slot updates `engine/state/changed` snapshot's
      `groundTexture`.

**Migration of existing Background plumbing:**

- `App.tsx`'s `panelOpen: boolean` state goes away. Replaced with
  the new `openToolPanel` Zustand atom + selector.
- `BackgroundButton`'s `open` prop becomes
  `open === "background"` from the atom.
- `BackgroundPicker.tsx` extracts its panel-shell JSX into the new
  `ToolPanel.tsx` shared component; the picker's body content stays
  in `BackgroundPicker.tsx`.
- All existing Background Playwright specs MUST still pass without
  modification. The refactor is invisible externally.

### Background picker (sub-screen) — locked Task 2.3

**Affordance.** A compact pill `[● Background]` in the top bar after the
"AloParticleEditor" title. The 12×12 swatch reflects the *current*
background:

- Slot 0 (solid colour) → the engine `background` COLORREF rendered as
  CSS hex.
- Slots 1-8 (bundled) → a fixed representative colour per skydome
  (`BUNDLED_SLOTS[i].swatch` in `BackgroundPicker.tsx`), so there's a
  deterministic preview without round-tripping for thumbnails.
- Slots 9-11 (custom) → neutral-600 placeholder until the native host
  ships per-skydome thumbnails.

The pill toggles the panel (`aria-pressed` reflects open state).

**Layout.** Right-side slide-in panel, 320 px wide, anchored to the
right edge of the main row. `absolute right-0 top-0 bottom-0 z-10`,
above the viewport-slot but inside the existing app shell. Tailwind
transition: `transform translate-x-0` / `translate-x-full`. Header
40 px, dark surface (`bg-neutral-900`), bottom border
(`border-b border-neutral-800`), 16 px padding. "Background" title
(left, semibold), Unicode `×` close button (right).

**Slot grid.** Single 3-column grid throughout, three sections separated
by `gap-3`:

1. **Solid colour** — `col-span-3` tile, 64 px tall. Background colour
   = current `background` rendered live. Click switches to slot 0 *and*
   triggers a hidden `<input type="color">` for hex selection. Hex
   change → `engine/set/background { rgb: hexToColorref(hex) }`.
2. **Bundled (slots 1-8)** — 8 individual square tiles (`aspect-square`).
   Each tile fills with the per-slot CSS gradient (no real thumbnail in
   browser mode; native host wires real previews later). Bottom strip
   shows the skydome name on `bg-neutral-950/80 backdrop-blur-sm`.
   Click → `engine/set/skydome-slot { slot }`.
3. **Custom (slots 9-11)** — 3 square tiles. Empty: dashed border
   (`border-dashed border-neutral-700`), "+" glyph + "Browse..." label.
   Click in browser mode alerts "File picker requires native host —
   coming in Task 2.4". Populated: dark tile + basename + small
   "↺" replace glyph top-right. Click → `engine/set/skydome-slot { slot }`.

**Selection visual.** `border-2`. Selected tile: `border-sky-500` +
filled circle `✓` glyph in the top-right (top-left for custom tiles to
avoid overlapping the replace glyph). Unselected: `border-neutral-800`
with hover `border-neutral-700`.

**State subscription.** On mount: `engine/state/snapshot` once. Then
`bridge.on("engine/state/changed", …)` for live updates. Unsubscribe in
the `useEffect` cleanup. Both the pill and the panel mirror state from
the same DTO, so external mutations (DevTools, Playwright,
`engine/action/*`) reflect immediately.

**Bridge surface used.**

- Request `engine/state/snapshot` — initial DTO.
- Request `engine/set/skydome-slot { slot }` — every bundled / custom
  tile click. Slot 0 also fires from the solid-colour tile click to
  guarantee the engine is in solid-colour mode before the colour input
  opens.
- Request `engine/set/background { rgb }` — solid-colour `<input
  type="color">` change. RGB encoded as COLORREF
  (`(b << 16) | (g << 8) | r`, see `lib/colorref.ts`).
- Request `engine/set/skydome-custom-path { slot, path }` — *not yet
  emitted in browser mode*; the empty-state click alerts and the
  populated-state click only fires `skydome-slot`. Task 2.4 wires the
  native file picker into this surface.
- Event `engine/state/changed` — drives both the pill swatch
  (`BackgroundButton`) and the picker's selection / preview state.

**Out of scope (Task 2.4+).**

- Native `file/open` for custom slots — currently a `window.alert`.
- Real skydome thumbnails — placeholder swatches today.
- Replace / clear right-click context menu on populated custom tiles —
  ↺ glyph is currently decorative; clicking it just behaves like the
  tile itself.

---

## Iteration log

Optional running log of design-iteration sessions, references shared,
mockups attached. Append-only.

### 2026-05-17 · Screen 7 (Form-field primitives)

Design-and-implement single-session, no live iteration with the user —
all 10 decisions locked up front by the controller per the "delegating
design" pattern, then dispatched to a Sonnet subagent that built all
four primitives, the demo route, and the test suite in one pass.

**Locks worth surfacing for future screens:**
- Primitives are pure consumer components (zero bridge ownership) —
  the eventual screen mounts the primitive and wraps the `onChange`
  with `bridge.request(...)`. Keeps primitives reusable across
  screens that need different bridge shapes.
- No native `ChooseColor` for ColorButton — all picking happens in a
  React Radix Popover. The reason isn't just CDP-safety (lessons doc
  has receipts on native dialogs being problematic under CDP) — it's
  that native dialogs force the React app to lose focus on every
  color pick, which breaks drag-state, hover-state, and keyboard nav
  patterns in any primitive sitting near the ColorButton.

**Implementer surprises (from the subagent's report):**
1. *Radix Select doesn't open in jsdom* — uses pointer-capture +
   `scrollIntoView` which jsdom doesn't implement. The RandomParam
   "mode switch" Vitest spec was recast as a `rerender()` test (same
   invariant: 2 spinners after mode change to UniformRange). Full
   click interaction covered by the Playwright spec.
2. *App.tsx conditional hook violation* — early `return
   <PrimitivesGallery />` before `useMemo`/`useState`/`useEffect`
   was a rules-of-hooks violation. Split into `AppShell` (all hooks)
   + `App` (pure routing between gallery and AppShell).
3. *No `allowBuilds:` re-injection needed* — the three new Radix deps
   + four test deps have no post-install build scripts. L-005 didn't
   fire on this dispatch.

**Open follow-ups for Screens 4/5/6/8:**
- `palette-store.ts` is localStorage-only in browser mode; host-side
  registry persistence is wired in Screen 8 (Lighting dialog).
- `TexturePalette`'s `onBrowse` / `onClear` / `onReveal` callbacks
  are no-ops in the demo. Screen 4 (emitter tree → Appearance tab)
  is the first real consumer; Screen 8 also consumes for the
  per-dialog texture picks.
- `ColorButton` popover holds draft state and does NOT sync on
  external `value` changes. Screen 4 should close the popover on
  external value changes if that pattern is needed.
- Demo route `?demo=primitives` should be removed once Screen 4 or 5
  ships a real consumption site — track here.

### 2026-05-17 · Screen 8 Batch 1 (Modal + About + Rescale System)

First batch of Screen 8's many sub-dialogs. Locked the Modal
foundation (Radix Dialog wrapper, compound `Modal.Body` /
`Modal.Footer` / `Modal.OkButton` / `Modal.CancelButton` shape) plus
the two trivial menu-wireable sub-dialogs: About (no bridge call,
build-time version/date via Vite `define`) and Rescale System (one
new bridge call `engine/action/rescale-system`, two Spinners,
OK/Cancel). Both dialogs wired to their existing MenuBar TODO
triggers (Help → About at line 324; Edit → Rescale… at line 164).

Commits: `0121890` (feat) + `8304c41` (deps sync for
`@radix-ui/react-dialog`). Tests 46 Vitest (40 → 46) + 28 Playwright
(26 → 28). MSBuild Debug x64 0/0.

**Locks worth surfacing for future batches:**
- *Modal lives under `components/`, not `primitives/`.* Primitives
  are form-field building blocks; Modal is a container. The boundary
  matters because Screens 4/5/6 will mount primitives inside Modals,
  and the import graph stays clean when each lives in its semantic
  home.
- *Legacy code paths stay.* The Phase 3 plan template's "delete the
  legacy launcher in this same PR" line is misleading — the binary
  still runs `--legacy-ui` until Phase 4.2 cutover. Phase 3
  dispatches ADD the React surface alongside the legacy. `AboutProc`
  at `src/main.cpp:400` stays; `RescaleParticleSystem` launcher at
  `src/main.cpp:1524-1525` stays. Same applies to every future
  Screen 8 sub-dialog.
- *Bridge handler can be a forward-compatible no-op when the host
  doesn't have the data yet.* The `engine/action/rescale-system` C++
  handler logs the call, emits `engine/state/changed` for parity
  with MockBridge, and returns OK — but doesn't actually call into
  `src/Rescale.cpp`'s `DoRescaleEmitter` yet because the host has
  no `ParticleSystem*` accessor (waits on file-load / Screen 4
  wiring). End-to-end Playwright proof is via the `state/changed`
  observation. When emitter wiring lands, the handler becomes a
  one-liner: factor `DoRescaleEmitter` into `Rescale.h`, capture
  via `UndoStack`, iterate `system->getEmitters()`.

**Implementer surprises (from the subagent's report):**
1. *Radix Dialog overlay-click doesn't work in jsdom.* The
   `pointerDownOutside` hook needs event constructors jsdom doesn't
   emulate. The Vitest Modal spec covers close-glyph click instead
   (same `onOpenChange(false)` contract); Playwright covers
   Esc-dismissal end-to-end. Same pattern as Screen 7's
   Radix-Select-in-jsdom workaround — these Radix-uses-pointer-events
   gaps may want a small `L-006` lesson if they bite a third time.
2. *`window.bridge` monkey-patch under `--test-host` doesn't reach
   React.* React captures the NativeBridge reference at mount;
   `window.bridge` is swapped to TestHostBridge later. Spy-based
   Playwright assertions against `window.bridge.request` can't
   intercept React-initiated dispatches. Reworked the assertion to
   observe the `engine/state/changed` event the C++ handler emits —
   end-to-end proof of dispatch without spying on React internals.
3. *`role="dialog"` selector collision.* BackgroundPicker's shell
   also uses `role="dialog"`. Tightened the dialog selector to
   `[role="dialog"][data-state="open"]` (Radix-only). Future
   Modal-using specs should follow this pattern.

**Open follow-ups for later Screen 8 batches:**
- *Plumb a `ParticleSystem*` accessor to BridgeDispatcher* (probably
  `SetParticleSystem(ParticleSystem**)` called from main.cpp at
  startup). Unlocks the real rescale handler + every future
  emitter-mutating bridge call. Worth doing as the first task of
  whichever batch lands file/load wiring.
- *Hand-bumped `VITE_APP_VERSION` in `vite.config.ts`* mirrors
  `VERSION_MAJOR/MINOR` in `src/main.cpp:43-44`. A small Vite plugin
  that reads those constants at build time would close the drift
  risk — but it's a 5-minute future PR, not blocking anything.
- *Rescale Emitter, Increment Index, Mod Nickname, Link Group
  Settings* all depend on Screen 4 (emitter tree) for their trigger
  sites. Bring them up in the same batch that lands Screen 4's
  context menus.

### 2026-05-17 · Screen 8 Batch 2 (ToolPanel + Lighting + Bloom + Ground Texture)

Three modeless tool windows + a shared sliding-panel shell, all in
one opus dispatch. The architectural call was **mutual-exclusion
sliding panels** via a single `openToolPanel` Zustand atom — opening
any panel closes the previously-open one. This refactored the
existing BackgroundPicker into the new `ToolPanel` shell while keeping
all existing Background Playwright specs green without modification.

Commit: `060cae7` (single feat — no new deps required, so no chore
sync). Tests 55 Vitest (46 → 55) + 34 Playwright (28 → 34). MSBuild
incremental no-op (zero C++ changes).

**Locks worth surfacing for future batches:**
- *Mutual-exclusion is the right starting point for tool panels.*
  Multi-panel tabbed sidebar / stacked panels are bigger
  architectural changes that should wait for user feedback that
  one-at-a-time is too restrictive. The Zustand atom + selector
  pattern leaves room to evolve without rewriting any panel
  component — only `App.tsx`'s routing logic changes.
- *ToolPanel as shared shell is durable beyond Screen 8.* Any future
  surface that wants the slide-in-from-right chrome (e.g., emitter
  inspector for Screen 4, curve editor toolbar) uses this same
  shell. Body content stays per-screen; chrome is one place.
- *Lighting `intensity` vs `LightDto.diffuse/specular` mapping
  preserves user intent.* Legacy stores intensity and per-channel
  colour separately and folds at push time (see `MakeLight` at
  [src/main.cpp:6196]). The engine snapshot only carries the
  post-multiplied Vec4, so a naive snapshot → form sync would
  clobber the user's intensity vs colour split. The lock: React
  holds intensity + diffuse RGB + specular RGB as local form
  state, seeds once at mount from the snapshot (with intensity =
  1.0 so the displayed colour matches the snapshot Vec4 verbatim),
  then multiplies on the way out of every `engine/set/light` call.
  No re-seed on `engine/state/changed` — that would clobber the
  split. Same pattern will apply to any future panel that exposes
  a "compressed" engine field as multiple user-facing controls.

**Implementer surprises (from the subagent's report):**
1. *No Force Align bridge call exists.* Legacy `Lighting_RealignFills`
   ([src/main.cpp:6619]) cascades sun-Z → fill angles via the
   resource dialog's internal state, but there's no schema entry
   for it. Per design lock 4 ("omit if no bridge call exists"), the
   checkbox is deferred with a JSX TODO. Adding it later is either
   (a) a new `engine/set/lighting-force-align` bridge call + C++
   handler, or (b) client-side cascade of three sequential
   `engine/set/light` calls per sun-Z change. Both are scope
   expansions beyond Batch 2.
2. *BackgroundPicker refactor was invisible externally.* The new
   `ToolPanel` sets `aria-label={title}`, and passing
   `title="Background picker"` preserved the existing Playwright
   selector `[role="dialog"][aria-label="Background picker"]`.
   Toolbar spec's "Close background picker" filter still matches
   because the new close-glyph label is just `"Close"` and the
   filter uses a prefix match.
3. *Ground custom-slot file picker is a no-op (matches BackgroundPicker
   precedent).* Empty custom slots show "+ Browse" but click is a
   no-op until `file/open` reaches both bridges uniformly. Defer
   matches existing BackgroundPicker behaviour from Task 2.3.

**Open follow-ups for later Screen 8 batches:**
- *Force Align checkbox for the Lighting panel* (see surprise 1).
- *Toolbar pill for Ground Texture* — the parking-lot design call
  suggested either a menu item OR a toolbar pill; menu item was
  the smaller call this batch. Toolbar pill is a future option if
  ground-texture switching is a frequent enough workflow.
- *Ground custom-slot file picker* — see surprise 3. Resolves once
  the file-ops backbone (Batch 3+ candidate) lands.
- *Tab strip / multi-panel tabbed sidebar* — defer until user
  feedback says one-at-a-time mutual exclusion is too restrictive.
  The atom-based routing makes this a non-breaking change later.

### 2026-05-17 · Screen 8 Batch 3 (file-ops backbone)

Largest bridge surface addition so far. The entire File menu
(New / Open / Save / Save As / Recent Files) is now wired through
the React UI with full dirty-tracking + save-changes prompt + window
title indicator. Bridge schema grew by 2 Requests, 1 Event, and 2
new fields on `EngineStateDto`; MockBridge gained full
implementations; C++ host gained registry-backed recent files,
native pickers via `GetSaveFileNameW` / `GetOpenFileNameW`, and the
dirty-flag plumbing through every mutating handler.

Commit: `1a4975a` (single feat — no new deps). Tests 63 Vitest
(55 → 63) + 38 Playwright (34 → 38). MSBuild 0/0 (pre-existing
LIBCMTD warning unchanged).

**Locks worth surfacing for future batches:**
- *Forward-deferred engine-level I/O is the right call when the
  host doesn't own the ParticleSystem yet.* Legacy `DoNewFile` /
  `DoOpenFile` / `DoSaveFile` are inseparable from
  `APPLICATION_INFO*` (ParticleSystem ownership, undo stack,
  autosave, emitter list, menu rebuild). Trying to factor pure-IO
  helpers out would require crashing on a null `info` or
  fabricating one. Same precedent as Batch 1's rescale handler:
  the bridge handler implements the *editor-level* portion (path
  tracking, dirty flag, recents, native pickers) and leaves the
  engine-level read/write as a forward-deferred no-op until the
  new-UI host owns its own ParticleSystem*. Hooks are in place at
  the bottom of each file handler for activation when that lands.
- *Registry-backed recent files match legacy exactly.*
  `HKCU\Software\AloParticleEditor`, values keyed by full filename,
  payload `REG_BINARY` of `sizeof(FILETIME)`. Both legacy and
  React-side see the same list — flipping between `--legacy-ui`
  and `--new-ui` preserves the recent-files history. Cap
  (`NUM_HISTORY_ITEMS = 9` from `src/main.cpp:47`) preserved.
- *Save-changes prompt is a Zustand-atom + closure pattern.* The
  `pendingAction: () => Promise<void> | null` slot stores the
  user's destructive intent (New / Open / Recent click). Save runs
  `file/save {}` and executes the closure on success; Don't Save
  executes immediately; Cancel discards. This shape works because
  there's exactly one pending action at any time. A more general
  command queue would be overkill.

**Implementer surprises (from the subagent's report):**
1. *Zustand v5 + React 19 rejects fresh-object selectors.* The
   `useFileState()` hook initially returned a freshly-built object
   every render, which Zustand's `Object.is` guard caught as a
   potential infinite-loop trigger. Fix: subscribe to each scalar
   individually (`useFileStateStore((s) => s.currentFilePath)` ×
   three) then compose at the call site. Generalizable pattern
   for any future hook exposing multiple Zustand fields.
2. *`engine/set/paused` marks dirty.* The parking-lot lock said
   "every engine/set/* and engine/action/*" should mark dirty.
   Pausing isn't really save-worthy (legacy never calls
   `SetFileChanged` from the pause path) but the spec was followed
   for mock/native parity. If annoying, fix is one line in
   `isMutating()` (MockBridge) plus an early-return in the C++
   handler. Same likely applies to `engine/set/heat-debug` — both
   are view-only toggles.
3. *MockBridge save-picker simulation.* `file/save` falls through
   to a fixed `/mock/untitled.alo` when both `path` and
   `currentFilePath` are missing. `file/save-as` always returns
   `/mock/saved-as.alo`. `file/open` with no explicit path returns
   `{ ok: false, error: "browser-mode" }` — matches the legacy
   BackgroundPicker fallback that branches on `ok`. Just enough
   to drive Vitest contract round-trips, not a real picker sim.

**Open follow-ups for future batches:**
- *Wire the actual ParticleSystem read/write.* When the new-UI
  host owns a `ParticleSystem*` (likely the same batch that wires
  Screen 4's emitter tree), the four hooks at the bottom of each
  file handler activate. Smallest enabling change: pass a
  `ParticleSystem**` accessor to BridgeDispatcher via
  `BridgeDispatcher::SetParticleSystem(ParticleSystem**)` called
  from main.cpp at startup or from the host-window init path.
- *File → Exit* is a TODO. Closing the host window cleanly involves
  window-placement persistence, auto-save flush, and possibly
  `app/quit` schema addition. Revisit with the broader app
  lifecycle work.
- *Tighten the "is mutating" set.* Per surprise 2, view-only
  toggles (`paused`, `heat-debug`) shouldn't mark dirty. A small
  follow-up either updates `isMutating()` or moves dirty-marking
  from the dispatcher case-ladder into engine setters themselves
  so it tracks intent more accurately.

### 2026-05-17 · Screen 8 Batch 4 (Spawner + Import Emitters + Mod Nickname)

Three Screen-8 sub-dialogs in one dispatch, plus meaningful schema
work: `SpawnerParamsDto` (real struct mirroring `SpawnerConfig`
from [src/SpawnerDriver.h:18]) and `EmitterTreeNode` (minimal:
`{ id, name, children }`) replace the `Record<string, unknown>`
placeholders. The third dispatch in a row using the
forward-deferred-C++ pattern from Batches 1 and 3 — the bridge
contract is wired end-to-end, MockBridge does the real work, the
C++ side logs + emits state-changed and waits for `ParticleSystem*`
+ `SpawnerDriver*` + `FileManager*` to land on the new-UI host.

Commit: `6845d37` (single feat — no new deps). Tests 72 Vitest
(63 → 72) + 43 Playwright (38 → 43). MSBuild 0/0.

**Locks worth surfacing for future batches:**
- *Full-config commit on every input is the right shape for
  Spawner.* `SpawnerDriver::SetConfig` already does full-replace
  (resets the burst-state machine), so a partial-update bridge
  call would just split one request into N and force the host to
  compose them back. The `lastCommitted` ref pattern in
  SpawnerPanel.tsx (snapshot → state/changed handler ignores its
  own commits) breaks the echo loop without needing draft state.
  This pattern is reusable for any future panel where the engine
  config struct is replaced wholesale rather than patched.
- *Real DTOs replacing placeholders unblock Screen 4.*
  `EmitterTreeNode` is intentionally minimal (id + name +
  children) so Screen 4 can add fields (texture path, link-group
  id, blend mode, etc.) without churning the existing import-
  preview surface. Same pattern any future screen extending a
  shared DTO should follow: add fields, don't restructure.

**Implementer surprises (from the subagent's report):**
1. *Mod Nickname route navigation broke CDP-attached tests.*
   Navigating the existing Playwright-driven page to
   `?demo=mod-nickname` destroyed `window.bridge` and broke every
   subsequent toolbar/tools spec in the run. Fix: expose
   `window.__promptModNickname` (mirrors `window.bridge`'s
   diagnostic-only pattern from earlier batches) so the dialog
   can be opened from the existing page without a navigation.
   The demo route still works for design checkpoints outside CDP.
   **Generalizable lesson**: under the `--test-host` CDP-attached
   Playwright pattern, prefer in-page programmatic triggers over
   route navigation to keep the `window.bridge` reference alive.
   Worth folding into `lessons.md` as L-006 if it bites again.
2. *Custom radio over Radix Radio Group.* Radix's
   `@radix-ui/react-radio-group` isn't a current dep. Two radios
   (Manual / Auto) don't justify pnpm-lock churn. Native
   `<input type="radio">` under `role="radiogroup"` covers
   keyboard nav + accessibility for free and drives cleanly under
   jsdom (no pointer-capture shim needed). Generalizable: reach
   for Radix when the primitive is non-trivial (Menubar, Popover,
   ContextMenu) but accept native HTML for trivial inputs
   (radios, plain text inputs).
3. *Forward-defer was unambiguous for preview-from-file.* Legacy
   `DoImportEmittersFromFile` ([src/main.cpp:7525]) depends on
   `info->fileManager` AND `info->hMainWnd`; the new-UI host
   has neither. Factoring `ImportEmitters_LoadFile` out would
   require lifting `FileManager` ownership out of
   `APPLICATION_INFO` — that's the file-load batch's work, not
   this batch's. Forward-defer + MockBridge providing the real
   3-emitter tree keeps the UI flow exercisable end-to-end.

**Open follow-ups for future batches:**
- *Real `SpawnerDriver` instantiation* on the new-UI host. Once
  the host owns a `SpawnerDriver*`, swap the forward-deferred
  `m_spawnerConfig = params` for `m_spawnerDriver->SetConfig(
  params)`. One-line change. Active-count event already plumbed.
- *Real `emitters/preview-from-file`* — pending `FileManager*`
  ownership on the new-UI host. Same batch as ParticleSystem
  wiring.
- *Mod Nickname auto-trigger* on file-load with unknown mod
  path — pending the file-load batch.
- *L-006 candidate*: under `--test-host`, prefer programmatic
  in-page triggers (`window.__foo`) over route navigation to
  preserve the `window.bridge` reference. Three batches in
  before this bit; one more recurrence and it earns a lesson
  entry.

### Screen 8 progress summary (after Batches 1-4)

| Sub-dialog | Status |
|---|---|
| About | ✅ Batch 1 |
| Rescale System | ✅ Batch 1 |
| Background picker | ✅ Phase 2 (refactored to ToolPanel in Batch 2) |
| Lighting | ✅ Batch 2 |
| Bloom settings | ✅ Batch 2 |
| Ground Texture Picker | ✅ Batch 2 |
| File-ops backbone | ✅ Batch 3 |
| Spawner | ✅ Batch 4 |
| Import Emitters | ✅ Batch 4 |
| Mod Nickname | ✅ Batch 4 |
| Rescale Emitter | ⏸ blocked on Screen 4 |
| Increment Index | ⏸ blocked on Screen 4 |
| Link Group Settings | ⏸ blocked on Screen 4 |

10 of 13 Screen 8 sub-dialogs shipped. Remaining 3 all wait on
Screen 4 (Emitter tree) for their trigger sites.
