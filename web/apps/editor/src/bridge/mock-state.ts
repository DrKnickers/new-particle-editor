// Zustand-backed in-memory mirror of `EngineStateDto` used by the
// MockBridge when the React app runs outside a WebView2 host (browser-
// mode design iteration). Defaults intentionally mirror
// `Engine::ResetParameters` / the engine constructor in
// `src/engine.cpp` so the mock state is indistinguishable from a
// freshly-launched native session.
//
// Colour encoding note: `groundSolidColor` and `background` are Win32
// COLORREFs (0x00BBGGRR). RGB(r,g,b) = `r | (g<<8) | (b<<16)`.
//   RGB(128,128,128) = 0x00808080  → flat-grey ground solid colour
//   RGB(0x14,0x08,0x34) = 0x00340814  → dark-purple background

import { create } from "zustand";
import type { EngineStateDto, LightDto, SpawnerParamsDto } from "@particle-editor/bridge-schema";

/** Defaults mirror `SpawnerConfig()` at [src/SpawnerDriver.h:18]:
 *  Auto mode + disabled + burst 1 + 0 s spacing + 10 s interval + origin
 *  + 5 s lifetime + zero jitter. */
export function makeDefaultSpawnerParams(): SpawnerParamsDto {
  return {
    mode: "auto",
    enabled: false,
    burstSize: 1,
    spacingSec: 0,
    intervalSec: 10,
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    maxLifetimeSec: 5,
    jitterPosition: [0, 0, 0],
    jitterVelocity: [0, 0, 0],
  };
}

export const GROUND_SLOT_COUNT = 8;       // matches Engine::kGroundTextureCount
export const SKYDOME_SLOT_COUNT = 12;     // matches Engine::kSkydomeSlotCount
export const SKYDOME_FIRST_CUSTOM = 9;    // matches Engine::kSkydomeFirstCustomSlot
export const SKYDOME_CUSTOM_COUNT =
  SKYDOME_SLOT_COUNT - SKYDOME_FIRST_CUSTOM;  // 3

const zeroLight: LightDto = {
  diffuse:   [0, 0, 0, 0],
  specular:  [0, 0, 0, 0],
  position:  [0, 0, 0, 0],
  direction: [0, 0, 0, 0],
};

/** Build a fresh defaults object every time so the test reset hook can
 *  splat it into the store without sharing references. */
export function makeDefaultEngineState(): EngineStateDto {
  return {
    // Editor-level state (Screen 8 Batch 3): a freshly-launched mock
    // session is untitled (no path) and clean (no edits since load).
    currentFilePath: null,
    dirty: false,

    ground: true,
    groundZ: 0,
    groundTexture: 0,
    groundSolidColor: 0x00808080,
    groundSlotCustomPaths: Array.from({ length: GROUND_SLOT_COUNT }, () => ""),

    skydomeSlot: 0,
    skydomeCustomPaths: Array.from({ length: SKYDOME_CUSTOM_COUNT }, () => ""),

    background: 0x00340814,

    lights: {
      sun:   { ...zeroLight },
      fill1: { ...zeroLight },
      fill2: { ...zeroLight },
    },
    ambient: [0, 0, 0, 0],
    shadow:  [0, 0, 0, 0],

    bloom: false,
    bloomAvailable: true,    // mock pretends the shader is loaded
    bloomStrength: 0.0,
    bloomCutoff:   0.9,
    bloomSize:     0.1,

    heatDebug: false,

    paused: false,

    camera: {
      position: [0, -250, 125],
      target:   [0, 0, 0],
      up:       [0, 0, 1],
    },

    wind:    [0, 0, 0],
    gravity: [0, 0, -1],

    spawner: makeDefaultSpawnerParams(),
  };
}

type EngineStore = EngineStateDto & {
  applyPatch: (p: Partial<EngineStateDto>) => void;
  reset: () => void;
};

export const useMockEngineState = create<EngineStore>((set) => ({
  ...makeDefaultEngineState(),
  applyPatch: (p) => set(p as Partial<EngineStore>),
  reset: () => set(makeDefaultEngineState() as Partial<EngineStore>),
}));

/** Returns the engine-state slice of the store with the action methods
 *  stripped — i.e. exactly what should be serialised over the bridge. */
export function snapshotEngineState(): EngineStateDto {
  const { applyPatch: _a, reset: _r, ...rest } = useMockEngineState.getState();
  return rest;
}

// ─── Recent files registry (Screen 8 Batch 3) ───────────────────────
//
// Lives outside the EngineStateDto because it's host state, not engine
// state — the native host backs this with the Windows registry under
// `HKEY_CURRENT_USER\Software\AloParticleEditor` (matches legacy's
// AddToHistory / GetHistory at [src/main.cpp:650-768]). The mock stores
// the same list in-memory; the contract is the order (most-recent
// first), the cap (9 entries — `NUM_HISTORY_ITEMS` in legacy main.cpp),
// and the dedupe rule (a re-saved path moves to the front, not a
// duplicate entry).

export const MAX_RECENT_FILES = 9;

type RecentFilesStore = {
  paths: string[];
  setPaths: (paths: string[]) => void;
  /** Push to front; dedupes (case-insensitive) and caps at 9. */
  push: (path: string) => string[];
  reset: () => void;
};

export const useMockRecentFiles = create<RecentFilesStore>((set, get) => ({
  paths: [],
  setPaths: (paths) => set({ paths }),
  push: (path) => {
    const lower = path.toLowerCase();
    const filtered = get().paths.filter((p) => p.toLowerCase() !== lower);
    const next = [path, ...filtered].slice(0, MAX_RECENT_FILES);
    set({ paths: next });
    return next;
  },
  reset: () => set({ paths: [] }),
}));
