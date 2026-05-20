// Toolbar — Particle Editor 2026 layout. 4 grouped sections with
// dividers, spacer to the right, theme toggle at the rightmost edge.
//
// Group 1 (file actions):       New · Open · Save · Save As
// Group 2 (playback):           Play|Pause · Step · Step 10
// Group 3 (panels):             Spawner toggle
//   spacer
// Group 4 (environment):        Ground dropdown · Background dropdown · ThemeToggle
//
// Ground and Background dropdown slots are empty placeholders for now;
// Tasks 2.2 and 2.3 fill them in. Stop and Restart removed per design
// chat. Bloom toggle moves to the viewport pill in Task 2.7. Undo/Redo
// and Reload Shaders/Textures live in the menubar only.
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
import { useSpawnerVisibility } from "@/lib/spawner-visibility";

type Props = { bridge: Bridge };

const ICON = { className: "size-3.5" } as const;

// File ops are scaffolds until Phase 3 wires them — keep the legacy
// behaviour of logging a TODO for now (matches the current shape).
const todoFile = (action: string) => () => {
  console.log(`[Toolbar] ${action} — file ops land in Phase 3 Screen 8`);
};

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
    <div className="toolbar">
      {/* Group 1: file actions */}
      <div className="tb-group">
        <button type="button" className="tb-btn" aria-label="New" onClick={todoFile("New")}>
          <FilePlus {...ICON} />
        </button>
        <button type="button" className="tb-btn" aria-label="Open" onClick={todoFile("Open")}>
          <FolderOpen {...ICON} />
        </button>
        <button type="button" className="tb-btn" aria-label="Save" onClick={todoFile("Save")}>
          <Save {...ICON} />
        </button>
        <button type="button" className="tb-btn" aria-label="Save As" onClick={todoFile("Save As")}>
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

      {/* Group 4: environment + theme — Ground and Background
          dropdowns land in Tasks 2.2/2.3; placeholder for now. */}
      <ThemeToggle />
    </div>
  );
}
