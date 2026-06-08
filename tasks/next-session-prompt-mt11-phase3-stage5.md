# Next-session prompt — [MT-11] Phase 3 Stage 5 (scene-rect transform on engine visual)

> **Copy the block below into the next session's first message.**
>
> Stage 4 is fully shipped on `origin/lt-4` at `0c36fac` (8 sub-stages,
> mean engine FPS 79.1 under composition mode, 118+3+0 native test
> count). Stage 5 is the next sub-plan to write + execute. No sub-plan
> exists yet for Stage 5 — the previous session ran out of token
> budget at Stage 4 close-out, so this dispatch starts with brainstorm
> + sub-plan + execution.

---

Pick up [MT-11] Phase 3 Stage 5 — scene-rect transform on the engine
visual. Stage 4 (DXGI composition wiring) shipped fully on `origin/lt-4`
at `0c36fac`; engine pixels now reach the screen via D3D9Ex shared
texture → D3D11 alias → DXGI composition swapchain → DComp engine
visual behind WebView2 chrome. **The engine visual currently fills the
FULL host client** (the DXGI swapchain stretches engine RT contents to
host-client size at 0,0,W,H); Stage 5's job is to **constrain it to the
viewport quadrant** via `IDCompositionVisual::SetTransform` / SetOffset
/ SetClip, driven by the LayoutBroker's scene-rect change path. Per
parent plan §4 Stage 5 effort estimate: 2-3 days.

Pre-flight (in order):

CLAUDE.md — working principles, branch workflow, plan structure, ★★★
or ★★★★ rule depending on Stage 5's risk surface (likely ★★★ —
smaller than Stage 4, mostly DComp API usage + LayoutBroker wiring,
no new GPU pipeline).

tasks/HANDOFF.md — current state. Phase 3 all 5 stages on origin/lt-4
at `0c36fac`. The "Stage 5 entry points" section is the key starting
point: Compositor already has the engine visual as a separate
`IDCompositionVisual` sibling; Stage 5's seam is a new
`Compositor::SetEngineVisualTransform(x, y, w, h)` method (or
SetSize/SetOffset combo) called from LayoutBroker's scene-rect-change
path.

tasks/dxgi-stage-4-composition-wiring.md §1 In Scope — explicitly
defers scene-rect transform to Stage 5: "Engine pixels fill the FULL
host client under Stage 4 — the swapchain stretches the engine-
rendered texture to host-client size, and the engine visual sits at
(0,0,W,H). Chrome occludes; transparent regions show engine. Visual
appearance differs from the eventual scene-rect-constrained quadrant
rendering. **Deferred to Stage 5** (input routing rework, which
already needs the LayoutBroker scene-rect surface)."

tasks/todo.md §4 Stage 5 + §6 Stage 5 acceptance — umbrella plan
headers. Sub-plan §4 says Stage 5 covers "input routing rework: under
DXGI mode mouse path migrated to host WNDPROC; keyboard path via
bridge survives." That's slightly different framing from "scene-rect
transform" — input routing under composition mode was actually
covered by Stage 3 (mouse forwarding 3c + keyboard focus 3f). So
Stage 5's REAL scope is: the scene-rect transform on the engine
visual + any leftover input-pathway adjustments. Sub-plan to write
clarifies this.

src/host/Compositor.h + .cpp — Stage 4 surface. The engine visual is
`m_impl->engineVisual` (an `IDCompositionVisual`). Sub-plan §3.4
documented engine-visual z-order via `AddVisual(engine, TRUE, nullptr)`
— BEHIND the WebView2 visual. The engine visual currently has no
explicit transform (default identity), no SetOffset, no SetClip — it
fills its parent's bounds, which is the root visual = full host
client.

src/host/LayoutBroker.{h,cpp} — owns scene-rect translation. Per
HANDOFF: "LayoutBroker scene-rect change path." The renderer fires
`layout/scene-rect` bridge events on viewport-quadrant resize; the
host's BridgeDispatcher routes to LayoutBroker::SetSceneRect which
currently updates an alpha-mask on the (hidden) popup. Stage 5 adds:
LayoutBroker::SetSceneRect also calls `Compositor::SetEngineVisualTransform`
under composition mode.

src/host/HostWindow.cpp `OnCompositionControllerReady` (~line 1190) +
WM_SIZE handler — Stage 4's wire-up sites. Stage 5 needs to seed the
engine visual transform at attach time too (initial scene-rect), in
addition to the per-update LayoutBroker call.

DComp API surface for the transform:
- `IDCompositionVisual::SetOffsetX(float)` / SetOffsetY — translates the
  visual within its parent. Stage 5 uses these to position the engine
  visual at the scene-rect's top-left.
- `IDCompositionVisual::SetTransform(IDCompositionTransform*)` — full
  affine transform. For simple offset + scale, the simpler SetOffset
  + a scale transform (or just leaving scale as identity if the
  swapchain dimensions match the scene-rect exactly) avoids a full
  IDCompositionTransform object.
- `IDCompositionVisual::SetClip(D2D_RECT_F)` — clips the visual's
  content to a rect in its own coordinate space. Used in Stage 3's
  `Compositor::SetSize` for the root visual. Stage 5 may need this on
  the engine visual if the swapchain is larger than the scene-rect
  region we want to show.

Decision tree for Stage 5 architecture:
- Option A: Keep swapchain at host-client size (Stage 4 default).
  Use SetOffset + SetClip on the engine visual to "window" the
  swapchain to the scene-rect region. Simpler — no swapchain
  ResizeBuffers per scene-rect change. Wastes VRAM on the
  outside-of-scene area but it's modest at typical sizes.
- Option B: Resize swapchain to scene-rect dimensions on each
  scene-rect change. ResizeBuffers + 4d's lazy re-open path. More
  GPU churn but matches the engine RT size exactly.
- Recommend Option A — fits the lazy-re-open philosophy (don't churn
  GPU resources unless necessary), only the on-screen TRANSFORM
  changes per scene-rect update.

tasks/lessons.md L-016 (DXSDK shadowing) + L-017 (verify SDK
assumptions via docs) + L-018 (AI-audit verification protocol).
Stage 5 doesn't touch new DXSDK/Win10 SDK boundaries (Compositor.cpp
already has the L-016 isolation; no new modern headers needed).
L-017/L-018 protocol applies for any docs lookup.

tasks/stage-4b-smoke-result.md + tasks/stage-4c-smoke-result.md —
Stage 4's smoke evidence. The smoke patterns (launch + read host.log
+ visual confirmation) are the template for Stage 5's smoke.

Run `git log --oneline lt-4..HEAD` and `git log --oneline HEAD..lt-4`
— both should be 0 if the session branched cleanly from origin/lt-4
at `0c36fac`. Local `lt-4` ref in fresh worktrees may be stale per
the sister-worktree note in HANDOFF — what matters is `origin/lt-4`.

Run the pre-flight test gate:
- vitest 338 / 338
- tsc -b 0 errors
- MSBuild Debug + Release x64 clean
- Playwright native HWND baseline 99 passed + 22 skipped (under
  default dist/, no env vars)
- (Optional) Composition-mode native: rebuild dist/ with
  `VITE_VIEWPORT_TRANSPORT=canvas-jpeg` + `VITE_WEBVIEW2_HOSTING=composition`,
  run `pnpm test:native` under `ALO_WEBVIEW2_HOSTING=composition` +
  `ALO_VIEWPORT_TRANSPORT=canvas-jpeg`. Expected: 118 passed + 3
  skipped + 0 failed.
- (Optional) `shared_texture_test.exe` PASS — Stage 2 validator
- (Optional) `dxgi_spike.exe` — smoke at 1080p
- After running composition mode, **rebuild dist/ in DEFAULT mode**
  (no VITE_* env vars) so the HWND baseline reproduces if you re-run
  it later. The HWND baseline + composition-built-dist mixed state
  is what surfaced the canvas-architecture spec failures during
  Stage 4f.

Stage 5 scope (proposed sub-plan content — refine in the sub-plan
itself):

In scope:
- New `Compositor::SetEngineVisualTransform(int x, int y, int w, int h)`
  method. Calls `engineVisual->SetOffsetX(x)` + `SetOffsetY(y)` +
  `SetClip({0, 0, w, h})` (Option A). Commits internally. Idempotent
  on identical args.
- LayoutBroker::SetSceneRect (already exists per Stage 3 T4c.2) gets
  a new call site: if `m_compositionMode && m_compositor &&
  m_compositor->IsReady()`, call `m_compositor->SetEngineVisualTransform(...)`.
  Need to figure out the right call site — LayoutBroker may currently
  only know about the AlphaCompositor mask, not the Compositor.
- Initial transform seed in OnCompositionControllerReady — at attach
  time, query the current scene-rect (LayoutBroker may have it) +
  call SetEngineVisualTransform once so the first frame is at the
  right rect.
- One new Playwright spec `dxgi-scene-rect.spec.ts` — drive
  layout/scene-rect through 3 different sizes, assert engine visual
  transforms accordingly (via host.log diagnostic similar to
  [COMP-engine-resize]).

Out of scope:
- AlphaCompositor + FramePublisher removal — Stage 7 territory.
- Swapchain ResizeBuffers per scene-rect change — Option B above,
  not the recommended path.
- Input pathway changes — Phase 2 viewport/input bridge handles
  this already + works under composition mode (Stage 3c + user-
  verified Shift+spawn during Stage 4c).

Stage 5 acceptance (proposed):
- Engine pixels CONSTRAINED to scene-rect quadrant (not full host
  client). Visible difference: chrome panels show their OWN
  backgrounds (no engine bleed-through into panels), only the
  centre-quadrant area shows engine pixels.
- Pane resize: engine pixels track the new scene-rect dimensions.
- Window resize (already 4d-robust): engine pixels track AND
  constrain to scene-rect within the new host client.
- New Playwright spec `dxgi-scene-rect.spec.ts` PASS.
- HWND baseline unchanged at 99 + 22 skipped.
- No new failure-class log entries.

Known follow-ups Stage 5 should NOT take on (deferred):
- canvas-architecture.spec.ts L-012 fixme — pre-existing Phase 2
  instrumentation issue; documented in HANDOFF
- Stage 4 sub-stage 4e (first-frame ClearRenderTargetView guard) —
  not observed as problem; ship-if-surfaces
- L-019 (DXSDK linker-twin) + L-020 (spike-vs-prod config audit)
  lesson retro-docs

Per CLAUDE.md, treat this as a ★★★ plan (smaller than Stage 4 — no
new GPU pipeline, just DComp transform API + LayoutBroker wiring).
Iterate the risks list with me before writing production code if you
find anything non-obvious.

Sub-plan first. Check in with me before any production-code change.

---

**Context window note.** The previous session burned ~22% of 1M
context across Stage 4's 7 sub-stages (4a → 4f + docs). Stage 5 is
substantively smaller; a single dispatch should comfortably finish
the sub-plan + execution + smoke evidence + commit + push.

**Build / dist mode note.** The repo's current `dist/` build mode is
unknown to a fresh session. Always rebuild before running native
tests to ensure the dist/ matches the env vars you're testing under.
The HWND baseline (99 + 22 skipped) requires default-mode `dist/`;
composition mode (118 + 3 + 0) requires composition-mode `dist/`.
Mismatched combinations produce confusing test results (see Stage 4f
session notes on canvas-architecture-spec.ts failures).
