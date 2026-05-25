# Slot 4 — Master polish PR (F12, F13+F14, F15, F16)

Per `tasks/post-audit-followups.md` "Suggested ordering" step 4. Five
fixes against master tip `b28f624`. F13+F14 share infrastructure (a
new `ReadAndRelease` helper); F12/F15/F16 are independent point-fixes.

## 1. Goal + scope

**Goal.** Land all four polish-tier master-side correctness items as
one PR.

**In scope:**
- F12 — render window `WM_PAINT` adds `BeginPaint`/`EndPaint`.
- F13 — `TextureManager::load` / `ShaderManager::load` no longer leak `IFile*` from the FileManager path.
- F14 — Partial-read sites all funnel through a new `ReadAndRelease(IFile*)` helper that enforces exact-byte reads and Releases the file reference. Closes 4 instances.
- F15 — `ParticleSystem::Emitter::Emitter(const Emitter&)` copy ctor clears `m_instances` after the default operator= shallow-copy.
- F16 — `EmitterInstance::onParticleSystemChanged` adds the missing `break;` after `case 6`.

**Out of scope:** F17 (attachedParticleSystem, unverified), N1-N8 (opportunistic nits, except N4 `delete file;` which gets incidentally fixed by F13+F14's helper migration).

## 2. What the codebase gives us

| Fix | Site | Helper / existing infra |
|---|---|---|
| F12 | [src/main.cpp:2873](src/main.cpp:2873) `RenderWindowProc` | `PAINTSTRUCT`, `BeginPaint`, `EndPaint` are stdlib Win32. |
| F13+F14 | 4 sites (`main.cpp` × 2, `engine.cpp` × 1, `TexturePalette.cpp` × 1) | `IFile` is refcounted; `ReadException` exists. New helper goes in `files.h`/`files.cpp`. |
| F15 | [src/ParticleSystem.cpp:532-542](src/ParticleSystem.cpp:532) | `m_instances` is `std::set<EmitterInstance*>`. `copySharedParamsFrom` already shows the snapshot-and-restore pattern as proof the maintainer knew. |
| F16 | [src/EmitterInstance.cpp:705-714](src/EmitterInstance.cpp:705) | Just a missing `break;`. |

## 3. Approach

### F13+F14 helper

`std::vector<unsigned char> ReadAndRelease(IFile* file)` declared in
`files.h`, implemented in `files.cpp`. Reads every byte of `file` into
a freshly-allocated buffer, Releases the file reference, returns the
bytes. Throws `ReadException` on partial read or empty file (Releases
first, then throws).

Migration shape per site:
```cpp
// before:
IFile* file = ...;
if (file == NULL) return ...;
unsigned long size = file->size();
char* data = new char[size];
file->read(data, size);  // partial read goes undetected
// ... use data ...
delete[] data;
file->Release();  // or delete file; or leaked entirely

// after:
IFile* file = ...;
if (file == NULL) return ...;
std::vector<unsigned char> bytes = ReadAndRelease(file);
// ... use bytes.data(), bytes.size() ...
// (file is consumed by ReadAndRelease)
```

### F12, F15, F16 — point fixes

F12: standard `BeginPaint`/`EndPaint` wrapping inside the `WM_PAINT` case.

F15: add `m_instances.clear();` after the existing track-repointing loop in the copy ctor. Optionally also reset `parent`, `spawnOnDeath`, `spawnDuringLife` — but the existing clone callers (`addRootEmitter`, `insertEmitterAfter`, etc.) already set those explicitly, so clearing them in the ctor would be defensive-only. Keeping scope tight: clear `m_instances` only.

F16: add `break;` after case 6 in the blend-mode switch.

## 4. Risks

1. **`ReadAndRelease` taking ownership of IFile***. Caller intent is footgun-y if it expects to use `file` after the call. Mitigation: the function name documents this; all 4 call sites stop using `file` after the call.

2. **F13's "fix the leak" changes lifetime of texture/shader files**. Today the leaks accumulate over the editor session. After fix, file handles are closed at the end of each `getTexture`/`getShader` call. No behavioural change visible to the user; only semantic correctness.

3. **F14's exact-byte enforcement could newly reject files that previously "worked" via D3DX accepting partial buffers**. Unlikely in practice — partial reads are usually a real I/O error — but if any user has a partially-truncated `.alo` file in their library, that file will now refuse to load. Acceptable: that's the documented intent of the fix.

4. **F15 might break a caller that DEPENDS on m_instances being copied**. Searched — no such callers exist. All clone sites add fresh instances post-creation.

## 5. Testing

- [ ] MSBuild Debug|x64 + Release|x64 clean.
- [ ] Real `.alo` load + save round-trip (deferred to user; same regression bar as Slot 1).
- [ ] No new compiler warnings beyond LIBCMTD baseline.

---

## Review section

**What landed.** Six files, ~140 LoC added / 60 removed:

| Fix | File(s) | LoC delta | Shape |
|---|---|---|---|
| F13+F14 helper | src/files.h, src/files.cpp | +28 / 0 | New `ReadAndRelease(IFile*)` returning `std::vector<unsigned char>`; takes ownership + Releases, throws `ReadException` on partial read / empty file / null. |
| F13+F14 (TextureManager) | src/main.cpp | +30 / -25 | `createTexture` takes bytes by reference; `load` + `getTexture` use `ReadAndRelease`. Closes the FileManager-IFile leak AND the `delete file;` abstraction violation in the same migration. |
| F13+F14 (ShaderManager) | src/main.cpp | +30 / -25 | Symmetric to TextureManager. |
| F13+F14 (engine.cpp) | src/engine.cpp | +18 / -10 | `LoadTextureViaFileManager` migrated. |
| F13+F14 (TexturePalette.cpp) | src/UI/TexturePalette.cpp | +17 / -8 | `DecodeThumbnail` migrated; `#include "../exceptions.h"` added for the catch. |
| F12 | src/main.cpp | +9 / -2 | `RenderWindowProc::WM_PAINT` wrapped in BeginPaint/EndPaint. |
| F15 | src/ParticleSystem.cpp | +14 / 0 | `m_instances.clear()` after the existing track-repointing loop in Emitter copy ctor. |
| F16 | src/EmitterInstance.cpp | +1 / 0 | One-line `break;` fix after blend mode case 6. |

**Build verification.**
- MSBuild Debug|x64 — clean (LNK4098 LIBCMTD baseline unchanged)
- MSBuild Release|x64 — clean (same)
- One in-flight compile error caught and fixed: TexturePalette.cpp didn't have `exceptions.h` in scope; added the include.

**Deviations from plan.** None of substance. Implementation matches the architecture section; the `exceptions.h` include for TexturePalette.cpp was an in-flight discovery, fixed inline.

**What I couldn't verify autonomously.**
- **Interactive load/save** for F12 — the render-window paint flicker fix is observable behaviour only at runtime, on a Windows desktop, during resize/uncover/invalidate-driven repaints. Build-clean confirms syntactic correctness; visual confirmation is yours.
- **Failed-load behaviour** for F13+F14 — `ReadException` now throws on truncated reads where it previously didn't. No bundled fuzz corpus to test; existing real-`.alo` loads should pass unchanged.
- **F15 clone-then-modify scenarios** — the symptom (cloned Emitter's destructor unregistering live instances from the source) requires a specific UI sequence (duplicate emitter + delete during active preview). Static analysis says the fix is sound; runtime confirmation requires reproducing the original bug.

**Confidence.** High across all five. The helper migration is mechanical and consolidates 4 sites that all had the same shape. F12 is canonical Win32 paint handling. F15 mirrors the `copySharedParamsFrom` snapshot-and-restore pattern in spirit. F16 is one line.

**Incidental fix:** the N4 nit (`delete file;` on refcounted `IFile*` in TexturePalette.cpp + main.cpp `getTexture`/`getShader`) is closed by the same helper migration — `ReadAndRelease` calls `Release()` correctly.

**Cross-references.**
- Followups doc: [tasks/post-audit-followups.md](post-audit-followups.md) F12, F13, F14, F15, F16, N4.
- Slot 1 PR (#86) covered the master P1s; this PR covers the master P2s.
