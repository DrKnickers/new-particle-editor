// ToolPanel — shared shell for the Screen 8 Batch 2 modeless tool
// windows (Lighting, Bloom Settings, Ground Texture, Background).
//
// Lives under `components/` (app-shell-style), not `primitives/`,
// because it owns layout positioning (absolute-right, full-height of
// the main row) and is opinionated about chrome — not a reusable atom
// like Spinner or ColorButton.
//
// Compound API:
//   <ToolPanel title="Lighting" onClose={() => setOpenToolPanel(null)}>
//     <ToolPanel.Section title="Sun">...</ToolPanel.Section>
//     ...
//   </ToolPanel>
//
// Chrome cues borrowed from BackgroundPicker (the pre-existing
// reference implementation): 320 px wide, dark surface, 48 px header
// with title + `×` close glyph, scrollable body. The 48 px header height
// matches the shared Modal so the eye reads them as the same family
// even though one is portalled overlay and the other slides over the
// main row.
//
// The host is non-modal: the user can interact with the viewport,
// menus, and other UI freely while a ToolPanel is open. Esc and
// click-outside intentionally do NOT dismiss — the user dismisses via
// the `×` glyph or by re-toggling the launcher (e.g. clicking the
// Background pill again, picking a different Tools-menu entry).

import { X } from "lucide-react";
import type { ReactNode } from "react";

type ToolPanelProps = {
  title: string;
  onClose: () => void;
  children?: ReactNode;
};

const HEADER_HEIGHT_PX = 48;

export function ToolPanel({ title, onClose, children }: ToolPanelProps) {
  return (
    <div
      className="absolute right-0 top-0 bottom-0 z-10 flex w-80 flex-col border-l border-neutral-800 bg-neutral-950 text-neutral-100"
      role="dialog"
      aria-label={title}
    >
      {/* Header — mirrors Modal's header layout (48 px, title left, X right). */}
      <div
        className="flex shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-900 px-4"
        style={{ height: HEADER_HEIGHT_PX }}
      >
        <span className="text-sm font-semibold text-neutral-100">{title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex size-6 items-center justify-center rounded text-neutral-400 outline-none hover:bg-neutral-800 hover:text-neutral-100"
        >
          <X className="size-4" />
        </button>
      </div>
      {/* Body — scrolls independently when content overflows the panel
          height. The 48 px subtraction keeps the scrollbar inside the
          body so the header stays pinned to the top. */}
      <div
        className="flex-1 overflow-y-auto p-3"
        style={{ height: `calc(100% - ${HEADER_HEIGHT_PX}px)` }}
      >
        {children}
      </div>
    </div>
  );
}

type ToolPanelSectionProps = {
  title: string;
  defaultOpen?: boolean;
  /** When true, the section renders flat (no <details>/<summary>); use
   *  for sections that are always visible like Ambient / Shadow. */
  alwaysOpen?: boolean;
  children?: ReactNode;
};

function ToolPanelSection({
  title,
  defaultOpen = false,
  alwaysOpen = false,
  children,
}: ToolPanelSectionProps) {
  if (alwaysOpen) {
    return (
      <section className="mb-3 rounded-md border border-neutral-800 bg-neutral-900/40">
        <div className="border-b border-neutral-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-300">
          {title}
        </div>
        <div className="space-y-2 p-3">{children}</div>
      </section>
    );
  }
  return (
    <details
      open={defaultOpen}
      className="group mb-3 rounded-md border border-neutral-800 bg-neutral-900/40 [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex cursor-pointer select-none items-center justify-between border-b border-neutral-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-300 outline-none">
        <span>{title}</span>
        <span
          aria-hidden="true"
          className="text-neutral-500 transition-transform group-open:rotate-90"
        >
          ›
        </span>
      </summary>
      <div className="space-y-2 p-3">{children}</div>
    </details>
  );
}

type ToolPanelFooterProps = { children?: ReactNode };

function ToolPanelFooter({ children }: ToolPanelFooterProps) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-3">
      {children}
    </div>
  );
}

type ToolPanelRowProps = {
  label: string;
  children?: ReactNode;
};

/** Two-column row helper: label on left, control on right. */
function ToolPanelRow({ label, children }: ToolPanelRowProps) {
  return (
    <div className="grid grid-cols-[80px_1fr] items-center gap-2">
      <span className="text-[11px] text-neutral-400">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

ToolPanel.Section = ToolPanelSection;
ToolPanel.Footer = ToolPanelFooter;
ToolPanel.Row = ToolPanelRow;
