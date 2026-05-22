// Vitest for the PanelLayout component (B1.4 [NT-8]).
//
// PanelLayout owns the editor shell's main row: outer horizontal Group
// (left | centre | spawner) + nested vertical Groups inside the left
// column (tree / tabs) and centre column (viewport / curve). Persists
// per-Group ratios to localStorage via the `usePersistedLayout` hook,
// keyed by alo:layout:outer:{2col,3col} / alo:layout:left /
// alo:layout:center.
//
// These tests are the failing-skeleton end of T2 (the impl ships in T3).
// We pin three things:
//   1. Pure persistence helpers handle the corruption / missing-key /
//      ratio-drift cases (each test is small and the helpers stay
//      separately importable).
//   2. The PanelLayout DOM exposes the five quadrant-* data-testids
//      production code depends on (Modal.tsx querySelector,
//      Playwright specs, viewport-rect callbacks). The testIDs must
//      live on the same semantic inner divs they sit on today so
//      Risk 2 in tasks/todo.md is enforced by the test, not just by
//      vigilance.
//   3. Spawner visibility flips the spawner panel mount/unmount.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Bridge } from "@particle-editor/bridge-schema";
import { BridgeContext } from "@/lib/bridge-context";
import {
  isSeparatorDragging,
  __resetSeparatorDraggingForTests,
} from "@/lib/separator-drag";
import { PanelLayout } from "../PanelLayout";
import {
  loadLayout,
  saveLayout,
  type Layout,
} from "../PanelLayout";
import { __resetSpawnerVisibilityForTests } from "@/lib/spawner-visibility";

function makeStubBridge(): Bridge {
  return {
    request: () => Promise.resolve({}),
    on: () => () => {},
  } as unknown as Bridge;
}

beforeEach(() => {
  __resetSpawnerVisibilityForTests();
  __resetSeparatorDraggingForTests();
});

describe("PanelLayout — persistence helpers", () => {
  const DEFAULTS: Layout = { a: 25, b: 75 };

  it("loadLayout returns defaults when the key is missing", () => {
    expect(loadLayout("alo:layout:test", DEFAULTS)).toEqual(DEFAULTS);
  });

  it("loadLayout returns persisted value for a valid blob", () => {
    localStorage.setItem("alo:layout:test", JSON.stringify({ a: 40, b: 60 }));
    expect(loadLayout("alo:layout:test", DEFAULTS)).toEqual({ a: 40, b: 60 });
  });

  it("loadLayout falls back when the blob isn't JSON", () => {
    localStorage.setItem("alo:layout:test", "not-json-{{{");
    expect(loadLayout("alo:layout:test", DEFAULTS)).toEqual(DEFAULTS);
  });

  it("loadLayout falls back when a default key is missing from the blob", () => {
    // Legacy key set or partial write — keys don't match defaults shape.
    localStorage.setItem("alo:layout:test", JSON.stringify({ a: 100 }));
    expect(loadLayout("alo:layout:test", DEFAULTS)).toEqual(DEFAULTS);
  });

  it("loadLayout falls back when ratios don't sum to ~100", () => {
    localStorage.setItem("alo:layout:test", JSON.stringify({ a: 10, b: 10 }));
    expect(loadLayout("alo:layout:test", DEFAULTS)).toEqual(DEFAULTS);
  });

  it("saveLayout writes JSON to localStorage", () => {
    saveLayout("alo:layout:test", { a: 33, b: 67 });
    expect(localStorage.getItem("alo:layout:test")).toBe(
      JSON.stringify({ a: 33, b: 67 }),
    );
  });
});

describe("PanelLayout — DOM structure", () => {
  it("renders all five quadrant testIDs when Spawner is visible", () => {
    const bridge = makeStubBridge();
    render(
      <BridgeContext.Provider value={bridge}>
        <PanelLayout bridge={bridge} />
      </BridgeContext.Provider>,
    );
    // Default Spawner visibility is `true` (lib/spawner-visibility.ts).
    expect(screen.getByTestId("quadrant-emitter-tree")).toBeInTheDocument();
    expect(screen.getByTestId("quadrant-property-tabs")).toBeInTheDocument();
    expect(screen.getByTestId("quadrant-viewport")).toBeInTheDocument();
    expect(screen.getByTestId("quadrant-curve-editor")).toBeInTheDocument();
    expect(screen.getByTestId("quadrant-spawner")).toBeInTheDocument();
  });

  it("hides quadrant-spawner when Spawner visibility is false", () => {
    // Seed the localStorage-backed visibility store with `false`, then
    // reset the in-memory store so it re-reads from localStorage.
    localStorage.setItem("alo:spawner-visible", "false");
    __resetSpawnerVisibilityForTests();

    const bridge = makeStubBridge();
    render(
      <BridgeContext.Provider value={bridge}>
        <PanelLayout bridge={bridge} />
      </BridgeContext.Provider>,
    );
    expect(screen.queryByTestId("quadrant-spawner")).not.toBeInTheDocument();
    // The other four stay mounted.
    expect(screen.getByTestId("quadrant-viewport")).toBeInTheDocument();
  });

  it("quadrant-viewport rect is the innermost wrapper (Modal portal target preservation)", () => {
    const bridge = makeStubBridge();
    render(
      <BridgeContext.Provider value={bridge}>
        <PanelLayout bridge={bridge} />
      </BridgeContext.Provider>,
    );
    // Risk 2 from the plan: Modal.tsx does
    //   document.querySelector('[data-testid="quadrant-viewport"]')
    // and reads getBoundingClientRect on the result. The testID must
    // land on a div with `position: relative` (same semantics as today's
    // App.tsx:234) so positioned children (ViewportPill, tool panels,
    // Modal portal img) lay out correctly. We assert the testID node
    // is the `.relative h-full` wrapper, not a library-injected outer.
    const node = screen.getByTestId("quadrant-viewport");
    expect(node.className).toContain("relative");
  });
});

describe("PanelLayout — separator-drag popup-overlap fix", () => {
  function makeRecordingBridge() {
    const request = vi.fn().mockResolvedValue({});
    return {
      bridge: { request, on: vi.fn().mockReturnValue(() => {}) } as unknown as Bridge,
      request,
    };
  }

  it("pointerdown on a [data-separator] flips the drag flag and dispatches the degenerate-rect viewport message", () => {
    const { bridge, request } = makeRecordingBridge();
    render(
      <BridgeContext.Provider value={bridge}>
        <PanelLayout bridge={bridge} />
      </BridgeContext.Provider>,
    );
    expect(isSeparatorDragging()).toBe(false);
    const sep = document.querySelector('[data-separator]');
    expect(sep).not.toBeNull();
    fireEvent.pointerDown(sep!, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1 });
    expect(isSeparatorDragging()).toBe(true);
    // Degenerate-rect message was dispatched. The host's LayoutBroker
    // routes (w<=0||h<=0) to the no-Reset early-out at
    // src/host/LayoutBroker.cpp:24.
    expect(request).toHaveBeenCalledWith({
      kind: "layout/viewport-rect",
      params: { x: -32768, y: -32768, w: 0, h: 0 },
    });
  });

  it("pointerup anywhere on document clears the drag flag", () => {
    const { bridge } = makeRecordingBridge();
    render(
      <BridgeContext.Provider value={bridge}>
        <PanelLayout bridge={bridge} />
      </BridgeContext.Provider>,
    );
    const sep = document.querySelector('[data-separator]')!;
    fireEvent.pointerDown(sep, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1 });
    expect(isSeparatorDragging()).toBe(true);
    // pointerup is dispatched on the document with capture; testing-library's
    // fireEvent.pointerUp on document body bubbles up to the capturing listener.
    fireEvent.pointerUp(document.body, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 0 });
    expect(isSeparatorDragging()).toBe(false);
  });

  it("pointerdown on a non-separator element does NOT flip the flag or dispatch the degenerate rect", () => {
    const { bridge, request } = makeRecordingBridge();
    render(
      <BridgeContext.Provider value={bridge}>
        <PanelLayout bridge={bridge} />
      </BridgeContext.Provider>,
    );
    request.mockClear();
    const tree = screen.getByTestId("quadrant-emitter-tree");
    fireEvent.pointerDown(tree, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1 });
    expect(isSeparatorDragging()).toBe(false);
    expect(request).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "layout/viewport-rect" }),
    );
  });
});
