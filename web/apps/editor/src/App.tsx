import { useEffect, useMemo, useState } from "react";
import { makeBridge } from "@/bridge";
import { exposeBridgeForTests } from "@/bridge/expose";
import { ViewportSlot } from "@/components/ViewportSlot";
import { StatusBar } from "@/components/StatusBar";
import { Toolbar } from "@/components/Toolbar";
import { MenuBar } from "@/components/MenuBar";
import { EmitterPropertyPanel } from "@/screens/EmitterPropertyPanel";
import { EmitterPropertyTabs } from "@/screens/EmitterPropertyTabs";
import { EmitterTree } from "@/screens/EmitterTree";
import { LightingPanel } from "@/screens/LightingPanel";
import { BloomPanel } from "@/screens/BloomPanel";
import { SpawnerPanel } from "@/screens/SpawnerPanel";
import { ImportEmittersDialog } from "@/screens/ImportEmittersDialog";
import { ModNicknameDialog } from "@/screens/ModNicknameDialog";
import { PrimitivesGallery } from "@/screens/PrimitivesGallery";
import { AboutDialog } from "@/screens/AboutDialog";
import { RescaleDialog } from "@/screens/RescaleDialog";
import { IncrementIndexDialog } from "@/screens/IncrementIndexDialog";
import { RescaleEmitterDialog } from "@/screens/RescaleEmitterDialog";
import { LinkGroupSettingsDialog } from "@/screens/LinkGroupSettingsDialog";
import { SetLinkGroupDialog } from "@/screens/SetLinkGroupDialog";
import { SaveChangesPrompt } from "@/screens/SaveChangesPrompt";
import {
  setOpenToolPanel,
  useOpenToolPanel,
} from "@/lib/tool-panel";
import { useSpawnerVisible } from "@/lib/spawner-visibility";
import { useFileState, useSeedFileState } from "@/lib/file-state";
import { promptModNickname } from "@/lib/mod-nickname";

// ?demo=primitives → render the primitives gallery instead of the app shell.
// Evaluated once at module load; a page navigation to ?demo=primitives
// triggers a full reload so the const is re-evaluated correctly.
const DEMO_PARAM = new URLSearchParams(window.location.search).get("demo");

// AppShell — the full editor shell (MenuBar + Toolbar + Viewport + StatusBar).
// Split from App so the hooks are always called unconditionally inside a single
// component (no early-return-before-hook violations).
function AppShell() {
  const bridge = useMemo(() => {
    const b = makeBridge();
    // Task 2.2: attach to window.bridge so Playwright (via CDP) and
    // anyone poking at DevTools can drive the bridge. Diagnostic-only —
    // no production code path reads window.bridge.
    exposeBridgeForTests(b);
    return b;
  }, []);

  // Screen 8 Batch 2: single-open-panel state. Replaces the per-panel
  // `panelOpen` boolean that used to live here. Opening any panel from
  // the menu / Background pill closes whichever was previously open.
  const openPanel = useOpenToolPanel();
  const spawnerVisible = useSpawnerVisible();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [rescaleOpen, setRescaleOpen] = useState(false);
  const [importEmittersOpen, setImportEmittersOpen] = useState(false);

  // Phase 3 Screen 6 Batch A — track the selected emitter id at the
  // shell level so the EmitterPropertyPanel can be conditionally
  // mounted on the RIGHT side of the main row (collapsing to "viewport
  // claims the full right" when nothing is selected). The panel's own
  // subscription is independent — this scalar exists only to gate the
  // mount.
  const [selectedEmitterId, setSelectedEmitterId] = useState<number | null>(null);

  // Particle Editor 2026 redesign: apply persisted theme (or OS preference)
  // before any panel renders so the first paint is correctly themed.
  useEffect(() => {
    const stored = localStorage.getItem("alo:theme");
    const theme = stored === "dark" || stored === "light"
      ? stored
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    document.documentElement.dataset.theme = theme;
  }, []);

  useEffect(() => {
    let cancelled = false;
    bridge
      .request({ kind: "engine/state/snapshot", params: {} })
      .then((snap) => {
        if (cancelled) return;
        setSelectedEmitterId(snap.selectedEmitterId);
      })
      .catch(() => { /* ignore — defaults to null */ });
    return () => { cancelled = true; };
  }, [bridge]);
  useEffect(() => {
    const off = bridge.on("emitters/selected", (e) => {
      setSelectedEmitterId(e.payload.id);
    });
    return off;
  }, [bridge]);

  // Screen 8 Batch 3: subscribe to file-state events (dirty/changed,
  // recent/changed, engine/state/changed) and seed from snapshot +
  // file/recent/list on mount. Stays mounted for the app's lifetime.
  useSeedFileState(bridge);

  // Window title — Phase 3 Screen 8 Batch 3. Reflects dirty + current
  // file path:
  //   - Dirty,   untitled : `* AloParticleEditor`
  //   - Dirty,   named    : `* foo.alo — AloParticleEditor`
  //   - Clean,   untitled : `AloParticleEditor`
  //   - Clean,   named    : `foo.alo — AloParticleEditor`
  // Mirrors legacy `SetFileChanged` title-bar logic at
  // [src/main.cpp:1063-1085]. Em-dash separator matches the
  // legacy "AloParticleEditor - [filename*]" pattern but in the
  // friendlier modern form.
  const { currentFilePath, dirty } = useFileState();
  useEffect(() => {
    const APP_NAME = "AloParticleEditor";
    const dirtyMark = dirty ? "* " : "";
    if (currentFilePath) {
      const idx = Math.max(
        currentFilePath.lastIndexOf("/"),
        currentFilePath.lastIndexOf("\\"),
      );
      const base = idx >= 0 ? currentFilePath.slice(idx + 1) : currentFilePath;
      document.title = `${dirtyMark}${base} — ${APP_NAME}`;
    } else {
      document.title = `${dirtyMark}${APP_NAME}`;
    }
  }, [currentFilePath, dirty]);

  // TODO Phase 3: remove this debug block once real per-screen shortcut
  // handlers are wired in. Until then it proves the round-trip works:
  //   1. React registers combos with the host on mount.
  //   2. Host fires AcceleratorKeyPressed → matches → emits accelerator/pressed.
  //   3. React logs the payload here; DevTools console shows "[accel] Ctrl+S".
  useEffect(() => {
    bridge
      .request({
        kind: "register-accelerators",
        params: { combos: ["Ctrl+S", "Ctrl+Z", "Ctrl+Shift+Z", "Delete", "F5"] },
      })
      .catch((err) => console.warn("[accel] register-accelerators failed:", err));

    const off = bridge.on("accelerator/pressed", (e) => {
      console.log("[accel]", e.payload.combo);
      // TODO Phase 3: real per-screen handlers. For now, route undo/redo
      // through the bridge so the surface is reachable end-to-end. Until
      // captures are wired in, `applied` will always come back false.
      if (e.payload.combo === "Ctrl+Z") {
        void bridge.request({
          kind: "undo/perform",
          params: { direction: "undo" },
        });
      } else if (e.payload.combo === "Ctrl+Shift+Z") {
        void bridge.request({
          kind: "undo/perform",
          params: { direction: "redo" },
        });
      }
    });
    return off;
  }, [bridge]);

  // Task 2.1 verification hook: log the initial engine snapshot at mount.
  // Confirms the bridge round-trip is producing a real EngineStateDto,
  // not the old `{ groundZ, background, skydomeSlot }` stub. Stays as a
  // permanent dev-mode breadcrumb — cheap, and useful any time the
  // bridge surface grows.
  useEffect(() => {
    bridge
      .request({ kind: "engine/state/snapshot", params: {} })
      .then((s) => console.log("[engine/state/snapshot]", s))
      .catch((err) => console.warn("[engine/state/snapshot] failed:", err));
  }, [bridge]);

  return (
    <div className="flex h-full w-full flex-col text-text">
      {/* Top bar */}
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-bg px-4 text-sm">
        <span className="font-semibold">AloParticleEditor</span>
        <MenuBar
          bridge={bridge}
          onOpenLightingPanel={() => setOpenToolPanel("lighting")}
          onOpenBloomPanel={() => setOpenToolPanel("bloom")}
          onOpenImportEmittersDialog={() => setImportEmittersOpen(true)}
          onOpenAboutDialog={() => setAboutOpen(true)}
          onOpenRescaleDialog={() => setRescaleOpen(true)}
        />
      </header>

      {/* Toolbar — 4 groups (File · Edit · View · Render) */}
      <Toolbar bridge={bridge} />

      {/* Main row — Phase 4.1 Fix dispatch 1 four-quadrant layout:
            ┌──────────────┬───────────────────┐
            │ Emitter tree │ Viewport          │
            │ (upper-left) │ (upper-right)     │
            ├──────────────┼───────────────────┤
            │ Property     │ Track + Curve     │
            │ tabs         │ editor            │
            │ (lower-left) │ (lower-right)     │
            └──────────────┴───────────────────┘
            Mirrors legacy `WM_SIZE` layout at
            [src/main.cpp:2712-2780]. Left column fixed `w-80` (~320px);
            right column flex. Within each column, bottom pane fixed
            height (`h-72` / `h-80`); top pane fills the remaining
            space via `flex-1 min-h-0`. */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left column — Task 2.5: wrapped in the design's `.panel`
            chrome (header "Particle System" + body) housing both the
            EmitterTree (upper) and EmitterPropertyTabs (lower) as a
            single visual unit. */}
        <div className="panel w-80 shrink-0">
          <div className="panel-header">
            <span>Particle System</span>
          </div>
          <div className="panel-body flex min-h-0 flex-col overflow-hidden">
            {/* Upper-left — Emitter tree (Phase 3 Screen 4 Batch A).
                Read-only tree view with click-to-select + Batches B/C
                mutations (rename, drag/drop, context menus). */}
            <aside
              data-testid="quadrant-emitter-tree"
              className="flex-1 min-h-0 overflow-y-auto p-3 text-sm"
            >
              <EmitterTree bridge={bridge} />
            </aside>
            {/* Lower-left — Property tabs (Basic / Appearance / Physics).
                Phase 4.1 Fix dispatch 1: Basic tab wired; Appearance +
                Physics placeholders. */}
            <div
              data-testid="quadrant-property-tabs"
              className="h-72 shrink-0 border-t border-border"
            >
              <EmitterPropertyTabs bridge={bridge} />
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="flex flex-1 min-w-0 flex-col">
          {/* Upper-right — Viewport. Tool panels overlay this region
              (positioned ancestor for absolute-positioned ToolPanels). */}
          <div
            data-testid="quadrant-viewport"
            className="relative flex-1 min-h-0"
          >
            <ViewportSlot bridge={bridge} />
            {/* Tool-panel host. Single panel mounted at a time, driven
                by the `openToolPanel` Zustand atom (Screen 8 Batch 2). */}
            {openPanel === "lighting" && (
              <LightingPanel bridge={bridge} onClose={() => setOpenToolPanel(null)} />
            )}
            {openPanel === "bloom" && (
              <BloomPanel bridge={bridge} onClose={() => setOpenToolPanel(null)} />
            )}
          </div>
          {/* Lower-right — Track + Curve editor. Mounted only when an
              emitter is selected; placeholder otherwise. */}
          <div
            data-testid="quadrant-track-editor"
            className="h-80 shrink-0 border-t border-border bg-bg"
          >
            {selectedEmitterId !== null ? (
              <EmitterPropertyPanel bridge={bridge} />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-text-3">
                Select an emitter to edit its tracks
              </div>
            )}
          </div>
        </div>

        {/* Right column — Spawner panel, permanent in the workspace
            grid when spawnerVisible is true (Task 2.4). Hidden when
            the user toggles the Spawner button off; the workspace
            collapses back to two columns. */}
        {spawnerVisible && (
          <aside
            data-testid="quadrant-spawner"
            className="w-80 shrink-0 border-l border-border overflow-hidden"
          >
            <SpawnerPanel bridge={bridge} />
          </aside>
        )}
      </div>

      {/* Status bar */}
      <StatusBar bridge={bridge} />

      {/* Sub-dialogs (Screen 8 batch 1). Mounted at app level so menu
          triggers from anywhere can drive them and Radix portals don't
          fight clipping from intermediate scrollable parents. */}
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
      <RescaleDialog
        bridge={bridge}
        open={rescaleOpen}
        onOpenChange={setRescaleOpen}
      />
      <ImportEmittersDialog
        bridge={bridge}
        open={importEmittersOpen}
        onOpenChange={setImportEmittersOpen}
      />
      {/* ModNicknameDialog is mounted unconditionally; it observes its
          own Zustand atom for open state. Driven by `promptModNickname`
          (programmatic) or the `?demo=mod-nickname` route in App below. */}
      <ModNicknameDialog />
      {/* Save-changes prompt (Screen 8 Batch 3). Open state lives in
          the file-state atom; this mount is invisible while the
          pendingAction slot is null. Driven from any destructive op
          handler via `promptSaveChanges(...)`. */}
      <SaveChangesPrompt bridge={bridge} />
      {/* Screen 4 Batch B1 — emitter-tree context-menu modals. They
          observe the `tree-context` Zustand atom for open state; the
          EmitterTree row's ContextMenu items poke the atom to mount
          whichever one was chosen. Rename moved to inline editing in
          Batch C — no modal involvement. */}
      <IncrementIndexDialog bridge={bridge} />
      <RescaleEmitterDialog bridge={bridge} />
      <LinkGroupSettingsDialog bridge={bridge} />
      {/* Screen 4 Batch B2 — multi-select link-group assignment. */}
      <SetLinkGroupDialog bridge={bridge} />
    </div>
  );
}

// ?demo=mod-nickname — design-checkpoint gate for the Mod Nickname
// dialog. Mounts the dialog and fires `promptModNickname()` once on
// load so the dialog is immediately visible. Phase 3 Screen 8 Batch 4.
function ModNicknameDemo() {
  useEffect(() => {
    void promptModNickname().then((result) => {
      console.log("[demo:mod-nickname] resolved with:", result);
    });
  }, []);
  return (
    <div className="flex h-full w-full items-center justify-center bg-bg text-sm text-text-2">
      <span>Mod Nickname dialog demo — dismiss to log the result.</span>
      <ModNicknameDialog />
    </div>
  );
}

// App — root entry point. Routes to the primitives gallery when ?demo=primitives
// is present; otherwise renders the full editor shell.
export function App() {
  if (DEMO_PARAM === "primitives") {
    return <PrimitivesGallery />;
  }
  if (DEMO_PARAM === "mod-nickname") {
    return <ModNicknameDemo />;
  }
  return <AppShell />;
}
