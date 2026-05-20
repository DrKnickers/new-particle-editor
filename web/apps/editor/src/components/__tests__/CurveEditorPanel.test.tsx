// Vitest tests for CurveEditorPanel (Task 2.6 of the LT-4 redesign).
//
// Covered:
//   - Renders the panel chrome + 7 channel rows (one per CHANNELS
//     entry) regardless of selection.
//   - Index defaults OFF; Scale / R / G / B / Alpha / Rotation default
//     ON.
//   - Renders the placeholder when no emitter is selected.
//   - When an emitter is selected, the multi-channel CurveEditor SVG
//     mounts and one <g data-channel-id=…> renders per VISIBLE channel.
//   - Toggling a channel checkbox flips the SVG layer's presence
//     (visibleChannels prop wired correctly).
//   - localStorage persistence: a flipped checkbox writes through to
//     localStorage('alo:curve-channels').

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  Bridge,
  TrackDto,
} from "@particle-editor/bridge-schema";
import { TRACK_NAMES } from "@particle-editor/bridge-schema";
import { CurveEditorPanel, CHANNELS } from "../CurveEditorPanel";
import { makeDefaultEngineState } from "@/bridge/mock-state";

function fixtureTracks(): TrackDto[] {
  return TRACK_NAMES.map((name) => ({
    name,
    keys: [
      { time: 0,   value: 0 },
      { time: 100, value: name === "rotationSpeed" ? -1 : 1 },
    ],
    interpolation: "linear",
  }));
}

type SelectionListener = (e: { payload: { id: number | null } }) => void;

function makeStubBridge(initialSelectedId: number | null) {
  const listeners: SelectionListener[] = [];
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
      return Promise.resolve({});
    }),
    on: vi.fn().mockImplementation((kind: string, h: SelectionListener) => {
      if (kind === "emitters/selected") listeners.push(h);
      return () => {
        const idx = listeners.indexOf(h);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    }),
  } as unknown as Bridge & {
    request: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };
  return { bridge };
}

describe("CurveEditorPanel", () => {
  beforeEach(() => {
    // Clear persisted channel-visibility between tests so each spec
    // starts from the documented defaults.
    localStorage.removeItem("alo:curve-channels");
  });

  it("renders the .panel chrome + 7 channel rows regardless of selection", async () => {
    const { bridge } = makeStubBridge(null);
    render(<CurveEditorPanel bridge={bridge} />);
    expect(screen.getByTestId("curve-editor-panel")).toBeInTheDocument();
    // All 7 channels — checkboxes are present with the documented
    // default state.
    for (const c of CHANNELS) {
      const cb = screen.getByTestId(
        `curve-channel-checkbox-${c.id}`,
      ) as HTMLInputElement;
      expect(cb).toBeInTheDocument();
      expect(cb.checked).toBe(c.defaultOn);
    }
  });

  it("Index defaults OFF; the other 6 channels default ON", () => {
    const { bridge } = makeStubBridge(null);
    render(<CurveEditorPanel bridge={bridge} />);
    const indexCb = screen.getByTestId(
      "curve-channel-checkbox-index",
    ) as HTMLInputElement;
    expect(indexCb.checked).toBe(false);
    for (const id of ["scale", "red", "green", "blue", "alpha", "rotation"]) {
      const cb = screen.getByTestId(
        `curve-channel-checkbox-${id}`,
      ) as HTMLInputElement;
      expect(cb.checked).toBe(true);
    }
  });

  it("renders the placeholder when no emitter is selected", async () => {
    const { bridge } = makeStubBridge(null);
    render(<CurveEditorPanel bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByTestId("curve-editor-placeholder")).toBeInTheDocument();
    });
    // The multi-channel SVG isn't mounted in the placeholder branch.
    expect(screen.queryByTestId("curve-editor-svg")).toBeNull();
  });

  it("mounts the multi-channel SVG with one <g> per visible channel when an emitter is selected", async () => {
    const { bridge } = makeStubBridge(0);
    render(<CurveEditorPanel bridge={bridge} />);
    // Snapshot resolves, then get-tracks; wait for layers (which only
    // appear after both promises have settled).
    await waitFor(() => {
      expect(screen.getByTestId("curve-layer-scale")).toBeInTheDocument();
    });
    // 6 channels default ON → 6 layers (Index is off by default).
    for (const id of ["scale", "red", "green", "blue", "alpha", "rotation"]) {
      expect(
        screen.getByTestId(`curve-layer-${id}`),
      ).toBeInTheDocument();
    }
    expect(screen.queryByTestId("curve-layer-index")).toBeNull();
  });

  it("toggling a channel checkbox adds/removes its SVG layer", async () => {
    const { bridge } = makeStubBridge(0);
    render(<CurveEditorPanel bridge={bridge} />);
    // Wait for the get-tracks promise to settle so layers render.
    await waitFor(() => {
      expect(screen.getByTestId("curve-layer-scale")).toBeInTheDocument();
    });

    // Initially Index is OFF — no layer.
    expect(screen.queryByTestId("curve-layer-index")).toBeNull();
    // Click the Index checkbox to enable it.
    const indexCb = screen.getByTestId(
      "curve-channel-checkbox-index",
    ) as HTMLInputElement;
    fireEvent.click(indexCb);
    expect(indexCb.checked).toBe(true);
    // Layer appears.
    await waitFor(() => {
      expect(screen.getByTestId("curve-layer-index")).toBeInTheDocument();
    });

    // Click Red checkbox to disable it (default ON).
    const redCb = screen.getByTestId(
      "curve-channel-checkbox-red",
    ) as HTMLInputElement;
    fireEvent.click(redCb);
    expect(redCb.checked).toBe(false);
    await waitFor(() => {
      expect(screen.queryByTestId("curve-layer-red")).toBeNull();
    });
  });

  it("persists channel visibility to localStorage('alo:curve-channels')", async () => {
    const { bridge } = makeStubBridge(null);
    render(<CurveEditorPanel bridge={bridge} />);
    // Initial render writes defaults.
    await waitFor(() => {
      const stored = localStorage.getItem("alo:curve-channels");
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!) as Record<string, boolean>;
      expect(parsed.index).toBe(false);
      expect(parsed.scale).toBe(true);
    });
    // Toggle Index ON; localStorage should reflect.
    const indexCb = screen.getByTestId(
      "curve-channel-checkbox-index",
    ) as HTMLInputElement;
    fireEvent.click(indexCb);
    await waitFor(() => {
      const parsed = JSON.parse(
        localStorage.getItem("alo:curve-channels")!,
      ) as Record<string, boolean>;
      expect(parsed.index).toBe(true);
    });
  });

  it("reads persisted visibility on mount (Index ON survives)", () => {
    // Seed storage with Index=true, Red=false. Defaults overlay
    // anything new.
    localStorage.setItem(
      "alo:curve-channels",
      JSON.stringify({ index: true, red: false }),
    );
    const { bridge } = makeStubBridge(null);
    render(<CurveEditorPanel bridge={bridge} />);
    const indexCb = screen.getByTestId(
      "curve-channel-checkbox-index",
    ) as HTMLInputElement;
    const redCb = screen.getByTestId(
      "curve-channel-checkbox-red",
    ) as HTMLInputElement;
    expect(indexCb.checked).toBe(true);
    expect(redCb.checked).toBe(false);
  });
});
