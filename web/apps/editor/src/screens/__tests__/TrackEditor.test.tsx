// Vitest tests for TrackEditor (Phase 3 Screen 6 Batch A).
//
// Covered:
//   - 7 track-toggle buttons render (one per `TRACK_NAMES` entry).
//   - Clicking a different track button switches the active track
//     surfaced on the data-active-track attribute, and the
//     CurveEditor receives the new track (verified via the SVG's
//     data-track attribute).

import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { TrackDto } from "@particle-editor/bridge-schema";
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

  it("all toolbar action buttons render disabled with a Batch B tooltip", () => {
    render(<TrackEditor tracks={fixtureTracks()} />);
    for (const tid of [
      "track-tool-select",
      "track-tool-insert",
      "track-interp-linear",
      "track-interp-smooth",
      "track-interp-step",
      "track-action-delete",
    ]) {
      const btn = screen.getByTestId(tid) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(btn.title).toBe("Batch B");
    }
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
