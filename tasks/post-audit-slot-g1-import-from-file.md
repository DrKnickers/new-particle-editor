# G1 — `emitters/import-from-file` native handler (LT-4)

> **✅ SHIPPED 2026-06-01 (lt-4).** Implemented as planned: shared
> `ParticleSystem::ImportEmittersFrom` + the bridge handler + legacy delegate, all
> exactly the "keep legacy behaviour" shape. Test-first via `emitter-import.spec.ts`
> (a11y, real host) incl. an atomic-undo assertion. Verified: a11y 155 passed (only
> the 4 splitters L-033 artifacts fail), vitest 386, Debug+Release clean. The plan
> below is retained as the design record. **Open follow-up:** a `--legacy-ui` import
> regression spot-check (the refactor delegates to the same tested core, so low risk).

Audit finding **G1** ([post-audit-followups.md](post-audit-followups.md)). Deferred
from the Slot-5 bridge-contract PR ([post-audit-slot5-lt4-bridge-contract.md](post-audit-slot5-lt4-bridge-contract.md))
pending the design questions below — all now **answered by the working legacy
`DoImportEmittersFromFile`**, so this is ready to implement.

## 1. Goal + scope
The new-UI **Import Emitters** dialog can browse a source `.alo` and preview its
emitter tree, but clicking **"Import N selected"** fails: `emitters/import-from-file`
has **no native dispatcher handler** (verified 2026-06-01, 0 hits in
`BridgeDispatcher.cpp`), so it hits the not-implemented branch → the modal shows an
inline error ([ImportEmittersDialog.tsx:137-144](web/apps/editor/src/screens/ImportEmittersDialog.tsx:137)).
This is a user-visible broken path on a shipped UI surface.

**In:** implement the `emitters/import-from-file` handler so selected emitters from
another `.alo` are cloned into the live system, with correct parent/child rebind,
link-group recreation, undo, dirty-flag, and a tree-changed event. Reuse the legacy
import logic by **extracting it to the data layer** so both UIs share one
implementation.
**Out:** changes to the preview path (`emitters/preview-from-file` already works);
the dialog UI (already shipped); the other deferred bridge item G3 (separate); a
redesign of the import UX (subtree vs roots is already settled — see §4).

## 2. What the codebase already gives us
- **Source-file load:** `LoadParticleSystem(path, &err)` — already used by the preview
  handler ([BridgeDispatcher.cpp:2189](src/host/BridgeDispatcher.cpp:2189)). Reuse verbatim.
- **The complete import core, working, in legacy:** `DoImportEmittersFromFile` +
  helpers ([main.cpp:7115-7340](src/main.cpp:7115)). Given a source `ParticleSystem`
  and `picks` (selected source indices) it:
  1. **Pass 1** — clones each pick as a root via `MemoryFile` + `ChunkWriter` →
     `Emitter::copy(w)` (copy=true strips runtime/link state) → `ChunkReader` →
     `Emitter{r}` → `addRootEmitter`; builds a `srcToDest` index map.
  2. **Pass 2** — re-maps `spawnOnDeath`/`spawnDuringLife` through `srcToDest`
     (links to non-picked children fall to `-1`).
  3. **`ValidateEmitterGraph()`** (audit-F4) — rebuilds parents, drops self/dup/cyclic
     links the remap could introduce.
  4. **Pass 3** — recreates source link groups: bucket picks by source `linkGroup`,
     ≥2-member buckets get a fresh `CreateLinkGroup`.
- **Live-system pointer in the host:** `m_pParticleSystem` (pointer-to-`unique_ptr`),
  plus `captureUndo()`, the dirty/`engine-state` plumbing, and the `emitters/*`
  handler patterns already in `BridgeDispatcher.cpp`.
- **Schema already declares both kinds** ([bridge-schema/src/index.ts:555-556](web/packages/bridge-schema/src/index.ts:555));
  response is `{ imported: number }`. The mock handles import
  ([mock.ts](web/apps/editor/src/bridge/mock.ts)); a `bridge-contract` test asserts the
  shape.

## 3. Architecture / approach
**Extract, don't duplicate.** The import core is pure data-layer logic (clone /
rebind / validate / link-group), currently trapped as a static function in `main.cpp`
which the host doesn't link. Lift it onto `ParticleSystem` so both UIs call one impl:

```cpp
// ParticleSystem.h / .cpp  (sits next to ValidateEmitterGraph — F4)
// Clone `picks` (indices into `source`) into this system as new roots,
// remapping spawn links among the picked set, revalidating the graph,
// and recreating multi-member source link groups. Returns the count
// actually imported. Does NOT touch undo / dirty / events — callers own
// those (legacy via its WM_COMMAND path, host via the bridge handler).
size_t ParticleSystem::ImportEmittersFrom(const ParticleSystem& source,
                                          const std::vector<size_t>& picks);
```

- Move Passes 1–3 + the `ValidateEmitterGraph()` call out of `DoImportEmittersFromFile`
  into `ImportEmittersFrom`; the legacy function becomes *load file → collect picks
  from the tree → call `ImportEmittersFrom` → its existing post-update UI refresh*.
  (`GenerateDuplicateName` is UI-adjacent but already callable from the data layer;
  if not, pass a name-uniquifier or inline the dedupe.)
- **New handler** in `BridgeDispatcher.cpp` (beside `preview-from-file`):
  ```
  if (kind == "emitters/import-from-file") {
    parse {path, selected[]};  guard path non-empty, selected non-empty
    if (!m_pParticleSystem || !*m_pParticleSystem) → sendErr
    tmp = LoadParticleSystem(path,&err);  if(!tmp) → sendOk{ok:false,error}
    captureUndo("Import emitters");                         // single undo unit
    size_t n = (*m_pParticleSystem)->ImportEmittersFrom(*tmp, selected);
    MarkDirty(); EmitEmittersTreeChanged(); EmitEngineStateChanged() as needed;
    sendOk({ imported: n });
  }
  ```
  Match the surrounding handlers' exact `sendOk`/`sendErr` + event names (mirror
  `emitters/duplicate` / `emitters/delete`, which already capture undo + emit the
  tree-changed event).

**Resolved slot-5 open questions** (answers come from the legacy impl, not invention):
- *Subtree vs roots?* Import each pick as a **root**; picked children rebind to picked
  parents, non-picked links drop to `-1`. The dialog's auto-include-children already
  makes "select a parent" pull its subtree into `picks`.
- *Cross-document link-group IDs?* **Renumber** — Pass 3 mints fresh destination groups
  per multi-member source bucket; singletons arrive unlinked.
- *Undo granularity?* **One** `captureUndo` for the whole import (atomic).
- *Emit tree-changed?* **Yes** — plus dirty; the tree + inspector re-fetch.

## 4. Risks + mitigations
1. **`main.cpp`-only symbols in the extracted core** (`GenerateDuplicateName`,
   `addRootEmitter`, `CreateLinkGroup`). *Mitigation:* `addRootEmitter`/`CreateLinkGroup`
   are already `ParticleSystem` members (data layer). `GenerateDuplicateName` reads the
   live system's names — move it (or a minimal equivalent) into `ParticleSystem`, or
   accept a `std::function<std::wstring(std::wstring)>` uniquifier param so the legacy
   caller keeps its exact behaviour. Verify by building **both** `main.cpp` and the host.
2. **Behaviour drift from legacy after extraction.** Refactor risk — the legacy import
   is user-trusted. *Mitigation:* pure move (no logic change); legacy path must produce
   identical results. Regression-check via the legacy `--legacy-ui` import + the a11y
   `emitter-mutations` suite.
3. **Hostile / mismatched source file.** Untrusted `.alo`. *Mitigation:* already
   covered — `LoadParticleSystem` runs the F2/F3/F4 hardened reader + `ValidateEmitterGraph`
   re-runs on the merged graph; out-of-range picks are skipped (`srcIdx >= size()`).
4. **Undo restore of a partial import.** *Mitigation:* single `captureUndo` *before*
   any mutation → undo removes the whole import atomically.

## 5. Testing & verification
- **vitest / contract:** the `bridge-contract` test already asserts the `import-from-file`
  response shape — flip it from "not implemented" to the real `{ imported }` (mirror how
  `preview-from-file` is asserted).
- **Native a11y (`pnpm a11y`, L-038):** add/extend an `emitter-mutations` spec that
  `file/open`s the base fixture, imports selected emitters from a second fixture, and
  checks the emitter-tree golden (count + parent rebuild + link-group recreation). The
  4 `splitters` failures remain the known L-033 artifact.
- **Legacy regression:** `--legacy-ui` → File → Import Emitters from a multi-emitter
  `.alo`; confirm identical to pre-refactor (tree, parents, link groups, names).
- **Build:** `.sln` Debug+Release x64 clean (both `main.cpp` and host compile the moved
  symbol); `pnpm --filter @particle-editor/editor build` clean.
- **User-driven (L-033):** in `--new-ui`, Import Emitters → browse a real `.alo` →
  preview tree → select a parent (+children) → Import → confirm they appear in the live
  tree with correct nesting + link groups, one undo reverts the whole import.

## Branch / sequencing
`[lt-4]`. Standalone PR (the slot-5 PR shipped G2+G4 without it). Order is flexible —
contained, no dependency on other open items. Per the followups "suggested ordering"
this slots into the LT-4 bridge follow-ups, but it stands alone.
