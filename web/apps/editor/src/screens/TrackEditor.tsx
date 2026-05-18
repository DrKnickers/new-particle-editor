// TrackEditor — shell around the curve canvas (Phase 3 Screen 6
// Batch A: foundation, read-only).
//
// Layout (top-down):
//   1. Toolbar row: 7 track-toggle buttons (one active) + Select /
//      Insert mode toggles + Linear / Smooth / Step interpolation
//      picker + Delete action.
//   2. Lock-to combo (Radix Select): per-track option list mirroring
//      the legacy table at [src/UI/TrackEditor.cpp:90-98].
//   3. Main area: <CurveEditor> for the active track.
//
// Interaction status in Batch A:
//   - Track-toggle buttons ARE clickable (they change the local
//     active-track state and re-render the canvas with the chosen
//     track's data).
//   - All other buttons (Select / Insert / Linear / Smooth / Step /
//     Delete) render disabled with `title="Batch B"` tooltips. The
//     visual surface lands now so the right shell ships; behaviour
//     wiring is Batch B (= Screen 5 work).
//   - The lock-to combo accepts user selection but has NO rendering
//     effect — the legacy value-relative-to-another-track semantics
//     are non-trivial enough to defer to Batch B alongside the
//     value-axis projection it would need.
//
// Active track state lives in local React state (component-local,
// short-lived, per-component). Default is "red" to match the legacy
// TrackEditor's first-tab default.

import { useMemo, useState } from "react";
import * as Select from "@radix-ui/react-select";
import { ChevronDown } from "lucide-react";
import type { TrackDto, TrackName } from "@particle-editor/bridge-schema";
import { TRACK_NAMES } from "@particle-editor/bridge-schema";
import { CurveEditor } from "./CurveEditor";

type Props = {
  /** 7 tracks in `TRACK_NAMES` order (the wire contract). Passed in
   *  by EmitterPropertyPanel after `emitters/get-tracks` resolves. */
  tracks: TrackDto[];
};

/** Pretty label for each track. Mirrors the legacy `IDS_LABEL_TRACK_*`
 *  resource strings so the UI reads the same as `--legacy-ui`. */
const TRACK_LABELS: Record<TrackName, string> = {
  red:           "Red",
  green:         "Green",
  blue:          "Blue",
  alpha:         "Alpha",
  scale:         "Scale",
  index:         "Index",
  rotationSpeed: "Rotation",
};

/** Single-letter glyph for the toolbar's 7 track-toggle buttons.
 *  Uses the same first letter as the legacy abbreviated form except
 *  Rotation (last track) which uses "Ω" so it doesn't collide with
 *  Red. */
const TRACK_GLYPH: Record<TrackName, string> = {
  red:           "R",
  green:         "G",
  blue:          "B",
  alpha:         "A",
  scale:         "S",
  index:         "I",
  rotationSpeed: "Ω",
};

/** Lock-to combo options per track. Mirrors the legacy table at
 *  [src/UI/TrackEditor.cpp:90-98]. The leading "None" option is
 *  always present; the disabled-state for "only None" is computed at
 *  render time. */
const LOCK_TO_OPTIONS: Record<TrackName, readonly string[]> = {
  red:           ["None"],
  green:         ["None", "Red"],
  blue:          ["None", "Red", "Green"],
  alpha:         ["None", "Red", "Green", "Blue"],
  scale:         ["None"],
  index:         ["None"],
  rotationSpeed: ["None"],
};

/** Per-track value range. Locked to [0, 1] for colour channels; auto-
 *  ranges for Scale / Index off the keys with a 1.2× headroom; auto-
 *  ranges symmetrically around 0 for RotationSpeed. Mirrors the
 *  legacy `CurveEditor_SetVertRange` calls at
 *  [src/UI/TrackEditor.cpp:60-82] but with concrete clamps instead of
 *  FLT_MAX since SVG can't render an infinite range. */
function valueRangeForTrack(track: TrackDto): { min: number; max: number } {
  switch (track.name) {
    case "red":
    case "green":
    case "blue":
    case "alpha":
      return { min: 0, max: 1 };
    case "scale":
    case "index": {
      let max = 0;
      for (const k of track.keys) {
        if (k.value > max) max = k.value;
      }
      // 1.2× headroom so the topmost key isn't flush against the
      // upper border; minimum display max of 100 so a flat-zero track
      // still has a sensible scale.
      return { min: 0, max: Math.max(max * 1.2, 100) };
    }
    case "rotationSpeed": {
      let mag = 0;
      for (const k of track.keys) {
        const m = Math.abs(k.value);
        if (m > mag) mag = m;
      }
      const bound = Math.max(mag * 1.2, 1);
      return { min: -bound, max: bound };
    }
  }
}

export function TrackEditor({ tracks }: Props) {
  const [activeTrack, setActiveTrack] = useState<TrackName>("red");
  // Lock-to combo's local-only state. No rendering effect this batch.
  const [lockTo, setLockTo] = useState<string>("None");

  const current = useMemo<TrackDto>(() => {
    const found = tracks.find((t) => t.name === activeTrack);
    // Guard: if the wire response was malformed (wrong order), fall
    // back to the index-by-name from TRACK_NAMES. Shouldn't happen
    // given the contract — the host emits 7 entries in fixed order —
    // but a defensive fallback keeps the panel rendering instead of
    // crashing.
    if (found) return found;
    const idx = TRACK_NAMES.indexOf(activeTrack);
    return tracks[idx] ?? {
      name: activeTrack,
      keys: [],
      interpolation: "linear",
    };
  }, [tracks, activeTrack]);

  const valueRange = useMemo(() => valueRangeForTrack(current), [current]);

  const lockToOptions = LOCK_TO_OPTIONS[activeTrack];
  const lockToDisabled = lockToOptions.length <= 1;

  // Reset lock-to to "None" when the active track changes (the
  // previously-selected option may not exist on the new track). The
  // local-state reset is structural; the combo has no rendering
  // effect this batch.
  const handleTrackChange = (next: TrackName) => {
    setActiveTrack(next);
    setLockTo("None");
  };

  return (
    <div
      data-testid="track-editor"
      data-active-track={activeTrack}
      className="flex h-full w-full flex-col gap-2 text-sm"
    >
      {/* Toolbar row */}
      <div
        data-testid="track-editor-toolbar"
        className="flex flex-wrap items-center gap-1 border-b border-neutral-800 pb-2"
      >
        {/* 7 track-toggle buttons. Active one carries the focused
            border + sky tint; clicking switches the active track. */}
        <div role="radiogroup" aria-label="Active track" className="flex gap-0.5">
          {TRACK_NAMES.map((name) => {
            const isActive = name === activeTrack;
            return (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={isActive}
                aria-label={TRACK_LABELS[name]}
                data-testid={`track-toggle-${name}`}
                data-active={isActive ? "true" : "false"}
                onClick={() => handleTrackChange(name)}
                className={
                  isActive
                    ? "h-7 w-7 rounded border border-sky-500 bg-sky-900/40 text-xs font-semibold text-sky-200"
                    : "h-7 w-7 rounded border border-neutral-700 bg-neutral-900 text-xs text-neutral-300 hover:border-neutral-500"
                }
                title={TRACK_LABELS[name]}
              >
                {TRACK_GLYPH[name]}
              </button>
            );
          })}
        </div>

        {/* Separator */}
        <span className="mx-1 h-5 w-px bg-neutral-800" aria-hidden />

        {/* Select / Insert mode toggles — visual only, Batch B. */}
        <button
          type="button"
          disabled
          title="Batch B"
          aria-label="Select tool"
          data-testid="track-tool-select"
          className="h-7 rounded border border-neutral-800 bg-neutral-900/60 px-2 text-xs text-neutral-500"
        >
          Select
        </button>
        <button
          type="button"
          disabled
          title="Batch B"
          aria-label="Insert tool"
          data-testid="track-tool-insert"
          className="h-7 rounded border border-neutral-800 bg-neutral-900/60 px-2 text-xs text-neutral-500"
        >
          Insert
        </button>

        <span className="mx-1 h-5 w-px bg-neutral-800" aria-hidden />

        {/* Interpolation picker — three buttons; current track's
            interpolation reflected via aria-pressed but the buttons
            stay disabled until Batch B wires the mutation. */}
        {(["linear", "smooth", "step"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            disabled
            title="Batch B"
            aria-label={`Interpolation ${kind}`}
            aria-pressed={current.interpolation === kind}
            data-testid={`track-interp-${kind}`}
            className={
              current.interpolation === kind
                ? "h-7 rounded border border-neutral-700 bg-neutral-800 px-2 text-xs text-neutral-300"
                : "h-7 rounded border border-neutral-800 bg-neutral-900/60 px-2 text-xs text-neutral-500"
            }
          >
            {kind[0]!.toUpperCase() + kind.slice(1)}
          </button>
        ))}

        <span className="mx-1 h-5 w-px bg-neutral-800" aria-hidden />

        <button
          type="button"
          disabled
          title="Batch B"
          aria-label="Delete key"
          data-testid="track-action-delete"
          className="h-7 rounded border border-neutral-800 bg-neutral-900/60 px-2 text-xs text-neutral-500"
        >
          Delete
        </button>
      </div>

      {/* Lock-to row */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-neutral-400" htmlFor="track-lock-to">
          Lock to
        </label>
        <Select.Root
          value={lockTo}
          onValueChange={setLockTo}
          disabled={lockToDisabled}
        >
          <Select.Trigger
            id="track-lock-to"
            data-testid="track-lock-to-trigger"
            className="flex h-7 min-w-[120px] items-center justify-between gap-1 rounded border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-200 outline-none hover:border-neutral-500 focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Lock-to track"
          >
            <Select.Value />
            <Select.Icon>
              <ChevronDown className="size-3 text-neutral-500" />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content
              position="popper"
              sideOffset={4}
              className="z-50 min-w-[120px] rounded-md border border-neutral-700 bg-neutral-900 p-1 shadow-xl"
            >
              <Select.Viewport>
                {lockToOptions.map((opt) => (
                  <Select.Item
                    key={opt}
                    value={opt}
                    data-testid={`track-lock-to-option-${opt.toLowerCase()}`}
                    className="cursor-pointer rounded px-2 py-0.5 text-xs text-neutral-200 outline-none data-[highlighted]:bg-sky-700/40 data-[highlighted]:text-sky-100"
                  >
                    <Select.ItemText>{opt}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </div>

      {/* Canvas area — flex-1 so the SVG fills the remaining height. */}
      <div className="flex flex-1 min-h-0 items-stretch justify-stretch overflow-hidden rounded border border-neutral-800 bg-neutral-950">
        <CurveEditor track={current} valueRange={valueRange} />
      </div>
    </div>
  );
}
