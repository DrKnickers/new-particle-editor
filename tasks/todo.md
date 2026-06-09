# UI polish batch 2 — selected-key / popover anims / modal speed / viewport stutter

Session 27. Branch `claude/ui-polish-2` off `master`. New-UI (React) is the
x64 default. User is driving the live host (PID running) for visual tuning
(L-033 — agent-rendered native is unreliable; values get the user's eye).

## 1. Goal + scope

Four independent UI-polish items from the user, tackled **quick-wins-first**:

1. **Selected curve key** — replace the blue selection highlight with a *more
   saturated* version of the key's **own** color, enlarge the selected key, and
   strengthen its drop shadow.
2. **Background / Ground / texture-picker popovers** — add a consistent
   **fade + slight zoom** entrance/exit animation (match the existing modals),
   applied once in the shared wrapper.
3. **Save-changes modal speed** — make it near-instant **while keeping** the
   frosted-glass backdrop, by making the viewport snapshot capture cheap
   (downscale) instead of dropping the gate.
4. **Viewport stutter on dock slide** — smooth the D3D9 viewport as the right
   dock animates open/closed. (Hardest; needs host experimentation; done last.)

**In:** items 1, 4(anim), 2 as a low-risk batch; then 3 on its own.
**Out:**
- The flaky PAL-14 test fix — already its own PR (#96), not part of this batch.
- Any change to *which* views use the curve editor, popover *contents*, or the
  modal's logic/flow (only its open latency). Scope is appearance + smoothness.
- MT-13 legacy removal (greenlit but a separate effort).

**Order (user-chosen):** 1 → 4 → 2 → 3. Each verified + shown in the host before
moving on.

## 2. What the codebase already gives us

- **Selected key (item 1):** keys are SVG `<circle>` in
  `web/apps/editor/src/screens/CurveEditor.tsx`. Single-track path ~`:956-1003`
  (`r=5` selected / `4` not), multi-channel focus path ~`:1858-1934` (hit-pad +
  visible dot, `visR=6/5`). Selected fill is a hardcoded blue
  `SELECTED_FILL = "#0EA5E9"` (`:213`), applied in **both** paths. Multi-channel
  keys carry their channel color (`channel.color`, e.g. `var(--x-axis)`) — that's
  the "own color" to saturate. Every key has a `data-selected="true"` hook, and a
  shared `.curve-key-marker { filter: drop-shadow(0 1px 1.2px rgba(0,0,0,.5)); }`
  at `web/apps/editor/src/styles/components.css:1063`.
- **Popovers (item 4):** all three (`BackgroundDropdown`, `GroundDropdown`,
  `TexturePalettePopover`) are Radix `Popover` routed through ONE wrapper,
  `web/apps/editor/src/components/OccludingPopover.tsx`, which renders
  `Popover.Content`. The repo's golden anim pattern lives in
  `web/apps/editor/src/components/Modal.tsx:251,253`
  (`data-[state=open]:animate-in fade-in-0 zoom-in-95`). Tailwind v4 ships the
  `animate-in/out`, `fade-*`, `zoom-*` utilities natively (no plugin). Radix
  exposes `--radix-popover-content-transform-origin` for a trigger-anchored zoom.
- **Modal speed (item 2):** `Modal.tsx:80-220` gates
  `Dialog open={open && snapshotReady}` on a `viewport/capture-snapshot` bridge
  call. The capture (`CaptureSnapshotPng`, dispatched at
  `src/host/BridgeDispatcher.cpp` ~1023) does a full-res (3440×1369) GPU readback
  + GDI+ PNG encode + IPC + decode = 50–750ms. The gate exists to avoid a
  backdrop-filter flash — keep it; just make capture cheap.
- **Viewport stutter (item 3):** dock tween = `transition: flex-grow 0.2s ease`
  (`components.css:1216`), orchestrated in `PanelLayout.tsx:184-199`.
  `ViewportSlot` fires `layout/scene-rect` on **every** ResizeObserver tick with
  **no throttle** (`ViewportSlot.tsx:85`) → ~15 msgs/tween. Host already coalesces
  (Compositor keeps only latest pending transform; Engine viewport-set
  idempotent), so the stutter is the 1-frame lag between DComp clip widening and
  the engine re-rendering the new viewport.

## 3. Implementation approach

**Item 1 — selected key (web only).** Stop overriding the selected fill to blue;
keep the key's **own** color when selected, then express "more saturated +
bigger + stronger shadow" via the existing `data-selected` CSS hook:
- `CurveEditor.tsx`: in both render paths, when `selected`, set `fill` to the
  key's own color (multi-channel: `channel.color`; single-track: its
  border/interior color) instead of `SELECTED_FILL`. Bump selected radius
  (single `5→~6-7`; multi `visR 6→~7-8`, `hitR` to match).
- `components.css`: add `.curve-key-marker[data-selected="true"]` →
  `filter: saturate(<X>) drop-shadow(<stronger>)`. `saturate()` intensifies the
  channel color; single-track grey is unaffected by saturate (size+shadow carry
  it there — confirm acceptable in host). Retire `SELECTED_FILL` if now unused.
- Values (saturate factor, radii, shadow) are first-pass; **tuned live with the
  user in the host**.

**Item 4 — popover anim (web only).** Centralize in `OccludingPopover`: merge a
fixed animation class string with the caller's `className` (prepend, don't let
caller override) on `Popover.Content`:
`data-[state=open]:animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out
fade-out-0 zoom-out-95 origin-[--radix-popover-content-transform-origin]` plus a
short `duration-*`. Radix delays unmount for the CSS exit animation natively (no
`forceMount`). All three popovers inherit it; no per-caller change.

**Item 2 — modal speed (host + maybe web).** Keep the snapshot-ready gate (no
flash). Make `CaptureSnapshotPng` cheap: downscale the readback to a small max
dimension (e.g. ≤ ~960px wide) before the GDI+ PNG encode — the backdrop is
`backdrop-blur-sm` over `bg-black/60`, so low-res is visually identical. Target
capture ≤ ~30ms so the gated open feels instant. Read the capture impl first to
pick the cleanest downscale point (StretchBlt / D3DXLoadSurface / scaled RT).

**Item 3 — viewport stutter (host-heavy, experimental).** Hypotheses to try in
the host, simplest first: (a) rAF-coalesce `layout/scene-rect` sends so ≤1/frame;
(b) ensure the engine viewport change is applied *before* the DComp clip on
shrink (kill the 1-frame lag); (c) if needed, let DComp scale the existing visual
during the tween and do one true resize at the end. **Iterate with the user** —
no promised design until we see it move.

## 4. Risks + mitigations

1. **Single-track grey keys don't visibly "pop" under saturate-only.** Grey has
   no saturation to boost, so item 1's color change is a no-op there. *Mitigation:*
   the selected size bump + stronger shadow still differentiate; confirm the look
   with the user in the host and, if too subtle, fall back to a slight brightness
   bump for the single-track path only. Accepted as a tune-in-host detail.
2. **Popover exit animation never plays (element unmounts instantly).** If the
   caller's `className` overrides or Radix unmounts before `data-[state=closed]`,
   the exit won't show. *Mitigation:* merge classes in the wrapper (don't pass raw
   `{...rest}` className through), verify against the Modal pattern which already
   works, and assert `data-state` transitions in a vitest spec.
3. **Downscaled snapshot visibly degrades the backdrop.** If the downscale is too
   aggressive or applied before the blur reads it. *Mitigation:* the backdrop is
   already blurred to mush; pick a max-dim that's still > the blurred detail floor
   (~720–960px). Eyeball in the host before committing the factor.
4. **Item 3 host changes regress the existing resize-storm mitigations.** The
   compositor's coalescing + occlusion logic is load-bearing (drag-resize). *Mit:*
   treat item 3 as its own change/PR, re-run the native harness (174/0), and
   stress drag-resize + dock-toggle together before declaring it fixed.
5. **Host rebuild churn.** Items 2 & 3 need MSBuild + relaunch each iteration.
   *Mitigation:* batch the web items (1, 4) first — they only need `pnpm build` +
   reload — then do the host items so the user isn't waiting on C++ builds early.

## 5. Testing & verification

- **Build/type gates:** `pnpm --filter @particle-editor/editor test` → 514/0 (+
  any new popover-anim spec); `tsc -b` → 0; host Debug x64 clean for items 2/3;
  `pnpm build` before any native harness run (L-068); native harness 174/0 after
  host changes.
- **Item 1:** selected keys show a saturated own-color (not blue), larger, with a
  stronger shadow; unselected unchanged; multi-channel AND single-track both sane;
  selection/drag still works. User confirms the look in the host.
- **Item 4:** all three popovers fade+zoom in on open and **out** on close (exit
  actually plays); no layout shift; trigger-anchored origin; vitest asserts the
  `data-state` open/closed classes are present.
- **Item 2:** save-changes modal appears effectively instantly with the frosted
  backdrop intact; no unblurred-frame flash; works at maximize (worst case). User
  times it in the host.
- **Item 3:** dock open/close is smooth — no viewport stutter/clear-strip; drag-
  resize storms still clean; native harness 174/0. User confirms smoothness.

---

## Item 3 — build plan (session 28, scope CONFIRMED with user)

Design = `docs/superpowers/specs/2026-06-08-item3-viewport-stutter-design.md` (rev 2).
This section is the **execution checklist**; the spec holds the rationale. All
spec claims re-verified against current code this session (L-022 pass):
`send` is one shared closure (ViewportSlot.tsx:69-117); `dockAnimating` is local
useState (PanelLayout.tsx:183); `[STUTTER-PROBE]` `#ifndef NDEBUG` at
BridgeDispatcher.cpp:925-935; `SetSceneRect` drives both compositors, arch-C gate =
`if (m_dcompCompositor)` (LayoutBroker.cpp:268); `PerfQpcNow()` at HostWindow.cpp:179;
render loop drains-all-then-RenderD3D9-once at HostWindow.cpp:3363-3384.

**Confirmed decisions (user, session 28):**
- **arch-C gated** — anim is a no-op under `--legacy` (host: the `m_dcompCompositor`
  branch; **web: also gated** — see refinement below).
- **Analytic `to`** (primary). Verified exact: `dockPanelRef.getSize().inPixels`
  reads the open-width at toggle; `expand()` restores `expandToSize` (the pre-collapse
  width, react-resizable-panels.js:857/862) which we shadow in `lastDockWidthRef`.
  Close: `to.w = from.w + W_dock`; open: `to.w = from.w − W_dock` (first-ever open
  falls back to persisted spawner% × groupWidth, else 260 min). Authoritative 260ms
  send corrects the rare narrow-window edge (center hits its 30% min → left absorbs).
- **No kill-switch** — contained + arch-C-gated; revert-via-PR if it regresses.

**Refinement to the spec (named to user):** the web RO-suppression + `animate-scene-rect`
send MUST be gated to `!isLegacyMode()`, not just the host. Otherwise under `--legacy`
the suppression drops per-frame scene-rects while the host anim no-ops → freeze-then-snap.
Extract `isLegacyMode()` from ViewportSlot.tsx into a shared `lib/hosting-mode.ts`
(preserve the exact import.meta.env + process.env semantics so ViewportSlot's tests
stay green) and import in PanelLayout.

### Phase 1a — Web (self-verifiable) — ✅ DONE (536 tests, tsc -b 0)
- [x] **Bridge schema:** `animate-scene-rect` request + response (index.ts) + MockBridge
      no-op (mock.ts). `tsc -b` 0.
- [x] **Signal store:** `lib/dock-anim.ts` (`{ animating, setAnimating }`) + unit test.
- [x] **Shared hosting-mode:** extracted `isLegacyMode()` → `lib/hosting-mode.ts`;
      ViewportSlot imports it; existing ViewportSlot tests still green. + unit test.
- [x] **Shared geometry:** `lib/scene-rect.ts` — `computeSceneRect(el)` (DRY w/ ViewportSlot)
      + pure `dockSlideTarget(from, dockWidthDev, opening)` (analytic `to`). + unit tests.
- [x] **ViewportSlot RO-only suppression:** `animatingRef` synced via `useDockAnim.subscribe`;
      RO callback gated; scroll/resize/DPR/mount stay raw. + 4 suppression tests.
- [x] **PanelLayout toggle (arch-C only):** legacy → no anim/no signal (regression-safe);
      reduced-motion → snap; analytic `to` via `getSize().inPixels` + shadowed
      `lastDockWidthCssRef`; `animate-scene-rect` in the rAF with `msElapsedAtSend`;
      authoritative settle at 260ms reads the REAL settled rect. + 4 dock-anim tests
      (separate mocked file so the synchronous PanelLayout tests stay mock-free).
- [x] Web gate: **536** tests (515 + 21), `tsc -b` 0.
- [~] Adversarial review of the web diff (workflow in flight) → fold confirmed findings.

### Phase 1b — Host — ✅ WRITTEN + COMPILES (Debug x64 clean; harness running)
- [x] **`ViewportAnim` on LayoutBroker** (`LayoutBroker.h`): float from/to + `startQpc`
      + `durMs`; `StartSceneAnim(from,to,durMs,msElapsedAtSend)` (back-dates `startQpc`
      via its own QPC; **no-op unless `m_dcompCompositor`**) + `AdvanceSceneAnim(qpcNow)`
      (lerp+apply; at t≥1 apply exact `to`, clear active) + `IsSceneAnimActive()`.
- [x] **Self-defense:** `SetSceneRect` early-outs while `active`; real work split into
      private `ApplySceneRect` (anim advance + the guard both funnel through it).
- [x] **Dispatcher** (`BridgeDispatcher.cpp`): `animate-scene-rect` handler →
      `m_layout.StartSceneAnim(from,to,durationMs,msElapsedAtSend)`. `easing` read-but-
      unbranched (host hardcodes the `ease` bezier; web only sends "ease").
- [x] **Render-loop advance** (`HostWindow.cpp:823` area): `layout.AdvanceSceneAnim(
      PerfQpcNow())` before `engine->Render()`, OUTSIDE the `[PERF]` region.
- [x] **Bezier sampler:** anonymous-namespace `UnitBezier` (WebKit-style Newton+bisection)
      for CSS `ease` = cubic-bezier(0.25,0.1,0.25,1.0) + `Lerpf` + cached `QpcPerMs()`.
- [x] **Probe:** kept ONE-line `[STUTTER-PROBE] anim-start` (`#ifndef NDEBUG`, TEMPORARY);
      dropped the per-frame apply log (would spam the uncapped loop + pollute `[PERF]`).
      The arrival probe going QUIET mid-slide is the suppression evidence. **Remove BOTH
      probes before sign-off.**
- [x] Host gate: Debug x64 clean ✅; web `pnpm build` ✅ (L-068); native harness **174/0** ✅
      (incl. viewport-resize.spec — the ApplySceneRect split didn't regress the static path).
      Bezier hand-verified (CSS ease y(0.5)≈0.80 ✓).
- [x] **Adversarial host review** (14 raised → **1 confirmed**, 13 refuted; one agent ported
      the bezier to Python: CssEaseY(0.5)=0.8024, max err 2.3e-6, Newton always converges):
  - **#1 (risk-#4, confirmed):** mid-anim resize/DPR wasn't cancelled → anim lerps to a stale
    `to`. **FIXED:** `LayoutBroker::CancelSceneAnim()` called from `Apply`/`PredictAndApply` on a
    real SIZE change only (move-only `RefreshScreenPosition` excluded — scene rect is client-rel).
  - **#5/#8 (refuted, defensive):** StartSceneAnim degenerate fast-path now clears a prior anim.
  - **#12 (refuted, micro):** moved the bezier solve below the t≥1 branch (no wasted final solve).
  - **#13 (refuted, doc):** fixed the dispatcher `easing` comment.
  - Rebuilt Debug x64 clean; native harness re-confirmed **174/0**.

### Phase 2 — Live-tune + sign-off (NEEDS THE USER — L-033) — ✅ DONE
- [x] **User confirmed in the real host: "it is aligned. both directions seem good. even
      rapid toggle seems smooth. looks great."** No tuning needed — the back-dated clock +
      matched CSS-`ease` bezier aligned the edges on the first try (no residual jitter to
      expose a phase mismatch). No `phaseBiasMs` knob required.
- [x] **Removed BOTH `[STUTTER-PROBE]` blocks** (BridgeDispatcher arrival + LayoutBroker
      anim-start); grep confirms none remain in `src/`.
- [x] Final gate: web **537/0**, `tsc -b` 0, host Debug x64 clean; native harness **174/0**.
- [ ] Commit Item 3; open PR (own-PR per spec; strategy + master-gate = user's call).
      Backfill the CHANGELOG `TODO` hash/PR once merged.

### Phase 2 — Live-tune + sign-off (NEEDS THE USER — L-033)
- [ ] User eyeballs **open AND close separately**: edge glides with the panel? moving
      seam? Tune the bezier / `msElapsedAtSend` phase bias live (host render can't judge
      animation timing — L-033).
- [ ] **`--legacy` smoke:** dock toggle unchanged (anim no-op).
- [ ] **Stress:** drag a splitter rapidly + rapid re-toggle mid-slide → **zero**
      clear-strip frames; host `[PERF]` no new spikes.
- [ ] **Remove the probe**; final gate (web 515+/0, tsc -b 0, native 174/0); land as its
      own PR.

### Risks (delta from spec §4 — only the build-specific ones)
1. **Clock phase residual.** `msElapsedAtSend` captures only the web-side delay, not
   the IPC transit (~16-33ms). The ease is slow at t≈0 so a small start-phase lag is the
   least visible; the authoritative 260ms send pins the rest. *Mitigation:* a tunable
   `phaseBiasMs` knob, dialed in live (Phase 2). Don't over-model on paper — the spec
   defers this to live tuning.
2. **`computeSceneRect` drift.** PanelLayout's `from`/`to` must equal ViewportSlot's
   scene-rect math byte-for-byte. *Mitigation:* one shared helper, both call it.
3. **Self-defense vs authoritative send.** If the authoritative send raced in before
   t≥1 it'd be dropped. *Mitigation:* 260ms cleanup > 200ms duration margin; verify.

## Progress

- [x] Item 1 — selected curve key (saturated + bigger + stronger shadow).
      **Rev 2 (user feedback):** unselected keys now carry NO shadow (only
      selected); select/deselect now ANIMATES (CSS `transition: r, filter` —
      no library needed; Chromium transitions the SVG `r` attr + `filter`).
      Code + tests done; live in host. **Pending user host-confirm.**
- [x] Item 4 — popover animation (centralized in OccludingPopover via a
      self-contained `popover-animate` CSS class — `animate-in` utilities are
      NOT in this build, agent's claim was wrong).
      **Rev 3 (FINAL — root cause nailed with real-input Playwright):** the
      user's press-shift (Background only, shifts while depressed, corrects on
      release) was **scale coupled to position**. The popover's entrance
      `scale` + `transform-origin` at the trigger corner + `align="end"`
      (right edge pinned) means ANY non-1 scale renders the popover offset; a
      press re-resolves the transform → snaps to full width (measured: rest
      stuck at `scale(0.95)`, rect 266px @ x1415; on press → 280px @ x1401,
      −14px). Secondary contributor: `.tb-btn:active{transform:scale(.96)}`
      scales the *trigger* (anchor), and a re-measure re-pins the menu to the
      moved edge (measured −7px). Background > Ground because its label is
      wider. **Fix (two parts):** (1) popover entrance+exit are now pure
      opacity fades — NO scale anywhere, so position can't couple to animation
      state; (2) `.tb-btn[data-state="open"]:active{transform:none}` holds the
      trigger anchor steady on the dismiss-press. Verified with real input:
      press → x 1401→1401, w 280→280, both transforms `none` (0px shift).
      **Gap named to user:** they asked for fade+zoom; the zoom is what caused
      the shift, so shipped a clean fade (offered to revisit shift-free motion).
      Live in host. **Pending confirm.**
- [x] Item 2 — modal instant via downscaled snapshot capture. `AlphaCompositor::
      CaptureSnapshotPng` now downscales the cropped backdrop to a ≤1024px long
      edge (GDI+ bilinear) before the PNG encode — the kept no-flash gate now
      waits on ~0.4MP instead of ~4.7MP, so encode+base64+IPC+decode (the
      dominant cost) drops ~11×. `CaptureSnapshotToFile` (--capture offline
      diff) left full-res. Added `[INSTANT-MODAL]` debug timing. Updated the
      the native tests that pinned snapshot dims to the source. Host Debug x64
      clean; native harness **174/0**. Maximize confirmed instant by user.
      **Rev 2 (user — windowed snappier too):** added a min-2× downscale
      (`kSnapshotDownscale`) on top of the 1024 cap, so sub-cap (windowed)
      captures also shed pixels (the cap alone left ≤1024px crops at native
      size — the user's 918px window encoded ~50ms unchanged). Now
      `target = min(1024, longEdge/2)`: maximize still 1024 (≈3.4× upscale,
      approved), windowed halves (2× upscale, gentler under blur, ~¼ the
      encode/IPC). Native tests re-baselined to the /2 dims (512×384, 400×300,
      800×450); harness **174/0**. `[INSTANT-MODAL]` log confirms the numbers.
      **User-confirmed** ("quite snappy"): windowed **~18 ms** (was ~50),
      maximized **~69 ms**. Residual maximized latency deferred to ROADMAP
      **[NT-10]** (StretchRect-before-readback the likely win) — user OK with
      it for now, flagged to triage later.
- [~] Item 3 — viewport stutter on dock slide (experimental, host). **Design:**
      `docs/superpowers/specs/2026-06-08-item3-viewport-stutter-design.md` (host-side
      time-interpolated viewport rect — the chosen approach over DComp-scale #4, which
      distorts geometry). Investigation workflow `wa0o0il6r` (root cause = multi-clock
      sampling, NOT a 1-frame clip lag — adversarial pass corrected that). Spec red-team
      workflow `w6v635b1y` (in flight). **Phase 0 DONE (diagnosis confirmed):** probe at
      BridgeDispatcher.cpp:919 over 17 user slides showed 16–30 distinct-integer-rect
      `scene-rect` msgs/slide, arrival Δt mean 13ms / stdev 20ms / gaps up to 109ms, with
      big width jumps (up to ~69px) after gaps — the irregular sampling, already CLUMPY on
      the emit side (validates time-interp over rAF-coalesce). Width-only (h const),
      from/to 658↔918 at the test window (grow=dock-close, shrink=dock-open). `[PERF]`
      frame-time not capturable via stderr (goes to host.log elsewhere) but continuous msg
      flow rules out a stall. NEXT: fold red-team verdict → Phase 1 build (web
      animate-scene-rect + host ViewportAnim render-loop interpolation + bezier). Probe is
      `#ifndef NDEBUG`, TEMPORARY — remove before sign-off.

## Review

### Item 3 (dock-slide viewport stutter) — shipped (pending PR/merge)
Built the host-side time-interpolated viewport rect end-to-end and signed off:
web **537/0** (+22 tests over 515), `tsc -b` 0, host Debug x64 clean, native harness
**174/0**, and the **user confirmed the visual in the real host** ("aligned … both
directions … rapid toggle smooth … looks great"). The edges aligned on the first
try — no easing/phase tuning needed.

**Approach delivered** (as designed, scope confirmed up front): web sends ONE
`animate-scene-rect` at the dock toggle (arch-C-gated, analytic `to`,
reduced-motion branch, RO-only suppression via a zustand signal, authoritative
260ms settle); the host interpolates the scene rect each render frame off a
back-dated QPC clock through a WebKit-style `UnitBezier` matched to CSS `ease`,
with `SetSceneRect` self-defense and a resize-cancel. Shared `lib/scene-rect.ts`
+ `lib/hosting-mode.ts` keep web/host geometry + the legacy gate in lockstep.

**What the adversarial reviews caught (and we fixed):**
- *Web (9 confirmed of 16):* a **MAJOR** regression my own suppression signal
  introduced — a rapid re-toggle cancelled the 260ms timer that was the signal's
  only clear, stranding it `true` and silencing ViewportSlot's RO indefinitely.
  Fixed by clearing the signal in the effect **teardown** (covers re-toggle +
  unmount + a pre-existing CSS-class stick), with a regression test. Plus:
  capture the dock width at the settle (not a mid-transition `offsetWidth`);
  exactly-one contract assertion; documented the constraint-reclamp deferral.
- *Host (1 confirmed of 14):* spec risk #4 (mid-anim resize) was unimplemented →
  added `CancelSceneAnim()` on a genuine size change only. Plus three defensive
  touches (degenerate-path clears a prior anim; no wasted final-frame bezier
  solve; doc accuracy). One agent ported the bezier to Python and confirmed it
  (CssEaseY(0.5)=0.8024, Newton always converges).

**L-022 paid off repeatedly:** the scout AND both reviews each surfaced
plausible-but-FALSE claims (a hallucinated CSS line number; "getSize() isn't
typed" — it is, `.d.ts:222`; the "1-frame clip lag" root cause; the "synchronous
flexGrow read"). Every one was caught by verifying against the actual code before
acting. The two adversarial verify passes also *refuted* 20 of 30 raised findings
with code citations — the skeptic pass isn't rubber-stamping.

**Deferred (documented, settle-corrected, acceptable):** the analytic `to` skips
the library's center-min/dock-max re-clamp + the percentage-vs-pixel
resize-while-closed divergence (a small end-of-slide snap at constraint
boundaries, pinned by the authoritative settle); first-ever-open uses the panel
min as the width fallback (sub-px snap, settle-corrected). Lessons: none new —
existing L-022 / L-033 reinforced.
