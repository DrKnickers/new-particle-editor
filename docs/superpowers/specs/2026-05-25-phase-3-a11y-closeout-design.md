# Phase 3 a11y close-out — design spec

**Phase:** [MT-11] WebView2 composition hosting — final hygiene
**Date:** 2026-05-25
**Predecessor:** [MT-11] Phase 3 (Stages 0–5 shipped). See [`tasks/todo-mt-11-phase-3-archive.md`](../../../tasks/todo-mt-11-phase-3-archive.md), especially §6 "Stage 3 (composition hosting) acceptance — rigorous a11y."
**Target branch:** `lt-4`
**Difficulty:** ★★★★ (upper edge)
**Effort estimate:** ~3-4 days realistic; possibly 5 once interaction scenarios for Tab/F2/Escape get spec'd.

---

## 1. Why this exists

Phase 3's Stage 3 acceptance bar called for two a11y artifacts that never
shipped:

1. **`tests/native/a11y-narrator.spec.ts`** — drive Windows Narrator via
   UI Automation, compare announcement strings to a golden file.
2. **Manual a11y smoke** — Narrator reads visible chrome correctly; Tab
   cycles; F2 enters inline rename; Escape closes; IME composes.

The HANDOFF tagged this as "Stage 3h Playwright `page.accessibility.snapshot()`
golden suite + Stage 3i user-driven Narrator/IME manual" with a ~1d
estimate. After clarifying conversation the scope was deliberately
re-expanded to match the original Stage 3 "rigorous a11y testing (per
user direction)" bar, with a refined architecture:

- The automated suite uses **Win32 UI Automation directly** (not just
  `page.accessibility.snapshot()`), because composition mode could in
  principle expose a different UIA tree than HWND mode — and that's
  exactly the FD6-class regression we need to gate against.
- The manual smoke includes a **one-time Narrator-speech confidence
  pass** with a committed recording, ensuring the UIA tree we test
  against actually announces what we believe it does.

The result closes Phase 3's documentation and acceptance hygiene; no
production code changes are expected unless a11y gaps surface during
build-out.

---

## 2. Goal + scope

**When this ships:** the new-UI chrome has a durable Playwright a11y
regression gate covering every interactive surface, runs in both HWND
default mode and composition mode, asserts cross-mode equality as an
explicit invariant, and has a one-time manual Narrator-speech recording
archived for confidence. Phase 3 acceptance can be declared closed.

**In scope:**

- **Regression gate** (~3 days): Playwright spec-per-category structure
  (`a11y-chrome`, `a11y-dialogs`, `a11y-keyboard`, `a11y-curve-spinner`)
  driving a UIA-tree capture tool, comparing against JSON goldens with a
  field-level allowlist. Runs under both HWND + composition lanes.
- **Cross-mode equality spec** (~30 min): a fifth Playwright spec that
  reads both modes' goldens for each surface and asserts byte-equality
  after normalization. FD6-class regression gate, encoded.
- **UIA inspector**: a Node-side library if one exists with reasonable
  maintenance (Phase 0 spike decides), else a small C++ standalone tool
  at `src/host/spike/uia_inspector.cpp` matching the existing
  `dxgi_spike.cpp` pattern.
- **Normalizer + allowlist comparator**: TS module that drops volatile
  UIA fields, sorts deterministically, and diffs property-by-property.
  Allowlist is hand-edited and reviewable.
- **Surface coverage**: ~20 distinct surfaces nominally; budget allows
  for growth to ~30 once drivers are written (R4). Covers chrome
  (MenuBar/Toolbar/EmitterTree/PropertyTabs/ViewportPill), all modal
  dialogs (Modal/SaveChanges/IncrementIndex/ModNickname/Rescale/
  RescaleEmitter/ImportEmitters/Lighting/Bloom/BackgroundPicker/
  GroundTexture/Primitives/Spawner), keyboard-paths (Tab/F2/Escape/
  arrow-nav), CurveEditor + Spinner.
- **Stage 3i manual checklist** at `tasks/stage-3i-a11y-manual.md` —
  sections for Tab cycle, F2 rename, Escape close, arrow-key tree nav,
  IME compose smoke, Narrator-speech verification.
- **Narrator-speech recording** at `tasks/stage-3i-narrator-recording.mp4`
  — ~5-min screen+audio capture, committed as binary.
- **Phase 0 spike artifacts**: Node-lib search results doc; cross-mode
  wrapper-visual probe doc; both committed to `tasks/`.
- **CHANGELOG + ROADMAP + HANDOFF updates** per CLAUDE.md conventions.

**Out of scope (filed for later):**

- **Continuous Narrator-speech automation** (the original Stage 3 plan's
  "compare announcement strings to a golden file" interpreted as
  programmatic TTS capture). Treated as a separate ROADMAP entry if
  ever requested — marginal catch-rate over the UIA-tree approach is
  modest, programmatic Narrator-speech capture has no clean API, and
  the one-time confidence recording covers the "are we testing the
  right thing?" question.
- **Surfaces requiring >30 min of fixture setup** (per R3 mitigation) —
  dropped from this dispatch, listed as out-of-scope follow-ups in the
  implementation plan as they surface.
- **A11y improvements** (adding missing aria-labels, fixing focus
  trapping, etc.) — this dispatch *measures* and *gates*; any gaps
  discovered get filed as separate fix dispatches with their own
  priority assessment.
- **Per-Windows-version UIA-tree test matrix** — single-dev-rig
  discipline applies, per existing project convention.

**Explicitly not happening:** silently allowing per-mode goldens to
diverge to make the cross-mode spec pass. If composition mode
legitimately exposes a different UIA tree than HWND mode (R2), the
divergence gets *named* in the normalizer's strip-list or the
cross-mode spec's documented allow-list — not hidden via per-mode
goldens with no cross-check.

---

## 3. What the codebase already gives us

| Existing surface | How it's relevant |
|---|---|
| `web/apps/editor/tests/*.spec.ts` (~32 Playwright specs) | Test harness shape, fixture patterns, `pnpm test:native` invocation. The new a11y specs slot into the same shape. |
| `dxgi-transport.spec.ts` + `dxgi-scene-rect.spec.ts` + `composition-hosting.spec.ts` | Reference pattern for composition-mode-gated specs. The cross-mode lane already exists; we add specs to it. |
| `dxgi_spike.cpp` (Stage 0 spike app pattern) | Template for `uia_inspector.cpp` if Phase 0 rules out Node libs. Standalone exe, separate vcxproj, no engine dependency. |
| `@radix-ui/react-menubar` + Radix Dialog primitives | Provide most ARIA semantics out of the box (menubar role, menu items, dialog modals, focus management). 268 explicit aria/role attributes across 44 files supplement Radix's defaults. |
| `ALO_WEBVIEW2_HOSTING=composition` + `ALO_VIEWPORT_TRANSPORT=canvas-jpeg` env-var pattern + composition-mode dist/ build | The composition lane is already wired; we don't invent a mode-switching mechanism. |
| `BridgeDispatcher::ResetSavedBaseline()` + existing fixture loaders | Surface drivers (C4) can lean on the existing `bridge.loadFixture("a11y-base-state.alo")` pattern. Just need one fixture file with representative tree content. |
| `package.json` scripts (`test:native`, `lint`, `test`) | Add `a11y` and `a11y:update` scripts alongside. No new tooling dependencies. |

---

## 4. Architecture

### 4.1 Three lanes + a meta-spec

```
┌─ Regression gate (durable, runs per lane) ──────────────────────────────┐
│                                                                          │
│  Playwright spec                  UIA inspector              JSON golden │
│  (Node, per-surface)   ─spawn─▶   (Node lib OR    ─stdout─▶  (per       │
│  ┌──────────────────┐             C++ tool)                  surface,   │
│  │ a11y-chrome      │                                        committed) │
│  │ a11y-dialogs     │             ┌──────────────────┐                  │
│  │ a11y-keyboard    │    ─load─▶  │ Normalizer +     │  ─compare─▶ PASS │
│  │ a11y-curve-spinr │             │ allowlist        │             /FAIL│
│  └──────────────────┘             │ comparator       │                  │
│                                   └──────────────────┘                  │
└──────────────────────────────────────────────────────────────────────────┘

┌─ One-time confidence pass (manual, run once at ship) ───────────────────┐
│                                                                          │
│  tasks/stage-3i-a11y-manual.md   ─follow─▶  Operator runs Narrator      │
│  tasks/stage-3i-narrator-          ─cap─▶   + screen+audio capture      │
│  recording.mp4 (committed)                                               │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Cross-mode invariant (FD6-class regression gate) ──────────────────────┐
│                                                                          │
│  HWND golden ──── strict equality ──── Composition golden                │
│  (after normalization, asserted in a dedicated cross-mode spec)          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Phase 0 spike (~30 min, before any production code)

Two independent investigations:

1. **Node-side UIA lib search.** Check npm registry for maintained
   bindings that can take an HWND and walk the UIA subtree.
   Likely outcome: nothing usable (R1). Decision and supporting
   evidence committed to `tasks/phase-0-a11y-uia-node-lib-search.md`.
2. **Cross-mode wrapper-visual probe.** Spawn the editor in HWND mode,
   capture the menubar UIA tree manually (using `inspect.exe` or a
   one-off PowerShell snippet). Repeat under composition mode. Eyeball
   the diff. Decision and findings committed to
   `tasks/phase-0-a11y-cross-mode-probe.md`.

Phase 0 gate: if the cross-mode wrapper-visual probe reveals
divergence that can't be normalized away (R2 mitigation insufficient),
**stop and re-plan** — the cross-mode equality contract isn't
feasible and the design changes shape.

### 4.3 Test contract (uniform across both impl choices)

```typescript
// helpers/uia.ts
export async function captureUIA(
  hwnd: bigint,
  surfaceId: string,
  options?: { depth?: number }
): Promise<UIATreeNode>;
```

Whether the wrapper shells out to `uia_inspector.exe` or calls a Node
lib, the spec doesn't care. This isolates the impl choice behind a
single seam.

### 4.4 Normalization pipeline

```
Raw UIA JSON
    │
    ▼
1. Drop properties not in allowlist's `stable` set
    │
    ▼
2. Drop properties in allowlist's `volatile` set explicitly
   (BoundingRectangle, transient runtime IDs, IsOffscreen, ...)
    │
    ▼
3. Drop "always strip" wrappers (e.g. WebView2 composition root
   wrapper if Phase 0 confirms its existence)
    │
    ▼
4. Sort children deterministically (AutomationId, then position)
    │
    ▼
5. Canonical JSON (sorted keys, stable indentation)
    │
    ▼
Normalized JSON ready for diff or write-as-golden
```

### 4.5 Cross-mode equality spec

```typescript
// a11y-cross-mode.spec.ts
test.describe.parallel("a11y cross-mode equality", () => {
  for (const surface of ALL_SURFACES) {
    test(`${surface} HWND === composition`, () => {
      const hwnd = readGolden(`${surface}.golden.json`);
      const comp = readGolden(`${surface}.composition.golden.json`);
      const hwndN = normalize(hwnd, allowlist);
      const compN = normalize(comp, allowlist);
      expect(compN).toEqual(hwndN);
    });
  }
});
```

Pure file IO + comparison; doesn't need either dist/ active.

---

## 5. Components

| # | Component | Path | What it does |
|---|---|---|---|
| C1 | **UIA inspector** (wrapper) | `web/apps/editor/tests/native/helpers/uia.ts` | Takes HWND + capture-target ID, returns normalized JSON. Hides whether underlying call is Node lib or C++ exe. |
| C1a | **C++ inspector** (built only if Phase 0 rules out Node lib) | `src/host/spike/uia_inspector.cpp` + `.vcxproj` | Standalone Win32 exe matching `dxgi_spike.cpp` pattern. CLI: `uia_inspector.exe --hwnd 0xNNNN --capture <id> [--depth N]`. Emits JSON to stdout. ~200 LoC. |
| C2 | **Normalizer + comparator** | `web/apps/editor/tests/native/helpers/a11y-normalizer.ts` | Pure-TS. Allowlist-driven, deterministic-sort, canonical JSON. |
| C3 | **Allowlist config** | `web/apps/editor/tests/native/a11y-allowlist.json` | Single source of truth for which UIA properties matter. Hand-edited; PR-reviewable. |
| C4 | **Surface drivers** | `web/apps/editor/tests/native/helpers/a11y-surfaces.ts` | One function per surface (~20-30 total): `openMenu("File")`, `openDialog("save-changes")`, `focusEmitterTree()`, etc. Leaves app in captured state, returns root HWND. **Risk concentration point (R3).** |
| C5 | **Spec files** | `tests/native/a11y-chrome.spec.ts`, `a11y-dialogs.spec.ts`, `a11y-keyboard.spec.ts`, `a11y-curve-spinner.spec.ts` | Parametrized over their surfaces. Per surface: `driver() → uia.capture() → normalize() → expect.toMatchJSONGolden()`. |
| C6 | **Cross-mode equality spec** | `tests/native/a11y-cross-mode.spec.ts` | Reads each `<surface>.golden.json` (HWND) + `<surface>.composition.golden.json`, asserts byte-equality. FD6-class regression gate. |
| C7 | **Goldens** | `tests/native/a11y-goldens/<surface>.{golden,composition.golden}.json` | ~30-50 files per mode × 2 modes (R4). Committed. Re-generation via `pnpm a11y:update [surface-glob]`. |
| C8 | **Manual checklist** | `tasks/stage-3i-a11y-manual.md` | Markdown with check boxes. Sections: Tab cycle, F2 rename, Escape close, arrow-key tree nav, IME compose smoke, Narrator-speech verification. |
| C9 | **Narrator recording** | `tasks/stage-3i-narrator-recording.mp4` | ~5-min screen+audio capture made while running the C8 Narrator section. Committed as binary. |
| C10 | **Package scripts** | `web/apps/editor/package.json` | `"a11y": "playwright test --grep a11y-"`, `"a11y:update": "UPDATE_A11Y_GOLDENS=1 playwright test --grep a11y-"`. |
| C11 | **Custom matcher** | `web/apps/editor/tests/native/helpers/toMatchJSONGolden.ts` | Playwright `expect.extend()` matcher. On `UPDATE_A11Y_GOLDENS=1` writes; otherwise asserts. Dumps raw pre-normalization JSON to `tests/native/a11y-failures/` on assertion failure for diagnosis. |
| C12 | **Normalizer unit test** | `web/apps/editor/src/lib/__tests__/a11y-normalizer.test.ts` | Vitest. Given known raw UIA JSON, asserts normalized output is stable across runs and matches expected canonical form. |

**Total new code:** ~600 LoC TS (specs + helpers + normalizer + comparator + matcher) + 0-200 LoC C++ (only if Phase 0 rules out Node libs) + ~150 lines of markdown.

---

## 6. Data flow + failure semantics

### Per-spec data flow (single surface, single mode)

```
1. test.beforeEach: launchBinary({ webview2Mode, viewportTransport })
                    waitForReady()
                    bridge.loadFixture("a11y-base-state.alo")

2. test body:       surfaces.openMenu("File")              // C4 driver
                    hwnd = await bridge.getHostHwnd()
                    raw = await uia.capture(hwnd, "menubar") // C1 wrapper
                    normalized = normalize(raw, allowlist) // C2 + C3
                    expect(normalized).toMatchJSONGolden(
                      `a11y-goldens/menubar.${mode}.golden.json`
                    )

3. test.afterEach:  surfaces.dismissAll()
                    closeBinary()
```

### Regeneration flow

```
$ pnpm a11y:update              # all surfaces, both modes
$ git diff tests/native/a11y-goldens
$ git add ... && commit
```

Two-step **allowlist update** discipline: changes to
`a11y-allowlist.json` land in a separate commit from the golden
regeneration that follows. Mirrors the database-schema-migration
pattern where contract changes and data changes are reviewable
independently.

### Failure semantics

`toMatchJSONGolden` failure:
```
A11y golden mismatch: tests/native/a11y-goldens/menubar.golden.json
  At children[2].Name:
    expected: "Save"
    received: "Save File"
  Hint: if intended, run `pnpm a11y:update --grep "menubar"`
```

Cross-mode equality failure:
```
A11y cross-mode divergence: menubar
  HWND golden:        children[2].Name = "Save"
  Composition golden: children[2].Name = "Save File"
  This is the FD6-class regression gate. Investigate before forcing.
```

### Cross-spec state isolation

Each spec relaunches the binary in `test.beforeEach` rather than reusing
across surfaces. Slower (~3s per surface × ~30 surfaces × 2 modes ≈ 3
min per lane) but eliminates state-leak flake.

---

## 7. Risks named up front + mitigations

### R1 — Phase 0 spike likely returns "no maintained Node UIA lib"

The Win32 UIA ecosystem in Node is historically thin. Realistic
outcome: search returns nothing usable, we ship the C++
`uia_inspector.cpp` tool.

**Mitigation:** budget the C++ inspector build cost (~3-4h) into the
baseline plan as the *expected case*. Node-lib outcome is the upside.

### R2 — Cross-mode equality might not hold for legitimate reasons

WebView2 composition hosting could expose a wrapper visual (extra
`ICoreWebView2CompositionController` root in the UIA tree) that HWND
hosting doesn't. If so, every composition golden has one extra
root-level node and the cross-mode equality spec fails legitimately.

**Mitigation:**
- Phase 0 wrapper-visual probe answers "is the cross-mode contract
  feasible?" before any helper code is written.
- If the wrapper exists in composition mode, the normalizer's "always
  strip" step removes it before comparison.
- **Specifically rejected:** silently allowing per-mode goldens to
  diverge would defeat the purpose. If the divergence is real and
  irreducible, it gets *named* in the cross-mode spec's documented
  allow-list, not hidden.
- If the divergence is structural (not a single wrapper but a
  fundamentally different tree shape), Phase 0 fails the gate and
  we re-plan.

### R3 — Surface drivers (C4) are 2-4x harder than they look

Per-dialog state setup can eat the test-helper budget. Some surfaces
(ImportEmittersDialog with subtree selection, CurveEditor with
focused channel, RescaleEmitterDialog with target particle) need
non-trivial prior bridge state.

**Mitigation:** **hard 4h cap on C4 work**. Any surface requiring
>30 min of setup gets dropped from this dispatch's suite and listed as
an out-of-scope follow-up in the implementation plan. **Better to
ship 15 good surfaces than 20 with 5 flaky.** The implementation plan
will mark C4 as a single trackable item with a wall-clock budget;
"drop the surface" is a planned action, not a fallback.

### R4 — Surface count likely doubles once drivers are written

The "~20 surfaces" estimate counts each component once. Menubar alone
likely produces ~6 captures (closed + each of 6 menus opened); dialogs
need "freshly opened" + "first invalid input state" each. Realistic
final golden count: **30-50 files per mode × 2 modes = 60-100 goldens**.

**Mitigation:** plan-of-record budgets for 30 surfaces × 2 modes. The
per-surface update flag (`pnpm a11y:update --grep "menubar"`) keeps
regen cost bounded. If golden count exceeds 50 per mode during
build-out, stop and re-scope.

### R5 — Narrator-speech reproducibility depends on Narrator config

Narrator verbosity, voice, intonation, focus-following mode are
user-configurable. Different settings produce different announcements
of the same UIA tree.

**Mitigation:** Stage 3i checklist's Narrator section documents the
assumed config (Verbosity 1, default voice, "Read by character" off).
Operator sets these before recording. Recording archives both screen
capture and a screenshot of Narrator settings open.

### Lower-priority watch list

- **Per-rig UIA tree differences** — WebView2 SDK version or Windows
  updates could shift the tree. Manageable via the allowlist + existing
  single-dev-rig discipline.
- **Composition dist/ rebuild burden** — known existing pain. Reuse
  existing patterns; don't invent new ones.
- **Golden churn hygiene** — process risk. Addressed by CHANGELOG +
  spec noting "UI chrome changes touch goldens in the same PR."
- **Allowlist drift** — process risk. Require rationale in commit
  message for allowlist additions/removals.
- **Suite runtime** — back-of-envelope ~3-7 min per lane. Acceptable.
  Monitor during build-out; if exceeds 10 min, parallelize.

---

## 8. Testing & verification

### Happy paths (during build-out, after each component lands)

- [ ] **Phase 0 spike artifacts** committed: Node-lib search results;
      cross-mode wrapper-visual probe findings; decisions in
      `tasks/`.
- [ ] **UIA inspector**: `--help` works; `--hwnd 0x1234 --capture menubar`
      produces valid JSON; `--hwnd 0xDEAD --capture menubar` exits
      non-zero with a useful error.
- [ ] **Normalizer**: vitest at `web/apps/editor/src/lib/__tests__/a11y-normalizer.test.ts`.
      Given known raw UIA JSON, normalizer drops volatile fields, sorts
      children deterministically, output is stable across runs.
- [ ] **Each spec file** runs solo against current chrome and produces
      a passing golden after `pnpm a11y:update`.
- [ ] **Full suite** runs without flake across 3 consecutive invocations
      in each mode.
- [ ] **Cross-mode equality spec**: passes against the committed goldens.
- [ ] **`pnpm a11y:update --grep "<surface>"`** updates only the
      matched goldens, doesn't touch unrelated ones.

### Edge cases

- [ ] **Inspector against torn-down HWND** → actionable error, not
      stack trace.
- [ ] **Surface driver timeout** → spec fails with surface name in the
      error, not "expected toMatchJSONGolden, received undefined".
- [ ] **Allowlist references non-existent property** → normalizer warns,
      doesn't silently include the property.
- [ ] **One mode's golden missing** → cross-mode spec fails with explicit
      "HWND golden present, composition golden missing for surface X".
- [ ] **WebView2 hasn't finished initial paint** → driver awaits stable
      signal (existing `waitForReady`); spec timeout produces named
      failure.

### Cleanup verification

- [ ] **No stale UIA inspector processes** after the suite (Playwright's
      `test.afterEach` kills spawned children).
- [ ] **Binary process count returns to baseline** after suite completes.
- [ ] **No leftover dist/ env vars** (scoped env vars or `dotenv` patterns,
      not parent shell mutation).

### Debug instrumentation

- [ ] On any `toMatchJSONGolden` failure, dump the raw (pre-normalization)
      UIA JSON to `tests/native/a11y-failures/<surface>.<mode>.raw.json`.
      `.gitignore`'d. Lets developer diagnose normalizer-vs-tree issues.
- [ ] Inspector emits `[A11Y-CAPTURE]` log line with surface ID + HWND +
      JSON-byte-count + duration-ms. Searchable for perf regression
      tracking.

### Stage 3i manual (one-time, executed at ship)

Located in `tasks/stage-3i-a11y-manual.md`. Categories:

- **Tab cycle** — Tab through every interactive element in chrome; focus
  always visible; no Tab traps. Repeat under each modal dialog.
- **Inline rename** — F2 on tree row enters edit; Escape cancels; Enter
  commits.
- **Escape close** — closes any open menu, any open dialog; doesn't
  close the app.
- **Arrow-key tree nav** — Up/Down navigate siblings; Left collapses;
  Right expands.
- **IME compose smoke** — install Japanese IME, type in
  `ModNicknameDialog` text field, verify composition popup appears,
  accepts, commits.
- **Narrator-speech pass** — start Narrator (Win+Ctrl+Enter), verbosity
  1 + default voice, navigate every regression-suite surface, verify
  announcement matches UIA tree. Record screen+audio to
  `tasks/stage-3i-narrator-recording.mp4`.

### Verification gate for "Phase 3 a11y close-out is done"

All of:
1. Vitest still 343/343 + N new tests for the normalizer.
2. Playwright HWND lane gains the new specs; total stays green.
3. Playwright composition lane gains the new specs; total stays green.
4. Cross-mode equality spec passes.
5. MSBuild Debug + Release x64 clean (matters only if C++ inspector
   ships).
6. Stage 3i checklist all checked; recording committed.
7. ROADMAP MT-11 Phase 3 marked closed.
8. CHANGELOG entry written per CLAUDE.md formatting (date line, three
   labeled sections, reverse-chrono).
9. HANDOFF refreshed for next session.

---

## 9. Open execution items before code starts

1. **User OK to start Phase 0 spike.** (No production code yet — this
   spec is paper.) Phase 0 consists of (a) Node-lib search, (b)
   cross-mode wrapper-visual probe. ~30 min, gates the rest.
2. **Verify lt-4 lineage**: confirm session branch tip equals
   `origin/lt-4` HEAD at start; no divergent commits to reconcile.
3. **Pre-coding gate** (before any production code):
   - `pnpm --filter @particle-editor/editor lint` — 0 errors
   - `pnpm --filter @particle-editor/editor test` — 343/343 passing
   - MSBuild Debug + Release x64 clean via the .sln (per L-023)
   - Optional: Playwright HWND baseline 103+26+0 + composition lane
     122+3+0.

---

## 10. Background reading

- **[MT-11] Phase 3 archive** at [`tasks/todo-mt-11-phase-3-archive.md`](../../../tasks/todo-mt-11-phase-3-archive.md) — original Stage 3 acceptance bullets (§6 "Stage 3 (composition hosting) acceptance — rigorous a11y"); FD6/FD9 historical context.
- **HANDOFF** at [`tasks/HANDOFF.md`](../../../tasks/HANDOFF.md) — current Phase 3 closure state; "Known follow-ups" item 4 names this dispatch.
- **L-022** (handoff verification rule) at [`tasks/lessons.md`](../../../tasks/lessons.md) — applies to every claim in this spec that references existing code.
- **L-023** (MSBuild `$(SolutionDir)` invocation rule) — applies if the C++ inspector ships.
- **WebView2 composition hosting** sample code and docs (Microsoft) — referenced for understanding the wrapper-visual question in R2.
