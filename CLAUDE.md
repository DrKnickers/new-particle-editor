# Particle Editor — Build & Development Notes

## Project Overview

A DirectX 9 particle editor for Star Wars: Empire at War / Forces of Corruption modding. Written in C++ using Win32 and D3DX9. Built with Visual Studio 2022 (toolset v143), targeting x64 and Win32.

Solution: `ParticleEditor.sln`  
Main project: `src/ParticleEditor.vcxproj`

---

## Build Environment Requirements

- **Visual Studio 2022** (toolset `v143`). Newer VS releases (e.g. VS18/2026 Insiders) will silently bump this to a higher toolset (`v145`+) when you open the solution; revert any such change before committing or CI will fail with `MSB8020: build tools for v145 cannot be found`.
- **DirectX SDK June 2010** — must be installed. The project uses `$(DXSDK_DIR)` to find headers and libs. Install from: https://www.microsoft.com/en-us/download/details.aspx?id=6812
- **Windows 10 SDK** (10.0) — configured via `WindowsTargetPlatformVersion`
- MFC is **not** required

### Building

```
MSBuild ParticleEditor.sln /p:Configuration=Debug /p:Platform=x64
```

Or open the solution in Visual Studio and build normally.

---

## Resolved Build Issues

### 1. `afxres.h` not found

**Problem:** `.rc` files and `src/UI/UI.h` included `afxres.h`, an MFC header not present without the MFC workload.

**Fix:** Replaced `afxres.h` with `winres.h` in all `.rc` files. Removed the include entirely from `UI.h` (resource-compiler headers don't belong in C++ source).

**Files changed:**
- `src/ParticleEditor.rc`
- `src/ParticleEditor.en.rc`
- `src/ParticleEditor.de.rc`
- `src/UI/UI.h`

### 2. `d3dx9.h` not found

**Problem:** The project expected the DXSDK at `$(SolutionDir)libs\dx9\`, which didn't exist in the repo.

**Fix:** Updated all four build configurations in `src/ParticleEditor.vcxproj` to use the installed DXSDK via the `$(DXSDK_DIR)` environment variable (set automatically by the DXSDK installer):
- Include: `$(DXSDK_DIR)Include`
- Lib x86: `$(DXSDK_DIR)Lib\x86`
- Lib x64: `$(DXSDK_DIR)Lib\x64`

### 3. C4005 macro redefinition warnings (treated as errors)

**Problem:** After switching to `$(DXSDK_DIR)`, the DXSDK headers defined `RT_MANIFEST` and related manifest constants, which were then redefined by `winres.h` → `winuser.rh`, producing C4005 warnings that were fatal due to `TreatWarningAsError`.

**Root cause:** `winres.h` was incorrectly included in `src/UI/UI.h`. It's a resource-compiler header and must not appear in C++ translation units.

**Fix:** Removed `#include <winres.h>` from `src/UI/UI.h`. The `.rc` files still include it correctly (for the RC compiler only).

### 4. Undeclared MFC command IDs (`ID_FILE_NEW`, `ID_FILE_OPEN`, etc.)

**Problem:** These standard MFC command IDs were previously defined by `afxres.h`. After removing that header, they were undefined in both C++ code and the resource compiler.

**Fix:** Created `src/mfc_ids.h` with the standard MFC values:
```c
#define ID_FILE_NEW     0xE100
#define ID_FILE_OPEN    0xE101
#define ID_FILE_SAVE    0xE103
#define ID_FILE_SAVE_AS 0xE104
#define ID_EDIT_CUT     0xE123
#define ID_EDIT_COPY    0xE122
#define ID_EDIT_PASTE   0xE125
```
Included from:
- `src/resource.h` (for C++ code)
- All three `.rc` files (for the resource compiler, after `winres.h`)

---

## Runtime Requirements

### `d3dx9_43.dll`

The June 2010 DXSDK links against `d3dx9_43.dll`. Windows does **not** ship this DLL. It must be provided one of two ways:

**Option A — System install:**  
Install the DirectX End-User Runtime: https://www.microsoft.com/en-us/download/details.aspx?id=35

**Option B — Local (next to exe):**  
Extract from the DXSDK redist cab:
```
expand "C:\Program Files (x86)\Microsoft DirectX SDK (June 2010)\Redist\Jun2010_d3dx9_43_x64.cab" -F:d3dx9_43.dll <output_dir>
```
Place `d3dx9_43.dll` alongside the built `.exe`.

---

## Resource File Structure

Three RC files are compiled into the exe:
- `src/ParticleEditor.rc` — shared resources (bitmaps, shaders, icons); includes `Resources/resource.h`
- `src/ParticleEditor.en.rc` — English strings, menus, dialogs; includes `Resources/resource.en.h`
- `src/ParticleEditor.de.rc` — German strings, menus, dialogs; includes `Resources/resource.de.h`

Resource IDs are split across:
- `src/Resources/resource.h` — shared IDs (bitmaps, toolbar, ground texture, etc.)
- `src/Resources/resource.en.h` — English dialog/string/menu IDs (`IDR_MENU1`, `IDD_EMITTER_LIST`, `IDS_*`, etc.)
- `src/Resources/resource.de.h` — German equivalents
- `src/mfc_ids.h` — MFC standard command IDs (not auto-generated)
- `src/resource.h` — wrapper that includes all of the above for C++ code

---

## Debug Build Notes

The debug build calls `AllocConsole()` for a console window on launch. Exceptions are **not** caught at the WinMain level in debug builds (the try/catch is `#ifdef NDEBUG` only) — any unhandled exception will crash rather than showing a message box.

The app requires a game data path (Empire at War / Forces of Corruption installation) on first run. If the current directory doesn't contain `Data\MegaFiles.xml`, a folder browser dialog will appear asking for the game data location.

---

## x64 Porting Bugs

This codebase originated as Win32 and was ported to x64 for the VS2022 update. Two classic 32→64 bit pointer/integer bugs surfaced.

### 5. `(LONG)(LONG_PTR)` pointer truncation (caused startup hang/crash)

**Symptom:** App launched, console flashed, app exited. WM_INITDIALOG handlers ran successfully, but the next message (WM_SIZE) crashed before any handler code ran — because the dereferenced `control` pointer was garbage.

**Root cause:** The codebase stored pointers in window data via:
```cpp
SetWindowLongPtr(hWnd, GWLP_USERDATA, (LONG)(LONG_PTR)pointer);
```
On x64, `LONG` is still 32-bit but pointers are 64-bit. The `(LONG)` cast **truncated** the pointer; sign-extension on retrieval gave back garbage. WM_INITDIALOG worked because it used `lParam` directly; subsequent message handlers retrieved via `GetWindowLongPtr` and crashed.

**Fix:** Removed the `(LONG)` cast at all 20 sites across 9 files:
- `src/main.cpp`, `src/Rescale.cpp`
- `src/UI/EmitterList.cpp`, `src/UI/Emitter.cpp`, `src/UI/Spinner.cpp`
- `src/UI/TrackEditor.cpp`, `src/UI/RandomParam.cpp`
- `src/UI/ColorButton.cpp`, `src/UI/CurveEditor.cpp`

`(LONG_PTR)` alone is correct: it's 64-bit on x64, 32-bit on Win32.

**Exception:** In `src/UI/TrackEditor.cpp:365`, `control->iTrack = (int)(LONG_PTR)pcs->lpCreateParams` is correct as-is — that line *intentionally* narrows a small int that was packed into `lpCreateParams`.

### 6. `size_t` field receiving 32-bit `0xFFFFFFFF` sentinel (caused vector OOR on file open — ONGOING)

**Symptom:** `Debug Assertion Failed: vector subscript out of range` (vector header line 1931) when opening an `.alo` file.

**Root cause (partial):** `ParticleSystem::Emitter::spawnOnDeath` and `spawnDuringLife` are declared `size_t` (64-bit on x64). The file format stores them as 32-bit and uses `0xFFFFFFFF` as the "no emitter" sentinel. `readInteger()` returns `unsigned long` (32-bit). Assignment widens to `size_t` *without sign extension*: `0xFFFFFFFF` becomes `0x00000000FFFFFFFF`, not the all-ones `(size_t)-1` the rest of the code compares against. The check `if (spawnOnDeath != -1)` returns true, then `m_emitters[0xFFFFFFFF]` blows up.

**Fix:** In `src/ParticleSystem.cpp:475-476`, normalize the sentinel after reading:
```cpp
spawnOnDeath = readInteger(reader);
if (spawnOnDeath == 0xFFFFFFFF) spawnOnDeath = (size_t)-1;
```

---

### 7. Toolbar / tree-view icons missing

**Symptom:** Top toolbar (File new/open/save), emitter list toolbar, and treeview emitter icons all rendered blank.

**Root cause:** `ImageList_LoadImage` with `flags=0` silently failed on the project's 4bpp paletted bitmaps under modern comctl32 / x64. Adding `LR_CREATEDIBSECTION` made the load succeed but converted the bitmap to a 32bpp DIB, after which `ImageList_AddMasked`'s chroma-key match against `RGB(0,128,128)` no longer matched the converted pixels.

**Fix:** Replaced each `ImageList_LoadImage` with the legacy `LoadBitmap` (returns a DDB matching the screen format, which is what `ImageList_AddMasked` was designed for) + manual `ImageList_Create` + `ImageList_AddMasked`:

```cpp
HBITMAP hBmp = LoadBitmap(hInstance, MAKEINTRESOURCE(IDR_TOOLBAR1));
HIMAGELIST hImgList = ImageList_Create(16, 16, ILC_COLOR24 | ILC_MASK, 5, 0);
ImageList_AddMasked(hImgList, hBmp, RGB(0,128,128));
DeleteObject(hBmp);
```

Sites: `src/main.cpp` (top toolbar), `src/UI/EmitterList.cpp` (treeview imagelist + emitter list toolbar).

### 8. `TBBUTTON` size grew on x64 → toolbar buttons non-functional

**Symptom:** Icons rendered correctly, but clicking any toolbar button did nothing.

**Root cause:** `TBBUTTON::dwData` is 8 bytes on x64 (was 4 on Win32). Without `TB_BUTTONSTRUCTSIZE`, the toolbar control reads each entry at the old stride, so command IDs and indices come out garbled.

**Fix:** Send `TB_BUTTONSTRUCTSIZE, sizeof(TBBUTTON)` to every toolbar before `TB_ADDBUTTONS`. Three sites: top toolbar in `main.cpp`, emitter list toolbar and track-editor toolbar in `src/UI/`.

### 9. Z-write left enabled → particle render order flipped vs. game

**Symptom:** Editor preview rendered overlapping emitters in the opposite order from the actual game. Top-of-list emitter appeared on top of the stack instead of behind.

**Root cause:** `Engine::Render` enables `D3DRS_ZWRITEENABLE` for the ground plane and never resets it before particle passes. With Z-write on, the first particle drawn at any depth wins the depth test and occludes everything drawn after it at that depth — exactly inverse of painter's order.

**Fix:** `m_pDevice->SetRenderState(D3DRS_ZWRITEENABLE, FALSE)` once before the particle render loop in `engine.cpp`. Z-test stays on (so particles are still occluded by scene geometry), but particles no longer write to it, leaving emitter draw order to decide overlap stacking — matching the game.

---

## Game data path management

The editor expects to be pointed at an Empire at War / Forces of Corruption installation. The Steam Gold Pack splits assets across two siblings:
- `...\Star Wars Empire at War\GameData\` — base EaW
- `...\Star Wars Empire at War\corruption\` — FoC additions

Selected path is persisted to `HKEY_CURRENT_USER\Software\AloParticleEditor\GameDataPath` and re-read on launch.

**Sibling auto-add:** If the user picks one of those two folders, `AddSiblingGamePath` (in `main.cpp`) automatically also includes the other. Required because most particle textures live in the base game's `GameData\Data\Textures.meg`, but FoC-only models reference shaders/textures shipped in `corruption\Data\`.

**Default texture not loading?** Check the debug console for `[FM] Searching N megafiles for: ...` lines. If the path the editor is checking doesn't include both `GameData` and `corruption`, the sibling auto-add wasn't triggered (e.g. the saved registry path was ad-hoc, not one of those two).

---

## Mods menu

Top-level **Mods** menu inserted between **View** and **Help**, built dynamically at runtime (no `.rc` edits for the menu itself). Lists every subdirectory of `<game>\corruption\Mods\` and `<game>\GameData\Mods\`, alphabetical by folder name within FoC and base-game submenus.

### Hot-swap, no restart required

Selecting a mod prepends its folder to the file-resolution chain via `FileManager::SetModPath`. `getFile()` checks `<modpath>\<relpath>` as a `PhysicalFile` before iterating the regular base paths, so loose files in the mod folder shadow the base game's. The texture and shader caches (`TextureManager::Clear`, `ShaderManager::Clear`) are flushed on every selection so the next lookup re-reads from the new path. Currently-rendered emitter instances keep their existing `AddRef`'d textures until naturally re-fetched.

### Persistence

- `HKCU\Software\AloParticleEditor\LastMod` — selected mod path; empty / missing = Unmodded. Restored on launch if the folder still exists.
- `HKCU\Software\AloParticleEditor\ModNicknames` — value name = full mod folder path, value = user-set nickname.

### Right-click for nickname

`WM_MENURBUTTONUP` is **not** delivered for menubar dropdowns by default — Windows treats right-click as "cancel" and dismisses the menu silently. Three things made this work:

1. **`MNS_DRAGDROP` on the menu and submenus** (via `SetMenuInfo`). Without it, no message is sent.
2. **Defer the dialog with `EndMenu()` + `PostMessage(WM_APP_SHOW_NICKNAME)`.** Showing a modal dialog directly inside `WM_MENURBUTTONUP` fails because the menu's modal tracking loop is still tearing down. Posting the deferred message lets the menu finish closing first.
3. **Use a real `.rc` dialog (`IDD_MOD_NICKNAME`) shown via `DialogBoxParam`.** Hand-rolled in-memory `DLGTEMPLATE` is fragile (`id` is `WORD`, not `DWORD`, etc.); a resource dialog is reliable and adds proper i18n support to both `.en.rc` and `.de.rc`.

### Owner-drawn rendering for "FolderName *(nickname)*"

Plain Win32 menu items can't mix regular and italic text in a single label. Mod entries are inserted with `MFT_OWNERDRAW`, with the mod's index stashed in `dwItemData`. `WM_MEASUREITEM` sizes the item using `GetTextExtentPoint32` against both font variants; `WM_DRAWITEM` paints:
- Background (`COLOR_HIGHLIGHT` when `ODS_SELECTED`, else `COLOR_MENU`).
- Optional checkmark via `DrawFrameControl(DFC_MENU, DFCS_MENUCHECK)` when `ODS_CHECKED`.
- Folder name in the system menu font (from `SystemParametersInfo(SPI_GETNONCLIENTMETRICS).lfMenuFont`).
- `" (nickname)"` in an italic copy of that font when a nickname is set.

Both fonts are cached on `APPLICATION_INFO` (`hMenuFont`, `hMenuItalicFont`), lazy-init via `EnsureMenuFonts`.

---

## CI / GitHub Actions

Workflow at `.github/workflows/build.yml`. Builds `Debug` and `Release` × `Win32` and `x64` on `windows-latest`.

**Two non-obvious bits, both already wired up:**

1. **DirectX SDK is not pre-installed.** The `.vcxproj` references `$(DXSDK_DIR)` for `d3dx9.h` and the matching libs. The workflow installs the SDK via `choco install directx-sdk -y --no-progress` and exports `DXSDK_DIR` to `$GITHUB_ENV`. The notorious S1023 redistributable conflict has not bitten us in practice on `windows-latest`; if it ever does, the workaround is to first `Get-Package "Microsoft Visual C++ 2010*Redistributable*" | Uninstall-Package` before the choco install.
2. **Platform Toolset must be `v143`.** Newer Visual Studio releases (VS18 / VS2026 Insiders) silently bump `<PlatformToolset>` to `v145` when you open the solution. Stock VS2022 on the runner only has `v143`, so CI fails with `MSB8020: build tools for v145 cannot be found`. **Always revert the auto-bump in both `src/ParticleEditor.vcxproj` and `libs/expat-2.2.0/expatw_static.vcxproj` before committing.**

---

## Open Issues

- **Sporadic vector-subscript-out-of-range assertion** when opening some `.alo` files. The known case (32-bit `0xFFFFFFFF` widening into `size_t`) is fixed for `spawnOnDeath` / `spawnDuringLife`, but a similar assertion can still occasionally fire on file open with certain particle systems. Non-fatal — clicking **Ignore** on the assertion dialog lets the file load and the app remains fully usable. To root-cause: click **Retry** with VS attached for an exact stack trace, then look for any other 32-bit-to-`size_t` widening in the file-read path.
- **Mod-bundled megafiles** (`Mods\<name>\Data\MegaFiles.xml`) are not loaded. Most particle-overriding mods ship loose textures, which the loose-file path covers. Total conversions like Thrawn's Revenge or Awakening of the Rebellion that package particle assets in their own `.meg` would need a follow-up: extend `FileManager` with a `m_modMegafiles` vector that's searched before `m_megafiles`, populated/cleared on `SetModPath`.
