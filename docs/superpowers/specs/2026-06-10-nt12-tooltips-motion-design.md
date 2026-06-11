# NT-12 — Styled/animated tooltips + modal/banner motion family (design)

*2026-06-10 · ROADMAP [NT-12] + the greenlit modal/banner entrance-exit
animation work · designed with the user via brainstorming; the four core
decisions were validated visually (live motion/surface/layout mockups in the
visual companion, session 36) and each picked explicitly.*

## Purpose

Every hover hint in the editor is a native HTML `title` attribute — unstyled,
~1 s fixed delay, unthemed, inconsistent inside WebView2. Separately, the
Modal's entrance animation classes are silent no-ops (Tailwind v4 build has no
`tailwindcss-animate`; the `animate-in fade-in-0 zoom-in-95` utilities on
`Modal.tsx` generate no CSS) and the OverloadBanner pops in/out with zero
motion. Ship **one motion family** across all three surfaces:

1. A shared styled+animated **tooltip primitive**, replacing native `title`
   app-wide (~95 production sites), with a **rich tier** for the NT-11 ⚠
   chain-warning glyph.
2. Real **entrance/exit animations** for the Modal (replacing the dead
   classes) and the OverloadBanner (via a presence shim).
3. A shared **soft drop-shadow token** (`--shadow-soft`), theme-consistent
   (per-theme alpha), worn by tooltips and the banner.

Non-goals (explicitly out):

- **No retrofit of the slip motion onto existing popovers/menus.** The
  `popover-animate` fade keeps shipping as-is; because translate is immune to
  the scale-near-trigger bug that forced popovers to drop scale
  (`components.css` §"Popover entrance/exit"), they *can* adopt the slip later
  for free — separate change if anyone asks.
- **No touch/long-press tooltip support** — the editor is a desktop Win32
  host; mouse + keyboard focus only (Radix's defaults).
- **No new tooltip copy beyond what the `title`s already say**, except the
  chain-warning lead line the roadmap requires. Copy rewrites are a separate
  editorial pass.
- **No animation library.** The family extends the existing hand-rolled
  CSS-keyframes-keyed-to-`data-state` vocabulary; the only new dependency is
  `@radix-ui/react-tooltip`.

## Decisions (user-approved, visually validated)

| Question | Decision |
|---|---|
| Motion language | **Fade + directional slip** (rises *away from* the trigger). Tooltips 4 px, banner 6 px drop, modal 8 px rise. Chosen over pure fade (too quiet) and scale-pop (re-introduces the documented popover scale bug class). |
| Durations / easing | **Fast tier 130 ms ease-out in / 110 ms ease-in out** (tooltips — matches the shipped `popover-pop` numbers exactly); **slow tier 180 / 150 ms** (modal + banner: larger elements). |
| Tooltip surface | **Theme-following panel** (`panel-3` + `border-2` dark; white + border light) — one visual system with menus/popovers/modals. Rejected the fixed-dark VS-Code-style chip. |
| Shadow | **`--shadow-soft`** two-layer (wide ambient + tight contact): `0 4px 16px rgba(0,0,0,.45), 0 1px 3px rgba(0,0,0,.35)` dark; light override `.14/.10`. Tooltips + banner wear it; banner drops `shadow-xl ring-1 ring-black/15`. |
| ⚠ chain-warning layout | **Amber header band + aligned breakdown** (option B): tinted band with lead line "This chain may spawn far too many particles" + "Soft warning — nothing is blocked"; body = aligned name/math rows from `ChainWarning.path`; final cumulative highlighted amber. |
| Banner motion | User-validated side-by-side: fade + 6 px drop in 180 ms / reverse out 150 ms, soft shadow. |
| Sweep breadth | **Full sweep** — all ~95 production `title=` sites in this pass (user's explicit call over a staged rollout). |

## §1 Tokens (tokens.css)

New custom properties beside the existing `--shadow`:

```css
:root {
  /* NT-12 motion family. Fast = tooltips (matches popover-pop timings);
     slow = modal/banner. Slip distances are per-surface, not per-tier. */
  --motion-fast-in: 130ms;
  --motion-fast-out: 110ms;
  --motion-slow-in: 180ms;
  --motion-slow-out: 150ms;
  --motion-ease-in: ease-out;   /* entrances decelerate */
  --motion-ease-out: ease-in;   /* exits accelerate */
  --slip-tooltip: 4px;
  --slip-banner: 6px;
  --slip-modal: 8px;
  /* Soft two-layer drop shadow: wide ambient + tight contact. Unlike
     --shadow (dark-only), this one HAS a light-theme override so it
     reads equally soft on both themes. */
  --shadow-soft: 0 4px 16px rgba(0, 0, 0, 0.45), 0 1px 3px rgba(0, 0, 0, 0.35);
}
[data-theme="light"] {
  --shadow-soft: 0 4px 16px rgba(0, 0, 0, 0.14), 0 1px 3px rgba(0, 0, 0, 0.10);
}
```

Naming note: `--motion-ease-in` is "the easing used when motion comes IN"
(i.e. CSS `ease-out`). If that inversion reads badly in review, rename to
`--ease-entrance`/`--ease-exit` — implementer's pick, used consistently.

Keyframes live in `components.css` beside `popover-pop-in/out`, one
`prefers-reduced-motion: reduce → animation: none` guard per family member
(same pattern as `.popover-animate`).

## §2 Tooltip primitive

**New dependency:** `@radix-ui/react-tooltip` (joins the seven Radix packages
already in `apps/editor/package.json`). Radix is chosen over hand-rolling for:
portal + collision-aware positioning, hover/focus/Esc semantics,
`aria-describedby` wiring, Presence (exit animations actually play), and the
`data-state`/`data-side` attributes our CSS keys off.

**One provider, app-level:** `<Tooltip.Provider delayDuration={400}
skipDelayDuration={300}>` wraps the app shell once. First hover waits 400 ms;
moving between tooltipped controls within 300 ms opens instantly — the
"sweep the toolbar" feel native `title` can't give. (Exact prop values are
feel-tunable at the user smoke; these are the spec defaults.)

**Wrapper API** (new file `primitives/Tip.tsx` — short name because it
appears ~95 times):

```tsx
type TipProps = {
  content: ReactNode;          // string for the plain tier; JSX for rich
  side?: "top" | "right" | "bottom" | "left";  // default "top"
  align?: "start" | "center" | "end";          // default "center"
  occlusionId?: string;        // opt-in viewport occlusion (see §3)
  children: ReactElement;      // single trigger child, asChild
};
function Tip(props: TipProps): JSX.Element;
```

- Trigger uses `asChild` — no wrapper element, the existing
  button/span/glyph IS the trigger. Sites whose trigger is a *disabled*
  button get a `<span>` shim (Radix's documented disabled-trigger pattern)
  — there are only a handful; identified during the sweep.
- Content renders into `Tooltip.Portal`, classed `tip-surface tip-animate`:
  `tip-surface` = panel-3 / border-2 / rounded / 11.5-12 px text /
  `box-shadow: var(--shadow-soft)`, plus `Tooltip.Arrow` filled to match the
  surface; `tip-animate` = the §1 fast-tier slip keyframes, direction keyed
  off `data-side` (4 variants: `[data-side="top"]` slips up, etc.).
- `data-state` values to key on: Radix Tooltip uses `delayed-open` /
  `instant-open` / `closed` — NOT plain `open` like Dialog/Popover. The CSS
  must match both open states (`[data-state^="instant"], 
  [data-state^="delayed"]`) or animate on a shared class toggled by state.
  **Verify against the installed version's rendered DOM during
  implementation** (trust-but-verify; Radix has changed these names across
  majors).
- `maxWidth` ~320 px, `white-space: normal` — content is never
  width-constrained by the trigger's container (portal to body), the failure
  mode the brainstorm mockup itself demonstrated.

## §3 Viewport occlusion (the codebase-specific hazard)

Tooltip content is portaled DOM. Anywhere it extends over the D3D-composited
viewport popup, the engine **overpaints it** — the exact problem
`OccludingPopover` / `OccludingMenubarContent` / the OverloadBanner already
solve via `useViewportOcclusion`. The ⚠ glyph lives in the emitter tree and
opens *toward* the viewport, so this fires in practice.

Design: occlusion is **opt-in per site** via `occlusionId`. When set, the
content body registers `useViewportOcclusion(bridge, occlusionId, ref, pad,
feather)` exactly like `OccludingPopover` (bridge from `useBridge()`
context; pad/feather 12/12 like the banner — the tooltip's soft shadow is
smaller than the menus' shadow-xl, so the 24/24 enclosure is oversized).

Opt-in rather than always-on because (a) most of the ~95 sites are in the
left dock / property tabs and physically cannot reach the viewport at any
window size worth designing for, (b) each registration is bridge traffic on
open/close, and (c) the occlusion hook needs a mounted bridge — plain sites
keep working in browser/mock mode with zero bridge coupling. The sweep
classifies each site: **any site whose tooltip can plausibly overlap the
viewport quadrant gets an id** (emitter-tree rows, toolbar's right edge,
status bar, anything inside the viewport quadrant itself). When in doubt,
opt in — a never-hit occlusion registration is cheap; an overpainted tooltip
is a bug.

Mock/test environments: `useViewportOcclusion` already no-ops gracefully
against MockBridge (banner precedent); nothing new needed.

## §4 Rich tier — the ⚠ chain-warning tooltip

New presentation component (lives beside the glyph in
`screens/EmitterTree.tsx` or a sibling file — implementer's call):

```tsx
function ChainWarningTip({ warning }: { warning: ChainWarning }): JSX.Element;
```

Renders the user-picked option B inside `<Tip content={...} side="right"
occlusionId={`tip:chain-warn:${stableId}`}>`:

- **Amber band** (header): `background: color-mix/rgba(--warning, 14%)`,
  bottom border ~35 % warning; bold lead **"This chain may spawn far too many
  particles"**; sub-line "Soft warning — nothing is blocked" in `text-2`.
- **Body**: one row per `warning.path` entry — name left, math right
  (`~12 alive` / `×60 → ~720`), math in the editor's mono stack at 11 px,
  `text-2`; the final row's math in `--warning` + semibold. Number formatting
  reuses the existing `formatChainWarning` helpers' rules (same rounding,
  same sub-10 decimal rule) — **no formula duplication**: the component
  consumes `ChainWarning.path` directly; `formatChainWarning`'s plain-text
  output remains the `aria-label` (screen readers keep the full breakdown).
- The glyph's native `title` is removed (it's what this replaces).

The rich tier is just "content is JSX" — no second primitive, no variant
prop. Other future rich tooltips get the same treatment.

## §5 The app-wide sweep (~95 sites, ~26 files)

Mechanical conversion with per-site judgment:

| Site class | Rule |
|---|---|
| Icon-only button with `title` + `aria-label` | `title` → `<Tip>`; **keep** the `aria-label` (Radix adds `aria-describedby` only while open — the label is the always-on name). |
| Icon-only button with `title` only | `title` → `<Tip>` + **add** an `aria-label` with the same text (removing `title` would otherwise delete the accessible name). |
| Text button / labeled control with explanatory `title` | `title` → `<Tip>`; no aria changes (visible text is the name; tooltip is supplementary description). |
| Disabled control with `title` | `<span>` shim trigger (Radix disabled-trigger pattern). |
| `title` on non-interactive text (status readouts) | `<Tip>` on the existing element via asChild — hover-only is fine here; do NOT add tabIndex to make these focusable (they aren't interactive). |
| Test-file `title=` usages | Update alongside their component, same PR. |

Out of the sweep: `<Dialog.Title>`/`Modal title=` props (component props, not
the HTML attribute — the grep distinguishes them), and `title` attributes
inside SVG markup if any (semantic, not hover hints).

**A11y golden churn is expected and budgeted.** The native harness's a11y
goldens serialize accessible names/descriptions; removing `title` and adding
`aria-label`s changes that surface. The plan includes a golden-regeneration
pass with a hand-reviewed diff (the NT-11 precedent: DOM-order decisions were
made specifically to keep goldens byte-stable — this change CANNOT be
byte-stable, so the diff review is the control).

## §6 Modal retrofit

- Delete the no-op `animate-in fade-in-0 zoom-in-95` (and overlay's
  `fade-in-0`) utility strings from `Modal.tsx` — they generate no CSS in
  this build and mislead readers.
- Add `modal-animate` / `modal-overlay-animate` classes + keyframes
  (components.css): overlay pure fade (slow tier); content fade + 8 px rise
  (`translate(-50%, calc(-50% + var(--slip-modal))) → translate(-50%, -50%)`)
  — the keyframes must compose with the existing centering transform, which
  is why content gets keyframes rather than a transition.
- Exit plays automatically: Radix Dialog Presence keeps content mounted
  through `data-state="closed"` animation (same mechanism the popovers
  already rely on).
- Interaction with the snapshot-gating open flow (`open && snapshotReady`):
  none — the animation starts when Dialog mounts, which is already gated;
  the 8 px rise just replaces the instant pop at the same moment.

## §7 OverloadBanner presence shim

The banner unmounts instantly (`if (!overload) return null`), so exits need a
shim — a generic `usePresence(visible, exitMs)` hook (lib/) returning
`{ mounted, state: "open" | "closed" }`:

- `visible` rising edge → `mounted=true, state="open"` (banner mounts,
  `banner-in` plays: fade + 6 px drop, slow tier).
- `visible` falling edge → `state="closed"` (`banner-out` plays), then
  `mounted=false` on `animationend` **with a `setTimeout(exitMs + 50)`
  fallback** so a dropped event (or reduced-motion `animation: none`, which
  fires no animationend) can never leave a ghost banner mounted or leak the
  occlusion registration.
- Occlusion lifecycle unchanged: the body component still
  registers/releases on mount/unmount; the cut-out now outlives the latch by
  one exit animation (~150 ms) — invisible.
- Shadow: `shadow-xl ring-1 ring-black/15` → `shadow-[var(--shadow-soft)]`
  (or a `tip-shadow` utility class — match however the tooltip surface ships
  it).
- Re-latch mid-exit (overload flickers back on during the 150 ms out):
  rising edge cancels the exit (`state="open"` again, timeout cleared) — the
  hook handles it; a test covers it.

## §8 Reduced motion & a11y summary

- Every new keyframe family ships inside the same
  `@media (prefers-reduced-motion: reduce) { animation: none }` guard the
  popovers use. With animations off, the presence shim's timeout fallback
  (§7) still unmounts the banner.
- Radix Tooltip: trigger keeps focus-visible opening (keyboard users get
  tooltips), Esc dismisses, `aria-describedby` auto-wired while open.
- Accessible names: no site loses one (§5 rules); the chain glyph keeps the
  full text breakdown as `aria-label` (§4).

## §9 Testing & verification

Vitest (component):

- `Tip`: renders trigger unchanged (asChild), opens on hover/focus with
  provider delay, content portaled with `tip-surface`, side/align forwarded,
  occlusionId registers/releases the occlusion (stub bridge, banner-test
  precedent), disabled-trigger shim works.
- `ChainWarningTip`: lead line + sub-line render; one row per path entry;
  final row highlighted; number formatting matches `formatChainWarning` for
  the same input (property: parse the aria-label text and compare values).
- `usePresence`: mounts on rising edge, plays exit then unmounts on
  animationend, timeout fallback fires without animationend, re-latch
  mid-exit cancels the unmount.
- OverloadBanner: existing tests updated for the shim (banner remains
  mounted during exit, gone after).
- Modal: dead classes gone, `modal-animate` present (smoke-level — the
  motion itself is CSS, verified by eye).

Suites & gates: web full run (670 + new), `tsc -b` 0, vite build clean;
native harness with **a11y golden regeneration + hand-reviewed diff** (§5);
host Debug x64 build; the preview-overload regression spec still passes
(banner DOM shape changes — its selectors may need updating, behaviour must
not).

User feel pass (L-033 — user-launched): tooltip delay/skip-delay feel across
the toolbar; slip direction on all four sides; ⚠ rich tooltip in the real
tree (incl. over the viewport — occlusion); modal open/close on a few
dialogs; banner appear/clear via a deliberate overload; both themes for the
shadow; reduced-motion spot check (OS setting).

## §10 Risks

1. **A11y golden churn masks a real regression.** ~95 sites change their
   accessible-description surface at once; a regenerated golden could bury an
   accidentally-deleted accessible name. Mitigation: the §5 per-class rules
   make "name preserved" mechanical; the golden diff is hand-reviewed
   class-by-class, not rubber-stamped; sites converted file-by-file in
   reviewable commits.
2. **Radix Tooltip `data-state` mismatch.** The state names differ from
   Dialog/Popover (`delayed-open`/`instant-open`) and have shifted across
   versions. Mitigation: verify against the installed package's rendered DOM
   before writing the CSS selectors (first-party check, logged in the plan).
3. **Tooltip-over-viewport overpaint at unclassified sites.** A site judged
   "can't reach the viewport" might at some window geometry. Mitigation:
   when-in-doubt-opt-in rule (§3); the feel pass explicitly exercises the
   emitter tree + viewport-adjacent surfaces; adding an `occlusionId` later
   is a one-line fix.
4. **Provider-level delay regresses a site that needs instant tooltips.**
   E.g. the curve editor's value readouts may want no delay. Accepted for
   v1: one global delay; per-site `delayDuration` is a prop away if the feel
   pass flags one.
5. **`asChild` ref/props collision on exotic triggers.** Radix slots props
   onto the child; a child that swallows `onPointerEnter`/refs breaks open
   behaviour. Mitigation: the sweep converts file-by-file with tests; exotic
   triggers (the eye toggle, spinner buttons) get explicit hover smoke in
   the feel pass.
6. **Banner exit animation interacts with the occlusion ring under splitter
   drags** (the observeParent fix from #121). Unchanged code path — the body
   still registers with `observeParent=true`; the only new state is 150 ms of
   exit. Accepted: not worth designing around beyond the §7 timeout fallback.


## Addendum — feel-test refinements (2026-06-10, post-build)

The user feel-tested the shipped build; four adjustments followed, all on
the same PR:

1. **Tooltips only on interactive controls.** The §5 T3 truncation labels,
   the status-bar readout, and the import-path display lost their tooltips
   entirely — passive non-buttons do not need a hover hint. Tooltips remain
   on buttons, role=button affordances (eye toggle, link-group bracket),
   and the deliberate ⚠ glyph.
2. **Warning copy.** §4's band now reads *"This {chain|emitter} may spawn
   too many particles"* — "emitter" when the offending path is a single
   row (one emitter pins the threshold), "chain" when multi-generation.
   Dropped "far"; dropped the "Soft warning — nothing is blocked"
   sub-line; the first breakdown row reads "~N particles" not "~N alive".
   `formatChainWarning` (the aria-label) mirrors the same wording.
3. **Modal/banner alignment (§6/§7).** The keyframes must NOT repeat the
   `-translate-x/y-1/2` centering inside `transform`: Tailwind v4 emits
   that centering as the standalone `translate` PROPERTY, so a `transform`
   that also did `translate(-50%, …)` double-shifted the surface (it spawned
   mis-centered and snapped on animation end). Corrected to slip via
   `transform: translateY()` only; `translate` owns centering; the two
   compose. (The standalone-mockup brainstorm missed this because it
   centered via `transform` — a mockup≠real-host gap → see lessons L-082.)
