# VPT-3 — Autosave port to the new UI (arch-C)

**Status:** PLAN — design approved by user (2026-06-05). Awaiting plan check-in before coding.
**Branch:** `lt-4` flow (session branch → FF into lt-4). Native + web both touched.
**Baseline this session:** native harness 165/0 (+ host-death guard); web vitest 471; lt-4 = `e6eb6bb`.

> **Refinement vs the approved design (flag):** the approved design had the HOST push an
> `autosave/recovery-available` event at startup. Exploration found that's racy — navigation is
> async, so the event can fire before React subscribes and be lost. **Flip to React-initiated:**
> React calls a NEW request `autosave/check-recovery` on mount; the host scans and RETURNS the
> orphan (or null) in the response. Same UX, no race, simpler. The recover choice stays a second
> command. (No host→React event needed at all.)

## 1. Goal + scope

**Goal.** A new-UI user gets legacy's crash-safety net: two-tier background autosave (30s recent /
5min stable) and, on a normal launch, a React dialog offering to restore an orphaned autosave left
by a crashed prior session — loaded as if it were the original file (dirty, Ctrl+S targets the
original), never silently overwriting their `.alo`.

**In:**
- Host: drive the two `Autosave` timers in `HostWindow` `WM_TIMER`; `Write` gated on `GetDirty()`;
  `DeleteOurSession` on `file/save` + clean shutdown.
- Two NEW bridge commands: `autosave/check-recovery` (scan → orphan|null) and
  `autosave/recover { choice: "recent" | "stable" | "discard" }` (load+swap or discard, then
  `DeleteOrphan`).
- New React `AutosaveRecoveryDialog` (3-state, varies by tiers present) + a hook that calls
  check-recovery on mount.
- Schema + MockBridge stubs; vitest for the dialog; native a11y golden + bridge round-trip test.

**Out (deliberate):**
- Any change to `src/Autosave.{h,cpp}` — reused verbatim (the legacy module is UI-agnostic and
  already linked into `ParticleEditor.exe`).
- Configurable intervals / a settings UI for autosave (legacy has none; out-of-scope).
- Autosaving engine/preview-only state (lighting/bloom/camera) — those aren't in the
  `ParticleSystem` snapshot, matching legacy + the VPT-2 undo scope decision.
- A host-side Win32 fallback prompt (we chose the React dialog; no dual path).
- Recovery under `--test-host` or when a CLI file path is given (suppressed — see Risk 4).

## 2. What the codebase already gives us (verified file:line)

- **Data layer, reuse as-is:** `Autosave::Write(sys, originalFilename, tier)`,
  `ScanForOrphan(OrphanSession*)`, `DeleteOurSession()`, `DeleteOrphan(session)`, timer IDs 3/4 +
  intervals ([src/Autosave.h](src/Autosave.h)). Already compiled into `ParticleEditor.exe`
  (`<ClCompile Include="Autosave.cpp">` in [src/ParticleEditor.vcxproj](src/ParticleEditor.vcxproj));
  the host can call `Autosave::` directly — **no project changes.**
- **Legacy wiring to mirror:** timers `SetTimer(RECENT/STABLE)` + `WM_TIMER → Autosave::Write`
  ([src/main.cpp:2227](src/main.cpp:2227)–2246); 3-state prompt semantics
  ([src/main.cpp:1145](src/main.cpp:1145) `ShowRecoveryPrompt`); restore-as-original
  ([src/main.cpp:1189](src/main.cpp:1189) `RestoreFromAutosave`); startup scan
  ([src/main.cpp:7763](src/main.cpp:7763)).
- **Host file-state:** `BridgeDispatcher::GetDirty()` / `GetCurrentFilePath()`, `m_currentFilePath`,
  `m_dirty`, `SetDirty()` ([src/host/BridgeDispatcher.h:206](src/host/BridgeDispatcher.h:206)).
- **file/open swap+notify to reuse:** [src/host/BridgeDispatcher.cpp:1974](src/host/BridgeDispatcher.cpp:1974)–2124
  — `LoadParticleSystem` → kill attached cursor-bound instance → `*m_pParticleSystem = move(loaded)`
  → `m_engine->Clear()` + `OnParticleSystemChanged(-1)` + `ReloadTextures()` → set path/dirty →
  `EmitEngineStateChanged()` + `EmitEmittersTreeChanged()`. (Killing the attached instance + the
  `OnParticleSystemChanged(-1)` reseat is the L-059 orphaned-cursor guard — reuse, don't hand-roll.)
- **Request dispatch:** `if (kind == "...")` chain in `BridgeDispatcher.cpp` (e.g. `file/new` at
  [:1764](src/host/BridgeDispatcher.cpp:1764)); `sendOk(json)` for responses.
- **Existing WM_TIMER:** the 250ms stats timer at [src/host/HostWindow.cpp:2100](src/host/HostWindow.cpp:2100)–2104
  — add the two autosave timers next to it.
- **Schema:** Request union ~line 497, Event union ~line 1021 in
  [web/packages/bridge-schema/src/index.ts](web/packages/bridge-schema/src/index.ts). MockBridge
  `handle()` dispatch in [web/apps/editor/src/bridge/mock.ts](web/apps/editor/src/bridge/mock.ts)
  (~129–170).
- **React subscription/request precedent:** `bridge.on(kind, handler)` + request usage in
  [web/apps/editor/src/lib/file-state.ts](web/apps/editor/src/lib/file-state.ts) (121–135).
- **--test-host / --new-ui / CLI file + `host::Run(testHost)`:** [src/main.cpp:8015](src/main.cpp:8015)–8188.

## 3. Architecture / implementation approach

**Host C++:**
1. **Timers** ([HostWindow.cpp](src/host/HostWindow.cpp)): on the same init path as `kStatsTimerId`,
   `SetTimer(hwnd, Autosave::RECENT_TIMER_ID, 30s)` + `STABLE`. In `WM_TIMER`, on a tier id and
   `dispatcher->GetDirty()`, call `Autosave::Write(currentParticleSystem,
   dispatcher->GetCurrentFilePath(), tier)`. `KillTimer` + `Autosave::DeleteOurSession()` on
   teardown.
2. **DeleteOurSession on save:** in `file/save` / `file/save-as` success, call
   `Autosave::DeleteOurSession()` (the autosave is consumed once the real file is written).
3. **`autosave/check-recovery`** (new request): if `testHost` or a CLI file was given → return
   `{ orphan: null }`. Else `Autosave::ScanForOrphan(&s)`; on hit, return
   `{ orphan: { originalFilename, recentMtimeMs|null, stableMtimeMs|null } }` (mtimes as numbers;
   React formats "N minutes ago"). Stash the live `OrphanSession` on the dispatcher so `recover`
   can consume it without re-scanning.
4. **`autosave/recover { choice }`** (new request): for `recent`/`stable`, run the file/open
   swap+notify sequence on the chosen temp path, then **override** `m_currentFilePath =
   stashed.originalFilename` (empty ⇒ untitled) and `SetDirty(true)`, then
   `EmitEngineStateChanged()` + `EmitEmittersTreeChanged()`. For `discard`, no document change.
   Always `Autosave::DeleteOrphan(stashed)` + clear the stash. `sendOk({})`.

**React/TS:**
5. **Schema:** add to Request union — `{ kind: "autosave/check-recovery"; params: {} }` →
   response `{ orphan: OrphanInfo | null }`, and `{ kind: "autosave/recover"; params: { choice } }`.
   Add `OrphanInfo` type. No Event union change (React-initiated).
6. **MockBridge:** `check-recovery` → `{ orphan: null }`; `recover` → `{}`. (So `pnpm dev` + web
   vitest never see a recovery prompt.)
7. **Dialog + hook:** `useAutosaveRecovery()` runs once on mount → `bridge.request(check-recovery)`;
   if `orphan`, opens `AutosaveRecoveryDialog`. Dialog renders the variant for the tiers present
   (both → 3 buttons; single → 2), shows original filename + ages; each button dispatches
   `recover { choice }` and closes. Mount the hook high in `AppShell` (real launch only — under the
   mock it no-ops via `{ orphan: null }`).

**Data flow:** mount → check-recovery → (host scan) → orphan → dialog → choice → recover → (host
load+swap or discard + DeleteOrphan) → engine/state/changed → UI reflects restored doc (dirty).

## 4. Risks + mitigations

1. **Startup event race (the design pivot).** A host-pushed startup event can fire before React
   subscribes → lost prompt. *Mitigation:* React-initiated request/response (`check-recovery` on
   mount); the host never pushes an unsolicited recovery event.
2. **Orphaned-cursor crash on restore (L-059).** Loading a new ParticleSystem while a cursor-bound
   attached instance is live asserts in the engine. *Mitigation:* reuse the EXACT `file/open`
   swap sequence (kill attached + `OnParticleSystemChanged(-1)` reseat); do not hand-roll the load.
3. **Serializing the sim mid-frame.** `Write` reads the `ParticleSystem` during `WM_TIMER`.
   *Mitigation:* the host pump is single-threaded (PeekMessage loop, same as legacy); `WM_TIMER`
   runs between frames on the UI thread — never a worker. Matches legacy exactly.
4. **Recovery polluting the test harness.** A real recovery prompt mid-`test-host` would corrupt
   a11y captures (cf. L-066 poisoning). *Mitigation:* `check-recovery` returns null under
   `testHost`; the dialog's a11y golden is driven by a SYNTHETIC orphan (a test-only route/param
   or a forced render), never the real scan. Add an assertion that check-recovery is null under
   test-host.
5. **Empty originalFilename.** A crashed untitled doc has no original path. *Mitigation:* restore
   sets `m_currentFilePath = ""` (untitled) + dirty; React shows "Unsaved new file"; Ctrl+S →
   Save-As. Matches legacy's `ShowRecoveryPrompt` "Unsaved new file" label.
6. **Stash lifetime.** `check-recovery` stashes the `OrphanSession`; `recover` consumes it. If
   React calls recover without a prior check (or twice) the stash is empty. *Mitigation:* `recover`
   no-ops + `sendOk` when the stash is empty; clear after consume.
7. **Dirty-gated autosave skips clean docs.** A user who opens a file and crashes without editing
   gets no autosave. *Accepted:* the saved file is intact; there's nothing unsaved to recover.

## 5. Testing & verification

**Web (vitest):**
- `AutosaveRecoveryDialog` renders all 3 variants (both / recent-only / stable-only); empty
  filename → "Unsaved new file"; each button dispatches `recover` with the right `choice`.
- `useAutosaveRecovery` opens the dialog only when `check-recovery` returns an orphan; no dialog on
  `{ orphan: null }` (the mock path → `pnpm dev` unaffected).

**Native (.sln Debug x64 — host C++ changed; restore packages/ L-039, MSBuild L-046):**
- Bridge round-trip (new spec): `check-recovery` returns null under `--test-host` (Risk 4);
  `recover { discard }` leaves the doc + clears stash; `recover { recent }` with a stash loads &
  flips dirty (drive via a seeded stash if a real orphan is impractical in-harness).
- a11y composition golden for `AutosaveRecoveryDialog` via a synthetic-orphan `DIALOG_SURFACES`
  driver (NOT the real scan).
- Full harness still green (target 165 + new tests, 0 failed). The host-death guard stays.

**Manual smoke (timing/crash paths the harness can't do deterministically):**
- Edit → wait 30s → confirm `%TEMP%\AloParticleEditor\autosave-<pid>-recent.alo` appears; 5min →
  stable. Edit-free open → no recent write (dirty gate).
- Kill the editor (Task Manager) mid-edit → relaunch (no CLI file) → recovery dialog appears →
  Restore recent → title shows original + asterisk, Ctrl+S targets original; temp not in recents.
- Restore stable / Discard variants. Clean quit → relaunch → NO prompt (DeleteOurSession). Recover
  → relaunch → NO prompt (DeleteOrphan consumed).

**Debug instrumentation:** `#ifndef NDEBUG` `fprintf(stderr, "[autosave] ...")` on Write (tier+path),
ScanForOrphan (hit/miss), recover (choice+path). Grep tag: `[autosave]`.

**Effort:** ~★★★☆☆ (3/5) — data layer free; cost is the bridge commands + React dialog + a11y/test
surface. Roadmap rated the original engine ★★☆☆☆; the port adds the UI/bridge half.

---

## REVIEW — VPT-3 SHIPPED (all automated gates green)

Built exactly the approved design with one flagged refinement (React-initiated check-recovery
instead of a host-pushed event — sidesteps the fire-before-subscribe race).

**Files touched.** `web/packages/bridge-schema/src/index.ts` (AutosaveOrphan + 2 commands);
`web/apps/editor/src/bridge/mock.ts` (stubs); `src/host/BridgeDispatcher.{h,cpp}` (stash + 2
handlers + DeleteOurSession on save); `src/host/HostWindow.cpp` (timers + dirty-gated Write +
clean-exit cleanup, all gated `!useTestHost`); `web/apps/editor/src/screens/AutosaveRecoveryDialog.tsx`
(new: pure View + container); `App.tsx` (mount + `?demo=autosave-recovery`);
`tests/helpers/a11y-surfaces.ts` + new golden; `tests/autosave-recovery.spec.ts` (new);
`run-native-tests.mjs` (register). `[autosave]` `#ifndef NDEBUG` stderr instrumentation on
write / check-recovery / recover (matches the existing `[ArchC-*]` convention).

**Verification (automated).**
- tsc (editor) exit 0; web vitest **481 passed** (471 + 10 new dialog tests).
- Native `.sln` Debug x64 exit 0 (host C++).
- Native harness **168 passed / 30 skipped / 0 failed** (165 + 2 bridge round-trips + 1 a11y
  golden); host exited cleanly (no false-FATAL from the death guard). a11y golden deterministic
  (fixed orphan + pinned clock).

**⚠️ NOT automated — needs the user's manual crash smoke (the one path `--test-host` can't run).**
The autosave timers are gated OFF under `--test-host`, so the harness never exercises the live
Write or the crash→recover round-trip. Static-checked the wiring (types, dirty-gate, single-thread
WM_TIMER), and the data layer + file/open swap are both already-shipped/proven — but the real flow
needs a human:
1. Launch a NORMAL `--new-ui` (NOT `--test-host`), edit an emitter, wait ~30s → confirm
   `%TEMP%\AloParticleEditor\autosave-<pid>-recent.alo` appears (or grep host.log for
   `[autosave] wrote tier=recent`).
2. Kill the editor (Task Manager) mid-edit → relaunch (no file arg) → recovery dialog appears →
   Restore recent → title shows the original filename + asterisk, Ctrl+S targets the original.
3. Restore stable / Discard / dismiss-Esc (decide-later) variants. Clean quit → relaunch → NO
   prompt (DeleteOurSession). Recover → relaunch → NO prompt (DeleteOrphan consumed).
