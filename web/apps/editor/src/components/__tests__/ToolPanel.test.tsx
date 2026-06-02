// Vitest unit tests for the shared ToolPanel shell.
// Verifies the compound API renders correctly and the close glyph
// fires onClose. The single-open-panel host behaviour (mutual
// exclusion between panels) is covered by an integration assertion at
// the bottom using the Zustand atom directly.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToolPanel } from "../ToolPanel";
import {
  setOpenToolPanel,
  useToolPanelStore,
} from "@/lib/tool-panel";

describe("ToolPanel", () => {
  it("renders the title in the header", () => {
    render(
      <ToolPanel title="Lighting" onClose={() => {}}>
        <p>body</p>
      </ToolPanel>,
    );
    expect(screen.getByRole("dialog", { name: "Lighting" })).toBeInTheDocument();
    expect(screen.getByText("Lighting")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("clicking the close glyph fires onClose", () => {
    const onClose = vi.fn();
    render(
      <ToolPanel title="Bloom" onClose={onClose}>
        body
      </ToolPanel>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("switching the openToolPanel atom from 'background' to 'ground' causes background to clear", () => {
    // The atom enforces single-open semantics: setting one value
    // replaces the previous one. The PanelLayout host renders the matching
    // overlay by reading this atom; the unit-level proof is just that
    // the atom value transitions and never holds two ids at once.
    // (Lighting + Bloom left this store in session 11 — they're a docked
    // pane in lib/right-dock now; only Background + Ground remain here.)
    setOpenToolPanel("background");
    expect(useToolPanelStore.getState().open).toBe("background");
    setOpenToolPanel("ground");
    expect(useToolPanelStore.getState().open).toBe("ground");
    setOpenToolPanel(null);
    expect(useToolPanelStore.getState().open).toBeNull();
  });

  it("variant='docked' fills its column (h-full w-full, not absolute overlay)", () => {
    render(
      <ToolPanel title="Lighting" onClose={() => {}} variant="docked">
        body
      </ToolPanel>,
    );
    const dialog = screen.getByRole("dialog", { name: "Lighting" });
    expect(dialog.className).toContain("h-full");
    expect(dialog.className).toContain("w-full");
    expect(dialog.className).not.toContain("absolute");
  });

  it("default (overlay) variant is absolute-positioned", () => {
    render(
      <ToolPanel title="Background" onClose={() => {}}>
        body
      </ToolPanel>,
    );
    const dialog = screen.getByRole("dialog", { name: "Background" });
    expect(dialog.className).toContain("absolute");
  });
});
