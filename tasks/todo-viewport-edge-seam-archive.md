# tasks/todo.md — Root-cause the 1px light-grey viewport edge seam

Branch: `lt-4`. Opened 2026-05-31 (session 3); **to be implemented next session.**
This is a **systematic-debugging investigation plan** (evidence first, no fixes
until root cause is proven). The previous fix attempt (a 1px engine-clip inset)
was reverted because it rested on an unverified assumption — see "Debunked
inferences" below. Do **not** jump to a fix.

---

## 1. Goal + scope

**Goal.** Identify the *root cause* of a 1px light-grey hairline that frames the
arch-C viewport on all four sides (jarring against dark-theme panels), then —
only after the cause is proven — fix it so the viewport edge follows the theme.

**Symptom (precisely measured, dark theme, dpr=1):**
- A 1px line of *exactly* `RGB(192,192,192)` (`#C0C0C0`) at the viewport's
  left/top/right/bottom edge.
- Left edge sample @ y=350 (bitmap coords, window at 130,130, client offset 8,31):
  `x=342 (17,17,17 panel)` → **`x=343 (192,192,192)`** → `x=344 (67,59,45 ground)`.
- Top edge @ x=800: `y=101 (43,43,43)` → **`y=102 (192,192,192)`** → `y=103 (61,56,46)`.
- The viewport DOM rect (CDP `getBoundingClientRect`) is `(335,71,929,494)`; so the
  192 pixel sits at the **scene-rect edge** (client x=335 ↔ bitmap x=343).

**In:** find which layer/pass injects the 192; prove it; then a minimal, correct
fix. **Out:** any fix before the cause is proven; cosmetic masking that just
relocates the seam (already shown not to work).

---

## 2. What I already know (measured) vs. wrongly inferred

**Measured facts (trust these):**
- **M1.** 1px `#C0C0C0`, all four edges, at the scene-rect boundary.
- **M2.** *Perfectly neutral* (R=G=B=192) and *lighter than both neighbors*
  (panel 17, ground 67). So it is **not** AA between the two visible neighbors —
  that blend would be brownish and darker. It's a distinct injected light-grey.
- **M3.** Independent of engine Background colour (user set red → stayed 192),
  bloom (off → stayed), and theme (present in both).
- **M4.** CDP `elementFromPoint` at the edge → `canvas.viewport-canvas` and all
  ancestors are `background: transparent`, `border: 0`, outline not painted
  (the `3px` outline-width is just the CSS `medium` default with style `none`).
- **M5.** An inset box-shadow injected on the viewport painted at **x=344**, while
  **x=343 stayed 192** → x=343 composites from *behind* the WebView2, and x=343
  may be a *sub-pixel boundary* pixel (element paint starts at 344).

**Debunked inferences (do NOT repeat these):**
- ✗ "It's a WebView2 transparent-edge fringe." M4+M5 show WebView2 is transparent
  there; the pixel comes from a layer *behind* it.
- ✗ "The 1px clip-inset proved it's not the engine." **The inset was never
  verified to take effect** — the `[COMP-engine-transform]` log prints the
  *pre-inset* coords. Possibly the transform path didn't apply at all.
- ✗ "The magenta-backing test proved it's not the backing." That test ran on the
  *non-inset* build where the engine visual fully covers x=343, so the backing
  was invisible there regardless of colour. Inconclusive.

**Live hypotheses:**
- **HA — engine render:** the engine's final RT genuinely has a 192 column at its
  scene-viewport edge (post-process / MSAA-resolve / viewport-edge sampling).
- **HB — DComp composition:** the engine swapchain↔clip edge (stretch/bilinear/
  clip-AA) produces 192 during compositing even if the RT doesn't have it.
- **HC — sub-pixel seam:** a 1px rounding gap between the WebView2 transparent
  region (CSS px) and the DComp clip / backing (physical px) exposes a light layer.

---

## 3. What the codebase gives us (the arch-C pixel path)

- **Engine render** ([`engine.cpp` Render](../src/engine.cpp:600)): clears the
  full scene RT to `m_background` ([:669](../src/engine.cpp:669)), narrows the
  D3D9 viewport to the scene rect when `m_sceneViewportActive`
  ([:689](../src/engine.cpp:689)), renders skydome/ground/particles, then
  post-processes (bloom, then distort/final full-screen quad at
  [:932](../src/engine.cpp:932)) over the full RT. Scene texture is full-
  backbuffer-sized ([:1665](../src/engine.cpp:1665)).
- **Host composite** ([`Compositor::CompositeEngineFrame`](../src/host/Compositor.cpp:736)):
  `CopyResource(engineBackBuffer, sharedTexD3D11)` then `Present1`. The engine
  visual is full-client-sized, `SetOffset(0,0)`, `SetClip(scene rect)` — so what's
  on screen at the scene-rect region is the engine RT 1:1 (no stretch in steady
  state). Cached scene rect: `m_impl->engineLastX/Y/engineLastTransformW/H`.
- **Clip applied** in [`Compositor::Impl::ApplyTransform`](../src/host/Compositor.cpp:181)
  (used by both immediate + deferred paths). The `[COMP-engine-transform]` log
  there prints the requested coords, **not** the actual clip — add real logging.
- **Backing visual** (session-3): rearmost 1×1 swapchain, theme `--bg`. Behind the
  engine visual.

---

## 4. Investigation steps (ordered; one variable each; read x=343 between each)

> **Session 4 execution log (2026-05-31).** Keystone variant CHOSEN (user):
> **headless `--capture`** instead of the live DComp readback below. Rationale:
> the engine renders into `AlphaCompositor::offscreenRT`, which **IS** the
> `sharedTex` level-0 that arch-C `CopyResource`s + composites
> (AlphaCompositor.cpp:144–146; HostWindow.cpp:758) — so the engine-RT PNG from
> `--capture` is byte-identical to what arch-C feeds DComp. `--capture` is the
> reliable headless path (it sidesteps the L-033 live-compositing degradation —
> proven by the skydome L-032 diagnosis). But `--capture` runs no React layout,
> so `m_sceneViewportActive` stays false → no scene-rect edge. **Scaffolding:**
> `[EDGE-DBG]` block in the capture setup (`HostWindow.cpp`, `#ifndef NDEBUG`,
> env-gated) reads `ALO_DEBUG_EDGE_INSET=<px>` → forces `SetSceneViewport`
> (inset all four sides) exactly as LayoutBroker would, and sets a distinctive
> full-RT background (magenta default, `ALO_DEBUG_EDGE_BG=0xRRGGBB`) so the
> outside-scene region is unmistakable. Read the engine-RT PNG at the scene-rect
> edge columns with PIL. **Decision:** 192 at the boundary (ignoring the magenta
> bg) → **HA** proven (and M3-consistent). Clean magenta|scene hard edge, no
> 192 → engine innocent → fall to the live DComp readback (original Step 1) for
> HB/HC. Zero-cost evidence already gathered this session: the user's host.log
> shows `[COMP-engine-transform] clip=(335,71,1264,603)` — clip L/T match the
> measured viewport rect origin (335,71) and animate during resize, so
> `ApplyTransform`/`SetClip` **does** apply under the real launch (pre-refutes
> Step-2 outcome (c) for the live path).

### Step 1 — Instrument the engine output (KEYSTONE: HA vs HB/HC)
> **Implemented as the headless `--capture` variant above (session 4).** The
> live-DComp readback below remains the fallback if `--capture` shows no 192.
Host-side, in `CompositeEngineFrame` **after** the `CopyResource`, gated
`#ifndef NDEBUG` **and** behind an env var (`ALO_DEBUG_EDGE`), throttled to ~1 Hz:
- Create a `D3D11_USAGE_STAGING` (CPU_READ) texture (small — a few px tall strip,
  or full-size lazily); `CopyResource`/`CopySubresourceRegion` from
  `engineBackBuffer` into it; `Map`; read RGBA at the scene-rect **edge column**:
  pixels `(engineLastX, engineLastY + engineLastTransformH/2)`,
  `(engineLastX+1, …)`, and the right/top/bottom edges. Backbuffer is BGRA8 —
  log B,G,R (and also read `sharedTexD3D11` to confirm the copy is identity).
- Log via `LogLine`: `[EDGE] L=(b,g,r) L+1=(…) R=(…) T=(…) B=(…)`.
- **Decision:** if the backbuffer reads `192,192,192` at the edge column →
  **HA** (engine produced it) → go to Step 1a. If it reads ground/brown →
  engine is innocent → **HB/HC** → go to Step 2.

### Step 1a — (only if HA) bisect the engine passes
Env-var-gate skipping each post step in turn (bloom; distort/final composite) and
re-read `[EDGE]`. Also test with `m_sceneViewportActive` forced off (full-RT) to
see if the seam is specifically the *scene-viewport* edge. Prime suspects: the
distort/final quad's edge UV sampling, or an MSAA-resolve edge on the scene
texture. Find the exact pass, then form a single hypothesis.

### Step 2 — Verify the clip moves + layer-isolate (HB/HC, and explains the failed 1px inset)
Env-var-gate a **large** inset (`ALO_DEBUG_INSET`, e.g. 40px) in `ApplyTransform`,
and push a bright-green backing via CDP (`window.bridge.request({kind:
'host/backing-color',params:{color:'#00ff00'}})`). Capture (recipe below). Three
outcomes:
- (a) 40px green band appears, 192 line gone/relocated to the new clip edge →
  engine content inside the clip (consistent with HA).
- (b) green band appears but a 192 line still sits at the green↔chrome boundary →
  it's a seam in *front* of the engine the clip can't touch (**HC**).
- (c) **nothing changes** → the transform path isn't applying at all → that's a
  real bug (explains why the 1px inset did nothing); fix the apply path first.

### Step 3 — Resolve sub-pixel geometry (HC)
CDP: read the viewport `getBoundingClientRect()` at full float precision +
`devicePixelRatio`; inject a *fully opaque* red background on the quadrant and
measure whether x=343 turns red (→ element covers it) or stays 192 (→ seam/gap).
Maps exactly which physical pixel is element vs seam vs neighbour.

---

## 5. Debug scaffolding spec (build it, gate it, rip it out before commit)

All scaffolding is **temporary**, `#ifndef NDEBUG` + env-var-gated, removed before
any commit (grep tag: `// [EDGE-DBG]`). Needs a **Debug x64** build.

- **`[EDGE-DBG]` pixel readback** — `Compositor::CompositeEngineFrame`, after
  `CopyResource`. Staging texture + Map + `LogLine` the edge columns (Step 1).
  Reuse `engineLastX/Y/engineLastTransformW/H` for the scene rect. Throttle with
  the existing `engineLastFrameLogTick` 1 Hz pattern.
- **`[EDGE-DBG]` inset toggle** — `ApplyTransform`, read `ALO_DEBUG_INSET`
  (`getenv`) once, apply as the clip inset (Step 2). Also add a **real** clip log:
  `[EDGE-DBG] clip=(L,T,R,B) inset=N`.
- **Pass-skip toggles** — `ALO_DEBUG_NOBLOOM` / `ALO_DEBUG_NODISTORT` /
  `ALO_DEBUG_NOSCENEVP` in `engine.cpp` Render (Step 1a).

### Verification / capture recipes (these WORK — reuse them; see L-033)
- **Faithful screenshot of the running editor** (the game + VS overlap it, and
  agent launches mis-render until settled): launch with `-PassThru`, poll the PID
  for `MainWindowHandle`, wait ~8s for compose; then **force the window
  `HWND_TOPMOST`** (`SetWindowPos(h,(IntPtr)-1,0,0,0,0,0x43)`) + `SetForegroundWindow`
  before `Graphics.CopyFromScreen` over `GetWindowRect`, then drop topmost
  (`(IntPtr)-2`). Target the **new-UI PID explicitly** — a legacy editor and the
  game may also be running; `Get-Process ParticleEditor|-First 1` picks the wrong
  one. **Do NOT** `MoveWindow`/maximize (desyncs the scene-rect → full-window
  engine mis-render). Read pixels with PIL or `Bitmap.GetPixel`.
- **CDP** (`--test-host` → `http://localhost:9222`): `Invoke-RestMethod /json/list`
  → page `webSocketDebuggerUrl` → `System.Net.WebSockets.ClientWebSocket` (do NOT
  `Add-Type` the assembly in PS 5.1 — instantiate directly) → `Runtime.evaluate`
  `{returnByValue:true}`. Recipes that worked: set dark =
  `document.documentElement.dataset.theme='dark'`; push backing =
  `window.bridge.request({kind:'host/backing-color',params:{color:'#00ff00'}})`;
  read `--bg` = `getComputedStyle(document.documentElement).getPropertyValue('--bg')`.
  **Selector gotcha:** use `querySelector('[data-testid="quadrant-viewport"]')`
  WITH quotes (unquoted returned null); mind PS/JSON escaping of the inner quotes.
- **WebView2 cache** is machine-global; clear `…\WebView2\EBWebView\Default\
  {Cache,Code Cache,GPUCache}` (needs `dangerouslyDisableSandbox`) after a dist
  rebuild. Theme persists in localStorage (survives cache clear), but a fresh
  profile follows OS `prefers-color-scheme` (light) — set dark via CDP for the test.

---

## 6. Risks + mitigations

1. **`--test-host` instances exit unexpectedly** (seen this session). *Mitigation:*
   poll the PID; relaunch; confirm CDP port 9222 before driving.
2. **Staging-texture readback perf / device-removed.** *Mitigation:* throttle to
   1 Hz, tiny staging region, `#ifndef NDEBUG` only, env-gated off by default.
3. **Touching `ApplyTransform`/`CompositeEngineFrame` could regress the viewport.**
   *Mitigation:* all changes env-gated (default-off = byte-identical), Debug-only;
   rebuild Release clean (no scaffolding) before any user smoke test.
4. **Local Release binary is stale** — it was built *with* the (now-reverted) 1px
   inset. *Mitigation:* rebuild from clean source (`lt-4` HEAD has no inset) before
   trusting a local capture.

---

## 7. Testing & verification

- [ ] Debug x64 builds clean with the `[EDGE-DBG]` scaffolding.
- [ ] Step 1 `[EDGE]` log line printed; classified HA vs HB/HC with the actual
      edge-column RGBA quoted.
- [ ] Step 2 capture shows which outcome (a/b/c) — quote the measured x=343 and
      the green-band behaviour.
- [ ] Root cause stated as a single proven hypothesis ("X is the cause because
      evidence Y"), THEN a minimal fix proposed (separate check-in before coding
      the fix per CLAUDE.md).
- [ ] All `[EDGE-DBG]` scaffolding removed; `git grep EDGE-DBG` clean; Release +
      Debug rebuild clean; vitest still 371; goldens untouched (no DOM change).
- [ ] User confirms the edge follows the theme after the real fix.

---

## Review

### Session 4 (2026-05-31) — evidence gathered; HA refuted; blocked on live composite

**Method.** Built Debug x64 with env-gated `#ifndef NDEBUG` `[EDGE-DBG]`
scaffolding in `HostWindow.cpp`'s `--capture` setup (`ALO_DEBUG_EDGE_INSET=<px>`
→ forces `Engine::SetSceneViewport` inset on all four sides exactly as
LayoutBroker does live; `ALO_DEBUG_EDGE_BG=0xRRGGBB` → distinctive full-RT clear,
magenta default). Ran `--capture P_EXPLOSION_BIG00.ALO --frames 120` with
inset=40 → engine RT PNG `tasks/edge-keystone.png` (1264×761). Analysed with
`tasks/edge_analyze.py` (PIL).

**KEYSTONE RESULT — HA is REFUTED.** The engine RT — *the exact texture arch-C
`CopyResource`s and DComp composites* (`offscreenRT` == `sharedTex` L0,
AlphaCompositor.cpp:144–146; consumed at HostWindow.cpp:758) — has **zero**
`(192,192,192)` and **zero** neutral-grey (R=G=B, 150..230) pixels on any of the
four forced scene-rect boundary lines (full-height left-band scan: 0/761 at every
column x∈[36..44]). Clean TOP edge reads pure magenta (255,0,255) up to the
boundary; L/R/B edges read brown (the final distort quad smears scene content
past the rect near the explosion — a real engine effect, not a seam). **The
engine does not draw the 192 at its scene-viewport edge → the 192 is injected
DOWNSTREAM of the engine RT (HB or HC).**

**Further ruled out this session:**
- **GDI window-class brushes** — `hMain` class brush = `RGB(0x14,0x08,0x34)`
  (HostWindow.cpp:2600), `hViewport` class brush = `nullptr` (:2609). Neither is
  192; `0xC0C0C0` is NOT a class background brush.
- **HC-via-theme-backing — refuted by M3.** Z-order rear→front is `[backing
  (theme --bg) → engine(clipped) → webview(transparent front)]`. The backing is
  recoloured per theme (`#ECECEC`/`#111111`). A seam exposing it would be
  theme-DEPENDENT; M3 says the 192 is theme-INDEPENDENT. So the seam (if any) is
  not the theme backing.
- **Fractional-clip AA weakened** — the live clip is all-integer
  (`clip=(335,71,1264,603)`, dpr=1 expected) → clip lands on integer device
  pixels; no sub-pixel boundary for DComp to AA (weakens pure-HB clip-AA; not
  fully eliminated — DComp may AA a pixel-aligned premultiplied edge regardless).

**BLOCKER (why I stopped before a fix).** The remaining split — **HB** (DComp
clip/premul edge artifact on the engine swapchain) vs **HC** (1px seam exposing a
*theme-independent* layer: webview default bg, or the engine swapchain's
premultiplied-alpha edge column) — needs the **live composited pixels** at the
clip edge. CDP can't see them (DOM only; the 192 sits behind the transparent
webview per M5). Agent-launched capture is unreliable here per **L-033** (this
machine misrenders arch-C compositing under agent launch; CDP returned NO CDP
PAGE this session too). Decisive next step needs a correctly-compositing launch
(user's machine).

**Discriminator chosen (user): backing-color toggle.** `tasks/edge_discriminator.ps1`
pushes `host/backing-color #FF00FF` (magenta) + `engine/set/background rgb=65280`
(bright green, COLORREF 0x0000FF00) over CDP, then the user reads the 1px line's
colour: **magenta ⇒ seam exposing backing (HC-backing)** [expected NOT, per M3];
**green ⇒ engine clear/background edge**; **still 192 ⇒ DComp clip/premul edge or
webview default bg (HB / HC-webview)** — the leading theory. User to run:
`x64\Release\ParticleEditor.exe --new-ui --test-host`, load a mod so the scene
renders, then I drive the script.

**Scaffolding status (to remove before any commit — `git grep EDGE-DBG`):**
`[EDGE-DBG]` block in `HostWindow.cpp` (Debug-only, env-gated, default-off ⇒
release/normal builds byte-identical); artifacts `tasks/edge_analyze.py`,
`tasks/cdp_dpr.ps1`, `tasks/edge_discriminator.ps1`, `tasks/edge-keystone*.png`,
`tasks/cdp_dpr_out.txt`.

### RESOLVED (session 4) — root cause proven + fixed

**Root cause.** The 1px `#C0C0C0` frame is the **vestigial empty
`<img data-testid="viewport-img">` overlay's own antialiased element edge**, not
the engine, DComp, the backing, or the page background. The `<img>` is the
legacy arch-A JPEG surface; under the arch-C default its `viewport/frame-ready`
consumer early-returns ([ViewportSlot.tsx:166](../web/apps/editor/src/components/ViewportSlot.tsx))
so it is never painted. Its box sits at the fractional sub-pixel scene-rect
origin (`x=335.047`, dpr=1); Chromium antialiases that transparent edge against
its white compositor base → neutral ~50%-coverage grey at the viewport's first
row/column, all four sides, theme-independent.

**Proof (elimination sweep, all measured, not eyeballed):**
1. **Engine RT clean** — env-gated `--capture` forced the scene-rect render and a
   host-side engine-RT PNG read **0** `(192,192,192)` / neutral-grey on all four
   scene-rect boundary lines (alpha uniformly 255 too). Engine innocent → HA refuted.
2. **Layer recolours all failed** — CDP pushed backing=magenta, engine bg=green,
   webview page bg=blue; the line stayed exactly `192` each time → not any of
   those layers (also refutes HC-via-backing, consistent with M3).
3. **DComp `SetBorderMode(HARD)`** on the engine visual changed the edge pixel by
   **zero** (faithful `HWND_TOPMOST` grab, PIL: still `(192,192,192)` at x=343 &
   y=102) → not clip-edge AA. Reverted.
4. **Hiding the `<img>`** (`display:none`) removed the line on all edges with the
   viewport interior **pixel-identical**; insetting the *canvas* 30px left the
   line at the seam → the `<img>`, not the canvas, is the source.

**Fix (chosen: option A).** Gate the `<img>` render on `!compositionMode` in
`ViewportSlot.tsx` (one file, +31/−9). Removes the dead element + the seam from
the default arch-C tree; preserves it for the canvas-jpeg transport.

**Verification.** Rebuilt dist + cleared WebView2 cache; faithful 274-FPS window
grab measured with PIL: **0** neutral-light pixels on the former seam lines, both
edges, interior unchanged. CDP confirms `imgPresent:false, canvasPresent:true`
(engine input path intact). vitest **371 passed**. All `[EDGE-DBG]` scaffolding
removed (`Compositor.cpp`/`HostWindow.cpp` reverted to baseline;
`git grep EDGE-DBG` clean). a11y goldens untouched (the `<img alt="">` is
decorative, not in the a11y tree; canvas-jpeg-mode goldens unaffected — that
path still renders it). Lesson **L-034** added.
