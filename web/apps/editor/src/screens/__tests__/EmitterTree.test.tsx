// Vitest unit tests for the EmitterTree sidebar (Phase 3 Screen 4
// Batch A). Verifies the fixture tree renders 3 roots with their
// children at the right indentation and that clicking a row fires
// emitters/select with the row's id.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, createEvent } from "@testing-library/react";
import type { Bridge, EmitterTreeDto } from "@particle-editor/bridge-schema";
import { EmitterTree } from "../EmitterTree";
import { useEmitterSelectionStore } from "@/lib/emitter-selection";

function fixtureTree(): EmitterTreeDto {
  return {
    root: {
      id: -1, name: "", role: "root", linkGroup: 0, visible: true,
      children: [
        {
          id: 0, name: "Smoke", role: "root", linkGroup: 1, visible: true,
          children: [
            { id: 1, name: "Smoke embers", role: "lifetime", linkGroup: 0, visible: true, children: [] },
            { id: 2, name: "Smoke puff",   role: "death",    linkGroup: 0, visible: true, children: [] },
          ],
        },
        {
          id: 3, name: "Sparks", role: "root", linkGroup: 1, visible: true,
          children: [
            { id: 4, name: "Spark trail", role: "lifetime", linkGroup: 0, visible: true, children: [] },
          ],
        },
        {
          id: 5, name: "Flash", role: "root", linkGroup: 0, visible: true,
          children: [],
        },
      ],
    },
  };
}

function makeStubBridge() {
  const tree = fixtureTree();
  const snapshot = { selectedEmitterId: null };
  return {
    request: vi.fn().mockImplementation((req: { kind: string }) => {
      if (req.kind === "emitters/list") return Promise.resolve(tree);
      if (req.kind === "engine/state/snapshot") return Promise.resolve(snapshot);
      if (req.kind === "emitters/select") return Promise.resolve({});
      return Promise.resolve({});
    }),
    on: vi.fn().mockReturnValue(() => {}),
  } as unknown as Bridge & { request: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  // The multi-select atom is module-scoped; reset between tests so
  // state mutations from prior cases don't leak.
  useEmitterSelectionStore.getState().clear();
});

describe("EmitterTree", () => {
  it("renders 3 root rows with their lifetime/death children", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);

    // Wait for the async emitters/list to resolve.
    await waitFor(() => {
      expect(screen.getByText("Smoke")).toBeInTheDocument();
    });
    expect(screen.getByText("Sparks")).toBeInTheDocument();
    expect(screen.getByText("Flash")).toBeInTheDocument();
    // Smoke's children render.
    expect(screen.getByText("Smoke embers")).toBeInTheDocument();
    expect(screen.getByText("Smoke puff")).toBeInTheDocument();
    // Sparks' single lifetime child.
    expect(screen.getByText("Spark trail")).toBeInTheDocument();

    // Tree wrapper exists with the correct role.
    expect(screen.getByRole("tree", { name: "Emitters" })).toBeInTheDocument();

    // Six total emitter rows (treeitem each). Synthetic root is NOT
    // rendered as a row.
    const items = screen.getAllByRole("treeitem");
    expect(items).toHaveLength(6);
  });

  it("clicking a row fires emitters/select with the row's id", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Smoke embers")).toBeInTheDocument();
    });

    // Click Smoke embers (id=1).
    fireEvent.click(screen.getByText("Smoke embers"));

    const calls = (bridge.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const selectCall = calls.find((c) => c.kind === "emitters/select");
    expect(selectCall).toBeDefined();
    expect(selectCall.params).toEqual({ id: 1 });
  });

  // ─── Batch B2 — multi-select via Ctrl/Cmd + Shift modifiers ──────

  it("Ctrl+click on an unselected row toggles it into the multi-selection (primary updates)", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Smoke")).toBeInTheDocument();
    });
    // Establish a primary by clicking Smoke (id=0) first.
    fireEvent.click(screen.getByText("Smoke"));
    // Ctrl+click Sparks (id=3) — should add it without dropping Smoke.
    fireEvent.click(screen.getByText("Sparks"), { ctrlKey: true });

    const sel = useEmitterSelectionStore.getState();
    expect(sel.ids).toEqual([0, 3]);
    expect(sel.primary).toBe(3);

    // data-selected-count is visible on the container.
    const tree = screen.getByTestId("emitter-tree");
    expect(tree.getAttribute("data-selected-count")).toBe("2");
    expect(tree.getAttribute("data-primary-id")).toBe("3");
  });

  // ─── Batch B3 — drag/drop reorder + reparent ─────────────────────

  /** Stub the row's getBoundingClientRect so the drop-zone math has a
   *  predictable rectangle. The component reads clientY relative to
   *  the rect; pass an explicit clientY in the event payload. */
  function stubRect(el: HTMLElement, top: number, height: number) {
    Object.defineProperty(el, "getBoundingClientRect", {
      configurable: true,
      writable: true,
      value: () => ({
        top,
        bottom: top + height,
        left: 0,
        right: 200,
        width: 200,
        height,
        x: 0,
        y: top,
        toJSON: () => "{}",
      }),
    });
  }

  /** Dispatch a DragEvent on `target` with clientY + a stub
   *  dataTransfer. Uses `createEvent` so we can attach the
   *  non-default dataTransfer and reliably set clientY (jsdom's
   *  DragEvent constructor doesn't always copy MouseEvent props in
   *  every Node version). */
  function dispatchDrag(
    type: "dragStart" | "dragOver" | "drop" | "dragEnd" | "dragLeave",
    target: HTMLElement,
    clientY: number,
  ) {
    const ev = createEvent[type](target, { clientY, bubbles: true });
    // Force clientY in case the synthetic event omits it.
    Object.defineProperty(ev, "clientY", {
      value: clientY,
      configurable: true,
    });
    const store = new Map<string, string>();
    Object.defineProperty(ev, "dataTransfer", {
      value: {
        effectAllowed: "none",
        dropEffect: "none",
        setData: (t: string, v: string) => { store.set(t, v); },
        getData: (t: string) => store.get(t) ?? "",
        types: [] as readonly string[],
      },
      configurable: true,
    });
    fireEvent(target, ev);
  }

  it("dropping in the upper third of a root fires emitters/drop reorder above", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Sparks")).toBeInTheDocument();
    });

    // Drag Flash (id=5) onto Sparks (id=3) upper third → reorder ABOVE
    // Sparks (gap index = Sparks' position in roots = 1).
    const flashBtn  = screen.getByText("Flash").closest("button")!;
    const sparksBtn = screen.getByText("Sparks").closest("button")!;
    stubRect(sparksBtn, 100, 30);  // y range [100, 130), thirds at 10

    dispatchDrag("dragStart", flashBtn, 0);
    dispatchDrag("dragOver",  sparksBtn, 103);  // y=3 within row → above
    dispatchDrag("drop",      sparksBtn, 103);

    const calls = (bridge.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const dropCall = calls.find((c) => c.kind === "emitters/drop");
    expect(dropCall).toBeDefined();
    expect(dropCall.params).toEqual({
      mode: "reorder",
      id: 5,
      rootIndex: 1,  // gap before Sparks (Sparks is at root idx 1)
    });
  });

  it("dropping in the middle third of a root fires emitters/drop reparent with auto-picked slot", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Flash")).toBeInTheDocument();
    });

    // Drag Flash (id=5) onto Sparks (id=3) middle third → reparent
    // under Sparks. Sparks has a lifetime child only, so the auto-pick
    // resolves to "death".
    const flashBtn  = screen.getByText("Flash").closest("button")!;
    const sparksBtn = screen.getByText("Sparks").closest("button")!;
    stubRect(sparksBtn, 100, 30);  // middle third is [10, 20)

    dispatchDrag("dragStart", flashBtn, 0);
    dispatchDrag("dragOver",  sparksBtn, 115);  // y=15 within row → onto
    dispatchDrag("drop",      sparksBtn, 115);

    const calls = (bridge.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const dropCall = calls.find((c) => c.kind === "emitters/drop");
    expect(dropCall).toBeDefined();
    expect(dropCall.params).toEqual({
      mode: "reparent",
      id: 5,
      targetId: 3,
      slot: "death",
    });
  });

  it("Shift+click on a downstream row selects the range from primary to clicked", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Smoke")).toBeInTheDocument();
    });
    // Primary = Smoke (id=0).
    fireEvent.click(screen.getByText("Smoke"));
    // Shift+click Spark trail (id=4). Tree order:
    //   Smoke(0), Smoke embers(1), Smoke puff(2), Sparks(3), Spark trail(4), Flash(5).
    fireEvent.click(screen.getByText("Spark trail"), { shiftKey: true });

    const sel = useEmitterSelectionStore.getState();
    expect(sel.ids).toEqual([0, 1, 2, 3, 4]);
    expect(sel.primary).toBe(4);
  });

  // ─── Batch C — link-group brackets ───────────────────────────────

  it("renders link-group brackets in the right gutter for grouped rows", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Smoke")).toBeInTheDocument();
    });
    // Fixture: Smoke (id=0) + Sparks (id=3) share linkGroup=1. Flash
    // (id=5) is unlinked. We expect exactly one bracket descriptor
    // (group 1) in the gutter.
    const gutter = screen.getByTestId("link-group-bracket-gutter");
    expect(gutter).toBeInTheDocument();
    const bracket1 = screen.getByTestId("link-group-bracket-1");
    expect(bracket1).toBeInTheDocument();
    expect(bracket1.getAttribute("data-link-group")).toBe("1");
    // No bracket for group 0 (unlinked) or any other group.
    expect(screen.queryByTestId("link-group-bracket-0")).toBeNull();
    expect(screen.queryByTestId("link-group-bracket-2")).toBeNull();
  });

  it("gutter container width tracks the number of lanes in use", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Smoke")).toBeInTheDocument();
    });

    // The fixture tree puts Smoke (id 0) and Sparks (id 3) both in
    // link group 1. That's a single 2-lane bracket. laneCount = 1
    // → gutterPx = 1 * 10 + 4 = 14.
    const gutter = screen.getByTestId("link-group-bracket-gutter");
    expect(gutter).toBeInTheDocument();
    expect((gutter as HTMLElement).style.width).toBe("14px");
  });

  it("rendered brackets carry a data-lane attribute matching their assigned lane", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Smoke")).toBeInTheDocument();
    });

    // Group 1 spans Smoke (row 0) → Sparks (row 3). Only one group
    // visible in the fixture → lane 0.
    const bracket = screen.getByTestId("link-group-bracket-1");
    expect(bracket).toHaveAttribute("data-lane", "0");
  });

  // ─── Batch C — inline rename ─────────────────────────────────────

  it("F2 on the focused row enters inline rename mode (input renders with current name)", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Smoke")).toBeInTheDocument();
    });
    // Focus the Smoke row (id=0) via click.
    fireEvent.click(screen.getByText("Smoke"));
    // Fire F2 on the tree container (the keydown handler is attached
    // to the container, not the row).
    const tree = screen.getByTestId("emitter-tree");
    fireEvent.keyDown(tree, { key: "F2" });

    const input = screen.getByTestId("emitter-rename-input-0") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe("Smoke");
  });

  it("Enter on the inline-rename input commits via emitters/rename", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Smoke")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Smoke"));
    fireEvent.keyDown(screen.getByTestId("emitter-tree"), { key: "F2" });

    const input = screen.getByTestId("emitter-rename-input-0") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Smoke 2" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const calls = (bridge.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const renameCall = calls.find((c) => c.kind === "emitters/rename");
    expect(renameCall).toBeDefined();
    expect(renameCall.params).toEqual({ id: 0, name: "Smoke 2" });
  });

  it("Esc on the inline-rename input cancels (no emitters/rename dispatched)", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Smoke")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Smoke"));
    fireEvent.keyDown(screen.getByTestId("emitter-tree"), { key: "F2" });

    const input = screen.getByTestId("emitter-rename-input-0") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Smoke 2" } });
    fireEvent.keyDown(input, { key: "Escape" });

    // The input should be gone (cancel returns to label view).
    expect(screen.queryByTestId("emitter-rename-input-0")).toBeNull();
    // No rename request fired.
    const calls = (bridge.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(calls.find((c) => c.kind === "emitters/rename")).toBeUndefined();
  });

  // ─── Batch C — keyboard nav ──────────────────────────────────────

  it("ArrowDown on the tree shifts primary to the next row in flat order", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Smoke")).toBeInTheDocument();
    });
    // Click Smoke first (focus + primary = 0). Tree order:
    //   Smoke(0), Smoke embers(1), Smoke puff(2), Sparks(3), Spark trail(4), Flash(5).
    fireEvent.click(screen.getByText("Smoke"));
    const tree = screen.getByTestId("emitter-tree");
    // Stub the row button focus, since we don't actually need DOM
    // focus to change — the handler updates the React-side primary.
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    expect(useEmitterSelectionStore.getState().primary).toBe(1);
  });

  // ─── Batch C — Ctrl+C clipboard dispatch ─────────────────────────

  it("Ctrl+C on the tree dispatches emitters/copy with the current selection ids", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Smoke")).toBeInTheDocument();
    });
    // Select Smoke (id=0) + Sparks (id=3) via plain + Ctrl+click.
    fireEvent.click(screen.getByText("Smoke"));
    fireEvent.click(screen.getByText("Sparks"), { ctrlKey: true });
    const tree = screen.getByTestId("emitter-tree");
    fireEvent.keyDown(tree, { key: "c", ctrlKey: true });

    const calls = (bridge.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const copyCall = calls.find((c) => c.kind === "emitters/copy");
    expect(copyCall).toBeDefined();
    expect(copyCall.params).toEqual({ ids: [0, 3] });
  });

  // ─── Task 5 — per-row visibility eye button ──────────────────────

  it("each row renders a per-row visibility eye button", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Smoke")).toBeInTheDocument();
    });

    // 6 emitter rows in the fixture → 6 eye buttons.
    expect(screen.getByTestId("emitter-vis-0")).toBeInTheDocument();  // Smoke
    expect(screen.getByTestId("emitter-vis-1")).toBeInTheDocument();  // Smoke embers
    expect(screen.getByTestId("emitter-vis-3")).toBeInTheDocument();  // Sparks
  });

  it("clicking the per-row eye dispatches emitters/set-visible with toggled state", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Smoke")).toBeInTheDocument();
    });

    // Smoke (id=0) is `visible: true` in the fixture → click should
    // dispatch { visible: false }.
    fireEvent.click(screen.getByTestId("emitter-vis-0"));

    const calls = (bridge.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const setVis = calls.find((c) => c.kind === "emitters/set-visible");
    expect(setVis).toBeDefined();
    expect(setVis!.params).toEqual({ id: 0, visible: false });
  });

  it("clicking the per-row eye does NOT change selection", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Smoke")).toBeInTheDocument();
    });

    // Before click: selection is empty (beforeEach clears the store).
    expect(useEmitterSelectionStore.getState().primary).toBeNull();

    fireEvent.click(screen.getByTestId("emitter-vis-1"));  // Smoke embers

    // Selection still empty — no emitters/select dispatched as a side effect.
    expect(useEmitterSelectionStore.getState().primary).toBeNull();
    const calls = (bridge.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(calls.find((c) => c.kind === "emitters/select")).toBeUndefined();
  });

  it("per-row link-group dot is no longer rendered (gutter brackets are the only affordance)", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Smoke")).toBeInTheDocument();
    });

    // The legacy per-row dot used `aria-label="Link group N"`. No
    // element should match that pattern any more.
    const dots = screen.queryAllByLabelText(/^Link group \d+$/);
    expect(dots).toHaveLength(0);
  });

  it("row uses a 3-column grid (eye / name / spawn-role glyph) — F1", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Smoke")).toBeInTheDocument();
    });

    // Each row's outer button carries the grid template via inline style.
    const rowButton = screen.getByText("Smoke").closest("button")!;
    expect(rowButton.style.gridTemplateColumns).toBe("18px 1fr 18px");

    // F1: the visibility toggle is the FIRST column (moved to the left,
    // replacing the old role dot).
    expect(rowButton.firstElementChild).toBe(
      rowButton.querySelector('[data-testid="emitter-vis-0"]'),
    );
    // Root rows no longer render a role glyph; children show theirs
    // (lifetime ↻ / on-death ✕) on the right.
    expect(screen.queryByLabelText("root emitter")).toBeNull();
    // Fixture has 2 lifetime children (Smoke embers, Spark trail) + 1
    // death child (Smoke puff), each rendering its spawn-role glyph.
    expect(screen.getAllByLabelText("lifetime child")).toHaveLength(2);
    expect(screen.getAllByLabelText("death child")).toHaveLength(1);
  });

  // ─── Task 7 — toolbar moves below the tree, restyles to .tree-actions ──

  it("toolbar renders AFTER the tree's <ul> in DOM order", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Smoke")).toBeInTheDocument();
    });

    const tree    = screen.getByRole("tree", { name: "Emitters" });
    const toolbar = screen.getByTestId("emitter-tree-toolbar");

    // The toolbar comes after the tree's <ul> in document order.
    const cmp = tree.compareDocumentPosition(toolbar);
    // DOCUMENT_POSITION_FOLLOWING === 4
    expect(cmp & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("toolbar uses the .tree-actions class for design-aligned chrome", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Smoke")).toBeInTheDocument();
    });

    const toolbar = screen.getByTestId("emitter-tree-toolbar");
    expect(toolbar.className).toContain("tree-actions");
  });

  it("toolbar no longer has the eye-toggle button (per-row eyes replace it)", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Smoke")).toBeInTheDocument();
    });

    // The legacy eye-toggle button used aria-label "Toggle emitter visibility".
    expect(screen.queryByLabelText("Toggle emitter visibility")).toBeNull();
  });

  it("toolbar renders a Duplicate button between New and Delete in DOM order", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Smoke")).toBeInTheDocument();
    });

    const newBtn = screen.getByLabelText("New Emitter");
    const dupBtn = screen.getByLabelText("Duplicate emitter");
    const delBtn = screen.getByLabelText("Delete emitter");

    // newBtn comes before dupBtn comes before delBtn.
    expect(newBtn.compareDocumentPosition(dupBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dupBtn.compareDocumentPosition(delBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("clicking Duplicate dispatches emitters/duplicate with the primary's id", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Smoke")).toBeInTheDocument();
    });

    // Select Smoke (id=0) first.
    fireEvent.click(screen.getByText("Smoke"));
    await waitFor(() => {
      expect(useEmitterSelectionStore.getState().primary).toBe(0);
    });

    fireEvent.click(screen.getByLabelText("Duplicate emitter"));

    const calls = (bridge.request as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const dup = calls.find((c) => c.kind === "emitters/duplicate");
    expect(dup).toBeDefined();
    expect(dup!.params).toEqual({ id: 0 });
  });

  it("Duplicate button is disabled when no emitter is selected", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Smoke")).toBeInTheDocument();
    });

    // No selection at this point (beforeEach clears the store).
    const dupBtn = screen.getByLabelText("Duplicate emitter");
    expect(dupBtn).toBeDisabled();
  });

  it("Show All / Hide All render as icon buttons (no SHOW / HIDE text)", async () => {
    const bridge = makeStubBridge();
    render(<EmitterTree bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByText("Smoke")).toBeInTheDocument();
    });

    // Tooltips / aria-labels still find the buttons.
    expect(screen.getByLabelText("Show all emitters")).toBeInTheDocument();
    expect(screen.getByLabelText("Hide all emitters")).toBeInTheDocument();

    // The literal text "SHOW" and "HIDE" no longer appears in the toolbar.
    // (The legacy implementation rendered uppercase letter-spaced spans.)
    const toolbar = screen.getByTestId("emitter-tree-toolbar");
    expect(toolbar.textContent).not.toMatch(/SHOW/);
    expect(toolbar.textContent).not.toMatch(/HIDE/);

    // The Eye / EyeOff Lucide icons should be present inside the
    // Show All / Hide All buttons (svg elements).
    const showAll = screen.getByLabelText("Show all emitters");
    const hideAll = screen.getByLabelText("Hide all emitters");
    expect(showAll.querySelector("svg")).not.toBeNull();
    expect(hideAll.querySelector("svg")).not.toBeNull();
  });
});
