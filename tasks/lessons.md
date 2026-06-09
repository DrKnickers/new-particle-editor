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

---

## L-008 — React 18 attaches `wheel` listeners as passive at the root; use a native `addEventListener` with `{ passive: false }` when you need `preventDefault()` to actually work

**Rule.** When a component needs to call `e.preventDefault()` on a
`wheel` event (typically to stop the page/parent pane from scrolling
while the user interacts with a numerical scrub control, custom
zoom region, etc.), attach the listener *natively* on the target
element via `useEffect` + `addEventListener("wheel", handler, {
passive: false })`. Do **not** use React's `onWheel={handler}` —
React 18+ attaches its delegated wheel listener at the root
container as PASSIVE, which makes `preventDefault()` a no-op
silently.

**Trigger.** Any component where wheel-over-this-element should
adjust a value (or zoom / pan etc.) without scrolling the parent
pane. The natural-feeling `onWheel={...}` JSX prop *looks* like the
right shape, the handler *fires*, but `preventDefault()` is silently
ignored and the browser scrolls anyway.

**Why this is sneaky:**
- Vitest with jsdom does *not* enforce React's passive defaults, so
  any spec exercising `<element fireEvent.wheel(...)>` passes even
  though the production runtime is broken.
- Adjacent React events (`onMouseDown`, `onKeyDown`, etc.) work
  normally with `preventDefault`. There's no warning when `onWheel`
  preventDefault is ignored.
- The symptom is *both* the intended behaviour (value adjustment,
  whatever the handler did) *and* the unwanted scroll happening
  simultaneously. Easy to miss in casual testing if your scrollable
  parent doesn't have content overflowing, OR if you reach the
  scroll endpoint before noticing anything moved.

**How to apply.** Pattern (also handles the stale-closure issue with
the typical "useEffect with deps":

```tsx
const wrapRef = useRef<HTMLDivElement>(null);
// Stash all the "current values" the handler needs in a ref so
// it can read fresh state without re-binding the listener.
const depsRef = useRef({ value, min, max, step, onChange });
depsRef.current = { value, min, max, step, onChange };
useEffect(() => {
  const el = wrapRef.current;
  if (!el) return;
  const onWheel = (e: WheelEvent) => {
    const d = depsRef.current;
    e.preventDefault();
    e.stopPropagation();  // also keep the event from bubbling to the
                          //   parent's React-level wheel handlers.
    // ... do the work using d.value, d.onChange etc.
  };
  el.addEventListener("wheel", onWheel, { passive: false });
  return () => el.removeEventListener("wheel", onWheel);
}, []);  // empty deps — the ref keeps the handler current.

return <div ref={wrapRef}>...</div>;
```

Also: **attach to the outermost wrapper of the component**, not just
the input element inside. Otherwise the wheel only fires when the
cursor is on the input area, and the wheel doesn't work when the
cursor is over related affordances (like up/down arrow buttons
beside the input). The `wrapRef` should be on whatever the user
visually thinks of as "the spinner widget."

**Source incident (2026-05-20, Spinner wheel bug).** The Spinner
component initially used `onWheel={handleWheel}` with
`e.preventDefault()`. Looked right, passed vitest, failed in
WebView2 — the wheel adjusted the value AND scrolled the parent
pane simultaneously. Diagnosed by re-reading React's event-delegation
docs (the wheel/touchstart/touchmove passive default was introduced
in React 17 for scroll-performance reasons). Fix: native
`addEventListener` with `{ passive: false }`. Follow-up: the wheel
listener was initially on the input; moved to the wrapper so the
wheel works over the spinner's up/down arrow column too.

**Procedural note.** If you see anywhere else in this codebase that
uses `onWheel={...}` AND calls `preventDefault`, audit it for the
same bug. The pattern is general — any wheel-based zoom/scrub/pan
component is suspect.

---

## L-009 — Never use raw floats as identity keys across the JS/C++ boundary; pre-round at the source with `Math.fround`

**Rule.** Any value that crosses JS (64-bit `double`) ↔ C++ (32-bit
`float`) gets quantized on the C++ side. JS-side bookkeeping that
keys off the value (Map/Set/`===` comparisons against round-tripped
values) **will silently break** because the round-trip
value differs from the original by ~1 ULP-of-float32 (≈ 1e-6 for
values near 50). The two values *print identically* in DevTools —
you'll only notice the drift by expanding the numbers or by the
downstream "lookup failed" symptom.

**How to apply.**

1. **Don't use floats as identity keys** if you can avoid it. Stable
   integer IDs are much safer (and the design-of-record long-term
   move).
2. **When you must use floats as identity keys**, pre-quantize at
   the source. In JS, `Math.fround(x)` rounds a double to the
   nearest `float`-representable double — i.e. it pre-applies the
   same rounding C++ will do. Store the rounded value in JS state
   so when C++ returns the same value, `===` matches.
3. **Audit every JS Set/Map/object key that holds a value the host
   produced or will round.** Track times, vertex IDs, anything
   where the JS side originates a value and expects it back from
   the bridge.

**Trigger.** Any of:
- "I set the state correctly but the rendered UI doesn't reflect
  it after a round-trip" → suspect precision drift first; instrument
  `[STATE] selectedKeys: [...]` against `[STATE] tracksKeys: [...]`
  and diff the floats with full precision.
- A Set/Map keyed by a `number` that originated from a user gesture
  (drag, marquee, click coordinate) and will be sent to the
  engine and read back.
- New bridge surfaces that round-trip float values, especially
  positions/times/coordinates.

**Source incident (2026-05-20, curve-editor drag selection bug).**
The user reported: drag a curve key without pre-selecting it; the
spinner showed live values during drag (proving the key was
selected); on pointer release the key reverted to its
channel-colour fill (no selected ring). Spent **three rounds** of
patches reasoning from the UI-event layer (suspected the trailing
synthetic click hitting a deselect handler, then suspected the
hit-pad's onClick firing with stale closure, then suspected
React batching). All three patches were correct in their
mechanism but didn't fix the bug. Pivoted to instrumentation
(per [L-007](#l-007--dont-paper-over-an-engine-bug-by-changing-what-a-test-asserts)
— verify in-situ, don't keep guessing). Logged `STATE` on every
panel state change and got:

```
STATE { selectedKeyTimes: [49.476439790575924], focusedTrackKeys: [..., 49.4764..., ...] }
refetch tracks { id: 0, sampleKeys: Array(3) }      ← async tree/changed fired
STATE { selectedKeyTimes: [49.476439790575924], focusedTrackKeys: [..., 49.4764..., ...] }
```

The two times printed identically but were not `===`. The first
was the JS double the renderer computed via `unproject(...)`; the
second was the engine's `float32` storage, returned through the
bridge. The renderer's `selectedKeyTimes.has(p.time)` predicate
failed silently, painting the key unselected. Fix at
[CurveEditorPanel.tsx:570](web/apps/editor/src/components/CurveEditorPanel.tsx:570):
`const engineNewTime = Math.fround(newTime);` and use that value
for `selectedKeyTimes` / optimistic spinner / optimistic tracks
patch. After: round-trip is a no-op because the value we stored
IS the value the engine returns.

**Anti-pattern that hid it.** Each of my failed patches was a
"plausible UI-layer fix" — the symptom (deselection) looked like a
UI-layer bug, so I kept looking at UI handlers. The root cause was
a representation drift two layers down. Trust the instrumentation
over the symptom theory. Add `[STATE]` logs when you're on the
third hypothesis without progress; the actual state values
falsify the theory you've been chasing in one screenshot.

**Where else this could bite.** Audit (as of 2026-05-20):
- `selectedKeyTimes` Set keyed by float times — fixed in
  `handleKeyDragEnd`; `handleKeyClick` reads from `p.time`
  (already float32-precision via the bridge), so it's safe.
- `handleCanvasAdd` uses `res.time ?? time` — `res.time` from the
  bridge is float32-precision; the fallback `time` is the
  unproject'd JS double. If the bridge ever drops `res.time` from
  its response, the fallback path will exhibit the same bug.
  Consider `Math.fround(time)` there as defence-in-depth.
- `handleTimeSpinner` sets `selectedKeyTimes(new Set([clampedTime]))`
  where `clampedTime` is a JS-double user input. Same drift
  potential on the next refetch. Apply `Math.fround` if a similar
  bug surfaces there.

---

## L-010 — Inspector field labels are public API; sweep BOTH vitest and Playwright on every rename

**Rule.** When renaming any inspector field label (or any
user-facing label that DOM queries might key off), the rename
sweep must include BOTH the vitest spec corpus under
`web/apps/editor/src/**/__tests__/` AND the Playwright native
suite under `web/apps/editor/tests/`. The two run via different
harnesses (Vitest+jsdom vs Playwright-CDP-into-`ParticleEditor.exe`)
and their failures look different — vitest fails locally on
`pnpm test`, Playwright fails on `pnpm test:native` only — but
both harnesses can hard-code field labels as DOM selectors via
`getByLabel(...)` / `getByLabelText(...)`.

**Trigger.** Any dispatch that renames an inspector field label
(or any aria-label exposed to assistive tech). Examples:
"Lifetime" -> "Maximum lifetime:", "Gravity" -> "Gravity
acceleration:", "World Oriented" -> "Always face camera".

**Why this is sneaky.** A dispatch spec that says "the Playwright
suite asserts at structural / selection level, no label updates
needed" sounds true and IS true for most Playwright specs in this
project — they navigate by tab name, click coordinates, or
data-testid attributes. But a handful of specs reach inside the
inspector with `getByLabel(...)` (because that's the most stable
way to find a specific spinner among many). Those specs are the
exception and they're easy to miss in a scope-check that only
samples the suite at the navigation level.

**How to apply.**
- **Before renaming, grep both directories** for every old label
  string:
  ```bash
  cd web/apps/editor
  grep -rn "getByLabel.*\"<old-label>\"" src tests
  grep -rn "getByLabelText.*\"<old-label>\"" src tests
  ```
- **Update both corpora in the same commit (or two commits in
  the same dispatch)** so neither half goes red on its own.
- **Run both gates after the rename**: `pnpm test` (vitest) and
  `pnpm test:native` (Playwright). The vitest red is loud; the
  Playwright red is sneaky because the suite only runs against
  the bundled `dist/` and needs the native host launched.
- **If a dispatch spec says "Playwright untouched"**, treat that
  as a hypothesis to verify with grep, not a fact. The cost of
  the grep is 30 seconds; the cost of catching it at P7 instead
  of P3 is a re-run of the verification phases.

**Source incident (2026-05-21, B1.3 P7).** The B1.3 spec's §5
and §8 both stated "Playwright native tests untouched" because
the suite "asserts at structural / selection level". P3 renamed
"Lifetime:" to "Maximum lifetime:" and P6 renamed "Gravity:" to
"Gravity acceleration:". Both renames passed vitest cleanly. P7
then ran `pnpm test:native` for the first time post-rename and
got two failures in `tests/property-tabs.spec.ts` — both specs
were using `getByLabel("Lifetime")` and `getByLabel("Gravity")`
to find specific spinners within the inspector for value-set
assertions. Fixed in the same P7 commit (`49544d6`) by updating
both label strings to the new text. Cost: one extra round-trip
through the verification gate. Cheap, but a 30-second grep at
the dispatch-prep stage would have caught it before P3 / P6 ever
landed.

## L-011 — HTML CSS effects (backdrop-filter, large box-shadow, translucent bg) cannot reach the engine compositing layer; design chrome that overlaps the engine viewport to be opaque, or capture engine pixels into the WebView2 DOM

**The rule.** In `--new-ui` mode the engine viewport is a `WS_POPUP`
layered Win32 window composited *above* WebView2 by the desktop
window manager. HTML elements that visually overlap the engine
viewport area cannot sample engine pixels via CSS:

- `backdrop-filter: blur(...)` on a panel above the engine will blur
  whatever WebView2 has BEHIND the panel — which is usually nothing
  useful (the viewport quadrant in WebView2 is empty), producing a
  near-solid dark smudge instead of the frosted-glass effect.
- `box-shadow` that extends past the alpha-cut occlusion pad will be
  hidden by the popup's opaque pixels, producing a hard halo edge
  where the shadow gets clipped.
- Semi-transparent backgrounds (`rgba(...,0.85)` etc.) need backdrop
  content to look right; they look solid-dark over the engine area.

**The trigger.** Surfaced multiple times in the B1.3.1 polish rounds
when various chrome surfaces overlapped the engine viewport. Most
visibly: `.vp-tools` (the ViewportPill) had `backdrop-filter: blur(8px)`
+ `rgba(20,24,33,0.85)` — looked great over panels but rendered as
a near-solid dark smudge over the engine because WebView2 had nothing
useful behind it. Same root cause: Modal's `shadow-2xl` drew a
visible halo where the popup hid the outer shadow extent.

**Two valid patterns:**

1. **Opaque-chrome design.** For surfaces that overlap the engine
   viewport, use solid backgrounds (`var(--panel)` etc.) and small
   shadows (≤ `shadow-md`'s ~8 px extent). The chrome looks
   consistent regardless of what's behind it because nothing
   behind it ever shows through. ViewportPill + Modal adopt this
   in polish round 7. Regression-guard vitest tests assert the
   CSS doesn't contain `rgba(...,0.N)`, `backdrop-filter`, or
   `shadow-(xl|2xl)`.
2. **Snapshot-into-DOM.** For surfaces that genuinely need the
   underlying engine content (a frosted-glass modal backdrop is the
   canonical example), capture the engine viewport to a PNG via the
   `viewport/capture-snapshot` bridge surface, render it as an
   `<img>` portaled into the viewport-quadrant DOM, full-occlude the
   engine popup. CSS effects on top then sample the snapshot
   uniformly with the panels. Architecturally cleaner; cost is
   one capture per modal-open + per resize tick.

**Anti-pattern that doesn't work:** server-side dim+blur of the
engine pixels via an AlphaCompositor pipeline (separable box-blur +
per-pixel alpha multiply + popup-edge feather). The dim/blur work,
but the popup HWND's rectangular outer edge is structurally
unfeatherable — any attempt to fade the popup's outer alpha reveals
Dialog.Overlay's `bg-black/60` which is darker than the dim engine,
producing a luminance valley that reads as an inner-shadow halo.
Pixel math: center luminance ≈ 60 (engine * 0.4 + panel * 0.24);
mid-fade ≈ 35 (where dst dominates); edge ≈ 10 (panel * 0.4). A
smooth visual transition would have endpoints at the same luminance;
this one doesn't and can't (algebraically) be tuned to match unless
engine_color ≈ panel * 0.4 which isn't true for realistic content.

The B1.3.1 modal-mask compositor pipeline that produced this
artifact lives at commit `52bb032` and is removed in B1.3.1.1
Phase 3. Don't re-implement it.

## L-012 — `window.bridge` may be `TestHostBridge` in non-`--test-host` runs; use `BridgeContext` for deep consumers that need the real `NativeBridge`

**The rule.** `exposeBridgeForTests(bridge)` at
[`src/bridge/expose.ts`](../web/apps/editor/src/bridge/expose.ts) sets
`window.bridge` to a `TestHostBridge` whenever
`chrome.webview.hostObjects.hostBridge` is truthy. WebView2 returns
a Proxy for the `hostObjects.hostBridge` property access even when
no host object is registered, so `if (hostObj)` is truthy in
production runs too — and TestHostBridge then calls `dispatchRequest`
on an unregistered host object, which rejects with HRESULT
0x80070490 ("Element not found").

Components that get the bridge from React props (or context, since
B1.3.1) hold the actual `NativeBridge` reference from App.tsx's
`useMemo` closure — that works. Components that reach for
`window.bridge` get the broken TestHostBridge.

**The trigger.** Modal needed bridge access for its
`useViewportOcclusion` call; using `window.bridge` was tempting to
avoid prop-drilling through 9 modal callers. The
`viewport/occlude` request rejected with 0x80070490 while other
identical requests from menus / pills / panels (which got bridge
via prop) succeeded — the inconsistency was the diagnostic clue
that pinned the root cause.

**The fix.** New [`lib/bridge-context.ts`](../web/apps/editor/src/lib/bridge-context.ts)
exposes the live `NativeBridge` via React Context. App.tsx wraps
the tree in `BridgeContext.Provider`. Modal uses `useBridge()` to
get the same instance the rest of the tree has. Tests that mount
Modal in isolation (no Provider) get `null` — `useViewportOcclusion`
early-returns on a null bridge, so the test assertion path is
unaffected.

**Could fix `exposeBridgeForTests` instead.** Yes — detect
host-object availability via an actual probe call wrapped in
try/catch, fall back to NativeBridge on rejection. But that's an
invasive change to a load-bearing utility, and BridgeContext is
the React-idiomatic carrier for this kind of dependency. Worth
revisiting if other consumers hit the same trap.

## L-013 — The Win32 drag-resize modal sizing loop starves WebView2 IPC; design host-durable state for anything that must survive a drag

**The rule.** Any state the engine viewport popup depends on while a
modal is open — alpha cuts, occlusion rects, dim/blur params — must
be encoded so it survives the Win32 modal sizing loop without
needing a fresh renderer→host bridge message during the drag.
When the user holds the mouse on a resize edge, Windows runs a
separate WM_SIZING / WM_SIZE dispatch loop on the host thread.
That loop calls [`LayoutBroker::PredictAndApply`](../src/host/LayoutBroker.cpp)
synchronously to resize the popup + re-emit cached occlusion rects
to the new popup-client coords, but does NOT pump WebView2 IPC
messages — so any [`bridge.request(...)`](../web/apps/editor/src/bridge/native.ts)
the renderer dispatches in response to ResizeObserver firing sits
in the queue until release. The popup is "ahead" of the renderer's
view of the world for the duration of the drag.

**The trigger.** Any renderer-side resize handler that updates
host state with geometry dependent on the current window size.
Modal occlude rects are the canonical case. Any future "follow
the popup during resize" surface (HUD overlays, picture-in-picture
secondary viewports, scoped per-region effects) will hit the same
trap.

**Two valid patterns for resize-resilience:**

1. **Host-state-durable encoding.** Send ONE message at open time
   that encodes the user intent durably enough to survive any
   popup geometry. The modal occlude uses a deliberately-enormous
   sentinel rect `(-100000, -100000, 200000, 200000)` — `ApplyOcclusion`
   clips iteration to the DIB bounds, so the rect ALWAYS covers
   the entire current popup regardless of resize timing.
   `ReemitOcclusions`' main-client → popup-client translation
   produces another huge rect that still clips to the full new
   popup. Resize-resilient by construction.

2. **One-shot capture, no re-capture.** Don't re-fetch state from
   the host during the modal lifecycle. The snapshot img sits at
   `position:absolute; inset:0` inside the viewport-quadrant DOM,
   so CSS scales it automatically when the parent grows during
   drag. Content goes mildly stale (engine keeps rendering, we
   don't re-encode), but it's behind Dialog.Overlay's
   `bg-black/60 backdrop-blur-sm` — particle motion blurs to mush
   at that treatment, so staleness is invisible.

**Anti-patterns:**

- `window.addEventListener("resize", ...)` to drive re-emit. The
  event may not fire at all during the Win32 drag-resize modal
  loop (Chrome/WebView2 reliability varies by build); even if it
  does, the message can't reach the host.
- `ResizeObserver` on the quadrant element to drive re-emit.
  Fires reliably on the renderer side (the DOM box updates every
  frame during drag) but the dispatched bridge message still
  can't land at the host. The signal is fine; the channel isn't.
- rAF-throttled re-capture during drag. Even when bridge messages
  DO get through (intermittent during the loop), each capture
  costs ~10-30 ms of GDI+ PNG encode stacked on top of the
  engine's per-WM_SIZE D3D9 device `Reset` (already expensive).
  Visible stutter results.

**Source incident (2026-05-21, B1.3.1.1 P5 smoke-tests).** The
B1.3.1.1 Modal rewiring originally used the actual quadrant
`getBoundingClientRect()` as the occlude rect and re-captured via
rAF on every resize event. First smoke-test surfaced opaque
engine pixels leaking outside the modal occlude during drag (the
popup at the new size, occlude rect at the old smaller value).
Attempted fix swapping `window.resize` for `ResizeObserver` made
no difference — confirmed the issue wasn't the renderer-side
signal but the IPC starvation. Second iteration switched to the
sentinel rect + one-shot capture. Drag-resize now leaves the
modal backdrop visually correct AND no longer stutters. Full
algebraic + diagnostic trail in B1.3.1.1's CHANGELOG entry. The
mental shift from "fix the trigger" to "encode the state
durably" was the key insight worth preserving.

**Cross-reference.** L-011 explains why CSS effects can't span
the engine compositing layer (the underlying reason a snapshot-
into-DOM approach is necessary at all); L-012 explains why
`window.bridge` may be `TestHostBridge` in non-`--test-host`
runs (also relevant when the modal needs bridge access). L-013
is specifically about resize-time IPC starvation on the same
modal path.

---

## L-014 — `react-resizable-panels` 4.x: numeric size props are PIXELS, not percentages; `Panel.defaultSize` is the canonical knob, not `Group.defaultLayout`

**Rule.** When wiring `react-resizable-panels` 4.x:

1. **Size props (`defaultSize`, `minSize`, `maxSize`) — numeric is pixels.**
   `defaultSize={20}` means **20 pixels**, not 20 percent. For
   percentages either write the string with a `%` suffix
   (`defaultSize="20%"`) or without any unit (`defaultSize="20"`).
   The docstring at
   `node_modules/.pnpm/react-resizable-panels@*/.../dist/react-resizable-panels.d.ts:200-212`
   is explicit: *"Numeric values are assumed to be pixels.
   Strings without explicit units are assumed to be percentages."*
2. **`Group.defaultLayout` is effectively an SSR hint, not the
   client-mount source of truth.** On a nested flex layout where
   the Group's parent has `groupSize === 0` at first paint, the
   library sets `defaultLayoutDeferred: true` and, on the first
   ResizeObserver tick once the group acquires real size, calls
   `We(panels)` — which reads each Panel's `defaultSize` and
   IGNORES `Group.defaultLayout`. So the per-Panel `defaultSize`
   prop is the only knob that reliably works for client-mounted
   layouts. Belt-and-suspenders is fine (pass both) but treat
   `defaultLayout` as advisory.
3. **`onLayoutChanged` writes the current layout back to your
   persistence store after pointer release.** If you write that
   back, then read it on next mount, you'll restore the user's
   ratios — but only if step 1 + step 2 are correct, otherwise
   the first paint will write the *wrong* (library-computed)
   layout over your defaults and you'll be stuck.
4. **Reset path.** When recovering from a corrupted /
   library-computed-wrong persisted layout, clear the
   `localStorage` key AND reload — the lazy reader (`useMemo`
   with `[key]`) only re-reads on key change or remount.

**Trigger.** Any new `react-resizable-panels@4+` integration where
the rendered layout doesn't match what you passed to
`Group.defaultLayout`, especially when nested inside a flex
container that's `display:flex; min-height: 0` and small enough
that the inner Group could be sized 0 at first React commit.
Symptom: panel widths collapse to look like their content's
intrinsic width (small) or to equal shares of leftover space,
ignoring your stated percentages. Library-internal flex-grow on
`[data-panel]` shows weird numbers (e.g. `flex: 3.145 1 0px`)
that are *derived from rendered widths*, not from your
`defaultLayout`.

**Source incident (2026-05-21, B1.4 T4 manual smoke).** The
B1.4 PanelLayout dispatch wired the outer horizontal Group with
`Group.defaultLayout={left: 20, center: 60, spawner: 20}` and
no per-Panel `defaultSize`. First dev-server smoke showed left
and spawner each 40 px wide while centre took 1192 px (flex:
3.145/93.71/3.145). Reading the bundled library source
(`dist/react-resizable-panels.js:1432-1454` for the RO callback,
`:1319-1336` for `We`, `:200-212` for the docstring) revealed
both quirks above. Fix:

- All sizing props pass through `${value}%` template strings.
- Per-Panel `defaultSize` derived from the loaded layout,
  matching `Group.defaultLayout` for redundancy.
- localStorage `alo:layout:*` keys cleared once to discard the
  library-computed-wrong values that persistence had captured.

After the fix, defaults render at `flex: 20 1 0px` / `60 1 0px` /
`20 1 0px` exactly. Drag persists. Reload restores. Spawner
toggle round-trips between 2col and 3col layouts.

**Cross-reference.** None — first integration of this library in
the project. CHANGELOG entry for B1.4 cites this lesson; future
splitter-related dispatches should grep for L-014.

---

## L-015 — `SetVirtualHostNameToFolderMapping` short-circuits `WebResourceRequested`; pick a different URL or use postMessage payload

**Rule.** A WebView2 `WebResourceRequested` handler registered with
`AddWebResourceRequestedFilter(...)` will **not fire for requests
whose URL host matches a `SetVirtualHostNameToFolderMapping`
mapping**, regardless of how broad the filter pattern is. The
mapped-folder resolver runs first inside the WebView2 process and
returns `ERR_FILE_NOT_FOUND` (or the file) without ever giving
user-registered handlers a shot.

**Trigger.** Designing a host→renderer resource-delivery path that
overlaps the virtual-host URL space. Symptoms: filter registration
returns `S_OK`, `add_WebResourceRequested` returns `S_OK` with a
real token, but the handler never invokes — not for the target
URL, not even for the initial `index.html`. Browser DevTools shows
`net::ERR_FILE_NOT_FOUND` for the unmapped path.

**Source incident (2026-05-21).** While building the [MT-11]
Phase 0 spike, wired a `WebResourceRequested` handler to serve
encoded engine frames at `https://app.local/_viewport/frame.jpg`.
The renderer `fetch()`'d that URL on every `viewport/frame-ready`
event. Errors flooded DevTools: 404 for every fetch despite the
handler being registered with filter `*` and
`COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL`. Logged
`add_WebResourceRequested` HRESULT (S_OK, token = 20) and added a
diagnostic `Log()` at the top of the handler that proved the
handler never fired for ANY URL, not even `index.html`. Disabling
`--test-host` didn't help (so not a CDP issue).

**Fix used.** Switched to inline base64-encoded JPEG in the
`viewport/frame-ready` `postMessage` payload itself. No
`WebResourceRequested`, no fetch, no virtual-host conflict. Cost:
~33 % size inflation from base64 (58 KB JPEG → 77 KB on the wire).
Spike still cleared the 30 FPS bar with room to spare (~120 FPS at
699×495 on a fully-loaded scene).

**Alternative fixes (not used, kept for reference).**

1. **Different host name.** Use a URL with a host NOT covered by
   `SetVirtualHostNameToFolderMapping` (e.g. `https://wv2-frames/`
   or any non-mapped scheme). Requests to non-mapped hosts do flow
   through `WebResourceRequested`.
2. **Drop the virtual host mapping entirely.** Serve the React
   bundle via `WebResourceRequested` too. Larger refactor; only
   worth it if there are multiple host→renderer resource paths.
3. **Pre-Navigate registration.** Confirmed not the issue — the
   handler was registered before `Navigate` was called in the
   failing case.

**Cross-reference.** [MT-11] Phase 0 spike — see
`tasks/todo.md` §6. The dead `if (false && ...)` block at
`src/host/HostWindow.cpp` (post-`add_WebMessageReceived`) is kept
as a record of what was tried; Phase 5 cleanup removes it.

---

## L-016 — Legacy DXSDK June 2010 shadows Win10 SDK headers when DXSDK is first in `<AdditionalIncludeDirectories>`; isolate new TUs via per-file include-path override + pImpl

**Rule.** Any new C++ source file in `ParticleEditor.vcxproj` that
needs modern Windows SDK headers — `dcomp.h`, `d2d1_1.h`, modern
`dxgi.h` / `d3d11.h`, anything that references Direct2D 1.1+ types
or `DXGI_COLOR_SPACE_TYPE` — MUST be isolated from the project-level
`AdditionalIncludeDirectories`, which puts `$(DXSDK_DIR)Include`
FIRST for the engine's `d3dx9.h` dependency. DXSDK June 2010 ships
its OWN `DXGI.h`, `D3D11.h`, `Dcommon.h`, `D2D1.h`, etc. — all
pre-Windows-8 vintage, all missing the types modern SDK headers
reference. With DXSDK searched first, `#include <dcomp.h>` (Win10
SDK only) pulls in transitive `<dcommon.h>` and `<dxgi.h>` from
DXSDK, the modern types come up undeclared, and dcomp.h itself
fails to parse.

**Two-part fix:**

1. **Per-file `<AdditionalIncludeDirectories>` REPLACEMENT** (not
   append) on the new file's `<ClCompile>` entry in the vcxproj.
   The value must NOT contain `%(AdditionalIncludeDirectories)`
   (which would inherit DXSDK). Use a Win10-SDK-only path plus
   whatever else the file genuinely needs (WebView2 SDK, `$(SolutionDir)src`):
   ```xml
   <AdditionalIncludeDirectories>C:\Program Files (x86)\Windows Kits\10\Include\10.0.26100.0\shared;C:\Program Files (x86)\Windows Kits\10\Include\10.0.26100.0\um;$(SolutionDir)packages\Microsoft.Web.WebView2.1.0.3967.48\build\native\include;$(SolutionDir)src</AdditionalIncludeDirectories>
   ```
   The full SDK version (`10.0.26100.0`) is hardcoded because the
   MSBuild `$(WindowsSDKVersion)` macro is empty when only
   `<WindowsTargetPlatformVersion>10.0</WindowsTargetPlatformVersion>`
   is set (the family, not the resolved version). When the SDK
   updates, the path needs updating too — accepted maintenance
   cost.

2. **pImpl in the new file's HEADER** so any consumers (e.g.
   HostWindow.cpp) don't transitively pull `dcomp.h` / `d3d11.h` /
   `dxgi*.h` and hit the same shadowing. The implementation file is
   the ONLY translation unit that includes the modern headers, and
   step 1 isolates it. Consumers see only the public method
   signatures and a `unique_ptr<Impl>` member.

**Trigger.** Any time `#include <dcomp.h>` produces errors like:
- `dcomp.h(...): error C2061: syntax error: identifier 'DXGI_COLOR_SPACE_TYPE'`
- `d2d1_1helper.h(...): error C2065: '_11': undeclared identifier`
- `d2d1_1helper.h(...): error C4430: missing type specifier`

These are not bugs in dcomp.h / d2d1_1helper.h. They're symptoms of
DXSDK's stale headers shadowing the Win10 SDK ones.

**Also requires:** `#define D2D_USE_C_DEFINITIONS` before
`<dcomp.h>` in the implementation file. This opts out of the d2d1
C++ helper classes (`D2D1::Matrix3x2F` etc.) whose constructors
reference struct member names that depend on Win10 SDK layout. We
don't use the C++ helpers — only the C structs like `D2D_RECT_F` —
so this is safe and surgical.

**How to apply.**

For every new src/host/ .cpp that needs modern Windows headers:
1. In the `.h`, use pImpl. Public types in the header limited to
   primitives + WebView2 forward decls + `std::unique_ptr<Impl>`.
   No `Microsoft::WRL::ComPtr<IDComposition*>` on the public
   surface.
2. In the `.cpp`, include modern headers in this order:
   `<windows.h>` → `<wrl.h>` → `<d3d11.h>` → `<dxgi1_2.h>` →
   `#define D2D_USE_C_DEFINITIONS` → `<dcomp.h>` → `"WebView2.h"`
   → `"YourClass.h"`.
3. In `src/ParticleEditor.vcxproj`, the `<ClCompile>` entry for
   the file gets a per-file `<AdditionalIncludeDirectories>` that
   REPLACES (no `%(...)` inheritance) with Win10-SDK-only paths
   plus what the file truly needs. See the Compositor.cpp entry
   for the exact pattern.

**Source incident (2026-05-22, [MT-11] Phase 3 Stage 3a).** Adding
`host::Compositor` to host modern WebView2 composition hosting
required `<dcomp.h>`. First build attempt failed with `_13
undeclared` in `d2d1_1helper.h` and `DXGI_COLOR_SPACE_TYPE`
undefined in `dcomp.h`. Diagnosed via comparing the spike (which
compiles fine standalone with the same WebView2 SDK + Win10 SDK)
against ParticleEditor (which has DXSDK first in include path).
The spike's `dxgi_spike.vcxproj` only has the WebView2 SDK in its
AdditionalIncludeDirectories; no DXSDK. Confirmed DXSDK June 2010
ships `D2D1.h`, `Dcommon.h`, `DXGI.h`, `D3D11.h` that predate
Direct2D 1.1 + DirectComposition.

Initial fix attempt was to PREPEND Win10 SDK paths via per-file
AdditionalIncludeDirectories, but `$(WindowsSDKVersion)` MSBuild
macro is empty in this project (resolves "10.0" → empty in the
project context, not "10.0.26100.0"). Final fix hardcodes the
full SDK version path, REPLACES (no inheritance from project) so
DXSDK isn't searched at all for this file, and uses pImpl in the
header to keep the same problem from biting HostWindow.cpp when it
includes Compositor.h in Stage 3b.

**Cross-reference.** [MT-11] Phase 3 Stage 3a sub-plan at
[`tasks/dxgi-stage-3-composition-hosting.md`](dxgi-stage-3-composition-hosting.md).
The Compositor class at `src/host/Compositor.{h,cpp}` is the
reference pattern for any future host/ file that needs modern
Windows headers. Updating this when SDK 1.0.4015+ ships will
require updating the hardcoded version path.

---

## L-017 — Before planning around an SDK bump, verify the target API actually exists via authoritative docs

**Rule.** When a plan rests on "API X is exposed in SDK version Y
(higher than what we have)," verify the assumption via the
vendor's authoritative API reference docs BEFORE writing the
SDK-bump plan, choosing fallback paths, or committing to a
two-track decision tree. A 30-second `WebFetch` against the
vendor's API-surface page beats hours of planning effort that
might rest on a phantom API. If the verification turns up
"actually no version exposes that API," collapse the decision
tree immediately and re-plan around the available surface.

**Trigger.** Any of:
- A plan section that says "If SDK lacks X, use fallback Y;
  if SDK has X, use approach Z" without naming a verified
  source for X's existence.
- A risk mitigation that says "we'll bump the SDK and use
  Microsoft/vendor's documented X" without a docs link
  cited inline.
- A decision deferred to "we'll find out when we grep at
  coding time" — that's a fine first cut at sub-plan time,
  but resolve it BEFORE the implementation sub-stage starts,
  not as the first action of the implementation.
- Any conversation where you're about to spend significant
  effort on "Option A vs Option B" and Option A's existence
  is asserted but not verified.

**How to apply.**

For Win32/COM-style vendor SDKs (WebView2, Direct3D, etc.):

1. The vendor's API-reference page typically lists the full
   member surface for each interface. Hit that page for the
   interface in question.
2. Many vendor doc systems support "version selector" or
   per-version URLs. Pick the LATEST documented version and
   cross-check against the current shipped version.
3. The vendor's release-notes page is a poor fit for member-
   level verification — it documents "what changed" not "what
   exists." Use the API-reference page for the latter.
4. If the API isn't on any documented version, it doesn't
   exist. Treat the plan branch that assumed it as DEAD and
   re-plan immediately.

For npm packages: prefer the registry's per-version
type-definition file or the package's CHANGELOG. Both are
authoritative for "what exists at version Y."

**Source incident (2026-05-22, [MT-11] Phase 3 Stage 3f).** The
sub-plan §3.4 + §6 + §7.1 + D4 collectively spent ~1h modelling
"path (a) — use `ICoreWebView2CompositionController::SendKeyboardInput`
on SDK 1.0.4015+" vs "path (b) — DOM keyboard via focus" as a
binary decision. The pre-coding grep against the local SDK
headers confirmed `SendKeyboardInput` wasn't in 1.0.3967.48 —
but I treated that as "not yet, would be in 4015+" rather than
verifying with the vendor's API reference. When the user said
"do path (a)" and I went to plan the SDK bump, my first move
was a 30-second `WebFetch` against
`learn.microsoft.com/.../win32/icorewebview2compositioncontroller`
which immediately revealed: the interface has 8 members across
ALL historical SDK versions (1.0.774.44 through 1.0.4015-prerelease)
and `SendKeyboardInput` is not among them. The whole "Option A"
branch was a phantom. The actual answer was simpler than either
option had modelled — `MoveFocus` on the base controller (which
exists in every SDK version) is what gives WebView2 logical
keyboard focus under composition; the DOM keyboard chain works
unchanged once focus is correct. Stage 3f shipped that as a 37-
line change.

**The meta-bug in my planning approach.** I let local-header
grep substitute for vendor-docs verification when modelling
future-SDK behaviour. Local grep proves "not in THIS version";
vendor docs prove "not in ANY version." Those are very different
claims and I conflated them. For "what's available at SDK
version Y," only the vendor's docs are authoritative. The
~30-second WebFetch is cheap; the hours of planning effort
around a phantom path are not.

**Cross-reference.** Stage 3f commit `7fe3075` includes the
MoveFocus implementation. Sub-plan §7.1 has the full SUPERSEDED
trail. Stage 3 sub-plan §7.1 was updated to reference this
lesson rather than carry the long-form story inline.

---

## L-018 — AI-generated audits need first-party file:line verification before any finding is treated as actionable; LLM severity labels are not signals

**Rule.** When an external AI (ChatGPT, Gemini, Copilot, etc.)
produces an audit, code review, or "things I noticed" report about
this codebase, treat every cited file:line and every described
subsystem as a CLAIM TO VERIFY, not a fact. Severity labels
("Critical", "High", P1, "blocking") from an LLM carry no weight
until a reproduction is attempted or the cited code has been read.
The cost asymmetry is sharp: a 5–10 minute grep-and-read pass
routinely catches fabricated file names, hallucinated subsystems,
and claims contradicted by the actual code; a sprint driven by an
unverified P1 burns hours-to-days on a phantom problem.

This applies even when the audit *looks* careful — formatted
tables, plausible C++ snippets, confident severity tiers, and
"Source: Microsoft docs say…" citations are all things LLMs
produce fluently and unreliably. Surface polish and verification
quality are independent variables.

**Trigger.** Any time an external AI audit, code review, or
analysis arrives. Especially when:
- The audit cites multiple "Critical" or "High" findings (LLMs
  systematically over-rate confidence).
- Cited filenames don't match `Glob src/**/*.cpp` results
  exactly — investigate before assuming the AI just used
  different naming.
- A finding implies subsystem-level behaviour (threading, file
  watchers, raw-pointer command records, COM interface
  lifetimes) — verify the subsystem exists at all before
  evaluating the bug claim.
- Suggested-fix code references types, classes, or call sites
  whose existence hasn't been confirmed by grep.
- The audit confidently describes architecture that contradicts
  what you know about the codebase ("the X layer mutates Y
  directly" — does that layer exist?).

**How to apply — the verification protocol.**

For every finding in an external audit, BEFORE any agree /
disagree / "we'll act on this" decision:

1. **File existence.** `Glob` for each cited filename. Zero
   matches = either the AI hallucinated the name or is looking
   at a different repo. If the pattern in the finding plausibly
   maps to a real file in this repo, restate the finding against
   the real file and only then evaluate.
2. **Subsystem existence.** Grep for the load-bearing primitives
   the finding assumes:
   - "thread race": `std::thread|CreateThread|_beginthread|std::async`.
     Zero hits = no threading, the race is fabricated.
   - "file watcher": `ReadDirectoryChangesW|FindFirstChangeNotification`.
     Zero hits = no hot-reload subsystem.
   - "raw pointers in undo commands": read the undo store. If it's
     serialization-based, the finding is fabricated.
3. **Cited code matches description.** Open the cited file:line.
   The behaviour the audit describes should match what the code
   actually does. Mismatch = AI is guessing or hallucinating.
4. **Existing mitigation.** Search `tasks/*.md`, `CHANGELOG.md`,
   `lessons.md`, and recent commits before treating a finding
   as fresh. Both audits in the source incident below treated
   already-shipped work as new findings.
5. **Severity recalibration.** LLM "Critical" routinely collapses
   to "P3 hardening item" once verified. Never let the label drive
   prioritisation on its own — reproduce or cite the verification
   first.

When delivering pushback, cite the verification evidence inline:
the file:line that contradicts the claim, the grep result that
proves the subsystem doesn't exist, the commit hash that shipped
the fix. Vague "I don't think that's right" doesn't hold against a
confident LLM; "grep for `std::thread` in src/ returns zero hits"
does.

**Source incident (2026-05-24).** Two AI audits landed in the same
session for the LT-4 work.

- **ChatGPT** audited `lt-4` tip `d3f0fae` against the DXGI /
  composition work — five findings (P1/P2 mixed). Verification:
  every file:line was real and the described code matched.
  Findings 1–4 verified as real-with-caveats; finding 5 needed
  scoping but was real. The texture-cache-vs-Reset hole (the
  P1) was a genuine catch — the Stage 1 sub-plan had named the
  hazard as Risk 4.7 but the chosen mitigation (grep for
  `D3DPOOL_MANAGED`) was insufficient because `D3DXCreateTextureFromFileInMemory`
  (no `Ex` variant) hides its `D3DPOOL_MANAGED` default
  internally and doesn't show up in the grep. Worth acting on.

- **Gemini** audited an unspecified codebase state — twelve
  findings, four labelled Critical/High. Verification: seven of
  the ten cited filenames did not exist in the repo
  (`RenderDevice.cpp`, `UndoSystem.cpp`, `HotReload.cpp`,
  `ViewerWindow.cpp`, `MainWindow.cpp`, `DialogView.cpp`,
  `Spawner.cpp`). Of the four "Critical/High" findings:
  - C3 (raw-pointer undo / use-after-free): fabricated.
    `UndoStack.cpp` uses whole-`ParticleSystem` serialization
    snapshots — no raw pointers, no per-emitter ID lookups, no
    use-after-free vector.
  - C4 (hot-reload thread race): fabricated. No hot-reload
    subsystem exists; grep across `src/` for `ReadDirectoryChangesW`,
    `FileWatcher`, `HotReload`, `std::thread`, `CreateThread`,
    `_beginthread`, `std::async` returns ZERO hits in source.
  - C5 (`WS_CLIPCHILDREN` flicker): factually contradicted.
    `src/main.cpp:7984` and ~10 other `CreateWindowEx` sites
    already set the flag.
  - C2 (D3D9 device reset): already implemented at
    `src/engine.cpp:1260-1339` via the Phase 3 Stage 1c–f work.
    Gemini's "suggested fix" code shape matches what's already
    there.

  C7 (autosave thread race) was likewise fabricated — `Autosave.cpp`
  is fully synchronous on the main thread.

  Net actionable output from Gemini's twelve findings: ONE
  low-severity ChunkReader hardening item (cap `readString`
  allocation, cross-check declared chunk size vs remaining file
  size). The other eleven were either fabricated, contradicted,
  already done, or unverifiable as cited. The shape of the
  output strongly suggests Gemini generated a generic
  "Win32 + D3D9 application hazards" checklist and hallucinated
  plausible file names to attach each item to, without reading
  the repo.

**The meta-lesson.** ChatGPT did real work against this codebase;
Gemini did not. Surface formatting was indistinguishable. The only
way to tell which was which was to verify, finding by finding.
Default to that effort up front — it's much cheaper than the
sprint you'd otherwise waste.

**Cross-reference.** Full per-finding verification trail is in the
session transcript of 2026-05-24. The post-review action items
that survived verification — one ChunkReader hardening pass, the
TextureManager cache-vs-Reset hole from ChatGPT finding #1, and a
Stage 3h composition-fallback sub-stage from ChatGPT finding #2 —
get queued into `ROADMAP.md` / Stage 4 sub-plan as appropriate.

---

## L-019 — Legacy DXSDK June 2010 also shadows Win10 SDK link libraries — `LNK2019 CreateDXGIFactory2`-class failures resolve via `CreateDXGIFactory1` + QI, not linker-path surgery

**Rule.** [`src/ParticleEditor.vcxproj`](../src/ParticleEditor.vcxproj)
puts `$(DXSDK_DIR)Lib\x64` FIRST on `AdditionalLibraryDirectories` so
the linker can resolve the engine's `d3dx9.lib`. DXSDK June 2010 ships
its OWN `dxgi.lib` — pre-Windows-8 vintage, missing
`CreateDXGIFactory2` and the other entrypoints introduced in DXGI 1.2+
/ Win8 SDK. With DXSDK first on the lib path, any new code that calls
those entrypoints fails at link time with `LNK2019 unresolved external
symbol _CreateDXGIFactory2` (or similar), even though the header
compile succeeded because of L-016's per-file include-path isolation.

**The linker-side parallel doesn't have the same fix.** MSBuild has
per-file `<AdditionalIncludeDirectories>` (compile is per-TU), but
**link is per-project** — there is no per-file
`<AdditionalLibraryDirectories>` knob. The L-016 isolation pattern
does NOT extend to the linker. Reordering DXSDK below Win10 SDK on
the project-level lib path would unshadow `dxgi.lib` but also break
`d3dx9.lib` resolution (Win10 SDK doesn't ship a `d3dx9.lib`). No
project-level reorder works for both sides.

**Resolution shape.** Use `CreateDXGIFactory1` (DXSDK-compatible
since Win7, present in DXSDK's `dxgi.lib`) and `QueryInterface` to
the modern `IDXGIFactory*` you actually need (`IDXGIFactory2` for
`CreateSwapChainForComposition`, `IDXGIFactory4` for
`EnumAdapterByLuid`, etc.). The runtime QI succeeds on any Windows
8+ host because the in-process DXGI runtime (loaded from system32,
not DXSDK) implements the modern interface — only the link-time
import library was stale. Capability detection becomes a single QI
chokepoint per `IDXGIFactory*` consumer; if QI fails, you wouldn't
get `CreateSwapChainForComposition` to work either, so QI is the
natural gate for the entire DXGI 1.2+ requirement.

**Trigger.** Any `LNK2019` against a DXGI 1.2+ / DirectComposition /
modern-Direct3D entrypoint after adding new code under `src/host/`
that compiles cleanly (L-016 isolation in place) but fails to link:

- `LNK2019 unresolved external symbol _CreateDXGIFactory2`
- `LNK2019 unresolved external symbol _D3D11CreateDevice` (if linking
  against DXSDK's `d3d11.lib` rather than Win10 SDK's)
- `LNK2019 unresolved external symbol _DCompositionCreateDevice3` or
  similar DComp 1.x-only entrypoints

The compile succeeded means L-016 isolated the header search; the
link failed means the import library is still stale DXSDK's.

**How to apply.**

1. **Don't reorder the project-level lib path.** Engine's
   `d3dx9.lib` dependency is load-bearing for the legacy renderer and
   has no Win10 SDK replacement. Touching the order breaks the engine.
2. **Don't fight the linker.** No per-file lib-dir override exists.
   Custom build steps that copy modern `dxgi.lib` into a private
   directory and prepend that are over-engineered for the actual
   problem.
3. **Take the QI path.** Call `CreateDXGIFactory1(IID_PPV_ARGS(&factory1))`
   and `factory1->QueryInterface(IID_PPV_ARGS(&factory2))` (or higher
   as needed). The runtime DXGI in `system32\dxgi.dll` implements the
   modern interface regardless of which import library the linker
   used. The QI cost is one virtual call per factory creation, paid
   once at startup. Cite this lesson in the implementation file.
4. **Mirror for any new factory class.** D3D11 / DirectComposition
   / D2D each have analogous `Create*Factory` / `Create*Device`
   entrypoints. The same QI-up pattern applies when DXSDK shadows
   the import library.

**Source incident (2026-05-25, [MT-11] Phase 3 Stage 4b).** Stage 4b's
first Debug build of `Compositor::AttachEngineVisual` failed with
`LNK2019 unresolved external symbol _CreateDXGIFactory2`. The spike
at [`src/host/spike/dxgi_spike.cpp`](../src/host/spike/dxgi_spike.cpp)
compiled and linked fine standalone because `dxgi_spike.vcxproj`
doesn't reference DXSDK at all — its lib path is Win10 SDK only.
ParticleEditor's lib path has DXSDK June 2010 first (for `d3dx9.lib`),
which ships a stub `dxgi.lib` lacking `CreateDXGIFactory2`. There is
no per-file `<AdditionalLibraryDirectories>` in MSBuild, so the
L-016 header-side isolation pattern doesn't help — link is
per-project, not per-file. Surgical fix at the call site: switch to
`CreateDXGIFactory1` (DXSDK-compatible since Win7) and QI to
`IDXGIFactory2` for the `CreateSwapChainForComposition` call. Uses
only DXSDK-compatible APIs at link time; gates DXGI 1.2 capability
detection at the QI step.

**Cross-reference.** [L-016](#l-016--legacy-dxsdk-june-2010-shadows-win10-sdk-headers-when-dxsdk-is-first-in-additionalincludedirectories-isolate-new-tus-via-per-file-include-path-override--pimpl)
is the header-side twin (different fix shape but same root cause).
Compositor.cpp's factory creation in `AttachEngineVisual` is the
reference site for the `CreateDXGIFactory1` + QI pattern. Stage 4
sub-plan [`tasks/dxgi-stage-4-composition-wiring.md`](dxgi-stage-4-composition-wiring.md)
§3.2 covers the broader Stage 4 DXGI integration.

---

## L-020 — When porting a spike to production, audit every const/enum the spike picked against the production workload's actual data flow — spike correctness is not transitive

**Rule.** A spike's role is to validate one specific question
("does the topology work? does the transport meet the budget?")
under a known-simple workload — typically `D3DClear` to a solid
color, no shaders, no blending, no real source data. The constants
and enums the spike chose for that workload (swapchain alpha mode,
texture formats, blend states, usage flags, RT clear color, sampler
modes) are correct for the spike's data flow but not automatically
correct for production's. Before adopting spike defaults into
production code, walk each const through the production data flow
and verify the choice still holds.

This is a distinct lesson from L-016/L-017 (which are about SDK +
include surfaces) and from L-018 (which is about external-source
verification). L-020 is about the spike→production hand-off
specifically: spike output is a passing reference for transport
correctness, NOT a turnkey production config.

**Trigger.** Any production port that copies constants from a
reference spike, especially for swapchain / texture / render-state
parameters where the visual or behavioural semantics depend on
properties of the source data:

- Swapchain alpha mode (PREMULTIPLIED vs STRAIGHT vs IGNORE)
- Texture formats with sRGB-vs-UNORM variants
- Color spaces (`DXGI_COLOR_SPACE_*`) for HDR pipelines
- Sampler states where the spike's content was point-sampled but
  production needs anisotropic
- Blend states where the spike used opaque content but production
  is alpha-blended
- Clear colors that "happened to be" the right value for the spike
  (e.g. `{0, 0, 0, 0}` vs `{0, 0, 0, 1}`)

**How to apply.**

For each const/enum the spike chose:

1. Identify the production data flow that consumes the resource —
   what writes to it, what reads from it, what compositor / shader /
   blend stage interprets it.
2. Ask: "What invariant in the spike's workload justified this
   value?" Examples: PREMULTIPLIED works when the source has
   already-multiplied alpha (clean `D3DClear` output); IGNORE
   works when the source's alpha channel is arbitrary and not
   meaningful.
3. Ask: "Does production hold the same invariant?" If yes, keep.
   If no, change. If unsure, the answer is "find out before
   shipping" — typically a 5-line test against a real production
   asset.
4. Document the spike-vs-production divergence in the production
   code with a comment + cite this lesson.

The audit pass is cheap (~10 min per const); the alternative is a
user-surfaced visual regression mid-smoke that costs an iteration
cycle to reproduce, diagnose, and fix.

**Source incident (2026-05-25, [MT-11] Phase 3 Stage 4d.1).** The
Stage 0 DXGI spike at
[`src/host/spike/dxgi_spike.cpp`](../src/host/spike/dxgi_spike.cpp)
created its composition swapchain with
`DXGI_ALPHA_MODE_PREMULTIPLIED`. Correct for the spike's workload:
the spike's render loop was `D3DClear` to a solid color, so the
shared texture's alpha channel held clean pre-multiplied values that
DComp's compositing math could combine correctly. Stage 4b copied
the swapchain desc verbatim from the spike. Stage 4c smoke surfaced
the visual artifact under real engine content: "additive fire
sprites overlap smoke particles with dark/black backgrounds —
doesn't occur in legacy."

Root cause: the production engine's particle blend states leave the
RT's alpha channel in **arbitrary** states — the engine never cared
about its own RT alpha. Legacy arch-A's `UpdateLayeredWindow` path
used the popup's STAMPED alpha (from
`AlphaCompositor::Composite`'s post-process stamping), NOT the
engine RT's alpha. Under PREMULTIPLIED, DComp interpreted the
RT's arbitrary alpha as a premultiplied factor and darkened the
output everywhere alpha was less than full. Fix: switch to
`DXGI_ALPHA_MODE_IGNORE`. Tells DComp the surface is fully opaque;
chrome composites on top where opaque, transparent regions show
full-opacity engine. Matches legacy semantics.

The spike's PREMULTIPLIED choice was correct for the spike. The
production port should have asked "does the production engine
write meaningful alpha to its RT?" The answer is no (it never
has), but the question wasn't asked at port time — the const got
copied because the spike passed. ~1 iteration cycle of
user-driven smoke + diagnosis to discover what a 5-minute pre-
port audit would have caught.

**Cross-reference.** Stage 4 sub-plan [`tasks/dxgi-stage-4-composition-wiring.md`](dxgi-stage-4-composition-wiring.md)
§3.5 covers the swapchain-desc decisions; Compositor.cpp's
`AttachEngineVisual` is the production site. CHANGELOG Stage 4
entry's "Issues encountered" §4d.1 has the long-form smoke
sequence. [L-018](#l-018--ai-generated-audits-need-first-party-fileline-verification-before-any-finding-is-treated-as-actionable-llm-severity-labels-are-not-signals)
is the external-source verification parallel; L-020 is the
internal spike→production parallel.

---

## L-021 — Verify rendered geometry — combined-math edition

**Rule.** CLAUDE.md's "verify rendered geometry, not design intent"
rule applies to **combined math across components**, not just
per-component math. A sub-plan describing Component A's coord
convention correctly AND Component B's coord convention correctly
can still produce broken geometry when the two compose — if no one
walks the pixel path end-to-end. Per-component review catches local
errors; combined-math walk catches composition errors. Both passes
are needed for any multi-component layout.

This is a strengthening of the existing CLAUDE.md rule, not a
replacement. The existing rule says "compute pixel positions
yourself; match against what the user will see." L-021 names the
specific failure mode that's escaped that rule in practice:
internally-correct components composing into externally-broken
geometry.

**Trigger.** Any sub-plan with >1 component contributing to final-
pixel position:

- Transform + viewport (e.g. DComp visual offset + clip + D3D
  scissor / RSSetViewports)
- Projection + render-target sub-region (e.g. per-pixel-FoV
  projection + scissor)
- Parent-space + local-space (e.g. WPF / DComp visual tree
  parent→child offsets)
- Window-client + control-rect coords (Win32 child windows where
  parent and child have different origins)

Risk escalates when components use **different coord conventions** —
absolute vs relative, world vs screen, post-translation vs
pre-translation, MSDN's "insertAbove=TRUE" semantics (which mean
"in front" but parse as "above" to most readers — L-016 area), etc.
Each component being internally correct is necessary but not
sufficient; the composition needs its own verification.

**How to apply.**

At sub-plan time, before declaring a multi-component layout design
done:

1. **Pick a concrete sample pixel.** Not "the top-left corner" or
   "the center" — a specific `(x, y)` like `(100, 100)`, plus a
   concrete scene-rect or transform like `(50, 30, 800, 600)`.
2. **State the assumed coord space at each stage.** "After
   `SetOffset(sceneX, sceneY)`, the visual's local origin is
   `(sceneX, sceneY)` in parent-space." "After `SetClip({0, 0, w,
   h})` in local-coords-post-offset, the clip rect in parent-space
   is `(sceneX, sceneY, sceneX+w, sceneY+h)`."
3. **Compute the final pixel position** at each component and the
   combined result. Verify the combined result matches what the
   user would see.
4. **Write the trace into the sub-plan.** Not just "design intent",
   but the actual pixel arithmetic. A reviewer can audit the trace
   for off-by-one and double-offset errors that prose descriptions
   hide.

A 30-second mental walk-through with sample pixel `(100, 100)` and
scene-rect `(50, 30, 800, 600)` is cheaper than a smoke-cycle
iteration that costs the user a screenshot, your diagnostic time,
and a re-build.

**Source incident (2026-05-25, [MT-11] Phase 3 Stage 5 T6 Iter 1).**
The Stage 5 sub-plan described two components contributing to
scene-rect rendering:

- **T1 (Compositor):** "`SetOffset(sceneX, sceneY) + SetClip({0, 0,
  w, h})` in local-coords-post-offset." Internally correct — local
  origin after offset is at `(sceneX, sceneY)` in parent-space; clip
  is local-relative, carves `(0..w, 0..h)` from the local-coord box.
- **T3 (Engine):** "Render scene at viewport `(sceneX, sceneY, w,
  h)` in the RT." Internally correct — engine paints into the
  scene-rect sub-region of the RT.

Each component followed its sub-plan correctly. The combined
math produced a **double-offset displacement bug**: engine paints
RT[sceneX..sceneX+w, sceneY..sceneY+h] → DComp visual offset shifts
the entire swapchain content by `(sceneX, sceneY)` in parent-space
→ visible pixels are `local[0..w, 0..h]` which corresponds to **RT
top-left** = engine clear color. The actual rendered scene sat at
RT[sceneX..2*sceneX+w, sceneY..2*sceneY+h] — invisible because the
clip excluded it.

User screenshot at T6 smoke: engine scene in the bottom-right of
the scene-rect quadrant, engine clear color filling the top-left
margins. Neither pre-handoff code review nor the implementer's
mental walkthrough caught the math — each component was reviewed
in isolation and looked correct.

Fix shape: `SetOffsetX/Y(0, 0) + SetClip` with **ABSOLUTE
host-client coords** `{x, y, x+w, y+h}`. Visual's local-coord
space equals parent coord space (root visual = host client); clip
directly carves the visible region from the (full-RT-sized)
swapchain at host-client coords; engine continues to paint into
the scene-rect sub-region of the RT. Combined math: engine paints
RT[sceneX..sceneX+w, sceneY..sceneY+h] → visual at parent-origin,
no shift → visible pixels are exactly the scene-rect sub-region of
the swapchain → correct.

A pre-coding pixel walk would have flagged the double-offset:
sample `(100, 100)` after `SetOffset(50, 30)` lands at parent-
coord `(150, 130)`; the clip `{0, 0, w, h}` (local-relative)
becomes `{50, 30, 50+w, 30+h}` in parent-coords; engine wrote
parent-coord `(50+100, 30+100) = (150, 130)` to that pixel, but
the visual surface there now holds `RT[100, 100]` (post-offset
local coord), which is **engine clear**.

**Cross-reference.** CLAUDE.md "Verify rendered geometry, not
design intent" is the parent rule. Stage 5 sub-plan
[`tasks/dxgi-stage-5-scene-rect-transform.md`](dxgi-stage-5-scene-rect-transform.md)
has the post-T6 revision notes documenting the design pivot.
[`src/host/Compositor.cpp`](../src/host/Compositor.cpp)
`SetEngineVisualTransform` is the final shape. Stage 5 smoke evidence
at [`tasks/stage-5-smoke-result.md`](stage-5-smoke-result.md).

---

## L-022 — Handoff notes and next-session prompts carry claims, not facts — verify against current code before any claim enters a dispatch's plan

**Rule.** Carry-forward TODO claims in [`tasks/HANDOFF.md`](HANDOFF.md),
next-session-prompt files, sub-plan "follow-ups" sections, or
similar inter-session-doc surfaces are **claims to verify**, not
facts. Prior-session reasoning may have been:

- **Correct when written and stale now** (a sibling session closed
  the gap, lines shifted, a refactor changed the call shape).
- **Wrong from the start** (the prior session reasoned by analogy
  from a genuine bug to a parallel that doesn't hold, without
  re-reading the cited site).
- **Correct but mis-located** (line numbers shifted; the cited
  `file:line` no longer points at the function the claim describes).

Verify each carry-forward claim against the current code BEFORE it
enters a dispatch's plan. A 5-15 minute verification pass routinely
catches phantom bugs that would otherwise burn a dispatch on a
non-fix.

L-018 covers external-source claims (AI audits, third-party
reports). L-022 is the internal-source parallel: claims authored by
prior sessions of this collaboration itself. The cost asymmetry is
the same shape — pre-flight verification is cheap, dispatch-time
discovery is expensive — and the verification posture should be the
same regardless of which side of the trust boundary the claim came
from.

**Trigger.** Picking up any dispatch where the prompt or HANDOFF
cites:

- A "latent bug" or "single-line fix" deferred from a prior
  session.
- A "deferred to a follow-up dispatch" item being promoted to
  active scope.
- An "out of scope, ship-if-surfaces" deferral being elevated.
- A specific `file:line` citation in a non-code document (sub-plan,
  HANDOFF, CHANGELOG, next-session-prompt) for a code site that
  the current dispatch is about to touch.

Also fires for the converse: when this dispatch is *writing* a
carry-forward TODO. Bake the verification expectation into the
note — "verified at HEAD `<hash>`" or "claim not re-verified since
`<date>`" — so the next session knows the freshness state.

**How to apply.**

For each carry-forward claim entering the active plan:

1. **Read the cited code at the cited line.** If the line has
   shifted (file edits since the claim was written), find the actual
   function by name and re-anchor the claim to its current
   `file:line`.
2. **Trace the data flow described in the claim.** Does the
   documented "missing push/call/guard" actually exist? Does
   the path the claim describes still exist, or was it
   refactored?
3. **Use `git log -S` / `git blame`** to date the cited code. If
   the code predates the claim by months/years, the claim was
   probably wrong from the start (the prior author reasoned by
   analogy without reading the site). If it post-dates, the gap
   may have been closed by a subsequent commit.
4. **If the bug is real:** plan the fix. Note the verification
   in the dispatch plan ("Verified the bug at `file:NNNN` —
   claim still holds at HEAD `<hash>`").
5. **If the bug is not real:** retract the claim in HANDOFF.md
   explicitly. Don't silently drop it — future sessions inheriting
   the same docs need the retraction in place. Cite this lesson
   in the retraction so the structural finding is preserved.

**Source incident (2026-05-25, post-[MT-11] Phase 3 dispatch
pre-flight).** The next-session-prompt and `HANDOFF.md` both
described a "latent projection-not-pushed bug in
`Engine::ResetParameters`" — cited as a single-line fix at
`engine.cpp:1518`, with the rationale that `ResetParameters`
rebuilds `m_projection` but doesn't push it to the device, and
"pre-Stage-5 nobody noticed because window resize was always
followed by camera interaction (which calls `SetCamera` →
`SetTransform`)." The fix described: at end of `ResetParameters`,
recompute `m_viewProjection` and call
`m_pDevice->SetTransform(D3DTS_PROJECTION, &m_projection)` — same
pattern as Stage 5's `SetSceneViewport`.

Pre-flight verification:

- `ResetParameters` is now at [`src/engine.cpp:1654`](../src/engine.cpp:1654)
  (lines shifted ~136 by Stage 5's `SetSceneViewport` + related
  additions; the claim's `:1518` no longer points at the function).
- `ResetParameters` ends with `SetCamera(m_eye)` at
  [`src/engine.cpp:1734`](../src/engine.cpp:1734) — inside the
  same guard that rebuilds `m_projection`.
- `SetCamera` at [`src/engine.cpp:998-1015`](../src/engine.cpp:998)
  unconditionally executes
  `D3DXMatrixMultiply(&m_viewProjection, &m_view, &m_projection)`
  at line 1004 and
  `m_pDevice->SetTransform(D3DTS_PROJECTION, &m_projection)` at
  line 1014.
- `git log -S "SetCamera(m_eye)" -- src/engine.cpp` reports the
  call dates to commit `0d352ae` (Initial import) — not a recent
  addition, not a Stage 5 artifact.

So `ResetParameters` **does** push the fresh projection to the
device via its existing `SetCamera(m_eye)` tail call, has done
since Initial import, and the "latent bug" was a phantom. The
prior session appears to have reasoned by analogy from the
genuine Stage 5 `SetSceneViewport` bug (which legitimately
rebuilt `m_projection` without pushing) to a parallel in
`ResetParameters` that doesn't hold (because `ResetParameters`
calls `SetCamera`, which `SetSceneViewport` doesn't). The
analogy was plausible but not verified.

Discovery cost: ~15 minutes of pre-flight reading + grep +
`git log -S`. Hypothetical un-verified cost: a duplicate
`SetTransform(PROJECTION)` would have shipped right before
the existing `SetCamera(m_eye)` push — likely harmless,
possibly a redundant device-state push per resize cycle,
contributing noise to future readers ("why are there two
projection pushes here?").

**Cross-reference.** [L-018](#l-018--ai-generated-audits-need-first-party-fileline-verification-before-any-finding-is-treated-as-actionable-llm-severity-labels-are-not-signals)
is the external-source parallel (AI audits / third-party reports).
CLAUDE.md "Trust but verify — universally" is the parent
principle. CLAUDE.md's "Pre-handoff testing — exhaustive" applies
on the *writing* side: a session producing a HANDOFF note about a
"latent bug" should verify it before persisting the claim. The
retracted claim was in `HANDOFF.md` "Known follow-ups (out of
scope for Stage 5)" item 2; the retraction citing this lesson
sits in HANDOFF.md's "Retractions" sub-section.

---

## L-023 — Invoke MSBuild against the `.sln`, not the `.vcxproj` directly, when the project uses `$(SolutionDir)` macros in include / library paths

**Rule.** [`src/ParticleEditor.vcxproj`](../src/ParticleEditor.vcxproj)
(and presumably any future project in this tree) sets
`<AdditionalIncludeDirectories>` using the `$(SolutionDir)` MSBuild
macro — e.g. `$(SolutionDir)\libs\expat-2.2.0\include`,
`$(SolutionDir)src`,
`$(SolutionDir)packages\Microsoft.Web.WebView2.1.0.3967.48\build\native\include`.
`$(SolutionDir)` resolves to **the directory containing the target
file MSBuild was invoked against**, not the workspace root. When
MSBuild is run against `<project>.vcxproj` directly (rather than
`<solution>.sln`), `$(SolutionDir)` collapses to the project's
containing directory — `src\` in this repo — which breaks every
path that assumed workspace-root relativity. The include-resolution
failure is the visible symptom; the cause is upstream.

**Trigger.** A previously-clean build of `ParticleEditor.vcxproj`
fails with `C1083: Cannot open include file: <foo>` errors for
files that exist in the repo, where `<foo>` is one of:

- A project-local header like `exceptions.h` (lives at `src/exceptions.h`).
- An `expat/expat.h`-style include into `libs/expat-2.2.0/`.
- A `UI/UI.h`-style sibling include from `src/UI/*.cpp`.

The errors appear when:

1. Building a **fresh worktree** that hasn't been built via the
   .sln in this checkout (so any cached intermediate state from a
   prior .sln build isn't there to mask the issue).
2. Invoking MSBuild as `MSBuild <path-to>.vcxproj` rather than
   `MSBuild <path-to>.sln`.

The same .vcxproj builds cleanly via the .sln. The symptom is purely
a function of HOW MSBuild was invoked.

**How to apply.**

For any MSBuild invocation in this repo (CLI, CI, or harness):

1. **Default to the .sln target.** `MSBuild .\ParticleEditor.sln
   /p:Configuration=Debug /p:Platform=x64 /m` is the canonical
   incantation. The `.sln` file's location anchors `$(SolutionDir)`
   correctly.
2. **If invoking a .vcxproj directly** (sometimes useful for
   compile-only subsets, IDE integration, or speed), pass
   `/p:SolutionDir=<absolute-path-to-workspace-root>\` explicitly.
   The trailing backslash is significant — MSBuild concatenates the
   value with relative subpaths and the docs specify it must end
   with the platform separator.
3. **NuGet `restore` MUST be against the .sln** even if you build
   the .vcxproj. `MSBuild <project>.vcxproj /t:Restore` may report
   "Nothing to do" because some package references are
   solution-level. Always restore at the `.sln` first; build
   second.
4. **In documentation / handoff docs**, when referencing build
   commands, name the .sln target. Don't write
   `MSBuild ParticleEditor.vcxproj` even when correct, since
   future readers will copy the snippet into a fresh worktree
   where it'll break.

**Source incident (2026-05-25, post-[MT-11] Phase 3 retro-doc + NT-5
dispatches).** During the post-Phase 3 retro-doc dispatch's MSBuild
verification, the first invocation
(`MSBuild ..\src\ParticleEditor.vcxproj /p:Configuration=Debug /p:Platform=x64`)
failed with three classes of `C1083` errors —
`EmitterList.cpp` couldn't open `UI/UI.h`, `UI/UI.h` couldn't open
`exceptions.h`, and `xml.h` couldn't open `expat/expat.h`. Files
that demonstrably existed in the repo. Initial diagnosis suspected a
fresh-worktree environment issue (the NuGet packages had just been
restored), but the errors persisted after restore. The actual cause
was MSBuild resolving `$(SolutionDir)` to `src\` (the .vcxproj's
parent) instead of the workspace root, so `$(SolutionDir)src` became
`src\src` (nonexistent) and `$(SolutionDir)\libs\expat-2.2.0\include`
became `src\libs\expat-2.2.0\include` (nonexistent — `libs` is at the
workspace root, not inside `src`). The fix was a one-line change to
invoke MSBuild against `..\ParticleEditor.sln`. Same source tree,
same MSBuild version (VS18 Community), same configuration — the only
delta was the target argument.

`BridgeDispatcher.cpp` was listed in the build output of the failing
.vcxproj invocation, *which is what made the diagnosis slow* —
the newly-added file compiled cleanly while the build "failed," so
the natural first hypothesis was that the new code introduced the
problem. It hadn't; the failures were in files the new code never
touched. The L-022 verification pattern (read the cited code site,
trace the actual fault) is what surfaced the upstream cause —
applied here to a build-environment claim instead of a handoff-doc
claim, the same shape of rule.

**Cross-reference.** Invocation site documented in
[`src/ParticleEditor.vcxproj`](../src/ParticleEditor.vcxproj) lines
92, 110, 130, 153 (each `AdditionalIncludeDirectories` entry uses
`$(SolutionDir)`). [L-016](#l-016--legacy-dxsdk-june-2010-shadows-win10-sdk-headers-when-dxsdk-is-first-in-additionalincludedirectories-isolate-new-tus-via-per-file-include-path-override--pimpl)
is the related lesson on per-file include-path REPLACEMENT vs
inheritance; this lesson is on the upstream macro resolution. Future
build-environment claims in handoff docs (e.g. "MSBuild Debug x64
clean") should now name the invocation form
(`MSBuild .\ParticleEditor.sln`) so future readers don't reproduce
the issue by reaching for `MSBuild .\src\ParticleEditor.vcxproj` as
a "more direct" form.

---

## L-024 — UIA golden non-determinism: WebView2 topology drift + live React subscriptions; solve at the source, not at the normalizer

**Rule.** Win32 UIA captures over WebView2 are prone to non-determinism
from two distinct sources, and the right fix for each lives at a
different layer:

1. **WebView2 / Chromium tree-shape drift** — Chromium presents internal
   chrome containers (`Chrome_WidgetWin_1`, `BrowserRootView`,
   `NonClientView`, `EmbeddedBrowserTabRootView`, etc.) at different
   depths depending on initialization state, profile, and prior captures.
   These are wrapper visuals around the React subtree, not semantic
   content. **Fix layer: normalizer.** Add to
   `a11y-allowlist.json#alwaysStripWrappers` so they're replaced by their
   children. Cost: one allowlist entry per wrapper class.

2. **React components subscribed to live host streams** — e.g. StatusBar
   re-renders every 250 ms on `stats/tick` (FPS, particle counts), and
   intermittently on `cursor/position-3d` (mouse-over-viewport
   coordinates). Capturing the UIA tree mid-tick produces values that
   change run-to-run. **Fix layer: source.** Add a test-only bridge knob
   (e.g. `stats/set-frozen`) that suppresses the host emission AND tells
   the React component to clear its local state. The existing
   placeholder render path (`—` for null values) then naturally produces
   a deterministic snapshot WITH the StatusBar's structural a11y still
   captured.

**Anti-pattern: a normalizer-side "drop the whole subtree" concept.**
The first attempt at the StatusBar problem added an
`alwaysDropSubtrees: ["status-bar"]` list to the normalizer (parallel
to `alwaysStripWrappers` but removing node + descendants). Visible cost:
~30 lines in the normalizer for a new concept plus an `id="status-bar"`
on the React component to give it a stable UIA AutomationId. Invisible
cost: zero StatusBar coverage in goldens (a future regression that
deletes StatusBar or breaks its labels wouldn't be caught), and every
future live-value cell (e.g. a hypothetical "files in mod" counter)
either needs to be in the drop list or shows up as a flake. Choose the
source-side fix; the bridge knob scales to any future live UI for free.

**Cross-spec contamination is part of "non-determinism."** A test
spec's `beforeEach` that freezes state (or loads a fixture) MUST have
an `afterAll` that restores the host to a state subsequent spec files
can rely on. In MT-11 T9.3, two failures surfaced in cross-spec
contamination only after the first determinism rerun: `app-shell.spec.ts`
expected `stats/tick` to fire (the a11y freeze persisted across the
spec-file boundary), and `emitter-mutations.spec.ts` expected the host
to seed with one root emitter (the a11y fixture's 3-emitter tree
persisted). Fix: a11y `afterAll` calls both `stats/set-frozen
{ frozen: false }` and `file/new {}`. The host process is shared
across spec files (per `run-native-tests.mjs`), so any state mutation
that's "test-only" must be paired with an opposite mutation in
`afterAll`.

**Trigger.** Symptoms that indicate this lesson:

- UIA goldens generated cleanly under `UPDATE_A11Y_GOLDENS=1`, then a
  no-update rerun fails with golden diffs in nodes you didn't touch
  (e.g. a node moves from `children[0]` to `children[2].children[0]`).
- Cross-spec flake where the failing spec doesn't reference any
  WebView2 / UIA / a11y machinery — e.g. an unrelated bridge spec
  times out waiting for an event that should fire every 250 ms.
- A normalizer that's growing extra concepts (drop-this, replace-that,
  ignore-this-subtree) every time a new surface is captured.

**How to apply.**

1. **Wrapper drift goes in the allowlist.** When a UIA dump shows a
   Chromium/WebView2 chrome container that's not semantic, add it to
   `alwaysStripWrappers` (matches by AutomationId, ControlType, OR
   ClassName).
2. **Live data goes in a source-side freeze.** If a React component
   subscribes to a host stream, add a test-only freeze handler that
   suppresses the stream emission AND emits a "frozen" event the React
   component listens for to clear local state. Reuse the existing
   placeholder render path.
3. **Spec `afterAll` MUST undo `beforeEach` for shared-process tests.**
   Stats freeze → unfreeze. Fixture load → `file/new`. Selection
   change → `emitters/selected null`. Whatever your `beforeEach`
   touches, restore in `afterAll`.
4. **Use ordinal byte comparison for canonical sort keys.**
   `String.prototype.localeCompare` is locale-sensitive and can order
   separator characters (`|`, `_`) inconsistently across Windows ICU
   table versions and OS language packs. Use `a < b ? -1 : a > b ? 1
   : 0` for sort keys that need to be stable across machines.

**Source incident (2026-05-26, [MT-11] Phase 3 T9.3 first try +
recovery).** The first T9.3 dispatch generated 29 goldens cleanly,
then the determinism rerun failed across multiple goldens with two
classes of diff: (a) `EmbeddedBrowserTabRootView` appearing at depth
3 vs depth 0 in different runs, (b) StatusBar FPS values changing
between runs. The first-pass fix shipped `alwaysDropSubtrees` to drop
the whole StatusBar subtree — which made the dropped commit's run
pass but cost StatusBar a11y coverage entirely and added a new
normalizer concept. The recovery pivoted to a source-side
`stats/set-frozen` bridge knob (request takes `{frozen: bool}`, emits
a `stats/frozen-changed` event; React StatusBar listens and clears
local state when frozen=true). The existing `placeholder = s === null`
render path then produces deterministic `—` values for FPS, Emitters,
Particles, Instances, Cursor — StatusBar a11y is preserved in goldens.

A second contamination surfaced during the recovery's first
determinism rerun: `app-shell.spec.ts` failed because the a11y
`stats/set-frozen` had no symmetric unfreeze in `afterAll`.
`emitter-mutations.spec.ts` failed because the a11y `file/open` of a
3-emitter fixture left the tree state for the next spec to see. Both
fixed by adding `stats/set-frozen { frozen: false }` + `file/new`
to a11y `afterAll`. Second rerun: 132 passed, 0 failed, 26 skipped
— twice consecutively.

**Cross-reference.**
[`web/apps/editor/tests/helpers/a11y-normalizer.ts`](../web/apps/editor/tests/helpers/a11y-normalizer.ts)
holds the normalizer; the allowlist lives next to it as
[`a11y-allowlist.json`](../web/apps/editor/tests/helpers/a11y-allowlist.json).
The `stats/set-frozen` request handler is at
[`src/host/BridgeDispatcher.cpp`](../src/host/BridgeDispatcher.cpp)
(grep for `"stats/set-frozen"`); the schema is in
[`web/packages/bridge-schema/src/index.ts`](../web/packages/bridge-schema/src/index.ts).
The React listener is at
[`web/apps/editor/src/components/StatusBar.tsx`](../web/apps/editor/src/components/StatusBar.tsx).
The cross-spec `afterAll` patterns live in the 4
`web/apps/editor/tests/a11y-*.spec.ts` files. Related lessons:
[L-006](#l-006--dont-clear-react-optimistic-state-on-every-host-data-refresh)
on React-state-vs-host-state separation;
[L-022](#l-022--handoff-notes-and-next-session-prompts-carry-claims-not-facts--verify-against-current-code-before-any-claim-enters-a-dispatchs-plan)
on verifying claims (the original "1 failed (emitter-mutations
pre-existing flake)" handoff claim was wrong — the failure was
caused by the first T9.3 dispatch's own cross-spec contamination,
not pre-existing flake).

## L-025 — Invoke MSBuild (and any Windows-native CLI with `/switch` args) via PowerShell, not Git Bash

**Rule.** When invoking MSBuild — or any native Windows CLI whose
arguments use forward-slash switches (`/p:`, `/nologo`, `/m`,
`/verbosity:minimal`) — use **PowerShell**, not Git Bash / MSYS. Bash
on Windows performs **MSYS path translation** on any argument that
starts with `/`, converting it to a Windows path. So `/nologo`
becomes `C:/Program Files/Git/nologo`, `/p:Configuration=Debug`
becomes `p:Configuration=Debug` (leading slash stripped), and
`/m` becomes `M:/`. MSBuild then bails with `MSB1008: Only one
project can be specified`. The kicker: the MSBuild response file
catches the malformed invocation and **MSBuild exits with code 0
anyway**, so the build looks like it succeeded but produced no
output. You don't notice until something downstream tries to
launch the binary and hits `ENOENT`.

**Anti-pattern: trusting MSBuild's exit code on Git Bash.** A 0-exit
MSBuild that printed only its version banner and an MSB1008 message
is a failed invocation pretending to be a successful one. The
response-file fallback is silent on stdout — the only signal is the
absence of "ProjectName.vcxproj -> .../ParticleEditor.exe" lines
near the end. ALWAYS check the binary exists at the expected output
path after a build; never assume "exit 0" means "build succeeded"
on Windows.

**Trigger.** Symptoms that indicate this lesson:

- MSBuild invocation reports `exit code 0` from a Bash tool, but the
  output is suspiciously short (~5-10 lines, mostly an MSB1008 error
  + the response file content).
- A subsequent test runner / Playwright spec fails with
  `ENOENT spawn ParticleEditor.exe`.
- Build outputs that should exist (`x64\Debug\ParticleEditor.exe`)
  are missing from the worktree even though the build "succeeded."
- MSBuild output contains the line
  `'' came from 'C:\Program Files\Microsoft Visual Studio\<v>\Community\MSBuild\Current\Bin\MSBuild.rsp'`
  — that's the response-file fallback masking the failure.

**How to apply.**

1. **For MSBuild + any `/switch`-style native CLI on Windows, use the
   PowerShell tool, not Bash.** PowerShell parses `/p:...` as
   intended without path translation.
2. **For pnpm + node-script invocations (no `/switch` args), Bash is
   fine.** The footgun is specific to forward-slash argument parsing.
3. **After any build, verify the binary exists at the expected path
   before treating the build as successful.** `ls x64/Debug/ParticleEditor.exe`
   is the one-line floor.
4. **If you MUST invoke MSBuild from Bash (e.g. a CI job script),
   double the slashes (`//p:Configuration=Debug`) or use Bash's MSYS
   no-path-conversion escape sequence (`MSYS_NO_PATHCONV=1 msbuild ...`).
   Treat these as workarounds, not preferred form.

**Source incident (2026-05-27, HANDOFF item 16 dispatch).** First
Phase A build invocation of this dispatch used the Bash tool against
MSBuild with `/p:Configuration=Debug /p:Platform=x64 /nologo /m` —
exit code 0 within seconds, output looked plausible. Composition
lane test run then failed with
`spawn C:\Modding\...\x64\Debug\ParticleEditor.exe ENOENT`. Re-read
of the MSBuild output revealed `MSB1008: Only one project can be
specified` with the path-converted arguments listed in the full
command line. Rebuild via PowerShell with identical switches
succeeded properly. Lesson 30 minutes of confusion to discover;
this entry exists to make it instant next time.

**Cross-reference.**
[L-023](#l-023--invoke-msbuild-against-the-sln-not-the-vcxproj-directly-when-the-project-uses-solutiondir-macros-in-include--library-paths)
covers the `.sln`-vs-`.vcxproj` invocation rule; L-025 adds the
shell-host rule. Together: invoke MSBuild via PowerShell against
the `.sln`, not the `.vcxproj`. Project root `ParticleEditor.sln`
is the entry point; PowerShell is the shell.

## L-026 — Byte-exact snapshot / golden files need an explicit `text eol=lf` rule in `.gitattributes`, or `core.autocrlf=true` silently breaks every comparison on Windows

**Rule.** When a test matcher does byte-exact string comparison
against a committed snapshot/golden file
(`expected === serialized` against the file's raw contents — see
[`web/apps/editor/tests/helpers/toMatchJSONGolden.ts`](../web/apps/editor/tests/helpers/toMatchJSONGolden.ts)),
the snapshot file **must** have an explicit `text eol=lf` rule in
`.gitattributes`. Without the rule, Git's default behaviour on
Windows installations (`core.autocrlf=true`) smudges the
committed-LF file to CRLF on checkout, and every snapshot test
false-fails — the working-tree bytes (`\r\n` line endings) don't
match what the snapshot output produces (always `\n`). The mass
mode is alarming: every snapshot test in the suite fails on the
first Windows checkout, with no obvious code-change connection.

**Anti-pattern: trying to bisect a "regression" that's actually
autocrlf.** Symptoms of autocrlf smudging look like a wide-spread
"drift" — N snapshots all fail with no apparent code change. The
bisect range can be huge (the autocrlf hit is latent from the
moment the goldens were committed on a non-Windows host or with
`core.autocrlf=false`), and the bisect produces no smoking gun. Run
`git ls-files --eol <path>` BEFORE bisecting any mass snapshot
failure on Windows — if you see `i/lf w/crlf attr/`, the cause is
autocrlf, not a code regression.

**Trigger.** Symptoms that indicate this lesson:

- Every (or near-every) byte-exact snapshot test in the suite fails
  on a clean Windows checkout.
- `git diff HEAD -- <golden>` returns no content but `git status`
  shows the file as modified (with a `warning: in the working copy
  of '<path>', LF will be replaced by CRLF the next time Git touches
  it` warning).
- The matcher's diff hint says "Hint: run `pnpm a11y:update --grep
  ...`" but you suspect every single golden has drifted — too
  uniform to be a real regression.
- `git ls-files --eol <path>` shows `i/lf w/crlf` for the failing
  files.

**How to apply.**

1. **Add an explicit `text eol=lf` rule** in `.gitattributes` for
   every byte-exact snapshot file path / pattern in the repo. Use
   forward-looking patterns (`*.golden.json`, `*.snap`,
   `__snapshots__/**`) plus explicit current paths.
2. **Renormalize the working tree after adding the rule.** `git add
   --renormalize <path>` updates the index; if the working tree
   files were checked out before the rule existed they may still be
   CRLF. Force re-smudge by `rm <files>; git checkout HEAD -- <path>`
   — `git checkout` alone may no-op because git sees the files as
   "content-identical" (it normalizes EOLs when comparing).
3. **Verify with `git ls-files --eol`.** After the renormalize +
   re-checkout, `i/lf w/lf attr/text eol=lf` is the expected state.
   `w/crlf` means the smudge didn't re-apply; re-do step 2.
4. **NEVER tell a snapshot matcher to normalize line endings on
   read.** It's tempting (`expected.replace(/\r\n/g, '\n')` in the
   matcher) but it papers over the underlying issue and weakens
   byte-exactness for unrelated cases. Fix the repo policy via
   `.gitattributes`; let the matcher stay strict.

**Source incident (2026-05-27, HANDOFF item 16).** The dispatch was
scoped as a ★★★ multi-phase "a11y golden drift triage" anticipating
~13-commit bisect + per-surface React-DOM diff inspection. Phase A's
first diff inspection found EMPTY `git diff` output for every
failing surface, with the autocrlf warning attached. `git ls-files
--eol` confirmed `i/lf w/crlf` on every committed golden. The actual
fix turned out to be 8 lines of `.gitattributes` + a renormalize.
28 of 29 false failures vanished immediately; the remaining surface
(`dialog-about`) had a separate genuine date-pinning issue resolved
under the same dispatch. The original plan's bisect-and-triage
machinery wasn't wasted — Phase A's discipline forced the EOL check
that surfaced the actual cause — but Phase B / Phase C as written
were rendered moot.

**Cross-reference.**
[L-024](#l-024--uia-golden-non-determinism-webview2-topology-drift--live-react-subscriptions-solve-at-the-source-not-at-the-normalizer)
is the sibling for *content* non-determinism in goldens (live React
subscriptions); L-026 covers *byte-level* drift from EOL smudging.
Together: snapshot goldens need source-side determinism (L-024) AND
byte-stable encoding (L-026) to be reliable. See `.gitattributes`
at repo root for the current rule list.

## L-027 — `run-native-tests.mjs` silently drops unrecognised CLI args; explicitly forward them so `--grep` and similar Playwright filters work

**Rule.** The native-test harness
([`web/apps/editor/scripts/run-native-tests.mjs`](../web/apps/editor/scripts/run-native-tests.mjs))
spawns Playwright with a **hard-coded** list of spec files. Until
HANDOFF item 16, any extra CLI args passed to the wrapper (e.g.
`pnpm a11y:update --grep "menubar-closed"`) were silently dropped —
they never reached Playwright. The wrapper recognises `--update`
and `--legacy` (consumed at the top of `main()`) but discarded
everything else. Result: scoped golden regeneration was impossible
through `pnpm a11y:update`; every "scoped" invocation regenerated
ALL goldens, which is exactly the foot-gun the matcher's `--grep`
hint warns users to avoid.

**Anti-pattern: trusting the `--grep` hint without verifying the
harness forwards it.** The `toMatchJSONGolden` mismatch message
says *"Hint: if intended, run `pnpm a11y:update --grep
\"<surface>\"`"*. That hint is structurally honest for direct
Playwright invocation but misleading through the wrapper. A user
following the hint blindly will regenerate every golden in the
captured run — and may commit dozens of "incidentally refreshed"
files without realising the `--grep` was a no-op. The user is in a
worse position than if no hint existed at all.

**Trigger.** Symptoms that indicate this lesson:

- `pnpm a11y:update --grep "<id>"` reports a high number of
  passing tests (>>1) in update mode — `UPDATE_A11Y_GOLDENS=1`
  makes the matcher always-pass, so the count of "passed" tests
  is the count of regenerated goldens. If `--grep` had filtered
  to one surface, the count should be ≤ surfaces-in-grep.
- `git status` after a "scoped" refresh shows changes to multiple
  goldens you didn't expect.
- Any wrapper script that spawns a downstream tool with `process.argv`
  filtering but doesn't pass-through unrecognised args.

**How to apply.**

1. **Wrapper scripts that spawn a downstream test runner MUST
   forward unrecognised args.** Pattern:
   ```js
   const RECOGNISED_FLAGS = new Set(["--update", "--legacy"]);
   const forwardedArgs = process.argv.slice(2)
     .filter((a) => !RECOGNISED_FLAGS.has(a));
   // ... later, in the Playwright spawn:
   const pw = spawn(node, [playwrightCli, "test", ...specFiles, ...forwardedArgs], ...);
   ```
2. **If your wrapper has flags that take values (e.g. `--workers=4`),
   handle them in the filter, not just the boolean form.**
3. **Test the forwarding** by adding a `console.log("[wrapper]
   forwarding args:", forwardedArgs)` line during development and
   confirming Playwright sees them. Easy to forget to verify the
   plumbing actually works once `--update` flowed through cleanly.
4. **Document the recognised flags in the wrapper's top-of-file
   comment** so future maintainers know which flags are special-cased
   vs forwarded.

**Source incident (2026-05-27, HANDOFF item 16 dispatch).** During
Phase A's diff inspection I ran `pnpm a11y:update --grep
"menubar-closed"` expecting one surface's golden to refresh — got
all 29 composition YAMLs regenerated instead. Five minutes of
"why" then a re-read of
[`run-native-tests.mjs`](../web/apps/editor/scripts/run-native-tests.mjs)
revealed the hardcoded arg list. Fix: 5 LOC to filter + forward
`process.argv.slice(2)` past `--update`/`--legacy`. Bundled into
the same commit as the autocrlf fix because both were items
identified during the same dispatch.

**Cross-reference.**
[L-022](#l-022--handoff-notes-and-next-session-prompts-carry-claims-not-facts--verify-against-current-code-before-any-claim-enters-a-dispatchs-plan)
on verifying tooling claims before relying on them — the hint in
`toMatchJSONGolden`'s mismatch message was a tooling claim that
silently no-op'd. L-027 is the operational fix; L-022 is the
disposition that makes you check.

## L-028 — A build stamp pinned to HEAD's commit date can never match a golden that's committed (off-by-one); treat it as volatile. And Radix `useId` goldens can only be refreshed full-suite, not `--grep`-scoped

**Two coupled traps, both surfaced closing the same surface
(`dialog-about`) in the HANDOFF item 16 dispatch.**

### Trap 1 — commit-date build stamp vs committed golden is an unwinnable chase

**Rule.** If a value baked into the app is derived from
`git show -s --format=%cs HEAD` (HEAD's commit date) — e.g.
`BUILD_DATE` in
[`web/apps/editor/vite.config.ts`](../web/apps/editor/vite.config.ts)
— and that value is ALSO captured in a committed golden, the golden
can NEVER stay green by refreshing it. The act of committing the
refreshed golden creates a NEW HEAD with a LATER commit date, so the
next rebuild's `BUILD_DATE` no longer equals the date frozen in the
golden. Each refresh-and-commit cycle leaves the golden exactly one
commit's date behind. **Fix: treat the stamp as volatile and
normalize it to a placeholder before comparison**, on BOTH the live
capture and the golden (so a golden holding a stale literal value
still matches). This is the same disposition as L-024's source-side
StatusBar freeze and the JSON normalizer's `volatile` property list:
build-environment-dependent values don't belong in a byte-exact
assertion.

The pin to commit-date is still the right USER-FACING choice — the
About dialog showing "the date this code was committed" is more
meaningful than "the day someone happened to run pnpm build". The
pin and the normalization are complementary: pin for the human,
normalize for the test. Shipping the pin WITHOUT the normalization
(as the first pass of this dispatch did) passes verification only
while HEAD still sits on the commit whose date the golden recorded —
and silently breaks the moment you commit anything, including the
commit that "fixed" it.

**Implementation.** `normalizeVolatile()` in
[`web/apps/editor/tests/helpers/toMatchJSONGolden.ts`](../web/apps/editor/tests/helpers/toMatchJSONGolden.ts)
runs two regexes over the serialized string (both lanes funnel
through the matcher as strings — YAML for composition, JSON for
HWND):
- `/Build date: \d{4}-\d{2}-\d{2}/g` → `Build date: <DATE>`
  (composition ariaSnapshot inline form)
- `/"Name": "\d{4}-\d{2}-\d{2}"/g` → `"Name": "<DATE>"`
  (HWND UIA standalone text-node form)
Applied to the live value AND the golden at compare time, AND to the
written value in UPDATE mode so the committed golden stores the
`<DATE>` placeholder self-documentingly.

### Trap 2 — Radix `useId` AutomationIds make HWND goldens render-sequence-dependent

**Rule.** The HWND/UIA goldens capture Radix UI components whose
`AutomationId` is a `useId`-generated string like `radix-_r_1k_`.
React's `useId` is a monotonic counter keyed to render ORDER, so the
ID a given dialog gets depends on how many components mounted before
it in the run. In a FULL suite run, `dialog-about` always renders
after the same prior surfaces, so its Radix IDs are stable — and the
committed golden encodes those full-suite values. **Refreshing a
single HWND golden via `pnpm a11y:update --grep dialog-about` (now
that L-027 makes `--grep` actually scope) captures the dialog in
ISOLATION**, where the `useId` counter starts fresh → completely
different Radix IDs → a 150KB structural-looking diff that would only
match in isolation and fail in the full suite.

**Consequence.** The L-027 `--grep` forwarding fix is safe for the
COMPOSITION lane (ariaSnapshot output is role+name, no `useId` IDs)
but NOT for the HWND lane (UIA captures the sequence-dependent IDs).
To change one node in an HWND golden (e.g. swap a literal date for
`<DATE>`), edit the golden file SURGICALLY by hand rather than
`--grep`-refreshing it — that preserves the full-suite Radix IDs.
Full-golden HWND refresh must be done via a FULL-suite
`pnpm a11y:update` (no `--grep`) so the render sequence matches.

**Trigger.** Symptoms:
- A scoped `--grep` golden refresh produces a huge structural diff
  (AutomationIds changing from `radix-_r_<X>_` to different values,
  ControlType/ClassName shifts) — not the small targeted change you
  expected.
- An HWND golden passes in a full lane run but fails when its spec
  is run alone, or vice-versa.

**How to apply.**
1. **Build stamps / timestamps / any build-environment value in a
   golden → normalize as volatile in the matcher.** Don't try to
   keep the literal value fresh; you'll lose the race against your
   own commits.
2. **HWND/UIA golden edits → surgical hand-edit or full-suite
   refresh, never `--grep`-scoped.** Composition/ariaSnapshot golden
   edits → `--grep` is fine.
3. **When you pin a value for user-facing reasons (commit date),
   immediately ask "is this value also in a golden?" If yes, the pin
   alone is insufficient — add the volatile normalization in the
   same change.**

**Source incident (2026-05-29, HANDOFF item 16 follow-up).** The
item-16 dispatch pinned `BUILD_DATE` to the commit date and declared
`dialog-about` fixed "no golden refresh needed — HEAD's commit date
is still 2026-05-26, byte-identical to the golden." True at
verification time (HEAD `6b6e674`), but the two fix/docs commits
advanced HEAD to a 2026-05-27 commit date. A rebuild two days later
(prompted by a session date-rollover) showed `dialog-about` failing
again in both lanes — BUILD_DATE `2026-05-27` vs golden `2026-05-26`.
Fix completed by adding `normalizeVolatile()` to the matcher and
swapping both goldens to `<DATE>`. The HWND golden's first refresh
attempt used `--grep dialog-about` and produced a 150KB Radix-ID
diff (Trap 2); reverted and hand-edited the single date node
instead.

**Cross-reference.**
[L-024](#l-024--uia-golden-non-determinism-webview2-topology-drift--live-react-subscriptions-solve-at-the-source-not-at-the-normalizer)
(volatile content → normalize/freeze, don't assert it),
[L-026](#l-026--byte-exact-snapshot--golden-files-need-an-explicit-text-eollf-rule-in-gitattributes-or-coreautocrlftrue-silently-breaks-every-comparison-on-windows)
(byte-exact goldens + EOL), and
[L-027](#l-027--run-native-testsmjs-silently-drops-unrecognised-cli-args-explicitly-forward-them-so---grep-and-similar-playwright-filters-work)
(the `--grep` forwarding whose scoping created Trap 2's footgun).
The matcher normalizer lives in
[`toMatchJSONGolden.ts`](../web/apps/editor/tests/helpers/toMatchJSONGolden.ts);
the `BUILD_DATE` pin in
[`vite.config.ts`](../web/apps/editor/vite.config.ts).

## L-029 — When debugging rendering/visual fidelity, verify the CORRECT assets are loaded before suspecting the render pipeline

**Surfaced building the `--capture` rendering-fidelity tool.** A user
reported additive particle sprites rendering with "black backgrounds /
hard square edges" in the new-UI (arch-C) vs the legacy 0.2 build. I
built a headless capture, saw the hard edges in the engine's render
target, confirmed they weren't a capture artifact, and then spent
several rounds narrowing the cause to the D3D9 → **D3D9Ex** device
switch (MT-11) and the DComp compositing path — because the particle
*draw* code (`EmitterInstance.cpp`) was byte-identical to v0.2.0, so I
assumed the difference had to be environmental in the render pipeline.

**It wasn't the renderer at all.** The user asked the right question:
*"are you loading the proper mod textures? EmpireAtWarExpanded has the
textures."* The capture loaded the `.alo` via `LoadParticleSystem`
without selecting the mod, so `FileManager` resolved **base-game**
`p_explosion_atlas` / `p_smoke_atlas` instead of the mod's overrides.
Base-game art has different content/alpha → hard-edged quads. Selecting
the mod (`ModManager::SelectMod`, matching the `.alo` path against
`GetMods()`) made the correct 1024×1024 mod textures load, and engine
RT *and* composite both rendered soft — matching 0.2. The D3D9Ex and
DComp theories were red herrings.

**Rule.** For any "looks wrong vs the reference build" rendering bug,
**confirm the exact assets being sampled match the reference's assets
FIRST** — texture name, resolution, format, AND source (base game vs
mod override) — before investigating device/RT/shader/blend state. A
`[texdiag]`-style one-shot log of loaded texture format + dimensions +
mip levels is cheap and decisive; the resolution/format *changing* when
the mod is selected (512² base → 1024² mod here) is the tell. The
editor sets the active mod via the Mods menu before opening files; any
code path that loads a file directly (CLI capture, a test harness, a
script) must replicate that mod selection or it silently renders with
the wrong art.

**Process note.** What kept this from running much longer: checkpointing
with the user instead of grinding rebuild-experiments on the D3D9Ex
theory. The "verify assets first" reflex would have found it in one
step; the user's domain knowledge supplied that reflex. When a
fidelity hunt stalls on "the code is identical but it looks different,"
widen the search to *inputs* (assets, config, active mod), not just
deeper into the pipeline.

---

## L-030 — Before regenerating a11y goldens for a UI change, confirm your change actually renders in a captured surface; and never blanket-`a11y:update` on a machine whose persisted UI state has drifted

**Rule.** A UI change does **not** automatically mean the a11y goldens
need regenerating. First confirm the new element actually appears in a
*captured* surface. If it doesn't, the goldens are unaffected — do not
touch them. And **never** run a blanket `pnpm a11y:update` to "refresh"
goldens on a machine whose persisted UI state differs from the
golden-capture baseline: the native a11y harness shares the host's
**stable** WebView2 user-data folder (`ComputeUserDataFolder` under
`%LOCALAPPDATA%`, [src/host/HostWindow.cpp](../src/host/HostWindow.cpp)),
so any interactive run (e.g. a live smoke) that toggles theme or panel
visibility persists into `localStorage` and pollutes the next capture.
A blanket update then rewrites *every* golden with your machine's
incidental state.

**Trigger.** You add/move a control and reflexively reach for
`pnpm a11y:update`. Symptoms that you're about to corrupt goldens:
- `git diff --stat` after the update shows **many/all** surfaces changed
  by a **uniform** line delta (e.g. "21 files, −64 each"), not just the
  one surface you touched.
- The per-file diff flips unrelated state — `button "Light theme" [pressed]`
  → `button "Dark theme" [pressed]`, or a whole `complementary:` (Spawner)
  subtree appearing/disappearing — none of which is your feature.

**How to apply.**
1. **Check the surface first.** Read the relevant
   `*.golden.yaml` and its driver in
   [`tests/helpers/a11y-surfaces.ts`](../web/apps/editor/tests/helpers/a11y-surfaces.ts).
   The `property-tabs-*` surfaces click a tab but **do not select an
   emitter**, so the inspector shows the "select an emitter" placeholder
   — any control gated behind a selected emitter (texture fields, their
   Browse/palette buttons, most Appearance/Physics inputs) is **not**
   captured. Such changes are golden-neutral.
2. **If a blanket update shows broad uniform drift, STOP and revert**
   (`git checkout -- web/apps/editor/tests/a11y-goldens/`). The drift is
   environmental, not yours.
3. **When a captured surface genuinely changes**, prefer a surgical
   hand-edit of just that golden (mirror the adjacent entry), or
   reproduce the *canonical* persisted state (theme + panel toggles)
   before regenerating — not whatever your last interactive session left
   behind. Composition (`ariaSnapshot`) edits are byte-simple; HWND/UIA
   edits follow [L-028](#l-028) (surgical or full-suite, never `--grep`).

**Source incident (2026-05-29, feature-parity B — texture palette).**
Added a palette button to each emitter texture field, then ran
`pnpm a11y:update` to refresh goldens. `git diff --stat` showed **all 21**
composition goldens changed (−1281/+63). Inspection showed the deltas
were a flipped theme (`Light`→`Dark` `[pressed]`) and the entire Spawner
`complementary:` panel removed from every surface — pollution from the
live-smoke session (dark theme + closed Spawner) persisted in the shared
WebView2 profile. Reading `property-tabs-appearance.composition.golden.yaml`
revealed `tabpanel "Appearance": Select an emitter to edit its properties`
— the texture fields (and the new palette buttons) never render in the
capture because no emitter is selected. **The feature was golden-neutral;
zero golden changes were needed.** Reverted the 21-file "drift" and left
goldens canonical. The harness's shared-profile sensitivity (theme / panel
state / OS `prefers-color-scheme`) is a pre-existing fragility filed as a
follow-up (force a known UI state in the a11y setup).

**Cross-reference.** [L-024](#l-024) (volatile content → freeze/normalize
at the source), [L-026](#l-026) (byte-exact goldens + EOL),
[L-028](#l-028) (build-stamp + Radix `useId` golden hazards). L-030 adds
the upstream check: *does your change even reach a captured surface, and
is the capturing machine in the canonical state?*

**Resolution (2026-05-30, toolbar consolidation).** The "force a known UI
state in the a11y setup" follow-up is now DONE. A `seedCanonicalUiState(page)`
helper in
[`tests/helpers/a11y-surfaces.ts`](../web/apps/editor/tests/helpers/a11y-surfaces.ts)
writes `localStorage["alo:theme"]="light"` + `["alo:spawner-visible"]="true"`,
**reloads** (the spawner-visibility Zustand store reads localStorage at
module-init, so a reload is mandatory for the seed to take — a write without
reload silently no-ops), then waits for `window.bridge`. Every a11y spec's
`beforeAll` calls it (HWND lane: before `discoverHostHwnd`; composition lane:
at the end of `beforeAll`). With the seed in place, a blanket
`a11y:update` across both lanes for a genuine toolbar change produced a
diff limited to the toolbar region (verified: `Dark theme [pressed]` count =
0, `Light theme [pressed]` = 20 across all composition goldens), and two
read-only re-runs were byte-identical. The seed makes blanket regen safe for
changes that DO reach a captured surface — the complement to L-030's
"don't regen if your change doesn't render."

---

## L-031 — Native golden / Playwright runs are single-instance + fixed-port; never run them in parallel

**Rule.** `ParticleEditor.exe` is a single-instance binary and the native
test harness ([`scripts/run-native-tests.mjs`](../web/apps/editor/scripts/run-native-tests.mjs))
always launches it on the **fixed** CDP endpoint `http://localhost:9222`.
Two harness invocations at once (e.g. an a11y regen + an isolated
spec run, or a composition regen + a legacy regen) **collide**: the second
launch's `taskkill /F /IM ParticleEditor.exe` kills the first run's host
mid-flight, both fight over port 9222, and one or both report a spurious
exit 1. Run every native invocation **serially** — wait for one to finish
(and for its host to be torn down) before starting the next.

**Trigger.** Any time you're tempted to background-launch more than one
`run-native-tests.mjs` (or `pnpm a11y* / test:native*`) at once to save
wall-clock — e.g. "regen the legacy lane while the read-only check runs."
The symptom is a confusing exit 1 with errors like "Target page closed",
"host process exited before CDP came up", or a spec failing that passes
when run alone. The collision can also leave `dist/` in the wrong hosting
mode (one run's `--rebuild` flips it under the other's feet).

**How to apply.**
- One native run at a time. If you must check progress, poll the single
  run's output file; don't start a second host.
- After a run that flips `dist/` (`--legacy --rebuild`), rebuild composition
  (`pnpm build`) before the next composition run — and verify
  `dist/build-meta.json` reads the mode you expect (the harness fail-fasts
  on mismatch, but checking first saves a wasted launch).
- UPDATE-mode golden writes are independent of other specs' pass/fail in
  the same run: the a11y matcher writes regardless, so an unrelated flake
  (e.g. `splitters.spec.ts`, L-014) failing in the same suite does NOT
  corrupt or skip the golden regen — but it DOES make the run exit 1, which
  is easy to misread as "the regen failed."

**Source incident (2026-05-30, toolbar consolidation).** Launched the
isolated `splitters` classification, the legacy a11y regen, and the
read-only a11y determinism check as three parallel background tasks. All
three raced for the single host + port 9222; two reported exit 1 with no
real defect. Re-running each serially: splitters passed 6/6 in isolation,
the legacy regen wrote all 29 HWND goldens cleanly (0 a11y failures), and
the two read-only runs were identical (28 passed each). The parallel
"failures" were pure harness collision. Cost: ~15 min of confused triage
that a serial sequence would have avoided.

**Resolution landed (2026-05-30, toolbar-consolidation).** The
"force a known UI state in the a11y setup" follow-up is now implemented:
`seedCanonicalUiState(page)` in
[`tests/helpers/a11y-surfaces.ts`](../web/apps/editor/tests/helpers/a11y-surfaces.ts)
writes `alo:theme=light` + `alo:spawner-visible=true` to `localStorage`,
**reloads**, and re-waits for `window.bridge`. Every a11y spec
(`a11y-{chrome,dialogs,keyboard,curve-spinner}[-composition].spec.ts`)
calls it once in `beforeAll` — HWND lane before `discoverHostHwnd`,
composition lane after the bridge-ready wait. With this in place, a
genuine toolbar change (the pill→toolbar move) could blanket-regenerate
both lanes and `git diff` showed **only** the intended toolbar-region
delta across all 40 goldens — zero theme/panel drift. See L-031 for the
one non-obvious gotcha (the reload is load-bearing).

---

## L-031 — Seeding `localStorage` for a deterministic capture is useless without a reload; module-init reads don't see late writes

**Rule.** When you force UI state by writing `localStorage` keys before a
capture (the L-030 fix), you **must reload the page afterward**. State that
a module computes **once at import time** — e.g. the spawner-visibility
Zustand store's `readInitial()` in
[`src/lib/spawner-visibility.ts`](../web/apps/editor/src/lib/spawner-visibility.ts),
or any `useState(() => readInitial())` — is already latched by the time your
`page.evaluate(() => localStorage.setItem(...))` runs. Writing the key does
nothing visible until React re-mounts. The seed helper therefore does
`setItem(...)` → `page.reload(...)` → re-wait for `window.bridge`, in that
order. Theme (`alo:theme`, read in a `useState` initializer in
[`ThemeToggle.tsx`](../web/apps/editor/src/components/ThemeToggle.tsx)) has the
same property.

**Trigger.** Any "seed state then capture/assert" helper against a
WebView2/React app where the state source reads `localStorage` at
module-init or in a `useState` initializer (not on every render). Symptom if
you forget the reload: the seed appears to do nothing — the capture still
reflects whatever state the app booted with, and a blanket golden regen
still drifts exactly as L-030 warns.

**How to apply.**
1. `await page.evaluate(() => { localStorage.setItem(k, v); ... })`.
2. `await page.reload({ waitUntil: "domcontentloaded" })`.
3. Re-wait for the app to be ready (`window.bridge` defined) — the reload
   tore down the previous context.
4. Verify by the L-030 gate: regen and confirm `git diff` is limited to your
   intended change. Zero unrelated drift = the seed took.

**Source incident (2026-05-30, toolbar consolidation).** First draft of
`seedCanonicalUiState` wrote the two keys but the initial version under
consideration omitted the reload; reasoning through the spawner store's
module-level `readInitial()` (and ThemeToggle's `useState(() => …)`) showed
the write would be invisible until remount. Added the reload + bridge re-wait
up front; the subsequent both-lane regen produced a clean, drift-free 40-file
diff on the first try.

**Cross-reference.** [L-030](#l-030) (the broader "don't blanket-regen on a
polluted machine" rule this implements the fix for); [L-006](#l-006) (a
different React-state-timing trap — optimistic overrides cleared too eagerly).

---

## L-032 — The vertex declaration (and stream sources, FVF, index buffer) is NOT in the `ID3DXEffect` state block; a render pass that binds its own must restore it, or following fixed-function draws inherit it and lose per-vertex diffuse → default white

**Rule.** `ID3DXEffect::Begin(&passes, 0)` saves/restores **device render
states, texture-stage states, sampler states, textures, and shaders** — the
states the effect's technique sets. It does **NOT** save the **input-assembler**
state: vertex declaration, FVF, stream sources, or index buffer. Those are
app-managed. So any render pass that calls `SetVertexDeclaration` /
`SetStreamSource` / `SetIndices` (even one driven by an `ID3DXEffect`) **must
restore them itself**, or they leak into every subsequent draw in the frame. The
trap is worst with **fixed-function** consumers: if the leaked declaration lacks
a `D3DDECLUSAGE_COLOR` element, the FF pipeline has no diffuse stream and
defaults every vertex's colour to **white (0xFFFFFFFF)**.

**Why this is sneaky.** The symptom looks like a *blend* bug, not a vertex-format
bug: additive particles blow out to white (white + dst), alpha particles render
white-tinted. Every render-state probe you reach for (ALPHABLENDENABLE, SRC/DEST
blend, tex-stage ops, fog, lighting, TEXTUREFACTOR, shaders) comes back
**byte-identical** with vs without the offending pass — because the leaked state
is the *vertex declaration*, which those probes don't cover and which the effect
state-block silently doesn't protect. Geometry that already uses white vertices
(e.g. a fully-lit ground quad with `D3DCOLOR_RGBA(255,255,255,255)`) is
unaffected, so the bug appears scoped to "some draws" and misdirects toward a
per-object blend/material theory.

**How to apply.**
- When adding a render pass that binds a non-default vertex declaration / stream
  / indices, save+restore them, the same way you save+restore render states.
  Pair every `SetVertexDeclaration(custom)` with a restore of the prior one
  (`GetVertexDeclaration` AddRefs — `Release` after restoring).
- When debugging a "looks like a blend/colour bug only in some draws," and the
  render-state probe shows **identical** state, suspect the **input-assembler**
  state (vertex declaration / FVF / streams) — it is invisible to render-state
  introspection and to `ID3DXEffect` save/restore.
- Diagnostic tell: the affected geometry is exactly the geometry that relies on a
  **per-vertex diffuse colour**; geometry with white vertices is spared.

**Source incident (2026-05-30, skydome → particle alpha bug).** A background
skydome (MT-3) made additive explosion particles blow out to a white dome over
the ground; solid-colour background was fine. Filed (and initially theorised) as
"`RenderSkydome` leaves a D3D9 **blend** state dirty — add a save/restore." An
instrumented headless `--capture` (new `--skydome <slot>` flag) plus a widened
per-draw device-state probe proved every render state, the particle count, and
`dt` were **identical** slot-0 vs slot-5 — refuting the blend-leak, dest-alpha,
bloom, and timing theories in turn. The leak was
[`Engine::RenderSkydome`](../src/engine.cpp:2002) binding `m_pSkydomeDecl`
(`SkydomeVertex`: position/normal/texcoord, **no colour**) and never restoring
it; the engine's real `m_pDeclaration` is set only at device-reset
([engine.cpp:1706](../src/engine.cpp:1706)), not per frame, so the ground +
particle draws inherited the skydome declaration → FF default-white diffuse →
additive blowout (and white-tinted alpha particles). The ground was spared
because its vertices are already white — which is *why* it masqueraded as a
skydome-only blend issue. Fix: 4-line `GetVertexDeclaration`/`SetVertexDeclaration`
save-restore around the skydome pass, mirroring its existing Z/cull save-restore.
Verified via the same `--capture --skydome 5`: blob `230,228,223` (white) →
`94,73,51` (orange = control); %white 6.2 → 0.0.

**Cross-reference.** [L-007](#l-007--dont-paper-over-an-engine-bug-by-changing-what-a-test-asserts)
(the D3D9 canary/probe + verify-in-situ pattern that cracked this — and the same
"identical render-state, narrow your assumptions" discipline). The `--skydome`
capture flag added for this diagnosis is kept as a regression tool.

---

## L-033 — Agent-driven native launches misrender arch-C compositing (~4 FPS, engine fills the window); verify the DComp path via host.log + the user, not your own screenshots

**Rule.** When the host is launched from the agent's shell (`Start-Process`,
the native a11y harness, etc.) in this environment, arch-C DComp compositing is
unreliable: the engine visual renders at a few FPS and is NOT clipped to the
scene rect (it fills the whole window; the WebView2 chrome reads as
transparent). `dxgi-perf` measured **4.3 FPS** (floor 30) under the a11y harness;
manual `Start-Process` launches showed the engine covering the full window with
ghosted panels. The SAME binary launched normally by the user composites
correctly (panels opaque, scene clipped to the viewport). So an agent screenshot
of the running editor is NOT a faithful picture of what the user sees — treat it
as broken, not as evidence.

**How to apply.**
- For any arch-C **visual** change (compositing, layering, transparency,
  backing, scene-rect, occlusion), verify the *mechanism* host-side via
  `host.log` instrumentation (`%LOCALAPPDATA%\AloParticleEditor\host.log` —
  e.g. `[COMP-backing]`, `[COMP-engine-transform]`, `[COMP-engine-frame]`
  lines), plus a CDP `Runtime.evaluate` read of the web-side value, plus
  unit/golden coverage — then ask the **user** to confirm the on-screen result.
  Say so explicitly in the handoff; don't claim a visual is verified from an
  agent screenshot.
- Do NOT regenerate a11y goldens or trust `dxgi-perf` / `dxgi-transport` /
  `dxgi-scene-rect` pass/fail on this machine — the degraded FPS + compositing
  make the native lane noisy (compounds the documented L-014 splitters flake and
  the L-024 UIA non-determinism). CI / the user's machine is the authority.
- Distinguish "my change broke X" from "the env is broken" by structural
  argument: a zero-DOM change can't move UIA goldens; an engine-path edit that
  was a no-op in the run (check the `[COMP-engine-attach]` count == 1, no
  re-attach) can't have caused engine-frame failures.

**Source incident (2026-05-30/31, theme-coloured composition backing).** Building
the rear backing visual (commit `a545559`), I repeatedly tried to screenshot
the editor to confirm the corner wedges turned `--bg`; every agent-driven launch
showed the engine filling the window at ~4 FPS with transparent panels — nothing
like the user's correctly-composited screenshot from the same session. Wasted
~two launch/capture cycles before pivoting to host.log + CDP verification (which
cleanly proved the backing was created rearmost-behind-engine and recoloured
`#ECECEC`/`#111111`) and handing the on-screen check to the user, who confirmed it
looked right. The native a11y lane's 9 failures were all env/known-flake, zero
attributable to the change.

---

## L-034 — A "compositor seam" can be a transparent DOM element's own antialiased edge; isolate the LAYER by recolouring each candidate, then confirm by hiding the element

**Rule.** When a thin uniform line appears at a boundary in a layered
compositor (DComp engine visual + WebView2 + backing), do **not** assume the
compositor drew it. Isolate the contributing *layer* before theorising a
mechanism: recolour each candidate source in turn and watch the line. If the
line ignores every layer recolour, the source is *in front of* all of them —
i.e. the WebView2/DOM raster itself. A transparent DOM element whose box lands
on a **fractional sub-pixel** boundary gets its edge antialiased by Chromium
against the browser's (white) compositor base, yielding a neutral, opaque,
theme-independent ~50%-coverage grey (≈`#C0C0C0`) exactly 1px wide at the
element's first row/column. That looks identical to a "compositor clip seam"
but is pure DOM-layer AA.

**How to apply (the elimination sweep that worked).**
- **Engine vs downstream:** read back the engine's own RT at the boundary
  (host-side staging copy / the headless `--capture` engine-RT PNG). Clean RT
  ⇒ engine innocent; the pixel is injected downstream.
- **Which layer:** over CDP, recolour each layer to a vivid distinct colour and
  re-measure the line — rear backing (`host/backing-color`), engine clear
  (`engine/set/background`), WebView2 page bg (`html/body/#root background`).
  Line unchanged by all ⇒ it's the DOM raster in front.
- **DComp clip-edge AA:** test `IDCompositionVisual2::SetBorderMode(HARD)` on
  the clipped visual. No change (by *measured* pixels, not by eye) ⇒ not clip AA.
- **Which element:** inset / hide each transparent overlay (`display:none`) and
  measure. The one whose removal kills the line with the interior
  **pixel-identical** is the source.
- **Fix at the source:** if the element is vestigial in the active mode, stop
  rendering it (gate the JSX) rather than masking the line — masking is the
  reverted-first-attempt trap.

**Measure, don't eyeball.** A `SetBorderMode(HARD)` A/B "looked fainter" but a
faithful `HWND_TOPMOST` + `CopyFromScreen` grab measured with PIL showed the
edge pixel was *byte-identical* `(192,192,192)` — the perceived change was an
illusion. Every go/no-go in this hunt came from a measured grab, never a glance.
The whole investigation was screenshot-driven because L-033 makes agent-launched
arch-C compositing unreliable; the faithful-grab recipe (target the new-UI PID,
force topmost, CopyFromScreen over GetWindowRect, drop topmost; never
MoveWindow/maximize) is the workhorse.

**Source incident (2026-05-31, session 4, the 1px viewport edge seam).** The
`#C0C0C0` viewport frame was theorised across two sessions as a WebView2 fringe,
an engine clip artifact, and a DComp seam. The elimination sweep above refuted
all three and pinned it to the empty `<img data-testid="viewport-img">` overlay
in [`ViewportSlot.tsx`](../web/apps/editor/src/components/ViewportSlot.tsx) — a
vestigial arch-A JPEG surface, never painted under the arch-C default (its
`viewport/frame-ready` consumer early-returns in composition mode), whose only
effect was AA on its fractional-origin (`x=335.05`) edge. Fix: render it only in
`!compositionMode`. A prior session's "1px engine-clip inset" fix had been
reverted for resting on an unverified assumption — this time the cause was proven
before the fix. Cross-reference [L-033](#l-033) (verify arch-C visuals via
host.log + CDP + user, not agent screenshots) and the systematic-debugging
"isolate the failing component before proposing fixes" discipline.

---

## L-035 — Profile per-stage before optimising a render loop; code-reading (and the author's own comments) mis-point. Instrument the frame, measure ratios + area-scaling, then fix the proven stage

**Rule.** For a "feels slow" performance complaint, do NOT optimise the stage
your code-reading (or an existing in-code comment) fingers. Add cheap per-stage
timing to the actual hot loop, capture it under a realistic run, and let the
**measured** dominant stage — and how it scales with the trigger variable
(here: window area) — pick the target. `QueryPerformanceCounter` deltas around
each stage, accumulated and logged at 1 Hz, are ~free and decisive. Only after
the data names the stage do you design the fix; re-measure to prove it.

**Trigger.** Any perf task where you're tempted to jump straight to a fix
because the cause "is obviously X." Symptoms you're about to mis-spend effort:
- An in-code comment asserts where the cost is (e.g. *"the spin in
  WaitEndFrameQuery dominates"*) and you're inclined to trust it.
- The complaint correlates with a variable (window size, item count) — that
  correlation is the *measurement axis*, not a diagnosis.
- You have a clean architectural story for why stage X is slow but no numbers.

**How to apply.**
1. **Instrument the loop, gated cheap or always-on.** Per-stage QPC deltas →
   `sum/max/count` accumulators → one log line per second. On this project
   that's the `[PERF]` (host stages) + `[PERF2]` (engine `Render()` sub-passes)
   lines in [`HostWindow.cpp`](../src/host/HostWindow.cpp) / engine timings via
   `Engine::GetLastRenderTimings()`.
2. **Read ratios + scaling, not absolutes** — especially under a launch you
   can't fully trust (L-033). The stage whose `avg` grows ≈linearly with the
   trigger variable is the culprit, regardless of headline FPS.
3. **Sub-profile the winning stage** before guessing *why* — one level of
   timing inside the hot function usually collapses the search to a single line.
4. **Fix the proven stage; re-measure.** Confirm the cost drops AND watch where
   the bottleneck *shifts* (a shifted bottleneck that's now irrelevant means
   stop, don't keep optimising).

**Source incident (2026-05-31, arch-C "janky when maximized").** Code-reading
produced two confident priors — the `WaitEndFrameQuery` busy-spin (the engine
author's own comment called it dominant) and the cross-device `CopyResource`.
`[PERF]` timing refuted **both**: each was ~45 µs and ~flat with area, while
`engine->Render()` was 96–99% of the frame and scaled dead-linearly with pixel
count. `[PERF2]` sub-profiling of Render() then pinned the entire cost to the
`present` segment — the synchronous `AlphaCompositor::Composite()`
`GetRenderTargetData` readback + 19 MB `memcpy`, a redundant arch-A/B
layered-window transport still running every frame under arch-C (the DComp
shared-texture path is the real transport). Gating it out in composition mode
([`Engine::SetCompositionMode`](../src/engine.h:148)) took maximized from ~90 to
~2380 FPS (≈26×) and flattened the area-scaling; the bottleneck then *shifted*
to the now-exposed `WaitEndFrameQuery` spin (~385 µs), left untouched because
at 2380 FPS it's a non-problem. Had the first instinct (fix the spin) been
followed, it would have optimised a 45 µs stage and left the 10 ms readback in
place. Cross-reference [L-029](#l-029) (verify inputs before suspecting the
pipeline — same "widen from the assumed cause" discipline) and
[L-032](#l-032) (identical render-state ⇒ the cost is in the dimension your
probe doesn't cover).

---

## L-036 — Match here-string syntax to the *tool's* shell, not the OS default; the Bash tool is bash even on Windows

**Rule.** This environment exposes two shells through two different tools: the
PowerShell tool runs `powershell.exe` (PowerShell 5.1), the Bash tool runs
`bash`. Here-string / quoting syntax is **not** interchangeable. PowerShell's
literal here-string is `@'…'@`; bash has no such construct. Pick the multiline
quoting form that matches whichever tool you're invoking — or sidestep the issue
entirely by writing the text to a file and passing `-F <file>`.

**Trigger.** Any command that feeds a multiline string to a native exe — most
commonly `git commit -m`, but also `gh pr create --body`, `git tag -m`, etc.
Especially easy to get wrong because the PowerShell tool's own description
documents `@'…'@` prominently, so it's primed in memory when you reach for the
Bash tool next.

**How to apply.**
1. **Default to a message file for any multiline commit/PR body**, regardless of
   shell: `Write` the text, then `git commit -F .git-commit-msg.tmp` (delete the
   temp after). Shell-agnostic, no quoting hazards, and the message is reviewable
   before it lands.
2. If you do inline it: PowerShell tool → `@'…'@` (closing `'@` at column 0);
   Bash tool → a single `-m $'…'` or a quoted heredoc. Never paste `@'…'@` into
   the Bash tool — bash treats the `@` as a literal character.
3. **Verify the subject after committing** — `git log -1 --pretty=%s`. A stray
   leading character (e.g. `@ docs(tasks): …`) means the wrapper leaked into the
   message; amend with `--amend -F` before pushing.

**Source incident (2026-06-01).** A `git commit -m @'…'@` issued through the
**Bash** tool produced a subject line of `@ docs(tasks): reconcile …` — bash
took the PowerShell here-string delimiters literally, prepending `@\n` and
appending `\n@`. Caught by reading the commit output, fixed with
`git commit --amend -F .git-commit-msg.tmp` before the fast-forward into `lt-4`,
so the mangled message never reached `origin`.

---

## L-037 — In the arch-A→arch-C/bridge migration, a feature that *renders* can still be behaviourally dead: the new path often reimplemented a chokepoint and silently dropped a side effect the legacy version performed

**Rule.** When a new-UI feature "draws but doesn't work," don't trust that the
bridge handler does what the legacy code did just because the visible output
matches. The React rewrite frequently reimplemented a shared chokepoint and kept
only its *primary* job, dropping a quiet *side effect* the legacy version folded
in. The view state (what the gutter/badge reads) is set, so it *looks* wired; the
behavioural invariant the side effect enforced is gone. Diff the legacy chokepoint
against the new one for side effects, not just the headline mutation.

**Trigger.** Any "the new UI shows X but X has no effect" report, especially where
a host model + API already exist and the React side clearly sends a command.
Tells: the legacy version routed through a single function (`CaptureUndo`, a
WM_COMMAND handler) that did N things; the new version split that across per-handler
lambdas; the rendered indicator reads a raw field (`node.linkGroup`) that the new
path *does* set.

**How to apply.**
1. Find the legacy chokepoint the feature flowed through and **enumerate every
   side effect** it performed (propagation, normalisation, cache invalidation,
   re-sync), not just the obvious mutation.
2. For each side effect, check whether the new bridge path performs it. Watch for
   **timing inversions** — legacy `CaptureUndo` propagated *then* snapshotted
   (post-edit); the bridge `captureUndo` lambda snapshots *pre*-mutation, so a
   bolted-on propagation must run after the mutation, not inside the snapshot.
3. If the side effect must fire on *every* edit, enumerate **all** handlers that
   make that class of edit (here: the 6 shared-field handlers) — there's usually
   no single post-mutation chokepoint in the bridge, so the call is explicit and
   easy to miss one.

**Source incident (2026-06-01, F4 "link groups draw but don't link").** Brackets
rendered off `node.linkGroup` (set), but linking had no effect. Two dropped side
effects: `linkGroups/set-membership` stamped `e->linkGroup` instead of calling
`CreateLinkGroup`/`JoinLinkGroup` (no field sync on link), and per-edit
propagation — performed by legacy [`CaptureUndo`](../src/main.cpp:864) for *every*
edit — was absent from the bridge's pre-mutation `captureUndo` lambda. Fix:
drive the `LinkGroup.h` API in set-membership + a `propagateLinkGroup` call in all
6 shared-field handlers. Cross-reference [L-035](#l-035) (code-reading mis-points;
here the *absence* in the new path is the bug) — both say: verify the new path's
actual behaviour against the legacy one, don't assume parity from a matching surface.

---

## L-038 — Native bridge-handler logic is gated by the native Playwright spec suite (`pnpm a11y`), NOT by vitest + a clean build; run it before pushing host changes

**Rule.** A change to a `BridgeDispatcher.cpp` (or any host-side) handler can pass
`vitest` (which exercises only the **mock** bridge + React) AND compile cleanly,
yet still be wrong against the **real** host. The native `tests/*.spec.ts` suite
(`emitter-mutations`, `bridge-native`, splitters, a11y goldens) driven over CDP by
`pnpm --filter @particle-editor/editor a11y` is the real gate for host behaviour.
Run it before pushing host-logic changes — not just `vitest` + `MSBuild`.

**Trigger.** You edited a `linkGroups/*`, `emitters/*`, or other bridge handler
and are about to FF→`lt-4`/push on the strength of "vitest green + build clean."
Tells you're about to ship an unverified host change:
- The change alters a handler's *contract* (what payloads it accepts, what it
  mutates), but the only tests you ran hit the mock (`mock.ts`), which has its own
  independent implementation that didn't change.
- The behaviour is only observable through the real `ParticleSystem` (link-group
  membership, undo atomicity, curve propagation), which the mock only approximates.

**How to apply.**
1. For host-logic changes, build **Debug** too (the a11y harness launches
   `x64\Debug\ParticleEditor.exe --test-host`) and run `pnpm --filter
   @particle-editor/editor a11y` before pushing.
2. Read the failures by spec: native-behaviour specs (`emitter-mutations`,
   `bridge-native`) failing = a real host regression to fix; `splitters`
   percentage failures are usually the agent-launch window-size artifact (L-033),
   not your change — confirm via `git log` that you touched no layout code.
3. If you can't run the native suite in the current environment, say so and hand
   the verification to the user — don't pass off vitest+build as full coverage.

**Source incident (2026-06-01, F4 set-membership).** The F4 link-group fix passed
vitest (384) + Release/Debug builds, so it was FF'd to `lt-4` and pushed. A later
`pnpm a11y:update` run (for an unrelated F1 golden) surfaced that the rewrite had
narrowed the bridge contract — routing the positive-id path through `JoinLinkGroup`
(which refuses a non-existent group) silently no-op'd "assign to an explicit new
group id", which the mock still supported. The native `emitter-mutations` NT-5
spec caught it; vitest never could (the mock has its own `setLinkGroupMembership`).
The bug was live on `origin/lt-4` between two pushes. Cross-reference
[L-031](#l-031) (native runs are single-instance + fixed-port; serial) and
[L-033](#l-033) (agent-launched native runs differ from the user's).

## L-039 — On a fresh git worktree the `.sln` NuGet restore fails with no `nuget.exe` on PATH; materialise the cached package into the solution-local `packages/` layout instead of bootstrapping a tool

**Trigger.** First `.sln` build in a freshly-provisioned worktree (or any clean
checkout) dies with `error : This project references NuGet package(s) that are
missing on this computer` — the missing file is
`packages\Microsoft.Web.WebView2.<ver>\build\native\Microsoft.Web.WebView2.targets`.
The handoff says "restore NuGet first," but doesn't say how when the box has no
`nuget.exe` (`where.exe nuget` / `(Get-Command nuget)` both empty) and the projects
use **`packages.config`** (so `msbuild -t:Restore`, which only handles
`PackageReference`, won't help either).

**How to apply.**
1. Read the `packages.config` files (`src/`, `src/host/`, `src/host/spike/`) for the
   exact `id` + `version`. Here: only `Microsoft.Web.WebView2 1.0.3967.48`.
2. The package is almost always already in the **global** cache from a prior
   machine-wide restore: `~/.nuget/packages/<id-lowercased>/<version>/` (e.g.
   `microsoft.web.webview2/1.0.3967.48/`). Confirm the `build/native/*.targets`
   exists there.
3. Copy that folder's contents into the **solution-local** `packages.config` layout
   — `packages/<Id>.<Version>/` (PascalCase id, e.g.
   `packages\Microsoft.Web.WebView2.1.0.3967.48\`). The extracted contents
   (`build/`, `lib/`, `runtimes/`, …) map 1:1; the only difference is the folder
   name casing/flattening. Verify the `.targets` lands, then rebuild.
4. Don't download a `nuget.exe` just for this — the cached package is already on
   disk; copying it is faster and offline-safe. (`packages/` is git-ignored, so this
   is per-worktree and never committed.)

**Source incident (2026-06-01, audit-P1 worktree).** Building the `.sln` for the
F1–F5 fixes failed on the missing WebView2 `.targets`; no `nuget.exe` anywhere,
`packages.config` projects. Copying
`~/.nuget/packages/microsoft.web.webview2/1.0.3967.48/*` →
`packages/Microsoft.Web.WebView2.1.0.3967.48/` restored the build (Debug+Release
x64 clean) with no tool bootstrap. Cross-reference [L-023](#l-023)/[L-025](#l-025)
(build the `.sln`, not the `.vcxproj`).

## L-040 — Launching the `--new-ui` editor needs the React `dist` built (`pnpm build`); the native `.sln` build alone serves nothing and the WebView shows `ERR_NAME_NOT_RESOLVED` for `app.local`

**Trigger.** On a fresh worktree (or any checkout where `web/apps/editor/dist/`
was never produced), launching `x64\Release\ParticleEditor.exe --new-ui` opens a
WebView2 window showing Edge's *"Hmmm… can't reach this page — app.local's server
IP address could not be found. ERR_NAME_NOT_RESOLVED."* The native binary started
fine (device created, shaders loaded — `host.log`/stdout looks healthy); the
failure is purely that the UI content isn't on disk.

**Why.** The host serves the React app from a **local folder via a virtual-host
mapping**, not a dev server: production maps `app.local` →
`web/apps/editor/dist/` (`SetVirtualHostNameToFolderMapping`,
[HostWindow.cpp:243](../src/host/HostWindow.cpp:243), constant
`kVirtualHostName = L"app.local"` at :87). When `dist/` is missing, the navigation
to `https://app.local/index.html` falls through to real DNS, which can't resolve
`app.local` → `ERR_NAME_NOT_RESOLVED`. The `.sln` build produces the *host*; the
*content* it serves is a separate Vite build.

**How to apply.** Before launching `--new-ui`, build the web app:
`pnpm --filter @particle-editor/editor build` (from `web/`). This is the same
command as the vitest-adjacent baseline build — it emits `dist/index.html` +
`dist/assets/*`. After it exists, relaunch (a stale instance pointed at the missing
folder won't recover cleanly — kill and relaunch rather than just Refresh). A
fully-loaded launch logs the React-side viewport reposition
(`SetSceneViewport x=335 y=71 …` inside the panel layout) and
`AcceleratorBridge registered N combo(s)` — absent on a content-less launch.

**Two builds, not one.** A fresh worktree needs BOTH halves to *run* the editor:
the native `.sln` (host binary, + L-039 NuGet restore) AND `pnpm build` (the
served `dist`). Native-only changes (e.g. the F1–F5 fixes) compile and pass a11y
without `dist`, which is why this is easy to forget when the task is native-only —
but you can't *launch* the GUI without it.

**Source incident (2026-06-01, session 8).** Verifying the audit-P1 GUI round-trip:
built the `.sln` Release clean, launched `--new-ui`, hit `ERR_NAME_NOT_RESOLVED`
for `app.local`. Root cause was the un-built `dist` (the session had only done the
native build, since F1–F5 were native-only). `pnpm --filter
@particle-editor/editor build` + relaunch fixed it; the editor then loaded fully
and the round-trip passed. Cross-reference [L-033](#l-033) (agent launches
misrender — the user drives the actual round-trip).

## L-041 — Debug new-UI (React) bugs in browser mode (`pnpm dev` + MockBridge) to sidestep L-033; and for colour pickers that may overlay the arch-C viewport, prefer a native `<input type="color">` over a Radix DOM popover

**Trigger.** A user reports a new-UI bug you can't see, because agent-launched native
runs misrender arch-C (L-033). Two such bugs landed 2026-06-01: the Ground "Solid
colour" option "didn't raise a colour picker", and there was "no ground-height
parameter."

**How to apply — reproduce in the browser, not the host.** The React app +
`primitives/` (incl. the `ColorButton` Radix picker) are *pure React* — they run in a
normal browser via `pnpm dev` against the TypeScript MockBridge, exercising the exact
component tree the WebView2 host loads, **without** the arch-C compositing. Use the
`preview_*` tools: `preview_start` (launch config `editor`, port 5173), then drive the
DOM. **A bug that reproduces in browser is a React bug; one that doesn't is either
native-host-specific or a user-interaction/discoverability issue.** The solid-colour
picker opened *fine* in browser — which immediately ruled out a logic bug and pointed
at discoverability and/or native occlusion. This three-layer split is the template:
**vitest** proves the bridge contract, **browser preview** proves the interaction,
the **user** confirms only what neither can (does the OS dialog paint over the live
viewport).

**Gotcha — `preview_click` doesn't reliably toggle a Radix popover.** Radix
`Popover.Trigger` opens on `pointerdown`; the preview tool's plain `.click()` can fail
to latch it (especially after the open/closed state gets confused by repeated clicks).
Drive it from `preview_eval` with real pointer events instead:
`btn.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); …('pointerup'…); btn.click();`
then `await` a frame and read the *portaled* dialog (`[role="dialog"]`) from
`document`, not from a subtree. Also: scope element queries to the open dialog — a bare
`querySelector('button[aria-label="Increment"]')` grabs the *first* spinner on the page
(e.g. a Spawner field), not the one in your dropdown.

**Design rule — native OS picker beats a DOM popover over the viewport.** In arch-C the
engine viewport composites over the WebView except where a DOM element is
occlusion-registered (`OccludingPopover` / `useViewportOcclusion`). A Radix
`Popover.Content` is portaled to `document.body` and is **not** occlusion-registered, so
if it overlaps the viewport it renders *behind* the live 3-D view — present but
invisible. `BackgroundPicker` avoids this by triggering a native `<input type="color">`
(an OS dialog — a separate always-on-top window, immune to compositing). When a
toolbar/dropdown colour control can overlay the viewport, mirror that pattern rather
than nesting a Radix colour popover. (Whether other Radix colour popovers — Lighting,
etc. — are actually occluded natively is unverified; check via the user before
assuming, and fix only if confirmed.)

**Source incident (2026-06-01, session 8).** Fixed both ground bugs in
`GroundTexturePanelBody` by mirroring `BackgroundPicker` (wide tile → native colour
input) and porting the missing height `Spinner` to the existing `engine/set/ground-z`.
vitest 386 + build clean + browser-verified (picker fires from the tile, height
round-trips and disables with the ground toggle). Native OS-dialog-over-viewport paint
left to the user (L-033). Cross-reference [L-033](#l-033), [L-040](#l-040).

## L-042 — A `D3DPOOL_DEFAULT` texture cannot be `LockRect`'d unless it is ALSO `D3DUSAGE_DYNAMIC`; the MT-11 `MANAGED → DEFAULT` migration silently broke any manual lock-and-fill texture

**Trigger.** A procedurally-built texture (lock the surface, write pixels) stops
working **only under D3D9Ex / arch-C**, while textures loaded via D3DX in the same
code path keep working. Symptom 2026-06-01: the solid-colour ground slot never applied
in `--new-ui` (engine fills `CreateSolidColorTexture`'s 1×1 texture by hand), but
Dirt/Grass/Sand/Snow (D3DX-loaded) did.

**Root cause — two D3D9 rules collide.** (1) **D3D9Ex rejects `D3DPOOL_MANAGED`**, so
the arch-C migration ([MT-11]) moved hand-built textures to `D3DPOOL_DEFAULT`. (2) But
a **`D3DPOOL_DEFAULT` texture is not lockable** unless created with `D3DUSAGE_DYNAMIC`
— `LockRect` returns `D3DERR_INVALIDCALL` otherwise. The migration satisfied (1) and
silently violated (2): `LockRect` failed → the create-helper returned false → the
texture was never built → the feature silently no-op'd. It had worked under the old
MANAGED pool *because MANAGED textures are lockable*. The fix is `D3DUSAGE_DYNAMIC`
(+ `D3DLOCK_DISCARD` for the full rewrite) on the `CreateTexture` call
([engine.cpp:1130](../src/engine.cpp:1130)).

**Why D3DX loads were unaffected.** `D3DXCreateTextureFrom*` manages pool/usage and
the upload internally (staging + `UpdateTexture`), so it never does a manual
`LockRect` on a non-dynamic DEFAULT texture. Only *hand-filled* textures hit the rule.
This is the discriminator that localised it: bundled (D3DX) worked, procedural didn't.

**How to apply.** When porting a lock-and-fill texture to D3D9Ex, you cannot just swap
`MANAGED → DEFAULT` — you must EITHER add `D3DUSAGE_DYNAMIC` (lockable DEFAULT;
recreate on device-Reset, which D3D9Ex needs anyway) OR keep a `D3DPOOL_SYSTEMMEM`
staging surface and `UpdateTexture` into a DEFAULT one. Grep for `LockRect` write-locks
(non-`D3DLOCK_READONLY`) on `D3DPOOL_DEFAULT` textures whenever a `MANAGED → DEFAULT`
change lands. (Render targets — `D3DUSAGE_RENDERTARGET` — are read back via
`GetRenderTargetData` to SYSTEMMEM, not `LockRect`, so they're a different path.)

**Scope.** `[lt-4]`-only — master still uses the lockable MANAGED pool, so its solid
ground colour works; this regressed only on the arch-C branch. Same root-cause family
as audit **F6** (D3DPOOL_MANAGED under D3D9Ex). Cross-reference [L-033](#l-033) (the
visual confirm was user-driven — agent can't see arch-C render).

**Source incident (2026-06-01, session 8).** Diagnosed by localising with the user
("bundled textures apply, solid never switches") → the divergence pointed at the
solid-specific `CreateSolidColorTexture` lock path, not the React handler (the React
dispatch was browser-confirmed). One-line fix; user-confirmed working in `--new-ui`.

## L-043 — New `BridgeDispatcher` mutation handlers must sit AFTER the `captureUndo` lambda (defined partway through `DispatchInternal`), not next to the read-only handler they're conceptually near

**Trigger.** Adding an `emitters/*` handler that needs undo, placed next to a related
read-only handler, fails to compile: `error C3861: 'captureUndo': identifier not
found`. Yet other handlers in the same giant function call `captureUndo()` fine.

**Why.** `BridgeDispatcher::DispatchInternal` is one ~3000-line function dispatching by
`kind`. Its helpers are **local lambdas defined inline, not members**:
`markDirty` is defined early ([BridgeDispatcher.cpp:861](../src/host/BridgeDispatcher.cpp:861)),
but `captureUndo` is defined much later (~line 2501), right before the cluster of
mutation handlers. A handler placed *above* the `captureUndo` definition (e.g. next to
`emitters/preview-from-file` at ~2179) can see `markDirty` but **not** `captureUndo` —
it's not yet in scope. The compile error is the only signal; there's no member named
`captureUndo` to fall back on (`grep "void.*captureUndo"` returns nothing — it's a
lambda, which is why a quick header check misleads).

**How to apply.** Place any new mutation handler that needs `captureUndo` **with the
other mutation handlers** (after the lambda's definition — near `emitters/duplicate` /
`emitters/delete`), not next to the read-only sibling its `kind` resembles. When unsure
whether a dispatcher helper is a member or a position-dependent local lambda, grep for
`auto <name> = [` — if it's a lambda, ordering within the function matters.

**Two adjacent notes from the same task (G1 import handler).** (1) The host is a
**single binary** linking both the legacy UI (`src/UI/`, `main.cpp`) and `src/host/`,
so handler code can call UI-layer helpers like `GenerateDuplicateName` that are already
`extern`-declared in `BridgeDispatcher.cpp` — but keep *data-layer* methods
(`ParticleSystem.cpp`) UI-free by injecting such helpers as `std::function` callbacks.
(2) Response-shape drift: `emitters/list` returns its tree under **`root`** while
`emitters/preview-from-file` uses **`tree`** — mind the field when writing specs that
read both. Cross-reference [L-038](#l-038) (native logic gated by `pnpm a11y`).

## L-044 — A bridge handler backing a dialog with inline error UI must report hard failures via `sendErr` (envelope `ok:false` → promise REJECTS), not nested `sendOk{ok:false}` (which RESOLVES as success); and a count-only test assertion can be blind to structural correctness

**Two findings from the adversarial review of the G1 import handler, both worth
internalising for the next bridge handler + its test.**

**1. `sendErr` vs nested `sendOk{ok:false}` (the G3 trap, made concrete).** `sendOk`
wraps data in an envelope with `ok:true` and nests your `{ok:false,error}` *inside*
`data`. `NativeBridge` (`web/.../bridge/native.ts`) rejects the request promise ONLY
on **envelope** `ok:false` — so a nested `sendOk{ok:false}` **resolves** the promise
(carrying the failure as data). If the caller is `await bridge.request(...)` followed
by an unconditional success action (e.g. `onOpenChange(false)` to close a dialog) with
the error handling in a `catch`, that catch **never fires** — the dialog closes
silently on failure, its error UI dead code. Fix: real failures → `sendErr(msg)` so the
envelope is `ok:false` and the promise rejects into the caller's `catch`. (Fire-and-
forget callers like `void bridge.request(...)` are unaffected; the trap is specifically
handlers whose UI has explicit error rendering.) The broad codebase still uses the
nested convention widely (audit **G3**) — fix it per-handler where the caller actually
consumes errors.

**2. Count-only assertions are blind to shape.** The G1 import spec asserted only that
the live emitter count grew by N. But a *correct* import (one root re-parenting two
children → 3 nodes) and a *broken* rebind (three loose roots → 3 nodes) yield the
**same count** — so the assertion was invariant to the single most regression-prone
part of the logic (the spawn-index re-map + `ValidateEmitterGraph` re-parenting). A
count test that "passes" can give false confidence. Assert the **shape** the feature
promises: here, "exactly one new top-level node, with two children of roles `lifetime`
and `death`" — which a broken rebind fails. Also test the branch the happy path can't
reach: full-import never exercises the "child not in picks → drop link" miss-branch, so
add a **partial**-selection case; and a failed-path case (rejects + mutates nothing +
no stray undo entry) to pin the error contract.

**Source incident (2026-06-01, session 8).** A `superpowers:dispatching-parallel-agents`
/ Workflow adversarial review of commit `f2eb7f7` raised 11 findings (0 refuted); none
were live correctness bugs, but it caught the silent-failure UX defect and the
count-blind test. Both fixed + re-verified (a11y 157, vitest 386, builds clean) before
the change landed. Cross-reference [L-037](#l-037) (chokepoint side effects),
[L-038](#l-038).

## L-045 — The native test harness's cleanup `taskkill /F /IM ParticleEditor.exe` is image-name-wide; it kills a legacy editor build the user is daily-driving in parallel. Scope process cleanup to the `--test-host` command line, never the bare image name

**Rule.** Any cleanup that kills a process by image name (`taskkill /IM X.exe`,
`Stop-Process -Name X`) hits **every** process with that name, regardless of
binary path or how it was launched. The user daily-drives a legacy `0.2`
`ParticleEditor.exe` (a different binary at
`C:\Users\…\Downloads\ParticleEditor-v0.2.0-x64\`) while the dev/new-UI work
proceeds. The a11y harness (`web/apps/editor/scripts/run-native-tests.mjs`,
`killAny()`) called `taskkill /F /IM ParticleEditor.exe` before launch, after the
run, on CDP-failure, and on throw — so **every** `pnpm a11y` invocation nuked the
user's parallel editor.

**Fix.** Filter on the command line, which distinguishes the two binaries: the
harness always launches with `--new-ui --test-host`, the legacy editor never has
`--test-host`. `taskkill` can't filter by command line, so use CIM:
```
Get-CimInstance Win32_Process -Filter "Name='ParticleEditor.exe'" |
  Where-Object { $_.CommandLine -like '*--test-host*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```
Fails safe: an unreadable `CommandLine` (`-like` false) leaves the process alone,
so the worst case is a leftover test-host, never the user's editor. The
PowerShell-process-management pattern already exists in `tests/helpers/uia.ts`.

**Verification that matters here.** A dry-run of the filter against the user's
*live* legacy editor (it returned empty) plus a controlled launch of a no-arg
decoy + a `--test-host` instance (decoy survived, test-host killed) — don't
assert "scoped" from code reading alone; prove it against a real no-arg instance.

**Source incident (2026-06-01, session 8, G11).** User: "is there any way you can
stop closing the legacy 0.2 editor when testing? i want to work on things in
parallel." The blanket `taskkill` was the culprit; scoped to `--test-host` and
proven with the controlled decoy test. Cross-reference [L-031](#l-031)
(native runs are single-instance + fixed-port) and [L-038](#l-038) (the a11y
suite is the host-logic gate).

## L-046 — Two Windows-specific test/build-environment gotchas: (1) never run `vitest run` and `vite build` of the same workspace concurrently; (2) drive MSBuild through PowerShell, not Git-Bash

**Both bit during the G11 baseline pass and produced misleading green/failure
signals; both are environment artifacts, not code.**

**1. vitest ⊥ vite build concurrency.** Running `pnpm …editor test` and
`pnpm …editor build` as parallel background jobs made them contend on the shared
`node_modules/.vite` transform cache. The symptom was **31 test files "failing"**
with bogus Vite transform/parse errors on ordinary imports
(`import { Square, X } from "lucide-react"`), plus an absurd `environment 86.73s`
in the timing line. Run alone → 45 files / 390 passed, clean. Lesson: vite-backed
test and build steps are **not** safely parallel in one workspace; serialise them.

**2. Git-Bash mangles MSBuild `/switch` args.** Invoking
`MSBuild.exe … /p:Configuration=Debug /m` via the **Bash** tool POSIX-path-
translates the switches: `/p:Configuration=Debug` → a path, `/nologo` →
`C:/Program Files/Git/nologo`, so MSBuild dies with `MSB1008: Only one project
can be specified`. Worse, a `… | tail` pipe masks the failure as **exit 0**.
Always run MSBuild via the **PowerShell** tool with the `&` call operator
(`& "…\MSBuild.exe" "…\X.sln" /p:Configuration=Debug /p:Platform=x64 …`); the
switches pass verbatim. Cross-reference [L-039](#l-039) (fresh-worktree NuGet
restore) and [L-040](#l-040) (dist build before `--new-ui`).

**Finding MSBuild on this box (2026-06-07 addendum).** This machine has **VS 2022
"version 18" Community** at `C:\Program Files\Microsoft Visual Studio\18\Community\`
— so the MSBuild path is
`C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe`.
`vswhere -find MSBuild\**\Bin\MSBuild.exe` returned **empty** here (don't trust it),
and the usual `…\2022\…` / `…\2019\…` guesses miss the `18\` folder. The reliable
locator: `vswhere -all -property installationPath` (gives the `…\18\Community` root),
then `MSBuild\Current\Bin\MSBuild.exe` under it. The Debug-x64 build of
`ParticleEditor.sln` completes in ~45 s clean (only the pre-existing expat C4244 +
LNK4098 LIBCMTD warnings).

## L-047 — When verifying a CSS layout reorder, measure BOTH axes (a child can be horizontally correct but wrapped onto a new row); and beware CSS-Grid sparse auto-placement bumping a definite-column item to the next row

**Rule.** A "move element X next to element Y" reorder is only verified when you've
confirmed X and Y share the **same row** (centre-y within ~2px AND the parent's row
height didn't grow), not just that X's **x** is between its neighbours. An x-only
check passes for a wrapped element that's horizontally in the right column but on the
line below.

**The grid trap that caused it.** Moving the emitter role glyph between the eye and
the name via `grid-column: 2` (while the glyph stayed LAST in DOM order, to keep the
a11y goldens stable) made the glyph render on a second row. CSS Grid's **sparse**
auto-placement (the default) increments the row position when an item's definite
column is **less than the previously-placed item's column** — the glyph (col 2, placed
after the label at col 3) got bumped to row 2. Fix: pin the explicitly-column-placed
cells to `grid-row: 1` (the eye auto-fills row 1 col 1) so none can wrap.

**How to apply.** For any reorder verified in browser mode (Preview `eval`), assert
geometry on both axes: e.g. `Math.abs(a.cy - b.cy) <= 2` for same-row, and the row
container's height stayed at its single-row value (a wrapped child doubles it). Don't
sort children by one axis and call it done.

**Source incident (2026-06-02).** The first browser check of the role-glyph reorder
sorted the eye/glyph/label by `x` only → reported "eye → glyph → label" and looked
correct, but the glyph had wrapped to row 2 (the user caught it on relaunch:
"now in the next line"). The re-verify checked `cy` + `btnHeight` (24px = single row)
and confirmed the `grid-row: 1` fix. Cross-reference [L-033](#l-033) (arch-C visuals
need the user; but DOM-layout reorders ARE browser-verifiable — just check both axes).

---

## L-048 — A D3D9Ex shared render target can be INCOHERENT in its D3D11 alias at the rendered region's right edge; localise cross-API bugs by reading the SAME surface through both APIs, then fix with a proportional guard band

**Rule.** When the engine's pixels are correct on the D3D9 side but wrong on screen in
arch-C, suspect the **D3D9Ex→D3D11 shared-surface boundary** before any compositor
theory. A legacy shared-handle RT (`IDirect3DDevice9Ex::CreateTexture(... pSharedHandle)`
opened in D3D11 via `OpenSharedResource`) can read back **different pixels** in the D3D11
alias than in the D3D9 view at the rendered region's **right edge** — a band whose width
**scales with the rendered width** (~0.5%: ~4px at w≈666, ~10px at w≈1820). The D3D11
alias (what DComp presents) shows the stale clear colour there; the D3D9 view has correct
content. A correctly-ordered cross-device flush (`IDirect3DQuery9` event +
`GetData(D3DGETDATA_FLUSH)`) does NOT fix it, and the proper cure (an `IDXGIKeyedMutex`
shared resource) is **unavailable when the producer is D3D9Ex** (only D3D10/11 can create/
acquire keyed-mutex shares).

**How to localise (the readback ladder that worked).** Read pixels at EVERY stage with
faithful measurements (L-034), not eyes:
1. Recolour the engine clear (`engine/set/background`) — if the on-screen line ignores it,
   the bg you see is NOT being sampled live there (it's stale).
2. Dump the engine's pre-composite RT (`D3DXSaveTextureToFile` on `m_pSceneTexture`) and
   the post-composite RT (the AlphaComp/shared surface) — both D3D9 views.
3. Read the **same shared surface through D3D11** (`ID3D11Texture2D` staging copy + `Map`)
   AND the swapchain backbuffer. When D3D9-view = content but D3D11-view = clear colour at
   the same (x,y), the break is exactly the shared-surface boundary. (fmt 87 =
   `B8G8R8A8`; bytes are B,G,R,A.)
4. Confirm the flush is ordered render → `IssueEndFrameQuery` → `WaitEndFrameQuery` →
   `CompositeEngineFrame` (it is) to rule out a missing flush.

**The fix — guard band / overscan (not a mask).** Render the engine scene viewport a few
px LARGER than the DComp clip so the incoherent band falls in the clipped-off margin; the
clip (true scene rect) shows only coherent interior pixels. In `LayoutBroker::SetSceneRect`,
pass the overscanned rect to `Engine::SetSceneViewport` and the TRUE rect to
`Compositor::SetEngineVisualTransform`. Make the band **proportional** (`GBx = max(12, w/64)`
— the incoherency scales with width; a fixed 8px cleared 1264-wide but left ~2px at
maximized) and **aspect-preserving** (`GBy = GBx·h/w`) so the engine's per-pixel-FoV
projection keeps both per-pixel angles constant ⇒ visible framing is pixel-identical (verify:
viewport centre byte-identical pre/post). Clamp defensively to the RT in `SetSceneViewport`.

**Why this took multiple sessions.** The handoff asserted a "compositor clip seam / black
DComp backing through a 1px gap." That mechanism never survived the log (the backing is
recoloured `#ECECEC`, so a gap would read grey, not black) — but it anchored two prior
sessions on DOM/clip/backing fixes that were reverted. The L-022 trap: a confident handoff
mechanism is a hypothesis, not a fact. The decisive move was the cross-API readback, which
no amount of compositor-side reasoning would have reached. Cross-reference [L-033](#l-033)
(faithful grabs for arch-C), [L-034](#l-034) (recolour each layer; measure, don't eyeball),
[L-022](#l-022) (verify handoff claims against code/logs before acting).

---

## L-049 — The new-UI host must restore the same persisted (registry) engine settings legacy does; a "feature is broken in the new UI" bug is often a missing startup restore, not a broken feature

**Rule.** When a feature "works in legacy but not the new UI," before debugging the
feature, check whether legacy restores a persisted setting at startup that the new-UI
host skips. The legacy `main.cpp` startup restores a block of engine settings from
`HKCU\Software\AloParticleEditor` (ground slot paths / solid colour / texture, bloom
enabled + strength/cutoff/size, skydome, custom colours — `src/main.cpp:7636-7652`).
The new-UI `HostWindow` ports the *engine* but historically restored only recent-files
and the last mod — so any engine setting whose default differs from a useful value, and
which the user had tuned in legacy, comes up at its constructor default in the new UI.

**The bloom instance (2026-06-02).** "Enable bloom does nothing." The toggle, shader,
RTs, and render pass were all fine (verified live over CDP: `enabled=1 ready=1 effect=1
ping=1 pong=1`, `bloom=66/5091µs`). The fault was `m_bloomStrength` stuck at its `0.00`
constructor default because the host never ran legacy's
`SetBloomStrength(ReadBloomFloat("BloomStrength", ...))` restore — so the combine
multiplied by zero. Fix: restore the four bloom values in `HostWindow` after `Engine`
construction, same reg names/types. The user's registry had `BloomStrength=1` (legacy
use), so the restore immediately produced visible bloom.

**How to apply.**
- Diagnose render-gate skips by logging EVERY condition, not the one you suspect — the
  surprise here was that 4/5 flags were already true; only the value was wrong.
- Drive the bridge without the user via the `--test-host` CDP **host-object** channel
  (`chromium.connectOverCDP('http://127.0.0.1:9222')` → `window.bridge.request(...)`);
  it's unaffected by the [L-003](#l-003) page→host postMessage drop, and you only need
  state/log readback, so the [L-033](#l-033) degraded render doesn't matter. (Use
  `127.0.0.1`, not `localhost` — the CDP port binds IPv4 and `localhost` may resolve to
  `::1`.)
- **Registry-restoring a setting can make an a11y golden machine-dependent.** The
  `dialog-bloom-settings` golden captures the strength textbox value; once it's restored
  from the registry it differs per machine. Gate the restore on `!useTestHost` so the
  a11y harness sees the deterministic constructor default while real launches honour the
  saved value — cheaper than per-run registry save/clear/restore in the harness.
- **Parity gap is broader than bloom:** ground settings have the same missing restore.
  Worth a sweep of legacy's startup-restore block vs the host.

---

## L-050 — HTML5 drag-and-drop is silently dead under arch-C composition hosting (no HWND for the OS drag loop); build draggable UI on pointer events, not `draggable`/`onDragStart`

**Rule.** Do NOT build draggable UI in the new editor on HTML5 drag-and-drop
(`draggable` + `onDragStart`/`onDragOver`/`onDrop`/`dataTransfer`). Under the default
arch-C path WebView2 is hosted as a **composition visual** (no child HWND), and HTML5
DnD needs the OS drag loop (`DoDragDrop`) which needs an HWND — so `dragstart` never
fires and the element "won't pick up at all." The failure is **silent** (no error, no
console). The same surface works in a normal browser and in arch-A (HWND-hosted), so it
passes vitest/jsdom and a casual `pnpm dev` check, then dies in the shipped composition
build. Build drag on **pointer events** (`onPointerDown` + document-level
`pointermove`/`pointerup`) instead — they deliver like clicks in every hosting mode (and
on touch), and clicks already work in arch-C (selection), so pointer events do too.

**The pattern that worked (emitter-tree reorder, 2026-06-02).**
- Lift the validation to a **pure** function (`resolveDropIntent(source, target, …)`);
  it has no event dependency, so it's unit-testable and reusable for any hovered target.
- Parent owns a `startDrag(node, e)` controller: on `onPointerDown` it records the source
  + start point and attaches `document` `pointermove`/`pointerup`/`pointercancel`. Past a
  small threshold the drag goes "active"; the hovered row is found from the move event's
  **target** via `closest("[data-emitter-id]")` (works in jsdom — fired events carry a
  real target; `elementFromPoint` does NOT work in jsdom). On pointerup it dispatches the
  same bridge call the DnD `onDrop` used.
- **Swallow the trailing click**: a same-row pointerdown→move→pointerup synthesises a
  click; a `draggedRef` set at drag-end (and checked+cleared in the row-click handler)
  stops a drag from also re-selecting. Reset it at the next pointerdown so a stale flag
  can't eat the next real click.
- `stopPropagation` pointerdown on inner affordances (visibility toggle, rename input) so
  a drag doesn't start from them.
- Tests: jsdom needs the `PointerEvent` polyfill (already in `test-setup.ts`); fire
  `pointerdown`(source) then `pointermove`/`pointerup`(target) — they bubble to the
  controller's document listeners. The change is DOM-attribute-only (no ARIA) so a11y
  goldens are unchanged.

**Cross-reference.** [L-011](#l-011) (CSS effects can't span the engine compositing
layer) is the same shape: a web capability that silently no-ops specifically under arch-C
composition hosting. When something "works in the browser but not the new-UI build,"
suspect a composition-hosting limitation before a logic bug.

## L-051 — A startup restore gated under `!useTestHost` CANNOT be verified over the `--test-host` CDP bridge (the gate turns the very thing off); verify from a faithful non-test-host launch + a `host.log` dump instead

**The trap.** When you add a registry/startup restore to the new-UI host and gate it
under `if (!useTestHost)` — which you must, whenever any restored value surfaces in an
a11y golden, so the harness sees deterministic ctor defaults (see [L-049](#l-049); bloom
gated on `dialog-bloom-settings`, ground/skydome on `dialog-lighting`'s "Show ground"
toggle) — the agent's *only* no-user verification channel is **also** disabled. The
`--test-host` CDP host-object bridge (`connectOverCDP('http://127.0.0.1:9222')` →
`window.bridge.request('engine/state/snapshot')`) launches *with* `--test-host`, so the
restore never runs and the snapshot shows ctor defaults — even when the restore is
perfectly correct. A handoff note claiming "snapshot shows the saved value under
`--test-host`" is therefore self-contradictory and must not be trusted (an instance of the
[L-022](#l-022) "docs say X" trap — the session-10 bloom handoff carried exactly this
inconsistent claim).

**How to apply.** Verify the restore from a **faithful, non-`--test-host` launch** and read
the result from **`host.log`** (the trusted arch-C surface — L-033/L-034 — because it
reports engine *getters*, independent of whether the compositor renders correctly for an
agent-launched window):
1. Add a `Log("[view-restore] …", engine->GetX()…)` line at the end of the restore block
   (inside the `!useTestHost` gate, so it only fires on real launches). Make it permanent,
   not temporary — it's the standing verification channel for this whole class of parity
   fix, and it's consistent with the existing `[COMP-*]`/`[host]` host.log diagnostics.
2. Pick registry values that are **distinct from the engine ctor defaults** before
   launching (the dev box usually already has tuned values, since the user daily-drives
   legacy). Predict the expected log line from the registry, then launch and confirm each
   field equals the *saved* value, not the default.
3. PowerShell recipe: clear `%LOCALAPPDATA%\AloParticleEditor\host.log`,
   `Start-Process …\x64\Release\ParticleEditor.exe --new-ui -PassThru`, `Start-Sleep 8`,
   grep the log for `view-restore`, `Stop-Process`. No CDP, no port 9222, no user.

**Source incident (2026-06-02, session 11, ground/background/skydome restore).** Registry
held `bg=0x6E6E6E groundTex=5 groundSolid=0x626262 skydome=1` (all non-default); the faithful
launch logged exactly those, proving the restore end-to-end, while `a11y` stayed at the
baseline **157 passed / 4 splitters** (gate intact — the restore stayed off under
`--test-host`). Cross-reference [L-049](#l-049) (the parity-restore pattern), [L-033](#l-033)
(host.log + the user are the arch-C truth, not agent screenshots).

## L-052 — The two a11y golden lanes diverge: the **composition** lane (`*.composition.golden.yaml`) is maintained, the **legacy UIA** lane (`*.golden.json`) is not — never blanket-regenerate the legacy lane as part of an unrelated change

**The trap.** The native a11y harness has two lanes with separate goldens:
`*.composition.golden.yaml` (DOM snapshot via `page.accessibility.snapshot()`, the
**default** `pnpm a11y` / arch-C composition lane — this is the documented `157/4`
baseline) and `*.golden.json` (Windows UIA tree via `uia_inspector`, the
`pnpm a11y:legacy` / arch-A HWND lane). Recent work keeps **only the composition lane**
current. So when you legitimately need to update one surface's golden and reach for
`a11y:update:legacy` to keep the UIA lane consistent, the regen rewrites **~25 unrelated
surfaces** (`emitter-tree`, `property-tabs-*`, `kbd-*`, `curve-editor-focused`, every
`menubar-*`…) — accumulated drift since the legacy lane was last generated. Committing that
is the "blanket update buries a regression in noise" anti-pattern: the reviewer can't tell
your one intended change from 24 surfaces of drift.

**How to apply.**
1. **Update only the composition lane** for a normal change. Run `pnpm a11y:update` (NOT
   `:legacy`), then **diff-review every changed `*.composition.golden.yaml`** — each line
   must be explained by your change (a moved/added/removed node), nothing else.
2. If you removed a *surface* entirely (e.g. folded Bloom into Lighting), delete BOTH its
   goldens (`*.composition.golden.yaml` + `*.golden.json`) — that deletion is your
   intentional change and is cheap to attribute.
3. **Do NOT run `a11y:update:legacy`** to "tidy up" the UIA lane as part of an unrelated
   feature. If `git status` shows `*.golden.json` churn on surfaces you didn't touch,
   `git checkout HEAD -- 'web/apps/editor/tests/a11y-goldens/*.golden.json'` to revert the
   whole legacy lane, then re-delete only the removed surface's `.golden.json`. A
   wholesale legacy-lane refresh is its own dedicated chore, reviewed on its own.
4. Gotcha: `a11y:update:legacy` rebuilds `dist/` in **legacy** mode (`VITE_HOSTING_MODE=
   legacy`) and refuses to run if `dist/` is a composition build (needs `--rebuild`). After
   any legacy run, **rebuild composition dist** (`pnpm build`) before the faithful
   `--new-ui` launch or the next composition `a11y`, or you'll test the wrong hosting mode.

**Source incident (2026-06-02, session 11, Lighting-dock + Bloom-merge).** Composition
lane updated to exactly 2 surgical diffs (`dialog-lighting`, `menubar-view-open`) + the
removed Bloom surface; `a11y:update:legacy --rebuild` then churned ~25 `*.golden.json`
files, so the legacy lane was reverted wholesale and left as-is. Cross-reference
[L-033](#l-033) (arch-C verification truth) and the L-022 "trust-but-verify the tooling"
theme — a green `a11y` proves the *composition* lane only.

## L-053 — A single Toolbar change cascades into ~19 composition a11y goldens (every menubar / dialog / keyboard / property-tab snapshot embeds the toolbar subtree); budget for the fan-out and diff-review that it's the SAME node in each, not a per-surface regression

**The trap.** "Add one button to the Toolbar → only `toolbar.composition.golden.yaml`
changes" is wrong. The composition a11y snapshots capture the **whole window chrome**
(`page.accessibility.snapshot()` from the app root), and the toolbar lives inside that
chrome — so the toolbar subtree appears verbatim in *every* surface snapshot:
`menubar-*` (7), `dialog-lighting`, `emitter-tree`, `property-tabs-*` (3),
`curve-editor-focused`, `spinner-focused`, `kbd-*` (4), plus `toolbar` itself = **19**.
A read-only `pnpm a11y` after the change therefore shows ~19 "failures" (plus the 4
splitter artifacts, L-033), which *looks* like a broad regression but is one button
fanned out. (Confirm the cascade cheaply: `grep -l "Toggle Spawner panel"
*.composition.golden.yaml` lists exactly the surfaces that embed the toolbar.)

**How to apply.**
1. **Predict the fan-out before running a11y.** Any Toolbar / MenuBar / global-chrome
   edit touches every chrome snapshot, not one. Plan for N goldens, not 1.
2. **A reproducible (identical across reruns) wall of failures is the cascade, not
   flake.** L-033 flake *varies* run to run and drags the pass count well below the
   ~155 baseline; the cascade is the *same* surfaces every run. Two identical runs ⇒
   stop retrying and regenerate.
3. **`pnpm a11y:update` (composition lane only — never `:legacy`, L-052), then aggregate-
   diff to prove attribution:** `git diff <goldens> | grep -E "^[+-]" | grep -vE
   "^(\+\+\+|---)" | sort | uniq -c`. A clean change is **+N identical node lines, 0
   deletions** (here: 18× `+- button "Toggle Lighting panel"` + 1× the `[pressed]`
   variant in the surface where that dock is open). Any *other* added/removed line, or
   any deletion, means something beyond your one node moved — investigate before
   committing.
4. The `[pressed]`/state variant landing only in the expected surface (e.g. the dialog
   that opens that pane) doubles as **real-host DOM proof** the toggle's `aria-pressed`
   binding + exclusivity work end-to-end, not just in the unit-test MockBridge.

**Source incident (2026-06-03, session 12, Lighting toolbar toggle).** Adding the
"Toggle Lighting panel" button failed 23 composition specs across two identical runs
(19 chrome surfaces + 4 splitters); the aggregate-diff after `a11y:update` was a clean
`19 files, +19 insertions, 0 deletions`, every line the one button node. Cross-reference
[L-052](#l-052) (two-lane discipline), [L-033](#l-033) (flake vs. real), and
[L-051](#l-051) (the gated-restore in the same session was verified via host.log, since
its `dialog-lighting` golden change was only the toolbar button, not anything lighting).

**Corollary — a *display-value* change cascades the same way, and reasoning about ONE
golden when you can't run the harness leaves the rest silently drifted ([L-058](#l-058)).**
A panel that's always present in the chrome (here the Curve-editor Time spinner) embeds
in every full-page composition snapshot exactly like the toolbar does — so a `step 1→0.1`
+ 2dp display tweak (CRV-8) flips `Selected key time "0"`→`"0.00"` in **18** goldens, not
just `curve-editor-focused`. Session 14 shipped CRV-8 but, lacking the native build
([L-058](#l-058)), updated only the one golden it reasoned about; the other 17 stayed at
`"0"` and surfaced as an `emitter-tree` (et al.) mismatch the moment a later session ran
the harness. **Rule:** a value/text change in an always-visible panel is a cascade too —
`grep -l` the old literal across `*.composition.golden.yaml` to size it. If you *can't*
run `a11y:update` this session, do NOT claim the re-baseline done — say "N goldens still
hold the old value; finish when the native harness is available" so the debt is visible,
not silent. (2026-06-03, session 15: the P7 link-group diff after `a11y:update` was a
clean `18 files, 18× "0"→"0.00", 0 other lines` — the P7 dot/brackets are `aria-hidden`
and added nothing, so every changed line was the inherited CRV-8 cascade.)

## L-054 — When a `--test-host` determinism gate also blocks the only CDP channel that could test a registry round-trip, add an env-var that LIFTS the gate (e.g. `ALO_SETTINGS_LIVE`) — the a11y harness stays deterministic (never sets it) while an opt-in CDP launch drives the real registry; and seed a panel's DISPLAY from the registry raw values, not the engine snapshot (which is lossy)

**Two coupled lessons from making `settings/*` cross-mode + testable.**

**1. The gate-vs-testability bind, and the env-var seam that breaks it.** A registry
read/write handler must be gated under `--test-host` so the a11y goldens see canonical
defaults (L-051). But that same gate is what makes the write path *untestable*: a
faithful launch has no CDP (port 9222 only opens with `--test-host`), and `--test-host`
no-ops the write. The handler looks like it can only be verified by the user toggling in
a real launch. **Resolution:** gate on `m_testHost && !m_settingsLive`, where
`m_settingsLive` is read once from an env var (`ALO_SETTINGS_LIVE=1`) at construction. The
a11y harness launches plain `--test-host` → gate ON → deterministic; a dedicated CDP test
launches `--test-host` WITH the env var → gate OFF → the genuine registry round-trip runs
over CDP. One gate, both masters, no mock. The test (a committed on-demand
`scripts/verify-*.mjs`, mirroring `run-native-tests.mjs`) drives the real UI over CDP and
reads the registry via `reg query`, saving + restoring the original value in a `finally`.
Generalises to any "needs the real side-effect but a11y needs determinism" handler.

**2. Seed a panel's display from the registry raw values, not the engine snapshot.** The
engine stores only the *folded* `intensity × colour` Vec4 — the intensity/colour split is
unrecoverable from it (`seedFromSnapshot` hard-codes `intensity = 1` and shows the folded
colour, so the panel displayed e.g. white-at-intensity-1 instead of the saved
`RGB(180,180,190)` at 0.5). The raw split + raw angles live in the **registry**. Add a
`settings/lighting` get that returns the raw DTO and seed the panel's *displayed controls*
from it; the engine restore (host-side) still drives the *render*, and both come from the
same registry so they agree. Bonus: registry angles are stored as z-angle/tilt directly,
so the lossy `azAltFromDirection` direction-inversion drops out. **Caveat to document:** a
conditionally-rendered (unmount-on-close) panel re-seeds from the registry on reopen, so
in-session edits aren't reflected on reopen until lighting-value *write-back* lands — a
strict improvement over the old folded display for the common cases (first open + no-edit
reopen), not a regression.

**Source incident (2026-06-03, session 12, raw-lighting get-bridge + test seam).**
`verify-force-align.mjs` proved the write path (`LightingForceFillAlignment → 0`) AND the
raw display (Sun intensity `0.50` not `1`) in 5/5 CDP checks, no user. The
`dialog-lighting` golden flipped from the folded values (`1.00`, `#FFFFFF`, `#000000`…) to
the true defaults (`0.50`, `#B4B4BE`, `#282832`…) — i.e. the golden had been encoding the
bug. Cross-reference [L-051](#l-051) (gated-restore verify channel), [L-049](#l-049)
(parity-restore pattern), [L-033](#l-033) (engine pixels still need the user; DOM/registry
are agent-verifiable).

## L-055 — A `.cls:not([open])` selector silently matches NON-`<details>` elements that share the class (a `<div>` can never carry `[open]`), so it applies in EVERY state; scope it to `details`. And: headless preview browsers don't advance CSS transitions, so `getComputedStyle` on an interactively-toggled element reads the START frame forever — verify end-states a different way

**Two coupled lessons from a "chevrons differ between panels" bug.**

**1. The `:not([attr])` cross-element footgun.** Two collapsible-section components share
`.panel-section` + `.chev` CSS: `ToolPanel.Section` (native `<details>`, open state via the
`open` attribute) and `Section.tsx` (controlled `<div>`, open state via `data-open`). The
shared rotation rule tried to serve both:
```css
.panel-section[data-open="false"] .chev,
.panel-section:not([open]) .chev { transform: rotate(-90deg); }
```
The 2nd arm was meant for the `<details>` (closed = no `open` attr). But `:not([open])` also
matches the `<div>` — a `<div>` can NEVER have an `open` attribute — so it matched the
controlled div in BOTH open and closed states, pinning the property-tab chevrons at -90°
permanently (they never rotated, while the spawner's animated correctly). Fix: scope the
details arm to the element type — `details.panel-section:not([open]) .chev` — so the `<div>`
rotates solely off `[data-open]`. **Rule of thumb:** when one CSS rule serves two element
types via different state attributes, an `:not([x])`/`[x]` arm meant for one type usually
ALSO matches the other (which simply lacks `x`); always qualify such arms with the tag
(`details…`) or a discriminating class.

**2. Headless preview can't verify CSS transitions.** The chevron rotation is animated by
`transition: transform 0.12s`. In the preview/headless browser the compositor doesn't
advance transitions, so after interactively toggling a section, `getComputedStyle(chev)
.transform` returned the START frame (identity) *forever* — even sampled over 1 s — making a
correct fix look broken. Worse, inline `transform … !important` also "failed" for the same
reason (it starts a transition that never advances). **How to verify a transitioned
end-state without a real browser:** (a) measure an element that's in that state on INITIAL
render (no transition fired) — e.g. a section that's `defaultOpen={false}`; or (b) inject
`transition: none !important` (without overriding the property under test) and let the real
rule settle instantly; or (c) hand the actual animation to the user. Don't toggle-then-poll
`getComputedStyle` and trust it.

**Source incident (2026-06-03, session 12, property-tab chevrons).** User noticed the
left-panel (Basic/Appearance/Physics) section chevrons didn't change orientation while the
Spawner's did. Both already reuse `<ChevronDown class="chev">` + `.panel-section` — the
defect was purely the `:not([open])` arm. One-line CSS scope fix; verified the end-states
(0° open, -90° closed) by killing the transition (the `transition:none` probe returned
`matrix(0,-1,1,0,0,0)`), since the headless preview wouldn't animate. CSS-only, no a11y
golden impact (transforms aren't in the a11y tree), no native rebuild. Cross-reference
[L-041](#l-041) (browser-mode for React UI bugs) and [L-047](#l-047) (measure rendered
geometry, both axes).

## L-056 — When centralizing a display-format policy in a shared primitive, audit for call sites that were correct only BY ACCIDENT of the old derived default; and decouple display precision from interaction (wheel/step) granularity — they're different concerns

**Context.** The `Spinner` derived display decimals from `step`
(`dp = decimals ?? -floor(log10(step))`), so precision varied app-wide (`45`, `0.5`,
`0.50`, `1.000`). The fix: default display to 2dp (`decimals ?? 2`); integer fields opt
out with `decimals={0}`.

**1. The "correct by accident" audit.** Many fields displayed as integers NOT because
they declared `decimals={0}`, but because their `step={1}` happened to derive 0dp under
the old formula. Flipping the default to 2dp turned those into `1.00` / `100.00`. Some
were genuinely fractional (angles, positions — *should* become 2dp) but others were
genuinely integer/percent and had simply never needed an explicit marker: colour
channels (0–100 %), the increment-index delta, the rescale `%` dialogs, the CurveEditor
`index` track + key time. **Before changing a derived default, enumerate every consumer
that relied on the derived value and decide per-field whether the old result was
intentional or incidental.** The a11y golden diff is the safety net here — spinner values
live in the accessibility tree, so a stray `"1" → "1.00"` shows up immediately; scan the
*added* lines for integer fields that shouldn't have moved (`git diff … | grep '^+' |
grep -oE '"[A-Z][^"]*": "[0-9.]+"' | sort -u`).

**2. Display precision ≠ interaction granularity.** The old code conflated them: one
`dp` value drove BOTH the rendered decimals AND the wheel-nudge size (`dp === 0 ? 1 :
0.1`). Naively defaulting display to 2dp would have made angles (step 1°) scroll by 0.1°.
Keep them separate: display = `decimals ?? 2`; wheel/step base derived from `step`
(`step >= 1 ? 1 : 0.1`, which is exactly equivalent to the old `dp === 0` since
step-derived dp is 0 iff step ≥ 1). A field can legitimately show `45.00` while nudging
by whole units.

**Source incident (2026-06-03, session 12, 2dp consistency).** User: "make all decimal
bearing number values show 2 decimal places — it's inconsistent." Centralized in Spinner
(default 2dp, `step`-decoupled wheel base); audited every call site (added `decimals={0}`
to 4 colour channels, 3 rescale/increment dialogs, CurveEditor index+time; dropped 8
`decimals={3}` to 2). One unit test updated (`"40.0" → "40.00"`), 19 composition goldens
re-baselined (value-format only), 0 legacy goldens, vitest 406. Cross-reference
[L-052](#l-052) (composition-lane only) and [L-053](#l-053) (a Spinner/chrome change fans
out across many goldens — budget for it).

---

## L-057 — A synthetic pointer-drag in the headless preview does NOT emit the trailing `click` a real mouse / native WebView fires, and the MockBridge stores exact doubles where the real engine stores float32 — so a "drag-then-collapse" selection bug and a float-precision selection-drift both PASS the browser-preview check yet FAIL in the native app; dispatch the trailing click and account for float32, or hand drag-interaction verification to the user

**Rule.** The browser preview (vite + MockBridge) is the reliable surface for *React
behaviour* (L-041), but it diverges from the native app in two ways that silently pass a
flawed verification:

1. **No trailing `click`.** Dispatching `pointerdown`/`pointermove`/`pointerup` does NOT
   produce the synthetic `click` event that a real mouse — and the native WebView2 —
   fires after a press-release on the same element. So a bug where the *trailing click*
   does something wrong (here: the curve key's `onClick` re-fired `onKeyClick`, collapsing
   a multi-selection down to the grabbed key after a group drag) is INVISIBLE to a
   pointer-only synthetic test. **When verifying a drag, also `dispatchEvent(new
   MouseEvent('click', …))` on the drag target**, or verify in the native app / hand to
   the user.
2. **MockBridge stores exact doubles; the real engine stores float32.** Selection that is
   keyed by value-equality (`selectedKeyTimes.has(key.time)`) matches perfectly against
   the MockBridge (it echoes the committed JS double verbatim) but DRIFTS by a float32 ULP
   against the real C++ engine (it round-trips times as float32). So "key stays selected
   after a move" passes the preview and fails natively. Make value-keyed selection
   tolerant of float32 drift (snap to the nearest actual key within ~1e-3 after the
   refetch) — don't rely on exact equality surviving a native round-trip.

Also: the headless preview **throttles `requestAnimationFrame`** so `await rAF` hangs —
read state in a *separate* `preview_eval` call after the dispatch (React's state flush is
async anyway), never via an in-page rAF await.

**Why it matters.** I claimed CRV-1's multi-key group drag "live-verified, both keys stay
selected" — twice — and both times it was still broken for the user, because my synthetic
test omitted the trailing click that was the actual bug. A preview "PASS" on a
drag/selection interaction is necessary but NOT sufficient; the trailing-click + float32
gaps are exactly where preview and native diverge.

**How to apply.** For any drag-then-select / drag-then-commit interaction: (a) dispatch
the trailing `click` in the synthetic test, (b) reason about float32 round-trips through
the real engine for any value-keyed state, (c) treat a clean preview run as provisional
and confirm the specific gesture in the native build (or with the user) before declaring
it fixed.

**Source incident (2026-06-03, session 13, CRV-1).** Multi-key curve group drag collapsed
the selection to the grabbed key on release. Preview (pointer-only) showed both keys
selected → I reported "fixed". User: still broken. Root cause was the trailing synthetic
`click` re-running `onKeyClick` (the backdrop guarded on `dragConsumedClickRef`; the key
circle did not). Plus a native-only float32 drift in `selectedKeyTimes`. Fix: guard the
key `onClick` on `dragConsumedClickRef`, snap `selectedKeyTimes` to the refetched key
times after `tree/changed`, and commit the `fround`ed time. Re-verified WITH a trailing
`click` dispatched. Cross-reference [L-033](#l-033) (native arch-C verification truth) and
[L-041] (browser-preview as the React-behaviour surface).

---

## L-058 — A per-session git worktree starts EMPTY of all uncommitted build products (`node_modules`, NuGet `packages/`, `x64/Debug/*.exe`); a handoff that says "the native exe is already built this worktree" refers to a DIFFERENT, now-gone worktree — verify a binary exists before relying on it, never trust the doc

**Rule.** The desktop app provisions a fresh `claude/<random>` worktree per session. A
worktree is a clean checkout of tracked files only — everything `.gitignore`d
(`node_modules/`, the NuGet `packages/` restore, `x64/Debug/ParticleEditor.exe`, `dist/`)
is **absent on first checkout**, regardless of what a prior session built. So a handoff
line like "Debug x64 built; `packages/` has WebView2 — already built this worktree" is
true *only of the worktree that session ran in*, which no longer exists. Treat any claim
about a present binary/artifact as STALE until `Test-Path` says otherwise.

**Why it matters.** The session-13 handoff stated the native a11y harness was runnable
("`x64\Debug\ParticleEditor.exe` built … already built this worktree"). Running
`pnpm a11y` spawned that path and got `ENOENT`; `packages/` and `x64/` didn't exist at
all. Acting on the doc (assuming the harness was ready) wasted a run and risked reporting
"a11y verified" when the harness never executed. This is the same family as
[L-022](#l-022) (docs say X, reality ships Y) and [L-057](#l-057) (preview PASS ≠ native
PASS) — the unifying rule is *trust nothing that claims a build state; verify presence*.

**How to apply.** At session start, before relying on any binary/artifact: `Test-Path`
it. `node_modules` absent → `pnpm install`. Native harness needed → confirm `packages/`
+ `x64/Debug/*.exe` exist; if not, either run the full `nuget restore` + MSBuild bring-up
(L-039/L-046) or, when the change is web-only and the affected golden change is
deterministic, update the golden by reasoning and hand the native/CDP confirmation to the
user (their lane per L-033) — but say plainly that the harness did not run, never imply it
did. Don't let a from-scratch native bring-up become the price of verifying one
deterministic golden line.

**Source incident (2026-06-03, session 14, P6-rest).** CRV-8 changed the curve Time
spinner to 2 dp, drifting one composition-golden line (`"0"` → `"0.00"`). Tried
`pnpm a11y` to confirm → `ENOENT` on `x64\Debug\ParticleEditor.exe`; `packages/` + `x64/`
absent in the fresh worktree. Updated the single golden line by reasoning (the Value
spinner one row below already rendered `"0.00"` from the identical `decimals ?? 2` path;
legacy `.json` carries `children: []` so it can't capture the value), and handed native
a11y + engine verification to the user.

---

## L-059 — Editing a track multiset invalidates the running simulation's cached per-particle cursor iterators; the bridge must call `OnParticleSystemChanged(track)` after EVERY key mutation, AND that reseat must cover lock-aliased channels — also: MSVC's "cannot dereference value-initialized map/set iterator" can mean ORPHANED (erase-invalidated), not only default-constructed

**The bug.** `EmitterInstance` caches `std::multiset<Track::Key>::const_iterator` cursors
(`prev`/`next`) per live particle, per track, and dereferences them every frame in
`UpdateTrackCursors` ([src/EmitterInstance.cpp]). The legacy Win32 editor reseated those
cursors after every track edit via `Engine::OnParticleSystemChanged(track)`
([src/main.cpp:2695]); the arch-C `BridgeDispatcher` key-mutation handlers
(`set-track-key`, `delete-track-keys`, `add-track-key`) **dropped that call**, so an
`erase` (drag/spinner/delete) orphaned any cursor pointing at the moved key and the next
`Engine::Update` dereferenced a dangling iterator → debug assert, UB in Release.

**Why the first fix was incomplete.** Adding `OnParticleSystemChanged(trackIdx)` to the
handlers fixed single-channel edits but **still crashed**, because the engine's reseat
(`EmitterInstance::onParticleSystemChanged`, `track>=0` branch) reseated only
`m_cursors[trackIdx]`. With a **lock group** (green/blue/alpha locked to red), several
channels' `tracks[j]` alias ONE shared `keys` container (pointer aliasing per
ParticleSystem.h). Editing red erases a node that the red cursor AND the aliased green
cursor both point into — orphaning both — but reseating only index 0 (red) left index 1
(green) dangling. Fix: reseat the edited track **and every channel whose `tracks[j]`
equals `tracks[track]`**. Both halves are required (bridge must trigger; engine reseat
must be alias-aware).

**The MSVC wording trap.** `_STL_VERIFY(... "cannot dereference value-initialized map/set
iterator")` at `xtree:181` does NOT only fire for a default-constructed (`_Ptr==nullptr`)
iterator — in this toolset (VC 14.44) it ALSO fires for an **orphaned** iterator whose
container-proxy was nulled by `erase`/`clear` (`_Myproxy==nullptr`, `_Ptr` still pointing
at the freed node). I burned two wrong fixes assuming "value-initialized ⇒ never
initialized" and chased an init-ordering hole that didn't exist. Confirm the mechanism by
reading the iterator internals, don't trust the message text.

**The debugging technique (reusable for this GUI app).** No `cdb`/WinDbg installed and the
assert is a modal dialog, so: (1) install a `_CrtSetReportHook2`/`_CrtSetReportHookW2`
hook that, on `_CRT_ASSERT`, captures a **symbolized backtrace** via DbgHelp
(`RtlCaptureStackBackTrace` resolved at runtime from `ntdll` — its prototype isn't visible
under `_WIN32_WINNT=0x0501`) and writes it to a file under `%LOCALAPPDATA%` (NOT stdout —
Debug `WinMain` redirects stdout to an `AllocConsole` window you can't read); (2) capture
crash context into globals updated per-iteration with no I/O, dumped by the hook; (3) to
tell default-constructed from orphaned, read the debug iterator's raw layout
`[_Myproxy, _Mynextiter, _Ptr]` via `reinterpret_cast<void**>(&it)` — `null/null` =
default, `null-proxy / non-null-ptr` = orphaned. This nailed it in one repro after
reasoning had stalled. Strip ALL of it before committing (it lived under `#ifndef NDEBUG`).

**How to apply.** Any NEW arch-C bridge handler that mutates an engine-owned container the
simulation reads live MUST replicate the legacy post-edit notification
(`OnParticleSystemChanged`), and that notification's downstream reseat must account for
pointer-aliasing (lock groups). When an STL iterator-debug assert fires in the simulation
after an edit, suspect a cached iterator the editor invalidated — and verify default vs
orphaned before theorizing.

**Source incident (2026-06-03, session 14).** User dragged curve keys (green locked to
red) with a live particle → `xtree:181` assert in `UpdateTrackCursors`. Root cause: arch-C
key handlers never reseated cursors; reseat wasn't alias-aware. Fixed both; verified by
the user (crash gone) after a stack-trace hook + raw-iterator capture pinpointed
`track=1 aliasOfTrack=0, _Myproxy=NULL` (orphaned green cursor). Cross-reference
[L-057](#l-057) (native-only bugs invisible to the web lane) and [L-033](#l-033).

**Extension (2026-06-04, session 15) — link-group paths.** The SAME assert fired again,
this time from `linkGroups/set-membership` (creating/joining a group) and
`propagateLinkGroup` (syncing a shared-field edit to siblings). Both call
`copySharedParamsFrom`, which **reassigns each member's non-exempt track multisets**,
invalidating live particles' cursors across ALL non-exempt tracks — not just the one the
user edited. Session 14's fix only covered the lock-alias + direct key-edit handlers. Fix:
`OnParticleSystemChanged(-1)` (full reseat) after the membership mutation, and inside
`propagateLinkGroup` itself (the single choke point where the orphaning happens, so no
caller can forget). **Rule extension:** the reseat invariant applies to EVERY operation
that reassigns a track container, including bulk copies between emitters — and when a copy
can touch many tracks on many emitters, use the broad `-1` reseat, not a per-track one.

**Addendum (2026-06-08) — the `-1` reseat was a NO-OP for cursors; this rule
relied on a contract the code didn't honor.** The Ctrl+scroll-Burst-delay-on-a-
linked-emitter crash (`xtree:181`) re-surfaced this exact class. Root cause:
`EmitterInstance::onParticleSystemChanged(track)` split into
`if (track == -1) { recompute composites/textures/blend } else { reseat cursors }`
— so the broad `OnParticleSystemChanged(-1)` this lesson prescribes (and that
`propagateLinkGroup` dutifully calls after `copySharedParamsFrom`) **never
reseated cursors at all**; only the per-track `track >= 0` branch did. The
composites got recomputed, the siblings' orphaned cursors stayed singular →
crash on the next `Engine::Update`. Fix: run the cursor reseat for BOTH branches
— `track == -1` now reseats EVERY track (a `track != -1` guard also short-
circuits the otherwise out-of-bounds `tracks[-1]` read). **Lesson within the
lesson:** a comment claiming "`OnParticleSystemChanged(-1)` reseats cursors" is
not proof — verify the `-1` branch actually contains the reseat loop. Trust the
code, not the prescription (L-022).

## L-060 — An interactive (`pointer-events:auto`) overlay positioned OVER a full-width clickable row steals the row's clicks in its band; there is no z-order "click priority" — the topmost element wins, so an interactive overlay and a full-width row click cannot coexist, one must yield

**The trap.** LNK-6 made the link-group bracket gutter click-to-select-a-group. The
brackets are an absolute overlay that "hugs the names" — but the emitter rows are
`w-full`, so they extend UNDERNEATH the gutter to the panel edge. Making the bracket
`pointer-events:auto` meant a row-click landing in the bracket's x-band (a 2px bar sitting
mid-row) hit the bracket instead of the row → the selection jumped to the whole group.
Users experienced it as "my selection keeps getting wiped" while trying to multi-select.

**Why tweaking won't save it.** The DOM has no "this element is clickable but yields to
what's beneath" — the topmost hit-tested element with `pointer-events:auto` captures the
event, full stop. So an interactive element layered over a full-width click target is
fundamentally irreconcilable: either the overlay yields (`pointer-events:none`, lose its
interactivity) or the row's click area must stop before the overlay (layout rework). For a
*decorative* element (the bracket is `aria-hidden` ornamentation), the overlay yields:
make it `pointer-events:none` and move the affordance it carried (here: hover-to-tint) onto
the ROW, which already owns the pointer. Verify the conflict empirically (preview: click
the overlay, read the selection store) rather than eyeballing — a 2px target *looks*
harmless but isn't.

## L-061 — Never gate a must-succeed action behind an informational query: an OK that has to `await` a read-only request before doing its real work can "do nothing" on the first click when that request lags/fails — run the query in a separate reactive effect and keep the action synchronous

**The trap.** LNK-10's first design made the Set-Link-Group dialog's OK handler
`async`: it `await`ed `linkGroups/diff-membership`, then either showed a confirm modal or
joined. Natively, the first OK "did nothing" (the user had to click twice). The join — the
thing the user actually wanted — was coupled to a network round-trip + a follow-up confirm
step that could swallow the interaction.

**The fix + the rule.** Move the informational query into its own read-only `useEffect`
that runs reactively as inputs change, render its result inline (here: an amber "these
fields will be overwritten" note shown BEFORE the user clicks), and make the action handler
**synchronous** — it just fires the mutation and closes, exactly as it did before the query
was added. An action that must succeed should never depend on a query that might fail or
lag; decoupling them makes the action deterministic AND usually lands closer to the legacy
UX (which listed the differing fields in the same dialog, not a second modal). Cross-ref
[L-057](#l-057): this class of bug is native-only — the MockBridge returns instantly so the
web lane never reproduces the first-click failure.


## L-062 — In the browser preview, reading the DOM synchronously right after dispatching an event sees PRE-React-flush state; a controlled-close popover still shows its content and a reverted field still shows the old value until the next tick — read settled state in a SEPARATE eval, or you will diagnose a phantom bug

**The trap.** While verifying the P8a color picker in the preview (vite + MockBridge), I
clicked Cancel and, in the SAME `preview_eval`, read `popoverOpen` and the trigger label.
Both came back stale: popover "still open", trigger "not reverted" — looking exactly like a
broken Cancel. It was not broken. `element.click()` (and dispatched input/keydown events)
run the React handler synchronously, but React 18 batches the resulting state update and
flushes the re-render + portal unmount AFTER the current JS task. So a read in the same
synchronous eval observes the DOM as it was BEFORE the update committed.

**Why it bites here specifically.** The component is controlled (`open` state) and the
close + the revert `onChange` both flow through React state, not direct DOM mutation. There
is no synchronous DOM change to observe — everything waits for the flush.

**How to apply.** When driving React in the preview, split "act" and "assert" across two
`preview_eval` calls: dispatch the event in one, read settled state in the next (the gap
between tool calls is many ticks — more than enough). If you must read in one call, await a
micro/macro task first (`await new Promise(r => setTimeout(r))`). NEVER conclude a bug from
a synchronous post-event read. Cross-ref [L-041] (preview is the React-behaviour surface)
and [L-057] (preview vs native divergence) — this is a third preview caveat: preview vs
*itself* across the flush boundary.


## L-063 — A user "X doesn't work" report can be (a) correct behaviour misread as a bug, (b) a SILENT failure from a host invariant the UI never enforces, or (c) a real defect — distinguish the three BEFORE coding, because "fixing" (a) or chasing (c) when it's (b) both waste time and risk regressions; a GREEN reproduction is evidence too

**The incident (2026-06-04, session post-P8).** User reported the link-group work had
three problems: an unreadable warning, "dissenters don't get overridden", and "creating the
second group took three tries". Systematic triage split them into all three categories:

1. **(a) Correct-behaviour misread.** "Color texture not overridden + no warning" was CORRECT:
   `colorTexture` is exempt-by-default ([LinkGroup.cpp:13] `colorTexture(true)`), exactly like
   legacy, so a new group neither shares nor warns about it. The tempting "fix" (force textures
   to sync) would have REGRESSED against legacy. Verifying the default-exempt set is what
   prevented it. The first group "worked" only because the user happened to pick a
   shared-by-default field (`nParticlesPerSecond`).
2. **(b) Silent failure from an unenforced invariant.** "OK did nothing / three tries" was a
   real bug, but not a logic defect: the host invariant "a link group needs >=2 members"
   (`CreateLinkGroup` returns 0 below 2, no error) was never mirrored in the dialog's
   enabled/disabled state. When the right-click promoted a 2-selection down to 1 (targeting a
   row not in the selection), OK stayed enabled and fired a no-op `set-membership` -> "nothing
   happened". Fix: disable OK + show "Select at least 2 emitters to create a group" when <2 are
   selected for a new group. UI-enforces-host-invariant, the canonical fix for "I clicked it and
   nothing happened".
3. **(c) Real contrast/theme defect.** The warning used a fixed light-amber text (`text-amber-200`)
   readable only on dark; the theme is light and the app has NO `dark:` variant support (it
   themes via `data-theme` + CSS-var tokens). Fix: a self-contained high-contrast amber chip
   (dark text on light-amber fill) that reads in either theme.

**Method that worked.** (1) Read the whole clobber chain (`set-membership` -> `CreateLinkGroup`
-> `copySharedParamsFrom`, which does `*this = src` then restores only exempt fields) and PROVED
it correct before touching it. (2) Reproduced the selection->dialog flow in the browser preview
(L-041): click+ctrl-click reliably gave 2, right-click on a selected row kept 2, dialog captured
"All 2 selected". **A GREEN repro is evidence** — it eliminated "selection is broken" and
redirected to "an invalid 1-selection is silently actionable". (3) Confirmed the host invariant
in the C++ (`if (targets.size() >= 2) CreateLinkGroup`).

**Rules.**
- For a "doesn't work" report, FIRST classify (a)/(b)/(c). Check whether the observed behaviour
  is actually correct (compare to legacy / the default config) before assuming a defect.
- When a backend has an invariant (min size, required field, valid range), the frontend must
  mirror it as disabled/hinted state. An unenforced invariant surfaces as a silent no-op the user
  reads as a bug. Grep the host for the guard (`>= 2`, `return 0`, `return false`) and reflect it.
- A passing reproduction is as informative as a failing one — it rules out hypotheses. Don't only
  look for red.
- Contrast/theme regressions are web-lane-invisible (extends [L-057]): unit tests assert text
  CONTENT (`/lifetime/i`), never rendered contrast, and jsdom has no theme cascade. Readability
  lives in the gap between "the DOM says the right thing" and "a human can read it" — the user's
  lane. Raw Tailwind color classes (`text-amber-200`) do NOT adapt to a `data-theme` token system;
  use self-contained high-contrast fills or theme tokens for anything that must read in both themes.

## L-064

**A positional proxy (`cursor == depth`) standing in for an intent ("a fresh edit left live
skewed ahead of the stack tip") silently aliases other states that share the position — here, a
Redo().**

**Context.** VPT-2 verify-existing-undo. The new-UI captures undo snapshots PRE-mutation (legacy
captured POST), so after a fresh edit the live ParticleSystem sits one step ahead of the stack
tip. `undo/perform`'s head-of-history auto-capture snapshotted live before stepping back, gated on
`m_undo->Cursor() == m_undo->Depth()`. That condition is ALSO true immediately after `Redo()`
(redo to the tip leaves `cursor == size`) — but there live is already IN SYNC with the tip. The
auto-cap fired spuriously, pushed a duplicate of the current state, and the following `Undo()`
returned that duplicate → a silent no-op. User-visible: **undo → redo → undo loses the second
undo**, and the duplicate entry corrupts the stack so later navigation drifts too.

**How found.** A CDP driver against `--new-ui --test-host` exercising `edit → undo → redo → undo`,
reading `emitters/get-properties` at each step. The web suite (MockBridge, no real UndoStack) and
the existing native specs (only `edit → undo`, never `redo → undo`) both missed it — a textbook
[L-057] native-only gap. Root cause confirmed by a hand-trace of `UndoStack.cpp`'s cursor model
(`entries[cursor-1]` is current; `Redo` does `cursor++`; `Capture` sets `cursor = size`) BEFORE any
fix (systematic-debugging Iron Law). Exonerated the fix against pre-existing splitter/a11y-dialog
spec failures by stash-reverting source, rebuilding baseline, and reproducing them without the fix.

**Fix.** An explicit `bool m_liveAhead` on `UndoStack`: set in `Capture()` (every editing capture
precedes a mutation, so live becomes skewed), cleared in `Undo()`/`Redo()` (navigation re-syncs
live to the restored entry). Gate BOTH the auto-cap condition and `ComputeCanUndo()` on it. The
flag names the actual intent the position only approximated. Regression: `tests/undo-navigation.spec.ts`
(added to the native harness list).

**Rules.**
- When a boolean test stands in for an intent, enumerate EVERY state that satisfies the test, not
  just the one you had in mind. If two semantically different states share the position
  (`cursor==depth` after an edit vs after a redo), the position is the wrong signal — track the
  intent explicitly.
- Undo/redo NAVIGATION needs its own coverage. "edit → undo" passing does NOT imply
  "edit → undo → redo → undo" works; the bug lived entirely in the transition the happy-path specs
  never walked. Add multi-step navigation cycles (undo→redo→undo, repeated) to undo tests.
- State-corruption bugs spread downstream (one bad `Capture` poisoned the whole stack). When a
  later assertion is off by exactly one operation's worth, suspect a corrupting WRITE upstream, not
  the READ that surfaced it.
- The native accelerator path (`AcceleratorKeyPressed` → `accelerator/pressed` → React) is NOT
  reachable by CDP `page.keyboard.press` (CDP injects at the renderer; the host intercept runs in
  the native message loop). Verify host-undo logic via `window.bridge` over CDP; leave the literal
  Ctrl+Z keystroke to the user's on-screen pass.
- Drive the faithful `--new-ui` for verification via the existing CDP seam (`--test-host`,
  `chromium.connectOverCDP("http://127.0.0.1:9222")`, real `window.bridge`), NOT computer-use:
  the React UI is a separate `msedgewebview2.exe` process masked in screenshots, and CDP gives
  exact state reads (extends the L-041/L-062 preview lane to the REAL host). Probe CDP from node,
  not PowerShell `Invoke-WebRequest` (no `-NoProxy` in PS 5.1; `localhost`→IPv6 misses the IPv4
  bind — use `127.0.0.1`). request_access resolves this custom exe as `ParticleEditor.exe`.

## L-065

**PRE-mutation and POST-mutation undo capture need OPPOSITE coalescing mechanics — skip vs
replace — to produce the same "rapid burst = one undo step" UX.**

**Context.** VPT-2 follow-up: a scroll-wheel gesture (4 ticks) on an emitter spinner recorded
4 undo entries — each wheel notch is a separate `emitters/set-properties` and `captureUndo`
passed `coalesceKey=0` (coalescing disabled). Legacy coalesced rapid same-emitter edits via
`MakeCoalesceKey(EP_CHANGE, emitterIdx)` within a 1500ms window (verified `src/main.cpp:2682`).

**The trap.** Legacy captures POST-mutation, so its entries hold post-edit states and the
existing `UndoStack::Capture()` coalesce branch REPLACES the tail with the latest state (tail
must track the newest state; the entry before holds the session start = undo target). Arch-C
captures PRE-mutation, so the tail holds the session-START state — exactly the undo target.
Re-using the REPLACE coalesce would overwrite that start state with each tick's pre-value, so
undo would STILL only step back one tick. The correct PRE-mutation coalesce is to SKIP the
capture (keep the first/session-start snapshot, drop intermediate ticks); the head-of-history
auto-cap then snapshots the final live state on the first undo, so one undo spans the burst.

**Fix.** Added `UndoStack::CapturePreCoalesced` (skip-on-key-match-within-window, head-only) used
by arch-C property edits; legacy's `Capture()` (replace) left untouched. `set-properties` builds a
**per-field** key (bit 31 set | 15-bit order-independent FNV-1a XOR-hash of the patch field names
<< 16 | emitter id) so rapid edits to the SAME field fold but switching field starts a fresh step —
finer than legacy's per-emitter folding, a deliberate arch-C choice (user request). Structural ops
keep `coalesceKey=0` (never fold).

**Rules.**
- Before porting a windowed/coalescing behaviour across a capture-timing change (PRE vs POST,
  pre-commit vs post-commit), re-derive WHICH snapshot is the undo target. The same window can
  require opposite list mutations (replace the tail vs keep the tail) depending on timing.
- Don't overload a shared primitive whose semantics suit one caller's timing; add a sibling
  method so the other arch's proven path is untouched (legacy `Capture` ≠ arch-C
  `CapturePreCoalesced`).
- Testing time-windowed behaviour deterministically: control the clock. A `beforeEach` that waits
  out the window makes each test's first edit start fresh instead of folding into the previous
  test's same-key entry on a shared host. Within a test, near-instant sequential bridge calls are
  inside the window by construction.

## L-066

**A fresh worktree's FIRST native-harness run can be environmentally POISONED — the host dies
mid-run and cascades dozens of phantom failures — and looks identical to a catastrophic
regression. Re-run before trusting any catastrophic native result; the dumpless exit code is the
tell.**

**Context.** Session 18, "native-harness green-up." The handoff said the baseline was 160 passed /
5 failed (splitters ×4 + dialog-set-link-group ×1). The FIRST `pnpm test:native` on the fresh
worktree instead produced **39 failed / 65 passed / 61 did-not-run**: the host process exited
`0xFFFFFFFF` (-1) mid-run (after `emitter-keyboard`), and every later spec failed with `connect
ECONNREFUSED ::1:9222` (CDP gone with the dead host). On top of that, 19 composition a11y goldens
"drifted" (captured 1 emitter instead of the fixture's 3, unfrozen stats) — all garbage captures
from the dying/poisoned host. A second, clean re-run produced EXACTLY the handoff's 160/5; all 19
a11y "drifts" passed. So the entire first-run catastrophe was a one-off environmental poisoning,
NOT a code bug.

**The tell that it's environmental, not a crash.** A true unhandled C++ crash (SEH, or the
exceptions-disabled nlohmann `JSON_THROW`→`std::abort()` at json.hpp:2523) drops a WER minidump —
`%LOCALAPPDATA%\CrashDumps` had 6 from real past crashes (5/27–6/3), proving WER LocalDumps is
active for `ParticleEditor.exe`. The session-18 death produced ZERO dump and ZERO Application-log
event, and exit `-1` is the `TerminateProcess` signature (a clean quit returns `m.wParam`=0 per
HostWindow.cpp:3395; a crash returns the exception NTSTATUS). Dumpless + no-event + code -1 ⇒ the
host was *terminated/told to exit*, not a segfault — almost certainly a stale/stray `--test-host`
or a locked/dirty SHARED WebView2 user-data folder (L-030) poisoning the first run.

**Rules.**
- When a native harness result is catastrophically worse than the handoff baseline (host death +
  cascade), treat it as suspect and RE-RUN once before investigating. Playwright prints results in
  SORTED order with statuses filled in, NOT execution order — so "crashed after test N" from the
  reporter is unreliable; the `ECONNREFUSED ::1:9222` cascade + the `host process exited` line are
  the real signal that the host died and everything after is phantom.
  - **Now self-detecting (this session).** `run-native-tests.mjs` watches the host child while
    Playwright runs (a `pwRunning` gate); if the host exits mid-run it kills Playwright, prints a
    `*** FATAL: host process died MID-RUN ***` banner, and exits **2** — distinct from ordinary
    spec failures (exit 1) and a clean pass (exit 0). The expected end-of-run teardown kill
    (SIGTERM after Playwright already exited, `pwRunning=false`) does NOT trip it. Proven by
    fault-injection (`Stop-Process -Force` on `--test-host` mid-run → FATAL + exit 2, no cascade)
    AND a clean run (165/0, exit 0, no false trigger). A future poisoned run now announces itself;
    exit 2 ⇒ re-run, don't investigate as a regression.
- Diagnose dumpless vs dump-producing exits: check `%LOCALAPPDATA%\CrashDumps` and the Windows
  Application event log. WER active + zero dump for THIS exit ⇒ NOT an unhandled exception ⇒ don't
  hunt for a C++ crash site. Exit `-1`/`0xFFFFFFFF` = external termination, not `abort()` (which is
  exit 3 / 0xC0000409) and not a clean quit (0).
- Don't "fix" a11y golden drift you can't reproduce on a clean run — broad full-page drift sharing
  one state delta (here: 1 vs 3 emitters across every surface) is a single upstream cause, usually
  a poisoned host, not N golden bugs.
- To see the EXACT reproducible diff behind one a11y golden failure, regenerate just it
  (`pnpm a11y:update --grep "<surface>"`) and `git diff` the golden — removes the post-teardown
  capture-timing confound in `error-context.md` (Playwright snapshots AFTER the test's `finally`
  teardown, so the dialog is already dismissed there). This revealed dialog-set-link-group's golden
  was merely STALE behind a deliberately-tightened "require ≥2 emitters" validation
  (SetLinkGroupDialog.tsx, web-tested) — not a teardown-leakage bug as first hypothesized.
- Splitter %-assertions vs PIXEL `minSize` floors: a spec that calls itself "window-size-agnostic"
  because it asserts percentages is WRONG when the panels carry pixel `minSize` floors (PanelLayout
  `left` 330px, `spawner` 260px). At the test-host's ~1264px window, 20% = ~253px < 330px → `left`
  clamps to ~26%. Fix the TEST (the floor is intentional UI): compute the expected % from the
  MEASURED group width — `max(defaultPct, floorPx/widthPx*100)` — so it's correct at every window
  size, falling back to the flat default on a window wide enough that the floor doesn't bind.

## L-067 — Synthetic pointer events can't validate pointer-capture or the trailing synthetic click; verify drag features with REAL input (Playwright)

The gutter-initiated curve marquee (CRV) "passed" a browser `preview_eval` check — I dispatched
`pointermove`/`pointerup` directly on the `<svg>` and saw keys select. It was a FALSE POSITIVE that
handed a broken feature to the user ("I cannot begin a click drag outside the grid still"). Two
things synthetic `dispatchEvent` does NOT reproduce, both of which broke the real gesture:

1. **Pointer capture.** `startMarquee` calls `svg.setPointerCapture(pointerId)` for a pointer whose
   `pointerdown` fired on a sibling GUTTER element. Real captured events route to the capture
   target; synthetic events go to whatever element you dispatch on — so capture is never exercised.
2. **The trailing synthetic `click`.** After a REAL drag the browser fires a `click` on the capture
   target. The normal in-plot marquee captures the BACKDROP rect, whose `onClick` honours
   `marqueeConsumedClickRef` and swallows it. The gutter marquee captured the SVG, whose `onClick`
   only guarded `dragConsumedClickRef` — so the trailing click fell through to `onCanvasClick` and
   CLEARED the selection the marquee had just made. The synthetic test never fired that click.

Confirmed via Playwright real `browser_drag` + console instrumentation; the order was
`commit hits=[30]` → `handleCanvasMarqueeSelect [30]` → `handleCanvasClick CLEAR`.

**Rules.**
- For ANY drag / pointer-capture / click-vs-drag feature, the authoritative verification is REAL
  input — Playwright (`browser_drag`, real mouse) against the dev server. `preview_eval` /
  `dispatchEvent` is fine for INSPECTION (DOM, rects, console) but is NOT proof a capture-dependent
  gesture works. Never report "verified" off a synthetic drive alone.
- When the captured element is NOT the one that started the gesture, EVERY `onClick` path that can
  receive the trailing click must honour the same click-suppression flag. Fix here: the SVG
  `onClick` now mirrors the backdrop's `marqueeConsumedClickRef` check (CurveEditor.tsx
  `MultiChannelCurves`), not just `dragConsumedClickRef`.
- A passing jsdom/synthetic test for a pointer feature proves the pure logic, not the capture/click
  routing. Add the real-input pass to the verification checklist for drag features.

---

## L-068 — `pnpm a11y:update --rebuild` rebuilds dist only on a hosting-MODE mismatch, NOT on source change; a stale-but-right-mode dist silently serves the OLD UI and the run passes green with zero golden diff

**Rule.** Before running the native a11y harness (`pnpm a11y` / `a11y:update` /
`test:native`) after ANY web source change, rebuild the served bundle yourself with
`pnpm --filter @particle-editor/editor build`. Do NOT rely on the harness's `--rebuild`
flag to pick up source edits — it won't.

**Why.** `run-native-tests.mjs`'s `ensureDistMode(requestedMode, allowRebuild)` only
rebuilds `dist/` when the baked hosting mode in `dist/build-meta.json` *mismatches* the
requested mode (composition vs legacy), or when `dist/` is missing/unmarked. `--rebuild`
merely *permits* that mode-driven rebuild; it does not diff source. So if `dist/` already
matches the mode but is stale (built before your edit), the host serves the OLD UI, every
spec runs against it, and `--update` writes NO golden change — a confident false green that
looks like "my change had no a11y impact."

**The tell.** After `a11y:update` for a change you KNOW alters a captured surface, `git
status` shows zero golden changes. Confirm by timestamp/content: `ls dist/assets/*.js`
mtime predates your edit, and `grep "<new string>" dist/assets/*.js` returns nothing. Both
mean the served bundle is stale.

**How to apply.**
1. `pnpm --filter @particle-editor/editor build` (rebuilds `dist/` from current source).
2. Verify it took: `grep "<a string only your change introduces>" dist/assets/*.js`.
3. THEN `pnpm a11y:update` (no `--rebuild` needed once dist is fresh + right-mode) →
   `git diff` the goldens (L-053: confirm one shared cause across surfaces).

**Source incident (2026-06-06, session 20, VPT-6/7/8 status-bar).** Added an always-on
status-bar hint cell (a new `contentinfo` node captured by 19 composition goldens). First
`a11y:update --rebuild` passed 168/0 with ZERO golden diff — the dist was from a pre-edit
`pnpm build` (same composition mode), so `--rebuild` skipped it and the host served the old
status bar. Manual `pnpm build` (confirmed `grep "spawn instance" dist/` → 1) + re-run then
produced the expected surgical 19-surface `contentinfo` delta. Cross-reference [L-040]
(dist must be built to serve `--new-ui` at all) and [L-053] (status-bar/toolbar changes
fan out across goldens).

## L-069 — A mock tree helper that splices a copied subtree must re-id the WHOLE subtree, not just its top node; and a unit test only catches it when the clipboard ids collide with existing tree ids

**Rule.** When a MockBridge tree mutation clones a subtree into the tree (paste,
paste-as-child, duplicate), reassign ids across the **entire** cloned subtree
(`reassignIdsInPlace(node, maxIdIn(tree)+1)`), not just the root node. The mock's
emitter ids double as React keys; a descendant that keeps its original id collides
with an existing node of the same id and React throws *"Encountered two children with
the same key."*

**Why it slips past unit tests.** A helper unit test that seeds the clipboard with
ids far from the tree's ids (e.g. clipboard ids 99/100 vs tree ids 0–5) passes even
when only the top node is re-id'd — the descendants happen not to collide. The test
must use a clipboard subtree whose **descendant ids overlap** the tree's existing ids,
then assert global id-uniqueness across the whole result tree
(`new Set(allIds).size === allIds.length`).

**The native engine is NOT affected.** The C++ engine assigns sequential `index`
values on insert (`pEmitter->index = m_emitters.size()`), so the host paste path never
had this bug — it's purely an artifact of the mock's flat id-as-key model. Don't
"fix" the host for a mock-only defect.

**Source incident (2026-06-07, session 22, Paste As ▸ Child / SEL-5/MNU-4).**
`pasteAsChildFromClipboard` re-id'd only the top node (`{...cloneNode(buf[0]), id:
newId, role: slot}`). The 5 helper unit tests passed (clipboard ids 99/100). **Live**
Playwright (L-067) surfaced it on the first real paste: copying "Smoke" (children ids
1, 2) onto the default tree (which already has ids 1, 2) logged four React duplicate-key
errors. Fix: `reassignIdsInPlace(child, newId)` (the helper the root-paste already used)
+ a regression test with colliding ids. Cross-reference [L-067] (real input catches what
synthetic/unit can't) and the existing `pasteEmittersFromClipboard` (root paste already
did this correctly — the new helper should have reused its id-reassignment from the start).

## L-070 — The editor's `tsc --noEmit` does NOT type-check the test files; only the build's `tsc -b` (or `pnpm build`) does — so a type error in a `*.test.tsx` passes the quick check and fails the dist build

**Rule.** After editing any `*.test.tsx` / `*.spec.ts`, the authoritative type gate is
`pnpm --filter @particle-editor/editor build` (which runs `tsc -b && vite build`) or
`tsc -b` directly — NOT `tsc --noEmit`. `--noEmit` runs against the app tsconfig, whose
`include`/references don't cover the test project, so test-file type errors slip through
green. The dist build (and therefore the native a11y harness, which serves `dist`) runs
`tsc -b`, which builds the test project and WILL fail.

**The tell.** `pnpm --filter @particle-editor/editor exec tsc --noEmit` → exit 0, but
`pnpm --filter @particle-editor/editor build` → `error TSxxxx` in a `*.test.tsx` then
`Command failed with exit code 2: tsc -b`. The vitest run still PASSES (vitest transpiles
per-file without full project type-checking), so a bad test type annotation is green in
both `vitest` and `tsc --noEmit` yet red in the build.

**How to apply.** Treat `tsc --noEmit` as a fast smoke check only. Before claiming "tsc
clean" on any change that touches tests — and ALWAYS before the L-068 `pnpm build` that
precedes the native harness — run the real build or `tsc -b`. If `pnpm build` dies on a
test-file type error, fix the test annotation; don't loosen the app tsconfig.

**Source incident (2026-06-07, session 22 polish batch).** A bracket-select test annotated
`bridge.request.mock.calls.some((c: [{...}]) => …)` — a tuple type that `.some()` rejects.
`tsc --noEmit` passed and the commit shipped; the next `pnpm build` (for the a11y rebuild)
failed at `tsc -b` with `TS2345 … Target requires 1 element(s) but source may have fewer`.
Fix: drop the tuple annotation, cast `c[0]` instead. Cross-reference [L-068] (build dist
before the harness) — this gate sits right before that one.

## L-071 — A Playwright 30s timeout / "page closed" in the FULL native run that PASSES in isolation is a test-harness actionability race (often vs an animation), NOT a host hang — capture a trace before blaming C++

**Rule.** When `pnpm test:native` fails with a 30s `Test timeout` /
`Target page, context or browser has been closed` on ONE spec that passes in
isolation, do NOT conclude "native host hang." First confirm the host is even
implicated, then capture a Playwright trace to see the actual hung action.

**The host-is-fine checklist (all cheap, all decisive):**
- Harness exit code: **1** = ordinary spec failure; **2** = `hostDiedMidRun`
  (the real host-death signal, with an `ECONNREFUSED ::1:9222` cascade). Exit 1
  + later specs PASSING = the host never died (it pumps WebView2 on the same
  thread, so a true host hang freezes CDP for ALL subsequent specs).
- `host.log`: 0 `[COMP-engine-fail]`, healthy `[PERF]` fps, and entries from
  specs that run AFTER the "failed" one = host alive throughout.
- Crash dumps: no new `ParticleEditor.exe` in `%LOCALAPPDATA%\CrashDumps` and no
  WebView2 `…\WebView2\EBWebView\Crashpad\reports\*` = neither host nor renderer
  crashed.

**Then trace it.** `pnpm test:native --trace retain-on-failure` (the harness
forwards unknown args to Playwright). Extract `test-results/<spec>/trace.zip` (a
zip; the action log is `0-trace.trace`, JSONL). Filter `"type":"(before|after|
log)"`: the call with a `before` but no `after` is the hung action, and its `log`
lines say WHY (`"… intercepts pointer events"`, `"element was detached from the
DOM, retrying"`, `"waiting for element to be stable"`). That converts an opaque
30s timeout into the exact element + reason.

**The full-run-only tell = a cross-test race.** If it only reproduces in the
FULL ordered run (never in isolation, never via `--grep` of just that spec), the
trigger is state from a PRIOR test, not the spec itself. With the test-host
harness specifically: pages cycle per spec (`browser.close()` over CDP), so
in-memory renderer state does NOT persist across specs — look at host-side state
OR, as here, a timing race where a prior test's UI ANIMATION is still in flight
when the next test's helper clicks.

**Design corollary — a transient/animating UI element must not present as a
stable, actionable target.** A panel mid-exit-animation that's still a
`role="dialog"` with a Close button is an un-clickable, vanishing target that
Playwright (and a fast user) retry against. Mark it out of the
interactive/queryable set while it animates (`data-state="closing"` to leave the
"open" selector + `inert`), don't just hide it visually.

**Source incident (2026-06-07, session 24, dock animation).** A prior handoff
doc declared the re-applied dock animation a "native host hang needing a
debugger" and reverted it. Every host-is-fine check above said otherwise; a
trace showed the hung action was `closeAnyPanel`'s `closeBtn.click()` retrying
30s because the Lighting dock's ~260ms close slide-out (`displayDock` lag) left
its Close button collapsing-then-detaching. Fix = `closing` prop →
`data-state="closing"` + `inert` (test-harness-only bug; real users unaffected).
The animated dock then shipped green. Cross-reference [L-022] (handoff claims are
not facts — verify against code), [L-066] (native phantom re-run), [L-067] (real
input for drag/click features), [L-033] (arch-C visuals need the user's eye).

---

## L-072 — Never rewrite a UTF-8 source file with PowerShell 5.1 `Set-Content`/`Out-File` — it adds a BOM and mangles every non-ASCII byte; use `git checkout` or the Edit tool

**Rule.** To truncate / rewrite an existing source file that may contain
non-ASCII characters (em-dashes `—`, arrows, accented names — common in this
repo's comments), do NOT pipe `Get-Content` → `Set-Content -Encoding utf8` (or
`Out-File`) in PowerShell **5.1**. Two corruptions stack: (1) `Get-Content`
without `-Encoding utf8` reads the file with the ANSI codepage, so each UTF-8
multi-byte char (`—` = `E2 80 94`) becomes 3 garbage chars (`â€"`); (2)
`Set-Content -Encoding utf8` writes UTF-8 **with a BOM**, which shows up as a
stray `﻿` at line 1 and a spurious first-line diff. The file may still pass tests
(the damage is in comments / test names) but the git diff is dirty and the BOM
can break tooling. Prefer: `git checkout -- <file>` if the net change is zero;
the **Edit** tool for surgical changes; or `git apply` a patch. If you truly must
script it, use `[IO.File]::WriteAllText($p,$s,(New-Object Text.UTF8Encoding $false))`
(no-BOM) and read with `Get-Content -Raw -Encoding utf8`.

**Source incident (2026-06-08, session 28, Item 3).** Truncating
`PanelLayout.test.tsx` back to 203 lines via
`Get-Content -TotalCount 203 | Set-Content -Encoding utf8` added a BOM and turned
every `—` in the file into `â€"`. Tests stayed green (537/0) so it nearly shipped;
caught only by reading the pre-commit `git diff`, which showed the encoding
churn on lines I hadn't logically changed. Fixed with `git checkout --` (net
change was zero). Cross-reference [L-046] (drive MSBuild through PowerShell, not
Git-Bash — the inverse: some things NEED PowerShell, file rewrites do NOT) and
[L-022] (read the actual diff before claiming a clean change).

## L-073 — A perf-triage "avenue" in the ROADMAP/handoff is a hypothesis, not a measurement — instrument every stage and profile the real bottleneck on the real target before committing to the named fix

**Rule.** When a ROADMAP item or handoff prescribes a specific optimization
("avenue (a): do X — the most direct win"), treat it as an *untested hypothesis*.
Add per-stage `#ifndef NDEBUG` timing, measure the actual cost breakdown on the
real worst-case target (not a convenient small case), and confirm the named
avenue targets the dominant stage **before** declaring the item done. The
prescribed fix may shave a real-but-minor cost while the bulk sits elsewhere —
shipping it then would close the item having solved ~25% of the problem.

**Source incident (2026-06-08, session 29, NT-10).** ROADMAP NT-10 named
"avenue (a): `StretchRect` the offscreen RT into a small render target … (a) is
the most direct win" for the maximized save-modal snapshot (~72 ms). Built it:
the GPU readback collapsed ~8 ms → ~1.5 ms exactly as predicted — but the
maximized `[INSTANT-MODAL]` total only dropped ~72 ms → ~53 ms. A `[NT10-SPLIT]
pngSave` timer (added precisely to test the premise) showed the GDI+ **PNG
encode** (~28 ms) plus the base64/IPC of the ~905 KB PNG was ~70 % of the cost —
entirely untouched by avenue (a). The real lever was switching the *blurred*
backdrop to **JPEG** (encode 28 → 1.7 ms, payload 905 KB → ~120 KB), which took
the total to ~6 ms (~11×). Avenue (a) alone was ~27 %. Had I trusted the triage
and skipped the per-stage split, NT-10 would have shipped at ~53 ms calling it
done. The split logs caught the misdiagnosis. Cross-reference [L-022](#l-022)
(verify claims — including a roadmap's own framing — against measured reality)
and [L-033](#l-033) (the *feel* still needs the user's eye, the numbers don't).
