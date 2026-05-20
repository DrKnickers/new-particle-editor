// EmitterPropertyPanel — lower-RIGHT quadrant of the four-quadrant
// layout (Phase 4.1 Fix dispatch 1). Hosts the TrackEditor + Curve
// editor for the currently selected emitter; "Select an emitter"
// placeholder when nothing is selected.
//
// Phase 4.1 Fix dispatch 1: moved from the right-side sidebar to the
// lower-right quadrant. The form-field property inspector that used
// to be planned for this panel is now `EmitterPropertyTabs` in the
// lower-LEFT quadrant. The panel keeps its Delete-key handler that
// routes Delete to TrackEditor's deleteSelected.
//
// Phase 3 Screen 6 Batch A: foundation. Renders <TrackEditor> when an
// emitter is selected, a "Select an emitter" placeholder otherwise.
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

/** DOM tag names that own their own keyboard handling (text edits,
 *  combo navigation, etc.). When a Delete keypress originates inside
 *  one of these we MUST NOT intercept — typing "Delete" in a text
 *  field should delete a character, not a curve key. */
const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function EmitterPropertyPanel({ bridge }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tracks, setTracks] = useState<TrackDto[] | null>(null);
  // Imperative-style handle into TrackEditor's deleteSelected. The
  // child re-registers on every selection / active-track change so
  // we always invoke a fresh closure. Null when no TrackEditor is
  // mounted (placeholder branch).
  const deleteHandlerRef = useRef<(() => void) | null>(null);
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

  // Keyboard handler — Delete key invokes the registered TrackEditor
  // delete handler (which filters border keys + fires the bridge
  // call). Skipped when the event target is a typing surface (input /
  // textarea / select) so text-editing Delete keystrokes still work
  // normally. Skipped when the panel is on the placeholder branch
  // (no TrackEditor registered).
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Delete") return;
    const target = e.target as HTMLElement | null;
    if (target !== null && TYPING_TAGS.has(target.tagName)) return;
    const handler = deleteHandlerRef.current;
    if (handler === null) return;
    e.preventDefault();
    handler();
  }, []);

  const registerDeleteHandler = useCallback((h: (() => void) | null) => {
    deleteHandlerRef.current = h;
  }, []);

  return (
    <aside
      data-testid="emitter-property-panel"
      data-selected-id={selectedId === null ? "null" : String(selectedId)}
      // tabIndex={0} makes the panel itself focus-target so keyboard
      // events route here. Without it the Delete key on an
      // un-focused-input panel would go to the document body and our
      // onKeyDown wouldn't see it.
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex h-full w-full flex-col overflow-y-auto bg-bg p-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-sky-700"
      aria-label="Emitter properties"
    >
      {selectedId === null ? (
        <div
          data-testid="emitter-property-panel-placeholder"
          className="flex h-full items-center justify-center text-center text-text-3"
        >
          Select an emitter to edit its properties
        </div>
      ) : tracks === null ? (
        <div className="text-text-3">Loading…</div>
      ) : (
        <TrackEditor
          tracks={tracks}
          bridge={bridge}
          emitterId={selectedId}
          registerDeleteHandler={registerDeleteHandler}
        />
      )}
    </aside>
  );
}
