# Configurable preview overload guard (design)

*2026-06-10 · user-requested at the NT-12 feel test ("prevent the spawn of a
crash-worthy number of particles + a settings toggle") · folded into PR #123
per the user's explicit sequencing call · designed via brainstorming; the two
scope forks (what to protect, off-semantics) and approach B (configurable
cap) picked explicitly by the user.*

## Purpose

The #121 overload guard hard-caps the live preview at compile-time constants
(100,000 particles / 5,000 instances). That stops the OOM crash, but the
preview still gets heavy on the climb toward 100k — the user wants the
preview to *stay light* by default, with the ceiling under their control.

Ship: the budgets become **runtime-configurable** with a **lower default
(15,000 particles)**, plus a Preferences **toggle**. Toggle ON (default):
cap at the user's chosen value. Toggle OFF: **fully uncapped** — the
pre-#121 power-user behavior, which genuinely can OOM the editor on an
extreme effect (user-accepted tradeoff; the UI says so out loud).

Non-goals (explicitly out):

- **No edit-time blocking.** NT-11's ⚠ stays advisory; authored `.alo`
  values are never refused or clamped. This feature governs only the live
  preview simulation.
- **No independent instance-cap knob.** The instance ceiling derives from
  the particle cap (see §1) — one knob.
- **No protection for the game.** A saved effect that would crash
  `StarWarsG.exe` is out of scope here (the ⚠ glyph is that surface).
- **No per-emitter pre-checks.** The global budget already bounds the sum;
  a per-burst precheck adds nothing the per-particle gate doesn't.

## Decisions (user-approved)

| Question | Decision |
|---|---|
| What to protect | **Preview feel** — the editor preview should stay light; 100k is too heavy a ceiling. (The preview's crash-safety itself was already #121.) |
| Toggle OFF semantics | **Fully uncapped** — no overload budget at all; can OOM. Power-user mode, dangers stated in the UI. (Rejected: falling back to the 100k net.) |
| Cap configurability | **Approach B: user-configurable number** (rejected fixed lower cap) — preview feel is the user's judgment (L-033), so the ceiling is tunable in Preferences without a rebuild. |
| Default / range | **15,000** particles, enabled. Input clamps to **1,000 – 1,000,000** (1M lets a power user exceed the old 100k without going uncapped). |
| Sequencing | Folded into the NT-12 branch / PR #123 (user's call). |

## §1 Engine (C++): budgets become runtime state

`engine.h` / `engine.cpp`:

- `kMaxLivePreviewParticles` / `kMaxLiveEmitterInstances` stop being the
  live values. New members:
  - `bool m_overloadGuardEnabled = true;`
  - `int  m_maxPreviewParticles = kDefaultMaxPreviewParticles;  // 15'000`
  - `int  m_maxPreviewInstances = kDefaultMaxPreviewParticles / kInstancesDivisor;`
  - `static constexpr int kDefaultMaxPreviewParticles = 15'000;`
  - `static constexpr int kInstancesDivisor = 20;` — preserves #121's
    100k:5k ratio. At the default this allows **750 live instances**
    (documented choice: vanilla effects run tens of instances; chains that
    legitimately need more raise the particle knob, which raises this too).
  - Clamp constants `kMinConfigurableParticles = 1'000`,
    `kMaxConfigurableParticles = 1'000'000`.
- New setter (single entry point, host-thread only like all engine calls):

  ```cpp
  // Configure the preview overload guard at runtime. maxParticles is
  // clamped to [kMin..kMaxConfigurableParticles] DEFENSIVELY — engine
  // invariants must not depend on UI-side validation (a cap of 0 would
  // zero the spawn budget forever and read as "editor broken").
  void SetOverloadGuard(bool enabled, int maxParticles);
  ```

  Disabling clears the latch + refusal state immediately (like `Clear()`),
  so the banner doesn't linger after the user opts out.
- Guard methods short-circuit when disabled: `TryConsumeSpawnBudget` /
  `TryConsumeInstanceBudget` return `true`, `SpawnBudgetExhausted` returns
  `false`, the `Update` refill/latch block is skipped (latch stays false →
  `stats/tick` never reports overload → banner/amber never show).
- All sites that read the old constants (`Update` refill + hysteresis,
  `Clear` refill, instance gate) switch to the members. **"Bail earlier"
  needs no new mechanism** — a lower cap makes the existing per-round
  `SpawnBudgetExhausted` bail and the per-particle gate engage sooner.
- **Mid-run changes are handled by the existing math, on purpose**: the
  per-frame refill `max(0, cap - population)` means lowering the cap below
  the live population yields budget 0 → suppression + latch + banner →
  decay to 90% of the NEW cap (hysteresis uses the member); raising it
  resumes next frame. No special-casing — and a native test pins this so
  nobody "simplifies" it away (§5).
- The structural per-instance uint16 index cap (16,383, EmitterInstance)
  is a data-structure limit, NOT part of this guard — it stays even when
  the guard is off. (Uncapped mode therefore still bounds particles *per
  instance*; the unbounded dimension is instance count — the accepted OOM
  vector.)

## §2 Engine lifetime + host reapply (hardening)

Verified: the new-UI host constructs the Engine **once per process**
(`HostWindow.cpp` ~1928, startup; mod switches hot-swap shaders/textures on
the same object via `ModManager::SetEngine`; device-loss recovery resets
D3D resources, not the object). The web's send-on-mount therefore lands
after the engine exists, and the setting survives mod switches and resizes.

Insurance anyway: `BridgeDispatcher` caches the last-applied
`{enabled, maxParticles}` and reapplies it inside `SetEngine()` whenever a
non-null engine is bound. If a future change ever recreates the engine,
the guard config follows automatically instead of silently reverting.
(Precedent for host-side restore-at-construction: the bloom registry
restore at the same construction site.)

## §3 Bridge: one new command

`engine/set/overload-guard { enabled: boolean, maxParticles: number } → { ok: true }`

- Schema in the bridge-schema package (a TypeScript Request-union +
  ResponseFor entry — the schema layer is type-only, NO runtime
  validation, which is why the engine-side clamp in §1 is load-bearing),
  host handler in
  `BridgeDispatcher` (caches per §2, clamps via the engine setter), mock
  parity: MockBridge accepts and stores it (no sim to govern; stored so
  bridge-contract tests can assert the round-trip).
- Not in the engine snapshot: the web owns the config (localStorage) and
  pushes it; the engine never needs to report it back.

## §4 Web: Preferences UI + persistence

- New `web/apps/editor/src/lib/overload-guard.ts`:

  ```ts
  export type OverloadGuardConfig = { enabled: boolean; maxParticles: number };
  export const OVERLOAD_GUARD_DEFAULT: OverloadGuardConfig = { enabled: true, maxParticles: 15_000 };
  export function readOverloadGuard(): OverloadGuardConfig;   // localStorage, clamped
  export function writeOverloadGuard(c: OverloadGuardConfig): void;
  export function clampMaxParticles(n: number): number;       // [1_000, 1_000_000], NaN → default
  export function applyOverloadGuard(bridge: Bridge, c: OverloadGuardConfig): void; // fire-and-forget send
  ```

- `PreferencesDialog` gains a "Preview" group under the existing rows,
  following the `confirmDelete` checkbox pattern:
  - Checkbox **"Limit preview particle count"** (default checked).
  - Number input **"Max preview particles"**, disabled/greyed while
    unchecked; commits on blur/Enter; clamped via `clampMaxParticles`.
  - While unchecked, an amber helper line (uses the `--warning` token):
    **"Unlimited spawning can crash the editor on extreme effects —
    unsaved changes are at risk."** Autosave (#41) softens the blast
    radius, but the user sees the trade explicitly.
  - Every change: `writeOverloadGuard` + `applyOverloadGuard` (live —
    no restart).
- `App` (AppShell mount): read localStorage once and `applyOverloadGuard`,
  mirroring how the stored theme applies on mount, so the engine syncs to
  the saved setting at startup.

## §5 Testing & verification

Native (`preview-overload.spec.ts` extensions — it already drives bombs
through the real host):

1. **Configurable cap respected**: set cap 5,000 via the bridge → drive the
   existing 1e9/s bomb → plateau ≤ 5,000 + overload latch + recovery.
2. **Mid-run lowering**: with population ~plateaued at a higher cap, lower
   the cap → population decays below 90% of the new cap, latch clears.
3. **Disabled = no guard**: `enabled:false` → drive a *moderate* effect
   (~20k steady-state — deliberately modest so the test host stays healthy)
   → population exceeds a previously-set low cap, `overload` stays false
   throughout.
4. Existing #121 specs updated for the new default (their budget references
   become the configured value, set explicitly at test top so they don't
   depend on the default).

Web (vitest): `overload-guard.ts` read/write/clamp (NaN, out-of-range,
missing key → default); PreferencesDialog (checkbox + number render, change
→ localStorage written + bridge command sent with clamped value, helper
line visible only while unchecked); App mount sends the stored config once;
bridge-contract test for the new command shape + mock storage.

Host build + full suites per the standard gates; then the user feel test
tunes the 15k default (the whole feature exists to serve preview feel —
L-033).

## §6 Risks

1. **Cap=0 / garbage via the bridge bricks spawning** → engine-side clamp
   in `SetOverloadGuard` (§1); web clamps too, but the engine doesn't
   trust it.
2. **Engine recreation reverts the setting** → verified once-per-process
   today + dispatcher cache-and-reapply insurance (§2).
3. **User forgets the guard is off and loses work to an OOM** → amber
   warning in Preferences (§4); autosave (#41) as backstop. Accepted —
   uncapped is an explicit power-user choice.
4. **Existing #121 regression specs assume 100k** → they set their cap
   explicitly (§5.4), decoupling them from the default.
5. **Mid-run cap edits hit untested refill paths** → the refill math
   already handles both directions with no special cases; §5.2 pins it.
