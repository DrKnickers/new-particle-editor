// [NT-12] ChainWarningTip — the rich tooltip body for the NT-11 ⚠
// chain-load glyph. Pure presentational component over ChainWarning, so
// it renders bare (no Tooltip.Provider needed).

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChainWarningTip } from "../ChainWarningTip";
import type { ChainWarning } from "@/lib/chain-load";

const warning: ChainWarning = {
  estimate: 864_000,
  path: [
    { name: "flash", perEmitter: 12, cumulative: 12 },
    { name: "detail", perEmitter: 60, cumulative: 720 },
    { name: "Smoke", perEmitter: 1200, cumulative: 864_000 },
  ],
};

describe("ChainWarningTip", () => {
  it("leads with the meaning and the soft-warning disclaimer", () => {
    render(<ChainWarningTip warning={warning} />);
    expect(screen.getByText("This chain may spawn far too many particles")).toBeInTheDocument();
    expect(screen.getByText("Soft warning — nothing is blocked")).toBeInTheDocument();
  });

  it("renders one row per generation with formatChainWarning's number rules", () => {
    render(<ChainWarningTip warning={warning} />);
    expect(screen.getByText("flash")).toBeInTheDocument();
    expect(screen.getByText("~12 alive")).toBeInTheDocument();
    expect(screen.getByText("→ detail")).toBeInTheDocument();
    expect(screen.getByText("×60 → ~720")).toBeInTheDocument();
    expect(screen.getByText("→ Smoke")).toBeInTheDocument();
    expect(screen.getByText("×1,200 → ~864,000")).toBeInTheDocument();
  });

  it("keeps the sub-10 decimal rule (×0.4 must not render as ×0)", () => {
    render(
      <ChainWarningTip
        warning={{
          estimate: 12_000,
          path: [
            { name: "a", perEmitter: 30_000, cumulative: 30_000 },
            { name: "b", perEmitter: 0.4, cumulative: 12_000 },
          ],
        }}
      />,
    );
    expect(screen.getByText("×0.4 → ~12,000")).toBeInTheDocument();
  });

  it("highlights only the final cumulative", () => {
    render(<ChainWarningTip warning={warning} />);
    const final = screen.getByText("×1,200 → ~864,000");
    expect(final.className).toContain("text-warning");
    expect(screen.getByText("×60 → ~720").className).not.toContain("text-warning");
  });
});
