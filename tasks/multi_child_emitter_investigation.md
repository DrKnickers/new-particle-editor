# Plan: Investigate whether the engine supports >1 on-lifetime child per emitter

Investigation arising from MT-5 ("Confirm / extend two-child emitter
support"). The roadmap item as written asks a narrow question — can a
single emitter use *both* the `spawnDuringLife` slot and the
`spawnOnDeath` slot simultaneously? The user's actual interest is the
broader question: **can an emitter spawn more than one on-lifetime
child?** That's the version this plan investigates.

Estimated complexity: ★★★ (3/5). 2–5 hours of static analysis and
fixture work, depending on how clean the chunk parser disassembles.

---

## 1. Goal + scope

**Goal.** Determine, from the canonical game binaries, whether the
running engine's emitter data model supports attaching more than one
on-lifetime child to a single parent emitter — and use the answer to
either expand the editor / format or close the door cleanly.

The question is really three sub-questions, answered in order:

1. **Parser side.** When the game reads chunk `0x36` (the spawn-link
   block) under an emitter, does it accept multiple `0x39`
   (spawnDuringLife) mini-chunks (list-append), accept exactly one
   (overwrite or hard-fail), or skip past unknown duplicates?
2. **Runtime data structure.** In the in-memory `Emitter` struct, is
   the during-life child stored as a single index / pointer, or a
   collection (array / vector / linked list)?
3. **Spawn dispatch.** At particle-spawn time, does the engine fire a
   single child reference, or iterate over a list of references?

All three answers come from one or two functions in `StarWarsG.exe`
and `EAW Terrain Editor.exe`. Confirmed for both binaries — they ship
from the same engine source (per the bloom investigation), but
divergence is possible and cross-validation is cheap.

**In scope:**
- Locate the .alo emitter-properties parser in `StarWarsG.exe` via
  Ghidra and read out the answers to Q1–Q3.
- Cross-validate against `EAW Terrain Editor.exe`.
- Author 2–3 minimal `.alo` fixture files that exercise the
  "interesting" configurations (one parent + life-only, parent +
  death-only, parent + both, hand-crafted file with two `0x39`
  mini-chunks).
- Run each fixture in the canonical Terrain Editor and the running
  game; record observed behaviour (renders both, renders one,
  refuses-to-load, crashes).
- Close MT-5 *and* answer the broader question with a single
  DEVELOPMENT_LOG / ROADMAP update — outcome decides which.

**Out of scope (and why):**
- *Editor format change.* If the engine supports >1 life-child, the
  format / editor extension is a follow-on roadmap item, not part of
  this investigation. The plan stops at "yes, the engine takes it" —
  shipping the editor change is a separate scoped effort.
- *Behavioural deep-dive on death-children.* The user's stated
  interest is on-lifetime. We'll record what we incidentally learn
  about `spawnOnDeath` parsing (since it sits in the same `0x36`
  block) but won't separately probe its limits.
- *Anti-tamper / Steam validation tests.* All work is read-only on
  the game binary. Fixtures load via mod folders, not the base game
  install.
- *Patching the engine.* Not a route we'd take even if Q1–Q3
  diverge unfavourably.

**Outcome paths (decided after investigation):**

| Q1 (parser)             | Q2 (struct)        | Q3 (spawn)       | What we do                                                                                                                                          |
| ----------------------- | ------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accepts multiple `0x39` | List / array       | Iterates         | **Best case.** MT-5 expands: file new ROADMAP item to extend the on-disk schema, editor UI, and round-trip to N children. MT-5 closes as a confirm step. |
| Accepts only one        | Single index       | Single ref       | **Worst case.** Engine is hardwired to one. MT-5 closes as "both slots verified, multi-child not supported by the engine." Document workaround paths. |
| Mixed (parser tolerates, runtime ignores extras) | Single index | Single ref | **Latent / dead.** Closes the same as worst case, but we record the parser quirk so a future implementer doesn't get false hope from a hex-edit test. |

Each path resolves MT-5 + the user's broader question in one update.

---

## 2. What the codebase already gives us

The editor's own implementation tells us exactly what the binary's
analogue should look like, which makes the Ghidra search dramatically
easier.

- **Chunk shape.** The .alo emitter's spawn-link block is chunk
  `0x36`, containing two mini-chunks: `0x37` (spawnOnDeath, int32) and
  `0x39` (spawnDuringLife, int32). Written at
  [src/ParticleSystem.cpp:277](src/ParticleSystem.cpp:277). Read back
  at [src/ParticleSystem.cpp:474](src/ParticleSystem.cpp:474). The
  editor's reader asserts the order is exactly `0x37` then `0x39` then
  end-of-chunk — that's the editor being strict; the game may be
  looser. Whether the game is strict, lenient-with-overwrite, or
  lenient-with-list is precisely Q1.

- **Runtime model in the editor.** `Emitter::spawnDuringLife` is a
  single `size_t` index ([src/ParticleSystem.h:121](src/ParticleSystem.h:121)),
  and at spawn time `EmitterInstance::EmitParticle` stores one
  `m_childEmitter` pointer per particle
  ([src/EmitterInstance.cpp:333](src/EmitterInstance.cpp:333)). So the
  editor is strictly one-child. The Ghidra question is whether the
  game shares the same constraint or whether the editor is artificially
  narrowing what the engine accepts.

- **Sentinel value.** `0xFFFFFFFF` means "no child"
  ([src/ParticleSystem.cpp:477-478](src/ParticleSystem.cpp:477)).
  Useful for static analysis — if we see `cmp …, 0xFFFFFFFF` near the
  `0x36` block parser, we've found the right code.

- **Default texture names** like `p_particle_master.tga` and
  `p_particle_depth_master.tga`
  ([src/ParticleSystem.cpp:543-544](src/ParticleSystem.cpp:543)) are
  potentially-grep-able strings in the binary if the game's parser has
  defaults for missing fields. Backup anchor only — we expect chunk-ID
  immediates and the `0xFFFFFFFF` sentinel to be enough.

- **Ghidra tooling already in place** from MT-6's `BLOOM_BLUR_ITERATIONS`
  investigation:
  - `C:\Tools\jdk-21.0.11+10` (Adoptium Temurin JDK 21)
  - `C:\Tools\ghidra_12.0.4_PUBLIC` (Ghidra 12.0.4)
  - `tasks/ghidra_project/BloomRE` — `EAW Terrain Editor.exe`
    imported and auto-analysed (~11 min, one-time). `StarWarsG.exe`
    was also analysed in that project for cross-validation.
  - `analyzeHeadless -process -noanalysis` rerun pattern proven (see
    [tasks/find_bloom_iterations.md:300](tasks/find_bloom_iterations.md:300)).

  We can reuse the same project — add a new Jython script alongside
  the existing four (`FindBloomLoop.py` etc.) under
  [tasks/ghidra_scripts/](tasks/ghidra_scripts).

- **Known binary anchors that survived MT-6:** chunk IDs as int32
  immediates appear in the parser dispatch path. `Engine\SceneBloom`
  is a defined-strings hit. For this investigation we'll search
  defined-strings for any particle-system literals that might exist
  (e.g. shader effect names referenced in `.alo` writes — exact set
  is TBD by the data search).

---

## 3. Investigation approach

Static analysis first, fixture-driven empirical confirmation second.
The bloom precedent (a single immediate answered the entire question)
is the bull case; the bear case is "parser is a switch table indexed
by chunk ID with a single store per ID," which is also a clean answer
just from reading the decompilation.

### Step 1 — Locate the chunk-`0x36` parser

Two viable entry points; whichever lands the parser function faster
wins:

1. **Chunk-ID immediate search.** Search for the byte pattern
   `36 00 00 00` and `37 00 00 00` and `39 00 00 00` in proximity to
   each other within the `.text` section. The combination is rare;
   the parser-dispatch site should be one of very few hits. Ghidra's
   `findBytes` over the program's executable memory + a small Jython
   filter that checks "do `0x37` and `0x39` both appear within ±N
   bytes" should narrow it to one or two candidates.

2. **Default-texture anchor.** Strings like `p_particle_master.tga`
   are likely-but-not-guaranteed to exist in the binary if the
   parser has default fallbacks. Cross-reference the string to the
   function that reads emitter property chunks; from there the
   `0x36` block is a downstream switch case.

Backup: search for the `0xFFFFFFFF` sentinel near the `0x36`-related
code (it's how the parser distinguishes "no child" from "valid
index", same as our reader at
[src/ParticleSystem.cpp:477](src/ParticleSystem.cpp:477)).

### Step 2 — Decompile the spawn-link block parser

Once the function is found, the decompilation should answer Q1
directly:

- **Single overwrite:** something like `while (mini = next_mini(),
  mini != END) { switch (mini.id) { case 0x37: emitter->onDeath =
  read_i32(); break; case 0x39: emitter->onLife = read_i32(); break;
  } }`. Multiple `0x39` chunks would each overwrite the previous —
  the *last one wins* and there's no list at all.

- **List-append:** something like `case 0x39: emitter->onLifeList.push(...)`,
  or a fixed-size array with an index that increments. This is the
  bull case — the runtime data model is already a collection.

- **Strict-one:** the parser may `Verify(reader.nextMini() == 0x37);
  …; Verify(reader.nextMini() == 0x39); …; Verify(reader.nextMini() ==
  END);` mirroring the editor exactly. Multiple `0x39`s would trip the
  verify and the file would fail to load.

### Step 3 — Inspect the emitter runtime struct (answers Q2)

Whatever field `case 0x39:` writes to, walk its consumers. If it's a
single `int32` member offset, Q2 = single index. If it's a pointer
into a buffer (e.g. `*(int *)(emitter + 0x140 + 4 * count++)`), Q2 =
array. If it's a linked-list `push`, Q2 = list. The decompiler usually
makes this very obvious.

### Step 4 — Find the spawn site (answers Q3)

At particle-emit time, the engine reads that field. Find the function
that allocates / initialises a particle and look at how it consumes the
during-life child reference. Single `if (child != -1) spawn_child(child)`
mirrors our editor at
[src/EmitterInstance.cpp:333](src/EmitterInstance.cpp:333). A
`for/while` loop over a collection is Q3 = iterates.

### Step 5 — Cross-validate `EAW Terrain Editor.exe`

Same script, same anchors. Confirm the answers match. If they don't,
the Terrain Editor's answer is the calibration target (it's what
mod authors will compare against). Document any divergence.

### Step 6 — Empirical fixtures

Independent of what static analysis says, build the fixtures and
verify the answers visually:

1. **`fixtures/two_slots.alo`** — one parent emitter with `0x36`
   containing `0x37` (death child index N) *and* `0x39` (life child
   index M). Resolves MT-5's narrow question (the two slots coexist).

2. **`fixtures/two_life_chunks.alo`** — hand-crafted (hex-edited) one
   parent with `0x36` containing two `0x39` mini-chunks pointing at
   different child indices. This is the file that distinguishes
   "list-append" from "last-wins" from "hard-fail" in runtime: load
   it in the canonical Terrain Editor and the running game and see
   what happens.

   If we can't load it (hard-fail), parser rejects multi. If only
   one child renders, parser overwrites. If both render, parser is
   actually a list-builder and we've found our answer.

3. **`fixtures/duplicated_parent.alo`** — workaround mockup: two
   identical parent emitters, each pointing at a different life
   child. Useful only as a "current best workaround" reference if
   the engine can't be coaxed into native multi-child support.

Each fixture loads in:
- Our editor (should round-trip the simple cases; should reject /
  truncate the hand-crafted multi-`0x39` one in its strict reader,
  but that's the editor being narrow, not the engine).
- The canonical Terrain Editor (the ground truth).
- The actual game (load a saved game / map that references the
  particle, or use a probe-emitter trigger if available — fall back
  to "Terrain Editor agrees" if game-side testing is too expensive).

### Time budget

- Steps 1–4 (Ghidra work): 2 hours, time-boxed. Bloom investigation
  was 1 hour of script work over 11 min of analysis; this is a
  little harder because there's no unique anchor string, but the
  chunk-ID byte search is well-defined.
- Step 5 (cross-validate): 30 minutes.
- Step 6 (fixtures): 30 minutes for the simple two-slot file,
  60 minutes for the hand-crafted two-`0x39` file (needs a tiny
  hex-edit script — `tasks/dump_alo_rotation.ps1` is a useful prior
  reference). Total 1.5 hours.
- Writeup (DEVELOPMENT_LOG, ROADMAP update, possible new ROADMAP item):
  30 minutes.

Total target: 4–5 hours. Falls back to "fixtures only, no
disassembly" if Ghidra stalls past 2 hours.

---

## 4. Risks named up front + mitigations

1. **No unique string anchor.** Unlike `BloomIteration`, chunk parsers
   don't usually carry human-readable strings. We're anchoring on
   immediate-byte patterns (`36 00 00 00` near `37 00 00 00` near
   `39 00 00 00`). *Mitigation:* the three-chunk-ID-near-each-other
   constraint is highly specific — chunk IDs are usually only emitted
   at the call site of `nextMini` comparators, and the trio appearing
   within a ~200-byte window is essentially unique to the spawn-link
   parser. If it isn't, fall back to the `0xFFFFFFFF` sentinel cross-
   reference or to default-texture string anchors.

2. **The chunk parser is generated / inlined / table-driven.** If the
   game generates parsers via macro or jump table, the decompilation
   may show a function table indexed by chunk ID rather than a clean
   `switch`. *Mitigation:* walk the table entry for ID `0x39` to its
   handler function — the handler still has to write somewhere, and
   that "somewhere" answers Q2 directly.

3. **The runtime field could be a "single index that survives the
   parse" but the parser permits multiple writes (last-wins).**
   Plausible. *Mitigation:* the empirical fixture (two `0x39`s with
   different child indices) distinguishes this from "list-append"
   visually — last-wins shows one child; list-append shows both.

4. **The hand-crafted multi-`0x39` file is rejected by both editor
   and game because some upstream length / checksum field
   disagrees.** The `.alo` chunk format uses size headers; extending
   a `0x36` block requires updating its parent chunk's size too.
   *Mitigation:* the file is hex-edited from a known-good fixture
   with all sizes recomputed. The chunk-writer code in
   [src/ParticleSystem.cpp:277](src/ParticleSystem.cpp:277) is a
   reference for the exact bytes to emit; better still, write the
   modified fixture programmatically with the editor's own
   `ChunkWriter` rather than hex-editing. (Add a tiny one-off test
   that opens a `.alo`, surgically inserts a second `0x39` mini-chunk,
   re-emits with correct sizes, writes out.)

5. **The "real" multi-child workflow is via a different mechanism
   entirely** — e.g. emitter A's life-child B is itself an emitter
   that emits a *third* type of particle, giving compound emission
   without literal multi-child slots. *Mitigation:* the investigation
   should explicitly check (and document, regardless of outcome) the
   chain workaround — it's the user's fallback option if the engine
   really is one-life-child.

6. **Anti-tamper / Steam revalidation on hand-crafted fixtures.**
   Loading mod-folder `.alo` files is normal modding flow and not
   tampering. *Mitigation:* never write into the base game install —
   fixtures load via Chelmod or a scratch mod folder, same as the
   user's existing workflow.

7. **Time-budget overrun on Ghidra.** *Mitigation:* same as bloom —
   time-box at 2 hours for the disassembly portion. If we can't
   localise the parser in that window, fall through to fixtures-only
   ("the engine renders / doesn't render this fixture; we can't say
   what would happen with a different one"). That's a weaker answer
   but still actionable for MT-5 specifically.

---

## 5. Testing & verification

**Static-analysis success criteria:**
- A new Jython script at `tasks/ghidra_scripts/FindEmitterChunkParser.py`
  (committed) locates the chunk-`0x36` parser in both
  `EAW Terrain Editor.exe` and `StarWarsG.exe`.
- The script prints (or the manual decompilation reveals) the answer
  to Q1, Q2, Q3 in one to two sentences each.
- Q1–Q3 agree between the two binaries (or, if not, the divergence
  is documented in the writeup).

**Fixture success criteria:**
- `fixtures/two_slots.alo` loads in our editor, the canonical Terrain
  Editor, and renders correctly in-game (or as close as we can get to
  in-game testing).
- `fixtures/two_life_chunks.alo` is constructed correctly (all chunk
  sizes recompute; opens in a hex viewer and shows the two `0x39`
  mini-chunks under one `0x36`). Behaviour under the canonical
  Terrain Editor is recorded: loads-with-warning / refuses-to-load /
  silently-truncates / renders-both.
- If `fixtures/duplicated_parent.alo` is built, it demonstrates the
  workaround visually (two on-life children rendering off the same
  conceptual parent).

**Happy-path edge cases:**
- Empty `0x36` block (neither `0x37` nor `0x39` present) — does the
  game treat this as "no children" cleanly, or does it require both
  slots populated with sentinel `0xFFFFFFFF`?
- Self-referential child (`spawnDuringLife` points at the parent's
  own index) — the editor permits this; does the game crash, infinite-
  loop, or detect-and-skip? (Strictly speaking out of MT-5's scope,
  but it's a free finding from the same investigation.)

**Documentation deliverables:**
- This file gets a `## Review` section at the bottom on completion,
  matching `tasks/find_bloom_iterations.md`'s structure (outcome,
  how-we-found-it, risks revisited).
- DEVELOPMENT_LOG entry describes outcome path (best / worst / latent) and
  what shipped — either fixture files + MT-5 closure, or fixture
  files + MT-5 closure + a new ROADMAP entry for the format
  extension.
- ROADMAP update: MT-5 strikethrough + Shipped move, plus a new
  follow-on entry if the engine turns out to support >1 life child.
- One-line provenance comment in `ParticleSystem.h` next to the
  `spawnDuringLife` field citing the binary evidence ("`StarWarsG.exe`
  parser at `FUN_…`: single-write, runtime field is `int32`, no list").

**Lessons (only if user corrections happen):**
- Append to `tasks/lessons.md` (already exists from earlier work).

---

## Pre-commit check-in

Before doing any of this, two open questions for the user:

1. **Is the user OK accepting "Terrain Editor agrees" as ground truth
   if game-side `StarWarsG.exe` testing turns out to be inconvenient
   to set up (needing a saveable scenario that triggers the
   particle)?** Bloom precedent says yes — Terrain Editor is the
   calibration target — but worth confirming.
2. **If the engine turns out to support >1 life child, does the user
   want the format / editor extension queued as a new ROADMAP entry,
   or is the existence answer alone enough to close this thread?**
   Affects the size of the "writeup" step.

User confirmed yes to both, 2026-05-11.

---

## Review

**Outcome.** The Petroglyph engine runtime supports **exactly one
on-lifetime child and exactly one on-death child per emitter**, full
stop. >1 on-lifetime child is **not** representable in the runtime
struct, regardless of how the file format or editor surface might
otherwise be coaxed. Three independent disassembly anchors confirm
this; binary cross-validates byte-identically between
`EAW Terrain Editor.exe` and `StarWarsG.exe`. MT-5 closes as the
"worst case" path from the plan; no new format-extension ROADMAP entry
is filed.

**How we found it.**

1. **Imported `EAW Terrain Editor.exe` into Ghidra 12.0.4** (~11 min
   auto-analysis), reusing the JDK + Ghidra install from MT-6. Then
   ran [`FindEmitterChunkParser.py`](ghidra_scripts/FindEmitterChunkParser.py),
   which scans every function for usages of `0x37` and `0x39` as
   immediate scalars and scores each candidate by also-contains
   `0x36` and `0xFFFFFFFF`. Three score=6 candidates emerged at sizes
   1496 / 2719 / 2968 bytes; the two smaller hits were unrelated
   (XML-ish serializer using `0x36`/`0x37`/`0x39` as ASCII tags, and a
   Win32 virtual-key-code mapping table indexed `VK_0` … `VK_9`).

2. **Identified the emitter writer at
   `FUN_140134b50`** (the 2968-byte score=6 candidate). The function
   is byte-for-byte equivalent to our editor's
   [src/ParticleSystem.cpp:277](src/ParticleSystem.cpp:277), and the
   critical block reads:
   ```c
   FUN_140161e40(writer, 0x36);                  // beginChunk(0x36)
   lVar1 = *(longlong*)(emitter_data + 0x1108);  // load deathChild*
   uVar3 = (lVar1 == 0) ? 0xFFFFFFFF
                        : *(uint32_t*)(lVar1 + 0x410);  // child->index
   *(uint32_t*)(param_1 + 600) = uVar3;
   lVar1 = *(longlong*)(emitter_data + 0x1110);  // load lifeChild*
   uVar4 = (lVar1 == 0) ? 0xFFFFFFFF
                        : *(uint32_t*)(lVar1 + 0x410);  // child->index
   *(uint32_t*)(param_1 + 0x25c) = uVar4;
   FUN_140161fc0(writer, 0x37);                  // mini-chunk 0x37
   FUN_1401620d0(writer, &param_1[600], 4);
   FUN_140162050(writer);
   FUN_140161fc0(writer, 0x39);                  // mini-chunk 0x39
   FUN_1401620d0(writer, &param_1[0x25c], 4);
   FUN_140162050(writer);
   FUN_140161ed0(writer);                        // endChunk
   ```
   The runtime emitter struct holds the two child slots at
   **`emitter + 0x1108`** (deathChild, single 8-byte pointer) and
   **`emitter + 0x1110`** (lifeChild, single 8-byte pointer,
   immediately adjacent). No vector, no count, no array — two single
   pointer fields, full stop. **This is the conclusive answer to Q2.**

3. **Cross-validated against `StarWarsG.exe`**. Same headless import
   pattern; same script. The matching writer is
   **`FUN_14015ed60`** (also 2968 bytes — byte-identical size).
   Same internal shape: same `+0x1108` / `+0x1110` slots, same
   `0xFFFFFFFF` sentinel branches, same mini-chunk emission order.
   Both binaries are clearly compiled from the same engine source
   (same conclusion the bloom investigation reached at
   [tasks/find_bloom_iterations.md:259](find_bloom_iterations.md:259)).

4. **Confirmed Q3 (single read at spawn time) by xref search.**
   [`FindLifeChildXrefs.py`](ghidra_scripts/FindLifeChildXrefs.py)
   walked every Terrain Editor function for instructions whose
   immediate displacement matches `0x1108` or `0x1110`. 43 functions
   touch the slots; none touch them more than 7 times, and none in a
   pattern consistent with array iteration. The smallest example,
   **`FUN_1401372d0`** (47 bytes — a get-child-by-kind helper):
   ```c
   uint64_t FUN_1401372d0(longlong emitter, int kind) {
       if (kind == 1) return *(uint64_t*)(emitter_data + 0x1108); // death
       if (kind == 2) return *(uint64_t*)(emitter_data + 0x1110); // life
       return 0;
   }
   ```
   The deserializer-backfill (`FUN_140136200`), recursive visibility
   toggle (`FUN_140139e00`), and clone-constructor (`FUN_140138770`)
   all dereference each slot exactly once per call. **There is no
   "for each life-child" loop anywhere in the binary.**

5. **Q1 (parser semantics for duplicate `0x39` mini-chunks) was not
   investigated past this point** because Q2's answer makes it
   academic: even if the parser were lenient enough to accept two
   `0x39` mini-chunks, the runtime can only retain one pointer in the
   single 8-byte slot at offset `0x1110`. The second write would
   overwrite the first. The hand-crafted dual-`0x39` fixture was
   therefore not built — it would test a code path whose runtime
   output is already determined by the struct layout.

**Why the answer comes from the writer rather than the reader.** The
writer is the cleanest single-function evidence we'll find for the
struct layout: it emits one mini-chunk per slot from one specific
struct offset per slot. The reader would also be informative, but its
shape is determined by Q2's already-conclusive answer. Saved ~2 hours
of disassembly chasing for no incremental certainty.

**Risks revisited.**

1. *No unique string anchor* — correct. The byte-pattern triple
   `0x36`/`0x37`/`0x39` + `0xFFFFFFFF` sentinel anchor produced
   3 score=6 candidates; the writer was the largest (2968 bytes), and
   the other two were ruled out by inspection in under a minute each.
2. *Generated / inlined / table-driven parser* — not encountered. The
   writer is a flat sequence of `beginMini` / `write` / `endMini`
   calls, mirroring `src/ParticleSystem.cpp`.
3. *Last-wins vs list-append parser quirk* — moot, per Q2.
4. *Hand-crafted fixture has wrong chunk sizes* — sidestepped; no
   fixture needed.
5. *Workflow via different mechanism (chain emitters)* — chain is the
   recorded workaround. See **Workarounds** below.
6. *Anti-tamper* — not encountered (all RE was read-only).
7. *Ghidra time budget* — auto-analysis ~11 min per binary
   (one-time); subsequent script runs (`-process -noanalysis`) take
   seconds.

**Workarounds for users wanting >1 conceptual life-child.**

- **Chain emitters.** Parent `A` → life child `B` → life child `C` →
  … . Each link is the standard one-life-child relationship. Net
  effect: A's particles each emit B's particles, which each emit C's
  particles. Not identical to "A has children {B, C} firing in
  parallel," but achieves compound emission. Modest performance cost
  per chain link.

- **Duplicate the parent.** Two emitter blocks at the same world
  position with the same lifetime / spawn parameters; one pointing at
  life child `B`, the other at life child `C`. Both fire on the same
  cadence. Doubles parent particle count and per-frame draw calls but
  achieves the closest visual equivalent to "two life children" at
  the cost of memory and pipeline pressure.

- **Death-channel + life-channel together.** This is the *standard*
  way of having "two children" — one `spawnDuringLife` and one
  `spawnOnDeath`, both populated. The engine handles this case
  natively (the two slots are independent fields), and this is the
  case MT-5 originally scoped. Our editor already supports authoring
  this configuration; the two slots simply have different temporal
  semantics. See `tasks/lessons.md` if needed for future authoring
  guidance.

**MT-5 closure plan.**

- **MT-5 ships** with the two-slot case re-confirmed by binary
  evidence; the on-disk format + runtime data structure verifiably
  give every emitter both a `spawnOnDeath` and a `spawnDuringLife`
  slot as independent fields. Our editor already permits this case
  (no UI change needed — the two child types live under separate
  menu items).
- **No new ROADMAP entry** for native >1 life-child support is filed.
  The engine doesn't support it; coaxing the file format alone would
  produce files that load in our editor but render only one child
  in-game (or last-wins / hard-fail, depending on Q1's exact answer).
  Not a path worth taking.
- **One-line provenance comment** added next to `spawnDuringLife` in
  `src/ParticleSystem.h` citing the binary evidence.
- **DEVELOPMENT_LOG entry** records the investigation outcome.

**Tooling produced this round (committed alongside the bloom RE
artefacts).**

- [`tasks/ghidra_scripts/FindEmitterChunkParser.py`](ghidra_scripts/FindEmitterChunkParser.py) —
  byte-pattern anchor scan that finds the chunk-0x36 writer/reader
  via co-occurrence of `0x37`/`0x39`/`0x36`/`0xFFFFFFFF` as scalar
  immediates within a single function.
- [`tasks/ghidra_scripts/FindLifeChildXrefs.py`](ghidra_scripts/FindLifeChildXrefs.py) —
  struct-offset xref scan locating every function whose instruction
  stream addresses `emitter + 0x1108` or `emitter + 0x1110`. Used to
  confirm no spawn-site iterates a list.
- [`tasks/build_dual_life_fixture.py`](build_dual_life_fixture.py) —
  built but **not run** (made moot by Q2's answer). Kept in tree as
  future reference for any "I want to test a malformed-multi-mini
  fixture" investigation.

**Manual test items.** None outstanding. The conclusion is a
binary-level invariant of the engine; no in-game test could
contradict it short of patching the engine.
