# F-series UI follow-ups (F2–F9) — session 6

**Branch:** `lt-4` (session branch `claude/nervous-lamport-e8a966`).
**Status:** PLAN — awaiting user sign-off before any code.
**Source:** `tasks/followups.md` (F1–F9 backlog). User selected F2–F9 (F1
parked pending a layout sketch). Design calls settled 2026-06-01:
- **F6** → scrub only from the arrow column; plain text-drag selects text.
- **F7** → wheel steps 0.1 on decimal fields, 1 on integer fields; Shift = ×10.
- **F8** → shift-by-delta (preserve spread).
- **F9** → Index exclusive with *everything*, like Scale.

The archived arch-C frame-pacing plan now lives in
`tasks/todo-arch-c-pacing-deferred.md` (still DEFERRED, untouched).

---

## 1. Goal + scope

When this ships, the editor's number fields, curve editor, emitter-tree
toolbar, and toolbar buttons all behave the way the user expects from a live
review: number fields let you select text by dragging and scrub only from the
arrows; the wheel steps a sensible amount; multi-key curve edits move the group
by the average; the Index curve is solo like Scale; the emitter-tree toolbar is
centered and sized like the main toolbar with a pressed state; and the
link-group brackets sit close to the names.

**In (this session):**
- **F2** — center the emitter-tree toolbar and size/space it like the main toolbar. *(web/CSS)*
- **F3** — pressed (`:active`) state on toolbar + tree-action buttons. *(web/CSS)*
- **F5** — pull the link-group bracket gutter closer to the emitter names. *(web/CSS)*
- **F6** — number-field drag selects text; scrub moves to the arrow column. *(web/TSX)*
- **F7** — wheel step: 0.1 decimals / 1 integers, Shift ×10. *(web/TSX)*
- **F8** — multi-key curve edit shows the average; editing shifts the group by delta. *(web/TSX)*
- **F9** — selecting Index auto-deselects all other channels (solo, like Scale). *(web/TSX)*
- **F4** — fix dead link groups: native C++ undo/propagation. **Native sub-track**
  (user opted in 2026-06-01). ★★★★ — a dedicated design/risk check-in before
  coding it, per §3.F4 + §4. Sequenced last (riskiest last).

**Out (deferred, with reason):**
- **F1** — emitter-row icon layout: ambiguous, needs the user's sketch (parent
  vs child row target) before building. Separate item.

---

## 2. What the codebase already gives us

- **F2/F3 CSS:** `.tb-btn` (28px, [components.css:136](../web/apps/editor/src/styles/components.css:136)),
  `.tb-group` (gap 1px, :130), `.tree-actions` (flex, no `justify-content`,
  :415) and `.tree-actions .icon-btn` (24×22, :422). Pressed state today is only
  `aria-pressed`/`.active` (:157) — no `:active`.
- **F5 gutter:** bracket geometry + `marginRight` on the `<ul>` in
  `EmitterTree.tsx` (`GUTTER_LEFT_PAD_PX`, `LANE_WIDTH_PX`, `gutterPx`, brackets
  from `computeLinkGroupBrackets`, [link-group-colors.ts:51](../web/apps/editor/src/utils/link-group-colors.ts:51)).
- **F6/F7 Spinner** ([Spinner.tsx](../web/apps/editor/src/primitives/Spinner.tsx)):
  drag-scrub `handleMouseDown` bound to the `<input>` (:162, :225); arrow column
  with `adjustBy(±step)` click buttons (:245–272); native wheel handler steps
  `d.step` (:146); `dp`/`step` available for the integer/decimal decision.
- **F8/F9 curve editor** ([CurveEditorPanel.tsx](../web/apps/editor/src/components/CurveEditorPanel.tsx)):
  `CHANNELS` incl. `index` (:80); `enableScaleExclusively` (:502); solo logic in
  `handleRowClick` (:510, scale branches :519/:525) + checkbox `onChange`
  (:1108); `selectedKeyTimes` set (:377); single-key spinner override
  (`size !== 1` guard, :719); optimistic/`Math.fround` machinery (L-006/L-009).
- **F4 native:** `linkGroups/set-membership` handler ([BridgeDispatcher.cpp:3601](../src/host/BridgeDispatcher.cpp:3601))
  sets only `e->linkGroup` (:3648); bridge `captureUndo` lambda (:2442) only
  snapshots. Legacy `CaptureUndo` ([main.cpp:864](../src/main.cpp:864)) does the
  propagation (:869–899). API exists: `CreateLinkGroup`/`JoinLinkGroup`/
  `LeaveLinkGroup` + `copySharedParamsFrom` ([LinkGroup.h:158](../src/LinkGroup.h:158)).
  Mock bridge already implements it via `setLinkGroupMembership`
  ([mock-state.ts:632](../web/apps/editor/src/bridge/mock-state.ts:632)).

## 3. Architecture / implementation approach

**Order:** CSS first (F2, F3, F5 — fast, visible, low-risk), then Spinner
(F6, F7 — one file), then curve editor (F9 then F8 — F9 is the warm-up for F8).
Run vitest + build after each bundle.

- **F2** — `.tree-actions { justify-content: center }`; bump
  `.tree-actions .icon-btn` toward the `.tb-btn` footprint (height 28px, matching
  border-radius, comparable horizontal padding/gap). Keep the `:disabled`/
  `.disabled` rules.
- **F3** — add `:active` (bg + slight scale) to `.tb-btn`, `.icon-btn`, and
  `.tree-actions .icon-btn`. Pure CSS, golden-neutral (no DOM/ARIA change).
- **F5** — reduce the gutter offset constants / `marginRight` so the brackets
  hug the names; verify against legacy 0.2 spacing. Constant-only.
- **F6** — remove `onMouseDown={handleMouseDown}` from the `<input>` (:225) so
  the input is a plain text field (drag selects). Attach drag-scrub to the arrow
  column wrapper (:245) with a small movement threshold so a click still
  increments/decrements (preserve `adjustBy(±step)`), a drag scrubs by Y-delta.
- **F7** — in the wheel handler, derive step: `dp === 0 ? 1 : 0.1` (integer vs
  decimal field), Shift = ×10. Apply through the shared `Spinner`, so inspector +
  curve-editor Time/Value fields inherit it. Update the L-008 wheel test.
- **F9** — generalize solo: `const EXCLUSIVE = new Set(["scale","index"])`.
  Replace `enableScaleExclusively` with `enableExclusively(id)` and the hardcoded
  `"scale"` checks in `handleRowClick`/checkbox with `EXCLUSIVE.has(id)` /
  "is any exclusive channel currently on". Index then behaves exactly like Scale.
- **F8** — when `selectedKeyTimes.size > 1`, the Time/Value spinners show the
  average of the selected keys' times/values; on change, compute
  `delta = newAvg − oldAvg` and apply it to every selected key (preserve spread),
  routing through the existing track-key-edit bridge call. Respect border keys
  and the optimistic/`fround` override. (Largest item — will read the spinner UI
  + value handlers in detail at implementation time.)

### 3.F4 — root cause (for the separate native session)

Link groups are dead on **two** fronts in arch-C:
1. **No sync-on-link.** `linkGroups/set-membership` ([BridgeDispatcher.cpp:3648](../src/host/BridgeDispatcher.cpp:3648))
   assigns `e->linkGroup` directly instead of calling `CreateLinkGroup`/
   `JoinLinkGroup`/`LeaveLinkGroup`, so members' non-exempt fields are never
   copied to the canonical member on link.
2. **No per-edit propagation.** The legacy `CaptureUndo` ([main.cpp:869](../src/main.cpp:869))
   propagates an edit to all group siblings before snapshotting. The bridge's
   `captureUndo` lambda ([BridgeDispatcher.cpp:2442](../src/host/BridgeDispatcher.cpp:2442))
   does not — and it's called *pre*-mutation, so propagation can't simply be
   bolted on; it needs a *post*-mutation propagation step (or a shared
   chokepoint) in the param-edit handlers. This is the undo-timing subtlety that
   makes F4 a real native change, not a one-liner.

Brackets render correctly because they read `node.linkGroup` (view state), which
*is* set — masking both behavioral failures.

#### F4 fix design (native — awaiting sign-off before coding)

**Part 1 — sync-on-link.** Rewrite `linkGroups/set-membership`
([BridgeDispatcher.cpp:3601](../src/host/BridgeDispatcher.cpp:3601)) to drive the
`LinkGroup.h` API instead of raw `e->linkGroup =`:
- `groupId == -1` (new): detach any already-grouped id (`LeaveLinkGroup`), then
  `CreateLinkGroup(system, members)` — first member canonical, others unified.
- `groupId > 0` (join): per id, `LeaveLinkGroup` if in another group, then
  `JoinLinkGroup(system, e, groupId)`.
- `groupId == 0` (leave): `LeaveLinkGroup` per id.
Keep the pre-mutation `captureUndo()` (whole-system snapshot covers undo) + the
existing emits. `EnforceSingleMemberLinkGroups()` stays as an idempotent safety net.

**Part 2 — per-edit propagation.** Add a host helper
`PropagateLinkGroup(Emitter* edited)` mirroring [main.cpp:869-892](../src/main.cpp:869):
if `edited->linkGroup != 0`, copy non-exempt fields (`copySharedParamsFrom`, using
the group's `getLinkExemptFlags`) to every sibling. Call it AFTER the mutation in
the **six** handlers that edit shared fields: `set-properties` (2568),
`set-track-interpolation` (2960), `set-track-lock` (3035), `set-track-key` (3118),
`add-track-key` (3187), `delete-track-keys` (2888). The pre-mutation `captureUndo()`
already snapshots all emitters, so one undo step restores the whole group.

**Risks.** (1) *Missed handler* → that edit doesn't propagate. Mitigation: the six
above are the complete shared-field set (verified by enumerating all `emitters/*`
handlers); structural/identity/visible ops are correctly excluded. (2) *lockedTo /
curve remap* in `copySharedParamsFrom` — trusted because legacy uses the same fn for
the same propagation; verify during impl. (3) *Undo coalescing* — propagation must
sit inside the same pre-mutation snapshot; it does. (4) *Regression to a daily-driver
feature* — final validation is the user running real link-group workflows in the
native editor (can't be unit-tested host-side here).

## 4. Risks named up front + mitigations

1. **F6 click-vs-drag on the arrow column.** Adding drag-scrub to the arrows
   could break the existing click-to-increment. *Mitigation:* movement threshold
   (~3px) — below it on mouseup, treat as a click (`adjustBy`); above it, it was
   a scrub. Verify both gestures manually + keep arrow click tests green.
2. **F7 breaks the L-008 wheel test.** The test likely asserts stepping by the
   field's `step`. *Mitigation:* update the test to the new 0.1/1 contract;
   confirm Shift ×10 still asserted.
3. **F8 optimistic/fround drift (L-006/L-009).** Multi-key average edits must key
   the optimistic override and the renderer's `selectedKeyTimes.has(p.time)` on
   the same `Math.fround` values, or selection/highlight desyncs. *Mitigation:*
   reuse the existing single-key fround path; add a multi-select spec.
4. **F9 regresses Scale solo.** Generalizing the solo set could change Scale's
   behavior. *Mitigation:* the generalization is a strict superset — add Index
   specs and re-run the existing Scale-solo specs unchanged.
5. **F2/F5 layout shift in narrow panes.** Centering + resizing the toolbar and
   moving the gutter could clip at small widths. *Mitigation:* check at narrow
   pane widths; brackets must not overlap the names.
6. **a11y goldens.** F3 is `:active`-only (no DOM); F2/F5 are CSS geometry; F6/F7
   change no ARIA; F8/F9 change channel-visibility state already captured. *None
   should require golden regen* — confirm the captured surface is unchanged
   before regenerating (L-030/L-033).

## 5. Testing & verification

- **Baseline (before any edit):** `pnpm --filter @particle-editor/editor test`
  → 371/371 (44 files); `pnpm --filter @particle-editor/editor build` clean.
- **Per bundle:** re-run vitest + build; new specs for F7 (wheel contract), F8
  (multi-key average + group shift), F9 (Index solo + Scale-solo unchanged).
- **F6:** manual — drag across text selects; click arrow increments; drag arrow
  scrubs; disabled field inert.
- **F2/F3/F5:** visual — toolbar centered/sized, pressed state on mouse-down,
  brackets hug names; check narrow panes. User-confirmed on screen (L-033), not
  asserted from agent screenshots.
- **Goldens:** confirm unchanged surface; regen only if a captured node changes.
- **Native run** only if driving the editor: build the `.sln` (not `.vcxproj`,
  L-023), restore NuGet first on a fresh worktree.

---

## Review

### Final state (2026-06-01, session 6)
All 8 selected items done (F1 parked, needs a layout sketch). **Web: 383/383
vitest (44 files), build clean** (12 new specs: 5 Spinner, 3 Index, 4 F8).
**Native: `.sln` Release x64 clean** (NuGet restored). Uncommitted on
`claude/nervous-lamport-e8a966`. CHANGELOG: 2 new entries (F4 native; F-series
web) with `TODO` hash placeholders. No commit/push yet (awaiting user OK + FF).

**Needs user validation (can't be tested here):** F4 link groups in the running
editor; the on-screen look of F2/F3/F5 (L-033 — verified geometry via DOM, not
the native composited surface).

**F4 in-editor test checklist:**
- Select 2 emitters with different params → link (new group) → both take the
  canonical (first) emitter's non-exempt fields; textures/name/atlas-index stay.
- Edit a field (e.g. lifetime, a physics value) on one member → the other updates.
- Edit a curve key / add / delete a key on one member → siblings' curves match.
- Change a track lock (RGBA) on one member → siblings mirror it (own trackContents).
- Ctrl+Z after any group edit → whole group reverts in one step.
- Join an emitter to an existing group → it takes the group's values.
- Unlink a 2-member group member → both detach (no singleton). Brackets clear.

### Progress log
- **CSS bundle (F2/F3/F5) — done.** F2: `TOOLBAR_BTN` 24→28px + `.tree-actions`
  centered (verified: 7 buttons at 28×28, `justify-content: center`). F3:
  `:active` pressed state on `TOOLBAR_BTN` (Tailwind `active:`), `.tb-btn`, and
  `.panel-header .icon-btn` (CSS, `var(--panel-3)` + `scale(0.96)`). F5: found
  `marginRight: gutterPx` was a redundant leftover (gutter is now a real flex
  column); replaced with `GUTTER_GAP_PX = 2` — row→bracket gap 18px→6px (verified
  via DOM measurement). 371/371, build clean. Stale `.tree-actions .icon-btn` CSS
  left untouched (dead — buttons use `TOOLBAR_BTN`; out of scope to remove).
- **Spinner bundle (F6/F7) — done.** F6: removed drag-scrub from the `<input>`
  (now selects text); moved it to the arrow column with a 3px movement threshold
  (`DRAG_THRESHOLD_PX`), `scrubbedRef` suppresses the trailing click so a drag
  doesn't also step. Arrow buttons switched `onMouseDown`→`onClick`; wrapper
  `onMouseDown` preventDefaults to keep input focus. F7: wheel base step now
  `dp === 0 ? 1 : 0.1`, Shift ×10, rounded to kill float drift. 5 new Spinner
  specs (decimal wheel, Shift ×10, input-drag-no-op, arrow scrub, arrow click).
  376/376, build clean.
- **F9 — done.** Generalized the Scale-solo logic to `EXCLUSIVE_CHANNELS =
  {scale, index}`: `enableScaleExclusively`→`enableExclusively(soloId)`,
  hardcoded `"scale"` checks in `handleRowClick`/checkbox → `EXCLUSIVE_CHANNELS.
  has(id)`. Index now solos like Scale; the two replace each other. 3 new specs
  (Index checkbox solo, Scale↔Index swap, exit-solo); all 4 existing Scale specs
  still green. 379/379, build clean.
- **F8 — done (matches legacy).** Verified legacy semantics in
  `src/UI/TrackEditor.cpp` + `CurveEditor.cpp` `CurveEditor_MoveSelection`:
  average over ALL selected keys; Time editable iff ≥1 interior key selected;
  Time-shift moves interior keys only (borders pinned in time, shift in value);
  Value-shift moves all. Implemented `multiSelected` average memo + `applyGroupShift`
  (legacy eps clamp, channel-bounds value clamp, optimistic `setTracks` overlay).
  KEY: native track keys are a time-keyed `std::multiset` (dup times legal,
  set-track-key erases-by-oldTime, no bump) → ordered single-key calls are safe
  (descending oldTime for +dTime, ascending for −dTime) — no batch API needed.
  4 new specs (average display, Value shift, Time shift, all-borders disables
  Time). 383/383, build clean. **User chose "match legacy exactly" over the
  initial Option 1 after I surfaced the divergence.**
- **All 7 web items complete (F2/F3/F5/F6/F7/F8/F9).** Next: F4 native sub-track.
- **F4 — implemented (both parts), builds clean, awaiting user in-editor validation.**
  Part 1: rewrote `linkGroups/set-membership` to drive `CreateLinkGroup`/
  `JoinLinkGroup`/`LeaveLinkGroup` (detach-then-(re)group), so members' non-exempt
  fields unify on link. Part 2: added `propagateLinkGroup(edited)` lambda (mirrors
  `main.cpp` `CaptureUndo` propagation via `copySharedParamsFrom` + the group's
  exempt flags) and called it after the mutation in all 6 shared-field handlers
  (`set-properties`, `set-track-{interpolation,lock,key}`, `add-track-key`,
  `delete-track-keys`). Verified `copySharedParamsFrom` remaps lock pointers +
  preserves linkGroup/parent/visible/instances ([ParticleSystem.cpp:556](../src/ParticleSystem.cpp:556)).
  `.sln` Release x64 built clean (NuGet restored). **CANNOT be unit-tested
  host-side — needs the user to validate link/edit/undo in the running editor
  (L-033).** Static walk: new-group / join / leave / already-grouped-member /
  curve-edit / lock-edit / undo-round-trip all traced sound (see handoff checklist).
