// Vitest tests for EmitterPropertyPanel (Phase 3 Screen 6 Batch A).
//
// Covered:
//   - Renders the "Select an emitter" placeholder when the snapshot's
//     selectedEmitterId is null AND no `emitters/selected` event has
//     pushed an id yet.
//   - Renders the TrackEditor (verifiable via its toolbar) when an
//     emitter is selected — the panel fetches via emitters/get-tracks
//     and the resolved tracks reach TrackEditor.

import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type {
  Bridge,
  EmitterTreeDto,
  TrackDto,
} from "@particle-editor/bridge-schema";
import { TRACK_NAMES } from "@particle-editor/bridge-schema";
import { EmitterPropertyPanel } from "../EmitterPropertyPanel";
import { makeDefaultEngineState } from "@/bridge/mock-state";

function fixtureTracks(): TrackDto[] {
  return TRACK_NAMES.map((name) => ({
    name,
    keys: [
      { time: 0,   value: 0 },
      { time: 100, value: 1 },
    ],
    interpolation: "linear",
  }));
}

type SelectionListener = (e: { payload: { id: number | null } }) => void;

function makeStubBridge(initialSelectedId: number | null) {
  // Allow tests to push selection events after mount via the returned
  // `pushSelection` helper.
  const listeners: SelectionListener[] = [];
  const tree: EmitterTreeDto = {
    root: { id: -1, name: "", role: "root", linkGroup: 0, visible: true, children: [] },
  };
  const bridge = {
    request: vi.fn().mockImplementation((req: { kind: string }) => {
      if (req.kind === "engine/state/snapshot") {
        return Promise.resolve({
          ...makeDefaultEngineState(),
          selectedEmitterId: initialSelectedId,
        });
      }
      if (req.kind === "emitters/get-tracks") {
        return Promise.resolve({ tracks: fixtureTracks() });
      }
      if (req.kind === "emitters/list") return Promise.resolve(tree);
      return Promise.resolve({});
    }),
    on: vi.fn().mockImplementation((kind: string, h: SelectionListener) => {
      if (kind === "emitters/selected") {
        listeners.push(h);
      }
      return () => {
        const idx = listeners.indexOf(h);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    }),
  } as unknown as Bridge & { request: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
  return { bridge, pushSelection: (id: number | null) => listeners.forEach((l) => l({ payload: { id } })) };
}

describe("EmitterPropertyPanel", () => {
  it("renders the 'Select an emitter' placeholder when no emitter is selected", async () => {
    const { bridge } = makeStubBridge(null);
    render(<EmitterPropertyPanel bridge={bridge} />);

    // Wait for the snapshot to resolve so the placeholder paint isn't
    // racing with an in-flight request.
    await waitFor(() => {
      expect(
        screen.getByTestId("emitter-property-panel-placeholder"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Select an emitter to edit its properties/),
    ).toBeInTheDocument();
    // TrackEditor isn't mounted in the no-selection branch.
    expect(screen.queryByTestId("track-editor")).toBeNull();
  });

  it("renders the TrackEditor when an emitter is selected (via snapshot seed)", async () => {
    const { bridge } = makeStubBridge(0);
    render(<EmitterPropertyPanel bridge={bridge} />);

    // The snapshot seeds the selected id; the panel then dispatches
    // emitters/get-tracks and mounts TrackEditor.
    await waitFor(() => {
      expect(screen.getByTestId("track-editor")).toBeInTheDocument();
    });
    // The toolbar's 7 track-toggle buttons render once the tracks
    // resolve.
    for (const name of TRACK_NAMES) {
      expect(
        screen.getByTestId(`track-toggle-${name}`),
      ).toBeInTheDocument();
    }
  });
});
