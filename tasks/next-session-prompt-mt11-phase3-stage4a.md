# Next-session prompt — [MT-11] Phase 3 Stage 4a (Compositor + Engine sync skeleton)

> **Copy the block below into the next session's first message.**
>
> The sub-plan is drafted but no production code has been written.
> Decisions D1-D6 in §8 of the sub-plan need user OK before sub-stage
> 4a starts. The session that drafted the plan stopped at the
> risks/decisions check-in per CLAUDE.md "★★★★ plans iterate risks
> with the user before writing code."

---

Pick up [MT-11] Phase 3 Stage 4 — DXGI composition wiring. The sub-plan
already exists; this session is the risks-iteration check-in + sub-stage
4a (Compositor + Engine sync helpers skeleton). After 4a, **the load-
bearing 4b gate is the first place D3D11 + DXGI + DComp interactions
can fail in production** — equivalent to Stage 3's 3b FD6 gate but for
the GPU pipeline rather than the WebView2 chrome pipeline.

The spike's measured 0.30 ms total frame-transport at 3440×1440 holds
on this hardware (Stage 0 GO decision). Production overhead adds
substantial per-frame cost; the perf gate is generous (FPS > 80 at
1080p, > 60 at 3440×1440 — vs Phase 2's 40-50 FPS at 3440×1440 with
the readback path that Stage 2's perf investigation captured).

Pre-flight (in order):

CLAUDE.md — working principles, branch workflow, plan structure, the
★★★★ rule (iterate risks before code).

tasks/HANDOFF.md — current state. Phase 3 Stages 0/1/2/3 shipped on
origin/lt-4. Stage 4 sub-plan drafted but no code.

**tasks/dxgi-stage-4-composition-wiring.md — the sub-plan.** Active
document. Read end-to-end. Key sections:
- §1 In/Out scope (scene-rect transform deferred to Stage 5)
- §3 Architecture — extend `host::Compositor` (no new TU, no new L-016
  override), three new public methods, Engine exposes thin
  `IssueEndFrameQuery`/`WaitEndFrameQuery` helpers
- §4 Sub-stage decomposition — 6 sub-stages, 4.25-day budget
- §5 Risks (14 items) — **iterate with user before coding**
- §6 Testing — pre-coding gate must be green before 4a
- §8 Decisions D1-D6 — **surface for user OK before 4a starts**

tasks/dxgi-stage-3-composition-hosting.md §1 line 5 reserves the
`AttachEngineVisual(swapchain)` seam Stage 4 fills. The actual Stage 4
signature is broader: `AttachEngineVisual(HANDLE sharedTexture, int w,
int h, void* d3d9DeviceForSync)` — Compositor owns the D3D11 device +
DXGI factory + swapchain itself; only the shared handle + sync query
cross the boundary. Sub-plan §3.1 has the rationale.

tasks/lessons.md L-007 (D3DPOOL_DEFAULT lifecycle), L-016 (Compositor.cpp
per-file include override, already in place — Stage 4 adds NO new TU),
L-017 (verify SDK assumptions via docs before bumping; not relevant to
Stage 4 directly but the verification discipline applies).

src/host/spike/dxgi_spike.cpp — working reference:
- `InitD3D11AndSwapchain` (305-405) — D3D11 device + OpenSharedResource
  + CreateSwapChainForComposition + GetBuffer for back buffer. Production
  port lives in Compositor.cpp.
- `RenderD3D9Frame` (665-699) — D3D9 event-query sync. Production
  splits: engine half stays in Engine (Engine::IssueEndFrameQuery + Wait);
  D3D11 half is Compositor::CompositeEngineFrame.
- `CompositeD3D11Frame` (701-708) — D3D11 CopyResource + Present1.
  Production: Compositor::CompositeEngineFrame.
- `BuildVisualTree` engine block (460-477) — engine visual creation +
  SetContent(swapchain) + AddVisual(engine, TRUE, nullptr) for "behind
  all" via the MSDN-naming inversion.

src/host/Compositor.h + .cpp — Stage 3's class. pImpl design + L-016
isolation already in place. Stage 4 adds three public methods (signatures
in sub-plan §3.1) and several ComPtr members to Impl (D3D11 device,
context, DXGI factory, swapchain, back buffer, shared-resource alias,
engine visual, D3D9 sync query).

src/host/HostWindow.cpp `OnCompositionControllerReady` (~line 1029) —
Stage 3's wire-up. Stage 4 adds a call to `m_compositor->AttachEngineVisual(
engine->GetSharedTextureHandle(), aSize.cx, aSize.cy,
engine->GetDeviceForSync())` after `AttachWebView2` succeeds.
HostWindow's RenderD3D9 path (grep `m_framePublisher->OnFrameComposited`)
gets a new per-frame call to `m_compositor->CompositeEngineFrame()`
under composition mode after `engine->Render()` (and after the
Engine::Wait sync).

src/engine.cpp `GetSharedTextureHandle` (line 1347) — already shipped
Stage 2. Forwards to AlphaCompositor::GetSharedHandle (line 201). Stage
4 also needs Engine to expose two thin sync helpers:
`IssueEndFrameQuery()` + `WaitEndFrameQuery()` (or one combined call) —
~10 lines wrapping an `IDirect3DQuery9` of `D3DQUERYTYPE_EVENT`. The
spike's pattern at dxgi_spike.cpp:687-697 is the line-for-line port.

src/host/AlphaCompositor.cpp `Resize` (lines 131-150) — recreates the
shared HANDLE every call. Stage 4's CompositeEngineFrame does a lazy
per-frame handle-equality check; on mismatch, re-opens the D3D11 alias.
No explicit notification wiring needed.

Lineage check at session start (BOTH should be 0):
```
git log --oneline origin/lt-4..HEAD
git log --oneline HEAD..origin/lt-4
```
Local `lt-4` ref in this worktree may be stale per sister-worktree note
in HANDOFF — origin/lt-4 is the authoritative reference.

Pre-coding gate (sub-plan §6 — all must be green BEFORE 4a):

- vitest 335 / 335
- tsc -b 0 errors
- MSBuild Debug + Release x64 clean
- Playwright native HWND baseline 99/99 (composition specs skip cleanly)
- Composition-mode 106/107 (1 self-skip on curve-editor-wheel when no
  emitter selected) under `ALO_WEBVIEW2_HOSTING=composition` +
  `ALO_VIEWPORT_TRANSPORT=canvas-jpeg`
- shared_texture_test.exe PASS on RTX 3080 (Stage 2 validation; still
  bit-exact across resolutions)
- dxgi_spike.exe runs at 1080p showing live FPS counter (smoke, not
  strictly required but worth confirming the spike still works as the
  GPU-pipeline reference)

**Sub-plan check-in order for this session:**

1. **Read tasks/dxgi-stage-4-composition-wiring.md end-to-end.** Don't
   re-write the plan; the prior session drafted it after reading every
   referenced source file. If you find a real defect in §3 architecture
   or §5 risks, surface it before changing the plan — don't edit
   silently.

2. **Iterate §5 risks with the user.** Particularly risks #1 (multi-GPU
   LUID mismatch fallback), #3 (cross-device sync — D3D9 query spin vs
   no-sync), #6 (z-order inversion via MSDN naming gotcha), and #11
   (4b smoke shows chrome but no engine pixels — bisect via
   shared_texture_test.exe). The user explicitly opted into the risks-
   iteration step for ★★★★ plans.

3. **Get user OK on §8 decisions D1-D6.** The sub-plan recommends:
   - D1: 2 load-bearing gates (4b + 4f)
   - D2: Engine-exposed sync helpers (path b)
   - D3: Single `AddVisual(engine, TRUE, nullptr)` for behind-all
   - D4: Lazy per-frame handle check
   - D5: 6 sub-stages (4a-4f)
   - D6: Skip-engine-attach on LUID mismatch (chrome works, viewport
     empty)

4. **Run the pre-coding gate.** If anything's red, fix or surface
   before proceeding.

5. **Sub-stage 4a — additive skeleton.** Per sub-plan §4:
   - Compositor.h: add `AttachEngineVisual(HANDLE, int, int, void*)` +
     `CompositeEngineFrame()` + `RefreshEngineSharedHandle(HANDLE, int,
     int)` declarations.
   - Compositor.cpp: stub implementations returning S_OK / S_FALSE
     without side effects. No new includes yet (those land in 4b with
     the real implementation).
   - engine.h: add `void IssueEndFrameQuery()` + `void
     WaitEndFrameQuery()` (or `void EndFrameAndSync()` — combined call
     is cleaner if the production engine never wants to overlap CPU
     work between Issue and Wait).
   - engine.cpp: real implementation. Create `IDirect3DQuery9` of
     `D3DQUERYTYPE_EVENT` lazily on first call; Issue(`D3DISSUE_END`);
     spin on GetData with 100k-iteration cap (matching spike line 693).
     The sync query is an Engine member, lifecycle alongside the D3D9Ex
     device.
   - vcxproj entry for any new file IS NOT NEEDED (no new TU — Compositor
     gains methods, Engine gains methods, both files exist).
   - Verification: MSBuild Debug + Release x64 clean; vitest 335/335;
     tsc -b; native 99/99 PASS unchanged.
   - Commit message: `feat(LT-4): [MT-11] Phase 3 Stage 4a — Compositor
     engine-visual API + Engine cross-device sync helpers (skeleton)`

6. **Check in with user before sub-stage 4b** (the load-bearing GPU-
   pipeline gate). 4b is where D3D11 device creation, OpenSharedResource,
   composition swapchain creation, and engine visual attach all happen
   for the first time in production context.

End-of-session FF (per CLAUDE.md branch workflow):
```
git switch lt-4
git fetch origin
git merge --ff-only claude/<session-name>
git push
```

(If local `lt-4` is stale, `git fetch origin` + `git reset --hard
origin/lt-4` before the merge — or push HEAD directly via `git push
origin HEAD:lt-4` which is FF-only on the remote.)

---

**Context window note.** The prior session burned ~22% of 1M context
drafting the sub-plan + reading every referenced source file. This
session reads the sub-plan + executes 4a. Budget should be comfortable
even on a fresh 1M window. If the session is on a smaller model /
budget, the sub-plan is structured so 4a can be done from the sub-plan
alone — no need to re-read the spike or HANDOFF unless 4a hits an
issue.
