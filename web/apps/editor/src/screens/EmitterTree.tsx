// EmitterTree — sidebar tree of the live ParticleSystem's emitters.
//
// Phase 3 Screen 4 Batch A: read-only render + single-select.
// Phase 3 Screen 4 Batch B1: right-click context menu + 4 modal dialogs
//                            for Rename/Duplicate/Delete/Increment/
//                            Rescale/LinkGroupSettings.
// Phase 3 Screen 4 Batch B2: Add Lifetime/Death Child, Move Up/Down,
//                            Set Link Group… / Leave Link Group, plus
//                            React-side multi-select (Ctrl/Cmd + Shift
//                            + plain click). Drag/drop is Batch B3,
//                            inline rename / keyboard nav / link-group
//                            bracket visualisation is Batch C.
//
// Multi-select model: server tracks only the primary id (via the
// existing `emitters/select`); React layers an in-memory `ids[]` +
// `primary` atom on top (see `lib/emitter-selection.ts`). Plain click
// = setSingle + bridge select. Ctrl/Cmd+click = toggle. Shift+click =
// range from primary to clicked along rendered tree order. Right-click
// on a row not in the multi-selection promotes that row to single-
// select before opening the menu so the batch operations operate on
// the row the user actually targeted.
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

import { useCallback, useEffect, useMemo, useState } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import type {
  Bridge,
  EmitterTreeDto,
  EmitterTreeNode,
} from "@particle-editor/bridge-schema";
import { openTreeContextDialog } from "@/lib/tree-context";
import {
  useEmitterSelectionIds,
  useEmitterSelectionPrimary,
  useEmitterSelectionStore,
} from "@/lib/emitter-selection";
import {
  computeDropZone,
  computeRootGapIndex,
  isDescendant,
  resolveReparentSlot,
  type DropZone,
} from "@/lib/drop-zone";

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

/** Flatten the rendered tree into a depth-first list of `(node, depth,
 *  siblings, indexInSiblings)`. Used by both rendering and the shift-
 *  click range computation. */
type FlatRow = {
  node: EmitterTreeNode;
  depth: number;
  siblings: EmitterTreeNode[];
  indexInSiblings: number;
};

function flattenTree(tree: EmitterTreeDto | null): FlatRow[] {
  if (tree === null) return [];
  const rows: FlatRow[] = [];
  const walk = (
    siblings: EmitterTreeNode[],
    depth: number,
  ) => {
    siblings.forEach((node, idx) => {
      rows.push({ node, depth, siblings, indexInSiblings: idx });
      walk(node.children, depth + 1);
    });
  };
  walk(tree.root.children, 0);
  return rows;
}

// Drop indicator state. Owned at the EmitterTree level so only one row
// at a time displays a visual indicator. `targetId` is the row currently
// being hovered; `zone` is which third of the row's rect the cursor is
// in. `null` means no active drag-over.
type DropIndicator = { targetId: number; zone: DropZone } | null;

type RowProps = {
  row: FlatRow;
  primaryId: number | null;
  selectedIds: number[];
  orderedIds: number[];
  onRowClick: (id: number, mods: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
  bridge: Bridge;
  // Batch B3 — drag/drop wiring threaded from the parent.
  draggingId: number | null;
  draggingNode: EmitterTreeNode | null;
  indicator: DropIndicator;
  setDraggingId: (id: number | null) => void;
  setIndicator: (i: DropIndicator) => void;
  rootChildren: EmitterTreeNode[];
  tree: EmitterTreeDto | null;
};

function EmitterRow({
  row, primaryId, selectedIds, orderedIds, onRowClick, bridge,
  draggingId, draggingNode, indicator, setDraggingId, setIndicator,
  rootChildren, tree,
}: RowProps) {
  const { node, depth, siblings, indexInSiblings } = row;
  const isPrimary = primaryId === node.id;
  const isSelected = selectedIds.includes(node.id);
  const isLinked = node.linkGroup !== 0;

  // Disabled states (derived from the tree DTO + the multi-selection).
  // The DTO doesn't expose `spawnDuringLife` / `spawnOnDeath` directly,
  // but children-by-role is equivalent: the slot is filled iff there's
  // a child of that role.
  const hasLifetimeChild = node.children.some((c) => c.role === "lifetime");
  const hasDeathChild    = node.children.some((c) => c.role === "death");
  // Move is a root-only operation. The engine refuses non-root moves
  // (children of the same role can't be swapped — at most one of each).
  const isRoot = node.role === "root";
  const canMoveUp   = isRoot && indexInSiblings > 0;
  const canMoveDown = isRoot && indexInSiblings < siblings.length - 1;

  // Leave Link Group: enabled when at least one of the currently
  // selected emitters has `linkGroup !== 0`. If the right-clicked row
  // isn't in the selection, fall back to the row's own linkGroup.
  // (The handler also promotes a non-selected right-clicked row to
  // single-select before the click reaches this menu state.)
  const selectionLinkGroups = useMemo(() => {
    return selectedIds.length > 0 ? selectedIds : [node.id];
  }, [selectedIds, node.id]);
  const leaveLinkGroupDisabled = useMemo(() => {
    // Need the tree to inspect linkGroup; rebuild a fast lookup.
    const idToLinkGroup = new Map<number, number>();
    const visit = (n: EmitterTreeNode) => {
      idToLinkGroup.set(n.id, n.linkGroup);
      n.children.forEach(visit);
    };
    // We only have the row itself + the row's own subtree here. The
    // ordered-ids list is the in-order walk; we leverage *that* with
    // a child-look-up via the closures the parent passed. To keep
    // memory churn tight, derive the answer from the row + the
    // multi-selection by treating "we don't know the rest" as the
    // most permissive case (enabled). The Leave-LG bridge call is
    // idempotent on linkGroup=0, so the worst case is a redundant
    // round-trip on a no-op, not a wrong-result mutation.
    if (selectionLinkGroups.length === 1) {
      if (selectionLinkGroups[0] === node.id) return node.linkGroup === 0;
    }
    // Walk the row's own subtree as best-effort fallback.
    visit(node);
    const lookup = (id: number): number | undefined => idToLinkGroup.get(id);
    return selectionLinkGroups.every((id) => (lookup(id) ?? 0) === 0);
  }, [selectionLinkGroups, node]);

  // Indent by 12px per depth level.
  const indentPx = depth * 12;

  // Context-menu handlers ────────────────────────────────────────────
  //
  // Each handler promotes the right-clicked row to single-select when
  // it isn't already in the selection. Without that step, "Set Link
  // Group…" would fire on whatever the previous selection was, which
  // is surprising. The promotion routes through the bridge so the
  // server's primary id and React's primary stay in lock-step.

  /** Snapshot the current selection at handler-execution time, falling
   *  back to a single-select of `node.id` when nothing is selected or
   *  when the row isn't already in the selection. */
  const resolveTargetIds = (): number[] => {
    const cur = useEmitterSelectionStore.getState().ids;
    if (cur.includes(node.id) && cur.length > 0) return [...cur];
    // Promote.
    useEmitterSelectionStore.getState().setSingle(node.id);
    void bridge.request({ kind: "emitters/select", params: { id: node.id } });
    return [node.id];
  };

  const handleRename = () => {
    resolveTargetIds();
    openTreeContextDialog("rename", node.id);
  };
  const handleDuplicate = () => {
    resolveTargetIds();
    void bridge.request({ kind: "emitters/duplicate", params: { id: node.id } });
  };
  const handleDelete = () => {
    resolveTargetIds();
    void bridge.request({ kind: "emitters/delete", params: { id: node.id } });
  };
  const handleIncrement = () => {
    resolveTargetIds();
    openTreeContextDialog("increment", node.id);
  };
  const handleRescale = () => {
    resolveTargetIds();
    openTreeContextDialog("rescale", node.id);
  };
  const handleLinkGroupSettings = () => {
    resolveTargetIds();
    openTreeContextDialog("link-group", node.id, node.linkGroup);
  };
  const handleAddLifetimeChild = () => {
    resolveTargetIds();
    void bridge.request({
      kind: "emitters/add-lifetime-child",
      params: { parentId: node.id },
    });
  };
  const handleAddDeathChild = () => {
    resolveTargetIds();
    void bridge.request({
      kind: "emitters/add-death-child",
      params: { parentId: node.id },
    });
  };
  const handleMoveUp = () => {
    resolveTargetIds();
    void bridge.request({
      kind: "emitters/move",
      params: { id: node.id, direction: "up" },
    });
  };
  const handleMoveDown = () => {
    resolveTargetIds();
    void bridge.request({
      kind: "emitters/move",
      params: { id: node.id, direction: "down" },
    });
  };
  const handleSetLinkGroup = () => {
    resolveTargetIds();
    openTreeContextDialog("set-link-group", node.id);
  };
  const handleLeaveLinkGroup = () => {
    const ids = resolveTargetIds();
    void bridge.request({
      kind: "linkGroups/set-membership",
      params: { ids, groupId: null },
    });
  };

  // Reference orderedIds so eslint-no-unused-vars in the trimmed file
  // doesn't complain when the only consumer is the parent's click
  // handler. Passing it through props keeps the row symmetric with the
  // tree-flatten output.
  void orderedIds;

  // ── Batch B3 — drag/drop handlers ────────────────────────────────
  //
  // The row is both a drag source and a drop target. Drop semantics:
  //   - drop on a root row, upper third  → reorder above target root
  //   - drop on a root row, lower third  → reorder below target root
  //   - drop on any row,  middle third  → reparent under target
  // Validation runs in onDragOver: we only call preventDefault when the
  // drop would be valid, so invalid targets get the browser's
  // native no-drop cursor automatically.

  const isThisRowIndicator = indicator?.targetId === node.id;
  const indicatorZone = isThisRowIndicator ? indicator!.zone : null;

  const handleDragStart = (e: React.DragEvent<HTMLButtonElement>) => {
    // Use a stable id-only payload — the React side tracks the dragged
    // node via component state. jsdom strips dataTransfer in some test
    // environments, so guard the setData call.
    setDraggingId(node.id);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("text/plain", String(node.id));
      } catch {
        // jsdom may throw on setData; silently ignore so handler logic
        // remains testable.
      }
    }
  };

  /** Resolve drop intent + validate. Returns null when the drop is
   *  invalid (caller should NOT call preventDefault — browser then
   *  shows the no-drop cursor). */
  const resolveDropIntent = (
    e: React.DragEvent<HTMLButtonElement>,
  ): { zone: DropZone; valid: boolean } | null => {
    if (draggingNode === null) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const zone = computeDropZone(y, rect.height);

    // Self-drop is always invalid (drop on the source row).
    if (draggingNode.id === node.id) {
      return { zone, valid: false };
    }
    // Descendant-of-source target is always invalid (cycle).
    if (isDescendant(draggingNode, node.id)) {
      return { zone, valid: false };
    }
    if (zone === "onto") {
      // Reparent: need a free slot on the target. Both filled → refuse.
      const slot = resolveReparentSlot(node);
      if (slot === null) return { zone, valid: false };
      // Refuse same-parent reparent — matches engine's slot-switching
      // refusal. We check by walking the tree for the source's current
      // parent and comparing to the target.
      if (tree !== null) {
        const findParent = (
          n: EmitterTreeNode,
          id: number,
        ): EmitterTreeNode | null => {
          for (const c of n.children) {
            if (c.id === id) return n;
            const hit = findParent(c, id);
            if (hit) return hit;
          }
          return null;
        };
        const parent = findParent(tree.root, draggingNode.id);
        if (parent !== null && parent.id === node.id) {
          return { zone, valid: false };
        }
      }
      return { zone, valid: true };
    }
    // Reorder: only valid when both source AND target are roots (gap
    // semantics apply to the root list).
    const sourceIsRoot = rootChildren.some((c) => c.id === draggingNode.id);
    const targetIsRoot = node.role === "root";
    if (!sourceIsRoot || !targetIsRoot) {
      return { zone, valid: false };
    }
    return { zone, valid: true };
  };

  const handleDragOver = (e: React.DragEvent<HTMLButtonElement>) => {
    const intent = resolveDropIntent(e);
    if (intent === null || !intent.valid) {
      // Clear any indicator we had on this row (invalid drop suppresses
      // visual feedback).
      if (isThisRowIndicator) setIndicator(null);
      return;
    }
    // Valid drop — preventDefault to allow drop and announce the move
    // effect via dataTransfer.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    if (!isThisRowIndicator || indicator!.zone !== intent.zone) {
      setIndicator({ targetId: node.id, zone: intent.zone });
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLButtonElement>) => {
    // DnD events bubble in strange ways: dragleave fires when the
    // cursor crosses ANY child element boundary, not just the row's
    // outer edge. Check `relatedTarget` (the element the cursor moved
    // to) — if it's still inside this row, ignore. The cast is safe
    // because relatedTarget is always either an Element or null.
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) {
      return;
    }
    if (isThisRowIndicator) setIndicator(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const intent = resolveDropIntent(e);
    setIndicator(null);
    setDraggingId(null);
    if (intent === null || !intent.valid || draggingNode === null) return;
    if (intent.zone === "onto") {
      const slot = resolveReparentSlot(node);
      if (slot === null) return;
      void bridge.request({
        kind: "emitters/drop",
        params: {
          mode: "reparent",
          id: draggingNode.id,
          targetId: node.id,
          slot,
        },
      });
      return;
    }
    // Reorder: compute the root-list gap index from the target's
    // position in the rendered root list + the zone.
    const targetRootIdx = rootChildren.findIndex((c) => c.id === node.id);
    if (targetRootIdx === -1) return;
    const rootIndex = computeRootGapIndex(targetRootIdx, intent.zone);
    void bridge.request({
      kind: "emitters/drop",
      params: {
        mode: "reorder",
        id: draggingNode.id,
        rootIndex,
      },
    });
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setIndicator(null);
  };

  // Reparent target visual: tint the row + ring.
  const reparentTintClass = indicatorZone === "onto"
    ? "bg-sky-500/30 ring-1 ring-sky-400"
    : "";

  const menuItemClass =
    "flex cursor-pointer items-center rounded px-2 py-1 text-xs text-neutral-200 outline-none data-[disabled]:cursor-not-allowed data-[disabled]:text-neutral-600 data-[highlighted]:bg-neutral-800";
  const separatorClass =
    "my-1 h-px bg-neutral-800";

  // Selected-row styling (Batch B2):
  //   - primary       : strong sky-500 left border + sky-500/15 bg
  //   - non-primary   : softer sky-400/50 left border + sky-500/15 bg
  //   - unselected    : transparent border + hover bg
  const borderClass = isPrimary
    ? "border-sky-500"
    : isSelected
      ? "border-sky-400/50"
      : "border-transparent";
  const rowBgClass = isSelected
    ? "bg-sky-500/15 text-neutral-50"
    : "text-neutral-300 hover:bg-neutral-900/40";
  const fontClass = isPrimary ? "font-medium" : "";

  return (
    <li role="treeitem" aria-selected={isSelected} className="relative">
      {/* Insertion line: 2px sky-400 bar at the top or bottom of the row
          during dragover for the reorder zones. Absolute-positioned so
          it doesn't perturb the row's layout. */}
      {indicatorZone === "above" && (
        <div
          data-testid={`drop-indicator-above-${node.id}`}
          className="pointer-events-none absolute left-0 right-0 top-0 z-10 h-0.5 bg-sky-400"
        />
      )}
      {indicatorZone === "below" && (
        <div
          data-testid={`drop-indicator-below-${node.id}`}
          className="pointer-events-none absolute left-0 right-0 bottom-0 z-10 h-0.5 bg-sky-400"
        />
      )}
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <button
            type="button"
            draggable
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            onClick={(e) =>
              onRowClick(node.id, {
                ctrlKey: e.ctrlKey,
                metaKey: e.metaKey,
                shiftKey: e.shiftKey,
              })
            }
            // Right-click also promotes a non-selected row to single-
            // select before the Radix menu opens — keeps menu state
            // consistent with what the user just targeted.
            onContextMenu={() => {
              const cur = useEmitterSelectionStore.getState().ids;
              if (!cur.includes(node.id)) {
                useEmitterSelectionStore.getState().setSingle(node.id);
                void bridge.request({
                  kind: "emitters/select",
                  params: { id: node.id },
                });
              }
            }}
            data-emitter-id={node.id}
            data-link-group={node.linkGroup}
            data-selected={isSelected ? "true" : "false"}
            data-primary={isPrimary ? "true" : "false"}
            data-drop-zone={indicatorZone ?? ""}
            data-dragging={draggingId === node.id ? "true" : "false"}
            className={[
              "flex w-full items-center gap-1.5 py-1 pr-2 text-left text-sm transition-colors",
              "border-l-2",
              borderClass,
              rowBgClass,
              reparentTintClass,
              fontClass,
              node.visible ? "" : "opacity-50",
              draggingId === node.id ? "opacity-50" : "",
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
            {isLinked && (
              <span
                title={`Link group ${node.linkGroup}`}
                aria-label={`Link group ${node.linkGroup}`}
                className="ml-auto inline-block size-2 shrink-0 rounded-full bg-sky-500"
              />
            )}
          </button>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            data-testid={`emitter-context-menu-${node.id}`}
            className="z-50 min-w-[220px] rounded-md border border-neutral-700 bg-neutral-900 p-1 shadow-xl"
          >
            <ContextMenu.Item onSelect={handleRename} className={menuItemClass}>
              Rename
            </ContextMenu.Item>
            <ContextMenu.Item onSelect={handleDuplicate} className={menuItemClass}>
              Duplicate
            </ContextMenu.Item>
            <ContextMenu.Item onSelect={handleDelete} className={menuItemClass}>
              Delete
            </ContextMenu.Item>
            <ContextMenu.Separator className={separatorClass} />
            <ContextMenu.Item onSelect={handleIncrement} className={menuItemClass}>
              Increment Index…
            </ContextMenu.Item>
            <ContextMenu.Item onSelect={handleRescale} className={menuItemClass}>
              Rescale Emitter…
            </ContextMenu.Item>
            <ContextMenu.Separator className={separatorClass} />
            <ContextMenu.Item
              onSelect={handleLinkGroupSettings}
              disabled={!isLinked}
              className={menuItemClass}
            >
              Link Group Settings…
            </ContextMenu.Item>
            {/* ─── Batch B2 additions ───────────────────────────── */}
            <ContextMenu.Separator className={separatorClass} />
            <ContextMenu.Item
              onSelect={handleAddLifetimeChild}
              disabled={hasLifetimeChild}
              className={menuItemClass}
            >
              Add Lifetime Child
            </ContextMenu.Item>
            <ContextMenu.Item
              onSelect={handleAddDeathChild}
              disabled={hasDeathChild}
              className={menuItemClass}
            >
              Add Death Child
            </ContextMenu.Item>
            <ContextMenu.Separator className={separatorClass} />
            <ContextMenu.Item
              onSelect={handleMoveUp}
              disabled={!canMoveUp}
              className={menuItemClass}
            >
              Move Up
            </ContextMenu.Item>
            <ContextMenu.Item
              onSelect={handleMoveDown}
              disabled={!canMoveDown}
              className={menuItemClass}
            >
              Move Down
            </ContextMenu.Item>
            <ContextMenu.Separator className={separatorClass} />
            <ContextMenu.Item
              onSelect={handleSetLinkGroup}
              className={menuItemClass}
            >
              Set Link Group…
            </ContextMenu.Item>
            <ContextMenu.Item
              onSelect={handleLeaveLinkGroup}
              disabled={leaveLinkGroupDisabled}
              className={menuItemClass}
            >
              Leave Link Group
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </li>
  );
}

export function EmitterTree({ bridge }: Props) {
  const [tree, setTree] = useState<EmitterTreeDto | null>(null);
  const selectedIds = useEmitterSelectionIds();
  const primaryId = useEmitterSelectionPrimary();

  // Batch B3 — drag/drop state. `draggingId` is the source row's id;
  // `indicator` is the row + zone currently displaying a drop hint.
  // Both lifted to the tree level so only one indicator can be active
  // and so rows can read the dragged node's subtree for cycle checks.
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [indicator, setIndicator] = useState<DropIndicator>(null);

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

  // Initial fetch + tree-changed subscription.
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
  // emitters/selected events. The server tracks only the primary; we
  // sync that into the React-side selection atom whenever a new
  // selection arrives from outside (legacy --legacy-ui edit, devtools
  // poke, post-mutation cleanup).
  useEffect(() => {
    let cancelled = false;
    bridge
      .request({ kind: "engine/state/snapshot", params: {} })
      .then((s) => {
        if (cancelled) return;
        const id = s.selectedEmitterId ?? null;
        const sel = useEmitterSelectionStore.getState();
        if (id === null) {
          if (sel.ids.length === 0 && sel.primary === null) return;
          sel.clear();
        } else if (sel.primary !== id) {
          sel.setSingle(id);
        }
      })
      .catch((err) => console.warn("[EmitterTree] snapshot failed:", err));
    const offSelected = bridge.on("emitters/selected", (e) => {
      const id = e.payload.id;
      const sel = useEmitterSelectionStore.getState();
      if (id === null) {
        sel.clear();
      } else if (sel.primary !== id) {
        // Server says "primary is now id". If the React-side set
        // doesn't include it, replace the selection; if it already
        // contains it, just shift primary without dropping the set.
        if (sel.ids.includes(id)) {
          useEmitterSelectionStore.setState({ primary: id });
        } else {
          sel.setSingle(id);
        }
      }
    });
    return () => {
      cancelled = true;
      offSelected();
    };
  }, [bridge]);

  // Flatten the tree once per change. The flat list drives both
  // render and the shift-click range computation.
  const flatRows  = useMemo(() => flattenTree(tree), [tree]);
  const orderedIds = useMemo(() => flatRows.map((r) => r.node.id), [flatRows]);

  const handleRowClick = useCallback(
    (
      id: number,
      mods: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
    ) => {
      const sel = useEmitterSelectionStore.getState();
      if (mods.shiftKey) {
        sel.range(id, orderedIds);
      } else if (mods.ctrlKey || mods.metaKey) {
        sel.toggle(id);
      } else {
        sel.setSingle(id);
      }
      // Always sync the new primary to the server. After the action
      // above, primary may have shifted (toggle that removed primary,
      // for example).
      const newPrimary = useEmitterSelectionStore.getState().primary;
      void bridge.request({
        kind: "emitters/select",
        params: { id: newPrimary },
      });
    },
    [bridge, orderedIds],
  );

  const rootChildren = tree?.root.children ?? [];

  // Resolve the dragged node from id + flat row list (avoids a second
  // tree walk per render). null when no drag is in progress.
  const draggingNode = useMemo(() => {
    if (draggingId === null) return null;
    return flatRows.find((r) => r.node.id === draggingId)?.node ?? null;
  }, [draggingId, flatRows]);

  return (
    <div
      data-testid="emitter-tree"
      data-selected-count={selectedIds.length}
      data-primary-id={primaryId ?? ""}
      data-dragging-id={draggingId ?? ""}
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
          {flatRows.map((row) => (
            <EmitterRow
              key={row.node.id}
              row={row}
              primaryId={primaryId}
              selectedIds={selectedIds}
              orderedIds={orderedIds}
              onRowClick={handleRowClick}
              bridge={bridge}
              draggingId={draggingId}
              draggingNode={draggingNode}
              indicator={indicator}
              setDraggingId={setDraggingId}
              setIndicator={setIndicator}
              rootChildren={rootChildren}
              tree={tree}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
