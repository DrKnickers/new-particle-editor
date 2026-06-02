# G11 — WebView2 navigation / new-window / permission policy + WebMessage source check

`[lt-4]` `[P3 hardening]`. Plan source: `tasks/post-audit-slot6-lt4-host-polish.md`
(G11 was deferred out of slot 6; this is its focused pass). Branch: `lt-4`
(FF-push on land; **never `master` without explicit OK**).

## 1. Goal + scope

**Goal.** The WebView2 host currently trusts whatever page is loaded and whoever
posts a WebMessage. After this change the host enforces an origin allow-list:
it cancels any top-level navigation outside the approved set, denies all popups
and permission requests, and ignores WebMessages whose source origin isn't
approved. Defence-in-depth against a compromised/redirected renderer.

**In:**
- `add_NavigationStarting` → `put_Cancel(TRUE)` for non-approved URIs.
- `add_NewWindowRequested` → `put_Handled(TRUE)`, create nothing (deny popups).
- `add_PermissionRequested` → `put_State(..._DENY)`.
- `get_Source` check inside the existing `add_WebMessageReceived` lambda.
- 3 new `EventRegistrationToken` members + `remove_*` in WM_DESTROY.
- A single shared origin helper `IsApprovedWebViewOrigin(uri, devUi)`.

**Out (with reasons):**
- G7 (`AlphaCompositor::Resize` transactional rebuild) — separate open item.
- F9 (vcxproj SDK macro-ize) — needs a 2nd-SDK CI matrix, can't verify here.
- Tightening *sub-resource* loads — `NavigationStarting` only fires for
  documents/iframes; assets aren't navigations, by design.
- `master` forward-port — lt-4 work only; reconcile at LT-4→master cutover.

## 2. What the codebase already gives us

- **G5 pattern to mirror exactly** — `webMessageTok` member at
  `HostWindow.cpp:362`; stored in `add_WebMessageReceived` at `:1253`;
  `remove_WebMessageReceived` in WM_DESTROY at `:2019`. The 3 new tokens
  follow this lifecycle 1:1.
- **`useDevUi`** is a member (`:539`, set in ctor `:568`) — available in
  `InitWebView2` where handlers are registered.
- **`kVirtualHostName = L"app.local"`** (`:87`) — the prod origin host.
- **Navigate targets** — `https://app.local/index.html` (prod, `:1271`) /
  `http://localhost:5174/` (dev, `:1267`). Handlers must register BEFORE these.
- **Existing WebMessage lambda** at `:1218-1253` — the `get_Source` guard
  drops in at the top of the lambda body.

## 3. Architecture / implementation approach

```cpp
// File-scope helper (near kVirtualHostName / other host constants).
// about: covers WebView2's own about:blank init nav. localhost only in dev.
static bool IsApprovedWebViewOrigin(PCWSTR uri, bool devUi);
```
- `https://app.local/` prefix → allowed always (prod, virtual-host mapped dist).
- `http://localhost:5174/` prefix → allowed only when `devUi`.
- `about:` prefix → allowed (init may navigate `about:blank`).
- anything else → rejected.

Three handlers registered adjacent to `add_WebMessageReceived` (~`:1218`),
storing into 3 new members `navStartingTok`, `newWindowTok`, `permissionTok`
(beside `webMessageTok` at `:362`). `remove_*` each in WM_DESTROY beside the
G5 removal (~`:2019`). WebMessage lambda gains a `get_Source` → helper check
that logs + early-returns `S_OK` on a non-approved source.

## 4. Risks + mitigations

1. **Over-tight allow-list cancels the app's OWN initial navigation** → editor
   never loads → every a11y spec goes dark. *Mitigation:* the a11y suite is the
   gate. The harness launches `--test-host` with `useDevUi=false` → it loads the
   **prod** `https://app.local` origin (verified: `--test-host` sets CDP/DevTools
   only, orthogonal to `--dev-ui`). So a11y directly exercises the `app.local`
   branch. Build Debug, run `pnpm a11y`; native-behaviour specs must stay green
   (baseline: 157 pass, 4 `splitters` fail = L-033 artifact, not mine).
2. **`about:blank` init nav cancelled** → blank WebView. *Mitigation:* helper
   explicitly allows `about:`.
3. **`get_Source` check is the least-tested piece** — under `--test-host` the
   bridge also uses `AddHostObjectToScript` (`:1102`), so a11y may not drive the
   postMessage path. *Mitigation:* it's correct-by-construction defence-in-depth;
   documented as such in the handoff, not claimed as a11y-verified.
4. **localhost dev branch is a11y-uncovered** (only hit under manual `--dev-ui`).
   *Mitigation:* note in handoff; logic is a simple prefix-match symmetric with
   the prod branch.

## 5. Testing & verification

- [ ] **Baseline first** (before any edit): vitest 390 · `pnpm build` (+dist) ·
      `.sln` Debug+Release x64 clean (L-039 NuGet restore done) · a11y 157 pass
      / 4 splitters fail.
- [ ] Build Debug + Release x64 clean after the change (no new warnings beyond
      the pre-existing LNK4098 LIBCMTD).
- [ ] `pnpm a11y` after the change → still 157 pass / 4 splitters fail. Any
      `bridge-native` / `emitter-mutations` / golden regression = allow-list too
      tight → loosen.
- [ ] Static walk: handlers registered before `Navigate`; `about:` allowed;
      tokens removed in WM_DESTROY (no stale `this`-capturing lambda after
      teardown); helper rejects an off-origin URI and accepts both navigate
      targets.
- [ ] Couldn't verify autonomously (hand to user): popup-deny and
      permission-deny behaviour (needs a page that calls `window.open` /
      `getUserMedia`); the `get_Source` rejection path (test-host uses the host
      object, not postMessage).

## Review section

**What landed.** Two files.

| Change | File | Detail |
|---|---|---|
| G11 origin helper | `src/host/HostWindow.cpp` | `IsApprovedWebViewOrigin(uri, devUi)` in the anon namespace — prefix-match `https://app.local/` (always), `http://localhost:5174/` (dev only), `about:`. Trailing `/` blocks `app.local.evil.test`. |
| G11 nav policy | `src/host/HostWindow.cpp` | `add_NavigationStarting` (cancel off-origin), `add_NewWindowRequested` (deny popups), `add_PermissionRequested` (deny) — registered before `Navigate`; 3 tokens removed in WM_DESTROY (mirrors G5). |
| G11 message source check | `src/host/HostWindow.cpp` | `get_Source` guard at the top of the existing `WebMessageReceived` lambda — drops messages from non-approved documents. |
| Harness fix (out-of-band) | `web/apps/editor/scripts/run-native-tests.mjs` | `killAny()` scoped from blanket `taskkill /IM` to a `--test-host` CIM filter so a user's parallel legacy editor survives (→ L-045). |

**Verification (all run).**
- Baseline (pre-edit): vitest 45/390 · `pnpm build` clean (+dist) · Debug+Release x64 clean · a11y 157 pass / 4 splitters (L-033).
- Post-edit: Debug+Release x64 clean (only pre-existing LNK4098). a11y **157 pass / 4 splitters** — unchanged ⇒ the allow-list does NOT cancel the app's own `app.local` load and the bridge still works.
- All WebView2 APIs confirmed against the SDK 1.0.3967.48 header before coding.
- Harness fix proven: dry-run filter empty against the live legacy editor; controlled decoy(no-arg)+target(`--test-host`) test → decoy survived, test-host killed.

**Couldn't verify autonomously (hand to user).** Popup-deny and permission-deny
runtime behaviour (needs a page calling `window.open`/`getUserMedia`); the
`get_Source` rejection path (under `--test-host` the bridge also uses
`AddHostObjectToScript`, so a11y exercises the nav policy but not necessarily the
message-source drop). Both are correct-by-construction.

**Lessons captured.** L-045 (scoped process kill), L-046 (vitest⊥build
concurrency + Git-Bash MSBuild switch mangling).

**Not yet done (awaiting user OK):** CHANGELOG entry · post-audit reconciliation
block G11 ✅ · commit + FF-push to `lt-4`.
