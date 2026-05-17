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

**Design checkpoint:** 🟡 pending

**Wire-up:** 🟡 pending

**Current behaviour (legacy):**

Each dialog is a separate Win32 modal (or modeless tool window for
Lighting). Consistent OK / Cancel button placement. Some use
owner-drawn controls (Lighting's RGB swatches, Spawner's curve
preview). All have keyboard navigation (Tab cycle, Esc to cancel,
Enter to OK).

**Design notes / sketches:**

> _User: tackle each dialog as a sub-checkpoint within this screen.
> Modeless tool windows (Lighting) — embed as a panel in main shell,
> or separate floating window? "OK / Cancel" affordance style? Form
> validation style (inline errors vs. summary toast)?_

**Sub-screens to check off individually:**

- [ ] Lighting dialog — 🟡 pending
- [x] Background picker — ✅ design complete (Task 2.3, browser-mode picker against MockBridge)
- [ ] Ground picker — 🟡 pending
- [ ] Import Emitters — 🟡 pending
- [ ] Rescale — 🟡 pending
- [ ] Increment Index — 🟡 pending
- [ ] Mod Nickname — 🟡 pending
- [ ] Spawner — 🟡 pending
- [ ] Link Group Settings — 🟡 pending
- [ ] About — 🟡 pending

**Bridge surface used:** filled in at Task 3.8.1 (per sub-screen).

**Decisions locked once ✅:**

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
