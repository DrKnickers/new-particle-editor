# LT-4 UI Overhaul — WM_COMMAND / Accelerator / Dialog / Custom-Control Audit

Generated: 2026-05-16. Source of truth: `src/main.cpp` (8201 lines),
`src/UI/EmitterList.cpp`, `src/Resources/resource.en.h`, `src/Resources/resource.h`
(legacy), `src/mfc_ids.h`, `src/ParticleEditor.en.rc`.

---

## 1. Commands

ID constants come from three headers (all pulled in via `src/resource.h`):

- **en** = `src/Resources/resource.en.h` (current, authoritative)
- **mfc** = `src/mfc_ids.h` (standard MFC aliases, 0xE1xx range)
- **old** = `src/Resources/resource.h` (legacy IDs, still compiled in)

"Trigger" column uses these abbreviations:

- **Menu** = main menu bar (`IDR_MENU1`)
- **Accel** = accelerator table (`IDR_ACCELERATOR1`)
- **Toolbar** = main rebar toolbar (`TOOLBARCLASSNAME`)
- **CtxMenu** = emitter-list right-click context menu (`IDR_EMITTER_CONTEXT_MENU`)
- **NewMenu** = "New Emitter" popup toolbar button (`IDR_NEW_EMITTER_MENU`)
- **CtxMenuGround** = ground-texture picker ListView right-click
- **CtxMenuSkydome** = skydome picker ListView right-click
- **CtxMenuLink** = emitter-list link-group submenu (dynamically built)
- **Inline** = dispatched programmatically (no resource trigger)

| ID | Value | Header | Trigger | Handler (file:line) | Behaviour | Screen |
|---|---|---|---|---|---|---|
| `ID_FILE_NEW` | 0xE100 | mfc | Menu, Accel (Ctrl+N), Toolbar | `src/main.cpp:1501` → `DoCloseFile` + `DoNewFile` | Prompts save-if-dirty then creates a blank particle system | 2 |
| `ID_FILE_OPEN` | 0xE101 | mfc | Menu, Accel (Ctrl+O), Toolbar | `src/main.cpp:1502` → `DoCheckChanges` + `DoOpenFile` | Prompts save-if-dirty then shows open-file dialog | 2 |
| `ID_FILE_SAVE` | 0xE103 | mfc | Menu, Accel (Ctrl+S), Toolbar | `src/main.cpp:1504` → `DoSaveFile` | Saves to current path; falls back to Save As if no path | 2 |
| `ID_FILE_SAVE_AS` | 0xE104 | mfc | Menu | `src/main.cpp:1506` → `DoSaveFile(info, true)` | Shows save-file dialog and saves under chosen path | 2 |
| `ID_FILE_IMPORT_EMITTERS` | 40122 | en | Menu | `src/main.cpp:1505` → `DoImportEmittersFromFile` | Opens Import Emitters dialog (IDD_IMPORT_EMITTERS); appends selected emitters from another .alo to current system | 2 |
| `ID_FILE_EXIT` | 40001 | en | Menu | `src/main.cpp:1503` → `DoCheckChanges` + `DestroyWindow` | Prompts save-if-dirty then closes the main window | 2 |
| `ID_EDIT_UNDO` | 40098 | en | Menu, Accel (Ctrl+Z), Toolbar | `src/main.cpp:1508` → `DoUndo` | Pops the undo stack and restores previous particle-system state | 2 / 3 |
| `ID_EDIT_REDO` | 40099 | en | Menu, Accel (Ctrl+Y / Ctrl+Shift+Z), Toolbar | `src/main.cpp:1509` → `DoRedo` | Re-applies the most recently undone operation | 2 / 3 |
| `ID_EDIT_CUT` | 0xE123 | mfc | Menu, CtxMenu | `src/main.cpp:1511` → `SendMessage(GetFocus(), WM_CUT, …)` | Routes WM_CUT to the focused control (tree label edit) | 2 |
| `ID_EDIT_COPY` | 0xE122 | mfc | Menu, CtxMenu | `src/main.cpp:1510` → `SendMessage(GetFocus(), WM_COPY, …)` | Routes WM_COPY to focused control | 2 |
| `ID_EDIT_PASTE` | 0xE125 | mfc | Menu, CtxMenu | `src/main.cpp:1512` → `SendMessage(GetFocus(), WM_PASTE, …)` | Routes WM_PASTE to focused control | 2 |
| `ID_EDIT_DELETE` | 40049 | en | Menu, CtxMenu | `src/main.cpp:1513` → `SendMessage(GetFocus(), WM_CLEAR, …)` | Routes WM_CLEAR to focused control (deletes selected emitter in tree) | 2 |
| `ID_EDIT_RESCALE` | 40072 | en | Menu | `src/main.cpp:1514–1520` → `RescaleParticleSystem` | Opens Rescale Particle System dialog (IDD_RESCALE_SYSTEM); scales duration + size of entire system | 8 |
| `ID_EDIT_CLEARALLPARTICLES` | 40051 | en | Menu, Accel (Ctrl+Del) | `src/main.cpp:1522–1527` → `engine->Clear()` | Clears all live particle instances from the 3-D viewport immediately | 3 |
| `ID_NEW_EMITTER_ROOT` | 40035 | en | Menu, CtxMenu, NewMenu | `src/main.cpp:1529` → `EmitterList_AddRootEmitter` | Adds a new root-level emitter to the tree | 4 |
| `ID_NEW_EMITTER_LIFETIME` | 40033 | en | Menu, CtxMenu, NewMenu | `src/main.cpp:1530` → `EmitterList_AddLifetimeEmitter` | Adds a lifetime-child emitter under the selected root | 4 |
| `ID_NEW_EMITTER_DEATH` | 40034 | en | Menu, CtxMenu, NewMenu | `src/main.cpp:1531` → `EmitterList_AddDeathEmitter` | Adds a death-child emitter under the selected root | 4 |
| `ID_EMITTER_RENAME` | 40059 | en | Menu, CtxMenu | `src/main.cpp:1532` → `EmitterList_RenameEmitter` | Begins in-place label edit on the selected emitter node | 4 |
| `ID_DELETE_EMITTER` | 40036 | old | Toolbar (EmitterList toolbar) | `src/UI/EmitterList.cpp:3067` → `EmitterList_DeleteEmitter(hWnd)` | Deletes the selected emitter. Toolbar button built at `EmitterList.cpp:3024`; enabled/disabled at line 430. Distinct from `ID_EDIT_DELETE` (40049) which routes `WM_CLEAR` to the focused control | 4 |
| `ID_TOGGLE_EMITTER_VISIBILITY` | 40079 | en | Menu, CtxMenu | `src/main.cpp:1533` → `EmitterList_ToggleEmitterVisibility` | Toggles the visible/hidden state of the selected emitter | 4 |
| `ID_SHOW_ALL_EMITTERS` | 40084 | en | Menu | `src/main.cpp:1534` → `EmitterList_SetAllEmitterVisibility(…, true)` | Makes all emitters visible | 4 |
| `ID_HIDE_ALL_EMITTERS` | 40085 | en | Menu | `src/main.cpp:1535` → `EmitterList_SetAllEmitterVisibility(…, false)` | Hides all emitters | 4 |
| `ID_EMITTERS_RESCALE` | 40074 | old | Menu? (legacy) | `src/main.cpp:1536–1545` → `RescaleEmitter` on `selectedEmitter` | Legacy rescale-emitter handler routed from old menu; same behaviour as `ID_EMITTER_RESCALE` below | 8? |
| `ID_VIEW_SHOWGROUND` | 40020 | en | Menu, Accel (Ctrl+G), Toolbar | `src/main.cpp:1547–1559` | Toggles ground-plane visibility; syncs toolbar check state; enables/disables Ground Z spinner; persists via `WriteShowGround` | 3 |
| `ID_VIEW_DEBUGHEAT` | 40021 | en | Menu, Accel (Ctrl+H), Toolbar | `src/main.cpp:1561–1567` | Toggles engine heat-debug rendering overlay; syncs toolbar check state | 3 |
| `ID_EMITTER_SPAWNER` | 40096 | en | Menu (Emitters→Spawner), Accel (F7) | `src/main.cpp:1569–1571` → `ToggleSpawnerDialog` | Shows/hides the modeless Spawner dialog (IDD_SPAWNER) | 8 |
| `ID_VIEW_BLOOM` | 40112 | en | Menu, Accel (Ctrl+B) | `src/main.cpp:1573–1575` → `ToggleBloomDialog` | Shows/hides the modeless Bloom dialog (IDD_BLOOM) | 8 |
| `ID_VIEW_LIGHTING` | 40183 | en | Menu (View→Lighting…) | `src/main.cpp:1577–1579` → `ToggleLightingDialog` | Shows/hides the modeless Lighting dialog (IDD_LIGHTING) | 8 |
| `ID_VIEW_BLOOM_TOGGLE` | 40113 | en | Toolbar | `src/main.cpp:1581–1598` | Toggles bloom on/off in the engine; persists via `WriteBloomEnabled`; syncs toolbar check button and open Bloom dialog | 3 |
| `ID_SPAWNER_TRIGGER` | 40097 | en | Accel (Ctrl+Space), Inline (spawner dialog button) | `src/main.cpp:1600–1612` → `spawner->Trigger` | In Manual mode fires a single burst from the configured spawn anchor; no-op in Auto mode | 8 |
| `ID_VIEW_PAUSE_PREVIEW` | 40114 | en | Menu, Accel (F8), Toolbar | `src/main.cpp:1614–1630` → `SetPreviewPaused` | Toggles preview simulation pause; syncs toolbar check button; enables/disables step buttons | 3 |
| `ID_VIEW_STEP_1_FRAME` | 40115 | en | Menu, Accel (F9), Toolbar | `src/main.cpp:1632–1634` → `DoStepFrames(info, 1)` | Advances preview by exactly 1 frame when paused | 3 |
| `ID_VIEW_STEP_10_FRAMES` | 40116 | en | Menu, Accel (F10), Toolbar | `src/main.cpp:1636–1638` → `DoStepFrames(info, 10)` | Advances preview by 10 frames when paused | 3 |
| `ID_VIEW_RESET_VIEW_SETTINGS` | 40095 | en | Menu | `src/main.cpp:1640–1723` | After confirmation, resets background colour, ground visibility, ground Z, ground texture, skydome, bloom, lighting, and ChooseColor custom palette to defaults; also resets in-memory spawner state | 8 |
| `ID_VIEW_RESETCAMERA` | 40023 | en | Menu, Accel (Ctrl+Home) | `src/main.cpp:1725–1736` | Resets camera to default position/orientation (`eye=(0,-250,125)`, target=origin, up=Z) | 1 |
| `ID_VIEW_RELOAD_SHADERS` | 40091 | en | Menu, Accel (F6) | `src/main.cpp:1738–1752` → `engine->ReloadShaders()` | Hot-reloads D3D9 shaders; reports success/failure in status bar | 3 |
| `ID_VIEW_RELOAD_TEXTURES` | 40090 | en | Menu, Accel (F5) | `src/main.cpp:1754–1761` → `engine->ReloadTextures()` | Hot-reloads all engine textures; reports in status bar | 3 |
| `ID_HELP_ABOUT` | 40007 | en | Menu | `src/main.cpp:1763–1765` → `ShowAboutDialog` | Shows modal About dialog (IDD_ABOUT) | 2 |
| `ID_MOVE_EMITTER_UP` | 40093 | en | Accel (Alt+Up), CtxMenu, EmitterList toolbar | `src/UI/EmitterList.cpp:3745` → `EmitterList_MoveEmitter(hWnd, -1)` | Moves selected emitter one position up in its sibling list | 4 |
| `ID_MOVE_EMITTER_DOWN` | 40094 | en | Accel (Alt+Down), CtxMenu, EmitterList toolbar | `src/UI/EmitterList.cpp:3746` → `EmitterList_MoveEmitter(hWnd, +1)` | Moves selected emitter one position down in its sibling list | 4 |
| `ID_EMITTER_DUPLICATE` | 40092 | en | CtxMenu | `src/UI/EmitterList.cpp:3737` → `EmitterList_DuplicateEmitter(hWnd)` | Duplicates the selected emitter (no index increment) | 4 |
| `ID_EMITTER_DUPLICATE_INC_INDEX` | 40117 | en | CtxMenu | `src/UI/EmitterList.cpp:3738` → `EmitterList_DuplicateEmitter(hWnd, 1.0f)` | Duplicates selected emitter and increments the trailing numeric index by 1 | 4 |
| `ID_EMITTER_DUPLICATE_INC_INDEX_N` | 40118 | en | CtxMenu | `src/UI/EmitterList.cpp:3739–3744` → `ShowIncrementDialog` + `EmitterList_DuplicateEmitter` | Opens IDD_INCREMENT_INDEX dialog to choose N, then duplicates with index incremented by N | 4 |
| `ID_PASTEAS_LIFETIME` | 40068 | en | CtxMenu | `src/UI/EmitterList.cpp:3747` → `PasteEmitter(…, &EmitterList_AddLifetimeEmitter)` | Pastes clipboard emitter as a lifetime-child of the selected emitter | 4 |
| `ID_PASTEAS_DEATH` | 40069 | en | CtxMenu | `src/UI/EmitterList.cpp:3748` → `PasteEmitter(…, &EmitterList_AddDeathEmitter)` | Pastes clipboard emitter as a death-child of the selected emitter | 4 |
| `ID_EMITTER_RESCALE` | 40076 | en | Menu (Emitters→Rescale Emitter), CtxMenu | `src/UI/EmitterList.cpp:3751–3755` → `RescaleEmitter` | Opens IDD_RESCALE_EMITTER dialog; scales duration + size of selected emitter | 8 |
| `ID_REPARENT_AS_LIFETIME` | 40110 | en | EmitterList reparent popup (inline) | `src/UI/EmitterList.cpp:1433` | Reparents dragged emitter as a lifetime-child of the drop target | 4 |
| `ID_REPARENT_AS_DEATH` | 40111 | en | EmitterList reparent popup (inline) | `src/UI/EmitterList.cpp:1434` | Reparents dragged emitter as a death-child of the drop target | 4 |
| `ID_EMITTER_LINK_REMOVE` | 40119 | en | CtxMenuLink | `src/UI/EmitterList.cpp:3758–3780` → `LeaveLinkGroup` | Removes the selected emitter from its link group (may auto-dissolve if only 2 members remain) | 4 |
| `ID_EMITTER_LINK_DISSOLVE` | 40120 | en | CtxMenuLink | `src/UI/EmitterList.cpp:3782–3806` → `DissolveLinkGroup` | Dissolves the entire link group; all members become independent | 4 |
| `ID_EMITTER_LINK_SELECTED` | 40121 | en | CtxMenuLink | `src/UI/EmitterList.cpp:3834–3939` → `CreateLinkGroup` | Creates a new link group from the current multi-selection set (≥2 unlinked emitters) | 4 |
| `ID_EMITTER_LINK_GROUP_SETTINGS` | 40160 | en | CtxMenuLink | `src/UI/EmitterList.cpp:3808–3832` → `ShowLinkGroupSettings` | Opens IDD_LINK_GROUP_SETTINGS modal; configures per-group exempt fields | 4 / 8 |
| `ID_EMITTER_LINK_WITH_FIRST`…`ID_EMITTER_LINK_WITH_LAST` | 40130–40144 | en | CtxMenuLink (dynamic) | `src/UI/EmitterList.cpp:3939–3992` | Dynamic range: "Link with <emitter N>" — pairs the selected emitter with one of the nearest unlinked emitters | 4 |
| `ID_EMITTER_LINK_ADD_FIRST`…`ID_EMITTER_LINK_ADD_LAST` | 40145–40159 | en | CtxMenuLink (dynamic) | `src/UI/EmitterList.cpp:3993–4030` | Dynamic range: "Add to group <G>" — adds selected emitter to an existing link group | 4 |
| `ID_GROUND_SLOT_SET_CUSTOM` | 40180 | en | CtxMenuGround | `src/main.cpp:4141–4147` → `GroundTexturePicker_PickCustomFile` | Opens file picker to assign a custom texture to the right-clicked ground slot | 8 |
| `ID_GROUND_SLOT_RESET_BUNDLED` | 40181 | en | CtxMenuGround | `src/main.cpp:4148–4156` → slot reset + `GroundTexturePicker_RefreshList` | Reverts a custom ground-texture slot back to its bundled default | 8 |
| `ID_GROUND_SLOT_CLEAR_CUSTOM` | 40182 | en | CtxMenuGround | `src/main.cpp:4148–4156` → slot clear + `GroundTexturePicker_RefreshList` | Clears the custom path for the right-clicked ground-texture slot | 8 |
| `ID_SKYDOME_SLOT_SET_CUSTOM` | 40200 | en | CtxMenuSkydome | `src/main.cpp:5103–5107` → `SkydomePicker_PickCustomFile` | Opens file picker to assign a custom skydome to the right-clicked slot | 8 |
| `ID_SKYDOME_SLOT_CHANGE_CUSTOM` | 40201 | en | CtxMenuSkydome | `src/main.cpp:5103–5107` → `SkydomePicker_PickCustomFile` | Opens file picker to change an already-assigned custom skydome slot | 8 |
| `ID_SKYDOME_SLOT_CLEAR_CUSTOM` | 40202 | en | CtxMenuSkydome | `src/main.cpp:5108–5120` → slot clear + `SkydomePicker_RefreshList` | Clears the custom skydome path for the right-clicked slot | 8 |

**Note on `ID_EMITTERS_RESCALE` (40074, old header):** This legacy ID still has a live handler in `src/main.cpp:1536`. It duplicates the behaviour of `ID_EMITTER_RESCALE` (40076). No current `.en.rc` menu item points to 40074; it may fire only if a stale accelerator or hotkey from the old `.rc` is still loaded at runtime.

---

## 2. Accelerators

Source: `IDR_ACCELERATOR1` block in `src/ParticleEditor.en.rc:508–530`.
Loaded via `LoadAccelerators` at `src/main.cpp:7913`; translated in the message loop at `src/main.cpp:7964`.

| Combo | Maps to ID | Behaviour |
|---|---|---|
| Ctrl+Del | `ID_EDIT_CLEARALLPARTICLES` | Clears all live particle instances from the viewport |
| Ctrl+N | `ID_FILE_NEW` | New particle system (prompts save-if-dirty) |
| Ctrl+O | `ID_FILE_OPEN` | Open file dialog (prompts save-if-dirty) |
| Ctrl+S | `ID_FILE_SAVE` | Save current file |
| Ctrl+H | `ID_VIEW_DEBUGHEAT` | Toggle heat-debug overlay |
| Ctrl+Home | `ID_VIEW_RESETCAMERA` | Reset camera to default position |
| Ctrl+G | `ID_VIEW_SHOWGROUND` | Toggle ground-plane visibility |
| F5 | `ID_VIEW_RELOAD_TEXTURES` | Hot-reload all engine textures |
| F6 | `ID_VIEW_RELOAD_SHADERS` | Hot-reload D3D9 shaders |
| Alt+Up | `ID_MOVE_EMITTER_UP` | Move selected emitter up in the tree |
| Alt+Down | `ID_MOVE_EMITTER_DOWN` | Move selected emitter down in the tree |
| F7 | `ID_EMITTER_SPAWNER` | Toggle Spawner dialog |
| Ctrl+Space | `ID_SPAWNER_TRIGGER` | Fire a manual spawn burst |
| Ctrl+Z | `ID_EDIT_UNDO` | Undo last operation |
| Ctrl+Y | `ID_EDIT_REDO` | Redo last undone operation |
| Ctrl+Shift+Z | `ID_EDIT_REDO` | Redo (alternate chord) |
| Ctrl+B | `ID_VIEW_BLOOM` | Toggle Bloom dialog |
| F8 | `ID_VIEW_PAUSE_PREVIEW` | Pause/resume preview simulation |
| F9 | `ID_VIEW_STEP_1_FRAME` | Step preview forward 1 frame (while paused) |
| F10 | `ID_VIEW_STEP_10_FRAMES` | Step preview forward 10 frames (while paused) |

**Direct WM_KEYDOWN handlers (not accelerator-table entries):**

| Key | Location | Context | Behaviour |
|---|---|---|---|
| Shift (initial press) | `src/main.cpp:2842–2854` | Render window (`WM_KEYDOWN`) | Spawns a cursor-bound particle-system instance at 3-D cursor position |
| Escape | `src/main.cpp:4236–4244` | `GroundTexturePickerProc WM_KEYDOWN` | Hides the ground-texture picker dialog |
| Escape | `src/main.cpp:5189–5196` | `SkydomePickerProc WM_KEYDOWN` | Hides the skydome picker dialog |

---

## 3. Dialogs

| Dialog name | Template ID | Trigger ID / trigger mechanism | DialogProc (file:line) | Behaviour | Screen |
|---|---|---|---|---|---|
| About | `IDD_ABOUT` (101) | `ID_HELP_ABOUT` → `ShowAboutDialog` | `src/main.cpp:390` `AboutProc` | Modal. Shows version, build date, license text, expat copyright | 2 |
| Rescale Particle System | `IDD_RESCALE_SYSTEM` (141) | `ID_EDIT_RESCALE` → `RescaleParticleSystem` | `src/Rescale.cpp` (called from `src/main.cpp:1515`) | Modal. Two spinners: duration scale % and size scale %. Applies to entire system on OK | 8 |
| Rescale Emitter | `IDD_RESCALE_EMITTER` (142) | `ID_EMITTER_RESCALE` / `ID_EMITTERS_RESCALE` → `RescaleEmitter` | `src/Rescale.cpp` (called from `src/main.cpp:1539`, `src/UI/EmitterList.cpp:3752`) | Modal. Two spinners: duration scale % and size scale %. Applies to selected emitter on OK | 8 |
| Spawner | `IDD_SPAWNER` (150) | `ID_EMITTER_SPAWNER` → `ToggleSpawnerDialog` | `src/main.cpp:5814` `SpawnerDlgProc` | Modeless tool window. Configures spawn mode (Manual/Auto), burst size, spacing, interval, position/velocity/jitter spinners, lifetime. Manual mode shows "Spawn now" button (fires `ID_SPAWNER_TRIGGER`) | 8 |
| Bloom | `IDD_BLOOM` (151) | `ID_VIEW_BLOOM` → `ToggleBloomDialog` | `src/main.cpp:5977` `BloomDlgProc` | Modeless tool window. Enable bloom checkbox, strength/cutoff/size spinners. Changes take effect immediately on the engine | 8 |
| Lighting | `IDD_LIGHTING` (153) | `ID_VIEW_LIGHTING` → `ToggleLightingDialog` | `src/main.cpp:6564` `LightingDlgProc` | Modeless tool window. Sun intensity/angles, ambient/specular/diffuse/shadow colour pickers; Fill1 + Fill2 intensity/angles/diffuse colour pickers; Force Align checkbox; Mirror Sun button; Reset button | 8 |
| Ground Texture Picker | `IDD_GROUND_TEXTURE_PICKER` (180) | `hGroundTexturePreview` BN_CLICKED → `ShowGroundTexturePicker` | `src/main.cpp:3789` `GroundTexturePickerProc` | Modeless. ListView with 12 ground-texture slots (6 bundled + 6 custom). Click commits selection to engine. Right-click context menu: Set Custom, Reset Bundled, Clear Custom | 8 |
| Skydome / Background Picker | `IDD_SKYDOME_PICKER` (160) | `hBackgroundBtn` BN_CLICKED → `ShowSkydomePicker` | `src/main.cpp:4953` `SkydomePickerProc` | Modeless. ListView with slots: slot 0 = solid colour picker, slots 1+ = skydome thumbnails (bundled + custom). Click commits selection to engine | 8 |
| Import Emitters | `IDD_IMPORT_EMITTERS` (190) | `ID_FILE_IMPORT_EMITTERS` → `DoImportEmittersFromFile` | `src/main.cpp:7368` `ImportEmittersDialogProc` | Modal. Browse for .alo file, tree-view of its emitters, "Include children automatically" checkbox, Select All / Clear. Appends selected emitters to current system on OK | 2 / 4 |
| Set Mod Nickname | `IDD_MOD_NICKNAME` (145) | Internal — triggered when a file with an unknown mod-data path is opened | `src/main.cpp:7069` `NicknameDialogProc` | Modal. Single text field. User assigns a human-readable nickname for the unrecognised mod's data directory | 1 |
| Link Group Settings | `IDD_LINK_GROUP_SETTINGS` (170) | `ID_EMITTER_LINK_GROUP_SETTINGS` → `ShowLinkGroupSettings` | `src/UI/EmitterList.cpp:2781` `LinkGroupSettingsProc` | Modal. ListBox of per-field exempt overrides for the group. Reset All button. OK commits exemptions | 4 / 8 |
| Link Group Disagreement | `IDD_LINK_GROUP_DISAGREEMENT` (171) | Shown automatically during import when intra-group field values disagree | DialogProc: *unimplemented* — resource template exists in `.en.rc` and `.de.rc` but no handler in any `.cpp` | Modal (intended). Resource-only stub; dialog cannot be shown at runtime | ? |
| Increment Index | `IDD_INCREMENT_INDEX` (152) | `ID_EMITTER_DUPLICATE_INC_INDEX_N` → `ShowIncrementDialog` | Inline in `src/UI/EmitterList.cpp:3741` | Modal. Single integer spinner; user enters N for "duplicate + increment index by N" | 4 |
| Track Editor | `IDD_TRACK_EDITOR` (108) | Created as child control inside emitter props tab | `src/UI/TrackEditor.cpp:35` `TrackDialogProc` | Child dialog embedded in the emitter property panel. Hosts the CurveEditor + lock-to combo + toolbar | 5 / 6 |
| Random Parameters | `IDD_RANDOM_PARAMETERS` (106) | Embedded child in emitter property panels | (win32 dialog, no separate named proc — managed by RandomParam custom control) | Child dialog hosting the RandomParam control UI (param type combo, spinners) | 7 |
| Emitter Properties 1–3 | `IDD_EMITTER_PROPS1` (116), `IDD_EMITTER_PROPS2` (117), `IDD_EMITTER_PROPS3` (118) | Tabs inside the main property panel; managed by the Emitter UI subsystem | `src/UI/Emitter.cpp` | Child dialogs for the three property tab pages (Basic, Appearance, Physics). Each hosts form-field primitives | 7 |
| Emitter List | `IDD_EMITTER_LIST` (136) | Created at startup as a child of the main window | `src/UI/EmitterList.cpp` | Child dialog backing the emitter-tree custom control | 4 |

---

## 4. Custom Controls

| Control | File | LOC | Purpose |
|---|---|---|---|
| `EmitterList` | `src/UI/EmitterList.cpp` | 4955 | Win32 custom control. Hosts a TreeView of all emitters plus a toolbar (New/Delete/Toggle/Show/Hide/MoveUp/MoveDown). Manages drag-drop reorder, multi-select for link groups, context-menu dispatch, and in-place rename. Sends `ELN_*` notifications to main.cpp |
| `CurveEditor` | `src/UI/CurveEditor.cpp` | 1044 | Win32 custom control. Renders an editable bezier/linear/step curve for a single track channel. Handles key insert/delete/move via toolbar buttons and mouse drag. Owner-drawn |
| `TrackEditor` | `src/UI/TrackEditor.cpp` | 483 | Child-dialog wrapper for the CurveEditor. Adds a "Lock to" channel combo, time/value readout spinners (`IDC_SPINNER1`, `IDC_SPINNER2`), and a toolbar for key-editing mode buttons. Registered as `"CurveEditor"` window class containing the actual curve paint |
| `Spinner` | `src/UI/Spinner.cpp` | 583 | Win32 custom control. An up-down spinner with an embedded edit box; supports integer and float modes, configurable min/max/step, and three-button mouse support. Used everywhere in property forms |
| `ColorButton` | `src/UI/ColorButton.cpp` | 189 | Win32 custom control. An owner-drawn button that shows the currently selected colour swatch. Clicking opens ChooseColor (system dialog). Supports a global 16-slot custom-colour palette shared across all instances |
| `TexturePalette` | `src/UI/TexturePalette.cpp` | 1019 | Win32 modeless popup window (not registered as a dialog). ListView-style grid showing thumbnail previews of all textures found in the mod's texture directories. Supports colour/bump filter radios and pin-slot feature (up to 8 pinned) |
| `RandomParam` | `src/UI/RandomParam.cpp` | 269 | Win32 custom control. Wraps a `RandomParameter` value (Exact / Box / Sphere / Cube / Cylinder). Exposes a type combo and up to six spinners depending on type. Backed by `IDD_RANDOM_PARAMETERS` |
| `PaletteStore` | `src/UI/PaletteStore.cpp` | 563 | Non-visual helper. Manages the persistence layer for the TexturePalette (scans directories, caches thumbnail bitmaps, handles pin-slot state). Not a Win32 control; used as a data layer by TexturePalette |
| `Emitter` (UI) | `src/UI/Emitter.cpp` | 873 | Manages the three emitter property tab-pages (`IDD_EMITTER_PROPS1/2/3`). Populates form fields from a selected `ParticleSystem::Emitter` and writes changes back. Orchestrates the embedded TrackEditor, RandomParam, Spinner, ColorButton, and TexturePalette controls |
