# MT-16 (Part 1) — Editor↔in-game transparency parity: alpha-erosion washout fix

_2026-06-13. Session 41. The transparency half of [MT-16], scoped by the
session-40 triage (`docs/superpowers/specs/2026-06-13-mt16-transparency-parity-triage.md`).
Status: **PLAN — awaiting user confirmation before coding.** ★☆☆☆☆ (small,
well-understood; the triage did the hard part)._

---

## 1. Goal + scope

**Goal.** Particles in the editor preview currently render **too light /
washed-out / see-through** vs. in-game. The verified cause is that the
editor composites the viewport as a per-pixel-alpha layered/DComp surface,
but the particle render path erodes the scene RT's alpha (it was written for
a game backbuffer where alpha is ignored). The compositor then shows that
eroded alpha as transparency. Fix: force the final composited scene alpha
**opaque** so the editor presents the engine's RGB at full opacity — exactly
what a game backbuffer does (alpha ignored) — achieving parity regardless of
blend mode.

**In:**
- A `D3DRS_COLORWRITEENABLE` alpha-write mask around the final scene-combine
  draw in `Engine::Render` (the `SceneHeat.fx` `t0/p0` blit), so the final
  RT keeps the opaque alpha it was cleared to.
- CHANGELOG entry; ROADMAP update (MT-16 → Shipped, **noting Part 2 / tone
  grade remains open as LT-8**).

**Out (deferred, with reasons):**
- **The colour-grade / tone half of MT-16** — recreating the game's
  `Scene_*.fx` composite. Tracked as **[LT-8]**; depends on MT-15 map-env
  plumbing; explicitly a separate large session per the no-fork rule.
- **Any shader edit.** `SceneHeat.fx` is NOT touched (no-fork hard rule,
  `feedback_no_shader_fork_1to1_rendering`). The fix is pure render-state.
- **`SEPARATEALPHABLENDENABLE` per particle draw** — rejected by the triage
  as too invasive (touches every blend-mode setup on the hot path).
- **The host-side `AlphaCompositor::Composite` alpha-stamp fallback** — only
  needed if the GPU-side mask proves insufficient (arch-B only); held in
  reserve, not implemented up front.

## 2. What the codebase already gives us

- **Final-combine draw** — `Engine::Render`, [engine.cpp:1094-1118](../src/engine.cpp:1094):
  the screen/scene RT is cleared `D3DCOLOR_XRGB(0,0,0)` (→ **alpha 0xFF**,
  opaque), then a full-screen quad blits `m_pSceneTexture` through
  `SceneHeat.fx` (`m_pDistortShader`) via `pEffect->Begin → BeginPass →
  DrawPrimitiveUP → EndPass → End`. This blit currently **replaces** the
  cleared opaque alpha with the scene texture's eroded alpha.
- **`SceneHeat.fx` `t0/p0`** ([SceneHeat.fx:38-52](../src/Resources/SceneHeat.fx:38)):
  sets `AlphaBlendEnable/AlphaTestEnable/ZWriteEnable/ZFunc` + shaders —
  **does NOT set `ColorWriteEnable`.** Verified. So a `D3DRS_COLORWRITEENABLE`
  set by us is not part of the effect's pass-state apply and won't be
  clobbered by `BeginPass`.
- **Both presentation paths read the same RT** — arch-C (composition, x64
  default): DComp shared-texture samples the RT GPU-side
  ([engine.cpp:1127-1141](../src/engine.cpp:1127)); arch-B: `Composite()` →
  `UpdateLayeredWindow(AC_SRC_ALPHA)`. Masking alpha GPU-side on the RT covers
  both. Legacy `Present` ignores alpha → no-op.
- **Triage doc** — the full root-cause chain, ruled-out causes (no
  gamma/sRGB/premult), and the Part-1 safety analysis already exist at
  `docs/superpowers/specs/2026-06-13-mt16-transparency-parity-triage.md`.
- **Regression guard** — `tests/alpha-compositor-snapshot.spec.ts` exercises
  the real host's RT readback + composite path (3 specs).

## 3. Implementation approach

Inside the final-combine pass loop ([engine.cpp:1111-1116](../src/engine.cpp:1111)),
set the colour-write mask to RGB (drop ALPHA) **after `BeginPass`** (so the
pass-state apply can't override it — belt-and-suspenders; the pass doesn't
touch it anyway), do the existing draw, then **restore full RGBA** after the
draw so no later draw in subsequent frames is affected:

```cpp
pEffect->BeginPass(i);
// [MT-16] Mask alpha writes on the final scene blit so the eroded
// scene-texture alpha doesn't overwrite the opaque alpha the RT was
// cleared to (engine.cpp clear above). The layered/DComp compositor
// treats RT alpha as viewport opacity; the game ignores backbuffer
// alpha, so forcing alpha=1 presents the engine's RGB at full opacity
// = editor↔in-game parity. No shader edit (no-fork rule). Set AFTER
// BeginPass so the effect's pass-state apply can't clobber the mask.
m_pDevice->SetRenderState(D3DRS_COLORWRITEENABLE,
    D3DCOLORWRITEENABLE_RED | D3DCOLORWRITEENABLE_GREEN | D3DCOLORWRITEENABLE_BLUE);
m_pDevice->DrawPrimitiveUP(D3DPT_TRIANGLESTRIP, 2, quad, sizeof(EmitterInstance::Vertex));
m_pDevice->SetRenderState(D3DRS_COLORWRITEENABLE,
    D3DCOLORWRITEENABLE_RED | D3DCOLORWRITEENABLE_GREEN | D3DCOLORWRITEENABLE_BLUE | D3DCOLORWRITEENABLE_ALPHA);
pEffect->EndPass();
```

**Why here and not in the particle draws:** masking at the *final combine*
is one site, blend-mode-agnostic, and leaves the per-particle hot path
untouched. The scene RT's own (eroded) alpha becomes irrelevant — only the
final RT's alpha reaches the compositor, and we pin it opaque.

**Net change:** ~4 lines + comment in one file. No new APIs, no signature
changes, no shader, no host changes.

## 4. Risks named up front + mitigations

1. **D3DX effect state save/restore clobbers the mask.** `pEffect->Begin(&n,0)`
   may save/restore device state. *Mitigation:* set the mask **after
   `BeginPass`** (the pass-state apply is already done) and the pass never
   references `ColorWriteEnable`, so it can't be in the effect's managed set.
   Verified against `SceneHeat.fx`. Explicit restore after the draw makes us
   independent of whether the effect restores it on `End`.
2. **State leaks into the next frame's draws.** If the RGB-only mask
   persisted, particle alpha-blending into the scene RT next frame could
   behave differently. *Mitigation:* explicit restore to full RGBA
   immediately after the draw (within the pass loop). Confirm with a build +
   a multi-frame cold-launch (no accumulating artifact).
3. **Arch-C (DComp) doesn't actually honor RT alpha, so the fix is a no-op
   there.** *Mitigation:* code confirms DComp samples the same RT GPU-side
   ([engine.cpp:1127-1141](../src/engine.cpp:1127)); forcing RT alpha opaque
   is exactly what it reads. **Flag for the user feel-test:** confirm the
   washout is gone in the *default* (composition) mode, not just `--legacy`.
4. **Occlusion bands / HUD cutouts rely on partial scene alpha.** *Mitigation:*
   the triage verified the compositor stamps outside-band zeroing and per-id
   HUD cutouts onto the DIB **after** the engine RT, so a fully-opaque scene
   alpha doesn't break them — they override where needed. Accept; watch for
   HUD-pill rendering regressions at feel-test.
5. **Can't visually self-verify (no game on dev box).** *Mitigation:* the
   washout reproduces with the editor's **own stock transparent/modulate
   particle** (it's a compositor artifact, independent of game assets), so the
   user can feel-test with a default effect. I cover everything automatable
   (build, smoke, regression suites) and hand off the one visual check with a
   precise repro recipe. (Consistent with L-033: feel-tests are user-launched.)

## 5. Testing & verification

**Build (automatable, mine):**
- [ ] Host **Debug x64** clean (VS18 MSBuild, L-046).
- [ ] Host **Release x64** clean (benign LNK4098 OK).
- [ ] Web unaffected: `pnpm --filter @particle-editor/editor test` → **795**,
      `tsc -b` → 0 (no web change expected; confirm no drift).

**Smoke (automatable, mine):**
- [ ] Cold-launch the Debug exe with **stderr redirected**; grep for D3D/
      effect errors (L-084). Confirm clean startup + render loop (no crash,
      no device-lost spam over several seconds).
- [ ] Native harness `alpha-compositor-snapshot.spec.ts` still **3/3** (proves
      the RT readback + composite path still produces a valid frame after the
      render-state change). Run in the harness; if a tail flake appears, re-run
      that spec in isolation (L-066).

**Correctness reasoning (mine, documented in handoff):**
- [ ] Walk the render path: scene RT cleared opaque → particles erode *scene*
      RT alpha (irrelevant now) → final combine writes RGB only → RT alpha
      stays 0xFF → compositor sees opaque scene → presents RGB faithfully.
- [ ] Confirm restore-to-RGBA leaves frame N+1 identical to pre-change except
      for the final RT alpha.

**Visual feel-test (user-launched — handoff recipe):**
- [ ] Load/keep a default effect; ensure at least one emitter uses a
      **transparent** or **modulate** blend (the eroded-alpha modes).
- [ ] In the **default (composition)** preview, confirm particles read at the
      same opacity/darkness as in-game (no see-through wash over the chrome).
- [ ] Additive-blend emitter looks unchanged (additive kept alpha high, so it
      was already ~correct — sanity check, not a regression).
- [ ] HUD pills, occlusion at panel edges, and the modal frosted-glass
      backdrop snapshot all still render correctly (Risk 4).

## Review

**Implemented** ([engine.cpp:1111-1131](../src/engine.cpp:1111)): `D3DRS_COLORWRITEENABLE`
masked to RGB after `BeginPass`, draw, then restored to full RGBA — exactly
the plan. ~4 lines + comment, one file. No shader, no host, no API change.

**Decision (user, 2026-06-13):** ship as **MT-16 complete** → move MT-16 to
ROADMAP Shipped; the tone/colour-grade half lives entirely under LT-8.

**Automated verification — all green:**
- Host **Debug x64** clean; **Release x64** clean (benign C4244 + LNK4098 only).
- Web **795/795**, `tsc -b` 0 (no drift — no web change).
- **Cold-launch smoke** (L-084): Debug exe ran 7 s in **composition mode
  (arch-C, the fix's target path)**; AlphaCompositor shared RT created;
  snapshot readback 1.47 ms; **zero D3D / effect / device-lost errors** in
  stderr. The new render-state didn't destabilize the loop.
- **Native composite/readback regression** 12/12, incl. all 3
  `alpha-compositor-snapshot` specs (real-host `GetRenderTargetData` + composite
  + on-demand encode). Trailing SIGTERM = normal runner teardown (L-066).

**Cannot self-verify (handed to user — Risk 5):** the visual confirmation
that particles no longer read washed-out. The snapshot path encodes JPEG (no
alpha channel), so it can't assert the composited alpha value; the proof is a
user feel-test with a stock transparent/modulate particle. Recipe in §5.

**Pending:** user feel-test → then ROADMAP (MT-16 → Shipped) + CHANGELOG +
PR. Held until the visual check confirms the direction (if arch-C doesn't
honor the RT alpha as the code analysis predicts — Risk 3 — the approach
would need revisiting, so I'm not claiming "shipped" before the eye check).
