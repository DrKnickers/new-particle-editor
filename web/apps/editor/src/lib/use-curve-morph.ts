// useCurveMorph — drives the sample-and-tween morph for
// MultiChannelCurves. React's job: mount/unmount one overlay <g> per
// morphing channel and hide that channel's static layer. The hook's
// job: per-frame imperative drawing INTO the overlay group (polyline +
// fill) via one shared rAF loop — the FLIP/dock-anim direct-DOM-write
// idiom, no per-frame setState.
//
// Markers (glide/pop/ghost) are Task 3 — not in this file yet.
// This task covers line + fill only.
//
// Fill simplification: the overlay uses a translucent flat fill at
// ~0.12 alpha rather than the gradient the static layer uses. The
// gradient's average opacity over a 180ms morph is close enough to
// 0.12 that the difference is imperceptible; avoiding a per-channel
// <defs>/<linearGradient> in the overlay keeps the imperative code
// simple. This is explicitly documented here for the feel-pass review.

import { useEffect, useRef, useState } from "react";
import type { TrackDto } from "@particle-editor/bridge-schema";
import {
  buildMorphGrid,
  classifyTrackChange,
  easeOutCubic,
  MORPH_MS,
  resampleOntoGrid,
  sampleTrackPx,
  KEY_MATCH_EPS,
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
  input: MorphChannelInput;   // latest target styling
  gridX: Float64Array;        // data-space xs
  from: Float64Array;         // pixel ys
  to: Float64Array;           // pixel ys
  start: number;              // performance.now at (re)start
  lastE: number;              // last eased progress, for interruption folding
  el: SVGGElement | null;     // overlay group (attached by React)
  // imperative children, created on first tick:
  line?: SVGPolylineElement;
  fill?: SVGPathElement;
  // Task 3 adds marker state here.
};

// ─── Private helpers ───────────────────────────────────────────────────────

const SVG_NS = "http://www.w3.org/2000/svg";

/** Project data-space x-grid onto pixel-space x values for the canvas. */
function toPixelXs(
  gridX: Float64Array,
  timeMin: number,
  timeMax: number,
  width: number,
): Float64Array {
  const range = timeMax - timeMin;
  if (range <= 0) return new Float64Array(gridX.length);
  const out = new Float64Array(gridX.length);
  for (let i = 0; i < gridX.length; i++) {
    out[i] = ((gridX[i]! - timeMin) / range) * width;
  }
  return out;
}

/** Compute the currently-displayed pixel-y samples by lerping from→to
 *  at the job's last eased progress. Used for interruption folding so
 *  a retarget starts from the shape currently on screen. */
function currentSamples(job: Job): Float64Array {
  const e = job.lastE;
  const { from, to } = job;
  const out = new Float64Array(from.length);
  for (let i = 0; i < from.length; i++) {
    out[i] = from[i]! + (to[i]! - from[i]!) * e;
  }
  return out;
}

/** Check whether the diff between prevTrack and nextTrack is fully
 *  explained by the recorded suppressed moves (within KEY_MATCH_EPS).
 *  Returns true → suppress (snap, no morph). */
function movesMatch(
  prevTrack: TrackDto,
  nextTrack: TrackDto,
  moves: Array<{ oldTime: number; newTime: number; newValue: number }>,
): boolean {
  // Same key count is required (a structural insert/delete is not a suppressed move).
  if (prevTrack.keys.length !== nextTrack.keys.length) return false;
  // For each prev key, find the corresponding next key (matched by old time or new time).
  // Every diff between prev and next must be explained by one of the recorded moves.
  for (let i = 0; i < prevTrack.keys.length; i++) {
    const pk = prevTrack.keys[i]!;
    const nk = nextTrack.keys[i]!;
    const timeDiff = Math.abs(pk.time - nk.time);
    const valueDiff = Math.abs(pk.value - nk.value);
    if (timeDiff <= KEY_MATCH_EPS && valueDiff <= KEY_MATCH_EPS) {
      // This key didn't change — that's fine.
      continue;
    }
    // This key changed — find a recorded move that explains it.
    const explained = moves.some(
      (m) =>
        Math.abs(pk.time - m.oldTime) <= KEY_MATCH_EPS &&
        Math.abs(nk.time - m.newTime) <= KEY_MATCH_EPS &&
        Math.abs(nk.value - m.newValue) <= KEY_MATCH_EPS,
    );
    if (!explained) return false;
  }
  return true;
}

/** Build the `points` attribute string for a polyline from parallel x/y arrays. */
function buildPointsString(xs: Float64Array, ys: Float64Array): string {
  const parts: string[] = [];
  for (let i = 0; i < xs.length; i++) {
    parts.push(`${xs[i]!.toFixed(2)},${ys[i]!.toFixed(2)}`);
  }
  return parts.join(" ");
}

/** Build the fill-path `d` string: traces from left to right along the
 *  lerped polyline, then drops to `height` and returns left. Matches
 *  the `buildFillPath` shape logic in CurveEditor.tsx. */
function buildFillD(xs: Float64Array, ys: Float64Array, height: number): string {
  if (xs.length < 2) return "";
  const parts: string[] = [`M ${xs[0]!.toFixed(2)} ${ys[0]!.toFixed(2)}`];
  for (let i = 1; i < xs.length; i++) {
    parts.push(`L ${xs[i]!.toFixed(2)} ${ys[i]!.toFixed(2)}`);
  }
  const lastX = xs[xs.length - 1]!;
  const firstX = xs[0]!;
  parts.push(`L ${lastX.toFixed(2)} ${height.toFixed(2)}`);
  parts.push(`L ${firstX.toFixed(2)} ${height.toFixed(2)}`);
  parts.push("Z");
  return parts.join(" ");
}

/** Convert a CSS hex color (#RRGGBB or #RGB) to rgba with the given alpha.
 *  Falls back to the color string itself wrapped in rgba() if unparseable. */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length === 3) {
    const r = parseInt(h[0]! + h[0]!, 16);
    const g = parseInt(h[1]! + h[1]!, 16);
    const b = parseInt(h[2]! + h[2]!, 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  // Not a simple hex (e.g. CSS var token) — fall back to setting opacity attribute.
  return hex;
}

/** Draw a single morph frame into job.el, creating the imperative SVG
 *  children on the first call. The flat fill uses ~0.12 alpha (see the
 *  file-level note on gradient simplification). */
function drawJob(
  job: Job,
  e: number,
  dims: { width: number; height: number },
  timeMin: number,
  timeMax: number,
): void {
  const { el, from, to, input } = job;
  if (el === null) return;

  // Compute lerped pixel-space y values.
  const ys = new Float64Array(from.length);
  for (let i = 0; i < from.length; i++) {
    ys[i] = from[i]! + (to[i]! - from[i]!) * e;
  }
  const xs = toPixelXs(job.gridX, timeMin, timeMax, dims.width);

  // Create imperative children on first call.
  if (!job.fill) {
    const fill = document.createElementNS(SVG_NS, "path") as SVGPathElement;
    fill.setAttribute("stroke", "none");
    fill.setAttribute("pointer-events", "none");
    // Flat translucent fill (gradient simplification — see file comment).
    const fillColor = hexToRgba(input.color, 0.12);
    if (fillColor.startsWith("rgba")) {
      fill.setAttribute("fill", fillColor);
    } else {
      // CSS variable or unparseable hex — use fill-opacity.
      fill.setAttribute("fill", input.color);
      fill.setAttribute("fill-opacity", "0.12");
    }
    el.appendChild(fill);
    job.fill = fill;
  }

  if (!job.line) {
    const line = document.createElementNS(SVG_NS, "polyline") as SVGPolylineElement;
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", input.color);
    line.setAttribute("stroke-width", String(input.strokeWidth));
    if (input.dashed) {
      line.setAttribute("stroke-dasharray", "7 5");
    }
    line.setAttribute("opacity", String(input.opacity));
    line.setAttribute("pointer-events", "none");
    el.appendChild(line);
    job.line = line;
  }

  // Update geometry every frame.
  job.fill.setAttribute("d", buildFillD(xs, ys, dims.height));
  job.line.setAttribute("points", buildPointsString(xs, ys));
}

// ─── Hook ────────────────────────────────────────────────────────────────────

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
  isActive: (id: string) => boolean;
} {
  const { channels, width, height, timeMin, timeMax, isDragging, suppressRef } = args;
  const jobs = useRef(new Map<string, Job>());
  const prev = useRef(new Map<string, { track: TrackDto; vMin: number; vMax: number }>());
  const raf = useRef(0);
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeIds, setActiveIds] = useState<string[]>([]);
  // Capture dims in a ref so the rAF loop closure always reads the latest values.
  const dimsRef = useRef({ width, height });
  dimsRef.current = { width, height };

  const motionOk = (): boolean =>
    typeof window.matchMedia === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ─── Classify + start/retarget jobs on every render ──────────────────
  // This effect runs every render (no deps array) so it picks up every
  // tracks-prop change. It is cheap when nothing changed: classify() is
  // O(n_keys) with an early return on "none".
  useEffect(() => {
    const next = new Map<string, { track: TrackDto; vMin: number; vMax: number }>();
    let anyStarted = false;

    for (const c of channels) {
      next.set(c.channelId, { track: c.track, vMin: c.vMin, vMax: c.vMax });
      const p = prev.current.get(c.channelId);
      if (!p || isDragging() || !motionOk()) continue;

      const change = classifyTrackChange(p.track, c.track);
      if (change === "none") continue;

      // Drag-commit suppression (Task 4 wires the recording; here we only
      // consume. If suppressRef.current is null, this is a no-op).
      const sup = suppressRef.current;
      if (
        sup &&
        sup.channelId === c.channelId &&
        movesMatch(p.track, c.track, sup.moves)
      ) {
        // Snap: the change is explained by a recorded drag — don't morph.
        suppressRef.current = null;
        continue;
      }
      // Stale non-matching suppression: clear it so it can't block a future
      // legitimate morph on this channel.
      if (sup && sup.channelId === c.channelId) {
        suppressRef.current = null;
      }

      const gridX = buildMorphGrid(p.track, c.track, timeMin, timeMax);
      const to = sampleTrackPx(c.track, gridX, { vMin: c.vMin, vMax: c.vMax, height });

      const existing = jobs.current.get(c.channelId);
      let from: Float64Array;
      if (existing) {
        // Interruption folding: resample the currently-displayed shape
        // (a known polyline in old pixel-x space) onto the new grid.
        const oldPixelXs = toPixelXs(existing.gridX, timeMin, timeMax, width);
        const displayedYs = currentSamples(existing);
        const newPixelXs = toPixelXs(gridX, timeMin, timeMax, width);
        from = resampleOntoGrid(oldPixelXs, displayedYs, newPixelXs);
      } else {
        from = sampleTrackPx(p.track, gridX, { vMin: p.vMin, vMax: p.vMax, height });
      }

      jobs.current.set(c.channelId, {
        input: c,
        gridX,
        from,
        to,
        start: performance.now(),
        lastE: 0,
        el: existing?.el ?? null,
        line: existing?.line,
        fill: existing?.fill,
      });
      anyStarted = true;
    }

    // Prune jobs for channels that have disappeared (visibility toggle,
    // emitter switch) — spec §2.3.
    for (const id of Array.from(jobs.current.keys())) {
      if (!channels.some((c) => c.channelId === id)) {
        jobs.current.delete(id);
      }
    }

    prev.current = next;

    if (anyStarted) {
      setActiveIds(Array.from(jobs.current.keys()));
      ensureLoop();
    }
    // Width/height change (canvas resize) re-snapshots via dep change
    // but does NOT restart morphs — they were already cleared by the
    // channel-disappearance prune above if the emitter switched.
  });

  // ─── rAF loop ────────────────────────────────────────────────────────

  function ensureLoop(): void {
    if (raf.current) return; // already running
    const tick = (now: number) => {
      let any = false;
      const dims = dimsRef.current;
      for (const [id, j] of jobs.current) {
        const p = Math.min(1, (now - j.start) / MORPH_MS);
        const e = easeOutCubic(p);
        j.lastE = e;
        drawJob(j, e, dims, timeMin, timeMax);
        if (p < 1) {
          any = true;
        } else {
          jobs.current.delete(id);
        }
      }
      if (any) {
        raf.current = requestAnimationFrame(tick);
      } else {
        finish();
      }
    };
    raf.current = requestAnimationFrame(tick);
    // Fallback: throttled rAF can't leak (use-presence rule).
    if (fallback.current !== null) clearTimeout(fallback.current);
    fallback.current = setTimeout(() => {
      jobs.current.clear();
      finish();
    }, MORPH_MS + 250);
  }

  function finish(): void {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    if (fallback.current !== null) {
      clearTimeout(fallback.current);
      fallback.current = null;
    }
    // Update React state: activeIds = [] when all jobs are done,
    // or the remaining set if some jobs are still running (shouldn't
    // happen from finish(), but be defensive).
    setActiveIds(Array.from(jobs.current.keys()));
  }

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      cancelAnimationFrame(raf.current);
      if (fallback.current !== null) clearTimeout(fallback.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    activeIds,
    isActive: (id) => jobs.current.has(id) || activeIds.includes(id),
    attach: (id) => (el) => {
      const j = jobs.current.get(id);
      if (j) j.el = el;
    },
  };
}
