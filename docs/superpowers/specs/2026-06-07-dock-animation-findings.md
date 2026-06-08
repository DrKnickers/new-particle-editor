# Dock panel entrance/exit animation + left-pane flicker — root cause + fix (SHIPPED)

*2026-06-07 · new-particle-editor / lt-4*

> **Correction (session 24).** An earlier pass on this doc concluded the dock
> animation caused a **native host hang** needing a debugger, and reverted to
> `9c531e1`. That diagnosis was **wrong on every structural claim** (see
> "What the host-hang theory got wrong" below). Session 24 re-applied the dock,
> root-caused the real failure with a Playwright trace, fixed it, and the
> animated dock now ships green. This doc is rewritten to record what actually
> happened.

## Goal
Animate the spawner/lighting right-dock open/close, and fix the left-pane flicker
when it appears. User chose the **in-layout push** behaviour (not an overlay).

## The implementation (commit `ddb0777`, re-applied + fixed in session 24)
The outer Group in [`PanelLayout.tsx`](../../web/apps/editor/src/components/PanelLayout.tsx)
used to carry `key={dockVisible ? "3col" : "2col"}`. Toggling the dock flipped
that key, **remounting the entire outer Group — left pane included** (the flicker;
also why no animation was possible — you can't tween across a remount). Rework:
the dock is now an **always-mounted `collapsible collapsedSize={0}` Panel** driven
by an imperative `usePanelRef()` (collapse when closed, expand when open). No key
change → no remount → no flicker. A `flex-grow` transition (`.dock-animating`,
~200ms) animates the open/close only during a toggle so splitter drags + window
resizes stay instant. The dock CONTENT lags `dock` by ~260ms on close
(`displayDock`) so the pane slides out instead of popping. Single persistence key.

## The real failure (and why "host hang" was wrong)
Re-applying `ddb0777` made `tools.spec.ts` fail in the **full** native a11y run
(but pass in isolation). The earlier doc called this a cumulative **native host
hang**. It is not — the host is provably healthy:

- `host.log` is clean across the whole run (0 `[COMP-engine-fail]`, healthy fps),
  and continues normally through `dxgi-resize-stress` which runs ~20 specs AFTER
  the "death".
- No crash dumps (no `ParticleEditor.exe` WER dump, no WebView2 Crashpad report).
- 170+ specs PASS *after* the "failed" one; the harness exits **1** (ordinary
  failure), not **2** (`hostDiedMidRun`), with no `ECONNREFUSED` cascade.
- A 60× real dock-toggle storm, a 400+/480 `layout/scene-rect` flood, and a
  standalone replay of the tools.spec sequence all PASS — none reproduce it.
- Disabling the CSS transition did NOT help (the earlier doc's one true
  observation) — because the trigger is JS state, not the CSS tween.

**Actual root cause (Playwright trace, `--trace retain-on-failure`).** The hung
action is `closeAnyPanel`'s `closeBtn.click()`. Its log:
`element is visible, enabled and stable` → `scrolling… done` →
`<div class="dock-animating" data-group="true"> intercepts pointer events` →
retry ×N → `element was detached from the DOM, retrying` → 30s timeout. No
console errors; ~120 screenshots span the 30s (page live throughout).

It is a **race between the dock close-animation and Playwright's strict click
actionability** — a *test-harness artifact, not a product bug*. On close,
`displayDock`'s ~260ms lag keeps the panel mounted (still a `role="dialog"` with
a Close button) while it collapses to width 0 and then unmounts; the outer Group
wears `.dock-animating`. A `closeAnyPanel` click landing in that window finds the
Close button simultaneously squeezed (click point lands on the animating group →
"intercepts pointer events") and detaching (`displayDock`→null). `closeAnyPanel`
runs at the START of many tests; in the FULL run the prior test's dock-close is
still animating → race; in ISOLATION the prior close never happened → no window.
This explains all of it: full-run-only, intermittent, wandering point
(`:112`/`:167`), timing/Heisenbug-sensitive, self-recovering (next test = fresh
page). **Real users are unaffected** — a human doesn't click a panel sliding
shut, and would re-click; the window is 260ms. Playwright's retry-until-actionable
turns it into a 30s timeout.

## The fix (session 24)
A closing dock panel must not present as an open, interactive dialog while it
slides out:
- [`ToolPanel.tsx`](../../web/apps/editor/src/components/ToolPanel.tsx): new
  `closing` prop → stamps `data-state="closing"` on the `role="dialog"` div, so
  it no longer matches `[role="dialog"]:not([data-state])` (the "open ToolPanel"
  selector).
- [`LightingPanel.tsx`](../../web/apps/editor/src/screens/LightingPanel.tsx):
  accepts + forwards `closing` to ToolPanel.
- [`PanelLayout.tsx`](../../web/apps/editor/src/components/PanelLayout.tsx):
  `dockClosing = dock === null && displayDock !== null`; passes `closing` to the
  panel and marks the dock `<aside>` `inert` during the close window (React 19) —
  a sliding-out panel is genuinely non-interactive (a11y correctness too).
- `splitters.spec.ts` (`:303`→`:306`) rewritten: asserts the new behaviour
  (toggle collapses the always-mounted dock to width 0 and restores it, WITHOUT
  remounting the outer Group — proven by a marker that survives the toggle = the
  flicker fix), replacing the old remount/2col assertion.
- Regression guard: `ToolPanel.test.tsx` asserts `closing` → `data-state="closing"`.

## Verification
- Browser (preview): open → `data-state` absent, matches open-selector, not inert;
  during close → `data-state="closing"`, does NOT match open-selector, aside inert,
  dialog still present (slide-out preserved); after close → clean.
- Native a11y harness: **175 / 0** (all 5 `tools.spec` tests pass, incl. the two
  that hung; rewritten `splitters` passes; a11y goldens unchanged — the
  always-mounted dock is a11y-equivalent in the default open state).
- Web vitest **510 / 0**; `tsc -b` clean.
- Smooth-tween *visual* is the user's eye (arch-C, L-033) — the animation logic is
  unchanged from `ddb0777`'s live-verified tween; the fix only gates interactivity
  during close.
