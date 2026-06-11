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
