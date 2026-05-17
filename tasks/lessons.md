# Lessons learned

Living file. After any user correction, append a rule that prevents the
same mistake. Each rule states the rule, the trigger, and the source
incident.

---

## L-001 — Don't infer binary provenance from bitness + timestamp alone

**Rule.** When inspecting a third-party binary, do not infer
"community recompile" from bitness + recent timestamp. The vendor may
have shipped the modernization themselves long after launch.

**Trigger.** Any time you find a binary that "should be" 32-bit /
"should be" old but is 64-bit / recent. Verify provenance via the
vendor's release notes / press coverage / signed-binary metadata
*before* asserting authorship.

**Source incident (2026-05-11).** While planning the bloom-iteration
RE work, I noted the EaW/FoC binaries were x64 with 2025 timestamps
and concluded "community recompile" — which would have made me caveat
the RE results as non-canonical. User corrected: Petroglyph themselves
shipped a 64-bit patch as a community-support gesture
(see `memory/project_petroglyph_64bit_patch.md`). The binaries are
canonical. The miscaveat would have polluted the CHANGELOG entry and
created false uncertainty about whether the discovered iteration count
was the "real" engine value.

---

## L-002 — Root `.gitignore` has `**/packages/*` (NuGet boilerplate) — silently eats `web/packages/` source

**Rule.** When adding any new top-level directory that contains a
`packages/` subdirectory (monorepo workspaces, npm/pnpm/yarn workspaces,
module folders), check the repo-root `.gitignore` *before* committing.
A `**/packages/*` rule (inherited from Visual Studio / NuGet project
templates) will silently exclude every file under any `packages/`
directory in the tree.

**Trigger.** Creating a new directory whose layout includes a
`packages/` segment. Examples that would trip this:
`web/packages/<name>/...`, `services/packages/<name>/...`,
`libs/packages/<name>/...`. The footgun: `git add web/packages/x` reports
success but stages nothing; the first sign of trouble is `git status`
showing fewer files than expected.

**How to apply.**
- Before staging, run `git check-ignore -v web/packages/<file>` (or
  equivalent path) to verify nothing's swallowing the path.
- If the root rule is load-bearing for the Visual Studio side, add
  scoped negation rules to the new directory's `.gitignore`:
  ```
  !packages/
  !packages/**
  ```
  Scoped to the subtree, won't accidentally un-ignore NuGet restore
  folders elsewhere.

**Source incident (2026-05-16).** During LT-4 Task 0.4 (web/ monorepo
bootstrap), the implementer was about to commit `web/packages/design-tokens/`
when they noticed `git add` had silently dropped the new source files.
Diagnosed via `git check-ignore -v` and patched `web/.gitignore` with
negation rules before committing. The root `.gitignore`'s
`**/packages/*` is inherited from the Visual Studio C++ project's
NuGet package-restore boilerplate — it's load-bearing for that side
and shouldn't be removed. Scoped negation is the right fix.

---

## L-003 — WebView2 drops `chrome.webview.postMessage` when CDP is attached

**Rule.** Don't plan a Playwright/CDP-driven test architecture that
relies on `chrome.webview.postMessage` to deliver bridge requests from
the page to the C++ host. The moment a CDP debugger is attached to
the WebView2 instance, the host stops receiving postMessage events —
even for calls made from page-internal JS (setInterval, RAF, event
handlers). The block is silent: `WebMessageReceived` never fires and
no error surfaces on either side.

**Trigger.** Any task that wants to drive the WebView2 bridge over
CDP for end-to-end testing. The natural design ("connectOverCDP →
`page.evaluate(window.bridge.request(...))`") will appear to work
during initial debugging (the first few requests from `App.tsx`'s
mount-time useEffects deliver successfully, before CDP attaches),
then silently fail for the entire test run.

**How to apply.**
- For Playwright contract tests against the native bridge, route
  test traffic through `ICoreWebView2::AddHostObjectToScript`
  instead of postMessage. That channel is a separate IPC and is
  not affected by CDP attachment.
- Alternative: use Playwright with a Vite-served standalone build
  loaded in headless Chromium (no WebView2, no CDP conflict). This
  exercises the TypeScript bridge surface but not the C++
  handlers — so it's only useful if MockBridge contract coverage
  is the goal, which Vitest already provides.
- If a CDP-based design is still preferred, do not lean on the
  six WebMsg log lines that appear during boot — those are
  pre-attach. Verify postMessage delivery post-attach (look for
  `[host] WMR` log lines in `%LOCALAPPDATA%\AloParticleEditor\host.log`
  *after* the CDP probe succeeds) before declaring the round-trip
  works.

**Source incident (2026-05-16).** During LT-4 Task 2.2, the planned
architecture (Playwright `connectOverCDP` + `page.evaluate(bridge.request(...))`)
failed every test with "context closed" timeouts. Diagnosis took
multiple iterations:
- Confirmed via `/json` that the CDP target was correct.
- Confirmed via direct WebSocket CDP probe that `window.bridge`
  was attached and `chrome.webview` was an `object`.
- Confirmed via host-side logging that `WebMessageReceived`
  fired during boot but not for any post-attach request, including
  ones scheduled via `setTimeout(() => bridge.request(...))` from
  inside the page.
- Confirmed via `Page.bringToFront` + `Emulation.setFocusEmulationEnabled`
  that visibility/focus state wasn't the cause.
- Confirmed bridge instance was `NativeBridge` (not MockBridge)
  by introspecting prototype methods.

The Task 2.2 deliverables (host `--test-host` flag, CDP enablement
via the SDK's `CoreWebView2EnvironmentOptions`, DevTools toggle,
`window.bridge` exposure, harness script, smoke-test spec) all
landed and pass; the four schema-contract specs are committed as
`test.fixme` so the assertions they encode survive into whatever
IPC channel replaces postMessage for tests.

**Followup (Task 2.2.1, 2026-05-16).** The host-object unblock landed.
`HostBridgeProxy` (COM IDispatch) is registered under
`chrome.webview.hostObjects.hostBridge` via `AddHostObjectToScript`
when `--test-host` is active. `TestHostBridge` in TypeScript routes
requests through that channel; the four schema-contract specs are
now live and pass. One refinement worth recording: the CDP drop is
**page → host only**. Host → page postMessage (events emitted via
`ICoreWebView2::PostWebMessageAsJson`) still reaches the page
normally under CDP attachment — verified by the
`engine/set/ground-z mutates state and fires engine/state/changed`
spec, which subscribes via `chrome.webview.addEventListener("message", …)`
and observes the event delivered after the request completes.
Practical implication: a host-object channel is only needed for the
request direction; events can stay on postMessage. Also, the data
delivered by `addEventListener("message", h)` is the *parsed* JS
value when the host uses `PostWebMessageAsJson` (string only when
the host uses `PostWebMessageAsString`); `TestHostBridge`
defensively accepts both shapes.

---

## L-004 — `pnpm test` ≠ `pnpm build`; `tsc --noEmit` ≠ `tsc -b`

**Rule.** Vitest does NOT type-check. A passing `pnpm test` says nothing
about TypeScript correctness. And `tsc --noEmit` (single-project mode)
is NOT the same as `tsc -b` (build mode with project references) — they
catch different errors. **The authoritative verification of a React/TS
change is `pnpm build`**, which runs `tsc -b && vite build`. If
`pnpm build` is green, the change is type-safe and the dist is
regenerated. If you only run `pnpm test`, you may ship a type error.

**Trigger.** Any time a subagent implementer reports "tsc --noEmit
clean, Vitest passing" without having run `pnpm build`. Their report
sounds rigorous; it is not. The first cross-cycle symptom is
`pnpm test:native` failing because the production `dist/` wasn't
rebuilt (the harness launches `ParticleEditor.exe --new-ui` which
loads `web/apps/editor/dist/`, not the dev server).

**How to apply.**
- **Bake into every implementer dispatch prompt:** the verification
  sequence is *exactly* `pnpm build → pnpm test → pnpm test:native`
  (and `MSBuild` for C++ changes). Do not let the implementer
  substitute `tsc --noEmit` for `pnpm build`.
- After the implementer commits, the controller still runs
  `pnpm test:native` once. The implementer might skip it claiming the
  spec "requires the native host" — it does, but the harness
  (`scripts/run-native-tests.mjs`) orchestrates the launch. Always run
  it from the controller.
- If `pnpm test:native` fails on a spec that used to pass, the most
  likely cause is a stale `dist/`. Run `pnpm build` and retry before
  diagnosing.

**Source incident (2026-05-16, Phase 3 Screen 1).** The Screen 1
implementer reported "tsc --noEmit clean" and never ran `pnpm build`.
`pnpm test:native` then failed because the bundled `dist/` was stale
(the StatusBar component existed only in source). Diagnosing took
10 minutes. Recurred mildly in Screen 3 (a pre-existing `mock.ts` cast
referenced an unbound generic — Vitest didn't catch it because it
doesn't type-check; `tsc -b` did). Phase 3 Screen 2 dispatch prompts
codified the "you MUST run `pnpm build`" rule and the issue stopped
recurring inside the implementer dispatch — but the controller still
needs to run `pnpm test:native` after every native-affecting change
because some implementers still skip it ("requires the native host").
