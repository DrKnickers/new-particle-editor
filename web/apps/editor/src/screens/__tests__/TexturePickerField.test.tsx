// Vitest specs for TexturePickerField — the color/bump texture field
// with a Browse button (sub-feature A of texture-selection parity).
//
// The Browse button calls `onBrowse(slot)` (which, in production, fires
// the host-side `textures/browse` dialog) and commits the returned
// basename via `onCommit` — but only when non-empty. An empty string
// (cancelled dialog / browser-mode no-op) must NOT commit, so a
// cancelled Browse never clears or overwrites the existing value.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TexturePickerField } from "../EmitterPropertyTabs";

describe("TexturePickerField — Browse button", () => {
  it("renders the label, the text input (bound to value), and a Browse button", () => {
    render(
      <TexturePickerField
        label="Color texture:"
        slot="color"
        value="p_smoke_atlas_02.dds"
        onCommit={vi.fn()}
        onBrowse={vi.fn(async () => "")}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Color texture:" });
    expect((input as HTMLInputElement).value).toBe("p_smoke_atlas_02.dds");
    expect(
      screen.getByRole("button", { name: "Browse for Color texture:" }),
    ).toBeTruthy();
  });

  it("commits the picked basename when Browse resolves non-empty, passing the slot", async () => {
    const onCommit = vi.fn();
    const onBrowse = vi.fn(async () => "p_explosion_atlas_02.dds");
    render(
      <TexturePickerField
        label="Color texture:"
        slot="color"
        value=""
        onCommit={onCommit}
        onBrowse={onBrowse}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Browse for Color texture:" }));
    await waitFor(() =>
      expect(onCommit).toHaveBeenCalledWith("p_explosion_atlas_02.dds"),
    );
    expect(onBrowse).toHaveBeenCalledWith("color");
  });

  it("does NOT commit when Browse resolves empty (cancelled / browser-mode)", async () => {
    const onCommit = vi.fn();
    const onBrowse = vi.fn(async () => "");
    render(
      <TexturePickerField
        label="Bump texture:"
        slot="bump"
        value="existing.dds"
        onCommit={onCommit}
        onBrowse={onBrowse}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Browse for Bump texture:" }));
    await waitFor(() => expect(onBrowse).toHaveBeenCalledWith("bump"));
    expect(onCommit).not.toHaveBeenCalled();
  });
});
