// StatusBar — 4-column readout for FPS · Emitters · Particles · Instances.
// Subscribes to the stats/tick event emitted by the C++ host at 4 Hz.
// In browser mode (MockBridge) the event never fires; the component renders
// placeholder em-dashes until the first tick arrives.
import { useEffect, useState } from "react";
import type { Bridge } from "@particle-editor/bridge-schema";

type Stats = { fps: number; emitters: number; particles: number; instances: number };

export function StatusBar({ bridge }: { bridge: Bridge }) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const off = bridge.on("stats/tick", (e) => {
      setStats(e.payload);
    });
    return off;
  }, [bridge]);

  const s = stats;
  const placeholder = s === null;

  const cell = (label: string, value: string) => (
    <span className="flex items-baseline gap-1.5">
      <span className="text-neutral-500">{label}</span>
      <span
        className={`font-mono tabular-nums ${
          placeholder ? "text-neutral-700" : "text-neutral-300"
        }`}
      >
        {value}
      </span>
    </span>
  );

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-neutral-800 bg-neutral-950 px-4 text-xs">
      {cell("FPS", placeholder ? "—" : s!.fps.toFixed(0))}
      <span className="text-neutral-700">·</span>
      {cell("Emitters", placeholder ? "—" : s!.emitters.toString())}
      <span className="text-neutral-700">·</span>
      {cell("Particles", placeholder ? "—" : s!.particles.toString())}
      <span className="text-neutral-700">·</span>
      {cell("Instances", placeholder ? "—" : s!.instances.toString())}
    </footer>
  );
}
