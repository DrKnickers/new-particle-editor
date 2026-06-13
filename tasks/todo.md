# MT-17 — Spawner jitter perturbs the *path*, not exit velocity

Session 40. Branch `claude/eager-knuth-973ec8`. Roadmap item `[MT-17]`
(ROADMAP.md §2.4). Absorbs the deterministic arc-path idea from the
retired LT-1.

User design calls (locked 2026-06-13):
- **Velocity-jitter → removed outright.** No "spread" survivor.
- **Squiggle → smooth sinusoidal wiggle** (per-instance random phase),
  not random-walk noise.
- **Arc → acceleration Vec3** (gravity-like constant accel).

---

## 1. Goal + scope

**Goal.** A spawned instance no longer flies off in a random straight
line. Instead each instance follows a **shaped path** over its lifetime:
a deterministic **arc** (constant acceleration) plus an optional smooth
**squiggle** (per-axis sinusoidal lateral wander with a per-instance
random phase, so sibling instances in a burst diverge organically). The
emit point traces this path, so the particle trail itself arcs/squiggles.

**In:**
- New `SpawnerConfig` fields: `acceleration` (Vec3), `squiggleAmplitude`
  (Vec3), `squiggleFrequency` (scalar Hz). Remove `jitterVelocity`.
- Analytic path integration in `ParticleSystemInstance::Update`, keeping
  `m_velocity` live each frame so emitted particles inherit the correct
  instantaneous velocity (EmitterInstance.cpp:557).
- Per-instance random phase seeding in `SpawnerDriver`.
- React `SpawnerPanel`: drop "Jitter velocity"; add "Acceleration (arc)"
  Vec3 row, "Squiggle amplitude" Vec3 row, "Squiggle frequency" scalar.
- bridge-schema DTO + defaults + BridgeDispatcher JSON converters.
- Legacy Win32 dialog kept *compiling + coherent*: strip the velocity
  column from the Jitter groupbox; do NOT add arc/squiggle there.
- `jitterPosition` stays exactly as-is (spawn-point scatter is correct).

**Out:**
- Wiring arc/squiggle into the legacy Win32 spawner dialog. Legacy is
  `--legacy` opt-out and slated for deletion (MT-13, greenlit). Adding 7
  spinners + resource layout to a doomed dialog is wasted work; legacy
  just won't expose path-shaping. *Reason: MT-13 will delete it.*
- Per-axis squiggle *frequency* (only a single scalar freq). Per-axis
  amplitude + per-instance random phase already gives 3-D organic wander;
  per-axis freq is more knobs for marginal gain. *Reason: simplicity-first;
  revisit only if the wander reads too regular.*
- Persisting the new fields anywhere in the `.alo` — spawner state is
  session/registry-only by existing design.

## 2. What the codebase already gives us

- `SpawnerConfig` struct + `ClampSpawnerConfig` — [src/SpawnerDriver.h:18],
  [src/SpawnerDriver.cpp:56]. `JITTER_MAX = 10000`. Add `SQUIGGLE_FREQ_MAX`.
- `Jitter()` / `JitterAxis()` rand helpers — [src/SpawnerDriver.cpp:21].
  Reuse the same `std::rand()` source for phase seeding.
- Spawn loop stamps pos+vel then `Detach()` — [src/SpawnerDriver.cpp:185].
  After detach `m_parent==NULL`, so `GetPosition/GetVelocity == m_position/
  m_velocity`.
- Motion lives in `ParticleSystemInstance::Update`, currently
  `m_position += m_velocity*dt` (constant velocity) — [src/ParticleSystemInstance.cpp:13].
  Baseline `m_spawnTime`/`m_lastUpdateTime` already established on first
  Update. `MarkSpawnerOwned()` captures launch velocity into `m_velocity`
  ([src/ParticleSystemInstance.h:39]).
- Emitted particles inherit instance velocity:
  `velocity += GetVelocity() * parentLinkStrength` — [src/EmitterInstance.cpp:557].
  ⇒ arc/squiggle MUST update `m_velocity` to instantaneous, not freeze it.
- JSON ↔ config converters + default JSON —
  [src/host/BridgeDispatcher.cpp:320] (`JsonToSpawnerConfig`),
  [src/host/BridgeDispatcher.cpp:342] (`SpawnerConfigToJson`),
  [src/host/BridgeDispatcher.cpp:563] (`DefaultSpawnerConfigJson`).
- TS DTO + defaults — [web/packages/bridge-schema/src/index.ts:103].
  Consumers: `SpawnerPanel.tsx`, `mock-state.ts`, `bridge-contract.test.ts`.
- React panel rows — [web/apps/editor/src/screens/SpawnerPanel.tsx:373]
  ("Jitter position"/"Jitter velocity" sections + `setJitterVelAxis`).
- Legacy Win32 dialog — `.rc` Jitter groupbox [src/ParticleEditor.en.rc:128]
  (IDC_SPAWNER_JIT_VEL_X/Y/Z), load/read in main.cpp
  [src/main.cpp:5841] / [src/main.cpp:5877].

## 3. Architecture / implementation approach

**Path math (analytic on τ = currentTime − spawnTime).** Replace the
incremental Euler step with a closed form so the arc is exact and
frame-rate independent:

```
ω        = 2π · squiggleFreq
base(τ)  = spawnPos + spawnVel·τ + ½·accel·τ²
sq_i(τ)  = Aᵢ·( sin(ωτ + φᵢ) − sin(φᵢ) )          // 0 at τ=0 → emanates from spawn point
pos(τ)   = base(τ) + sq(τ)
vel(τ)   = spawnVel + accel·τ + Aᵢ·ω·cos(ωτ + φᵢ)  // instantaneous, for particle inheritance
```

`− sin(φᵢ)` zeroes the squiggle offset at τ=0 so the instance still
starts exactly at its spawn point; the residual `Aᵢ·ω·cos(φᵢ)` initial
lateral velocity is the desired per-instance launch divergence.

**New instance state** (frozen at spawn, in `ParticleSystemInstance`):
`m_spawnPos`, `m_spawnVel`, `m_accel`, `m_squiggleAmp` (Vec3),
`m_squiggleFreq` (float), `m_squigglePhase` (Vec3). Setter
`SetPathShape(accel, amp, freq, phase)` called by the driver right before
`Detach()`. `m_spawnPos`/`m_spawnVel` captured at the first-Update
baseline (where `m_spawnTime` is set), before `m_velocity` starts being
overwritten each frame.

**SpawnerDriver.** Drop `Jitter(jitterVelocity)`; stamp plain
`m_cfg.velocity`. After spawn, seed a per-instance phase
`D3DXVECTOR3(RandPhase(), RandPhase(), RandPhase())` with
`RandPhase()=2π·rand/RAND_MAX` and pass via `SetPathShape`.

**Clamp.** `acceleration`/`squiggleAmplitude` → `ClampVec(JITTER_MAX)`;
`squiggleFrequency` → `Clamp(0, SQUIGGLE_FREQ_MAX=20)`.

**Bridge.** DTO: remove `jitterVelocity`; add `acceleration: Vec3`,
`squiggleAmplitude: Vec3`, `squiggleFrequency: number` (default freq 1,
amps/accel 0 ⇒ no-op). Mirror in all three BridgeDispatcher functions.

**React panel.** Remove the "Jitter velocity" `ToolPanel.Section` +
`setJitterVelAxis`. Add: "Acceleration (arc)" Vec3 row, "Squiggle
amplitude" Vec3 row, "Squiggle frequency" single `Spinner` (Hz). Update
the file header comment list. Keep "Jitter position" untouched.

**Legacy.** `.rc`: rename groupbox "Spawn-point jitter (+/-)", drop the
"Velocity" LTEXT + the three IDC_SPAWNER_JIT_VEL_* controls, shrink the
box. main.cpp: delete the JIT_VEL `ConfigureFloatSpinner` lines and the
`cfg.jitterVelocity` read. No arc/squiggle controls added.

## 4. Risks named up front + mitigations

1. **Stale-velocity inheritance.** If `m_velocity` is left frozen while
   only `m_position` follows the arc, particles emitted mid-flight inherit
   the launch velocity and the trail "lies" about its motion.
   *Mitigation:* compute and write `vel(τ)` every Update tick (the
   formula above); covered by a native-harness assertion that
   `GetVelocity()` changes under nonzero accel.
2. **τ=0 position pop.** A raw `sin(ωτ+φ)` squiggle is nonzero at τ=0,
   so instances would teleport off the spawn point on frame 1.
   *Mitigation:* the `− sin(φᵢ)` term; assert `pos(0)==spawnPos` in the
   harness.
3. **Schema drift across the bridge.** Removing `jitterVelocity` from the
   DTO without updating all three BridgeDispatcher converters (or
   mock-state/contract test) yields a snapshot that fails round-trip and
   a red `bridge-contract.test`. *Mitigation:* grep `jitterVelocity`
   repo-wide to zero before building; the contract test is the gate.
4. **Legacy build break.** `jitterVelocity` removal breaks the legacy
   dialog compile (it reads the field). *Mitigation:* the legacy `.rc` +
   main.cpp edits in this same change; Debug x64 host build is the proof.
5. **Old persisted registry config** with a `jitterVelocity` key. JSON
   `value("jitterVelocity", …)` is simply dropped on read (no such field
   now); new keys default when absent. *Mitigation:* `value(key,
   default)` already tolerates missing keys both directions — accepted,
   no migration needed.
6. **Frequency units confusion.** Hz vs rad/s in the UI. *Mitigation:*
   label "Squiggle frequency (Hz)"; ω=2πf conversion lives only in the
   integrator.

## 5. Testing & verification

**Build.** `pnpm --filter @particle-editor/editor test` (expect ≥795,
adjust for added/removed cases), `tsc -b` clean, host Debug x64 MSBuild
clean (L-046), native harness ~180/0 (re-run overload specs isolated if
the tail flakes — L-066).

**Native harness (add SpawnerDriver/path cases):**
- `pos(0) == spawnPos` for nonzero amp+phase (risk 2).
- Under accel only (amp=0): position is the analytic parabola at τ;
  `vel(τ) == spawnVel + accel·τ` (risk 1).
- Under squiggle only (accel=0): position oscillates, returns toward base
  each period; bounded by amplitude.
- `jitterVelocity` fully gone — config has no such field.

**Web:** bridge-contract round-trip green with new DTO; SpawnerPanel
renders the three new controls + no "Jitter velocity"; a11y/golden specs
updated if they snapshot the panel.

**Manual (host, both UIs):** React panel — set accel (0,−5,0) ⇒ fountain
arc; set squiggle amp + freq ⇒ burst instances each wander on a distinct
phase; zero all ⇒ straight line (old non-jitter behavior). Legacy dialog
opens, shows position-only jitter, fires without crash. Mod/file switch
mid-burst, rapid trigger, cap (50) still enforced.

**Debug instrumentation:** none planned; add `#ifndef NDEBUG` `[MT17]`
printf of (accel,amp,freq,phase) at spawn only if a path looks wrong.

---

## Review

**Shipped as planned.** All three locked design calls implemented: velocity
jitter removed outright, smooth sinusoidal squiggle (per-instance random
phase), acceleration Vec3 arc. No scope drift.

**One design refinement during build:** the path math was extracted into a
pure header-only `EvalSpawnerPath` ([src/SpawnerPath.h](../src/SpawnerPath.h))
rather than left inline in `Update`. This was the natural seam to make the
risk-1/risk-2 assertions testable headless (the rest of `Update` is
D3D-coupled) — `tests/test_spawner_path.cpp` (12 cases) hits the *shipped*
function, not a copy.

**Files touched.**
- Engine: `SpawnerDriver.h/.cpp` (config fields, clamp, phase seeding),
  `ParticleSystemInstance.h/.cpp` (path state + analytic Update),
  `SpawnerPath.h` (new, pure kinematics).
- Bridge: `BridgeDispatcher.cpp` (3 converters), `bridge-schema/index.ts`.
- UI: `SpawnerPanel.tsx` (drop velocity-jitter, add 3 sections),
  `mock-state.ts`.
- Legacy: `main.cpp` + `ParticleEditor.en.rc` (strip velocity column),
  `.vcxproj`/`.filters` (track new header).
- Tests: `bridge-contract.test.ts`, `render-loop.spec.ts`,
  `preview-overload.spec.ts` (DTO literals), `tests/test_spawner_path.*` (new).
- Docs: `ROADMAP.md` (MT-17 → Shipped §5.1, tag vacated), `CHANGELOG.md`.

**Verification (all green).**
- `pnpm --filter @particle-editor/editor lint` — tsc clean.
- `pnpm --filter @particle-editor/editor test` — **795 passed**.
- Host **Debug x64** MSBuild — **0 errors** (only pre-existing expat C4244
  + LNK4098 LIBCMTD warnings). Legacy dialog + `.rc` compile.
- `tests/test_spawner_path.exe` — **12 passed, 0 failed**.
- Live dev server: a11y snapshot confirms the new Spawner sections
  (Acceleration / Squiggle amplitude / Squiggle frequency) render, no
  "Jitter velocity", no console errors. (Screenshot timed out — headless
  D3D-canvas rasterizer hang, environmental; a11y tree is authoritative.)

**Known non-blocker.** The a11y composition goldens
(`web/apps/editor/tests/a11y-goldens/*.composition.golden.yaml`) still list
a "Jitter velocity" button. These are dormant/stale by design (per the
session kickoff) and not part of the vitest gate; regenerating needs the
host GUI. Left as-is, consistent with their existing drift.

**Not done (awaiting user):** no commit/PR yet (master-touching gate).
CHANGELOG + ROADMAP carry `#TODO` placeholders for the merge hash/PR number,
to backfill once the PR merges (standard pattern, cf. PR #27).
