# RESOLVED: end-to-end audit of click-drag reorder + reparent (single + multi)

_**RESOLVED 2026-06-09 (session 33).** The audit was re-run as a hardened
workflow (`wf_eab3d07f-f8e`, `isCleanRun: true` — 10 confirmed / 10 refuted /
0 unverified). **All 10 confirmed findings are fixed + host-smoked, shipped to
`master` via PR [#110] (`e4ef42b`).** Nothing here is open work anymore — kept
for the record (the 10 findings + the workflow's dead-verifier trap). See
`tasks/HANDOFF.md` (session 33) for the fixes. The original notes below are
historical._

---

_Deferred 2026-06-09 (session 32) — the audit workflow hit the session token
limit MID-RUN. Its raw output looks like a clean pass; it is NOT. Read this
before trusting anything from run `wf_702b08d9-c73`._

## True state of the audit

- **Completed dimensions (2/6):** controller-lifecycle, ux-rendering —
  together they produced **10 findings**.
- **NEVER RAN (4/6):** resolver-math, host-ops, mock-host-parity,
  selection-follow — all failed on the rate limit. Zero coverage there.
- **ALL 10 verifier agents failed on the rate limit.** The workflow script
  counts a missing verdict as "refuted", so the result JSON shows
  `confirmed: []` / 10 "refuted" — **every finding is actually UNVERIFIED.**

## Resume recipe

Re-invoke the workflow with the saved script + `resumeFromRunId` — the two
completed audit agents return cached results instantly; only the 4 failed
dimensions + all verifiers run live:
`Workflow({ scriptPath: "<session-dir>/workflows/scripts/audit-drag-reorder-reparent-wf_702b08d9-c73.js", resumeFromRunId: "wf_702b08d9-c73" })`
(Same session only. From a fresh session, rerun the script file directly —
it is self-contained.)

## The 10 unverified findings (controller-lifecycle + ux-rendering)

Triage by hand or via the resume; my own priors in brackets:

1. **Mid-drag tree mutation** (Ctrl+Z/Delete/Ctrl+V/Alt+Up during a held
   drag) — closures capture tree/geometry at pointerdown; a mid-drag mutation
   reshuffles positional ids, so the release commits stale ids → host moves
   the WRONG emitters. [Likely real; fix: cancel the active drag on any
   `emitters/tree/changed`, e.g. an activeDragCancel ref the subscription
   calls.]
2. **No pointer capture / blur safety net** — Alt-Tab or a native dialog
   mid-drag strands the drag armed; next click commits the stale drop.
   [Likely real; fix: `ev.buttons === 0 → finish(false)` in onMove + a
   window blur listener.]
3. **startDrag re-entrancy** — no active-drag guard / pointerId filter; a
   second pointer runs two controllers over shared state. [Plausible.]
4. **Inline rename can begin mid-drag** (editingRef checked only at
   pointerdown) → rename commits against the wrong row post-drop. [Check
   how rename starts mid-drag — F2 reaches the tree keydown handler?]
5. **draggedRef suppresses click but not dblclick** — a no-op drag + quick
   same-row click can open rename. [Minor if real.]
6. **Mid-drag tree refetch breaks previews** (wrong rows dim, gap at wrong
   root) — same root cause as #1.
7. **Chip not occlusion-registered** — invisible over the D3D9 viewport in
   the native host. [Check the viewport-occlusion lib used by other popups;
   the chip is fixed-position DOM, the engine visual is composited UNDER the
   WebView2 visual in arch-C — verify which way it actually layers.]
8. **Chip magnetize pull unbounded** — near tall subtrees the chip can leave
   the cursor by hundreds of px (gap center far away). [Plausible; fix:
   clamp the pull distance.]
9. **Chip has no max-width** — one long emitter name spans the window.
   [Trivial fix: max-w + truncate (the row spans already truncate).]
10. **stepChip setState per rAF tick re-renders the whole tree at 60fps for
    the entire drag** — perf. [Real mechanism; severity depends on tree
    size. Fix: render the chip into its own component/portal so the setState
    re-renders only the chip, or move chip position to a ref + direct style
    writes.]

## Also noted during prep (not from the workflow)

- **Junk undo entry on refused ops:** `emitters/drop` calls captureUndo()
  before ALL validation; `emitters/reorder-many` validates params but
  captures before the engine call, which can still refuse. A refused op
  leaves an undo entry identical to the current state → next Ctrl+Z is a
  visual no-op (and canUndo goes true on a pristine doc). Reachable from the
  web only via stale-geometry races (findings #1/#2) or direct bridge calls;
  the native tests send refusable ops routinely. `UndoStack` has no
  discard/pop primitive — either add `DiscardLast()` (Capture returns
  `pushed`) or pre-validate refusal conditions before capturing
  (KEEP-IN-SYNC duplication with the engine checks).

## Scope when resumed

Re-run the 4 missing dimensions + verify all findings, then fix confirmed
ones. The two prior review passes (session 32) already hardened: stableId
identity (copySharedParamsFrom clobber), the reparent latch, mid-glide
snapshot corruption, FLIP map staleness — those are FIXED and tested; don't
re-litigate them.
