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
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

/** Variant with 3 keys on the active (red) track so there's at least
 *  one non-border key for the delete spec to act on. */
function fixtureTracksWithMiddleKey(): TrackDto[] {
  return TRACK_NAMES.map((name) => ({
    name,
    keys: name === "red"
      ? [
          { time: 0,   value: 0 },
          { time: 50,  value: 0.5 },
          { time: 100, value: 1 },
        ]
      : [
          { time: 0,   value: 0 },
          { time: 100, value: 1 },
        ],
    interpolation: "linear",
  }));
}

type SelectionListener = (e: { payload: { id: number | null } }) => void;

function makeStubBridge(
  initialSelectedId: number | null,
  tracksFactory: () => TrackDto[] = fixtureTracks,
) {
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
        return Promise.resolve({ tracks: tracksFactory() });
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

  // ─── Screen 5 / Screen 6 Batch B-α ────────────────────────────────

  it("Delete keypress on the focused panel fires emitters/delete-track-keys with the current selection (border keys filtered)", async () => {
    const { bridge } = makeStubBridge(7, fixtureTracksWithMiddleKey);
    render(<EmitterPropertyPanel bridge={bridge} />);

    // Wait for TrackEditor to mount + render the curve key circles.
    await waitFor(() => {
      expect(screen.getByTestId("track-editor")).toBeInTheDocument();
    });

    // Pick the middle key (time=50) — only non-border key on the
    // active (red) track. Click selects it.
    const circles = document.querySelectorAll("[data-testid='curve-key']");
    expect(circles.length).toBeGreaterThanOrEqual(3);
    fireEvent.click(circles[1]!);

    // The panel has tabIndex=0 — focus it before firing the keypress.
    const panel = screen.getByTestId("emitter-property-panel");
    panel.focus();

    // Fire the Delete keypress on the panel. The handler reads
    // selection from TrackEditor (via the registered handler) and
    // dispatches the bridge call.
    fireEvent.keyDown(panel, { key: "Delete" });

    // Assert the bridge received delete-track-keys with the right
    // params. Wait because the handler dispatches asynchronously via
    // the bridge's request promise; the request itself is
    // synchronous but the test framework's vi.fn() captures it as
    // soon as it's invoked, which is the same tick.
    await waitFor(() => {
      const calls = (bridge.request as ReturnType<typeof vi.fn>).mock.calls;
      const match = calls.find(
        (call) => (call[0] as { kind: string }).kind === "emitters/delete-track-keys",
      );
      expect(match).toBeDefined();
      expect(match![0]).toMatchObject({
        kind: "emitters/delete-track-keys",
        params: {
          id: 7,
          track: "red",
          times: [50],   // border keys (0, 100) filtered out
        },
      });
    });
  });

  // ─── Screen 6 Batch B-β ────────────────────────────────────────────

  // ─── Phase 4.1 Fix dispatch 1 — panel moved to lower-right quadrant
  it("renders at full width (no sidebar w-80 class) since it lives in the lower-right quadrant", async () => {
    const { bridge } = makeStubBridge(0);
    render(<EmitterPropertyPanel bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByTestId("emitter-property-panel")).toBeInTheDocument();
    });
    const panel = screen.getByTestId("emitter-property-panel");
    // Old layout had `w-80` (sidebar). New layout uses `w-full h-full`
    // because the parent quadrant div sets dimensions.
    expect(panel.className).toContain("w-full");
    expect(panel.className).not.toContain("w-80");
    // border-l (sidebar separator) is gone now that the quadrant grid
    // owns the borders.
    expect(panel.className).not.toContain("border-l");
  });

  it("Spinners reflect the selected key's (time, value) when exactly one key is selected", async () => {
    const { bridge } = makeStubBridge(7, fixtureTracksWithMiddleKey);
    render(<EmitterPropertyPanel bridge={bridge} />);

    await waitFor(() => {
      expect(screen.getByTestId("track-editor")).toBeInTheDocument();
    });
    // No selection yet → spinners are disabled. Note that we re-
    // query the input on each assertion because TrackEditor uses
    // `key` on the Spinner to remount it when the selection changes;
    // a cached input ref would point at the detached old element.
    const queryInputs = () => ({
      time: screen.getByTestId("track-spinner-time-wrapper").querySelector("input") as HTMLInputElement,
      value: screen.getByTestId("track-spinner-value-wrapper").querySelector("input") as HTMLInputElement,
    });
    const before = queryInputs();
    expect(before.time.disabled).toBe(true);
    expect(before.value.disabled).toBe(true);

    // Click the middle key (time=50, value=0.5 on the red track).
    const circles = document.querySelectorAll("[data-testid='curve-key']");
    fireEvent.click(circles[1]!);

    await waitFor(() => {
      const after = queryInputs();
      // After selection, both Spinners enable + pre-fill from the
      // selected key.
      expect(after.time.disabled).toBe(false);
      expect(after.value.disabled).toBe(false);
      // Time value is 50; Value is 0.5. The Spinner formats per-step
      // decimal places — step=1 for time so "50", step is small for
      // value so it could be "0.5".
      expect(Number(after.time.value)).toBe(50);
      expect(Number(after.value.value)).toBeCloseTo(0.5, 2);
    });
  });
});
