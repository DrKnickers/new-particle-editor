# [LT-4 follow-up] Cursor → spawn world-position offset (HANDOFF item 14)

**Predecessor:** [MT-12] (default flip to architecture C, shipped at
`dd5aa8c`) + `d3a4776` (FramePublisher guard) closed two of three
known follow-ups. Item 14 — cursor-bound spawn lands ~tens of pixels
offset from the click point under default mode — is the last
default-mode regression gating the future architecture-A deletion
(HANDOFF item 11).

**Target branch:** `lt-4`
**Difficulty:** ★★ (2/5) — single-function fix in `src/MouseCursor.h`,
mechanical once the root cause is named. Risk surface is small.
**Effort estimate:** ~1-2 hours. Most of the budget is build +
double-mode test run + docs close-out.

---

## 1. Goal + scope

**When this ships:** Under default architecture C (DXGI composition +
DComp engine visual + WebView2 composition hosting), clicking to
spawn a cursor-bound particle places the particle **exactly under the
cursor**. The status-bar world coordinates also become numerically
correct (previously they were emitted with the same transform error
but appeared plausible because world floats are hard to eyeball).
Architecture A (legacy popup, opt-out via `ALO_HOSTING_MODE=legacy`)
continues to work byte-identically — its code path never engages the
scene viewport, so the fallback branch in the patch keeps that path
untouched.

**In scope.**

- **Single-function patch in [`src/MouseCursor.h`](src/MouseCursor.h:54)**
  (`GetCursorPos3D`). When the engine reports an active scene viewport
  (via `Engine::GetSceneViewport`), build a `D3DVIEWPORT9` from that
  rect and pass it to `D3DXVec3Unproject` instead of the device's
  current viewport. Falls back to `engine->GetViewPort()` for the
  no-scene-viewport case (architecture A, plus pre-scene-rect-dispatch
  bootstrap in architecture C).
- **Debug-only diagnostic.** `#ifndef NDEBUG` `printf` at the unproject
  site (throttled, mirroring the 30 Hz cursor-emit cadence) logging
  the input `(x, y)`, the viewport choice (scene vs. full-RT, with
  the rect), and the resolved world. Tagged `[cursor-unproject]` so
  a future regression can be diagnosed without re-walking the call
  graph.
- **HANDOFF item 14 close-out.** Mark resolved with commit reference,
  matching the format used for item 15.
- **CHANGELOG entry.** *What ships / How we tackled it / Issues
  encountered* per project format.
- **`tasks/todo.md` review section** appended at the end before FF.

**Out of scope.**

- *Unifying input pipelines between A and C.* That's the
  architecture-A deletion (HANDOFF item 11). After this fix, A can
  be deleted with confidence because every default-mode regression
  surfaced by [MT-12] is closed.
- *Playwright regression test for spawn-at-cursor.* The current
  harness doesn't easily express "click at viewport pixel (cx, cy),
  assert the spawned particle's world position matches the unproject
  result". Hand-rolling would need a render-thread world-space probe
  on a bridge surface — non-trivial. Deferred as a future follow-up
  on the HANDOFF list.
- *Status-bar correctness audit.* The status-bar emit uses the same
  `GetCursorPos3D` so it auto-fixes. No further work needed; but
  confirming the user-visible coordinates match a known-geometry
  click (e.g. ground plane at z=0 directly under cursor) is part of
  the test pass below.
- *Per-pixel-FoV projection touch-ups.* The Stage 5 per-pixel-FoV
  math (engine.cpp:1540-1600) is correct as-is; the bug is *purely*
  in the unproject site reading the wrong viewport. No projection
  change.

---

## 2. What the codebase already gives us

- **`Engine::GetSceneViewport(int&, int&, int&, int&) const`** at
  [`src/engine.h:231`](src/engine.h:231) — returns `true` and
  populates outs when the scene viewport is active; returns `false`
  otherwise. This is exactly the discriminator we need.
- **`Engine::GetViewPort(D3DVIEWPORT9*)`** at
  [`src/engine.cpp:988`](src/engine.cpp:988) — wraps
  `m_pDevice->GetViewport(viewport)`. This is what
  `GetCursorPos3D` *currently* calls; after Render the device
  viewport is restored to **full-RT**, not the scene viewport, which
  is the root cause.
- **`Engine::SetSceneViewport`** at
  [`src/engine.cpp:1540`](src/engine.cpp:1540) — caches
  `(x, y, w, h)` and recomputes `m_projection` at **scene-rect
  aspect** via per-pixel-FoV. So `m_projection` is built to match
  the scene viewport; the unproject needs to read the scene viewport
  to match.
- **`Engine::Render` scene-viewport hook** at
  [`src/engine.cpp:687-699`](src/engine.cpp:687) — sets the scene
  viewport for the scene pass and restores `prevViewportS5`
  (full-RT) before returning. Confirms the device viewport between
  frames is full-RT, not scene.
- **`D3DXVec3Unproject` semantics.** Computes
  `NDC.x = (pV.x - viewport.X) / viewport.Width * 2 - 1` (and Y
  mirrored). Passing scene-viewport with popup-client `(x, y)`
  inputs Just Works: the function subtracts `viewport.X` /
  `viewport.Y` internally, no caller-side translate needed.
- **`m_archCMode` mode flag** on `HostWindowImpl` — already used to
  gate composition-only behaviour throughout `HostWindow.cpp`. Not
  needed for this fix because `GetSceneViewport()` is the
  authoritative discriminator (false under A, true under active C
  with React mounted) and routing through the engine accessor
  avoids any layering dependency on the host.

---

## 3. Architecture / implementation approach

**Change site.** Single function: [`src/MouseCursor.h:54-67`](src/MouseCursor.h:54).

**Before:**
```cpp
inline void GetCursorPos3D(Engine* engine, short x, short y, D3DXVECTOR3& position)
{
    D3DXVECTOR3  front, back;
    D3DVIEWPORT9 viewport;
    D3DXMATRIX   world;
    D3DXMatrixIdentity(&world);
    engine->GetViewPort(&viewport);

    D3DXVec3Unproject(&front, &D3DXVECTOR3(x, y, 0.0f), &viewport, &engine->GetProjectionMatrix(), &engine->GetViewMatrix(), &world);
    D3DXVec3Unproject(&back,  &D3DXVECTOR3(x, y, 0.9f), &viewport, &engine->GetProjectionMatrix(), &engine->GetViewMatrix(), &world);

    D3DXPLANE plane(0,0,1,0);
    D3DXPlaneIntersectLine(&position, &plane, &front, &back);
}
```

**After (sketch — exact wording in the patch).**
```cpp
inline void GetCursorPos3D(Engine* engine, short x, short y, D3DXVECTOR3& position)
{
    D3DXVECTOR3  front, back;
    D3DVIEWPORT9 viewport;
    D3DXMATRIX   world;
    D3DXMatrixIdentity(&world);

    // [LT-4 / HANDOFF-14] Under architecture C, the engine renders
    // into a SCENE sub-rect of the popup HWND and m_projection is
    // built at scene-rect aspect (per-pixel FoV referenced to
    // scene-H, src/engine.cpp:1540). But Render restores the D3D9
    // device viewport to FULL-RT before returning
    // (src/engine.cpp:687-699), so reading the device viewport here
    // produces a viewport / projection mismatch and unprojects to
    // the wrong NDC point. Use the active scene viewport when set;
    // D3DXVec3Unproject subtracts viewport.X / viewport.Y
    // internally so the input (x, y) stays in popup-client coords.
    // Architecture A never activates the scene viewport so it
    // continues to read the device viewport unchanged.
    int sx, sy, sw, sh;
    if (engine->GetSceneViewport(sx, sy, sw, sh))
    {
        viewport.X      = static_cast<DWORD>(sx);
        viewport.Y      = static_cast<DWORD>(sy);
        viewport.Width  = static_cast<DWORD>(sw);
        viewport.Height = static_cast<DWORD>(sh);
        viewport.MinZ   = 0.0f;
        viewport.MaxZ   = 1.0f;
    }
    else
    {
        engine->GetViewPort(&viewport);
    }

    D3DXVec3Unproject(&front, &D3DXVECTOR3(x, y, 0.0f), &viewport, &engine->GetProjectionMatrix(), &engine->GetViewMatrix(), &world);
    D3DXVec3Unproject(&back,  &D3DXVECTOR3(x, y, 0.9f), &viewport, &engine->GetProjectionMatrix(), &engine->GetViewMatrix(), &world);

    D3DXPLANE plane(0,0,1,0);
    D3DXPlaneIntersectLine(&position, &plane, &front, &back);
}
```

**Debug-only diagnostic.** A throttled `#ifndef NDEBUG` `printf` at
the function tail (after `D3DXPlaneIntersectLine`) logging:

```
[cursor-unproject] in=(%d,%d) mode=%s vp=(%lu,%lu,%lu,%lu) world=(%.2f,%.2f,%.2f)
```

`mode` = `"scene"` or `"full-rt"`. **Throttling.** Per-call printf
in WM_MOUSEMOVE (60+ Hz) would flood the log. The existing
`m_lastCursorEmitTick` in `HostWindow.cpp` throttles the
`cursor/position-3d` bridge emit to ~30 Hz; we can either
(a) mirror that gate at the call site (gate the printf in the caller,
not inside `GetCursorPos3D`), or
(b) keep `GetCursorPos3D` printf-free and add the diagnostic in the
two `HostWindow.cpp` callers (WM_MOUSEMOVE and WM_KEYDOWN VK_SHIFT).

Recommend (b) — the header is included by both `--legacy-ui` and
`--new-ui` so keeping it printf-free avoids touching legacy logs.
The new-UI caller already has the throttle state.

**Why not the alternative?** Two alternatives considered and
rejected:

- *Alt-1: cache the scene viewport in the cursor coords on emit.*
  Mutate `(x, y)` to scene-relative before calling
  `D3DXVec3Unproject` with a viewport of `(0, 0, sw, sh)`. Works
  arithmetically but requires the caller to know the scene rect AND
  duplicates the subtraction `D3DXVec3Unproject` already does
  internally. Pure complexity tax with no benefit.
- *Alt-2: change `Engine::GetViewPort` to return the scene viewport
  when set.* Layer-violation — the accessor wraps the D3D9 device's
  current viewport, which is genuinely the full-RT viewport
  between frames. Other callers (none today, but plausibly future
  callers e.g. picking helpers) might want the device viewport.
  Better to keep `GetViewPort` honest and have unproject callers
  explicitly opt into the scene viewport.

---

## 4. Risks named up front + mitigations

1. **Risk: regression in architecture A (legacy mode).** If the
   `engine->GetSceneViewport()` call returns spurious `true` under
   A, we'd build a `D3DVIEWPORT9` from uninitialised/stale state and
   unproject to garbage.
   **Mitigation.** [`src/engine.cpp:1644-1647`](src/engine.cpp:1644)
   shows `GetSceneViewport` guards on `m_sceneViewportActive` and
   returns `false` immediately when inactive. Architecture A never
   calls `SetSceneViewport` (the call is wired through
   `LayoutBroker::SetCompositor` which is composition-only — see
   engine.h:223). So `m_sceneViewportActive` stays `false` and the
   fallback branch runs.
   **Verification step.** Test pass below explicitly runs the
   spawn-at-cursor scenario under `ALO_HOSTING_MODE=legacy` and
   confirms behaviour matches pre-fix legacy.

2. **Risk: scene viewport active but stale during the first
   mouse move.** If a user moves the mouse over the viewport before
   React has dispatched its first `layout/scene-rect` event, the
   scene viewport is inactive → fallback to device viewport (which
   is full-RT) → unproject is off, but no rendered scene to align
   against yet, so the result is benign.
   **Mitigation.** Accept the transient. The window of vulnerability
   is sub-second (React mounts and dispatches scene-rect in its
   first effect cycle — see ViewportSlot.tsx:65-117) and no spawn
   gesture is plausible in that window because the user hasn't seen
   the UI yet.

3. **Risk: scene viewport coordinate space differs from the
   coordinate space of the input `(x, y)`.** If they're in
   different scales / DPRs, the unproject would be off by a DPR
   factor.
   **Mitigation.** Both are in **popup-client physical pixels**:
   `ViewportSlot.tsx:81` dispatches `layout/scene-rect` with
   `clientX * dpr` / `clientY * dpr`; `toPopupClientCoords` in
   `viewport-input.ts:62-68` multiplies the mouse `clientX, clientY`
   by the same DPR. Confirmed in code review of both call sites; no
   transform needed.

4. **Risk: `engine->GetSceneViewport` not safe to call from inside
   `WM_MOUSEMOVE` / `WM_KEYDOWN`.** Threading or re-entrancy.
   **Mitigation.** `Engine` is single-threaded UI-thread-owned and
   `GetSceneViewport` just reads four `int` members under no lock
   ([engine.cpp:1644-1652](src/engine.cpp:1644)). Same thread as
   the WNDPROC, no hazard.

5. **Risk: per-pixel-FoV projection produces a different ray
   direction at large scene-rect aspect changes (e.g. very narrow
   centre quadrant).** This isn't a fix-introduced risk — it's
   existing Stage 5 behaviour — but the *unproject must use the
   same projection*, and we are.
   **Mitigation.** No code change; the projection matrix is shared.
   Just calling it out so a reader knows it was considered.

6. **Risk: the diagnostic printf logs flood `host.log` and slow
   the message pump.** Per-WM_MOUSEMOVE is 60+ Hz.
   **Mitigation.** Throttle in the caller, not the helper. Reuse
   the existing `m_lastCursorEmitTick` window (~30 Hz) so the
   diagnostic emits at the same cadence as the existing
   `cursor/position-3d` bridge call — net cost is one printf per
   bridge emit, negligible.

7. **Risk: future callers of `GetCursorPos3D` outside the
   composition flow get the new behaviour by accident.**
   `src/main.cpp` (legacy UI) also calls
   `GetCursorPos3D(info->engine, …)` at line 2942 and 2966.
   **Mitigation.** Legacy never activates the scene viewport →
   `GetSceneViewport` returns `false` → fallback runs → identical
   behaviour to today. Already covered by Risk 1's mitigation. Test
   pass includes a legacy spawn-at-cursor scenario.

---

## 5. Testing & verification

**Happy path.**
- [ ] Cold launch `x64/Debug/ParticleEditor.exe --new-ui` (no env
      vars). Load a `.alo` with a root emitter. Hold Shift + move
      cursor around the viewport — cursor-bound preview tracks the
      cursor pixel-for-pixel. Release Shift — preview dies.
- [ ] Same scenario, hold Shift, click LMB — particle spawns
      *exactly* at the click point. Drag with LMB held (OBJECT_Z
      gesture) — Z changes but X/Y stay frozen at click. Release
      LMB — system detaches and persists.
- [ ] Repeat the test from each quadrant of the viewport (NW, NE,
      SW, SE corners) to confirm the offset is gone at all
      scene-rect-relative positions — not just at centre where some
      bugs accidentally null out.

**Edge cases.**
- [ ] Resize the main window so the scene rect changes aspect.
      Re-spawn at cursor — still pixel-accurate.
- [ ] Resize a panel (e.g. drag the right inspector wider) so the
      scene rect shrinks. Re-spawn — pixel-accurate.
- [ ] Maximise the window. Re-spawn — pixel-accurate. (This was
      the FramePublisher perf scenario; cursor accuracy is
      independent but worth confirming.)
- [ ] Boot, then immediately Shift+click without moving the mouse
      first (m_lastCursorX/Y == 0 path that falls back to
      GetCursorPos + ScreenToClient — see HostWindow.cpp:2256-2267).
      Particle should appear at the actual current cursor.

**Architecture A regression.**
- [ ] Rebuild dist/ in legacy mode:
      `$env:VITE_HOSTING_MODE = "legacy"; pnpm --filter @particle-editor/editor build`.
- [ ] Launch with `$env:ALO_HOSTING_MODE = "legacy"; .\x64\Debug\ParticleEditor.exe --new-ui`.
- [ ] Spawn at cursor — accuracy matches pre-fix legacy (no
      regression).
- [ ] `--legacy-ui` (the original C++ shell, not the new UI in legacy
      mode) — spawn at cursor still works (this uses
      `GetCursorPos3D` from `src/main.cpp:2942, 2966`).

**Status bar correctness.**
- [ ] Hover the cursor over a known-geometry point (e.g. the
      ground plane origin marker if visible, or a click + spawn at
      origin and verify the world coords reported match the
      spawned position). World coordinates should be the same as
      the spawn world position to within float precision.

**Debug instrumentation.**
- [ ] `host.log` contains throttled `[cursor-unproject]` lines
      with `mode=scene` under composition and `mode=full-rt` under
      legacy.
- [ ] No `[cursor-unproject]` lines in release builds (gated by
      `#ifndef NDEBUG`).

**Test suites.**
- [ ] `pnpm test:native` (composition default) — expected 157/0/31.
      Cold-start flake from HANDOFF item 12 still applies; rerun
      once if first run fails broadly.
- [ ] `pnpm test:native:legacy` — expected 132/0/56.
- [ ] Vitest (`pnpm --filter @particle-editor/editor test`) — no
      coord-related units to change, should be green.

**Build verification.**
- [ ] x64 Debug build clean.
- [ ] x64 Release build clean (proves the `#ifndef NDEBUG` gate
      compiles both sides).

---

## 6. Implementation plan (ordered)

1. Patch `src/MouseCursor.h:54-67` per §3 sketch.
2. Add `#ifndef NDEBUG` printf in `HostWindow.cpp` at the two
   call sites (WM_MOUSEMOVE line 2154 and WM_KEYDOWN VK_SHIFT line
   2270). Throttle the WM_MOUSEMOVE one through the existing
   `m_lastCursorEmitTick` window.
3. Build x64 Debug. Fix any compile errors.
4. Run `pnpm test:native` (default composition).
5. Run `pnpm test:native:legacy`.
6. Run vitest.
7. Update `tasks/HANDOFF.md` item 14 with ✅ RESOLVED + commit ref.
8. Add CHANGELOG entry per project format (What ships / How we
   tackled it / Issues encountered).
9. Append review section to this todo.md.
10. Commit (`fix:` for code, `docs:` for HANDOFF + CHANGELOG +
    todo refresh — two commits, code-first).
11. FF to `lt-4` per CLAUDE.md branch workflow.
12. Push `origin/lt-4`.

---

## 7. Open questions

1. **Diagnostic placement: helper or caller?** §3 recommends caller
   (`HostWindow.cpp`). Confirm with user — alternative is a
   helper-local printf that legacy also incurs.
   **Decided.** Caller (per user's "go with your recs"). Diagnostic
   landed at three sites in `HostWindow.cpp` (WM_MOUSEMOVE throttled,
   WM_KEYDOWN VK_SHIFT, WM_LBUTTONDOWN Shift-fallback). Helper stays
   printf-free; legacy build is unaffected.
2. **Do we also want a deeper one-time log on first scene-viewport
   activation showing the rect?** Cheap to add. Could help future
   diagnostics. Default: skip, keep the patch minimal.
   **Decided.** Skip.

---

## 8. Review

**What landed.** [`src/MouseCursor.h`](../src/MouseCursor.h):
`GetCursorPos3D` now reads the active scene viewport via
`Engine::GetSceneViewport` when set and falls back to
`engine->GetViewPort` (the device's current viewport) when not. The
explanatory comment block names the root cause (Render restores the
device viewport to full-RT before returning, but `m_projection` is
built at scene-rect aspect) and the architectural reason the
fallback preserves legacy (architecture A never activates the scene
viewport).

[`src/host/HostWindow.cpp`](../src/host/HostWindow.cpp): three
`#ifndef NDEBUG` `[cursor-unproject]` diagnostic blocks at the
spawn-related sites — WM_MOUSEMOVE throttled emit at line 2165,
WM_KEYDOWN VK_SHIFT at line 2287 (`SPAWN` variant), WM_LBUTTONDOWN
SHIFT-fallback at line 2059 (`SHIFT+LMB` variant). Same grep prefix
across all three so a future regression can be filtered with a
single `Select-String "[cursor-unproject]"`. The WM_MOUSEMOVE block
piggybacks on the existing `m_lastCursorEmitTick` ~30 Hz gate; the
other two are per-gesture, so untrottled.

**Verification.**
- x64 Debug build clean. One pre-existing LNK4098 LIBCMTD warning,
  unchanged from `da58968`.
- x64 Release build clean — proves `#ifndef NDEBUG` gate compiles
  both sides.
- `pnpm test:native` (composition): `128 / 29 / 31`. Stash + rebuild
  + run on clean `lt-4 @ da58968` produces identical `128 / 29 / 31`,
  confirming the 29 a11y golden drift is pre-existing, not caused
  by this fix.
- `pnpm test:native:legacy`: `103 / 29 / 56`. Same drift in this
  lane; not caused by this fix.
- Spawn-at-cursor pixel accuracy: not directly verifiable from the
  CLI (GUI binary, no Playwright probe for world-position). Left
  for user-driven manual smoke per CLAUDE.md §"Pre-handoff testing"
  rule on rendering correctness — the static walk through
  `GetCursorPos3D` ↔ `D3DXVec3Unproject` math is in §3 of this
  plan and matches the user-reported symptom direction (cursor
  center-lower → particle center-upper) at the rough sizes
  prevailing in the screenshot.

**Out-of-scope items surfaced during the work.**
- *29 a11y golden drift, both lanes.* Filed as HANDOFF item 16
  with reproduction and bisect range (`a1000c8` golden commit →
  `da58968` current tip). Treat as own dispatch.
- *Architecture-A deletion (HANDOFF item 11).* Per the original
  framing, this fix unblocks that deletion. No further regressions
  known under default mode after this dispatch.

**Architectural decision worth remembering.** Two callers (status
bar emit and shift-spawn) using the same helper does NOT imply they
must produce different results when one is wrong — both feed
through `GetCursorPos3D`, both were wrong by the same scene-rect
offset, and only one consumer's output was eyeball-verifiable. The
"status bar correct, spawn wrong" framing was a diagnostic
misdirection. Lesson captured here (not lifted to
`tasks/lessons.md` because it's specific to this bug; if a similar
"two consumers diverge" framing shows up again, this entry plus the
CHANGELOG entry are the searchable record).
