// Phase 3 Screen 2 — React-rendered menu bar using Radix UI Menubar.
//
// Phase 4.1 Fix dispatch 5: restructured to legacy top-level order
//   File / Edit / Emitters / Mods / View / Help
// (legacy [src/ParticleEditor.en.rc:565-630]). Changes vs the original
// 5-menu shape:
//   - Added top-level `Emitters` menu with New Emitter submenu
//     (Root / Lifetime Child / Death Child), Rename Emitter (via
//     `tree-action` atom), Rescale Emitter… (via `tree-context`
//     atom), Spawner… (was under Tools), plus disabled placeholders
//     for Toggle Visibility / Show All / Hide All (FD5 design lock —
//     wiring deferred to a future polish batch).
//   - Promoted `Mods` from a Tools submenu to a top-level menu.
//     Placeholder list unchanged (dynamic mod detection still
//     deferred).
//   - Moved `Lighting…` and `Bloom Settings…` from Tools to View.
//   - Removed `Tools` menu entirely (its remaining item, Spawner,
//     lives in Emitters now).
// All items wired to existing bridge calls + atoms; deferred items
// log a `[Menu] X — TODO` marker and render as `disabled`.

import { useEffect, useRef, useState, type ComponentProps } from "react";
import * as Menubar from "@radix-ui/react-menubar";
import { Check, ChevronRight } from "lucide-react";
import type { Bridge, EngineStateDto } from "@particle-editor/bridge-schema";
import { promptSaveChanges, useFileState } from "@/lib/file-state";
import { useEmitterSelectionPrimary } from "@/lib/emitter-selection";
import { useTreeContextStore } from "@/lib/tree-context";
import { requestEmitterRename } from "@/lib/tree-action";
import { useViewportOcclusion } from "@/lib/viewport-occlusion";

// FD8 follow-up: each MenubarContent needs to register itself with the
// host as a viewport occlusion while open so the popup punches a
// SetWindowRgn hole over the menu rect and the menu HTML shows
// through. This wrapper uses a ref + the useViewportOcclusion hook,
// scoped to the time the menu is mounted (Radix only mounts content
// while the menu is open, so the hook auto-cleans on close).
type MenuContentProps = ComponentProps<typeof Menubar.Content> & {
  bridge: Bridge;
  occlusionId: string;
};

function OccludingMenubarContent({
  bridge,
  occlusionId,
  children,
  ...rest
}: MenuContentProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useViewportOcclusion(bridge, occlusionId, ref);
  // Wrap children in a measuring div so we capture the bounding rect
  // regardless of whether Radix's ref forwarding lands on the DOM
  // element we expect. The wrapper inherits the layout of its child.
  return (
    <Menubar.Content {...rest}>
      <div ref={ref}>{children}</div>
    </Menubar.Content>
  );
}

type Props = {
  bridge: Bridge;
  onOpenBackgroundPanel: () => void;
  onOpenLightingPanel: () => void;
  onOpenBloomPanel: () => void;
  onOpenGroundTexturePanel: () => void;
  onOpenSpawnerPanel: () => void;
  onOpenImportEmittersDialog: () => void;
  onOpenAboutDialog: () => void;
  onOpenRescaleDialog: () => void;
};

// Style constants — shared across triggers and items so the Tailwind
// class strings don't drift between menus.
const TRIGGER =
  "px-2 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-900 rounded data-[state=open]:bg-neutral-900 data-[state=open]:text-neutral-100 outline-none select-none cursor-default";
// FD9b restores the drop shadow. The layered viewport now stamps a
// smoothstep-feathered alpha hole at each occlusion rect (with
// FD8's edge padding sized to enclose the shadow), so shadow-xl
// blends naturally against the D3D9 scene instead of leaving the
// dark halo the prior HRGN cut produced.
const CONTENT =
  "min-w-[200px] bg-neutral-900 border border-neutral-800 rounded-md shadow-xl p-1 z-50";
const ITEM =
  "flex items-center gap-2 px-2 py-1 text-xs text-neutral-200 rounded hover:bg-neutral-800 focus:bg-neutral-800 outline-none cursor-pointer data-[disabled]:text-neutral-600 data-[disabled]:cursor-not-allowed data-[disabled]:hover:bg-transparent select-none";
const SEPARATOR = "my-1 h-px bg-neutral-800";

function Hint({ children }: { children: string }) {
  return <span className="ml-auto text-[10px] text-neutral-500">{children}</span>;
}

function CheckSlot({ active }: { active: boolean }) {
  return (
    <span className="size-3.5 shrink-0 flex items-center justify-center">
      {active && <Check className="size-3.5" />}
    </span>
  );
}

const todo = (label: string) => () =>
  console.log(`[Menu] ${label} — TODO (Phase 4.1 follow-up)`);

/** Extract the basename from a full path for the Recent Files submenu
 *  labels. Splits on the last `/` or `\\`; falls back to the whole
 *  string. */
function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export function MenuBar({
  bridge,
  onOpenBackgroundPanel,
  onOpenLightingPanel,
  onOpenBloomPanel,
  onOpenGroundTexturePanel,
  onOpenSpawnerPanel,
  onOpenImportEmittersDialog,
  onOpenAboutDialog,
  onOpenRescaleDialog,
}: Props) {
  const [state, setState] = useState<EngineStateDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    bridge
      .request({ kind: "engine/state/snapshot", params: {} })
      .then((s) => {
        if (!cancelled) setState(s);
      })
      .catch((err) => console.warn("[MenuBar] snapshot failed:", err));
    const off = bridge.on("engine/state/changed", (e) => setState(e.payload));
    return () => {
      cancelled = true;
      off();
    };
  }, [bridge]);

  const ground = state?.ground ?? false;
  const bloom = state?.bloom ?? false;
  const bloomAvailable = state?.bloomAvailable ?? false;
  const paused = state?.paused ?? false;
  const heatDebug = state?.heatDebug ?? false;

  // Primary selection drives the Emitters-menu item enabled state.
  // Rename / Rescale / Add Child operate on the primary; Add Root is
  // selection-independent.
  const primaryEmitterId = useEmitterSelectionPrimary();
  const hasPrimary = primaryEmitterId !== null;

  // Screen 8 Batch 3: File-menu wiring needs the recent-files list +
  // the prompt-save-changes helper.
  const { recentFiles } = useFileState();

  const send =
    (req: Parameters<Bridge["request"]>[0]) =>
    () => {
      void bridge.request(req);
    };

  // ── File menu handlers ───────────────────────────────────────────
  // All destructive ops (New / Open / Recent) route through
  // promptSaveChanges() which gates on the current dirty flag and
  // either runs the action immediately (clean) or pops the
  // SaveChangesPrompt (dirty). Save / Save As don't need the gate —
  // they ARE the save path.

  const handleNew = () => {
    promptSaveChanges(async () => {
      await bridge.request({ kind: "file/new", params: {} });
    });
  };

  const handleOpen = () => {
    promptSaveChanges(async () => {
      await bridge.request({ kind: "file/open", params: {} });
    });
  };

  const handleSave = () => {
    void bridge.request({ kind: "file/save", params: {} });
  };

  const handleSaveAs = () => {
    void bridge.request({ kind: "file/save-as", params: {} });
  };

  const handleOpenRecent = (path: string) => {
    promptSaveChanges(async () => {
      await bridge.request({ kind: "file/open", params: { path } });
    });
  };

  const handleExit = () => {
    // TODO Batch N+1: wire app/quit. Closing the host window from
    // React cleanly involves window-placement persistence + other
    // concerns out of scope for Batch 3 (parking-lot decision).
    console.log("[Menu] Exit — TODO Batch N+1");
  };

  // ── Emitters menu handlers (FD5) ─────────────────────────────────

  const handleAddRoot = () => {
    void bridge.request({ kind: "emitters/add-root", params: {} });
  };

  const handleAddLifetimeChild = () => {
    if (primaryEmitterId === null) return;
    void bridge.request({
      kind: "emitters/add-lifetime-child",
      params: { parentId: primaryEmitterId },
    });
  };

  const handleAddDeathChild = () => {
    if (primaryEmitterId === null) return;
    void bridge.request({
      kind: "emitters/add-death-child",
      params: { parentId: primaryEmitterId },
    });
  };

  const handleRenameEmitter = () => {
    if (primaryEmitterId === null) return;
    requestEmitterRename(primaryEmitterId);
  };

  const handleRescaleEmitter = () => {
    if (primaryEmitterId === null) return;
    useTreeContextStore.getState().openDialog("rescale", primaryEmitterId);
  };

  return (
    <Menubar.Root className="flex items-center gap-0.5">
      {/* ─── File ─── */}
      <Menubar.Menu>
        <Menubar.Trigger className={TRIGGER}>File</Menubar.Trigger>
        <Menubar.Portal>
          <OccludingMenubarContent
            bridge={bridge}
            occlusionId="menu:file"
            className={CONTENT}
            align="start"
            sideOffset={4}
          >
            <Menubar.Item className={ITEM} onSelect={handleNew}>
              New<Hint>Ctrl+N</Hint>
            </Menubar.Item>
            <Menubar.Item className={ITEM} onSelect={handleOpen}>
              Open…<Hint>Ctrl+O</Hint>
            </Menubar.Item>
            <Menubar.Item className={ITEM} onSelect={handleSave}>
              Save<Hint>Ctrl+S</Hint>
            </Menubar.Item>
            <Menubar.Item className={ITEM} onSelect={handleSaveAs}>
              Save As…
            </Menubar.Item>
            <Menubar.Separator className={SEPARATOR} />
            <Menubar.Item
              className={ITEM}
              onSelect={() => onOpenImportEmittersDialog()}
            >
              Import Emitters…
            </Menubar.Item>
            <Menubar.Separator className={SEPARATOR} />
            <Menubar.Sub>
              <Menubar.SubTrigger className={ITEM}>
                Recent Files
                <ChevronRight className="ml-auto size-3.5" />
              </Menubar.SubTrigger>
              <Menubar.Portal>
                <Menubar.SubContent
                  className={CONTENT}
                  sideOffset={2}
                  alignOffset={-4}
                >
                  {recentFiles.length === 0 ? (
                    <Menubar.Item className={ITEM} disabled>
                      (none)
                    </Menubar.Item>
                  ) : (
                    recentFiles.map((path) => (
                      <Menubar.Item
                        key={path}
                        className={ITEM}
                        title={path}
                        onSelect={() => handleOpenRecent(path)}
                      >
                        {basename(path)}
                      </Menubar.Item>
                    ))
                  )}
                </Menubar.SubContent>
              </Menubar.Portal>
            </Menubar.Sub>
            <Menubar.Separator className={SEPARATOR} />
            <Menubar.Item className={ITEM} onSelect={handleExit}>
              Exit<Hint>Alt+F4</Hint>
            </Menubar.Item>
          </OccludingMenubarContent>
        </Menubar.Portal>
      </Menubar.Menu>

      {/* ─── Edit ─── */}
      <Menubar.Menu>
        <Menubar.Trigger className={TRIGGER}>Edit</Menubar.Trigger>
        <Menubar.Portal>
          <OccludingMenubarContent
            bridge={bridge}
            occlusionId="menu:edit"
            className={CONTENT}
            align="start"
            sideOffset={4}
          >
            <Menubar.Item
              className={ITEM}
              onSelect={send({
                kind: "undo/perform",
                params: { direction: "undo" },
              })}
            >
              Undo<Hint>Ctrl+Z</Hint>
            </Menubar.Item>
            <Menubar.Item
              className={ITEM}
              onSelect={send({
                kind: "undo/perform",
                params: { direction: "redo" },
              })}
            >
              Redo<Hint>Ctrl+Shift+Z</Hint>
            </Menubar.Item>
            <Menubar.Separator className={SEPARATOR} />
            <Menubar.Item className={ITEM} disabled>
              Cut<Hint>Ctrl+X</Hint>
            </Menubar.Item>
            <Menubar.Item className={ITEM} disabled>
              Copy<Hint>Ctrl+C</Hint>
            </Menubar.Item>
            <Menubar.Item className={ITEM} disabled>
              Paste<Hint>Ctrl+V</Hint>
            </Menubar.Item>
            <Menubar.Item className={ITEM} disabled>
              Delete<Hint>Del</Hint>
            </Menubar.Item>
            <Menubar.Separator className={SEPARATOR} />
            <Menubar.Item className={ITEM} onSelect={() => onOpenRescaleDialog()}>
              Rescale…
            </Menubar.Item>
            <Menubar.Item
              className={ITEM}
              onSelect={send({
                kind: "engine/action/clear",
                params: {},
              })}
            >
              Clear All Particles<Hint>Ctrl+Del</Hint>
            </Menubar.Item>
          </OccludingMenubarContent>
        </Menubar.Portal>
      </Menubar.Menu>

      {/* ─── Emitters (FD5) ─── */}
      <Menubar.Menu>
        <Menubar.Trigger className={TRIGGER}>Emitters</Menubar.Trigger>
        <Menubar.Portal>
          <OccludingMenubarContent
            bridge={bridge}
            occlusionId="menu:emitters"
            className={CONTENT}
            align="start"
            sideOffset={4}
          >
            <Menubar.Sub>
              <Menubar.SubTrigger className={ITEM}>
                New Emitter
                <ChevronRight className="ml-auto size-3.5" />
              </Menubar.SubTrigger>
              <Menubar.Portal>
                <Menubar.SubContent
                  className={CONTENT}
                  sideOffset={2}
                  alignOffset={-4}
                >
                  <Menubar.Item className={ITEM} onSelect={handleAddRoot}>
                    Root Emitter
                  </Menubar.Item>
                  <Menubar.Item
                    className={ITEM}
                    disabled={!hasPrimary}
                    onSelect={handleAddLifetimeChild}
                  >
                    Lifetime Child
                  </Menubar.Item>
                  <Menubar.Item
                    className={ITEM}
                    disabled={!hasPrimary}
                    onSelect={handleAddDeathChild}
                  >
                    Death Child
                  </Menubar.Item>
                </Menubar.SubContent>
              </Menubar.Portal>
            </Menubar.Sub>
            <Menubar.Item
              className={ITEM}
              disabled={!hasPrimary}
              onSelect={handleRenameEmitter}
            >
              Rename Emitter<Hint>F2</Hint>
            </Menubar.Item>
            <Menubar.Item
              className={ITEM}
              disabled={!hasPrimary}
              onSelect={handleRescaleEmitter}
            >
              Rescale Emitter…
            </Menubar.Item>
            <Menubar.Separator className={SEPARATOR} />
            {/* TODO (Phase 4.1 follow-up): per-row eye-icon visibility
                affordance + bridge wiring. Items render disabled to
                signal the surface is locked but inert. */}
            <Menubar.Item
              className={ITEM}
              disabled
              onSelect={todo("Toggle Visibility")}
            >
              Toggle Visibility
            </Menubar.Item>
            <Menubar.Item
              className={ITEM}
              disabled
              onSelect={todo("Show All Emitters")}
            >
              Show All Emitters
            </Menubar.Item>
            <Menubar.Item
              className={ITEM}
              disabled
              onSelect={todo("Hide All Emitters")}
            >
              Hide All Emitters
            </Menubar.Item>
            <Menubar.Separator className={SEPARATOR} />
            <Menubar.Item className={ITEM} onSelect={() => onOpenSpawnerPanel()}>
              Spawner…<Hint>F7</Hint>
            </Menubar.Item>
          </OccludingMenubarContent>
        </Menubar.Portal>
      </Menubar.Menu>

      {/* ─── Mods (FD5: promoted from Tools submenu to top-level) ─── */}
      <Menubar.Menu>
        <Menubar.Trigger className={TRIGGER}>Mods</Menubar.Trigger>
        <Menubar.Portal>
          <OccludingMenubarContent
            bridge={bridge}
            occlusionId="menu:mods"
            className={CONTENT}
            align="start"
            sideOffset={4}
          >
            {/* TODO (Phase 4.1 follow-up): dynamic detected-mod list.
                For now the placeholder stays identical to the pre-FD5
                Tools > Mods submenu content. */}
            <Menubar.Item className={ITEM} disabled>
              (none)
            </Menubar.Item>
          </OccludingMenubarContent>
        </Menubar.Portal>
      </Menubar.Menu>

      {/* ─── View ─── */}
      <Menubar.Menu>
        <Menubar.Trigger className={TRIGGER}>View</Menubar.Trigger>
        <Menubar.Portal>
          <OccludingMenubarContent
            bridge={bridge}
            occlusionId="menu:view"
            className={CONTENT}
            align="start"
            sideOffset={4}
          >
            <Menubar.Item
              className={ITEM}
              onSelect={send({
                kind: "engine/set/ground",
                params: { enabled: !ground },
              })}
            >
              <CheckSlot active={ground} />
              Ground
            </Menubar.Item>
            <Menubar.Item
              className={ITEM}
              onSelect={() => onOpenGroundTexturePanel()}
            >
              <CheckSlot active={false} />
              Ground Texture…
            </Menubar.Item>
            <Menubar.Item
              className={ITEM}
              onSelect={() => onOpenBackgroundPanel()}
            >
              <CheckSlot active={false} />
              Background…
            </Menubar.Item>
            <Menubar.Item
              className={ITEM}
              disabled={!bloomAvailable}
              onSelect={send({
                kind: "engine/set/bloom",
                params: { enabled: !bloom },
              })}
            >
              <CheckSlot active={bloom} />
              Bloom
              {!bloomAvailable && <Hint>unavailable</Hint>}
            </Menubar.Item>
            {/* FD5: Bloom Settings + Lighting moved from Tools to View. */}
            <Menubar.Item
              className={ITEM}
              onSelect={() => onOpenBloomPanel()}
            >
              <CheckSlot active={false} />
              Bloom Settings…
            </Menubar.Item>
            <Menubar.Item
              className={ITEM}
              onSelect={() => onOpenLightingPanel()}
            >
              <CheckSlot active={false} />
              Lighting…
            </Menubar.Item>
            <Menubar.Separator className={SEPARATOR} />
            <Menubar.Item
              className={ITEM}
              onSelect={send({
                kind: "engine/set/paused",
                params: { paused: !paused },
              })}
            >
              <CheckSlot active={paused} />
              Pause<Hint>F8</Hint>
            </Menubar.Item>
            <Menubar.Item
              className={ITEM}
              disabled={!paused}
              onSelect={send({
                kind: "engine/action/step-frames",
                params: { frames: 1 },
              })}
            >
              Step Forward
            </Menubar.Item>
            {/* TODO (Phase 4.1 follow-up): Reset Camera bridge call +
                C++ handler. Disabled placeholder for FD5. */}
            <Menubar.Item
              className={ITEM}
              disabled
              onSelect={todo("Reset Camera")}
            >
              Reset Camera
            </Menubar.Item>
            <Menubar.Separator className={SEPARATOR} />
            <Menubar.Item
              className={ITEM}
              onSelect={send({
                kind: "engine/action/reload-shaders",
                params: {},
              })}
            >
              Reload Shaders
            </Menubar.Item>
            <Menubar.Item
              className={ITEM}
              onSelect={send({
                kind: "engine/action/reload-textures",
                params: {},
              })}
            >
              Reload Textures
            </Menubar.Item>
            <Menubar.Separator className={SEPARATOR} />
            <Menubar.Item
              className={ITEM}
              onSelect={send({
                kind: "engine/set/heat-debug",
                params: { enabled: !heatDebug },
              })}
            >
              <CheckSlot active={heatDebug} />
              Heat Debug
            </Menubar.Item>
            {/* Already-deferred Reset View Settings — left in place
                from the original menu shape. */}
            <Menubar.Item
              className={ITEM}
              disabled
              onSelect={todo("Reset View Settings")}
            >
              Reset View Settings
            </Menubar.Item>
          </OccludingMenubarContent>
        </Menubar.Portal>
      </Menubar.Menu>

      {/* ─── Help ─── */}
      <Menubar.Menu>
        <Menubar.Trigger className={TRIGGER}>Help</Menubar.Trigger>
        <Menubar.Portal>
          <OccludingMenubarContent
            bridge={bridge}
            occlusionId="menu:help"
            className={CONTENT}
            align="start"
            sideOffset={4}
          >
            <Menubar.Item className={ITEM} onSelect={() => onOpenAboutDialog()}>
              About
            </Menubar.Item>
          </OccludingMenubarContent>
        </Menubar.Portal>
      </Menubar.Menu>
    </Menubar.Root>
  );
}
