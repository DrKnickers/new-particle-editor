import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Section } from "../Section";

describe("Section", () => {
  it("renders open by default with children visible", () => {
    render(<Section title="Emitter Timing"><div>child</div></Section>);
    expect(screen.getByText("Emitter Timing")).toBeInTheDocument();
    expect(screen.getByText("child")).toBeInTheDocument();
  });

  it("clicking the header collapses the section (children hidden)", () => {
    render(<Section title="Generation"><div>child</div></Section>);
    const header = screen.getByTestId("section-generation");
    fireEvent.click(header);
    expect(screen.queryByText("child")).not.toBeInTheDocument();
  });

  it("clicking again expands the section back", () => {
    render(<Section title="Forces"><div>child</div></Section>);
    const header = screen.getByTestId("section-forces");
    fireEvent.click(header);
    fireEvent.click(header);
    expect(screen.getByText("child")).toBeInTheDocument();
  });

  it("pressing Enter on the focused header toggles", () => {
    render(<Section title="Render"><div>child</div></Section>);
    const header = screen.getByTestId("section-render");
    fireEvent.keyDown(header, { key: "Enter" });
    expect(screen.queryByText("child")).not.toBeInTheDocument();
  });

  it("pressing Space on the focused header toggles", () => {
    render(<Section title="Texture"><div>child</div></Section>);
    const header = screen.getByTestId("section-texture");
    fireEvent.keyDown(header, { key: " " });
    expect(screen.queryByText("child")).not.toBeInTheDocument();
  });

  it("aria-expanded reflects open/closed state", () => {
    render(<Section title="Color"><div>child</div></Section>);
    const header = screen.getByTestId("section-color");
    expect(header).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
  });

  it("collapsed state flips data-open on the section container (drives chevron rotation in CSS)", () => {
    // B1.3.2: rotation is driven by `[data-open="false"]` on .panel-section
    // (matching the `:not([open])` selector for native <details> in the
    // shared CSS). The .collapsed modifier class is gone.
    const { container } = render(<Section title="Collision"><div>child</div></Section>);
    const section = container.querySelector(".panel-section");
    expect(section).toHaveAttribute("data-open", "true");
    const header = screen.getByTestId("section-collision");
    fireEvent.click(header);
    expect(section).toHaveAttribute("data-open", "false");
  });

  it("respects defaultOpen=false", () => {
    render(<Section title="Turbulence" defaultOpen={false}><div>child</div></Section>);
    expect(screen.queryByText("child")).not.toBeInTheDocument();
    const header = screen.getByTestId("section-turbulence");
    expect(header).toHaveAttribute("aria-expanded", "false");
  });
});
