// StatusBar — 5-column readout: FPS · Emitters · Particles · Instances · Cursor.
// FPS / Emitters / Particles / Instances subscribe to the stats/tick event
// emitted by the C++ host at 4 Hz. The Cursor cell subscribes to
// `cursor/position-3d` (FD10, Group A polish), emitted at ~30 Hz while the
// mouse is over the viewport popup. In browser mode (MockBridge) neither
// event fires; the component renders placeholder em-dashes.
import { useEffect, useState } from "react";
import type { Bridge } from "@particle-editor/bridge-schema";

type Stats = { fps: number; emitters: number; particles: number; instances: number };
type Cursor3D = { x: number; y: number; z: number };

export function StatusBar({ bridge }: { bridge: Bridge }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [cursor, setCursor] = useState<Cursor3D | null>(null);

  useEffect(() => {
    const offStats = bridge.on("stats/tick", (e) => {
      setStats(e.payload);
    });
    const offCursor = bridge.on("cursor/position-3d", (e) => {
      setCursor(e.payload);
    });
    // [MT-11 T9] When the host signals stats are frozen (test-only
    // knob set via stats/set-frozen), drop the local state so all
    // cells fall back to `—` placeholders. The host stops emitting
    // stats/tick while frozen, so the cleared state stays cleared.
    // Cursor is cleared too since it's part of the StatusBar's
    // volatile per-frame surface.
    const offFreeze = bridge.on("stats/frozen-changed", (e) => {
      if (e.payload.frozen) {
        setStats(null);
        setCursor(null);
      }
    });
    return () => {
      offStats();
      offCursor();
      offFreeze();
    };
  }, [bridge]);

  const s = stats;
  const placeholder = s === null;

  const cell = (label: string, value: string, dim = placeholder) => (
    <span className="flex items-baseline gap-1.5">
      <span className="text-text-3">{label}</span>
      <span
        className={`font-mono tabular-nums ${
          dim ? "text-text-3" : "text-text-2"
        }`}
      >
        {value}
      </span>
    </span>
  );

  const cursorText = cursor === null
    ? "—"
    : `${cursor.x.toFixed(1)}, ${cursor.y.toFixed(1)}, ${cursor.z.toFixed(1)}`;

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-bg px-4 text-xs">
      {cell("FPS", placeholder ? "—" : s!.fps.toFixed(0))}
      <span className="text-text-3">·</span>
      {cell("Emitters", placeholder ? "—" : s!.emitters.toString())}
      <span className="text-text-3">·</span>
      {cell("Particles", placeholder ? "—" : s!.particles.toString())}
      <span className="text-text-3">·</span>
      {cell("Instances", placeholder ? "—" : s!.instances.toString())}
      <span className="text-text-3">·</span>
      {cell("Cursor", cursorText, cursor === null)}
    </footer>
  );
}
