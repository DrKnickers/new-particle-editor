# MNU-7 — Reset-Camera parity: verify + consolidate

(Prior task VPT-3's plan+review is preserved in `tasks/HANDOFF.md` session 18.)

## 1. Goal + scope

**Goal.** Confirm the new-UI Reset-Camera vectors exactly match the legacy
engine default, record that result, and remove the latent drift hazard
created by the vectors being hard-coded twice.

**In:**
- Verification of the vectors at every hop (legacy ctor → legacy handler →
  new-UI menu → new-UI accelerator → bridge → engine). **DONE** — see §5.
- Consolidate the two duplicated vector copies (`MenuBar.tsx` inline literal
  + `use-app-accelerators.ts` `RESET_CAMERA` const) into one shared exported
  constant so the menu item and the `Ctrl+Home` accelerator can never drift.
- A focused unit test locking the shared constant to the legacy default.
- Docs: mark MNU-7 verified in `ui-delta-report.md` + `fix-plan.md`, correct
  the stale "No `Ctrl+Home`" note; CHANGELOG entry.

**Out:**
- Live native-host runtime confirmation — *deferred by user choice*; the
  static proof is airtight (both new-UI paths converge on the identical
  `Engine::SetCamera()` the legacy command calls, with provably-equal args).
- Any change to the vectors themselves — they already match; this is a
  no-behaviour-change refactor.
- ROADMAP update — MNU-* are `ui-delta-report` tracking IDs, not ROADMAP
  `[TIER-K]` tags; MNU-7 is not in ROADMAP.md.

## 2. What the codebase already gives us

- `engine/set/camera` bridge kind + `CameraDto` ({position,target,up}: Vec3)
  already exist (`bridge-schema/src/index.ts`). No new bridge surface.
- Host handler `BridgeDispatcher.cpp:1347` already maps the DTO 1:1 into
  `Engine::Camera` and calls `Engine::SetCamera` — the SAME call the legacy
  `ID_VIEW_RESETCAMERA` handler (`main.cpp:1840`) makes.
- `Vec3 = readonly [number, number, number]` — contextual typing lets a
  `CameraDto`-annotated object accept plain array literals.
- `web/apps/editor/src/lib/` is the home for shared app helpers (`right-dock`,
  `file-state`, `emitter-selection`) — the new constant fits there.
- `bridge/__tests__/bridge-contract.test.ts` already exercises
  `engine/set/camera` generically (good regression floor).

## 3. Implementation approach

1. **New** `web/apps/editor/src/lib/reset-camera.ts` exporting
   `export const RESET_CAMERA: CameraDto = { position:[0,-250,125],
   target:[0,0,0], up:[0,0,1] }`, with a comment citing the legacy sources.
2. **Edit** `use-app-accelerators.ts`: delete the local `RESET_CAMERA` const
   + comment; import it from the new module. (Usage at L158 unchanged.)
3. **Edit** `MenuBar.tsx`: replace the inline `{position,target,up}` literal
   with `params: RESET_CAMERA`; import the const; trim the now-redundant
   "matches engine ctor" comment to point at the shared constant.
4. **New** `web/apps/editor/src/lib/__tests__/reset-camera.test.ts`: assert
   `RESET_CAMERA` deep-equals the documented legacy default.
5. **Docs:** `ui-delta-report.md` (MNU-7 → verified ✓, fix the "No Ctrl+Home"
   note), `fix-plan.md:175` (mark done), `CHANGELOG.md` (new top entry).

## 4. Risks + mitigations

1. **Type mismatch on the literal.** `Vec3` is a readonly tuple; a bare
   `[0,-250,125]` infers as `number[]`. *Mitigation:* annotate the object as
   `CameraDto` so contextual typing pins each field to `Vec3`. Verified by
   `tsc --noEmit` in §5.
2. **Stale import / missed call site.** Leaving one site on the old literal
   would defeat the dedupe. *Mitigation:* grep for `set/camera` + `[0, -250`
   after editing; both call sites must reference `RESET_CAMERA`.
3. **Silent behaviour change.** None expected (values identical), but a typo
   in the constant would silently break BOTH paths now. *Mitigation:* the new
   unit test pins the exact vectors to the legacy default.

## 5. Testing & verification

- [x] **Static parity proof** — vectors equal across engine ctor
      (engine.cpp:2190), legacy handler (main.cpp:1834), menu (MenuBar.tsx:752),
      accelerator (use-app-accelerators.ts:31); bridge maps DTO→same SetCamera.
- [x] `tsc --noEmit` (editor) exit 0 — the readonly-tuple contextual typing holds.
- [x] `pnpm --filter @particle-editor/editor test` → **482 passed / 0 failed** (51 files; was 481/50).
- [x] Post-edit grep: only remaining `-250, 125` hit is `mock-state.ts` (the mock's
      *default snapshot* camera — a distinct role, correctly left alone) + `reset-camera.ts`
      + its test; both reset call sites now use `RESET_CAMERA`.
- [x] Docs: MNU-7 reads "✅ VERIFIED" in ui-delta-report, "No Ctrl+Home" corrected,
      fix-plan item struck, CHANGELOG entry added.

## Review

**Outcome.** MNU-7 closed. The new-UI Reset-Camera vectors were verified — by static
proof, not guesswork — to exactly match the legacy `ID_VIEW_RESETCAMERA` default at every
hop, because both new-UI paths (menu + `Ctrl+Home`) converge on the identical
`Engine::SetCamera()` the legacy command calls, with byte-equal arguments. The two
duplicated literals are now one shared `RESET_CAMERA` constant locked by a unit test, so
the menu item and the accelerator can never silently diverge.

**Shipped:** new `lib/reset-camera.ts` + its test; `MenuBar.tsx` and `use-app-accelerators.ts`
now import the shared const; docs (ui-delta-report MNU-7 → VERIFIED, stale "No Ctrl+Home"
corrected; fix-plan item done; CHANGELOG entry).

**Verification:** `tsc --noEmit` exit 0; vitest **482/0** (added `RESET_CAMERA` test).
Web-only — no native lane needed (the live runtime confirmation was deferred by user choice;
the static proof is airtight). No behaviour change.

**Notes for a future reader.** (1) `mock-state.ts` holds a *third* copy of the same vectors
as the MockBridge's default engine snapshot — deliberately NOT folded into `RESET_CAMERA`
because it's a different concept (initial state vs. reset action); revisit only if that
coupling is ever wanted. (2) Doc drift (L-022) struck again: the "No Ctrl+Home" claim was
false against the actual code.
