# Slot 1 — Master-side P1s (F1–F5)

Per `tasks/post-audit-followups.md` "Suggested ordering" step 1. One
focused PR against `master` bundling five correctness fixes that
survived first-party verification on master tip `b28f624`.

## 1. Goal + scope

**Goal.** Ship the five master-side P1 correctness fixes from the
post-audit followups doc as a single coherent PR. Each is small (5–40
LoC) and isolated to one or two files. Together they close real bugs
in: (a) save-on-failure data loss, (b) `.alo` parser memory safety on
malformed input (two flavours), (c) cyclic emitter graph crashes on
load, (d) 16-bit particle-index wrap producing wrong rendering at
extreme particle counts.

**In scope (this PR):**
- F1 — `DoSaveFile` clears dirty + deletes autosave on failure.
- F2 — `ChunkReader::readString()` heap over-read (no NUL handling).
- F3 — `ChunkReader::next()` / `ChunkWriter::beginChunk()` depth overflow.
- F4 — Cyclic / multi-parent emitter graphs accepted by loader.
- F5 — `uint16_t` particle-index wrap (no cap on allocation).

**Out of scope (deferred to other slots):**
- Adjacent cleanups in `main.cpp` (Slot 4: F12 `WM_PAINT`, F13 leaks, etc.).
- Architectural splits (`main.cpp` monolith, `ParticleSystem.cpp` split).
- `lt-4`-only items (Slots 2, 3, 5, 6).
- Style nits (`toupper`/`tolower` casts, `AboutProc` precedence, etc.).
- LT-4 work; this PR targets `master` directly.

## 2. What the codebase already gives us

| Fix | Existing infra we lean on | File:line |
|---|---|---|
| F1 | `SetFileChanged`, `UndoStack::MarkSaved`, `Autosave::DeleteOurSession` are already idempotent. `wexception` is the only thrown type from `ParticleSystem::write`. | [src/main.cpp:1359-1388](src/main.cpp:1359) |
| F2 | `ChunkReader::read()` already validates exact-byte. `ReadException` exists in `exceptions.h:44`. `std::string` is contiguous since C++11. | [src/ChunkReader.cpp:90-106](src/ChunkReader.cpp:90) |
| F3 | `MAX_CHUNK_DEPTH = 256` constant defined in `ChunkFile.h:27,51`. `ReadException` (reader) and `WriteException` (writer) both exist. | [src/ChunkReader.cpp:65](src/ChunkReader.cpp:65), [src/ChunkWriter.cpp:8](src/ChunkWriter.cpp:8) |
| F4 | Existing range-clearing loop at [src/ParticleSystem.cpp:1071-1090](src/ParticleSystem.cpp:1071) is the right insertion point. `BadFileException` exists in `exceptions.h:56`. `m_emitters` is `std::vector<Emitter*>`. | Same |
| F5 | `NUM_VERTICES_PER_PARTICLE = 4` constant ([src/EmitterInstance.h:7](src/EmitterInstance.h:7)). `AllocateParticle()` is the single allocation chokepoint at [src/EmitterInstance.cpp:133-156](src/EmitterInstance.cpp:133). | Same |

## 3. Architecture / implementation approach

### F1 — gate cleanup on save success

Track success with a local `bool saved`. Move the file `Release()` to a
single site (was duplicated across try/catch). Make `SetFileChanged`,
`MarkSaved`, `UpdateUndoRedoUI`, `DeleteOurSession`, and the return
value conditional on `saved`. Failure path leaves dirty marker intact,
preserves autosave, returns `false` to `DoCheckChanges` so the close-
without-save dialog re-prompts.

```cpp
bool saved = false;
PhysicalFile* file = new PhysicalFile(info->filename, PhysicalFile::WRITE);
try {
    // ... name computation + write ...
    info->particleSystem->write(file);
    saved = true;
} catch (wexception& e) {
    MessageBox(...);
}
file->Release();

if (saved) {
    SetFileChanged(info, false);
    info->undoStack.MarkSaved();
    UpdateUndoRedoUI(info);
    Autosave::DeleteOurSession();
}
return saved;
```

### F2 — length-bounded `readString`

Replace the `new char[size()]` + `str = data` C-string conversion with
direct construction into a `std::string` sized to the chunk byte count,
followed by trim-at-first-NUL. Zero-length chunks return empty.
Negative chunk sizes (shouldn't happen post-mask but defensive) throw.

```cpp
string ChunkReader::readString() {
    long s = size();
    if (s < 0) throw ReadException();
    if (s == 0) return string();
    string str((size_t)s, '\0');
    read(&str[0], s);
    size_t nulPos = str.find('\0');
    if (nulPos != string::npos) str.resize(nulPos);
    return str;
}
```

### F3 — depth guards

Add a guard before each `++m_curDepth` site. Reader throws
`ReadException` (malformed input). Writer throws `WriteException`
(writer-bug case; should be unreachable for well-formed editor data,
but assert-equivalent under release).

```cpp
// ChunkReader::next, before m_offsets[++m_curDepth]:
if (m_curDepth + 1 >= MAX_CHUNK_DEPTH) throw ReadException();

// ChunkWriter::beginChunk, before m_curDepth++:
if (m_curDepth + 1 >= MAX_CHUNK_DEPTH) throw WriteException();
```

### F4 — `validateEmitterGraph()`

New private method on `ParticleSystem`. Three checks, in order:
1. **Self-link:** any `emitter[i].spawnOnDeath == i` or `spawnDuringLife == i` → throw.
2. **Multi-parent:** count how many parents claim each child; any
   count > 1 → throw.
3. **Cycle:** with single-parent validated, every node must be
   reachable from a root (a node with parentCount == 0). DFS from
   each root, mark visited; any unvisited node after all root-DFSes
   is part of a disconnected cycle → throw.

All failure paths throw `BadFileException` (semantic match: file is
structurally malformed). Insert call between the existing range-
clearing loop and the parent-pointer assignment loop at
[src/ParticleSystem.cpp:1090](src/ParticleSystem.cpp:1090). Splitting
the existing single loop into two cleanly accommodates the validate
call between them.

Declaration goes in `ParticleSystem.h` next to other private helpers.

### F5 — particle index cap

Cap allocation in `AllocateParticle()` before creating a new
`ParticleBlock`. Computed as `(UINT16_MAX + 1) / NUM_VERTICES_PER_PARTICLE`
= 16384 with current constants. Refused beyond cap by throwing
`std::runtime_error` — propagates out through `SpawnParticle` →
`Update` and is logged in debug builds.

Throwing is not as graceful as the audit's "soft refuse" suggestion,
but graceful refuse would require changing `AllocateParticle`'s return
type from reference to pointer (invasive, violates surgical-changes
rule). The throw still beats the alternative (silent corruption that
renders wrong geometry) — a user hitting 16k particles in one emitter
has bigger problems than the exception, and the cap is well above any
typical particle effect.

```cpp
if (particle == NULL) {
    const size_t maxParticles = (size_t)(UINT16_MAX + 1) / NUM_VERTICES_PER_PARTICLE;
    if (m_primitives.capacity() >= maxParticles) {
        #ifndef NDEBUG
        printf("[EmitterInstance] particle cap (%zu) reached; refusing further spawns\n", maxParticles);
        fflush(stdout);
        #endif
        throw std::runtime_error("EmitterInstance: particle cap reached");
    }
    // ... existing block allocation ...
}
```

## 4. Risks named up front + mitigations

1. **F1 changes `DoSaveFile`'s return-value semantics.** Today the
   function returns `true` unconditionally; after the fix it returns
   `saved`. The only caller that uses the return value is
   `DoCheckChanges` at `main.cpp:1399`, which interprets `true` as
   "OK to close." Today, a failed save still allows close (compounding
   the data loss). After the fix, failed save → return false → user
   gets the save prompt again. This is a behavioral change but in the
   safer direction; surgical scope captured.

2. **F2's NUL-trimming may differ from prior behavior for strings
   that happen to contain embedded NULs.** Prior code's `str = data`
   silently truncated at the first NUL anyway (C-string semantics),
   so post-fix behavior matches prior behavior for well-formed input.
   Mitigation: regression-test by loading a known-good `.alo` and
   confirming emitter/texture names round-trip identically.

3. **F3's `MAX_CHUNK_DEPTH = 256` cap is well above legal `.alo`
   nesting (typical files top out at ~6-8 deep).** Risk of legitimate
   files hitting the cap is essentially zero. Mitigation: regression-
   test against a real `.alo` corpus before merge.

4. **F4's validation rejects files the editor itself wrote in the
   past if those files contained graph violations.** No known cases of
   the editor producing such files, but a file edited by an external
   tool or an old buggy version of the editor could theoretically have
   them. The existing range-clearing logic at [src/ParticleSystem.cpp:1075-1086](src/ParticleSystem.cpp:1075)
   already silently fixes some classes of corruption (out-of-range
   spawn indices). F4 makes structural corruption a hard reject
   instead. Accepted tradeoff: hard reject is better than corrupt
   graph crashing the editor downstream.

5. **F5's throw can unwind out of the engine update path.** Real but
   limited — only triggers above 16,383 particles per emitter, which
   is a 4× safety margin over the largest legitimate use case I can
   imagine. The throw is logged in debug builds so we can correlate.
   Mitigation: if a real user hits this, the soft-refuse refactor
   (change AllocateParticle to pointer return) becomes a follow-up.

6. **MSBuild availability.** The CLAUDE.md "Pre-handoff testing"
   rule requires a clean build before handoff. If MSBuild can't run
   from this harness, hit the "build/test infrastructure issue" stop
   condition immediately. Mitigation: probe early.

## 5. Testing & verification

### Build
- [ ] MSBuild Release|x64 clean (no new warnings).
- [ ] MSBuild Debug|x64 clean.

### Manual smoke (load + save)
- [ ] Launch editor, load a real `.alo` from the user's library.
- [ ] Confirm all emitters / textures / track names display correctly
      (validates F2's NUL-trimming didn't change observable behaviour).
- [ ] Save to a new file; reload; confirm round-trip identity.

### F1 specific
- [ ] Set the `.alo` file to read-only on disk, try to save → expect
      error MessageBox + dirty marker intact (title bar still shows
      modified indicator) + autosave file still present in `%TEMP%\
      AloParticleEditor\`. Close without save → expect re-prompt.

### F2/F3 specific
- [ ] No bundled malformed-`.alo` fuzz corpus to test against yet. The
      regression test is "real `.alo` files still load." Adversarial-
      input testing is queued as part of the architecture-section
      "test coverage narrow" follow-up (see followups doc).

### F4 specific
- [ ] Same as F2/F3 — without a malformed-input corpus, validation is
      "real files still load." A craft-an-`.alo`-with-self-link smoke
      would be ideal but is out of scope for this PR.

### F5 specific
- [ ] Untestable interactively without a 16k-particle emitter setup;
      audit-from-code is the bar. Debug-build log line gives runtime
      visibility if it ever triggers.

### Repo hygiene
- [ ] `git status` clean after commit.
- [ ] PR title + body match recent master commit conventions
      (`fix:` / `feat:` prefixes, short title under 70 chars).

---

## Review section

**What landed.** Five fixes across six files, ~154 LoC added / 29 removed:

| Fix | File(s) | LoC delta | Shape |
|---|---|---|---|
| F1 | src/main.cpp | +20 / -10 | `bool saved` gate around dirty/undo/autosave cleanup; return value now `saved` |
| F2 | src/ChunkReader.cpp | +18 / -10 | length-bounded `std::string`, NUL-trim, throws on negative size |
| F3a | src/ChunkReader.cpp | +5 | depth guard in `next()`, throws `ReadException` |
| F3b | src/ChunkWriter.cpp | +6 | depth guard in `beginChunk()`, throws `WriteException` |
| F4 | src/ParticleSystem.h, .cpp | +66 / -2 | new `validateEmitterGraph()` private method; load-time loop split |
| F5 | src/EmitterInstance.cpp | +18 | particle-count cap in `AllocateParticle()`; `#include <stdexcept>` |

**Build verification.** Both configurations clean:
- MSBuild Debug|x64 — clean (pre-existing LNK4098 LIBCMTD warning unchanged, documented in HANDOFF.md as expected)
- MSBuild Release|x64 — clean (same)
- All 28 source files compile (expat sub-project + ParticleEditor.vcxproj)

**Deviations from the plan.**
- None. Implementation matches the architecture section verbatim. The F4 method body uses iterative DFS as planned (stack-based, not recursive) to avoid blowing the C stack on adversarial cycles.

**What I couldn't verify autonomously.**
- **Interactive load/save round-trip** (F1, F2). Requires launching the editor and: (a) reading a real `.alo` from the user's library, (b) confirming all emitter/texture/track names display correctly, (c) saving + reloading + confirming identity, (d) setting a target file read-only and confirming the failed-save path leaves the dirty marker + autosave intact. The build clean is necessary but not sufficient — the user should exercise these before merge.
- **Adversarial-input regression** (F2, F3, F4). No malformed-`.alo` fuzz corpus exists in the repo. Each guard is correct by inspection but the "real attacker input" lane is untested. Queued as part of the "test coverage narrow" architectural follow-up in `tasks/post-audit-followups.md`.
- **F5 cap trigger.** Requires a 16k-particle emitter setup that the editor's authoring UI doesn't easily produce; the `#ifndef NDEBUG` log line gives runtime visibility if it ever fires in practice.
- **No automated test suite covers these subsystems.** The repo's `tests/` directory only contains `test_palette_store.cpp`, which doesn't exercise ChunkReader / ParticleSystem / EmitterInstance / DoSaveFile. Build clean is the regression bar for this PR.

**Confidence.** High on F1, F2, F3, F4 — implementations are straightforward and the architecture decisions were unambiguous. Medium-high on F5 — the throw-on-cap behaviour is sub-graceful (audit suggested "soft refuse"), but graceful refuse would require changing `AllocateParticle()`'s return type from reference to pointer, which violates the surgical-changes rule for this PR. If a real user hits the cap, follow-up can refactor `AllocateParticle` and `SpawnParticle` jointly.

**Cross-references.**
- Followups doc: [tasks/post-audit-followups.md](post-audit-followups.md) F1–F5.
- Verification protocol: [tasks/lessons.md L-018](lessons.md).
- Master tip at audit time: `b28f624`. Slot branch: `post-audit/master-p1s`.
