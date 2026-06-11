# Configurable Preview Overload Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the #121 preview overload budgets runtime-configurable (default lowered to 25,000 particles) with a Preferences toggle whose OFF state is fully uncapped, wired web → bridge → engine.

**Architecture:** The engine's compile-time budget constants become clamped runtime members behind one setter (`Engine::SetOverloadGuard`); the existing per-particle/per-round gates short-circuit when disabled. One new bridge command (`engine/set/overload-guard`) carries the config; the web owns persistence (localStorage, the theme pattern) and pushes on change + on app mount. `BridgeDispatcher` caches the last config and reapplies on `SetEngine` as engine-recreation insurance.

**Tech Stack:** C++ (engine + Win32 host, MSBuild VS18 x64), TypeScript bridge-schema (type-union, NOT zod), React + vitest (jsdom), Playwright CDP native harness.

**Spec:** `docs/superpowers/specs/2026-06-10-overload-guard-config-design.md` (user-approved). One spec correction discovered during fact-finding: the bridge schema layer is a TS type union with no runtime validation (the spec said "zod") — validation therefore lives ONLY in the C++ clamp, which the spec already mandates (§1/§6.1).

**Branch:** continues on `claude/tender-satoshi-5ff472` (folded into PR #123 per the user's call).

**Worktree state assumed:** web deps installed, dist current, host exe built, suites green at the NT-12 feel-test-fix tip (web 688 / native 177/0).

---

### Task 1: Engine — runtime guard members + setter + short-circuits

**Files:**
- Modify: `src/engine.h` (~lines 87-103 constants block, ~370-397 gate methods, ~534-545 member block)
- Modify: `src/engine.cpp` (`Clear()` ~218-230, `Update()` ~561-618)

- [ ] **Step 1: Replace the constants block (engine.h ~87-103)**

```cpp
	// Preview overload guard: ceilings on the live simulation so no
	// authored spawn parameters (or chain multiplication — every spawned
	// particle with a life/death child allocates a whole child
	// EmitterInstance) can OOM the editor. Over budget the engine
	// SUPPRESSES spawning (existing particles live out their lives) and
	// latches an overload flag the UI surfaces; spawning resumes when the
	// population decays below the resume threshold (hysteresis so the
	// boundary doesn't flicker at the 4 Hz stats rate). Authored .alo
	// values are never clamped or modified.
	//
	// [guard-config] The budgets are RUNTIME state (SetOverloadGuard),
	// user-configurable from Preferences via engine/set/overload-guard.
	// Default 25k: the old fixed 100k survived the OOM but still let the
	// preview get heavy on the climb. Disabled = fully uncapped (an
	// explicit power-user choice — CAN OOM on extreme chain effects; the
	// per-instance uint16 index cap below is a data-structure limit, not
	// part of this guard, so the unbounded dimension is instance count).
	static constexpr int kDefaultMaxPreviewParticles = 25'000;
	// One knob: the instance ceiling derives from the particle cap,
	// preserving #121's 100k:5k ratio (25k → 1,250 live instances —
	// vanilla effects run tens; raising the particle knob raises this).
	static constexpr int kInstancesDivisor           = 20;
	// Defensive clamp bounds for SetOverloadGuard — engine invariants
	// must not depend on UI-side validation (cap 0 would zero the spawn
	// budget forever and read as "editor broken"). 1M lets a power user
	// exceed the old 100k without going fully uncapped.
	static constexpr int kMinConfigurableParticles   = 1'000;
	static constexpr int kMaxConfigurableParticles   = 1'000'000;
	// Debounce on the latched overload flag: refusals only happen on
	// frames where a spawn round actually fires (e.g. every 0.1 s at
	// rate 10 while pinned at a cap), so the raw per-frame flag would
	// flicker ON/OFF between rounds. The latch clears only after this
	// long with no refusal at all.
	static constexpr float kOverloadClearDelaySec  = 0.5f;
```

(Note: `kMaxLivePreviewParticles` / `kMaxLiveEmitterInstances` are DELETED — grep for any remaining references after the edit; every one must move to the new members below.)

- [ ] **Step 2: Replace the gate methods (engine.h ~370-397)**

```cpp
    // --- Preview overload guard (see kDefaultMaxPreviewParticles) ---
    // Per-particle gate: spend one unit of the per-frame spawn budget.
    // Refusal flags this frame as overloaded; the caller drops the spawn.
    // Disabled guard: always allow — uncapped is uncapped.
    bool TryConsumeSpawnBudget()
    {
        if (!m_overloadGuardEnabled) return true;
        if (m_spawnBudget > 0) { m_spawnBudget--; return true; }
        m_overloadThisFrame = true;
        return false;
    }
    // Per-instance gate: refuse new EmitterInstances past the cap. No
    // decrement needed — m_numEmitters is kept live by OnEmitterCreated /
    // OnEmitterDestroyed (instance-death erase paths call the latter).
    bool TryConsumeInstanceBudget()
    {
        if (!m_overloadGuardEnabled) return true;
        if (m_numEmitters < m_maxPreviewInstances) return true;
        m_overloadThisFrame = true;
        return false;
    }
    // Cheap loop-exit check for spawn catch-up loops: once the budget is
    // gone there is no point iterating spawn rounds that can't spawn.
    bool SpawnBudgetExhausted() const
    {
        return m_overloadGuardEnabled && m_spawnBudget <= 0;
    }
```

(`NoteSpawnSuppressed()` and the latch accessor stay unchanged — callers only reach `NoteSpawnSuppressed` behind `SpawnBudgetExhausted`, which is now false when disabled.)

- [ ] **Step 3: Declare the new members + setter (engine.h member block ~534-545 and a public method)**

Member block becomes:

```cpp
    // Preview overload guard state (see kDefaultMaxPreviewParticles).
    // m_spawnBudget refills at the top of Update(); m_overloadThisFrame
    // accumulates refusals from the end of one Update to the end of the
    // next (so inter-frame refusals — bridge/spawner-driven instance
    // construction — count too), is folded into the latched
    // m_overloadActive at the end of Update(), then reset there.
    // [guard-config] enabled/max are runtime config (SetOverloadGuard).
    bool m_overloadGuardEnabled = true;
    int  m_maxPreviewParticles  = kDefaultMaxPreviewParticles;
    int  m_maxPreviewInstances  = kDefaultMaxPreviewParticles / kInstancesDivisor;
    int  m_spawnBudget       = kDefaultMaxPreviewParticles;
    bool m_overloadActive    = false;
    bool m_overloadThisFrame = false;
    // Time of the most recent refused spawn — drives the
    // kOverloadClearDelaySec debounce on m_overloadActive.
    TimeF m_lastOverloadTime = -1.0f;
```

Public method (declare near the other public engine-state setters; implement in engine.cpp):

```cpp
    // [guard-config] Configure the preview overload guard at runtime.
    // maxParticles is clamped DEFENSIVELY to
    // [kMinConfigurableParticles, kMaxConfigurableParticles] — engine
    // invariants must not depend on UI-side validation. Disabling clears
    // the latch immediately so the overload banner doesn't linger after
    // the user opts out.
    void SetOverloadGuard(bool enabled, int maxParticles);
```

- [ ] **Step 4: Implement the setter (engine.cpp, near Clear())**

```cpp
void Engine::SetOverloadGuard(bool enabled, int maxParticles)
{
	if (maxParticles < kMinConfigurableParticles) maxParticles = kMinConfigurableParticles;
	if (maxParticles > kMaxConfigurableParticles) maxParticles = kMaxConfigurableParticles;
	m_overloadGuardEnabled = enabled;
	m_maxPreviewParticles  = maxParticles;
	m_maxPreviewInstances  = maxParticles / kInstancesDivisor;
	if (!enabled)
	{
		// Latch off NOW — mirrors Clear()'s immediate reset so the UI
		// banner drops without waiting for the clear-delay debounce.
		m_overloadActive    = false;
		m_overloadThisFrame = false;
		m_lastOverloadTime  = -1.0f;
	}
#ifndef NDEBUG
	printf("[overload] guard config: enabled=%d maxParticles=%d (instances=%d)\n",
	       enabled ? 1 : 0, m_maxPreviewParticles, m_maxPreviewInstances);
	fflush(stdout);
#endif
}
```

- [ ] **Step 5: Switch the remaining constant readers to the members**

`engine.cpp Clear()` (~226): `m_spawnBudget = m_maxPreviewParticles;` (rest unchanged).

`engine.cpp Update()` (~565-617): wrap the refill AND the latch evaluation in the enabled check — when disabled no refusals can be recorded (the gates return early), so the latch block is dead weight; skipping it keeps `m_overloadActive` pinned false:

```cpp
	// Overload guard: refill the per-frame spawn budget. Hysteresis: once
	// overloaded, spawning stays suppressed until the population decays
	// below 90% of the cap, so the boundary doesn't flicker at the 4 Hz
	// stats rate. [guard-config] Skipped entirely when the guard is
	// disabled — the gates return early, so no refusal can be recorded
	// and the latch stays false (banner/amber never show).
	if (m_overloadGuardEnabled)
	{
		const int resumeAt = m_overloadActive
			? (m_maxPreviewParticles * 9) / 10 : m_maxPreviewParticles;
		m_spawnBudget = (m_numParticles < resumeAt)
			? m_maxPreviewParticles - m_numParticles : 0;
	}
```

…and at the end of Update, wrap the latch block (the `if (m_overloadThisFrame) … m_overloadActive = overloadNow;` section) in the same `if (m_overloadGuardEnabled) { … }`; the trailing `m_overloadThisFrame = false;` stays UNCONDITIONAL (a refusal recorded just before the guard was disabled must not leak into a later re-enable).

- [ ] **Step 6: Grep gate — no stale constant references**

Run: `grep -rn "kMaxLivePreviewParticles\|kMaxLiveEmitterInstances" src/`
Expected: zero hits (comments updated too — `engine.h` line ~373's comment and `engine.h` ~534's comment were rewritten in Steps 2-3; fix any straggler the grep finds).

- [ ] **Step 7: Build the host (PowerShell, L-046)**

```powershell
Set-Location "C:\Modding\Particle Editor\.claude\worktrees\tender-satoshi-5ff472"
& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" ParticleEditor.sln /p:Configuration=Debug /p:Platform=x64 /m /v:minimal /nologo
```

Expected: clean (benign LNK4098 only). NOTE: the legacy `src/main.cpp` build leg compiles the same engine — if it referenced the old constants the Step 6 grep already caught it.

- [ ] **Step 8: Commit**

```bash
git add src/engine.h src/engine.cpp
git commit -m "feat(guard-config): overload budgets become runtime state with clamped setter"
```

---

### Task 2: Host — bridge handler + SetEngine cache/reapply

**Files:**
- Modify: `src/host/BridgeDispatcher.h` (~line 74, `SetEngine`)
- Modify: `src/host/BridgeDispatcher.cpp` (next to the `engine/set/paused` handler, ~1442)

- [ ] **Step 1: Cache + reapply in the header**

Replace `void SetEngine(Engine* engine) { m_engine = engine; }` with:

```cpp
    void SetEngine(Engine* engine)
    {
        m_engine = engine;
        // [guard-config §2] Reapply the cached overload-guard config so a
        // recreated engine never silently reverts to defaults. Today the
        // engine is constructed once per process (HostWindow startup) and
        // this is a no-op safety net; if a future change recreates the
        // engine, the user's setting follows automatically.
        if (m_engine && m_overloadGuardCached)
            m_engine->SetOverloadGuard(m_overloadGuardEnabled, m_overloadGuardMaxParticles);
    }
```

…and add private members next to `m_engine`:

```cpp
    // [guard-config] Last config applied via engine/set/overload-guard —
    // reapplied by SetEngine (see above).
    bool m_overloadGuardCached       = false;
    bool m_overloadGuardEnabled      = true;
    int  m_overloadGuardMaxParticles = 25'000;
```

(If `Engine` is only forward-declared in the header, move the `SetEngine` body to the .cpp — check the existing include structure first and follow it.)

- [ ] **Step 2: The handler (BridgeDispatcher.cpp, directly after the `engine/set/paused` block ~1449)**

```cpp
	if (kind == "engine/set/overload-guard")
	{
		// [guard-config] View-only preview setting (like engine/set/paused):
		// never marks the document dirty. The engine clamps maxParticles
		// defensively; we cache pre-clamp intent for SetEngine reapply
		// (the engine re-clamps on every apply, so the cache needs no
		// clamping of its own).
		const bool enabled   = params.value("enabled", true);
		const int  maxParticles = params.value("maxParticles", 25'000);
		m_overloadGuardCached       = true;
		m_overloadGuardEnabled      = enabled;
		m_overloadGuardMaxParticles = maxParticles;
		if (m_engine) m_engine->SetOverloadGuard(enabled, maxParticles);
		sendOk(json::object());
		return res;
	}
```

- [ ] **Step 3: Rebuild the host**

Same MSBuild command as Task 1 Step 7. Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/host/BridgeDispatcher.h src/host/BridgeDispatcher.cpp
git commit -m "feat(guard-config): engine/set/overload-guard host handler + SetEngine reapply cache"
```

---

### Task 3: Bridge schema + MockBridge + contract tests (TDD)

**Files:**
- Modify: `web/packages/bridge-schema/src/index.ts` (Request union ~606, ResponseFor ~1000)
- Modify: `web/apps/editor/src/bridge/mock.ts` (request switch ~399, `isMutating` ~78)
- Test: `web/apps/editor/src/bridge/__tests__/bridge-contract.test.ts`

- [ ] **Step 1: Write the failing contract tests**

Append to the existing describe in `bridge-contract.test.ts` (match the file's existing import style — `MockBridge` is already imported):

```typescript
  it("engine/set/overload-guard round-trips and stores the config on the mock", async () => {
    const b = new MockBridge();
    const res = await b.request({
      kind: "engine/set/overload-guard",
      params: { enabled: false, maxParticles: 50_000 },
    });
    expect(res).toEqual({});
    // The mock has no simulation to govern; it stores the last config so
    // tests (and future mock consumers) can assert the round-trip.
    expect(b.lastOverloadGuard).toEqual({ enabled: false, maxParticles: 50_000 });
  });

  it("engine/set/overload-guard is view-only (does not mark the doc dirty)", async () => {
    const b = new MockBridge();
    await b.request({ kind: "engine/set/overload-guard", params: { enabled: true, maxParticles: 25_000 } });
    const snap = await b.request({ kind: "file/state", params: {} });
    expect(snap.dirty).toBe(false);
  });
```

(CHECK the actual dirty-state query used elsewhere in this test file — if the existing dirty assertions go through a different kind than `file/state`, mirror that exact pattern instead.)

- [ ] **Step 2: Run to verify failure**

```bash
cd "C:\Modding\Particle Editor\.claude\worktrees\tender-satoshi-5ff472\web"
pnpm --filter @particle-editor/editor exec vitest run src/bridge/__tests__/bridge-contract.test.ts
```

Expected: FAIL — TS error (unknown request kind) and/or unhandled mock kind.

- [ ] **Step 3: Schema — add the kind to the Request union (~line 606, next to engine/set/paused)**

```typescript
| { kind: "engine/set/overload-guard";     params: { enabled: boolean; maxParticles: number } }
```

…and to ResponseFor (~line 1000):

```typescript
R extends { kind: "engine/set/overload-guard" }         ? Record<string, never> :
```

- [ ] **Step 4: MockBridge — handle + classify**

In the request switch (next to `engine/set/paused`, ~399):

```typescript
case "engine/set/overload-guard":
  // View-only preview config; the mock has no simulation to govern —
  // store it so contract tests can assert the round-trip.
  this.lastOverloadGuard = { ...req.params };
  return {};
```

Add the public field near the class's other instance state:

```typescript
  // [guard-config] Last engine/set/overload-guard params received —
  // test-observable; no mock behavior depends on it.
  lastOverloadGuard: { enabled: boolean; maxParticles: number } | null = null;
```

In `isMutating` (~78), extend the view-only exclusion alongside `engine/set/paused`:

```typescript
if (kind === "engine/set/paused") return false;
// [guard-config] View-only preview setting — same rule as paused;
// native host mirrors this (handler never marks dirty).
if (kind === "engine/set/overload-guard") return false;
```

- [ ] **Step 5: Run the contract tests + full suite + types**

```bash
pnpm --filter @particle-editor/editor exec vitest run src/bridge/__tests__/bridge-contract.test.ts
pnpm --filter @particle-editor/editor test
pnpm --filter @particle-editor/editor exec tsc -b
```

Expected: contract tests PASS; full suite 690 (688 + 2); tsc 0.

- [ ] **Step 6: Commit**

```bash
git add web/packages/bridge-schema/src/index.ts web/apps/editor/src/bridge/mock.ts web/apps/editor/src/bridge/__tests__/bridge-contract.test.ts
git commit -m "feat(guard-config): engine/set/overload-guard bridge command + mock parity"
```

---

### Task 4: lib/overload-guard.ts (TDD)

**Files:**
- Create: `web/apps/editor/src/lib/overload-guard.ts`
- Test: `web/apps/editor/src/lib/__tests__/overload-guard.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi } from "vitest";
import {
  OVERLOAD_GUARD_DEFAULT,
  clampMaxParticles,
  readOverloadGuard,
  writeOverloadGuard,
  applyOverloadGuard,
} from "../overload-guard";
import type { Bridge } from "@particle-editor/bridge-schema";

// test-setup.ts clears localStorage after each test.

describe("overload-guard", () => {
  it("defaults when localStorage is empty", () => {
    expect(readOverloadGuard()).toEqual(OVERLOAD_GUARD_DEFAULT);
    expect(OVERLOAD_GUARD_DEFAULT).toEqual({ enabled: true, maxParticles: 25_000 });
  });

  it("round-trips a written config", () => {
    writeOverloadGuard({ enabled: false, maxParticles: 80_000 });
    expect(readOverloadGuard()).toEqual({ enabled: false, maxParticles: 80_000 });
  });

  it("clamps maxParticles to [1_000, 1_000_000]; NaN falls back to the default", () => {
    expect(clampMaxParticles(0)).toBe(1_000);
    expect(clampMaxParticles(999)).toBe(1_000);
    expect(clampMaxParticles(2_000_000)).toBe(1_000_000);
    expect(clampMaxParticles(25_000.7)).toBe(25_001);
    expect(clampMaxParticles(Number.NaN)).toBe(OVERLOAD_GUARD_DEFAULT.maxParticles);
  });

  it("survives corrupt localStorage (bad JSON, wrong types) with the default", () => {
    localStorage.setItem("alo:overload-guard", "{not json");
    expect(readOverloadGuard()).toEqual(OVERLOAD_GUARD_DEFAULT);
    localStorage.setItem("alo:overload-guard", JSON.stringify({ enabled: "yes", maxParticles: "many" }));
    expect(readOverloadGuard()).toEqual(OVERLOAD_GUARD_DEFAULT);
  });

  it("clamps out-of-range stored values on read", () => {
    localStorage.setItem("alo:overload-guard", JSON.stringify({ enabled: true, maxParticles: 5 }));
    expect(readOverloadGuard()).toEqual({ enabled: true, maxParticles: 1_000 });
  });

  it("applyOverloadGuard sends the clamped config over the bridge, fire-and-forget", () => {
    const request = vi.fn().mockResolvedValue({});
    applyOverloadGuard({ request } as unknown as Bridge, { enabled: true, maxParticles: 50 });
    expect(request).toHaveBeenCalledWith({
      kind: "engine/set/overload-guard",
      params: { enabled: true, maxParticles: 1_000 },
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @particle-editor/editor exec vitest run src/lib/__tests__/overload-guard.test.ts
```

Expected: FAIL — Cannot find module '../overload-guard'.

- [ ] **Step 3: Implement**

`web/apps/editor/src/lib/overload-guard.ts`:

```typescript
// overload-guard.ts — [guard-config] web side of the configurable preview
// overload guard. The WEB owns persistence (localStorage, the lib/theme.ts
// pattern); the engine is told via engine/set/overload-guard on every
// change AND once at app mount (App.tsx), so the saved setting applies at
// startup. enabled:false is fully uncapped — a power-user mode that CAN
// OOM the editor on extreme chain effects (the Preferences UI says so).
// The engine clamps defensively too; this clamp exists so the UI and
// localStorage never even hold a nonsense value.

import type { Bridge } from "@particle-editor/bridge-schema";

export type OverloadGuardConfig = { enabled: boolean; maxParticles: number };

export const OVERLOAD_GUARD_DEFAULT: OverloadGuardConfig = {
  enabled: true,
  maxParticles: 25_000,
};
export const MIN_MAX_PARTICLES = 1_000;
export const MAX_MAX_PARTICLES = 1_000_000;

const KEY = "alo:overload-guard";

export function clampMaxParticles(n: number): number {
  if (!Number.isFinite(n)) return OVERLOAD_GUARD_DEFAULT.maxParticles;
  return Math.min(MAX_MAX_PARTICLES, Math.max(MIN_MAX_PARTICLES, Math.round(n)));
}

export function readOverloadGuard(): OverloadGuardConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return OVERLOAD_GUARD_DEFAULT;
    const p = JSON.parse(raw) as Partial<OverloadGuardConfig>;
    if (typeof p.enabled !== "boolean" || typeof p.maxParticles !== "number") {
      return OVERLOAD_GUARD_DEFAULT;
    }
    return { enabled: p.enabled, maxParticles: clampMaxParticles(p.maxParticles) };
  } catch {
    return OVERLOAD_GUARD_DEFAULT;
  }
}

export function writeOverloadGuard(c: OverloadGuardConfig): void {
  localStorage.setItem(
    KEY,
    JSON.stringify({ enabled: c.enabled, maxParticles: clampMaxParticles(c.maxParticles) }),
  );
}

// Fire-and-forget: a failed send (mock quirk, host teardown) must never
// break the Preferences UI; the engine just keeps its previous config.
export function applyOverloadGuard(bridge: Bridge, c: OverloadGuardConfig): void {
  void bridge
    .request({
      kind: "engine/set/overload-guard",
      params: { enabled: c.enabled, maxParticles: clampMaxParticles(c.maxParticles) },
    })
    .catch(() => {});
}
```

- [ ] **Step 4: Run tests — 6 PASS**

- [ ] **Step 5: Commit**

```bash
git add web/apps/editor/src/lib/overload-guard.ts web/apps/editor/src/lib/__tests__/overload-guard.test.ts
git commit -m "feat(guard-config): overload-guard persistence lib (read/write/clamp/apply)"
```

---

### Task 5: PreferencesDialog UI + App wiring (TDD)

**Files:**
- Modify: `web/apps/editor/src/screens/PreferencesDialog.tsx` (gains `bridge` prop + the Preview group)
- Modify: `web/apps/editor/src/App.tsx` (PreferencesDialog call site gains `bridge={bridge}`; new mount effect)
- Test: `web/apps/editor/src/screens/__tests__/PreferencesDialog.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to the existing describe in `PreferencesDialog.test.tsx`. The dialog now REQUIRES a `bridge` prop — first update the existing tests' renders to pass a stub, via one helper at the top of the file:

```typescript
import { vi } from "vitest"; // merge into the existing vitest import

function makeBridgeStub() {
  const request = vi.fn().mockResolvedValue({});
  return { bridge: { request, on: vi.fn().mockReturnValue(() => {}) } as unknown as Bridge, request };
}
```

(Add `import type { Bridge } from "@particle-editor/bridge-schema";`. Every existing `render(<PreferencesDialog open onOpenChange={() => {}} />)` becomes `render(<PreferencesDialog bridge={makeBridgeStub().bridge} open onOpenChange={() => {}} />)` — assertions unchanged.)

New tests:

```typescript
  it("renders the preview guard controls (checkbox on, number enabled, no warning)", () => {
    const { bridge } = makeBridgeStub();
    render(<PreferencesDialog bridge={bridge} open onOpenChange={() => {}} />);
    const box = screen.getByRole("checkbox", { name: /limit preview particle count/i });
    expect(box).toBeChecked();
    const num = screen.getByRole("spinbutton", { name: /max preview particles/i });
    expect(num).toBeEnabled();
    expect((num as HTMLInputElement).value).toBe("25000");
    expect(screen.queryByText(/can crash the editor/i)).not.toBeInTheDocument();
  });

  it("unchecking sends enabled:false, persists, greys the number, shows the warning", () => {
    const { bridge, request } = makeBridgeStub();
    render(<PreferencesDialog bridge={bridge} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /limit preview particle count/i }));
    expect(request).toHaveBeenCalledWith({
      kind: "engine/set/overload-guard",
      params: { enabled: false, maxParticles: 25_000 },
    });
    expect(JSON.parse(localStorage.getItem("alo:overload-guard")!)).toEqual({
      enabled: false,
      maxParticles: 25_000,
    });
    expect(screen.getByRole("spinbutton", { name: /max preview particles/i })).toBeDisabled();
    expect(screen.getByText(/can crash the editor/i)).toBeInTheDocument();
  });

  it("committing a new cap on blur clamps, persists, and sends", () => {
    const { bridge, request } = makeBridgeStub();
    render(<PreferencesDialog bridge={bridge} open onOpenChange={() => {}} />);
    const num = screen.getByRole("spinbutton", { name: /max preview particles/i });
    fireEvent.change(num, { target: { value: "50" } });
    fireEvent.blur(num);
    expect(request).toHaveBeenCalledWith({
      kind: "engine/set/overload-guard",
      params: { enabled: true, maxParticles: 1_000 },
    });
    expect((num as HTMLInputElement).value).toBe("1000"); // clamped value reflected back
  });

  it("Enter commits the cap too", () => {
    const { bridge, request } = makeBridgeStub();
    render(<PreferencesDialog bridge={bridge} open onOpenChange={() => {}} />);
    const num = screen.getByRole("spinbutton", { name: /max preview particles/i });
    fireEvent.change(num, { target: { value: "60000" } });
    fireEvent.keyDown(num, { key: "Enter" });
    expect(request).toHaveBeenCalledWith({
      kind: "engine/set/overload-guard",
      params: { enabled: true, maxParticles: 60_000 },
    });
  });
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @particle-editor/editor exec vitest run src/screens/__tests__/PreferencesDialog.test.tsx
```

Expected: FAIL — no checkbox named /limit preview/, plus type errors on the new prop until Step 3.

- [ ] **Step 3: Implement the dialog**

`PreferencesDialog.tsx` — new prop + the Preview group after the confirm-delete row:

```tsx
import { useState } from "react";
import type { Bridge } from "@particle-editor/bridge-schema";
import { Modal } from "@/components/Modal";
import { applyMode, readStoredMode, type ThemeMode } from "@/lib/theme";
import { readConfirmDelete, writeConfirmDelete } from "@/lib/delete-emitters";
import {
  applyOverloadGuard,
  clampMaxParticles,
  readOverloadGuard,
  writeOverloadGuard,
  type OverloadGuardConfig,
} from "@/lib/overload-guard";

type Props = { bridge: Bridge; open: boolean; onOpenChange: (open: boolean) => void };
```

Inside the component (state next to the existing ones):

```tsx
  const [guard, setGuard] = useState<OverloadGuardConfig>(() => readOverloadGuard());
  // Draft string for the number field so partial typing ("2", "25") isn't
  // clamped/sent per keystroke — commit on blur/Enter only.
  const [capDraft, setCapDraft] = useState<string>(() => String(readOverloadGuard().maxParticles));

  const commitGuard = (next: OverloadGuardConfig) => {
    const clamped = { ...next, maxParticles: clampMaxParticles(next.maxParticles) };
    setGuard(clamped);
    setCapDraft(String(clamped.maxParticles));
    writeOverloadGuard(clamped);
    applyOverloadGuard(bridge, clamped);
  };
```

JSX, after the confirm-delete row inside the same flex column:

```tsx
          {/* [guard-config] Preview overload guard. OFF is fully uncapped —
              the pre-#121 behavior that CAN OOM the editor; the warning
              line states the trade (autosave #41 is the backstop). */}
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <div className="text-text-2">Preview</div>
            <div className="flex items-center justify-between">
              <label htmlFor="pref-overload-guard" className="text-text-2">
                Limit preview particle count
              </label>
              <input
                id="pref-overload-guard"
                type="checkbox"
                checked={guard.enabled}
                onChange={(e) => commitGuard({ ...guard, enabled: e.target.checked })}
                className="accent-[var(--accent)]"
              />
            </div>
            <div className="flex items-center justify-between">
              <label
                htmlFor="pref-overload-max"
                className={guard.enabled ? "text-text-2" : "text-text-3"}
              >
                Max preview particles
              </label>
              <input
                id="pref-overload-max"
                type="number"
                aria-label="Max preview particles"
                disabled={!guard.enabled}
                value={capDraft}
                min={1000}
                max={1000000}
                onChange={(e) => setCapDraft(e.target.value)}
                onBlur={() => commitGuard({ ...guard, maxParticles: Number(capDraft) })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitGuard({ ...guard, maxParticles: Number(capDraft) });
                }}
                className="w-28 rounded border border-border-2 bg-bg px-2 py-1 text-right text-xs text-text disabled:opacity-50"
              />
            </div>
            {!guard.enabled && (
              <div className="text-[11px] text-warning">
                Unlimited spawning can crash the editor on extreme effects —
                unsaved changes are at risk.
              </div>
            )}
          </div>
```

(`aria-label` on the input because the `<label htmlFor>` + role spinbutton name resolution is what the tests query; keep both consistent.)

- [ ] **Step 4: Wire App.tsx**

Find the `<PreferencesDialog` call site and add `bridge={bridge}`. Then, next to the theme mount effect (~line 83), add:

```tsx
  // [guard-config] Push the persisted overload-guard config to the engine
  // once at startup — mirrors the theme apply-on-mount above. Without
  // this the engine would sit on its built-in defaults until the user
  // first opens Preferences.
  useEffect(() => {
    applyOverloadGuard(bridge, readOverloadGuard());
  }, [bridge]);
```

Imports: `import { applyOverloadGuard, readOverloadGuard } from "@/lib/overload-guard";`

- [ ] **Step 5: Full suite + types**

```bash
pnpm --filter @particle-editor/editor test
pnpm --filter @particle-editor/editor exec tsc -b
```

Expected: **700 passed** (688 baseline + 2 contract + 6 lib + 4 dialog), tsc 0. (If any App-level test mounts AppShell with a MockBridge, the new mount effect fires a real mock request — harmless, the mock handles the kind since Task 3.)

Spec-coverage note: spec §5 lists "App mount sends the stored config once" as a web test. Deliberate deviation: the mount effect is three lines mirroring the already-tested theme pattern, and mounting the full AppShell in jsdom for it is disproportionate — restart-survival is exercised for real in Task 7 Step 6's feel test instead. If the reviewer disagrees, an AppShell smoke test asserting one `engine/set/overload-guard` request on mount is the shape.

- [ ] **Step 6: Commit**

```bash
git add web/apps/editor/src/screens/PreferencesDialog.tsx web/apps/editor/src/screens/__tests__/PreferencesDialog.test.tsx web/apps/editor/src/App.tsx
git commit -m "feat(guard-config): Preferences toggle + configurable cap, applied at mount"
```

---

### Task 6: Native harness — extend preview-overload.spec.ts

**Files:**
- Modify: `web/apps/editor/tests/preview-overload.spec.ts`

The file already has `bridgeRequest`, `waitForOverload`, and two tests that run LAST in the harness by registration order. All new tests go in this file (inheriting that ordering) and restore the default config in `finally`.

- [ ] **Step 1: Pin the existing tests to an explicit cap**

At the top of EACH existing test body (after the existing `stats/set-frozen` / `engine/set/paused` defensive calls), add:

```typescript
  // [guard-config] Pin the cap explicitly so this spec doesn't depend on
  // the engine default (now 25k, user-configurable).
  await bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 100_000 });
```

…and in each test's `finally`, restore the default:

```typescript
    await bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 25_000 });
```

The existing `BUDGET_SLACK = 110_000` and its comment stay valid (the comment's engine.h reference becomes "the configured cap (set explicitly above)" — update the comment text).

- [ ] **Step 2: New test — configurable cap respected**

```typescript
test("a lowered cap bounds the plateau at the configured value", async () => {
  test.setTimeout(120_000);
  await bridgeRequest("stats/set-frozen", { frozen: false });
  await bridgeRequest("engine/set/paused", { paused: false });
  await bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 5_000 });

  const tree = await bridgeRequest<{ root: { children: { id: number }[] } }>("emitters/list", {});
  const targetId = tree.root.children[0]?.id;
  expect(targetId).not.toBeUndefined();
  const before = await bridgeRequest<{
    properties: { lifetime: number; useBursts: boolean; nParticlesPerSecond: number };
  }>("emitters/get-properties", { id: targetId });
  const orig = before.properties;

  try {
    await bridgeRequest("emitters/set-properties", {
      id: targetId,
      patch: { nParticlesPerSecond: 1_000_000_000, lifetime: 5, useBursts: false },
    });
    await bridgeRequest("spawner/start", {
      mode: "manual", enabled: false, burstSize: 1, spacingSec: 0, intervalSec: 10,
      position: [0, 0, 0], velocity: [0, 0, 0], maxLifetimeSec: 0,
      jitterPosition: [0, 0, 0], jitterVelocity: [0, 0, 0],
    });
    await bridgeRequest("spawner/trigger", {});

    const overloaded = await waitForOverload(true, 10_000);
    expect(overloaded.hit).not.toBeNull();
    // 4 Hz sampling slack on a 5k cap: one inter-tick spawn round can
    // overshoot a little; 6k proves the 100k ceiling is NOT in play.
    for (const t of overloaded.seen) expect(t.particles).toBeLessThanOrEqual(6_000);
  } finally {
    await bridgeRequest("emitters/set-properties", { id: targetId, patch: orig });
    await bridgeRequest("spawner/stop", {});
    await bridgeRequest("engine/action/clear", {});
    await bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 25_000 });
  }
});
```

(CHECK the existing tests' cleanup blocks for the exact spawner-stop and clear kinds they use — `spawner/stop` / `engine/action/clear` above must match what the file already does; copy its cleanup verbatim.)

- [ ] **Step 3: New test — mid-run lowering decays to the new cap**

```typescript
test("lowering the cap mid-run suppresses and decays to the new ceiling", async () => {
  test.setTimeout(120_000);
  await bridgeRequest("stats/set-frozen", { frozen: false });
  await bridgeRequest("engine/set/paused", { paused: false });
  await bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 50_000 });

  const tree = await bridgeRequest<{ root: { children: { id: number }[] } }>("emitters/list", {});
  const targetId = tree.root.children[0]?.id;
  const before = await bridgeRequest<{
    properties: { lifetime: number; useBursts: boolean; nParticlesPerSecond: number };
  }>("emitters/get-properties", { id: targetId });
  const orig = before.properties;

  try {
    // lifetime 2 (not 5): faster natural decay keeps the test quick.
    await bridgeRequest("emitters/set-properties", {
      id: targetId,
      patch: { nParticlesPerSecond: 1_000_000_000, lifetime: 2, useBursts: false },
    });
    await bridgeRequest("spawner/start", {
      mode: "manual", enabled: false, burstSize: 1, spacingSec: 0, intervalSec: 10,
      position: [0, 0, 0], velocity: [0, 0, 0], maxLifetimeSec: 0,
      jitterPosition: [0, 0, 0], jitterVelocity: [0, 0, 0],
    });
    await bridgeRequest("spawner/trigger", {});
    const armed = await waitForOverload(true, 10_000);
    expect(armed.hit).not.toBeNull();

    // The spec §1 behavior under test: lowering the cap below the live
    // population must suppress spawning and let the population decay to
    // ≤ the new cap — the existing refill math handles it with no
    // special cases, and this test pins that so nobody "simplifies" it.
    await bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 5_000 });
    const decayed = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const b = (window as any).bridge;
          const timer = setTimeout(() => { off(); resolve(false); }, 15_000);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const off = b.on("stats/tick", (e: any) => {
            if (e.payload.particles <= 5_000) { clearTimeout(timer); off(); resolve(true); }
          });
        }),
    );
    expect(decayed).toBe(true);
  } finally {
    await bridgeRequest("emitters/set-properties", { id: targetId, patch: orig });
    await bridgeRequest("spawner/stop", {});
    await bridgeRequest("engine/action/clear", {});
    await bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 25_000 });
  }
});
```

- [ ] **Step 4: New test — disabled = no guard, no latch**

```typescript
test("disabled guard lets the population exceed the cap with no overload latch", async () => {
  test.setTimeout(120_000);
  await bridgeRequest("stats/set-frozen", { frozen: false });
  await bridgeRequest("engine/set/paused", { paused: false });
  // Low cap + disabled: if the guard were still active the population
  // would pin at 2k; exceeding it proves uncapped. The MODERATE rate
  // (4k/s × 5 s ≈ 20k steady-state) keeps the test host healthy — this
  // is deliberately NOT the 1e9 bomb.
  await bridgeRequest("engine/set/overload-guard", { enabled: false, maxParticles: 2_000 });

  const tree = await bridgeRequest<{ root: { children: { id: number }[] } }>("emitters/list", {});
  const targetId = tree.root.children[0]?.id;
  const before = await bridgeRequest<{
    properties: { lifetime: number; useBursts: boolean; nParticlesPerSecond: number };
  }>("emitters/get-properties", { id: targetId });
  const orig = before.properties;

  try {
    await bridgeRequest("emitters/set-properties", {
      id: targetId,
      patch: { nParticlesPerSecond: 4_000, lifetime: 5, useBursts: false },
    });
    await bridgeRequest("spawner/start", {
      mode: "manual", enabled: false, burstSize: 1, spacingSec: 0, intervalSec: 10,
      position: [0, 0, 0], velocity: [0, 0, 0], maxLifetimeSec: 0,
      jitterPosition: [0, 0, 0], jitterVelocity: [0, 0, 0],
    });
    await bridgeRequest("spawner/trigger", {});

    // Watch ~8s of ticks: population must exceed the (disabled) 2k cap
    // and overload must stay false on EVERY tick.
    const result = await page.evaluate(
      () =>
        new Promise<{ peak: number; latched: boolean }>((resolve) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const b = (window as any).bridge;
          let peak = 0;
          let latched = false;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const off = b.on("stats/tick", (e: any) => {
            peak = Math.max(peak, e.payload.particles);
            if (e.payload.overload) latched = true;
          });
          setTimeout(() => { off(); resolve({ peak, latched }); }, 8_000);
        }),
    );
    expect(result.peak).toBeGreaterThan(2_500);
    expect(result.latched).toBe(false);
  } finally {
    await bridgeRequest("emitters/set-properties", { id: targetId, patch: orig });
    await bridgeRequest("spawner/stop", {});
    await bridgeRequest("engine/action/clear", {});
    await bridgeRequest("engine/set/overload-guard", { enabled: true, maxParticles: 25_000 });
  }
});
```

- [ ] **Step 5: Rebuild dist + run the full native harness**

```bash
cd "C:\Modding\Particle Editor\.claude\worktrees\tender-satoshi-5ff472\web"
pnpm --filter @particle-editor/editor build
pnpm --filter @particle-editor/editor test:native > /tmp/native-guard.log 2>&1; echo "EXIT: $?"; grep -E "passed|failed" /tmp/native-guard.log | tail -3
```

Expected: EXIT: 0, **180 passed** (177 + 3 new), zero golden diff (`git status` clean under tests/a11y-goldens). Capture full output to the log file — NEVER gate on a piped tail (L-080).

- [ ] **Step 6: Commit**

```bash
git add web/apps/editor/tests/preview-overload.spec.ts
git commit -m "test(guard-config): configurable-cap, mid-run-lowering, and disabled-guard native specs"
```

---

### Task 7: Gates + docs (PLAN ENDS HERE — user gate before merge)

**Files:**
- Modify: `CHANGELOG.md` (new top entry)
- Modify: `tasks/todo.md` (review section)
- No ROADMAP change (this was a user-requested feel-test follow-up, not a roadmap item).

- [ ] **Step 1: Full gates**

```bash
cd "C:\Modding\Particle Editor\.claude\worktrees\tender-satoshi-5ff472\web"
pnpm --filter @particle-editor/editor test          # expect 700
pnpm --filter @particle-editor/editor exec tsc -b   # expect 0
pnpm --filter @particle-editor/editor exec vite build
```

…plus the host MSBuild (Task 1 Step 7 command) and the native run already green from Task 6.

- [ ] **Step 2: CHANGELOG entry** (new section at the top of `## Changelog`, above the NT-12 entry; date-line `*2026-06-10 · `TODO` · [#123](https://github.com/DrKnickers/new-particle-editor/pull/123)*` — same PR, hash backfilled at merge). Three sections per the house format: what ships (the toggle + tunable cap, default 25k, off = uncapped with the in-UI warning), how we tackled it (runtime-izing the #121 budgets behind one clamped setter; web-owned persistence with apply-on-mount; dispatcher cache-reapply on SetEngine), issues encountered (whatever implementation actually hits — fill from reality, not speculation).

- [ ] **Step 3: Update `tasks/todo.md`** review section with the guard-config outcome + actual test counts.

- [ ] **Step 4: Update PR #123's description** (gh pr edit --body-file, per the PowerShell quoting memory) adding a "Also ships: configurable overload guard" section + the new feel-test items.

- [ ] **Step 5: Commit docs + push**

```bash
git add CHANGELOG.md tasks/todo.md
git commit -m "docs(guard-config): CHANGELOG + todo review"
git push
```

- [ ] **Step 6: USER GATE.** The user launches the editor (L-033) and feel-tests: Preferences → toggle + cap field behavior; lower the cap to ~5k and bomb an emitter (banner at the lower ceiling); uncheck and confirm the warning text + genuinely uncapped behavior on a moderate effect; restart the editor and confirm the setting survived (the apply-on-mount path). Tune the 25k default by feel. Merge #123 only on explicit OK.
