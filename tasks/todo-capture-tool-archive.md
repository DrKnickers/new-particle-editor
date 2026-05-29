# [LT-4 rendering-fidelity] Host frame-capture mode (`--capture`)

**Context:** Rendering-fidelity sub-project, front #1 of the
"make architecture C daily-drivable" program. Immediate driver: the
additive-over-smoke dark-quad regression (the `d9b690f` symptom that
returned despite `ALPHA_MODE_IGNORE` still being set). Static analysis
exhausted; the bug is visual in a native D3D9 app neither the harness
nor I can see. This tool removes the user from the visual loop.

**Repro asset:** `P_Frigate_Damage.ALO` (smoke + Fire Large/Small +
Glow — additive-over-alpha-blend content that triggers the symptom).

**Target branch:** `lt-4`  **Difficulty:** ★★ (2/5)
**Effort:** ~half-day for Phase 1.

---

## 1. Goal + scope

**When this ships:** `ParticleEditor.exe --new-ui --capture <alo> <png>
[--frames N]` boots, loads `<alo>`, renders N frames, writes the
engine's render target to `<png>`, and exits. I can then `Read` the
PNG and diff fidelity **without the user looking at a screen**.

**In scope (Phase 1):**
- New host CLI flag `--capture <alo> <png>` + optional `--frames N`
  (default 60).
- Programmatic `.alo` load (reuse the bridge `file/open` load core).
- Engine-RT → PNG capture (`GetRenderTargetData` + `D3DXSaveSurfaceToFile`).
- Clean process exit after capture.

**Out of scope (deferred, with reason):**
- **Composite-surface capture** (the final DComp swapchain output via
  D3D11/WIC) — Phase 2, only if Phase 1 shows the engine RT is clean
  (which would localize the bug to DComp and make the composite shot
  worth the extra WIC code).
- **Cross-mode / golden-image regression harness** — Phase 3, the
  reusable 1:1 gate; needs deterministic sim (fixed RNG seed +
  fixed-step), its own design.
- **Sim determinism** — not needed for *this* symptom (dark quads are
  visible in any populated frame); deferred to Phase 3.

## 2. What the codebase already gives us

- **Arg parsing** at [`src/main.cpp:8104`](../src/main.cpp) (`CommandLineToArgvW`
  loop already handling `--new-ui` / `--test-host`).
- **Engine render** driven at [`HostWindow.cpp:710`](../src/host/HostWindow.cpp)
  via `engine->Render()`.
- **Engine RT = AlphaCompositor offscreen RT** ([`engine.cpp:650-657`](../src/engine.cpp)),
  present in *both* modes (host.log "AlphaCompositor up"). Mode-
  independent: composition only changes how this RT is *presented*.
- **Proven capture pattern**: `AlphaCompositor` already does
  `GetRenderTargetData` into a system-mem surface
  ([`AlphaCompositor.cpp:566,692`](../src/host/AlphaCompositor.cpp))
  and exposes `GetRenderTarget()` ([`:199`](../src/host/AlphaCompositor.cpp)).
- **File load core**: bridge `file/open` handler
  ([`BridgeDispatcher.cpp:1572`](../src/host/BridgeDispatcher.cpp))
  reads `.alo` → `ParticleSystem` → `engine->OnParticleSystemChanged`.
  Mirrors legacy `LoadFile` ([`main.cpp:1103`](../src/main.cpp)).
- **`D3DXSaveSurfaceToFile`** available (d3dx9 linked; `d3dx9_43.dll`
  ships in releases).

## 3. Architecture / implementation approach

1. **Arg parse** (`main.cpp`): recognise `--capture <alo> <png>` +
   `--frames N`; thread the values to `HostWindow` (members or a small
   `CaptureRequest` struct).
2. **Capture boot path** (`HostWindow`): when a capture request is
   present, boot the engine + AlphaCompositor + bind state as normal,
   but drive the engine directly rather than waiting on React:
   - Programmatically load `<alo>` through the existing `file/open`
     load core (path-provided branch — no dialog).
   - Run a tight loop: `for (i < N) { engine->Render(); brief message
     pump; }` so particle systems populate.
   - After frame N: capture the engine RT → `<png>`, then
     `PostQuitMessage(0)`.
   - WebView2/React navigation is skipped or ignored in capture mode —
     the engine RT is what we want and it's independent of the chrome.
3. **Capture helper**: add `AlphaCompositor::SaveRenderTargetToPng(const
   wchar_t* path)` (or a free function) reusing the existing
   `GetRenderTargetData` → sysmem-surface flow, then
   `D3DXSaveSurfaceToFileW(path, D3DXIFF_PNG, surface, nullptr, nullptr)`.

## 4. Risks named up front + mitigations

1. **Capture entangled with WebView2 boot.** The engine/compositor are
   initialised in the host boot sequence alongside WebView2. *Mitigation:*
   drive the engine directly after bind in capture mode; don't depend on
   React/Navigate. If WebView2 init is on the critical path, let it run
   but ignore it. Verify the capture path doesn't deadlock on a missing
   `dist/` (it shouldn't — engine render is independent).
2. **Reinventing file load.** *Mitigation:* call the existing
   `file/open` load core with the path directly; do NOT hand-roll
   chunk parsing.
3. **RT format / multisample rejecting `GetRenderTargetData`.**
   *Mitigation:* reuse AlphaCompositor's proven sysmem-surface setup
   (it already round-trips this exact RT); match its pool/format.
4. **Capturing before particles spawn** (blank/under-populated frame).
   *Mitigation:* default `--frames 60` so emitters reach steady state;
   make it overridable.
5. **Sim non-determinism** across runs. *Accepted* — irrelevant to a
   "dark box vs glow" judgement; deferred to Phase 3 golden work.
6. **Regression to normal launch.** *Mitigation:* capture is gated
   entirely behind the new flag; absent it, boot is byte-identical.
   Verify a normal `--new-ui` launch still works.

## 5. Testing & verification

- [ ] MSBuild Debug x64 clean (no new warnings beyond LIBCMTD).
- [ ] `--capture P_Frigate_Damage.ALO out.png` writes a non-empty PNG
      and exits 0.
- [ ] I `Read` `out.png`: emitters visible (fire/smoke/glow), frame
      populated. **Diagnostic:** are the additive sprites clean glows
      or dark quads over smoke?
- [ ] Repeat in composition vs legacy runtime mode (set/unset
      `ALO_HOSTING_MODE`) — engine RT should be identical (localises
      engine-vs-DComp; if both clean, bug is in DComp present).
- [ ] `--frames 1` vs `--frames 120` to confirm frame-count plumbing.
- [ ] Missing / bad `.alo` path → clean error + non-zero exit, no hang.
- [ ] Normal `--new-ui` launch (no `--capture`) unaffected.
- [ ] Capture flag absent from the native-test harness path → harness
      unaffected.

## Review

**Shipped — capture tool (Phase 1 + Phase 2), mod-aware.**
- `--capture <alo> <png> [--frames N]` (`main.cpp` arg parse → `host::Run`
  → `HostWindowImpl`): boots, **auto-selects the mod that owns the .alo**
  (matches the path against `ModManager::GetMods()` so EaWX texture
  overrides resolve), loads the system, fires one manual SpawnerDriver
  burst at the origin (no lifetime cap), paces ~16 ms/frame for N frames,
  then writes **two** PNGs and exits:
  - engine RT via new `AlphaCompositor::CaptureSnapshotToFile` (pre-
    composite D3D9 pixels);
  - the final DWM/DComp composite via `CaptureWindowToPng`
    (`PrintWindow(PW_RENDERFULLCONTENT)` — the flag required to capture
    DirectComposition/WebView2 content) → `<png>-composite.<ext>`.
- Default 180 frames (~3 s) so freshly-spawned effects fill before the
  snapshot. Capture-mode exit code is explicit 0/2 (load/write failures
  exit 2). Absent the flag, boot is byte-identical to a normal launch.

**Root-cause outcome (the actual win).** The "hard square edges / black
background on additive sprites" I chased was **not** a renderer bug — it
was the capture loading **base-game textures instead of the EaWX mod's**
(the mod wasn't selected). User flagged this; adding mod auto-selection
fixed it. With correct mod textures, **both** the engine RT and the
composite render the effect soft, matching 0.2 end-to-end. The D3D9Ex
and DComp-alpha theories were red herrings. Lesson: verify the *correct
assets* are loaded before investigating the render pipeline.

**Verification:**
- MSBuild Debug + Release x64 clean (preexisting LIBCMTD warning only).
- `--capture` on `P_Frigate_Damage.ALO`: writes engine-RT + composite
  PNGs, exit 0; host.log shows `[capture] selected mod ... EaWX`.
- Engine RT and composite both soft (no dark quads) with mod textures;
  hard-edged with base-game textures (the before/after that localised
  the cause).
- Normal `--new-ui` launch + native-test harness path unaffected (flag-
  gated).

**Open (user-owned):** confirm the real arch-C editor (mod selected via
Mods menu → file/open) loads mod textures correctly on this effect. The
mod-select + file-open bridge paths both call `ReloadTextures`, so it
should — pending the user's re-test. Possible QoL follow-up:
auto-select the mod on `file/open` from the file path (not done — matches
legacy behaviour where the user picks the mod).

**Debug scratch removed before commit:** the `#ifndef NDEBUG` `[texdiag]`
texture-format log in `main.cpp` and all scratch capture PNGs/txt.
