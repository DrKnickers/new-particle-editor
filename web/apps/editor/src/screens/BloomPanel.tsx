// BloomPanel — modeless tool window for bloom enable + strength /
// cutoff / size. Replaces the legacy `BloomDlgProc` at
// src/main.cpp:5987 for the React UI; the Win32 dialog stays for
// `--legacy-ui` until Phase 4.2.
//
// Sections:
//   1. Enable Bloom checkbox (mirrors `engine/set/bloom`; gives the
//      panel a master toggle independent of the menu).
//   2. Strength Spinner (0..5, step 0.05).
//   3. Cutoff   Spinner (0..1, step 0.01).
//   4. Size     Spinner (0..32, step 0.5).
//
// Bloom availability gate. Call `engine/query/bloom-available` on
// mount and again whenever the state snapshot changes (the engine
// re-evaluates on reload-shaders). When unavailable, render a
// disabled body with greyed Spinners and a small "(Bloom is not
// supported on this device)" placeholder.
//
// Bridge surface (existing — zero schema additions):
//   - engine/set/bloom            { enabled }
//   - engine/set/bloom-strength   { v }
//   - engine/set/bloom-cutoff     { v }
//   - engine/set/bloom-size       { v }
//   - engine/query/bloom-available () -> boolean

import { useEffect, useState } from "react";
import type { Bridge, EngineStateDto } from "@particle-editor/bridge-schema";
import { Spinner } from "@/primitives/Spinner";
import { ToolPanel } from "@/components/ToolPanel";

type Props = {
  bridge: Bridge;
  onClose: () => void;
};

export function BloomPanel({ bridge, onClose }: Props) {
  const [snapshot, setSnapshot] = useState<EngineStateDto | null>(null);
  const [available, setAvailable] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    bridge
      .request({ kind: "engine/state/snapshot", params: {} })
      .then((s) => {
        if (!cancelled) setSnapshot(s);
      })
      .catch((err) => console.warn("[BloomPanel] snapshot failed:", err));
    bridge
      .request({ kind: "engine/query/bloom-available", params: {} })
      .then((v) => {
        if (!cancelled) setAvailable(v);
      })
      .catch((err) => console.warn("[BloomPanel] bloom-available failed:", err));
    const off = bridge.on("engine/state/changed", (e) => {
      setSnapshot(e.payload);
      // Re-derive availability from the snapshot. The dedicated query
      // fires once on mount; subsequent changes ride along the state
      // event so we don't spam the bridge.
      setAvailable(e.payload.bloomAvailable);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [bridge]);

  const enabled = snapshot?.bloom ?? false;
  const strength = snapshot?.bloomStrength ?? 0;
  const cutoff = snapshot?.bloomCutoff ?? 0;
  const size = snapshot?.bloomSize ?? 0;

  const disabled = !available;

  const setEnabled = (v: boolean) => {
    void bridge.request({ kind: "engine/set/bloom", params: { enabled: v } });
  };
  const setStrength = (v: number) => {
    void bridge.request({ kind: "engine/set/bloom-strength", params: { v } });
  };
  const setCutoff = (v: number) => {
    void bridge.request({ kind: "engine/set/bloom-cutoff", params: { v } });
  };
  const setSize = (v: number) => {
    void bridge.request({ kind: "engine/set/bloom-size", params: { v } });
  };

  return (
    <ToolPanel title="Bloom Settings" onClose={onClose} bridge={bridge} occlusionId="tool-panel:bloom">
      <ToolPanel.Section title="Bloom" alwaysOpen>
        <label className="flex items-center gap-2 text-xs text-text">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={disabled}
            aria-label="Enable bloom"
            className="size-3 accent-sky-500"
          />
          <span>Enable bloom</span>
        </label>
        {disabled && (
          <p className="text-[10px] text-text-3">
            (Bloom is not supported on this device.)
          </p>
        )}
        <ToolPanel.Row label="Strength">
          <Spinner
            value={strength}
            onChange={setStrength}
            min={0}
            max={5}
            step={0.05}
            disabled={disabled}
            aria-label="Bloom strength"
          />
        </ToolPanel.Row>
        <ToolPanel.Row label="Cutoff">
          <Spinner
            value={cutoff}
            onChange={setCutoff}
            min={0}
            max={1}
            step={0.01}
            disabled={disabled}
            aria-label="Bloom cutoff"
          />
        </ToolPanel.Row>
        <ToolPanel.Row label="Size">
          <Spinner
            value={size}
            onChange={setSize}
            min={0}
            max={32}
            step={0.5}
            disabled={disabled}
            aria-label="Bloom size"
          />
        </ToolPanel.Row>
      </ToolPanel.Section>
    </ToolPanel>
  );
}
