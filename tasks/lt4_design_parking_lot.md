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

**Design checkpoint:** ✅ shipped 2026-05-17 across Batches A → B1 → B2 → B3 → C.

**Wire-up:** ✅ shipped 2026-05-17 across Batches A → B1 → B2 → B3 → C.

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

**Bridge surface used:** filled in per batch (see "Decisions locked"
below).

**Decisions locked:**

### Batching strategy (locked 2026-05-17)

Screen 4 is the load-bearing surface — drag-reorder, multi-select,
inline rename, link-group badges, context menus. Original handoff
estimate: ~1 week. Too big for one dispatch. Splits into three
batches, each independently shippable:

- **Batch A — Foundation (read-only tree + selection).** Real
  `emitters/list` impl (was placeholder), `emitters/select` +
  `emitters/selected` event wiring, `selectedEmitterId` on
  `EngineStateDto`, React `EmitterTree` replacing the sidebar
  placeholder. NO mutations, NO drag/drop, NO context menu, NO
  rename. Just see + click-to-select.
- **Batch B — Manipulation (mutate + drag-reorder + context
  menu).** Duplicate / delete / drag-reorder. Wires the three
  Screen-4-blocked Screen-8 sub-dialogs (Rescale Emitter,
  Increment Index, Link Group Settings) via the new context
  menu. Multi-select state. `emitters/update` + new mutation
  bridge calls.
- **Batch C — Polish (link-group visuals + inline rename +
  keyboard nav).** Link-group bracket badges (MT-9 port).
  F2/double-click inline rename. Keyboard nav (arrows, Enter,
  Delete, Cut/Copy/Paste).

Each batch ends with all gates green and a commit. The full
Screen 4 ✅ flips after Batch C.

### Batch C — Link-group brackets + inline rename + keyboard nav + clipboard (locked 2026-05-17)

The polish batch that closes Screen 4. Four sub-features:

1. **Link-group bracket visualisation** (MT-9 port). Coloured
   vertical brackets in the tree's right gutter spanning rows in
   the same group. Single-lane simplification of the legacy's
   multi-lane DPI-aware rendering (multi-lane = overlapping
   group ranges; defer to a future polish batch if needed).
2. **Inline rename**. F2 on focused row OR double-click → enter
   rename mode (input replaces label). Enter commits via
   `emitters/rename`; Esc cancels; blur commits. Replaces B1's
   modal-based `RenameEmitterDialog`.
3. **Keyboard navigation**. Arrow Up/Down moves focus through
   flat tree order. Enter opens context menu (or activates
   primary action). Delete fires `emitters/delete` on the
   multi-selection. F2 starts inline rename. No Ctrl+A (defer).
4. **Cut/Copy/Paste** (3 new bridge calls). Internal clipboard
   on the C++ host serialises selected emitters + subtrees;
   paste deserialises as new roots. Ctrl+C / Ctrl+X / Ctrl+V
   keyboard shortcuts wired.

**Schema additions (3 new bridge call kinds):**

- `emitters/copy { ids: number[] }` → `Record<string, never>`.
  Serialises the named emitters + their subtrees to the host's
  internal clipboard. No tree mutation, no dirty flag.
- `emitters/cut { ids: number[] }` → `Record<string, never>`.
  Same serialise + then deletes the emitters. Captures undo,
  emits `emitters/tree/changed` + `dirty/changed`.
- `emitters/paste { afterId?: number }` → `{ newIds: number[] }`.
  Deserialises clipboard contents as new roots. `afterId` is
  optional — if provided, inserts after the named root; else
  appends at the end of roots. Captures undo, emits tree-changed
  + dirty.

**Bracket visualisation:**

- Per-render computation:
  1. Walk the flattened tree (already maintained from B2).
  2. For each unique `linkGroup > 0`, record `firstRowIndex`
     and `lastRowIndex` (the position in the flat list).
  3. Assign a colour per group from a small palette (8 colours
     cycled — matches legacy's `kBracketPalette` shape).
- Render in EmitterTree:
  - The tree container gets a right-side gutter (16px).
  - For each group, render a vertical `<div>` (or SVG line)
    positioned at `top: firstRowIndex * rowHeight + rowHeight/2`,
    `height: (lastRowIndex - firstRowIndex) * rowHeight`,
    `width: 2px`, `background: groupColor`, plus 4px-wide top
    + bottom caps (small horizontal stubs).
  - Single-lane only: when two groups would overlap in row
    range, all brackets render in the same lane (one will be
    visually behind the other). Multi-lane = future polish.

**Inline rename:**

- State in EmitterTree: `editing: { id: number; value: string } | null`.
- Triggers:
  - F2 on focused row when `editing === null`.
  - Double-click on a row's label (not the role glyph).
  - Right-click context menu → Rename now sets `editing` instead
    of opening the modal. **Remove `RenameEmitterDialog` from
    App.tsx mount; remove the modal trigger from `tree-context`
    atom's `open` union.** (Deletion of dead code.)
- During editing: row renders an `<input>` instead of the label
  span. Auto-focus + select-all on mount.
- Commit on: Enter, blur, click outside. Fires
  `emitters/rename { id, name: value }`.
- Cancel on: Esc. No bridge call.
- Validation: empty name → revert to original (no commit). No
  uniqueness check (legacy doesn't enforce).

**Keyboard navigation:**

- Tree container is `tabIndex={0}` so it can receive focus.
  Each row's button is the focus target.
- On row button focus:
  - Arrow Down → move focus to the next row in flat order.
  - Arrow Up → previous row.
  - Home → first row. End → last row.
  - Enter → open context menu (or activate primary action; B3
    of the legacy probably opens props panel — defer that to
    Screens 5/6).
  - F2 → enter rename mode.
  - Delete → `emitters/delete` on the multi-selection (calls
    delete for each id, OR a new bulk delete kind — subagent
    decides; if single-emitter delete works, looping is fine).
  - Ctrl+C / Ctrl+X / Ctrl+V → clipboard ops on selection.
- Don't intercept keystrokes when an `<input>` is focused (so
  inline rename and Spinners + text fields elsewhere work).
  Detect via `event.target.tagName` check.

**C++ host clipboard (`BridgeDispatcher` member):**

- Add `std::vector<uint8_t> m_clipboard` (or `std::optional` of
  a serialised buffer) to BridgeDispatcher.
- `emitters/copy { ids }`: clear clipboard, then for each id,
  serialise the emitter + its subtree to a buffer using the
  same `MemoryFile` + `Emitter::write(writer, copy=true)` pattern
  as LT-3's import-from-file. Store the resulting bytes.
- `emitters/cut { ids }`: do `copy` semantics, then delete each
  via the existing `ParticleSystem::deleteEmitter`. Capture undo
  once at the start, emit tree-changed once at the end (single
  atomic "cut" operation).
- `emitters/paste { afterId? }`: deserialise the clipboard buffer
  back into a temporary set of emitters via `Emitter(ChunkReader&)`
  pattern from LT-3 import. Insert each as a new root, optionally
  positioned via `moveEmitterToRootIndex` after the named
  `afterId`. Capture undo, emit tree-changed.

**MockBridge clipboard:**

Internal `clipboard: EmitterTreeNode[]` array in `mock-state`.
- `copy`: extract the named nodes from the tree, deep-clone, store.
- `cut`: copy + delete from the tree.
- `paste`: deep-clone the clipboard, splice into roots (or after `afterId`).

**Test surface for Batch C:**

- **Vitest** (+10 specs, target 109 → 119+):
  - `bridge-contract.test.ts` (+3): one round-trip per clipboard kind.
  - `EmitterTree.test.tsx` (+5): bracket renders for grouped rows;
    F2 enters rename; Enter commits rename via emitters/rename;
    Esc cancels rename; arrow-down moves focus.
  - `clipboard` (+2 in a new spec or in EmitterTree.test.tsx):
    Ctrl+C dispatches emitters/copy with selection ids; Ctrl+V
    dispatches emitters/paste.
- **Playwright** (+3 specs, target 59 → 62+):
  - F2 on focused row opens inline editor (assert `<input>`
    visible in the row); Enter commits + tree shows new name.
  - Delete key fires emitters/delete on selection (assert tree
    row count decreases).
  - Copy + Paste round-trip via the bridge directly (Ctrl+C/V
    in CDP can be flaky; bridge-driven is fine per B3 precedent).

**Legacy delete:**

NOT in Batch C. `EmitterList.cpp` polish features stay for
`--legacy-ui` until Phase 4.2.

**Open follow-ups** (Screen 4 fully ✅ after this batch):
- *Multi-lane bracket rendering* — when two groups have
  overlapping row ranges. Future polish.
- *Slot-picker popup for reparent* — auto-pick suffices for
  most cases; popup is a future polish.
- *Paste-as-Lifetime / Paste-as-Death context-menu items* —
  legacy has these (`ID_PASTEAS_LIFETIME` / `ID_PASTEAS_DEATH`
  at [src/UI/EmitterList.cpp:3747-3748]). Bridge call could
  extend `emitters/paste` with `asChildOf?: number; slot?:
  "lifetime" | "death"` params later.
- *Ctrl+A select all* — future polish.

### Batch B3 — Drag/drop reorder + reparent (locked 2026-05-17)

Final structural Screen 4 batch. HTML5 drag-and-drop on tree rows
with visual feedback for insert-between-rows (reorder among roots)
vs drop-on-row (reparent under target). After this batch only
Batch C (polish: link-group brackets, inline rename, keyboard nav)
remains on Screen 4. ParticleSystem already exposes the needed
public methods (`reparentEmitter`, `moveEmitterToRootIndex`) —
zero legacy factor-out expected.

**Schema additions (1 new bridge call kind):**

`emitters/drop` — tagged-union to keep the two semantics cleanly
separated:

```ts
| { kind: "emitters/drop"; params:
    | { mode: "reorder";  id: number; rootIndex: number }
    | { mode: "reparent"; id: number; targetId: number; slot: "lifetime" | "death" }
}
```

Returns `Record<string, never>` on success; `{ ok: false; error:
string }` on refusal (cycle, slot full, etc.) — actually use the
union response shape:

```ts
R extends { kind: "emitters/drop" } ? { ok: true } | { ok: false; error: string }
```

**C++ host implementation:**

- `mode: "reorder"`: `(*m_pps)->moveEmitterToRootIndex(emitter, rootIndex)`. The legacy uses `gap` semantics — verify the exact contract by reading the method's signature (probably "insert at gap N where gap 0 is before first root, gap 1 is between root 0 and root 1, etc."). React side computes `rootIndex` from the drop position.
- `mode: "reparent"`: `(*m_pps)->reparentEmitter(source, target, useSpawnDuringLife)`. `useSpawnDuringLife: bool` = `slot === "lifetime"`. The method may return false on refusal (cycle detection, slot full) — surface as `{ ok: false; error: "..." }`.
- Capture undo before either mutation. Emit `emitters/tree/changed` + `engine/state/changed` + `dirty/changed` after.

**MockBridge implementation:**

Mutate `mock-state`'s tree the same way:
- Reorder: lift the emitter out, splice into roots at `rootIndex`.
- Reparent: detach from current parent, attach as child of target in the named slot. Refuse if cycle (target is descendant of source) or if slot is already filled.

Emit `emitters/tree/changed` after.

**React DnD on EmitterTree rows:**

Use HTML5 DnD API directly (no library dependency). Each row gets:
- `draggable={true}` attribute.
- `onDragStart`: store the dragged emitter id (in component state or a Zustand atom; subagent picks). Set `event.dataTransfer.effectAllowed = "move"`.
- `onDragOver`: detect drop zone via y-position relative to row rect (`event.clientY - rect.top` vs `rect.height / 3`). Three zones:
  1. Upper third → reorder above this row (insertion line at top).
  2. Middle third → reparent under this row (tinted target).
  3. Lower third → reorder below this row (insertion line at bottom).
  Must call `event.preventDefault()` to allow drop. Update local "drop indicator" state for visual feedback.
- `onDragLeave`: clear the drop indicator if the leave is to outside the row (DnD events bubble in weird ways; check `event.relatedTarget` or use a debounce).
- `onDrop`: compute the final intent (mode + params), validate (no drops on self, no drops on descendant), call the bridge `emitters/drop` with the resolved params. Clear drop indicator.
- `onDragEnd`: clear drop indicator on the source (covers cancellation cases).

**Visual feedback styling:**

- Insertion line: 2px `bg-sky-400` horizontal line at the top/bottom of the row during dragover.
- Tinted target (reparent): `bg-sky-500/30 ring-1 ring-sky-400` on the row during dragover.
- Refused drop (cycle, slot full): no visual indication during dragover. The drop just doesn't fire the bridge call. (Cursor stays as "no-drop" automatically when `event.preventDefault()` is NOT called during dragover.)

**Slot auto-pick during reparent:**

The React side resolves `slot` before calling:
- Both slots free → `slot = "lifetime"` (matches legacy auto-pick).
- Only lifetime free → `slot = "lifetime"`.
- Only death free → `slot = "death"`.
- Both filled → don't call bridge (refuse).

Use the target's `children` array from the existing EmitterTreeDto to determine slot occupancy (each child has a `role` field per Batch A — `role === "lifetime"` means lifetime slot is filled).

**Validation rules:**

- Drop on self: no-op. Detect via `dragged.id === drop.id`.
- Drop on descendant (would create cycle): refuse. Walk the dragged emitter's subtree before allowing drop on a candidate target.
- Drop in reparent zone on a target with both slots filled: refuse.
- Drop in reorder zones is always valid for roots (the gap index is clamped to the roots list bounds).

The validation runs in `onDragOver` to suppress the drop indicator for invalid targets (and call `event.preventDefault()` only for valid ones — Windows shows the no-drop cursor when preventDefault is skipped).

**Test surface for Batch B3:**

- **Vitest** (+4 specs, target 105 → 109+):
  - `bridge-contract.test.ts` (+2): `emitters/drop { mode: "reorder", id, rootIndex }` reorders the fixture roots; `emitters/drop { mode: "reparent", id, targetId, slot }` reparents in the fixture tree.
  - `EmitterTree.test.tsx` (+2): dragover-then-drop on upper third fires `emitters/drop` with `mode: "reorder"` and the right rootIndex; dragover-then-drop on middle third fires `emitters/drop` with `mode: "reparent"` and auto-picked slot.
- **Playwright** (+2 specs, target 57 → 59+):
  - Drag a root row over another root, drop in the lower third → root order changes (observe via snapshot's tree).
  - Drag a root row onto another root's middle third → reparent (observe new parent in tree).
  - **Note**: Playwright's `dragTo` / `dragAndDrop` may need explicit `{ sourcePosition, targetPosition }` to land in the right third. If flakiness, use the underlying bridge call directly in the spec (skip the actual mouse drag) and assert only the C++ side works — the React drag handlers are then verified by Vitest only.

**Legacy delete:**

NOT in Batch B3. Legacy `EmitterList.cpp` drag/drop handlers stay
for `--legacy-ui` until Phase 4.2.

**Open follow-ups** (Batch C):
- Link-group bracket visualisation (MT-9 port) → Batch C.
- F2 / double-click inline rename → Batch C.
- Keyboard nav (arrows / Enter / Delete / Cut / Copy / Paste) →
  Batch C.

### Batch B2 — Add child + Move Up/Down + Link Group membership + multi-select (locked 2026-05-17)

Third of the three-batch Screen 4 sequence (after B1). Smaller scope
than B1 — 4 new bridge call kinds + 1 new modal + 6 new context menu
items + Zustand-driven multi-select. After this batch only Batch B3
(drag/drop) and Batch C (polish: link-group brackets, inline rename,
keyboard nav) remain on Screen 4.

**Schema additions (4 new bridge call kinds):**

- `emitters/add-lifetime-child { parentId: number }` → `{ newId: number }`. Wraps `ParticleSystem::addLifetimeEmitter(parent, Emitter())`. New emitter inherits the parent's `spawnDuringLife` slot.
- `emitters/add-death-child { parentId: number }` → `{ newId: number }`. Wraps `ParticleSystem::addDeathEmitter`. Same shape.
- `emitters/move { id: number; direction: "up" | "down" }` → `Record<string, never>`. Reorders the emitter among its siblings via the existing root-reorder helper (from NT-3-era — find it in `ParticleSystem.h` or legacy `EmitterList.cpp`). For roots, swap with adjacent root; for children, swap with sibling within the parent's lifetime/death slot. (Per legacy `MoveEmitterUp` / `MoveEmitterDown`.)
- `linkGroups/set-membership { ids: number[]; groupId: number | null }` → `Record<string, never>`. `null` = leave (each emitter's `linkGroup` set to 0); `groupId > 0` = join the named group; `groupId === -1` = create a new group with these emitters (server picks an unused group ID).

**No event additions.** `emitters/tree/changed` (B1) and
`emitters/selected` (Batch A) cover all the necessary React-side
updates.

**Multi-select stays React-side.**

Server tracks only the `primarySelectedEmitterId` (the focus row,
the one that owns keyboard nav once Batch C lands). React maintains
a `Set<number>` of all selected ids in a new
`web/apps/editor/src/lib/emitter-selection.ts` Zustand atom. Batch
operations (Set Link Group, Leave Link Group) take `ids: number[]`
as input — no server-side multi-select state needed.

- **Ctrl/Cmd+click** toggles a row's membership in the set
  (without changing the primary).
- **Shift+click** selects the range from the primary to the
  clicked row (along the tree's visual order, NOT the underlying
  index — match legacy).
- **Plain click** sets the selection to `{ ids: [id], primary: id }`
  (replaces).
- Click outside the tree clears the selection.

**Context menu additions** (after the existing B1 items, with
separators):

After the existing `Link Group Settings…` item:
- ─── separator ───
- **Add Lifetime Child** — disabled when the emitter already has a
  lifetime child (`spawnDuringLife !== (size_t)-1`).
- **Add Death Child** — disabled when the emitter already has a
  death child (`spawnOnDeath !== (size_t)-1`).
- ─── separator ───
- **Move Up** — disabled when the emitter is the first sibling (no
  prior root or no prior in-slot child).
- **Move Down** — disabled when the emitter is the last sibling.
- ─── separator ───
- **Set Link Group…** — opens `SetLinkGroupDialog`. Operates on
  the full multi-selection (uses `lib/emitter-selection.ts`'s
  `ids`).
- **Leave Link Group** — fires `linkGroups/set-membership { ids,
  groupId: null }`. Disabled when every selected emitter has
  `linkGroup === 0`.

**New modal `SetLinkGroupDialog.tsx`:**

- Triggered from "Set Link Group…" context-menu item.
- Body: radio group with two options:
  1. **Create new group** (selected by default). Shows a small
     hint "All N selected emitters will be linked together as a
     new group."
  2. **Join existing group**: shows a `<select>` of existing group
     IDs (gathered from the live tree's `linkGroup` values, deduped
     and sorted). Disabled when no existing groups exist.
- Footer: Cancel + OK. OK fires `linkGroups/set-membership { ids,
  groupId: -1 }` for "new" or `linkGroups/set-membership { ids,
  groupId: <chosen> }` for "existing".

**C++ host implementations:**

- `emitters/add-lifetime-child` / `add-death-child`: call the
  matching `ParticleSystem::add*Emitter(parent, Emitter())`.
  Capture undo. Emit `emitters/tree/changed`. Return the new
  emitter's `id` (its index in `getEmitters()`).
- `emitters/move`: legacy has `MoveEmitterUp` / `MoveEmitterDown`
  helpers in `EmitterList.cpp` (find them — search for `swap` or
  `reorder` near the move handlers). They typically work on roots
  only — for children, swap is constrained by the parent's
  `spawnDuringLife`/`spawnOnDeath` slot structure (a child can only
  swap with a sibling of the SAME role, i.e. another lifetime child
  or another death child; emitters typically have just 0 or 1 of
  each so move-within-children may be a no-op for most cases).
  Capture undo + emit tree/changed.
- `linkGroups/set-membership`: walk `ids`, set each emitter's
  `linkGroup`. For `groupId === -1` ("new group"), find the
  smallest unused positive uint32_t (start at 1, scan existing
  emitters' linkGroup values). For `groupId === null`, set to 0.
  Capture undo + emit tree/changed.

**MockBridge implementations:**

- Add child handlers: mutate `mock-state`'s tree, push a new
  emitter into the parent's lifetime/death slot. Emit
  `emitters/tree/changed`.
- Move handler: swap with adjacent sibling in the fixture tree.
- Set-membership: update `linkGroup` on each id; for `groupId ===
  -1`, MockBridge picks the next unused positive integer.

**React side wiring:**

- `EmitterTree.tsx`: extend with multi-select click handling
  (ctrl/cmd/shift detection on row click) + render the new
  context-menu items with their disabled states.
- `App.tsx`: mount `SetLinkGroupDialog`, wire it into the
  `tree-context.ts` atom (extend the `open` union with
  `"set-link-group"`).
- `lib/emitter-selection.ts` (new): Zustand store with `ids:
  Set<number>` + `primary: number | null`, plus actions
  `setSingle(id)`, `toggle(id)`, `range(fromId, toId, treeOrder)`,
  `clear()`. Selector hooks subscribe to scalars per the L-005
  pattern.
- Selected rows: a row is "in selection" if its id is in `ids`; the
  PRIMARY row gets a sharper border style (`border-l-2
  border-sky-500`) while non-primary selected rows get a lighter
  style (`border-l-2 border-sky-400/50`). Both get the
  `bg-sky-500/15` background.

**Test surface for Batch B2:**

- **Vitest** (+8 specs, target 90 → 98+):
  - `bridge-contract.test.ts` (+4): one round-trip per new kind.
  - `SetLinkGroupDialog.test.tsx` (1): renders "Create new"
    radio + Cancel/OK; OK with "Create new" fires
    `linkGroups/set-membership { ids, groupId: -1 }`.
  - `EmitterTree.test.tsx` (+2): Ctrl+click toggles selection;
    Shift+click selects range.
  - `emitter-selection.test.ts` (1): `toggle()` adds + removes;
    `range()` selects in tree order.
- **Playwright** (+3 specs, target 54 → 57+):
  - Add Lifetime Child via context menu adds a lifetime child to
    the selected emitter (observe `tree/changed` with new emitter
    having `role: "lifetime"`).
  - Move Down via context menu swaps siblings (observe tree
    order change).
  - Ctrl+click multi-selects (observe React state via a
    `data-selected-count` attribute on the tree container).

**Legacy delete:**

NOT in Batch B2. `EmitterList.cpp` mutations stay for `--legacy-ui`
until Phase 4.2.

**Open follow-ups** (Batches B3 + C):
- Drag/drop reordering + reparent → Batch B3.
- Link-group bracket visualisation (MT-9 port) → Batch C.
- F2 / double-click inline rename → Batch C.
- Keyboard nav (arrows / Enter / Delete / Cut / Copy / Paste) →
  Batch C.

### Batch B1 — Mutations + context menu + 3 Screen-8 sub-dialogs (locked 2026-05-17)

Mid-batch in the three-batch Screen 4 sequence. Adds the essential
mutations (duplicate, delete, rename), wires the right-click
context menu on tree rows, and ships the three Screen-8 sub-dialogs
blocked on Screen 4 (Rescale Emitter, Increment Index, Link Group
Settings). After this batch, 13 of 13 Screen 8 sub-dialogs are
shipped — the parking-lot Screen 8 checkbox list fully flips. Drag/
drop, Add Lifetime/Death Child, Set/Leave Link Group, Move Up/Down,
multi-select, inline rename, and keyboard nav stay deferred to
Batches B2 + C.

**Schema additions (8 new bridge call kinds):**

- `emitters/duplicate { id: number }` → `{ ok: true; newId: number } | { ok: false; error: string }`. Duplicates the emitter + its subtree as a new root (matches legacy `EmitterList_DuplicateEmitter` semantics).
- `emitters/delete { id: number }` → `Record<string, never>`. Removes the emitter + its subtree (matches legacy `EmitterList_DeleteEmitter`).
- `emitters/rename { id: number; name: string }` → `Record<string, never>`. Sets the emitter's name.
- `emitters/duplicate-with-index-increment { id: number; delta: number }` → `{ newId: number }`. Duplicates and bumps an in-name numeric suffix by `delta` (legacy increment-index flow).
- `engine/action/rescale-emitter { id: number; durationScalePercent: number; sizeScalePercent: number }` → `Record<string, never>`. Per-emitter rescale via `DoRescaleEmitter` (already exposed in `src/Rescale.h` per host-state-plumbing batch).
- `linkGroups/list-exempt-fields { groupId: number }` → `{ fields: string[] }`. Reads the exempt field set for a group.
- `linkGroups/set-exempt-fields { groupId: number; fields: string[] }` → `Record<string, never>`. Replaces the exempt set.
- `linkGroups/reset-exempt-fields { groupId: number }` → `Record<string, never>`. Clears the exempt set (resets to "everything inherited").

**Event additions:**

- `emitters/tree/changed { tree: EmitterTreeDto }` already in schema (Batch A wired the React subscription). C++ host **starts emitting** this after every mutation in Batch B1 (was no-op until this batch). MockBridge already emits it from mutation paths.

**C++ host work** (`BridgeDispatcher.cpp` + handlers):

- **`emitters/duplicate`**: call `(*m_pps)->insertEmitterAfter(referenceEmitter, sourceEmitter)`. The `referenceEmitter` is the last root in the tree (matches legacy "duplicates land as roots after existing roots"); `sourceEmitter` is a copy of the source emitter. Capture undo. Emit `emitters/tree/changed` + `engine/state/changed` + dirty. Return `{ ok: true, newId: <new index> }`.
- **`emitters/delete`**: `(*m_pps)->deleteEmitter(emitter)`. Capture undo. Emit tree-changed + state-changed + dirty. If the deleted emitter was selected, clear `m_selectedEmitterId` and emit `emitters/selected { id: null }`.
- **`emitters/rename`**: `emitter.setName(name)`. Capture undo. Emit tree-changed + dirty. (No `engine/state/changed` needed — name isn't in the snapshot's engine state fields, but `emitters/tree/changed` will trigger React to re-fetch the tree which carries the new name.)
- **`emitters/duplicate-with-index-increment`**: legacy `EmitterList_DuplicateEmitter(hWnd, indexDelta)` at [src/UI/EmitterList.cpp:4707]. Read the legacy to find the index-bump algorithm (probably regex on name's trailing number suffix + bump by delta; if no suffix, append the delta). Mirror it in the C++ handler. Same capture-undo + tree-changed + dirty pattern.
- **`engine/action/rescale-emitter`**: `DoRescaleEmitter(emitterPtr, dScale/100.0f, sScale/100.0f)` from `src/Rescale.h`. Capture undo. Emit tree-changed + dirty.
- **`linkGroups/list-exempt-fields`**: there's MT-10 infrastructure in legacy somewhere — find it. The exempt set is a `std::set<std::string>` (or similar) keyed by group ID, persisted in the .alo's MT-10 chunk. Read out the set, return as a `string[]`. **Subagent decision**: if the legacy MT-10 implementation isn't cleanly accessible from outside `EmitterList.cpp`, factor a tiny helper into `src/LinkGroups.h` (or fold into `src/ParticleSystem.h` if it lives on the system). Forward-defer with `{ fields: [] }` placeholder + TODO if structural factor-out is too tangled.
- **`linkGroups/set-exempt-fields`**: same access pattern, write the set. Capture undo. Emit tree-changed (because the visual representation of linked emitters may change) + dirty.
- **`linkGroups/reset-exempt-fields`**: clear the set. Same path as set with `fields: []`.

**MockBridge implementations:**

Mutate `mock-state` directly. The fixture tree gets mutated on each call. Maintain consistency: after duplicate, the new emitter appears in the tree at the right position; after delete, it disappears; etc. Emit `emitters/tree/changed { tree }` after each mutation so the React side re-renders.

**React side:**

- **Context menu on tree rows** — wrap each row in a Radix `ContextMenu`. Items (with separators):
  1. **Rename** — opens `RenameEmitterDialog` (simple text-input modal; inline rename is Batch C).
  2. **Duplicate** — `emitters/duplicate { id }`. No prompt.
  3. **Delete** — `emitters/delete { id }`. No confirmation prompt in Batch B1 (legacy doesn't have one either).
  4. ─── separator ───
  5. **Increment Index…** — opens `IncrementIndexDialog`.
  6. **Rescale Emitter…** — opens `RescaleEmitterDialog`.
  7. ─── separator ───
  8. **Link Group Settings…** — opens `LinkGroupSettingsDialog`. **Disabled** when `emitter.linkGroup === 0`. The disabled state shows a tooltip "Emitter is not in a link group".

- **New modals** under `web/apps/editor/src/screens/`:
  - `RenameEmitterDialog.tsx`: single text input + OK/Cancel. Pre-fills with current name. OK fires `emitters/rename { id, name }`.
  - `IncrementIndexDialog.tsx`: single Spinner (label "Increment by N", default 1, min 1, max 99, no unit). OK fires `emitters/duplicate-with-index-increment { id, delta }`.
  - `RescaleEmitterDialog.tsx`: mirrors `RescaleDialog.tsx` (Rescale System) — 2 Spinners (Duration %, Size %), OK/Cancel. Title "Rescale Emitter". Hint text below: "Applies to the selected emitter only. Use *Rescale Particle System…* to rescale the entire system." OK fires `engine/action/rescale-emitter { id, durationScalePercent, sizeScalePercent }`.
  - `LinkGroupSettingsDialog.tsx`: medium-sized modal. On mount, fires `linkGroups/list-exempt-fields { groupId }` to fetch current exempts. Renders a list of checkboxes for each field name. Toggling a checkbox does NOT auto-commit (matches legacy "OK to confirm" pattern). Footer: Reset All button (left), Cancel + OK (right). Reset All sets all checkboxes off in local state. OK fires `linkGroups/set-exempt-fields { groupId, fields }` with the checked fields. Cancel discards.

- **EmitterTree.tsx** updates:
  - Wrap each tree row's `<button>` in `<ContextMenu.Root>` + `<ContextMenu.Trigger>` (or use `<ContextMenu.Trigger asChild>` so the button is the trigger).
  - Mount the four new modal components in App.tsx, controlled by a small Zustand atom (`tree-context.ts` or similar) that holds `{ open: "rename" | "increment" | "rescale" | "link-group" | null; targetEmitterId: number | null; targetLinkGroupId?: number }`.
  - On `emitters/tree/changed` event arrival, re-fetch the tree via `emitters/list`. Already wired as a no-op in Batch A; B1 just makes the re-fetch real.

- **MenuBar.tsx** — no changes. Rescale Emitter / Increment Index / Link Group Settings have NO menu trigger (they live in the right-click context menu only, matching legacy).

**Test surface for Batch B1:**

- **Vitest** (+12 specs, target 78 → 90+):
  - `bridge-contract.test.ts` (+8): one round-trip per new kind.
  - `RenameEmitterDialog.test.tsx` (1): renders text input + OK fires emitters/rename.
  - `IncrementIndexDialog.test.tsx` (1): renders Spinner + OK fires duplicate-with-index-increment.
  - `RescaleEmitterDialog.test.tsx` (1): clicking OK fires engine/action/rescale-emitter.
  - `LinkGroupSettingsDialog.test.tsx` (1): renders exempt-field checkboxes from mock + Reset All clears them.
- **Playwright** (+4 specs, target 50 → 54+):
  - Right-click an emitter row opens the context menu.
  - Delete via context menu removes the emitter (assert tree row count decreases via snapshot or DOM).
  - Increment Index → OK fires the bridge call (observe via state/changed + tree/changed events).
  - Link Group Settings → renders exempt-field checkboxes (observe modal DOM); skip if Mock fixture doesn't have a linked emitter (subagent decision).

**Legacy delete:**

NOT in Batch B1. Legacy `EmitterList.cpp` mutations stay for `--legacy-ui` until Phase 4.2.

**Open follow-ups** (Batches B2 + C carryover):
- Add Lifetime/Death Child operations → Batch B2.
- Set Link Group / Leave Link Group operations → Batch B2.
- Move Up / Move Down → Batch B2 (or fold into drag/drop in B3).
- Multi-select state → Batch B2.
- Drag/drop reordering → Batch B3.
- Reparent via drag/drop → Batch B3.
- Link-group bracket visualisation (MT-9 port) → Batch C.
- F2 / double-click inline rename (replaces the modal from B1) → Batch C.
- Keyboard nav (arrows / Enter / Delete / Cut / Copy / Paste) → Batch C.

### Batch A — Foundation (locked 2026-05-17)

**Schema additions:**

- **Extend `EmitterTreeNode`** with role + link-group + visibility:
  ```ts
  type EmitterRole = "root" | "lifetime" | "death";
  type EmitterTreeNode = {
    id: number;
    name: string;
    role: EmitterRole;
    linkGroup: number;       // 0 = unlinked; non-zero = group ID
    visible: boolean;
    children: EmitterTreeNode[];
  };
  ```
  Existing fields (`id`, `name`, `children`) preserved — Batch 4's
  `emitters/preview-from-file` continues to work (preview tree
  populates the new fields too: role from source slot, linkGroup
  from source linkGroup, visible always true).
- **`EmitterTreeDto`** — keep the `{ root: EmitterTreeNode }`
  single-synthetic-root wrapper from Batch 4. The live tree's
  multiple real roots become children of the synthetic `id=-1`
  root. The wrapper stays so the existing import-preview path
  doesn't churn.
- **Extend `EngineStateDto`** with `selectedEmitterId: number | null`.
  Mirrors the existing `currentFilePath` / `dirty` / `spawner`
  pattern — fields the React side needs at mount without an
  extra round-trip.

**MockBridge:**

- `emitters/list` returns a fixture tree: 3 roots, one with a
  lifetime child + a death child, one with a lifetime child only,
  one bare. Populate `role` and `linkGroup` (one pair linked,
  rest unlinked) and `visible: true` for all.
- `emitters/select { id }` updates `mock-state.selectedEmitterId`,
  emits `emitters/selected { id }`, emits `engine/state/changed`
  with the new snapshot.
- `emitters/selected` event (already in schema) wired.
- `emitters/tree/changed` event NOT emitted yet (no mutations
  this batch).

**C++ host (`BridgeDispatcher.cpp` / `BridgeDispatcher.h`):**

- `emitters/list` — walk `(*m_pps)->getEmitters()`. Build the
  tree by:
  1. For each emitter `e`, identify role via parent slot:
     `e->parent == NULL` → root; else inspect parent's
     `spawnDuringLife` / `spawnOnDeath` indices to determine
     lifetime vs death.
  2. Collect roots into the synthetic-root's children. Recurse
     into each emitter's lifetime + death children if their
     `spawnDuringLife` / `spawnOnDeath` are valid indices.
  3. Populate `name`, `linkGroup`, `visible` from the emitter.
  4. Return `{ root: { id: -1, name: "", role: "root",
     linkGroup: 0, visible: true, children: [...] } }`.
- `emitters/select { id }` — store selection in HostWindowImpl
  state (new `int m_selectedEmitterId = -1` member, accessible
  via `BindHostState` extension OR a new `BindSelectedSlot`).
  Subagent decides: extend `BindHostState` if other state
  pointers benefit; otherwise add a separate `BindSelectedSlot`
  pointer to `int`. Emit `emitters/selected { id }` event.
  Update snapshot's `selectedEmitterId`.
- Snapshot extension: include `selectedEmitterId` in
  `BuildEngineStateSnapshot`.
- No `emitters/tree/changed` emission this batch (no mutations).

**React component** `web/apps/editor/src/screens/EmitterTree.tsx`:

- Replaces the placeholder at `App.tsx`'s sidebar (the
  `<aside>` block currently rendering "(placeholder — Phase 3
  Screen 4)" at [web/apps/editor/src/App.tsx:~91]).
- Reads tree via `bridge.request({ kind: "emitters/list" })` on
  mount. Subscribes to `emitters/tree/changed` (handler ready
  for Batch B; no-op until then). Subscribes to
  `emitters/selected` for selection updates.
- Renders the synthetic root's children as the top-level list.
  Each node:
  - Indented per depth (`pl-{depth*4}`).
  - Small role glyph (root: `●`, lifetime: `↻`, death: `✕`
    or similar — subagent picks). Greyed for `visible: false`.
  - Name (default font, semibold when selected).
  - Optional link-group dot (`bg-sky-500` size-2 rounded-full)
    when `linkGroup !== 0`. Tooltip shows "Link group <N>" on
    hover. Real coloured bracket comes in Batch C.
  - Click → fires `emitters/select { id }`. Selection state
    derived from snapshot's `selectedEmitterId` (no local
    state).
- Selected row: `bg-sky-500/15 border-l-2 border-sky-500`.
  Hover: `bg-neutral-900/40`.
- Empty tree state: greyed "(no emitters)" placeholder.

**State sync:**

- Initial mount: `emitters/list` round-trip OR pull from
  `engine/state/snapshot` if the snapshot includes the tree.
  **Decision: keep separate.** The snapshot already has
  `selectedEmitterId`; the tree itself stays a separate request
  because tree data is bigger (could be 100s of nodes for
  complex systems) and shouldn't ride every snapshot. Subscribe
  to `emitters/tree/changed` for live updates.
- On every `emitters/selected` event, re-derive the selected
  styling. No local selection state in the React side — the
  server is the source of truth.

**Test surface for Batch A:**

- **Vitest** (+4 specs, target 74 → 78+):
  - `bridge-contract.test.ts` (+2): `emitters/list` returns the
    fixture tree with role + linkGroup + visible populated;
    `emitters/select` updates `selectedEmitterId` in snapshot
    and fires `emitters/selected`.
  - `EmitterTree.test.tsx` (2): renders 3 roots from the fixture
    tree with lifetime/death children correctly indented;
    clicking a row fires `emitters/select` with the right id.
- **Playwright** (+2 specs, target 48 → 50+):
  - Sidebar renders the emitter tree (assert at least 3 rows
    visible with names).
  - Clicking a row updates `engine/state/snapshot.selectedEmitterId`.

**Legacy delete:**

NOT in Batch A. `EmitterList.cpp` (4955 LOC) stays for `--legacy-ui`.
Phase 4.2 removes it.

**Open follow-ups** (explicitly Batch B/C):
- Mutations (duplicate / delete / move / rename) → Batch B.
- Context menu → Batch B.
- Drag-and-drop → Batch B.
- Multi-select → Batch B.
- Link-group bracket visualization (MT-9 port) → Batch C.
- Inline rename (F2 / double-click) → Batch C.
- Keyboard nav → Batch C.
- Per-emitter property panel sync (Appearance / Physics / etc.
  tabs that the right-side panel will host) — separate batches.

---

## Screen 6 — Track editor

### Batching strategy (locked 2026-05-17)

Screen 6 is the shell around the curve editor canvas. It also
unblocks the **right-side emitter property panel**, which doesn't
exist in `--new-ui` yet — Screen 4's selection event currently
goes nowhere visible. Splitting:

- **Batch A — Foundation (read-only).** Right-side property panel
  skeleton that appears on emitter select. TrackEditor shell with
  toolbar + lock-to combo (visual only). Read-only SVG-based
  CurveEditor sub-component. 1 new bridge call (`emitters/get-tracks`).
  No interaction; this is the profiling vehicle for SVG-vs-canvas.
- **Batch B (== Screen 5 work)** — Full CurveEditor interaction:
  click to select keys, drag to move, click-to-add, interpolation
  toggle, delete key. Plus the toolbar buttons in TrackEditor's
  shell become functional.

The shell-then-canvas split lets the foundation ship without
fighting the 1044-LOC CurveEditor.cpp port simultaneously.

### Screen 6 Batch B-β — Drag-to-move + Click-to-add + Insert mode + Spinner sync + Border visual (locked 2026-05-17)

Second half of curve editor interaction. After this batch users can
drag keys to move them, click on empty canvas in Insert mode to add
keys, and edit selected key values via the Spinner controls. Border
keys render with a different visual cue. Lock-to functional behaviour
+ Shift+click 2D range deferred (lock-to is a small follow-up batch
on its own due to C++ aliasing complexity; 2D range select is edge
case).

**Schema additions (2 new bridge call kinds):**

- `emitters/set-track-key { id: number; track: TrackName; oldTime: number; newTime: number; newValue: number }`
  → `Record<string, never>`. Moves the key at `oldTime` to
  `(newTime, newValue)`. C++ erases the old key + inserts the new
  one (since `std::multiset` doesn't support in-place mutation of
  the ordering key). Border keys: time-change request silently
  uses `oldTime` for `newTime` (value-only move). Captures undo +
  emits state-changed + tree-changed + dirty.
- `emitters/add-track-key { id: number; track: TrackName; time: number; value: number }`
  → `{ time: number; value: number }`. Inserts a new key. If a
  key already exists at the exact `time`, the host may dedupe by
  slightly bumping the time (subagent picks; matching legacy if
  documented). Capture undo + emit events.

No new event kinds. No new DTO fields.

**Drag-to-move:**

- Local state in CurveEditor: `dragging: { keyTime: number;
  startTime: number; startValue: number; currentTime: number;
  currentValue: number } | null`. The `startTime/Value` are the
  drag anchor; `currentTime/Value` updates as the pointer moves.
- Pointer down on a key circle (button === 0, no modifiers):
  begin drag with `startTime = keyTime`, `startValue = keyValue`,
  `currentTime = startTime`, `currentValue = startValue`.
- Pointer move during drag: compute new (time, value) from
  pointer position relative to canvas origin via inverse axis
  mapping; clamp:
  - Time: if border key, `currentTime = startTime` (fixed).
    Else, clamp to `(prevKey.time, nextKey.time)` exclusive.
  - Value: clamp to `[valueRange.min, valueRange.max]`.
  - Update `currentTime/Value`, re-render the dragged key at the
    new position. Don't fire bridge call mid-drag.
- Pointer up: fire `emitters/set-track-key { id, track, oldTime:
  startTime, newTime: currentTime, newValue: currentValue }`.
  Clear `dragging`. The re-fetch via `tree/changed` confirms the
  new position.
- Multi-key drag: NOT supported. If multi-select is active when
  drag starts, treat as single-key drag on the clicked key
  (don't apply delta to others). Avoids the complexity of
  per-key bound computation. Multi-key drag is a future polish.
- Pointer down on canvas (not on a key, NOT in Insert mode):
  clears selection (existing Batch A behaviour).
- Drag-from-empty-canvas: not supported (no rubber-band select).
  Pointer down on empty canvas in Select mode clears selection;
  pointer move + up are no-ops.

**Click-to-add (Insert mode):**

- Toolbar Select / Insert toggle buttons (currently visual-only):
  - Select mode: pointer down on canvas clears selection. Pointer
    down on a key begins drag (or extends selection with
    modifiers).
  - Insert mode: pointer down on canvas computes (time, value)
    from position, fires `emitters/add-track-key { id, track,
    time, value }`. On success the new key auto-selects.
- Mode state lives in TrackEditor component (`mode: "select" |
  "insert"`, default `"select"`).
- In Insert mode, the cursor on the canvas could change (e.g.
  to a crosshair) — subagent decides; not strictly required.
- Pointer down on a key in Insert mode: same as Select mode
  (drag begins) — Insert mode only affects canvas clicks.

**Spinner sync:**

- TrackEditor renders TWO `<Spinner>` controls in a row above the
  toolbar (legacy has `IDC_SPINNER1` + `IDC_SPINNER2`): Time
  spinner + Value spinner. Currently NOT rendered.
- When exactly one key is selected: Spinners show that key's
  time + value. Editing a Spinner fires `emitters/set-track-key`
  with the new (time, value).
- When 0 keys or 2+ keys selected: Spinners disabled (greyed,
  show empty or "—"). Editing them is disabled.
- Border keys: Time Spinner disabled (only Value editable).
  Mirrors the drag-time-fixed rule.
- Spinner range: matches the per-track `valueRange`. Time
  spinner range: `[0, 100]` (matching axis default).

**Border key visual:**

- Border keys (first + last by time) render with a **slightly
  darker fill** and a **stroke ring** (`stroke: <accent>; stroke-width: 1.5; fill: <darker>`) to visually distinguish from interior keys.
- When selected, border keys still get the selected styling
  (filled + larger radius) but retain the ring stroke as a
  layered cue.
- Hover: same hover affordance as interior keys.

**C++ host implementations:**

- `emitters/set-track-key`:
  - Resolve emitter + track.
  - Identify border keys (first + last by time).
  - Build `Key oldKey(oldTime, 0)`, find via `keys.find(oldKey)`.
    If not found, return ok (no-op).
  - If found is a border key, override `newTime = oldTime`.
  - Erase the old, insert `Key(newTime, newValue)`.
  - Capture undo (once per call) + emit events.
- `emitters/add-track-key`:
  - Resolve emitter + track.
  - Check if a key with `time` already exists; if so, bump
    `time` slightly (e.g. `time + 0.001`) or return ok with the
    existing key's time (matches legacy behaviour — investigate).
  - Insert `Key(time, value)`.
  - Capture undo + emit events.
  - Return `{ time, value }` (the actual inserted time, which
    may differ from the requested if deduped).

**MockBridge implementations:**

- `set-track-key`: erase oldTime entry, insert (newTime,
  newValue). Border-key semantics enforced same as native.
- `add-track-key`: insert (time, value), dedupe by time bump.

**Test surface for Batch B-β:**

- **Vitest** (+8 specs, target 139 → 147+):
  - `bridge-contract.test.ts` (+2): set-track-key round-trip;
    add-track-key round-trip.
  - `CurveEditor.test.tsx` (+3): pointer-down + pointer-move +
    pointer-up on a key fires set-track-key with the new
    position; border-key visual (test that first key has the
    ring stroke); Insert mode canvas click fires add-track-key.
  - `TrackEditor.test.tsx` (+2): Insert mode toggle switches
    state; Spinner edit on selected key fires set-track-key.
  - `EmitterPropertyPanel.test.tsx` (+1): selection state
    flows into TrackEditor's Spinner values.
- **Playwright** (+3 specs, target 66 → 69+):
  - Drag a key (use bridge-driven verification if CDP drag is
    flaky; fire set-track-key directly and assert state change).
  - Insert mode + canvas click adds a key.
  - Spinner edit on the panel moves the selected key.

**Open follow-ups** (post-Screen-6 polish, not blocking ✅):

- Lock-to combo functional behaviour (re-alias track slot;
  needs C++ storage for per-emitter per-track lock-to state).
  Small separate batch.
- Shift+click 2D range selection in CurveEditor (edge case;
  legacy doesn't have a clean shape for it).
- Multi-key drag with per-key bound computation.
- Drag cursor change (Insert vs Select mode visual cue).
- Spinner increment behaviour for time vs value (different
  per-axis sensitivity).

### Screen 5 / Screen 6 Batch B-α — Selection + Delete + Interpolation toggle + Smooth/Step rendering (locked 2026-05-17)

First half of the Screen 5 (curve editor interaction) work — formally
Screen 6 Batch B-α, calling it "Screen 5 Batch A" in commits since
that's the natural way the work groups (the CurveEditor sub-component
goes from read-only to interactive). After this batch users can
select keys, delete non-border keys, switch interpolation
(Linear/Smooth/Step) with proper rendering. Drag-to-move, click-to-add,
Spinner sync, lock-to functional, and border-key visual differentiation
stay deferred to Screen 5 Batch B (the second half of curve interaction).

**Schema additions (2 new bridge call kinds):**

- `emitters/delete-track-keys { id: number; track: TrackName; times: number[] }`
  → `Record<string, never>`. Deletes the keys at the named times from
  the track. Border keys (first + last) silently no-op'd if included
  (host enforces). Capture undo + emit `engine/state/changed` + dirty.
- `emitters/set-track-interpolation { id: number; track: TrackName; interpolation: InterpolationType }`
  → `Record<string, never>`. Sets the track's interpolation type.
  Capture undo + emit state-changed + dirty.

No new events. No new DTO types (reuses `TrackName` + `InterpolationType`
from Batch A).

**Smooth + Step rendering in CurveEditor:**

Legacy formulas (from [src/UI/CurveEditor.cpp:276-310]):

- **Linear** (already shipped): polyline straight-line between keys.
- **Smooth**: cubic Bezier with control points at 1/4 and 3/4. For
  each (p1, p2) pair:
  - `cp1 = (p1.x + (p2.x - p1.x)/4, p1.y)`
  - `cp2 = (p1.x + (p2.x - p1.x)*3/4, p2.y)`
  - SVG: `<path d="M x1 y1 C cp1.x cp1.y, cp2.x cp2.y, x2 y2 ..." />`.
- **Step**: staircase — for each (p1, p2) pair, line from p1 to
  (p2.x, p1.y) then to (p2.x, p2.y). SVG `<polyline>` with the
  staircase points expanded.

Render branch in CurveEditor: switch on `track.interpolation` and
return the appropriate SVG element (path for smooth, polyline for
linear + step). Single circle render for keys regardless of
interpolation.

**Selection state:**

- New local state in `CurveEditor.tsx`: `selectedKeyTimes: Set<number>`.
  Using key TIME as the identity (not array index) because the
  multiset can reorder keys when their times change — even though
  this batch doesn't move keys, Batch B will, and using time keeps
  the selection stable across mutations.
- Click on a key circle → set selection to `{ time }`.
- Ctrl/Cmd+click → toggle in set.
- Shift+click — **defer to Batch B** (2D range selection is
  non-obvious; single + toggle suffices for delete-focused workflow).
- Click on empty SVG canvas → clear selection.
- Switching active track → clear selection (selection is per-track).
- Selected key visual: filled circle with `fill: <accent>` and slightly
  larger radius (`r=5` vs `r=4` unselected). Same accent colour as
  Screen 4's primary selection (`sky-500`).

**Delete keys:**

- Toolbar's existing Delete button (currently visual-only per
  Batch A) wires to a handler that:
  1. Filters `selectedKeyTimes` to exclude border keys (first + last
     in time order).
  2. If anything remains, fires `emitters/delete-track-keys { id,
     track, times: <filtered> }`.
  3. Clears `selectedKeyTimes` after the call resolves.
- Delete key on the CurveEditor with focus does the same. Add
  `tabIndex={0}` on the SVG container to receive focus + keyboard
  events. Don't intercept when an `<input>` is focused elsewhere.

**Interpolation toggle:**

- The three toggle buttons in TrackEditor (Linear/Smooth/Step,
  currently visual per Batch A) become functional.
- One always shows as active based on the current track's
  interpolation type.
- Click → fires `emitters/set-track-interpolation { id, track,
  interpolation }`. The button visually flips to active immediately
  (optimistic) and the re-fetched track from `emitters/tree/changed`
  confirms.

**Border keys:**

- The FIRST key and LAST key (in time order) of each track are
  "border keys" — they define the track's time range. Per legacy,
  they can't be deleted (or moved — but moving is Batch B).
- For Batch A, the visual differentiation (legacy renders border
  keys in a different colour) **defers to Batch B**. This batch
  just enforces the delete refusal on the C++ side + silent skip
  on the React side.

**C++ host implementations:**

- `emitters/delete-track-keys`:
  - Resolve emitter + track.
  - Find first + last key times (border keys).
  - For each time in `times` that isn't a border key, find the
    matching key in `track.keys` (use `std::multiset::find` with a
    Key constructed from the time) and erase.
  - If at least one key was deleted, capture undo, emit
    state-changed + tree-changed + dirty.
- `emitters/set-track-interpolation`:
  - Resolve emitter + track. Set `track.interpolation = mapped
    value` (`"linear"` → `IT_LINEAR`, etc.).
  - Capture undo + emit state-changed + dirty.

**MockBridge implementations:**

Mirror the C++ semantics. `mock-state` has the fixture tracks per
emitter; mutate in place. Border-key skip + capture-undo-equivalent
+ tree-changed event.

**Test surface for Batch A:**

- **Vitest** (+8 specs, target 131 → 139+):
  - `bridge-contract.test.ts` (+2): delete-track-keys round-trip;
    set-track-interpolation round-trip.
  - `CurveEditor.test.tsx` (+3): clicking a key selects it (fill
    color check); Ctrl+click toggles; smooth interpolation renders
    a `<path>` element (vs polyline for linear); step interpolation
    renders a staircase polyline.
  - `TrackEditor.test.tsx` (+2): clicking Linear/Smooth/Step
    toolbar button fires the bridge call; the active button visually
    reflects the current interpolation.
  - `EmitterPropertyPanel.test.tsx` (+1): Delete key on focused
    panel fires delete-track-keys with selected times.
- **Playwright** (+2 specs, target 64 → 66+):
  - Clicking a curve key applies the selected-style.
  - Clicking the Smooth interpolation toggle button fires the
    bridge call (observe state/changed).

**Open follow-ups** (Screen 5 Batch B):
- Drag to move keys.
- Click empty space to add a key.
- Click-to-toggle Select / Insert mode.
- Spinner sync (TrackEditor's time + value spinners show
  selected key, edits commit move).
- Border key visual differentiation.
- Lock-to combo functional behaviour (re-alias track slot).
- Shift+click range selection.

### Batch A — Foundation (read-only) (locked 2026-05-17)

**Schema additions (1 new bridge call kind + 1 new DTO):**

- `emitters/get-tracks { id: number }` → `{ tracks: TrackDto[] }`
  where:
  ```ts
  type InterpolationType = "linear" | "smooth" | "step";
  type TrackKey = { time: number; value: number };
  type TrackDto = {
    name: string;          // "red" | "green" | "blue" | "alpha" | "scale" | "index" | "rotationSpeed"
    keys: TrackKey[];      // sorted ascending by time
    interpolation: InterpolationType;
  };
  ```
- Returns the 7 tracks (Red / Green / Blue / Alpha / Scale / Index
  / RotationSpeed) of the specified emitter, in fixed order.
- No selection or mutation in this batch — pure read.

**Event additions:** none. Selection from Screen 4 drives the
re-fetch.

**Right-side property panel skeleton:**

- New `web/apps/editor/src/screens/EmitterPropertyPanel.tsx`.
- Mounted in `App.tsx`'s sidebar slot OR a new right-side slot
  alongside the viewport. **Decision**: replace the existing
  right-half of the main row — the viewport stays on the LEFT
  half, the property panel takes the RIGHT half. (Matches legacy
  layout.) Use a flex split so the viewport shrinks when the
  panel is shown.
- When `selectedEmitterId === null` (no emitter selected), show
  a placeholder ("Select an emitter to edit its properties").
- When an emitter is selected, fetch the tracks via
  `emitters/get-tracks { id: selectedEmitterId }` and render the
  TrackEditor.
- Subscribes to `emitters/selected` to re-fetch on selection
  change. Also `emitters/tree/changed` to re-fetch when the
  current emitter mutates (rename, etc.).
- Hidden default behaviour: viewport takes the full right side
  when no emitter is selected (so existing Spawner panel work
  isn't disrupted). When property panel opens, viewport shrinks.

**TrackEditor shell:**

- New `web/apps/editor/src/screens/TrackEditor.tsx`.
- Layout: top row toolbar + lock-to combo; main area CurveEditor.
- Toolbar: 7 toggle buttons matching the 7 tracks (one is active
  at a time). Plus the legacy's tool toggles: Select / Insert
  (mode switch), Linear / Smooth / Step (interpolation pick),
  Delete (action button). **Buttons render disabled with
  tooltips saying "Batch B" — visual only this batch.**
- Lock-to combo: Radix Select. Options per current track:
  - Red, Index, RotationSpeed: just "None" (combo disabled).
  - Green: "None", "Red".
  - Blue: "None", "Red", "Green".
  - Alpha: "None", "Red", "Green", "Blue".
  - Scale: "None".
  - Per legacy `texts[7][5]` table at [src/UI/TrackEditor.cpp:90].
  Combo is visual only this batch (no effect on rendering).
- Active track state lives in local component state
  (`activeTrack: TrackName`), default "red".

**CurveEditor (read-only SVG):**

- New `web/apps/editor/src/screens/CurveEditor.tsx` — yes, taking
  the Screen 5 name now even though Batch B (interaction) is
  separate. The read-only foundation lives here.
- Pure presentational component. Props: `track: TrackDto`,
  `valueRange: { min: number; max: number }`.
- Renders an SVG with:
  - Axes (time on X, value on Y).
  - Grid lines (10 ticks per axis, light grey).
  - Polyline connecting consecutive keys (per interpolation
    type — for now, just straight-line linear connections;
    smooth/step rendering refinements defer to Batch B).
  - A circle at each key position.
  - Time range: 0..100 (matches legacy default).
  - Value range: from `valueRange` prop (per-track — colors
    0..1, scale 0..reasonable-max, etc.).
- **SVG choice locked for the profiling vehicle.** If at any
  point during Batch A or Batch B the SVG renders 100+ keys
  with visible lag, the decision flips to canvas — but for the
  expected key counts (typically <20 per track), SVG is fine
  and gives us free DOM testability.

**Value-range mapping per track** (matches legacy at lines 60-82):

| Track | Min | Max |
|---|---|---|
| Red, Green, Blue, Alpha | 0 | 1 |
| Scale, Index | 0 | (clamp to a reasonable display max — say `max(keys.value) * 1.2` or 100, whichever is larger) |
| RotationSpeed | (auto-range from keys, symmetric around 0) | (auto-range) |

**C++ host:**

- `emitters/get-tracks` handler in `src/host/BridgeDispatcher.cpp`:
  - Resolve emitter by id.
  - Walk the 7 track slots (`emitter.tracks[0..6]` — verify the
    field names; might be `m_tracks` or per-named-field).
  - For each, serialise the keys (`time`, `value` from
    `Track::KeyMap` which is `std::multiset<Key>`) into a JSON
    array.
  - Interpolation type maps as: `IT_LINEAR` → `"linear"`,
    `IT_SMOOTH` → `"smooth"`, `IT_STEP` → `"step"`.
- Engine API: `getTrack(int)` or per-field `getRedTrack()` etc.
  Read `src/ParticleSystem.h` to confirm.

**MockBridge:**

- Add a fixture: 7 tracks per emitter with sample keys (e.g.
  red goes 0→1→0 over 0..100, scale starts at 1 and decays,
  etc.). Returns a deterministic shape so the React snapshot
  tests can assert on specific positions.

**Test surface for Batch A:**

- **Vitest** (+6 specs, target 119 → 125+):
  - `bridge-contract.test.ts` (+1): `emitters/get-tracks` returns
    7 tracks with the right names + interpolation values.
  - `EmitterPropertyPanel.test.tsx` (2): renders placeholder when
    no selection; renders TrackEditor when an emitter is selected
    (assert via the bridge mock + the EmitterTree fixture).
  - `TrackEditor.test.tsx` (2): renders 7 toolbar track buttons;
    switching active track re-renders with the new track's keys.
  - `CurveEditor.test.tsx` (1): renders a polyline + N circles
    for an N-key track.
- **Playwright** (+2 specs, target 62 → 64+):
  - Selecting an emitter via the tree shows the property panel
    on the right.
  - The CurveEditor SVG renders inside the panel.

**Legacy delete:** NOT in Batch A. `TrackEditor.cpp` +
`CurveEditor.cpp` stay for `--legacy-ui`.

**Open follow-ups** (Batch B / Screen 5 work):
- Click to select keys + drag to move.
- Click-to-add new keys.
- Interpolation toggle (functional).
- Delete key (functional).
- Lock-to combo functional behaviour.
- Smooth + step interpolation rendering (currently approximated as straight lines).
- `emitters/set-track-key { id, track, oldTime?, newTime, newValue }` mutation.
- `emitters/set-track-interpolation { id, track, type }` mutation.

---

## Phase 4.1 fix dispatches

Findings surfaced during the parity acceptance walkthrough. Fix
order: layout + Basic tab → Appearance tab → Physics tab → D3D
viewport bugs → polish.

### Fix dispatch 1 — Layout reshuffle + emitter property panel Basic tab (locked 2026-05-17)

Addresses findings #2 (missing Appearance/Physics property tabs)
and #3 (curve editor on right vs legacy bottom) in one dispatch
since both touch `App.tsx`.

**Legacy layout** (from [src/main.cpp:2728-2780] WM_SIZE handler):

```
+------------------+----------------------+
| Emitter tree     | Viewport             |
| (upper-left)     | (upper-right)        |
|                  |                      |
|                  |                      |
+------------------+----------------------+
| Property tabs    | Track + Curve editor |
| (lower-left)     | (lower-right)        |
| Basic/Appear./   |                      |
|  Physics         |                      |
+------------------+----------------------+
```

Both columns are vertically split. Left column gets a fixed width
(legacy `props.right` — derive from the tabs control's preferred
width, default ~320px); right column takes the rest. Vertical
split within each column is also fixed (legacy uses each tabs
control's `bottom` from `GetClientRect` as the bottom-pane height
— pick a reasonable static height like ~280px for B1).

**App.tsx restructure:**

```tsx
<div className="flex h-full w-full flex-col">
  <Header />
  <Toolbar />
  <div className="flex flex-1 min-h-0 overflow-hidden">
    {/* Left column */}
    <div className="flex w-80 shrink-0 flex-col border-r border-neutral-800">
      <EmitterTree />              {/* upper-left, flex-1 */}
      <EmitterPropertyTabs />      {/* lower-left, h-72 */}
    </div>
    {/* Right column */}
    <div className="flex flex-1 min-w-0 flex-col">
      <ViewportSlot />             {/* upper-right, flex-1 */}
      <TrackEditor />              {/* lower-right, h-80 */}
    </div>
  </div>
  <StatusBar />
</div>
```

**New `EmitterPropertyTabs` component:**

- `web/apps/editor/src/screens/EmitterPropertyTabs.tsx`.
- Uses `@radix-ui/react-tabs`. Three tabs: Basic / Appearance / Physics.
- Shows "Select an emitter" placeholder when no emitter selected.
- Re-fetches via `emitters/get-properties { id }` on selection
  change + `emitters/tree/changed` event.
- Basic tab populated; Appearance + Physics tabs render
  "Coming in Fix dispatch 2 / 3" placeholders.

**Schema additions (2 new bridge call kinds + 1 new DTO):**

- `EmitterPropertiesDto`: large object exposing every editable
  Emitter field. Per [src/ParticleSystem.h:153-204] (50+ fields):
  - **Basic** (this batch wires these to the UI):
    - `name: string`
    - `lifetime: number`
    - `initialDelay: number`
    - `useBursts: boolean`
    - `nBursts: number`, `burstDelay: number`,
      `nParticlesPerBurst: number`
    - `nParticlesPerSecond: number`
    - `randomLifetimePerc: number` (0-1)
    - `randomScalePerc: number` (0-1)
    - `randomRotation: boolean`,
      `randomRotationDirection: boolean`,
      `randomRotationAverage: number`,
      `randomRotationVariance: number`
    - `freezeTime: number`, `skipTime: number`
    - `linkToSystem: boolean`
    - `parentLinkStrength: number`
    - `index: number`
  - **Appearance** (this batch wires "Coming soon"; Fix dispatch
    2 wires them):
    - `colorTexture: string`, `normalTexture: string`
    - `blendMode: number`
    - `textureSize: number`, `nTriangles: number`
    - `doColorAddGrayscale: boolean`,
      `randomColors: [number, number, number, number]`
    - `hasTail: boolean`, `tailSize: number`
    - `isHeatParticle: boolean`,
      `isWorldOriented: boolean`,
      `noDepthTest: boolean`,
      `affectedByWind: boolean`
  - **Physics** (this batch wires "Coming soon"; Fix dispatch 3
    wires them):
    - `acceleration: [number, number, number]`
    - `gravity: number`
    - `inwardSpeed: number`, `inwardAcceleration: number`
    - `objectSpaceAcceleration: boolean`
    - `bounciness: number`, `groundBehavior: number`
    - `emitFromMesh: number`, `emitFromMeshOffset: number`
    - `isWeatherParticle: boolean`,
      `weatherCubeSize: number`,
      `weatherCubeDistance: number`,
      `weatherFadeoutDistance: number`
    - `groups: GroupDto[]` — the `Group` distribution shapes
      (NUM_GROUPS instances per emitter).

- `emitters/get-properties { id: number }` → `{ properties:
  EmitterPropertiesDto }`.
- `emitters/set-properties { id: number; patch: Partial<EmitterPropertiesDto> }`
  → `Record<string, never>`. Single-call batch update. Captures
  undo + emits `engine/state/changed` + `emitters/tree/changed`
  + dirty.

**Basic tab form fields (full wire-up this batch):**

Each field uses Screen 7's Spinner / ColorButton / TexturePalette
primitives or a Radix Checkbox. Form layout: 2-column grid with
label-on-left.

| Field | Primitive | Range / shape |
|---|---|---|
| `name` | text input (HTML `<input>`) | non-empty |
| `lifetime` | Spinner | `[0, FLT_MAX]`, step 0.1, unit "s" |
| `initialDelay` | Spinner | `[0, FLT_MAX]`, step 0.1, unit "s" |
| `useBursts` | Checkbox | toggles bursts-vs-rate mode |
| `nBursts` | Spinner | `[1, ∞]`, step 1, integer |
| `burstDelay` | Spinner | `[0, ∞]`, step 0.1, unit "s" |
| `nParticlesPerBurst` | Spinner | `[1, ∞]`, step 1, integer |
| `nParticlesPerSecond` | Spinner | `[0, ∞]`, step 1, integer |
| `randomLifetimePerc` | Spinner | `[0, 100]`, step 1, unit "%" |
| `randomScalePerc` | Spinner | `[0, 100]`, step 1, unit "%" |
| `randomRotation` | Checkbox | enables rotation block |
| `randomRotationDirection` | Checkbox | only when randomRotation true |
| `randomRotationAverage` | Spinner | enables when randomRotation true |
| `randomRotationVariance` | Spinner | enables when randomRotation true |
| `freezeTime` | Spinner | `[0, ∞]`, step 0.1, unit "s" |
| `skipTime` | Spinner | `[0, ∞]`, step 0.1, unit "s" |
| `linkToSystem` | Checkbox | — |
| `parentLinkStrength` | Spinner | `[0, ∞]`, step 0.01 |
| `index` | Spinner | `[0, ∞]`, step 1, integer (display only?) |

Enabling logic mirrors legacy: when `useBursts` is checked,
nBursts/burstDelay/nParticlesPerBurst enable + nParticlesPerSecond
disables. Inverse otherwise. Radio-button-style mutual exclusivity.

Commits: each field's `onChange` fires `emitters/set-properties
{ id, patch: { fieldName: value } }`. Debounce text input
edits to commit-on-blur (avoid wire spam per keystroke).

**C++ host:**

- `emitters/get-properties`: walk every Basic + Appearance +
  Physics field on `emitter`, populate the DTO, return.
- `emitters/set-properties`: for each `field: value` in patch,
  assign to `emitter.<field>`. Capture undo (once per call), emit
  state/changed + tree/changed + dirty.
- The `groups: GroupDto[]` field maps to the `Group groups[NUM_GROUPS]`
  array. Each `Group` has `type`, `minX/Y/Z`, `maxX/Y/Z`,
  `sideLength`, `sphereRadius`, `sphereEdge`, `cylinderRadius`,
  `cylinderEdge`, `cylinderHeight`, `valX/Y/Z`. Define matching
  `GroupDto` type in the schema. Fix dispatch 3 will surface them
  in UI; this batch just gets them on the wire.

**MockBridge:**

- Overlay store `useMockEmitterProperties` — per-emitter overrides
  layered on top of a `makeFixtureProperties(id)` generator.
- `get-properties` returns merged data.
- `set-properties` writes to overlay; emits tree/changed.

**Test surface:**

- **Vitest** (+8 specs, target 147 → 155+):
  - `bridge-contract.test.ts` (+2): get-properties round-trip;
    set-properties round-trip applies patch.
  - `EmitterPropertyTabs.test.tsx` (3): renders 3 tabs, Basic
    tab fields renderable; switching tabs shows different
    content; placeholder shows when no emitter selected.
  - `EmitterPropertyPanel.test.tsx` (revisited — +1): the panel
    now hosts both tabs AND the TrackEditor? Or TrackEditor moves
    to a separate slot? **Decision**: rename the existing
    EmitterPropertyPanel to be the tabs-only panel; TrackEditor
    gets its own slot in the right column. Test asserts the
    layout split.
  - `App.tsx` layout (+2 implicit): four-quadrant structure
    renders.
- **Playwright** (+2 specs, target 69 → 71+):
  - Selecting an emitter shows property tabs on the lower-left
    (assert tabs container visible AND track editor visible
    simultaneously — they're in different quadrants now).
  - Editing the Lifetime spinner in Basic tab commits via
    set-properties.

**Out of scope (later fix dispatches):**

- Appearance tab content (Fix dispatch 2).
- Physics tab content + Random Param groups (Fix dispatch 3).
- D3D viewport bugs (Fix dispatch 4 — finding #1).
- Marquee select + menu structure (Fix dispatch 5 — findings #4 + #5).

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

**Design checkpoint:** ✅ shipped 2026-05-17 across Batches A → B-α → B-β. Lock-to functional is a small follow-up batch (deferred).

**Wire-up:** ✅ shipped 2026-05-17 across Batches A → B-α → B-β.

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
- [x] Rescale Emitter — ✅ shipped Screen 4 Batch B1 (right-click context menu → Rescale Emitter…)
- [x] Increment Index — ✅ shipped Screen 4 Batch B1 (right-click context menu → Increment Index…)
- [x] Mod Nickname — ✅ shipped Batch 4 (component + usePromptModNickname hook + ?demo=mod-nickname route; real auto-trigger deferred to file-load batch)
- [x] Spawner — ✅ shipped Batch 4 (panel + schema; real SpawnerDriver wiring deferred to file-load batch)
- [x] Link Group Settings — ✅ shipped Screen 4 Batch B1 (right-click context menu → Link Group Settings…, disabled when emitter unlinked)
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

### Shift-click-to-spawn — cursor-bound particle system (locked 2026-05-17)

The viewport-interaction follow-up. Legacy lets the user hold Shift
to spawn a cursor-bound particle system instance that tracks the
mouse's 3D position + velocity until Shift is released. This is the
"feel" feature that makes the editor enjoyable — the user can shake
the cursor to fling particles around, then release for them to
settle. Without it, the user has to manually configure + trigger
the spawner to see anything moving.

**Legacy flow** (from [src/main.cpp:2945-2966] and [src/main.cpp:2968-3043]
WM_MOUSEMOVE + [src/main.cpp:1894-1904]):

1. **WM_KEYDOWN VK_SHIFT (initial press only)**:
   - Check `(~lParam & 0x40000000)` to filter auto-repeats.
   - `GetCursorPos3D(engine, x, y, pos)` — unprojects screen XY to
     world space via engine view/projection, intersects with the
     z=0 plane.
   - `mouseCursor.SetPosition(pos)` — seeds the cursor object.
   - `info->attachedParticleSystem = engine->SpawnParticleSystem(
     *particleSystem, &mouseCursor)` — spawns a new
     ParticleSystemInstance parented to the cursor. The instance
     inherits cursor position + velocity each frame.
2. **WM_MOUSEMOVE (always, whether dragging or not)**:
   - `GetCursorPos3D(engine, x, y, cursor)`.
   - `mouseCursor.SetPosition(cursor)`.
   - Updates the cursor's position so the spawning system tracks
     it.
3. **Render loop**:
   - `mouseCursor.UpdateVelocity()` computes `dx/dt` from
     `QueryPerformanceCounter` so the cursor object has both
     position + velocity (which the particle system reads).
4. **WM_KEYUP VK_SHIFT**:
   - `engine->KillParticleSystem(attachedParticleSystem)`.
   - Clear the pointer.

**`Object3D` and `MouseCursor` structure** (from [src/engine.h:11]
and [src/main.cpp:369-399]):

- `Object3D` is the base — owns `m_position`, `m_velocity`,
  `m_parent`. `GetPosition()` walks the parent chain. Already
  public + already in `src/engine.h`.
- `MouseCursor : Object3D` adds `m_oldPosition` + `m_updated`
  + `m_frequency` + `UpdateVelocity()` + `SetPosition`. Currently
  static in main.cpp.

**`GetCursorPos3D` helper** (from [src/main.cpp:2877-2890]):

Uses `D3DXVec3Unproject` to convert screen-space (x, y, depth) to
world-space front + back rays, then `D3DXPlaneIntersectLine` to find
the intersection with the z=0 plane. Engine API used:
`GetViewPort`, `GetProjectionMatrix`, `GetViewMatrix` — all public.

**Implementation plan:**

1. **Factor `MouseCursor` into `src/MouseCursor.h`** — a single
   header (no .cpp needed; class is small + entirely inline).
   Include guards, `#include "engine.h"` for `Object3D`. Verbatim
   copy from main.cpp:369-399. Remove the static class from
   main.cpp (replace with `#include "MouseCursor.h"`).
2. **Factor `GetCursorPos3D` into a header** — `src/CursorPicking.h`
   (or fold into `MouseCursor.h` since they're paired). Single
   inline function. Remove the static from main.cpp.
3. **Both headers also referenced by legacy** — main.cpp uses
   `info->mouseCursor` (member of `APPLICATION_INFO`) and
   `GetCursorPos3D` directly. After factor-out, those references
   resolve to the header'd versions. Verify legacy still builds.
4. **HostWindowImpl additions** ([src/host/HostWindow.cpp:257]):
   ```cpp
   #include "MouseCursor.h"
   ...
   MouseCursor m_mouseCursor;
   ParticleSystemInstance* m_attachedParticleSystem = nullptr;
   ```
5. **`ViewportWndProc` extensions** ([src/host/HostWindow.cpp:811]):
   - **WM_KEYDOWN**: if `wp == VK_SHIFT` and `(~lp & 0x40000000)`
     (initial press) and `*m_particleSystem` is not empty (has at
     least one root emitter — `getEmitters().size() > 0` or
     similar) and `m_attachedParticleSystem == nullptr`:
     - `GetCursorPos3D(engine.get(), LOWORD(lp), HIWORD(lp), pos)`
       *— but `lParam` for `WM_KEYDOWN` is repeat count + scan
       code, NOT cursor coords. Need to get cursor pos via
       `GetCursorPos(POINT*)` + `ScreenToClient(hwnd, &pt)`
       instead, OR via the last-known position cached from
       WM_MOUSEMOVE. Easier: cache the last cursor XY from
       MOUSEMOVE (`m_lastCursorX`, `m_lastCursorY`) and use those.*
     - `m_mouseCursor.SetPosition(pos)`.
     - `m_attachedParticleSystem = engine->SpawnParticleSystem(
       **m_particleSystem, &m_mouseCursor)`.
   - **WM_KEYUP**: if `wp == VK_SHIFT` and
     `m_attachedParticleSystem != nullptr`:
     - `engine->KillParticleSystem(m_attachedParticleSystem)`.
     - `m_attachedParticleSystem = nullptr`.
   - **WM_MOUSEMOVE** (extension to existing handler from prior
     batch): always call `GetCursorPos3D` + cache `(x, y)` as
     `m_lastCursorX/Y` + `m_mouseCursor.SetPosition(pos)` —
     regardless of drag mode. This keeps the cursor object's
     position current so the attached particle system tracks it.
6. **RenderD3D9 extension** ([src/host/HostWindow.cpp:410]):
   - Add `m_mouseCursor.UpdateVelocity()` before `engine->Update()`.
   - Matches legacy [src/main.cpp:1904].

**Why `WM_KEYDOWN` cursor-pos via `GetCursorPos`**:

Legacy reads cursor coords from `WM_KEYDOWN`'s `lParam` — but
`WM_KEYDOWN`'s lParam is `repeat-count | scan-code | …` NOT mouse
coords. Looking again at [src/main.cpp:2960]: it passes
`(SHORT)LOWORD(lParam), (SHORT)HIWORD(lParam)` to `GetCursorPos3D`.
That's a legacy bug? Or the cursor coords happen to be in some
other path? Investigate via the actual legacy behaviour — the
subagent should verify by reading WM_KEYDOWN docs.

**Best practice**: use the cached `m_lastCursorX/Y` from
WM_MOUSEMOVE. The mouse will have moved into the viewport before
Shift was pressed (the user typically hovers over the viewport
before pressing Shift), so the cache is fresh. Fallback:
`GetCursorPos(POINT*)` + `ScreenToClient`.

**Test surface:**

Same constraint as the camera batch — keyboard + mouse on a
sibling HWND can't be Playwright-driven through WebView2's
surface. The C++ build must succeed. Manual smoke verifies feel.

- **All 74 Vitest + 48 Playwright still pass.** No regression
  expected — the new code is purely additive in
  `ViewportWndProc` (handles new messages); existing handlers
  unchanged.
- **No new tests.** No bridge contract changes. No React changes.
- **Manual smoke**: subagent (or controller) runs
  `ParticleEditor.exe --new-ui --dev-ui`, hovers cursor over
  viewport, holds Shift, drags cursor, releases Shift. Confirms:
  (a) particle system spawns on Shift-press, (b) cursor drag
  carries the spawn along, (c) Shift-release kills it cleanly.
  Not a strict gate.

**Defensive cleanups:**

- If `m_attachedParticleSystem != nullptr` when the host shuts
  down or the particle system is replaced (file/new, file/open),
  kill it cleanly. Add to the relevant teardown paths.
- If the user releases Shift outside the viewport HWND (focus
  changed mid-press), the attached instance can leak. Same
  defensive: kill on WM_KILLFOCUS or similar.

**Open follow-ups** (out of scope):
- *Wireframe cursor visualization* — legacy renders the cursor
  as a small wireframe object via `mouseCursor` being passed to
  the engine's render. Subtle; defer to a polish batch.
- *Multi-spawn* — currently one attached instance at a time.
  Holding Shift + clicking multiple times in legacy spawns more.
  Verify legacy actually supports this or if it's single-spawn-
  per-Shift-hold.

### Viewport interaction — camera controls (locked 2026-05-17)

First user-input batch for the new-UI viewport. Adds mouse + wheel
camera controls on the D3D9 sibling HWND, mirroring the legacy
interaction model at [src/main.cpp:2923-3060]. After this batch,
the user can MOVE / ROTATE / ZOOM the camera in `--new-ui`, matching
`--legacy-ui`'s feel.

**Scope: camera only.** Shift-click-to-spawn (legacy line 2956) is
explicitly out of scope — it depends on porting the legacy
`MouseCursor` `Object3D` (line 393), which is its own batch. Status-
bar mouse coordinates (legacy line 3041) are also out of scope —
they're a Screen 1 polish item.

**Legacy interaction model** (from [src/main.cpp:2923-3060]):

| Input | Modifier | Drag mode |
|---|---|---|
| L-button down | none | MOVE (translate camera) |
| L-button down | Ctrl | ZOOM |
| R-button down | none | ROTATE (orbit around target) |
| R-button down | Ctrl | ZOOM |
| Wheel | none | ZOOM (sqrt-distance-scaled) |

Each drag mode mutates the camera relative to its start pose:

- **MOVE**: translate `camera.Target` (and `camera.Position`) in
  the camera plane via orthogonal-vector math. Multiplier scales
  with distance from target.
- **ROTATE**: orbit `camera.Position` around `camera.Target`. Z
  rotation around camera-up axis (horizontal drag); XY rotation
  around the orthogonal of view-direction (vertical drag). Drag
  delta scaled by `/2.0f` so a full window-width drag is ~180°.
- **ZOOM**: scale `(Position - Target)` by `sqrt(distance)`-based
  factor. Floor at 1.0f to prevent flipping through the target.

**Wheel**: same ZOOM math, delta = `WHEEL_DELTA`-normalized.

**Implementation in `HostWindowImpl::ViewportWndProc`** (at
[src/host/HostWindow.cpp:811]):

- Add drag-state members to `HostWindowImpl`:
  ```cpp
  enum class DragMode { NONE, MOVE, ROTATE, ZOOM };
  DragMode m_dragMode = DragMode::NONE;
  Engine::Camera m_dragStartCam;
  int m_dragStartX = 0;
  int m_dragStartY = 0;
  ```
- Handle `WM_LBUTTONDOWN` / `WM_RBUTTONDOWN`: capture, set
  dragMode based on button + Ctrl modifier, snapshot
  `m_dragStartCam = engine->GetCamera()`, save start XY.
- Handle `WM_LBUTTONUP` / `WM_RBUTTONUP`: `ReleaseCapture()`,
  reset dragMode = NONE.
- Handle `WM_MOUSEMOVE` (when dragMode != NONE): compute deltas
  from start, run the mode-specific math from legacy, call
  `engine->SetCamera(camera)`. Manually trigger
  `dispatcher->EmitEngineStateChanged()` so React subscribers see
  the new camera state in their next `engine/state/snapshot`.
- Handle `WM_MOUSEWHEEL`: only when dragMode == NONE. Standard
  wheel-zoom math.
- Handle `WM_CAPTURECHANGED`: reset dragMode to NONE (handles
  Alt-Tab away mid-drag, etc.).

**Engine state emission discipline:**

Camera changes via direct C++ `Engine::SetCamera` don't go through
the bridge dispatcher's setter ladder, so they don't auto-emit
`engine/state/changed`. The mouse handler MUST call
`dispatcher->EmitEngineStateChanged()` after each `SetCamera` so
the snapshot stays current. Same applies to the wheel handler.

**Camera is NOT a dirty-marking operation.** View state isn't
file content — moving the camera shouldn't mark the file dirty.
This is consistent with legacy (camera changes never call
`SetFileChanged`). Our `markDirty()` lambda lives in the
dispatcher's setter handlers, which the C++ mouse code bypasses
entirely. No special handling needed.

**Test surface for this batch:**

Mouse drag on a sibling D3D9 HWND is hard to automate from
Playwright — Playwright drives input through WebView2's surface,
not the sibling viewport window. So:

- **Existing tests stay green.** No regressions in 74 Vitest +
  47 Playwright.
- **One new Playwright spec**: drive `engine/set/camera` via the
  bridge directly (already wired), assert the next
  `engine/state/snapshot` returns the new camera Position /
  Target / Up. This tests the C++ camera setter path that the
  mouse handler depends on — even though the mouse path itself
  isn't covered. Adds 1 to the count.
- **Manual smoke** — subagent (or controller after) runs
  `ParticleEditor.exe --new-ui --dev-ui`, drags with L+R buttons,
  scroll-zooms, confirms camera moves. Not a strict gate; report
  what's observed.

**Open follow-ups** (explicitly deferred):
- *Shift-click-to-spawn.* Needs `MouseCursor` `Object3D` port +
  cursor-position-as-3D conversion via `GetCursorPos3D` from
  legacy. Its own batch.
- *Status-bar mouse coordinates.* Screen 1 polish.
- *Reset View Settings menu item* ([web/apps/editor/src/components/MenuBar.tsx:364]
  `todo("Reset View Settings")`) — it's a registry-cleanup
  operation (clears BackgroundColor / ShowGround / BloomEnabled /
  etc.), not a camera reset. Deserves its own batch once
  `--new-ui`'s persistence story matures (we don't yet persist
  to the same registry keys consistently).
- *Touch gestures / pen input.* Not in scope.
- *Camera-control-keyboard-shortcut* (legacy has none for the
  camera — only for scene mutations). Skip.

### Render loop + per-frame tick (locked 2026-05-17)

The capstone foundation batch: makes particles visible in `--new-ui`
by activating the engine render loop and the per-frame spawner tick.
After this lands, the new-UI binary has visual + behavioural parity
with `--legacy-ui` for non-emitter-editing workflows. Combined with
the prior host-state-plumbing batch, the new-UI host can fully
exercise a particle system end-to-end (load, save, rescale, spawn,
preview, render) without going through legacy chrome.

**The legacy per-frame sequence to replicate** (from
[src/main.cpp:1882-1900] `static void Render(APPLICATION_INFO*)`):

```cpp
float dt = GetTimeF() - g_spawnerLastFrameTime;
spawner->Tick(dt, particleSystem, engine);
engine->Update();
engine->Render();
fpsMeasurer.measure();
```

**Main-loop change** (the unblocker):

Legacy uses `PeekMessage` idle-render at [src/main.cpp:8026]. The
host currently uses blocking `GetMessage` at
[src/host/HostWindow.cpp:1019], which is why nothing animates —
there are no continuous WM_PAINT events. Switch the host's loop to
the PeekMessage pattern: drain queued messages, then render-once on
idle, loop. Keep IsDialogMessage routing simple (the host doesn't
have modeless legacy dialogs to route to).

**Host's placeholder device gets retired (or sidelined):**

`HostWindowImpl::InitD3D9` at [src/host/HostWindow.cpp:380] creates
its own `IDirect3DDevice9*` for the placeholder clear-to-background
behaviour. The engine creates its own device internally (via the
`(HWND hFocus, HWND hDevice)` constructor) and exposes it via
`Engine::GetDevice()`. Running two D3D9 devices targeting the same
viewport HWND is asking for trouble.

**Subagent decision**: drop the host's `d3d`/`device` entirely
(cleanest) OR keep them for the null-engine fallback path (safest).
Default to drop — the engine is constructed unconditionally in
HostWindow's init path, so the null-engine case shouldn't occur.
If the build breaks or rendering glitches, fall back to keep + skip
the device->Clear/BeginScene/EndScene/Present in RenderD3D9 (let
`engine->Render` own the full device cycle).

**Per-frame body for `HostWindowImpl::RenderD3D9`:**

```cpp
void HostWindowImpl::RenderD3D9()
{
    if (!engine) return;

    float now = GetTimeF();
    float dt  = (m_lastRenderTime > 0.0f) ? (now - m_lastRenderTime) : 0.0f;
    m_lastRenderTime = now;

    if (spawnerDriver && particleSystem)
        spawnerDriver->Tick(dt, particleSystem.get(), engine.get());

    engine->Update();
    engine->Render();
    fpsMeasurer.measure();

    // spawner/active-count: emit when GetNumInstances() differs from
    // the last emitted value. Debounce to avoid spamming WebMessage.
    int instances = engine->GetNumInstances();
    if (instances != m_lastEmittedActiveCount) {
        m_lastEmittedActiveCount = instances;
        dispatcher->EmitSpawnerActiveCount(instances);
    }
}
```

`m_lastRenderTime` and `m_lastEmittedActiveCount` are new members
on `HostWindowImpl`. `GetTimeF()` is the legacy helper at
[src/main.cpp:~] (subagent locates and reuses). Source preference:
use the same function legacy uses so dt semantics match exactly.

**Engine notifications when `*m_pps` is replaced:**

Legacy calls `engine->Clear()` then `engine->OnParticleSystemChanged(-1)`
when the particle system is replaced (see [src/main.cpp:1207]
`DoNewFile`, [src/main.cpp:1341] file-load path, [src/main.cpp:1522]
file-close path). The new-UI `file/new` and `file/open` handlers
need the same notification sequence right after replacing
`*m_pps`. **Two additions to those handlers (already wired by host
state plumbing batch):**

```cpp
// After: *m_pps = std::move(newSystem);
if (m_engine) {
    m_engine->Clear();
    m_engine->OnParticleSystemChanged(-1);
}
```

**`spawner/active-count` live source via `Engine::GetNumInstances()`:**

The simplest source-of-truth: the engine's instance count.
Includes both spawner-driven and user-Shift-Click-spawned instances
(matching what the legacy SpawnerDialog shows). The SpawnerPanel's
existing badge subscription works unchanged — only the source flips
from MockBridge timer to real engine state.

Add `BridgeDispatcher::EmitSpawnerActiveCount(int count)` —
emits a WebMessage event with the new schema-defined payload.
Called from `RenderD3D9` when count changes.

**Dirty-flag tightening** (open follow-up from Batch 3):

`engine/set/paused` and `engine/set/heat-debug` shouldn't mark the
particle system dirty — both are view-only toggles. Two one-line
changes:

- `web/apps/editor/src/bridge/mock.ts`: in `isMutating(kind)`,
  exclude `"engine/set/paused"` and `"engine/set/heat-debug"`.
- `src/host/BridgeDispatcher.cpp`: the dispatch cases for these
  two kinds skip the `markDirty()` lambda. Inline the early-return
  or move the call out of the shared path.

**Test surface for this batch:**

The hardest part of this batch is testing actual rendering — visual
output is hard to assert in automated tests without screenshot
diffs or a pixel-level smoke. Pragmatic mix:

- **Existing tests still pass.** 74 Vitest + 46 Playwright must
  stay green. The bridge contract doesn't change; the activated
  handlers continue to emit the same events. Some specs may need
  minor tweaks if the events arrive on a different cadence
  (per-frame instead of mock-timer).
- **+1 Playwright spec** (only):
  - `spawner/active-count event fires from real engine state` —
    pre-seed `spawner/trigger` (which schedules a burst), advance
    enough frames for the burst to fire (poll the event for up to
    ~1 second), assert `payload.count > 0` from at least one
    event. May need a `setTimeout(1000)` style wait — that's
    acceptable for a render-loop spec.
- **Dropping +2 Vitest from the brief.** MockBridge already
  handles the spawner/active-count source; the new C++-driven
  source doesn't go through MockBridge. The Vitest contract
  remains unchanged.
- **Manual smoke**: subagent reports whether `--new-ui` actually
  shows particles when an emitter is loaded. This is informally
  verified by the subagent observing the screenshot/logs OR by
  the controller running a smoke afterwards. Not a strict gate.

**Open follow-ups** (explicitly out of scope for this batch):

- *Hot-reload textures / shaders triggers re-render automatically.*
  Already wired via `engine/state/changed` event; should "just
  work" once render loop is live. Verify in the smoke pass.
- *Camera control* — middle/right mouse drag, scroll-zoom. Not in
  this batch. Separate "Screen 1 polish" or "viewport interaction"
  batch.
- *Cursor-driven gravity test* — legacy has a mouse-cursor-as-D3D-
  object thing for testing emitter forces. Not in this batch.

### Host state plumbing (locked 2026-05-17)

Activates the forward-deferred handlers from Batches 1/3/4 by giving
the new-UI host actual ownership of `ParticleSystem` +
`SpawnerDriver`. After this batch:

- `engine/action/rescale-system` rescales the real particle system
  (was a logging no-op).
- `file/new` / `file/open` / `file/save` / `file/save-as` actually
  read/write `.alo` files (were no-ops with bookkeeping).
- `spawner/start` / `spawner/trigger` / `spawner/stop` actually
  configure / fire / stop the `SpawnerDriver` (were no-ops).
- `emitters/preview-from-file` actually parses the source `.alo`
  and returns a real `EmitterTreeNode` tree.

**What this batch is NOT:**
- Not wiring engine rendering in `--new-ui`. The render loop at
  [src/host/HostWindow.cpp:410] stays as-is (clear to the engine's
  background colour). The particle system is OWNED but not
  RENDERED. Visible particles in `--new-ui` is a separate batch.
- Not ticking the spawner per-frame. `SpawnerDriver::Tick` needs
  the render-loop wiring. Spawner-config commits work; manual
  Trigger schedules a burst but the burst-state machine doesn't
  advance without ticks. Mock active-count event will be the
  source of truth for Spawner panel until this lands.
- Not touching legacy `--legacy-ui` paths. Same forward-defer
  discipline as prior batches.

**Ownership additions to `HostWindowImpl`:**

```cpp
std::unique_ptr<ParticleSystem> m_particleSystem;  // current; replaced on file/new/open
std::unique_ptr<SpawnerDriver>  m_spawnerDriver;   // constructed once
```

Construct fresh `m_particleSystem = std::make_unique<ParticleSystem>()`
and `m_spawnerDriver = std::make_unique<SpawnerDriver>()` at init.

**`BridgeDispatcher` accessor:**

Single setter `void BindHostState(ParticleSystem** ppSystem,
SpawnerDriver* spawner, IFileManager* fileManager)`. `**` for
particle system because handlers access the *current* system,
which file/new and file/open replace. (Mirrors legacy
`info->particleSystem`.) Called once at HostWindow init, after
`HostWindowImpl` constructs its `ParticleSystem` / `SpawnerDriver`.

**Pure-IO factor-outs in `src/main.cpp`** (touched once, callable
from both legacy + new-UI):

- `std::unique_ptr<ParticleSystem> LoadParticleSystem(IFileManager*,
  const std::wstring& path)` returning `nullptr` on failure.
  Factored out of `DoOpenFile` at [src/main.cpp:1302] +
  `ImportEmitters_LoadFile` (used by `DoImportEmittersFromFile` at
  [src/main.cpp:7525]).
- `bool SaveParticleSystem(ParticleSystem*, const std::wstring&
  path)` returning false on write failure. Factored out of
  `DoSaveFile` at [src/main.cpp:1329].
- Legacy `Do*` functions get rewritten in terms of these helpers
  + their UI side-effects (dialog launch, menu rebuild, autosave
  flush). Legacy callers (the `WM_COMMAND` cases) keep their
  current signatures.

If a factor isn't clean (e.g. the pure-IO part is tangled with
`APPLICATION_INFO*` access that can't be lifted out), the subagent
forward-defers that specific operation with a "still not wired"
log + bug ticket comment in the host handler. Same pattern as
prior batches' partial-defer escape hatch.

**Handler activations** (in `src/host/BridgeDispatcher.cpp`):

| Handler | Activation |
|---|---|
| `engine/action/rescale-system` | Iterate `(*m_pps)->getEmitters()`, call `DoRescaleEmitter(emitter, dScale/100, sScale/100)` from [src/Rescale.cpp:68]. Capture-before-batch via existing `UndoStack`. Mark dirty. Emit `engine/state/changed` + `emitters/tree/changed`. Expose `DoRescaleEmitter` in `src/Rescale.h` if not already. |
| `file/new` | Replace `*m_pps` with `new ParticleSystem()`. Clear path / dirty. Emit `dirty/changed` + `engine/state/changed`. |
| `file/open` (with path) | `LoadParticleSystem(fileManager, path)` → on success, replace `*m_pps`, update path / dirty / recents. Emit `recent/changed` + `engine/state/changed` + `dirty/changed`. |
| `file/open` (no path) | `GetOpenFileNameW`, then same as with-path branch. |
| `file/save` (no path, no current) → opens picker; `file/save` (current set) → uses current; `file/save-as` → always picker. | All routes call `SaveParticleSystem(*m_pps, chosenPath)`. Update path / dirty / recents. Emit `recent/changed` + `dirty/changed`. |
| `spawner/start { params }` | `m_spawnerDriver->SetConfig(<dto-to-config>)`. Cache config for snapshot. Emit `engine/state/changed`. |
| `spawner/trigger` | `m_spawnerDriver->Trigger(*m_pps, m_engine.get())`. No event emit needed (active-count event still requires per-frame tick which isn't wired). |
| `spawner/stop` | `SpawnerConfig cfg = m_spawnerDriver->GetConfig(); cfg.enabled = false; m_spawnerDriver->SetConfig(cfg);` Emit `engine/state/changed`. |
| `emitters/preview-from-file` | `LoadParticleSystem(fileManager, path)` → walk root emitters → build `EmitterTreeNode` tree → return `{ ok: true, tree }`. Temporary system drops at scope exit. |

**Snapshot extension** (`engine/state/snapshot`):

- `currentFilePath`: from host state (already exists per Batch 3).
- `dirty`: from host state (already exists per Batch 3).
- `spawner`: from `m_spawnerDriver->GetConfig()` (replaces the
  cached-config approach Batch 4 used as a stand-in).
- `emitters` tree: still placeholder until Screen 4 lands.

**Test surface for this batch:**

The hardest part is testing real file IO end-to-end. Pragmatic mix:

- **Existing tests still pass.** 72 Vitest + 43 Playwright must stay
  green. The forward-deferred handlers are gone, so any test that
  asserted "logs but doesn't mutate" needs reworking — generally
  these were observation tests via `engine/state/changed` and they
  should still pass because the real handlers also emit the event.
- **+3 Playwright specs**:
  - **Save round-trip**: pre-seed an `engine/set/skydome-slot`
    mutation, click File → Save (with current path via test-host
    set), assert the file exists on disk + size > 0 + dirty
    becomes false.
  - **Open round-trip**: after the save above, click File → New
    (mark dirty=false), then File → Open with the saved path,
    assert `engine/state/snapshot.currentFilePath` matches.
  - **Rescale actually mutates**: pre-seed a particle system with
    a known emitter lifetime, fire `engine/action/rescale-system
    { durationScalePercent: 200, sizeScalePercent: 100 }`, assert
    the emitter's lifetime in the next snapshot doubled. Requires
    `engine/state/snapshot` to surface enough emitter detail to
    assert — if it doesn't yet, this spec is dropped and noted.
- **+2 Vitest specs** in `bridge-contract.test.ts`: existing kinds
  still round-trip with the new MockBridge handlers (no schema
  change). One new spec: `file/new` + state-changed sequence.

**Open follow-ups** (explicitly out of scope for this batch):
- *Render loop wiring* — actually rendering the particle system in
  `--new-ui` viewport. Separate batch; needs Engine::Update +
  Engine::Render integration.
- *Per-frame spawner tick* — needs render loop. Same separate
  batch.
- *Active-count event from real spawner state* — same.
- *Engine state side-effects of file load* — when a particle
  system loads, the engine may need notification
  (`Engine::SetParticleSystem` or similar). Out of scope; the
  render-loop batch handles it.

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

### 2026-05-17 · Host state plumbing (cross-cutting foundation)

Activated nine forward-deferred handlers from Batches 1/3/4 by
giving `HostWindowImpl` ownership of a `unique_ptr<ParticleSystem>`
and `unique_ptr<SpawnerDriver>`. `BridgeDispatcher` gained a single
`BindHostState(unique_ptr<ParticleSystem>*, SpawnerDriver*,
IFileManager*)` accessor; HostWindow's `Run` calls it once after
construction. Pure-IO helpers `LoadParticleSystem` /
`SaveParticleSystem` extracted into `src/ParticleSystemIO.h` so
both legacy `LoadFile` / `DoSaveFile` / `ImportEmitters_LoadFile`
and the new-UI bridge handlers share the same read/write code path.

Commit: `8584669` (single feat — no new deps). Tests 74 Vitest
(72 → 74) + 46 Playwright (43 → 46). MSBuild 0/0.

**Handlers activated (all 9, no forward-defers needed):**

`engine/action/rescale-system` (iterates `getEmitters()` → calls
`DoRescaleEmitter` per emitter); `file/new` / `file/open` (with or
without path; native picker when missing); `file/save` /
`file/save-as` (picker fallback / always-picker semantics
respectively); `spawner/start` / `spawner/trigger` / `spawner/stop`
(via `SpawnerDriver::SetConfig` / `Trigger`); `emitters/preview-from-file`
(loads into temp `ParticleSystem`, walks roots, builds
`EmitterTreeNode` tree, drops at scope exit).

**Locks worth surfacing for future batches:**
- *Pure-IO factor-out is durable cross-mode infrastructure.* The
  helpers in `src/ParticleSystemIO.h` are owned-pointer / path
  in, success-bool / unique_ptr out. Side effects (MessageBox,
  history append, autosave flush, OnFileChange) stay in the
  legacy `Do*` callers. Both `--legacy-ui` and `--new-ui` exercise
  the same IO path. Any future host-side feature that needs to
  read or write a particle system uses these helpers, not
  `APPLICATION_INFO*`-coupled code.
- *Single `BindHostState` setter beats per-field setters.* All
  three pointers (`unique_ptr<ParticleSystem>*`,
  `SpawnerDriver*`, `IFileManager*`) wire at the same lifecycle
  moment (HostWindow init). A single setter signals "all three
  are now valid" atomically. The `**` for the particle system
  is intentional — handlers access the *current* one, which
  file/new and file/open replace; this mirrors the legacy
  `info->particleSystem` pattern.
- *Snapshot's `spawner` field is now driver-first with cache
  fallback.* `m_spawnerDriver ? SpawnerConfigToJson(m_spawnerDriver
  ->GetConfig()) : m_spawnerConfig`. The cache stays so unit-test
  paths (no driver bound) keep working. Pattern is reusable for
  any future field that has both a live source-of-truth and a
  fallback cache.

**Implementer surprises (from the subagent's report):**
1. *`IFile` is `RefCounted`, not RAII.* `IFile*` returned by
   `IFileManager::getFile` has refcount 1; caller calls
   `Release()` exactly once when done. The new helpers follow
   the same convention as legacy code. If a future batch wants
   RAII, wrap in a `std::unique_ptr<IFile, ReleaseDeleter>`
   typedef — but that's an opt-in refactor, not a required one.
2. *No factor-outs needed forward-defer.* All three legacy
   functions (`LoadFile`, `DoSaveFile`, `ImportEmitters_LoadFile`)
   separated cleanly into pure-IO + side-effects. The
   forward-defer escape hatch in the brief turned out unused. This
   bodes well for similar factor-outs in future batches.
3. *Snapshot `spawner` field changed shape silently.* Batch 4 had
   a `m_spawnerConfig` JSON cache as a stand-in; this batch
   replaced it with a live `m_spawnerDriver->GetConfig()` read,
   keeping the cache as fallback. No schema change, no test
   change required — the snapshot still returns the same shape.
   But code reading the snapshot's `spawner` field is now seeing
   driver state, not config-cache state.

**Open follow-ups for future batches:**
- *Render loop wiring.* `HostWindowImpl::RenderD3D9` at
  [src/host/HostWindow.cpp:410] still clears to background colour
  only. The particle system is owned + mutated but not visible.
  Activating this needs `Engine::Update + Render` integration,
  `SpawnerDriver::Tick` per-frame, and probably
  `Engine::OnParticleSystemChanged(track)` notification when
  `*m_pps` is replaced (file/new, file/open). This is the
  "particles actually visible in --new-ui" batch and is the
  natural next foundation step.
- *Active-count event live source.* `spawner/active-count` is
  still only sourced from MockBridge in browser mode. Goes live
  once per-frame tick lands (same batch as render-loop wiring).
- *Tighten the "is mutating" set for dirty flagging.* Batch 3
  open item, still open. `engine/set/paused` and
  `engine/set/heat-debug` shouldn't mark dirty; small follow-up
  to `isMutating()` (MockBridge) + the `m_markDirty` lambda
  branches (C++).

### 2026-05-17 · Render loop + per-frame tick (capstone foundation)

Particles are visible in `--new-ui`. The host's main loop now drives
`SpawnerDriver::Tick` → `Engine::Update` → `Engine::Render` on every
idle tick. Combined with the prior host-state-plumbing batch, the
new-UI binary has visual + behavioural parity with `--legacy-ui` for
non-emitter-editing workflows.

Commit: `a336d6d` (single feat — no new deps; no test reworks
needed). Tests 74 Vitest (unchanged) + 47 Playwright (46 → 47, +1
render-loop spec). MSBuild 0/0.

**What changed:**

- *Main loop conversion.* `HostWindowImpl::Run` switched from
  blocking `GetMessage` to `PeekMessage` idle-render at
  [src/host/HostWindow.cpp:~1019]. Drain queued messages, then
  render-once on idle, loop until WM_QUIT. No `IsDialogMessage`
  routing — the host has no modeless Win32 dialogs (tool panels
  live in React). When `engine == nullptr` (transient startup
  exception), `WaitMessage()` yields rather than spinning.
- *RenderD3D9 body.* Replaced the placeholder clear-to-background
  with the legacy three-line sequence. Added `m_lastRenderTime`
  + `m_lastEmittedActiveCount` host members. Uses the existing
  `GetTimeF()` helper from [src/engine.h:54] — already public,
  no factor-out needed.
- *Placeholder D3D9 device retired.* Host's `d3d`/`device`
  members + `InitD3D9()` deleted entirely. Engine owns its own
  device internally; two devices on one HWND was a structural
  hazard. WM_PAINT reduced to BeginPaint/EndPaint validation
  with no draw call — idle render owns the pipeline.
- *Engine notifications on `*m_pps` replacement.* `file/new` and
  `file/open` success paths now call `engine->Clear()` +
  `engine->OnParticleSystemChanged(-1)` after replacing the
  particle system. Without these the engine wouldn't pick up the
  new system. Matches legacy at [src/main.cpp:1207] /
  [src/main.cpp:1341] / [src/main.cpp:1522].
- *`spawner/active-count` live source.* `BridgeDispatcher::
  EmitSpawnerActiveCount(int)` helper added. Called from
  `RenderD3D9` when `Engine::GetNumInstances()` differs from
  `m_lastEmittedActiveCount`. Debounce avoids WebMessage spam.
  React SpawnerPanel subscribes to the existing event; only the
  source flipped from MockBridge timer to live engine state.
- *Dirty-flag tightening (Batch 3 open item closed).*
  `engine/set/paused` + `engine/set/heat-debug` no longer mark
  dirty. One-line each in `web/apps/editor/src/bridge/mock.ts`
  `isMutating()` + the C++ dispatcher cases. No existing test
  asserted dirty=true through these setters — zero test reworks
  needed.

**Locks worth surfacing for future batches:**
- *PeekMessage idle-render is the right loop shape for a hybrid
  WebView2 + D3D9 host.* WebView2's message routing happens
  inside `DispatchMessage`, so PeekMessage drains its messages
  the same as any other window message. Idle render at the end
  of the drain gives a clean 60-ish Hz cadence with no manual
  timer required (no WM_TIMER spam). Worth knowing for any
  future host that wants to drive D3D animation.
- *Single live source-of-truth + cache fallback pattern repeats.*
  The `spawner/active-count` event source-flip follows the same
  shape as the prior batch's snapshot `spawner` field (driver-
  first, cache-fallback). MockBridge keeps the cache for unit-
  test paths; production reads live engine state. The schema
  + React subscription doesn't change. Any future state that
  has both a mock-friendly cache and a live engine-driven source
  can follow this pattern.
- *Dropping the placeholder device was safe.* The subagent's
  intuition matched the structural hazard: two D3D9 devices on
  one HWND would have caused weird flickering or driver lock-up
  eventually. The host's `device` was scaffolding from
  pre-engine-integration days. Now that Engine owns its device
  unconditionally, the host's own device adds nothing.

**Implementer notes (from the subagent's report):**
1. *`GetTimeF()` was already public.* Declared at
   [src/engine.h:54], no factor-out needed. HostWindow.cpp
   already includes engine.h. Clean.
2. *First render frame in `--new-ui` worked without shimming.*
   Engine was already constructed in WM_CREATE by the prior
   batch with `(hwnd, hViewport, ...)`. We just had to start
   calling `engine->Render()`.
3. *Zero test reworks required by dirty-flag tightening.* No
   existing test asserted `dirty=true` via paused/heat-debug.
   The `bridge-contract.test.ts` `it.each` for setters asserts
   the snapshot's field value, not dirty state. The
   `host-state-plumbing.spec.ts` `file/new` / `file/open` specs
   passed unchanged after the new `engine->Clear()` +
   `OnParticleSystemChanged(-1)` calls — confirming those are
   safe (no crashes, no event regressions).

**Open follow-ups for future work** (explicitly deferred):
- *Camera controls* — middle/right mouse drag, scroll-zoom. Not
  in this batch. Separate "viewport interaction" batch.
- *Cursor-driven gravity test* — legacy has a mouse-cursor-as-
  D3D-object thing for testing emitter forces. Same separate
  batch.
- *Visual regression smoke* — particle rendering is verified
  indirectly via `spawner/active-count` event observation. A
  proper screenshot-diff harness would catch render bugs the
  count-observation can't. Not blocking; nice to have for a
  Phase 4 acceptance run.

### Foundation status after this batch

Phase 3 foundations are complete. The new-UI binary:

- Renders particles live (this batch).
- Reads/writes `.alo` files (host state plumbing).
- Owns the bridge surface for 10 of 13 Screen 8 sub-dialogs +
  Screen 7 primitives + Screens 1/2/3 shell.
- Has 121 automated tests gating regressions (74 Vitest + 47
  Playwright).

Remaining LT-4 surface:
- **Screen 4 — Emitter tree** (★★★★). The big load-bearing
  screen. Unblocks the three Screen-4-dependent sub-dialogs
  (Rescale Emitter, Increment Index, Link Group Settings).
- **Screen 5 — Curve editor** (★★★, large).
- **Screen 6 — Track editor** (medium-large).
- **Phase 4 — cutover** (parity acceptance, legacy delete,
  CHANGELOG/ROADMAP ship entry, release zip update).

### 2026-05-17 · Viewport interaction — camera controls

First user-input batch for the `--new-ui` viewport. Mouse drag
(MOVE / ROTATE / ZOOM with L/R-click + Ctrl modifier) + scroll-wheel
zoom now work on the D3D9 sibling HWND, mirroring legacy
[src/main.cpp:2923-3060] line-by-line. Combined with the prior
render-loop batch, `--new-ui` is fully usable for non-emitter-
editing camera-driven workflows.

Commit: `24431d3` (single feat — no new deps; no test reworks).
Tests 74 Vitest (unchanged) + 48 Playwright (47 → 48, +1
camera-setter round-trip spec). MSBuild 0/0.

**What changed:**

- *Drag-state on `HostWindowImpl`*. New `DragMode` enum
  (`NONE/MOVE/ROTATE/ZOOM`) + four members: `m_dragMode`,
  `m_dragStartCam`, `m_dragStartX`, `m_dragStartY`. All zero-init.
- *`ViewportWndProc` rewritten*. Was just `WM_PAINT` +
  `WM_ERASEBKGND`. Now handles `WM_LBUTTONDOWN/UP`,
  `WM_RBUTTONDOWN/UP`, `WM_MOUSEMOVE`, `WM_MOUSEWHEEL`,
  `WM_CAPTURECHANGED`. Mouse-down does `SetCapture(hwnd)` +
  `SetFocus(hwnd)`, snapshots the camera, saves start XY.
  Mouse-up releases capture, resets mode. Capture-changed
  resets mode defensively (handles Alt-Tab-away-mid-drag).
- *Camera math lifted verbatim*. Same `D3DXMatrixRotationZ` +
  `D3DXMatrixRotationAxis` + orthogonal-vector setup for ROTATE.
  Same `D3DXVec3Length / 1000` distance-multiplier for MOVE.
  Same `sqrtf(olddist) * -y` for ZOOM-via-drag. Same
  `(SHORT)HIWORD(wp) / WHEEL_DELTA` for wheel ZOOM. Only
  deviation: explicit `sqrtf` (float overload) where legacy used
  unqualified `sqrt` — numerically identical.
- *`EmitEngineStateChanged` after every `SetCamera`*. Camera
  changes via direct C++ call bypass the bridge dispatcher's
  setter ladder, so they don't auto-emit `engine/state/changed`.
  The mouse handler explicitly emits after each move + wheel
  notch so React's snapshot stays current.
- *No dirty-marking on camera*. Camera state isn't file content.
  Legacy never calls `SetFileChanged` from camera handlers; new
  code matches by bypassing `markDirty()` entirely (the
  dispatcher's setter ladder is where it lives; C++ mouse code
  doesn't go through it).

**Locks worth surfacing for future batches:**
- *Direct C++ engine mutations need explicit `EmitEngineStateChanged`.*
  Anything that mutates engine state without going through the
  bridge dispatcher's setter ladder (mouse handlers, render-loop
  side effects, file-load engine notifications) needs to emit the
  state-changed event manually. The dispatcher's setter handlers
  do it automatically; bypass paths don't. Generalizable rule:
  any new C++ code that calls `engine->Set*` directly needs to
  follow with a `dispatcher->EmitEngineStateChanged()` (or accept
  that React won't see the change until the next setter call).
- *Verbatim math fidelity matters for user muscle memory.* The
  legacy drag multipliers (`/2.0f` for rotate, `/1000` for move,
  `sqrt(olddist)` for zoom) have been tuned over many years and
  users have muscle memory for them. Porting them line-by-line
  was the right call; inventing "improved" math would have
  caused subtle regressions in feel. Same discipline likely
  applies to future input-handling ports (camera presets,
  emitter manipulation, etc.).

**Implementer notes (from the subagent's report):**
1. *`MK_CONTROL` is read at button-down only.* Legacy and new
   both check the Ctrl bit when the drag starts; mid-drag
   modifier toggles do NOT switch modes. This is intentional
   behaviour — users press Ctrl before clicking to indicate
   "zoom this drag" and don't expect mid-drag mode switches.
2. *`Engine::GetCamera` returns const ref, requires copy-before-
   mutate.* `Engine::Camera camera = m_dragStartCam;` is the
   right pattern. Then pass the mutated local back to
   `SetCamera` by const ref.
3. *No WebMessage spam at human input rates.* Camera emit fires
   once per mouse-move (~100Hz peak during fast drag), well
   within WebMessage's throughput. No debouncing needed at
   today's rates; the render-loop's `spawner/active-count`
   already demonstrates the same shape works at 60Hz.
4. *Manual mouse drag wasn't driven from the dispatch environment.*
   Subagent ran the test:native suite (which uses --test-host CDP
   + the bridge round-trip spec) but didn't drive actual mouse
   events on the sibling HWND. The camera-setter round-trip
   spec covers the underlying engine wiring; user-level drag
   feel is a manual smoke check the controller or user can run
   in an interactive session.

**Open follow-ups for future batches** (explicitly deferred):
- *Shift-click-to-spawn* (legacy line 2956) — needs `MouseCursor`
  `Object3D` port + `GetCursorPos3D` helper. Standalone batch.
- *Status-bar mouse coordinates* (legacy line 3041) — Screen 1
  polish. Adds a fifth StatusBar column.
- *Reset View Settings menu item* (legacy registry-cleanup of
  multiple persisted view settings). Deserves its own batch once
  `--new-ui` consistently persists those settings.
- *Touch / pen input* — not in scope.

### 2026-05-17 · Shift-click-to-spawn (cursor-bound spawn)

Camera-controls follow-up. The user can now hold Shift in the
`--new-ui` viewport to spawn a cursor-bound particle system that
tracks the mouse's 3D position + velocity, releasing Shift to kill
the instance. Matches `--legacy-ui` feel. The "fling particles by
shaking the cursor" workflow works.

Commit: `bee143c` (single feat — no new deps; no test reworks).
Tests 74 Vitest (unchanged) + 48 Playwright (unchanged). MSBuild
0/0. No new bridge surface, no React changes — pure C++ side
effect in `ViewportWndProc` + `RenderD3D9`.

**What changed:**

- *`MouseCursor` factored into `src/MouseCursor.h`.* Was a static
  class in `src/main.cpp:369-399`. New header is verbatim-port +
  include-guarded; folds in `GetCursorPos3D` (was static at
  `src/main.cpp:2877-2890`) since the two are conceptually paired.
  `engine.h`'s transitive includes already bring in `<d3dx9.h>`
  + `<windows.h>`, so no extra include juggling needed. Both
  `--legacy-ui` (main.cpp) and `--new-ui` (host/HostWindow.cpp)
  now include the same header — single source of truth.
- *HostWindowImpl gains four new members*: `MouseCursor m_mouseCursor`,
  `ParticleSystemInstance* m_attachedParticleSystem`,
  `m_lastCursorX/Y` cache. The cursor cache fixes the legacy bug
  (more below).
- *`ViewportWndProc` extensions*: `WM_KEYDOWN VK_SHIFT` (initial
  press only, via `(~lp & 0x40000000)` filter) calls
  `GetCursorPos3D` + `m_mouseCursor.SetPosition` +
  `engine->SpawnParticleSystem(**m_particleSystem, &m_mouseCursor)`.
  `WM_KEYUP VK_SHIFT` calls `engine->KillParticleSystem` + clears
  the pointer. `WM_MOUSEMOVE` always caches `(x, y)` + updates
  `m_mouseCursor.SetPosition` (regardless of drag mode) so the
  attached instance tracks the cursor. `WM_KILLFOCUS` + `WM_DESTROY`
  kill cleanly on focus loss / shutdown.
- *`RenderD3D9` calls `m_mouseCursor.UpdateVelocity()`* before
  `engine->Update()`. Matches legacy `Render` at
  `src/main.cpp:1904`. The velocity (computed from
  `QueryPerformanceCounter`-based dt) is what makes particles
  inherit cursor flick speed.
- *`BridgeDispatcher::BindAttachedSystem(ParticleSystemInstance**)`*
  added as a separate setter (kept `BindHostState`'s 3-arg shape
  stable). `file/new` and `file/open` handlers kill the attached
  instance before replacing `*m_pps` so the kill traverses
  through valid state.

**The legacy bug NOT reproduced:**

Legacy `WM_KEYDOWN VK_SHIFT` at `src/main.cpp:2960` passes
`(SHORT)LOWORD(lParam), (SHORT)HIWORD(lParam)` to
`GetCursorPos3D`. But `WM_KEYDOWN`'s lParam is `[repeat-count]
[scan-code][extended][context][prev-state][transition]` — NOT
cursor coords. So legacy reads garbage on every Shift-press for
its initial cursor pos, then immediately overwrites it on the
next `WM_MOUSEMOVE` (which fires almost always within 16ms). The
bug is invisible in legacy because of that follow-up move. The
new-UI code uses the cached `m_lastCursorX/Y` from prior
`WM_MOUSEMOVE` (or `GetCursorPos + ScreenToClient` as fallback
when the cache is zero — user pressed Shift before ever moving
the cursor over the viewport). Cleaner than legacy.

**Locks worth surfacing for future batches:**
- *Factor-out enables zero-duplication cross-mode features.* The
  pattern from host-state-plumbing (`ParticleSystemIO.h`) now
  applies to UI features too: `MouseCursor.h` lives in one place
  and both `--legacy-ui` and `--new-ui` consume it. The cost is
  one header file + a brief commit; the benefit is that any
  future change to the class touches one site, not two. Same
  pattern likely applies to future viewport features (shift-drag
  variants, attached-system multi-spawn, cursor visualization).
- *Separate setters beat extending a multi-arg one when scopes
  differ.* `BindAttachedSystem` is UI-input state; `BindHostState`
  is file-system + driver state. Keeping them as separate setters
  avoids re-touching every BindHostState call site every time the
  list grows. Generalizable rule: when adding state to
  BridgeDispatcher, prefer a separate small setter over extending
  an existing one — they're cheap and the call sites stay stable.
- *Cached-from-prior-event values are a reusable pattern for
  Win32 message handlers that need data not in their own params.*
  `m_lastCursorX/Y` from `WM_MOUSEMOVE` consumed by `WM_KEYDOWN`
  is the same shape as `m_dragStartCam` from `WM_*BUTTONDOWN`
  consumed by `WM_MOUSEMOVE`. Any future handler that needs
  context from an earlier event follows the same: cache on the
  earlier handler, read on the later. The fallback path
  (`GetCursorPos` + `ScreenToClient`) handles the cold-start
  edge case.

**Implementer notes (from the subagent's report):**
1. *No include-order surprises.* `engine.h` transitively pulls
   `<d3dx9.h>` and `<windows.h>` via `types.h`, so
   `MouseCursor.h` compiles cleanly in both translation units
   without extra fiddling.
2. *Defensive cleanups are not symmetric.* `file/new` kills
   *before* replacing `*m_pps` (the kill needs the old system
   for its traversal). `file/open` kills *after* `LoadParticleSystem`
   succeeds but *before* the `std::move` swap (the old system is
   still valid until the move). The order matters because
   `KillParticleSystem` traverses the instance's emitter
   references — those become dangling the moment `*m_pps` is
   replaced.
3. *Single attached instance matches legacy.* Legacy's guard at
   `info->attachedParticleSystem == NULL` prevents multi-spawn-
   per-Shift-hold. The new code follows. If a user wants
   multi-spawn, they'd hold Shift then click+release the mouse —
   but the implementation isn't there. Documented as deferred.

**Open follow-ups** (out of scope):
- *Wireframe cursor visualization.* Legacy renders `MouseCursor`
  as a small wireframe object via the engine. Subtle visual cue
  for "where the spawn point is." Polish batch.
- *Status-bar mouse coordinates.* Screen 1 polish (still
  deferred from camera-controls batch).
- *Reset View Settings.* Multi-setting registry cleanup;
  needs `--new-ui` persistence maturity.
- *Multi-spawn-per-Shift-hold.* Could be enabled by removing the
  null-check and tracking a `std::vector<ParticleSystemInstance*>`.
  Speculative; not requested.

### 2026-05-17 · Screen 4 Batch A (read-only emitter tree + selection)

First of three batches for the load-bearing screen. Replaces the
sidebar `(placeholder — Phase 3 Screen 4)` with a real read-only
emitter tree fed by the live particle system, plus click-to-select
sync via `emitters/selected` event + `selectedEmitterId` on
`EngineStateDto`. Batches B and C add mutations + drag/drop +
context menu + link-group brackets + inline rename + keyboard nav.

Commit: `0d1c46b` (single feat — no new deps). Tests 78 Vitest
(74 → 78, +2 contract + 2 EmitterTree component specs) + 50
Playwright (48 → 50, +2 specs). MSBuild 0/0.

**What changed:**

- *Real `EmitterTreeNode` shape*. Was `{ id, name, children }`
  placeholder from Batch 4's import preview. Now `{ id, name,
  role, linkGroup, visible, children }` with `role: "root" |
  "lifetime" | "death"` derived from parent slot. Existing
  `emitters/preview-from-file` populates the new fields (preview
  trees show role / linkGroup from the source `.alo` and
  visible always true).
- *Real `emitters/list` C++ handler*. Walks `(*m_pps)->
  getEmitters()`, identifies roots (parent == nullptr) as
  children of a synthetic root (`id: -1`), recurses into
  `spawnDuringLife` / `spawnOnDeath` (both `size_t` indices;
  sentinel for "no child" is `(size_t)-1` per the grep of legacy
  EmitterList.cpp lines 1349 / 1448 / 3420 / 4443).
- *Selection lives in BridgeDispatcher* — `int m_selectedEmitterId
  = -1` internal member (NOT plumbed through `BindHostState`
  because selection is editor-local, not engine state). `emitters/
  select` updates the field, emits `emitters/selected { id }`
  event, AND emits `engine/state/changed` so React's snapshot
  consumers see the new value. Snapshot serialises `-1` as JSON
  `null` to match the `number | null` schema discriminator.
- *React `EmitterTree`* — replaces the sidebar placeholder.
  Fetches via `emitters/list` on mount, subscribes to
  `emitters/tree/changed` (no-op until Batch B mutations emit
  it) + `emitters/selected`. Rows are buttons with role glyph
  (`●` root / `↻` lifetime / `✕` death), link-group dot when
  `linkGroup !== 0`, indent via `paddingLeft: 8 + depth * 12 px`.
  Selected row gets `bg-sky-500/15 border-l-2 border-sky-500`.
  `data-emitter-id` attribute on each button so Playwright +
  future Batch B tests can target rows without text-matching.

**Locks worth surfacing for future batches:**

- *Selection state belongs inside BridgeDispatcher, not the host.*
  Editor-local state (selection, hover state, scroll position,
  expand/collapse) that doesn't affect engine behaviour stays
  in the dispatcher. Host plumbs in only what the engine
  actually touches (`ParticleSystem` ownership, `SpawnerDriver`,
  `IFileManager`, the attached cursor system from shift-spawn).
  Cleaner separation; less for `BindHostState` to grow.
- *Subscribe-to-events from React, derive everything from
  snapshot.* No local React state mirroring the server's
  selection. The server is the source of truth; React just
  reads from snapshot. Same pattern as the Spawner panel's
  `lastCommitted` ref breaking the echo loop. Generalizable:
  any state that has a clear server source-of-truth should NOT
  also have a React-side mirror. Pick one.
- *Sentinel-by-grep is durable.* Legacy used `(size_t)-1` for
  "no spawn child" in four separate places. The new code uses
  `static_cast<size_t>(-1)` directly, matching. Any future C++
  port that needs to walk emitter relationships uses the same
  sentinel.

**Implementer notes (from the subagent's report):**

1. *Pre-existing "rejects emitters/* as not implemented" test
   needed adjusting.* `bridge-contract.test.ts:236` asserted
   `emitters/list` throws. Now it asserts on `emitters/update`
   instead (still unimplemented in Batch A; lands in Batch B).
   When Batch B implements `emitters/update`, this test will
   need to flip again to assert on `emitters/move` or
   `emitters/duplicate` (whichever remains the last
   unimplemented kind). Generalizable: per-kind "not implemented"
   assertions migrate forward as kinds get implemented.
2. *Host's default ParticleSystem has 1 emitter only.* The
   Playwright spec works fine on the single-row case. If Batch
   B tests want a richer tree, the host's init at
   [src/host/HostWindow.cpp:1274] could `addLifetimeEmitter` /
   `addDeathEmitter` a couple of children. Cheap when needed.
3. *No selector collisions in tests.* The EmitterTree uses
   `data-testid="emitter-tree"` + `role="tree"` + `role="treeitem"`.
   No conflict with the existing Radix `role="dialog"` /
   `role="menu"` etc.

**Open follow-ups for Batches B + C** (explicitly NOT in this
batch):

- **Batch B**: mutations (`emitters/duplicate`, `emitters/delete`,
  `emitters/move`, `emitters/update`, `emitters/rename`), context
  menu, drag/drop, multi-select. Wires the three Screen-4-blocked
  Screen-8 sub-dialogs (Rescale Emitter, Increment Index, Link
  Group Settings).
- **Batch C**: link-group bracket visualisation (MT-9 port), F2 /
  double-click inline rename, keyboard nav (arrows / Enter /
  Delete / Cut / Copy / Paste).

### 2026-05-17 · Screen 4 Batch B2 (add child + move + link-group membership + multi-select)

Third of three batches for the load-bearing screen. Adds the
remaining structural mutations (Add Lifetime/Death Child, Move
Up/Down), the multi-emitter link-group membership flow (Set Link
Group… modal + Leave Link Group), and React-side multi-select
(Ctrl/Cmd / Shift / plain click). After this batch only Batch B3
(drag/drop reorder + reparent) and Batch C (link-group bracket
visualisation, F2 / double-click inline rename, keyboard nav) remain
on Screen 4.

Tests: 105 Vitest (90 → 105, +8 spec targets met with margin) + 57
Playwright (54 → 57). MSBuild 0/0.

**What changed:**

- *4 new bridge call kinds.* `emitters/add-lifetime-child`,
  `emitters/add-death-child`, `emitters/move`,
  `linkGroups/set-membership`. All round-trip through MockBridge +
  real C++ host implementations.
- *Direct fit on the engine API.* `ParticleSystem::addLifetimeEmitter`
  / `::addDeathEmitter` / `::moveEmitter` were already present and
  had the exact semantics the schema needs (refuse when slot is
  filled, swap adjacent roots only, return new emitter / true/false).
  No factor-out from legacy needed. `Emitter::linkGroup` is a plain
  uint32_t field — direct assignment suffices for membership writes.
- *Six new context-menu items* with disabled states on EmitterTree
  rows: Add Lifetime/Death Child, Move Up/Down, Set Link Group… /
  Leave Link Group. Add-child disabled states derive from the child
  list's roles (`children.some(c => c.role === "lifetime")`) — the
  tree DTO doesn't expose `spawnDuringLife`/`spawnOnDeath` but the
  derivation is equivalent. Move Up/Down only enabled on roots and
  respect first/last-sibling edges.
- *New `lib/emitter-selection.ts` Zustand atom* drives the React-side
  multi-selection (`ids: number[]`, `primary: number | null`).
  Actions: `setSingle` / `toggle` / `range(toId, orderedIds)` /
  `clear`. Tree-order for shift-range = in-order walk of the
  rendered tree (the new `flattenTree` helper). Server still tracks
  only the primary via the existing `emitters/select` channel; the
  ids list rides only on bridge calls that take a batch.
- *EmitterTree rendering refactored to a flat in-order list.* The
  previous nested `<ul role="group">` per-child render carried more
  DOM cost than necessary; the depth-first flat render keeps
  treeitem roles + per-row indentation while making the shift-click
  ordered-id computation trivial.
- *New `SetLinkGroupDialog`* modal with two radios: Create new group
  (default; emits `groupId: -1`) and Join existing group (lists
  every distinct linkGroup > 0 from the live tree in a `<select>`;
  the radio is disabled when no groups exist).
- *Right-click promotion.* If the user right-clicks a row that
  isn't in the multi-selection, the menu open-path promotes the row
  to a single-select before mounting the menu. Matches typical OS
  behaviour and keeps the batch operations operating on the row the
  user actually targeted.

**Locks worth surfacing for future batches:**

- *`ParticleSystem::moveEmitter` rewrites emitter indices.* Playwright
  specs that hold on to an emitter `id` across a move call must
  re-look-up the emitter (by name or other stable property) after
  the call. The wire `id` is `index in m_emitters`, which the move
  rebalances. Caught a flaky spec on the first run.
- *Tree-DTO role derivation is sufficient for slot-fill checks.* No
  need to extend the DTO with `spawnDuringLife` / `spawnOnDeath`
  sentinels — `children.some(c => c.role === X)` is equivalent and
  keeps the wire surface narrow. Generalizable: prefer deriving
  state from the existing tree shape over widening the DTO.
- *Multi-select stays React-side cleanly.* The decision to keep
  `ids[]` in React + only `primary` on the server cost zero
  schema entries beyond the batch's four mutation kinds. Generalizable
  to any future "batch op over UI multi-selection" — the host
  doesn't need to track the set.

### 2026-05-17 · Screen 4 Batch B1 (mutations + context menu + 3 Screen-8 sub-dialogs)

Second of three batches for the load-bearing screen. Right-click
context menu on every emitter row now offers Rename / Duplicate /
Delete / Increment Index… / Rescale Emitter… / Link Group
Settings…. The last three were the final Screen 8 sub-dialogs
blocked on Screen 4 — **all 13 of 13 Screen 8 sub-dialogs now
shipped.** Drag/drop, multi-select, Add Lifetime/Death Child,
Set/Leave Link Group, Move Up/Down stay deferred to Batches B2 +
C.

Commit: `8e460a4` (single feat — no new deps; `@radix-ui/react-context-menu`
already a dep from Screen 7). Tests 90 Vitest (78 → 90, +8 contract
+ 4 dialog) + 54 Playwright (50 → 54, +4 mutation specs). MSBuild
0/0.

**What changed:**

- *8 new bridge call kinds.* `emitters/duplicate`,
  `emitters/delete`, `emitters/rename`,
  `emitters/duplicate-with-index-increment`,
  `engine/action/rescale-emitter`, `linkGroups/list-exempt-fields`,
  `linkGroups/set-exempt-fields`,
  `linkGroups/reset-exempt-fields`. All round-trip through
  MockBridge + real C++ host implementations — zero
  forward-defers needed.
- *MT-10 access turned out clean.* The exempt-set storage is
  already public on `ParticleSystem` via
  `getLinkExemptFlags(uint32_t groupId)` /
  `setLinkExemptFlags(...)` (see `src/ParticleSystem.h:372`).
  No header factor-out required; no `src/LinkGroups.h` created;
  legacy `EmitterList.cpp` untouched.
- *Legacy `GenerateDuplicateName` was extern-linkable.* The
  name-suffix algorithm (`<base>_<N+1>` over the highest
  matching base) ships verbatim from the legacy via a single
  `extern std::string` declaration in the dispatcher. No
  duplication, no risk of drift.
- *`emitters/duplicate-with-index-increment`* mirrors legacy
  `ShiftIndexTrack` at `src/UI/EmitterList.cpp:2307`: shifts the
  TRACK_INDEX track values by `delta`. The actual mutation
  rebuilds the `std::multiset` keymap (multiset iterators are
  const-qualified so in-place value mutation isn't possible).
- *Radix ContextMenu on tree rows.* Each row's `<button>` wrapped
  in `<ContextMenu.Root>` + `<ContextMenu.Trigger asChild>`.
  Items in the locked order with two separators. "Link Group
  Settings…" disables (`disabled={!isLinked}`) when
  `emitter.linkGroup === 0`, rendered with `data-disabled` for
  styling.
- *`emitters/tree/changed` now actually emits.* Batch A wired
  the React subscription as a no-op; this batch makes the C++
  host emit the event after every mutation. New
  `BridgeDispatcher::EmitEmittersTreeChanged()` helper.
- *Four new modals* under `screens/`: `RenameEmitterDialog`,
  `IncrementIndexDialog`, `RescaleEmitterDialog`,
  `LinkGroupSettingsDialog`. State driven by a new
  `lib/tree-context.ts` Zustand atom (same pattern as
  `lib/tool-panel.ts` for the right-side panels).

**Locks worth surfacing for future batches:**

- *Legacy `extern`-linkable helpers are free reuse.* The
  `GenerateDuplicateName` find was a meaningful save —
  duplicating a 30-line name-suffix algorithm in a new
  translation unit would have introduced a drift risk. Same
  pattern likely applies to any future port: grep for
  non-`static` legacy helpers BEFORE writing new copies. The
  legacy is a goldmine when its functions happen to be at file
  scope.
- *`extern` declarations beat factor-out-into-new-header when
  the function is already file-scope-callable.* This batch had
  the cleaner option to factor `GenerateDuplicateName` into
  `src/EmitterNames.h` for symmetry with prior batches'
  `MouseCursor.h` / `ParticleSystemIO.h`. The choice not to
  factor it was deliberate — the legacy function is small,
  doesn't have other consumers yet, and adding a header for one
  function is over-engineering. Generalizable: factor-into-header
  is the right call when you have ≥2 consumers OR when the
  function's signature is at a meaningful API boundary; an
  `extern` declaration in one consumer is fine otherwise.
- *Modal-flow Zustand atom pattern repeats.* Three different
  Zustand atoms now drive modal/panel open state:
  `lib/tool-panel.ts` (right-side tool panels),
  `lib/file-state.ts` (save-changes prompt + recent files),
  `lib/tree-context.ts` (emitter-context-menu modals). Each
  has a `{ open: <kind> | null; target: <id> | null }` shape.
  Generalizable: when adding a new family of related modals,
  reach for a small Zustand atom over individual `useState`s
  threaded through props.

**Implementer notes (from the subagent's report):**

1. *Radix ContextMenu in jsdom needed no workaround.* Vitest
   dialog tests bypass the Radix-open path entirely (they call
   `openDialog()` on the Zustand atom directly), and Playwright
   exercises the real Radix path via CDP. The
   `pointerDownOutside` / `pointer-capture` workarounds from
   prior batches (Modal, Select) didn't apply.
2. *`kLinkFieldTable` is dispatcher-local on purpose.* Legacy
   has a `kLinkSettingsFields` table mapping display labels to
   `bool LinkExemptFlags::*` member pointers. Sharing the legacy
   table would have required either a label↔name lookup table
   or coupling the wire surface to display strings. The
   dispatcher's local table maps stable camelCase wire names
   directly. 50 entries duplicated cheaply; coupling avoided.
3. *Mock duplicate name annotation.* MockBridge's
   `duplicateWithIndexIncrement` appends ` (+N)` to the
   duplicate's name so the contract test can assert `delta`
   arrived. Native handler doesn't do this — the delta lands on
   the TRACK_INDEX track values, not the name. The contract
   spec only verifies the wire round-trip; the actual track
   shift is asserted indirectly by the Playwright `tree/changed`
   count.

**Open follow-ups for Batches B2 + C** (explicitly NOT in B1):

- **Batch B2**: Add Lifetime/Death Child operations, Set/Leave
  Link Group (group membership — distinct from B1's exempt-set
  editing), Move Up/Down, multi-select state.
- **Batch B3**: Drag/drop reordering + reparent-via-drag.
- **Batch C**: Link-group bracket visualisation (MT-9 port), F2
  / double-click inline rename (replaces B1's modal), keyboard
  nav (arrows / Enter / Delete / Cut / Copy / Paste).

### Screen 8 status after Batch B1 — fully closed

13 of 13 Screen 8 sub-dialogs shipped:

| Sub-dialog | Where it shipped |
|---|---|
| About | Batch 1 |
| Rescale System | Batch 1 |
| Background picker | Phase 2 (refactored Batch 2) |
| Lighting | Batch 2 |
| Bloom settings | Batch 2 |
| Ground Texture Picker | Batch 2 |
| File-ops backbone | Batch 3 |
| Spawner | Batch 4 |
| Import Emitters | Batch 4 |
| Mod Nickname | Batch 4 |
| **Rescale Emitter** | **Screen 4 Batch B1** |
| **Increment Index** | **Screen 4 Batch B1** |
| **Link Group Settings** | **Screen 4 Batch B1** |

Screen 8 is fully shipped pending the Phase 4.2 legacy delete.

### 2026-05-17 · Screen 4 Batch B2 (Add Child + Move + Link-group membership + multi-select)

Third of three structural Screen 4 batches. After this batch only
B3 (drag/drop) and C (link-group brackets, inline rename, keyboard
nav) remain on Screen 4.

Commit: `aecfdab` (single feat — no new deps). Tests 105 Vitest
(90 → 105, +15) + 57 Playwright (54 → 57, +3). MSBuild 0/0.

**What changed:**

- *4 new bridge call kinds.* `emitters/add-lifetime-child` /
  `emitters/add-death-child` wrap `ParticleSystem::addLifetimeEmitter`
  / `::addDeathEmitter` (return `{ newId }` or `newId: -1` when
  parent's slot is filled — matches legacy refuse-on-full).
  `emitters/move` wraps `ParticleSystem::moveEmitter` (public
  method; root-only adjacent swap). `linkGroups/set-membership`
  takes `ids: number[]` + `groupId: number | null` with three
  sentinel forms: `> 0` joins existing, `null`/`0` leaves, `-1`
  creates new (host picks smallest unused positive `uint32_t`).
- *No legacy factor-out needed.* `ParticleSystem::moveEmitter`
  is a public method on the class itself, not a legacy UI helper.
  Same pattern as B1's MT-10 finding.
- *Multi-select stays React-side.* New `web/apps/editor/src/lib/
  emitter-selection.ts` Zustand atom with `{ ids: number[];
  primary: number | null }` shape + `setSingle` / `toggle` /
  `range` / `clear` actions. Server tracks only `primary` via
  existing `emitters/select`/`selected`; batch operations route
  React's `ids` list through the wire. Tree container exposes
  `data-selected-count` + `data-primary-id` for Playwright.
- *In-order flatten powers both render and shift-click range.*
  EmitterTree flattens the tree into a single in-order list per
  render; the same list drives `range(fromId, toId)` selection.
  No "what does tree-order mean" ambiguity across nested
  parent/child boundaries.
- *6 new context-menu items* with disabled states derived from
  the existing tree DTO: Add Lifetime/Death Child (disabled when
  slot filled), Move Up/Down (disabled at edges of in-order
  list), Set Link Group… (opens modal), Leave Link Group
  (disabled when no selected emitter is linked).
- *Right-click promotes to single-select first.* If the user
  right-clicks a row not in the multi-selection, the row is
  promoted to single-select before the menu opens. Matches
  Explorer / Finder behaviour, avoids stale-multi-selection trap.
- *`SetLinkGroupDialog` modal* — Radix radio group with "Create
  new group" / "Join existing group" + `<select>` populated from
  distinct `linkGroup > 0` values in the live tree. "Join
  existing" disabled when no existing groups exist.

**Locks worth surfacing for future batches:**

- *Engine-layer public methods keep appearing.* B1's MT-10
  finding (`getLinkExemptFlags` / `setLinkExemptFlags` on
  `ParticleSystem`); B2's `moveEmitter` (public method).
  Generalizable: when porting a legacy UI mutation, **first
  grep `src/ParticleSystem.h` and `src/engine.h` for the verb**
  before searching `src/UI/`. The engine API surface is
  consistently more accessible than the legacy UI suggests.
- *Multi-select belongs in React when no engine state depends
  on it.* Selection drives UI behaviour (which rows highlight,
  which ids batch operations target); nothing in the engine
  reads it. Keeping it React-side means no schema growth, no
  `EngineStateDto` extension, no sync races, no "selection
  includes deleted id" edge cases.
- *Right-click promotes to single-select.* Subtle UX detail
  modern file managers all do. A right-clicker probably wants
  the right-clicked row to be the target, even with a stale
  multi-selection from earlier. Apply to any future
  context-menu-on-list surface.
- *In-order flatten is a clean structural choice for any
  hierarchical UI with multi-select-range support.* The flat
  list is the visual order, the shift-click target order, AND
  the move-up/down semantic order — three concepts that would
  otherwise require separate computations. One traversal, one
  list, three uses.

**Open follow-ups for Batches B3 + C** (explicitly NOT in B2):

- **Batch B3**: drag/drop reordering + reparent-via-drag.
- **Batch C**: link-group bracket visualisation (MT-9 port), F2 /
  double-click inline rename (replaces B1's modal), keyboard nav
  (arrows / Enter / Delete / Cut / Copy / Paste).

### Screen 4 progress after Batch B2

| Batch | Status |
|---|---|
| A — Foundation (read-only tree + click-to-select) | ✅ shipped |
| B1 — Mutations + context menu + 3 Screen-8 sub-dialogs | ✅ shipped |
| **B2 — Add Child + Move + Link-group membership + multi-select** | **✅ shipped** |
| B3 — Drag/drop + reparent | ⏳ pending |
| C — Link-group brackets + inline rename + keyboard nav | ⏳ pending |

Screen 4 fully ✅ after B3 + C.

### 2026-05-17 · Screen 4 Batch B3 (drag/drop reorder + reparent)

Final structural Screen 4 batch. HTML5 drag-and-drop on tree rows
with three drop-zones per row (upper third = reorder above, middle
= reparent, lower = reorder below). Visual feedback: 2px insertion
line for reorder, ring-tinted target for reparent. After this batch
only Batch C (link-group brackets, inline rename, keyboard nav)
remains on Screen 4.

Commit: `2cbdad1` (single feat — no new deps). Tests 109 Vitest
(105 → 109, +4) + 59 Playwright (57 → 59, +2). MSBuild 0/0.

**What changed:**

- *1 new bridge call kind.* `emitters/drop` tagged-union with
  two `mode` variants: `"reorder"` (`{ id, rootIndex }`) wraps
  `ParticleSystem::moveEmitterToRootIndex`; `"reparent"`
  (`{ id, targetId, slot: "lifetime" | "death" }`) wraps
  `::reparentEmitter` with `slot === "lifetime"` mapping to the
  method's `useSpawnDuringLife: true`. Return shape is union
  `{ ok: true } | { ok: false; error: string }`.
- *Engine layer already has what we need.* Both methods are
  public on `ParticleSystem` (no legacy factor-out needed —
  pattern continues from B1's MT-10 and B2's `moveEmitter`).
  Verified semantics from source comments: gap K means "before
  root K"; both methods refuse same-position no-ops.
- *React DnD via native HTML5 API.* No library dep. Each row
  gets `draggable` + `onDragStart`/`Over`/`Leave`/`Drop`/`End`.
  Drop-zone math is a pure helper in
  `web/apps/editor/src/lib/drop-zone.ts` (`computeDropZone(y,
  height)` returns `"above" | "onto" | "below"` per row-thirds).
- *Drop indicator lifted to EmitterTree component.* Single
  `{ targetId, zone } | null` state at the tree level instead
  of per-row. Only one row at a time shows feedback. Rows check
  `indicator.targetId === node.id` to decide rendering.
- *`onDragLeave` bubbling correctly handled.* The perennial DnD
  bug source — `dragleave` fires when the cursor crosses any
  *child* element boundary. Guarded with
  `e.relatedTarget && e.currentTarget.contains(next) → return`
  so leaves to internal spans/icons don't clear prematurely.
- *Pure validation helpers in `lib/drop-zone.ts`.* `isDescendant`
  (DFS over `children`), `resolveReparentSlot` (returns null when
  both slots filled), `computeRootGapIndex`. Pure functions =
  easy Vitest. Self-drop / descendant-drop / slot-full reparent
  / same-parent reparent all short-circuit BEFORE the bridge
  call.
- *Visual styling.* Insertion line: 2px `bg-sky-400`
  absolutely-positioned at row top/bottom, `z-10`,
  pointer-events-none. Reparent target: `bg-sky-500/30 ring-1
  ring-sky-400` on the row button. Source row gets `opacity-50`
  during drag.

**Locks worth surfacing for future batches:**

- *Engine-layer-first heuristic confirmed for a third batch.*
  B1 found `getLinkExemptFlags`/`setLinkExemptFlags` public on
  `ParticleSystem`. B2 found `moveEmitter` public. B3 found
  `reparentEmitter` + `moveEmitterToRootIndex` public. **Always
  grep `src/ParticleSystem.h` / `src/engine.h` for the verb
  before searching `src/UI/`.** Three batches' worth of evidence
  for promoting this to lessons.md as a documented rule.
- *Pure helpers over DOM-coupled handlers when possible.* Drop-
  zone math + validation in `lib/drop-zone.ts` made the Vitest
  tests survive jsdom's DnD limitations. Pattern: when porting
  any Win32 UI logic with subtle math, extract the pure parts
  first (zone computation, validation predicates, sentinel
  semantics). The DOM-coupled glue (event handlers, state
  management) becomes a thin shim.
- *Bridge-driven Playwright is the right fallback for any
  CDP-flaky interaction.* Drag/drop, focus management, async
  device events — all can be tricky to drive reliably through
  CDP. When the bridge call has a clear contract, driving it
  directly proves the C++/wire side works; the React-side glue
  is then verified by Vitest alone. Saves debug time vs fighting
  CDP DnD synthesis.

**Implementer notes (from the commit + report):**

1. *`moveEmitterToRootIndex` no-op detection*: gap K maps to
   "source stays in place" when `K == sourceIdx || K == sourceIdx
   + 1`. Both code paths return `false`. The mock helper had to
   mirror this (otherwise `splice + insert` would generate an
   apparent move that does nothing). Generalizable: when porting
   engine refusal semantics to MockBridge, look for "same as
   current state → false" edge cases.
2. *`reparentEmitter` refuses same-parent drops* (slot-switching
   is explicitly out of scope for v1 drag gesture per the source
   comment). React's `onDragOver` validation matches so the
   visual doesn't tease an operation the engine would refuse.
3. *jsdom DragEvent doesn't propagate `clientY` via `fireEvent`.*
   Surfaced as the first Vitest failure. Workaround:
   `createEvent.dragOver` + `Object.defineProperty(ev, "clientY",
   ...)` to force the property. Same approach for `dataTransfer`
   (which jsdom doesn't provide at all). Pattern likely applies
   to any future Vitest test of DnD or other "real-event"
   handlers — `fireEvent`'s property-passing is unreliable for
   non-trivial event types.
4. *Playwright went bridge-driven up front.* Per the L-005-style
   fallback note in the dispatch brief. The React DnD wiring is
   covered by Vitest; Playwright asserts the C++ host's
   `emitters/drop` semantics + wire contract by calling
   `window.bridge.request` directly. Avoids CDP DnD synthesis
   flakiness for sub-row positioning.

**Open follow-ups for Batch C** (explicitly NOT in B3):
- Link-group bracket visualisation (MT-9 port).
- F2 / double-click inline rename (replaces B1's modal).
- Keyboard nav (arrows / Enter / Delete / Cut / Copy / Paste).
- *Slot-picker popup* for reparent (legacy line 1411 — small
  Radix popover asking "Lifetime or Death child?" instead of
  auto-pick). Polish, not blocking. Could fold into C or its
  own micro-batch.

### Screen 4 progress after Batch B3

| Batch | Status |
|---|---|
| A — Foundation (read-only tree + click-to-select) | ✅ shipped |
| B1 — Mutations + context menu + 3 Screen-8 sub-dialogs | ✅ shipped |
| B2 — Add Child + Move + Link-group membership + multi-select | ✅ shipped |
| **B3 — Drag/drop + reparent** | **✅ shipped** |
| C — Link-group brackets + inline rename + keyboard nav | ⏳ pending |

Only Batch C (polish) remains on Screen 4.

### 2026-05-17 · Screen 4 Batch C (link-group brackets + inline rename + keyboard nav + clipboard) — Screen 4 fully ✅

The polish batch that closes Screen 4. Four sub-features in one
opus dispatch — link-group brackets, inline rename (replaces B1's
modal), keyboard nav, Cut/Copy/Paste.

Commit: `81e9e76` (single feat — no new deps). Tests 119 Vitest
(109 → 119, +10) + 62 Playwright (59 → 62, +3). MSBuild 0/0.
RenameEmitterDialog cleanly deleted (2 files removed).

**What changed:**

- *3 new bridge call kinds.* `emitters/copy { ids }`,
  `emitters/cut { ids }`, `emitters/paste { afterId? }`. C++
  clipboard is a per-id `std::vector<std::vector<uint8_t>>`
  on `BridgeDispatcher` using the LT-3 import-from-file
  `MemoryFile` + `Emitter::copy(writer)` + `Emitter(ChunkReader&)`
  pattern reused unchanged.
- *Link-group brackets.* Single-lane visualisation in the tree's
  16px right gutter. Per-group vertical 2px bar at `top:
  firstRow * 24 + 12`, height spans to last row, with 4px
  horizontal caps top + bottom. 8-colour palette cycled by
  `(groupId - 1) % 8`. New `lib/link-group-colors.ts` holds
  both the palette and the range-computation helper.
- *Inline rename.* F2 / double-click on label / context-menu
  Rename all converge to `beginEdit(id, currentName)`. Local
  component state `editing: { id, value, original } | null`
  + a mirror ref to keep the latest value available for
  blur/Enter callbacks. Auto-focus + select-all on mount.
  Enter/blur commits; Esc cancels; empty/unchanged input
  silently reverts. **`RenameEmitterDialog` from B1 is
  deleted.**
- *Keyboard navigation.* Tree container `tabIndex={0}` +
  `onKeyDown`. Input-target guard (`target.tagName === "INPUT"`)
  + `editingRef.current !== null` short-circuit. Arrow Up/Down,
  Home/End, Enter, F2, Delete, Ctrl/Cmd+C/X/V all routed.
  Focus shift uses
  `treeContainerRef.querySelector('button[data-emitter-id="..."]').focus()`.
- *Cut atomicity.* Single `captureUndo()` at start, descending-
  id delete loop (sorted `std::greater<int>`), each iteration
  re-resolves `getEmitterById` (legacy `deleteEmitter` shifts
  subsequent slots). Single `markDirty` + tree-changed emit at
  the end.
- *Delete-on-multi-selection.* React-side descending-id loop
  dispatching the existing single-emitter `emitters/delete` per
  id. No bulk-delete kind added — looping single works on both
  mock and native.

**Locks worth surfacing for future batches:**

- *LT-3 serialise pattern generalises cleanly.* The
  `MemoryFile` + `Emitter::copy(writer)` flow was designed for
  import-from-file but extends to clipboard with zero
  adaptation. Pattern: any future C++ feature needing
  serialise/deserialise of emitter subtrees (export-to-file,
  drag-out-to-shell, template export) uses the same
  per-emitter `MemoryFile` buffer + per-buffer `ChunkReader`
  shape. No length-prefixing or concatenation needed if
  buffers stay separate.
- *Input-target guard is the right shape for tree keyboard
  handlers.* Future hierarchical lists with their own
  keyboard nav (Screens 5/6's curve points or track segments)
  should follow the same pattern: tree container
  `tabIndex={0}` with `onKeyDown`; check `target.tagName ===
  "INPUT"` AND any in-progress edit state ref AND stop-
  propagation in any inner input's own keydown. Belt + braces
  prevents the most common "keyboard handler stole my
  keystroke" bug.
- *Single-lane bracket rendering as an acceptable starting
  point.* When overlap is rare (most particle systems have
  ≤2 link groups), single-lane brackets visually overlap
  cleanly — and adding multi-lane support requires the legacy
  DPI-aware lane-width-clamping math which is non-trivial.
  Generalizable: ship the simple-case visual first, defer
  overlap-handling polish unless user feedback says it
  matters.
- *Component-state-over-Zustand-atom when state is per-row +
  short-lived.* The inline-rename `editing` state lives in
  EmitterTree component state, NOT a Zustand atom (unlike the
  modal-flow atoms from prior batches). The rule: short-lived
  state tied to a single component's lifecycle stays local;
  state that crosses components (modal coordination, tool
  panels, multi-select) lives in a Zustand atom. Inline
  rename happens entirely inside EmitterTree, so no atom.

**Implementer notes (from the commit + report):**

1. *Per-emitter MemoryFile buffers vs concatenated stream.*
   Subagent picked per-emitter (one `std::vector<uint8_t>`
   per id) over a single concatenated stream with length
   prefixes. Keeps deserialise simple (one `ChunkReader` per
   buffer with the embedded `Emitter::write` chunk structure
   terminating naturally). Trade-off: slightly more memory
   per id, but emitter buffers are small (few KB each).
2. *`ROW_HEIGHT_PX = 24` constant.* Hard-coded matching the
   existing `py-1 + text-sm` row styling. If the tree ever
   gains virtualisation or variable row heights, this
   constant becomes a per-row measurement via
   `ResizeObserver`. Not blocking; well-flagged.
3. *Mock-vs-native paste-empty-clipboard divergence.* Mock's
   `isMutating` returns true for `emitters/paste`
   unconditionally, so empty-clipboard paste flips dirty in
   browser mode. Native short-circuits before `markDirty`.
   Accepted: UI shouldn't allow paste-before-copy in practice.
4. *Vitest jsdom keyboard events worked fine.* No workarounds
   needed (unlike the B3 DragEvent property propagation
   issues). `fireEvent.keyDown(container, { key: "F2" })`
   propagated as expected.

**Open follow-ups** (Screen 4 fully ✅ — these are post-Screen-4
polish):

- *Multi-lane bracket rendering* — when groups span overlapping
  row ranges. Polish.
- *Slot-picker popup for reparent* (legacy line 1411) — auto-
  pick suffices most of the time. Polish.
- *Paste-as-Lifetime / Paste-as-Death context-menu items* —
  legacy has these as separate menu items ([src/UI/EmitterList.cpp:3747-3748]).
  Bridge call could extend `emitters/paste` with `asChildOf?:
  number; slot?: "lifetime" | "death"` params. Polish.
- *Ctrl+A select-all.* Polish.

### Screen 4 progress — fully ✅

| Batch | Status |
|---|---|
| A — Foundation (read-only tree + click-to-select) | ✅ shipped |
| B1 — Mutations + context menu + 3 Screen-8 sub-dialogs | ✅ shipped |
| B2 — Add Child + Move + Link-group membership + multi-select | ✅ shipped |
| B3 — Drag/drop + reparent | ✅ shipped |
| **C — Link-group brackets + inline rename + keyboard nav + clipboard** | **✅ shipped** |

Screen 4 closes pending Phase 4.2 legacy delete (`src/UI/EmitterList.cpp`, 4955 LOC).

### 2026-05-17 · Screen 6 Batch A (right-side property panel + TrackEditor shell + read-only CurveEditor)

First batch of Screen 6 (Track editor). Also the first batch of
the **right-side emitter property panel** which didn't exist in
`--new-ui` until now — Screen 4's selection event had nowhere to
land. After this batch the panel appears on emitter-select and
shows a SVG-rendered curve for the currently-active track.

Commit: `6f57020` (single feat — no new deps). Tests 131 Vitest
(119 → 131, +12 — beat the +6 target because TrackEditor's
surface invited natural extra coverage). 64 Playwright (62 → 64,
+2). MSBuild 0/0.

**What changed:**

- *1 new bridge call.* `emitters/get-tracks { id }` → `{ tracks:
  TrackDto[] }`. Returns the emitter's 7 fixed-order tracks
  (red/green/blue/alpha/scale/index/rotationSpeed) with their
  keys + interpolation type. C++ handler dereferences
  `emitter->tracks[i]` (the pointer-aliasing slot at
  [src/ParticleSystem.h:151]).
- *Right-side property panel skeleton.* `EmitterPropertyPanel.tsx`
  mounts on the right of App.tsx's main row when
  `selectedEmitterId !== null`. Viewport claims full right side
  when no emitter selected (preserves Spawner panel's existing
  claim); shrinks to make room when one is selected. Layout:
  `[Sidebar w-64 | Viewport flex-1 | PropertyPanel? w-80]`.
- *TrackEditor shell.* Toolbar with 7 track-toggle buttons +
  Select/Insert mode toggles + Linear/Smooth/Step interpolation
  toggles + Delete button (all **visual only** this batch,
  tooltips say "Batch B"). Lock-to Radix Select combo with
  per-track options (Red/Index/Rotation/Scale: just "None"
  disabled; Green: +Red; Blue: +Red/Green; Alpha: +Red/Green/Blue
  — matches legacy `texts[7][5]` table verbatim).
- *Read-only SVG CurveEditor.* Pure presentational. `<svg
  viewBox="0 0 600 300" preserveAspectRatio="none">` with
  separate `<g>` groups for grid (11×11 lines), axes, polyline
  connecting consecutive keys, and per-key `<circle r=4>`.
  Y-axis inverted per-coordinate (not via transform — keeps
  future text labels right-side-up). Active track state local
  to TrackEditor.
- *Per-track value range mapping* matches legacy:
  - Red/Green/Blue/Alpha: `[0, 1]`.
  - Scale/Index: `[0, max(keys.value) * 1.2]` (or 100 baseline).
  - RotationSpeed: auto-range symmetric around 0.
- *Mock fixture* — `makeFixtureTracks(id)` deterministic
  generator. Per-id seed so different emitters render
  distinguishable curves in dev mode.

**Locks worth surfacing for future batches:**

- *Pointer-aliasing on `Emitter::tracks[7]` is intentional* — it
  enables the legacy "lock to another track" feature without
  duplicating key data. Batch A doesn't use the aliasing but
  the wire shape (TrackDto carries `name` + `keys`) doesn't
  preclude it. When Batch B wires the lock-to combo's actual
  behaviour, the C++ side can re-alias `emitter->tracks[i]` to
  point at another slot without re-serialising key data on the
  wire. The wire just sees the resolved (post-aliasing) data
  each call.
- *Mount-gate vs render-gate split is fine.* The property panel
  is conditionally mounted by App.tsx based on selection state
  AND independently renders a placeholder when no emitter is
  passed (or selection is null). Two cheap subscriptions to the
  same scalar; each component stays self-contained and unit-
  testable in isolation. Generalizable: when a component might
  be embedded somewhere that doesn't have the parent's mount
  logic (a demo route, a Vitest harness), give it its own
  internal selection subscription rather than requiring a
  pre-resolved prop.
- *SVG-vs-canvas decision locks for SVG.* At expected key counts
  (typically <20 per track, max ~50), SVG renders instantly and
  the DOM gives us free testability (assert on polyline element,
  count circles, check data-attributes). If a future user
  imports a particle system with 200+ keys per track and lag
  appears, the call flips — but the indirection
  (`CurveEditor.tsx` as a leaf component) means the swap is
  internal and doesn't affect TrackEditor or above.
- *Component-state-over-Zustand-atom continues.* Active track in
  TrackEditor is local component state. Selected key in Batch B
  will also be local. Following Screen 4 Batch C's rule:
  short-lived per-component state stays local; cross-component
  state (mount visibility, multi-select) goes to atoms.

**Implementer notes (from the commit + report):**

1. *Two redundant selection subscriptions* — accepted. App.tsx
   subscribes to gate the mount; EmitterPropertyPanel
   subscribes independently for internal state. Each is cheap
   and the redundancy lets both components be unit-tested in
   isolation without one assuming the other's setup.
2. *Per-coordinate Y-axis flip over transform.* Future tick
   labels render right-side-up without a counter-transform per
   text element. Small code complexity savings now will pay off
   when labels land in Batch B.
3. *Test-attribute scaffolding for Radix-in-jsdom.*
   `data-active-track`, `data-track`, `data-key-count` on the
   curve and toolbar buttons let Vitest assert on state
   without driving Radix Select open. Same pattern as Screen 4
   Batch B2's `data-selected-count` / `data-primary-id` for
   multi-select.
4. *Vitest count overshoot.* TrackEditor's lock-to per-track
   options table invited natural extra coverage (verifying
   Red is disabled, Alpha is enabled with the right option
   list, etc.). +12 vs +6 target — useful spec density.

**Open follow-ups** (Screen 5 / Screen 6 Batch B):

- Click to select keys + drag to move.
- Click-to-add new keys.
- Interpolation toggle (functional).
- Delete key (functional).
- Lock-to combo functional behaviour (re-alias track slot,
  re-render).
- Smooth + step interpolation rendering (currently approximated
  as straight lines).
- Toolbar Select/Insert mode switch.
- `emitters/set-track-key { id, track, oldTime?, newTime,
  newValue }` mutation.
- `emitters/set-track-interpolation { id, track, type }`
  mutation.
- Track-colored curve stroke (cosmetic polish).

### Screen 6 progress after Batch A

| Batch | Status |
|---|---|
| **A — Foundation (property panel + read-only TrackEditor shell + SVG CurveEditor)** | **✅ shipped** |
| B (== Screen 5 work) — Full curve interaction + track mutations | ⏳ pending |

Screen 6 fully ✅ after Batch B.

### 2026-05-17 · Screen 5/6 Batch B-α (curve key selection + delete + interpolation + smooth/step rendering)

First half of curve editor interaction. After this batch users can
select curve keys (single + Ctrl/Cmd multi), delete non-border
keys, toggle interpolation type (Linear/Smooth/Step) with proper
rendering. Drag-to-move, click-to-add, Spinner sync, lock-to
functional, and border-key visual differentiation stay deferred to
Batch B-β (the second half).

Commit: `56b90a3` (single feat — no new deps). Tests 139 Vitest
(131 → 139, +8) + 66 Playwright (64 → 66, +2). MSBuild 0/0.

**What changed:**

- *2 new bridge call kinds.* `emitters/delete-track-keys { id,
  track, times: number[] }` and `emitters/set-track-interpolation
  { id, track, interpolation }`. Both capture undo + emit
  `engine/state/changed` + `emitters/tree/changed` + dirty after
  any actual mutation; zero-mutation calls (no-op delete, same-
  interpolation set) skip the event churn.
- *`std::multiset::find` by time-only Key works cleanly.*
  `Key::operator<` at [src/ParticleSystem.h:93] compares only on
  time, so `Key probe(time, 0.0f)` matches any key with that time
  regardless of value. No surprise; clean delete-by-time semantics.
- *Border-key filtering at both layers.* C++ caches
  `firstTime = keys.begin()->time` and `lastTime = keys.rbegin()->time`
  before the loop; silently skips matching times. React filters
  for clean UX (Delete button disables when all candidates are
  border keys via `deletableCount`).
- *Smooth + Step rendering.* `buildSmoothPath` builds an SVG path
  d string with cubic Bezier control points at 1/4 and 3/4 per
  segment (matches legacy `PolyBezier` formula at
  [src/UI/CurveEditor.cpp:289-292]). `buildStepPolyline` emits
  staircase points: start at `points[0]`, then for each segment
  emit corner `(p2.x, p1.y)` followed by next key `(p2.x, p2.y)`.
  Single-key tracks suppress the curve element entirely.
- *Selection state local to TrackEditor*, `useState<Set<number>>`.
  Keyed by key TIME (not array index) so it stays stable across
  multiset reordering. Cleared on active-track change, canvas
  click, and post-delete.
- *`registerDeleteHandler` callback pattern* lets
  EmitterPropertyPanel invoke TrackEditor's *fresh* delete
  closure on Delete keypress. TrackEditor `useEffect`-registers
  the handler whenever the closure changes; panel calls through
  the registered fn. Avoids stale-closure bugs that plain
  prop-drilling would hit.
- *Mock track overlay store.* `useMockTrackOverlay` is a Zustand
  store of per-emitter track mutations layered atop the fixture
  tracks. `get-tracks` reads through; delete + set-interpolation
  write the overlay. Mutations persist across `get-tracks` calls
  in browser mode.

**Locks worth surfacing for future batches:**

- *`std::multiset::find` with partial Keys is the right shape for
  by-time mutations.* `Key::operator<` compares only on time, so
  the find probe doesn't need the full value. Pattern repeats for
  any future track mutation keyed by time (Batch B-β's
  move-key-to-new-time will use the same).
- *Source-of-truth filter at the host, UX filter at the client.*
  Border-key delete is silently no-op'd by the host (always
  correct) AND filtered by React (clean UX: disabled button
  instead of letting the user click and get nothing). Same
  pattern likely applies to any future "this is invalid but
  recoverable" mutation: enforce server-side; mirror in the
  client for affordance.
- *`registerDeleteHandler` callback indirection.* When a parent
  needs to invoke a child's fresh closure (which closes over
  state the child manages), passing a "register" callback that
  the child wires via `useEffect` beats prop-drilling. The
  parent calls `handlerRef.current?.()`; the child re-registers
  whenever the closure changes. Pattern works for keyboard
  shortcuts, hotkey systems, and any "do the right thing for
  whichever sub-screen is mounted" surface.
- *Mock-state overlay pattern* — when a fixture generator
  produces deterministic data per render (like
  `makeFixtureTracks(id)` from Screen 6 Batch A), a mutation
  layer between the generator and the wire response lets
  mutations persist without rewriting the generator. The
  overlay is per-emitter + per-track; mutations layer on top.
  This decoupling is cleaner than mutating the generator's
  output directly.

**Implementer notes (from the commit + report):**

1. *`data-interpolation` attribute on both SVG root + child
   polyline caused a selector collision.* Initially the test
   selector `[data-interpolation='step']` matched the parent
   SVG first → empty points. Fixed by tightening to
   `polyline[data-interpolation='step']`. No production code
   change needed; future tests using `data-*` for multiple
   nested elements should disambiguate from the start.
2. *Sky-blue accent `#0EA5E9` literal* used for selection
   styling. Matches Screen 4's primary-selection accent. Not in
   `design-tokens` yet — defensible since the design lock named
   the exact hex.
3. *Delete button destructive styling* (rose border + accent)
   matches Screen 4's destructive-action pattern. Disabled state
   stays neutral-grey so the panel doesn't scream until a
   non-border key is selectable.
4. *Zero-mutation early return* — both C++ handlers check
   whether any work was actually done and skip event emission
   when not. Avoids tree-refresh thrash on no-op calls. Same
   pattern as Screen 4 Batch B2's `moveEmitterToRootIndex`
   no-op detection.

**Open follow-ups** (Screen 5/6 Batch B-β):

- Drag-to-move keys (the biggest remaining piece).
- Click empty canvas to add a key.
- Select/Insert mode toggle (still visual-only).
- Spinner sync (TrackEditor's time + value spinners — currently
  not even rendered; Batch B-β adds them).
- Lock-to combo functional behaviour (re-alias track slot on
  the C++ side; render the locked track's curve instead).
- Border-key visual differentiation (currently border keys
  render identically; legacy uses a different colour).
- Shift+click 2D range selection.

### Screen 6 progress after Batch B-α

| Batch | Status |
|---|---|
| A — Foundation (panel + read-only TrackEditor + SVG CurveEditor) | ✅ shipped |
| **B-α — Selection + Delete + Interpolation toggle + Smooth/Step rendering** | **✅ shipped** |
| B-β — Drag/add/Spinner sync/lock-to functional/border visual | ⏳ pending |

Screen 6 fully ✅ after Batch B-β.

### 2026-05-17 · Screen 6 Batch B-β (drag + click-to-add + Insert mode + Spinner sync + border visual) — Screen 6 fully ✅

Second half of curve editor interaction. After this batch users can
drag keys to move them (with proper bounds), click on empty canvas
in Insert mode to add keys, edit selected-key values via Time +
Value Spinners. Border keys render with a stroke ring + darker fill.

Commit: `a6b65e4` (single feat — no new deps). Tests 147 Vitest
(139 → 147, +8) + 69 Playwright (66 → 69, +3). MSBuild 0/0.

**What changed:**

- *2 new bridge call kinds.* `emitters/set-track-key { id, track,
  oldTime, newTime, newValue }` (erase + insert on the multiset
  since key ordering by time changes); `emitters/add-track-key
  { id, track, time, value }` → `{ time, value }` (epsilon-bump
  dedupe when a key already exists at the requested time; returns
  the actual inserted time).
- *Drag-to-move with pointer events.* `setPointerCapture` guarded
  with `typeof t.setPointerCapture === "function"` + try/catch
  so jsdom (which doesn't implement capture) doesn't break.
  Pointer-move/up handlers attach to the SVG, not the circle,
  so events route correctly even without capture.
- *DRAG_SLOP = 1.5 px* (viewBox units) distinguishes click from
  drag on pointer-up. Plain `<circle onClick>` still wired as
  fallback for environments without pointer events, suppressed
  during active drag via `dragRef.current === null` check.
- *Mid-drag re-render via `useState(0)` tick* bumped on every
  pointer-move. The dragged key's `time` in the prop array stays
  the original time; only the rendered position shifts (so
  curve segments redraw smoothly with the dragged endpoint).
- *Bounds clamping*. Border keys: time fixed; value clamped to
  `[valueRange.min, valueRange.max]`. Interior: time clamped to
  `(prev.time + 1e-4, next.time - 1e-4)` exclusive; value
  clamped to track range.
- *Insert mode state local to TrackEditor.* Toolbar Select /
  Insert buttons functional. Canvas-pointer-down in Insert mode
  computes (time, value) via inverse axis mapping, fires
  `emitters/add-track-key`. On-key clicks ignore mode (always
  drag or click-select). Crosshair cursor on the backdrop in
  Insert mode (cheap visual cue).
- *Spinner row* — Time + Value Spinners rendered above the
  toolbar. Enable rule: exactly-one-key-selected AND bridge +
  emitterId available. Border keys: Time spinner disabled
  (value-only edit). Border-key time changes are silently
  ignored host-side anyway, but the client disables for clean
  affordance.
- *Spinner remount on selection change* — `key={\`time:${activeTrack}:${singleSelected?.time}\`}` forces React to unmount + remount the Spinner when the selected key changes, so the displayed value updates immediately instead of waiting for the Spinner's next focus event.
- *Border-key visual*: `stroke="#0EA5E9"` (sky-500) + `stroke-width="1.5"` + `fill="#94A3B8"` (slate-400). Selected border keys keep the ring stroke layered over the selected-fill (`#0EA5E9` + r=5).

**Locks worth surfacing for future batches:**

- *`setPointerCapture` is jsdom-unsafe — guard it.* The pattern
  is generalizable to any pointer-driven interaction that needs
  to test in jsdom: feature-detect with `typeof t.setPointerCapture
  === "function"`, wrap in try/catch, and ensure event handlers
  also live at a level the events reach even without capture
  (e.g. the SVG container instead of the target circle). Worth
  noting alongside the existing Radix-in-jsdom and jsdom-DragEvent
  workarounds.
- *Spinner doesn't auto-resync from value prop, but `key`-based
  remount is the right workaround.* Spinner caches displayed
  text in internal state and only resyncs on focus. Passing
  `key={someIdentifier}` to force a remount when the underlying
  selection changes is clean idiomatic React; it costs one
  unmount cycle per selection change but the displayed value
  updates immediately. Same pattern could apply to any future
  "controlled-input mirror has its own state" surface.
- *Playwright `fill()` doesn't always reach React 19 controlled
  inputs.* Switched to a `click(clickCount: 3) + press("Delete")
  + type + press("Enter")` sequence to trigger React's onChange
  properly. Likely related to React 19's controlled-input
  diffing against the DOM value setter. Pattern: when
  `fill()`-based Playwright assertions don't land, fall back to
  the keyboard sequence.
- *`getBoundingClientRect` in jsdom returns 0×0.* Stub it
  explicitly in Vitest tests when the production code maps via
  rect-based math. Generalizable: any SVG / canvas / DOM-position
  math in Vitest needs an explicit rect stub.
- *DRAG_SLOP threshold separates click from drag cleanly.* 1.5
  viewBox-units handled the click-or-drag ambiguity without
  any timer-based debouncing. Future drag handlers (Screen 5
  multi-key drag if it lands, or any future interactive surface)
  can reuse the same constant.

**Implementer notes (from the commit + report):**

1. *Mode + selection state stay local to TrackEditor.* Continues
   the Screen 4 Batch C rule (component-state-over-Zustand for
   per-component short-lived state).
2. *Border-time-fixed enforced host-side.* The handler overrides
   `newTime = oldTime` when the key is a border. React's UI
   filters too (Time spinner disabled, time fixed during drag)
   for clean affordance but the host is the truth.
3. *`tick` state via `useState(0)` for mid-drag re-render.*
   Counter-intuitive that React needs an extra state bump to
   re-render at a different position when the underlying prop
   doesn't change — but the drag is intentionally NOT mutating
   the prop array (only the rendered position) until commit.
   The tick bump triggers a re-render at the new position.
4. *Auto-select after add.* New key auto-selects via the
   host-returned `time` (handles epsilon-bump collisions). Sets
   `selectedKeyTimes = new Set([res.time])` rather than the
   requested time.

**Open follow-ups** (post-Screen-6 polish, NOT blocking ✅):

- *Lock-to combo functional behaviour.* Small separate batch:
  C++ stores per-emitter per-track lock-to state; aliases the
  Track* pointer on get; `emitters/set-track-lock-to` toggles.
- *Shift+click 2D range selection.* Edge case; defer.
- *Multi-key drag.* Per-key bound computation is non-trivial;
  single-key drag covers 95% of the workflow.

### Screen 6 progress — fully ✅

| Batch | Status |
|---|---|
| A — Foundation (panel + read-only TrackEditor + SVG CurveEditor) | ✅ shipped |
| B-α — Selection + Delete + Interpolation toggle + Smooth/Step rendering | ✅ shipped |
| **B-β — Drag + click-to-add + Insert mode + Spinner sync + border visual** | **✅ shipped** |

Screen 6 closes pending Phase 4.2 legacy delete (`src/UI/TrackEditor.cpp`, 483 LOC + `src/UI/CurveEditor.cpp`, 1044 LOC). Lock-to functional remains a small post-shipment polish item.
