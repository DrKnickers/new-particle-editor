import { useEffect, useRef } from "react";
import type { Bridge } from "@particle-editor/bridge-schema";
import {
  isSeparatorDragging,
  subscribeSeparatorDragging,
} from "@/lib/separator-drag";

type Props = { bridge: Bridge };

const SLOT_BORDER_PX = 0;  // The real shell doesn't paint a slot border; D3D9 fills the whole rect.

export function ViewportSlot({ bridge }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const send = () => {
      // B1.4 [NT-8]: while the user is dragging a splitter handle,
      // suppress the per-frame layout/viewport-rect dispatch. PanelLayout
      // has already parked the popup offscreen via a degenerate-size
      // rect (which routes to LayoutBroker's no-Reset early-out). Each
      // additional send during drag would re-arm the expensive D3D9
      // Engine::Reset path and leave the popup chasing the WebView's
      // flex layout. On drag-end the `subscribeSeparatorDragging`
      // listener below re-emits the final rect once.
      if (isSeparatorDragging()) return;
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
    // Re-emit on drag-end so the popup snaps back even if no
    // RO tick fires after pointerup (e.g. a no-op separator click).
    const offDrag = subscribeSeparatorDragging((dragging) => {
      if (!dragging) send();
    });

    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", send);
      window.removeEventListener("resize", send);
      offDrag();
    };
  }, [bridge]);

  return (
    <div
      ref={ref}
      className="absolute inset-0 bg-transparent flex items-center justify-center text-text-3 text-sm"
    >
      {/* The native D3D9 viewport sibling renders here. In browser-mode
          (MockBridge), the underlying body bg shows through.
          `absolute inset-0` fills the positioned parent — the
          quadrant-viewport <div> has `relative` so this stretches to
          its full rect. Without this, `flex-1` did nothing (parent
          isn't a flex container vertically) and the slot collapsed
          to the height of its content. */}
      <span className="select-none pointer-events-none">D3D9 viewport</span>
    </div>
  );
}
