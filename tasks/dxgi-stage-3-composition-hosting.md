# tasks/dxgi-stage-3-composition-hosting.md — [MT-11] Phase 3 Stage 3

> **Active sub-plan.** Awaiting user OK + risks-iteration before any code.
>
> Parent plan: [`tasks/todo.md`](todo.md) §4 Stage 3 + §6 Stage 3 acceptance.
> Predecessors: [Stage 0 GO decision](../docs/superpowers/research/dxgi-stage-0-decision.md),
> [Stage 1 D3D9Ex migration](dxgi-stage-1-d3d9ex-migration.md),
> Stage 2 shared-handle infrastructure (in [HANDOFF.md](HANDOFF.md)).
> Mandatory pre-read: [docs/superpowers/research/dxgi-fd6-fd9-history.md](../docs/superpowers/research/dxgi-fd6-fd9-history.md).
> Working reference topology: [src/host/spike/dxgi_spike.cpp](../src/host/spike/dxgi_spike.cpp).

**Difficulty:** ★★★★★ (highest in project; documented FD6 failure
point; 4th attempt at WebView2 visual hosting on this codebase).

**Effort estimate:** 5-7 days per parent plan (extended from 3-day
baseline for the user-mandated rigorous a11y suite).

**Stage gate semantics.** Per parent §8, between sub-stages 3a-3i an
explicit user checkpoint at **3b, 3c, 3f, 3h, 3i** (the 5 load-bearing
gates; other sub-stages commit-only, no check-in). Stage 3 itself is
the second-largest gate of Phase 3 after Stage 0; the user can demand
freeze or revert after any sub-stage.

**Opaque-white-at-3b protocol (user-decided 2026-05-22):** ONE
structured 24-hour iteration round permitted before revert. The round
spends its time on the documented bisect path: enable the
`ALO_COMPOSITION_NO_WEBVIEW2` mode to confirm DComp itself works
in-process with a placeholder visual; if DComp passes there, add
WebView2 incrementally; instrument every API HRESULT; check whether
the WS_EX_LAYERED popup's presence triggers the failure. If after 24
hours the failure persists with no identified root cause: STOP,
capture binary + log + screenshot to
`tasks/stage-3b-FD6-mode-capture/`, revert sub-stage commits, surface
to user for revert-vs-continue decision. **Do not iterate beyond the
24h cap.** That class of failure burned 3× developer-weeks
historically; the spike already cleared it on this hardware, so a
production-mode-only reproduction is a different bug class than what
the spike measured.

---

## 1. Goal + scope

**When this ships:** With `ALO_WEBVIEW2_HOSTING=composition` set,
the editor's WebView2 chrome (React UI, dialogs, panels) renders
via DirectComposition visual hosting instead of an HWND-mode surface.
Behaviourally identical to HWND mode for every interactive surface
the existing 96-test Playwright suite + the new 7-test a11y suite
exercise: clicks land in the right React handlers, keys reach React,
modals open/close, dropdowns paint, cursor changes on link hover,
Narrator reads the menubar + tree + dialog labels, tab cycles through
interactive elements, F2 inline-rename works, Escape closes modals,
IME composition functions, 100 random keystrokes never crash.
**Without** the env var, behaviour is byte-identical to today — the
default new-UI path stays at `CreateCoreWebView2Controller` + HWND
mode, with no DComp tree, no Compositor class instantiated.

Engine pixels visibility on screen is **explicitly out of scope** for
this stage — that's Stage 4 (DXGI composition wiring). Stage 3
defines the *hosting surface* for the engine visual to attach to in
Stage 4, but Stage 3's DComp tree contains only the WebView2 visual.
A user running the composition build sees the React chrome
correctly; the viewport quadrant is whatever WebView2 paints there
(empty / transparent / whatever the canvas-in-DOM placeholder shows
under `ALO_VIEWPORT_TRANSPORT=canvas-jpeg`, but the canvas isn't
receiving frames because FramePublisher's stamp pipeline is bypassed
under composition mode).

**In scope:**

- New `host::Compositor` class — owns DComp V1 device +
  `IDCompositionTarget` bound to main HWND + root visual + WebView2
  child visual. Mirrors `dxgi_spike.cpp`'s topology line-for-line.
  Files: `src/host/Compositor.h`, `src/host/Compositor.cpp`. Built
  into `ParticleEditor.exe` via `src/ParticleEditor.vcxproj` (no new
  vcxproj).
- `src/host/HostWindow.cpp:InitWebView2` (line 606): env-var-gated
  swap from `CreateCoreWebView2Controller(hwnd, …)` to
  `CreateCoreWebView2EnvironmentWithOptions → ICoreWebView2Environment3 →
  CreateCoreWebView2CompositionController(hwnd, …)`.
- Visual tree construction **deferred until inside the composition
  controller completion callback** (FD6 v3 lesson; spike's
  `OnCompositionControllerReady` is the reference pattern).
- Host main HWND WNDPROC: forward `WM_*` mouse messages
  (`WM_MOUSEMOVE`, `WM_LBUTTONDOWN/UP`, `WM_RBUTTONDOWN/UP`,
  `WM_MBUTTONDOWN/UP`, `WM_MOUSEWHEEL`, `WM_XBUTTONDOWN/UP`) via
  `ICoreWebView2CompositionController::SendMouseInput`. Pointer
  variants (`WM_POINTER*`) via `SendPointerInput` only if the host
  receives them; default Win32 mouse path is the primary one.
- Keyboard: under composition hosting WebView2 doesn't get keyboard
  by default; host forwards via... well, this is the open question
  (see §5 risk #5 — Microsoft's sample uses
  `ICoreWebView2CompositionController3::SendKeyboardInput` IF it
  exists in 1.0.3967.48, else falls back to leaving keyboard to the
  existing `add_AcceleratorKeyPressed` path and DOM-level routing).
- Cursor sync: `add_CursorChanged` listener caches the
  `ICoreWebView2CompositionController::get_Cursor` value; main HWND
  WNDPROC's `WM_SETCURSOR` returns it.
- DPI: call `put_RasterizationScale(GetDpiForWindow(hMain)/96.0)` on
  init and on `WM_DPICHANGED`.
- `put_Bounds(fullClientRect)` on init and on `WM_SIZE`.
- New env var: `ALO_WEBVIEW2_HOSTING=composition` enables the path.
  Default unset → today's behaviour.
- Bisect diagnostic env vars: `ALO_COMPOSITION_NO_WEBVIEW2` (build
  the DComp tree with only an engine placeholder visual, prove DComp
  itself works in-process; spike's `--no-webview2` equivalent) and
  `ALO_COMPOSITION_NO_ENGINE` (no-op for Stage 3 since engine isn't
  in the tree yet, but the env-var slot is reserved for Stage 4 +
  documents intent).
- New Playwright spec
  `web/apps/editor/tests/composition-hosting.spec.ts` driving the
  96 existing tests in composition mode (env var set at spawn) — see
  §6 testing harness design.
- New Playwright spec
  `web/apps/editor/tests/composition-hosting-a11y.spec.ts` driving
  UI Automation against the running binary to verify Narrator-equivalent
  announcements for menubar / tree rows / dialog modal titles /
  form-field labels.
- Test harness wiring in
  `web/apps/editor/scripts/run-native-tests.mjs` to set the env var
  when running composition specs (and only those specs); preserves
  the existing 96-test A/B baseline.

**Out of scope (filed for later stages):**

- **Engine visual in the DComp tree.** Stage 4 attaches the engine
  as a D3D11 swapchain visual sibling of the WebView2 visual. Stage
  3's tree has WebView2 only.
- **Removal of WS_POPUP viewport HWND.** The popup is created
  unconditionally in `WM_CREATE` (HostWindow.cpp:898). It's required
  by `Engine`'s ctor (passes `hViewport` as the D3D9Ex device window).
  Under composition mode the popup is created + immediately hidden,
  same as `m_archCMode` does today. Removal is Stage 7 (cleanup
  under "DXGI ships as default" branch).
- **AlphaCompositor + FramePublisher bypass.** Under composition mode
  these continue to run (AlphaCompositor renders to its shared-handle
  texture, FramePublisher encodes JPEGs that the renderer-side canvas
  doesn't subscribe to) — wasted work but harmless. Their full
  removal is Stage 7. The shared-handle output of AlphaCompositor
  *will* be consumed by the engine visual in Stage 4.
- **`viewport/input` bridge surface changes.** Phase 2's
  InputDispatcher targets the popup HWND for engine input; that path
  doesn't change in Stage 3. New mouse forwarding for WebView2 is on
  a separate channel (host WNDPROC → SendMouseInput on composition
  controller).
- **Long-running stress + leak harness.** Stage 6 builds the
  resource-leak + 5-min-stress + driver-fallback infrastructure.
  Stage 3's a11y suite uses Playwright + UI Automation only.
- **`ResetEx` / D3D9Ex.QueryStatistics / GPU sync primitives.**
  Stage 4 territory.
- **Default switch.** `ALO_WEBVIEW2_HOSTING=composition` stays opt-in
  through Stages 3/4/5/6. Stage 7 considers making it default.

**Explicitly not happening:**

- **No production-default change.** The 96-test baseline gates on the
  HWND-mode path until Stage 7. Any vitest / Playwright drift in the
  default path is a Stage 3 regression and blocks the sub-stage.
- **No exploratory iteration on opaque-white failure.** Per §0 gate
  semantics — if 3b lands opaque white, revert + surface to user.

---

## 2. What the codebase already gives us

| Surface | Where | Role for Stage 3 |
|---|---|---|
| `dxgi_spike.cpp` working reference | [src/host/spike/dxgi_spike.cpp](../src/host/spike/dxgi_spike.cpp) | Known-good topology on user's RTX 3080: V1 `IDCompositionDevice` via `DCompositionCreateDevice2` factory, deferred `CreateTargetForHwnd` inside `OnCompositionControllerReady`, `insertAbove=FALSE` / `nullptr` ref for "in front of all siblings" (the gotcha bisected via `--no-engine`), `put_RootVisualTarget` to plug WebView2 into the visual, transparent `put_DefaultBackgroundColor`, no `WS_EX_LAYERED` on host HWND. Stage 3's Compositor class is a port of this code into a stable C++ class. |
| `InitWebView2` in HostWindow.cpp | [src/host/HostWindow.cpp:606-869](../src/host/HostWindow.cpp) | The env-var-gated swap site. Existing flow: `CreateCoreWebView2EnvironmentWithOptions` → controller completion callback (lines 644-863) wires DevTools / HostBridgeProxy / AcceleratorKeyPressed / put_Bounds / SetVirtualHostNameToFolderMapping / Navigate. **Every line of that callback must work under composition controller** since the existing 96-test suite drives all of these surfaces. Verified pre-coding: `add_AcceleratorKeyPressed`, `put_Bounds`, `get_CoreWebView2`, `get_Settings`, `AddHostObjectToScript`, `add_WebMessageReceived`, `Navigate`, `SetVirtualHostNameToFolderMapping` are all on `ICoreWebView2`/`ICoreWebView2_3`/`ICoreWebView2Settings`/`ICoreWebView2Controller` — all inherited by the composition controller. |
| `WM_CREATE` engine + popup + compositor construction | [src/host/HostWindow.cpp:898-993](../src/host/HostWindow.cpp) | Popup HWND created at 898 (we keep this — Engine needs the HWND). AlphaCompositor stood up at 947 against `engine->GetDevice()` (we keep this — engine still renders to its shared-handle texture). InputDispatcher stood up at 979 — independent of WebView2 hosting mode. **No structural change here**; Stage 3's composition path threads through `InitWebView2` only. |
| `WM_DESTROY` teardown | [src/host/HostWindow.cpp:1059-1098](../src/host/HostWindow.cpp) | Current order: webController->Close → webController/webView reset → m_framePublisher → m_inputDispatcher → engine->SetAlphaCompositor(null) → alphaCompositor.reset → engine.reset. Stage 3 adds: `compositor.reset()` after `webController.Reset()` (must drop WebView2's reference to its visual via Close() FIRST, then release the visual tree). Spike's Shutdown() at [dxgi_spike.cpp:783-818](../src/host/spike/dxgi_spike.cpp) shows the right order. |
| `WM_SETCURSOR` handling | [src/host/HostWindow.cpp:ViewportWndProc + MainWndProc](../src/host/HostWindow.cpp) | The main HWND doesn't currently override `WM_SETCURSOR` (it uses the class's default `LoadCursor(nullptr, IDC_ARROW)`). Stage 3 adds an override when composition mode is active. |
| `WM_DPICHANGED` handling | currently absent from MainWndProc | Need a new case that pushes the new scale into the compositor (and into the WebView2 controller's `put_RasterizationScale`). |
| `LayoutBroker` | [src/host/LayoutBroker.{h,cpp}](../src/host/LayoutBroker.h) | Owns scene-rect translation. Stage 3 doesn't touch it — under composition mode, scene-rect drives Stage 4's engine visual transform, but Stage 3's tree has no engine visual. The existing scene-rect → AlphaCompositor mask path keeps working for the (hidden, irrelevant) popup. |
| `InputDispatcher` | [src/host/InputDispatcher.{h,cpp}](../src/host/InputDispatcher.h) | Holds any `HWND` target; constructor at line 49 takes the popup HWND. Under composition mode, **this path is unchanged** — renderer-side `<canvas>` events still route through `viewport/input` bridge → InputDispatcher → PostMessage to popup → Engine's ViewportWndProc. The popup is hidden, but PostMessage works on hidden windows. Stage 3 does NOT change InputDispatcher. The new mouse forwarding for WebView2 is a separate Win32 message path inside MainWndProc. |
| `HostBridgeProxy` / TestHostBridge channel | [src/host/HostBridgeProxy.{h,cpp}](../src/host/HostBridgeProxy.h) + [web/apps/editor/src/bridge/test-host.ts](../web/apps/editor/src/bridge/test-host.ts) | L-003: postMessage drops under CDP attach; host-object channel is the workaround. Composition controller exposes `get_CoreWebView2` → same `ICoreWebView2::AddHostObjectToScript` API. Stage 3's risk #7 is "verify host-object channel works under composition hosting" — explicit smoke before declaring the 96-test suite green. |
| Stage 2's `Engine::GetSharedTextureHandle()` | [src/engine.cpp](../src/engine.cpp) + [src/host/AlphaCompositor.cpp](../src/host/AlphaCompositor.cpp) | Pre-built for Stage 4. Stage 3 doesn't call it. |
| `SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)` | [src/host/HostWindow.cpp:Run](../src/host/HostWindow.cpp) (preexisting) | Already set; `GetDpiForWindow(hMain)` returns the right value. |
| Main HWND class config | [src/host/HostWindow.cpp:1649](../src/host/HostWindow.cpp) | `WS_OVERLAPPEDWINDOW \| WS_CLIPCHILDREN`, no `WS_EX_LAYERED`. Matches spike's host class. Good. |
| Test orchestration | [web/apps/editor/scripts/run-native-tests.mjs](../web/apps/editor/scripts/run-native-tests.mjs) | Spawns `ParticleEditor.exe --new-ui --test-host`, attaches via CDP. Stage 3 extends with an `--hosting=composition` mode (or env var passthrough) so composition specs run with `ALO_WEBVIEW2_HOSTING=composition`. |
| WebView2 SDK 1.0.3967.48 | [packages/Microsoft.Web.WebView2.1.0.3967.48](../packages) | `ICoreWebView2Environment3::CreateCoreWebView2CompositionController` confirmed available (spike uses it from this exact SDK). `ICoreWebView2CompositionController::put_RootVisualTarget`, `SendMouseInput`, `SendPointerInput`, `add_CursorChanged`, `get_Cursor` confirmed. **`SendKeyboardInput` — open question, needs grep confirmation pre-coding (§7.1).** |
| FD6 v1/v2/v3 + FD7 post-mortem | [docs/superpowers/research/dxgi-fd6-fd9-history.md](../docs/superpowers/research/dxgi-fd6-fd9-history.md) | §9 "lessons for the spike" applies equally here: instrument every API HRESULT, build tree only after controller exists, don't conclude from surface symptoms, mirror sample topology, no `WS_EX_LAYERED`, screenshot before declaring GO. |

---

## 3. Architecture / implementation approach

### 3.1 New `host::Compositor` class

```cpp
// src/host/Compositor.h

#ifndef HOST_COMPOSITOR_H
#define HOST_COMPOSITOR_H

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wrl.h>
#include <dcomp.h>

#include "WebView2.h"

#include <functional>
#include <string>

namespace host {

// Compositor — owns the DComp V1 visual tree that holds the WebView2
// composition surface. Stage 3 of [MT-11] Phase 3: WebView2 hosting
// migration from HWND mode to composition mode. Stage 4 will add an
// engine D3D11 swapchain visual as a sibling of the WebView2 visual.
//
// Lifecycle:
//   1. ctor(hostHwnd, logger): create DComp device. No tree yet.
//   2. AttachWebView2(compositionController): builds the visual tree
//      INSIDE the controller-ready callback (FD6 v3 lesson — deferred
//      tree construction). Plugs the controller's RootVisualTarget
//      into the WebView2 visual. Commits the tree.
//   3. SetSize(w, h): updates root visual offset/clip on resize.
//   4. SetRasterizationScale(scale): forwards to the composition
//      controller (host owns the call since it knows DPI changes).
//   5. dtor: releases visuals + target + device. Caller MUST tear down
//      WebView2 controller FIRST (its put_RootVisualTarget reference
//      keeps the visual alive otherwise).
//
// Mirrors dxgi_spike.cpp:Init*/BuildVisualTree/Shutdown line-for-line.
// Differences from spike: this class operates inside a long-lived
// process (production host) so add explicit error reporting via the
// logger callback; the spike just LogDbg()s to a side log.

class Compositor {
public:
    using LogFn = std::function<void(const std::string& line)>;

    Compositor(HWND hostHwnd, LogFn log) noexcept;
    ~Compositor();

    Compositor(const Compositor&)            = delete;
    Compositor& operator=(const Compositor&) = delete;

    // Initialize DComp device + target (idempotent — no visuals yet).
    // Returns S_OK on success. Failure HRESULT logged + propagated.
    HRESULT Init();

    // Build the visual tree with the WebView2 composition surface as
    // the sole child of the root. MUST be called from the composition
    // controller completion callback, not from Init() (FD6 v3 lesson).
    HRESULT AttachWebView2(ICoreWebView2CompositionController* ctl);

    // Update root visual offset / clip on host HWND resize.
    HRESULT SetSize(int w, int h);

    // Commit pending visual-state changes. Called after every state
    // change that needs to land (size, transform, content).
    HRESULT Commit();

    // Diagnostic accessors for logging / instrumentation.
    bool IsReady() const noexcept { return m_treeBuilt; }
    HWND HostHwnd() const noexcept { return m_hwnd; }

private:
    HWND m_hwnd;
    LogFn m_log;

    Microsoft::WRL::ComPtr<IDCompositionDevice>   m_device;
    Microsoft::WRL::ComPtr<IDCompositionTarget>   m_target;
    Microsoft::WRL::ComPtr<IDCompositionVisual>   m_rootVisual;
    Microsoft::WRL::ComPtr<IDCompositionVisual>   m_webviewVisual;

    bool m_treeBuilt = false;
};

} // namespace host

#endif // HOST_COMPOSITOR_H
```

The `.cpp` is a port of `dxgi_spike.cpp:InitDComp` +
`BuildVisualTree` + `Shutdown` (lines 411-517, 783-818). Key
invariants from the spike that survive:

- `DCompositionCreateDevice2(nullptr, IID_PPV_ARGS(&IDCompositionDevice))`
  — V2 factory function, V1 IID. Matches sample. FD6 v3 used the same.
- `CreateTargetForHwnd(hwnd, TRUE)` — topmost=TRUE. Spike-validated.
- WebView2 visual added with `AddVisual(visual, FALSE, nullptr)` —
  `insertAbove=FALSE` + null ref = "in front of all siblings" (the
  bisected gotcha — MSDN naming is counterintuitive).
- `put_RootVisualTarget(m_webviewVisual.Get())` AFTER the visual is
  in the tree.
- `Commit()` once at end of AttachWebView2; subsequent state changes
  call Commit() themselves.

### 3.2 InitWebView2 swap (env-var gated)

```cpp
// src/host/HostWindow.cpp:InitWebView2 (around line 606-869).
// New code is inside CreateCoreWebView2EnvironmentWithOptions's
// completion callback, replacing the existing
// env->CreateCoreWebView2Controller(...) call.

// Read env var once at impl-class ctor (already pattern for archC).
// Add:
bool m_compositionMode = false;
if (const wchar_t* v = _wgetenv(L"ALO_WEBVIEW2_HOSTING")) {
    if (wcscmp(v, L"composition") == 0) m_compositionMode = true;
}

// Inside InitWebView2 completion callback:
if (m_compositionMode) {
    // 1. Stand up the Compositor (DComp device, no tree yet).
    m_compositor = std::make_unique<host::Compositor>(
        hMain, [this](const std::string& s){ Log("%s\n", s.c_str()); });
    HRESULT chr = m_compositor->Init();
    if (FAILED(chr)) {
        Log("[host] Compositor::Init failed hr=0x%08lx — falling back to HWND mode\n", chr);
        m_compositor.reset();
        // Fall through to legacy CreateCoreWebView2Controller path.
    }
}

if (m_compositionMode && m_compositor) {
    // 2. QI environment to Environment3 (composition controller maker).
    ComPtr<ICoreWebView2Environment3> env3;
    HRESULT qihr = env->QueryInterface(IID_PPV_ARGS(&env3));
    if (FAILED(qihr) || !env3) {
        Log("[host] QI ICoreWebView2Environment3 failed hr=0x%08lx — falling back\n", qihr);
        m_compositionMode = false;
        m_compositor.reset();
    } else {
        return env3->CreateCoreWebView2CompositionController(
            hMain,
            Callback<ICoreWebView2CreateCoreWebView2CompositionControllerCompletedHandler>(
                [this](HRESULT chr, ICoreWebView2CompositionController* ctl) -> HRESULT {
                    return OnCompositionControllerReady(chr, ctl);
                }).Get());
    }
}

// (else): existing CreateCoreWebView2Controller path (line 642).
```

`OnCompositionControllerReady` mirrors spike's same-named function
(lines 550-595):

```cpp
HRESULT HostWindowImpl::OnCompositionControllerReady(
    HRESULT hr, ICoreWebView2CompositionController* ctl)
{
    if (FAILED(hr) || !ctl) {
        Log("[host] CompositionController completion FAILED hr=0x%08lx\n", hr);
        return hr;
    }
    m_compositionController = ctl;

    // QI to base ICoreWebView2Controller for the existing wire-up.
    HRESULT qihr = ctl->QueryInterface(IID_PPV_ARGS(&webController));
    if (FAILED(qihr) || !webController) {
        Log("[host] QI ICoreWebView2Controller from composition failed hr=0x%08lx\n", qihr);
        return qihr;
    }

    // Reuse existing init: transparent bg, DevTools, AddHostObjectToScript,
    // AcceleratorKeyPressed, put_Bounds, get_CoreWebView2, Navigate,
    // add_WebMessageReceived, SetVirtualHostNameToFolderMapping.
    // — this is the existing 200-line callback body factored into a method.
    HRESULT setupHr = FinishWebView2ControllerSetup(webController.Get());
    if (FAILED(setupHr)) return setupHr;

    // Composition-specific: DPI + cursor sync + visual tree.
    UINT dpi = GetDpiForWindow(hMain);
    if (dpi == 0) dpi = 96;
    ctl->put_RasterizationScale(static_cast<double>(dpi) / 96.0);

    ctl->add_CursorChanged(
        Callback<ICoreWebView2CursorChangedEventHandler>(
            [this](ICoreWebView2CompositionController* sender, IUnknown*) -> HRESULT {
                HCURSOR hc = nullptr;
                sender->get_Cursor(&hc);
                m_webViewCursor = hc;
                return S_OK;
            }).Get(),
        &m_cursorChangedTok);

    // Build the DComp tree NOW (controller exists; deferred per FD6 v3).
    if (m_compositor) {
        HRESULT bhr = m_compositor->AttachWebView2(ctl);
        if (FAILED(bhr)) {
            Log("[host] Compositor::AttachWebView2 FAILED hr=0x%08lx — FD6-class failure?\n", bhr);
            return bhr;
        }
    }

    Log("[host] composition hosting ready (DComp tree committed)\n");
    return S_OK;
}
```

### 3.3 Mouse input forwarding (host main HWND WNDPROC)

Under composition hosting, mouse events arrive at the host main
HWND, not WebView2's child HWND. New cases in `MainWndProc`:

```cpp
// In MainWndProc, gated on m_compositionMode + m_compositionController:
case WM_MOUSEMOVE:
case WM_LBUTTONDOWN: case WM_LBUTTONUP: case WM_LBUTTONDBLCLK:
case WM_RBUTTONDOWN: case WM_RBUTTONUP: case WM_RBUTTONDBLCLK:
case WM_MBUTTONDOWN: case WM_MBUTTONUP: case WM_MBUTTONDBLCLK:
case WM_MOUSEWHEEL:  case WM_MOUSEHWHEEL:
case WM_XBUTTONDOWN: case WM_XBUTTONUP:
    if (m_compositionMode && m_compositionController) {
        // Coords: WM_MOUSEMOVE/WM_*BUTTON* are in CLIENT coords already.
        // WM_MOUSEWHEEL/WM_MOUSEHWHEEL are in SCREEN coords — translate.
        POINT pt = { GET_X_LPARAM(lp), GET_Y_LPARAM(lp) };
        if (msg == WM_MOUSEWHEEL || msg == WM_MOUSEHWHEEL) {
            ScreenToClient(hwnd, &pt);
        }
        m_compositionController->SendMouseInput(
            static_cast<COREWEBVIEW2_MOUSE_EVENT_KIND>(msg),
            static_cast<COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS>(wp),
            (msg == WM_MOUSEWHEEL || msg == WM_MOUSEHWHEEL)
                ? static_cast<uint32_t>(GET_WHEEL_DELTA_WPARAM(wp))
                : 0,
            pt);
        return 0;
    }
    break;  // legacy mode: DefWindowProc handles
```

`COREWEBVIEW2_MOUSE_EVENT_KIND` enum values literally match `WM_*`
constants (verified from `WebView2.h` — they're typed wrappers around
the Win32 constants). Same for `COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS`
matching `MK_*` bits.

**Capture handling.** `SetCapture(hMain)` on `WM_LBUTTONDOWN` etc.
when in composition mode so drag-past-window-edge still routes
events. `ReleaseCapture()` on button up. WebView2's HWND mode does
this automatically; under composition the host owns it.

### 3.4 Keyboard

**User-decided 2026-05-22: path (b) is the Stage 3 baseline.** If SDK
1.0.3967.48 lacks `SendKeyboardInput`, IME is documented as
known-broken under composition-mode until a separate SDK-bump
sub-task lands. If `SendKeyboardInput` IS present, path (a) is
preferred — but Stage 3 doesn't gate on it.

**Pre-coding step:** grep
`packages/Microsoft.Web.WebView2.1.0.3967.48/build/native/include/WebView2.h`
for `SendKeyboardInput`. If found → path (a), wire forwarding for
`WM_KEYDOWN/UP`, `WM_SYSKEY*`, `WM_CHAR`, `WM_IME_*` in MainWndProc.
If not found → path (b) — rely on DOM keyboard:

(b) **DOM keyboard via focus.** Composition controller sets DOM
focus on Tab/click. React inputs receive `keydown` via DOM event
delivery, not Win32 — same mechanism as today's HWND mode for
already-focused inputs. The existing
`add_AcceleratorKeyPressed` (HostWindow.cpp:733) still works through
the inherited `ICoreWebView2Controller` interface. Phase 2's
`viewport/input` bridge keyboard arm continues working for engine
input (Shift held for spawn) since it's renderer-originated, not
Win32-originated. IME is the documented casualty.

Either path: keyboard validation in sub-stage 3f gates on the 96
Playwright tests passing including the keyboard-driven ones (typing
into inspector spinners, F2 inline rename, Escape closes modal). If
path (b) lands but the 96-test gate fails on keyboard reasons,
re-evaluate path (a) / SDK bump as an inline decision (3f → 3f.1).

### 3.5 Cursor sync

```cpp
// Already in OnCompositionControllerReady above:
ctl->add_CursorChanged(…, &m_cursorChangedTok);  // caches HCURSOR

// In MainWndProc:
case WM_SETCURSOR:
    if (m_compositionMode && m_webViewCursor) {
        SetCursor(m_webViewCursor);
        return TRUE;
    }
    break;  // default handling
```

### 3.6 DPI

```cpp
// In MainWndProc:
case WM_DPICHANGED: {
    UINT dpi = HIWORD(wp);  // both HIWORD and LOWORD are the same
    if (m_compositionMode && m_compositionController) {
        m_compositionController->put_RasterizationScale(
            static_cast<double>(dpi) / 96.0);
    }
    // Resize host HWND to the suggested rect (passed via lp).
    RECT* prc = reinterpret_cast<RECT*>(lp);
    SetWindowPos(hwnd, nullptr,
        prc->left, prc->top,
        prc->right - prc->left, prc->bottom - prc->top,
        SWP_NOZORDER | SWP_NOACTIVATE);
    return 0;
}
```

### 3.7 Resize handling

```cpp
case WM_SIZE:
    ResizeWebViewToClient();  // existing; calls put_Bounds
    if (m_compositionMode && m_compositor) {
        RECT r;
        GetClientRect(hwnd, &r);
        m_compositor->SetSize(r.right - r.left, r.bottom - r.top);
        m_compositor->Commit();
    }
    return 0;
```

### 3.8 Teardown order

`WM_DESTROY` adds (in order):
1. Existing: `webController->Close()` — flushes pending WebView2 work.
2. New: `m_compositionController.Reset()` — drops our composition
   controller reference. WebView2's Close() above already cleared
   `put_RootVisualTarget`.
3. Existing: `webController.Reset()`.
4. Existing: `webView.Reset()`.
5. New: `m_compositor.reset()` — releases the visual tree. MUST
   happen AFTER WebView2 references are dropped, otherwise the
   tree's WebView2 visual stays alive via the controller's internal
   reference.
6. Existing: framePublisher / inputDispatcher / alphaCompositor /
   engine teardown.

### 3.9 Test harness

`run-native-tests.mjs` gets a per-spec env-var passthrough. New
specs that need composition mode declare it via a comment marker
the harness greps for, OR (cleaner) the harness checks the spec
filename pattern `composition-*.spec.ts` and sets
`ALO_WEBVIEW2_HOSTING=composition` before spawning the binary.

The existing 96 specs run with the env var BOTH unset (default
HWND mode — baseline, no change) AND set (composition mode — new
gate). That gives an A/B comparison. Total Playwright run:
96 (HWND) + 96 (composition) + 1 (composition-hosting-smoke) +
7 (a11y) = ~200 spec invocations. ~6-8 minute test wall-time.

A11y suite uses `node-ffi-napi` to call UI Automation COM directly
from the Playwright test process (Node-side), inspecting the
`ParticleEditor.exe` UI tree concurrently with the Playwright DOM
driver. Each test drives the React UI to a known state, then queries
the UI Automation tree for an element matching a XPath-like locator,
asserts the announcement string matches the golden file
(with `expect.stringMatching` for minor-wording tolerance).

---

## 4. Sub-stage decomposition

Per CLAUDE.md "Plan structure" and parent §8 stage-gate semantics:
break Stage 3 into reversible sub-stages, commit each, user
checkpoint between any two.

| Sub | Deliverable | Effort | Reversibility | User OK gate? |
|---|---|---|---|---|
| **3a** | `host::Compositor` class skeleton — `Compositor.h/.cpp` added to vcxproj, builds clean, no behaviour change (no env var consumes it). MSBuild + vitest + tsc + 96 native = unchanged. | 0.5 day | trivial revert (single commit) | No (additive) |
| **3b** | Env-var gate added. `ALO_WEBVIEW2_HOSTING=composition` → swap to `CreateCoreWebView2CompositionController` + Compositor::AttachWebView2 + put_Bounds. **No mouse forwarding yet.** Smoke: launch with env var, WebView2 chrome visible, mouse hover does nothing, screenshot proves React loaded. **FD6-class failure point.** If opaque white: revert + surface to user, do not iterate. | 1.5 days | one revert commit | **Yes** (load-bearing) |
| **3c** | Mouse forwarding via `SendMouseInput` in MainWndProc. `WM_MOUSEMOVE`, all button down/up/dblclk, wheel, xbutton. `SetCapture` / `ReleaseCapture`. Smoke: 96 Playwright tests run in composition mode pass. | 1 day | one revert commit | Yes (after smoke run) |
| **3d** | Cursor sync via `add_CursorChanged` + `WM_SETCURSOR`. Smoke: link hover changes cursor visually. | 0.5 day | one revert commit | No |
| **3e** | DPI via `put_RasterizationScale` + `WM_DPICHANGED`. Smoke: drag window between two monitors at different scales; UI re-rasterises at new scale. | 0.5 day | one revert commit | No |
| **3f** | Keyboard. Either `SendKeyboardInput` (path a) or document path b/c per §7.1. Smoke: 96 Playwright tests pass in composition mode INCLUDING the keyboard-driven ones (typing in inspector spinners, F2 inline rename, Escape closes modal). | 1 day | one revert commit | Yes (after run) |
| **3g** | New `tests/composition-hosting.spec.ts` — explicit assertions on clicks/keys reaching renderer with identical coords/values as HWND mode. ~10 tests. Drives A/B comparison. | 0.5 day | additive | No |
| **3h** | A11y automated `tests/composition-hosting-a11y.spec.ts` — UI Automation driving. 7 tests: menubar items / tree row labels / dialog modal titles / form-field labels / tab cycle / F2 rename / Escape close. Golden file with `stringMatching` tolerance. | 1.5 days | additive | Yes (a11y is the user-mandated gate) |
| **3i** | Final acceptance — manual a11y smoke (Narrator on real machine), IME smoke (if path-a SDK), keyboard nav stress (100 random keys via Playwright), visual confirmation screenshot. HANDOFF refresh. | 0.5 day | n/a | **Yes** (Stage 3 → Stage 4 gate) |

**Total: 7.5 days budget; 5-7 day stretch.** Add 0.5d buffer per
sub-stage for the FD6 failure-mode contingency.

---

## 5. Risks named up front + mitigations

**For ★★★★★ plans, CLAUDE.md says "iterate the risks list with the
user before writing code."** This section is the iteration target.

1. **FD6-class opaque-white reproduction in production context.**
   *Hazard:* spike runs in a clean process; production carries Engine,
   AlphaCompositor (which holds D3D9 device state), FramePublisher,
   InputDispatcher, WS_POPUP viewport HWND (with `WS_EX_LAYERED`).
   Any of these may interact with DComp redirection in ways FD6 hit
   and the spike didn't. Failure surfaces as 100% opaque white +
   every API logging `S_OK` — the exact FD6 v1/v2/v3 signature.
   *Mitigation:*
   (a) Default path unchanged (env-var-gated); production users
       unaffected.
   (b) Sub-stage 3b is the first place this can show. If it does:
       STOP, capture binary + log + screenshot, revert sub-stage,
       surface to user. **Do NOT iterate on opaque white.**
   (c) Spike-mirror invariants: V1 IDCompositionDevice via V2
       factory, deferred BuildVisualTree inside controller-ready
       callback, `insertAbove=FALSE`+null ref ordering, no
       `WS_EX_LAYERED` on host HWND (already confirmed),
       transparent `put_DefaultBackgroundColor`, plain
       `WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN` host class
       (already in place).
   (d) Diagnostic bisect env var `ALO_COMPOSITION_NO_WEBVIEW2` for
       3b-time isolation: build a DComp tree with a stub
       D3D11-cleared visual instead of WebView2, prove DComp works
       in-process before adding WebView2. Mirrors spike's
       `--no-webview2` mode.

2. **AlphaCompositor (WS_EX_LAYERED popup) + DComp on same process.**
   *Hazard:* The popup HWND is `WS_EX_LAYERED` + `UpdateLayeredWindow`.
   It's hidden in composition mode but still alive (Engine's
   device-window). DWM tracking a layered popup AND a DComp host
   HWND in the same process may have non-obvious interactions —
   not covered in FD6 since FD6 didn't have a separate popup.
   *Mitigation:* The popup is hidden (`SW_HIDE` via existing
   `m_archCMode` path, or new `m_compositionMode` triggers the same
   hide). DWM compositing skips hidden windows. Verify
   empirically in 3b smoke: log `IsWindowVisible(hViewport)` and
   `GetWindowLong(hViewport, GWL_EXSTYLE)` post-hide to confirm
   state.

3. **Engine D3D9Ex device + DComp + WebView2 in one process.**
   *Hazard:* Engine creates D3D9Ex device on hViewport HWND. Stage 1
   already promoted to D3D9Ex; Stage 2 already verified shared-handle
   round-trip with a parallel D3D11 device. Stage 3 adds DComp to
   the mix. The spike has D3D9Ex + D3D11 + DComp + WebView2 — same
   stack. Risk is low but worth a smoke for "Engine still produces
   frames into AlphaCompositor's shared-handle RT correctly under
   composition mode" (even though the user can't see them).
   *Mitigation:* `shared_texture_test.exe` is the bit-exact test
   already; running it stays trivially possible. After 3b smoke,
   also dump the AlphaCompositor's `lastRawDib` to a file (under a
   debug env var) and inspect: if engine pixels are correct, Stage 4
   can do its job.

4. **Input routing — mouse coords drift between HWND mode and
   composition mode.** *Hazard:* Some Win32 mouse messages put coords
   in different reference frames than others. The 96-test suite
   doesn't currently exercise that — under HWND mode, WebView2 owns
   the coord interpretation. Under composition, host forwards;
   coords must arrive at React the same way.
   *Mitigation:* The composition-hosting smoke spec (3g) drives a
   click at a known DOM rect, asserts React receives the click event
   with coords matching the rect — that's the regression-guard. If
   coords drift, fix in `SendMouseInput` before sub-stage 3c lands.

5. **Keyboard / IME under composition.** *Hazard:* If SDK 1.0.3967.48
   doesn't expose `SendKeyboardInput`, the composition controller
   handles only mouse — keyboard events still need to reach DOM
   (typing in inspector fields, Escape, F2). DOM keyboard works via
   focus + page-internal events; the composition controller setting
   focus on Tab into a DOM element is what allows that.
   *Mitigation:* Pre-coding grep for `SendKeyboardInput` (open
   question 7.1). If absent: path (b) — rely on DOM keyboard via
   focus; document IME as known-broken; schedule SDK upgrade as
   Stage 4 prep. If present: implement path (a) including IME.

6. **A11y under composition.** *Hazard:* UI Automation tree under
   HWND mode plugs into WebView2's child HWND's automation provider.
   Under composition, the controller exposes
   `get_AutomationProvider` — IF SDK 1.0.3967.48 has it. User
   explicitly requested rigorous a11y; broken Narrator is a Stage 3
   failure even if everything else works.
   *Mitigation:* Pre-coding grep `Microsoft.Web.WebView2` headers
   for `get_AutomationProvider` on the composition controller. If
   present + spike confirms tree access (extend spike with a
   `--a11y-probe` mode that dumps the UI Automation tree), build the
   a11y suite on top. If absent: this is a hard NO-GO for Stage 3
   and falls back to "WebView2 visual hosting is broken for our
   a11y target."

7. **Host-object channel (TestHostBridge) under composition mode.**
   *Hazard:* L-003 — postMessage drops under CDP attach, host-object
   channel is the workaround. The host-object channel is via
   `ICoreWebView2::AddHostObjectToScript`, accessed through the
   composition controller's `get_CoreWebView2`. Should work, but
   "should" is what FD6 logs said.
   *Mitigation:* Sub-stage 3b smoke explicitly verifies a
   TestHostBridge round-trip works under composition mode +
   `--test-host` flag. Same code path as today's, just through the
   composition controller.

8. **Resource teardown ordering — webview-visual stale references.**
   *Hazard:* `put_RootVisualTarget(webviewVisual)` makes WebView2
   reference the visual. Releasing the visual before WebView2 is
   closed leaves a dangling reference. Crash on shutdown or in the
   compositor commit loop.
   *Mitigation:* Documented teardown order in §3.8. Test: D3D11
   debug layer enabled in Debug build (already in spike) asserts
   live-object count is 0 at shutdown. If the assert fires, the
   order's wrong — fix before sub-stage commit.

9. **Multi-monitor / DPI-change at runtime.** *Hazard:* Drag the
   window from a 96-DPI monitor to a 192-DPI monitor; if
   `RasterizationScale` doesn't update, text is blurry. If
   `RasterizationScale` updates but tree dimensions don't, layout
   breaks. Phase 2's existing behaviour under HWND mode works because
   WebView2 owns its own DPI handling.
   *Mitigation:* §3.6 `WM_DPICHANGED` handler. Manual smoke in
   sub-stage 3e: drag between two monitors at differing scales,
   confirm text remains crisp.

10. **CompositionController-specific quirks the sample documents but
    spike didn't hit.** *Hazard:* Microsoft's
    `WebView2APISample` likely has notes about specific composition-
    mode gotchas (cursor in OPENGL contexts, modifier keys during
    drag, etc.) that the spike's minimal HTML didn't trigger.
    *Mitigation:* Pre-coding pass through the Microsoft sample's
    `ViewComponent.cpp` (`creationmode=visualdcomp` branch) to
    extract every gotcha they handle. The sample is already-built
    locally on this machine (FD6 v3 work). Cross-reference each
    handler against this plan; surface any uncovered cases as new
    risks.

11. **WebView2 1.0.3967.48 vs 1.0.4015-prerelease.** *Hazard:* FD6
    v3 tried the 4015 bump and it didn't fix the opaque-white but
    the spike works on 3967.48 — so 3967.48 is good for our minimum
    surface. If a Stage 3 risk surfaces that needs 4015, we'd be
    bumping the SDK mid-stage.
    *Mitigation:* Stage 0 spike already cleared 3967.48 on this
    rig. Don't bump unless 3f's `SendKeyboardInput` grep comes back
    negative AND 4015 has it. If a mid-stage bump is needed,
    schedule a separate SDK-bump sub-stage with its own gate.

12. **Total scope creep into Stage 4 / Stage 5.** *Hazard:* Stage 3's
    boundaries are tempting to expand — "while we're here, why not
    plug the engine visual too?" — but Stage 4 is its own gate.
    Mixing scope obscures regressions.
    *Mitigation:* Sub-stage 3i's HANDOFF refresh explicitly defers
    engine-visual wiring to Stage 4. Stage 3 ships with WebView2
    visual ONLY in the tree. The Stage 4 dispatch picks up from
    there.

13. **5-7 day budget overrun.** *Hazard:* Three FD6 attempts each
    burned a week or more. Even with the spike as proof-of-concept,
    the production migration is bigger than the spike (Compositor
    class, input rework, DPI, cursor, a11y). Risk of 10+ days.
    *Mitigation:* Sub-stage gates at 3b/3c/3f/3h/3i with explicit
    user check-ins. If 3b takes more than 2 days, surface for
    abort-vs-continue decision. Better to ship a partial Stage 3
    (composition controller works but a11y is deferred) than to
    burn the full budget and revert.

14. **Stage 3 ships, Stage 4 then fails.** *Hazard:* Phase 3's value
    is end-to-end DXGI; Stage 3 alone is half a feature. If Stage 3
    ships and Stage 4 then can't attach the engine visual cleanly,
    the user has a fully-tested composition-hosting harness with
    no engine pixels — net-zero value, full cost.
    *Mitigation:* The Stage 3 architecture (Compositor class + tree
    structure) explicitly models the Stage 4 engine-visual as a
    second child of the root visual. Adding the engine visual in
    Stage 4 is `m_compositor->AttachEngineVisual(swapchain)` —
    not a re-architecture. Risk is bounded.

15. **Canvas-in-DOM dependency for `viewport/input` test coverage.**
    *Hazard:* Phase 2's ViewportSlot renders a
    `<canvas data-testid="viewport-canvas">` ONLY when
    `VITE_VIEWPORT_TRANSPORT === "canvas-jpeg"` is set at build
    time; otherwise it renders a span placeholder. Without the
    canvas, no `pointerdown` / `wheel` / `keydown` DOM handlers
    attach, no `viewport/input` bridge events fire, and camera-
    control specs (`tests/viewport-camera.spec.ts`, the four
    viewport-input encoder tests in vitest, Shift+LMB spawn) all
    pass *trivially* because their dispatch handlers never run.
    The 96-test composition-mode gate would falsely declare
    green on a broken input path.
    *Mitigation:*
    (a) The composition-mode test harness sets BOTH
        `ALO_WEBVIEW2_HOSTING=composition` AND
        `ALO_VIEWPORT_TRANSPORT=canvas-jpeg` (+ matching
        `VITE_VIEWPORT_TRANSPORT=canvas-jpeg` at the build step
        for the bundled `dist/`). The composition A/B is
        "canvas-jpeg + composition" vs "canvas-jpeg + HWND" —
        not "composition vs default-no-canvas."
    (b) Sub-stage 3c smoke explicitly asserts the canvas IS in
        the DOM under composition mode + that
        `viewport-camera.spec.ts` exercises the bridge handler
        path (not a trivial-pass). Add an explicit
        `bridge.request` spy in the spec that asserts at least
        one `viewport/input` event fires per camera gesture.
    (c) HANDOFF + this plan document the env-var-pair as a unit
        — running composition mode without canvas-jpeg transport
        is unsupported through Stage 6 (Stage 7 may consolidate
        when DXGI ships as default).

---

## 6. Testing & verification (per CLAUDE.md verifiable-claims rule)

Manual surface kept to genuine human-required items. Automated
gates dominate.

### Inherited pre-flight (must all be green BEFORE coding starts)

- [ ] vitest 335/335 pass
- [ ] tsc -b 0 errors
- [ ] MSBuild Debug + Release x64 clean (preexisting LIBCMTD warning OK)
- [ ] Playwright native 96/96 pass (default HWND mode — baseline)
- [ ] `shared_texture_test.exe` PASS at 256×256 and 3440×1440
- [ ] `dxgi_spike.exe` runs + shows live FPS + composited chrome at
      1080p (smoke; not part of every dispatch but recommended)

### Sub-stage 3a (Compositor class skeleton) — additive

- [ ] MSBuild Debug + Release x64 clean — new files compile
- [ ] vitest 335/335 / tsc / native 96 unchanged
- [ ] `host::Compositor` skeleton exists, ctor/dtor only, no consumer
      — confirmed by grep + build

### Sub-stage 3b (env-var gate + minimal tree) — **HARD GATE**

- [ ] MSBuild + tsc + vitest unchanged
- [ ] **WITHOUT env var:** native 96/96 pass (baseline preserved)
- [ ] **WITH env var:** smoke launch — `ALO_WEBVIEW2_HOSTING=composition
      ./x64/Debug/ParticleEditor.exe --new-ui --test-host` produces
      a window with React chrome visible. **Screenshot in
      `tasks/stage-3b-smoke-screenshot.png` committed with the
      sub-stage.** This is the load-bearing FD6-failure-mode gate.
- [ ] Log file shows `[host] composition hosting ready (DComp tree
      committed)`; no FAILED lines; specifically no `BuildVisualTree
      FAILED hr=…`; specifically no `put_RootVisualTarget` failure
- [ ] If opaque white observed: STOP per §0; capture binary + log +
      screenshot to `tasks/stage-3b-FD6-mode-capture/`; surface to
      user before any code change

### Sub-stage 3c (mouse forwarding) — composition-mode native suite

- [ ] **All 96 existing Playwright tests pass under
      `ALO_WEBVIEW2_HOSTING=composition`** — A/B against baseline
- [ ] New spec `tests/composition-hosting.spec.ts` (~10 cases):
  - [ ] Click at known DOM rect → React receives `pointerdown` at
        matching coords (±2 px tolerance for DPI rounding)
  - [ ] Drag past window edge with `SetCapture` → events keep
        flowing
  - [ ] Wheel up/down → React `wheel` event with sign matching HWND
        mode
  - [ ] Right-click context menu opens
  - [ ] Modifier keys (Ctrl+click, Shift+click) → React receives
        with matching modifiers
- [ ] D3D11 debug-layer (if enabled) reports zero live objects on
      shutdown

### Sub-stage 3d (cursor)

- [ ] Manual smoke: hover over a link in About modal; cursor
      changes to pointer; move away; reverts. Screenshot captured
      to docs (sub-stage commit)
- [ ] No regressions in 96-test composition-mode suite

### Sub-stage 3e (DPI)

- [ ] Manual smoke: drag window between two monitors at differing
      DPI (user's rig has 4K monitor + 1080p — both scales available
      simultaneously). Text re-rasterises at new scale; no blur
- [ ] `WM_DPICHANGED` log line confirms scale update
- [ ] No regressions in 96-test composition-mode suite

### Sub-stage 3f (keyboard) — composition-mode native suite #2

- [ ] All 96 Playwright tests pass — A/B against baseline
- [ ] Including specifically: tests that exercise typing
      (`Spinner.test.tsx` already covers via vitest; native specs
      typing into inspector fields), Escape modal close, F2 inline
      rename, Tab cycle, accelerator keys (Ctrl+Z undo, etc.)

### Sub-stage 3g (composition-hosting smoke spec)

- [ ] New `composition-hosting.spec.ts` extended to 10-15 cases.
      Covers gestures from §3c above PLUS keyboard gestures
      (typing into inspector spinner, Escape, F2). A/B parity to
      HWND mode

### Sub-stage 3h (a11y automated) — **USER-MANDATED GATE**

- [ ] New `composition-hosting-a11y.spec.ts` (7 tests):
  - [ ] **Menubar:** UI Automation tree shows `MenuBar` with
        `File / Edit / View / Emitters / Mods / Help` items, each
        having `Name` matching the rendered text
  - [ ] **Tree rows:** EmitterTree's automation tree exposes each
        row as a `ListItem` with `Name` matching the emitter
        identifier
  - [ ] **Dialog modal titles:** open About modal; UI Automation
        sees a `Window` with `Name="About"`
  - [ ] **Form-field labels:** in EmitterPropertyTabs, every spinner
        has an `AutomationName` matching the label text (using the
        new L-010 post-rename labels)
  - [ ] **Tab cycle:** drive Tab key 10 times; assert focus visits
        the documented next-focusable element each time
  - [ ] **F2 inline rename:** select a tree row + F2 → an `Edit`
        automation element appears with focus
  - [ ] **Escape closes modal:** open Help → About → Escape; modal
        gone, focus returns to the invoker
- [ ] All 7 pass against a golden file at
      `tests/golden/composition-a11y.json` with
      `expect.stringMatching` tolerance for wording

### Sub-stage 3i (final acceptance + manual a11y + IME)

- [ ] **Manual a11y smoke on user's rig:** Narrator on; launch
      composition build; navigate menubar with arrow keys
      (Narrator reads each item); Tab cycles focus across panels
      (Narrator reads each); open + close a modal with keyboard
      (Narrator announces open + close); F2-rename a tree row
      (Narrator reads the rename input). Pass if no silent
      transitions
- [ ] **IME smoke (manual, irreducible):** install IME (Japanese
      MS-IME for testing); type into a spinner via IME composition;
      composition pre-edit shows + commits correctly. Skip if path
      (b) for keyboard — document as known-broken
- [ ] **Keyboard nav stress (Playwright):** 100 random key events
      (mix of Tab / Shift+Tab / arrows / Enter / Escape / random
      letter); after each, focus is visible (`document.activeElement
      !== document.body`); no console errors; no crash. Add as
      part of `composition-hosting.spec.ts`
- [ ] **Visual confirmation screenshot:** launch composition build,
      open About modal (so chrome + modal + viewport quadrant all
      visible), screenshot full window. Commit to
      `tasks/stage-3-final-screenshot.png`. Per FD6 history rule:
      "screenshot before declaring GO" — this is the artefact
- [ ] HANDOFF.md refreshed with Stage 3 ship state
- [ ] CHANGELOG entry drafted (TODO-HASH placeholder per
      convention; backfill on merge)

### Cross-sub-stage debug instrumentation

`#ifndef NDEBUG` printfs tagged `[COMP]` everywhere DComp /
composition-controller calls happen. Tag prefix: `[COMP]` —
greppable from the host log file. Removed pre-3i ship per CLAUDE.md
debug-instrumentation lifecycle. Specifically:

- `[COMP-init]` Compositor::Init device creation
- `[COMP-tree]` BuildVisualTree per-visual events
- `[COMP-attach]` AttachWebView2 per-step
- `[COMP-input]` SendMouseInput / SendKeyboardInput per call (very
  noisy — 1 Hz throttle)
- `[COMP-dpi]` rasterization scale changes
- `[COMP-cursor]` add_CursorChanged handler firings
- `[COMP-fail]` any failure path with HRESULT

---

## 7. Open questions before code starts

1. **`SendKeyboardInput` in SDK 1.0.3967.48 — RESOLVED 2026-05-22:
   NOT PRESENT. SUPERSEDED 2026-05-22 (during 3f implementation):
   THE API DOES NOT EXIST IN ANY SDK VERSION.** Initial grep
   showed zero hits in our 1.0.3967.48 headers. WebFetch against
   the canonical MS docs page (which lists API surface for every
   historical SDK version from 1.0.774.44 up through the latest
   1.0.4015-prerelease) confirms `SendKeyboardInput` is not on
   `ICoreWebView2CompositionController` in ANY version's API
   surface. The composition controller has 8 methods total
   (CursorChanged add/remove, get_Cursor, get_RootVisualTarget,
   get_SystemCursorId, put_RootVisualTarget, SendMouseInput,
   SendPointerInput) — keyboard is conspicuously absent. Path
   (a) is therefore a phantom; there is NO SDK-bump that would
   add it.

   **REAL FIX (Stage 3f path b+):** The DOM keyboard chain works
   under composition — but only when WebView2 has *logical*
   keyboard focus. Under HWND mode that's automatic (focus
   chain = HWND chain). Under composition the host HWND owns
   Win32 focus and WebView2 has no HWND, so logical focus needs
   explicit transfer via `ICoreWebView2Controller::MoveFocus`.
   That call is on the *base* controller (no QI needed) and
   exists in every SDK version. Stage 3f's two-call wiring
   (initial MoveFocus in OnCompositionControllerReady + per-
   WM_SETFOCUS routing in MainWndProc) is the documented
   Microsoft `WebView2APISample` pattern and the entire 3f
   delta is ~37 lines.

   IME naturally works once WebView2 owns focus (OS routes
   WM_IME_* to the focused window's input thread). No special
   IME wiring needed.

   See `tasks/lessons.md` L-017 for the meta-lesson about
   verifying SDK assumptions via docs before bumping.

   `ICoreWebView2CompositionController3` adds DragEnter/Leave/
   Over/Drop (not keyboard).

2. **`get_AutomationProvider` on composition controller — RESOLVED
   2026-05-22: PRESENT** on `ICoreWebView2CompositionController2`
   at `WebView2.h:35606`. Stage 3 a11y suite is achievable.
   `QueryInterface(IID_ICoreWebView2CompositionController2)` →
   `get_AutomationProvider(IUnknown**)` returns the IRawElementProvider
   that UI Automation queries. Wire this into sub-stage 3h.

3. **Is `SetVirtualHostNameToFolderMapping` (currently called inside
   the existing controller setup) sensitive to hosting mode?** L-015
   says it short-circuits `WebResourceRequested`. Composition mode
   may not interact the same way. **Pre-coding step: smoke at 3b
   that `https://app.local/index.html` loads under composition
   mode.**

4. **Do we want the `ALO_COMPOSITION_NO_WEBVIEW2` bisect env var as
   a real diagnostic mode, or just instrument the spike for this
   purpose?** Spike is already the bisect harness; production code
   may not need it. **Recommend:** don't add to production —
   keep spike as the bisect tool, production has only the main
   `ALO_WEBVIEW2_HOSTING` knob.

5. **Test runner — pass env var via spec filename pattern or via a
   spec-level marker?** Filename pattern (`composition-*.spec.ts`
   → env var set) is cleaner but adds a regex to the harness. Marker
   (a `test.use({ alo: 'composition' })` shape) is more explicit
   but needs a Playwright fixture. **Recommend:** filename pattern,
   simplest extension.

6. **`SetCapture` interaction with WebView2's internal capture under
   composition mode?** WebView2 may want capture for its own
   gestures. **Pre-coding step:** check sample's
   `ViewComponent.cpp` for how it handles capture; likely the host
   captures and forwards, but verify.

7. **Should sub-stage 3b's pre-FD6 smoke include the
   `ALO_COMPOSITION_NO_WEBVIEW2` mode?** As an extra de-risking step
   before adding WebView2 to the tree, get DComp working with a
   placeholder visual first. Adds 0.5d but cleaner bisect if 3b
   fails. **Recommend:** YES, add this step inside sub-stage 3b
   ("3b.0" before "3b.1").

---

## 8. Decisions for user before coding

These need OK before sub-stage 3a starts:

**D1. Sub-stage gate cadence — DECIDED 2026-05-22.** 5 load-bearing
check-ins at 3b, 3c, 3f, 3h, 3i. Other sub-stages commit-only.

**D2. Opaque-white failure protocol — DECIDED 2026-05-22.** ONE
structured 24-hour iteration round permitted before revert. Spent
on the documented bisect path (`ALO_COMPOSITION_NO_WEBVIEW2`
isolation, instrumented HRESULTs, WS_EX_LAYERED-popup-presence
toggle). After 24h with no root cause: STOP + revert + surface.

**D3. a11y golden-file shape — OPEN.** §6 sub-stage 3h proposes
JSON golden file at `tests/golden/composition-a11y.json` with
`stringMatching` tolerance. Alternative: per-test inline string
literals (more readable, harder to maintain across SDK upgrades).
*Recommendation: JSON golden file with tolerance.* Surface for OK
at sub-stage 3h start.

**D4. Keyboard path — DECIDED 2026-05-22, REVISED 2026-05-22 at 3f
implementation time.** The decision tree collapsed. Path (a) does
NOT exist in any SDK version per WebFetch verification against MS
docs (see §7.1). Stage 3f shipped path (b+) — DOM keyboard via
explicit `MoveFocus` calls — as the ONLY available path. ~37
lines of code in HostWindow.cpp; IME works automatically once
WebView2 owns logical focus.

**D5. Stage 3 sub-stage scope — OPEN.** 9 sub-stages as drafted vs
fewer-bigger commits. *Recommendation: 9 sub-stages — small commits
+ reversibility is the FD6 hedge.* Surface if user prefers bigger
chunks.

---

## 9. Stage gate (per CLAUDE.md "Verification before done")

Stage 3 ships when:

- [ ] All sub-stage acceptance checklists are green
- [ ] Composition build's screenshot shows React chrome correctly
      composited (the FD6-killer artefact)
- [ ] Default new-UI path is byte-identical to today (no
      `ALO_WEBVIEW2_HOSTING` regression)
- [ ] Manual a11y smoke passes on user's rig (Narrator drives every
      surface listed in 3h + 3i)
- [ ] HANDOFF + CHANGELOG drafted + committed
- [ ] Stage 4 prep documented in HANDOFF (engine-visual attach point
      in `Compositor` class is the seam)

User explicit OK after sub-stage 3i = Stage 3 → Stage 4 handover.
