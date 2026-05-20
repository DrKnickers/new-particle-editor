// Bridge schema — single source of truth for the JSON contract between
// the React UI and the C++ host. Imported by both web/apps/editor/'s
// MockBridge + NativeBridge, and (eventually) consumed by the C++
// dispatcher via a JSON-schema codegen step.

export type RequestId = string;  // UUID v4

// ============================================================================
// Primitive types
// ============================================================================

/** Three-component vector serialised as a JSON array `[x, y, z]`. */
export type Vec3 = readonly [number, number, number];

/** Four-component vector serialised as a JSON array `[x, y, z, w]`.
 *  When used for a colour, the channel order is `[r, g, b, a]`
 *  with each component in `[0, 1]` floating point. */
export type Vec4 = readonly [number, number, number, number];

/** COLORREF — a 32-bit integer with bytes laid out as `0x00BBGGRR`
 *  (Windows convention; low byte is the *blue* channel). Used for
 *  background and ground-solid-color where the engine reads/writes
 *  Win32 COLORREFs directly. Distinct from `Vec4`-as-colour which is
 *  the floating-point linear-space form used for engine lights and
 *  ambient/shadow tints. */
export type Color = number;

// ============================================================================
// Engine state DTO
// ============================================================================

export type CameraDto = {
  position: Vec3;
  target: Vec3;
  up: Vec3;
};

export type LightDto = {
  diffuse: Vec4;
  specular: Vec4;
  position: Vec4;
  direction: Vec4;
};

/** Identifier for the three engine lights. Mirrors `Engine::LightType`
 *  (`LT_SUN | LT_FILL1 | LT_FILL2`) via a string literal on the wire
 *  so JSON readers don't have to memorise an enum. */
export type LightWhich = "sun" | "fill1" | "fill2";

// ─── Spawner DTO (Phase 3 Screen 8 Batch 4) ──────────────────────────
//
// Mirrors `SpawnerConfig` at [src/SpawnerDriver.h:18]. Defaults match
// `SpawnerConfig()` (Auto mode, disabled, burst 1, no spacing, 10 s
// interval, origin, 5 s lifetime, no jitter). `enabled` is meaningful
// only in Auto mode (toggle the recurring schedule); Manual mode bursts
// only on explicit `spawner/trigger`.

export type SpawnerMode = "manual" | "auto";

export type SpawnerParamsDto = {
  mode: SpawnerMode;
  enabled: boolean;
  /** 1..MAX_BURST_SIZE (=10) instances per burst. */
  burstSize: number;
  /** 0..MAX_SPACING_SEC (=10) seconds between instances inside a burst. */
  spacingSec: number;
  /** Auto-mode only: 0..MAX_INTERVAL_SEC (=60) seconds between burst
   *  starts. Ignored in Manual mode but always carried through the DTO
   *  so the panel keeps its setting when the user toggles modes. */
  intervalSec: number;
  /** World-space spawn point. */
  position: Vec3;
  /** Initial velocity, units/sec. */
  velocity: Vec3;
  /** Hard cap on each spawned instance's lifetime, 0..MAX_LIFETIME_SEC
   *  (=600). 0 means "no cap — instance lives until particles die
   *  naturally". */
  maxLifetimeSec: number;
  /** Per-axis ± jitter on the spawn position, world units. */
  jitterPosition: Vec3;
  /** Per-axis ± jitter on the spawn velocity, units/sec. */
  jitterVelocity: Vec3;
};

// ─── Emitter tree DTO (Phase 3 Screen 8 Batch 4 + Screen 4 Batch A) ──
//
// Shape used by both `emitters/list` (live tree) and
// `emitters/preview-from-file` (import preview). Screen 4 Batch A
// extends with role + link-group + visibility so the sidebar tree can
// render glyphs and link-group dots without an additional round-trip.
//
// `role` identifies the slot the emitter occupies in its parent:
//   - "root"     : top-level (no parent). The synthetic id=-1 wrapper
//                  also uses this role.
//   - "lifetime" : parent->spawnDuringLife points at this emitter
//                  (continuous spawning during parent's lifetime).
//   - "death"    : parent->spawnOnDeath points at this emitter (spawned
//                  once when the parent particle dies).
//
// `linkGroup` mirrors `ParticleSystem::Emitter::linkGroup` (MT-5). 0
// means unlinked; non-zero IDs are stable within a single system.
//
// `visible` mirrors `ParticleSystem::Emitter::visible` — an editor-only
// per-emitter visibility toggle.

export type EmitterRole = "root" | "lifetime" | "death";

export type EmitterTreeNode = {
  id: number;
  name: string;
  role: EmitterRole;
  linkGroup: number;
  visible: boolean;
  children: EmitterTreeNode[];
};

export type EngineStateDto = {
  // ─── File / editor-level state ─────────────────────────────────────
  // Phase 3 Screen 8 Batch 3: dirty + current file path live at the top
  // of the DTO so they group with editor-level state (not engine
  // parameters). `currentFilePath` is null when the in-memory particle
  // system has never been saved (untitled). `dirty` is true if any
  // engine mutation has occurred since the last file/new/open/save
  // success — drives the window title's `*` indicator and the
  // SaveChangesPrompt on destructive ops (New / Open / Recent).
  currentFilePath: string | null;
  dirty: boolean;

  // Ground plane
  ground: boolean;                  // GetGround()
  groundZ: number;                  // GetGroundZ()
  groundTexture: number;            // GetGroundTexture() — slot index 0..kGroundTextureCount-1
  groundSolidColor: Color;          // GetGroundSolidColor() — slot kGroundSolidColorSlot colour
  groundSlotCustomPaths: string[];  // GetGroundSlotCustomPath() across all slots

  // Skydome
  skydomeSlot: number;              // GetSkydomeSlot() — 0=Off, 1-8=bundled, 9-11=custom
  skydomeCustomPaths: string[];     // GetSkydomeCustomPath() for slots 9..11

  // Background (solid colour when skydome slot 0)
  background: Color;                // GetBackground()

  // Lights / ambient / shadow
  lights: { sun: LightDto; fill1: LightDto; fill2: LightDto };
  ambient: Vec4;                    // GetAmbient()
  shadow: Vec4;                     // GetShadow()

  // Bloom
  bloom: boolean;                   // GetBloom()
  bloomAvailable: boolean;          // IsBloomAvailable()
  bloomStrength: number;            // GetBloomStrength()
  bloomCutoff: number;              // GetBloomCutoff()
  bloomSize: number;                // GetBloomSize()

  // Leave particles after instance death (Task 2.7). Defaults true —
  // matches ParticleSystem's constructor seed at [ParticleSystem.cpp:956].
  // Read via ParticleSystem::getLeaveParticles(); persisted with the
  // particle system (chunk-serialised at [ParticleSystem.cpp:948]).
  leaveParticles: boolean;

  // Debug
  heatDebug: boolean;               // GetHeatDebug()

  // View state (preview clock)
  paused: boolean;                  // IsPreviewPaused()

  // Camera
  camera: CameraDto;                // GetCamera()

  // Wind / gravity — exposed on Engine but not currently driven by any UI.
  // Included in the DTO so future panels can read them without a schema
  // bump; setters live on Engine but are intentionally not wired to a
  // bridge command yet.
  wind: Vec3;                       // GetWind()
  gravity: Vec3;                    // GetGravity()

  // Spawner (Phase 3 Screen 8 Batch 4). Defaults mirror SpawnerConfig()'s
  // initialiser at [src/SpawnerDriver.h:18] — Auto mode + disabled +
  // burst 1 + 0 s spacing + 10 s interval + origin + 5 s lifetime + no
  // jitter. The native host owns this config (m_spawnerConfig on
  // BridgeDispatcher) for snapshot parity; mutations route through
  // spawner/start.
  spawner: SpawnerParamsDto;

  // Currently-selected emitter id, or null when nothing is selected
  // (Screen 4 Batch A). The full tree itself is fetched via
  // `emitters/list` because trees can be large (hundreds of nodes for
  // complex systems) and shouldn't ride every snapshot; only the
  // (cheap) scalar selection rides here so React derives the selected
  // row styling from the snapshot without an extra round-trip.
  selectedEmitterId: number | null;

  // LT-4 D6 — currently-active mod's full path on disk, or null when
  // Unmodded. The full mod *list* is fetched separately via
  // `mods/list` because it changes rarely (refresh / disk scan)
  // compared to engine state. The path alone rides every snapshot so
  // the Mods menu's check-mark stays in sync with FileManager's
  // current mod basepath without a second round-trip after a select.
  activeModPath: string | null;
};

// ─── Mods (LT-4 D6) ──────────────────────────────────────────────────
//
// One discovered mod under <gameRoot>/Mods/. Shape matches the legacy
// C++ `ModEntry` struct (src/ModManager.h) minus `wstring → string`
// conversion at the bridge boundary.
//
// `nickname` is the user-set display name from the registry under
// HKCU\Software\AloParticleEditor\ModNicknames — empty string if no
// nickname is set; the React menu falls back to `folderName` in that
// case.
//
// `isFoC` discriminates Forces of Corruption (under corruption/Mods)
// from Base Game (under GameData/Mods). The React menu groups by this
// flag (FoC first, then Base Game) matching the legacy popup layout.
export type ModDescriptor = {
  path: string;
  folderName: string;
  nickname: string;
  isFoC: boolean;
};

// ─── Track DTO (Phase 3 Screen 6 Batch A) ────────────────────────────
//
// Per-emitter animation curves. The native `Emitter::tracks[7]` slot
// (one Track* per channel) maps to a fixed-order JSON array on the
// wire: Red, Green, Blue, Alpha, Scale, Index, RotationSpeed. The
// names are intrinsic to the array position — `TRACK_NAMES[i]` is
// authoritative for both sides of the bridge.
//
// `keys` are sorted ascending by time. Time is in 0..100 (matches
// legacy `CurveEditor_SetHorzRange(hEditor, 0.0f, 100.0f, true)` at
// [src/UI/TrackEditor.cpp:58]). Value range is per-track and computed
// React-side, not on the wire — the schema carries raw values.
//
// `interpolation` maps the native enum:
//   IT_LINEAR (0) → "linear"
//   IT_SMOOTH (1) → "smooth"
//   IT_STEP   (2) → "step"
// IT_UNKNOWN (-1) is never serialised — the host coerces it to
// "linear" before sending.
export type InterpolationType = "linear" | "smooth" | "step";

export type TrackKey = {
  time: number;
  value: number;
};

export type TrackName =
  | "red"
  | "green"
  | "blue"
  | "alpha"
  | "scale"
  | "index"
  | "rotationSpeed";

export type TrackDto = {
  name: TrackName;
  keys: TrackKey[];
  interpolation: InterpolationType;
};

/** Fixed-order names for the 7 tracks. Index matches the native
 *  `Emitter::tracks[i]` slot, which is also the order the
 *  `emitters/get-tracks` wire response uses. Single source of truth
 *  for both the host serialiser and React-side label/picker lookups. */
export const TRACK_NAMES: readonly TrackName[] = Object.freeze([
  "red",
  "green",
  "blue",
  "alpha",
  "scale",
  "index",
  "rotationSpeed",
]);

// ─── Emitter properties DTO (Phase 4.1 Fix dispatch 1) ──────────────
//
// Mirrors every editable field on `ParticleSystem::Emitter`
// ([src/ParticleSystem.h:71-204]). Grouped by the UI tab that surfaces
// the field (Basic / Appearance / Physics) so a reviewer can see at a
// glance what's wired where. Fix dispatch 1 wires the Basic group to
// `EmitterPropertyTabs`; Appearance + Physics ride this DTO so dispatches
// 2 and 3 add only UI, not schema.
//
// `groups: GroupDto[]` mirrors the C array `Group groups[NUM_GROUPS]`
// (NUM_GROUPS = 3). Per-Group fields match the `#pragma pack(1)` struct
// in `ParticleSystem::Emitter::Group`. The position-vec triples (`minX/
// minY/minZ`, etc.) collapse into `Vec3` on the wire so the JS side
// doesn't have to spell out each axis. The `type` field is the engine
// enum index (`GT_EXACT` / `GT_BOX` / `GT_CUBE` / `GT_SPHERE` /
// `GT_CYLINDER`); kept as a number rather than a string union because
// the UI surfaces it as a Radix Select with numeric values matching the
// engine enum.

export type GroupDto = {
  type: number;                  // ParticleSystem::GT_* (0..4)
  min: Vec3;                     // (minX, minY, minZ)
  max: Vec3;                     // (maxX, maxY, maxZ)
  sideLength: number;
  sphereRadius: number;
  sphereEdge: number;
  cylinderRadius: number;
  cylinderEdge: number;
  cylinderHeight: number;
  val: Vec3;                     // (valX, valY, valZ)
};

export type EmitterPropertiesDto = {
  // ── Basic ── ([ParticleSystem.h:140] name, :154 linkToSystem,
  // :162 randomRotation, :165 useBursts, :168 lifetime, :169 initialDelay,
  // :170 burstDelay, :175 randomLifetimePerc, :174 randomScalePerc,
  // :178 parentLinkStrength, :180-181 randomRotationAverage/Variance,
  // :184-185 freezeTime/skipTime, :188 nBursts, :189 index,
  // :192 nParticlesPerSecond, :194 nParticlesPerBurst).
  name: string;
  lifetime: number;
  initialDelay: number;
  useBursts: boolean;
  nBursts: number;
  burstDelay: number;
  nParticlesPerBurst: number;
  nParticlesPerSecond: number;
  randomLifetimePerc: number;
  randomScalePerc: number;
  randomRotation: boolean;
  randomRotationDirection: boolean;
  randomRotationAverage: number;
  randomRotationVariance: number;
  freezeTime: number;
  skipTime: number;
  linkToSystem: boolean;
  parentLinkStrength: number;
  index: number;

  // ── Appearance ── ([ParticleSystem.h:141-142 colorTexture/
  // normalTexture, :156 doColorAddGrayscale, :157 affectedByWind,
  // :158 isHeatParticle, :160 hasTail, :161 noDepthTest,
  // :164 isWorldOriented, :177 tailSize, :182 randomColors,
  // :190 blendMode, :191 textureSize, :193 nTriangles).
  colorTexture: string;
  normalTexture: string;
  blendMode: number;
  textureSize: number;
  nTriangles: number;
  doColorAddGrayscale: boolean;
  randomColors: Vec4;
  hasTail: boolean;
  tailSize: number;
  isHeatParticle: boolean;
  isWorldOriented: boolean;
  noDepthTest: boolean;
  affectedByWind: boolean;

  // ── Physics ── ([ParticleSystem.h:155 objectSpaceAcceleration,
  // :159 isWeatherParticle, :166 emitFromMesh, :167 gravity,
  // :171 inwardSpeed, :172 inwardAcceleration, :173 acceleration,
  // :176 weatherCubeSize, :179 weatherCubeDistance, :183 bounciness,
  // :186 emitFromMeshOffset, :187 weatherFadeoutDistance,
  // :195 groundBehavior). `groups` is :145.
  acceleration: Vec3;
  gravity: number;
  inwardSpeed: number;
  inwardAcceleration: number;
  objectSpaceAcceleration: boolean;
  bounciness: number;
  groundBehavior: number;
  emitFromMesh: number;
  emitFromMeshOffset: number;
  isWeatherParticle: boolean;
  weatherCubeSize: number;
  weatherCubeDistance: number;
  weatherFadeoutDistance: number;

  groups: GroupDto[];
};

// ============================================================================
// Other DTOs (expanded in later tasks)
// ============================================================================

export type EmitterPatchDto = Record<string, unknown>;  // expanded later

// `EmitterTreeDto` is the wire shape returned by `emitters/list`. Until
// Screen 4 fleshes out the per-emitter field set, it's a thin wrapper
// over the minimal `EmitterTreeNode` (one root node + descendants).
export type EmitterTreeDto = { root: EmitterTreeNode };

// ============================================================================
// Requests: JS → host
// ============================================================================

export type Request =
  // File / recents
  | { kind: "file/new";                   params: Record<string, never> }
  | { kind: "file/open";                  params: { path?: string; filter?: "alo" | "skydome" | "ground" } }   // path undef = native picker; filter selects lpstrFilter (default "alo")
  | { kind: "file/save";                  params: { path?: string } }   // path undef = native picker
  | { kind: "file/save-as";               params: Record<string, never> } // always opens native picker
  | { kind: "file/recent/list";           params: Record<string, never> }

  // Engine state — full snapshot
  | { kind: "engine/state/snapshot";      params: Record<string, never> }

  // Engine setters — ground
  | { kind: "engine/set/ground";              params: { enabled: boolean } }
  | { kind: "engine/set/ground-z";            params: { z: number } }
  | { kind: "engine/set/ground-texture";      params: { slot: number } }
  | { kind: "engine/set/ground-solid-color";  params: { rgb: Color } }
  | { kind: "engine/set/ground-slot-custom-path"; params: { slot: number; path: string } }

  // Engine setters — skydome / background
  | { kind: "engine/set/skydome-slot";        params: { slot: number } }
  | { kind: "engine/set/skydome-custom-path"; params: { slot: number; path: string } }
  | { kind: "engine/set/background";          params: { rgb: Color } }

  // Engine setters — bloom
  | { kind: "engine/set/bloom";               params: { enabled: boolean } }
  | { kind: "engine/set/bloom-strength";      params: { v: number } }
  | { kind: "engine/set/bloom-cutoff";        params: { v: number } }
  | { kind: "engine/set/bloom-size";          params: { v: number } }

  // Engine setters — leave particles after instance death (Task 2.7).
  // Mirrors ParticleSystem::setLeaveParticles / getLeaveParticles
  // ([src/ParticleSystem.h:343,347]). When true (default), particles
  // continue to live after their owning instance is killed (the
  // instance just stops spawning); when false the engine destroys
  // the instance + its remaining particles immediately. Honored by
  // Engine::KillParticleSystem at [src/engine.cpp:197].
  | { kind: "engine/set/leave-particles";     params: { enabled: boolean } }

  // Engine setters — debug / camera / lighting
  | { kind: "engine/set/heat-debug";          params: { enabled: boolean } }
  | { kind: "engine/set/camera";              params: CameraDto }
  | { kind: "engine/set/light";               params: { which: LightWhich } & LightDto }
  | { kind: "engine/set/ambient";             params: { color: Vec4 } }
  | { kind: "engine/set/shadow";              params: { color: Vec4 } }

  // Engine setters — view state (preview clock)
  | { kind: "engine/set/paused";              params: { paused: boolean } }

  // Engine actions
  | { kind: "engine/action/clear";            params: Record<string, never> }
  | { kind: "engine/action/reload-shaders";   params: Record<string, never> }
  | { kind: "engine/action/reload-textures";  params: Record<string, never> }
  | { kind: "engine/action/on-particle-system-changed"; params: { track: number } }
  | { kind: "engine/action/step-frames";      params: { frames: number } }
  | { kind: "engine/action/rescale-system";   params: { durationScalePercent: number; sizeScalePercent: number } }

  // Engine queries
  | { kind: "engine/query/ground-slot-empty";  params: { slot: number } }
  | { kind: "engine/query/skydome-slot-empty"; params: { slot: number } }
  | { kind: "engine/query/bloom-available";    params: Record<string, never> }

  // Emitters (Phase 3+)
  | { kind: "emitters/list";              params: Record<string, never> }
  | { kind: "emitters/select";            params: { id: number | null } }
  | { kind: "emitters/update";            params: { id: number; patch: EmitterPatchDto } }
  | { kind: "emitters/import-from-file";  params: { path: string; selected: number[] } }
  | { kind: "emitters/preview-from-file"; params: { path: string } }

  // Track read (Phase 3 Screen 6 Batch A). Read-only this batch; key
  // mutations land with Screen 5 / Screen 6 Batch B.
  | { kind: "emitters/get-tracks";        params: { id: number } }

  // Emitter property read/write (Phase 4.1 Fix dispatch 1). Single
  // round-trip read returns the full property DTO for `id`. Writes use
  // a JSON patch object — only the keys actually present in `patch` are
  // applied to the engine, so the React form can fire one field at a
  // time without sending the whole DTO each commit.
  | { kind: "emitters/get-properties";    params: { id: number } }
  | { kind: "emitters/set-properties";
      params: { id: number; patch: Partial<EmitterPropertiesDto> } }

  // Track mutations (Phase 3 Screen 5 / Screen 6 Batch B-α). Border
  // keys (first + last in time order) are silently skipped server-side
  // by `delete-track-keys` — they define the track's time range and
  // are not deletable per legacy semantics. The React UI filters them
  // out before calling for cleanliness; the host enforces.
  | { kind: "emitters/delete-track-keys";
      params: { id: number; track: TrackName; times: number[] } }
  | { kind: "emitters/set-track-interpolation";
      params: { id: number; track: TrackName; interpolation: InterpolationType } }

  // Track key mutations (Phase 3 Screen 6 Batch B-β).
  //
  // `set-track-key` moves an existing key. The host erases the key at
  // `oldTime` and inserts a new key at `(newTime, newValue)`. Border
  // keys (first + last by time) silently override `newTime = oldTime`
  // so only the value moves — matches the drag-time-fixed rule.
  //
  // `add-track-key` inserts a new key. If a key already exists at the
  // exact `time`, the host bumps `time` slightly so the multiset
  // doesn't accumulate dupes. Returns the *actual* inserted time so
  // the React side can auto-select the new key without a re-fetch.
  | { kind: "emitters/set-track-key";
      params: { id: number; track: TrackName; oldTime: number; newTime: number; newValue: number } }
  | { kind: "emitters/add-track-key";
      params: { id: number; track: TrackName; time: number; value: number } }

  // Emitter mutations (Phase 3 Screen 4 Batch B1)
  | { kind: "emitters/duplicate";                       params: { id: number } }
  | { kind: "emitters/delete";                          params: { id: number } }
  | { kind: "emitters/rename";                          params: { id: number; name: string } }
  | { kind: "emitters/duplicate-with-index-increment";  params: { id: number; delta: number } }

  // Emitter mutations (Phase 3 Screen 4 Batch B2)
  //
  // add-lifetime-child / add-death-child wrap
  // `ParticleSystem::addLifetimeEmitter` / `::addDeathEmitter`. The new
  // emitter inherits the parent's spawn slot (lifetime or death). When
  // the slot is already filled the host responds with `newId: -1`; the
  // React side disables the menu item before reaching that path so the
  // negative-id branch is defensive coverage.
  //
  // move reorders the emitter among its siblings. Practically a root-
  // only operation per legacy semantics (children of the same role can't
  // be swapped — there's at most one of each). The host refuses bad
  // moves silently; the React side disables the menu item at the edges.
  //
  // linkGroups/set-membership operates on a batch of ids:
  //   - `groupId === null` or `0`: leave / clear membership (set to 0).
  //   - `groupId > 0`: join the named group.
  //   - `groupId === -1`: sentinel for "create a new group" — host picks
  //     the smallest unused positive uint32_t.
  | { kind: "emitters/add-lifetime-child";  params: { parentId: number } }
  | { kind: "emitters/add-death-child";     params: { parentId: number } }
  // Phase 4.1 Fix dispatch 5: legacy "New Root Emitter" menu item.
  // Wraps `ParticleSystem::addRootEmitter()` (parameter-less; the
  // optional template overload isn't exposed across the wire). Always
  // succeeds at the engine level — returns `newId: -1` only when the
  // particle-system pointer is unavailable (shouldn't happen in
  // practice).
  | { kind: "emitters/add-root";            params: Record<string, never> }
  | { kind: "emitters/move";                params: { id: number; direction: "up" | "down" } }
  // FD10 (Group A polish): visibility ops for the EmitterTree panel
  // toolbar. `set-visible` flips a single emitter's `visible` flag
  // without touching its children (matches legacy
  // `EmitterList_ToggleEmitterVisibility`). `set-all-visible` walks
  // the whole tree (matches legacy `EmitterList_SetAllEmitterVisibility`).
  // Both emit `emitters/tree/changed` + `engine/state/changed`.
  | { kind: "emitters/set-visible";         params: { id: number; visible: boolean } }
  | { kind: "emitters/set-all-visible";     params: { visible: boolean } }
  | { kind: "linkGroups/set-membership";    params: { ids: number[]; groupId: number | null } }

  // Emitter drag/drop (Phase 3 Screen 4 Batch B3)
  //
  // Tagged-union to keep the two semantics cleanly separated. React side
  // computes `slot` and `rootIndex` before calling — the bridge never
  // carries "auto" or "any". Refusal paths (cycle, slot-full, source not
  // a root for reorder) return `{ ok: false; error: string }`.
  //
  // `rootIndex` follows `ParticleSystem::moveEmitterToRootIndex`'s gap
  // semantics: gap 0 = before first root, gap K = between roots K-1 and
  // K, gap N = after the last root. The engine refuses no-op gaps
  // (sourceRootIdx and sourceRootIdx+1) silently as `ok: false`.
  | { kind: "emitters/drop";
      params:
        | { mode: "reorder";  id: number; rootIndex: number }
        | { mode: "reparent"; id: number; targetId: number; slot: "lifetime" | "death" }
    }

  // Emitter clipboard (Phase 3 Screen 4 Batch C)
  //
  // Process-local clipboard. The host serialises selected emitters
  // (with their subtrees) into an in-memory byte buffer using the
  // existing `MemoryFile` + `Emitter::write(writer, copy=true)` +
  // `Emitter(ChunkReader&)` pattern (same as LT-3 import / Batch B1
  // duplicate). The buffer survives across copy → paste calls on the
  // same process — no cross-instance sharing (matches legacy).
  //
  //   - `emitters/copy { ids }`  serialises each named emitter (plus
  //     its subtree) and stashes the result. No tree mutation, no
  //     dirty flag.
  //   - `emitters/cut { ids }`   copy semantics, then deletes each
  //     emitter atomically (single undo capture + single tree-changed
  //     event). Descending-id delete order keeps prior indices valid
  //     during the loop.
  //   - `emitters/paste { afterId? }` deserialises the clipboard
  //     buffer as new root emitters. `afterId` (optional) names the
  //     root to insert after; omitted/null = append at the end of
  //     roots. Returns the new ids in insertion order.
  | { kind: "emitters/copy";   params: { ids: number[] } }
  | { kind: "emitters/cut";    params: { ids: number[] } }
  | { kind: "emitters/paste";  params: { afterId?: number } }

  // Per-emitter rescale (Phase 3 Screen 4 Batch B1 — Screen-8 sub-dialog)
  | { kind: "engine/action/rescale-emitter";  params: { id: number; durationScalePercent: number; sizeScalePercent: number } }

  // Link-group exempt-set CRUD (Phase 3 Screen 4 Batch B1 — MT-10 surface)
  | { kind: "linkGroups/list-exempt-fields";   params: { groupId: number } }
  | { kind: "linkGroups/set-exempt-fields";    params: { groupId: number; fields: string[] } }
  | { kind: "linkGroups/reset-exempt-fields";  params: { groupId: number } }

  // Undo / spawner / layout / accelerators
  | { kind: "undo/perform";               params: { direction: "undo" | "redo" } }
  | { kind: "layout/viewport-rect";       params: { x: number; y: number; w: number; h: number } }
  // Tell the host that a chrome region overlaps the viewport rect (a
  // menu, tool panel, dialog…). FD9b: the host's AlphaCompositor stamps
  // alpha into the popup's DIB in this rect, with a `feather` px
  // smoothstep falloff at the rect's unclipped edges (so the chrome's
  // drop shadow blends naturally into the viewport instead of producing
  // a hard cut). `rect: null` removes the occlusion for that id. Rect
  // is in MAIN-HWND-CLIENT coords, same convention as
  // layout/viewport-rect. `feather` defaults to 0 (hard cut) when
  // omitted — match it to the chrome's shadow extent.
  | { kind: "viewport/occlude";           params: { id: string; rect: { x: number; y: number; w: number; h: number } | null; feather?: number } }
  | { kind: "spawner/start";              params: SpawnerParamsDto }
  | { kind: "spawner/trigger";            params: Record<string, never> }
  | { kind: "spawner/stop";               params: Record<string, never> }
  // FD10 (Group D): host quit. Posts WM_CLOSE to the main HostWindow
  // which falls through DefWindowProc → DestroyWindow → the existing
  // WM_DESTROY cleanup chain. React's File → Exit menu item is the
  // sole caller and gates on the dirty-prompt before dispatching.
  | { kind: "app/quit";                   params: Record<string, never> }
  // FD10 (Group D): cascade reset for the View → Reset View Settings
  // menu. Pushes engine defaults for background, ground, bloom,
  // skydome, and lighting in one host-side action (one emit of
  // engine/state/changed at the end). Mirrors legacy main.cpp:1733+
  // which prompts Yes/No and then resets the same surface. The
  // confirmation dialog lives React-side via Radix AlertDialog;
  // the dispatcher's job is purely to apply the defaults.
  | { kind: "engine/action/reset-view-settings"; params: Record<string, never> }
  // LT-4 D6 — Mods menu surface. `mods/list` returns the discovered
  // list + active path; the React menu calls it once at mount and
  // again after `mods/refresh`. `mods/select` activates a mod (empty/
  // null path = Unmodded), emits engine/state/changed so the menu's
  // check mark updates, and persists to HKCU\Software\AloParticleEditor
  // \LastMod for the next launch. `mods/refresh` re-scans the on-disk
  // Mods\ directories — returns the same shape as `mods/list` so the
  // caller can replace its local cache atomically.
  | { kind: "mods/list";                  params: Record<string, never> }
  | { kind: "mods/select";                params: { path: string | null } }
  | { kind: "mods/refresh";               params: Record<string, never> }
  | { kind: "register-accelerators";      params: { combos: string[] } };

// One response shape per Request kind.
export type ResponseFor<R extends Request> =
  // File
  R extends { kind: "file/new" }                  ? Record<string, never> :
  R extends { kind: "file/open" }                 ? { ok: true; path?: string } | { ok: false; error: string } :
  R extends { kind: "file/save" }                 ? { ok: true; path?: string } | { ok: false; error: string } :
  R extends { kind: "file/save-as" }              ? { ok: true; path?: string } | { ok: false; error: string } :
  R extends { kind: "file/recent/list" }          ? { paths: string[] } :

  // Mods (LT-4 D6)
  R extends { kind: "mods/list" }                 ? { mods: ModDescriptor[]; activePath: string | null } :
  R extends { kind: "mods/select" }               ? { ok: true; activePath: string | null } | { ok: false; error: string } :
  R extends { kind: "mods/refresh" }              ? { mods: ModDescriptor[]; activePath: string | null } :

  // Engine snapshot
  R extends { kind: "engine/state/snapshot" }     ? EngineStateDto :

  // Engine setters — all return empty object
  R extends { kind: "engine/set/ground" }                  ? Record<string, never> :
  R extends { kind: "engine/set/ground-z" }                ? Record<string, never> :
  R extends { kind: "engine/set/ground-texture" }          ? Record<string, never> :
  R extends { kind: "engine/set/ground-solid-color" }      ? Record<string, never> :
  R extends { kind: "engine/set/ground-slot-custom-path" } ? Record<string, never> :
  R extends { kind: "engine/set/skydome-slot" }            ? Record<string, never> :
  R extends { kind: "engine/set/skydome-custom-path" }     ? Record<string, never> :
  R extends { kind: "engine/set/background" }              ? Record<string, never> :
  R extends { kind: "engine/set/bloom" }                   ? Record<string, never> :
  R extends { kind: "engine/set/bloom-strength" }          ? Record<string, never> :
  R extends { kind: "engine/set/bloom-cutoff" }            ? Record<string, never> :
  R extends { kind: "engine/set/bloom-size" }              ? Record<string, never> :
  R extends { kind: "engine/set/leave-particles" }         ? Record<string, never> :
  R extends { kind: "engine/set/heat-debug" }              ? Record<string, never> :
  R extends { kind: "engine/set/camera" }                  ? Record<string, never> :
  R extends { kind: "engine/set/light" }                   ? Record<string, never> :
  R extends { kind: "engine/set/ambient" }                 ? Record<string, never> :
  R extends { kind: "engine/set/shadow" }                  ? Record<string, never> :
  R extends { kind: "engine/set/paused" }                  ? Record<string, never> :

  // Engine actions — empty body
  R extends { kind: "engine/action/clear" }                       ? Record<string, never> :
  R extends { kind: "engine/action/reload-shaders" }              ? Record<string, never> :
  R extends { kind: "engine/action/reload-textures" }             ? Record<string, never> :
  R extends { kind: "engine/action/on-particle-system-changed" }  ? Record<string, never> :
  R extends { kind: "engine/action/step-frames" }                 ? Record<string, never> :
  R extends { kind: "engine/action/rescale-system" }              ? Record<string, never> :

  // Engine queries
  R extends { kind: "engine/query/ground-slot-empty" }   ? boolean :
  R extends { kind: "engine/query/skydome-slot-empty" }  ? boolean :
  R extends { kind: "engine/query/bloom-available" }     ? boolean :

  // Emitters
  R extends { kind: "emitters/list" }             ? EmitterTreeDto :
  R extends { kind: "emitters/select" }           ? Record<string, never> :
  R extends { kind: "emitters/update" }           ? Record<string, never> :
  R extends { kind: "emitters/import-from-file" } ? { imported: number } :
  R extends { kind: "emitters/preview-from-file" } ?
    | { ok: true; tree: EmitterTreeNode }
    | { ok: false; error: string } :

  // Track read (Phase 3 Screen 6 Batch A). Always returns 7 tracks in
  // TRACK_NAMES order; an unknown id yields 7 empty tracks rather than
  // an error so the panel can render a "no data yet" stub without
  // special-casing the failure.
  R extends { kind: "emitters/get-tracks" } ? { tracks: TrackDto[] } :

  // Emitter properties (Phase 4.1 Fix dispatch 1). Read returns the
  // full DTO; write returns an empty object after the patch is
  // applied. Unknown id: read returns default-shaped properties
  // (zeros + empty strings) so the form can render a disabled
  // placeholder instead of an error; write is a silent no-op.
  R extends { kind: "emitters/get-properties" } ? { properties: EmitterPropertiesDto } :
  R extends { kind: "emitters/set-properties" } ? Record<string, never> :

  // Track mutations (Phase 3 Screen 5 / Screen 6 Batch B-α)
  R extends { kind: "emitters/delete-track-keys" }       ? Record<string, never> :
  R extends { kind: "emitters/set-track-interpolation" } ? Record<string, never> :

  // Track key mutations (Phase 3 Screen 6 Batch B-β).
  // set-track-key returns empty; add-track-key returns the actual
  // inserted (time, value) which may differ from the requested time
  // when a same-time collision triggered a dedupe-bump.
  R extends { kind: "emitters/set-track-key" } ? Record<string, never> :
  R extends { kind: "emitters/add-track-key" } ? { time: number; value: number } :

  // Emitter mutations (Phase 3 Screen 4 Batch B1)
  R extends { kind: "emitters/duplicate" } ?
    | { ok: true; newId: number }
    | { ok: false; error: string } :
  R extends { kind: "emitters/delete" }                         ? Record<string, never> :
  R extends { kind: "emitters/rename" }                         ? Record<string, never> :
  R extends { kind: "emitters/duplicate-with-index-increment" } ? { newId: number } :

  // Emitter mutations (Phase 3 Screen 4 Batch B2)
  R extends { kind: "emitters/add-lifetime-child" } ? { newId: number } :
  R extends { kind: "emitters/add-death-child" }    ? { newId: number } :
  R extends { kind: "emitters/add-root" }           ? { newId: number } :
  R extends { kind: "emitters/move" }               ? Record<string, never> :
  R extends { kind: "emitters/set-visible" }        ? Record<string, never> :
  R extends { kind: "emitters/set-all-visible" }    ? Record<string, never> :
  R extends { kind: "linkGroups/set-membership" }   ? Record<string, never> :

  // Emitter drag/drop (Phase 3 Screen 4 Batch B3)
  R extends { kind: "emitters/drop" } ?
    | { ok: true }
    | { ok: false; error: string } :

  // Emitter clipboard (Phase 3 Screen 4 Batch C)
  R extends { kind: "emitters/copy" }  ? Record<string, never> :
  R extends { kind: "emitters/cut" }   ? Record<string, never> :
  R extends { kind: "emitters/paste" } ? { newIds: number[] } :

  // Per-emitter rescale (Phase 3 Screen 4 Batch B1)
  R extends { kind: "engine/action/rescale-emitter" } ? Record<string, never> :

  // Link-group exempt-set CRUD (Phase 3 Screen 4 Batch B1)
  R extends { kind: "linkGroups/list-exempt-fields" }  ? { fields: string[] } :
  R extends { kind: "linkGroups/set-exempt-fields" }   ? Record<string, never> :
  R extends { kind: "linkGroups/reset-exempt-fields" } ? Record<string, never> :

  // Undo / spawner / layout / accelerators
  R extends { kind: "undo/perform" }              ? { applied: boolean; label?: string } :
  R extends { kind: "layout/viewport-rect" }      ? Record<string, never> :
  R extends { kind: "viewport/occlude" }          ? Record<string, never> :
  R extends { kind: "spawner/start" }             ? Record<string, never> :
  R extends { kind: "spawner/trigger" }           ? Record<string, never> :
  R extends { kind: "spawner/stop" }              ? Record<string, never> :
  R extends { kind: "app/quit" }                  ? Record<string, never> :
  R extends { kind: "engine/action/reset-view-settings" } ? Record<string, never> :
  R extends { kind: "register-accelerators" }     ? Record<string, never> :
  never;

// ============================================================================
// Event DTOs (host → JS push)
// ============================================================================

export type Event =
  | { kind: "engine/state/changed";   payload: EngineStateDto }
  | { kind: "emitters/tree/changed";  payload: EmitterTreeDto }
  | { kind: "emitters/selected";      payload: { id: number | null } }
  | { kind: "stats/tick";             payload: { fps: number; emitters: number; particles: number; instances: number } }
  | { kind: "dirty/changed";          payload: { dirty: boolean } }
  | { kind: "recent/changed";         payload: { paths: string[] } }
  | { kind: "undo/changed";           payload: { canUndo: boolean; canRedo: boolean; label?: string } }
  | { kind: "accelerator/pressed";    payload: { combo: string } }
  | { kind: "spawner/active-count";   payload: { count: number } }
  // FD10 (Group A): viewport mouse cursor's intersection with the
  // ground plane in world coords. Host throttles to ~30 Hz so the
  // status bar update doesn't saturate the bridge.
  | { kind: "cursor/position-3d";     payload: { x: number; y: number; z: number } };

export type EventKind = Event["kind"];
export type EventOf<K extends EventKind> = Extract<Event, { kind: K }>;

// ============================================================================
// Bridge interface
// ============================================================================

export interface Bridge {
  request<R extends Request>(req: R): Promise<ResponseFor<R>>;
  on<K extends EventKind>(kind: K, handler: (event: EventOf<K>) => void): () => void;
}

// ============================================================================
// Wire envelopes (for the JSON protocol)
// ============================================================================

export type WireRequest<R extends Request = Request> = {
  type: "req";
  id: RequestId;
  kind: R["kind"];
  params: R["params"];
};

export type WireResponse<R extends Request = Request> =
  | { type: "res"; id: RequestId; ok: true; data: ResponseFor<R> }
  | { type: "res"; id: RequestId; ok: false; error: string };

export type WireEvent<E extends Event = Event> = {
  type: "evt";
  kind: E["kind"];
  payload: E["payload"];
};

export type WireMessage = WireRequest | WireResponse | WireEvent;
