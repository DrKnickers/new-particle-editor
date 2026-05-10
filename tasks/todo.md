# Plan: NT-1 — Autosave for in-progress particles

ROADMAP entry: near-term, ★★☆☆☆ (2/5), 3-5 hours estimated. With
the two-tier addition the upper end is a bit more — call it 4-6
hours.

## Goal

Periodically save the current particle system to recovery files so an
editor crash or a forgotten Save doesn't lose work. **Two tiers** of
autosave provide both freshness (30 s cadence catches "I crashed
10 seconds ago") and resilience (5 min cadence catches "the recent
autosave is corrupt" or "I made a bad change 2 minutes ago and the
recent autosave already overwrote the pre-bad-change state"). On
launch, if recovery files from a previous session exist, prompt the
user to restore one. The autosaves are **always** at separate paths
from the user's `.alo` — the editor never silently overwrites the
user's file.

## Scope

**In:**

- **Two-tier autosave** running side by side:
  - **Recent tier** — every 30 s. Captures the freshest state;
    overwritten frequently.
  - **Stable tier** — every 5 min. Captures an older known-good
    state; useful when the recent file is corrupt (mid-write
    crash) or when the user wants to roll back a bad edit they
    made in the last few minutes.
- Both tiers gated by `info->changed == true` AND
  `info->particleSystem != NULL` — no point writing identical
  bytes when nothing changed.
- Recovery files live at
  `%TEMP%\AloParticleEditor\autosave-<pid>-<tier>.alo` (with
  `<tier>` ∈ `recent` / `stable`) so concurrent editor instances
  don't clobber each other and the two tiers don't fight for the
  same path.
- On launch: scan `%TEMP%\AloParticleEditor\` for autosave files
  NOT belonging to a currently-running editor PID. If any exist,
  prompt with whatever combination is available (recent only,
  stable only, or both).
- Recovery prompt (MB_YESNOCANCEL when both tiers present, MB_YESNO
  when only one):
  ```
  Unsaved changes detected from a previous session.

  Original: <C:\path\to\file.alo>   (or "Unsaved new file")

  [Yes]    Restore most recent autosave from <X seconds> ago
  [No]     Restore stable backup from <Y minutes> ago
  [Cancel] Discard and start fresh
  ```
  - Only recent present → buttons collapse to Yes / Cancel (no
    stable to fall back to).
  - Only stable present → buttons read "Restore stable backup from
    <Y> ago" / Cancel. (Recent absent is unusual but possible if
    crash happened in the first 30 s after a stable write.)
- On Yes / No (restore): load the chosen tier; set `info->filename`
  to the recovered original filename so Ctrl+S overwrites the
  right place. Delete BOTH orphan tier files (they're a matched
  pair from one session).
- On Cancel (discard): delete BOTH orphan files.
- On clean shutdown / Save / Save-As / DoCloseFile / DoNewFile:
  delete this session's autosave files (both tiers) so they're not
  seen as orphaned next launch.

**Out (explicitly):**

- Multiple-undo of an autosave restore. Restore is final; user can
  Ctrl+Z if they don't like the recovered state (it'll be the
  load-time baseline of the recovered file).
- Per-emitter autosave granularity — autosave is whole-system, same
  as manual save and same as the undo snapshot pattern.
- Cloud / network autosave.
- Migrating between editor versions — autosave is just a `.alo`; if
  the format ever changes, a stale autosave from a different version
  loads or fails the same way a regular `.alo` would.
- Crash-recovery telemetry — out of scope.

## What the codebase already gives us

- **`ParticleSystem::write(IFile*)`** — already serializes to any
  `IFile`. `PhysicalFile(filename, WRITE)` is the same path
  `DoSaveFile` uses ([`main.cpp:1075`](src/main.cpp:1075)).
- **`info->changed` flag** + `SetFileChanged(info, bool)` — already
  tracks the dirty bit. Autosave checks it before writing.
- **`info->filename`** — already tracks the user's save target. We
  store this alongside the autosave so recovery can restore it.
- **`SetTimer` infrastructure** — already used elsewhere
  (auto-scroll in EmitterList; spawner driver). Standard timer
  pattern.
- **Registry helpers** (`ReadLastMod` / `WriteLastMod` /
  `ReadBackgroundColor` / `WriteBackgroundColor`) at
  [`main.cpp:2276`](src/main.cpp:2276) — established pattern for
  per-key `HKCU\Software\AloParticleEditor` values. Can reuse for
  autosave metadata if registry is the right home.
- **`LoadFile` + `OnFileChange`** — handles the load + UI rebuild
  path. Recovery is just `LoadFile` with a special filename
  remapping.
- **`PathFileExists` / `PathIsDirectory`** — used elsewhere; same
  in autosave-discovery.
- **`GetTempPath` / `GetCurrentProcessId`** — Win32 standard. Not
  yet used in this codebase but no new dependency.

## Architecture

### Storage layout

```
%TEMP%\AloParticleEditor\
    autosave-<pid>-recent.alo     — content, 30 s cadence
    autosave-<pid>-stable.alo     — content, 5 min cadence
    autosave-<pid>.meta           — small text file, original
                                    filename on first line
                                    (or empty for unsaved-new)
```

Per-PID names so two editors running side-by-side don't fight. The
`.meta` file is shared between the two tiers — both tiers come from
the same in-memory state and have the same original filename.

`.meta` file is UTF-16LE BOM + two lines: original filename (full
path, or empty), ISO-8601 timestamp of last autosave. Recovery
scans for `.alo` files; for each, looks up the matching `.meta`. If
`.meta` is missing or unreadable, treat the autosave as "unknown
origin" (user sees `<unknown>` in the prompt).

Why a sibling file rather than registry: registry values are
process-global and harder to clean up after orphan PIDs. Sibling files
under one TEMP subdirectory are cleanly self-contained.

### Periodic save — two independent timers

```cpp
static const UINT_PTR AUTOSAVE_RECENT_TIMER_ID = 2;   // 1 is autoscroll
static const UINT_PTR AUTOSAVE_STABLE_TIMER_ID = 3;
static const UINT     AUTOSAVE_RECENT_INTERVAL_MS = 30 * 1000;        // 30 s
static const UINT     AUTOSAVE_STABLE_INTERVAL_MS = 5  * 60 * 1000;   // 5 min

enum class AutosaveTier { Recent, Stable };
```

Both timers set in `WM_CREATE` on the main window. `WM_TIMER` handler:

```cpp
case WM_TIMER:
    if (wParam == AUTOSAVE_RECENT_TIMER_ID) {
        if (info->particleSystem != NULL && info->changed) {
            WriteAutosave(info, AutosaveTier::Recent);
        }
        return 0;
    }
    if (wParam == AUTOSAVE_STABLE_TIMER_ID) {
        if (info->particleSystem != NULL && info->changed) {
            WriteAutosave(info, AutosaveTier::Stable);
        }
        return 0;
    }
    break;
```

`WriteAutosave(info, tier)` picks the right path based on tier and
writes via the same `ParticleSystem::write` + atomic-rename pattern.
Best-effort — IO errors (disk full, permission denied) are swallowed.
Don't pop a dialog every 30 s for the same error.

**Why two independent timers, not one driving both:** each tier's
cadence is self-contained — recent fires at 0:30, 1:00, 1:30, ...
and stable at 5:00, 10:00, ... regardless of what the other did.
Simpler than a tick-counter ("every 10th recent write also writes
stable") and the slight tick-alignment drift is invisible to the
user. The cost is two `SetTimer` calls; trivial.

### Recovery on launch

After `InitializeWindows` completes and before the CLI-arg / DoNewFile
branch:

```cpp
OrphanSession recover;  // holds optional recent + optional stable + meta
if (FindOrphanAutosave(&recover))
{
    int answer = ShowRecoveryPrompt(info, recover);
    if (answer == IDYES && recover.recentPath != L"") {
        LoadFile(info, recover.recentPath);
        info->filename = recover.originalFilename;
        SetFileChanged(info, true);
    }
    else if (answer == IDNO && recover.stablePath != L"") {
        LoadFile(info, recover.stablePath);
        info->filename = recover.originalFilename;
        SetFileChanged(info, true);
    }
    // IDCANCEL: discard; fall through to normal startup.
    // Either way, both tier files (and the .meta) are deleted now —
    // the session is consumed.
    DeleteOrphanSession(recover);
}
```

```cpp
struct OrphanSession {
    DWORD    pid;
    wstring  recentPath;        // empty if no recent file
    wstring  stablePath;        // empty if no stable file
    wstring  originalFilename;  // from .meta, or empty
    FILETIME recentMtime;
    FILETIME stableMtime;
};
```

`FindOrphanAutosave`:

1. Build TEMP subdir path.
2. Iterate `autosave-*-recent.alo` and `autosave-*-stable.alo` via
   `FindFirstFile`/`FindNextFile`.
3. Group by PID. Each PID produces 0..1 recent + 0..1 stable.
4. For each PID, use
   `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid)`. If
   the call succeeds AND the process image name (via
   `QueryFullProcessImageNameW`) tail-matches our own exe name,
   it's a live editor instance — skip its files.
5. Among the remaining (truly orphan) PIDs, pick the session with
   the most-recently-modified file (either tier counts).

Strict process-image matching keeps us from misclassifying an
unrelated process that happens to have the same numeric PID.

If the chosen session has only a stable file (no recent — possible
if the editor crashed between the 5 min stable write and the next
30 s recent tick), the prompt offers stable as the only option.
If only recent (the common case for crashes within the first
5 minutes of editing), the prompt offers recent as the only option.

### Cleanup paths

All cleanup is whole-session: when we delete OUR autosave we delete
both tier files plus the meta file. When we discard an orphan we
delete all three for that PID.

- **`DoSaveFile` succeeds** → `DeleteOurAutosaveSession(info)` —
  the user's work is on disk; no need to keep either tier.
- **Editor's clean shutdown** (`WM_DESTROY` on main window, or
  successful exit through `DoCheckChanges`) →
  `DeleteOurAutosaveSession`.
- **`DoCloseFile` / `DoNewFile`** → `DeleteOurAutosaveSession`
  then start fresh. (The new file is brand new and has nothing to
  autosave yet until the user edits.)
- **Recovery prompt resolution** (any of Yes / No / Cancel) →
  `DeleteOrphanSession(recover)` — the orphan session is fully
  consumed.

If we crash before `DeleteOurAutosaveSession` runs, our files
become orphans — exactly the case the recovery flow handles.

### File names + metadata layout

```
autosave-<pid>.alo     ← ParticleSystem::write output, byte-for-byte
                         the same as a normal .alo save
autosave-<pid>.meta    ← UTF-16LE BOM + LF-terminated lines:
                           line 1: original filename (full path) or empty
                           line 2: ISO-8601 timestamp of last autosave
                           (more lines reserved; recovery ignores extras)
```

Plain text rather than binary so a curious user can inspect / recover
manually if the recovery flow fails. Two-line format keeps parsing
trivial.

## Implementation order

1. **`Autosave.{h,cpp}`** — new module with the helpers:
   - `BuildAutosaveDir()` → `%TEMP%\AloParticleEditor\` (creates if
     missing via `SHCreateDirectoryEx`).
   - `OurAutosavePath()` / `OurAutosaveMetaPath()` — for current
     PID.
   - `WriteAutosave(info)` — try/catch wraps both PhysicalFile write
     and the metadata file. Silent on failure.
   - `DeleteOurAutosave()` — best-effort `DeleteFile` on both
     `.alo` and `.meta`.
   - `FindOrphanAutosave(out path, out original)` — directory scan
     + PID liveness check + meta read. Returns most-recently-modified
     orphan.
   - `IsEditorPidLive(DWORD pid)` — `OpenProcess` +
     `QueryFullProcessImageNameW` + tail-match against our exe name.
2. **Integration in `main.cpp`**:
   - `WM_CREATE` of main window → `SetTimer` for autosave.
   - `WM_TIMER` handler → call `WriteAutosave` if dirty.
   - `WM_DESTROY` → `KillTimer` + `DeleteOurAutosave`.
   - `DoSaveFile` post-success → `DeleteOurAutosave`.
   - `DoCloseFile` / `DoNewFile` → `DeleteOurAutosave` (since the
     "in-progress work" is being intentionally discarded).
   - `main()` startup, between `InitializeWindows` and CLI/DoNewFile
     branch → recovery prompt flow.
3. **Wire up the recovery flow** carefully:
   - If user passes a CLI file AND an orphan exists, prefer the
     CLI file (their explicit intent). The orphan stays untouched
     for next launch.
   - If user picks Recovery → load the orphan as if it were the
     original filename; set `info->changed = true` (still unsaved).
   - If user declines → delete the orphan; continue normal startup.
4. **Smoke test** per the checklist below.
5. **Update ROADMAP**: strikethrough NT-1, ✅ Shipped (#NN), Actual
   line, MOVE to Shipped section. Per the convention now in
   CLAUDE.md.
6. **CHANGELOG entry** with the three required sections.

## Risks and mitigations

### 1 — Autosave overwrites the user's `.alo`

The whole point of the design: autosave file is **always** at a
separate path under `%TEMP%`. Mitigated by construction. Smoke test:
verify after autosaving, the user's named `.alo` mtime is unchanged.

### 2 — Concurrent editor instances clobber each other's autosave

Per-PID filenames. Editor A writes `autosave-1234.alo`; editor B
writes `autosave-5678.alo`. They're orthogonal.

Risk subtler: editor A crashes, editor B is still running. On editor
A's relaunch, it scans the dir and finds *two* autosave files —
its own crashed one (orphan, recoverable) and editor B's (PID is
live, skip). The PID-liveness check has to be reliable.

**Mitigation**: `OpenProcess` + `QueryFullProcessImageNameW`
tail-matched against our exe's image name. Both PID number AND
process image have to match to count as "live editor." Bare PID
collisions (a non-editor process happens to have the same PID number)
won't trigger a false positive.

### 3 — Editor crashes mid-write → partial autosave file

`PhysicalFile::write` could be interrupted by a process kill. The
autosave file is then truncated / corrupt.

**Mitigation**: write to a temp file (`autosave-<pid>.alo.tmp`) then
`MoveFileEx(..., MOVEFILE_REPLACE_EXISTING)` to atomically rename
into place. On crash before rename, `.tmp` is left behind; recovery
scan can ignore `.tmp` files (or sweep them as garbage).

Belt-and-braces: recovery's `LoadFile` already handles
`wexception` from `ParticleSystem(IFile*)` — the existing
"corrupt file" message path. If a partial autosave still slips
through, the user sees the same error they'd see for any corrupt
`.alo`. Acceptable; not a crash.

### 4 — Disk full / permission denied on autosave write

A `MessageBox` every 30 s during a disk-full incident would be
infuriating.

**Mitigation**: wrap `WriteAutosave` in try/catch; swallow the
exception silently (Debug-build: print to console). Don't disable
the timer — once disk space is freed, the next attempt succeeds.

### 5 — Recovery prompt fires for an autosave the user explicitly discarded last session

User declines → we delete the orphan. So this can't happen unless
the deletion failed.

**Mitigation**: `DeleteFile` is reliable for files we own; if it
fails (permission), the file persists and recovery prompts again.
Ugly but not data-losing. Smoke test verifies clean delete.

### 6 — Many orphan autosave files accumulate

Repeated crashes / abandoned PIDs over weeks. `%TEMP%\AloParticleEditor\`
fills up.

**Mitigation**: on launch, after the recovery prompt resolves, sweep
any autosave files older than 30 days — they're not actionable for
a normal user and `%TEMP%` is supposed to be transient anyway.

### 7 — Autosave fires while a modal dialog is open (Save As, Color picker, ...)

The `WM_TIMER` is queued; modal pumps process it. If `info->changed`
is true and the model is consistent (which it always is — we don't
mutate mid-message-handler), the autosave write succeeds.

**Mitigation**: nothing extra. The model is always consistent at
message boundaries. Smoke test: open Save-As dialog, leave it open
for 60+ s, verify autosave fires without crashing the dialog.

### 8 — Recovery prompt fires for a file the user CLI-loaded

If the user explicitly passes a `.alo` on the command line (e.g.
double-clicking a `.alo` in Explorer), they clearly want THAT
file. Showing a recovery prompt would interrupt that gesture and
feel like the editor is second-guessing them.

**Mitigation — Option A (locked in)**: when a CLI file is present,
**skip the recovery prompt entirely** and load the CLI file. The
orphan autosave is preserved untouched in `%TEMP%`; the next
launch *without* a CLI argument will prompt for it. The orphan-
sweep step (Risk #6, 30-day cleanup) still applies, so an orphan
that's never explicitly handled doesn't accumulate forever.

The behaviour is asymmetric with the no-CLI case (where we always
prompt) but matches the user's most likely intent: an Explorer
double-click is an explicit request, not "open the editor".

### 9 — Recovery loaded file's `original filename` is stale (file was deleted / renamed)

User accepts recovery → `info->filename` set to a path that no
longer exists. Ctrl+S then fails with the existing
`IDS_ERROR_FILE_SAVE` message.

**Mitigation**: nothing extra; the existing error path is fine.
Document: if the original file is gone, user should Save-As after
recovery.

### 10 — Recovery flow corrupts the live preview (engine still has instances from a previous load)

Same problem the undo system already solved (PR #31).

**Mitigation**: `LoadFile` already handles `engine->Clear()` and
the safe NULL-out-particleSystem-during-rebuild ordering. We're
calling it the same way `DoOpenFile` does.

### 11 — `%TEMP%` directory missing or unwritable (corporate-locked-down environments)

`SHCreateDirectoryEx` fails; `WriteAutosave` raises an exception.

**Mitigation**: wrap directory creation in the same swallow-on-error
pattern. If the autosave dir can't be created, autosave is silently
disabled for the session. User loses no DATA — they just have no
recovery safety net (same as before this PR).

### 12 — Atomic-rename across drives

`MoveFileEx` with `MOVEFILE_REPLACE_EXISTING` works on the same
volume. `%TEMP%` is typically on the system drive, same as where the
process writes — same volume. Cross-volume edge case not worth
designing around.

### 13 — Autosave files leak to git or to release zips

`%TEMP%` is outside the repo and outside any release packaging path.

**Mitigation**: nothing extra.

## Testing & verification

### Happy paths — recent tier

- [ ] Open editor, edit, wait 35 s → `autosave-<pid>-recent.alo`
      appears, mtime ≈ now. Stable absent.
- [ ] Continue editing → next 30 s tick overwrites recent.
- [ ] Save manually → both tier files deleted.
- [ ] Edit again post-save → recent reappears at the next 30 s
      tick.

### Happy paths — stable tier

- [ ] Open editor, edit, wait 5 min 30 s → both `-recent.alo`
      (mtime ≈ now) AND `-stable.alo` (mtime ≈ now) exist.
- [ ] Wait another 5 min → stable refreshed at the 10 min mark;
      recent ticks 10× in that interval.
- [ ] Save manually → both deleted.

### Recovery prompt — three outcomes

- [ ] Edit for 90 s, kill the process → relaunch shows MB_YESNO
      (recent only, no stable yet). Yes restores; Cancel discards.
- [ ] Edit for 6 min, kill the process → relaunch shows
      MB_YESNOCANCEL. Yes restores recent; No restores stable;
      Cancel discards both. Verify all three branches separately.
- [ ] After restore (either tier), title bar shows the original
      filename with `*`; Ctrl+S overwrites the original.
- [ ] Cancel → both orphan files deleted; normal startup.

### Tier resilience

- [ ] Edit for 6 min, corrupt the recent file manually
      (truncate it), kill process, relaunch → load of recent fails
      gracefully; user can then pick stable instead. Verify the
      corrupt-file message doesn't crash the editor.
- [ ] Edit, save, edit (so file is dirty again), kill process →
      recent reflects post-save state; stable might still hold a
      pre-save state if the 5 min window hadn't elapsed. Recovery
      offers either; both load consistently.

### Concurrency

- [ ] Launch editor A; edit; let recent fire (30 s); let stable
      fire (5+ min).
- [ ] Launch editor B (in parallel, not a closed-and-reopened); edit
      different file; let its tiers fire.
- [ ] Close A cleanly → A's three files (recent, stable, meta)
      deleted; B's untouched.
- [ ] Verify each editor wrote its own per-PID files; no two
      editors fight over the same path.
- [ ] Kill A via Task Manager; relaunch A → recovery prompt fires
      for A's orphaned session (B's is correctly skipped because B
      is live).

### Edge cases

- [ ] CLI arg + orphan present → no prompt; CLI file loads; orphan
      preserved for next launch.
- [ ] Corrupt autosave file (truncate manually) → graceful "couldn't
      load" message; editor still starts.
- [ ] Stale orphan from 31 days ago → swept on launch, no prompt.
- [ ] `%TEMP%\AloParticleEditor\` is read-only → autosave silently
      disabled, no error spam, editor functions normally.
- [ ] Save-As → autosave deletes old name's autosave, next tick
      writes new name's.
- [ ] Open file A, autosave fires, open file B without saving A,
      autosave overwrites with B's state — verify the autosave is
      always for the *currently loaded* file.

### Cleanup

- [ ] Run editor for 5 minutes with edits, exit cleanly → no files
      left in `%TEMP%\AloParticleEditor\` for our PID.

### Debug instrumentation

`#ifndef NDEBUG` printf at:

- `[Autosave] tier=<recent|stable> write OK <path> bytes=N` on each
  successful tick.
- `[Autosave] tier=<recent|stable> write FAILED <path>
  reason=<error>` on each failure.
- `[Autosave] orphan PID=<N> recent=<path|empty>
  stable=<path|empty> origfile=<X>` at startup scan.
- `[Autosave] discard PID=<N>` when sweeping stale or declined.
- `[Autosave] restore from tier=<recent|stable>` on user-accepted
  recovery.

Tag with `[Autosave]` for grep alongside the existing `[DnD]` /
`[Undo]` logs.

## Estimate

★★☆☆☆ (2/5), **3-5 hours** consistent with the roadmap. The data
layer is small (reuse `ParticleSystem::write` and existing file
helpers); most of the time goes into correctly handling the
PID-liveness scan, atomic rename, and the recovery-prompt UX flow.

---

# Review

(Filled in after implementation lands.)
