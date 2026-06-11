# Curve Morph Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **L-081 applies:** one tree-touching agent at a time; reviewers read-and-run-tests only.

**Goal:** Every committed structural curve change (add/delete/paste/spinner/undo/interp-change/locked-follower re-mirror) smoothly morphs the curve from its old shape to its new shape, with matched keys gliding, added keys popping in, removed keys fading out; drags stay live; reduced-motion disables everything.

**Architecture:** A pure sampling core (`lib/curve-morph.ts`: uniform-x + key-time-augmented grid, Newton-inverted fixed cubic + smoothstep for the legacy smooth curve) feeds a `useCurveMorph` hook that diffs consecutive `tracks` props per channel, tweens sample arrays in projected pixel space over 180 ms via one shared rAF loop, and draws into an imperatively-owned SVG overlay group per morphing channel (React mounts/unmounts the group; every frame is direct DOM writes — the FLIP/dock-anim idiom). Static curve elements hide (`visibility:hidden`) during a channel's morph and reappear at the end (snap-to-truth). Morphs are gated on `window.matchMedia` existing AND reduced-motion off — jsdom lacks `matchMedia`, so the entire existing web suite runs in snap mode untouched.

**Tech Stack:** React 18 + TypeScript, SVG, Vitest + Testing Library. No native/bridge/schema changes (one harness-helper tweak in `captureDomA11y`).

**Spec:** [`docs/superpowers/specs/2026-06-11-curve-morph-animation-design.md`](../specs/2026-06-11-curve-morph-animation-design.md)

**Verified code facts** (re-verify if the tree moved past `e0d7c56`):
- `MultiChannelCurves` in `web/apps/editor/src/screens/CurveEditor.tsx` builds `layers` (~:1170-1190): `{ channel, track, points, range }[]`; canvas projection = `displayRange ?? focusRange` for the focus channel's pointer math, but EACH layer projects with `displayRange ?? valueRangeForTrack(t)` (`projY`, ~:1175). The morph must reuse the per-layer `projY`.
- Focus layer renders in an IIFE `<g data-focus="true">` (~:1795+); background layers in a map above it. Both need the hide-while-morphing style.
- Drag commit site: the multi-channel `onPointerUp` drag branch (search `dragConsumedClickRef.current = true`) — the suppression ref is recorded there.
- The legacy smooth formula (`buildSmoothPath` ~:246) reduces to `x(t)=x₁+dx·(0.75t+0.75t²−0.5t³)` (monotonic, dx/dt≥0.75) and `y = y₁+(y₂−y₁)·(3t²−2t³)` (smoothstep) — derived + spike-validated.
- matchMedia stub idiom: `PanelLayout.dock-anim.test.tsx:166-198` (`Object.defineProperty(window, "matchMedia", { configurable: true, value: ... })`, restored in afterEach).
- jsdom provides `requestAnimationFrame` (timer-backed); morph tests use REAL timers + `waitFor` (a 180 ms morph settles well inside waitFor's default 1 s).
- Native specs assert via Playwright auto-retrying matchers (5 s timeouts) — a 180 ms morph settles inside the retry window. The only sync snapshotter is `captureDomA11y` (a11y goldens), which already settles tooltip exits (NT-12); Task 5 extends it.
- Classification deviates from the spec's sketch in one refined way: `lockedTo` alone (no key/interp delta) does NOT classify as structural — it's styling, not shape; a re-mirror always arrives as key changes anyway. Record this in the lib's doc comment.

---

## File structure

| File | Responsibility |
|---|---|
| Create `web/apps/editor/src/lib/curve-morph.ts` | Pure core: constants, easing, `sampleTrackY`, `buildMorphGrid`, `sampleTrackPx`, `resampleOntoGrid`, `classifyTrackChange`, `matchKeys`. Zero DOM/React. |
| Create `web/apps/editor/src/lib/__tests__/curve-morph.test.ts` | Pure-core tests (the bulk of coverage). |
| Create `web/apps/editor/src/lib/use-curve-morph.ts` | The hook: per-channel diffing, morph jobs, shared rAF loop, imperative overlay drawing, marker choreography, suppression/drag-defer/gating. |
| Modify `web/apps/editor/src/screens/CurveEditor.tsx` | `MultiChannelCurves` integration: feed the hook, render overlay groups, hide static layers, record drag-commit suppression. |
| Modify `web/apps/editor/src/screens/__tests__/CurveEditor.test.tsx` | Renderer morph tests (matchMedia stubbed). |
| Modify `web/apps/editor/tests/helpers/...` (locate `captureDomA11y`) | Settle on no `[data-testid="curve-morph-overlay"]` before golden capture. |

---

### Task 1: Pure core — `lib/curve-morph.ts`

**Files:**
- Create: `web/apps/editor/src/lib/curve-morph.ts`
- Test: `web/apps/editor/src/lib/__tests__/curve-morph.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import type { TrackDto } from "@particle-editor/bridge-schema";
import {
  sampleTrackY, buildMorphGrid, sampleTrackPx, resampleOntoGrid,
  classifyTrackChange, matchKeys, easeOutCubic,
  MORPH_MS, KEY_MATCH_EPS,
} from "../curve-morph";

const track = (
  keys: Array<{ time: number; value: number }>,
  interpolation: TrackDto["interpolation"] = "linear",
  lockedTo: TrackDto["lockedTo"] = null,
): TrackDto => ({ name: "red", keys, interpolation, lockedTo });

describe("sampleTrackY", () => {
  const keys = [{ time: 0, value: 0 }, { time: 50, value: 1 }, { time: 100, value: 0.5 }];

  it("linear: exact lerp", () => {
    expect(sampleTrackY(keys, "linear", 25)).toBeCloseTo(0.5, 10);
    expect(sampleTrackY(keys, "linear", 75)).toBeCloseTo(0.75, 10);
  });

  it("step: left-key plateau, including exactly at a key", () => {
    expect(sampleTrackY(keys, "step", 49.999)).toBe(0);
    expect(sampleTrackY(keys, "step", 50)).toBe(1);     // at the key, the key's own value
    expect(sampleTrackY(keys, "step", 50.001)).toBe(1);
  });

  it("smooth: hits key values at key times; midpoint matches the smoothstep identity", () => {
    expect(sampleTrackY(keys, "smooth", 0)).toBeCloseTo(0, 10);
    expect(sampleTrackY(keys, "smooth", 50)).toBeCloseTo(1, 10);
    // x-midpoint of segment: u=0.5 → t solves 0.75t+0.75t²-0.5t³=0.5 → t=0.5
    // (check: 0.375+0.1875-0.0625 = 0.5) → y = smoothstep(0,1,0.5) = 0.5
    expect(sampleTrackY(keys, "smooth", 25)).toBeCloseTo(0.5, 6);
  });

  it("smooth: Newton converges on adversarial segment widths", () => {
    const tiny = [{ time: 0, value: 0 }, { time: 1e-3, value: 1 }, { time: 100, value: 0 }];
    for (const x of [0, 2.5e-4, 5e-4, 1e-3, 50, 99.9]) {
      const y = sampleTrackY(tiny, "smooth", x);
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("clamps outside the border keys", () => {
    expect(sampleTrackY(keys, "smooth", -10)).toBe(0);
    expect(sampleTrackY(keys, "smooth", 200)).toBe(0.5);
  });
});

describe("buildMorphGrid", () => {
  it("contains uniform samples plus epsilon pairs around every key time of both tracks, sorted, within range", () => {
    const a = track([{ time: 0, value: 0 }, { time: 30, value: 1 }, { time: 100, value: 0 }]);
    const b = track([{ time: 0, value: 0 }, { time: 62, value: 1 }, { time: 100, value: 0 }]);
    const g = buildMorphGrid(a, b, 0, 100, 160);
    expect(g.length).toBeGreaterThanOrEqual(161);
    for (let i = 1; i < g.length; i++) expect(g[i]!).toBeGreaterThanOrEqual(g[i - 1]!);
    expect(g[0]).toBe(0);
    expect(g[g.length - 1]).toBe(100);
    // epsilon pair straddles each interior key time
    const has = (x: number) => Array.from(g).some((v) => Math.abs(v - x) < 1e-9);
    const below30 = Array.from(g).some((v) => v < 30 && 30 - v < 1e-3);
    const above30 = Array.from(g).some((v) => v > 30 && v - 30 < 1e-3);
    expect(below30 && above30).toBe(true);
    const below62 = Array.from(g).some((v) => v < 62 && 62 - v < 1e-3);
    const above62 = Array.from(g).some((v) => v > 62 && v - 62 < 1e-3);
    expect(below62 && above62).toBe(true);
    expect(has(0)).toBe(true);
  });

  it("step jump renders as a true vertical: the epsilon pair samples both plateau values", () => {
    const s = track([{ time: 0, value: 0 }, { time: 50, value: 1 }, { time: 100, value: 1 }], "step");
    const g = buildMorphGrid(s, s, 0, 100, 160);
    const ys = sampleTrackPx(s, g, { vMin: 0, vMax: 1, height: 100 });
    // find the epsilon pair around 50: y jumps from 100 (v=0 → bottom) to 0 (v=1 → top)
    let jumped = false;
    for (let i = 1; i < g.length; i++) {
      if (g[i]! > 49.9 && g[i]! < 50.1 && Math.abs(ys[i]! - ys[i - 1]!) > 99) jumped = true;
    }
    expect(jumped).toBe(true);
  });
});

describe("sampleTrackPx / resampleOntoGrid", () => {
  it("projects with y-inversion (bigger value = smaller pixel y)", () => {
    const t = track([{ time: 0, value: 0 }, { time: 100, value: 1 }]);
    const g = buildMorphGrid(t, t, 0, 100, 4);
    const ys = sampleTrackPx(t, g, { vMin: 0, vMax: 1, height: 300 });
    expect(ys[0]).toBeCloseTo(300, 6);
    expect(ys[ys.length - 1]).toBeCloseTo(0, 6);
  });

  it("resampleOntoGrid: linear interpolation of a displayed polyline onto a new grid", () => {
    const xs = new Float64Array([0, 50, 100]);
    const ys = new Float64Array([0, 100, 0]);
    const out = resampleOntoGrid(xs, ys, new Float64Array([0, 25, 50, 75, 100]));
    expect(Array.from(out)).toEqual([0, 50, 100, 50, 0]);
  });
});

describe("classifyTrackChange", () => {
  const base = track([{ time: 0, value: 0 }, { time: 50, value: 0.5 }, { time: 100, value: 1 }]);
  it("none for identical", () => {
    expect(classifyTrackChange(base, track(base.keys.map((k) => ({ ...k }))))).toBe("none");
  });
  it("moved for value-only deltas", () => {
    const next = track([{ time: 0, value: 0 }, { time: 50, value: 0.9 }, { time: 100, value: 1 }]);
    expect(classifyTrackChange(base, next)).toBe("moved");
  });
  it("structural for add / delete / time-move / interp flip", () => {
    expect(classifyTrackChange(base, track([...base.keys, { time: 75, value: 0.2 }]
      .sort((a, b) => a.time - b.time)))).toBe("structural");
    expect(classifyTrackChange(base, track([base.keys[0]!, base.keys[2]!]))).toBe("structural");
    expect(classifyTrackChange(base, track([{ time: 0, value: 0 }, { time: 60, value: 0.5 }, { time: 100, value: 1 }]))).toBe("structural");
    expect(classifyTrackChange(base, track(base.keys, "step"))).toBe("structural");
  });
  it("lockedTo alone is NOT a shape change", () => {
    expect(classifyTrackChange(base, track(base.keys, "linear", "red"))).toBe("none");
  });
});

describe("matchKeys", () => {
  it("partitions moved/added/removed by time within EPS", () => {
    const prev = track([{ time: 0, value: 0 }, { time: 50, value: 0.5 }, { time: 100, value: 1 }]);
    const next = track([{ time: 0, value: 0.2 }, { time: 75, value: 0.9 }, { time: 100, value: 1 }]);
    const m = matchKeys(prev, next);
    expect(m.moved.map((p) => p.to.time)).toEqual([0, 100]);
    expect(m.added.map((k) => k.time)).toEqual([75]);
    expect(m.removed.map((k) => k.time)).toEqual([50]);
  });
});

describe("easing/constants", () => {
  it("easeOutCubic endpoints + monotonic", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
  it("exports the tunables", () => {
    expect(MORPH_MS).toBeGreaterThan(0);
    expect(KEY_MATCH_EPS).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run from `web/`: `pnpm --filter @particle-editor/editor test -- --run curve-morph`
Expected: FAIL — module not found. Capture the exit code explicitly (L-080).

- [ ] **Step 3: Implement `lib/curve-morph.ts`**

```ts
// curve-morph — pure sampling/diffing core for the curve morph
// animation (Part B). See the spec:
// docs/superpowers/specs/2026-06-11-curve-morph-animation-design.md
//
// The legacy smooth curve (buildSmoothPath, CurveEditor.tsx: control
// points at 1/4 and 3/4 horizontal, cp1y=p1.y, cp2y=p2.y) reduces to
//   x(t) = x1 + dx * (0.75t + 0.75t^2 - 0.5t^3)   (monotonic: x' >= 0.75)
//   y(t) = y1 + (y2 - y1) * (3t^2 - 2t^3)          (exactly smoothstep)
// so uniform-x evaluation is one Newton inversion of a FIXED cubic
// (identical for every segment) followed by a smoothstep lerp.

import type { InterpolationType, TrackDto } from "@particle-editor/bridge-schema";

export type Key = { time: number; value: number };

/** Morph duration / easing tier. Feel-tunable (host pass). */
export const MORPH_MS = 180;
export const KEY_POP_MS = 150;
export const MORPH_SAMPLES = 160;
/** Key times closer than this are "the same key" (matches the
 *  drag-clamp epsilon order of magnitude used by the renderer). */
export const KEY_MATCH_EPS = 1e-4;

export function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

/** Invert u = 0.75t + 0.75t^2 - 0.5t^3 on [0,1] (Newton, seed t=u;
 *  derivative >= 0.75 so 4 iterations are ample). */
function tForU(u: number): number {
  let t = u;
  for (let i = 0; i < 4; i++) {
    const f = 0.75 * t + 0.75 * t * t - 0.5 * t * t * t - u;
    const d = 0.75 + 1.5 * t - 1.5 * t * t;
    t -= f / d;
  }
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Evaluate the track's RENDERED y (data space) at time x. Formula-
 *  identical to the path builders; clamps outside the border keys.
 *  Step: left key's value; exactly at a key, the key's own value. */
export function sampleTrackY(
  keys: ReadonlyArray<Key>,
  interp: InterpolationType,
  x: number,
): number {
  if (keys.length === 0) return 0;
  if (x <= keys[0]!.time) return keys[0]!.value;
  const last = keys[keys.length - 1]!;
  if (x >= last.time) return last.value;
  let i = 0;
  while (keys[i + 1]!.time <= x) i++;
  const a = keys[i]!;
  const b = keys[i + 1]!;
  if (interp === "step") return a.value;
  const u = (x - a.time) / (b.time - a.time);
  if (interp === "linear") return a.value + (b.value - a.value) * u;
  const t = tForU(u);
  return a.value + (b.value - a.value) * (3 * t * t - 2 * t * t * t);
}

/** Shared x-grid for a (prev, next) morph pair: N+1 uniform samples
 *  UNION an epsilon pair (t-eps, t+eps) around every key time of BOTH
 *  key sets — step discontinuities render as true verticals mid-morph
 *  (user requirement); continuous shapes sample equal y at both, so
 *  the extra points are harmless. Sorted ascending, clamped to range. */
export function buildMorphGrid(
  prev: TrackDto,
  next: TrackDto,
  timeMin: number,
  timeMax: number,
  n: number = MORPH_SAMPLES,
): Float64Array {
  const range = timeMax - timeMin;
  const eps = range * 1e-6;
  const xs: number[] = [];
  for (let i = 0; i <= n; i++) xs.push(timeMin + (i / n) * range);
  for (const k of [...prev.keys, ...next.keys]) {
    if (k.time > timeMin && k.time < timeMax) {
      xs.push(k.time - eps, k.time, k.time + eps);
    }
  }
  xs.sort((a, b) => a - b);
  return Float64Array.from(xs);
}

/** Sample pixel-space y at each grid x (y-inverted: larger value =
 *  smaller pixel y), using the channel's OWN projection. */
export function sampleTrackPx(
  track: TrackDto,
  gridX: Float64Array,
  proj: { vMin: number; vMax: number; height: number },
): Float64Array {
  const { vMin, vMax, height } = proj;
  const span = vMax - vMin;
  const out = new Float64Array(gridX.length);
  for (let i = 0; i < gridX.length; i++) {
    const v = sampleTrackY(track.keys, track.interpolation, gridX[i]!);
    const tnorm = span > 0 ? (v - vMin) / span : 0;
    out[i] = height - Math.max(0, Math.min(1, tnorm)) * height;
  }
  return out;
}

/** Linear-resample a displayed piecewise-linear polyline (xsOld, ysOld)
 *  onto a new grid — interruption folding across grid changes. */
export function resampleOntoGrid(
  xsOld: Float64Array,
  ysOld: Float64Array,
  xsNew: Float64Array,
): Float64Array {
  const out = new Float64Array(xsNew.length);
  let j = 0;
  for (let i = 0; i < xsNew.length; i++) {
    const x = xsNew[i]!;
    while (j < xsOld.length - 2 && xsOld[j + 1]! < x) j++;
    const x0 = xsOld[j]!;
    const x1 = xsOld[j + 1]!;
    const y0 = ysOld[j]!;
    const y1 = ysOld[j + 1]!;
    out[i] = x1 > x0
      ? y0 + ((y1 - y0) * Math.max(0, Math.min(1, (x - x0) / (x1 - x0))))
      : y0;
  }
  return out;
}

/** Shape-change classification between consecutive TrackDto snapshots.
 *  NOTE (spec refinement): lockedTo is deliberately IGNORED — it is
 *  styling, not shape; a re-mirror always arrives as key deltas.
 *    "none"       identical keys + interpolation
 *    "moved"      same count & times (EPS), >=1 value differs
 *    "structural" anything else (count / time / interp) */
export function classifyTrackChange(
  prev: TrackDto,
  next: TrackDto,
): "none" | "moved" | "structural" {
  if (prev.interpolation !== next.interpolation) return "structural";
  if (prev.keys.length !== next.keys.length) return "structural";
  let moved = false;
  for (let i = 0; i < prev.keys.length; i++) {
    const a = prev.keys[i]!;
    const b = next.keys[i]!;
    if (Math.abs(a.time - b.time) > KEY_MATCH_EPS) return "structural";
    if (Math.abs(a.value - b.value) > KEY_MATCH_EPS) moved = true;
  }
  return moved ? "moved" : "none";
}

/** Match keys old->new by time (EPS) for the marker choreography. */
export function matchKeys(prev: TrackDto, next: TrackDto): {
  moved: Array<{ from: Key; to: Key }>;
  added: Key[];
  removed: Key[];
} {
  const moved: Array<{ from: Key; to: Key }> = [];
  const added: Key[] = [];
  const usedPrev = new Set<number>();
  for (const k of next.keys) {
    const idx = prev.keys.findIndex(
      (p, i) => !usedPrev.has(i) && Math.abs(p.time - k.time) <= KEY_MATCH_EPS,
    );
    if (idx >= 0) {
      usedPrev.add(idx);
      moved.push({ from: prev.keys[idx]!, to: k });
    } else {
      added.push(k);
    }
  }
  const removed = prev.keys.filter((_, i) => !usedPrev.has(i));
  return { moved, added, removed };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @particle-editor/editor test -- --run curve-morph` → all green; then `pnpm --filter @particle-editor/editor exec tsc -b` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add web/apps/editor/src/lib/curve-morph.ts web/apps/editor/src/lib/__tests__/curve-morph.test.ts
git commit -m "feat(curve-morph): pure sampling/diffing core (Newton-smoothstep sampler, augmented grid, classifier)"
```

---

### Task 2: `useCurveMorph` hook + line/fill morph integration

**Files:**
- Create: `web/apps/editor/src/lib/use-curve-morph.ts`
- Modify: `web/apps/editor/src/screens/CurveEditor.tsx` (`MultiChannelCurves`)
- Test: `web/apps/editor/src/screens/__tests__/CurveEditor.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add a `describe("curve morph (structural changes)")` to `CurveEditor.test.tsx`. Shared scaffolding: a matchMedia stub (copy the `PanelLayout.dock-anim.test.tsx:166-198` idiom; `matches: false` for the reduce query so morphs RUN), restored in `afterEach`. Tests rerender the multi-channel `<CurveEditor>` with changed `tracks` and use REAL timers + `waitFor`.

```tsx
it("mounts a morph overlay on a structural change, hides the static curve, then settles", async () => {
  const t0 = [trk("red", [k(0, 0), k(100, 1)], "linear")];
  const { rerender, container } = render(mcCurve(t0, "red"));
  const t1 = [trk("red", [k(0, 0), k(50, 0.9), k(100, 1)], "linear")];
  rerender(mcCurve(t1, "red"));
  const overlay = await waitFor(() => {
    const el = container.querySelector('[data-testid="curve-morph-overlay"][data-channel-id="red"]');
    expect(el).not.toBeNull();
    return el!;
  });
  // static focus layer hidden while morphing
  const staticLayer = container.querySelector('[data-channel-id="red"][data-focus="true"]')!;
  expect((staticLayer as SVGGElement).style.visibility).toBe("hidden");
  // settles: overlay unmounts, static visible again, geometry = final
  await waitFor(() => {
    expect(container.querySelector('[data-testid="curve-morph-overlay"]')).toBeNull();
  }, { timeout: 2000 });
  expect((staticLayer as SVGGElement).style.visibility).not.toBe("hidden");
});

it("interp change morphs; locked follower morphs with READONLY_DASH on its overlay polyline", async () => {
  const t0 = [trk("red", KEYS3, "linear"), trk("green", KEYS3, "linear", "red")];
  const { rerender, container } = render(mcCurve(t0, "green"));
  const t1 = [trk("red", KEYS3, "smooth"), trk("green", KEYS3, "smooth", "red")];
  rerender(mcCurve(t1, "green"));
  const line = await waitFor(() => {
    const el = container.querySelector(
      '[data-testid="curve-morph-overlay"][data-channel-id="green"] polyline');
    expect(el).not.toBeNull();
    return el!;
  });
  expect(line.getAttribute("stroke-dasharray")).toBe("7 5");
});

it("no matchMedia (jsdom default) => no overlay ever mounts", async () => {
  // run WITHOUT the stub (delete window.matchMedia for this test)
  const t0 = [trk("red", [k(0, 0), k(100, 1)], "linear")];
  const { rerender, container } = render(mcCurve(t0, "red"));
  rerender(mcCurve([trk("red", [k(0, 0), k(50, 1), k(100, 1)], "linear")], "red"));
  await new Promise((r) => setTimeout(r, 50));
  expect(container.querySelector('[data-testid="curve-morph-overlay"]')).toBeNull();
});

it("reduced-motion => no overlay", async () => { /* stub with matches:true for reduce; same body as above */ });

it("interruption: a second structural change mid-morph retargets without unmounting", async () => {
  // rerender twice ~30ms apart; assert the overlay element identity is stable
  // across the second rerender (same node), and it still settles.
});
```

Define `trk`/`k`/`KEYS3`/`mcCurve` helpers near the existing multi-channel fixtures (`mcCurve(tracks, focus)` returns the `<CurveEditor>` JSX with channels/visible fixed). Write the last two tests out fully — the comments above are the shape, the executor writes complete bodies.

- [ ] **Step 2: Run to verify failure** (`pnpm --filter @particle-editor/editor test -- --run CurveEditor.test`): the new tests fail (no overlay testid exists).

- [ ] **Step 3: Implement `lib/use-curve-morph.ts`**

```ts
// useCurveMorph — drives the sample-and-tween morph for
// MultiChannelCurves. React's job: mount/unmount one overlay <g> per
// morphing channel and hide that channel's static layer. The hook's
// job: per-frame imperative drawing INTO the overlay group (polyline +
// fill + markers) via one shared rAF loop — the FLIP/dock-anim
// direct-DOM-write idiom, no per-frame setState.

import { useEffect, useRef, useState } from "react";
import type { TrackDto } from "@particle-editor/bridge-schema";
import {
  buildMorphGrid, classifyTrackChange, easeOutCubic, matchKeys,
  MORPH_MS, resampleOntoGrid, sampleTrackPx, KEY_MATCH_EPS,
} from "./curve-morph";

export type MorphChannelInput = {
  channelId: string;
  color: string;
  track: TrackDto;
  vMin: number;       // the channel's own projection (projY)
  vMax: number;
  dashed: boolean;    // READONLY_DASH carrier (locked focus channel)
  strokeWidth: number;
  opacity: number;    // dimmed background layers morph dimmed
  isFocus: boolean;   // markers only on the focus channel (Task 3)
};

export type SuppressedMove = {
  channelId: string;
  moves: Array<{ oldTime: number; newTime: number; newValue: number }>;
} | null;

type Job = {
  input: MorphChannelInput;        // latest target styling
  gridX: Float64Array;             // data-space xs
  from: Float64Array;              // pixel ys
  to: Float64Array;                // pixel ys
  start: number;                   // performance.now at (re)start
  el: SVGGElement | null;          // overlay group (attached by React)
  // imperative children, created on first tick:
  line?: SVGPolylineElement;
  fill?: SVGPathElement;
  // Task 3 adds marker state here.
};

export function useCurveMorph(args: {
  channels: MorphChannelInput[];
  width: number;
  height: number;
  timeMin: number;
  timeMax: number;
  isDragging: () => boolean;
  suppressRef: React.MutableRefObject<SuppressedMove>;
}): {
  activeIds: string[];
  attach: (channelId: string) => (el: SVGGElement | null) => void;
  isActive: (channelId: string) => boolean;
} {
  const { channels, width, height, timeMin, timeMax, isDragging, suppressRef } = args;
  const jobs = useRef(new Map<string, Job>());
  const prev = useRef(new Map<string, { track: TrackDto; vMin: number; vMax: number }>());
  const raf = useRef(0);
  const fallback = useRef(0);
  const [activeIds, setActiveIds] = useState<string[]>([]);

  const motionOk = () =>
    typeof window.matchMedia === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // snapshot + classify on every render's channels
  useEffect(() => {
    const dims = { width, height };
    const next = new Map<string, { track: TrackDto; vMin: number; vMax: number }>();
    let started = false;
    for (const c of channels) {
      next.set(c.channelId, { track: c.track, vMin: c.vMin, vMax: c.vMax });
      const p = prev.current.get(c.channelId);
      if (!p || isDragging() || !motionOk()) continue;
      const change = classifyTrackChange(p.track, c.track);
      if (change === "none") continue;
      // drag-commit suppression (single- or group-move just previewed)
      const sup = suppressRef.current;
      if (sup && sup.channelId === c.channelId && change !== "none"
          && movesMatch(p.track, c.track, sup.moves)) {
        suppressRef.current = null;
        continue;
      }
      const gridX = buildMorphGrid(p.track, c.track, timeMin, timeMax);
      const to = sampleTrackPx(c.track, gridX, { vMin: c.vMin, vMax: c.vMax, height });
      const existing = jobs.current.get(c.channelId);
      const from = existing
        ? resampleOntoGrid(toPixelXs(existing.gridX, timeMin, timeMax, width),
            currentSamples(existing), toPixelXs(gridX, timeMin, timeMax, width))
        : sampleTrackPx(p.track, gridX, { vMin: p.vMin, vMax: p.vMax, height });
      jobs.current.set(c.channelId, {
        ...(existing ?? { el: null }),
        input: c, gridX, from, to, start: performance.now(),
      } as Job);
      started = true;
    }
    // channels that disappeared (visibility toggle, emitter switch): abort
    for (const id of Array.from(jobs.current.keys())) {
      if (!channels.some((c) => c.channelId === id)) jobs.current.delete(id);
    }
    prev.current = next;
    if (started) {
      setActiveIds(Array.from(jobs.current.keys()));
      ensureLoop(dims);
    }
    // resize aborts (spec §2.3): handled by deps — width/height change
    // with no track change re-snapshots; abort any in-flight jobs.
  });

  function ensureLoop(dims: { width: number; height: number }) {
    if (raf.current) return;
    const tick = (now: number) => {
      let any = false;
      for (const [id, j] of jobs.current) {
        const p = Math.min(1, (now - j.start) / MORPH_MS);
        const e = easeOutCubic(p);
        drawJob(j, e, dims, timeMin, timeMax);
        if (p < 1) any = true;
        else jobs.current.delete(id);
      }
      if (any) raf.current = requestAnimationFrame(tick);
      else finish();
    };
    raf.current = requestAnimationFrame(tick);
    // use-presence rule: timeout fallback so throttled rAF can't leak
    clearTimeout(fallback.current);
    fallback.current = window.setTimeout(() => { jobs.current.clear(); finish(); }, MORPH_MS + 250);
  }
  function finish() {
    cancelAnimationFrame(raf.current); raf.current = 0;
    clearTimeout(fallback.current);
    setActiveIds(Array.from(jobs.current.keys())); // [] when done
  }

  useEffect(() => () => { cancelAnimationFrame(raf.current); clearTimeout(fallback.current); }, []);

  return {
    activeIds,
    isActive: (id) => jobs.current.has(id) || activeIds.includes(id),
    attach: (id) => (el) => { const j = jobs.current.get(id); if (j) j.el = el; },
  };
}
```

Plus the module-private helpers (write them fully): `toPixelXs(gridX, timeMin, timeMax, width)` (project data-x to pixel-x), `currentSamples(job)` (lerp from/to at the job's last eased progress — store `lastE` on the job each tick), `movesMatch(prevTrack, nextTrack, moves)` (every diff between the tracks is explained by the recorded moves within `KEY_MATCH_EPS`), and `drawJob(job, e, dims, timeMin, timeMax)` — creates `job.line` (`polyline`, `fill="none"`, stroke=input.color, strokeWidth=input.strokeWidth, `stroke-dasharray` when `input.dashed`, opacity=input.opacity) and `job.fill` (gradient is omitted in the overlay — a translucent flat fill `input.color` at 0.12 alpha matches the gradient's average closely enough for 180 ms; document this simplification) into `job.el` on first call via `document.createElementNS`, then per frame sets `points`/`d` from the lerped samples (same string-building as the static builders).

- [ ] **Step 4: Integrate into `MultiChannelCurves`**

In `CurveEditor.tsx`:

```tsx
// build the hook inputs from the existing layers map
const morph = useCurveMorph({
  channels: layers.map((l) => ({
    channelId: l.channel.id,
    color: l.channel.color,
    track: l.track,
    vMin: (displayRange ?? l.range).min,
    vMax: (displayRange ?? l.range).max,
    dashed: focusReadOnly && focusLayer !== null && l.channel.id === focusLayer.channel.id,
    strokeWidth: focusEnabled && focusLayer !== null && l.channel.id === focusLayer.channel.id ? 3 : 2,
    opacity: focusEnabled && (focusLayer === null || l.channel.id !== focusLayer.channel.id) ? 0.4 : 1,
    isFocus: focusLayer !== null && l.channel.id === focusLayer.channel.id,
  })),
  width, height, timeMin, timeMax,
  isDragging: () => dragRef.current !== null,
  suppressRef: morphSuppressRef,
});
const morphSuppressRef = useRef<SuppressedMove>(null); // declare ABOVE the hook call
```

- Background layer `<g>` and focus layer `<g>`: add
  `style={{ ...(existing styles), visibility: morph.isActive(channel.id) ? "hidden" : undefined }}`
  (background layers currently use `style={{ opacity }}` — merge).
- Render overlays after the focus layer, before the marquee rect:

```tsx
{morph.activeIds.map((id) => (
  <g key={id} data-testid="curve-morph-overlay" data-channel-id={id}
     pointerEvents="none" ref={morph.attach(id)} />
))}
```

- [ ] **Step 5: Run** the renderer spec + the FULL suite (`pnpm --filter @particle-editor/editor test`) — the new tests pass; the other ~720 still pass because jsdom has no `matchMedia` (the gate). `tsc -b` 0.

- [ ] **Step 6: Commit**

```bash
git add web/apps/editor/src/lib/use-curve-morph.ts web/apps/editor/src/screens/CurveEditor.tsx web/apps/editor/src/screens/__tests__/CurveEditor.test.tsx
git commit -m "feat(curve-morph): useCurveMorph hook + line/fill morph overlay in MultiChannelCurves"
```

---

### Task 3: Marker choreography (glide / pop / ghost)

**Files:**
- Modify: `web/apps/editor/src/lib/use-curve-morph.ts`
- Test: `web/apps/editor/src/screens/__tests__/CurveEditor.test.tsx`

- [ ] **Step 1: Failing tests** (same stubbed-matchMedia describe):

```tsx
it("focus-channel markers: matched keys glide, added key pops in, removed key ghosts out", async () => {
  const t0 = [trk("red", [k(0, 0), k(50, 0.5), k(100, 1)], "linear")];
  const { rerender, container } = render(mcCurve(t0, "red"));
  // delete the 50-key, add a 75-key in one change (paste-like)
  rerender(mcCurve([trk("red", [k(0, 0), k(75, 0.9), k(100, 1)], "linear")], "red"));
  const overlay = await waitFor(() => {
    const el = container.querySelector('[data-testid="curve-morph-overlay"]');
    expect(el).not.toBeNull();
    return el!;
  });
  // mid-morph: overlay carries marker circles — 2 moved + 1 in + 1 ghost = 4
  await waitFor(() => {
    expect(overlay.querySelectorAll("circle").length).toBe(4);
  });
  await waitFor(() => {
    expect(container.querySelector('[data-testid="curve-morph-overlay"]')).toBeNull();
  }, { timeout: 2000 });
});

it("non-focus channels morph their line but render no overlay markers", async () => {
  const t0 = [trk("red", KEYS3, "linear"), trk("green", KEYS3, "linear")];
  const { rerender, container } = render(mcCurve(t0, "red")); // focus red; green is background
  rerender(mcCurve([trk("red", KEYS3, "linear"),
                    trk("green", [k(0,0), k(40,1), k(100,0.5)], "linear")], "red"));
  const overlay = await waitFor(() => {
    const el = container.querySelector('[data-testid="curve-morph-overlay"][data-channel-id="green"]');
    expect(el).not.toBeNull();
    return el!;
  });
  expect(overlay.querySelectorAll("circle").length).toBe(0);
});
```

- [ ] **Step 2: Run to verify failure** (no circles in overlays yet).

- [ ] **Step 3: Implement** in `use-curve-morph.ts`: extend `Job` with
`markers: Array<{ mode: "move" | "in" | "out"; x0: number; y0: number; x1: number; y1: number }>`
computed at job (re)start when `input.isFocus`, from `matchKeys(prevTrack, nextTrack)` projected with the OLD proj for `x0/y0` and NEW proj for `x1/y1` (the spike's exact scheme: moved = lerp positions; in = fixed at target, `r = 5·e`, `fill-opacity = e`; out = fixed at origin, `r = 5·(1−e)`, `fill-opacity = 1−e`). `drawJob` creates/updates the circles (channel colour, `pointerEvents` inherited none from the group). Retarget re-matches against the new target and rebuilds the marker list (ghost-of-ghost collapses naturally). Non-focus jobs get `markers: []`.

- [ ] **Step 4: Run** renderer spec + full suite + `tsc -b`. All green.

- [ ] **Step 5: Commit**

```bash
git add web/apps/editor/src/lib/use-curve-morph.ts web/apps/editor/src/screens/__tests__/CurveEditor.test.tsx
git commit -m "feat(curve-morph): focus-channel marker choreography (glide, pop-in, ghost-out)"
```

---

### Task 4: Drag-commit suppression

**Files:**
- Modify: `web/apps/editor/src/screens/CurveEditor.tsx` (drag-commit site)
- Test: `web/apps/editor/src/screens/__tests__/CurveEditor.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
it("a drag-committed move does not re-morph the dragged channel, but its locked follower morphs", async () => {
  // red focus + green locked to red, identical keys; matchMedia stubbed ON
  const t0 = [trk("red", [k(0,0), k(50,0.5), k(100,1)], "linear"),
              trk("green", [k(0,0), k(50,0.5), k(100,1)], "linear", "red")];
  const { rerender, container } = render(mcCurve(t0, "red"));
  // simulate the drag: pointerDown on the 50-key pad, move, up
  const pad = container.querySelector('[data-testid="curve-key"][data-key-time="50"]')!;
  const svg = container.querySelector('[data-testid="curve-editor-svg"]')!;
  fireEvent.pointerDown(pad, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(svg, { pointerId: 1, clientX: 40, clientY: -30 });
  fireEvent.pointerUp(svg, { pointerId: 1, clientX: 40, clientY: -30 });
  // the refetch delivers the committed move on red AND the mirrored green
  // (read the drag-end commit values from the onKeyDragEnd spy to build them,
  //  or use a generous KEY_MATCH_EPS-compatible approximation of the same move)
  rerender(mcCurve(/* t1 with red's 50-key at the dragged position, green mirroring */, "red"));
  await waitFor(() => {
    expect(container.querySelector('[data-testid="curve-morph-overlay"][data-channel-id="green"]')).not.toBeNull();
  });
  expect(container.querySelector('[data-testid="curve-morph-overlay"][data-channel-id="red"]')).toBeNull();
});
```

The executor wires `onKeyDragEnd` with a spy, reads the committed `(newTime, newValue)` from it, and builds `t1` from those exact numbers — the suppression matches within `KEY_MATCH_EPS`, so exactness matters. (jsdom's zero-rect projection means the drag math produces specific clamped values; the spy makes the test independent of them.)

- [ ] **Step 2: Run to verify failure** (red's overlay mounts today).

- [ ] **Step 3: Implement**: in `MultiChannelCurves`' drag-commit branch (`onPointerUp`, where `moved && onKeyDragEnd` fires — and the group-drag branch where `onGroupDragEnd` fires), record BEFORE invoking the callback:

```tsx
morphSuppressRef.current = {
  channelId: focusLayer!.channel.id,
  moves: [{ oldTime: drag.keyTime, newTime: drag.currentTime, newValue: drag.currentValue }],
};
```

(group drag: one entry per selected key, `oldTime` + shifted `newTime/newValue` — reuse the same dTime/dValue math the commit path already computes). The hook's classification consume (Task 2's `movesMatch`) already does the rest. Note: a suppression that never matches (e.g. the host clamped differently) is consumed on the channel's NEXT change or overwritten by the next drag — add a one-line `suppressRef.current = null` whenever a non-matching change for that channel morphs, so a stale entry can't suppress a later legitimate morph.

- [ ] **Step 4: Run** renderer spec + full suite + `tsc -b`.

- [ ] **Step 5: Commit**

```bash
git add web/apps/editor/src/screens/CurveEditor.tsx web/apps/editor/src/lib/use-curve-morph.ts web/apps/editor/src/screens/__tests__/CurveEditor.test.tsx
git commit -m "feat(curve-morph): drag-commit suppression (no double-glide; locked followers still morph)"
```

---

### Task 5: Harness settle + full gates + CHANGELOG + PR

**Files:**
- Modify: the a11y capture helper (locate with `grep -rn "captureDomA11y" web/apps/editor/tests` — it already settles tooltip exits per NT-12)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Extend the golden settle.** In `captureDomA11y`'s settle step (the NT-12 `waitForFunction` for no `.tip-animate[data-state="closed"]`), add the same wait for `document.querySelector('[data-testid="curve-morph-overlay"]') === null`. The host HAS `matchMedia`, so morphs run live in the harness; goldens must capture the settled DOM. (The functional specs use auto-retrying Playwright matchers and need nothing.)

- [ ] **Step 2: Full gates** (capture exit codes explicitly — L-080):

```
cd web
pnpm --filter @particle-editor/editor test            # ~720+, 0 fail
pnpm --filter @particle-editor/editor exec tsc -b     # exit 0
pnpm --filter @particle-editor/editor build           # vite clean
pnpm --filter @particle-editor/editor test:native     # 180/0 (NO golden drift expected; if a
                                                      # golden drifts, full-suite regen ONLY, L-081)
```

Host Debug x64 (PowerShell + VS18 MSBuild per L-046; the worktree is already L-039/L-040 restored from Part A). Watch the curve-mutating native specs in particular: `track-editor.spec.ts`, `a11y-curve-spinner*.spec.ts`, `emitter-mutations.spec.ts`, `undo-navigation.spec.ts`.

- [ ] **Step 3: CHANGELOG entry** at the top per the house format (`*YYYY-MM-DD · TODO-hash · TODO-PR*`, three sections, `---` delimiter). What ships: the morph behaviour, triggers list, what stays instant (drag, reduced-motion). How we tackled it: the smoothstep identity + augmented grid (true step verticals), pixel-space tweening, matchMedia gate as THE test-stability decision, imperative-overlay-group idiom. Issues: drag-commit double-glide + suppression design; the spike-validated interruption folding; the captureDomA11y settle extension; the lockedTo-is-styling classification refinement.

- [ ] **Step 4: Commit + PR**

```bash
git add -A
git commit -m "feat(curve-morph): harness settle + CHANGELOG"
git push -u origin claude/curve-morph-anim
gh pr create --base master --title "feat(curve-editor): smooth morph animation for structural curve changes" --body-file <generated>
```

PR body summarizes the spec decisions, the spike, gates, and states the merge gate: **user feel pass first** (L-033) — add/delete/interp morphs on real emitters, spinner auto-repeat folding, locked-follower glide while editing Red, drag commit (no double-glide), reduced-motion, both themes. Merge only on explicit user OK.

---

## Self-review notes (done at plan time)

- **Spec coverage:** §2.1 pure core → Task 1 (incl. the post-review grid augmentation + the documented lockedTo classification refinement); §2.2 hook/overlay/gate/folding → Task 2; markers → Task 3; §2.4 suppression → Task 4; §2.3 non-morph cases → Task 2 (drag-defer via `isDragging`, resize/visibility abort via the dep-driven re-snapshot + job pruning; focus-switch styling changes produce `"none"` classifications); §3 risk 1 (suite stability) → the matchMedia gate, proven by the full-suite run in every task; §4 harness → Task 5.
- **Type consistency:** `MorphChannelInput`, `SuppressedMove`, `useCurveMorph(args)` return `{ activeIds, attach, isActive }` — used identically in Tasks 2–4; `KEY_MATCH_EPS`/`MORPH_MS` from Task 1 referenced in Tasks 2/4.
- **Known soft spots for the executor:** the `useEffect`-without-deps classification effect runs every render — it must be cheap when nothing changed (classify only on reference-unequal tracks; add an early `if (prevTracksRef same refs) return` if profiling warrants); `morphSuppressRef` must be declared before the hook call; the overlay flat-fill simplification (vs the gradient) is documented in `drawJob` and is feel-reviewable; jsdom pointer-coordinate quirks in Task 4's test are absorbed by reading the spy's committed values.
