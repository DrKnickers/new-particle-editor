# Roadmap

Planned work for the particle editor, grouped by horizon. Difficulty is rated
on a 1–5 scale; effort is a rough hour estimate for a contributor already
familiar with the codebase (multiply by 2–3× when first ramping up on Win32 +
D3DX9).

Items can land in any order within their tier — the grouping reflects scope
and risk, not strict dependency.

This file is split into six parts:

1. **[Near term](#1-near-term)** — quality-of-life polish on existing workflows. Each item is contained, low risk, and doesn't touch the rendering pipeline or file format.
2. **[Medium term](#2-medium-term)** — bigger UX investments and modest engine work. Each touches more than one subsystem but stays inside the rendering preview / editor surface.
3. **[Long term](#3-long-term)** — larger features that meaningfully expand what the editor can do. Each is roughly on the order of a small project rather than a sitting.
4. **[Notes on prioritization](#4-notes-on-prioritization)** — guidance on which tier to pick from next.
5. **[Shipped](#5-shipped)** — roadmap items that have landed on master. Kept for traceability with PR number, original estimate, and actual effort.
6. **[Notes on roadmap conventions](#6-notes-on-roadmap-conventions)** — how item headings are numbered and tagged, and the renumbering rules that fire when an item ships.

---

## 1. Near term

Quality-of-life polish on existing workflows. Each item is contained, low
risk, and doesn't touch the rendering pipeline or file format.

*(No items currently queued. NT-1 through NT-4 have all shipped —
see [Shipped](#5-shipped). When the next near-term idea lands, it
takes position `1.1` and the next vacated `NT-N` tag.)*

---

## 2. Medium term

Bigger UX investments and modest engine work. Each touches more than one
subsystem but stays inside the rendering preview / editor surface.

### 2.1 [MT-1] Frequently-used textures palette
A small panel — probably docked under the Color/Bump texture fields on
the Appearance tab — that surfaces recently-used and pinned textures as
clickable thumbnails. Saves clicking through the file browser when
iterating between a small set of textures. Persists per-mod (tracked
alongside the existing `LastMod` registry value) so switching mods
doesn't pollute the list.

- **Difficulty**: ★★★☆☆ (3/5)
- **Estimated effort**: 5–8 hours

### 2.2 [MT-2] Selectable ground texture
Currently the preview ground is hardcoded to `IDB_GROUND` (`dirt.bmp`).
Expose a picker — initially a small dropdown of bundled options
(grass / sand / metal deck / Hoth snow / black void), later expandable to
any user-supplied texture. Per-session setting, persisted to the registry.

- **Difficulty**: ★★☆☆☆ (2/5)
- **Estimated effort**: 2–4 hours

### 2.3 [MT-3] Selectable skydome backgrounds
Replace the flat background-color rectangle with an optional skydome
(textured sphere) the camera can rotate inside. Lets you preview a
particle effect against a representative scene — space, atmosphere, dusk,
etc. Requires adding a skybox render pass before the ground plane and a
sphere or cube mesh. Out of the box, ship a few canned options bundled
into the exe via resources.

- **Difficulty**: ★★★★☆ (4/5)
- **Estimated effort**: 8–14 hours

### 2.4 [MT-4] Adjustable environment lighting in the preview
The engine already maintains three `Light` structs (sun + two fill
lights), but only the values from the loaded particle system can adjust
them. Add a Lighting panel (probably under View → Lighting…) with
direction sliders, color pickers, and intensity for each light, plus a
"reset to default" button. Persists per-session.

- **Difficulty**: ★★★☆☆ (3/5)
- **Estimated effort**: 4–6 hours

---

## 3. Long term

Larger features that meaningfully expand what the editor can do. Each is
roughly on the order of a small project rather than a sitting.

### 3.1 [LT-1] Programmable particle spawner v2
The v1 spawner shipped (see Shipped). v2 fills out the polish and
extra-mile cases that didn't make the first cut:

- **Arc paths** — rotate the spawn point around an axis by a
  configurable angle; useful for orbital / sweep test patterns.
- **Velocity shorthand** — accept magnitude + azimuth + elevation
  alongside raw XYZ, for "100 units/s up at 45°"-style inputs.
- **Path visualization in the preview** — render the spawn position
  (and any path) as a teal marker / line so the user can see where
  emissions originate without guessing in 3D space. Deferred from v1
  because the engine has no simple-line draw helper today.
- **Named presets** — save a config under a name (e.g. "rocket trail",
  "explosion debris"), recall later. Stored as additional REG_BINARY
  blobs `SpawnerPreset_<name>`.
- **Clear-active-spawns button** — explicit "Kill" button for live
  spawner-emitted instances when the user wants to wipe and re-tune
  without waiting for natural decay.

Dropped from the original v2 plan: user-drawn curve paths and
"draw-the-path-in-the-viewport" interactive mode — too much UX
complexity for the value they add.

- **Difficulty**: ★★★☆☆ (3/5)
- **Estimated effort**: 5–9 hours

### 3.2 [LT-2] Template particle systems (starter library)
Ship a curated set of starter `.alo` files (basic fire, smoke column,
explosion, sparks, smoke trail, weather, etc.) under `templates/` next to
the exe. Add a **File → New from Template…** entry that opens a small
dialog with thumbnails or named entries; selecting one loads it as an
unsaved new system that the user can iterate on. Lowers the activation
energy for new mod authors.

- **Difficulty**: ★★★☆☆ (3/5) — most of the work is curating the templates
- **Estimated effort**: 6–10 hours (excluding template authoring time)

### 3.3 [LT-3] Import emitters from other particle files
Currently you can copy a single emitter to the clipboard from one editor
window and paste into another. Replace this with a proper import flow:
**File → Import Emitters from File…** opens a `.alo` picker, then a
dialog showing that file's emitter tree with checkboxes, then copies the
selected emitters into the current system — re-mapping any spawn-field
indices into the destination so cross-references don't break. Saves a lot
of clicks when assembling a complex effect from pieces of existing ones.

- **Difficulty**: ★★★★☆ (4/5)
- **Estimated effort**: 8–14 hours

### 3.4 [LT-4] UI overhaul (WebView2 + React chrome)
The current UI is faithful to the original 2009-era tool: native Win32
controls, plain GDI rendering, the system color scheme, fixed dialog
layouts that don't reflow. A mockup of a modern design exists in Claude
Designer; this item brings the editor into line with that vision.

![UI mockup](docs/images/ui-mockup.png)

*Mockup target: dark theme, Inter / JetBrains Mono webfonts, teal
accent (`#62d4d0`), four-level panel hierarchy, drag-to-scrub number
inputs, an SVG curve editor with channel-coloured tabs, blurred floating
HUD pills over the D3D9 viewport. Light theme and a compact-density
variant are included as toggles in the same design.*


**Implementation path: WebView2-hosted React chrome over the existing
D3D9 engine.** The mockup is implemented in React (Inter / JetBrains
Mono web fonts, dark + light themes via CSS custom properties, density
variants, an SVG curve editor, drag-to-scrub number inputs, blurred
floating HUD pills over the viewport). It deliberately uses CSS features
— `backdrop-filter: blur()`, `color-mix(in oklab, …)`, animations,
focus-within transitions — that don't have native Win32 / GDI
equivalents. Skinning the existing controls would visibly miss the mark;
a full rewrite in Qt or ImGui is a larger lift than necessary.

The right shape is therefore:

- **Keep**: the engine (`engine.cpp`, all of `EmitterInstance` /
  `ParticleSystemInstance`), the `.alo` chunk parser/writer, the
  `FileManager` / `TextureManager` / `ShaderManager` plumbing. None of
  these are coupled to the Win32 UI.
- **Replace**: every dialog, every control, the menu bar, the toolbars,
  the tree view, the property tabs, the curve editor, the track editor,
  and the status bar — the entire chrome — with a WebView2-hosted React
  app.
- **Bridge**: JS ↔ C++ via WebView2's `chrome.webview.postMessage` and
  host objects. Every property field becomes a binding; the C++ side
  exposes the particle-system state as a serializable model the React
  app reads / writes.
- **Viewport**: the D3D9 swap chain stays. Either render into a child
  HWND positioned under a transparent `<div id="viewport">` that the JS
  layout sizes, or render into a shared texture the WebView samples.
  Child-HWND-with-clip is simpler; shared-texture composites cleaner if
  the HUD pills want to truly overlay the render.

**Parts of the work, roughly in order:**

1. **WebView2 host scaffolding** — embed the control, load the React
   bundle, wire the message bridge, get one trivial round-trip working
   (e.g. emitter list).
2. **Engine state model** — design a serializable view of
   `ParticleSystem` + `Engine` state that React owns; map every UI edit
   back into mutations on the C++ side without re-creating the engine.
3. **Viewport hosting** — child-HWND positioned by the React layout,
   resized on window/layout changes, handles mouse/keyboard for camera
   and Shift-spawn.
4. **Inspector port** — Basic / Appearance / Physics tabs against the
   live model. The biggest single piece of work; lots of fields.
5. **Tree, menu, toolbars, curve editor, track editor, status bar** —
   each is its own port.
6. **Existing-feature parity** — Mods menu, hot-reload (F5/F6),
   game-path picker, autosave, accelerators, persistence.
7. **Polish** — light/dark toggle, density toggle, font stack selection
   from the mockup's three options, keyboard navigation,
   accessibility.

**Difficulty**: ★★★★★ (5/5)
**Estimated effort**: 80–140 hours assuming React + WebView2 fluency;
significantly more if either is being learned mid-project. Realistically
a multi-week feature branch.

**Risks worth naming up front:**

- **WebView2 runtime distribution.** Bundled in Windows 10+ via the
  Evergreen runtime, but missing on some old / debranded installs. If
  absent, install fallback adds ~150 MB on first run. Acceptable for a
  modding tool but worth noting in release docs.
- **Per-frame state churn.** The current Win32 UI updates lazily; with
  React the temptation is to drive renders from every spinner tick.
  Bridge protocol must be coalescing-friendly or the inspector will
  fight the GPU for scheduling.
- **Modal dialog parity.** WebView2 doesn't natively give you Win32
  modal-dialog semantics (file pickers, native menus). Either keep
  using `GetOpenFileName` / `SHBrowseForFolder` natively and route
  through the bridge, or build their replacements in React. The native
  route is simpler and what most hybrid apps use.
- **Accelerator / focus interactions.** Win32 accelerators (`F5`, `F6`,
  `Ctrl+S`, etc.) need to keep working when focus is inside the
  WebView; this requires a small bit of message-pump plumbing.
- **Branch longevity.** The other roadmap items (autosave, reorder,
  duplicate, etc.) will keep landing on master in the meantime; the UI
  branch needs to stay rebased or those features will need to be
  re-implemented in the new chrome anyway. Worth landing the smaller
  near-term items *first*, so the React port doesn't have to track a
  moving target.

**Path A and Path C alternatives, kept here for completeness:**

- *Skin native controls in place* — owner-draw buttons / tabs / group
  boxes; pick fonts and colors. ~25–40 hours, low risk, but loses the
  mockup's distinctive features (blur, color-mix, animations, density
  modes). Reasonable only if the Designer mockup is later simplified
  into a "modern Win32" target rather than a Web-styled one.
- *Full rewrite in Qt or Dear ImGui* — replaces both the chrome *and*
  the rendering host. ~150–300+ hours. More work for less mockup
  fidelity than Path B; worth considering only if WebView2 turns out
  not to be acceptable for some other reason.

---

## 4. Notes on prioritization

The near-term tier is intentionally chosen so each item can land in a single
short PR with low blast radius — these are the things to pick up between
larger projects.

The medium-term tier mostly adds **environment fidelity** (textures,
skydomes, lighting) so the preview matches in-game rendering more
faithfully. Worth doing before the long-term tier because programmable
spawning and template authoring both benefit from a representative preview.

The long-term tier is where the editor stops being a faithful clone of the
original tool and starts being a genuinely better one. Programmable spawning
is the one with the highest leverage on the iteration loop; the **UI
overhaul** is the largest item in scope and probably wants to land on a
long-lived branch that other work can be rebased onto rather than blocking
the rest of the roadmap.

---

## 5. Shipped

Roadmap items that have landed on master. Kept here for traceability —
PR number, original estimate, and actual effort, so future estimates can
calibrate against history. New shipped items go at the top and take
position `5.1`; the rest shift down. Entries shipped before this
convention have no bracketed `[TIER-K]` tag; they're referenced by PR
number.

### 5.1 [MT-10] ~~Configurable exempt set per link group~~ ✅ Shipped (#TODO)

The hard-coded v1 exempt set (textures + atlas-index curve + name) is now a per-group default, overridable via a new **Group settings…** dialog reached from the right-click menu when a linked emitter is selected. The dialog lists ~50 emitter fields grouped by category (Textures / Curves / Lifetime / Physics / Appearance / Weather / Rotation / Misc); checking a row marks that field per-emitter (exempt from propagation), unchecking marks it shared. A *Reset to defaults* button restores the v1 set without leaving the dialog.

If the user clears an exempt flag on a field where members currently hold divergent values, a confirmation summary appears listing each affected field and the canonical (first-in-tree-order) member's value that will overwrite the others. **Yes** applies the overwrites and the new flag set; **No** keeps the settings dialog open so the user can adjust before retrying or cancelling outright.

Per-group flags persist in a new editor-only system-body chunk **`0x0003`** sibling to the existing `0x0002` leaveParticles chunk. The chunk is emitted only when at least one group has a non-default exempt set — files without customization remain byte-identical to pre-MT-10 output. The per-entry size prefix (`flagsByteCount` before each blob) is forward-compatible: older editors load files saved by newer versions and tolerate extra trailing bytes; newer editors load older files and default the missing tail.

The propagation hook in `CaptureUndo` consults `ParticleSystem::getLinkExemptFlags(linkGroup)` instead of the static defaults, and `JoinLinkGroup` honours the target group's current exempt set when adding new members (so a joiner inherits the group's customization rather than being silently overwritten by the v1 defaults).

- **Difficulty**: ★★★☆☆ (3/5)
- **Estimated effort**: 6–10 hours
- **Actual**: TODO (backfill after merge)

### 5.2 [MT-9] ~~Visual link-group bracket for linked emitters~~ ✅ Shipped (#63)

A coloured bracket painted in the emitter tree's right margin makes
link-group membership legible at scroll-speed. Each link group claims a
lane (greedy interval scheduling by topmost member's Y), a 12-colour
Tableau-derived palette is mapped via `groupId % 12`, and dots mark
each member row with horizontal stubs pointing toward the row text.
**Hover** any dot or line and the group's member rows pick up a ~15%
alpha tint in the group's colour while the lane line thickens to 2 px
— the line is the primary "you're over group N" cue and the tint
confirms which rows are members. **Click** any dot or line and the
multi-selection becomes the full group's member list with primary set
to the topmost viewport-visible member (Ctrl-click extends instead of
replacing). The bracket lives strictly in a 4–9 px right-edge gutter so
it never overlaps label text at any sane tree width.

**High-Contrast theme**: under Windows HC, all brackets paint in
`COLOR_HIGHLIGHT` instead of the palette; lane position + the existing
`[L<n>]` text prefix carry group identity. The user's HC theme intent
is respected — we don't override it with custom RGB. `WM_THEMECHANGED`
and `WM_SETTINGCHANGE(SPI_SETHIGHCONTRAST)` invalidate the tree so the
switch is live.

**Q4 follow-up shipped in the same PR**: `EmitterList_DeleteEmitter`
now iterates `multiSelection` rather than acting only on the primary,
so bracket-select → Delete kills the whole group in one undo step. The
prior single-emitter behaviour was an MT-8 gap; the bracket interaction
made it the most visible UX cliff and it was cheaper to fix once than
have every reviewer ask about it.

- **Difficulty**: ★★★★☆ (4/5)
- **Estimated effort**: 6–10 hours
- **Actual**: ~5 hours. Planning + rigorous-testing additions were the
  largest slice (the §Verification section grew to 84 named tripwires
  across 13 categories before any code was written). Implementation
  built clean across all six milestones first try. Two paint glitches
  surfaced in live testing and were fixed in-session: the
  `WM_MOUSEMOVE` hover branch had been pasted inside `WM_TIMER`
  instead of the mouse-move case (silent-fail because the bracket-
  hover code was syntactically valid in any switch arm), and renames
  whose new label changed the row's pixel width caused stale
  "ghost" brackets at the old X position when the tree only
  invalidated the renamed row — fixed by detecting bracket geometry
  shifts between paints and queuing a full-tree invalidate.

### 5.3 [MT-8] ~~Multi-select for the emitter list~~ ✅ Shipped (#60)

Multi-emitter selection via **Ctrl-click** (toggle individual emitters),
**Shift-click** (select tree-order range from the anchor), and **click-
and-drag from an empty area** (marquee with sticky semantics — every
row swept during the drag stays selected, even if later mouse
positions pull back). The right-click menu surfaces *Link selected*,
*Add selected to link group →*, and *Add unlinked to Group N* batch
actions that fold into the MT-7 link-group operations. The
"canonical" source for a Link-selected operation is the most
recently clicked emitter (the `selectionAnchor`), not the topmost —
so the rule is *"the emitter you clicked last governs the group."*

While two or more emitters are selected the inspector + curve editor
are locked (`EnableWindow(FALSE)`) and a translucent ~19% black
overlay covers their area as a visual signal that editing is
disabled. The overlay is a `WS_POPUP` top-level layered window with
a `SetWindowRgn` shape that excludes the viewport gap. Custom-draw
paints every multi-set member with the bright system highlight so
the focus-dependent tree-default paint doesn't drop the primary's
highlight when the tree loses focus.

Drag-drop reorder still acts on the primary only — multi-select
doesn't bind emitters into a clump, so they can be repositioned
independently for interleaved layering (the MT-7 motivating
workflow). Right-click outside the multi-set resets to a single-
emitter selection on the right-clicked row; right-click inside
preserves the set so the batch-action sequence operates on what the
user intended.

- **Difficulty**: ★★★☆☆ (3/5)
- **Estimated effort**: 4–7 hours
- **Actual**: ~6 hours. The state machine and modifier semantics were
  straightforward; the long tail of paint / layering / capture-order
  bugs (`ReleaseCapture` firing `WM_CAPTURECHANGED` synchronously,
  layered child windows losing to custom-control repaint cycles,
  `SetWindowRgn` to exclude the viewport, focus-dependent primary
  highlight, marquee row hit-test edge cases) ate the rest. The
  resolved cases are recorded under *Issues encountered and
  resolutions* in the CHANGELOG so the next contributor working with
  layered overlays or marquee selection has a paper trail.

### 5.4 [MT-7] ~~Linked emitters (share parameters across a group)~~ ✅ Shipped (#58)

Two or more emitters in a particle system can be linked into a *link
group*. Editing any non-exempt field on a linked emitter propagates the
change to every sibling instantly, in a single undo step. The exempt
set (kept per-emitter) is `colorTexture`, `normalTexture`, the
`TRACK_INDEX` atlas-frame curve, and the emitter's name. Group
management lives in the emitter-list right-click menu — *Link with…*
creates a new pair, *Add to link group…* joins an existing group,
*Remove* / *Dissolve* break the link. Confirmation dialogs spell out
which emitter will be overwritten when params differ. Minimum group
size is two; removing the second-to-last member auto-dissolves. The
`[L<n>]` prefix on tree rows identifies group membership at a glance.
Persistence rides a new optional editor-only chunk (`0x0100`) that the
game engine ignores; files without link groups remain byte-identical
to pre-feature output.

Three follow-up pieces are deferred to a future PR: tree multi-select
with a "Link selected" command, a visual link-group bracket in the
right margin of the emitter list (lane-allocated colour-coded
bracket, hover-highlight, click-to-select-group), and per-field
configurable exempt sets. The current persistence and undo paths are
designed so each can land as a UI-only addition.

- **Difficulty**: ★★★★☆ (4/5)
- **Estimated effort**: 16–24 hours (revised upward from 10–16h
  after deciding to include the dialog UX clarity work)
- **Actual**: ~5 hours. The data-model + serialisation slice was
  about an hour, the `LinkGroup.cpp` helpers and the propagation
  hook another hour, the menu UI plus tree-text affordance two
  hours, and audit + dialog rewording (Option A) the rest. The
  `Emitter::copySharedParamsFrom` reuse-the-copy-constructor
  pattern saved an estimated 3–4 hours over hand-writing the
  field-by-field copy with track-aliasing reconstruction; the
  load-time initial `CaptureUndo` already wired in
  [`main.cpp:976`](src/main.cpp:976) saved another 1–2 hours by
  removing the need to add an explicit pre-action capture in every
  link-menu handler.

### 5.5 [NT-4] ~~Duplicate with index increment~~ ✅ Shipped (#56)

Two new entries in the emitter right-click context menu directly below
*Duplicate*: **Duplicate (increment index)** shifts every keyframe on the
`TRACK_INDEX` (atlas frame) track by +1 in one click; **Duplicate
(increment index...)** prompts for an integer N first. Useful for
atlas-texture variation — build one base emitter aimed at frame 0 and
right-click-duplicate through the full sprite sheet in seconds.

- **Difficulty**: ★★☆☆☆ (2/5)
- **Estimated effort**: 2–4 hours
- **Actual**: ~1 hour. Three additions to [`src/UI/EmitterList.cpp`](src/UI/EmitterList.cpp)
  (`ShiftIndexTrack`, dialog proc, two new dispatch cases), one parameter
  added to `EmitterList_DuplicateEmitter`, menu items + dialog template in
  both `.en.rc` and `.de.rc`, and four resource IDs in both headers.

### 5.6 [NT-3] ~~Pause / frame-step the preview~~ ✅ Shipped (#53)
Press F8 to freeze the preview at the current simulation tick; press
it again to resume from exactly where time left off. While paused, F9
steps one notional 60 Hz frame; F10 steps ten frames (≈167 ms). All
three actions also live under View → Pause Preview / Step 1 Frame /
Step 10 Frames and as three dedicated toolbar buttons (pause check
button in cell 8, step-1 ▷| in cell 9, step-10 ▷▷| in cell 10). The
step entries and toolbar buttons grey out when not paused. A
` · PAUSED` suffix on the FPS pane in the status bar makes the state
glanceable. The clock is process-local — pause always starts off on
launch.

Implementation hooks into `GetTimeF()` in [`src/engine.cpp`](src/engine.cpp:37)
as the single time source — emitter spawn time, particle Update dt,
shader `hTime` uniform, and the spawner driver dt all funnel through
that one function. Three new free functions
(`SetPreviewPaused` / `IsPreviewPaused` / `StepPreviewFrames`)
maintain a small clock-offset state, and the resume path re-derives
the offset from the (possibly stepped) anchor so frame-stepping
during a pause persists past the resume.

Spawner manual-fire shortcut also moved from `Shift+Space` to
`Ctrl+Space` in the same PR (the rebind keeps `Shift` available for
future "modify gesture" semantics and uses the more idiomatic Win32
`Ctrl` for "trigger discrete action"). The "Spawn now" dialog button
was relabeled to match.

- **Difficulty**: ★★☆☆☆ (2/5)
- **Estimated effort**: 2–4 hours
- **Actual**: ~2 hours including planning. Almost all of the engine
  work is concentrated in seven lines around `GetTimeF()`; the rest
  is UI plumbing (one new toolbar bitmap cell, three menu items in
  each language, three new resource IDs, three accelerator entries,
  one status-bar suffix). One bug caught pre-merge: the initial
  resume-offset accumulation used the wall-time delta and lost any
  frame-stepping done during the pause; fixed by re-deriving the
  offset from the current anchor at resume time.

### 5.7 [MT-5] ~~Confirm / extend two-child emitter support~~ ✅ Shipped (#51)
Investigation, not a feature change. Ghidra disassembly of
`StarWarsG.exe` and `EAW Terrain Editor.exe` confirmed that the
engine's emitter struct stores exactly one death-child pointer
(offset `+0x1108`) and one life-child pointer (offset `+0x1110`,
immediately adjacent). The two slots are independent fields — our
editor already supports authoring both — but the runtime data
structure cannot hold more than one child of either type, so the
broader "attach >1 on-lifetime child" question is closed as **not
supported by the engine**. Recorded workarounds (chain emitters,
duplicate parent) in
[tasks/multi_child_emitter_investigation.md](tasks/multi_child_emitter_investigation.md).
One-line provenance comment added next to `spawnDuringLife` in
[src/ParticleSystem.h](src/ParticleSystem.h:119) citing the writer
functions (`FUN_14015ed60` / `FUN_140134b50`, both 2968 bytes).
No new ROADMAP entry filed; no UI change needed.

- **Difficulty**: ★★☆☆☆ (2/5) — mostly investigation
- **Estimated effort**: 2–4 hours
- **Actual**: ~2 hours. Static analysis answered Q2 (runtime struct
  shape) and Q3 (single read at spawn time) directly from the
  emitter writer function; Q1 (parser semantics on duplicate
  mini-chunks) was left as moot since the runtime can only retain
  one pointer per slot anyway. Reused the Ghidra + JDK install from
  MT-6; auto-analysis on both binaries was the dominant cost.

### 5.8 [MT-6] ~~Bloom in the preview renderer~~ ✅ Shipped (#47)
The game's own `Engine\SceneBloom.fx` is loaded via `ShaderManager`
(mod overlay → game roots → MEG archives, same chain the editor
already uses for particle shaders), so the editor's bloom is
byte-identical to in-game bloom and automatically picks up any
mod's customised bloom. Engine inserts a single-technique 3-pass
loop (bright filter → blur ping-pong × 4 iterations → AddSmooth
combine) into `Engine::Render` between the scene draw and the
heat/distortion compose, writing back into `m_pSceneTexture` so
downstream passes are untouched. Configurable via
**View → Bloom… / Ctrl+B** (master enable + Strength/Cutoff/Size
spinners) and a new toolbar toggle button (sunburst icon, mirrors
the Show Ground toggle). All four values persist across sessions
via the same registry pattern as other view settings. Greys out
gracefully on installs that lack `SceneBloom.fx` or where the
shader's parameter surface doesn't match the canonical layout —
the diagnostic writes a `bloom-diagnostic.log` next to the .exe
listing exactly what was found.

- **Difficulty**: ★★★★☆ (4/5)
- **Estimated effort**: 8–12 hours
- **Actual**: ~6 hours, of which substantial time went into two
  matcher revisions after live introspection. The first cut
  looked for three separate techniques (bright/blur/combine);
  the game's shader is actually one technique with three passes
  driven by `BloomIteration`. The second iteration also missed
  `m_resolutionConstants` — required by every VS for the half-pixel
  offset and the blur kernel's base spacing; without it the
  kernel collapses and no blooming happens. Reading the canonical
  `SceneBloom.fx` source (found loose in the user's mod folder)
  resolved both, plus revealed that the blur is a 4-tap diagonal
  cross run iteratively with the per-tap offset widening each
  iteration. The canonical Terrain Editor's UI (3 sliders, no
  iteration count) confirmed the user-facing shape; the iteration
  count is engine-side and hardcoded to 4 in our build pending
  further empirical tuning.

### 5.9 [NT-2] ~~Adjustable ground-plane height in the preview~~ ✅ Shipped (#45)
"Ground Height:" spinner on the editor's header strip (just left of
the Background color picker) moves the preview ground plane up or down
along Z.
Range is ±100 units in 0.1-unit steps; scroll-wheel adjusts (Shift = ×10,
Ctrl = ×0.1). Persists across sessions in the registry; greys out when
"Show Ground" is toggled off; resets to 0 via View → Reset View Settings.

- **Difficulty**: ★☆☆☆☆ (1/5)
- **Estimated effort**: 1–2 hours
- **Actual**: ~1.5 hours. Almost all the work was UI plumbing (label +
  spinner siblings of the main window in the header-strip row, since the
  rebar control doesn't forward `WM_COMMAND` from children without
  subclassing). Engine surface was three lines — a `m_groundZ` field, a
  `SetGroundZ` setter, and replacing the literal `0` in the four ground-
  quad vertices with `m_groundZ`. The `static const` ground vertex array
  becomes a per-frame init; 4 vertices × ~80 bytes is negligible.

### 5.10 ~~Autosave for in-progress particles~~ ✅ Shipped (#41)
Two-tier autosave: a 30-second "recent" tier captures the freshest
state for the "crashed 10 s ago" case, and a 5-minute "stable" tier
captures an older known-good state for the "recent file is corrupt"
or "I made a bad edit 2 minutes ago" cases. Files live at
`%TEMP%\AloParticleEditor\autosave-<pid>-<tier>.alo`; per-PID names
so concurrent editor instances don't clobber each other. On launch
(when no CLI file is specified) the editor scans for orphan
autosaves left by crashed prior sessions and prompts the user to
restore.

- **Difficulty**: ★★☆☆☆ (2/5)
- **Estimated effort**: 3–5 hours
- **Actual**: ~3 hours. The data layer is a single new module
  ([`src/Autosave.{h,cpp}`](src/Autosave.cpp)); most of the time
  went into the PID-liveness check (`OpenProcess` +
  `QueryFullProcessImageNameW` with the right "skip if it's another
  live editor" semantics, defaulting conservatively on ambiguous
  errors) and the three-state recovery prompt (recent-only, stable-
  only, or both-tiers each pick a different MessageBox variant).
  The atomic `.tmp` + `MoveFileEx` write pattern was straightforward.

### 5.11 ~~Drag-and-drop to reparent (make an emitter a child of another)~~ ✅ Shipped (#37)
Extension of the drag-and-drop reorder gesture: dropping an emitter onto
another emitter turns the source into the target's spawn-during-life or
spawn-on-death child. Requires a small "what kind of child?" prompt
when the target already has neither (so the user can pick) and a
refusal path when the target slot is occupied. Edge cases: dropping
onto self, creating a cycle, dropping a parent onto its own descendant.

- **Difficulty**: ★★★★☆ (4/5)
- **Estimated effort**: 6–10 hours
- **Actual**: ~5 hours including the planning + risk-mitigation pass.
  The data layer is small (~50 lines for `reparentEmitter` plus the
  `IsInSubtreeOf` cycle helper); most of the time went into the
  thirds-based hit-test (top/middle/bottom of each item rect classify
  as insert-above / drop-onto / insert-below), splitting `EndDrag` into
  Visual + Logical halves so the modal slot-picker popup can run
  without disarming the accelerator gate, and chasing down a
  drag-image ghost-residue artifact (TVIS_DROPHILITED row repaints
  during the drag clobbered the imagelist's saved background — fixed
  by wrapping every per-message handler in a single
  `ImageList_DragShowNolock(FALSE/TRUE)` pair, rather than nesting
  wraps inside `UpdateDropFeedback`).

### 5.12 ~~Drag-and-drop reordering in the emitter tree~~ ✅ Shipped (#35)
Use the tree control's drag-and-drop notifications (`TVN_BEGINDRAG`,
`WM_MOUSEMOVE`, `WM_LBUTTONUP`) to let the user reorder emitters by
dragging them between siblings. Reuses the swap logic from the reorder
buttons. Visual feedback (insertion cursor / highlighted target) is part
of the work.

- **Difficulty**: ★★★☆☆ (3/5)
- **Estimated effort**: 4–6 hours
- **Actual**: ~5 hours including the planning + risk-mitigation pass.
  Most of the time went into the cancellation paths (`WM_CAPTURECHANGED`
  backstop, idempotent `EndDrag`), the no-op detection (drop on the
  source's own gap mustn't dirty the file), and the accelerator gate at
  the message pump (Ctrl+Z mid-drag would otherwise free the
  ParticleSystem under the drag's `Emitter*` pointer). Auto-scroll
  (16-pixel hot zones, `SetTimer`-driven) was straightforward once the
  WM_TIMER handler was wired to do an atomic scroll + recompute + ghost
  re-anchor.

### 5.13 ~~Programmable particle spawner for the preview (v1)~~ ✅ Shipped (#30)
Modeless **Spawner** dialog under `Emitters → Spawner…` (also `F7`).
Two modes:

- **Manual** — fires one burst per "Spawn now" click or `Shift+Space`.
- **Auto** — fires bursts on a recurring schedule when Enabled.

Both modes share **burst** semantics: one burst emits up to 10 instances
spaced `c` seconds apart. In Auto mode bursts repeat with `d` seconds
between the END of one and the START of the next (skip rule: bursts
don't overlap).

Each spawned instance starts at a configurable world-space position,
moves at constant initial velocity for at most `maxLifetime` seconds
(0 = no spawner cap; instance lives until particles die naturally).
Optional ± jitter on position and velocity. The instance self-propels
via per-frame `position += velocity·dt` inside
`ParticleSystemInstance::Update`; on lifetime expiry it calls
`StopSpawning()` so existing particles fade naturally instead of
popping out. Hard caps: 50 simultaneous spawner-emitted instances,
≤ 5 emissions/frame (stutter resilience), burst size 1–10.

Spawner config is **session-only** — resets to defaults each launch.
Dialog window position persists across sessions for ergonomics.

- **Difficulty**: ★★★★★ (5/5)
- **Estimated effort**: 15–25 hours
- **Actual**: ~12 hours including two redesign passes (initially
  STEADY-only with a Stationary/Line path; first redesign added Manual
  + Auto burst modes; second redesign dropped paths entirely in favor
  of per-instance ballistic motion + max-lifetime, after the user
  observed the spawner-moves-vs-instance-moves design choice). The
  v2-deferred items (arc paths, velocity shorthand, presets, path
  visualization) are now their own roadmap entry.

### 5.14 ~~Buttons to reorder emitters~~ ✅ Shipped (#25)
Added **Move Up** / **Move Down** buttons to the emitter-list toolbar
between Delete and the visibility eye, plus right-click context-menu
items and `Alt+Up` / `Alt+Down` keyboard shortcuts. Reorders the
selected root emitter past its neighbor; the full subtree (children,
grandchildren, anything reachable via spawn-field traversal) moves
with it as a block. Children can't be reordered — they fill named
slots on their parent (`spawnDuringLife` / `spawnOnDeath`), not an
ordered sibling list. Buttons grey out for child emitters and at the
top / bottom of the root list.

- **Difficulty**: ★★☆☆☆ (2/5)
- **Estimated effort**: 2–3 hours
- **Actual**: ~2 hours. Slightly more complex than the "swap with
  neighbor in vector" wording suggested — subtrees aren't contiguous
  in `m_emitters` (children get push_back'd at add time and stay put
  through any later reorders), so the algorithm collects both
  subtrees by spawn-field DFS and rearranges only those positions
  while emitters belonging to neither stay where they are. Foundation
  for the upcoming drag-and-drop roadmap item — same backend method,
  same tree-rebuild path; only the input changes.

### 5.15 ~~Right-click → Duplicate Emitter~~ ✅ Shipped (#19)
Added a *Duplicate* item to the emitter context menu (between Copy and
Paste). Copies the selected emitter into a new slot inserted right
below the original, suffixes the name (e.g. `smoke` → `smoke (copy)`).
Faster than the existing Copy → Paste flow because it skips the
clipboard round-trip.

- **Difficulty**: ★☆☆☆☆ (1/5)
- **Estimated effort**: 1–2 hours
- **Actual**: ~1 hour. Landed the "proper" variant that inserts the
  duplicate at `original.index + 1` rather than appending to the end —
  required a new `ParticleSystem::insertEmitterAfter` method that
  mirrors `deleteEmitter`'s index-shift logic in reverse.

### 5.16 ~~Scroll-wheel adjustment on numeric boxes~~ ✅ Shipped (#16)
When the cursor is over a `Spinner` control, `WM_MOUSEWHEEL` increments /
decrements the value. Hold Shift for ×10 steps, Ctrl for ×0.1 steps.
Self-contained change to `src/UI/Spinner.cpp`.

- **Difficulty**: ★☆☆☆☆ (1/5)
- **Estimated effort**: 1–2 hours
- **Actual**: ~30 min, single file

---

## 6. Notes on roadmap conventions

How item headings are numbered and tagged, and the renumbering rules
that fire when an item ships. See [CLAUDE.md](CLAUDE.md) for the
authoritative version of these rules.

**Item headings.** Each item is shown as `### N.M [TIER-K] Title`.
Two identifiers in one heading:

- **`N.M` (position)** — purely visual ordering. `N` matches the
  section number (`1.` Near, `2.` Medium, `3.` Long, `5.` Shipped);
  `M` is sequential within the section. The position **renumbers
  freely** when items ship so the list stays gap-free. Don't cite
  the position in PRs, commits, or discussion — it changes underfoot.
- **`[TIER-K]` (stable tag)** — the permanent identifier (`NT-1`,
  `MT-3`, `LT-2`, etc.). Assigned at creation as `max+1` within the
  tier, never reused, vacated permanently on ship. **Cite the tag**
  anywhere a reference needs to survive future renumbering.

**Shipping convention.** When a roadmap item ships:

1. Its title is struck through with `✅ Shipped (#NN)` and an *Actual:*
   line is appended under the estimate.
2. The entry moves to [Shipped](#5-shipped) at the top of that section
   (newest first), keeping its `[TIER-K]` tag and taking the new `5.1`
   position; the rest of Shipped shifts down (5.1→5.2, …).
3. The source tier renumbers to close the gap left behind (e.g. if
   `2.3` ships, what was `2.4` becomes `2.3`, `2.5` becomes `2.4`).
   The vacated `[TIER-K]` tag stays retired.

Items shipped before this convention was adopted (PRs #16 through #41)
have no bracketed tag in the Shipped section — they're referenced by
PR number, which is already permanent.
