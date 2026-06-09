# Item 3 — Viewport stutter on dock slide: host-side time-interpolated viewport rect

*Design spec — 2026-06-08, session 27. New-UI (arch-C) default. Host change → own PR
(native harness + drag-resize stress before sign-off). Rev 2: corrected per the spec
red-team (`tasks/w6v635b1y.output`) — 2 blockers + 5 majors folded in.*

Cross-refs: investigation `tasks/wa0o0il6r.output`; session-24 dock notes
`docs/superpowers/specs/2026-06-07-dock-animation-findings.md`; `tasks/todo.md` Item 3.

**Estimate: medium (a multi-sitting host+web change** — QPC bezier sampler + `ViewportAnim`
state machine + new bridge message + analytic `to` + signal-channel store + RO-only
suppression refactor + reduced-motion branch + native-harness re-stress. NOT a quick fix.)

---

## 1. Goal + scope

**Goal.** Make the D3D9 viewport edge **glide with** the right-dock panel edge during the
open/close slide instead of juddering against it.

**Root cause (Phase-0 confirmed, see §2):** the viewport edge is animated *indirectly* by
a clumpy, gap-ridden stream of `layout/scene-rect` messages that the uncapped host render
loop samples at irregular Δt → the edge advances in irregular integer steps. Fix: the host
**generates** the rect itself, every render frame, from a wall-clock interpolation tied to
the CSS curve.

**In:**
- A host-driven **time-interpolated** viewport rect for the **known-duration dock toggle**:
  web sends one `animate-scene-rect { from, to, durationMs, easing, msElapsedAtSend }`;
  the host re-renders at the time-lerped rect each frame.
- Web: a `dockAnimating` **signal channel** (zustand) + **RO-only** send suppression +
  analytic `to` + a **`prefers-reduced-motion`** branch + an authoritative final send.
- Host: `ViewportAnim` state + render-loop advance + a matched cubic-bezier sampler +
  **self-defense** (ignore stray scene-rects mid-anim) + **arch-C gating**.
- Phase-0 probe **extension** (the arrival probe already exists; add an *apply-site* log).

**Out (deferred, with reason):**
- **Drag-resize / splitter** + **window-resize** — open-ended / different path
  (`viewport-rect`→`Apply`→`Engine::Reset`); keep the existing per-message path.
- **DComp-scale-during-tween (Fix #4)** — rejected: per-pixel FoV ⇒ a frozen-and-scaled
  surface shows a squished, wrong-extent slice mid-tween + an end snap; needs a new DComp
  mode. Time-interpolation preserves geometry.
- **rAF-coalesce the web emit (Fix #1)** — Phase-0 proved the emit stream is *already*
  clumpy/gappy (Δt stdev > mean), so coalescing can't smooth it; and it regresses the
  mount-dispatch shape test if mis-scoped. Possible separate follow-up for the drag-storm.
- **--legacy / arch-A:** the anim is **gated to composition mode** (arch-C) — a no-op
  under `--legacy`. Legacy is slated for MT-13 removal; don't add animation to a doomed
  path. (`LayoutBroker::SetSceneRect` drives both `m_alphaCompositor` :254-258 and
  `m_dcompCompositor` :268-314; gate on the dcomp path.)

---

## 2. What the codebase already gives us

**Root cause — Phase-0 measured (probe at `BridgeDispatcher.cpp:919`, 17 user slides):**
- **16–30** `scene-rect` messages per ~200ms slide, **15–24 distinct integer widths**
  each (host dedup can't collapse them).
- Arrival is **clumpy**: Δt **mean 13ms, stdev 20ms** (stdev > mean), gaps up to **109ms**
  (~6.5 dropped frames), with same-ms bursts between. After a gap the width **jumps** (up
  to **~69px** in one message) then crawls 1px at a time — the visible stepping.
- **Width-only** (height constant — right dock); `from/to` deterministic per window
  (`658 ↔ 918` at the test window). **GROW = dock close**, **SHRINK = dock open**.
- The irregularity is **already on the emit side** (the message stream itself is gappy),
  which is why the host must *generate* a smooth signal rather than smooth the stream.

**Pipeline (verified line-by-line; the red-team confirmed the load-bearing ordering):**
- Web: `.dock-animating [data-panel] { transition: flex-grow 0.2s ease }`
  (`components.css:1268-1269`); armed for the toggle only, expand/collapse deferred one
  rAF (`PanelLayout.tsx:189-194`), `.dock-animating` class at `:248`, 260ms cleanup at
  `:194`, `displayDock` content-lag `:204-212`. `ViewportSlot`'s single `send()`
  (`ViewportSlot.tsx:69-82`) is the **RO callback (:85), scroll (:87), window-resize (:88),
  AND DPR onChange (:110)** — one shared closure. Mount send at `:84`. `postMessage` at
  `native.ts:92`. **`prefers-reduced-motion: reduce` ⇒ `transition: none`**
  (`components.css:1271-1274`) — the panel snaps, `transitionend` never fires.
- Host: render loop drains ALL queued messages then calls `RenderD3D9` **once**
  (`HostWindow.cpp:3365-3384`); inside it `engine->Render()` (`:823`) precedes the deferred
  DComp clip in `CompositeEngineFrame` (`:868`) with **no intervening message pump** — so
  render + clip are co-applied with the *same latest-drained* rect (the clear-strip
  ordering the design relies on holds **for free**). Scene-rect handler at
  `BridgeDispatcher.cpp:919-938` → `m_layout.SetSceneRect` (last-write-wins, no queue).
  `SetSceneRect` (`LayoutBroker.cpp:234-316`): no early-out vs its own cache (`:249-252`);
  guard-band + `Engine::SetSceneViewport` (`:310-312`) + `Compositor::
  SetEngineVisualTransform` (deferred default, `:314`). Engine clears the **whole RT**
  (`engine.cpp:692`) then `SetViewport`s the sub-rect (`:711-722`) with per-pixel-constant
  FoV (`:1664-1703`). RT sized to the viewport HWND client (`HostWindow.cpp:2046`),
  **constant** during a dock tween (no `Reset`).
- Clocks: uncapped render loop (`WaitEndFrameQuery` 100k-spin, `engine.cpp:1521-1535`;
  `Present1(0,0)` `Compositor.cpp:1076-1086`); DComp commits on its own ~60Hz
  (`Compositor.cpp:1080-1084`). **Host QPC helpers exist:** `PerfQpcNow()`/`PerfQpcFreq()`
  (`HostWindow.cpp:179-188`) — use these for the anim clock, NOT the engine `GetTimeF()`
  epoch.
- The **existing** `[STUTTER-PROBE]` is at `BridgeDispatcher.cpp:925-935` (#ifndef NDEBUG,
  arrival-time + rect). The **immediate** clip path exists (`Compositor.cpp:1324-1331`) if
  ever needed; the default deferred path already co-applies render+clip.

---

## 3. Architecture / approach

Move the viewport animation's *source of truth* from the per-frame `scene-rect` stream to
a **host-side wall-clock interpolation** synchronized to the panel by the CSS easing +
duration + a web-stamped start phase.

### Web side
**Signal channel.** Lift `dockAnimating` into the right-dock zustand store (`right-dock.ts`)
or a small dedicated store; `ViewportSlot` subscribes via a hook into an `animatingRef`.

**Suppression (RO-only).** Split the shared closure: the **ResizeObserver** callback
becomes `onResize = () => { if (animatingRef.current) return; send(); }`; **scroll /
window-resize / DPR** stay bound to raw `send()` so a concurrent resize/DPR is **not**
dropped. The **mount** send (`:84`) stays synchronous (preserve the shape test).

**On dock toggle** (in `PanelLayout`, which owns the toggle + arms `.dock-animating`):
1. If `window.matchMedia('(prefers-reduced-motion: reduce)').matches` → **skip the anim**;
   send one `layout/scene-rect` at the final `to` (host snaps in lockstep with the panel).
2. Else compute `to` **analytically** (PRIMARY): final viewport width = total − left −
   (dock-expanded-width or 0) − splitters, re-clamped to the library's pixel min/max
   (center min, spawner max). The target dock state is known the instant the toggle fires;
   no DOM read needed. (FALLBACK if analytic proves fragile: seed `to` from the **first
   post-toggle RO-settled rect** — which then must NOT be suppressed.)
3. Capture `msElapsedAtSend = performance.now() − (the rAF-commit timestamp where flexGrow
   actually changed)` so the host can back-date its clock across IPC latency.
4. Send `animate-scene-rect { from, to, durationMs: 200, easing: "ease", msElapsedAtSend }`.
5. On the **260ms cleanup** (reuse the existing timer; or a `transitionend` filtered to
   `propertyName === "flex-grow"` on the center panel + dedup), send one **authoritative**
   `layout/scene-rect` at the exact final rect so host + web agree on rest.

### Host side (gated to composition mode)
```
struct ViewportAnim { bool active; RECTf from, to; uint64 startQpc; double durMs; Easing e; };
```
- `animate-scene-rect` handler: fill it; **back-date** `startQpc = PerfQpcNow() −
  msElapsedAtSend * qpcPerMs` so the host curve is pinned to the CSS origin despite the
  ~16–33ms cross-process hop; `active = true`. (Does not apply a rect itself.)
- **Self-defense:** while `active`, the `layout/scene-rect` handler **ignores** incoming
  (non-authoritative) scene-rects — a stray web send can't clobber the interpolated rect
  (PeekMessage drains all messages before each render).
- Render loop, **before** `engine->Render()`: if `active`,
  `t = clamp((PerfQpcNow()−startQpc)/durMs,0,1)`, `rect = lerp(from,to,ease(t))`, apply via
  the internal `SetSceneRect` path with `round(rect)`. At `t==1`: apply `to`, `active=false`.
- `ease` = the CSS `ease` cubic-bezier(0.25,0.1,0.25,1), sampled per frame.
- The optional per-frame applied-rect debug log is **suppressed during an active anim**
  (or strictly `#ifndef NDEBUG`) so it doesn't pollute the `[PERF]`-timed render region.

### Why correct + smooth
Every host frame computes the rect for **its own timestamp** → monotonic, host-frame-rate
motion, no dependence on the clumpy message stream. The engine **re-renders** honestly →
FoV/aspect correct, no distortion, no end-snap. Reuses `SetSceneViewport`+clip → no new
DComp mode; render+clip stay co-applied (clear-strip safe). Drag/resize/window-resize keep
their existing paths.

---

## 4. Risks + mitigations

1. **Clock/easing/sub-pixel alignment (primary).** Panel edge = browser clock + fractional
   sub-pixel; viewport edge = host clock + integer clip. *Mitigations:* match the bezier;
   share `durationMs`; **back-date `startQpc` from `msElapsedAtSend`** (the IPC hop is
   ~16–33ms / 1–2 browser frames — the steep first ~30ms of the ease, so this matters).
   Residual ±1px from the two rounding regimes is **inherent**; optionally keep the host
   clip in float and round only at `SetClip`. Tune the bezier live (L-033).
2. **Computing `to`.** *Mitigation:* analytic from the known dock target + library
   constraints (PRIMARY); first-RO-settle fallback (un-suppress that first send). The
   authoritative 260ms send corrects any small error. The old "synchronous flexGrow read"
   is **impossible** (`react-resizable-panels.js:855-864` only emits; style lands on the
   next React commit) — deleted.
3. **Re-toggle mid-slide.** *Mitigation:* web sends a fresh `animate-scene-rect` with
   `from =` current viewport rect, new `to`; host replaces `ViewportAnim`, re-stamps start.
4. **DPR change mid-anim.** Rare. *Mitigation:* DPR fires `viewport-rect`/`Reset` (other
   path) → cancel the anim and let the static path take over; accept a 1-frame discontinuity.
5. **Suppression dropping a real resize.** *Mitigation:* RO-only suppression (above) leaves
   scroll/resize/DPR live; plus host self-defense; plus the authoritative final send.
6. **Clear-strip / drag-resize regression.** *Mitigation:* host calls the **existing**
   deferred-clip path at host-timed rects; drag-resize untouched. Re-stress drag + rapid
   re-toggle for any strip (§5).
7. **Reduced-motion regression** *(was unhandled).* `transition:none` → panel snaps,
   `transitionend` never fires. *Mitigation:* the reduced-motion branch (skip anim, single
   final send) — both edges snap together.
8. **Per-frame work / hot-path stdio.** *Mitigation:* re-projection is ~today's order; the
   per-frame debug log is gated/suppressed during anim so `[PERF]` readings stay clean.
9. **No host kill-switch** (the PR lands separately). *Mitigation:* consider an env/registry
   guard mirroring `--legacy` so a regression can be disabled without a rebuild.

---

## 5. Testing & verification

**Phase 0 — DONE + EXTEND.** The arrival probe (`BridgeDispatcher.cpp:925-935`) already
proved the input cadence (§2). **Extend** it with a parallel log at the `SetSceneRect`
**apply** site (host-applied rect + `PerfQpcNow()`) and a per-iteration host-frame-Δt, so
one run yields both the web-burst evidence AND the host-applied-edge cadence. *Smoothness
is governed by DComp commit cadence (`Compositor.cpp:1080-1084`), not 1s-averaged render
frame time* — the measurable proxy post-fix is **Δt-regularity + monotonicity of the
host-applied edge**.

**Phase 1 — build, then measure + eyeball.**
- Web: `animate-scene-rect` + signal-channel store + RO-only suppression + analytic `to` +
  reduced-motion branch + authoritative final send. Vitest: new send shape; mount/scroll/
  resize/DPR sends unchanged (`web/apps/editor/src/components/__tests__/ViewportSlot.test.tsx`
  still green — it's a synchronous-*shape* assertion; add an explicit synchronicity test if
  we want to lock it); reduced-motion path sends a single final rect.
- Host: `ViewportAnim` + back-dated clock + render-loop advance + bezier + self-defense +
  arch-C gate.
- The extended probe shows the host applying a **smooth monotonic** edge at host frame rate.
- **User eyeballs** open AND close separately (L-033): viewport edge glides with the panel?
  any moving seam (easing/phase mismatch)? Tune the bezier / `msElapsedAtSend` handling.

**Phase 2 — tune only if needed.** Easing knob; the duration diagnostic (`0.2s→0.35s`,
`components.css:1269` + `PanelLayout.tsx:194`) — smooth-and-scales-with-duration confirms
the phase model.

**Regression gate (sign-off).** web 514/0 (+ new tests); `tsc -b` 0; `pnpm build` (L-068)
→ native harness **174/0**; **`--legacy` smoke** (anim is a no-op — confirm legacy dock
toggle unchanged); **drag a splitter rapidly + rapid re-toggle mid-slide** → zero frames of
clear-strip; host `[PERF]` no new spikes; **remove/NDEBUG-gate all `[STUTTER-PROBE]`
instrumentation**; land as its own PR.

---

## Decisions folded from the red-team
- `to` = **analytic** (primary), first-RO-settle (fallback). Synchronous read deleted.
- Start sync = **web-stamped `msElapsedAtSend`** + host back-date (not "sub-ms, negligible").
- **Reduced-motion** branch added (was a guaranteed regression).
- Signal channel = **zustand store**; suppression is **RO-only** (shared-`send` split).
- **Host self-defense** ignores stray scene-rects mid-anim.
- Anim **gated to composition mode** (no-op under `--legacy`).
- Probe **extended** at the apply site; smoothness proxy = applied-edge Δt regularity.

## Open questions for the user
- OK to **gate off legacy** (anim arch-C only), per above? (Recommended.)
- Analytic `to` vs first-RO-settle as primary — analytic is cleaner if the constraint math
  is tractable; confirm before building the web side.
- Want the optional host **kill-switch** now, or accept revert-via-PR if it regresses?
