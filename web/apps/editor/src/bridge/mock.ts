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
import {
  deleteEmitter,
  duplicateEmitter,
  duplicateWithIndexIncrement,
  findEmitterNode,
  makeDefaultEngineState,
  renameEmitter,
  useMockEmitterTree,
  useMockEngineState,
  useMockLinkGroupExempt,
  useMockRecentFiles,
  snapshotEngineState,
} from "./mock-state";

/** Returns true for request kinds that should mark the in-memory file
 *  state dirty. Every engine/set/* is mutating. Engine actions are
 *  mutating except for the read-only-ish reload-shaders / reload-textures
 *  / on-particle-system-changed / step-frames, which don't change
 *  user-visible parameters. file/*, query/*, undo/perform, spawner/*,
 *  layout, accelerators are not. The native host applies the same rule
 *  via per-handler `SetDirty(true)` calls. */
function isMutating(kind: Request["kind"]): boolean {
  // LT-4: engine/set/paused (view-only preview clock toggle) and
  // engine/set/heat-debug (view-only debug overlay) are excluded —
  // both leave the document state untouched and shouldn't trigger
  // save-prompt gates. Native host applies the same rule in
  // BridgeDispatcher.cpp.
  if (kind === "engine/set/paused") return false;
  if (kind === "engine/set/heat-debug") return false;
  if (kind.startsWith("engine/set/")) return true;
  // engine/action/clear is destructive — destroying particles in the
  // world is a user-visible mutation worth a save-prompt gate.
  if (kind === "engine/action/clear") return true;
  // engine/action/rescale-system mutates emitter parameters.
  if (kind === "engine/action/rescale-system") return true;
  // Screen 4 Batch B1: per-emitter rescale + structural mutations are
  // all mutating. Link-group exempt-set edits change propagation
  // behaviour but not engine-observable particle output; flag them
  // anyway so the dirty-bit + save-prompt gate matches the native
  // host's `markDirty` rule.
  if (kind === "engine/action/rescale-emitter") return true;
  if (kind === "emitters/duplicate") return true;
  if (kind === "emitters/delete") return true;
  if (kind === "emitters/rename") return true;
  if (kind === "emitters/duplicate-with-index-increment") return true;
  if (kind === "linkGroups/set-exempt-fields") return true;
  if (kind === "linkGroups/reset-exempt-fields") return true;
  return false;
}

export class MockBridge implements Bridge {
  private listeners = new Map<EventKind, Set<(e: Event) => void>>();

  /** Screen 8 Batch 4: in-mock "active spawner instance count". Bumped
   *  by spawner/trigger (by burstSize), zeroed by spawner/stop. The
   *  native SpawnerDriver tracks real ParticleSystemInstance lifecycles;
   *  the mock counter is just a hook for UI badge testing. */
  private spawnerActiveCount = 0;

  async request<R extends Request>(req: R): Promise<ResponseFor<R>> {
    const result = this.handle(req);
    // After the handler completes, mark dirty for any engine mutation.
    // (file/* and engine/action/reload-* / clear are deliberately NOT
    // marked dirty — see isMutating below.)
    if (isMutating(req.kind)) {
      this.markDirty();
    }
    return result as ResponseFor<R>;
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

  /** Screen 8 Batch 3: every mutating setter/action sets dirty=true. The
   *  debounce (don't re-emit if already dirty) avoids spamming
   *  `dirty/changed` on every slider drag tick. The native host applies
   *  the same rule. */
  private markDirty(): void {
    if (snapshotEngineState().dirty) return;
    useMockEngineState.getState().applyPatch({ dirty: true });
    this.emit({ kind: "dirty/changed", payload: { dirty: true } });
    // Don't re-emit engine/state/changed here — the caller's
    // patchAndBroadcast already fired one (or will fire one) with the
    // updated dirty=true field. The dirty/changed event is the
    // dedicated narrow-payload channel for components watching only
    // the dirty bit (window title, save-prompt gates).
  }

  /** Clear dirty + emit. Used by file/new, file/open, file/save success. */
  private markClean(): void {
    const cur = snapshotEngineState();
    if (!cur.dirty) return;
    useMockEngineState.getState().applyPatch({ dirty: false });
    this.emit({ kind: "dirty/changed", payload: { dirty: false } });
  }

  /** Update currentFilePath, push to recents (dedup, cap 9), emit
   *  recent/changed + engine/state/changed. Used by file/open and
   *  file/save success paths. */
  private commitFilePath(path: string): void {
    useMockEngineState.getState().applyPatch({ currentFilePath: path });
    const recents = useMockRecentFiles.getState().push(path);
    this.emit({ kind: "recent/changed", payload: { paths: recents } });
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

      // ---------------- engine setters: view state (preview clock) ----------------
      case "engine/set/paused":
        this.patchAndBroadcast({ paused: req.params.paused });
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

      // Step one or more frames. In browser mode there's no engine clock
      // to advance; the response-only no-op keeps the schema reachable so
      // UI surfaces can wire the dispatch without a runtime error.
      case "engine/action/step-frames":
        return {};

      // Rescale the whole particle system by a duration / size percentage.
      // MockBridge has no ParticleSystem to mutate; the handler logs the
      // call (so Vitest can assert on it via a spy) and emits the standard
      // post-action state/changed cue. Returns {} per schema.
      case "engine/action/rescale-system":
        console.log(
          "[MockBridge] engine/action/rescale-system",
          req.params,
        );
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

      // ---------------- file ops (Phase 3 Screen 8 Batch 3) ----------
      //
      // The mock implementations are deliberately UI-free: there's no
      // real picker, no on-disk read/write. They simulate the host's
      // observable side-effects (currentFilePath, dirty, recentFiles)
      // so React handlers + Playwright specs can exercise the round
      // trip in browser mode. The schema-level contract (return shapes,
      // event ordering) matches the native host.
      //
      // Two historical callers also depend on this:
      //   - BackgroundPicker chains file/open → set skydome-custom-path
      //     → set skydome-slot. In browser mode (with no real picker)
      //     the call still resolves with ok:false so the chain aborts
      //     cleanly without surfacing a raw rejection. The signal that
      //     "this is a fake/cancelled pick" is the lack of `path`.

      case "file/new":
        // Reset engine state to defaults, clear currentFilePath, clear
        // dirty. Emit dirty/changed (always — markClean dedupes on
        // already-clean, but file/new from a clean state may still
        // need to fire if anything else listens to "I just made a new
        // file"). For consistency: only emit if there was a change.
        useMockEngineState.getState().applyPatch({
          ...makeDefaultEngineState(),
        });
        this.markClean();
        this.emit({ kind: "engine/state/changed", payload: snapshotEngineState() });
        return {};

      case "file/open": {
        // If the caller passed a path explicitly (e.g. Recent Files), use it.
        // Otherwise we simulate a cancelled native picker — the picker
        // doesn't exist in browser mode. The contract callers branch on
        // `ok` so this is the cleanest signal of "no path acquired".
        const explicit = req.params?.path;
        if (!explicit) {
          return { ok: false, error: "browser-mode" };
        }
        this.commitFilePath(explicit);
        this.markClean();
        return { ok: true, path: explicit };
      }

      case "file/save": {
        const explicit = req.params?.path;
        const cur = snapshotEngineState().currentFilePath;
        const target = explicit ?? cur ?? "/mock/untitled.alo";
        this.commitFilePath(target);
        this.markClean();
        return { ok: true, path: target };
      }

      case "file/save-as": {
        // Always "open the picker" — mock answers with a fixed path so
        // tests can assert deterministic behaviour. The native host
        // calls GetSaveFileNameW.
        const target = "/mock/saved-as.alo";
        this.commitFilePath(target);
        this.markClean();
        return { ok: true, path: target };
      }

      case "file/recent/list":
        return { paths: useMockRecentFiles.getState().paths };

      // ---------------- spawner (Phase 3 Screen 8 Batch 4) ----------------
      //
      // The native host treats spawner/start as a full-config replace
      // (mirrors `SpawnerDriver::SetConfig`). The mock matches: every
      // incoming params overwrites the cached spawner block in
      // EngineStateDto, then emits engine/state/changed so any panel
      // subscribed to snapshots picks up the new config.
      //
      // spawner/trigger + spawner/stop are no-ops aside from the
      // active-count event. The mock doesn't simulate physics: trigger
      // bumps the count by burstSize, stop zeroes it. Real instance
      // tracking lives in the native SpawnerDriver.

      case "spawner/start":
        this.patchAndBroadcast({ spawner: { ...req.params } });
        return {};

      case "spawner/trigger": {
        const params = snapshotEngineState().spawner;
        const next = this.spawnerActiveCount + params.burstSize;
        this.spawnerActiveCount = next;
        this.emit({
          kind: "spawner/active-count",
          payload: { count: next },
        });
        return {};
      }

      case "spawner/stop":
        this.spawnerActiveCount = 0;
        this.emit({
          kind: "spawner/active-count",
          payload: { count: 0 },
        });
        return {};

      // ---------------- emitters/preview-from-file (Phase 3 Screen 8 Batch 4)
      //
      // Returns a fixed 3-emitter mock tree regardless of path. Lets the
      // Import Emitters modal exercise the checkbox tree in browser
      // mode + Vitest. The native host forward-defers with a friendly
      // error (the legacy ImportEmitters_LoadFile path requires
      // FileManager + ParticleSystem which the new-UI host doesn't yet
      // own).
      case "emitters/preview-from-file":
        return {
          ok: true,
          tree: {
            id: 0,
            name: "root",
            children: [
              { id: 1, name: "Smoke",  children: [
                { id: 4, name: "Smoke embers", children: [] },
              ] },
              { id: 2, name: "Sparks", children: [] },
              { id: 3, name: "Flash",  children: [] },
            ],
          },
        };

      // ---------------- emitters/list + emitters/select (Screen 4 Batch A)
      //
      // The fixture tree lives in `mock-state.useMockEmitterTree`. The
      // list response returns a fresh copy so React-side consumers can't
      // mutate the store. `emitters/select` updates the snapshot's
      // selectedEmitterId scalar and emits both `emitters/selected` and
      // `engine/state/changed` so subscribers picking up either channel
      // see the change. Selection of an unknown id resets to null.
      case "emitters/list":
        return JSON.parse(JSON.stringify(useMockEmitterTree.getState().tree));

      case "emitters/select": {
        const reqId = req.params.id;
        const tree = useMockEmitterTree.getState().tree;
        const valid = reqId !== null && findEmitterNode(tree, reqId) !== null
          ? reqId
          : null;
        useMockEngineState.getState().applyPatch({ selectedEmitterId: valid });
        this.emit({ kind: "emitters/selected", payload: { id: valid } });
        this.emit({ kind: "engine/state/changed", payload: snapshotEngineState() });
        return {};
      }

      // ---------------- emitters/* mutations (Screen 4 Batch B1) -----
      //
      // The fixture tree is mutated in place via the helpers in
      // mock-state. Each handler emits `emitters/tree/changed` so the
      // React EmitterTree re-fetches via `emitters/list`. Selection
      // bookkeeping mirrors the native host: deleting the selected
      // emitter clears the selection scalar.
      case "emitters/duplicate": {
        const cur = useMockEmitterTree.getState().tree;
        const result = duplicateEmitter(cur, req.params.id);
        if (result === null) {
          return { ok: false, error: "emitter not found" };
        }
        useMockEmitterTree.getState().setTree(result.tree);
        this.emit({ kind: "emitters/tree/changed", payload: result.tree });
        this.emit({ kind: "engine/state/changed", payload: snapshotEngineState() });
        return { ok: true, newId: result.newId };
      }

      case "emitters/delete": {
        const cur = useMockEmitterTree.getState().tree;
        const next = deleteEmitter(cur, req.params.id);
        if (next === null) {
          // Nothing to delete — still emit so subscribers know we tried.
          this.emit({ kind: "emitters/tree/changed", payload: cur });
          return {};
        }
        useMockEmitterTree.getState().setTree(next);
        // If the deleted id was selected, clear the selection.
        const snap = snapshotEngineState();
        if (snap.selectedEmitterId === req.params.id) {
          useMockEngineState.getState().applyPatch({ selectedEmitterId: null });
          this.emit({ kind: "emitters/selected", payload: { id: null } });
        }
        this.emit({ kind: "emitters/tree/changed", payload: next });
        this.emit({ kind: "engine/state/changed", payload: snapshotEngineState() });
        return {};
      }

      case "emitters/rename": {
        const cur = useMockEmitterTree.getState().tree;
        const next = renameEmitter(cur, req.params.id, req.params.name);
        useMockEmitterTree.getState().setTree(next);
        this.emit({ kind: "emitters/tree/changed", payload: next });
        return {};
      }

      case "emitters/duplicate-with-index-increment": {
        const cur = useMockEmitterTree.getState().tree;
        const result = duplicateWithIndexIncrement(cur, req.params.id, req.params.delta);
        if (result === null) {
          // Shape says { newId: number } unconditionally. We surface
          // the failure by returning newId=-1; native handler errors
          // via the wire's ok:false path (the schema variant is the
          // single-arm `{ newId }`). Tests that assert success branch
          // pre-stage a valid id.
          this.emit({ kind: "emitters/tree/changed", payload: cur });
          return { newId: -1 };
        }
        useMockEmitterTree.getState().setTree(result.tree);
        this.emit({ kind: "emitters/tree/changed", payload: result.tree });
        this.emit({ kind: "engine/state/changed", payload: snapshotEngineState() });
        return { newId: result.newId };
      }

      // ---------------- engine/action/rescale-emitter (Screen 4 B1) --
      //
      // Per-emitter rescale. The mock has no engine state to mutate so
      // the handler is a logging stub; the dirty-bit ride-along via
      // isMutating still fires, matching the native host's contract.
      case "engine/action/rescale-emitter": {
        console.log(
          "[MockBridge] engine/action/rescale-emitter",
          req.params,
        );
        this.emit({ kind: "engine/state/changed", payload: snapshotEngineState() });
        // The rescale changes per-emitter scalars but not the tree's
        // structural shape; still emit tree/changed so future inspector
        // panels relying on it re-fetch.
        this.emit({
          kind: "emitters/tree/changed",
          payload: useMockEmitterTree.getState().tree,
        });
        return {};
      }

      // ---------------- linkGroups/* (Screen 4 Batch B1, MT-10) ------
      case "linkGroups/list-exempt-fields": {
        const fields = useMockLinkGroupExempt.getState().get(req.params.groupId);
        return { fields };
      }

      case "linkGroups/set-exempt-fields": {
        useMockLinkGroupExempt.getState().set(req.params.groupId, req.params.fields);
        this.emit({
          kind: "emitters/tree/changed",
          payload: useMockEmitterTree.getState().tree,
        });
        return {};
      }

      case "linkGroups/reset-exempt-fields": {
        useMockLinkGroupExempt.getState().reset(req.params.groupId);
        this.emit({
          kind: "emitters/tree/changed",
          payload: useMockEmitterTree.getState().tree,
        });
        return {};
      }

      // ---------------- emitters / undo: Phase 3+ ----------------
      case "emitters/update":
      case "emitters/import-from-file":
      case "undo/perform":
        throw new Error(`MockBridge: '${req.kind}' not implemented (Phase 3+)`);

      default: {
        // Exhaustiveness check — TS forces this to be `never`.
        const _exhaustive: never = req;
        throw new Error(`MockBridge: unknown request kind: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
}
