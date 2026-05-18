# LT-4 Phase 4.1 FD6 — WebView2 visual hosting for D3D9 transparency

**Tier:** ★★★★★ (architectural shift; replaces HWND-mode WebView2
with DComp visual hosting; touches host init, input forwarding,
resize, and shutdown)

**Status:** Plan-iteration. Awaiting user confirmation of the
risk list before any code.

---

## 1. Goal + scope

**What the user gets when this ships.** The D3D9 viewport renders
visibly under the WebView2-hosted React chrome, with menus / modals
/ tool panels correctly drawn ON TOP of the viewport (i.e. neither
"viewport over menus" nor "viewport invisible white" — both
regressions resolved in one shot).

**In:**

- Replace `CreateCoreWebView2Controller(parentHWND, …)` (HWND mode)
  with `CreateCoreWebView2CompositionController(parentHWND, …)`
  (visual-hosting mode).
- Stand up a DirectComposition tree on the host's main HWND:
  D3D11 device → DXGI factory → DComp device → DComp target →
  root visual. WebView2's `RootVisualTarget` plugs into the root.
- Keep the D3D9 viewport as a Win32 child HWND. Because DComp
  visuals composite OVER the parent HWND content (and the parent
  HWND's painted content includes any child HWNDs like the viewport
  sibling), the existing viewport HWND becomes visible the moment
  WebView2 stops being an opaque sibling HWND.
- Input forwarding: `WM_MOUSE*` / `WM_POINTER*` on the main HWND
  → `compositionController->SendMouseInput` /
  `SendPointerInput`. Mouse events whose cursor is inside the
  viewport rect skip forwarding so the D3D9 viewport receives
  them natively (camera tumble, shift-click spawn).
- Cursor handling: subscribe to
  `compositionController->add_CursorChanged`, call `SetCursor` in
  `WM_SETCURSOR`.
- Resize / DPI: on `WM_SIZE`, update `put_Bounds` AND the DComp
  visual transform. On `WM_DPICHANGED`, update
  `put_RasterizationScale`.
- LayoutBroker — unchanged. Viewport HWND is still a Win32 child
  with its own swap chain.
- Shutdown: `compositionController->Close()`; tear down DComp tree
  AFTER the controller closes.
- Accelerators: `add_AcceleratorKeyPressed` is on
  `ICoreWebView2Controller` which `CompositionController`
  inherits from, so the existing AcceleratorBridge call site moves
  unchanged.

**Out:**

- `viewport_poc.cpp` — keep the existing HWND-mode PoC untouched
  as a reference fallback (it's not on the ship path).
- Touch input — only mouse + pointer for now; touch can be added
  if the user needs it (no current requirement).
- DComp animations — the visual tree is static (single visual at
  the WebView2 root); no animation surface needed.
- Test-host (Playwright via CDP) — defer to a follow-up PR.
  Visual-hosting mode is compatible with the host-object bridge
  (`AddHostObjectToScript`) which is what test-host uses, so it
  *should* work without changes; verifying is a separate
  workstream and Risk 3 below.

## 2. What the codebase already gives us

- [src/host/HostWindow.cpp:542-749](src/host/HostWindow.cpp) —
  current `InitWebView2()`. Sets up env, controller, ctrl2
  transparency, test-host HostBridgeProxy, AcceleratorBridge,
  WebMessageReceived, Navigate. The shell to replace is the
  `CreateCoreWebView2Controller` call at line 542 and the
  resulting controller-completed callback through line 749.
- [src/host/HostWindow.cpp:274](src/host/HostWindow.cpp) —
  `ComPtr<ICoreWebView2Controller> webController` member. Becomes
  `ComPtr<ICoreWebView2CompositionController>
  compositionController` PLUS `ComPtr<ICoreWebView2Controller>
  webController` (the base interface, QueryInterface'd from
  composition; shared call sites like `Close` and
  `add_AcceleratorKeyPressed` use this).
- [src/host/HostWindow.cpp:493-499](src/host/HostWindow.cpp) —
  `ResizeWebViewToClient` calls `put_Bounds`. With composition
  controller, `put_Bounds` still exists (inherited) but the
  visual also needs a Direct2D / DComp transform if scaling is
  required.
- [src/host/HostWindow.cpp:838-850](src/host/HostWindow.cpp) —
  WM_CLOSE / WM_DESTROY shutdown. `webController->Close()` swaps
  to `compositionController->Close()`.
- [src/host/AcceleratorBridge.cpp](src/host/AcceleratorBridge.cpp)
  — driven by `add_AcceleratorKeyPressed` on the base controller
  interface. No change.
- [src/host/viewport_poc.cpp](src/host/viewport_poc.cpp) —
  reference for the HWND-mode path. May serve as fallback if
  visual-hosting fails on some GPU configs (theoretical, Risk 5).
- WebView2 SDK already in NuGet
  (`packages/Microsoft.Web.WebView2/`) — includes `WebView2.h`
  with `ICoreWebView2CompositionController` declared.

## 3. Architecture / implementation approach

### 3.1 New module: `src/host/Compositor.{h,cpp}`

Encapsulates DComp setup so HostWindow.cpp stays readable.

```cpp
// Compositor.h
namespace host {

// Owns the D3D11 + DXGI + DComp scaffolding required to host a
// WebView2 composition controller as a child visual.
class Compositor {
public:
    explicit Compositor(HWND parent);  // throws on failure
    ~Compositor();

    // The root visual of the DComp tree — WebView2's
    // RootVisualTarget becomes this visual's child.
    IDCompositionVisual* RootVisual() const { return m_rootVisual.Get(); }
    IDCompositionTarget* Target() const { return m_target.Get(); }
    IDCompositionDevice* Device() const { return m_device.Get(); }

    // Commit any tree changes (called after attaching the WebView2
    // visual + after resize).
    void Commit();

private:
    Microsoft::WRL::ComPtr<ID3D11Device>          m_d3dDevice;
    Microsoft::WRL::ComPtr<IDXGIDevice>           m_dxgiDevice;
    Microsoft::WRL::ComPtr<IDCompositionDevice>   m_device;
    Microsoft::WRL::ComPtr<IDCompositionTarget>   m_target;
    Microsoft::WRL::ComPtr<IDCompositionVisual>   m_rootVisual;
};

} // namespace host
```

### 3.2 HostWindow.cpp diffs

- Add `std::unique_ptr<host::Compositor> compositor;` member.
- In `Run()` after main HWND created and before `InitWebView2`,
  construct `compositor = std::make_unique<Compositor>(hMain);`.
- `InitWebView2()`:
  - Replace `env->CreateCoreWebView2Controller(parent, …)` with
    ```cpp
    ComPtr<ICoreWebView2Environment3> env3;
    env->QueryInterface(IID_PPV_ARGS(&env3));
    env3->CreateCoreWebView2CompositionController(parent, …);
    ```
  - In the completion handler, store as `compositionController`
    AND `webController` (the base `ICoreWebView2Controller`
    interface, QueryInterface'd from composition; shared call
    sites use this).
  - Set `compositionController->put_RootVisualTarget(compositor->RootVisual())`.
  - Set bounds to full client rect (`put_Bounds`).
  - `compositor->Commit()`.
- Replace `ResizeWebViewToClient`:
  ```cpp
  void HostWindowImpl::ResizeWebViewToClient()
  {
      if (!webController) return;
      RECT r; GetClientRect(hMain, &r);
      webController->put_Bounds(r);   // unchanged — inherited
      if (compositor) compositor->Commit();
  }
  ```
- `WM_DPICHANGED` — call
  `compositionController->put_RasterizationScale(dpi / 96.0)`.
- `WM_MOUSEMOVE` / `WM_LBUTTONDOWN` / `WM_LBUTTONUP` /
  `WM_RBUTTONDOWN` / `WM_RBUTTONUP` / `WM_MOUSEWHEEL` — forward
  via `compositionController->SendMouseInput(eventKind,
  virtualKeys, mouseData, point)`. Skip forwarding when the
  cursor is inside the viewport quadrant rect (the engine needs
  those for camera tumble + shift-click spawn).
- `WM_POINTER*` (touch) — also forward via `SendPointerInput`.
  Future scope.
- `WM_SETCURSOR` — read the cursor cached from
  `add_CursorChanged` and `SetCursor()`.

### 3.3 Viewport rect tracking

The host already knows the viewport rect — React sends
`layout/viewport-rect` and `LayoutBroker::Apply` stores `m_lastW`
/ `m_lastH`. Extend LayoutBroker to also store the rect
(x, y, w, h) and add a `GetViewportRect()` getter so the WndProc
input forwarder can check "is this cursor in the viewport?"
before deciding whether to forward to WebView2 or to let
`WM_MOUSE*` fall through to the viewport HWND naturally.

### 3.4 Migration of the test-host CDP path

`AddHostObjectToScript` on the CoreWebView2 (not the controller)
is unchanged. The test-host HostBridgeProxy code at
[src/host/HostWindow.cpp:594-625](src/host/HostWindow.cpp)
needs no change. CDP attaching to a composition controller is the
unknown — Risk 3.

## 4. Risks named up front + mitigations

### Risk 1 — Input forwarding bugs causing UI to feel broken

**Hazard.** `SendMouseInput` is finicky — wrong `eventKind`,
wrong virtual-key flags, or missed buttons → React UI feels dead
in spots or double-fires events. Cursor changes via
`add_CursorChanged` need to be wired or every hover changes
cursor to default.

**Mitigation.** Implement input forwarding incrementally; smoke
test each event type (move, l-down, l-up, r-down, r-up, wheel,
double-click) before moving on. Cache `currentCursor` from
`add_CursorChanged` and set in `WM_SETCURSOR`. Reference the
official WebView2 sample
(`WebView2Samples/SampleApps/WebView2APISample`) for the exact
event-type mappings.

### Risk 2 — Viewport-vs-chrome hit-testing

**Hazard.** Mouse events inside the viewport rect MUST go to the
D3D9 viewport HWND (for camera + shift-click spawn) and NOT be
forwarded to WebView2. Otherwise React tries to handle them and
the viewport never gets them. But chrome HTML overlays (tool
panels, menus that DROP DOWN INTO the viewport area) must keep
going to WebView2 even though they're visually inside the
viewport rect.

**Mitigation.** Two-step hit test. (a) Get viewport rect from
LayoutBroker. (b) Send the event to WebView2 first; if WebView2
"handles" it (we can check via the WebMessage / focus state),
done. Otherwise forward to viewport HWND. Practical
implementation: send to WebView2 ALWAYS, then ALSO `PostMessage`
to viewport HWND if the cursor is in the viewport rect AND no
HTML element captured the event. This may need iteration once
real menus are tested in-app.

### Risk 3 — Test-host (Playwright via CDP) flow breaks

**Hazard.** Composition mode may behave differently from HWND
mode when CDP attaches. The `AddHostObjectToScript` host-object
bridge may or may not survive the transition. CDP itself may not
attach to a composition-controller WebView2.

**Mitigation.** Tag the dispatch as not-blocking-on-CDP — run
the manual smoke tests against the production launch (no
`--test-host`), confirm the visual fix, and defer Playwright
verification as a separate `tests/native-cdp-compositionMode/`
sub-task. The CI test suite still passes via Vitest (the bridge
side). If CDP breaks, escalate to a follow-up PR.

### Risk 4 — Shutdown order / DComp resource lifetime

**Hazard.** WebView2 composition controller holds a reference to
the DComp visual. If `Compositor` is destroyed before WebView2 is
`Close`d, the visual lifetime is reversed and we get a
use-after-free.

**Mitigation.** Strict ordering in `HostWindowImpl` destructor:
(1) `compositionController->Close()` → wait for completion via
synchronous `OnControllerClosed` (or simply drop the controller
and let WebView2's normal shutdown run on the message pump),
(2) drop the `compositor` member. Document the ordering invariant
in HostWindow.h.

### Risk 5 — D3D11 / DXGI feature-level compatibility on the user's GPU

**Hazard.** DComp requires D3D11 feature level 10_0 or higher
with BGRA support. Modern PCs (incl. user's) have this. Old/no-GPU
fallback is software rendering, which DComp doesn't support.

**Mitigation.** Try `CreateDevice` with
`D3D_DRIVER_TYPE_HARDWARE` first; on failure, log and fall back
to the HWND-mode path (controller, not composition controller) —
i.e. preserve the current FD4 codepath as a fallback. Probability
is low on any machine that runs D3D9 EaW, but the fallback is
cheap to keep.

### Risk 6 — Bundle size for the WebView2 SDK headers

**Hazard.** `ICoreWebView2CompositionController` is in
`WebView2.h` but requires linking against the runtime DLL which
is already shipped (`WebView2Loader.dll`). No new linkage needed.

**Mitigation.** Verified — accepted.

### Risk 7 — Window-message subclassing / chrome rendering surprises

**Hazard.** Some Win32 features assume WebView2 is a real HWND
child (e.g. focus tabbing via `IsDialogMessage`). Composition
mode removes that HWND.

**Mitigation.** None of our code uses Win32 dialog message
routing across the WebView2 HWND. Confirmed by grep — no
`IsDialogMessage` / `TranslateAccelerator` calls in `src/host/`.
Accepted.

## 5. Testing & verification

### Manual checklist (run via host launch, NOT via Playwright)

**Happy paths**

- Editor launches; viewport visible with dark-purple clear color.
- Drag a TGA / ALO scene into the viewport — particles render
  visibly, not under chrome.
- Move mouse over each chrome region (menu bar, toolbar, sidebar,
  property tabs, track editor, status bar). Cursors change as
  expected (text cursor on inputs, hand on buttons).
- Click each menu, modal, tool panel, context menu. Menus open
  visually above the viewport (no z-order regression from FD4).
- Camera tumble works (left-drag in viewport).
- Shift-click spawn works.
- Right-click context menus in EmitterTree work.

**Edge cases**

- Resize the host window to 800×600, 1600×1200, 2560×1440.
  Viewport stays crisp; WebView2 chrome reflows correctly.
- Move the window across DPI boundaries (laptop + external 4K).
  WebView2 rasterization scale updates. Viewport text stays
  sharp.
- Cursor synchronization: hover from a button to the viewport
  edge. Cursor should change from hand to arrow at the boundary,
  no lag.

**Refused inputs**

- Mouse events inside the viewport rect: WebView2 doesn't react
  to them (verified by checking that `console.log` from a hover
  listener in the viewport quadrant does NOT fire during camera
  tumble).

**Cancellation / cleanup**

- Close the editor window. No leaked HWNDs (verified with Spy++
  — the WebView2 HWND should be gone, the viewport HWND should be
  gone, the main HWND should be gone).
- Re-launch — no orphan WebView2 user-data lock errors.

**Debug instrumentation**

- `[host] composition controller created` log line.
- `[host] compositor root visual = %p` log line.
- `[host] WM_MOUSEMOVE forwarded to WebView2` (debug-only, gated
  on `#ifndef NDEBUG` + suppression of high-frequency events).

### Build / type / unit / native test passes

- `MSBuild ParticleEditor.sln` clean.
- `pnpm build` clean (no React-side changes expected; build for
  parity).
- `pnpm test` 180 → 180.
- `pnpm test:native` — defer; will not pass until Risk 3 is
  resolved.

---

## 6. Architectural decisions (called out for user review)

1. **DComp scaffolding lives in a new `Compositor` class**, not
   inline in `HostWindow.cpp`. ~200 LOC of D3D11 + DXGI + DComp
   setup is its own concern, not part of the host window's
   life cycle. Keeps `HostWindow.cpp` readable.
2. **Keep the viewport as a Win32 child HWND**, not a DComp
   visual. D3D9 doesn't natively integrate with DComp without
   D3D9Ex shared-resource gymnastics. With WebView2 in
   composition mode, its DComp visual layers ABOVE the parent
   HWND content (which includes the viewport child), so
   HWND-mode viewport "just works" through transparency.
3. **Skip Playwright migration in this dispatch.** Per Risk 3,
   it's a follow-up. Manual smoke gate is the user testing in
   the host. Vitest still passes against MockBridge.
4. **Keep `viewport_poc.cpp` as-is.** Reference / fallback. Don't
   migrate it — that's not on the ship path.
5. **Accept Risk 5 fallback.** If DComp fails to init on a weird
   GPU, fall back to the FD4 HWND-mode path (white viewport but
   menus work). Cost: 20 LOC of `if (compositor) { … } else { … }`
   in `InitWebView2`. User's machine is fine; this is for
   theoretical robustness.

---

## 7. Plan summary for user check-in

- 1 new module (`Compositor.{h,cpp}`) — ~150 LOC.
- HostWindow.cpp diff — ~100 LOC (input forwarding +
  `WM_DPICHANGED` + `WM_SETCURSOR` + fallback branch).
- LayoutBroker — add 1 getter (~5 LOC).
- No React-side changes (the CSS chain stays as the May 18
  commit).
- 1 build + manual smoke pass.
- Defer: Playwright CDP migration, touch input.

**Biggest open risk:** input-forwarding correctness (Risk 1, 2).
Visual hosting input is notoriously fiddly. Plan to land this in
two commits — (a) compositor + visual hosting wired up, mouse
forwarding minimal (passive: send to WebView2, viewport gets a
direct WndProc); (b) cursor + DPI + edge cases.

**Confirm before coding starts:**

- (a) accept the new `Compositor` module location and name?
- (b) accept deferring Playwright CDP to a separate PR?
- (c) is the Risk 5 fallback (revert to FD4 white viewport on
  GPU failure) acceptable, or should we abort init instead?
