# DXGI Phase 3 Stage 0 — Spike run procedure

**Audience:** the user, running the `dxgi_spike.exe` on their dev rig
to produce the measurements that feed the GO/NO-GO decision doc.

**Spike binary:** [`x64/Debug/dxgi_spike.exe`](../../../x64/Debug/dxgi_spike.exe)
(built clean on the worktree at session end — see
[`src/host/spike/dxgi_spike.cpp`](../../../src/host/spike/dxgi_spike.cpp)
for the source and
[`src/host/spike/dxgi_spike.vcxproj`](../../../src/host/spike/dxgi_spike.vcxproj)
for the project file).

**Locked-in GO criteria (re-statement from dispatch):**

1. **Transport latency ≤ 10 ms at 3440×1440** — measured as the
   per-frame `total` ms in the log.
2. **≥ 100 FPS sustained at 1440p** on the spike's animated test
   pattern — visible in the window title bar and in log lines.
3. **WebView2 CompositionController inits cleanly** — log shows
   `[SPIKE] WebView2 environment created` and `[SPIKE] webview
   visual attached (RootVisualTarget set)` with no `[SPIKE-ERROR]`
   in between.
4. **DComp composites WebView2 + D3D11 with correct z-order +
   transparency** — visible: rotating colour in the centre of the
   window; semi-transparent dark bars at top + bottom showing
   WebView2 chrome; clicking the "click probe" button in the
   bottom-right updates its text. A screenshot of this state is
   the load-bearing artifact for the decision doc.

**NO-GO criteria (any single one fails):**

- Spike crashes during init.
- Window opens but is **opaque white** (the FD6 failure signature
  — see the post-mortem doc).
- Window opens but engine area shows the wrong content (no
  rotating colour) while WebView2 chrome IS visible (suggests
  shared-handle interop broken).
- WebView2 chrome never appears (suggests composition-controller
  path broken).
- Transport latency > 10 ms at 3440×1440.
- FPS < 100 at 1440p.

---

## Run sequence

### 1. Smoke at default resolution (1280×800)

```powershell
& "x64\Debug\dxgi_spike.exe"
```

**Expected:** Window opens with rotating-colour centre + dark bars
top+bottom. Window title cycles FPS readout. ESC to close.

**If it produces opaque white at this stage:** STOP. Capture the
log and screenshot, mark NO-GO. Do not iterate.

### 2. Per-resolution perf sweep

Run each in turn, let it run 30 seconds for the EMA FPS to settle,
then capture a screenshot + the log file. Close with ESC.

```powershell
# 720p
& "x64\Debug\dxgi_spike.exe" --res=720p

# 1080p
& "x64\Debug\dxgi_spike.exe" --res=1080p

# 1440p
& "x64\Debug\dxgi_spike.exe" --res=1440p

# 3440x1440 (the workload that broke Phase 2 canvas-JPEG)
& "x64\Debug\dxgi_spike.exe" --res=3440x1440
```

Log file accumulates between runs at `%TEMP%\dxgi_spike.log`.
Rename it between runs if you want per-resolution logs:

```powershell
$env:TEMP_LOG = "$env:TEMP\dxgi_spike_1440p.log"
& "x64\Debug\dxgi_spike.exe" --res=1440p --log=$env:TEMP_LOG
```

### 3. Bisect modes (only if Step 1 or 2 produces opaque white)

The spike has two debug-only modes to isolate which side fails:

```powershell
# --no-webview2: just engine via D3D9Ex → D3D11 → swapchain → DComp.
# If this renders the rotating colour but step 1 produces white,
# the engine path is fine and WebView2 composition hosting is the
# problem.
& "x64\Debug\dxgi_spike.exe" --no-webview2

# --no-engine: just WebView2 visual on a DComp tree, no engine
# swapchain. If this renders the chrome but step 1 produces white,
# the WebView2 side is fine and the shared-handle interop or
# swapchain integration is the problem.
& "x64\Debug\dxgi_spike.exe" --no-engine
```

Only run these if Step 1 produced an unexpected result.

---

## What to capture for the decision doc

For each resolution that completed (or for each failure):

1. **Screenshot** of the spike window after ~30 seconds — full
   window including title bar. Save as
   `docs/superpowers/research/spike-screenshots/<res>.png`.
2. **Log file** (`%TEMP%\dxgi_spike.log` — last 50 lines is
   plenty unless something went wrong). Paste into your next
   message OR commit to
   `docs/superpowers/research/spike-logs/<res>.log`.
3. **Per-resolution numbers** — easiest is the last few
   `[SPIKE] frame=...` log lines, which include `total=X.XXms`
   and `emaFps=YYY.Y`. Capture median of last 60 frames.

A minimal complete report (paste into next dispatch):

```
720p   — FPS XXX  total YY.YYms  init ok    screenshot ok
1080p  — FPS XXX  total YY.YYms  init ok    screenshot ok
1440p  — FPS XXX  total YY.YYms  init ok    screenshot ok
3440p  — FPS XXX  total YY.YYms  init ok    screenshot ok
```

OR (the case Stage 0 actually exists to identify):

```
720p   — opaque white   log: [SPIKE-ERROR] ...
```

That's the decision input.

---

## Interpreting the log

A successful run looks like:

```
[SPIKE] === dxgi_spike started ===
[SPIKE] config: 2560x1440 (1440p) webview2=1 engine=1
[SPIKE] CoInitializeEx hr=0x00000000
[SPIKE] host HWND created (no WS_EX_LAYERED)
[SPIKE] Direct3DCreate9Ex OK
[SPIKE] D3D9Ex device created OK
[SPIKE] D3D9 adapter: <your GPU> (VendorId=0xXXXX DeviceId=0xXXXX)
[SPIKE] shared texture created: 2560x1440 A8R8G8B8 handle=0x...
[SPIKE] D3D11 device created (level=0xb100 flags=0x21)
[SPIKE] D3D11 adapter: <your GPU> (LUID=XXX-YYY)
[SPIKE] D3D11 opened shared resource: 2560x1440 fmt=87 bind=0x20 share=0x...
[SPIKE] D3D11 composition swapchain created (2560x1440 FLIP_SEQ premul)
[SPIKE] DComp V1 device created
[SPIKE] WebView2 environment created
[SPIKE] WebView2 default bg set to ARGB(0,0,0,0)
[SPIKE] overlay HTML navigation dispatched
[SPIKE] engine visual attached (swapchain content)
[SPIKE] webview visual attached (RootVisualTarget set)
[SPIKE] DComp tree committed (engine=1 webview=1)
[SPIKE] frame=60 d3d9=0.45ms copy+present=0.62ms total=1.07ms emaFps=143.2
... etc ...
```

**Key sanity checks** in the log:

- `D3D9 adapter` and `D3D11 adapter` LUIDs should match — if they
  differ, you're on a multi-GPU laptop with mismatched adapters
  and shared handles won't work (this is one of the known Phase 3
  failure modes per the plan §3.6 table).
- `shared texture created` and `D3D11 opened shared resource` both
  succeed with matching dimensions = the cross-device shared
  handle path works on your rig (the new piece vs FD6).
- `webview visual attached` is the FD6 critical step — if this
  line is present AND the screen is white, you're back in FD6
  territory. If this line is missing, the composition-controller
  path itself failed.
- `frame=N` lines should appear 60×/second (60 fps tier) up to
  hundreds per second. If you see them but the screen is white,
  the API path returned `S_OK` but pixels aren't reaching the
  display — same FD6 symptom.

---

## Pre-handoff smoke results (this dispatch)

Per CLAUDE.md *Pre-handoff testing*, the spike was launched three
times via the harness's Bash tool to confirm init + render-loop
liveness. The GUI window may or may not have been visible on the
user's display depending on session attachment, but the log files
(`%TEMP%\dxgi_spike*.log`) tell the API-level story:

| Resolution | Frames in ~5-7s | EMA FPS | Median total ms | Max-spike ms | Init |
|---|---|---|---|---|---|
| 400×300 | 600 | 3500 | 0.28 | 0.65 | clean — all visuals attached |
| 1920×1080 | 19,680 | 2900-3500 | 0.29 | 4.01 | clean — all visuals attached |
| 3440×1440 (1st run) | — | — | — | — | **ERROR_BUSY** on WebView2 controller (user-data lock from back-to-back killed run) — fixed with per-PID folder |
| 3440×1440 (2nd run, post-fix) | 8,580 | 1500-2500 | 0.30-0.50 | 5.21 | clean — all visuals attached |

**What this proves (already, on this NVIDIA RTX 3080 rig):**

- D3D9Ex shared-handle texture creation succeeds at all four resolutions.
- D3D11 `OpenSharedResource` succeeds with matching LUIDs.
- DXGI composition swapchain creation succeeds.
- DComp V1 device + target + visual tree attaches cleanly.
- WebView2 `CreateCoreWebView2CompositionController` succeeds.
- `put_RootVisualTarget` succeeds.
- DComp `Commit()` succeeds.
- Render loop produces frames continuously — no API-level FD6
  signature (no string of `S_OK` with frozen output).
- Transport latency (median) at 3440×1440 is ~0.5 ms — **20× under
  the 10 ms threshold**.
- Sustained FPS at 1080p is ~3000 — **30× over the 100 FPS bar**.
- Sustained FPS at 3440×1440 is ~1700 — **17× over the 100 FPS bar**
  if we apply the 1440p threshold to it.

**What this does NOT prove (still requires user visual verification):**

- Whether the rotating-colour engine visual actually appears on
  screen, OR whether the spike produces opaque white like FD6 did
  (this is the load-bearing FD6-class check).
- Whether the WebView2 chrome bars (top/bottom) appear above the
  engine visual with correct transparency.
- Whether clicking the "click probe" button works (input routing
  to WebView2 under composition hosting).

These are the irreducibly-visual GO criteria. Run the spike at
each resolution per the steps above, capture a screenshot
showing the rotating colour + chrome bars + the click-probe-button
working, and you have the full GO/NO-GO evidence package.

---

## After the run — what comes next

Paste the per-resolution numbers + screenshots (or describe what
you saw) into the next dispatch. I'll write the GO/NO-GO decision
doc against the locked thresholds and either:

- **GO:** proceed to Stage 1 (D3D9Ex migration on the real
  engine, 2-3 days) per [`tasks/todo.md`](../../../tasks/todo.md) §4.
- **NO-GO:** revert Phase 2 commits, file the UI accommodations
  dispatch (arch-A + chrome adjustments) per the plan §6 Stage 0
  acceptance.

The decision is binary; the spike's job is to gather the inputs.
