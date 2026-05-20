// Vitest: Toolbar renders the 4 groups + ThemeToggle and dispatches
// the right bridge calls on click.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Toolbar } from "../Toolbar";
import type { Bridge } from "@particle-editor/bridge-schema";
import { __resetSpawnerVisibilityForTests } from "@/lib/spawner-visibility";

function makeBridge() {
  const snap = {
    paused: false,
    bloom: false,
    bloomAvailable: true,
    ground: true,
    heatDebug: false,
  };
  const request = vi.fn().mockImplementation((req: { kind: string }) => {
    if (req.kind === "engine/state/snapshot") return Promise.resolve(snap);
    return Promise.resolve({});
  });
  const on = vi.fn().mockReturnValue(() => {});
  return { request, on } as unknown as Bridge & { request: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  localStorage.removeItem("alo:spawner-visible");
  // The Zustand store's `visible` state is module-level and survives
  // across tests; clearing localStorage isn't enough on its own.
  __resetSpawnerVisibilityForTests();
});

describe("Toolbar — Particle Editor 2026 layout", () => {
  it("renders the file/playback/spawner groups + ThemeToggle", async () => {
    const b = makeBridge();
    render(<Toolbar bridge={b} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save As" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Step" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Step 10" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle Spawner panel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /light theme/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dark theme/i })).toBeInTheDocument();
  });

  it("Pause button dispatches engine/set/paused with paused=true", async () => {
    const b = makeBridge();
    render(<Toolbar bridge={b} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => {
      expect(b.request).toHaveBeenCalledWith({ kind: "engine/set/paused", params: { paused: true } });
    });
  });

  it("Step 10 dispatches engine/action/step-frames { frames: 10 }", async () => {
    const b = makeBridge();
    render(<Toolbar bridge={b} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Step 10" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Step 10" }));
    await waitFor(() => {
      expect(b.request).toHaveBeenCalledWith({ kind: "engine/action/step-frames", params: { frames: 10 } });
    });
  });

  it("Spawner toggle updates aria-pressed and persists to localStorage", async () => {
    const b = makeBridge();
    render(<Toolbar bridge={b} />);
    const btn = await screen.findByRole("button", { name: "Toggle Spawner panel" });
    expect(btn).toHaveAttribute("aria-pressed", "true"); // default visible
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(localStorage.getItem("alo:spawner-visible")).toBe("false");
  });
});
