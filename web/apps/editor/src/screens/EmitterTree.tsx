// EmitterTree — sidebar tree of the live ParticleSystem's emitters.
//
// Phase 3 Screen 4 Batch A: read-only render + single-select.
// Phase 3 Screen 4 Batch B1: right-click context menu + 4 modal dialogs
//                            for Rename/Duplicate/Delete/Increment/
//                            Rescale/LinkGroupSettings.
// Phase 3 Screen 4 Batch B2: Add Lifetime/Death Child, Move Up/Down,
//                            Set Link Group… / Leave Link Group, plus
//                            React-side multi-select (Ctrl/Cmd + Shift
//                            + plain click).
// Phase 3 Screen 4 Batch B3: HTML5 drag/drop reorder + reparent.
// Phase 3 Screen 4 Batch C : Link-group bracket gutter + inline rename
//                            (F2 / dbl-click / context-menu Rename;
//                            replaces B1's modal — `RenameEmitterDialog`
//                            is deleted) + keyboard nav (arrows / Home
//                            / End / Enter / F2 / Delete / Ctrl+C/X/V).
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
// Link-group dot: a small filled circle in `bg-accent` when
// `linkGroup !== 0`. The full coloured-bracket visualization (MT-9
// port) renders in the right gutter (Batch C); the dot itself stays
// as a per-row affordance for quick "this row is linked" recognition.
//
// Inline rename: a string-keyed Zustand atom would be overkill — local
// component state suffices because (a) only the tree owns the input
// HWND, (b) only the tree binds the keyboard handlers that drive the
// transitions. `editing: { id, value } | null`. Triggers: F2 on focused
// row, double-click on row label, or context-menu Rename. Commit on
// Enter / blur / click-outside via `emitters/rename`; cancel on Esc.
// Empty value reverts to the original (no commit).
//
// Keyboard nav: the tree's outer `<div>` carries `tabIndex={0}` so the
// container itself can receive focus, but each row is already a focus-
// able `<button>` — arrows shift focus row-by-row in flat order. The
// handler is attached to the tree container; it doesn't intercept
// keystrokes when the focus target is an `<input>` (so inline rename
// + downstream text fields stay usable).
//
// Clipboard: Ctrl+C / Ctrl+X / Ctrl+V on the focused tree dispatch
// `emitters/copy` / `emitters/cut` / `emitters/paste` against the
// current multi-selection. The C++ host owns the buffer; React just
// fires the bridge call. Paste appends new roots at the end (or after
// `afterId` — not surfaced through the keyboard path; only the future
// "Paste below selection" menu would supply it).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Menubar from "@radix-ui/react-menubar";
import { ChevronDown, ChevronUp, Copy, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { useViewportOcclusion } from "@/lib/viewport-occlusion";
import type {
  Bridge,
  EmitterTreeDto,
  EmitterTreeNode,
} from "@particle-editor/bridge-schema";
import { openTreeContextDialog } from "@/lib/tree-context";
import { useTreeActionStore } from "@/lib/tree-action";
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
import { computeLinkGroupBrackets, laneCount } from "@/lib/link-group-colors";

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

// Inline-rename state (Batch C). `editing.id` is the row currently in
// rename mode; `editing.value` is the live input value. The original
// name is captured at edit-start (`original`) so an empty-commit can
// revert without a tree re-fetch round-trip.
export type RenameEditingState = {
  id: number;
  value: string;
  original: string;
} | null;

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
  // Batch C — inline rename. `editing.id === node.id` means this row
  // renders an `<input>` instead of the label span. `beginEdit` starts
  // a new rename session against this row; `setEditValue` updates the
  // live value; `commitEdit` / `cancelEdit` end the session.
  editing: RenameEditingState;
  beginEdit: (id: number, currentName: string) => void;
  setEditValue: (value: string) => void;
  commitEdit: () => void;
  cancelEdit: () => void;
};

// FD10 (Group A): mirror of MenuBar's OccludingMenubarContent for
// ContextMenu. When the row's context menu mounts, we register its
// bounding rect as a viewport occlusion so the AlphaCompositor's
// alpha stamp opens a hole in the layered viewport popup at that
// location — without it the right side of the menu gets overpainted
// by the popup wherever it crosses the viewport rect.
function OccludingContextMenuContent({
  bridge,
  occlusionId,
  children,
  ...rest
}: ComponentProps<typeof ContextMenu.Content> & {
  bridge: Bridge;
  occlusionId: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // pad=24, feather=24 — matches the menubar dropdown's shadow-xl ring
  // so the popup alpha smoothly transitions from full-viewport at the
  // padded outer edge to full-cut at the menu's actual outline.
  useViewportOcclusion(bridge, occlusionId, ref, 24, 24);
  return (
    <ContextMenu.Content
      className="z-50 min-w-[220px] rounded-md border border-border-2 bg-bg-2 p-1 shadow-xl"
      {...rest}
    >
      <div ref={ref}>{children}</div>
    </ContextMenu.Content>
  );
}

function EmitterRow({
  row, primaryId, selectedIds, orderedIds, onRowClick, bridge,
  draggingId, draggingNode, indicator, setDraggingId, setIndicator,
  rootChildren, tree,
  editing, beginEdit, setEditValue, commitEdit, cancelEdit,
}: RowProps) {
  const { node, depth, siblings, indexInSiblings } = row;
  const isPrimary = primaryId === node.id;
  const isSelected = selectedIds.includes(node.id);
  const isLinked = node.linkGroup !== 0;
  const isEditing = editing !== null && editing.id === node.id;
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus + select-all on the input the moment editing toggles to
  // this row. The ref binds in the same render where `isEditing` flips
  // to true; the effect fires post-mount.
  useEffect(() => {
    if (isEditing && inputRef.current !== null) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

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
    // Batch C: context-menu Rename starts inline edit instead of
    // opening a modal. `RenameEmitterDialog` has been removed.
    resolveTargetIds();
    beginEdit(node.id, node.name);
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
    ? "bg-accent-soft ring-1 ring-sky-400"
    : "";

  const menuItemClass =
    "flex cursor-pointer items-center rounded px-2 py-1 text-xs text-text outline-none data-[disabled]:cursor-not-allowed data-[disabled]:text-text-3 data-[highlighted]:bg-panel-2";
  const separatorClass =
    "my-1 h-px bg-panel-2";

  // Selected-row styling (Batch B2):
  //   - primary       : strong sky-500 left border + sky-500/15 bg
  //   - non-primary   : softer sky-400/50 left border + sky-500/15 bg
  //   - unselected    : transparent border + hover bg
  const borderClass = isPrimary
    ? "border-accent"
    : isSelected
      ? "border-accent/50"
      : "border-transparent";
  const rowBgClass = isSelected
    ? "bg-accent-soft text-text"
    : "text-text-2 hover:bg-bg-2/40";
  const fontClass = isPrimary ? "font-medium" : "";

  return (
    <li role="treeitem" aria-selected={isSelected} className="relative">
      {/* Insertion line: 2px sky-400 bar at the top or bottom of the row
          during dragover for the reorder zones. Absolute-positioned so
          it doesn't perturb the row's layout. */}
      {indicatorZone === "above" && (
        <div
          data-testid={`drop-indicator-above-${node.id}`}
          className="pointer-events-none absolute left-0 right-0 top-0 z-10 h-0.5 bg-accent"
        />
      )}
      {indicatorZone === "below" && (
        <div
          data-testid={`drop-indicator-below-${node.id}`}
          className="pointer-events-none absolute left-0 right-0 bottom-0 z-10 h-0.5 bg-accent"
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
              "grid w-full items-center gap-1.5 py-1 pr-2 text-left text-sm transition-colors",
              "border-l-2",
              borderClass,
              rowBgClass,
              reparentTintClass,
              fontClass,
              node.visible ? "" : "opacity-50",
              draggingId === node.id ? "opacity-50" : "",
            ].join(" ")}
            style={{
              paddingLeft: `${8 + indentPx}px`,
              // Visual columns: [eye | role-glyph | name]. The role glyph
              // (children only) sits between the visibility toggle and the
              // label. DOM order stays [eye, label, role] — the glyph and
              // label are re-placed VISUALLY via grid-column below — so the
              // accessibility tree (and the emitter-tree a11y goldens, which
              // capture "default ↻" + the row's accessible name) are
              // unchanged. Eye auto-places into column 1.
              gridTemplateColumns: "18px 18px 1fr",
            }}
          >
            {/* F1: visibility toggle on the LEFT (replaces the old role
                dot). Always rendered so the grid columns stay stable
                during inline rename. */}
            <span
              role="button"
              tabIndex={0}
              data-testid={`emitter-vis-${node.id}`}
              onClick={(e) => {
                e.stopPropagation();
                void bridge.request({
                  kind: "emitters/set-visible",
                  params: { id: node.id, visible: !node.visible },
                });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  void bridge.request({
                    kind: "emitters/set-visible",
                    params: { id: node.id, visible: !node.visible },
                  });
                }
              }}
              title={node.visible ? "Hide emitter" : "Show emitter"}
              aria-label={node.visible ? "Hide emitter" : "Show emitter"}
              className="grid place-items-center w-4 h-4 shrink-0 rounded text-text-3 hover:bg-panel-2 hover:text-text cursor-pointer"
            >
              {node.visible
                ? <Eye className="size-3" />
                : <EyeOff className="size-3" />}
            </span>
            {isEditing ? (
              // Inline-rename input. Stops click + drag propagation so
              // typing doesn't accidentally re-trigger row selection /
              // drag-start. Commit on Enter, cancel on Esc; blur also
              // commits. Empty value reverts on commit (handled in the
              // parent's `commitEdit`).
              <input
                ref={inputRef}
                style={{ gridColumn: 3, gridRow: 1 }}
                data-testid={`emitter-rename-input-${node.id}`}
                value={editing!.value}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  // Stop the tree-level keyboard handler from snatching
                  // Backspace / Enter / Esc / arrows from the input.
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitEdit();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelEdit();
                  }
                }}
                onBlur={() => {
                  // Blur happens AFTER Enter / Esc handlers fire and
                  // toggle `editing` off; the conditional in the parent
                  // makes a second commit a no-op. Safer to always
                  // route through commitEdit on blur so click-outside
                  // works without an explicit click handler.
                  commitEdit();
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                className="min-w-0 flex-1 rounded border border-accent bg-bg px-1 py-0 text-sm text-text outline-none"
              />
            ) : (
              <span
                className="truncate"
                style={{ gridColumn: 3, gridRow: 1 }}
                onDoubleClick={(e) => {
                  // Double-click on the label starts inline rename. The
                  // stopPropagation prevents the click-handler chain
                  // above from re-firing single-select on the second
                  // click.
                  e.stopPropagation();
                  beginEdit(node.id, node.name);
                }}
              >
                {node.name}
              </span>
            )}
            {/* Spawn-role glyph for child emitters (lifetime ↻ / on-death ✕),
                placed VISUALLY in column 2 (between the eye and the label)
                via grid-column. Rendered last in DOM so the accessible name
                stays "…default lifetime child" and the goldens are stable.
                Root rows omit it; column 2 then sits empty and the label
                stays in column 3. */}
            {node.role !== "root" && (
              <span
                aria-label={roleLabel(node.role)}
                style={{ gridColumn: 2, gridRow: 1 }}
                className="inline-block w-full shrink-0 text-center font-mono text-xs text-text-3"
              >
                {roleGlyph(node.role)}
              </span>
            )}
          </button>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <OccludingContextMenuContent
            bridge={bridge}
            occlusionId="context-menu:emitter-tree"
            data-testid={`emitter-context-menu-${node.id}`}
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
            <ContextMenu.Item
              onSelect={handleLinkGroupSettings}
              disabled={!isLinked}
              className={menuItemClass}
            >
              Link Group Settings…
            </ContextMenu.Item>
          </OccludingContextMenuContent>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </li>
  );
}

// Row-height for the bracket gutter math. Matches the `py-1`+`text-sm`
// row styling — empirically ~24px in the current theme. Static so the
// bracket layer can lay out absolutely without per-render measurement
// (a ResizeObserver pass adds complexity for a polish detail; if the
// tree theme changes this constant moves with it).
const ROW_HEIGHT_PX     = 24;
const LANE_WIDTH_PX     = 10;  // 2px bracket + 8px gap to next lane
const GUTTER_LEFT_PAD_PX = 4;
const GUTTER_MIN_PX     = 4;   // when no link groups exist (constant minimum to avoid layout shift)
// F5: small fixed gap between the rows and the bracket gutter. The gutter
// is now a real flex column (reserves its own width), so the old
// `marginRight: gutterPx` was redundant double-spacing that pushed the
// brackets ~18px off the names. A 2px gap hugs the rows like legacy 0.2.
const GUTTER_GAP_PX     = 2;

// ─── Panel-header toolbar ────────────────────────────────────────────
// FD10 (Group A polish): restore the legacy panel toolbar from
// src/UI/EmitterList.cpp:3016. Layout matches legacy ordering:
//   [New ▾] [Delete] [▲ Move Up] [▼ Move Down]   (this batch)
//   [👁]    [Show All] [Hide All]                (next batch, T2/T3)
// All four buttons here use bridge calls that already exist in the
// schema — no host-side work needed.

// F2: 28px square to match the main toolbar's `.tb-btn`. F3: `:active`
// pressed state (lighter bg + slight scale) via Tailwind `active:`,
// suppressed while disabled.
const TOOLBAR_BTN =
  "flex h-7 w-7 items-center justify-center rounded text-text-2 transition hover:bg-panel-2 hover:text-text active:bg-panel-3 active:scale-95 disabled:cursor-not-allowed disabled:text-text-3 disabled:hover:bg-transparent disabled:active:scale-100 outline-none";

const NEW_EMITTER_MENU_ITEM =
  "flex select-none items-center gap-2 rounded px-2 py-1 text-xs text-text hover:bg-panel-2 focus:bg-panel-2 outline-none cursor-pointer data-[disabled]:text-text-3 data-[disabled]:cursor-not-allowed data-[disabled]:hover:bg-transparent";

function findNodeInTree(
  tree: EmitterTreeDto | null,
  id: number | null,
): { node: EmitterTreeNode; siblings: EmitterTreeNode[]; indexInSiblings: number } | null {
  if (tree === null || id === null) return null;
  const walk = (
    siblings: EmitterTreeNode[],
  ): ReturnType<typeof findNodeInTree> => {
    for (let i = 0; i < siblings.length; i++) {
      const n = siblings[i];
      if (n.id === id) return { node: n, siblings, indexInSiblings: i };
      const hit = walk(n.children);
      if (hit !== null) return hit;
    }
    return null;
  };
  return walk(tree.root.children);
}

type ToolbarProps = {
  bridge: Bridge;
  tree: EmitterTreeDto | null;
  primaryId: number | null;
};

function EmitterTreeToolbar({ bridge, tree, primaryId }: ToolbarProps) {
  const primary = findNodeInTree(tree, primaryId);
  const hasPrimary = primary !== null;
  // Lifetime/Death child adds require both a primary AND a free slot
  // (parents can hold at most one of each role).
  const canAddLifetime =
    hasPrimary && !primary!.node.children.some((c) => c.role === "lifetime");
  const canAddDeath =
    hasPrimary && !primary!.node.children.some((c) => c.role === "death");
  // Move is a root-only operation — same gate as the per-row context
  // menu. Sibling reordering at lifetime/death depth is a separate
  // capability not exposed by the legacy panel toolbar either.
  const isRootPrimary = hasPrimary && primary!.node.role === "root";
  const canMoveUp =
    isRootPrimary && primary!.indexInSiblings > 0;
  const canMoveDown =
    isRootPrimary &&
    primary!.indexInSiblings < primary!.siblings.length - 1;

  const addRoot = () =>
    void bridge.request({ kind: "emitters/add-root", params: {} });
  const addLifetime = () => {
    if (primaryId === null) return;
    void bridge.request({
      kind: "emitters/add-lifetime-child",
      params: { parentId: primaryId },
    });
  };
  const addDeath = () => {
    if (primaryId === null) return;
    void bridge.request({
      kind: "emitters/add-death-child",
      params: { parentId: primaryId },
    });
  };
  const duplicatePrimary = () => {
    if (primaryId === null) return;
    void bridge.request({
      kind: "emitters/duplicate",
      params: { id: primaryId },
    });
  };
  const del = () => {
    if (primaryId === null) return;
    void bridge.request({ kind: "emitters/delete", params: { id: primaryId } });
  };
  const moveUp = () => {
    if (primaryId === null) return;
    void bridge.request({
      kind: "emitters/move",
      params: { id: primaryId, direction: "up" },
    });
  };
  const moveDown = () => {
    if (primaryId === null) return;
    void bridge.request({
      kind: "emitters/move",
      params: { id: primaryId, direction: "down" },
    });
  };
  const showAll = () =>
    void bridge.request({
      kind: "emitters/set-all-visible",
      params: { visible: true },
    });
  const hideAll = () =>
    void bridge.request({
      kind: "emitters/set-all-visible",
      params: { visible: false },
    });

  return (
    <div
      data-testid="emitter-tree-toolbar"
      className="tree-actions"
    >
      <Menubar.Root>
        <Menubar.Menu>
          <Menubar.Trigger
            className={TOOLBAR_BTN}
            title="New Emitter"
            aria-label="New Emitter"
          >
            <Plus className="size-4" />
          </Menubar.Trigger>
          <Menubar.Portal>
            <Menubar.Content
              className="min-w-[160px] rounded-md border border-border bg-bg-2 p-1 shadow-xl z-50"
              align="start"
              sideOffset={4}
            >
              <Menubar.Item
                onSelect={addRoot}
                className={NEW_EMITTER_MENU_ITEM}
              >
                Root Emitter
              </Menubar.Item>
              <Menubar.Item
                onSelect={addLifetime}
                disabled={!canAddLifetime}
                className={NEW_EMITTER_MENU_ITEM}
              >
                Lifetime Child
              </Menubar.Item>
              <Menubar.Item
                onSelect={addDeath}
                disabled={!canAddDeath}
                className={NEW_EMITTER_MENU_ITEM}
              >
                Death Child
              </Menubar.Item>
            </Menubar.Content>
          </Menubar.Portal>
        </Menubar.Menu>
      </Menubar.Root>
      <button
        type="button"
        className={TOOLBAR_BTN}
        title="Duplicate"
        aria-label="Duplicate emitter"
        disabled={!hasPrimary}
        onClick={duplicatePrimary}
      >
        <Copy className="size-4" />
      </button>
      <button
        type="button"
        className={TOOLBAR_BTN}
        title="Delete"
        aria-label="Delete emitter"
        disabled={!hasPrimary}
        onClick={del}
      >
        <Trash2 className="size-4" />
      </button>
      <button
        type="button"
        className={TOOLBAR_BTN}
        title="Move Up"
        aria-label="Move emitter up"
        disabled={!canMoveUp}
        onClick={moveUp}
      >
        <ChevronUp className="size-4" />
      </button>
      <button
        type="button"
        className={TOOLBAR_BTN}
        title="Move Down"
        aria-label="Move emitter down"
        disabled={!canMoveDown}
        onClick={moveDown}
      >
        <ChevronDown className="size-4" />
      </button>
      <button
        type="button"
        className={TOOLBAR_BTN}
        title="Show All Emitters"
        aria-label="Show all emitters"
        onClick={showAll}
      >
        <Eye className="size-4" />
      </button>
      <button
        type="button"
        className={TOOLBAR_BTN}
        title="Hide All Emitters"
        aria-label="Hide all emitters"
        onClick={hideAll}
      >
        <EyeOff className="size-4" />
      </button>
    </div>
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

  // Batch C — inline rename. Local component state because only the
  // tree owns both the focus target (each row's button) and the input
  // (mounted inside the row). One row at a time; null = no edit in
  // progress.
  const [editing, setEditing] = useState<RenameEditingState>(null);
  const editingRef = useRef<RenameEditingState>(null);
  useEffect(() => { editingRef.current = editing; }, [editing]);

  const beginEdit = useCallback((id: number, currentName: string) => {
    setEditing({ id, value: currentName, original: currentName });
  }, []);
  const setEditValue = useCallback((value: string) => {
    setEditing((cur) => (cur === null ? null : { ...cur, value }));
  }, []);
  const cancelEdit = useCallback(() => { setEditing(null); }, []);
  const commitEdit = useCallback(() => {
    const cur = editingRef.current;
    if (cur === null) return;
    const trimmed = cur.value.trim();
    // Empty name → silent revert (no bridge call). Matches legacy: an
    // empty rename was rejected at the TreeView level.
    // Unchanged name → still revert without firing the bridge call;
    // saves a wire round-trip on a no-op commit (e.g. F2 → Enter).
    if (trimmed.length === 0 || trimmed === cur.original) {
      setEditing(null);
      return;
    }
    void bridge.request({
      kind: "emitters/rename",
      params: { id: cur.id, name: trimmed },
    });
    setEditing(null);
  }, [bridge]);

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

  // Phase 4.1 Fix dispatch 5 — subscribe to menu-driven rename
  // requests. The MenuBar's "Rename Emitter" item writes the target
  // id into the tree-action atom; we pick it up, begin inline edit
  // (same path as F2 / context-menu Rename / dbl-click), and consume
  // the request. Silently no-op if the target id doesn't resolve to
  // a current row — matches the defensive guard the F2 handler uses
  // for the same race (mid-mutation, deleted emitter, etc.).
  const renameRequest = useTreeActionStore((s) => s.renameRequest);
  useEffect(() => {
    if (renameRequest === null) return;
    const node = flatRows.find((r) => r.node.id === renameRequest)?.node ?? null;
    if (node !== null) beginEdit(node.id, node.name);
    useTreeActionStore.getState().consumeRenameRequest();
  }, [renameRequest, flatRows, beginEdit]);

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

  // Bracket descriptors for the right gutter. One entry per non-zero
  // linkGroup; the renderer absolute-positions each as a vertical bar
  // + top/bottom horizontal caps.
  const brackets = useMemo(
    () => computeLinkGroupBrackets(flatRows.map((r) => r.node)),
    [flatRows],
  );

  // Gutter width derived from the number of bracket lanes in use. The
  // 4px minimum keeps the gutter from collapsing to 0 when no groups
  // exist — avoids a layout shift the first time a group appears.
  const lanes = laneCount(brackets);
  const gutterPx =
    lanes === 0 ? GUTTER_MIN_PX : lanes * LANE_WIDTH_PX + GUTTER_LEFT_PAD_PX;

  // ── Batch C — keyboard handler ─────────────────────────────────
  //
  // Routes via the focused row's `data-emitter-id`. The tree container
  // is `tabIndex={0}` so it can hold focus when no row is focused
  // (initial-load case). Arrow/Home/End shift focus; Enter/F2/Delete/
  // Ctrl+C/X/V fire actions. Keystrokes targeting an `<input>` are
  // never intercepted — the inline-rename input stops propagation on
  // its own onKeyDown anyway, but the tagName guard is the safety net.
  //
  // Focus is shifted by querying the rendered DOM for the target row's
  // button and calling `.focus()` on it. The button is the actual
  // focus target (the container's tabIndex just lets users tab INTO
  // the tree); arrow nav within the tree always lands on a row button.
  const treeContainerRef = useRef<HTMLDivElement | null>(null);

  const focusRowById = useCallback((id: number) => {
    if (treeContainerRef.current === null) return;
    const btn = treeContainerRef.current.querySelector(
      `button[data-emitter-id="${id}"]`,
    ) as HTMLButtonElement | null;
    btn?.focus();
  }, []);

  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Never steal keystrokes when the focus is in a text input
      // (inline-rename, spinners, modal text fields that might bubble).
      const target = e.target as HTMLElement | null;
      if (target !== null && target.tagName === "INPUT") return;
      // Editing mode disables the global keyboard nav so the input
      // owns all keys. (The input's onKeyDown stops propagation too;
      // belt + braces.)
      if (editingRef.current !== null) return;

      // Resolve the focused row id from the active element's
      // `data-emitter-id`, falling back to the React-side primary so
      // the first keypress lands somewhere sensible.
      const active = document.activeElement as HTMLElement | null;
      const activeIdStr = active?.getAttribute("data-emitter-id") ?? null;
      const focusedId = activeIdStr !== null ? Number.parseInt(activeIdStr, 10) : primaryId;
      const focusedIdx = focusedId !== null ? orderedIds.indexOf(focusedId) : -1;

      // Helpers — used by multiple branches below.
      const moveFocus = (nextIdx: number) => {
        if (nextIdx < 0 || nextIdx >= orderedIds.length) return;
        const nextId = orderedIds[nextIdx]!;
        e.preventDefault();
        useEmitterSelectionStore.getState().setSingle(nextId);
        void bridge.request({
          kind: "emitters/select",
          params: { id: nextId },
        });
        focusRowById(nextId);
      };

      if (e.key === "ArrowDown") {
        moveFocus(focusedIdx + 1);
        return;
      }
      if (e.key === "ArrowUp") {
        moveFocus(focusedIdx - 1);
        return;
      }
      if (e.key === "Home") {
        moveFocus(0);
        return;
      }
      if (e.key === "End") {
        moveFocus(orderedIds.length - 1);
        return;
      }
      if (e.key === "F2") {
        if (focusedId === null) return;
        const node = flatRows.find((r) => r.node.id === focusedId)?.node ?? null;
        if (node === null) return;
        e.preventDefault();
        beginEdit(focusedId, node.name);
        return;
      }
      if (e.key === "Delete") {
        const cur = useEmitterSelectionStore.getState().ids;
        if (cur.length === 0) return;
        e.preventDefault();
        // Descending id order — deleting in ascending order would
        // invalidate higher indices mid-loop on the C++ side (the
        // mock's id-based delete is robust, but the contract has to
        // match the host).
        const sorted = [...cur].sort((a, b) => b - a);
        for (const id of sorted) {
          void bridge.request({ kind: "emitters/delete", params: { id } });
        }
        return;
      }
      // Ctrl+C / Ctrl+X / Ctrl+V on the focused tree. Cmd+* on macOS
      // routes through metaKey, same handler.
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "c" || e.key === "C")) {
        const cur = useEmitterSelectionStore.getState().ids;
        if (cur.length === 0) return;
        e.preventDefault();
        void bridge.request({ kind: "emitters/copy", params: { ids: cur } });
        return;
      }
      if (mod && (e.key === "x" || e.key === "X")) {
        const cur = useEmitterSelectionStore.getState().ids;
        if (cur.length === 0) return;
        e.preventDefault();
        void bridge.request({ kind: "emitters/cut", params: { ids: cur } });
        return;
      }
      if (mod && (e.key === "v" || e.key === "V")) {
        e.preventDefault();
        void bridge.request({ kind: "emitters/paste", params: {} });
        return;
      }
    },
    [bridge, beginEdit, flatRows, focusRowById, orderedIds, primaryId],
  );

  return (
    <div
      ref={treeContainerRef}
      data-testid="emitter-tree"
      data-selected-count={selectedIds.length}
      data-primary-id={primaryId ?? ""}
      data-dragging-id={draggingId ?? ""}
      data-editing-id={editing?.id ?? ""}
      tabIndex={0}
      onKeyDown={handleTreeKeyDown}
      className="flex h-full flex-col outline-none"
    >
      {tree === null ? (
        <div className="flex-1 min-h-0 text-text-3 text-sm">(loading…)</div>
      ) : rootChildren.length === 0 ? (
        <div className="flex-1 min-h-0 text-text-3 text-sm">(no emitters)</div>
      ) : (
        // Wrap the <ul> in a relative-positioned container so the
        // bracket gutter (absolute, right-aligned) can stack alongside.
        // B1.3.1 polish: this container is the scroll viewport now —
        // `flex-1 min-h-0 overflow-y-auto` so long emitter lists scroll
        // inside it while EmitterTreeToolbar (sibling below) stays
        // pinned at the pane's bottom.
        <div className="emitter-tree-scroll relative flex flex-1 min-h-0 overflow-y-auto">
          <ul
            role="tree"
            aria-label="Emitters"
            className="m-0 flex-1 list-none p-0"
            style={{ marginRight: GUTTER_GAP_PX }}
          >
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
              editing={editing}
              beginEdit={beginEdit}
              setEditValue={setEditValue}
              commitEdit={commitEdit}
              cancelEdit={cancelEdit}
            />
          ))}
          </ul>
          {/* Bracket gutter — multi-lane. Each non-zero linkGroup gets
              a vertical bar spanning its first → last row in the flat
              order, plus 4px-wide horizontal caps at top + bottom.
              Overlapping group ranges are spread across lanes by the
              greedy first-fit pass in computeLinkGroupBrackets; the
              gutter widens dynamically to accommodate `laneCount`
              lanes. Absolute-positioned within the relative wrapper. */}
          <div
            data-testid="link-group-bracket-gutter"
            aria-hidden
            className="pointer-events-none relative shrink-0"
            style={{ width: gutterPx }}
          >
            {brackets.map((b) => {
              const top    = b.firstRowIndex * ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2;
              const height = (b.lastRowIndex - b.firstRowIndex) * ROW_HEIGHT_PX;
              const left   = GUTTER_LEFT_PAD_PX + b.lane * LANE_WIDTH_PX;
              return (
                <div
                  key={b.groupId}
                  data-testid={`link-group-bracket-${b.groupId}`}
                  data-link-group={b.groupId}
                  data-lane={b.lane}
                  className="absolute"
                  style={{
                    top,
                    left,
                    width: 2,
                    height,
                    background: b.color,
                  }}
                >
                  {/* Top cap */}
                  <div
                    aria-hidden
                    className="absolute"
                    style={{
                      top: 0,
                      left: -2,
                      width: 4,
                      height: 2,
                      background: b.color,
                    }}
                  />
                  {/* Bottom cap */}
                  <div
                    aria-hidden
                    className="absolute"
                    style={{
                      bottom: 0,
                      left: -2,
                      width: 4,
                      height: 2,
                      background: b.color,
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
      <EmitterTreeToolbar bridge={bridge} tree={tree} primaryId={primaryId} />
    </div>
  );
}
