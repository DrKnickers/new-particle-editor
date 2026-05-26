# Phase 0 — Cross-mode UIA-tree wrapper-visual probe

**Date:** 2026-05-25
**Question:** Does composition mode expose a different UIA tree than HWND
mode for the same surface? (MT-11 spec §4.2 / R2)

## Capture method

PowerShell + `UIAutomationClient`:

```
$auto = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
$auto.FindAll(TreeScope::Children, Condition::TrueCondition)   # recursive, to depth 3
```

`$hwnd` is `Process.MainWindowHandle` of the launched
`ParticleEditor.exe --new-ui` for each mode. Same fresh build of `web/`
dist/, only env vars differ between launches.

For the composition mode we additionally checked
`TreeScope::Descendants` and `TreeScope::Subtree` to be sure the empty
tree wasn't a depth-3 artifact.

## Surface tested

Editor chrome at boot — no fixture loaded, no menus open. Both runs from
the same build of `x64/Debug/ParticleEditor.exe`, switching only the
dist/ that the host loads (default HWND vs `canvas-jpeg` + `composition`).

## HWND-mode tree (top 3 levels)

HWND `0x19176E`, PID 9312.

```
- Name='AloParticleEditor' Type=ControlType.Window Class='AloHostMain' AutoId=''
  - Name='' Type=ControlType.Pane Class='AloHostViewport' AutoId=''
  - Name='AloParticleEditor' Type=ControlType.Pane Class='Chrome_WidgetWin_1' AutoId=''
    - Name='' Type=ControlType.Pane Class='Intermediate D3D Window' AutoId=''
    - Name='AloParticleEditor - Web content' Type=ControlType.Pane Class='BrowserRootView' AutoId=''
      - Name='' Type=ControlType.Pane Class='NonClientView' AutoId=''
```

Two top-level panes under the host Window:
- `AloHostViewport` — our native viewport child HWND.
- `Chrome_WidgetWin_1` — the WebView2 chrome host. Inside it:
  - `Intermediate D3D Window` — D3D compositor surface.
  - `BrowserRootView` (named "Web content") — WebView2's Chromium views
    tree, where the actual React UI is eventually anchored.

Depth 3 stops at `NonClientView` inside `BrowserRootView`. The React tree
(menubar, dialogs, role=menuitem nodes) lives below that, at depths 4+,
not captured here but verifiably present in HWND mode.

## Composition-mode tree (top 3 levels)

HWND `0x4714A0`, PID 38420.

```
- Name='AloParticleEditor' Type=ControlType.Window Class='AloHostMain' AutoId=''
```

That's it. Single element. Confirmed with deeper scopes:

| Scope                   | Element count |
|-------------------------|---------------|
| `TreeScope::Children`   | 0             |
| `TreeScope::Descendants`| 0             |
| `TreeScope::Subtree`    | 1 (root only) |

The host Window has zero UIA children in composition mode.

## Diff

These trees are not "similar with extra wrappers" — they're
**structurally incomparable**. HWND mode exposes the full WebView2
Chromium views subtree under the host; composition mode exposes
**nothing** under the host.

The reason is mechanical. In WebView2 composition mode the WebView2
control renders to an `IDCompositionVisual` parented to a composition
target, not to a child HWND. Win32 UIA's `IUIAutomation::FromHandle(hWnd)`
walks the HWND hierarchy and the in-process UIA providers anchored to
those HWNDs. The composition surface has no HWND, so UIA's tree-walk
literally cannot see it from the outside.

This is a known property of DirectComposition-hosted WebView2 — the
content is reachable through the WebView2's CoreWebView2's own
`CoreWebView2Environment` accessibility APIs, but not through Win32 UIA
of the host process.

## Decision

**STOP — cross-mode equality contract is NOT feasible.**

The plan's T11 (cross-mode equality spec) was built on the assumption
that composition mode adds at most a small set of wrapper visuals on top
of an otherwise-equivalent UIA tree. The probe shows that's false: the
HWND-mode tree has the React UI under it (via `BrowserRootView`), and the
composition-mode tree has **zero** descendants. There's no wrapper list
that would make these equal because the right side has no payload at all.

Calling this "GO with strip wrappers" would be papering over a hard
architectural fact. The right move is to accept that **out-of-process
Win32 UIA cannot inspect composition-mode WebView2 content from the host
HWND**, and adjust the plan accordingly.

## Implications for the plan

1. **T11 (cross-mode equality spec) is INFEASIBLE as written.** Remove
   it from the plan or replace it with a deliberately scoped check:
   "composition-mode host HWND exposes the host shell only; React-tree
   a11y assertions are HWND-mode-only." That's a useful negative
   contract — it documents the boundary and prevents a future
   contributor from assuming Playwright a11y tests will catch
   composition-mode regressions.

2. **`alwaysStripWrappers` list (T1) is not needed for cross-mode
   reconciliation** — there's nothing to reconcile. The list can still
   exist for HWND-mode wrapper noise (`Intermediate D3D Window`,
   `Chrome_WidgetWin_1`, `BrowserRootView`, `NonClientView`) so the
   allowlist diffs stay focused on the React tree the user actually
   sees. Initial entries by ClassName:
   - `Chrome_WidgetWin_1`
   - `Intermediate D3D Window`
   - `BrowserRootView`
   - `NonClientView`

3. **All other tasks (T2 uia_inspector.cpp, T3 Playwright helper, T4-T10
   per-screen a11y specs) stand.** They target HWND mode, which is the
   default and where the React tree is inspectable. The C++ inspector
   already only needs to work against an HWND, which is exactly what
   default mode provides.

4. **Coverage gap to call out in HANDOFF.md.** Composition mode is a
   user-selectable transport (`ALO_WEBVIEW2_HOSTING=composition`); the
   a11y suite will not exercise it. Document this so future regressions
   in composition mode are caught by other means (manual a11y testing
   when the user toggles transports, or by spawning a child process and
   inspecting the WebView2's own a11y tree via CoreWebView2 APIs —
   substantially more work, out of Phase 3 scope).

5. **Optional follow-up (out of scope for T0):** investigate whether
   the WebView2 CoreWebView2 has an `AccessibilityNode` API that would
   let us reach the React tree in composition mode via a different
   mechanism. If feasible, that becomes its own roadmap item; not
   blocking Phase 3 close-out.

## Status reported to controller

**DONE_WITH_CONCERNS.** The cross-mode contract is not feasible. The
T11 task should be re-scoped (HWND-only assertion + negative contract
on composition mode) before code lands. Everything else in the plan
proceeds unchanged.
