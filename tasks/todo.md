# Audit P1 fixes (F1–F5) — session 6 continued

**Branch:** `lt-4` (session branch `claude/nervous-lamport-e8a966`). User chose
to fix the [both] P1 items **on lt-4** (forward-port to master later), and to take
**all of F1–F5**. Source: [tasks/post-audit-followups.md](post-audit-followups.md) P1 tier.

The F-series (F1–F9 UI) shipped earlier this session (see CHANGELOG + git
`965da15..ed1885c`); this plan supersedes that one in todo.md.

## 1. Goal + scope

Fix the five [both] P1 correctness/data-loss/memory-safety bugs in shared legacy
`src/` code. **In:** F1 (save-failure data loss), F2 (ChunkReader heap over-read),
F3 (chunk-depth overflow), F4 (cyclic/multi-parent emitter graph), F5 (uint16
particle-index wrap). **Out:** F6 (TextureManager/Reset — [lt-4], needs a
`--test-host` repro to confirm P1 vs P2; separate), F7 (skydome — already fixed on
lt-4), and all P2/P3/G items. Master forward-port is the user's later call.

## 2. What the codebase already gives us (verify each — L-022 drift)

- **F1:** `DoSaveFile` [main.cpp:1452](../src/main.cpp:1452) — `SaveParticleSystem()`
  returns bool; bookkeeping (`SetFileChanged(false)`, `undoStack.MarkSaved()`,
  `Autosave::DeleteOurSession()`) runs unconditionally. Host twin to audit:
  [BridgeDispatcher.cpp:1620](../src/host/BridgeDispatcher.cpp:1620).
- **F2:** `ChunkReader::readString()` [ChunkReader.cpp:90](../src/ChunkReader.cpp:90) —
  `new char[size()]` + `str = data` (walks to NUL). `BadFileException` exists.
- **F3:** `MAX_CHUNK_DEPTH=256` [ChunkFile.h:27](../src/ChunkFile.h:27); reader
  `++m_curDepth` [ChunkReader.cpp:65](../src/ChunkReader.cpp:65); writer
  `m_curDepth++` [ChunkWriter.cpp:8](../src/ChunkWriter.cpp:8) — no bound checks.
- **F4:** loader range-clears `spawnOnDeath`/`spawnDuringLife` then sets
  `child->parent` [ParticleSystem.cpp:1071](../src/ParticleSystem.cpp:1071); no
  self-link / dual-parent / cycle check. `deleteEmitter` recurses on these.
- **F5:** `uint16_t index[]` [EmitterInstance.h:25](../src/EmitterInstance.h:25);
  wrap at `m_verticesIndex` casts [EmitterInstance.cpp:340](../src/EmitterInstance.cpp:340);
  `AllocateParticle()` [EmitterInstance.cpp:133](../src/EmitterInstance.cpp:133).

## 3. Implementation approach

- **F1:** track `bool ok = SaveParticleSystem(...)`; run the three bookkeeping
  calls only inside `if (ok)`. Apply the same shape to the host save path if it
  has the same bug.
- **F2:** read into `std::vector<char> buf(size())`; validate `size() > 0 &&
  buf.back() == '\0'`; construct `std::string(buf.data(), buf.size()-1)`; throw
  `BadFileException` otherwise.
- **F3:** depth guard before `++m_curDepth`/`m_curDepth++` — reader throws
  `BadFileException` at `>= MAX_CHUNK_DEPTH`; writer `assert` (our-bug, not input).
- **F4:** add `ValidateEmitterGraph()` after the range-clear — reject self-links,
  reject a child claimed by two parents, DFS for cycles (clear the offending
  link). Call from load + autosave-restore + the import-emitters helper.
- **F5:** hard cap in `AllocateParticle()` at
  `numeric_limits<uint16_t>::max() / NUM_VERTICES_PER_PARTICLE`; refuse to spawn
  beyond it (debug-log).

## 4. Risks + mitigations

1. **F4 false-positives reject valid files.** A legitimate deep-but-acyclic graph
   must still load. *Mitigation:* only reject true self-link / dual-parent /
   cycle; clear the bad link rather than refusing the whole file where possible;
   test with a normal multi-emitter file (must load unchanged).
2. **F2/F3 break loading of valid files.** Over-strict validation rejects good
   `.alo`s. *Mitigation:* only the malformed cases throw; round-trip a
   save→load of a real particle system and confirm identical.
3. **F5 cap too low clips real effects.** ~16k particles is a real ceiling.
   *Mitigation:* cap at the exact uint16/verts boundary, not lower; log so it's
   visible; note the 32-bit-index long-term fix.
4. **Native-only behaviour, mock can't cover it (L-038).** vitest won't catch
   regressions here. *Mitigation:* build Debug+Release and run the native
   `pnpm a11y` suite (emitter-mutations/bridge-native) after; round-trip a real
   file via `--test-host`/the editor.

## 5. Testing & verification

- Build **Debug + Release** x64 clean after each fix.
- **Native spec suite** (`pnpm --filter @particle-editor/editor a11y`) — confirm
  `emitter-mutations` + `bridge-native` pass (F1 save, F4 loader); `splitters`
  failures are the known agent-window artifact (L-033), not these fixes.
- **Round-trip:** save then reload a real multi-emitter particle system in the
  running editor — loads identically (F2/F3/F4 don't reject valid data).
- **F1 happy/fail:** normal save still clears dirty; a forced failure (e.g.
  read-only path) keeps dirty + autosave (manual/code-review).
- **F4:** a normal nested file loads; (if feasible) a crafted self-link file is
  rejected/cleared without crash.
- vitest stays green (384) — these are native, so no web change expected.

## Review
_(appended as each item lands)_
