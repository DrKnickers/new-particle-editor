# Save / Delete Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface `file/save|open|save-as` failures in a modal (no more silent data loss) and confirm destructive emitter deletes (subtree or multi-select), with a default-on Preferences toggle.

**Architecture:** Three new `lib/` modules (a file-op wrapper + error store, a shared emitter-tree store, and a delete-confirm module) plus two App-mounted `<Modal>`s. All four delete call sites and all file-op call sites route through the new helpers. `bridge` is threaded as a parameter (it is created once in `App.tsx:35` and passed as a prop — there is no module singleton). No bridge-schema change, no C++ change.

**Tech Stack:** React + TypeScript + Vite, zustand stores, Tailwind tokens, Radix-based `Modal`, Vitest. Design spec: [`docs/superpowers/specs/2026-06-09-save-delete-safety-design.md`](../specs/2026-06-09-save-delete-safety-design.md).

**Conventions for every task below:**
- Web root is `web/`. Run all commands from `web/`.
- Run one test file: `pnpm --filter @particle-editor/editor test <path>` (the `test` script is `vitest run`, so a path arg filters).
- New unit tests live in `apps/editor/src/lib/__tests__/`; component tests in `apps/editor/src/components/__tests__/`.
- Commit after each task. Branch is the session branch (already on it).

---

## Task 1: `lib/file-op.ts` — file-op wrapper + error store

**Files:**
- Create: `web/apps/editor/src/lib/file-op.ts`
- Test: `web/apps/editor/src/lib/__tests__/file-op.test.ts`

- [ ] **Step 1: Write the failing test**

`web/apps/editor/src/lib/__tests__/file-op.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { runFileOp, useFileOpErrorStore } from "@/lib/file-op";
import type { Bridge } from "@particle-editor/bridge-schema";

function fakeBridge(result: unknown): Bridge {
  return { request: async () => result as never, on: () => () => {} } as Bridge;
}

beforeEach(() => useFileOpErrorStore.setState({ message: null }));

describe("runFileOp", () => {
  it("surfaces a real IO failure", async () => {
    await runFileOp(fakeBridge({ ok: false, error: "save failed" }), { kind: "file/save", params: {} });
    expect(useFileOpErrorStore.getState().message).toContain("Couldn't save the file");
  });

  it("stays silent on user-cancel", async () => {
    await runFileOp(fakeBridge({ ok: false, error: "user-cancelled" }), { kind: "file/save", params: {} });
    expect(useFileOpErrorStore.getState().message).toBeNull();
  });

  it("stays silent on success", async () => {
    await runFileOp(fakeBridge({ ok: true, path: "x.alo" }), { kind: "file/save", params: {} });
    expect(useFileOpErrorStore.getState().message).toBeNull();
  });

  it("includes a non-generic error detail", async () => {
    await runFileOp(fakeBridge({ ok: false, error: "C:\\x.alo is read-only" }), { kind: "file/save", params: {} });
    expect(useFileOpErrorStore.getState().message).toContain("read-only");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @particle-editor/editor test src/lib/__tests__/file-op.test.ts`
Expected: FAIL — cannot resolve `@/lib/file-op`.

- [ ] **Step 3: Write minimal implementation**

`web/apps/editor/src/lib/file-op.ts`:
```ts
// file-op.ts — wraps file/save|open|save-as so non-cancel failures surface
// in a single App-level error modal instead of being silently discarded.
// `bridge` is passed in (App.tsx:35 owns the only instance; it is a prop,
// not a module singleton). Touches only the error store, so it is callable
// from non-component code (use-app-accelerators.ts).
import { create } from "zustand";
import type { Bridge, Request, ResponseFor } from "@particle-editor/bridge-schema";

type FileOpErrorStore = {
  message: string | null;
  show: (message: string) => void;
  clear: () => void;
};
export const useFileOpErrorStore = create<FileOpErrorStore>((set) => ({
  message: null,
  show: (message) => set({ message }),
  clear: () => set({ message: null }),
}));

export type FileOpReq = Extract<
  Request,
  { kind: "file/open" | "file/save" | "file/save-as" }
>;

const PREFIX: Record<FileOpReq["kind"], string> = {
  "file/open": "Couldn't open the file.",
  "file/save": "Couldn't save the file.",
  "file/save-as": "Couldn't save the file.",
};

// Generic host errors ("save failed" / "load failed") add no information
// beyond the prefix; anything else (a real path/permission message) is shown.
export function messageFor(kind: FileOpReq["kind"], error: string): string {
  const generic = error === "save failed" || error === "load failed" || error === "";
  return generic ? PREFIX[kind] : `${PREFIX[kind]}\n\n${error}`;
}

export async function runFileOp(
  bridge: Bridge,
  req: FileOpReq,
): Promise<ResponseFor<FileOpReq>> {
  const r = await bridge.request(req);
  if (!r.ok && r.error !== "user-cancelled") {
    useFileOpErrorStore.getState().show(messageFor(req.kind, r.error));
  }
  return r;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @particle-editor/editor test src/lib/__tests__/file-op.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**
```bash
git add web/apps/editor/src/lib/file-op.ts web/apps/editor/src/lib/__tests__/file-op.test.ts
git commit -m "feat(file-op): surface file-op failures via error store + runFileOp"
```

---

## Task 2: `lib/emitter-tree.ts` — shared emitter-tree store

**Files:**
- Create: `web/apps/editor/src/lib/emitter-tree.ts`
- Test: `web/apps/editor/src/lib/__tests__/emitter-tree.test.ts`

- [ ] **Step 1: Write the failing test**

`web/apps/editor/src/lib/__tests__/emitter-tree.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useEmitterTreeStore } from "@/lib/emitter-tree";
import type { EmitterTreeDto } from "@particle-editor/bridge-schema";

beforeEach(() => useEmitterTreeStore.setState({ tree: null }));

describe("useEmitterTreeStore", () => {
  it("holds and replaces the tree", () => {
    expect(useEmitterTreeStore.getState().tree).toBeNull();
    const tree = { root: { id: -1, name: "root", role: "root", visible: true, children: [] } } as unknown as EmitterTreeDto;
    useEmitterTreeStore.getState().setTree(tree);
    expect(useEmitterTreeStore.getState().tree).toBe(tree);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @particle-editor/editor test src/lib/__tests__/emitter-tree.test.ts`
Expected: FAIL — cannot resolve `@/lib/emitter-tree`.

- [ ] **Step 3: Write minimal implementation**

`web/apps/editor/src/lib/emitter-tree.ts`:
```ts
// emitter-tree.ts — the latest EmitterTreeDto, lifted out of EmitterTree's
// local state so MenuBar and the delete helper can read it (non-reactively,
// via getState()) to compute subtree impact for the delete confirmation.
// EmitterTree reads/writes it as its tree state; nothing else's render
// behaviour changes.
import { create } from "zustand";
import type { EmitterTreeDto } from "@particle-editor/bridge-schema";

type EmitterTreeStore = {
  tree: EmitterTreeDto | null;
  setTree: (tree: EmitterTreeDto | null) => void;
};
export const useEmitterTreeStore = create<EmitterTreeStore>((set) => ({
  tree: null,
  setTree: (tree) => set({ tree }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @particle-editor/editor test src/lib/__tests__/emitter-tree.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add web/apps/editor/src/lib/emitter-tree.ts web/apps/editor/src/lib/__tests__/emitter-tree.test.ts
git commit -m "feat(emitter-tree): shared emitter-tree store for delete-impact reads"
```

---

## Task 3: `lib/delete-emitters.ts` — impact, setting, confirm store, delete helpers

**Files:**
- Create: `web/apps/editor/src/lib/delete-emitters.ts`
- Test: `web/apps/editor/src/lib/__tests__/delete-emitters.test.ts`

- [ ] **Step 1: Write the failing test**

`web/apps/editor/src/lib/__tests__/delete-emitters.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  computeDeleteImpact, performDelete, requestDeleteEmitters,
  readConfirmDelete, writeConfirmDelete, useDeleteConfirmStore,
} from "@/lib/delete-emitters";
import { useEmitterTreeStore } from "@/lib/emitter-tree";
import type { Bridge, EmitterTreeDto, EmitterTreeNode } from "@particle-editor/bridge-schema";

// helper to build a node; role is irrelevant to impact logic.
const node = (id: number, name: string, children: EmitterTreeNode[] = []): EmitterTreeNode =>
  ({ id, name, role: "root", visible: true, children } as unknown as EmitterTreeNode);

// tree: root -> a(0) -> [a1(1), a2(2)] ; b(3)
const tree = { root: node(-1, "root", [node(0, "a", [node(1, "a1"), node(2, "a2")]), node(3, "b")]) } as unknown as EmitterTreeDto;

function recordingBridge() {
  const calls: number[] = [];
  const bridge = {
    request: (req: { kind: string; params: { id?: number } }) => {
      if (req.kind === "emitters/delete" && typeof req.params.id === "number") calls.push(req.params.id);
      return Promise.resolve({});
    },
    on: () => () => {},
  } as unknown as Bridge;
  return { bridge, calls };
}

beforeEach(() => {
  useEmitterTreeStore.setState({ tree });
  useDeleteConfirmStore.setState({ pending: null });
  localStorage.clear();
});

describe("computeDeleteImpact", () => {
  it("single childless leaf is non-destructive", () => {
    expect(computeDeleteImpact([3], tree)).toMatchObject({ affectedCount: 1, isDestructive: false, primaryName: "b" });
  });
  it("parent with children is destructive and counts the subtree", () => {
    expect(computeDeleteImpact([0], tree)).toMatchObject({ affectedCount: 3, isDestructive: true, primaryName: "a" });
  });
  it("multi-select of leaves is destructive", () => {
    expect(computeDeleteImpact([3, 1], tree).isDestructive).toBe(true);
  });
  it("dedups parent + its own child both selected", () => {
    expect(computeDeleteImpact([0, 1], tree).affectedCount).toBe(3); // a,a1,a2 — not 4
  });
  it("empty selection", () => {
    expect(computeDeleteImpact([], tree)).toMatchObject({ affectedCount: 0, isDestructive: false });
  });
});

describe("confirm-delete setting", () => {
  it("defaults to true when unset", () => { expect(readConfirmDelete()).toBe(true); });
  it("round-trips false", () => { writeConfirmDelete(false); expect(readConfirmDelete()).toBe(false); });
  it("treats garbage as default true", () => { localStorage.setItem("alo:confirm-delete", "wat"); expect(readConfirmDelete()).toBe(true); });
});

describe("performDelete", () => {
  it("emits emitters/delete in descending id order", () => {
    const { bridge, calls } = recordingBridge();
    performDelete(bridge, [1, 3, 0]);
    expect(calls).toEqual([3, 1, 0]);
  });
});

describe("requestDeleteEmitters", () => {
  it("deletes a leaf immediately, no confirm", () => {
    const { bridge, calls } = recordingBridge();
    requestDeleteEmitters(bridge, [3]);
    expect(calls).toEqual([3]);
    expect(useDeleteConfirmStore.getState().pending).toBeNull();
  });
  it("opens the confirm for a destructive delete and deletes nothing yet", () => {
    const { bridge, calls } = recordingBridge();
    requestDeleteEmitters(bridge, [0]);
    expect(calls).toEqual([]);
    expect(useDeleteConfirmStore.getState().pending?.ids).toEqual([0]);
  });
  it("with the toggle off, deletes immediately even when destructive", () => {
    writeConfirmDelete(false);
    const { bridge, calls } = recordingBridge();
    requestDeleteEmitters(bridge, [0]);
    expect(calls).toEqual([0]);
    expect(useDeleteConfirmStore.getState().pending).toBeNull();
  });
  it("ignores an empty selection", () => {
    const { bridge, calls } = recordingBridge();
    requestDeleteEmitters(bridge, []);
    expect(calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @particle-editor/editor test src/lib/__tests__/delete-emitters.test.ts`
Expected: FAIL — cannot resolve `@/lib/delete-emitters`.

- [ ] **Step 3: Write minimal implementation**

`web/apps/editor/src/lib/delete-emitters.ts`:
```ts
// delete-emitters.ts — the proportional delete-confirm logic.
//
// Delete confirms only when destructive-and-non-obvious (the emitter has
// children → the host recursively deletes the subtree, or it is a
// multi-selection). A single childless leaf deletes immediately (it is
// trivially undoable: emitters/delete captures undo pre-mutation host-side).
// A default-on localStorage toggle ("alo:confirm-delete") governs the confirm.
//
// `bridge` is threaded in — it is a prop, not a module singleton. The confirm
// STORE never calls bridge; <DeleteConfirmModal> (mounted in App, where bridge
// lives) runs performDelete(bridge, ids) on confirm.
import { create } from "zustand";
import type { Bridge, EmitterTreeDto, EmitterTreeNode } from "@particle-editor/bridge-schema";
import { useEmitterTreeStore } from "@/lib/emitter-tree";

export type DeleteImpact = {
  affectedCount: number; // deduped union of every selected id's subtree
  primaryName: string;   // name of the first selected emitter ("" if unknown)
  isDestructive: boolean;
};

export function computeDeleteImpact(
  ids: number[],
  tree: EmitterTreeDto | null,
): DeleteImpact {
  if (ids.length === 0) return { affectedCount: 0, primaryName: "", isDestructive: false };

  const byId = new Map<number, EmitterTreeNode>();
  const index = (n: EmitterTreeNode) => { byId.set(n.id, n); n.children.forEach(index); };
  if (tree) tree.root.children.forEach(index);

  const affected = new Set<number>();
  const addSubtree = (n: EmitterTreeNode) => {
    if (affected.has(n.id)) return;
    affected.add(n.id);
    n.children.forEach(addSubtree);
  };

  let anyHasChildren = false;
  for (const id of ids) {
    const n = byId.get(id);
    if (!n) { affected.add(id); continue; } // unknown id still counts as one
    if (n.children.length > 0) anyHasChildren = true;
    addSubtree(n);
  }

  const primary = byId.get(ids[0]);
  return {
    affectedCount: affected.size,
    primaryName: primary ? primary.name : "",
    isDestructive: ids.length > 1 || anyHasChildren,
  };
}

const CONFIRM_DELETE_KEY = "alo:confirm-delete";
export function readConfirmDelete(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(CONFIRM_DELETE_KEY) !== "false"; // default true
}
export function writeConfirmDelete(value: boolean): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(CONFIRM_DELETE_KEY, value ? "true" : "false");
}

// The single descending-order delete loop (collapses the prior two inline
// copies in EmitterTree + MenuBar). `id` is a position index host-side, which
// shifts as siblings vanish — descending order keeps queued ids valid for the
// common case. (The parent+descendant-both-selected stale-index footgun is a
// pre-existing, separately-tracked bug; behaviour is preserved as-is here.)
export function performDelete(bridge: Bridge, ids: number[]): void {
  for (const id of [...ids].sort((a, b) => b - a)) {
    void bridge.request({ kind: "emitters/delete", params: { id } });
  }
}

type DeleteConfirmStore = {
  pending: { ids: number[]; impact: DeleteImpact } | null;
  open: (ids: number[], impact: DeleteImpact) => void;
  clear: () => void;
};
export const useDeleteConfirmStore = create<DeleteConfirmStore>((set) => ({
  pending: null,
  open: (ids, impact) => set({ pending: { ids, impact } }),
  clear: () => set({ pending: null }),
}));

// The single entry point for all four delete call sites.
export function requestDeleteEmitters(bridge: Bridge, ids: number[]): void {
  if (ids.length === 0) return;
  const impact = computeDeleteImpact(ids, useEmitterTreeStore.getState().tree);
  if (!readConfirmDelete() || !impact.isDestructive) {
    performDelete(bridge, ids);
    return;
  }
  useDeleteConfirmStore.getState().open(ids, impact);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @particle-editor/editor test src/lib/__tests__/delete-emitters.test.ts`
Expected: PASS (all groups).

- [ ] **Step 5: Commit**
```bash
git add web/apps/editor/src/lib/delete-emitters.ts web/apps/editor/src/lib/__tests__/delete-emitters.test.ts
git commit -m "feat(delete): proportional delete-confirm impact + helpers + setting"
```

---

## Task 4: `<FileOpErrorModal>` + mount in App

**Files:**
- Create: `web/apps/editor/src/components/FileOpErrorModal.tsx`
- Modify: `web/apps/editor/src/App.tsx` (mount near the other dialogs, ~line 202)
- Test: `web/apps/editor/src/components/__tests__/FileOpErrorModal.test.tsx`

- [ ] **Step 1: Write the failing test**

`web/apps/editor/src/components/__tests__/FileOpErrorModal.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileOpErrorModal } from "@/components/FileOpErrorModal";
import { useFileOpErrorStore } from "@/lib/file-op";

beforeEach(() => useFileOpErrorStore.setState({ message: null }));

describe("FileOpErrorModal", () => {
  it("is hidden when there is no message", () => {
    render(<FileOpErrorModal />);
    expect(screen.queryByText(/couldn't/i)).toBeNull();
  });

  it("shows the message and clears on OK", async () => {
    useFileOpErrorStore.setState({ message: "Couldn't save the file." });
    render(<FileOpErrorModal />);
    expect(screen.getByText("Couldn't save the file.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(useFileOpErrorStore.getState().message).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @particle-editor/editor test src/components/__tests__/FileOpErrorModal.test.tsx`
Expected: FAIL — cannot resolve `@/components/FileOpErrorModal`.

- [ ] **Step 3: Write minimal implementation**

`web/apps/editor/src/components/FileOpErrorModal.tsx`:
```tsx
// FileOpErrorModal — single App-level modal that shows a file-op failure
// message from useFileOpErrorStore. Mounted once in App.tsx.
import { Modal } from "@/components/Modal";
import { useFileOpErrorStore } from "@/lib/file-op";

export function FileOpErrorModal() {
  const message = useFileOpErrorStore((s) => s.message);
  const clear = useFileOpErrorStore((s) => s.clear);
  return (
    <Modal
      open={message !== null}
      onOpenChange={(o) => { if (!o) clear(); }}
      title="Couldn't complete that"
      size="sm"
    >
      <Modal.Body>
        <p className="whitespace-pre-line text-sm text-text-2">{message}</p>
      </Modal.Body>
      <Modal.Footer>
        <Modal.OkButton onClick={clear}>OK</Modal.OkButton>
      </Modal.Footer>
    </Modal>
  );
}
```

Then mount it in `web/apps/editor/src/App.tsx`. Add the import near the other dialog imports (after line 18):
```tsx
import { FileOpErrorModal } from "@/components/FileOpErrorModal";
```
And add the element next to `<AutosaveRecoveryDialog bridge={bridge} />` (~line 202):
```tsx
      <FileOpErrorModal />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @particle-editor/editor test src/components/__tests__/FileOpErrorModal.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**
```bash
git add web/apps/editor/src/components/FileOpErrorModal.tsx web/apps/editor/src/components/__tests__/FileOpErrorModal.test.tsx web/apps/editor/src/App.tsx
git commit -m "feat(file-op): FileOpErrorModal mounted at App level"
```

---

## Task 5: `<DeleteConfirmModal>` + mount in App

**Files:**
- Create: `web/apps/editor/src/components/DeleteConfirmModal.tsx`
- Modify: `web/apps/editor/src/App.tsx` (mount with `bridge` prop)
- Test: `web/apps/editor/src/components/__tests__/DeleteConfirmModal.test.tsx`

- [ ] **Step 1: Write the failing test**

`web/apps/editor/src/components/__tests__/DeleteConfirmModal.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteConfirmModal } from "@/components/DeleteConfirmModal";
import { useDeleteConfirmStore } from "@/lib/delete-emitters";
import type { Bridge } from "@particle-editor/bridge-schema";

function recordingBridge() {
  const calls: number[] = [];
  const bridge = {
    request: (req: { kind: string; params: { id?: number } }) => {
      if (req.kind === "emitters/delete" && typeof req.params.id === "number") calls.push(req.params.id);
      return Promise.resolve({});
    },
    on: () => () => {},
  } as unknown as Bridge;
  return { bridge, calls };
}

beforeEach(() => useDeleteConfirmStore.setState({ pending: null }));

describe("DeleteConfirmModal", () => {
  it("is hidden with no pending delete", () => {
    const { bridge } = recordingBridge();
    render(<DeleteConfirmModal bridge={bridge} />);
    expect(screen.queryByText(/delete/i)).toBeNull();
  });

  it("shows subtree copy and deletes on confirm", async () => {
    const { bridge, calls } = recordingBridge();
    useDeleteConfirmStore.setState({ pending: { ids: [0], impact: { affectedCount: 3, primaryName: "a", isDestructive: true } } });
    render(<DeleteConfirmModal bridge={bridge} />);
    expect(screen.getByText('Delete "a" and its 2 child emitters?')).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(calls).toEqual([0]);
    expect(useDeleteConfirmStore.getState().pending).toBeNull();
  });

  it("shows multi-select copy and cancels without deleting", async () => {
    const { bridge, calls } = recordingBridge();
    useDeleteConfirmStore.setState({ pending: { ids: [1, 2, 3], impact: { affectedCount: 3, primaryName: "a1", isDestructive: true } } });
    render(<DeleteConfirmModal bridge={bridge} />);
    expect(screen.getByText("Delete 3 emitters?")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(calls).toEqual([]);
    expect(useDeleteConfirmStore.getState().pending).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @particle-editor/editor test src/components/__tests__/DeleteConfirmModal.test.tsx`
Expected: FAIL — cannot resolve `@/components/DeleteConfirmModal`.

- [ ] **Step 3: Write minimal implementation**

`web/apps/editor/src/components/DeleteConfirmModal.tsx`:
```tsx
// DeleteConfirmModal — confirmation for destructive emitter deletes. Driven by
// useDeleteConfirmStore; mounted once in App.tsx with the bridge prop (the
// store holds only data, this component runs the actual delete on confirm).
import type { Bridge } from "@particle-editor/bridge-schema";
import { Modal } from "@/components/Modal";
import { useDeleteConfirmStore, performDelete, type DeleteImpact } from "@/lib/delete-emitters";

function bodyText(ids: number[], impact: DeleteImpact): string {
  const n = ids.length;
  const total = impact.affectedCount;
  if (n === 1) {
    if (total <= 1) return `Delete "${impact.primaryName}"?`; // (defensive; non-destructive never reaches here)
    const kids = total - 1;
    return `Delete "${impact.primaryName}" and its ${kids} child emitter${kids === 1 ? "" : "s"}?`;
  }
  if (total === n) return `Delete ${n} emitters?`;
  return `Delete ${n} selected emitters and their children (${total} total)?`;
}

export function DeleteConfirmModal({ bridge }: { bridge: Bridge }) {
  const pending = useDeleteConfirmStore((s) => s.pending);
  const clear = useDeleteConfirmStore((s) => s.clear);

  const onDelete = () => {
    if (pending) performDelete(bridge, pending.ids);
    clear();
  };

  return (
    <Modal
      open={pending !== null}
      onOpenChange={(o) => { if (!o) clear(); }}
      title="Delete emitters?"
      size="sm"
    >
      <Modal.Body>
        <p className="text-sm text-text-2">{pending ? bodyText(pending.ids, pending.impact) : ""}</p>
      </Modal.Body>
      <Modal.Footer>
        <button
          type="button"
          autoFocus
          onClick={clear}
          className="rounded border border-border-2 bg-panel-2 px-3 py-1 text-xs text-text hover:bg-panel-3 outline-none focus:border-accent"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded bg-danger px-3 py-1 text-xs font-medium text-white hover:bg-danger outline-none focus:ring-2 focus:ring-danger"
        >
          Delete
        </button>
      </Modal.Footer>
    </Modal>
  );
}
```

Then mount it in `web/apps/editor/src/App.tsx`. Add the import (after the FileOpErrorModal import):
```tsx
import { DeleteConfirmModal } from "@/components/DeleteConfirmModal";
```
And the element beside `<FileOpErrorModal />`:
```tsx
      <DeleteConfirmModal bridge={bridge} />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @particle-editor/editor test src/components/__tests__/DeleteConfirmModal.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add web/apps/editor/src/components/DeleteConfirmModal.tsx web/apps/editor/src/components/__tests__/DeleteConfirmModal.test.tsx web/apps/editor/src/App.tsx
git commit -m "feat(delete): DeleteConfirmModal mounted at App level"
```

---

## Task 6: Wire `EmitterTree.tsx` — tree-store swap + 3 delete sites

**Files:**
- Modify: `web/apps/editor/src/screens/EmitterTree.tsx` (`:1111` tree state, `:411`, `:977`, `:1673-1685`)
- Test: existing `EmitterTree` suite stays green; add one integration assertion.

- [ ] **Step 1: Make the edits**

a) **Tree-store swap.** Replace line 1111:
```tsx
  const [tree, setTree] = useState<EmitterTreeDto | null>(null);
```
with:
```tsx
  const tree = useEmitterTreeStore((s) => s.tree);
  const setTree = useEmitterTreeStore((s) => s.setTree);
```
Add the import near the other `@/lib` imports at the top of the file:
```tsx
import { useEmitterTreeStore } from "@/lib/emitter-tree";
import { requestDeleteEmitters } from "@/lib/delete-emitters";
```
(The `setTree(t)` call at `:1170` is unchanged. Leave the `useState` import — it is used elsewhere in the file. Leave the `EmitterTreeDto` type import — still used in annotations.)

b) **Context-menu delete** (`:411-414` `handleDelete`). Replace:
```tsx
  const handleDelete = () => {
    resolveTargetIds();
    void bridge.request({ kind: "emitters/delete", params: { id: node.id } });
  };
```
with:
```tsx
  const handleDelete = () => {
    resolveTargetIds();
    requestDeleteEmitters(bridge, [node.id]);
  };
```

c) **`del` (`:975-978`).** Replace:
```tsx
  const del = () => {
    if (primaryId === null) return;
    void bridge.request({ kind: "emitters/delete", params: { id: primaryId } });
  };
```
with:
```tsx
  const del = () => {
    if (primaryId === null) return;
    requestDeleteEmitters(bridge, [primaryId]);
  };
```

d) **`Delete` key (`:1673-1685`).** Replace the body:
```tsx
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
```
with:
```tsx
      if (e.key === "Delete") {
        const cur = useEmitterSelectionStore.getState().ids;
        if (cur.length === 0) return;
        e.preventDefault();
        // Descending-order delete + the destructive-confirm gate both live in
        // requestDeleteEmitters → performDelete now.
        requestDeleteEmitters(bridge, [...cur]);
        return;
      }
```

- [ ] **Step 2: Add an integration assertion**

Add to `web/apps/editor/src/screens/__tests__/EmitterTree.test.tsx` (or create it if absent) a test that a destructive `Delete` keypress opens the confirm rather than deleting. Minimal self-contained version — if the file already renders `<EmitterTree>` with a mock bridge, reuse that harness; otherwise add:
```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { useEmitterTreeStore } from "@/lib/emitter-tree";
import { useDeleteConfirmStore, requestDeleteEmitters } from "@/lib/delete-emitters";
import type { Bridge, EmitterTreeDto, EmitterTreeNode } from "@particle-editor/bridge-schema";

const node = (id: number, name: string, children: EmitterTreeNode[] = []) =>
  ({ id, name, role: "root", visible: true, children } as unknown as EmitterTreeNode);

describe("EmitterTree delete gating (helper-level)", () => {
  beforeEach(() => {
    useEmitterTreeStore.setState({ tree: { root: node(-1, "root", [node(0, "a", [node(1, "a1")])]) } as unknown as EmitterTreeDto });
    useDeleteConfirmStore.setState({ pending: null });
    localStorage.clear();
  });
  it("deleting a parent opens the confirm", () => {
    const calls: number[] = [];
    const bridge = { request: (r: { kind: string; params: { id?: number } }) => { if (r.kind === "emitters/delete") calls.push(r.params.id!); return Promise.resolve({}); }, on: () => () => {} } as unknown as Bridge;
    requestDeleteEmitters(bridge, [0]);
    expect(calls).toEqual([]);
    expect(useDeleteConfirmStore.getState().pending?.ids).toEqual([0]);
  });
});
```

- [ ] **Step 3: Run the EmitterTree + lib suites**

Run: `pnpm --filter @particle-editor/editor test src/screens/__tests__/ src/lib/__tests__/`
Expected: PASS (existing EmitterTree tests green; new assertion green). If an existing test asserted a raw `emitters/delete` on a destructive delete, update it to expect the confirm store (that is the new contract).

- [ ] **Step 4: Commit**
```bash
git add web/apps/editor/src/screens/EmitterTree.tsx web/apps/editor/src/screens/__tests__/
git commit -m "feat(delete): route EmitterTree deletes through the confirm gate; lift tree to store"
```

---

## Task 7: Wire `MenuBar.tsx` — file ops + delete selection

**Files:**
- Modify: `web/apps/editor/src/components/MenuBar.tsx` (`:273`, `:278`, `:282`, `:287`, `:353-361`)

- [ ] **Step 1: Make the edits**

Add imports near the top `@/lib` imports:
```tsx
import { runFileOp } from "@/lib/file-op";
import { requestDeleteEmitters } from "@/lib/delete-emitters";
```

a) **File ops.** Replace the four file requests with `runFileOp(bridge, …)`:
- `:273` `await bridge.request({ kind: "file/open", params: {} });` → `await runFileOp(bridge, { kind: "file/open", params: {} });`
- `:278` `void bridge.request({ kind: "file/save", params: {} });` → `void runFileOp(bridge, { kind: "file/save", params: {} });`
- `:282` `void bridge.request({ kind: "file/save-as", params: {} });` → `void runFileOp(bridge, { kind: "file/save-as", params: {} });`
- `:287` `await bridge.request({ kind: "file/open", params: { path } });` → `await runFileOp(bridge, { kind: "file/open", params: { path } });`

(Leave `file/new` at `:267` on `bridge.request` — it has no failure envelope.)

b) **Delete selection** (`:353-361`). Replace:
```tsx
  const handleDeleteSelection = () => {
    const ids = getEmitterSelectionSnapshot().ids;
    if (ids.length === 0) return;
    // Descending id order — matches the tree's batch delete + the host
    // contract (deleting ascending would invalidate higher ids mid-loop).
    for (const id of [...ids].sort((a, b) => b - a)) {
      void bridge.request({ kind: "emitters/delete", params: { id } });
    }
  };
```
with:
```tsx
  const handleDeleteSelection = () => {
    const ids = getEmitterSelectionSnapshot().ids;
    if (ids.length === 0) return;
    requestDeleteEmitters(bridge, ids);
  };
```

- [ ] **Step 2: Run the suite**

Run: `pnpm --filter @particle-editor/editor test src/components/__tests__/`
Expected: PASS. (If a MenuBar test asserted raw delete requests on a destructive selection, update it to the confirm-store contract.)

- [ ] **Step 3: Commit**
```bash
git add web/apps/editor/src/components/MenuBar.tsx web/apps/editor/src/components/__tests__/
git commit -m "feat(safety): MenuBar file ops via runFileOp; delete via confirm gate"
```

---

## Task 8: Wire `Toolbar.tsx` + `use-app-accelerators.ts` — file ops

**Files:**
- Modify: `web/apps/editor/src/components/Toolbar.tsx` (`:84`, `:95`, `:104`)
- Modify: `web/apps/editor/src/lib/use-app-accelerators.ts` (`:89`, `:93`)

- [ ] **Step 1: Make the edits**

In `Toolbar.tsx`, add the import:
```tsx
import { runFileOp } from "@/lib/file-op";
```
- `:84` (inside `promptSaveChanges`) `await bridge.request({ kind: "file/open", params: {} });` → `await runFileOp(bridge, { kind: "file/open", params: {} });`
- `:95` `onClick={() => { void bridge.request({ kind: "file/save", params: {} }); }}` → `onClick={() => { void runFileOp(bridge, { kind: "file/save", params: {} }); }}`
- `:104` `onClick={() => { void bridge.request({ kind: "file/save-as", params: {} }); }}` → `onClick={() => { void runFileOp(bridge, { kind: "file/save-as", params: {} }); }}`

In `use-app-accelerators.ts`, add the import:
```tsx
import { runFileOp } from "@/lib/file-op";
```
- `:89` (Ctrl+O, inside `promptSaveChanges`) `await bridge.request({ kind: "file/open", params: {} });` → `await runFileOp(bridge, { kind: "file/open", params: {} });`
- `:93` (Ctrl+S) `void bridge.request({ kind: "file/save", params: {} });` → `void runFileOp(bridge, { kind: "file/save", params: {} });`

(Leave `Ctrl+N` `file/new` at `:84` on `bridge.request`.)

- [ ] **Step 2: Type-check + run the suite**

Run: `pnpm --filter @particle-editor/editor test`
Expected: PASS (full suite — was 537, now higher with the new tests; no regressions).

- [ ] **Step 3: Commit**
```bash
git add web/apps/editor/src/components/Toolbar.tsx web/apps/editor/src/lib/use-app-accelerators.ts
git commit -m "feat(file-op): Toolbar + accelerator file ops via runFileOp"
```

---

## Task 9: `PreferencesDialog.tsx` — confirm-before-delete toggle

**Files:**
- Modify: `web/apps/editor/src/screens/PreferencesDialog.tsx`
- Test: `web/apps/editor/src/screens/__tests__/PreferencesDialog.test.tsx` (extend)

- [ ] **Step 1: Write the failing test**

Add to `web/apps/editor/src/screens/__tests__/PreferencesDialog.test.tsx`:
```tsx
import { readConfirmDelete } from "@/lib/delete-emitters";
// ... within the existing describe (or a new one):
it("toggles and persists confirm-before-delete", async () => {
  localStorage.removeItem("alo:confirm-delete");
  render(<PreferencesDialog open onOpenChange={() => {}} />);
  const box = screen.getByLabelText("Confirm before deleting emitters") as HTMLInputElement;
  expect(box.checked).toBe(true);           // default on
  await userEvent.click(box);
  expect(box.checked).toBe(false);
  expect(readConfirmDelete()).toBe(false);  // persisted
});
```
(If the test file lacks `userEvent`/`render`/`screen` imports, add them: `import { render, screen } from "@testing-library/react"; import userEvent from "@testing-library/user-event";`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @particle-editor/editor test src/screens/__tests__/PreferencesDialog.test.tsx`
Expected: FAIL — no element labelled "Confirm before deleting emitters".

- [ ] **Step 3: Implement the toggle row**

In `PreferencesDialog.tsx`, add imports:
```tsx
import { readConfirmDelete, writeConfirmDelete } from "@/lib/delete-emitters";
```
Add state inside the component (next to the `mode` state):
```tsx
  const [confirmDelete, setConfirmDelete] = useState<boolean>(() => readConfirmDelete());
```
Add a second row inside `<Modal.Body>`'s `<div className="flex flex-col gap-3 text-sm">`, after the Theme block (after the closing `</div>` of the `role="radiogroup"` row):
```tsx
          <div className="flex items-center justify-between pt-1">
            <label htmlFor="pref-confirm-delete" className="text-text-2">
              Confirm before deleting emitters
            </label>
            <input
              id="pref-confirm-delete"
              type="checkbox"
              checked={confirmDelete}
              onChange={(e) => { setConfirmDelete(e.target.checked); writeConfirmDelete(e.target.checked); }}
              className="accent-[var(--accent)]"
            />
          </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @particle-editor/editor test src/screens/__tests__/PreferencesDialog.test.tsx`
Expected: PASS (existing 2 + new).

- [ ] **Step 5: Commit**
```bash
git add web/apps/editor/src/screens/PreferencesDialog.tsx web/apps/editor/src/screens/__tests__/PreferencesDialog.test.tsx
git commit -m "feat(settings): Confirm-before-deleting-emitters toggle in Preferences"
```

---

## Task 10: Full build, native harness, docs, final verification

**Files:**
- Modify: `CHANGELOG.md` (new top entry), `ROADMAP.md` (settings shortlist item if tracked), `tasks/todo.md` (review section)

- [ ] **Step 1: Full web build (tsc -b + vite)**

Run: `pnpm --filter @particle-editor/editor build`
Expected: tsc clean, dist produced (the >500 kB chunk warning is pre-existing/benign).

- [ ] **Step 2: Full web test suite**

Run: `pnpm --filter @particle-editor/editor test`
Expected: PASS — 537 prior + the new tests (file-op 4, emitter-tree 1, delete-emitters ~13, FileOpErrorModal 2, DeleteConfirmModal 3, EmitterTree +1, Preferences +1).

- [ ] **Step 3: Native a11y harness**

Run (after the build in Step 1, per L-068): `pnpm --filter @particle-editor/editor test:native`
Expected: **174/0**. If the Preferences golden shifted (new row), regenerate deliberately: `pnpm --filter @particle-editor/editor a11y:update`, then `git diff` the golden and eyeball that only the new row changed.

- [ ] **Step 4: Host Debug x64 build (regression guard — no C++ changed)**

Build the host solution in MSBuild **VS18**, Debug x64. Expected: clean (LNK4098 is the known-benign warning).

- [ ] **Step 5: CHANGELOG + docs**

Add a top `## Changelog` entry in `CHANGELOG.md` per the repo conventions (date line with TODO hash to backfill on merge): what ships (failure modals + delete confirm + Preferences toggle), how-we-tackled-it (the three lib modules + two App modals + bridge-as-param + tree-store lift), and issues encountered (bridge is not a singleton → helpers take it as a param; delete is undoable → proportional-confirm policy). Append a review section to `tasks/todo.md`.

- [ ] **Step 6: Final commit**
```bash
git add CHANGELOG.md tasks/todo.md web/apps/editor/src/screens/__tests__/
git commit -m "docs: changelog + review for save/delete safety"
```

---

## Self-review notes (already applied)

- **Spec coverage:** file-op feedback (Tasks 1,4,7,8), delete confirm (Tasks 3,5,6,7), tree-store lift (Tasks 2,6), Preferences toggle (Task 9), tests + build + harness (all tasks + 10). The deferred items (autosave-recover, toast system, multi-select stale-index) are out of scope per the spec — no tasks, by design.
- **Names are consistent across tasks:** `useFileOpErrorStore`/`runFileOp`/`FileOpReq`/`messageFor`; `useEmitterTreeStore`; `computeDeleteImpact`/`DeleteImpact`/`performDelete`/`requestDeleteEmitters`/`useDeleteConfirmStore`/`read|writeConfirmDelete`; `<FileOpErrorModal>`; `<DeleteConfirmModal bridge>`.
- **`bridge` is threaded everywhere** (no singleton); the confirm store never touches bridge.
- **Open risk to watch during execution (Task 6):** if an existing EmitterTree/MenuBar test asserts a raw `emitters/delete` on what is now a destructive (confirm-gated) delete, update that test to the new confirm-store contract — that is an intended behaviour change, not a regression.
