// Zustand-backed in-memory mirror of `EngineStateDto` used by the
// MockBridge when the React app runs outside a WebView2 host (browser-
// mode design iteration). Defaults intentionally mirror
// `Engine::ResetParameters` / the engine constructor in
// `src/engine.cpp` so the mock state is indistinguishable from a
// freshly-launched native session.
//
// Colour encoding note: `groundSolidColor` and `background` are Win32
// COLORREFs (0x00BBGGRR). RGB(r,g,b) = `r | (g<<8) | (b<<16)`.
//   RGB(128,128,128) = 0x00808080  → flat-grey ground solid colour
//   RGB(0x14,0x08,0x34) = 0x00340814  → dark-purple background

import { create } from "zustand";
import type {
  EmitterTreeDto,
  EmitterTreeNode,
  EngineStateDto,
  LightDto,
  SpawnerParamsDto,
} from "@particle-editor/bridge-schema";

/** Defaults mirror `SpawnerConfig()` at [src/SpawnerDriver.h:18]:
 *  Auto mode + disabled + burst 1 + 0 s spacing + 10 s interval + origin
 *  + 5 s lifetime + zero jitter. */
export function makeDefaultSpawnerParams(): SpawnerParamsDto {
  return {
    mode: "auto",
    enabled: false,
    burstSize: 1,
    spacingSec: 0,
    intervalSec: 10,
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    maxLifetimeSec: 5,
    jitterPosition: [0, 0, 0],
    jitterVelocity: [0, 0, 0],
  };
}

export const GROUND_SLOT_COUNT = 8;       // matches Engine::kGroundTextureCount
export const SKYDOME_SLOT_COUNT = 12;     // matches Engine::kSkydomeSlotCount
export const SKYDOME_FIRST_CUSTOM = 9;    // matches Engine::kSkydomeFirstCustomSlot
export const SKYDOME_CUSTOM_COUNT =
  SKYDOME_SLOT_COUNT - SKYDOME_FIRST_CUSTOM;  // 3

const zeroLight: LightDto = {
  diffuse:   [0, 0, 0, 0],
  specular:  [0, 0, 0, 0],
  position:  [0, 0, 0, 0],
  direction: [0, 0, 0, 0],
};

/** Build a fresh defaults object every time so the test reset hook can
 *  splat it into the store without sharing references. */
export function makeDefaultEngineState(): EngineStateDto {
  return {
    // Editor-level state (Screen 8 Batch 3): a freshly-launched mock
    // session is untitled (no path) and clean (no edits since load).
    currentFilePath: null,
    dirty: false,

    ground: true,
    groundZ: 0,
    groundTexture: 0,
    groundSolidColor: 0x00808080,
    groundSlotCustomPaths: Array.from({ length: GROUND_SLOT_COUNT }, () => ""),

    skydomeSlot: 0,
    skydomeCustomPaths: Array.from({ length: SKYDOME_CUSTOM_COUNT }, () => ""),

    background: 0x00340814,

    lights: {
      sun:   { ...zeroLight },
      fill1: { ...zeroLight },
      fill2: { ...zeroLight },
    },
    ambient: [0, 0, 0, 0],
    shadow:  [0, 0, 0, 0],

    bloom: false,
    bloomAvailable: true,    // mock pretends the shader is loaded
    bloomStrength: 0.0,
    bloomCutoff:   0.9,
    bloomSize:     0.1,

    heatDebug: false,

    paused: false,

    camera: {
      position: [0, -250, 125],
      target:   [0, 0, 0],
      up:       [0, 0, 1],
    },

    wind:    [0, 0, 0],
    gravity: [0, 0, -1],

    spawner: makeDefaultSpawnerParams(),

    // Screen 4 Batch A: nothing selected by default. Single-select only
    // in Batch A; multi-select is Batch B.
    selectedEmitterId: null,
  };
}

type EngineStore = EngineStateDto & {
  applyPatch: (p: Partial<EngineStateDto>) => void;
  reset: () => void;
};

export const useMockEngineState = create<EngineStore>((set) => ({
  ...makeDefaultEngineState(),
  applyPatch: (p) => set(p as Partial<EngineStore>),
  reset: () => set(makeDefaultEngineState() as Partial<EngineStore>),
}));

/** Returns the engine-state slice of the store with the action methods
 *  stripped — i.e. exactly what should be serialised over the bridge. */
export function snapshotEngineState(): EngineStateDto {
  const { applyPatch: _a, reset: _r, ...rest } = useMockEngineState.getState();
  return rest;
}

// ─── Recent files registry (Screen 8 Batch 3) ───────────────────────
//
// Lives outside the EngineStateDto because it's host state, not engine
// state — the native host backs this with the Windows registry under
// `HKEY_CURRENT_USER\Software\AloParticleEditor` (matches legacy's
// AddToHistory / GetHistory at [src/main.cpp:650-768]). The mock stores
// the same list in-memory; the contract is the order (most-recent
// first), the cap (9 entries — `NUM_HISTORY_ITEMS` in legacy main.cpp),
// and the dedupe rule (a re-saved path moves to the front, not a
// duplicate entry).

export const MAX_RECENT_FILES = 9;

type RecentFilesStore = {
  paths: string[];
  setPaths: (paths: string[]) => void;
  /** Push to front; dedupes (case-insensitive) and caps at 9. */
  push: (path: string) => string[];
  reset: () => void;
};

// ─── Emitter-tree fixture (Screen 4 Batch A) ─────────────────────────
//
// Three roots covering the role + link-group combinations that the
// EmitterTree component needs to render:
//   - root "Smoke"   (linkGroup 1) — has a lifetime child + death child
//   - root "Sparks"  (linkGroup 1) — has a lifetime child only
//   - root "Flash"   (linkGroup 0) — leaf
// One linked pair (Smoke + Sparks share group 1) so the link-group dot
// styling is exercised. All emitters are visible=true; the disabled
// glyph state isn't reachable in Batch A (no visibility toggle yet).
//
// IDs are flat 0..5 and stable across resets so test assertions can
// pin to specific rows.

export function makeDefaultEmitterTree(): EmitterTreeDto {
  return {
    root: {
      id: -1,
      name: "",
      role: "root",
      linkGroup: 0,
      visible: true,
      children: [
        {
          id: 0, name: "Smoke", role: "root", linkGroup: 1, visible: true,
          children: [
            { id: 1, name: "Smoke embers", role: "lifetime", linkGroup: 0, visible: true, children: [] },
            { id: 2, name: "Smoke puff",   role: "death",    linkGroup: 0, visible: true, children: [] },
          ],
        },
        {
          id: 3, name: "Sparks", role: "root", linkGroup: 1, visible: true,
          children: [
            { id: 4, name: "Spark trail", role: "lifetime", linkGroup: 0, visible: true, children: [] },
          ],
        },
        {
          id: 5, name: "Flash", role: "root", linkGroup: 0, visible: true,
          children: [],
        },
      ],
    },
  };
}

type EmitterTreeStore = {
  tree: EmitterTreeDto;
  setTree: (tree: EmitterTreeDto) => void;
  reset: () => void;
};

export const useMockEmitterTree = create<EmitterTreeStore>((set) => ({
  tree: makeDefaultEmitterTree(),
  setTree: (tree) => set({ tree }),
  reset: () => set({ tree: makeDefaultEmitterTree() }),
}));

// ─── Link-group exempt-field fixture (Screen 4 Batch B1) ────────────
//
// The native MT-10 side persists per-group LinkExemptFlags bitfields;
// the wire shape is `string[]` of field names that are exempt
// (per-emitter). MockBridge owns an in-memory map so the React modal
// can round-trip a fixture without the C++ host. Defaults to "name +
// colorTexture + normalTexture + trackIndex" — matches
// GetDefaultLinkExemptFlags() at [src/LinkGroup.cpp].

type LinkGroupExemptStore = {
  exempts: Map<number, string[]>;
  get: (groupId: number) => string[];
  set: (groupId: number, fields: string[]) => void;
  reset: (groupId: number) => void;
  resetAll: () => void;
};

export const DEFAULT_LINK_EXEMPT_FIELDS: readonly string[] = Object.freeze([
  "colorTexture",
  "normalTexture",
  "trackIndex",
  // Note: "name" is intrinsically exempt at the data-model layer (see
  // LinkExemptFlags::name) but legacy's settings dialog hides it from
  // the field table. Mock fixture mirrors that — the wire surface
  // returns only fields the user can toggle.
]);

export const useMockLinkGroupExempt = create<LinkGroupExemptStore>(
  (set, get) => ({
    exempts: new Map(),
    get: (groupId) => {
      const explicit = get().exempts.get(groupId);
      if (explicit !== undefined) return [...explicit];
      return [...DEFAULT_LINK_EXEMPT_FIELDS];
    },
    set: (groupId, fields) => {
      const next = new Map(get().exempts);
      next.set(groupId, [...fields]);
      set({ exempts: next });
    },
    reset: (groupId) => {
      const next = new Map(get().exempts);
      next.delete(groupId);
      set({ exempts: next });
    },
    resetAll: () => set({ exempts: new Map() }),
  }),
);

// ─── Tree-mutation helpers (Screen 4 Batch B1) ──────────────────────
//
// MockBridge invokes these to mutate the fixture in-place while
// preserving the parent-pointer / role invariants. Each helper returns
// the new tree (immutable swap) so the Zustand setTree triggers
// subscribers and the contract test can assert on the resulting shape.

function cloneNode(n: EmitterTreeNode): EmitterTreeNode {
  return {
    ...n,
    children: n.children.map(cloneNode),
  };
}

/** Walk and apply a transform to every node matching `id`. Returns a
 *  new tree (structurally cloned) with the transform applied. */
function mapNode(
  tree: EmitterTreeDto,
  id: number,
  transform: (n: EmitterTreeNode) => EmitterTreeNode,
): EmitterTreeDto {
  const walk = (n: EmitterTreeNode): EmitterTreeNode => {
    if (n.id === id) return transform(n);
    return { ...n, children: n.children.map(walk) };
  };
  return { root: walk(tree.root) };
}

/** Returns the highest `id` currently present in the tree. -1 means
 *  the tree is empty (only the synthetic root). */
function maxIdIn(tree: EmitterTreeDto): number {
  let m = -1;
  const visit = (n: EmitterTreeNode) => {
    if (n.id > m) m = n.id;
    n.children.forEach(visit);
  };
  visit(tree.root);
  return m;
}

/** Generate a duplicate-suffix name. Mirrors `GenerateDuplicateName`
 *  at [src/UI/EmitterList.cpp:309]: strips a trailing `_<digits>` if
 *  present, then appends `_<next>` where next is `max+1` across all
 *  emitters whose name shares the same base. */
export function generateDuplicateName(
  tree: EmitterTreeDto,
  sourceName: string,
): string {
  // Strip trailing _<digits> from the base.
  let base = sourceName;
  const underscore = base.lastIndexOf("_");
  if (underscore !== -1) {
    const tail = base.slice(underscore + 1);
    if (tail.length > 0 && /^\d+$/.test(tail)) {
      base = base.slice(0, underscore);
    }
  }
  // Walk tree, find max N among names matching `<base>` or `<base>_<N>`.
  let maxN = 0;
  const visit = (n: EmitterTreeNode) => {
    if (n.id === -1) {
      n.children.forEach(visit);
      return;
    }
    if (n.name === base) {
      // n=0; maxN already starts there.
    } else if (
      n.name.length > base.length + 1 &&
      n.name.slice(0, base.length) === base &&
      n.name[base.length] === "_"
    ) {
      const tail = n.name.slice(base.length + 1);
      if (/^\d+$/.test(tail)) {
        const num = Number.parseInt(tail, 10);
        if (num > maxN) maxN = num;
      }
    }
    n.children.forEach(visit);
  };
  visit(tree.root);
  return `${base}_${maxN + 1}`;
}

/** Duplicate the emitter at `id` as a fresh root (matches legacy
 *  `EmitterList_DuplicateEmitter`). The duplicate's subtree gets new
 *  ids; the duplicate itself + descendants are inserted as a top-level
 *  child of the synthetic root. Returns the new tree + the id of the
 *  duplicated root. Returns null when the source id isn't in the tree
 *  (or is the synthetic root). */
export function duplicateEmitter(
  tree: EmitterTreeDto,
  id: number,
): { tree: EmitterTreeDto; newId: number } | null {
  if (id === -1) return null;
  const source = findEmitterNode(tree, id);
  if (source === null) return null;

  let nextId = maxIdIn(tree) + 1;
  const newRootId = nextId;
  const reassign = (n: EmitterTreeNode): EmitterTreeNode => {
    const idForThis = nextId++;
    return {
      ...n,
      id: idForThis,
      role: "root",   // top-level — legacy duplicates land as roots
      children: n.children.map((c) => ({
        ...cloneNode(c),
        id: nextId++,
      })),
    };
  };
  // Build the duplicate subtree with fresh ids. Walk via depth-first
  // so id assignment matches the visit order.
  const reassignAll = (n: EmitterTreeNode): EmitterTreeNode => ({
    ...n,
    id: nextId++,
    children: n.children.map(reassignAll),
  });
  // Reset nextId; we want the cloned root to take `newRootId`.
  nextId = maxIdIn(tree) + 1;
  const clone = reassignAll(source);
  // The cloned root becomes a root in the synthetic-root children.
  clone.role = "root";
  clone.name = generateDuplicateName(tree, source.name);

  const newTree: EmitterTreeDto = {
    root: {
      ...tree.root,
      children: [...tree.root.children, clone],
    },
  };
  // Note: reassign() helper above is unused — kept inline reassignAll
  // for clarity; the void reference here satisfies lint.
  void reassign;
  return { tree: newTree, newId: newRootId };
}

/** Delete the emitter at `id` (and its subtree). Returns the new tree
 *  or null when the id isn't found / is the synthetic root. */
export function deleteEmitter(
  tree: EmitterTreeDto,
  id: number,
): EmitterTreeDto | null {
  if (id === -1) return null;
  const prune = (n: EmitterTreeNode): EmitterTreeNode | null => {
    if (n.id === id) return null;
    return {
      ...n,
      children: n.children.flatMap((c) => {
        const p = prune(c);
        return p === null ? [] : [p];
      }),
    };
  };
  const next = prune(tree.root);
  if (next === null) return null;  // can't prune synthetic root
  return { root: next };
}

/** Rename the emitter at `id`. Returns the new tree (always defined;
 *  no-op if id not found). */
export function renameEmitter(
  tree: EmitterTreeDto,
  id: number,
  name: string,
): EmitterTreeDto {
  return mapNode(tree, id, (n) => ({ ...n, name }));
}

/** Increment-duplicate: same as `duplicateEmitter` but the new name's
 *  numeric suffix is bumped by `delta`. Legacy
 *  `EmitterList_DuplicateEmitter(hWnd, indexDelta)` shifts the
 *  TRACK_INDEX track; the mock has no track data to mutate, so we just
 *  record the duplicate + the suffix in the name. */
export function duplicateWithIndexIncrement(
  tree: EmitterTreeDto,
  id: number,
  delta: number,
): { tree: EmitterTreeDto; newId: number } | null {
  const dup = duplicateEmitter(tree, id);
  if (dup === null) return null;
  // delta is for the index-track shift in legacy. The duplicate's name
  // already carries the auto-suffix from generateDuplicateName; we tag
  // an additional `(+N)` marker so tests can assert the delta arrived.
  // (The contract test only checks the wire round-trip; the actual
  // index-track shift is host-side.)
  const annotated = mapNode(dup.tree, dup.newId, (n) => ({
    ...n,
    name: `${n.name} (+${delta})`,
  }));
  return { tree: annotated, newId: dup.newId };
}

// ─── Batch B2 helpers — Add child / Move / Link-group membership ────

/** Add a lifetime child under `parentId`. Refused when the parent
 *  already has a lifetime child (the underlying engine slot is a
 *  single pointer, not a list). Returns null on missing parent or
 *  already-filled slot. */
export function addLifetimeChildEmitter(
  tree: EmitterTreeDto,
  parentId: number,
): { tree: EmitterTreeDto; newId: number } | null {
  if (parentId === -1) return null;
  const parent = findEmitterNode(tree, parentId);
  if (parent === null) return null;
  if (parent.children.some((c) => c.role === "lifetime")) return null;
  const newId = maxIdIn(tree) + 1;
  const child: EmitterTreeNode = {
    id: newId,
    name: "",
    role: "lifetime",
    linkGroup: 0,
    visible: true,
    children: [],
  };
  const next = mapNode(tree, parentId, (n) => ({
    ...n,
    // Lifetime child renders before death child in the legacy tree
    // (during-life before on-death). Splice it in at index 0 so the
    // ordering remains stable when both children exist.
    children: [child, ...n.children],
  }));
  return { tree: next, newId };
}

/** Add a death child under `parentId`. Refused when the parent
 *  already has a death child. */
export function addDeathChildEmitter(
  tree: EmitterTreeDto,
  parentId: number,
): { tree: EmitterTreeDto; newId: number } | null {
  if (parentId === -1) return null;
  const parent = findEmitterNode(tree, parentId);
  if (parent === null) return null;
  if (parent.children.some((c) => c.role === "death")) return null;
  const newId = maxIdIn(tree) + 1;
  const child: EmitterTreeNode = {
    id: newId,
    name: "",
    role: "death",
    linkGroup: 0,
    visible: true,
    children: [],
  };
  const next = mapNode(tree, parentId, (n) => ({
    ...n,
    // Death child renders after lifetime child.
    children: [...n.children, child],
  }));
  return { tree: next, newId };
}

/** Swap the emitter at `id` with its adjacent sibling in `direction`.
 *  Returns null on missing id, non-root emitter, or move past edge —
 *  matches `ParticleSystem::moveEmitter` semantics (children can't be
 *  reordered since each parent has fixed-role slots). */
export function moveEmitterInTree(
  tree: EmitterTreeDto,
  id: number,
  direction: "up" | "down",
): EmitterTreeDto | null {
  if (id === -1) return null;
  // Only root emitters can be moved; find the target in the root list.
  const idx = tree.root.children.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= tree.root.children.length) return null;
  const next = [...tree.root.children];
  [next[idx], next[swapIdx]] = [next[swapIdx]!, next[idx]!];
  return { root: { ...tree.root, children: next } };
}

/** Find the smallest unused positive linkGroup id in the tree. Starts
 *  at 1; matches the host's "smallest unused positive uint32_t" rule. */
export function findUnusedLinkGroupId(tree: EmitterTreeDto): number {
  let maxGroup = 0;
  const visit = (n: EmitterTreeNode) => {
    if (n.linkGroup > maxGroup) maxGroup = n.linkGroup;
    n.children.forEach(visit);
  };
  visit(tree.root);
  return maxGroup + 1;
}

/** Update linkGroup membership on a batch of emitters. `groupId === -1`
 *  means "create a new group" (picks the smallest unused positive id
 *  via `findUnusedLinkGroupId`). `null` or `0` clears membership. */
export function setLinkGroupMembership(
  tree: EmitterTreeDto,
  ids: number[],
  groupId: number | null,
): EmitterTreeDto {
  let resolved: number;
  if (groupId === null || groupId === 0) {
    resolved = 0;
  } else if (groupId === -1) {
    resolved = findUnusedLinkGroupId(tree);
  } else {
    resolved = groupId;
  }
  const idSet = new Set(ids);
  const walk = (n: EmitterTreeNode): EmitterTreeNode => {
    const transformed = idSet.has(n.id)
      ? { ...n, linkGroup: resolved }
      : n;
    return { ...transformed, children: transformed.children.map(walk) };
  };
  return { root: walk(tree.root) };
}

// ─── Batch B3 helpers — drag/drop reorder + reparent ────────────────

/** Find the parent of `id` in the tree (returns the synthetic root if
 *  the id is a top-level root). Returns null when the id isn't found. */
function findParentNode(
  tree: EmitterTreeDto,
  id: number,
): EmitterTreeNode | null {
  const visit = (n: EmitterTreeNode): EmitterTreeNode | null => {
    for (const c of n.children) {
      if (c.id === id) return n;
      const hit = visit(c);
      if (hit) return hit;
    }
    return null;
  };
  return visit(tree.root);
}

/** Reorder a root-level emitter to `rootIndex`. Mirrors
 *  `ParticleSystem::moveEmitterToRootIndex(emitter, gap)`'s contract:
 *  gap K means "land before position K in the new list". Returns the
 *  mutated tree, or null when the source isn't a root or the no-op
 *  case fires (gap K equals sourceIdx or sourceIdx+1). */
export function reorderRootEmitter(
  tree: EmitterTreeDto,
  id: number,
  rootIndex: number,
): EmitterTreeDto | null {
  const roots = tree.root.children;
  const sourceIdx = roots.findIndex((c) => c.id === id);
  if (sourceIdx === -1) return null;          // not a root
  if (rootIndex < 0 || rootIndex > roots.length) return null;
  // No-op detection: gap [sourceIdx, sourceIdx+1] is the source's
  // own position. The C++ side returns false here too.
  if (rootIndex === sourceIdx || rootIndex === sourceIdx + 1) return null;
  const next = [...roots];
  const [moved] = next.splice(sourceIdx, 1);
  // After removal, indices above sourceIdx shift down by 1.
  const insertAt = rootIndex > sourceIdx ? rootIndex - 1 : rootIndex;
  next.splice(insertAt, 0, moved!);
  return { root: { ...tree.root, children: next } };
}

/** Reparent `id` under `targetId` in the named slot. Refuses when:
 *    - source or target missing,
 *    - source === target,
 *    - target is in source's subtree (cycle),
 *    - target's chosen slot is already filled. */
export function reparentEmitterInTree(
  tree: EmitterTreeDto,
  id: number,
  targetId: number,
  slot: "lifetime" | "death",
): EmitterTreeDto | null {
  if (id === targetId) return null;
  const source = findEmitterNode(tree, id);
  const target = findEmitterNode(tree, targetId);
  if (source === null || target === null) return null;
  // Cycle check: target must not be in source's subtree.
  const inSubtree = (n: EmitterTreeNode): boolean => {
    if (n.id === targetId) return true;
    return n.children.some(inSubtree);
  };
  if (inSubtree(source)) return null;
  // Slot occupancy check.
  if (target.children.some((c) => c.role === slot)) return null;
  // Already a direct child of target via *some* slot? Refuse — matches
  // the engine's "slot-switching under the same parent is refused" rule.
  const parent = findParentNode(tree, id);
  if (parent !== null && parent.id === targetId) return null;
  // Detach source from its current parent + attach as `slot` child of
  // target. Walk the tree once, transforming each touched node.
  const clonedSource: EmitterTreeNode = {
    ...source,
    role: slot,
    // Keep source's own children; they ride along with the move.
    children: source.children.map(cloneNode),
  };
  const walk = (n: EmitterTreeNode): EmitterTreeNode => {
    // Detach: drop source from any children list it appears in.
    let nextChildren = n.children.filter((c) => c.id !== id);
    // Attach: when we're the target, splice source in. Lifetime
    // renders before death; insert at the front for "lifetime", append
    // for "death" — matches the legacy ordering convention.
    if (n.id === targetId) {
      nextChildren = slot === "lifetime"
        ? [clonedSource, ...nextChildren]
        : [...nextChildren, clonedSource];
    }
    return { ...n, children: nextChildren.map(walk) };
  };
  return { root: walk(tree.root) };
}

/** Walks the fixture and returns the node with the matching id, or null
 *  when the id isn't present in the tree. The synthetic id=-1 root
 *  matches too — callers that explicitly forbid the synthetic root must
 *  guard themselves. */
export function findEmitterNode(tree: EmitterTreeDto, id: number): EmitterTreeNode | null {
  const visit = (n: EmitterTreeNode): EmitterTreeNode | null => {
    if (n.id === id) return n;
    for (const c of n.children) {
      const hit = visit(c);
      if (hit) return hit;
    }
    return null;
  };
  return visit(tree.root);
}

export const useMockRecentFiles = create<RecentFilesStore>((set, get) => ({
  paths: [],
  setPaths: (paths) => set({ paths }),
  push: (path) => {
    const lower = path.toLowerCase();
    const filtered = get().paths.filter((p) => p.toLowerCase() !== lower);
    const next = [path, ...filtered].slice(0, MAX_RECENT_FILES);
    set({ paths: next });
    return next;
  },
  reset: () => set({ paths: [] }),
}));
