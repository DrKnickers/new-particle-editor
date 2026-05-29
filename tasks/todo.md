# [LT-4 follow-up] Test-harness dist/ build-mode gate (HANDOFF item 4)

**Predecessor:** HANDOFF "Known follow-ups" item 4, inherited from
Stage 4f. Adjacent to the item-16 follow-up that just landed the
`--grep` arg-forwarding fix in the same
[`run-native-tests.mjs`](../web/apps/editor/scripts/run-native-tests.mjs).

**Target branch:** `lt-4`
**Difficulty:** ★★ (2/5) — two files, one new tiny Vite plugin, one
new pre-flight block in the harness. No render-path or C++ changes.
**Effort estimate:** ~half-day. ~1h marker + plugin, ~1.5h harness
gate + `--rebuild`, ~2h build-both-modes verification across the
happy/mismatch/missing matrix, ~0.5h docs (CHANGELOG + HANDOFF + the
"How to run modes locally" note + lessons if anything bites).

---

## 1. Goal + scope

**When this ships:** `pnpm test:native` / `pnpm test:native:legacy`
(and the `a11y*` aliases) **refuse to run against a `dist/` that was
built for the wrong hosting mode, or that doesn't exist.** Instead of
silently executing ~157 specs against a broken-rendering editor, the
harness prints exactly what's wrong and the exact command to fix it,
then exits non-zero — *before* launching the host. With `--rebuild`,
it runs the correct `pnpm build` itself and proceeds. This kills the
"dist/mode-mismatch silent failure" class that cost several past
sessions (the failure mode HANDOFF item 4 was filed against).

**In scope:**
- A build-time marker `dist/build-meta.json` recording the baked
  `VITE_HOSTING_MODE` (single source of truth for "what mode is this
  dist/?").
- A pre-launch gate in `run-native-tests.mjs`: read the marker,
  compare to the requested lane (`--legacy` ⇒ legacy, else
  composition), fail-fast on mismatch / missing / unreadable marker.
- An opt-in `--rebuild` flag that runs the matching `pnpm build`
  (with the right `VITE_HOSTING_MODE`) before launching, then
  proceeds.
- Docs: CHANGELOG entry, HANDOFF item 4 → resolved, a one-liner in
  the "How to run modes locally" block noting the gate exists.

**Out of scope (deferred, with reason):**
- **Mode-consistency banner** (HANDOFF item 12 / MT-12 R2) — separate
  follow-up; that's a *runtime* UI affordance, this is a *pre-flight
  build* gate. Different layer, different trigger.
- **Auto-detecting the runtime `ALO_HOSTING_MODE` already in the
  environment** and reconciling it — the harness *sets*
  `ALO_HOSTING_MODE` itself from `--legacy`, so there's no ambiguity
  on the runtime side. Only the build side (`dist/`) is unverified
  today. Not worth guarding a knob we already own.
- **Gating the C++ host build** (`x64/Debug/ParticleEditor.exe`) — the
  harness already throws "Host process exited before CDP came up" if
  the exe is missing/stale, and the build-mode question doesn't apply
  to the host binary (it reads `ALO_HOSTING_MODE` at runtime, not a
  baked constant). Out of scope.
- **`master`-side legacy code** — none touched; this is pure LT-4
  test-harness tooling.

---

## 2. What the codebase already gives us

- **`run-native-tests.mjs`** already has the flag-parsing shape we
  extend: `--update` and `--legacy` are consumed from `process.argv`
  and removed from the forwarded set via `RECOGNISED_FLAGS`
  ([`run-native-tests.mjs:63`](../web/apps/editor/scripts/run-native-tests.mjs)).
  Adding `--rebuild` is one more entry. The script already computes
  `editorDir` / `repoRoot` ([`:19-21`](../web/apps/editor/scripts/run-native-tests.mjs))
  and already `spawn`s child processes shell-free with `process.execPath`
  for the Playwright CLI — the same pattern works for spawning the
  build.
- **`vite.config.ts`** already runs git at config-eval time
  (`execSync("git show -s --format=%cs HEAD")` for `BUILD_DATE`,
  [`vite.config.ts:27`](../web/apps/editor/vite.config.ts)) with a
  try/catch fallback. The marker's `commit` field reuses this exact
  pattern (`git rev-parse --short HEAD`). `import.meta.env`-style
  build constants are already injected via the `define` block
  ([`:49-52`](../web/apps/editor/vite.config.ts)).
- **`VITE_HOSTING_MODE`** is read at build time only through
  `import.meta.env` ([`ViewportSlot.tsx:35`](../web/apps/editor/src/components/ViewportSlot.tsx),
  [`App.tsx:251`](../web/apps/editor/src/App.tsx)). Vite auto-exposes
  any `VITE_`-prefixed process-env var; no `.env` file exists, so the
  mode is purely `$env:VITE_HOSTING_MODE` at build invocation. The
  plugin reads the same `process.env.VITE_HOSTING_MODE` to stamp the
  marker — guaranteed to agree with what the bundle baked.
- **`tests/helpers/mode.ts`** already canonicalises the legacy check
  (`process.env.ALO_HOSTING_MODE === "legacy"`,
  [`mode.ts:16`](../web/apps/editor/tests/helpers/mode.ts)). The
  harness gate mirrors the same "legacy iff the string is exactly
  'legacy'" polarity so build and runtime use one definition.
- **`dist/` is gitignored** (confirmed via `git check-ignore` — the
  marker won't be committed). The host loads `dist/` via the
  `app.local` virtual-host mapping
  ([`HostWindow.cpp:1056-1069`](../src/host/HostWindow.cpp)); a
  missing `dist/` already produces a broken run, so gating on its
  absence is a strict improvement.
- **The canonical build commands** are documented in HANDOFF's "How
  to run modes locally" ([HANDOFF.md:695-723](HANDOFF.md)):
  composition = `pnpm --filter @particle-editor/editor build`;
  legacy = `$env:VITE_HOSTING_MODE="legacy"; pnpm --filter ... build`.
  The fail-fast message and the `--rebuild` path cite/run these.

---

## 3. Architecture / implementation approach

### 3a. Build marker (`vite.config.ts`)

Add a small inline Vite plugin (no new dependency — a plugin is just
an object literal with hook fns):

```ts
// Stamps dist/build-meta.json so the native-test harness can verify
// the baked hosting mode matches the lane it's about to run. Robust
// to minification (the mode is otherwise constant-folded inline and
// not greppable). closeBundle fires once after all output is written.
function buildMetaPlugin(): Plugin {
  return {
    name: "alo-build-meta",
    closeBundle() {
      const hostingMode =
        process.env.VITE_HOSTING_MODE === "legacy" ? "legacy" : "composition";
      let commit = "unknown";
      try {
        commit = execSync("git rev-parse --short HEAD", {
          encoding: "utf8", cwd: __dirname,
        }).trim();
      } catch { /* release tarball / no .git — leave 'unknown' */ }
      const meta = { hostingMode, commit, builtAt: new Date().toISOString() };
      writeFileSync(
        path.resolve(__dirname, "dist/build-meta.json"),
        JSON.stringify(meta, null, 2) + "\n",
      );
    },
  };
}
```

- Added to the `plugins: [...]` array.
- `hostingMode` is the **only** field the gate compares; `commit` /
  `builtAt` are diagnostic (surfaced in the fail-fast message so a
  human can see *how stale* the dist/ is).
- `closeBundle` (not `writeBundle`) chosen: fires once, after Rollup
  finishes writing, even in multi-output builds — and `emptyOutDir`
  has already run so the marker survives.

### 3b. Harness gate (`run-native-tests.mjs`)

New flag in `RECOGNISED_FLAGS`: `--rebuild`. New `requestedMode`
derived from the existing `--legacy` parse. New pre-flight function
run **before `killAny()` / host launch**:

```js
// requestedMode: "legacy" | "composition"
function readDistMode() {
  const p = join(editorDir, "dist", "build-meta.json");
  try { return JSON.parse(readFileSync(p, "utf8")); }
  catch { return null; }   // missing dist/ or pre-marker build
}

function buildCmdFor(mode) {
  // returns the human-facing remediation string + the argv for --rebuild
}

async function ensureDistMode(requestedMode, allowRebuild) {
  const meta = readDistMode();
  const ok = meta && meta.hostingMode === requestedMode;
  if (ok) return;
  if (allowRebuild) { /* spawn pnpm build with right env; re-check */ }
  else { /* print mismatch/missing + exact command; process.exit(1) */ }
}
```

- **Detection:** `meta === null` ⇒ missing/un-marked dist/ (fresh
  worktree, or a dist/ built before this change). `meta.hostingMode
  !== requestedMode` ⇒ wrong-mode dist/. Both fail-fast (or rebuild).
- **Fail-fast message** names the requested lane, the found state
  (`<missing>` / `legacy@abc123 built 2026-05-2X` / `composition@…`),
  the exact PowerShell build command, and the `--rebuild` hint.
- **`--rebuild` path:** spawn the build shell-free. The pnpm CLI on
  Windows is a `.CMD` shim (same constraint the script already
  documents for Playwright at [`:148-152`](../web/apps/editor/scripts/run-native-tests.mjs)),
  so invoke vite's build directly via `process.execPath` against the
  local vite bin, OR run `pnpm` through the documented `.CMD`-safe
  path. Decision recorded in §4 R3. After build, re-read the marker
  and assert it now matches (guards against a build that silently
  no-ops — the L-025 class of failure).
- **Env for rebuild:** set `process.env.VITE_HOSTING_MODE = "legacy"`
  for the legacy lane, delete it for composition, then spawn the
  build with that env. Mirrors the documented manual flow.

### 3c. Data flow

```
pnpm test:native[:legacy] [--rebuild]
  → parse flags → requestedMode, allowRebuild
  → ensureDistMode(requestedMode, allowRebuild)   ← NEW pre-flight
       ok?  → continue
       no + rebuild → pnpm build (right env) → re-check → continue
       no + !rebuild → print remediation → exit 1
  → killAny → launch host → CDP poll → Playwright → teardown
```

---

## 4. Risks named up front + mitigations

1. **`closeBundle` writes the marker even on a failed/partial build.**
   If `tsc -b` fails, `vite build` never runs and `closeBundle`
   doesn't fire — so no stale marker is written on a TS failure
   (good). But if a *Rollup* error aborts mid-write, `closeBundle`
   may not fire either, leaving the *previous* marker in place
   (because `emptyOutDir` ran at build start, dist/ would actually be
   wiped — so a Rollup failure leaves an incomplete dist/ with no
   marker ⇒ gate reads `null` ⇒ fail-fast). Net: a broken build can
   never present a *passing* marker. Accepted; the `builtAt`
   timestamp in the message lets a human spot a suspiciously old
   marker if one ever does survive.

2. **A dist/ built before this change has no marker → every existing
   workflow suddenly fails-fast.** This is the intended behaviour
   (we can't *prove* an unmarked dist/ matches), but it could surprise
   on first adoption. Mitigation: the fail-fast message explicitly
   handles the `null` case with "dist/ has no build-meta marker —
   rebuild it" wording, and `--rebuild` resolves it in one step. The
   very first `pnpm build` after this lands stamps the marker. Call
   this out in the CHANGELOG so it's not a mystery.

3. **Spawning `pnpm` from the harness on Windows (`--rebuild`).**
   `pnpm` is a `.CMD` shim; `spawn` without `shell:true` refuses it
   (the script already documents this footgun for Playwright). Two
   safe options: (a) `spawn(process.execPath, [viteBinJs, "build"])`
   — bypasses pnpm, runs vite directly, shell-free, matches the
   existing Playwright-CLI pattern exactly; (b) `spawn("pnpm", [...],
   {shell:true})` — simpler but reintroduces the shell. **Decision:
   prefer (a)** for consistency with the file's established
   shell-free convention, and because the build is just `tsc -b &&
   vite build` — but `tsc -b` matters (type errors should still fail
   the build). So actually run the package's own `build` script via
   the node/`.bin` path, not vite alone. Finalise during impl; verify
   the chosen spawn actually rebuilds (don't trust exit 0 — L-025).

4. **The `--rebuild` build inherits the harness's mutated
   `process.env`.** Setting `VITE_HOSTING_MODE` on `process.env` then
   spawning with default env-inheritance is correct, but I must
   **delete** the var for the composition lane (not set it to `""` —
   an empty string is `!== "legacy"` so it'd work, but the marker
   plugin's ternary already treats anything non-"legacy" as
   composition, so empty is safe; still, `delete` is cleaner and
   matches the documented `Remove-Item Env:VITE_HOSTING_MODE`).
   Mitigation: explicit `delete process.env.VITE_HOSTING_MODE` for
   composition; unit-reason it in a comment.

5. **Marker drift if someone hand-edits dist/ or builds outside the
   plugin path.** Out of realistic scope — dist/ is a build artifact
   nobody hand-edits. Accepted, not designed around.

6. **`new Date().toISOString()` in the plugin is volatile** (the same
   class as item 16's BUILD_DATE). But `builtAt` is **never** read by
   a golden or any byte-compare — it's diagnostic-only in a gitignored
   file. No normalizer needed. Explicitly noting it so a future reader
   doesn't "fix" a non-problem (cross-ref L-028).

---

## 5. Testing & verification

**Build / marker correctness:**
- [ ] `pnpm --filter @particle-editor/editor build` (composition) →
      `dist/build-meta.json` exists, `hostingMode: "composition"`,
      `commit` matches `git rev-parse --short HEAD`.
- [ ] `$env:VITE_HOSTING_MODE="legacy"; pnpm ... build` → marker
      `hostingMode: "legacy"`. Then `Remove-Item Env:VITE_HOSTING_MODE`.
- [ ] Marker is valid JSON, trailing newline, gitignored
      (`git status` shows nothing under dist/).

**Happy paths (gate passes, full suite runs):**
- [ ] composition dist/ + `pnpm test:native` → gate passes silently
      (or one info line), suite runs → **157 / 0 / 31** baseline
      (re-run the warmup-flake backbone spec once if it trips — known
      flake, HANDOFF residual-flake note).
- [ ] legacy dist/ + `pnpm test:native:legacy` → gate passes, suite
      runs → **132 / 0 / 56** baseline.
- [ ] `pnpm a11y` / `a11y:legacy` (same harness) → gate honoured.

**Mismatch (fail-fast, before host launch):**
- [ ] composition dist/ + `pnpm test:native:legacy` (no `--rebuild`)
      → exits 1, message names "requested legacy, found composition",
      prints the legacy build command, does NOT launch the host
      (no CDP poll, no taskkill spam).
- [ ] legacy dist/ + `pnpm test:native` → symmetric fail-fast.

**Missing / unmarked dist/:**
- [ ] `Remove-Item -Recurse dist` then `pnpm test:native` → fail-fast
      with "no dist/ build-meta marker — build first" + command.
- [ ] A dist/ from a pre-marker build (simulate: delete just
      `build-meta.json`) → same `null`-path fail-fast.

**`--rebuild`:**
- [ ] composition dist/ present + `pnpm test:native:legacy --rebuild`
      → harness runs the legacy build, re-reads marker (now legacy),
      launches, suite runs green. Confirm dist/ marker flipped.
- [ ] no dist/ + `pnpm test:native --rebuild` → builds composition,
      runs green.
- [ ] **Rebuild-noop guard:** confirm the post-rebuild re-check would
      catch a build that silently produced the wrong/old marker
      (inspect marker after rebuild; do not trust the build's exit
      code alone — L-025).
- [ ] After all `--rebuild` tests, leave dist/ in **composition**
      mode (default lane) so the next session isn't surprised.

**Regression / cleanup:**
- [ ] `--update` and `--grep` forwarding still work (item-16 fix
      untouched): `pnpm a11y:update --grep "dialog-about"` still
      scopes (composition lane only — L-028).
- [ ] vitest unchanged: **347 / 347**.
- [ ] MSBuild not required (no C++ touched) — but smoke-launch the
      existing Debug exe once via the harness happy path to confirm
      the new pre-flight didn't break host launch ordering.

**Debug instrumentation:** none persistent. The fail-fast message IS
the diagnostic; no `#ifndef NDEBUG` printfs (this is JS tooling).

---

## Review

**Shipped.** Two files changed, exactly as planned:
- [`vite.config.ts`](../web/apps/editor/vite.config.ts) — `buildMetaPlugin`
  stamps `dist/build-meta.json` (`hostingMode` + `commit` + `builtAt`)
  on `closeBundle`.
- [`run-native-tests.mjs`](../web/apps/editor/scripts/run-native-tests.mjs)
  — `--rebuild` flag, `readDistMode()` / `buildCmdFor()` /
  `rebuildDist()` / `ensureDistMode()` helpers, and the pre-flight
  call wired in before `killAny()`.

**R3 resolved as planned (option a):** the `--rebuild` build runs
`tsc -b` then `vite build` shell-free via `process.execPath` against
the local `node_modules` bins, matching the file's existing
Playwright-CLI pattern — no `.CMD` shim, no shell, no quoting hazard.
The post-rebuild marker re-check (guarding the L-025 silent-no-op
class) is in place and fired cleanly in tests 3 + 4.

**Verification (all green):**
- Marker stamps `composition` and `legacy` correctly; gitignored.
- Fail-fast both mismatch directions + missing/unmarked marker, all
  exit 1 *before* host launch with lane-specific rebuild commands.
- `--rebuild` composition (from no marker) → **157 / 0 / 31**.
- `--rebuild` legacy (from composition) → **132 / 0 / 56**.
- `--grep dialog-about` still scopes to 1 test (item-16 fix intact).
- vitest **347 / 347**; MSBuild Debug x64 clean (preexisting LIBCMTD
  warning only).
- `dist/` left in composition (default lane) for the next session.

**No new lessons.** Nothing bit that wasn't already covered — the one
hiccup (a `--grep` string that matched zero tests) was a test-command
typo on my side, not a code or process defect, and actually confirmed
forwarding works (Playwright filtered to zero rather than running all
188). L-025 (don't trust build exit 0) and L-028 (volatile values)
were *applied* by the design, not newly discovered.

**Deferred, unchanged from §1:** mode-consistency runtime banner
(HANDOFF item 12), runtime-`ALO_HOSTING_MODE` reconciliation, C++ host
build gating — all out of scope with reasons recorded above.
