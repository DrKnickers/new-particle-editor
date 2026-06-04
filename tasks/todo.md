# P7 — Link-group parity fixes (LNK-2 / LNK-6 / LNK-8 / LNK-10)

**Status:** PLAN — scope confirmed by user (2026-06-03). Ready to execute.
**Branch:** `claude/jovial-cray-1ba27e` (FF into `lt-4` at session end).
**Baseline verified:** git clean (HEAD = origin/lt-4 = `8d18a2e`), vitest **440/49**,
`node_modules` reinstalled (fresh worktree, L-058). Native build NOT yet present.

---

## 1. Goal + scope

**Goal.** Close four of the five P7 link-group deltas so the new EmitterTree matches
the legacy link-group interaction contract: a per-row "is-linked" affordance, an
interactive bracket gutter (click-select + hover), an explicit Dissolve action, and a
join-conflict warning before a join silently clobbers disagreeing fields.

**In:**
- **LNK-2 (MED)** — render the per-row link **dot** the file-header comment already
  promises ([EmitterTree.tsx:33-36](web/apps/editor/src/screens/EmitterTree.tsx:33));
  small `bg-accent` circle when `linkGroup !== 0`. **Decorative + `aria-hidden`** → no
  a11y golden change. Web-only.
- **LNK-6 (MED)** — make the bracket gutter **interactive** (was `pointer-events-none`,
  [EmitterTree.tsx:1565](web/apps/editor/src/screens/EmitterTree.tsx:1565)): click a
  bracket selects every group member (Ctrl/Cmd = union); hover tints members + thickens
  the bracket. Brackets stay `aria-hidden` (mouse convenience over the already-accessible
  row click) → no golden change. Web-only.
- **LNK-8 (MED)** — context-menu **"Dissolve Link Group"** (enabled when `isLinked`),
  under Leave Link Group. Gathers all member ids and fires one
  `linkGroups/set-membership {ids:<all>, groupId:null}` — reuses the host's
  `LeaveLinkGroup`+auto-dissolve under one `captureUndo`. Web-only (no new host surface).
- **LNK-10 (MED)** — **join-conflict warning.** New read-only host command
  `linkGroups/diff-membership {ids, groupId} → {conflicts:{id,fields[]}[]}` wrapping the
  existing [`DiffNonExemptParams`](src/LinkGroup.cpp:267). `SetLinkGroupDialog` OK now
  diffs first; non-empty conflicts → confirm modal listing the fields; OK proceeds with
  `set-membership`, Cancel aborts. **Needs the native Debug x64 build** (host C++ touched).

**Out (deferred, with reasons):**
- **LNK-1** (`[L<n>]` text name prefix) — **dropped by user decision** (dot-only):
  the kept colored bracket gutter (LNK-3/4/5, intentional) + the new dot already convey
  linkage; the legacy text prefix existed only because legacy had no gutter, so re-adding
  it would be a third redundant signal contradicting the new-UI redesign.
- **LNK-10 settings-OK un-exempt warning** — the *second* legacy disagreement surface
  (un-exempting a field in `LinkGroupSettings` where members already disagree → which
  value wins). Scoped OUT this phase to keep it shippable; proposed as a follow-up. The
  `diff-membership` command added here is the reusable primitive a follow-up would build on.
- P8 color/texture, deferred polish, native track (VPT-2/3) — separate fix-plan entries.

## 2. What the codebase already gives us

- **Bracket geometry** — [`computeLinkGroupBrackets`](web/apps/editor/src/lib/link-group-colors.ts:54)
  already emits `{groupId, color, firstRowIndex, lastRowIndex, memberRowIndices, lane}`
  per group (≥2 members). The render layer (EmitterTree.tsx:1561-1600) already maps it to
  absolutely-positioned bars + per-member stubs — LNK-6 only adds interactivity, not geometry.
- **Selection store** — [`emitter-selection.ts`](web/apps/editor/src/lib/emitter-selection.ts)
  exposes `setIds(ids, primary)` (group-select), `getEmitterSelectionSnapshot()` (Ctrl union
  base), and `useEmitterSelectionStore`. No new store needed for LNK-6.
- **Dissolve** — host already has [`DissolveLinkGroup`](src/LinkGroup.cpp:239) AND the
  `set-membership groupId:0` leave path ([BridgeDispatcher.cpp:3890-3895](src/host/BridgeDispatcher.cpp:3890))
  with `LeaveLinkGroup` auto-dissolve — LNK-8 reuses the latter from the client, no host change.
- **Diff engine** — [`DiffNonExemptParams`](src/LinkGroup.cpp:267) returns the differing
  non-exempt field labels for two emitters under a group's `LinkExemptFlags`. Canonical
  member = `members[0]` ([JoinLinkGroup](src/LinkGroup.cpp:186)); `members[0]` is first in
  `getEmitters()` order ([GetLinkGroupMembers](src/LinkGroup.cpp:104)). LNK-10 only needs
  a thin bridge wrapper — the diffing logic is done.
- **Dialog patterns** — `SetLinkGroupDialog`, `LinkGroupSettingsDialog`, the `Modal`
  primitive, `tree-context` atom, and the mock bridge `linkGroups/*` cases
  ([mock.ts:1092-1145](web/apps/editor/src/bridge/mock.ts:1092)) are all in place.

## 3. Architecture / implementation approach

**LNK-2 (dot).** Add a decorative `<span aria-hidden data-testid="emitter-link-dot-<id>">`
in the row grid, rendered only when `node.linkGroup !== 0`. Reuse the existing grid; place
it so it doesn't shift the accessible name. Color: `bg-accent` (per the comment). No new
state.

**LNK-6 (interactive brackets).** In EmitterTree:
- New local state `hoveredLinkGroup: number | null`.
- Per-bracket wrapper gains `pointer-events-auto cursor-pointer`, `onPointerEnter/Leave`
  (set/clear `hoveredLinkGroup`), and `onClick(e)`:
  - members = `flatRows.filter(r => r.node.linkGroup === groupId).map(node.id)` (render order).
  - plain click → `setIds(members, members[0])` + `bridge emitters/select {id:members[0]}`.
  - Ctrl/Cmd click → union(currentIds, members), primary = members[0].
- Hover tint: thread `hoveredLinkGroup` to rows; a row whose `linkGroup === hoveredLinkGroup`
  gets a subtle tint class; the hovered bracket brightens/thickens (width 2→3, opacity).
- Brackets stay `aria-hidden`; gutter container can keep `pointer-events-none` while each
  bracket re-enables `pointer-events-auto` (so the gaps between brackets stay click-through
  to rows beneath, if any overlap).

**LNK-8 (Dissolve).** New `handleDissolveLinkGroup` in the Row component: read the full tree
(or the already-available `flatRows`), collect ids where `linkGroup === node.linkGroup`,
fire `set-membership {ids, groupId:null}`. Context-menu `<ContextMenu.Item>` "Dissolve Link
Group" with `disabled={!isLinked}`, placed under Leave Link Group.

**LNK-10 (join warning).**
- **Schema** (`bridge-schema/src/index.ts`): add request
  `{kind:"linkGroups/diff-membership"; params:{ids:number[]; groupId:number}}` and response
  `{conflicts:{id:number; fields:string[]}[]}`.
- **Mock** (`mock.ts`): a `diff-membership` case returning a configurable conflicts list
  (seeded via mock-state) so the React flow is unit-testable; default `[]`.
- **Host** (`BridgeDispatcher.cpp`): new handler. Resolve emitters from `ids`. If
  `groupId>0`: canonical = `GetLinkGroupMembers(group)[0]`, exempt = `getLinkExemptFlags`,
  joiners = ids not already in group. If `groupId===-1`: canonical = first resolved id,
  joiners = the rest, exempt = `GetDefaultLinkExemptFlags()`. If `0/null`: empty (leaving
  never clobbers). For each joiner, `fields = DiffNonExemptParams(*joiner,*canonical,exempt)`;
  push `{id,fields}` when non-empty. Read-only — no `captureUndo`, no mutation, no tree emit.
- **Dialog** (`SetLinkGroupDialog.tsx`): `handleOk` becomes async — call `diff-membership`
  with the same `{ids, groupId}` it would send to `set-membership`. If `conflicts.length>0`,
  enter a `confirm` sub-state rendering the field list ("Joining will overwrite N field(s)
  on M emitter(s): …"); confirm → fire `set-membership` + close; cancel → back to the form.
  Empty conflicts → fire directly (today's behavior). Keep it inside the one Modal (swap body).

**Where new code lives:** all React in existing files + the dialog; one new bridge command
across schema/mock/host. No new lib files expected (bracket geometry already factored).

## 4. Risks named up front + mitigations

1. **Golden churn from LNK-2/6 (a11y re-baseline cost + native dependency).** If the dot or
   interactive brackets leak into the accessible tree, the emitter-tree composition goldens
   drift and force a native re-baseline. *Mitigation:* keep both strictly decorative —
   `aria-hidden` on the dot and every bracket element, no `role`/`aria-label`, no accessible
   name change. After build, run `git status` on the golden dir to **prove zero change**
   before declaring no re-baseline needed (L-053 aggregate-diff discipline).
2. **LNK-10 canonical-member mismatch (warn lists the wrong fields).** If `diff-membership`
   picks a different canonical than `JoinLinkGroup` actually syncs to, the warning misleads.
   *Mitigation:* mirror the host exactly — canonical = `GetLinkGroupMembers(group)[0]` and
   exempt = `getLinkExemptFlags(group)`, the same two calls `JoinLinkGroup` makes
   ([LinkGroup.cpp:186-187](src/LinkGroup.cpp:186)). For `-1` new-group, mirror the
   `set-membership` create path (first target canonical, default exempt). Cover both in the
   host handler comment so the coupling is explicit.
3. **L-057: web-lane PASS ≠ native truth for the diff.** The mock can't faithfully diff real
   float32 emitter params. *Mitigation:* the web tests prove only the *wiring* (diff called
   with the right args; non-empty → modal; confirm → set-membership; empty → direct). The
   real field-level correctness is verified by **the user** in `--new-ui` (their lane, L-033).
   State this split in the test names + handoff so no one mistakes green web tests for native
   proof.
4. **Dissolve via N-leaves vs one dissolve (undo granularity / auto-dissolve edge).**
   `set-membership {all ids, null}` loops `LeaveLinkGroup`; at 2-remaining the auto-dissolve
   detaches the last — net all-detached under one `captureUndo`. *Risk:* an off-by-one if a
   member id is stale. *Mitigation:* collect ids from the live `flatRows`/tree at click time,
   not a cached list; the host already no-ops a leave on `linkGroup===0`. One Ctrl+Z restores
   the whole group (single captureUndo). Verified by the user natively + a mock unit test on
   the emitted call shape.
5. **Native toolchain absent (L-058) blocks LNK-10 compile.** *Mitigation:* stand up
   WebView2 `packages/` (L-039) + MSBuild Debug x64 (L-046) before touching host C++; build
   clean after the change; hand the runtime verify to the user. Sequence LNK-10 last so the
   three web-only items land even if the native bring-up hiccups.

## 5. Testing & verification

**Web (vitest, TDD — red first):**
- *LNK-2:* row with `linkGroup!==0` renders `emitter-link-dot-<id>`; `linkGroup===0` does
  not; the dot carries `aria-hidden` (accessible name unchanged).
- *LNK-6:* click `link-group-bracket-<g>` selects exactly the group's member ids (primary =
  first); Ctrl/Cmd-click unions with prior selection; `onPointerEnter` sets the hovered-group
  tint on member rows, `onPointerLeave` clears it.
- *LNK-8:* "Dissolve Link Group" enabled only when `isLinked`; selecting it fires
  `set-membership` with all member ids + `groupId:null`.
- *LNK-10:* `diff-membership` mock returns conflicts → OK shows the confirm body listing the
  fields; confirm fires `set-membership`; cancel returns to form; empty conflicts → OK fires
  `set-membership` directly (no confirm). Bridge-contract test for the new command's shape.
- Full suite green (expect ~440 + new); `pnpm build` clean; `tsc --noEmit` exit 0 (L-046).

**Goldens:** `git status` the composition golden dir after build → **expect no change**
(decorative-only). If anything drifted, investigate before re-baselining (composition lane
only, legacy `.json` untouched, L-052).

**Native (LNK-10 — user lane, L-033):** Debug x64 compiles clean; user launches `--new-ui`,
attempts a join of emitters with genuinely disagreeing shared fields → warning lists the
real differing fields; OK clobbers as expected; Cancel leaves them untouched; a group with
no disagreement joins with no prompt. Confirm via `host.log` healthy (not L-033 ~4 FPS).

**Cleanup:** any `#ifndef NDEBUG` host instrumentation stripped before commit (L-059 pattern).

---

## Review

**Shipped (2026-06-04, session 15) — all user-verified in the faithful `--new-ui`.**

- **LNK-2 dot** — Option A (group-coloured dot in a fixed col-3 slot left of the name).
  Decorative/`aria-hidden`, no golden change.
- **LNK-6** — landed as **visual-only brackets + row-hover tint** (NOT bracket
  click-select). The interactive overlay stole row-selection clicks; dropped it, moved the
  "group lights up" affordance to row hover. See **L-060**.
- **LNK-8 Dissolve** — context action, one `set-membership {ids:<all>, groupId:null}`.
- **LNK-10** — `linkGroups/diff-membership` host command + **inline** amber field-overwrite
  note in the dialog; **synchronous one-click** OK. The async diff-on-OK + confirm-modal
  first cut caused a "first OK does nothing" bug → decoupled the join from the diff. See **L-061**.

**Round-2 fixes surfaced by user testing (all this session):**
1. **Engine crash** setting/joining a group with live particles — orphaned cursors via the
   link-group paths `set-membership` / `propagateLinkGroup`. Full reseat. Extends **L-059**.
2. **Right-click → browser menu** in the faithful build — `AreDefaultContextMenusEnabled(FALSE)`
   in `HostWindow`. **L-057** (jsdom couldn't catch it).
3. **Shift-click lost the anchor** — stable `anchor` added to the selection store.
4. **Dot too far / wrong colour + bracket too close** — Option A placement, group colour,
   bracket gap 8→16px.

**Deviations from the original plan.** LNK-6 shipped as visual-only (not click-interactive)
— a deliberate scope change after the click-steal bug; LNK-10 shipped inline (not a separate
confirm) per user preference + to fix the first-click bug. LNK-1 dropped (user: dot-only).

**Verification.** vitest **454**; `pnpm build` + `tsc --noEmit` clean; native Debug x64
rebuilt clean (cursor-reseat + context-menu + diff-membership); a11y **155 / 4-splitter**
(L-033), `emitter-tree` golden re-matches; 18 composition goldens re-baselined for the
pre-existing session-14 CRV-8 cascade (L-053/L-058). User confirmed on-screen: dot, dissolve,
inline warning, one-click join, no crash, no deselecting.
