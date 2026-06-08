# Paste As ▸ Child Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the legacy "Paste As ▸ Child" capability — paste a copied emitter into another emitter's lifetime or death child slot via a new host command and a tree context-menu submenu.

**Architecture:** New `emitters/paste-as-child { parentId, slot }` bridge command, implemented in both the C++ host (`BridgeDispatcher`) and the MockBridge. The host reuses its existing paste-deserialise + `addLifetimeEmitter`/`addDeathEmitter` primitives; the mock reuses its child-attach helpers seeded from the clipboard's first buffer. The React tree gains a `Paste As ▸` context submenu gated on clipboard-has-content + slot-free.

**Tech Stack:** TypeScript/React (Vite + Vitest), Radix `@radix-ui/react-context-menu`, Zustand, C++17 host (`nlohmann::json`), MSBuild, the native a11y harness (Playwright-driven UIA capture).

**Reference spec:** `docs/superpowers/specs/2026-06-07-paste-as-child-design.md`

---

## File structure

- `web/packages/bridge-schema/src/index.ts` — add request union member + `slot` literal + response-type map. (Schema is the shared contract; both host and mock conform.)
- `web/apps/editor/src/bridge/mock-state.ts` — new pure helper `pasteAsChildFromClipboard`. (All tree mutation logic lives here, unit-tested in isolation.)
- `web/apps/editor/src/bridge/mock.ts` — new `emitters/paste-as-child` dispatch case + `isKnownKind` entry. (Thin glue: store reads + event emits.)
- `web/apps/editor/src/screens/EmitterTree.tsx` — two handlers + a `Paste As ▸` context submenu. (UI wiring only.)
- `src/host/BridgeDispatcher.cpp` — new `emitters/paste-as-child` handler. (Native authority.)
- Tests: `web/apps/editor/src/bridge/__tests__/paste-as-child.test.ts` (new) for the mock-state helper + the MockBridge round-trip.
- Goldens: `web/apps/editor/tests/a11y-goldens/*` — re-baseline whichever surface (if any) captures the tree context menu.

---

## Task 1: mock-state `pasteAsChildFromClipboard` helper (pure, TDD)

**Files:**
- Modify: `web/apps/editor/src/bridge/mock-state.ts` (add after `addDeathChildEmitter`, ~line 585)
- Test: `web/apps/editor/src/bridge/__tests__/paste-as-child.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `web/apps/editor/src/bridge/__tests__/paste-as-child.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { EmitterTreeDto, EmitterTreeNode } from "@particle-editor/bridge-schema";
import { pasteAsChildFromClipboard } from "../mock-state";

function node(id: number, name: string, role: EmitterTreeNode["role"], children: EmitterTreeNode[] = []): EmitterTreeNode {
  return { id, name, role, linkGroup: 0, visible: true, children };
}

// A two-root tree; root id 1 ("Alpha") has no children (both slots free).
function freshTree(): EmitterTreeDto {
  return { root: node(0, "", "root", [node(1, "Alpha", "root"), node(2, "Beta", "root")]) };
}

const clip: EmitterTreeNode[] = [node(99, "Copied", "root", [node(100, "Copied kid", "lifetime")])];

describe("pasteAsChildFromClipboard", () => {
  it("attaches clipboard[0] as a lifetime child of the target", () => {
    const r = pasteAsChildFromClipboard(freshTree(), clip, 1, "lifetime");
    expect(r).not.toBeNull();
    const alpha = r!.tree.root.children.find((c) => c.id === 1)!;
    const lifetime = alpha.children.find((c) => c.role === "lifetime")!;
    expect(lifetime).toBeTruthy();
    expect(lifetime.name).toBe("Copied");
    expect(lifetime.id).toBe(r!.newId);
    // Seeded from the buffer: the copied subtree comes along...
    expect(lifetime.children.length).toBe(1);
  });

  it("attaches as a death child when slot=death", () => {
    const r = pasteAsChildFromClipboard(freshTree(), clip, 1, "death");
    const alpha = r!.tree.root.children.find((c) => c.id === 1)!;
    expect(alpha.children.find((c) => c.role === "death")!.role).toBe("death");
  });

  it("returns null when the buffer is empty", () => {
    expect(pasteAsChildFromClipboard(freshTree(), [], 1, "lifetime")).toBeNull();
  });

  it("returns null when the lifetime slot is already occupied", () => {
    const tree: EmitterTreeDto = { root: node(0, "", "root", [
      node(1, "Alpha", "root", [node(5, "existing", "lifetime")]),
    ]) };
    expect(pasteAsChildFromClipboard(tree, clip, 1, "lifetime")).toBeNull();
  });

  it("returns null for an unknown parent", () => {
    expect(pasteAsChildFromClipboard(freshTree(), clip, 999, "lifetime")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C web --filter @particle-editor/editor test paste-as-child`
Expected: FAIL — `pasteAsChildFromClipboard is not a function` (not exported yet).

- [ ] **Step 3: Write the helper**

Add to `web/apps/editor/src/bridge/mock-state.ts` after `addDeathChildEmitter` (~line 585). It mirrors the child-attach helpers but seeds the child from a deep clone of `buffer[0]` (re-id'd to the next free id, re-roled to the slot). Reuses `findEmitterNode`, `maxIdIn`, `mapNode`, `cloneNode` (all already in this file):

```ts
/** Paste the first clipboard buffer entry as a child of `parentId` in the
 *  given slot. Mirrors the legacy Paste-As-Lifetime/Death: one emitter into
 *  one slot. Returns null on an empty buffer, an unknown parent, or an
 *  already-occupied slot (slot single-occupancy — same refusal as the
 *  add-child helpers). The seeded child keeps the copied subtree but is
 *  re-id'd and re-roled to the target slot. */
export function pasteAsChildFromClipboard(
  tree: EmitterTreeDto,
  buffer: EmitterTreeNode[],
  parentId: number,
  slot: "lifetime" | "death",
): { tree: EmitterTreeDto; newId: number } | null {
  if (parentId === -1 || buffer.length === 0) return null;
  const parent = findEmitterNode(tree, parentId);
  if (parent === null) return null;
  if (parent.children.some((c) => c.role === slot)) return null;
  const newId = maxIdIn(tree) + 1;
  const seed = cloneNode(buffer[0]);
  const child: EmitterTreeNode = { ...seed, id: newId, role: slot };
  const next = mapNode(tree, parentId, (n) => ({
    ...n,
    // Lifetime renders before death (during-life before on-death).
    children: slot === "lifetime" ? [child, ...n.children] : [...n.children, child],
  }));
  return { tree: next, newId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C web --filter @particle-editor/editor test paste-as-child`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/apps/editor/src/bridge/mock-state.ts web/apps/editor/src/bridge/__tests__/paste-as-child.test.ts
git commit -m "feat(mock): pasteAsChildFromClipboard tree helper (paste-as-child)"
```

---

## Task 2: Bridge schema + MockBridge dispatch (TDD)

**Files:**
- Modify: `web/packages/bridge-schema/src/index.ts` (request union ~line 751; response map ~line 1014)
- Modify: `web/apps/editor/src/bridge/mock.ts` (`isKnownKind` ~line 111; dispatch ~line 1089)
- Test: `web/apps/editor/src/bridge/__tests__/paste-as-child.test.ts` (append)

- [ ] **Step 1: Write the failing test** (append to the file from Task 1)

```ts
import { MockBridge } from "../mock";
import { useMockEmitterTree, useMockEmitterClipboard, resetMockState } from "../mock-state";

describe("MockBridge emitters/paste-as-child", () => {
  it("pastes the clipboard into a free lifetime slot and returns a real newId", async () => {
    resetMockState();
    const bridge = new MockBridge();
    // Copy a real root so the clipboard has content.
    await bridge.request({ kind: "emitters/copy", params: { ids: [/* first root id */ 1] } });
    const before = useMockEmitterTree.getState().tree;
    const targetId = before.root.children[1].id; // a different root
    const res = await bridge.request({
      kind: "emitters/paste-as-child",
      params: { parentId: targetId, slot: "lifetime" },
    });
    expect(res.newId).toBeGreaterThan(0);
    const after = useMockEmitterTree.getState().tree;
    const target = after.root.children.find((c) => c.id === targetId)!;
    expect(target.children.some((c) => c.role === "lifetime")).toBe(true);
  });

  it("returns newId -1 when the clipboard is empty", async () => {
    resetMockState();
    const bridge = new MockBridge();
    const id = useMockEmitterTree.getState().tree.root.children[0].id;
    const res = await bridge.request({ kind: "emitters/paste-as-child", params: { parentId: id, slot: "death" } });
    expect(res.newId).toBe(-1);
  });
});
```

> RESOLVED: there is no `resetMockState`. Use the per-store resets:
> `useMockEmitterTree.getState().reset()` (→ `makeDefaultEmitterTree()`) and
> `useMockEmitterClipboard.getState().reset()`. Import `MockBridge` from `../mock`
> and the two stores from `../mock-state`. Read a real root id from
> `useMockEmitterTree.getState().tree.root.children[0].id` for the copy, and a
> *different* root (`children[1].id`) as the paste target. `emitters/copy`
> populates the clipboard via `copyEmittersToClipboard` (already wired).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C web --filter @particle-editor/editor test paste-as-child`
Expected: FAIL — schema rejects the unknown `kind`, or the mock returns the
"not implemented" shape / `isKnownKind` is false.

- [ ] **Step 3a: Add the schema member**

In `web/packages/bridge-schema/src/index.ts`, after the `emitters/paste` line (~751):

```ts
  // `emitters/paste-as-child { parentId, slot }` deserialises the FIRST
  // clipboard buffer and attaches it into the parent's lifetime/death
  // child slot (legacy Paste As ▸). Refused (newId -1) when the slot is
  // filled or the clipboard is empty. One emitter per slot — multi-buffer
  // clipboards paste only buffer[0].
  | { kind: "emitters/paste-as-child"; params: { parentId: number; slot: "lifetime" | "death" } }
```

And in the response-type map, beside the add-child mappings (~line 1000):

```ts
  R extends { kind: "emitters/paste-as-child" } ? { newId: number } :
```

- [ ] **Step 3b: Add the MockBridge case**

In `web/apps/editor/src/bridge/mock.ts`:
- `isKnownKind` (~line 111), add: `if (kind === "emitters/paste-as-child") return true;`
- Import `pasteAsChildFromClipboard` from `./mock-state` (extend the existing import).
- Dispatch case (after the `emitters/paste` case, ~line 1103):

```ts
      case "emitters/paste-as-child": {
        const cur = useMockEmitterTree.getState().tree;
        const buf = useMockEmitterClipboard.getState().buffer;
        const result = pasteAsChildFromClipboard(cur, buf, req.params.parentId, req.params.slot);
        if (result === null) {
          // Empty clipboard or occupied slot — emit nothing, no dirty flip.
          return { newId: -1 };
        }
        useMockEmitterTree.getState().setTree(result.tree);
        this.emit({ kind: "emitters/tree/changed", payload: result.tree });
        this.emit({ kind: "engine/state/changed", payload: snapshotEngineState() });
        return { newId: result.newId };
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C web --filter @particle-editor/editor test paste-as-child`
Expected: PASS. Then `pnpm -C web --filter @particle-editor/editor exec tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add web/packages/bridge-schema/src/index.ts web/apps/editor/src/bridge/mock.ts web/apps/editor/src/bridge/__tests__/paste-as-child.test.ts
git commit -m "feat(bridge): emitters/paste-as-child schema + MockBridge dispatch"
```

---

## Task 3: React context-menu `Paste As ▸` submenu

**Files:**
- Modify: `web/apps/editor/src/screens/EmitterTree.tsx` (handlers ~line 419; JSX after the Paste item ~line 730)

> The Radix context-submenu interaction is not reliably driveable in jsdom (the
> existing EmitterTree suite never opens the context menu), so this task is
> verified **live** (Task 5), not by a new jsdom test. The gating booleans
> (`hasClipboard`, `hasLifetimeChild`, `hasDeathChild`) are already computed and
> already proven by the existing "Add Lifetime/Death Child" items.

- [ ] **Step 1: Add the handlers** next to `handleAddLifetimeChild` (~line 419):

```tsx
  const handlePasteAsLifetime = () => {
    resolveTargetIds();
    void bridge.request({
      kind: "emitters/paste-as-child",
      params: { parentId: node.id, slot: "lifetime" },
    });
  };
  const handlePasteAsDeath = () => {
    resolveTargetIds();
    void bridge.request({
      kind: "emitters/paste-as-child",
      params: { parentId: node.id, slot: "death" },
    });
  };
```

- [ ] **Step 2a: Add an occluding SubContent wrapper.** The top-level menu registers a
  viewport occlusion via `OccludingContextMenuContent` (`EmitterTree.tsx:259-281`) so
  the layered D3D viewport popup doesn't overpaint it. A submenu renders in its OWN
  portal at a different screen location, so it needs its OWN occlusion rect or it will
  render behind the viewport on the native side. Add a sibling wrapper next to
  `OccludingContextMenuContent`:

```tsx
function OccludingContextSubContent({
  bridge,
  occlusionId,
  children,
  ...rest
}: ComponentProps<typeof ContextMenu.SubContent> & {
  bridge: Bridge;
  occlusionId: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useViewportOcclusion(bridge, occlusionId, ref, 24, 24);
  return (
    <ContextMenu.SubContent
      className="z-50 min-w-[200px] rounded-md border border-border-2 bg-bg-2 p-1 shadow-xl"
      {...rest}
    >
      <div ref={ref}>{children}</div>
    </ContextMenu.SubContent>
  );
}
```

- [ ] **Step 2b: Add the submenu JSX** immediately after the existing Paste `ContextMenu.Item`
  (closes at ~line 730), before the following `ContextMenu.Separator`. The submenu's
  `occlusionId` must be unique per row — derive it from the row's existing occlusionId or
  `node.id` (e.g. `` `paste-as-${node.id}` ``):

```tsx
            <ContextMenu.Sub>
              <ContextMenu.SubTrigger
                disabled={!hasClipboard}
                className={menuItemClass}
              >
                Paste As
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <OccludingContextSubContent
                  bridge={bridge}
                  occlusionId={`paste-as-${node.id}`}
                >
                  <ContextMenu.Item
                    onSelect={handlePasteAsLifetime}
                    disabled={!hasClipboard || hasLifetimeChild}
                    className={menuItemClass}
                  >
                    Lifetime Child
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    onSelect={handlePasteAsDeath}
                    disabled={!hasClipboard || hasDeathChild}
                    className={menuItemClass}
                  >
                    Death Child
                  </ContextMenu.Item>
                </OccludingContextSubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>
```

> The Paste item itself sits at `:724-730`; items use `menuItemClass` (`:483`),
> separators `separatorClass` (`:485`). `useViewportOcclusion` and `Bridge` are
> already imported in this file. Confirm `ContextMenu.SubTrigger`/`Sub`/`SubContent`
> resolve from the existing `import * as ContextMenu from "@radix-ui/react-context-menu"`.

- [ ] **Step 3: Typecheck + full suite**

Run: `pnpm -C web --filter @particle-editor/editor exec tsc --noEmit` → 0
Run: `pnpm -C web --filter @particle-editor/editor test` → all green (502 + new)

- [ ] **Step 4: Commit**

```bash
git add web/apps/editor/src/screens/EmitterTree.tsx
git commit -m "feat(new-ui): Paste As > Lifetime/Death Child context submenu"
```

---

## Task 4: Native host handler

**Files:**
- Modify: `src/host/BridgeDispatcher.cpp` (new block immediately after the `emitters/paste` handler, ~line 4604)

> No C++ unit harness exists in this repo; verification is the build + the native
> a11y/round-trip harness (Task 5). This handler is a literal splice of two
> blocks already in this file — the `emitters/paste` deserialise (`:4561-4595`)
> and the `emitters/add-lifetime-child` attach + event sequence (`:4063-4085`).

- [ ] **Step 1: Add the handler** after the `emitters/paste` block closes (`return res;` at ~line 4604):

```cpp
    if (kind == "emitters/paste-as-child")
    {
        int parentId = params.value("parentId", -1);
        std::string slot = params.value("slot", std::string());
        ParticleSystem::Emitter* parent = getEmitterById(parentId);
        if (parent == nullptr || m_pParticleSystem == nullptr || !*m_pParticleSystem
            || m_emitterClipboard.empty() || m_emitterClipboard.front().empty())
        {
            sendOk(json{{"newId", -1}});
            return res;
        }
        captureUndo();
        ParticleSystem* sys = m_pParticleSystem->get();
        ParticleSystem::Emitter* child = nullptr;
        MemoryFile* memfile = new MemoryFile;
        try
        {
            auto& buf = m_emitterClipboard.front();
            memfile->write(buf.data(), static_cast<unsigned long>(buf.size()));
            memfile->seek(0);
            ChunkReader reader(memfile);
            ParticleSystem::Emitter staging(reader);
            staging.name = GenerateDuplicateName(sys, staging.name);
            child = (slot == "death")
                ? sys->addDeathEmitter(parent, staging)
                : sys->addLifetimeEmitter(parent, staging);
        }
        catch (...)
        {
            // Deser failed — fall through to the null-child refusal below.
        }
        memfile->Release();
        if (child == nullptr)
        {
            // Slot occupied or deser threw. captureUndo already ran (parity
            // with add-lifetime-child, which also captures before this check).
            sendOk(json{{"newId", -1}});
            return res;
        }
        sendOk(json{{"newId", static_cast<int>(child->index)}});
        markDirty();
        EmitEngineStateChanged();
        EmitEmittersTreeChanged();
        return res;
    }
```

- [ ] **Step 2: Build the host** (PowerShell; L-046):

```
& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" `
  "<worktree>\ParticleEditor.sln" /p:Configuration=Debug /p:Platform=x64 /m /nologo /v:minimal
```
Expected: `Build succeeded`, 0 errors. (`x64\Debug\ParticleEditor.exe` refreshed.)

- [ ] **Step 3: Commit**

```bash
git add src/host/BridgeDispatcher.cpp
git commit -m "feat(host): emitters/paste-as-child handler (attach into life/death slot)"
```

---

## Task 5: Native re-baseline + live verification

**Files:**
- Modify (regenerate): `web/apps/editor/tests/a11y-goldens/*` if the tree context menu is captured.

- [ ] **Step 1: Determine golden impact.** Check whether any a11y capture spec opens
  the emitter-tree context menu (grep `tests/` for `contextmenu` / right-click on a
  tree row). If none, the submenu has **zero** golden impact and only `test:native`
  168/0 must re-confirm. If one does, expect a surgical single-surface delta.

- [ ] **Step 2: Build dist + L-068 guard:**

```
pnpm -C web --filter @particle-editor/editor build
# confirm the new strings baked in:
grep -o "Paste As" web/apps/editor/dist/assets/*.js   # expect >=1
```

- [ ] **Step 3: Re-baseline + verify native:**

```
pnpm -C web --filter @particle-editor/editor a11y:update   # writes goldens
git diff --stat web/apps/editor/tests/a11y-goldens/        # review: surgical?
pnpm -C web --filter @particle-editor/editor test:native   # expect 168/0 (true compare)
```
Expected: `168 passed`. Golden diff (if any) is one surface, one shared cause (L-053).

- [ ] **Step 4: Live preview round-trip** (preview MockBridge): copy an emitter →
  right-click another root → `Paste As ▸ Lifetime Child` → a lifetime child appears
  under it; reopen the menu → "Lifetime Child" is now greyed, "Death Child" still
  enabled; with nothing copied the `Paste As` trigger is greyed. Screenshot.
  (Not a drag feature; preview click/eval navigation is fine — L-067 N/A.)

- [ ] **Step 5: Commit** (only if goldens changed):

```bash
git add web/apps/editor/tests/a11y-goldens
git commit -m "test(a11y): re-baseline goldens for Paste As context submenu"
```

---

## Task 6: Docs + integrate

- [ ] **Step 1: CHANGELOG.md** — new top entry (lt-4 TODO-hash convention): what ships
  (Paste As ▸ Lifetime/Death Child in the tree context menu, gated on slot-free +
  clipboard), how tackled (new `emitters/paste-as-child` host+mock command reusing
  paste-deser + add-child attach), issues (first-buffer-only on multi-clipboard;
  golden re-baseline).

- [ ] **Step 2: tasks/ui-delta-report.md** — move SEL-5/MNU-4 (Paste-As-Child) out of
  the "Genuinely still open" table into the "Already shipped" prose list (dated).

- [ ] **Step 3: tasks/fix-plan.md** — note SEL-5/MNU-4 Paste-As-Child shipped under P4
  (clipboard/context-menu track).

- [ ] **Step 4: tasks/HANDOFF.md** — session 22 entry (commits, verification, native
  lane state, next options: VPT-2 follow-up / wrap).

- [ ] **Step 5: Commit docs, then FF-push** (after user OK — outward-facing):

```bash
git add CHANGELOG.md tasks/ui-delta-report.md tasks/fix-plan.md tasks/HANDOFF.md
git commit -m "docs: Paste As > Child shipped (SEL-5/MNU-4) + session-22 handoff"
git branch -f lt-4 HEAD && git push origin lt-4   # FF-only
```

---

## Verification summary (the bar for "raise for review")

- Web: `test` all green (502 + ~7 new), `tsc --noEmit` 0.
- mock-state helper: 5 unit tests (free/occupied/empty/unknown × life/death).
- MockBridge: round-trip + empty-clipboard refusal.
- Native: `.sln` Debug x64 clean; `pnpm build` + grep guard; `a11y:update` golden diff
  reviewed (surgical or none); `test:native` **168/0**.
- Live: preview round-trip + greying behaviour screenshotted.
- Docs updated; FF-push gated on user OK.
