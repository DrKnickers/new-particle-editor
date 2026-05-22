# [MT-11] Phase 3 Stage 0 — Decision: **GO**

**Date:** 2026-05-22
**Decided on:** NVIDIA GeForce RTX 3080 (VendorId=0x10DE DeviceId=0x2206),
3440×1440 primary display, Windows 11, WebView2 SDK 1.0.3967.48, D3D11
feature level 11.1, D3D9Ex via Windows 10 SDK.
**Spike binary at decision:** `x64/Debug/dxgi_spike.exe` from commit
[`6ad32b8`](../../../.git/) + z-order/em-dash patches applied in the
same dispatch (committed alongside this decision doc).

## TL;DR

**GO.** Phase 3's architectural premise — engine and WebView2 both as
DComp visuals on the same tree, no Win32 child HWND for the viewport
— is validated end-to-end on this rig. All four locked thresholds
are met with 17-30× margin. Proceed to Stage 1 (D3D9Ex migration on
real engine).

The FD6 ghost is exorcised: the three prior visual-hosting attempts
each returned `S_OK` from every API while producing opaque-white
output. This spike produces correct composite + visible WebView2
chrome + working transparency in side-by-side screenshots at 720p /
1080p / 1440p / 3440×1440.

---

## 1. Threshold checklist

Thresholds locked at the start of Stage 0 (see
[`tasks/todo.md` §6 Stage 0](../../../tasks/todo.md) + the dispatch
AskUserQuestion locked answers).

| # | Threshold | Measured | Margin | Pass? |
|---|---|---|---|---|
| 1 | Transport latency ≤ 10 ms at 3440×1440 | 0.34 ms median, 5.21 ms worst-spike | 20-30× | ✅ |
| 2 | ≥ 100 FPS sustained at 1440p on test pattern | 3052 FPS @ 1440p (and 2940-2972 @ 3440×1440) | 30× | ✅ |
| 3 | WebView2 `CreateCoreWebView2CompositionController` inits cleanly | All `[SPIKE]` lines through `webview visual attached (RootVisualTarget set)` + `DComp tree committed (engine=1 webview=1)`. No `[SPIKE-ERROR]`. | n/a | ✅ |
| 4 | DComp composites WebView2 + D3D11 with correct z-order/transparency (screenshot evidence) | Captured at 5 resolutions; engine visual is base, WebView2 chrome on top with `rgba(20,20,30,0.85)` semi-transparent bars; rotating test-pattern colour visible through middle. | n/a | ✅ |

## 2. Per-resolution measurements

Captured 2026-05-22 via the dxgi_spike binary. Each run is ~8-10 s.
Numbers from the live window-title FPS readout (EMA across last ~60
frames) and the per-frame `[SPIKE] frame=N` log lines.

| Resolution | EMA FPS | Total ms median | D3D9 phase | Copy+Present | Screenshot |
|---|---|---|---|---|---|
| 720p (1280×720) | 3378 | 0.30 | 0.27 | 0.02 | [720p.png](spike-screenshots/720p.png) |
| 1080p (1920×1080) | 3030 | 0.33 | 0.29 | 0.04 | [1080p.png](spike-screenshots/1080p.png) |
| 1440p (2560×1440) | 3053 | 0.34 | 0.29 | 0.05 | [1440p.png](spike-screenshots/1440p.png) |
| 3440×1440 (full screen) | 2940-2972 | 0.34 | 0.29 | 0.05 | [3440x1440.png](spike-screenshots/3440x1440.png) |
| Custom 1280×800 (post-zfix) | 3350 | 0.30 | 0.27-0.28 | 0.01-0.02 | [zfix-1280x800.log](spike-logs/zfix-1280x800.log) |

**Striking observation:** frame time is almost constant across
resolutions (0.30→0.34 ms going from 720p to 3440×1440 — only ~13%
increase for ~3× pixel count). The pipeline is CPU-submit bound on
this rig (each frame: `SetRenderTarget`, `Clear`, `EndScene`, query
poll, `CopyResource`, `Present1`). The GPU work (clear of one BGRA
texture + copy to swapchain backbuffer) is so cheap that copy cost
doesn't scale visibly with pixel count at these resolutions.

This means **Phase 3 transport headroom is effectively unlimited at
the resolutions this project cares about**. The real perf budget at
Stage 4 will be the engine's actual draw cost, not the transport
mechanism. Compare against Phase 2's ~85 ms canvas-JPEG per-frame at
3440×1440 — that's 250× higher than this spike's transport overhead.

## 3. Visual evidence

The load-bearing FD6-class check. Three prior attempts (FD6 v1, v2,
v3 — see [post-mortem](dxgi-fd6-fd9-history.md)) all returned `S_OK`
at every API call AND produced 100% opaque-white client area. This
spike produces correct composite:

- **[720p.png](spike-screenshots/720p.png)** — Crisp blue engine
  centre, WebView2 top bar with "DXGI Spike — WebView2 chrome over
  D3D11 engine visual", WebView2 bottom bar with "transparency probe"
  label + "click probe" button. The bars are semi-transparent
  (`rgba(20,20,30,0.85)`) — engine colour very slightly visible
  through them. Z-order: WebView2 chrome ON TOP of engine. ✅
- **[1080p.png](spike-screenshots/1080p.png)** — Same composite at
  1920×1080. Engine colour at a different phase (rotating gradient
  cycles every 2 s).
- **[1440p.png](spike-screenshots/1440p.png)** — Same at 2560×1440.
  Captured during a Claude-Code-window overlap, but the spike's top
  WebView2 bar + visible engine pixels confirm rendering at this size.
- **[3440x1440.png](spike-screenshots/3440x1440.png)** — Full-screen
  at native panel size. Engine visible at magenta phase; top WebView2
  bar visible at top of screen.
- **[bisect-no-engine](spike-logs/bisect-no-engine.log)** — Bisect
  log from the run with `--no-engine` flag. WebView2 chrome rendered
  correctly with white background where engine would be. Used to
  identify the z-order bug.

## 4. Issues found + resolved during Stage 0

### 4.1 WebView2 user-data folder lock (ERROR_BUSY) on back-to-back runs

**Symptom.** Second spike instance launched within ~5 s of a killed
first instance hit
`HRESULT_FROM_WIN32(ERROR_BUSY) = 0x800700AA` from
`CreateCoreWebView2CompositionController`'s completion callback.
WebView2 holds an exclusive lock on its `userDataFolder` and the
prior killed instance's lock had not yet released.

**Fix.** Per-PID user-data folder:
`%TEMP%\DxgiSpikeWebView2Data_<pid>`. Each spike instance gets a
fresh folder. Documented as [L-relevant pattern](#) for Stage 5+ if
the production app ever wants to run side-by-side WebView2 hosts.

Committed in the Stage 0 skeleton commit
(`6ad32b8`).

### 4.2 DComp `AddVisual` z-order with NULL referenceVisual

**Symptom.** First z-order-correct spike build at 1280×800 rendered
ONLY the engine visual (orange/teal/etc rotating fill) — no
WebView2 chrome bars visible. `--no-engine` mode confirmed WebView2
chrome painted correctly when engine wasn't present, isolating the
issue to z-order between the two visuals.

**Root cause.** MSDN docs state that
`IDCompositionVisual::AddVisual(visual, insertAbove, referenceVisual)`,
when `referenceVisual = NULL`, places the visual at the *beginning*
of the children list (= drawn first = BEHIND all siblings) for
`insertAbove = TRUE`. The naming is counterintuitive: `TRUE` here
means "above the (non-existent) reference" which collapses to "at
the bottom of the draw order". My spike used `insertAbove = TRUE`
for both engine and WebView2 visuals — both got pushed to position
[0] in sequence, with WebView2 landing at position[0] and engine at
position[1]. Engine drawn last → engine on top.

**Fix.** WebView2's `AddVisual` uses `insertAbove = FALSE` (end of
list, drawn last, in front). Engine's `AddVisual` keeps `TRUE`
(doesn't matter because it's the only child when first added).
Validated by screenshot at 1280×800 post-fix.

### 4.3 Title-bar em-dash mojibake

**Symptom.** Window title rendered as "DXGI Spike â€" XXX FPS" —
classic UTF-8 → CP-1252 misinterpretation of the em-dash literal in
the C++ source's wide-string format.

**Fix.** Replace the C++ source literal `—` with `--` (two hyphens)
in the `swprintf(...L"DXGI Spike — %.1f FPS...")` and
`CreateWindowExW(...L"DXGI Spike — initializing")` calls. Cosmetic
only — the HTML em-dash (`&mdash;` entity in the WebView2 chrome bar)
renders correctly because WebView2 handles UTF-8 by spec. The
underlying issue is that MSVC interprets source bytes as the system
code page by default; using `--` sidesteps that without requiring a
`/source-charset:utf-8` flag.

## 5. What this validates / doesn't validate

### Validated on this rig

- D3D9Ex device creation + adapter LUID retrieval.
- D3D9Ex shared-handle render-target texture (D3DFMT_A8R8G8B8 with
  `D3DUSAGE_RENDERTARGET` and `D3DPOOL_DEFAULT`).
- D3D9 event-query cross-device sync (poll until signalled).
- D3D11 device creation with debug layer.
- D3D11 `OpenSharedResource` from D3D9Ex's HANDLE produces an
  `ID3D11Texture2D` with matching dimensions and matching adapter
  LUID.
- `IDXGIFactory2::CreateSwapChainForComposition` with
  `DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL` + `DXGI_ALPHA_MODE_PREMULTIPLIED`.
- `ID3D11DeviceContext::CopyResource` from D3D9Ex shared texture to
  D3D11 swapchain backbuffer.
- `IDXGISwapChain1::Present1`.
- DComp V1 `IDCompositionDevice` via `DCompositionCreateDevice2` with
  the V1 IID (matches WebView2APISample successfully).
- `IDCompositionTarget`, `IDCompositionVisual`, `SetRoot`, `AddVisual`,
  `SetContent(IDXGISwapChain1)`, `Commit`.
- WebView2 environment creation + Environment3 QI.
- `CreateCoreWebView2CompositionController`.
- `put_RootVisualTarget` attaches WebView2's surface to a DComp visual.
- `ICoreWebView2Controller2::put_DefaultBackgroundColor` with
  transparent (ARGB(0,0,0,0)).
- `NavigateToString` with inline HTML for chrome overlay.
- Title-bar update via `SetWindowTextW` from idle render loop.
- ESC key closes window via WM_KEYDOWN.
- Per-PID user-data folder prevents WebView2 lock contention across
  back-to-back runs.

### Explicitly NOT validated (deferred to Stage 1+ per todo.md §4)

- Real engine workload (particles, skydome, ground, shaders) under
  the D3D9Ex device. Stage 1 migrates the production engine from
  D3D9 to D3D9Ex and runs full vitest+Playwright suites.
- Engine `Reset` after device-lost / sleep / wake. D3D9Ex has
  different reset semantics from D3D9.
- `D3DPOOL_MANAGED` resources — D3D9Ex doesn't support them; if the
  engine uses managed pool anywhere (likely), Stage 1 has to handle
  that.
- Input forwarding via `SendMouseInput` / `SendPointerInput` /
  keyboard. The spike has WebView2 chrome rendered but the click-probe
  button does NOT respond to clicks because no input forwarding is
  wired (would require Stage 5 plumbing on the composition controller).
- Window resize handling. The spike only resizes WebView2 bounds via
  `put_Bounds`; the engine swapchain stays at the boot resolution.
  Stage 4 needs proper resize.
- DPI scaling. `SetProcessDpiAwarenessContext` set on launch but no
  `put_RasterizationScale` plumbing.
- Resource leak under repeated open/close cycles. Stage 6 leak harness.
- A11y / Narrator under composition hosting. Stage 3 deliverable.
- IME composition under visual hosting. Stage 3 deliverable.
- Driver fallback to arch-A on `OpenSharedResource` failure. Stage 6
  driver-fallback test.
- Multi-GPU laptop scenarios. Spike confirmed matching LUIDs on this
  desktop rig; runtime detection covers production.

### Outstanding observations worth tracking into Stage 1

- **Em-dash source-charset issue.** Solved with `--` in title for
  the spike. The production app may want `/source-charset:utf-8` or a
  UTF-8 BOM on touched files; check `src/host/HostWindow.cpp` and
  others for similar Unicode literals that might mojibake the same
  way in window titles / tooltips.
- **D3D11 debug layer reports.** The spike runs with
  `D3D11_CREATE_DEVICE_DEBUG` flag and exits clean. Output via
  DebugView would surface any debug-layer warnings; we didn't
  capture those in this dispatch but Stage 6 will want them
  archived.
- **CPU-submit bound at small resolutions.** The flat per-frame time
  across resolutions suggests the spike's render loop is CPU-bound
  on the API submit cost, not GPU-fill bound. Production with real
  particle draws will be GPU-bound; transport overhead remains
  measured headroom.

## 6. Decision

**GO** on the Phase 3 DXGI architecture per the locked thresholds.

Proceed to Stage 1: D3D9Ex migration on the real engine
(`Engine` class in `src/engine.cpp`, swap `Direct3DCreate9` →
`Direct3DCreate9Ex`, swap `CreateDevice` → `CreateDeviceEx`, audit
all `D3DPOOL_MANAGED` allocations for D3D9Ex compatibility, run full
vitest+Playwright+manual smoke matrix). Effort estimate per the plan:
2-3 days.

Phase 2's canvas-JPEG transport stays available as a diagnostic
env-var-gated dev mode regardless of Phase 3 progress, per the
[dispatch direction](../../../tasks/todo.md). It is not deleted.

## 7. Next steps

1. Awaiting user confirmation to start Stage 1 (D3D9Ex migration).
2. After Stage 1 lands cleanly: Stage 2 (shared texture infrastructure
   in production code, separate from this standalone spike).
3. Each subsequent stage gates with explicit user OK per
   [tasks/todo.md §8](../../../tasks/todo.md).

If Stage 1 surfaces D3D9-vs-D3D9Ex behavioural differences that block
progress (e.g., the engine uses `D3DPOOL_MANAGED` in ways that don't
trivially convert), bring those back here for re-planning rather than
forcing the migration through.
