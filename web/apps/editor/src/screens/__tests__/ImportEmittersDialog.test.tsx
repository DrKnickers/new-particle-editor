// Vitest tests for ImportEmittersDialog (Phase 3 Screen 8 Batch 4).
//
// Coverage:
//   1. Clicking "Browse…" fires `file/open`.
//   2. OK button starts disabled (no selection); rendered label is
//      the plain "Import" placeholder while picks.size is 0.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Bridge } from "@particle-editor/bridge-schema";
import { ImportEmittersDialog } from "../ImportEmittersDialog";

function makeStubBridge(): Bridge & {
  request: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
} {
  return {
    request: vi.fn().mockImplementation((req: { kind: string }) => {
      // Default: file/open returns ok:false so the test doesn't need
      // to mock the preview round-trip. Tests that need preview can
      // override the mock per-call.
      if (req.kind === "file/open") {
        return Promise.resolve({ ok: false, error: "browser-mode" });
      }
      return Promise.resolve({});
    }),
    on: vi.fn().mockReturnValue(() => {}),
  } as unknown as Bridge & {
    request: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };
}

describe("ImportEmittersDialog", () => {
  it("Browse… click fires file/open", async () => {
    const bridge = makeStubBridge();
    render(
      <ImportEmittersDialog bridge={bridge} open onOpenChange={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Browse/ }));

    await waitFor(() => {
      const calls = bridge.request.mock.calls.map((c) => c[0] as { kind: string });
      expect(calls.some((c) => c.kind === "file/open")).toBe(true);
    });
  });

  it("OK button is disabled when 0 emitters are selected", () => {
    const bridge = makeStubBridge();
    render(
      <ImportEmittersDialog bridge={bridge} open onOpenChange={() => {}} />,
    );

    // The OK button's accessible name is the dynamic "Import" label.
    const ok = screen.getByRole("button", { name: /^Import$/ });
    expect(ok).toBeDisabled();
  });
});
