# LT-7 — In-preview scale references: imported game objects + a unit grid

Branch `claude/lt-7-game-objects` off `master` (`aadb48e`). Designed via two multi-agent
design passes (understand → deepen → integrate) grounded in the real FoC install + the
`max2alamo-2026` exporter source. ★★★★★, ~5 landable PRs.

---

## 1. Goal + scope

**Goal.** The user picks a **real game/mod object by its in-game Name** from a viewport
picker; the editor loads its `.alo`, places it in the preview with a **numeric
position/rotation gizmo**, and renders it **1:1 via each sub-mesh's own game shader**
(no shader forks) as inert reference geometry — so an effect can be sized against the
thing it attaches to. Plus a **unit grid** at known native spacing. The renderer handles
**static single-mesh AND rigid multi-part** objects (vehicles / turrets / structures) by
decoding the skeleton + connections `AloModel` currently skips and placing each rigid
sub-mesh by its bone's accumulated object-space bind transform.

**In (v1):**
- Name-enumerated picker of real objects (`GameObjectFiles.xml` → per-file `<TAG Name=>` →
  resolved `*_Model_Name`, with `Variant_Of_Existing_Type` inheritance), via `IFileManager`.
- Static + **rigid multi-part** placement (skeleton `0x200` + connections `0x600` decode).
- Extended transcoder (the tangent/binormal formats game objects use: `alD3dVertNU2U3`,
  `NU2U3U3`, `NU2U3U3C` on top of the dome's N/NU2/NU2C).
- Numeric 6-field gizmo (X/Y/Z + yaw/pitch/roll) reusing the proven `Spinner` drag-scrub.
- A basic unit grid (engine's first line primitive), defaults: spacing 20, ±800 extent,
  major line every 5 cells.
- Bridge + registry persistence + a React `ReferenceObjectPicker`, mirroring MT-15 skydome.
- Every render claim verified via the `#165` `debug/capture-frame` PNG bridge.

**Out (explicit deferrals):**
- **Skinned units** (`alD3dVertRSkin*` / `alD3dVertB4I4*`) — detected per-sub-mesh and
  **skipped** (greyed in the picker, "skinned — not yet supported"); they need a bone-matrix
  palette the editor has no source for. *(The classic "load a trooper" is NOT in v1.)*
- **Grid labels** — deferred to LT-6 (unit parity + a text-render dependency).
- **(IN SCOPE as PR-F, user-chosen)** the in-viewport drag-handle 3D manipulator. The
  transform *state + bridge + persistence* land in PR-D (drivable programmatically + a minimal
  numeric entry as the precise/fallback path); the grabbable-axis manipulator (viewport
  ray-picking + screen-to-world + host-side hit-testing on rendered handle geometry, **no
  precedent** in the codebase) is the capstone PR-F, built on an already-placed object and
  given its own focused design pass when reached.
- **`.alo` lights (`0x1300`)** — kept skipped, so `connection.objectIndex == mesh ordinal`.
- Full GameObject XML *semantics* beyond model resolution (build costs, abilities, etc.).

---

## 2. What the codebase already gives us

- **`AloModel`** (#160) keeps the **full 144-B vertex** verbatim (tangent@56, binormal@68,
  color@80 already present) — the transcoder just needs new format cases, no parser change
  for geometry. It currently **skips** `0x200`/`0x600` — PR-A surfaces them.
- **`SkydomeMesh` + `RenderSkydomeMesh`** (#163) = the load-`.alo`+run-each-sub-mesh's-own-
  game-shader-1:1 template (resolve, DEFAULT-pool VB/IB, material handles/textures, device
  lost/reset two-phase). LT-7 clones it; diverges in transcoder + **solid render state**.
- **`RenderGroundLit`** (#151) = the better template for a *solid* `.alo`-shader draw (full
  WVP/World/light/SphFill/eye binding + per-pass `SetVertexDeclaration` + L-032 save/restore).
- **`SkydomeEnvironment`** (#160) = the `IFileManager` + `XMLTree` enumeration template the
  catalog clones.
- **MT-15 dual-slot plumbing** (#163) = the bridge + persistence + React-picker template
  (`engine/set/skydome-environment`, `PersistSkydomeEnvironment`, `BackgroundPicker.tsx`).
- **Vec3 wire helpers** `Vec3ToJson`/`JsonToVec3` (BridgeDispatcher.cpp:149/180) + the
  `m_wind`/`m_gravity` Vec3 state precedent (engine.h:695) for the transform.
- **`Spinner`** drag-scrub React control (used by camera/lighting) for the numeric gizmo.
- **`debug/capture-frame`** (#165) PNG bridge → every render step is self-verifiable.
- **The matrix convention already matches the `.alo`**: engine uses row-vector
  `world*view*proj` + `LookAtRH`/`PerspectiveFovRH`, RH Z-up — same as `.alo` object space,
  so on-disk bone matrices map in with **no transpose**.

---

## 3. Architecture / build sequence (5 landable PRs)

### PR-A — `AloModel` skeleton (`0x200`) + connections (`0x600`) decode *(pure data, no D3D)*
- `struct AloBone { std::string name; uint32_t parentIndex; bool visible; uint32_t billboardMode; float matrix[12]; }`
  (12 floats verbatim, **column-major** on disk: cols of 4).
- `struct AloConnection { uint32_t objectIndex; uint32_t boneIndex; }` (from `0x602` mini id2/id3).
- Extend `AloModel` with default-empty `bones` + `connections`; replace the blanket
  `r.skip()` at `AloModel.cpp:240` for `0x200`/`0x600` with tolerant readers (trust actual
  `0x202`/`0x602` children, **not** the stub `0x201`/`0x601` counts → existing skip-tests stay green).
- `void ComputeBoneObjectMatrices(const std::vector<AloBone>&, std::vector<D3DXMATRIX>&)` —
  D3DXMATRIX row i = `(m[i], m[i+4], m[i+8], 0)`, row3 = `(m[3], m[7], m[11], 1)`; accumulate
  `obj[i] = local[i] * obj[parent[i]]` (parents guaranteed earlier). *(in a sibling header so
  AloModel stays D3D-free? — `D3DXMATRIX` pulls d3dx; keep this helper in the render layer, not AloModel.)*
- **Verify:** extend `tests/test_alo_model.cpp` with a real multi-bone skeleton+connection
  stub; round-trip the turret `Barrel` bone matrix. Existing 30 cases stay green.

### PR-B — `ReferenceObjectMesh` static + rigid-multi-part render core *(depends PR-A)*
- NEW `src/ReferenceObjectMesh.{h,cpp}` cloned from `SkydomeMesh`; **per-`AloMesh` (0x400)
  group carries its own world matrix** = `boneObjectSpace(connection.boneIndex) * placementWorld`
  (skydome has one shared world for all sub-meshes — this is the key divergence).
- **Extended transcoder**: add `RF_NU2U3 / RF_NU2U3U3 / RF_NU2U3U3C` emitting `TANGENT0`@56 +
  `BINORMAL0`@68 (`D3DDECLTYPE_FLOAT3`) on top of N/NU2/NU2C.
- **Skinned skip**: drop a sub-mesh whose `vertexFormatName` starts `alD3dVertRSkin`/
  `alD3dVertB4I4` (belt-and-suspenders: also if a `0x10006` remap is present); set a
  `SkippedSkinned()` flag. **Per-sub-mesh** (AT-AT mixes skinned body + rigid collision).
- **Collision/shadow filter** *(open Q — PR-B or defer)*: skip `MeshCollision.fx`/
  `MeshShadowVolume.fx`/`*Collision*`/`*Shadow*` sub-meshes.
- `Engine::RenderReferenceObject()` — **solid** state: `ZENABLE/ZWRITE TRUE`, `CULL_CCW`
  (verify winding via capture; flip to CW if inside-out), single opaque phase, **L-032
  save/restore** (copy `RenderSkydomeMesh:2562-2571`), injected **above** the particle draw so
  the engine's `ZENABLE=TRUE/ZWRITE=FALSE` re-assert for particles.
- Device lost/reset + `ReloadTextures` (mod-switch) wiring, cloned from `SkydomeMesh`.
- **Verify (capture PNGs, dev-box files):** `AI_Bunker_Turret1.alo` (barrel sits
  **horizontally** atop the turret → proves bone rotation + chain); a single-mesh prop
  (up-axis/winding); `All_Terrain_Anti_Aircraft.alo` (mixed: rigid parts render, skinned body
  skipped, no garbage).

### PR-C — `GameObjectCatalog` — enumerate by Name *(pure `IFileManager`, depends none)*
- NEW `src/GameObjectCatalog.{h,cpp}`, paralleling `SkydomeEnvironment`.
- `BuildGameObjectCatalog(IFileManager&, GameObjectCatalog&)`: read `Data\XML\GameObjectFiles.xml`
  (`<File>` list, ~120 vanilla) → **two-phase**: (1) parse every listed file into a global
  `Name→{rawModelPath, variantOf, tag, category, sourceFile}` map (per-file miss non-fatal);
  (2) resolve `Variant_Of_Existing_Type` inheritance ONLY after all files load (cross-file +
  cyclic-safe). Model field varies → try `Land_Model_Name`→`Space_Model_Name`→`Model_Name`→…
- `GameObjectCategory { Vehicle, Infantry, Structure, Turret, Hero, Prop, Space, Projectile, Other }`
  from the container tag (for picker grouping).
- **Lazy** `ProbeModelSkinned(IFileManager&, modelPath)` — loads the `.alo` on-select (NOT at
  build; ~3,911 objects / thousands of `.alo` would freeze startup) and caches
  `skinnedUnsupported`. *(skinned-vs-rigid is a property of the `.alo`, not the XML category —
  e.g. "Scout_Trooper" → rigid `EV_Bike.ALO`.)*
- Rebuild once per active mod (cache keyed by mod identity; invalidate on mod-switch).
- **Verify:** unit tests w/ mock FM — cross-file + cyclic `Variant_Of` resolution; the model-
  field fallback; category mapping. Dump-mode validation against the real install.

### PR-D — Engine ref-object state + bridge + persistence + React picker/gizmo *(depends B, C)*
- **Engine:** `m_referenceObjectName / m_referenceVisible / m_referencePosition(Vec3) /
  m_referenceRotation(Vec3) / m_referenceMesh(ReferenceObjectMesh)`; getters/setters mirroring
  skydome + wind/gravity; `RebuildReferenceObjectMesh()` (clone `RebuildSkydomeMeshes`, hook
  into `ReloadTextures`); `EnumerateReferenceObjects()` (calls the catalog).
- **Bridge kinds:** `engine/set/reference-object {name}`, `…/reference-object-visible {visible}`,
  `…/reference-object-transform {position:Vec3, rotation:Vec3}`, `engine/set/grid-visible {visible}`,
  `engine/set/grid-spacing {spacing}`, `engine/query/reference-object-list` (+ skinned flag).
- **DTO:** `referenceObjectName, referenceObjectVisible, referenceObjectPosition:Vec3,
  referenceObjectRotation:Vec3, gridVisible, gridSpacing`.
- **Persistence:** `PersistReferenceObject/-Visible/-Transform/-Grid` (REG_SZ/REG_DWORD/binary),
  gated `!(m_testHost && !m_settingsLive)`; HostWindow startup restore (post-device-up).
- **Rotation convention:** wire Vec3 = **degrees** [yaw,pitch,roll]; engine deg→rad in one named
  helper → `D3DXMatrixRotationYawPitchRoll`. Pin + document the axis assignment.
- **React:** `ReferenceObjectPicker.tsx` cloned from `BackgroundPicker` — a Name list (grouped
  by category, skinned greyed) from `reference-object-list` + visibility + grid toggle/spacing
  + a **minimal numeric 6-`Spinner` transform entry** (precise/fallback path; the primary UX
  is the PR-F manipulator). bridge-schema typing (keep new kinds in `ResponseForA`) + mock +
  Vitest contract/component tests.
- **Verify:** Vitest (enumeration query, Spinner→transform Vec3 dispatch, visibility); native
  build; capture PNG of a placed+rotated object.

### PR-F — In-viewport 3D drag manipulator *(capstone; depends D; needs its own design pass)*
- The user-chosen primary gizmo: grabbable axis handles (translate arrows + rotate rings)
  rendered over the placed object; drag to move/rotate, writing the same
  `reference-object-transform` state PR-D owns.
- **No precedent** — needs: handle geometry render (line/tri overlay, depth-aware or always-on-top),
  **viewport ray-picking** (DOM/canvas mouse → world ray via the inverse view-proj), host-side
  hit-test against the handles, and drag math (project pointer delta onto the grabbed axis/plane).
  Input routes through the arch-C path (DOM canvas → bridge → `InputDispatcher` → viewport HWND),
  so the hit-test/drag lives host-side and feeds the new transform back to React.
- **Deferred design:** scope ray-picking + handle render + the arch-C input/drag loop in a focused
  pass once PR-D's transform plumbing exists (so the manipulator targets a real, placed object).
- **Verify:** capture PNGs of handle render + before/after drag; the round-trip transform matches
  the numeric path; reuse the `debug/capture-frame` bridge.

### PR-E — Unit grid — fixed-function line-list primitive *(depends D for the toggle UI)*
- `Engine::RenderUnitGrid()` — the engine's **first** line primitive: `DrawPrimitiveUP`
  `D3DPT_LINELIST` reusing `EmitterInstance::Vertex` (Position + D3DCOLOR, the ground-quad
  decl) — **zero new decl / shader** (device already has world=I/view/proj + `LIGHTING=FALSE`).
  Co-planar with the ground at `z = m_groundZ + epsilon` (z-test ON, z-write OFF), axis-aligned
  lines at `m_gridSpacing` over ±800, **brighter major line every 5 cells** (index%5==0 from
  centre). Design `DrawWorldLines(verts, lineCount)` reusably (future spawner-path viz, MT-17).
- `m_gridVisible/m_gridSpacing` state + setters (mirror `m_showGround`/`SetGround`).
- **Verify:** capture PNG — line count + major-every-5 cadence match the computed geometry;
  depth-occludes correctly behind the placed object.

---

## 4. Risks named up front + mitigations

1. **(high) Bone-matrix transpose/convention** → "collapse to diagonal" (max2alamo's own
   Phase-4c bug). *Mitigation:* explicit row-from-column map (§3 PR-A), inverse of the writer;
   unit-test round-trips the turret `Barrel` bone; capture proves the barrel is horizontal.
2. **(high) Treating the stored matrix as object-space** (skipping parent accumulation) →
   deep chains (AT-AT Thigh→Shin→Foot) render piled up. *Mitigation:* always
   `obj[i]=local[i]*obj[parent[i]]`; never use a bone's local matrix directly.
3. **(high) Mis-detecting skinned sub-meshes** → upload RSkin/B4I4 as rigid → mangled blob.
   *Mitigation:* skip **per-sub-mesh** on `alD3dVertRSkin`/`alD3dVertB4I4` (+ `0x10006` remap);
   capture `CamoStormtrooper.alo` (fully skipped) + `AT-AA` (rigid parts only).
4. **(high) Eager skinned-classification of ~3,900 `.alo` at startup** freezes the picker.
   *Mitigation:* XML-only catalog build; lazy `ProbeModelSkinned` on-select, cached.
5. **(high) "Full gizmo" ambiguity** (numeric vs in-viewport 3D manipulator). *Mitigation:*
   **OPEN QUESTION** before PR-D; v1 = numeric 6-Spinner (zero picking infra).
6. **(medium) `Variant_Of` cross-file/order/`Base`-vs-`FOC`** missing parents. *Mitigation:*
   strict two-phase (parse all → resolve after); cyclic-safe.
7. **(medium) Euler convention mismatch** React↔wire↔engine. *Mitigation:* pin degrees
   [yaw,pitch,roll]; one named deg→rad helper; Vitest asserts the Vec3.
8. **(medium) Backface winding / up-axis** → inside-out / on-its-side. *Mitigation:* CCW +
   capture-verify against a vanilla static `.alo`; named cull constant for a 1-line flip.
9. **(medium) Render-state / decl leak (L-032)** into particle draws. *Mitigation:* copy the
   save/restore delta; inject above the particle re-assert line.
10. **(low)** grid z-fight (epsilon lift); collision/shadow sub-meshes (name filter); TS
    `ResponseForA` depth (keep new kinds in A; `tsc --noEmit` early); test-host persist gates.

---

## 5. Testing & verification (per PR)

- **PR-A:** `tests/test_alo_model.cpp` — new multi-bone skeleton + connection stub; bone-matrix
  round-trip; existing 30 cases green (stubs still yield empty bones/connections).
- **PR-B:** capture PNGs (`AI_Bunker_Turret1` barrel-horizontal; a single prop up-axis/winding;
  `AT-AA` mixed skip); native Debug+Release clean.
- **PR-C:** mock-FM unit tests (cross-file + cyclic `Variant_Of`; model-field fallback; category);
  argv dump-mode vs the real install.
- **PR-D:** Vitest contract + `ReferenceObjectPicker` component (enum query, Spinner→Vec3,
  visibility, grid toggle); native build; capture of a placed+rotated object; `tsc --noEmit`.
- **PR-E:** capture (line count + major cadence + depth occlusion); native build.
- **Cross:** web Vitest full; leaf `.bat`s; cold-launch smoke; lineage re-check each PR.

**Dev-box verification targets (real `.alo`):** `AI_Bunker_Turret1.alo` (EaWX, clean rigid
multi-part), `All_Terrain_Anti_Aircraft.alo` (Chelmod, mixed rigid+skinned),
`CamoStormtrooper.alo` (Chelmod, pure skinned skip-case), a single-mesh prop/structure.

---

## 6. Decisions (resolved with the user)

- **Gizmo form:** in-viewport drag manipulator (chosen over numeric) → its own capstone **PR-F**;
  PR-D carries the transform state/bridge + a minimal numeric fallback entry.
- **Collision/shadow filter:** done in **PR-B** (skip ugly hull sub-meshes). *(default, not objected)*
- **Skinned picker UX:** greyed-and-visible with a "not yet supported" note. *(default)*
- **Sequence:** A→B→C→D→E→F (C can land in parallel with A/B). *(default)*
- **Grid defaults:** spacing 20 / ±800 / major-every-5 / no labels (labels → LT-6). *(confirmed)*

## 7. Execution log
- Planning complete (two design passes). Build order A→B→C→D→E→F.
- **PR-A SHIPPED** (#167, merge `53e8a10`): skeleton/connection decode, validated byte-for-byte
  vs the real `AI_Bunker_Turret1.alo`; +17 unit assertions, existing 30 green.
- **PR-B done (this branch `claude/lt-7b-renderer`):** `src/ReferenceObjectMesh.{h,cpp}` (clone of
  SkydomeMesh: extended transcoder adding `alD3dVertNU2U3` / `NU2U3U3` / `NU2U3U3C` with
  `TANGENT0`@56 + `BINORMAL0`@68 — verified vs `MeshBumpColorize`'s VS_INPUT_MESH; skinned
  (`RSkin*`/`B4I4*`) + collision/shadow shader filter; `computeBoneObjectMatrices` chain
  `obj[i]=local[i]*obj[parent[i]]`, column-major→D3DXMATRIX no-transpose; per-sub-mesh placement).
  `Engine::RenderReferenceObject()` — SOLID state (ZENABLE/ZWRITE TRUE, CULL_CCW, L-032
  save/restore), injected after the ground + before particles; device lost/reset wired (3 phases);
  a `#ifndef NDEBUG` `ALO_LT7_TEST_OBJECT` bring-up hook (kept, like MT-15's). vcxproj updated.
  **VERIFIED via capture:** `AI_Bunker_Turret1.alo` renders upright on the ground with the barrels
  HORIZONTAL (bone-chain placement proven), solid + correctly-culled (not inside-out), lit, running
  `MeshBumpColorize.fx` 1:1; collision/shadow hulls filtered (3 visible sub-meshes). Debug x64
  clean; Release TUs compile clean (link deferred to CI — dev-box Release exe was locked by the
  user's running test instance). Winding (CCW) + up-axis confirmed correct on the first real model.
- **PR-C done (this branch):** `src/GameObjectCatalog.{h,cpp}` (pure `IFileManager`, parallels
  `SkydomeEnvironment`): reads `Data\XML\GameObjectFiles.xml` → two-phase parse (all listed object
  files' direct-child objects → `Variant_Of_Existing_Type` resolution after all load; cross-file +
  cyclic/self-cyclic-safe; a variant's own model overrides its parent). Model-field chain
  `Land → Space → Galactic → Model_Name` (added `Galactic_Model_Name`, missing from the original §3).
  `GameObjectCategory` from the container tag, with a **name escalation** for turrets (vanilla
  declares them `<GroundStructure Name="..._Turret">` so tag-only gave Turret=0). **Lazy**
  `ProbeModelSkinned` → `Renderable`/`SkinnedUnsupported`/`LoadFailed`, accept condition mirroring
  `ReferenceObjectMesh`'s draw filter — and to keep the two in lockstep the skinned/non-visible
  predicates were **hoisted onto the `AloModel` pure-data leaf** (`AloIsSkinnedVertexFormat` /
  `AloIsNonVisibleShader`), with `ReferenceObjectMesh` refactored to call them (no behaviour change).
  vcxproj updated. **VERIFIED:** host Debug x64 clean; new leaf test `tests/test_game_object_catalog.cpp`
  **ALL PASS** (17 mock objects: enumeration, model-field fallback+precedence, same-file/cross-file/
  deep-chain/cyclic/self-cyclic/missing-parent variant resolution, first-wins dedup, category map,
  sort, never-throws); `AloModel` leaf test still green. Real-install dump-mode (vanilla FoC XML)
  = **2642 objects**, variant resolution correct (`AT_AT_Walker_REB09 → EV_AT-AT.ALO` inherited),
  Turret bucket populated (45); `--probe` of a real turret `.alo` = **Renderable**, a real skinned
  trooper `.alo` = **SkinnedUnsupported**. No CHANGELOG yet (LT-7 batches its user-facing entry to
  PR-D's picker, per the A/B precedent).
- **NEXT: PR-D** (engine ref-object state + bridge + persistence + React `ReferenceObjectPicker` +
  numeric 6-`Spinner` transform) — depends on B + C, both now in place.
