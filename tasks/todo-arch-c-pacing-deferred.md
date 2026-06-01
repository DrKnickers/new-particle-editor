# arch-C render loop: frame pacing + cooperative GPU wait ("idle cool")

> **STATUS: DEFERRED (2026-05-31).** Not worth the risk right now. Measured
> idle draw of the running editor was **~20% of one core / ~1% of total CPU**
> (20-core desktop) — far below the "~100% of a core" originally *inferred*
> from the `[PERF]` frame timer (the inference was wrong; CPU% is the metric
> that matters and it's small here). The benefit is purely thermal/power and
> negligible on this hardware; the change touches the host message loop (the
> app's most delicate code path). Plan below is complete and ready to execute
> **if** the editor is ever observed running hot/loud under real use, or on a
> thermally-constrained laptop. Pick up from here — no code was written.

**Branch:** `lt-4` (session branch `claude/admiring-banach-4f9931`).
**Status:** PLAN (DEFERRED) — ready to execute; awaiting a real need + sign-off (★★★★).
**Prior context:** the perf fix that removed the redundant readback shipped
(`5aa8b3d`); `[PERF]`/`[PERF2]` instrumentation is in. The arch-C/perf
measurement plan (rounds 1–3) is in git history at `398964e`.

After that fix, the host thread pegs ~1 CPU core: the render loop is uncapped
(~2380 FPS at maximized — far past any display refresh) and `WaitEndFrameQuery`
busy-spins with a per-iteration flush (~385 µs / ~9000 spins per frame, ~92% of
the frame). FPS is fine; the cost is wasted CPU / heat / battery while idle.
Keyed-mutex sync is **not available** for this D3D9Ex→D3D11 share (verified:
[AlphaCompositor.cpp:141](../src/host/AlphaCompositor.cpp:141) creates the
texture via D3D9 `CreateTexture` + shared handle; D3D11 opens it with plain
`OpenSharedResource` [Compositor.cpp:869](../src/host/Compositor.cpp:869) — no
`IDXGIKeyedMutex` on the D3D9 side). The event query is the correct primitive;
the fix is to **wait cooperatively** and **render no faster than the display**.

## 1. Goal + scope

**Goal.** Make arch-C idle cool: cap the render loop to the monitor refresh and
replace the busy-spin with a cooperative wait, so the editor stops burning a
core while open. No change to visible smoothness or input latency.

**In:**
- **Frame pacing** in the interactive render loop
  ([HostWindow.cpp:2833](../src/host/HostWindow.cpp) Run loop): render at most
  once per display-refresh interval, using a high-resolution waitable timer +
  `MsgWaitForMultipleObjects(QS_ALLINPUT)` so input/WebView2 messages still wake
  the loop immediately (responsiveness unchanged).
- **Cooperative wait** in `Engine::WaitEndFrameQuery`
  ([engine.cpp:1472](../src/engine.cpp:1472)): flush once, then poll without
  re-flushing; `YieldProcessor()` for a short fast-path spin, then
  `SwitchToThread()` for longer waits. Keep the spin-count return for `[PERF]`.
- **CPU-before/after measurement** via process CPU time (the real metric), plus
  the existing `[PERF]` lines, windowed + maximized.

**Out (deferred):**
- **Render-on-demand / idle-down when paused** — dropping below the refresh cap
  when nothing is animating (preview paused, no drags). Needs dirty-state
  plumbing; the fixed refresh cap already gets ~95% of the win. Separate item.
- **Keyed mutex / true fence wait** — infeasible for D3D9Ex (see above); would
  require porting the engine off D3D9. Explicitly not attempted.
- **`--capture` loop** — keeps its own `Sleep(16)` pacing; the new pacing is
  gated to the interactive (`!captureMode`) engine-present path only.

## 2. What the codebase already gives us

- The interactive loop: `PeekMessage` drain → `RenderD3D9()` → repeat, with
  `WaitMessage()` only on the no-engine branch
  ([HostWindow.cpp:2833](../src/host/HostWindow.cpp)). No pacing today.
- `RenderD3D9()` already gates the composite path on `m_compositionMode`; the
  `[PERF]`/`[PERF2]` timers + 1 Hz emit are in place to measure this.
- `Engine::WaitEndFrameQuery` already returns its spin count (round-1 change).
- `captureMode` flag distinguishes the headless path that must NOT be paced.

## 3. Architecture / implementation approach

**(a) Cooperative wait** — `Engine::WaitEndFrameQuery`:
```cpp
int Engine::WaitEndFrameQuery() {
    if (m_pEndFrameQuery == NULL) return 0;
    BOOL done = FALSE;
    // Flush ONCE so the engine's commands are submitted, then poll without
    // re-flushing. Short YieldProcessor spin handles the common fast case;
    // longer waits SwitchToThread so the OS can reclaim the core. D3D9Ex has
    // no waitable fence handle, so polling is the only option — but make it
    // cooperative instead of a pegged busy-spin.
    if (m_pEndFrameQuery->GetData(&done, sizeof(done), D3DGETDATA_FLUSH) != S_FALSE)
        return 0;
    int spins = 0;
    for (;;) {
        if (m_pEndFrameQuery->GetData(&done, sizeof(done), 0) != S_FALSE) break;
        if (++spins < 64) YieldProcessor();        // ~ _mm_pause, low latency
        else              SwitchToThread();         // yield the core
        if (spins > 2000000) { OutputDebugStringA("[Engine] sync query stuck\n"); break; }
    }
    return spins;
}
```
`YieldProcessor()` / `SwitchToThread()` are Win32 (no new include beyond
windows.h). Same correctness (returns only when GPU-done or errored), no
per-iteration flush, cooperative.

**(b) Frame pacing** — a `PacedFrameWaiter` around the interactive loop:
- Query the primary monitor refresh once at startup (`DwmGetCompositionTimingInfo`
  `rateRefresh`, fallback `GetDeviceCaps(VREFRESH)`, fallback 60; clamp [30,240]).
  Frame period = 1/refresh.
- Create a `CreateWaitableTimerExW(..., CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
  TIMER_ALL_ACCESS)`; fall back to a normal waitable timer if unsupported.
- Loop becomes:
  ```
  drain PeekMessage  (unchanged)
  if engine && !captureMode:
      RenderD3D9()
      schedule timer for (lastFrame + period); lastFrame = deadline
      MsgWaitForMultipleObjects(1, &hTimer, FALSE, INFINITE, QS_ALLINPUT)
        // wakes on timer (→ next frame) OR input/WebView2 msg (→ drain, re-wait)
  else if captureMode: existing Sleep(16) path (unchanged)
  else: WaitMessage()  (no-engine, unchanged)
  ```
  On a message wake before the deadline, we drain and re-wait on the still-pending
  timer — so input is serviced immediately but we don't render an extra frame.
- DComp composites at refresh regardless, so rendering at refresh is the matched,
  correct cadence; anything faster was invisible waste.

**(c) Measurement.** Before/after process CPU% (`Get-Process` CPU-time delta over
a fixed wall window) at idle-maximized and idle-windowed, plus `[PERF]` (note its
`fps` field now reports render-cost headroom, not the paced rate — a real-interval
log line can be added if useful).

## 4. Risks named up front + mitigations

1. **UI responsiveness regression.** *Hazard:* if the paced wait doesn't wake
   promptly on input, dragging splitters / scrubbing spinners / typing feels
   laggy. *Mitigation:* `MsgWaitForMultipleObjects(..., QS_ALLINPUT)` wakes on
   ANY input immediately; we drain and render within ≤1 frame period (~7–16 ms),
   no worse than today (where input already waits for the in-flight uncapped
   frame). Verify by feel: splitter drag, spinner scrub, typing, emitter switch,
   play/pause. **User confirms on-screen** (L-033: agent can't judge this).
2. **High-resolution timer unsupported / coarse.** *Hazard:* old Windows lacks
   `CREATE_WAITABLE_TIMER_HIGH_RESOLUTION`; a coarse timer over-/under-shoots the
   cap. *Mitigation:* feature-detect, fall back to a normal waitable timer; the
   cap precision is non-critical (120 vs 130 FPS both fine). Never use a blunt
   `Sleep` (would block the pump).
3. **Capture / no-engine branches.** *Hazard:* pacing breaks `--capture`
   determinism or the idle no-engine wait. *Mitigation:* gate pacing to
   `engine && !captureMode`; leave the `Sleep(16)` capture path and the
   `WaitMessage()` no-engine path byte-unchanged. Build + run `--capture` to
   confirm.
4. **Refresh query returns 0 / multi-monitor.** *Mitigation:* fallback chain
   (DWM → GDI → 60) + clamp [30,240]. Re-query is not needed for v1 (moving the
   window to a different-refresh monitor keeps the original cap — acceptable;
   note as a known limitation).
5. **Native test/a11y harness timing.** *Hazard:* the harness launches the host;
   pacing changes render cadence. *Mitigation:* messages still pump, CDP/bridge
   unaffected, zero DOM change → ARIA goldens unaffected. The harness drives via
   bridge, not render rate. Low risk; note, don't regen goldens (L-033).
6. **Cooperative wait still busy under load.** *Hazard:* `SwitchToThread()`
   returns immediately when no other thread is ready, so it can still spin. *Mit:*
   acceptable — combined with pacing the wait runs only ~refresh times/sec, so
   total spin time is small (~refresh × 385 µs ≈ a few % of a core). The safety
   cap prevents a hung-GPU infinite loop.

## 5. Testing & verification

**Build:**
- [ ] Release + Debug x64 build clean (`.sln`, PowerShell; L-023/L-025); binaries exist.
- [ ] No web changes → vitest (371) + a11y goldens untouched by construction (state, don't run/regen).

**CPU (the real metric):**
- [ ] Idle-maximized: process CPU% before (expect ~100% of a core) vs after (expect single digits). Same for idle-windowed.
- [ ] `[PERF]` shows `wait` no longer dominated by per-flush spin; spin counts drop or yield.

**Pacing correctness:**
- [ ] Rendered cadence ≈ monitor refresh (add a temporary real-interval log if needed); not 2380.
- [ ] DComp still presents every frame (`[COMP-engine-frame]` heartbeat advances at ~refresh).

**Responsiveness (USER confirms — L-033):**
- [ ] Splitter drag, spinner scrub, text typing, emitter selection, tab switch, play/pause all feel as responsive as before.
- [ ] Viewport playback looks smooth at the cap (no visible stutter).

**Edge cases:**
- [ ] `--capture <alo> <png>` still works (own Sleep(16) path; produces PNGs).
- [ ] No-engine startup window (before a scene loads) doesn't spin (WaitMessage path intact).
- [ ] Window resize / maximize-restore still smooth (pacing doesn't fight the resize loop).

**Debug instrumentation:** reuse `[PERF]`; add a one-shot `[host] paced to N Hz`
log at startup (refresh source + value). No new always-on noise.

---

## Review
_(to be filled after implementation + measurement)_
