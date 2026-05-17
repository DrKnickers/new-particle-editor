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
  | { kind: "file/open";                  params: { path?: string } }   // path undef = native picker
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

  // Emitter mutations (Phase 3 Screen 4 Batch B1)
  | { kind: "emitters/duplicate";                       params: { id: number } }
  | { kind: "emitters/delete";                          params: { id: number } }
  | { kind: "emitters/rename";                          params: { id: number; name: string } }
  | { kind: "emitters/duplicate-with-index-increment";  params: { id: number; delta: number } }

  // Per-emitter rescale (Phase 3 Screen 4 Batch B1 — Screen-8 sub-dialog)
  | { kind: "engine/action/rescale-emitter";  params: { id: number; durationScalePercent: number; sizeScalePercent: number } }

  // Link-group exempt-set CRUD (Phase 3 Screen 4 Batch B1 — MT-10 surface)
  | { kind: "linkGroups/list-exempt-fields";   params: { groupId: number } }
  | { kind: "linkGroups/set-exempt-fields";    params: { groupId: number; fields: string[] } }
  | { kind: "linkGroups/reset-exempt-fields";  params: { groupId: number } }

  // Undo / spawner / layout / accelerators
  | { kind: "undo/perform";               params: { direction: "undo" | "redo" } }
  | { kind: "layout/viewport-rect";       params: { x: number; y: number; w: number; h: number } }
  | { kind: "spawner/start";              params: SpawnerParamsDto }
  | { kind: "spawner/trigger";            params: Record<string, never> }
  | { kind: "spawner/stop";               params: Record<string, never> }
  | { kind: "register-accelerators";      params: { combos: string[] } };

// One response shape per Request kind.
export type ResponseFor<R extends Request> =
  // File
  R extends { kind: "file/new" }                  ? Record<string, never> :
  R extends { kind: "file/open" }                 ? { ok: true; path?: string } | { ok: false; error: string } :
  R extends { kind: "file/save" }                 ? { ok: true; path?: string } | { ok: false; error: string } :
  R extends { kind: "file/save-as" }              ? { ok: true; path?: string } | { ok: false; error: string } :
  R extends { kind: "file/recent/list" }          ? { paths: string[] } :

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

  // Emitter mutations (Phase 3 Screen 4 Batch B1)
  R extends { kind: "emitters/duplicate" } ?
    | { ok: true; newId: number }
    | { ok: false; error: string } :
  R extends { kind: "emitters/delete" }                         ? Record<string, never> :
  R extends { kind: "emitters/rename" }                         ? Record<string, never> :
  R extends { kind: "emitters/duplicate-with-index-increment" } ? { newId: number } :

  // Per-emitter rescale (Phase 3 Screen 4 Batch B1)
  R extends { kind: "engine/action/rescale-emitter" } ? Record<string, never> :

  // Link-group exempt-set CRUD (Phase 3 Screen 4 Batch B1)
  R extends { kind: "linkGroups/list-exempt-fields" }  ? { fields: string[] } :
  R extends { kind: "linkGroups/set-exempt-fields" }   ? Record<string, never> :
  R extends { kind: "linkGroups/reset-exempt-fields" } ? Record<string, never> :

  // Undo / spawner / layout / accelerators
  R extends { kind: "undo/perform" }              ? { applied: boolean; label?: string } :
  R extends { kind: "layout/viewport-rect" }      ? Record<string, never> :
  R extends { kind: "spawner/start" }             ? Record<string, never> :
  R extends { kind: "spawner/trigger" }           ? Record<string, never> :
  R extends { kind: "spawner/stop" }              ? Record<string, never> :
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
  | { kind: "spawner/active-count";   payload: { count: number } };

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
