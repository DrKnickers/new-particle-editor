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
import { Check } from "lucide-react";
import type {
  Bridge,
  EmitterPropertiesDto,
} from "@particle-editor/bridge-schema";
import { Spinner } from "@/primitives/Spinner";

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
        <ComingSoon
          dispatch={2}
          fields="colour texture, blend mode, random colours, hasTail, isHeatParticle, isWorldOriented, etc."
        />
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
