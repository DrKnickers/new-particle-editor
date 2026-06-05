# SEL-12 / SEL-13 — Emitter-tree reorder-drag polish

(Prior task MNU-7's plan+review is in git @ `9f8a7d0` and summarized in this session.)

## 1. Goal + scope

**Goal.** Bring the new-UI emitter-tree reorder drag to legacy parity on two
deferred polish items, both in `web/apps/editor/src/screens/EmitterTree.tsx`:
- **SEL-12** — autoscroll the tree when a reorder drag nears the top/bottom
  edge, so long lists can be reordered past the viewport without manual scroll.
  Proportional speed (ramps toward the edge) — user choice.
- **SEL-13** — `Esc` **and** right-click cancel an *in-progress* reorder drag
  (today only `pointercancel` does). Right-click must also suppress the row's
  Radix context menu while the drag is active.

**In:** the two behaviours above; a pure, unit-tested autoscroll-delta helper;
a small shared hit-test refactor; vitest coverage for SEL-13 + the helper;
live browser-preview verification for SEL-12's real scrolling.

**Out:**
- Marquee-drag changes — SEL-13 is the *reorder* drag; the marquee already
  has Esc-cancel.
- Curve marquee-from-margins — separate deferred item, own task.
- Any bridge / schema / native-host change — pure web.
- Touch/momentum tuning beyond a sane default — YAGNI for a shallow list.

## 2. What the codebase already gives us

- `startDrag` (EmitterTree.tsx:1220-1282) — the pointer-drag controller:
  `onMove` hit-tests the row under the pointer + sets the drop indicator;
  `finish(commit)` removes listeners, clears state, dispatches `emitters/drop`
  only when `commit && lastParams`. `onCancel` already = `finish(false)`.
- The **marquee controller** (handleScrollPointerDown, 1383-1446) already adds
  a capture-phase `keydown` Escape listener mid-drag — the exact pattern to
  mirror for SEL-13's Esc.
- `treeScrollRef` (1327) is the `overflow-y-auto` scroll viewport — the element
  whose `scrollTop` SEL-12 drives and whose rect defines the edge zones.
- Each row is a Radix `ContextMenu.Trigger` (518-700) opening on the native
  `contextmenu` event — so SEL-13 right-click must `preventDefault` it.

## 3. Architecture / implementation approach

**New pure helper** — `web/apps/editor/src/lib/drag-autoscroll.ts`:
```ts
/** px/frame to scroll while a drag hovers near a scroll-container edge.
 *  0 outside the `zone`-px hot band; ramps linearly to ±maxSpeed at the
 *  very edge. Negative = scroll up, positive = down. */
export function computeAutoscrollDelta(
  pointerY: number,
  rect: { top: number; bottom: number },
  opts?: { zone?: number; maxSpeed?: number },  // default zone 28, maxSpeed 12
): number
```

**EmitterTree `startDrag` changes:**
1. **Shared hit-test.** Extract `onMove`'s row-resolution + indicator block into
   `updateDropTarget(clientX, clientY)` using
   `document.elementFromPoint(x,y).closest("[data-emitter-id]")`. `onMove` calls
   it with the event coords and records `lastX/lastY`.
2. **Autoscroll loop.** While `active`, a `requestAnimationFrame` loop reads
   `treeScrollRef` rect + `lastY`, computes `computeAutoscrollDelta`, and when
   non-zero does `container.scrollTop += delta` **then** `updateDropTarget(
   lastX, lastY)` so the indicator tracks while content scrolls under a
   stationary pointer. Started when the drag goes active; `cancelAnimationFrame`
   in `finish`.
3. **SEL-13 cancel.** Two capture-phase document listeners added in `startDrag`,
   acting only when `active`: `keydown` (Escape → `finish(false)` +
   prevent/stop) and `contextmenu` (→ `finish(false)` + prevent/stop, killing
   the Radix menu). Both removed in `finish` alongside the existing three.

## 4. Risks named up front + mitigations

1. **Indicator freezes during autoscroll.** A stationary pointer fires no
   `pointermove`, so without intervention the drop indicator wouldn't update as
   rows scroll past. *Mitigation:* the rAF loop re-runs `updateDropTarget(lastX,
   lastY)` every frame it scrolls (§3.2) — the core correctness point.
2. **rAF leak.** A loop left running after drop/cancel would scroll forever and
   pin a frame callback. *Mitigation:* single `rafId` ref, `cancelAnimationFrame`
   in `finish` (the one teardown path for up/cancel/Esc/right-click).
3. **Right-click still opens the menu.** Radix listens on the native
   `contextmenu`; a stale listener or wrong phase would let the menu through.
   *Mitigation:* document-level **capture-phase** `contextmenu` listener with
   `preventDefault` + `stopPropagation`, active only while dragging; removed in
   `finish`. Pre-active right-click intentionally still opens the menu.
4. **jsdom can't scroll.** `scrollTop`/`getBoundingClientRect` are faked, so an
   autoscroll integration test would be vacuous. *Mitigation:* unit-test the
   pure helper; verify real scrolling in the browser preview (§5).
5. **Esc double-handling.** The tree's own `onKeyDown` / inline-rename Esc could
   collide. *Mitigation:* capture-phase + `stopPropagation` on the drag's Esc,
   and the listener only exists during an active drag.

## 5. Testing & verification

**Unit (vitest, jsdom):**
- [x] `drag-autoscroll.test.ts` — 0 mid-list; ramps near top (neg) / bottom
      (pos); clamps at ±maxSpeed past the edge; symmetric; custom zone/maxSpeed. **7 tests.**
- [x] EmitterTree SEL-13: Escape during an active drag → no `emitters/drop`.
- [x] EmitterTree SEL-13: right-click during an active drag → no `emitters/drop`.
      (Dropped the planned `defaultPrevented` assertion — Radix preventDefaults
      contextmenu itself, so it was vacuous; suppression verified live instead.)
- [x] Full suite **491** (was 482; +7 autoscroll +2 SEL-13), 0 failed.

**Live (browser preview — jsdom can't do layout):**
- [x] Short-viewport drag to the bottom edge autoscrolled 0→64 (=maxScroll,
      clamped); to the top edge scrolled back to 0; mid-list halted scrolling.
- [x] Right-click during an active drag → drag cancelled AND context menu
      suppressed (`suppressedMenuOpen:false`); control right-click with no drag
      opens the menu (`controlMenuOpened:true`) — suppression is meaningful.

**Static:** `tsc --noEmit` exit 0.

## Review

**Outcome.** Both deferred drag-polish items shipped to legacy parity, web-only.
SEL-12 (proportional edge autoscroll) and SEL-13 (Esc/right-click cancel +
context-menu suppression) both land in the existing pointer-drag controller in
`EmitterTree.tsx` — no new drag library, no bridge/schema/native change.

**Built test-first.** `computeAutoscrollDelta` was RED→GREEN before wiring; the
SEL-13 cancel tests were RED (drag still dropped) before the listeners existed.

**Two design pivots from reading the harness / runtime:**
1. Hit-testing splits by path — the event-driven `onMove` keeps using
   `ev.target` (so the jsdom drag tests still pass); only the autoscroll rAF
   loop uses `elementFromPoint` (untestable in jsdom → verified live).
2. The `defaultPrevented` assertion was abandoned once the RED run revealed
   Radix itself preventDefaults `contextmenu`; the unit test asserts the robust
   signal (no drop) and menu-suppression is a live check.

**Verification:** vitest 491/0, tsc 0, and a live in-browser drive proving real
autoscroll (scroll up/down/stop/clamp) and real menu suppression.

**Files:** new `lib/drag-autoscroll.ts` + test; `EmitterTree.tsx` (controller);
`EmitterTree.test.tsx` (+2); docs (ui-delta SEL-12/13 → SHIPPED, fix-plan,
CHANGELOG).
