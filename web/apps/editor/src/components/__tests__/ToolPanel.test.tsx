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

  it("switching the openToolPanel atom from 'background' to 'lighting' causes background to clear", () => {
    // The atom enforces single-open semantics: setting one value
    // replaces the previous one. The App.tsx host renders the matching
    // panel by reading this atom; the unit-level proof is just that
    // the atom value transitions and never holds two ids at once.
    setOpenToolPanel("background");
    expect(useToolPanelStore.getState().open).toBe("background");
    setOpenToolPanel("lighting");
    expect(useToolPanelStore.getState().open).toBe("lighting");
    setOpenToolPanel(null);
    expect(useToolPanelStore.getState().open).toBeNull();
  });
});
