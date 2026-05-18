// Vitest tests for TrackEditor (Phase 3 Screen 6 Batch A foundations +
// Screen 5 / Screen 6 Batch B-α interaction).
//
// Covered:
//   - 7 track-toggle buttons render (one per `TRACK_NAMES` entry).
//   - Clicking a different track button switches the active track
//     surfaced on the data-active-track attribute, and the
//     CurveEditor receives the new track (verified via the SVG's
//     data-track attribute).
//   - Still-deferred actions (Select / Insert) render disabled with
//     a Batch B tooltip.
//   - Interpolation toggle: clicking Smooth fires the bridge call.
//   - Interpolation toggle reflects the current track's interp via
//     `data-state="on"` on the active button.

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Bridge, TrackDto } from "@particle-editor/bridge-schema";
import { TRACK_NAMES } from "@particle-editor/bridge-schema";
import { TrackEditor } from "../TrackEditor";

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

function makeStubBridge() {
  const requests: { kind: string; params: unknown }[] = [];
  const bridge = {
    request: vi.fn().mockImplementation((req: { kind: string; params: unknown }) => {
      requests.push(req);
      return Promise.resolve({});
    }),
    on: vi.fn().mockReturnValue(() => {}),
  } as unknown as Bridge & { request: ReturnType<typeof vi.fn> };
  return { bridge, requests };
}

describe("TrackEditor", () => {
  it("renders 7 track-toggle buttons (one per TRACK_NAMES entry)", () => {
    render(<TrackEditor tracks={fixtureTracks()} />);
    for (const name of TRACK_NAMES) {
      expect(
        screen.getByTestId(`track-toggle-${name}`),
      ).toBeInTheDocument();
    }
  });

  it("clicking a different track button switches the active track + the CurveEditor receives it", () => {
    const { container } = render(<TrackEditor tracks={fixtureTracks()} />);
    // Default active track is "red".
    const editor = container.querySelector(
      "[data-testid='track-editor']",
    ) as HTMLElement;
    expect(editor.dataset.activeTrack).toBe("red");
    const initialSvg = container.querySelector(
      "[data-testid='curve-editor-svg']",
    ) as SVGElement;
    expect(initialSvg.getAttribute("data-track")).toBe("red");

    // Click the green toggle.
    fireEvent.click(screen.getByTestId("track-toggle-green"));

    expect(editor.dataset.activeTrack).toBe("green");
    const newSvg = container.querySelector(
      "[data-testid='curve-editor-svg']",
    ) as SVGElement;
    expect(newSvg.getAttribute("data-track")).toBe("green");
  });

  it("still-deferred toolbar actions (Select / Insert) render disabled with a Batch B tooltip", () => {
    render(<TrackEditor tracks={fixtureTracks()} />);
    for (const tid of [
      "track-tool-select",
      "track-tool-insert",
    ]) {
      const btn = screen.getByTestId(tid) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(btn.title).toBe("Batch B");
    }
  });

  // ─── Screen 5 / Screen 6 Batch B-α ────────────────────────────────

  it("clicking the Smooth interpolation toggle fires emitters/set-track-interpolation", () => {
    const { bridge, requests } = makeStubBridge();
    render(<TrackEditor tracks={fixtureTracks()} bridge={bridge} emitterId={42} />);
    fireEvent.click(screen.getByTestId("track-interp-smooth"));
    const match = requests.find(
      (r) => r.kind === "emitters/set-track-interpolation",
    );
    expect(match).toBeDefined();
    expect(match!.params).toMatchObject({
      id: 42,
      track: "red",
      interpolation: "smooth",
    });
  });

  it("interpolation toggle reflects the active track's interpolation via data-state='on'", () => {
    const tracks = fixtureTracks();
    // Promote the red track to "step" so we can prove the right
    // button is highlighted.
    tracks[0] = { ...tracks[0]!, interpolation: "step" };
    render(<TrackEditor tracks={tracks} bridge={makeStubBridge().bridge} emitterId={0} />);
    expect(
      screen.getByTestId("track-interp-step").getAttribute("data-state"),
    ).toBe("on");
    expect(
      screen.getByTestId("track-interp-linear").getAttribute("data-state"),
    ).toBe("off");
    expect(
      screen.getByTestId("track-interp-smooth").getAttribute("data-state"),
    ).toBe("off");
  });

  it("lock-to combo trigger reflects per-track options (Alpha → 4 options including None/Red/Green/Blue)", () => {
    render(<TrackEditor tracks={fixtureTracks()} />);
    // Switch to alpha.
    fireEvent.click(screen.getByTestId("track-toggle-alpha"));
    // The lock-to trigger button is present and not disabled on alpha
    // (4 options).
    const trigger = screen.getByTestId("track-lock-to-trigger") as HTMLButtonElement;
    expect(trigger).not.toBeDisabled();
  });

  it("lock-to combo is disabled when the active track only offers 'None' (Red)", () => {
    render(<TrackEditor tracks={fixtureTracks()} />);
    // Default is red — only "None".
    const trigger = screen.getByTestId("track-lock-to-trigger") as HTMLButtonElement;
    expect(trigger).toBeDisabled();
  });
});
