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

---

## L-005 — pnpm v11's `allowBuilds:` block wants a boolean, not the literal placeholder string

**Rule.** When pnpm v11 (since the v11 build-script approval flow) gates
a dependency's post-install, it injects an `allowBuilds:` block into
`pnpm-workspace.yaml` with the literal placeholder string `set this
to true or false`. Do NOT strip the block — pnpm re-injects it on the
next `pnpm install`. Instead, **replace the placeholder string with
`true` (or `false`) per package**:

```yaml
allowBuilds:
  esbuild: true
onlyBuiltDependencies:
  - esbuild
```

This is durable: pnpm sees the boolean, accepts it as the user decision,
and leaves the block alone on subsequent installs.

**Trigger.** Any time `pnpm install` produces
`[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: <pkg>@<ver>` and the
`pnpm-workspace.yaml` contains an `allowBuilds: <pkg>: set this to true
or false` line. Also any time `pnpm approve-builds` is suggested — the
interactive TUI is fine for an actual human, but it does not work
through piped stdin (the readline prompt rejects the buffered input),
so don't try to script around it. Edit the yaml directly.

**How to apply.**
- Open `web/pnpm-workspace.yaml`.
- For each `<pkg>: set this to true or false` line under `allowBuilds:`,
  replace the right-hand side with `true` (or `false` if you genuinely
  want to keep the script blocked).
- Re-run `pnpm install` — the install should now complete cleanly and
  the affected package's post-install script (e.g., esbuild downloading
  its platform binary) should run.
- Commit the yaml as part of the same change that introduced the new
  dependency.

**Source incident (2026-05-17, LT-4 mid-flight resume).** Resuming
LT-4 from a fresh worktree, `pnpm install` succeeded but
`pnpm --filter @particle-editor/editor build` failed with the
`ERR_PNPM_IGNORED_BUILDS` error — the install itself bailed before
running the build script. The prior session's handoff text suggested
"strip the malformed `allowBuilds:` block before committing," which
worked transiently but pnpm re-injected the block on the next install
(making subsequent installs fail again). The durable fix is to set the
per-package value to `true`; pnpm then leaves the field alone. The
sharpened rule supersedes the strip-it guidance in the prior handoff's
"Pattern-level things worth knowing" section.

---

## L-006 — Don't clear React optimistic state on every host-data refresh

**Rule.** When a React component holds an optimistic local override
that bridges a host-async-mutation gap (e.g. "the just-inserted
key's Time/Value while the bridge round-trip lands"), clear it only
on **explicit user actions that change the selection / target**, not
on every arrival of fresh host data. The naive
`useEffect([hostProp]) → clearOverride()` pattern produces a "flash
correct → revert to stale zero" symptom whenever the host data
doesn't perfectly match the override (float-precision in
serialization, event ordering between bridge response and
state-changed events, dedupe bumps, etc.). Sticky overrides cleared
only on user-action are both more robust AND more predictable for
the user.

**Trigger.** Any time a React component has the shape:
```ts
const [optimistic, setOptimistic] = useState(...);
useEffect(() => setOptimistic(null), [hostProp]);
```
where `hostProp` arrives async from the host after a mutation.

**How to apply.**
- The override should be **replaced** in each mutation handler (drag-
  end / insert / spinner-edit) with the newly-committed values.
- The override should be **cleared** in selection-change handlers
  (click another row/key, click empty area in select mode, marquee,
  switch tab/track, delete the targeted item).
- Never blanket-clear on `hostProp` change — the host data is a
  belt-and-suspenders backstop, not the override authority.

**Source incident (2026-05-19, FD10 Group D polish).** The
TrackEditor's Time/Value spinners showed 0/disabled after an Insert-
mode key insertion. First fix added `optimisticSelected` with
`useEffect([tracks]) → setOptimisticSelected(null)`. User reported:
"flashes correct then greys out as soon as I release the mouse
button." Two interacting causes: (a) the CurveEditor SVG's onClick
fired when the synthetic click event's target became the LCA of
backdrop-down and circle-up (the new key circle had appeared
mid-click), clearing selection — fixed with `if (insertMode)
return;` on the SVG's onClick; (b) even without that, the optimistic
clear on `tracks` change left a window where the spinners read from
`current.keys.find()` which sometimes returned undefined due to the
host's dedupe-bump float-precision corner. The durable fix was
making the override sticky — clear only in `handleKeyClick`,
`handleCanvasClick`, `handleCanvasMarqueeSelect`, `handleDelete`,
`handleTrackChange`. Same pattern already in use elsewhere in this
codebase (FD9b LayoutBroker re-emits occlusions in popup-client
coords on popup move, not on every React rect update). Filed as a
recurring shape because it's the third time the React⇄host async-
mutation gap has bitten us in subtly different surfaces.

---

## L-007 — Don't paper over an engine bug by changing what a test asserts

**Rule.** When a Playwright contract test fails and the natural fix is
to rewrite the test (loosen the assertion, switch from UI click to
programmatic dispatch, shorten the wait), first **prove the engine
contract still holds** with the rewritten assertion in the same
failure scenario. If the rewrite *also* fails, the engine has a real
state-corruption bug — file it as a parking-lot item and mark the
test `test.fixme` rather than silently masking the regression.

**Trigger.** A test fails. You hypothesise the failure is in the test
harness (timing, click delivery, event ordering) and propose a
narrower assertion. Before swapping it in, confirm the narrower
assertion *passes* in the exact failure scenario — not just in
isolation.

**Why.** "The bigger test failed, the smaller test passes" can mean
either (a) the bigger test was too brittle and the smaller one
correctly narrows the contract, OR (b) both tests would fail but you
only checked the smaller one against a clean baseline. Without the
side-by-side check, (b) ships as a silent regression: the suite goes
green, the engine bug stays in place, and the next person who
exercises that code path eats the broken behaviour with no test
catching it.

**Source incident (2026-05-20, `tools.spec.ts:192` diagnosis).** The
spec "Clicking a bundled ground slot in the popover updates
groundTexture" started failing after Phase 2.4 in the full suite
(but passed in isolation, or with most spec subsets). Bisected the
cross-spec pollution down to the pair `background-picker.spec.ts`
(opens Background popover at :41 without dismissing; sets skydome
slot/path/background colour) × `spawner-import-mod.spec.ts` (toggles
the new Spawner permanent column via Zustand+localStorage, opens
several modals). With just one of those two specs preceding tools,
:192 passes; with both, it fails.

Initial diagnostic narrative — *wrong* — was: "the click on the
portal'd slot button isn't dispatching through React because Radix
Portal + React event-delegation interact badly after the polluter
pair." The instrumentation supported it superficially: capture- and
bubble-phase document listeners both fired with `defaultPrevented:
false`, but a listener attached to `#root` (the React root container)
never fired; the button's React fiber and `onClick` props were
present (`hasOnClick:true`, `disabled:false`); calling
`props.onClick({})` directly ran without error but didn't produce
any `engine/set/ground-texture` request through our wrapped
`window.bridge.request`. Easy to conclude "React's portal delivery
is broken, ship a programmatic dispatch."

The fatal step was *not* re-running the programmatic dispatch
through the same polluter scenario before declaring the fix. When
that check was finally done (the rewritten `:192` calls
`window.bridge.request({ kind: 'engine/set/ground-texture',
params: { slot: 1 } })` directly), it *also* failed: `setResult: {}`
came back ok, but `groundTexture` stayed at 0. Iterating across
slots 1/2/3/0 confirmed every set is ignored. `engine/query/ground-
slot-empty` returned `false` for every bundled slot;
`groundSlotCustomPaths` were all empty; `engine/action/reload-
textures` didn't reset the state. The engine is genuinely refusing
to mutate `m_groundTextureIndex` in this scenario.

That moves the bug from "React/portal" to "C++ engine state after
specific bridge sequences" — almost certainly inside
[ReloadGroundTexture](src/engine.cpp:1044)'s fallback chain
(D3DXCreateTextureFromFileInMemory failing for RCDATA-bundled
textures after enough prior calls, falling back to slot 0). The
React diagnostic chain wasn't wrong about what it observed — the
single `engine/state/changed` event with `groundTexture: 0` we saw
post-click is exactly the trace of `SetGroundTexture(1) →
ReloadGroundTexture() failing → fallback to slot 0 →
EmitEngineStateChanged()`. The mistake was concluding the React
side was the *cause* rather than another *symptom*.

**The actual engine bug** (root-caused and fixed in the same dispatch,
once the right C++ diagnostic was in place). The clincher was a
canary handler — `engine/debug/d3dx-canary` — that the JS reproducer
called between each step of the polluter sequence, measuring
`TestCooperativeLevel`, a procedural `CreateTexture`, and a D3DX
texture create. The trace pinpointed the failure to a single step:
the *first* Spawner toolbar toggle click. After that click, all
three canary calls returned non-zero (`TCL=0x88760869
D3DERR_DEVICENOTRESET`, `Proc=0x8876086C D3DERR_INVALIDCALL`,
`D3DX=0x8876086A D3DERR_NOTAVAILABLE`).

The chain: Spawner toggle → React workspace grid resizes →
`layout/viewport-rect` bridge call → `LayoutBroker::Apply` calls
`m_engine->Reset()` → `IDirect3DDevice9::Reset` returns
**`D3DERR_INVALIDCALL`** because **`m_pSkydomeEffect` still held
`D3DPOOL_DEFAULT` references** from the prior `SetSkydomeSlot(5)` /
render binding. `Engine::Reset` did the `OnLostDevice` /
`OnResetDevice` dance for the regular shaders, the distort shader,
and the bloom effect — but the skydome effect (added later in the
MT-3 work) was forgotten when that pattern was established.
`LayoutBroker::Apply`'s `catch (...) { /* swallow */ }` then
discarded the throw, leaving the device in `D3DERR_DEVICENOTRESET`.
Interactive use never noticed because `Engine::Render`'s next-frame
recovery (`TestCooperativeLevel == D3DERR_DEVICENOTRESET → Reset()`)
catches up; in `--test-host` mode the viewport HWND is hidden, no
`WM_PAINT`, no `Render()` tick, no recovery.

The **fix is one pair of calls in `Engine::Reset`** matching the
existing pattern:

```cpp
if (m_pSkydomeEffect != NULL) m_pSkydomeEffect->OnLostDevice();
// ...m_pDevice->Reset(...)...
if (m_pSkydomeEffect != NULL) m_pSkydomeEffect->OnResetDevice();
```

Belt-and-suspenders companion change: introduce
`Engine::RecoverDeviceIfNeeded()` (mirrors the render-loop guard,
callable from any thread / non-render context) and have
`LayoutBroker::Apply`'s catch handler call it as a recovery
fallback so any *future* missing-OnLost regression heals
automatically instead of latching.

**Procedural rule that would have caught the wrong-cause early.**
When a "narrow rewrite" is proposed in response to a failing
assertion, *verify the narrow version under the same failing
conditions* before spending diagnostic time on the assumed cause. A
30-second programmatic-dispatch check at the top of investigation
would have re-pointed the entire diagnosis from React-portal-events
to C++-engine-state. Adopt as a pre-flight step alongside L-004's
"pnpm build is the truth gate": **rewritten assertions are truth-
gate candidates too; verify them in-situ before relying on them.**

**Pattern worth keeping for future D3D9 device-state debugging.**
The canary handler shape — one bridge endpoint that probes
`TestCooperativeLevel` + a synthetic `CreateTexture` + a
representative D3DX call — turns the "the engine seems wrong, when
and why?" question into a step-by-step bisect. Combined with an
`OutputDebugStringA` + logfile helper (the `--test-host` harness
suppresses host-process stdout), the round trip from "test fails"
to "HRESULT identified" was under 30 minutes. Both pieces (the
canary handler in `BridgeDispatcher.cpp` and the `gtdbg.log` helper
in `engine.cpp`) were removed once the bug was fixed, but the
*shape* is reusable — anyone debugging a similar D3D9 latch should
re-add them.
