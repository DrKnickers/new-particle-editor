# [LT-4 follow-up] A11y golden drift triage (HANDOFF item 16)

**Predecessor:** [MT-12] (default flip to architecture C, shipped at
`dd5aa8c`) + the three follow-ups already closed (`d3a4776`
FramePublisher guard, `40b53c3` cursor-unproject fix, plus their
HANDOFF docs commits). Item 16 — 29 a11y golden mismatches per lane
on `lt-4 @ da58968`, pre-existing — surfaced during the item-14
close-out's reproduction sweep.

**Target branch:** `lt-4`
**Difficulty:** ★★★ (3/5) — bounded by a small (13-commit) bisect
window and a clear test infrastructure (`pnpm a11y:update --grep`,
deterministic surface drivers, normalized JSON + ARIA-snapshot YAML).
The risk is in the *judgement* (legit-drift vs hidden-regression),
not the mechanics.
**Effort estimate:** ~half-day to a day. ~2h to build + reproduce
both lanes + classify a single representative surface per bucket.
~3-4h for per-surface triage across all 29. ~1h for refresh + commit
+ docs.

---

## 1. Goal + scope

**When this ships:** Both Playwright lanes return `0 failed`:
`pnpm test:native` (composition) and `pnpm test:native:legacy`
(architecture A). Every refreshed golden has a documented rationale
in the commit message OR the dispatch's todo.md review section. Any
surface that turns out to be a genuine regression hiding behind the
diff is filed as its own HANDOFF follow-up (NOT papered over by a
golden refresh) — that is the explicit hazard HANDOFF item 16 warns
about.

**In scope:**

- Reproduce the 29-per-lane failure count at current `lt-4 @ 6b6e674`
  (verify the carry-forward claim per [L-022](lessons.md#l-022)).
- Diff at least one representative surface from each of the four
  buckets (chrome / dialogs / curve-spinner / keyboard) in BOTH
  lanes. Identify the drift signature.
- IF signature is ambiguous: bisect between `a1000c8` (golden commit)
  and `da58968` (observation commit) to localise the source.
- For each of 29 surfaces: classify as
  - **(a) legit drift** — re-snapshot allowed,
  - **(b) suspicious regression** — file separately, leave golden RED,
  - **(c) test-harness-induced** — fix harness/fixture, not golden.
- Regenerate goldens for category-(a) surfaces only, via scoped
  `pnpm a11y:update --grep '<ids>'`.
- Eyeball `git diff` on regenerated YAML/JSON BEFORE commit — final
  guard against blind refresh.
- CHANGELOG entry + HANDOFF item 16 close-out with commit hashes.

**Out of scope (explicit, with reason):**

- **Architecture-A deletion (HANDOFF item 11)** — user has confirmed
  they're not yet on architecture C daily-use; not unblocked.
- **Wider a11y enhancement / new surface coverage** — separate
  dispatch (also see the 6 deferred surfaces catalogued in
  [`a11y-deferred-surfaces.md`](a11y-deferred-surfaces.md), item 1
  of the HANDOFF carry-forward list).
- **Narrator-speech recording (HANDOFF item 9)** — user-driven,
  out of band.
- **Blind whole-lane golden refresh** — explicitly forbidden by
  HANDOFF item 16 *"don't bundle the refresh with feature work"*.
  The triage step is non-negotiable.
- **Any category-(b) bug fix discovered during triage** — those are
  filed as new HANDOFF entries and fixed in their own dispatches.
  This dispatch produces the *classification*, not the *fix*.

---

## 2. What the codebase already gives us

- **Scoped golden regeneration.** `pnpm a11y:update --grep '<id>'`
  in [`web/apps/editor/package.json`](../web/apps/editor/package.json)
  → [`scripts/run-native-tests.mjs`](../web/apps/editor/scripts/run-native-tests.mjs)
  → sets `UPDATE_A11Y_GOLDENS=1`. `--grep` is the Playwright filter;
  scope to a list of surface IDs to avoid lane-wide regeneration
  (mitigation R7).
- **Composition / legacy lane symmetry.** Same scripts under
  `pnpm a11y:legacy` / `pnpm a11y:update:legacy` — `--legacy` flag
  flips `ALO_HOSTING_MODE`.
- **Pre-normalization raw dump.** HWND lane's
  [`toMatchJSONGolden`](../web/apps/editor/tests/helpers/toMatchJSONGolden.ts)
  writes raw UIA JSON to `tests/a11y-failures/<surface>-actual.json`
  (gitignored) on mismatch — survives until the next run is cleared.
- **Normalizer semantics are clear and small.**
  [`a11y-normalizer.ts`](../web/apps/editor/tests/helpers/a11y-normalizer.ts)
  has three passes: stable-property pruning, wrapper stripping,
  ordinal sort. Modifying the allowlist
  ([`a11y-allowlist.json`](../web/apps/editor/tests/helpers/a11y-allowlist.json))
  is a surgical fix if drift is in a single property.
- **L-024 (UIA non-determinism) precedent.** Right *layer* to solve
  drift at:
  - Tree topology drift → `alwaysStripWrappers` (allowlist).
  - Live React subscription drift → source-side freeze
    (bridge knob + React listener).
  - Genuine semantic change → re-snapshot the golden.
- **Surface drivers are centralized.**
  [`a11y-surfaces.ts`](../web/apps/editor/tests/helpers/a11y-surfaces.ts)
  defines `CHROME_SURFACES`, `DIALOGS_SURFACES`, etc. with
  per-surface setup functions. Any harness-fix in category (c) lands
  in one file.
- **Test fixture is deterministic.**
  [`a11y-base-state.alo`](../web/apps/editor/tests/fixtures/a11y-base-state.alo)
  → loaded in each spec's `beforeEach`, engine paused,
  `stats/set-frozen` freezes the StatusBar live cells (L-024
  precedent). Per-spec contamination cleanup in `afterAll`.
- **Single likely source.** `git log -1 ViewportSlot.tsx App.tsx`
  returns `07ea8a7` — that is the ONLY React-shell-touching commit
  in the bisect range. Helper collapse + boot-mode `[mode] React build
  mode:` console.log + default mode flip all landed there. The drift
  signature should reveal whether it's the helper collapse, the log
  emission, the mode change, or something else.
- **L-022 rule.** Verify carry-forward claims before scoping. The
  29-count from `da58968` may not still be 29 at `6b6e674`; Phase A
  step 6 verifies before triage begins.

---

## 3. Architecture / implementation approach

Four phases, each gated on the previous one's outcome.

### Phase A — Reproduce + characterize (no code changes)

1. **Build** host (Debug + Release per L-023).
2. **Build composition dist/** (`pnpm --filter @particle-editor/editor build`
   with no env vars). The repo's
   [`run-native-tests.mjs`](../web/apps/editor/scripts/run-native-tests.mjs)
   does NOT auto-rebuild dist/ on mode change — must rebuild manually
   (HANDOFF carry-forward item 4 is precisely this gap).
3. **Composition lane run.** `pnpm test:native`. Record exact counts.
4. **Composition lane diff capture.** For ONE surface from each
   bucket (e.g. `menubar-closed`, `dialog-about`, `spinner-focused`,
   `kbd-tab-cycle-stop-1`):
   - Diff stored golden YAML vs Playwright's mismatch output.
   - Note the signature: which lines/keys differ.
5. **Build legacy dist/** (`VITE_HOSTING_MODE=legacy pnpm --filter
   @particle-editor/editor build`).
6. **Legacy lane run.** `pnpm test:native:legacy`. Record counts.
7. **HWND lane diff capture.** Same four representative surfaces;
   inspect `tests/a11y-failures/<surface>-actual.json` vs
   `tests/a11y-goldens/<surface>.golden.json`.
8. **Verify HANDOFF claims** (per L-022):
   - Failure count = 29 per lane? Or different?
   - Same 29 surfaces in each lane? Or divergent?
   - Same drift signature across buckets?
9. **Snapshot Phase A findings into todo.md** before Phase B begins.

### Phase B — Bisect (conditional)

**Skip Phase B IF Phase A surfaces a single obvious signature** (e.g.
"every surface lost the `[mode] React build mode` log line's adjacent
node" → `07ea8a7` clearly). Cite the commit in Phase C and proceed.

**Run Phase B IF** the signature is ambiguous or affects buckets
differently:
- `git bisect start da58968 a1000c8`.
- For each step: rebuild composition dist/ + run ONE failing surface
  via `--grep`. ~13 commits = ~4 bisect steps.
- Result: source-commit SHA + a one-line explanation.

### Phase C — Per-surface triage

For each of 29 (or actual-count) surfaces, record in a table within
this todo.md:

| Surface | Lane | Category | Rationale (≤ 1 sentence) |
|---|---|---|---|

Categories:

- **(a) legit drift** — UI improved or changed deliberately
  (e.g. a button got a clearer aria-label, a role was correctly
  re-typed). Refresh golden.
- **(b) suspicious regression** — UI lost a property it ought to
  have, or got a property it ought NOT to have (e.g. lost
  `IsKeyboardFocusable`, an aria-label disappeared, focus order
  reordered semantically). File NEW HANDOFF item with surface ID +
  diff; leave golden RED.
- **(c) test-harness-induced** — drift is in normalization, fixture,
  setup driver, or boot-state. Fix the *harness*, not the *golden*.

### Phase D — Refresh + commit

1. **Scoped refresh.** Build list of category-(a) surface IDs;
   construct `--grep '<id1>|<id2>|...'` regex. Run
   `pnpm a11y:update --grep '...'` and
   `pnpm a11y:update:legacy --grep '...'`. (Both lanes need the
   refresh, since both have their own goldens.)
2. **Eyeball the diffs.** `git diff -- 'web/apps/editor/tests/a11y-goldens/*'`.
   Any surface outside the category-(a) list that shows changes is a
   bug — investigate before proceeding.
3. **Re-run both lanes** unfiltered. Expect: 0 failed (or `N` failed
   where `N` matches the count of category-(b) surfaces filed
   separately).
4. **Commit.** Two-part: golden refresh + harness fixes (if any from
   category (c)). Per `CLAUDE.md` "commit messages still use feat:/
   fix:/docs:" convention:
   ```
   test(LT-4): [MT-12 follow-up] refresh a11y goldens for <N> surfaces
   ```
5. **CHANGELOG.md entry** per the format header rules: section title
   plain prose, top of file in reverse-chrono, three bolded labels
   (What ships / How we tackled it / Issues encountered and
   resolutions), `---` delimiter.
6. **HANDOFF.md item 16** updated with resolution + commit hash. If
   category (b) surfaces were filed, add them as new HANDOFF items
   numbered above 16.

---

## 4. Risks named up front + mitigations

1. **R1 — Blind golden refresh papers over a real bug.** HANDOFF
   item 16 explicitly warns: *"don't bundle the refresh with feature
   work"*. **Mitigation:** Phase C is non-negotiable; every category-
   (a) classification has a written rationale; Phase D step 2's
   `git diff` eyeball is the last guard. If I find myself thinking
   *"just refresh all 29 and move on"*, stop. That's the failure mode.

2. **R2 — The 29-count is stale at `lt-4 @ 6b6e674`.** Four commits
   landed since `da58968` (the FramePublisher guard, the cursor-
   unproject fix, plus their docs). The FramePublisher guard COULD
   affect captured surfaces (it changes per-frame JPEG emit under
   composition — but only the viewport pill / status bar surfaces
   could see it, and only if Playwright fires within a frame
   window). **Mitigation:** Phase A step 8 is the verify gate; if
   count shifts, re-scope before triage.

3. **R3 — The 29 surfaces in HWND lane may not be the same 29 in
   composition lane.** HANDOFF asserts identical set; verify per
   L-022. **Mitigation:** Phase A step 8 explicitly compares the
   two lists. If they diverge, expect to run Phase C separately per
   lane (cost ~2× the triage time, accepted).

4. **R4 — Bisect (Phase B) wastes effort if Phase A finds a clear
   signature.** `git log -1` evidence strongly suggests the source
   is `07ea8a7` alone; bisect is overkill for a single-suspect
   range. **Mitigation:** Phase B is *conditional* — skip if Phase A
   step 4/7 finds a single signature consistent with `07ea8a7`'s
   changes.

5. **R5 — Composition (YAML) and HWND (JSON) capture pipelines
   differ.** A single React-side change manifests differently in
   each. **Mitigation:** triage is per (surface × lane) pair, not
   per surface. Cost: ~2× inspection. Acceptable; that's the price
   of dual-lane coverage.

6. **R6 — `emitter-mutations.spec.ts:84` is a known flake.** HANDOFF
   notes intermittent failure independent of this work.
   **Mitigation:** if Phase A's count is `29 + 1` and the +1 is that
   spec, re-run once and treat second result as authoritative.

7. **R7 — `UPDATE_A11Y_GOLDENS=1` without `--grep` regenerates EVERY
   captured golden in the run.** Including ones that didn't fail.
   **Mitigation:** Phase D step 1 always passes `--grep '<exact ids>'`.
   Never lane-wide.

8. **R8 — `tests/a11y-failures/` is gitignored, so post-run cleanup
   destroys diagnostic dumps.** **Mitigation:** if Phase B (bisect)
   is invoked, capture each iteration's diff into a per-step memo
   in todo.md BEFORE the next iteration's run clears the dump
   directory.

9. **R9 — `dist/` rebuild fatigue.** Phase A needs two distinct
   dist/ builds (composition + legacy); Phase B (if invoked) needs
   ~4 more (one per bisect step). Each `vite build` is ~30-60s but
   cumulatively adds up. **Mitigation:** plan acknowledges the cost
   upfront; not avoidable until carry-forward item 4 (test-harness
   pre-flight rebuild gate) is implemented — separate dispatch.

10. **R10 — Category (c) (test-harness-induced) fix scope creep.**
    If a fixture or surface driver is the source, the "fix" could
    grow into a refactor. **Mitigation:** any harness fix that
    exceeds ~30 min or touches more than one file gets STOPPED and
    re-scoped per CLAUDE.md "if something goes sideways: STOP and
    re-plan". Default: refresh the golden in category (a) terms
    UNLESS the harness fix is mechanically simple.

---

## 5. Testing & verification

### Pre-flight (Phase A)

- [ ] `git rev-parse HEAD` matches `origin/lt-4` (lineage clean).
- [ ] MSBuild Debug x64 via `.\ParticleEditor.sln` — clean (L-023).
- [ ] MSBuild Release x64 via `.\ParticleEditor.sln` — clean.
- [ ] `pnpm --filter @particle-editor/editor build` (composition) — clean.
- [ ] `pnpm test:native` runs to completion; record `N passed / M failed / K skipped`.
- [ ] `M` equals expected 29 (R2 verification). If not 29, snapshot the actual into todo.md Phase A review section before continuing.
- [ ] `VITE_HOSTING_MODE=legacy pnpm --filter @particle-editor/editor build` — clean.
- [ ] `pnpm test:native:legacy` runs to completion; record counts.
- [ ] Set of failing surface IDs in composition lane == set in HWND lane (R3 verification).

### Phase A inspection (4 sample surfaces, both lanes each — 8 diff captures)

- [ ] `menubar-closed` (chrome bucket): composition YAML diff captured + HWND JSON diff captured into todo.md.
- [ ] `dialog-about` (dialogs bucket): both diffs captured.
- [ ] `spinner-focused` (curve-spinner bucket): both diffs captured.
- [ ] `kbd-tab-cycle-stop-1` (keyboard bucket): both diffs captured.
- [ ] Single signature identified OR ambiguity confirmed → decide Phase B skip/run.

### Phase C (triage — every surface)

- [ ] 29 (or actual count) surfaces classified per the (a)/(b)/(c) table in §3.
- [ ] Each classification has a one-sentence rationale.
- [ ] Category (b) count == count of NEW HANDOFF items filed.

### Phase D (refresh)

- [ ] `--grep` regex constructed with only category-(a) surface IDs (no wildcards, no over-broad patterns).
- [ ] Composition lane refresh runs successfully.
- [ ] Legacy lane refresh runs successfully.
- [ ] `git diff -- 'web/apps/editor/tests/a11y-goldens/*'` shows ONLY category-(a) golden changes (no surprise updates).
- [ ] `pnpm test:native` returns `(N - <count of cat-(a)>) passed / <count of cat-(b)> failed / K skipped` (or 0 failed if no category (b)).
- [ ] `pnpm test:native:legacy` mirrors.
- [ ] No new failures introduced in non-a11y specs.

### Documentation

- [ ] CHANGELOG.md: new entry at top, reverse-chrono position, format-conforming (italic date line, bolded section labels, `---` delimiter, `src/...` style path:line links if any code is cited).
- [ ] HANDOFF.md item 16: strikethrough + ✅ RESOLVED at `<hash>` with one-paragraph resolution summary.
- [ ] HANDOFF.md: any category (b) HANDOFF items added below 16, numbered 17+.
- [ ] todo.md: review section appended at the end covering Phase A findings + Phase C triage table + Phase D refresh outcome.

### Debug instrumentation

- N/A by default. If Phase C surfaces a category (c) where harness
  emits non-deterministic content, any new debug logging in the
  harness fix gets prefixed `[a11y-fixture]` for greppability per
  the repo convention.

---

## Pre-work check-in summary

- **Plan size:** ★★★ (3/5). Phases A and B are mostly inspection; the
  load-bearing step is Phase C's triage discipline.
- **Single likeliest source:** `07ea8a7` (MT-12 default flip +
  ViewportSlot helper collapse + boot-mode log on App mount). Bisect
  may be unnecessary.
- **Failure mode to avoid:** blind regeneration of all 29 goldens.
  Phase C is the firewall.
- **Items NOT being touched:** architecture-A deletion (item 11),
  the 6 deferred a11y surfaces (item 1), Narrator-speech recording
  (item 9), the test-harness rebuild gate (item 4).
- **Open questions for the user before coding:**
  1. If a small number of surfaces (~1-3) classify as category (b)
     during triage, do you want me to (i) file each as its own
     HANDOFF item and ship the (a) refresh anyway, or (ii) hold the
     dispatch and fix (b) inline first?
  2. If Phase A reveals the failure count has shifted significantly
     from 29 (say, > 35 or < 20), should I STOP and re-plan, or
     proceed with the actual-count triage?
  3. Anything specific you want me to grep for in the diffs? (e.g.
     particular components you suspect MT-12 destabilized.)

---

## Review (post-dispatch, 2026-05-27)

### What actually happened vs the plan

**Plan size collapsed from ★★★ to ★★** mid-Phase A when the first
diff inspection revealed the failures weren't drift at all — they
were two unrelated test-infrastructure issues that had been latent
since the goldens were first committed. STOP-and-re-plan'd with the
user after presenting findings; the user picked the three fixes
(BUILD_DATE pin / broader .gitattributes / bundle --grep fix) and I
implemented them in ~30 min of mechanical work.

**Phases B (bisect) and C (per-surface triage) were rendered moot**
by Phase A. The plan's discipline still earned its keep: Phase A's
"capture one representative diff per bucket" step is what surfaced
the autocrlf signature in ~5 minutes. Without that structured
inspection, the temptation would have been to skip straight to
`pnpm a11y:update` (which would have papered over both the LF/CRLF
fix AND the build-date bug, AND would have regenerated all 29
goldens due to the silent --grep drop). The plan's R1 ("blind
refresh papers over a real bug") and R7 ("--grep silently dropped")
mitigations directly prevented both failure modes.

### What shipped

1. **`.gitattributes`** (new file at repo root) — `text eol=lf`
   for `tests/a11y-goldens/*.golden.json` + `*.golden.yaml`, plus
   forward-looking patterns (`*.snap`, `*.golden.txt`). Working-tree
   re-smudged via `rm + git checkout HEAD --`; `git ls-files --eol`
   confirms `w/lf`.
2. **`web/apps/editor/vite.config.ts`** — `BUILD_DATE` pinned to
   `git show -s --format=%cs HEAD` with fallback to `new Date()`
   if git is unavailable. About dialog now stable across rebuilds
   of the same commit. Verified the built bundle contains exactly
   one occurrence of `2026-05-26` (the HEAD commit date).
3. **`web/apps/editor/scripts/run-native-tests.mjs`** — forwards
   `process.argv.slice(2)` extras (minus `--update` / `--legacy`)
   to the Playwright spawn. R7 of plan eliminated.
4. **`tasks/lessons.md`** — three new entries: L-025 (MSBuild
   via PowerShell, not Bash), L-026 (autocrlf + byte-exact
   snapshots), L-027 (run-native-tests.mjs --grep forwarding).
5. **`tasks/HANDOFF.md` item 16** — strikethrough + ✅ RESOLVED
   with full diagnosis paragraph + fix list. Hash backfill pending
   commit.
6. **`CHANGELOG.md`** — new entry at top of changelog section per
   format conventions (reverse-chrono, italic date line, bolded
   section labels, `---` delimiter). Hash backfill pending commit.

### Verification gate result

| Lane | Before | After |
|---|---|---|
| Composition (default) | `128 passed / 29 failed / 31 skipped` | **`157 / 0 / 31`** ✅ |
| HWND / legacy | `103 passed / 29 failed / 56 skipped` | **`132 / 0 / 56`** ✅ |
| MSBuild Debug x64 (.sln) | clean | clean |
| MSBuild Release x64 (.sln) | clean | clean |
| Composition `dist/` build | clean | clean (BUILD_DATE = `2026-05-26`) |
| Legacy `dist/` build | clean | clean (BUILD_DATE = `2026-05-26`) |

Both lanes back to the pre-drift baselines documented in
[MT-12]'s ship — `157/0/31` and `132/0/56`.

### Decisions that didn't make it into the original plan

- **Task 11 (refresh dialog-about goldens)** was deleted as
  unnecessary once the BUILD_DATE pin's value was computed: HEAD's
  commit date is `2026-05-26`, which is what the existing goldens
  already record. The new snapshot output is byte-identical to the
  committed golden, so no refresh needed.
- **Phase B (bisect)** was skipped — Phase A's diff inspection
  conclusively named the cause.

### What's still open / out of scope

- **HANDOFF item 11 (architecture-A deletion)** — still gated on
  user-side daily-use confidence in architecture C. User confirmed
  they're "not really" using composition mode daily yet at dispatch
  start. Not unblocked by this dispatch.
- **Carry-forward item 4 (test-harness pre-flight rebuild gate)**
  — not addressed. This dispatch's --grep forwarding is adjacent
  but doesn't auto-rebuild dist/ on mode change. Still worth a
  separate small dispatch.
- **Item 9 (Narrator-speech recording)** — user-driven, untouched.
- **Item 1 (6 deferred a11y surfaces)** — untouched.

### Lessons captured

Three new entries in `tasks/lessons.md` (L-025 / L-026 / L-027).
The full text lives at the bottom of that file; one-line summaries:

- **L-025:** MSBuild on Windows must be invoked via PowerShell.
  Bash mangles `/`-prefixed switches via MSYS path translation;
  MSBuild then prints `MSB1008` but the response-file fallback
  gives exit code 0, so the build silently no-ops.
- **L-026:** Byte-exact snapshot files need `text eol=lf` in
  `.gitattributes`. Without it, `core.autocrlf=true` smudges
  every committed LF file to CRLF on Windows checkout and every
  snapshot test false-fails.
- **L-027:** Test wrappers that hard-code their downstream tool's
  arg list MUST forward unknown args. `pnpm a11y:update --grep
  "..."` was a silent no-op for many sessions because the wrapper
  never plumbed `--grep` through to Playwright.

### Total elapsed

- Plan + survey: ~30 min
- Builds + initial test runs: ~20 min (mostly waiting on
  vitest/Playwright/MSBuild)
- Root-cause diagnosis + re-plan check-in: ~15 min
- Fixes + verification: ~30 min
- Docs (lessons + HANDOFF + CHANGELOG + this review): ~30 min

Total: ~2h elapsed wall clock. Plan estimated "half-day to a day"
for the original ★★★ shape; the discovered ★★ shape came in at
the low end of that range thanks to the early STOP-and-re-plan.
