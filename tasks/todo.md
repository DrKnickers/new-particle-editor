# Plan: NT-2 — Adjustable ground-plane height in the preview

ROADMAP entry: near-term, ★☆☆☆☆ (1/5), 1–2 hours estimated.

## 1. Goal + scope

Let the user nudge the preview's ground plane up or down along Z so
particle anchors don't end up underground (and so you can preview fire
/ debris against a non-zero floor). The control persists across
editor sessions as a registry preference; it's not encoded in the
`.alo` file (per-author, not per-particle).

**In scope:**

- A **"Ground Z:" spinner** in the editor chrome that drives the
  ground-plane Z.
- **Engine API**: new `SetGroundZ(float)` setter alongside the existing
  `SetGround(bool)`. Ground quad in `Engine::Render` reads the new Z
  instead of using a hardcoded 0.
- **Per-session registry persistence** using the same pattern as
  `ShowGround` (read at startup, write on change). New value name
  `GroundZ`, stored as REG_BINARY (4 bytes of `float`) to avoid the
  signed-DWORD encoding question.
- **Range**: −100 to +100 units, 0.1 step (Shift = ×10 step, Ctrl = ×0.1
  step via the existing scroll-wheel modifier feature).
- **Default Z = 0** so the historical behavior is preserved when the
  registry value is absent.
- **Gated by "Show Ground"**: when the existing `ID_VIEW_SHOWGROUND`
  toggle is off, the spinner and its label are **disabled (greyed)**
  but remain visible. Re-enabling Show Ground re-enables them.
  (Disable over hide preserves spatial memory and avoids toolbar
  reflow.)

**Out of scope:**

- *Drag-handle in the preview viewport* — separate gesture / hit-test
  infrastructure the editor doesn't have; spinner is the established
  pattern and good enough for 1/5.
- *Saving Z into the `.alo`* — explicitly excluded by the roadmap entry.
- *Dynamic bounds tied to particle scale* — let the user push the plane
  wherever within [-50, +50]; not worth the heuristic.

## 2. What the codebase already gives us

- **Ground rendering** at [src/engine.cpp:266](src/engine.cpp:266). A
  procedural 4-vertex quad with hardcoded `Z = 0` in the vertex data;
  drawn via `DrawPrimitiveUP` after the `m_showGround` gate.
- **Engine setter pattern**: `void SetGround(bool)` at
  [src/engine.h:148](src/engine.h:148). New `SetGroundZ(float)` mirrors
  it exactly.
- **Spinner infra**: `SPINNER_INFO` at [src/UI/UI.h:28](src/UI/UI.h:28),
  `Spinner_SetInfo` usage at
  [src/UI/Emitter.cpp:190](src/UI/Emitter.cpp:190) (float, 0–`FLT_MAX`,
  0.1 step). Value-change message is `SN_CHANGE` (WM_APP+1), handled in
  the dialog procs.
- **Registry pattern**: `ReadShowGround` / `WriteShowGround` at
  [src/main.cpp:2509](src/main.cpp:2509). Root key
  `HKEY_CURRENT_USER\Software\AloParticleEditor`.
- **Toolbar / rebar** at [src/main.cpp:1531](src/main.cpp:1531). Current
  toolbar has buttons only; "Show Ground" toggle is button index 3 at
  line 1557.
- **View menu + checkmark sync** at
  [src/main.cpp:1278](src/main.cpp:1278) and
  [src/main.cpp:1334](src/main.cpp:1334). `ID_VIEW_SHOWGROUND = 40020`
  lives in [src/Resources/resource.h](src/Resources/resource.h).

## 3. Architecture / implementation approach

Two design questions to pin **before** coding:

### Decisions

- **UI placement**: inline spinner on the main toolbar rebar, immediately
  next to the existing "Show Ground" toggle.
- **Range**: −100 to +100, 0.1 step.
- **Enabled state**: greyed (via `EnableWindow(FALSE)`) when Show Ground
  is off; re-enabled when it's on. Visibility unchanged either way.

### Implementation outline

1. **Engine** — [src/engine.h](src/engine.h),
   [src/engine.cpp](src/engine.cpp):
   - Add `float m_groundZ = 0.0f;` member.
   - Add `void SetGroundZ(float z) { m_groundZ = z; }`.
   - In the ground-draw block (~lines 271–276 of engine.cpp), set the
     Z component of all four vertices to `m_groundZ` instead of `0`.

2. **UI** — [src/main.cpp](src/main.cpp) toolbar section
   (~lines 1531–1579):
   - Create a child Spinner control parented to the toolbar/rebar
     (`CreateWindowEx` with the spinner class), positioned to the right
     of the existing buttons. Add a small static label "Ground Z:" to
     its left.
   - Call `Spinner_SetInfo` with min = −100, max = 100, increment = 0.1,
     initial value = whatever `ReadGroundZ()` returned at startup.
   - In the main window's `WM_NOTIFY` / `SN_CHANGE` handler, when the
     notification comes from this spinner: read the new float, call
     `engine.SetGroundZ(newZ)`, call `WriteGroundZ(newZ)`.
   - In the `ID_VIEW_SHOWGROUND` WM_COMMAND handler at
     [src/main.cpp:1334](src/main.cpp:1334): after flipping the toggle
     state, call `EnableWindow(hLabel, on)` and
     `EnableWindow(hSpinner, on)` so both grey/un-grey in sync.
   - At startup, after `ReadShowGround()` settles the initial toggle
     state, apply the same `EnableWindow` calls so the spinner starts
     in the right enabled state.

3. **Persistence** — [src/main.cpp](src/main.cpp) registry section
   (~lines 2509–2535):
   - `float ReadGroundZ()` — REG_BINARY of length `sizeof(float)`;
     return 0.0f on missing / wrong-size / NaN / Inf.
   - `void WriteGroundZ(float z)` — REG_BINARY, 4 bytes.
   - Wire `ReadGroundZ()` into the same startup function that calls
     `ReadShowGround()`; pass the loaded value to both
     `engine.SetGroundZ(...)` and the spinner's initial state.

4. **Validation**: `Spinner_SetInfo` already enforces min/max — nothing
   extra needed at the C++ boundary.

## 4. Risks named up front + mitigations

1. **Spinner steals arrow-key focus from camera nav.** If the spinner
   sits on the toolbar and the user clicks into it to type, Up/Down for
   the spinner conflicts with Up/Down for camera. **Mitigation**: after
   `SN_CHANGE` commits a value (Enter or focus loss), `SetFocus` back to
   the main window. Test specifically — if Win32 message routing already
   keeps camera arrows working when the spinner has no focus, no fix
   needed.

2. **Stale Z for one frame between window-show and registry-load.**
   The engine could `Render` at Z=0 before startup reads the registry
   value. **Mitigation**: initialize `m_groundZ = 0.0f` at member
   declaration so default matches historical behavior; load registry
   value *before* the first `Render` call (window-shown but engine
   already constructed). No visual flash.

3. **Corrupt registry value.** A truncated write or hand-edit could
   leave `GroundZ` non-float. **Mitigation**: `ReadGroundZ` validates
   length (`== sizeof(float)`) and rejects NaN/Inf, falling back to
   0.0f. Matches the conservative posture of `ReadShowGround` /
   `ReadBackgroundColor`.

4. **Range too tight for unusually large effects.** A 50-unit ceiling
   might cut off a giant-scale effect. **Accepted** — bumping the range
   later is a one-line change. Not worth pre-designing for.

## 5. Testing & verification

**Happy path:**

- [ ] Open editor with `GroundZ` absent from registry → ground draws at
      Z=0 (current behavior); spinner shows 0.0.
- [ ] Drag spinner up → ground rises smoothly in viewport, redraws each
      frame.
- [ ] Drag spinner down → ground sinks; passes through particle origin
      without rendering artifacts.
- [ ] Scroll-wheel on spinner: ±0.1; Shift+wheel: ±1.0; Ctrl+wheel: ±0.01.

**Persistence:**

- [ ] Set Z = 7.3, close editor, reopen → spinner shows 7.3, ground
      draws at Z=7.3.
- [ ] Set Z = −12.5, close editor, reopen → restored correctly
      (negative value not mangled by signedness or stringification).
- [ ] Manually delete `GroundZ` from registry between sessions → starts
      back at 0.0; no error dialog.

**Edge cases:**

- [ ] Set Z to spinner max (100.0) → ground draws far above; no clipping
      artifacts.
- [ ] Set Z to spinner min (−100.0) → ground draws far below; particles
      still render above it.
- [ ] Toggle "Show Ground" off while spinner has non-zero Z → ground
      hidden, spinner + label grey out; toggle on → ground returns at
      the spinner's current Z (not 0), spinner + label re-enable.

**Refused inputs:**

- [ ] Type a non-numeric string into the spinner → control rejects,
      retains prior value (existing Spinner behavior).
- [ ] Type a value outside [−100, 100] → spinner clamps to bound.

**Greyed-out state:**

- [ ] App launches with `ShowGround` = 0 in registry → spinner + label
      appear greyed; ground not drawn.
- [ ] App launches with `ShowGround` = 1 → spinner + label appear
      enabled; ground drawn at `GroundZ`.
- [ ] Toggle Show Ground off → both controls grey; toggle on → both
      controls un-grey. No flicker or reflow.

**Focus / camera interaction:**

- [ ] Click into the spinner, click back on the viewport, press Up
      arrow → camera responds, not the spinner.
- [ ] Spinner has focus, press Up/Down → adjusts spinner value (not
      camera). Confirms focus boundaries.

**Cleanup:**

- [x] Debug build passes.
- [x] Release build passes.
- [x] No new compiler warnings in touched files. The two pre-existing
      warnings (`C4244` in `expatw_static` and `LNK4098` for `LIBCMTD`
      in Debug) are unchanged.

---

## Review

**Outcome.** Shipped as described. Engine surface stayed at 3 lines
+ a member declaration; everything else was UI plumbing.

**What changed from the plan:**

- **UI placement landed in the header strip, not the rebar.** The plan
  recommended Option 1 (inline on the rebar next to Show Ground).
  Implementation revealed that the rebar control doesn't forward
  `WM_COMMAND` from children, so a rebar-child spinner would have lost
  SN_CHANGE in the rebar's WNDPROC. The two-line fix would have been
  a custom container window or a subclassed rebar WNDPROC; for a 1/5
  task neither felt worth the surface area. Header strip (same row as
  `hLeaveParticles` / background label) is still visually in the
  editor's top-of-window UI band and wires up with zero custom plumbing.
  Disclosed in the PR description and CHANGELOG so the trade-off is
  visible.
- **Reset View Settings also resets `GroundZ` to 0** even though the
  feature is technically a registry-persisted preference rather than
  a view setting in the strict sense. The existing reset menu item
  already covers `ShowGround` (the other ground-related pref); leaving
  `GroundZ` out would have been surprising. Confirmation prompt text
  updated to mention "ground Z offset" so the reset's scope stays
  documented in the UI itself.
- **`std::isfinite` over MSVC `_finite`.** First draft used `_finite`
  (the MSVC-specific function) before remembering `<cmath>` is already
  included and `std::isfinite` portably handles the NaN/Inf check.
  No functional difference — `_finite` would have worked — but
  `std::isfinite` reads as the obvious choice to anyone scanning the
  file.

**Risks revisited:**

1. *Spinner stealing arrow-key focus from camera nav.* Not yet
   verified — needs in-UI testing the build environment can't do.
   If the user finds the spinner intercepts Up/Down for camera while
   the spinner has focus, the fix is one `SetFocus(info->hMainWnd)`
   call after `SN_CHANGE` settles. Flagged in the PR test plan.
2. *Stale Z for one frame at startup.* Won't happen — `m_groundZ`
   defaults to 0 in the Engine constructor; the registry read +
   `SetGroundZ` happen before the engine has produced its first
   frame.
3. *Corrupt registry value.* Handled — length + `std::isfinite`
   check falls back to 0.0f.
4. *Range too tight.* Bumped to ±100 per user feedback; the original
   plan said ±50. Easy to bump further later.

**What I didn't do (deliberately):**

- No drag-handle in the viewport — out of scope per plan.
- No saving Z into the `.alo` — explicitly out of scope.
- No new compile-time warnings on touched files. Did not address the
  two pre-existing warnings (expat C4244, LIBCMTD LNK4098) — out of
  scope.

**Outstanding manual test items (from §5):**

Builds compile and link clean; the remaining checklist (drag the
spinner, watch the ground move, verify scroll-wheel modifiers, verify
greyed state, verify registry round-trip, verify camera-nav focus
interaction) needs an interactive UI run. Listed in the PR test plan
so the human reviewer covers them before merge.
