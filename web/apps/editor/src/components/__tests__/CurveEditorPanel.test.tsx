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

  // ── Hybrid focus-channel restoration ─────────────────────────────

  describe("focus channel", () => {
    it("defaults the focus channel to 'scale'", () => {
      const { bridge } = makeStubBridge(null);
      render(<CurveEditorPanel bridge={bridge} />);
      const panel = screen.getByTestId("curve-editor-panel");
      expect(panel.dataset.focusChannel).toBe("scale");
      const scaleRow = screen.getByTestId("curve-channel-row-scale");
      expect(scaleRow.dataset.focus).toBe("true");
    });

    it("clicking a different channel row moves focus + does not toggle visibility off", () => {
      const { bridge } = makeStubBridge(null);
      render(<CurveEditorPanel bridge={bridge} />);
      // Focus starts on scale. Click Red row.
      fireEvent.click(screen.getByTestId("curve-channel-row-red"));
      const panel = screen.getByTestId("curve-editor-panel");
      expect(panel.dataset.focusChannel).toBe("red");
      expect(screen.getByTestId("curve-channel-row-red").dataset.focus).toBe("true");
      expect(screen.getByTestId("curve-channel-row-scale").dataset.focus).toBe("false");
      // Red was already visible; row click MUST NOT turn it off.
      const redCb = screen.getByTestId(
        "curve-channel-checkbox-red",
      ) as HTMLInputElement;
      expect(redCb.checked).toBe(true);
    });

    it("clicking a HIDDEN channel row turns it ON and sets focus", () => {
      const { bridge } = makeStubBridge(null);
      render(<CurveEditorPanel bridge={bridge} />);
      // Index defaults OFF.
      const indexCb = screen.getByTestId(
        "curve-channel-checkbox-index",
      ) as HTMLInputElement;
      expect(indexCb.checked).toBe(false);
      // Click the Index row body (not the checkbox).
      fireEvent.click(screen.getByTestId("curve-channel-row-index"));
      // Visibility flipped ON + focus moved.
      expect(indexCb.checked).toBe(true);
      const panel = screen.getByTestId("curve-editor-panel");
      expect(panel.dataset.focusChannel).toBe("index");
    });

    it("clicking the checkbox itself toggles visibility WITHOUT changing focus", () => {
      const { bridge } = makeStubBridge(null);
      render(<CurveEditorPanel bridge={bridge} />);
      const panel = screen.getByTestId("curve-editor-panel");
      expect(panel.dataset.focusChannel).toBe("scale");
      // Click the Red checkbox — should toggle visibility off without
      // moving focus to Red.
      const redCb = screen.getByTestId(
        "curve-channel-checkbox-red",
      ) as HTMLInputElement;
      fireEvent.click(redCb);
      expect(redCb.checked).toBe(false);
      // Focus still on scale.
      expect(panel.dataset.focusChannel).toBe("scale");
    });

    it("only the focus layer carries data-focus='true'; the others carry data-focus='false'", async () => {
      const { bridge } = makeStubBridge(0);
      render(<CurveEditorPanel bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByTestId("curve-layer-scale")).toBeInTheDocument();
      });
      const scaleLayer = screen.getByTestId("curve-layer-scale");
      const redLayer = screen.getByTestId("curve-layer-red");
      expect(scaleLayer.dataset.focus).toBe("true");
      expect(redLayer.dataset.focus).toBe("false");
    });

    it("only the focus channel's keys render as interactive curve-key circles", async () => {
      const { bridge } = makeStubBridge(0);
      render(<CurveEditorPanel bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByTestId("curve-layer-scale")).toBeInTheDocument();
      });
      // Every curve-key on screen should carry data-channel-id === focus
      // (scale by default).
      const circles = document.querySelectorAll("[data-testid='curve-key']");
      expect(circles.length).toBeGreaterThan(0);
      for (const c of circles) {
        expect(c.getAttribute("data-channel-id")).toBe("scale");
      }
    });

    it("hiding the focus channel via its checkbox auto-moves focus to the next visible channel", () => {
      const { bridge } = makeStubBridge(null);
      render(<CurveEditorPanel bridge={bridge} />);
      const panel = screen.getByTestId("curve-editor-panel");
      // Focus starts on scale. Hide scale via its checkbox.
      const scaleCb = screen.getByTestId(
        "curve-channel-checkbox-scale",
      ) as HTMLInputElement;
      fireEvent.click(scaleCb);
      expect(scaleCb.checked).toBe(false);
      // Focus should auto-move to the next visible channel (red).
      expect(panel.dataset.focusChannel).toBe("red");
    });

    it("focus change clears the selected-keys set", async () => {
      const { bridge } = makeStubBridge(0);
      render(<CurveEditorPanel bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByTestId("curve-layer-scale")).toBeInTheDocument();
      });
      // Select a key on Scale.
      const circles = document.querySelectorAll("[data-testid='curve-key']");
      fireEvent.click(circles[0]!);
      const panel = screen.getByTestId("curve-editor-panel");
      expect(Number(panel.dataset.selectedKeyCount)).toBe(1);
      // Move focus to Red.
      fireEvent.click(screen.getByTestId("curve-channel-row-red"));
      expect(panel.dataset.focusChannel).toBe("red");
      expect(Number(panel.dataset.selectedKeyCount)).toBe(0);
    });
  });

  // ── Edit affordances toolbar ─────────────────────────────────────

  describe("edit toolbar", () => {
    it("renders the Select / Insert mode toggle defaulting to Select", () => {
      const { bridge } = makeStubBridge(null);
      render(<CurveEditorPanel bridge={bridge} />);
      const panel = screen.getByTestId("curve-editor-panel");
      expect(panel.dataset.mode).toBe("select");
      expect(
        screen.getByTestId("ce-tool-select").getAttribute("data-state"),
      ).toBe("on");
      expect(
        screen.getByTestId("ce-tool-insert").getAttribute("data-state"),
      ).toBe("off");
    });

    it("clicking Insert flips the mode to insert", () => {
      const { bridge } = makeStubBridge(null);
      render(<CurveEditorPanel bridge={bridge} />);
      fireEvent.click(screen.getByTestId("ce-tool-insert"));
      const panel = screen.getByTestId("curve-editor-panel");
      expect(panel.dataset.mode).toBe("insert");
      expect(
        screen.getByTestId("ce-tool-insert").getAttribute("data-state"),
      ).toBe("on");
    });

    it("clicking the Smooth interpolation toggle fires set-track-interpolation for the focus channel's track", async () => {
      const { bridge } = makeStubBridge(0);
      render(<CurveEditorPanel bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByTestId("curve-layer-scale")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("ce-interp-smooth"));
      const calls = (bridge.request as ReturnType<typeof vi.fn>).mock.calls;
      const match = calls.find(
        (call) => (call[0] as { kind: string }).kind === "emitters/set-track-interpolation",
      );
      expect(match).toBeDefined();
      expect(match![0]).toMatchObject({
        kind: "emitters/set-track-interpolation",
        params: { id: 0, track: "scale", interpolation: "smooth" },
      });
    });

    it("interpolation toggle reflects the focus track's current interpolation via data-state='on'", async () => {
      // Build a bridge where the scale track is "step".
      const listeners: SelectionListener[] = [];
      const bridge = {
        request: vi.fn().mockImplementation((req: { kind: string }) => {
          if (req.kind === "engine/state/snapshot") {
            return Promise.resolve({
              ...makeDefaultEngineState(),
              selectedEmitterId: 0,
            });
          }
          if (req.kind === "emitters/get-tracks") {
            const t = fixtureTracks();
            const scale = t.find((x) => x.name === "scale")!;
            scale.interpolation = "step";
            return Promise.resolve({ tracks: t });
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
      render(<CurveEditorPanel bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByTestId("curve-layer-scale")).toBeInTheDocument();
      });
      expect(
        screen.getByTestId("ce-interp-step").getAttribute("data-state"),
      ).toBe("on");
      expect(
        screen.getByTestId("ce-interp-linear").getAttribute("data-state"),
      ).toBe("off");
    });

    it("Lock-to combo trigger is disabled when the focus track only has 'None' (Scale)", () => {
      const { bridge } = makeStubBridge(0);
      render(<CurveEditorPanel bridge={bridge} />);
      const trigger = screen.getByTestId("ce-lock-to-trigger") as HTMLButtonElement;
      expect(trigger).toBeDisabled();
    });

    it("Lock-to combo trigger enables after switching focus to Alpha (4 options)", async () => {
      const { bridge } = makeStubBridge(0);
      render(<CurveEditorPanel bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByTestId("curve-layer-scale")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("curve-channel-row-alpha"));
      const trigger = screen.getByTestId("ce-lock-to-trigger") as HTMLButtonElement;
      expect(trigger).not.toBeDisabled();
    });
  });

  // ── Time / Value spinners ────────────────────────────────────────

  describe("spinners", () => {
    it("Time + Value spinners are disabled with no selection; populate when one key is selected", async () => {
      // Use the 3-key fixture so we have an interior key.
      const { bridge } = makeStubBridgeWithFocusInteriorKey(0);
      render(<CurveEditorPanel bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByTestId("curve-layer-scale")).toBeInTheDocument();
      });
      const queryInputs = () => ({
        time: screen.getByTestId("ce-spinner-time-wrapper").querySelector("input") as HTMLInputElement,
        value: screen.getByTestId("ce-spinner-value-wrapper").querySelector("input") as HTMLInputElement,
      });
      const before = queryInputs();
      expect(before.time.disabled).toBe(true);
      expect(before.value.disabled).toBe(true);

      // Click the middle scale key (time=50, value=50).
      const circles = document.querySelectorAll("[data-testid='curve-key']");
      const middle = Array.from(circles).find(
        (c) => c.getAttribute("data-key-time") === "50",
      );
      expect(middle).toBeDefined();
      fireEvent.click(middle!);

      await waitFor(() => {
        const after = queryInputs();
        expect(after.time.disabled).toBe(false);
        expect(after.value.disabled).toBe(false);
        expect(Number(after.time.value)).toBe(50);
        expect(Number(after.value.value)).toBeCloseTo(50, 2);
      });
    });

    it("editing the Value spinner fires set-track-key with newValue", async () => {
      const { bridge } = makeStubBridgeWithFocusInteriorKey(0);
      render(<CurveEditorPanel bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByTestId("curve-layer-scale")).toBeInTheDocument();
      });
      // Select the middle scale key (time=50).
      const circles = document.querySelectorAll("[data-testid='curve-key']");
      const middle = Array.from(circles).find(
        (c) => c.getAttribute("data-key-time") === "50",
      )!;
      fireEvent.click(middle);
      const valueInput = screen.getByTestId(
        "ce-spinner-value-wrapper",
      ).querySelector("input") as HTMLInputElement;
      await waitFor(() => expect(valueInput.disabled).toBe(false));
      fireEvent.focus(valueInput);
      fireEvent.change(valueInput, { target: { value: "75" } });
      fireEvent.blur(valueInput);
      await waitFor(() => {
        const calls = (bridge.request as ReturnType<typeof vi.fn>).mock.calls;
        const match = calls.find(
          (call) => (call[0] as { kind: string }).kind === "emitters/set-track-key",
        );
        expect(match).toBeDefined();
        expect(match![0]).toMatchObject({
          kind: "emitters/set-track-key",
          params: { id: 0, track: "scale", oldTime: 50, newTime: 50, newValue: 75 },
        });
      });
    });
  });

  // ── Delete keyboard handler ──────────────────────────────────────

  describe("Delete keyboard handler", () => {
    it("Delete key on the focused panel fires delete-track-keys (border filtered)", async () => {
      const { bridge } = makeStubBridgeWithFocusInteriorKey(7);
      render(<CurveEditorPanel bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByTestId("curve-layer-scale")).toBeInTheDocument();
      });
      // Select the middle scale key (time=50).
      const circles = document.querySelectorAll("[data-testid='curve-key']");
      const middle = Array.from(circles).find(
        (c) => c.getAttribute("data-key-time") === "50",
      )!;
      fireEvent.click(middle);
      // Fire a Delete keydown on the document body.
      fireEvent.keyDown(document.body, { key: "Delete" });
      await waitFor(() => {
        const calls = (bridge.request as ReturnType<typeof vi.fn>).mock.calls;
        const match = calls.find(
          (call) => (call[0] as { kind: string }).kind === "emitters/delete-track-keys",
        );
        expect(match).toBeDefined();
        expect(match![0]).toMatchObject({
          kind: "emitters/delete-track-keys",
          params: { id: 7, track: "scale", times: [50] },
        });
      });
    });

    it("Delete inside an <input> does NOT fire delete-track-keys", async () => {
      const { bridge } = makeStubBridgeWithFocusInteriorKey(7);
      render(<CurveEditorPanel bridge={bridge} />);
      await waitFor(() => {
        expect(screen.getByTestId("curve-layer-scale")).toBeInTheDocument();
      });
      // Select an interior key.
      const circles = document.querySelectorAll("[data-testid='curve-key']");
      const middle = Array.from(circles).find(
        (c) => c.getAttribute("data-key-time") === "50",
      )!;
      fireEvent.click(middle);
      // Now focus the Value spinner input and fire Delete on it.
      const valueInput = screen.getByTestId(
        "ce-spinner-value-wrapper",
      ).querySelector("input") as HTMLInputElement;
      valueInput.focus();
      fireEvent.keyDown(valueInput, { key: "Delete" });
      // No delete-track-keys call should appear.
      const calls = (bridge.request as ReturnType<typeof vi.fn>).mock.calls;
      const match = calls.find(
        (call) => (call[0] as { kind: string }).kind === "emitters/delete-track-keys",
      );
      expect(match).toBeUndefined();
    });
  });

  // ── Insert mode → add-track-key ──────────────────────────────────

  it("Insert mode + canvas pointer-down fires add-track-key", async () => {
    const { bridge } = makeStubBridge(0);
    render(<CurveEditorPanel bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByTestId("curve-layer-scale")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("ce-tool-insert"));
    const backdrop = screen.getByTestId("curve-canvas-backdrop");
    // jsdom getBoundingClientRect returns zeros, so eventToViewBox
    // returns NaN → no event fires. We need to stub it.
    Object.defineProperty(backdrop, "ownerSVGElement", {
      value: backdrop.parentElement,
      configurable: true,
    });
    const svg = screen.getByTestId("curve-editor-svg");
    svg.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 300,
      width: 600, height: 300, toJSON: () => ({}),
    } as DOMRect);
    fireEvent.pointerDown(backdrop, {
      button: 0,
      clientX: 300,
      clientY: 150,
      pointerId: 1,
    });
    await waitFor(() => {
      const calls = (bridge.request as ReturnType<typeof vi.fn>).mock.calls;
      const match = calls.find(
        (call) => (call[0] as { kind: string }).kind === "emitters/add-track-key",
      );
      expect(match).toBeDefined();
      expect((match![0] as { params: { track: string } }).params.track).toBe("scale");
    });
  });
});

/** Helper bridge for spinner / delete specs — adds a middle key on
 *  the scale track so we have an interior (non-border) key to act on. */
function makeStubBridgeWithFocusInteriorKey(initialSelectedId: number) {
  const listeners: SelectionListener[] = [];
  const tracksWithMiddleKey: TrackDto[] = TRACK_NAMES.map((name) => ({
    name,
    keys: name === "scale"
      ? [
          { time: 0,   value: 0 },
          { time: 50,  value: 50 },
          { time: 100, value: 100 },
        ]
      : [
          { time: 0,   value: 0 },
          { time: 100, value: name === "rotationSpeed" ? -1 : 1 },
        ],
    interpolation: "linear",
  }));
  const bridge = {
    request: vi.fn().mockImplementation((req: { kind: string }) => {
      if (req.kind === "engine/state/snapshot") {
        return Promise.resolve({
          ...makeDefaultEngineState(),
          selectedEmitterId: initialSelectedId,
        });
      }
      if (req.kind === "emitters/get-tracks") {
        return Promise.resolve({ tracks: tracksWithMiddleKey });
      }
      if (req.kind === "emitters/add-track-key") {
        const p = (req as unknown as { params: { time: number; value: number } }).params;
        return Promise.resolve({ time: p.time, value: p.value });
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
