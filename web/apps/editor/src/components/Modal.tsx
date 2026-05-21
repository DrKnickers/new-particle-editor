// Modal — shared dialog foundation for Screen 8 sub-dialogs.
//
// Radix Dialog wrapper exposing a compound-component API:
//   <Modal open onOpenChange title size="sm|md|lg">
//     <Modal.Body>…</Modal.Body>
//     <Modal.Footer>
//       <Modal.CancelButton>Cancel</Modal.CancelButton>
//       <Modal.OkButton onClick disabled>OK</Modal.OkButton>
//     </Modal.Footer>
//   </Modal>
//
// Dismissal: Esc + overlay click + close glyph all fire onOpenChange(false).
// Radix Dialog handles Esc + overlay-click natively; the close glyph in the
// header dispatches via the same callback.
//
// Sizes:
//   sm = 320 px (info modals like About, simple two-field forms like Rescale)
//   md = 480 px (default for property panels)
//   lg = 640 px (heavyweight forms like Lighting / Spawner)
//
// The dark theme matches the rest of the editor (neutral-900 surface,
// neutral-800 borders). Heights are auto, clamped to max-h-[80vh] with
// internal body scroll.

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useState, type ReactNode, type MouseEventHandler } from "react";
import { createPortal } from "react-dom";
import { useBridge } from "@/lib/bridge-context";

export type ModalSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: "w-[320px]",
  md: "w-[480px]",
  lg: "w-[640px]",
};

type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  size?: ModalSize;
  children: ReactNode;
};

export function Modal({
  open,
  onOpenChange,
  title,
  size = "md",
  children,
}: ModalProps) {
  // B1.3.1.1: frosted-glass modal backdrop via engine-snapshot capture.
  // The engine viewport is a layered Win32 popup composited above
  // WebView2 by DWM — its pixels can't be reached by CSS effects
  // (backdrop-filter, opacity, blur) applied to HTML elements (see
  // tasks/lessons.md L-011 for the structural reason and the failed
  // server-side modal-mask approach this replaces). The fix lifts the
  // engine output INTO the WebView2 DOM as a frozen <img>:
  //
  //   1. Open: request a PNG snapshot from AlphaCompositor's pre-stamp
  //      cache and render it as an <img> portaled into the viewport
  //      quadrant DOM. Send `viewport/occlude` with the FULL quadrant
  //      rect so the engine popup goes fully alpha-transparent — the
  //      snapshot is the only thing the user sees behind Dialog.Overlay.
  //   2. Dialog.Overlay's `bg-black/60 backdrop-blur-sm` then dims +
  //      blurs everything in its DOM background uniformly (panels AND
  //      the snapshot img), with no visible popup boundary because both
  //      sides of it are now WebView2-rendered pixels.
  //   3. Close: clear the snapshot state, restore the engine popup by
  //      sending `viewport/occlude { rect: null }`. The engine keeps
  //      rendering through the modal lifecycle (a known cost — see
  //      todo.md §4 risk 4).
  //
  // Bridge comes from BridgeContext (NOT `window.bridge` — see L-012).
  const bridge = useBridge();
  const [snapshot, setSnapshot] = useState<{ pngBase64: string; w: number; h: number } | null>(null);
  const [viewportEl, setViewportEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!open || !bridge) return;

    // Look up the quadrant-viewport node lazily on open — App.tsx's
    // shell mounts it once at startup, so by the time any modal opens
    // it's already in the DOM. The querySelector miss is the test-env
    // path (Modal mounted in isolation without the App shell); in that
    // case viewportEl stays null and the createPortal render guards
    // skip the img output.
    const el = document.querySelector<HTMLElement>('[data-testid="quadrant-viewport"]');
    setViewportEl(el);

    let rafId: number | null = null;
    let cancelled = false;

    const captureAndOcclude = () => {
      // Engine popup → fully alpha-cut while the modal is open. The
      // full-quadrant occlude has no padding and no feather: the
      // snapshot img exactly fills the quadrant (inset:0 inside the
      // position:relative parent), so the popup boundary and the img
      // edge coincide. CSS effects above blend them.
      if (el)
      {
        const r = el.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        void bridge
          .request({
            kind: "viewport/occlude",
            params: {
              id: "modal",
              rect: {
                x: Math.round(r.left * dpr),
                y: Math.round(r.top  * dpr),
                w: Math.round(r.width  * dpr),
                h: Math.round(r.height * dpr),
              },
              feather: 0,
            },
          })
          .catch(() => { /* ignore — resize handler will retry */ });
      }
      void bridge
        .request({ kind: "viewport/capture-snapshot", params: {} })
        .then((res) => {
          if (cancelled) return;
          const snap = res as { pngBase64: string; w: number; h: number };
          setSnapshot(snap);
        })
        .catch(() => { /* MockBridge / test env — render guard short-circuits */ });
    };

    captureAndOcclude();

    // rAF-throttled re-capture: drag-resize fires resize many times per
    // frame; coalesce to one capture per frame to keep encode cost
    // bounded (~10-30 ms per 1280×720 PNG via GDI+, per todo.md §4).
    const onResize = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        captureAndOcclude();
      });
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      setSnapshot(null);
      setViewportEl(null);
      void bridge
        .request({
          kind: "viewport/occlude",
          params: { id: "modal", rect: null },
        })
        .catch(() => { /* ignore */ });
    };
  }, [open, bridge]);

  return (
    <>
      {/* B1.3.1.1 frosted-glass backdrop. Portal the snapshot <img>
          into the viewport-quadrant DOM so it sits below Dialog.Overlay
          in the same compositing tree — Dialog.Overlay's `bg-black/60
          backdrop-blur-sm` then blurs panels + snapshot uniformly. The
          render guard skips when the host returns an empty PNG
          (MockBridge, fresh engine, just-reset device). */}
      {open && viewportEl && snapshot && snapshot.pngBase64 ? createPortal(
        <img
          data-testid="modal-backdrop-snapshot"
          src={`data:image/png;base64,${snapshot.pngBase64}`}
          alt=""
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        />,
        viewportEl,
      ) : null}

      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay
            data-testid="modal-overlay"
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0"
          />
          <Dialog.Content
            // aria-describedby={undefined} opts out of Radix's accessibility
            // warning about a missing Dialog.Description. Sub-dialogs at the
            // Screen 8 batch 1 scale (About, Rescale) have no separate body
            // copy worth distinguishing from the title; the title alone is
            // sufficient SR context.
            aria-describedby={undefined}
            className={`fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 ${SIZE_CLASS[size]} max-h-[80vh] overflow-hidden rounded-lg border border-border bg-bg-2 text-text shadow-md outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95`}
          >
            {/* Header */}
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-bg-2 px-4">
              <Dialog.Title className="text-sm font-semibold text-text">
                {title}
              </Dialog.Title>
              <Dialog.Close
                aria-label="Close"
                className="flex size-6 items-center justify-center rounded text-text-2 hover:bg-panel-2 hover:text-text outline-none"
              >
                <X className="size-4" />
              </Dialog.Close>
            </div>
            {children}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function ModalBody({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-y-auto p-4" style={{ maxHeight: "calc(80vh - 48px - 56px)" }}>
      {children}
    </div>
  );
}

function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-14 shrink-0 items-center justify-end gap-2 border-t border-border bg-bg-2 px-4">
      {children}
    </div>
  );
}

type ButtonProps = {
  children?: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
};

function ModalCancelButton({ children = "Cancel", onClick, disabled }: ButtonProps) {
  // Wrap the button in Dialog.Close so clicking it always closes the modal
  // via Radix (firing onOpenChange(false)). Callers can attach onClick for
  // any extra side-effects (e.g. resetting a draft form). asChild forwards
  // the close behaviour to our styled <button>.
  return (
    <Dialog.Close asChild>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="rounded border border-border-2 bg-panel-2 px-3 py-1 text-xs text-text hover:bg-panel-3 outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {children}
      </button>
    </Dialog.Close>
  );
}

function ModalOkButton({ children = "OK", onClick, disabled }: ButtonProps) {
  // OK button does NOT auto-close. Callers fire their commit action in
  // onClick and then call onOpenChange(false) themselves. This lets a
  // caller keep the modal open on error (e.g. "rescale failed, show
  // inline error and leave dialog open").
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

// Attach compound members so consumers can write <Modal.Body /> etc.
Modal.Body = ModalBody;
Modal.Footer = ModalFooter;
Modal.CancelButton = ModalCancelButton;
Modal.OkButton = ModalOkButton;
