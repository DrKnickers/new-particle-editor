// SpawnerPanel — modeless tool window for the programmable particle
// spawner (Phase 3 Screen 8 Batch 4). Replaces the legacy
// `SpawnerDlgProc` at [src/main.cpp:5824] for the React UI; the Win32
// dialog stays for `--legacy-ui` until Phase 4.2.
//
// Sections (top-to-bottom):
//   1. Mode      — Manual / Auto radio.
//   2. Enabled   — checkbox (Auto-only; hidden in Manual).
//   3. Burst size, Spacing, Interval (Auto-only).
//   4. Position  — Vec3 spinner row.
//   5. Velocity  — Vec3 spinner row.
//   6. Lifetime  — single Spinner.
//   7. Jitter position / Jitter velocity — Vec3 rows.
//   8. Spawn now — manual-only button (fires spawner/trigger).
//
// State sync. The panel reads `snapshot.spawner` on mount and listens
// to `engine/state/changed` for external mutations (legacy `--legacy-ui`
// edits, devtools). Local edits commit immediately via
// `spawner/start { params: <full config> }` — matches the host's
// `SpawnerDriver::SetConfig` semantics (full-config replace, not patch).
//
// Header badge. Subscribes to `spawner/active-count` and renders the
// count as a small pill in the header. A small Stop glyph fires
// `spawner/stop` and is disabled when count == 0.

import { useEffect, useRef, useState } from "react";
import { Square } from "lucide-react";
import type {
  Bridge,
  SpawnerParamsDto,
  SpawnerMode,
  Vec3,
} from "@particle-editor/bridge-schema";
import { Spinner } from "@/primitives/Spinner";
import { ToolPanel } from "@/components/ToolPanel";
import { makeDefaultSpawnerParams } from "@/bridge/mock-state";

type Props = {
  bridge: Bridge;
  onClose: () => void;
};

/** Hard caps from `SpawnerDriver` — mirror the C++ constants at
 *  [src/SpawnerDriver.h:50-57] so the panel clamps where the host would
 *  clamp anyway. */
const MAX_BURST_SIZE = 10;
const MAX_SPACING_SEC = 10;
const MAX_INTERVAL_SEC = 60;
const MAX_LIFETIME_SEC = 600;

/** Build a new config from the current one with a single field replaced.
 *  Returns a fresh object so the host/mock sees a full SpawnerParamsDto
 *  on every `spawner/start`. */
function patchSpawner<K extends keyof SpawnerParamsDto>(
  base: SpawnerParamsDto,
  key: K,
  value: SpawnerParamsDto[K],
): SpawnerParamsDto {
  return { ...base, [key]: value };
}

function patchVec(base: Vec3, idx: 0 | 1 | 2, v: number): Vec3 {
  const out: [number, number, number] = [base[0], base[1], base[2]];
  out[idx] = v;
  return out as Vec3;
}

export function SpawnerPanel({ bridge, onClose }: Props) {
  // Cache the spawner config locally — fed by snapshot + state/changed.
  // Defaults to the same struct the engine ships with so the panel never
  // renders empty Spinners (which would clamp to NaN on first commit).
  const [config, setConfig] = useState<SpawnerParamsDto>(() =>
    makeDefaultSpawnerParams(),
  );
  const [activeCount, setActiveCount] = useState(0);

  // Track the "last config we committed" so we don't echo our own
  // changes back through the state/changed handler (avoids feedback
  // loops). A ref keeps the comparison cheap.
  const lastCommitted = useRef<SpawnerParamsDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    bridge
      .request({ kind: "engine/state/snapshot", params: {} })
      .then((s) => {
        if (!cancelled) setConfig(s.spawner);
      })
      .catch((err) => console.warn("[SpawnerPanel] snapshot failed:", err));

    const offState = bridge.on("engine/state/changed", (e) => {
      // Skip our own echoes — every commit triggers a state/changed,
      // and applying it back into the same store is wasteful.
      const inbound = e.payload.spawner;
      if (
        lastCommitted.current &&
        JSON.stringify(lastCommitted.current) === JSON.stringify(inbound)
      ) {
        return;
      }
      setConfig(inbound);
    });

    const offActive = bridge.on("spawner/active-count", (e) => {
      setActiveCount(e.payload.count);
    });

    return () => {
      cancelled = true;
      offState();
      offActive();
    };
  }, [bridge]);

  /** Commit a new config to the host. Stores it in `lastCommitted` so
   *  the round-trip state/changed handler skips the echo. */
  const commit = (next: SpawnerParamsDto) => {
    lastCommitted.current = next;
    setConfig(next);
    void bridge.request({ kind: "spawner/start", params: next });
  };

  const setMode = (mode: SpawnerMode) =>
    commit(patchSpawner(config, "mode", mode));
  const setEnabled = (enabled: boolean) =>
    commit(patchSpawner(config, "enabled", enabled));
  const setBurstSize = (v: number) =>
    commit(patchSpawner(config, "burstSize", Math.round(v)));
  const setSpacingSec = (v: number) =>
    commit(patchSpawner(config, "spacingSec", v));
  const setIntervalSec = (v: number) =>
    commit(patchSpawner(config, "intervalSec", v));
  const setPositionAxis = (idx: 0 | 1 | 2, v: number) =>
    commit(patchSpawner(config, "position", patchVec(config.position, idx, v)));
  const setVelocityAxis = (idx: 0 | 1 | 2, v: number) =>
    commit(patchSpawner(config, "velocity", patchVec(config.velocity, idx, v)));
  const setMaxLifetimeSec = (v: number) =>
    commit(patchSpawner(config, "maxLifetimeSec", v));
  const setJitterPosAxis = (idx: 0 | 1 | 2, v: number) =>
    commit(
      patchSpawner(
        config,
        "jitterPosition",
        patchVec(config.jitterPosition, idx, v),
      ),
    );
  const setJitterVelAxis = (idx: 0 | 1 | 2, v: number) =>
    commit(
      patchSpawner(
        config,
        "jitterVelocity",
        patchVec(config.jitterVelocity, idx, v),
      ),
    );

  const handleTrigger = () => {
    void bridge.request({ kind: "spawner/trigger", params: {} });
  };

  const handleStop = () => {
    void bridge.request({ kind: "spawner/stop", params: {} });
  };

  const isAuto = config.mode === "auto";

  return (
    <ToolPanel
      title="Spawner"
      onClose={onClose}
    >
      {/* Header chips — active-count badge + Stop button.
          Rendered as the first section so they sit just below the
          ToolPanel's title bar (the ToolPanel chrome doesn't expose a
          header-trailing slot, so a top section is the cleanest fit). */}
      <div className="mb-3 flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2">
        <span className="text-[11px] text-neutral-400">Active instances</span>
        <div className="flex items-center gap-2">
          <span
            aria-label="Active instance count"
            className="inline-flex h-5 min-w-[24px] items-center justify-center rounded bg-neutral-800 px-1.5 text-[11px] font-medium text-neutral-100"
          >
            {activeCount}
          </span>
          <button
            type="button"
            onClick={handleStop}
            disabled={activeCount === 0}
            aria-label="Stop spawner"
            className="flex size-5 items-center justify-center rounded text-neutral-400 outline-none hover:bg-neutral-800 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Square className="size-3" />
          </button>
        </div>
      </div>

      <ToolPanel.Section title="Mode" alwaysOpen>
        {/* Native radios under a role="radiogroup" wrapper — keyboard
            arrows + tab navigation come from the browser, and the
            Vitest jsdom harness can drive them with a plain click()
            without needing Radix's pointer-capture shim. */}
        <div role="radiogroup" aria-label="Spawner mode" className="flex gap-3">
          <label className="flex items-center gap-2 text-xs text-neutral-200">
            <input
              type="radio"
              name="spawner-mode"
              value="manual"
              checked={config.mode === "manual"}
              onChange={() => setMode("manual")}
              aria-label="Manual mode"
              className="size-3 accent-sky-500"
            />
            <span>Manual</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-neutral-200">
            <input
              type="radio"
              name="spawner-mode"
              value="auto"
              checked={config.mode === "auto"}
              onChange={() => setMode("auto")}
              aria-label="Auto mode"
              className="size-3 accent-sky-500"
            />
            <span>Auto</span>
          </label>
        </div>

        {isAuto && (
          <label className="mt-2 flex items-center gap-2 text-xs text-neutral-200">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              aria-label="Enable spawner"
              className="size-3 accent-sky-500"
            />
            <span>Enabled</span>
          </label>
        )}
      </ToolPanel.Section>

      <ToolPanel.Section title="Burst" alwaysOpen>
        <ToolPanel.Row label="Burst size">
          <Spinner
            value={config.burstSize}
            onChange={setBurstSize}
            min={1}
            max={MAX_BURST_SIZE}
            step={1}
            decimals={0}
            aria-label="Burst size"
          />
        </ToolPanel.Row>
        <ToolPanel.Row label="Spacing">
          <Spinner
            value={config.spacingSec}
            onChange={setSpacingSec}
            min={0}
            max={MAX_SPACING_SEC}
            step={0.05}
            unit="s"
            aria-label="Burst spacing"
          />
        </ToolPanel.Row>
        {isAuto && (
          <ToolPanel.Row label="Interval">
            <Spinner
              value={config.intervalSec}
              onChange={setIntervalSec}
              min={0}
              max={MAX_INTERVAL_SEC}
              step={0.5}
              unit="s"
              aria-label="Burst interval"
            />
          </ToolPanel.Row>
        )}
      </ToolPanel.Section>

      <ToolPanel.Section title="Position" defaultOpen>
        <div className="grid grid-cols-3 gap-1">
          <Spinner
            value={config.position[0]}
            onChange={(v) => setPositionAxis(0, v)}
            step={0.1}
            aria-label="Position X"
          />
          <Spinner
            value={config.position[1]}
            onChange={(v) => setPositionAxis(1, v)}
            step={0.1}
            aria-label="Position Y"
          />
          <Spinner
            value={config.position[2]}
            onChange={(v) => setPositionAxis(2, v)}
            step={0.1}
            aria-label="Position Z"
          />
        </div>
      </ToolPanel.Section>

      <ToolPanel.Section title="Velocity" defaultOpen>
        <div className="grid grid-cols-3 gap-1">
          <Spinner
            value={config.velocity[0]}
            onChange={(v) => setVelocityAxis(0, v)}
            step={0.1}
            aria-label="Velocity X"
          />
          <Spinner
            value={config.velocity[1]}
            onChange={(v) => setVelocityAxis(1, v)}
            step={0.1}
            aria-label="Velocity Y"
          />
          <Spinner
            value={config.velocity[2]}
            onChange={(v) => setVelocityAxis(2, v)}
            step={0.1}
            aria-label="Velocity Z"
          />
        </div>
      </ToolPanel.Section>

      <ToolPanel.Section title="Lifetime" alwaysOpen>
        <ToolPanel.Row label="Max lifetime">
          <Spinner
            value={config.maxLifetimeSec}
            onChange={setMaxLifetimeSec}
            min={0}
            max={MAX_LIFETIME_SEC}
            step={0.5}
            unit="s"
            aria-label="Max lifetime"
          />
        </ToolPanel.Row>
      </ToolPanel.Section>

      <ToolPanel.Section title="Jitter position">
        <div className="grid grid-cols-3 gap-1">
          <Spinner
            value={config.jitterPosition[0]}
            onChange={(v) => setJitterPosAxis(0, v)}
            step={0.05}
            aria-label="Jitter position X"
          />
          <Spinner
            value={config.jitterPosition[1]}
            onChange={(v) => setJitterPosAxis(1, v)}
            step={0.05}
            aria-label="Jitter position Y"
          />
          <Spinner
            value={config.jitterPosition[2]}
            onChange={(v) => setJitterPosAxis(2, v)}
            step={0.05}
            aria-label="Jitter position Z"
          />
        </div>
      </ToolPanel.Section>

      <ToolPanel.Section title="Jitter velocity">
        <div className="grid grid-cols-3 gap-1">
          <Spinner
            value={config.jitterVelocity[0]}
            onChange={(v) => setJitterVelAxis(0, v)}
            step={0.05}
            aria-label="Jitter velocity X"
          />
          <Spinner
            value={config.jitterVelocity[1]}
            onChange={(v) => setJitterVelAxis(1, v)}
            step={0.05}
            aria-label="Jitter velocity Y"
          />
          <Spinner
            value={config.jitterVelocity[2]}
            onChange={(v) => setJitterVelAxis(2, v)}
            step={0.05}
            aria-label="Jitter velocity Z"
          />
        </div>
      </ToolPanel.Section>

      {!isAuto && (
        <ToolPanel.Footer>
          <button
            type="button"
            onClick={handleTrigger}
            aria-label="Spawn now"
            className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500 outline-none focus:ring-2 focus:ring-sky-400"
          >
            Spawn now
          </button>
        </ToolPanel.Footer>
      )}
    </ToolPanel>
  );
}
