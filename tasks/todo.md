# Plan: MT-6 — Bloom in the preview renderer

ROADMAP entry: medium-term, ★★★★☆ (4/5), 8–12 hours estimated.

## 1. Goal + scope

Bring the game's own bloom post-process into the editor's preview so
particles authored to glow in-game also glow in the editor. Today an
emitter authored to bloom (fire, explosion hotspots, energy weapons)
renders flat in the preview, which means lighting / brightness
decisions get made against the wrong reference image.

**Decisive design choice: use the game's `SceneBloom.fx` directly**
via the existing `ShaderManager` / `FileManager` pipeline, rather than
bundling our own copy. Three downstream wins:

1. **Byte-identical to in-game.** The editor preview IS the game's
   bloom, not an approximation. No drift, no maintenance.
2. **Mod-aware automatically.** When the user selects a mod that
   overrides `Engine\\SceneBloom.fx`, the editor picks up the mod's
   custom bloom on the next `ReloadShaders` — same machinery that
   already hot-swaps particle shaders.
3. **Less to author.** No `.fx` file in this repo, no new
   `IDS_SCENEBLOOM` resource, no shader maintenance.

Three tunables and a master enable, exposed via a modeless
**View → Bloom…** dialog. All four settings persist across sessions
in the registry alongside the existing view settings.

**In scope:**

- Load `Engine\\SceneBloom.fx` at engine init via
  `m_shaderManager.getShader(m_pDevice, L"Engine\\SceneBloom.fx")`,
  mirroring the loop at
  [`engine.cpp:131–157`](src/engine.cpp:131) that loads
  `ShaderNames[]`. The bloom shader joins that list (or is loaded
  alongside it) so it participates in mod-switch hot-reload for
  free.
- Two render targets on `Engine` for ping-pong blur
  (`m_pBloomPing`, `m_pBloomPong`), created in `ResetParameters` and
  released on `Reset`, mirroring how `m_pSceneTexture` /
  `m_pDistortTexture` are managed today. **Resolution is dictated by
  the loaded shader's expectations** (probably half-res; verify by
  inspecting the shader at load time).
- New engine surface: `SetBloom(bool)`, `SetBloomStrength(float)`,
  `SetBloomCutoff(float)`, `SetBloomSize(float)` and matching getters,
  next to `SetGround` / `SetGroundZ` in [src/engine.h](src/engine.h).
- Bloom passes inserted into `Engine::Render` between scene render and
  the existing heat/distortion pass. The pass structure (bright
  filter → ping-pong blur → AddSmooth combine) is **driven by the
  techniques the loaded `SceneBloom.fx` exposes** — we iterate the
  effect's techniques and run them in the order the shader defines.
  Bright filter samples `m_pSceneTexture` → `m_pBloomPing`; blur
  ping-pongs; combine writes back into `m_pSceneTexture`. Distortion
  + final compose proceed unchanged.
- View menu item with `Ctrl+B` accelerator; modeless dialog following
  the **Spawner** precedent at
  [`src/main.cpp:2941`](src/main.cpp:2941) (lazy create, hide-on-close,
  position + visibility persisted).
- Three spinners for Strength / Cutoff / Size, master enable
  checkbox. Live preview — `SN_CHANGE` immediately pushes value to
  engine + persists. Parameter names (`BloomStrength`, `BloomCutoff`,
  `BloomSize`) are documented in the ROADMAP entry; the editor binds
  to them via `ID3DXEffect::SetFloat` at draw time. **Verified at
  effect-load time** by introspecting the loaded shader's parameter
  table; if the actual shader uses different names, we adapt rather
  than guess.
- Registry persistence: `BloomEnabled` (DWORD), `BloomStrength` /
  `BloomCutoff` / `BloomSize` (REG_BINARY floats). Four new
  `Read*` / `Write*` pairs following the
  [`ReadGroundZ`](src/main.cpp:2629) pattern. `ResetViewSettings`
  drops all four keys.
- Preserve the **alpha-channel-as-luminance-boost** trick from the
  original shader: per-particle alpha contributes to the bright
  filter's luminance dot product, so specific particles can opt
  into bloom by writing non-zero alpha to the frame buffer.
- Bloom **off by default** on first run (no registry value present)
  so existing users don't get an unexpected look change.

**Out of scope:**

- *Tone mapping / multi-scale / animated bloom.* Whatever the game's
  shader does is what we do. We don't add features the shader
  doesn't have.
- *Per-emitter bloom toggle in the editor UI.* The alpha-channel
  opt-in already gives per-particle granularity; an editor-side
  toggle would diverge from in-game behavior.
- *Bundling a fallback `SceneBloom.fx` in the editor.* If the user
  has no game path or the shader is missing from their install, the
  bloom UI disables itself and shows an explanatory tooltip. We
  don't ship a knockoff.
- *Reset-on-window-resize transient glitch.* If the bloom RTs need
  one frame to recreate, we accept a single black bloom frame rather
  than designing around it.

## 2. What the codebase already gives us

The roadmap entry's biggest claimed risk — *"the current preview
renders directly to the swap chain; we'd need RTT infrastructure"* —
turns out to be **wrong**. Reconnaissance confirms RTT is already
operational:

- **Scene already renders to an off-screen RT.**
  [`Engine::Render`](src/engine.cpp:192) saves the original backbuffer
  at engine.cpp:250, switches to `m_pSceneTexture` at engine.cpp:258,
  renders the scene, then composes back to the swap chain via a
  fullscreen quad with the `SceneHeat` shader
  ([engine.cpp:320–342](src/engine.cpp:320)). Bloom slots in *between*
  scene render and the heat compose without inventing any new
  pipeline machinery.
- **Existing RTs on `Engine`** are declared at
  [`engine.h:196–200`](src/engine.h:196): `m_pSceneTexture`,
  `m_pDistortTexture`, `m_pDepthStencilSurface`. All
  `D3DFMT_A8R8G8B8`, created in `ResetParameters` at
  engine.cpp:468/473/479, released in `Reset` at engine.cpp:429–431.
  New bloom RTs follow the same lifecycle.
- **`ShaderManager`** at [`src/main.cpp:214–310`](src/main.cpp:214)
  already resolves shader filenames through the same FileManager
  pipeline that loads the game's particle shaders. `getShader(device,
  L"Engine\\SceneBloom.fx")` returns an `Effect*` (cached, hot-
  reloadable) that's byte-identical to what the game would compile.
  Falls back to `IDR_DEFAULT_SHADER` if the file is missing on disk —
  we'll detect this case and disable the bloom UI rather than running
  the default shader as a bloom pass.
- **FileManager resolution order**
  ([`src/managers.cpp:13–61`](src/managers.cpp:13)) when a mod is
  selected: `modPath\Engine\SceneBloom.fx` first, then
  `<gameRoot>\Engine\SceneBloom.fx`, then MEG archives. So a modder
  who customises bloom in their mod sees their custom bloom in the
  editor preview.
- **`Engine::ReloadShaders()`** at
  [`engine.cpp:131–157`](src/engine.cpp:131) is the hot-reload loop
  that re-fetches every shader on F5 / mod switch. The bloom shader
  needs to participate so mod-switch hot-swaps it too.
- **`Effect` wrapper** at [`engine.cpp:91–119`](src/engine.cpp:91)
  handles `ID3DXEffect*` lifecycle, parameter handle caching, and
  the DX9 → DX8 → fixed-function LOD fallback in
  [`Effect.cpp:35–55`](src/Effect.cpp:35).
- **`SceneHeat.fx`** at
  [`src/Resources/SceneHeat.fx`](src/Resources/SceneHeat.fx) is a
  reference for the **post-process pass shape** (vs_1_1 + ps_2_0,
  two-texture sampler bind, fullscreen quad with `DrawPrimitiveUP`).
  The bloom shader follows the same skeleton on the editor side
  even though the .fx body itself is the game's.
- **Spawner dialog** at
  [`src/main.cpp:2941–2989`](src/main.cpp:2941) is the canonical
  modeless toggle pattern: `ToggleSpawnerDialog` lazy-creates,
  WM_CLOSE hides + writes window-rect to registry, menu check-mark
  syncs to visibility.
- **Spinner + SN_CHANGE wiring** lifted directly from the Ground Z
  spinner in PR [#45](https://github.com/DrKnickers/new-particle-editor/pull/45) —
  same `SPINNER_INFO` config, same `else if (code == SN_CHANGE)`
  routing into engine setter + registry write.
- **Registry helpers** for view settings are at
  [`src/main.cpp:2597–2663`](src/main.cpp:2597). The
  `ReadGroundZ` / `WriteGroundZ` pair is the float-via-REG_BINARY
  pattern bloom needs ×3.

## 3. Architecture / implementation approach

Choosing the FileManager-based load collapses most of the design
space — the shader itself is the game's, so its compile target,
tap count, technique structure, and parameter names are all
decided by it. **One open question remains** for the editor side:

### Question A — fold bloom back into the scene RT, or carry it as a third texture into compose?

1. **Fold back into `m_pSceneTexture`.** AddSmooth combine writes the
   bloomed image into `m_pSceneTexture`. Heat pass and final compose
   proceed unchanged. No changes to `SceneHeat.fx`.
2. **Carry bloom as a third compose input.** Final bloom RT lives
   independently; the compose shader gains a third texture sampler
   and adds bloom into the final blit alongside scene + distort.

**Recommendation: Option 1.** It matches how the game's bloom shader
is structured (AddSmooth is part of the bloom pass, not the compose),
keeps `SceneHeat.fx` untouched, and avoids forking the compose
shader. Cost is one extra full-resolution write per frame —
negligible.

### What we **do not** control (intentionally)

- *Pixel shader target.* Whatever the game's `SceneBloom.fx` says.
- *Tap count, blur kernel shape, threshold curve.* Same.
- *RT scale.* Same — we'll inspect the shader's expectations at
  load time and size the ping-pong RTs to match.
- *Technique names and parameter names.* We probe the loaded
  effect via `ID3DXEffect::GetParameterByName` / `GetTechnique` /
  `GetParameterDesc` at load time and bind by introspection.
  If a future game version renames `BloomStrength` → `Strength`,
  we adapt by changing one string in the editor.

### Implementation outline

1. **Discover the shader's surface at load time.** New helper
   `Engine::InitBloomEffect()` called from `ResetParameters` /
   `ReloadShaders` after `m_shaderManager.getShader(device,
   L"Engine\\SceneBloom.fx")` returns:
   - Confirm it's not the default-fallback shader (compare against
     `m_shaderManager.GetDefaultEffect()` or check a known
     parameter name that wouldn't exist on the default).
   - Enumerate techniques via `ID3DXEffect::GetTechnique(i)` and
     `GetTechniqueDesc`; classify by name pattern (e.g.
     `BrightFilter` / `Gaussian*` / `AddSmooth*`).
   - Enumerate parameters; cache D3DXHANDLE for
     `BloomStrength`, `BloomCutoff`, `BloomSize`,
     `SceneTexture`, `BloomTexture`.
   - If any expected technique / parameter is missing, log a
     `[bloom]` debug line and set `m_pBloomEffect = NULL` so the
     UI shows the "bloom unavailable" state. Don't crash, don't
     render a half-broken bloom.

2. **Engine state** —
   [`src/engine.h`](src/engine.h) gains:
   - `IDirect3DTexture9* m_pBloomPing; m_pBloomPong;`
   - `Effect* m_pBloomEffect;`
   - `bool m_bloomEnabled; float m_bloomStrength, m_bloomCutoff, m_bloomSize;`
   - Public surface: 4 setters + 4 getters next to `SetGround`.

3. **Engine construction / reset** —
   [`engine.cpp:454–490`](src/engine.cpp:454) (`ResetParameters`) and
   the destructor + `Reset`:
   - Load shader: `m_pBloomEffect = m_shaderManager.getShader(device,
     L"Engine\\SceneBloom.fx")`. Cached, mod-overlay-aware, hot-
     reloadable for free.
   - Call `InitBloomEffect()` (step 1) to validate techniques /
     parameters and decide whether bloom is usable this session.
   - Allocate `m_pBloomPing` / `m_pBloomPong` at half scene size
     (`scene.w / 2, scene.h / 2`), format `D3DFMT_A8R8G8B8`,
     `D3DUSAGE_RENDERTARGET`. Adjust scale at implementation time
     if the shader expects a different size.
   - Release in matching `Reset` block. The `Effect*` itself is
     owned by `ShaderManager` — we don't release it directly;
     `ShaderManager::Clear()` handles it on `ReloadShaders`.

4. **Hot-reload integration** —
   [`engine.cpp:131–157`](src/engine.cpp:131)
   (`Engine::ReloadShaders`): add `Engine\\SceneBloom.fx` to the
   shaders re-fetched in the temp-buffer loop, or call
   `InitBloomEffect()` again after the loop runs so the cached
   handles get re-validated against the freshly-loaded effect.

5. **Render insertion point** — [`engine.cpp:262–301`](src/engine.cpp:262)
   is where scene is drawn into `m_pSceneTexture`. Bloom passes
   insert **after that block, before the distortion pass at line
   302**:
   - If `!m_bloomEnabled` or `m_pBloomEffect == NULL`, skip the
     whole block (no perf cost when off).
   - Three sub-passes, each binding the right input(s), setting the
     right RT, drawing a fullscreen quad with `DrawPrimitiveUP`.
     The quad geometry mirrors the existing compose quad at
     [engine.cpp:320–325](src/engine.cpp:320).
   - Restore original render state after the third pass so the
     heat/distortion code following it sees the same device state
     it sees today.

6. **UI: View menu + dialog** — [`src/main.cpp`](src/main.cpp):
   - New `ID_VIEW_BLOOM` resource ID and menu item under View, with
     `Ctrl+B` accelerator.
   - `ToggleBloomDialog(info)` modeled on `ToggleSpawnerDialog`
     (lazy create, hide-on-close, menu sync).
   - `IDD_BLOOM` dialog template in `.rc` files (EN + DE): master
     enable checkbox + three labeled spinners (Strength: 0.0–1.0
     step 0.05; Cutoff: 0.0–2.0 step 0.05; Size: 0.0–2.0 step 0.05).
     Initial defaults: 0.1 / 1.0 / 0.25 per shader spec.
   - `BloomDlgProc` handles `WM_INITDIALOG` (seed controls from
     engine state), `WM_COMMAND` with `SN_CHANGE` cases for the
     three spinners + `BN_CLICKED` for the master, `WM_CLOSE`
     (hide + persist position).
   - String resources for the label text (EN + DE).

7. **Persistence** — new helpers in main.cpp alongside the existing
   view-settings registry block:
   - `ReadBloomEnabled` / `WriteBloomEnabled` (DWORD).
   - `ReadBloomStrength` / `WriteBloomStrength` (REG_BINARY float
     via the `ReadGroundZ` pattern).
   - `ReadBloomCutoff` / `WriteBloomCutoff`.
   - `ReadBloomSize` / `WriteBloomSize`.
   - Wire into the startup sequence at
     [engine instance creation, ~main.cpp:3445](src/main.cpp:3445).
   - `ResetViewSettings` gains four new `RegDeleteValue` calls and
     the confirmation message text grows to mention "bloom".

## 4. Risks named up front + mitigations

1. **`SceneBloom.fx` missing from the user's game install.**
   `ShaderManager::getShader` returns the bundled default shader when
   it can't find the file. The default isn't a bloom shader — running
   it would produce visual garbage.
   In practice this should almost never fire: FileManager's resolution
   chain ([managers.cpp:13–61](src/managers.cpp:13)) falls back to
   MEG-archive lookup as its third tier, and EAW ships its shaders
   inside MEG archives. So unless the user has somehow loaded the
   editor without a game install configured (a state that already
   blocks particle rendering today) or the MEG index is corrupt, the
   shader will resolve through the same chain that already loads
   `Engine\\PrimOpaque.fx` and the other particle shaders.
   **Mitigation (defensive)**: after `getShader` returns, probe for
   an expected bloom-only parameter (e.g. `BloomStrength`) via
   `GetParameterByName`. If absent, conclude the load resolved to
   the default shader, set `m_pBloomEffect = NULL`, and disable the
   bloom UI with a tooltip. Master-enable is forced false; dialog
   opens informatively. Defensive only — the expected case is "loads
   from MEG without anyone noticing."

1a. **Game's `SceneBloom.fx` uses parameter or technique names we
    don't predict.** ROADMAP says `BloomStrength` / `BloomCutoff` /
    `BloomSize`; we'd have to verify against the actual game shader.
    A mod could ship its own bloom shader with different names.
    **Mitigation**: load-time introspection (step 1 of the
    implementation outline). If the names don't match what we
    expect, log a `[bloom]` debug line listing the parameter names
    the shader actually exposes, and disable the bloom UI for this
    session — same posture as a missing shader. Fixing it is then a
    string change.

2. **Half-resolution RT size desync on window resize.**
   `ResetParameters` runs on device reset which fires on window
   resize. Bloom RTs must be recreated at the *new* half-of-scene
   dimensions, not the old ones.
   **Mitigation**: recompute dims fresh inside `ResetParameters`
   each call; bloom RT creation reads `m_pSceneTexture`'s actual
   `GetLevelDesc` after the scene RT is recreated, then derives
   half-dims from that. Single source of truth.

3. **Alpha-as-luminance-boost depends on `A8R8G8B8` alpha surviving
   particle blending.** Some particle blend modes (additive) write
   alpha; others (alpha-blend) consume it. If the final alpha value
   in the scene RT is clobbered to 1.0 by a render state, the
   per-particle opt-in mechanism breaks.
   **Mitigation**: read the particle blend states in
   [engine.cpp Render](src/engine.cpp:290) before writing the
   bright filter. If alpha is clobbered, the bright filter falls
   back to RGB-luminance only and the alpha-boost line in the
   shader is commented out with a note. **Surface this as an
   answerable question during implementation** rather than designing
   for both paths upfront. Worst case: v1 ships RGB-only, alpha
   trick deferred.

4. **Pipeline order — bloom-before-distortion vs
   distortion-before-bloom.** Order affects the look. Bloom-first
   means heat smears the glow (correct, matches in-game look);
   distortion-first means glow smears across heat boundaries
   (visually wrong).
   **Mitigation**: insert bloom **before** the existing distortion
   pass — the order falls naturally out of "bloom modifies scene
   RT; distortion samples scene RT later." This is also what the
   game does.

5. **Spurious GPU cost when bloom dialog is open but bloom is off.**
   Drawing a dialog doesn't itself add GPU work, but if SN_CHANGE
   fires every frame from auto-drag we could thrash the registry.
   **Mitigation**: SN_CHANGE only fires on actual value change
   (not per frame). Same pattern as the Ground Z spinner —
   confirmed safe.

6. **Effect parameter handle invalidation on Reload Shaders (F5).**
   The `Effect` wrapper caches D3DXHANDLE values; on reload, those
   handles point at the old effect.
   **Mitigation**: the `Effect` wrapper already participates in the
   reload flow ([engine.cpp Clear/ReloadShaders](src/engine.cpp));
   bloom just needs to be reloaded the same way. Verify via the
   testing checklist's "F5 round-trip" item.

7. **`ResetViewSettings` forgetting to drop the four new keys.**
   Easy oversight — four keys mean four edits, not one.
   **Mitigation**: explicit checklist item + grep verification
   (`grep RegDeleteValue` returns the expected count).

8. **Half-res blocky / aliasing on upscale.** If the game's shader
   expects half-resolution RTs and we honour that, the blur targets
   can look chunky on hard edges when the AddSmooth combine reads
   them back at full resolution.
   **Mitigation**: D3DTEXF_LINEAR sampling on the bloom RTs hides
   most of it. The game's own bloom looks fine in-game; matching
   what it does should produce the same result. If still visible,
   we can experiment with RT scale.

9. **Mod-switch races with in-flight bloom render.** When the user
   selects a mod, `ReloadShaders` runs mid-frame potentially. The
   old `Effect*` is invalid the moment `ShaderManager::Clear()` is
   called.
   **Mitigation**: `ReloadShaders` is already called at frame
   boundaries (see existing pattern); bloom inherits that safety.
   `InitBloomEffect()` re-runs after each reload to refresh cached
   handles. No additional synchronisation needed.

10. **No game path configured.** A user who launches the editor
    fresh, without selecting a game install, has no `gameRoot`,
    so FileManager can't find any shader files.
    **Mitigation**: this case already fails for particle rendering
    today — the editor surfaces a "Pick game install" dialog at
    startup. Bloom just inherits "disabled" state until the user
    completes that flow.

## 5. Testing & verification

**Build / compile:**

- [ ] Debug + Release build clean.
- [ ] `ShaderManager::getShader(L"Engine\\SceneBloom.fx")` returns a
      non-default `Effect*` on dev machine (game path configured,
      shader file present).
- [ ] No new compiler warnings on touched files.

**Shader-resolution / mod switching:**

- [ ] Launch with no mod → bloom shader resolves from `<gameRoot>`
      (loose file OR MEG archive — either is fine, both are valid
      tiers of the resolution chain); `[bloom] loaded` debug line
      emitted and notes which tier hit.
- [ ] Select a mod that *doesn't* override bloom → bloom continues
      working from base game shader.
- [ ] Select a mod that *does* override bloom (test with a hand-
      crafted mod folder containing
      `<modPath>\Engine\SceneBloom.fx`) → bloom visibly changes to
      reflect the mod's shader; debug line confirms reload.
- [ ] Reload Shaders (F5) → bloom continues working after reload;
      no double-free; cached parameter handles refresh.
- [ ] Rename the game's `SceneBloom.fx` on disk, restart editor →
      bloom UI disables with the "shader missing" tooltip;
      editor doesn't crash, particles still render normally.

**Happy path (bloom enabled, defaults):**

- [ ] Master enable **off** → exact pixel parity with pre-bloom build
      (the bloom block is skipped, scene RT untouched).
- [ ] Enable bloom on a fire / explosion test particle → visible
      soft glow around bright pixels.
- [ ] **Strength slider**: 0.0 → no visible effect; 0.1 (default) →
      moderate glow; 1.0 → strong wash. Linear in between.
- [ ] **Cutoff slider**: 1.0 (default) → only ≥ pure-white pixels
      bloom; 0.1 → broad areas bloom (everything mildly bright);
      2.0 → effectively no bloom (nothing meets threshold).
- [ ] **Size slider**: 0.1 → tight glow; 0.25 (default) → comfortable
      halo; 1.0 → wide diffuse glow.

**Edge cases:**

- [ ] Window resize while bloom is on → bloom RTs recreated at new
      half-res, no crash, at most one frame of visual hitch.
- [ ] Toggle Show Ground / change background color / spin Ground
      Height with bloom on → no interaction artifacts.
- [ ] Reload Shaders (F5) with bloom on → bloom continues working
      after reload.
- [ ] Hand-craft a test particle with non-zero frame-buffer alpha →
      visible bloom contribution scaling with alpha (verifies the
      per-particle opt-in trick).
- [ ] Spinner clamps at min/max correctly; scroll-wheel modifiers
      (Shift = ×10, Ctrl = ×0.1) work like every other Spinner.

**Persistence:**

- [ ] Set Strength = 0.35, Cutoff = 0.7, Size = 0.5, master = on,
      close editor, reopen → all four values restored; bloom
      visibly active at new settings.
- [ ] Manually delete `BloomStrength` from registry → falls back to
      default 0.1 next launch, no error.
- [ ] View → Reset View Settings → master goes off, all three
      sliders return to defaults; confirmation prompt text
      includes "bloom" in the list.

**UI:**

- [ ] View menu shows **Bloom…** entry; `Ctrl+B` accelerator opens
      the dialog.
- [ ] Menu check-mark next to "Bloom…" matches dialog visibility.
- [ ] Dialog X-button hides; reopen restores position + state.
- [ ] Master enable checkbox toggles bloom live; spinner controls
      stay enabled and editable even when master is off (so the
      user can dial in values before flipping master on).

**Pipeline order:**

- [ ] Both bloom and heat-distortion enabled simultaneously: visual
      check that heat *smears* the bloomed image (confirms
      bloom-before-distortion order is correct), not the other
      way around.

**Cleanup:**

- [ ] Engine destructor releases `m_pBloomPing`, `m_pBloomPong`,
      `m_pBloomEffect`.
- [ ] Device reset releases-and-recreates the bloom RTs alongside
      `m_pSceneTexture` etc.
- [ ] Closing editor with bloom on writes final values to registry
      before exit (verify via regedit immediately after close).

**Debug instrumentation** (`#ifndef NDEBUG`):

- A single printf with prefix `[bloom]` logging
  effect-load-success-or-not at startup so a hostile-driver case is
  obvious in the debugger. Removed for Release builds. Grep tag:
  `[bloom]`.

---

## Review

**Outcome.** Bloom is live and visually identical to the game's own
bloom (modulo iteration count, see below). The "use the game's
own shader" approach paid off — zero shader authoring needed on
our side, and mod overrides are picked up automatically through the
existing FileManager chain.

**What changed from the plan:**

- **Two matcher revisions** before bloom rendered correctly:
  - v1 looked for three separate techniques named bright / blur /
    combine. The canonical shader actually has one technique with
    three passes. Diagnostic dump on the user's install surfaced
    this in one pass.
  - v2 forgot `m_resolutionConstants` — the engine-global the
    shader reads for half-pixel offset AND for the blur kernel
    base spacing. Without it the blur kernel collapses to zero
    and "bloom enabled" renders the same as "bloom off." Reading
    the canonical `SceneBloom.fx` source (found loose in the
    user's Chelmod folder, not in a MEG) revealed this and led
    to v3 which works.
- **Diagnostic file (`bloom-diagnostic.log`).** Not in the original
  plan but added when the shader appeared greyed-out on the user's
  install. Dumps every parameter and technique the loaded effect
  exposes so a future matcher tweak doesn't need code instrumentation
  to debug. Always-on (no NDEBUG gate) because the user runs
  Release builds.
- **Defaults switched twice.** Started at the shader-source
  defaults (`1.0 / 0.1 / 0.25`), bumped to Agriworld values
  (`0.90 / 1.00 / 1.00`) to make bloom visible, then settled on
  the canonical Terrain Editor's new-map defaults
  (`0.90 / 0.00 / 0.10`) at the user's instruction. The new-map
  defaults match the canonical editor's blank-slate; user dials
  `Strength` up to see bloom.
- **Toolbar toggle button added** late in the cycle (not in the
  original plan). Mirrors the Show Ground toggle's UX — one-click
  on/off, sunburst icon, greys out when bloom is unavailable.
  Added `tasks/extend_toolbar1_bmp_bloom.ps1` to extend the
  toolbar bitmap from 7 cells to 8.
- **Full-resolution ping/pong RTs** (originally planned half-res).
  Half-res made the blur kernel half-scale relative to scene
  space and added another variable while tuning. Full-res
  matches the canonical engine and eliminates the question.
- **`BLOOM_BLUR_ITERATIONS = 4`** is a tuning constant in
  `engine.cpp Render`. The canonical Terrain Editor doesn't
  expose an iteration count — it's engine-side hardcoded in the
  game's binary. Visual A/B against the canonical editor is the
  refinement path; 4 is a reasonable middle.

**Risks revisited:**

1. *Effect compile failure on user hardware.* No instances reported.
2. *Half-resolution RT desync.* Moot — switched to full-res.
3. *Alpha-as-luminance-boost.* Source revealed the shader's
   luminance dot product gives alpha weight 0, so the comment in
   the shader header is aspirational. No code action needed.
4. *Pipeline order.* Bloom before distortion — correct, matches
   the game's render flow.
5. *Spurious GPU cost.* Bloom skipped entirely when not enabled or
   not ready; one branch.
6. *Effect parameter handles on Reload Shaders.* `InitBloomEffect`
   re-runs after every `ReloadShaders` call so the cached handles
   refresh.
7. *`ResetViewSettings` forgetting bloom keys.* Four `RegDeleteValue`
   calls present, confirmation prompt mentions bloom.
8. *Shader-missing fallback.* The default-fallback shader produces
   visual garbage if used as bloom; `InitBloomEffect` probes for
   `BloomStrength` to detect this case and disables the UI.

**What I didn't do (deliberately):**

- No UI for blur iteration count — the canonical Terrain Editor
  doesn't expose one, and matching its surface keeps us aligned.
  The constant is one line in `Engine::Render` for when we have
  a definitive in-game count.
- No tone-mapping, multi-scale, or per-emitter override. Not in
  the canonical shader.
- No bundled fallback `SceneBloom.fx`. The graceful-degrade UI
  is the right answer for missing-shader installs.

**Outstanding manual test items:**

- Visual A/B against the canonical Terrain Editor on a known-bloom
  map (Agriworld at Cutoff=0.90, Strength=1.00, Size=1.00) to
  refine `BLOOM_BLUR_ITERATIONS`.
- F5 (Reload Shaders) round-trip — bloom should keep working after
  reload; handles re-cache.
- Mod switch round-trip — switching mods should hot-swap any
  mod-provided `SceneBloom.fx`.
- Toolbar button greys correctly when `IsBloomAvailable` is false
  (test by renaming the shader file or pointing at a clean install
  with no game path configured).
