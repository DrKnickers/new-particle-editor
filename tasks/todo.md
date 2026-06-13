# MT-16 / LT-5 render fidelity — triage done, build deferred

Session 40. Branch `claude/mt16-transparency-parity` (off master post-#150).

**Status: triage complete, NO code written. Substantive fix deferred to a
future "recreate the game's rendering pipeline" session** — now tracked as
ROADMAP **[LT-8]** (§3.6). Decision: parity must run the game's real
shaders 1:1; do **not** fork the editor's bundled `SceneHeat.fx`. See
[[feedback_no_shader_fork_1to1_rendering]].

## Deliverables this session (docs only)

- [`docs/superpowers/specs/2026-06-13-mt16-transparency-parity-triage.md`](../docs/superpowers/specs/2026-06-13-mt16-transparency-parity-triage.md)
  — MT-16 root cause: (1) alpha-channel erosion → layered-compositor
  washout (editor-side, fixable with a render-state change, **no shader**);
  (2) missing scene colour-grade (`Scene_colorControls.fx`) → needs the
  game-pipeline recreation. Editor gamma/tonemap ruled out (none).
- [`docs/superpowers/specs/2026-06-13-lt5-particle-shader-findings.md`](../docs/superpowers/specs/2026-06-13-lt5-particle-shader-findings.md)
  — LT-5 thread 1 (transparent-depth lighting): not a bug, unlit by design.
  Thread 2 (bump lighting+colorize): historical "can't do both" = ps_1.x
  instruction budget; lead fix = a ps_2_0 particle-bump-colorize shader.
  Deferred by user until MT-16 lands; colorize source = material param.
- ROADMAP **[LT-8]** added (§3.6); LT-5 findings cross-referenced.

## Carry-over for the next session

- **[LT-8] recreate the game's pipeline** — run the game's real
  `SceneComposite/Scene_*.fx` (in `reference/foc-shaders/`), per-map grade
  params (depends on [MT-15]). Absorbs MT-16's tone half. Scope in its own
  planning session.
- **MT-16 transparency half (Part 1)** — independent editor render-state
  fix (mask alpha writes during the final combine, or stamp scene-rect
  alpha in `AlphaCompositor`); no shader edit. Can ship on its own.
- **LT-5 thread 2** — author the ps_2_0 bump-colorize shader after MT-16.

## Review

Triage only; no build. Course-corrected mid-session: an initial plan to
edit `SceneHeat.fx` (both the alpha force and a colour grade) was rejected
by the user on the no-fork principle and replaced with the render-state
approach (Part 1) + the [LT-8] pipeline-recreation effort (Part 2). Docs +
memory updated to match.
