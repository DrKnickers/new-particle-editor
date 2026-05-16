_Draft GitHub release body for Particle Editor v0.2.0._
_(Paste into the GitHub Releases UI; this file lives in `tasks/` and is not shipped.)_

---

Second release of the DrKnickers fork of Mike.NL's particle editor for Star Wars: Empire at War / Forces of Corruption. The release focuses on quality-of-life features that speed up the particle workflow and on preview work to bring the editor's render closer to what you see in-game.

**Workflow additions:** full undo/redo, autosave with crash recovery, multi-select and drag-and-drop in the emitter list, a *linked emitters* system that keeps parameters synchronised across a group, cross-file emitter import, and a frequently-used textures palette. **Preview additions:** bloom on the canonical engine path, adjustable environment lighting, a selectable skydome background, a selectable ground texture, an adjustable ground-plane height, and pause / frame-step controls.

## INSTALL

- Download the zip below and extract anywhere.
- Run `ParticleEditor.exe`. On first launch you'll be asked for your EaW / FoC install folder.

The required `d3dx9_43.dll` is bundled in the zip alongside the exe — no separate DirectX runtime install needed.

---

### NEW FEATURES:

_Undo / Redo_

- Added `Ctrl+Z` (undo) and `Ctrl+Y` / `Ctrl+Shift+Z` (redo) for every edit that survives a `.alo` save/load — property fields on all three Emitter tabs, every track key, every random-parameter group, structural ops (add / delete / duplicate / move / rename / paste), and the `Leave Particles` toggle.
- Added Edit-menu *Undo* / *Redo* entries (greyed at stack ends) and toolbar buttons.
- Stack capped at 100 entries. File New / Open clears and re-seeds the stack at the loaded baseline so the first `Ctrl+Z` rewinds back to disk, not into nothing.
- Edits within ~1.5 s on the same emitter coalesce into a single undo step.
- Save marks the current stack entry as "matches disk" — undoing back to it clears the title-bar asterisk; redoing past it restores it.

_Note: editor-only state is deliberately excluded from the stack — visibility toggles, selection, expand/collapse, viewport / camera / background / ground / Spawner config, and mod selection are not undoable._

_Autosave with crash recovery_

- Added a two-tier autosave: a **recent** snapshot every 30 s and a **stable** snapshot every 5 min, both written to `%TEMP%\AloParticleEditor\` only when there's an in-memory system AND the dirty flag is set.
- Added a recovery prompt on launch when an orphan autosave from a non-living editor process is found — Yes loads the recent snapshot, No loads the stable one (or discards when only one tier survived), Cancel discards. After recovery the editor opens the original filename so `Ctrl+S` overwrites the right file.
- Recovery is **skipped** when a `.alo` is passed on the command line (e.g. double-click from Explorer) — the explicit user gesture wins; the orphan stays in TEMP for the next plain launch.
- The editor never writes to the user's own `.alo`. The PID tag in autosave filenames lets two editor instances coexist without clobbering each other's recovery files. A 30-day mtime sweep keeps `%TEMP%` from accumulating abandoned files.

_Bloom in the preview_

- Added bloom in the editor preview that loads the game's canonical `Engine\SceneBloom.fx` through the same resolution chain as particle shaders — mod overlay first, then game roots / MEGs — so the editor's bloom is byte-identical to in-game bloom and picks up mod customisations automatically on the next mod switch or shader reload.
- Added a *View → Bloom… / Ctrl+B* dialog with the three canonical knobs (*Strength*, *Cutoff*, *Size*) plus a master enable, mirroring the EAW Terrain Editor's bloom panel.
- Added a sunburst toolbar toggle right of the Heat Debug button — clicking it flips bloom on/off in one stroke and stays in sync with the dialog and the persisted state.
- All four values persist across sessions; *View → Reset View Settings* drops them back to the Terrain Editor's new-map defaults (`Cutoff = 0.90`, `Strength = 0.00`, `Size = 0.10`).
- When the bloom shader can't be loaded (no game path configured, file missing, parameter surface doesn't match), the toolbar button and dialog controls grey out — no crash and no garbage rendering.

_Selectable backgrounds_

- Added a unified **Background** toolbar button. Click once to open a modeless picker with a 4×3 grid of 192×192 thumbnails: slot 0 is *Solid colour* (opens the standard Win32 colour-picker seeded with the current background and the editor's shared 16-slot custom palette); slots 1–8 are eight bundled skydomes (Storm, Murky Clouds, Smog Clouds, Blue Horizon, Blue Sky, Orange Horizon, Orange Sky, Volcanic Storm); slots 9–11 are user-customisable.
- The eight bundled slots load real base-game textures from `DATA\ART\TEXTURES\` through the existing `FileManager` chain, so the active mod's overlay is picked up automatically the same way emitter textures are. Switching mods via the Mods menu refreshes the live skydome — no editor restart needed to see a mod's `W_SKY*.DDS` override take effect.
- The toolbar preview is a hybrid: a flat colour swatch when slot 0 is active, or a 24×24 thumbnail of the current skydome otherwise.
- Custom slots 9–11 single-click into `GetOpenFileName` filtered to `*.dds;*.tga` when empty; right-click for *Set custom skydome…* / *Change skydome…* / *Clear slot*. A *Reset custom slots* button at the bottom of the picker wipes user-supplied paths after a confirmation prompt.
- The picker uses the same sticky-popup model as the textures palette — clicking a slot commits and leaves the dialog open so you can browse interactively. Close via the title-bar X or by toggling the Background button.
- All state persists across sessions: `SkydomeIndex` (0–11), `SkydomeCustomSlot{9,10,11}` (paths), `SkydomePickerPos` (dialog position). Out-of-range / missing-file values fall back to slot 0 rather than crashing.

_Selectable ground texture_

- Added a *Ground Texture:* toolbar button next to the Background button, opening a 4×3 picker laid out the same way as the textures palette popup. Bundled slots ship two common ground variants; custom slots accept any `.dds` / `.tga` the user picks.
- Click commits the selection and closes the picker (the ground texture uses a click-closes model rather than the sticky model used for Background and the palette).
- Custom slot paths persist across sessions; *View → Reset View Settings* leaves them in place (slot assignments are user data, not view settings).

_Adjustable environment lighting_

- Added a *Lighting…* entry on the View menu opening a modeless dialog with separate colour pickers for *Ambient* and *Sun* lighting, plus a sun-direction triplet. Tweaks update the preview live.
- Defaults match the canonical Terrain Editor's new-map lighting. *Reset View Settings* returns the dialog to those defaults.
- Lighting state persists across sessions through `HKCU\Software\AloParticleEditor`.

_Frequently-used textures palette_

- Added a *Palette* button on the Appearance tab's Textures group, next to the existing texture browse buttons. Click it to open a popup with a 4×3 grid of 192×192 thumbnails of pinned textures — a fast way to keep your eight or twelve regulars one click away.
- Pin / unpin by right-clicking a slot; an explicit thumbtack badge marks pinned cells. Texture filenames sit under each tile so you can tell `flame02.dds` from `flame02b.dds` at a glance.
- Palette contents persist across sessions in `palette.ini` next to the exe. Capacity is 12 slots (3 sub-rows × 4 thumbs per row).

_Import emitters from another `.alo`_

- Added *File → Import Emitters from File…*. Opens an `.alo` picker, then a dialog showing the source file's emitter tree with `TVS_CHECKBOXES`. Tick whichever emitters you want — parent/child auto-include is on by default — and OK to land them as new root emitters in the current particle system.
- Picker has *Select all* / *Clear* / *Browse…* buttons; *Browse…* swaps the source file in place without cancelling.
- Imported emitters arrive with collision-free names (e.g. `smoke_1`), spawn-child cross-references re-mapped where both source and child were imported (dropped child → `-1`), and source link groups re-created as fresh destination groups when ≥2 members of the source group survived the import.
- The entire import is one undo step — `Ctrl+Z` atomically rolls back every newly-added emitter.

_Note: the existing single-emitter clipboard copy/paste (`Ctrl+C` / `Ctrl+V` on the emitter tree) still works for one-at-a-time transfers. Import is the new path for assembling a complex effect from pieces of existing ones in one gesture._

---

### EMITTER MANAGEMENT:

_Drag-and-drop reorder_

- Click-and-drag a root emitter in the tree to reorder it past one or more sibling roots. The whole subtree (children, grandchildren, anything reachable via spawn-field traversal) moves with the source as a block.
- Translucent drag-image ghost under the cursor plus an insertion-mark line showing where the drop will land.
- `IDC_NO` cursor over invalid drop targets (children, the source's own current gap, outside the tree client area). Esc cancels mid-drag with no change to the file.
- Auto-scrolls when the cursor enters a 16-pixel hot zone at the top or bottom of the tree.
- One Ctrl+Z reverts a successful drop.

_Drag-and-drop reparent_

- Drop emitter S onto emitter T (mid-row hover) to make S a child of T. The full subtree under S moves with it as a block; spawn-field references on every affected parent are rewritten in one shot.
- Hit-test is three-zone per item rect: top 1/3 inserts above (reorder), middle 1/3 is drop-onto (reparent), bottom 1/3 inserts below (reorder).
- When both target slots (`spawnDuringLife` and `spawnOnDeath`) are free, a small popup at the cursor offers *Reparent as Lifetime child* / *Reparent as on-Death child* / cancel. Single free slot auto-picks; both slots occupied refuses the drop.
- Drop-on-self, drop-on-descendant (would form a cycle), and drop-on-current-parent are refused before commit.

_Multi-select for the emitter list_

- `Ctrl+click` toggles individual emitters into the selection; `Shift+click` selects a contiguous range. Selection survives expand/collapse and is restored after undo/redo where applicable.
- Right-click context menu now operates on the whole selection — *Delete*, *Duplicate*, *Copy*, *Cut* all act on every selected emitter, with one undo step per multi-select op.
- The property panel shows the most-recently-selected emitter as the "primary" target for direct edits; structural ops act on the full set.

_Linked emitters (share parameters across a group)_

- Added a *Link / Unlink Selected* entry on the emitter context menu. Linked emitters share every property edit and every track-key change automatically — tweak Red on one, every linked sibling updates in lock-step.
- A small bracket renders next to the emitter-list icons of every emitter in the same link group, with the group's colour, so groups are visually distinguishable at a glance.
- Per-group **configurable exempt set** — choose which properties propagate and which stay per-emitter via a small dialog on the link-group bracket's context menu. Useful for keeping (say) a per-emitter texture or atlas index per-instance while every dynamics field stays in lock-step.
- Link group survives a `.alo` save/load and is preserved by cross-file import (when ≥2 members of a source group are imported together).

_Duplicate with index increment_

- Added *Duplicate (increment index)* and *Duplicate (increment index…)* to the emitter context menu, directly below *Duplicate*. The first shifts every keyframe on the atlas index track (`TRACK_INDEX`) by +1; the second prompts for an integer increment N (1–999).
- Motivating workflow: build one base emitter aimed at atlas frame 0, right-click-duplicate 15 more times, and each copy targets the next sprite-sheet cell — no track editor required.

---

### VIEWPORT & PREVIEW:

_Pause / frame-step_

- `F8` freezes the preview at the current simulation tick; press again to resume from exactly where time left off — no time-warp pop, no synthetic catch-up burst.
- While paused, `F9` steps the simulation forward by one notional 60 Hz frame; `F10` steps ten frames (≈167 ms — enough to traverse a one-second particle lifetime in six presses). All three actions also live under *View → Pause Preview / Step 1 Frame / Step 10 Frames* and as toolbar buttons next to the Bloom toggle.
- Step buttons and corresponding menu entries grey out when not paused. The FPS pane in the status bar suffixes ` · PAUSED` while frozen so the state is glanceable.
- Pause always starts off on launch.

_Note: the spawner manual-fire shortcut moved from `Shift+Space` to `Ctrl+Space` to free up `Shift` for future "modify the gesture" semantics. The "Spawn now" button in the Spawner dialog has been relabeled to match; the `F7` open shortcut is unchanged._

_Adjustable ground height_

- Added a *Ground Height:* spinner in the header strip just left of the Background button. Working range −100 to +100 units, 0.1-unit step. Scroll-wheel adjusts (`Shift` = ×10, `Ctrl` = ×0.1) like every other Spinner in the editor.
- The spinner greys out (visible, not hidden) when *Show Ground* is off; flipping ground back on re-enables it.
- Ground height is **session-only** — every launch starts the ground plane at z = 0 regardless of what value was in effect when you last closed. An anchored vertical reference makes "did I just open the editor, or is this a continued workflow?" unambiguous, and *Reset View Settings* can't surprise you with a stale offset from a previous tuning pass.

_Note: an earlier cut of this feature persisted the value across sessions. PR #79 reverted that — the spinner still works during the session, it just doesn't write to the registry anymore. If you want a fixed non-zero ground height for a project, save it in the `.alo` (which the editor already supports via the ground-quad block) rather than as editor state._

---

### BUG FIXES:

- Fixed bump-mapped particles (`BLEND_BUMP`, `BLEND_DECAL_BUMP`) ignoring the curve-editor Red / Green / Blue tracks. The editor previously overwrote RGB with a rotation-tangent encoding that produced an apparent hue cycle depending on each particle's spawn rotation and bore no relation to anything the user had authored. The override didn't match what the in-game engine does — confirmed by deploying a diagnostic shader and observing the engine's actual behaviour — so the editor's render diverged from the in-game appearance for any bump particle the user attempted to colorize. Removed.

---

### KNOWN ISSUES:

- Mod-bundled `.meg` archives are still not read. Mods that ship loose files work fully; total conversions that package assets in their own megafiles (Thrawn's Revenge, Awakening of the Rebellion) are not yet supported.
- Spawner configuration still does not persist across sessions and resets to defaults on each launch. Window position *does* persist.
- After undo / redo, live preview instances (Shift-spawned or Spawner-driven) are killed because they hold C++ references to the about-to-be-replaced Emitter objects. Re-spawn to see the reverted state.

---

### CREDITS:

- Original editor by **Mike.NL** ([GlyphXTools/particle-editor](https://github.com/GlyphXTools/particle-editor)).
- Fork maintained by **DrKnickers**, with help from Claude.
- Full per-PR engineering detail: [DEVELOPMENT_LOG.md](https://github.com/DrKnickers/new-particle-editor/blob/master/DEVELOPMENT_LOG.md).
- Planned work: [ROADMAP.md](https://github.com/DrKnickers/new-particle-editor/blob/master/ROADMAP.md).
