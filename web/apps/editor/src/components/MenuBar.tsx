// Phase 3 Screen 2 — React-rendered menu bar using Radix UI Menubar.
// Five top-level menus: File · Edit · View · Tools · Help.
// Items wired to existing bridge calls where behaviour exists today;
// remaining items log "[Menu] X — Phase 3 Screen 8" as a TODO marker.
import { useEffect, useState } from "react";
import * as Menubar from "@radix-ui/react-menubar";
import { Check, ChevronRight } from "lucide-react";
import type { Bridge, EngineStateDto } from "@particle-editor/bridge-schema";

type Props = {
  bridge: Bridge;
  onOpenBackgroundPanel: () => void;
  onOpenLightingPanel: () => void;
  onOpenBloomPanel: () => void;
  onOpenGroundTexturePanel: () => void;
  onOpenAboutDialog: () => void;
  onOpenRescaleDialog: () => void;
};

// Style constants — shared across triggers and items so the Tailwind
// class strings don't drift between menus.
const TRIGGER =
  "px-2 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-900 rounded data-[state=open]:bg-neutral-900 data-[state=open]:text-neutral-100 outline-none select-none cursor-default";
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
  console.log(`[Menu] ${label} — Phase 3 Screen 8`);

export function MenuBar({
  bridge,
  onOpenBackgroundPanel,
  onOpenLightingPanel,
  onOpenBloomPanel,
  onOpenGroundTexturePanel,
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

  const send =
    (req: Parameters<Bridge["request"]>[0]) =>
    () => {
      void bridge.request(req);
    };

  return (
    <Menubar.Root className="flex items-center gap-0.5">
      {/* ─── File ─── */}
      <Menubar.Menu>
        <Menubar.Trigger className={TRIGGER}>File</Menubar.Trigger>
        <Menubar.Portal>
          <Menubar.Content
            className={CONTENT}
            align="start"
            sideOffset={4}
          >
            <Menubar.Item className={ITEM} onSelect={todo("New")}>
              New<Hint>Ctrl+N</Hint>
            </Menubar.Item>
            <Menubar.Item className={ITEM} onSelect={todo("Open")}>
              Open…<Hint>Ctrl+O</Hint>
            </Menubar.Item>
            <Menubar.Item className={ITEM} onSelect={todo("Save")}>
              Save<Hint>Ctrl+S</Hint>
            </Menubar.Item>
            <Menubar.Item className={ITEM} onSelect={todo("Save As")}>
              Save As…
            </Menubar.Item>
            <Menubar.Separator className={SEPARATOR} />
            <Menubar.Item className={ITEM} onSelect={todo("Import Emitters")}>
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
                  <Menubar.Item className={ITEM} disabled>
                    (none)
                  </Menubar.Item>
                </Menubar.SubContent>
              </Menubar.Portal>
            </Menubar.Sub>
            <Menubar.Separator className={SEPARATOR} />
            <Menubar.Item className={ITEM} onSelect={todo("Exit")}>
              Exit<Hint>Alt+F4</Hint>
            </Menubar.Item>
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>

      {/* ─── Edit ─── */}
      <Menubar.Menu>
        <Menubar.Trigger className={TRIGGER}>Edit</Menubar.Trigger>
        <Menubar.Portal>
          <Menubar.Content
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
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>

      {/* ─── View ─── */}
      <Menubar.Menu>
        <Menubar.Trigger className={TRIGGER}>View</Menubar.Trigger>
        <Menubar.Portal>
          <Menubar.Content
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
            <Menubar.Item
              className={ITEM}
              onSelect={() => onOpenBloomPanel()}
            >
              <CheckSlot active={false} />
              Bloom Settings…
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
            <Menubar.Item
              className={ITEM}
              onSelect={todo("Reset View Settings")}
            >
              Reset View Settings
            </Menubar.Item>
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>

      {/* ─── Tools ─── */}
      <Menubar.Menu>
        <Menubar.Trigger className={TRIGGER}>Tools</Menubar.Trigger>
        <Menubar.Portal>
          <Menubar.Content
            className={CONTENT}
            align="start"
            sideOffset={4}
          >
            <Menubar.Item className={ITEM} onSelect={() => onOpenLightingPanel()}>
              Lighting…
            </Menubar.Item>
            <Menubar.Sub>
              <Menubar.SubTrigger className={ITEM}>
                Mods
                <ChevronRight className="ml-auto size-3.5" />
              </Menubar.SubTrigger>
              <Menubar.Portal>
                <Menubar.SubContent
                  className={CONTENT}
                  sideOffset={2}
                  alignOffset={-4}
                >
                  <Menubar.Item className={ITEM} disabled>
                    (none)
                  </Menubar.Item>
                </Menubar.SubContent>
              </Menubar.Portal>
            </Menubar.Sub>
            <Menubar.Item className={ITEM} onSelect={todo("Spawner")}>
              Spawner…
            </Menubar.Item>
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>

      {/* ─── Help ─── */}
      <Menubar.Menu>
        <Menubar.Trigger className={TRIGGER}>Help</Menubar.Trigger>
        <Menubar.Portal>
          <Menubar.Content
            className={CONTENT}
            align="start"
            sideOffset={4}
          >
            <Menubar.Item className={ITEM} onSelect={() => onOpenAboutDialog()}>
              About
            </Menubar.Item>
          </Menubar.Content>
        </Menubar.Portal>
      </Menubar.Menu>
    </Menubar.Root>
  );
}
