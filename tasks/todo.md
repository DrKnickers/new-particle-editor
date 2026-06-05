# Session 18 — Native harness green-up (INVESTIGATION, pre-plan)

## STOP / re-plan: baseline does NOT match the handoff

Task picked (with user): get `pnpm test:native` fully green by fixing the
"5 pre-existing failures (splitters ×4 + a11y-dialogs ×1)" the session-17
handoff described as proven-pre-existing and flaky 5↔6.

**Reality on this fresh worktree (commit dd757b5) does not match that.**

### What I did (setup — all clean)
- Pre-flight: `origin/lt-4` = dd757b5, 0/0, tree clean. Web: `pnpm install`,
  `test` → **471 passed**.
- Restored native lane: WebView2 `packages/` via robocopy (L-039);
  MSBuild Debug x64 → **exit 0** (LNK4098 benign). Built composition `dist/`
  (L-040) → exit 0.
- Ran full native harness (`pnpm test:native`).

### Harness result: 39 failed / 65 passed / 29 skipped / 61 did-not-run
NOT "160 passed / 5 failed." Two distinct problems:

1. **Host CRASH mid-run.** After `emitter-keyboard` (test 114) the host
   process exited `0xFFFFFFFF` (`[run-native-tests] host process exited
   code=4294967295`). Every later spec failed with `connect ECONNREFUSED
   ::1:9222` — a cascade from the dead host, NOT real failures. host.log
   ends cleanly after the emitter-keyboard Delete keystrokes (vk=46) with
   no error trace → an unhandled crash that bypassed logging.
   - **`splitters` never ran live this session** (host already dead) — so
     the handoff's "splitters ×4" is unverified here. (Window client is
     1264px per [PERF] logs, which WOULD clamp left to 330px/1264 ≈ 26%
     — matching the handoff number — but the spec didn't execute.)

2. **19 composition a11y goldens drift (pre-crash, real).** a11y-chrome
   ×12, a11y-curve-spinner ×2, a11y-dialogs ×1 (dialog-set-link-group),
   a11y-keyboard ×4 — NOT the single dialog-set-link-group the handoff
   named. Exact diff (golden vs captured tree, menubar-closed):
   - tree has **1** emitter (`default`) vs golden's **3** (default +
     lifetime child ↻ + death child ✕)
   - an emitter is **selected** (panels populated) vs golden's **no
     selection** (placeholder panels)
   - stats **unfrozen** (FPS 258) vs golden's frozen `—`
   The emitter-count delta (1 vs 3) is the trustworthy signal (the
   selection/freeze bits may be post-teardown capture-timing artifacts).
   A single global state delta baked into every full-page snapshot ⇒ one
   upstream cause, not 19 bugs: the `beforeEach` `file/open` of
   `tests/fixtures/a11y-base-state.alo` is producing a 1-emitter doc where
   the goldens encode a 3-emitter doc.

### Leading hypotheses (UNCONFIRMED — do not act yet)
- **H1 (environmental pollution).** The host reuses a STABLE/SHARED
  WebView2 user-data folder (L-030). A prior --test-host run (or the
  user's daily-driving) may have left it dirty; `seedCanonicalUiState`
  only seeds theme + right-dock, not selection/doc. Could explain the
  global state delta AND possibly the instability.
- **H2 (real fixture/loader regression).** `a11y-base-state.alo` or the
  `file/open` path resolves/loads differently now (1 root, no children).
- **H3 (host crash = flake vs deterministic).** Unknown without a re-run.

### Next experiment (cheapest decisive datapoint)
Re-run once after clearing the shared WebView2 user-data folder; observe
(a) whether the host crash reproduces, (b) whether the a11y count/pattern
is stable, (c) capture ONE clean CDP `ariaSnapshot` of menubar-closed
(fresh host, exact beforeEach) and diff vs golden — removes the
post-teardown timing confound.

## RESOLVED: the crash is a one-off, NOT a regression

Re-ran the full harness (clean). Result: **160 passed / 5 failed / 29
skipped** — EXACTLY the handoff baseline. Host exited normally
(`code=null, signal=SIGTERM` = harness teardown). All 19 a11y "drifts"
from run 1 PASS now → they were garbage captures from the dying host.

**Conclusion:** run 1's host death + broad a11y drift was an
environmental one-off (dumpless exit code -1 = external TerminateProcess
signature; zero WER dump despite WER being active and capturing 6 prior
real crashes). Fails the systematic-debugging reproducibility gate ⇒
environmental, not a code bug. Likely a stale/stray ParticleEditor
--test-host or a locked/dirty shared WebView2 user-data folder (L-030)
poisoning the FIRST run on a fresh worktree.

### The 5 REAL (reproducible) failures — both root-caused
1. **splitters ×4** — CONFIRMED. `Received: 26.108%` / `26.190%` vs
   `Expected < 21`. Window client = 1264px; `left` Panel has a **pixel**
   `minSize={330}` (PanelLayout.tsx:262) → 330/1264 = 26.1%. The spec
   asserts flat 20/60/20 %, but the px floor clamps it at this window
   width. Test-side bug (the px floor is intentional/correct UI); the
   spec's "percentage assertions are window-size-agnostic" premise is
   false. Affected: defaults(125), drag-persist(163), corrupted(227),
   spawner-toggle(258).
2. **dialog-set-link-group ×1** — `dialog-lighting`'s teardown clicks
   Close → `setDock(null)` persists `alo:right-dock="none"`
   (right-dock.ts:42); nothing re-seeds it, so later surfaces capture a
   collapsed dock vs the goldens' "spawner". Non-symmetric teardown.
   Test-harness bug, not the dock store.

### Only real harness fragility found
One host death cascaded ~60 phantom failures — the harness has no
"host died mid-run ⇒ abort loudly" guard (run-native-tests.mjs watches
`child.on('exit')` but Playwright keeps going against a dead CDP).
Optional hardening, separate from the 5 fixes.

## REVIEW — native harness fully GREEN (165 passed / 0 failed / 29 skipped)

User chose: fix all 5; splitters via compute-from-floor.

### Fixes (test-side only — no shipping-UI changes, no native rebuild)
1. **dialog-set-link-group golden regenerated.** Verified the drift via
   `pnpm a11y:update --grep "dialog-set-link-group"` + `git diff`:
   `"All 1 selected emitter will be linked." / OK` →
   `"Select at least 2 emitters to create a group." / OK [disabled]`.
   Confirmed intentional: SetLinkGroupDialog.tsx:188 + a vitest at
   SetLinkGroupDialog.test.tsx:93 already assert it. Golden was STALE
   behind a shipped validation tightening — regeneration is the fix.
   (My initial teardown-leakage hypothesis was DISPROVEN — the modal's
   golden is dialog-only; dock state never appears in it.)
2. **splitters ×4 — floor-aware assertions.** Added `LEFT_MIN_PX=330`,
   `SPAWNER_MIN_PX=260`, `outerGroupWidthPx(key)`, `flooredPct(...)` to
   splitters.spec.ts; replaced the flat 19–21/59–61 outer-group bounds
   with `max(defaultPct, floorPx/measuredWidth*100)` ±1 %. Correct at any
   window size (wide → falls back to flat 20 %). The px floors are
   intentional UI (label truncation), so the TEST was wrong, not
   PanelLayout. Confirmed number: 330/1264 = 26.108 %.

### The "host crash" — NOT a regression (resolved)
Non-reproducible. Clean re-run = 160/5 (handoff baseline exactly); the
fix run = 165/0. Run-1 death was environmental poisoning (dumpless exit
-1 = TerminateProcess signature; zero WER dump despite WER active w/ 6
prior real dumps; L-030 shared user-data folder). Captured as **L-066**.

### Verification
- `pnpm --filter @particle-editor/editor lint` → exit 0.
- `pnpm --filter @particle-editor/editor test:native` → **165 passed / 0
  failed / 29 skipped**; host exited normally (SIGTERM teardown).
- `git status`: only `splitters.spec.ts`, the one golden, `tasks/*` —
  no source/component changes, no collateral golden regeneration.
- web vitest untouched (no web src changed; 471 still stands).

### Follow-up DONE — harness host-death guard (this session, per user request)
`run-native-tests.mjs`: a `pwRunning` gate + `pwChild` ref let the host's
`exit` handler detect a MID-RUN death → kills Playwright, prints a
`*** FATAL: host process died MID-RUN ***` banner, exits **2** (distinct
from spec-fail 1 / clean 0). Teardown SIGTERM (after Playwright exited) is
NOT tripped. Verified both ways:
- Fault-injection: `Stop-Process -Force` on `--test-host` mid-run (killed
  after test 91, code=4294967295 — same -1 signature as the original
  poisoning) → FATAL + exit 2, aborted instead of cascading ~100 specs.
- Clean run: 165 passed / 0 failed / 29 skipped, exit 0, ZERO false FATAL.
So a future poisoned run announces itself. L-066 updated.

### Still not done (deliberately, out of scope)
- Did NOT add a host minidump handler / SetUnhandledExceptionFilter
  (would help diagnose any FUTURE *real* crash, but the chased crash was
  environmental — separate idea).
