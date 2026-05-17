import { useEffect, useMemo, useState } from "react";
import { makeBridge } from "@/bridge";
import { exposeBridgeForTests } from "@/bridge/expose";
import { ViewportSlot } from "@/components/ViewportSlot";
import { BackgroundButton } from "@/screens/BackgroundButton";
import { BackgroundPicker } from "@/screens/BackgroundPicker";

export function App() {
  const bridge = useMemo(() => {
    const b = makeBridge();
    // Task 2.2: attach to window.bridge so Playwright (via CDP) and
    // anyone poking at DevTools can drive the bridge. Diagnostic-only —
    // no production code path reads window.bridge.
    exposeBridgeForTests(b);
    return b;
  }, []);

  const [panelOpen, setPanelOpen] = useState(false);

  // TODO Phase 3: remove this debug block once real per-screen shortcut
  // handlers are wired in. Until then it proves the round-trip works:
  //   1. React registers combos with the host on mount.
  //   2. Host fires AcceleratorKeyPressed → matches → emits accelerator/pressed.
  //   3. React logs the payload here; DevTools console shows "[accel] Ctrl+S".
  useEffect(() => {
    bridge
      .request({
        kind: "register-accelerators",
        params: { combos: ["Ctrl+S", "Ctrl+Z", "Ctrl+Shift+Z", "Delete", "F5"] },
      })
      .catch((err) => console.warn("[accel] register-accelerators failed:", err));

    const off = bridge.on("accelerator/pressed", (e) => {
      console.log("[accel]", e.payload.combo);
      // TODO Phase 3: real per-screen handlers. For now, route undo/redo
      // through the bridge so the surface is reachable end-to-end. Until
      // captures are wired in, `applied` will always come back false.
      if (e.payload.combo === "Ctrl+Z") {
        void bridge.request({
          kind: "undo/perform",
          params: { direction: "undo" },
        });
      } else if (e.payload.combo === "Ctrl+Shift+Z") {
        void bridge.request({
          kind: "undo/perform",
          params: { direction: "redo" },
        });
      }
    });
    return off;
  }, [bridge]);

  // Task 2.1 verification hook: log the initial engine snapshot at mount.
  // Confirms the bridge round-trip is producing a real EngineStateDto,
  // not the old `{ groundZ, background, skydomeSlot }` stub. Stays as a
  // permanent dev-mode breadcrumb — cheap, and useful any time the
  // bridge surface grows.
  useEffect(() => {
    bridge
      .request({ kind: "engine/state/snapshot", params: {} })
      .then((s) => console.log("[engine/state/snapshot]", s))
      .catch((err) => console.warn("[engine/state/snapshot] failed:", err));
  }, [bridge]);

  return (
    <div className="flex h-full w-full flex-col bg-neutral-950 text-neutral-100">
      {/* Top bar */}
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-neutral-800 px-4 text-sm">
        <span className="font-semibold">AloParticleEditor</span>
        <span className="text-neutral-500">— Phase 1 scaffold</span>
        <div className="ml-auto flex items-center gap-2">
          <BackgroundButton
            open={panelOpen}
            onToggle={() => setPanelOpen((v) => !v)}
            bridge={bridge}
          />
        </div>
      </header>

      {/* Main row */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 shrink-0 border-r border-neutral-800 p-3 text-sm">
          <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Emitters</div>
          <div className="text-neutral-600">(placeholder — Phase 3 Screen 4)</div>
        </aside>

        {/* Viewport */}
        <ViewportSlot bridge={bridge} />

        {/* Background picker slides over the right edge of the main row. */}
        {panelOpen && (
          <BackgroundPicker bridge={bridge} onClose={() => setPanelOpen(false)} />
        )}
      </div>

      {/* Status bar */}
      <footer className="flex h-7 shrink-0 items-center justify-between border-t border-neutral-800 px-4 text-xs text-neutral-500">
        <span>FPS: --</span>
        <span>placeholder status</span>
      </footer>
    </div>
  );
}
