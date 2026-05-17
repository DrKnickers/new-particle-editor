// Vitest unit tests for the Spinner primitive.
// Exercises: blur-clamping, scroll-wheel increment, scientific notation parse.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Spinner } from "../Spinner";

describe("Spinner", () => {
  it("commit-on-blur clamps value to max", async () => {
    const onChange = vi.fn();
    render(
      <Spinner value={5} onChange={onChange} max={10} aria-label="test-spinner" />
    );
    const input = screen.getByRole("textbox");
    // Focus, type a value above max, blur to commit.
    await userEvent.click(input);
    await userEvent.clear(input);
    await userEvent.type(input, "999");
    fireEvent.blur(input);
    // onChange should be called with the clamped value.
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("scroll-wheel up increments by step", () => {
    const onChange = vi.fn();
    render(
      <Spinner value={5} onChange={onChange} step={1} aria-label="test-spinner" />
    );
    const input = screen.getByRole("textbox");
    // Wheel deltaY < 0 = scroll up = increment.
    fireEvent.wheel(input, { deltaY: -100 });
    expect(onChange).toHaveBeenCalledWith(6);
  });

  it("scientific notation '2.5e3' parses to 2500 on blur", async () => {
    const onChange = vi.fn();
    render(
      <Spinner value={0} onChange={onChange} decimals={0} aria-label="test-spinner" />
    );
    const input = screen.getByRole("textbox");
    await userEvent.click(input);
    await userEvent.clear(input);
    await userEvent.type(input, "2.5e3");
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(2500);
  });
});
