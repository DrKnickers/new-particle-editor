# Track-key Undo Coalescing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a streaming curve-key Time/Value spinner gesture (and the N-call multi-key group shift) record **one** undo step instead of one-per-tick, by giving the host's `emitters/set-track-key` handler a per-track/per-emitter coalesce key.

**Architecture:** One-line host change at [BridgeDispatcher.cpp:3594](../../src/host/BridgeDispatcher.cpp:3594) — `captureUndo()` → `captureUndo(coalesceKey)` where `coalesceKey` mirrors the shipped emitter-property bit layout with `trackIdx` substituted for the field-name hash. This routes through the existing `UndoStack::CapturePreCoalesced` (PRE-mutation skip-coalescing, 1500 ms window). No React changes. Verification is native-only (real host `UndoStack` over the `--test-host` CDP bridge), so the plan first restores the native lane in this fresh worktree.

**Tech Stack:** C++17 (Win32 host, MSBuild/VS18, Debug x64), `UndoStack` snapshot/coalesce, Playwright over CDP (`web/apps/editor/tests/*.spec.ts`), pnpm.

Full design + adversarial-verification record: [docs/superpowers/specs/2026-06-08-track-key-undo-coalescing-design.md](../specs/2026-06-08-track-key-undo-coalescing-design.md).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/host/BridgeDispatcher.cpp` | Modify (~line 3594) | Compute per-track coalesce key, pass to `captureUndo`. The *only* code change. |
| `web/apps/editor/tests/undo-navigation.spec.ts` | Modify (append helpers + 5 tests) | Native CDP regression coverage: fold / separate / structural-break / redo-branch / window-expiry. |
| `tasks/fix-plan.md` | Modify | Mark the VPT-2 "Possible follow-up" as ✅ done. |
| `tasks/ui-delta-report.md` | Modify | STATUS banner: the last open item is now closed. |
| `CHANGELOG.md` | Modify (prepend entry) | User-facing description + how-we-tackled + gotchas. |

**Fixture facts this plan relies on** (verified in code, not assumed):
- `--test-host` boots a **default** `ParticleSystem` with one root emitter ([HostWindow.cpp:3199](../../src/host/HostWindow.cpp:3199)).
- Every track is pre-seeded with **two border keys** at `t=0` and `t=100` ([ParticleSystem.cpp:824-825](../../src/ParticleSystem.cpp:824)); all track slots are bound (non-null), so `set-track-key` / `add-track-key` are **not** no-ops. **No `add-track-key` seeding is needed** to get a movable key.
- Green/Blue/Alpha tracks **alias** Red ([ParticleSystem.cpp:829-831](../../src/ParticleSystem.cpp:829)). The tests therefore use the **distinct, non-aliased** tracks `scale` (idx 4, default value 20) and `rotationSpeed` (idx 6, default value 0) to avoid alias confusion.
- A `set-track-key` with `newTime == oldTime` moves a key's **value** only; border keys (t=0/t=100) pin their time regardless ([BridgeDispatcher.cpp:3577-3582](../../src/host/BridgeDispatcher.cpp:3577)), so a value-only burst keeps `oldTime` stable tick-to-tick — exactly the `handleValueSpinner` path.

---

## Task 1: Restore the native lane in this fresh worktree

This worktree has no built host binary and no React `dist/` (verified absent), so the harness cannot run yet. This task is pure environment restore — no code change, no commit.

**Files:** none modified (the NuGet `packages/` and `dist/` are git-ignored, per-worktree).

- [ ] **Step 1: Materialise the WebView2 NuGet package into the solution-local layout (L-039)**

The `.sln` uses `packages.config` (WebView2 `1.0.3967.48`) and there is no `nuget.exe` on PATH. The package is already in the global cache. Copy it into the solution-local `packages/` layout.

Run (PowerShell):
```powershell
$src = "$env:USERPROFILE\.nuget\packages\microsoft.web.webview2\1.0.3967.48"
$dst = "packages\Microsoft.Web.WebView2.1.0.3967.48"
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item -Recurse -Force "$src\*" $dst
Test-Path "$dst\build\native\Microsoft.Web.WebView2.targets"
```
Expected: prints `True` (the `.targets` file is what MSBuild needs).

- [ ] **Step 2: Build the host (Debug x64) via MSBuild on PowerShell (L-046)**

Never invoke MSBuild through the Bash tool (it POSIX-translates `/switch` args and silently exit-0s). Use the PowerShell tool with the `&` call operator and the VS18 path.

Run (PowerShell, from repo root):
```powershell
& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" `
  "ParticleEditor.sln" /p:Configuration=Debug /p:Platform=x64 /m /nologo
"msbuild-exit=$LASTEXITCODE"
```
Expected: `msbuild-exit=0`, build completes (~45 s) with only the pre-existing expat `C4244` + `LNK4098 LIBCMTD` warnings. `x64\Debug\ParticleEditor.exe` now exists.

- [ ] **Step 3: Build the React dist (L-040)**

The host serves the app from `web/apps/editor/dist/` via the `app.local` virtual-host mapping; the harness needs it present.

Run (PowerShell):
```powershell
pnpm --filter @particle-editor/editor build
"build-exit=$LASTEXITCODE"
```
Expected: `build-exit=0`; `web/apps/editor/dist/index.html` exists. (`build` = `tsc -b && vite build`, so this also re-confirms the type gate.)

- [ ] **Step 4: Establish the green native baseline**

Run (PowerShell):
```powershell
pnpm --filter @particle-editor/editor test:native
"native-exit=$LASTEXITCODE"
```
Expected: **169 passed / 0 failed**, `native-exit=0`. If the FIRST run shows a host-death cascade (`ECONNREFUSED ::1:9222`, exit 2) it is an L-066 environmental phantom — **re-run once** before trusting it. A specific spec failing consistently is real.

---

## Task 2: Add the native regression tests (RED for the fold case)

Append five tests + their helpers to the existing VPT-2 spec. Four are *guards* that already pass (they prove the fix must not over-fold); the **fold** test is the one that FAILS until the host change lands.

**Files:**
- Modify: `web/apps/editor/tests/undo-navigation.spec.ts` (append after the final test, after line 211)

- [ ] **Step 1: Append the track-key helpers and the five tests**

Add this block at the end of `web/apps/editor/tests/undo-navigation.spec.ts`:

```ts
// ── VPT-2 follow-up: streaming track-key undo coalescing ──────────────
//
// The host's emitters/set-track-key folds rapid same-track/same-emitter
// edits (a wheel/hold-arrow/scrub Value or Time key spinner, and the N
// per-key calls one group shift issues) into ONE undo step within the
// 1500ms window — mirroring the emitter-property per-field coalescing above.
// Per-TRACK keying (legacy's track<<16|emitterIdx). Fixture: --test-host
// boots a default system whose every track has border keys at t=0 and t=100
// (ParticleSystem.cpp:824); we move the distinct, non-aliased `scale` (idx 4,
// default 20) and `rotationSpeed` (idx 6, default 0) tracks — never the
// Green/Blue/Alpha aliases of Red.

type TrackKey = { time: number; value: number };
async function getTrackKeys(id: number, trackName: string): Promise<TrackKey[]> {
  const r = await req<{ tracks: { name: string; keys: TrackKey[] }[] }>(
    "emitters/get-tracks",
    { id },
  );
  return r.tracks.find((t) => t.name === trackName)?.keys ?? [];
}
async function getTrackKeyValue(id: number, trackName: string, time: number): Promise<number> {
  const k = (await getTrackKeys(id, trackName)).find((x) => Math.abs(x.time - time) < 1e-3);
  if (k === undefined) throw new Error(`no ${trackName} key near t=${time}`);
  return k.value;
}
// Value-only move (newTime == oldTime): mirrors handleValueSpinner, keeps
// oldTime stable across ticks. time defaults to the t=0 border key.
const setTrackKeyValue = (id: number, track: string, time: number, newValue: number) =>
  req("emitters/set-track-key", { id, track, oldTime: time, newTime: time, newValue });
const addTrackKey = (id: number, track: string, time: number, value: number) =>
  req("emitters/add-track-key", { id, track, time, value });

test("a rapid value-spinner burst on ONE track key coalesces into ONE undo step", async () => {
  const id = await firstEmitterId();
  await req("emitters/select", { id });
  const v0 = await getTrackKeyValue(id, "scale", 0);

  // 4 rapid value moves (one per wheel notch), same track + emitter, in-window.
  for (let i = 1; i <= 4; i++) await setTrackKeyValue(id, "scale", 0, v0 + i);
  expect(await getTrackKeyValue(id, "scale", 0)).toBeCloseTo(v0 + 4, 3);

  // ONE undo must revert the WHOLE burst — not just the last tick.
  await undo();
  expect(await getTrackKeyValue(id, "scale", 0)).toBeCloseTo(v0, 3);

  // ONE redo reapplies the whole burst; leave the fixture at baseline.
  await redo();
  expect(await getTrackKeyValue(id, "scale", 0)).toBeCloseTo(v0 + 4, 3);
  await undo();
  expect(await getTrackKeyValue(id, "scale", 0)).toBeCloseTo(v0, 3);
});

test("value edits to DIFFERENT tracks are SEPARATE undo steps (per-track keying)", async () => {
  const id = await firstEmitterId();
  await req("emitters/select", { id });
  const s0 = await getTrackKeyValue(id, "scale", 0);
  const r0 = await getTrackKeyValue(id, "rotationSpeed", 0);

  await setTrackKeyValue(id, "scale", 0, s0 + 5);
  await setTrackKeyValue(id, "rotationSpeed", 0, r0 + 5);
  expect(await getTrackKeyValue(id, "scale", 0)).toBeCloseTo(s0 + 5, 3);
  expect(await getTrackKeyValue(id, "rotationSpeed", 0)).toBeCloseTo(r0 + 5, 3);

  // ONE undo reverts only the LAST track (rotationSpeed); scale untouched.
  await undo();
  expect(await getTrackKeyValue(id, "rotationSpeed", 0)).toBeCloseTo(r0, 3);
  expect(await getTrackKeyValue(id, "scale", 0)).toBeCloseTo(s0 + 5, 3);

  // SECOND undo reverts the earlier track (scale) — back to baseline.
  await undo();
  expect(await getTrackKeyValue(id, "scale", 0)).toBeCloseTo(s0, 3);
});

test("a structural add-track-key between two value edits breaks the fold", async () => {
  const id = await firstEmitterId();
  await req("emitters/select", { id });
  const s0 = await getTrackKeyValue(id, "scale", 0);

  await setTrackKeyValue(id, "scale", 0, s0 + 2);  // edit 1
  await addTrackKey(id, "scale", 50, 30);          // structural (key=0, never folds)
  await setTrackKeyValue(id, "scale", 0, s0 + 4);  // edit 2
  expect(await getTrackKeyValue(id, "scale", 0)).toBeCloseTo(s0 + 4, 3);

  // Undo edit 2 -> s0+2; the added key is still present.
  await undo();
  expect(await getTrackKeyValue(id, "scale", 0)).toBeCloseTo(s0 + 2, 3);

  // Undo the structural add -> the t=50 key is gone.
  await undo();
  expect((await getTrackKeys(id, "scale")).find((k) => Math.abs(k.time - 50) < 1e-3))
    .toBeUndefined();

  // Undo edit 1 -> baseline.
  await undo();
  expect(await getTrackKeyValue(id, "scale", 0)).toBeCloseTo(s0, 3);
});

test("a same-track edit after an undo PUSHES (no mid-redo-branch coalesce)", async () => {
  const id = await firstEmitterId();
  await req("emitters/select", { id });
  const s0 = await getTrackKeyValue(id, "scale", 0);

  await setTrackKeyValue(id, "scale", 0, s0 + 3);  // edit A
  await undo();                                     // -> s0 (cursor below tip)
  expect(await getTrackKeyValue(id, "scale", 0)).toBeCloseTo(s0, 3);

  await setTrackKeyValue(id, "scale", 0, s0 + 8);  // edit B must PUSH, truncating redo
  expect(await getTrackKeyValue(id, "scale", 0)).toBeCloseTo(s0 + 8, 3);

  await redo();                                     // branch truncated -> no-op
  expect(await getTrackKeyValue(id, "scale", 0)).toBeCloseTo(s0 + 8, 3);

  await undo();                                     // reverts B -> s0
  expect(await getTrackKeyValue(id, "scale", 0)).toBeCloseTo(s0, 3);
});

test("two same-track edits MORE than the window apart are SEPARATE undo steps", async () => {
  const id = await firstEmitterId();
  await req("emitters/select", { id });
  const s0 = await getTrackKeyValue(id, "scale", 0);

  await setTrackKeyValue(id, "scale", 0, s0 + 3);  // edit 1
  await page.waitForTimeout(1600);                 // exceed COALESCE_WINDOW_MS (1500)
  await setTrackKeyValue(id, "scale", 0, s0 + 6);  // edit 2 — window expired -> new step

  await undo();
  expect(await getTrackKeyValue(id, "scale", 0)).toBeCloseTo(s0 + 3, 3);
  await undo();
  expect(await getTrackKeyValue(id, "scale", 0)).toBeCloseTo(s0, 3);
});
```

- [ ] **Step 2: Type-check the test file (L-070 — `tsc -b`, not `--noEmit`)**

Run (PowerShell):
```powershell
pnpm --filter @particle-editor/editor exec tsc -b
"tsc-exit=$LASTEXITCODE"
```
Expected: `tsc-exit=0`. (Catches a type error in the new test before the much slower native run.)

- [ ] **Step 3: Run the new tests and verify the FOLD case FAILS, the other four PASS**

Run (PowerShell — the harness forwards `--grep` to Playwright, L-071):
```powershell
pnpm --filter @particle-editor/editor test:native -- --grep "track"
"native-exit=$LASTEXITCODE"
```
Expected: **1 failed, 4 passed** (`native-exit=1`). The failure is exactly *"a rapid value-spinner burst on ONE track key coalesces into ONE undo step"* — before the fix each `set-track-key` pushes its own undo entry (`coalesceKey = 0`), so the single `undo()` reverts only the last tick (`v0 + 3`, not `v0`). The four guard tests pass because today's per-tick behavior already keeps distinct/structural/redo/expired edits separate. **Do not commit** — red test, no fix yet.

---

## Task 3: The host change — per-track coalesce key

**Files:**
- Modify: `src/host/BridgeDispatcher.cpp:3594` (inside the `emitters/set-track-key` handler)

- [ ] **Step 1: Replace the bare `captureUndo()` with a keyed capture**

Find, in the `if (kind == "emitters/set-track-key")` handler, this exact line (currently at 3594, immediately before `track->keys.erase(it);`):

```cpp
        captureUndo();
```

Replace it with:

```cpp
        // Coalesce rapid same-track edits on the same emitter (a wheel/
        // hold-arrow/scrub Value or Time key spinner, and the N per-key
        // calls one group shift issues) into a single undo step within the
        // window. Per-TRACK keying — legacy's exact choice
        // (track<<16|emitterIdx) and the only stable key for a Time spinner,
        // whose oldTime moves every tick. Mirrors the emitter-property layout
        // (set-properties, this file) with trackIdx in place of the field
        // hash; bit 31 set so the key is never 0 (= structural / never-fold).
        const DWORD coalesceKey =
            0x80000000u | ((static_cast<DWORD>(trackIdx) & 0x7FFFu) << 16)
                        | (static_cast<DWORD>(id) & 0xFFFFu);
        captureUndo(coalesceKey);
```

`trackIdx` is guaranteed `>= 0` here (the handler returned early on `trackIdx < 0` at ~3560) and `id` is the validated emitter id — both already in scope, neither reassigned between their computation and this call. No other handler changes: `add-track-key`, `delete-track-keys`, `set-track-interpolation`, `set-track-lock`, `duplicate-with-index-increment`, and `rescale-emitter` deliberately keep their bare `captureUndo()` (key 0) so each stays its own undo step.

---

## Task 4: Rebuild, verify GREEN, commit

**Files:** none new; commits the Task 2 + Task 3 changes together (red→green).

- [ ] **Step 1: Rebuild the host (incremental Debug x64)**

The C++ change requires a host rebuild before the harness will see it. (No `pnpm build` needed — the change is host-side, and the edited file is a test spec, which Playwright runs directly rather than serving from `dist/`.)

Run (PowerShell, from repo root):
```powershell
& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" `
  "ParticleEditor.sln" /p:Configuration=Debug /p:Platform=x64 /m /nologo
"msbuild-exit=$LASTEXITCODE"
```
Expected: `msbuild-exit=0` (incremental, only the host project recompiles).

- [ ] **Step 2: Re-run the new tests — all five must PASS**

Run (PowerShell):
```powershell
pnpm --filter @particle-editor/editor test:native -- --grep "track"
"native-exit=$LASTEXITCODE"
```
Expected: **5 passed / 0 failed**, `native-exit=0`. The fold test now passes (one undo reverts the whole burst); the four guards still pass (the fix didn't over-fold). If the first run shows a host-death cascade, re-run once (L-066/L-071 phantom).

- [ ] **Step 3: Run the FULL native suite — no regressions**

Run (PowerShell):
```powershell
pnpm --filter @particle-editor/editor test:native
"native-exit=$LASTEXITCODE"
```
Expected: **174 passed / 0 failed** (the prior 169 + the 5 new), `native-exit=0`. If the count differs, confirm against Task 1's baseline + 5; investigate any *specific* repeatable failure (a one-off cascade is an L-066 phantom — re-run).

- [ ] **Step 4: Confirm the web suite is untouched**

Web is not changed by a host-only edit + a new native spec, but confirm the editor vitest suite still passes (the spec lives in the same workspace).

Run (PowerShell):
```powershell
pnpm --filter @particle-editor/editor test
"web-exit=$LASTEXITCODE"
```
Expected: `web-exit=0`, the current web baseline (510 passed at last check) unchanged — the new file is a Playwright spec (`tests/*.spec.ts`), not a vitest file, so the vitest count does not move.

- [ ] **Step 5: Commit the test + host change together**

Run (Bash — note the heredoc; do NOT use PowerShell `@'...'@` syntax in the Bash tool):
```bash
git add src/host/BridgeDispatcher.cpp web/apps/editor/tests/undo-navigation.spec.ts
git commit -F - <<'EOF'
feat(host): coalesce streaming track-key edits into one undo step (VPT-2)

emitters/set-track-key now passes a per-track|emitter coalesceKey to
captureUndo (was key=0 = never coalesce), so a wheel/hold-arrow/scrub Value
or Time key spinner — and the N per-key calls one group shift issues — fold
into a single undo step within the 1500ms window, mirroring the shipped
emitter-property per-field coalescing. Per-track keying matches legacy
(track<<16|emitterIdx) and is the only stable key for a Time spinner whose
oldTime drifts per tick.

5 native CDP regression tests (undo-navigation.spec.ts): fold / separate
tracks / structural-op breaks the fold / redo-branch push / window expiry.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
git log --oneline -1
```
Expected: the commit lands with a clean (non-`@`-prefixed) subject line.

---

## Task 5: Close out the docs (fix-plan, delta-report, CHANGELOG)

CLAUDE.md requires a CHANGELOG entry when a feature ships, and this closes the last open `ui-delta-report.md` item.

**Files:**
- Modify: `tasks/fix-plan.md` (the VPT-2 "Possible follow-up" bullet)
- Modify: `tasks/ui-delta-report.md` (STATUS banner "Genuinely still open" table)
- Modify: `CHANGELOG.md` (prepend a new entry)

- [ ] **Step 1: Mark the fix-plan follow-up done**

In `tasks/fix-plan.md`, replace the bullet that begins `- **Possible follow-up (not done):** apply the same coalescing to streaming track-key/curve edits` with:

```markdown
  - **Follow-up ✅ DONE (2026-06-08).** Applied the same coalescing to streaming
    track-key/curve edits: `emitters/set-track-key` now passes a per-track|emitter
    `coalesceKey` (legacy `track<<16|emitterIdx`) to `captureUndo` → `CapturePreCoalesced`,
    so a wheel/hold-arrow/scrub Value or Time key spinner (and the N-call group shift)
    fold into one undo step within the 1500ms window. Structural track ops (add / delete /
    interpolation / lock / duplicate / rescale) deliberately stay `coalesceKey = 0`.
    5 native CDP regressions in `tests/undo-navigation.spec.ts`. See CHANGELOG + the
    design spec `docs/superpowers/specs/2026-06-08-track-key-undo-coalescing-design.md`.
```

- [ ] **Step 2: Empty the delta-report open list**

In `tasks/ui-delta-report.md`, under `### Genuinely still open (code-verified 2026-06-06)`, replace the single `VPT-2 follow-up` table row with a closed-out note. Change the table body so the row reads:

```markdown
| **VPT-2 follow-up** | LOW | per-tick undo coalescing for streaming track-key / curve edits | ✅ **Shipped 2026-06-08** — per-track `set-track-key` coalescing; see fix-plan + CHANGELOG |
```

And update the paragraph immediately below it (which currently says *"The only genuinely-open item left is the deferred VPT-2 per-tick undo follow-up."*) to:

```markdown
*(VPT-6/7/8 status-bar parity shipped 2026-06-06; MNU-12 Import "Clear" button
shipped 2026-06-07; SEL-5/MNU-4 Paste-As-Child shipped 2026-06-07; the VPT-2
per-tick undo follow-up shipped 2026-06-08 — all in "Already shipped" above.
**The open list is now empty.**)*
```

- [ ] **Step 3: Prepend the CHANGELOG entry**

In `CHANGELOG.md`, insert this entry at the **top** of the `## Changelog` section (immediately under the heading, above the most recent existing entry). Backfill the `<short-hash>` from the Task 4 commit and the PR number on merge (leave a `TODO` if not yet merged — prior art: PR #27).

```markdown
### Per-tick undo coalescing for curve-key spinner edits

*2026-06-08 · [`<short-hash>`](https://github.com/DrKnickers/new-particle-editor/commit/<short-hash>) · [#NN](https://github.com/DrKnickers/new-particle-editor/pull/NN)*

Streaming a curve key's **Time** / **Value** spinner — by wheel, hold-arrow, or
arrow-column scrub — now records a **single** undo step per gesture instead of one per
tick, and a multi-key group shift records one step instead of N-per-tick. One Ctrl+Z
reverts the whole gesture, matching how the emitter-property spinners already behave.
This closes the last open item in the UI delta report.

**How we tackled it.** Host-only: [`src/host/BridgeDispatcher.cpp`](src/host/BridgeDispatcher.cpp:3594)'s
`emitters/set-track-key` handler now computes a per-track/per-emitter `coalesceKey`
(`0x80000000 | (trackIdx << 16) | id`) and passes it to the existing `captureUndo` →
[`UndoStack::CapturePreCoalesced`](src/UndoStack.cpp:126) (PRE-mutation skip-coalescing,
1500 ms window) — previously it captured with `coalesceKey = 0` (never coalesce). The key
layout mirrors the shipped emitter-property coalescing, substituting `trackIdx` for the
field-name hash. **Per-track** keying (legacy's `track<<16|emitterIdx`) is the only stable
choice: a Time spinner's `oldTime` changes every tick, so a per-key scheme can't match
tick-to-tick. No React changes — the spinners already dispatch one `set-track-key` per
tick; only the host's undo bookkeeping changed. Every other track-mutating command
(add / delete / interpolation / lock / duplicate-index / rescale) deliberately stays
`coalesceKey = 0` so each remains its own undo step.

**Issues encountered and resolutions.** *Granularity is a conscious divergence from the
emitter path.* The emitter spinners coalesce per-**field**; track keys coalesce
per-**track**, so editing two different keys on one track within 1.5 s folds into one
undo. This is legacy-faithful and unavoidable for the Time spinner (its key identity
drifts per tick); a finer Value-only scheme is a possible future follow-up. *Accepted
bit-collision (negligible).* Track keys put `trackIdx` (0–6) in the same bits the
emitter path fills with a 15-bit field hash; a cross-type fold needs the hash to land in
{0..6} on the same emitter within the window (≈1/4681) and its worst case is one extra
fold — whole-system snapshots + per-entry `selectedIndex` mean no data loss. *Tests need
no key seeding:* the `--test-host` default fixture pre-seeds every track with border keys
at t=0/t=100, so the regressions move the distinct `scale` / `rotationSpeed` tracks
directly (Green/Blue/Alpha alias Red and are avoided).

---
```

- [ ] **Step 4: Commit the docs**

Run (Bash):
```bash
git add tasks/fix-plan.md tasks/ui-delta-report.md CHANGELOG.md
git commit -F - <<'EOF'
docs: VPT-2 track-key undo coalescing shipped (fix-plan, delta-report, CHANGELOG)

Marks the last open ui-delta-report item closed; records the per-track
coalescing design + the conscious per-track-vs-per-field divergence and the
accepted negligible bit-collision.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
git log --oneline -3
```
Expected: docs commit lands; `git status` clean (apart from the unrelated `pnpm-lock.yaml` churn — see Handoff note).

---

## Self-review notes (for the executor)

- **Only one code path changes behavior.** If any test other than the fold case is red *before* Task 3, stop — the guard is catching a fixture assumption that's wrong (e.g. an aliased track, or a fixture without the default border keys); re-confirm the fixture facts above before proceeding.
- **The `pnpm-lock.yaml` working-tree change** is a pre-existing side effect of an earlier `pnpm install` in this worktree, unrelated to this feature. Do not stage it into the feature commits; leave it for the end-of-session decision.
- **Native count is a moving baseline.** The handoff cites 169; if Task 1 yields a different green number, the Task 4 target is *that number + 5*, not a hard 174.
- **Do not push to `lt-4`.** End-of-session FF integration into `lt-4` is a separate, explicit step (CLAUDE.md branch workflow) after the user OKs.
