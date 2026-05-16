// MockBridge — a fully-in-process Bridge implementation backed by a
// Zustand store (`mock-state.ts`). Used when the React app runs outside
// the WebView2 host (browser-mode design iteration, Vitest contract
// tests).
//
// Coverage as of Task 2.1:
//   - engine/state/snapshot                  full DTO
//   - engine/set/*  (17 setters)             mutates the store, then
//                                            emits engine/state/changed
//   - engine/action/* (4 actions)            mutates where appropriate,
//                                            emits engine/state/changed
//   - engine/query/* (3 queries)             read-only
//   - register-accelerators                  accepted as a no-op
//   - layout/viewport-rect                   accepted as a no-op
// Everything else (emitters/*, file/*, undo/*, spawner/*) rejects with
// a "not implemented" error — those land in Phase 3+.

import type {
  Bridge,
  Request,
  ResponseFor,
  Event,
  EventKind,
  EventOf,
  EngineStateDto,
  LightDto,
} from "@particle-editor/bridge-schema";
import { useMockEngineState, snapshotEngineState } from "./mock-state";

export class MockBridge implements Bridge {
  private listeners = new Map<EventKind, Set<(e: Event) => void>>();

  async request<R extends Request>(req: R): Promise<ResponseFor<R>> {
    return this.handle(req) as ResponseFor<R>;
  }

  on<K extends EventKind>(kind: K, handler: (e: EventOf<K>) => void): () => void {
    let bucket = this.listeners.get(kind);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(kind, bucket);
    }
    bucket.add(handler as (e: Event) => void);
    return () => { bucket?.delete(handler as (e: Event) => void); };
  }

  // ---------------------------------------------------------------- internals

  private emit(e: Event): void {
    const bucket = this.listeners.get(e.kind);
    bucket?.forEach((h) => h(e));
  }

  /** Patch the store and broadcast engine/state/changed with the full snapshot. */
  private patchAndBroadcast(patch: Partial<EngineStateDto>): void {
    useMockEngineState.getState().applyPatch(patch);
    this.emit({ kind: "engine/state/changed", payload: snapshotEngineState() });
  }

  private handle(req: Request): unknown {
    switch (req.kind) {
      // ---------------- engine state ----------------
      case "engine/state/snapshot":
        return snapshotEngineState();

      // ---------------- engine setters: ground ----------------
      case "engine/set/ground":
        this.patchAndBroadcast({ ground: req.params.enabled });
        return {};

      case "engine/set/ground-z":
        this.patchAndBroadcast({ groundZ: req.params.z });
        return {};

      case "engine/set/ground-texture":
        this.patchAndBroadcast({ groundTexture: req.params.slot });
        return {};

      case "engine/set/ground-solid-color":
        this.patchAndBroadcast({ groundSolidColor: req.params.rgb });
        return {};

      case "engine/set/ground-slot-custom-path": {
        const { slot, path } = req.params;
        const paths = [...snapshotEngineState().groundSlotCustomPaths];
        if (slot >= 0 && slot < paths.length) paths[slot] = path;
        this.patchAndBroadcast({ groundSlotCustomPaths: paths });
        return {};
      }

      // ---------------- engine setters: skydome / background ----------------
      case "engine/set/skydome-slot":
        this.patchAndBroadcast({ skydomeSlot: req.params.slot });
        return {};

      case "engine/set/skydome-custom-path": {
        const { slot, path } = req.params;
        const customPaths = [...snapshotEngineState().skydomeCustomPaths];
        // slot is the absolute engine slot index (9..11); map to 0..2 in the
        // custom-only array.
        const idx = slot - 9;
        if (idx >= 0 && idx < customPaths.length) customPaths[idx] = path;
        this.patchAndBroadcast({ skydomeCustomPaths: customPaths });
        return {};
      }

      case "engine/set/background":
        this.patchAndBroadcast({ background: req.params.rgb });
        return {};

      // ---------------- engine setters: bloom ----------------
      case "engine/set/bloom":
        this.patchAndBroadcast({ bloom: req.params.enabled });
        return {};

      case "engine/set/bloom-strength":
        this.patchAndBroadcast({ bloomStrength: req.params.v });
        return {};

      case "engine/set/bloom-cutoff":
        this.patchAndBroadcast({ bloomCutoff: req.params.v });
        return {};

      case "engine/set/bloom-size":
        this.patchAndBroadcast({ bloomSize: req.params.v });
        return {};

      // ---------------- engine setters: debug / camera / lighting ----------------
      case "engine/set/heat-debug":
        this.patchAndBroadcast({ heatDebug: req.params.enabled });
        return {};

      case "engine/set/camera":
        this.patchAndBroadcast({ camera: { ...req.params } });
        return {};

      case "engine/set/light": {
        const { which, diffuse, specular, position, direction } = req.params;
        const next: LightDto = { diffuse, specular, position, direction };
        const lights = { ...snapshotEngineState().lights, [which]: next };
        this.patchAndBroadcast({ lights });
        return {};
      }

      case "engine/set/ambient":
        this.patchAndBroadcast({ ambient: req.params.color });
        return {};

      case "engine/set/shadow":
        this.patchAndBroadcast({ shadow: req.params.color });
        return {};

      // ---------------- engine actions ----------------
      case "engine/action/clear":
        // No engine-state mutation; emit anyway so any UI watching for the
        // post-action redraw cue still fires.
        this.emit({ kind: "engine/state/changed", payload: snapshotEngineState() });
        return {};

      case "engine/action/reload-shaders":
      case "engine/action/reload-textures":
      case "engine/action/on-particle-system-changed":
        this.emit({ kind: "engine/state/changed", payload: snapshotEngineState() });
        return {};

      // ---------------- engine queries ----------------
      case "engine/query/ground-slot-empty": {
        const { slot } = req.params;
        const state = snapshotEngineState();
        const paths = state.groundSlotCustomPaths;
        // Mirrors Engine::IsGroundSlotEmpty: slots 0..(kGroundTextureBundledCount-1)
        // have bundled defaults (except kGroundSolidColorSlot=4 which is the
        // procedural solid colour and is never empty either). Slots >=5 are
        // empty iff their custom path is empty.
        const hasBuiltin = slot >= 0 && slot < 5;  // 0..4 are bundled / procedural
        const hasCustom  = slot >= 0 && slot < paths.length && (paths[slot] ?? "") !== "";
        return !(hasBuiltin || hasCustom);
      }

      case "engine/query/skydome-slot-empty": {
        const { slot } = req.params;
        const state = snapshotEngineState();
        // Slots 0..8 are bundled (slot 0 = Off, never "empty" in the
        // picker sense — single-click commits it). Slots 9..11 are
        // empty iff their custom path is empty.
        if (slot >= 0 && slot < 9) return false;
        const idx = slot - 9;
        const paths = state.skydomeCustomPaths;
        if (idx < 0 || idx >= paths.length) return true;
        return (paths[idx] ?? "") === "";
      }

      case "engine/query/bloom-available":
        return snapshotEngineState().bloomAvailable;

      // ---------------- host plumbing: accepted no-ops ----------------
      case "register-accelerators":
        // Mock: nothing to register. Accelerator handling lives in the
        // native host; in browser mode the design iteration doesn't need
        // a real hotkey system, so swallow the call.
        return {};

      case "layout/viewport-rect":
        // Mock: no native HWND to reposition.
        return {};

      // ---------------- emitters / file / undo / spawner: Phase 3+ ----------------
      case "emitters/list":
      case "emitters/select":
      case "emitters/update":
      case "emitters/import-from-file":
      case "file/open":
      case "file/save":
      case "file/recent/list":
      case "undo/perform":
      case "spawner/start":
      case "spawner/stop":
        throw new Error(`MockBridge: '${req.kind}' not implemented (Phase 3+)`);

      default: {
        // Exhaustiveness check — TS forces this to be `never`.
        const _exhaustive: never = req;
        throw new Error(`MockBridge: unknown request kind: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
}
