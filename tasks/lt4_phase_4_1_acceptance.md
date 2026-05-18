# LT-4 Phase 4.1 — Parity Acceptance Checklist

**Goal:** verify `--new-ui` has functional parity with `--legacy-ui` for
every shipped surface, surfacing any unintentional regressions BEFORE
the Phase 4.2 legacy delete. After this walkthrough the doc carries
findings: which items match, which differ intentionally (by-design
divergence — captured in the LT-4 batches' iteration logs), which are
actual regressions that need fixing.

**Phase 4.2 legacy delete is gated on this acceptance pass.**

---

## Protocol

### Setup

1. Build both variants of the binary:
   ```bash
   MSBuild ParticleEditor.sln /p:Configuration=Debug /p:Platform=x64
   ```
   The same `ParticleEditor.exe` runs both modes — the `--new-ui` flag
   selects the React hybrid; no flag = `--legacy-ui`.

2. Boot side-by-side:
   ```bash
   x64\Debug\ParticleEditor.exe                # legacy
   x64\Debug\ParticleEditor.exe --new-ui       # new
   ```
   Window side-by-side on the same monitor. (Or use `--new-ui --dev-ui`
   to load from the Vite dev server with HMR — handy if a regression
   is found and you want to iterate.)

### Test files

Pick one `.alo` from each tier. Suggestions:

- **Simple** (1–3 emitters, basic tracks): any small vanilla effect,
  e.g. `Data/Art/Models/Effects/<small effect>.alo`.
- **Complex** (10+ emitters, link groups, all 7 tracks populated):
  a flagship explosion or weapon effect from vanilla EaW.
- **FoC-only**: an effect from `Corruption`'s expansion (verifies
  the FoC mod-data path resolution).
- **Community-mod**: an `.alo` from a popular mod (Republic at War,
  Thrawn's Revenge, Awakening of the Rebellion) to stress edge cases
  in emitter shapes + texture references.

### Reporting findings

For each line item: mark **✅** (matches), **⚠️ intentional** (differs
from legacy but documented as a design choice — cross-reference the
iteration log entry), or **❌ regression** (actual bug to fix). For
regressions, capture: what was observed, expected legacy behaviour,
and a one-liner repro.

---

## Section 1 — App shell

- [ ] **Window opens at startup** with default size (≥860×750).
- [ ] **Title bar** shows `AloParticleEditor` (untitled) or
      `<filename> — AloParticleEditor` when a file is open.
- [ ] **Dirty marker (`*` prefix)** appears in title after any engine
      mutation (set ground-z, change background, etc.).
- [ ] **Status bar** shows FPS / Emitters / Particles / Instances
      (4-column). Updates at 4 Hz.
- [ ] **Min window size** enforced — try resizing below 860×750.
- [ ] **Close (X button)** prompts Save Changes when dirty.
- [ ] **Alt+F4** prompts Save Changes when dirty.
- [ ] **Native title bar** (not custom chrome — by design).

---

## Section 2 — Menu bar

### File menu

- [ ] **New** — clean state: clears the system silently. Dirty state:
      opens Save Changes prompt → Save / Don't Save / Cancel.
- [ ] **Open** — opens native file picker. Loaded file's path appears
      in title. Recent files menu updates.
- [ ] **Save** (untitled): opens picker, saves to chosen path, title
      updates. Save (with path): writes silently to current path.
- [ ] **Save As** — always opens picker, even when current path is
      set.
- [ ] **Import Emitters** — opens import dialog (Section 12).
- [ ] **Recent Files submenu** — shows up to 9 most-recent paths.
      Click loads (with Save Changes prompt if dirty). Empty state
      shows `(none)` disabled.
- [ ] **Exit** — currently a TODO console-log in new-UI. Intentional
      gap; Alt+F4 / window-X work.

### Edit menu

- [ ] **Undo** (`Ctrl+Z`) — reverts most recent mutation.
- [ ] **Redo** (`Ctrl+Shift+Z`) — reapplies.
- [ ] **Clear All Particles** — kills all live ParticleSystemInstances
      in viewport (Shift-spawn results, Spawner output).
- [ ] **Rescale…** — opens Rescale System dialog (Section 8).
- [ ] **Cut / Copy / Paste / Delete** — disabled when emitter tree
      doesn't have focus. When the tree has focus, these route through
      the emitter clipboard (Screen 4 Batch C).

### View menu

- [ ] **Ground** toggle — flips the engine's show-ground state.
      Toolbar Ground button stays in sync.
- [ ] **Bloom** toggle — flips bloom on/off. **Bloom Settings…**
      opens the Bloom panel (Section 5).
- [ ] **Pause** toggle — pauses preview. **Step Forward** disabled
      until paused, then advances 1 frame.
- [ ] **Reload Shaders / Reload Textures** — re-reads from disk.
- [ ] **Heat Debug** toggle — flips heat-debug rendering.
- [ ] **Background…** — opens Background picker (Section 3).
- [ ] **Ground Texture…** — opens Ground Texture panel (Section 4).
- [ ] **Reset View Settings** — currently a TODO in new-UI.
      Intentional gap.

### Tools menu

- [ ] **Lighting…** — opens Lighting panel (Section 6).
- [ ] **Spawner…** — opens Spawner panel (Section 7).
- [ ] **Mods submenu** — lists detected mods + active selection.
      Legacy parity TBD.

### Help menu

- [ ] **About** — opens About dialog. Shows version + build date +
      license + GitHub link.

---

## Section 3 — Background picker

(Sliding right-side panel; mutual exclusion with other tool panels.)

- [ ] **Background pill** in top-right of header opens the panel.
- [ ] **Solid colour** (slot 0) — wide swatch reflects current
      background. Click opens a colour picker. Confirmed colour
      updates engine background + viewport clears to that colour.
- [ ] **Bundled skydomes** (slots 1–8) — 8 square tiles with
      placeholder gradient (browser mode) or real thumbnail (native
      mode if wired). Click commits the slot. Engine renders that
      skydome.
- [ ] **Custom skydomes** (slots 9–11) — empty: "+ Browse" no-op.
      Populated (legacy populates from registry): tile + filename +
      `↺` replace glyph. Click commits.
- [ ] **Selection visual** — selected tile has `border-sky-500` +
      `✓` glyph in top-right corner. Unselected: `border-neutral-800`.
- [ ] **Close (×)** dismisses the panel.
- [ ] **Mutual exclusion** — opening Lighting / Bloom / Ground
      Texture closes Background.

---

## Section 4 — Ground Texture panel

- [ ] **Show Ground** master checkbox at top reflects engine state.
- [ ] **Slot 0 (solid colour)** — wide tile shows current ground
      solid colour. Click opens ColorButton popover.
- [ ] **Bundled slots** — square tiles with placeholder gradients.
      Click switches `engine/set/ground-texture`.
- [ ] **Custom slots** — empty: "+ Browse" no-op (file-picker
      deferred). Populated: shows basename.
- [ ] **Selection** — visible accent border on selected tile.

---

## Section 5 — Bloom Settings panel

- [ ] **Enable Bloom** checkbox mirrors `View → Bloom`.
- [ ] **Strength** Spinner (range 0..5, step 0.05).
- [ ] **Cutoff** Spinner (range 0..1, step 0.01).
- [ ] **Size** Spinner (range 0..32, step 0.5).
- [ ] **Bloom unavailable** (some GPUs): all controls disabled with
      placeholder text.

---

## Section 6 — Lighting panel

- [ ] **Sun section** (collapsible, expanded by default):
      intensity Spinner, azimuth Spinner, altitude Spinner, diffuse
      ColorButton, specular ColorButton.
- [ ] **Fill 1** (collapsible, collapsed by default): intensity +
      angles + diffuse only.
- [ ] **Fill 2**: same as Fill 1.
- [ ] **Ambient ColorButton**.
- [ ] **Shadow ColorButton**.
- [ ] **Mirror Sun** button — copies sun direction to Fill 1 (two
      `engine/set/light` calls).
- [ ] **Reset** button — resets all lights to component defaults.
- [ ] **Force Align** checkbox — deferred (no bridge call exists
      yet). Intentional gap.
- [ ] **Intensity + colour interaction** — moving intensity above 1
      preserves the user's RGB selection (per the host-state-plumbing
      lock). Snapshot doesn't re-seed intensity from the engine's
      pre-multiplied Vec4.

---

## Section 7 — Spawner panel

- [ ] **Mode** radio (Manual / Auto).
- [ ] **Auto-only fields**: Enabled checkbox + Interval Spinner.
- [ ] **Burst size** Spinner (1..10).
- [ ] **Spacing** Spinner (0..10 s).
- [ ] **Position** (3 Spinners: x, y, z).
- [ ] **Velocity** (3 Spinners).
- [ ] **Max lifetime** Spinner (0..600 s).
- [ ] **Jitter position** (3 Spinners).
- [ ] **Jitter velocity** (3 Spinners).
- [ ] **Manual-only Spawn now** button — fires a single burst.
- [ ] **Stop** icon button in header — disabled when active count
      is 0.
- [ ] **Active-count badge** in header — updates from engine's
      `GetNumInstances()`.

---

## Section 8 — Rescale System dialog

- [ ] **Edit → Rescale…** opens the modal.
- [ ] **Duration scale** Spinner (1..1000 %).
- [ ] **Size scale** Spinner (1..1000 %).
- [ ] **OK** — applies to entire system. All emitters' tracks scale.
- [ ] **Cancel** — discards.

---

## Section 9 — Viewport

- [ ] **Particles render** in `--new-ui` when an emitter is loaded.
- [ ] **Camera L-drag** = MOVE (translate target).
- [ ] **Camera R-drag** = ROTATE (orbit).
- [ ] **Ctrl+L-drag / Ctrl+R-drag** = ZOOM.
- [ ] **Scroll wheel** = ZOOM (distance-scaled).
- [ ] **Shift-hold + cursor move** = spawn cursor-bound particle
      system. Release Shift to kill.
- [ ] **Cursor velocity** carries into spawned particles (shake to
      fling).
- [ ] **Engine state mutations** mark file dirty (title `*` appears).
      View-only toggles (paused, heat-debug) do NOT mark dirty —
      intentional (dirty-flag tightening from render-loop batch).

---

## Section 10 — Emitter tree (Screen 4)

(Right of the main row.)

- [ ] **Tree renders** when a file is loaded.
- [ ] **Role glyphs**: `●` root / `↻` lifetime / `✕` death.
- [ ] **Link-group dot** next to linked rows.
- [ ] **Link-group bracket** (Batch C) — coloured vertical bracket
      in the gutter spanning rows in the same group.
- [ ] **Click row** selects (single).
- [ ] **Ctrl/Cmd+click** toggles multi-select.
- [ ] **Shift+click** range selects (in flat tree order).
- [ ] **Click outside tree** clears selection.
- [ ] **Right-click row** opens context menu:
  - [ ] **Rename** — opens inline editor (F2 / double-click equiv.).
        Intentional divergence from legacy (modal → inline).
  - [ ] **Duplicate** — duplicates the emitter + subtree.
  - [ ] **Delete** — deletes (no confirmation; matches legacy).
  - [ ] **Increment Index…** — opens modal with single Spinner.
  - [ ] **Rescale Emitter…** — opens modal with 2 Spinners.
  - [ ] **Link Group Settings…** — opens exempt-fields modal.
        Disabled when emitter unlinked.
  - [ ] **Add Lifetime Child** — disabled when slot filled.
  - [ ] **Add Death Child** — disabled when slot filled.
  - [ ] **Move Up / Move Down** — disabled at edges.
  - [ ] **Set Link Group…** — opens dialog with Create new /
        Join existing options.
  - [ ] **Leave Link Group** — disabled when none of the selected
        emitters are linked.
- [ ] **Drag/drop**:
  - [ ] Drag in upper third of a row → reorders above.
  - [ ] Drag in middle third → reparents (auto-picks lifetime
        slot if free, else death, else refuses).
  - [ ] Drag in lower third → reorders below.
  - [ ] Drop on self / descendant → no-op (no-drop cursor).
- [ ] **Keyboard nav** (tree focused):
  - [ ] **Arrow Up/Down** — moves focus.
  - [ ] **Home / End** — jumps.
  - [ ] **Enter** — opens context menu.
  - [ ] **F2** — starts inline rename.
  - [ ] **Delete** — deletes multi-selection.
  - [ ] **Ctrl+C / Ctrl+X / Ctrl+V** — clipboard ops.
- [ ] **Cut / Copy / Paste** clipboard:
  - [ ] **Copy** → no tree change.
  - [ ] **Cut** → deletes from tree; clipboard retains.
  - [ ] **Paste** → appears as new root(s) with `_<N>` suffix.

---

## Section 11 — Emitter property panel (Screens 5 + 6)

(Visible when an emitter is selected.)

### TrackEditor shell

- [ ] **7 track-toggle buttons** in toolbar (Red / Green / Blue /
      Alpha / Scale / Index / Rotation). One always active.
- [ ] **Switching tracks** updates the CurveEditor canvas.
- [ ] **Lock-to combo** shows per-track options (Red disabled,
      Green has Red, Blue has Red+Green, Alpha has Red+Green+Blue).
      Selecting has no visual effect — **intentional deferral**
      (Batch B-β doesn't wire functional behaviour).
- [ ] **Time + Value Spinners** above toolbar — disabled when 0
      or 2+ keys selected. Enable + sync to single selection.
- [ ] **Editing Time spinner** — moves selected key in time
      (clamped to neighbor exclusive range). Border keys: Time
      spinner disabled.
- [ ] **Editing Value spinner** — moves selected key in value
      (clamped to track range).

### Toolbar tools

- [ ] **Select / Insert** mode toggle. One always active.
- [ ] **Linear / Smooth / Step** interpolation toggle. Active one
      reflects current track's interpolation type.
- [ ] **Delete** button — enabled when non-border keys selected.

### CurveEditor canvas

- [ ] **Axes + grid** render.
- [ ] **Polyline** connects keys (linear).
- [ ] **Smooth interpolation** renders as cubic Bezier path.
- [ ] **Step interpolation** renders as staircase polyline.
- [ ] **Key circles** at each (time, value).
- [ ] **Border keys** (first + last by time) render with stroke
      ring + darker fill.
- [ ] **Click key** selects (single).
- [ ] **Ctrl/Cmd+click** toggles multi-select.
- [ ] **Click empty canvas in Select mode** clears selection.
- [ ] **Click empty canvas in Insert mode** adds a new key at
      that (time, value).
- [ ] **Drag a key** — single-key drag with bounds. Border keys
      time-fixed; interior keys clamped to neighbor range. Value
      clamped to track range. Multi-key drag: NOT supported
      (intentional — single-key drag works on the clicked key).
- [ ] **Delete keypress on focused panel** — deletes selected
      non-border keys.
- [ ] **Smooth/Step rendering** — verify Bezier curves match
      legacy `PolyBezier` output visually. Verify staircase
      polyline matches legacy step rendering.

---

## Section 12 — Import Emitters dialog

- [ ] **File → Import Emitters…** opens modal.
- [ ] **Browse for file…** button opens native file picker.
- [ ] **Tree-view of source `.alo`** renders after browse.
- [ ] **Checkboxes** on each tree node. Auto-include-children
      cascade default ON.
- [ ] **Select All / Clear** buttons.
- [ ] **OK** button label: `Import N selected`. Disabled when N=0.
- [ ] **OK** appends selected emitters as new roots in current
      system.
- [ ] **Link groups** in source — verify they're recreated in
      destination when ≥2 group members are imported (per LT-3
      semantics). Single-member imports unlinked.

---

## Section 13 — Mod Nickname dialog

- [ ] **Auto-trigger** on file-load with unknown mod-data path.
      May not be reachable in `--new-ui` until file-load wiring
      detects the unknown-mod condition. Intentional gap.
- [ ] **`?demo=mod-nickname` route** still loads the dialog for
      manual verification.

---

## Section 14 — Save Changes prompt

- [ ] Triggered by New / Open / Recent file / Exit when dirty.
- [ ] Three buttons: **Save** / **Don't Save** / **Cancel**.
- [ ] **Save** → `file/save` (opens picker if untitled). On
      success, proceeds with the original action.
- [ ] **Don't Save** → proceeds immediately, discarding changes.
- [ ] **Cancel** → aborts the destructive action.

---

## Section 15 — File round-trip parity

This is the highest-value verification — does a `.alo` saved by
`--new-ui` load identically in `--legacy-ui` and vice versa?

- [ ] **Load** vanilla `.alo` in `--new-ui`. **Save As** to a new
      path. **Diff** the bytes against the original. Should be
      identical (or differ only in trivially-equivalent ways —
      e.g. whitespace in metadata).
- [ ] **Load** the `--new-ui`-saved file in `--legacy-ui`.
      Should render identically + show same emitter tree + tracks.
- [ ] **Create** a fresh particle system in `--new-ui`. Add an
      emitter. Save. Load in `--legacy-ui`. Render check.
- [ ] **Open** in both editors. **Make a small mutation** in each
      (e.g. set ground-z + change a track key). **Save** from each.
      Diff. Both should write byte-identical-or-equivalent files.

---

## Section 16 — Known intentional divergences

These are NOT regressions; they're documented design choices from
LT-4 batches. Cross-reference the iteration log entries if needed.

| Item | Legacy behaviour | New-UI behaviour | Source batch |
|---|---|---|---|
| Inline rename | Modal text input | F2 / double-click inline edit | Screen 4 Batch C |
| Tool panels | Multiple modeless windows (Lighting, Bloom, Ground) | Single mutually-exclusive sliding panel | Screen 8 Batch 2 |
| Native ChooseColor dialog | Used by ColorButton everywhere | Replaced with all-React Radix Popover | Screen 7 |
| Recent files menu | File menu submenu | File menu submenu (same) | Batch 3 |
| Status bar | 5-column with cursor coords | 4-column (cursor coords deferred) | Screen 1 |
| Drag/drop reparent | Slot-picker popup if both slots free | Auto-picks lifetime when both free | Screen 4 B3 |
| Skydome custom-slot file picker | Native file picker | Currently no-op (file picker deferred) | Phase 2 + Batch 2 |
| Lock-to combo behaviour | Functional (track aliasing) | Visual only (deferred to small follow-up) | Screen 6 B-β |
| Multi-lane bracket rendering | Multi-lane DPI-aware | Single-lane (overlap accepted) | Screen 4 Batch C |
| Multi-key drag in curve editor | Not in legacy; was a hypothetical | Single-key only | Screen 6 B-β |

---

## Section 17 — Findings summary

Fill in after the walkthrough.

### ✅ Confirmed working

(populate)

### ⚠️ Intentional divergences observed

(cross-reference Section 16)

### ❌ Regressions discovered

(populate; one entry per regression with repro)

### Recommendation

- **Phase 4.2 GO** — all matches or intentional; safe to delete
  legacy chrome.
- **Phase 4.2 BLOCK** — regressions need fixing first.

---

## Post-acceptance

If GO:
1. Phase 4.2 deletes `src/UI/` entirely + legacy `main.cpp` paths.
2. Phase 4.3 updates ROADMAP + CHANGELOG.
3. Phase 4.4 builds the release zip.

If BLOCK:
1. File the regressions as todo entries.
2. Triage: small fixes can land in a polish batch; larger
   regressions become their own dispatches.
3. Re-run the relevant sections of this checklist after fixes.
