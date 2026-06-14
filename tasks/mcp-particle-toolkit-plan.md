# [LT-9] MCP Particle Toolkit — inspect / transform / generate `.alo` particle systems from natural language

**Status:** proposal / pre-greenlight. Written as a project-manager design
brief for a Claude Code implementer. Tag `[LT-9]` is the candidate Long-term
slot (max+1 over `[LT-1]`…`[LT-8]`); assign it for real only when this lands
in `ROADMAP.md` per the tag-stability rules.

**One-line:** an MCP server that lets an agent read, edit, and author Alamo
particle `.alo` files conversationally — "explain this effect," "recolour this
to faction red," "make me a big orange explosion," "build a looping mouse-cursor
effect" — with an **automated render-and-critique loop** so the user only ever
sees a polished, visually-verified result.

---

## 1. Goal + scope

**Goal.** When this ships, a user can hand the agent a particle file (or just
describe one) and get back a game-loadable `.alo` whose look has been verified
by rendering it, not just by editing parameters. Three interaction modes are
all first-class: **single-file iterative editing** (drop a file, ask for a
change, see a preview, iterate), **batch pipelines** (recolour a whole folder
of effects to a faction palette, produce N variants), and **generative
authoring** (create a new effect from a description, drawing on a precedent
corpus). The agent is the *semantic* layer; the underlying tools stay
mechanical and testable.

**Design spine.** The MCP does not reimplement the `.alo` format or the
renderer. It **orchestrates two thin native surfaces that already mostly
exist** — a transform CLI built from the repo's own `ParticleSystem`
load/transform/save code, and the existing `--capture` host for off-screen
preview rendering — plus a small corpus/enumeration capability. Format truth
and render truth both come from the editor's own code, so output is guaranteed
consistent with what the editor produces.

### In
- **Inspect (read):** decode any `.alo` particle system to structured JSON
  (emitter tree, RGBA/scale/rotation/index keyframe tracks, blend mode,
  textures, lifetimes, groups, spawn-on-death / spawn-during-life links) for
  the agent to reason over and summarise in natural language.
- **Mechanical transforms (write):** recolour (edit colour tracks), rescale
  (size + time — already exists as `DoRescaleEmitter`), retexture, change blend
  mode, retime, rename / duplicate / delete emitters — round-tripped through the
  repo's own writer.
- **Preview/capture:** render a system to image(s) off-screen — a **frame strip**
  across a one-shot's lifetime and a **loop GIF** for a looping effect — so the
  agent can see results and self-critique. Built as an extension of the
  existing `--capture` mode.
- **Precedent corpus (all three sources, this pass):** (a) bundled templates
  (shared with LT-2), (b) the selected mod's effects and user-provided files
  (free today via `ModManager` + `LoadParticleSystem`), and (c) **base-game /
  mod MEG archive enumeration** — list and pull `.alo` particle assets packed
  inside the `.meg` files so the generator can learn from and start from real
  in-game effects.
- **Generative authoring:** template-/precedent-instantiation plus parametric
  edit, with the closed render-critique loop driving convergence. Intent presets
  (one-shot / looping / ambient) shape the envelope and texture choice.
- **MCP server** exposing the above as tools, running locally on the user's
  Windows machine (it invokes the native binaries there).

### Out (each with its reason)
- **Reimplementing the `.alo` format in Python/TS** → out. Violates the
  single-source-of-truth-for-format rule; all reads/writes go through the
  repo's `ParticleSystem`. (A pure-read mirror could be a future convenience,
  but never the write path.)
- **From-absolute-scratch synthesis with no template/precedent** → deferred.
  Mechanically possible via the create/add-emitter verbs, but aesthetic quality
  from raw parameters is the hard, open problem. Template + precedent + the
  render loop is the quality strategy; pure synthesis is a later stretch once
  the loop is proven.
- **Generating brand-new sprite textures (image-gen → DDS/TGA)** → deferred to a
  fast-follow. v1 generative reuses existing game/mod/template textures (the
  `FileManager` already resolves them). New-sprite synthesis is additive.
- **True windowless headless rendering** → deferred. The existing `--capture`
  path is CLI-driven and non-interactive but still spins up a host window; that
  is workable for automation now. A fully windowless off-screen device is a
  later refinement, not a v1 blocker.
- **Driving the live editor UI for edits** → out. The MCP operates on files via
  the CLI; it does not puppet the running React UI. (The user can still open
  results in the editor.)
- **Non-`.alo` / mesh-model authoring** → out. Scope is particle systems. Mesh
  `.alo` is `AloModel` / LT-7 territory.

---

## 2. What the codebase already gives us

**Particle model + faithful round-trip (the whole read/write substrate):**
- `ParticleSystem(IFile*)` loads, `ParticleSystem::write(IFile*)` saves
  ([src/ParticleSystem.h:276,280](src/ParticleSystem.h)); `LoadParticleSystem(path, &err)`
  is the standalone, UI-free loader ([src/main.cpp:1269](src/main.cpp)) — already
  reused by "import emitters from another file" (LT-3, [src/main.cpp:7132](src/main.cpp)),
  proof the load path is decoupled from the editor.
- Colour/alpha/scale are per-emitter **keyframe tracks**: `TRACK_RED_CHANNEL`…
  `TRACK_ALPHA_CHANNEL`, `TRACK_SCALE`, `TRACK_INDEX`, `TRACK_ROTATION_SPEED`
  ([src/ParticleSystem.h:33-40](src/ParticleSystem.h)), each a `multiset<Key{time,value}>`
  with linear/smooth/step interpolation ([src/ParticleSystem.h:73-105](src/ParticleSystem.h)).
  Recolour/retime/rescale = editing these key sets. Blend modes + ground +
  emit-mode enums are all named constants ([src/ParticleSystem.h:43-69](src/ParticleSystem.h)).
- `DoRescaleEmitter(emitter, timeScale, sizeScale)` is **already a pure, no-UI,
  no-UndoStack transform** ([src/Rescale.h](src/Rescale.h), [src/Rescale.cpp:68](src/Rescale.cpp)) —
  built precisely so a non-UI caller can rescale. The first transform verb is
  free.

**Precedent for "operate the system without the GUI":**
- The new UI already drives edits as string-keyed JSON verbs through
  `BridgeDispatcher` — e.g. `engine/action/rescale-system` walks every emitter
  and calls `DoRescaleEmitter` ([src/host/BridgeDispatcher.cpp:1737-1757](src/host/BridgeDispatcher.cpp)).
  The CLI verb vocabulary can mirror this contract (same shapes, no WebView).

**Off-screen render + capture (the preview keystone — already a CLI mode):**
- `--capture <in.alo> <out.png> --frames N --skydome <slot>` is parsed today
  ([src/main.cpp:8111-8123](src/main.cpp)); capture mode loads the `.alo`, applies
  mod/skydome context, renders `m_captureFrames` (default 60) so the effect
  develops, and writes the result ([src/host/HostWindow.cpp:3518-3725](src/host/HostWindow.cpp)).
- Pixels come from an **off-screen ARGB render target** (the `AlphaCompositor`),
  read back alpha-correct — not scraped from the visible window:
  `CaptureSnapshotToFile` (lossless PNG, used by `--capture`) and
  `CaptureSnapshotPng` (base64) ([src/host/AlphaCompositor.cpp:572,921](src/host/AlphaCompositor.cpp);
  [src/host/AlphaCompositor.h:117-127](src/host/AlphaCompositor.h)). Bridge kind
  `viewport/capture-snapshot` already returns a base64 frame
  ([src/host/BridgeDispatcher.cpp:1185-1190](src/host/BridgeDispatcher.cpp)).
- **Gap to close:** emit frames at multiple timestamps (strip) and/or a GIF
  loop, rather than one PNG after N frames. The render loop already counts
  `capturedFrames` ([src/host/HostWindow.cpp:3712](src/host/HostWindow.cpp)) — an
  interval emit, not new architecture. This work overlaps the **capture tool**
  (next roadmap item) and should be co-designed with it.

**Precedent corpus plumbing:**
- `ModManager` discovers installed EaW/FoC mods, exposes `GetMods()` /
  `SelectMod()`, and on selection wires `FileManager::SetModPath` +
  `TexturePalette::SetActiveMod` ([src/ModManager.h:50-102](src/ModManager.h)). "Use
  this mod's effects as precedent" is plumbed.
- **MEG enumeration is essentially free at the archive layer:** `MegaFile`
  parses the full file table and exposes `getNumFiles()` + `getFilename(index)`
  ([src/MegaFiles.h:24-29](src/MegaFiles.h)); `FileManager` holds the live
  `vector<MegaFile*> megafiles` ([src/managers.cpp:47,93,122](src/managers.cpp)). A
  corpus lister iterates those, filters `*.alo`, and (cheaply) gates real
  particle systems by the load magic. Pulling a packed asset is the existing
  `FileManager::getFile` → `ReadAndRelease` path
  ([src/files.h](src/files.h), [src/MegaFiles.h:21](src/MegaFiles.h)).

**Textures (for retexture + generative reuse):**
- `LoadTextureViaFileManager(dev, fm, bareName)` resolves a bare texture name
  through the mod→base→MEG chain ([src/engine.cpp:81-103](src/engine.cpp)); `.alo`
  materials store bare names, so listing/validating an effect's textures reuses
  this.

**XML/config (for MEG manifests + skydome/mod config):**
- `XMLTree::parse` + `FileManager` already read the game's packed XML manifests
  (used by `SkydomeEnvironment` and `MegaFiles.xml` loading,
  [src/managers.cpp:71](src/managers.cpp)).

---

## 3. Architecture / implementation approach

Three native deliverables behind one MCP, layered so each step is independently
useful and testable.

### 3.1 `particle-cli` — headless transform + inspect (subcommand on the host)
**Decided (App. B-1):** ship this as a `--tool <verb>` subcommand on the
**existing host binary**, with a CLI fast-path in `WinMain` that runs and exits
**before any D3D/WebView2 init** for the device-free verbs — same branch pattern
the existing `--capture` mode already proves. This avoids a second MSBuild
target and reuses arg-parsing; preview (3.2) stays in the same binary's
`--capture` path because it needs the device. *Pickup caveat:* verify `WinMain`
can branch early enough to skip device/window creation; if not, fall back to a
slim separate target. The device-free verbs link `ParticleSystem`, `Rescale`,
the chunk reader/writer, `FileManager`, and `ModManager` — **none of which
depend on the Win32 UI**. Verb set mirrors the bridge contract:

- `inspect <in.alo> [--json]` → structured dump (emitter tree + tracks + blend +
  textures + lifetimes + links). Read-only; needs no device.
- `recolor <in> <out> [--emitter NAME|--all] <colour-spec>` → edit RGBA tracks
  (set flat, tint toward hue, remap gradient, multiply brightness/alpha).
- `rescale <in> <out> --size P --time P` → `DoRescaleEmitter` over the chosen
  emitters.
- `retexture` / `set-blend` / `retime` / `rename` / `dup-emitter` /
  `del-emitter` → mechanical edits on the model.
- `corpus-list [--mod PATH] [--base] [--filter glob]` → enumerate `.alo`
  particle systems across loose files + MEG archives (via `MegaFile` table),
  returning name + source + a one-line shape summary.
- `corpus-extract <archive-relative-path> <out.alo>` → pull a packed precedent
  asset to disk for use as a generation base.
- `new --base <template|corpus-ref> [edits…] <out.alo>` → instantiate +
  parametric edit (generative primitive).

The CLI speaks JSON in/out so the MCP can compose verbs without string-scraping.
**Format truth = the repo's own writer.**

### 3.2 Preview via `--capture` (extended)
The MCP renders by invoking the host's `--capture` path. Extend it minimally:
- `--strip <out_prefix> --at t0,t1,…` (or `--every N`) to emit several
  timestamps for a one-shot.
- `--gif <out.gif> --loop` for looping effects.
- `--bg <colour|skydome>` + a fixed framing camera for consistent thumbnails.

This is deliberately shared work with the **capture tool** roadmap item — build
it once. The MCP returns the rendered image(s) to the agent, which inspects them
and decides whether to iterate.

### 3.3 MCP server (`particle-mcp`)
A thin local server (Node or Python) that wraps 3.1 + 3.2 as tools:
`inspect`, `recolor`, `rescale`, `retexture`, `set_blend`, `corpus_list`,
`corpus_extract`, `generate`, `preview`. Each tool shells to the native binary
on the user's machine and returns JSON / image paths. The **agent** supplies the
semantic layer: interpret a fuzzy request → concrete verb plan → execute →
`preview` → critique against the request → iterate → present the polished file +
preview. No "intelligence" lives in the CLI.

### 3.4 The corpus model (three sources, this pass)
`generate` draws a base from: **templates** (LT-2 bundle), **mod/user files**
(`ModManager` + `LoadParticleSystem`), and **base-game/mod MEG archives**
(`corpus-list`/`-extract`). Intent presets bias base selection and the
size/time/blend envelope; texture choice reuses the base's textures (new-sprite
generation deferred).

### Build sequence (each step lands independently)
1. **Inspect** — `particle-cli inspect` + MCP `inspect` tool + agent NL summary.
   No device, no risk. Proves the round-trip and JSON contract.
2. **Mechanical transforms** — `recolor`/`rescale`/`retexture`/`set-blend`,
   round-tripped through the writer. Still no render.
3. **Preview/capture** — extend `--capture` to strips + GIF; MCP `preview`. The
   **keystone** — once this works, every upstream edit becomes visually
   verifiable and the automation turns on. Co-built with the capture tool.
4. **Corpus** — `corpus-list`/`-extract` across loose + mod + base-game MEG;
   MCP corpus tools. (Folded into the first pass per decision.)
5. **Generative** — `new --base …` + the closed render-critique loop; intent
   presets; templates (LT-2). Texture-gen deferred.

---

## 4. Risks named up front + mitigations

1. **Format fidelity on write.** A malformed write produces a file the game
   silently rejects or mis-renders. *Mitigation:* never reimplement the format —
   every write goes through `ParticleSystem::write`. Add a round-trip golden
   test: load → write → reload → assert structural equality on the vanilla
   corpus (mirrors the existing chunk-parser test discipline).

2. **"Looks valid, looks wrong."** A recolour/generate can be technically valid
   but ugly — the exact failure the user wants avoided. *Mitigation:* the
   render-critique loop (step 3) is mandatory before anything is surfaced; the
   agent self-checks the preview against the request and iterates. This is why
   preview is the keystone, not a nicety.

3. **`--capture` still opens a window / needs a desktop session.** Batch runs
   could be flaky or pop windows. *Mitigation:* accept window-spawning for v1
   (it's non-interactive and CLI-driven); serialise captures; log determinism.
   Flag true windowless off-screen as a fast-follow only if batch flakiness
   shows up in testing.

4. **Distinguishing particle `.alo` from mesh `.alo` in the corpus.** Both share
   the extension; a mesh model fed to `ParticleSystem` throws. *Mitigation:*
   `corpus-list` gates entries by the particle load-magic (cheap header check),
   not the extension; mesh `.alo` is silently excluded (and is `AloModel`/LT-7
   territory).

5. **Recolour semantics are ambiguous.** Colour comes from tracks *and* a
   modulating `colorTexture`; "make it blue" may mean tracks, texture, or both.
   *Mitigation:* `inspect` surfaces both; the agent proposes a concrete plan and
   confirms intent on ambiguous asks rather than guessing. Default = edit tracks,
   leave texture unless asked.

6. **Generative quality is an open problem.** Pure synthesis can disappoint.
   *Mitigation:* scope v1 generative to template/precedent instantiation +
   parametric edit (known-good starting point) + the render loop for
   convergence; explicitly defer from-scratch synthesis (§Out).

7. **Platform / where the binaries run.** The CLI + capture host are Windows
   x64; the MCP must run locally on the user's machine to invoke them.
   *Mitigation:* document this as the deployment model (same as the editor
   itself); the MCP is a thin local launcher, not a cloud service.

8. **MEG enumeration surfaces non-particle / huge corpora.** Base-game MEGs hold
   thousands of assets. *Mitigation:* filter to particle `.alo` by magic; cache
   the listing; paginate/summarise in `corpus-list` output so the agent isn't
   flooded.

---

## 5. Testing & verification

**Round-trip / format (step 1–2):**
- Golden round-trip: load → write → reload → structural-equality assert across
  the vanilla EaW+FoC `.alo` particle corpus.
- `inspect` JSON matches known values for ≥3 hand-checked reference effects
  (emitter count, track keys, blend mode, textures).
- Each transform verb: assert the *intended* tracks changed and *nothing else*
  did (diff the inspect-JSON before/after).

**Transforms (step 2):**
- `recolor` flat / tint / gradient-remap / brightness — value math checked
  against expected key values; out-of-range clamps.
- `rescale` parity with the existing `engine/action/rescale-system` result on
  the same input.
- Edge cases: empty system, single-emitter, deeply nested spawn chains,
  missing-texture reference, emitter named vs `--all`.

**Preview (step 3):**
- `--capture` strip emits the requested timestamps; GIF loops cleanly; fixed
  framing is deterministic across runs (byte-stable or perceptual-hash stable).
- A known effect renders recognisably (non-empty, correct dominant colour after
  a recolour) — the loop's self-critique signal is real.
- Window-spawn / desktop-session behaviour observed under a batch of ≥20.

**Corpus (step 4):**
- `corpus-list` enumerates loose + mod + base-game MEG; counts match a manual
  MEG-table dump; mesh `.alo` excluded; mod-override precedence respected.
- `corpus-extract` pulls a packed asset that then `inspect`s and renders.

**Generative (step 5):**
- "big orange explosion" / "looping cursor glow" produce game-loadable files
  that open in the editor and render; intent presets change the envelope as
  expected.
- End-to-end: a fuzzy request runs the full plan→execute→preview→critique→iterate
  loop and converges within a bounded number of iterations.

**Cross-cutting:**
- MCP tool contract: every tool's JSON in/out validated; error paths (bad file,
  not a particle system, missing install) return clean structured errors.
- No UI coupling regression: `particle-cli` links and runs with no WebView2 /
  host-window dependency for the non-render verbs.

---

## Appendix A — ready-to-paste ROADMAP entry

Slot into `ROADMAP.md` §3 (Long term). Position `3.M` renumbers per house
rules; the tag `[LT-9]` is max+1 over `[LT-1]`…`[LT-8]` and becomes permanent
on insert.

> ### 3.M [LT-9] MCP particle toolkit (inspect / transform / generate `.alo`)
> A local MCP server that lets an agent read, edit, and author particle systems
> conversationally — explain an effect, recolour it to a faction palette, batch
> N variants, or generate a new effect ("big orange explosion," "looping cursor
> glow") from a description. It does **not** reimplement the format or renderer:
> a headless `particle-cli` (built from the repo's own `ParticleSystem` /
> `Rescale` / `FileManager` / `ModManager`) provides faithful read/write and
> corpus enumeration across loose files, the selected mod, and base-game MEG
> archives; the existing `--capture` host (extended to frame-strips + GIF loops,
> shared work with the capture tool) provides an off-screen **render-and-critique
> loop** so the user only ever sees a visually-verified result. Generative v1 is
> template/precedent instantiation + parametric edit (new-sprite texture
> generation and from-scratch synthesis deferred). Plan:
> [`tasks/mcp-particle-toolkit-plan.md`](tasks/mcp-particle-toolkit-plan.md).
>
> - **Difficulty**: ★★★★★ (5/5) — new build target + MCP surface + render
>   pipeline extension + corpus enumeration + the generative quality loop
> - **Estimated effort**: 40–70 hours across five independently-landable steps
>   (inspect → transforms → preview → corpus → generative); steps 1–2 are small
>   given the existing pure-IO code, step 3 co-builds with the capture tool

---

## Appendix B — resolved decisions (locked 2026-06-13)

1. **Packaging:** `--tool <verb>` subcommand on the existing host binary with a
   pre-graphics-init CLI fast-path for device-free verbs; `--capture` (same
   binary) for preview. Slim separate target only as fallback if early branch
   proves awkward. (See §3.1.)
2. **Recolour grammar:** mechanical + explicit, and **gradient-shape-preserving
   by default** — the RGBA-over-life curve *is* the effect's identity, so the
   default mode hue-rotates / tints the existing tracks rather than flattening.
   CLI accepts a hex/named target plus relative ops (hue-rotate degrees,
   sat/value multipliers, alpha scale) under `--mode {tint, remap-gradient,
   flat, multiply}`. Natural-language intent ("icy," "faction red") is resolved
   by the **agent** into a concrete spec, with confirmation on ambiguity — the
   CLI never guesses.
3. **Preview default per intent preset:** **strip (contact sheet) for one-shot,
   GIF for looping/ambient**, plus a single hero/peak thumbnail; either is
   requestable. Strip/GIF assembly lives in the **native capture step** (it
   already holds the frames + a GDI+ encoder), so the MCP just receives files.
4. **MCP host language:** **Node/TS** — the verb contract overlaps the existing
   TS `bridge-schema`, so the CLI/MCP contract derives from / mirrors those
   types instead of forking a second source of truth, and it stays in the web
   workspace's pnpm toolchain. (Python's image-assembly edge is moot once
   strip/GIF assembly is native per decision 3.)
