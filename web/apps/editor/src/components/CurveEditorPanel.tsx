// CurveEditorPanel — hybrid focus-channel curve editor.
//
// Task 2.6 set up the always-on bottom panel with a multi-channel
// overlay and per-channel visibility checkboxes. The hybrid focus-
// channel restoration adds the edit surface that Task 2.6 dropped:
//
//   - Clicking a channel ROW (not just the checkbox) sets that
//     channel as the EDIT FOCUS. The focus row gets a visual
//     indicator (bg-accent-soft + data-focus="true"). Clicking a
//     hidden channel's row turns it ON before focusing — focus
//     conceptually requires visibility.
//
//   - The multi-channel SVG renders the focus channel emphasised
//     (thick stroke, opaque, key circles) and the other visible
//     channels dimmed (opacity 0.4, no markers) as background
//     context. All key interactions (click select, drag-to-move,
//     marquee, Insert add, right-click) route to the focus channel.
//
//   - A .ce-toolbar row above the .ce-body hosts the edit
//     affordances: Select/Insert mode toggle, Linear/Smooth/Step
//     interpolation, Lock-to combo, Time/Value spinners for the
//     selected key.
//
//   - The panel hosts a window-scoped Delete keypress handler that
//     fires delete-track-keys on the focus channel's selected keys,
//     filtering out border keys + any presses inside a typing surface
//     (input / textarea / select).
//
// Focus state is SESSION-SCOPED — not persisted to localStorage.
// Selection (per focus channel) clears on focus change. Optimistic
// (time, value) override keeps spinners populated across the bridge
// round-trip (lessons.md L-006: sticky override; don't clear on
// every `tracks` refresh).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Select from "@radix-ui/react-select";
import { ChevronDown } from "lucide-react";
import type {
  Bridge,
  InterpolationType,
  TrackDto,
  TrackName,
} from "@particle-editor/bridge-schema";
import { CurveEditor, type ChannelDef } from "@/screens/CurveEditor";
import { Spinner } from "@/primitives/Spinner";

/** Channel registry. Order matches the design's left-column list. The
 *  `trackName` field bridges the UI-facing id (e.g. "rotation") to the
 *  wire-level TrackName (e.g. "rotationSpeed"). Colour tokens map to
 *  the editor's existing palette so themes track the rest of the UI:
 *    - Scale     → --warning  (amber)
 *    - Red       → --x-axis   (warm red)
 *    - Green     → --y-axis   (green)
 *    - Blue      → --z-axis   (blue)
 *    - Alpha     → --text-2   (neutral grey, distinguishable from RGB)
 *    - Rotation  → --accent   (sky blue accent)
 *    - Index     → --text-3   (darker grey, defaults off)
 */
export const CHANNELS: readonly ChannelDef[] = [
  { id: "scale",    label: "Scale",    color: "var(--warning)", defaultOn: true,  trackName: "scale" },
  { id: "red",      label: "Red",      color: "var(--x-axis)",  defaultOn: true,  trackName: "red" },
  { id: "green",    label: "Green",    color: "var(--y-axis)",  defaultOn: true,  trackName: "green" },
  { id: "blue",     label: "Blue",     color: "var(--z-axis)",  defaultOn: true,  trackName: "blue" },
  { id: "alpha",    label: "Alpha",    color: "var(--text-2)",  defaultOn: true,  trackName: "alpha" },
  { id: "rotation", label: "Rotation", color: "var(--accent)",  defaultOn: true,  trackName: "rotationSpeed" },
  { id: "index",    label: "Index",    color: "var(--text-3)",  defaultOn: false, trackName: "index" },
] as const;

const STORAGE_KEY = "alo:curve-channels";

/** DOM tag names that own their own keyboard handling. Delete events
 *  originating inside these MUST NOT be intercepted — typing Delete in
 *  a text field should delete a character, not a curve key. */
const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

const INTERP_KINDS: readonly InterpolationType[] = Object.freeze([
  "linear", "smooth", "step",
]);

/** Lock-to combo options per track. Mirrors the legacy table at
 *  [src/UI/TrackEditor.cpp:90-98]. The leading "None" option is
 *  always present; "only None" disables the combo. */
const LOCK_TO_OPTIONS: Record<TrackName, readonly string[]> = {
  red:           ["None"],
  green:         ["None", "Red"],
  blue:          ["None", "Red", "Green"],
  alpha:         ["None", "Red", "Green", "Blue"],
  scale:         ["None"],
  index:         ["None"],
  rotationSpeed: ["None"],
};

type EditMode = "select" | "insert";
type Props = { bridge: Bridge };

function defaultVisibility(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const c of CHANNELS) result[c.id] = c.defaultOn;
  return result;
}

function loadVisibility(): Record<string, boolean> {
  if (typeof localStorage === "undefined") return defaultVisibility();
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === null) return defaultVisibility();
  try {
    const parsed = JSON.parse(stored) as Record<string, boolean>;
    const merged = defaultVisibility();
    for (const c of CHANNELS) {
      if (typeof parsed[c.id] === "boolean") {
        merged[c.id] = parsed[c.id]!;
      }
    }
    return merged;
  } catch {
    return defaultVisibility();
  }
}

/** Per-track value range — same logic as MultiChannelCurves' internal
 *  helper. Duplicated here because spinner value-range clamping needs
 *  it at the panel level and the helper isn't exported. */
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

export function CurveEditorPanel({ bridge }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tracks, setTracks] = useState<TrackDto[] | null>(null);
  const [visible, setVisible] = useState<Record<string, boolean>>(loadVisibility);
  // Focus channel — session-scoped (not persisted). Defaults to
  // "scale" (first channel by display order).
  const [focusChannel, setFocusChannel] = useState<string>("scale");
  const [mode, setMode] = useState<EditMode>("select");
  // Selection state — keyed by key TIME (not array index). Per focus
  // channel; cleared on focus change.
  const [selectedKeyTimes, setSelectedKeyTimes] = useState<Set<number>>(
    () => new Set(),
  );
  // L-006 sticky optimistic override — see lessons.md.
  const [optimisticSelected, setOptimisticSelected] = useState<
    { time: number; value: number } | null
  >(null);
  const [keyContextMenu, setKeyContextMenu] = useState<
    { time: number; isBorder: boolean; x: number; y: number } | null
  >(null);
  const [lockTo, setLockTo] = useState<string>("None");

  // Track which id we last fetched for, so a late-arriving response
  // for a stale selection doesn't clobber current data.
  const inFlightFor = useRef<number | null>(null);

  // Persist visibility on every change. Focus channel is intentionally
  // NOT persisted — it's an ephemeral edit context.
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(visible));
    } catch {
      // Quota / disabled storage — silent.
    }
  }, [visible]);

  // Snapshot seed + live selection subscription.
  useEffect(() => {
    let cancelled = false;
    bridge
      .request({ kind: "engine/state/snapshot", params: {} })
      .then((snap) => {
        if (cancelled) return;
        setSelectedId(snap.selectedEmitterId);
      })
      .catch(() => { /* ignore — placeholder branch covers it */ });
    return () => { cancelled = true; };
  }, [bridge]);

  useEffect(() => {
    const off = bridge.on("emitters/selected", (e) => {
      setSelectedId(e.payload.id);
    });
    return off;
  }, [bridge]);

  // Track fetch + tree-mutation re-fetch. Stale-response guard via
  // inFlightFor matches the pattern from the deleted EmitterPropertyPanel.
  useEffect(() => {
    if (selectedId === null) {
      setTracks(null);
      inFlightFor.current = null;
      return;
    }
    let cancelled = false;
    const fetchTracks = (id: number) => {
      inFlightFor.current = id;
      bridge
        .request({ kind: "emitters/get-tracks", params: { id } })
        .then((res) => {
          if (cancelled) return;
          if (inFlightFor.current !== id) return;
          setTracks(res.tracks);
        })
        .catch(() => {
          if (cancelled) return;
          if (inFlightFor.current !== id) return;
          setTracks([]);
        });
    };
    fetchTracks(selectedId);
    const off = bridge.on("emitters/tree/changed", () => {
      if (selectedId !== null) fetchTracks(selectedId);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [bridge, selectedId]);

  // Resolve the focus channel's track + range.
  const focusedChannel = useMemo(
    () => CHANNELS.find((c) => c.id === focusChannel) ?? CHANNELS[0]!,
    [focusChannel],
  );
  const focusedTrack = useMemo<TrackDto | null>(() => {
    if (tracks === null) return null;
    return tracks.find((t) => t.name === focusedChannel.trackName) ?? null;
  }, [tracks, focusedChannel]);

  const focusedRange = useMemo(
    () => (focusedTrack === null
      ? { min: 0, max: 1 }
      : valueRangeForTrack(focusedTrack)),
    [focusedTrack],
  );

  // Border keys on the focus track (first + last in time order).
  const borderKeyTimes = useMemo<ReadonlySet<number>>(() => {
    if (focusedTrack === null || focusedTrack.keys.length === 0) return new Set();
    const ks = focusedTrack.keys;
    return new Set<number>([ks[0]!.time, ks[ks.length - 1]!.time]);
  }, [focusedTrack]);

  // Row-click handler: set focus + ensure visibility. Clears selection +
  // optimistic override when switching focus to a different channel.
  const handleRowClick = useCallback((id: string) => {
    setFocusChannel((prev) => {
      if (prev !== id) {
        setSelectedKeyTimes(new Set());
        setOptimisticSelected(null);
        setLockTo("None");
      }
      return id;
    });
    setVisible((v) => (v[id] ? v : { ...v, [id]: true }));
  }, []);

  // Auto-recover focus when the user hides the currently-focused
  // channel via its checkbox. Otherwise the focus layer would
  // disappear from the canvas (the focus channel filtered out of the
  // `layers` set in MultiChannelCurves) and the user would see no
  // interactive surface. Pick the first visible channel as the new
  // focus; if none are visible, leave focus where it is (the
  // placeholder branch covers it via the no-selection state, and
  // re-checking any channel restores focus).
  useEffect(() => {
    if (visible[focusChannel]) return;
    const nextVisible = CHANNELS.find((c) => visible[c.id]);
    if (nextVisible === undefined) return;
    setFocusChannel(nextVisible.id);
    setSelectedKeyTimes(new Set());
    setOptimisticSelected(null);
    setLockTo("None");
  }, [visible, focusChannel]);

  // ── Curve interactions ────────────────────────────────────────────

  const handleKeyClick = useCallback(
    (time: number, event: React.MouseEvent | React.PointerEvent) => {
      const additive = event.ctrlKey || event.metaKey;
      setOptimisticSelected(null);
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
    setOptimisticSelected(null);
    setSelectedKeyTimes((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  const handleCanvasMarqueeSelect = useCallback(
    (times: number[], shift: boolean) => {
      setOptimisticSelected(null);
      setSelectedKeyTimes((prev) => {
        if (shift) {
          if (times.length === 0) return prev;
          const next = new Set(prev);
          for (const t of times) next.add(t);
          return next;
        }
        return new Set(times);
      });
    },
    [],
  );

  const handleKeyDragEnd = useCallback(
    (keyTime: number, newTime: number, newValue: number) => {
      if (selectedId === null || focusedTrack === null) return;
      setSelectedKeyTimes((prev) => {
        if (!prev.has(keyTime)) return prev;
        const next = new Set(prev);
        next.delete(keyTime);
        next.add(newTime);
        return next;
      });
      setOptimisticSelected({ time: newTime, value: newValue });
      void bridge.request({
        kind: "emitters/set-track-key",
        params: {
          id: selectedId,
          track: focusedChannel.trackName,
          oldTime: keyTime,
          newTime,
          newValue,
        },
      }).catch(() => { /* silent — re-fetch on tree/changed */ });
    },
    [bridge, selectedId, focusedTrack, focusedChannel.trackName],
  );

  const handleCanvasAdd = useCallback(
    (time: number, value: number) => {
      if (selectedId === null) return;
      void bridge.request({
        kind: "emitters/add-track-key",
        params: { id: selectedId, track: focusedChannel.trackName, time, value },
      }).then((res) => {
        const insertedTime = res.time ?? time;
        setSelectedKeyTimes(new Set([insertedTime]));
        setOptimisticSelected({ time: insertedTime, value });
      }).catch(() => { /* silent */ });
    },
    [bridge, selectedId, focusedChannel.trackName],
  );

  // Delete — filters border keys + fires bridge call.
  const handleDelete = useCallback(() => {
    if (selectedId === null) return;
    const candidates: number[] = [];
    for (const t of selectedKeyTimes) {
      if (!borderKeyTimes.has(t)) candidates.push(t);
    }
    if (candidates.length === 0) return;
    void bridge.request({
      kind: "emitters/delete-track-keys",
      params: { id: selectedId, track: focusedChannel.trackName, times: candidates },
    }).then(() => {
      setSelectedKeyTimes(new Set());
      setOptimisticSelected(null);
    }).catch(() => { /* silent */ });
  }, [bridge, selectedId, focusedChannel.trackName, selectedKeyTimes, borderKeyTimes]);

  const handleInterpolationClick = useCallback(
    (kind: InterpolationType) => {
      if (selectedId === null || focusedTrack === null) return;
      if (focusedTrack.interpolation === kind) return;
      void bridge.request({
        kind: "emitters/set-track-interpolation",
        params: { id: selectedId, track: focusedChannel.trackName, interpolation: kind },
      }).catch(() => { /* silent */ });
    },
    [bridge, selectedId, focusedChannel.trackName, focusedTrack],
  );

  // ── Spinner sync ─────────────────────────────────────────────────

  const singleSelected = useMemo<{ time: number; value: number; isBorder: boolean } | null>(() => {
    if (selectedKeyTimes.size !== 1) return null;
    const onlyTime = selectedKeyTimes.values().next().value as number;
    if (optimisticSelected !== null && optimisticSelected.time === onlyTime) {
      return {
        time: optimisticSelected.time,
        value: optimisticSelected.value,
        isBorder: borderKeyTimes.has(optimisticSelected.time),
      };
    }
    if (focusedTrack === null) return null;
    const key = focusedTrack.keys.find((k) => k.time === onlyTime);
    if (key === undefined) return null;
    return {
      time: key.time,
      value: key.value,
      isBorder: borderKeyTimes.has(key.time),
    };
  }, [selectedKeyTimes, focusedTrack, borderKeyTimes, optimisticSelected]);

  const spinnersDisabled = singleSelected === null || selectedId === null;
  const timeSpinnerDisabled = spinnersDisabled || (singleSelected?.isBorder ?? false);

  const handleTimeSpinner = useCallback(
    (nextTime: number) => {
      if (singleSelected === null) return;
      if (selectedId === null || focusedTrack === null) return;
      if (singleSelected.isBorder) return;
      if (nextTime === singleSelected.time) return;
      const oldTime = singleSelected.time;
      const keys = focusedTrack.keys;
      const idx = keys.findIndex((k) => k.time === oldTime);
      let clampedTime = nextTime;
      if (idx > 0 && idx < keys.length - 1) {
        const eps = 1e-4;
        clampedTime = Math.max(
          keys[idx - 1]!.time + eps,
          Math.min(keys[idx + 1]!.time - eps, clampedTime),
        );
      }
      setSelectedKeyTimes(new Set([clampedTime]));
      setOptimisticSelected({ time: clampedTime, value: singleSelected.value });
      void bridge.request({
        kind: "emitters/set-track-key",
        params: {
          id: selectedId,
          track: focusedChannel.trackName,
          oldTime,
          newTime: clampedTime,
          newValue: singleSelected.value,
        },
      }).catch(() => { /* silent */ });
    },
    [singleSelected, bridge, selectedId, focusedChannel.trackName, focusedTrack],
  );

  const handleValueSpinner = useCallback(
    (nextValue: number) => {
      if (singleSelected === null) return;
      if (selectedId === null) return;
      if (nextValue === singleSelected.value) return;
      const clamped = Math.max(focusedRange.min, Math.min(focusedRange.max, nextValue));
      setOptimisticSelected({ time: singleSelected.time, value: clamped });
      void bridge.request({
        kind: "emitters/set-track-key",
        params: {
          id: selectedId,
          track: focusedChannel.trackName,
          oldTime: singleSelected.time,
          newTime: singleSelected.time,
          newValue: clamped,
        },
      }).catch(() => { /* silent */ });
    },
    [singleSelected, bridge, selectedId, focusedChannel.trackName, focusedRange.min, focusedRange.max],
  );

  // ── Delete keyboard handler (window-scoped, TYPING_TAGS guard) ────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete") return;
      const target = e.target as HTMLElement | null;
      if (target !== null && TYPING_TAGS.has(target.tagName)) return;
      if (selectedKeyTimes.size === 0) return;
      e.preventDefault();
      handleDelete();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [handleDelete, selectedKeyTimes]);

  // Lock-to options.
  const lockToOptions = LOCK_TO_OPTIONS[focusedChannel.trackName];
  const lockToDisabled = lockToOptions.length <= 1;

  // Delete-button disabled state for the toolbar.
  const deletableCount = useMemo(() => {
    let n = 0;
    for (const t of selectedKeyTimes) if (!borderKeyTimes.has(t)) n++;
    return n;
  }, [selectedKeyTimes, borderKeyTimes]);
  const deleteDisabled = selectedId === null || deletableCount === 0;

  // Bridge mutation guards — disable interp buttons when there's no
  // selected emitter or focused track.
  const interpDisabled = selectedId === null || focusedTrack === null;

  return (
    <div
      data-testid="curve-editor-panel"
      data-selected-id={selectedId === null ? "null" : String(selectedId)}
      data-focus-channel={focusChannel}
      data-mode={mode}
      data-selected-key-count={selectedKeyTimes.size}
      className="panel h-full w-full"
    >
      <div className="panel-header">
        <span>Curve editor</span>
      </div>
      <div className="curve-editor">
        {/* Edit-affordances toolbar. Lives above .ce-body so the
            `.ce-toolbar` rule in components.css (36px row, padded,
            border-bottom) gives us the design's intended slot. When
            no emitter is selected the toolbar still renders but each
            control disables — the user sees the affordance surface
            without it doing anything until a selection lands. */}
        <div
          data-testid="curve-editor-toolbar"
          className="ce-toolbar"
        >
          {/* Mode toggle (Select / Insert) */}
          <button
            type="button"
            aria-label="Select tool"
            aria-pressed={mode === "select"}
            data-state={mode === "select" ? "on" : "off"}
            data-testid="ce-tool-select"
            onClick={() => setMode("select")}
            title="Click a key to select; click empty area to clear"
            className={
              mode === "select"
                ? "h-6 rounded border border-accent bg-accent-soft px-2 text-xs font-semibold text-accent"
                : "h-6 rounded border border-border-2 bg-bg-2 px-2 text-xs text-text-2 hover:border-border-2"
            }
          >
            Select
          </button>
          <button
            type="button"
            aria-label="Insert tool"
            aria-pressed={mode === "insert"}
            data-state={mode === "insert" ? "on" : "off"}
            data-testid="ce-tool-insert"
            onClick={() => setMode("insert")}
            title="Click empty canvas to add a key"
            className={
              mode === "insert"
                ? "h-6 rounded border border-accent bg-accent-soft px-2 text-xs font-semibold text-accent"
                : "h-6 rounded border border-border-2 bg-bg-2 px-2 text-xs text-text-2 hover:border-border-2"
            }
          >
            Insert
          </button>

          <span className="mx-1 h-4 w-px bg-panel-2" aria-hidden />

          {/* Interpolation toggle — applies to the focus channel's
              underlying track. */}
          {INTERP_KINDS.map((kind) => {
            const isActive = focusedTrack?.interpolation === kind;
            return (
              <button
                key={kind}
                type="button"
                disabled={interpDisabled}
                aria-label={`Interpolation ${kind}`}
                aria-pressed={isActive}
                data-state={isActive ? "on" : "off"}
                data-testid={`ce-interp-${kind}`}
                onClick={() => handleInterpolationClick(kind)}
                className={
                  isActive
                    ? "h-6 rounded border border-accent bg-accent-soft px-2 text-xs font-semibold text-accent"
                    : "h-6 rounded border border-border-2 bg-bg-2 px-2 text-xs text-text-2 hover:border-border-2 disabled:cursor-not-allowed disabled:opacity-40"
                }
              >
                {kind[0]!.toUpperCase() + kind.slice(1)}
              </button>
            );
          })}

          <span className="mx-1 h-4 w-px bg-panel-2" aria-hidden />

          {/* Lock-to combo. Per-track options; disabled when only
              "None" is available. */}
          <Select.Root
            value={lockTo}
            onValueChange={setLockTo}
            disabled={lockToDisabled || selectedId === null}
          >
            <Select.Trigger
              data-testid="ce-lock-to-trigger"
              className="flex h-6 min-w-[88px] items-center justify-between gap-1 rounded border border-border-2 bg-bg-2 px-2 text-xs text-text outline-none hover:border-border-2 focus:border-accent disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Lock-to track"
            >
              <Select.Value placeholder="Lock to" />
              <Select.Icon>
                <ChevronDown className="size-3 text-text-3" />
              </Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Content
                position="popper"
                sideOffset={4}
                className="z-50 min-w-[120px] rounded-md border border-border-2 bg-bg-2 p-1 shadow-xl"
              >
                <Select.Viewport>
                  {lockToOptions.map((opt) => (
                    <Select.Item
                      key={opt}
                      value={opt}
                      data-testid={`ce-lock-to-option-${opt.toLowerCase()}`}
                      className="cursor-pointer rounded px-2 py-0.5 text-xs text-text outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent"
                    >
                      <Select.ItemText>{opt}</Select.ItemText>
                    </Select.Item>
                  ))}
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>

          <span className="mx-1 h-4 w-px bg-panel-2" aria-hidden />

          {/* Delete action — useful as a visible affordance even
              with the Delete key wired (discoverability + works in
              browsers with the key intercepted by extensions). */}
          <button
            type="button"
            disabled={deleteDisabled}
            aria-label="Delete selected keys"
            data-testid="ce-action-delete"
            onClick={handleDelete}
            title={deleteDisabled ? "Select a non-border key first" : "Delete selected key(s)"}
            className={
              deleteDisabled
                ? "h-6 rounded border border-border bg-bg-2/60 px-2 text-xs text-text-3"
                : "h-6 rounded border border-rose-700 bg-rose-900/30 px-2 text-xs text-rose-200 hover:border-rose-500"
            }
          >
            Delete
          </button>

          <div className="flex-1" />

          {/* Time / Value spinners — populated from the focus channel's
              currently selected key. Disabled when 0 or 2+ keys are
              selected. Border keys disable the Time spinner (value-only
              edit). The Spinner `key` binds to track + selected time so
              the input remounts when selection changes. */}
          <label className="text-xs text-text-2" htmlFor="ce-spinner-time">Time</label>
          <div className="w-20" data-testid="ce-spinner-time-wrapper">
            <Spinner
              key={`time:${focusedChannel.trackName}:${singleSelected?.time ?? "none"}`}
              aria-label="Selected key time"
              value={singleSelected?.time ?? 0}
              onChange={handleTimeSpinner}
              min={0}
              max={100}
              step={1}
              disabled={timeSpinnerDisabled}
              density="tight"
            />
          </div>
          <label className="text-xs text-text-2 ml-1" htmlFor="ce-spinner-value">Value</label>
          <div className="w-20" data-testid="ce-spinner-value-wrapper">
            <Spinner
              key={`value:${focusedChannel.trackName}:${singleSelected?.time ?? "none"}:${singleSelected?.value ?? "none"}`}
              aria-label="Selected key value"
              value={singleSelected?.value ?? 0}
              onChange={handleValueSpinner}
              min={focusedRange.min}
              max={focusedRange.max}
              step={(focusedRange.max - focusedRange.min) / 100}
              disabled={spinnersDisabled}
              density="tight"
            />
          </div>
        </div>

        <div className="ce-body">
          <div
            className="curve-list"
            role="group"
            aria-label="Curve channels"
            data-testid="curve-channel-list"
          >
            {CHANNELS.map((c) => {
              const isOn = visible[c.id] ?? c.defaultOn;
              const isFocus = c.id === focusChannel;
              return (
                <div
                  key={c.id}
                  className={
                    isFocus
                      ? "curve-row !bg-accent-soft"
                      : "curve-row"
                  }
                  role="button"
                  tabIndex={0}
                  data-testid={`curve-channel-row-${c.id}`}
                  data-on={isOn ? "true" : "false"}
                  data-focus={isFocus ? "true" : "false"}
                  onClick={() => handleRowClick(c.id)}
                  onKeyDown={(e) => {
                    // Enter/Space activate the row (focus) for
                    // keyboard users.
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleRowClick(c.id);
                    }
                  }}
                  aria-pressed={isFocus}
                >
                  <input
                    type="checkbox"
                    checked={isOn}
                    onChange={(e) =>
                      setVisible((v) => ({ ...v, [c.id]: e.target.checked }))
                    }
                    onClick={(e) => {
                      // Don't propagate to the row click — the
                      // checkbox toggles visibility only; the row body
                      // handles focus.
                      e.stopPropagation();
                    }}
                    aria-label={`Toggle ${c.label} curve`}
                    data-testid={`curve-channel-checkbox-${c.id}`}
                  />
                  <span
                    className="swatch"
                    style={{ background: c.color }}
                    aria-hidden="true"
                  />
                  <span>{c.label}</span>
                </div>
              );
            })}
          </div>
          <div className="curve-canvas-wrap">
            {selectedId === null ? (
              <div
                data-testid="curve-editor-placeholder"
                className="flex h-full items-center justify-center text-xs text-text-3"
              >
                Select an emitter to edit its tracks
              </div>
            ) : (
              <CurveEditor
                tracks={tracks}
                channels={CHANNELS}
                visibleChannels={visible}
                focusChannel={focusChannel}
                selectedKeyTimes={selectedKeyTimes}
                onKeyClick={handleKeyClick}
                onCanvasClick={handleCanvasClick}
                insertMode={mode === "insert"}
                onCanvasAdd={handleCanvasAdd}
                onCanvasContextMenu={() => setMode("select")}
                onKeyContextMenu={(time, isBorder, x, y) =>
                  setKeyContextMenu({ time, isBorder, x, y })
                }
                onKeyDragEnd={handleKeyDragEnd}
                onCanvasMarqueeSelect={handleCanvasMarqueeSelect}
              />
            )}
          </div>
        </div>
      </div>
      {/* Per-key right-click menu (floating, fixed-position). */}
      {keyContextMenu !== null && (
        <KeyContextMenu
          time={keyContextMenu.time}
          isBorder={keyContextMenu.isBorder}
          x={keyContextMenu.x}
          y={keyContextMenu.y}
          onClose={() => setKeyContextMenu(null)}
          onDelete={() => {
            const t = keyContextMenu.time;
            setKeyContextMenu(null);
            if (selectedId === null) return;
            if (borderKeyTimes.has(t)) return;
            void bridge.request({
              kind: "emitters/delete-track-keys",
              params: {
                id: selectedId,
                track: focusedChannel.trackName,
                times: [t],
              },
            }).then(() => {
              setOptimisticSelected((prev) =>
                prev !== null && prev.time === t ? null : prev,
              );
              setSelectedKeyTimes((prev) => {
                if (!prev.has(t)) return prev;
                const next = new Set(prev);
                next.delete(t);
                return next;
              });
            }).catch(() => { /* silent */ });
          }}
        />
      )}
    </div>
  );
}

/** Floating per-key right-click menu. Tiny enough to inline; matches
 *  the pattern from the deleted TrackEditor. */
function KeyContextMenu({
  time,
  isBorder,
  x,
  y,
  onClose,
  onDelete,
}: {
  time: number;
  isBorder: boolean;
  x: number;
  y: number;
  onClose: () => void;
  onDelete: () => void;
}) {
  void time; // surfaced for future entries (Snap to grid uses it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onMouseDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && el.closest("[data-key-menu]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [onClose]);

  return (
    <div
      data-key-menu="true"
      data-testid="ce-key-context-menu"
      role="menu"
      aria-label="Curve key actions"
      className="fixed z-50 min-w-[140px] rounded-md border border-border-2 bg-bg-2 p-1 text-xs text-text shadow-xl"
      style={{ left: x, top: y }}
    >
      <button
        type="button"
        role="menuitem"
        data-testid="ce-key-context-menu-delete"
        onClick={onDelete}
        disabled={isBorder}
        title={isBorder ? "Border keys cannot be deleted" : undefined}
        className="block w-full rounded px-2 py-1 text-left hover:bg-panel-2 disabled:cursor-not-allowed disabled:text-text-3 disabled:hover:bg-transparent outline-none"
      >
        Delete
      </button>
    </div>
  );
}
