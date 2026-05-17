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

export type EngineStateDto = {
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
};

// ============================================================================
// Other DTOs (expanded in later tasks)
// ============================================================================

export type EmitterPatchDto = Record<string, unknown>;  // expanded later
export type EmitterTreeDto = Record<string, unknown>;   // expanded later
export type SpawnerParamsDto = Record<string, unknown>; // expanded later

// ============================================================================
// Requests: JS → host
// ============================================================================

export type Request =
  // File / recents
  | { kind: "file/open";                  params: { path?: string } }   // path undef = native picker
  | { kind: "file/save";                  params: { path?: string } }   // path undef = native picker
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

  // Engine queries
  | { kind: "engine/query/ground-slot-empty";  params: { slot: number } }
  | { kind: "engine/query/skydome-slot-empty"; params: { slot: number } }
  | { kind: "engine/query/bloom-available";    params: Record<string, never> }

  // Emitters (Phase 3+)
  | { kind: "emitters/list";              params: Record<string, never> }
  | { kind: "emitters/select";            params: { id: number | null } }
  | { kind: "emitters/update";            params: { id: number; patch: EmitterPatchDto } }
  | { kind: "emitters/import-from-file";  params: { path: string; selected: number[] } }

  // Undo / spawner / layout / accelerators
  | { kind: "undo/perform";               params: { direction: "undo" | "redo" } }
  | { kind: "layout/viewport-rect";       params: { x: number; y: number; w: number; h: number } }
  | { kind: "spawner/start";              params: SpawnerParamsDto }
  | { kind: "spawner/stop";               params: Record<string, never> }
  | { kind: "register-accelerators";      params: { combos: string[] } };

// One response shape per Request kind.
export type ResponseFor<R extends Request> =
  // File
  R extends { kind: "file/open" }                 ? { ok: true; path?: string } | { ok: false; error: string } :
  R extends { kind: "file/save" }                 ? { ok: true; path?: string } | { ok: false; error: string } :
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

  // Engine queries
  R extends { kind: "engine/query/ground-slot-empty" }   ? boolean :
  R extends { kind: "engine/query/skydome-slot-empty" }  ? boolean :
  R extends { kind: "engine/query/bloom-available" }     ? boolean :

  // Emitters
  R extends { kind: "emitters/list" }             ? EmitterTreeDto :
  R extends { kind: "emitters/select" }           ? Record<string, never> :
  R extends { kind: "emitters/update" }           ? Record<string, never> :
  R extends { kind: "emitters/import-from-file" } ? { imported: number } :

  // Undo / spawner / layout / accelerators
  R extends { kind: "undo/perform" }              ? { applied: boolean; label?: string } :
  R extends { kind: "layout/viewport-rect" }      ? Record<string, never> :
  R extends { kind: "spawner/start" }             ? Record<string, never> :
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
