import { useEffect, useRef } from "react";
import type { Bridge } from "@particle-editor/bridge-schema";

type Props = { bridge: Bridge };

const SLOT_BORDER_PX = 0;  // The real shell doesn't paint a slot border; D3D9 fills the whole rect.

// [MT-11] Phase 1: when VITE_VIEWPORT_TRANSPORT=canvas-jpeg, mount
// a <canvas> inside the slot and paint frames delivered via the typed
// `viewport/frame-ready` bridge event (base64 JPEG inline in the payload;
// see L-015 for why this is inline rather than WebResourceRequested).
// Default "legacy" behaves identically to pre-MT-11: the slot stays an
// empty <div> and the WS_EX_LAYERED popup paints engine pixels above the
// WebView.
//
// Read the flag inside a function (not a module-level const) so vitest
// can override the env var per-test via vi.stubEnv() without needing
// vi.resetModules() chains. Check BOTH import.meta.env (Vite bakes the
// build-time value here in production) and process.env (vi.stubEnv
// writes here in vitest's node runtime). The cost is one property
// lookup per ViewportSlot mount, which is trivial.
function isArchCEnabled(): boolean {
  const fromImportMeta = (import.meta as { env?: Record<string, unknown> }).env?.VITE_VIEWPORT_TRANSPORT;
  const fromProcess = typeof process !== "undefined" && process.env
    ? process.env.VITE_VIEWPORT_TRANSPORT
    : undefined;
  return fromImportMeta === "canvas-jpeg" || fromProcess === "canvas-jpeg";
}

export function ViewportSlot({ bridge }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const archCEnabled = isArchCEnabled();

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
      // B1.4 [NT-8] T4c: the centre-quadrant rect now drives the
      // SCENE rect (the visible sub-rect inside the popup), not the
      // popup HWND itself. AlphaCompositor stamps alpha=0 outside
      // this rect each frame — UI panels behind the alpha-zero bands
      // show through (and receive their own mouse events).
      void bridge.request({ kind: "layout/scene-rect", params: { x, y, w, h } }).catch(() => {});
    };

    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    window.addEventListener("scroll", send, { passive: true });
    window.addEventListener("resize", send);

    // [MT-11] Phase 1.3: matchMedia('(resolution)') fires on DPR
    // changes (monitor swap, browser zoom), which don't trigger
    // ResizeObserver because the CSS-pixel rect is unchanged. We
    // re-dispatch the scene-rect at the new DPR so the host can
    // re-allocate the RT at the correct backing-store size. The
    // listener chain handles each successive DPR by re-binding after
    // every fire (mediaMatch returns a MediaQueryList for the *current*
    // DPR; once it changes, we need a new query for the *new* current
    // DPR to keep getting fired).
    let mql: MediaQueryList | null = null;
    const bindDprListener = () => {
      const dpr = window.devicePixelRatio || 1;
      mql = window.matchMedia(`(resolution: ${dpr}dppx)`);
      const onChange = () => {
        send();
        // Re-bind to the new DPR so we keep getting fires.
        mql?.removeEventListener("change", onChange);
        bindDprListener();
      };
      mql.addEventListener("change", onChange);
    };
    bindDprListener();

    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", send);
      window.removeEventListener("resize", send);
      mql = null;
    };
  }, [bridge]);

  // [MT-11] Phase 1 — canvas paint loop. Subscribes to the typed
  // viewport/frame-ready bridge event, decodes the base64 JPEG inline
  // (see L-015), paints via Image() + drawImage. Skip entirely if the
  // transport flag isn't set; MockBridge (browser dev) never emits this
  // event so the subscription is a benign no-op.
  useEffect(() => {
    if (!archCEnabled) return;

    let cancelled = false;
    let inFlight = false;
    let lastLoggedAt = 0;
    let framesSinceLastLog = 0;

    // Subscribe unconditionally — the canvas + context lookup happens
    // per-event inside the handler so jsdom-mode (no real canvas) and
    // production (real canvas) both flow through the same code path.
    const unsubscribe = bridge.on("viewport/frame-ready", (e) => {
      if (cancelled) return;
      const p = e.payload;
      if (!p?.jpegBase64) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;  // jsdom or context unavailable — skip paint

      // Drop frames if a previous decode is still in flight. The host emits
      // monotonically; missing a frame is fine — the next one paints.
      if (inFlight) return;
      inFlight = true;

      if (canvas.width !== p.w) canvas.width = p.w;
      if (canvas.height !== p.h) canvas.height = p.h;

      // Decode the base64-embedded JPEG via Image() + data: URL. Image
      // decoding happens off the main thread on modern browsers, and
      // drawImage is fast once decoded.
      const img = new Image();
      img.onload = () => {
        if (cancelled) { inFlight = false; return; }
        try {
          ctx.drawImage(img, 0, 0, p.w, p.h);
        } catch {
          // ignore paint failures; next frame retries
        }

        framesSinceLastLog += 1;
        const now = performance.now();
        if (now - lastLoggedAt > 1000) {
          // eslint-disable-next-line no-console
          console.log(`[ArchC] canvas painted ${framesSinceLastLog} frames in ${(now - lastLoggedAt).toFixed(0)}ms (size ${p.w}x${p.h}, b64 ${p.jpegBase64.length} chars)`);
          framesSinceLastLog = 0;
          lastLoggedAt = now;
        }
        inFlight = false;
      };
      img.onerror = () => {
        inFlight = false;
      };
      img.src = `data:image/jpeg;base64,${p.jpegBase64}`;
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bridge, archCEnabled]);

  return (
    <div
      ref={ref}
      className="absolute inset-0 bg-transparent flex items-center justify-center text-text-3 text-sm"
    >
      {archCEnabled ? (
        <canvas
          ref={canvasRef}
          data-testid="viewport-canvas"
          className="absolute inset-0 w-full h-full"
          style={{ imageRendering: "pixelated" }}
        />
      ) : (
        /* The native D3D9 viewport sibling renders here. In browser-mode
           (MockBridge), the underlying body bg shows through.
           `absolute inset-0` fills the positioned parent — the
           quadrant-viewport <div> has `relative` so this stretches to
           its full rect. Without this, `flex-1` did nothing (parent
           isn't a flex container vertically) and the slot collapsed
           to the height of its content. */
        <span className="select-none pointer-events-none">D3D9 viewport</span>
      )}
    </div>
  );
}
