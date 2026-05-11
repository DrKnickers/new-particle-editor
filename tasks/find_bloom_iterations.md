# Plan: Find the canonical bloom blur-iteration count

Follow-up to MT-6 ([#47](https://github.com/DrKnickers/new-particle-editor/pull/47)).
The bloom plumbing landed but `BLOOM_BLUR_ITERATIONS = 4` at
[src/engine.cpp:551](src/engine.cpp:551) is a guess. This investigation
finds the value the game actually uses so we can stop guessing.

Estimated complexity: ★★★ (3/5). 1–4 hours depending on which approach
sticks.

## 1. Goal + scope

**Goal.** Determine the exact ping-pong blur iteration count the
canonical engine uses for `SceneBloom.fx`, replace the guessed `4` in
`engine.cpp` with that value, and document the source of the answer so
nobody re-litigates this in six months.

**In scope:**
- Identify the iteration count used by `EAW Terrain Editor.exe`
  (canonical reference editor) and `StarWarsG.exe` (running game).
  Cross-validate the two — they should agree.
- Update `BLOOM_BLUR_ITERATIONS` in `engine.cpp` with the discovered
  value plus a one-line provenance comment.
- One CHANGELOG paragraph: what we found, how we found it.

**Out of scope (and why):**
- *UI for iteration count.* Canonical Terrain Editor doesn't expose
  one. Surface-matching is the rule (MT-6 retrospective, [tasks/todo.md:570](tasks/todo.md:570)).
- *Reverse-engineering other bloom internals* (Gaussian weights, kernel
  radius math, half-pixel offset). Only the loop count is unknown — the
  shader source already gives us the rest.
- *A new ROADMAP entry.* This is the "outstanding manual test item"
  listed at [tasks/todo.md:581](tasks/todo.md:581); closing it doesn't
  warrant a separate ROADMAP slot.
- *Patching the live game binary or shader to instrument.* Never modify
  game files in place — all techniques here are read-only inspection or
  copy-then-modify.

## 2. What the codebase already gives us

- **The blur loop itself** at [src/engine.cpp:614](src/engine.cpp:614)
  drives `BloomIteration` and ping-pongs RTs. Only the upper bound
  (`BLOOM_BLUR_ITERATIONS`, [src/engine.cpp:551](src/engine.cpp:551))
  is unknown — every other parameter binding is settled.
- **`bloom-diagnostic.log`** introspection writer at
  [src/engine.cpp:144](src/engine.cpp:144) confirmed that the shader
  exposes `BloomStrength`, `BloomCutoff`, `BloomSize`, `BloomIteration`,
  and `SceneTexture` as real parameter handles. These string names
  exist in the binary too — they're our anchor for static analysis.
- **Canonical `SceneBloom.fx`** lives loose on disk at
  `…\corruption\Mods\Chelmod\Data\Art\Shaders\Engine\SceneBloom.fx`
  (per MT-6 retrospective, [tasks/todo.md:516](tasks/todo.md:516)).
  Reading its source already taught us the technique structure.
- **Game-install discovery in registry**, already verified this session:
  - `swfoc.exe` launcher at `D:\SteamLibrary\steamapps\common\Star Wars Empire at War\corruption\swfoc.exe`
  - `StarWarsG.exe` (12.4 MB engine binary) in same folder
  - `EAW Terrain Editor.exe` at `…\corruption\Mods\Chelmod\EAW Terrain Editor.exe`
- **No `.pdb` files.** Both binaries are stripped — symbol-free RE.

## 3. Approach

Three approaches, ordered cheapest-first. Each has a clean fallback to
the next.

### Pre-flight findings (2026-05-11)

- **All three target binaries are x64.** Verified via PE header
  Machine field: `EAW Terrain Editor.exe` (17.1 MB), `StarWarsG.exe`
  (12.4 MB), and `swfoc.exe` (1.7 MB) all report `0x8664` (x64). Build
  date 2025-08-08.
- **Provenance:** these are the canonical Petroglyph 64-bit patch,
  shipped years after the original 2006 release as a community-support
  update from the studio (per
  [IGN coverage](https://www.ign.com/articles/rts-star-wars-empire-at-war-still-getting-updates-17-years-after-launch)).
  Not a community fork. The iteration count we find IS the canonical
  engine value, not a third-party recompile's value.
- **PIX legacy (DX SDK June 2010) is dead in the water** for these
  binaries — it only attaches to 32-bit D3D9 processes. Already-installed
  PIX is unusable here.
- **apitrace skipped** by user instruction; go straight to static
  analysis with Ghidra (more reliable for this exact "find one integer
  in a stripped binary" task).

### Approach A — Static binary analysis with Ghidra (primary)

Disassemble with **Ghidra** (free, JDK-based, supports stripped x64 PE):

1. Load `EAW Terrain Editor.exe` first (smaller binary, less noise).
   Run auto-analysis.
2. Search defined strings for `"SceneBloom.fx"`, `"BloomIteration"`,
   `"BloomStrength"`. We know all four exist (the diagnostic log proved
   it).
3. Cross-reference the string addresses to find the function that loads
   the bloom shader and the function that drives the per-frame render.
4. Walk the render function for the blur loop: a tight `for` over an
   integer with a `cmp` against an immediate (or against a config field
   loaded from a global). The immediate is the answer.
5. Repeat against `StarWarsG.exe` to cross-validate.

Time-box: 4 hours. If the disassembly path doesn't converge in that
window, fall to approach C and accept "tuned to match" rather than
"proved equal."

### Approach B — D3D9 frame capture (fallback if static analysis stalls)

If Ghidra disassembly stalls, capture one rendered frame from
`EAW Terrain Editor.exe` while bloom is visible. Tool of choice:
**apitrace** (open-source, actively maintained, supports D3D9 on x64
Windows). Produces a `.trace` file replayed in `qapitrace`; the blur
loop is identifiable by ping-pong RT aliasing — iteration count =
number of blur draws between bright-filter and combine.

PIX legacy is unusable here (32-bit only). RenderDoc dropped D3D9 in
1.x. apitrace is the only viable capture path on this 64-bit binary.

### Approach C — Empirical visual A/B (last resort)

Side-by-side render: our editor vs. canonical Terrain Editor on the
same map at identical params (Agriworld at `Cutoff=0.90 Strength=1.00
Size=1.00`). Sweep our `BLOOM_BLUR_ITERATIONS` from 1 to ~16; pick the
value where the two are visually indistinguishable. Subjective; only
acceptable if A and B both fail.

### Cross-validation step (regardless of approach)

Whatever value approach A or B yields, confirm by:

1. Patching `BLOOM_BLUR_ITERATIONS` in our build.
2. Loading the same test map in our editor and the canonical Terrain
   Editor side by side.
3. Visually identical → done. Visibly off → the value is wrong (or some
   other variable diverges; investigate).

## 4. Risks named up front + mitigations

1. **PIX legacy won't run on Windows 11.** The DX SDK June 2010 PIX is
   16 years old; Microsoft has progressively dismantled D3D9 debug
   support. *Mitigation:* try once, then fall through to apitrace
   without ceremony. apitrace is actively maintained and known to work
   for D3D9 on modern Windows.

2. **The Terrain Editor and `StarWarsG.exe` use different iteration
   counts.** Plausible — preview tools sometimes ship with shorter
   loops. *Mitigation:* capture both. If they diverge, the Terrain
   Editor count is what we want (it's our calibration target by user
   instruction). Document the divergence in CHANGELOG so a future
   reader doesn't assume the constants are interchangeable.

3. **The loop bound is a runtime config, not an immediate.** The game
   has graphics-quality settings; iteration count could scale with
   them. *Mitigation:* if disassembly shows the bound coming from a
   memory load rather than an immediate, follow that field's writes
   back to its initialization site to find the per-quality defaults.
   We then pin to the value used at the highest quality setting (our
   editor's preview is always full-quality).

4. **Multiple bloom-like loops in the engine confuse the search.**
   The 12 MB binary almost certainly has other post-process loops
   (DOF, motion blur, etc.). *Mitigation:* anchor the search on the
   `"BloomIteration"` string specifically — only the bloom code path
   references that exact name. Cross-confirm with the
   `"SceneBloom.fx"` string load.

5. **Ghidra install eats the time budget.** First-time Ghidra setup
   (JDK download, indexer initial run on 12 MB) can take 30–60 minutes
   before any analysis is possible. *Mitigation:* time-box approach B
   at 4 hours total *including* setup. If we're not converging by
   then, fall to approach C (visual A/B) — slower to refine but
   guaranteed-finite.

6. **Accidentally modifying the game install.** Steam may revalidate
   files; modifying binaries in place could break the install or trip
   anti-tamper. *Mitigation:* every technique here is read-only.
   Captures write to *our* working directory, not the game folder. If
   we ever need to instrument the shader, copy `SceneBloom.fx` into a
   scratch mod folder and load *that* — never edit the original.

## 5. Testing & verification

**Approach A success criteria:**
- A `.pix` or `.trace` file exists in this worktree.
- Opening it in the GUI shows ≥1 frame containing identifiable bloom
  passes (off-screen RT bind → bright filter draw → ping-pong blur
  draws → combine draw).
- The blur draw count is the same across two independent captures of
  the same scene.

**Approach B success criteria:**
- Ghidra project saves successfully with `EAW Terrain Editor.exe`
  loaded and auto-analyzed.
- `"BloomIteration"` and `"SceneBloom.fx"` strings appear in the
  Defined Strings window with cross-references.
- A render function is identified that:
  - References both strings (transitively).
  - Contains a loop with a discoverable bound (immediate or known
    global field).
- The same loop bound is found by repeating the analysis against
  `StarWarsG.exe`.

**Cross-validation success criteria:**
- With `BLOOM_BLUR_ITERATIONS` set to the discovered value, our editor
  and the canonical Terrain Editor produce visually indistinguishable
  bloom on the same map at the same params (Agriworld, Cutoff 0.90,
  Strength 1.00, Size 1.00).
- Side-by-side screenshots saved under `tasks/` for the record.

**Documentation:**
- `engine.cpp` constant updated with a one-line comment citing the
  source ("from PIX capture of EAW Terrain Editor.exe, frame N" or
  "from disassembly of StarWarsG.exe at offset 0x…").
- CHANGELOG entry under `## Changelog` describing the investigation
  outcome (date, tool used, value found, any cross-validation notes).
- If user corrections happen during this investigation, append a
  preventing rule to `tasks/lessons.md` (file doesn't exist yet —
  create it on first use).

**Refused inputs / nothing-to-do cases:**
- If the discovered value happens to equal `4`, no code change beyond
  the comment is needed -- but we still ship the CHANGELOG note saying
  "validated empirically; the guess was right."

---

## Review

**Outcome.** Canonical value is **`4`** -- our existing
`BLOOM_BLUR_ITERATIONS = 4` in
[src/engine.cpp:551](src/engine.cpp:551) was the right number all
along. The MT-6 guess landed exactly on the engine value. Code change
is comment-only (provenance + offset).

**How we found it.**

1. `EAW Terrain Editor.exe` imported into Ghidra 12.0.4 with auto-
   analysis (~11 min). Project saved at
   `tasks/ghidra_project/BloomRE`.
2. `tasks/ghidra_scripts/FindBloomLoop.py` walks defined-data strings
   for the four bloom parameter names + `Engine\SceneBloom`,
   collects xref-source functions, decompiles them. Two functions
   matched:
   - `FUN_1400ea730` -- shader loader (refs `Engine\SceneBloom`).
   - `FUN_1400effc0` -- bloom render path (refs `BloomStrength`,
     `BloomCutoff`, `BloomSize`, `BloomIteration`).
3. Decompiled body of `FUN_1400effc0` shows the ping-pong blur loop
   `do { ... bind BloomIteration ... draw ... } while (iVar7 <
   DAT_140f09244)` -- the bound is a **runtime global**, not an
   immediate. Risk #3 from the plan, exactly as anticipated.
4. `tasks/ghidra_scripts/InspectIterGlobal.py`:
   - Confirmed `0x140f09244` lives in the `.data` section
     (initialized=True; bytes `04 00 00 00 ...` -> int32 `4`).
   - Searched the entire program for both QWORD-LE and DWORD-LE
     forms of the address. **Zero hits** -- nothing else points at
     this slot, so no code path can write it indirectly via a table
     or vtable. The value is set at compile time and stays `4` for
     the lifetime of the process.
5. Cross-validation against `StarWarsG.exe` (the running game,
   12.4 MB) confirmed the value. Same anchor strings, same call
   graph, same blur loop shape (function `FUN_140183a30`, body 833
   bytes -- byte-identical size to the Terrain Editor's
   `FUN_1400effc0`). Loop bound at a different absolute address
   (`DAT_140a129f4`, naturally) but same `.data`-baked value `4` and
   zero writers via `InspectIterGlobalSWG.py`. Both binaries are
   compiled from the same engine source.

**Why no quality-setting scaling.** The mitigation under Risk #3
anticipated "follow the field's writes back to find the per-quality
default." But since there are *zero* writes in the entire binary,
there's no graphics-quality dispatch table to walk. The constant is
truly hardcoded.

**Risks revisited.**

1. *PIX legacy unusable on x64* -- correct. Skipped without spending
   time on it.
2. *Terrain Editor and `StarWarsG.exe` use different counts* --
   confirmed identical. Both store the bound in a `.data`-baked
   int32 with value `4` and zero writers anywhere in the binary.
3. *Loop bound is a runtime config* -- partially correct: it IS read
   from a global, but the global is `.data`-baked with no writes.
   Equivalent to a hardcoded constant from our perspective.
4. *Multiple bloom-like loops confuse the search* -- not an issue;
   `BloomIteration` was unique enough to anchor on.
5. *Ghidra time budget* -- under control. Auto-analysis took 11 min
   (one-time); subsequent script runs use `-process -noanalysis` and
   complete in seconds.
6. *Modifying the game install* -- not done. All work was read-only
   inspection.

**What I won't do (deliberately).**

- *No UI for iteration count.* Same reasoning as MT-6: canonical
  Terrain Editor doesn't expose one, surface-matching wins.
- *No constant-extraction abstraction.* It's one `static const UINT`
  line. Wrapping it in a config system would be over-engineering for
  a value that's unlikely to ever change.

**Tooling installed (durable, not part of the editor build).**

- `C:\Tools\jdk-21.0.11+10` -- Adoptium Temurin JDK 21 (Ghidra dep).
- `C:\Tools\ghidra_12.0.4_PUBLIC` -- Ghidra reverse-engineering suite.
- Reproducer scripts at [`tasks/ghidra_scripts/`](ghidra_scripts) ARE
  committed (~12 KB total, four Jython files). The Ghidra project
  database itself lives at `tasks/ghidra_project/` (~888 MB,
  gitignored) -- rebuildable from the scripts + binaries by re-running
  `analyzeHeadless` with `-import` on either exe.

**Manual test items.**

- Visual A/B is now redundant for the iteration count specifically
  -- the value is proven from the binary. Still worth doing once at
  some point as a sanity check on our broader bloom pipeline (do
  Cutoff/Strength/Size produce the same look as the canonical
  editor at the same params?).
