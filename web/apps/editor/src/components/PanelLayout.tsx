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

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Group, Panel, Separator, type Layout } from "react-resizable-panels";
import type { Bridge } from "@particle-editor/bridge-schema";
import { useSpawnerVisible } from "@/lib/spawner-visibility";
import { useOpenToolPanel, setOpenToolPanel } from "@/lib/tool-panel";
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

// B1.4 T6: every localStorage key PanelLayout owns. Exported so the
// View → Reset panel layout menu item can clear them all in one shot
// before AppShell bumps the key= that remounts PanelLayout with the
// in-code defaults above.
export const PANEL_LAYOUT_KEYS = [
  "alo:layout:outer:2col",
  "alo:layout:outer:3col",
  "alo:layout:left",
  "alo:layout:center",
] as const;

/** Clear every persisted panel-layout entry. Used by the View →
 *  Reset panel layout menu item. Combined with a `key=` bump on the
 *  PanelLayout mount, this forces every Group to re-read defaults on
 *  the next mount. */
export function resetPanelLayoutStorage(): void {
  if (typeof localStorage === "undefined") return;
  for (const key of PANEL_LAYOUT_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* localStorage disabled — drop silently */
    }
  }
}

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

// Derive the outer layout when the Spawner pane toggles, carrying the
// CURRENT widths across instead of snapping to the destination mode's
// stored preset: `left` keeps its width, and the spawner's space simply
// transfers to/from `center`. This makes closing the Spawner "absorb"
// its space into the viewport column (and reopening carve it back out)
// rather than re-laying-out every pane.
//
//   - Closing (3-col → 2-col): center += spawner. Reads the live 3-col
//     layout (the mode we're leaving).
//   - Opening (2-col → 3-col): carve the spawner back out of center at
//     its last 3-col width, clamped so center never drops below 30%
//     (its minSize). Reads the live 2-col layout for left/center.
//
// Every result sums to ~100 by construction.
const CENTER_MIN_PCT = 30;

export function deriveOuterLayoutOnToggle(
  nextSpawnerVisible: boolean,
  cur2col: Layout,
  cur3col: Layout,
): Layout {
  if (!nextSpawnerVisible) {
    return {
      left: cur3col.left ?? 0,
      center: (cur3col.center ?? 0) + (cur3col.spawner ?? 0),
    };
  }
  const desired = cur3col.spawner ?? OUTER_3COL_DEFAULTS.spawner;
  const headroom = Math.max((cur2col.center ?? 0) - CENTER_MIN_PCT, 0);
  const spawner = Math.min(desired, headroom);
  return {
    left: cur2col.left ?? 0,
    center: (cur2col.center ?? 0) - spawner,
    spawner,
  };
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

  // The outer Group is key'd on spawnerVisible, so it remounts on every
  // Spawner toggle. Rather than letting it snap to the destination mode's
  // independently-stored preset, carry the CURRENT widths across (left
  // stays put; center absorbs / releases the spawner's space). Only on
  // the toggle transition — a fresh mount uses the mode's own layout.
  const prevSpawnerVisible = useRef<boolean | null>(null);
  const toggled =
    prevSpawnerVisible.current !== null &&
    prevSpawnerVisible.current !== spawnerVisible;

  const outerDefaultLayout = useMemo<Layout>(() => {
    if (toggled) {
      return deriveOuterLayoutOnToggle(
        spawnerVisible,
        loadLayout("alo:layout:outer:2col", OUTER_2COL_DEFAULTS),
        loadLayout("alo:layout:outer:3col", OUTER_3COL_DEFAULTS),
      );
    }
    return loadLayout(outerKey, outerDefaults);
  }, [toggled, spawnerVisible, outerKey, outerDefaults]);

  const onOuterLayoutChanged = useCallback(
    (l: Layout) => saveLayout(outerKey, l),
    [outerKey],
  );

  // Persist the carried-over layout to the destination key so the next
  // toggle reads consistent state; advance the prev-visible marker.
  useEffect(() => {
    if (toggled) saveLayout(outerKey, outerDefaultLayout);
    prevSpawnerVisible.current = spawnerVisible;
  }, [toggled, spawnerVisible, outerKey, outerDefaultLayout]);

  const left = usePersistedLayout("alo:layout:left", LEFT_DEFAULTS);
  const center = usePersistedLayout("alo:layout:center", CENTER_DEFAULTS);

  // B1.4 [NT-8] T4c: React no longer dispatches a popup-rect to the
  // host. The host self-sizes the engine popup HWND to its own main
  // client area on WM_CREATE / WM_SIZE / WM_WINDOWPOSCHANGED
  // (HostWindow.cpp). The popup is therefore stable across splitter
  // drags — only the SCENE rect changes, dispatched by ViewportSlot
  // as layout/scene-rect. Zero React→host postMessages for layout
  // rect (other than the per-frame scene-rect updates).

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
      defaultLayout={outerDefaultLayout}
      onLayoutChanged={onOuterLayoutChanged}
      style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
    >
      {/* Pixel (not %) minSize: inspector `.form-row` labels live in a
          flexible column with text-overflow:ellipsis, so they truncate
          when this pane is dragged narrow. A % floor is window-relative
          (fine when wide, truncates on small windows); a px floor is
          absolute. 330px fits the longest spinner-row label
          ("Distance from camera:") next to its 58px/40px input+unit
          columns. (Long *checkbox* labels are handled separately by the
          `.form-row-check` grid, which frees the column the checkbox
          otherwise wasted.) maxSize stays a % so a wide window caps it. */}
      <Panel
        id="left"
        defaultSize={`${outerDefaultLayout.left}%`}
        minSize={330}
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
        defaultSize={`${outerDefaultLayout.center}%`}
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
          {/* Pixel minSize for the same reason as `left`: the Spawner
              panel's labels (e.g. "Initial spawn delay:") truncate when
              dragged narrow. ~260px keeps them readable. */}
          <Panel
            id="spawner"
            defaultSize={`${outerDefaultLayout.spawner}%`}
            minSize={260}
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
