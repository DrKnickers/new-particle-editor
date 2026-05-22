// PanelLayout — B1.4 [NT-8] resizable splitters for the editor shell's
// main row.
//
// Replaces the Tailwind flex layout that used to live in App.tsx's
// "Main row" block (the panel + viewport + spawner three-column grid)
// with a tree of nested `react-resizable-panels` Groups. Four
// splitters:
//
//   1. left ↔ centre   (outer Group, horizontal)
//   2. centre ↔ spawner (outer Group, horizontal; only when spawnerVisible)
//   3. viewport ↔ curve (centre Group, vertical)
//   4. tree ↔ tabs      (left Group, vertical)
//
// Persistence is DIY in 4.x (autoSaveId is gone): on mount we read
// {alo:layout:outer:{2col|3col}, alo:layout:left, alo:layout:center}
// from localStorage and pass them as the Group's `defaultLayout`; on
// pointer-release the library calls `onLayoutChanged` with the new
// percentage map, which we persist back. Each Group's stored blob is
// validated on read (JSON.parse, key set matches defaults, ratios sum
// to ~100); any failure falls back to in-code defaults rather than
// crashing the layout.
//
// The five quadrant-* data-testids live on the inner divs *inside*
// each Panel's children, not on the Panel itself. Two reasons:
//   - Risk 2 in the plan: Modal.tsx's
//     `document.querySelector('[data-testid="quadrant-viewport"]')`
//     and the subsequent getBoundingClientRect rely on the rect
//     matching the viewport pixels exactly. Placing the testID on
//     our own `.relative h-full` div keeps the geometry identical to
//     today's App.tsx:234 site.
//   - The library's Panel renders a wrapper div (className lands on
//     a nested DOM node); the testID on our inner div keeps the
//     rect semantics unambiguous.
//
// Spawner mount/unmount: 4.x doesn't hash the panel-id set into the
// persistence key, so the 3-col state (left+centre+spawner) and the
// 2-col state (left+centre) get distinct localStorage keys
// (`:3col` vs `:2col`). The outer Group is `key`'d on
// `spawnerVisible` so React fully remounts it when the user flips
// the toolbar's Spawner button — the new mount reads from the
// appropriate key with the appropriate defaults.

import { useCallback, useEffect, useMemo } from "react";
import { Group, Panel, Separator, type Layout } from "react-resizable-panels";
import type { Bridge } from "@particle-editor/bridge-schema";
import { useSpawnerVisible } from "@/lib/spawner-visibility";
import { useOpenToolPanel, setOpenToolPanel } from "@/lib/tool-panel";
import { setSeparatorDragging } from "@/lib/separator-drag";
import { ViewportSlot } from "./ViewportSlot";
import { ViewportPill } from "./ViewportPill";
import { CurveEditorPanel } from "./CurveEditorPanel";
import { EmitterPropertyTabs } from "@/screens/EmitterPropertyTabs";
import { EmitterTree } from "@/screens/EmitterTree";
import { LightingPanel } from "@/screens/LightingPanel";
import { BloomPanel } from "@/screens/BloomPanel";
import { SpawnerPanel } from "@/screens/SpawnerPanel";

export type { Layout };

// In-code defaults. Each map's keys must match the id= attributes on
// the corresponding Panel components below.
const OUTER_3COL_DEFAULTS: Layout = { left: 20, center: 60, spawner: 20 };
const OUTER_2COL_DEFAULTS: Layout = { left: 20, center: 80 };
const LEFT_DEFAULTS: Layout = { tree: 25, tabs: 75 };
const CENTER_DEFAULTS: Layout = { viewport: 75, curve: 25 };

/** Persisted-layout reader. Pure for unit-testability. */
export function loadLayout(key: string, defaults: Layout): Layout {
  try {
    const raw =
      (typeof localStorage !== "undefined") ? localStorage.getItem(key) : null;
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") return defaults;
    const m = parsed as Record<string, unknown>;
    const allKeysMatch = Object.keys(defaults).every(
      (k) => typeof m[k] === "number" && Number.isFinite(m[k]),
    );
    if (!allKeysMatch) return defaults;
    const sum = Object.keys(defaults).reduce((a, k) => a + (m[k] as number), 0);
    if (Math.abs(sum - 100) > 0.5) return defaults;
    // Strip any extra keys not in defaults — the Group ignores them, but
    // keeping persistence shape clean avoids accidental key drift.
    const trimmed: Layout = {};
    for (const k of Object.keys(defaults)) trimmed[k] = m[k] as number;
    return trimmed;
  } catch {
    return defaults;
  }
}

/** Persisted-layout writer. Drops silently if localStorage is full / disabled. */
export function saveLayout(key: string, layout: Layout): void {
  try {
    localStorage.setItem(key, JSON.stringify(layout));
  } catch {
    /* localStorage full / disabled — drop silently */
  }
}

function usePersistedLayout(key: string, defaults: Layout) {
  // useMemo with [key] so a visibility flip (key change) re-reads.
  const defaultLayout = useMemo(() => loadLayout(key, defaults), [key, defaults]);
  const onLayoutChanged = useCallback(
    (layout: Layout) => {
      saveLayout(key, layout);
    },
    [key],
  );
  return { defaultLayout, onLayoutChanged };
}

type Props = { bridge: Bridge };

export function PanelLayout({ bridge }: Props) {
  const spawnerVisible = useSpawnerVisible();
  const openPanel = useOpenToolPanel();

  const outerKey = spawnerVisible
    ? "alo:layout:outer:3col"
    : "alo:layout:outer:2col";
  const outerDefaults = spawnerVisible
    ? OUTER_3COL_DEFAULTS
    : OUTER_2COL_DEFAULTS;

  const outer = usePersistedLayout(outerKey, outerDefaults);
  const left = usePersistedLayout("alo:layout:left", LEFT_DEFAULTS);
  const center = usePersistedLayout("alo:layout:center", CENTER_DEFAULTS);

  // B1.4 [NT-8] drag-resize popup fix. The engine viewport is a
  // top-level layered Win32 popup composited above WebView2.
  // ViewportSlot's ResizeObserver fires `layout/viewport-rect` per
  // frame, and LayoutBroker::Apply runs an expensive D3D9
  // Engine::Reset on every non-degenerate size change. During a
  // fast splitter drag this stacks resets and the popup falls far
  // behind the WebView's flex layout — the popup paints over the
  // neighbouring pane until pointerup.
  //
  // Fix (L-014 follow-up): on pointerdown to any [data-separator],
  // dispatch a single degenerate-size rect that routes to
  // LayoutBroker's no-Reset early-out (popup parked at -32768,-32768
  // with 1×1 size). ViewportSlot short-circuits its per-frame send
  // while the flag is true. On pointerup, ViewportSlot's
  // drag-subscribe listener re-emits the final rect once — one
  // Reset, not N.
  useEffect(() => {
    function onDown(e: PointerEvent) {
      const t = e.target;
      if (!(t instanceof Element) || !t.closest("[data-separator]")) return;
      setSeparatorDragging(true);
      // Park the popup offscreen with degenerate size. LayoutBroker's
      // `w<=0||h<=0` early-out at src/host/LayoutBroker.cpp:24 skips
      // Engine::Reset, which is the load-bearing performance win.
      void bridge.request({
        kind: "layout/viewport-rect",
        params: { x: -32768, y: -32768, w: 0, h: 0 },
      }).catch(() => { /* ignore */ });
    }
    function onUp() {
      setSeparatorDragging(false);
      // ViewportSlot's subscription fires send() once on the
      // transition to false, repositioning the popup at the final
      // quadrant rect.
    }
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onUp, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onUp, true);
    };
  }, [bridge]);

  // 4.x quirk: when a Group mounts with `groupSize === 0` (typical
  // for nested flex containers on first paint), the library flips
  // `defaultLayoutDeferred = true` and, on the first ResizeObserver
  // tick once the group gains real size, calls `We(panels)` —
  // which reads each Panel's `defaultSize` prop and IGNORES the
  // Group's `defaultLayout`. The Group prop is effectively an
  // SSR-hydration hint only. So per-Panel `defaultSize` is the
  // canonical knob — pull it from the loaded layout.
  return (
    <Group
      key={spawnerVisible ? "3col" : "2col"}
      orientation="horizontal"
      defaultLayout={outer.defaultLayout}
      onLayoutChanged={outer.onLayoutChanged}
      style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
    >
      <Panel
        id="left"
        defaultSize={`${outer.defaultLayout.left}%`}
        minSize="15%"
        maxSize="40%"
      >
        <div className="panel h-full w-full">
          <div className="panel-header">
            <span>Particle System</span>
          </div>
          <div className="panel-body flex min-h-0 flex-col overflow-hidden">
            <Group
              orientation="vertical"
              defaultLayout={left.defaultLayout}
              onLayoutChanged={left.onLayoutChanged}
              style={{ flex: 1, minHeight: 0 }}
            >
              <Panel
                id="tree"
                defaultSize={`${left.defaultLayout.tree}%`}
                minSize="10%"
              >
                <aside
                  data-testid="quadrant-emitter-tree"
                  className="h-full w-full min-h-0 overflow-hidden flex flex-col p-3 text-sm"
                >
                  <EmitterTree bridge={bridge} />
                </aside>
              </Panel>
              <Separator className="ce-splitter ce-splitter-h" />
              <Panel
                id="tabs"
                defaultSize={`${left.defaultLayout.tabs}%`}
                minSize="20%"
              >
                <div
                  data-testid="quadrant-property-tabs"
                  className="h-full w-full min-h-0"
                >
                  <EmitterPropertyTabs bridge={bridge} />
                </div>
              </Panel>
            </Group>
          </div>
        </div>
      </Panel>

      <Separator className="ce-splitter ce-splitter-v" />

      <Panel
        id="center"
        defaultSize={`${outer.defaultLayout.center}%`}
        minSize="30%"
      >
        <Group
          orientation="vertical"
          defaultLayout={center.defaultLayout}
          onLayoutChanged={center.onLayoutChanged}
          style={{ flex: 1, minHeight: 0, width: "100%" }}
        >
          <Panel
            id="viewport"
            defaultSize={`${center.defaultLayout.viewport}%`}
            minSize="30%"
          >
            <div
              data-testid="quadrant-viewport"
              className="relative h-full w-full min-h-0"
            >
              <ViewportSlot bridge={bridge} />
              <ViewportPill bridge={bridge} />
              {openPanel === "lighting" && (
                <LightingPanel
                  bridge={bridge}
                  onClose={() => setOpenToolPanel(null)}
                />
              )}
              {openPanel === "bloom" && (
                <BloomPanel
                  bridge={bridge}
                  onClose={() => setOpenToolPanel(null)}
                />
              )}
            </div>
          </Panel>
          <Separator className="ce-splitter ce-splitter-h" />
          <Panel
            id="curve"
            defaultSize={`${center.defaultLayout.curve}%`}
            minSize="10%"
          >
            <div
              data-testid="quadrant-curve-editor"
              className="h-full w-full min-h-0 border-t border-border"
            >
              <CurveEditorPanel bridge={bridge} />
            </div>
          </Panel>
        </Group>
      </Panel>

      {spawnerVisible && (
        <>
          <Separator className="ce-splitter ce-splitter-v" />
          <Panel
            id="spawner"
            defaultSize={`${outer.defaultLayout.spawner}%`}
            minSize="12%"
            maxSize="40%"
          >
            <aside
              data-testid="quadrant-spawner"
              className="h-full w-full overflow-hidden border-l border-border bg-panel"
            >
              <SpawnerPanel bridge={bridge} />
            </aside>
          </Panel>
        </>
      )}
    </Group>
  );
}
