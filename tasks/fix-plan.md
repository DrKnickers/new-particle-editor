# Fix plan — UI delta remediation (defects only)

Source: [ui-delta-report.md](ui-delta-report.md). User decisions (2026-06-03):
**defects only** (keep intentional new-UI redesigns + new-only extras); **undo +
autosave on a separate track** (after the web-side defects).

Each phase: implement (TDD where infra exists) → `pnpm --filter @particle-editor/editor test`
→ `build` → re-baseline a11y composition goldens if chrome changed (L-053) → native
`.sln` build only if host code touched (L-039/L-046) → commit on `lt-4`. Check in with
user at phase boundaries.

## Phases (web-side first)

- **P1 — CRITICAL rotation scaling (PRM-4/5).** `FieldSpinner` gains a `displayScale`
  transform; rotation average ×360 (−180..180°), variance ×100 (0..100). Web-only.
- **P2 — Spinner bugs (SPN-4/5/6/7).** `primitives/Spinner.tsx`: fix drag-modifier to
  match keyboard/wheel (Shift=coarse, Ctrl=fine) + fix comment; add up/down
  hold-to-repeat; wheel honors `step` magnitude; wheel Ctrl=fine. Web-only.
- **P3 — Low-risk grab-bag.** Status bar shift-hint (VPT-6) + PAUSED (VPT-7) + cursor
  2dp (VPT-8); relax bounciness/weather clamps for round-trip (PRM-6/10); Import
  dialog "Clear" button (MNU-12); stale curve comment (CRV-14).
- **P4 — Menus, clipboard, accelerators.** Enable + wire Edit Cut/Copy/Paste/Delete
  (MNU-1); wire Emitters Toggle-Vis/Show-All/Hide-All (MNU-3); context-menu
  Cut/Copy/Paste/Paste-As + New Root (SEL-5/6); wire global accelerators —
  Ctrl+S/N/O/Del/G/H/Home, F5/6/7/8/9/10, Ctrl+Space, Alt+Up/Down, Ctrl+Y
  (MNU-2/VPT-1/SEL-14). Cascades into goldens.
- **P5 — Marquee (SEL-1) ✅ DONE.** Rubber-band select on EmitterTree: drag on empty
  space sweeps a rectangle; intersecting rows become the selection; Ctrl/Cmd = additive
  (union with prior); Esc cancels + restores the pre-marquee selection. New
  `lib/marquee.ts` (pure geometry, 6 unit tests) + pointer handling on the scroll
  container + an overlay rect that renders only mid-drag → NO static DOM / NO golden
  change. **Bug caught + fixed in review:** Esc-restore target = the prior selection,
  separate from the (empty-for-fresh-sweep) merge-base. Live-verified: correct spatial
  rows; Esc restores prior. Build clean; 428 tests.
  - **Deferred polish:** SEL-12 drag autoscroll past the viewport edge; SEL-13
    Esc/right-click cancel of the *reorder* drag (distinct from marquee).
- **P6 — Curve editor (CRV-1/2/7/8/14).** Key copy/cut/paste; right-click deselect;
  time decimals.
  - **CRV-1 ✅ DONE (user-surfaced during testing).** Multi-key canvas drag: grabbing
    a key that's part of a multi-selection now shifts the WHOLE selection by the same
    delta (was: only the grabbed key moved). Root cause: `handleKeyDragStart` collapsed
    the selection on grab. Fix: keep a multi-selection intact on grab; CurveEditor
    computes a group delta (border keys pinned in time, interior clamped to the global
    endpoints) and previews all selected keys moving; commit reuses the proven
    `applyGroupShift`. Committed the `fround`ed engineTime so moved keys keep their
    selected highlight (float-precision drift fix). Live-verified: 30/60 → 40/70 as a
    group, borders fixed, selection persists. Build clean; 428 tests.
  - **#2 marquee-from-axis-margin (user request): DEFERRED.** The plot SVG occupies
    only the center grid cell of `CanvasWithAxisLabels`; the axis margins (36px Y-label
    col, 22px X-label row) are outside the interactive SVG. Starting a marquee there
    needs the curve canvas's coordinate/layout system reworked to fold the margins into
    the SVG (e.g. a margin-inclusive viewBox) — a larger, riskier change to do
    carefully on its own, not alongside the bug fix.
  - **CRV-2/7/8 ✅ DONE (session 14, `e5bd7e3`).** Key Copy/Cut/Paste (Ctrl+C/X/V via a
    new in-app `lib/curve-key-clipboard.ts`; window-scoped with TYPING_TAGS + emitter-tree
    origin guards); right-click empty canvas clears selection in Select mode / drops to
    Select in Insert mode (CRV-7); Time spinner step 1→0.1 + 2dp display (CRV-8). vitest
    440 (+12); 1 composition golden re-baselined (Time spinner `"0"`→`"0.00"`). TDD.
    User-verified in the faithful `--new-ui`.
  - **🐛 Engine crash fix (session 14, `5ba2bd5`) — surfaced while testing P6-rest.**
    Editing a track with a lock group + live particles asserted in
    `EmitterInstance::UpdateTrackCursors` (orphaned cached cursor iterator). Arch-C bridge
    handlers never reseated cursors after key edits (legacy did via
    `OnParticleSystemChanged`), and the reseat wasn't lock-alias-aware. Fixed both halves;
    user-verified crash-gone. See **L-059** (incl. the MSVC "value-initialized" ==
    orphaned-iterator wording trap + the assert-hook/DbgHelp debugging technique).
- **P7 — Link groups (LNK-2/6/8/10) ✅ DONE (user-verified in `--new-ui`).** User chose
  **dot-only** (LNK-1 `[L<n>]` text prefix DROPPED — redundant with the kept bracket
  gutter) and **include LNK-10**. Several round-2 fixes landed from user testing (below).
  - **LNK-2** per-row link dot — decorative `aria-hidden` dot, **Option A**: a fixed
    col-3 slot LEFT of the name (grid `18px 18px 10px 1fr`), **coloured to match the row's
    bracket** (`colorForGroup`). Web-only, no golden change.
  - **LNK-6** bracket gutter — **visual-only** (NOT click-interactive). An interactive
    overlay over the full-width rows stole row-selection clicks (the "kept deselecting"
    bug — confirmed in the preview: clicking a bracket wiped the selection to the group).
    Kept the "group lights up" affordance by driving the tint from **row hover**
    (`onPointerEnter` sets `hoveredLinkGroup` → member rows tint + bracket thickens);
    **dropped** bracket click-to-select-group. Web-only, brackets `aria-hidden`.
  - **LNK-8** Dissolve Link Group context action — gathers all members from `flatRows`,
    fires one `set-membership {ids:<all>, groupId:null}`. `disabled` when `!isLinked`. Web-only.
  - **LNK-10** join-conflict warning — new read-only `linkGroups/diff-membership
    {ids, groupId} → {conflicts:{id,fields[]}[]}` (schema + mock + host wrapping
    `DiffNonExemptParams`, mirroring set-membership's canonical/exempt selection).
    **INLINE, one-click**: `SetLinkGroupDialog` runs the diff in a read-only effect and
    shows the differing fields as an amber note BEFORE a single synchronous OK joins
    (legacy showed fields in the same dialog). The first design (async diff-on-OK +
    separate "Join Anyway" confirm) caused a "first OK does nothing" bug — decoupling the
    join from the diff fixed it. Host C++ + native Debug x64 rebuilt clean.
  - **🐛 Engine crash fix (L-059, link-group paths).** Setting/joining a link group with
    live particles asserted in `UpdateTrackCursors` (orphaned cursors). `copySharedParamsFrom`
    REASSIGNS each member's non-exempt track multisets; `set-membership` and
    `propagateLinkGroup` never reseated. Fixed: `OnParticleSystemChanged(-1)` after the
    membership mutation + inside `propagateLinkGroup` (single choke point). Extends L-059
    (session 14 covered only the lock-alias + key-edit paths).
  - **🐛 Right-click context menu** — faithful WebView2 showed its NATIVE menu (masking the
    Radix menu, so Dissolve/Set-Link-Group were unreachable). `HostWindow` now calls
    `put_AreDefaultContextMenusEnabled(FALSE)` for all launches (L-057 — jsdom couldn't catch it).
  - **🐛 Shift-click anchor** (SEL, pre-existing) — `range` pivoted on the moving `primary`,
    so consecutive shift-clicks lost the origin row. Added a stable `anchor` to the
    selection store.
  - **Settings-OK disagreement warning (2nd surface) ✅ DONE (web + host compile verified; user
    native-verify pending).** **Verified `diff-membership` did NOT fit** (L-022 — it diffs joiners
    under the stored exempt set; settings needs existing members under the *proposed* set), so
    added a NEW read command `linkGroups/diff-exempt-change {groupId, exempt[]}` +
    `MakeNewlySharedMask` helper, and **extended `set-exempt-fields` to faithfully resolve**
    (clobber dissenters to canonical for newly-shared fields + L-059 reseat, one undo entry).
    Inline amber warning in LinkGroupSettingsDialog (LNK-10 pattern). vitest **469** (+3, TDD);
    build + `tsc` clean; native Debug x64 compiles clean; zero golden change. User verifies
    warn + resolve + no-crash with live particles in `--new-ui`.
  - vitest **454**. `pnpm build` + `tsc --noEmit` clean. TDD throughout.
  - **a11y:** P7 caused **zero** golden change (dot + brackets `aria-hidden`, dialog not a
    captured surface — proven by `git diff` + `emitter-tree` golden re-matching). Re-baselined
    **18 composition goldens** for a *pre-existing* session-14 CRV-8 cascade
    (`Selected key time "0"`→`"0.00"`, surfaced now the native harness runs — L-053/L-058).
    Legacy `.json` untouched (L-052).
- **P8 — Color/texture (PAL-2/3/14).** Split into P8a (color picker, web) + P8b (thumbnails,
  host/native).
  - **P8a — Color picker (PAL-2/3) ✅ DONE (web-verified; user native-verify pending).**
    Live-preview + cancel/revert as a faithful port of `ColorButton.cpp`'s two-phase
    transaction (snapshot `originalColor` on open → stream `onChange` live → OK/click-outside
    keep, Cancel/Escape revert). Controlled `Popover` via one `onOpenChange` funnel. **Plus 3
    user-approved UX extras:** Original/New before-after swatches, editable R/G/B number
    inputs (narrows the PAL-1 gap), Enter-in-hex commits+closes. One file
    ([ColorButton.tsx](web/apps/editor/src/primitives/ColorButton.tsx)) + test. vitest **463**
    (+9, TDD red→green); build + `tsc` clean; **zero golden change** (grep-proven — no open
    popover captured). Browser-preview verified live preview + Cancel/OK/Escape in the real
    app. See **L-062** (preview-eval stale-DOM read).
  - **P8b — Texture thumbnails (PAL-14) ✅ DONE (web + host compile verified; user native-verify
    pending).** Distinguish broken (decode-failed) vs missing (file-not-found) — arch-C had
    flattened both (and loading) to one blank block. `enum ThumbStatus` + `struct
    ThumbnailResult` in the host; `DecodeToPngBytes` surfaces the 3-state verdict;
    `GetThumbnailDataUri`→`GetThumbnail` (cache holds the result); bridge emits
    `{dataUri,status}`; schema + both mocks updated; React renders **softer tinted + icon +
    label** placeholders (user choice over legacy's literal magenta/grey-X). vitest **466**
    (+3, TDD); build + `tsc` clean; **native Debug x64 compiles clean** (MSBUILD EXIT=0);
    zero golden change. User verifies real missing/broken textures in `--new-ui`.

## Separate track (after P1–P8, native/host)
- **Undo capture wiring (VPT-2).** Wire `Capture()` into every new-UI host mutation.
- **Autosave port (VPT-3).** Port the 30s/5min tiers + orphan recovery to `src/host`.
- **Verify Reset-Camera vectors (MNU-7)** against legacy engine default.

## Explicitly KEEPING (intentional — not defects)
Docking/splitters (VPT-9/10), multi-channel curve overlay + solo + shift-append +
ctrl-click (CRV-4/5/10/11), single-click texture apply (PAL-9), popover texture
palette (PAL-8), custom color picker (PAL-1), dark link palette + lane layout
(LNK-3/4/5), spinner scrub-on-arrows-only (SPN-2), commit-on-blur (SPN-9), toolbar
Duplicate / Save-As / Ground-Background dropdowns (SEL-19, MNU-9/10), RGBA short
labels (PRM-3), About rebrand (MNU-8 — but flag dropped attribution), batch-delete
(SEL-17), Recent Files submenu, reset-layout. Custom-color registry persistence
(PAL-4) folds into the native track.

## Progress log
- **P1 ✅ DONE** (rotation scaling PRM-4/5). `FieldSpinner` gained `displayScale`
  (×360 average / ×100 variance, display-space clamps −180..180 / 0..100, commit
  ÷scale). New test `EmitterPropertyTabs.rotationScale.test.tsx` (4 cases, red→green);
  full suite 410 green; build clean. Web-only, no golden/native impact. Live-drive of
  the field itself was blocked by post-hot-reload preview selection flakiness (env
  artifact); transform is deterministically unit-proven.
- **P2 ✅ DONE** (spinner bugs SPN-4/5/6/7). `primitives/Spinner.tsx`: drag modifier
  fixed to Shift=coarse/Ctrl=fine (matches wheel+keyboard) + scrub now rounds;
  wheel base = field `step` (was flat 0.1/1) + Ctrl=fine on decimals; unified
  arrow-column press handler adds hold-to-repeat (350ms delay, 50ms interval) with a
  local ramp accumulator + holdingRef resync guard. 6 new Spinner tests; suite 416
  green; build clean. DOM/a11y tree unchanged (no golden impact). Input-math behaviors
  are deterministically unit-tested.
- **P3 (partial) ✅** no-golden quick wins: bounciness max=1 clamp removed (PRM-6 —
  >1 is legit super-elastic + round-trip on edit); stale curve y-range comment fixed
  (CRV-14). **Kept** weather/tail `min=0` (PRM-10) — negative cube/tail is meaningless,
  legacy's allowance was incidental, load still preserves; removing gives no benefit.
  Remaining P3 (status bar VPT-6/7/8, Import "Clear" MNU-12) touch a11y goldens →
  batched with P4.
- **P4a ✅ DONE** (global accelerators — MNU-2, VPT-1, SEL-14). New
  `lib/use-app-accelerators.ts` wires every legacy accelerator to its existing
  action: file (Ctrl+N/O/S), clear (Ctrl+Del), undo/redo (Ctrl+Z / **Ctrl+Y** /
  Ctrl+Shift+Z), emitter move (**Alt+Up/Down**), spawner trigger (Ctrl+Space),
  view toggles reading live engine state (Ctrl+G/H, F8), step (F9/F10), spawner
  dock (F7), reset camera (Ctrl+Home), reload (F5/F6). Replaced the old debug block
  in App.tsx. **Verified the host `AcceleratorBridge` parser supports all combos**
  (AcceleratorBridge.cpp:14-51) → no gaps. Deliberately excluded bare Delete/F2
  (tree-scoped, avoids firing mid-edit). 6 new tests; suite 422 green; build clean;
  no DOM/golden change. Native key→action needs the native build + user (every link
  verified to connect).
### ✅ Backed up to lt-4
`origin/lt-4` fast-forwarded `a1e8120 → 4f66541` (P1, P2, P3-partial, P4a + audit
report). Local `lt-4` synced. 0/0. The CRITICAL rotation fix + accelerators are
off-machine.

- **P4b: NEXT** — enable disabled Edit (Cut/Copy/Paste/Delete) + Emitters
  (Toggle-Vis/Show-All/Hide-All) menu items, context-menu clipboard/Paste-As/New-Root
  (MNU-1/3/4, SEL-5/6). **First golden-cascade phase** → `pnpm a11y:update` re-baseline
  (web-only; uses existing native host, NO MSBuild) + diff review.
  **Design notes (gathered, ready to implement):**
  - Commands exist: `emitters/copy {ids}`, `cut {ids}`, `paste {afterId?}`,
    `set-all-visible {visible}`, `set-visible {id,visible}`, `delete`. Reuse the
    EmitterTree's existing calls (EmitterTree.tsx:1336-1371) as the single source.
  - Edit menu: enable Cut/Copy/Delete when selection non-empty (read
    `getEmitterSelectionSnapshot()`); Paste needs a `hasClipboard` signal (track a
    flag or always-enable). Wire to the same `emitters/*` calls.
  - Emitters menu: Show All / Hide All → `set-all-visible {visible:true/false}` (no
    state). **Toggle Visibility** needs the primary node's current `visible` → MenuBar
    must subscribe to `emitters/tree/changed` to find it (moderate); or defer (per-row
    eye already covers it).
  - **GAP to flag:** "Paste As ▸ Child (Lifetime/Death)" — `emitters/paste` only
    splices at root level; no paste-into-slot param exists. Per "wire what exists,
    flag gaps," list Paste-As as a follow-up unless a host paste-as-child command is
    added.
  - Golden re-baseline expectation: `disabled` attrs flip on Edit/Emitters items + new
    context-menu nodes. Aggregate-diff to confirm only-intended (L-053).

- **P4b ✅ CODE DONE** (commit pending golden). Implemented:
  - Edit menu Cut/Copy/Paste/Delete enabled + wired to `emitters/copy|cut|paste|delete`
    on the live selection (MNU-1); Paste gates on new `lib/emitter-clipboard.ts`
    session flag (set by both menu + tree copy/cut).
  - Emitters menu Show All / Hide All → `set-all-visible`; Toggle Visibility → one-shot
    `emitters/list` + `set-visible` (MNU-3). Removed the dead `todo()` helper.
  - Context menu: New Root Emitter (SEL-6) + Cut/Copy/Paste (SEL-5).
  - **GAP flagged:** "Paste As ▸ Child" NOT added — `emitters/paste` has no
    paste-into-slot param; needs a host command (follow-up).
  - Build clean; 422 tests green; TS happy.
  - **✅ a11y re-baselined + backed up.** Native toolchain set up this session
    (nuget restore WebView2 1.0.3967.48 → `packages/`; MSBuild Debug x64 →
    `x64/Debug/ParticleEditor.exe`). `pnpm a11y:update` → **155 passed / 4 splitters**
    (L-033 artifact). Diff was surgical: ONLY `menubar-emitters-open.composition.golden.yaml`
    (Show/Hide All lose `[disabled]`, 2 lines); legacy `.golden.json` untouched (L-052).
    P1 left NO golden drift (appearance scenario doesn't populate rotation fields).
    **`origin/lt-4` = `ff9059a`** (P4a + P4b). Native build now in-worktree → future
    golden re-baselines are cheap (no re-setup).
  - **Golden re-baseline PENDING native build:** the a11y harness launches
    `x64\Debug\ParticleEditor.exe`, which isn't built in this fresh worktree (empty
    `packages/`). Confirmed change: `menubar-emitters-open` (Show/Hide All lose
    `[disabled]`). NOTE: **P1 may also have left `property-tabs-appearance` drift** —
    deferred from P1; the a11y:update will catch both. Requires NuGet restore
    (WebView2 1.0.3967.48) + MSBuild Debug x64 (L-039/L-046).

### a11y golden status
P1/P2 don't change the a11y tree (rotation sample value is 0 → ×360 still 0; spinner
DOM unchanged). Full `pnpm a11y` run deferred to a batch checkpoint before FF to lt-4.

---

## Session 13 end (2026-06-03)
**`origin/lt-4` = `91f3617`.** Shipped P1, P2, P3, P4a, P4b, P5, P6/CRV-1 (9 commits) +
the audit report + this plan. Native toolchain set up (WebView2 restored, Debug x64
built). 428 vitest, 155/4-splitter a11y, all user-confirmed in the faithful build.
Handoff: HANDOFF.md (session 13) + next-session-prompt.md refreshed + L-057 added.

**Remaining queue:** P6-rest (CRV-2 copy/paste, CRV-7 right-click deselect, CRV-8 decimal
time) · P7 link-groups (LNK-1/2/6/8/10) · P8 color/texture (PAL-2/3/14) · deferred
(curve marquee-from-margins, SEL-12 autoscroll, SEL-13 reorder-drag cancel) · native track
(VPT-2 undo capture-wiring, VPT-3 autosave). Full catalog: ui-delta-report.md.
