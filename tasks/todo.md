# MT-14 — Bump-mapped terrain lighting for the ground plane (session 40)

_2026-06-13. Triage-first ROADMAP item that, by user direction, grew into a
full game-faithful **bump-mapped terrain** ground render. Grounded in the
Petroglyph FoC shader source the user supplied (`foc_shaders.zip`, extracted
to `.tmp-foc-shaders/` — untracked; see Risk 9 for its permanent home).
Status: **PLAN APPROVED — risks iterated, both blockers resolved (see below).
Ready for execution. ★★★★.**_

**Resolved decisions (2026-06-13):**
- **Normal-map naming (Risk 1):** convention is **`<base>_bc.dds`** — e.g.
  grass `W_TEMPGRND00.dds` → `W_TEMPGRND00_bc.dds`, sand → `W_SAND00_bc.dds`,
  snow → `W_SNOW_RGH_bc.dds`. Per-user (first-party modder knowledge);
  **verify each resolves via FileManager and looks like a tangent-space normal
  (RGB≈128,128,255 baseline) during impl** — if `_bc` is actually a
  color/gloss map, the flat-normal fallback keeps us safe.
- **Reference shaders (Risk 9):** **track in `reference/foc-shaders/`**
  (committed, "Confidential — Do Not Distribute" header retained).

---

## 0. Triage verdict (the original MT-14 question, answered)

**Case 1 confirmed — the ground is *excluded* from scene lighting; world
lighting is NOT broken.** The editor's lighting setting
([`LightingPanel.tsx`](../web/apps/editor/src/screens/LightingPanel.tsx) →
`engine/set/light` + `engine/set/ambient` →
[`Engine::SetLight`](../src/engine.cpp:1421)) drives `m_lights[]` / `m_ambient`,
consumed **only by the shader-lit particles** (`pEffect->SetVector(hDirLight…)`
at [engine.cpp:767](../src/engine.cpp:767), plus the SPH matrices). The ground
is drawn fixed-function with `D3DRS_LIGHTING = FALSE` (set once at
[engine.cpp:2023](../src/engine.cpp:2023), never re-enabled) and a hardcoded
**white** vertex diffuse ([engine.cpp:868-871](../src/engine.cpp:868)), so it
always renders `texture × white`, independent of the lighting state. The fix is
therefore "feed the light into the ground draw" — but the user chose to do it
the **game-faithful** way (bump-mapped terrain), not a cheap tint.

---

## 1. Goal + scope

**Goal.** When this ships, the editor's ground plane renders with the game's
**bump-mapped terrain lighting** (the `TerrainMeshBump.fx` `bump_spec` path):
per-pixel dot3 sun diffuse off a tangent-space **normal map**, spherical-harmonic
**fill** lighting per-vertex, gloss-alpha-gated specular, all `×2` (`MODULATE2X`)
over the base texture — so changing the editor's sun / fill / ambient visibly and
faithfully relights the ground exactly as in-game terrain reacts. Normal maps are
resolved **from the game/mod at runtime** via `FileManager`, with a neutral
flat-normal fallback when none is found. This makes the ground a faithful
predictor of in-game appearance (also advances MT-16) and reuses the exact SPH
lighting data the editor already maintains.

**In scope (In):**
- A new bundled effect `GroundLit.fx` — a trimmed `TerrainMeshBump` (bump+spec
  technique) with the cloud-shadow and fog-of-war multiplies removed, plus a
  ps_1_1 gloss fallback technique and graceful no-effect degrade to today's
  unlit FF quad.
- Engine render path mirroring the **skydome effect precedent**:
  `m_pGroundEffect` + parameter handles + `m_pGroundDecl`
  (POSITION/NORMAL/TEXCOORD0/TANGENT/BINORMAL) + a `RenderGroundLit()` method;
  effect lifecycle (`OnLostDevice`/`OnResetDevice`), compile-failure
  graceful-degrade.
- Normal-map resolution: slot → known-vanilla-base-name → derived companion
  normal-map name → `FileManager` load; flat-normal (RGBA 128,128,255,255)
  procedural fallback texture when absent; companion-next-to-path for custom
  slots.
- Binding the existing lighting state to the effect: `m_sphLightFill` (fill
  SPH), sun world vector (`m_lights[0].Position`), eye world position, sun
  diffuse/specular, material defaults, the `×2`, and an explicit identity world
  transform for the quad.
- Commit the Petroglyph reference shaders into the repo (see Risk 9) so this and
  LT-5 have a tracked source of truth.
- ROADMAP re-tier (MT-14 grew — move out of near-term; cross-ref LT-5/MT-16) +
  CHANGELOG entry.

**Out of scope (Out) — with reasons:**
- **Cloud-shadow & fog-of-war multiplies** — no editor equivalent; user
  explicitly confirmed dropping them.
- **Per-slot custom normal-map picker UI** — user chose runtime game/mod
  resolution; a manual picker is a *future PR if anyone asks*.
- **Bundling normal-map assets** — user chose runtime load, not bundling.
- **Heightmapped / multi-splat terrain** (`TerrainRender*.fx`) — irrelevant to a
  single-quad ground; *out-of-scope, wrong shader family*.
- **Colorization** (`BumpColorize`) and the **particle** bump shader — that's
  **[LT-5]**, a separate ROADMAP entry.
- **Specular on the dirt (slot 0) / solid-color / empty-custom slots' gloss
  realism** — these have no vanilla normal/gloss source; they get the
  flat-normal fallback (correct lighting, no relief) — *deliberate, not
  forgotten*.

---

## 2. What the codebase already gives us

- **Skydome effect path = the template.** MT-3 already renders a textured quad
  through a `D3DXEffect`: `m_pSkydomeEffect` created via `D3DXCreateEffect`
  ([engine.cpp:2226](../src/engine.cpp:2226)), param handles
  ([:2240](../src/engine.cpp:2240)), `OnLostDevice`/`OnResetDevice`
  ([:1506](../src/engine.cpp:1506)/[:1552](../src/engine.cpp:1552)),
  graceful-degrade if compile fails ([:2610](../src/engine.cpp:2610)), its own
  vertex decl `m_pSkydomeDecl` ([:2109](../src/engine.cpp:2109)), and a
  `RenderSkydome()` Begin/Pass/draw/End ([:2298](../src/engine.cpp:2298)).
  `RenderGroundLit()` mirrors this almost verbatim.
- **The SPH lighting data is already built and live.** `m_sphLightAll[3]` /
  `m_sphLightFill[3]` (`D3DXMATRIX`, [engine.h:664](../src/engine.h:664)) are
  rebuilt on every `SetLight`/`SetAmbient` via `SPH_Calculate_Matrices`
  ([engine.cpp:1438-1448](../src/engine.cpp:1438)) — the **same** matrices the
  game's `Sph_Compute_Diffuse_Light_*` evaluates (`AlamoEngine.fxh`). The bump
  path uses the **fill** set per-vertex; the sun is per-pixel.
- **`m_lights[3]`** (`Light{ Diffuse, Specular, Position, Direction }`,
  [engine.h:77](../src/engine.h:77)) + `m_ambient` — the sun vector
  (`Position`), diffuse, specular all ready to bind.
- **Runtime game/mod texture loading.** `LoadTextureViaFileManager(pDevice,
  m_fileManager, path)` (used by the skydome) over `IFileManager::getFile`
  ([managers.h:13](../src/managers.h:13)) resolves a `DATA\ART\TEXTURES\…` path
  from the active mod → basepaths → MEG archives. `FileManager::SetModPath`
  drives mod priority.
- **Ground slot model.** 8 slots: dirt(0)/grass(1)/sand(2)/snow(3) bundled as
  `IDB_GROUND*`, solid-color(4) procedural, 5-7 custom; per-slot custom paths
  `m_groundSlotCustomPaths[]`; `ReloadGroundTexture()`
  ([engine.cpp:1283](../src/engine.cpp:1283)) is the single re-decode choke
  point. **Known vanilla base names** (from the table comments,
  [engine.cpp:1200](../src/engine.cpp:1200)): grass=`W_TEMPGRND00`,
  sand=`W_SAND00`, snow=`W_SNOW_RGH`; dirt=unknown (pre-MT-2 `dirt.bmp`).
- **Vertex-decl pattern** — `ParticleElements[]`
  ([engine.cpp:105](../src/engine.cpp:105)) and the skydome decl show the
  `D3DVERTEXELEMENT9` idiom for the new tangent/binormal ground decl.
- **The ground draw is already per-frame** ([engine.cpp:864](../src/engine.cpp:864))
  — rebuilding the quad each frame, so live re-lighting is free.

---

## 3. Architecture / implementation approach

**Render path (engine.cpp).** Replace the FF ground block
([:859-881](../src/engine.cpp:859)) with: if `m_pGroundEffect` is ready, call
`RenderGroundLit()`; else fall back to the existing unlit FF quad (kept as the
degrade path). `RenderGroundLit()`:
1. `SetTransform(D3DTS_WORLD, &Identity)` so object space == world space (the
   game's bump VS works in object space; identity world makes
   `m_light0ObjVector == m_lights[0].Position` and `m_eyePosObj == eye`).
2. Bind params: `g_World`/`g_WorldViewProj`, the **fill** SPH matrix array
   (`m_sphLightFill`, 3×float4x4), sun obj vector + diffuse + specular, eye obj
   pos, base texture (`m_pGroundTexture`), normal texture
   (`m_pGroundNormalTexture` or the flat fallback), material Diffuse/Specular/
   Emissive defaults.
3. Build the 4-vertex quad in the new `GroundVertex` layout (constant
   `T=(1,0,0)`, `B=(0,1,0)`, `N=(0,0,1)` — flat plane), `SetVertexDeclaration(
   m_pGroundDecl)`, `Begin`/`BeginPass`/`DrawPrimitiveUP`/`EndPass`/`End`.
4. Restore: re-assert `D3DRS_ZWRITEENABLE FALSE` (already done at
   [:886](../src/engine.cpp:886) before particles) and the particle vertex decl,
   exactly as the skydome restores `oldDecl` ([:2348](../src/engine.cpp:2348)).

**`GroundLit.fx`** (new bundled RCDATA, loaded like the skydome effect).
Verbatim port of `TerrainMeshBump`'s `sph_bump_spec_vs_main` /
`bump_spec_ps_main` minus the cloud + FOW samplers/multiplies:
`diff = base.rgb·(ndotl·Diffuse·m_light0Diffuse + sph_fill)·2;
spec = m_light0Specular·Specular·pow(ndoth,16)·base.a·2; final = diff+spec`.
Three techniques: bump+spec (ps_2_0, primary), gloss (ps_1_1 fallback), and we
rely on the C++ no-effect path rather than the FF technique. Parameter names via
semantics where possible so they bind off the existing engine state.

**Normal-map resolution** (extend `ReloadGroundTexture`, or a sibling
`ReloadGroundNormalTexture`): map slot→vanilla-base-name (the 3 known) → derive
the companion normal name (**convention TBD — Risk 1**) → `LoadTextureViaFileManager`
from `DATA\ART\TEXTURES\…`; on miss, point `m_pGroundNormalTexture` at the
procedural flat-normal texture (created once, like the solid-color 1px tile at
[:1246](../src/engine.cpp:1246)). Custom slots: derive companion next to the
custom path. Re-run on `SetGroundTexture` and in `Reset` (D3DPOOL_DEFAULT).

**New engine members:** `m_pGroundEffect`, `m_pGroundDecl`,
`m_pGroundNormalTexture`, `m_pGroundFlatNormalTexture`, handles `m_hGround*`.
All NULL-init in the ctor/`Reset`, released in dtor + `OnLostDevice`, recreated
in `OnResetDevice`, mirroring the skydome members 1:1.

---

## 4. Risks named up front + mitigations

1. **Normal-map naming convention is UNKNOWN — top risk, blocks real relief.**
   Alamo binds `NormalTexture` via the terrain **material/MTD**, not a shader-side
   suffix, so there is no convention in the shader source the user gave. I do not
   know the vanilla EaW/FoC terrain normal-map filenames (e.g. is grass's normal
   `W_TEMPGRND00_NRM.dds`? `W_TEMPGRND00_bump`? a separate name entirely?).
   *Mitigation:* (a) **ask the user** (a modder with the game files) for the
   convention / a known example pair; (b) ship the flat-normal fallback so the
   pipeline is correct and verifiable *now*, with relief lighting appearing the
   moment the names resolve; (c) verify any proposed name against the actual game
   archives before hardcoding. **This needs the user's answer before the
   normal-resolution code is worth writing.**
2. **Ground base is bundled-only (not game/mod-resolved).** Unlike skydome, the
   base ground texture comes from `IDB_GROUND*`, so I can't read its source path —
   I derive the normal name from the slot→vanilla-name map. Dirt(0) has no known
   vanilla name. *Mitigation:* resolve normals for the 3 named slots; flat-normal
   for dirt/solid/empty-custom (lit, no relief — acceptable per scope).
3. **ps_2_0 support.** `bump_spec_ps_main` compiles ps_2_0. The editor already
   runs ps_2_0-class post-process (bloom/heat), so the D3D9Ex device supports it.
   *Mitigation:* the ps_1_1 gloss technique + the C++ unlit-FF degrade cover any
   compile/caps failure — same graceful-degrade contract as the skydome.
4. **Render-state restore into the particle passes.** The effect sets ZWrite/blend
   for opaque terrain; the particle loop immediately after needs `ZWRITEENABLE
   FALSE` + painter's order ([:883-891](../src/engine.cpp:883)). *Mitigation:*
   re-assert that state after `End()` (it's already set at :886) and restore the
   particle decl, exactly like `RenderSkydome`.
5. **Device-reset lifecycle under D3D9Ex.** Effect + both normal textures
   (D3DPOOL_DEFAULT) must release on `OnLostDevice` and recreate/reload on
   `OnResetDevice`/`Reset`. *Mitigation:* mirror the skydome's lifecycle lines
   1:1; reload normals in `Reset` alongside `ReloadGroundTexture`.
6. **World-matrix assumption.** Object-space lighting needs identity world. The
   current FF ground draw never sets `D3DTS_WORLD`. *Mitigation:* `RenderGroundLit`
   sets it to `Identity` explicitly and the effect's `m_world` semantic picks it up.
7. **Perf.** A per-frame `Begin/End` for two triangles — negligible (the skydome
   already does this every frame).
8. **Test goldens.** a11y/HWND goldens are DOM/UIA — unaffected by an engine
   render change. Native preview specs that snapshot the viewport *could* shift if
   any capture includes ground pixels. *Mitigation:* run the native harness and
   diff; regenerate only if a ground-bearing snapshot is intentional.
9. **Reference shaders are untracked.** They live in `.tmp-foc-shaders/`.
   *Mitigation:* commit them to `reference/foc-shaders/` (or
   `docs/petroglyph-shaders/`) with the "Confidential — Do Not Distribute" header
   noted; decide with the user whether to track them at all vs. keep local-only +
   `.gitignore`. (They're Petroglyph-released; tracking aids LT-5.)

---

## 5. Testing & verification

**Build:** host Debug x64 clean (VS18 MSBuild, L-046); fresh worktree → L-039
(NuGet copy) + L-040 (`pnpm build`) done first.

**Happy paths:**
- Toggle sun intensity / azimuth / altitude / diffuse colour / ambient in the
  Lighting panel → ground brightens / dims / tints live, in the same direction as
  the particles.
- A slot whose normal map resolves → visible per-pixel relief that shifts with
  sun azimuth; specular glint tracks the sun.

**Edge cases / degrade:**
- Slot with no normal (dirt/solid/empty-custom) → lit, flat, no relief, no crash.
- `GroundLit.fx` compile forced to fail → silent fall-back to today's unlit quad.
- ps_2_0 unavailable (simulate) → gloss technique renders.
- Custom-path slot with & without a companion normal.

**Lifecycle:** alt-tab / resize / device-reset → ground re-renders correctly
(effect + normals reloaded), no leaked/black ground.

**Non-regression:** particle passes unchanged — z-order, blend, painter's order
intact (compare a particle scene before/after); skydome + bloom + heat passes
unaffected.

**Harness:** `pnpm --filter @particle-editor/editor test` → 795 (web untouched —
this is engine-only); native harness ~180/0 (overload specs flake at the tail —
L-066, re-run in isolation); diff any viewport goldens.

**Debug instrumentation (`#ifndef NDEBUG`):** `[GroundLit]` printfs for effect
load (ok/fail→degrade), per-slot normal resolution (`resolved <path>` /
`fallback flat`), and the ps technique selected. Grep tag: `[GroundLit]`.

---

## Review

**Implemented (session 40, on `claude/exciting-dubinsky-4e993d`).**
- New bundled effect [`GroundLit.fx`](../src/Resources/Engine/GroundLit.fx)
  (`IDR_SHADER_GROUND_LIT`, RCDATA in [`ParticleEditor.rc`](../src/ParticleEditor.rc)):
  self-contained port of `TerrainMeshBump`'s bump+spec path — per-pixel dot3
  sun off a tangent-space normal map, SPH-**fill** per-vertex, gloss-alpha-gated
  specular, ×2. Cloud/FOW dropped. **Single `vs_2_0`/`ps_2_0` technique** (the
  planned ps_1_1 gloss fallback was cut — the runtime D3DX compiler rejects
  ps_1_x, X3539; the flat-normal fallback covers the no-relief case → L-084).
- Engine path mirroring the skydome effect: `m_pGroundEffect` + handles +
  `m_pGroundDecl` (POS/NORMAL/TEX/TANGENT/BINORMAL) + `RenderGroundLit()`, with
  full `OnLostDevice`/`OnResetDevice` lifecycle and a compile-failure
  graceful-degrade to the original unlit FF quad. Identity world ⇒ object==world.
  Particle depth state (`ZENABLE TRUE`, `ZWRITE FALSE`) re-asserted after the
  ground block so it's path-independent (L-032 decl restore honoured).
- Normal-map resolution ([`Engine::ReloadGroundNormalTexture`](../src/engine.cpp)):
  slot→vanilla-base→`<base>_bc.dds` via `LoadTextureViaFileManager`
  (grass/sand/snow); custom-slot companion-next-to-path; 1px (128,128,255)
  flat-normal fallback. Hooked into `SetGroundTexture`/`SetGroundSlotCustomPath`
  + the `OnResetDevice` reload chain.

**Verified (automated, this session).**
- Host **Debug x64 builds clean** (only the pre-existing benign LNK4098).
- **Cold-launch smoke (stderr capture):** `[GroundLit] effect loaded ok;
  technique=bump` — the shader compiles and the bump technique validates on the
  D3D9Ex device. `[GroundLit] slot=0/5 normal=flat-fallback` — resolution runs,
  flat fallback where no `_bc` resolves. **No startup crash.**
- Web baseline unaffected (engine-only change): **795/795** at session start.

**Feel-test (2026-06-13) — PASSED after one iteration.**
- First look: ground lit + responding, but **specular blew out at certain
  angles**. Root-caused to porting the wrong sibling shader (`TerrainMeshBump`):
  (a) gloss read from base-colour alpha (placeholder = 1 → full gloss) instead
  of the **`_bc` map's alpha** (`TerrainRenderBump.fx:177`), (b) specular x2 when
  the heightmap terrain shader uses **x1**, (c) the flat-fallback normal had
  alpha 1 (glossy) — set to **0 (matte)**. Also fixed a single-quad specular
  smear by moving to **per-pixel world-space** evaluation. → user: "much better.
  this is great." (Lessons L-084, L-085.)
- Final verification: web **795/795**, host Debug **+ Release** x64 clean, native
  harness **181 passed / 30 skipped** (no golden shift), visual confirmed.

**Still unverified — needs the user's MOD (not blocking):**
- **Real `_bc` resolution + per-pixel relief + gloss-gated specular in motion.**
  This dev box has no game/mod, so every slot read flat-fallback (matte). The
  `_bc` naming + the gloss-in-alpha convention are per the user's spec; validate
  against a real mod when convenient. If a slot reads wrong, it's a one-line fix.

**Original pre-feel-test unknowns (now resolved by the feel-test above):**
1. **Visual relight** — does toggling the Lighting panel (sun intensity /
   azimuth / altitude / ambient) actually brighten/dim/tint the ground? (The
   whole point of the feature; can't be auto-judged.)
2. **Real `_bc` normal resolution + per-pixel relief** — only resolves with a
   game/mod configured that ships `W_TEMPGRND00_bc.dds` etc.; this dev box has
   none, so every slot read flat-fallback. Needs the user's game/mod + a
   grass/sand/snow slot to confirm the `_bc` naming is right and relief appears.
3. **×2 brightness parity** — does the lit ground read like in-game terrain?
4. **Device reset** (alt-tab / resize) preserves the ground; **particle passes**
   visually unaffected (z-order / blend).

**Deferred until after the feel-test confirms the visual:**
- **ROADMAP re-tier** (MT-14 grew to a 12–20h bump-terrain feature; move out of
  near-term, cross-ref LT-5/MT-16) and **CHANGELOG** entry — both land in the PR
  once the user confirms it looks right, to avoid documenting a feature that
  might need a lighting-direction/brightness tweak.
- **Native a11y/UIA harness** — engine-render change; goldens are DOM/UIA so
  expected byte-stable, but run before merge to confirm no viewport-snapshot
  golden shifted.
