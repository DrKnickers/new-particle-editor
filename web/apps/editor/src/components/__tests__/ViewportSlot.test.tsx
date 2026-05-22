// Vitest tests for ViewportSlot — [MT-11] Phase 1.4.
//
// Two surfaces locked down here:
//
// 1. The dual render path. When VITE_VIEWPORT_TRANSPORT is unset or
//    set to anything other than "canvas-jpeg", the slot renders the
//    placeholder span (legacy behaviour). When it's "canvas-jpeg",
//    the slot renders a <canvas data-testid="viewport-canvas"> ready
//    to receive engine pixels.
//
// 2. The bridge contract. ViewportSlot dispatches `layout/scene-rect`
//    on mount; under canvas-jpeg it also subscribes to
//    `viewport/frame-ready` and tears the subscription down on
//    unmount.
//
// The actual paint loop (Image() decode + drawImage) is exercised at
// runtime via the C++ host — see Phase 1.5 smoke notes in
// tasks/todo.md §6. jsdom has neither a real canvas backing-store nor
// a real Image decoder, so unit-testing the paint path here would be
// all mocks and no real signal.
//
// The arch-C flag is read inside the component (via
// `isArchCEnabled()`) so `vi.stubEnv` controls it per-test without
// any module-reset dance.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import type { Bridge } from "@particle-editor/bridge-schema";
import { ViewportSlot } from "../ViewportSlot";
import { MK_LBUTTON, MK_SHIFT } from "../../lib/viewport-input";

function makeStubBridge(): Bridge & {
  request: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
} {
  const request = vi.fn().mockResolvedValue({});
  const on = vi.fn().mockReturnValue(() => {});
  return { request, on } as unknown as Bridge & {
    request: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };
}

describe("ViewportSlot — legacy path (VITE_VIEWPORT_TRANSPORT unset)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_VIEWPORT_TRANSPORT", "");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("renders the 'D3D9 viewport' placeholder span, no canvas", () => {
    const bridge = makeStubBridge();
    render(<ViewportSlot bridge={bridge} />);
    expect(screen.getByText("D3D9 viewport")).toBeInTheDocument();
    expect(screen.queryByTestId("viewport-canvas")).not.toBeInTheDocument();
  });

  it("dispatches layout/scene-rect on mount with DPR-scaled w/h", () => {
    const bridge = makeStubBridge();
    render(<ViewportSlot bridge={bridge} />);
    expect(bridge.request).toHaveBeenCalled();
    const firstCall = bridge.request.mock.calls[0]?.[0];
    expect(firstCall?.kind).toBe("layout/scene-rect");
    expect(firstCall?.params).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
      w: expect.any(Number),
      h: expect.any(Number),
    });
  });

  it("does NOT subscribe to viewport/frame-ready in legacy mode", () => {
    const bridge = makeStubBridge();
    render(<ViewportSlot bridge={bridge} />);
    const subscribedKinds = bridge.on.mock.calls.map((c) => c[0]);
    expect(subscribedKinds).not.toContain("viewport/frame-ready");
  });
});

describe("ViewportSlot — canvas-jpeg path (VITE_VIEWPORT_TRANSPORT='canvas-jpeg')", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_VIEWPORT_TRANSPORT", "canvas-jpeg");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("mounts a <canvas data-testid='viewport-canvas'> instead of the placeholder", () => {
    const bridge = makeStubBridge();
    render(<ViewportSlot bridge={bridge} />);
    const canvas = screen.getByTestId("viewport-canvas");
    expect(canvas).toBeInTheDocument();
    expect(canvas.tagName).toBe("CANVAS");
    expect(screen.queryByText("D3D9 viewport")).not.toBeInTheDocument();
  });

  it("subscribes to viewport/frame-ready on mount", () => {
    const bridge = makeStubBridge();
    render(<ViewportSlot bridge={bridge} />);
    const subscribedKinds = bridge.on.mock.calls.map((c) => c[0]);
    expect(subscribedKinds).toContain("viewport/frame-ready");
  });

  it("unsubscribes from viewport/frame-ready on unmount", () => {
    const unsubscribe = vi.fn();
    const bridge = {
      request: vi.fn().mockResolvedValue({}),
      on: vi.fn().mockReturnValue(unsubscribe),
    } as unknown as Bridge & {
      request: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
    };
    const { unmount } = render(<ViewportSlot bridge={bridge} />);
    expect(unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});

// ─── [MT-11] Phase 2 input forwarding ────────────────────────────────
//
// These tests assert the DOM event → bridge.request wiring. The pure-
// function encoders are exercised in lib/__tests__/viewport-input.test.ts;
// here we lock down that the listeners get attached on mount, fire the
// right Request kind + payload shape, and detach on unmount.

function findViewportInputCalls(
  bridge: { request: ReturnType<typeof vi.fn> },
): Array<{ kind: string; params: Record<string, unknown> }> {
  return bridge.request.mock.calls
    .map((c) => c[0] as { kind: string; params: Record<string, unknown> })
    .filter((req) => req.kind === "viewport/input");
}

describe("ViewportSlot — Phase 2 input forwarding (canvas-jpeg only)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_VIEWPORT_TRANSPORT", "canvas-jpeg");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("pointerdown on canvas dispatches viewport/input { type: 'mousedown' }", () => {
    const bridge = makeStubBridge();
    render(<ViewportSlot bridge={bridge} />);
    const canvas = screen.getByTestId("viewport-canvas");
    fireEvent.pointerDown(canvas, {
      clientX: 100,
      clientY: 200,
      button: 0,
      buttons: 1,
      pointerId: 1,
    });
    const inputs = findViewportInputCalls(bridge);
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs[0]?.params).toMatchObject({
      type: "mousedown",
      button: "left",
      x: 100,
      y: 200,
      buttons: MK_LBUTTON,
    });
  });

  it("pointerdown with shiftKey encodes MK_SHIFT in buttons bitmask", () => {
    const bridge = makeStubBridge();
    render(<ViewportSlot bridge={bridge} />);
    const canvas = screen.getByTestId("viewport-canvas");
    fireEvent.pointerDown(canvas, {
      clientX: 0,
      clientY: 0,
      button: 0,
      buttons: 1,
      shiftKey: true,
      pointerId: 1,
    });
    const inputs = findViewportInputCalls(bridge);
    expect(inputs[0]?.params.buttons).toBe(MK_LBUTTON | MK_SHIFT);
  });

  it("pointermove on canvas dispatches viewport/input { type: 'mousemove' }", () => {
    const bridge = makeStubBridge();
    render(<ViewportSlot bridge={bridge} />);
    const canvas = screen.getByTestId("viewport-canvas");
    fireEvent.pointerMove(canvas, { clientX: 50, clientY: 75, buttons: 0 });
    const inputs = findViewportInputCalls(bridge);
    expect(inputs.some((r) => r.params.type === "mousemove")).toBe(true);
  });

  it("wheel on canvas dispatches viewport/input { type: 'wheel' } with sign-flipped delta", () => {
    const bridge = makeStubBridge();
    render(<ViewportSlot bridge={bridge} />);
    const canvas = screen.getByTestId("viewport-canvas");
    fireEvent.wheel(canvas, { clientX: 10, clientY: 10, deltaY: 100 });
    const inputs = findViewportInputCalls(bridge);
    const wheel = inputs.find((r) => r.params.type === "wheel");
    expect(wheel).toBeTruthy();
    expect(wheel?.params.deltaY).toBe(-120);  // DOM +100 → Win32 -WHEEL_DELTA
  });

  it("window keydown of VK_SHIFT (keyCode=16) dispatches viewport/input { type: 'keydown', vk: 16 }", () => {
    const bridge = makeStubBridge();
    render(<ViewportSlot bridge={bridge} />);
    fireEvent.keyDown(window, { keyCode: 16, key: "Shift" });
    const inputs = findViewportInputCalls(bridge);
    const key = inputs.find((r) => r.params.type === "keydown");
    expect(key).toBeTruthy();
    expect(key?.params).toMatchObject({ type: "keydown", vk: 16, repeat: false });
  });

  it("TYPING_TAGS guard: keydown with target=INPUT does NOT dispatch", () => {
    const bridge = makeStubBridge();
    render(
      <div>
        <input data-testid="text-input" />
        <ViewportSlot bridge={bridge} />
      </div>,
    );
    const input = screen.getByTestId("text-input");
    fireEvent.keyDown(input, { keyCode: 16, key: "Shift" });
    const inputs = findViewportInputCalls(bridge);
    expect(inputs.find((r) => r.params.type === "keydown")).toBeUndefined();
  });

  it("window.blur dispatches viewport/input { type: 'blur' }", () => {
    const bridge = makeStubBridge();
    render(<ViewportSlot bridge={bridge} />);
    fireEvent.blur(window);
    const inputs = findViewportInputCalls(bridge);
    expect(inputs.some((r) => r.params.type === "blur")).toBe(true);
  });

  it("does NOT attach listeners in legacy mode (env unset)", () => {
    vi.stubEnv("VITE_VIEWPORT_TRANSPORT", "");
    const bridge = makeStubBridge();
    render(<ViewportSlot bridge={bridge} />);
    // Canvas isn't even rendered; window-level keydown should be a no-op.
    fireEvent.keyDown(window, { keyCode: 16, key: "Shift" });
    const inputs = findViewportInputCalls(bridge);
    expect(inputs.length).toBe(0);
  });
});
