// spawner-visibility.ts — Zustand store backing the Spawner-column
// visibility flag. Persists to localStorage('alo:spawner-visible').
// Default true (panel visible) on first launch.
//
// The toolbar's Spawner toggle, App.tsx's workspace grid, the
// SpawnerPanel's X-close button, and the Emitters menu's "Spawner…"
// entry all read + write through this single store so they stay in
// sync. Mirrors the pattern in lib/tool-panel.ts.

import { create } from "zustand";

const KEY = "alo:spawner-visible";

function readInitial(): boolean {
  const v = (typeof localStorage !== "undefined") ? localStorage.getItem(KEY) : null;
  if (v === "true") return true;
  if (v === "false") return false;
  return true; // default visible
}

type SpawnerVisibilityStore = {
  visible: boolean;
  toggle: () => void;
  setVisible: (v: boolean) => void;
};

const useStore = create<SpawnerVisibilityStore>((set, get) => ({
  visible: readInitial(),
  toggle: () => {
    const next = !get().visible;
    set({ visible: next });
    try { localStorage.setItem(KEY, String(next)); } catch { /* ignore */ }
  },
  setVisible: (v) => {
    set({ visible: v });
    try { localStorage.setItem(KEY, String(v)); } catch { /* ignore */ }
  },
}));

/** Read the current Spawner-column visibility. Subscribes the caller. */
export function useSpawnerVisible(): boolean {
  return useStore((s) => s.visible);
}

/** Get the stable toggle function without subscribing to the value.
 *  Use in handlers that toggle but don't need to read. */
export function useToggleSpawner(): () => void {
  return useStore((s) => s.toggle);
}

/** Imperative toggle for handlers outside React render. */
export function toggleSpawner(): void {
  useStore.getState().toggle();
}

/** Compat shim: existing callers that destructured `{ visible, toggle }`
 *  can continue to work without each switching to the split hooks.
 *  Prefer the split hooks for new code. */
export function useSpawnerVisibility(): { visible: boolean; toggle: () => void } {
  const visible = useStore((s) => s.visible);
  const toggle = useStore((s) => s.toggle);
  return { visible, toggle };
}

/** Test-only: reset the in-memory store back to the localStorage-derived
 *  default. The store's `visible` state is module-level and survives
 *  across tests; a Vitest `beforeEach` clearing localStorage is not
 *  enough on its own. Call this in tests that need a clean slate. */
export function __resetSpawnerVisibilityForTests(): void {
  useStore.setState({ visible: readInitial() });
}
