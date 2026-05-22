# tasks/todo.md — [MT-11] Phase 3: DXGI shared-handle viewport compositing

> **Active plan.** This is the next-dispatch plan for [MT-11].
> **Awaiting user OK on Stage 0 spike start (§9).**
>
> The prior planning history (Phase 0 + 1 + 2, canvas-JPEG
> approach) lives at [`todo-mt-11-phase-0-1-2-archive.md`](todo-mt-11-phase-0-1-2-archive.md).
> Phase 2's implementation is on the session branch (vitest
> 335/335, Playwright 90/90, MSBuild clean) — see §9 for what to
> do with that working tree before / during this dispatch.

**Status:** plan drafted 2026-05-22 after Phase 2 perf smoke
surfaced unacceptable FPS at maximized resolution (20 FPS at
3440×1440; canvas-JPEG pipeline is bandwidth-bound). User chose
DXGI over SharedBuffer for native-resolution + zero-IPC-bandwidth.
Production fallback (on spike NO-GO or runtime detection failure):
**legacy arch-A** (visible popup, chrome cutout artifact accepted
with UI accommodations).

**Difficulty:** ★★★★★ (largest in project history).

**Effort estimate:** ~5 weeks focused work (vs ROADMAP's original
40-80h, which I believe is optimistic given FD6/B history and the
wider-a11y testing scope).

**Predecessor:** Phase 2 work on session branch (popup hidden,
canvas-jpeg transport, viewport/input bridge surface).

---

## 1. Goal + scope

**When this ships:** engine pixels flow GPU → GPU into the WebView2
visual tree with zero CPU readback or compression. At 3440×1440
maximized with no particles, FPS is engine-limited rather than
transport-limited (target: 100+ FPS, achieved by removing
`GetRenderTargetData` + JPEG encode/decode + JSON marshalling from
the per-frame path). Phase 2's canvas-JPEG transport is demoted
to a diagnostic env-var-gated dev mode. **Legacy arch-A is the
production fallback**: if Stage 0 spike says NO-GO, or if runtime
detection on user hardware fails, the host reverts to the visible
WS_EX_LAYERED popup with the chrome cutout artifact accepted (plus
optional UI accommodations dispatch to minimize where the artifact
shows).

**In scope:**
- D3D9 → D3D9Ex migration on the engine device
- Shared-handle D3D9Ex render target opened by a parallel D3D11
  device (new `host::DxgiInteropBridge` class)
- WebView2 switched from HWND hosting to composition hosting
  (`ICoreWebView2CompositionController`)
- DirectComposition visual tree: engine D3D11 swapchain below +
  WebView2 visual above (transparent over viewport region)
- Removal (under DXGI mode) of popup HWND, AlphaCompositor stamp
  pipeline, FramePublisher — they become dead code or fallback-only
- Input routing rework: host window receives input directly under
  visual hosting, Phase 2 `viewport/input` bridge surface adapts
- Runtime fallback to arch-A on init failure (driver doesn't
  support shared handles, multi-GPU mismatch, WebView2 visual
  hosting init fails, etc.)
- Automated test infrastructure: pixel-diff, FPS-threshold,
  resource-leak, long-run stability — added incrementally per
  stage
- **Rigorous a11y testing** (per user direction): Narrator, IME
  composition, screen-reader navigation all verified under
  composition hosting

**Out of scope (filed for later):**
- HDR / wide-color rendering — separate ROADMAP entry if needed
- Multi-monitor / hot-plug GPU edge cases beyond "works on each
  monitor independently"
- Driver-version test matrix in CI (we test on user's dev rig
  only; runtime fallback covers unsupported drivers in production)
- Engine rendering changes other than the D3D9 → D3D9Ex bump —
  draw calls, shaders, particle system stay byte-identical
- **UI accommodations for arch-A fallback** — only triggered if
  Stage 0 says NO-GO; filed as a separate dispatch at that point

**Explicitly not happening:** SharedBuffer transport (Path C from
the original spike). User direction: DXGI is the bet; arch-A is
the fallback. SharedBuffer was a midpoint that adds a third
codepath to maintain forever, and arch-A already ships and works.

---

## 2. What the codebase already gives us

| Existing surface | How it's relevant |
|---|---|
| `Engine` class with private D3D9 device ([engine.cpp](../src/engine.cpp), 2000+ LOC) | Stage 1 swaps `Direct3DCreate9` → `Direct3DCreate9Ex`. All existing `IDirect3DDevice9` calls remain valid (IDirect3DDevice9Ex inherits the interface). Cumulative migration risk addressed by isolating this stage. |
| `AlphaCompositor` ([src/host/AlphaCompositor.{h,cpp}](../src/host/AlphaCompositor.h), 681 LOC) | Under DXGI: dead code (no CPU compositing). Under arch-A fallback: still does its job exactly as today. Stage 7 deletion guarded by "is DXGI default?" |
| `FramePublisher` ([src/host/FramePublisher.{h,cpp}](../src/host/FramePublisher.h)) | Same — dead under DXGI, useful under arch-A fallback or canvas-jpeg diagnostic mode. |
| `LayoutBroker` ([src/host/LayoutBroker.{h,cpp}](../src/host/LayoutBroker.h)) | Scene-rect handling adapts: under DXGI, drives the position of the engine D3D11 swapchain visual within the host window. Popup-HWND tracking goes away under DXGI. |
| Phase 2 `InputDispatcher` ([src/host/InputDispatcher.{h,cpp}](../src/host/InputDispatcher.h)) | Survives. Keyboard path through bridge unchanged. Mouse path: under DXGI the host owns input directly so InputDispatcher may shrink, OR may stay as the abstraction for renderer-routed keyboard. |
| Phase 2 `viewport/input` bridge schema | Survives unchanged. |
| WebView2 environment + controller creation ([HostWindow.cpp:InitWebView2](../src/host/HostWindow.cpp:692)) | Stage 3 swaps `CreateCoreWebView2Controller(hwnd, ...)` for `CreateCoreWebView2CompositionController(hwnd, ...)`. Bridge dispatcher, accelerator handlers, settings all carry over. |
| `WebView2.h` SDK 1.0.3967.48 ([packages/Microsoft.Web.WebView2.1.0.3967.48](../packages)) | Includes `ICoreWebView2CompositionController` + `CreateSharedBuffer`/`PostSharedBufferToScript` (verified via grep). Composition API stable since 1.0.864; we're well past that. |
| Vitest harness (335 tests, all green) | Limited additions — most DXGI testing moves to Playwright. |
| Playwright native-CDP harness (90 tests, all green) | Primary hook for pixel-diff, FPS-threshold, resource-leak, stress tests. Already drives the binary via `pnpm test:native`. |
| `viewport_poc.vcxproj` standalone exe pattern | Template for Stage 0 spike app (`src/host/spike/dxgi_spike.cpp` etc.) |
| FD6/FD9 historical docs ([docs/superpowers/plans/2026-05-18-fd9-viewport-alpha-compositing.md](../docs/superpowers/plans/2026-05-18-fd9-viewport-alpha-compositing.md)) | Stage 0 deliverable includes a post-mortem doc summarizing why three prior visual-hosting attempts failed and how this one differs. |

---

## 3. Architecture / implementation approach

### 3.1 Two graphics devices coexist

- **D3D9Ex device** owned by `Engine`. Renders particles to a
  shared-handle texture each frame.
- **D3D11 device** owned by new `host::DxgiInteropBridge`. Opens
  the engine's shared texture, wraps it in a DXGI swapchain,
  attaches the swapchain visual to DirectComposition.

The two devices use the same physical GPU but have independent
command streams. Synchronization via shared-handle semantics:
after D3D9Ex `Present`, the shared handle is "ready"; D3D11 reads
on its next composite pass. Optionally use a cross-device
`ID3D11Fence` for explicit sync — generally not required for
static-snapshot-per-frame patterns. Decision deferred to Stage 2
empirical testing.

### 3.2 Visual tree

```
Host HWND (main window — top-level HWND)
└── IDCompositionDesktopDevice
    └── IDCompositionTarget bound to host HWND
        └── Root Visual
            ├── Engine Visual (D3D11 swapchain content)
            │   - Positioned at scene-rect (LayoutBroker drives)
            │   - Z-order: behind WebView2
            └── WebView2 Visual (from
                ICoreWebView2CompositionController.RootVisualTarget)
                - Full window size
                - Transparent background where viewport rect is
                - Receives DOM input via WebView2 normal pipeline
```

No alpha-compositor stamping. CSS transparency handles the
"viewport shows through chrome" effect — the WebView2 visual is
transparent where the viewport quadrant is (matches the existing
`<div>` placeholder pattern), engine visual shows through.

### 3.3 Frame loop

1. Engine renders to shared-handle texture (existing D3D9 draws;
   only the render target object changed)
2. Engine `Present` → D3D9 driver signals shared-handle ready
3. D3D11 device's next swapchain Present picks up the new content
4. DComp composites engine visual + WebView2 visual
5. Visual tree presents to host HWND

Per-frame cost: **GPU only.** No `GetRenderTargetData`, no JPEG,
no memcpy, no JSON, no renderer-side decode. The Phase 2
diagnostic mode shows what we're saving — ~85 ms per frame at
3440×1440 — eliminated wholesale.

### 3.4 Input routing under visual hosting

Under HWND-mode WebView2, all input reached the WebView2 HWND
first. Under composition hosting, input reaches the host HWND;
the host must forward into WebView2 via
`ICoreWebView2CompositionController::SendMouseInput` /
`SendPointerInput` / `SendKeyboardInput`. This is significant
input rework but well-documented in Microsoft samples.

Phase 2's `viewport/input` bridge surface stays for renderer-
routed keyboard cases (Shift held for spawn, with TYPING_TAGS
guard). Most mouse input flows to host WNDPROC directly — the
popup HWND target goes away.

### 3.5 Lifecycle + reset

- **Engine device reset** (alt-tab, sleep, driver crash):
  D3D9Ex `D3DERR_DEVICELOST` → recreate shared-handle texture →
  re-publish to D3D11 side → D3D11 reopens handle.
- **Window resize**: scene-rect updates → D3D11 swapchain resize
  → engine render target resizes (or stays fixed and CSS scales,
  decision in Stage 4).
- **WebView2 navigation**: visual stays attached, content reloads
  — no DXGI impact.
- **Process shutdown**: WebView2 visual released first, then
  D3D11 swapchain, then engine. Tested explicitly by Stage 6
  leak harness.

### 3.6 Fallback to arch-A

At `DxgiInteropBridge` init, detect failure modes and fall back:

| Failure | Detection | Action |
|---|---|---|
| `D3DERR_NOTAVAILABLE` on shared-handle create | D3D9Ex `CreateTexture` returns error | Fall back to arch-A; log GPU + driver version |
| `OpenSharedResource` fails | D3D11 returns error | Same |
| Multi-GPU mismatch | `IDXGIAdapter::GetDesc` LUID differs between D3D9Ex and D3D11 device | Same |
| Visual hosting init fails | WebView2 `CreateCoreWebView2CompositionController` returns error | Same — full revert to HWND-mode WebView2 |
| Stage 0 spike NO-GO | Pre-decision before any production code | Plan abandoned; file UI accommodations dispatch as the next move |

Logs include GPU/driver/WebView2-version triple so the user can
report which combo failed.

---

## 4. Stage decomposition

| Stage | What it produces | Effort | Reversible? |
|---|---|---|---|
| **0. Spike** | Standalone test app proving D3D9Ex shared handle → D3D11 → WebView2 composition pipeline end-to-end. Doc summarizing FD6/B failure root causes. Perf measurement vs arch-A baseline. **GO/NO-GO gate.** | 2 days | Hard gate. NO-GO → revert Phase 2 + file UI accommodations dispatch. |
| **1. D3D9Ex migration** | Engine uses D3D9Ex; all existing tests pass; behavior identical to today. | 2-3 days | Yes (one revert commit) |
| **2. Shared texture infrastructure** | `Engine::GetSharedTextureHandle()` returns valid HANDLE; D3D11 side opens it; bit-exact pixel verification via D3D11 readback test. Standalone — no WebView2 yet. | 3-4 days | Yes |
| **3. WebView2 composition hosting migration** | WebView2 swapped to visual hosting; behaviorally identical to HWND mode (existing 90 Playwright tests pass; rigorous a11y suite passes). **Highest-risk stage** — historical FD6/B failure point. | 5-7 days (extended for a11y) | Yes (env-var gated) |
| **4. DXGI composition wiring** | First end-to-end frame via DXGI visible. Behind `ALO_VIEWPORT_TRANSPORT=dxgi` env var. Pixel-diff vs canvas-jpeg passes. | 3-4 days | Yes |
| **5. Input routing rework** | All Phase 2 input gestures work under DXGI mode. Mouse path migrated to host WNDPROC; keyboard path via bridge survives. | 2-3 days | Partial (some code shared with Phase 2) |
| **6. Automated test harness** | Pixel-diff infrastructure, FPS-threshold tests, D3D11 debug layer leak assertions, stress tests, driver-fallback test. Added incrementally during stages 1-5; consolidated here. | 3-4 days (parallel with prior stages) | n/a — additive |
| **7. Polish + cleanup** | Phase 2's FramePublisher + AlphaCompositor either deleted (if DXGI ships as default) or kept as fallback. ROADMAP + CHANGELOG + HANDOFF. | 2-3 days | Last commit reversible |

**Total**: ~22-30 days of focused work = ~5 weeks. Each stage
lands behind the env var; default behavior (legacy popup or
canvas-jpeg) stays unchanged for production users. User can
demand a checkpoint or freeze between any two stages.

---

## 5. Risks named up front + mitigations

1. **FD6/B history — three prior failures in this API family.**
   *Mitigation:* Stage 0 hard gate; reads post-mortems before any
   production code lands. NO-GO falls back to arch-A + UI
   accommodations dispatch (not SharedBuffer, not canvas-jpeg).
   2-day spike caps the bet.

2. **D3D9Ex behavior differences from D3D9.** Different `Reset`
   semantics, can't use `D3DPOOL_MANAGED`, etc. The engine likely
   uses managed pool somewhere. *Mitigation:* Stage 1 is a
   standalone migration with no other changes; full vitest +
   Playwright + manual smoke must be green before Stage 2
   proceeds. ANY behavior change blocks until fixed.

3. **D3D9-D3D11 interop driver compatibility.** Intel iGPU
   drivers have known historical bugs in shared-handle paths.
   *Mitigation:* Hard runtime detection — if init fails OR if
   a 1-pixel readback validation fails, log and fall back to
   arch-A. User on unsupported GPU gets working editor with
   legacy chrome-cutout, not a crash. `--force-dxgi` debug flag
   to override fallback for diagnosis.

4. **WebView2 composition hosting is input/focus/a11y-different
   from HWND hosting.** Documented FD6 failure point.
   *Mitigation:* Stage 3 swaps hosting behaviorally-identically
   first; every existing Playwright test must pass; **rigorous
   a11y suite** (per user direction) added covers Narrator
   reading, tab navigation, IME composition, dialog accessibility.

5. **Resource leak on resize / device reset.** D3D resources +
   DComp visuals + shared handles all need correct teardown.
   *Mitigation:* D3D11 debug layer assertions in Debug builds
   assert zero live objects at shutdown. Stage 6 leak harness
   does 200×modal-cycle + 200×resize + 5 min stress, asserts
   < 1MB VRAM growth.

6. **WS_EX_LAYERED + WebView2 visual hosting interaction.**
   Specific historical FD6 failure mode. *Mitigation:* Stage 0
   spike specifically reproduces this configuration; document
   what works.

7. **Multi-GPU laptop systems.** Shared handles across physical
   GPUs don't work. *Mitigation:* LUID match check between
   devices → fall back to arch-A on mismatch.

8. **Performance might not justify the cost.** DComp has its own
   overhead. *Mitigation:* Stage 0 perf measurement vs arch-A
   baseline. If DXGI < 2× faster than arch-A on user's rig,
   abort (arch-A already ships; cutout artifact accepted with UI
   adjustments).

9. **Composition API evolved across WebView2 SDK versions.**
   *Mitigation:* Stage 0 confirms 1.0.3967.48 supports all APIs
   we use; document minimum required version.

10. **A11y / IME might break under visual hosting.** User
    explicitly requested rigorous testing. *Mitigation:* Stage 3
    extended by 2-3 days for a11y/IME smoke + automated
    Narrator-driving where feasible. If found broken,
    documented as known issue + fall back to arch-A flag for
    affected users.

11. **Multi-week project mid-development is hard to abandon.**
    Sunk cost pressure to ship something broken. *Mitigation:*
    Stage gates with user. After each stage, explicit "ship N,
    continue to N+1, or freeze and revert?" decision.

12. **Vitest can't drive D3D9.** Renderer-side tests give low
    coverage on the new code. *Mitigation:* Stage 6 invests in
    Playwright-side pixel-diff + perf + leak tests proportional
    to risk.

---

## 6. Testing & verification (per stage)

Per CLAUDE.md, these are verifiable claims that gate stage
progression. The user explicitly chose "minimize manual testing"
+ "rigorous a11y." Automated tests dominate; manual reserved for
items that genuinely require a human (screen reader, IME).

### Stage 0 (spike) acceptance — hard GO/NO-GO gate

- [ ] **FD6/B post-mortem doc** at `docs/superpowers/research/dxgi-fd6-fd9-history.md`: one paragraph per prior attempt, root cause + why this attempt differs
- [ ] **Standalone test app** at `src/host/spike/dxgi_spike.cpp` (template: existing `viewport_poc.vcxproj`): creates D3D9Ex device, shared-handle texture, opens in D3D11, presents through DComp visual into a host HWND. Visible test pattern proves end-to-end works.
- [ ] **API stability check**: scripted grep against `WebView2.h` confirms all APIs we plan to use have stable interface IDs in 1.0.3967.48
- [ ] **Perf measurement** at 720p / 1080p / 1440p / 3440×1440: record D3D9 render time, D3D11 composite time, end-to-end frame latency. Document vs Phase 2 canvas-jpeg numbers (~25ms at 3440×1440 → target < 10ms total) AND vs arch-A current (which is fast at native, only struggles with cutout artifact).
- [ ] **Mixed-mode interaction sanity**: WebView2 visual + D3D11 visual co-composited via DComp; confirm transparency / z-order works
- [ ] **Decision doc**: short markdown that says GO or NO-GO with reasons. Committed to repo.

### Stage 1 (D3D9Ex migration) acceptance

- [ ] vitest **335/335 pass**
- [ ] Playwright **90/90 pass**
- [ ] MSBuild Debug + Release x64 clean
- [ ] Manual: launch in legacy mode, new-UI legacy popup, new-UI canvas-jpeg modes; all three render and accept input as today
- [ ] **New auto test** `tests/native/d3d-init.spec.ts`: boot in each mode, assert log contains `[D3D9Ex] device created` (or fallback)
- [ ] D3D9 debug layer reports zero errors at shutdown

### Stage 2 (shared texture) acceptance

- [ ] **Standalone unit test** at `src/host/spike/shared_texture_test.cpp` (doctest framework): create shared texture, open in D3D11, write known pattern from D3D9, read back from D3D11, verify bit-exact match
- [ ] D3D11 debug layer reports zero errors
- [ ] Documented on user's dev rig with GPU + driver version

### Stage 3 (composition hosting) acceptance — rigorous a11y

- [ ] **All 90 Playwright tests pass** under visual hosting (gated by env var for A/B). CRITICAL gate — FD6 failure point.
- [ ] **New Playwright** `tests/native/composition-hosting.spec.ts`: assert clicks/keys reach renderer with identical coords/values as HWND mode
- [ ] **A11y automated**: `tests/native/a11y-narrator.spec.ts` — drive Windows Narrator via UI Automation, verify it reads (a) menubar items, (b) tree row labels, (c) dialog modal titles, (d) form-field labels. Compare announcement strings to a golden file. Tolerance for minor wording shifts.
- [ ] **A11y manual** (irreducibly): Narrator reads visible chrome correctly, tab cycles through interactive elements, F2 enters inline rename, Escape closes modal/menu
- [ ] **IME smoke** (if user installs an IME): typing in inspector fields composes correctly under visual hosting
- [ ] **Keyboard nav stress**: Playwright drives 100 random tabs / arrow keys / accelerators; assert no crash + focus always visible

### Stage 4 (DXGI composition wiring) acceptance

- [ ] **New Playwright** `tests/native/dxgi-transport.spec.ts`: boot with `ALO_VIEWPORT_TRANSPORT=dxgi`, assert `[DXGI] up` in log, screenshot canvas region, verify non-black (engine pixels arrived)
- [ ] **Pixel-diff** `tests/native/dxgi-vs-jpeg.spec.ts`: same engine state under canvas-jpeg and DXGI; SSIM > 0.95 (allows compositing differences, flags structural breaks)
- [ ] **Perf threshold** `tests/native/dxgi-perf.spec.ts`: drive FPS counter for 10s; assert mean FPS > 80 at 1080p AND > 60 at 3440×1440 (vs Phase 2's 20 FPS — 3× improvement is the bar)
- [ ] **Resize stress**: 50 programmatic resizes; assert no crash, no log errors, FPS recovers to baseline after settling

### Stage 5 (input routing) acceptance

- [ ] **All Phase 2 mouse + keyboard gestures** work under DXGI: LMB/MMB/RMB drag, wheel zoom, Ctrl modifier, Shift+LMB placement, Shift-only spawn, Alt-Tab cleanup
- [ ] **Extension** of `canvas-architecture.spec.ts` runs under DXGI mode
- [ ] **Focus regression** test: clicking viewport then clicking inspector field doesn't trap focus

### Stage 6 (test harness) acceptance — runs through prior stages

- [ ] **Pixel-diff infrastructure**: Playwright helper screenshots a named region, compares to baseline image with configurable SSIM tolerance. Used by stages 3, 4, 5.
- [ ] **Resource leak harness** `tests/native/resource-leak.spec.ts`: 200× modal-cycle + 200× resize; initial/final VRAM measurement via D3D11 debug layer; assert < 1MB delta
- [ ] **Long-run stability**: 5 min automated drive (camera rotate + emit + modal cycle + resize); assert no crash, no log errors above warning
- [ ] **Driver fallback** `tests/native/driver-fallback.spec.ts`: force `OpenSharedResource` to fail via debug toggle; assert fallback to arch-A; app stays usable
- [ ] **A11y regression**: Narrator-driving suite runs in CI loop

### Stage 7 (cleanup) acceptance

- [ ] CHANGELOG entry (top, reverse chrono) covering all of Phase 3
- [ ] HANDOFF.md refreshed for next session
- [ ] ROADMAP: strike [MT-11], move to Shipped, vacate tag
- [ ] tasks/lessons.md: every gotcha discovered during the 5 weeks
- [ ] Optional: default `ALO_VIEWPORT_TRANSPORT=dxgi`; demote canvas-jpeg + arch-A to opt-in `--legacy-transport` flag
- [ ] If NO-GO at Stage 0: revert Phase 2 commits, file UI accommodations dispatch

---

## 7. Cross-cutting automated test budget

| Test family | Tool | Cost | Catches |
|---|---|---|---|
| Pixel-diff snapshots | Playwright + image-diff | ~30s/scenario | Silent wrong pixels, compositor placement bugs |
| Perf threshold | Playwright + FPS counter | ~30s/resolution | Performance regressions |
| Resource leak | Playwright + D3D11 debug layer | ~2 min | VRAM / HWND / GDI leaks |
| Driver fallback | Playwright + debug toggle | ~10s | Fallback doesn't crash |
| Stress + long-run | Playwright loop | ~5 min | Heisenbugs, slow drift |
| A11y Narrator | Playwright + UI Automation | ~2 min | Composition hosting breaking screen readers |
| IME composition | Manual + IME (irreducible) | ~2 min | Composition under visual hosting |

**Total automated test runtime**: ~10 min. **Test infrastructure
work**: ~3-4 days, spread across Stage 6. Manual surface
reduced to: (a) initial visual confirmation after each stage,
(b) IME smoke if applicable.

---

## 8. Stage gate semantics

Between each stage, an explicit checkpoint with the user:
- **Ship Stage N as-is** (commit + FF to lt-4)
- **Continue to Stage N+1** (Stage N stays uncommitted until N+1 completes)
- **Freeze + ship partial** (revert any unstable changes, commit stable subset, file remainder as separate dispatch)

Stage 0 is the hardest gate: NO-GO triggers Phase 2 revert + UI
accommodations dispatch.

---

## 9. Open execution items before code starts

1. **User OK to start Stage 0 spike.** (No code yet — this whole
   plan is paper.)
2. **Decision on Phase 2 state during Stage 0**: keep Phase 2's
   working tree state intact (don't commit; don't revert) so we
   have a known-working canvas-jpeg fallback to compare against.
   Stage 0 spike is in a separate worktree or local-only files
   so Phase 2 state is untouched. Alternative: commit + FF Phase 2
   before starting (cleaner branch hygiene, slight delay to Stage
   0 start; Phase 2 ships behind env var so production users see
   no change).
3. **Reference docs queued for Stage 0 reading**: FD6 / FD9 plan
   docs at [`docs/superpowers/plans/2026-05-18-fd9-viewport-alpha-compositing.md`](../docs/superpowers/plans/2026-05-18-fd9-viewport-alpha-compositing.md);
   WebView2 visual hosting samples (Microsoft repo).

---

## Background reading

Prior planning history (canvas-JPEG approach, Phase 0+1+2) lives
in [`todo-mt-11-phase-0-1-2-archive.md`](todo-mt-11-phase-0-1-2-archive.md).
Useful sections of that archive:

- §3.1 transport comparison (canvas-JPEG vs SharedArrayBuffer vs postMessage)
- §6 phase decomposition + Phase 0 spike report
- §10 architectural survey
- §11 Phase 2 execution review (T2.1 → T2.6 retrospective)

Phase 2 implementation artifacts on the session branch:
- `viewport/input` bridge surface — [`bridge-schema/src/index.ts`](../web/packages/bridge-schema/src/index.ts)
- `src/host/InputDispatcher.{h,cpp}` — host-side input bridge
- `src/host/FramePublisher.{h,cpp}` — engine→canvas JPEG transport
- `web/apps/editor/src/lib/viewport-input.ts` — renderer encoders
- `web/apps/editor/src/components/ViewportSlot.tsx` — three useEffect blocks
- 26 encoder unit tests + 9 ViewportSlot DOM tests + 3 canvas-architecture Playwright tests

Phase 2's CHANGELOG draft with `TODO-HASH` placeholders is at the
top of [`CHANGELOG.md`](../CHANGELOG.md).
