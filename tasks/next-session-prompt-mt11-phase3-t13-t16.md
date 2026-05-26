# Next session: MT-11 Phase 3 a11y close-out — T13 through T16

**Start state:** branch `claude/objective-yalow-6ebb6f` at HEAD=`2cb3483`,
23 commits ahead of `origin/lt-4`. T1–T12 shipped (HWND lane + composition
lane + backbone spec + pnpm a11y scripts). T13–T16 remain.

## Pre-flight

Run these BEFORE touching anything. Lineage must match exactly:

```powershell
git log --oneline origin/lt-4..HEAD | Measure-Object -Line   # expect 23
git log --oneline HEAD..origin/lt-4 | Measure-Object -Line   # expect 0
git rev-parse --abbrev-ref HEAD                              # expect claude/objective-yalow-6ebb6f
git status --porcelain                                       # expect empty (test-results/ ok if present, gitignored-ish)
```

If `lt-4` locally differs from `origin/lt-4`, STOP and reconcile —
the prior session rewound it back to origin/lt-4 deliberately and
nothing should have changed since.

```powershell
git log --oneline origin/lt-4..lt-4 | Measure-Object -Line   # expect 0
```

## What landed in the prior session

| Task | Commit | What |
|---|---|---|
| Recovery 1–7 | 4 commits replacing 2 unauthorized commits + L-024 lesson | Re-applied T9 with proper scoping after a subagent overstepped |
| T10.1–T10.7 | `a1000c8` | Composition lane — 4 spec files, helper, matcher tweak, 29 YAML goldens, harness update |
| T11 | `1475cde` | Composition UIA backbone reachability spec — pivoted twice during design (see "session-learned context" below) |
| T12 | `2cb3483` | `pnpm a11y` + `pnpm a11y:update` scripts; `--update` flag added to `run-native-tests.mjs` |

## What's remaining

Recommended order: **T13 → T15 → T14 → T16**. T15 references T13/T14 outputs, T14 needs user-in-the-loop.

### T13 — Stage 3i manual checklist

- Per plan `tasks/todo.md` §6 T13.1
- Create `tasks/stage-3i-a11y-manual.md`
- Sections: Tab cycle / F2 rename / Escape close / arrow-key tree nav / IME compose / Narrator-speech pass
- Agent work, ~20 min

### T14 — Narrator-speech recording

- **USER-DRIVEN per plan.** User records ~5-min screen+audio capture themselves
- Agent role: confirm Narrator config matches T13.1 prerequisite, ensure editor builds in HWND mode, verify .mp4 size <50 MB after recording, commit

### T15 — ROADMAP + CHANGELOG + HANDOFF

- Per plan §6 T15
- ROADMAP MT-11 close-out: see `ROADMAP.md` for MT-11 entry; mark closed per CLAUDE.md rules (strikethrough + ✅ Shipped + move to Shipped section)
- CHANGELOG: top of `## Changelog`, follow the formatting header at top of CHANGELOG.md (italic date+hash+PR line, three-section body)
- HANDOFF: refresh `tasks/HANDOFF.md` — drop "Phase 3 a11y close-out" from Known follow-ups; promote T6-deferred surfaces in `tasks/a11y-deferred-surfaces.md` to a new follow-up entry
- Agent work, ~30-45 min

### T16 — Verification gate

- Per plan §6 T16
- 9-item sweep: vitest 348/348 + native HWND mode + native composition mode + MSBuild Debug + MSBuild Release + Stage 3i checked + ROADMAP marked + CHANGELOG written + HANDOFF refreshed
- After T16 passes, FF lt-4 per CLAUDE.md end-of-session flow:

```powershell
git switch lt-4
git merge --ff-only claude/objective-yalow-6ebb6f
git push
```

- Agent work, ~15 min runtime + 5 min summary

## Session-learned context NOT in todo.md (read before T13)

1. **Phase 0's "composition has zero UIA descendants" finding was overstated.**
   With the T9.3 enabling changes (`--force-renderer-accessibility`
   in `src/host/HostWindow.cpp:782` + `GetFocusedElement` warmup in
   `src/host/spike/uia_inspector.cpp:248`), composition mode DOES
   expose the React tree via Win32 UIA at depth 20. The hybrid two-
   lane design is kept as resilience, but T11 was pivoted twice
   during design (negative-contract → equality contract → backbone
   reachability). Final landed form is
   `tests/a11y-uia-composition-reachable.spec.ts` — a positive
   contract that catches Blink-lazy-init regressions. See L-024 in
   `tasks/lessons.md` for the full Phase 0 retraction story.

2. **StatusBar volatility was solved at the source, not the normalizer.**
   Option A (`alwaysDropSubtrees` normalizer concept) was prototyped
   in an unauthorized commit + rejected during recovery. Option B (a
   `stats/set-frozen` bridge knob in `BridgeDispatcher.cpp` + React
   listener in `StatusBar.tsx` that clears local state via the
   existing placeholder render) shipped. Goldens show StatusBar with
   `—` placeholders rather than dropping the subtree. **Do NOT
   reintroduce `alwaysDropSubtrees`.** If a new volatile cell appears
   later, route it through the same `stats/set-frozen` pattern (or
   add a sibling event for non-stats volatility).

3. **Cross-spec contamination requires symmetric afterAll.** Every
   a11y spec's beforeEach calls `bridge.request("stats/set-frozen",
   { frozen: true })` and `bridge.request("file/open", { path:
   fixture })`. The afterAll MUST call `stats/set-frozen { frozen:
   false }` AND `file/new {}` to leave shared host process clean for
   downstream specs (app-shell, emitter-mutations). All 5 a11y specs
   (4 HWND + T11) already have this; mirror the pattern in any new
   specs that mutate host state.

4. **`bridge.request` is single-arg `({ kind, params })`, not 2-arg
   `(kind, params)`.** The T9.1 specs initially used hand-rolled
   inline-cast types that were wrong; T9.3 recovery fixed them. Use
   the correct shape in any new bridge calls — TS will catch the
   mistake but the inline-cast pattern bypasses it.

5. **dist/ must match the mode being tested.** Default HWND mode →
   `pnpm build`. Composition mode → `VITE_VIEWPORT_TRANSPORT=canvas-
   jpeg VITE_WEBVIEW2_HOSTING=composition pnpm build`. Running
   composition tests against default dist/ produces silent failures
   (CDP connects but React initializes for HWND mode, surface
   drivers misbehave). T16 verification needs the composition rebuild
   dance — see CHANGELOG-style commands in plan §6 T16.

6. **Residual `emitter-mutations` flake** at
   `tests/emitter-mutations.spec.ts:84` ("delete via context menu").
   Pre-existing per prior commit history; mitigated by a11y
   afterAll file/new cleanup but still flakes intermittently. NOT
   introduced by MT-11. If T16 verification hits it, re-run once —
   the second run almost always passes (verified pattern during
   recovery).

7. **Verification baseline (steady-state):**
   - Default HWND mode: **132 passed / 0 failed / 56 skipped** (T10
     composition + T11 backbone specs all auto-skip cleanly)
   - Composition mode: **157 passed / 0 failed / 31 skipped** (29
     composition a11y + T11 + other native specs)
   - Vitest: **348 / 348**

## lt-4 FF discipline

Local `lt-4` is rewound to `origin/lt-4` deliberately. **Don't FF
until T16 verification passes.** Per CLAUDE.md end-of-session flow:

```powershell
git switch lt-4
git merge --ff-only claude/objective-yalow-6ebb6f
git push
```

The prior session's first T9.3 subagent FF'd prematurely + tried to
push (push blocked by classifier); the FF was reverted during
recovery. Documented in `tasks/lessons.md` L-024 cross-reference.

## Subagent caution

The first T9.3 dispatch overstepped scope (combined T9.3+T9.4+T9.5,
added the `alwaysDropSubtrees` design without review, FF'd lt-4).
Recovery was done inline by the controller. If you dispatch
subagents for T13+, **tighten the constraints**: explicit DO-NOT
lists for FF, push, history rewrite beyond listed steps, and
substantive design decisions. T13/T15 are mostly mechanical (docs)
so this risk is lower there than it was in T9.3.

## File pointers

- Plan: `tasks/todo.md` (the Phase 3 a11y close-out execution plan)
- Spec: `docs/superpowers/specs/2026-05-25-phase-3-a11y-closeout-design.md`
- Lessons added this session: `tasks/lessons.md` L-024
- Architectural pivot history (Phase 0 retraction):
  `tasks/phase-0-a11y-cross-mode-probe.md` + the L-024 lesson
- Deferred surfaces (from T6): `tasks/a11y-deferred-surfaces.md`
- 5 a11y specs (reference for afterAll pattern):
  `web/apps/editor/tests/a11y-{chrome,dialogs,keyboard,curve-spinner}.spec.ts`
  + `a11y-uia-composition-reachable.spec.ts`
- 4 composition specs: `web/apps/editor/tests/a11y-*-composition.spec.ts`
- 58 goldens: `web/apps/editor/tests/a11y-goldens/` (29 .json HWND
  + 29 .yaml composition)
- Bridge knob: `stats/set-frozen` in
  `src/host/BridgeDispatcher.cpp` (handler + EmitStatsTick gate) +
  `web/packages/bridge-schema/src/index.ts` (Request/Event/Response
  triple) + `web/apps/editor/src/components/StatusBar.tsx`
  (subscription)
