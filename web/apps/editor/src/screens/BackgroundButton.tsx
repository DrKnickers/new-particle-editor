// BackgroundButton — compact pill in the top bar that opens the
// BackgroundPicker panel. The swatch always reflects the *current*
// engine background state:
//   - Slot 0 (solid colour) → engine `background` COLORREF
//   - Slots 1-8 (bundled) → static representative colour from
//                           BUNDLED_SLOTS' `swatch`
//   - Slots 9-11 (custom) → neutral grey placeholder (no thumbnail
//                           in browser-mode; native host will eventually
//                           supply real previews)
//
// Subscribes to `engine/state/changed` so the swatch updates instantly
// when the user mutates state from the picker or via DevTools.

import { useEffect, useState } from "react";
import type { Bridge, EngineStateDto } from "@particle-editor/bridge-schema";
import { colorrefToHex } from "@/lib/colorref";
import { BUNDLED_SLOTS } from "./BackgroundPicker";

const CUSTOM_PLACEHOLDER = "#525252";  // neutral-600

function deriveSwatch(state: EngineStateDto): string {
  const slot = state.skydomeSlot;
  if (slot === 0) return colorrefToHex(state.background);
  const bundled = BUNDLED_SLOTS.find((s) => s.slot === slot);
  if (bundled) return bundled.swatch;
  // Custom slot 9..11 — no per-skydome preview yet.
  return CUSTOM_PLACEHOLDER;
}

type Props = {
  open: boolean;
  onToggle: () => void;
  bridge: Bridge;
};

export function BackgroundButton({ open, onToggle, bridge }: Props) {
  const [swatch, setSwatch] = useState<string>("#000000");

  useEffect(() => {
    let cancelled = false;
    bridge
      .request({ kind: "engine/state/snapshot", params: {} })
      .then((s) => { if (!cancelled) setSwatch(deriveSwatch(s)); })
      .catch((err) => console.warn("[BackgroundButton] snapshot failed:", err));
    const off = bridge.on("engine/state/changed", (e) => {
      setSwatch(deriveSwatch(e.payload));
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [bridge]);

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={open}
      aria-label="Background"
      className={`flex items-center gap-2 rounded-md border px-2 py-1 text-xs transition ${
        open
          ? "border-accent bg-bg-2"
          : "border-border bg-bg hover:bg-bg-2"
      }`}
    >
      <span
        className="inline-block size-3 rounded-sm border border-border-2"
        style={{ backgroundColor: swatch }}
      />
      Background
    </button>
  );
}
