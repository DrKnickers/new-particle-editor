# [MT-12] Flip default to architecture C + retire env-var dual-toggle

**Predecessor:** [MT-11] (`### 5.1` in ROADMAP, just shipped) wired
the DXGI / composition pipeline end-to-end behind two env vars
(`ALO_WEBVIEW2_HOSTING=composition` + `ALO_VIEWPORT_TRANSPORT=canvas-jpeg`)
and proved it green via the dual-mode a11y regression gate (HWND Win32
UIA + composition DOM snapshot). The pipeline is the proven default
candidate; today's default is the legacy fallback.

**Target branch:** `lt-4`
**Difficulty:** ★★★ (3/5) — tactical conditional flip + test-harness
ripple + docs work; not architecturally novel.
**Effort estimate:** ~3-5 hours. Most of the budget is spec
mode-gate migration (T6) and verification (T9-T10).

---

## 1. Goal + scope

**When this ships:** Cold launch of `ParticleEditor.exe --new-ui`
gets architecture C (DXGI composition mode) by default — no env
vars required. WebView2 hosts in composition mode; engine pixels
reach the screen via the DXGI bridge + DComp engine visual; scene-
rect transform clips engine to centre quadrant; chrome panels
render naturally over the engine. Architecture A (the legacy
AlphaCompositor popup with WS_EX_LAYERED + band-mask occlusion)
remains as an opt-out safety net via a single env var
`ALO_HOSTING_MODE=legacy`. Both the editor and the test harness
default to composition mode after this dispatch.

**In scope.**

- **Single env-var pattern.** Collapse `ALO_WEBVIEW2_HOSTING` +
  `ALO_VIEWPORT_TRANSPORT` into `ALO_HOSTING_MODE` (runtime, C++);
  collapse `VITE_WEBVIEW2_HOSTING` + `VITE_VIEWPORT_TRANSPORT` into
  `VITE_HOSTING_MODE` (build-time, React/Vite). Values: unset or
  `composition` → architecture C (default); `legacy` → architecture
  A; any other value → log warning and fall through to default.
- **C++ default flip.** Invert the conditional at
  [`src/host/HostWindow.cpp:520-532`](src/host/HostWindow.cpp:520):
  default `m_archCMode = true` + `m_compositionMode = true`; the
  env-var read sets both to `false` only when value is `legacy`.
- **React default flip.** Invert
  [`isArchCEnabled()`](web/apps/editor/src/components/ViewportSlot.tsx:29)
  + [`isCompositionMode()`](web/apps/editor/src/components/ViewportSlot.tsx:55)
  into a single `isLegacyMode()` (returns `true` only on
  `VITE_HOSTING_MODE=legacy`); callers reverse polarity accordingly.
- **Desync warning removal.** Delete the warning at
  [`src/host/HostWindow.cpp:545-553`](src/host/HostWindow.cpp:545) —
  with a single env var there's no possible desync between hosting
  mode and viewport transport.
- **Vite build flip.** Default `pnpm --filter @particle-editor/editor build`
  produces a composition-mode dist/ (no env vars required). The
  `VITE_HOSTING_MODE=legacy` build path produces a legacy-mode dist/.
- **Test harness flip.**
  [`web/apps/editor/scripts/run-native-tests.mjs`](web/apps/editor/scripts/run-native-tests.mjs)
  default sets `ALO_HOSTING_MODE=composition` (or relies on default).
  New `--legacy` flag sets `ALO_HOSTING_MODE=legacy` and rebuilds
  dist/ accordingly (or expects caller to rebuild). New
  `pnpm test:native:legacy` script wraps the `--legacy` invocation.
- **Spec mode-gate migration.** Every spec that gates on
  `ALO_WEBVIEW2_HOSTING === "composition"` or the reverse migrates
  to gating on `ALO_HOSTING_MODE` (or its negation). Same for any
  `VITE_*` usage in vitest unit tests.
- **Docs flip.** HANDOFF "How to run composition mode locally"
  section inverts into "How to run *legacy* mode locally" (since
  composition is now default). CHANGELOG entry per project
  convention. Stage 3i manual checklist's mode-instructions update.
  Archive existing `tasks/todo-mt-11-phase-3-a11y-archive.md` is
  already in place (done at the top of this dispatch).
- **ROADMAP.** New `### 2.1 [MT-12]` entry in Medium term (fills
  the slot vacated by [MT-11] shipping); marked shipped + moved to
  `### 5.1` in the same PR; `[MT-12]` tag vacated.

**Out of scope (deliberate).**

- **Deleting architecture A code paths.** This is the Phase 2
  cleanup user explicitly deferred ("only once we confirm that
  Architecture C is stable"). Files like `src/AlphaCompositor.cpp`,
  the band-mask render path, the `viewport/occlude` bridge surface,
  the smoothstep-feather pipeline, and every `useViewportOcclusion`
  callsite stay in place behind the `legacy` env-var gate. Future
  [MT-13] or similar.
- **Deleting architecture-A test specs.** HWND-mode specs
  (`*-composition.spec.ts` siblings without the suffix) continue
  to run under `pnpm test:native:legacy`, ensuring A still has
  coverage as long as it exists.
- **UI toggle for legacy mode** (e.g. View menu entry). Env-var
  only; no settings-store binding, no menu surface. If a daily
  user needs to switch repeatedly that's a sign A is harder to
  delete than expected — file as future work.
- **Backwards compatibility for the old env-var names.**
  `ALO_WEBVIEW2_HOSTING` / `ALO_VIEWPORT_TRANSPORT` /
  `VITE_WEBVIEW2_HOSTING` / `VITE_VIEWPORT_TRANSPORT` are *deleted*
  immediately, not deprecated. Personal-use modding tool with one
  developer; no external scripts; muscle memory updates in one go.
- **Performance benchmark dispatch.** Stage 4 baseline measured
  ~79 fps mean at 3440×1440 under composition mode. The flip
  doesn't change composition perf characteristics — same code path,
  same workload — so no re-benchmark required. (Architecture-A
  perf is fine and unchanged; users who notice regressions can
  fall back via env var.)
- **F8 fallback verification under default mode.** F8 (the
  composition-controller async-failure fallback to A) is existing
  infrastructure and was tested under explicit composition opt-in.
  Smoke-testing it under the new default would require simulating
  a composition init failure — not worth the rig effort for this
  dispatch. Document the assumption in HANDOFF; revisit if a real
  user hits it.

---

## 2. What the codebase already gives us

| Need | Existing artefact | Location |
|---|---|---|
| Runtime env-var read pattern (`_wgetenv` + `wcscmp`) | `m_archCMode` / `m_compositionMode` boot block | [`src/host/HostWindow.cpp:520-532`](src/host/HostWindow.cpp:520) |
| Desync warning (to be deleted) | inline `fprintf(stderr, ...)` | [`src/host/HostWindow.cpp:545-553`](src/host/HostWindow.cpp:545) |
| Build-time env-var read pattern (Vite `import.meta.env` + node `process.env` dual-check) | `isArchCEnabled()` + `isCompositionMode()` | [`web/apps/editor/src/components/ViewportSlot.tsx:29-61`](web/apps/editor/src/components/ViewportSlot.tsx:29) |
| Test harness env-var injection point | `main()` in run-native-tests.mjs | [`web/apps/editor/scripts/run-native-tests.mjs:43+`](web/apps/editor/scripts/run-native-tests.mjs:43) |
| Spec mode-gate pattern (`test.skip(...)` on env-var check) | ~10+ specs in `web/apps/editor/tests/` | grep for `ALO_WEBVIEW2_HOSTING`, `ALO_VIEWPORT_TRANSPORT` |
| F8 composition-controller fallback (when composition init fails, retry HWND mode at runtime) | per HANDOFF / PR #88 | `src/host/HostWindow.cpp` composition-init failure path |
| 29 a11y goldens × 2 modes | committed, deterministic | `web/apps/editor/tests/a11y-goldens/*.golden.{json,yaml}` |
| Bridge surfaces (`layout/scene-rect`, `engine/set/leave-particles`, `engine/set/camera`, etc.) | composition-mode-only paths already wired | `src/host/BridgeDispatcher.cpp`, `src/host/LayoutBroker.cpp`, `src/host/Compositor.cpp` |

What we have to build new:

- A small migration helper or inline conditional that reads
  `ALO_HOSTING_MODE` (default `composition`) into a single boolean
  + drives both `m_archCMode` and `m_compositionMode` from it.
- React-side `isLegacyMode()` replacing the two existing helpers.
- `pnpm test:native:legacy` script in `web/apps/editor/package.json`
  + `--legacy` flag handling in `run-native-tests.mjs`.
- HANDOFF / CHANGELOG / Stage 3i copy updates inverting "how to opt
  into composition" → "how to opt into legacy."

---

## 3. Architecture / implementation approach

### 3.1 C++ host (HostWindow.cpp:520-553)

Replace the two-env-var read + desync warning with a single read:

```cpp
// [MT-12] Default to architecture C (composition + DXGI bridge).
// Opt out via ALO_HOSTING_MODE=legacy → architecture A (AlphaCompositor
// popup + HWND-hosted WebView2). Unknown values warn and fall through
// to default. See ROADMAP §5.1 [MT-11] for the architecture-C ship.
m_archCMode = true;
m_compositionMode = true;
if (const wchar_t* v = _wgetenv(L"ALO_HOSTING_MODE"))
{
    if (wcscmp(v, L"legacy") == 0)
    {
        m_archCMode = false;
        m_compositionMode = false;
    }
    else if (wcscmp(v, L"composition") != 0 && v[0] != L'\0')
    {
        fprintf(stderr,
            "[host] WARNING: ALO_HOSTING_MODE=\"%ls\" unrecognized; "
            "valid values: \"composition\" (default) or \"legacy\". "
            "Falling through to default (composition).\n", v);
        fflush(stderr);
    }
}

// ALO_VIEWPORT_JPEG_Q override still applies regardless of mode (it
// tunes the canvas-jpeg quality when architecture C is active).
if (const wchar_t* q = _wgetenv(L"ALO_VIEWPORT_JPEG_Q"))
{
    int n = _wtoi(q);
    if (n >= 1 && n <= 100) m_archCQuality = n;
}
```

Delete the desync warning block at `:545-553` entirely (no longer
possible).

### 3.2 React/Vite (ViewportSlot.tsx:29-77)

Collapse `isArchCEnabled()` + `isCompositionMode()` into a single
`isLegacyMode()`:

```ts
// [MT-12] Default = architecture C (composition + DXGI). Opt out
// via VITE_HOSTING_MODE=legacy at build time. Mirrors the runtime
// ALO_HOSTING_MODE check in HostWindow.cpp.
function isLegacyMode(): boolean {
  const fromImportMeta = (import.meta as { env?: Record<string, unknown> }).env?.VITE_HOSTING_MODE;
  const fromProcess = typeof process !== "undefined" && process.env
    ? process.env.VITE_HOSTING_MODE
    : undefined;
  return fromImportMeta === "legacy" || fromProcess === "legacy";
}
```

Callers update:
- `const archCEnabled = !isLegacyMode();` (was: `isArchCEnabled()`)
- `const compositionMode = !isLegacyMode();` (was: `isCompositionMode()`)

The frame-ready subscription condition `if (compositionMode) return`
already encodes the right semantics — under composition mode (the
new default), skip JPEG decode + paint because DXGI handles it.

### 3.3 Vite build

No Vite config changes needed if `import.meta.env.VITE_HOSTING_MODE`
is automatically read at build time (which it is — Vite bakes any
`VITE_*` env var by default). Default build = no `VITE_*` set =
default behavior = composition mode. Legacy build = run with
`$env:VITE_HOSTING_MODE = "legacy"; pnpm --filter ... build`.

### 3.4 Test harness (run-native-tests.mjs)

Add `--legacy` flag handling alongside the existing `--update` flag:

```js
const isLegacy = process.argv.includes("--legacy");
if (isLegacy) {
  process.env.ALO_HOSTING_MODE = "legacy";
  console.log("[run-native-tests] --legacy flag → ALO_HOSTING_MODE=legacy");
}
// Default: no env var set → ALO_HOSTING_MODE behaves as unset → composition mode.
```

Caller is responsible for rebuilding dist/ with the matching
`VITE_HOSTING_MODE` value before invoking the harness — same
discipline as today's two-env-var dance, just one var.
Document in HANDOFF.

### 3.5 package.json scripts

```json
{
  "scripts": {
    "test:native": "node ./scripts/run-native-tests.mjs",
    "test:native:legacy": "node ./scripts/run-native-tests.mjs --legacy",
    ...
  }
}
```

The `a11y` / `a11y:update` scripts (T12 ship) continue to work
unchanged — they run in default mode (composition).

### 3.6 Spec mode-gate migration

Every spec that today checks `process.env.ALO_WEBVIEW2_HOSTING ===
"composition"` migrates to `process.env.ALO_HOSTING_MODE !== "legacy"`
(double-negative but matches the new semantics — "composition is
the default"). Specs that check the reverse migrate likewise.

Specs that today check `ALO_VIEWPORT_TRANSPORT === "canvas-jpeg"`
similarly migrate — `ALO_HOSTING_MODE` is the single source of
truth now, and the canvas-jpeg path is one of the two things that
turn on together under composition.

Single helper in `web/apps/editor/tests/helpers/mode.ts` (new file)
to avoid duplicating the predicate across specs:

```ts
export function isLegacyMode(): boolean {
  return process.env.ALO_HOSTING_MODE === "legacy";
}
export function isCompositionMode(): boolean {
  return !isLegacyMode();
}
```

### 3.7 Docs flip

- **HANDOFF "How to run composition mode locally"** (currently lines
  ~328-352 in the lt-4 HANDOFF) inverts to "How to run legacy mode
  locally." Composition is now the default; the env-var dance is
  for the opt-out.
- **CHANGELOG entry** per project convention (top-of-section,
  italic date/hash/PR line, three-section body: what ships / how we
  tackled it / issues encountered).
- **Stage 3i manual checklist** (`tasks/stage-3i-a11y-manual.md`):
  any "rebuild dist/ with matching `VITE_*` pair" instructions
  update to single var.
- **ROADMAP**: new `### 2.1 [MT-12]` entry; marked shipped + moved
  to `### 5.1` in the same PR; bumps 5.1-5.25 → 5.2-5.26; tag
  `[MT-12]` vacated.

---

## 4. Risks named up front + mitigations

1. **Composition mode has latent UX issues only exposed when used
   for daily editing.** Test coverage proves it works; doesn't
   prove it's pleasant. Example failure modes: a subtle perf
   regression under sustained interaction, an animation that
   stutters under DComp's compositing pipeline but not under the
   legacy popup's direct GDI paint, a focus / input edge case the
   `SendMouseInput` forwarding misses.
   - **Mitigation:** the `ALO_HOSTING_MODE=legacy` env var IS the
     safety net. User discovers a problem → set env var → revert
     to A immediately, no rebuild required. Document the env var
     prominently in HANDOFF + add a startup log line that names
     the active mode so issue reports include it.

2. **dist/ build-mode and runtime-mode desync.** A user rebuilds
   dist/ with `VITE_HOSTING_MODE=legacy` then forgets and launches
   without `ALO_HOSTING_MODE=legacy` (or vice versa). The two
   become inconsistent: composition runtime + legacy dist/ means
   the `<img>` element decodes engine JPEG frames and paints on
   top of the DXGI engine visual (the failure mode the existing
   warning at HostWindow.cpp:545-553 guarded against, but for
   different env vars).
   - **Mitigation:** add a startup-time consistency check. The
     React-side `isLegacyMode()` bakes its value at build; the
     host-side `m_compositionMode` reads at runtime. Have the
     React app post a `viewport/mode-claim` (or use the existing
     bridge surface) on boot with its baked mode; if it doesn't
     match the host's, log an error and surface a top-of-app
     banner. **In-scope for this dispatch** — single var makes
     the check trivial.

3. **Spec mode-gate migration miss.** Any spec we forget to
   migrate keeps reading the old env-var name, which is now
   always undefined → spec interprets that as "not composition"
   → wrong skip decision. Could be silent (test that should run
   gets skipped) or noisy (test that should skip tries to run
   against a wrong-mode harness and fails).
   - **Mitigation:** delete the old env-var name strings from the
     codebase entirely; grep returns 0 hits in `web/` post-T6;
     any spec still referencing them fails at TypeScript-compile
     time. Use the new `helpers/mode.ts` helpers to centralize.

4. **F8 composition fallback now needs to work under the new
   default to provide value, but was tested under explicit opt-in.**
   If composition init fails on a new install (rare hardware /
   driver combo, e.g. no DXGI feature level 11.0), F8 should
   gracefully drop to A. We did not test this under "user just
   launches the .exe" conditions.
   - **Mitigation (accepted, not designed around):** out of scope
     per §1; document in HANDOFF that F8 fallback is the
     unverified-under-default safety net beneath the env-var
     safety net. If a user hits it, file as follow-up.

5. **Performance under sustained edit sessions.** Stage 4 baseline
   was 79 fps at 3440×1440 for short benchmarks. Real editing
   sessions involve mod switches, autosave, modal dialogs (which
   trigger the snapshot capture), spawner-instance bursts, etc.
   Each path exists under composition but the cumulative load
   profile differs from the legacy popup path.
   - **Mitigation (accepted):** opt-out env var. If a user reports
     a sustained-load regression, the workaround is one env var
     away while we investigate.

6. **HANDOFF / CHANGELOG count baselines drift.** Today's HANDOFF
   prominently quotes "132 / 0 / 56" as the HWND baseline. After
   the flip, default Playwright runs report 157 / 0 / 31. Anyone
   reading old session notes will assume those numbers are still
   current.
   - **Mitigation:** same-PR HANDOFF refresh quoting both numbers,
     labelled by mode. CHANGELOG entry's "Test counts" table
     explicitly says "Default test:native (composition mode):
     157/0/31; opt-out test:native:legacy: 132/0/56."

7. **Old env-var names in user shell history / batch files.**
   Users who copy-paste from old HANDOFF snippets or have shell
   history setting `ALO_WEBVIEW2_HOSTING=composition` will find
   the var has no effect (since we deleted the code). Silent.
   - **Mitigation:** the runtime check at HostWindow.cpp during
     boot can additionally log a warning if any of the four
     deleted env-var names is set, suggesting the migration path
     to `ALO_HOSTING_MODE`. ~10 lines of defensive code; useful
     for ~1 release until users update muscle memory; delete in
     the Phase 2 cleanup.

---

## 5. Testing & verification

**Build.**
- MSBuild Debug + Release x64 clean via `.sln` (per L-023).

**Default mode (composition — the new default).**
- vitest: **348 / 348** (vitest is mode-agnostic for unit tests
  that don't touch the env var; verify nothing in the migration
  broke the unit suite).
- Playwright `pnpm test:native` (default = composition): expect
  **157 / 0 / 31** — matches today's composition baseline. Re-run
  on first-time flake (bloom-settings composition flake observed
  in MT-11 T16).
- Live-binary smoke:
  - Cold launch `x64/Debug/ParticleEditor.exe --new-ui` with
    **no env vars set**.
  - Verify boot logs name the active mode as composition.
  - Open File menu / Edit menu / View menu — verify chrome
    renders cleanly over engine.
  - Load a sample `.alo` (smoke + additive fire) — verify engine
    pixels render correctly.
  - Resize the window in both directions; verify pane resize
    reveals more scene content (per Stage 5 behaviour).
  - Trigger a modal dialog (View → Lighting…) — verify modal
    backdrop captures snapshot cleanly.
  - Right-click viewport → spawner cursor-bound instance fires.

**Legacy mode (opt-out).**
- `$env:ALO_HOSTING_MODE = "legacy"` + rebuild dist/ with
  `$env:VITE_HOSTING_MODE = "legacy"` + launch.
- Verify boot logs name the active mode as legacy.
- Same smoke walk as above; expect architecture A behaviour
  (visible AlphaCompositor popup with band-mask occlusion).
- Playwright `pnpm test:native:legacy` (rebuild dist/ first):
  expect **132 / 0 / 56** — matches today's HWND baseline.

**Mode-consistency check (R2 mitigation).**
- Launch with default runtime mode but legacy-built dist/ — verify
  startup banner / log surfaces the desync clearly.
- Reverse: legacy runtime + default dist/ — same.

**Spec migration audit.**
- `grep -r "ALO_WEBVIEW2_HOSTING\|ALO_VIEWPORT_TRANSPORT\|VITE_WEBVIEW2_HOSTING\|VITE_VIEWPORT_TRANSPORT" web/ src/` returns **0 hits** post-T6 (excluding archived task docs).
- All specs continue passing under their respective mode runs.

**Old-env-var migration warning.**
- Launch with `$env:ALO_WEBVIEW2_HOSTING = "composition"` set —
  verify startup logs warn about the deprecated env var and
  suggest the new `ALO_HOSTING_MODE` migration.

**Docs sanity check.**
- HANDOFF top section names composition as default; "How to opt
  out into legacy mode" section reads naturally.
- CHANGELOG entry follows project formatting (italic date/hash/PR,
  three sub-sections, etc.).
- Stage 3i checklist no longer references the dual env-var dance.
- ROADMAP: `### 5.1 [MT-12]` entry present; `### 5.2 [MT-11]`
  bumped from old 5.1; `[MT-12]` tag vacated.

**Pre-handoff smoke run.**
- Cold launch x64/Debug build in default mode → menus + .alo load
  + resize. No visible regressions vs the Stage 5 smoke baseline.
- Cold launch with `ALO_HOSTING_MODE=legacy` → same workflow under
  architecture A. No visible regressions vs pre-MT-11 baseline.

---

## 6. Task breakdown (execution order)

1. **T1 — Pre-flight.** Confirm clean tree on lt-4, vitest 348/348
   green, MSBuild Debug + Release x64 clean. ~5 min.
2. **T2 — C++ flip.** Edit `src/host/HostWindow.cpp:520-553`:
   collapse env-var reads, flip default, delete desync warning,
   add unknown-value warning + deprecated-env-var warning per R7.
   Build Debug. ~30 min.
3. **T3 — React flip.** Edit
   `web/apps/editor/src/components/ViewportSlot.tsx:29-77`: collapse
   helpers to `isLegacyMode()`, invert callers. Update any unit
   tests that mocked the old env vars. ~30 min.
4. **T4 — Mode-consistency banner.** Wire boot-time `viewport/mode-claim`
   (or reuse an existing bridge surface) so React posts its baked
   mode + host compares. Log error + surface React-side banner on
   mismatch. ~30 min.
5. **T5 — Test harness flip.** Edit
   `web/apps/editor/scripts/run-native-tests.mjs`: add `--legacy`
   flag. Update `package.json` scripts to add `test:native:legacy`.
   ~30 min.
6. **T6 — Spec mode-gate migration.** Create
   `web/apps/editor/tests/helpers/mode.ts`. Grep for every old
   env-var name in `web/`, `src/`; migrate each callsite. Verify
   `grep` returns 0 hits post-migration. ~60 min (most of the
   work).
7. **T7 — Docs flip.** Update HANDOFF "How to run" section,
   CHANGELOG new top entry, Stage 3i checklist instructions. ~30 min.
8. **T8 — ROADMAP.** Add `### 2.1 [MT-12]` entry to Medium term
   (filling the slot vacated by [MT-11] shipping). Mark shipped +
   move to `### 5.1`; bump 5.1-5.25 → 5.2-5.26 via the same `perl -i`
   pattern as the MT-11 close-out. ~15 min.
9. **T9 — Build + automated verification.**
   - MSBuild Debug + Release x64 clean.
   - vitest 348/348.
   - Default `pnpm test:native`: 157/0/31 expected.
   - `pnpm test:native:legacy` (with dist/ rebuilt in legacy mode):
     132/0/56 expected.
   - grep audit for old env-var names: 0 hits.
   - ~30 min runtime + investigation buffer.
10. **T10 — Pre-handoff smoke.** Cold launch in default mode,
    walk core editing workflow. Launch in legacy mode, same.
    ~15 min.
11. **T11 — Commits + FF.** Probably 2-3 thematic commits:
    (a) C++ + React flip + harness flip (feature),
    (b) Spec mode-gate migration (test),
    (c) ROADMAP + CHANGELOG + HANDOFF + Stage 3i docs.
    FF lt-4 + push (confirm with user first per CLAUDE.md
    visible-actions rule). ~15 min.

**Total:** ~3.5-4.5 hours assuming no surprises in T6 (spec
migration). Buffer to ~6 hours if any spec mode-gate is non-obvious
or if smoke surfaces a real composition-mode UX issue worth
investigating before committing to the flip.

---

## 7. Open questions to resolve before implementation

1. **Should the boot-time log line that names the active mode be
   only in debug builds (`#ifndef NDEBUG`) or unconditional?**
   Unconditional is more useful for issue reports ("user pastes
   their first log line + we know which mode they're in") but adds
   one line of noise to every release-mode launch. Recommend
   unconditional.

2. **Mode-consistency banner UI (R2 mitigation T4): top-of-app
   banner or DevTools-console-only?** Top-of-app banner is more
   visible but requires React UI changes; console is cheap but
   easily missed. Recommend top-of-app banner only on detected
   mismatch (zero overhead in the common case).

3. **Should the new `helpers/mode.ts` also export a vitest helper
   for unit tests that need to mock the mode?** Vitest's
   `vi.stubEnv()` works but adds boilerplate. Recommend yes — a
   2-line `mockMode(mode: "composition" | "legacy")` helper saves
   ~5 lines per test.

4. **Branch: create a new `claude/<random>` branch off `lt-4` for
   this work, or commit directly to lt-4 since we just FF'd here?**
   CLAUDE.md branch workflow says claude/* is the throwaway
   container for in-flight work. Recommend creating a new branch
   `claude/<name>` to match convention (FF back to lt-4 at end of
   dispatch). User to advise on naming or auto-pick.
