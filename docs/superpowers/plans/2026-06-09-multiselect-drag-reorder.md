# Multi-select Drag-Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the emitter-tree click-drag reorder act on the whole multi-selection — drag any selected root and the entire selection moves as one contiguous block, the highlight follows, with a line + band + cursor-chip preview.

**Architecture:** A new atomic host op `emitters/reorder-many { ids, rootIndex } → { newIds }` (mirrored by the dev mock) does the batch move; the web pointer-drag controller gains a multi-drag branch that resolves a root-gap target and dispatches it, then re-selects the returned `newIds`. Reorder-only, root-only; single-drag (incl. reparent) and the smooth glide animation are untouched/deferred.

**Tech Stack:** TypeScript + React (web, `web/apps/editor`), a shared bridge schema (`web/packages/bridge-schema`), a dev mock bridge (`web/apps/editor/src/bridge`), Vitest; C++ host (`src/`, MSBuild VS18, x64). Spec: [`docs/superpowers/specs/2026-06-09-multiselect-drag-reorder-design.md`](../specs/2026-06-09-multiselect-drag-reorder-design.md).

**Conventions for the implementer**
- Run web commands from `web/`. Test: `pnpm --filter @particle-editor/editor test`. Typecheck/build: `pnpm --filter @particle-editor/editor build` (`tsc -b && vite build` — use this, NOT `tsc --noEmit`).
- The **mock is the suite's source of truth**; the C++ host must match the mock's behaviour exactly (Task 8 references the Task 2 cases as its contract).
- Run the **full** web suite after web changes (reorder touches shared selection/tree state — a scoped run hides regressions).
- Native harness: from `web/`, `pnpm build` first, then `pnpm --filter @particle-editor/editor test:native` → expect **174/0**.
- Commit after every green step.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `web/packages/bridge-schema/src/index.ts` | modify | Add `emitters/reorder-many` message + `ResponseFor` (`ok`-union with `newIds`). |
| `web/apps/editor/src/bridge/mock-state.ts` | modify | New pure `reorderManyRoots(tree, ids, rootIndex)` — the reference algorithm. |
| `web/apps/editor/src/lib/__tests__/reorder-many-roots.test.ts` | create | Vitest for `reorderManyRoots` (the algorithm + edge cases). |
| `web/apps/editor/src/bridge/mock.ts` | modify | `emitters/reorder-many` case → calls `reorderManyRoots`, returns `{ ok, newIds }`. |
| `web/apps/editor/src/lib/emitter-reorder.ts` | modify | New `reorderManyEmitters(bridge, ids, rootIndex)` — dispatch + selection-follow. |
| `web/apps/editor/src/lib/__tests__/emitter-reorder.test.ts` | create/extend | Vitest for `reorderManyEmitters` against a fake bridge. |
| `web/apps/editor/src/lib/multi-drag.ts` | create | Pure drag helpers: `selectedRootIdsInOrder`, `isMultiDrag`, `resolveMultiDropIntent`. |
| `web/apps/editor/src/lib/__tests__/multi-drag.test.ts` | create | Vitest for the pure drag helpers. |
| `web/apps/editor/src/screens/EmitterTree.tsx` | modify | Multi-drag branch in the pointer controller + preview (band + chip). |
| `src/ParticleSystem.h` / `.cpp` | modify | New `reorderManyRootsToIndex(selection, gap, outNewIds)`. |
| `src/host/BridgeDispatcher.cpp` | modify | `emitters/reorder-many` handler (validate, captureUndo, dispatch, emit). |

---

## Task 1: Bridge schema — `emitters/reorder-many`

**Files:**
- Modify: `web/packages/bridge-schema/src/index.ts` (message union near `:703`; `ResponseFor` near `:1037`)

- [ ] **Step 1: Add the message to the request union.** After the `emitters/move-many` line (~`:703`), add:

```ts
  | { kind: "emitters/reorder-many";        params: { ids: number[]; rootIndex: number } }   // batch drag-reorder: move selected roots to land contiguous at gap rootIndex; response.newIds follow them (input order)
```

- [ ] **Step 2: Add the response mapping.** In the `ResponseFor<R>` conditional, mirror `emitters/duplicate-many`'s `ok`-union (NOT `move-many`'s bare `{newIds}` — reorder-many can refuse). After the `emitters/duplicate-many` arm (~`:1027`) add:

```ts
  R extends { kind: "emitters/reorder-many" } ?
    | { ok: true; newIds: number[] }
    | { ok: false; error: string } :
```

- [ ] **Step 3: Typecheck.** Run (from `web/`): `pnpm --filter @particle-editor/editor exec tsc -b`
Expected: exits 0 (the new arms are well-formed; no consumer yet).

- [ ] **Step 4: Commit.**

```bash
git add web/packages/bridge-schema/src/index.ts
git commit -m "feat(bridge): add emitters/reorder-many message + response"
```

---

## Task 2: Mock algorithm — `reorderManyRoots` (the reference impl)

**Files:**
- Modify: `web/apps/editor/src/bridge/mock-state.ts` (add beside `reorderRootEmitter` at `:772`)
- Test: `web/apps/editor/src/lib/__tests__/reorder-many-roots.test.ts` (create)

- [ ] **Step 1: Write the failing test.** Create `web/apps/editor/src/lib/__tests__/reorder-many-roots.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { reorderManyRoots } from "@/bridge/mock-state";
import type { EmitterTreeDto, EmitterTreeNode } from "@particle-editor/bridge-schema";

// Build a flat root list [A,B,C,D,E,F] with ids 0..5, names = letters.
const LETTERS = ["A", "B", "C", "D", "E", "F"];
function tree(): EmitterTreeDto {
  const children: EmitterTreeNode[] = LETTERS.map((name, id) => ({
    id, name, role: "root", visible: true, children: [],
  }));
  return { root: { id: -1, name: "", role: "root", visible: true, children } };
}
const order = (t: EmitterTreeDto | null) =>
  t === null ? null : t.root.children.map((c) => c.name).join("");

describe("reorderManyRoots", () => {
  it("collapses a non-contiguous selection to a contiguous block, in tree order", () => {
    // select B(1) + D(3), drop at gap 5 (before F) -> ...C,E,B,D,F
    expect(order(reorderManyRoots(tree(), [1, 3], 5))).toBe("ACEBDF");
  });
  it("moves a contiguous block to the top (gap 0)", () => {
    // select C(2)+D(3) to gap 0 -> C,D,A,B,E,F
    expect(order(reorderManyRoots(tree(), [2, 3], 0))).toBe("CDABEF");
  });
  it("moves a contiguous block to the bottom (gap N)", () => {
    // select B(1)+C(2) to gap 6 -> A,D,E,F,B,C
    expect(order(reorderManyRoots(tree(), [1, 2], 6))).toBe("ADEFBC");
  });
  it("refuses a no-op on the block's own footprint (edges AND interior)", () => {
    // contiguous {B,C,D} = idx [1..3]; gaps 1,2,3,4 are all no-ops.
    for (const gap of [1, 2, 3, 4]) {
      expect(reorderManyRoots(tree(), [1, 2, 3], gap)).toBeNull();
    }
  });
  it("treats a single-id selection like a single reorder", () => {
    expect(order(reorderManyRoots(tree(), [0], 3))).toBe("BCADEF"); // A to gap 3
    expect(reorderManyRoots(tree(), [0], 1)).toBeNull();            // A's own edge -> no-op
  });
  it("refuses out-of-range gap, empty selection, and non-root ids", () => {
    expect(reorderManyRoots(tree(), [1], 99)).toBeNull();
    expect(reorderManyRoots(tree(), [], 2)).toBeNull();
    expect(reorderManyRoots(tree(), [42], 2)).toBeNull(); // 42 is not a root id
  });
  it("ignores duplicate ids and input order (uses tree order)", () => {
    expect(order(reorderManyRoots(tree(), [3, 1, 3], 5))).toBe("ACEBDF");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails.**
Run (from `web/`): `pnpm --filter @particle-editor/editor test reorder-many-roots`
Expected: FAIL — `reorderManyRoots is not a function` / not exported.

- [ ] **Step 3: Implement `reorderManyRoots`.** In `mock-state.ts`, immediately after `reorderRootEmitter` (after `:790`), add:

```ts
/** Reorder a SET of root emitters so they land contiguous at gap `rootIndex`,
 *  preserving their current top-to-bottom order; non-contiguous selections
 *  collapse together. Mirrors `ParticleSystem::reorderManyRootsToIndex`.
 *  Returns the mutated tree, or null on: out-of-range gap, empty selection,
 *  any non-root id, or an own-footprint no-op (a contiguous block dropped
 *  anywhere in [first, last+1]). */
export function reorderManyRoots(
  tree: EmitterTreeDto,
  ids: number[],
  rootIndex: number,
): EmitterTreeDto | null {
  const roots = tree.root.children;
  const N = roots.length;
  if (rootIndex < 0 || rootIndex > N) return null; // out of range (gap is 0..N)
  const pos = new Map<number, number>();
  roots.forEach((c, i) => pos.set(c.id, i));
  const idxs: number[] = [];
  for (const id of new Set(ids)) {
    const i = pos.get(id);
    if (i === undefined) return null; // missing or non-root
    idxs.push(i);
  }
  if (idxs.length === 0) return null;
  idxs.sort((a, b) => a - b);
  const M = idxs.length;
  const first = idxs[0]!, last = idxs[M - 1]!;
  // No-op: an already-contiguous block dropped anywhere on its own footprint.
  if (last - first + 1 === M && rootIndex >= first && rootIndex <= last + 1) {
    return null;
  }
  const selSet = new Set(idxs);
  const rest = roots.filter((_, i) => !selSet.has(i));
  const block = idxs.map((i) => roots[i]!);
  let removedBeforeGap = 0;
  for (const i of idxs) if (i < rootIndex) removedBeforeGap++;
  const insertAt = rootIndex - removedBeforeGap;
  const next = [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
  return { root: { ...tree.root, children: next } };
}
```

- [ ] **Step 4: Run the test to confirm it passes.**
Run (from `web/`): `pnpm --filter @particle-editor/editor test reorder-many-roots`
Expected: PASS (all cases).

- [ ] **Step 5: Commit.**

```bash
git add web/apps/editor/src/bridge/mock-state.ts web/apps/editor/src/lib/__tests__/reorder-many-roots.test.ts
git commit -m "feat(mock): reorderManyRoots batch root reorder + tests"
```

---

## Task 3: Mock bridge case — `emitters/reorder-many`

**Files:**
- Modify: `web/apps/editor/src/bridge/mock.ts` (add a case beside `emitters/move-many` at `:1023`; ensure `reorderManyRoots` is imported from `./mock-state`)

- [ ] **Step 1: Add the case.** After the `emitters/move-many` case block (after `:1057`), add:

```ts
      case "emitters/reorder-many": {
        const cur = useMockEmitterTree.getState().tree;
        const next = reorderManyRoots(cur, req.params.ids, req.params.rootIndex);
        if (next === null) return { ok: false, error: "reorder refused" };
        useMockEmitterTree.getState().setTree(next);
        this.emit({ kind: "emitters/tree/changed", payload: next });
        this.emit({ kind: "engine/state/changed", payload: snapshotEngineState() });
        // Mock ids are stable across a reorder; newIds = the selected ids still
        // at root level, in input order (aligned for applyNewSelection).
        const rootIds = new Set(next.root.children.map((c) => c.id));
        return { ok: true, newIds: req.params.ids.filter((id) => rootIds.has(id)) };
      }
```

- [ ] **Step 2: Ensure the import.** At the top of `mock.ts`, confirm `reorderManyRoots` is in the import from `./mock-state` (it sits beside `reorderRootEmitter`, already imported). Add it to that import list if absent.

- [ ] **Step 3: Typecheck + full suite (no regressions).**
Run (from `web/`): `pnpm --filter @particle-editor/editor exec tsc -b` (expect 0), then `pnpm --filter @particle-editor/editor test` (expect all green — currently 585; unchanged).

- [ ] **Step 4: Commit.**

```bash
git add web/apps/editor/src/bridge/mock.ts
git commit -m "feat(mock): wire emitters/reorder-many bridge case"
```

---

## Task 4: Web helper — `reorderManyEmitters`

**Files:**
- Modify: `web/apps/editor/src/lib/emitter-reorder.ts` (add beside `moveEmitters` at `:32`)
- Test: `web/apps/editor/src/lib/__tests__/emitter-reorder.test.ts` (create, or extend if present)

- [ ] **Step 1: Write the failing test.** Create/extend `web/apps/editor/src/lib/__tests__/emitter-reorder.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { reorderManyEmitters } from "@/lib/emitter-reorder";
import { useEmitterSelectionStore } from "@/lib/emitter-selection";

function fakeBridge(response: unknown) {
  return { request: vi.fn().mockResolvedValue(response) } as any;
}

describe("reorderManyEmitters", () => {
  beforeEach(() => {
    useEmitterSelectionStore.getState().setIds([1, 3], 3); // primary = 3
  });
  it("dispatches reorder-many then re-selects newIds, preserving primary by position", async () => {
    // input ids [1,3], primary 3 is at index 1; host returns newIds [4,5] -> primary -> 5
    const bridge = fakeBridge({ ok: true, newIds: [4, 5] });
    await reorderManyEmitters(bridge, [1, 3], 6);
    expect(bridge.request).toHaveBeenCalledWith({
      kind: "emitters/reorder-many",
      params: { ids: [1, 3], rootIndex: 6 },
    });
    const sel = useEmitterSelectionStore.getState();
    expect(sel.ids).toEqual([4, 5]);
    expect(sel.primary).toBe(5);
    // and it syncs the host single-selection to the new primary
    expect(bridge.request).toHaveBeenCalledWith({ kind: "emitters/select", params: { id: 5 } });
  });
  it("leaves the selection untouched when the host refuses", async () => {
    const bridge = fakeBridge({ ok: false, error: "reorder refused" });
    await reorderManyEmitters(bridge, [1, 3], 2);
    const sel = useEmitterSelectionStore.getState();
    expect(sel.ids).toEqual([1, 3]); // unchanged
  });
  it("no-ops on an empty id list", async () => {
    const bridge = fakeBridge({ ok: true, newIds: [] });
    await reorderManyEmitters(bridge, [], 2);
    expect(bridge.request).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails.**
Run (from `web/`): `pnpm --filter @particle-editor/editor test emitter-reorder`
Expected: FAIL — `reorderManyEmitters is not a function`.

- [ ] **Step 3: Implement `reorderManyEmitters`.** In `emitter-reorder.ts`, after `moveEmitters` (after `:41`), add:

```ts
/** Drag-reorder `ids` (the selected roots, in tree order) to land contiguous
 *  at gap `rootIndex`; the selection follows to the new positions. */
export async function reorderManyEmitters(
  bridge: Bridge,
  ids: number[],
  rootIndex: number,
): Promise<void> {
  if (ids.length === 0) return;
  const primary = useEmitterSelectionStore.getState().primary;
  const r = await bridge.request({ kind: "emitters/reorder-many", params: { ids, rootIndex } });
  if (r.ok) applyNewSelection(bridge, ids, primary, r.newIds);
}
```

- [ ] **Step 4: Run the test to confirm it passes.**
Run (from `web/`): `pnpm --filter @particle-editor/editor test emitter-reorder`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add web/apps/editor/src/lib/emitter-reorder.ts web/apps/editor/src/lib/__tests__/emitter-reorder.test.ts
git commit -m "feat(reorder): reorderManyEmitters dispatch + selection-follow"
```

---

## Task 5: Pure drag helpers — `multi-drag.ts`

**Files:**
- Create: `web/apps/editor/src/lib/multi-drag.ts`
- Test: `web/apps/editor/src/lib/__tests__/multi-drag.test.ts`

- [ ] **Step 1: Write the failing test.** Create `web/apps/editor/src/lib/__tests__/multi-drag.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { selectedRootIdsInOrder, isMultiDrag, resolveMultiDropIntent } from "@/lib/multi-drag";
import type { EmitterTreeNode } from "@particle-editor/bridge-schema";

const roots: EmitterTreeNode[] = [0, 1, 2, 3].map((id) => ({
  id, name: String(id), role: "root", visible: true, children: [],
}));

describe("selectedRootIdsInOrder", () => {
  it("returns selected roots in tree order, ignoring non-roots", () => {
    expect(selectedRootIdsInOrder([3, 0, 99], roots)).toEqual([0, 3]);
  });
});
describe("isMultiDrag", () => {
  it("is true only when the grabbed row is a root in a multi-root selection", () => {
    expect(isMultiDrag(1, [1, 2], roots)).toBe(true);
    expect(isMultiDrag(1, [1], roots)).toBe(false);   // single
    expect(isMultiDrag(9, [1, 2], roots)).toBe(false); // grabbed not in selection
  });
});
describe("resolveMultiDropIntent", () => {
  // block {1,2} (contiguous, idx [1,2]); rootCount 4
  it("returns a reorder gap for a valid root drop", () => {
    expect(resolveMultiDropIntent([1, 2], roots[3]!, 3, "below", 4)).toEqual({ rootIndex: 4 });
  });
  it("refuses an onto (reparent) zone", () => {
    expect(resolveMultiDropIntent([1, 2], roots[3]!, 3, "onto", 4)).toBeNull();
  });
  it("refuses a no-op on the block's own footprint", () => {
    expect(resolveMultiDropIntent([1, 2], roots[1]!, 1, "above", 4)).toBeNull(); // gap 1
    expect(resolveMultiDropIntent([1, 2], roots[2]!, 2, "below", 4)).toBeNull(); // gap 3
  });
});
```

- [ ] **Step 2: Run it to confirm it fails.**
Run (from `web/`): `pnpm --filter @particle-editor/editor test multi-drag`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `multi-drag.ts`.** Create the file:

```ts
// multi-drag.ts — pure helpers for multi-selection drag-reorder of the emitter
// tree. No React/DOM, so they unit-test directly; the pointer controller in
// EmitterTree.tsx calls them. Reorder-only, root-only — reparent stays a
// single-emitter-drag affordance.
import type { EmitterTreeNode } from "@particle-editor/bridge-schema";
import { computeRootGapIndex, type DropZone } from "@/lib/drop-zone";

/** The selected ids that are CURRENTLY roots, in tree (top-to-bottom) order. */
export function selectedRootIdsInOrder(
  selectedIds: number[],
  rootChildren: EmitterTreeNode[],
): number[] {
  const sel = new Set(selectedIds);
  return rootChildren.filter((c) => sel.has(c.id)).map((c) => c.id);
}

/** Whether a drag begun on `grabbedId` should move the whole selection: true
 *  iff the grabbed row is a root AND part of a multi-root selection. */
export function isMultiDrag(
  grabbedId: number,
  selectedIds: number[],
  rootChildren: EmitterTreeNode[],
): boolean {
  const roots = selectedRootIdsInOrder(selectedIds, rootChildren);
  return roots.length > 1 && roots.includes(grabbedId);
}

/** Resolve a multi-drag drop to a target gap, or null when refused:
 *    - "onto" (middle third) → refused (reparent is single-only),
 *    - non-root target → refused,
 *    - own-footprint no-op (an already-contiguous block in [first, last+1]).
 *  `blockRootIdxs` = the dragged block's current root indices, ascending. */
export function resolveMultiDropIntent(
  blockRootIdxs: number[],
  target: EmitterTreeNode,
  targetRootIdx: number,
  zone: DropZone,
  rootCount: number,
): { rootIndex: number } | null {
  if (zone === "onto") return null;
  if (target.role !== "root" || targetRootIdx === -1) return null;
  const gap = computeRootGapIndex(targetRootIdx, zone);
  if (gap < 0 || gap > rootCount) return null;
  const first = blockRootIdxs[0]!;
  const last = blockRootIdxs[blockRootIdxs.length - 1]!;
  const M = blockRootIdxs.length;
  if (last - first + 1 === M && gap >= first && gap <= last + 1) return null;
  return { rootIndex: gap };
}
```

- [ ] **Step 4: Run the test to confirm it passes.**
Run (from `web/`): `pnpm --filter @particle-editor/editor test multi-drag`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add web/apps/editor/src/lib/multi-drag.ts web/apps/editor/src/lib/__tests__/multi-drag.test.ts
git commit -m "feat(drag): pure multi-drag intent helpers + tests"
```

---

## Task 6: EmitterTree — multi-drag branch in the pointer controller

**Files:**
- Modify: `web/apps/editor/src/screens/EmitterTree.tsx` (`DropIndicator` type `:154`; `startDrag` `:1304-1404`; imports)

This task wires the controller; the band/chip visuals are Task 7. After this task, a multi-drag dispatches `reorder-many` correctly (verified by the full suite staying green + the helper tests); the preview still uses the single-drag line until Task 7.

- [ ] **Step 1: Add imports.** Near the other `@/lib` imports, add:

```ts
import { isMultiDrag, selectedRootIdsInOrder, resolveMultiDropIntent } from "@/lib/multi-drag";
import { reorderManyEmitters } from "@/lib/emitter-reorder";
import { useEmitterSelectionStore } from "@/lib/emitter-selection";
```
(Several may already be imported — do not duplicate.)

- [ ] **Step 2: Extend the indicator type** (`:154`) to carry the multi block size (used by Task 7's band):

```ts
type DropIndicator = { targetId: number; zone: DropZone; multi?: boolean; blockSize?: number } | null;
```

- [ ] **Step 3: Add multi-drag setup in `startDrag`.** After `const curRows = flatRows;` (`:1314`), add:

```ts
    const selIds = useEmitterSelectionStore.getState().ids;
    const multi = isMultiDrag(source.id, selIds, curRoots);
    const blockIds = multi ? selectedRootIdsInOrder(selIds, curRoots) : [];
    const blockRootIdxs = blockIds.map((id) => curRoots.findIndex((c) => c.id === id)); // ascending
    let lastReorderGap: number | null = null;
```

- [ ] **Step 4: Branch `updateDropTarget`.** Replace the body of `updateDropTarget` (the lines from `const targetId = ...` through `setIndicator(...)`, `:1331-1343`) so the multi path resolves a gap and sets a multi indicator:

```ts
      const targetId = Number(rowEl.getAttribute("data-emitter-id"));
      const target = curRows.find((r) => r.node.id === targetId)?.node ?? null;
      if (target === null) {
        lastParams = null;
        lastReorderGap = null;
        setIndicator(null);
        return;
      }
      const rect = rowEl.getBoundingClientRect();
      const zone = computeDropZone(clientY - rect.top, rect.height);
      const targetRootIdx = curRoots.findIndex((c) => c.id === targetId);
      if (multi) {
        const intent = resolveMultiDropIntent(blockRootIdxs, target, targetRootIdx, zone, curRoots.length);
        lastReorderGap = intent ? intent.rootIndex : null;
        setIndicator(intent ? { targetId, zone, multi: true, blockSize: blockIds.length } : null);
        return;
      }
      const params = resolveDropIntent(source, target, targetRootIdx, zone, curTree, curRoots);
      lastParams = params;
      setIndicator(params !== null ? { targetId, zone } : null);
```

- [ ] **Step 5: Branch the commit in `finish`.** Replace the commit line (`:1401-1403`):

```ts
      if (commit) {
        if (multi) {
          if (lastReorderGap !== null) void reorderManyEmitters(bridge, blockIds, lastReorderGap);
        } else if (lastParams !== null) {
          void bridge.request({ kind: "emitters/drop", params: lastParams });
        }
      }
```

- [ ] **Step 6: Typecheck + full suite.**
Run (from `web/`): `pnpm --filter @particle-editor/editor exec tsc -b` (expect 0), then `pnpm --filter @particle-editor/editor test` (expect all green — single-drag behaviour unchanged; new code is dormant until a multi-selection is dragged).

- [ ] **Step 7: Commit.**

```bash
git add web/apps/editor/src/screens/EmitterTree.tsx
git commit -m "feat(emitter-tree): multi-selection drag dispatches reorder-many"
```

---

## Task 7: EmitterTree — preview D (destination band + cursor chip)

**Files:**
- Modify: `web/apps/editor/src/screens/EmitterTree.tsx` (indicator render `:549-560`; `startDrag` `onMove` for chip; a tree-level chip element)

The band reuses the **measured** row height (not a constant — the verifier flagged the row is ~24px, and it can change with density settings). The chip follows the pointer.

- [ ] **Step 1: Add chip state.** Near the other `useState` in the EmitterTree component, add:

```ts
const [dragChip, setDragChip] = useState<{ x: number; y: number; names: string[]; total: number } | null>(null);
```

- [ ] **Step 2: Drive the chip from `onMove`.** In `startDrag`, at the end of `onMove` (after `updateDropTarget(rowEl, ev.clientY);`, `:1384`), add:

```ts
      if (multi && active) {
        const names = blockIds
          .map((id) => curRows.find((r) => r.node.id === id)?.node.name ?? "")
          .filter(Boolean);
        setDragChip({ x: ev.clientX, y: ev.clientY, names: names.slice(0, 3), total: blockIds.length });
      }
```
And clear it in `finish` (after `setIndicator(null);`, `:1399`): `setDragChip(null);`

- [ ] **Step 3: Render the destination band.** In the row render where the drop indicator is emitted (`:549-560`), alongside the existing line, add a band when this row is the multi indicator target. Use the row's own height via a `ref`'d measurement or `1.5rem`-based fallback `var(--row-h)`; simplest correct approach — render N empty row-height blocks:

```tsx
{isThisRowIndicator && indicator?.multi && (
  <div
    data-testid={`drop-band-${node.id}`}
    aria-hidden
    className="pointer-events-none absolute left-0 right-0 rounded bg-accent-soft ring-1 ring-sky-400"
    style={{
      top: indicator.zone === "above" ? 0 : "100%",
      height: `calc(${indicator.blockSize ?? 1} * 100%)`,
    }}
  />
)}
```
(The row container is already `relative`; `100%` = one row height, so `blockSize × 100%` reserves the block's footprint. Keep the existing 2px line — band + line is preview D.)

- [ ] **Step 4: Render the cursor chip** at the EmitterTree root (just before the component's closing fragment), as a fixed overlay:

```tsx
{dragChip && (
  <div
    data-testid="drag-chip"
    className="pointer-events-none fixed z-50 rounded-md border border-sky-400 bg-surface-1/95 px-2 py-1 text-xs text-sky-200 shadow-lg"
    style={{ left: dragChip.x + 12, top: dragChip.y + 12 }}
  >
    {dragChip.names.join(", ")}
    {dragChip.total > dragChip.names.length ? ` +${dragChip.total - dragChip.names.length} more` : ""}
    <span className="ml-1 opacity-70">({dragChip.total})</span>
  </div>
)}
```
(Use the editor's existing surface/accent tokens — match neighbouring components if the class names differ.)

- [ ] **Step 5: Write a render test for the band/chip presence.** Add to a new `web/apps/editor/src/screens/__tests__/EmitterTree.multidrag.test.tsx` a test that, with a 2-root selection, simulates `pointerdown` + a `pointermove` past threshold over another root and asserts `getByTestId("drag-chip")` exists and a `drop-band-*` is rendered. (Follow the existing EmitterTree test setup for mounting + the mock bridge; if pointer simulation proves brittle in jsdom, assert instead that `resolveMultiDropIntent` + the indicator state produce `multi: true`, and cover the visuals by the manual host smoke in Task 8.)

- [ ] **Step 6: Typecheck + full suite.**
Run (from `web/`): `pnpm --filter @particle-editor/editor exec tsc -b` (0), then `pnpm --filter @particle-editor/editor test` (green).

- [ ] **Step 7: Commit.**

```bash
git add web/apps/editor/src/screens/EmitterTree.tsx web/apps/editor/src/screens/__tests__/EmitterTree.multidrag.test.tsx
git commit -m "feat(emitter-tree): multi-drag preview — destination band + cursor chip"
```

---

## Task 8: C++ host — `reorderManyRootsToIndex` + dispatcher

The host has no Vitest; its **contract is the Task 2 cases** — it must produce the identical resulting order and a `newIds` contiguous run. Verify by building, the native harness, and a host smoke.

**Files:**
- Modify: `src/ParticleSystem.h` (declare beside `moveEmitterToRootIndex` `:338`)
- Modify: `src/ParticleSystem.cpp` (implement beside `moveEmitterToRootIndex` `:1450-1548`)
- Modify: `src/host/BridgeDispatcher.cpp` (handler beside the `emitters/drop` reorder branch `:4574`)

- [ ] **Step 1: Declare the engine method.** In `ParticleSystem.h` after `:338`:

```cpp
    // Move a set of root emitters so they become contiguous, landing at `gap`
    // (gap K = "before root K"; gap == rootCount = "after last root"),
    // preserving the selected roots' current top-to-bottom order.
    // Non-contiguous selections collapse together. `outNewIds` receives the
    // moved roots' final positional indices (a contiguous run, tree order).
    // Returns false on no-op / out-of-range / empty / non-root selection.
    bool reorderManyRootsToIndex(const std::vector<Emitter*>& selection,
                                 size_t gap,
                                 std::vector<size_t>& outNewIds);
```

- [ ] **Step 2: Implement the engine method.** In `ParticleSystem.cpp` after `moveEmitterToRootIndex` (after `:1548`). The body computes the final root order in one pass, then **reuses `moveEmitterToRootIndex`'s subtree-reassembly block verbatim** (steps 5–8: collect subtrees via `rootOf`, concatenate per `newRoots`, reassign `index = position`, rewrite parent `spawnDuringLife`/`spawnOnDeath` via the `oldIndices` array):

```cpp
bool ParticleSystem::reorderManyRootsToIndex(
        const std::vector<Emitter*>& selection, size_t gap,
        std::vector<size_t>& outNewIds)
{
    // 1. Current root order.
    std::vector<Emitter*> roots;
    for (Emitter* e : m_emitters) if (e->parent == NULL) roots.push_back(e);
    const size_t N = roots.size();
    if (gap > N) return false;

    // 2. Selection -> ascending source root indices; reject non-root/missing/empty.
    std::unordered_map<Emitter*, size_t> rootPos;
    for (size_t r = 0; r < N; ++r) rootPos[roots[r]] = r;
    std::set<size_t> uniq;
    for (Emitter* e : selection) {
        auto it = rootPos.find(e);
        if (it == rootPos.end()) return false; // null, missing, or non-root
        uniq.insert(it->second);
    }
    if (uniq.empty()) return false;
    std::vector<size_t> selRootIdx(uniq.begin(), uniq.end()); // ascending
    const size_t M = selRootIdx.size();
    const size_t first = selRootIdx.front();
    const size_t last  = selRootIdx.back();

    // 3. No-op: an already-contiguous block dropped anywhere on its own
    //    footprint [first, last+1] (edges AND interior).
    if (last - first + 1 == M && gap >= first && gap <= last + 1) return false;

    // 4. Final root order: rest (unselected, in order) + block spliced at the
    //    shift-corrected insertion point.
    std::vector<char> selFlag(N, 0);
    for (size_t r : selRootIdx) selFlag[r] = 1;
    std::vector<Emitter*> rest, block;
    for (size_t r = 0; r < N; ++r) (selFlag[r] ? block : rest).push_back(roots[r]);
    size_t removedBeforeGap = 0;
    for (size_t r : selRootIdx) if (r < gap) ++removedBeforeGap;
    const size_t insertAt = gap - removedBeforeGap;
    std::vector<Emitter*> newRoots;
    newRoots.reserve(N);
    newRoots.insert(newRoots.end(), rest.begin(), rest.begin() + insertAt);
    newRoots.insert(newRoots.end(), block.begin(), block.end());
    newRoots.insert(newRoots.end(), rest.begin() + insertAt, rest.end());

    // 5. Reassemble m_emitters by subtree + reassign index + rewrite spawn
    //    fields — IDENTICAL to moveEmitterToRootIndex steps 5-8. (Factor the
    //    shared block into a private helper `relayoutByRootOrder(newRoots)` and
    //    call it from BOTH methods to keep them in lock-step.)
    relayoutByRootOrder(newRoots);

    // 6. newIds = the block roots' final positional indices (contiguous run).
    outNewIds.clear();
    for (Emitter* r : block) outNewIds.push_back(r->index);
    return true;
}
```
**Note for the implementer:** if extracting `relayoutByRootOrder` is too invasive, inline the exact `:1486-1545` reassembly block here instead — but do not re-derive it; copy the proven code. Add `#include <set>` / `<unordered_map>` to `ParticleSystem.cpp` if not already present.

- [ ] **Step 3: Add the dispatcher handler.** In `BridgeDispatcher.cpp`, after the `emitters/drop` branch (after `:4656`-ish), mirroring the single-reorder branch's validation + the paste branch's `newIds` emission:

```cpp
    if (kind == "emitters/reorder-many") {
        if (m_pParticleSystem == nullptr || !*m_pParticleSystem) {
            sendOk(json{{"ok", false}, {"error", "particle system not bound"}}); return res;
        }
        const json idsJson = params.contains("ids") ? params["ids"] : json::array();
        const int gapRaw = params.value("rootIndex", -1);
        if (gapRaw < 0) { sendOk(json{{"ok", false}, {"error", "invalid rootIndex"}}); return res; }
        std::vector<ParticleSystem::Emitter*> sel;
        for (const auto& j : idsJson) {
            Emitter* e = getEmitterById(j.get<int>());
            if (e == nullptr)         { sendOk(json{{"ok", false}, {"error", "emitter not found"}}); return res; }
            if (e->parent != nullptr) { sendOk(json{{"ok", false}, {"error", "non-root in selection"}}); return res; }
            sel.push_back(e);
        }
        if (sel.empty()) { sendOk(json{{"ok", false}, {"error", "empty selection"}}); return res; }
        captureUndo();
        std::vector<size_t> outNewIds;
        const bool ok = (*m_pParticleSystem)->reorderManyRootsToIndex(
                            sel, static_cast<size_t>(gapRaw), outNewIds);
        if (!ok) { sendOk(json{{"ok", false}, {"error", "reorder refused"}}); return res; }
        json newIds = json::array();
        for (size_t v : outNewIds) newIds.push_back((int)v);
        sendOk(json{{"ok", true}, {"newIds", newIds}});
        markDirty();
        EmitEngineStateChanged();
        EmitEmittersTreeChanged();
        return res;
    }
```
(Match the exact helper names used by the neighbouring branches: `getEmitterById`, `captureUndo`, `sendOk`, `markDirty`, `EmitEngineStateChanged`, `EmitEmittersTreeChanged` — adjust if the local names differ.)

- [ ] **Step 4: Build the host (Debug x64, VS18).** Per L-046/L-039: ensure the WebView2 NuGet is restored, then build.
Run: `msbuild /m /p:Configuration=Debug /p:Platform=x64 ParticleEditor.sln` (from the repo root via the VS18 MSBuild).
Expected: clean build (only the benign `LNK4098`).

- [ ] **Step 5: Native a11y harness.** From `web/`: `pnpm build` (L-068), then `pnpm --filter @particle-editor/editor test:native`.
Expected: **174/0** (30 skipped) — no a11y surface change.

- [ ] **Step 6: Host parity smoke (manual, L-033).** Launch `x64\Debug\ParticleEditor.exe --new-ui`. Multi-select 2–3 root emitters (incl. a non-contiguous pair), drag one of them to a new gap; confirm: the block lands contiguous in tree order at the drop; the selection follows; the band + chip show during drag; a drop on the block's own footprint does nothing; **undo** restores the prior order; the doc shows dirty. Spot-check one case against a Task-2 example (same input → same resulting order) to confirm host/mock parity.

- [ ] **Step 7: Commit.**

```bash
git add src/ParticleSystem.h src/ParticleSystem.cpp src/host/BridgeDispatcher.cpp
git commit -m "feat(host): emitters/reorder-many batch root reorder (matches mock contract)"
```

---

## Final verification (before PR)

- [ ] Full web suite green: `pnpm --filter @particle-editor/editor test` (≥ 585 + the new cases).
- [ ] `pnpm --filter @particle-editor/editor build` clean (`tsc -b` 0; benign chunk warning only).
- [ ] Host Debug x64 clean; native harness 174/0.
- [ ] Host smoke (Task 8 Step 6) confirmed by the user (drag feel + preview, L-033).
- [ ] Open PR against `master`; CI (web + x64 Debug/Release) green before merge (explicit-OK gate).
- [ ] On ship: update `ROADMAP.md` (if a tag applies) + `CHANGELOG.md`; write the deferred-glide follow-up note (`tasks/next-reorder-glide-animation.md`).
