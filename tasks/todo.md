# Plan — Lighting toolbar toggle + full lighting restore + Force Align cross-mode sync

Session 12 (2026-06-02), branch `lt-4` @ `96e1f82`. User-driven new-UI parity work.

---

## 1. Goal + scope

After this ships the new UI gains three things: (a) a **toolbar button** to
open/close the docked Lighting pane (parity with the Spawner button); (b) the
new-UI viewport **opens with the user's persisted lighting** — sun / fill1 /
fill2 angles, colours, intensities, plus ambient and shadow — restored from the
registry exactly as legacy `PushLightingToEngine` does; and (c) **Force Align
Fill Lights round-trips through the registry** (`LightingForceFillAlignment`
REG_DWORD), replacing the session-only localStorage flag so it syncs with
legacy both directions.

**In:**
1. Lighting toolbar toggle (Toolbar Group 4, next to Spawner; `Lightbulb` icon).
2. Host-side **engine** lighting restore at startup (render parity), inside the
   existing `!useTestHost` block in `HostWindow.cpp`, mirroring `PushLightingToEngine`
   (main.cpp:6376-6410).
3. Force Align **flag** bridge get/set → registry; React reads on mount, writes
   on toggle; drop the `alo:lighting:force-align` localStorage (registry is now
   the single source of truth).

**Out (deliberate):**
- **Panel raw-value display parity.** The engine stores only the folded
  `intensity×colour` Vec4, so the panel keeps showing `intensity=1` + folded
  colour after restore (pre-existing `seedFromSnapshot` quirk — same as today for
  ctor defaults). The *render* matches legacy exactly; only the panel's displayed
  split differs. Exact panel numbers would need a lighting raw-values get-bridge +
  React reseed — a follow-up, not required for visual parity. *(User OK'd
  deferral.)*
- **New-UI writing lighting *values* back to the registry on edit.** The new UI
  has never persisted lighting edits; this change is restore-on-startup only.
  Symmetric write-back is a separate parity item. (Force Align *is* written back —
  it's the one flag in scope.)

## 2. What the codebase already gives us

- `web/.../lib/right-dock.ts` — `toggleDock("lighting")` + `useRightDock()` already
  support the lighting slot; View menu already toggles it. Toolbar button is a
  ~10-line mirror of the Spawner button (`Toolbar.tsx:184-196`).
- `HostWindow.cpp:1812` `!useTestHost` block — bloom/bg/ground/skydome restore via
  inline `RegQueryValueExW` + default-on-miss + a `[view-restore]` log line.
  Lighting restore slots in right after skydome (before `RegCloseKey`, ~:1922).
- `Engine::Light{Diffuse,Specular,Position,Direction}` + `SetLight(which, Light)`,
  `SetAmbient(Vec4)`, `SetShadow(Vec4)` (BridgeDispatcher.cpp:1331-1362) — build the
  struct host-side, no JSON round-trip. `Engine::LT_SUN/LT_FILL1/LT_FILL2`.
- Legacy canon (verified this session):
  - `PushLightingToEngine` main.cpp:6376-6410 — restore logic + force-align fill calc.
  - `MakeLight` main.cpp:6222 — `chan/255*intensity` fold; fills pass `RGB(0,0,0)` spec.
  - `DirectionFromZTilt` main.cpp:6209; `ColorToVec4` main.cpp:6244 (ambient/shadow, α=0).
  - REG types: floats `REG_BINARY`+finite; colours `REG_DWORD`; force-align `REG_DWORD`.
  - Defaults main.cpp:6180-6195; offsets `kForceAlignFill1Offset=120`, `…2=210`,
    `kForceAlignFillTilt=-10`; `kLightForceAlignDefault=true`.
- `BridgeDispatcher` ctor (BridgeDispatcher.cpp:680) constructed at
  `HostWindow.cpp:3035` where the `useTestHost` member is in scope — plumb it in.
- a11y: only `toolbar.composition.golden.yaml` changes (+1 button). `dialog-lighting`
  stays byte-identical (restore gated off + force-align default-true under test-host).

## 3. Architecture / implementation approach

### 3.1 Toolbar toggle (web only)
`Toolbar.tsx` Group 4: add a `Lightbulb` button after the Spawner button —
`aria-pressed={useRightDock()==="lighting"}`, `onClick={()=>toggleDock("lighting")}`,
`aria-label`/`title` "Toggle Lighting panel". Add `lighting` to the destructured
`useRightDock()` read. New Toolbar test mirroring the Spawner toggle case
(click→dock="lighting", aria-pressed both ways, exclusive with Spawner).
Regenerate `toolbar.composition.golden.yaml` (composition lane ONLY, L-052),
diff-review the single new node.

### 3.2 Host engine lighting restore (native)
In the `!useTestHost` block, after skydome (~HostWindow.cpp:1906) and before the
`[view-restore]` log, add a lighting restore:
- `readF`-style binary-float reader already exists (`readF`, :1826) — reuse for the
  9 float keys. Add a `readColor` lambda (`REG_DWORD`→COLORREF) for the 7 colour
  keys; `readDword` (:1850) already exists for force-align.
- Read: sun intensity/z/tilt/diffuse/specular/ambient/shadow; force-align; fill1
  intensity/z/tilt/diffuse; fill2 intensity/z/tilt/diffuse — names per
  `kLightingRegistryKeys` (main.cpp:6359), defaults per main.cpp:6180-6195.
- Force-align fill calc (verbatim main.cpp:6400-6403): `fillN_z = forceAlign ?
  sunZ+offsetN : persisted; fillN_tilt = forceAlign ? -10 : persisted`.
- Build `Engine::Light` inline (replicate `MakeLight`: Position from z/tilt,
  Diffuse/Specular = chan/255*intensity, fills spec=0); `SetLight(LT_SUN/FILL1/FILL2)`,
  `SetAmbient(colorToVec4(ambient))`, `SetShadow(colorToVec4(shadow))`.
- Add `[lighting-restore]` log line (the L-051 no-user channel):
  `sunZ=… sunTilt=… forceAlign=… fill1Z=… fill2Z=…`.

### 3.3 Force Align flag bridge (schema + host + web)
Schema (`bridge-schema/src/index.ts`): two kinds —
`settings/lighting-force-align` (get) → `{ enabled: boolean }`;
`settings/lighting-force-align/set` `{ enabled: boolean }` → ok. Add to the request
union + result types; mirror in MockBridge (`bridge/mock.ts` / `mock-state.ts`) so
browser-dev + vitest resolve it.
Host (`BridgeDispatcher`): plumb `bool m_testHost` (ctor param, passed at
HostWindow.cpp:3035). get → `m_testHost ? kDefault(true) : RegRead DWORD
LightingForceFillAlignment`; set → `if (m_testHost) noop; else RegWrite DWORD`.
React (`LightingPanel.tsx`): remove `alo:lighting:force-align` localStorage; init
`forceAlign=true` synchronously; on mount `bridge.request(settings/lighting-force-align)`
→ if differs, `setForceAlign`; `handleForceAlignToggle` fires
`settings/lighting-force-align/set`. Under test-host get returns true → no flip →
`dialog-lighting` golden unchanged.

## 4. Risks + mitigations

1. **Wrong REG type → silent default fallback (no-op restore).** RESOLVED: floats
   `REG_BINARY`+finite, colours/force-align `REG_DWORD` (read the legacy helpers).
   The `[lighting-restore]` log proves restored values are the *saved* ones
   (distinct from ctor defaults on this dev box) — L-051.
2. **a11y golden drift.** Only `toolbar.composition.golden.yaml` may change (+1
   button); `dialog-lighting` must stay byte-identical. Diff-review confirms; never
   touch the legacy `.golden.json` lane (L-052).
3. **Force-align fill math diverges from legacy.** Copy constants/offsets verbatim
   (main.cpp:6200-6203); assert via the log line.
4. **Native rebuild needed (3.2/3.3).** `.sln` Debug+Release x64 via PowerShell
   (L-046); fresh-worktree WebView2 NuGet into `packages/` (L-039).
5. **Bridge schema drift between TS + MockBridge + host.** The `bridge-contract`
   test guards round-trips; add the new kinds to MockBridge so vitest stays green.

## 5. Testing & verification

- **Toolbar:** vitest (click→dock="lighting"; aria-pressed both ways; exclusive
  with Spawner). CDP-DOM: button renders, toggles the docked column.
- **Lighting restore:** faithful non-`--test-host` launch → `host.log`
  `[lighting-restore]` equals registry values, not ctor defaults (L-051). Engine
  pixels → user (L-033).
- **Force Align sync:** new-UI toggle → registry `LightingForceFillAlignment`
  flips; flip in legacy → relaunch new UI → checkbox + host.log reflect it.
- **Regression:** vitest green (+ new tests); composition a11y unchanged except
  toolbar (+1); `.sln` Debug+Release clean.
- **Debug instrumentation:** `[lighting-restore]` host.log line (permanent, L-051).

---

## Review

**Shipped all three deliverables.** Files touched:
- Schema: `web/packages/bridge-schema/src/index.ts` (+2 kinds: `settings/lighting-force-align` get + `…/set`).
- Mock: `bridge/mock.ts` (in-memory flag, default true) + `bridge/__tests__/bridge-contract.test.ts` (round-trip test).
- React: `screens/LightingPanel.tsx` (drop localStorage → bridge get on mount + set on toggle).
- Toolbar: `components/Toolbar.tsx` (Lightbulb button) + `__tests__/Toolbar.test.tsx` (toggle + exclusivity test).
- Native: `host/BridgeDispatcher.{h,cpp}` (plumb `useTestHost`; 2 settings handlers, registry-backed, test-host-gated),
  `host/HostWindow.cpp` (lighting restore block mirroring `PushLightingToEngine` + `[lighting-restore]` log; pass `useTestHost` to dispatcher).
- a11y: 19 composition goldens regenerated (+1 `Toggle Lighting panel` node each); 0 legacy `.golden.json` touched.

**Verification (all green):**
- `pnpm …editor build` clean (tsc + vite); `pnpm …editor test` → **405 passed** (was 403; +2 new tests).
- `.sln` Debug **and** Release x64 → Build succeeded, 0 errors (warnings pre-existing: LIBCMTD/expat).
- `pnpm …editor a11y` → **155 passed / 4 splitter artifacts** (documented baseline). Aggregate golden diff =
  `19 files, +19 insertions, 0 deletions`, every line the one button node (L-053).
- **Lighting restore (L-051, host.log, two-launch):** Force Align ON → `fill1Z=120 fill2Z=210` (computed);
  flag flipped OFF → `fill1Z=129 fill2Z=301` (persisted saved values, distinct from defaults *and* computed) →
  proves the restore reads saved registry data. Flag restored to the user's original value (1).

**Plan miss worth noting:** predicted "only `toolbar.composition.golden.yaml` changes" — actually **19** goldens
(the toolbar is embedded in every chrome snapshot). Captured as **L-053**.

**Deferred (per design Out list):** panel raw-value display parity (panel shows `intensity=1` + folded colours;
render is correct), and new-UI writing lighting *values* back on edit. **One user verification step:** the Force
Align *write* path (toggle in new UI → registry flips → seen by legacy) can't be agent-driven on a faithful launch.

---

## Follow-up (same session) — resolve the two deferred items the user asked about

User asked to (1) test the Force Align write path with no participation, and (2) fix the panel raw-value display.
Both shipped:

- **Test seam (`ALO_SETTINGS_LIVE`):** the `--test-host` settings gate is now `m_testHost && !m_settingsLive`;
  the env var lifts it so a CDP launch drives the real registry while the a11y harness (never sets it) stays
  deterministic. Committed [`scripts/verify-force-align.mjs`](web/apps/editor/scripts/verify-force-align.mjs)
  launches `--test-host` + the env, drives the real Lighting checkbox over CDP, asserts the registry write +
  raw display, restores the registry in a `finally`. **5/5 checks pass, no user.** → **L-054**.
- **Raw display fix:** the force-align get became a unified `settings/lighting` get returning the raw lighting
  split (intensity/colour separate, angles in degrees) from the registry; `LightingPanel` seeds its displayed
  controls from it (dropping `azAltFromDirection`). Engine render unchanged (host restore drives it); both read
  the same registry so they agree. **Caveat:** the pane re-seeds from the registry on reopen (unmount-on-close),
  so in-session edits aren't reflected on reopen until lighting-value write-back lands — a strict improvement for
  the common cases, not a regression.

**Verification:** vitest **406** (contract test split 1→2); `.sln` Debug+Release x64 clean; `verify-force-align.mjs`
5/5; `dialog-lighting` a11y golden regenerated — flipped from the folded values (`1.00`, `#FFFFFF`, `#000000`) to
the true defaults (`0.50`, `#B4B4BE`, `#282832`); **only that golden changed**, 0 legacy `.golden.json` touched.

**Still deferred:** new-UI lighting-VALUE write-back (registry on edit) + reopen-after-edit persistence — a
separate parity item. Force Align flag write-back IS done.
