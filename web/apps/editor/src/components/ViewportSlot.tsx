import { useEffect, useRef } from "react";
import type { Bridge } from "@particle-editor/bridge-schema";

type Props = { bridge: Bridge };

const SLOT_BORDER_PX = 0;  // The real shell doesn't paint a slot border; D3D9 fills the whole rect.

export function ViewportSlot({ bridge }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const send = () => {
      const r = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const x = Math.round((r.left + SLOT_BORDER_PX) * dpr);
      const y = Math.round((r.top + SLOT_BORDER_PX) * dpr);
      const w = Math.round(Math.max(0, r.width - SLOT_BORDER_PX * 2) * dpr);
      const h = Math.round(Math.max(0, r.height - SLOT_BORDER_PX * 2) * dpr);
      // Fire-and-forget — host doesn't return data for layout updates.
      void bridge.request({ kind: "layout/viewport-rect", params: { x, y, w, h } }).catch(() => {});
    };

    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    window.addEventListener("scroll", send, { passive: true });
    window.addEventListener("resize", send);

    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", send);
      window.removeEventListener("resize", send);
    };
  }, [bridge]);

  return (
    <div
      ref={ref}
      className="flex-1 bg-transparent flex items-center justify-center text-neutral-600 text-sm"
    >
      {/* The native D3D9 viewport sibling renders here. In browser-mode
          (MockBridge), the underlying body bg shows through. */}
      <span className="select-none pointer-events-none">D3D9 viewport</span>
    </div>
  );
}
