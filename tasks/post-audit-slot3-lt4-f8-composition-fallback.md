# Slot 3 — F8 Composition Controller Async-Failure Fallback

Per `tasks/post-audit-followups.md` "Suggested ordering" step 3. LT-4
sub-stage 3h work — branch from `origin/lt-4`, PR against `lt-4`.

## 1. Goal + scope

**Goal.** Close the async-callback failure hole in
`OnCompositionControllerReady` so failures during composition setup
fall back to HWND mode (already the documented intent — see comment at
[src/host/HostWindow.cpp:720](src/host/HostWindow.cpp:720) — but only
implemented for the synchronous pre-dispatch failure modes).

**In scope:**
- New custom message `WM_APP_COMPOSITION_FALLBACK = WM_APP + 1` carrying the failure HRESULT in `wParam`.
- Three failure sites in `OnCompositionControllerReady` (lines 1032, 1049, 1056) each `PostMessage` the fallback before returning their HRESULT.
- New private method `HRESULT DispatchHwndModeController(ICoreWebView2Environment* env)` extracted from the existing inline HWND-mode dispatch at line 767. Used by both the original sync path and the new async-recovery handler.
- New MainWndProc handler for `WM_APP_COMPOSITION_FALLBACK` that tears down partial composition state and re-dispatches via the stashed `webEnv`.

**Out of scope:**
- Adding retries or backoff — fallback is one-shot.
- Replacing the `m_compositor.reset()` pattern with a more structured composition-state machine. The current ad-hoc resets work; a refactor doesn't.
- Surfacing the failure to a user-facing dialog. The HWND fallback gives a working UI; the failure is logged but not raised. (Future polish.)

## 2. What the codebase already gives us

| Component | File:line | What it gives us |
|---|---|---|
| `webEnv` member | [src/host/HostWindow.cpp:301](src/host/HostWindow.cpp:301) | Already stashed in the env-creation callback at line 712. Re-callable for HWND-mode dispatch without re-creating the environment. |
| `m_compositor` / `m_compositionController` / `m_compositionMode` | [src/host/HostWindow.cpp:443-445](src/host/HostWindow.cpp:443) | All resettable as a unit. Existing sync-fallback path at lines 731-732 already does the `m_compositor.reset() + m_compositionMode = false` dance. |
| HWND-mode dispatch | [src/host/HostWindow.cpp:767-778](src/host/HostWindow.cpp:767) | Self-contained lambda body that creates the controller and routes through `FinishWebView2ControllerSetup`. Extracts cleanly to a private method. |
| `WM_APP` range | Win32 standard | `WM_APP + 1` is reserved for application-defined messages; no conflict with WebView2 or DirectComposition. |
| `PostMessage` semantics | Win32 | Composition-callback fires on the main thread (since WebView2 callbacks run on the thread that called Create); `PostMessage` to `hMain` queues for the next dispatch — gives the current callback time to unwind before we touch its state. |

## 3. Architecture / implementation approach

### Constant + class members (`src/host/HostWindow.cpp`)

Add near the existing constants:

```cpp
// Custom message dispatched from OnCompositionControllerReady when
// async composition setup fails. wParam carries the failure HRESULT.
// Handled in MainWndProc to tear down partial state and re-dispatch
// to HWND mode via the stashed webEnv. (Post-audit F8.)
static const UINT WM_APP_COMPOSITION_FALLBACK = WM_APP + 1;
```

Add private method declaration in `HostWindowImpl`:

```cpp
HRESULT DispatchHwndModeController(ICoreWebView2Environment* env);
```

### `DispatchHwndModeController` (extracted body)

```cpp
HRESULT HostWindowImpl::DispatchHwndModeController(ICoreWebView2Environment* env)
{
    if (!env) return E_POINTER;
    return env->CreateCoreWebView2Controller(
        hMain,
        Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
            [this](HRESULT ctlHr, ICoreWebView2Controller* controller) -> HRESULT
            {
                if (FAILED(ctlHr) || !controller)
                {
                    Log("[host] WebView2 controller failed 0x%08lx\n", ctlHr);
                    return E_FAIL;
                }
                return FinishWebView2ControllerSetup(controller);
            }).Get());
}
```

### Three failure-site updates in `OnCompositionControllerReady`

Each gets the same `PostMessage` line before returning:

```cpp
PostMessageW(hMain, WM_APP_COMPOSITION_FALLBACK, static_cast<WPARAM>(<the HRESULT>), 0);
return <the HRESULT>;
```

(Three call sites: lines 1032-1037, 1049-1053, 1056-1060.)

### New MainWndProc handler

```cpp
case WM_APP_COMPOSITION_FALLBACK:
{
    HRESULT failHr = static_cast<HRESULT>(wp);
    Log("[host] composition: async failure hr=0x%08lx — tearing down + falling back to HWND mode\n", failHr);

    // Tear down composition state. webController may be set if
    // FinishWebView2ControllerSetup got partway through; close it
    // before reset so WebView2's internal state unwinds cleanly.
    if (webController)
    {
        webController->Close();
        webController.Reset();
    }
    m_compositionController.Reset();
    m_compositor.reset();
    m_compositionMode = false;

    // Re-dispatch via stashed webEnv. Same env, new controller path.
    if (webEnv)
    {
        HRESULT hr = DispatchHwndModeController(webEnv.Get());
        if (FAILED(hr))
        {
            Log("[host] composition: HWND fallback dispatch failed hr=0x%08lx\n", hr);
        }
    }
    else
    {
        Log("[host] composition: webEnv not stashed; cannot fall back\n");
    }
    return 0;
}
```

### Replace the inline HWND-mode dispatch at line 767

The existing lambda body becomes a single call to the new helper:

```cpp
// Default HWND-mode path. Extracted to DispatchHwndModeController so
// the async-fallback handler (WM_APP_COMPOSITION_FALLBACK) can re-use
// it. (Post-audit F8.)
DispatchHwndModeController(env);
return S_OK;
```

## 4. Risks named up front + mitigations

1. **PostMessage queuing means the fallback runs on a later message-loop iteration.** During the interim, `m_compositionMode` is still true but `m_compositionController` may be null (path A) or set-but-broken (paths B/C). Any code that touches these between the failure and the fallback handler executing sees inconsistent state. Mitigation: the gap is bounded by one PostMessage→DispatchMessage round trip; no code other than the message handler should touch these members during that gap because the message loop is the only thing running. The InitWebView2 caller (Run) returned S_OK long ago and is just running its render loop — it doesn't poke at composition state.

2. **`webController->Close()` in path C tear-down.** Per WebView2 docs, `Close()` is the documented way to release a controller. If `Close()` itself fails or blocks, the host could deadlock. Mitigation: `Close()` is documented as synchronous and we're on the main thread; failure modes are rare and would be logged.

3. **Re-dispatched HWND controller's own failure path.** If `DispatchHwndModeController` fails (env is no longer usable), the inner callback's `Log + return E_FAIL` is the same behaviour as the original code — no UI comes up but the host doesn't crash. Same failure surface as pre-fix HWND mode. Accepted.

4. **State leakage if a failure happens AFTER the WebView is wired up.** If `FinishWebView2ControllerSetup` succeeded (line 1055 returned S_OK) but a later step in `OnCompositionControllerReady` failed (e.g. the cursor-change subscription, DPI scale set), webController is set and functional. Path C's tear-down would dismantle a working WebView. **Scope clarification:** the failure points I'm wiring are lines 1032/1049/1056 only. Anything past line 1060 (DPI, cursor, etc.) is best-effort with internal "non-fatal" logging — those don't need fallback. The fix targets the load-bearing failure points.

5. **L-016 header isolation.** `HostWindow.cpp` is NOT part of the L-016 modern-Windows-SDK-isolated subset (only `Compositor.cpp` is). My changes only touch standard Win32 + WebView2 SDK headers already in scope.

## 5. Testing & verification

### Build
- [ ] MSBuild Debug|x64 clean.
- [ ] MSBuild Release|x64 clean.

### Code-walk verification
- [ ] Three PostMessage call sites carry the correct HRESULT (originating from chr/qihr/setupHr respectively).
- [ ] DispatchHwndModeController exactly mirrors the original lambda body — no behaviour drift on the success path.
- [ ] MainWndProc handler tears down state in the right order (Close → Reset → reset).
- [ ] `m_compositionMode = false` is set BEFORE re-dispatch so the recursive InitWebView2 call (if any) takes the HWND path. (Doesn't recursively InitWebView2; just notes the invariant.)

### Manual smoke (deferred to user — opt-in path)
- [ ] Force a fake composition failure (easiest: temporarily edit `Compositor::Init` to return E_FAIL) under `ALO_WEBVIEW2_HOSTING=composition` and observe the host falls back to HWND mode + the React UI loads. Revert the test edit before commit.
- [ ] Normal composition launch should not change behaviour — the new code path is dormant unless an async failure fires.

### Automated tests already on lt-4
- [ ] `composition-hosting.spec.ts` exists ([web/apps/editor/tests/composition-hosting.spec.ts](../web/apps/editor/tests/composition-hosting.spec.ts)) — A/B parity for composition vs HWND modes. Should still pass; fix doesn't change the success path.

---

## Review section

**What landed.** Single file (`src/host/HostWindow.cpp`), ~75 LoC net.

| Change | Lines | Description |
|---|---|---|
| Constant `WM_APP_COMPOSITION_FALLBACK` | +10 | Inside the anonymous namespace before `} // namespace`. Carries failure HRESULT in `wParam`. |
| Member declaration `DispatchHwndModeController` | +8 | In `HostWindowImpl` struct between `OnWebMessage` and `MainWndProc` decls. |
| `DispatchHwndModeController` implementation | +20 | New method between `FinishWebView2ControllerSetup` and `OnCompositionControllerReady`. Byte-identical to the original inline lambda body. |
| Inline → helper at original call site | -14 / +5 | Replaced 14 lines of inline lambda with a 5-line call + comment. |
| Three failure-site PostMessage hooks | +18 | `OnCompositionControllerReady` paths A/B/C (lines 1032, 1049, 1056) each gain a 4-line PostMessage block. |
| MainWndProc handler | +35 | `case WM_APP_COMPOSITION_FALLBACK` between `WM_DPICHANGED` and `WM_SETCURSOR`. |

**Build verification.**
- MSBuild Debug|x64 — clean (LNK4098 LIBCMTD baseline unchanged)
- MSBuild Release|x64 — clean (same; "Previous IPDB not found" is a fresh-worktree artifact, not an error)

**Deviations from plan.** None. Implementation matches the architecture section verbatim. The MainWndProc insertion point (between `WM_DPICHANGED` and `WM_SETCURSOR`) ended up cleaner than the plan's tentative "near other composition-themed cases" — those two cases bracket the composition-specific area naturally.

**What I couldn't verify autonomously.**
- **Force-failure smoke** (plan's recommended manual test): would require temporarily editing `Compositor::Init` to return E_FAIL, building, launching with `ALO_WEBVIEW2_HOSTING=composition`, and observing the fallback. I built the binary but didn't run it; the user can drive that smoke if they want runtime confirmation. Build-clean + code-walk are the autonomous regression bar.
- **`composition-hosting.spec.ts` regression.** The fix's success path is byte-identical to the original (just extracted into a helper) so existing tests should pass unchanged. I didn't run the Playwright suite from this worktree.

**Subtleties worth flagging for reviewers.**
1. The fallback only triggers AFTER `CreateCoreWebView2CompositionController` has dispatched. Sync pre-dispatch failures (Compositor::Init, QI Environment3) keep their existing inline fallback — they don't need the PostMessage detour because they happen on the same call stack as the HWND-mode dispatch.
2. Path C tears down `webController` even though `FinishWebView2ControllerSetup` had set it. That's intentional — if the setup failed partway, the controller is in an undefined state and starting over with a fresh HWND-mode dispatch is safer than trying to rescue a half-initialized one.
3. `m_compositionMode = false` BEFORE `DispatchHwndModeController` so the new controller's `FinishWebView2ControllerSetup` and downstream code see the HWND-mode invariant.

**Confidence.** High. The fix is mechanical, the extracted helper preserves byte-identical behaviour on the success path, the PostMessage detour is the documented Win32 idiom for "defer work until the current callback unwinds," and the existing pre-dispatch fallback pattern at lines 731-732 provides clean structural prior art.

**Cross-references.**
- Followups doc: [tasks/post-audit-followups.md](post-audit-followups.md) F8.
- Stage 3 sub-plan referenced this as sub-stage 3h (the "real fallback" sub-stage queued before Stage 4 starts).
