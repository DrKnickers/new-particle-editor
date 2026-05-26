# Phase 0 — Node-side UIA library search

**Date:** 2026-05-25
**Question:** Is there a maintained Node binding for Win32 UI Automation usable from Playwright tests (Phase 3 a11y close-out, MT-11 spec §4.2 / R1)?

## Methodology

Queried the npm registry directly (`https://registry.npmjs.com/-/v1/search`)
with three search texts (`uiautomation`, `ui automation windows`,
`win32 accessibility`, plus a follow-up `ui-automation`). For each candidate
of interest, pulled the package metadata, the last-week download count, and
the GitHub repo metadata (stars, forks, push date). For the most promising
hits, read the README to check whether the API surface includes
`IUIAutomation::ElementFromHandle` + tree-walking (`FindAll` /
`TreeWalker`), which is the minimum we need to capture a UIA tree under a
given HWND.

## Candidates evaluated

| Lib                                          | Latest pub  | Weekly DL | UIA tree walk?                                 | GH signals                                  | Verdict             |
|----------------------------------------------|-------------|----------:|------------------------------------------------|---------------------------------------------|---------------------|
| `node-winautomation`                         | 2026-02-09  |         8 | YES — `findFirst`/`findAll`/`TreeWalker`/`elementFromPoint`, native C++ addon | 4 stars, 0 forks, 9 commits total, created 2026-02-05 | REJECT — unproven   |
| `@nut-tree-fork/nut-js`                      | 2025-03-13  |    41,927 | NO — image-match / coordinate clicks; UIA tree NOT exposed | Active fork, broad adoption                 | REJECT — wrong tool |
| `winax` (node-activex)                       | 2026-03-31  |     7,217 | NO — `IDispatch` only; cannot instantiate raw COM interfaces like `IUIAutomation`         | Mature, broadly used for Office automation  | REJECT — wrong tool |
| `@nodert-win11/windows.ui.uiautomation`      | 2022-09-27  |         8 | UNCLEAR — wraps the UWP `Windows.UI.UIAutomation` namespace, not classic `IUIAutomation`; doc gives no third-party-HWND example | Stale, NodeRT generator-only repo           | REJECT — stale + wrong API |
| `@superbased/win-uia`                        | 2026-04-28  |        16 | Claims "UIA tree inspector. Native addon"      | GitHub repo `marmutapp/superbased` 404s — no source | REJECT — opaque, no source |
| `element-selector-sdk-nodejs`                | 2026-05-17  |        29 | Claims "Enterprise-grade UI Automation SDK for Windows", typings + imperative API | v0.0.2, brand-new, single-author repo       | REJECT — too new    |
| `node-uiautomation`                          | n/a         |       n/a | Package does not exist on npm                  | n/a                                         | n/a                 |

## Decision

**NO usable lib; ship C++ `uia_inspector.cpp`** as the spec already
anticipates (§4.2).

## Reasoning

`node-winautomation` is the only candidate whose advertised API actually
matches what we need (`FromHandle` + `TreeWalker`/`FindAll` over the
classic `IUIAutomation` interface, with native C++ bindings). Everything
else is either the wrong abstraction (image-based, IDispatch-only, UWP
namespace, no source) or doesn't expose UIA traversal at all.

But `node-winautomation` itself fails the bar for permanent test
infrastructure:

- 4 GitHub stars, 0 forks, 9 total commits.
- Created 2026-02-05 — three months old as of today.
- 8 weekly downloads — no real adopters to find the bugs we'd hit.
- README has no example of attaching to an *external* process HWND
  (Notepad/Calculator); examples only show find-by-name after the
  library's own initialization, leaving the most load-bearing path
  (`AutomationElement::FromHandle(hWnd)`) unverified.
- Author flags some Word features as `@experimental` with a 73% success
  rate — suggests known reliability gaps in adjacent code paths.

Locking the entire Phase 3 a11y test suite to a third-party native addon
with that profile is a worse bet than the spec's planned fallback: a
~150-line C++ console tool (`uia_inspector.cpp`) that uses
`CoCreateInstance(CLSID_CUIAutomation)` →
`ElementFromHandle(hWnd)` → recursive `FindAll(TreeScope_Children,
TrueCondition)` to dump a JSON tree on stdout. The Playwright test
spawns it as a child process, parses the JSON, asserts against the
allowlist.

That fallback is:
- **In-tree code.** We control bug-fix turnaround, versioning, and the
  exact serialization shape the allowlist normalizer expects.
- **Tiny surface area.** Three COM calls, recursion, one
  `JsonObject::Write` (we already have a JSON writer in the codebase).
- **Already in the build graph.** Compiles with the existing MSBuild
  toolchain — no node-gyp at install time, no prebuild fetch, no
  platform-specific install failure modes in CI.
- **Auditable.** A staff engineer can read the whole tool in 10 minutes.

The cost is ~half a day of C++ for T2 (already planned) versus weeks of
adopter-risk on `node-winautomation`. Easy call.

## Implications for the plan

- Proceed with T2 (`tools/a11y/uia_inspector.cpp`) as written in
  `tasks/todo.md`. No plan change.
- T3 (Playwright helper) will spawn `uia_inspector.exe` via Node
  `child_process.execFile`, not import a Node module.
- If `node-winautomation` matures (200+ stars, 1k+ DL, public adopters,
  documented `FromHandle(hWnd)` example) before Phase 4, we can revisit
  and potentially delete the C++ tool. Until then, in-tree wins.
