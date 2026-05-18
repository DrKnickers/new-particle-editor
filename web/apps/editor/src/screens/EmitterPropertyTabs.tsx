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
  Vec4,
} from "@particle-editor/bridge-schema";
import { Spinner } from "@/primitives/Spinner";

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
        className="flex h-full items-center justify-center p-4 text-center text-xs text-neutral-500"
      >
        Select an emitter to edit its properties
      </div>
    );
  }
  if (properties === null) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-neutral-500">
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
        className="flex shrink-0 border-b border-neutral-800 bg-neutral-950"
        aria-label="Emitter property tabs"
      >
        <TabTrigger value="basic" label="Basic" />
        <TabTrigger value="appearance" label="Appearance" />
        <TabTrigger value="physics" label="Physics" />
      </Tabs.List>
      <Tabs.Content
        value="basic"
        className="flex-1 min-h-0 overflow-y-auto p-3 outline-none"
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
        <ComingSoon
          dispatch={3}
          fields="acceleration, gravity, inward speed, bounciness, ground behaviour, weather particle, random param groups."
        />
      </Tabs.Content>
    </Tabs.Root>
  );
}

function TabTrigger({ value, label }: { value: string; label: string }) {
  return (
    <Tabs.Trigger
      value={value}
      data-testid={`tab-trigger-${value}`}
      className="flex-1 cursor-pointer border-b-2 border-transparent px-3 py-2 text-xs text-neutral-400 outline-none transition data-[state=active]:border-sky-500 data-[state=active]:text-neutral-100 hover:text-neutral-200 focus-visible:bg-neutral-900"
    >
      {label}
    </Tabs.Trigger>
  );
}

function ComingSoon({
  dispatch,
  fields,
}: {
  dispatch: number;
  fields: string;
}) {
  return (
    <div
      data-testid={`tab-coming-soon-${dispatch}`}
      className="space-y-2 text-xs text-neutral-500"
    >
      <p className="text-neutral-300">
        Coming in Fix dispatch {dispatch}.
      </p>
      <p>{fields}</p>
    </div>
  );
}

// ─── Basic tab ──────────────────────────────────────────────────────

function BasicTab({
  properties,
  onCommit,
}: {
  properties: EmitterPropertiesDto;
  onCommit: (patch: Partial<EmitterPropertiesDto>) => void;
}) {
  // Mutex enabling per legacy: useBursts toggles between burst-mode
  // fields and rate-mode field.
  const burstsEnabled = properties.useBursts;
  const rateEnabled = !properties.useBursts;
  const rotationEnabled = properties.randomRotation;
  return (
    <div className="space-y-3">
      <FieldText
        label="Name"
        value={properties.name}
        onCommit={(v) => onCommit({ name: v })}
      />
      <FieldSpinner
        label="Lifetime"
        value={properties.lifetime}
        min={0}
        step={0.1}
        unit="s"
        onCommit={(v) => onCommit({ lifetime: v })}
      />
      <FieldSpinner
        label="Initial Delay"
        value={properties.initialDelay}
        min={0}
        step={0.1}
        unit="s"
        onCommit={(v) => onCommit({ initialDelay: v })}
      />
      <FieldCheckbox
        label="Use Bursts"
        checked={properties.useBursts}
        onCheckedChange={(v) => onCommit({ useBursts: v })}
      />
      <FieldSpinner
        label="Bursts"
        value={properties.nBursts}
        min={1}
        step={1}
        decimals={0}
        disabled={!burstsEnabled}
        onCommit={(v) => onCommit({ nBursts: Math.round(v) })}
      />
      <FieldSpinner
        label="Burst Delay"
        value={properties.burstDelay}
        min={0}
        step={0.1}
        unit="s"
        disabled={!burstsEnabled}
        onCommit={(v) => onCommit({ burstDelay: v })}
      />
      <FieldSpinner
        label="Particles / Burst"
        value={properties.nParticlesPerBurst}
        min={1}
        step={1}
        decimals={0}
        disabled={!burstsEnabled}
        onCommit={(v) => onCommit({ nParticlesPerBurst: Math.round(v) })}
      />
      <FieldSpinner
        label="Particles / Second"
        value={properties.nParticlesPerSecond}
        min={0}
        step={1}
        decimals={0}
        disabled={!rateEnabled}
        onCommit={(v) => onCommit({ nParticlesPerSecond: Math.round(v) })}
      />
      <FieldSpinner
        label="Random Lifetime"
        value={properties.randomLifetimePerc}
        min={0}
        max={100}
        step={1}
        unit="%"
        onCommit={(v) => onCommit({ randomLifetimePerc: v })}
      />
      <FieldSpinner
        label="Random Scale"
        value={properties.randomScalePerc}
        min={0}
        max={100}
        step={1}
        unit="%"
        onCommit={(v) => onCommit({ randomScalePerc: v })}
      />
      <FieldCheckbox
        label="Random Rotation"
        checked={properties.randomRotation}
        onCheckedChange={(v) => onCommit({ randomRotation: v })}
      />
      <FieldCheckbox
        label="Random Rotation Direction"
        checked={properties.randomRotationDirection}
        disabled={!rotationEnabled}
        onCheckedChange={(v) => onCommit({ randomRotationDirection: v })}
      />
      <FieldSpinner
        label="Rotation Average"
        value={properties.randomRotationAverage}
        step={0.1}
        disabled={!rotationEnabled}
        onCommit={(v) => onCommit({ randomRotationAverage: v })}
      />
      <FieldSpinner
        label="Rotation Variance"
        value={properties.randomRotationVariance}
        step={0.1}
        disabled={!rotationEnabled}
        onCommit={(v) => onCommit({ randomRotationVariance: v })}
      />
      <FieldSpinner
        label="Freeze Time"
        value={properties.freezeTime}
        min={0}
        step={0.1}
        unit="s"
        onCommit={(v) => onCommit({ freezeTime: v })}
      />
      <FieldSpinner
        label="Skip Time"
        value={properties.skipTime}
        min={0}
        step={0.1}
        unit="s"
        onCommit={(v) => onCommit({ skipTime: v })}
      />
      <FieldCheckbox
        label="Link to System"
        checked={properties.linkToSystem}
        onCheckedChange={(v) => onCommit({ linkToSystem: v })}
      />
      <FieldSpinner
        label="Parent Link Strength"
        value={properties.parentLinkStrength}
        min={0}
        step={0.01}
        onCommit={(v) => onCommit({ parentLinkStrength: v })}
      />
      <FieldSpinner
        label="Index"
        value={properties.index}
        min={0}
        step={1}
        decimals={0}
        onCommit={(v) => onCommit({ index: Math.round(v) })}
      />
    </div>
  );
}

// ─── Field row primitives ──────────────────────────────────────────

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1fr,1.4fr] items-center gap-2">
      <label className="text-xs text-neutral-400">{label}</label>
      <div>{children}</div>
    </div>
  );
}

function FieldText({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
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
  return (
    <FieldRow label={label}>
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
        className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-200 outline-none transition focus:border-sky-500"
        style={{ height: "26px" }}
        aria-label={label}
        spellCheck={false}
        autoComplete="off"
      />
    </FieldRow>
  );
}

function FieldSpinner({
  label,
  value,
  min,
  max,
  step,
  decimals,
  unit,
  disabled,
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
  onCommit: (value: number) => void;
}) {
  return (
    <FieldRow label={label}>
      <Spinner
        value={value}
        onChange={onCommit}
        min={min}
        max={max}
        step={step}
        decimals={decimals}
        unit={unit}
        disabled={disabled}
        aria-label={label}
      />
    </FieldRow>
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
    <FieldRow label={label}>
      <Checkbox.Root
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className={`flex h-[18px] w-[18px] items-center justify-center rounded border border-neutral-700 bg-neutral-900 outline-none transition focus-visible:border-sky-500 ${
          disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:border-neutral-500"
        } data-[state=checked]:border-sky-500 data-[state=checked]:bg-sky-700`}
        aria-label={label}
      >
        <Checkbox.Indicator>
          <Check size={12} className="text-neutral-100" />
        </Checkbox.Indicator>
      </Checkbox.Root>
    </FieldRow>
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
    <FieldRow label={label}>
      <Select.Root
        value={String(value)}
        onValueChange={(v) => onCommit(Number(v))}
        disabled={disabled}
      >
        <Select.Trigger
          data-testid={testId}
          aria-label={label}
          className="flex h-[26px] w-full items-center justify-between gap-1 rounded border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-200 outline-none transition hover:border-neutral-500 focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Select.Value>{selected?.label ?? ""}</Select.Value>
          <Select.Icon>
            <ChevronDown className="size-3 text-neutral-500" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            position="popper"
            sideOffset={4}
            className="z-50 min-w-[160px] rounded-md border border-neutral-700 bg-neutral-900 p-1 shadow-xl"
          >
            <Select.Viewport>
              {options.map((opt) => (
                <Select.Item
                  key={opt.value}
                  value={String(opt.value)}
                  data-testid={
                    testId ? `${testId}-option-${opt.value}` : undefined
                  }
                  className="cursor-pointer rounded px-2 py-0.5 text-xs text-neutral-200 outline-none data-[highlighted]:bg-sky-700/40 data-[highlighted]:text-sky-100"
                >
                  <Select.ItemText>{opt.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </FieldRow>
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
      <div className="grid grid-cols-[1fr,1.4fr] items-start gap-2">
        <label className="pt-1 text-xs text-neutral-400">Random Colours</label>
        <div className="grid grid-cols-2 gap-1">
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
