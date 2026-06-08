# Sub-stage 3b — Smoke test result

**Outcome:** ✅ **PASS — FD6 failure mode did NOT reproduce.**

**Date:** 2026-05-22 · 14:24-14:26 PDT · commit `90dc742` (Stage 3b
composition controller swap).

**Procedure executed (per
[`tasks/dxgi-stage-3-composition-hosting.md`](dxgi-stage-3-composition-hosting.md) §6
sub-stage 3b acceptance):**

```powershell
$env:ALO_WEBVIEW2_HOSTING = "composition"
$env:ALO_VIEWPORT_TRANSPORT = "canvas-jpeg"
./x64/Debug/ParticleEditor.exe --new-ui
# wait 8 seconds for React mount
# screenshot via PowerShell + System.Drawing CopyFromScreen
```

**Screenshot evidence:** [`tasks/stage-3b-smoke-screenshot.png`](stage-3b-smoke-screenshot.png).

The full editor chrome renders correctly under composition hosting:

- Title: `AloParticleEditor`
- Menubar: File / Edit / Emitters / Mods / View / Help
- Toolbar: file actions · playback · Spawner toggle · Ground+Background
  dropdowns · theme toggle
- Left panel: Particle System tree with `default` root emitter ·
  tree-action toolbar · Basic/Appearance/Physics tabs
- Centre: viewport pill + "D3D9 viewport" placeholder text. The
  viewport quadrant area shows the placeholder because Stage 3 does
  NOT add the engine D3D11 visual to the DComp tree yet (that's
  Stage 4). The dark area is the empty DComp target showing through
  React's transparent body — expected.
- Right panel: Spawner with MODE / BURST / POSITION / VELOCITY /
  LIFETIME / JITTER POSITION sections, all spinners rendered with
  correct token values (e.g. Burst size 1, Interval 10.0, Max lifetime
  5.0).
- Bottom: Curve editor with Red / Green / Blue channel checkboxes and
  Lock-to / Time / Value toolbar.
- Status bar: `FPS 85 · Emitters 0 · Particles 0 · Instances 0 · Cursor —`
  — the stats timer is ticking, React is alive.

**Note on FD6 false-positive at 5s:** an earlier screenshot at 5s
showed the viewport quadrant area as solid dark purple with no
chrome visible above it. That symptom *looked* FD6-class. It wasn't —
React hadn't finished mounting yet under composition mode (the
controller commits the DComp tree before React's first paint).
Composition mode appears to have slightly different boot timing than
HWND mode for the first paint. **Wait 8+ seconds before declaring
opaque-white at Stage 3 acceptance gates.** The dark area in the
final screenshot is the empty DComp target where the viewport
quadrant sits — that's the Stage-3-correct state, not a render
failure.

## Host log (verbatim)

`%LOCALAPPDATA%\AloParticleEditor\host.log` after the 8-second
session, killed via `Stop-Process -Force`. Saved verbatim from the
file:

```
[host] === --new-ui session started ===
[host] CoInitializeEx hr=0x00000000
[host] WebView2 runtime detected — proceeding
[host] Engine constructed OK
[host] AlphaCompositor up (320x240)
[ArchC] FramePublisher up (mode=canvas-jpeg, q=70)
[ArchC] InputDispatcher up (popup=0000000000290AF8)
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
[host] editor dist: C:\Modding\Particle Editor\.claude\worktrees\upbeat-diffie-24f7fc\web\apps\editor\dist
[host] Navigate dispatched
[COMP-attach] webview visual attached (RootVisualTarget set)
[COMP-tree] tree committed (Stage 3: webview-only)
[host] composition hosting ready (DComp tree committed)
[host] WebMsg (76 chars)
[host] WebMsg (64 chars)
... (21 WebMsg lines total — React's boot canary + bridge handshakes)
[ArchC] frame=58 size=754x495 jpegBytes=62793 b64Bytes=83724 q=70
[ArchC] frame=140 size=754x495 jpegBytes=62793 b64Bytes=83724 q=70
... (35 frame-publisher ticks — engine still running, FramePublisher
     publishing JPEGs at canvas-quadrant size 754x495)
[ArchC] frame=2912 size=754x495 jpegBytes=62793 b64Bytes=83724 q=70
```

## Per-sub-stage acceptance checklist (from
[`tasks/dxgi-stage-3-composition-hosting.md`](dxgi-stage-3-composition-hosting.md) §6)

- [x] MSBuild + tsc + vitest unchanged (verified at commit `90dc742`)
- [x] **WITHOUT env var:** native 96/96 pass (verified at commit
      `90dc742` — full HWND-mode baseline preserved)
- [x] **WITH env var:** smoke launch produces a window with React
      chrome visible (this document + the saved screenshot)
- [x] Log file shows `[host] composition hosting ready (DComp tree
      committed)` (line 22 of the verbatim log above)
- [x] No `BuildVisualTree FAILED hr=…` lines — every API S_OK
- [x] No `put_RootVisualTarget` failure — `[COMP-attach] webview
      visual attached (RootVisualTarget set)` present
- [x] Opaque white was NOT observed — chrome rendered cleanly at 8s
      wait. (The 5s false-positive is documented above as a
      composition-mode boot-timing observation, not an FD6
      reproduction.)

## Observations worth noting

1. **No engine pixels in the viewport quadrant.** That's
   architecturally correct for Stage 3 — the DComp tree contains
   ONLY the WebView2 visual. Stage 4 adds the engine visual as a
   sibling. The "D3D9 viewport" text from ViewportSlot's
   canvas-jpeg-mode placeholder is what's drawing in the dark area;
   the canvas IS in the DOM (per risk #15) but isn't subscribed to
   the frame-ready events under composition mode yet. The
   FramePublisher is still publishing (see `[ArchC] frame=N` lines),
   but no consumer; harmless until Stage 4 rewires the consumer.

2. **Default-path baseline preserved.** Per the FD6 protocol, the
   default new-UI path (without `ALO_WEBVIEW2_HOSTING=composition`)
   stays byte-identical to today: native 96/96 PASS verified
   immediately before this smoke. Production users are unaffected.

3. **FPS = 85 in the smoke run.** Engine is rendering normally to
   the AlphaCompositor's RT (and FramePublisher is base64-encoding
   JPEGs to a no-op consumer); composition hosting doesn't impact
   the engine's render loop. Stage 4's job is to redirect the
   engine's output to the DComp tree so those pixels become visible.

4. **AlphaCompositor side path still runs.** Per the sub-plan's
   §1 In-Scope: AlphaCompositor + FramePublisher stay alive under
   composition mode as wasted work (Stage 7 cleanup), so the
   engine still has somewhere to render. The hidden popup HWND
   remains, sized to full client via `layout.ApplyFullClient()`,
   serving as Engine's D3D9 device-window. Confirmed by the
   `[ArchC] viewport popup hidden` line in the log.

## Verdict

**Sub-stage 3b PASSES the FD6 load-bearing gate.** Ready to proceed
to sub-stage 3c (mouse forwarding via `SendMouseInput`) per the
sub-plan's 5-gate cadence, pending user OK.
