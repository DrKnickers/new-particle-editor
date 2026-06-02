# TODO — New-UI HostWindow startup view-settings restore parity (session 11)

## 1. Goal + scope

**Goal.** When the user launches the new-UI (`--new-ui`) build, the viewport
should open with the same persisted *view settings* the legacy editor restores
at startup — background colour, ground visibility, ground texture (slot custom
paths + solid colour + selected index), and skydome (custom paths + selected
index). Today the new-UI `HostWindow` restores **none** of these (only
recent-files + last-mod), so a user who tuned their ground/background/skydome in
the legacy editor sees them reset to engine-constructor defaults in the new UI.
This is the same class of gap as the session-10 bloom fix (L-049).

**In:**
- Background colour — `BackgroundColor` REG_DWORD → `SetBackground`.
- Show-ground visibility — `ShowGround` REG_DWORD → `SetGround`.
- Ground texture: per-slot custom paths (`GroundTextureSlot%d` REG_SZ, 0..7) →
  `SetGroundSlotCustomPath`; solid colour (`GroundSolidColor` REG_DWORD) →
  `SetGroundSolidColor`; selected index (`GroundTexture` REG_DWORD, bounds
  `< kGroundTextureCount`) → `SetGroundTexture`.
- Skydome: per-slot custom paths (`SkydomeCustomSlot%d` REG_SZ, slots 9..11) →
  `SetSkydomeCustomPath`; selected index (`SkydomeIndex` REG_DWORD, bounds
  `[0, kSkydomeSlotCount)`) → `SetSkydomeSlot`.
- Whole new block gated under `!useTestHost`, sharing the existing bloom
  `if (!useTestHost)` scope.

**Out (with reasons):**
- **GroundZ** — legacy *deliberately does NOT restore it* (`main.cpp:7626`
  forces `SetGroundZ(0.0f)` every launch, by design — see the comment there).
  Parity = also force 0 (already the ctor default; we mirror the explicit reset
  for intent-clarity only).
- **Custom-colour palette** (`ReadCustomColors`) — a Win32 ColorButton concept
  with no new-UI surface yet. Separate gap.
- **Lighting** (`PushLightingToEngine`) — larger subsystem; out-of-scope unless
  asked. Separate future item.
- **Dialog positions** (`ReadSpawnerDialogPos` etc.) — legacy HWND dialogs;
  the new UI lays out panels differently. N/A.
- **Toolbar button re-sync** (`TB_CHECKBUTTON`) — legacy-only Win32 toolbar;
  the React UI reads engine state via `engine/state/snapshot`, so no manual
  control re-sync is needed (the snapshot already reflects restored state).

## 2. What the codebase already gives us

- Legacy startup restore: `src/main.cpp:7614-7692` — the exact sequence to
  mirror (background → show-ground → groundZ=0 → ground slot paths → ground
  solid colour → ground texture index → skydome custom paths → skydome index).
- Registry contract (value names / types) from the legacy helpers (all `static`
  in main.cpp → NOT linkable from the host TU, so we inline the reads):
  - `ReadBackgroundColor` `main.cpp:3177` — `BackgroundColor` REG_DWORD.
  - `ReadShowGround` `main.cpp:3205` — `ShowGround` REG_DWORD.
  - `ReadGroundTexture` `main.cpp:3269` — `GroundTexture` REG_DWORD (`< count`).
  - `ReadGroundSlotPath` `main.cpp:3307` — `GroundTextureSlot%d` REG_SZ
    (two-pass sized read; may omit trailing NUL).
  - `ReadGroundSolidColor` `main.cpp:3379` — `GroundSolidColor` REG_DWORD.
  - `ReadSkydomeIndex` `main.cpp:5510` — `SkydomeIndex` REG_DWORD (`[0,count)`).
  - `ReadSkydomeCustomPath` `main.cpp:5540` — `SkydomeCustomSlot%d` REG_SZ
    (legacy uses a `MAX_PATH` fixed buffer here).
- The session-10 bloom restore in `HostWindow.cpp:1799-1840` — the precise
  pattern to follow (open `HKCU\Software\AloParticleEditor` once, inline
  `RegQueryValueExW`, type-check, fall back to current engine value on miss,
  whole block under `!useTestHost`). We **extend this same block**.
- Engine public API (all confirmed in `Engine.h`): `SetBackground`/`GetBackground`,
  `SetGround`/`GetGround`, `SetGroundZ`, `SetGroundSlotCustomPath`,
  `SetGroundSolidColor`/`GetGroundSolidColor`, `SetGroundTexture`/`GetGroundTexture`,
  `SetSkydomeCustomPath`, `SetSkydomeSlot`; constants `kGroundTextureCount=8`,
  `kSkydomeFirstCustomSlot=9`, `kSkydomeSlotCount=12`.

## 3. Architecture / implementation approach

Single, self-contained extension of the existing bloom `if (!useTestHost) { ...
RegOpenKeyExW(...) ... }` scope in `HostWindow.cpp` (~:1812). The key is already
open there — reuse `hKey` rather than reopening it four more times (elegance +
fewer failure points). After the three `SetBloom*` calls and before
`RegCloseKey`, add, **in legacy order**:

1. `BackgroundColor` (REG_DWORD) → `engine->SetBackground(...)`, fallback
   `GetBackground()`.
2. `ShowGround` (REG_DWORD) → `engine->SetGround(v != 0)`, fallback `GetGround()`.
3. `engine->SetGroundZ(0.0f)` — unconditional; mirrors legacy's deliberate reset.
4. Loop `slot` 0..`kGroundTextureCount`: read `GroundTextureSlot%d` (REG_SZ,
   two-pass sized read, force-NUL-terminate); on non-empty →
   `SetGroundSlotCustomPath(slot, path)`. (Order: paths BEFORE the index, so the
   selected slot's `SetGroundTexture` can find its source — load-bearing.)
5. `GroundSolidColor` (REG_DWORD) → `SetGroundSolidColor(...)`, fallback
   `GetGroundSolidColor()`.
6. `GroundTexture` (REG_DWORD, bounds `< kGroundTextureCount`) →
   `SetGroundTexture(...)`, fallback `GetGroundTexture()`.
7. Loop `s` `kSkydomeFirstCustomSlot`..`kSkydomeSlotCount`: read
   `SkydomeCustomSlot%d` (REG_SZ) → `SetSkydomeCustomPath(s, path)` (empty OK —
   matches legacy passing the raw read through).
8. `SkydomeIndex` (REG_DWORD, bounds `[0, kSkydomeSlotCount)`) →
   `SetSkydomeSlot(...)`, fallback 0.

Helper lambdas to keep it tight: reuse the existing `readF` shape; add
`readDword(name, &out) -> bool` and `readSz(name) -> std::wstring` so each
restore is one readable line. No new functions outside the block; no header
changes.

**Why fold into the bloom block, not a new function:** the registry key, the
`!useTestHost` gate, and the "fall back to live engine value on miss" idiom are
identical. One open/close, one gate, one comment block referencing L-049.

## 4. Risks named up front + mitigations

1. **Determinism regression in the a11y harness.** `ShowGround` restores a
   *toggle* state that the `dialog-lighting` golden captures ("Show ground").
   If restored unconditionally, the dev machine's registry would flip the
   golden. **Mitigation:** the whole block is under `!useTestHost` (the a11y
   harness launches with `--test-host`), so the harness always sees ctor
   defaults — same guarantee bloom relies on. Verify post-change: `a11y` still
   **157 / 4 splitters**.
2. **Ground/skydome texture load failure at restore time.** `SetGroundTexture` /
   `SetSkydomeSlot` trigger a file load through TextureManager/ModManager. If a
   persisted custom path is stale/missing, the engine must fall back gracefully
   (legacy already relies on this — it falls back to dirt / off-slot).
   **Mitigation:** call after `modManager->SetEngine(engine.get())` (already the
   case at :1797) so the same fallback path legacy uses is wired; the setters
   return bool and self-heal. Verify: launch with a bogus `GroundTextureSlot0`
   path → no crash, falls back.
3. **REG_SZ without trailing NUL.** `ReadGroundSlotPath` does a two-pass sized
   read and force-terminates; a naive fixed-buffer read could miss the NUL or
   truncate long paths. **Mitigation:** mirror the two-pass sized read for
   ground slot paths; mirror legacy's `MAX_PATH` fixed buffer for skydome to
   stay byte-identical to its read.
4. **Double-restore / ordering vs. CLI file load.** The restore runs before
   `DoCloseFile`/`LoadFile` (legacy does too). A loaded `.alo` doesn't carry
   view settings, so no conflict. **Accepted:** no mitigation needed — ordering
   matches legacy.

## 5. Testing & verification

**Build (floor):**
- [ ] `pnpm --filter @particle-editor/editor test` → 392 passed (45 files) — unchanged (no web change expected).
- [ ] `pnpm --filter @particle-editor/editor build` → clean (+dist/).
- [ ] Native `.sln` Debug x64 — clean (PowerShell MSBuild, L-046).
- [ ] Native `.sln` Release x64 — clean (needed for `--test-host` CDP + faithful launch).
- [ ] `pnpm --filter @particle-editor/editor a11y` → 157 passed / 4 splitters (L-033) — **proves the `!useTestHost` gate holds**.

**Happy path (registry round-trip):**
- [ ] In legacy (or regedit), set a non-default background colour, hide ground,
      pick a non-default ground texture slot, set a solid colour, pick a skydome.
- [ ] Launch the faithful `--new-ui` (NON-test-host, since the restore is gated
      OFF under `--test-host`) and confirm via snapshot/host.log instrumentation
      that background / showGround / groundTexture / groundSolidColor /
      skydomeIndex reflect the saved values, NOT ctor defaults. **Resolve the
      verify channel before claiming pass** (the CDP bridge needs `--test-host`,
      which gates the restore off — so verification likely needs a temporary
      host.log dump of the restored engine values, or the user's on-screen
      confirm).

**Edge cases:**
- [ ] Fresh registry (no values) → all fall back to ctor defaults; no crash.
- [ ] Stale/missing custom ground path → falls back, no crash (Risk 2).
- [ ] Out-of-range `GroundTexture` / `SkydomeIndex` DWORD → bounds-rejected, default.
- [ ] Corrupt (wrong-type) value → type-check rejects, falls back.

**Arch-C on-screen confirm (hand to user — L-033):**
- [ ] User launches faithful `--new-ui`, confirms their tuned ground/background/
      skydome appears (not defaults). Agent screenshots NOT trusted.

**On landing:** CHANGELOG entry (what ships / how / gotchas) + lesson if the
verify-channel-vs-gate interaction is non-obvious + FF-push `lt-4`. No `master`.

## Review

**Shipped.** Full view-settings parity in the new-UI `HostWindow`, folded into the
existing bloom `if (!useTestHost)` registry block at
[`HostWindow.cpp:1799`](src/host/HostWindow.cpp:1799): background colour, show-ground,
ground slot custom paths → solid colour → texture index, skydome custom paths → index
(legacy order preserved). Two inline lambdas (`readDword`, two-pass `readSz`) since the
legacy `Read*` helpers are `static`. GroundZ forced to 0 (mirrors legacy intent). A
permanent `[view-restore]` `host.log` line added as the standing verification channel.

**Verification (all green).**
- vitest **392 / 45** (baseline, unchanged — no web change).
- Native Debug + Release x64 — **0 errors** (pre-existing expat C4244 + LIBCMTD LNK4098
  warnings only).
- a11y **157 passed / 4 splitters** — the documented L-033 baseline; **gate proven** (all
  157 goldens incl. `dialog-lighting` "Show ground" unchanged → restore stayed off under
  `--test-host`).
- Faithful non-test-host launch logged
  `[view-restore] bg=0x6E6E6E showGround=1 groundTex=5 groundSolid=0x626262 skydome=1` —
  every field the saved registry value, none the engine ctor default. **Restore proven
  end-to-end.**

**Deferred (named in scope, not done):** custom-colour palette (`ReadCustomColors`),
lighting (`PushLightingToEngine`), dialog positions. Separate gaps.

**Lesson captured:** **L-051** — a `!useTestHost`-gated restore can't be verified over the
`--test-host` CDP bridge (the gate disables it); verify via host.log + a faithful
non-test-host launch. (The session-10 bloom handoff carried the contradictory claim that
bit here.)

**Outstanding:** arch-C on-screen confirm by the user (L-033 — the only remaining check
the agent cannot make).
