// LightingPanel — modeless tool window for the three engine lights,
// ambient tint, and shadow tint. Replaces the legacy `LightingDlgProc`
// at src/main.cpp:6574 for the React UI; the Win32 dialog stays for
// `--legacy-ui` until Phase 4.2.
//
// Sections (top-to-bottom):
//   1. Sun light (expanded by default, <details> collapsible):
//      intensity, azimuth, altitude, diffuse, specular.
//   2. Fill light 1 (collapsed by default): intensity, azimuth,
//      altitude, diffuse (no specular — matches legacy "fills are
//      diffuse-only").
//   3. Fill light 2 (collapsed by default): same as Fill 1.
//   4. Ambient (always visible): ColorButton.
//   5. Shadow (always visible): ColorButton.
//   6. Footer: Mirror Sun button (copies sun colour to both fills via
//      two `engine/set/light` calls), Reset button (resets all lights
//      to component-baked defaults).
//
// Bridge surface (existing — zero schema additions in this batch):
//   - engine/set/light  { which, ...LightDto }
//   - engine/set/ambient { color: Vec4 }
//   - engine/set/shadow  { color: Vec4 }
//
// Intensity mapping. The legacy panel stores `intensity` separately
// from the diffuse/specular COLORREFs and folds them at push time:
//     L.Diffuse  = (R/255 * intensity, G/255 * intensity, B/255 * intensity, 1)
//     L.Specular = (R/255 * intensity, G/255 * intensity, B/255 * intensity, 1)
//                                                                (src/main.cpp:6196)
// The engine only stores the post-multiplied Vec4. The panel keeps a
// local intensity (defaulted to 1 on first mount per light) plus the
// colour value displayed in the ColorButton; on commit it multiplies
// the displayed RGB by intensity and ships the resulting Vec4. Changing
// intensity re-multiplies the existing colour so the user's chosen hue
// is preserved.
//
// Force Align: the legacy dialog has a "Force Align Fill Lights"
// checkbox that snaps fill angles from the sun's Z value. No bridge
// call exists for this in the schema; deferred for a future batch
// when the schema gets a `engine/set/lighting-force-align` flag (or
// when the panel grows enough geometry to compute it client-side and
// push fill angles directly). Marked as TODO in the JSX below.

import { useEffect, useState } from "react";
import type {
  Bridge,
  EngineStateDto,
  LightDto,
  LightWhich,
  Vec4,
} from "@particle-editor/bridge-schema";
import { Spinner } from "@/primitives/Spinner";
import { ColorButton } from "@/primitives/ColorButton";
import { ToolPanel } from "@/components/ToolPanel";
import { vec4ToColorref } from "@/lib/colorref";
import type { RgbColor } from "@/primitives/palette-store";

type Props = {
  bridge: Bridge;
  onClose: () => void;
};

// (Z angle, tilt) → unit direction vector. Mirrors `DirectionFromZTilt`
// at src/main.cpp:6183 — same convention so values entered in this panel
// match the legacy dialog.
function directionFromAzAlt(zDeg: number, tiltDeg: number): Vec4 {
  const z = (zDeg * Math.PI) / 180;
  const t = (tiltDeg * Math.PI) / 180;
  const c = Math.cos(t);
  return [c * Math.cos(z), c * Math.sin(z), Math.sin(t), 0] as const;
}

/** Recover (azimuth, altitude) in degrees from a direction Vec4 by
 *  inverting `directionFromAzAlt`. Used to seed the spinners from the
 *  engine snapshot. Position[3] is unused; the engine reads only the
 *  first three components. */
function azAltFromDirection(p: Vec4): { az: number; alt: number } {
  const [x, y, z] = p;
  const alt = (Math.asin(Math.max(-1, Math.min(1, z))) * 180) / Math.PI;
  const az = (Math.atan2(y, x) * 180) / Math.PI;
  return { az, alt };
}

/** Build a `LightDto` from user-facing inputs, folding `intensity`
 *  into the diffuse/specular Vec4 channels exactly as legacy MakeLight
 *  does at src/main.cpp:6196. */
function buildLightDto(
  zDeg: number,
  tiltDeg: number,
  diffuse: RgbColor,
  specular: RgbColor,
  intensity: number,
): LightDto {
  const dir = directionFromAzAlt(zDeg, tiltDeg);
  const scale = (c: number) => (c / 255) * intensity;
  return {
    diffuse: [scale(diffuse.r), scale(diffuse.g), scale(diffuse.b), 1.0],
    specular: [scale(specular.r), scale(specular.g), scale(specular.b), 1.0],
    position: dir,
    // SetLight derives direction internally from position; the wire
    // value is overwritten engine-side.
    direction: [0, 0, 0, 0],
  };
}

/** Each light's editable state. Held in React so intensity can be
 *  edited as a separate axis from the displayed colour. */
type LightFormState = {
  intensity: number;
  az: number;
  alt: number;
  diffuse: RgbColor;
  specular: RgbColor; // unused for fills
};

// Defaults mirror src/main.cpp:6154 (kLightSunIntensityDefault etc.).
// These drive the Reset button and also serve as the seed when the
// engine snapshot hasn't arrived yet.
const SUN_DEFAULTS: LightFormState = {
  intensity: 0.5,
  az: 0,
  alt: 45,
  diffuse: { r: 180, g: 180, b: 190 },
  specular: { r: 190, g: 190, b: 200 },
};
const FILL1_DEFAULTS: LightFormState = {
  intensity: 0.5,
  az: 120,
  alt: -10,
  diffuse: { r: 60, g: 80, b: 160 },
  specular: { r: 0, g: 0, b: 0 },
};
const FILL2_DEFAULTS: LightFormState = {
  ...FILL1_DEFAULTS,
  az: 210,
};
// Sun ambient/shadow defaults from src/main.cpp:6157-6160.
const AMBIENT_DEFAULT: RgbColor = { r: 40, g: 40, b: 50 };
const SHADOW_DEFAULT: RgbColor = { r: 100, g: 100, b: 110 };

function rgbToColorButtonValue(rgb: RgbColor): RgbColor {
  return rgb;
}

function vec4ToRgb(v: Vec4): RgbColor {
  const c = vec4ToColorref(v);
  return {
    r: c & 0xff,
    g: (c >> 8) & 0xff,
    b: (c >> 16) & 0xff,
  };
}

/** Seed the per-light form state from the engine snapshot. Intensity
 *  is assumed 1.0 on first read (the snapshot only carries the
 *  post-multiplied Vec4); the user can adjust thereafter and the
 *  multiplier compounds correctly on the next push. */
function seedFromSnapshot(light: LightDto): LightFormState {
  const { az, alt } = azAltFromDirection(light.position);
  return {
    intensity: 1,
    az,
    alt,
    diffuse: vec4ToRgb(light.diffuse),
    specular: vec4ToRgb(light.specular),
  };
}

export function LightingPanel({ bridge, onClose }: Props) {
  const [snapshot, setSnapshot] = useState<EngineStateDto | null>(null);
  const [sun, setSun] = useState<LightFormState>(SUN_DEFAULTS);
  const [fill1, setFill1] = useState<LightFormState>(FILL1_DEFAULTS);
  const [fill2, setFill2] = useState<LightFormState>(FILL2_DEFAULTS);
  const [ambient, setAmbient] = useState<RgbColor>(AMBIENT_DEFAULT);
  const [shadow, setShadow] = useState<RgbColor>(SHADOW_DEFAULT);
  // Once we've seeded form state from the snapshot, subsequent
  // snapshots are ignored so the user's intensity edits don't get
  // wiped — the engine has no notion of "intensity vs colour", only
  // the multiplied Vec4, so re-seeding would clobber the split.
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    bridge
      .request({ kind: "engine/state/snapshot", params: {} })
      .then((s) => {
        if (cancelled) return;
        setSnapshot(s);
        if (!seeded) {
          setSun(seedFromSnapshot(s.lights.sun));
          setFill1(seedFromSnapshot(s.lights.fill1));
          setFill2(seedFromSnapshot(s.lights.fill2));
          setAmbient(vec4ToRgb(s.ambient));
          setShadow(vec4ToRgb(s.shadow));
          setSeeded(true);
        }
      })
      .catch((err) => console.warn("[LightingPanel] snapshot failed:", err));
    const off = bridge.on("engine/state/changed", (e) => {
      setSnapshot(e.payload);
    });
    return () => {
      cancelled = true;
      off();
    };
    // `seeded` is intentionally omitted from deps so the post-seed
    // listener stays attached without re-firing the seed branch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);

  void snapshot; // currently unused after seeding — kept for future Force Align wiring.

  const pushLight = (which: LightWhich, s: LightFormState) => {
    void bridge.request({
      kind: "engine/set/light",
      params: { which, ...buildLightDto(s.az, s.alt, s.diffuse, s.specular, s.intensity) },
    });
  };

  const updateSun = (patch: Partial<LightFormState>) => {
    const next = { ...sun, ...patch };
    setSun(next);
    pushLight("sun", next);
  };
  const updateFill1 = (patch: Partial<LightFormState>) => {
    const next = { ...fill1, ...patch };
    setFill1(next);
    pushLight("fill1", next);
  };
  const updateFill2 = (patch: Partial<LightFormState>) => {
    const next = { ...fill2, ...patch };
    setFill2(next);
    pushLight("fill2", next);
  };

  const rgbToVec4 = (rgb: RgbColor): Vec4 =>
    [rgb.r / 255, rgb.g / 255, rgb.b / 255, 1.0] as const;

  const updateAmbient = (rgb: RgbColor) => {
    setAmbient(rgb);
    void bridge.request({
      kind: "engine/set/ambient",
      params: { color: rgbToVec4(rgb) },
    });
  };
  const updateShadow = (rgb: RgbColor) => {
    setShadow(rgb);
    void bridge.request({
      kind: "engine/set/shadow",
      params: { color: rgbToVec4(rgb) },
    });
  };

  const handleMirrorSun = () => {
    // Copy the sun's diffuse + specular to fill1 and fill2. Per locks,
    // this composes via two `engine/set/light` calls — fill1 and fill2
    // both take the sun's diffuse. Fill specular stays at black per
    // legacy (fills are diffuse-only).
    const newFill1: LightFormState = {
      ...fill1,
      diffuse: sun.diffuse,
      intensity: sun.intensity,
    };
    const newFill2: LightFormState = {
      ...fill2,
      diffuse: sun.diffuse,
      intensity: sun.intensity,
    };
    setFill1(newFill1);
    setFill2(newFill2);
    pushLight("fill1", newFill1);
    pushLight("fill2", newFill2);
  };

  const handleReset = () => {
    setSun(SUN_DEFAULTS);
    setFill1(FILL1_DEFAULTS);
    setFill2(FILL2_DEFAULTS);
    setAmbient(AMBIENT_DEFAULT);
    setShadow(SHADOW_DEFAULT);
    pushLight("sun", SUN_DEFAULTS);
    pushLight("fill1", FILL1_DEFAULTS);
    pushLight("fill2", FILL2_DEFAULTS);
    updateAmbient(AMBIENT_DEFAULT);
    updateShadow(SHADOW_DEFAULT);
  };

  return (
    <ToolPanel title="Lighting" onClose={onClose}>
      <ToolPanel.Section title="Sun" defaultOpen>
        <ToolPanel.Row label="Intensity">
          <Spinner
            value={sun.intensity}
            onChange={(v) => updateSun({ intensity: v })}
            min={0}
            max={2}
            step={0.05}
            aria-label="Sun intensity"
          />
        </ToolPanel.Row>
        <ToolPanel.Row label="Azimuth">
          <Spinner
            value={sun.az}
            onChange={(v) => updateSun({ az: v })}
            min={-180}
            max={180}
            step={1}
            unit="°"
            aria-label="Sun azimuth"
          />
        </ToolPanel.Row>
        <ToolPanel.Row label="Altitude">
          <Spinner
            value={sun.alt}
            onChange={(v) => updateSun({ alt: v })}
            min={-90}
            max={90}
            step={1}
            unit="°"
            aria-label="Sun altitude"
          />
        </ToolPanel.Row>
        <ToolPanel.Row label="Diffuse">
          <ColorButton
            value={rgbToColorButtonValue(sun.diffuse)}
            onChange={(rgb) => updateSun({ diffuse: rgb })}
            aria-label="Sun diffuse colour"
          />
        </ToolPanel.Row>
        <ToolPanel.Row label="Specular">
          <ColorButton
            value={rgbToColorButtonValue(sun.specular)}
            onChange={(rgb) => updateSun({ specular: rgb })}
            aria-label="Sun specular colour"
          />
        </ToolPanel.Row>
      </ToolPanel.Section>

      <ToolPanel.Section title="Fill 1">
        <ToolPanel.Row label="Intensity">
          <Spinner
            value={fill1.intensity}
            onChange={(v) => updateFill1({ intensity: v })}
            min={0}
            max={2}
            step={0.05}
            aria-label="Fill 1 intensity"
          />
        </ToolPanel.Row>
        <ToolPanel.Row label="Azimuth">
          <Spinner
            value={fill1.az}
            onChange={(v) => updateFill1({ az: v })}
            min={-180}
            max={180}
            step={1}
            unit="°"
            aria-label="Fill 1 azimuth"
          />
        </ToolPanel.Row>
        <ToolPanel.Row label="Altitude">
          <Spinner
            value={fill1.alt}
            onChange={(v) => updateFill1({ alt: v })}
            min={-90}
            max={90}
            step={1}
            unit="°"
            aria-label="Fill 1 altitude"
          />
        </ToolPanel.Row>
        <ToolPanel.Row label="Diffuse">
          <ColorButton
            value={rgbToColorButtonValue(fill1.diffuse)}
            onChange={(rgb) => updateFill1({ diffuse: rgb })}
            aria-label="Fill 1 diffuse colour"
          />
        </ToolPanel.Row>
      </ToolPanel.Section>

      <ToolPanel.Section title="Fill 2">
        <ToolPanel.Row label="Intensity">
          <Spinner
            value={fill2.intensity}
            onChange={(v) => updateFill2({ intensity: v })}
            min={0}
            max={2}
            step={0.05}
            aria-label="Fill 2 intensity"
          />
        </ToolPanel.Row>
        <ToolPanel.Row label="Azimuth">
          <Spinner
            value={fill2.az}
            onChange={(v) => updateFill2({ az: v })}
            min={-180}
            max={180}
            step={1}
            unit="°"
            aria-label="Fill 2 azimuth"
          />
        </ToolPanel.Row>
        <ToolPanel.Row label="Altitude">
          <Spinner
            value={fill2.alt}
            onChange={(v) => updateFill2({ alt: v })}
            min={-90}
            max={90}
            step={1}
            unit="°"
            aria-label="Fill 2 altitude"
          />
        </ToolPanel.Row>
        <ToolPanel.Row label="Diffuse">
          <ColorButton
            value={rgbToColorButtonValue(fill2.diffuse)}
            onChange={(rgb) => updateFill2({ diffuse: rgb })}
            aria-label="Fill 2 diffuse colour"
          />
        </ToolPanel.Row>
      </ToolPanel.Section>

      <ToolPanel.Section title="Ambient" alwaysOpen>
        <ToolPanel.Row label="Colour">
          <ColorButton
            value={rgbToColorButtonValue(ambient)}
            onChange={updateAmbient}
            aria-label="Ambient colour"
          />
        </ToolPanel.Row>
      </ToolPanel.Section>

      <ToolPanel.Section title="Shadow" alwaysOpen>
        <ToolPanel.Row label="Colour">
          <ColorButton
            value={rgbToColorButtonValue(shadow)}
            onChange={updateShadow}
            aria-label="Shadow colour"
          />
        </ToolPanel.Row>
      </ToolPanel.Section>

      <ToolPanel.Footer>
        <button
          type="button"
          onClick={handleMirrorSun}
          className="rounded border border-neutral-700 bg-neutral-800 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
        >
          Mirror Sun
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="rounded border border-neutral-700 bg-neutral-800 px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
        >
          Reset
        </button>
        {/* TODO Batch 3+: Force Align checkbox. Requires a new bridge
            call (`engine/set/lighting-force-align` or equivalent) plus
            client-side cascade of sun-Z → fill angles. Deferred per
            Batch 2 design lock #4. */}
      </ToolPanel.Footer>
    </ToolPanel>
  );
}
