// BridgeDispatcher — parses JSON wire messages from
// `chrome.webview.postMessage` (React → host), dispatches by `kind`,
// and emits JSON `res`/`evt` envelopes back to React. Single source of
// truth for the request/correlation-id machinery.
//
// The schema is mirrored from web/packages/bridge-schema/src/index.ts.
// Wire shapes:
//   request : { type: "req",  id, kind, params }
//   response: { type: "res",  id, ok: true, data }
//             { type: "res",  id, ok: false, error }
//   event   : { type: "evt",  kind, payload }
//
// Task 2.1 surface:
//   - layout/viewport-rect              → LayoutBroker::Apply(...)
//   - register-accelerators             → AcceleratorBridge::RegisterCombos
//   - engine/state/snapshot             → full EngineStateDto (every getter)
//   - engine/set/*           (17 of)    → setter + engine/state/changed event
//   - engine/action/*        (4 of)     → action + engine/state/changed event
//                                         (on-particle-system-changed skips
//                                         the event — engine re-renders next
//                                         frame anyway)
//   - engine/query/*         (3 of)     → IsGroundSlotEmpty / IsSkydomeSlotEmpty
//                                         / IsBloomAvailable
// Everything else (emitters/*, file/*, undo/*, spawner/*) still returns
// `{ ok: false, error: "not implemented yet (Phase 3+)" }`.
#ifndef HOST_BRIDGE_DISPATCHER_H
#define HOST_BRIDGE_DISPATCHER_H

#include <functional>
#include <string>

#include "third_party/nlohmann/json.hpp"

class Engine;

namespace host {

class AcceleratorBridge;
class LayoutBroker;

class BridgeDispatcher
{
public:
    using EmitFn = std::function<void(const std::string& json)>;

    BridgeDispatcher(Engine* engine, LayoutBroker& layout, AcceleratorBridge& accel, EmitFn emit);

    // Sets / replaces the live Engine pointer. The host can install this
    // before or after the Engine is constructed; null is treated as
    // "engine not ready, snapshot requests return ok:false".
    void SetEngine(Engine* engine) { m_engine = engine; }

    // Called from the WebView2 WebMessageReceived handler. The string is
    // the raw JSON sent by `chrome.webview.postMessage` on the React side.
    // Response (if any) is emitted asynchronously via m_emit.
    void Dispatch(const std::string& jsonRequest);

    // Synchronous variant used by HostBridgeProxy (the host-object IPC
    // channel that survives CDP attachment — see tasks/lessons.md L-003).
    // Parses the request, runs the same kind-handler ladder as Dispatch,
    // and returns the serialised response envelope directly to the caller
    // instead of emitting it. Events (engine/state/changed etc.) still
    // flow through m_emit — those are pushes, independent of the
    // request/response round-trip.
    std::string DispatchSync(const std::string& jsonRequest);

    // Convenience emitters (host-driven). EmitStatsTick is the 4 Hz status
    // bar push; EmitEngineStateChanged is the post-setter broadcast. Both
    // are no-ops in Task 1.3 — listed here so the next slice can wire them
    // without re-touching the public surface.
    void EmitEngineStateChanged();
    void EmitStatsTick(int fps, int emitters, int particles, int instances);

    // Emits an `accelerator/pressed` event to React with the matched combo
    // string (e.g. "Ctrl+S"). Called by HostWindow's AcceleratorKeyPressed
    // handler after AcceleratorBridge::TryDispatch returns true.
    void EmitAcceleratorPressed(const std::string& combo);

private:
    // Builds the response envelope for one parsed `req` envelope. Single
    // source of truth for the kind-string ladder — both the async
    // `Dispatch` (which emits the response via m_emit) and the sync
    // `DispatchSync` (which returns the serialised envelope to the
    // host-object caller) route through this.
    //
    // Returns the response envelope as JSON. If the request has no `id`,
    // the returned envelope still carries `id: null` so callers can
    // serialise it unambiguously.
    nlohmann::json DispatchInternal(const nlohmann::json& reqEnvelope);

    Engine*            m_engine;
    LayoutBroker&      m_layout;
    AcceleratorBridge& m_accel;
    EmitFn             m_emit;
};

} // namespace host

#endif // HOST_BRIDGE_DISPATCHER_H
