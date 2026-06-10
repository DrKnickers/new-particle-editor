# Resize-performance fixes — plan (session 34)

_2026-06-10. Source: [`tasks/resize-perf-investigation.md`](resize-perf-investigation.md)
(session-33 root-cause report, all claims re-verified against code this session).
Status: **PLAN — awaiting user scope confirmation before coding.**_

---

## 1. Goal + scope

When this ships, resizing the app window and dragging panel splitters feel
like the dock slide does today: smooth, no multi-second stalls, no juddering
viewport edge. The engine view may stretch its last frame mid-gesture
(OS-standard behaviour) and snaps crisp on release.

**In:**
- **Phase 0 — instrumentation** (~half-day): the four probes from the
  investigation note, `#ifndef NDEBUG`, tag `[resize-perf]`. Numbers confirm
  the ranking before we build, and give before/after proof for each fix.
- **Phase 1 — Fix A + D, one PR**: defer `Engine::Reset` to gesture settle
  (`WM_ENTERSIZEMOVE`/`WM_EXITSIZEMOVE` + DComp stretch mid-gesture + one
  settle reset), plus the cheap riders (main-window erase suppression,
  `put_Bounds` throttle during sizemove, fix the misleading
  `BridgeDispatcher.cpp:916-919` comment).
- **Phase 2 — Fix B, separate PR**: pace the idle render pump to composition
  cadence; make `WaitEndFrameQuery` yield between polls.
- **Phase 3 — Fix C, staged PR(s)**: C1 last-rect dedupe + drop the redundant
  `window resize` listener; C2 fire-and-forget post + NDEBUG-gate the
  per-message log flush and `SetSceneViewport` printf; C3 (judder killer)
  splitter-drag suppression + host-clocked lerp — scoped after B lands,
  based on the user's feel verdict.

**Out:**
- **A2** (make the settle reset itself cheap via `ResetEx` semantics +
  cache-preserving resize) — separate follow-up after A ships; requires
  first-party D3D9Ex pool-semantics verification before design.
- FramePublisher / arch-A per-frame readback cleanups — confirmed dormant
  under arch-C; removal belongs to MT-13 (legacy removal).
- The `layout/viewport-rect` bridge binding removal — test-only code, not in
  the hot path (red herring per the investigation); comment fix only (D).
- x86/legacy behaviour changes — legacy is opt-out and slated for MT-13.

## 2. What the codebase already gives us

All verified this session against `9a7f06c`:

- **The per-tick reset chain:** `WM_WINDOWPOSCHANGED` →
  `layout.PredictAndApply()` + `RenderD3D9()` ([HostWindow.cpp:2344-2348](../src/host/HostWindow.cpp));
  `PredictAndApply` → `m_engine->Reset()` on any size change
  ([LayoutBroker.cpp:251-254](../src/host/LayoutBroker.cpp)); `Engine::Reset`
  full teardown incl. `m_textureManager.OnLostDevice()` cache wipe
  ([engine.cpp:1351-1473](../src/engine.cpp), [main.cpp:240-244](../src/main.cpp));
  `AlphaCompositor::Resize` transactional rebuild minting a new NT shared
  handle + SYSTEMMEM surface + DIB per size change
  ([AlphaCompositor.cpp:115-183](../src/host/AlphaCompositor.cpp)).
- **The dock-slide template (fix A's machinery, already built):**
  `LayoutBroker::StartSceneAnim` (:410) / `AdvanceSceneAnim` (:450, driven
  per-frame from [HostWindow.cpp:826](../src/host/HostWindow.cpp)) /
  `CancelSceneAnim`; `Compositor::SetEngineVisualTransform`
  ([Compositor.cpp:1295](../src/host/Compositor.cpp), idempotent, deferred-commit
  capable); the web-side suppression precedent (`useDockAnim` zustand signal
  mirrored into a ref, [ViewportSlot.tsx:57-67](../web/apps/editor/src/components/ViewportSlot.tsx)).
- **The uncapped pump:** `PeekMessage` drain + unconditional `RenderD3D9()`
  per iteration ([HostWindow.cpp:3369-3428](../src/host/HostWindow.cpp));
  capture mode already paces with `Sleep(16)` — precedent for pacing without
  breaking sim timing. `WaitEndFrameQuery` already **returns its spin count**
  ([engine.cpp:1521-1535](../src/engine.cpp)) — instrumentation-ready.
- **The scene-rect stream:** `ResizeObserver` → `bridge.request` per display
  frame, plus `window resize` + scroll + DPR listeners all funnelling into
  the same `send()` ([ViewportSlot.tsx:73-122](../web/apps/editor/src/components/ViewportSlot.tsx));
  host side is alpha-mask-only (`m_layout.SetSceneRect`,
  [BridgeDispatcher.cpp:920-929](../src/host/BridgeDispatcher.cpp) — no Reset).
- **Erase/paint state:** the *popup's* wndproc already returns 1 on
  `WM_ERASEBKGND` ([HostWindow.cpp:2502-2504](../src/host/HostWindow.cpp));
  the **main** window class has `CS_HREDRAW|CS_VREDRAW` (:3104) and a non-null
  dark-purple `m_classBrush` (:3119-3120) with **no** erase handler → DefWindowProc
  GDI-fills the full client every tick. `put_Bounds` full-client resize in
  `ResizeWebViewToClient` (:962-975).
- No existing `WM_ENTERSIZEMOVE`/`WM_EXITSIZEMOVE` handlers — clean slate
  (a comment at :2351-2362 explains why popup-*hiding* during sizemove was
  rejected; fix A does not hide anything).
- `Log()` host logger + `#ifndef NDEBUG` instrumentation convention.

## 3. Architecture / implementation approach

### Phase 0 — instrumentation (no behaviour change)

Four probes, all `#ifndef NDEBUG`, all logging at ≤1 Hz aggregate under a
greppable `[resize-perf]` tag:

1. QPC bracket around `m_engine->Reset()` in `PredictAndApply` — count +
   min/avg/max ms. Expected: 30–60/sec × 10–100 ms during border drag; 0
   during splitter/dock.
2. Sub-stage split inside one `Engine::Reset` (texture wipe+reload vs
   `AlphaCompositor::Resize` vs device `Reset`) — sizes the A2 payoff for
   later.
3. scene-rect msgs/sec counter in the `layout/scene-rect` dispatcher branch.
4. `WaitEndFrameQuery` spin count + idle-loop fps, 1 Hz, in the main pump.

Run a border drag / splitter drag / dock toggle, paste numbers into the
Phase-1 PR description. If the numbers contradict the ranking, STOP and
re-plan (per CLAUDE.md).

### Phase 1 — Fix A (defer Reset to gesture settle) + Fix D riders, one PR

**A — the state machine** (all host-side, no web changes):

- New `m_inSizeMove` flag on `HostWindowImpl`, set/cleared by new
  `WM_ENTERSIZEMOVE`/`WM_EXITSIZEMOVE` cases in the **main** wndproc.
- While set, `LayoutBroker::Apply` (the `PredictAndApply` path) still does
  `SetWindowPos` on the popup + caches the new rect, but **skips
  `m_engine->Reset()`** and instead routes the new rect through
  `SetEngineVisualTransform` (the dock-slide path) so the DComp engine visual
  stretches the last-presented surface to the new rect. The forced
  `RenderD3D9()` in the `WM_WINDOWPOSCHANGED` handler is also skipped while
  in-sizemove (it exists solely to repaint after the per-tick Reset).
- On `WM_EXITSIZEMOVE`: ONE `Engine::Reset` + `RenderD3D9` + authoritative
  transform commit. Net: 30–60 resets/sec → 1 per gesture.
- **Quiescence fallback** (belt-and-braces): a ~100 ms one-shot timer armed
  by any size-changing `WM_WINDOWPOSCHANGED`; if it fires and the cached
  popup size ≠ engine backbuffer size, do the settle Reset. Covers
  maximize/snap/keyboard resizes (single-shot events — these already work via
  the immediate path today and stay immediate; the timer is purely a safety
  net for a lost `WM_EXITSIZEMOVE` leaving the flag stuck).
- **Arch gating:** the skip applies only when the DComp compositor is
  attached (arch-C). Legacy arch-A keeps today's per-tick behaviour — it's
  opt-out-only and slated for removal (MT-13); not worth designing around.

**D — riders in the same PR:**

- `WM_ERASEBKGND → return 1` on the **main** window *while in sizemove*
  (keep `m_classBrush` for first-paint and normal invalidation — it's the
  deliberate dark-purple theme, and the comment at :2359-2362 records a prior
  white-flash incident class).
- Throttle `ResizeWebViewToClient`'s `put_Bounds` to ~30 Hz during sizemove,
  with one exact final call on settle.
- Fix the misleading comment at [BridgeDispatcher.cpp:916-919](../src/host/BridgeDispatcher.cpp)
  (`Engine::Reset` is NOT "bound to layout/viewport-rect" in production —
  the live driver is native `PredictAndApply`; the bridge binding is
  test/poc-only).
- `CS_HREDRAW|CS_VREDRAW` removal: **deferred to the feel-check** — cheap to
  try, but it changes invalidation behaviour for every paint, not just
  sizemove; only do it if the user still sees flicker with the erase fix in.

### Phase 2 — Fix B (pace the pump, yield the spin), separate PR

- Replace the busy `PeekMessage`-loop idle with
  `MsgWaitForMultipleObjectsEx(0, nullptr, budgetMs, QS_ALLINPUT, …)` where
  `budgetMs` derives from a ~display-rate frame budget — render once per
  wake, not once per loop spin. Capture mode keeps its existing `Sleep(16)`
  pacing (unchanged path).
- `WaitEndFrameQuery`: `SwitchToThread()` between `GetData` polls (keeps the
  100k cap + degraded-mode semantics; just stops burning the core).

### Phase 3 — Fix C (the stream + the judder), staged

- **C1** (~half-day): last-rect dedupe in `send()` (key includes DPR, see
  risk 6) + drop the `window resize` listener (RO on the element already
  fires for every real size change — verify with probe 3 before/after).
- **C2**: `layout/scene-rect` becomes fire-and-forget (one-way post) +
  NDEBUG-gate the per-message host-log flush and the `SetSceneViewport`
  `printf`+`fflush` ([engine.cpp:1705-1711](../src/engine.cpp)).
- **C3** (judder, ~2-3 d): extend the dock-slide pattern to splitter drags —
  suppression signal on splitter pointer-down, host treats incoming rects as
  **targets** and lerps on its QPC clock via the existing `AdvanceSceneAnim`
  machinery (target-chasing variant), one authoritative settle rect on
  pointer-up. Scope it after B's feel verdict — B alone may reduce the judder
  enough to demote C3.

## 4. Risks + mitigations

1. **Mid-gesture stretched frame looks blurry/smeared.** While in sizemove
   the engine visual is the last-presented frame stretched to the new rect.
   Mitigation: this is exactly the dock-slide's proven behaviour and the
   OS-standard look for D3D apps during resize; settle reset snaps it crisp.
   User feel-check is the gate (L-033). If unacceptable, fallback is a
   cheap throttled reset (e.g. max 4/sec) instead of zero mid-gesture resets.
2. **Lost `WM_EXITSIZEMOVE` leaves the engine permanently un-reset** (stale
   backbuffer size, wrong aspect). Mitigation: the 100 ms quiescence timer
   fires the settle reset whenever cached-size ≠ backbuffer-size; additionally
   `Render`'s existing recovery path papers over failed resets (engine.cpp
   comment :1374-1377) — verified live before relying on it.
3. **Erase suppression reintroduces flash on expand.** The dark brush erase
   is what paints newly-exposed client area before WebView2 catches up.
   Mitigation: suppress only during sizemove where the per-tick fill is pure
   cost (WebView2 repaints continuously anyway); keep the brush for the
   normal path; rider is independently revertable. Feel-check gates it.
4. **`put_Bounds` throttle makes the WebView visibly lag the window edge.**
   Mitigation: 30 Hz is still well under the noticeable-lag threshold for
   chrome during resize (and Chromium itself coalesces); exact final bounds
   on settle; revert independently if the user sees it.
5. **B changes timing for capture mode / test-host / a11y harness** (the
   harness already runs at a degraded 4 FPS under agent launch, L-033).
   Mitigation: capture-mode path untouched; full a11y suite (174 expected) +
   the user's live launch are the gates; budget pacing is a separate commit
   from the spin-yield so either can be reverted alone.
6. **C1 dedupe drops a rect the host needs after a DPR change** (same CSS px,
   different backing size). Mitigation: include `devicePixelRatio` in the
   dedupe key; the DPR listener path stays un-deduped.
7. **Arch-A (legacy `--legacy`) regression risk from A/B/D.** Mitigation:
   skip-Reset is gated on the DComp compositor being attached; B's pump
   pacing applies to both but legacy is x86/opt-out and MT-13-doomed — verify
   it still launches, accept minor feel differences there.

## 5. Testing & verification

**Instrumentation (Phase 0 numbers, before/after each phase):**
- [ ] Border drag: Reset count/sec drops 30–60 → ~0 mid-gesture, 1 on settle.
- [ ] Splitter drag: scene-rect msgs/sec measured before C1, after C1, after C2.
- [ ] Idle pump: fps capped ≈ display rate after B; `WaitEndFrameQuery` spin
      time no longer a full-core burn (probe 4).
- [ ] Dock toggle: still exactly 1 `animate-scene-rect`, 0 resets (regression).

**Suites (every PR):**
- [ ] web vitest 636 (+ any new tests), `tsc -b` 0, vite build clean.
- [ ] native a11y harness 174/0, zero golden diff (no a11y surface change).
- [ ] host Debug + Release x64 build clean (benign LNK4098 only).

**Manual host pass (user, L-033 — per phase):**
- [ ] Border drag (each edge + corner), slow and violent jiggle.
- [ ] Maximize / restore / Win+arrow snap / double-click title bar.
- [ ] Splitter drags: left panel, right panel, bottom panel; slow + fast.
- [ ] Dock open/close slide regression (must stay smooth).
- [ ] Post-settle correctness: aspect right, no stale stretch, particles
      render, ground/skydome textures back (cache reload), scene rect
      crisp at the clip edges.
- [ ] Minimize → restore; Alt-Tab mid-drag; DPI/monitor swap if available.
- [ ] `--legacy` cold launch smoke (arch-A unaffected).

**Debug instrumentation:** `[resize-perf]` printf tag, `#ifndef NDEBUG`,
≤1 Hz aggregates — stays in the tree (cheap, gated) for future regressions.

---

## Progress

- [x] Pre-flight: lineage clean (HEAD == origin/master == `9a7f06c`); L-039
      NuGet + L-040 dist restored; web 636/636, `tsc -b` 0, vite build clean;
      host Debug x64 clean (LNK4098 benign); native harness 174/0 (30 skipped).
- [x] All investigation claims re-verified against code (file:line anchors
      in §2 above). One precision upgrade: the per-tick `WM_ERASEBKGND` fill
      happens on the **main** window (popup already suppresses it).
- [x] User confirmed scope 2026-06-10 ("proceed as proposed").
- [x] Phase 0 instrumentation (`9088838`) — wmpos/reset-substage/bridge
      probes; probe 4 (pump fps + spins) already existed as `[PERF]`.
      Deviation from plan: probes are **always-on** (matching the existing
      `[PERF]` precedent) instead of NDEBUG-gated — 1 Hz aggregates,
      negligible cost, and they work in the Release builds users run.
- [x] Phase 1: Fix A + D (`8550f07`) — **smoked with a programmatic
      sizemove storm** (`tasks/tool-sizemove-storm.ps1` documents the
      repro; run inline against the live editor):
      - control (no bracket): 21 ticks/s = **21 resets/s** @ ~27 ms/tick
        (reset tot ~24 ms, reload stage ~20 ms = texture re-decode —
        sizes the A2 payoff);
      - bracketed: **0 resets** mid-gesture @ **0.9 ms/tick** (30×),
        one `settle (exitsizemove)`;
      - bridge probe: scene-rect **42/s vs ~21 ticks/s** — confirms the
        2× redundant window-resize listener (C1 target);
      - `[PERF]` idle: **fps≈3000, spins≈4000/frame** — confirms B's
        uncapped-pump target.
      Native harness 174/0; Debug + Release x64 clean. Editor healthy
      (responding, no error lines) after both storms.
- [x] **Phase 1 REVISED after the user's feel verdict** (2026-06-10:
      "I really dislike the snap at the end … almost feels like a
      regression"). Deferral design replaced with **cheap per-tick
      resets** (→ L-078):
      - New `Engine::ResetForResize()`: `IDirect3DDevice9Ex::ResetEx`
        (first-party docs: "all other surfaces persistent" / textures,
        shaders, state NOT lost) + rebuild of size-keyed RTs only.
        Verified against learn.microsoft.com before building.
      - All three LayoutBroker reset sites funnel through ONE
        `ResetEngineForResize` helper (cheap → full `Reset()` fallback →
        `RecoverDeviceIfNeeded`); settle/quiescence machinery kept as a
        no-op safety net; `put_Bounds` 30 Hz throttle REVERTED (feel
        suspect, L-078 corollary 1).
      - Storm smoke on the revised build: every tick resets on the cheap
        path (zero fallbacks), reset tot **3.5-4.0 ms** (was ~24 ms;
        reload stage 20 ms → 0.4 ms), apply+render 12-14 ms/tick (was
        27 ms), no settle snap by construction. Harness 174/0,
        Debug + Release clean.
      **Awaiting the user's SELF-LAUNCHED feel verdict (L-033 +
      L-078 corollary 2) before Phase 2.**
- [x] Phase 2: Fix B (branch `claude/resize-perf-phase2`, two commits:
      B2 `c33cc08` spin-yield, B1 `1bed29a` paced pump). Measured on the
      240 Hz dev box: **rps 3000 → ~190**, idle CPU **one full core →
      ~20%**, GPU wait avg ~0.3 ms. Input wakes the pump instantly
      (MsgWaitForMultipleObjectsEx + MWMO_INPUTAVAILABLE), so latency is
      unchanged; capture mode untouched. `[PERF]` line gains `rps=`
      (true cadence — the fps field is 1/frame-cost and can't show the
      cap). Regression: resize storm still all-cheap resets + one
      settle; native harness 174/0; Debug + Release clean.
      **Awaiting the user's splitter-drag feel verdict (L-033,
      self-launched).** Phase 1's FOV anchor + the #117 dock fixes are
      independent of this branch.
- [x] Phase 3: Fix C1+C2+C3 (same branch — user verdict on B was "still
      stutters", so C3 was promoted). Attribution FIRST (per-kind bridge
      probe + real-mouse SendInput driver,
      `tasks/tool-splitter-drag-probe.mjs`): drag stream =
      layout/scene-rect 22-28/s; the user's ~104/s mystery =
      viewport/input at mouse rate over the viewport (functional arch-C
      input traffic). C1 `e66f811`: (rect,DPR) send dedupe. C2+C3
      `a2e7418`: scene-rect stream → host-clocked LINEAR chase lerps
      (duration = inter-arrival gap 16..100ms, supersede-on-next;
      dock anim still authoritative); per-message log hygiene (WebMsg
      skip for interactive kinds, SetSceneViewport printf 1 Hz,
      transform log quiet-on-anim-frames → 3s drag = ~50 log lines, was
      200+). Two native specs re-pinned to the new timing contract
      (dispatch spacing > the 250ms stream window; snapshot waits out
      the ≤100ms chase). Suites: web 637, tsc 0, native 174/0,
      Debug + Release clean.
      **Awaiting the user's splitter-drag feel verdict (self-launched).**
- [x] **C3 REVERTED after the user''s feel verdict** (2026-06-10: "app
      resize is worse — background colour in newly revealed area for a
      second; splitter still laggy, viewport lags then snaps"). Root
      causes: (a) chase steady-state lag = one packet interval, and the
      real stream under load is ~12/s → 80-160ms lag + end snap; (b)
      window resizes starve chases (PredictAndApply cancels the anim
      per size tick) → the clip crawls behind the revealed area. →
      L-079: smoothing cannot beat the data rate; the residual splitter
      stutter is Chromium''s own relayout cadence under drag. C1+C2+B
      kept (all objective, no feel change); both specs reverted to the
      instant-apply contract; harness 174/0, Debug+Release clean.
      **Remaining stutter is producer-side (Chromium relayout rate
      under drag) — further work would mean raising the data rate or
      panel-content virtualization, not host smoothing. Scope with the
      user before any Phase 4.**
