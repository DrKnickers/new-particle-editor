// Toolbar — Particle Editor 2026 layout. 4 grouped sections with
// dividers, spacer to the right, theme toggle at the rightmost edge.
//
// Group 1 (file actions):       New · Open · Save · Save As
// Group 2 (playback):           Play|Pause · Step · Step 10
// Group 3 (panels):             Spawner toggle
//   spacer
// Group 4 (environment):        Ground dropdown · Background dropdown · ThemeToggle
//
// Stop and Restart removed per design chat. Bloom toggle moves to the
// viewport pill in Task 2.7. Undo/Redo and Reload Shaders/Textures live
// in the menubar only.
//
// Uses the design's semantic CSS classes from components.css:
//   .toolbar, .tb-group, .tb-btn, .tb-divider, .tb-spacer

import { useEffect, useState } from "react";
import {
  FilePlus, FolderOpen, Save, SaveAll,
  Play, Pause, ChevronRight, ChevronsRight,
} from "lucide-react";
import type { Bridge, EngineStateDto } from "@particle-editor/bridge-schema";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BackgroundDropdown } from "@/components/BackgroundDropdown";
import { GroundDropdown } from "@/components/GroundDropdown";
import { useSpawnerVisibility } from "@/lib/spawner-visibility";
import { promptSaveChanges } from "@/lib/file-state";

type Props = { bridge: Bridge };

const ICON = { className: "size-3.5" } as const;

export function Toolbar({ bridge }: Props) {
  const [state, setState] = useState<EngineStateDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    bridge.request({ kind: "engine/state/snapshot", params: {} })
      .then((s) => { if (!cancelled) setState(s); })
      .catch((err) => console.warn("[Toolbar] snapshot failed:", err));
    const off = bridge.on("engine/state/changed", (e) => setState(e.payload));
    return () => { cancelled = true; off(); };
  }, [bridge]);

  const paused = state?.paused ?? false;
  const { visible: spawnerVisible, toggle: toggleSpawner } = useSpawnerVisibility();

  return (
    <div data-testid="toolbar" className="toolbar">
      {/* Group 1: file actions. New / Open route through promptSaveChanges
          so a dirty document gets the Save/Discard/Cancel prompt before
          being replaced (same gate the MenuBar uses). Save + Save As are
          themselves the save path so they don't need the gate. */}
      <div className="tb-group">
        <button
          type="button"
          className="tb-btn"
          aria-label="New"
          onClick={() => {
            promptSaveChanges(async () => {
              await bridge.request({ kind: "file/new", params: {} });
            });
          }}
        >
          <FilePlus {...ICON} />
        </button>
        <button
          type="button"
          className="tb-btn"
          aria-label="Open"
          onClick={() => {
            promptSaveChanges(async () => {
              await bridge.request({ kind: "file/open", params: {} });
            });
          }}
        >
          <FolderOpen {...ICON} />
        </button>
        <button
          type="button"
          className="tb-btn"
          aria-label="Save"
          onClick={() => { void bridge.request({ kind: "file/save", params: {} }); }}
        >
          <Save {...ICON} />
        </button>
        <button
          type="button"
          className="tb-btn"
          aria-label="Save As"
          onClick={() => { void bridge.request({ kind: "file/save-as", params: {} }); }}
        >
          <SaveAll {...ICON} />
        </button>
      </div>

      <span className="tb-divider" />

      {/* Group 2: playback */}
      <div className="tb-group">
        <button
          type="button"
          className="tb-btn"
          aria-label={paused ? "Play" : "Pause"}
          aria-pressed={!paused}
          onClick={() => { void bridge.request({ kind: "engine/set/paused", params: { paused: !paused } }); }}
        >
          {paused ? <Play {...ICON} /> : <Pause {...ICON} />}
        </button>
        <button
          type="button"
          className="tb-btn"
          aria-label="Step"
          onClick={() => { void bridge.request({ kind: "engine/action/step-frames", params: { frames: 1 } }); }}
        >
          <ChevronRight {...ICON} />
        </button>
        <button
          type="button"
          className="tb-btn"
          aria-label="Step 10"
          onClick={() => { void bridge.request({ kind: "engine/action/step-frames", params: { frames: 10 } }); }}
        >
          <ChevronsRight {...ICON} />
        </button>
      </div>

      <span className="tb-divider" />

      {/* Group 3: Spawner toggle */}
      <div className="tb-group">
        <button
          type="button"
          className="tb-btn"
          aria-label="Toggle Spawner panel"
          aria-pressed={spawnerVisible}
          onClick={toggleSpawner}
        >
          Spawner
        </button>
      </div>

      <span className="tb-spacer" />

      {/* Group 4: environment + theme */}
      <GroundDropdown bridge={bridge} />
      <BackgroundDropdown bridge={bridge} />
      <ThemeToggle />
    </div>
  );
}
