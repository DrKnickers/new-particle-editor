// ViewportPill contract test (Task 2.7). Asserts the snapshot-driven
// active state of all three toggles, and that clicking the new
// "Leave particles" toggle dispatches `engine/set/leave-particles`
// with the inverted boolean — the new bridge surface this task adds.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ViewportPill } from "../ViewportPill";
import type { Bridge } from "@particle-editor/bridge-schema";

function makeBridge() {
  const snap = {
    paused: false,
    ground: true,
    bloom: false,
    leaveParticles: true,
  };
  const request = vi.fn().mockImplementation((req: { kind: string }) => {
    if (req.kind === "engine/state/snapshot") return Promise.resolve(snap);
    return Promise.resolve({});
  });
  const on = vi.fn().mockReturnValue(() => {});
  return { request, on } as unknown as Bridge & {
    request: ReturnType<typeof vi.fn>;
  };
}

describe("ViewportPill", () => {
  it("renders the 3 toggle buttons with current state", async () => {
    const b = makeBridge();
    render(<ViewportPill bridge={b} />);
    await waitFor(() => {
      const ground = screen.getByRole("button", { name: "Show ground" });
      expect(ground).toHaveAttribute("aria-pressed", "true");
    });
    expect(
      screen.getByRole("button", { name: "Toggle bloom" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", {
        name: "Leave particles after instance death",
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking Leave particles dispatches engine/set/leave-particles { enabled: false }", async () => {
    const b = makeBridge();
    render(<ViewportPill bridge={b} />);
    const btn = await screen.findByRole("button", {
      name: "Leave particles after instance death",
    });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(b.request).toHaveBeenCalledWith({
        kind: "engine/set/leave-particles",
        params: { enabled: false },
      });
    });
  });
});
