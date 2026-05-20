// CurveEditorPanel — Task 2.6 (Phase 2 of the LT-4 redesign).
//
// Always-on bottom 260px panel hosting the multi-channel curve
// editor. 160px left curve-list (per-channel visibility checkboxes +
// colour swatches) + 1fr canvas (overlaid curves for the channels
// whose checkboxes are checked).
//
// 7 channels total: Scale / R / G / B / Alpha / Rotation / Index.
// Index defaults OFF to match the design's per-channel default state;
// Scale through Rotation default ON.
//
// When no emitter is selected, the panel renders a placeholder. When
// an emitter is selected, fetches its TrackDto[] via
// `emitters/get-tracks` and passes them to CurveEditor as visible
// channels.
//
// Per-channel visibility is persisted to localStorage under
// `alo:curve-channels` so the user's preferred channel set survives
// session restarts.
//
// What's NOT here this task (deferred to a polish pass):
//   - Time/Value spinners (lived in the deleted TrackEditor).
//   - Marquee drag / drag-to-move / Insert mode / Delete key handler.
//   - Lock-to combo, per-track-toggle buttons, interpolation toggle.
// The CurveEditor's multi-channel branch is view-only; restoring the
// edit surface (per the design) requires routing all of the above
// through a "focus channel" model — a separate task.

import { useEffect, useState } from "react";
import type { Bridge, TrackDto } from "@particle-editor/bridge-schema";
import { CurveEditor, type ChannelDef } from "@/screens/CurveEditor";

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

type Props = { bridge: Bridge };

function defaultVisibility(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const c of CHANNELS) result[c.id] = c.defaultOn;
  return result;
}

function loadVisibility(): Record<string, boolean> {
  // localStorage may be unavailable in test environments without
  // jsdom's window; guard with a typeof check so import doesn't crash
  // a Vitest run with a non-default environment.
  if (typeof localStorage === "undefined") return defaultVisibility();
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === null) return defaultVisibility();
  try {
    const parsed = JSON.parse(stored) as Record<string, boolean>;
    // Merge with defaults so new channels added later still show up
    // for users with old persisted state.
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

export function CurveEditorPanel({ bridge }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tracks, setTracks] = useState<TrackDto[] | null>(null);
  const [visible, setVisible] = useState<Record<string, boolean>>(loadVisibility);

  // Persist visibility on every change.
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(visible));
    } catch {
      // Quota / disabled storage — silent. Visibility still works in-
      // session; only the cross-session persistence regresses.
    }
  }, [visible]);

  // Selection sync — snapshot seed + live event subscription. Same
  // shape as the (deleted) EmitterPropertyPanel's logic.
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

  // Track fetch. Re-fetch on `emitters/tree/changed` so mutations
  // surface in the overlay (the panel doesn't drive mutations itself
  // yet — see top-of-file deferred list — but tree-level edits still
  // ripple in).
  useEffect(() => {
    if (selectedId === null) {
      setTracks(null);
      return;
    }
    let cancelled = false;
    const fetchTracks = () => {
      bridge
        .request({ kind: "emitters/get-tracks", params: { id: selectedId } })
        .then((res) => {
          if (cancelled) return;
          setTracks(res.tracks);
        })
        .catch(() => {
          if (cancelled) return;
          setTracks([]);
        });
    };
    fetchTracks();
    const off = bridge.on("emitters/tree/changed", () => fetchTracks());
    return () => {
      cancelled = true;
      off();
    };
  }, [bridge, selectedId]);

  return (
    <div
      data-testid="curve-editor-panel"
      data-selected-id={selectedId === null ? "null" : String(selectedId)}
      className="panel h-full w-full"
    >
      <div className="panel-header">
        <span>Curve editor</span>
      </div>
      <div className="curve-editor" style={{ gridTemplateRows: "1fr" }}>
        <div className="ce-body">
          <div
            className="curve-list"
            role="group"
            aria-label="Curve channels"
            data-testid="curve-channel-list"
          >
            {CHANNELS.map((c) => {
              const isOn = visible[c.id] ?? c.defaultOn;
              return (
                <label
                  key={c.id}
                  className="curve-row"
                  data-testid={`curve-channel-row-${c.id}`}
                  data-on={isOn ? "true" : "false"}
                >
                  <input
                    type="checkbox"
                    checked={isOn}
                    onChange={(e) =>
                      setVisible((v) => ({ ...v, [c.id]: e.target.checked }))
                    }
                    aria-label={`Toggle ${c.label} curve`}
                    data-testid={`curve-channel-checkbox-${c.id}`}
                  />
                  <span
                    className="swatch"
                    style={{ background: c.color }}
                    aria-hidden="true"
                  />
                  <span>{c.label}</span>
                </label>
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
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
