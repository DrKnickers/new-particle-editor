# [MT-2] Selectable ground texture

**Status (2026-05-14):** plan draft, awaiting user approval. Target PR: `feat/mt2-selectable-ground`.

Follows the planning conventions established for MT-9 and MT-10: Context block, per-artefact Architecture subsections, named tripwires per risk, verifier-first Verification where each row says *what regression it catches*.

---

## Status of the surrounding work

- ✅ **[MT-7]** Linked emitters — [#58](https://github.com/DrKnickers/new-particle-editor/pull/58)
- ✅ **[MT-8]** Multi-select — [#60](https://github.com/DrKnickers/new-particle-editor/pull/60)
- ✅ **[MT-9]** Visual link-group bracket — [#63](https://github.com/DrKnickers/new-particle-editor/pull/63)
- ✅ **[MT-10]** Configurable exempt set per link group — [#65](https://github.com/DrKnickers/new-particle-editor/pull/65)
- 🚧 **[MT-2]** Selectable ground texture — **this plan**.

Medium-term queue after MT-2: MT-1 (textures palette), MT-3 (skydome), MT-4 (env lighting).

---

## Context

The preview's ground plane is currently hardcoded to `IDB_GROUND` (`Resources\dirt.bmp`) — loaded once at engine init via `D3DXCreateTextureFromResource` ([src/engine.cpp:1126](src/engine.cpp:1126)) and rendered at every frame via `m_pDevice->SetTexture(0, m_pGroundTexture)` ([src/engine.cpp:581](src/engine.cpp:581)). The same single texture is what's released and re-loaded in the lost-device recovery path ([src/engine.cpp:1138](src/engine.cpp:1138), [src/engine.cpp:1153](src/engine.cpp:1153), [src/engine.cpp:1192](src/engine.cpp:1192)).

That single texture is the right default for a generic test, but doesn't match the visual context for many real particle effects: a sand-storm effect designed for Tatooine wants sand under it; a Hoth blizzard wants snow; a Star Destroyer interior smoke wants metal deck. The current workaround is "ignore the ground entirely and trust the eye to mentally substitute"; MT-2 swaps that for a small picker so the preview's ground matches the effect's likely deployment surface.

MT-2 is intentionally small — a single dropdown control next to the existing **Background** colour button, a handful of bundled textures, registry persistence per the existing `BackgroundColor` / `ShowGround` pattern. No file-format changes, no engine-architecture changes, no .alo-level state. After MT-2 the preview's environmental context is fully controllable through three knobs: ground visibility (existing `ShowGround` toggle), ground texture (this plan), and background colour (existing).

**Why now**: clears the smallest item out of the medium-term queue while the editor team is "warmed up" on UI-adjacent work from the MT-7→MT-10 sequence. Low-risk, contained, useful to every workflow that uses the preview.

---

## Goal + scope

A picker control on the top toolbar bar lets the user choose one of N bundled ground textures. The selection persists across editor sessions via `HKCU\Software\AloParticleEditor\GroundTexture` (REG_DWORD index). The default for a fresh install / corrupted registry is the existing `dirt.bmp` so pre-MT-2 users see no visual change.

**In:**

- **6 bundled ground textures** as RCDATA resources in the .exe (any of BMP / DDS / TGA / PNG / JPG):
  1. **Dirt** (existing — kept as default; preserves pre-MT-2 visual).
  2. **Grass** (green outdoor surface).
  3. **Sand** (light tan — Tatooine / desert).
  4. **Snow** (white-ish — Hoth / arctic).
  5. **Metal deck** (gray plates — Star Destroyer / Death Star interior).
  6. **Grey** (neutral grey — useful as a colour-neutral reference for judging the actual hue of particle effects, especially semi-transparent ones).
- **`Engine::SetGroundTexture(int index)`** / **`Engine::GetGroundTexture()`** accessors. `SetGroundTexture` releases the current texture and creates the new one from the corresponding resource ID; on failure it falls back to the default (and logs in debug builds). `int m_groundTextureIndex` field on the Engine holds the current selection.
- **Lost-device recovery path** ([src/engine.cpp:1138](src/engine.cpp:1138) and similar) consults `m_groundTextureIndex` when re-creating the texture so the user's choice survives Alt-Tab / fullscreen mode / window minimisation.
- **Toolbar combobox** placed next to the existing **Background** colour button at the top of the editor window. Width ~100 px; reads the texture names from a string table. Selecting an entry fires `Engine::SetGroundTexture` and writes to the registry.
- **Persistence**: `ReadGroundTexture` / `WriteGroundTexture` helpers in `main.cpp` parallel to `ReadBackgroundColor` / `WriteBackgroundColor`. Default index is `0` (dirt) when the registry value is missing, malformed, or out-of-range.
- **Reset View Settings** integration: `ID_VIEW_RESET_VIEW_SETTINGS` ([src/main.cpp](src/main.cpp) line ~1573) currently clears `BackgroundColor`, `ShowGround`, `GroundZ`, bloom, and color-picker custom colours. MT-2 extends this to also clear `GroundTexture` and reset the engine + UI to dirt.
- **Debug instrumentation** under `#ifndef NDEBUG`: `[Ground] texture set index=N name='%s'`, `[Ground] texture load failed index=N falling back to default`.

**Out:**

- **User-supplied ground textures** (load a `.bmp` / `.dds` / `.tga` from disk). *Reason: deferred per the original ROADMAP entry. Bundled set covers the canonical use cases; user-supplied adds a file picker, path validation, and persistence storage that aren't worth the v1 scope.*
- **Per-particle-system ground texture** (saving the ground choice into the .alo file). *Reason: the ground texture is a *preview* concern — what surface the particle effect is being staged against — not a property of the effect itself. Storing it in .alo would also be a file-format change, which is out of scope for this tier of work.*
- **Animated / scrolling ground textures.** *Reason: implementation is non-trivial (animated UV transform), and the use case is marginal.*
- **Per-mod default ground texture.** *Reason: similar to `LastMod` but for ground — adds complexity without a strong driver. If demand surfaces, the registry layout already permits this layered.*
- **A "Custom..." option in the combobox** that opens a file picker. *Reason: covered by the user-supplied bullet above.*
- **Tiling / scale controls.** *Reason: the existing tiling math (`MAP_SIZE*UNITS_PER_CELL/TEXTURE_SCALE`, src/engine.cpp:576) is fine for all bundled textures designed at the same target tiling.*

---

## What we already have

| Piece | File:line |
|---|---|
| Current ground texture field on Engine | [src/engine.h:234](src/engine.h:234) |
| Current ground texture load (init) | [src/engine.cpp:1126](src/engine.cpp:1126) |
| Lost-device recovery releases | [src/engine.cpp:1138](src/engine.cpp:1138), [src/engine.cpp:1153](src/engine.cpp:1153), [src/engine.cpp:1192](src/engine.cpp:1192) |
| Ground rendering call site (per-frame) | [src/engine.cpp:581](src/engine.cpp:581) |
| `IDB_GROUND` resource ID definition | [src/Resources/resource.h:20](src/Resources/resource.h:20) |
| `dirt.bmp` BITMAP declaration in .rc | [src/ParticleEditor.rc:32](src/ParticleEditor.rc:32) |
| `dirt.bmp` in .vcxproj's resource list | [src/ParticleEditor.vcxproj:230](src/ParticleEditor.vcxproj:230) |
| Existing toolbar-row layout (Leave particles / Background / Ground Z) | [src/main.cpp:2400](src/main.cpp:2400)–2440 |
| `ReadBackgroundColor` / `WriteBackgroundColor` registry pattern | [src/main.cpp:2887](src/main.cpp:2887)–2913 |
| `ReadShowGround` / `WriteShowGround` (REG_DWORD pattern, defaulting policy) | [src/main.cpp:2915](src/main.cpp:2915)–2940 |
| `ReadGroundZ` / `WriteGroundZ` (REG_BINARY pattern for float) | [src/main.cpp:2947](src/main.cpp:2947)–2974 |
| `ID_VIEW_RESET_VIEW_SETTINGS` handler (clears persisted view settings) | [src/main.cpp:1566](src/main.cpp:1566)–~1606 + the registry-delete sweep in [src/main.cpp:3075](src/main.cpp:3075) |
| Engine background colour load on startup | [src/main.cpp:4044](src/main.cpp:4044)–4045 |
| Existing combobox patterns in the editor | [src/UI/EmitterProps.cpp](src/UI/EmitterProps.cpp) (blend-mode combo, ground-behavior combo) |

**Not yet in the codebase — to add:**

- 5 new RCDATA resources in `src/Resources/` (file extension chosen per user-supplied art: `.bmp` / `.dds` / `.tga` / `.png` all work). Existing `IDB_GROUND` also migrates from BITMAP → RCDATA for a unified load path.
- 5 new `IDB_GROUND_*` resource IDs in `src/Resources/resource.h` (or stay in [src/Resources/resource.en.h](src/Resources/resource.en.h)).
- 5 new `BITMAP` lines in [src/ParticleEditor.rc](src/ParticleEditor.rc).
- 5 new `<Image Include="...">` lines in [src/ParticleEditor.vcxproj](src/ParticleEditor.vcxproj) and its `.filters` sibling.
- `m_groundTextureIndex` field on Engine + getter/setter.
- `Engine::SetGroundTexture(int)` implementation that handles release / reload / fallback.
- `Engine::ReloadGroundTexture()` private helper used by both the public setter and the lost-device recovery path.
- `ReadGroundTexture` / `WriteGroundTexture` in main.cpp.
- Toolbar combobox `info->hGroundTextureCombo` + creation in `WM_CREATE` + layout in `WM_SIZE`.
- Combobox change-notification handling (CBN_SELCHANGE).
- `IDS_GROUND_*` string table entries for the dropdown labels.
- `Reset View Settings` extended to delete the registry value + reset combo + reload texture.

**Unknown to confirm before coding:**

1. **Texture sourcing.** The 5 new BMPs need actual image data. Three options: (a) user provides assets from existing game data; (b) I generate placeholder procedural textures (solid color + noise + simple pattern) for the v1 ship and replace later with curated art; (c) source from public-domain texture libraries. **Open Q1 below.**
2. **Texture size.** Existing `dirt.bmp` size unknown without inspection — likely 256×256 or 512×512. New textures should match for consistent tiling and minimal .exe bloat. **Action**: inspect dirt.bmp during implementation; match the format.
3. **Combobox vs. toolbar button popup vs. View submenu.** The combobox is the obvious choice for a 6-item dropdown, but I should confirm the top bar has space without crowding. Layout math at [src/main.cpp:2425](src/main.cpp:2425) anchors Background button at `clientWidth - 28`. A ~100 px combo to its left needs ~120 px of clear space; on narrow windows that may push the existing controls together. **Open Q2 below.**
4. **`Engine::Lost / Reset` device path** — does the existing texture-release-and-recreate sequence correctly chain through a `SetGroundTexture`-equivalent that re-uses the current index? **Action**: trace the lost-device path to confirm where the re-create happens; the new `ReloadGroundTexture` helper plugs in there.

---

## Architecture

Five pieces, all in well-bounded locations.

### A. Resource additions

5 new texture files in [src/Resources/](src/Resources/), declared in [src/ParticleEditor.rc](src/ParticleEditor.rc) as `RCDATA` resources rather than `BITMAP`. The existing `IDB_GROUND` is also migrated from BITMAP → RCDATA for a unified load path. RCDATA accepts any file format; the loader (`D3DXCreateTextureFromFileInMemory`, see §B) parses the bytes regardless of extension — BMP, DDS, TGA, PNG, JPG, HDR are all valid.

```rc
IDB_GROUND        RCDATA   "Resources\\dirt.bmp"     // (or .dds/.tga/.png — extension is informational)
IDB_GROUND_GRASS  RCDATA   "Resources\\grass.tga"
IDB_GROUND_SAND   RCDATA   "Resources\\sand.dds"
IDB_GROUND_SNOW   RCDATA   "Resources\\snow.tga"
IDB_GROUND_METAL  RCDATA   "Resources\\metal.dds"
IDB_GROUND_GREY   RCDATA   "Resources\\grey.png"
```

Each texture can be any reasonable size (256–1024 px per side recommended; 2048 hard cap to keep .exe size sane). Mixed sizes and mixed formats are fine — tiling is governed by `TEXTURE_SCALE` in the vertex math at [src/engine.cpp:576](src/engine.cpp:576), independent of source pixel resolution. **Format-specific notes:**

- **DDS** is preferred for ground textures: pre-mipmapped (sharper at oblique angles + distant viewing), GPU-native compression (BC1/DXT1 cuts size ~6× vs uncompressed RGB), no decode cost at load.
- **TGA** is what game-asset pipelines typically deliver: lossless, alpha-channel support, no licensing concerns. D3DX9 decodes at load.
- **BMP** stays a valid option (preserves the pre-MT-2 `dirt.bmp` exactly). Uncompressed, simple, but bulky compared to DDS.
- **PNG / JPG** also work via D3DX9's built-in decoders — useful for quick-and-dirty placeholders.

Resource IDs in [src/Resources/resource.h](src/Resources/resource.h) — adjacent to the existing `IDB_GROUND = 130`, picking 131..135.

String table entries (both `resource.en.h` and `resource.de.h` for ID consistency, with the strings in the corresponding `.rc` files — English-only labels per the existing convention): `IDS_GROUND_DIRT`, `IDS_GROUND_GRASS`, `IDS_GROUND_SAND`, `IDS_GROUND_SNOW`, `IDS_GROUND_METAL`, `IDS_GROUND_GREY`.

### B. Engine API

Three additions to [src/engine.h](src/engine.h):

```cpp
// Public.
bool SetGroundTexture(int index);        // returns true on success
int  GetGroundTexture() const { return m_groundTextureIndex; }
static const int kGroundTextureCount = 6;

// Private.
int                m_groundTextureIndex;     // 0..kGroundTextureCount-1
bool ReloadGroundTexture();                  // releases m_pGroundTexture, recreates from m_groundTextureIndex
```

Implementation in [src/engine.cpp](src/engine.cpp):

```cpp
bool Engine::SetGroundTexture(int index)
{
    if (index < 0 || index >= kGroundTextureCount) return false;
    if (index == m_groundTextureIndex && m_pGroundTexture != NULL) return true;
    m_groundTextureIndex = index;
    return ReloadGroundTexture();
}

bool Engine::ReloadGroundTexture()
{
    // Resource ID lookup table; kept in sync with the .rc additions.
    static const UINT kResourceIds[kGroundTextureCount] = {
        IDB_GROUND,        // 0 dirt (default)
        IDB_GROUND_GRASS,  // 1
        IDB_GROUND_SAND,   // 2
        IDB_GROUND_SNOW,   // 3
        IDB_GROUND_METAL,  // 4
        IDB_GROUND_GREY,   // 5
    };
    // RCDATA + D3DXCreateTextureFromFileInMemory accepts any format
    // D3DX9 understands (BMP, DDS, TGA, PNG, JPG, HDR). The extension
    // in the .rc declaration is informational only — the loader sniffs
    // the actual file bytes.
    HMODULE  hMod  = GetModuleHandle(NULL);
    HRSRC    hRes  = FindResource(hMod, MAKEINTRESOURCE(kResourceIds[m_groundTextureIndex]),
                                   RT_RCDATA);
    HGLOBAL  hData = (hRes != NULL) ? LoadResource(hMod, hRes) : NULL;
    void*    pData = (hData != NULL) ? LockResource(hData) : NULL;
    DWORD    dwSize = (hRes != NULL) ? SizeofResource(hMod, hRes) : 0;
    IDirect3DTexture9* pNew = NULL;
    if (pData == NULL || dwSize == 0 ||
        FAILED(D3DXCreateTextureFromFileInMemory(m_pDevice, pData, dwSize, &pNew)))
    {
#ifndef NDEBUG
        printf("[Ground] texture load failed index=%d falling back to default\n",
               m_groundTextureIndex);
        fflush(stdout);
#endif
        if (m_groundTextureIndex != 0)
        {
            m_groundTextureIndex = 0;
            return ReloadGroundTexture();   // single retry on the known-good default
        }
        return false;                       // dirt itself failed → engine is in trouble
    }
    SAFE_RELEASE(m_pGroundTexture);
    m_pGroundTexture = pNew;
#ifndef NDEBUG
    printf("[Ground] texture set index=%d\n", m_groundTextureIndex);
    fflush(stdout);
#endif
    return true;
}
```

The existing init-time load at [src/engine.cpp:1126](src/engine.cpp:1126) is rewritten to call `ReloadGroundTexture()` (with `m_groundTextureIndex = 0` set in the constructor). Same change for the lost-device recovery path.

### C. Toolbar combobox + UI wiring

In [src/main.cpp](src/main.cpp), add `HWND hGroundTextureCombo` to the `APPLICATION_INFO` struct (alongside `hBackgroundLabel`, `hBackgroundBtn`, `hGroundZSpinner`). Create in `WM_CREATE` adjacent to the existing background controls. Populate with the 6 entries via `LoadString(IDS_GROUND_*)` in order.

Layout in `WM_SIZE` ([src/main.cpp:2400](src/main.cpp:2400)–2440): insert the combobox between the Ground Z group and the Background group, with the same vertical alignment as the other top-bar controls. Updated anchoring:

```
[Leave particles] ...  [Ground tex combo] [Z:] [Z spinner] [Bg:] [Bg btn]
                       ←──────────────── grouped from right ────────────→
```

`CBN_SELCHANGE` notification in `WM_COMMAND` calls `info->engine->SetGroundTexture(index)` then `WriteGroundTexture(index)`. On engine-side failure (returns false), fall back to `SetGroundTexture(0)` and re-sync the combobox to index 0 to keep UI ↔ engine state consistent.

Combobox style: `CBS_DROPDOWNLIST | WS_VSCROLL | WS_TABSTOP` (no user-typed entries; 6 items don't need a scroll bar in practice but the style is cheap).

### D. Registry persistence

Two helpers in [src/main.cpp](src/main.cpp) parallel to `ReadShowGround` / `WriteShowGround`:

```cpp
static int ReadGroundTexture(int defaultValue)
{
    HKEY hKey;
    if (RegOpenKeyEx(HKEY_CURRENT_USER, L"Software\\AloParticleEditor", 0,
                     KEY_READ, &hKey) == ERROR_SUCCESS)
    {
        DWORD value;
        DWORD type, size = sizeof(value);
        if (RegQueryValueEx(hKey, L"GroundTexture", NULL, &type,
                            (LPBYTE)&value, &size) == ERROR_SUCCESS
            && type == REG_DWORD && size == sizeof(value)
            && value < (DWORD)Engine::kGroundTextureCount)
        {
            RegCloseKey(hKey);
            return (int)value;
        }
        RegCloseKey(hKey);
    }
    return defaultValue;
}

static void WriteGroundTexture(int index)
{
    HKEY hKey;
    if (RegCreateKeyEx(HKEY_CURRENT_USER, L"Software\\AloParticleEditor", 0, NULL,
                       REG_OPTION_NON_VOLATILE, KEY_WRITE, NULL, &hKey, NULL)
        == ERROR_SUCCESS)
    {
        DWORD value = (DWORD)index;
        RegSetValueEx(hKey, L"GroundTexture", 0, REG_DWORD,
                      (const BYTE*)&value, sizeof(value));
        RegCloseKey(hKey);
    }
}
```

The `value < kGroundTextureCount` guard means a corrupt or future-version registry value (e.g. set to 99 by hand) is silently rejected and the default is used — no crash, no out-of-range texture-lookup, no need for a "did the user tamper" check at the engine side.

Startup load in `WM_CREATE` / engine-init sequence ([src/main.cpp:4044](src/main.cpp:4044)–4045 area):

```cpp
info->engine->SetGroundTexture(ReadGroundTexture(0));
ComboBox_SetCurSel(info->hGroundTextureCombo, info->engine->GetGroundTexture());
```

The `Set → Get → ComboBox_SetCurSel` round-trip catches the edge case where the registry value was in-range but the texture failed to load (engine fell back to 0); the combobox UI reflects the actual loaded state, not the requested one.

### E. Reset View Settings integration

The existing reset handler at [src/main.cpp:1566](src/main.cpp:1566)–1606 currently:
1. Confirms via MessageBox.
2. Resets Engine state (background colour, show-ground flag, ground Z).
3. Updates UI controls (color button, toolbar check, ground Z spinner).
4. Deletes registry values via the sweep at [src/main.cpp:3075](src/main.cpp:3075).

MT-2 additions:
- Reset handler: `info->engine->SetGroundTexture(0); ComboBox_SetCurSel(info->hGroundTextureCombo, 0);`
- Confirm dialog text: extend "Reset background color, ground plane visibility, ground Z offset, bloom, and the color picker's custom colors to defaults?" → "...ground texture, ..."
- Registry sweep at line 3075: add `RegDeleteValue(hKey, L"GroundTexture");`

---

## Risks named up front + mitigations + tripwires

Each risk: what breaks, when, why → code-level mitigation → the verification step that bites if the mitigation regresses.

1. **Lost-device recovery loses the user's selection.** The existing recovery path at [src/engine.cpp:1138](src/engine.cpp:1138) re-loads `IDB_GROUND` via `D3DXCreateTextureFromResource`. If the new code doesn't intercept that path, an Alt-Tab / fullscreen toggle / display-mode change would silently reset the ground to dirt.
   - *Mitigation*: route every load through `ReloadGroundTexture()` which consults `m_groundTextureIndex`. The init path, the lost-device path, and the public setter all go through the same helper.
   - *Tripwire R1*: pick "Sand" → Alt-Tab away → return. Ground stays as sand. If it reverts to dirt, the recovery path isn't going through `ReloadGroundTexture`.

2. **Resource leak on repeated SetGroundTexture.** `D3DXCreateTextureFromResource` returns an `IDirect3DTexture9*` that needs `Release` when no longer needed. If `SetGroundTexture` overwrites `m_pGroundTexture` without releasing the prior, every change leaks ~256KB of GPU memory.
   - *Mitigation*: `ReloadGroundTexture` loads INTO a local `pNew`, only assigns to `m_pGroundTexture` after `SAFE_RELEASE`ing the prior, so even on `pNew` failure the existing texture is preserved (no transient null state).
   - *Tripwire R2*: in a debug build, cycle through all 6 textures back-to-back 100 times via the combobox. RSS should be stable; no GPU memory accumulation.

3. **Invalid registry value crashes the engine on startup.** A corrupt or hand-edited `HKCU\Software\AloParticleEditor\GroundTexture` set to e.g. `99` would, without bounds-checking, lookup past `kResourceIds[99]` and crash.
   - *Mitigation*: `ReadGroundTexture` bounds-checks with `value < kGroundTextureCount` and returns the default on failure. `SetGroundTexture` also bounds-checks. Layered defence.
   - *Tripwire R3*: manually write `99` to the registry value, restart editor — loads dirt without crashing or printing a misleading error.

4. **Texture-load failure mid-cycle (e.g. resource corruption / engine in a weird state).** If `D3DXCreateTextureFromResource` returns failure for a non-default resource, the current `m_pGroundTexture` remains valid (mitigation R2) but `m_groundTextureIndex` is left wrong, leading to a state mismatch between the combobox / registry and the actually-loaded texture.
   - *Mitigation*: on failure, `ReloadGroundTexture` retries with index 0 (single retry; not infinite). If index 0 also fails, return false and leave the engine flagged as "ground unavailable" — caller (combobox handler) syncs UI to index 0 on `SetGroundTexture` returning false.
   - *Tripwire R4*: temporarily comment out one of the RCDATA resource lines in `.rc` and rebuild. Verify the editor still starts (loads dirt) and the combobox returns to dirt when that entry is picked.

5. **Combobox layout overflows on narrow windows.** The top bar already has 4 controls fighting for right-edge space ([src/main.cpp:2425](src/main.cpp:2425)–2433). Adding a ~100 px combo + label pushes everything left; at narrow client widths the controls may overlap the "Leave particles" checkbox.
   - *Mitigation*: layout math anchors all top-bar controls from the right edge, with a minimum spacing between groups. If `clientWidth < threshold`, the combo's preferred width drops (e.g. to 70 px), and at very narrow widths the combo's label is hidden, leaving just the combo. Acceptable degradation.
   - *Tripwire R5*: drag the window narrower than 800 px wide. Controls stay readable and clickable; no overlap.

6. **Stale combobox state after `Reset View Settings`.** The reset path resets Engine internals but if the combobox UI isn't also reset, the user sees "Sand" in the dropdown while the engine renders dirt.
   - *Mitigation*: reset path explicitly calls `ComboBox_SetCurSel(info->hGroundTextureCombo, 0)` after `SetGroundTexture(0)`. Same pattern as the existing ColorButton + ground-Z spinner reset.
   - *Tripwire R6*: pick "Metal", run View → Reset View Settings → combo reads "Dirt" AND engine renders dirt.

7. **Texture not loaded yet during very-early UI interaction.** The combobox is created in `WM_CREATE` before the Engine finishes initialising. If the user somehow clicks the combo (extreme timing) before engine init completes, `SetGroundTexture` is called on a NULL engine.
   - *Mitigation*: combobox notification handler null-checks `info->engine` before calling `SetGroundTexture`. The pattern is already used for `hBackgroundBtn` at [src/main.cpp:2212](src/main.cpp:2212) ("if (hControl == info->hBackgroundBtn && info->engine != NULL)").
   - *Tripwire R7*: combobox change handler asserts that `info->engine != NULL` before dispatching; debug-build crash if violated.

8. **Bundled bitmap is the wrong size / pixel format / not a BITMAP.** A misnamed or wrong-format file in `Resources/` would compile fine (the `.rc` doesn't validate) but `D3DXCreateTextureFromResource` would fail at runtime.
   - *Mitigation*: ship each bundled texture as a real .bmp file (uncompressed RGB or RGBA). Test in a debug build at startup that each `kResourceIds[i]` loads without printing the `[Ground] texture load failed` warning.
   - *Tripwire R8*: at app start in a debug build, sequentially call `SetGroundTexture(0..5)` once each and verify no `[Ground] texture load failed` lines in the AllocConsole.

9. **Future texture additions require updating two places.** The `kResourceIds[]` lookup table in `ReloadGroundTexture` and the combobox population in `WM_CREATE` both enumerate the 6 textures. Adding a 7th requires touching both.
   - *Mitigation*: keep both in sync via the `kGroundTextureCount` constant and a comment cross-referencing the two sites. A debug-only `static_assert` keeps the constant in agreement with the array literal.
   - *Tripwire R9*: in a debug build, `static_assert(sizeof(kResourceIds) / sizeof(kResourceIds[0]) == kGroundTextureCount, "ground texture list drift")`. Fires at compile time if the array length doesn't match.

10. **Mid-render texture change while a frame is in flight.** `m_pGroundTexture` is read in `RenderFrame` per frame ([src/engine.cpp:581](src/engine.cpp:581)). If `SetGroundTexture` is called between frames, no issue. If called on a different thread mid-frame, classic data race. *(Not a concern in practice — the editor's render loop and the UI message pump run on the same thread.)*
    - *Mitigation*: existing single-threaded UI/render loop means SetGroundTexture is never called mid-frame. Document the implicit invariant in the Set function's comment.
    - *Tripwire R10*: not test-able (single-threaded by design). Documented invariant only.

---

## Verification

Each row says **the regression it catches**.

### A. Bundled-texture availability

- **A1.** Open the editor → combobox shows 6 entries: Dirt, Grass, Sand, Snow, Metal, Void. *Catches: missing string-table entry; missing combobox population.*
- **A2.** Select each of the 6 → ground renders with the corresponding texture; no crash, no visual artefacts. *Catches: missing RCDATA resource; wrong resource ID; unsupported file format inside the RCDATA blob.*
- **A3.** Default-installed editor (no registry entry yet) → starts with Dirt selected. *Catches: default-index regression; bad fallback in `ReadGroundTexture`.*

### B. Persistence

- **B1.** Pick Sand → close editor → reopen → still on Sand. *Catches: WriteGroundTexture not called; registry value not written or wrong type.*
- **B2.** Pick Snow → restart editor → still on Snow. *Catches: same as B1, different value.*
- **B3.** Pick Dirt (default) → close → reopen → still on Dirt. *Catches: writer not storing index 0 explicitly; reader misreading 0 as "not set".*
- **B4.** Manually corrupt the registry value (write `99` via `regedit`) → restart → editor loads with Dirt. *Catches: missing bounds check (R3 tripwire).*
- **B5.** Manually write a `REG_SZ` instead of `REG_DWORD` for `GroundTexture` → restart → editor loads with Dirt. *Catches: missing type check in `ReadGroundTexture`.*

### C. Engine integration

- **C1.** Engine init → `m_groundTextureIndex = 0` → first paint uses dirt. *Catches: constructor not initialising the index; init order issue.*
- **C2.** Alt-Tab away from the editor → Alt-Tab back → ground stays the same as before (Sand, etc.). *Catches: lost-device recovery not consulting `m_groundTextureIndex` (R1 tripwire).*
- **C3.** Minimise window → restore → ground unchanged. *Catches: minimise → device-lost recovery path different from Alt-Tab.*
- **C4.** Change DPI in Windows settings → restart editor → ground texture displays correctly (DPI doesn't affect texture, just rendering target). *Catches: DPI-dependent resource path.*
- **C5.** Cycle through all 6 textures via combobox 100 times rapidly → no crash, no memory leak (RSS stable). *Catches: leak on repeated SetGroundTexture (R2 tripwire).*

### D. UI behaviour

- **D1.** Toolbar layout — combobox visible at default window size; doesn't overlap other controls. *Catches: hardcoded X coordinates; layout math regression.*
- **D2.** Resize window narrower (down to ~600 px) → combobox shrinks or compacts; nothing overlaps. *Catches: layout overflow (R5 tripwire).*
- **D3.** Resize window wider → controls space out; combobox stays at preferred width. *Catches: combobox absorbing excess space; bad anchoring.*
- **D4.** Combobox keyboard navigation: Tab focuses it; arrow keys cycle entries; Enter commits. *Catches: missing WS_TABSTOP; combobox style wrong.*
- **D5.** Click outside the combobox while it's expanded → dropdown closes without changing selection. *Catches: combobox style accepting clicks-elsewhere as commit.*

### E. Reset View Settings interaction

- **E1.** Pick Metal → View → Reset View Settings → Yes → combobox returns to Dirt AND engine renders dirt. *Catches: reset not extended for ground texture (R6 tripwire).*
- **E2.** Pick Metal → View → Reset View Settings → No (cancel) → combobox unchanged at Metal, engine still rendering metal. *Catches: cancel path still applying reset.*
- **E3.** After Reset, restart editor → loads with Dirt (registry deleted). *Catches: reset not deleting registry value.*

### F. Engine API + degenerate

- **F1.** `SetGroundTexture(-1)` → returns false, no state change. *Catches: missing negative-bounds check.*
- **F2.** `SetGroundTexture(kGroundTextureCount)` (out of range) → returns false, no state change. *Catches: off-by-one in bounds check.*
- **F3.** `SetGroundTexture(0)` when already at 0 → returns true, no texture reload (cheap fast-path). *Catches: redundant work on no-op set.*
- **F4.** Force a load failure (rename `metal.bmp` in build dir; doesn't apply to release build — only relevant in debug iteration) → `SetGroundTexture(4)` returns false; combobox handler resets to 0; engine renders dirt. *Catches: load-failure fallback (R4 tripwire).*

### G. Theme / DPI

- **G1.** Run editor under Windows High Contrast theme → combobox uses system theming; entries readable. *Catches: hardcoded colours.*
- **G2.** Run editor at Windows 175% DPI → combobox dimensions scale; entries readable. *Catches: hardcoded pixel sizes ignoring DPI (similar to MT-9 lessons).*

### H. Composite scenarios

- **H1.** Build a particle effect that uses transparent particles (alpha blending). Switch ground texture to **Void** → particles visible against pure black; can judge their actual rendered alpha. Catches the canonical use case the user mentioned at MT-2 ROADMAP entry time.
- **H2.** Load a Hoth-themed .alo file → switch ground to **Snow** → visual match. Save & reopen — particle data unchanged (ground texture is not persisted to .alo).
- **H3.** Open File → New → fresh empty system → combobox state preserved (persistent setting, not per-system).

### I. Debug instrumentation

Under `#ifndef NDEBUG`:

- `[Ground] texture set index=N` — fires on each successful SetGroundTexture.
- `[Ground] texture load failed index=N falling back to default` — fires on load failure; should NEVER appear in release-quality bundled bitmaps.

---

## Implementation order (test-as-you-go)

Each milestone ends at a commit boundary; verify the listed categories pass before moving on.

1. **Engine API skeleton**: add `m_groundTextureIndex`, the kResourceIds lookup table (placeholder — all entries set to `IDB_GROUND` until milestone 2 lands real bitmaps), `SetGroundTexture`, `ReloadGroundTexture`. Verify **A2 (Dirt only — all 6 indices resolve to dirt initially), C1, C5, F1–F3, F4 (forced failure)**. **Commit boundary.**
2. **Resource additions**: 5 new BMP files in `src/Resources/`, .rc entries, vcxproj entries, resource.h IDs. Real textures (per Open Q1). Update the kResourceIds lookup table to use the new IDs. Verify **A1, A2 (all 6 distinct), I (no LOW_CONTRAST or load_failed lines at startup)**. **Commit boundary.**
3. **UI combobox**: hGroundTextureCombo creation in WM_CREATE, layout in WM_SIZE, CBN_SELCHANGE handler, string-table entries. Verify **D1–D5, A1, A2**. **Commit boundary.**
4. **Persistence**: ReadGroundTexture / WriteGroundTexture; startup-load integration; CBN_SELCHANGE writes. Verify **B1–B5, F4**. **Commit boundary.**
5. **Lost-device recovery integration**: ensure both lost-device paths route through `ReloadGroundTexture`. Verify **C2, C3**. **Commit boundary.**
6. **Reset View Settings integration**: extend the handler + the registry sweep + the confirm dialog text. Verify **E1, E2, E3**. **Commit boundary.**
7. **ROADMAP + CHANGELOG + final sweep**. Verify **H1, H2, H3**. **Squash to a single MT-2 commit on the feature branch before merge.**

---

## Delivery shape

- **Branch**: `feat/mt2-selectable-ground` off `master`.
- **Files touched**:
  - [src/engine.h](src/engine.h), [src/engine.cpp](src/engine.cpp) — `SetGroundTexture` / `GetGroundTexture` / `ReloadGroundTexture` + `m_groundTextureIndex` + ID lookup table; rewire init + lost-device paths.
  - [src/main.cpp](src/main.cpp) — `hGroundTextureCombo` field, creation, layout, CBN_SELCHANGE handler, `ReadGroundTexture` / `WriteGroundTexture`, Reset View Settings integration, registry sweep extension.
  - [src/ParticleEditor.rc](src/ParticleEditor.rc) — 5 new RCDATA lines + migrate existing `IDB_GROUND` BITMAP → RCDATA.
  - [src/ParticleEditor.en.rc](src/ParticleEditor.en.rc), [src/ParticleEditor.de.rc](src/ParticleEditor.de.rc) — 6 new `IDS_GROUND_*` string-table entries.
  - [src/Resources/resource.h](src/Resources/resource.h) — 5 new `IDB_GROUND_*` IDs.
  - [src/Resources/resource.en.h](src/Resources/resource.en.h), [src/Resources/resource.de.h](src/Resources/resource.de.h) — 6 new `IDS_GROUND_*` IDs.
  - [src/Resources/](src/Resources/) — 5 new `.bmp` files (`grass.bmp`, `sand.bmp`, `snow.bmp`, `metal.bmp`, `void.bmp`).
  - [src/ParticleEditor.vcxproj](src/ParticleEditor.vcxproj) and `.filters` — 5 new `<Image Include>` entries.
- **Estimated delta**: ~250 LOC (engine API ~60, UI wiring ~80, persistence ~50, reset integration ~20, resource declarations + IDs ~40). Plus 5 BMP binary files.
- **No new files** beyond the .bmp resources. No file-format changes; no .alo-level state.
- **Single PR**. Phases 1–4 are tractable to review as one diff; the texture-art bullet is a separable concern but the .bmp files are part of the same PR.
- **ROADMAP / CHANGELOG** updates per repo convention.

---

## Open questions for the user

**All resolved (2026-05-14). Plan locked. Awaiting BMP assets before starting implementation; can proceed with placeholder copies of `dirt.bmp` in the meantime so the API/UI/persistence is testable end-to-end before final art lands.**

- ✅ Q1 Texture sourcing → user-supplied. User provides `grass.bmp`, `sand.bmp`, `snow.bmp`, `metal.bmp`, `grey.bmp` BMP files. Until they arrive, I'll commit placeholder copies of `dirt.bmp` under each filename so the build works and the UI/persistence pipeline can be tested end-to-end.
- ✅ Q2 UI placement → top-bar combobox. Inserted between the existing Ground Z and Background controls.
- ✅ Q3 "Void / black" → replaced with **Grey** (neutral grey, useful as a colour-neutral reference for judging the actual hue of semi-transparent particle effects).
- ✅ Q4 BMP file size → flexible. 256–1024 px per side recommended; 2048 hard cap to keep .exe size sane. Mixed sizes across the 5 user-supplied textures are fine — tiling is governed by `TEXTURE_SCALE` in the vertex math, independent of source resolution.

### Two-phase delivery

Because the BMP assets and the code are independently sourced, the implementation splits into two phases:

1. **Phase 1 — code + placeholder assets.** All code (engine API, UI, persistence, reset integration) lands. The 5 new `.bmp` files exist on disk as copies of `dirt.bmp`. The combobox shows all 6 entries; selecting any one visually renders dirt (because all 5 placeholders ARE dirt). API + UI + persistence + lost-device + reset are all fully testable; just the visual differentiation isn't real yet. Verifies categories A1, A3, B1–B5, C1–C5, D1–D5, E1–E3, F1–F4, G1–G2 end-to-end.
2. **Phase 2 — real textures.** User supplies the 5 BMPs. I swap them in (just file-replace inside `src/Resources/`; .rc + .vcxproj entries are already in place from phase 1). Verifies A2 (each texture visually distinct) and H1–H2 (composite scenarios that depend on real visual content).

Phase 1 ships as the MT-2 PR (or as a draft PR pending phase 2). Phase 2 lands as a follow-up commit on master or a second PR — at the user's discretion.

(Original open-question text preserved below for historical reference. Skip past it.)

### Q1. Texture sourcing

The 5 new BMPs need actual image data. Three options:

| | Option A | Option B | Option C |
|---|---|---|---|
| **Approach** | I generate procedural placeholders (solid colour + noise + simple pattern) for v1 ship | User provides assets from existing game data / personal sources | Source from public-domain texture libraries (CC0 sites like Polyhaven, ambient-cg) |
| **Visual quality** | Adequate — clearly distinguishable, "good enough" | Highest — matches real game look | High — professional asset quality |
| **Effort cost** | ~30 min generation, zero attribution | Zero (you supply) | ~1 hour download + format conversion + attribution check |
| **Replaceable later** | Trivially — just swap .bmp files | n/a | n/a (already final) |

*Default recommendation: **Option A (procedural placeholders) for v1***, with a CHANGELOG note that the textures are placeholders pending real art. Future PR can swap in better assets without touching code.

### Q2. UI placement

The picker control's home:

| | Option A | Option B | Option C |
|---|---|---|---|
| **Where** | Combobox in the top toolbar bar, between Ground Z and Background controls | View menu submenu: View → Ground Texture → 1. Dirt / 2. Grass / ... | Toolbar button that opens a small popup-menu picker |
| **Discoverability** | Highest — always visible | Lower — hidden in menu | Medium |
| **Real estate** | Adds ~100 px to the top bar | Zero footprint | Adds ~24 px (button only) |
| **Pattern fit** | Matches Background colour button placement | Matches Show Ground / Reset Camera menu pattern | New pattern for this editor |

*Default recommendation: **Option A (top-bar combobox)***. Matches the existing Background colour button's discoverability; the top bar already has the related Ground Z and Background controls. Crowding risk addressed by R5 tripwire.

### Q3. Whether to include a "Void / black" option

The Void option (solid black) is useful for transparent-particle scenarios where the ground texture distracts. Alternatives:
- (a) Include Void (default per plan).
- (b) Skip Void; the user can already toggle ground visibility off entirely via `Show Ground` (Ctrl-G).
- (c) Include Void AND a "White" option for the inverse case.

*Default recommendation: **(a) Include Void***. `Show Ground` removes the entire ground plane (sometimes useful, sometimes not — the visible disc gives spatial reference even when black). Void preserves the spatial reference while removing visual interference.

### Q4. Bundled texture size

Existing `dirt.bmp` size is unknown without inspection. New textures should match for tiling consistency. Two options:
- (a) Inspect dirt.bmp size; match exactly.
- (b) Standardise on 512×512 RGB for all 6 (including replacing dirt.bmp if it's a different size).

*Default recommendation: **(a) Match dirt.bmp***. Less invasive — preserves the exact pre-MT-2 visual for Dirt. Switching dirt.bmp to a 512×512 version would risk a subtle visual change for existing users.

---

## After MT-2 ships

Medium-term queue:
- **MT-1** Frequently-used textures palette — 5–8 h
- **MT-3** Selectable skydome backgrounds — 8–14 h (largest medium-term item; adds a render pass)
- **MT-4** Adjustable environment lighting in the preview — 4–6 h

MT-2 establishes a small but useful pattern for future "preview-only persistent settings": registry-backed REG_DWORD, combobox-driven, Reset-View-Settings-integrated. MT-4's lighting controls and MT-1's textures palette can both lean on the same persistence pattern.
