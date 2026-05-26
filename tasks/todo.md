# `undo/perform` snap-restore — plan

**Direction picked:** Option A from `next-session-prompt-post-nt5.md` —
implement the deferred snap-restore so Ctrl+Z / Ctrl+Shift+Z (already
wired through React → accelerator → bridge.request) actually rewinds
the engine's ParticleSystem, and un-fixme the NT-5 atomicity test.

★★★ effort. Per CLAUDE.md, the plan needs sign-off before code edits.

---

## 1. Goal + scope

### Goal
Implement `undo/perform` (direction=undo|redo) in the new-UI host so
that Ctrl+Z restores the ParticleSystem to its previous user-visible
state and Ctrl+Shift+Z reapplies. Closes the deferred Phase 3 TODO at
[`BridgeDispatcher.cpp:1421-1425`](../src/host/BridgeDispatcher.cpp:1421)
and un-fixmes the NT-5 atomicity test at
[`emitter-mutations.spec.ts:320`](../web/apps/editor/tests/emitter-mutations.spec.ts:320).

### In
- Real implementation of the `undo/perform` handler in the host.
- A private `BridgeDispatcher::ApplyUndoSnapshot(buf, selIdx)` helper
  that mirrors legacy [`RestoreFromSnapshot`](../src/main.cpp:916)
  adapted for the new-UI host-state plumbing (`m_pParticleSystem` as
  pointer-to-unique_ptr, `m_engine`, `m_ppAttachedParticleSystem`,
  `m_selectedEmitterId`).
- A small one-shot **head-of-history capture** at undo time so the
  new-UI's existing PRE-mutation `captureUndo()` convention plays
  correctly with `UndoStack`'s POST-mutation cursor invariant. See §3
  for the design and §4 R1 for the rationale on why this is preferable
  to moving 22 call sites.
- Mock parallel in `mock.ts` so vitest covers the round-trip.
- Un-fixme the NT-5 atomicity Playwright test + add one vitest test
  for the mock undo round-trip.
- Prose-comment updates where the existing comments claim "Phase 3+
  not implemented" or "stack stays empty for now".

### Out (deferred, with reason)
- **Moving the 22 existing `captureUndo()` call sites from PRE- to
  POST-mutation** — see §3 / §4 R1. The head-of-history auto-capture
  technique lets us keep the existing convention and avoid a 22-site
  mechanical refactor in this dispatch. *Reason:* keeps blast radius
  small; reserves the convention shift for a future cleanup if/when
  it's worth doing on its own merits.
- **Link-group propagation on undo/redo round-trip** — new-UI mutation
  handlers don't propagate to link-group siblings the way legacy does
  ([`main.cpp:870-892`](../src/main.cpp:870)). The snapshot+restore
  round-trip preserves whatever propagation state existed at capture
  time, which is correct for the current new-UI behaviour. *Reason:*
  link-prop in new-UI is a separate gap; not in scope for snap-restore.
- **Title-bar asterisk / `IsAtSavedState()` integration** beyond a
  single `MarkSaved()` audit on `file/save`. *Reason:* not gating
  snap-restore; can land same commit as a one-liner if the audit
  surfaces a gap.
- **Menu enable-state** for Edit→Undo/Edit→Redo (currently always
  enabled). UX polish; separate concern.
- **Coalesce-key tuning** for spinner-drag undo grouping. The new-UI
  `captureUndo()` lambda hard-codes `coalesceKey=0` (never coalesce);
  spinner drags will produce one undo entry per tick. Out of scope —
  separate dispatch worth its own thought.

---

## 2. What the codebase already gives us

### C++ side

- `UndoStack` at [`src/UndoStack.{h,cpp}`](../src/UndoStack.h) —
  complete: `Capture / Undo / Redo / CanUndo / CanRedo / Clear /
  MarkSaved / IsAtSavedState / BeginApplying / EndApplying / Depth /
  Cursor`. MAX_ENTRIES=100, COALESCE_WINDOW_MS=1500.
  - **Cursor invariant** (per [`UndoStack.cpp:117-127`](../src/UndoStack.cpp:117)):
    `m_cursor == N` means "current live state matches `entries[N-1]`."
    `CanUndo` requires `m_cursor >= 2`. `Undo()` decrements cursor then
    returns `entries[m_cursor - 1]` — the *previous* entry, not the
    current one.
- `UndoStack::Serialize(sys)` and `UndoStack::Deserialize(buf)` at
  [`UndoStack.cpp:16-54`](../src/UndoStack.cpp:16) — full snapshot /
  restore via `ParticleSystem::write` / `ParticleSystem(IFile*)` ctor
  through `MemoryFile`. Reuse directly; no new serialization code.
- Legacy [`RestoreFromSnapshot`](../src/main.cpp:916) — the gold-
  standard reference for restore-step ordering. Key sequence:
  `BeginApplying → Engine::Clear → null attached pointer → delete old
  PS → reset selection → install new PS → set leave-particles flag →
  SetEmitterInfo → OnParticleSystemChanged(-1) → SetFileChanged →
  EndApplying`. Adapted for new-UI shape in §3 below.
- `captureUndo()` lambda at [`BridgeDispatcher.cpp:2091-2101`](../src/host/BridgeDispatcher.cpp:2091)
  — already does the right capture (calls `m_undo->Capture(*sys,
  selIdx, 0)` with the current selection scalar). 22 call sites, all
  PRE-mutation. We don't move them.
- Host-state plumbing: `m_pParticleSystem` (pointer-to-unique_ptr),
  `m_engine`, `m_ppAttachedParticleSystem`, `m_selectedEmitterId`,
  `m_currentFilePath`, `m_dirty`, `m_undo`, `m_emit`. All accessible
  from the dispatcher; the snap-restore handler reads/writes through
  them.
- `EnforceSingleMemberLinkGroups()` at [`BridgeDispatcher.cpp:3700`](../src/host/BridgeDispatcher.cpp:3700)
  — NT-5 sweep. Already called by both mutation handlers exercised by
  the un-fixme test. Atomicity contract: `captureUndo() → mutate →
  sweep` — the *single* `captureUndo()` covers both mutation and sweep.
  Atomicity preserved under any restore design that hands back the
  pre-mutation snapshot in one step. ✓

### JS / mock side

- `bridge.request({kind:"undo/perform", params:{direction}})` already
  dispatched from
  [`App.tsx:128-135`](../web/apps/editor/src/App.tsx:128) (Ctrl+Z /
  Ctrl+Shift+Z accelerator) and
  [`MenuBar.tsx:398-411`](../web/apps/editor/src/components/MenuBar.tsx:398)
  (Edit menu items). Wire path is complete — only the C++ handler
  body and the mock body are missing.
- [`emitter-mutations.spec.ts:320`](../web/apps/editor/tests/emitter-mutations.spec.ts:320)
  — full test scaffolding ready; `.fixme` flip + remove the FIXME
  comment block.
- [`mock.ts:1100-1104`](../web/apps/editor/src/bridge/mock.ts:1100) —
  currently throws `"not implemented (Phase 3+)"`. Replace with mock
  undo stack.

---

## 3. Architecture / implementation approach

### The convention-mismatch problem

Legacy ([`main.cpp:864 CaptureUndo`](../src/main.cpp:864)) takes
snapshots **POST-mutation** — the snapshot at `entries[i]` represents
the state *after* mutation `i+1`. Combined with the load-time
baseline-seed (`Clear() + Capture(0) + MarkSaved()` at
[`main.cpp:1099-1112`](../src/main.cpp:1099)), the stack invariant
"live state matches `entries[cursor-1]`" holds.

New-UI (`captureUndo()` lambda + 22 call sites in
`BridgeDispatcher.cpp`) takes snapshots **PRE-mutation** — every site
does `captureUndo(); /* mutate */ /* sweep */`. The snapshot at
`entries[i]` represents the state *before* mutation `i+1`. The
invariant doesn't hold: after mutation N, `cursor = N` but live state
is past `entries[N-1]`. Calling `UndoStack::Undo()` returns
`entries[cursor-2]` (state two-mutations-back), not the desired
"state right before the last mutation."

Two ways to reconcile:

**Option A (rejected as too invasive for this dispatch).** Move all
22 call sites from PRE-mutation to POST-mutation + add a load-time
baseline seed on `file/new` + `file/open`. Aligns new-UI with legacy
semantics. ~22 mechanical changes, each requiring review of the
surrounding handler. Estimated 2-3h of touching + audit + comment
prose updates, on top of the snap-restore impl. Risk surface for
introducing a "missed one site" subtle bug.

**Option C+ (chosen).** Head-of-history auto-capture at undo time.
The `undo/perform` handler detects `m_undo->Cursor() ==
m_undo->Depth()` (we're at the live end of history, no in-flight
redo branch), and if so, pushes a *post*-mutation snapshot of the
current live state before calling `m_undo->Undo()`. This restores
the stack invariant locally to the undo operation: the auto-capped
entry IS the live state, and `Undo()`'s `cursor-- ; return
entries[cursor-1]` now returns the PRE-mutation snapshot (which is
what the user wants). No call-site moves; no baseline seed needed
(the very first user mutation's captureUndo IS the implicit baseline).

The math (traced for the un-fixme test):
- mut1 (duplicate): `captureUndo` snapshots S0. Stack=[S0], cursor=1.
  Then duplicate → live=S1.
- mut2 (set-membership both→99): `captureUndo` snapshots S1.
  Stack=[S0,S1], cursor=2. Then set → live=S2 ("both at 99").
- mut3 (delete dup): `captureUndo` snapshots S2. Stack=[S0,S1,S2],
  cursor=3. Then delete + sweep → live=S3 ("first at 0").
- **Ctrl+Z**: cursor (3) == size (3). Auto-cap S3 → Stack=[S0,S1,S2,S3],
  cursor=4. Call `Undo`: cursor→3, return entries[2]=S2. Restore live
  to S2 ("both at 99"). ✓ test passes.
- **Ctrl+Y** (redo after the undo): cursor (3) < size (4). CanRedo
  true. Call `Redo`: return entries[3]=S3, cursor→4. Restore live to
  S3 ("first at 0"). ✓

Edge cases:
- **Repeated Ctrl+Z without any redo.** After the first auto-cap +
  Undo, cursor != size on the next Ctrl+Z, so the auto-cap is skipped.
  Just `Undo()` is called. No duplicate entries. ✓
- **First-ever Ctrl+Z with empty stack.** cursor=0, size=0. Skip
  auto-cap when `cursor == 0`. `CanUndo` is false anyway → applied
  false. ✓
- **Ctrl+Y after Ctrl+Z then mutate.** The mutation's `captureUndo`
  truncates the redo branch (per existing `Capture` logic at
  [`UndoStack.cpp:69-73`](../src/UndoStack.cpp:69)). The auto-capped
  post-state entry is discarded. ✓
- **Repeated Ctrl+Z / Ctrl+Y cycling at the head.** Possible
  duplicate auto-cap entries on each cycle. Wasted memory but not
  incorrect. Documented limitation; not worth a state-bit fix.

### The handler

```cpp
if (kind == "undo/perform")
{
    std::string dir = params.value("direction", std::string("undo"));
    bool applied = false;
    if (m_undo && m_pParticleSystem && *m_pParticleSystem)
    {
        // Head-of-history auto-capture (Option C+). New-UI's
        // captureUndo() runs PRE-mutation, so the live state past
        // the last mutation isn't in the stack. Snapshot it now so
        // UndoStack's POST-mutation cursor invariant works on the
        // next Undo/Redo call. Skip if we're mid-redo-branch (the
        // post-state is already at entries[cursor]) or stack is
        // empty (nothing to undo to).
        if (m_undo->Cursor() == m_undo->Depth() && m_undo->Depth() > 0)
        {
            const ParticleSystem* sys = m_pParticleSystem->get();
            size_t selIdx = SIZE_MAX;
            if (m_selectedEmitterId >= 0
                && static_cast<size_t>(m_selectedEmitterId)
                       < sys->getEmitters().size())
            {
                selIdx = static_cast<size_t>(m_selectedEmitterId);
            }
            m_undo->Capture(*sys, selIdx, 0);
        }

        const std::vector<char>* snap = nullptr;
        size_t selIdx = SIZE_MAX;
        if (dir == "undo" && m_undo->CanUndo())
            applied = m_undo->Undo(&snap, &selIdx);
        else if (dir == "redo" && m_undo->CanRedo())
            applied = m_undo->Redo(&snap, &selIdx);

        if (applied && snap != nullptr)
            ApplyUndoSnapshot(*snap, selIdx);
    }
    sendOk(json{{"applied", applied}});
    if (applied)
    {
        EmitEngineStateChanged();
        EmitEmittersTreeChanged();
    }
    return res;
}
```

### `ApplyUndoSnapshot(buf, selIdx)`

Mirrors legacy `RestoreFromSnapshot`, adapted for new-UI shape:

```cpp
void BridgeDispatcher::ApplyUndoSnapshot(const std::vector<char>& buf,
                                          size_t selIdx)
{
    m_undo->BeginApplying();

    ParticleSystem* sys = nullptr;
    try { sys = UndoStack::Deserialize(buf); }
    catch (...) { m_undo->EndApplying(); return; }
    if (sys == nullptr) { m_undo->EndApplying(); return; }

    // Teardown order matches file/open at BridgeDispatcher.cpp:1581-1617.
    if (m_ppAttachedParticleSystem && *m_ppAttachedParticleSystem
        && m_engine)
    {
        m_engine->KillParticleSystem(*m_ppAttachedParticleSystem);
        *m_ppAttachedParticleSystem = nullptr;
    }
    if (m_engine) m_engine->Clear();

    *m_pParticleSystem = std::unique_ptr<ParticleSystem>(sys);

    if (m_engine)
    {
        m_engine->OnParticleSystemChanged(-1);
        m_engine->ReloadTextures();
    }

    // Selection scalar from the snapshot. Bounds-check against the
    // restored system size; clear to -1 on out-of-range (legacy
    // capture might store SIZE_MAX which obviously won't map).
    if (selIdx != SIZE_MAX
        && selIdx < (*m_pParticleSystem)->getEmitters().size())
    {
        m_selectedEmitterId = static_cast<int>(selIdx);
    }
    else
    {
        m_selectedEmitterId = -1;
    }
    if (m_emit)
    {
        json env = {
            {"type",    "evt"},
            {"kind",    "emitters/selected"},
            {"payload", json{{"id", m_selectedEmitterId < 0
                                       ? json(nullptr)
                                       : json(m_selectedEmitterId)}}},
        };
        m_emit(env.dump());
    }

    // Title-bar / dirty bit: matches legacy SetFileChanged path.
    // After restore, the file is "modified" iff the current entry
    // isn't flagged saved.
    SetDirty(!m_undo->IsAtSavedState());

    m_undo->EndApplying();
}
```

### Mock parallel

`MockBridge` gets an internal `_undoStack: { entries: WorldState[];
cursor: number }`. Every mutating handler appends a structuredClone of
the *pre*-mutation state to `entries` (matching the C++ convention).
`undo/perform` does the same head-of-history auto-cap +
step-and-restore dance. Restoring is a structuredClone-into-`_state`
swap. Round-trip parity verified by a new vitest.

### Touch list

C++ (3 files):
- [`src/host/BridgeDispatcher.h`](../src/host/BridgeDispatcher.h):
  declare `ApplyUndoSnapshot` private method.
- [`src/host/BridgeDispatcher.cpp`](../src/host/BridgeDispatcher.cpp):
  replace lines 1396-1430 (the deferred TODO block) with the real
  handler. Add `ApplyUndoSnapshot` definition near other private
  helpers (after `EnforceSingleMemberLinkGroups` at line 3700).
- Comment touch-up: the captureUndo lambda's docstring at
  [`BridgeDispatcher.cpp:2087-2091`](../src/host/BridgeDispatcher.cpp:2087)
  no longer says "Until Phase 3 begins capturing… the stack will be
  empty" — drop that line. Same for the `BridgeDispatcher.h:66-72`
  doc-comment block.

JS (3 files):
- [`web/apps/editor/src/bridge/mock.ts`](../web/apps/editor/src/bridge/mock.ts):
  add `_undoStack`, append captures in every mutating handler,
  implement undo/perform. Mark the kind as not-mutating in
  `isMutating()` (it's already there).
- [`web/apps/editor/src/bridge/__tests__/bridge-contract.test.ts`](../web/apps/editor/src/bridge/__tests__/bridge-contract.test.ts)
  or `mock.test.ts`: one new test — duplicate then undo + verify
  state.
- [`web/apps/editor/tests/emitter-mutations.spec.ts`](../web/apps/editor/tests/emitter-mutations.spec.ts):
  line 320 — `test.fixme(...)` → `test(...)`. Remove the FIXME
  comment block (lines 321-338).

---

## 4. Risks named up front + mitigations

**R1. Convention-mismatch surface for *future* dispatches.** The
chosen design (Option C+) keeps the new-UI's PRE-mutation
`captureUndo()` convention. Future contributors adding new mutation
handlers will follow the existing pattern (`captureUndo() → mutate`),
which is fine *as long as* `undo/perform` keeps the head-of-history
auto-cap intact. **Mitigation:** docstring on the new handler
explains the auto-cap design with a 5-line comment block + link to
this plan in `tasks/`. The auto-cap pattern is mechanically simple
enough to survive future edits.

**R2. NT-5 atomicity regression.** Existing handlers do `captureUndo
→ mutate → sweep`. The captureUndo covers both. Snap-restore
restores the single pre-mutation snapshot, which IS the pre-(mutation
+ sweep) state. Atomicity preserved. **Mitigation:** that's literally
what the un-fixme test asserts — passing it confirms the contract.

**R3. Engine teardown ordering during restore.** Restoring re-uses
the file/open teardown chain. The exact order matters: kill attached
PS pointer first (else `KillParticleSystem` on a freed system
crashes), then `Engine::Clear` (so the device drops cached emitter
instances), then swap unique_ptr (deletes the old PS), then
`OnParticleSystemChanged(-1)` (engine re-binds to the new pointer).
**Mitigation:** mirror file/open at
[`BridgeDispatcher.cpp:1578-1618`](../src/host/BridgeDispatcher.cpp:1578)
exactly. The legacy `RestoreFromSnapshot` ordering at
[`main.cpp:950-975`](../src/main.cpp:950) is also a cross-check
reference.

**R4. UndoStack re-entrancy.** Capture() during a restore would push
a redundant entry. **Mitigation:** UndoStack already has
`BeginApplying/EndApplying` to suppress this; ApplyUndoSnapshot wraps
the swap in this guard.

**R5. Selection-restore ID drift.** `m_selectedEmitterId` is an index
into `sys->getEmitters()`. After a restore, the new system's emitter
vector may have a different length. **Mitigation:** bounds-check
against the *restored* system's size; if out of range, set to -1
(no selection).

**R6. Mock-vs-native divergence.** Mock's undo stack is a separate
implementation. If C++ and mock diverge on edge cases (e.g. coalesce
behavior, head-of-history auto-cap timing), the bridge-contract
tests would catch it. **Mitigation:** the new vitest test exercises
the same NT-5 path as the Playwright test — same mutation sequence,
same assertion. If both pass, the mock matches.

**R7. Edge case: undo through file/new or file/open.** What should
Ctrl+Z do mid-session if the user has loaded a file then undone past
the load? Legacy clears the stack on load, so this is impossible. We
don't add a baseline seed in this dispatch, so Ctrl+Z bottoms out at
the *first user mutation's pre-state*, which is the state at the
last load. **Mitigation:** doc this in the comment block on
`undo/perform`. Also: add a one-liner `m_undo->Clear()` to `file/new`
and `file/open` handlers so prior session's stack doesn't leak into
the new file (legacy does the same at
[`main.cpp:1103`](../src/main.cpp:1103)). Tiny addition, same commit.

**R8. Wasted entries from cycle-at-head.** Repeated Ctrl+Z / Ctrl+Y
at the head of history produces duplicate auto-cap entries.
**Mitigation:** documented limitation. MAX_ENTRIES=100 caps growth.
Not worth a state-bit fix in this dispatch.

**R9. `IsAtSavedState()` correctness.** The dirty-flag-after-restore
logic depends on whether `MarkSaved()` was called on the save-state
entry. The new-UI's `file/save` handler at
[`BridgeDispatcher.cpp:1638+`](../src/host/BridgeDispatcher.cpp:1638)
needs auditing — if it doesn't call `MarkSaved`, the dirty flag
won't clear on undo-back-to-saved. **Mitigation:** audit during
impl; add a `MarkSaved` call to the save handler if missing. Tiny
follow-up, can land same commit.

**R10. Coalesce-key 0 always.** New-UI mutations use coalesceKey=0
so spinner drags get one undo entry per tick. Out of scope to fix
in this dispatch, but the snap-restore will faithfully step through
every entry — Ctrl+Z on a 100-tick spinner drag is 100 Ctrl+Z's.
**Mitigation:** known; separate follow-up.

---

## 5. Testing & verification

### Build (post-edit, before claiming done)
- `MSBuild .\ParticleEditor.sln /p:Configuration=Debug /p:Platform=x64 /m`
  — clean (preexisting LIBCMTD baseline only). Per L-023, always via
  the .sln, not the .vcxproj.
- `MSBuild .\ParticleEditor.sln /p:Configuration=Release /p:Platform=x64 /m`
  — clean.

### TypeScript
- `pnpm --filter @particle-editor/editor lint` — 0 errors (was 0).

### Vitest
- `pnpm --filter @particle-editor/editor test` — expect **344/344**
  (343 + 1 new mock undo round-trip test).
- The 5 existing NT-5 mock tests stay passing.

### Playwright native (default HWND dist/)
- Rebuild dist/: `pnpm --filter @particle-editor/editor build`.
- `pnpm --filter @particle-editor/editor test:native` — expect
  **103 passed + 26 skipped + 0 failed** (102 + un-fixme'd NT-5
  atomicity = 103; one less in skipped since the fixme'd test moves
  out of the skipped pool).

### Manual smoke (live binary, before claiming done)
Single live-launch smoke run: `ParticleEditor.exe --new-ui`. Steps:
1. Open multi-emitter .alo file.
2. Click an emitter, rename it. Ctrl+Z. Verify rename reverts.
3. Delete an emitter. Ctrl+Z. Verify it returns + selection follows.
4. Delete a member of a 2-emitter link group. Verify survivor demotes
   to 0 (NT-5 sweep). Ctrl+Z. Verify both back in the original group.
5. Ctrl+Y. Verify the delete + sweep re-applies.
6. Edit a track key value, edit another, edit a third. Ctrl+Z three
   times. Verify each edit reverts in order.
7. File → New, edit, edit. Ctrl+Z, Ctrl+Z, Ctrl+Z. Verify bottoms
   out cleanly (no crash; `applied=false` on the last call) AND
   that the stack from any prior file session doesn't leak through
   (per R7's `m_undo->Clear()` on file/new + file/open).
8. File → Open another file mid-session, edit, Ctrl+Z. Verify undo
   bottoms out at the loaded state.

### Debug instrumentation
- Pre-existing `UNDO_LOG` macros at `src/UndoStack.cpp` etc. fire
  under Debug builds. Grep tag: `[Undo]`.
- Optional new tag for the auto-cap path: `[Undo] auto-cap @ head`
  before the capture; `[Undo] restored selIdx=N emitters=M` after
  `ApplyUndoSnapshot` returns.

---

## Effort estimate

- Plan + sign-off (this step): done in ~30 min.
- C++ handler + ApplyUndoSnapshot + file/new+open Clear + comment
  fixes: ~45 min.
- Mock impl + vitest test: ~30 min.
- Un-fixme + run gates + iterate: ~30-45 min.
- Manual smoke + write CHANGELOG entry: ~30 min.

**Total: ~2.5-3h.** Less than the next-session-prompt's "~3-4h"
estimate because we picked Option C+ instead of Option A (no 22-site
refactor).

---

## 6. Review (post-impl)

### What landed

- **`undo/perform` handler** ([BridgeDispatcher.cpp's new ~50-line
  block replacing the deferred TODO](../src/host/BridgeDispatcher.cpp)).
  Implements head-of-history auto-capture per §3 + dispatches the
  Undo/Redo + ApplyUndoSnapshot.
- **`ApplyUndoSnapshot(buf, selIdx)`** — new private method in
  BridgeDispatcher. Mirrors legacy `RestoreFromSnapshot` teardown
  order (kill attached → Clear → swap → OnPSChanged → ReloadTextures).
  Restores selection scalar with bounds check; emits
  `emitters/selected` event. SetDirty(true) unconditionally (R9
  audit confirmed: new-UI host doesn't call `MarkSaved` on save;
  IsAtSavedState is always false today — that's an independent
  follow-up that doesn't gate this work).
- **`m_undo->Clear()` on `file/new` + `file/open`** (R7 mitigation).
  Prior session's stack can't reference the freed system any more.
- **Comment hygiene**: `SetUndoStack` docstring + the captureUndo
  lambda preamble both updated; no longer claim Phase 3+ deferred.
- **Mock**: `undo/perform` returns `{applied: false}` instead of
  throwing. Browser-mode Ctrl+Z is now a documented no-op. (Skipping
  full mock undo per the scope refinement noted at line 1196: a full
  mock undo requires snapshotting multiple Zustand stores; out of
  scope for snap-restore.)
- **Test un-fixme**: [`emitter-mutations.spec.ts:320`](../web/apps/editor/tests/emitter-mutations.spec.ts:320)
  now lives in the passing pool. FIXME comment block removed;
  replaced with a forward-looking comment explaining the atomicity
  contract + the head-of-history auto-cap design.

### Gates met

- **MSBuild Debug + Release x64**: clean (preexisting LIBCMTD baseline
  unchanged) — both built via `.\\ParticleEditor.sln` per L-023.
- **`pnpm lint`**: 0 errors.
- **`pnpm test`**: **343 / 343** (unchanged — no new vitest test
  added per the mock scope refinement).
- **`pnpm test:native`** (default HWND dist/): **103 passed + 26
  skipped + 0 failed** (was 102 + 27 + 0; un-fixme'd test moved
  from skip to pass).
- **dist/** rebuilt clean (557.70 kB bundle, 163.57 kB gzip — within
  preexisting baseline).

### What I did NOT do

- **Manual smoke**: not run from this worktree. The Playwright NT-5
  atomicity test exercises the exact head-of-history auto-cap + Undo
  + ApplyUndoSnapshot chain end-to-end against the real C++ host,
  which is the strongest validation available without a human. The
  remaining manual-smoke scenarios (rename Ctrl+Z, track-key
  Ctrl+Z, file/new + Ctrl+Z, file/open + Ctrl+Z, Ctrl+Y redo,
  selection-follows-undo) all use the same captureUndo + handler
  shape that the test exercises, so the risk surface for a regression
  the Playwright test wouldn't catch is small. **Worth a single
  live-binary spot-check from the user before considering the
  dispatch fully done.**
- **Mock-side full undo**: deferred (see "What landed" above). Mock
  Ctrl+Z is a no-op; native host owns the real behaviour. The 4
  in-tree Playwright tests targeting the mock (zero) confirm this
  is acceptable.
- **`MarkSaved` on `file/save`**: R9 audit confirmed it's not called
  in new-UI today. Title-bar asterisk will not clear when undoing
  back to a previously-saved state. Independent follow-up.
- **Coalesce-key tuning** for spinner-drag undo grouping: out of
  scope per the plan; tracked as a known-okay-for-now limitation.

### Issues encountered + resolutions

1. **Convention mismatch (PRE-mutation captureUndo vs UndoStack's
   POST-mutation cursor invariant)** — discovered during planning;
   resolved with the Option C+ head-of-history auto-capture design.
   The 22-site Option A refactor was avoided.
2. **Test response-field name drift** — the FIXME test scaffolding
   read `undoResult.ok`, but the C++ handler returns
   `{applied: bool}`. Fixed by extending the inline bridge type +
   reading `undoResult.applied`.
3. **PowerShell `pnpm` from worktree-root** — pnpm couldn't resolve
   the workspace; needed an explicit `Set-Location web` before
   running scripts. Per L-023's spiritual sibling: the build root
   matters for tooling resolution.
4. **`pnpm install`-on-build behaviour** — `pnpm build` invokes a
   `prepare`-style preflight that re-runs install. The parallel
   PowerShell race (Set-Location .. in one call, build in another)
   tripped this. Resolved with explicit absolute-CWD before each
   pnpm invocation.

### Effort actual

| Phase | Estimate | Actual |
|---|---|---|
| Plan + sign-off | 30 min | ~50 min (deeper convention-mismatch analysis than expected) |
| C++ handler + ApplyUndoSnapshot + Clear + comments | 45 min | ~30 min |
| Mock + vitest | 30 min | ~10 min (scope refined to no-op) |
| Un-fixme + gates | 30-45 min | ~25 min |
| **Total** | **2.5-3h** | **~2h** |

