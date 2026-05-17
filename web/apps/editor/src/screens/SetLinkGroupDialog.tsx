// SetLinkGroupDialog — Phase 3 Screen 4 Batch B2.
//
// Modal opened from the EmitterTree context-menu "Set Link Group…"
// item. Two radio choices:
//
//   1. Create new group (default). Submits with `groupId: -1`; the
//      host picks the smallest unused positive uint32_t and assigns
//      every selected emitter to it.
//   2. Join existing group. Submits with the chosen `groupId`. The
//      <select> below the radio lists every distinct linkGroup value
//      currently present in the tree (>0, sorted ascending). The
//      radio + select are disabled when no existing groups exist.
//
// Operates on the React-side multi-selection — the bridge call's
// `ids` is the current `useEmitterSelectionStore` ids array. The
// dialog stays driven by the `tree-context` atom (extended with
// `"set-link-group"` for this batch); the right-click handler in
// EmitterTree.tsx promotes a non-multi-selected right-clicked row to
// a single-select before opening, so the selection-at-OK matches the
// row the user clicked when no Ctrl/Shift gesture preceded.

import { useEffect, useMemo, useState } from "react";
import type { Bridge, EmitterTreeDto, EmitterTreeNode } from "@particle-editor/bridge-schema";
import { Modal } from "@/components/Modal";
import { useTreeContextStore } from "@/lib/tree-context";
import { useEmitterSelectionStore } from "@/lib/emitter-selection";

type Props = {
  bridge: Bridge;
};

/** Walk the tree, gather every distinct linkGroup > 0, sort ascending. */
function collectExistingGroups(tree: EmitterTreeDto | null): number[] {
  if (tree === null) return [];
  const groups = new Set<number>();
  const visit = (n: EmitterTreeNode) => {
    if (n.linkGroup > 0) groups.add(n.linkGroup);
    n.children.forEach(visit);
  };
  visit(tree.root);
  return Array.from(groups).sort((a, b) => a - b);
}

export function SetLinkGroupDialog({ bridge }: Props) {
  const open = useTreeContextStore((s) => s.open === "set-link-group");
  const close = useTreeContextStore((s) => s.close);

  // The dialog operates on the React-side multi-selection. Snapshot it
  // at open time so a mid-dialog toggle doesn't surprise the user.
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [existingGroups, setExistingGroups] = useState<number[]>([]);
  const [chosenGroup, setChosenGroup] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    // Capture selection at open.
    const ids = [...useEmitterSelectionStore.getState().ids];
    setSelectedIds(ids);
    setMode("new");
    // Fetch the live tree to extract existing groups.
    let cancelled = false;
    bridge
      .request({ kind: "emitters/list", params: {} })
      .then((tree) => {
        if (cancelled) return;
        const groups = collectExistingGroups(tree);
        setExistingGroups(groups);
        setChosenGroup(groups.length > 0 ? groups[0]! : null);
      })
      .catch(() => {
        setExistingGroups([]);
        setChosenGroup(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, bridge]);

  const hasExisting = existingGroups.length > 0;
  // Disable OK only when we'd submit "existing" but no groups exist
  // (defensive — the radio is also disabled in that case).
  const okDisabled = useMemo(() => {
    if (selectedIds.length === 0) return true;
    if (mode === "existing" && chosenGroup === null) return true;
    return false;
  }, [mode, chosenGroup, selectedIds]);

  const handleOk = () => {
    if (okDisabled) return;
    const groupId = mode === "new" ? -1 : chosenGroup!;
    void bridge.request({
      kind: "linkGroups/set-membership",
      params: { ids: selectedIds, groupId },
    });
    close();
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) close(); }}
      title="Set Link Group"
      size="sm"
    >
      <Modal.Body>
        <div className="flex flex-col gap-3 text-sm">
          <label className="flex items-center gap-2 text-neutral-200">
            <input
              type="radio"
              name="set-link-group-mode"
              value="new"
              checked={mode === "new"}
              onChange={() => setMode("new")}
              data-testid="set-link-group-radio-new"
            />
            <span>Create new group</span>
          </label>
          <label
            className={[
              "flex items-center gap-2",
              hasExisting ? "text-neutral-200" : "text-neutral-600",
            ].join(" ")}
          >
            <input
              type="radio"
              name="set-link-group-mode"
              value="existing"
              checked={mode === "existing"}
              onChange={() => setMode("existing")}
              disabled={!hasExisting}
              data-testid="set-link-group-radio-existing"
            />
            <span>Join existing group</span>
          </label>
          <select
            value={chosenGroup ?? ""}
            onChange={(e) => setChosenGroup(Number.parseInt(e.target.value, 10))}
            disabled={!hasExisting || mode !== "existing"}
            data-testid="set-link-group-select"
            className="ml-6 w-32 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-sky-500 disabled:opacity-50"
          >
            {existingGroups.map((g) => (
              <option key={g} value={g}>
                Group {g}
              </option>
            ))}
            {!hasExisting && <option value="">(none)</option>}
          </select>
          <p className="text-[11px] leading-relaxed text-neutral-500">
            All {selectedIds.length} selected
            {selectedIds.length === 1 ? " emitter" : " emitters"} will be linked.
          </p>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Modal.CancelButton>Cancel</Modal.CancelButton>
        <Modal.OkButton onClick={handleOk} disabled={okDisabled}>
          OK
        </Modal.OkButton>
      </Modal.Footer>
    </Modal>
  );
}
