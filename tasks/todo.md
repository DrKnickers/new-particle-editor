# Root-cause the dock-animation native host hang (in-layout push)

*Session 24 · 2026-06-07 · branch `lt-4` (worktree busy-gould-788edb) · ★★★★*

Goal: keep the **in-layout push** dock UX the user wants, and find/fix the
host-side hang that forced the revert of `ddb0777`, so the animated dock can
ship. This is a **debugging** task (systematic-debugging skill); the Iron Law:
no fix until root cause is proven with evidence.

---

## 1. Goal + scope

**What ships when done:** a root-cause writeup of the native host hang, and —
if the fix is in reach this session — the dock entrance/exit animation +
left-pane-flicker fix (`ddb0777`'s UX) re-landed with the host hang fixed,
`pnpm test:native` back to **green** (≥169/0). If the root cause proves to need
a live native debugger beyond host-side logging, the deliverable is instead a
precise, evidence-backed writeup naming the hanging call + a recommended fix,
handed back for a WinDbg pass.

**In:**
- Restore the native lane in THIS fresh worktree (L-039 + L-046 + L-040).
- Establish a **minimal reproduction** of the hang (scene-rect flood) — cheaper
  and more isolated than re-applying the whole dock commit.
- Host-side instrumentation to locate the hang (entry/exit + timing + counters
  on the scene-rect → compose path).
- One evidence-driven root-cause fix + verification.

**Out (with reasons):**
- Overlay-drawer pivot — that's the *other* option the user explicitly did NOT
  pick; revisit only if root-cause proves intractable.
- Reworking `layout/viewport-rect` / `Engine::Reset` (the heavy window-resize
  path) — `dxgi-resize-stress` already proves it survives 50× resizes; the hang
  is on the *light* scene-rect path. Touch only if evidence redirects there.
- `lt-4 → master` merge — separate decision, needs explicit OK.

---

## 2. What the codebase already gives us (verified this session)

- **Exact reverted change recovered:** `ddb0777` "animate the dock panel
  open/close + fix the left-pane flicker", parent `9c531e1` (current HEAD's
  ancestor). `git diff 9c531e1 ddb0777` = the precise change. Touches ONLY
  `web/.../PanelLayout.tsx`, its test, and `components.css` — **zero C++.**
- **The structural change:** old = `<Group key={dockVisible?"3col":"2col"}>`
  remounts the whole layout (incl. `ViewportSlot`) on toggle → 1 scene-rect msg;
  new = always-mounted `collapsible collapsedSize={0}` Panel toggled via
  `usePanelRef`, `.dock-animating` adds `transition: flex-grow .2s` → viewport
  resizes IN PLACE.
- **`ViewportSlot.tsx:65-128`** sends `layout/scene-rect` from an **un-debounced
  `ResizeObserver`** (+ window scroll/resize + DPR matchMedia). **No
  teardown/detach msg on unmount** — so the remount's only host-visible effect is
  *coalescing the burst into one message*. (Corrects the findings doc's "clean
  teardown/rebuild" framing.)
- **Host scene-rect handler `LayoutBroker::SetSceneRect` (`src/host/LayoutBroker.cpp:234`):**
  in composition mode (`m_dcompCompositor != null`) every message runs
  `m_engine->SetSceneViewport(x-GBx,…)` (guard-band overscan) **+**
  `m_dcompCompositor->SetEngineVisualTransform(x,y,w,h)` (deferred).
- **`Compositor` deferred transform** applies at the tail of `CompositeEngineFrame`
  → `ApplyTransform` emits **`[COMP-engine-transform]`** (`src/host/Compositor.cpp:261`)
  — the exact log tag the host dies inside. Compose also does
  `RefreshEngineSharedHandle` (on handle mismatch), `CopyResource`, `Present1`,
  and `WaitEndFrameQuery` (spin ≤100k) per frame.
- **Harness:** `web/apps/editor/scripts/run-native-tests.mjs` spawns ONE
  long-lived `ParticleEditor.exe --new-ui --test-host`, runs ~38 specs serially
  in fixed order; host death mid-run cascades CDP ECONNREFUSED. `tools.spec.ts`
  (~line 112, Bloom) opens the **Lighting dock** via the View menu = a dock
  open = the in-place expand that triggers the flood in the `ddb0777` world.
- **`dxgi-resize-stress.spec.ts`** floods `layout/viewport-rect` (HEAVY path) 50×
  with 50ms sleeps and PASSES — there is **no existing test that floods the light
  `layout/scene-rect` path**. That's the coverage gap and the likely repro.

---

## 3. Approach (Phase 1 → Phase 4, per systematic-debugging)

**Step 0 — Restore native lane.** L-039 (materialise NuGet `packages/`), L-046
(MSBuild **VS18** Debug x64), L-040 (`pnpm --filter @particle-editor/editor build`).
Verify: baseline `pnpm test:native` = **169/0** on the CURRENT (reverted) tree —
proves the lane works and the tree is green before I perturb it.

**Step 1 — Minimal reproduction (Phase 1 "reproduce consistently").** Add a
throwaway stress spec that floods `layout/scene-rect` rapidly (alternating
sizes, NO sleep, a few hundred msgs) against the live host. Two outcomes:
  - **Hangs** → root cause isolated to the host scene-rect/compose path, dock
    irrelevant. Proceed to instrument THIS repro (fast, no dock UI needed).
  - **Survives** → the dock's specific timing/interleaving matters; re-apply
    `ddb0777` (`git cherry-pick`/`checkout`) + `pnpm build` and reproduce via the
    real harness ordering. Then instrument.

**Step 2 — Instrument (Phase 1 step 4, the agent-driveable substitute for a live
debugger).** Add `#ifndef NDEBUG` host logging, tag `[HANG-PROBE]`, at:
  - WebMessage dispatch entry/exit + a monotonic scene-rect message counter
    (`BridgeDispatcher` / `HostWindow::OnWebMessage`).
  - `SetSceneRect` entry/exit + `SetSceneViewport` entry/exit + duration.
  - `SetEngineVisualTransform` (queue) + `ApplyTransform` (drain) — log the
    pending-queue state so we see if transforms pile up unbounded.
  - `CompositeEngineFrame`: timestamps around `RefreshEngineSharedHandle`,
    `CopyResource`, `Present1`, and the `WaitEndFrameQuery` spin-count.
  - Main pump: log when `RenderD3D9` is starved (N messages drained, 0 frames).
  The hang location = the last `[HANG-PROBE] enter X` with no matching `exit`.

**Step 3 — Single hypothesis + minimal test (Phase 3).** State it explicitly
("the host hangs in <call> because <reason>"), confirm from the log, change ONE
thing to test. Likely candidates the evidence will choose between: (a) the flood
itself is the cause → coalesce scene-rect (JS RAF-debounce in ViewportSlot
and/or host-side throttle) — a *root-cause* fix because the flood is the trigger;
(b) a genuine host deadlock/leak that even paced msgs hit → fix the host call.
Do NOT pick the fix before the log says which.

**Step 4 — Fix + verify (Phase 4).** Implement the single fix; add a regression
spec (the scene-rect flood, now expected to stay responsive — turn the throwaway
repro into a kept test, sibling to `dxgi-resize-stress`); re-apply `ddb0777`'s UX
on top; `pnpm build`; `pnpm test:native` green; web vitest + `tsc -b` green;
live-verify the animation + no flicker via Playwright real input (L-067).

---

## 4. Risks + mitigations

1. **The hang needs a live call-stack that logging can't pin.** If `[HANG-PROBE]`
   brackets a single opaque call (e.g. inside `Present1`/driver), logging gives
   the call but not the why. *Mitigation:* logging still narrows to one call —
   that's a precise WinDbg target to hand back; deliverable degrades gracefully
   to an evidence-backed writeup, not a dead end.
2. **Minimal repro doesn't reproduce (Step 1 "survives").** *Mitigation:* the
   plan branches — fall back to re-applying `ddb0777` + real harness ordering.
   Cost is one extra build, not a re-plan.
3. **Native lane restore eats time / fails (L-039/L-046 footguns).** *Mitigation:*
   those lessons document the exact commands + VS18 gotcha; verify with a green
   169/0 baseline before any change so a later red is unambiguously mine.
4. **JS-only coalescing masks a real host bug (symptom fix).** *Mitigation:* the
   Iron Law gate — Step 2 instrumentation must show the flood *is* the trigger
   (paced msgs survive) before JS coalescing counts as root-cause; if paced msgs
   also hang, the fix moves host-side.
5. **Instrumentation perturbs timing (Heisenbug).** A hang that vanishes under
   logging is itself a signal (race/timing). *Mitigation:* keep probes cheap
   (counters + coarse timestamps, not per-pixel); if it vanishes, that redirects
   the hypothesis toward a timing race, not a wasted run.
6. **Re-applying `ddb0777` conflicts with later polish commits.** *Mitigation:*
   it's a clean diff vs `9c531e1` and the only later changes to those files are
   known (scrollbar-gutter etc.); cherry-pick and resolve the small CSS overlap
   if any.

---

## 5. Testing & verification

- **Baseline (before any change):** `git` lineage 0/0 + clean; web vitest 513/0;
  `tsc -b` 0; native 169/0. *(web side ✅ done this session; native pending Step 0.)*
- **Repro:** the scene-rect flood spec hangs the host (or, fallback, the
  re-applied dock + harness ordering hangs at `tools.spec.ts` Bloom).
- **Instrumentation:** host.log shows a dangling `[HANG-PROBE] enter` with no
  `exit` = the hang site; pending-transform/queue counter shows bounded vs
  unbounded growth.
- **Fix:** the flood spec now stays responsive (host alive, snapshots succeed);
  no `[HANG-PROBE]` dangling enter.
- **Regression:** kept scene-rect-flood spec added; native ≥169/0 + the new test.
- **Re-landed UX:** Playwright real-input — left-pane DOM marker survives a dock
  toggle (no remount); open tweens 0→260px, close smooth; splitter drag has no
  `.dock-animating` class; zero console errors.
- **Type/lint gate:** `pnpm build` (`tsc -b`) clean AFTER touching any test (L-070);
  `pnpm build` before EVERY native harness run (L-068).
- **Debug instrumentation:** `[HANG-PROBE]` printfs are `#ifndef NDEBUG`; grep tag
  to confirm none leak into a release path before final.

---

## Progress log

- **Approach approved:** minimal-repro-first (user, 2026-06-07).
- **Step 0 DONE.** Native lane restored (L-039 NuGet copy + L-046 MSBuild VS18
  Debug x64 + L-040 dist). Baseline `pnpm test:native` = **169 passed / 30
  skipped** on the reverted tree. Lane works; tree green before any perturbation.
- **Step 1 — minimal repros, both FALSIFIED the simple hypotheses:**
  - `scene-rect-flood-repro.spec.ts`: 400 un-awaited + 480 rAF-paced
    `layout/scene-rect` against a STATIC DOM → host **survived** (2 passed).
    Pure message volume is NOT the cause.
  - `dock-toggle-storm-repro.spec.ts`: re-applied `ddb0777` (3 files via `git
    checkout ddb0777 --`), rebuilt dist (verified `dock-animating` in bundle),
    drove **60 REAL Spawner dock toggles** on a fresh host → host **survived**
    (1 passed, 18s). Isolated in-place dock toggles are robust.
  - ⟹ The findings-doc cause ("cumulative in-place-resize hang") is unproven and
    its simple form is now falsified. Live possibilities: (a) needs full-run
    accumulated state, or (b) the original failure was an **L-066 phantom** and
    the dock is fine. Resolving via the ground-truth full-harness run (in flight).
- **Tree state:** `ddb0777` dock re-applied (PanelLayout.tsx + test + components.css);
  repro specs added to the harness list; dist rebuilt. NOT committed.

### ⚠️ MAJOR REFRAMING (2026-06-07, evidence-backed) — the findings doc was WRONG

**The native host does NOT hang.** Reproduced the failure (full harness, dock
re-applied) TWICE — both runs **identical**: `tools.spec:167` "Ground popover"
fails with a 30s `page.evaluate` timeout / "Target page… has been closed";
`splitters:303` fails (expected — asserts the old remount). **170 passed both
times**, harness exit **1** (ordinary failures), NOT exit 2 (`hostDiedMidRun`).

Host-side proof it never hung:
- `host.log` clean: **0** `[COMP-engine-fail]`, 0 error/hang words; ends with
  healthy `dxgi-resize-stress` output (fps ~3094) — and that spec runs ~20 specs
  AFTER tools.spec. Host composited happily past the "death."
- **No crash dumps today**: no new `ParticleEditor.exe` WER dump (latest 6/3),
  no WebView2 Crashpad report. Neither host nor renderer crashed.
- 170 specs pass AFTER the "failed" tools.spec → host + renderer both alive.

**The real bug:** an order-dependent, **full-ordered-run-only**,
**test-host-COM-bridge-only** renderer stall at `tools.spec:167`. Does NOT
reproduce: in the browser (MockBridge ✓), in a 60× real dock-toggle storm (✓),
in a 400+/480 scene-rect flood (✓), or in a standalone replay of
tools.spec:78/85/112/167 (✓ — `tools-poison-repro` T1/T2/T3 all pass). It needs
the ~7 prior spec files' accumulated state. `bridge.request` is async
(promise) → not a sync-COM thread block.

**In flight:** testing the findings-doc claim "disabling the CSS transition
still hung" (suspect — same author mislabeled the host hang). Animation disabled
(`components.css` `.dock-animating` transition→none, EXPERIMENT marker) + full
harness. Decisive: anim-off PASSES ⟹ trigger is the animation (gate it under
--test-host/reduced-motion → ship); anim-off HANGS ⟹ trigger is the
always-mounted structure.

**Open scope question for the user:** the hang is test-host-only (the COM bridge
exists ONLY for CDP testing; real users use async postMessage). Likely a TEST
artifact, not a product bug — but confirm before claiming users are unaffected.

### ✅ ROOT CAUSE PINNED (2026-06-07, Playwright trace evidence)

User chose "pin the mechanism." Captured a Playwright trace of the failing
`tools.spec:112` (`--trace retain-on-failure`), extracted the action log:

- **Hung call = `closeAnyPanel`'s `closeBtn.click()`** on a `[role="dialog"]
  :not([data-state])` Close button. Log: visible/enabled/stable → scrolled →
  **`<div class="dock-animating" data-group="true"> intercepts pointer events`**
  → retry ×N → **`element was detached from the DOM, retrying`** → 30s timeout.
- No console errors, no crash; ~120 screenshots over 30s (page live throughout).

**Mechanism — a race between the dock close-animation and Playwright strict
actionability.** On close, `displayDock`'s 260ms lag keeps the panel mounted
(role=dialog, with a Close button) while it collapses to width 0 and then
unmounts, and the outer Group wears `.dock-animating`. A `closeAnyPanel` click
landing in that ~260ms window finds the Close button simultaneously squeezed
(click point hits the animating group → "intercepts pointer events") AND
detaching (`displayDock`→null → "element detached"); Playwright retries the full
30s. `closeAnyPanel` runs at the START of many tests, so in the FULL run the
prior test's dock-close is still animating → race lands badly; in ISOLATION the
prior close never happened → no window. Explains: full-run-only, intermittent,
wandering (:112/:167), Heisenbug-sensitive, self-recovering, and why disabling
the CSS transition didn't help (the `.dock-animating` class + `displayDock` lag
are JS, not CSS).

**Real-user impact: NONE.** A human doesn't click a panel sliding closed and
would re-click; 260ms window. Playwright's retry-until-actionable turns a 260ms
animation into a 30s timeout. Host + product fine.

**Fix candidates (pending user pick):**
- A. Drop the `displayDock` close-lag → panel unmounts immediately on close (no
  phantom dialog). Open animation preserved; close = content vanishes then empty
  slot collapses. Simplest; removes the incorrect "closing panel is an open
  dialog" state (also an a11y correctness win).
- B. Keep slide-out but make the closing content non-interactive AND not match
  `[role="dialog"]` during the lag (drop role / aria-hidden) so closeAnyPanel
  can't target it.
- C. Gate the dock animation (class + lag) under reduced-motion/test-host →
  deterministic instant toggles in the harness; users get the animation. (CDP
  can't see arch-C animation anyway.)
- D. Make `closeAnyPanel` (+ similar helpers) robust to in-flight animation
  (wait for `.dock-animating` to clear / force). Test-only fix.

### ✅ FIX IMPLEMENTED + VERIFIED (user chose B — keep slide-out, inert closing)

**Change (3 files):** a closing dock panel no longer presents as an open,
interactive dialog while it slides out.
- `ToolPanel.tsx`: new `closing` prop → stamps `data-state="closing"` on the
  `role="dialog"` div, so it no longer matches `[role="dialog"]:not([data-state])`.
- `LightingPanel.tsx`: accepts + forwards `closing` to ToolPanel.
- `PanelLayout.tsx`: `dockClosing = dock===null && displayDock!==null`; passes
  `closing={dockClosing}` to LightingPanel and marks the dock `<aside>` `inert`
  during the close window (non-interactive for both panels; React 19 `inert`).
- `splitters.spec.ts:303` rewritten for the new behavior (collapse, not remount;
  marker proves no left-pane remount = flicker fix) + doc comment updated.

**Browser-verified (preview, microtask sampling — tab backgrounded so timers
throttle):** open Lighting → `data-state=null`, matches open-selector, not inert.
During close → `data-state="closing"`, **does NOT match open-selector**, aside
inert, dialog still present (slide-out preserved). Close completes clean (dialog
gone, inert cleared).

**Native-verified:** full harness with the fix → **all 5 tools.spec tests PASS**
(incl. :112 Bloom + :167 Ground — the ones that hung 30s). 174 passed; only
`splitters:303` failed (the expected old-remount assertion — now rewritten).

**Remaining before handoff:** (1) re-run harness ≥2× for stability (race was
intermittent); (2) remove throwaway repro specs (scene-rect-flood, dock-toggle-
storm, tools-poison) + harness entries; (3) add a kept unit-test regression gate
(ToolPanel closing→data-state); (4) web vitest + tsc -b green; (5) live-verify
the dock animation via Playwright real input; (6) docs (CHANGELOG/ROADMAP +
correct the findings doc); (7) propose lt-4 integration (user OK).

---

## Review (session 24 — DONE)

**Shipped (uncommitted in this worktree, HEAD==lt-4==origin/lt-4==`52eae8a`):**
the animated in-layout dock (re-applied `ddb0777`) + the root-cause fix that
makes it pass the native harness. 11 files: 7 source/test (PanelLayout, ToolPanel,
LightingPanel, components.css, ToolPanel.test, PanelLayout.test [from ddb0777],
splitters.spec) + 4 docs/tasks (CHANGELOG, findings doc, lessons L-071, todo).

**Verification (all ✅, evidence quoted):**
- Native harness **169 / 0** across **3** consecutive full runs (was 2/2 failing
  before the fix). a11y goldens unchanged (always-mounted dock is a11y-equivalent
  in the default open state).
- Web vitest **510 / 0**; `tsc -b` exit 0.
- Browser (preview): open→`data-state` absent/matches-open-selector/not-inert;
  during close→`data-state="closing"`/does-NOT-match-selector/aside-inert/dialog
  still present (slide-out preserved); after→clean.
- Root cause proven by Playwright trace (closeAnyPanel click vs close-animation
  race); host + renderer proven healthy (no crash dumps, exit 1 not 2, clean log).

**Done items (1)–(4),(6) complete; (5) animation logic verified, smooth-tween
VISUAL is the user's eye (arch-C, L-033); (7) pending user OK to commit + FF to
lt-4.** Steps 2/3 of the original plan (host instrumentation) were supplanted
once the trace pinned a renderer-side test-harness race — the deeper finding was
that this was never a host hang.

**Lessons captured:** L-071 (Playwright full-run-only 30s timeout = actionability
race / phantom, not a host hang — trace it; transient UI must not be an
actionable target). L-022 validated hard (handoff "host hang" claim was false).
