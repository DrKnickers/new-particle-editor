# Next-session dispatch prompt — [MT-11] Phase 4 (DXGI composition wiring)

> Copy the block below into the next session's first message.
> Default recommendation is Stage 4 (engine visual into DComp tree
> — the headline perf payoff of the whole MT-11 plan). Two
> alternative options are at the bottom of this file if you'd
> rather close out Stage 3 (3h a11y + 3i final smoke) first or
> pursue something else.

---

## Prompt: Stage 4 — DXGI composition wiring (recommended)

Pick up **[MT-11] Phase 3 Stage 4 — DXGI composition wiring**.

This is the **load-bearing perf gate** of the entire Phase 3 plan.
Stage 3 (just shipped) put WebView2 into a DComp tree and proved
the FD6 failure mode does not reproduce on this hardware; Stage 4
adds the engine's D3D11 swapchain as a sibling visual so engine
pixels become *visible* through the composition surface. After
Stage 4 ships, the spike's measured 0.30 ms total frame-transport
cost at 3440×1440 should hold in production (vs ~19 ms for the
current arch-A / FD9b readback path that the perf investigation
captured during Stage 2 — see HANDOFF "Perf investigation
findings").

Pre-flight (in order):

1. **CLAUDE.md** — working principles, branch workflow, plan
   structure, ★★★★ rule (this is a ★★★★ stage — not ★★★★★
   because the spike already proved the GPU pipeline; the
   production-integration risk surface is smaller than Stage 3's
   was).

2. **tasks/HANDOFF.md** — current state. Phase 3 Stages 0/1/2/3
   shipped. Stage 4 is the next dispatch.

3. **tasks/todo.md §4 Stage 4 + §6 Stage 4 acceptance** —
   umbrella plan headers. You write your own CLAUDE.md-shaped
   sub-plan before any production code.

4. **tasks/dxgi-stage-3-composition-hosting.md** — Stage 3's
   sub-plan. §1 "In scope" line 5 reserves
   `m_compositor->AttachEngineVisual(swapchain)` as the Stage 4
   seam. The Compositor class at src/host/Compositor.h is pImpl —
   Stage 4 adds a public method that takes an
   `IDXGISwapChain1*` and inserts it as a sibling of the WebView2
   visual.

5. **tasks/stage-3b-smoke-result.md + tasks/stage-3c-smoke-result.md**
   — Stage 3's smoke evidence. The 3b screenshot shows what
   composition-mode chrome looks like with NO engine visual;
   Stage 4's success criterion is the same screenshot with engine
   pixels visible in the viewport quadrant area (currently dark
   purple / "D3D9 viewport" placeholder text).

6. **src/host/spike/dxgi_spike.cpp** — working reference for the
   engine-visual side of the DComp tree. Specifically:
   - InitD3D11AndSwapchain (lines 305-405): D3D11 device +
     OpenSharedResource on the engine's shared-handle texture +
     CreateSwapChainForComposition + GetBuffer for the back
     buffer.
   - RenderD3D9Frame + CompositeD3D11Frame (lines 660-708): the
     per-frame engine-render → D3D9-sync-query → D3D11-copy →
     swapchain-Present sequence.
   - BuildVisualTree's engine-visual block (lines 459-477): the
     engine visual is added BEFORE the WebView2 visual so DComp
     list-order puts it behind. Production Stage 4 reproduces
     this ordering via the Compositor class.

7. **tasks/lessons.md L-007** (load-bearing) + **L-009** (float
   identity keys across JS/C++ boundary). L-007 specifically: any
   D3DPOOL_DEFAULT lifecycle change needs OnLost/OnReset wiring.
   Stage 4's D3D11 device + swapchain are independent of D3D9's
   pool, but the engine-side shared-handle texture (already
   shipped Stage 2 — `Engine::GetSharedTextureHandle`) goes
   through Engine::Reset; verify the handle remains valid across
   resize.

8. **tasks/lessons.md L-016** (Compositor.cpp's per-file
   <AdditionalIncludeDirectories> pattern). Any new src/host/
   .cpp that needs modern Windows headers follows the same
   isolation. If Stage 4 needs a separate
   `host::EngineCompositor.cpp` for the D3D11 + DXGI plumbing,
   it'll need the same vcxproj override.

9. **Run `git log --oneline lt-4..HEAD` and `git log --oneline
   HEAD..lt-4`** — both should be 0 if the session branched
   cleanly from origin/lt-4 at `35c19c8`. (Local `lt-4` ref in
   this worktree may be stale per the sister-worktree note in
   HANDOFF — what matters is `origin/lt-4`.)

10. **Run the pre-flight test gate**:
    - vitest **335 / 335**
    - tsc -b **0 errors**
    - MSBuild Debug + Release x64 clean (both work this session
      after the C4996 fix at `ba3fbc4`)
    - Playwright native baseline 99/99 (HWND mode, no env vars
      set; the 8 composition-only specs in
      `composition-hosting.spec.ts` skip cleanly)
    - Optional: under composition mode env vars,
      `ALO_WEBVIEW2_HOSTING=composition` +
      `ALO_VIEWPORT_TRANSPORT=canvas-jpeg`, native 106/107 (1
      self-skip on curve-editor-wheel when no emitter selected)
    - `shared_texture_test.exe` PASS (Stage 2's bit-exact test
      should still pass on user's RTX 3080)
    - `dxgi_spike.exe` runs + shows live FPS (smoke; not strictly
      pre-flight but worth confirming the spike still works as
      the reference)

Stage 4 scope (per parent plan §4):

- New `Compositor::AttachEngineVisual(IDXGISwapChain1* swapchain)`
  method that inserts the engine visual as a sibling of the
  WebView2 visual. **Z-order critical**: engine visual must be
  added FIRST (before WebView2) so DComp's list-order puts it
  BEHIND the chrome — chrome with transparent backgrounds shows
  engine pixels through, opaque chrome occludes them.
- New host class (or extension to existing Compositor) that owns:
  - D3D11 device (D3D_DRIVER_TYPE_HARDWARE, BGRA support flag)
  - DXGI factory (IDXGIFactory2 for CreateSwapChainForComposition)
  - Composition swapchain (FLIP_SEQUENTIAL, BGRA8 premultiplied)
  - D3D11 texture wrapping the engine's shared-handle (via
    OpenSharedResource on Engine::GetSharedTextureHandle())
  - Per-frame CopyResource(swapchain back, sharedTex) + Present1
- Per-frame trigger: HostWindow's RenderD3D9 path adds a "if
  composition mode AND engine visual attached, do the D3D11
  composite" call AFTER engine->Render(). The existing
  AlphaCompositor path stays alive but produces output that
  nothing consumes (FramePublisher still wired but its JPEG bytes
  no longer needed; Stage 7 deletes both).
- Cross-device sync. The spike uses a D3D9 event query
  (`D3DISSUE_END` + spin on `GetData`) to wait for GPU completion
  before the D3D11 copy. Production may need the same — or, per
  spike line 689-694's spin-loop, swap to `ID3D11Fence` if the
  spin shows up in profiles.
- Env-var gating still required: `ALO_WEBVIEW2_HOSTING=composition`
  is the master switch. With composition mode ON, the engine
  visual auto-attaches. Without it, the legacy arch-A path is
  byte-identical to today.
- `LayoutBroker::SetSceneRect` integration: under composition,
  scene-rect should drive a transform on the engine visual (so
  the engine renders to its native rect within the host client)
  rather than the existing alpha-stamp path. Decision: do this
  in Stage 4 or defer? Sub-plan recommendation: defer to Stage 5
  (input routing rework) so Stage 4 focuses purely on getting
  engine pixels onto the screen.

Stage 4 acceptance (per parent §6):

- New Playwright spec `tests/native/dxgi-transport.spec.ts`: boot
  with `ALO_WEBVIEW2_HOSTING=composition`, assert log contains
  `[COMP-attach] engine visual attached`, take a Playwright
  screenshot of the canvas region, assert non-uniform pixel
  histogram (proves engine pixels arrived; not just a clear color).
- New Playwright spec `tests/native/dxgi-vs-jpeg.spec.ts`: set
  engine to a known state, capture under canvas-jpeg mode and
  under composition mode, assert SSIM > 0.95 (allows compositing
  differences, flags structural breaks).
- New Playwright spec `tests/native/dxgi-perf.spec.ts`: drive FPS
  counter for 10s under composition mode at 1080p AND 3440×1440;
  assert mean FPS > 80 at 1080p AND > 60 at 3440×1440. The spike
  measured 0.30 ms total at 3440×1440 — that's 3000+ FPS
  theoretical; the gate is generous because production overhead
  (Engine::Update, render loop, OS scheduling) adds substantial
  per-frame cost.
- Resize stress: 50 programmatic resizes; assert no crash, no
  log errors, FPS recovers to baseline after settling.
- Manual visual confirmation: launch composition build, verify
  the viewport quadrant area now shows engine pixels (animated
  particle systems if any exist, or at minimum the dark-purple
  engine clear color filling the area — distinguishable from
  Stage 3's "D3D9 viewport" placeholder text by absence of the
  placeholder).

Per CLAUDE.md, treat this as a ★★★★ plan (one star less than
Stage 3 was, because the spike already validated the GPU
pipeline end-to-end). Iterate the risks list with me before
writing production code if you find new risks specific to the
production integration — Stage 3 surfaced the DXSDK shadowing
issue (L-016) and the SDK-bump phantom (L-017) that the spike
didn't surface; Stage 4 may have its own production-only
surprises.

Sub-plan first. Check in with me before any production-code change.

---

## Alternative dispatch options

### Alt 1: Stage 3 close-out (3h a11y + 3i final smoke)

User-mandated per the original sub-plan §1: "Rigorous a11y
testing (per user direction)" — that's still owed. 3i final
smoke is user-driven and short. 3h a11y suite is the bigger
piece — sub-plan recommends Playwright's
`page.accessibility.snapshot()` for the cheap variant (~1d) or
Node's UI Automation bindings for the comprehensive Narrator-
driving variant (~2d).

Effort: 1.5 days cheap variant; 2.5 days comprehensive.

Trade-off vs Stage 4: Stage 4 is more user-visible (engine
pixels appear); Stage 3 close-out is more thoroughness-driven
(closes the a11y commitment from sub-plan §1).

### Alt 2: Spawned-task chip cleanup

The "Defer lastRawDib cache copy" chip was already done by the
sibling session (commits `fd41dfa` + `b5fd14f` on lt-4). HANDOFF
notes this as DONE. No action needed. Listed here so it doesn't
get re-spawned.

### Alt 3: Something else entirely

If you want to break the MT-11 cadence and pick up a different
ROADMAP item, the HANDOFF historical section (below the "Pre-
Stage-3 — what was active before this session" delimiter) has
the old "Next dispatch options" table from before MT-11 started.
B2 obsolescence audit, MT-1 follow-up texture-picker buttons,
NT-5 (engine-side single-member link-group enforcement), NT-6
(visual-stability lane assignment) all still applicable.
