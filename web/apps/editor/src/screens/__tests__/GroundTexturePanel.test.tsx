// Vitest unit tests for the GroundTexturePanel.
// Verifies that clicking a bundled slot tile dispatches
// engine/set/ground-texture with the correct slot index.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GroundTexturePanel } from "../GroundTexturePanel";
import type { Bridge } from "@particle-editor/bridge-schema";

function makeStubBridge(): Bridge & { request: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> } {
  const snapshot = {
    ground: true,
    groundZ: 0,
    groundTexture: 0,
    groundSolidColor: 0x00888888,
    groundSlotCustomPaths: ["", "", "", "", "", "", "", ""],
    skydomeSlot: 0,
    skydomeCustomPaths: ["", "", ""],
    background: 0,
    lights: {
      sun: { diffuse: [1, 1, 1, 1], specular: [1, 1, 1, 1], position: [0, 0, 1, 0], direction: [0, 0, 0, 0] },
      fill1: { diffuse: [0, 0, 0, 1], specular: [0, 0, 0, 1], position: [0, 0, 1, 0], direction: [0, 0, 0, 0] },
      fill2: { diffuse: [0, 0, 0, 1], specular: [0, 0, 0, 1], position: [0, 0, 1, 0], direction: [0, 0, 0, 0] },
    },
    ambient: [0, 0, 0, 1],
    shadow: [0, 0, 0, 1],
    bloom: false,
    bloomAvailable: true,
    bloomStrength: 1,
    bloomCutoff: 0.5,
    bloomSize: 8,
    heatDebug: false,
    paused: false,
    camera: { position: [0, 0, 0], target: [0, 0, 0], up: [0, 0, 1] },
    wind: [0, 0, 0],
    gravity: [0, 0, 0],
  };
  return {
    request: vi.fn().mockImplementation((req: { kind: string }) => {
      if (req.kind === "engine/state/snapshot") return Promise.resolve(snapshot);
      return Promise.resolve({});
    }),
    on: vi.fn().mockReturnValue(() => {}),
  } as unknown as Bridge & { request: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
}

describe("GroundTexturePanel", () => {
  it("clicking a bundled slot dispatches engine/set/ground-texture with the correct slot", () => {
    const bridge = makeStubBridge();
    render(<GroundTexturePanel bridge={bridge} onClose={() => {}} />);
    // Click the Grass tile (slot 1).
    const grass = screen.getByRole("button", { name: "Grass" });
    fireEvent.click(grass);
    const calls = (bridge.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const setSlot = calls.find((c) => c.kind === "engine/set/ground-texture");
    expect(setSlot).toBeDefined();
    expect(setSlot.params.slot).toBe(1);
  });
});
