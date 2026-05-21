# B1.3 — Tab reorganization to match legacy parity (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** planning — pending user sign-off before P2 begins.
**Started:** 2026-05-20
**HEAD at planning:** `5dd9d75` (brainstorm spec) on `claude/brave-buck-1295c8`.
**Spec source:** [docs/superpowers/specs/2026-05-20-b1-3-tab-parity.md](../docs/superpowers/specs/2026-05-20-b1-3-tab-parity.md) — read first, end-to-end. **All architectural depth lives there**; this plan is a sequencing + verification artifact, not a restatement.

**Goal (one sentence):** the three property tabs render with legacy section structure, legacy field placement, a tri-state Generation radio mutex, and trailing-colon labels — using the B1.2 collapsible `Section` primitive as the section chrome, while bundling a correctness fix for the `randomLifetimePerc` / `randomScalePerc` display inversion.

**Tech stack:** React 18 + TypeScript (strict), Tailwind v4 (CSS-first), Radix primitives, Vitest, Playwright. No bridge schema or C++ changes.

**Predecessor on `lt-4`:** [`4edcc3a`](https://github.com/DrKnickers/new-particle-editor/commit/4edcc3a) (B1.2 + B1.2.1 + handoff docs).

---

## 1. Goal + scope

### Goal

Bring the three property tabs back into per-section parity with the legacy Win32 editor (`IDD_EMITTER_PROPS1/2/3` in `src/ParticleEditor.en.rc`) without changing the underlying schema or bridge surface. Bundle the percent-display-inversion correctness fix discovered during prep.

The user-visible outcome: opening the editor, selecting an emitter, and seeing Basic / Appearance / Physics with the same section structure, field placement, and label conventions as the legacy editor — readable side-by-side with a legacy screenshot.

### In scope (B1.3)

1. **Tri-state Generation radio mutex** on the Basic tab — three radios (Bursts / Continuous stream / Weather particle) deriving from `(useBursts, isWeatherParticle)`; atomic two-field bridge patches on click; all branches' sub-fields always rendered, `disabled` on inactive branches.
2. **Basic tab restructure** — three Sections (Emitter Timing / Generation / Connection); Generation includes the Weather sub-block + Maximum/Minimum lifetime; Connection includes Emit mode + Emit offset (moved from Physics); drop rotation fields (4) + parent link strength + random scale + Index from Basic.
3. **Appearance tab restructure** — five Sections (Textures / Random color addition / Tail / Rotation / Rendering); rotation fields move in (from Basic); `nTriangles` + Affected by Wind drop; `Random color addition` body uses checkbox plus 4-spinner cluster; `World Oriented` renamed `Always face camera` with semantic flip.
4. **Physics tab restructure** — four Sections (Initial position / Initial speed / Acceleration / Ground interaction); `groups[2]` and `groups[0]` wrap inside their respective Sections (replacing the existing `<fieldset><legend>` chrome); `groups[1]` drops entirely; Initial speed consolidates Inward speed + Parent speed inherit (moved from Basic) + Affected by wind (moved from Appearance); Weather + Emit fields move out.
5. **`displayInvertedPercent` prop on `FieldSpinner`** — handles the `100 - value*100` display transform and `(100 - displayed) / 100` commit transform. Applied to `randomLifetimePerc` ("Minimum lifetime:") and `randomScalePerc` ("Minimum scale:").
6. **Trailing colons on field labels** — match legacy convention. Section titles stay colon-less per `.rc:448-450`.
7. **Test corpus updates** — label renames (~25–35 specs), tab-membership relocations (~5–10 specs), new specs (~7 covering tri-state mutex + invertedPercent).
8. **Docs** — `CHANGELOG.md` entry, `tasks/HANDOFF.md` refresh, `ROADMAP.md` shift (vacate [TIER-K] tag for parity-reorg).

### Out

- **Bridge schema changes.** None — all fields are already on the wire.
- **C++ work.** None — every dropped field stays on the binary serializer.
- **Section collapsed-state persistence** (B1.2-inherited issue — `Section` defaults to open on every mount). Out-of-scope follow-up; not in this dispatch.
- **B1.4 resizable splitters.** Deferred behind this dispatch.
- **Re-introducing GROUPBOX bordered outline.** B1.2 just shipped collapsible chevron `Section`; adding borders would regress.
- **An "Atlas" section for `index`.** User explicitly rejected; drop entirely.

### Out-of-scope rationale

Dropped fields (`nTriangles`, `weatherFadeoutDistance`, `groups[1]`, `index`) remain on the wire and round-trip through `.alo` save/load. Loading an existing file with non-default values preserves them even though there's no edit affordance. This is fine — the file format is the contract, not the UI.

---

## 2. What the codebase already gives us

### React inspector surface

- **`EmitterPropertyTabs.tsx`** at [`web/apps/editor/src/screens/EmitterPropertyTabs.tsx`](../web/apps/editor/src/screens/EmitterPropertyTabs.tsx) — 1186 lines housing `BasicTab` (line 292), `AppearanceTab` (line 673), `PhysicsTab` (line 855), plus the field-row primitives `FieldText` (line 474), `FieldSpinner` (line 532), `FieldCheckbox` (line 574), `FieldSelect` (line 606), `GroupSection` (line 1024), and `Vec3Row` (line 1145).
- **`Section`** primitive at [`web/apps/editor/src/components/Section.tsx`](../web/apps/editor/src/components/Section.tsx) — collapsible chevron header with keyboard support, `data-testid="section-${title.toLowerCase().replace(/\s+/g, "-")}"`. Shipped in B1.2.
- **`Spinner`** primitive at [`web/apps/editor/src/primitives/Spinner.tsx`](../web/apps/editor/src/primitives/Spinner.tsx) — native-wheel-listener, drag-to-adjust, sci-notation parse, clamp on commit. Underpins `FieldSpinner`.
- **`commit` helper** at [`EmitterPropertyTabs.tsx:196-214`](../web/apps/editor/src/screens/EmitterPropertyTabs.tsx) — fires the bridge `set-properties` request with an optimistic local update. Accepts `Partial<EmitterPropertiesDto>` so multi-key atomic patches just work.

### CSS surface

- **`components.css`** at [`web/apps/editor/src/styles/components.css`](../web/apps/editor/src/styles/components.css) — `.section`, `.section-header`, `.section-body`, `.section-divider`, `.form-row`, `.form-row.name-row`, `.inspector`. Plus `.tb-btn`, `.panel` chrome, etc.
- **`tokens.css`** at [`web/apps/editor/src/styles/tokens.css`](../web/apps/editor/src/styles/tokens.css) — design tokens. We'll add `.radio-row` here for the tri-state radio layout (or fold into `components.css` if that's the existing convention — check during P3).

### Bridge / schema (read-only — no changes)

- **`EmitterPropertiesDto`** at [`web/packages/bridge-schema/src/index.ts:326-380`](../web/packages/bridge-schema/src/index.ts) — type carries every field B1.3 touches.
- **`BridgeDispatcher::DispatchRequest` get-properties branch** at [`src/host/BridgeDispatcher.cpp:1965-2050`](../src/host/BridgeDispatcher.cpp:1965) — serializes the DTO; every B1.3 field already on the wire.
- **`BridgeDispatcher::DispatchRequest` set-properties branch** at [`src/host/BridgeDispatcher.cpp:2095-2180`](../src/host/BridgeDispatcher.cpp:2095) — accepts the same DTO; multi-key atomic patches are already supported (each `if (patch.contains(...))` branch fires independently within one request).

### Legacy resource source-of-truth

- **`IDD_EMITTER_PROPS1`** (Basic): [`src/ParticleEditor.en.rc:426-477`](../src/ParticleEditor.en.rc).
- **`IDD_EMITTER_PROPS2`** (Appearance): [`src/ParticleEditor.en.rc:376-424`](../src/ParticleEditor.en.rc).
- **`IDD_EMITTER_PROPS3`** (Physics): [`src/ParticleEditor.en.rc:338-374`](../src/ParticleEditor.en.rc).
- **Legacy WM_COMMAND handler** at [`src/UI/Emitter.cpp:480-560`](../src/UI/Emitter.cpp) — maps each spinner ID to a schema field; resolved Q2/Q3 during prep.
- **Legacy SPINNER7 ↔ SPINNER15 cross-sync** at [`src/UI/Emitter.cpp:484-485`](../src/UI/Emitter.cpp) — both bind to `nParticlesPerSecond`; mirrors edits.

### Test corpus

- **Vitest specs** under [`web/apps/editor/src/`](../web/apps/editor/src) — relevant suites enumerated in P7 below. Current count **254/254** per HANDOFF.
- **Playwright native specs** under [`web/apps/editor/tests/`](../web/apps/editor/tests) — **83/83**; not expected to need B1.3 edits (asserting at structural / selection level, not per-field).

---

## 3. Architecture / implementation approach

The full spec at `docs/superpowers/specs/2026-05-20-b1-3-tab-parity.md` covers:

- §5.1 Tri-state Generation mutex derivation + atomic two-key patch shape
- §5.2 `displayInvertedPercent` prop math + adopting fields
- §5.3 `groups[]` Section integration with `GroupBody` rename
- §5.4 Field placement migration table (12 moves)
- §5.5 Label-rename table (30 entries)
- §5.6 Test-rewrite strategy (`getByLabelText` substitution as the shared shortcut)

Implementation order is deliberately bottom-up:

1. **P2 first** — the `displayInvertedPercent` prop lands standalone (no usage yet); proves the math and round-trip with focused specs *before* it has to interact with a restructured tab.
2. **P3 next** — the tri-state Generation mutex is the highest-risk single change (custom radio chrome, two-key atomic patch); land it on the *current* Basic tab structure so the diff is isolated from the larger move.
3. **P4–P6** — restructure tabs one at a time. Basic first because P2's `displayInvertedPercent` adopts on Basic (Minimum lifetime) and the restructure depends on P3's tri-state already being in place. Appearance and Physics follow with similar shape.
4. **P7** — spec corpus reconciliation as a single pass. Doing it per-tab would create N intermediate red-spec states; doing it once after all three tabs are restructured keeps the vitest gate green at each P-checkpoint *except* P7's intermediate WIP.
5. **P8** — docs at the very end so the dates / hashes / counts are accurate.

### Files touched

| File | Action | Why |
|---|---|---|
| `web/apps/editor/src/screens/EmitterPropertyTabs.tsx` | Modify | All three tabs restructured; `FieldSpinner` gains `displayInvertedPercent`; `BasicTab` gains tri-state radio. |
| `web/apps/editor/src/styles/components.css` | Modify | Add `.radio-row` chrome for tri-state radios + any layout fixes the new structure needs. |
| `web/apps/editor/src/screens/EmitterPropertyTabs.test.tsx` (and `.basic`, `.appearance`, `.physics` variants if they exist) | Modify | Label renames, tab-membership relocations, new specs. |
| `web/apps/editor/src/screens/EmitterPropertyTabs.invertedPercent.test.tsx` *(new)* | Create | Focused unit specs for `displayInvertedPercent` math. |
| `web/apps/editor/src/screens/EmitterPropertyTabs.generation.test.tsx` *(new)* | Create | Focused specs for the tri-state Generation mutex. |
| `CHANGELOG.md` | Modify | B1.3 entry. |
| `tasks/HANDOFF.md` | Modify | Next-session pointer to B1.4. |
| `ROADMAP.md` | Modify | Vacate [TIER-K] tag; move shipped entry. |
| `tasks/todo.md` (this file) | Modify | Append Review section after work. |

### New APIs

```ts
// FieldSpinner gains:
type FieldSpinnerProps = {
  label: string;
  value: number;
  // ... existing props ...
  /** When true, displays `100 - value*100` (rounded to integer) and
   *  commits `(100 - displayed) / 100`. Forces internal min=0, max=100,
   *  step=1, decimals=0, unit='%'. Used for `randomLifetimePerc` and
   *  `randomScalePerc` per legacy IDC_SPINNER13/14 inverted convention
   *  (Emitter.cpp:487, 492). */
  displayInvertedPercent?: boolean;
};

// BasicTab gains:
type GenerationMode = "bursts" | "continuous" | "weather";
function deriveMode(useBursts: boolean, isWeather: boolean): GenerationMode;
function setMode(next: GenerationMode, onCommit: CommitFn): void;
```

### Data flow

Tri-state mode change:
```
user clicks "Bursts" radio
  → setMode("bursts", onCommit)
  → onCommit({ useBursts: true, isWeatherParticle: false })
  → setProperties(p => ({ ...p, useBursts: true, isWeatherParticle: false }))  // optimistic
  → bridge.request({ kind: "emitters/set-properties", params: { id, patch: { useBursts, isWeatherParticle } } })
  → C++ dispatcher patches both fields atomically (one frame)
  → emitter/tree/changed fires → fetchProps re-confirms
```

`displayInvertedPercent` value flow:
```
engine: randomLifetimePerc = 0.25 (float in [0,1])
  → FieldSpinner reads value=0.25, displayInvertedPercent=true
  → displayed = Math.round(100 - 0.25*100) = 75
  → Spinner renders 75 with "%" unit
user changes to 30:
  → onCommit((100 - 30) / 100) = 0.7
  → setProperties(p => ({ ...p, randomLifetimePerc: 0.7 }))
  → bridge set-properties patch = { randomLifetimePerc: 0.7 }
```

---

## 4. Risks named up front + mitigations

1. **Two-key atomic patch reaches dispatcher as two sequential writes.** The `commit()` helper at `EmitterPropertyTabs.tsx:196-214` sends one bridge request per `commit()` call. As long as both keys are in the same object, the dispatcher's `if (patch.contains("useBursts"))` and `if (patch.contains("isWeatherParticle"))` branches fire on the same patch — one frame of engine state change.
   - **Mitigation**: P3 includes a new spec that mounts `BasicTab`, clicks a Generation radio, and asserts the mock bridge received exactly one `set-properties` call with both keys (not two sequential calls).

2. **`BLEND_BUMP` cascade interacts wrong with "Always face camera" semantic flip.** The existing logic at `EmitterPropertyTabs.tsx:689` sets `forceFace = blendMode === BLEND_BUMP` and displays `World Oriented` as unchecked when forced. With the inversion to "Always face camera", the cascade flips: when `forceFace` is true, display the checkbox as **checked + disabled** (camera *is* forced to face).
   - **Mitigation**: P5 explicitly rewrites the Rendering section's checkbox with inverted logic; new spec covers two cases — `blendMode = ADDITIVE` (responsive) and `blendMode = BLEND_BUMP` (forced-checked + disabled).

3. **Weather mode "Particles" spinner aria-label collision.** Both the Continuous-mode and Weather-mode spinners bind to `properties.nParticlesPerSecond`. Both rendered simultaneously (always-rendered-disabled). If both have the same aria-label, `getByLabelText` returns ambiguous.
   - **Mitigation**: P3 uses distinct aria-labels — `"Particles/second:"` for Continuous, `"Particles:"` for Weather. Same schema field, different label. Specs scope queries with `within(continuousBranch)` or `within(weatherBranch)`.

4. **`groups[1]` data preservation across drop.** Schema still carries `properties.groups[1]` on read; we just don't render it. If a user opens an `.alo` with non-default `groups[1]` values, they must pass through untouched on save.
   - **Mitigation**: P6 adds a spec that mounts `PhysicsTab` with a fixture having `groups[1] = { type: GT_BOX, min: ... }`, triggers a no-op commit, asserts the round-tripped DTO still has `groups[1]` intact. Verified via the mock bridge's snapshot store.

5. **Spec corpus pass leaves the suite intermittently red between P3 and P7.** Restructuring tabs without simultaneously updating specs means specs querying for "Random Rotation" on Basic will fail mid-stack.
   - **Mitigation**: keep `pnpm test` green at every P-checkpoint *except* during P7 itself. P3 and P5 specs adopt new structure as part of their commit. P4/P5/P6 each ship with same-task spec edits for *just* the renamed fields in that tab. P7 is purely the spec-corpus reconciliation for moves not yet reconciled (i.e. label renames that span multiple tabs, the new tri-state and invertedPercent specs). If P4–P6 each handle their own renames cleanly, P7 reduces to "add the new specs + sweep any stragglers."

6. **Inverted-percent precision drift.** `Math.round` on display + float division on commit can introduce ±1% rounding error after many round-trips. Legacy has the same property.
   - **Mitigation**: not designing around. Document in JSDoc on the prop. Boundary specs in P2 (0, 50, 100) demonstrate parity with legacy.

7. **`pnpm install` may re-inject the `allowBuilds` block per L-005.** If pnpm-workspace.yaml is touched by the install, build fails.
   - **Mitigation**: P1 includes a verify step after `pnpm install` — check `pnpm-workspace.yaml` for the literal placeholder string per L-005's pattern. Fix in place if found.

8. **CSS layout drift from new section structure** — e.g. Generation section's height growing tall because all three radio branches render simultaneously could push content below the viewport at small panel sizes.
   - **Mitigation**: P3 verifies visually with the dev server before committing. If too tall, accept it (legacy has the same behaviour; B1.4 splitters will let the user resize). Document if encountered.

9. **Working tree not at `lt-4` tip.** This worktree is `claude/brave-buck-1295c8`; lineage clean per pre-flight. If the desktop app provisions a fresh worktree mid-dispatch, the spec + plan need to be re-read.
   - **Mitigation**: HANDOFF refresh in P8 documents the session branch + the FF-to-`lt-4` instruction. Each P-step is single-commit so a mid-dispatch handoff resumes cleanly from the last commit.

---

## 5. Testing & verification

### Per-task gates (run before every commit)

- `pnpm build` — TypeScript clean.
- `pnpm test` — vitest green.

Native specs (`pnpm test:native`) are run **only** at P1 (baseline) and P8 (final). They're slow and don't exercise per-field labels — running them between every P-step is wasted compute.

### Final verification (end of P8)

#### Happy paths
- [ ] Open the editor; select an emitter; observe Basic tab structure: Name row, three Sections (Emitter Timing, Generation, Connection); Generation contains tri-state radios with sub-fields.
- [ ] Click each Generation radio in turn; verify atomic patch (two-key for Bursts/Continuous, one-key for Weather); inactive branches' sub-fields show as `disabled`.
- [ ] Switch to Appearance; verify five Sections (Textures, Random color addition, Tail, Rotation, Rendering); no `nTriangles` / `Affected by Wind` rows.
- [ ] Switch to Physics; verify four Sections (Initial position, Initial speed, Acceleration, Ground interaction); no Emit fields, no weather fields, no third group section.
- [ ] Toggle `Affected by wind` on Physics → Initial speed; value round-trips engine ↔ form.
- [ ] Toggle `Always face camera`; semantic flip lands at schema (`isWorldOriented` stores negation of checkbox state).
- [ ] Edit `Minimum lifetime:` to 75; engine receives `randomLifetimePerc = 0.25`.
- [ ] Edit `Minimum scale:` to 75; engine receives `randomScalePerc = 0.25`.
- [ ] Set blend mode to Bump map; `Always face camera` becomes checked + disabled.

#### Edge cases
- [ ] Open an `.alo` with `groups[1]` non-default; PhysicsTab renders nothing for it; value preserved on save round-trip.
- [ ] Open an `.alo` with `nTriangles = 5`; Appearance has no Triangles row; value preserved.
- [ ] Open an `.alo` with `index = 7`; Basic has no Index row; value preserved.
- [ ] Click Weather radio while in Bursts mode; `isWeatherParticle = true`, `useBursts` remains `true`; switching back to Bursts re-enables burst sub-fields.
- [ ] Select two emitters; switch tabs + emitters; new emitter's tab structure identical; tri-state reflects the *new* emitter's mode.

#### Refused inputs / boundaries
- [ ] `Minimum lifetime:` = 0 commits `randomLifetimePerc = 1.0`. `= 100` commits `randomLifetimePerc = 0.0`.
- [ ] Clamp: `-5` → `0`; `150` → `100`.

#### Cleanup / regression
- [ ] No console errors during any check above.
- [ ] Legacy `--legacy-ui` mode unaffected: open in legacy, verify property dialogs unchanged.
- [ ] Vitest gate: **expected ~265–275 / 265–275** (final figure recorded in P8 docs).
- [ ] Playwright native: **83 / 83** (no spec count change expected).
- [ ] MSBuild Debug x64 clean (verified at P1; no C++ change since).
- [ ] `pnpm build` clean.
- [ ] Working tree clean after P8.

### Debug instrumentation

None planned. The dispatch is pure CSS/JSX/test reshuffle; no new event flow needing trace.

---

## 6. Implementation steps

Eight tasks, each with bite-sized steps. Mark `- [x]` as you go. Each task ends with `pnpm build` + `pnpm test` green before committing.

---

### Task P1 — Pre-flight + lineage check

**Files:** none modified.

- [ ] **Step 1: Lineage check.**

Run:
```bash
git log --oneline lt-4..HEAD   # this session's commits ahead of lt-4
git log --oneline HEAD..lt-4   # 0 expected (session has all lt-4 work)
git status --short
```

Expected: HEAD-ahead-of-lt-4 list shows `5dd9d75` (spec commit). HEAD-behind-of-lt-4 is empty. `git status` clean.

- [ ] **Step 2: NuGet restore** (only if the worktree is fresh — check `packages/` exists at repo root before deciding).

Run:
```bash
ls packages/ 2>/dev/null | head -3
```

If empty/absent:
```bash
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" "ParticleEditor.sln" //t:Restore //v:m
```

- [ ] **Step 3: pnpm install + L-005 check.**

Run:
```bash
cd web/apps/editor
pnpm install
```

Then verify `pnpm-workspace.yaml` doesn't have the L-005 placeholder string. Read `web/pnpm-workspace.yaml`; the `allowBuilds` block should have explicit `true`/`false` per package, never a literal placeholder.

- [ ] **Step 4: Baseline gates.**

Run from `web/apps/editor`:
```bash
pnpm build
pnpm test
pnpm test:native
```

Expected:
- `pnpm build`: 0 errors.
- `pnpm test`: **254 / 254**.
- `pnpm test:native`: **83 / 83**.

If anything is red, **STOP** — don't proceed to P2 on a broken baseline. Diagnose first.

- [ ] **Step 5: MSBuild Debug x64 check** (optional sanity; no C++ change expected).

Run:
```bash
"/c/Program Files/Microsoft Visual Studio/18/Community/MSBuild/Current/Bin/MSBuild.exe" "ParticleEditor.sln" //p:Configuration=Debug //p:Platform=x64 //v:m 2>&1 | tail -5
```

Expected: `Build succeeded.` with the preexisting `LIBCMTD` warning only.

- [ ] **Step 6: Mark P1 complete in this file** (`- [x]` the checkboxes above). No commit — P1 is verification only.

---

### Task P2 — `displayInvertedPercent` prop on `FieldSpinner` + unit specs

**Files:**
- Modify: `web/apps/editor/src/screens/EmitterPropertyTabs.tsx` (the `FieldSpinner` function around line 532).
- Create: `web/apps/editor/src/screens/EmitterPropertyTabs.invertedPercent.test.tsx`.

- [ ] **Step 1: Write failing specs first.**

Create `web/apps/editor/src/screens/EmitterPropertyTabs.invertedPercent.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Import FieldSpinner — it's not exported today; we'll export it as
// part of this task. If the import fails, the test fails red as
// expected for a TDD step.
import { FieldSpinner } from "./EmitterPropertyTabs";

describe("FieldSpinner displayInvertedPercent", () => {
  it("displays 100 - value*100 rounded to integer", () => {
    const onCommit = vi.fn();
    render(
      <FieldSpinner
        label="Minimum lifetime"
        value={0.25}
        displayInvertedPercent
        unit="%"
        onCommit={onCommit}
      />,
    );
    const input = screen.getByLabelText("Minimum lifetime") as HTMLInputElement;
    expect(input.value).toBe("75");
  });

  it("commits (100 - displayed) / 100 on change", () => {
    const onCommit = vi.fn();
    render(
      <FieldSpinner
        label="Minimum scale"
        value={0.5}
        displayInvertedPercent
        unit="%"
        onCommit={onCommit}
      />,
    );
    const input = screen.getByLabelText("Minimum scale") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(0.7);
  });

  it("round-trips boundary values 0 / 100", () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <FieldSpinner
        label="Field"
        value={0}
        displayInvertedPercent
        unit="%"
        onCommit={onCommit}
      />,
    );
    expect((screen.getByLabelText("Field") as HTMLInputElement).value).toBe("100");
    rerender(
      <FieldSpinner
        label="Field"
        value={1}
        displayInvertedPercent
        unit="%"
        onCommit={onCommit}
      />,
    );
    expect((screen.getByLabelText("Field") as HTMLInputElement).value).toBe("0");
  });
});
```

- [ ] **Step 2: Verify the spec file fails.**

Run from `web/apps/editor`:
```bash
pnpm test -- EmitterPropertyTabs.invertedPercent
```

Expected: FAIL with "FieldSpinner is not exported" or similar.

- [ ] **Step 3: Export `FieldSpinner` from `EmitterPropertyTabs.tsx`.**

Change `function FieldSpinner({...}) {` at line ~532 to `export function FieldSpinner({...}) {`.

- [ ] **Step 4: Add `displayInvertedPercent` prop to `FieldSpinner` props type.**

Edit the props type block (around line 542-552). Add the field:

```tsx
function FieldSpinner({
  label,
  value,
  min,
  max,
  step,
  decimals,
  unit,
  disabled,
  displayInvertedPercent,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  unit?: string;
  disabled?: boolean;
  /** When true, displays `100 - value*100` (rounded to integer) and
   *  commits `(100 - displayed) / 100`. Forces min=0, max=100. Used for
   *  `randomLifetimePerc` and `randomScalePerc` per legacy IDC_SPINNER13/14
   *  inverted convention (see Emitter.cpp:487, 492). */
  displayInvertedPercent?: boolean;
  onCommit: (value: number) => void;
}) {
```

- [ ] **Step 5: Implement the inversion math in the function body.**

Replace the existing `FieldSpinner` body:

```tsx
  const displayValue = displayInvertedPercent
    ? Math.round(100 - value * 100)
    : value;
  const handleCommit = (next: number) => {
    if (displayInvertedPercent) {
      onCommit((100 - next) / 100);
    } else {
      onCommit(next);
    }
  };
  const effectiveMin = displayInvertedPercent ? 0 : min;
  const effectiveMax = displayInvertedPercent ? 100 : max;
  const effectiveStep = displayInvertedPercent ? 1 : step;
  const effectiveDecimals = displayInvertedPercent ? 0 : decimals;
  return (
    <div className="form-row">
      <span className="lbl">{label}</span>
      <Spinner
        value={displayValue}
        onChange={handleCommit}
        min={effectiveMin}
        max={effectiveMax}
        step={effectiveStep}
        decimals={effectiveDecimals}
        disabled={disabled}
        aria-label={label}
      />
      <span className="unit">{unit ?? ""}</span>
    </div>
  );
```

- [ ] **Step 6: Run the specs.**

Run:
```bash
pnpm test -- EmitterPropertyTabs.invertedPercent
```

Expected: 3 / 3 passing.

- [ ] **Step 7: Full suite + build.**

```bash
pnpm build
pnpm test
```

Expected: TypeScript clean. Vitest **257 / 257** (254 baseline + 3 new).

- [ ] **Step 8: Commit.**

```bash
git add web/apps/editor/src/screens/EmitterPropertyTabs.tsx web/apps/editor/src/screens/EmitterPropertyTabs.invertedPercent.test.tsx
git commit -m "$(cat <<'EOF'
feat(LT-4): displayInvertedPercent prop on FieldSpinner

Bundles the correctness fix for the percent-display inversion the
new UI is missing. Engine stores randomLifetimePerc / randomScalePerc
as floats in [0,1]; legacy displays them as 100 - perc*100 (see
Emitter.cpp:487, 492). New prop on FieldSpinner adopts that math.

Standalone change — no adopting usages yet. P4 + P5 wire it up.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task P3 — Tri-state Generation radio mutex on `BasicTab`

**Files:**
- Modify: `web/apps/editor/src/screens/EmitterPropertyTabs.tsx` (`BasicTab` body around lines 292-465, especially the Generation section at 363-447).
- Modify: `web/apps/editor/src/styles/components.css` (add `.radio-row` chrome).
- Create: `web/apps/editor/src/screens/EmitterPropertyTabs.generation.test.tsx`.

- [ ] **Step 1: Write failing specs first.**

Create `web/apps/editor/src/screens/EmitterPropertyTabs.generation.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BasicTab } from "./EmitterPropertyTabs";
import { makeMockEmitter } from "../bridge/mock-state"; // adjust if helper path differs; otherwise inline a fixture

describe("BasicTab — tri-state Generation mutex", () => {
  let onCommit: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    onCommit = vi.fn();
  });

  const renderWithMode = (useBursts: boolean, isWeather: boolean) => {
    const properties = {
      ...makeMockEmitter(),
      useBursts,
      isWeatherParticle: isWeather,
    };
    render(<BasicTab properties={properties} onCommit={onCommit} />);
  };

  it("renders three radios for bursts / continuous / weather", () => {
    renderWithMode(false, false);
    expect(screen.getByRole("radio", { name: /Bursts/i })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Continuous/i })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Weather/i })).toBeTruthy();
  });

  it("active radio reflects (useBursts=true, isWeather=false) → bursts", () => {
    renderWithMode(true, false);
    expect(screen.getByRole("radio", { name: /Bursts/i }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: /Continuous/i }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("radio", { name: /Weather/i }).getAttribute("aria-checked")).toBe("false");
  });

  it("active radio reflects (useBursts=*, isWeather=true) → weather", () => {
    renderWithMode(true, true);
    expect(screen.getByRole("radio", { name: /Weather/i }).getAttribute("aria-checked")).toBe("true");
  });

  it("clicking Bursts commits both keys atomically", () => {
    renderWithMode(false, false);
    fireEvent.click(screen.getByRole("radio", { name: /Bursts/i }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ useBursts: true, isWeatherParticle: false });
  });

  it("clicking Continuous commits both keys atomically", () => {
    renderWithMode(true, false);
    fireEvent.click(screen.getByRole("radio", { name: /Continuous/i }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ useBursts: false, isWeatherParticle: false });
  });

  it("clicking Weather sets only isWeatherParticle (preserves useBursts)", () => {
    renderWithMode(true, false);
    fireEvent.click(screen.getByRole("radio", { name: /Weather/i }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ isWeatherParticle: true });
  });

  it("burst sub-fields disabled when mode != bursts", () => {
    renderWithMode(false, false);
    expect((screen.getByLabelText(/Bursts:/i) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(/Particles\/burst:/i) as HTMLInputElement).disabled).toBe(true);
  });

  it("weather sub-fields disabled when mode != weather", () => {
    renderWithMode(false, false);
    expect((screen.getByLabelText(/Cube size:/i) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(/Distance from camera:/i) as HTMLInputElement).disabled).toBe(true);
  });
});
```

Note: `makeMockEmitter` helper may not exist. Inline the fixture if so (use the shape from `EmitterPropertiesDto`). The plan does NOT pre-promise that helper.

- [ ] **Step 2: Verify the specs fail.**

```bash
pnpm test -- EmitterPropertyTabs.generation
```

Expected: FAIL (`BasicTab` is not exported; the new labels/structure don't exist).

- [ ] **Step 3: Export `BasicTab` from `EmitterPropertyTabs.tsx`.**

Change `function BasicTab(...)` at line ~292 to `export function BasicTab(...)`.

- [ ] **Step 4: Implement the tri-state derivation + setMode helper.**

At the top of `BasicTab` body (replace lines ~298-304):

```tsx
function BasicTab({
  properties,
  onCommit,
}: {
  properties: EmitterPropertiesDto;
  onCommit: (patch: Partial<EmitterPropertiesDto>) => void;
}) {
  type GenerationMode = "bursts" | "continuous" | "weather";
  const mode: GenerationMode = properties.isWeatherParticle
    ? "weather"
    : properties.useBursts
      ? "bursts"
      : "continuous";

  const setMode = (next: GenerationMode) => {
    switch (next) {
      case "bursts":     onCommit({ useBursts: true, isWeatherParticle: false }); break;
      case "continuous": onCommit({ useBursts: false, isWeatherParticle: false }); break;
      case "weather":    onCommit({ isWeatherParticle: true }); break;
    }
  };

  const burstsEnabled = mode === "bursts";
  const continuousEnabled = mode === "continuous";
  const weatherEnabled = mode === "weather";
  const rotationEnabled = properties.randomRotation;
  // ... existing body continues
```

- [ ] **Step 5: Add `.radio-row` CSS chrome.**

Edit `web/apps/editor/src/styles/components.css`. Add (near `.form-row` block):

```css
.radio-row {
  display: grid;
  grid-template-columns: 16px 1fr;
  align-items: center;
  gap: 6px;
  padding: 4px 0 4px 4px;
  cursor: pointer;
  user-select: none;
}
.radio-row[aria-checked="true"] .radio-dot {
  background: var(--accent);
}
.radio-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid var(--border-2);
  background: transparent;
}
.radio-row:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

- [ ] **Step 6: Replace the Generation Section body with tri-state radios.**

Replace the existing `<Section title="Generation">` block (lines ~363-447) with the structure described in the spec §3.1 point 1 + §5.1. The full replacement is large; key shape:

```tsx
<Section title="Generation">
  <div
    role="radio"
    aria-checked={burstsEnabled}
    tabIndex={0}
    className="radio-row"
    onClick={() => setMode("bursts")}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setMode("bursts"); } }}
  >
    <span className="radio-dot" />
    <span>Bursts</span>
  </div>
  <FieldSpinner
    label="Bursts:"
    value={properties.nBursts}
    min={1} step={1} decimals={0}
    disabled={!burstsEnabled}
    onCommit={(v) => onCommit({ nBursts: Math.round(v) })}
  />
  <FieldSpinner
    label="Burst delay:"
    value={properties.burstDelay}
    min={0} step={0.1} unit="s"
    disabled={!burstsEnabled}
    onCommit={(v) => onCommit({ burstDelay: v })}
  />
  <FieldSpinner
    label="Particles/burst:"
    value={properties.nParticlesPerBurst}
    min={1} step={1} decimals={0}
    disabled={!burstsEnabled}
    onCommit={(v) => onCommit({ nParticlesPerBurst: Math.round(v) })}
  />

  <div
    role="radio"
    aria-checked={continuousEnabled}
    tabIndex={0}
    className="radio-row"
    onClick={() => setMode("continuous")}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setMode("continuous"); } }}
  >
    <span className="radio-dot" />
    <span>Continuous stream</span>
  </div>
  <FieldSpinner
    label="Particles/second:"
    value={properties.nParticlesPerSecond}
    min={0} step={1} decimals={0}
    disabled={!continuousEnabled}
    onCommit={(v) => onCommit({ nParticlesPerSecond: Math.round(v) })}
  />

  <div
    role="radio"
    aria-checked={weatherEnabled}
    tabIndex={0}
    className="radio-row"
    onClick={() => setMode("weather")}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setMode("weather"); } }}
  >
    <span className="radio-dot" />
    <span>Weather particle</span>
  </div>
  <FieldSpinner
    label="Particles:"
    value={properties.nParticlesPerSecond}
    min={0} step={1} decimals={0}
    disabled={!weatherEnabled}
    onCommit={(v) => onCommit({ nParticlesPerSecond: Math.round(v) })}
  />
  <FieldSpinner
    label="Distance from camera:"
    value={properties.weatherCubeDistance}
    min={0} step={0.1} unit="units"
    disabled={!weatherEnabled}
    onCommit={(v) => onCommit({ weatherCubeDistance: v })}
  />
  <FieldSpinner
    label="Cube size:"
    value={properties.weatherCubeSize}
    min={0} step={0.1} unit="units"
    disabled={!weatherEnabled}
    onCommit={(v) => onCommit({ weatherCubeSize: v })}
  />

  <FieldSpinner
    label="Maximum lifetime:"
    value={properties.lifetime}
    min={0} step={0.1} unit="s"
    onCommit={(v) => onCommit({ lifetime: v })}
  />
  <FieldSpinner
    label="Minimum lifetime:"
    value={properties.randomLifetimePerc}
    displayInvertedPercent
    unit="%"
    onCommit={(v) => onCommit({ randomLifetimePerc: v })}
  />
</Section>
```

Note: this commit *also* removes the old standalone `randomScalePerc` / rotation / Index fields from Generation. Those move out in P4 (or this same task — P3 covers the Generation tri-state plus the lifetime fields moving in; everything else in Basic stays as-is for now, deferred to P4).

- [ ] **Step 7: Verify specs.**

```bash
pnpm test -- EmitterPropertyTabs.generation
```

Expected: all 8 specs passing.

- [ ] **Step 8: Verify the existing test suite still green.** (The Emitter Timing section's lifetime / random-lifetime fields just moved into Generation; existing specs querying for them will need updating later in P7, BUT if any spec queries `within(emitterTiming)` for them, that's a P3 breakage to fix here, not defer.)

```bash
pnpm build
pnpm test
```

Expected: TypeScript clean. Vitest likely fails ~5-10 specs that assert "Random Lifetime" lives under "Emitter Timing" or test the old "Use Bursts" checkbox. **Fix those specs in this commit** — they're load-bearing for tri-state correctness and shouldn't defer to P7.

Per-spec edits to do here (search the test files):
- `getByLabelText("Use Bursts")` → no replacement; the radio replaces it. Update specs to `getByRole("radio", { name: /Bursts/ })`.
- `within(emitterTiming)` queries for `Random Lifetime` or `Lifetime` → switch to `within(generation)` (use the section testid: `data-testid="section-generation"`).
- Asserts on `onCommit({ useBursts: true })` after clicking the checkbox → switch to assert on the two-key patch after clicking the radio.

After fixes:
```bash
pnpm test
```

Expected: vitest green (count likely 254 - dropped specs + new generation specs = ~258-262). Specific count varies; what matters is **0 failing**.

- [ ] **Step 9: Commit.**

```bash
git add web/apps/editor/src/screens/EmitterPropertyTabs.tsx web/apps/editor/src/screens/EmitterPropertyTabs.generation.test.tsx web/apps/editor/src/styles/components.css web/apps/editor/src/screens/EmitterPropertyTabs.test.tsx
# (add any other spec files modified in Step 8)
git commit -m "$(cat <<'EOF'
feat(LT-4): tri-state Generation radio mutex on BasicTab

Replace the Use Bursts checkbox with a three-radio mutex (Bursts /
Continuous stream / Weather particle) deriving from (useBursts,
isWeatherParticle). Each radio click fires one atomic two-key patch
through the bridge so the engine sees a consistent state pair.

Also folds Maximum lifetime + Minimum lifetime into the Generation
section to match legacy IDD_EMITTER_PROPS1 (.rc:449,461,466), and
hosts the Weather sub-fields (Particles, Distance from camera, Cube
size) under the Weather radio branch — moves Weather away from the
Physics tab where it lived in the new UI.

`Minimum lifetime:` adopts the displayInvertedPercent prop from P2.

Existing specs updated to query by radio role + Generation section
testid. New spec file covers the radio mutex + sub-field disable
cascade + atomic-patch shape (8 specs).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task P4 — Basic tab restructure (label renames + moves)

**Files:**
- Modify: `web/apps/editor/src/screens/EmitterPropertyTabs.tsx` (`BasicTab` body).
- Modify: vitest specs touching Basic-tab fields (enumerated below).

Spec source: spec §3.1 point 2 + §5.4 migration table + §5.5 label-rename table.

- [ ] **Step 1: Apply label renames in `BasicTab` per spec §5.5.**

In the `Section title="Emitter Timing"` block (lines ~319-361 in the post-P3 file), rename:
- `label="Initial Delay"` → `label="Initial spawn delay:"`
- `label="Skip Time"` → `label="Skip time:"`
- `label="Freeze Time"` → `label="Freeze time:"`

Also: **remove** the `Random Lifetime` `FieldSpinner` from Emitter Timing (already moved into Generation in P3) AND **remove** the `Lifetime` `FieldSpinner` (also moved into Generation as "Maximum lifetime:").

After this, Emitter Timing contains just three rows: Initial spawn delay, Skip time, Freeze time.

- [ ] **Step 2: Apply label renames in the Generation section per spec §5.5.**

In the Generation block (added in P3), the labels are already correct (`Bursts:`, `Burst delay:`, `Particles/burst:`, `Particles/second:`, `Particles:`, `Distance from camera:`, `Cube size:`, `Maximum lifetime:`, `Minimum lifetime:`). No edits needed unless P3 left any stragglers.

- [ ] **Step 3: Restructure Connection section.**

Replace the current Connection block (`Link to System` + `Parent Link Strength`):

```tsx
<Section title="Connection">
  <FieldCheckbox
    label="Link particles to instance"
    checked={properties.linkToSystem}
    onCheckedChange={(v) => onCommit({ linkToSystem: v })}
  />
  <FieldSelect
    label="Emit mode:"
    value={properties.emitFromMesh}
    options={EMIT_FROM_MESH_OPTIONS}
    onCommit={(v) => onCommit({ emitFromMesh: v })}
    testId="basic-emit-from-mesh-trigger"
  />
  <FieldSpinner
    label="Emit offset:"
    value={properties.emitFromMeshOffset}
    step={0.1}
    unit="units"
    disabled={properties.emitFromMesh === EMIT_FROM_MESH_DISABLE}
    onCommit={(v) => onCommit({ emitFromMeshOffset: v })}
  />
</Section>
```

Note: `Parent Link Strength` is removed from here (moves to Physics in P6). `Link to System` renames to `Link particles to instance`.

- [ ] **Step 4: Remove dropped fields from Basic.**

These are still rendered after P3 because they sat under the old structure. Remove from `BasicTab` body entirely:
- `Random Scale` FieldSpinner
- `Random Rotation` FieldCheckbox + `Random Rotation Direction` FieldCheckbox + `Rotation Average` + `Rotation Variance` FieldSpinners (4-row block; moves to Appearance in P5)
- `Index` FieldSpinner (dropped entirely per Q1)

- [ ] **Step 5: Update existing specs for renamed labels.**

Search:
```bash
grep -n 'Initial Delay\|Skip Time\|Freeze Time\|Link to System\|Parent Link Strength\|Random Scale\|Random Rotation\|Rotation Average\|Rotation Variance\|"Index"' web/apps/editor/src/screens/*.test.tsx
```

For each hit, update per spec §5.5. Examples:
- `getByLabelText("Initial Delay")` → `getByLabelText("Initial spawn delay:")`
- `getByLabelText("Skip Time")` → `getByLabelText("Skip time:")`
- `getByLabelText("Link to System")` → `getByLabelText("Link particles to instance")`

For specs asserting on removed-from-Basic fields (rotation, parent link, random scale, index): comment them out with `// MOVED-IN-P5/P6: ...` markers OR delete (P7 will reconcile). Pragmatically: delete the entire spec if it's a Basic-only spec; if it's a tab-membership spec, mark `it.todo` with the new tab name.

- [ ] **Step 6: Verify.**

```bash
pnpm build
pnpm test
```

Expected: TypeScript clean. Vitest green. Count may drop by ~5-10 specs (those asserting on moved fields are now `.todo`, awaiting P5/P6).

- [ ] **Step 7: Commit.**

```bash
git add web/apps/editor/src/screens/EmitterPropertyTabs.tsx web/apps/editor/src/screens/*.test.tsx
git commit -m "$(cat <<'EOF'
feat(LT-4): Basic tab restructure to match legacy IDD_EMITTER_PROPS1

Three sections: Emitter Timing (initial spawn delay / skip time /
freeze time) / Generation (tri-state mutex + lifetimes + weather
branch — landed in P3) / Connection (link particles to instance +
emit mode + emit offset).

Field moves:
  - Emit mode + Emit offset moved IN from Physics (.rc:475-476).
  - Random Rotation, Random Rotation Direction, Rotation Average,
    Rotation Variance moved OUT to Appearance > Rotation (P5).
  - Random Scale moved OUT to Appearance > Textures > Minimum scale
    (P5).
  - Parent Link Strength moved OUT to Physics > Initial speed (P6).
  - Index dropped from inspector (Q1 decision; schema retained).

Label renames per legacy (trailing colons, lowercase per .rc text):
  - Initial Delay → Initial spawn delay:
  - Skip Time → Skip time:
  - Freeze Time → Freeze time:
  - Link to System → Link particles to instance
  - Emit From Mesh → Emit mode: ; ...Offset → Emit offset:

Specs reconciled for renames; specs asserting on moved fields marked
.todo pending P5/P6 (full reconcile in P7).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task P5 — Appearance tab restructure (5 Sections + rotation in + drops)

**Files:**
- Modify: `web/apps/editor/src/screens/EmitterPropertyTabs.tsx` (`AppearanceTab` body lines ~673-832).
- Modify: vitest specs touching Appearance-tab fields.

Spec source: spec §3.1 point 3 + §5.4 + §5.5.

- [ ] **Step 1: Replace `AppearanceTab` body with 5-Section structure.**

The new structure:

```tsx
export function AppearanceTab({
  properties,
  onCommit,
}: {
  properties: EmitterPropertiesDto;
  onCommit: (patch: Partial<EmitterPropertiesDto>) => void;
}) {
  const forceFace = properties.blendMode === BLEND_BUMP;
  const tailEnabled = properties.hasTail;
  const rotationEnabled = properties.randomRotation;

  const updateRandomColors = (idx: 0 | 1 | 2 | 3, displayed: number) => {
    const next: [number, number, number, number] = [
      properties.randomColors[0],
      properties.randomColors[1],
      properties.randomColors[2],
      properties.randomColors[3],
    ];
    next[idx] = displayed / 100;
    onCommit({ randomColors: next as unknown as Vec4 });
  };

  return (
    <div className="inspector">
      <Section title="Textures">
        {/* TODO(MT-1): palette popup */}
        <FieldText
          label="Color texture:"
          value={properties.colorTexture}
          onCommit={(v) => onCommit({ colorTexture: v })}
        />
        <FieldText
          label="Bump texture:"
          value={properties.normalTexture}
          onCommit={(v) => onCommit({ normalTexture: v })}
        />
        <FieldSpinner
          label="Texture elements:"
          value={properties.textureSize}
          min={1} step={1} decimals={0}
          onCommit={(v) => onCommit({ textureSize: Math.max(1, Math.round(v)) })}
        />
        <FieldSpinner
          label="Minimum scale:"
          value={properties.randomScalePerc}
          displayInvertedPercent
          unit="%"
          onCommit={(v) => onCommit({ randomScalePerc: v })}
        />
      </Section>

      <Section title="Random color addition">
        <div className="form-row items-start">
          <span className="lbl pt-1">RGBA:</span>
          <div className="grid grid-cols-2 gap-1" style={{ gridColumn: "2 / span 2" }}>
            <Spinner value={properties.randomColors[0] * 100} min={0} max={100} step={1} unit="%"
              onChange={(v) => updateRandomColors(0, v)} aria-label="Red" />
            <Spinner value={properties.randomColors[1] * 100} min={0} max={100} step={1} unit="%"
              onChange={(v) => updateRandomColors(1, v)} aria-label="Green" />
            <Spinner value={properties.randomColors[2] * 100} min={0} max={100} step={1} unit="%"
              onChange={(v) => updateRandomColors(2, v)} aria-label="Blue" />
            <Spinner value={properties.randomColors[3] * 100} min={0} max={100} step={1} unit="%"
              onChange={(v) => updateRandomColors(3, v)} aria-label="Alpha" />
          </div>
        </div>
        <FieldCheckbox
          label="Grayscale"
          checked={properties.doColorAddGrayscale}
          onCheckedChange={(v) => onCommit({ doColorAddGrayscale: v })}
        />
      </Section>

      <Section title="Tail">
        <FieldCheckbox
          label="Has tail"
          checked={properties.hasTail}
          onCheckedChange={(v) => onCommit({ hasTail: v })}
        />
        <FieldSpinner
          label="Tail length:"
          value={properties.tailSize}
          min={0} step={0.1} unit="x"
          disabled={!tailEnabled}
          onCommit={(v) => onCommit({ tailSize: v })}
        />
      </Section>

      <Section title="Rotation">
        <FieldCheckbox
          label="Random rotation direction"
          checked={properties.randomRotationDirection}
          onCheckedChange={(v) => onCommit({ randomRotationDirection: v })}
        />
        <FieldCheckbox
          label="Fixed random rotation:"
          checked={properties.randomRotation}
          onCheckedChange={(v) => onCommit({ randomRotation: v })}
        />
        <FieldSpinner
          label="Rotation average:"
          value={properties.randomRotationAverage}
          step={0.1} unit="°"
          disabled={!rotationEnabled}
          onCommit={(v) => onCommit({ randomRotationAverage: v })}
        />
        <FieldSpinner
          label="Rotation variance:"
          value={properties.randomRotationVariance}
          step={0.1} unit="± °"
          disabled={!rotationEnabled}
          onCommit={(v) => onCommit({ randomRotationVariance: v })}
        />
      </Section>

      <Section title="Rendering">
        <FieldCheckbox
          label="Always face camera"
          checked={forceFace ? true : !properties.isWorldOriented}
          disabled={forceFace}
          onCheckedChange={(v) => onCommit({ isWorldOriented: !v })}
        />
        <FieldCheckbox
          label="Heat particle"
          checked={properties.isHeatParticle}
          onCheckedChange={(v) => onCommit({ isHeatParticle: v })}
        />
        <FieldCheckbox
          label="No depth test"
          checked={properties.noDepthTest}
          onCheckedChange={(v) => onCommit({ noDepthTest: v })}
        />
        <FieldSelect
          label="Blend mode:"
          value={properties.blendMode}
          options={BLEND_MODE_OPTIONS}
          onCommit={(v) => onCommit({ blendMode: v })}
          testId="appearance-blend-mode-trigger"
        />
      </Section>
    </div>
  );
}
```

Removed from Appearance:
- `Triangles` (`nTriangles`) — dropped per Q2.
- `Affected by Wind` — moves to Physics in P6.

Added to Appearance:
- Rotation Section (4 fields moved from Basic in P4).
- `Minimum scale:` field (replaces Random Scale; adopts `displayInvertedPercent`).

Renames:
- `Color Texture` → `Color texture:`
- `Normal Texture` → `Bump texture:`
- `Texture Size` → `Texture elements:`
- `Add Grayscale` → `Grayscale`
- `Tail Size` → `Tail length:` (unit `x`)
- `World Oriented` → `Always face camera` (with semantic flip — verified at line `checked={forceFace ? true : !properties.isWorldOriented}` and `onCheckedChange={(v) => onCommit({ isWorldOriented: !v })}`).
- `Heat Particle` → `Heat particle`
- `No Depth Test` → `No depth test`
- `Blend Mode` → `Blend mode:`
- `Has Tail` → `Has tail`
- `Random Rotation` → `Fixed random rotation:`

- [ ] **Step 2: Add a new spec for the semantic flip cascade.**

In `web/apps/editor/src/screens/EmitterPropertyTabs.appearance.test.tsx` (or wherever Appearance specs live; create if needed):

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppearanceTab } from "./EmitterPropertyTabs";

const mkProps = (overrides: Partial<any> = {}) => ({
  // ... base fixture matching EmitterPropertiesDto shape
  ...overrides,
});

describe("AppearanceTab — Always face camera semantic flip", () => {
  it("displays unchecked when isWorldOriented=true", () => {
    render(<AppearanceTab properties={mkProps({ blendMode: 1, isWorldOriented: true }) as any} onCommit={vi.fn()} />);
    expect((screen.getByLabelText("Always face camera") as HTMLInputElement).checked).toBe(false);
  });
  it("displays checked when isWorldOriented=false", () => {
    render(<AppearanceTab properties={mkProps({ blendMode: 1, isWorldOriented: false }) as any} onCommit={vi.fn()} />);
    expect((screen.getByLabelText("Always face camera") as HTMLInputElement).checked).toBe(true);
  });
  it("forced checked + disabled when blendMode = BLEND_BUMP", () => {
    render(<AppearanceTab properties={mkProps({ blendMode: 11, isWorldOriented: false }) as any} onCommit={vi.fn()} />);
    const cb = screen.getByLabelText("Always face camera") as HTMLInputElement;
    expect(cb.checked).toBe(true);
    expect(cb.disabled).toBe(true);
  });
  it("clicking the checkbox commits the negation of isWorldOriented", () => {
    const onCommit = vi.fn();
    render(<AppearanceTab properties={mkProps({ blendMode: 1, isWorldOriented: true }) as any} onCommit={onCommit} />);
    fireEvent.click(screen.getByLabelText("Always face camera"));
    expect(onCommit).toHaveBeenCalledWith({ isWorldOriented: false });
  });
});
```

- [ ] **Step 3: Update existing Appearance specs for renamed labels.**

Apply the same search-and-replace pattern as P4 Step 5. For specs asserting on `nTriangles` or `Affected by Wind` in Appearance, mark `it.todo` (the field is moving or dropping).

- [ ] **Step 4: Verify.**

```bash
pnpm build
pnpm test
```

Expected: TypeScript clean. Vitest green.

- [ ] **Step 5: Commit.**

```bash
git add web/apps/editor/src/screens/EmitterPropertyTabs.tsx web/apps/editor/src/screens/*.test.tsx
git commit -m "$(cat <<'EOF'
feat(LT-4): Appearance tab restructure to match legacy IDD_EMITTER_PROPS2

Five sections: Textures / Random color addition / Tail / Rotation /
Rendering — matching legacy .rc:381-385 GROUPBOX order.

Field moves:
  - Rotation fields (Random rotation direction, Fixed random rotation,
    Rotation average, Rotation variance) moved IN from Basic.
  - Affected by Wind moved OUT to Physics > Initial speed (P6).
  - nTriangles dropped from inspector (Q2 decision; schema retained).

Field changes:
  - Random Scale field replaced with Minimum scale: (adopts
    displayInvertedPercent from P2; semantic same as legacy
    IDC_SPINNER13 inversion).
  - World Oriented renamed Always face camera with semantic flip —
    checked = !isWorldOriented. BLEND_BUMP cascade preserved
    (forces checked + disabled).
  - New specs cover the semantic flip cascade (4 specs).

Label renames per legacy (trailing colons, lowercase per .rc text).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task P6 — Physics tab restructure (groups[] in Sections + consolidations)

**Files:**
- Modify: `web/apps/editor/src/screens/EmitterPropertyTabs.tsx` (`PhysicsTab` body lines ~855-1187, including `GroupSection` → `GroupBody` rename).
- Modify: vitest specs touching Physics-tab fields.

Spec source: spec §3.1 point 4 + §5.3 groups[] integration + §5.4 + §5.5.

- [ ] **Step 1: Rename `GroupSection` → `GroupBody`** and drop its `<fieldset><legend>` chrome (the parent Section carries the title now).

Replace the existing `GroupSection` function (lines ~1024-1143) with:

```tsx
function GroupBody({
  index,
  group,
  onChange,
}: {
  index: number;
  group: GroupDto;
  onChange: (patch: Partial<GroupDto>) => void;
}) {
  const updateVec3 = (
    key: "min" | "max" | "val",
    axis: 0 | 1 | 2,
    v: number,
  ) => {
    const cur = group[key];
    const next: [number, number, number] = [cur[0], cur[1], cur[2]];
    next[axis] = v;
    onChange({ [key]: next as unknown as Vec3 } as Partial<GroupDto>);
  };

  return (
    <div data-testid={`physics-group-${index}`} className="space-y-2">
      <FieldSelect
        label="Type:"
        value={group.type}
        options={GROUP_TYPE_OPTIONS}
        onCommit={(v) => onChange({ type: v })}
        testId={`physics-group-${index}-type-trigger`}
      />
      {group.type === GT_EXACT && (
        <Vec3Row
          label="Value:"
          value={group.val}
          step={0.1}
          ariaPrefix={`Group ${index + 1} Value`}
          onChange={(axis, v) => updateVec3("val", axis, v)}
        />
      )}
      {group.type === GT_BOX && (
        <>
          <Vec3Row label="Min:" value={group.min} step={0.1}
            ariaPrefix={`Group ${index + 1} Min`}
            onChange={(axis, v) => updateVec3("min", axis, v)} />
          <Vec3Row label="Max:" value={group.max} step={0.1}
            ariaPrefix={`Group ${index + 1} Max`}
            onChange={(axis, v) => updateVec3("max", axis, v)} />
        </>
      )}
      {group.type === GT_CUBE && (
        <FieldSpinner
          label="Side length:"
          value={group.sideLength}
          min={0} step={0.1}
          onCommit={(v) => onChange({ sideLength: v })}
        />
      )}
      {group.type === GT_SPHERE && (
        <>
          <FieldSpinner label="Sphere radius:" value={group.sphereRadius} min={0} step={0.1}
            onCommit={(v) => onChange({ sphereRadius: v })} />
          <FieldSpinner label="Sphere edge:" value={group.sphereEdge} min={0} step={1} decimals={0}
            onCommit={(v) => onChange({ sphereEdge: Math.max(0, Math.round(v)) })} />
        </>
      )}
      {group.type === GT_CYLINDER && (
        <>
          <FieldSpinner label="Cylinder radius:" value={group.cylinderRadius} min={0} step={0.1}
            onCommit={(v) => onChange({ cylinderRadius: v })} />
          <FieldSpinner label="Cylinder edge:" value={group.cylinderEdge} min={0} step={1} decimals={0}
            onCommit={(v) => onChange({ cylinderEdge: Math.max(0, Math.round(v)) })} />
          <FieldSpinner label="Cylinder height:" value={group.cylinderHeight} min={0} step={0.1}
            onCommit={(v) => onChange({ cylinderHeight: v })} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Replace `PhysicsTab` body with 4-Section structure.**

```tsx
export function PhysicsTab({
  properties,
  onCommit,
}: {
  properties: EmitterPropertiesDto;
  onCommit: (patch: Partial<EmitterPropertiesDto>) => void;
}) {
  const isWeather = properties.isWeatherParticle;
  const nonWeather = !isWeather;
  const bouncinessEnabled = nonWeather && properties.groundBehavior === GROUND_BEHAVIOR_BOUNCE;

  const updateAcceleration = (idx: 0 | 1 | 2, v: number) => {
    const next: [number, number, number] = [
      properties.acceleration[0],
      properties.acceleration[1],
      properties.acceleration[2],
    ];
    next[idx] = v;
    onCommit({ acceleration: next as unknown as Vec3 });
  };

  const updateGroup = (idx: number, patch: Partial<GroupDto>) => {
    const next = properties.groups.map((g, i) => (i === idx ? { ...g, ...patch } : g));
    onCommit({ groups: next });
  };

  return (
    <div className="inspector">
      <Section title="Initial position">
        <GroupBody index={2} group={properties.groups[2]} onChange={(p) => updateGroup(2, p)} />
      </Section>

      <Section title="Initial speed">
        <GroupBody index={0} group={properties.groups[0]} onChange={(p) => updateGroup(0, p)} />
        <FieldSpinner
          label="Inward speed:"
          value={properties.inwardSpeed}
          step={0.1} unit="units/s"
          disabled={!nonWeather}
          onCommit={(v) => onCommit({ inwardSpeed: v })}
        />
        <FieldSpinner
          label="Parent speed inherit:"
          value={properties.parentLinkStrength}
          min={0} max={100} step={1} decimals={0} unit="%"
          onCommit={(v) => onCommit({ parentLinkStrength: v })}
        />
        <FieldCheckbox
          label="Affected by wind"
          checked={properties.affectedByWind}
          disabled={!nonWeather}
          onCheckedChange={(v) => onCommit({ affectedByWind: v })}
        />
      </Section>

      <Section title="Acceleration">
        <div className="form-row items-start">
          <span className="lbl pt-1">X / Y / Z:</span>
          <div className="grid grid-cols-3 gap-1" style={{ gridColumn: "2 / span 2" }}>
            <Spinner value={properties.acceleration[0]} step={0.1} disabled={!nonWeather}
              onChange={(v) => updateAcceleration(0, v)} aria-label="Acceleration X" />
            <Spinner value={properties.acceleration[1]} step={0.1} disabled={!nonWeather}
              onChange={(v) => updateAcceleration(1, v)} aria-label="Acceleration Y" />
            <Spinner value={properties.acceleration[2]} step={0.1} disabled={!nonWeather}
              onChange={(v) => updateAcceleration(2, v)} aria-label="Acceleration Z" />
          </div>
        </div>
        <FieldSpinner
          label="Gravity acceleration:"
          value={properties.gravity}
          step={0.1} unit="units/s²"
          disabled={!nonWeather}
          onCommit={(v) => onCommit({ gravity: v })}
        />
        <FieldSpinner
          label="Inward acceleration:"
          value={properties.inwardAcceleration}
          step={0.1} unit="units/s²"
          disabled={!nonWeather}
          onCommit={(v) => onCommit({ inwardAcceleration: v })}
        />
        <FieldCheckbox
          label="Object space acceleration"
          checked={properties.objectSpaceAcceleration}
          disabled={!nonWeather}
          onCheckedChange={(v) => onCommit({ objectSpaceAcceleration: v })}
        />
      </Section>

      <Section title="Ground interaction">
        <FieldSelect
          label="Behavior:"
          value={properties.groundBehavior}
          options={GROUND_BEHAVIOR_OPTIONS}
          disabled={!nonWeather}
          onCommit={(v) => onCommit({ groundBehavior: v })}
          testId="physics-ground-behavior-trigger"
        />
        <FieldSpinner
          label="Bounciness:"
          value={properties.bounciness}
          min={0} max={1} step={0.05}
          disabled={!bouncinessEnabled}
          onCommit={(v) => onCommit({ bounciness: v })}
        />
      </Section>
    </div>
  );
}
```

Removed from Physics:
- `Emit From Mesh` + offset (moved to Basic in P4).
- `Weather Particle` + cube size + cube distance + fadeout distance (moved to Basic Generation in P3; fadeout dropped per Q3).
- `groups[1]` (Lifetime) — dropped per Q4.

Added to Physics:
- `Parent speed inherit:` (from Basic).
- `Affected by wind` (from Appearance).

Renames: per spec §5.5.

- [ ] **Step 3: Add `groups[1]` preservation spec.**

In a Physics test file, add:

```tsx
it("groups[1] data passes through untouched on round trip", async () => {
  // Mount with non-default groups[1], trigger a no-op commit on another field,
  // assert mock bridge state still has groups[1].type === GT_BOX etc.
  // Use bridge/mock-state's setEmitterProperties as the round-trip oracle.
});
```

(Inline the actual fixture + assertion at write time.)

- [ ] **Step 4: Update Physics specs.**

Search:
```bash
grep -n 'Inward Speed\|Gravity\|Object Space Acceleration\|Ground Behavior\|Weather Cube\|Emit From Mesh\|"Bounciness"' web/apps/editor/src/screens/*.test.tsx
```

Update each per spec §5.5. Specs asserting on dropped fields (`weatherFadeoutDistance`, `groups[1]` content) — mark `.todo` or convert to round-trip-preservation specs.

- [ ] **Step 5: Verify.**

```bash
pnpm build
pnpm test
```

Expected: TypeScript clean. Vitest green.

- [ ] **Step 6: Commit.**

```bash
git add web/apps/editor/src/screens/EmitterPropertyTabs.tsx web/apps/editor/src/screens/*.test.tsx
git commit -m "$(cat <<'EOF'
feat(LT-4): Physics tab restructure to match legacy IDD_EMITTER_PROPS3

Four sections: Initial position (groups[2]) / Initial speed
(groups[0] + inward speed + parent speed inherit + affected by
wind) / Acceleration (X/Y/Z + gravity + inward + object space) /
Ground interaction (behavior + bounciness).

Field moves:
  - Parent speed inherit (was Parent Link Strength) moved IN from
    Basic, now lives under Initial speed.
  - Affected by wind moved IN from Appearance, now under Initial
    speed (matches legacy IDD_EMITTER_PROPS3 placement,
    .rc:350).
  - Emit From Mesh + Offset moved OUT to Basic > Connection (P4).
  - Weather Particle + cube size + distance moved OUT to Basic >
    Generation Weather radio branch (P3).
  - Weather Fadeout Distance dropped (Q3; schema retained).
  - groups[1] (Lifetime random-param) dropped (Q4; schema retained).

Field shape:
  - groups[0] and groups[2] wrap in Section primitives; the prior
    fieldset/legend chrome is removed (GroupSection renamed
    GroupBody — no more border outline; Section header carries the
    title).
  - Acceleration row uses "X / Y / Z:" combined label per legacy
    visual layout.

Label renames per legacy. New round-trip spec covers groups[1]
data preservation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task P7 — Spec corpus reconciliation

**Files:**
- Modify: all vitest spec files under `web/apps/editor/src/screens/*.test.tsx` and `web/apps/editor/src/**/*.test.tsx`.

By P7, most P4/P5/P6 commits have reconciled their tab-local specs. P7 is the final sweep — catch stragglers, replace `.todo` markers with real specs at the new locations, and add any cross-tab specs.

- [ ] **Step 1: Enumerate `.todo` specs introduced in P4/P5/P6.**

```bash
grep -rn 'it\.todo\|describe\.todo' web/apps/editor/src/screens/
```

For each `.todo`, either:
- Restore the spec at the new tab location with updated `within(...)` scoping, OR
- Delete the spec if it's now covered by an equivalent in P3/P5/P6's new spec files.

- [ ] **Step 2: Final label-rename sweep.**

Search for stragglers:
```bash
grep -rn '"Initial Delay"\|"Skip Time"\|"Freeze Time"\|"Lifetime"\|"Random Lifetime"\|"Use Bursts"\|"Random Scale"\|"Random Rotation"\|"Index"\|"Color Texture"\|"Normal Texture"\|"Texture Size"\|"Add Grayscale"\|"Has Tail"\|"Tail Size"\|"World Oriented"\|"Heat Particle"\|"No Depth Test"\|"Blend Mode"\|"Affected by Wind"\|"Inward Speed"\|"Gravity"\|"Inward Acceleration"\|"Object Space Acceleration"\|"Ground Behavior"\|"Bounciness"\|"Emit From Mesh"\|"Weather Cube' web/apps/editor/src/
```

For each hit not in `EmitterPropertyTabs.tsx` itself (those are correct), update per spec §5.5.

- [ ] **Step 3: Run the full vitest suite.**

```bash
pnpm test
```

Expected: green. Record the final count.

- [ ] **Step 4: Run Playwright native.**

```bash
pnpm test:native
```

Expected: **83 / 83** still.

- [ ] **Step 5: Commit.**

```bash
git add web/apps/editor/src/
git commit -m "$(cat <<'EOF'
test(LT-4): spec corpus reconciliation for B1.3 tab parity

Final sweep: replace .todo markers from P4/P5/P6 with real specs at
the moved tab locations; catch lingering label references missed in
per-tab reconciliation.

Final vitest count: <N> / <N> (was 254 baseline; +<delta> from new
tri-state + invertedPercent + semantic-flip + groups[1]-preservation
specs).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task P8 — Docs

**Files:**
- Modify: `CHANGELOG.md` (B1.3 entry, three-section format per CLAUDE.md).
- Modify: `tasks/HANDOFF.md` (next-session pointer to B1.4).
- Modify: `ROADMAP.md` (strikethrough + ✅ Shipped for parity-reorg item; vacate [TIER-K] tag).

- [ ] **Step 1: Read the previous CHANGELOG entry** for tone/formatting:

```bash
head -100 CHANGELOG.md
```

- [ ] **Step 2: Write the B1.3 CHANGELOG entry.**

Pattern: `### Title` + italic date line + three labeled paragraphs (what ships / how we tackled it / issues encountered). Place at top of the changelog section, above the B1.2 entry. Use `TODO-DATE` / `TODO-HASH` / `TODO-PR` placeholders if pre-merge; they'll be backfilled per the partial-backfill pattern (cf. `e99e7b5`, `a9b79af`).

Three sections:
1. **What ships** — user-facing description: three property tabs now match legacy section structure; Generation is a tri-state mutex; Weather lives on Basic now; rotation lives on Appearance; affected-by-wind lives on Physics; trailing-colon label convention.
2. **How we tackled it** — files touched (`EmitterPropertyTabs.tsx`, `components.css`, three new spec files); architectural choice worth remembering (the `displayInvertedPercent` prop bundling the correctness fix into the structural reorg).
3. **Issues encountered and resolutions** — pre-existing percent-display bug discovered during prep; SPINNER7/SPINNER15 cross-sync collapsed to one schema field two labels; `Always face camera` semantic flip subtlety.

- [ ] **Step 3: Refresh `tasks/HANDOFF.md`.**

Update the header date + last-conversation context. Update Resumable state table (HEAD hash, ahead-of-lt-4 commit list). Open items section: strike through B1.3 (✅ shipped this session), move B1.4 to the top of "Next dispatch", note B2 follow-up. New patterns from this session that future Claude needs (e.g. "inverted-percent prop pattern is reusable for any field with legacy display inversion").

- [ ] **Step 4: Update `ROADMAP.md` per CLAUDE.md branch-workflow rules.**

Find the parity-reorg item under the appropriate tier (likely Near-term). Per CLAUDE.md:
1. Strike through title + append `✅ Shipped (#NN)` (placeholder PR if not merged yet).
2. Add `*Actual:* <commits, time>` line.
3. Move entry to top of `### 5.1 Shipped` (newest first).
4. Renumber the source tier to close the gap.
5. Vacate the `[TIER-K]` tag.

Also: ensure B1.4 is the next [TIER-K] entry; if it doesn't have a tag yet, assign `max+1` within Near-term tier.

- [ ] **Step 5: Verify all three docs.**

```bash
git diff CHANGELOG.md tasks/HANDOFF.md ROADMAP.md | head -200
```

- [ ] **Step 6: Final full-suite gate.**

```bash
pnpm build
pnpm test
pnpm test:native
```

Expected: clean / green / **83 / 83**.

- [ ] **Step 7: Commit.**

```bash
git add CHANGELOG.md tasks/HANDOFF.md ROADMAP.md tasks/todo.md
git commit -m "$(cat <<'EOF'
docs(LT-4): CHANGELOG + HANDOFF + ROADMAP for B1.3 tab parity

B1.3 ships: three property tabs match legacy section structure;
tri-state Generation mutex; trailing-colon labels; bundled
displayInvertedPercent correctness fix.

ROADMAP: vacate the [TIER-K] tag for parity-reorg; move to Shipped.
HANDOFF: next dispatch is B1.4 (resizable splitters); B2 follow-up
is now obsolete (Appearance + Physics are already wired — B1.3 just
restructured them).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Hand off to user for `lt-4` FF + push.**

Per CLAUDE.md: pushing to `origin/lt-4` needs explicit user OK each time. **Do not push yet.** Summarize what's ready and ask the user to OK the FF.

---

## Review (append after work)

*(Filled in at the end of the dispatch per CLAUDE.md plan structure. Leave blank during execution.)*
