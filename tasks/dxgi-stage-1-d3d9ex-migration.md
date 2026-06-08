# tasks/dxgi-stage-1-d3d9ex-migration.md — [MT-11] Phase 3 Stage 1

> **Active sub-plan.** Awaiting user OK before any code.
>
> Parent plan: [`tasks/todo.md`](todo.md) §4 Stage 1.
> Predecessor: [Stage 0 GO decision](../docs/superpowers/research/dxgi-stage-0-decision.md).
> Validated on user's RTX 3080 via [dxgi_spike](../src/host/spike/dxgi_spike.cpp).

**Difficulty:** ★★★ (real-engine surgery, but bounded — no new
features, byte-identical behaviour target).

**Effort estimate:** 2-3 days focused work per parent plan.

---

## 1. Goal + scope

**When this ships:** The production engine in `src/engine.cpp` uses
D3D9Ex instead of D3D9. All existing rendering, input, performance,
and behaviour is identical to today. The engine's `m_pDevice` is now
an `IDirect3DDevice9Ex*` whose shared-handle textures can be opened
by a D3D11 device — but no shared-handle path is wired yet (Stage 2).

**In scope:**

- `engine.cpp`: `Direct3DCreate9` → `Direct3DCreate9Ex`,
  `CreateDevice` → `CreateDeviceEx`.
- `engine.h`: `IDirect3D9*` / `IDirect3DDevice9*` member types
  promoted to `IDirect3D9Ex*` / `IDirect3DDevice9Ex*`.
- **Four `D3DPOOL_MANAGED` sites migrated to `D3DPOOL_DEFAULT`** —
  D3D9Ex doesn't support managed pool. Each affected resource needs
  release in `OnLostDevice` and recreation in `OnResetDevice`.
- New auto test `tests/native/d3d-init.spec.ts` boots in legacy +
  new-UI + canvas-jpeg modes, asserts log contains
  `[D3D9Ex] device created`.
- D3D9 debug-layer enabled in Debug builds; reports zero errors at
  shutdown.

**Out of scope (filed for later stages):**

- Shared-handle render-target texture creation (Stage 2).
- D3D11 / DComp / WebView2 composition hosting (Stage 3-4).
- Engine rendering changes — draw calls, shaders, particle physics
  byte-identical.
- `ResetEx` migration (Stage 4 polish; vanilla `Reset` still works
  on D3D9Ex devices).
- Runtime fallback path to vanilla-D3D9 if D3D9Ex init fails
  (Stage 6; for now hard-fail with log+message if D3D9Ex unavailable
  — this rig has it, production users on Petroglyph patch will too).
- Multi-GPU LUID match check (Stage 4 — only matters when D3D11
  side gets wired).

**Explicitly not happening:** changes to legacy `--legacy-ui` mode's
rendering path *unless* it shares `Engine`. Open question 7.1 below
— must answer before writing code.

---

## 2. What the codebase already gives us

| Surface | Where | Role |
|---|---|---|
| `Engine` class | [src/engine.h:123, 437-439](../src/engine.h) | Owns `m_pDirect3D` + `m_pDevice`; the two members that change type |
| `Engine::Reset` flow | [src/engine.cpp:1267-1299](../src/engine.cpp) | Existing `OnLostDevice` / `OnResetDevice` scaffold for shaders + compositor RT. Stage 1 extends this for the 4 newly-`D3DPOOL_DEFAULT` resources. |
| 4× `D3DPOOL_MANAGED` sites | engine.cpp [1044](../src/engine.cpp), [1511](../src/engine.cpp), [1522](../src/engine.cpp), [1608](../src/engine.cpp); engine.h [373](../src/engine.h) | All MT-3 skydome + 1 ground-texture-related. The MT-3 sites are explicitly commented as "survives device Reset" — that's the property D3D9Ex breaks. |
| `viewport_poc.cpp` | [src/host/viewport_poc.cpp:82-119](../src/host/viewport_poc.cpp) | Reference D3D9 init pattern (fallback chain HWVP → SOFTWARE_VP) |
| `dxgi_spike.cpp` | [src/host/spike/dxgi_spike.cpp:170-230](../src/host/spike/dxgi_spike.cpp) | Reference **D3D9Ex** init pattern — known-working on this rig from Stage 0 |
| L-007 (lessons.md) | [tasks/lessons.md:300+](lessons.md) | The "skydome effect missed Reset" incident. Exact same shape of bug that the D3D9Ex migration could re-trigger if any new `D3DPOOL_DEFAULT` resource forgets `OnLostDevice` registration. Load-bearing context for this stage's risk #3. |
| Test infra | vitest 335/335, Playwright 90/90, MSBuild Debug+Release x64 | Pre-flight floor + acceptance ceiling |

---

## 3. Architecture / implementation approach

### 3.1 Type promotion (engine.h)

```cpp
// before
IDirect3D9*                     m_pDirect3D;
IDirect3DDevice9*               m_pDevice;

// after
IDirect3D9Ex*                   m_pDirect3D;
IDirect3DDevice9Ex*             m_pDevice;
```

`IDirect3DDevice9Ex` inherits from `IDirect3DDevice9`, so every
existing call site (`m_pDevice->SetRenderTarget`, `Clear`, `Present`,
`SetRenderState`, etc.) compiles unchanged. The promotion is
non-breaking by inheritance.

`GetDevice()` returns `IDirect3DDevice9*` (base) so external callers
(`m_textureManager.getTexture(m_pDevice, ...)`, `m_shaderManager.getShader`,
spawner panel renderers, etc.) continue to type-check unchanged.

### 3.2 Device creation (engine.cpp)

```cpp
HRESULT hr = Direct3DCreate9Ex(D3D_SDK_VERSION, &m_pDirect3D);
if (FAILED(hr) || !m_pDirect3D) {
    // hard-fail: log + MessageBox + return. No fallback for Stage 1.
    // Stage 6/7 polish: add runtime fallback to vanilla-D3D9 with
    // visible-popup legacy arch-A path.
    return false;
}
// (the existing fallback chain stays: HWVP → MIXED_VP → SOFTWARE_VP)
hr = m_pDirect3D->CreateDeviceEx(
    D3DADAPTER_DEFAULT, D3DDEVTYPE_HAL, hwnd,
    D3DCREATE_HARDWARE_VERTEXPROCESSING | D3DCREATE_MULTITHREADED,
    &m_presentationParameters, nullptr, &m_pDevice);
// ... existing fallback chain for HWVP→MIXED→SOFTWARE ...

LogDbg("[D3D9Ex] device created (HWVP, multithreaded)\n");
```

`D3DCREATE_MULTITHREADED` is required for cross-device shared
textures to work later in Stage 2. The ~5% perf overhead is
negligible for an editor workload; the spike already runs at 3000+
FPS with this flag.

### 3.3 `D3DPOOL_MANAGED` migration — the load-bearing change

D3D9Ex disallows `D3DPOOL_MANAGED`. Four sites need migration:

| Site | Resource | Today | Stage 1 approach |
|---|---|---|---|
| engine.cpp:1044 | CreateTexture in `CreateSolidColorTexture` helper (ground-texture fallback) | `D3DPOOL_MANAGED` | `D3DPOOL_DEFAULT` + recreate in `OnResetDevice` (cheap — solid colour, ~16×16 LockRect write) |
| engine.cpp:1511 | Skydome vertex buffer (procedurally generated sphere) | `D3DPOOL_MANAGED` | `D3DPOOL_DEFAULT` + `D3DUSAGE_WRITEONLY` + repopulate in `OnResetDevice` from the existing generator |
| engine.cpp:1522 | Skydome index buffer | `D3DPOOL_MANAGED` | Same treatment as VB |
| engine.cpp:1608 | `D3DXCreateTextureFromFileInMemoryEx` for skydome bundled texture (resource memory) | `D3DPOOL_MANAGED` | `D3DPOOL_DEFAULT` + reload from RCDATA in `OnResetDevice` (resource bytes are in-process, always available) |

All four resources get added to the existing `Engine::Reset` flow:

- **Before** `m_pDevice->Reset(...)`: release each. Today the
  `OnLostDevice` block at engine.cpp:1267-1289 releases shaders and
  the compositor RT — extend it to also release the 4 above.
- **After** `m_pDevice->Reset(...)`: recreate each. Today the
  `OnResetDevice` block at engine.cpp:1293-1299 calls
  `OnResetDevice` on shaders — extend it to recreate the 4 above.

The skydome path may want refactoring into a helper
`Engine::RecreateSkydomeResources()` so the init + reset paths share
code rather than duplicating allocation logic.

### 3.4 `Reset` vs `ResetEx`

Keep `m_pDevice->Reset(&m_presentationParameters)` for Stage 1 —
`IDirect3DDevice9Ex::Reset` is fully functional; `ResetEx` is mostly
useful for windowed/fullscreen mode transitions which we don't do.
Filed as Stage 4 polish to revisit if reset behaviour shifts.

### 3.5 Debug layer + logging

- Add `[D3D9Ex] device created` log line on success — exact string
  matched by the new auto test.
- Enable D3D9 debug layer in Debug builds (link `d3d9.lib` with the
  `D3D_DEBUG_INFO` define already in the project? — verify).
- Add `[D3D9Ex] reset OK` log line on successful Reset.

---

## 4. Risks named up front + mitigations

### 4.1 D3DPOOL_MANAGED migration silently breaks skydome / ground rendering

**Hazard.** Any of the 4 resources, if its OnResetDevice path is
slightly wrong (e.g., recreated at wrong size, or missed entirely on
some Reset trigger), produces wrong rendering — black skydome, wrong
ground colour, etc. The 4 sites are small but they're the highest-
risk part of Stage 1.

**Mitigation.** Two-fold:
1. **Per-site test**: after each site is migrated, manual smoke
   verifies the affected resource still renders correctly. Don't
   bundle all 4 into one commit; one per commit.
2. **Reset cycle test**: alt-tab away + back, and modal drag-resize
   (which triggers `Engine::Reset` via L-013's mechanism), are added
   to the manual smoke checklist. Each affected resource must
   survive these cycles intact.
3. **L-007 alignment**: that incident's root cause was a `D3DPOOL_DEFAULT`
   resource missing from `Reset`'s `OnLostDevice/OnResetDevice` flow.
   This stage *adds* 4 new such resources. The risk class is exactly
   the one we burned a session on previously. Adding the test pass
   from L-007 (Spawner toggle → modal cycle → device reset) to the
   manual smoke is non-negotiable.

### 4.2 D3D9Ex `CreateDeviceEx` fails on hardware

**Hazard.** D3D9Ex requires Vista+ and a WDDM driver. The user's
RTX 3080 confirmed working via spike, but a different machine could
fail.

**Mitigation.** Hard-fail with explicit log + MessageBox for Stage 1.
Stage 6/7 adds the runtime fallback to vanilla-D3D9 + arch-A path.
This is the user-direction stance: production fallback is legacy
arch-A, not silent D3D9 downgrade.

### 4.3 `D3DCREATE_MULTITHREADED` introduces subtle threading issues

**Hazard.** The engine isn't written to be thread-safe; rare race
conditions could surface under multithreaded D3D.

**Mitigation.** `D3DCREATE_MULTITHREADED` only adds internal driver-
side locking; it doesn't make our code multithreaded. Same flag was
used in the spike at 189k frames with no anomalies. Accept; flag if
manual smoke reveals issues.

### 4.4 Vitest / Playwright assert against pre-D3D9Ex log strings

**Hazard.** If a test asserts `[D3D9]` literal or some other init log
line, it'll fail after the migration.

**Mitigation.** Pre-flight grep: search `tests/` for `[D3D9]`, `D3D9`,
`Direct3DCreate`. Update any that need it. (Likely none — vitest is
TS-only, but Playwright has the native CDP harness.)

### 4.5 `Engine::~Engine` cleanup order changes under D3D9Ex

**Hazard.** D3D9Ex resources may have stricter teardown ordering
requirements.

**Mitigation.** The existing destructor at engine.cpp:1888+ already
releases the MT-3 skydome resources explicitly. After migration,
those resources are no longer `D3DPOOL_MANAGED` so they were already
being released in `OnLostDevice` (per the migration). Update
`~Engine` to skip the double-release.

### 4.6 The 4 sites turn out to be more than 4

**Hazard.** I only searched `src/engine.cpp` + `src/engine.h`. Other
parts of the codebase (TextureManager, ShaderManager, RenderTargets
helpers, particle system internals) may have additional
`D3DPOOL_MANAGED` callers.

**Mitigation.** Repo-wide grep before coding: `git grep
'D3DPOOL_MANAGED'`. Audit every hit. Already partly done — top of
the grep showed 4 sites in engine.cpp + 1 in engine.h, no others
under `src/`. Re-check during execution.

### 4.7 `m_textureManager` and `m_shaderManager` may have internal `D3DPOOL_MANAGED`

**Hazard.** They take `IDirect3DDevice9*` and may internally create
managed-pool resources.

**Mitigation.** Grep their .cpp files for `D3DPOOL_MANAGED` during
execution. If found, migrate alongside the engine sites.

### 4.8 The migration breaks `--legacy-ui` mode

**Hazard.** Legacy mode may use the same `Engine` class. If so, the
D3D9Ex migration affects legacy too — possibly fine, possibly not
(no legacy-mode tests currently fail). If legacy uses a separate
device-creation path, Stage 1 only touches new-UI.

**Mitigation.** Audit early — grep `--legacy-ui` plumbing through
host code. Decision before any device-creation change.

---

## 5. Testing & verification (gate to mark Stage 1 done)

**Pre-flight (must be clean before any code lands):**

- [ ] `git status` clean
- [ ] vitest **335 / 335 pass**
- [ ] Playwright **90 / 90 pass**
- [ ] MSBuild Debug **x64 clean** (preexisting LIBCMTD warning unchanged)
- [ ] MSBuild Release **x64 clean**
- [ ] tsc -b **0 errors**

**Per-site migration (one commit per `D3DPOOL_MANAGED` site):**

- [ ] After each commit, manual smoke for the affected resource
  - Skydome VB → skydome geometry renders
  - Skydome IB → skydome indices correct
  - Skydome texture → skydome texture visible (not black)
  - Ground solid-colour helper → ground texture cycling works
- [ ] Per-site MSBuild + vitest still green

**Functional smoke after all migrations + D3D9Ex swap:**

- [ ] **3 launch modes:**
  - [ ] `ParticleEditor.exe --legacy-ui` boots, renders correctly (if legacy uses Engine)
  - [ ] `ParticleEditor.exe` (default new-UI legacy popup) boots, renders, accepts input
  - [ ] `ALO_VIEWPORT_TRANSPORT=canvas-jpeg ParticleEditor.exe --new-ui` boots, renders, accepts input
  - [ ] Each shows `[D3D9Ex] device created` in log on startup
- [ ] **Engine behaviour:**
  - [ ] Open a sample .ALO — particles spawn, render, animate, die
  - [ ] Camera tumble + zoom + pan + Shift+LMB cursor-bound spawn
  - [ ] Ground texture cycle through bundled slots without lockup (L-007 regression check)
  - [ ] Skydome visible + correct lighting
  - [ ] Modal open + drag-resize — frosted-glass snapshot path still works
- [ ] **Reset cycle:**
  - [ ] Alt-tab away + back — device-lost recovery, no rendering glitch
  - [ ] Sleep + wake — same
  - [ ] Open + close 20 modals in sequence — no resource leak, no skydome regression
  - [ ] **L-007 scenario**: Spawner toggle → modal cycle → ground texture set
- [ ] **Test suites:**
  - [ ] vitest 335 / 335 (no regressions)
  - [ ] Playwright 90 / 90 (no regressions)
  - [ ] New `tests/native/d3d-init.spec.ts` passes in all 3 modes

**Debug instrumentation (#ifndef NDEBUG):**

- [ ] `[D3D9Ex] device created (HWVP|MIXED|SOFTWARE multithreaded)` startup
- [ ] `[D3D9Ex] adapter: <GPU> (VendorId=0xXXXX DeviceId=0xXXXX)`
- [ ] `[D3D9Ex] reset OK` after each successful `Reset`
- [ ] `[D3D9Ex] reset FAILED hr=0x%08lX` on any reset failure
- [ ] No regressions in existing `[ArchC]` / `[FramePublisher]` /
      `[InputDispatcher]` debug logs

**D3D9 debug layer (Debug builds only):**

- [ ] Zero D3D9 debug layer errors at shutdown
- [ ] Any warnings documented in CHANGELOG if present

---

## 6. Open questions (answer during execution, not blockers)

### 6.1 Does `--legacy-ui` share the same `Engine` class?

If yes: D3D9Ex migration affects legacy too. Manual smoke must cover
both modes. If no: legacy stays on D3D9 forever (until separate
dispatch). Grep `--legacy-ui` plumbing in `src/host/*` and
`src/main.cpp` to determine.

### 6.2 Does the engine currently use `D3DCREATE_MULTITHREADED`?

If yes: no behavioural change needed. If no: adding it now might
expose latent thread-safety bugs (low probability, but worth knowing).

### 6.3 Are there `D3DPOOL_MANAGED` allocations in
`TextureManager.cpp` / `ShaderManager.cpp` / similar?

Repo-wide `D3DPOOL_MANAGED` grep already found just 4 sites in
engine.cpp + 1 declaration in engine.h. Re-verify during execution
in case I missed an include path.

### 6.4 Should `Engine::Reset` also use `D3DCREATE_PUREDEVICE`?

D3D9Ex with `PUREDEVICE` is sometimes faster but disables state-
shadowing and breaks any code that calls `GetRenderState` etc. Audit
needed. Default for Stage 1: skip; revisit Stage 4 polish.

### 6.5 Does the modal-snapshot path interact with the migrated
skydome resources?

`AlphaCompositor::CaptureSnapshotPng` captures the engine's last
frame. If the snapshot is captured between OnLostDevice and
OnResetDevice (unlikely but possible during modal drag-resize per
L-013), it'd see an inconsistent state. Verify during smoke.

---

## 7. Decisions for user before coding

If any of these need to flip from the default, raise now:

1. **Hard-fail on D3D9Ex unavailable, or fall back to vanilla D3D9?**
   Plan: hard-fail (user direction is "arch-A is the production
   fallback, NOT silent D3D9 path"). If user wants D3D9 fallback
   *within* the new-UI codepath, change here before coding.

2. **`D3DCREATE_MULTITHREADED` flag on or off?** Plan: on (matches
   spike, required for Stage 2). 5% perf overhead accepted.

3. **One commit per site or one omnibus commit?** Plan: one per
   `D3DPOOL_MANAGED` migration site (4 commits) + one for the
   `Direct3DCreate9Ex` swap + one for the new auto test. Easier
   bisect if something breaks.

4. **`tests/native/d3d-init.spec.ts` — full test or smoke-only?**
   Plan: smoke-only for Stage 1 (asserts `[D3D9Ex] device created`
   in each mode's log). Full driver-fallback testing is Stage 6.
