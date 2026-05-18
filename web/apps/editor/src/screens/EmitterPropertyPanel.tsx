// EmitterPropertyPanel — right-side panel that surfaces per-emitter
// properties for the currently selected emitter.
//
// Phase 3 Screen 6 Batch A: foundation. Renders <TrackEditor> when an
// emitter is selected, a "Select an emitter" placeholder otherwise.
// Future batches will add the property inspector (Phase 3 Screens 1-3
// emitter parameters), the random-params grid, the link-group panel,
// etc. — those slot in as additional sections of this panel.
//
// Selection sync:
//   - On mount, fetch `engine/state/snapshot` to seed
//     `selectedEmitterId` (handles the case where the user selected
//     an emitter before the panel mounted, or refreshed mid-session).
//   - Subscribe to `emitters/selected` to follow live selection
//     changes from the sidebar.
//   - Re-fetch tracks via `emitters/get-tracks` whenever the
//     selection changes (debounce isn't needed at this level — the
//     bridge is request/response and the selection events are
//     user-initiated).
//   - Also re-fetch on `emitters/tree/changed` because mutations
//     (rename, structural moves) don't change the id but may change
//     the underlying tracks (e.g. once Batch B's track mutations
//     land).

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Bridge,
  TrackDto,
} from "@particle-editor/bridge-schema";
import { TrackEditor } from "./TrackEditor";

type Props = {
  bridge: Bridge;
};

export function EmitterPropertyPanel({ bridge }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tracks, setTracks] = useState<TrackDto[] | null>(null);
  // Track which id we last fetched for so a late-arriving response
  // for a stale selection doesn't clobber the current data. Compared
  // by reference; the selection scalar is a primitive number/null so
  // the ref equality is fine.
  const inFlightFor = useRef<number | null>(null);

  // Seed selection from the snapshot on mount. Catch errors silently
  // so a bridge disconnect doesn't break the panel render.
  useEffect(() => {
    let cancelled = false;
    bridge
      .request({ kind: "engine/state/snapshot", params: {} })
      .then((snap) => {
        if (cancelled) return;
        setSelectedId(snap.selectedEmitterId);
      })
      .catch(() => { /* ignore — panel renders the placeholder */ });
    return () => { cancelled = true; };
  }, [bridge]);

  // Follow live selection changes from the sidebar.
  useEffect(() => {
    const off = bridge.on("emitters/selected", (e) => {
      setSelectedId(e.payload.id);
    });
    return off;
  }, [bridge]);

  // Track re-fetch logic. Hoisted into a callback so the
  // tree/changed listener can reuse it. Uses `inFlightFor` to discard
  // stale responses (older request finishes after a newer selection
  // landed → don't overwrite).
  const fetchTracks = useCallback(
    (id: number | null) => {
      if (id === null) {
        setTracks(null);
        inFlightFor.current = null;
        return;
      }
      inFlightFor.current = id;
      bridge
        .request({ kind: "emitters/get-tracks", params: { id } })
        .then((res) => {
          if (inFlightFor.current !== id) return; // stale
          setTracks(res.tracks);
        })
        .catch(() => {
          if (inFlightFor.current !== id) return;
          setTracks([]);
        });
    },
    [bridge],
  );

  // Re-fetch on selection change.
  useEffect(() => {
    fetchTracks(selectedId);
  }, [fetchTracks, selectedId]);

  // Re-fetch on tree mutations (rename / structural / future track
  // edits). Keeps the panel honest without piggy-backing on the
  // selection event.
  useEffect(() => {
    const off = bridge.on("emitters/tree/changed", () => {
      fetchTracks(selectedId);
    });
    return off;
  }, [bridge, fetchTracks, selectedId]);

  return (
    <aside
      data-testid="emitter-property-panel"
      data-selected-id={selectedId === null ? "null" : String(selectedId)}
      className="flex h-full w-80 shrink-0 flex-col overflow-y-auto border-l border-neutral-800 bg-neutral-950 p-3 text-sm"
      aria-label="Emitter properties"
    >
      {selectedId === null ? (
        <div
          data-testid="emitter-property-panel-placeholder"
          className="flex h-full items-center justify-center text-center text-neutral-500"
        >
          Select an emitter to edit its properties
        </div>
      ) : tracks === null ? (
        <div className="text-neutral-500">Loading…</div>
      ) : (
        <TrackEditor tracks={tracks} />
      )}
    </aside>
  );
}
