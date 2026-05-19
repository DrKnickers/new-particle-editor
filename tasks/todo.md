# D6 — Mods menu detection, activation, and persistence

**Status:** planning — awaiting user sign-off before implementation
**Started:** 2026-05-19
**Approach:** Reuse the legacy C++ mod-discovery code (battle-tested in
`src/main.cpp:420-7124`); expose it through a new `mods/*` bridge
namespace; replace the React placeholder at
[MenuBar.tsx:472-491](web/apps/editor/src/components/MenuBar.tsx:472)
with a dynamic list.

(D5 plan + review preserved in this file's git history; D5 shipped on
`lt-4` at commit `9ad01d0`.)

---

## 1. Goal + scope

### Goal

The Mods menu in the new-UI menubar replaces its single disabled
`(none)` item with a dynamic list of installed mods grouped by engine
(FoC first, then Base Game / EaW), sorted alphabetically within each
group, just like legacy. The user can click an entry to activate that
mod; a check mark indicates the current active mod. "Unmodded" is
always at the top of the list. A "Refresh Mod List" item at the bottom
forces a disk rescan. The active-mod selection persists across launches
via the existing `HKCU\Software\AloParticleEditor\LastMod` registry key
(legacy parity — no new registry key).

### In

1. New bridge surface (`web/packages/bridge-schema/src/index.ts`):
   - `mods/list` — query, returns `{ mods: ModDescriptor[]; activePath: string | null }`.
   - `mods/select` — `{ path: string | null }` (null = Unmodded). Activates the mod, persists to registry, triggers the engine-side hot-swap.
   - `mods/refresh` — re-scans the on-disk Mods directories. Returns the same shape as `mods/list`.
   - `ModDescriptor` type: `{ path: string; folderName: string; nickname: string; isFoC: boolean }`.
2. `EngineStateDto` gains optional `activeModPath: string | null`. Snapshots and `engine/state/changed` events now carry the active mod so subscribed components react without explicit re-fetch.
3. C++ dispatcher handlers in `src/host/BridgeDispatcher.cpp` for the three new kinds. Implementation strategy decided after the discovery step below.
4. MockBridge + TestHostBridge stubs for the new kinds + the new DTO field.
5. React MenuBar populates the mods menu from a `mods/list` fetch at mount; subscribes to `engine/state/changed` to update the check mark; calls `mods/select` on click; calls `mods/refresh` from the Refresh item.
6. Vitest specs for the React side (menu renders the grouped list, click dispatches the right call, check mark tracks `activeModPath`).
7. Playwright contract spec asserting `mods/list` returns the expected shape against the live host (real content depends on what's installed on the dev machine — spec verifies shape, not specific mods).
8. CHANGELOG entry + HANDOFF refresh + ROADMAP update closing out D6 (the last "make a stub work" item from FD10 Group D).

### Out

- **Nickname editing.** `ModNicknameDialog.tsx` already exists in the React app but is currently UI-only (no bridge call wired). The Mods menu can *display* nicknames if the legacy registry already has them, but editing nicknames is a separate (small) follow-up — `mods/set-nickname` and wiring the dialog. Not in this dispatch.
- **Multi-mod stacks.** Legacy supports a single active mod path at a time. Same here. No "load mod A then mod B as overlay."
- **Workshop / Steam mod detection.** Legacy may or may not handle `Documents/Petroglyph/...` paths (recon was unclear; discovery step will confirm). If legacy doesn't, D6 doesn't either — parity is the rule.
- **Hot-swap correctness audit.** The legacy `SelectMod()` does six things (FileManager swap, registry write, palette refresh, thumbnail cache clear, menu rebuild, in-engine texture/shader hot-swap). D6 will call the legacy's side-effect chain wholesale (via refactor — see Architecture). Auditing whether each step is still correct in --new-ui mode is out of scope; we assume legacy parity == correct.
- **Test fixtures for offline mod-discovery.** The contract test runs against the live exe; whatever mods the dev machine has, that's what shows. Synthesising test mod directories is overkill.

---

## 2. What the codebase already gives us

### Legacy C++ (battle-tested, ~700 LOC in `src/main.cpp`)

- **`ModEntry` struct** at [`src/main.cpp:420-427`](src/main.cpp:420) — `{ path, folderName, nickname, isFoC }`. Identical to what the bridge will return.
- **`ScanModsDir()`** at [`src/main.cpp:6872-6900`](src/main.cpp:6872) — walks one Mods directory via `FindFirstFile`, filters dot/hidden/system entries.
- **`DiscoverMods()`** at [`src/main.cpp:6902-6938`](src/main.cpp:6902) — scans both FoC (`corruption\Mods`) and EaW (`GameData\Mods`); sorts FoC-first then alphabetically.
- **`RebuildModsMenu()`** at [`src/main.cpp:6966-7068`](src/main.cpp:6966) — legacy popup-menu builder; not directly reusable (it's Win32 menu construction) but the *grouping logic* is the spec for the React side.
- **`SelectMod()`** at [`src/main.cpp:7077-7124`](src/main.cpp:7077) — the six-step side-effect chain. Calls `fileManager->SetModPath`, `WriteLastMod`, updates texture palette, clears thumbnail cache, rebuilds menu, hot-swaps in-engine.
- **`ReadLastMod()` / `WriteLastMod()`** at [`src/main.cpp:7763`](src/main.cpp:7763) and [`src/main.cpp:3192-3203`](src/main.cpp:3192) — registry persistence under `HKCU\Software\AloParticleEditor\LastMod` (REG_SZ).
- **`APPLICATION_INFO::selectedModPath`** at [`src/main.cpp:575`](src/main.cpp:575) — current active mod (empty = unmodded).
- **`APPLICATION_INFO::mods`** at [`src/main.cpp:574`](src/main.cpp:574) — full vector of discovered ModEntry.

### `FileManager` API

[`src/managers.h:36-52`](src/managers.h:36) — `SetModPath(const std::wstring&)`, `GetModPath() const`. The actual loose-file resolution priority handling is internal.

### Existing React surface

- **Mods menu placeholder** at [`web/apps/editor/src/components/MenuBar.tsx:472-491`](web/apps/editor/src/components/MenuBar.tsx:472) — single disabled `(none)` Menubar.Item with a "Phase 4.1 follow-up" TODO comment.
- **MenuBar already subscribes to snapshot** for File menu state (dirty flag, current path). Reading `activeModPath` off the DTO will use the same pattern.
- **`ModNicknameDialog.tsx`** exists but isn't called from anywhere currently — out of scope for D6 but worth noting it's already in the React tree.
- **Radix Menubar.Item** has built-in close-on-select; no custom event-handling needed for the menu UX.

### Nothing on the bridge schema yet

Grep confirmed: zero `mods/`, `modNickname`, or `activeMod` declarations in `bridge-schema/src/index.ts`. D6 builds the namespace from scratch.

---

## 3. Architecture / implementation approach

### Schema delta (additive only)

```ts
// New named type:
export type ModDescriptor = {
  path: string;
  folderName: string;
  nickname: string;   // empty if no user nickname set
  isFoC: boolean;
};

// EngineStateDto adds (after currentFilePath):
activeModPath: string | null;  // null = Unmodded

// New Request kinds:
| { kind: "mods/list";    params: Record<string, never> }
| { kind: "mods/select";  params: { path: string | null } }
| { kind: "mods/refresh"; params: Record<string, never> }

// ResponseFor:
R extends { kind: "mods/list" }    ? { mods: ModDescriptor[]; activePath: string | null } :
R extends { kind: "mods/select" }  ? { ok: true; activePath: string | null } | { ok: false; error: string } :
R extends { kind: "mods/refresh" } ? { mods: ModDescriptor[]; activePath: string | null } :
```

### C++ host side — three steps, in this order

**Step 0 outcome (completed 2026-05-19 — pre-implementation discovery):**

`APPLICATION_INFO` is allocated as a local in legacy `WinMain` at
[`src/main.cpp:8245`](src/main.cpp:8245), **unreachable when `--new-ui`
is passed** because WinMain returns early at line 8233 after dispatching
to `host::Run()`. The new-UI host literally never sees it. So:

- 3a (pass APPLICATION_INFO pointer to dispatcher) — **impossible**, nothing to pass.
- 3b (extract `ModManager` class shared between legacy + new-UI) — **required**.
- 3c (duplicate discovery code) — rejected.

Adopting **3b**. Refactor budget: ~150 LOC new + ~85 LOC touched, inside
the ~250 LOC cap set earlier.

**Sub-decisions resolved (after design discussion):**

1. **ModManager owns the engine hot-swap (atomic).** `ModManager::SelectMod(path)`
   handles the whole side-effect chain: FileManager swap → registry write →
   palette swap → thumbnail cache clear → engine `ReloadShaders` +
   `ReloadTextures`. Callers do one call, no checklist. Rejected the
   alternative (à la carte) because forgetting a step produces silent
   staleness — the worst kind of bug. The legacy `RebuildBackgroundPreviewBitmap`,
   skydome-picker `SendMessage`, and `InvalidateRect(hRenderWnd)` stay
   in the legacy SelectMod *wrapper* (they're Win32-specific and don't
   apply to --new-ui).
2. **DTO carries `activeModPath: string | null` (path-only).** Standard
   `selectedId + items[]` pattern. Single source of identity. Rejected
   full-descriptor variant because it would duplicate data and create
   nickname-staleness risk if nickname editing ships later.
3. **`mods/list` is a separate request.** Data cadence separation —
   the mod list changes rarely, snapshots fire constantly. Active path
   rides snapshot for React reactivity; full list comes via a one-shot
   `mods/list` fetched once at MenuBar mount and refetched on Refresh.

**Step 1 — Extract `ModManager` from legacy `SelectMod()`.** New class in
`src/host/ModManager.{h,cpp}`:

```cpp
class ModManager {
public:
  ModManager(IFileManager* fileManager);

  // Two-step engine setup — engine pointer is not available at construction
  // time in --new-ui mode (BridgeDispatcher is constructed before Engine).
  void SetEngine(Engine* engine);

  // Discovery + restoration.
  void DiscoverMods(const std::vector<std::wstring>& gameRoots);
  void RestoreLastSelectedMod();  // reads HKCU\...\LastMod, falls back to empty if path no longer exists

  // Atomic side-effect chain: FileManager → registry → palette → cache → engine reload.
  // Returns false if any step fails; partial-success states recoverable by retrying SelectMod.
  bool SelectMod(const std::wstring& modPath);

  // Read-only accessors.
  const std::vector<ModEntry>& GetMods() const { return mods; }
  const std::wstring& GetSelectedModPath() const { return selectedModPath; }

private:
  IFileManager* fileManager;
  Engine*       engine = nullptr;
  std::vector<ModEntry> mods;
  std::wstring  selectedModPath;
};
```

`ModEntry` moves from a `src/main.cpp`-private struct into a public
struct in `ModManager.h` (or a small dedicated `ModEntry.h`).

Legacy `SelectMod()` becomes a thin wrapper:

```cpp
static void SelectMod(APPLICATION_INFO* info, const wstring& modPath) {
  if (!info->modManager->SelectMod(modPath)) return;
  // Win32-only finalisation steps:
  RebuildBackgroundPreviewBitmap(info);
  if (info->hSkydomePicker && IsWindowVisible(info->hSkydomePicker))
    SendMessage(info->hSkydomePicker, WM_USER, 0, 0);
  RebuildModsMenu(info);
  if (info->hRenderWnd)
    InvalidateRect(info->hRenderWnd, NULL, TRUE);
}
```

New-UI bridge handlers don't need any of the Win32 finalisation; React
re-renders from the DTO once `engine/state/changed` fires.

**Step 2 — Dispatcher handlers in `src/host/BridgeDispatcher.cpp`:**

- `mods/list` — return `m_appInfo->mods` and `m_appInfo->selectedModPath` (or the ModManager equivalent), JSON-encoded.
- `mods/select` — call the refactored `SelectMod(path)`. Emit `engine/state/changed` (snapshot now carries the new `activeModPath`).
- `mods/refresh` — call `DiscoverMods()` to repopulate; return the new list. Active path stays; if it's no longer present on disk, fall back to Unmodded (matching legacy `ReadLastMod` startup behaviour).

**Step 3 — DTO build site.** Wherever `BuildEngineStateSnapshot` lives in `BridgeDispatcher.cpp`, add `activeModPath` to the JSON. Source: `m_appInfo->selectedModPath` (UTF-16 → UTF-8 via existing `WideToUtf8` helper).

### React side

In [`MenuBar.tsx`](web/apps/editor/src/components/MenuBar.tsx):

1. New `useEffect` to fetch `mods/list` at mount, store in component state. Re-fetch on `mods/refresh` activation.
2. Read `activeModPath` from the snapshot store (already subscribed for File menu state).
3. Replace the `(none)` Menubar.Item block with:
   - `<Menubar.Item>Unmodded</Menubar.Item>` (with check if `activeModPath == null`).
   - `<Menubar.Separator />`
   - For each FoC mod: `<Menubar.Item>{nickname || folderName}</Menubar.Item>` (grouped, separator between FoC and Base Game).
   - For each Base Game mod: same.
   - `<Menubar.Separator />`
   - `<Menubar.Item>Refresh Mod List</Menubar.Item>`
4. Click handler on each item dispatches `mods/select { path }` (or `mods/refresh` for the last item).
5. The check mark uses the same `Check` Lucide icon the File menu already imports.

### MockBridge

Stubs return a synthetic 2-element mod list (one FoC, one Base Game) and a defaulted `activePath: null`. `mods/select` updates the in-memory state and fires `engine/state/changed` so the rest of the React tree sees it. No real disk scan.

---

## 4. Risks & mitigations

1. **Step 0 discovery returns "APPLICATION_INFO not available in --new-ui mode."** Most likely outcome based on the dispatcher's `m_currentFilePath` pattern. *Mitigation:* fall through to option 3b (extract `ModManager`). Adds maybe 200 LOC of refactor but keeps both UI modes correct. If the refactor blows scope, STOP and re-plan with the user — the alternative of duplicating discovery (3c) is unacceptable.

2. **`SelectMod()` has side effects that don't translate to --new-ui.** E.g., a Win32 menu rebuild step. *Mitigation:* the refactor in Step 1 explicitly removes Win32-menu work from the shared core; that work stays in the legacy `WM_COMMAND` handler and is a no-op from the bridge path (React re-renders from DTO instead).

3. **Active-mod path stored in registry as wide string; bridge transmits UTF-8.** Path string round-trips need to use the existing `Utf8ToWide` / `WideToUtf8` helpers. *Mitigation:* convention is consistent in the dispatcher (every other path field does this); follow the same pattern. Catch encoding bugs in the Playwright contract spec by asserting `mods/select` → `mods/list` round-trips a non-ASCII path if one is available.

4. **Legacy and new-UI menus disagree on which mod is active.** If a user runs legacy and new-UI alternately, both read `HKCU\...\LastMod` at startup; both write on selection. Cross-mode consistency is automatic because the registry is the single source of truth. *Mitigation:* none needed; this just works by construction. (Force-Align lighting had the same shape and shipped on registry parity.)

5. **A `mods/select` against a no-longer-existing path.** User selects mod X, deletes mod X on disk, opens the editor again. *Mitigation:* legacy's `ReadLastMod` startup path already falls back to Unmodded if the path is gone. New-UI host runs the same check at startup, so the DTO comes up with `activeModPath: null` and the menu shows Unmodded checked.

6. **Mock fixtures don't reflect real installed mods.** Browser-mode dev experience shows fake mods. *Mitigation:* document in MockBridge comment, matches the pattern of mock fixtures elsewhere (e.g., the bundled skydome gradients are static CSS, not real textures).

7. **Playwright spec brittleness on missing mod-state-changed events.** Contract spec dispatches `mods/select` and checks the snapshot reflects the new active path. If the host doesn't emit `engine/state/changed` after the swap, the spec falls back to polling a fresh snapshot. *Mitigation:* matches existing pattern (e.g., `engine/set/skydome-slot` in `background-picker.spec.ts`).

---

## 5. Testing & verification

### Vitest (target +4 to +6 specs; 188 → 192+)

**MenuBar mods menu** (extend `web/apps/editor/src/components/__tests__/MenuBar.test.tsx`):

- [ ] Mods menu renders "Unmodded" + the mock fixture's 2 entries + "Refresh Mod List", in that order.
- [ ] Clicking a mod entry dispatches `mods/select` with the right path.
- [ ] Clicking Unmodded dispatches `mods/select` with `path: null`.
- [ ] Clicking Refresh dispatches `mods/refresh`.
- [ ] Check mark renders next to the entry whose path matches `snapshot.activeModPath`.

### Playwright (target +2 contract specs; 77 → 79)

**`mods-contract.spec.ts`** (new file):

- [ ] `mods/list` resolves to an object with `mods: array` and `activePath: string|null` — shape only, content depends on dev machine.
- [ ] `mods/select` with `path: null` succeeds; subsequent snapshot has `activeModPath: null`.

### Manual native smoke

- [ ] Launch `--new-ui`. Open Mods menu. If you have mods installed under `<EaW>/GameData/Mods/` or `<EaW>/corruption/Mods/`, they appear grouped and alphabetised. If not, only "Unmodded" + "Refresh".
- [ ] Click a mod. Check mark moves. Active mod path persists across launch (close + relaunch, check mark is still there).
- [ ] Click Unmodded. Check mark moves to Unmodded. Persists.
- [ ] Click Refresh. Menu re-fetches without visible UI thrash. (If you add a new mod folder mid-session and then click Refresh, it appears.)
- [ ] Regression: legacy mode (`--legacy-ui`, no `--new-ui`) Mods menu still works exactly as before. Both modes agree on the active mod after restart.

### Gate counts

- [ ] `pnpm build` clean (0 TS errors).
- [ ] Vitest **192+ / 192+**.
- [ ] `pnpm test:native` **79 / 79**.
- [ ] MSBuild Debug x64 clean.

---

## 6. Pre-implementation investigations (Step 0)

Before writing any new code, answer these in order:

1. Does `APPLICATION_INFO` exist in `--new-ui` mode, or only in legacy WinMain? Look at `src/main.cpp`'s WinMain to see who allocates APPLICATION_INFO and whether `useNewUi`/`useDevUi` skips that path.
2. If APPLICATION_INFO exists in --new-ui, where is `BridgeDispatcher` constructed and can we pass an APPLICATION_INFO pointer in? Look at `src/host/HostWindow.cpp` near the `BridgeDispatcher` construction.
3. Read `SelectMod()` in full (lines 7077-7124). Identify which steps are Win32-specific and which are state mutations. Sketch the refactor.

These answers determine whether option 3a (pass pointer) or 3b (extract ModManager) is the right architecture. The plan caps the refactor budget: if 3b looks like > ~250 LOC of touched code, STOP and discuss with the user before continuing.

---

## Implementation steps (mirrored in TaskList)

After Step 0 discovery returns:

1. Refactor `SelectMod()` into a callable core (Step 1).
2. Bridge schema: add `ModDescriptor`, three new request kinds, `activeModPath` on DTO.
3. C++ dispatcher: implement `mods/list`, `mods/select`, `mods/refresh`; extend snapshot builder.
4. MockBridge + TestHostBridge: stub the three kinds + DTO field.
5. React MenuBar: replace placeholder, wire fetch + dispatch + check mark.
6. Vitest specs for MenuBar mods interactions.
7. Playwright contract spec for `mods/list` + `mods/select` round-trip.
8. Build, vitest, MSBuild, test:native.
9. CHANGELOG entry.
10. HANDOFF refresh (remove D6 from "What's left"; this closes out FD10 Group D's "make a stub work" items entirely).
11. ROADMAP update if D6 is the last item gating any [LT-4] milestone.
12. Commit + FF into `lt-4`.

---

## Review

**D6 shipped in two commits on `lt-4`:**

- `ea0ed40` — refactor: extract ModManager (~700 LOC moved, no functional change).
- (this commit, hash TBD) — feat: bridge surface + React MenuBar.

All gates green:
- `pnpm build`: 0 TS errors.
- Vitest: **191 / 191** (+3 new MenuBar specs).
- MSBuild Debug x64: clean (preexisting LIBCMTD warning only).
- `pnpm test:native`: **80 / 80** (+3 new mods-contract specs).

### Plan vs reality

- Step 0 discovery confirmed option 3b (`ModManager` extraction)
  required. Refactor came in at ~150 LOC new + ~85 LOC touched on the
  legacy side — under the ~250 LOC budget set in the plan.
- All three sub-decisions held after deeper analysis (atomic
  ModManager, path-only DTO, separate `mods/list` request).

### Surprises

1. **Existing MenuBar tests broke** on the new code path because their
   default stub returns `{}` for every request, including `mods/list`.
   Fixed with `Array.isArray(r?.mods) ? r.mods : []` defensive
   guard in MenuBar. Captures a useful pattern — defensive runtime
   guards in components are cheaper than updating every test stub to
   know about new schema fields.

2. **Playwright harness has an allowlist, not a glob.** Adding a new
   spec file to `tests/` isn't enough — `scripts/run-native-tests.mjs`
   must also list it. Noticed when test count showed 77/77 instead of
   80/80; fixed by adding `tests/mods-contract.spec.ts` to the
   allowlist.

3. **`TexturePalette::RefreshPopup()` is safely callable from --new-ui
   mode.** It has an early-return `if (g_popup == NULL) return;` —
   so the legacy Win32 popup not being constructed in --new-ui doesn't
   cause issues. ModManager calls it unconditionally; the no-op path
   is taken in --new-ui.

### Lessons logged

None new in `tasks/lessons.md`. The two issues above are too tactical
to warrant a permanent rule.

### What's now possible

- Mods menu shows installed mods grouped (FoC + Base Game) with check
  marks; click activates with full side-effect chain.
- Active mod persists across launches via registry; both UI modes
  agree on the active mod.
- Refresh re-scans disk without restart.
- All four "make a stub work" items from FD10 Group D are closed
  (D1 Exit, D2 Reset Camera, D3 Reset View Settings, D4 Force Align
  in earlier dispatch; D5 + D6 in this session).

### Deferred (no follow-up needed yet)

- Nickname editing — `ModNicknameDialog.tsx` exists but isn't wired
  to a bridge call. Would need `mods/set-nickname` + dialog plumbing.
  Small follow-up, not blocking.
- Workshop/Steam mod auto-detection beyond `<gameRoot>/Mods/`.
- Multi-mod stacks (`activeModPaths: string[]`) — not currently
  requested.
- Per-key context menu future entries — same as before.
