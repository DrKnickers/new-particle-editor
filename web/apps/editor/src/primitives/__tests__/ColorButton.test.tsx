// Vitest unit tests for the ColorButton primitive.
// Exercises: popover opens, basic color fires onChange, "Add to custom" fills a slot.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ColorButton } from "../ColorButton";
import { usePaletteStore } from "../palette-store";

// Reset the palette store between tests.
beforeEach(() => {
  usePaletteStore.setState({
    slots: Array(16).fill(null) as null[],
  });
});

describe("ColorButton", () => {
  it("popover opens on button click", async () => {
    render(
      <ColorButton value={{ r: 255, g: 0, b: 0 }} onChange={() => {}} aria-label="color-btn" />
    );
    const trigger = screen.getByRole("button", { name: /color-btn/i });
    await userEvent.click(trigger);
    // Radix Popover content appears in DOM after click.
    await waitFor(() => {
      expect(screen.getByText("Basic colors")).toBeInTheDocument();
    });
  });

  it("clicking a basic color fires onChange with that RGB", async () => {
    const onChange = vi.fn();
    render(
      <ColorButton value={{ r: 255, g: 0, b: 0 }} onChange={onChange} aria-label="color-btn" />
    );
    const trigger = screen.getByRole("button", { name: /color-btn/i });
    await userEvent.click(trigger);
    await waitFor(() => screen.getByText("Basic colors"));
    // The first basic color is { r:255, g:128, b:128 } — aria-label contains "#FF8080".
    const firstBasic = screen.getByRole("button", { name: /Basic color #FF8080/i });
    fireEvent.click(firstBasic);
    expect(onChange).toHaveBeenCalledWith({ r: 255, g: 128, b: 128 });
  });

  it("'Add to custom' places the picker color into the first empty custom slot", async () => {
    const onChange = vi.fn();
    render(
      <ColorButton value={{ r: 0, g: 200, b: 100 }} onChange={onChange} aria-label="color-btn" />
    );
    const trigger = screen.getByRole("button", { name: /color-btn/i });
    await userEvent.click(trigger);
    await waitFor(() => screen.getByText("Basic colors"));

    // Click "Add to custom colors" — picker's initial color is the value prop.
    const addBtn = screen.getByRole("button", { name: /Add to custom colors/i });
    fireEvent.click(addBtn);

    // Slot 0 of the palette store should now hold the value's RGB.
    const slots = usePaletteStore.getState().slots;
    expect(slots[0]).toEqual({ r: 0, g: 200, b: 100 });
  });
});
