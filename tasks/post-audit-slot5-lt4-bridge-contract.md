# Slot 5 — LT-4 Bridge Contract Hardening (G2 + G4 only; G1 + G3 deferred)

Per `tasks/post-audit-followups.md` "Suggested ordering" step 5. LT-4
work — branch from `origin/lt-4`, PR against `lt-4`.

## Scope deviation from the followups doc

The followups doc grouped G1–G4 as a single bridge-contract-hardening
PR. After re-verification I'm scoping this PR to G2 + G4 only and
deferring G1 + G3 to separate follow-up PRs. Rationale below.

### Deferred: G1 — `emitters/import-from-file` native handler

Genuine design ambiguity that needs a user call before implementation:
- Selected emitters come in as preview-tree integer indices; do we
  preserve parent/child structure when the selection includes a
  subtree, or import everything as roots? Existing `MemoryFile +
  Emitter::write(writer, copy=true)` pattern (per `BridgeDispatcher.h:275`
  comment, used today for the clipboard) doesn't itself decide.
- Link group IDs are document-scoped. When importing from a different
  `.alo` file, how do we map them? Renumber on import? Keep source
  IDs if they don't collide? Drop link membership entirely?
- Should the import push an undo record? `captureUndo()` exists; the
  question is whether import is undoable as a single unit or per-emitter.
- Should it emit `emitters/tree/changed` after import? (Likely yes,
  but the followups doc doesn't explicitly say.)

Current UX impact is low: the modal opens, user picks emitters, OK
button dispatches, `ImportEmittersDialog.tsx:142-144`'s try/catch
catches the "not implemented" rejection and surfaces an inline error
("isn't implemented in the mock yet"). Modal stays open. No data loss.

Recommend: brainstorming session on the design questions above before
implementation. The followups doc's alternative shape ("hide the dialog
behind a feature gate") is a viable interim if you want zero UX leakage,
but I'm not making that call autonomously — it's a UX regression vs the
current "broken but obviously labelled" state.

### Deferred: G3 — `sendOk({"ok": false, ...})` normalisation

20+ call sites in `BridgeDispatcher.cpp` mix two patterns:
- "User cancelled" outcomes (lines 1503, 1607, 1661) — operational
  non-errors; nested `ok: false` is a reasonable schema choice.
- Hard failures (lines 965, 1139, 1529, 1616, 1622, 1669, 1675, 1782,
  2333, 2360, 2367, 3266, 3274, 3283, 3290, 3306, 3314, 3323) — should
  arguably be top-level `sendErr()` to surface to JS callers.

Changing 17 hard-failure sites to `sendErr()` is **a breaking change
for any JS caller** that currently `await`s these handlers and
implicitly relies on success-resolution. The audit was right that this
is a contract drift — but landing the fix requires:
1. Auditing every JS call site for these handlers to see whether
   they'd handle a rejected promise gracefully.
2. Possibly adding `.catch()` handlers in callers where the rejected-
   promise behaviour would break them.

Mechanical migration of just the C++ side is risky. Recommend a dedicated
PR after the JS-side caller audit.

## In-scope items

### G2 — `DispatchInternal` outer exception safety

**Site:** [src/host/BridgeDispatcher.cpp:625-689](src/host/BridgeDispatcher.cpp:625) `Dispatch` and `DispatchSync` wrap only `json::parse` in try/catch. `DispatchInternal` (called from both) has 100+ `.get<T>()`, `.value(...)`, and similar conversions; any of them throwing `nlohmann::json::type_error` propagates uncaught into the WebView2 callback or COM dispatch path.

**Fix shape:**
- `Dispatch`: wrap the `DispatchInternal(parsed)` line in try/catch. On `json::exception`, emit a defensive error envelope (with the correlation id if available).
- `DispatchSync`: wrap the `return DispatchInternal(parsed).dump();` line in try/catch. On `json::exception`, return a well-formed error envelope.

Single helper to build the defensive envelope (DRY across the two call sites).

### G4 — Host-object exception envelope uses proper JSON escaping

**Site:** [src/host/HostBridgeProxy.cpp:111](src/host/HostBridgeProxy.cpp:111) builds the catch-block error envelope via string concatenation: `std::string("{\"type\":\"res\",\"ok\":false,\"error\":\"") + e.what() + "\"}";`. Quotes, backslashes, or control characters in the exception text produce malformed JSON.

**Fix shape:** replace with `nlohmann::json{{...}}.dump()`. ~5 LoC change. The sibling catch at line 115 uses a static string (already safe) but I'll keep its pattern consistent.

## 4. Risks

1. **G2's catch-all could mask new bugs** in handlers by swallowing exceptions silently. Mitigation: the error envelope includes the exception's `what()` message + a `[host] DispatchInternal exception:` log line, so failures are visible to anyone looking.

2. **G4's envelope-via-nlohmann adds an include of `<nlohmann/json.hpp>`** to HostBridgeProxy.cpp. Verified the header is already in the project's transitive include set via BridgeDispatcher.h (which HostBridgeProxy likely includes).

## 5. Testing

- [ ] MSBuild Debug|x64 clean.
- [ ] MSBuild Release|x64 clean.
- [ ] Code-walk: confirm G2's try/catch wraps the right line in both `Dispatch` and `DispatchSync`; confirm the error envelope shape matches the schema's response contract.
- [ ] Code-walk: confirm G4's nlohmann envelope produces the same field set as the original hand-rolled version when the exception text has no special chars.

---

## Review section

**What landed.** Two files, ~45 LoC net:

| Fix | File | Change |
|---|---|---|
| G2 | `src/host/BridgeDispatcher.cpp` | New file-static helper `BuildDispatchExceptionEnvelope`; two new try/catch wrappers around `DispatchInternal` calls in `Dispatch` and `DispatchSync`. |
| G4 | `src/host/HostBridgeProxy.cpp` | Added `#include "third_party/nlohmann/json.hpp"`; replaced hand-rolled JSON string-concat in `std::exception` catch with `nlohmann::json{...}.dump()`. |

**Build verification.**
- MSBuild Debug|x64 — clean (LNK4098 LIBCMTD baseline unchanged)
- MSBuild Release|x64 — clean (same)
- One in-flight compile error caught + fixed: HostBridgeProxy initially used `<nlohmann/json.hpp>` (system-include syntax) but the project vendors the header at `src/host/third_party/nlohmann/json.hpp`. Corrected to `"third_party/nlohmann/json.hpp"` to match BridgeDispatcher.cpp + InputDispatcher.h.

**Deviations from plan (G1, G3 deferred).** Documented at the top of this file. Both deferrals were judgment calls per the autonomous prompt's "use your judgment, document the deviation" guidance:
- **G1** (new native handler for `emitters/import-from-file`) requires design decisions on parent-child preservation, link group remapping, undo granularity, and event emission — all of which are user calls. Current UX is dead-end-with-error-message; not a data-loss bug.
- **G3** (normalizing 17 `sendOk({ok:false})` hard-failure sites to `sendErr`) is a breaking change for any JS caller that currently `await`s these handlers without `.catch()`. Mechanical C++ migration is straightforward; the JS-side caller audit isn't, and shipping the C++ change without the JS audit creates new unhandled-promise-rejection paths.

Recommend: brainstorm + sub-plan for each, ship as separate focused PRs after.

**What I couldn't verify autonomously.**
- **Runtime exception path** for G2 — would require crafting a malformed bridge request with a structurally-valid JSON shape that triggers a `.get<T>()` type_error mid-handler. Build-clean + code-walk confirms syntactic correctness; runtime confirmation is hard without bundled adversarial-input infrastructure.
- **G4's escaping** — same — would require triggering an exception with quotes / backslashes in `e.what()`. The replaced string-concat was unsafe by construction; the nlohmann replacement is safe by construction.

**Confidence.** High. Both fixes are clearly correct, behaviour-preserving on success paths, and add no new failure modes. The deferrals are well-scoped follow-ups, not silent skip-overs.

**Cross-references.**
- Followups doc: [tasks/post-audit-followups.md](post-audit-followups.md) G1, G2, G3, G4.
- G1 + G3 deferral notes are at the top of this file under "Scope deviation from the followups doc."
