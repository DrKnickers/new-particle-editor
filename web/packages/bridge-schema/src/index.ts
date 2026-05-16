// Bridge schema — single source of truth for the JSON contract between
// the React UI and the C++ host. Imported by both web/apps/editor/'s
// MockBridge + NativeBridge, and (eventually) consumed by the C++
// dispatcher via a JSON-schema codegen step.

export type RequestId = string;  // UUID v4

// ============================================================================
// Request DTOs
// ============================================================================

export type EmitterPatchDto = Record<string, unknown>;  // expanded in Task 2.1
export type EmitterTreeDto = Record<string, unknown>;   // expanded in Task 2.1
export type SpawnerParamsDto = Record<string, unknown>; // expanded in Task 2.1
export type EngineStateDto = Record<string, unknown>;   // expanded in Task 2.1

// Requests: JS → host (host returns a response).
export type Request =
  | { kind: "file/open";                  params: { path?: string } }   // path undef = native picker
  | { kind: "file/save";                  params: { path?: string } }   // path undef = native picker
  | { kind: "file/recent/list";           params: Record<string, never> }
  | { kind: "engine/state/snapshot";      params: Record<string, never> }   // full read for first paint
  | { kind: "engine/set/ground-z";        params: { z: number } }
  | { kind: "engine/set/background";      params: { rgb: number } }
  | { kind: "engine/set/skydome";         params: { slot: number } }
  | { kind: "emitters/list";              params: Record<string, never> }
  | { kind: "emitters/select";            params: { id: number | null } }
  | { kind: "emitters/update";            params: { id: number; patch: EmitterPatchDto } }
  | { kind: "emitters/import-from-file";  params: { path: string; selected: number[] } }
  | { kind: "undo/perform";               params: { direction: "undo" | "redo" } }
  | { kind: "layout/viewport-rect";       params: { x: number; y: number; w: number; h: number } }
  | { kind: "spawner/start";              params: SpawnerParamsDto }
  | { kind: "spawner/stop";              params: Record<string, never> }
  | { kind: "register-accelerators";      params: { combos: string[] } };

// One response shape per Request kind. Each maps to a TS type via the
// helper below. Empty-body responses use `{}`.
export type ResponseFor<R extends Request> =
  R extends { kind: "file/open" }                 ? { ok: true; path?: string } | { ok: false; error: string } :
  R extends { kind: "file/save" }                 ? { ok: true; path?: string } | { ok: false; error: string } :
  R extends { kind: "file/recent/list" }          ? { paths: string[] } :
  R extends { kind: "engine/state/snapshot" }     ? EngineStateDto :
  R extends { kind: "engine/set/ground-z" }       ? Record<string, never> :
  R extends { kind: "engine/set/background" }     ? Record<string, never> :
  R extends { kind: "engine/set/skydome" }        ? Record<string, never> :
  R extends { kind: "emitters/list" }             ? EmitterTreeDto :
  R extends { kind: "emitters/select" }           ? Record<string, never> :
  R extends { kind: "emitters/update" }           ? Record<string, never> :
  R extends { kind: "emitters/import-from-file" } ? { imported: number } :
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
