# [LT-4 engine] Skydome → particle alpha-blending bug

**Status:** ROOT-CAUSED + FIXED (pending cleanup + docs + push). The fix is a
4-line vertex-declaration save/restore in `Engine::RenderSkydome`.

## ROOT CAUSE (confirmed by instrumented `--capture` + fix-verify)

`Engine::RenderSkydome` ([engine.cpp:2002](../src/engine.cpp:2002)) bound
`m_pSkydomeDecl` (a `SkydomeVertex` declaration: position/normal/texcoord, **no
diffuse-colour element**) and never restored it. The vertex declaration is NOT
part of the `ID3DXEffect` state block, so `Begin/End` didn't restore it; the
engine's real declaration `m_pDeclaration` is set only at device-reset
([engine.cpp:1706](../src/engine.cpp:1706)), not per frame. So every draw after
the skydome inherited `m_pSkydomeDecl` → the fixed-function pipeline had no
colour stream → defaulted every vertex's diffuse to **white (0xFFFFFFFF)**.

- Additive Fire/Glow particles: white + ground → white blowout dome.
- Alpha Smoke particle: lost its colour too (the "alpha blending issue").
- Ground: unaffected — its vertices are already white, so the default white
  changed nothing. THIS is why it looked like a skydome-only blend bug.

Every measurement agreed: device render-state, particle count, and `dt` were all
identical slot 0 vs slot 5 — because the leaked state was the vertex
declaration, which none of those captured.

## FIX

Save `GetVertexDeclaration` before the skydome pass, `SetVertexDeclaration` +
`Release` after `End()` — mirroring the existing Z/cull save-restore. Verified:
slot 5 blob went `230,228,223` (white) → `94,73,51` (orange, = control); %white
6.2% → 0.0%; slot 0 vs slot 5 means now identical within 0.1.

## Remaining
- [ ] Remove diagnostic scaffolding (blend probe, `--bloom`/`--noparticles`/
      `CAPTURE_FIXEDDT`, particle-count log). KEEP `--skydome <slot>` (regression
      value).
- [ ] Build Release + Debug clean; vitest 367; a11y goldens zero drift (engine-only).
- [ ] Lesson L-032; CHANGELOG entry + remove from Open Issues.
- [ ] FF-push to origin/lt-4.

---
(Original plan below for reference.)

**Status (original):** PLAN — root cause NOT yet confirmed; Phase 1 is a real-mod
frame capture.

**Difficulty:** ★★★ (engine D3D9; root cause uncertain and partly in external
game-asset shaders; the *fix* is likely small once the capture localizes it).

---

## 1. Goal + scope

**Goal.** A background skydome (Background → any slot 1–11) no longer corrupts
particle alpha blending. Translucent particles (e.g. explosion smoke) blend the
same way over a skydome as they do over a solid-colour background. Solid-colour
background behaviour is unchanged.

**In:**
- Reproduce the bug deterministically against the real mod (L-029: mod MUST be
  selected or base-game textures load and the repro is invalid).
- Frame-capture the particle draw with vs without a skydome; identify the exact
  divergent state/content at root cause.
- The minimal root-cause fix the capture points to.
- Regression coverage appropriate to the fix (engine smoke via `--capture`,
  and/or a host/unit check where one is meaningful).
- CHANGELOG entry + remove from Open Issues; lessons.md rule if a correction
  lands.

**Out (with reasons):**
- Speculative "add a save/restore to `RenderSkydome`" change — **the filed
  hypothesis is refuted by static analysis (see §2/§3); this is explicitly NOT
  the planned fix** unless the capture contradicts the static finding.
- Any skydome *feature* work (new slots, HDR, mip control) — unrelated.
- Bloom/distort post-process redesign — only touched if the capture proves the
  corruption is there, and then only minimally.
- arch-A (legacy) path — bug filed against new-UI/arch-C; verify there only if
  trivially free.

## 2. What the codebase already gives us (verified this session)

- **Render order** ([engine.cpp:669–745](../src/engine.cpp:669)): Clear (XRGB →
  dest **alpha = 255**) → `RenderSkydome()` (gated only by `m_skydomeIndex`,
  [710](../src/engine.cpp:710)) → ground (if shown, sets `ALPHABLENDENABLE
  FALSE`, [733](../src/engine.cpp:733)) → `ZWRITEENABLE FALSE` → particle loop
  `instance->RenderNormal` → post-process.
- **`RenderSkydome`** ([engine.cpp:1978](../src/engine.cpp:1978)): saves/restores
  **only** `ZWRITEENABLE`/`ZENABLE`/`CULLMODE`. Touches no blend/alpha/tex-stage
  state. Drives geometry via `ID3DXEffect::Begin(&passes, 0)` (flag 0 ⇒ the
  effect framework saves/restores the device states the technique sets).
- **`Skydome.fx`** ([src/Resources/Engine/Skydome.fx](../src/Resources/Engine/Skydome.fx)):
  technique sets **only** `VertexShader`/`PixelShader` (+ a sampler). It sets
  **no** blend/render states. PS returns `tex2D(skydome, uv)` — i.e. it writes
  the skydome texture's **RGBA (including its alpha)** into the scene RT.
- **Particle draw** (`ParticleSystemInstance::RenderNormal`
  [ParticleSystemInstance.cpp:78](../src/ParticleSystemInstance.cpp:78) →
  `EmitterInstance::Render` [EmitterInstance.cpp:811](../src/EmitterInstance.cpp:811)):
  non-heat particles draw via a **per-blend-mode `ID3DXEffect`**
  (`GetShader(blendMode)`, `Begin(0)`) that sets+restores its own state; heat
  particles set `ALPHABLENDENABLE/SRCBLEND/DESTBLEND` manually.
- **The real per-blend-mode shaders are EXTERNAL game/mod assets** — only the
  fixed-function fallback `DefaultShader.fx` is in-repo. So the actual blend
  modes can't be enumerated from source ⇒ frame capture is mandatory.
- **Compositor swapchain = `DXGI_ALPHA_MODE_IGNORE`**
  ([Compositor.cpp:651](../src/host/Compositor.cpp:651)); team already moved off
  `PREMULTIPLIED` because it misinterpreted RT alpha (628–638). ⇒ the scene-RT
  alpha channel does **not** reach the screen through DComp.
- **Repro tooling:** `--capture <alo> <png> [--frames N]`
  ([main.cpp:8102](../src/main.cpp:8102)) headless render. Does not currently set
  a background skydome or select a mod → would need a small extension to drive
  the two-background diff headlessly.

## 3. Key finding that reframes the task

The render state **entering the particle pass is provably identical** with vs
without a skydome (RenderSkydome restores Z/cull and changes no blend state;
ground sets `ALPHABLENDENABLE FALSE` either way; RT/viewport setup is gated only
on the skydome *call*, not changed). **Therefore the bug is not a leaked render
state** — the only thing the skydome changes is the **scene-RT pixel content**
(RGB and alpha) the particles blend against.

Leading hypotheses to discriminate in the capture (ranked):
1. **A blend mode reads destination alpha.** Flat clear → dest alpha = 255
   everywhere; skydome → dest alpha = skydome-texture alpha (≠ 255, possibly 0).
   A blend mode using `DESTALPHA`/`INVDESTALPHA` (or dest-alpha-dependent
   tex-stage alpha) would then blend differently → "alpha wrong". Cleanest fix:
   make the skydome pass not write dest alpha (e.g. `COLORWRITEENABLE` excluding
   alpha, or force PS alpha = 1) so dest alpha stays 255 as the flat path leaves
   it. **This is the prime suspect.**
2. **Post-process (bloom/distort) samples the scene** now containing a bright/
   busy sky → thresholding/extraction differs. Fix scoped to that pass.
3. **A game blend-mode shader inherits a state it doesn't set**, and that state
   differs because the skydome ran. (Static analysis says blend state is
   identical, so this would have to be a non-blend state — lower probability.)
4. **Correct-but-surprising additive blending** over a bright sky (not a bug).
   Must be ruled out before changing engine code.

## 4. Risks named up front + mitigations

1. **Chasing the filed (wrong) hypothesis.** The Open-Issues note says "add a
   save/restore in the skydome pass." Static evidence (§3) says that's a no-op
   for blend state. *Mitigation:* Phase 1 is capture-first; do not touch
   `RenderSkydome` until a capture shows a state it actually leaves divergent.
2. **Invalid repro (wrong assets).** Per L-029, loading an `.alo` without
   selecting the mod renders base-game textures and a different result.
   *Mitigation:* repro only with the mod selected (interactive Mods menu, or the
   capture tool extended to call `ModManager::SelectMod`); verify loaded texture
   dims/format match the mod (1024² mod vs 512² base tell).
3. **RenderDoc/PIX may not be installed**, and `--capture` doesn't currently set
   a skydome. *Mitigation:* this is the open decision (check-in). Either use a
   GPU debugger on the live `--new-ui` build, or extend `--capture` with
   `--mod`/`--skydome` to dump the two frames headlessly + a state log at the
   particle draw.
4. **Fix that suppresses the symptom but not the cause** (e.g. forcing all
   particles opaque). *Mitigation:* the fix must be justified by the captured
   divergent state and leave solid-colour behaviour byte-identical; verify both
   backgrounds after.
5. **Golden/test fallout.** Engine-only change shouldn't touch a11y goldens
   (not a captured DOM surface). *Mitigation:* `git diff --stat` goldens as the
   gate (L-030); expect zero. Native runs SERIAL only (L-031).

## 5. Testing & verification (filled in once root cause is known)

- **Repro (pre-fix):** real mod + translucent-particle effect; confirm correct
  blend on solid background, wrong blend on a skydome slot. Capture both.
- **Root-cause evidence:** the specific divergent state/content at the particle
  draw call named explicitly (not "looks better").
- **Post-fix happy path:** same effect blends correctly over skydome slots 1–11.
- **Regression — solid background:** byte-identical to pre-fix (the path that
  already worked must not change).
- **Edge:** skydome toggled live mid-playback; multiple emitters w/ mixed blend
  modes (additive + alpha); heat/distort emitter present.
- **Build:** MSBuild Release + Debug clean (L-025/L-023).
- **Engine smoke:** `--capture` of the repro effect on a skydome renders the
  expected frame (extend the tool if that's the chosen repro path).
- **a11y goldens:** `git diff --stat` shows zero change (engine-only).
- **vitest:** still 367 (unaffected, but confirm).

---

## Pre-flight done this session
- Lineage: HEAD = origin/lt-4 = `ce366ae`, 0/0, clean tree.
- vitest **367/367**. x64 binaries + `dist/` absent (fresh worktree — build when
  Phase 1 starts).
