// GroundTexturePanel — modeless tool window for the ground plane:
// show/hide master toggle plus a grid of texture slots. Replaces the
// legacy `GroundTexturePickerProc` at src/main.cpp:3799 for the React
// UI; the Win32 dialog stays for `--legacy-ui` until Phase 4.2.
//
// Slot layout (mirrors Engine::kGroundTextureCount=8 / kGroundSolidColorSlot=4):
//   - Slot 0: Dirt   (bundled, default)
//   - Slot 1: Grass  (bundled)
//   - Slot 2: Sand   (bundled)
//   - Slot 3: Snow   (bundled)
//   - Slot 4: Solid colour — wide tile + ColorButton popover
//   - Slot 5: Custom 1 (browse → file picker, deferred per Batch 2 locks)
//   - Slot 6: Custom 2
//   - Slot 7: Custom 3
//
// Bridge surface (existing — zero schema additions):
//   - engine/set/ground             { enabled }
//   - engine/set/ground-texture     { slot }
//   - engine/set/ground-solid-color { rgb }
//
// Custom-slot behaviour. Click on an empty custom slot is a no-op in
// browser mode; the file picker requires native host wiring (matches
// BackgroundPicker's deferred custom-slot path until Task 2.4 lands a
// reusable `file/open` request handler in both bridges). Populated
// custom slots switch via `engine/set/ground-texture { slot }`.

import { useEffect, useState } from "react";
import type { Bridge, EngineStateDto } from "@particle-editor/bridge-schema";
import { ColorButton } from "@/primitives/ColorButton";
import { ToolPanel } from "@/components/ToolPanel";
import { colorrefToHex, hexToColorref } from "@/lib/colorref";
import type { RgbColor } from "@/primitives/palette-store";

type Props = {
  bridge: Bridge;
  onClose: () => void;
};

type BundledSlot = {
  readonly slot: number;
  readonly name: string;
  readonly gradient: string;
};

const SOLID_COLOR_SLOT = 4;

export const BUNDLED_GROUND_SLOTS: readonly BundledSlot[] = [
  { slot: 0, name: "Dirt",  gradient: "linear-gradient(180deg, #6b5b3a 0%, #8c7a54 100%)" },
  { slot: 1, name: "Grass", gradient: "linear-gradient(180deg, #3a7a3a 0%, #5ca35c 100%)" },
  { slot: 2, name: "Sand",  gradient: "linear-gradient(180deg, #c2a872 0%, #e1c89a 100%)" },
  { slot: 3, name: "Snow",  gradient: "linear-gradient(180deg, #e0e0e8 0%, #ffffff 100%)" },
] as const;

const CUSTOM_SLOTS: readonly number[] = [5, 6, 7];

function basename(path: string): string {
  if (!path) return "";
  const norm = path.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(i + 1) : norm;
}

function hexToRgbColor(hex: string): RgbColor {
  const m = hex.replace("#", "");
  return {
    r: parseInt(m.slice(0, 2), 16),
    g: parseInt(m.slice(2, 4), 16),
    b: parseInt(m.slice(4, 6), 16),
  };
}

function rgbColorToHex(rgb: RgbColor): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(rgb.r)}${h(rgb.g)}${h(rgb.b)}`;
}

export function GroundTexturePanel({ bridge, onClose }: Props) {
  const [snapshot, setSnapshot] = useState<EngineStateDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    bridge
      .request({ kind: "engine/state/snapshot", params: {} })
      .then((s) => {
        if (!cancelled) setSnapshot(s);
      })
      .catch((err) => console.warn("[GroundTexturePanel] snapshot failed:", err));
    const off = bridge.on("engine/state/changed", (e) => {
      setSnapshot(e.payload);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [bridge]);

  const groundOn = snapshot?.ground ?? false;
  const selectedSlot = snapshot?.groundTexture ?? 0;
  const solidHex = snapshot ? colorrefToHex(snapshot.groundSolidColor) : "#888888";
  const solidRgb = hexToRgbColor(solidHex);
  // Custom-slot paths live at the array's tail. The bridge DTO carries
  // all 8 slots indexed by slot number; we read 5..7 directly.
  const customPaths = snapshot?.groundSlotCustomPaths ?? [];

  const handleToggleGround = (v: boolean) => {
    void bridge.request({ kind: "engine/set/ground", params: { enabled: v } });
  };
  const handleSelectSlot = (slot: number) => {
    void bridge.request({ kind: "engine/set/ground-texture", params: { slot } });
  };
  const handleSolidColorChange = (rgb: RgbColor) => {
    void bridge.request({
      kind: "engine/set/ground-solid-color",
      params: { rgb: hexToColorref(rgbColorToHex(rgb)) },
    });
    // Selecting a colour switches to the solid-colour slot as well, so
    // the change is immediately visible without an extra click.
    if (selectedSlot !== SOLID_COLOR_SLOT) {
      void bridge.request({
        kind: "engine/set/ground-texture",
        params: { slot: SOLID_COLOR_SLOT },
      });
    }
  };
  const handleCustomClick = (slot: number, isEmpty: boolean) => {
    if (isEmpty) {
      // Deferred per Batch 2 locks (matches BackgroundPicker's deferred
      // custom-slot behaviour). The file picker is a native-host
      // capability; until it's wired here, an empty custom-slot click
      // is a no-op. TODO: lift this once Task 2.4's `file/open` reaches
      // both bridges with a uniform interface.
      return;
    }
    handleSelectSlot(slot);
  };

  return (
    <ToolPanel title="Ground Texture" onClose={onClose}>
      <label className="mb-3 flex items-center gap-2 text-xs text-neutral-200">
        <input
          type="checkbox"
          checked={groundOn}
          onChange={(e) => handleToggleGround(e.target.checked)}
          aria-label="Show ground"
          className="size-3 accent-sky-500"
        />
        <span>Show ground</span>
      </label>

      {/* Solid-colour slot — wide tile, full-width, with ColorButton
          inline on the right so the swatch is editable without a
          second click. */}
      <div className="mb-3">
        <button
          type="button"
          onClick={() => handleSelectSlot(SOLID_COLOR_SLOT)}
          className={`relative flex h-16 w-full items-center justify-between rounded-md border-2 px-3 transition ${
            selectedSlot === SOLID_COLOR_SLOT
              ? "border-sky-500"
              : "border-neutral-800 hover:border-neutral-700"
          }`}
          style={{ backgroundColor: solidHex }}
          aria-label="Solid colour"
          aria-pressed={selectedSlot === SOLID_COLOR_SLOT}
        >
          <span className="rounded bg-neutral-950/70 px-2 py-0.5 text-xs text-neutral-100 backdrop-blur-sm">
            Solid colour
          </span>
          {selectedSlot === SOLID_COLOR_SLOT && (
            <span className="flex size-5 items-center justify-center rounded-full bg-sky-500 text-xs text-white">
              ✓
            </span>
          )}
        </button>
        <div className="mt-2 flex items-center justify-end">
          <ColorButton
            value={solidRgb}
            onChange={handleSolidColorChange}
            aria-label="Ground solid colour"
          />
        </div>
      </div>

      {/* Bundled slots 0..3 — 2×2 grid. */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        {BUNDLED_GROUND_SLOTS.map(({ slot, name, gradient }) => {
          const selected = selectedSlot === slot;
          return (
            <button
              key={slot}
              type="button"
              onClick={() => handleSelectSlot(slot)}
              className={`relative aspect-square overflow-hidden rounded-md border-2 transition ${
                selected ? "border-sky-500" : "border-neutral-800 hover:border-neutral-700"
              }`}
              aria-label={name}
              aria-pressed={selected}
            >
              <div className="absolute inset-0" style={{ background: gradient }} />
              <span className="absolute inset-x-0 bottom-0 truncate bg-neutral-950/80 px-1 py-0.5 text-center text-xs text-neutral-100 backdrop-blur-sm">
                {name}
              </span>
              {selected && (
                <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-sky-500 text-xs text-white">
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Custom slots 5..7 — 3-column grid, browse placeholders. */}
      <div className="grid grid-cols-3 gap-2">
        {CUSTOM_SLOTS.map((slot) => {
          const path = customPaths[slot] ?? "";
          const isEmpty = path === "";
          const selected = selectedSlot === slot;
          const label = isEmpty ? "Browse..." : basename(path);
          return (
            <button
              key={slot}
              type="button"
              onClick={() => handleCustomClick(slot, isEmpty)}
              className={`relative aspect-square overflow-hidden rounded-md border-2 transition ${
                selected
                  ? "border-sky-500"
                  : isEmpty
                    ? "border-dashed border-neutral-700 hover:border-neutral-600"
                    : "border-neutral-800 hover:border-neutral-700"
              }`}
              aria-label={isEmpty ? `Custom slot ${slot - 4} (empty)` : `Custom slot ${slot - 4}: ${label}`}
              aria-pressed={selected}
            >
              {isEmpty ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-neutral-900 text-neutral-500">
                  <span className="text-2xl leading-none">+</span>
                  <span className="text-xs">Browse...</span>
                </div>
              ) : (
                <>
                  <div className="absolute inset-0 bg-neutral-800" />
                  <span className="absolute inset-x-0 bottom-0 truncate bg-neutral-950/80 px-1 py-0.5 text-center text-xs text-neutral-100 backdrop-blur-sm">
                    {label}
                  </span>
                </>
              )}
              {selected && !isEmpty && (
                <span className="absolute left-1 top-1 flex size-5 items-center justify-center rounded-full bg-sky-500 text-xs text-white">
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
    </ToolPanel>
  );
}
