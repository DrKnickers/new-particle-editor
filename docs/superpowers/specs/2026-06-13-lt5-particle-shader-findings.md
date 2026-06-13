# LT-5 — Particle shader lighting + colorization: findings

*2026-06-13. Session 40. Based on the FoC shader source the user provided
(`Engine/Prim*.fx`, `BumpColorize.fxh`, `AlamoEngine.fxh`). Status:
**investigation, no code yet.** I own the shader-lighting thread,
coordinating with the MT-14 (world-lighting) session.*

> Scope note (from ROADMAP [LT-5]): this is about the *game's* `.fx`
> shaders, which the editor's preview also exercises. The deliverable is a
> shader (authored / fixed and tested in the preview), not editor C++.

## Thread 1 — does the transparent-depth shader inherit world lighting?

**Answer: no, and it shouldn't — not a bug.**

- `PrimAlpha.fx` (transparent): `pixel = texel * In.Color` — texture ×
  per-particle vertex color. Unlit/emissive.
- `PrimDepthSpriteAlpha.fx` (transparent-depth): `Out.Color =
  texel*In.Diff` plus a **per-pixel depth offset** written from a second
  "depth" texture (`Out.Depth = new_z/new_w`) so soft sprites intersect
  geometry without a hard clip edge. **No lighting term** — identical
  shading to plain alpha, just depth manipulation.
- The **only** lit particle shader is `PrimParticleBumpAlpha.fx`.

The editor already feeds the full light state to shaders that want it —
directional `m_light0Diffuse` / object-space light vector and both SH
matrices (`hSphLightFill`, `hSphLightAll`) at
[engine.cpp:767-772](../../../src/engine.cpp:767), recomputed via
`SPH_Calculate_Matrices` on every `SetLight`/`SetAmbient`
([engine.cpp:1438](../../../src/engine.cpp:1438)). So bump particles are
lit in the preview exactly as in-game. **No editor plumbing gap.** This
de-overlaps LT-5 from MT-14: the transparent shaders are unlit in both, so
MT-14's world-lighting fixes won't change them.

## Thread 2 — bump lighting *and* colorization together

**Why "one or the other, not both" historically: a ps_1.x instruction
budget, not a missing term.**

Two separate shaders exist, each doing half:

- `PrimParticleBumpAlpha.fx` (the **particle** bump shader) — does
  **lighting**: builds tangent space from the billboard (normal = view-Z,
  tangent encoded in the vertex diffuse), per-pixel dot3 diffuse against
  `m_light0Diffuse`, plus per-vertex SH fill (`Sph_Compute_Diffuse_Light_
  Fill`). Surface color is the raw base texel — **no colorization.**
- `BumpColorize.fxh` (the **mesh/skin** bump shaders, e.g.
  `MeshBumpColorize` / `RSkinBumpColorize`) — does **both** lighting and
  **colorization** (`surface_color = lerp(base.rgb, Colorization*base.rgb,
  base.a)` — colorization masked by base-texture alpha). But its vertex
  path uses real mesh `TANGENT`/`BINORMAL`, not the particle billboard
  trick, so it isn't usable for particles as-is.

The particle bump shader only compiles its pixel programs to **ps_1_1 /
ps_1_4** (`bump_ps_main` = ps_1_1, `bump_spec_ps_main` = ps_1_4). ps_1_1
has ~8 instruction slots. The billboard tangent-space bump lighting already
fills most of that; adding the colorization `lerp` (extra ALU) overflows
the budget — hence the historical "can't do both" in that shader.

**Lead fix:** author a **ps_2_0** particle-bump-colorize shader that merges
the two — keep `PrimParticleBumpAlpha`'s billboard tangent-space lighting,
add `BumpColorize`'s colorization `lerp`. ps_2_0 (already used by
`PrimDepthSpriteAlpha` and the scene composites, so the editor/hardware
supports it) has ~64+ instruction slots — ample for both. **To verify
before committing:** count the merged instruction footprint, and confirm
where `Colorization` would come from for particles (a material param vs.
the per-particle color track) — the mesh path takes it as an effect
parameter; particles would need a source decided.

## Relationship to MT-16

The bump-lighting/colorization work is independent of the MT-16
transparency-parity gap (which is alpha-erosion + the missing scene
color-grade — see the MT-16 triage doc). They share only the broader
"preview should match in-game" goal, not a mechanism.
