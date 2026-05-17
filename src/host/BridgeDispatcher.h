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
#include <vector>

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include "third_party/nlohmann/json.hpp"

class Engine;
class UndoStack;

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

    // Inject the UndoStack used to service `undo/perform` requests.
    // Task 2.4: stack is constructed by HostWindow alongside the Engine.
    // Null is treated as "no undo available, applied:false". Caveat:
    // the new-UI bridge surface does not yet *capture* into this stack
    // — engine setters (background/skydome/ground-z) are not wrapped in
    // Capture() calls. Phase 3 emitter work will start populating the
    // stack via per-mutation captures. Until then `undo/perform` is a
    // schema-reachable no-op.
    void SetUndoStack(UndoStack* undo) { m_undo = undo; }

    // The HostWindow's top-level HWND. Required by file/open's
    // GetOpenFileNameW to parent the modal dialog. Null means the
    // picker will run unparented (works, but doesn't block input on the
    // main window — set this in HostWindow once hMain exists).
    void SetHostHwnd(HWND hwnd) { m_hostHwnd = hwnd; }

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
    // bar push; EmitEngineStateChanged is the post-setter broadcast.
    void EmitEngineStateChanged();
    void EmitStatsTick(float fps, int emitters, int particles, int instances);

    // Phase 3 Screen 8 Batch 3 — editor-level file state.
    //
    // The dispatcher owns three pieces of state that don't belong on
    // Engine (Engine is engine parameters; these are editor state):
    //   - m_currentFilePath  : path to the .alo backing the in-memory
    //                          ParticleSystem; empty when untitled.
    //   - m_dirty            : true if any engine mutation has occurred
    //                          since the last file/new/open/save.
    //   - m_recentFiles      : registry-backed history list (max 9
    //                          entries), shared with legacy via
    //                          HKCU\Software\AloParticleEditor.
    //
    // SetDirty(true) is called at the end of every mutating handler
    // (engine/set/*, engine/action/clear, engine/action/rescale-system).
    // SetDirty(false) is called in file/new, file/open, file/save
    // success paths. Both transitions emit dirty/changed.
    void SetDirty(bool dirty);
    bool GetDirty() const { return m_dirty; }
    const std::wstring& GetCurrentFilePath() const { return m_currentFilePath; }

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

    // Emits a `dirty/changed` event with the current m_dirty value.
    void EmitDirtyChanged();
    // Emits a `recent/changed` event with the current m_recentFiles
    // serialised as a JSON array of strings.
    void EmitRecentChanged();

    Engine*            m_engine;
    LayoutBroker&      m_layout;
    AcceleratorBridge& m_accel;
    EmitFn             m_emit;
    UndoStack*         m_undo     = nullptr;
    HWND               m_hostHwnd = nullptr;

    // Phase 3 Screen 8 Batch 3 — editor-level file state. Owned here
    // rather than on Engine because they're editor concerns (not
    // engine parameters). The snapshot builder reads both fields.
    std::wstring              m_currentFilePath;
    bool                      m_dirty = false;
    std::vector<std::wstring> m_recentFiles;

    // Phase 3 Screen 8 Batch 4 — spawner config cache for snapshot
    // parity. The host doesn't yet own a SpawnerDriver* (matches Batch 3
    // for ParticleSystem*); spawner/start handlers cache the incoming
    // params here so a subsequent engine/state/snapshot returns the
    // user's last-committed config. JSON-shaped to avoid pulling
    // SpawnerDriver.h into the dispatcher header.
    nlohmann::json m_spawnerConfig;
};

} // namespace host

#endif // HOST_BRIDGE_DISPATCHER_H
