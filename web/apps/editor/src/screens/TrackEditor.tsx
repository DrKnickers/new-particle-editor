// TrackEditor — shell around the curve canvas.
//
// Phase 3 Screen 6 Batch A landed the read-only shell. Screen 5 /
// Screen 6 Batch B-α adds:
//   - Functional Linear / Smooth / Step interpolation toggle (fires
//     `emitters/set-track-interpolation`).
//   - Functional Delete button (filters border keys + fires
//     `emitters/delete-track-keys`).
//   - Selection state is owned here (lives close to the active-track
//     dropdown so it can be cleared on track-switch in one place).
//     Identified by key TIME — see CurveEditor for the rationale.
//
// Active track + selection state stay local React state, not Zustand:
// they're per-mount, short-lived, and only matter to this panel.
// Switching the active track clears `selectedKeyTimes` so the
// selection doesn't bleed across tracks.
//
// Visual-only / still deferred to Batch B (the second half of curve
// interaction): drag-to-move, click-to-add, Select/Insert mode toggle,
// Spinner sync, lock-to functional behaviour, border-key visual
// differentiation, Shift+click range selection.

import { useCallback, useEffect, useMemo, useState } from "react";
import * as Select from "@radix-ui/react-select";
import { ChevronDown } from "lucide-react";
import type {
  Bridge,
  InterpolationType,
  TrackDto,
  TrackName,
} from "@particle-editor/bridge-schema";
import { TRACK_NAMES } from "@particle-editor/bridge-schema";
import { CurveEditor } from "./CurveEditor";

type Props = {
  /** 7 tracks in `TRACK_NAMES` order (the wire contract). Passed in
   *  by EmitterPropertyPanel after `emitters/get-tracks` resolves. */
  tracks: TrackDto[];
  /** Bridge for mutation calls (interpolation toggle, delete keys).
   *  Optional so existing tests that don't exercise mutations don't
   *  need to construct a stub bridge. */
  bridge?: Bridge;
  /** The emitter id whose tracks are being edited. Required for the
   *  bridge mutation calls; tests pass 0 / a fixture id. */
  emitterId?: number;
  /** Imperative-style registration hook so the parent panel can wire
   *  the Delete key to this component's deleteSelected handler
   *  without a ref dance. Called once per mount and again on any
   *  active-track / selection change so the parent always points at
   *  a fresh closure. */
  registerDeleteHandler?: (handler: (() => void) | null) => void;
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

const INTERP_KINDS: readonly InterpolationType[] = Object.freeze([
  "linear", "smooth", "step",
]);

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

export function TrackEditor({ tracks, bridge, emitterId, registerDeleteHandler }: Props) {
  const [activeTrack, setActiveTrack] = useState<TrackName>("red");
  // Lock-to combo's local-only state. No rendering effect this batch.
  const [lockTo, setLockTo] = useState<string>("None");
  // Selection state — keyed by key TIME (not array index) so it
  // survives future drag-to-move mutations that re-order the
  // multiset. Cleared on active-track switch.
  const [selectedKeyTimes, setSelectedKeyTimes] = useState<Set<number>>(
    () => new Set(),
  );

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

  // Border keys = first + last in time order. The wire contract is
  // keys-ascending-by-time, so we read indices 0 and length-1
  // directly. The React side filters these out before calling
  // delete-track-keys for a clean user experience; the host enforces
  // the same rule as the source of truth.
  const borderKeyTimes = useMemo<ReadonlySet<number>>(() => {
    if (current.keys.length === 0) return new Set();
    const first = current.keys[0]!.time;
    const last = current.keys[current.keys.length - 1]!.time;
    return new Set<number>([first, last]);
  }, [current.keys]);

  // Reset lock-to + selection when the active track changes — the
  // previously-selected option may not exist on the new track, and
  // the selection is per-track conceptually.
  const handleTrackChange = (next: TrackName) => {
    setActiveTrack(next);
    setLockTo("None");
    setSelectedKeyTimes(new Set());
  };

  // Click handler routed from CurveEditor. Plain click → replace
  // selection with the clicked key. Ctrl/Cmd+click → toggle. Shift+
  // click range selection is deferred to Batch B (single + toggle
  // suffices for delete-focused workflow).
  const handleKeyClick = useCallback(
    (time: number, event: React.MouseEvent) => {
      const additive = event.ctrlKey || event.metaKey;
      setSelectedKeyTimes((prev) => {
        if (additive) {
          const next = new Set(prev);
          if (next.has(time)) next.delete(time);
          else next.add(time);
          return next;
        }
        return new Set([time]);
      });
    },
    [],
  );

  const handleCanvasClick = useCallback(() => {
    setSelectedKeyTimes((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  // Delete handler — filters border keys + fires the bridge call.
  // The host re-applies the border-key filter as the source of
  // truth; this React-side filter is a cleanliness measure so we
  // never send a doomed call. Bridge may be undefined in tests that
  // don't exercise mutations; degrade to a no-op.
  const handleDelete = useCallback(() => {
    if (bridge === undefined || emitterId === undefined) return;
    const candidates: number[] = [];
    for (const t of selectedKeyTimes) {
      if (!borderKeyTimes.has(t)) candidates.push(t);
    }
    if (candidates.length === 0) return;
    void bridge
      .request({
        kind: "emitters/delete-track-keys",
        params: { id: emitterId, track: activeTrack, times: candidates },
      })
      .then(() => {
        setSelectedKeyTimes(new Set());
      })
      .catch(() => {
        // Silent — the panel will re-fetch on the next tree/changed
        // anyway. No user-visible error surface this batch.
      });
  }, [bridge, emitterId, activeTrack, selectedKeyTimes, borderKeyTimes]);

  // Interpolation toggle handler — flips the active track's
  // interpolation type via a bridge call. The optimistic visual
  // (active button) flips immediately because the parent's
  // `tracks` prop won't reflect the new interpolation until the
  // tree/changed re-fetch lands. We rely on that re-fetch rather
  // than maintaining a local override.
  const handleInterpolationClick = useCallback(
    (kind: InterpolationType) => {
      if (bridge === undefined || emitterId === undefined) return;
      if (current.interpolation === kind) return;
      void bridge.request({
        kind: "emitters/set-track-interpolation",
        params: { id: emitterId, track: activeTrack, interpolation: kind },
      }).catch(() => { /* silent — see handleDelete */ });
    },
    [bridge, emitterId, activeTrack, current.interpolation],
  );

  // Expose deleteSelected upward so the parent panel can wire the
  // Delete keyboard shortcut at the panel level without a ref dance.
  // We re-register on every relevant change so the closure the
  // parent calls is always fresh.
  useEffect(() => {
    if (registerDeleteHandler === undefined) return;
    registerDeleteHandler(handleDelete);
    return () => { registerDeleteHandler(null); };
  }, [registerDeleteHandler, handleDelete]);

  // Disabled flags driving the toolbar UI. Delete is disabled when
  // there's nothing non-border in the current selection; the
  // interpolation buttons stay enabled even when bridge/emitterId
  // are absent (TS-only tests render without them and we still want
  // the visual surface).
  const deletableCount = useMemo(() => {
    let n = 0;
    for (const t of selectedKeyTimes) if (!borderKeyTimes.has(t)) n++;
    return n;
  }, [selectedKeyTimes, borderKeyTimes]);
  const deleteDisabled =
    bridge === undefined || emitterId === undefined || deletableCount === 0;

  return (
    <div
      data-testid="track-editor"
      data-active-track={activeTrack}
      data-selected-key-count={selectedKeyTimes.size}
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

        {/* Interpolation picker — functional in Batch B-α. The active
            button reflects the current track's interpolation; clicking
            a non-active button fires the bridge mutation. */}
        {INTERP_KINDS.map((kind) => {
          const isActive = current.interpolation === kind;
          const disabled = bridge === undefined || emitterId === undefined;
          return (
            <button
              key={kind}
              type="button"
              disabled={disabled}
              aria-label={`Interpolation ${kind}`}
              aria-pressed={isActive}
              data-state={isActive ? "on" : "off"}
              data-testid={`track-interp-${kind}`}
              onClick={() => handleInterpolationClick(kind)}
              className={
                isActive
                  ? "h-7 rounded border border-sky-500 bg-sky-900/40 px-2 text-xs font-semibold text-sky-200"
                  : "h-7 rounded border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-300 hover:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-40"
              }
            >
              {kind[0]!.toUpperCase() + kind.slice(1)}
            </button>
          );
        })}

        <span className="mx-1 h-5 w-px bg-neutral-800" aria-hidden />

        <button
          type="button"
          disabled={deleteDisabled}
          aria-label="Delete key"
          data-testid="track-action-delete"
          onClick={handleDelete}
          title={deleteDisabled ? "Select a non-border key first" : "Delete selected key(s)"}
          className={
            deleteDisabled
              ? "h-7 rounded border border-neutral-800 bg-neutral-900/60 px-2 text-xs text-neutral-500"
              : "h-7 rounded border border-rose-700 bg-rose-900/30 px-2 text-xs text-rose-200 hover:border-rose-500"
          }
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
        <CurveEditor
          track={current}
          valueRange={valueRange}
          selectedKeyTimes={selectedKeyTimes}
          onKeyClick={handleKeyClick}
          onCanvasClick={handleCanvasClick}
        />
      </div>
    </div>
  );
}
