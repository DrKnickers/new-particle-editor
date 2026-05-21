// ViewportPill contract test (Task 2.7). Asserts the snapshot-driven
// active state of all three toggles, and that clicking the new
// "Leave particles" toggle dispatches `engine/set/leave-particles`
// with the inverted boolean — the new bridge surface this task adds.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ViewportPill } from "../ViewportPill";
import type { Bridge } from "@particle-editor/bridge-schema";

// Read components.css from disk — Vite's `?raw` CSS imports return
// "" in vitest (the CSS plugin intercepts before raw resolves), and
// jsdom doesn't load stylesheets, so neither pathway can show us
// what's in the file. Plain fs read is the reliable option here.
const __dirname = dirname(fileURLToPath(import.meta.url));
const componentsCss = readFileSync(
  resolve(__dirname, "../../styles/components.css"),
  "utf8",
);

/** Strip `/* ... *​/` comment blocks. Necessary because the rule's
 *  body contains a doc comment that mentions the OLD `rgba(...,0.85)`
 *  value we're now guarding against — we want the test to check the
 *  CSS declarations, not the prose explaining why they're there. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Extract a top-level CSS rule body (text between `{` and the nearest
 *  matching `}`) for a given exact selector. Returns null if absent.
 *  Sufficient for the flat (un-nested) rules at `.vp-tools` scope in
 *  components.css; doesn't need brace-matching. */
function extractRuleBody(css: string, selector: string): string | null {
  const re = new RegExp(`${selector.replace(/\./g, "\\.")}\\s*\\{([^}]+)\\}`);
  const m = stripCssComments(css).match(re);
  return m ? m[1] : null;
}

function makeBridge() {
  const snap = {
    paused: false,
    ground: true,
    bloom: false,
    leaveParticles: true,
  };
  const request = vi.fn().mockImplementation((req: { kind: string }) => {
    if (req.kind === "engine/state/snapshot") return Promise.resolve(snap);
    return Promise.resolve({});
  });
  const on = vi.fn().mockReturnValue(() => {});
  return { request, on } as unknown as Bridge & {
    request: ReturnType<typeof vi.fn>;
  };
}

describe("ViewportPill", () => {
  it("renders the 3 toggle buttons with current state", async () => {
    const b = makeBridge();
    render(<ViewportPill bridge={b} />);
    await waitFor(() => {
      const ground = screen.getByRole("button", { name: "Show ground" });
      expect(ground).toHaveAttribute("aria-pressed", "true");
    });
    expect(
      screen.getByRole("button", { name: "Toggle bloom" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", {
        name: "Leave particles after instance death",
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  // B1.3.1 polish regression guards.
  //
  // The pill sits over the FD9b layered engine viewport, where HTML
  // effects can't sample the engine's rendered pixels (they're in a
  // separate compositing layer). Anything that needs "what's behind
  // me" to look right — `backdrop-filter`, translucent backgrounds,
  // big soft shadows — produces visible artifacts (dark smudges
  // because WebView2 has nothing useful behind the pill). `.vp-tools`
  // was switched to opaque chrome for that reason; these tests lock
  // it in so a future CSS tweak doesn't quietly re-introduce the
  // translucent-glass design that fights the engine compositing.
  it(".vp-tools CSS declares an opaque background (no alpha rgba, no backdrop-filter)", () => {
    const body = extractRuleBody(componentsCss, ".vp-tools");
    expect(body, ".vp-tools rule must exist in components.css").not.toBeNull();
    // Anything matching `rgba(...,0.NN)` declares a translucent bg
    // that needs backdrop content to look right — broken over the
    // engine popup.
    expect(body!).not.toMatch(/rgba\([^)]*,\s*0?\.\d+\s*\)/);
    // No backdrop-filter either — blurs whatever (nothing useful)
    // WebView2 has behind the pill, producing a dark smudge.
    expect(body!).not.toMatch(/backdrop-filter\s*:/);
    // Positive: background must be a token or a fully-opaque value.
    expect(body!).toMatch(/background\s*:\s*(var\(--|#[0-9a-fA-F]{3,8}\b|rgb\([^)]+\))/);
  });

  it("clicking Leave particles dispatches engine/set/leave-particles { enabled: false }", async () => {
    const b = makeBridge();
    render(<ViewportPill bridge={b} />);
    const btn = await screen.findByRole("button", {
      name: "Leave particles after instance death",
    });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(b.request).toHaveBeenCalledWith({
        kind: "engine/set/leave-particles",
        params: { enabled: false },
      });
    });
  });
});
