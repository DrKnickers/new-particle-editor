# Curve morph animation — sample-and-tween for structural changes (design)

*2026-06-11 · Part B of the two-part curve-editor effort (Part A, the
lock read-only fix, shipped #126 `75cbe6d`). Designed with the user in
session 37 (trigger/target/approach picked explicitly); the sampler
math and the interpolation-change morph were validated in a live spike
(in-chat widget, this session) before this spec was written.*

## Purpose

Every structural change to a curve currently snaps: add a key and the
line jumps to its new shape; delete, undo, paste, spinner-edit, switch
interpolation mode, or watch a locked follower re-mirror its master —
all instant. Ship one animation mechanism that makes the curve
**smoothly morph** from its old shape to its new shape on every
committed structural change, with key markers gliding to their new
positions, added keys popping in, and removed keys fading out.

Drag stays live (the drag preview already tracks the cursor — no
animation on top of it), and `prefers-reduced-motion` disables
everything.

## Decisions (user-approved, session 37 brainstorm)

| Question | Decision |
|---|---|
| When to animate | **All structural changes**: add key, delete key, paste, spinner edits, undo/redo, locked-follower re-mirror (master edited), **and interpolation-type change** (linear ↔ smooth ↔ step). |
| What animates | **Curve path morph + key pop**: the line tweens old shape → new shape; matched keys glide; added keys scale/fade in; removed keys fade out. |
| Mechanism | **① Sample-and-tween** (over keyed path-`d` interpolation and CSS cross-fade): sample old and new *rendered* curves at N uniform-x positions, interpolate per-sample over the morph duration, draw the in-flight shape as one dense polyline, snap to the real path elements at the end. One mechanism covers every trigger incl. interp-change, because it morphs the drawn shape, not the key data. |
| Tween space | **Projected pixel space** (capture old samples with the old value-range projection, new samples with the new) — auto-range growth (e.g. a Scale key pushed past the current max) then glides the whole canvas to its new scale for free, with no range-animation special case. |
| Sequencing | Part B ships as its own PR after Part A (#126, merged). |

## Spike results (this session — feeds §3 risks)

A live widget reproduced the exact mechanism with the exact legacy
math. Findings:

1. **The legacy smooth curve has a closed-form simplification.** The
   control-point formula ([`buildSmoothPath`](../../web/apps/editor/src/screens/CurveEditor.tsx)
   ≈ line 246: cps at ¼/¾ horizontal, cp1y=p1.y, cp2y=p2.y) reduces to
   `x(t) = x₁ + dx·(0.75t + 0.75t² − 0.5t³)` (strictly monotonic —
   dx/dt ≥ 0.75 everywhere) and `y(t) = y₁ + (y₂−y₁)·(3t² − 2t³)` —
   **exactly smoothstep**. Uniform-x sampling is therefore one Newton
   inversion of a *fixed* cubic (identical polynomial for every
   segment of every curve; converges in ≤ 4 iterations from seed
   t≈u) followed by a smoothstep lerp. No generic Bézier machinery.
2. **Cost is trivial**: 160 samples × 4 Newton iterations ≈ 640
   arithmetic evaluations per morphing channel per *morph start* (the
   per-frame work is a plain lerp over the two cached arrays).
3. **Interp-change morphs are well-defined**: both shapes sample onto
   the same uniform-x grid, so step↔smooth↔linear tween point-for-
   point with no lateral swimming. Step discontinuities render as
   near-vertical segments during the morph (1/160 of width) and snap
   to true verticals at the end.
4. **Interruption folding works** by construction: each new morph
   starts `from = the currently displayed samples`, so rapid repeated
   edits (spinner arrows) chain smoothly instead of restarting from a
   stale shape. (Same principle as the emitter-tree FLIP's
   fold-the-residual rule.)
5. **Aesthetic verdict** — the user reviews the spike widget; the
   morph durations/easing in this spec (180 ms ease-out) are the
   spike's values and remain feel-tunable at the host pass.

## §1 What the codebase already gives us

- **The path builders** (`buildSmoothPath`, `buildStepPolyline`,
  linear inline, `buildFillPath`) in
  [`CurveEditor.tsx`](../../web/apps/editor/src/screens/CurveEditor.tsx)
  — the sampler reimplements their *evaluation* (not their string
  output) and must stay formula-identical (the smoothstep identity
  above is derived from, and documented against, `buildSmoothPath`).
- **`lib/flip.ts`** — the FLIP helper used by the emitter tree
  (transform old→new + interruption residual folding). The marker
  glide reuses its pattern (not necessarily its code — markers are SVG
  circles driven by the same rAF loop as the line, see §2).
- **`lib/use-presence.ts`** — mount-through-exit precedent (removed-key
  ghosts follow its "timeout fallback so reduced-motion can't leak"
  rule).
- **`prefers-reduced-motion` plumbing** — `components.css` guards +
  the `matchMedia` idiom in `PanelLayout.tsx`/`EmitterTree.tsx`.
- **The refetch pipeline**: every committed mutation fires
  `tree/changed` → the panel re-fetches tracks → `MultiChannelCurves`
  receives a new `tracks` prop. The morph engine's *only* input is
  consecutive prop values — no new events, no bridge changes.
- **Part A's locked-curve treatment** (`focusReadOnly`,
  `READONLY_DASH`) — locked followers are first-class morph targets
  (the re-mirror trigger); the morph polyline must carry the same
  dasharray when the channel is read-only.
- **`dragRef`** in `MultiChannelCurves` — the morph engine reads it to
  suppress morphs while a drag is in flight, and the drag-commit
  bookkeeping (see §2.4) hangs off the existing pointer-up path.

## §2 Architecture

New pure module + one hook + renderer integration. No native, bridge,
or schema changes.

### 2.1 `lib/curve-morph.ts` (pure functions — the testable core)

```ts
/** Evaluate a track's rendered y at time x (data space). Formula-
 *  identical to the path builders: smooth = Newton-inverted fixed
 *  cubic + smoothstep (see the derivation comment); step = left key's
 *  value; linear = lerp. Clamps outside the key range to the border
 *  keys' values (matching how the drawn path starts/ends at them). */
export function sampleTrackY(
  keys: ReadonlyArray<{ time: number; value: number }>,
  interp: InterpolationType,
  x: number,
): number;

/** Sample a track into N+1 uniform-x PIXEL-space points using the
 *  given projection (time range + value range + canvas size). */
export function sampleTrackPx(
  track: TrackDto,
  proj: { timeMin: number; timeMax: number; vMin: number; vMax: number; width: number; height: number },
  n: number,
): Float64Array; // y per sample; x is implicit (i/n * width)

/** Classify the change between two consecutive TrackDto snapshots.
 *  "none"   — identical keys + interpolation (no morph)
 *  "moved"  — same key count & times within EPS, ≥1 value differs,
 *             same interp (candidate for drag-commit suppression)
 *  "structural" — anything else (count/time/interp/lockedTo change)
 */
export function classifyTrackChange(prev: TrackDto, next: TrackDto):
  "none" | "moved" | "structural";

/** Match keys old→new by time (EPS) for the marker choreography.
 *  Returns moved pairs, added keys, removed keys. */
export function matchKeys(prev: TrackDto, next: TrackDto): {
  moved: Array<{ from: Key; to: Key }>;
  added: Key[];
  removed: Key[];
};
```

Constants in the same file: `MORPH_MS = 180` (ease-out cubic),
`KEY_POP_MS = 150`, `MORPH_SAMPLES = 160`, `KEY_MATCH_EPS = 1e-4` —
all feel-tunable, documented as such.

### 2.2 `useCurveMorph` (hook inside `CurveEditor.tsx`, used by `MultiChannelCurves`)

Input per render: the projected `layers` (channel, track, points,
range), the canvas projection, `dragRef`, and the drag-commit
suppression ref (§2.4). Behaviour:

- Keeps the previous render's per-channel `{ track, proj, samples }`
  in a ref. On each render, classifies each visible channel.
- **Gate**: morphs run only when
  `typeof window.matchMedia === "function" &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches`.
  jsdom has no `matchMedia`, so **the entire existing test suite sees
  snap behaviour unchanged by default** — morph tests opt in by
  stubbing it. Reduced-motion users get snaps, per policy.
- A channel with a `"structural"` change (or an unsuppressed
  `"moved"`) starts/retargets a morph: `from = currently displayed
  samples` (interruption folding), `to = new samples`. Old samples
  are captured with the OLD projection, new with the NEW (pixel-space
  decision) — a value-range change morphs the whole canvas coherently.
- One shared `requestAnimationFrame` loop serves all morphing
  channels. Per frame it lerps each channel's sample array and writes
  attributes **directly via refs** (`polyline.points`, fill-path `d`,
  marker `cx/cy/r/fill-opacity`) — React re-renders only at morph
  start and end (2 renders), matching the codebase's direct-DOM-write
  animation idiom (FLIP, dock anim), not per-frame setState.
- While a channel morphs, React renders a **morph overlay** for it:
  one dense `<polyline data-testid="curve-morph-line">` (+ fill path)
  in the channel's colour/stroke-width/opacity/dasharray (locked
  followers keep `READONLY_DASH`), and the channel's static
  curve/fill elements are hidden (`visibility: hidden`, so layout and
  test queries by testid still resolve them). At morph end the
  overlay unmounts and the static elements (already rendered at the
  final shape) reappear — the snap-to-truth step.
- **Markers** (focus channel only; non-focus channels' 3 px dots snap
  with their layer — visually negligible and not worth the ghost
  bookkeeping): moved keys glide
  (positions driven per-frame), added keys grow `r` 0→full +
  fade-in over `KEY_POP_MS`, removed keys render as **ghost circles**
  in the overlay fading out (`use-presence`-style: removed from data,
  kept by the morph state until the morph ends). The hit-pad circles
  are NOT duplicated — interaction stays on the static (hidden ≠
  removed) circles; a mid-morph click commits against the final state,
  which is the state the user sees the curve approaching. (Hidden
  elements still hit-test in SVG only with `pointer-events` set;
  `visibility:hidden` disables hit-testing — so during the ≤180 ms
  morph, key interaction is briefly unavailable. Accepted: shorter
  than a human reaction to the new shape.)
- Morph end: cancel rAF, drop overlay state, clear ghosts. A
  `setTimeout(MORPH_MS + 50)` fallback (use-presence rule) guarantees
  cleanup if rAF is throttled/stopped.

### 2.3 What does NOT morph

- **Live drags**: while `dragRef.current !== null`, all classification
  is deferred (snapshot updates, no morph starts) — the drag preview
  owns the visuals.
- **Canvas resize / measured-viewBox change mid-morph**: abort to snap
  (recapturing projections mid-flight isn't worth it; resize during a
  morph is a sub-200 ms coincidence).
- **Selection/focus changes**: switching `focusChannel` re-renders
  emphasis instantly (no morph — same data, different styling).
  Toggling a channel's visibility mounts/unmounts its layer instantly
  (out of scope; a fade is a separate nicety).

### 2.4 Drag-commit suppression (the double-animation trap)

After a drag commits, `tree/changed` re-delivers the tracks — but the
dragged channel's curve is ALREADY at the new shape (the preview
tracked the cursor). Without suppression, the morph engine would see
old-props → new-props and visibly re-glide the curve from its pre-drag
shape. Rule:

- On drag commit (`onPointerUp` with `moved`, in `MultiChannelCurves`
  — the same place `dragConsumedClickRef` is set), record
  `{ channelId, keyTime → newTime/newValue }` in a suppression ref.
- When the next props arrive, if a channel's change classifies as
  `"moved"`/`"structural"` AND matches the recorded single-key move
  within EPS, **snap** that channel (update snapshots, no morph) and
  clear the ref.
- Locked followers of the dragged master are NOT in the ref → they
  morph (correct: their curves never previewed).
- Group drags record the full set of moved keys; same matching rule.

Spinner edits, paste, undo/redo, interp clicks have no preview — they
morph, with interruption folding absorbing rapid repeats.

## §3 Risks + mitigations

1. **A mid-morph frame breaks the existing 717-test suite.** The morph
   overlay hides the static path/markers — a test asserting
   `curve-path` attributes mid-morph would flake. *Mitigation:* the
   `matchMedia` gate — jsdom lacks `matchMedia`, so every existing
   test runs in snap mode untouched; morph tests explicitly stub
   `window.matchMedia` (and use fake timers / the rAF stub idiom from
   the FLIP tests). This is the single load-bearing test-stability
   decision.
2. **Interp-change morph reads as a writhing blob** (the aesthetic
   risk that motivated the spike). *Mitigation:* the spike showed
   point-for-point tweening on the shared x-grid (no swimming); final
   verdict is the user's at the spike widget + host feel pass. Escape
   hatch if the host verdict differs: classify interp-only changes
   separately and cross-fade just that case (~20 lines) — the
   architecture isolates the decision in `classifyTrackChange`.
3. **Drag-commit double-animation** (§2.4). *Mitigation:* the
   suppression ref + `"moved"` matching; a test drags, commits,
   delivers the refetch, and asserts no morph overlay mounts for the
   dragged channel while a locked follower's overlay DOES mount.
4. **Sampler drift from the real path builders.** If `sampleTrackY`
   disagrees with `buildSmoothPath`'s rendered geometry, the morph
   visibly "settles" at the end. *Mitigation:* a property test
   samples random keys, builds the real `d` string path, evaluates it
   at the sample x's (parse the bezier segments and evaluate — or
   cheaper: assert `sampleTrackY` at segment endpoints + midpoints
   against closed-form expectations incl. the smoothstep identity);
   plus the end-of-morph snap to the REAL elements bounds any residual
   error to ≤ 180 ms of visibility.
5. **Performance: 7 channels morphing at 60 fps.** Per frame worst
   case ≈ 7 × 160 lerps + attribute string builds. *Mitigation:*
   numbers from the spike say this is trivial; direct ref writes avoid
   React; if string building ever shows up in a profile, halve
   `MORPH_SAMPLES` for non-focus channels. Not worth pre-optimizing.
6. **Rapid structural changes mid-morph** (undo spam, spinner
   auto-repeat). *Mitigation:* interruption folding (from = displayed
   samples) is the designed-in behaviour, validated in the spike;
   marker choreography re-matches against the new target each retarget
   (ghosts of ghosts collapse: a removed-then-restored key simply
   re-matches as moved).
7. **The brief interaction blackout during a morph** (visibility:
   hidden disables SVG hit-testing on the static circles). *Accepted:*
   ≤ 180 ms, shorter than the visual settling the user is watching
   anyway; pointer-down on the backdrop (marquee/insert) is unaffected
   (the backdrop never hides).

## §4 Testing & verification

Vitest, `lib/__tests__/curve-morph.test.ts` (pure — the bulk):

- `sampleTrackY`: linear exactness; step plateaus (left-value
  semantics incl. exactly-at-key); smooth hits key values at key
  times, midpoint matches the smoothstep identity, monotonic-x Newton
  converges for adversarial segment widths (tiny dx, huge dx); clamp
  outside borders.
- `classifyTrackChange`: none/moved/structural across each trigger
  (add, delete, time move, value move, interp flip, lockedTo flip).
- `matchKeys`: moved/added/removed partitions; EPS boundary.

Renderer (`CurveEditor.test.tsx`, with `matchMedia` stubbed + fake
rAF/timers per the FLIP-test idiom):

- Structural change → `curve-morph-line` overlay mounts in the
  channel colour (and `READONLY_DASH` for a locked follower), static
  path hidden; after the duration elapses → overlay gone, static path
  visible with the final geometry.
- Locked-follower re-mirror morphs (master edit on Red → Green's
  overlay mounts) — the headline mirror case.
- Drag-commit suppression (risk 3's test).
- Interruption: second structural change mid-morph retargets without
  unmounting (overlay persists, no snap-to-old flash).
- Reduced-motion / no-matchMedia → no overlay ever mounts (one
  explicit test; the other 717 tests prove it implicitly).
- Added-key pop + removed-key ghost: marker counts during/after.

Suites & gates: full web run, `tsc -b` 0, vite build clean; native
harness (a11y goldens must not drift — morphs never run in the
harness absent matchMedia stubs... **verify the WebView2 host DOES
have matchMedia** — it does (Chromium), so the harness's live-host
specs could see morphs: any spec asserting curve geometry right after
a mutation must `waitFor` the settled state or the harness must set
reduced-motion; check `captureDomA11y`'s existing tooltip-settle
precedent and extend it to `curve-morph-line` absence if needed);
host Debug x64 build.

User feel pass (L-033 — user-launched): add/delete keys on a real
emitter; interp switches on dense and sparse curves; spinner
auto-repeat; undo/redo chains; the locked-follower glide while
editing Red; a drag commit (no double-glide); reduced-motion OS
setting; both themes.

## §5 Out of scope

- **Single-track legacy `CurveEditor` branch** — not the production
  surface; untouched.
- **Channel-visibility fade in/out** (checkbox toggles) — separate
  nicety if anyone asks.
- **Axis-label / displayRange text animation** — labels snap; only
  the curve glides (pixel-space tweening makes the geometry coherent
  regardless).
- **Animating the single-track demo routes** — same mechanism would
  apply; do it only if a demo needs it.
- **Morphing on initial mount / emitter switch** — first render of a
  selection snaps (morphing from nothing is noise); emitter switches
  replace the whole dataset and snap.
