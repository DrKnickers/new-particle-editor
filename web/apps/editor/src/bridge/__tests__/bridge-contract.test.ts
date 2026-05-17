// Contract tests for MockBridge. Each `engine/set/*` is exercised
// end-to-end: request → store mutation → engine/state/changed event →
// follow-up snapshot read. Keeps the schema (`EngineStateDto`) and the
// MockBridge implementation honest as the bridge surface grows.

import { describe, it, expect, beforeEach } from "vitest";
import { MockBridge } from "../mock";
import {
  useMockEngineState,
  useMockRecentFiles,
  makeDefaultEngineState,
} from "../mock-state";
import type { EngineStateDto, Event } from "@particle-editor/bridge-schema";

beforeEach(() => {
  // Reset the store between tests so state mutations don't leak.
  useMockEngineState.setState(makeDefaultEngineState());
  useMockRecentFiles.getState().reset();
});

describe("MockBridge contract", () => {
  it("engine/state/snapshot returns the full DTO shape", async () => {
    const b = new MockBridge();
    const s = await b.request({ kind: "engine/state/snapshot", params: {} });
    // Editor-level state (Screen 8 Batch 3).
    expect(s).toHaveProperty("currentFilePath");
    expect(s).toHaveProperty("dirty");
    expect(s.currentFilePath).toBeNull();
    expect(s.dirty).toBe(false);
    // Spot-check every top-level field.
    expect(s).toHaveProperty("ground");
    expect(s).toHaveProperty("groundZ");
    expect(s).toHaveProperty("groundTexture");
    expect(s).toHaveProperty("groundSolidColor");
    expect(s).toHaveProperty("groundSlotCustomPaths");
    expect(s).toHaveProperty("skydomeSlot");
    expect(s).toHaveProperty("skydomeCustomPaths");
    expect(s).toHaveProperty("background");
    expect(s).toHaveProperty("lights.sun.diffuse");
    expect(s.lights.sun.diffuse).toHaveLength(4);
    expect(s).toHaveProperty("ambient");
    expect(s).toHaveProperty("shadow");
    expect(s).toHaveProperty("bloom");
    expect(s).toHaveProperty("bloomAvailable");
    expect(s).toHaveProperty("bloomStrength");
    expect(s).toHaveProperty("bloomCutoff");
    expect(s).toHaveProperty("bloomSize");
    expect(s).toHaveProperty("heatDebug");
    expect(s).toHaveProperty("paused");
    expect(s).toHaveProperty("camera.position");
    expect(s.camera.position).toHaveLength(3);
    expect(s).toHaveProperty("wind");
    expect(s).toHaveProperty("gravity");
  });

  it("engine/set/ground-z patches state and fires state/changed", async () => {
    const b = new MockBridge();
    let last: EngineStateDto | null = null;
    const off = b.on("engine/state/changed", (e) => { last = e.payload; });

    await b.request({ kind: "engine/set/ground-z", params: { z: 12.5 } });

    expect(last).not.toBeNull();
    expect(last!.groundZ).toBe(12.5);
    const fresh = await b.request({ kind: "engine/state/snapshot", params: {} });
    expect(fresh.groundZ).toBe(12.5);
    off();
  });

  // One representative case per scalar setter — proves the kind→field
  // routing for the entire setter ladder. The list intentionally covers
  // every primitive shape (boolean / number / Color / Vec4 / nested
  // light record / Vec3 / Camera) so a regression in any single arm of
  // the dispatch surfaces here.
  it.each([
    ["engine/set/ground",             { enabled: false },            "ground",           false],
    ["engine/set/ground-z",           { z: 42 },                      "groundZ",          42],
    ["engine/set/ground-texture",     { slot: 3 },                    "groundTexture",    3],
    ["engine/set/ground-solid-color", { rgb: 0x00ff8800 },            "groundSolidColor", 0x00ff8800],
    ["engine/set/skydome-slot",       { slot: 5 },                    "skydomeSlot",      5],
    ["engine/set/background",         { rgb: 0x00112233 },            "background",       0x00112233],
    ["engine/set/bloom",              { enabled: true },              "bloom",            true],
    ["engine/set/bloom-strength",     { v: 2.5 },                     "bloomStrength",    2.5],
    ["engine/set/bloom-cutoff",       { v: 0.5 },                     "bloomCutoff",      0.5],
    ["engine/set/bloom-size",         { v: 0.25 },                    "bloomSize",        0.25],
    ["engine/set/heat-debug",         { enabled: true },              "heatDebug",        true],
    ["engine/set/paused",             { paused: true },               "paused",           true],
  ] as const)("%s mutates the snapshot", async (kind, params, field, expected) => {
    const b = new MockBridge();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await b.request({ kind, params } as any);
    const s = await b.request({ kind: "engine/state/snapshot", params: {} });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((s as any)[field]).toEqual(expected);
  });

  it("engine/set/ground-slot-custom-path writes one slot in-place", async () => {
    const b = new MockBridge();
    await b.request({
      kind: "engine/set/ground-slot-custom-path",
      params: { slot: 5, path: "C:/textures/foo.tga" },
    });
    const s = await b.request({ kind: "engine/state/snapshot", params: {} });
    expect(s.groundSlotCustomPaths[5]).toBe("C:/textures/foo.tga");
    expect(s.groundSlotCustomPaths[0]).toBe("");  // others untouched
  });

  it("engine/set/skydome-custom-path writes the 9..11 slot via custom-array index", async () => {
    const b = new MockBridge();
    await b.request({
      kind: "engine/set/skydome-custom-path",
      params: { slot: 10, path: "C:/sky/foo.dds" },
    });
    const s = await b.request({ kind: "engine/state/snapshot", params: {} });
    expect(s.skydomeCustomPaths[1]).toBe("C:/sky/foo.dds");  // 10 - 9 = 1
    expect(s.skydomeCustomPaths[0]).toBe("");
    expect(s.skydomeCustomPaths[2]).toBe("");
  });

  it("engine/set/camera replaces the camera record", async () => {
    const b = new MockBridge();
    await b.request({
      kind: "engine/set/camera",
      params: { position: [1, 2, 3], target: [4, 5, 6], up: [0, 0, 1] },
    });
    const s = await b.request({ kind: "engine/state/snapshot", params: {} });
    expect(s.camera.position).toEqual([1, 2, 3]);
    expect(s.camera.target).toEqual([4, 5, 6]);
    expect(s.camera.up).toEqual([0, 0, 1]);
  });

  it("engine/set/light updates only the named light slot", async () => {
    const b = new MockBridge();
    await b.request({
      kind: "engine/set/light",
      params: {
        which: "sun",
        diffuse:   [1, 0.5, 0.25, 1],
        specular:  [0, 0, 0, 0],
        position:  [10, 0, 0, 0],
        direction: [-1, 0, 0, 0],
      },
    });
    const s = await b.request({ kind: "engine/state/snapshot", params: {} });
    expect(s.lights.sun.diffuse).toEqual([1, 0.5, 0.25, 1]);
    expect(s.lights.fill1.diffuse).toEqual([0, 0, 0, 0]);  // untouched
  });

  it("engine/set/ambient and engine/set/shadow swap the Vec4 in-place", async () => {
    const b = new MockBridge();
    await b.request({ kind: "engine/set/ambient", params: { color: [0.1, 0.2, 0.3, 1.0] } });
    await b.request({ kind: "engine/set/shadow",  params: { color: [0.4, 0.4, 0.4, 1.0] } });
    const s = await b.request({ kind: "engine/state/snapshot", params: {} });
    expect(s.ambient).toEqual([0.1, 0.2, 0.3, 1.0]);
    expect(s.shadow).toEqual([0.4, 0.4, 0.4, 1.0]);
  });

  it("engine/query/ground-slot-empty respects bundled / custom rules", async () => {
    const b = new MockBridge();
    // Bundled slots (0..4) are never empty.
    for (const slot of [0, 1, 2, 3, 4]) {
      const empty = await b.request({ kind: "engine/query/ground-slot-empty", params: { slot } });
      expect(empty).toBe(false);
    }
    // Slot 5 starts empty (no custom path set).
    const before = await b.request({ kind: "engine/query/ground-slot-empty", params: { slot: 5 } });
    expect(before).toBe(true);
    // Once a path is assigned, the slot is no longer empty.
    await b.request({
      kind: "engine/set/ground-slot-custom-path",
      params: { slot: 5, path: "C:/x.tga" },
    });
    const after = await b.request({ kind: "engine/query/ground-slot-empty", params: { slot: 5 } });
    expect(after).toBe(false);
  });

  it("engine/query/skydome-slot-empty respects bundled / custom rules", async () => {
    const b = new MockBridge();
    // Bundled slots (0..8) are never empty.
    const bundled = await b.request({ kind: "engine/query/skydome-slot-empty", params: { slot: 3 } });
    expect(bundled).toBe(false);
    // Custom slot 9 starts empty.
    const before = await b.request({ kind: "engine/query/skydome-slot-empty", params: { slot: 9 } });
    expect(before).toBe(true);
    await b.request({
      kind: "engine/set/skydome-custom-path",
      params: { slot: 9, path: "C:/sky.dds" },
    });
    const after = await b.request({ kind: "engine/query/skydome-slot-empty", params: { slot: 9 } });
    expect(after).toBe(false);
  });

  it("engine/query/bloom-available returns the flag", async () => {
    const b = new MockBridge();
    const v = await b.request({ kind: "engine/query/bloom-available", params: {} });
    expect(v).toBe(true);
  });

  it("engine/action/step-frames resolves with an empty body in browser mode", async () => {
    const b = new MockBridge();
    // Pause first; the request is a response-only no-op either way, but
    // mirrors how the React Toolbar dispatches it (pause → step).
    await b.request({ kind: "engine/set/paused", params: { paused: true } });
    const r = await b.request({ kind: "engine/action/step-frames", params: { frames: 1 } });
    expect(r).toEqual({});
  });

  it("engine/action/rescale-system round-trips with empty body and fires state/changed", async () => {
    const b = new MockBridge();
    let count = 0;
    const off = b.on("engine/state/changed", () => { count++; });
    const r = await b.request({
      kind: "engine/action/rescale-system",
      params: { durationScalePercent: 150, sizeScalePercent: 200 },
    });
    expect(r).toEqual({});
    expect(count).toBe(1);
    off();
  });

  it("engine/action/clear fires state/changed without mutating fields", async () => {
    const b = new MockBridge();
    let count = 0;
    const off = b.on("engine/state/changed", () => { count++; });
    await b.request({ kind: "engine/action/clear", params: {} });
    expect(count).toBe(1);
    off();
  });

  it("rejects emitters/* requests as not implemented", async () => {
    const b = new MockBridge();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(b.request({ kind: "emitters/list", params: {} } as any))
      .rejects.toThrow(/not implemented/);
  });

  // Phase 3 Screen 8 Batch 3: file/save / file/recent/list are now
  // implemented in the mock (and the native host). The old "throws not
  // implemented" assertion has been replaced by round-trip specs below
  // covering file/new, file/save-as, recent/changed.

  it("file/new round-trips through MockBridge and returns {}", async () => {
    const b = new MockBridge();
    // Pre-dirty the state so file/new has something to clear.
    await b.request({ kind: "engine/set/ground-z", params: { z: 12 } });
    expect((await b.request({ kind: "engine/state/snapshot", params: {} })).dirty)
      .toBe(true);

    const r = await b.request({ kind: "file/new", params: {} });
    expect(r).toEqual({});
    const snap = await b.request({ kind: "engine/state/snapshot", params: {} });
    expect(snap.dirty).toBe(false);
    expect(snap.currentFilePath).toBeNull();
    expect(snap.groundZ).toBe(0);  // reset to default
  });

  it("file/save-as round-trips and returns { ok: true, path }", async () => {
    const b = new MockBridge();
    const r = await b.request({ kind: "file/save-as", params: {} });
    expect(r).toEqual({ ok: true, path: "/mock/saved-as.alo" });
    const snap = await b.request({ kind: "engine/state/snapshot", params: {} });
    expect(snap.currentFilePath).toBe("/mock/saved-as.alo");
    expect(snap.dirty).toBe(false);
  });

  it("recent/changed event fires when file/save adds a new path", async () => {
    const b = new MockBridge();
    let last: { paths: string[] } | null = null;
    const off = b.on("recent/changed", (e) => { last = e.payload; });

    await b.request({ kind: "file/save", params: { path: "C:/foo/bar.alo" } });

    expect(last).not.toBeNull();
    expect(last!.paths).toContain("C:/foo/bar.alo");

    // file/recent/list now mirrors the recent-files list.
    const list = await b.request({ kind: "file/recent/list", params: {} });
    expect(list.paths).toEqual(last!.paths);
    off();
  });

  it("engine setter sets dirty=true and emits dirty/changed once", async () => {
    const b = new MockBridge();
    let dirtyEvents = 0;
    let lastDirty: boolean | null = null;
    const off = b.on("dirty/changed", (e) => {
      dirtyEvents++;
      lastDirty = e.payload.dirty;
    });

    await b.request({ kind: "engine/set/ground-z", params: { z: 1 } });
    expect(lastDirty).toBe(true);
    expect(dirtyEvents).toBe(1);

    // Second mutation while already dirty should NOT re-emit (debounce).
    await b.request({ kind: "engine/set/ground-z", params: { z: 2 } });
    expect(dirtyEvents).toBe(1);

    off();
  });

  // Task 2.4: file/open is no longer a hard reject. The native handler
  // shows GetOpenFileNameW; the mock resolves with the schema's
  // cancellation shape so the React handler's request chain aborts
  // cleanly in browser mode without surfacing a raw rejection.
  it("resolves file/open with ok:false in browser mode", async () => {
    const b = new MockBridge();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await b.request({ kind: "file/open", params: {} } as any);
    expect(r).toEqual({ ok: false, error: "browser-mode" });
  });

  // ─── Phase 3 Screen 8 Batch 4: spawner + emitters/preview-from-file
  it("spawner/start round-trips through MockBridge; snapshot reflects new config", async () => {
    const b = new MockBridge();
    let lastSnap: { spawner?: { burstSize: number; mode: string } } | null = null;
    const off = b.on("engine/state/changed", (e) => {
      lastSnap = e.payload;
    });

    await b.request({
      kind: "spawner/start",
      params: {
        mode: "manual",
        enabled: false,
        burstSize: 7,
        spacingSec: 0.5,
        intervalSec: 3,
        position: [1, 2, 3],
        velocity: [0, 0, 0],
        maxLifetimeSec: 12,
        jitterPosition: [0, 0, 0],
        jitterVelocity: [0, 0, 0],
      },
    });

    expect(lastSnap).not.toBeNull();
    expect(lastSnap!.spawner!.burstSize).toBe(7);
    expect(lastSnap!.spawner!.mode).toBe("manual");

    const snap = await b.request({ kind: "engine/state/snapshot", params: {} });
    expect(snap.spawner.burstSize).toBe(7);
    expect(snap.spawner.mode).toBe("manual");
    off();
  });

  it("spawner/trigger returns {} and emits spawner/active-count", async () => {
    const b = new MockBridge();
    let count: number | null = null;
    const off = b.on("spawner/active-count", (e) => {
      count = e.payload.count;
    });

    const r = await b.request({ kind: "spawner/trigger", params: {} });
    expect(r).toEqual({});
    // Mock starts the count at 0 and bumps by burstSize (1 by default).
    expect(count).toBe(1);
    off();
  });

  // ─── LT-4 host-state plumbing: round-trips for the handlers whose
  // C++ side moved from forward-deferred no-ops to real implementations.
  // The MockBridge handlers are unchanged; these specs are belt-and-
  // braces coverage so a future MockBridge regression that breaks the
  // schema-level round-trip surfaces here rather than in Playwright.
  it("spawner/stop round-trips and resets the active-count to 0", async () => {
    const b = new MockBridge();
    // Pre-fire a trigger to bump the active count above 0.
    let lastCount: number | null = null;
    const off = b.on("spawner/active-count", (e) => { lastCount = e.payload.count; });
    await b.request({ kind: "spawner/trigger", params: {} });
    expect(lastCount).toBeGreaterThan(0);

    const r = await b.request({ kind: "spawner/stop", params: {} });
    expect(r).toEqual({});
    // MockBridge emits a spawner/active-count event with 0 on stop;
    // the native handler emits engine/state/changed with
    // spawner.enabled=false. Both shapes are valid stop signals; the
    // mock spec asserts the mock-specific behaviour.
    expect(lastCount).toBe(0);
    off();
  });

  it("engine/action/rescale-system round-trips and emits state/changed", async () => {
    const b = new MockBridge();
    let stateChanges = 0;
    const off = b.on("engine/state/changed", () => { stateChanges += 1; });

    const r = await b.request({
      kind: "engine/action/rescale-system",
      params: { durationScalePercent: 200, sizeScalePercent: 100 },
    });
    expect(r).toEqual({});
    // MockBridge fires engine/state/changed after the rescale (parity
    // with the C++ host); the test just observes that at least one
    // arrived during the dispatch window.
    expect(stateChanges).toBeGreaterThanOrEqual(1);
    off();
  });

  it("emitters/preview-from-file returns a mock tree for any path", async () => {
    const b = new MockBridge();
    const r = await b.request({
      kind: "emitters/preview-from-file",
      params: { path: "/anywhere/foo.alo" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tree).toBeDefined();
      expect(r.tree.children.length).toBeGreaterThanOrEqual(3);
      // Names from the mock tree.
      const names = r.tree.children.map((c) => c.name);
      expect(names).toEqual(expect.arrayContaining(["Smoke", "Sparks", "Flash"]));
    }
  });

  it("on() returns a working unsubscribe", async () => {
    const b = new MockBridge();
    const seen: Event[] = [];
    const off = b.on("engine/state/changed", (e) => { seen.push(e); });
    await b.request({ kind: "engine/set/ground-z", params: { z: 1 } });
    off();
    await b.request({ kind: "engine/set/ground-z", params: { z: 2 } });
    expect(seen).toHaveLength(1);
  });
});
