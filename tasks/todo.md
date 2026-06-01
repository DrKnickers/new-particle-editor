# arch-C per-stage frame timing — measurement pass (Approach A, round 1)

**Branch:** `lt-4` (session branch `claude/admiring-banach-4f9931`).
**Status:** PLAN — awaiting user review before any code.

The user reports the arch-C (new-UI) editor *feels slow / janky in real
use, worst when maximized / on a large window*. "Worse when maximized"
is an area-scaling signal. This round does **not** fix anything — it adds
per-stage frame timing so we can localise *which* stage's cost grows with
pixel count, then a follow-up round fixes the proven stage with
before/after proof.

**I (Claude) do the launch + capture this round** (user's explicit call),
accepting the L-033 agent-launch degradation (~4 FPS, engine unclipped).
Absolute FPS under my launch is unrepresentative; the analysis therefore
reads **per-stage ratios + area-scaling** (maximized vs windowed under the
same launch) and **spin counts**, never the headline FPS.

---

## 1. Goal + scope

**Goal.** Turn "arch-C feels slow when maximized" into per-stage µs timing
in `host.log`, captured by me, that names the area-scaling bottleneck
(`render` GPU fill, `wait` busy-spin, or `composite` cross-device copy)
before any fix is designed.

**In:**
- Per-stage QPC timing in `RenderD3D9()` composition path: `update`,
  `render`, `wait`, `composite`, plus whole-`frame` total.
- `Engine::WaitEndFrameQuery()` returns its spin count (currently `void`)
  so `wait` pressure is logged as a hard number.
- 1 Hz accumulate-and-emit to `host.log` under a `[PERF]` prefix, with the
  current client `win=WxH`. Accumulators reset each emit.
- **Always-on** (no env var / flag): QPC is ~free, it logs once a second,
  and it requires zero launch-mode change — extends the existing
  unconditional `[COMP-engine-frame]` 1 Hz diagnostic.
- I launch the Release build `--new-ui`, drive maximized vs windowed,
  read `%LOCALAPPDATA%\AloParticleEditor\host.log`, tabulate, and report
  the dominant area-scaling stage.

**Out (deferred, by design):**
- **The actual fix** — separate round once the data names the stage
  (blocking-wait if `wait`; copy-elimination/optimisation if `composite`;
  engine-side if `render`). Naming the fix now would be guessing.
- **Splitting `composite` into copy-vs-present** — round 1 times the whole
  `CompositeEngineFrame` call from the host; if `composite` dominates, a
  round-2 sub-split is cheap. (The spike already measured Present ≈ 0.30 ms
  at 3440×1440, so copy is the expected sub-culprit, but we won't assert it
  without the split.)
- **Gating / removing the instrumentation** — decide after the fix lands
  (keep as a permanent `[PERF]` diagnostic like `--capture`/`--skydome`, or
  gate behind a flag). Out-of-scope for the measurement round.
- **arch-B / legacy layered path** — its 19 MB `GetRenderTargetData`
  readback in `AlphaCompositor::Composite` is a different path; not touched.

## 2. What the codebase already gives us

- **Stage call sites**, all in one place — `HostWindowImpl::RenderD3D9()`
  ([src/host/HostWindow.cpp:708](../src/host/HostWindow.cpp:708)):
  `engine->Update()` (727), `engine->Render()` (728),
  `engine->WaitEndFrameQuery()` (749), `CompositeEngineFrame()` (758).
- **QPC precedent** — `FPSMeasurer`
  ([HostWindow.cpp:91](../src/host/HostWindow.cpp:91)) already uses
  `QueryPerformanceCounter`/`Frequency`; FD10 swapped `GetTickCount`→QPC
  precisely because µs resolution is needed at hundreds of FPS.
- **1 Hz throttle pattern** — `CompositeEngineFrame`'s `[COMP-engine-frame]`
  emit ([Compositor.cpp:1130](../src/host/Compositor.cpp:1130)) uses
  `GetTickCount()` deltas ≥ 1000 ms; mirror it host-side.
- **Per-frame phase-timing prior art** — `[CACHE-DEFERRAL-PERF]`
  ([AlphaCompositor.cpp:787](../src/host/AlphaCompositor.cpp:787)).
- **Window size** — `GetClientRect(hMain, …)` already used inside the impl
  ([HostWindow.cpp:800](../src/host/HostWindow.cpp:800)).
- **The spin** — `Engine::WaitEndFrameQuery()`
  ([engine.cpp:1472](../src/engine.cpp:1472)) busy-spins
  `GetData(..., D3DGETDATA_FLUSH)`; `spins` is already counted locally, just
  not returned. Author's own note: *"Present is essentially free, the spin
  in WaitEndFrameQuery dominates"* ([Compositor.cpp:1083](../src/host/Compositor.cpp:1083)).
- **`host.log`** — `Log(...)` / `CloseLog()` already wired; new-UI session
  banner at [HostWindow.cpp:662](../src/host/HostWindow.cpp:662).

## 3. Architecture / implementation approach

**(a) `Engine::WaitEndFrameQuery()` → return spin count.**
`void` → `int` (number of `GetData` spins; 0 = signalled first poll;
100000 = hit the cap). One signature change in `engine.h` + the definition;
the single call site in `RenderD3D9` consumes the return. No behaviour
change otherwise.

**(b) Host-side per-stage accumulator.** A small POD on `HostWindowImpl`:
```cpp
struct PerfStage { double sumUs = 0; double maxUs = 0; unsigned n = 0;
                   void add(double us){ sumUs+=us; if(us>maxUs)maxUs=us; ++n; }
                   double avg() const { return n ? sumUs/n : 0.0; }
                   void reset(){ sumUs=0; maxUs=0; n=0; } };
// members: PerfStage perfUpdate, perfRender, perfWait, perfComposite, perfFrame;
// unsigned long long perfWaitSpinsSum = 0; unsigned perfWaitSpinsMax = 0;
// DWORD perfLastEmitTick = 0;
```
QPC→µs helper local to the TU (reuse the QPC frequency captured once).

**(c) `RenderD3D9()` instrumentation.** Wrap each stage:
```cpp
auto t0 = QpcNow();
engine->Update();                  double uUs = QpcDeltaUs(t0); auto t1 = QpcNow();
engine->Render();                  double rUs = QpcDeltaUs(t1);
fpsMeasurer.measure();
// composition block:
auto t2 = QpcNow();
int spins = engine->WaitEndFrameQuery();   double wUs = QpcDeltaUs(t2); auto t3 = QpcNow();
m_compositor->CompositeEngineFrame(...);   double cUs = QpcDeltaUs(t3);
// frame total = QpcDeltaUs(t0)
perfUpdate.add(uUs); perfRender.add(rUs); perfWait.add(wUs);
perfComposite.add(cUs); perfFrame.add(QpcDeltaUs(t0));
perfWaitSpinsSum += spins; perfWaitSpinsMax = max(perfWaitSpinsMax, spins);
```
Only the composition branch (`m_compositionMode && m_compositor->IsReady()`)
records `wait`/`composite`; `update`/`render`/`frame` always record.

**(d) 1 Hz emit.** After the stage adds, if `GetTickCount() - perfLastEmitTick
>= 1000`:
```
[PERF] win=WxH fps=NN frame avg/max  update a/m  render a/m  wait a/m spins avg/max  composite a/m  (us)
```
`fps` derived from `perfFrame.avg()` (1e6/avg) — logged for sanity, NOT
treated as the user's real FPS. Then reset all accumulators + spin sums.

**(e) Capture procedure (me).**
1. Build Release x64 via PowerShell against the `.sln` (L-023/L-025);
   verify `x64\Release\ParticleEditor.exe` exists.
2. `pnpm --filter @particle-editor/editor build` is **not** needed (no web
   change) — but confirm `dist/` is composition so `--new-ui` runs arch-C.
3. `Start-Process` the exe `--new-ui`; load a representative scene (the
   daily-driver mod/`.alo` if known, else a built-in with live particles).
4. Let it run windowed ~15 s; `ShowWindow(SW_MAXIMIZE)` (or drag) ~15 s;
   allow ~3 s settle after each resize before trusting steady-state lines
   (resize triggers the `RefreshEngineSharedHandle` re-open path).
5. Read `host.log`; extract `[PERF]` lines for each size; tabulate.

## 4. Risks named up front + mitigations

1. **L-033 — my launch misrenders arch-C (~4 FPS, unrepresentative
   absolute FPS).** *Hazard:* reading the headline FPS as if it were the
   user's experience would mislead. *Mitigation:* the analysis reads
   per-stage **ratios** and **area-scaling** (max vs windowed within the
   same degraded launch) + **spin counts**, never absolute FPS. A stage
   whose `avg` grows ≈linearly with pixel count between the two window
   sizes is the area-scaling culprit regardless of the absolute frame rate.
   If `wait` spins toward 100k, that single hard number explains both the
   agent degradation and (plausibly) the user's maximized jank.
2. **Degraded path ≠ healthy path.** *Hazard:* the agent-launch
   degradation could itself distort stage costs so the dominant stage
   differs from the user's healthy run. *Mitigation:* round-1 output is a
   **hypothesis**, explicitly labelled; before committing the fix I confirm
   the named stage is consistent with the engine code's structural cost
   (e.g. `composite`=full-surface copy genuinely scales with area) and, if
   ambiguous, ask the user to run the same always-on build and send their
   `host.log` (the instrumentation is launch-mode-agnostic — their healthy
   run produces the same `[PERF]` lines, no code change needed).
3. **Timing overhead skews results.** *Hazard:* QPC calls inflate stage
   times. *Mitigation:* ~5–6 `QueryPerformanceCounter` calls/frame at
   ~20 ns each ≈ 0.1 µs vs millisecond stages — below noise. Accepted, not
   designed around.
4. **`WaitEndFrameQuery` signature change ripples.** *Hazard:* `void`→`int`
   touches `engine.h` + the call site; a missed caller fails to build.
   *Mitigation:* it has exactly one production caller (`RenderD3D9`); grep
   `WaitEndFrameQuery` confirms before/after; build **both** Debug+Release.
5. **Always-on `[PERF]` noise in `host.log`.** *Hazard:* clutters the log
   for unrelated future debugging. *Mitigation:* 1 Hz only, single line,
   distinct prefix; on `lt-4` the log already carries `[COMP-*]` dev lines.
   Gating/removal is an explicit out-of-scope item revisited post-fix.
   Accepted for the measurement round.
6. **Resize mid-capture transients.** *Hazard:* the resize re-open path
   produces atypical frames right after maximize. *Mitigation:* 3 s settle
   before trusting steady-state lines; read several consecutive 1 Hz lines
   per size and use the median, not the first post-resize line.

## 5. Testing & verification

**Build:**
- [ ] Release x64 builds clean via PowerShell `.sln`; `x64\Release\ParticleEditor.exe` exists (L-025 floor).
- [ ] Debug x64 builds clean (signature-change ripple check).
- [ ] `git grep WaitEndFrameQuery -- src/` shows the call site updated; no stale `void`-context caller.

**No web impact (assert, don't regen):**
- [ ] Change is C++-only; no DOM, no bridge schema → vitest (371) and a11y goldens untouched. State this rather than regenerate (L-030/L-033).

**Instrumentation correctness:**
- [ ] `[PERF]` lines appear in `host.log` at ~1 Hz after launch.
- [ ] Sanity: `frame.avg ≈ update.avg + render.avg + wait.avg + composite.avg` (within a few %; the remainder is SpawnerDriver::Tick + cursor + overhead).
- [ ] `fps` field ≈ 1e6 / `frame.avg(µs)`.
- [ ] `win=WxH` matches the actual window state when each line was emitted.

**Data capture (the deliverable):**
- [ ] ≥ 8 steady-state `[PERF]` lines windowed + ≥ 8 maximized, same scene.
- [ ] Tabulate per-stage avg/max + spins(avg/max) at both sizes.
- [ ] Compute each stage's max÷windowed ratio; the stage whose ratio ≈ the pixel-count ratio is the area-scaling culprit.
- [ ] Write the finding (named stage + evidence) into a Review section here; it becomes the input to the round-2 fix plan.

**Debug instrumentation tag:** grep prefix `[PERF]` (host.log). No
`#ifndef NDEBUG` blocks — the timing is always-on by design this round.

---

## Review — round 1 finding (2026-05-31)

**Instrumentation landed + verified.** `[PERF]` lines emit at ~1 Hz to
`host.log`; `frame.avg ≈ Σ stage.avg` holds (render+wait+composite ≈ frame,
remainder = Tick/cursor/overhead); `fps ≈ 1e6/frame.avg`. Release + Debug
x64 both built clean (Debug `LNK4098 LIBCMTD` pre-existing/benign).
`WaitEndFrameQuery` now returns its spin count.

**Launch was HEALTHY, not L-033-degraded.** The agent launch attached the
engine visual cleanly (`[COMP-engine-attach]` present) and ran ~449 FPS
windowed / ~91 FPS maximized — *not* the ~4 FPS L-033 worst case. So this
capture is trustworthy data, not the broken path. (L-033 evidently
intermittent here; flag for the lessons file if it recurs.)

**Result — `engine->Render()` is the area-scaling bottleneck, by far.**
Empty scene (no particles loaded; `update`≈0), µs avg:

| stage | win 1264×761 | max 3440×1369 | ratio | vs area 4.90× |
|---|---|---|---|---|
| render | 2132 | 10500 | **4.92×** | linear — culprit |
| composite | 45 | 67 | 1.49× | ~fixed, sublinear |
| wait | 45 | 350 | 7.78× | follows render GPU time; 3% of frame |
| frame | 2226 | ~10900 | — | 449 → 91 fps |

`render` is **~96% of the frame** and scales **dead-linearly with pixel
count**. The two code-reading suspects were **refuted**: the
`WaitEndFrameQuery` busy-spin (~490 spins, 45 µs; nowhere near the 100k
cap) and the cross-device `CopyResource` (45→67 µs, basically fixed) are
both cheap. The author's "the spin dominates" comment
([Compositor.cpp:1083](../src/host/Compositor.cpp:1083)) and my
copy-elimination prior were wrong — measurement caught it.

**Why this matches the symptom.** "Worse when maximized" = render is
fill-rate bound: 2 ms at 1264-wide → 10.5 ms at 3440-wide. Legacy hit
200–400 fps maximized, so legacy's per-pixel render cost was far lower —
the gap is arch-C's per-frame `scene → bloom → distort → composite`
pipeline into the offscreen RT ([engine.cpp:648](../src/engine.cpp:648)),
which runs every frame regardless of particle count and scales with area.

**Caveats (per plan §4).** (a) Empty scene — particles would add `update`
+ particle-draw cost *on top*, but the dominant area-scaling render cost is
already present at zero particles, so the finding is robust. (b) Unknown
whether bloom was toggled on during the capture — round 2 must disambiguate
(if bloom was OFF and render still scales 5×, the cost is the base
scene/RT path, not bloom).

## Review — round 2 finding (2026-05-31): the cost is the redundant layered readback

Added 5-segment per-pass timing inside `Engine::Render()`
(`scene/bloom/distort/composite/present`), exposed via
`Engine::GetLastRenderTimings()`, folded into a `[PERF2]` host.log line.
Release rebuilt clean; relaunched (healthy, engine attached) and captured
windowed vs maximized.

**Result — `present` is the whole render cost, and it's redundant in arch-C:**

| segment | win 1264×761 | max 3440×1369 | scales? |
|---|---|---|---|
| scene | 12 | 19 | ~flat |
| bloom | 0 | 0 | off / instant |
| distort | 1 | 1 | flat |
| compose | 11 | 13 | flat |
| **present** | **2028** | **10330** | **5.1× ≈ area** |
| render total | 2068 | ~10400 | — |

`present` (= `EndScene` + `m_pAlphaCompositor->Composite()`,
[engine.cpp:966](../src/engine.cpp:966)) is **98–99 % of `engine->Render()`**
and the only area-scaling term. The GPU draw work (scene+bloom+distort+
compose) is **~33 µs flat** at both sizes — free. **Bloom = 0 µs**
(disambiguation answered: not bloom, not the base scene path).

**Root cause.** `AlphaCompositor::Composite()`
([AlphaCompositor.cpp:753](../src/host/AlphaCompositor.cpp:753)) does a
synchronous `GetRenderTargetData` GPU→sysmem readback + a full-surface
`memcpy` every frame. In arch-C the engine renders into the AlphaCompositor
RT, but the *visible* pixels come from the DComp shared-texture path
(`CompositeEngineFrame` reads the same RT GPU-side). The `Composite()`
readback feeds only the arch-B `UpdateLayeredWindow` (invisible under
arch-C) + the modal-snapshot cache (which does its own on-demand readback).
So it is **pure redundant per-frame work** — same class as the
already-removed FramePublisher JPEG encode. The synchronous readback also
explains why the separate `WaitEndFrameQuery` measured cheap: the GPU sync
already happened inside `Composite()`.

**Fix (round 3 — proposed, needs go-ahead).** Skip
`m_pAlphaCompositor->Composite()` when the host is in composition mode
(gate the call behind a composition-mode flag the host sets on the engine,
mirroring the FramePublisher removal). Predicted: `present` → tens of µs,
frame → ~50 µs, the per-frame CPU stall + 19 MB memcpy that starve the
WebView2 pump disappear (the "janky when maximized" feel). Verify by
re-running `[PERF]` (present→~0, fps ceiling jumps ~50–100×) AND
user-confirming the viewport still renders correctly under arch-C.
Risk to check: nothing in arch-C relies on the sysmem DIB Composite()
produced (modal snapshot already does its own readback — confirm).

## Review — round 3: fix landed + proven (2026-05-31)

**Change.** `Engine::SetCompositionMode(bool)` flag
([engine.h](../src/engine.h)); the host sets it at the `SetAlphaCompositor`
site ([HostWindow.cpp:1712](../src/host/HostWindow.cpp:1712)); `Render()`
skips `m_pAlphaCompositor->Composite()` when set
([engine.cpp:983](../src/engine.cpp:983)). The engine still renders INTO the
AlphaCompositor RT (the shared source) — only the layered readback transport
is skipped. Release + Debug x64 built clean.

**Proof — before/after `[PERF]` (empty scene):**

| | windowed fps | max fps | max frame | max present |
|---|---|---|---|---|
| before | 463 | ~90 | ~11000 µs | 10330 µs |
| after | 3053 | **~2380** | **420 µs** | **0 µs** |

Maximized **~90 → ~2380 fps (26×)**; the frame is now ~flat across window
size (328 µs win vs 420 µs max — area-scaling eliminated). `present`→0.
The per-frame synchronous readback + 19 MB memcpy that stalled the host
thread (and starved the WebView2 pump → the "janky when maximized" feel)
is gone.

**Bottleneck shifted, not gone.** `wait` (the `WaitEndFrameQuery` busy-spin)
is now the largest stage (~385 µs / ~9000 spins) — the GPU sync the readback
used to absorb. Irrelevant at 2380 fps, but it's the next lever *if* ever
needed (the round-0 blocking-wait idea). Not pursued — measure-first says
don't optimise a non-problem.

**Verification done.** (a) DComp transport intact — `[COMP-engine-frame]`
heartbeat still ticking, counter +~2360/sec ≈ fps, so `CompositeEngineFrame`
presents every frame; only the redundant readback was removed. (b) Risk
check: no arch-C consumer of the per-frame sysmem DIB (modal snapshots do
their own on-demand readback; the `lastRawDib` cache feeds only the
composition-mode-gated FramePublisher). (c) No web changes → vitest (371) +
a11y goldens untouched by construction (L-030/L-033).

**User-confirmed (2026-05-31).** Viewport renders correctly, modal-overlay
snapshots show the engine, "performance is excellent." `[PERF]`/`[PERF2]`
kept in as a permanent always-on diagnostic (user's call). Shipped:
CHANGELOG entry + L-035 + FF-push to origin/lt-4. DONE.

---

### (superseded) Round-2 plan note
Sub-profile *inside*
`engine->Render()` to split the cost across the passes (scene draw /
skydome / ground / particles vs the bloom gaussian passes vs distort vs the
RT resolve), with bloom toggled on vs off, to name the specific
area-scaling pass — then design the fix (e.g. bloom at reduced resolution,
skip unused post passes, RT format/size review) against legacy's cheaper
path.
