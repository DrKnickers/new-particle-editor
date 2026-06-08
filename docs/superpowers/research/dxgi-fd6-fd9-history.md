# DXGI Phase 3 — Pre-spike post-mortem: FD6 visual hosting + FD7 cut-out + FD8/FD9 popup arch

**Audience:** anyone reading this before starting Stage 0 of the
[MT-11] Phase 3 DXGI dispatch, or anyone considering a future
visual-hosting attempt.

**Purpose.** Three prior visual-hosting attempts (FD6 v1 / v2 / v3)
plus one Win32-cutout attempt (FD7) failed to put the D3D9 engine
and the WebView2 chrome onto the same screen without artefacts.
FD8 then shipped a top-level `WS_POPUP` viewport, FD9 layered it
(`WS_EX_LAYERED` + `UpdateLayeredWindow`), and the AlphaCompositor
machinery still in production today grew from there. Phase 3 of
[MT-11] is a fourth swing at visual hosting — this time founded on
DXGI shared-handle GPU interop, with both engine pixels and the
WebView2 surface as DComp visuals in the same tree.

Before writing a line of spike code, this doc summarises:

1. What FD6 v1 / v2 / v3 actually tried.
2. What FD7 (`SetWindowRgn` cut-out) actually tried.
3. The specific symptoms each attempt produced.
4. Where each attempt's root cause was located (and where it
   remained unknown).
5. Why Phase 3's architecture is in a different class from any of
   the above, and which prior risks it does AND does NOT escape.

Primary source for verbatim detail: [tasks/lt4_phase_4_1_fd6_visual_hosting_plan.md](../../../tasks/lt4_phase_4_1_fd6_visual_hosting_plan.md)
§§8-9 (FD6 v2 + v3 postmortems, bisect log, FD7 outcome).
Secondary source: git log on `lt-4` for commit hashes
`6b0d936 → cc9a77e → a2c4ead → 62894f4 → 47e1d66 → 3d9b83b → 84740b6 → 97ef25e → e709b0c → d470807 → … → 11ab97c`.

---

## 1. FD6 v1 — `IDCompositionDevice` (V1) + simple visual tree

**Approach.** Replace `CreateCoreWebView2Controller(hwnd, …)` with
`CreateCoreWebView2CompositionController(hwnd, …)`. Stand up a V1
DComp tree on the host's main HWND: one root `IDCompositionVisual`
attached via `IDCompositionTarget::SetRoot`; WebView2's
`RootVisualTarget` plugs into that root visual. Keep the D3D9
viewport as a `WS_CHILD` Win32 sibling. The premise: DComp visuals
composite OVER the parent HWND's painted content, which includes
child HWNDs in normal Win32 z-order — so the D3D9 child should
"peek through" wherever the WebView2 visual is transparent.

**Symptom.** Editor launches; main HWND opens; WebView2 navigates
and React loads; `WebMessageReceived` fires both directions.
**Client area is 100% opaque white.** Every API returned `S_OK`.

**Variations tried in the same attempt:**

- `CreateTargetForHwnd(hwnd, TRUE)` AND `… FALSE)` for the topmost
  parameter — both white.
- `NotifyParentWindowPositionChanged()` after attach — white.
- Manually promoting the viewport child via `SetWindowPos(…, HWND_TOP, …)`
  — white.

**Root cause:** unknown. No diagnostic identified what was
preventing WebView2's surface output from reaching the visual
tree. Reverted in the commit chain leading to `6b0d936`.

---

## 2. FD6 v2 — `IDCompositionDesktopDevice` (V2) + sample-derived corrections

**Approach.** After comparing line-by-line against the
[MicrosoftEdge/WebView2Samples WebView2APISample][sample], applied
these corrections on top of v1:

- Switched device to `IDCompositionDesktopDevice` (V2) +
  `IDCompositionVisual2`.
- Inserted an **intermediate "host" visual** between the root and
  WebView2 (sample's `BuildDCompTreeUsingVisual` pattern: root →
  `AddVisual(webViewVisual)` → `put_RootVisualTarget(webViewVisual)`).
- Passed `nullptr` to `DCompositionCreateDevice2` (sample doesn't
  create its own D3D11 device).
- Per-resize `SetClip` + `SetOffsetX/Y` on the root visual
  (matches `ViewComponent::SetBounds`).
- Per-frame `Commit()` from the render loop (WebView2 doesn't own
  the DComp device — host's device must commit for any visual
  state change to land).
- Set WebView2's default background to **opaque RED** as a final
  diagnostic. If even an opaque red WebView2 surface didn't
  appear, the visual tree itself wasn't reaching the compositor.

**Symptom.** Still 100% opaque white. Setting WebView2's default
background to opaque red did not produce a red client area.

**Root cause:** unknown. The opaque-red test definitively proved
the WebView2 surface output never reached the compositor —
but did not identify where in the pipeline it was lost. Reverted
(uncommitted).

[sample]: https://github.com/MicrosoftEdge/WebView2Samples/tree/main/SampleApps/WebView2APISample

---

## 3. FD6 v3 — V1 device + deferred BuildVisualTree + SDK 1.0.4015-prerelease

**Approach.** First step: build the reference `WebView2APISample`
locally on this same machine and confirm visual hosting renders.
**It did** (`creationmode=visualdcomp`, React-style chrome
rendered correctly). Definitive evidence that the WebView2
runtime, GPU, driver, and Windows configuration are fine; the bug
is in our port. Then ten changes applied to the host, all
cross-referenced against the working sample:

1. Reverted device to V1 `IDCompositionDevice` (sample uses V1).
2. Kept V2 factory function `DCompositionCreateDevice2(nullptr,
   IID_PPV_ARGS(&IDCompositionDevice))`.
3. **Deferred `CreateTargetForHwnd` + visual-tree creation until
   inside the composition-controller completion callback.** This
   was the most suspicious gap from v2 — the sample creates
   target/visuals AFTER the controller exists; v2 created them
   in the `Compositor` ctor BEFORE WebView2 init began.
4. Intermediate visual preserved from v2.
5. `SetClip` / `SetOffset` on root visual per resize.
6. Per-frame `Commit()`.
7. Parent HWND class brush set to `(HBRUSH)(COLOR_WINDOW + 1)`
   (was `nullptr`). Hypothesis: DComp surface with `topmost=TRUE`
   may need a parent paint to blend against.
8. Window styles updated to match sample —
   `WS_EX_CONTROLPARENT` extended; `WS_OVERLAPPEDWINDOW |
   WS_CLIPSIBLINGS | WS_CLIPCHILDREN` class style (was missing
   `WS_CLIPSIBLINGS`).
9. Diagnostic isolation: created the D3D9 viewport child HWND
   WITHOUT `WS_VISIBLE` to rule out child-HWND interference.
10. SDK upgrade: `Microsoft.Web.WebView2` NuGet bumped from
    `1.0.3967.48` to `1.0.4015-prerelease` to match the sample.

**Symptom.** Still 100% opaque white. Every API returned
`hr=0x00000000`. React loaded; navigation completed.

**Root cause:** unknown. Cause is *something* the host does
between the sample's setup and the host's setup; bisecting from
the host inward never found it.

**Outside-in bisect** (separate attempt, commit `47e1d66`):
starting from the working sample, ADDED the host's three
most-suspicious patterns one at a time:

| Step | Change to sample | Result |
|---|---|---|
| 1 | `WS_CHILD \| WS_VISIBLE` red-brush sibling HWND at (16,100,320,240) | sample still renders, red rect visible OVER WebView2 chrome |
| 2 | + `Direct3DCreate9` + D3D9 `CreateDevice` on the sibling HWND + Clear+Present | sample still renders, D3D9 area visible |
| 3 | + Replace sample's `GetMessage` loop with `PeekMessage` idle-spin | sample still renders |

None of the obvious "host vs sample" patterns reproduced the
white. A truly definitive bisect from there would have required
porting the host's `Engine` + WebView2 init order + window-class
setup into the sample line-by-line — at which point it stops
being a bisect and becomes a guided rewrite of the host from a
known-good baseline. The cost-benefit at that point favoured a
pivot.

---

## 4. FD7 — `SetWindowRgn` cut-out on HWND-mode WebView2

**Approach.** Abandon visual hosting. Keep WebView2 in HWND mode.
Find WebView2's child HWND post-init (`EnumChildWindows`, match
class-name prefix `"Chrome_"`). Build an `HRGN` = full WebView2
client minus the viewport rect. Apply via `SetWindowRgn(webviewHwnd,
region, TRUE)`. Refresh on every resize + viewport-rect update.
Promote viewport via `SetWindowPos(hViewport, HWND_TOP, …)` after
WebView2 init.

**Symptom.** Cut-out applied correctly (verified by setting the
main HWND's class brush to RED — the viewport area then rendered
RED via parent peek-through, exactly where the region's hole was).
**But the viewport HWND's D3D9 content never rendered through the
hole.** Tested:

- Viewport on `HWND_TOP` after WebView2 init — no effect.
- Viewport without `WS_CLIPSIBLINGS` — no effect.
- Viewport's `hbrBackground` set to GREEN, `WM_ERASEBKGND`
  default-painting — a thin GREEN rim appeared around the
  cut-out hole, but D3D9 content (dark-purple clear) never
  showed inside it.

**Root cause (identified).** DWM composites WebView2's DComp
surface ABOVE the viewport's GDI/D3D9 HWND blit, **regardless of
Win32 sibling z-order**. The cut-out punches a hole in WebView2's
HWND, but DWM doesn't fall through to the viewport HWND — it
shows the parent's painted content (the class brush) or nothing
when the brush is null.

**Key insight.** This was the first attempt to prove definitively
that **DWM-level compositing wins over Win32 z-order** when one
of the siblings is a DComp-composited surface (WebView2 in HWND
mode internally uses DComp). Any future architecture that mixes
HWND-mode and DComp-mode surfaces has to expect this asymmetry.

---

## 5. FD8 / FD9 — the path that shipped

**FD8 (commits `84740b6 → 97ef25e`).** Pivot to making the
viewport a **top-level `WS_POPUP`** owned by the main HWND. Wins
because top-level windows are independent DWM compositing layers
— the DWM-vs-Win32-z-order issue from FD7 disappears. Drawback:
the viewport is its own HWND, no natural transparency for chrome
overlays. Tool panels and menus that drop down into the viewport
area can't alpha-blend; they need an "occlusion" protocol to
notify the engine compositor of cut-out regions.

**FD9 (commits `e709b0c → … → 11ab97c`).** Layer the viewport
popup — `WS_EX_LAYERED` + `UpdateLayeredWindow` with `ULW_ALPHA`.
Engine renders to an off-screen ARGB render target, the host
reads it back via `D3DPOOL_SYSTEMMEM` surface → `CreateDIBSection`
bitmap → `UpdateLayeredWindow` per frame. Alpha-aware compositing
of chrome over the viewport is now native to DWM; soft drop
shadows, anti-aliased edges, semi-transparency all blend
correctly. **The AlphaCompositor pipeline that still ships
today** is the FD9 implementation, plus FD9b refinements
(occlusion stamps moved from the bridge protocol into the
compositor, per-pixel alpha feather, edge clipping). Cost: per-
frame `GetRenderTargetData` + memcpy + `UpdateLayeredWindow`.
Documented in the FD9 plan at
[docs/superpowers/plans/2026-05-18-fd9-viewport-alpha-compositing.md](../../plans/2026-05-18-fd9-viewport-alpha-compositing.md).

**FD9 cost matures into the perf wall MT-11 hits.** The
`GetRenderTargetData` GPU-to-CPU readback on a 3440×1440 frame
runs ~25 ms at native resolution. Adding the FramePublisher JPEG
encode + base64 + bridge round-trip + `<canvas>` decode for the
[MT-11] Phase 2 canvas-in-DOM approach takes that to ~85 ms per
frame — **bandwidth-bound at 20 FPS** on maximised 3440×1440.
That's what kicks off Phase 3.

---

## 6. Why Phase 3 is in a different class

The single line: **FD6 mixed paradigms; Phase 3 does not.**

| Concern | FD6 v1/v2/v3 | FD7 | FD8/FD9 (current) | MT-11 Phase 3 (DXGI) |
|---|---|---|---|---|
| WebView2 mode | composition | HWND | HWND | composition |
| Engine viewport | Win32 child HWND under composited WebView2 | Win32 child HWND, peek-through `SetWindowRgn` hole | top-level `WS_POPUP` (FD8) or layered popup (FD9) | DComp visual (D3D9Ex shared handle → D3D11 swapchain → DComp surface) |
| Same compositor for both? | no — WebView2 in DComp, engine via Win32 GDI/D3D9 | no | no (FD9: ULW for engine, separate WebView2 HWND) | **yes** — both engine and WebView2 are DComp visuals on the same `IDCompositionTarget` |
| DWM-vs-Win32 z-order risk | hit hard (FD6) | hit hard (FD7 root cause) | sidestepped by separating top-level windows | n/a — single compositing layer |
| Per-frame CPU cost | n/a (never rendered) | n/a | ~25-85 ms readback + transport | **GPU only** (no readback, no JPEG, no IPC bandwidth) |

**The architectural premise.** FD6 tried to give WebView2 a DComp
visual but kept the engine as a Win32 child HWND, and DWM's
compositor put the WebView2 visual ABOVE the child HWND content.
That's the same asymmetry FD7 ran into from the opposite side
(Win32 z-order can't promote a GDI sibling above a DComp
surface). Phase 3 doesn't fight that asymmetry because the engine
never appears as a Win32-painted sibling — it goes through DXGI
shared-handle interop into a D3D11 swapchain that DComp owns
natively, and DComp composites engine + WebView2 visuals as
peers in the same tree.

This is much closer to the **`WebView2APISample`** topology than
to any of FD6 v1-v3. The sample renders fine on this exact
machine (verified during FD6 v3). The sample uses a single
DComp tree containing the WebView2 visual and its own GDI/D3D
child HWND (the toolbar HWND); Phase 3 uses a single DComp tree
containing the WebView2 visual and an additional D3D11 swapchain
visual for the engine. The shape is the same; only the second
visual's content source differs.

---

## 7. Risks Phase 3 **does** escape

- **DWM-vs-Win32 z-order asymmetry.** No Win32 child HWND for the
  viewport. The engine is a DComp visual, not a sibling HWND.
- **`GetRenderTargetData` per-frame CPU cost.** Eliminated. The
  engine renders into a shared-handle texture; D3D11 reads it on
  the GPU; no CPU readback.
- **JPEG encode/decode + bridge bandwidth.** Phase 2's transport
  is demoted to a diagnostic mode.
- **Sample known-broken on this hardware.** FD6 v3 confirmed the
  sample works here. The Phase 3 spike's job is to confirm the
  *additional* visual works too — but the WebView2-side of the
  tree is already proven on this rig.

---

## 8. Risks Phase 3 **does not** escape

- **FD6 v1-v3 root cause is still unknown.** Every API returned
  `S_OK`, every diagnostic surfaced no anomaly, the sample worked
  but the port didn't. The spike must instrument carefully and
  fail loudly. If the spike — which mirrors sample architecture
  more closely than FD6 did — also produces opaque white, we are
  back in the same dead-end. NO-GO criterion: visible test
  pattern through DComp tree, screenshotted, end-to-end.
- **WebView2 SDK 1.0.3967.48 vs 1.0.4015.** FD6 v3 tried the
  bump and it didn't help, but Phase 3's surface (`CreateSharedBuffer`
  / DXGI swapchain on D3D11 visual + composition controller) is
  larger than v3's. Stage 0 includes a scripted grep + linkage
  check confirming the APIs we need are stable in 3967.48.
- **D3D9 → D3D9Ex behaviour differences.** Not exercised by FD6.
  Stage 1 of Phase 3 (post-spike) carries this risk.
- **D3D9-D3D11 cross-device shared-handle compatibility on user
  hardware.** Untested on this rig. The spike is the first time
  we'll know whether `IDirect3DDevice9Ex::CreateTexture` with
  `D3DUSAGE_RENDERTARGET` + shared-handle output ports cleanly to
  `ID3D11Device::OpenSharedResource`.
- **Multi-GPU laptop hosts.** Out of scope for this rig; runtime
  detection + arch-A fallback covers production.
- **A11y / IME under composition hosting.** FD6 didn't get far
  enough to test this; Phase 3's Stage 3 explicitly extends for a
  rigorous Narrator + IME suite. The risk is real.

---

## 9. Concrete lessons for the spike

Pulled from FD6 v1-v3 + L-007 (engine state corruption masked by
React-layer diagnostics):

1. **Instrument the compositor pipeline at every stage.** If the
   spike produces a black or white window, we must be able to
   tell *which* visual didn't render — engine, WebView2, both —
   without guessing. Log every `Commit()` return code, every
   `Present` HRESULT, every shared-handle open status. The FD6
   attempts all returned `S_OK` everywhere and still produced
   white; that path is forbidden this time.
2. **Build the visual tree AFTER both controllers exist.** FD6
   v3 attributed at least some of the failure to early
   tree construction. The spike defers `CreateTargetForHwnd`
   until both D3D11 swapchain + WebView2 composition controller
   are ready; only then attaches both visuals as children of the
   root and commits once.
3. **Don't conclude from surface symptoms.** L-007's incident
   (`groundTexture` failing because of a missed
   `OnLostDevice`/`OnResetDevice` on `m_pSkydomeEffect`) was
   misdiagnosed as a React/portal bug for a full session before
   the engine canary handler pinpointed the C++ side. Stage 0
   measurement spans both ends of the pipeline — D3D9Ex side
   and D3D11/DComp side — so a "WebView2 rendered into the void"
   bug can't masquerade as a "compositor produced black" bug.
4. **Mirror sample topology where possible.** Sample's working
   tree: root visual → child → WebView2 surface. Spike's tree:
   root visual → child A (WebView2) + child B (engine D3D11
   swapchain). One additional child is the minimal delta.
5. **Test with the engine's window-class brush set BOTH null and
   `(HBRUSH)(COLOR_WINDOW + 1)`.** FD6 v3's brush change didn't
   fix it but also wasn't disproven. The spike will record which
   brush state produced the screenshotted test pattern.
6. **No `WS_EX_LAYERED` on the spike host HWND.** Phase 3's
   architecture doesn't need it (DComp is the per-pixel-alpha
   path now). FD9's `WS_EX_LAYERED` is a separate-window
   workaround; on the DXGI host HWND it could plausibly interact
   badly with DComp redirection. Spike host HWND is plain
   top-level.
7. **Capture a screenshot before declaring GO.** The decision
   doc must include a screenshot of the WebView2 chrome on top
   of the engine D3D11 visual showing correct transparency +
   z-order. FD6 v1-v3 each *claimed* success at the API level
   while the screen was opaque white. A screenshot ends that
   class of dispute.

---

## 10. If the spike produces opaque white

Don't iterate. Don't add corrections.

- Capture the spike binary + log + screenshot.
- Mark NO-GO in the decision doc.
- Pivot back to arch-A + UI accommodations per the [MT-11] Phase 3
  plan §3.6 fallback.

The FD6 attempts taught us that this failure mode has no cheap
diagnosis. Burning the 5-week Phase 3 budget on it is a worse
outcome than shipping arch-A with the chrome cutout artefact and
designing UI accommodations to minimise where it shows. The user
explicitly chose arch-A — not SharedBuffer, not continued canvas-
JPEG — as the production fallback on Stage 0 NO-GO.
