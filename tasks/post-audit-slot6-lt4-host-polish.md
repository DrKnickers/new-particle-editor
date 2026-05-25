# Slot 6 — LT-4 Host Polish (F10, F11, G5, G6, G8; F9 + G7 deferred)

Per `tasks/post-audit-followups.md` "Suggested ordering" step 6.

## Scope deviation

Original slot scope: F9, F10, F11, G5, G6, G7, G8. After re-verification
shipping F10, F11, G5, G6, G8 in this PR and deferring F9 + G7:

- **F9** (hardcoded SDK `10.0.26100.0` in vcxproj per-file override): the
  followups doc's fix involves replacing the literal with macro-resolved
  paths AND running CI against a different SDK to verify the new path
  resolves correctly. I have only one SDK installed; can't verify cross-
  SDK behaviour autonomously. L-016 documents the maintenance cost as
  accepted. Defer to a session with cross-SDK CI access.

- **G7** (AlphaCompositor::Resize transactional rebuild): the audit
  rated this P3 ("rare on healthy systems"). The fix is a ~50 LoC
  refactor that builds new resources in locals first, then swaps into
  m_impl only on full success. Worth doing right rather than rushed;
  defer for a focused PR.

## In scope (5 items)

### F10 — `WM_MOUSELEAVE` / `TrackMouseEvent` for composition input

Pre-fix the host forwarded `WM_MOUSE*` events to WebView2 via
`SendMouseInput` but never sent the LEAVE event, so CSS `:hover` and
cursor state stuck after the pointer exited the host HWND.

Fix:
- New `bool m_mouseTracked = false;` member (TME_LEAVE arming flag).
- On WM_MOUSEMOVE under composition: arm `TrackMouseEvent(TME_LEAVE)` if not already armed.
- New `case WM_MOUSELEAVE`: send `COREWEBVIEW2_MOUSE_EVENT_KIND` cast of `WM_MOUSELEAVE` (the SDK 1.0.3967.48 doesn't expose a named LEAVE constant; the numeric-identity pattern already used by `ForwardMouseToCompositionWebView2` handles this).

### F11 — Env-var combination warning

Pre-fix `ALO_WEBVIEW2_HOSTING=composition` without `ALO_VIEWPORT_TRANSPORT=canvas-jpeg` would leave the legacy viewport popup visible underneath the composition tree.

Fix: log a `WARNING:` to stderr at env-var-read time if composition is set without archC. Doesn't auto-fix the combination; just makes the inconsistent state obvious in logs.

### G5 — `WebMessageReceived` token stored for explicit removal

Pre-fix the registration token was a local variable in `InitWebView2`; the handler lambda (which captures `this`) stayed subscribed at WM_DESTROY. Masked today by `webView.Reset()` but the explicit-unsubscribe pattern mirrors `accelKeyTok` / cursor-changed handling.

Fix:
- New `EventRegistrationToken webMessageTok = {};` member.
- `add_WebMessageReceived` stores into the member.
- WM_DESTROY explicitly calls `webView->remove_WebMessageReceived` before tearing down webView.

### G6 — DPR `MediaQueryList` listener leak

Pre-fix the effect cleanup in `ViewportSlot.tsx` set `mql = null;` but the active `change` listener stayed subscribed. One leaked listener per component unmount, each holding a stale closure (incl. `send` and `bridge`).

Fix: keep `onChange` in outer scope; cleanup explicitly `removeEventListener("change", onChange)`.

### G8 — `CreateSolidBrush` class-brush leak

Pre-fix the brush from `CreateSolidBrush(RGB(0x14, 0x08, 0x34))` was passed directly to `wc.hbrBackground` without being stored. No `UnregisterClass` is called, so the brush leaks for process lifetime (per WNDCLASSEX docs the system would free it on UnregisterClass — but the call doesn't happen here).

Fix:
- New `HBRUSH m_classBrush = nullptr;` member.
- `Run()` stores the brush in the member before assigning to `wc.hbrBackground`.
- WM_DESTROY `DeleteObject`s the brush.

## Risks

1. **F10's `static_cast<COREWEBVIEW2_MOUSE_EVENT_KIND>(WM_MOUSELEAVE)`** relies on the documented numeric-identity between WM_* constants and the SDK's enum values. Same assumption `ForwardMouseToCompositionWebView2` already makes. If WebView2 ever decouples these, both sites would break together — accepted.

2. **G8's DeleteObject in WM_DESTROY** assumes single-window-per-process for the class. If a second instance of the class is ever spawned (not today; would require code changes), the second instance would render with a freed brush handle. Accepted given the host's design constraint.

3. **G6's `if (mql && onChange)` cleanup guard** handles the corner case where the effect cleanup runs before `bindDprListener` did anything (e.g. very early unmount). Defensive only.

## Testing

- [ ] MSBuild Debug|x64 + Release|x64 clean.
- [ ] Manual: under composition mode, hover over an interactive web element (e.g. menu button), move the pointer out of the host window, observe `:hover` state clears (post-F10).
- [ ] Manual: launch with `ALO_WEBVIEW2_HOSTING=composition` only (no archC) and observe the warning in stderr log (post-F11).

---

## Review section

**What landed.** Two files, ~80 LoC net.

| Fix | File | Change |
|---|---|---|
| F10 | src/host/HostWindow.cpp | TME_LEAVE arming in WM_MOUSEMOVE branch + new WM_MOUSELEAVE case sending the LEAVE event. New `m_mouseTracked` member. |
| F11 | src/host/HostWindow.cpp | stderr warning at env-var-read time when composition is set without archC. |
| G5 | src/host/HostWindow.cpp | New `webMessageTok` member; stored in `add_WebMessageReceived`; removed in WM_DESTROY. |
| G6 | web/apps/editor/src/components/ViewportSlot.tsx | `onChange` lifted to outer-scope `let` binding; cleanup `removeEventListener` added. |
| G8 | src/host/HostWindow.cpp | New `m_classBrush` member; stored at Run() registration; DeleteObject in WM_DESTROY. |

**Build verification.**
- MSBuild Debug|x64 — clean (LNK4098 LIBCMTD baseline unchanged)
- MSBuild Release|x64 — clean (same)
- One in-flight error caught + fixed: F10's `COREWEBVIEW2_MOUSE_EVENT_KIND_MOUSE_LEAVE` named constant doesn't exist in SDK 1.0.3967.48. Replaced with `static_cast<COREWEBVIEW2_MOUSE_EVENT_KIND>(WM_MOUSELEAVE)` — matches the numeric-identity pattern `ForwardMouseToCompositionWebView2` already uses.

**Deviations.** F9 + G7 deferred (rationale at top of file). Five of seven items shipped.

**What I couldn't verify autonomously.**
- **F10 visual confirmation** — requires running the composition build, hovering over an interactive web element, moving the pointer out, observing CSS `:hover` clears.
- **F11 warning trigger** — requires launching with the inconsistent env-var pair.
- **G5 unsubscribe timing** — masked today by `webView.Reset()`; the explicit unsubscribe is symmetric-with-other-handlers defence in depth, not a guaranteed observable behavior change.
- **G6 listener-leak measurement** — requires DevTools heap snapshot before/after multiple unmount cycles. The fix is correct-by-construction.
- **G8 brush leak measurement** — requires GDI handle counter inspection. Same correct-by-construction argument.

**Confidence.** High. All five fixes are mechanical and clearly correct on the success path; the F10 fix has one runtime assumption (WM_MOUSELEAVE → COREWEBVIEW2_MOUSE_EVENT_KIND numeric identity) that mirrors existing code.

**Cross-references.**
- Followups doc: [tasks/post-audit-followups.md](post-audit-followups.md) F10, F11, G5, G6, G8 (+ deferred F9, G7).
