# Track-key undo coalescing — design (VPT-2 follow-up)

*2026-06-08 · new-particle-editor / lt-4 · native lane*

## 1. Goal + scope

Close the last open `ui-delta-report.md` item: the **VPT-2 follow-up**. Today,
streaming a curve key's **Time** / **Value** spinner — by wheel-spinning, hold-arrowing,
**or arrow-column scrub-dragging** (the Spinner fires `onChange` per pixel of scrub) —
records **one undo entry per tick**, and a multi-key group shift records **N entries per
tick** — because the host's `emitters/set-track-key` handler captures undo with
`coalesceKey = 0` (never coalesce). After this change, one such gesture collapses to
**one** undo step within a 1500 ms window, exactly matching the already-shipped
emitter-property spinner coalescing (the main VPT-2 work).

This is a "close out the item" task — match the shipped behavior, don't chase exotic
edge cases.

### In
- Host: `emitters/set-track-key` ([BridgeDispatcher.cpp:3594](../../src/host/BridgeDispatcher.cpp:3594))
  computes a **per-track, per-emitter** `coalesceKey` and passes it to the existing
  `captureUndo(coalesceKey)` lambda → routes to `UndoStack::CapturePreCoalesced`.
- Native CDP regression specs in `web/apps/editor/tests/undo-navigation.spec.ts`
  mirroring the shipped emitter cases (same-track fold / different-track separate /
  structural-op breaks the fold).

### Out (with reasons)
- **Every other track-mutating handler stays `coalesceKey = 0`** — namely
  `add-track-key`, `delete-track-keys`, `set-track-interpolation`, `set-track-lock`,
  **and** the two the original draft missed: `emitters/duplicate-with-index-increment`
  (shifts the TRACK_INDEX keys, capture at
  [BridgeDispatcher.cpp:3698](../../src/host/BridgeDispatcher.cpp:3698)) and
  `engine/action/rescale-emitter` (scales key times via `DoRescaleEmitter`, capture at
  [:3779](../../src/host/BridgeDispatcher.cpp:3779)). All six are click-discrete
  structural ops, not streaming edits; each must remain its own undo step (folding a
  duplicate/rescale/add into a prior move would be wrong). Legacy kept these
  uncoalesced too. **Only `set-track-key` gets the change.**
- **React-side changes** — none. The spinners already dispatch one `set-track-key` per
  tick; coalescing is purely a host-side undo-stack concern. Curve *drags* already
  commit once on release (`handleKeyDragEnd` / `handleGroupDragEnd`), so they are
  already one undo entry and need no change. (Both `CurveEditorPanel.tsx` and
  `screens/CurveEditor.tsx` are live but *cooperating*: the panel is the stateful
  parent that owns **all** bridge dispatches; `screens/CurveEditor.tsx → MultiChannelCurves`
  is its child renderer and dispatches **nothing**. The single-track `CurveEditor()`
  branch is dead in this app — the panel always supplies multi-channel props.)
- **A namespace bit to make track keys provably disjoint from property keys** — see
  Risk 1; the collision is astronomically unlikely with a benign worst case, and the
  shipped 31-bit layout leaves no spare bit. Explicitly accepted, not engineered around.
- **Per-key granularity** (a distinct undo step per curve key) — **a conscious
  divergence from the shipped emitter path's per-*field* keying, not "the only choice."**
  Per-key is genuinely *impossible* for the **Time** spinner, whose key identity
  (`oldTime`) changes every tick, so a per-key coalesce key would never match
  tick-to-tick and every tick would push. The **Value** spinner *does* hold a stable
  `oldTime` across ticks, so per-key would work there — but the per-key bit budget is
  tight (`oldTime` is a float needing its own hash + a fresh collision surface), and
  per-track is legacy-faithful (`track<<16|emitterIdx`) and a strict improvement over
  today's per-tick spam. So **v1 is per-track**, accepting that editing key A then key
  B on the same track within 1.5 s folds into one undo step (the cross-target fold the
  emitter path deliberately avoids). A finer Value-key scheme keyed on `oldTime` (Time
  staying per-track) is a clean follow-up if anyone asks — a ROADMAP note, not now.

## 2. What the codebase already gives us

Everything needed already exists; this is a one-line wiring change plus tests.

- **`captureUndo` lambda** ([BridgeDispatcher.cpp:2717](../../src/host/BridgeDispatcher.cpp:2717)) —
  takes an optional `DWORD coalesceKey`; `0` → `UndoStack::Capture` (never folds),
  non-zero → `UndoStack::CapturePreCoalesced`.
- **`UndoStack::CapturePreCoalesced`** ([UndoStack.cpp:126](../../src/UndoStack.cpp:126)) —
  PRE-mutation **skip**-coalescing: at head-of-history, a same-key entry inside
  `COALESCE_WINDOW_MS` (1500 ms) already holds the burst's pre-mutation state (the undo
  target), so it just slides the window; one Ctrl+Z then reverts the whole burst (the
  head-of-history auto-cap in `undo/perform` snapshots the final live state before
  stepping back). Mid-redo-branch it always pushes. This is the exact primitive the
  emitter-property path uses.
- **The emitter-property coalesce key** ([BridgeDispatcher.cpp:2914](../../src/host/BridgeDispatcher.cpp:2914)) —
  `0x80000000u | ((fieldHash & 0x7FFFu) << 16) | (id & 0xFFFFu)`. We mirror this bit
  layout, substituting `trackIdx` for `fieldHash`.
- **`set-track-key` handler** ([BridgeDispatcher.cpp:3544](../../src/host/BridgeDispatcher.cpp:3544)) —
  already computes `trackIdx` ([:3559](../../src/host/BridgeDispatcher.cpp:3559)) and
  reads `id` ([:3546](../../src/host/BridgeDispatcher.cpp:3546)) before the
  `captureUndo()` call ([:3594](../../src/host/BridgeDispatcher.cpp:3594)). No new
  plumbing.
- **Existing native undo specs** — `web/apps/editor/tests/undo-navigation.spec.ts`
  already drives the real host `UndoStack` over the `--test-host` CDP bridge and has
  same-field-folds / different-field-separate cases for the emitter path to copy.

## 3. Implementation approach

Single edit at [BridgeDispatcher.cpp:3594](../../src/host/BridgeDispatcher.cpp:3594),
replacing `captureUndo();` with:

```cpp
// Coalesce rapid same-track edits on the same emitter (a wheel-spun or
// held Time/Value key spinner, and the N per-key calls one group-shift
// issues) into a single undo step within the window. Per-TRACK keying —
// legacy's exact choice (track<<16|emitterIdx) and the only stable key
// for a Time spinner, whose oldTime moves every tick. Mirrors the
// emitter-property layout above (bit 31 set so it's never 0 = structural).
const DWORD coalesceKey =
    0x80000000u | ((static_cast<DWORD>(trackIdx) & 0x7FFFu) << 16)
                | (static_cast<DWORD>(id) & 0xFFFFu);
captureUndo(coalesceKey);
```

`trackIdx` is `>= 0` here (the handler already returned on `trackIdx < 0`), and `id`
is the validated emitter id. No other handler changes.

**Why this collapses the group shift too:** `applyGroupShift`
([CurveEditorPanel.tsx:898](../../web/apps/editor/src/components/CurveEditorPanel.tsx:898))
issues N ordered `set-track-key` calls for one tick — all same emitter, same track →
same key. The first call pushes the pre-gesture snapshot; calls 2..N (and every
subsequent tick's burst) slide the window. One undo reverts the entire gesture.

## 4. Risks named up front + mitigations

1. **Cross-type undo fold (accepted, not engineered around).** Track keys place
   `trackIdx` in the same bits 16..30 the emitter-property path fills with a 15-bit FNV
   hash. `trackNameToIndex` only ever returns **0–6** (`NUM_TRACKS = 7`: red, green,
   blue, alpha, scale, index, rotationSpeed), so a track key fills only bits **16..18** —
   bits 19..30 are *structurally zero* in every track key. A cross-type fold therefore
   requires the property field's 15-bit hash to land in `{0..6}` **and** the property
   and curve edits to be on the *same* emitter id within 1.5 s. Probability ≈ 7/32768 ≈
   **1/4681** per such adjacent cross-type pair (the always-zero high bits make it *much*
   rarer than a naive 1/32768). The worst outcome is one extra fold — verified benign:
   snapshots are whole-system and each entry carries its own `selectedIndex`, so a fold
   yields **no data loss, no wrong-selection restore, no corruption** (both edits revert
   together and redo replays both); the only effect is losing the ability to undo the
   two edits *separately*, and the next edit outside the window starts fresh. The shipped
   31-bit layout (bit 31 forced set, bits 0..30 otherwise fully used by hash + id) leaves
   no spare bit for a clean type tag without touching shipped code. Per the "don't chase
   edge cases" scope, this is explicitly accepted.

2. **Same-track folds across distinct gestures (consistent, not a regression).** Under
   per-track keying, a single `handleKeyDragEnd` commit followed by a spinner tick on the
   same track within 1.5 s folds into one undo — and likewise a **Time**-spinner tick
   then a **Value**-spinner tick on the same key (both same track/emitter ⇒ same key)
   fold, so value and time edits in one window are not independently undoable. This is
   the same per-track behavior, and it is identical in spirit to how the shipped emitter
   path behaves (a spinner drag-release commit folds with a subsequent wheel tick on the
   same field), so it is consistent project-wide behavior, not a new surprise. (The
   cross-key fold within a track is the conscious per-track-vs-per-field divergence
   noted in §1 "Out.")

3. **`m_liveAhead` / redo-branch interaction.** `CapturePreCoalesced` already handles
   the head-of-history vs mid-redo-branch distinction (it only skip-coalesces at
   `m_cursor == m_entries.size()`), and the shipped emitter path proved the
   `undo→redo→undo` auto-cap interaction (L-064 `m_liveAhead` gate). Track-key edits go
   through the same `captureUndo` → `CapturePreCoalesced` path with no new state, so no
   new interaction is introduced. Mitigation: the test matrix includes a redo-branch
   case (edit, undo, then a same-track edit must PUSH, not fold).

## 5. Testing & verification

Native CDP specs in `web/apps/editor/tests/undo-navigation.spec.ts` (real host
`UndoStack` over `--test-host`), mirroring the shipped emitter cases. The existing
suite's `beforeEach` already waits 1600 ms (past the 1500 ms window) so bursts don't
leak across tests — reuse that.

**Seeding precondition (must do first in each case).** `set-track-key` is a silent
no-op on an unbound/empty track slot (host returns ok with no mutation, pushing zero
undo entries — `track-editor.spec.ts` already hits this). So each case must first seed a
bound track with ≥ 2 keys via `add-track-key` (as `track-editor.spec.ts` does on `red`),
*then* drive the `set-track-key` burst, or a stack-depth assertion will mislead.

**Happy path (fold)**
- Two+ rapid `set-track-key` calls on the **same track / same emitter** → stack grows
  by exactly **one**; one undo reverts to the pre-burst key state.

**Separation (no over-fold)**
- `set-track-key` on **track A** then **track B** (same emitter) → **two** undo steps.
- `set-track-key` on the same track but **different emitter** → **two** undo steps.

**Structural break**
- `set-track-key`, then `add-track-key` (or `delete-track-keys`), then `set-track-key`
  on the same track → the structural op forces a fresh entry; the two moves do **not**
  fold across it (≥ 3 distinct undo steps).

**Redo-branch**
- Edit, `undo`, then a same-track edit → must **push** (no skip-coalesce mid-branch);
  redo is truncated. Confirms Risk 3.

**Window expiry**
- Two same-track edits > 1500 ms apart → two undo steps. Cheap to express — the suite
  already gates on wall-clock via the `beforeEach` 1600 ms wait — so keep it, don't skip.

**Build / lane verification**
- `pnpm --filter @particle-editor/editor test` → web suite stays green (web is
  unchanged; expect the current **510 / 0**).
- `tsc -b` → 0 (L-070 — the real type gate). Web is **untouched** by this host-only
  change, so the web count should be whatever the current baseline is (the handoff cites
  510; an older entry cited 513 — it's a moving baseline, just confirm it doesn't *drop*).
- **Native lane is NOT restored in this fresh worktree** (`x64\Debug\ParticleEditor.exe`
  and `web/apps/editor/dist/` both absent; a stale `tsconfig.app.tsbuildinfo` is present
  but does **not** shortcut the restore). Before the harness can run: L-039 NuGet copy →
  L-046 MSBuild **VS18** Debug x64 → L-040 `pnpm build`. Then `pnpm test:native` → expect
  **169 / 0** plus the new spec(s). An exit-1 + "browser closed" first run can be an
  L-066/L-071 phantom — re-run; a specific spec failing consistently is real.
- **Debug instrumentation:** the host already logs each capture (the `UNDO_LOG`
  `pushed`/`coalesced` block at [main.cpp:904](../../src/main.cpp:904)-908, literal on
  :907, in the legacy path; the arch-C `captureUndo` routes through `CapturePreCoalesced`).
  No new `#ifndef NDEBUG` printf needed — the spec asserts stack depth directly over CDP,
  which is the authoritative signal.
