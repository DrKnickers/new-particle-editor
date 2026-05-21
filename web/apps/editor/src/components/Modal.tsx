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
import { useRef, type ReactNode, type MouseEventHandler } from "react";
import type { Bridge } from "@particle-editor/bridge-schema";
import { useViewportOcclusion } from "@/lib/viewport-occlusion";

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
  // FD9b: the engine viewport renders as a layered window on top of
  // WebView2. Without registering the modal's full-screen overlay with
  // the AlphaCompositor, the viewport paints over the modal and only
  // the modal's bottom edge (outside the viewport quadrant) shows.
  // Read bridge from window.bridge — set unconditionally by App.tsx
  // at startup — so we don't have to drill `bridge` through every
  // modal caller for what's a UI-layer concern. useViewportOcclusion
  // early-returns when bridge is undefined (test envs without the
  // bridge expose), so this is safe in vitest too.
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const bridge =
    typeof window !== "undefined"
      ? (window as Window & { bridge?: Bridge }).bridge
      : undefined;
  useViewportOcclusion(open ? bridge : undefined, "modal", overlayRef, 0, 0);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          ref={overlayRef}
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
          className={`fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 ${SIZE_CLASS[size]} max-h-[80vh] overflow-hidden rounded-lg border border-border bg-bg-2 text-text shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95`}
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
