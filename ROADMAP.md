# Roadmap

Planned work for the particle editor, grouped by horizon. Difficulty is rated
on a 1–5 scale; effort is a rough hour estimate for a contributor already
familiar with the codebase (multiply by 2–3× when first ramping up on Win32 +
D3DX9).

Items can land in any order within their tier — the grouping reflects scope
and risk, not strict dependency.

---

## Near term

Quality-of-life polish on existing workflows. Each item is contained, low
risk, and doesn't touch the rendering pipeline or file format.

### Autosave for in-progress particles
Periodically save the current particle system to a recovery file (e.g.
`%TEMP%\AloParticleEditor\autosave.alo`) so an editor crash or a forgotten
save doesn't lose work. On launch, if a recovery file exists from a previous
session, prompt the user to recover it. Independent of the user's manual
save target — the editor never silently overwrites the user's `.alo`.

- **Difficulty**: ★★☆☆☆ (2/5)
- **Estimated effort**: 3–5 hours

### Buttons to reorder emitters
Add **Move Up** / **Move Down** buttons to the emitter-list toolbar. Each
swaps the selected emitter with its neighbor in the underlying vector,
updates any spawn-field indices that referenced the swapped slots, and
refreshes the tree. The same logic underlies drag-and-drop reordering, so
shipping the buttons first de-risks that work.

- **Difficulty**: ★★☆☆☆ (2/5)
- **Estimated effort**: 2–3 hours

### Drag-and-drop reordering in the emitter tree
Use the tree control's drag-and-drop notifications (`TVN_BEGINDRAG`,
`WM_MOUSEMOVE`, `WM_LBUTTONUP`) to let the user reorder emitters by
dragging them between siblings. Reuses the swap logic from the reorder
buttons. Visual feedback (insertion cursor / highlighted target) is part
of the work.

- **Difficulty**: ★★★☆☆ (3/5)
- **Estimated effort**: 4–6 hours

### Drag-and-drop to reparent (make an emitter a child of another)
Extension of the previous item: dropping an emitter onto another emitter
turns the source into the target's spawn-during-life or spawn-on-death
child. Requires a small "what kind of child?" prompt when the target
already has neither (so the user can pick) and a refusal path when the
target slot is occupied. Edge cases: dropping onto self, creating a cycle,
dropping a parent onto its own descendant.

- **Difficulty**: ★★★★☆ (4/5)
- **Estimated effort**: 6–10 hours

### ~~Scroll-wheel adjustment on numeric boxes~~ ✅ Shipped (#16)
When the cursor is over a `Spinner` control, `WM_MOUSEWHEEL` should
increment / decrement the value. Hold Shift for ×10 steps, Ctrl for ×0.1
steps. Self-contained change to `src/UI/Spinner.cpp`.

- **Difficulty**: ★☆☆☆☆ (1/5)
- **Estimated effort**: 1–2 hours
- **Actual**: ~30 min, single file

### Adjustable ground-plane height in the preview
A spinner (or a small drag-handle in the preview viewport) that moves the
ground plane up or down along Z. Useful when the particle anchors below
ground or you want to see how a fire effect interacts with terrain at a
specific elevation. Persists per-session; not saved into the `.alo`.

- **Difficulty**: ★☆☆☆☆ (1/5)
- **Estimated effort**: 1–2 hours

### ~~Right-click → Duplicate Emitter~~ ✅ Shipped (#19)
Add a *Duplicate* item to the emitter context menu (between Copy and
Delete). Internally copies the emitter into a new slot inserted right
below the original, suffixes the name (e.g. `smoke` → `smoke (copy)`).
Faster than the existing Copy → Paste flow because it skips the
clipboard round-trip.

- **Difficulty**: ★☆☆☆☆ (1/5)
- **Estimated effort**: 1–2 hours
- **Actual**: ~1 hour. Landed the "proper" variant that inserts the
  duplicate at `original.index + 1` rather than appending to the end —
  required a new `ParticleSystem::insertEmitterAfter` method that
  mirrors `deleteEmitter`'s index-shift logic in reverse.

---

## Medium term

Bigger UX investments and modest engine work. Each touches more than one
subsystem but stays inside the rendering preview / editor surface.

### Frequently-used textures palette
A small panel — probably docked under the Color/Bump texture fields on
the Appearance tab — that surfaces recently-used and pinned textures as
clickable thumbnails. Saves clicking through the file browser when
iterating between a small set of textures. Persists per-mod (tracked
alongside the existing `LastMod` registry value) so switching mods
doesn't pollute the list.

- **Difficulty**: ★★★☆☆ (3/5)
- **Estimated effort**: 5–8 hours

### Selectable ground texture
Currently the preview ground is hardcoded to `IDB_GROUND` (`dirt.bmp`).
Expose a picker — initially a small dropdown of bundled options
(grass / sand / metal deck / Hoth snow / black void), later expandable to
any user-supplied texture. Per-session setting, persisted to the registry.

- **Difficulty**: ★★☆☆☆ (2/5)
- **Estimated effort**: 2–4 hours

### Selectable skydome backgrounds
Replace the flat background-color rectangle with an optional skydome
(textured sphere) the camera can rotate inside. Lets you preview a
particle effect against a representative scene — space, atmosphere, dusk,
etc. Requires adding a skybox render pass before the ground plane and a
sphere or cube mesh. Out of the box, ship a few canned options bundled
into the exe via resources.

- **Difficulty**: ★★★★☆ (4/5)
- **Estimated effort**: 8–14 hours

### Adjustable environment lighting in the preview
The engine already maintains three `Light` structs (sun + two fill
lights), but only the values from the loaded particle system can adjust
them. Add a Lighting panel (probably under View → Lighting…) with
direction sliders, color pickers, and intensity for each light, plus a
"reset to default" button. Persists per-session.

- **Difficulty**: ★★★☆☆ (3/5)
- **Estimated effort**: 4–6 hours

### Confirm / extend two-child emitter support
The on-disk format and runtime data structures already give every emitter
both a `spawnOnDeath` and `spawnDuringLife` slot — they're independent
fields. Verify end-to-end: that the editor lets you set both on one
emitter, the file round-trips correctly, and the in-game engine renders
both children. If anything in the editor's UI or selection logic
implicitly assumes "one child or the other", fix it. Ship test fixture
`.alo` files exercising each combination.

- **Difficulty**: ★★☆☆☆ (2/5) — mostly investigation
- **Estimated effort**: 2–4 hours

---

## Long term

Larger features that meaningfully expand what the editor can do. Each is
roughly on the order of a small project rather than a sitting.

### Programmable particle spawner for the preview
Today the only way to test a particle is to press Shift and spawn a single
instance at the cursor. Build a configurable test driver:

- Adjustable spawn rate (steady, pulsed, one-shot).
- Initial velocity vector (manual entry or arrow gizmo).
- Motion path for the spawn point (straight line, arc, user-drawn curve).
- Optional jitter / randomization on each axis.

This makes it dramatically faster to assess how a particle reads in
motion — rocket trails, debris, projectile impacts — without leaving the
editor for the game. Persisted as part of the editor's session state, not
saved into the `.alo`.

- **Difficulty**: ★★★★★ (5/5)
- **Estimated effort**: 15–25 hours

### Template particle systems (starter library)
Ship a curated set of starter `.alo` files (basic fire, smoke column,
explosion, sparks, smoke trail, weather, etc.) under `templates/` next to
the exe. Add a **File → New from Template…** entry that opens a small
dialog with thumbnails or named entries; selecting one loads it as an
unsaved new system that the user can iterate on. Lowers the activation
energy for new mod authors.

- **Difficulty**: ★★★☆☆ (3/5) — most of the work is curating the templates
- **Estimated effort**: 6–10 hours (excluding template authoring time)

### Import emitters from other particle files
Currently you can copy a single emitter to the clipboard from one editor
window and paste into another. Replace this with a proper import flow:
**File → Import Emitters from File…** opens a `.alo` picker, then a
dialog showing that file's emitter tree with checkboxes, then copies the
selected emitters into the current system — re-mapping any spawn-field
indices into the destination so cross-references don't break. Saves a lot
of clicks when assembling a complex effect from pieces of existing ones.

- **Difficulty**: ★★★★☆ (4/5)
- **Estimated effort**: 8–14 hours

### UI overhaul (WebView2 + React chrome)
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

## Notes on prioritization

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
