# Save / delete safety — design spec

_2026-06-09 · audit-driven UI-polish item (new-UI editor)._
_Source: `tasks/audit-2026-06-09.md` ranks **3** (surface file-op failures) +
**5** (confirm before deleting emitters) + the top settings-shortlist item
(confirm-before-delete toggle). Approach **B — Proportional Modal**, chosen
2026-06-09._

---

## 1. Goal + scope

**Goal.** Close two latent safety gaps in the now-default new UI:

1. **Silent file-op failure.** `file/save`, `file/open`, and `file/save-as`
   all return `{ ok: false; error }` on failure, but **every** call site fires
   `void bridge.request(...)` and discards the result. A failed save (disk
   full, read-only target, locked file) leaves the document silently dirty
   while the user believes it saved — real, unaware **data loss**. After this
   work, a non-cancel failure pops an error modal; the user knows the save did
   not happen.
2. **Frictionless destructive delete.** `emitters/delete` recursively deletes
   the target **and its whole child subtree** (`BridgeDispatcher.cpp:3250`),
   yet fires immediately from four no-friction entry points (incl. a bare
   `Delete` keypress). After this work, a delete that is *destructive and
   non-obvious* (removes children, or removes more than one emitter) asks for
   confirmation first; a single childless leaf still deletes immediately
   (it is trivially undoable). A default-on Preferences toggle governs the
   confirm.

When this ships the user gets: an error dialog on a failed Save/Open/Save-As;
a "Delete *X* and its N child emitters?" / "Delete N emitters?" confirmation
for destructive deletes; and a new **Preferences → Confirm before deleting
emitters** toggle.

**In:**
- Failure feedback for `file/save`, `file/open`, `file/save-as` at all call
  sites (`Toolbar.tsx`, `MenuBar.tsx`, `use-app-accelerators.ts`, and the
  `file/open` inside `promptSaveChanges`).
- Confirm-before-delete for the four delete entry points (`EmitterTree.tsx`
  ×3, `MenuBar.tsx` ×1), gated on a destructiveness predicate.
- A default-on `Confirm before deleting emitters` toggle in `PreferencesDialog`.
- Lifting the emitter tree into a small shared store so the delete helper and
  `MenuBar` can compute subtree impact.
- vitest coverage for every new pure function + flow; host Debug x64 build;
  native harness 174/0.

**Out (with reasons):**
- **Autosave-recover failure feedback** (audit Open Q6). It is *not* the
  S-effort web patch it first looked like: the host already `DeleteOrphans` on
  load failure and returns no status field, so a real fix needs a host
  response-field + skip-delete-on-failure change. Separate cross-layer item.
- **A toast / notification system** (audit Open Q7, approach C). Real new
  infrastructure; would also unlock positive feedback (import success, etc.).
  Filed as its own future item. This spec reuses the existing blocking
  `<Modal>` — correct for rare, critical failures and destructive confirms.
- **The multi-select stale-index footgun.** Multi-delete is a loop of
  *index*-based single deletes (`id` is a position into the flat emitter
  vector); selecting a parent **and** a descendant then deleting makes the
  queued descendant index stale after the parent's recursive delete shifts
  indices → it no-ops or targets the wrong emitter. Pre-existing correctness
  bug, separate fix. `performDelete` keeps today's descending-order behavior;
  the confirm *count* is computed from a deduped subtree union so the message
  stays honest even in that case.
- **Positive-feedback / success toasts, Import-failure feedback** — depend on
  the deferred toast system.
- **The per-edit IPC perf cluster** (audit ranks 1/2/6) and the tree-fetch
  change (rank 2) — orthogonal; the tree-store lift here does **not** touch the
  fetch mechanism.

---

## 2. What the codebase already gives us

**Response contracts (already shaped — we just stopped reading them):**
- `bridge-schema/src/index.ts:917-919` — `file/open` · `file/save` ·
  `file/save-as` each resolve to `{ ok: true; path? } | { ok: false; error }`.
- Host cancel-vs-failure is **already distinguished**:
  - `file/open`: cancel → `{ ok:false, error:"user-cancelled" }`
    (`BridgeDispatcher.cpp:2082`); IO failure → `"load failed"`/`err` (`:2108`).
  - `file/save`: cancel → `"user-cancelled"` (`:2205`); IO failure →
    `"save failed"`/`err` (`:2220`).
  - ⇒ Error feedback keys off `!ok && error !== "user-cancelled"`.
- `emitters/delete` → `Record<string, never>` (`index.ts:1023`); no status.
  Host handler `BridgeDispatcher.cpp:3252`: `getEmitterById` (index lookup,
  `:2750`), `captureUndo()` **pre-mutation** (`:3264`), then
  `sys->deleteEmitter(target)` which **recursively deletes the subtree**
  (`:3250`). So every delete is reversible via `undo/perform`.

**Delete call sites (all to be rewired):**
- `EmitterTree.tsx:411` `handleDelete` — context-menu, single `node.id`
  (menu item at `:756`).
- `EmitterTree.tsx:977` — delete `primaryId` (single).
- `EmitterTree.tsx:1673-1685` — `Delete` key; deletes all selected ids,
  descending order, loop of single `emitters/delete`.
- `MenuBar.tsx:353` `handleDeleteSelection` — same multi-select descending
  loop. (The descending-order dedup loop is **duplicated** here and in the
  tree; `performDelete` collapses both.)

**File call sites (all to be rewired):**
- `Toolbar.tsx:95` (`file/save`), `:104` (`file/save-as`), `:84`
  (`file/open` inside `promptSaveChanges`).
- `use-app-accelerators.ts:93` (Ctrl+S `file/save`), `:89` (Ctrl+O
  `file/open` via `promptSaveChanges`).
- `MenuBar.tsx:278` (`file/save`), `:282` (`file/save-as`), `:273`/`:287`
  (`file/open`).

**Tree shape & home:**
- `EmitterTreeDto = { root: EmitterTreeNode }` (`index.ts:486`);
  `EmitterTreeNode = { id; name; role; linkGroup?; visible; children[] }`
  (`index.ts:140-146`).
- Currently held in `EmitterTree.tsx` **local React state** (`flattenTree`
  walks `tree.root.children`, `:142`); not shared.

**Reusable patterns:**
- **Modal confirm**: Reset View Settings — `<Modal size="sm" title=…>` +
  `Modal.Body` `<p>` + `Modal.Footer` Cancel/confirm driven by a boolean
  (`MenuBar.tsx:850-867`).
- **Modal API**: `Modal({open,onOpenChange,title,size})` + compound
  `Modal.Body` / `Modal.Footer` / `Modal.CancelButton` (default "Cancel") /
  `Modal.OkButton` (default "OK") (`Modal.tsx:31-47,283-345`). Radix-based →
  focus trap + Esc handled by the primitive.
- **Persisted setting**: `theme.ts` — `readStoredMode()` reads
  `localStorage`, `applyMode()` writes (`:9,23-25`); `PreferencesDialog.tsx`
  binds it with `useState` + an `aria` toggle row.
- **Small zustand stores** in `lib/`: `right-dock.ts`, `tool-panel.ts`,
  `emitter-selection.ts` (`useEmitterSelectionStore`, read non-reactively via
  `.getState()` at `EmitterTree.tsx:1674`), etc. — the idiom for new shared
  state.
- **App-level modal mounts**: dialogs mount as siblings in
  `App.tsx:170-202`; `SaveChangesPrompt` at `:189`.

---

## 3. Architecture / implementation approach

Additive throughout, except one clean structural swap (tree → store). No
bridge-schema change, no C++ change.

### 3.1 `lib/file-op.ts` — file-op failure surfacing
```ts
// One zustand store holding the current error message (null = none).
export const useFileOpErrorStore = create<{
  message: string | null;
  show: (m: string) => void;
  clear: () => void;
}>(...)

// Await a file request and surface non-cancel failures. Returns the result
// so callers that care (e.g. promptSaveChanges chains) can still branch.
// `bridge` is passed in — it is NOT a module singleton (App.tsx:35 creates
// the one instance via useMemo(makeBridge) and threads it as a prop).
export async function runFileOp<R extends FileOpReq>(
  bridge: Bridge,
  req: R,
): Promise<ResultFor<R>> {
  const r = await bridge.request(req);
  if (!r.ok && r.error !== "user-cancelled") {
    useFileOpErrorStore.getState().show(messageFor(req.kind, r.error));
  }
  return r;
}
```
`messageFor` maps kind → friendly prefix ("Couldn't save the file", "Couldn't
open the file", …) + `: ${error}`. Touches only the store (not React), so it
is callable from non-component code (`use-app-accelerators.ts`) — the caller
already holds `bridge`.

### 3.2 `lib/emitter-tree.ts` — shared tree (structural)
```ts
export const useEmitterTreeStore = create<{
  tree: EmitterTreeDto | null;
  setTree: (t: EmitterTreeDto | null) => void;
}>(...)
```
`EmitterTree.tsx` swaps its `useState<EmitterTreeDto|null>` for
`useEmitterTreeStore` (reads `tree`, calls `setTree`). Same re-render behavior
(subscribed selector ≈ the old `useState`). Helper + `MenuBar` read
`useEmitterTreeStore.getState().tree` **non-reactively** at delete time — no
new subscriptions, no perf regression.

### 3.3 `lib/delete-emitters.ts` — the proportional confirm
```ts
// localStorage-backed toggle, theme.ts style. Default true.
export function readConfirmDelete(): boolean;            // key "alo:confirm-delete"
export function writeConfirmDelete(v: boolean): void;

export type DeleteImpact = {
  affectedCount: number;   // deduped union of every selected id's subtree
  primaryName: string;     // name of the primary/first selected emitter
  isDestructive: boolean;  // ids.length > 1 || someSelectedHasChildren
};
export function computeDeleteImpact(
  ids: number[], tree: EmitterTreeDto | null,
): DeleteImpact;           // pure; unit-tested

// The single descending-order delete loop (collapses the two copies).
// `bridge` threaded in (not a singleton — see runFileOp note).
export function performDelete(bridge: Bridge, ids: number[]): void;

// Confirm-or-immediate entry point used by ALL four call sites.
export function requestDeleteEmitters(bridge: Bridge, ids: number[]): void;

// Pending-confirm store consumed by <DeleteConfirmModal>. The store holds
// ONLY data — it never calls bridge. <DeleteConfirmModal> (mounted in App,
// where bridge lives) does performDelete(bridge, pending.ids) on confirm,
// then clear(). This keeps bridge out of the store.
export const useDeleteConfirmStore = create<{
  pending: { ids: number[]; impact: DeleteImpact } | null;
  open: (ids: number[], impact: DeleteImpact) => void;
  clear: () => void;     // pending = null (used by confirm-after-delete AND cancel)
}>(...)
```
`requestDeleteEmitters(bridge, ids)`:
1. `if (ids.length === 0) return;`
2. `impact = computeDeleteImpact(ids, useEmitterTreeStore.getState().tree)`
3. `if (!readConfirmDelete() || !impact.isDestructive) { performDelete(bridge, ids); return; }`
4. else `useDeleteConfirmStore.getState().open(ids, impact)`.

`computeDeleteImpact` walks the tree once, indexing nodes by id, then unions
each selected id's subtree into a `Set` (dedup) → `affectedCount = set.size`;
`someSelectedHasChildren = selected.some(n => n.children.length > 0)`.

### 3.4 Components (mounted once in `App.tsx`, beside `SaveChangesPrompt`)
- **`<FileOpErrorModal>`** — subscribes `useFileOpErrorStore`;
  `<Modal open={message !== null} size="sm" title="Couldn't complete that">`
  + `Modal.Body` `<p>{message}</p>` + `Modal.Footer` `<Modal.OkButton
  onClick={clear}>OK</Modal.OkButton>`.
- **`<DeleteConfirmModal>`** — subscribes `useDeleteConfirmStore`;
  `<Modal open={pending !== null} size="sm" title="Delete emitters?">` with
  body copy derived from `impact` by this exact rule (`n = ids.length`,
  `total = affectedCount`):
  - `n === 1 && total === 1` → never reaches here (non-destructive leaf is
    deleted immediately).
  - `n === 1 && total > 1` → "Delete **\"{primaryName}\"** and its
    {total - 1} child emitter(s)?"
  - `n > 1 && total === n` → "Delete {n} emitters?"
  - `n > 1 && total > n` → "Delete {n} selected emitters and their children
    ({total} total)?"

  Footer: `Modal.CancelButton` (**receives initial focus** — Enter must not
  delete) + `Modal.OkButton` labelled **Delete**, styled with the existing
  `--danger` token, whose `onClick` does
  `performDelete(bridge, pending.ids); clear()`. Cancel/Esc/overlay → `clear`.
  `<DeleteConfirmModal>` takes a `bridge: Bridge` prop (it is mounted in
  `App.tsx`, where the instance lives). `<FileOpErrorModal>` needs no bridge.

### 3.5 Call-site rewiring
- **File** (save / open / save-as sites): `void bridge.request({kind:"file/…"})`
  → `void runFileOp({kind:"file/…"})`; inside `promptSaveChanges` the
  `await bridge.request({kind:"file/open"})` becomes `await runFileOp(...)`.
  **`file/new` stays on `bridge.request`** — it has no IO failure mode and no
  `ok` envelope, so routing it through `runFileOp` would only widen the
  `FileOpReq` union for no benefit. `FileOpReq` = exactly
  `file/open | file/save | file/save-as`.
- **Delete** (4 sites): each replaces its inline `bridge.request`/descending
  loop with `requestDeleteEmitters(ids)` (tree: `[node.id]` / `[primaryId]`;
  multi: the current selection ids array). The descending sort moves into
  `performDelete`.

### 3.6 Settings
`PreferencesDialog.tsx` gains a second `flex` row under Theme: a label
"Confirm before deleting emitters" + a toggle/checkbox bound to
`useState(readConfirmDelete)`, `onChange` → `writeConfirmDelete(next)`.
Mirrors the existing Theme row's markup + a11y.

---

## 4. Risks named up front + mitigations

1. **Tree-store lift changes `EmitterTree` re-render timing.** Swapping
   `useState` for a subscribed zustand selector could, if done carelessly,
   change when the tree component re-renders. *Mitigation:* select exactly
   `s => s.tree` (one field) so the subscription fires on the same transitions
   the old `useState` did; the helper/`MenuBar` read via `.getState()` (no
   subscription). Net render behavior is unchanged — verified by the existing
   EmitterTree vitest suite staying green.

2. **Stale tree at confirm time.** The helper reads `getState().tree`
   synchronously when a delete is requested; if the tree were mid-update the
   count could be off by the in-flight mutation. *Mitigation:* the tree store
   is updated synchronously on `setTree` from the same event stream that
   gates the UI; a one-frame staleness only affects the *count in the message*
   (cosmetic), never correctness — `performDelete` always deletes exactly the
   passed ids. Accepted.

3. **Confirm fires on a now-invalid selection.** Between opening the confirm
   and pressing Delete, the underlying tree could change (rare; no concurrent
   editor). *Mitigation:* `performDelete` already no-ops out-of-range ids
   host-side (`:3256-3261` returns success on null target); the worst case is
   a no-op delete, not a crash. Accepted.

4. **Error modal stacks over an open dialog.** A Save triggered from within a
   modal flow could try to show the error modal while another is open.
   *Mitigation:* the file-error modal is a single App-level instance keyed on
   one store; Radix dialogs stack and trap focus independently. The only
   realistic trigger (Ctrl+S, toolbar Save) happens with no other modal open.
   Accepted; smoke-tested.

5. **Multi-select stale-index footgun (pre-existing, out of scope).** See §1
   Out. *Mitigation here:* none in delete *execution* (kept as-is), but the
   confirm count uses a deduped subtree union so the message never
   double-counts a parent+child selection; and the confirm itself gives the
   user a chance to notice an unexpectedly large count. Full fix deferred.

6. **`file/new` has no `ok` envelope.** Routing it through `runFileOp` would
   widen the request-result typing for no benefit. *Mitigation (decided):*
   `file/new` stays on `bridge.request`; `FileOpReq` is exactly
   `file/open | file/save | file/save-as` (§3.5). It has no IO failure mode,
   so there is nothing to surface.

7. **a11y golden churn.** New modals render only when open, so default-UI
   goldens are unaffected; the **Preferences** dialog gains a row → its golden
   (if one exists) updates. *Mitigation:* run the harness; if a Preferences
   golden shifts, regenerate it deliberately (`a11y:update`) and eyeball the
   diff. No composition/legacy asymmetry introduced.

---

## 5. Testing & verification

**Pure functions (vitest, new `delete-emitters.test.ts`, `file-op.test.ts`):**
- `computeDeleteImpact`: single leaf → `{isDestructive:false, affectedCount:1}`;
  parent with 2 children → `{isDestructive:true, affectedCount:3}`;
  multi-select of 3 leaves → `{isDestructive:true, affectedCount:3}`;
  parent+one-of-its-children both selected → `affectedCount` deduped (not
  double-counted); empty ids → count 0.
- `read/writeConfirmDelete`: default `true` when unset; round-trips a written
  value; tolerates a garbage localStorage value (defaults true).
- `performDelete`: emits `emitters/delete` for each id in **descending** order.

**Flows (vitest, component-level):**
- `runFileOp`: `{ok:false, error:"save failed"}` → store message set (modal
  would show); `{ok:false, error:"user-cancelled"}` → store untouched;
  `{ok:true}` → store untouched.
- `requestDeleteEmitters`: toggle ON + leaf → immediate `emitters/delete`, no
  confirm store entry; toggle ON + subtree/multi → confirm store populated, NO
  delete yet; confirm → delete(s) fire; cancel → none; toggle OFF → always
  immediate.
- `PreferencesDialog`: toggling the new row persists via `writeConfirmDelete`.
- `<DeleteConfirmModal>` copy: subtree vs multi wording matches `impact`.

**Native harness / build:**
- `pnpm build` (web) before native (L-068); `pnpm --filter
  @particle-editor/editor test:native` → **174/0** (regenerate the Preferences
  golden only if it shifts, per Risk 7).
- Host **Debug x64** (MSBuild VS18, L-046) clean — no C++ touched, so this is
  a regression guard, not a code change.

**Manual checklist (host, per L-033 for any feel/focus judgment):**
- *Happy paths:* save to a writable path → no modal, asterisk clears; open a
  valid file → loads, no modal; delete a single childless emitter → gone
  immediately, no confirm.
- *Failure feedback:* save over a read-only/locked file → error modal naming
  the failure, doc stays dirty; cancel the Save/Open native dialog → **no**
  modal.
- *Destructive confirm:* delete a parent with children → confirm states the
  child count; Cancel → nothing deleted; Delete → subtree gone, Ctrl+Z
  restores it. Multi-select 3 → "Delete 3 emitters?".
- *Toggle:* turn Confirm-before-delete OFF in Preferences → destructive
  deletes go immediate; file errors still surface. Toggle persists across
  reload.
- *Focus/keys:* confirm modal opens with focus on **Cancel**; Esc cancels;
  Enter on default focus does **not** delete.
- *Entry-point parity:* the confirm/immediate behavior is identical from the
  `Delete` key, the row context menu, and the Emitters menu.

**Debug instrumentation:** none required (no host change; no timing-sensitive
path). If the tree-store lift is suspected of a render change during review,
add a temporary `#region [DEL-SAFETY]` console probe in `EmitterTree` and
strip before handoff.
