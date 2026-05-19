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
    return () => {
      offStats();
      offCursor();
    };
  }, [bridge]);

  const s = stats;
  const placeholder = s === null;

  const cell = (label: string, value: string, dim = placeholder) => (
    <span className="flex items-baseline gap-1.5">
      <span className="text-neutral-500">{label}</span>
      <span
        className={`font-mono tabular-nums ${
          dim ? "text-neutral-700" : "text-neutral-300"
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
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-neutral-800 bg-neutral-950 px-4 text-xs">
      {cell("FPS", placeholder ? "—" : s!.fps.toFixed(0))}
      <span className="text-neutral-700">·</span>
      {cell("Emitters", placeholder ? "—" : s!.emitters.toString())}
      <span className="text-neutral-700">·</span>
      {cell("Particles", placeholder ? "—" : s!.particles.toString())}
      <span className="text-neutral-700">·</span>
      {cell("Instances", placeholder ? "—" : s!.instances.toString())}
      <span className="text-neutral-700">·</span>
      {cell("Cursor", cursorText, cursor === null)}
    </footer>
  );
}
