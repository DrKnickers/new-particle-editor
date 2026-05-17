// RenameEmitterDialog — Screen 4 Batch B1.
//
// Plain text-input modal that fires `emitters/rename`. Inline rename
// (F2 / double-click) is Batch C — this modal is the B1 placeholder so
// the surface is reachable from the right-click context menu without
// blocking on tree-view edit-label infrastructure.
//
// Driven by the `tree-context` Zustand atom: when `open === "rename"`
// the dialog mounts with `targetEmitterId` from the atom. Cancel /
// close routes through the atom's `close()`.

import { useEffect, useMemo, useState } from "react";
import type { Bridge } from "@particle-editor/bridge-schema";
import { Modal } from "@/components/Modal";
import { useTreeContextStore } from "@/lib/tree-context";

type Props = {
  bridge: Bridge;
  /** Optional name to pre-fill the input with. When omitted (or null),
   *  the dialog fetches the live tree on open to look up the current
   *  name; in the test environment passing it explicitly is simpler. */
  initialName?: string;
};

export function RenameEmitterDialog({ bridge, initialName }: Props) {
  const open = useTreeContextStore((s) => s.open === "rename");
  const targetId = useTreeContextStore((s) => s.targetEmitterId);
  const close = useTreeContextStore((s) => s.close);

  const [name, setName] = useState(initialName ?? "");

  // When the dialog opens, fetch the current name from the live tree
  // if one wasn't passed in. The fetch races with the open transition
  // but a brief flash of the previous name is preferable to a
  // hard-coded reset that nukes whatever the user typed.
  useEffect(() => {
    if (!open) return;
    if (initialName !== undefined) {
      setName(initialName);
      return;
    }
    let cancelled = false;
    bridge
      .request({ kind: "emitters/list", params: {} })
      .then((tree) => {
        if (cancelled) return;
        const visit = (
          n: typeof tree.root,
        ): typeof tree.root | null => {
          if (n.id === targetId) return n;
          for (const c of n.children) {
            const hit = visit(c);
            if (hit) return hit;
          }
          return null;
        };
        const node = visit(tree.root);
        if (node) setName(node.name);
      })
      .catch(() => {
        /* leave name as-is */
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, open, targetId, initialName]);

  // Disabled if the name is empty or unchanged.
  const okDisabled = useMemo(() => name.trim().length === 0, [name]);

  const handleOk = () => {
    if (targetId === null || okDisabled) return;
    void bridge.request({
      kind: "emitters/rename",
      params: { id: targetId, name: name.trim() },
    });
    close();
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      title="Rename Emitter"
      size="sm"
    >
      <Modal.Body>
        <div className="flex flex-col gap-2 text-sm">
          <label className="text-xs text-neutral-300" htmlFor="emitter-name">
            Emitter name
          </label>
          <input
            id="emitter-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleOk();
              }
            }}
            autoFocus
            data-testid="rename-emitter-input"
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 outline-none focus:border-sky-500"
          />
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
