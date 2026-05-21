// EmitterPropertyTabs — lower-left quadrant of the four-quadrant layout
// (Phase 4.1 Fix dispatch 1). Three tabs (Basic / Appearance / Physics)
// driven by Radix Tabs. The Basic tab is fully wired this batch — 18
// form fields commit via `emitters/set-properties { id, patch: { ... } }`.
// Appearance + Physics tabs render "Coming in Fix dispatch N"
// placeholders; the schema-side DTO carries every field they need.
//
// Replaces the legacy `src/UI/Emitter.cpp` modal (873 LOC, ~150 control
// IDs). Mirrors the legacy tab structure 1:1: Basic / Appearance /
// Physics.
//
// Bridge surface:
//   - On selection change + on `emitters/tree/changed`: fetch via
//     `emitters/get-properties { id }`.
//   - Each field commit: `emitters/set-properties { id, patch: { ... } }`.
//
// Optimistic local update: each commit also applies the patch to local
// `properties` state immediately so the form doesn't flash on
// round-trip. A late-arriving `tree/changed` re-fetch is authoritative.
//
// `useBursts` mutex enabling (mirrors legacy):
//   - `useBursts === true` enables nBursts / burstDelay / nParticlesPerBurst
//     and disables nParticlesPerSecond.
//   - `useBursts === false` enables nParticlesPerSecond and disables
//     nBursts / burstDelay / nParticlesPerBurst.
//
// `randomRotation` enabling: when false, randomRotationDirection /
// Average / Variance disable.
//
// Text input (name) commits on blur — avoids per-keystroke bridge spam.
// Spinners commit per their existing semantics (Enter / blur / arrow /
// wheel / drag-release). Checkboxes commit on change.

import { useCallback, useEffect, useRef, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import * as Checkbox from "@radix-ui/react-checkbox";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import type {
  Bridge,
  EmitterPropertiesDto,
  GroupDto,
  Vec3,
  Vec4,
} from "@particle-editor/bridge-schema";
import { Spinner } from "@/primitives/Spinner";
import { Section } from "@/components/Section";

// Blend mode dropdown options — mirrors the legacy `BlendModes[]` table
// at [src/UI/Emitter.cpp:20-31]. The engine has additional blend mode
// values (8, 9, 10, 13) but the legacy UI doesn't expose them via the
// dropdown — keep parity here.
const BLEND_MODE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "None" },
  { value: 1, label: "Additive" },
  { value: 2, label: "Transparent" },
  { value: 3, label: "Inverse" },
  { value: 4, label: "Depth additive" },
  { value: 5, label: "Depth transparent" },
  { value: 6, label: "Depth inverse" },
  { value: 7, label: "Diffuse transparent" },
  { value: 11, label: "Bump map" },
  { value: 12, label: "Decal bump map" },
];

// BLEND_BUMP (==11) forces face-camera orientation. Mirrors the legacy
// `forceFace = (emitter->blendMode == ParticleSystem::BLEND_BUMP)`
// at [src/UI/Emitter.cpp:167] — only the BLEND_BUMP value triggers
// the cascade, not BLEND_DECAL_BUMPMAP.
const BLEND_BUMP = 11;

// Ground-interaction dropdown options — mirrors the legacy
// `GroundBehaviors[]` table at [src/UI/Emitter.cpp:35-40]. Values are
// the engine enum index (0..3); the `IDS_GROUND_BEHAVIOR_BOUNCE`
// string-id is the 3rd entry (value 2), and legacy cascades enable
// `bounciness` only when this value is picked
// (see [src/UI/Emitter.cpp:190]).
const GROUND_BEHAVIOR_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "None" },
  { value: 1, label: "Disappear" },
  { value: 2, label: "Bounce" },
  { value: 3, label: "Stick" },
];
const GROUND_BEHAVIOR_BOUNCE = 2;

// Emit-from-mesh dropdown options — mirrors the legacy
// `EmitModes[]` table at [src/UI/Emitter.cpp:44-49]. Values match
// `ParticleSystem::EMIT_*` constants at [src/ParticleSystem.h:66-69]:
// EMIT_DISABLE=0, EMIT_RANDOM_VERTEX=1, EMIT_RANDOM_MESH=2,
// EMIT_EVERY_VERTEX=3.
const EMIT_FROM_MESH_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Disable" },
  { value: 1, label: "Random Vertex" },
  { value: 2, label: "Random Mesh" },
  { value: 3, label: "Every Vertex" },
];
const EMIT_FROM_MESH_DISABLE = 0;

// Random-Param group type dropdown options — mirrors the engine
// `GT_*` constants at [src/ParticleSystem.h:20-24]: GT_EXACT=0,
// GT_BOX=1, GT_CUBE=2, GT_SPHERE=3, GT_CYLINDER=4.
const GROUP_TYPE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Exact" },
  { value: 1, label: "Box" },
  { value: 2, label: "Cube" },
  { value: 3, label: "Sphere" },
  { value: 4, label: "Cylinder" },
];
const GT_EXACT = 0;
const GT_BOX = 1;
const GT_CUBE = 2;
const GT_SPHERE = 3;
const GT_CYLINDER = 4;

// Group semantic labels — `EmitterPropertiesDto.groups` is the on-wire
// projection of `ParticleSystem::Emitter::groups[NUM_GROUPS]`. Engine
// constants at [src/ParticleSystem.h:28-30]:
//   GROUP_SPEED    = 0  → "Initial Speed"
//   GROUP_LIFETIME = 1  → "Lifetime"
//   GROUP_POSITION = 2  → "Initial Position"
// Legacy's Physics dialog only renders 2 of the 3 (POSITION + SPEED;
// see [src/UI/Emitter.cpp:849-852]); LIFETIME is unused by that
// dialog. We surface all 3 so the panel is complete.
// TODO(MT-2): confirm the lifetime group's intended label/UX placement
// — legacy hides it but the engine carries it on the wire.
const GROUP_LABELS = ["Initial Speed", "Lifetime", "Initial Position"];

type Props = {
  bridge: Bridge;
};

export function EmitterPropertyTabs({ bridge }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [properties, setProperties] = useState<EmitterPropertiesDto | null>(null);
  // Discard stale responses if selection changes mid-flight.
  const inFlightFor = useRef<number | null>(null);

  // Seed selection from the engine snapshot.
  useEffect(() => {
    let cancelled = false;
    bridge
      .request({ kind: "engine/state/snapshot", params: {} })
      .then((snap) => {
        if (cancelled) return;
        setSelectedId(snap.selectedEmitterId);
      })
      .catch(() => { /* placeholder branch handles null */ });
    return () => { cancelled = true; };
  }, [bridge]);

  // Track live selection.
  useEffect(() => {
    const off = bridge.on("emitters/selected", (e) => {
      setSelectedId(e.payload.id);
    });
    return off;
  }, [bridge]);

  // Fetch helper. Discards responses for stale selection.
  const fetchProps = useCallback(
    (id: number | null) => {
      if (id === null) {
        setProperties(null);
        inFlightFor.current = null;
        return;
      }
      inFlightFor.current = id;
      bridge
        .request({ kind: "emitters/get-properties", params: { id } })
        .then((res) => {
          if (inFlightFor.current !== id) return;
          setProperties(res.properties);
        })
        .catch(() => {
          if (inFlightFor.current !== id) return;
          setProperties(null);
        });
    },
    [bridge],
  );

  // Re-fetch on selection change.
  useEffect(() => {
    fetchProps(selectedId);
  }, [fetchProps, selectedId]);

  // Re-fetch on tree mutations.
  useEffect(() => {
    const off = bridge.on("emitters/tree/changed", () => {
      fetchProps(selectedId);
    });
    return off;
  }, [bridge, fetchProps, selectedId]);

  // Commit helper — fires the bridge patch + optimistic local update.
  const commit = useCallback(
    (patch: Partial<EmitterPropertiesDto>) => {
      if (selectedId === null) return;
      // Optimistic local update so the spinner doesn't flash back to
      // the old value before the engine re-emits.
      setProperties((p) => (p === null ? p : { ...p, ...patch }));
      void bridge
        .request({
          kind: "emitters/set-properties",
          params: { id: selectedId, patch },
        })
        .catch(() => {
          // On failure, re-fetch the authoritative value so we don't
          // leave the form stuck on a value the engine refused.
          fetchProps(selectedId);
        });
    },
    [bridge, selectedId, fetchProps],
  );

  if (selectedId === null) {
    return (
      <div
        data-testid="emitter-property-tabs-placeholder"
        className="flex h-full items-center justify-center p-4 text-center text-xs text-text-3"
      >
        Select an emitter to edit its properties
      </div>
    );
  }
  if (properties === null) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-text-3">
        Loading…
      </div>
    );
  }

  return (
    <Tabs.Root
      data-testid="emitter-property-tabs"
      defaultValue="basic"
      className="flex h-full flex-col"
    >
      <Tabs.List
        className="flex shrink-0 border-b border-border bg-bg"
        aria-label="Emitter property tabs"
      >
        <TabTrigger value="basic" label="Basic" />
        <TabTrigger value="appearance" label="Appearance" />
        <TabTrigger value="physics" label="Physics" />
      </Tabs.List>
      {/* Basic tab uses .inspector inside (BasicTab renders
          <div className="inspector">), so the Tabs.Content wrapper
          omits Tailwind padding to avoid doubling. Appearance + Physics
          keep p-3 until B2 wires them through the same .inspector
          wrapper. */}
      <Tabs.Content
        value="basic"
        className="flex-1 min-h-0 overflow-y-auto outline-none"
        data-testid="tab-basic-content"
      >
        <BasicTab properties={properties} onCommit={commit} />
      </Tabs.Content>
      <Tabs.Content
        value="appearance"
        className="flex-1 min-h-0 overflow-y-auto p-3 outline-none"
        data-testid="tab-appearance-content"
      >
        <AppearanceTab properties={properties} onCommit={commit} />
      </Tabs.Content>
      <Tabs.Content
        value="physics"
        className="flex-1 min-h-0 overflow-y-auto p-3 outline-none"
        data-testid="tab-physics-content"
      >
        <PhysicsTab properties={properties} onCommit={commit} />
      </Tabs.Content>
    </Tabs.Root>
  );
}

function TabTrigger({ value, label }: { value: string; label: string }) {
  return (
    <Tabs.Trigger
      value={value}
      data-testid={`tab-trigger-${value}`}
      className="flex-1 cursor-pointer border-b-2 border-transparent px-3 py-2 text-xs text-text-2 outline-none transition data-[state=active]:border-accent data-[state=active]:text-text hover:text-text focus-visible:bg-bg-2"
    >
      {label}
    </Tabs.Trigger>
  );
}

// ─── Basic tab ──────────────────────────────────────────────────────

// Tri-state Generation mode — declared at module scope so MODE_ORDER /
// navigate can reference the type without re-declaring it inside the
// component body.
type GenerationMode = "bursts" | "continuous" | "weather";

// Roving-tabindex navigation order for the Generation radiogroup. The
// arrow handlers cycle through this list (ArrowUp = -1, ArrowDown = +1)
// with modulo wrap so Bursts ↔ Continuous ↔ Weather is a closed loop.
const MODE_ORDER: GenerationMode[] = ["bursts", "continuous", "weather"];
const navigate = (from: GenerationMode, dir: -1 | 1): GenerationMode => {
  const idx = MODE_ORDER.indexOf(from);
  const next = (idx + dir + MODE_ORDER.length) % MODE_ORDER.length;
  return MODE_ORDER[next];
};

// Local RadioRow helper — captures the per-radio chrome (role,
// aria-checked, roving tabIndex, the dot+label spans, and the
// keyboard handler) so each radio site in BasicTab is a five-line
// usage instead of a 17-line block. ArrowUp/ArrowDown delegate to
// `onArrowNav` (`-1` for previous, `+1` for next); Enter/Space
// preserve the existing selection behaviour.
function RadioRow({
  checked,
  label,
  tabIndex,
  onSelect,
  onArrowNav,
}: {
  checked: boolean;
  label: string;
  tabIndex: number;
  onSelect: () => void;
  /** Called with -1 for ArrowUp (previous), +1 for ArrowDown (next). */
  onArrowNav: (direction: -1 | 1) => void;
}) {
  return (
    <div
      role="radio"
      aria-checked={checked}
      tabIndex={tabIndex}
      className="radio-row"
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          onArrowNav(-1);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          onArrowNav(1);
        }
      }}
    >
      <span className="radio-dot" />
      <span>{label}</span>
    </div>
  );
}

export function BasicTab({
  properties,
  onCommit,
}: {
  properties: EmitterPropertiesDto;
  onCommit: (patch: Partial<EmitterPropertiesDto>) => void;
}) {
  // Tri-state Generation mode derived from (useBursts, isWeatherParticle).
  // Legacy parity: weather wins when set (the legacy UI surfaces weather
  // mode regardless of useBursts), then bursts vs continuous splits on
  // the remaining axis. See spec §5.1 + Risk #1 for the atomic-patch
  // rationale — each setMode call fires ONE patch carrying both keys so
  // the engine never observes a transient inconsistent state pair.
  const mode: GenerationMode = properties.isWeatherParticle
    ? "weather"
    : properties.useBursts
      ? "bursts"
      : "continuous";

  const setMode = (next: GenerationMode) => {
    switch (next) {
      case "bursts":     onCommit({ useBursts: true, isWeatherParticle: false }); break;
      case "continuous": onCommit({ useBursts: false, isWeatherParticle: false }); break;
      // Weather only sets isWeatherParticle — useBursts is preserved so
      // toggling weather off returns the user to whichever non-weather
      // mode they came from. Matches legacy IDC_RADIO_WEATHER behaviour.
      case "weather":    onCommit({ isWeatherParticle: true }); break;
    }
  };

  // Roving tabIndex — only the active mode is in the tab cycle so
  // shift+Tab doesn't have to step through three radios to escape
  // the group. Matches the WAI-ARIA radio group pattern.
  const tabIndexFor = (m: GenerationMode) => (m === mode ? 0 : -1);

  const burstsEnabled = mode === "bursts";
  const continuousEnabled = mode === "continuous";
  const weatherEnabled = mode === "weather";
  return (
    <div className="inspector">
      {/* Name row — custom 60px 1fr grid per design source's
          left_panel.jsx:100. Outside any Section so it always
          shows at the top of the tab. */}
      <div className="form-row name-row">
        <span className="lbl">Name</span>
        <FieldText
          value={properties.name}
          onCommit={(v) => onCommit({ name: v })}
          label="Name"
          wide
        />
      </div>

      <Section title="Emitter Timing">
        <FieldSpinner
          label="Initial spawn delay:"
          value={properties.initialDelay}
          min={0}
          step={0.1}
          unit="s"
          onCommit={(v) => onCommit({ initialDelay: v })}
        />
        <FieldSpinner
          label="Skip time:"
          value={properties.skipTime}
          min={0}
          step={0.1}
          unit="s"
          onCommit={(v) => onCommit({ skipTime: v })}
        />
        <FieldSpinner
          label="Freeze time:"
          value={properties.freezeTime}
          min={0}
          step={0.1}
          unit="s"
          onCommit={(v) => onCommit({ freezeTime: v })}
        />
      </Section>

      <Section title="Generation">
        {/* Hand-rolled radio rows (not Radix RadioGroup) per spec §5.1
            — keeps the visual fidelity tight to the legacy three-row
            stack while still being keyboard-accessible. The wrapper
            div carries role="radiogroup" so screen readers announce
            the three radios as a group; the inner FieldSpinner
            sub-fields aren't role="radio" and so don't interfere with
            ARIA semantics. Roving tabIndex + ArrowUp/ArrowDown matches
            the WAI-ARIA radio group pattern. */}
        <div role="radiogroup" aria-label="Generation mode">
          <RadioRow
            checked={burstsEnabled}
            label="Bursts"
            tabIndex={tabIndexFor("bursts")}
            onSelect={() => setMode("bursts")}
            onArrowNav={(d) => setMode(navigate("bursts", d))}
          />
          <FieldSpinner
            label="Bursts:"
            value={properties.nBursts}
            min={1}
            step={1}
            decimals={0}
            disabled={!burstsEnabled}
            onCommit={(v) => onCommit({ nBursts: Math.round(v) })}
          />
          <FieldSpinner
            label="Burst delay:"
            value={properties.burstDelay}
            min={0}
            step={0.1}
            unit="s"
            disabled={!burstsEnabled}
            onCommit={(v) => onCommit({ burstDelay: v })}
          />
          <FieldSpinner
            label="Particles/burst:"
            value={properties.nParticlesPerBurst}
            min={1}
            step={1}
            decimals={0}
            disabled={!burstsEnabled}
            onCommit={(v) => onCommit({ nParticlesPerBurst: Math.round(v) })}
          />

          <RadioRow
            checked={continuousEnabled}
            label="Continuous stream"
            tabIndex={tabIndexFor("continuous")}
            onSelect={() => setMode("continuous")}
            onArrowNav={(d) => setMode(navigate("continuous", d))}
          />
          <FieldSpinner
            label="Particles/second:"
            value={properties.nParticlesPerSecond}
            min={0}
            step={1}
            decimals={0}
            disabled={!continuousEnabled}
            onCommit={(v) => onCommit({ nParticlesPerSecond: Math.round(v) })}
          />

          <RadioRow
            checked={weatherEnabled}
            label="Weather particle"
            tabIndex={tabIndexFor("weather")}
            onSelect={() => setMode("weather")}
            onArrowNav={(d) => setMode(navigate("weather", d))}
          />
          {/* NOTE: Continuous and Weather both bind to nParticlesPerSecond
              but carry distinct aria-labels ("Particles/second:" vs
              "Particles:") so getByLabelText still distinguishes them.
              Per spec Risk #3. */}
          <FieldSpinner
            label="Particles:"
            value={properties.nParticlesPerSecond}
            min={0}
            step={1}
            decimals={0}
            disabled={!weatherEnabled}
            onCommit={(v) => onCommit({ nParticlesPerSecond: Math.round(v) })}
          />
          <FieldSpinner
            label="Distance from camera:"
            value={properties.weatherCubeDistance}
            min={0}
            step={0.1}
            unit="units"
            disabled={!weatherEnabled}
            onCommit={(v) => onCommit({ weatherCubeDistance: v })}
          />
          <FieldSpinner
            label="Cube size:"
            value={properties.weatherCubeSize}
            min={0}
            step={0.1}
            unit="units"
            disabled={!weatherEnabled}
            onCommit={(v) => onCommit({ weatherCubeSize: v })}
          />
        </div>

        {/* Lifetime fields moved here from Emitter Timing to match
            legacy IDD_EMITTER_PROPS1 (.rc:449,461,466). Minimum lifetime
            uses displayInvertedPercent: the stored ratio (0..1) displays
            as `100 - val*100` rounded — matches IDC_SPINNER14 at
            [Emitter.cpp:487,795]. */}
        <FieldSpinner
          label="Maximum lifetime:"
          value={properties.lifetime}
          min={0}
          step={0.1}
          unit="s"
          onCommit={(v) => onCommit({ lifetime: v })}
        />
        <FieldSpinner
          label="Minimum lifetime:"
          value={properties.randomLifetimePerc}
          displayInvertedPercent
          unit="%"
          onCommit={(v) => onCommit({ randomLifetimePerc: v })}
        />

      </Section>

      <Section title="Connection">
        <FieldCheckbox
          label="Link particles to instance"
          checked={properties.linkToSystem}
          onCheckedChange={(v) => onCommit({ linkToSystem: v })}
        />
        <FieldSelect
          label="Emit mode:"
          value={properties.emitFromMesh}
          options={EMIT_FROM_MESH_OPTIONS}
          onCommit={(v) => onCommit({ emitFromMesh: v })}
          testId="basic-emit-from-mesh-trigger"
        />
        <FieldSpinner
          label="Emit offset:"
          value={properties.emitFromMeshOffset}
          step={0.1}
          unit="units"
          disabled={properties.emitFromMesh === EMIT_FROM_MESH_DISABLE}
          onCommit={(v) => onCommit({ emitFromMeshOffset: v })}
        />
      </Section>
    </div>
  );
}

// ─── Field row primitives ──────────────────────────────────────────
//
// Task 2.5: form rows use the design's `.form-row` 3-column grid
// (label / input / unit) from components.css. The optional third
// column carries the unit hint (e.g. "s", "%"); empty for fields
// that don't have one.

function FieldText({
  label,
  value,
  onCommit,
  wide,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  /** When true, render just the <input> (no .form-row wrapper, no
   *  label span). Caller owns the outer row container and the label.
   *  Used by the Name row, which needs the design source's custom
   *  60px 1fr grid template. */
  wide?: boolean;
}) {
  // Local text state so the user can type freely; commit on blur or
  // Enter to avoid per-keystroke bridge spam.
  const [text, setText] = useState(value);
  const lastProp = useRef(value);
  // Sync from prop when external value changes (and we're not editing).
  if (lastProp.current !== value) {
    lastProp.current = value;
    setText(value);
  }
  const input = (
    <input
      type="text"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== value) onCommit(text);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.currentTarget as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          setText(value);
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      className="text-input"
      aria-label={label}
      spellCheck={false}
      autoComplete="off"
    />
  );
  if (wide) {
    return input;
  }
  return (
    <div className="form-row">
      <span className="lbl">{label}</span>
      {input}
      <span className="unit" />
    </div>
  );
}

export function FieldSpinner({
  label,
  value,
  min,
  max,
  step,
  decimals,
  unit,
  disabled,
  displayInvertedPercent,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  unit?: string;
  disabled?: boolean;
  /** When true, displays `100 - value*100` (rounded to integer) and
   *  commits `(100 - displayed) / 100`. Forces min=0, max=100. Used for
   *  `randomLifetimePerc` and `randomScalePerc` per legacy IDC_SPINNER13/14
   *  inverted convention (see Emitter.cpp:487, 492). */
  displayInvertedPercent?: boolean;
  onCommit: (value: number) => void;
}) {
  const displayValue = displayInvertedPercent
    ? Math.round(100 - value * 100)
    : value;
  const handleCommit = (next: number) => {
    if (displayInvertedPercent) {
      onCommit((100 - next) / 100);
    } else {
      onCommit(next);
    }
  };
  const effectiveMin = displayInvertedPercent ? 0 : min;
  const effectiveMax = displayInvertedPercent ? 100 : max;
  const effectiveStep = displayInvertedPercent ? 1 : step;
  const effectiveDecimals = displayInvertedPercent ? 0 : decimals;
  return (
    <div className="form-row">
      <span className="lbl">{label}</span>
      {/* Task 2.5: the design's .form-row 3rd column carries the unit
          hint, so we suppress the Spinner's inline trailing-unit overlay
          here. Outside .form-row callers still get the inline unit. */}
      <Spinner
        value={displayValue}
        onChange={handleCommit}
        min={effectiveMin}
        max={effectiveMax}
        step={effectiveStep}
        decimals={effectiveDecimals}
        disabled={disabled}
        aria-label={label}
      />
      <span className="unit">{unit ?? ""}</span>
    </div>
  );
}

function FieldCheckbox({
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="form-row">
      <span className="lbl">{label}</span>
      <Checkbox.Root
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className={`flex h-[18px] w-[18px] items-center justify-center rounded border border-border-2 bg-bg-2 outline-none transition focus-visible:border-accent ${
          disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:border-border-2"
        } data-[state=checked]:border-accent data-[state=checked]:bg-accent`}
        aria-label={label}
      >
        <Checkbox.Indicator>
          <Check size={12} className="text-text" />
        </Checkbox.Indicator>
      </Checkbox.Root>
      <span className="unit" />
    </div>
  );
}

function FieldSelect({
  label,
  value,
  options,
  disabled,
  onCommit,
  testId,
}: {
  label: string;
  value: number;
  options: { value: number; label: string }[];
  disabled?: boolean;
  onCommit: (value: number) => void;
  testId?: string;
}) {
  const selected = options.find((o) => o.value === value);
  return (
    <div className="form-row">
      <span className="lbl">{label}</span>
      <Select.Root
        value={String(value)}
        onValueChange={(v) => onCommit(Number(v))}
        disabled={disabled}
      >
        <Select.Trigger
          data-testid={testId}
          aria-label={label}
          className="flex h-[26px] w-full items-center justify-between gap-1 rounded border border-border-2 bg-bg-2 px-2 text-xs text-text outline-none transition hover:border-border-2 focus:border-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Select.Value>{selected?.label ?? ""}</Select.Value>
          <Select.Icon>
            <ChevronDown className="size-3 text-text-3" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            position="popper"
            sideOffset={4}
            className="z-50 min-w-[160px] rounded-md border border-border-2 bg-bg-2 p-1 shadow-xl"
          >
            <Select.Viewport>
              {options.map((opt) => (
                <Select.Item
                  key={opt.value}
                  value={String(opt.value)}
                  data-testid={
                    testId ? `${testId}-option-${opt.value}` : undefined
                  }
                  className="cursor-pointer rounded px-2 py-0.5 text-xs text-text outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent"
                >
                  <Select.ItemText>{opt.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
      <span className="unit" />
    </div>
  );
}

// ─── Appearance tab ─────────────────────────────────────────────────

// Exported for direct testing — Radix Tabs in jsdom doesn't reliably
// switch via fireEvent (the known pointer-event flake noted in the
// Fix dispatch 1 tests), so vitest mounts AppearanceTab directly.
export function AppearanceTab({
  properties,
  onCommit,
}: {
  properties: EmitterPropertiesDto;
  onCommit: (patch: Partial<EmitterPropertiesDto>) => void;
}) {
  // BLEND_BUMP forces face-camera orientation — disables the
  // `isWorldOriented` checkbox and shows it as unchecked. Mirrors
  // [src/UI/Emitter.cpp:167-168] which disables IDC_CHECK16 when
  // `blendMode == BLEND_BUMP`. The legacy WM_COMMAND handler (line
  // 522-525) also flips `isWorldOriented = false` on the model the
  // moment the user picks the bump-map blend mode. We don't auto-mutate
  // the property here (the user may switch blend modes back and forth),
  // but the UI presents the field as unchecked + disabled while the
  // bump-map cascade is active.
  const forceFace = properties.blendMode === BLEND_BUMP;
  const tailEnabled = properties.hasTail;

  // Display 0..1 random-colour values as 0..100% in the spinners
  // (matches the legacy IDC_SPINNER19-26 percentage spinners at
  // [src/UI/Emitter.cpp:243-246]).
  const updateRandomColors = (idx: 0 | 1 | 2 | 3, displayed: number) => {
    const next: [number, number, number, number] = [
      properties.randomColors[0],
      properties.randomColors[1],
      properties.randomColors[2],
      properties.randomColors[3],
    ];
    next[idx] = displayed / 100;
    onCommit({ randomColors: next as unknown as Vec4 });
  };

  return (
    <div className="space-y-3">
      {/* TODO(MT-1): wire the TexturePalette popup (legacy IDC_BUTTON_PALETTE
          at [src/UI/Emitter.cpp:411]) — text-input + commit-on-blur for
          now, deferred to a polish batch. */}
      <FieldText
        label="Colour Texture"
        value={properties.colorTexture}
        onCommit={(v) => onCommit({ colorTexture: v })}
      />
      <FieldText
        label="Normal Texture"
        value={properties.normalTexture}
        onCommit={(v) => onCommit({ normalTexture: v })}
      />
      <FieldSelect
        label="Blend Mode"
        value={properties.blendMode}
        options={BLEND_MODE_OPTIONS}
        onCommit={(v) => onCommit({ blendMode: v })}
        testId="appearance-blend-mode-trigger"
      />
      <FieldSpinner
        label="Texture Size"
        value={properties.textureSize}
        min={1}
        step={1}
        decimals={0}
        onCommit={(v) => onCommit({ textureSize: Math.max(1, Math.round(v)) })}
      />
      <FieldSpinner
        label="Triangles"
        value={properties.nTriangles}
        min={1}
        step={1}
        decimals={0}
        onCommit={(v) => onCommit({ nTriangles: Math.max(1, Math.round(v)) })}
      />
      <FieldCheckbox
        label="Add Grayscale"
        checked={properties.doColorAddGrayscale}
        onCheckedChange={(v) => onCommit({ doColorAddGrayscale: v })}
      />
      {/* Random Colours — 4-spinner cluster (R/G/B/A as 0..100%).
          Uses the `.form-row` label column but the spinner grid spans
          the input + unit columns since 4 spinners don't fit in the
          design's 92px input slot. */}
      <div className="form-row items-start">
        <span className="lbl pt-1">Random Colours</span>
        <div
          className="grid grid-cols-2 gap-1"
          style={{ gridColumn: "2 / span 2" }}
        >
          <Spinner
            value={properties.randomColors[0] * 100}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={(v) => updateRandomColors(0, v)}
            aria-label="Random Colour R"
          />
          <Spinner
            value={properties.randomColors[1] * 100}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={(v) => updateRandomColors(1, v)}
            aria-label="Random Colour G"
          />
          <Spinner
            value={properties.randomColors[2] * 100}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={(v) => updateRandomColors(2, v)}
            aria-label="Random Colour B"
          />
          <Spinner
            value={properties.randomColors[3] * 100}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={(v) => updateRandomColors(3, v)}
            aria-label="Random Colour A"
          />
        </div>
      </div>
      <FieldCheckbox
        label="Has Tail"
        checked={properties.hasTail}
        onCheckedChange={(v) => onCommit({ hasTail: v })}
      />
      <FieldSpinner
        label="Tail Size"
        value={properties.tailSize}
        min={0}
        step={0.1}
        disabled={!tailEnabled}
        onCommit={(v) => onCommit({ tailSize: v })}
      />
      <FieldCheckbox
        label="Heat Particle"
        checked={properties.isHeatParticle}
        onCheckedChange={(v) => onCommit({ isHeatParticle: v })}
      />
      <FieldCheckbox
        label="World Oriented"
        checked={forceFace ? false : properties.isWorldOriented}
        disabled={forceFace}
        onCheckedChange={(v) => onCommit({ isWorldOriented: v })}
      />
      <FieldCheckbox
        label="No Depth Test"
        checked={properties.noDepthTest}
        onCheckedChange={(v) => onCommit({ noDepthTest: v })}
      />
      <FieldCheckbox
        label="Affected by Wind"
        checked={properties.affectedByWind}
        onCheckedChange={(v) => onCommit({ affectedByWind: v })}
      />
    </div>
  );
}

// ─── Physics tab ────────────────────────────────────────────────────

// Exported for direct testing — matches the AppearanceTab pattern.
// Radix Tabs in jsdom doesn't reliably switch via fireEvent (known
// pointer-event flake from Fix dispatch 1), so vitest mounts
// PhysicsTab directly.
//
// Cascade rules (cross-referenced against
// [src/UI/Emitter.cpp:175-190]):
//   - `isWeatherParticle === true` disables the entire
//     position/speed/acceleration/ground-interaction block
//     (acceleration X/Y/Z, gravity, inwardSpeed, inwardAcceleration,
//     objectSpaceAcceleration, bounciness, groundBehavior,
//     emitFromMesh, emitFromMeshOffset, and the position/speed
//     random-param groups). Conversely, `isWeatherParticle === false`
//     disables the 3 weather fields.
//   - `emitFromMesh === EMIT_DISABLE` (==0) disables
//     `emitFromMeshOffset`.
//   - `groundBehavior !== Bounce` (!= 2) disables `bounciness`
//     ([src/UI/Emitter.cpp:190]).
export function PhysicsTab({
  properties,
  onCommit,
}: {
  properties: EmitterPropertiesDto;
  onCommit: (patch: Partial<EmitterPropertiesDto>) => void;
}) {
  const isWeather = properties.isWeatherParticle;
  const nonWeather = !isWeather;
  const offsetEnabled = nonWeather && properties.emitFromMesh !== EMIT_FROM_MESH_DISABLE;
  const bouncinessEnabled = nonWeather && properties.groundBehavior === GROUND_BEHAVIOR_BOUNCE;

  const updateAcceleration = (idx: 0 | 1 | 2, v: number) => {
    const next: [number, number, number] = [
      properties.acceleration[0],
      properties.acceleration[1],
      properties.acceleration[2],
    ];
    next[idx] = v;
    onCommit({ acceleration: next as unknown as Vec3 });
  };

  const updateGroup = (idx: number, patch: Partial<GroupDto>) => {
    const next = properties.groups.map((g, i) => (i === idx ? { ...g, ...patch } : g));
    onCommit({ groups: next });
  };

  return (
    <div className="space-y-3">
      {/* Acceleration X/Y/Z — 3-spinner cluster. Spans the .form-row
          input + unit columns since 3 spinners don't fit in 92px. */}
      <div className="form-row items-start">
        <span className="lbl pt-1">Acceleration</span>
        <div
          className="grid grid-cols-3 gap-1"
          style={{ gridColumn: "2 / span 2" }}
        >
          <Spinner
            value={properties.acceleration[0]}
            step={0.1}
            disabled={!nonWeather}
            onChange={(v) => updateAcceleration(0, v)}
            aria-label="Acceleration X"
          />
          <Spinner
            value={properties.acceleration[1]}
            step={0.1}
            disabled={!nonWeather}
            onChange={(v) => updateAcceleration(1, v)}
            aria-label="Acceleration Y"
          />
          <Spinner
            value={properties.acceleration[2]}
            step={0.1}
            disabled={!nonWeather}
            onChange={(v) => updateAcceleration(2, v)}
            aria-label="Acceleration Z"
          />
        </div>
      </div>
      <FieldSpinner
        label="Gravity"
        value={properties.gravity}
        step={0.1}
        disabled={!nonWeather}
        onCommit={(v) => onCommit({ gravity: v })}
      />
      <FieldSpinner
        label="Inward Speed"
        value={properties.inwardSpeed}
        step={0.1}
        disabled={!nonWeather}
        onCommit={(v) => onCommit({ inwardSpeed: v })}
      />
      <FieldSpinner
        label="Inward Acceleration"
        value={properties.inwardAcceleration}
        step={0.1}
        disabled={!nonWeather}
        onCommit={(v) => onCommit({ inwardAcceleration: v })}
      />
      <FieldCheckbox
        label="Object Space Acceleration"
        checked={properties.objectSpaceAcceleration}
        disabled={!nonWeather}
        onCheckedChange={(v) => onCommit({ objectSpaceAcceleration: v })}
      />
      <FieldSpinner
        label="Bounciness"
        value={properties.bounciness}
        min={0}
        max={1}
        step={0.05}
        disabled={!bouncinessEnabled}
        onCommit={(v) => onCommit({ bounciness: v })}
      />
      <FieldSelect
        label="Ground Behavior"
        value={properties.groundBehavior}
        options={GROUND_BEHAVIOR_OPTIONS}
        disabled={!nonWeather}
        onCommit={(v) => onCommit({ groundBehavior: v })}
        testId="physics-ground-behavior-trigger"
      />
      <FieldSelect
        label="Emit From Mesh"
        value={properties.emitFromMesh}
        options={EMIT_FROM_MESH_OPTIONS}
        disabled={!nonWeather}
        onCommit={(v) => onCommit({ emitFromMesh: v })}
        testId="physics-emit-from-mesh-trigger"
      />
      <FieldSpinner
        label="Emit From Mesh Offset"
        value={properties.emitFromMeshOffset}
        step={0.1}
        disabled={!offsetEnabled}
        onCommit={(v) => onCommit({ emitFromMeshOffset: v })}
      />
      <FieldCheckbox
        label="Weather Particle"
        checked={properties.isWeatherParticle}
        onCheckedChange={(v) => onCommit({ isWeatherParticle: v })}
      />
      <FieldSpinner
        label="Weather Cube Size"
        value={properties.weatherCubeSize}
        min={0}
        step={0.1}
        disabled={!isWeather}
        onCommit={(v) => onCommit({ weatherCubeSize: v })}
      />
      <FieldSpinner
        label="Weather Cube Distance"
        value={properties.weatherCubeDistance}
        min={0}
        step={0.1}
        disabled={!isWeather}
        onCommit={(v) => onCommit({ weatherCubeDistance: v })}
      />
      <FieldSpinner
        label="Weather Fadeout Distance"
        value={properties.weatherFadeoutDistance}
        min={0}
        step={0.1}
        disabled={!isWeather}
        onCommit={(v) => onCommit({ weatherFadeoutDistance: v })}
      />

      {/* Random Param groups — inline at the bottom of the Physics tab.
          Legacy ([src/UI/Emitter.cpp:849-852]) renders only POSITION
          (groups[2]) + SPEED (groups[0]); we surface all three since
          they're on the wire. The `RandomParam` Win32 primitive from
          [src/UI/RandomParam.cpp] doesn't map 1:1 to this layout (it
          drives a single value with min/max/mode), so the per-type
          conditional fields are inlined here rather than wrapped in a
          shared primitive. */}
      {properties.groups.map((g, i) => (
        <GroupSection
          key={i}
          index={i}
          group={g}
          onChange={(patch) => updateGroup(i, patch)}
        />
      ))}
    </div>
  );
}

function GroupSection({
  index,
  group,
  onChange,
}: {
  index: number;
  group: GroupDto;
  onChange: (patch: Partial<GroupDto>) => void;
}) {
  const label = GROUP_LABELS[index] ?? `Group ${index + 1}`;
  const updateVec3 = (
    key: "min" | "max" | "val",
    axis: 0 | 1 | 2,
    v: number,
  ) => {
    const cur = group[key];
    const next: [number, number, number] = [cur[0], cur[1], cur[2]];
    next[axis] = v;
    onChange({ [key]: next as unknown as Vec3 } as Partial<GroupDto>);
  };

  return (
    <fieldset
      data-testid={`physics-group-${index}`}
      className="space-y-2 rounded border border-border bg-bg-2/40 p-2"
    >
      <legend className="px-1 text-xs font-medium text-text-2">
        {label}
      </legend>
      <FieldSelect
        label="Type"
        value={group.type}
        options={GROUP_TYPE_OPTIONS}
        onCommit={(v) => onChange({ type: v })}
        testId={`physics-group-${index}-type-trigger`}
      />
      {group.type === GT_EXACT && (
        <Vec3Row
          label="Value"
          value={group.val}
          step={0.1}
          ariaPrefix={`Group ${index + 1} Value`}
          onChange={(axis, v) => updateVec3("val", axis, v)}
        />
      )}
      {group.type === GT_BOX && (
        <>
          <Vec3Row
            label="Min"
            value={group.min}
            step={0.1}
            ariaPrefix={`Group ${index + 1} Min`}
            onChange={(axis, v) => updateVec3("min", axis, v)}
          />
          <Vec3Row
            label="Max"
            value={group.max}
            step={0.1}
            ariaPrefix={`Group ${index + 1} Max`}
            onChange={(axis, v) => updateVec3("max", axis, v)}
          />
        </>
      )}
      {group.type === GT_CUBE && (
        <FieldSpinner
          label="Side Length"
          value={group.sideLength}
          min={0}
          step={0.1}
          onCommit={(v) => onChange({ sideLength: v })}
        />
      )}
      {group.type === GT_SPHERE && (
        <>
          <FieldSpinner
            label="Sphere Radius"
            value={group.sphereRadius}
            min={0}
            step={0.1}
            onCommit={(v) => onChange({ sphereRadius: v })}
          />
          <FieldSpinner
            label="Sphere Edge"
            value={group.sphereEdge}
            min={0}
            step={1}
            decimals={0}
            onCommit={(v) => onChange({ sphereEdge: Math.max(0, Math.round(v)) })}
          />
        </>
      )}
      {group.type === GT_CYLINDER && (
        <>
          <FieldSpinner
            label="Cylinder Radius"
            value={group.cylinderRadius}
            min={0}
            step={0.1}
            onCommit={(v) => onChange({ cylinderRadius: v })}
          />
          <FieldSpinner
            label="Cylinder Edge"
            value={group.cylinderEdge}
            min={0}
            step={1}
            decimals={0}
            onCommit={(v) => onChange({ cylinderEdge: Math.max(0, Math.round(v)) })}
          />
          <FieldSpinner
            label="Cylinder Height"
            value={group.cylinderHeight}
            min={0}
            step={0.1}
            onCommit={(v) => onChange({ cylinderHeight: v })}
          />
        </>
      )}
    </fieldset>
  );
}

function Vec3Row({
  label,
  value,
  step,
  ariaPrefix,
  onChange,
}: {
  label: string;
  value: Vec3;
  step: number;
  ariaPrefix: string;
  onChange: (axis: 0 | 1 | 2, v: number) => void;
}) {
  return (
    <div className="form-row items-start">
      <span className="lbl pt-1">{label}</span>
      <div
        className="grid grid-cols-3 gap-1"
        style={{ gridColumn: "2 / span 2" }}
      >
        <Spinner
          value={value[0]}
          step={step}
          onChange={(v) => onChange(0, v)}
          aria-label={`${ariaPrefix} X`}
        />
        <Spinner
          value={value[1]}
          step={step}
          onChange={(v) => onChange(1, v)}
          aria-label={`${ariaPrefix} Y`}
        />
        <Spinner
          value={value[2]}
          step={step}
          onChange={(v) => onChange(2, v)}
          aria-label={`${ariaPrefix} Z`}
        />
      </div>
    </div>
  );
}
