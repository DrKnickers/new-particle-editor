# Post-audit follow-ups

Consolidated action items from four AI audits run on 2026-05-24. Each
finding listed below survived first-party verification per the
protocol in [`lessons.md` L-018](lessons.md). Findings the auditors
flagged but that turned out to be fabricated, already-shipped, or
contradicted by the code are listed in the **Rejected** section at
the bottom — kept so the same finding doesn't get re-raised in a
future review.

**Audit sources** (full transcripts in 2026-05-24 session):
- **ChatGPT-1** — LT-4 / DXGI composition focus, 5 findings, targeted `lt-4` tip `d3f0fae`
- **Gemini** — general code review, 12 findings, mostly fabricated (only 1 survived verification)
- **Audit A** (ChatGPT, broader pass) — 11 findings against unspecified state, treated as master
- **Audit B** (ChatGPT deep research) — 7 correctness + 5 architecture, explicitly targeted `master` tip `b28f624`

**Branch tagging:**
- **[master]** — affects current `master` tip
- **[lt-4]** — affects the LT-4 integration branch only (typically because the bug is in code that doesn't exist on `master` yet)
- **[both]** — affects both branches; fix needs to land in `lt-4` and forward-port to `master` (or vice versa)

**Severity** uses our local scale, not the auditors':
- **P1** — ship before the next public release; correctness or data-loss risk
- **P2** — bundle into the next polish PR; quality of life or latent risk
- **P3** — opportunistic; pick up when next touching the file

---

## Status reconciliation — 2026-06-01 (session 8)

Each item below was **verified against current `lt-4` code/commits** this session (not
trusted from prior notes — the L-022 lesson kept biting: several items the docs implied
were open had already shipped). This is the trustworthy snapshot; individual headings
carry ✅/⚠️ markers matching it.

**✅ Shipped on `lt-4`** (verified present in code):
`F1`–`F5` (session 7) · `G9` · **`G1`** (import handler, session 8) · **`G10`** (XML
loop, session 8) · **`G12`** (NativeBridge leak, session 8) · `NT-5` (link-group
demotion) · `F10` (TME_LEAVE/WM_MOUSELEAVE) · `G2` (json::exception catches) ·
`G4` (JSON error envelope) · `G5` (WebMessageReceived token unsubscribe) ·
`G6` (MediaQueryList removeEventListener) · `G8` (class-brush cleanup) ·
`F13` (IFile `Release()` on the FileManager path) ·
**`G11`** (WebView2 nav/new-window/permission policy + WebMessage source check,
session 9 — `IsApprovedWebViewOrigin` allow-list; a11y 157/4 unchanged).

**◻️ Moot / obsoleted:** `F11` — the env-var dual-toggle it described was retired by
**MT-12** (single `ALO_HOSTING_MODE` now); the bad combination can't occur.
`F7` — fixed on `lt-4` long ago; closes on the master merge.

**🔶 Genuinely OPEN on `lt-4`** (verified not-yet-done):
- **`G7`** — `AlphaCompositor::Resize` releases old resources before rebuild, no
  transactional swap/rollback (P3 latent; critical-path restructure).
- **`F9`** — `ParticleEditor.vcxproj:267` still hardcodes `10.0.26100.0` include paths
  (P2 portability; **can't verify a fix without a second SDK box** → needs a CI matrix,
  risk of breaking the one working box if done blind).
- **`G3`** — broad `sendOk{ok:false}` → resolve-as-success sweep (~20 sites); the
  **import handler site was fixed** in session 8 (G1 hardening), the rest is a design-laden
  per-site (user-cancel vs hard-fail) PR.
- **`F6`** (TextureManager cache vs D3D9Ex Reset — needs a `--test-host` repro first) ·
  **`F8`** (composition async-failure fallback, `slot3`) · **`A-new`** (bridge
  contract-drift CI test) · **`NT-6`** (lane-stability setting — optional).
- **`F12`** (render `WM_PAINT` still `Render(); break;` — no BeginPaint/EndPaint) and
  the rest of the `[both]` polish set (`F14`/`F15`/`F16`) **shipped on `master` via
  PR #89** but are **mostly still open on `lt-4`** — `F13` is the exception (done). Each
  `F12`/`F14`/`F15`/`F16` needs a per-item lt-4 check before claiming.

**Deferred pending repro/verification:** `F17`, `N1` (and the LT-4 audit's "items NOT
queued" list). **Opportunistic nits:** `N2`–`N8`. **Architecture splits:** each needs
its own plan (main.cpp / ParticleSystem.cpp / EmitterList.cpp).

---

## P1 — correctness, ship promptly

> **STATUS (2026-06-01, session 8): F1–F5 + G9 are SHIPPED on BOTH branches.**
> - **master:** F1–F5 via **PR #89** (`709bd82`, 2026-05-24, independent master-side
>   impl); G9 present at [MegaFiles.cpp:70,113](src/MegaFiles.cpp:70).
> - **lt-4:** F1–F5 via session 7 (`9a3e368`/`ede76ce`/`4f43525`/`24edaa2`),
>   GUI round-trip verified session 8; G9 present (identical to master).
> - **There is NO master forward-port to do** — master has carried F1–F5 for a week.
>   Cherry-picking lt-4's commits would duplicate/conflict (L-022 — the old "forward-port
>   remains" handoff note was stale). The two F1–F5 implementations **diverge** (F2/F3
>   exception type, F4 coverage, F5 gate — see session-8 HANDOFF); reconcile at the
>   LT-4→master integration, not before. F6 (lt-4 latent) and F7 (lt-4, closes on merge)
>   remain as originally noted.

### F1. `DoSaveFile` clears dirty flag and deletes autosave on save failure — [both] [P1, data-loss] — ✅ SHIPPED (master PR #89 · lt-4 `24edaa2`)

**Source:** Audit A finding "Failed saves still clear the dirty flag and mark the undo state as saved"

**Site:** [src/main.cpp:1452-1465](src/main.cpp:1452).

**Bug:** `SaveParticleSystem(...)` returns a bool. On `false` the code shows a `MessageBox`, then unconditionally runs `SetFileChanged(info, false)`, `info->undoStack.MarkSaved()`, and `Autosave::DeleteOurSession()`. Result: a failed save (disk-full, permission denied, I/O exception inside the writer) clears the dirty marker AND wipes the autosave — user closes without prompt thinking the file is on disk, and recovery isn't available either.

**Fix shape:** track success explicitly. Only call `SetFileChanged(false)` / `MarkSaved()` / `DeleteOurSession()` inside the `if (SaveParticleSystem(...))` true branch. ~5 LoC.

**Note:** check the BridgeDispatcher path at [src/host/BridgeDispatcher.cpp:1620](src/host/BridgeDispatcher.cpp:1620) for the same shape — it surfaces save failures via JSON but probably has its own bookkeeping that needs the same audit.

---

### F2. `ChunkReader::readString()` heap over-read — [both] [P1, memory safety]

**Source:** Audit A #2 + Audit B #1 (caught by both)

**Site:** [src/ChunkReader.cpp:90-106](src/ChunkReader.cpp:90).

**Bug:** Allocates `new char[size()]`, reads exactly `size()` bytes, then `str = data;` invokes `std::string(const char*)` which walks until NUL. No terminator append, no length-bounded construction. A malformed `.alo` with an unterminated string chunk reads past the heap buffer until it hits a zero byte. Zero-length chunks (`new char[0]` + C-string assign) are also undefined.

**Fix shape:** read into `std::vector<char> buf(size())`, validate `size() > 0` and `buf.back() == '\0'`, construct `std::string(buf.data(), buf.size() - 1)`. Throw `BadFileException` on validation failure. ~10 LoC.

---

### F3. Chunk depth overflow (reader + writer) — [both] [P1, memory safety]

**Source:** Audit A #1 + Audit B #2 (caught by both)

**Sites:**
- [src/ChunkFile.h:27](src/ChunkFile.h:27) — `MAX_CHUNK_DEPTH = 256` (and same constant at line 51 for writer)
- [src/ChunkReader.cpp:65](src/ChunkReader.cpp:65) — `m_offsets[ ++m_curDepth ] = ...` with no bound check
- [src/ChunkWriter.cpp:8](src/ChunkWriter.cpp:8) — `m_curDepth++` then `m_chunks[m_curDepth].offset = ...` with no bound check

**Bug:** A crafted `.alo` with deeply nested chunks pushes `m_curDepth` past 255 and writes beyond the fixed `m_offsets[256]` / `m_chunks[256]` array — heap-adjacent memory corruption during parse.

**Note from verification:** only `ChunkReader::next()` writes to `m_offsets[]`; `nextMini()` uses `m_miniOffset` (flat). Audit A's "both `next()` and `nextMini()`" claim is half-wrong — `nextMini()` isn't a vector. Writer is genuinely affected too.

**Fix shape:** depth guard before `++m_curDepth` in both `next()` and `beginChunk()`. Reader throws `BadFileException`; writer asserts (writer bugs are our bugs, not malicious input). ~6 LoC.

---

### F4. Cyclic / multi-parent emitter graphs accepted by loader — [both] [P1, correctness]

**Source:** Audit B #4 (none of the other three audits caught it)

**Site:** [src/ParticleSystem.cpp:1071-1090](src/ParticleSystem.cpp:1071).

**Bug:** Loader validates only that `spawnOnDeath` / `spawnDuringLife` are `< m_emitters.size()` and clears out-of-range. Then unconditionally sets `child->parent = emitter`. No check for:
- Self-link (`emitter.spawnOnDeath == i`)
- Two parents pointing at the same child (last writer wins on `parent`)
- Cycles (A→B→A)

Downstream `deleteEmitter` recurses through `spawnOnDeath`/`spawnDuringLife`; tree-rebuild in `UI/EmitterList.cpp` does the same. Cyclic input → infinite recursion or double-free.

**Fix shape:** add `ValidateEmitterGraph()` after the existing range-clearing — reject self-links, reject child indices claimed by two parents, DFS for cycles. Call from the load path AND from autosave restore AND from the LT-3 import-emitters helper. ~40 LoC.

---

### F5. `uint16_t` particle index wrap — [both] [P1, rendering correctness]

**Source:** Audit B #5 (none of the other three audits caught it)

**Sites:**
- [src/EmitterInstance.h:25](src/EmitterInstance.h:25) — `uint16_t index[3 * NUM_TRIANGLES_PER_PARTICLE]`
- [src/EmitterInstance.cpp:340-345](src/EmitterInstance.cpp:340) — `(uint16_t)particle.m_verticesIndex + N` casts
- [src/EmitterInstance.cpp:823, 844](src/EmitterInstance.cpp:823) — `DrawIndexedPrimitiveUP(..., D3DFMT_INDEX16, ...)`
- [src/EmitterInstance.cpp:133-156](src/EmitterInstance.cpp:133) — `AllocateParticle()` calls `m_particleIndex.reserve(capacity * 2)` with no cap

**Bug:** Once `m_verticesIndex` (= `m_index * NUM_VERTICES_PER_PARTICLE`) exceeds 65535, the cast wraps and indices reference the wrong vertices. With 4 verts/particle, soft ceiling is ~16,383 live particles before wrap. `nParticlesPerBurst` / `nParticlesPerSecond` are read from file without a clamp; weather emitters can instantiate `nParticlesPerSecond` immediately.

**Fix shape:** hard cap in `AllocateParticle()` at `numeric_limits<uint16_t>::max() / NUM_VERTICES_PER_PARTICLE`. Refuse to spawn beyond it, log warning in debug builds. ~15 LoC. Long-term: move to 32-bit indexing — but a strict cap is the surgical fix.

---

### F6. `TextureManager` cache survives D3D9Ex Reset — [lt-4] [P1, latent]

**Source:** ChatGPT-1 finding #1 (LT-4-specific because master is still on vanilla D3D9)

**Sites:**
- [src/main.cpp:103-228](src/main.cpp:103) — `TextureManager` caches D3DX-created textures
- [src/main.cpp:118](src/main.cpp:118) — `D3DXCreateTextureFromFileInMemory` (no `Ex`, hides `D3DPOOL_MANAGED` default)
- [src/main.cpp:188](src/main.cpp:188) — `D3DXCreateTextureFromResource` (same)
- [src/engine.cpp:1260-1339](src/engine.cpp:1260) — `Reset()` doesn't touch the cache

**Bug:** Under D3D9Ex, the D3DX9 helpers can't honour `D3DPOOL_MANAGED` (D3D9Ex rejects it) and substitute `D3DPOOL_DEFAULT` silently. Those textures then need releasing before any `Reset()` call. The cache holds them indefinitely. The Phase 3 Stage 1 sub-plan named this as Risk 4.7 but the chosen mitigation (grep for `D3DPOOL_MANAGED`) couldn't find it — see `lessons.md` L-018's discussion of "implicit pool defaults defeat explicit-pool greps."

**Pre-fix verification step:** `--test-host` repro — load a particle set with custom textures, resize host to force `Engine::Reset`, observe. Decides whether this is a silent-corruption P1 or a latent P2. **Stage 4 prerequisite either way.**

**Fix shape:** add `OnLostDevice()` to `ITextureManager` (or call `TextureManager::Clear()` from `Engine::Reset` before the device reset). Cache becomes ephemeral across resets; lazy reload via the existing file-manager layer.

---

### F7. Skydome effect missing `OnLostDevice`/`OnResetDevice` — [master only] [P1]

**Source:** Audit A #C7 + Audit B #3 (both caught it, but unaware of lt-4 fix)

**Site (master):** Around [git show master:src/engine.cpp:1217-1232](src/engine.cpp:1217). Reset call sequence handles `m_pDistortShader`, `m_pShaders[i]`, `m_pBloomEffect` only.

**Status:** Already fixed on `lt-4` ([src/engine.cpp:1287, 1315](src/engine.cpp:1287)) with comment dated 2026-05-20, referencing L-007 (skydome-effect-missed-Reset incident). Closes automatically when `lt-4` merges to `master`. **No fresh action — track via the lt-4 merge.**

---

## P2 — polish, bundle into one PR

### F8. Composition controller async-failure fallback — [lt-4]

**Source:** ChatGPT-1 finding #2

**Site:** [src/host/HostWindow.cpp:1029-1060](src/host/HostWindow.cpp:1029).

**Bug:** Pre-dispatch composition failures fall back to HWND mode; async-callback failures (controller creation, base-controller QI, shared setup) just return HRESULT and leave the host with no UI.

**Severity escalation trigger:** when composition becomes default (Stage 5+), this jumps to P1. Worth a Stage 3h sub-stage before Stage 4 wires engine visuals into the composition tree.

**Fix shape:** PostMessage a custom failure-message back to the message loop with the HRESULT; loop tears down partial composition state and re-dispatches the HWND path. ~50-100 LoC.

---

### F9. Hardcoded SDK 10.0.26100.0 in vcxproj — [lt-4]

**Source:** ChatGPT-1 finding #3

**Site:** [src/ParticleEditor.vcxproj:266](src/ParticleEditor.vcxproj:266).

**Bug:** Per-file include override is structurally correct (L-016) — only the literal `10.0.26100.0` path is non-portable. CI runs on the one box with that SDK installed.

**Fix shape:** replace literal with `$(WindowsSdkDir)Include\$(WindowsTargetPlatformVersion)\…` style macros. Per L-016, may need to derive the resolved version explicitly because `$(WindowsSDKVersion)` was empty in this project context. ~10 LoC + CI matrix run on a different SDK.

---

### F10. Composition mouse `WM_MOUSELEAVE` / `TrackMouseEvent` — [lt-4]

**Source:** ChatGPT-1 finding #4

**Site:** [src/host/HostWindow.cpp:1474-1484](src/host/HostWindow.cpp:1474). Forwards every `WM_MOUSE*` except leave; no `TrackMouseEvent` arming. Sticky `:hover` and cursor state when pointer exits.

**Fix shape:** arm `TME_LEAVE` on each forwarded move, handle `WM_MOUSELEAVE` by sending `COREWEBVIEW2_MOUSE_EVENT_KIND_LEAVE`, re-arm on next move. ~20 LoC.

---

### F11. Composition env-var combinations unconstrained — [lt-4] — ◻️ MOOT (MT-12 retired the dual env-var toggle; single `ALO_HOSTING_MODE` now — the bad combination can't occur)

**Source:** ChatGPT-1 finding #5

**Site:** [src/host/HostWindow.cpp:494-506](src/host/HostWindow.cpp:494). `ALO_WEBVIEW2_HOSTING=composition` without `ALO_VIEWPORT_TRANSPORT=canvas-jpeg` leaves the legacy popup visible AND the composition tree active.

**Pre-fix:** confirm in Stage 3 sub-plan whether the pair was *intended* to be required.

**Fix shape:** log warning and auto-enable archC, OR refuse to set `m_compositionMode`. One if-statement.

---

### F12. Render window `WM_PAINT` missing `BeginPaint`/`EndPaint` — [both]

**Source:** Audit A finding C6

**Site:** [src/main.cpp:2873-2875](src/main.cpp:2873). `case WM_PAINT: Render(info); break;` — no paint-pair, no `ValidateRect`, update region never validated. Windows keeps re-posting `WM_PAINT`.

**Fix shape:** standard `PAINTSTRUCT ps; BeginPaint(hWnd, &ps); Render(info); EndPaint(hWnd, &ps); return 0;`. ~4 LoC.

---

### F13. `TextureManager` + `ShaderManager` leak `IFile*` from FileManager path — [both]

**Source:** Audit A finding C5 (overlaps with Audit B's "file decode duplication" architecture point)

**Sites:**
- [src/main.cpp:127-142](src/main.cpp:127) — `TextureManager::load`: `fileManager->getFile(...)` returns IFile*, passed to `createTexture`, never `Release()`d
- [src/main.cpp:262-277](src/main.cpp:262) — `ShaderManager::load`: same pattern

**Note:** Ownership convention is genuinely inconsistent — sibling `getTexture`/`getShader` use `new PhysicalFile(...)` + `delete file;` ([src/main.cpp:289-291](src/main.cpp:289), 156). Leak is real on the FileManager-returned path. Long path-of-least-resistance fix is a small RAII helper for `IFile*`.

**Fix shape (minimal):** `file->Release()` after the `createTexture`/`createShader` call in `load()`. ~2 LoC each. **Fix shape (better):** introduce a `ReadWholeFileExact(IFile&) -> std::vector<uint8_t>` helper that handles ownership + exact-byte read in one place; route both managers + the engine skydome helper + `TexturePalette` thumbnailer through it. ~50-line helper + 4 small call-site updates. Closes F14 too.

---

### F14. Partial reads ignored across multiple D3DX decode sites — [both]

**Source:** Audit B #7

**Sites (4 instances of the same pattern):**
- [src/main.cpp:117](src/main.cpp:117) — TextureManager (verified)
- [src/main.cpp:245](src/main.cpp:245) — ShaderManager (verified)
- `src/engine.cpp` skydome texture helper (per audit; spot-check before fixing)
- `src/UI/TexturePalette.cpp` thumbnailer (per audit; spot-check before fixing)

**Bug:** `file->read((void*)data, size)` ignores returned byte count, hands the (possibly partially-uninitialized) buffer to D3DX. Truncated files → nondeterministic D3DX behaviour rather than a clean "decode failed".

**Fix shape:** bundle with F13 — single `ReadWholeFileExact` helper enforces exact-byte reads and replaces all four sites.

---

### F15. Emitter copy constructor shallow-copies `m_instances` — [both]

**Source:** Audit A finding C3

**Site:** [src/ParticleSystem.cpp:532-542](src/ParticleSystem.cpp:532).

**Bug:** `*this = emitter` invokes default operator=, which shallow-copies the `std::set<EmitterInstance*> m_instances`. Cloned Emitter now holds pointers to the source's live `EmitterInstance` objects. If the clone is later deleted or mutated, those live instances' state is at risk.

**Smoking gun:** [src/ParticleSystem.cpp:556-666](src/ParticleSystem.cpp:556) `copySharedParamsFrom` explicitly snapshots-and-restores `m_instances` around `*this = src` — the maintainer knew about the pitfall in that context but didn't apply the same pattern to the public copy ctor.

**Fix shape:** in the copy ctor, after `*this = emitter`, clear `m_instances` (and probably `parent`, since a fresh clone isn't yet parented). The clone callers in `addRootEmitter`/`addLifetimeEmitter`/`addDeathEmitter`/`insertEmitterAfter` already reset `parent` / `spawnOnDeath` / `spawnDuringLife` as needed; making the ctor establish clean runtime state by default is the safest pattern. ~3 LoC.

---

### F16. Blend mode 6 → 7 fallthrough — [both]

**Source:** Audit A + Audit B #6 (both caught it)

**Site:** [src/EmitterInstance.cpp:705-714](src/EmitterInstance.cpp:705).

**Bug:** `case 6` writes state then has no `break` before `case 7` overwrites everything. Mode-6 emitters render wrong.

**Fix shape:** add `break;` after case 6. Replace remaining magic numbers in the switch with `ParticleSystem::BLEND_*` constants. ~2 LoC.

---

### F17. `attachedParticleSystem` may not be cleared on `LoadFile` / `RestoreFromAutosave` — [both, UNVERIFIED]

**Source:** Audit A finding C11 (author marked uncertain; agreed)

**Sites:** [src/main.cpp:937](src/main.cpp:937), 1500, 2882, 2918, 8124 — five clear sites. Audit says `RestoreFromSnapshot` and `DoCloseFile` clear, but `LoadFile` and `RestoreFromAutosave` don't.

**Status:** plausible stale-pointer bug if a cursor-bound preview is alive during file load. **Needs a full trace before sizing.** Defer until someone reproduces or reads through the load paths end-to-end.

---

## P3 — opportunistic, pick up when next touching the file

### N1. `MouseCursor` may have uninitialized `m_updated` — [both, UNVERIFIED]

**Source:** Audit A finding C9. Code was factored out to `src/MouseCursor.h` per comment at [src/main.cpp:370](src/main.cpp:370) — not verified during this session. **Quick verification before action:** check the constructor in `MouseCursor.h`. If `m_updated` isn't `QueryPerformanceCounter`'d in the ctor, first `UpdateVelocity()` call produces garbage `dt`.

### N2. `toupper`/`tolower` on raw `char` — [both]

**Sites:** [src/main.cpp:283, 1444](src/main.cpp:283) and almost certainly elsewhere. UB on negative `char` values (non-ASCII filenames). Cast through `unsigned char` in the transform lambda. Sweep with grep first.

### N3. `AboutProc` operator precedence — [both]

**Site:** [src/main.cpp:406](src/main.cpp:406). `code == BN_CLICKED && id == IDOK || id == IDCANCEL` — `IDCANCEL` always closes regardless of `code`. Probably benign; parenthesize.

### N4. `delete file;` on refcounted `IFile*` — [both]

**Sites:** [src/main.cpp:156, 289-291](src/main.cpp:156); also `UI/TexturePalette.cpp` per audits. `IFile` is intrusive-refcounted via `AddRef`/`Release`; `delete` violates the abstraction. Works today by coincidence. Replace with `Release()`. Sweep with grep.

### N5. `Effect.h` includes `"Types.h"` (case mismatch) — [both]

Real file is `types.h`. Windows is case-insensitive; case-sensitive tooling chokes. Trivial.

### N6. `using namespace std;` in `EmitterInstance.h` header — [both]

Pollutes every includer. Move to .cpp, fully qualify in the header. Touchy because of the wide includer set; sweep carefully.

### N7. Magic chunk IDs spread inline through `ParticleSystem.cpp` — [both]

Real but big. Audit B suggests a `namespace AloChunkIds` header with typed helpers. Worth doing during the next substantive change to `ParticleSystem.cpp`, not as a standalone PR.

### N8. Stale comments / drift — [both]

Generic. Catch during normal review.

---

## Architecture / structural — needs a dedicated planning pass

These are real observations but too large for ad-hoc PRs; each deserves its own brainstorm + plan.

- **`main.cpp` monolith (8193 lines).** Audit A + Audit B both flag. Split candidates: `AppMain.cpp` (startup + message loop), `RenderWindow.cpp` (render child proc + camera input), `Recovery.cpp` (autosave + restore prompts), `Dialogs/*.cpp` (modeless dialogs), `ResourceManagers.cpp` (TextureManager + ShaderManager — closes the L-005 "concrete types live in main.cpp while managers.cpp exists" discoverability gap).

- **`ParticleSystem.cpp` mixing concerns (1488 lines).** Audit B flag. Split candidates: `ParticleSystemIO.cpp` (chunk read/write + Emitter::read*/write*), `ParticleGraph.cpp` (move/reparent/delete/add/import + the new `ValidateEmitterGraph` from F4). Closes A1's "graph validation is spread between parsing and editor operations" observation.

- **`UI/EmitterList.cpp` monolith.** Audit B flag. Split by mode (view / drag-drop / commands), preserving the `ELN_LISTCHANGED` notify-parent seam.

- **Ownership inconsistency (`IFile*` refcounting vs `delete`).** Audit B flag. Pick one rule per subsystem; codify in helpers. Bundle with F13.

- **Test coverage narrow** (Audit A finding). Only `tests/test_palette_store.cpp` covers the C++ side. Riskiest logic (chunk parser, undo round-trip, graph mutation) has no regression harness. After F1–F5 land, add a small `tests/` set for ChunkReader malformed-input fuzz, `UndoStack::Serialize`/`Deserialize` round-trip, and `ParticleSystem::moveEmitter`/`reparentEmitter` invariants. Closes the worst-case "fix lands, regresses six months later" loop.

---

## From LT-4-specific audit (2026-05-24)

A fifth audit (ChatGPT deep research, LT-4-focused) ran the same day. Where the other audits covered legacy C++ in `master`, this one targeted `src/host/` and `web/apps/editor/` — bridge dispatcher contract, WebView2 lifecycle, React keyboard plumbing. Findings below dedup against F1–F17 / N1–N8 above; everything listed here is **net new**. Severity is our local scale, not the audit's.

### G1. `emitters/import-from-file` native handler missing — [lt-4] [P2] — ✅ SHIPPED (2026-06-01, lt-4)

> Implemented: shared data-layer core `ParticleSystem::ImportEmittersFrom` (extracted
> from the legacy `ImportEmitters_Execute`) + the `emitters/import-from-file` bridge
> handler ([BridgeDispatcher.cpp:2756](src/host/BridgeDispatcher.cpp:2756)). Test-first
> via `emitter-import.spec.ts` (a11y); atomic single undo. Plan:
> [tasks/post-audit-slot-g1-import-from-file.md](post-audit-slot-g1-import-from-file.md).

**Site:** schema declares it ([web/packages/bridge-schema/src/index.ts:516](web/packages/bridge-schema/src/index.ts:516)); ImportEmittersDialog calls it ([web/apps/editor/src/screens/ImportEmittersDialog.tsx:138](web/apps/editor/src/screens/ImportEmittersDialog.tsx:138)); `BridgeDispatcher.cpp` grep for `"emitters/import-from-file"` returns 0 hits.

**Bug:** Modal opens, user previews + selects, OK click hits the dispatcher's default not-implemented branch. Caught by the modal's try/catch ([web/apps/editor/src/screens/ImportEmittersDialog.tsx:142-144](web/apps/editor/src/screens/ImportEmittersDialog.tsx:142)) so UX is "inline error, modal stays open" — not a host crash, but a user-visible broken path on an already-shipped UI surface.

**Fix shape:** implement the native handler against the existing LT-3 `MemoryFile` + `Emitter::write(writer, copy=true)` pattern (see `BridgeDispatcher.h:275` comment for the architectural seam). OR: hide the dialog behind a feature gate until the handler lands. ~80-120 LoC for the handler.

---

### G2. `DispatchInternal` not exception-safe — [lt-4] [P2]

**Site:** [src/host/BridgeDispatcher.cpp:691](src/host/BridgeDispatcher.cpp:691) (`DispatchInternal` entry); outer try/catch at [src/host/BridgeDispatcher.cpp:632, 663](src/host/BridgeDispatcher.cpp:632) wraps only `json::parse`.

**Bug:** Per-handler `.get<T>()` calls without prior `is_T()` guards throw `nlohmann::json::type_error`, which propagates out of `DispatchInternal` into the WebView2 callback or COM dispatch path. Audit's cite of `JsonToVec3`/`Vec4` as the source was wrong — those ARE guarded ([src/host/BridgeDispatcher.cpp:120-132](src/host/BridgeDispatcher.cpp:120)). But the broader hazard is real once you look at any of the 100+ inline `.get<int>()`/`.get<std::string>()` sites.

**Fix shape:** wrap the `DispatchInternal` call in `Dispatch` + `DispatchSync` with `try { ... } catch (const json::exception& e) { sendErr(...); }`. Adds defense in depth; per-handler extraction tightening (helpers `TryGetInt`/`TryGetFloat`/`TryGetVec3`) is a longer-tail follow-up. ~15 LoC for the outer guard.

---

### G3. `sendOk({"ok": false, ...})` nested-failure pattern — [lt-4] [P2, contract drift]

**Sites:** 20+ verified in `src/host/BridgeDispatcher.cpp` — lines 965, 1139, 1503, 1529, 1607, 1616, 1622, 1661, 1669, 1675, 1782, 2333, 2360, 2367, 3266, 3274, 3283, 3290, 3306, 3314, 3323.

**Bug:** Operational failure reported as `{ok: true, data: {ok: false, error: "..."}}`. `NativeBridge` only rejects on top-level `ok: false`, so the JS side gets a resolved promise — failed mutations look like silent no-ops to callers. Mixing user-cancelled cases (e.g. 1503, 1607, 1661 — debatably non-errors) with hard failures (e.g. 2333 "emitter not found", 3290 "reorder refused") makes the pattern impossible to discriminate at the callsite.

**Fix shape:** standardize. Hard failures → `sendErr(msg)`. User-cancelled-style operational outcomes → leave as nested `ok:false` BUT define them as the schema's expected response shape and audit `ResponseFor<>` in `bridge-schema` to match. ~30-50 LoC across the 20 sites. **Bundle with G1 + G2 into a single bridge-contract-hardening PR.**

---

### G4. Host-object exception envelope is hand-rolled JSON — [lt-4] [P2]

**Site:** [src/host/HostBridgeProxy.cpp:111](src/host/HostBridgeProxy.cpp:111).

**Bug:** Catch block builds `res = std::string("{\"type\":\"res\",\"ok\":false,\"error\":\"") + e.what() + "\"}";` — `e.what()` interpolated raw. Quote, backslash, or control char in exception text produces malformed JSON, defeats the whole point of the catch (which exists specifically to keep the JS side parseable).

**Fix shape:** use `nlohmann::json{{"type","res"},{"ok",false},{"error", e.what()}}.dump()`. ~5 LoC. Same applies to the sibling catch at line 113 (currently uses a static string, so safe — but the pattern should be consistent).

---

### G5. `WebMessageReceived` token not stored — [lt-4] [P3]

**Site:** [src/host/HostWindow.cpp:953-989](src/host/HostWindow.cpp:953).

**Bug:** Local `EventRegistrationToken tok;`, used for the `add_WebMessageReceived` call, then discarded. No `remove_WebMessageReceived` in `WM_DESTROY`. Asymmetric vs `AcceleratorKeyPressed` and `CursorChanged`, both of which are cleaned up carefully. Probably masked by `webController->Close()` + `webView.Reset()` teardown — not confirmed UAF — but the captured `this` lambda is a real risk under unusual teardown orderings.

**Fix shape:** promote `tok` to a `HostWindowImpl` member, explicit `remove_WebMessageReceived` in `WM_DESTROY` before closing/resetting. ~5 LoC.

---

### G6. DPR `MediaQueryList` listener leak — [lt-4] [P3]

**Site:** [web/apps/editor/src/components/ViewportSlot.tsx:96-101](web/apps/editor/src/components/ViewportSlot.tsx:96).

**Bug:** Effect cleanup nulls `mql` but never calls `mql.removeEventListener("change", onChange)`. One leaked listener per component unmount; the listener holds the stale closure (incl. `send`, which holds `bridge`).

**Fix shape:** keep `onChange` in an outer-scope variable so cleanup can reference it: `let mql: MediaQueryList | null = null; let onChange: (() => void) | null = null;` then in cleanup, `if (mql && onChange) mql.removeEventListener("change", onChange);`. ~5 LoC.

---

### G7. `AlphaCompositor::Resize` no rollback on partial-build failure — [lt-4] [P3]

**Site:** [src/host/AlphaCompositor.cpp:114-182](src/host/AlphaCompositor.cpp:114).

**Bug:** Releases old GPU + GDI resources first ([src/host/AlphaCompositor.cpp:123-129](src/host/AlphaCompositor.cpp:123)), then rebuilds. Any throw from `CreateTexture` / `CreateDIBSection` / `CreateCompatibleDC` leaves `m_impl` in partial state until next successful resize or destruction. Triggers only on D3D9 device failure or GDI handle exhaustion — both rare on healthy systems.

**Fix shape:** build new resource set in locals, swap into `m_impl` only after the full sequence succeeds. Transactional resize semantics; preserves last good frame on failure. ~30 LoC restructure.

---

### G8. `CreateSolidBrush` leaks at class registration — [lt-4] [P3, nit]

**Site:** [src/host/HostWindow.cpp:2120](src/host/HostWindow.cpp:2120). `wc.hbrBackground = (HBRUSH)CreateSolidBrush(RGB(0x14, 0x08, 0x34));` — registered once per process, no matching `DeleteObject`. Process-lifetime leak only.

**Fix shape:** store the brush in a static so it can be `DeleteObject`'d on shutdown, OR use a stock brush + paint the colour in `WM_ERASEBKGND`. ~3 LoC.

---

### G9. `.meg` archive index entries unchecked → OOB read — [both] [P1, memory safety] — ✅ SHIPPED (both branches, identical: [MegaFiles.cpp:70,113](src/MegaFiles.cpp:70))

**Source:** ChatGPT deep-research re-run (2026-06-01), finding PAR-002. Net new — not caught by F2–F5 (those cover `.alo`/`ChunkReader`; this is the `.meg` archive path).

**Sites:**
- [src/MegaFiles.cpp:58-66](src/MegaFiles.cpp:58) — constructor reads each `FileInfo` (`crc`, `nameIndex`, `start`, `size`) straight from the archive with no validation
- [src/MegaFiles.cpp:100](src/MegaFiles.cpp:100) — `filenames[files[mid].nameIndex]` dereferenced with no bound check
- [src/MegaFiles.cpp:102](src/MegaFiles.cpp:102) — `new SubFile(file, files[mid].start, files[mid].size)` with no range check
- [src/MegaFiles.cpp:56](src/MegaFiles.cpp:56) — `file->size() - start` unsigned-underflows if `start > file->size()`
- Reachable via [src/managers.cpp:49](src/managers.cpp:49) — `FileManager::getFile` calls `MegaFile::getFile(path)` on every loaded archive during ordinary asset resolution

**Bug:** Same class as F2/F3 but for the archive index instead of the chunk stream. A forged `nameIndex` (e.g. `0xFFFFFFFF`) on an entry whose `crc` matches a requested asset drives an out-of-range `std::vector` access at `filenames[...]`. A forged `start`/`size` hands an out-of-bounds window to `SubFile` for later reads. Confirmed by reading; the report's PoC (1 string, 1 file, `nameIndex = 0xFFFFFFFF`, `crc` matching a requested asset) is sound.

**Fix shape:** validate at construction in the `FileInfo` read loop — reject `nameIndex >= filenames.size()`, reject `start > file->size()` or `size > file->size() - start`. Optionally sanity-cap `numStrings`/`numFiles` before allocating. Throw `BadFileException` on failure. ~15 LoC, concentrated in `src/MegaFiles.cpp`.

---

### G10. `XMLNode` attribute loop never advances `atts` → infinite loop — [both] [P3, latent DoS] — ✅ SHIPPED on lt-4 (2026-06-01, [xml.cpp:15](src/xml.cpp:15)); master port pending (forward-ports at integration)

**Source:** ChatGPT deep-research re-run (2026-06-01), finding PAR-003. Net new.

**Site:** [src/xml.cpp:15-18](src/xml.cpp:15). Reached via [src/xml.cpp:66](src/xml.cpp:66) (`onStartElement` builds every node) → [src/managers.cpp:71](src/managers.cpp:71) (`FileManager` parses `Data\MegaFiles.xml` at startup).

**Bug:** `while (*atts != NULL) { attributes.insert(make_pair(atts[0], atts[1])); }` never increments `atts`, so any element carrying ≥1 attribute spins forever (100% CPU on one core). Confirmed by reading. **Latency caveat:** the canonical `MegaFiles.xml` schema is attribute-less (`<Mega_Files><File>…</File></Mega_Files>`), so the loop is never entered on well-formed game data — which also proves this attribute branch has never successfully executed. Practical trigger requires a malformed or mod-supplied attribute-bearing XML; hence P3, not a live-path bug.

**Fix shape:** advance by pairs — `while (atts && atts[0] && atts[1]) { attributes.insert(make_pair(atts[0], atts[1])); atts += 2; }`. Defensively tolerates a malformed odd-length array. ~2 LoC.

---

### G11. WebView2 host has no navigation / new-window / permission / origin policy — [lt-4] [P3, hardening]

**Source:** ChatGPT deep-research re-run (2026-06-01), finding BR-001. Net new.

**Sites:**
- [src/host/HostWindow.cpp:1218-1253](src/host/HostWindow.cpp:1218) — `add_WebMessageReceived` forwards the raw message to `OnWebMessage` → dispatcher with no source-URL check
- No `add_NavigationStarting`, `add_NewWindowRequested`, or `add_PermissionRequested` registration anywhere in `src/host` (grep returns 0 hits)
- [src/host/HostWindow.cpp:1201-1213](src/host/HostWindow.cpp:1201) — production loads local `dist` via `SetVirtualHostNameToFolderMapping(app.local)`

**Bug:** The effective trust boundary is "whatever page is loaded in the WebView," not "the intended editor origin." The bridge is not read-only (file open/save, texture/shader reload, engine + viewport mutation), so any attacker-controlled page would inherit the full surface. **Severity caveat (disagree with the report's "High"):** the app only ever loads local `dist`; the report demonstrates no navigation-hijack or content-injection primitive for a local desktop tool, so the realistic risk is defense-in-depth, not an exploitable path. Logged as P3 hardening, not a release blocker — but the fix is cheap and standard.

**Fix shape:** in `HostWindow` WebView setup — register `NavigationStarting` and cancel anything outside `https://app.local/*` (plus `http://localhost:5174/*` when `useDevUi`); register `NewWindowRequested` and `PermissionRequested` to deny-by-default; reject `WebMessageReceived` when the source URL is outside the approved set. Localized to `src/host/HostWindow.cpp`. ~30-40 LoC.

---

### G12. `NativeBridge` pending-request map has no timeout or disconnect cleanup — [lt-4] [P2, reliability] — ✅ SHIPPED (2026-06-01, lt-4: try/catch leak fix + `dispose()` on `beforeunload` + opt-in timeout; `native.test.ts`)

**Source:** ChatGPT deep-research re-run (2026-06-01), finding BR-002. Net new.

**Sites:**
- [web/apps/editor/src/bridge/native.ts:45-52](web/apps/editor/src/bridge/native.ts:45) — `request()` inserts `{resolve, reject}` then calls `postMessage`; no `try/catch`, no timeout
- [web/apps/editor/src/bridge/native.ts:76-81](web/apps/editor/src/bridge/native.ts:76) — `onMessage` deletes the pending entry only on a matching `type:"res"` id

**Bug:** Any path where a `res` never arrives — host-side silent drop of malformed traffic, WebView teardown mid-flight, or `postMessage`/`JSON.stringify` throwing after the entry is inserted — leaves a permanently pending promise and a leaked map entry. The caller hangs with no failure signal; a long session slowly accumulates dead entries. Confirmed by reading.

**Fix shape:** wrap `stringify`/`postMessage` in `try/catch` and `delete pending[id]` before rejecting on failure; add a per-request timeout that rejects + deletes after a bounded interval; add a `dispose()`/`beforeunload` handler that rejects and clears all outstanding entries; surface a host-disconnected state so the UI fails closed instead of drifting. ~25 LoC in `native.ts` + one state hook in the app shell.

---

### A-new. Bridge contract drift — no capability-manifest test — [lt-4] [architecture]

**Context:** Schema (TypeScript) + mock (TypeScript) + dispatcher (C++) are three sources of truth that can drift independently. G1 (`emitters/import-from-file`) is one symptom; the deferred `emitters/update` case is documented but easy to forget. The existing `native-spec-allowlist.test.ts` only checks Playwright spec presence, not native handler implementation parity.

**Fix shape:** add a native contract test that enumerates every `Request["kind"]` from `bridge-schema` and asserts the real C++ dispatcher returns something other than "not implemented" for it, unless the kind is explicitly marked deferred (via an exception list with PR/issue references). Catches future G1-class drift at CI time. ~100 LoC for the test + manifest.

---

### Items from this audit NOT queued as actions

| Audit finding | Status |
|---|---|
| `emitters/update` schema/mock only | Acknowledged Phase 3+ work; [bridge-contract.test.ts:251-256](web/apps/editor/src/bridge/__tests__/bridge-contract.test.ts:251) explicitly asserts "not implemented" with a comment. Not drift — planned. |
| Window-scoped keyboard forwarding | Deliberate design with documented rationale at [web/apps/editor/src/components/ViewportSlot.tsx:186-192](web/apps/editor/src/components/ViewportSlot.tsx:186) ("Forwards all keys — only VK_SHIFT is consumed today; broader forward is safe + forward-compat"). Audit's Shift-in-menu concern is legitimate but the design tradeoff was explicit. **Re-evaluate when a user reports a concrete bad interaction**, not before. |
| Async WebView2 propagation | Duplicate of F8 (ChatGPT-1 #2). |
| Playwright bypasses real bridge | Specific architectural read is off — [web/apps/editor/src/App.tsx:32-39](web/apps/editor/src/App.tsx:32) shows `makeBridge()` returns `b`, then `exposeBridgeForTests(b)` is called WITH that same `b` instance. Whether `exposeBridgeForTests` wraps it differently needs reading [web/apps/editor/src/bridge/expose.ts](web/apps/editor/src/bridge/expose.ts). The broader test-path-vs-prod-path concern is plausible but **needs further verification before acting.** |
| Undo invariants incomplete | Real concern. `captureUndo` is called at ~22 sites in BridgeDispatcher.cpp; audit's specific list of dirty-without-undo handlers (ground, background, bloom, light, camera) **needs per-handler spot-check before sizing** — could be 2 missing calls or 20. Defer until that audit happens. |
| `src/host/spike/` location | Defensible to leave. Spike files are excluded from build via vcxproj but remain buildable as standalone exes for ad-hoc verification — moving them to `docs/` kills that property. |
| HostBridgeProxy UTF duplication, ViewportSlot 1Hz log | Real nits but trivial; pick up opportunistically. |

---

## Rejected during verification

Listed so the same finding doesn't get re-raised next round. References to L-018 verification protocol where applicable.

### From Gemini (overall: 11 of 12 fabricated or wrong)

| Finding | Reason rejected |
|---|---|
| C2 — D3D9 device-reset path missing | Already implemented at [src/engine.cpp:1260-1339](src/engine.cpp:1260) via Phase 3 Stage 1c-f |
| C3 — Undo raw pointers / use-after-free | Fabricated. [src/UndoStack.cpp](src/UndoStack.cpp) uses whole-state serialization snapshots; no raw pointers |
| C4 — Hot-reload thread race | Fabricated. No hot-reload subsystem exists; grep `ReadDirectoryChangesW`/`FileWatcher`/`std::thread`/`CreateThread` returns 0 hits in `src/` |
| C5 — `WS_CLIPCHILDREN` flicker | False. Set at [src/main.cpp:7984](src/main.cpp:7984) and ~10 other `CreateWindowEx` sites |
| C6 — Modal in `WM_PAINT` causing stack overflow | Unsubstantiated. No `MessageBox` call sites found in `WM_PAINT` paths |
| C7 — Autosave thread race | Fabricated. [src/Autosave.cpp](src/Autosave.cpp) is fully synchronous on the main thread |
| C8 — Unsigned wrap in keyframe interpolation | Cited file (`ParticleSystem.cpp`) doesn't contain the cited pattern; if real, lives elsewhere — no actionable cite |
| A1 — UI/logic coupling in `DialogView.cpp` | File doesn't exist. LT-4 React + BridgeDispatcher is exactly this refactor and is already in flight |
| A2 — Manual COM lifetimes (sweep) | Real but accepted tradeoff. Engine layer's raw COM is stable; host layer (LT-4) already uses `Microsoft::WRL::ComPtr` |
| A3 — Header pollution sweep | Generic, no specific pain point on this codebase |
| A4 — Spawner modular boundaries (`Spawner.cpp`) | File doesn't exist (it's `SpawnerDriver.cpp`); needs re-scoping if real concern |
| Style sweep nits (NULL→nullptr, C-cast→static_cast etc.) | Bulk sweeps violate the surgical-changes-only rule in `CLAUDE.md` |

### From Audit B / others

| Finding | Reason rejected / status |
|---|---|
| Audit B "skydome OnLostDevice missing" | Already fixed on `lt-4` (F7 above), closes on merge |
| Audit B's "parser still too trusting beyond depth+readString" | Generic — concrete instances captured by F2, F3, F4. Pattern observation noted in architecture section |

### From the 2026-06-01 ChatGPT deep-research re-run (dedup)

Every code-level claim in this re-run was confirmed by reading. Four findings were net new (→ G9–G12 above). The rest dedup against already-tracked items — recorded here so they aren't re-raised as new:

| Re-run finding | Status |
|---|---|
| PAR-001 — `ChunkReader::readString()` heap over-read | **Duplicate of F2.** The re-run labels it "NEW" but it was caught by Audit A + Audit B and is already a tracked P1 with a fix shape. Not new. |
| BR-003 — `emitters/import-from-file` schema/dispatcher gap | **Duplicate of G1.** Re-run correctly labels it KNOWN-OPEN. |
| WebMessageReceived token leak (re-run did NOT re-raise) | Correctly observed as fixed — G5's `webMessageTok` member + `WM_DESTROY` unregister is in the reviewed tree. |
| DevTools / host-object "always on" (re-run did NOT re-raise) | Correctly observed as `useTestHost`-gated ([src/host/HostWindow.cpp:1085-1136](src/host/HostWindow.cpp:1085)). Re-run's residual concern (runtime-flag gate vs compile-time gate) noted, not actioned. |
| XML-001 — old Expat (2.2.0) + no wrapper hardening | Confirmed: `libs/expat-2.2.0` bundled (2017-era; current 2.6.x). Re-run's CVE-applicability pass was explicitly incomplete, so no specific finding to action. The one concrete sub-bug (attribute infinite loop) is captured as G10; an Expat bump + DTD/entity/size-cap hardening is separate hygiene worth a dedicated item if/when the dependency is touched. |

---

## Suggested ordering

1. ~~**Now (before next public release):** F1, F2, F3, F4, F5, **G9**.~~ ✅ **DONE on both
   branches** — master via PR #89 (2026-05-24), lt-4 via session 7 + session-8 GUI
   round-trip. G9 already present on both. No remaining action; the two F1–F5
   implementations diverge and reconcile at LT-4→master integration (session-8 HANDOFF).
2. **Stage 4 prerequisite:** F6 (verify-then-fix). Run the smoke repro first.
3. **Stage 3h (LT-4 sub-stage before Stage 4 starts):** F8.
4. **First master polish PR after the P1s land:** F12, F13+F14 (bundled), F15, F16. All master-side, all small.
5. **LT-4 bridge-contract-hardening:** ~~G1, G2, G3, G4 bundled.~~ G1 ✅ (session 8),
   G2 ✅, G4 ✅ already shipped. **G3** remains — the broad `sendOk{ok:false}` sweep
   (~20 sites; the import-handler site was fixed with G1); a design-laden per-site
   (user-cancel vs hard-fail) PR, not a quick win.
6. **LT-4 host polish PR:** ~~F9, F10, F11, G5, G6, G7, G8, G11, G12~~ — **mostly DONE**
   (session 8 reconciliation). Shipped: F10, G5, G6, G8, **G12**. Moot: F11 (MT-12).
   **Still open:** **G11** (WebView2 nav/permission policy — its own focused PR, app-loading
   risk), **G7** (transactional `AlphaCompositor::Resize`), **F9** (vcxproj SDK macro-ize —
   needs a 2nd-SDK CI matrix to verify). G10 (XML loop) shipped on lt-4. See the
   reconciliation status block at the top of this doc.
7. **Bridge contract test (A-new):** worth doing as its own focused PR; gates future G1-class drift at CI time.
8. **Deferred until reproducer / further verification exists:** F17, N1, plus the LT-4 audit's "items NOT queued" list (window-scoped keyboard, undo-invariant audit, Playwright bridge architecture).
9. **Opportunistic during normal file touches:** N2–N8.
10. **Each architectural item needs its own plan** before action — don't bulk-refactor.

---

## Provenance

Full per-finding verification trail is in the 2026-05-24 session transcript. Verification protocol followed: see [`lessons.md` L-018](lessons.md). Master tip at audit time: `b28f624`. `lt-4` tip: `d3f0fae`. Audits aggregated here (6 total): ChatGPT-1 (LT-4/DXGI), Gemini (general, 11/12 rejected), Audit A (ChatGPT broader, supersedes pending Audit B), Audit B (ChatGPT deep research, master-targeted), the LT-4-specific deep research audit (host + React layer, → G1–G8), and a ChatGPT deep-research re-run on 2026-06-01 (`lt-4` tip `63fb7f2`, → G9–G12; every claim confirmed by reading, PAR-001 deduped to F2 and BR-003 to G1).
