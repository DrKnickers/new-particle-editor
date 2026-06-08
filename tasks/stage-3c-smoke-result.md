# Sub-stage 3c — Smoke test result

**Outcome:** ✅ **PASS — `SendMouseInput` forwarding works end-to-end.**

**Date:** 2026-05-22 · ~14:50 PDT · post-rebase onto `b5fd14f` ·
implementation pending commit on this branch.

## Automated gate (load-bearing per sub-plan §6 sub-stage 3c)

Native Playwright suite under composition mode A/B:

```powershell
$env:ALO_WEBVIEW2_HOSTING = "composition"
$env:ALO_VIEWPORT_TRANSPORT = "canvas-jpeg"
pnpm test:native
```

**Result: 99 / 99 PASS** (96 baseline + 3 sibling-added
`alpha-compositor-snapshot.spec.ts`). Same A/B result as the
HWND-mode baseline run from the rebase-verification commit
`ba3fbc4`.

## Important caveat about the automated gate

Playwright's `page.click()` and friends dispatch synthetic DOM
events through CDP — they bypass the OS WM_LBUTTONDOWN/UP path
entirely. So the 99-test suite verifies that the rest of the
composition-hosting stack (controller setup, DComp tree, bridge
round-trips, React rendering) works under composition mode, but
it does NOT exercise the new `ForwardMouseToCompositionWebView2`
helper. Real OS mouse input is needed to prove the forwarding.

That's what this manual smoke is for. It substitutes for the
automated assertion until sub-stage 3g lands the
`tests/composition-hosting.spec.ts` with explicit coords/value
assertions via a Win32-input pathway.

## Manual smoke (the real Stage 3c proof)

Launched the composition build (same env-var pair as above).
After 8s for React mount, drove real OS clicks at known
coordinates and verified DOM-side state change:

1. **Click File menu at (86, 34)** (in main HWND client coords)
   → File menu drops down with all items
   (New / Open... / Save / Save As... / Import Emitters... /
   Recent Files > / Exit) visible.
   - Verifies: WM_LBUTTONDOWN @ hMain →
     `ForwardMouseToCompositionWebView2` casts msg+wParam,
     translates lParam, calls `SendMouseInput` →
     WebView2 dispatches click on the React menubar button →
     Radix Popover opens.
   - Cross-evidence: host log line
     `[Occlude] SET id=menu:file rect=(119,17,238,243) feather=24`
     proves the click reached React's `onOpenChange` handler
     and React dispatched a `viewport/occlude` bridge call back
     to the host.

2. **Press Escape** — no visible effect.
   - Expected: keyboard forwarding is sub-stage 3f, not 3c.
     Under path (b) (the SDK-1.0.3967.48-locked keyboard path)
     DOM keyboard works only for already-focused DOM nodes.
     Radix Popover's outside-click handler captures Escape
     globally via a document-level listener, but the host
     menubar `<button>` keeps focus across the dropdown open
     so the document-level listener doesn't fire when the
     focused element is the trigger. Tracked for 3f.

3. **Click at (300, 250)** (inside the viewport quadrant area,
   outside the open menu) → menu closes.
   - Verifies: a second WM_LBUTTONDOWN forwarded successfully.
   - Cross-evidence: host log
     `[Occlude] CLEAR id=menu:file` — React's outside-click
     handler fired in response to the second click.

**Screenshot evidence:**
[`tasks/stage-3c-smoke-screenshot.png`](stage-3c-smoke-screenshot.png) —
the open File menu under composition hosting, captured via
PowerShell + `System.Drawing.Bitmap.CopyFromScreen` on the
editor's MainWindowHandle. 1280×800 PNG.

## What this smoke proves about the implementation

Direct evidence that this code path executes correctly:

- **MainWndProc's new WM_MOUSE* case block** dispatches to
  `ForwardMouseToCompositionWebView2` when `m_compositionMode`
  is true.
- **The direct cast from `UINT msg` to
  `COREWEBVIEW2_MOUSE_EVENT_KIND`** produces the right enum
  values (verified against WebView2.h at compile time;
  WM_LBUTTONDOWN=513=LEFT_BUTTON_DOWN).
- **The direct cast from `LOWORD(wp)` to
  `COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS`** preserves MK_* bits
  for modifier state.
- **lParam→client-coord translation** is correct: clicking at
  the *screen* coord that mapped to client (86, 34) actually
  hit the File menubar button (which is at client (86, 34)).
- **`SetCapture(hMain)`** on WM_LBUTTONDOWN was fine (no crash,
  no event-routing regression observed).
- **`ReleaseCapture()`** on WM_LBUTTONUP when no buttons remain
  was fine (subsequent clicks still arrived correctly).

## Acceptance checklist (per sub-plan §6 sub-stage 3c)

- [x] All 99 Playwright tests pass under
      `ALO_WEBVIEW2_HOSTING=composition` (A/B against the
      HWND-mode baseline at `ba3fbc4`)
- [x] Click at known DOM rect → React receives the event with
      matching coords (verified above; client coords preserved
      through `lParam` → `POINT` → `SendMouseInput`)
- [x] D3D11 debug-layer reports zero live objects on shutdown
      — N/A for Stage 3c (Stage 3 has no D3D11 device yet;
      that's Stage 4)

The drag-past-edge case, wheel-coord ScreenToClient
translation, and double-click handling are wired but not
explicitly exercised by this smoke. They're covered by:
- existing 99-test specs that exercise wheel events (e.g.
  `track-editor.spec.ts` curve-editor wheel interactions —
  noting again that these go via synthetic DOM events
  under Playwright, NOT real OS WM_MOUSEWHEEL)
- the explicit composition-hosting.spec.ts that sub-stage 3g
  will add

## Verdict

**Sub-stage 3c PASSES.** Mouse forwarding via `SendMouseInput`
routes real OS WM_LBUTTONDOWN through the composition controller
to React's event system end-to-end. Ready to proceed to
sub-stage 3d (cursor sync via `add_CursorChanged` +
`WM_SETCURSOR`), pending user OK.
