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
