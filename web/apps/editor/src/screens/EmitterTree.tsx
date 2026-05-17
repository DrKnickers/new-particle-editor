// EmitterTree — read-only sidebar tree of the live ParticleSystem's
// emitters (Phase 3 Screen 4 Batch A). Mutations, drag/drop, context
// menu, inline rename, multi-select, keyboard nav and link-group
// bracket visuals are Batch B / Batch C — explicitly out of scope here.
//
// State sync model:
//   - Tree itself is fetched via `emitters/list` on mount and re-fetched
//     on every `emitters/tree/changed` event. Trees can be hundreds of
//     nodes for complex systems, so they don't ride every snapshot.
//   - Selection is derived from `engine/state/snapshot.selectedEmitterId`
//     and refreshed on every `emitters/selected` event. No local
//     selection state — server is the single source of truth so
//     external mutations (legacy --legacy-ui edits, devtools) propagate
//     for free.
//   - Click → fires `emitters/select { id }`. The server emits the
//     event back and we re-render with the new selected styling.
//
// Role glyphs (single-character lucide-free alternatives so we don't
// have to negotiate icon-set additions): "root" is a filled disc "●",
// "lifetime" is the cyclic-arrow "↻" (continuous spawn during parent's
// lifetime), "death" is "✕" (one-shot spawn when parent dies). Greyed
// when `visible === false`.
//
// Link-group dot: a small filled circle in `bg-sky-500` when
// `linkGroup !== 0`. Tooltip exposes the group ID for now; the full
// coloured-bracket visualization (MT-9 port) is Batch C.

import { useCallback, useEffect, useState } from "react";
import type {
  Bridge,
  EmitterTreeDto,
  EmitterTreeNode,
} from "@particle-editor/bridge-schema";

type Props = {
  bridge: Bridge;
};

/** Map role → display glyph. Pure presentational — no role-specific
 *  behaviour wiring this batch. */
function roleGlyph(role: EmitterTreeNode["role"]): string {
  switch (role) {
    case "root":     return "●";
    case "lifetime": return "↻";
    case "death":    return "✕";
  }
}

/** Aria label for the role glyph; assistive tech reads this. */
function roleLabel(role: EmitterTreeNode["role"]): string {
  switch (role) {
    case "root":     return "root emitter";
    case "lifetime": return "lifetime child";
    case "death":    return "death child";
  }
}

type RowProps = {
  node: EmitterTreeNode;
  depth: number;
  selectedId: number | null;
  onSelect: (id: number) => void;
};

function EmitterRow({ node, depth, selectedId, onSelect }: RowProps) {
  const selected = selectedId === node.id;
  // Indent by 12px per depth level. Depth 0 (real roots) sits flush
  // against the left edge of the row's padding; nested children step
  // in by depth*12.
  const indentPx = depth * 12;

  return (
    <li role="treeitem" aria-selected={selected}>
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        data-emitter-id={node.id}
        className={[
          "flex w-full items-center gap-1.5 py-1 pr-2 text-left text-sm transition-colors",
          "border-l-2",
          selected
            ? "bg-sky-500/15 border-sky-500 text-neutral-50 font-medium"
            : "border-transparent text-neutral-300 hover:bg-neutral-900/40",
          node.visible ? "" : "opacity-50",
        ].join(" ")}
        style={{ paddingLeft: `${8 + indentPx}px` }}
      >
        <span
          aria-label={roleLabel(node.role)}
          className="inline-block w-3 shrink-0 text-center font-mono text-xs text-neutral-500"
        >
          {roleGlyph(node.role)}
        </span>
        <span className="truncate">{node.name}</span>
        {node.linkGroup !== 0 && (
          <span
            title={`Link group ${node.linkGroup}`}
            aria-label={`Link group ${node.linkGroup}`}
            className="ml-auto inline-block size-2 shrink-0 rounded-full bg-sky-500"
          />
        )}
      </button>
      {node.children.length > 0 && (
        <ul role="group" className="m-0 list-none p-0">
          {node.children.map((c) => (
            <EmitterRow
              key={c.id}
              node={c}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function EmitterTree({ bridge }: Props) {
  const [tree, setTree] = useState<EmitterTreeDto | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Fetch the full tree from the host. Pulled into a callback so the
  // tree-changed subscription can re-trigger it.
  const refreshTree = useCallback(() => {
    let cancelled = false;
    bridge
      .request({ kind: "emitters/list", params: {} })
      .then((t) => {
        if (!cancelled) setTree(t);
      })
      .catch((err) => console.warn("[EmitterTree] emitters/list failed:", err));
    return () => { cancelled = true; };
  }, [bridge]);

  // Initial fetch + tree-changed subscription. The event isn't emitted
  // by anything in Batch A but the plumbing is here so Batch B (which
  // adds mutations) doesn't have to re-wire it.
  useEffect(() => {
    const cancelList = refreshTree();
    const offTree = bridge.on("emitters/tree/changed", () => {
      refreshTree();
    });
    return () => {
      cancelList();
      offTree();
    };
  }, [bridge, refreshTree]);

  // Initial selected-id seed from snapshot + live updates from
  // emitters/selected events. Snapshot-on-mount avoids racing with a
  // post-load selection that arrived before the component mounted.
  useEffect(() => {
    let cancelled = false;
    bridge
      .request({ kind: "engine/state/snapshot", params: {} })
      .then((s) => {
        if (!cancelled) setSelectedId(s.selectedEmitterId ?? null);
      })
      .catch((err) => console.warn("[EmitterTree] snapshot failed:", err));
    const offSelected = bridge.on("emitters/selected", (e) => {
      setSelectedId(e.payload.id);
    });
    return () => {
      cancelled = true;
      offSelected();
    };
  }, [bridge]);

  const handleSelect = useCallback(
    (id: number) => {
      void bridge.request({ kind: "emitters/select", params: { id } });
    },
    [bridge],
  );

  // Empty tree state: the synthetic root has no real children (no
  // emitters in the live system).
  const rootChildren = tree?.root.children ?? [];

  return (
    <div
      data-testid="emitter-tree"
      className="flex h-full flex-col"
    >
      <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">
        Emitters
      </div>
      {tree === null ? (
        <div className="text-neutral-600 text-sm">(loading…)</div>
      ) : rootChildren.length === 0 ? (
        <div className="text-neutral-600 text-sm">(no emitters)</div>
      ) : (
        <ul role="tree" aria-label="Emitters" className="m-0 list-none p-0">
          {rootChildren.map((n) => (
            <EmitterRow
              key={n.id}
              node={n}
              depth={0}
              selectedId={selectedId}
              onSelect={handleSelect}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
