# Next-session prompt — G11 (WebView2 navigation/permission policy)

You're picking up `new-particle-editor` (the **AloParticleEditor** rewrite —
Win32 + WebView2/React + D3D9Ex-via-DComp particle editor for Star Wars:
Empire at War), branch **`lt-4`**, at `origin/lt-4 = 685dbbd`. The handoff docs
are primary context but **verify every important claim against the actual code**
before acting — this is not boilerplate: session 8 found ~9 backlog items the docs
implied were open that had **already shipped** (the L-022 trap). The
**reconciliation block** (top of `tasks/post-audit-followups.md`) is the trustworthy
status snapshot; trust it over older notes, but still confirm the specific site you
touch.

## The task: G11 — WebView2 has no navigation / new-window / permission policy
`[lt-4]` `[P3 hardening]`. Plan: `tasks/post-audit-slot6-lt4-host-polish.md`. The
WebView2 host trusts "whatever page is loaded" rather than the intended origin. Add,
all in [`src/host/HostWindow.cpp`](../src/host/HostWindow.cpp) near the
`add_WebMessageReceived` registration (~line 1218):
- `add_NavigationStarting` → `put_Cancel(TRUE)` for any URI outside the approved set:
  `https://app.local/*` (prod) + `http://localhost:5174/*` (only when `useDevUi`).
  Allow `about:` (init may navigate about:blank). Navigate targets are
  `https://app.local/index.html` / `http://localhost:5174/`.
- `add_NewWindowRequested` → `put_Handled(TRUE)`, don't create a window (deny popups).
- `add_PermissionRequested` → `put_State(COREWEBVIEW2_PERMISSION_STATE_DENY)`.
- In the existing `WebMessageReceived` handler, reject when `get_Source` is outside the
  approved origins (a helper `IsApprovedWebViewOrigin(uri)` is clean).
Store the 3 new `EventRegistrationToken`s as members and `remove_*` them in WM_DESTROY
(mirror the G5 `webMessageTok` pattern at ~line 2019). ~30–40 LoC.

**The risk (and its guard):** an over-tight allow-list cancels the app's OWN initial
navigation → the editor never loads → every a11y spec goes dark. So the a11y suite IS
the verification: build Debug, run `pnpm --filter @particle-editor/editor a11y`; if
specs that previously passed now fail to find the app/bridge, loosen the allow-list.
(The 4 `splitters` failures are the known L-033 window-size artifact — not yours.)

## Pre-flight
```
git fetch origin lt-4 --quiet
git rev-parse --abbrev-ref HEAD                 # lt-4 or a fresh claude/* off lt-4
git log --oneline origin/lt-4..HEAD | wc -l     # expect 0
git log --oneline HEAD..origin/lt-4 | wc -l     # expect 0
git status --porcelain                          # expect clean
git rev-parse --short origin/lt-4               # expect 685dbbd or newer
```
If lineage doesn't match, STOP and reconcile per `CLAUDE.md` branch-workflow.

## Baseline (verify before changing anything)
- From `web/`: `pnpm --filter @particle-editor/editor test` → **390 passed** (45 files).
- `pnpm --filter @particle-editor/editor build` → clean. **This also builds
  `web/apps/editor/dist/`** — a fresh worktree MUST run it before launching `--new-ui`
  (else `app.local` `ERR_NAME_NOT_RESOLVED`). See **L-040**.
- Native `.sln` **Debug + Release x64** (absolute path; the Debug `LNK4098 LIBCMTD`
  warning is pre-existing/benign):
  `& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" "<repo>\ParticleEditor.sln" /p:Configuration=Debug /p:Platform=x64 /nologo /verbosity:minimal /m`
  - **Fresh worktree?** NuGet restore with no `nuget.exe`: copy
    `~/.nuget/packages/microsoft.web.webview2/1.0.3967.48/*` →
    `packages/Microsoft.Web.WebView2.1.0.3967.48/` (**L-039**), then build.
- `pnpm --filter @particle-editor/editor a11y` (needs `x64\Debug`) → **157 passed**, 4
  `splitters` failures (the L-033 artifact). **L-038**: native host logic is gated by
  a11y, not vitest+build.

## Read first (then VERIFY)
- **`tasks/HANDOFF.md`** top "session 8" entry — what shipped (9 commits), verified
  state, and this G11 task in full.
- **`tasks/post-audit-followups.md`** — the **Status reconciliation block** at the top
  (trustworthy open/shipped list) + the G11 entry; **`slot6`** doc has the G11 plan.
- **`tasks/lessons.md`** — **L-033** (agent native launches misrender — verify via the
  user / a11y, not your screenshots), **L-038/L-039/L-040** (a11y gate / NuGet / dist),
  **L-022** (verify "open" items aren't already done), **L-043** (dispatcher handler
  placement), **L-044** (`sendErr` vs nested-`ok`; assert shape not count).
- `CLAUDE.md` — working principles, LT-4 branch flow (FF into `lt-4`; never `master`
  without explicit OK).

## Process (per CLAUDE.md)
- Summarize your understanding + the G11 approach and confirm scope before coding.
- TDD where it fits; for the native handler, the a11y suite is the gate (L-038).
- On landing: update `CHANGELOG.md`, mark G11 ✅ in the reconciliation block + its
  followups heading, append any lesson, FF-push to `lt-4`. **Never `master` without OK.**

Before changing anything, summarize your understanding of the project state and your
approach, and wait for confirmation.
