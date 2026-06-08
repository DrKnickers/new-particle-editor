# Dock panel entrance/exit animation + left-pane flicker — attempt + findings (REVERTED)

*2026-06-07 · new-particle-editor / lt-4 · attempted then reverted to `9c531e1`*

## Goal
Animate the spawner/lighting right-dock open/close, and fix the left-pane flicker
when it appears. User chose the **in-layout push** behaviour (not an overlay).

## Root cause of BOTH symptoms (confirmed live)
The outer Group in [`PanelLayout.tsx`](../../web/apps/editor/src/components/PanelLayout.tsx)
carries `key={dockVisible ? "3col" : "2col"}`. Opening/closing the dock flips that key,
which **remounts the entire outer Group — left pane included** (proven: a custom property
set on the `quadrant-emitter-tree` DOM node is destroyed on toggle). That remount is the
flicker AND the reason there's no animation (can't tween across a remount). The key exists
to switch the 2col/3col layout-persistence state; `splitters.spec.ts` even asserts the
remount.

## Approach taken (worked in the browser, broke the native host)
Rewrote the dock as an **always-mounted `collapsible collapsedSize={0}` Panel** driven by an
imperative `usePanelRef()` (collapse when closed, expand when open). No key change → no
remount → **no flicker** (verified: the DOM marker survives a toggle). Single persistence
key; dropped `deriveOuterLayoutOnToggle` + the 2col key. Animated via a `flex-grow`
transition enabled only during the toggle (`.dock-animating`, ~200ms) so splitter drags +
window resizes stayed instant. Lagged the dock CONTENT (`displayDock`) by the anim duration
on close so the pane slides out instead of popping. Separator hidden while collapsed.

**Browser verification (all good):** left pane survives toggle (no remount); open tweens
0→260px, close ~150ms, both smooth; splitter drag instant; zero console errors; web 509/0;
`tsc -b` clean.

## Why it was reverted — NATIVE HOST HANG
The native a11y harness (`pnpm test:native`) failed: a test (`tools.spec.ts:112` Bloom)
timed out 30s with "page closed" — the **host process hung mid-run**. Diagnosis:
- **Cumulative, not any single test.** Every test passes in ISOLATION (`--grep`); the host
  dies only partway through the full ordered run, after the early dock-toggling specs
  (`toolbar.spec.ts` toggles the dock; `background-picker` opens an occlusion panel).
- **NOT the animation.** Disabling the CSS transition (instant collapse/expand) still hung.
- **NOT raw viewport resize.** The existing `dxgi-resize-stress.spec.ts` cycles
  `layout/viewport-rect` 50× and passes — the host's resize path is robust to discrete resizes.
- The structural change that matters: before, a dock toggle **remounted** the viewport
  (`ViewportSlot`) — a clean teardown/rebuild; after, the viewport stays mounted and
  **resizes in place** on every toggle. Something in the host's in-place-resize-on-dock-toggle
  path accumulates and hangs after enough cycles. `host.log` ends abruptly mid
  `[COMP-engine-transform]` scene-rect flood with NO crash signature (a hang, not an
  exception) — consistent with a deadlock/resource issue in the C++ host.

Root-causing this needs a **native debugger or host-side logging of the hang location**,
which couldn't be driven through the agent interface. Reverted to keep `lt-4` clean.

## For the next attempt
1. **Add host-side instrumentation first** (C++): log entry/exit of the scene-rect /
   viewport-resize handler + any locks it takes, and the WebMsg queue depth, so a full-run
   repro shows WHERE it hangs. Consider whether repeated in-place shared-texture resizes leak
   or deadlock vs the remount path that released them.
2. **OR pivot to an overlay drawer** (dock slides OVER the viewport, outside
   react-resizable-panels). The viewport then does NOT resize on toggle → very likely
   sidesteps the host hang entirely, and animates cleanly via a CSS transform. Cost: changes
   UX (overlay vs push) + needs a custom resize handle. This is the lower-risk path to a
   shipping animated dock if the native hang proves hard to fix.
3. The flicker fix alone (always-mounted collapsible, instant open/close) ALSO hit the hang,
   so it can't ship independently of solving the native issue.

## Files the attempt touched (all reverted)
`PanelLayout.tsx`, `styles/components.css` (`.collapse-anim`/`.dock-animating`),
`components/__tests__/PanelLayout.test.tsx`, `tests/splitters.spec.ts`.
