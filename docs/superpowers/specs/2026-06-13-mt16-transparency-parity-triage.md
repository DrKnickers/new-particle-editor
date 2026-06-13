# MT-16 — Editor ↔ in-game transparency parity: triage / root-cause writeup

*2026-06-13. Session 40. Status: **triage complete; substantive fix
deferred to a future "recreate the game's rendering pipeline" session.***
All claims verified against first-party source — file:line anchors inline.

> **Decision (2026-06-13).** Parity must come from running the game's
> **real** shaders 1:1 — not from forking/patching the editor's bundled
> `SceneHeat.fx`. See [[feedback_no_shader_fork_1to1_rendering]]. The
> colour-grade half therefore folds into recreating the game's
> scene-composite pipeline (a large future-session effort, depends on
> MT-15 for per-map params). The transparency half (Part 1 below) is an
> editor **compositing** artifact fixable with a render-state change and
> **no shader edit** — it can be done independently or as part of the
> pipeline work. **An earlier draft of this doc recommended editing
> `SceneHeat.fx`; that is rejected — do not fork the shader.***

## Symptom (as reported)

Particle transparency renders **differently in-game than in the editor** —
particles look **darker / more opaque in-game**. Equivalently: the **editor
shows them too light / too transparent / washed out**. Goal: make the
preview a faithful predictor of in-game appearance.

> The Explore-agent recon initially concluded the *editor* darkens
> particles (dark-purple clear). That has the **direction backwards** vs.
> the report and is rejected — see the verified mechanism below, which
> produces the *reported* direction (editor too light).

## Verified root cause — alpha-channel erosion bleeds through the layered compositor

The editor's new-UI viewport is a **WS_EX_LAYERED popup** composited over a
**transparent** WebView2 page via `UpdateLayeredWindow(AC_SRC_ALPHA)` —
i.e. the viewport's **per-pixel alpha is meaningful** (it's the viewport's
opacity over the page). But the particle render path was written for a game
backbuffer, where **alpha is ignored**. So particle blending corrupts the
viewport alpha, and the compositor faithfully shows that corruption as
see-through (washed-out) particles. The chain, link by link:

1. **Scene RT cleared opaque.** `Clear(... D3DCOLOR_XRGB(bg), ...)` →
   alpha = 0xFF everywhere ([engine.cpp:815](../../../src/engine.cpp:815)).
2. **Particle blending erodes alpha with the same factors as color.**
   No `SEPARATEALPHABLENDENABLE` / `SRCBLENDALPHA` / `DESTBLENDALPHA` /
   `COLORWRITEENABLE` anywhere in `src/` (grep = 0). Blend modes set only
   `SRCBLEND`/`DESTBLEND` ([EmitterInstance.cpp:696](../../../src/EmitterInstance.cpp:696)).
   So a transparent sprite (`SRCALPHA`/`INVSRCALPHA`) computes
   `dst_a = src_a² + (1−src_a)·dst_a` → from 1.0 down to ~0.75 at src_a=0.5;
   modulate (`ZERO`/`SRCCOLOR`) erodes further. Additive (`ONE`/`ONE`)
   keeps alpha high — so the symptom is **blend-mode dependent**.
3. **Final combine copies the eroded alpha through.**
   [SceneHeat.fx:35](../../../src/Resources/SceneHeat.fx:35) `ps_main` does
   `return tex2D(SceneSampler, …)` — full RGBA — with `AlphaBlendEnable =
   False` (overwrite). The final RT was cleared to opaque black, but this
   pass **replaces** that alpha with the scene texture's eroded alpha
   ([engine.cpp:1081-1104](../../../src/engine.cpp:1081)).
4. **Compositor pushes it to the layered window unchanged.**
   [AlphaCompositor::Composite](../../../src/host/AlphaCompositor.cpp:982)
   `GetRenderTargetData` → **direct memcpy** of the RT (eroded alpha
   included) into the DIB → `UpdateLayeredWindow(AC_SRC_OVER, AC_SRC_ALPHA,
   SourceConstantAlpha=0xFF)`. It only zeroes alpha *outside* the scene
   rect (occlusion bands); **nothing forces the scene-region alpha opaque**.
5. **Result:** where particle alpha is eroded, the viewport popup is
   semi-transparent and composites the particle against **whatever is
   behind the popup** instead of presenting the engine's rendered RGB at
   full opacity. In-game the backbuffer alpha is ignored, so the same
   particle blends only against opaque scene color → the "correct"
   darker/opaque look.

**Key framing for the fix:** the editor currently does **not present the
engine's rendered RGB faithfully** — the eroded alpha mixes in the
backdrop. A game backbuffer presents RGB at full opacity (alpha ignored).
So forcing the composited scene to **alpha = 1** makes the editor present
exactly the RGB the game would — achieving parity **independent of the
sign of the current error**.

## Ruled out

- **Gamma / sRGB / tonemap / exposure (editor side):** none exist. No
  `SetGammaRamp`, no `D3DRS_SRGBWRITEENABLE`, no `D3DSAMP_SRGBTEXTURE`, no
  tonemap/exposure pass in `src/` (the only `gamma` hits are in
  third-party `json.hpp`). Color is linear 8-bit passthrough.
- **Premultiplied-alpha mismatch:** blends are straight (unpremultiplied);
  the compositor's occlusion path explicitly maintains the premultiplied
  invariant only for its own feathered cutouts, not the scene.

## Second cause — the game's scene color-grade composite (the editor has none)

*Found 2026-06-13 from the FoC shader source the user provided.*

The game runs a **full-screen scene-composite** chosen per map. One common
variant, `SceneComposite/Scene_colorControls.fx`, color-grades the **entire
scene over `PHASE_ALL`** (opaque + terrain + transparent + particles):

```
diffuse  = tex2D(scene)
color    = lerp(luminance, diffuse, Saturation)   // saturation
sat      = pow(color, Gamma)                       // gamma — pow ≈ 3.1 default
cont     = lerp(AvgLum, sat, Contrast)             // contrast
output   = cont * TintColor * Brightness           // tint + level
```

A **gamma `pow()` with exponent > 1 darkens midtones**, then Brightness
re-scales and TintColor shifts hue. The editor's final combine
([SceneHeat.fx](../../../src/Resources/SceneHeat.fx)) does **none** of
this — it only applies heat distortion and copies color through linearly.
So in-game the whole frame (particles included) is pushed darker / more
saturated / tinted; the editor shows the raw linear scene → lighter. This
is **not transparency-specific** — it's a global tone difference per map —
and is likely the *dominant* contributor to "darker in-game" for overall
look, on top of the transparency-specific alpha erosion above.

Caveat: the literal `Brightness=8.5 / Gamma=3.1 / …` are shader defaults;
in-game these are **driven per map** by the map's color-control settings.
So exact parity is map-dependent — the editor can't match a single fixed
grade. Replicating this means either reading the map's color-control params
(overlaps MT-15's map-reading) or exposing brightness/contrast/saturation/
gamma/tint as editor controls so the author can dial to a target.

## Shader-level lighting — checked, NOT a cause (LT-5 thread 1)

The transparent and transparent-depth particle shaders **do not inherit
world lighting, by design** — both are pure `texel × vertexColor`
(emissive). `PrimDepthSpriteAlpha.fx` only adds a per-pixel depth offset;
`PrimAlpha.fx` is texture×color. The editor matches (unlit in both). The
**only** lit particle shader is `PrimParticleBumpAlpha.fx` (SH fill +
dot3 bump), and the editor already feeds it the full light state
([engine.cpp:767-772](../../../src/engine.cpp:767)). So "transparent-depth
doesn't inherit lighting" is **not** an editor↔game gap — see the LT-5
findings doc for detail. This largely de-overlaps MT-16 from the MT-14
world-lighting work.

## Still needs empirical confirmation

A repro `.alo` + editor-vs-in-game screenshots, to confirm (a) the washout
tracks transparent/modulate blend modes and is minimal on additive, and
(b) how much of the gap is alpha-erosion vs. the missing color-grade.

## Direction (revised per the no-fork decision) — two parts

**Part 1 — transparency washout: editor render-state, NO shader edit.**
The eroded alpha is an editor *compositing* artifact (the game ignores
backbuffer alpha; the editor's layered/DComp surface doesn't). Force the
final RT's alpha opaque **without touching `SceneHeat.fx`**: mask alpha
writes during the final combine draw — `SetRenderState(D3DRS_COLORWRITE­
ENABLE, RED|GREEN|BLUE)` around the `pEffect->Begin/DrawPrimitiveUP`
([engine.cpp:1090-1104](../../../src/engine.cpp:1090)) — so the RT keeps
the opaque alpha it was cleared to ([engine.cpp:1081](../../../src/engine.cpp:1081)).
Covers both compositor paths (alpha forced GPU-side in the RT). Fallback:
stamp scene-rect alpha=0xFF in `AlphaCompositor::Composite` (arch-B only).
*Verify the D3DX effect's state save/restore doesn't clobber the mask —
set it inside `BeginPass`/before the draw if needed.* This can ship on its
own as the MT-16 transparency fix.

**Part 2 — tone/colour-grade: recreate the game's scene composite.** Do
**not** add grade math to `SceneHeat.fx`. The 1:1 path is to run the
game's real `SceneComposite/Scene_*.fx` (in `reference/foc-shaders/`),
with per-map grade params (needs MT-15 map-env plumbing). This is a large
future-session effort — "recreate the game's rendering pipeline" — not a
shader patch. Tracked separately.

Part-1 properties (why the render-state approach is safe):

- **Both compositor paths:** masking alpha writes leaves the RT's cleared
  opaque alpha intact GPU-side, so both the arch-B layered `Composite()`
  and the arch-C DComp shared-texture path see opaque scene alpha.
- **Safe with occlusion:** the compositor's outside-band zeroing and the
  per-id HUD cutouts are stamped on the DIB **after** the engine RT, so a
  fully-opaque scene alpha doesn't break them — they override where needed.
- **Legacy Present path:** alpha is ignored on a normal swapchain present,
  so the change is a no-op there.
- **Fallback:** if the effect's state save/restore interferes with the
  colour-write mask, stamp scene-rect alpha=0xFF in
  `AlphaCompositor::Composite` instead (host-side, arch-B only) — still no
  shader edit. A third option (`SEPARATEALPHABLENDENABLE` per particle
  draw) is rejected as too invasive (hot path, every blend-mode setup).

## Note — earlier "edit SceneHeat.fx" recommendation is withdrawn

A prior draft proposed forcing alpha (and adding the grade) inside
`SceneHeat.fx`, and noted that shader is built-in / not mod-overridable so
the edit was "safe." That is **withdrawn** under the no-fork decision: we
do not patch the editor's bundled shaders to chase parity. Part 1 moves to
the render-state approach above; Part 2 (tone) is the game-pipeline
recreation effort.
