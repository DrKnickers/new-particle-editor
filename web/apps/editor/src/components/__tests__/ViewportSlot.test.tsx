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
import { render, screen, cleanup } from "@testing-library/react";
import type { Bridge } from "@particle-editor/bridge-schema";
import { ViewportSlot } from "../ViewportSlot";

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
