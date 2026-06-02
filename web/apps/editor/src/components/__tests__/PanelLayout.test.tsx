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

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Bridge } from "@particle-editor/bridge-schema";
import { BridgeContext } from "@/lib/bridge-context";
import { PanelLayout } from "../PanelLayout";
import {
  loadLayout,
  saveLayout,
  resetPanelLayoutStorage,
  deriveOuterLayoutOnToggle,
  PANEL_LAYOUT_KEYS,
  type Layout,
} from "../PanelLayout";
import { __resetRightDockForTests, setDock } from "@/lib/right-dock";

function makeStubBridge(): Bridge {
  return {
    request: () => Promise.resolve({}),
    on: () => () => {},
  } as unknown as Bridge;
}

beforeEach(() => {
  localStorage.removeItem("alo:right-dock");
  localStorage.removeItem("alo:spawner-visible");
  __resetRightDockForTests();
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

describe("PanelLayout — Reset panel layout (T6)", () => {
  it("resetPanelLayoutStorage clears every key listed in PANEL_LAYOUT_KEYS", () => {
    // Seed every persisted-layout key with arbitrary content; the
    // helper should wipe all four without touching unrelated keys.
    for (const k of PANEL_LAYOUT_KEYS) {
      localStorage.setItem(k, JSON.stringify({ stub: 1 }));
    }
    localStorage.setItem("alo:unrelated", "keep-me");

    resetPanelLayoutStorage();

    for (const k of PANEL_LAYOUT_KEYS) {
      expect(localStorage.getItem(k)).toBeNull();
    }
    expect(localStorage.getItem("alo:unrelated")).toBe("keep-me");
  });

  it("loadLayout returns defaults for every key after resetPanelLayoutStorage", () => {
    // End-to-end: a stored layout is honoured first, then the reset
    // gesture restores defaults on the next read.
    const DEFAULTS: Layout = { x: 30, y: 70 };
    for (const k of PANEL_LAYOUT_KEYS) {
      localStorage.setItem(k, JSON.stringify({ x: 60, y: 40 }));
      expect(loadLayout(k, DEFAULTS)).toEqual({ x: 60, y: 40 });
    }
    resetPanelLayoutStorage();
    for (const k of PANEL_LAYOUT_KEYS) {
      expect(loadLayout(k, DEFAULTS)).toEqual(DEFAULTS);
    }
  });

  it("PANEL_LAYOUT_KEYS covers every key PanelLayout writes (outer:2col/3col + left + center)", () => {
    // Guards against drift: if a future change adds a new persisted
    // Group, this test must be updated alongside PANEL_LAYOUT_KEYS or
    // the menu item silently leaks state across resets.
    expect([...PANEL_LAYOUT_KEYS].sort()).toEqual([
      "alo:layout:center",
      "alo:layout:left",
      "alo:layout:outer:2col",
      "alo:layout:outer:3col",
    ]);
  });
});

describe("PanelLayout — spawner-toggle carry-over (no snap)", () => {
  it("closing carries left's width and lets center absorb the spawner's space", () => {
    const out = deriveOuterLayoutOnToggle(
      false,
      { left: 20, center: 80 }, // cur2col (ignored on close)
      { left: 30, center: 50, spawner: 20 }, // current 3col
    );
    expect(out).toEqual({ left: 30, center: 70 });
  });

  it("opening carves the spawner (its last 3-col width) out of center, left unchanged", () => {
    const out = deriveOuterLayoutOnToggle(
      true,
      { left: 30, center: 70 }, // current 2col
      { left: 30, center: 50, spawner: 20 }, // last 3col (for spawner width)
    );
    expect(out).toEqual({ left: 30, center: 50, spawner: 20 });
  });

  it("opening clamps so center never drops below 30%", () => {
    const out = deriveOuterLayoutOnToggle(
      true,
      { left: 65, center: 35 },
      { left: 20, center: 60, spawner: 20 },
    );
    // spawner = min(20, 35 - 30) = 5
    expect(out).toEqual({ left: 65, center: 30, spawner: 5 });
  });

  it("result always sums to ~100", () => {
    const close = deriveOuterLayoutOnToggle(false, { left: 20, center: 80 }, { left: 25, center: 55, spawner: 20 });
    const open = deriveOuterLayoutOnToggle(true, { left: 25, center: 75 }, { left: 25, center: 55, spawner: 20 });
    const sum = (l: Layout) => Object.values(l).reduce((a, b) => a + b, 0);
    expect(sum(close)).toBeCloseTo(100, 5);
    expect(sum(open)).toBeCloseTo(100, 5);
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
    // Default right-dock is `"spawner"` (lib/right-dock.ts).
    expect(screen.getByTestId("quadrant-emitter-tree")).toBeInTheDocument();
    expect(screen.getByTestId("quadrant-property-tabs")).toBeInTheDocument();
    expect(screen.getByTestId("quadrant-viewport")).toBeInTheDocument();
    expect(screen.getByTestId("quadrant-curve-editor")).toBeInTheDocument();
    expect(screen.getByTestId("quadrant-spawner")).toBeInTheDocument();
  });

  it("hides the right-dock column when the dock is closed", () => {
    // Seed the localStorage-backed dock store with `none`, then reset the
    // in-memory store so it re-reads from localStorage.
    localStorage.setItem("alo:right-dock", "none");
    __resetRightDockForTests();

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

  it("renders the Lighting pane in the shared right-dock slot when dock=lighting", () => {
    // The slot keeps the `quadrant-spawner` testid (its identity is the
    // right-dock, not the tool inside); the content is the Lighting pane,
    // and the centre column (curve editor) stays mounted alongside it.
    setDock("lighting");
    const bridge = makeStubBridge();
    render(
      <BridgeContext.Provider value={bridge}>
        <PanelLayout bridge={bridge} />
      </BridgeContext.Provider>,
    );
    expect(screen.getByTestId("quadrant-spawner")).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Lighting" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("quadrant-curve-editor")).toBeInTheDocument();
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
