// Vitest tests for EmitterPropertyTabs (Phase 4.1 Fix dispatch 1).
//
// Covered:
//   - Renders the placeholder when no emitter is selected.
//   - Renders all three tabs (Basic / Appearance / Physics) when
//     selected; Basic is the default-open tab (verified via the
//     `data-state="active"` attribute Radix sets).
//   - Basic tab renders form fields populated from the get-properties
//     response (Lifetime spinner, Name input, useBursts checkbox).
//   - Appearance + Physics tabs render the "Coming in Fix dispatch N"
//     placeholders.
//   - Editing the Lifetime spinner fires emitters/set-properties
//     with `patch: { lifetime: <new value> }`.

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  Bridge,
  EmitterPropertiesDto,
} from "@particle-editor/bridge-schema";
import { EmitterPropertyTabs, AppearanceTab, PhysicsTab } from "../EmitterPropertyTabs";
import { makeDefaultEngineState, makeFixtureProperties } from "@/bridge/mock-state";

type SelectionListener = (e: { payload: { id: number | null } }) => void;

function makeStubBridge(
  initialSelectedId: number | null,
  propsOverride?: Partial<EmitterPropertiesDto>,
) {
  const listeners: SelectionListener[] = [];
  let properties: EmitterPropertiesDto = {
    ...makeFixtureProperties(initialSelectedId ?? 0),
    ...propsOverride,
  };
  const bridge = {
    request: vi.fn().mockImplementation((req: { kind: string; params?: unknown }) => {
      if (req.kind === "engine/state/snapshot") {
        return Promise.resolve({
          ...makeDefaultEngineState(),
          selectedEmitterId: initialSelectedId,
        });
      }
      if (req.kind === "emitters/get-properties") {
        return Promise.resolve({ properties });
      }
      if (req.kind === "emitters/set-properties") {
        const p = (req.params as { patch: Partial<EmitterPropertiesDto> }).patch;
        properties = { ...properties, ...p };
        return Promise.resolve({});
      }
      return Promise.resolve({});
    }),
    on: vi.fn().mockImplementation((kind: string, h: SelectionListener) => {
      if (kind === "emitters/selected") {
        listeners.push(h);
      }
      return () => {
        const idx = listeners.indexOf(h);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    }),
  } as unknown as Bridge & { request: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
  return {
    bridge,
    pushSelection: (id: number | null) => listeners.forEach((l) => l({ payload: { id } })),
  };
}

describe("EmitterPropertyTabs", () => {
  it("renders the placeholder when no emitter is selected", async () => {
    const { bridge } = makeStubBridge(null);
    render(<EmitterPropertyTabs bridge={bridge} />);
    await waitFor(() => {
      expect(
        screen.getByTestId("emitter-property-tabs-placeholder"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Select an emitter to edit its properties/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("emitter-property-tabs")).toBeNull();
  });

  it("renders three tab triggers with Basic active by default when an emitter is selected", async () => {
    const { bridge } = makeStubBridge(0);
    render(<EmitterPropertyTabs bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByTestId("emitter-property-tabs")).toBeInTheDocument();
    });
    const basic = screen.getByTestId("tab-trigger-basic");
    const appearance = screen.getByTestId("tab-trigger-appearance");
    const physics = screen.getByTestId("tab-trigger-physics");
    expect(basic).toBeInTheDocument();
    expect(appearance).toBeInTheDocument();
    expect(physics).toBeInTheDocument();
    // Radix sets data-state="active" on the open trigger + content.
    expect(basic.getAttribute("data-state")).toBe("active");
    expect(appearance.getAttribute("data-state")).toBe("inactive");
    expect(physics.getAttribute("data-state")).toBe("inactive");
  });

  it("Basic tab renders Lifetime + Name + Use Bursts form fields populated from get-properties", async () => {
    const { bridge } = makeStubBridge(0, { lifetime: 2.5, name: "TestEmitter", useBursts: false });
    render(<EmitterPropertyTabs bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByTestId("emitter-property-tabs")).toBeInTheDocument();
    });
    // Name input populated from properties.
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    expect(nameInput.value).toBe("TestEmitter");
    // Lifetime spinner populated.
    const lifetimeInput = screen.getByLabelText("Lifetime") as HTMLInputElement;
    expect(Number(lifetimeInput.value)).toBeCloseTo(2.5, 5);
    // Use Bursts checkbox is present and unchecked.
    const burstsCheckbox = screen.getByLabelText("Use Bursts");
    expect(burstsCheckbox.getAttribute("data-state")).toBe("unchecked");
  });

  it("Appearance and Physics tab triggers render with their data-state attribute", async () => {
    const { bridge } = makeStubBridge(0);
    render(<EmitterPropertyTabs bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByTestId("emitter-property-tabs")).toBeInTheDocument();
    });
    // The three triggers exist and announce their inactive state.
    // Radix Tabs in jsdom doesn't reliably switch on fireEvent.click
    // (the known pointer-event flake from the lessons), so we assert
    // structurally: the triggers are present and the Basic content is
    // active (single source of truth via data-state).
    expect(screen.getByTestId("tab-trigger-appearance")).toBeInTheDocument();
    expect(screen.getByTestId("tab-trigger-physics")).toBeInTheDocument();
    expect(screen.getByTestId("tab-trigger-appearance").getAttribute("data-state")).toBe("inactive");
    expect(screen.getByTestId("tab-trigger-physics").getAttribute("data-state")).toBe("inactive");
    // The matching content panels exist as DOM nodes (Radix mounts the
    // <Tabs.Content> wrapper even when inactive — the children inside
    // it are what's conditionally mounted), so their `data-testid` is
    // queryable.
    expect(screen.getByTestId("tab-appearance-content")).toBeInTheDocument();
    expect(screen.getByTestId("tab-physics-content")).toBeInTheDocument();
  });

  // ─── Appearance tab specs (Fix dispatch 2) ─────────────────────
  // AppearanceTab is exported and mounted directly — Radix Tabs in
  // jsdom doesn't reliably switch tabs via fireEvent (the known
  // pointer-event flake from Fix dispatch 1), so we test the panel
  // content in isolation.

  it("AppearanceTab renders all 13 field labels", () => {
    const props = makeFixtureProperties(0);
    render(<AppearanceTab properties={props} onCommit={() => {}} />);
    const expectedLabels = [
      "Colour Texture",
      "Normal Texture",
      "Blend Mode",
      "Texture Size",
      "Triangles",
      "Add Grayscale",
      "Random Colours",
      "Has Tail",
      "Tail Size",
      "Heat Particle",
      "World Oriented",
      "No Depth Test",
      "Affected by Wind",
    ];
    for (const label of expectedLabels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("AppearanceTab: editing Tail Size fires onCommit with patch.tailSize", async () => {
    const onCommit = vi.fn();
    const props = { ...makeFixtureProperties(0), hasTail: true, tailSize: 0.5 };
    render(<AppearanceTab properties={props} onCommit={onCommit} />);
    const tailSizeInput = screen.getByLabelText("Tail Size") as HTMLInputElement;
    fireEvent.focus(tailSizeInput);
    fireEvent.change(tailSizeInput, { target: { value: "1.25" } });
    fireEvent.blur(tailSizeInput);
    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith({ tailSize: 1.25 });
    });
  });

  it("AppearanceTab: hasTail === false disables Tail Size spinner", () => {
    const props = { ...makeFixtureProperties(0), hasTail: false, tailSize: 2 };
    render(<AppearanceTab properties={props} onCommit={() => {}} />);
    const tailSizeInput = screen.getByLabelText("Tail Size") as HTMLInputElement;
    expect(tailSizeInput.disabled).toBe(true);
  });

  it("AppearanceTab: blendMode === 11 (BLEND_BUMP) unchecks + disables World Oriented", () => {
    const props = { ...makeFixtureProperties(0), blendMode: 11, isWorldOriented: true };
    render(<AppearanceTab properties={props} onCommit={() => {}} />);
    const worldOriented = screen.getByLabelText("World Oriented");
    expect(worldOriented.getAttribute("data-state")).toBe("unchecked");
    expect(worldOriented.getAttribute("data-disabled")).not.toBeNull();
  });

  // ─── Physics tab specs (Fix dispatch 3) ────────────────────────
  // PhysicsTab is exported and mounted directly for the same reason
  // AppearanceTab is: Radix Tabs in jsdom doesn't reliably switch on
  // fireEvent.click.

  it("PhysicsTab renders all 13 regular field labels", () => {
    const props = makeFixtureProperties(0);
    render(<PhysicsTab properties={props} onCommit={() => {}} />);
    // Acceleration is a single grouped row (label "Acceleration") with
    // 3 spinners; check both the section label and the per-axis
    // aria-label spinners.
    expect(screen.getByText("Acceleration")).toBeInTheDocument();
    expect(screen.getByLabelText("Acceleration X")).toBeInTheDocument();
    expect(screen.getByLabelText("Acceleration Y")).toBeInTheDocument();
    expect(screen.getByLabelText("Acceleration Z")).toBeInTheDocument();
    const expectedLabels = [
      "Gravity",
      "Inward Speed",
      "Inward Acceleration",
      "Object Space Acceleration",
      "Bounciness",
      "Ground Behavior",
      "Emit From Mesh",
      "Emit From Mesh Offset",
      "Weather Particle",
      "Weather Cube Size",
      "Weather Cube Distance",
      "Weather Fadeout Distance",
    ];
    for (const label of expectedLabels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("PhysicsTab: Acceleration renders 3 spinners side-by-side", () => {
    const props = {
      ...makeFixtureProperties(0),
      acceleration: [1, 2, 3] as unknown as [number, number, number],
    };
    render(<PhysicsTab properties={props} onCommit={() => {}} />);
    const x = screen.getByLabelText("Acceleration X") as HTMLInputElement;
    const y = screen.getByLabelText("Acceleration Y") as HTMLInputElement;
    const z = screen.getByLabelText("Acceleration Z") as HTMLInputElement;
    expect(Number(x.value)).toBeCloseTo(1, 5);
    expect(Number(y.value)).toBeCloseTo(2, 5);
    expect(Number(z.value)).toBeCloseTo(3, 5);
  });

  it("PhysicsTab: Ground Behavior dropdown lists Bounce and Stick options", () => {
    const props = makeFixtureProperties(0);
    render(<PhysicsTab properties={props} onCommit={() => {}} />);
    // The trigger renders the currently-selected label.
    const trigger = screen.getByTestId("physics-ground-behavior-trigger");
    expect(trigger).toBeInTheDocument();
    // The aria-label on the Select.Trigger surfaces the field name.
    expect(trigger.getAttribute("aria-label")).toBe("Ground Behavior");
    // The default value is groundBehavior=0 → "None".
    expect(trigger.textContent ?? "").toContain("None");
    // Opening the listbox in jsdom isn't reliable, but the option set
    // is statically defined — assert via the source-of-truth constant
    // list by inspecting the underlying select primitive once opened.
    // Fallback: render with each value and assert the trigger label.
    for (const [value, label] of [[2, "Bounce"], [3, "Stick"]] as const) {
      const altProps = { ...props, groundBehavior: value };
      const { unmount } = render(<PhysicsTab properties={altProps} onCommit={() => {}} />);
      const altTriggers = screen.getAllByTestId("physics-ground-behavior-trigger");
      // Multiple PhysicsTab instances are mounted; the new one is the
      // last in the list.
      const altTrigger = altTriggers[altTriggers.length - 1]!;
      expect(altTrigger.textContent ?? "").toContain(label);
      unmount();
    }
  });

  it("PhysicsTab: Emit From Mesh dropdown lists Random Vertex and Every Vertex", () => {
    const props = makeFixtureProperties(0);
    render(<PhysicsTab properties={props} onCommit={() => {}} />);
    // Same approach as Ground Behavior — render each value and assert
    // the trigger label reflects the option set.
    for (const [value, label] of [[1, "Random Vertex"], [3, "Every Vertex"]] as const) {
      const altProps = { ...props, emitFromMesh: value };
      const { unmount } = render(<PhysicsTab properties={altProps} onCommit={() => {}} />);
      const altTriggers = screen.getAllByTestId("physics-emit-from-mesh-trigger");
      const altTrigger = altTriggers[altTriggers.length - 1]!;
      expect(altTrigger.textContent ?? "").toContain(label);
      unmount();
    }
  });

  it("PhysicsTab: Emit From Mesh Offset disabled when emitFromMesh === 0, enabled when !== 0", () => {
    const disabledProps = {
      ...makeFixtureProperties(0),
      isWeatherParticle: false,
      emitFromMesh: 0,
    };
    const { rerender } = render(
      <PhysicsTab properties={disabledProps} onCommit={() => {}} />,
    );
    const offsetDisabled = screen.getByLabelText("Emit From Mesh Offset") as HTMLInputElement;
    expect(offsetDisabled.disabled).toBe(true);

    const enabledProps = { ...disabledProps, emitFromMesh: 1 };
    rerender(<PhysicsTab properties={enabledProps} onCommit={() => {}} />);
    const offsetEnabled = screen.getByLabelText("Emit From Mesh Offset") as HTMLInputElement;
    expect(offsetEnabled.disabled).toBe(false);
  });

  it("PhysicsTab: Weather fields disabled when isWeatherParticle === false", () => {
    const props = { ...makeFixtureProperties(0), isWeatherParticle: false };
    render(<PhysicsTab properties={props} onCommit={() => {}} />);
    expect((screen.getByLabelText("Weather Cube Size") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Weather Cube Distance") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Weather Fadeout Distance") as HTMLInputElement).disabled).toBe(true);
  });

  it("PhysicsTab: group type Select trigger renders for each of the 3 groups", () => {
    const props = makeFixtureProperties(0);
    render(<PhysicsTab properties={props} onCommit={() => {}} />);
    for (let i = 0; i < 3; i++) {
      expect(screen.getByTestId(`physics-group-${i}`)).toBeInTheDocument();
      expect(screen.getByTestId(`physics-group-${i}-type-trigger`)).toBeInTheDocument();
    }
  });

  it("PhysicsTab: group with type === GT_SPHERE renders sphereRadius + sphereEdge fields (no cylinder fields)", () => {
    const base = makeFixtureProperties(0);
    const groups = base.groups.map((g, i) =>
      i === 0
        ? { ...g, type: 3, sphereRadius: 1.5, sphereEdge: 8 }
        : g,
    );
    render(<PhysicsTab properties={{ ...base, groups }} onCommit={() => {}} />);
    // Sphere fields present.
    expect(screen.getByLabelText("Sphere Radius")).toBeInTheDocument();
    expect(screen.getByLabelText("Sphere Edge")).toBeInTheDocument();
    // Cylinder fields absent (no other group is GT_CYLINDER).
    expect(screen.queryByLabelText("Cylinder Radius")).toBeNull();
    expect(screen.queryByLabelText("Cylinder Edge")).toBeNull();
    expect(screen.queryByLabelText("Cylinder Height")).toBeNull();
  });

  it("Tabs.Content outer elements carry overflow-y-auto for panel scroll", async () => {
    const { bridge } = makeStubBridge(0);
    render(<EmitterPropertyTabs bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByTestId("emitter-property-tabs")).toBeInTheDocument();
    });
    for (const id of ["tab-basic-content", "tab-appearance-content", "tab-physics-content"]) {
      const el = screen.getByTestId(id);
      expect(el.className).toContain("overflow-y-auto");
    }
  });

  it("BasicTab renders three section headers in order: Emitter Timing, Generation, Connection", async () => {
    const { bridge } = makeStubBridge(0);
    render(<EmitterPropertyTabs bridge={bridge} />);
    // Wait for Basic tab content to populate.
    await waitFor(() => {
      expect(screen.getByTestId("section-emitter-timing")).toBeInTheDocument();
    });
    expect(screen.getByTestId("section-generation")).toBeInTheDocument();
    expect(screen.getByTestId("section-connection")).toBeInTheDocument();
    // DOM order: Emitter Timing first, then Generation, then Connection.
    const timing     = screen.getByTestId("section-emitter-timing");
    const generation = screen.getByTestId("section-generation");
    const connection = screen.getByTestId("section-connection");
    expect(timing.compareDocumentPosition(generation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(generation.compareDocumentPosition(connection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("clicking a BasicTab section header collapses its children", async () => {
    const { bridge } = makeStubBridge(0);
    render(<EmitterPropertyTabs bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByTestId("section-emitter-timing")).toBeInTheDocument();
    });
    // Initially "Lifetime" (an Emitter Timing field) is visible.
    expect(screen.getByLabelText("Lifetime")).toBeInTheDocument();
    // Collapse Emitter Timing.
    fireEvent.click(screen.getByTestId("section-emitter-timing"));
    // Lifetime field is no longer in the DOM.
    expect(screen.queryByLabelText("Lifetime")).not.toBeInTheDocument();
  });

  it("Name row uses the .name-row modifier class for its custom grid", async () => {
    const { bridge } = makeStubBridge(0);
    render(<EmitterPropertyTabs bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toBeInTheDocument();
    });
    // The Name field's <input> is inside a div with the .name-row modifier class.
    const nameInput = screen.getByLabelText("Name");
    const row = nameInput.closest('div.form-row') as HTMLElement | null;
    expect(row).not.toBeNull();
    expect(row!.classList.contains("name-row")).toBe(true);
  });

  it("editing Lifetime fires emitters/set-properties with patch.lifetime", async () => {
    const { bridge } = makeStubBridge(0, { lifetime: 1.0 });
    render(<EmitterPropertyTabs bridge={bridge} />);
    await waitFor(() => {
      expect(screen.getByTestId("emitter-property-tabs")).toBeInTheDocument();
    });
    const lifetimeInput = screen.getByLabelText("Lifetime") as HTMLInputElement;
    // Spinner commits on blur after a text edit. Type a new value and blur.
    fireEvent.focus(lifetimeInput);
    fireEvent.change(lifetimeInput, { target: { value: "3.5" } });
    fireEvent.blur(lifetimeInput);
    await waitFor(() => {
      const calls = (bridge.request as ReturnType<typeof vi.fn>).mock.calls;
      const match = calls.find(
        (call) => (call[0] as { kind: string }).kind === "emitters/set-properties",
      );
      expect(match).toBeDefined();
      expect(match![0]).toMatchObject({
        kind: "emitters/set-properties",
        params: {
          id: 0,
          patch: { lifetime: 3.5 },
        },
      });
    });
  });
});
