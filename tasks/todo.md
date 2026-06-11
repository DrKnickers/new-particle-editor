# NT-12 — Styled/animated tooltips + modal/banner motion family (session 36)

_2026-06-10. Spec: [`docs/superpowers/specs/2026-06-10-nt12-tooltips-motion-design.md`](../docs/superpowers/specs/2026-06-10-nt12-tooltips-motion-design.md)
(user-approved; the four core decisions validated visually in the brainstorm
companion). Task-level plan:
[`docs/superpowers/plans/2026-06-10-nt12-tooltips-motion.md`](../docs/superpowers/plans/2026-06-10-nt12-tooltips-motion.md).
Branch: `claude/tender-satoshi-5ff472` off master tip `b1a945c`. Status:
**AWAITING EXECUTION-MODE CONFIRMATION.**_

---

## 1. Goal + scope

Replace every native `title` hover hint app-wide with one shared
styled+animated tooltip primitive (`Tip`, on `@radix-ui/react-tooltip`),
give the NT-11 ⚠ chain-warning glyph a rich "what this means" tooltip
(amber band + aligned per-generation breakdown), give the Modal and
OverloadBanner real entrance/exit animations, and ship a theme-consistent
`--shadow-soft` token worn by tooltips and the banner. One motion family:
fade + directional slip (tooltips 4 px / banner 6 px / modal 8 px; fast
tier 130/110 ms, slow tier 180/150 ms).

**In:** motion+shadow tokens; the `Tip` primitive with opt-in viewport
occlusion; app-level `Tooltip.Provider` (400 ms delay / 300 ms skip);
`ChainWarningTip`; full sweep of all production DOM `title=` sites
(~42 verified, grep gate authoritative); Modal retrofit (dead `animate-in`
classes → real keyframes); `usePresence` shim + soft shadow for the
banner; ROADMAP/CHANGELOG.

**Out:** retrofitting the slip onto existing popovers/menus (works later
for free — separate change if asked); touch/long-press tooltips (desktop
host); tooltip copy rewrites beyond the chain-warning lead line (separate
editorial pass); any animation library (extends the hand-rolled
`popover-animate` vocabulary — Tailwind v4 here has NO tailwindcss-animate).

## 2. What the codebase already gives us

- **The motion vocabulary**: `popover-pop-in/out` keyframes keyed to Radix
  `data-state`, reduced-motion guarded (`components.css:104-131`) — the
  pattern NT-12 extends. The Modal's `animate-in` classes are verified
  no-ops (comment at `components.css:106`).
- **Occlusion**: `useViewportOcclusion(bridge, id, ref, pad, feather,
  observeParent)` (`lib/viewport-occlusion.ts:31`) + the `OccludingPopover`
  wrapper shape (`components/OccludingPopover.tsx`) + the banner's stub-
  bridge test pattern (`__tests__/OverloadBanner.test.tsx:15-28`).
- **Chain data**: `ChainWarning.path` + `formatChainWarning`
  (`lib/chain-load.ts:80-94`) — the rich tooltip consumes the same data;
  formatters get exported, not duplicated.
- **Tokens**: `tokens.css` `:root` / `[data-theme="light"]` /
  `@theme inline` structure; existing `--shadow` (dark-only — the new
  `--shadow-soft` adds the light override).
- **Radix**: seven `@radix-ui/*` deps already pinned `^x`; jsdom test
  setup already stubs ResizeObserver (`src/test-setup.ts`).
- **A11y goldens**: allowlist-driven (`tests/helpers/a11y-allowlist.json`)
  — `Name` is captured, `HelpText` (where `title` lands) is volatile and
  NEVER serialized → the sweep should produce **zero golden churn** if
  aria-labels are preserved. Regen: `pnpm a11y:update`.

## 3. Architecture

`Tip` (primitives/Tip.tsx): asChild trigger, portaled `Tooltip.Content`
classed `tip-surface tip-animate`; nullish/empty content → bare child
(conditional sites); string content → padded `.tip-body`, JSX content →
rich tier (own padding; surface `overflow:hidden` clips the band);
`occlusionId` opt-in mounts an `OccludingTipBody` (hooks live in the
child so they only run while open — the OccludingPopover shape).
Slip direction via `data-side` → per-side CSS custom prop → one
`tip-in/out` keyframe pair. NOTE: Tooltip's `data-state` vocabulary is
`closed/delayed-open/instant-open` (NOT Dialog's `open`) — verified
against the installed package before the CSS is written.

Six site classes drive the sweep (T1 icon+label / T2 icon-only /
T3 truncation labels — NO aria-label added / T4 conditional /
T5 titles inside Radix menus that duplicate visible text — DELETED,
not converted / T6 disabled controls — span shim).

Modal: dead utilities out, `modal-animate`/`modal-overlay-animate`
keyframes in (repeat the `-translate-x/y-1/2` centering in from/to so the
transform composes). Banner: `usePresence(visible, exitMs)` —
animationend unmount + timeout fallback (`exitMs+50`) so reduced-motion
(`animation:none` fires no animationend) can't leak the occlusion;
re-latch mid-exit cancels the unmount.

## 4. Risks + mitigations

1. **A11y golden regression hidden by churn** → expectation is ZERO diff
   (HelpText never serialized; T3 adds no labels). Any diff is
   hand-reviewed against the class rules; only the Task 5 glyph
   aria-label change (concise → full breakdown, spec §4) is a legitimate
   Name change.
2. **Radix Tooltip data-state names wrong** → first-party check against
   `node_modules` dist before writing CSS (plan Task 2 Step 2).
3. **Tooltip overpainted by the viewport popup** → opt-in occlusionIds on
   every dock/toolbar/statusbar/tree site (when in doubt, opt in); feel
   pass exercises the ⚠ tooltip over the real viewport.
4. **asChild prop/ref collisions on exotic triggers** (eye toggle,
   disabled Lighting button) → per-file conversion with tests; T6 span
   shim for disabled; layout check in browser smoke.
5. **Banner occlusion leak through the new exit path** → usePresence
   timeout fallback + dedicated tests (no-animationend, re-latch
   mid-exit).
6. **Tooltips inside open Radix menus fight pointer capture** → T5:
   those titles are deleted, not converted (they duplicate visible text).

## 5. Testing & verification

- **Unit (vitest)**: Tip (7: asChild, focus-open, nullish bare-child,
  occlusion register/release, no-bridge-traffic default, side/align,
  plain-tier padding); ChainWarningTip (4: lead+disclaimer, per-generation
  rows matching formatChainWarning's rules, sub-10 decimal, final-row
  highlight); usePresence (4: rising edge, animationend unmount, timeout
  fallback, re-latch); Modal class assertions; OverloadBanner updated
  (exit-then-unmount, soft-shadow class, occlusion release after exit).
- **Gates**: full web suite (670 → ~686+), `tsc -b` 0, vite build, grep
  gate (zero DOM `title=` outside tests), `pnpm build` (L-040), host
  Debug x64 (L-046 PowerShell MSBuild), native harness 177/0 with zero
  golden diff expected.
- **Browser smoke (L-041)**: hover delay/sweep, slip per side, rich ⚠
  band on a warned mock tree, modal rise both ways, reduced-motion
  emulation.
- **USER feel test (L-033, user-launched)**: tooltip feel across the
  toolbar; ⚠ tooltip over the real viewport (occlusion); modal open/close;
  banner appear/clear via a deliberate overload; both themes; merge gate
  = explicit OK.


---

## Review (post-execution, session 36)

**Shipped as PR [#123](https://github.com/DrKnickers/new-particle-editor/pull/123)
(awaits user feel test + explicit merge OK).** All 13 plan tasks executed
subagent-driven (implementer + spec review + quality review per task; every
finding closed before moving on).

**Verified:** web **687 passed** (670 baseline + 17 new), tsc -b 0, vite
build clean, grep gate zero DOM title=, host Debug x64 clean (LNK4098
benign), native harness **177/0 twice** (update + compare runs), browser
smoke (tooltip styling token-exact in both themes, collision flip
confirmed, modal keyframes live, ?demo=primitives renders).

**Deviations from plan (all verified, all in the PR description):**
1. Radix renders tooltip content twice (visible + VisuallyHidden dupe) —
   occlusion arms only for the visible copy (closest('[role=tooltip]')
   discriminator, dist-verified). TDD caught it.
2. Census was wrong twice (plan said ~42; Toolbar alone had 12) — the
   grep gate was authoritative, as planned (L-022).
3. No T5 sites existed in EmitterTree (footer buttons are icon-only T1);
   the four disabled-able ones got T6 shims (controller call).
4. Demo routes (?demo=*) bypassed the app Tooltip.Provider →
   white-screen; Provider-wrapped (plan missed standalone mounts).
5. Two keyboard a11y goldens were FLAKY, not just churned: the previous
   tab stop's tooltip races its 110ms exit at snapshot time.
   captureDomA11y now settles exit animations; single-test --grep golden
   regeneration is INVALID in this suite (earlier spec files establish
   selection state) — regenerate from full runs only.

**Open for the user (feel test, L-033):** toolbar sweep feel + occlusion
over the viewport, the rich warning glyph tooltip on a real heavy chain
(mock data could not provoke one), modal open/close, banner appear/clear,
both themes, reduced-motion. CHANGELOG hash is TODO until merge.


---

## Review — configurable overload guard (post-execution, session 36)

**Shipped onto PR [#123](https://github.com/DrKnickers/new-particle-editor/pull/123)
(folded in per the user's call; awaits feel test + merge OK).** 7 plan tasks
executed subagent-driven (implementer + spec + quality review per task; every
finding closed). Commits ae59659 (engine) → 11c85e2 (host) → 2697333 (bridge/mock)
→ 7fda54e/02c454b (lib + freeze fix) → be6e5ac (Preferences UI) → 18df6d1 (native specs).

**Verified:** web 700, tsc -b 0, vite build clean, native 180/0 (reproduced twice,
zero golden drift), host Debug x64 clean.

**Deviations from plan (all reviewed + justified):**
1. Engine accessor is IsSpawnOverloadActive (not the assumed IsOverloaded); 2 comment
   stragglers in EmitterInstance.cpp/ParticleSystemInstance.cpp also retargeted.
2. SetEngine body moved to the .cpp (Engine forward-declared in the header).
3. Dirty-query in the contract test is engine/state/snapshot.dirty (the plan's
   file/state placeholder does not exist).
4. OVERLOAD_GUARD_DEFAULT frozen (quality review caught a by-ref singleton-mutation hazard).
5. PreferencesDialog call site is in MenuBar.tsx, not App.tsx (bridge already in scope there).
6. Native existing tests pinned to 25k, NOT 100k: a 100k plateau OOM-crashes the Debug
   test host at the tail of the long single-process harness run (cumulative heap, NOT a
   product regression — enabled path is byte-equivalent to #121's 100k). STOP-and-re-plan
   per CLAUDE.md; the new tests assert tight explicit caps (5k/50k->5k/disabled-2k).

**Open for the user (feel test, L-033):** Preferences -> Preview toggle + cap field;
lower the cap and bomb an emitter (banner at the lower ceiling); uncheck and confirm the
warning + genuinely uncapped behavior on a MODERATE effect; restart the editor and confirm
the setting survived (apply-on-mount). Tune the 25k default by feel. Merge #123 only on
explicit OK. CHANGELOG hash is TODO until merge (both #123 entries backfill together).
