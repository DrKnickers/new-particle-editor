// ViewportPill (Task 2.7) — top-left vertical pill in the viewport
// quadrant with three toggles:
//   1. Show ground            → engine/set/ground            (EngineStateDto.ground)
//   2. Toggle bloom           → engine/set/bloom             (EngineStateDto.bloom)
//   3. Leave particles after  → engine/set/leave-particles   (EngineStateDto.leaveParticles)
//      instance death
//
// All three reflect the live snapshot via `engine/state/changed` so
// external mutations (legacy UI, file/open) keep the pill state in
// sync. Each button uses `aria-pressed` for the active state so
// accessibility tools see the toggle semantics rather than a generic
// button click.

import { useEffect, useRef, useState } from "react";
import type { Bridge, EngineStateDto } from "@particle-editor/bridge-schema";
import { useViewportOcclusion } from "@/lib/viewport-occlusion";

type Props = { bridge: Bridge };

export function ViewportPill({ bridge }: Props) {
  const [snap, setSnap] = useState<EngineStateDto | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  // FD9b: register the pill's rect with the AlphaCompositor so the
  // engine viewport punches a hole over it. The pill has NO CSS
  // box-shadow (just `backdrop-filter: blur(8px)` over a translucent
  // background), so the cut doesn't need a large pad for shadow like
  // the menubar wrappers do. 8 px pad + 8 px feather is enough for
  // soft-edge alpha AA around the pill's rounded corners without
  // exposing a visible ring of bare WebView2 background. (Setting
  // pad=0 would put the feather band INSIDE the pill, dimming its
  // own edge.)
  useViewportOcclusion(bridge, "viewport-pill", ref, 8, 8);

  useEffect(() => {
    let cancelled = false;
    bridge
      .request({ kind: "engine/state/snapshot", params: {} })
      .then((s) => { if (!cancelled) setSnap(s); })
      .catch(() => { /* ignore — snapshot is best-effort at mount */ });
    const off = bridge.on("engine/state/changed", (e) => setSnap(e.payload));
    return () => { cancelled = true; off(); };
  }, [bridge]);

  const ground = snap?.ground ?? false;
  const bloom = snap?.bloom ?? false;
  const leave = snap?.leaveParticles ?? true;

  return (
    <div ref={ref} data-testid="viewport-pill" className="vp-tools" role="group" aria-label="Viewport toggles">
      <button
        type="button"
        className={`tool ${ground ? "active" : ""}`}
        aria-label="Show ground"
        aria-pressed={ground}
        onClick={() => {
          void bridge.request({
            kind: "engine/set/ground",
            params: { enabled: !ground },
          });
        }}
      >
        <img src="/icons/icon-ground.svg" alt="" />
      </button>
      <button
        type="button"
        className={`tool ${bloom ? "active" : ""}`}
        aria-label="Toggle bloom"
        aria-pressed={bloom}
        onClick={() => {
          void bridge.request({
            kind: "engine/set/bloom",
            params: { enabled: !bloom },
          });
        }}
      >
        <img src="/icons/icon-bloom.svg" alt="" />
      </button>
      <button
        type="button"
        className={`tool ${leave ? "active" : ""}`}
        aria-label="Leave particles after instance death"
        aria-pressed={leave}
        onClick={() => {
          void bridge.request({
            kind: "engine/set/leave-particles",
            params: { enabled: !leave },
          });
        }}
      >
        <img src="/icons/icon-particles.svg" alt="" />
      </button>
    </div>
  );
}
