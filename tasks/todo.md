# MT-15 — Full-Faithful Skydome (real .alo meshes, per-sub-mesh game shaders, dual-slot primary+secondary, picker + persistence)

**Difficulty / effort re-tier:** This is now effectively a **★★★★★ (star-5)**, not the ROADMAP's `★★★★ 12–20h`. That 12–20h was the budget for the dead **a1** path (one bundled-fork Skydome.fx textured sphere). The user's chosen scope — load the real `.alo`, run *each sub-mesh's own named game shader* 1:1, dual primary+secondary slots, real-XML picker enumeration, and dual-slot persistence — is four genuinely separate subsystems plus a blocking pre-code device spike. Honest estimate: **~35–55h** across five landable steps (one pure-data leaf decoder, one XML reader, the per-sub-mesh render core, the primary-persistence bug fix, and the dual-slot plumbing), with the render core gated on a Step-0 spike that could re-shape the budget if 1_x techniques don't validate on the editor's D3D9Ex device.

**LT-7 / LT-8 overlap (by design):** the `.alo` pure-data decoder (`AloModel`) and the `MapEnvironment`/XML reader are deliberately factored as engine-independent leaf modules so **LT-7 (game-object import)** reuses the mesh+material core verbatim and **LT-8 (colour-grade / scene composite)** extends `MapEnvironment` rather than building a second locator. MT-15 ships the reusable cores first; LT-7/LT-8 inherit them.

---

## 1. Goal + scope

**Goal.** When this ships, the user can pick a *real* in-game/in-mod skydome (by its actual GameObject `Name`, enumerated from the game's own `{Land,Space}{Primary,Secondary}Skydomes.xml`) for two independent slots — a **primary** dome and a **secondary** dome — and the editor renders them faithfully: it loads the genuine `.alo` mesh, runs **each sub-mesh's own named game shader** (`Skydome.fx`, `MeshGloss.fxo`, `MeshAdditive.fx`, …) straight from the game's `shaders.meg` with no fork or approximation, applies the dome's authored material params and textures, lights it with the engine's real spherical-harmonic lighting, animates cloud scroll off the engine clock, and survives device-reset / mod-switch. Selections persist across restarts and round-trip with the legacy registry keys. The solid-colour + custom-path "simple background" remains a live fallback when no install/XML is present.

**In:**
- Static-mesh `.alo` decoder (`AloModel`): pure-data, leaf module, raw 144B `MASTER_VERTEX` + uint16 indices, multi-`0x400`, tolerant skip of skeleton/lights/connections.
- Per-sub-mesh render core: load each sub-mesh's named game shader via `ShaderManager::getShader`, bind engine uniforms by **semantic** via the existing `Effect` class, bind `.alo` material params/textures by **name**, multi-decl draw loop, complete render-state save/restore + explicit blend/cull/zwrite (because the game `.fxo` does *not* set them — see §4.2), multi-effect device-lost/reset orchestration.
- `SkydomeEnvironment` XML reader + picker enumeration of the four `*Skydomes.xml` lists, land/space axis, `MapEnvironment` resolve-by-Name.
- Dual-slot engine state (additive secondary beside the frozen primary scalar), bridge schema (two new request kinds + one query + two DTO fields), dual-slot persistence write-back (closing the pre-existing primary persistence gap), React two-section picker.
- A **blocking Step-0 device spike** (technique validation + vertex color-offset pin) before any committed render code.

**Out (each with its reason):**
- **Colour-grade / tone-map / scene composite** → deferred to **LT-8** (needs the game's full post pipeline; `MapEnvironment` is built with the extension seam for it). Memory `project_mt16_lt5_render_triage`.
- **Arbitrary game-object import** (animated / skinned / bumped meshes, full 144B field set: 4 UV sets, tangent/binormal, bone weights) → deferred to **LT-7** (`AloModel` caches the **raw** 144B blob precisely so LT-7 can recover those fields without re-parsing; MT-15's transcode is a consumer-side step).
- **`0x10005` "OldVertex" convert path** → deferred / accept-and-skip. No in-scope vanilla dome uses it (both real test domes use `0x10007`); the loader detects `0x10005` and graceful-skips that sub-mesh with a debug log rather than mis-decoding (separate item if a real dome surfaces it).
- **Legacy-UI dual-slot picker** → out. Legacy keeps its single-slot picker bound to the unchanged `m_skydomeIndex` (= primary); secondary is new-UI only. Removing legacy entirely is **MT-13** (greenlit, separate).
- **Auto-detecting land-vs-space** → out. The editor has no battle-context signal; axis is a caller-chosen input defaulting to Space. Out as "no signal exists; mechanism not policy."
- **`m_shadow` / shadow-volume / distance-fade** dome behaviour → out (`m_shadow` is stored-only with no shader consumer; domes set `Exclude_From_Distance_Fade`). Not rendered.

---

## 2. What the codebase already gives us

**Chunk parsing (reuse verbatim):**
- `ChunkReader` — `next()/nextMini()/skip()/size()/read(buf,size,check)/readString()` ([src/ChunkFile.h:38-43](src/ChunkFile.h)). Container vs data via the `0x80000000` size-bit ([src/ChunkReader.cpp:75-76](src/ChunkReader.cpp)); `read()` clamps to the data chunk and throws on short read ([src/ChunkReader.cpp:125-138](src/ChunkReader.cpp)); `MAX_CHUNK_DEPTH=256` guard before the array write ([src/ChunkReader.cpp:71-74](src/ChunkReader.cpp)); `readString()` length-bounded + trailing-NUL hardened ([src/ChunkReader.cpp:100-123](src/ChunkReader.cpp)). Header words LE-deswapped via `letohl`; **floats read raw, no swap** ([src/ParticleSystem.cpp:36-42](src/ParticleSystem.cpp)) — fine on x86/x64. Canonical walk idiom: open `ChunkReader`, gate magic, `Verify(reader.next()==EXPECTED)`, tolerant `default: skip()` ([src/ParticleSystem.cpp:1012-1094](src/ParticleSystem.cpp)).
- Exceptions: `WrongFileException`/`BadFileException`/`ReadException` ([src/exceptions.h](src/exceptions.h)). `Verify()` is a *file-static* in ParticleSystem.cpp — **not** linkable; the new loader declares its own.

**`.alo` format spec (authoritative — PRIMARY port source):**
- **[DrKnickers/max2alamo-2026](https://github.com/DrKnickers/max2alamo-2026)** — the maintainer's **own MIT** C++17 Alamo *exporter*, checked out locally at `C:\Modding\max2alamo-2026`, **round-trips 100% of the vanilla EaW+FoC corpus byte-for-byte** (10,737 submeshes). As the *writer* it is the definitive `.alo` format reference and supersedes the alo-viewer reader for format truth (memory `reference_max2alamo_format`). Port directly: `alamo_format/src/alo_build.cpp` (`append_vertex` → the on-disk 144B `MASTER_VERTEX` layout, exact offsets) + `alamo_format/src/shader_table.cpp` (canonical per-shader param **order + defaults**, incl. `kSkydome = {Emissive, CloudScrollRate 0.0025, CloudScale 0.0025, BaseTexture, CloudTexture}`); `docs/format-notes.md` is the source-of-truth. It **independently confirms** the two load-bearing facts (fixed 144B stride; `0x10000` geometry is a *sibling* of `0x10100` under `0x400`) — both now **triple-confirmed** (real-byte survey + exporter + alo-viewer). alo-viewer (`Models.cpp` `ReadMesh`/`ReadSubMesh`) remains the read-loop structural reference.

**Shader loading (the half that's essentially free):**
- `ShaderManager::getShader(device, bareName)` ([src/main.cpp:316](src/main.cpp)) loads an arbitrary game shader by bare name with **no code changes**: case-folds to upper ([src/main.cpp:319](src/main.cpp)), resolves through `basePath "Data\\Art\\Shaders\\"` ([src/main.cpp:7613](src/main.cpp)) → `FileManager::getFile` mod→base→MEG ([src/managers.cpp:13](src/managers.cpp)) → `.fx`→`.FXO` fallback ([src/main.cpp:352-358](src/main.cpp)) → RCDATA default. Returns a cached, AddRef'd `Effect*`. Extension-tolerant: both `"Skydome.fx"` and `"MeshGloss.fxo"` resolve to the same compiled `.FXO` in `shaders.meg` (verified live: 82 entries, all `.FXO`, including `SKYDOME.FXO`/`MESHGLOSS.FXO`/`MESHADDITIVE.FXO`).
- `Effect` ctor ([src/Effect.cpp:3-93](src/Effect.cpp)) selects a technique by the `{DX9,DX8,DX8ATI,FIXEDFUNCTION}` LOD-annotation loop ([src/Effect.cpp:34-55](src/Effect.cpp)) **and** pre-resolves every engine semantic handle (`WORLD`, `WORLDVIEWPROJECTION`, `TIME`, `SPH_LIGHT_ALL`, `SPH_LIGHT_FILL`, `GLOBAL_AMBIENT`, `DIR_LIGHT_*` — [src/Effect.cpp:62-89](src/Effect.cpp)). `getHandles()` exposes them; `getD3DEffect()` is the AddRef'd raw escape hatch for by-name material params ([src/Effect.h:94,99](src/Effect.h)). Bloom is the precedent for loading an optional off-the-fixed-set game shader by name ([src/engine.cpp:601-602](src/engine.cpp)); name-cached handles ([src/engine.cpp:501-506](src/engine.cpp)). `ShaderManager::Clear()` SAFE_RELEASEs every cached `Effect*` ([src/main.cpp:389-395](src/main.cpp)) and runs on `ReloadShaders` ([src/engine.cpp:572](src/engine.cpp)).

**Lighting / SH (reuse the particle binding template):**
- `Engine::Light { D3DXVECTOR4 Diffuse, Specular, Position, Direction; }` ([src/engine.h:77-83](src/engine.h)); `Direction = normalize(-Position)` ([src/engine.cpp:1467-1469](src/engine.cpp)). Members: `m_ambient` ([src/engine.h:670](src/engine.h)), `m_lights[3]` (0=sun,1/2=fill), `m_sphLightFill[3]`/`m_sphLightAll[3]` ([src/engine.h:676-678](src/engine.h)). SH recomputed only on `SetLight`/`SetAmbient` via `SPH_Calculate_Matrices` ([src/engine.cpp:1472-1473,1481-1482](src/engine.cpp); [src/SphericalHarmonics.cpp:14-80](src/SphericalHarmonics.cpp)). The **particle path is the verbatim per-frame binding template**: `SetMatrix(WVP)`, `SetMatrix(World)`, `SetMatrixArray(hSphLightAll,m_sphLightAll,3)`, `SetMatrixArray(hSphLightFill,m_sphLightFill,3)`, `SetFloat(hTime,GetTimeF())` ([src/engine.cpp:746-777](src/engine.cpp)). The game `Skydome.fx` uses `Sph_Compute_Diffuse_Light_All` (the **ALL** set, not FILL) and `m_time*CloudScrollRate` ([reference/foc-shaders/Skydome.fx:136,142-147](reference/foc-shaders/Skydome.fx); [reference/foc-shaders/AlamoEngine.fxh:62,173-181](reference/foc-shaders/AlamoEngine.fxh)).
- **Note:** `GroundLit` binds SH by *name* (`g_SphFill`) and FILL-only ([src/engine.cpp:2444,2569](src/engine.cpp)) — **wrong template** for a faithful dome. The editor's bundled `Skydome.fx` has *no* SH/time param — it's the flat-lit fork and cannot be the faithful path.

**Geometry / device lifecycle (the procedural skydome is the structural template, with one critical divergence):**
- VB/IB create+fill primitive: `CreateVertexBuffer(size, D3DUSAGE_WRITEONLY, 0, D3DPOOL_DEFAULT, …)` + `Lock(0,0,&p,0)`/memcpy/`Unlock`; IB `D3DFMT_INDEX16` ([src/engine.cpp:2224-2243](src/engine.cpp)). Vertex decl via `CreateVertexDeclaration` — **not** pool-bound, survives Reset, released only in dtor ([src/engine.cpp:2153-2160](src/engine.cpp)). Device-lost/reset dance: pre-Reset `OnLostDevice()` + `ReleaseSkydomeMeshBuffers()` + `SAFE_RELEASE(m_pSkydomeTexture)` ([src/engine.cpp:1540,1554-1555](src/engine.cpp)); post-Reset `OnResetDevice()` + `CreateSkydomeMeshBuffers()` + `ReloadSkydomeTexture()` ([src/engine.cpp:1592,1601,1604](src/engine.cpp)). Render-state save/restore set = exactly 4 (`ZWRITEENABLE`, `ZENABLE`, `CULLMODE`, vertex decl), **no blend state** ([src/engine.cpp:2351-2397](src/engine.cpp)); L-032 ([tasks/lessons.md:2563](tasks/lessons.md)). **Divergence:** the skydome *regenerates* geometry procedurally every Reset ([src/engine.cpp:2170-2171](src/engine.cpp)) — a parsed `.alo` cannot; it must cache decoded blobs and refill (net-new).

**Textures (D3D9Ex pool rules):**
- `LoadTextureViaFileManager(dev, fm, path)` → `getFile` → `ReadAndRelease` → `D3DXCreateTextureFromFileInMemory` (content-sniffs DDS/TGA/PNG/…) ([src/engine.cpp:81-103](src/engine.cpp)). Engine is D3D9Ex ([src/engine.cpp:2718,2760](src/engine.cpp)): **never `D3DPOOL_MANAGED`**; the simple overload yields a DEFAULT-pool resource (silent substitution, [src/engine.cpp:1564-1572](src/engine.cpp)) that is lost on Reset. `.alo` materials store **bare** texture names → the loader must synthesize `"Data\\Art\\Textures\\" + bareName` before `getFile`, mirroring the curated slots ([src/engine.cpp:55-64](src/engine.cpp)). PNG comes only from loose mod files (base MEGs are 100% DDS/TGA).

**XML (reuse expat/XMLTree):**
- `XMLTree::parse(file)` ([src/xml.cpp:125](src/xml.cpp)); expat built `XML_UNICODE_WCHAR_T`, so names/data/attrs are `std::wstring`; `getData()` is whitespace-trimmed ([src/xml.cpp:102](src/xml.cpp)); single text child folds to data ([src/xml.cpp:96-101](src/xml.cpp)); **no `getChildByName`** — only indexed `getChild(i)`+`getName()` (loader adds a `findChild` helper). `AnsiToWide`/`WideToAnsi` ([src/utils.h:18](src/utils.h)). Real install verified: the four XMLs ship inside `config.meg` as full UPPERCASE paths `DATA\XML\*.XML`, registered in `GameObjectFiles.xml` by bare name.

**Dual-slot plumbing (existing single-slot surface to extend additively):**
- Engine: single `int m_skydomeIndex` + `m_pSkydomeEffect`/`m_pSkydomeTexture` + handles + `m_skydomeCustomSlotPaths[3]` ([src/engine.h:704-710](src/engine.h)); getter `GetSkydomeSlot()` ([src/engine.h:486](src/engine.h)) consumed by legacy ([src/main.cpp:7727](src/main.cpp)) and restore ([src/host/HostWindow.cpp:2073](src/host/HostWindow.cpp)). Slot constants `kSkydomeSlotCount=12`/`kSkydomeFirstCustomSlot=9`/`kSkydomeOffSlot=0` ([src/engine.h:332-335](src/engine.h)), mirrored at [web/apps/editor/src/bridge/mock-state.ts:50-53](web/apps/editor/src/bridge/mock-state.ts).
- Bridge: pure-TS discriminated union + conditional response map (**no Zod**). `engine/set/skydome-slot`/`skydome-custom-path`/`engine/query/skydome-slot-empty` + DTO `skydomeSlot`/`skydomeCustomPaths` ([web/packages/bridge-schema/src/index.ts:208-210,586-588,636,1003-1005](web/packages/bridge-schema/src/index.ts)). Handlers `markDirty()`+`EmitEngineStateChanged()` only, **no registry write** ([src/host/BridgeDispatcher.cpp:1319-1338](src/host/BridgeDispatcher.cpp)); snapshot at :642-643.
- Persistence write precedent: `settings/lighting-force-align/set` does `RegCreateKeyExW(HKCU,…)`→`RegSetValueExW`→`RegCloseKey`, gated `m_testHost && !m_settingsLive` ([src/host/BridgeDispatcher.cpp:1755-1773](src/host/BridgeDispatcher.cpp)). New-UI startup reads `SkydomeIndex`/`SkydomeCustomSlot%d` ([src/host/HostWindow.cpp:2062-2073](src/host/HostWindow.cpp)) but **never writes** (writers legacy-only, [src/main.cpp:5564,5598](src/main.cpp)) — the real persistence gap.
- React: `BackgroundPickerBody` ([web/apps/editor/src/screens/BackgroundPicker.tsx:77](web/apps/editor/src/screens/BackgroundPicker.tsx)) mounted by `BackgroundDropdown` Radix popover ([web/apps/editor/src/components/BackgroundDropdown.tsx:64](web/apps/editor/src/components/BackgroundDropdown.tsx)) in Toolbar Group 5; fake CSS-gradient bundled tiles, `selectedSlot`/`handleBundledClick`/`handleCustomClick` ([:96,115,119]).

---

## 3. Architecture / implementation approach

The work splits into **two reusable leaf cores** (decoder + XML reader, no engine/D3D coupling, LT-7/LT-8 inherit them), a **render core** that consumes them, and the **dual-slot plumbing** that is mostly orthogonal and device-free. A **single `.alo` parser** is shared — the two earlier designs each specified one; they collapse to `AloModel` only, and `AloShaderParam` reuses the shape/ordering of the existing `Effect::Parameter` ([src/Effect.h:52-70](src/Effect.h)) to avoid a second source of truth (it stays a separate leaf type only so `AloModel.h` need not include `Effect.h` — stated deliberately).

### 3.0 STEP-0 device spike — ✅ PASSED (session 42, merged in #160)

**Result** (`tests/spike_skydome_technique.cpp`): on a vs_3_0/ps_3_0 device the game dome shaders' DX8/ps_1_1 techniques all `ValidateTechnique` + `Begin()`=1 pass → **RENDER** (`Skydome.fxo`→`sph_t2`, `MeshAdditive.fxo`→`t0`, `MeshGloss.fxo`→`sph_t0`; the `Effect` ctor correctly skips MeshGloss's un-annotated `max_viewport`). **No FIXEDFUNCTION fallback / re-scope needed — the render core can run each sub-mesh's own ps_1_1 game shader 1:1.** Item 2 below (on-disk vertex color offset) was also closed: `max2alamo` pins it to float4@80, validated against real `.alo`. The two gating unknowns (recorded below for context) are both resolved:

1. **Technique validation.** Verified from source: the real `Skydome.fx`/`MeshAdditive.fx`/`MeshGloss.fx` ship **only** `LOD="DX8"` (vs_1_1/ps_1_1) + `LOD="FIXEDFUNCTION"` — **no `DX9` technique** — and MeshGloss leads with an *un-annotated* `max_viewport` technique. The `Effect` ctor only `SetTechnique` on a matching LOD annotation ([src/Effect.cpp:44-52](src/Effect.cpp)); `createShader` first calls `FindNextValidTechnique`+`SetTechnique` ([src/main.cpp:280-282](src/main.cpp)) which could leave `max_viewport` active if the ctor's loop finds no validating annotated technique. Spike: `getShader` each `.fxo`, dump `GetTechnique(i)`/`ValidateTechnique`/the active technique after both selection stages, and confirm `Begin()` returns >0 passes and renders on the editor's device. If ps_1_1/vs_1_1 fail `ValidateTechnique` → the faithful path needs a FIXEDFUNCTION-only fallback (or recompile) strategy and the budget changes.
2. **On-disk vertex layout — now PINNED (this item downgraded to confirmatory).** max2alamo's `append_vertex` defines the exact on-disk 144B `MASTER_VERTEX`: `pos@0, normal@12, uv0@24, uv1-3@32/40/48, tangent@56, binormal@68, color float3@80 + alpha@92 (= a contiguous float4 at @80), reserved@96, boneIdx[4]@112, boneWt[4]@128`. This **resolves the apparent contradiction**: the on-disk color is a *float4 at offset 80* (NOT a packed D3DCOLOR, NOT at 24); the "color@24" figure described the separate *runtime* compact NU2C decl (36B: pos@0/normal@12/D3DCOLOR@24/uv@28) the transcode emits. So the transcode reads the on-disk float4 @80 (consumed by `Skydome.fx` `In.Color` for SH-diffuse modulate + cloud-alpha lerp at [Skydome.fx:147,161](reference/foc-shaders/Skydome.fx)) and packs it to a D3DCOLOR for the runtime decl — no discovery needed. Step-0 keeps the `#ifndef NDEBUG [AloVtx]` first-vertex dump only to **confirm** the pinned offsets against a real `w_skydome_clearblue` (trust-but-verify), routed through the named constant `kMV_Color_Offset = 80`. (Item 1 — technique validation — is still a genuine open blocker.)

### 3.1 `AloModel` — pure-data static-mesh decoder (leaf module; LT-7 core)

New files `src/AloModel.h` / `src/AloModel.cpp` (depend only on `<string>/<vector>/<map>`, `types.h`, `files.h`, `ChunkFile.h`, `exceptions.h` — **no** `engine.h`). MIT attribution comment at the top citing **max2alamo-2026** (primary format reference — the maintainer's own MIT repo) and the alo-viewer reader.

```cpp
// One authored material param from a sub-mesh 0x10102-0x10106 chunk.
// Kind/order mirrors Effect::Parameter::Type (Effect.h:52-70) to avoid a second source of truth.
// Chunk->Kind: 0x10102 INT, 0x10103 FLOAT, 0x10104 FLOAT3, 0x10105 TEXTURE, 0x10106 FLOAT4
//   (5/6 are TEXTURE/FLOAT4 — confirmed by live byte dump, NOT the spec table's 4/5).
struct AloShaderParam {
    enum Kind { INT, FLOAT, FLOAT3, FLOAT4, TEXTURE } kind;
    std::string name;            // HLSL name: "CloudScrollRate","BaseTexture","Emissive",...
    int   i = 0;
    float f[4] = {0,0,0,0};
    std::string tex;             // bare filename for TEXTURE (consumer prefixes Data\Art\Textures\)
};

// One renderable sub-mesh. Caches RAW on-disk blobs (144B vertex stride, uint16 indices)
// so LT-7 can recover dropped fields without re-parsing; skydome transcode is a SEPARATE
// consumer-side step (see SubMeshGpu builder in 3.2). indexCount = primitiveCount*3.
struct AloSubMesh {
    std::string shaderName;          // "Skydome.fx","MeshGloss.fxo","MeshAdditive.fx" (ext varies)
    std::string vertexFormatName;    // "alD3dVertNU2C","alD3dVertN","alD3dVertNU2"
    std::vector<AloShaderParam> params;
    uint32_t vertexCount = 0, primitiveCount = 0;
    std::vector<unsigned char> rawVertexBytes;  // vertexCount * 144 (on-disk MASTER_VERTEX)
    std::vector<unsigned char> indexBytes;      // primitiveCount * 6 (uint16 tri-list)
};

struct AloMesh   { std::string name; std::vector<AloSubMesh> subMeshes; };  // one 0x400; files have N
struct AloModel  { std::vector<AloMesh> meshes; };                          // skeleton/lights/conn ignored

// Walks the chunk tree from `file` (caller retains IFile* ownership; ChunkReader AddRef/Releases).
// Throws WrongFileException (first root chunk != 0x400), BadFileException (malformed/over-deep/
// stride!=144/count-vs-payload mismatch/vertexCount>0xFFFF), ReadException (truncated).
// Tolerantly skips 0x200/0x1300/0x600 and any unrecognized chunk. Detects 0x10005 ("OldVertex")
// and graceful-skips that sub-mesh with a debug log (out-of-scope convert path).
AloModel LoadAloModel(IFile* file);
```

**Chunk grammar (corrected against the live byte survey — supersedes the older spec table):**
- Root: iterate **all** top-level `0x400` meshes. `0x10000` geometry is a **child of `0x400`** (a *sibling* of `0x10100` submesh), **not** a child of `0x10100`. The Nth `0x10100` pairs with the Nth `0x10000` by document order within the same `0x400`.
- `0x10100` submesh holds only `0x10101` shader name + material params `0x10102-0x10106`.
- `0x10000` geometry holds `0x10001` counts (first two int32 of the 128B payload = vertexCount, primitiveCount), `0x10002` format string, `0x10007` vertex blob, `0x10004` index blob.
- Material param body grammar (single-byte markers, **not** chunk-style mini-headers): `[0x01][nameLen:u8][name\0][0x02][valLen:u8][value]`. `valLen==4`→one float; `==16`→FLOAT4; TEXTURE value is a null-term string.
- Stride is a **fixed 144B** `MASTER_VERTEX` for *all* formats (pinned across alD3dVertNU2C/N/NU2, zero remainder). `Verify(payload % vertexCount == 0 && payload/vertexCount == 144)`; `Verify(indexPayload == primitiveCount*6)`; `Verify(vertexCount <= 0xFFFF)`. Field offsets within the 144B record are fixed (from max2alamo `append_vertex`): pos@0, normal@12, uv0@24, color float4@80 (see §3.0). The "~88–100B residual unknown" caveat is **closed** — triple-confirmed (real-byte survey + max2alamo exporter + alo-viewer).

Helpers are file-static in `AloModel.cpp`: `Verify`, `readU32` (applies `letohl`), `readF32` (raw copy, no swap), reusing `ChunkReader::readString` directly. All vectors sized from the **actual** bounded `reader.size()`, never from the declared count alone (a lying count becomes a `Verify` failure, not an unbounded alloc).

### 3.2 Per-sub-mesh render core (consumes `AloModel`; lives in `src/SkydomeMesh.{h,cpp}` + engine methods)

`SkydomeMesh` holds an `AloModel` (the cache) + a parallel `std::vector<SubMeshGpu>`. **Single parser** — `SkydomeMesh::Load` calls `LoadAloModel`, it does **not** re-implement the walk.

```cpp
// GPU handles for one sub-mesh, owned by the engine path.
struct SubMeshGpu {
    Effect*                       effect = nullptr;   // from ShaderManager::getShader (owned ref, SAFE_RELEASE on teardown)
    IDirect3DVertexBuffer9*       vb = nullptr;       // D3DPOOL_DEFAULT
    IDirect3DIndexBuffer9*        ib = nullptr;       // D3DPOOL_DEFAULT, INDEX16
    IDirect3DVertexDeclaration9*  decl = nullptr;     // shared per format, survives Reset, dtor-only
    std::vector<IDirect3DTexture9*> matTextures;      // D3DPOOL_DEFAULT, parallel to TEXTURE params
    std::map<std::string,D3DXHANDLE> matHandles;      // by-name material handles (getD3DEffect path)
    uint32_t stride=0, vertexCount=0, primitiveCount=0;
};

// Slurp+decode via FileManager->LoadAloModel; transcode each sub-mesh's RAW 144B vertices into the
// compact runtime layout for its format (20-36B); never throws past the boundary (catch -> false ->
// graceful-degrade to empty). Resolve+CreateBuffers happen only when the device is valid.
bool SkydomeMesh::Load(IFileManager& fm, const std::string& aloPath);

// Per-sub-mesh: m_shaderManager.getShader(dev, shaderName) (ext-tolerant .fx->.FXO); cache the few
// present material handles by name via getD3DEffect()->GetParameterByName; build/share the per-format
// decl. Returns false (effect NULL, sub-mesh skipped) on shader-resolve miss -> per-sub-mesh degrade.
bool SkydomeMesh::Resolve(IShaderManager& sm, IDirect3DDevice9* dev);

// DEFAULT-pool VB(stride)/IB(INDEX16) + Lock/memcpy(transcoded blob)/Unlock (engine.cpp:2224-2243);
// load each TEXTURE param via LoadTextureViaFileManager(dev,fm,"Data\\Art\\Textures\\"+bareName),
// falling back to the bare name for loose mod files. Called at load AND on device Reset (refills
// from the cached AloModel, no re-parse).
void SkydomeMesh::CreateBuffers(IDirect3DDevice9* dev, IFileManager& fm);
void SkydomeMesh::OnLostDevice();                          // effect->OnLostDevice + SAFE_RELEASE vb/ib/matTextures; NOT decl
void SkydomeMesh::OnResetDevice(IDirect3DDevice9* dev, IFileManager& fm);  // re-getShader if cache cleared, then CreateBuffers

// Per-frame draw loop. world = camera-eye translation x Scale_Factor; wvp = world*m_view*m_proj.
// Saves the COMPLETE state delta ONCE around the loop (see 4.2). Per sub-mesh: push semantics via the
// cached Effect::getHandles() set (SetMatrix World/WVP, SetMatrixArray hSphLightAll & hSphLightFill x3,
// SetVector GlobalAmbient, SetFloat hTime,GetTimeF()) - the verbatim particle template (engine.cpp:746-777);
// ApplyMaterial (matHandles: SetFloat/SetVector/SetTexture by name; textures flow to samplers via the
// .fx 'Texture=(BaseTexture)' linkage); SetVertexDeclaration/SetStreamSource/SetIndices;
// Begin/BeginPass/DrawIndexedPrimitive(TRIANGLELIST,...,primCount)/EndPass/End. Restores delta after.
void Engine::RenderSkydomeMesh(SkydomeMesh& mesh, const D3DXMATRIX& world);

// Compose entry, replaces the single RenderSkydome() call (engine.cpp:856). Draws secondary then
// primary per land/space order (3.4); each guarded independently (mesh non-empty && >=1 resolved sub-mesh).
void Engine::RenderSkydomes();
```

**Per-format decl builder** (small registry keyed by format string, shared, dtor-only): `alD3dVertNU2C`→{POSITION FLOAT3, NORMAL FLOAT3, COLOR D3DCOLOR, TEXCOORD0 FLOAT2} (36B, matches `Skydome.fx VS_INPUT_MESH`); `alD3dVertN`→{POS,NORMAL,TEXCOORD0} (32B); `alD3dVertNU2`→{POS,TEXCOORD0} (20B, matches `MeshAdditive.fx VS_INPUT`). Transcode reads from the on-disk 144B record at `kMV_Color_Offset`/UV offsets pinned in Step-0; unknown format → NU2C decl + debug log.

### 3.3 `SkydomeEnvironment` — XML reader + picker enumeration (leaf module; LT-8 core)

New files `src/SkydomeEnvironment.h` / `.cpp` (take `IFileManager&`, return plain structs; mockable; no engine/D3D/UI coupling).

```cpp
enum class SkydomeAxis { LandPrimary, LandSecondary, SpacePrimary, SpaceSecondary };

struct SkydomeRef {     // one parsed <...Skydome> GameObject (matches corrected SkydomeRef)
    std::string name;            // Name= attribute; .ted key, picker label
    std::string modelPath;       // chosen Land_/Space_Model_Name, bare ".alo"
    float scaleFactor = 1.0f;    // <Scale_Factor>
    int   sortOrderAdjust = 0;   // <Sort_Order_Adjust> (default 0 when absent/empty)
    float layerZAdjust = 0.0f;   // <Layer_Z_Adjust>
    bool  inBackground = false;  // <In_Background> case-insensitive yes/true
};

struct MapEnvironment {     // per-map per-context; LT-8 adds colourGrade HERE (the reuse contract)
    SkydomeRef primary, secondary;
    bool hasPrimary = false, hasSecondary = false;   // distinguish unset from resolved -> per-slot degrade
};

// Read the single XML for `axis` via getFile (mod->base->config.meg), parse every <...Skydome> child
// of the root, append one SkydomeRef each. Path built internally "Data\\XML\\<fixed-per-axis-file>"
// (full path required; getFile does no prefixing, MEG CRC-matches DATA\XML\*). Returns false on total
// miss; never throws (wraps ParseException/ReadException/IOException -> false).
bool LoadSkydomeList(IFileManager& fm, SkydomeAxis axis, std::vector<SkydomeRef>& out);

// Build "Data\\Art\\Models\\"+ref.modelPath, getFile (guard !=NULL before ReadAndRelease), slurp to bytes.
// False on miss/empty modelPath. Separated so the picker enumerates names cheaply without loading meshes.
bool ResolveSkydomeModel(IFileManager& fm, const SkydomeRef& ref, std::vector<unsigned char>& outBytes);

// LT-8 keystone: given chosen primary+secondary Names, populate out.primary/secondary + has* by
// enumerating the matching list and matching by Name (first-wins). Either name "" -> slot unset.
bool LoadMapEnvironment(IFileManager& fm, SkydomeAxis axis,
                        const std::string& primaryName, const std::string& secondaryName,
                        MapEnvironment& out);

// file-static: first child whose getName()==tag, or NULL (XMLNode has no getChildByName).
static const XMLNode* findChild(const XMLNode* parent, const wchar_t* tag);
```

Real-data edge handling (each seen on the live install): missing/empty `<Sort_Order_Adjust>` → default 0 (NULL-safe `findChild` + `if (n && !n->getData().empty())`); case-varying `In_Background` (`yes`/`no`/`No`) → case-insensitive; per axis read the matching model tag, fall back to the other tag if empty, **skip the entry** if both empty (no renderable model); comments/blank lines tolerated (iterate only children whose `getName()==` the per-axis entry tag); land-secondary partial overlays recorded identically (compose is the render core's job). Four filenames hardcoded by axis (fixed engine convention, stable across vanilla+mods); optional debug-assert they're still registered in `GameObjectFiles.xml`, but don't depend on it.

### 3.4 Dual-slot engine state + bridge + persistence + React (reconciled with the mesh model)

**Reconciliation (fixing the inconsistency):** the secondary is **not** a cloned single-texture/single-effect scalar — that models the dead textured-sphere world and cannot represent a multi-sub-mesh nebula. Both slots are full `SkydomeMesh` + `SubMeshGpu`-collection instances.

- **Engine state** (additive next to [src/engine.h:704-710](src/engine.h)): keep `m_skydomeIndex` as the **frozen primary** scalar (legacy + `GetSkydomeSlot()` consumers unchanged). Add `SkydomeMesh m_skydomePrimaryMesh`, `SkydomeMesh m_skydomeSecondaryMesh`, `int m_skydomeSecondaryIndex` (init `kSkydomeOffSlot`), `std::wstring m_skydomeSecondaryCustomSlotPaths[3]`. The bundled-slot/custom-path scalars stay for the simple-background fallback; when a *game* dome (by Name) is selected it populates the corresponding `SkydomeMesh`. New methods clone the primary's: `SetSkydomeSecondarySlot`/`SetSkydomeSecondaryCustomPath`/`GetSkydomeSecondarySlot`/`GetSkydomeSecondaryCustomPath`/`IsSkydomeSecondarySlotEmpty`. Wire **both** meshes into the four seams: device-lost release (loop `OnLostDevice` over all sub-meshes of both), device-reset recreate (loop `OnResetDevice`), `ReloadTextures()` re-resolve ([src/engine.cpp:613-626](src/engine.cpp)), and two independent guards in `Render()`.
- **Bridge schema** (additive, no Zod): `| { kind:"engine/set/skydome-secondary-slot"; params:{slot:number} }`, `| { kind:"engine/set/skydome-secondary-custom-path"; params:{slot:number; path:string} }` (both → `Record<string,never>`), `| { kind:"engine/query/skydome-secondary-slot-empty"; params:{slot:number} }` (→ `boolean`); plus an enumeration query `engine/query/skydome-list { axis } → SkydomeRef[]` (names for the picker). DTO gains `skydomeSecondarySlot:number` + `skydomeSecondaryCustomPaths:string[]`. `engine/set/skydome-slot` stays = primary (lowest churn; frozen surface).
- **Handlers** ([src/host/BridgeDispatcher.cpp:1319-1338](src/host/BridgeDispatcher.cpp)): clone for the secondary kinds; emit the two new fields in the snapshot (:642-643); clone the empty query (:1651-1656); add the `skydome-list` handler calling `LoadSkydomeList` per axis.
- **Persistence write-back** (the real gap; lands as its own commit first — see §5 sequencing): add `RegSetValueExW` to the skydome handlers mirroring `settings/lighting-force-align/set` exactly ([src/host/BridgeDispatcher.cpp:1755-1773](src/host/BridgeDispatcher.cpp)), gated `m_testHost && !m_settingsLive`. Write `SkydomeIndex`/`SkydomeCustomSlot%d` (primary, legacy keys — closes the pre-existing gap **and** round-trips with legacy) plus new `SkydomeSecondaryIndex`/`SkydomeSecondaryCustomSlot%d` in the same `HKCU\Software\AloParticleEditor` hive. Extend startup restore ([src/host/HostWindow.cpp:2062-2073](src/host/HostWindow.cpp)) to read the secondary keys, applying custom paths **before** the index (and only once the device is up).
- **React** ([web/apps/editor/src/screens/BackgroundPicker.tsx](web/apps/editor/src/screens/BackgroundPicker.tsx)): two stacked sections in `BackgroundPickerBody` inside the single existing `BackgroundDropdown` popover — keep solid-colour (slot 0) + custom-path fallback. Section 1 (Primary) → `skydomeSlot`/`engine/set/skydome-slot`; Section 2 (Secondary) → `skydomeSecondarySlot`/the new kinds. Parameterize `selectedSlot`/`handleBundledClick`/`handleCustomClick` by axis. Replace fake CSS-gradient bundled tiles with the real enumerated dome `Name`s (fork d); two independent sections (fork e resolved independent). `mock-state.ts` gains parallel secondary constants/defaults; `mock.ts` gains the secondary handlers.

### Data flow (end-to-end)

Picker open → bridge `skydome-list` per axis → engine `LoadSkydomeList(m_fileManager, axis)` → `config.meg` XML parse → names up the DTO into the two React sections (no mesh loaded). User picks Names → host stores them → `LoadMapEnvironment` matches by Name → per `has*` slot `ResolveSkydomeModel` → `.alo` bytes → `SkydomeMesh::Load`→`LoadAloModel`→transcode → `Resolve` (getShader per sub-mesh) → `CreateBuffers` (DEFAULT VB/IB + material textures). Per-frame `RenderSkydomes()` → secondary then primary (3.4), each `RenderSkydomeMesh` saving the full state delta, binding semantics from cached `m_sphLightAll`/`GetTimeF()` + material params, drawing, restoring. Device reset → loop `OnLostDevice`/`OnResetDevice` (refill from cache, no re-parse). Mod-switch → `ReloadTextures()` re-resolves both meshes (drop+reacquire `Effect*` since `ReloadShaders`→`Clear()` ran first).

---

## 4. Risks named up front + mitigations

1. **Technique never validates → silent blank dome (THE top blocker).** Confirmed from source: the game dome shaders ship only `LOD="DX8"` (vs_1_1/ps_1_1) + `FIXEDFUNCTION` — no DX9. If ps_1_1 fails `ValidateTechnique` on the editor's modern D3D9Ex device, the `Effect` ctor sets no technique, `Begin()` returns 0 passes, and the dome renders nothing — a failure mode every "graceful-degrade" test would *pass* while showing blank. **Mitigation:** Step-0 spike (§3.0) proves a 1_x technique validates and renders *before* any committed render code; a `#ifndef NDEBUG` assert `passes>0` per resolved sub-mesh (tag `[SkyDraw]`) and a `DrawIndexedPrimitive`-reached counter distinguish "resolved" from "resolved-but-blank". If none validate, fall back to a FIXEDFUNCTION technique path (the shaders carry one) and re-budget.

2. **Game `.fxo` pass sets little/no render state → blend/zwrite/cull/sampler leak (sharpened from L-032).** Newly verified: `AlamoEngine.fxh` defines `ALAMO_STATE_BLOCKS 0`, so `SB_START…SB_END` expand to **empty** — every render-state line *inside* those blocks (`ZWriteEnable`, `AlphaBlendEnable`, `DestBlend`, `SrcBlend` in Skydome.fx; same in MeshGloss/MeshAdditive) is **no-op'd**. Only lines *outside* the block (e.g. MeshGloss's `AlphaBlendEnable=(m_lightScale.w<1.0f)`, and the `VertexShader`/`PixelShader` assigns) are actually applied by `Begin()`. So the app **must** set ZWrite/ZEnable/blend factors/cull itself, and `RenderSkydome`'s current 4-state save/restore is insufficient. **Mitigation:** the draw loop explicitly sets, per sub-mesh, the state the shader expects (Skydome: `ZWriteEnable=FALSE`, `ZFunc=LESSEQUAL`, `AlphaBlendEnable=FALSE`; MeshAdditive: `AlphaBlendEnable=TRUE`, `SrcBlend=ONE`, `DestBlend=ONE`/INVSRCALPHA per its pass; MeshGloss: ZWrite TRUE, src/dest SRCALPHA/INVSRCALPHA), and the wrapping save/restore captures the **full delta** any sub-mesh touches: `ALPHABLENDENABLE`+`SRCBLEND`+`DESTBLEND`+`ZWRITEENABLE`+`ZENABLE`+`CULLMODE`+vertex decl, restored once after the loop. Set explicit factors rather than trust device state. Sampler address/filter is **embedded** in the `.fx` sampler objects (`AddressU/V=WRAP`, LINEAR — Skydome.fx:72-90) and applied by `Begin()`, so stage-0/1 sampler leak is not a risk for the shaders verified; if a future dome shader relies on app-set samplers, that surfaces in the Step-0 dump.

3. **On-disk color offset — PINNED (downgraded from blocker to confirmatory).** `alD3dVertNU2C`'s color drives both SH-diffuse and cloud-alpha; a wrong offset yields a flat/odd-tinted dome (visible, not a crash). The earlier "spec color@24 vs survey UV0@24" contradiction is **resolved** by max2alamo's exporter: on-disk color is a **float4 at offset 80** (the @24 figure was the separate runtime 36B NU2C decl). **Mitigation:** code routes through `kMV_Color_Offset = 80`; the `#ifndef NDEBUG [AloVtx]` first-vertex dump *confirms* the pinned offset rather than discovering it, and a test asserts clearblue's first-vertex color bytes against the max2alamo-derived expectation; if the format has no `C`, skip the color element.

4. **Dual-slot vs mesh-model inconsistency (would throw away the secondary code).** The earlier dual-slot design cloned a single-texture/single-effect scalar; a nebula dome is N sub-meshes with N shaders. **Mitigation:** §3.4 reconciles — secondary is a full `SkydomeMesh`+`SubMeshGpu` collection, identical machinery to primary; the only scalar kept is the bundled-slot index for the simple-background fallback.

5. **Two duplicate `.alo` parsers + duplicate param struct (scope creep).** **Mitigation:** one parser only (`AloModel`); the render core consumes its output and never re-parses. `AloShaderParam` mirrors `Effect::Parameter`'s kind/order; kept separate solely to keep `AloModel.h` free of `Effect.h` (stated, deliberate).

6. **Mod-switch ordering: `ReloadShaders()`→`Clear()` runs *before* `ReloadTextures()`.** Confirmed: `ModManager::SelectMod` ([src/managers/ModManager.cpp:247-251](src/managers/ModManager.cpp)) calls `ReloadShaders` (→`m_shaderManager.Clear()`, [src/engine.cpp:572](src/engine.cpp)) before `ReloadTextures` (the re-resolve seam, :621-624). By the time re-resolve runs, the cache is gone; a held `Effect*` keeps the *old mod's* object alive. **Mitigation:** the dome re-resolve lives in/after `ReloadTextures` and **drops+reacquires** — `SAFE_RELEASE` the held `Effect*` and `getShader` afresh (cache cleared → loads the new mod's `.fxo`); never assume the held ref is current.

7. **Device-reset ordering: effects-then-buffers, not interleaved.** The existing dance does all `OnResetDevice` before `CreateBuffers`; a per-sub-mesh call bundling both interleaves them, so a mid-loop `CreateBuffers` failure leaves earlier sub-meshes reset and later ones not. **Mitigation:** two separate loops (all `OnResetDevice`, then all `CreateBuffers`) matching the engine's existing shape.

8. **Enumeration vs resolution have different readiness preconditions.** `LoadSkydomeList`/`ResolveSkydomeModel` are pure-FileManager (device-free, safe at first paint); `Resolve`/`CreateBuffers` need a valid device. A picker query firing before the device exists is fine for names but would crash on eager mesh resolve. **Mitigation:** enumerate-anytime, resolve-only-when-device-valid; the resolve path early-outs if `m_pDevice==NULL`.

9. **Stream-source / index state intentionally not restored (undocumented inherited dependency).** `SetStreamSource(0)`/`SetIndices` aren't in the effect state block; after the loop stream 0 / indices point at the last sub-mesh's buffers. The existing single-dome path relies on the next consumer (ground/particles) rebinding — true today. **Mitigation:** documented note in `RenderSkydomeMesh` that stream/index state is deliberately not restored (every subsequent draw rebinds); only decl + the render-state delta are restored.

10. **`D3DPOOL_MANAGED` illegal under D3D9Ex; DEFAULT resources go stale on Reset.** N effects + N VB/IB + M textures per dome, all DEFAULT pool; any missed release-before-Reset → `D3DERR_INVALIDCALL` (L-007/F6 class). **Mitigation:** all resources via the established DEFAULT-pool primitives; both lost/reset legs loop over *all* sub-meshes of *both* domes; never special-case a single resource; `OnLostDevice` nulls handles so double-release / draw-before-recreate is a guarded no-op.

11. **Bare material texture names CRC-miss the MEG without the art-dir prefix.** `.alo` stores bare leaves; `MegaFile` CRC-matches the full `DATA\ART\TEXTURES\…` path. **Mitigation:** synthesize `"Data\\Art\\Textures\\"+bareName` before `getFile` (mirrors curated slots), bare-name fallback for loose mod files; rely on `D3DXCreateTextureFromFileInMemory` content-sniffing (PNG comes only from loose mod files).

12. **Per-slot / per-sub-mesh degrade must not cascade.** A naive combined guard would blank a resolved primary when the secondary misses; a missing sub-mesh shader could skip the whole dome. **Mitigation:** two fully independent `Render()` guards (each `index!=Off && mesh non-empty && >=1 resolved sub-mesh`), and per-sub-mesh skip-on-unresolved inside the loop — sibling sub-meshes still draw.

13. **`max_viewport` wrong-technique hazard (MeshGloss).** Its leading un-annotated `max_viewport` technique could end active after `createShader`'s `FindNextValidTechnique` if the ctor's LOD loop finds no annotated match. **Mitigation:** Step-0 dumps the *active* technique per shader after both selection stages; if `max_viewport` is active, force-`SetTechnique` the `sph_t0` (DX8) handle by name in `Resolve`.

14. **uint16 index / oversized-count abuse.** A hostile `.alo` claiming >65535 verts breaks INDEX16; a count disagreeing with payload could over-alloc. **Mitigation:** `Verify(vertexCount<=0xFFFF)` and `Verify(count*stride==payload)`; all vectors sized from bounded `reader.size()`. **Accepted-and-named:** in-scope domes are single-buffer ≤~5k verts, so no index-splitting is designed — not worth it for the content.

15. **Persistence write-back firing under `--test-host` could mutate the dev box's real registry during Playwright/a11y runs.** **Mitigation:** copy the exact `m_testHost && !m_settingsLive` gate from the lighting precedent — no-op under `--test-host` unless `ALO_SETTINGS_LIVE`.

16. **Snapshot/DTO drift.** Forgetting the two new fields in the native snapshot builder or `mock-state.ts` makes consumers read `undefined`. **Mitigation:** add `skydomeSecondarySlot`/`skydomeSecondaryCustomPaths` in lockstep across the native builder (:642-643), the TS DTO (:209-210), `mock-state.ts` defaults, and every test stub snapshot.

17. **Legacy regression.** Any change to `m_skydomeIndex`'s meaning or the `SkydomeIndex` key breaks the legacy picker + round-trip. **Mitigation:** freeze the primary surface entirely; the secondary uses new keys legacy ignores.

18. **`BindShaderTextures` is a false friend.** It binds by the `texture_filename` *annotation* ([src/engine.cpp:312-339](src/engine.cpp)), not by authored param name — **not** reusable for `.alo` material textures. **Mitigation:** stated here so nobody wires it in; material textures bind by name via `matHandles`/`SetTexture`, flowing to samplers through the `.fx` `Texture=(BaseTexture)` linkage.

19. **`0x10005` old-vertex dome silently produces zero verts.** Both designs read only `0x10007`. **Mitigation:** detect `0x10005`, graceful-skip the sub-mesh with a `[AloVtx]` debug log; **accepted-and-named** as out-of-scope convert (no in-scope vanilla dome uses it).

---

## 5. Testing & verification

**Sequencing (each step lands independently; render core gated on Step-0):** Step-0 spike → STEP 1 `AloModel` (+ unit tests) → STEP 2 `SkydomeEnvironment` (+ unit tests) → STEP 4 **primary-persistence fix as its own bisectable commit** → STEP 3 render core (only after Step-0 passes) → STEP 5 dual-slot plumbing (web/schema/mock/Vitest layer before native compose). The web-side pins: `background-picker.spec.ts` slot-count + secondary round-trip (Playwright); `BackgroundPicker.test.tsx` + `BackgroundDropdown.test.tsx` stub snapshots gain the two fields; `mock-state.ts`/`mock.ts` parallel secondary state; schema response-type-map round-trip for the new kinds (Vitest).

**Step-0 spike (blocking, before committed render code):**
- [ ] `getShader` each of `Skydome.fxo`/`MeshAdditive.fxo`/`MeshGloss.fxo` on the real device; dump every `GetTechnique`/`ValidateTechnique` result and the **active** technique after both `createShader` and the `Effect` ctor; confirm a 1_x technique validates and `Begin()`→>0 passes.
- [ ] Byte-dump a real `w_skydome_clearblue` vertex; pin `kMV_Color_Offset`; resolve the on-disk-UV0@24-vs-color contradiction; record the known-good color bytes for the regression assert.

**`AloModel` happy paths (native, no install needed beyond the two fixture .alo):**
- [ ] clearblue → 1 mesh / 1 sub-mesh, shader `Skydome.fx`, format `alD3dVertNU2C`, vertexCount 180 / primitiveCount 298, params `BaseTexture=W_clearbluesky.dds`/`CloudScrollRate=0`/`CloudScale=1`/`Emissive≈(0.506,0.506,0.506,0)`; rawVertexBytes `180*144`, indexBytes `298*6`.
- [ ] nebula → 2 meshes; mesh0 `MeshGloss.fxo`/`alD3dVertN`/`BaseTexture=W_Galaxy_Starfield_101.png`; mesh1 `MeshAdditive.fx`/`alD3dVertNU2`/`BaseTexture=W_stars_sun00.dds` + `UVScrollRate`+`Color`. Confirms multi-`0x400` + per-sub-mesh distinct shaders/formats.
- [ ] Stride/index asserts: `onDiskStride==144` zero-remainder on all three formats; `indexPayload==primitiveCount*6`.
- [ ] Param byte-grammar: `0x10103` valLen 4→one float; `0x10106` valLen 16→FLOAT4; `0x10105` TEXTURE→null-term string; kind map 0x10105/0x10106 = TEXTURE/FLOAT4.

**`AloModel` edge / refused / malformed:**
- [ ] First root chunk ≠ `0x400` → `WrongFileException`; truncated payload → `ReadException`; depth-256 → `BadFileException` (inherited guard) — none crash.
- [ ] `.alo` with `0x200`/`0x600` at root loads `0x400` meshes correctly, ignores the rest (`meshes.size()` correct).
- [ ] Synthetic `vertexCount>65535` → `BadFileException` (no truncation); `count*144 != payload` → `BadFileException` (**throw-on-non-144**, not the happy case only).
- [ ] `0x10005`-only fixture → that sub-mesh graceful-skipped with `[AloVtx]` log, no zero-vertex silent draw.
- [ ] Color-offset regression: clearblue first-vertex color bytes == Step-0 known-good (catches a wrong `kMV_Color_Offset`).

**`AloModel` decl/transcode/cleanup:**
- [ ] `AloCreateDecl("alD3dVertNU2C")`→36B (POS/NORMAL/COLOR/TEXCOORD0); `("alD3dVertNU2")`→20B (POS/TEXCOORD0); transcoded stride == decl size each.
- [ ] Lost/reset round-trip: release→recreate yields byte-identical VB/IB (refilled from cache), decl pointer unchanged, **no FileManager hit** on recreate.
- [ ] Cleanup: `OnLostDevice` nulls handles, second call no-ops; teardown releases decl exactly once; caller's `IFile*` refcount unchanged after `LoadAloModel`. Graceful-degrade: a sub-mesh whose `CreateVertexBuffer` fails leaves NULL handles + `false`, sibling sub-meshes unaffected.

**`SkydomeEnvironment` (mock FM + fixture XMLs):**
- [ ] Space primary → 9 refs incl. `Stars_Low`/`w_stars_low.alo`/scale 1.0/inBackground true and `Cin_Space_Green_Screen`/scale 20.0.
- [ ] Space secondary → 13 refs incl. `Star_Backdrop_Blue`/`w_stars_nebula_blue.alo`/scale 25.0/sortOrder −1.
- [ ] Absent `<Sort_Order_Adjust>` (LandPrimary `Day_Blue_Sky`) → 0, `w_sky00.alo`, scale 1.0.
- [ ] Empty `<Sort_Order_Adjust>` + `In_Background="No"` (`Stars_Lua_Cinematic`) → 0 / false; dual model tags resolve to the space tag for SpacePrimary axis.
- [ ] Case-insensitive `In_Background`: `yes`→true, `no`→false, `No`→false.
- [ ] Land-secondary partial overlays (`Planet_Rings00`→`W_sky_rings00.alo`) enumerate normally.
- [ ] Total miss (all four `getFile`→NULL) → `false`, empty list (drives empty-state UX). Malformed XML → catch `ParseException`, `false`, no throw escapes.
- [ ] `LoadMapEnvironment` match-by-Name (both present → both `has*`); `secondaryName=""` → primary only; asymmetric (secondary Name not found) → `hasPrimary=true`/`hasSecondary=false`.
- [ ] `ResolveSkydomeModel` `w_sky00.alo`→true+bytes; `""`→false, bytes untouched.
- [ ] Path-prefix correctness (spy mock): `"Data\\XML\\SpacePrimarySkydomes.xml"` and `"Data\\Art\\Models\\w_sky00.alo"` passed to `getFile`.
- [ ] Mod-switch live re-enumeration: simulate `ModManager::SelectMod`→`ReloadTextures` re-enumerates; a mod-loose `SpacePrimarySkydomes.xml` shadows the base config.meg copy (getFile mod-first).

**Render core (real install user feel-tests + native instrumentation):**
- [ ] **Draws non-blank:** `[SkyDraw]` asserts `passes>0` and `DrawIndexedPrimitive` reached per resolved sub-mesh — distinguishes resolved from resolved-but-blank.
- [ ] clearblue renders SH-lit and matches in-game; nebula's two sub-meshes (MeshGloss + MeshAdditive) render with different textures/blend (proves per-sub-mesh shader binding).
- [ ] **SH materiality:** rotate the sun → dome diffuse changes (proves `SetMatrixArray(hSphLightAll,…,3)` by semantic + non-identity camera-locked `m_world`, not the GroundLit FILL/identity mistake).
- [ ] **Cloud-scroll materiality:** a non-zero `CloudScrollRate` dome scrolls over time (proves `SetFloat(hTime,GetTimeF())`); clearblue (`CloudScrollRate=0`) is static — no spurious motion.
- [ ] **Sub-mesh asymmetric miss within one dome:** nebula sub-mesh 0 resolves, sub-mesh 1 shader forced-fail → sub-mesh 0 still draws.
- [ ] **Compose order:** space layers secondary nebula *behind* primary starfield (no over-paint); land layers partial secondary overlay *on top* of the primary full dome; with both opaque the intended one is in front (draw order is the only depth arbiter).
- [ ] **L-032 blend regression:** after single- AND dual-dome draws (incl. the additive sub-mesh and an alpha-blended land secondary), particles do **not** whiten, ground unaffected (full delta + cull + decl restored). [tasks/lessons.md:2563](tasks/lessons.md).
- [ ] **Device lost/reset round-trip:** Alt-Tab / resize → every sub-mesh of both domes `OnLost`/`OnReset`, every DEFAULT VB/IB refilled from cache (no re-parse), every material texture reloaded; no `D3DERR_INVALIDCALL`; cloud-scroll phase continues off the free clock; double-reset leaks nothing.
- [ ] **Mod-switch three granularities:** override only the `.fxo` → dome picks up the new shader (re-getShader after `Clear()` fired); override only a material texture → texture re-resolves; override the `.alo` → re-parse.

**Dual-slot plumbing (web/native):**
- [ ] Schema round-trip (Vitest): new set kinds → `Record<string,never>`, query → `boolean`; `skydome-list` → `SkydomeRef[]`.
- [ ] Mock mutation (Vitest, `mock.ts`): `skydome-secondary-slot` patches `snapshot.skydomeSecondarySlot` + broadcasts `engine/state/changed`; `skydome-secondary-custom-path` appends into `skydomeSecondaryCustomPaths`.
- [ ] Playwright: two-section picker button count + both sections present by aria-label; `skydome-secondary-slot {slot:5}`→`snapshot.skydomeSecondarySlot===5`; secondary custom-path persists across snapshots.
- [ ] Slot-level asymmetric miss (native): primary resolves + secondary misses → primary still renders (and reverse).
- [ ] **Persistence restart (closes the gap):** set primary AND secondary in new-UI, restart → both restore from registry; the write is a no-op under `--test-host` (gate parity); the **primary fix lands as its own commit** so a dual-slot regression doesn't block it.
- [ ] **Empty-state / no-install:** no install → lists empty, simple-background (solid + custom-path) fallback live; no-install + a previously-persisted custom `.alo` path → no crash, clean fallback (define + verify the bundled-RCDATA-vs-mesh-path interaction: the simple-background path coexists; game-dome path empty → simple background renders).
- [ ] Vitest stub snapshots gain `skydomeSecondarySlot:0` + `skydomeSecondaryCustomPaths` (no undefined-field crash).

**Debug instrumentation (all `#ifndef NDEBUG`, grep tags):** `[AloVtx]` (vertex stride / color offset / 0x10005 skip), `[SkyDraw]` (passes>0 + draw-reached counters + active technique per shader), `[SkyEnv]` (exact `getFile` path + resolved/absent, to separate "wrong path" from "genuinely absent" during bring-up).

---

## Open decisions for the user (call before coding)

**RESOLVED (session 42):** (1) **Step-0 spike runs first** — a failed 1_x `ValidateTechnique` is a re-scope trigger, not a silent degrade. (2) **Replace** the fake-gradient tiles with the real enumerated dome `Name`s (keep solid-colour + custom-path fallback). (3) **Land/Space toggle, default Space.** (5) **Primary-persistence write-back ships as its OWN PR first.** Defaults accepted: (4) both slots default **Off**; (6) `0x10005` old-vertex domes **graceful-skip** (out of scope). Build sequence: persistence-fix PR → `AloModel` + `SkydomeEnvironment` leaf cores (+ tests) → Step-0 device spike → render core → dual-slot plumbing.

_(original questions retained below for context)_


1. **Step-0 gate.** Approve running the device spike first and treating a *failed* 1_x `ValidateTechnique` as a re-scope trigger (FIXEDFUNCTION fallback or recompile path), not a silent degrade? This is the single biggest budget risk.
2. **Picker model:** enumerate **real dome `Name`s** from the four XMLs (replacing the 8 fake-gradient bundled tiles entirely), or keep the bundled tiles *and* add an enumerated list? The plan assumes full replacement (fork d) with the solid-colour + custom-path fallback retained.
3. **Axis selection.** No battle-context signal exists. Accept a user-facing Land/Space toggle (default Space) on the picker, or hardwire Space for now and defer the toggle?
4. **Default secondary on first run.** Off (empty) for both slots, or seed a sensible default? Plan assumes both Off.
5. **Primary-persistence fix shipping independently.** OK to land the new-UI `SkydomeIndex` write-back (a pre-existing bug) as its own PR *before* the dual-slot work, so it's bisectable and ships value early?
6. **`0x10005` old-vertex domes.** Accept graceful-skip (out-of-scope) as planned, or is there a known vanilla/mod dome using it that forces the convert path into MT-15 now?