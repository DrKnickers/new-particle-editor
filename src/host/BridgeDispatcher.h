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
// For Task 1.3 only two requests are implemented end-to-end:
//   - layout/viewport-rect  → LayoutBroker::Apply(...)
//   - engine/state/snapshot → { groundZ, background, skydomeSlot } from Engine
// Everything else returns `{ ok: false, error: "not implemented yet (Task 2.1+)" }`.
#ifndef HOST_BRIDGE_DISPATCHER_H
#define HOST_BRIDGE_DISPATCHER_H

#include <functional>
#include <string>

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
    void Dispatch(const std::string& jsonRequest);

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
    Engine*            m_engine;
    LayoutBroker&      m_layout;
    AcceleratorBridge& m_accel;
    EmitFn             m_emit;
};

} // namespace host

#endif // HOST_BRIDGE_DISPATCHER_H
