# [MT-1] Frequently-used textures palette

**Status (2026-05-14):** plan draft, awaiting user approval. Target PR: `feat/mt1-textures-palette`.

Follows the planning conventions established for MT-2 / MT-9 / MT-10: Context block, per-artefact Architecture subsections, named tripwires per risk, verifier-first Verification where each row says *what regression it catches*.

---

## Status of the surrounding work

- ✅ **[MT-2]** Selectable ground texture — [#67](https://github.com/DrKnickers/new-particle-editor/pull/67)
- 🚧 **[MT-1]** Frequently-used textures palette — **this plan**.

Medium-term queue after MT-1: MT-3 (skydome), MT-4 (env lighting).

---

## Context

Texture editing on the Appearance tab (`IDD_EMITTER_PROPS2`) currently has two slots — Color (`IDC_EDIT2`/`IDC_BUTTON1`) and Bump (`IDC_EDIT3`/`IDC_BUTTON2`) — each a filename edit field plus a "..." button that opens `GetOpenFileNameA` filtered to `*.tga;*.dds`. The chosen file's basename is stored in the emitter (`colorTexture` / `normalTexture` strings). Texture *resolution* at render time goes through `FileManager` against the active mod path. The mod path itself persists per-user via `HKCU\Software\AloParticleEditor\LastMod`.

The painful workflow this plan addresses: when iterating on an effect, modders typically cycle between a small set of textures from the same mod's `Data\Art\Textures` directory. Today every swap is a full file-picker round-trip — open dialog, navigate the tree, click, OK. Even with the picker remembering the last directory, that's 3–5 seconds per swap and breaks flow.

MT-1 surfaces a small per-mod palette of recently-used and explicitly-pinned textures. A new palette button in the Textures groupbox header (top-right corner of the existing group) toggles a **modeless sticky popup window** that holds the palette UI. The popup stays open across emitter selections, repositions are remembered per user, and the button reflects open/closed state. Double-click a thumbnail → texture slot is filled. Recents auto-populate from any successful texture load (file picker, edit-field commit, or palette click); pins are explicit (hover star). Per-mod scoping ensures switching between Empire at War, Republic at War, etc. doesn't cross-contaminate the palettes.

Putting the palette in a popup rather than inline avoids growing the Appearance tab's dialog template — which would have required cascading layout changes through the EmitterProps host window and the surrounding main-window layout. The popup's own size budget is independent, so thumbnails and labels can size cleanly without fighting other controls.

**Why now**: smallest medium-term item, contained, doesn't touch the rendering pipeline or file format. Clears MT-1 out of the queue and leaves only the larger MT-3 (skydome, ~8–14 h) and MT-4 (env lighting, ~4–6 h) ahead.

---

## Goal + scope

A new small **palette button** sits in the right side of the Textures groupbox header on the Appearance tab. Clicking it toggles a **modeless popup window** ("AloTexturePalettePopup") that holds the palette UI: a Color/Bump filter toggle at the top, a row of pinned texture thumbnails, and a row of recent texture thumbnails. Double-clicking a thumbnail writes its filename to the active filter's slot (color or bump). Single-click selects (highlight only). Hovering a thumbnail reveals a small star-corner button that toggles pinned state. Each entry's metadata records which slot(s) it has been used as (color, bump, or both), and only entries matching the active filter are shown.

The popup is sticky (does not auto-close on outside click or after a commit), can be moved anywhere on screen, and remembers its position across editor sessions. The button's visual state (pressed vs. raised) reflects whether the popup is currently visible. Closing the popup via its X button, pressing Esc with focus inside it, or clicking the (pressed) palette button hides it.

Palette state — pins, recents, last-used filter — persists per mod in a single INI file at `%APPDATA%\AloParticleEditor\texture-palettes.ini`, keyed by SHA1 of the absolute mod path. The popup's window position persists separately in the same INI under a `[ui]` section. Switching mods (via the existing mods menu) swaps the palette automatically while the popup remains open.

Thumbnail decoding goes through D3DX9 (already used by the engine) — `D3DXCreateTextureFromFileEx` decodes TGA/DDS at the requested 32×32 size, and we copy the surface pixels into a `CreateDIBSection` HBITMAP for the owner-draw control. Decoded HBITMAPs live in a per-session in-memory cache keyed by absolute file path; missing or unreadable files fall back to a "broken" placeholder thumbnail.

**In:**

- **New `IDC_BUTTON_PALETTE`** in the Textures groupbox header (`IDD_EMITTER_PROPS2`), positioned at roughly (170, 1) sized ~24×10 du — overlapping the right side of the group's title bar in the canonical Windows pattern. Style: `BS_BITMAP | BS_PUSHLIKE | BS_AUTOCHECKBOX` so the pressed state is visible and Win32 manages the toggle. Label: a **16×16 px painter's-palette BMP resource** (`IDB_PALETTE_GLYPH`) — kidney-shaped palette silhouette with thumb hole and a few coloured paint blobs. Tooltip "Texture palette".
- **New top-level window class `"AloTexturePalettePopup"`**, registered once at startup. Owned by the main editor window so it dies with the editor. Window styles: `WS_POPUPWINDOW | WS_CAPTION | WS_THICKFRAME` (resizable in a future PR; v1 fixed-size). No taskbar entry (`WS_EX_TOOLWINDOW`).
- **Popup contents** (laid out top to bottom):
  - Filter row: two radio buttons "Color" / "Bump", default "Color". Selection persisted per-mod.
  - Pinned row: up to 8 thumbnails (32×32) with a small "Pinned" label.
  - Recent row: up to 8 thumbnails with a small "Recent" label.
  - **Status strip** at bottom: single-line `SS_LEFT` static control (`IDC_PALETTE_STATUS`), hidden text by default. Used for transient feedback like "Pins full (8). Unpin one to make room." Always allocated 14 px of vertical space (no layout shift when shown). Text cleared by `WM_TIMER` after 3000 ms.
  - Total fixed size: ~280×136 px (16 px margin + 12 px filter row + 16 px label + 32 px thumb row + 16 px label + 32 px thumb row + 14 px status strip + 2 px margin).
- **Pin overflow handling**: when the user clicks the star on a 9th pin (capacity 8 already reached), the click is **rejected** — new entry stays as a recent. Status strip shows `IDS_PALETTE_PINS_FULL` ("Pins full (8). Unpin one to make room.") for 3 seconds, then auto-clears. Pin semantics preserved — deliberately-pinned textures are never silently dropped.
- **Button toggle behavior**: clicking the button when popup is hidden shows it (positioned at remembered location, or button-anchored default if first run); clicking when shown hides it and saves position. Closing the popup via X or Esc also depresses the button.
- **Click model in popup**: single-click selects (visible selection border on the thumbnail); double-click writes to the slot matching the current filter. Selection clears on filter change.
- **Star-corner pin gesture**: a 10×10 px star icon appears in the top-right corner of any thumbnail under the mouse cursor. Click toggles pinned state. Recent entries pinned this way migrate to the pins row; pinned entries unpinned drop out of pins (and back into recents if recently used, otherwise gone).
- **Auto-recent tracking**: any successful texture load — file picker via "..." button, edit-field commit (lines 358–359 of `Emitter.cpp`), or palette double-click — adds the filename to recents with the appropriate `isColor` / `isBump` flag set. Touching an existing recent moves it to position 0 (LRU).
- **Recents eviction**: when a 9th distinct recent arrives for the active filter, the oldest is dropped.
- **Per-mod isolation**: palette INI is keyed by SHA1 of the same mod path string `LastMod` writes. Mod switch (via `RebuildModsMenu` flow) triggers `PaletteStore::SetActiveMod(newPath)` which loads the new mod's palette from INI and posts a refresh message to the popup if visible.
- **Position memory**: popup window position persists in the INI's `[ui]` section as `PopupX=`, `PopupY=` (in screen coordinates). On show, position is validated against `MonitorFromPoint(MONITOR_DEFAULTTONULL)`; if no monitor contains the point, fall back to button-anchored default (just below the palette button in screen coords).
- **Thumbnail cache**: in-memory `unordered_map<string, HBITMAP>` keyed by absolute texture path. Populated lazily on first paint of an entry. Cleared on app shutdown (HBITMAPs deleted via `DeleteObject`).
- **Placeholder thumbnails** for: (a) failed decode (a 32×32 magenta-with-X bitmap generated procedurally on first need), (b) file-not-found (a greyed-out variant of the same).
- **Reset View Settings (`ID_VIEW_RESET_VIEW_SETTINGS`) integration**: the existing handler that clears `BackgroundColor` / `ShowGround` / `GroundZ` / `GroundTexture` is extended to also delete the active mod's palette INI section (not the whole file — other mods' palettes survive, and the `[ui]` popup-position section survives). Palette in the popup re-renders empty.
- **Debug instrumentation** under `#ifndef NDEBUG`: `[Palette] touch recent name='%s' slot=%s`, `[Palette] toggle pin name='%s' newState=%s`, `[Palette] thumbnail decode failed path='%s' fallback=placeholder`, `[Palette] mod switch from='%s' to='%s' loadedEntries=%d`, `[Palette] popup show pos=(%d,%d)`, `[Palette] popup hide pos=(%d,%d)`, `[Palette] popup position invalid (off-screen) snapping to default`.

**Out:**

- **Inline panel embedded in the Appearance tab.** *Reason: explicitly superseded by the popup approach — eliminates dialog-template growth and cascading layout work.*
- **Anchored dropdown (auto-close on outside-click).** *Reason: explicitly skipped per the design discussion — the multi-swap workflow benefits from sticky behavior.*
- **Modal popup.** *Reason: same — modal blocks viewport interaction, defeating the "see the texture render while picking" workflow.*
- **Resizable popup.** *Reason: v1 is fixed-size; the 8+8 capacity makes resizing low-value. `WS_THICKFRAME` is reserved in styles for future use without an API change.*
- **Docking the popup against the main editor.** *Reason: floating-only is simpler. If users keep dragging it to the same spot, position memory makes that one-time. Docking is a follow-up if asked for.*
- **On-disk thumbnail cache (cached PNGs in AppData).** *Reason: synchronous in-memory cache covers the dominant case (palette stable within a session). Cold-start cost is bounded — 16 thumbnails × ~10 ms decode each ≈ 160 ms once per popup open. If anyone reports it as slow, this becomes a follow-up PR.*
- **Async / threaded thumbnail decoding.** *Reason: same as above. Synchronous + cache is fast enough; threading adds failure modes (D3D9 device thread affinity, cache invalidation races) for negligible benefit at this capacity.*
- **Drag-and-drop pinning** (drag a recent into the pins row). *Reason: the hover-star gesture is sufficient. DnD adds OLE drop-target wiring for one ergonomic win that doesn't justify the cost.*
- **Larger thumbnail-on-hover preview tooltip.** *Reason: explicitly skipped per the design discussion — selection highlight only is the chosen UX.*
- **Live preview in the 3D viewport on single-click.** *Reason: explicitly skipped per the design discussion — would require a transient texture state + revert path in the engine, outside MT-1's scope.*
- **Capacity beyond 8 + 8 per filter, or scrolling.** *Reason: 8 each is the chosen capacity. Two rows of 8 fit cleanly without scroll. If the cap proves too tight, raising it is a one-line change in a follow-up.*
- **Heuristic auto-classification of entries as color vs bump from filename.** *Reason: tagging via slot-of-use is unambiguous. Filename heuristics (`_normal`, `_depth`, `_bump`) are unreliable across modder conventions and would surprise users when wrong.*
- **Export / import palette INI via UI.** *Reason: file lives in AppData; users who want to share can copy it manually.*

---

## What we already have

| Piece | File:line |
|---|---|
| Texture slot edit fields + "..." buttons on Appearance tab | [src/UI/Emitter.cpp:328](src/UI/Emitter.cpp:328)–335, [src/UI/Emitter.cpp:358](src/UI/Emitter.cpp:358)–359 |
| `LoadTexture` file-picker helper | [src/UI/Emitter.cpp:67](src/UI/Emitter.cpp:67)–88 |
| `IDD_EMITTER_PROPS2` dialog template (the Appearance tab) — Textures groupbox at (0,4,197,67) | [src/ParticleEditor.en.rc:287](src/ParticleEditor.en.rc:287)–334 |
| EmitterProps window class + tab pages creation | [src/UI/Emitter.cpp:466](src/UI/Emitter.cpp:466)–512 |
| Emitter texture fields | `colorTexture`, `normalTexture` (strings) on `ParticleSystem::Emitter` ([src/ParticleSystem.cpp:269](src/ParticleSystem.cpp:269), 287, 481, 502) |
| `ReadLastMod` / `WriteLastMod` registry pattern | [src/main.cpp:2967](src/main.cpp:2967)–2993 |
| Mod-switch flow that updates `FileManager::SetModPath` | [src/main.cpp:4719](src/main.cpp:4719)–4727 |
| `LastMod` restoration on startup | [src/main.cpp:4941](src/main.cpp:4941)–4945 |
| `Reset View Settings` handler (sweeps registry view-settings) | [src/main.cpp:1566](src/main.cpp:1566)–~1606, [src/main.cpp:3075](src/main.cpp:3075) |
| `FileManager` (resolves texture filenames against the mod path) | [src/managers.cpp](src/managers.cpp), [src/managers.h](src/managers.h) |
| D3DX9 texture loading (TGA/DDS supported) | engine uses `D3DXCreateTextureFromFile*` for ground texture ([src/engine.cpp:1126](src/engine.cpp:1126)) — same APIs work for thumbnails |
| UndoStack (used elsewhere for emitter edits) | [src/UndoStack.h](src/UndoStack.h) — palette writes should integrate consistent with how typed/file-picker writes do today |
| Existing custom child-control patterns | `Spinner`, `ColorButton` registered window classes — see [src/UI/Spinner.cpp](src/UI/Spinner.cpp), [src/UI/ColorButton.cpp](src/UI/ColorButton.cpp) — pattern reused for the palette content control |

**Not yet in the codebase — to add:**

- **`src/UI/TexturePalette.{h,cpp}`** — new module. Owns:
  - `PaletteStore` singleton (in-memory state + INI persistence).
  - `RegisterTexturePaletteContentClass` / `RegisterTexturePalettePopupClass` — the inner owner-draw thumbnail control plus the outer popup window class.
  - `PaletteStore::TouchRecent(string filename, SlotKind slot)`, `TogglePin(string filename)`, `SetActiveMod(string modPath)`, `Filter(SlotKind)`, `Get()` accessors.
  - `PalettePopup::Show(HWND owner, POINT defaultPos)`, `PalettePopup::Hide()`, `PalettePopup::IsVisible()`, `PalettePopup::SetOnVisibilityChanged(callback)`.
- **INI I/O** for palette persistence. `WritePrivateProfileStringW` family — already available, no new dependency.
- **Thumbnail decoder** (`TexturePaletteThumbCache`): D3DX9 → DIB section → HBITMAP. Lives alongside `TexturePalette.cpp`.
- **`IDC_BUTTON_PALETTE` control ID** + button addition in [src/ParticleEditor.en.rc:287](src/ParticleEditor.en.rc:287).
- **`IDB_PALETTE_GLYPH`** — new 16×16 px BMP resource: painter's-palette icon (kidney outline with thumb hole + 4–5 paint blobs in red/blue/yellow/green/white). Hand-authored bitmap added to `src/Resources/`.
- **`IDC_PALETTE_STATUS`** static control inside the popup for transient feedback messages.
- **`IDS_PALETTE_PINS_FULL`** string: "Pins full (8). Unpin one to make room."
- **Hooks into `Emitter.cpp`** at:
  - `IDC_BUTTON_PALETTE` handler — toggle popup visibility.
  - The three existing texture-write points (`LoadTexture` callers `IDC_BUTTON1`/`2`, `EN_CHANGE` on `IDC_EDIT2`/`3`) → call `PaletteStore::TouchRecent`.
  - Custom notify code from popup → `PALETTE_NM_COMMIT` writes to the active emitter's slot.
- **Hook into mod-switch flow** in `main.cpp`: when `WriteLastMod(modPath)` runs ([src/main.cpp:4725](src/main.cpp:4725)), also call `PaletteStore::SetActiveMod(modPath)`.
- **Hook into startup** in `main.cpp`: after `ReadLastMod()` restores the mod ([src/main.cpp:4943](src/main.cpp:4943)–4945), call `PaletteStore::SetActiveMod(savedMod)`. Register the popup window class once at app init.
- **Hook into `Reset View Settings`** to clear the active mod's palette INI section.
- **Two new strings**: `IDS_PALETTE_FILTER_COLOR`, `IDS_PALETTE_FILTER_BUMP` (plus `IDS_PALETTE_PINS_FULL` noted above).

*(All design questions resolved — see "Resolved decisions" at the bottom of the spec.)*

---

## Architecture / implementation approach

### A. Data model

```cpp
// src/UI/TexturePalette.h

enum class PaletteSlot : uint8_t { Color = 1 << 0, Bump = 1 << 1 };

struct PaletteEntry
{
    std::string filename;     // e.g. "p_smoke_01.tga" — the basename, exactly as stored in emitter
    bool        isPinned;     // true ⇒ shown in pins row, false ⇒ recents row
    uint8_t     slotMask;     // bit 0 = used as color, bit 1 = used as bump
    uint64_t    lastUsedNs;   // monotonic clock, used for recents LRU sort
};

class PaletteStore
{
public:
    static PaletteStore& Instance();

    // Mod lifecycle
    void SetActiveMod(const std::wstring& modPath);   // loads INI section if present
    void ClearActiveMod();                             // wipes in-memory; called on Reset View Settings
    const std::wstring& ActiveMod() const;

    // Filter (persisted per mod)
    PaletteSlot ActiveFilter() const;
    void        SetActiveFilter(PaletteSlot);

    // Mutations — each writes to disk before returning
    void TouchRecent(const std::string& filename, PaletteSlot usedAs);
    void TogglePin (const std::string& filename);
    void RemoveRecent(const std::string& filename);

    // Read access for the popup's WM_PAINT
    std::vector<PaletteEntry> Pins   (PaletteSlot filter) const;
    std::vector<PaletteEntry> Recents(PaletteSlot filter) const;

    // Popup window position (separate from per-mod state)
    POINT GetPopupPos(POINT fallback) const;
    void  SetPopupPos(POINT pos);

private:
    std::wstring                                 m_activeMod;
    std::unordered_map<std::wstring, ModPalette> m_byMod;   // loaded lazily
    POINT                                        m_popupPos { -1, -1 };  // INI-persisted
};
```

`PaletteStore` is a singleton because it's a process-global cache shared across the Emitter properties window, the popup, and the mod-switch flow in `main.cpp`. Lifetime matches the process. No threading — all access from the UI thread.

### B. Persistence schema (INI)

File: `%APPDATA%\AloParticleEditor\texture-palettes.ini`

```ini
[ui]
PopupX=120
PopupY=240

[mod=<sha1-hex-of-active-mod-path>]
Path=C:\Mods\RepublicAtWar
Filter=Color
PinCount=3
Pin0=p_smoke_01.tga|color
Pin1=p_dust_norm.tga|bump
Pin2=p_explosion_master.tga|color,bump
RecentCount=4
Recent0=p_spark_white.tga|color|2026-05-14T19:32:11Z
Recent1=…
```

Choices:
- **`[ui]` section** holds cross-mod editor UI state (currently just popup position). Survives Reset View Settings (which only wipes per-mod sections).
- **Mod section key** = `mod=<sha1>` so that arbitrary path characters (drive letters, UNC, spaces, accents) don't break INI parsing. The `Path=` line preserves the human-readable original for debugging.
- **`Pin*` lines have no timestamp** because pins are user-ordered (insertion order, oldest first). **`Recent*` lines do** because order is "most recent first" and we may want to debug LRU ordering.
- **Slot mask** is encoded as `color`, `bump`, or `color,bump`.
- **`PinCount` / `RecentCount`** make round-tripping safe even if the file is hand-edited and a `Pin5` line gets deleted.

INI was chosen over JSON to avoid a new third-party dependency and to keep the persistence code small (~80 LOC using `Get/WritePrivateProfileStringW`).

### C. Thumbnail pipeline

```
filename ──► resolve to absolute path via FileManager
              │
              ├─ found ──► D3DXCreateTextureFromFileEx(width=32, height=32,
              │              format=D3DFMT_A8R8G8B8) ──► IDirect3DTexture9
              │              │
              │              ├─ LockRect(level 0) ──► copy 32×32 ARGB pixels
              │              │     into a CreateDIBSection HBITMAP
              │              │     (32-bit top-down DIB)
              │              │
              │              └─ Release D3D texture; cache HBITMAP in m_thumbCache
              │
              └─ not found ──► return s_placeholderMissingHBitmap (lazily generated)
```

Cache key: **absolute path**. Cache eviction: **none in v1**.
Decoder uses the existing `Engine`'s `IDirect3DDevice9*`. No separate D3D device.
Decode failures: log under `#ifndef NDEBUG` and substitute `s_placeholderBrokenHBitmap`.

### D. Palette content control (inside the popup)

A registered window class `"AloPaletteContent"` — owner-draw, sized to fit the popup client area minus the title bar margin. WndProc handles:

- **`WM_PAINT`** — draws the filter row (small native radios are real child controls, *not* owner-drawn) + the two thumbnail rows. For each entry: blit the cached HBITMAP, draw selection border if selected, draw star icon if `m_hoveredEntry == this`.
- **`WM_MOUSEMOVE`** — track hover; redraw the previously-hovered and newly-hovered cells. Use `TrackMouseEvent(TME_LEAVE)` so we know to clear hover when the cursor exits the panel.
- **`WM_LBUTTONDOWN`** — hit-test against (a) star icon if visible (toggle pin), (b) thumbnail (set selection).
- **`WM_LBUTTONDBLCLK`** — fire `WM_NOTIFY PALETTE_NM_COMMIT` to popup → forwarded to EmitterProps window.
- **`WM_COMMAND`** from filter radios — call `PaletteStore::SetActiveFilter`, clear selection, invalidate.

### E. Popup window architecture

Window class: `"AloTexturePalettePopup"`.
Owner: main editor window (lifetime tied to it).
Styles: `WS_POPUPWINDOW | WS_CAPTION | WS_SYSMENU`. Ex-style: `WS_EX_TOOLWINDOW` (no taskbar entry, smaller title bar).
Initial size: 280×120 px (fixed in v1).

**Lifecycle:**
- Class registered once in app init (`main.cpp` startup).
- Window itself is **created lazily** on first palette-button click and persists hidden between shows. Cleaner than recreating per-show — keeps the inner content control's state, avoids re-register churn.
- Destroyed automatically when the main editor window closes (Win32 owner cleanup).

**Show / hide / toggle path:**

```
PalettePopup::Toggle(HWND ownerEditor, RECT buttonRectScreen)
  if not visible:
    POINT pos = PaletteStore::GetPopupPos(fallback = button-anchored default)
    if ValidatePos(pos) fails (no monitor contains it):
        pos = button-anchored default
        log: [Palette] popup position invalid (off-screen) snapping to default
    SetWindowPos(popup, NULL, pos.x, pos.y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_SHOWWINDOW)
    log: [Palette] popup show pos=(x,y)
    fire visibility-changed callback (button → pressed)
  else:
    GetWindowRect(popup, &r); PaletteStore::SetPopupPos({r.left, r.top})
    ShowWindow(popup, SW_HIDE)
    log: [Palette] popup hide pos=(x,y)
    fire visibility-changed callback (button → raised)
```

**Position validation** uses `MonitorFromPoint({pos.x + 4, pos.y + 4}, MONITOR_DEFAULTTONULL)` — if NULL, snap to button-anchored default. Catches the "user disconnected secondary monitor" case.

**Button-anchored default:** `{ buttonScreenRect.left, buttonScreenRect.bottom + 4 }` — popup appears just below the button.

**Esc key handling:** popup's WndProc handles `WM_KEYDOWN VK_ESCAPE` → `Toggle()` (hides + saves position).

**Title bar X (close) handling:** `WM_SYSCOMMAND SC_CLOSE` → save position, hide (don't destroy). `WM_CLOSE` returns 0 to prevent default destroy.

**Visibility callback:** when popup hides or shows, fire a `std::function` set by EmitterProps. EmitterProps uses it to update the toggle button's `BM_SETCHECK` state — keeps button visual in sync regardless of which path triggered the change (button click, X, Esc).

**Status strip:** static control `IDC_PALETTE_STATUS` at the bottom of the popup client area. API:

```cpp
void PalettePopup::ShowStatus(UINT stringId, UINT durationMs = 3000);
//   - LoadString(stringId) into the control
//   - SetTimer(hPopup, ID_TIMER_STATUS_CLEAR, durationMs, NULL)
//   - On WM_TIMER ID_TIMER_STATUS_CLEAR: SetWindowText(L""); KillTimer
//   - On Hide(): SetWindowText(L""); KillTimer (no stale message on next show)
//   - On WM_DESTROY: KillTimer
```

Triggered today from the pin-overflow path; reusable for future transient messages (mod switch confirm, decode failure summary, etc.).

### F. Mod switching

```
User picks a mod from File ▸ Mods ▸ <mod>
  │
  └─ existing path: SetModPath + WriteLastMod(modPath)
     │
     └─ new: PaletteStore::Instance().SetActiveMod(modPath)
        │
        ├─ flush dirty state from previous mod's in-memory entries to INI
        ├─ read new mod's section from INI (or initialize empty)
        └─ post WM_PALETTE_REFRESH to popup if visible (popup invalidates content control)
```

### G. Reset View Settings integration

The existing handler at [src/main.cpp:1566](src/main.cpp:1566) gains one new step:

```cpp
PaletteStore::Instance().ClearActiveMod();
// (deletes the [mod=<sha1>] section from the INI file; [ui] section survives)
```

This wipes pins + recents + filter for the active mod *only*. Other mods' palettes survive. Popup window position survives. If the popup is open, it refreshes to show the now-empty palette.

### H. Touch points by file

| File | Change |
|---|---|
| `src/UI/TexturePalette.h` | **NEW** — `PaletteStore`, `PaletteEntry`, `PalettePopup`, control class registration |
| `src/UI/TexturePalette.cpp` | **NEW** — implementation, INI I/O, thumbnail decoder, popup + content WndProcs |
| `src/ParticleEditor.en.rc` | Add `IDC_BUTTON_PALETTE` to `IDD_EMITTER_PROPS2` Textures group header; add `BITMAP IDB_PALETTE_GLYPH "Resources/palette_glyph.bmp"`; add `IDS_PALETTE_FILTER_COLOR`, `IDS_PALETTE_FILTER_BUMP`, `IDS_PALETTE_PINS_FULL` string-table entries |
| `src/Resources/palette_glyph.bmp` | **NEW** — 16×16 px 24-bit BMP, painter's palette icon (kidney outline + thumb hole + paint blobs) |
| `src/Resources/resource.en.h` | Add the new control IDs (`IDC_BUTTON_PALETTE`, `IDC_PALETTE_STATUS`, `IDC_RADIO_PALETTE_COLOR`, `IDC_RADIO_PALETTE_BUMP`) + the bitmap ID + the new string IDs |
| `src/UI/Emitter.cpp` | Hook texture-write points to `PaletteStore::TouchRecent`; handle `IDC_BUTTON_PALETTE` (toggle popup); handle `PALETTE_NM_COMMIT`; wire visibility-changed callback to `BM_SETCHECK` |
| `src/main.cpp` | Register popup window class on startup; init `PaletteStore`; call `SetActiveMod` on mod switch + startup restore + Reset View Settings |
| `src/ParticleEditor.vcxproj` | Add the two new files |
| `src/ParticleEditor.vcxproj.filters` | Same |

Notably absent: **no dialog template growth, no host-window resize, no main-window layout changes.** That was the goal of the popup pivot.

---

## Risks named up front + mitigations

1. **R1 — Texture file format ambiguity (DDS variants, exotic TGA flavors) breaks D3DX decode.** Some real-world mod textures use non-standard DDS pixel formats, RLE-compressed TGA, or 16-bit TGA. D3DX9 handles most but not all. **Tripwire:** thumbnails for some entries always show the broken placeholder.
   **Mitigation:** the broken-placeholder fallback path *is* the mitigation — a failed thumbnail doesn't break the workflow (filename + pin/recent state still work; double-click still feeds the slot correctly). Debug log records the failure for triage. No attempt to support every exotic format — that's a separate problem.

2. **R2 — Stale recents pointing at deleted/renamed files clutter the palette.** A user might rename `p_smoke.tga` → `p_smoke_v2.tga` on disk; the recents entry for the old name persists with a broken thumbnail. **Tripwire:** palette accumulates broken-thumb entries over time.
   **Mitigation:** on `SetActiveMod`, perform a one-shot existence check via `FileManager` for each entry. Entries where the file no longer resolves are *demoted* (pins → recents) but not deleted, on the theory that the file might come back (git checkout, mod re-extraction). After 30 days of continuous "missing" status (tracked via a `firstMissingNs` field added to entries that go missing), the entry is auto-pruned. The 30-day grace is a single constant in `TexturePalette.cpp` — easily tunable.

3. **R3 — `LastMod` value uses a registry-stored absolute path; if the user moves their mods folder, mod-key lookup misses and they "lose" their palette.** **Tripwire:** user moves `C:\Mods\RaW` → `D:\Mods\RaW`, palette appears empty for a mod they've used for months.
   **Mitigation:** acceptable v1 limitation. The existing `LastMod` itself has this same property — moving the mod folder loses the "last opened" state too. If users complain, a future PR can add a "rebind palette to current mod path" import/migrate UI. Documented in the CHANGELOG entry as a known limitation.

4. **R4 — INI file parsing edge cases (Unicode names, `=` or `\n` characters in filenames) corrupt the palette.** Texture filenames in real mods sometimes contain non-ASCII characters. **Tripwire:** a non-ASCII texture name in a recent entry causes either a parse failure on next load or a corrupted `Recent*=` line.
   **Mitigation:** use `WritePrivateProfileStringW` consistently and keep the file UTF-16 LE on disk. Texture filenames are stored as `wstring` internally for INI I/O and converted to/from `string` only at the boundary with `Emitter::colorTexture`. Filenames containing `=` (illegal in INI keys) cannot occur for `Pin*` / `Recent*` *values*; the `=` would only be a problem in a key, which we control. A sanity-check at the `TouchRecent` boundary rejects entries with control characters, with a debug log.

5. **R5 — Thumbnail decode pegs the UI thread on first popup show with many entries.** 16 thumbnails × ~10–20 ms decode each = up to 320 ms hitch. **Tripwire:** opening the popup on a populated mod feels janky.
   **Mitigation:** decode lazily in `WM_PAINT` rather than upfront on popup show — only entries that are currently visible (and not yet cached) get decoded. With 16 max visible entries and the cache persisting across popup show/hide, the worst case is the first paint after a mod switch, and only for entries that haven't been seen this session. If field reports indicate this is still too slow, the on-disk PNG cache (Out item above) becomes the follow-up.

6. **R6 — Palette write happens before the texture-field's normal change-notification flow, so undo/redo skips the palette-driven write.** **Tripwire:** double-click a thumbnail, hit Ctrl+Z, the texture field doesn't revert.
   **Mitigation:** the `PALETTE_NM_COMMIT` handler in `DlgEmitterPropsProc` writes via the *exact same path* the file-picker (`IDC_BUTTON1`/`2`) uses today — `SetWindowText` on the edit field followed by re-firing the change notification. This routes through whatever undo/edit-tracking the existing flow uses (or doesn't). Verified by I1/I2 below.

7. **R7 — Popup position lands off-screen after monitor topology change** (user disconnected external monitor between sessions). **Tripwire:** popup opens, isn't visible anywhere, button shows pressed but no window on screen.
   **Mitigation:** `MonitorFromPoint(MONITOR_DEFAULTTONULL)` validation on every show; snap to button-anchored default if invalid. Logs a debug line. The check is cheap enough to run unconditionally.

8. **R8 — Popup-button toggle desynchronizes if the popup is hidden via X but the button doesn't update.** **Tripwire:** close popup via title-bar X, button still shows pressed; clicking the button hides an already-hidden popup (no-op) but flips the visual to raised, requiring a second click to actually show.
   **Mitigation:** the visibility-changed callback (Section E) fires from `PalettePopup::Hide()` regardless of trigger source — X, Esc, or button. EmitterProps's callback calls `Button_SetCheck(hButton, BST_UNCHECKED)`. Verified by K3.

9. **R9 — Popup created lazily means the first toggle has higher latency** (window class registration + window creation + content-control creation). **Tripwire:** first palette-button click feels noticeably slower than subsequent clicks.
   **Mitigation:** register the window class at app startup (cheap, ~microseconds). Defer only the `CreateWindowEx` call to first show. First-show latency is bounded by ~1–2 ms for window creation plus the lazy thumbnail decode (covered by R5).

10. **R10 — Status strip timer leaks if the popup is destroyed (e.g., main editor close) while a status message is showing.** **Tripwire:** debug-build leak detector flags an outstanding `SetTimer` reservation on shutdown, or a `WM_TIMER` fires against a destroyed window.
    **Mitigation:** `KillTimer(hPopup, ID_TIMER_STATUS_CLEAR)` is called from three paths: the `WM_TIMER` handler itself (after clearing the text), `PalettePopup::Hide()` (so a hidden popup never has a pending timer), and `WM_DESTROY` (final cleanup). The triple-redundancy is cheap and eliminates the failure modes entirely.

---

## Testing & verification

Manual checklist. Each item names *what regression it catches*. Debug instrumentation: prefix `[Palette]` — `grep '\[Palette\]'` in stderr captures all events.

### A. Button & layout

| # | Check | Catches |
|---|---|---|
| A1 | Open Emitter properties → Appearance tab. Palette button visible in the Textures groupbox header (right side). Tooltip "Texture palette" shown on hover. | Button missing or misplaced; tooltip wiring missing |
| A2 | Switch to Basic / Physics tabs. Palette button hides with the rest of the Appearance tab. Switch back. Button reappears in the same position. | Button leaks onto wrong tab |
| A3 | Resize the main window. Button stays in the groupbox header (groupbox doesn't resize, so button should be stable). | Button positioning regressed |
| A4 | Build a Release configuration (NDEBUG). All `[Palette]` debug lines absent from stderr. | Debug instrumentation leaked |

### B. Recents auto-tracking

| # | Check | Catches |
|---|---|---|
| B1 | Open palette popup. Click "..." on Color slot in the Appearance tab, pick `foo.tga`. Recent row first cell shows `foo.tga`'s thumbnail. `[Palette] touch recent name='foo.tga' slot=Color` logged. | File-picker hook missing |
| B2 | Repeat with `bar.tga`, then `baz.tga`. Recent row reads (left-to-right) `baz, bar, foo`. | LRU ordering wrong |
| B3 | Type a different texture name into the Color edit field and tab away. Recent updated; `[Palette] touch recent ... slot=Color` logged. | EN_CHANGE / EN_KILLFOCUS hook missing |
| B4 | Switch popup filter to Bump. Recent row is empty (no Bump entries yet). Pick a bump texture via "..." — appears in Bump recents only. Switch back to Color — Color recents intact. | Slot tagging / filter logic wrong |
| B5 | Touch a Recent entry by double-clicking it. It moves to position 0 (LRU re-touch). | Touch-on-click LRU update missing |
| B6 | Add 9 distinct Color recents in a row. Oldest (`recent #1`) is evicted; only 8 visible. | Cap not enforced |

### C. Pin gesture

| # | Check | Catches |
|---|---|---|
| C1 | Hover over a recent thumbnail. Star icon appears in the top-right corner. Move cursor away. Star disappears within one redraw cycle. | Hover tracking / `TrackMouseEvent` wrong |
| C2 | Click the star on a recent. Entry moves to the Pinned row, vacates its recents slot, others shift down. `[Palette] toggle pin name='X' newState=true` logged. | Pin migration logic wrong |
| C3 | Click the star on a pinned entry. It un-pins; if the file was used recently it returns to recents at position 0; if it predates the recents window, it disappears. | Unpin → recents promotion / drop logic wrong |
| C4 | Add 9 pins. The 9th is rejected (or replaces oldest pin — define the policy). Visually the row stays at 8. | Pin cap not enforced |
| C5 | Right-click outside any thumbnail. Nothing happens (no spurious context menu). | WM_RBUTTONDOWN unguarded |

### D. Click model

| # | Check | Catches |
|---|---|---|
| D1 | Single-click a pinned entry. Selection border appears. The Color/Bump filter radios are unchanged. The texture edit field is **not** modified. | Single-click writes when it shouldn't |
| D2 | Double-click that same entry. The Color edit field updates to the entry's filename. The viewport texture changes (visible particles change appearance). | Double-click commit broken |
| D3 | Switch popup filter from Color to Bump. Selection clears. Single-click a Bump pin. Double-click. The Bump edit field updates. | Filter-change clears selection / double-click feeds correct slot |
| D4 | Double-click an entry that's missing from disk (rename the file outside the editor first). Edit field still updates to the filename; viewport texture goes to whatever the engine does for missing textures (default fallback). No crash. | Defensive — missing-file commit path |
| D5 | Double-click multiple entries in succession. Popup stays open between commits. Each commit updates the slot immediately. | Sticky-popup behavior broken |

### E. Per-mod isolation

| # | Check | Catches |
|---|---|---|
| E1 | Open Mod A, populate 3 pins + 5 recents. Switch to Mod B via File ▸ Mods. Palette popup (still open) refreshes to empty (or shows Mod B's separately-saved entries). `[Palette] mod switch from='A' to='B' loadedEntries=N` logged. | `SetActiveMod` not wired into mod-switch flow; popup not refreshed |
| E2 | Switch back to Mod A. The original 3 pins + 5 recents are intact, in the same order. | INI write-on-change / read-on-load round-trip wrong |
| E3 | Quit the editor entirely. Restart. Mod A is restored via `LastMod`. Palette shows Mod A's pins + recents when the popup is opened. | Startup hook missing or order wrong (must run after `LastMod` restore) |
| E4 | Switch to a brand-new mod that has no INI section. Palette is empty. Add a pin. Quit. Restart. The pin survives. | New-section creation path |

### F. Reset View Settings

| # | Check | Catches |
|---|---|---|
| F1 | With Mod A loaded and a populated palette, invoke View ▸ Reset View Settings. Mod A's palette goes empty in the popup immediately. | Reset hook missing or popup not refreshed |
| F2 | Open the INI file. The `[mod=<sha1-of-A>]` section is gone; other mods' sections survive; the `[ui]` section (popup position) survives. | Reset wiped too much (or too little) |
| F3 | Restart. Mod A's palette is still empty. Popup position is preserved. | Reset only affected memory, not disk; or wiped popup position |

### G. Thumbnail pipeline

| # | Check | Catches |
|---|---|---|
| G1 | Add a recent for a `.tga` texture. Thumbnail decodes within ~50 ms (no UI freeze). | Synchronous decode is too slow |
| G2 | Add a recent for a `.dds` (DXT5) texture. Thumbnail decodes correctly, looks visually plausible. | DXT decode path broken |
| G3 | Manually create an empty file `broken.tga` in the mod's textures directory. Add a recent for it. Broken-placeholder thumbnail appears. `[Palette] thumbnail decode failed path='...' fallback=placeholder` logged. | Decode-failure fallback missing |
| G4 | Reference a non-existent file in a recent (delete the file after adding). Missing-placeholder thumbnail appears. | Existence-check / file-not-found fallback missing |
| G5 | Open the editor, populate 16 recents across two mods, switch back and forth 5 times. Memory does not climb (HBITMAP cache stable). | Cache leak |

### H. INI persistence edge cases

| # | Check | Catches |
|---|---|---|
| H1 | Add a recent with a filename containing a non-ASCII character (e.g., `tëxture.tga`). Quit, restart. Entry restored intact. | UTF-16 INI handling wrong |
| H2 | Hand-edit the INI file to set `RecentCount=99` while only `Recent0` and `Recent1` actually exist. Restart. Editor doesn't crash; palette shows just the two valid entries; on next change the file is rewritten with correct count. | Defensive parsing — bad counts |
| H3 | Hand-edit to corrupt the slot mask (`Pin0=foo.tga|notarealslot`). Restart. Editor doesn't crash; entry is silently dropped; debug log records the parse error. | Defensive parsing — bad slot mask |
| H4 | Delete the entire INI file while the editor is running. Open Emitter properties. Existing in-memory state still shows. Add a new entry. INI file is recreated. | Re-creation on next write |

### I. Undo round-trip

| # | Check | Catches |
|---|---|---|
| I1 | (Skip if project has no undo for texture fields today.) Set Color to `a.tga` via "...", then double-click a palette entry for `b.tga`. Press Ctrl+Z. Color reverts to `a.tga` (or whatever the existing undo behavior is for the file-picker write). | R6: palette-driven write bypasses normal write path |
| I2 | Compare the undo behavior of palette double-click vs. file-picker pick. Both should behave identically. | Two write paths diverged |

### J. Cleanup

| # | Check | Catches |
|---|---|---|
| J1 | Quit the editor. No `[Palette]` warnings about leaked HBITMAPs in debug output. | Cache HBITMAPs not freed in `PaletteStore`'s destructor |
| J2 | Run with a Visual Studio leak-detection tool. No new leaks. | New module leaks |

### K. Popup window behavior

| # | Check | Catches |
|---|---|---|
| K1 | Click the palette button. Popup appears just below the button (first-run, no saved position). Button shows pressed state. `[Palette] popup show pos=(...)` logged. | First-show button-anchored default missing |
| K2 | Drag popup to a new screen position. Click the palette button (button is still pressed). Popup hides. `[Palette] popup hide pos=(x,y)` with the new coords logged. Click button again. Popup reappears at the dragged position. | Position memory broken |
| K3 | With popup open, click its X. Popup hides; button immediately shows raised state. | R8: button-popup desync |
| K4 | With popup open and focused, press Esc. Popup hides; button raises; position preserved. | Esc handler missing |
| K5 | Quit editor with popup open at position (X, Y). Restart. Click palette button. Popup appears at (X, Y). | Position not flushed to INI on app close |
| K6 | Manually edit INI to set `PopupX=99999, PopupY=99999`. Restart. Click palette button. Popup snaps to button-anchored default. `[Palette] popup position invalid (off-screen) snapping to default` logged. | R7: off-screen recovery broken |
| K7 | Open popup. Switch tabs in Emitter properties (Basic / Physics). Popup remains visible (it's a separate top-level window). | Popup incorrectly tied to Appearance tab visibility |
| K8 | Open popup. Click anywhere in the main editor (viewport, menu, other controls). Popup remains visible (sticky, modeless). | Auto-close-on-outside-click leaked in |
| K9 | Open popup. Close the main editor (Alt-F4 / X). Popup disappears with main window (owner cleanup). | Popup outlives main editor (orphan window) |
| K10 | First-run editor on a fresh machine (no INI file). Click palette button. Popup opens at button-anchored default; no crash; no error. | First-run path with missing INI |

### L. Status strip (pin overflow)

| # | Check | Catches |
|---|---|---|
| L1 | Pin 8 distinct entries. Hover a 9th recent, click its star. New entry stays as a recent (pin row unchanged). Status strip shows "Pins full (8). Unpin one to make room." | Pin overflow accepted when it should be rejected |
| L2 | Wait 3 seconds after L1. Status strip clears automatically. | `WM_TIMER` clear path missing |
| L3 | After L1, immediately unpin one pin (click star on a pinned entry). It vacates the pin row. Now click star on a recent. It pins successfully. Status strip clears or stays empty (no spurious "full" message). | Stale status not cleared on next valid pin |
| L4 | Trigger L1 to show the status. While still visible, hide the popup via X. Reopen the popup. Status strip is empty (no leftover message). | `Hide()` doesn't clear status |
| L5 | Trigger L1, then immediately close the main editor while the status is still showing. No `WM_TIMER` callback fires against a destroyed window; no leaked timer reservation. | R10: timer cleanup on destroy |

---

## Resolved decisions

All open design questions are resolved. Recording the answers and reasoning so reviewers can see the trail:

1. **Workflow** — *both* recents (auto) + pins (explicit), per the original ROADMAP language.
2. **UI placement** — palette button in the Textures groupbox header (top-right) → modeless popup window. Chosen over inline panel to avoid cascading dialog-template / host-window layout changes.
3. **Entry display** — 32×32 thumbnails (vs. text-only or tooltip-hover). Drives the D3DX → DIB pipeline in Section C.
4. **Color/Bump separation** — single combined palette with a Color/Bump filter toggle. Entries flagged on use; no filename heuristics.
5. **Pin gesture** — hover-revealed star button in the thumbnail's top-right corner.
6. **Click model** — single-click selects (highlight only, no extra preview), double-click commits to the active filter's slot.
7. **Capacity** — 8 pinned + 8 recent per filter. No scroll. Two compact rows.
8. **Pin overflow at 9** — **Option B**: reject the click, show transient status-strip message ("Pins full (8). Unpin one to make room.") for 3 seconds, auto-clear. Preserves pin intent (never silently drop), gives user clear feedback.
9. **Popup behavior** — modeless, sticky. Does not auto-close on outside click or after a commit. Position remembered across sessions in INI `[ui]` section.
10. **Popup dismissal** — title-bar X, Esc when focused, or clicking the (pressed) palette button.
11. **Persistence format** — INI via `WritePrivateProfileStringW` (UTF-16 LE), single file at `%APPDATA%\AloParticleEditor\texture-palettes.ini`. Avoids new third-party dependency.
12. **Per-mod scoping** — INI section keyed by SHA1 of the absolute mod path.
13. **Thumbnail decode** — synchronous, lazy in `WM_PAINT`, with in-memory HBITMAP cache. No on-disk PNG cache (deferred).
14. **Button glyph** — hand-authored 16×16 px BMP resource depicting a painter's palette (kidney outline + thumb hole + paint blobs). `IDB_PALETTE_GLYPH`.
15. **Undo integration** — *to be verified during implementation*. The `PALETTE_NM_COMMIT` handler writes via the same path the file-picker uses today; whether that path routes through `UndoStack` is a question for the first implementation step.
16. **Phasing** — single PR. The unit is small enough (~9–12 h) that phasing overhead would exceed the verification benefit.
