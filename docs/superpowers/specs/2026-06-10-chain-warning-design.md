# NT-11 — Soft chain-multiplication warning (design)

*2026-06-10 · ROADMAP [NT-11] · designed with the user via brainstorming; all
sections individually approved.*

## Purpose

Depth-3+ emitter chains are legitimate and engine-supported (verified in-game
2026-06-10, see `tasks/multi_child_emitter_investigation.md` addendum), so the
editor has **no depth guard**. But chains multiply *per particle*: each
generation spawns one child-emitter instance per parent particle, so expected
alive-particle counts compound multiplicatively. A full-rate chain can crash
the game (the v1 chain-test particle bomb) and today the author gets zero
feedback. Ship a **soft, advisory, never-blocking warning** in the emitter
tree when a chain's estimated alive-particle count explodes.

Non-goals (explicitly out):

- No refusal, no save interception, no dialogs — authoring proceeds untouched.
- No live-preview-count escalation (`stats/tick` backstop) — static formula
  only; live escalation can be a future item if the static estimate proves
  insufficient.
- No depth limit of any kind.

## Decisions (user-approved)

| Question | Decision |
|---|---|
| Data source | **Static formula** from spawn params at edit time (not live `stats/tick` counts) |
| Threshold | **10,000** estimated alive particles (advisory order-of-magnitude guard) |
| UI surface | **Glyph on every row of the offending chain** (node + all ancestors), tooltip with per-generation breakdown |
| Architecture | **A: web-side formula + widened tree DTO** (host surfaces raw spawn fields; one pure TS function does the math) |

## §1 Formula

Per-emitter steady-state alive estimate `E(e)` (Little's law):

- **Continuous** (`useBursts == false`):
  `E = nParticlesPerSecond × lifetime`
- **Burst** (`useBursts == true`): bursts of `nParticlesPerBurst` every
  `burstDelay` seconds, each burst's particles living `lifetime` seconds →
  concurrent bursts = `lifetime / burstDelay`:
  `E = nParticlesPerBurst × clamp(floor(lifetime / burstDelay) + 1, 1, nBursts)`
  - `nBursts == 0` means infinite → no upper clamp.
  - `burstDelay == 0` degenerates to `nParticlesPerBurst × nBursts`
    (all bursts simultaneous); if additionally `nBursts == 0`, clamp to a
    large sentinel (the warning fires regardless — don't produce Infinity/NaN
    in the tooltip).

Chain accumulation: every alive parent particle hosts one child-emitter
instance, so `A(child) = A(parent) × E(child)`, with `A(root) = E(root)`.

**Deliberate approximation:** life children and death children use the SAME
rule. Strictly, a death child spawns per particle *death* (instance arrival
rate = parent spawn rate, not parent alive count), so the uniform rule
over-estimates death chains when parent lifetime > 1 s and under-estimates
below it. Accepted: this is an order-of-magnitude advisory glyph; one
explainable rule beats two debatable ones, and the tooltip shows the
per-generation numbers so the assumption is inspectable.

**Warning rule:** emitter `e` is *offending* when `A(e) > 10_000`. The glyph
marks `e` **and every ancestor on its root→e path**. The tooltip on a marked
row shows the worst offending path through that row: each generation's name,
its `E`, and the running product `A`.

The threshold lives as a named constant next to the formula
(web-side, so tuning it never needs a native rebuild).

## §2 Data flow

`EmitterTreeNode` (web/packages/bridge-schema) gains a `spawn` sub-object:

```ts
spawn: {
  lifetime: number;            // seconds
  useBursts: boolean;
  nBursts: number;             // 0 = infinite
  burstDelay: number;          // seconds
  nParticlesPerSecond: number;
  nParticlesPerBurst: number;
}
```

*(Implementation note: the shipped field names keep the `n` prefix —
`nParticlesPerSecond`/`nParticlesPerBurst` — because `SpawnParamsDto` is a
`Pick` of `EmitterPropertiesDto`, whose names they match verbatim.)*

- **Host:** the existing tree builder in `BridgeDispatcher` copies these from
  the `Emitter` struct fields it already reads
  (`src/ParticleSystem.h:175-204`: `nParticlesPerSecond`,
  `nParticlesPerBurst`, `useBursts`, `nBursts`, `burstDelay`, `lifetime`).
- **Mock:** mirrors the same fields from its per-emitter property state
  (parity is field-copying, no formula duplication).
- **Web:** `estimateChainLoad(tree)` — a pure function in
  `web/apps/editor/src/lib/chain-load.ts` — returns per-stableId
  `{ A, offending, path-breakdown }`. Recomputed whenever a tree arrives.

**Refresh trigger:** structural changes already broadcast
`emitters/tree/changed`. New requirement: an `emitters/set-properties` patch
touching any of the six spawn fields must refresh the glyph within one event
cycle. Mechanism (host re-emits `tree/changed` for spawn-field patches vs the
web store patching its local tree copy from the patch it just sent) is a
plan-stage decision after checking what `set-properties` broadcasts today.
If host re-emit proves chatty under rate-spinner drags, coalesce host-side.

## §3 UI

The emitter-tree row grid (`EmitterTree.tsx`, currently
`18px 18px 10px 1fr`: eye / role glyph / link dot / name) gains a trailing
`16px` column:

- Amber `⚠` glyph, rendered only on offending rows.
- Tooltip via the native `title` attribute (the codebase's existing pattern —
  no new tooltip dependency), multi-line: estimated total + per-generation
  breakdown, e.g.
  `~21,600 particles est. alive\nsparkle: 12/s × 1.5s = 18\n→ highlight: ×30 = 540\n→ smoke: ×40 = 21,600`.
- `aria-label` carries a one-line summary ("Chain load warning: about N
  particles estimated alive") rather than the full multi-line breakdown —
  a deliberate deviation: screen readers announce a sentence better than a
  table, and the breakdown stays available via the title.
- Fully non-blocking; no other surface changes.

## §4 Testing

- **Vitest unit suite** (`chain-load.test.ts`): continuous, burst,
  infinite-burst (`nBursts=0`), `burstDelay=0` degenerate, depth-3 product,
  ancestor marking, a v1-bomb-like fixture that MUST warn, a vanilla-like
  fixture that MUST NOT, no-NaN/Infinity invariant.
- **Bridge-contract test:** `spawn` fields present + typed on the tree DTO;
  mock parity.
- **Component test:** glyph appears/disappears across a threshold-crossing
  param edit; tooltip text content.
- **Native harness:** one spec asserting `emitters/list` carries the spawn
  fields. Risk check: if existing a11y goldens snapshot the tree DTO, the
  widened DTO diffs them — regenerate deliberately.
- **Manual (user):** open a chained effect, crank a rate past the threshold,
  watch the glyph arrive and confirm the tooltip math reads sensibly.

## Risks

1. **Tree-DTO widening diffs native goldens** — check during plan; regen
   goldens deliberately if so.
2. **Spawn-param edits don't currently re-broadcast the tree** — the refresh
   mechanism is the one open implementation choice; requirement pinned in §2.
3. **False positives on legitimately dense effects** — mitigated by the 10k
   threshold (vanilla effects run tens-to-hundreds alive) and by the warning
   being purely advisory.
4. **Formula precision disputes (death-child semantics)** — accepted and
   documented in §1; tooltip transparency is the mitigation.

## Shipping

ROADMAP: strike NT-11, move to Shipped §5, vacate the tag, renumber §1.
CHANGELOG: full three-part entry (what ships / how tackled / gotchas).
