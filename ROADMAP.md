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

### 1.1 [NT-2] Adjustable ground-plane height in the preview
A spinner (or a small drag-handle in the preview viewport) that moves the
ground plane up or down along Z. Useful when the particle anchors below
ground or you want to see how a fire effect interacts with terrain at a
specific elevation. Persists per-session; not saved into the `.alo`.

- **Difficulty**: ★☆☆☆☆ (1/5)
- **Estimated effort**: 1–2 hours

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

### 2.5 [MT-5] Confirm / extend two-child emitter support
The on-disk format and runtime data structures already give every emitter
both a `spawnOnDeath` and `spawnDuringLife` slot — they're independent
fields. Verify end-to-end: that the editor lets you set both on one
emitter, the file round-trips correctly, and the in-game engine renders
both children. If anything in the editor's UI or selection logic
implicitly assumes "one child or the other", fix it. Ship test fixture
`.alo` files exercising each combination.

- **Difficulty**: ★★☆☆☆ (2/5) — mostly investigation
- **Estimated effort**: 2–4 hours

### 2.6 [MT-6] Bloom in the preview renderer
Add the game's "fake-HDR" bloom post-process to the editor preview so
particles that glow in-game also glow in the editor. Today, an emitter
authored to bloom (e.g. fire / explosion hotspots, energy weapon trails)
renders flat in the preview, which means lighting decisions get made
against the wrong reference image.

The reference shader is the game's
`SHADERS/Source/Engine/SceneBloom.fx` — three passes (bright filter →
ping-pong Gaussian-ish blur → AddSmooth combine) with three tunables:

- **`BloomStrength`** (game default `0.1`) — final multiplier on the
  blurred bright-pass result before it's blended back onto the scene.
  The primary knob the user wants.
- **`BloomCutoff`** (default `1.0`) — luminance threshold for the
  bright-pass filter. Pixels above it pass through unchanged; pixels
  below are suppressed by `pixel⁵`.
- **`BloomSize`** (default `0.25`) — blur kernel radius.

Plus a non-obvious detail from the shader comments worth mirroring:
*"the alpha channel can pull the luminance up for this formula"* — the
game lets specific particles opt into bloom by writing non-zero alpha
into the frame buffer alpha channel, which is then folded into the
luminance dot product. We should preserve this behavior so editor
preview matches in-game contribution per-particle, not just per-scene.

UI: a new **View → Bloom…** dialog (or a panel under View) with a
master enable checkbox plus three sliders matching the shader inputs.
Defaults match the shader. Persisted per-session in the registry.

**Implementation notes:**

- Requires render-to-texture infrastructure the editor doesn't have
  today. The current preview renders directly to the swap chain. We'd
  need at least three off-screen targets at half-resolution: the
  scene, plus two ping-pong targets for the blur passes. Then the
  combine pass blends the ping-pong result onto the back buffer.
- DXSDK ships D3DX9 helpers for offscreen RT creation
  (`IDirect3DDevice9::CreateTexture` with `D3DUSAGE_RENDERTARGET`).
  No new dependency.
- Port the three shader programs from `SceneBloom.fx`. They compile
  to vs_1_1 / ps_1_3 — well within the editor's existing shader
  pipeline. `ShaderManager` already has the all-or-nothing reload
  semantics we'd want for bloom shaders too.
- The "fake-HDR alpha-as-luminance-boost" trick assumes the back
  buffer is a format that preserves alpha through the particle
  blends. Need to verify that's true for the editor's current swap
  chain config; if not, an intermediate FP / `D3DFMT_A8R8G8B8` RT
  fixes it.

- **Difficulty**: ★★★★☆ (4/5)
- **Estimated effort**: 8–12 hours

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

### 5.1 ~~Autosave for in-progress particles~~ ✅ Shipped (#41)
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

### 5.2 ~~Drag-and-drop to reparent (make an emitter a child of another)~~ ✅ Shipped (#37)
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

### 5.3 ~~Drag-and-drop reordering in the emitter tree~~ ✅ Shipped (#35)
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

### 5.4 ~~Programmable particle spawner for the preview (v1)~~ ✅ Shipped (#30)
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

### 5.5 ~~Buttons to reorder emitters~~ ✅ Shipped (#25)
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

### 5.6 ~~Right-click → Duplicate Emitter~~ ✅ Shipped (#19)
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

### 5.7 ~~Scroll-wheel adjustment on numeric boxes~~ ✅ Shipped (#16)
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
