# Next-session prompt — post-[MT-11] Phase 3

> **Copy the block below into the next session's first message.**
>
> [MT-11] Phase 3 is **fully shipped on `origin/lt-4` at `9aca4d7`** (all
> 5 stages: 0 spike + 1 D3D9Ex + 2 shared-handle + 3 composition hosting
> + 4 DXGI engine bridge + 5 scene-rect transform). The previous session
> closed with the user verifying Stage 5 in person ("resize behavior is
> perfect") + the FF + push to origin/lt-4.
>
> This dispatch picks the next direction. Several open items remain;
> see "Suggested directions" below.

---

[MT-11] Phase 3 is complete. `origin/lt-4` is at `9aca4d7` (docs(LT-4):
[MT-11] Phase 3 Stage 5 T8 — CHANGELOG + HANDOFF + todo.md refresh).
Engine pixels reach the screen via D3D9Ex shared texture → D3D11 alias
→ DXGI composition swapchain → DComp engine visual, constrained to
scene-rect via per-pixel-FoV projection and DComp clip, under
`ALO_WEBVIEW2_HOSTING=composition` + `ALO_VIEWPORT_TRANSPORT=canvas-jpeg`.
Default new-UI path (env vars unset) is byte-identical to today.

Pre-flight (in order):

`CLAUDE.md` — working principles, branch workflow, plan structure,
the ★ rating + pre-handoff testing discipline. Pre-handoff
exhaustive testing applies even tighter now that Phase 3's complex
composition-mode plumbing is fully wired.

`tasks/HANDOFF.md` — current state. The top section reflects
Stage 5 SHIPPED + Phase 3 closed. Read "Stage 5 — what shipped, in
plain English" + "What's verified end-to-end" + "Known follow-ups
(out of scope for Stage 5)" + "Phase 3 closing notes." The closing
notes list the four most-plausible next-dispatch directions.

`CHANGELOG.md` top entry — Stage 5 ship description with the four
T6 user-driven correction iterations documented in "Issues
encountered and resolutions." Worth reading for the lesson-pattern
context if you're picking up the L-019/L-020/L-021 retro-doc work.

`tasks/stage-5-smoke-result.md` — T6 smoke evidence with the per-
iteration bug log (displacement coord-space, aspect distortion,
blue-bar lag, snap-on-click projection-push).

`ROADMAP.md` — the top-level table of contents + Near-term tier
items. After Phase 3 close, the next roadmap item is whatever's at
the top of `1. Near-term` (or you might want to scan all tiers).

Lineage check:

```powershell
git fetch origin lt-4 --quiet
git log --oneline origin/lt-4..HEAD   # 0 if session branched cleanly from origin/lt-4
git log --oneline HEAD..origin/lt-4   # 0 if session has all the lt-4 work
```

Both should be 0 at session start. `origin/lt-4` is at `9aca4d7`.

Pre-coding gate (before any production code edits):

- `pnpm -w typecheck` — 0 errors (`tsc -b`)
- `pnpm -w test` (vitest) — **338 passed / 338**
- MSBuild Debug + Release x64 clean
- Playwright HWND baseline: **99 passed + 26 skipped + 0 failed**
  under default dist/ + no env vars
- (Optional, ~5min) Composition-mode native: rebuild dist/ with
  `VITE_VIEWPORT_TRANSPORT=canvas-jpeg` + `VITE_WEBVIEW2_HOSTING=composition`,
  run `pnpm test:native` under `ALO_WEBVIEW2_HOSTING=composition` +
  `ALO_VIEWPORT_TRANSPORT=canvas-jpeg`. Expected: **122 passed + 3
  skipped + 0 failed**.
- (Optional) `shared_texture_test.exe` PASS — Stage 2 validator
- (Optional) `dxgi_spike.exe` — smoke at 1080p

**dist/-build-mode caveat (still applies)**: the HWND baseline (99 +
26 skipped) requires default-mode dist/; composition (122 + 3 + 0)
requires composition-mode dist/. Mismatched combinations produce
confusing partial test failures. Always rebuild dist/ between modes
or after running composition-mode native tests.

## Suggested directions for this dispatch

Pick whichever fits your bandwidth + the user's priority. The first
two are low-risk close-outs; the third is small bug-fix work; the
fourth opens a new feature dispatch.

### Option A — Phase 3 close-out (a11y suite + final acceptance smoke)

The pre-Stage-5 HANDOFF flagged Stage 3h (UI Automation a11y suite)
and Stage 3i (final acceptance smoke with Narrator + IME) as
deferred. Worth confirming with the user whether these are still
wanted given Phase 3 has shipped end-to-end. If yes:

- **Stage 3h** — a11y suite via Playwright's `page.accessibility.snapshot()`
  (cheap variant) or UI Automation Node bindings (comprehensive but
  ~2× the effort). The sub-plan recommended the cheap path with a
  follow-up for real Narrator driving if the user wants it.
- **Stage 3i** — manual a11y smoke with real Narrator on user's rig +
  IME smoke (if installed) + keyboard nav stress + visual confirmation
  screenshot. Fully manual; user-driven.

Estimated: 3h ~1d cheap / ~2d comprehensive; 3i ~0.5d user-driven.

### Option B — Lessons retro-doc (L-019/L-020/L-021 formalization)

Three Stage 4+5 lesson patterns flagged for retro-doc:

- **L-019 (DXSDK linker-twin pattern)** — L-016's exact twin on the
  linker side. The DXSDK lib-path shadowing on `CreateDXGIFactory2`
  (resolved via `CreateDXGIFactory1` + QI to IDXGIFactory2). Stage 4f
  CHANGELOG entry has the long-form context. Worth documenting as a
  parallel-to-L-016 entry in `tasks/lessons.md`.
- **L-020 (spike-vs-production config audit)** — the PREMULTIPLIED-vs-
  IGNORE alpha-mode pivot from Stage 4d.1. Generalized: "when porting
  a spike to production, audit every const/enum the spike picked
  against the production workload's actual data flow — don't assume
  spike choices are correct just because the spike was a passing
  reference."
- **L-021 (verify rendered geometry, not design intent — combined-math
  edition)** — Stage 5 T6 Iter 1 displacement bug. The sub-plan
  described Compositor's clip-in-local-coords convention AND Engine's
  render-at-scene-rect-coords convention independently, both correct
  individually but combined produced a double-offset. CLAUDE.md
  already has a "verify rendered geometry" rule; this lesson is the
  combined-math edition. A 30-second mental walk-through with pixel
  math at sub-plan time would have caught it.

Estimated: ~2-3h total for all three (each ~30-45 min in lessons.md
format).

### Option C — Latent `ResetParameters` projection-push bug fix

Single-line bug fix surfaced by Stage 5 Iter 4. `Engine::ResetParameters`
at `engine.cpp:1518` rebuilds `m_projection` (full-RT-aspect, fovY=45°)
but doesn't push it to the device. Nobody noticed pre-Stage-5 because
window resize was always immediately followed by camera interaction
(which calls `SetCamera` → `SetTransform(D3DTS_PROJECTION, ...)`).

Stage 5 fixed it inside `SetSceneViewport` only (composition-mode
paths). The latent bug remains for non-composition transports
(canvas-jpeg, arch-A) where SetSceneViewport isn't called.

Fix: at end of `ResetParameters`, after the existing `_33`/`_43`
overrides, recompute `m_viewProjection` and call
`m_pDevice->SetTransform(D3DTS_PROJECTION, &m_projection)`. Same
pattern as Stage 5's SetSceneViewport.

Estimated: ~30 min including build + commit + push.

### Option D — Next roadmap item

Per `ROADMAP.md`, scan the `1. Near-term` tier for the highest-
priority item. Common candidates (verify against current ROADMAP):

- [NT-N] items not yet shipped at this point in the lt-4 timeline
- Anything tagged related to the new-UI / LT-4 work flow that's
  now unblocked by Phase 3 shipping
- Phase 4 of MT-11 if the roadmap has one (might be "AlphaCompositor +
  FramePublisher removal" per the original sub-plan §1 out-of-scope
  notes — Stage 7 was the original framing)

**Recommendation**: Start with Option B (lessons retro-doc) +
Option C (latent projection-push fix) as a combined ~3-4h dispatch.
Both close out Phase 3 hygiene; both are low-risk; both unblock
future work. Then surface Option A's a11y status to the user
separately for a decision. Option D depends on ROADMAP state which
needs a fresh read at session start.

## Known follow-ups Stage 5 did NOT close

Carried forward in `tasks/HANDOFF.md` known-follow-ups section:

1. **`canvas-architecture.spec.ts` test.fixme markers (L-012)** —
   pre-existing Phase 2 instrumentation fault, three documented fix
   approaches in the spec's FIXME comment.
2. **Stage 4 sub-stage 4e** (first-frame ClearRenderTargetView guard)
   — defence-in-depth, not observed; ship-if-surfaces.
3. **Test harness env-var pre-flight check** (Stage 4f follow-up) —
   harness should fail-fast or auto-rebuild on ALO_* / VITE_* mismatch.

Sub-plan + smoke evidence files for Stage 5 are at
`tasks/dxgi-stage-5-scene-rect-transform.md` (~1040 lines including
the post-user-check-in revision to Variant B-γ + the T6 iteration
notes inline) and `tasks/stage-5-smoke-result.md` (the iter-by-iter
bug log).

---

**Context window note.** Stage 5 burned ~24% of 1M context across
9 tasks + 4 user-driven correction iterations + 2 docs commits +
the push. The next dispatch should have plenty of room for any of
the Options A-D above, with margin for an additional sub-plan +
unexpected iterations.

**Build / dist mode note.** Repo's current dist/ build mode is
unknown to a fresh session. The HWND baseline (99 + 26 skipped)
requires default-mode dist/; composition mode (122 + 3 + 0)
requires composition-mode dist/. Always rebuild before running
native tests to match the env vars you're testing under.

**Worktree note.** This session ran in
`C:\Modding\Particle Editor\.claude\worktrees\affectionate-euclid-5d1c8f`.
The next session will get a fresh `claude/<random>` worktree
branched from `origin/lt-4` automatically. The
`affectionate-euclid-5d1c8f` worktree can stay as a safety net or
be cleaned up with `git worktree remove` at the user's leisure.
