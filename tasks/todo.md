# B1.3.1 [NT-7] — Inspector layout follow-ups (implementation plan)

**Status:** planning — pending user sign-off before P2 begins.
**Started:** 2026-05-21
**HEAD at planning:** `f12d6f2` (post-FF HANDOFF sync) on `claude/agitated-margulis-854108`.
**Predecessor on `lt-4`:** `f12d6f2`.
**Source of dispatch:** [`tasks/HANDOFF.md`](HANDOFF.md) "Open items §0" — three smoke-test findings from B1.3 the user deferred to a separate brainstorm + plan.
**Estimated commits:** 3–5 (one fix per finding + a docs commit; possibly one extra if a polish round follows smoke-test).

**Goal (one sentence):** the property tabs strip and the emitter tree share the left column on a flex axis instead of a fixed 288-px slice, the tab strip remains visible (with a body-level placeholder) before an emitter is selected, and the emitter tree flex-grows to fill whatever the tabs don't claim.

**Tech stack:** React 18 + TypeScript (strict), Tailwind v4 utility classes, Radix Tabs. No bridge schema, no C++.

---

## 1. Goal + scope

### Goal

Fix three layered layout issues surfaced during B1.3's smoke test:

1. **Tabs hidden until an emitter is selected.** Today the Tabs.Root is gated behind `if (selectedId === null)` and replaced wholesale by a centred placeholder div ([`EmitterPropertyTabs.tsx:214`](../web/apps/editor/src/screens/EmitterPropertyTabs.tsx:214)). The user can't see or pre-click the tab strip until something is selected.
2. **Tab slot too short, tree spills tight.** The lower-left slot is `h-72 shrink-0` in [`App.tsx:210`](../web/apps/editor/src/App.tsx:210) — a fixed 288 px regardless of column height. On taller windows the tabs look pinched; on shorter windows the tree gets squeezed because the 288 px is non-negotiable.
3. **Emitter tree should flex-grow.** Already `flex-1 min-h-0 overflow-y-auto` (correct), but the fixed-h-72 sibling above prevents it from breathing into the space the user *would* expect a tree to occupy.

These three are coupled: items 2 + 3 are two faces of "the fixed slice is the problem"; item 1 is independent JSX restructure inside `EmitterPropertyTabs`.

The user-visible outcome: opening the editor with no emitter selected shows the tab strip (Basic / Appearance / Physics) at the bottom of the left column with a "Select an emitter…" message in the active tab's body. The tab area occupies roughly half the panel-body's vertical extent; the tree occupies the other half and scrolls within it when there are many emitters. Resizing the window scales both halves proportionally.

### In scope (B1.3.1)

1. **Move the placeholder inside the tabs.** Render `<Tabs.Root>` + `<Tabs.List>` unconditionally; gate only the tab *body* on selection / loading state. Preserve the `data-testid="emitter-property-tabs-placeholder"` selector and the wording verbatim so existing specs keep passing.
2. **Flex the tabs slot.** In [`App.tsx:208-213`](../web/apps/editor/src/App.tsx:208), replace `h-72 shrink-0` with `flex-1 min-h-0` (matching the sibling tree's sizing class) so both children of `panel-body` share the column's vertical extent.
3. **Verify the tree breathes correctly.** With both siblings on `flex-1 min-h-0`, the default 50/50 split should be load-bearing — confirm via manual smoke-test at three window heights (short / medium / tall).

### Out of scope

- **User-resizable splitter between tree and tabs.** That's B1.4's job (`react-resizable-panels`). B1.3.1 lands a fixed 50/50 split first; B1.4 makes the boundary draggable later. Reason: scope discipline + the underlying ratio question ("what's the right default split?") deserves an answer that B1.4 then makes adjustable.
- **Splitter between left column and viewport.** Also B1.4.
- **MT-1 texture-picker `…` buttons.** Separate dispatch.
- **B2 audit.** Separate task entry in HANDOFF; resolves with a quick diff, doesn't need this plan.
- **Tab-strip cosmetic changes (font, padding, border).** B1.3's polish round already tuned these; no further changes here.
- **Persisting the chosen tab across sessions.** Radix's `defaultValue="basic"` resets to Basic on each mount. Persisting to localStorage would be nice but is a future polish; not load-bearing for B1.3.1's goal.

---

## 2. What the codebase already gives us

| Surface | Where | What it provides |
|---|---|---|
| `panel` / `panel-header` / `panel-body` chrome | [`web/apps/editor/src/styles/components.css`](../web/apps/editor/src/styles/components.css) | The left column already wraps in `.panel` with `panel-body` as a flex container. No CSS additions needed — Tailwind utility classes on the children are enough. |
| EmitterTree aside | [`App.tsx:199-204`](../web/apps/editor/src/App.tsx:199) | Already `flex-1 min-h-0 overflow-y-auto p-3 text-sm`. Correct sizing posture; no changes needed. |
| Property-tabs slot | [`App.tsx:208-213`](../web/apps/editor/src/App.tsx:208) | Today `h-72 shrink-0`. Two-class swap. |
| `Tabs.Root` / `Tabs.List` / `Tabs.Content` | [`EmitterPropertyTabs.tsx:232-272`](../web/apps/editor/src/screens/EmitterPropertyTabs.tsx:232) | Radix Tabs already in use. Each `Tabs.Content` has `flex-1 min-h-0 overflow-y-auto`; the body is plumbed correctly. The placeholder needs to render inside each Content's body, not replace the whole Root. |
| Placeholder copy | [`EmitterPropertyTabs.tsx:215-222`](../web/apps/editor/src/screens/EmitterPropertyTabs.tsx:215) | "Select an emitter to edit its properties" + `data-testid="emitter-property-tabs-placeholder"`. Preserve verbatim. |
| Loading placeholder | [`EmitterPropertyTabs.tsx:224-230`](../web/apps/editor/src/screens/EmitterPropertyTabs.tsx:224) | "Loading…" branch. Same treatment as item 1. |
| Spec coverage for the placeholder | Vitest specs that grep `emitter-property-tabs-placeholder` | Need to keep the testid + the copy + the rendered location stable. |

No new primitives, no new CSS classes, no new dependencies. **This is a two-file dispatch — `App.tsx` + `EmitterPropertyTabs.tsx`.**

---

## 3. Architecture / implementation approach

### Item 1 — Always-mounted tab strip

Refactor `EmitterPropertyTabs.tsx`'s render branch. Current shape:

```tsx
if (selectedId === null) return <Placeholder/>;
if (properties === null) return <Loading/>;
return <Tabs.Root>...<Tabs.Content>...<BasicTab .../></Tabs.Content>...</Tabs.Root>;
```

Target shape:

```tsx
const body = (renderInside: React.ReactNode) => (
  selectedId === null  ? <Placeholder/> :
  properties === null  ? <Loading/>     :
                         renderInside
);

return (
  <Tabs.Root defaultValue="basic" className="flex h-full flex-col">
    <Tabs.List ...>
      <TabTrigger value="basic" label="Basic"/>
      <TabTrigger value="appearance" label="Appearance"/>
      <TabTrigger value="physics" label="Physics"/>
    </Tabs.List>
    <Tabs.Content value="basic"      className="flex-1 min-h-0 overflow-y-auto outline-none" data-testid="tab-basic-content">
      {body(<BasicTab properties={properties!} onCommit={commit}/>)}
    </Tabs.Content>
    <Tabs.Content value="appearance" ...>{body(<AppearanceTab .../>)}</Tabs.Content>
    <Tabs.Content value="physics"    ...>{body(<PhysicsTab .../>)}</Tabs.Content>
  </Tabs.Root>
);
```

**Design choice — three placeholders or one?** Radix mounts only the active `Tabs.Content` at any time, so the placeholder renders inside whichever tab is active. Three call sites of `body(...)` each gate independently → only one placeholder ever paints. This avoids any "which tab shows the placeholder" question.

**Placeholder copy + testid stay verbatim.** L-010 specifically calls out label-coupled tests as a footgun. Keep `data-testid="emitter-property-tabs-placeholder"` and the text "Select an emitter to edit its properties" identical to today.

**TypeScript: `properties!` non-null assertion is safe** — the `body` helper guarantees the renderInside branch is only reached when both `selectedId !== null` and `properties !== null`. The narrowing happens at the helper, not at the call site, so the call site needs `!`. Alternative: pass `selectedId` and `properties` as arguments to `body` and have it return a render function. The non-null assertion is simpler and the safety invariant lives one screen up — fine.

### Items 2 + 3 — Flex the tabs slot

In `App.tsx:208-213`:

```tsx
// Before
<div data-testid="quadrant-property-tabs" className="h-72 shrink-0">

// After
<div data-testid="quadrant-property-tabs" className="flex-1 min-h-0">
```

That's it. Both children of `panel-body` (tree aside + tabs slot) now sit on `flex-1 min-h-0` → flex distributes the available height evenly. Default 50/50 split. Window resize scales proportionally.

**Why not `basis-1/2`?** `flex-1` is `flex: 1 1 0%` — equal growth from zero. `basis-1/2` would seed each child at 50% before flex adjusts, which is the same end state but more verbose. Stick with `flex-1` to match the existing tree aside's posture.

**Min-height floor?** Considered `min-h-[200px]` on each so neither collapses on a very short window. Decided against: `panel-body` itself has `overflow-hidden` (App.tsx:195), so on a 400-px-tall window each half becomes ~180 px and the user is already past the "this is unusable" threshold for the panel as a whole. Adding a min-height floor would force the column to overflow externally — worse UX than letting both halves shrink to their natural scrollable state. L-006 territory: don't add defensive constraints for scenarios that aren't realistic.

### Test selector audit

Per L-010, sweep for everything that grabs DOM under the affected slots:

- `emitter-property-tabs-placeholder` testid — must still match. Stays.
- `emitter-property-tabs` testid (on `Tabs.Root`) — used by specs to assert the tab strip exists. Currently only mounts when `selectedId !== null`; after this change, mounts always. Any spec asserting "tabs absent when no selection" would break. **Audit task** (P1.5) checks for this pattern.
- `tab-basic-content` / `tab-appearance-content` / `tab-physics-content` — same situation. Audit.
- `quadrant-property-tabs` testid on the App.tsx wrapper — purely visual, no behavioral change.
- `quadrant-emitter-tree` testid — unchanged.

If audit finds specs asserting Tabs-absent-when-no-selection, they need updating to assert placeholder-present-inside-tabs-when-no-selection. Plan accordingly.

---

## 4. Risks named up front + mitigations

1. **Spec coverage breakage from "tabs now always mounted."**
   - **Hazard:** existing vitest / Playwright specs may assert that `[data-testid="emitter-property-tabs"]` is *absent* when no emitter is selected (mirroring today's early-return-placeholder behaviour). After this change, the Tabs.Root is always present.
   - **Mitigation:** P1.5 audit step — `grep -r "emitter-property-tabs"` and `grep -r "emitter-property-tabs-placeholder"` across `src/**/__tests__/` and `tests/`. Any "should NOT be in document" assertion needs flipping to "should be in document; placeholder inside should be visible". Document found callsites in the audit output; update them in the same P3 commit as the JSX restructure so the test change rides with the fix.

2. **Flex-1 50/50 may not be what the user actually wants.**
   - **Hazard:** HANDOFF says "roughly 50% of the left column's vertical extent" for the tab strip. "Roughly" is ambiguous — they might want 60/40 in either direction. If the user wanted to bias toward the tree (more rows visible) or toward the tabs (more form content), a fixed 50/50 won't match expectations.
   - **Mitigation:** ship 50/50 first (cheap, principled default), then iterate based on smoke-test feedback. Document this decision in the CHANGELOG entry so the user sees "we picked 50/50 — easy to adjust." B1.4's resizable splitter will let the user override anyway; the default just needs to be reasonable.

3. **Loading placeholder flicker on selection change.**
   - **Hazard:** when the user clicks a different emitter, `fetchProps` is called and `properties` goes through a brief null window before the new dto arrives. With items moved inside the tab body, the user will now see a brief "Loading…" flash inside the tab body rather than (today) the whole tabs disappearing and a centred Loading message appearing.
   - **Mitigation:** the L-006 pattern (don't clear optimistic state on every host-data refresh) is already in CurveEditorPanel. EmitterPropertyTabs doesn't use the same pattern — it clears `properties` to null in `fetchProps` before re-fetch. We could optimise this but it's a separate change. Accept the brief flash; it's no worse than today (where today's behaviour is "whole tab strip disappears and reappears" — strictly worse than "loading message inside tab body"). **Not worth designing around.**

4. **50/50 makes the tab body too tall on tall windows.**
   - **Hazard:** on a 1440p display, 50% of the panel-body might be 400+ pixels of inspector body, which has plenty of scroll headroom even for the longest tab (Appearance). The form content occupies maybe 60% of that; the bottom 40% is empty. Wasted screen real estate.
   - **Mitigation:** **accepted.** Empty space inside a panel body is the lesser evil vs the alternative (a tree that can't grow, or a tabs slot that runs out of room before the form ends). B1.4's resizable splitter is the proper fix; B1.3.1 ships a reasonable default. The CHANGELOG will note "tall windows show some empty space below the tab body — addressed in B1.4."

5. **`properties!` non-null assertion could mask a real bug.**
   - **Hazard:** if some future refactor breaks the invariant that `properties !== null` implies `selectedId !== null`, the non-null assertion silently passes a null through to `BasicTab` and crashes inside the form.
   - **Mitigation:** the `body()` helper centralises the gating. Add a TypeScript-narrowing variant: `function body<T>(content: (p: EmitterPropertiesDto) => T): T | JSX.Element` so the assertion is invisible. Implement this if the audit reveals it's clean; otherwise the `!` is fine — the invariant is one screen above. **Decide during P3.**

---

## 5. Testing & verification

### Manual smoke-test (after P3 lands)

- [ ] Open editor with no `.alo` loaded → tabs visible at bottom of left column, "Basic" tab active, body shows "Select an emitter to edit its properties" placeholder.
- [ ] Click "Appearance" tab while nothing selected → tab switches, body still shows placeholder. Same for Physics.
- [ ] Load a `.alo` file → tabs remain visible, tree populates, tabs still on Basic (or whichever was last clicked), body still placeholder (no emitter selected yet by default load? — check this; if emitters auto-select on load, body populates).
- [ ] Click an emitter → tab body populates with that emitter's form, placeholder gone.
- [ ] Click a different emitter → form re-populates (brief "Loading…" flash inside body is acceptable).
- [ ] Click an empty area / Esc to deselect → body returns to placeholder, tabs still visible.
- [ ] Resize the window vertically (drag bottom edge):
  - **Tall window (1440p):** tree gets ~50%, tabs get ~50%, both have generous scroll headroom.
  - **Medium window (1080p):** tree ~50%, tabs ~50%, tree shows ~12-15 emitter rows comfortably.
  - **Short window (768p):** tree ~50%, tabs ~50%, both halves scroll internally. Panel-body itself doesn't overflow.
- [ ] Switch theme (dark ↔ light) → no regression on the tab strip's appearance.
- [ ] Open Spawner panel → left column unchanged (only the right column appears).
- [ ] With 30+ emitters loaded, scroll the tree → form below stays in place; tab body doesn't scroll-couple to the tree.

### Vitest (after P3)

- [ ] `pnpm test` clean (expect 277/277 baseline + any test additions / updates).
- [ ] Any specs that today assert `emitter-property-tabs` absent → updated to assert placeholder presence inside the tabs.
- [ ] New focused spec: "EmitterPropertyTabs renders Tabs.Root with placeholder when no emitter is selected." Covers the no-selection path explicitly so a future refactor can't quietly revert this behaviour.

### Playwright (after P3)

- [ ] `pnpm test:native` clean (expect 83/83). No label changes, so L-010 risk is low; the testid-stability risk above is the bigger concern.

### MSBuild

- [ ] Should remain clean (no C++ touched). Run once before FF.

### Debug instrumentation

None needed. This is layout-only; no new state, no new lifecycle, no new bridge calls.

---

## 6. Implementation steps

- [x] **P1 — Pre-flight.** Confirm baseline green. Vitest verified 277/277. Playwright + MSBuild deferred to P5 (no C++ change; one vitest-only spec flip needed — Playwright surface unaffected per audit).
- [x] **P1.5 — Spec selector audit.** Found one structural flip needed: [`EmitterPropertyTabs.test.tsx:81`](../web/apps/editor/src/screens/__tests__/EmitterPropertyTabs.test.tsx:81) (`queryByTestId("emitter-property-tabs")).toBeNull()` → invert). All other `getByTestId("emitter-property-tabs")` callsites (lines 88, 114, 133, 430, 490 + Playwright 44/80/133/183/236) are post-selection assertions and stay correct unchanged. `base.css:34-58` scrollbar styling tied to the three `tab-*-content` testids is unaffected.
- [x] **P2 — Verify Playwright + MSBuild baseline.** Deferred — covered by P5 end-of-dispatch sweep. The session-start baseline was clean (HANDOFF: vitest 277/277, Playwright 83/83, MSBuild clean) and nothing has been touched since `f12d6f2`.
- [x] **P3 + P4 — bundled into a single commit** (`ec486d9`). Plan called for two separate commits, but P3 alone (always-mounted strip with no flex change) would leave the placeholder centered in a fixed 288 px slice; P4 alone would change the layout but the strip would still vanish on no-selection. Each commit should leave the tree in a coherent user-visible state — the two together do, either alone is a half-baked intermediate.
- [x] **P5 — Build + test verification, no UI smoke test.** `pnpm build` clean, vitest 277/277, MSBuild Debug x64 clean (post NuGet restore — fresh worktree pre-flight per HANDOFF), Playwright 83/83. The agent cannot drive the dev server headlessly, so the manual checklist below is left for the user to walk through before the FF.
- [x] **P6 — Docs.** Commit `f1d1f27`: CHANGELOG entry at top, HANDOFF refresh (header + resumable-state + what-landed-this-session + open-items §0 swap from B1.3.1 to B1.4 + §1 marked shipped), ROADMAP strike + move-to-shipped + renumber. Tag NT-7 vacated permanently.
- [x] **P7 — Polish round (post user smoke test).** User tested the build and asked for 25/75 favouring tabs (matching "tab strip dominates the visual hierarchy" from the original deferred-item list). Tabs slot `flex-1 min-h-0` → `flex-[3_1_0%] min-h-0` in [`App.tsx`](../web/apps/editor/src/App.tsx); tree aside stays at `flex-1` so the 1:3 ratio yields 25/75. Docs (CHANGELOG / HANDOFF / ROADMAP) refreshed in the same commit to reflect the shipped ratio. No test impact.

---

## Review (append after work)

### Plan vs reality

Plan called for 6 P-steps (P1 pre-flight → P6 docs). Reality landed in 3 commits + this docs commit:

| Plan | Reality | Notes |
|---|---|---|
| P1 pre-flight | vitest verified at session start (277/277); Playwright + MSBuild deferred to P5 sweep | As planned. |
| P1.5 spec audit | Found exactly one structural test that needed flipping ([`EmitterPropertyTabs.test.tsx:81`](../web/apps/editor/src/screens/__tests__/EmitterPropertyTabs.test.tsx:81)). All other `getByTestId("emitter-property-tabs")` callsites are post-selection assertions and stay correct unchanged. | As planned. |
| P2 baseline | Deferred to P5 — no code yet, baseline was known-clean from session start at `f12d6f2`. | As planned. |
| P3 always-mounted strip + P4 flex slot | Bundled into `ec486d9`. | **Deviation from plan**: bundled because each alone is a half-baked intermediate. The plan's "P3 then P4 as separate commits" was the wrong call — flagged and merged before committing. |
| P5 smoke test | Build / test sweep only (agent can't drive the dev server headlessly). | As planned. |
| P6 docs | *this commit* | As planned. |

### Test count evolution

- vitest **277 → 277** (no net change). One spec body replaced (`renders the placeholder when no emitter is selected` → `renders the always-mounted tab strip with body-level placeholder when no emitter is selected` — adds three new assertions for the strip + triggers being present, kept the placeholder + copy assertions intact). Two waitFor anchors retuned from `getByTestId("emitter-property-tabs")` to `getByLabelText("Maximum lifetime:")` because the old anchor used to imply "form is loaded" (strip only mounted with data); now it only implies "strip exists" so the wait would pass too early and the subsequent label query would fail. Caught on the first `pnpm test` after the JSX restructure (two failures, both at the same call shape, both fixed).
- Playwright **83 → 83** (no change). All Playwright assertions on `emitter-property-tabs` happen post-emitter-selection (the `beforeEach` selects one), so they were unaffected.
- MSBuild Debug x64: clean (no C++ touched).

### Issues encountered and resolutions

1. **Vitest waitFor pattern broke when the strip's mount semantics changed.** Two existing specs anchored their waitFor on the strip's testid as a proxy for "form is hydrated". Pre-change, the testid only attached once properties loaded, so the waitFor was an indirect form-loaded check. Post-change, the testid attaches immediately on render. Fixed by anchoring waitFor on `getByLabelText("Maximum lifetime:")` directly. Pattern worth remembering for any future restructure that decouples a wrapper from its content's load state.
2. **`JSX.Element` namespace not in scope.** First draft of `renderBody` typed its callback as `(p: EmitterPropertiesDto) => JSX.Element`. `pnpm test` passed (vitest doesn't type-check per L-004) but `pnpm build` failed with `Cannot find namespace 'JSX'`. Fixed by switching to `ReactNode` imported from `react`, matching the convention already used by Modal.tsx / Section.tsx / ToolPanel.tsx. **L-004 reminder reinforced**: always run `pnpm build` before claiming a JSX change is clean.
3. **Fresh-worktree NuGet pre-flight needed.** First `MSBuild //v:m` on the new `agitated-margulis-854108` worktree failed with `missing Microsoft.Web.WebView2.targets`. HANDOFF's "fresh-worktree pre-flight" item flagged this exact case; applied `MSBuild //t:Restore //v:m` per the prescribed step, then the standard Debug x64 build worked. The Playwright suite needed the .exe so its first invocation blew up with `ENOENT`; re-ran after MSBuild and got 83/83.

### Patterns worth remembering

- **`renderBody((p) => …)` helper with a callback parameter, not a pre-built element.** Lets type narrowing flow through cleanly so the call sites never need a `properties!` non-null assertion. The narrowing happens at the helper, not at the call site.
- **Anchor test waitFors on the actual content you're about to query, not on a parent wrapper.** When a wrapper's mount semantics change, the waitFor pattern that worked yesterday silently fails today.
- **Bundle commits when each alone leaves the tree in a half-baked state.** Plan's commit decomposition is a default, not a contract.
