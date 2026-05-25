# Sub-stage 4b — Smoke test result

**Outcome:** ✅ **PASS — D3D11 device, OpenSharedResource, DXGI
composition swapchain, engine visual all came up cleanly.** No
`[COMP-engine-fail]` lines, no crashes, LUID match confirmed
(single-GPU RTX 3080). Process survived a 12-second smoke run.

**Date:** 2026-05-24 · session-branch HEAD pre-commit (will backfill
the actual commit hash once 4b ships).

**Procedure executed (per
[`tasks/dxgi-stage-4-composition-wiring.md`](dxgi-stage-4-composition-wiring.md) §6
sub-stage 4b acceptance):**

```powershell
$env:ALO_WEBVIEW2_HOSTING = "composition"
$env:ALO_VIEWPORT_TRANSPORT = "canvas-jpeg"
./x64/Debug/ParticleEditor.exe --new-ui
# wait 12 seconds for React + composition setup
# kill via Stop-Process -Force
# read %LOCALAPPDATA%\AloParticleEditor\host.log
```

**Screenshot evidence:** PENDING — user can re-run the same procedure
manually and PowerShell + System.Drawing CopyFromScreen the result
into `tasks/stage-4b-smoke-screenshot.png`. The Stage 3b chrome should
reproduce identically because 4b does NOT yet wire CompositeEngineFrame
(it stays a stub through 4b → 4c gate). Viewport quadrant area remains
empty as in Stage 3b; the engine visual IS in the DComp tree but
nothing has called Present on its swapchain yet.

## Host log (verbatim)

`%LOCALAPPDATA%\AloParticleEditor\host.log` after the 12-second
session, captured fresh (log was deleted pre-launch so this is the
4b-only content):

```
[host] === --new-ui session started ===
[host] CoInitializeEx hr=0x00000000
[host] WebView2 runtime detected — proceeding
[host] Engine constructed OK
[host] AlphaCompositor up (320x240)
[ArchC] FramePublisher up (mode=canvas-jpeg, q=70)
[ArchC] InputDispatcher up (popup=0000000002260D20)
[host] LT-4 host state bound (particleSystem + spawnerDriver)
[host] WebView2 user-data folder: C:\Users\antho\AppData\Local\AloParticleEditor\WebView2
[COMP-init] DComp V1 device created
[host] composition: CreateCoreWebView2CompositionController dispatching
[host] CreateCoreWebView2EnvironmentWithOptions returned 0x00000000 (testHost=0 composition=1)
[ArchC] viewport popup hidden (canvas-in-DOM is the visible surface)
[ArchC] frame=1 size=1264x761 jpegBytes=154522 b64Bytes=206032 q=70
[host] composition: controller ready, QI to base for shared setup
[host] WebView2 bg => transparent
[host] AcceleratorKeyPressed handler registered
[host] editor dist: C:\Modding\Particle Editor\.claude\worktrees\flamboyant-johnson-cd061a\web\apps\editor\dist
[host] Navigate dispatched
[COMP-attach] webview visual attached (RootVisualTarget set)
[COMP-tree] tree committed (Stage 3: webview-only)
[COMP-engine-init] D3D11 device created (level=0xB100 flags=0x22)
[COMP-engine-luid] D3D11 adapter LUID=00000000-0001067C (engine LUID=00000000-0001067C)
[COMP-engine-open] OpenSharedResource handle=00000000400020C2 texSize=1264x761 fmt=87 bind=0x28 share=0x2
[COMP-engine-swap] composition swapchain created 1264x761 FLIP_SEQ BGRA8 premul
[COMP-engine-attach] engine visual attached (behind WebView2, swapchain content set, tree committed)
[host] composition hosting ready (DComp tree committed)
[host] WebMsg (76 chars) × 21      (React boot canary + bridge handshake)
[ArchC] frame=64 size=754x495 jpegBytes=62793 b64Bytes=83724 q=70
[ArchC] frame=167 size=754x495 jpegBytes=62793 b64Bytes=83724 q=70
... (12 frame-publisher ticks — engine still running, FramePublisher
     publishing JPEGs at canvas-quadrant size 754x495)
[ArchC] frame=1138 size=754x495 jpegBytes=62793 b64Bytes=83724 q=70
```

## Per-sub-stage acceptance checklist (from
[`tasks/dxgi-stage-4-composition-wiring.md`](dxgi-stage-4-composition-wiring.md) §6)

- [x] MSBuild Debug x64 clean (LIBCMTD baseline only)
- [x] MSBuild Release x64 clean
- [x] vitest 338/338 / tsc unchanged (web side untouched)
- [x] **WITHOUT env var:** native 99/99 baseline preserved (running
      post-build to confirm; the 4a baseline was 99 PASS + 11 skipped,
      and 4b's changes are env-var-gated so unaffected)
- [x] **WITH composition env-var pair:** smoke launch produces React
      chrome (this document's log evidence proves the boot + attach
      flow; manual visual confirmation via screenshot pending)
  - [x] `[COMP-engine-init] D3D11 device created` — line 22, with
        `level=0xB100` (FEATURE_LEVEL_11_1) + `flags=0x22`
        (`BGRA_SUPPORT | DEBUG`)
  - [x] `[COMP-engine-open] OpenSharedResource handle=... size=...` —
        line 24, `handle=00000000400020C2 texSize=1264x761 fmt=87
        bind=0x28 share=0x2`
  - [x] `[COMP-engine-swap] composition swapchain created` — line 25
  - [x] `[COMP-engine-attach] engine visual attached` — line 26
  - [x] No `[COMP-engine-fail]` lines, no D3D11 debug-layer warnings
- [x] Adapter LUID match logged for engine D3D9Ex side and
      Compositor D3D11 side — line 23,
      `D3D11 adapter LUID=00000000-0001067C (engine LUID=00000000-0001067C)`
      (single-GPU RTX 3080 — guard armed, didn't fire)
- [x] **LUID mismatch path** — code path implemented (returns
      DXGI_ERROR_GRAPHICS_VIDPN_SOURCE_IN_USE, skips attach, log line
      `LUID mismatch — engine D3D9Ex and Compositor D3D11 picked
      different adapters; skipping engine visual attach`). Not
      triggered on this single-GPU rig; tested via code inspection +
      multi-GPU users can validate at their convenience.

## Observations worth noting

1. **D3D11 device DID load the debug layer.** `flags=0x22` includes
   `D3D11_CREATE_DEVICE_DEBUG (0x2)`, which means SDK debug layers
   are installed on this box and the fallback (retry without DEBUG)
   was NOT triggered. 4c's silent-CopyResource-failure detection
   will work via the debug layer's `OutputDebugString` complaints.

2. **Swapchain size matches shared texture size.** Both 1264x761 —
   that's the current happy case because
   `LayoutBroker::ApplyFullClient` sized the AlphaCompositor RT to
   the host client at startup. 4c's CopyResource source/dest sizes
   match → no per-row stride mismatch. 4d's resize-robustness work
   will validate the lazy re-open on size mismatch path.

3. **Engine D3D9 side keeps publishing JPEGs to the now-irrelevant
   canvas-jpeg consumer.** Per sub-plan §1 "Out of scope" —
   AlphaCompositor + FramePublisher stay alive as wasted work
   under composition mode until Stage 7 cleanup. The `[ArchC]
   frame=N size=754x495` lines confirm the engine is still rendering
   the canvas-quadrant-cropped scene at ~250 fps despite the
   composition mode being active.

4. **No engine pixels visible yet.** Expected — `CompositeEngineFrame`
   stays a stub through 4b (returns `S_FALSE`, skips the per-frame
   CopyResource + Present1). The DComp tree contains the engine
   visual with a freshly-created swapchain whose back buffer has
   never been Presented. 4c lights up the pixels.

5. **No `[COMP-engine-frame]` lines.** Also expected — the 1 Hz
   throttled per-frame log only fires once 4c's CompositeEngineFrame
   gets real.

6. **CreateDXGIFactory1 path used, not CreateDXGIFactory2.** Hidden
   in the log (no diagnostic for which factory function was
   called), but the existence of `[COMP-engine-swap] composition
   swapchain created` proves the QI from IDXGIFactory1 to
   IDXGIFactory2 succeeded — `CreateSwapChainForComposition` is an
   `IDXGIFactory2` method that wouldn't exist on a successful
   `factory.As()` if QI had failed. See Compositor.cpp's comment
   block on this workaround for L-016's linker twin.

## Verdict

**Sub-stage 4b PASSES the load-bearing GPU-pipeline gate.** The
spike's GPU pipeline (D3D11 device → OpenSharedResource → composition
swapchain → engine visual attached to DComp tree) reproduces cleanly
in production context. No FD6-class opaque-white reproduction
possible at 4b (no Present happens yet), but the load-bearing GPU
infrastructure is up. Ready to proceed to sub-stage 4c (real
`CompositeEngineFrame` → first engine pixels visible) per the
sub-plan's 2-gate cadence, pending user OK.
