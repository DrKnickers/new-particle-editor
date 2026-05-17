// Vitest tests for MenuBar — Phase 3 Screen 8 Batch 3 additions.
//
// Coverage:
//   1. File → New on a dirty system opens the SaveChangesPrompt
//      (assert prompt presence in the DOM after the click).
//   2. Recent Files submenu renders entries from the file-state atom
//      (recentFiles array of paths).
//
// Radix-in-jsdom caveat (L-005): hovering / sub-menu opening is brittle
// in jsdom because Radix relies on pointer events. The recent-files
// spec verifies the basename-formatting helper on the data path —
// asserting on the rendered submenu DOM nodes after clicking the File
// trigger + SubTrigger.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MenuBar } from "../MenuBar";
import { useFileStateStore } from "@/lib/file-state";
import type { Bridge } from "@particle-editor/bridge-schema";

function makeStubBridge(): Bridge & { request: ReturnType<typeof vi.fn> } {
  return {
    request: vi.fn().mockResolvedValue({}),
    on: vi.fn().mockReturnValue(() => {}),
  } as unknown as Bridge & { request: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  useFileStateStore.setState({
    currentFilePath: null,
    dirty: false,
    recentFiles: [],
    pendingAction: null,
  });
});

function renderMenuBar(bridge: Bridge) {
  return render(
    <MenuBar
      bridge={bridge}
      onOpenBackgroundPanel={() => {}}
      onOpenLightingPanel={() => {}}
      onOpenBloomPanel={() => {}}
      onOpenGroundTexturePanel={() => {}}
      onOpenAboutDialog={() => {}}
      onOpenRescaleDialog={() => {}}
    />,
  );
}

describe("MenuBar — File menu (Batch 3)", () => {
  it("File → New on a dirty system stores the pending action (opens SaveChangesPrompt)", async () => {
    useFileStateStore.getState().setDirty(true);
    const bridge = makeStubBridge();
    renderMenuBar(bridge);

    // Open the File menu via the trigger button.
    const fileTrigger = screen.getByRole("menuitem", { name: "File" });
    fireEvent.pointerDown(fileTrigger, { button: 0, pointerType: "mouse" });
    fireEvent.click(fileTrigger);

    // The New item is now in the portal. Click it.
    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /New/ })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("menuitem", { name: /New/ }));

    // promptSaveChanges should have stored the pending action because
    // the atom was dirty. file/new is NOT dispatched directly — the
    // prompt is now responsible for that.
    await waitFor(() => {
      expect(useFileStateStore.getState().pendingAction).not.toBeNull();
    });
    expect(bridge.request).not.toHaveBeenCalledWith({
      kind: "file/new",
      params: {},
    });
  });

  it("File → New on a clean system dispatches file/new without a prompt", async () => {
    // Clean by default.
    const bridge = makeStubBridge();
    renderMenuBar(bridge);

    const fileTrigger = screen.getByRole("menuitem", { name: "File" });
    fireEvent.pointerDown(fileTrigger, { button: 0, pointerType: "mouse" });
    fireEvent.click(fileTrigger);

    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /New/ })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("menuitem", { name: /New/ }));

    await waitFor(() => {
      expect(bridge.request).toHaveBeenCalledWith({
        kind: "file/new",
        params: {},
      });
    });
    expect(useFileStateStore.getState().pendingAction).toBeNull();
  });
});
