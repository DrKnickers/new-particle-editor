// ChainWarningTip — the [NT-12] rich tooltip body for the NT-11 ⚠
// chain-load glyph (user-picked layout: amber header band + aligned
// name/math rows; spec §4). Consumes ChainWarning.path directly — the
// estimation formula lives only in chain-load.ts, and the number
// formatting is the exported fmtCount/fmtMultiplier pair shared with
// formatChainWarning, so the plain-text and rich presentations can
// never drift.
//
// Rendered INSIDE Tip's .tip-surface (rich tier: no .tip-body padding —
// the band runs edge-to-edge; .tip-surface's overflow:hidden clips it
// to the rounded corner).

import type { ChainWarning } from "@/lib/chain-load";
import { fmtCount, fmtMultiplier } from "@/lib/chain-load";

export function ChainWarningTip({ warning }: { warning: ChainWarning }) {
  return (
    <div data-testid="chain-warning-tip">
      <div className="border-b border-warning/35 bg-warning/15 px-2.5 py-1.5">
        <div className="font-semibold">This chain may spawn far too many particles</div>
        <div className="text-[11px] text-text-2">Soft warning — nothing is blocked</div>
      </div>
      <div className="px-2.5 py-1.5">
        {warning.path.map((p, i) => (
          <div key={i} className="flex items-baseline justify-between gap-4">
            <span>{i === 0 ? p.name : `→ ${p.name}`}</span>
            <span
              className={`font-mono text-[11px] tabular-nums ${
                i === warning.path.length - 1 ? "text-warning font-semibold" : "text-text-2"
              }`}
            >
              {i === 0
                ? `~${fmtMultiplier(p.perEmitter)} alive`
                : `×${fmtMultiplier(p.perEmitter)} → ~${fmtCount(p.cumulative)}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
