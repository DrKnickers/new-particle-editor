// Toolbar — horizontal action bar below the app header. Four groups
// (File · Edit · View · Render) wired to the bridge. File buttons
// (New/Open/Save) are scaffolds; the real file ops land in Phase 3
// Screen 8 — clicking them logs a TODO for now. Edit dispatches
// undo/perform, View drives the preview clock (paused / step), Render
// toggles bloom and fires the reload-shaders / reload-textures actions.
//
// Subscribes to engine/state/changed so the stateful buttons (Pause,
// Bloom) reflect engine truth even when the state changes externally
// (e.g. via DevTools or a keyboard accelerator).
import { useEffect, useState } from "react";
import {
  FilePlus, FolderOpen, Save,
  Undo, Redo,
  Pause, Play, StepForward,
  Sparkles, RefreshCw,
} from "lucide-react";
import type { Bridge, EngineStateDto } from "@particle-editor/bridge-schema";
import { ThemeToggle } from "@/components/ThemeToggle";

type Props = { bridge: Bridge };

type ButtonProps = {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
};

function TbBtn({ icon, title, onClick, active = false, disabled = false }: ButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={`flex size-7 items-center justify-center rounded-md transition ${
        disabled
          ? "cursor-not-allowed text-text-3"
          : active
            ? "bg-accent-soft text-accent hover:bg-accent-soft"
            : "text-text-2 hover:bg-panel-2 hover:text-text"
      }`}
    >
      {icon}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-panel-2" aria-hidden="true" />;
}

const ICON = { className: "size-4" } as const;

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
  const bloom = state?.bloom ?? false;
  const bloomAvailable = state?.bloomAvailable ?? false;

  // File group — placeholder dispatches until Screen 8 wires real file ops.
  const todoFile = (action: string) => {
    console.log(`[Toolbar] ${action} — file ops land in Phase 3 Screen 8`);
  };

  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border bg-bg px-2">
      {/* File */}
      <TbBtn icon={<FilePlus {...ICON} />}   title="New (Ctrl+N)"   onClick={() => todoFile("New")} />
      <TbBtn icon={<FolderOpen {...ICON} />} title="Open (Ctrl+O)"  onClick={() => todoFile("Open")} />
      <TbBtn icon={<Save {...ICON} />}       title="Save (Ctrl+S)"  onClick={() => todoFile("Save")} />

      <Divider />

      {/* Edit */}
      <TbBtn
        icon={<Undo {...ICON} />}
        title="Undo (Ctrl+Z)"
        onClick={() => { void bridge.request({ kind: "undo/perform", params: { direction: "undo" } }); }}
      />
      <TbBtn
        icon={<Redo {...ICON} />}
        title="Redo (Ctrl+Shift+Z)"
        onClick={() => { void bridge.request({ kind: "undo/perform", params: { direction: "redo" } }); }}
      />

      <Divider />

      {/* View — preview clock */}
      <TbBtn
        icon={paused ? <Play {...ICON} /> : <Pause {...ICON} />}
        title={paused ? "Resume preview (F8)" : "Pause preview (F8)"}
        active={paused}
        onClick={() => { void bridge.request({ kind: "engine/set/paused", params: { paused: !paused } }); }}
      />
      <TbBtn
        icon={<StepForward {...ICON} />}
        title="Step one frame"
        disabled={!paused}
        onClick={() => { void bridge.request({ kind: "engine/action/step-frames", params: { frames: 1 } }); }}
      />

      <Divider />

      {/* Render */}
      <TbBtn
        icon={<Sparkles {...ICON} />}
        title={bloomAvailable ? "Bloom" : "Bloom (shader unavailable)"}
        active={bloom}
        disabled={!bloomAvailable}
        onClick={() => { void bridge.request({ kind: "engine/set/bloom", params: { enabled: !bloom } }); }}
      />
      <TbBtn
        icon={<RefreshCw {...ICON} />}
        title="Reload shaders"
        onClick={() => { void bridge.request({ kind: "engine/action/reload-shaders", params: {} }); }}
      />
      <TbBtn
        icon={<RefreshCw {...ICON} />}
        title="Reload textures"
        onClick={() => { void bridge.request({ kind: "engine/action/reload-textures", params: {} }); }}
      />

      {/* Particle Editor 2026 redesign: theme toggle at the right edge.
          Phase 2.1 will reorganize the toolbar into proper 4-group layout
          with a spacer; for Phase 1 we just mount it as the last child. */}
      <ThemeToggle />
    </div>
  );
}
