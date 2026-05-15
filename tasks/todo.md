# [MT-3] Selectable skydome backgrounds

**Status (2026-05-15):** plan draft, awaiting user approval. Target PR: `feat/mt3-skydome`.

Follows the planning conventions established for MT-1 / MT-2 / MT-4: Context block, per-artefact Architecture subsections, named tripwires per risk, verifier-first Verification where each row says *what regression it catches*, and a bite-sized Task Breakdown at the bottom for execution.

---

## Status of the surrounding work

- ✅ **[MT-4]** Adjustable environment lighting — [#71](https://github.com/DrKnickers/news-particle-editor/pull/71) (just shipped)
- ✅ **[MT-1]** Frequently-used textures palette — [#69](https://github.com/DrKnickers/new-particle-editor/pull/69)
- ✅ **[MT-2]** Selectable ground texture — [#67](https://github.com/DrKnickers/new-particle-editor/pull/67)
- 🚧 **[MT-3]** Selectable skydome backgrounds — **this plan**.

Last medium-term item; the queue empties once this ships.

---

## Context

The preview viewport currently clears to a flat colour ([src/engine.cpp:564-565](src/engine.cpp:564) — `D3DDevice9::Clear` with `m_background`). Pre-MT-3 the only way to influence the background is through the colour picker on the toolbar (`Background:`). MT-3 replaces that single-colour background with an optional **skydome**: a textured sphere centred on the camera that the camera orbits inside, so the viewport's empty space reads as a scene — space, day sky, sunset, indoor, etc. — rather than a flat fill.

The render integration is shallow: insert one new pass between the existing `Clear` and the ground render. The sphere is camera-locked (its world matrix is `Translation(camera.Position)`) so it stays "infinite" while the camera orbits the world origin where the particles live. Depth-test / depth-write off, no lighting, no fog — it's a background pass, nothing more.

The dialog UX matches the texture-palette popup's *visual style* (modeless tool window, owner-drawn thumbnail grid, blue hover / selection frames) but the *interaction model* matches the ground-texture picker (single-commit, only one slot is "active" at a time). 12 slots total laid out as a 4×3 grid: slot 0 is **Off** (disables the skydome pass, reverts to the flat-colour clear), slots 1–8 are bundled scenes (Space / Atmosphere / Sunset / Dawn / Night / Overcast / Studio / Indoor), slots 9–11 are user-customisable (file-picker on click of an empty slot, same pattern as MT-2's Custom 1/2/3).

Bundled textures live in `RCDATA` resources (`IDR_SKYDOME_*`), loaded via the existing `LoadGroundTextureFromResource` pattern. **Equirectangular 2D textures** (not cubemaps) — single image per skydome, simpler to source, simpler to load, no new cubemap path needed.

**Why now**: clears the last medium-term item. Once MT-3 ships, the queue is empty for medium-term and the next session can either pick up long-term LT-1/2/3/4 or do a near-term polish pass. Touches the render pipeline (new pass + new shader), but the integration point is well-isolated and the rest of the renderer doesn't see it.

---

## Goal + scope

**A new toolbar preview button** (`Skydome:` label + 24×24 owner-drawn preview, between the existing `Ground Texture:` button and `Ground Height:` spinner) shows the currently-selected skydome's thumbnail. Clicking the preview opens the **Skydome picker** dialog: a modeless `WS_EX_TOOLWINDOW` window with a 4×3 grid of 96×96 slot thumbnails, single-click commits + closes, position persists across sessions, modeless so the viewport stays interactive.

**Slot behaviour:**

- **Slot 0 — Off** — fixed; clicking it sets `m_skydomeIndex = 0`, disables the skydome render pass, reverts to flat-colour background. Thumbnail is a small "✕" glyph on the flat background colour.
- **Slots 1–8 — bundled scenes**: Space, Atmosphere, Sunset, Dawn, Night, Overcast, Studio, Indoor. Each is an equirectangular `.dds` (BC1 / DXT1 compressed) bundled via RCDATA. Click any to select.
- **Slots 9–11 — Custom 1 / 2 / 3** — start empty (greyed "+" placeholder). Single-click an empty slot → `GetOpenFileName` filtered to `*.dds;*.tga` (matching EaW's native texture formats — lets users point a custom slot directly at game environment textures with no conversion). On success the slot is populated, thumbnail rebuilds, slot becomes selected.
- **Right-click any slot** → context menu (only entries valid for the slot's state):
  - Empty custom slot: *Set custom skydome…*
  - Populated custom slot: *Change skydome…* / *Clear slot*
  - Bundled / Off slot: nothing (right-click is a no-op)
- **Reset all custom slots** button (bottom of dialog) → confirm prompt → wipes the 3 custom-slot paths only.
- **Reset View Settings** (View menu) → resets `SkydomeIndex` to `0` (Off) but **does not** wipe custom-slot paths (those are user data, same convention as MT-2).

**Render pipeline insertion** (in [src/engine.cpp:565](src/engine.cpp:565) area, after the Clear):

```
D3DDevice9::Clear (background colour, ZBUFFER)
  │
  ↓
SkydomePass (if m_skydomeIndex != 0)
  • SetVertexBuffer (sphere)
  • SetIndexBuffer  (sphere)
  • SetWorld = Translation(camera.Position)   ← locked to camera
  • SetTexture (m_skydomeTexture)
  • SetRenderState: ZWRITE off, ZTEST off, CULL_CW (we see the sphere from inside)
  • Effect "Skydome.fx" sample-and-output
  • DrawIndexedPrimitive
  │
  ↓
Ground plane (existing)
  ↓
Particles (existing)
  ↓
Bloom / Distortion (existing — skydome contributes to bloom naturally)
```

**Sphere mesh**: hand-rolled UV sphere, 32 longitude × 16 latitude segments → 512 triangles. Generated once at engine init into `m_pSkydomeVB` / `m_pSkydomeIB`, lives until shutdown.

**Shader** ([src/Resources/Engine/Skydome.fx](src/Resources/Engine/Skydome.fx)): new `.fx` bundled via RCDATA (`IDR_SHADER_SKYDOME`). Vertex shader transforms sphere into clip space; pixel shader samples the equirectangular texture via UV (latitude → V, longitude → U). One technique, one pass, no lighting.

**Persistence** under `HKCU\Software\AloParticleEditor`:

| Key | Type | Default | Notes |
|---|---|---|---|
| `SkydomeIndex` | REG_DWORD | `0` (Off) | Active slot 0..11 |
| `SkydomeCustomSlot9` | REG_SZ | (empty) | Custom 1 path |
| `SkydomeCustomSlot10` | REG_SZ | (empty) | Custom 2 path |
| `SkydomeCustomSlot11` | REG_SZ | (empty) | Custom 3 path |
| `SkydomePickerPos` | REG_BINARY (RECT) | (none — first run centres on owner) | Dialog position |

**In:**

- **Engine:** sphere VB/IB generation, skydome texture state (`m_skydomeTexture` + path + index + slot paths), `SkydomeRender()` helper, integration into `Engine::Render` between Clear and ground, public API (`SetSkydomeSlot`, `GetSkydomeSlot`, `SetSkydomeCustomPath`, `GetSkydomeCustomPath`, `IsSkydomeSlotEmpty`, `ReloadSkydomeTexture`), thumbnail generator (`MakeSkydomeSlotThumbnail` — same shape as `MakeGroundSlotThumbnail`).
- **Shader:** new `Engine/Skydome.fx` with `Sample()` technique. Equirectangular sampling via `atan2(direction.x, direction.z) / TWO_PI + 0.5` for U, `asin(direction.y) / PI + 0.5` for V (standard equirectangular projection).
- **UI:** toolbar preview button (`IDC_SKYDOME_PREVIEW`, between Ground Texture preview and Ground Height spinner), `IDD_SKYDOME_PICKER` dialog template (similar to `IDD_GROUND_TEXTURE_PICKER` but 4×3 grid + larger thumbnails + 1 reset button), `SkydomePickerDlgProc` modeless lifecycle (lazy create, hide on close, position persisted), thumbnail rebuild on selection change.
- **Resource bundling:** 8 new `IDR_SKYDOME_{SPACE,ATMOSPHERE,SUNSET,DAWN,NIGHT,OVERCAST,STUDIO,INDOOR}` RCDATA entries pointing to `Resources/skydomes/*.dds`. 1 new `IDR_SHADER_SKYDOME` RCDATA pointing to `Resources/Engine/Skydome.fx`. **Note**: the 8 `.dds` files themselves are an asset-authoring deliverable — see "Pre-implementation assets" below.
- **Reset View Settings integration**: clear `SkydomeIndex` registry value, set engine to slot 0 (Off), update toolbar preview.
- **Localised resources:** dialog template + toolbar label in both `.en.rc` and `.de.rc` (German strings as English placeholders per project convention).
- **Debug instrumentation** under `#ifndef NDEBUG`: `[Skydome] select slot=%d path='%s'`, `[Skydome] reload texture path='%s' result=%s`, `[Skydome] dialog show pos=(%d,%d)`, `[Skydome] dialog hide pos=(%d,%d)`, `[Skydome] render pass skipped (Off)`, `[Skydome] sphere mesh init verts=%d tris=%d`.

**Out:**

- **Cubemap (6-face) skydomes.** *Reason: equirectangular is simpler to source, simpler to load (no new D3DXCreateCubeTexture path needed), simpler to thumbnail. If a power user needs cubemap support later, that's a follow-up that adds a second loader path.*
- **HDR skydome rendering with proper tone-mapping.** *Reason: the engine renders LDR throughout. Bundled assets ship as DXT1 (8-bit per channel). If users want HDR, they can supply a `.hdr` file as a custom slot — D3DX9 decodes it to LDR on load, which is good enough for preview.*
- **Skydome rotation control.** *Reason: skydome rotates automatically with the camera (camera-locked transform). Adding a separate "yaw the sky" control adds UI complexity for limited value — users can rotate the camera if they want to see a different angle of the sky.*
- **Skydome → directional-light coupling** (e.g., a "sunset" sky auto-shifts the sun direction). *Reason: that's MT-4 territory; MT-3 is a pure background pass. Manual coupling via the Lighting panel is the user's call.*
- **Per-mod custom slot paths.** *Reason: skydomes are scene/view settings, not mod assets. Registry-global (under `AloParticleEditor`) is consistent with how the existing background colour, ground colour, and bloom settings work.*
- **Animated / time-of-day skydomes** (cycling between Dawn → Atmosphere → Sunset → Night). *Reason: out of scope; static-image swap is the v1 goal.*
- **Skydome ground reflection.** *Reason: ground texture renders separately; reflection would require a render-to-texture pass on the ground material, which is much bigger scope.*
- **Disabling bloom on skydome pixels.** *Reason: the skydome renders into the same scene RT as everything else, so bloom processes it naturally. If users find a particular sky too bloomy, they can lower the bloom strength or pick a less bright skydome.*

**Pre-implementation assets (not part of the code change):**

8 equirectangular `.dds` skydome textures, BC1/DXT1 compressed, recommended 2K resolution (2048×1024) → ~1.5 MB each → ~12 MB total in the .exe. Source files belong in `src/Resources/skydomes/{space,atmosphere,sunset,dawn,night,overcast,studio,indoor}.dds`. Authoring options:

- **Source royalty-free / CC0 equirectangular HDRIs** from sites like Polyhaven (CC0), convert via DirectX Texture Tool (`texconv.exe`) to BC1 DDS at 2K.
- **Generate procedurally** for the v1 ship — simple gradient skies driven by colour ramps (space = stars on black, atmosphere = blue-to-white vertical gradient, sunset = orange-red horizon, etc.). Programmatically generated DDS files via a small `tools/generate_skydome_textures.py` script (analogous to `tools/generate_pin_badge.py` from MT-1).

The plan below assumes the 8 `.dds` files exist on disk at implementation time. **Recommend generating placeholder procedural textures first to unblock implementation**, then swapping in real HDRI-sourced assets in a follow-up PR. The dialog and engine code don't care about the source.

---

## What we already have

| Piece | File:line |
|---|---|
| `D3DDevice9::Clear` with `m_background` | [src/engine.cpp:564-565](src/engine.cpp:564) |
| `Engine::Render` (the render-order skeleton) | [src/engine.cpp:492-763](src/engine.cpp:492) |
| Camera struct (Position / Target / Up) | [src/engine.h:86-90](src/engine.h:86) |
| Camera orbits Target — drag handlers | [src/main.cpp:2706-2825](src/main.cpp:2706) |
| Ground texture render (the closest analog: textured quad in 3D) | [src/engine.cpp:566-588](src/engine.cpp:566) |
| RCDATA texture loader pattern (`LoadGroundTextureFromResource`) | [src/engine.cpp:873-890](src/engine.cpp:873) |
| Shader effect loader (`Effect` class — FX file → ID3DXEffect) | [src/Effect.h](src/Effect.h), [src/Effect.cpp](src/Effect.cpp) |
| 14-shader load path | [src/engine.cpp:11-26](src/engine.cpp:11) — `ShaderNames[]` |
| Ground-texture picker dialog (MT-2 — the model to clone for MT-3) | [src/main.cpp:4312-4405](src/main.cpp:4312) |
| `MakeGroundSlotThumbnail` (the thumbnail generator pattern) | [src/main.cpp](src/main.cpp) — search `MakeGroundSlotThumbnail` |
| Ground texture toolbar preview button (`BS_OWNERDRAW`) + `WM_DRAWITEM` handler | [src/main.cpp](src/main.cpp) — search `hGroundTexturePreview` |
| Texture-palette popup window class registration (visual style reference) | [src/UI/TexturePalette.cpp:899-906](src/UI/TexturePalette.cpp:899) |
| Owner-draw cell pipeline (`AloPaletteContent` window class) | [src/UI/TexturePalette.cpp](src/UI/TexturePalette.cpp) — search `AloPaletteContent` |
| `WS_EX_TOOLWINDOW + WS_POPUPWINDOW + WS_CAPTION + WS_SYSMENU` chrome | [src/UI/TexturePalette.cpp:899](src/UI/TexturePalette.cpp:899) |
| Modeless dialog `IsDialogMessage` chain | [src/main.cpp:6347-6383](src/main.cpp:6347) |
| Reset View Settings handler | [src/main.cpp:1610-1700](src/main.cpp:1610) |
| Registry helpers (`Read/WriteBloomFloat`, `Read/WriteBloomEnabled`, etc. — pattern to clone) | [src/main.cpp:4411-4570](src/main.cpp:4411) |
| MT-2's Custom-slot file picker logic | [src/main.cpp](src/main.cpp) — search `IDC_GROUND_TEXTURE_LIST` + `GetOpenFileName` |

**Not yet in the codebase — to add:**

- **`src/Resources/Engine/Skydome.fx`** — new HLSL effect file. Vertex shader transforms sphere → clip space; pixel shader samples equirectangular texture via `atan2 / asin`.
- **`Engine::m_pSkydomeVB` / `m_pSkydomeIB`** — sphere mesh vertex + index buffers in [src/engine.h](src/engine.h).
- **`Engine::m_skydomeTexture`** — `IDirect3DTexture9*` for the active skydome (or `NULL` for Off).
- **`Engine::m_skydomeIndex`** — int slot index 0–11.
- **`Engine::m_skydomeCustomSlotPaths[3]`** — `std::wstring[3]` for the 3 custom slot paths.
- **`Engine::InitSkydomeMesh()`** — generates the UV sphere (called once in constructor).
- **`Engine::ReloadSkydomeTexture()`** — loads the texture for `m_skydomeIndex` (RCDATA for bundled, file for custom). Released and recreated on every slot change.
- **`Engine::RenderSkydome()`** — the new render pass (called from `Engine::Render` between Clear and ground).
- **`Engine::SetSkydomeSlot(int)` / `GetSkydomeSlot() const`** — public API.
- **`Engine::SetSkydomeCustomPath(int slot, const std::wstring&)` / `GetSkydomeCustomPath(int slot) const`** — public API for slots 9–11.
- **`Engine::IsSkydomeSlotEmpty(int)`** — true for slot 0 (Off) and unfilled custom slots.
- **8 bundled `.dds` files** in `src/Resources/skydomes/{space,atmosphere,sunset,dawn,night,overcast,studio,indoor}.dds`.
- **`IDR_SKYDOME_*` RCDATA entries** in [src/ParticleEditor.rc](src/ParticleEditor.rc).
- **`IDR_SHADER_SKYDOME` RCDATA entry** for the `.fx` file.
- **`IDD_SKYDOME_PICKER`** dialog template in [src/ParticleEditor.en.rc](src/ParticleEditor.en.rc) and [src/ParticleEditor.de.rc](src/ParticleEditor.de.rc).
- **`IDC_SKYDOME_PREVIEW`** toolbar control ID.
- **`IDC_SKYDOME_PICKER_LIST`** / **`IDC_SKYDOME_PICKER_RESET_CUSTOM`** / **`IDC_SKYDOME_PICKER_PATH_LABEL`** dialog control IDs.
- **`SkydomePickerDlgProc`** + **`ToggleSkydomePicker`** + **`MakeSkydomeSlotThumbnail`** + **`RebuildSkydomePreviewBitmap`** in [src/main.cpp](src/main.cpp).
- **`Read/WriteSkydomeIndex`** + **`Read/WriteSkydomeCustomPath`** + **`Read/WriteSkydomePickerPos`** registry helpers.
- **Slot-name string resources** (`IDS_SKYDOME_OFF`, `IDS_SKYDOME_SPACE`, ..., `IDS_SKYDOME_CUSTOM_BASE`).

*(All design questions resolved — see "Resolved decisions" at the bottom of the spec.)*

---

## Architecture / implementation approach

### A. Sphere mesh

A UV sphere with 32 longitude segments × 16 latitude segments (33 × 17 = 561 vertices, 32 × 16 × 2 = 1024 triangles). Generated once at engine init, lives in two D3D9 default-pool buffers:

```cpp
// src/engine.h
struct SkydomeVertex {
    D3DXVECTOR3 Position;
    D3DXVECTOR3 Normal;   // unused by shader but kept for FVF alignment
    D3DXVECTOR2 TexCoord; // (U, V) for equirectangular sampling
};

IDirect3DVertexBuffer9* m_pSkydomeVB;
IDirect3DIndexBuffer9*  m_pSkydomeIB;
DWORD                   m_skydomeIndexCount;
```

The UV unwrap places `(longitude / 2π, latitude / π + 0.5)` in TexCoord so the standard equirectangular texture maps correctly: U wraps around the sphere horizontally, V wraps from south pole (V=0) to north pole (V=1).

**Why hand-rolled instead of `D3DXCreateSphere`**: `D3DXCreateSphere` produces an `ID3DXMesh` with FVF `D3DFVF_XYZ | D3DFVF_NORMAL` — no texture coordinates. We need UVs for equirectangular sampling. Generating the mesh ourselves is ~30 lines of code and lets us match the existing `D3DPT_TRIANGLELIST + IDirect3DVertexBuffer9` pattern (the engine already speaks that language; `ID3DXMesh::DrawSubset` would be a one-off).

### B. Shader (`src/Resources/Engine/Skydome.fx`)

```hlsl
// Skydome.fx — samples an equirectangular environment texture onto a sphere
// rendered from inside.

float4x4 g_WorldViewProj : WORLDVIEWPROJECTION;
texture  g_Skydome;

sampler g_SkydomeSampler = sampler_state
{
    Texture = <g_Skydome>;
    MinFilter = LINEAR;
    MagFilter = LINEAR;
    MipFilter = LINEAR;
    AddressU  = WRAP;   // longitude wraps
    AddressV  = CLAMP;  // latitude clamps (avoids pole bleed)
};

struct VS_INPUT {
    float3 Position : POSITION;
    float3 Normal   : NORMAL;
    float2 TexCoord : TEXCOORD0;
};

struct VS_OUTPUT {
    float4 Position : POSITION;
    float2 TexCoord : TEXCOORD0;
};

VS_OUTPUT VS(VS_INPUT input)
{
    VS_OUTPUT o;
    o.Position = mul(float4(input.Position, 1.0), g_WorldViewProj);
    // Force the sphere to render at the far plane so depth-test (when on)
    // always passes for ground/particles. Even with ZTEST off this also
    // means the sphere never z-fights with anything.
    o.Position.z = o.Position.w * 0.9999;
    o.TexCoord = input.TexCoord;
    return o;
}

float4 PS(VS_OUTPUT input) : COLOR
{
    return tex2D(g_SkydomeSampler, input.TexCoord);
}

technique Skydome
{
    pass P0
    {
        VertexShader = compile vs_2_0 VS();
        PixelShader  = compile ps_2_0 PS();
    }
}
```

Loaded via the existing `Effect` infrastructure (`Effect::FromMemory` or equivalent). Handles cached at engine init: `hWorldViewProj`, `hSkydome` (texture parameter).

### C. Render pass insertion

In [src/engine.cpp:565](src/engine.cpp:565) area, immediately after the `Clear` call and before the ground render:

```cpp
// Existing:
m_pDevice->Clear(0, NULL, D3DCLEAR_TARGET | D3DCLEAR_ZBUFFER, clearColor, 1.0f, 0);

// NEW:
if (m_skydomeIndex != 0 && m_pSkydomeTexture != NULL && m_pSkydomeEffect != NULL)
{
    RenderSkydome();
}

// Existing:
if (m_showGround) { ... }
```

`RenderSkydome` body:

```cpp
void Engine::RenderSkydome()
{
    // World = Translation(camera.Position) — keeps the sphere camera-locked.
    D3DXMATRIX world, wvp;
    D3DXMatrixTranslation(&world, m_eye.Position.x, m_eye.Position.y, m_eye.Position.z);
    wvp = world * m_view * m_projection;

    // Restore state after to not pollute the rest of the render
    DWORD oldZWrite, oldZEnable, oldCull;
    m_pDevice->GetRenderState(D3DRS_ZWRITEENABLE, &oldZWrite);
    m_pDevice->GetRenderState(D3DRS_ZENABLE,      &oldZEnable);
    m_pDevice->GetRenderState(D3DRS_CULLMODE,     &oldCull);
    m_pDevice->SetRenderState(D3DRS_ZWRITEENABLE, FALSE);
    m_pDevice->SetRenderState(D3DRS_ZENABLE,      D3DZB_FALSE);
    m_pDevice->SetRenderState(D3DRS_CULLMODE,     D3DCULL_CW); // we're inside the sphere

    m_pSkydomeEffect->SetMatrix (m_hSkydomeWVP, &wvp);
    m_pSkydomeEffect->SetTexture(m_hSkydomeTex, m_pSkydomeTexture);

    UINT passes = 0;
    m_pSkydomeEffect->Begin(&passes, 0);
    m_pSkydomeEffect->BeginPass(0);

    m_pDevice->SetVertexDeclaration(m_pSkydomeDecl);
    m_pDevice->SetStreamSource(0, m_pSkydomeVB, 0, sizeof(SkydomeVertex));
    m_pDevice->SetIndices(m_pSkydomeIB);
    m_pDevice->DrawIndexedPrimitive(D3DPT_TRIANGLELIST, 0, 0,
                                    /* numVerts */ 561,
                                    0,
                                    m_skydomeIndexCount / 3);

    m_pSkydomeEffect->EndPass();
    m_pSkydomeEffect->End();

    m_pDevice->SetRenderState(D3DRS_ZWRITEENABLE, oldZWrite);
    m_pDevice->SetRenderState(D3DRS_ZENABLE,      oldZEnable);
    m_pDevice->SetRenderState(D3DRS_CULLMODE,     oldCull);
}
```

### D. State machine

`Engine::m_skydomeIndex` is the single source of truth. Slot 0 = Off, slots 1–8 = bundled, slots 9–11 = custom.

- `SetSkydomeSlot(int newIndex)`:
  - If newIndex == m_skydomeIndex, no-op (avoid reloading the same texture).
  - Release `m_pSkydomeTexture` (if held).
  - If newIndex == 0 → leave texture NULL, render pass skipped.
  - Else → call `ReloadSkydomeTexture(newIndex)` which either:
    - For bundled (1–8): `LoadGroundTextureFromResource(IDR_SKYDOME_<NAME>, &m_pSkydomeTexture)`.
    - For custom (9–11): `D3DXCreateTextureFromFileEx(m_skydomeCustomSlotPaths[newIndex - 9].c_str(), ..., &m_pSkydomeTexture)`. On failure, fall back to slot 0 (Off) and log.
- `m_skydomeIndex = newIndex` only if reload succeeded.

### E. Toolbar preview button

A 24×24 owner-draw button between `Ground Texture:` preview and `Ground Height:` spinner. `IDC_SKYDOME_PREVIEW`, style `BS_OWNERDRAW`. Same `WM_DRAWITEM` pattern as the ground-texture preview: cache a 24×24 HBITMAP thumbnail of the currently-selected skydome (Off slot shows the flat background colour with a small ✕ glyph), stretch-blit on paint, 1 px border, pressed / focus feedback. Rebuilt on:

- Startup (after engine reads initial slot from registry).
- Every successful slot change.
- Reset View Settings.

Layout: the toolbar reflow logic in `main.cpp` already handles positioning. Add the new button between the two existing controls and adjust their x-offsets by `kSkydomePreviewWidth + kGap` (~36 px).

### F. Picker dialog (`IDD_SKYDOME_PICKER`)

```rc
IDD_SKYDOME_PICKER DIALOGEX 0, 0, 432, 388
STYLE DS_SETFONT | WS_POPUP | WS_CAPTION | WS_SYSMENU
EXSTYLE WS_EX_TOOLWINDOW
CAPTION "Skydome"
FONT 8, "MS Shell Dlg"
BEGIN
    CONTROL         "",IDC_SKYDOME_PICKER_LIST,"SysListView32",
                    LVS_ICON | LVS_SHOWSELALWAYS | LVS_SINGLESEL | WS_TABSTOP,
                    8, 8, 416, 320
    LTEXT           "",IDC_SKYDOME_PICKER_PATH_LABEL,8,335,416,12,
                    SS_PATHELLIPSIS | SS_NOTIFY
    PUSHBUTTON      "Reset custom slots",IDC_SKYDOME_PICKER_RESET_CUSTOM,
                    300, 364, 124, 18
END
```

`SysListView32` in icon mode with a 12-entry `HIMAGELIST` (96×96 colour bitmaps). Each item's label is the slot's display name (`IDS_SKYDOME_OFF` / `IDS_SKYDOME_SPACE` / .../`IDS_SKYDOME_CUSTOM_BASE`+0..2). Right-click context menu (different entries per slot type) is wired via `WM_NOTIFY NM_RCLICK`.

Modeless lifecycle clones [src/main.cpp:4312-4405](src/main.cpp:4312) (ground picker):

- **Lazy create** on first toggle: `CreateDialogParamW(IDD_SKYDOME_PICKER, ...)`, store handle in `info->hSkydomePicker`.
- **Toggle**: show if hidden, hide if showing. Save position to registry on hide.
- **Esc / WM_CLOSE** → save position, hide (don't destroy).
- **Selection (`LVN_ITEMCHANGED`)** → live-update engine via `SetSkydomeSlot`, rebuild toolbar preview, refresh path label.
- **Reset View Settings** → if visible, post `WM_USER` to re-seed the selection from the freshly-reset engine state.

The dialog stays open after a click — modeless. To close, the user clicks Esc / the title-bar X. Same as MT-2.

### G. Thumbnail generator

`MakeSkydomeSlotThumbnail(int slot, int sizePx, const std::wstring& customPath)`:

- **Off (slot 0)** → procedural: solid-fill the current `m_background` colour, draw a small "✕" glyph centred. Width × height = sizePx. Used for the toolbar preview when Off is active, and for slot 0's grid entry.
- **Bundled (1–8)** → load the RCDATA texture via `D3DXCreateTextureFromFileInMemoryEx(..., D3DPOOL_SCRATCH, ...)` at the target size, `LockRect`, copy pixels into a `CreateDIBSection` HBITMAP. Cached in a `std::array<HBITMAP, 8>` filled at startup so we don't re-decode every paint.
- **Custom populated (9–11)** → same as bundled but reads from the user-supplied file path; cache invalidated when the path changes.
- **Custom empty (9–11)** → procedural: light-grey background + "+" glyph centred. Identical to MT-2's empty-custom-slot placeholder.

### H. Touch points by file

| File | Change |
|---|---|
| `src/engine.h` | Add skydome members (`m_skydomeIndex`, `m_pSkydomeTexture`, `m_pSkydomeVB`, `m_pSkydomeIB`, `m_pSkydomeDecl`, `m_pSkydomeEffect`, `m_hSkydomeWVP`, `m_hSkydomeTex`, `m_skydomeIndexCount`, `m_skydomeCustomSlotPaths[3]`); declare `SetSkydomeSlot` / `GetSkydomeSlot` / `SetSkydomeCustomPath` / `GetSkydomeCustomPath` / `IsSkydomeSlotEmpty` / `kSkydomeSlotCount` / `kSkydomeBundledCount` / `kSkydomeFirstCustomSlot`. |
| `src/engine.cpp` | `InitSkydomeMesh`, `InitSkydomeEffect`, `ReloadSkydomeTexture`, `RenderSkydome`, public API impls; hook into `Engine::Render` after Clear; cleanup in destructor / `Reset`. |
| `src/Resources/Engine/Skydome.fx` | **NEW** — the HLSL effect. |
| `src/Resources/skydomes/*.dds` | **NEW** — 8 bundled DDS textures (asset deliverable). |
| `src/ParticleEditor.rc` | Add `IDR_SKYDOME_*` (×8) + `IDR_SHADER_SKYDOME` RCDATA entries. |
| `src/Resources/resource.h` | Add `IDR_SKYDOME_*` + `IDR_SHADER_SKYDOME` + `IDC_SKYDOME_PREVIEW` + `IDC_SKYDOME_PICKER_*` + `IDS_SKYDOME_*` + `IDD_SKYDOME_PICKER` resource IDs. |
| `src/ParticleEditor.en.rc` | `IDD_SKYDOME_PICKER` dialog template; toolbar template addition; string-table entries for slot names. |
| `src/ParticleEditor.de.rc` | Same with English placeholder strings. |
| `src/main.cpp` | Toolbar preview button creation + `WM_DRAWITEM`; `SkydomePickerDlgProc` + `ToggleSkydomePicker`; `MakeSkydomeSlotThumbnail` + `RebuildSkydomePreviewBitmap`; registry I/O helpers; startup restore; Reset View Settings hook; `IsDialogMessage` chain; `hSkydomePicker` field in `APPLICATION_INFO`. |
| `src/ParticleEditor.vcxproj` | Add `Skydome.fx` + 8 DDS files as None / Content if MSBuild needs to track them (they're loaded via RCDATA so no explicit ItemGroup is needed beyond the .rc reference, but keep the project filters tidy). |

---

## Risks named up front + mitigations

1. **R1 — Skydome bundled textures balloon the .exe size.** 8 × 1.5 MB = ~12 MB added to the .exe. **Tripwire:** users on slow connections / Win Defender real-time scanning notice startup-launch lag, distribution archives bloat.
   **Mitigation:** DXT1 (BC1) compress every bundled texture during asset prep. 2K equirectangular DDS at BC1 is ~1.5 MB, well within tolerances. If the total still feels heavy, consider 1K (1024×512) for some scenes — Studio / Indoor don't need 2K. Document the compression target in the asset-prep section of the CHANGELOG. *No code-side mitigation needed — this is purely an asset-pipeline call.*

2. **R2 — Sphere shows visible polygonal seam at the back pole or texture wrap.** **Tripwire:** rotate the camera 180° and see a faint vertical seam where U wraps from 1.0 → 0.0, or a pinch at one of the poles where all UVs converge.
   **Mitigation:** the standard fix for the seam is to duplicate the vertices at U=0 with U=1 so the wrap is exact (no interpolation across the seam). 32 longitude segments means an extra 17 vertices (one per latitude row). The pole pinch is mathematically unavoidable for a UV sphere, but with `AddressV = CLAMP` and a texture that has a relatively uniform colour near the poles (sky textures usually do), it's not visible. Test specifically by rotating to look straight up / down.

3. **R3 — Camera-locked transform glitches when the camera moves between frames.** If `m_eye.Position` is sampled at a slightly different moment than the view matrix is computed, the skydome can "swim" relative to the scene as the camera rotates. **Tripwire:** orbit the camera quickly and see the skydome wobble or lag.
   **Mitigation:** sample `m_eye.Position` and compute `world * view * projection` *in the same frame* as the view matrix is set up (which is what the existing `Engine::Render` does at the top, before any draw calls). Use the same `m_view` / `m_projection` matrices the rest of the scene uses — don't recompute from `m_eye`. The render pass is in the right place to inherit this naturally.

4. **R4 — Shader compiles fine in Debug but fails on Release with different optimisation.** D3DX9 shader compilation has different defaults for Debug / Release. **Tripwire:** Debug build renders the skydome; Release build shows a black sphere because the effect failed to load.
   **Mitigation:** compile the shader with the same flags as the existing `Effect` infrastructure uses. Verify by building both configurations during pre-handoff (already part of the build script). The fallback when the effect fails to load is: log the error, set `m_pSkydomeEffect = NULL`, the render pass guards on it (`if m_pSkydomeEffect != NULL`) and skips silently. User sees the flat background instead of the skydome but the editor doesn't crash.

5. **R5 — Custom user-supplied texture is huge (e.g. 8K equirectangular) and causes a VRAM hitch on load.** **Tripwire:** click an 8K HDR file in the custom-slot picker, editor freezes for several seconds while D3DX9 decodes / resamples.
   **Mitigation:** `D3DXCreateTextureFromFileEx` with `D3DX_DEFAULT` for width/height lets D3DX9 pick a reasonable max texture size (caps at 4K on most cards). For very large user files, this is the bottleneck; document it in the dialog tooltip. No code-side mitigation beyond the existing async-load avoidance (the dialog blocks during the load, same as MT-2).

6. **R6 — Bloom + bright skydome (e.g., Space with stars) blows out the rest of the scene.** **Tripwire:** select Space + enable Bloom → particles look washed out.
   **Mitigation:** acceptable v1 behaviour. The user can lower bloom strength or pick a different sky. Document in the CHANGELOG; if it's a frequent complaint, a future PR can add a "skydome contributes to bloom" toggle (cheap to implement — just render skydome with bloom-RT disabled).

7. **R7 — Sphere is inverted (we see the OUTSIDE not the inside).** Standard sphere vertices have outward-pointing normals. With back-face culling, only outward-facing tris draw. We're inside → all tris are back-facing → everything gets culled → invisible sphere. **Tripwire:** render a skydome and see only the flat background colour (skydome invisible).
   **Mitigation:** explicitly `SetRenderState(D3DRS_CULLMODE, D3DCULL_CW)` in the render pass (default is CCW for front-facing). This is in the architecture sketch above; verify by selecting any non-Off slot and confirming the skydome renders.

8. **R8 — Toolbar preview button breaks the existing toolbar layout.** Adding a new control between two existing ones shifts every subsequent control by the new control's width. **Tripwire:** toolbar items overlap or get clipped after the change.
   **Mitigation:** the existing toolbar uses absolute pixel coordinates per `WM_SIZE` reflow. Add the new control's reservation to the existing layout-x bookkeeping. Verify visually after rebuild that no items overlap. The `Ground Texture:` button is the immediate predecessor; the existing pattern (`hGroundTexturePreview` placement code) is one place to clone.

9. **R9 — Dialog position lands off-screen after monitor topology change.** Same hazard as MT-1's popup and MT-4's lighting dialog. **Tripwire:** dialog opens but isn't visible anywhere.
   **Mitigation:** `MonitorFromPoint(MONITOR_DEFAULTTONULL)` validation on show; fall back to centre-on-owner if invalid. Reuse the same helper as the MT-4 / MT-2 dialogs.

10. **R10 — `Reset View Settings` clears `SkydomeIndex` but the toolbar preview doesn't refresh.** **Tripwire:** click Reset View Settings, the viewport reverts to flat background, but the toolbar still shows the previous skydome's thumbnail.
    **Mitigation:** in the Reset View Settings handler ([src/main.cpp:1610](src/main.cpp:1610) area), after the engine state is reset, explicitly call `RebuildSkydomePreviewBitmap(info)` and `InvalidateRect(info->hSkydomePreview, NULL, TRUE)`. Same pattern as how MT-2 refreshes the ground-texture preview in the reset handler.

11. **R11 — Effect parameter name collision between the new `Skydome.fx` and existing shaders.** Both might use `g_WorldViewProj` as the WVP matrix semantic. If the `Effect` class caches handles by name and there's a global state pool, one effect can clobber the other's binding. **Tripwire:** rendering the skydome corrupts another effect's matrices on the next frame.
    **Mitigation:** D3DX9 effects are independent objects; each effect's handles are scoped to its own `ID3DXEffect`. Cross-effect contamination requires shared state which we don't use. Verify by selecting a non-Off skydome and confirming both ground (different effect) and skydome render correctly without flicker.

---

## Testing & verification

Manual checklist. Each item names *what regression it catches*. Debug instrumentation: prefix `[Skydome]`.

### A. Sphere + shader basics

| # | Check | Catches |
|---|---|---|
| A1 | Cold launch with `SkydomeIndex` registry value missing — viewport shows flat background colour. `[Skydome] render pass skipped (Off)` logged. | Default state wrong; Off slot not really Off |
| A2 | Select bundled slot Space → viewport shows the Space texture wrapped around the camera. Rotate the camera 360° horizontally → the sky stays continuous (no seam). | R2 — UV seam at u=0/u=1 |
| A3 | Tilt the camera straight up (Tilt=90°) and straight down — visible textured sky at both poles, may show pinch but not black/garbage. | R2 — pole pinch unbounded |
| A4 | Move the camera (middle-drag) — the skydome moves WITH the camera (stays infinite). The ground plane and particles stay anchored. | R3 — camera-lock broken |
| A5 | Compile Release build, repeat A2. | R4 — shader Release compile divergence |
| A6 | Select Off slot → `[Skydome] render pass skipped (Off)` logged. Viewport reverts to flat background. | Off slot fails to disable pass |

### B. Slot interactions

| # | Check | Catches |
|---|---|---|
| B1 | Click toolbar preview button → picker dialog opens. 12 slots visible in a 4×3 grid. Slot 0 (Off) is the first cell with a ✕ glyph; slots 1–8 show bundled-scene thumbnails; slots 9–11 show empty "+" placeholders. | Layout wrong / thumbnails missing |
| B2 | Single-click a bundled slot (e.g. Sunset). Engine swaps to Sunset, toolbar preview updates to the Sunset thumbnail, dialog stays open (modeless). | Click handler / live update / sticky-modeless |
| B3 | Single-click slot 0 (Off). Engine disables skydome, toolbar preview shows the ✕-on-background-colour thumbnail, viewport reverts to flat fill. | Off slot wiring |
| B4 | Single-click an empty Custom slot. `GetOpenFileName` dialog opens with filter `.dds;.tga;.png;.hdr;.jpg`. Pick a file → slot populates, thumbnail rebuilds, slot becomes selected, skydome swaps. | File-picker wiring; populate-on-pick |
| B5 | Right-click a populated Custom slot. Context menu shows "Change skydome…" and "Clear slot". Click "Clear slot" → slot returns to empty "+" placeholder; if it was the active slot, engine falls back to Off. | Context menu wiring; clear-slot active-fallback |
| B6 | Right-click slot 0 / a bundled slot. Nothing happens (no context menu — right-click is a no-op for non-custom slots). | Context menu over-broad |
| B7 | Click "Reset custom slots" button → confirmation prompt → custom paths cleared, slots 9–11 empty. Bundled slots unchanged. If active slot was a now-cleared custom, engine falls back to Off. | Reset-custom scope and active-fallback |

### C. Persistence

| # | Check | Catches |
|---|---|---|
| C1 | Configure a non-default skydome (e.g., Atmosphere). Close editor. Restart. Toolbar preview and engine state reflect Atmosphere. | `SkydomeIndex` persistence |
| C2 | Populate a Custom slot with a file path. Close editor. Restart. Custom slot still has the path; thumbnail rebuilds. | Custom-path persistence |
| C3 | Manually edit registry to set `SkydomeIndex = 99` (out of range). Restart. Editor doesn't crash; falls back to Off. | Out-of-range defensive |
| C4 | Manually edit `SkydomeCustomSlot9` to a non-existent file path. Restart. Slot shows broken-placeholder thumbnail. If active, engine falls back to Off. | Missing-file defensive |
| C5 | Delete the entire `AloParticleEditor` registry key. Restart. All defaults loaded (Off, no custom paths). No crash. | Full-fresh-install |

### D. Reset behaviours

| # | Check | Catches |
|---|---|---|
| D1 | Configure a non-default skydome + populate Custom 1. View → Reset View Settings → confirm. Skydome resets to Off; toolbar preview reflects Off. **Custom 1 path is preserved** (user data, not view settings — same convention as MT-2). | Reset over-broad |
| D2 | Close picker. View → Reset View Settings. Reopen picker. Slot 0 (Off) is selected; Custom 1 still populated. | Persistence of customisation post-Reset View Settings |
| D3 | Reset View Settings prompt text mentions skydome alongside background/ground/bloom/lighting. | Prompt text drift |

### E. Toolbar + dialog interactions

| # | Check | Catches |
|---|---|---|
| E1 | Drag the dialog to a new screen position. Click X. Reopen via toolbar button. Dialog appears at the dragged position. | Position memory |
| E2 | Press Esc with focus in the dialog. Dialog hides; position preserved. | Esc → IDCANCEL routing |
| E3 | Manually edit `SkydomePickerPos` registry to (99999, 99999). Restart. Open picker. Dialog snaps to centre-on-owner default. | R9 — off-screen recovery |
| E4 | Open picker. Open Lighting / Bloom dialogs simultaneously. All work; no focus interference. | Modeless coexistence |
| E5 | Open picker. Switch mods via File → Mods → … . Picker stays open; skydome state is unchanged (scene-global, not per-mod). | R-scope; skydome shouldn't react to mod switch |

### F. Engine integration

| # | Check | Catches |
|---|---|---|
| F1 | Inspect `Engine::m_skydomeIndex` after startup with no registry — equals 0. `m_pSkydomeTexture == NULL`. | Default state correct |
| F2 | Select bundled slot — inspect `m_pSkydomeTexture` non-NULL after `SetSkydomeSlot` returns. Index updated. | State update correctness |
| F3 | Alt-Tab away and back (triggers lost device on D3D9). Skydome continues rendering correctly after device restore. | Lost-device recovery (the engine's existing pattern should handle this) |
| F4 | Run with a Visual Studio leak-detection tool from clean launch to clean shutdown. No new leaks beyond the engine's existing baseline. | Resource cleanup (VB / IB / Texture / Effect) |

### G. Edge cases

| # | Check | Catches |
|---|---|---|
| G1 | Select a bundled slot. Bloom on. The skydome contributes to bloom (visible glow on bright sky). | Render-pipeline composition |
| G2 | Select a bundled slot. Heat-distortion enabled. Distortion samples include the skydome. | Distortion pass composition |
| G3 | Resize the main window (drag corner). Skydome aspect ratio stays correct (no stretching at extreme aspect ratios). | Projection-matrix path |
| G4 | Zoom the camera all the way in / out (Ctrl+RightDrag). Skydome stays infinite (doesn't appear to scale with zoom). | R3 — camera-lock + zoom independence |
| G5 | Build a Release configuration with `NDEBUG`. All `[Skydome]` debug lines absent from stderr. | Debug instrumentation leaked |

### H. Localisation parity

| # | Check | Catches |
|---|---|---|
| H1 | Compile both `.en.rc` and `.de.rc`. Both succeed. | German variant missing IDs |
| H2 | German variant has the new dialog template + toolbar entries with English placeholder strings. | German variant skipped entirely |

---

## Task Breakdown (execution order)

Each task is a self-contained slice — engine code + UI plumbing kept separate where possible so the diff is reviewable. Test-driven where there's a unit-testable boundary; otherwise verified by a build + manual check before commit.

### Task 0: Pre-implementation asset prep

**Files:**
- Create: `tools/generate_skydome_textures.py` (procedural gradient generator)
- Create: `src/Resources/skydomes/{space,atmosphere,sunset,dawn,night,overcast,studio,indoor}.tga`

**Format decision: TGA (24-bit RGB)** for the procedural placeholders — Pillow writes TGA natively, no external tooling required, and TGA is one of the two native EaW texture formats so the file picker filter (`.dds;.tga`) accepts the same shape. Production-quality BC1 DDS assets (smaller bundle size) are a follow-up PR after v1 ships. `D3DXCreateTextureFromFileInMemory` loads both formats identically, so the engine doesn't care.

- [ ] **Step 1: Write `tools/generate_skydome_textures.py`** — generates 8 equirectangular TGA files at 1024×512 with simple colour ramps representing each scene. Pillow `Image.save("...tga")` handles the encoding.

```python
# tools/generate_skydome_textures.py — placeholder skydome generator
import os
import numpy as np
from PIL import Image

# Each tuple: (name, top_color RGB, mid_color, bottom_color)
SCENES = [
    ("space",      (0,0,8),       (0,0,16),       (0,0,8)),
    ("atmosphere", (50,90,180),   (140,180,220),  (200,210,230)),
    ("sunset",     (200,80,40),   (220,140,70),   (180,100,60)),
    ("dawn",       (200,150,200), (240,200,180),  (200,180,180)),
    ("night",      (10,10,30),    (20,20,40),     (10,15,25)),
    ("overcast",   (140,150,160), (170,175,180),  (150,155,160)),
    ("studio",     (180,180,180), (200,200,200),  (160,160,160)),
    ("indoor",     (60,55,50),    (80,75,70),     (50,45,40)),
]

W, H = 1024, 512
out_dir = "src/Resources/skydomes"
os.makedirs(out_dir, exist_ok=True)
for name, top, mid, bot in SCENES:
    img = np.zeros((H, W, 3), dtype=np.uint8)
    for y in range(H):
        t = y / (H - 1)
        if t < 0.5:
            a = t * 2.0
            c = np.array(top) * (1.0 - a) + np.array(mid) * a
        else:
            a = (t - 0.5) * 2.0
            c = np.array(mid) * (1.0 - a) + np.array(bot) * a
        img[y, :, :] = c.astype(np.uint8)
    Image.fromarray(img, "RGB").save(os.path.join(out_dir, f"{name}.tga"))
    print(f"wrote {name}.tga")
```

- [ ] **Step 2: Run the generator**, verify 8 TGA files land in `src/Resources/skydomes/`.

```bash
python tools/generate_skydome_textures.py
ls src/Resources/skydomes/*.tga
```

Expected: 8 files, ~1.5 MB each (uncompressed 24-bit RGB TGA).

- [ ] **Step 3: Commit**

```bash
git add tools/generate_skydome_textures.py src/Resources/skydomes/*.tga
git commit -m "asset(MT-3): procedural placeholder skydome TGA textures + generator"
```

### Task 1: Sphere mesh

**Files:**
- Modify: `src/engine.h` (add member declarations + `SkydomeVertex` struct)
- Modify: `src/engine.cpp` (add `InitSkydomeMesh`)

- [ ] **Step 1: Add member declarations to `engine.h` (near m_pGroundTexture).**

```cpp
// In Engine class, private section:
struct SkydomeVertex
{
    D3DXVECTOR3 Position;
    D3DXVECTOR3 Normal;
    D3DXVECTOR2 TexCoord;
};

IDirect3DVertexBuffer9*  m_pSkydomeVB;
IDirect3DIndexBuffer9*   m_pSkydomeIB;
IDirect3DVertexDeclaration9* m_pSkydomeDecl;
DWORD                    m_skydomeIndexCount;

static const int kSkydomeLongSegments = 32;
static const int kSkydomeLatSegments  = 16;
```

- [ ] **Step 2: Implement `InitSkydomeMesh` in `engine.cpp`** (called once from the Engine constructor after the device is created).

```cpp
void Engine::InitSkydomeMesh()
{
    const int lon = kSkydomeLongSegments;
    const int lat = kSkydomeLatSegments;
    const int vertCount = (lon + 1) * (lat + 1);
    const int triCount  = lon * lat * 2;
    m_skydomeIndexCount = triCount * 3;

    // Generate vertices: U wraps lon segments [0,1], V is lat segments [0,1].
    // Sphere radius is 1; we'll rely on the shader to push depth to far.
    std::vector<SkydomeVertex> verts(vertCount);
    for (int j = 0; j <= lat; ++j)
    {
        const float v = float(j) / float(lat);
        const float theta = v * D3DX_PI;             // 0..pi (south to north)
        const float sinTheta = sinf(theta);
        const float cosTheta = cosf(theta);
        for (int i = 0; i <= lon; ++i)
        {
            const float u = float(i) / float(lon);
            const float phi = u * 2.0f * D3DX_PI;     // 0..2pi
            const float sinPhi = sinf(phi);
            const float cosPhi = cosf(phi);
            SkydomeVertex& vx = verts[j * (lon + 1) + i];
            vx.Position = D3DXVECTOR3(sinTheta * cosPhi, cosTheta, sinTheta * sinPhi);
            vx.Normal   = vx.Position;
            vx.TexCoord = D3DXVECTOR2(u, v);
        }
    }

    std::vector<uint16_t> idx(m_skydomeIndexCount);
    int k = 0;
    for (int j = 0; j < lat; ++j)
    {
        for (int i = 0; i < lon; ++i)
        {
            uint16_t a = uint16_t(j * (lon + 1) + i);
            uint16_t b = a + 1;
            uint16_t c = uint16_t((j + 1) * (lon + 1) + i);
            uint16_t d = c + 1;
            idx[k++] = a; idx[k++] = c; idx[k++] = b;
            idx[k++] = b; idx[k++] = c; idx[k++] = d;
        }
    }

    // Vertex declaration
    D3DVERTEXELEMENT9 decl[] = {
        {0, offsetof(SkydomeVertex, Position),  D3DDECLTYPE_FLOAT3, D3DDECLMETHOD_DEFAULT, D3DDECLUSAGE_POSITION, 0},
        {0, offsetof(SkydomeVertex, Normal),    D3DDECLTYPE_FLOAT3, D3DDECLMETHOD_DEFAULT, D3DDECLUSAGE_NORMAL,   0},
        {0, offsetof(SkydomeVertex, TexCoord),  D3DDECLTYPE_FLOAT2, D3DDECLMETHOD_DEFAULT, D3DDECLUSAGE_TEXCOORD, 0},
        D3DDECL_END()
    };
    m_pDevice->CreateVertexDeclaration(decl, &m_pSkydomeDecl);

    // VB
    m_pDevice->CreateVertexBuffer(
        UINT(verts.size() * sizeof(SkydomeVertex)),
        D3DUSAGE_WRITEONLY, 0, D3DPOOL_MANAGED, &m_pSkydomeVB, NULL);
    void* pVB = NULL;
    m_pSkydomeVB->Lock(0, 0, &pVB, 0);
    memcpy(pVB, verts.data(), verts.size() * sizeof(SkydomeVertex));
    m_pSkydomeVB->Unlock();

    // IB
    m_pDevice->CreateIndexBuffer(
        UINT(idx.size() * sizeof(uint16_t)),
        D3DUSAGE_WRITEONLY, D3DFMT_INDEX16, D3DPOOL_MANAGED, &m_pSkydomeIB, NULL);
    void* pIB = NULL;
    m_pSkydomeIB->Lock(0, 0, &pIB, 0);
    memcpy(pIB, idx.data(), idx.size() * sizeof(uint16_t));
    m_pSkydomeIB->Unlock();

#ifndef NDEBUG
    fprintf(stdout, "[Skydome] sphere mesh init verts=%d tris=%d\n", vertCount, triCount);
#endif
}
```

- [ ] **Step 3: Call `InitSkydomeMesh` from the Engine constructor** after `m_pDevice` is created (around the existing `SetLight` calls).
- [ ] **Step 4: Add cleanup in `Engine::~Engine`** — `SAFE_RELEASE(m_pSkydomeVB)`, `SAFE_RELEASE(m_pSkydomeIB)`, `SAFE_RELEASE(m_pSkydomeDecl)`.
- [ ] **Step 5: Build, verify `[Skydome] sphere mesh init` log line on startup.**

```bash
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" "ParticleEditor.sln" -p:Configuration=Debug -p:Platform=x64 -nologo
./x64/Debug/ParticleEditor.exe
# stderr should show [Skydome] sphere mesh init verts=561 tris=512
```

- [ ] **Step 6: Commit.**

```bash
git add src/engine.h src/engine.cpp
git commit -m "feat(MT-3): generate UV sphere mesh at engine init"
```

### Task 2: Skydome shader

**Files:**
- Create: `src/Resources/Engine/Skydome.fx`
- Modify: `src/ParticleEditor.rc` (add `IDR_SHADER_SKYDOME` RCDATA)
- Modify: `src/Resources/resource.h` (add `IDR_SHADER_SKYDOME` ID)

- [ ] **Step 1: Write `Skydome.fx`** (content as in Architecture section B).
- [ ] **Step 2: Add resource ID** to `src/Resources/resource.h`:

```cpp
#define IDR_SHADER_SKYDOME    150
```

- [ ] **Step 3: Add RCDATA entry** to `src/ParticleEditor.rc`:

```rc
IDR_SHADER_SKYDOME      RCDATA                  "Resources\\Engine\\Skydome.fx"
```

- [ ] **Step 4: Build, verify the .rc compiles and the .exe contains the resource.**

```bash
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" "ParticleEditor.sln" -p:Configuration=Debug -p:Platform=x64 -nologo
```

- [ ] **Step 5: Commit.**

```bash
git add src/Resources/Engine/Skydome.fx src/ParticleEditor.rc src/Resources/resource.h
git commit -m "feat(MT-3): add skydome equirectangular-sampling shader"
```

### Task 3: Engine effect + texture loading

**Files:**
- Modify: `src/engine.h` (add `m_pSkydomeEffect`, `m_hSkydomeWVP`, `m_hSkydomeTex`, `m_pSkydomeTexture`, `m_skydomeIndex`, `m_skydomeCustomSlotPaths[3]`, kSkydome* constants)
- Modify: `src/engine.cpp` (add `InitSkydomeEffect`, `ReloadSkydomeTexture`)

- [ ] **Step 1: Add member declarations** in `engine.h` near the existing skydome mesh members.

```cpp
ID3DXEffect*             m_pSkydomeEffect;
D3DXHANDLE               m_hSkydomeWVP;
D3DXHANDLE               m_hSkydomeTex;
IDirect3DTexture9*       m_pSkydomeTexture;
int                      m_skydomeIndex;
std::wstring             m_skydomeCustomSlotPaths[3];

static const int kSkydomeSlotCount = 12;
static const int kSkydomeBundledCount = 9;       // Off + 8 scenes
static const int kSkydomeFirstCustomSlot = 9;
static const int kSkydomeOffSlot = 0;
```

- [ ] **Step 2: Add public API declarations.**

```cpp
int  GetSkydomeSlot() const { return m_skydomeIndex; }
bool SetSkydomeSlot(int index);    // returns true on success; false on load failure
const std::wstring& GetSkydomeCustomPath(int slot) const;
bool SetSkydomeCustomPath(int slot, const std::wstring& path);
bool IsSkydomeSlotEmpty(int slot) const;
```

- [ ] **Step 3: Add the bundled-resource ID lookup table** as a static const array in `engine.cpp` (top of file, after `ShaderNames[]`).

```cpp
// Slot 0 is Off (no resource); slots 1-8 map to bundled skydomes.
static const int kSkydomeBundledResources[9] = {
    0,                       // 0: Off
    IDR_SKYDOME_SPACE,       // 1
    IDR_SKYDOME_ATMOSPHERE,  // 2
    IDR_SKYDOME_SUNSET,      // 3
    IDR_SKYDOME_DAWN,        // 4
    IDR_SKYDOME_NIGHT,       // 5
    IDR_SKYDOME_OVERCAST,    // 6
    IDR_SKYDOME_STUDIO,      // 7
    IDR_SKYDOME_INDOOR,      // 8
};
```

- [ ] **Step 4: Implement `InitSkydomeEffect`** — loads `IDR_SHADER_SKYDOME` via RCDATA + `D3DXCreateEffectFromMemory`, caches handles. Called from the Engine constructor after `InitSkydomeMesh`.

```cpp
void Engine::InitSkydomeEffect()
{
    HMODULE hMod = GetModuleHandle(NULL);
    HRSRC   hRes = FindResource(hMod, MAKEINTRESOURCE(IDR_SHADER_SKYDOME), RT_RCDATA);
    if (!hRes) return;
    HGLOBAL hData = LoadResource(hMod, hRes);
    DWORD   dwSize = SizeofResource(hMod, hRes);
    void*   pData = hData ? LockResource(hData) : NULL;
    if (!pData || !dwSize) return;

    LPD3DXBUFFER pErrors = NULL;
    HRESULT hr = D3DXCreateEffect(m_pDevice, pData, dwSize, NULL, NULL, 0, NULL,
                                  &m_pSkydomeEffect, &pErrors);
    if (FAILED(hr))
    {
#ifndef NDEBUG
        if (pErrors) fprintf(stderr, "[Skydome] effect compile failed: %s\n",
                             (const char*)pErrors->GetBufferPointer());
#endif
        SAFE_RELEASE(pErrors);
        m_pSkydomeEffect = NULL;
        return;
    }
    SAFE_RELEASE(pErrors);

    m_hSkydomeWVP = m_pSkydomeEffect->GetParameterByName(NULL, "g_WorldViewProj");
    m_hSkydomeTex = m_pSkydomeEffect->GetParameterByName(NULL, "g_Skydome");
}
```

- [ ] **Step 5: Implement `ReloadSkydomeTexture(int)`** — releases the current texture, loads from RCDATA (bundled) or file (custom), updates `m_pSkydomeTexture`. Returns false on failure (caller falls back to Off).

```cpp
bool Engine::ReloadSkydomeTexture(int slot)
{
    SAFE_RELEASE(m_pSkydomeTexture);
    if (slot == kSkydomeOffSlot) return true;

    if (slot >= 1 && slot < kSkydomeBundledCount)
    {
        HMODULE hMod = GetModuleHandle(NULL);
        HRSRC   hRes = FindResource(hMod, MAKEINTRESOURCE(kSkydomeBundledResources[slot]), RT_RCDATA);
        if (!hRes) return false;
        HGLOBAL hData = LoadResource(hMod, hRes);
        DWORD   dwSize = SizeofResource(hMod, hRes);
        void*   pData = hData ? LockResource(hData) : NULL;
        if (!pData || !dwSize) return false;
        return SUCCEEDED(D3DXCreateTextureFromFileInMemory(m_pDevice, pData, dwSize, &m_pSkydomeTexture));
    }

    if (slot >= kSkydomeFirstCustomSlot && slot < kSkydomeSlotCount)
    {
        const std::wstring& path = m_skydomeCustomSlotPaths[slot - kSkydomeFirstCustomSlot];
        if (path.empty()) return false;
        return SUCCEEDED(D3DXCreateTextureFromFileEx(
            m_pDevice, path.c_str(),
            D3DX_DEFAULT, D3DX_DEFAULT, D3DX_DEFAULT, 0, D3DFMT_UNKNOWN,
            D3DPOOL_MANAGED, D3DX_DEFAULT, D3DX_DEFAULT, 0, NULL, NULL,
            &m_pSkydomeTexture));
    }
    return false;
}

bool Engine::SetSkydomeSlot(int newIndex)
{
    if (newIndex < 0 || newIndex >= kSkydomeSlotCount) return false;
    if (newIndex == m_skydomeIndex) return true;
    if (!ReloadSkydomeTexture(newIndex))
    {
        // Fall back to Off on failure
        m_skydomeIndex = kSkydomeOffSlot;
        SAFE_RELEASE(m_pSkydomeTexture);
        return false;
    }
    m_skydomeIndex = newIndex;
#ifndef NDEBUG
    fprintf(stdout, "[Skydome] select slot=%d\n", newIndex);
#endif
    return true;
}

bool Engine::SetSkydomeCustomPath(int slot, const std::wstring& path)
{
    if (slot < kSkydomeFirstCustomSlot || slot >= kSkydomeSlotCount) return false;
    m_skydomeCustomSlotPaths[slot - kSkydomeFirstCustomSlot] = path;
    if (m_skydomeIndex == slot)
    {
        return ReloadSkydomeTexture(slot);
    }
    return true;
}

const std::wstring& Engine::GetSkydomeCustomPath(int slot) const
{
    static const std::wstring empty;
    if (slot < kSkydomeFirstCustomSlot || slot >= kSkydomeSlotCount) return empty;
    return m_skydomeCustomSlotPaths[slot - kSkydomeFirstCustomSlot];
}

bool Engine::IsSkydomeSlotEmpty(int slot) const
{
    if (slot == kSkydomeOffSlot) return false;       // Off is "selectable", not empty
    if (slot < kSkydomeBundledCount) return false;   // bundled always populated
    if (slot < kSkydomeSlotCount)
        return m_skydomeCustomSlotPaths[slot - kSkydomeFirstCustomSlot].empty();
    return true;
}
```

- [ ] **Step 6: Initialise `m_skydomeIndex = 0`, `m_pSkydomeTexture = NULL`, `m_pSkydomeEffect = NULL`** in the Engine constructor (near the other early-init assignments around line 1290).
- [ ] **Step 7: Add cleanup in `~Engine`** — `SAFE_RELEASE(m_pSkydomeEffect)`, `SAFE_RELEASE(m_pSkydomeTexture)`.
- [ ] **Step 8: Build, run, verify no crash and `[Skydome] sphere mesh init` still appears.**
- [ ] **Step 9: Commit.**

```bash
git add src/engine.h src/engine.cpp
git commit -m "feat(MT-3): skydome state + effect/texture load helpers"
```

### Task 4: Render pass integration

**Files:**
- Modify: `src/engine.cpp` (add `RenderSkydome`, hook into `Engine::Render`)

- [ ] **Step 1: Implement `RenderSkydome`** as in Architecture section C.
- [ ] **Step 2: Insert the call into `Engine::Render`** right after the `Clear` call and before the ground render.
- [ ] **Step 3: Build, run, select a non-Off slot via direct registry edit** (since we haven't built the dialog yet — set `SkydomeIndex = 2` for Atmosphere). Verify the skydome renders. Check `[Skydome] render pass skipped` is *absent* (it's a non-Off slot).
- [ ] **Step 4: Verify R7 (sphere not inverted)** — sphere is visible, not invisible/black. If invisible, fix the cull mode.
- [ ] **Step 5: Verify R2 (no UV seam)** — orbit camera 360° horizontally, look for vertical line at the back.
- [ ] **Step 6: Verify R3 (camera-lock works)** — middle-drag pan; skydome moves with camera.
- [ ] **Step 7: Commit.**

```bash
git add src/engine.cpp
git commit -m "feat(MT-3): render skydome pass between clear and ground"
```

### Task 5: Resource IDs + bundled DDS RCDATA entries

**Files:**
- Modify: `src/Resources/resource.h` (add 8 `IDR_SKYDOME_*` IDs)
- Modify: `src/ParticleEditor.rc` (add 8 RCDATA entries)

- [ ] **Step 1: Add resource IDs** to `src/Resources/resource.h` (block after the existing `IDR_SHADER_SKYDOME`):

```cpp
#define IDR_SKYDOME_SPACE       151
#define IDR_SKYDOME_ATMOSPHERE  152
#define IDR_SKYDOME_SUNSET      153
#define IDR_SKYDOME_DAWN        154
#define IDR_SKYDOME_NIGHT       155
#define IDR_SKYDOME_OVERCAST    156
#define IDR_SKYDOME_STUDIO      157
#define IDR_SKYDOME_INDOOR      158
```

- [ ] **Step 2: Add RCDATA entries** to `src/ParticleEditor.rc` (block after `IDB_GROUND_SNOW`):

```rc
IDR_SKYDOME_SPACE       RCDATA                  "Resources\\skydomes\\space.tga"
IDR_SKYDOME_ATMOSPHERE  RCDATA                  "Resources\\skydomes\\atmosphere.tga"
IDR_SKYDOME_SUNSET      RCDATA                  "Resources\\skydomes\\sunset.tga"
IDR_SKYDOME_DAWN        RCDATA                  "Resources\\skydomes\\dawn.tga"
IDR_SKYDOME_NIGHT       RCDATA                  "Resources\\skydomes\\night.tga"
IDR_SKYDOME_OVERCAST    RCDATA                  "Resources\\skydomes\\overcast.tga"
IDR_SKYDOME_STUDIO      RCDATA                  "Resources\\skydomes\\studio.tga"
IDR_SKYDOME_INDOOR      RCDATA                  "Resources\\skydomes\\indoor.tga"
```

- [ ] **Step 3: Build, verify .rc compiles and .exe size grew by ~12 MB** (R1 — sanity-check the bloat).

```bash
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" "ParticleEditor.sln" -p:Configuration=Debug -p:Platform=x64 -nologo
ls -la x64/Debug/ParticleEditor.exe
```

- [ ] **Step 4: Run the editor with `SkydomeIndex` = 1 in registry**. Verify slot 1 (Space) renders correctly.
- [ ] **Step 5: Cycle through slots 1–8** via registry edits + restart. Verify each renders.
- [ ] **Step 6: Commit.**

```bash
git add src/Resources/resource.h src/ParticleEditor.rc
git commit -m "feat(MT-3): bundle 8 skydome RCDATA entries"
```

### Task 6: Registry I/O helpers

**Files:**
- Modify: `src/main.cpp` (add `Read/WriteSkydomeIndex`, `Read/WriteSkydomeCustomPath`, `Read/WriteSkydomePickerPos`)

- [ ] **Step 1: Add helpers** in `main.cpp` near `Read/WriteBloomFloat` (~line 4411 area):

```cpp
static int ReadSkydomeIndex(int defaultValue)
{
    HKEY hKey;
    if (RegOpenKeyEx(HKEY_CURRENT_USER, L"Software\\AloParticleEditor", 0, KEY_READ, &hKey) == ERROR_SUCCESS)
    {
        DWORD value, type, size = sizeof(value);
        if (RegQueryValueEx(hKey, L"SkydomeIndex", NULL, &type, (LPBYTE)&value, &size) == ERROR_SUCCESS
            && type == REG_DWORD && (int)value >= 0 && (int)value < Engine::kSkydomeSlotCount)
        {
            RegCloseKey(hKey);
            return (int)value;
        }
        RegCloseKey(hKey);
    }
    return defaultValue;
}

static void WriteSkydomeIndex(int value)
{
    HKEY hKey;
    if (RegCreateKeyEx(HKEY_CURRENT_USER, L"Software\\AloParticleEditor", 0, NULL,
                       REG_OPTION_NON_VOLATILE, KEY_WRITE, NULL, &hKey, NULL) == ERROR_SUCCESS)
    {
        DWORD v = (DWORD)value;
        RegSetValueEx(hKey, L"SkydomeIndex", 0, REG_DWORD, (const BYTE*)&v, sizeof(v));
        RegCloseKey(hKey);
    }
}

// Custom slot paths use names SkydomeCustomSlot9, SkydomeCustomSlot10, SkydomeCustomSlot11
static std::wstring ReadSkydomeCustomPath(int slot)
{
    if (slot < Engine::kSkydomeFirstCustomSlot || slot >= Engine::kSkydomeSlotCount) return L"";
    HKEY hKey;
    std::wstring out;
    if (RegOpenKeyEx(HKEY_CURRENT_USER, L"Software\\AloParticleEditor", 0, KEY_READ, &hKey) == ERROR_SUCCESS)
    {
        wchar_t buf[MAX_PATH];
        DWORD size = sizeof(buf);
        DWORD type;
        wchar_t name[64];
        swprintf_s(name, L"SkydomeCustomSlot%d", slot);
        if (RegQueryValueEx(hKey, name, NULL, &type, (LPBYTE)buf, &size) == ERROR_SUCCESS && type == REG_SZ)
        {
            out = buf;
        }
        RegCloseKey(hKey);
    }
    return out;
}

static void WriteSkydomeCustomPath(int slot, const std::wstring& path)
{
    if (slot < Engine::kSkydomeFirstCustomSlot || slot >= Engine::kSkydomeSlotCount) return;
    HKEY hKey;
    if (RegCreateKeyEx(HKEY_CURRENT_USER, L"Software\\AloParticleEditor", 0, NULL,
                       REG_OPTION_NON_VOLATILE, KEY_WRITE, NULL, &hKey, NULL) == ERROR_SUCCESS)
    {
        wchar_t name[64];
        swprintf_s(name, L"SkydomeCustomSlot%d", slot);
        if (path.empty())
        {
            RegDeleteValue(hKey, name);
        }
        else
        {
            RegSetValueEx(hKey, name, 0, REG_SZ, (const BYTE*)path.c_str(),
                          DWORD((path.size() + 1) * sizeof(wchar_t)));
        }
        RegCloseKey(hKey);
    }
}

static bool ReadSkydomePickerPos(RECT& out)
{
    HKEY hKey;
    if (RegOpenKeyEx(HKEY_CURRENT_USER, L"Software\\AloParticleEditor", 0, KEY_READ, &hKey) == ERROR_SUCCESS)
    {
        DWORD type, size = sizeof(out);
        if (RegQueryValueEx(hKey, L"SkydomePickerPos", NULL, &type, (LPBYTE)&out, &size) == ERROR_SUCCESS
            && type == REG_BINARY && size == sizeof(out))
        {
            RegCloseKey(hKey);
            return true;
        }
        RegCloseKey(hKey);
    }
    return false;
}

static void WriteSkydomePickerPos(const RECT& in)
{
    HKEY hKey;
    if (RegCreateKeyEx(HKEY_CURRENT_USER, L"Software\\AloParticleEditor", 0, NULL,
                       REG_OPTION_NON_VOLATILE, KEY_WRITE, NULL, &hKey, NULL) == ERROR_SUCCESS)
    {
        RegSetValueEx(hKey, L"SkydomePickerPos", 0, REG_BINARY, (const BYTE*)&in, sizeof(in));
        RegCloseKey(hKey);
    }
}
```

- [ ] **Step 2: Add cleanup of skydome keys** to `ResetViewSettings()`:

```cpp
RegDeleteValue(hKey, L"SkydomeIndex");
RegDeleteValue(hKey, L"SkydomePickerPos");
// NOTE: SkydomeCustomSlot* paths are user data, not view settings — NOT cleared here.
```

- [ ] **Step 3: Build, commit.**

```bash
git add src/main.cpp
git commit -m "feat(MT-3): registry I/O for skydome state and dialog position"
```

### Task 7: Dialog template + control IDs

**Files:**
- Modify: `src/Resources/resource.h` (add `IDD_SKYDOME_PICKER` + `IDC_SKYDOME_*` + `IDS_SKYDOME_*` IDs)
- Modify: `src/ParticleEditor.en.rc` (dialog template + string-table entries + toolbar slot)
- Modify: `src/ParticleEditor.de.rc` (mirror with English placeholders)

- [ ] **Step 1: Add resource IDs.**

```cpp
// Dialog
#define IDD_SKYDOME_PICKER              160
// Controls
#define IDC_SKYDOME_PREVIEW             1700
#define IDC_SKYDOME_PICKER_LIST         1701
#define IDC_SKYDOME_PICKER_RESET_CUSTOM 1702
#define IDC_SKYDOME_PICKER_PATH_LABEL   1703
// Context menu IDs
#define ID_SKYDOME_SLOT_SET_CUSTOM      40200
#define ID_SKYDOME_SLOT_CHANGE_CUSTOM   40201
#define ID_SKYDOME_SLOT_CLEAR_CUSTOM    40202
// View menu (optional toolbar toggle — skip for v1, toolbar-only)
// String table — name labels
#define IDS_SKYDOME_OFF                 230
#define IDS_SKYDOME_SPACE               231
#define IDS_SKYDOME_ATMOSPHERE          232
#define IDS_SKYDOME_SUNSET              233
#define IDS_SKYDOME_DAWN                234
#define IDS_SKYDOME_NIGHT               235
#define IDS_SKYDOME_OVERCAST            236
#define IDS_SKYDOME_STUDIO              237
#define IDS_SKYDOME_INDOOR              238
#define IDS_SKYDOME_CUSTOM_BASE         239   // Custom 1..3 via offset (239, 240, 241)
```

- [ ] **Step 2: Add dialog template** to `src/ParticleEditor.en.rc`:

```rc
IDD_SKYDOME_PICKER DIALOGEX 0, 0, 432, 388
STYLE DS_SETFONT | WS_POPUP | WS_CAPTION | WS_SYSMENU
EXSTYLE WS_EX_TOOLWINDOW
CAPTION "Skydome"
FONT 8, "MS Shell Dlg"
BEGIN
    CONTROL         "",IDC_SKYDOME_PICKER_LIST,"SysListView32",
                    LVS_ICON | LVS_SHOWSELALWAYS | LVS_SINGLESEL | WS_TABSTOP,
                    8, 8, 416, 320
    LTEXT           "",IDC_SKYDOME_PICKER_PATH_LABEL,8,335,416,12,
                    SS_PATHELLIPSIS | SS_NOTIFY
    PUSHBUTTON      "Reset custom slots",IDC_SKYDOME_PICKER_RESET_CUSTOM,
                    300, 364, 124, 18
END
```

- [ ] **Step 3: Add string-table entries.**

```rc
STRINGTABLE
BEGIN
    IDS_SKYDOME_OFF         "Off"
    IDS_SKYDOME_SPACE       "Space"
    IDS_SKYDOME_ATMOSPHERE  "Atmosphere"
    IDS_SKYDOME_SUNSET      "Sunset"
    IDS_SKYDOME_DAWN        "Dawn"
    IDS_SKYDOME_NIGHT       "Night"
    IDS_SKYDOME_OVERCAST    "Overcast"
    IDS_SKYDOME_STUDIO      "Studio"
    IDS_SKYDOME_INDOOR      "Indoor"
    // 239..241: Custom 1..3 via runtime concat
END
```

- [ ] **Step 4: Mirror in `src/ParticleEditor.de.rc`** with identical template + English placeholder strings.
- [ ] **Step 5: Build, verify .rc compiles.**
- [ ] **Step 6: Commit.**

```bash
git add src/Resources/resource.h src/ParticleEditor.en.rc src/ParticleEditor.de.rc
git commit -m "feat(MT-3): skydome picker dialog template + resource IDs"
```

### Task 8: Picker dialog procedure + toolbar preview

**Files:**
- Modify: `src/main.cpp` — adds `SkydomePickerDlgProc`, `ToggleSkydomePicker`, `MakeSkydomeSlotThumbnail`, `RebuildSkydomePreviewBitmap`, `APPLICATION_INFO::hSkydomePicker`, toolbar button creation + WM_DRAWITEM handler.

This is the bulk of the UI work — model after `GroundTexturePickerDlgProc` + `ToggleGroundTexturePicker` at [src/main.cpp:4312-4405](src/main.cpp:4312).

- [ ] **Step 1: Add `APPLICATION_INFO` field** `HWND hSkydomePicker` + `HWND hSkydomePreview` + `HBITMAP hSkydomePreviewBitmap` + `RECT skydomePickerRect` + `bool skydomePickerVisible`.
- [ ] **Step 2: Implement `MakeSkydomeSlotThumbnail(int slot, int sizePx, const std::wstring& customPath, COLORREF bgColor)`** — `LockRect` + `CreateDIBSection` for bundled / custom; procedural fill for Off and empty custom slots. ~80 LOC.
- [ ] **Step 3: Implement `RebuildSkydomePreviewBitmap(APPLICATION_INFO*)`** — calls `MakeSkydomeSlotThumbnail` with the current slot at 24×24, replaces `info->hSkydomePreviewBitmap`. Called from startup, slot change, Reset View Settings.
- [ ] **Step 4: Add `WM_DRAWITEM` handler** for `IDC_SKYDOME_PREVIEW` in the main window proc — same shape as the existing ground-texture preview handler. Stretch-blit the cached HBITMAP with 1 px border and pressed/focus feedback.
- [ ] **Step 5: Implement `SkydomePickerDlgProc`** — clone of `GroundTexturePickerDlgProc`. Handles `WM_INITDIALOG` (populate the 12-item ListView via a `HIMAGELIST` built from 12 `MakeSkydomeSlotThumbnail` calls at 96×96), `LVN_ITEMCHANGED` (call `SetSkydomeSlot`, write registry, rebuild toolbar preview, update path label), `NM_RCLICK` (context menu for custom slots), `WM_COMMAND` for `IDC_SKYDOME_PICKER_RESET_CUSTOM`, `WM_USER` (re-seed after Reset View Settings), `WM_CLOSE` (save position, hide).
- [ ] **Step 6: Implement `ToggleSkydomePicker(APPLICATION_INFO*)`** — lazy-create on first toggle, position restore via `ReadSkydomePickerPos` with off-screen validation, show/hide pattern.
- [ ] **Step 7: Add toolbar button creation** in `InitializeWindows` / toolbar reflow code — between Ground Texture preview and Ground Height spinner. Adjust x-offsets of subsequent controls.
- [ ] **Step 8: Add `info->hSkydomePicker` to the IsDialogMessage chain** ([src/main.cpp:6347](src/main.cpp:6347) area).
- [ ] **Step 9: Build, run.** Click the new toolbar button → picker opens with 12 slots. Click each → engine swaps, preview updates.
- [ ] **Step 10: Commit.**

```bash
git add src/main.cpp
git commit -m "feat(MT-3): skydome picker dialog + toolbar preview button"
```

### Task 9: Startup + Reset View Settings integration

**Files:**
- Modify: `src/main.cpp` (startup hook + Reset View Settings extension)

- [ ] **Step 1: At startup** (around the existing `ReadBloomDialogPos` block, [src/main.cpp:6214](src/main.cpp:6214) area), restore skydome state:

```cpp
// Custom paths first so the bundled / custom check passes for slot reload.
for (int s = Engine::kSkydomeFirstCustomSlot; s < Engine::kSkydomeSlotCount; ++s)
{
    info->engine->SetSkydomeCustomPath(s, ReadSkydomeCustomPath(s));
}
info->engine->SetSkydomeSlot(ReadSkydomeIndex(0));
ReadSkydomePickerPos(info->skydomePickerRect);
RebuildSkydomePreviewBitmap(info);
```

- [ ] **Step 2: Extend Reset View Settings handler** ([src/main.cpp:1610-1700](src/main.cpp:1610)):

```cpp
// Skydome reset (custom paths preserved; only the active selection wipes)
info->engine->SetSkydomeSlot(0);
WriteSkydomeIndex(0);
RebuildSkydomePreviewBitmap(info);
InvalidateRect(info->hSkydomePreview, NULL, TRUE);
if (info->hSkydomePicker != NULL && info->skydomePickerVisible)
{
    SendMessage(info->hSkydomePicker, WM_USER, 0, 0);
}
```

- [ ] **Step 3: Update the Reset View Settings confirm prompt** to mention skydome alongside background/ground/bloom/lighting.
- [ ] **Step 4: Build, verify startup restore + Reset View Settings flow** (D1, D2, D3 from Testing).
- [ ] **Step 5: Commit.**

```bash
git add src/main.cpp
git commit -m "feat(MT-3): startup restore + Reset View Settings integration"
```

### Task 10: Build & verification pass

- [ ] **Step 1: Run Debug + Release builds, both clean.**
- [ ] **Step 2: Walk the Testing & Verification checklist top-to-bottom.** Document any failures inline, fix, repeat.
- [ ] **Step 3: Verify the .exe size** is within tolerances (R1). If oversized, revisit asset compression.
- [ ] **Step 4: Manual visual check at corners**: 360° camera rotation horizontally and vertically; bloom on/off with bright sky; custom-slot HDR file load; Reset behaviour.
- [ ] **Step 5: Commit any fixes from the verification pass** as separate commits per issue.

### Task 11: CHANGELOG + ROADMAP + ship

- [ ] **Step 1: Add CHANGELOG entry** at the top of `## Changelog` in [CHANGELOG.md](CHANGELOG.md). Three sections: what ships (user-facing), how we tackled it (architectural), issues encountered (numbered list).
- [ ] **Step 2: Strikethrough MT-3 in ROADMAP.md** — move from §2.1 to §5.1 (Shipped). Renumber §5 entries below. Close the medium-term tier.
- [ ] **Step 3: Commit the implementation and docs together** (one `feat(MT-3):` commit with the full set of files). Use the same commit-message shape as MT-4's ship commit `740c6a2`.
- [ ] **Step 4: Push branch `feat/mt3-skydome`, open PR, ship.**
- [ ] **Step 5: After merge, backfill CHANGELOG with the merge-commit hash** in a separate `docs/backfill-prNN` PR (same pattern as PR #70 and #72).

---

## Resolved decisions

All open design questions are resolved. Recording the answers and reasoning so reviewers can see the trail:

1. **Total slot count: 12 (4×3 grid)** — Off + 8 bundled scenes + 3 custom. Picked over 8 (too few scenes) or 16 (more authoring effort + ~24 MB asset bloat).
2. **Bundled scene list (8)**: Space, Atmosphere, Sunset, Dawn, Night, Overcast, Studio, Indoor. Covers the most common particle-effect staging contexts. Picked over a smaller minimal set (2-3 scenes — leaves obvious gaps) and a larger set (8+ scenes — diminishing returns + bigger .exe).
3. **Equirectangular 2D textures** — not cubemaps. Simpler to source (single image per skydome), simpler to load (existing D3DXCreateTextureFromFileInMemory path), simpler to thumbnail. Cubemap support is a low-priority follow-up if anyone asks.
4. **3 user-customisable slots** (Custom 1, 2, 3) — matches MT-2's ground-picker convention. Click empty → file picker. Right-click populated → context menu.
5. **Toolbar preview button as entry point** — matches MT-2's ground-texture pattern. Owner-drawn 24×24 thumbnail in the toolbar; click opens picker. Picked over View-menu-only (less discoverable) and toolbar+menu (extra LOC for limited value at this stage).
6. **Off slot reverts to flat-colour background** — preserves the pre-MT-3 behaviour as the "no skydome" state. Default for new users.
7. **Single-commit modeless dialog** — clicking a slot commits the selection immediately, dialog stays open. Esc / X to close. Matches MT-2's ground-picker model. Picked over MT-1's sticky multi-pin model (overkill — only one skydome can be active).
8. **Scene-global persistence** — not per-mod. Skydomes are scene/view settings, like background colour. Stored in registry under `HKCU\Software\AloParticleEditor`. Per-mod state would be inconsistent with how the other view settings work.
9. **Render-order insertion: between Clear and ground.** Skydome renders first (so it can be occluded by everything), ground next, particles next, post-process last. Skydome contributes to bloom naturally.
10. **Camera-locked transform** (`World = Translation(camera.Position)`) — keeps the sphere "infinite" as the camera orbits the world origin. Same projection / view matrices as the rest of the scene.
11. **Hand-rolled UV sphere** (32 longitude × 16 latitude = 561 verts / 1024 tris) — not `D3DXCreateSphere`. Sphere helper doesn't include UVs. Hand-roll is ~30 LOC.
12. **Render state**: `ZWRITE=off, ZTEST=off, CULL_CW`. The far-plane push (`o.Position.z = w * 0.9999`) is belt-and-suspenders so even with ZTEST on the sphere always sits behind everything.
13. **Reset View Settings clears `SkydomeIndex`** but preserves `SkydomeCustomSlot*` paths (user data, not view settings — MT-2 convention).
14. **Asset prep is a separate workstream** — Task 0 generates procedural placeholders in **DDS (BC1) format** for v1. Custom slots accept `.dds` and `.tga` so users can point them at EaW's own environment textures with zero conversion. Real curated bundled DDS textures (also DDS BC1, sourced from game assets the editor's author has rights to or generated more carefully) can replace the placeholders in a follow-up PR without touching the engine or dialog code.
15. **Phasing**: single PR for the full implementation. Scope is contained; clone-of-MT-2 path is well-trodden.
