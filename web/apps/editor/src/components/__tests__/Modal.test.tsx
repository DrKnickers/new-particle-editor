// Vitest unit tests for the shared Modal component.
// Exercises: open prop renders content; Esc + overlay click fire
// onOpenChange(false).

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Bridge } from "@particle-editor/bridge-schema";
import { BridgeContext } from "@/lib/bridge-context";
import { Modal } from "../Modal";

function makeStubBridge() {
  const request = vi.fn().mockResolvedValue({});
  const on = vi.fn().mockReturnValue(() => {});
  return { request, on } as unknown as Bridge & {
    request: ReturnType<typeof vi.fn>;
  };
}

describe("Modal", () => {
  it("renders title and body when open={true}", () => {
    render(
      <Modal open onOpenChange={() => {}} title="Test Modal">
        <Modal.Body>
          <p>body-content</p>
        </Modal.Body>
        <Modal.Footer>
          <Modal.OkButton>OK</Modal.OkButton>
        </Modal.Footer>
      </Modal>
    );
    expect(screen.getByText("Test Modal")).toBeInTheDocument();
    expect(screen.getByText("body-content")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OK" })).toBeInTheDocument();
  });

  it("Esc key fires onOpenChange(false)", () => {
    const onOpenChange = vi.fn();
    render(
      <Modal open onOpenChange={onOpenChange} title="Test Modal">
        <Modal.Body>body</Modal.Body>
      </Modal>
    );
    // Radix Dialog listens for Escape on the document while open.
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
      code: "Escape",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // B1.3.1 polish regression guard. The Modal sits over the FD9b
  // layered engine viewport, where HTML effects (box-shadow extent
  // > occlusion pad, semi-transparent backgrounds, backdrop-filter)
  // produce visible compositing artifacts that don't appear over the
  // panel chrome. These assertions lock in the "opaque body + small
  // shadow" design choice so a future Tailwind tweak doesn't quietly
  // re-introduce a `shadow-2xl` / `bg-X/N` that breaks the visual
  // again. Architectural detail: see Modal.tsx's comment above the
  // useEffect for the alpha-cut sizing rationale.
  it("dialog body declares an opaque background", () => {
    render(
      <Modal open onOpenChange={() => {}} title="Test Modal">
        <Modal.Body>body</Modal.Body>
      </Modal>
    );
    // The body element is the rounded card itself — anchor via Radix's
    // implicit `role=dialog` (Dialog.Content). Class string check
    // beats getComputedStyle because jsdom doesn't compute Tailwind
    // utility classes; we assert the policy at the class layer.
    const content = screen.getByRole("dialog");
    expect(content.className).toContain("bg-bg-2");
    expect(content.className).not.toMatch(/bg-\w+\/\d+/); // no bg-X/N slash-opacity
    expect(content.className).not.toContain("backdrop-blur");
    expect(content.className).not.toContain("backdrop-filter");
  });

  it("dialog body uses a small drop-shadow (no shadow-xl or shadow-2xl)", () => {
    render(
      <Modal open onOpenChange={() => {}} title="Test Modal">
        <Modal.Body>body</Modal.Body>
      </Modal>
    );
    const content = screen.getByRole("dialog");
    // Larger Tailwind shadow tokens extend beyond the modal's alpha-cut
    // pad and produce a "shadow truncated by engine popup" artifact.
    // Only `shadow-sm` / `shadow` / `shadow-md` (≤ ~8 px extent) are
    // safe with the current 8 px pad in the Modal useEffect.
    expect(content.className).not.toContain("shadow-xl");
    expect(content.className).not.toContain("shadow-2xl");
  });

  it("dispatches viewport/set-modal-mask on open and clears it on close", async () => {
    // B1.3.1: the AlphaCompositor reads this to dim+blur the engine
    // viewport while the modal is open. Provide a stub bridge via
    // BridgeContext (the same plumbing App.tsx uses in prod) so
    // Modal's useEffect picks it up; verify both the open call and
    // the cleanup-on-close call hit the bridge with the expected
    // params. Magic numbers (0.4, 6 / 1.0, 0) are checked exactly —
    // if a future tweak changes the dim intensity the test should
    // be updated deliberately, not silently.
    const bridge = makeStubBridge();
    const { rerender } = render(
      <BridgeContext.Provider value={bridge}>
        <Modal open onOpenChange={() => {}} title="Test Modal">
          <Modal.Body>body</Modal.Body>
        </Modal>
      </BridgeContext.Provider>,
    );
    await waitFor(() => {
      expect(bridge.request).toHaveBeenCalledWith({
        kind: "viewport/set-modal-mask",
        params: { alpha: 0.4, blurRadius: 6 },
      });
    });
    // Close: re-render with open=false. The cleanup branch fires the
    // identity restore.
    rerender(
      <BridgeContext.Provider value={bridge}>
        <Modal open={false} onOpenChange={() => {}} title="Test Modal">
          <Modal.Body>body</Modal.Body>
        </Modal>
      </BridgeContext.Provider>,
    );
    await waitFor(() => {
      expect(bridge.request).toHaveBeenCalledWith({
        kind: "viewport/set-modal-mask",
        params: { alpha: 1.0, blurRadius: 0 },
      });
    });
  });

  it("close glyph in header fires onOpenChange(false)", () => {
    // Radix Dialog overlay-click dismissal is enforced by the
    // pointerDownOutside hook in Radix internals, which is sensitive to
    // event-construction details that jsdom doesn't perfectly emulate.
    // The user-visible contract — header X glyph also dismisses — is the
    // simpler, more stable assertion for the click-to-close path. The
    // overlay-click path is covered end-to-end by the Playwright spec
    // (dialogs.spec.ts) where a real browser fires real events.
    const onOpenChange = vi.fn();
    render(
      <Modal open onOpenChange={onOpenChange} title="Test Modal">
        <Modal.Body>body</Modal.Body>
      </Modal>
    );
    const closeBtn = screen.getByRole("button", { name: "Close" });
    fireEvent.click(closeBtn);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
