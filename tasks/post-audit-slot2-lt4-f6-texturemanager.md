# Slot 2 — F6 TextureManager cache vs D3D9Ex Reset

Per `tasks/post-audit-followups.md` "Suggested ordering" step 2. LT-4
work — branch from `origin/lt-4`, PR against `lt-4`.

## 1. Goal + scope

**Goal.** Close the texture-cache hole in `Engine::Reset()` so cached
textures created via D3DX helpers (which silently use `D3DPOOL_DEFAULT`
under D3D9Ex) don't survive past the device reset as stale handles.

**In scope:**
- Add `OnLostDevice()` to `ITextureManager` interface.
- `TextureManager::OnLostDevice()` clears the cache map AND releases
  `pDefaultTexture` (which `Clear()` deliberately preserves for
  hot-reload semantics).
- Call `m_textureManager.OnLostDevice()` from `Engine::Reset()` before
  the device reset.

**Out of scope:**
- Symmetric `IShaderManager` fix. `ShaderManager::Clear()` exists at
  [src/main.cpp](src/main.cpp); engine already calls it on hot-reload.
  Cached Effects may have the analogous issue under D3D9Ex but the
  audit only named TextureManager. Queued as a follow-up if a real
  user hits the bug.
- Replacing the legacy D3DX helper calls themselves (`D3DXCreateTextureFromFileInMemory`,
  `D3DXCreateTextureFromResource`) with explicit-pool variants. The
  cache-clearing fix is sufficient; the deeper rewrite is out of
  surgical scope.

## 2. What the codebase already gives us

| Component | File:line | What it gives us |
|---|---|---|
| `ITextureManager` interface | [src/managers.h:24-29](src/managers.h:24) | Already has `Clear()`; adding `OnLostDevice()` is a one-line interface extension. |
| `TextureManager` cache | [src/main.cpp:103-228](src/main.cpp:103) | `Clear()` releases the `textures` map but deliberately preserves `pDefaultTexture` (released only by dtor). |
| `Engine::Reset` | [src/engine.cpp:1260-1339](src/engine.cpp:1260) | Already does Lost/Reset for all Engine-owned effects (`m_pDistortShader`, `m_pShaders[i]`, `m_pBloomEffect`, `m_pSkydomeEffect`) and releases the engine-owned `D3DPOOL_DEFAULT` resources (skydome VB/IB, ground/skydome textures, scene/distort/depth surfaces, compositor RT). Adding the texture-manager hook fits the existing pattern. |
| `m_textureManager` reference | [src/engine.h:456](src/engine.h:456) | Engine already holds the reference; no plumbing needed. |
| Only one implementer of `ITextureManager` | [src/main.cpp:103](src/main.cpp:103) | Interface change is safe — no test mock or alternate implementer to update. |

## 3. Architecture / implementation approach

### Interface (`src/managers.h`)

Add one virtual method:

```cpp
class ITextureManager
{
public:
    virtual IDirect3DTexture9* getTexture(IDirect3DDevice9* pDevice, std::string name) = 0;
    virtual void Clear() = 0;
    // Drop every cached resource before a device reset. Called from
    // Engine::Reset to release D3DPOOL_DEFAULT textures created via
    // the D3DX helpers — they hide MANAGED→DEFAULT substitution under
    // D3D9Ex and would otherwise be stale handles after Reset. See
    // tasks/post-audit-followups.md F6.
    virtual void OnLostDevice() = 0;
};
```

### Implementer (`src/main.cpp` `TextureManager`)

`OnLostDevice()` calls `Clear()` and additionally releases `pDefaultTexture`:

```cpp
void OnLostDevice() override
{
    Clear();
    SAFE_RELEASE(pDefaultTexture);
}
```

Lazy reload is automatic: next `getTexture()` call rebuilds the cache
entries from disk; if no real file matches, the `IDB_MISSING` resource
re-creates `pDefaultTexture` via the existing fallback at
[src/main.cpp:186-189](src/main.cpp:186).

### Engine call site (`src/engine.cpp::Reset`)

Insert before the `m_pDevice->Reset(&m_presentationParameters)` call
(line 1305), alongside the existing skydome/ground/compositor releases:

```cpp
// [Post-audit F6] D3DX helpers (D3DXCreateTextureFromFileInMemory,
// D3DXCreateTextureFromResource) silently substitute D3DPOOL_DEFAULT
// for MANAGED under D3D9Ex. The TextureManager cache holds them
// indefinitely, so after device reset every cached handle would be
// stale. Drop the cache before Reset; getTexture() lazy-reloads.
m_textureManager.OnLostDevice();
```

No symmetric OnResetDevice — textures rebuild on first `getTexture()`
post-reset, no proactive recreation needed.

## 4. Risks named up front + mitigations

1. **Cache invalidation cost.** Every `Engine::Reset()` now triggers a
   full reload of every previously-cached texture on the next render.
   For a particle set with N textures, that's N D3DXCreateTextureFromFileInMemory
   calls. Acceptable — `Reset()` is itself a slow operation (window
   resize, alt-tab restore) and texture reload runs in the same window
   the user already perceives as paused. Not a hot-path cost.

2. **`pDefaultTexture` release semantics.** The existing `Clear()`
   intentionally preserves it so hot-reload doesn't flash the missing-
   texture placeholder. `OnLostDevice` is the device-reset path, where
   ALL D3D9 resources must be released and re-created on demand. Both
   paths now behave correctly: `Clear()` → "just drop cache, keep
   placeholder"; `OnLostDevice()` → "drop everything, full rebuild on
   demand."

3. **Interface change ripple.** `ITextureManager` is referenced
   throughout `src/host/` (HostWindow, BridgeDispatcher, etc.) but only
   as a passed reference — no override implementations there. The one
   implementer `TextureManager` in `main.cpp` is the only site that
   needs the method body. Confirmed via repo-wide grep before
   committing.

4. **Build under DXSDK header shadowing (L-016).** None of the touched
   files include any modern Windows SDK header — pure DXSDK + project
   internals. The L-016 isolation pattern doesn't apply here.

## 5. Testing & verification

### Build
- [ ] MSBuild Release|x64 clean (lt-4 baseline includes the LIBCMTD-warning workaround at `ba3fbc4`).
- [ ] MSBuild Debug|x64 clean.

### Manual smoke (deferred to user — pre-fix repro from followups)
- [ ] Launch editor in `--test-host` mode, load a particle set with custom textures (e.g. modded mod), resize the host window to force `Engine::Reset`. Observe textures still rendering correctly after the resize.
- [ ] Confirm no log spam about D3DERR or stale-handle warnings.

### Automated tests already on lt-4
- [ ] `d3d9ex.spec.ts` exists ([web/apps/editor/tests/d3d9ex.spec.ts](../web/apps/editor/tests/d3d9ex.spec.ts)) — covers D3D9Ex init + reset + L-007 regression. May or may not exercise the cached-texture path; review what the spec asserts and add coverage if needed (deferred to test-coverage architectural follow-up).

### Code-walk verification
- [ ] Confirm `OnLostDevice` is called BEFORE `m_pDevice->Reset(...)`, after the existing engine-owned releases.
- [ ] Confirm `Clear()`'s existing two callers (`Engine::ReloadTextures` at line 534, `TextureManager` dtor at line 227) still see the same semantics — both preserved.
- [ ] Confirm `pDefaultTexture` is re-created on the first `getTexture()` after `OnLostDevice` via the existing fallback chain.

---

## Review section

**What landed.** Three files, ~25 LoC added:

| File | Change | LoC |
|---|---|---|
| `src/managers.h` | Added `virtual void OnLostDevice() = 0;` to ITextureManager with explanatory comment | +8 |
| `src/main.cpp` | Added `TextureManager::OnLostDevice()` override that calls `Clear() + SAFE_RELEASE(pDefaultTexture)` | +12 |
| `src/engine.cpp` | Inserted `m_textureManager.OnLostDevice();` in `Engine::Reset()` directly before `m_pDevice->Reset(...)`, with an explanatory comment naming Risk 4.7 from the Stage 1 sub-plan | +10 |

**Build verification.** Both configurations clean on lt-4:
- MSBuild Debug|x64 — clean (LNK4098 LIBCMTD baseline warning unchanged)
- MSBuild Release|x64 — clean (same)
- All 14 source TUs in `src/host/` (Compositor, BridgeDispatcher, HostWindow, etc.) recompile with no new warnings — confirming the interface change ripples cleanly through to consumers that hold `ITextureManager&` references.

**Deviations from plan.** None. Interface change confined to the one method; implementation confined to TextureManager; engine call site is one line in the existing release-resources block.

**What I couldn't verify autonomously.**
- **Interactive smoke** — the audit's pre-fix verification step ("load particle set with custom textures, resize host to force `Engine::Reset`, observe whether textures still render") requires launching the editor with a real mod. Build-clean is the deterministic regression bar; the visible-correctness check is yours.
- **`d3d9ex.spec.ts` coverage of the cached path.** Spec exists at [web/apps/editor/tests/d3d9ex.spec.ts](../web/apps/editor/tests/d3d9ex.spec.ts) but I didn't re-read it to confirm whether it exercises the texture-cache-vs-Reset code path. If it does, the fix may close an A/B parity gap; if it doesn't, that's queued under the test-coverage architectural follow-up.

**ShaderManager has the same shape but is OUT OF SCOPE** for this PR per surgical-changes rule. `IShaderManager::Clear()` exists; `ShaderManager` caches Effects from `D3DXCreateEffect`; the engine calls `m_shaderManager.Clear()` from `ReloadShaders` but NOT from `Reset`. Symmetric fix should be queued as a follow-up if a user hits the equivalent bug — but the audit only named TextureManager so I'm respecting scope.

**Confidence.** High. The fix is mechanical, the interface change is contained, the call site is unambiguous, and the existing Lost/Reset pattern in `Engine::Reset` provides clean structural prior art.

**Cross-references.**
- Followups doc: [tasks/post-audit-followups.md](post-audit-followups.md) F6.
- L-007 (sibling incident — skydome effect missed Reset). [tasks/lessons.md L-007](lessons.md).
- Stage 1 sub-plan §4.7 named this exact risk pre-coding but the mitigation (grep for literal `D3DPOOL_MANAGED`) couldn't find it because D3DX helpers hide their pool argument internally.
