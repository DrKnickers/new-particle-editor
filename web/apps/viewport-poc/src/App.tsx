import { useEffect, useRef } from "react";

type ViewportRect = { x: number; y: number; w: number; h: number };

type LayoutMessage = {
  kind: "layout/viewport-rect";
  params: ViewportRect;
};

function postToHost(msg: LayoutMessage): void {
  const wv = (window as unknown as { chrome?: { webview?: { postMessage: (s: string) => void } } }).chrome?.webview;
  if (wv) {
    wv.postMessage(JSON.stringify(msg));
  } else {
    // Browser mode — no native host, just log.
    // eslint-disable-next-line no-console
    console.log("[bridge:mock]", msg.kind, msg.params);
  }
}

function rectFromElement(el: HTMLElement): ViewportRect {
  const r = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return {
    x: Math.round(r.left * dpr),
    y: Math.round(r.top * dpr),
    w: Math.round(r.width * dpr),
    h: Math.round(r.height * dpr),
  };
}

export function App() {
  const slotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = slotRef.current;
    if (!el) return;

    const send = () => {
      postToHost({ kind: "layout/viewport-rect", params: rectFromElement(el) });
    };

    // Initial paint
    send();

    const ro = new ResizeObserver(send);
    ro.observe(el);

    // Also watch for window-position changes (e.g. DPI change, scroll).
    // ResizeObserver doesn't fire on scroll/move, so backstop with rAF
    // when the user is dragging — but keep it simple here: scroll listener.
    window.addEventListener("scroll", send, { passive: true });
    window.addEventListener("resize", send);

    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", send);
      window.removeEventListener("resize", send);
    };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header
        style={{
          height: 60,
          flexShrink: 0,
          background: "#16191F",
          borderBottom: "1px solid #262A33",
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          fontWeight: 600,
        }}
      >
        PoC header — WebView2 + D3D9 composition test
      </header>
      <div
        ref={slotRef}
        style={{
          flex: 1,
          border: "4px solid #ff45c4",
          margin: 16,
          background: "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#8A9099",
          fontSize: 14,
        }}
      >
        VIEWPORT SLOT (D3D9 sibling lives behind this hole)
      </div>
    </div>
  );
}
