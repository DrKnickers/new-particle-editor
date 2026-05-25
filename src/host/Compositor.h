// Compositor — owns the DirectComposition V1 visual tree that hosts
// WebView2 in composition mode. Stage 3 of [MT-11] Phase 3: swap
// WebView2 from HWND mode (CreateCoreWebView2Controller) to
// composition mode (CreateCoreWebView2CompositionController).
//
// This class is the production counterpart of the InitDComp +
// BuildVisualTree + Shutdown sections in src/host/spike/dxgi_spike.cpp
// — the working reference topology from the Stage 0 spike on the
// user's RTX 3080. Implementation details (DComp device, target,
// visual ComPtrs) live in Compositor.cpp via the pImpl idiom so
// consumers of this header (HostWindow.cpp in Stage 3b) don't have
// to pull in <dcomp.h> / <d3d11.h> / <dxgi1_2.h>. That matters here
// because ParticleEditor.vcxproj puts the legacy DXSDK include path
// FIRST (for d3dx9.h), and DXSDK's stale DXGI.h / D3D11.h / Dcommon.h
// shadow the Win10 SDK versions dcomp.h expects. Keeping dcomp.h to a
// single translation unit (Compositor.cpp) with a per-file
// AdditionalIncludeDirectories override that excludes DXSDK is the
// isolation pattern — see Compositor.cpp's header comment.
//
// Spike invariants preserved in the implementation:
//   - V2 factory function DCompositionCreateDevice2(nullptr, ...),
//     V1 IDCompositionDevice IID — matches WebView2APISample on the
//     known-good FD6 v3 baseline.
//   - CreateTargetForHwnd(hwnd, TRUE, ...) — topmost=TRUE.
//   - Visual tree built ONLY after the WebView2 composition controller
//     exists (per FD6 v3 lesson #2 — deferred construction).
//   - AddVisual(visual, FALSE, nullptr) puts the visual in front of
//     all siblings; MSDN's naming is counterintuitive ("insertAbove
//     = FALSE + null ref" = "above all," NOT "behind all"). Bisected
//     via the spike's --no-engine mode.
//   - put_RootVisualTarget(webviewVisual) AFTER the visual is in the
//     tree.
//   - Commit() once at end of AttachWebView2; subsequent state
//     changes (size, transform) call Commit() themselves.
//
// Stage 3 ships with the WebView2 visual as the SOLE child of the
// root. Stage 4 adds the engine D3D11 swapchain visual as a sibling
// — the AttachEngineVisual() seam is reserved for that.
//
// Lifecycle ownership note. put_RootVisualTarget makes WebView2 hold
// a reference to the internal webview visual. The CALLER must tear
// down WebView2 FIRST (close the controller, release the
// controller/view pointers) before this Compositor is destroyed,
// otherwise WebView2 will hold a dangling reference to a released
// visual when its async work settles. HostWindow.cpp's WM_DESTROY
// enforces this ordering.

#ifndef HOST_COMPOSITOR_H
#define HOST_COMPOSITOR_H

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <functional>
#include <memory>
#include <string>

// Forward declaration of WebView2 composition controller. The
// implementation file pulls in WebView2.h to use it; the header just
// needs the type name. (We CAN'T forward-declare it as `struct`
// because WebView2.h declares it as `interface ...` which is just
// `struct` under the hood but MSVC accepts the mismatch in
// declarations only if the type isn't fully used. As a method
// parameter to AttachWebView2, the pointer-to-incomplete-type is
// fine because we don't dereference it in the header.)
struct ICoreWebView2CompositionController;

namespace host {

class Compositor
{
public:
    // Optional logger callback. HostWindowImpl binds a lambda that
    // fans through Log() so [COMP] lines land in
    // %LOCALAPPDATA%\AloParticleEditor\host.log. Mirrors the
    // InputDispatcher / FramePublisher pattern.
    using LogFn = std::function<void(const std::string& line)>;

    // ctor stores the host HWND; no DComp work yet. Init() does the
    // device creation. dtor releases the visual tree in the order
    // documented in the file header.
    Compositor(HWND hostHwnd, LogFn log) noexcept;
    ~Compositor();

    Compositor(const Compositor&)            = delete;
    Compositor& operator=(const Compositor&) = delete;

    // Create the DComp V1 device + target (idempotent — calling
    // again is a no-op if already up). Returns S_OK on success;
    // failure HRESULT is logged via the LogFn and propagated to the
    // caller for env-var-gated fallback to HWND mode.
    HRESULT Init();

    // Build the visual tree with the WebView2 composition surface
    // as the sole child of the root, plug the controller's
    // RootVisualTarget into the visual, and Commit. MUST be called
    // from the composition controller completion callback, not from
    // Init() (FD6 v3 lesson — deferred tree construction). Idempotent
    // — second call is a no-op + returns S_OK.
    HRESULT AttachWebView2(ICoreWebView2CompositionController* ctl);

    // Update the root visual's clip / offset for a new host client
    // size. Calls Commit() internally. No-op if dimensions are
    // unchanged. Stage 3 uses the full client rect; Stage 4 will
    // add a scene-rect transform for the engine visual.
    HRESULT SetSize(int width, int height);

    // Explicit Commit — exposed so the caller can batch state
    // changes (multiple SetSize / future transforms) and commit
    // once. Most callers don't need this — SetSize / AttachWebView2
    // commit themselves.
    HRESULT Commit();

    // ---------- [MT-11] Phase 3 Stage 4 — engine visual ----------

    // Stage 4. Stand up the D3D11 device + DXGI factory, open the
    // engine's shared texture as a D3D11 alias, create a composition
    // swapchain, build the engine IDCompositionVisual, insert it
    // BEHIND the WebView2 visual (via AddVisual(engine, TRUE, nullptr)
    // — the spike-bisected MSDN-naming inversion places "behind all
    // siblings"; see Compositor.cpp's body + dxgi_spike.cpp:488 for
    // the long-form comment), and SetContent(swapchain). Idempotent
    // on identical (sharedTexture, w, h). A different handle triggers
    // re-open via the lazy detection in CompositeEngineFrame.
    //
    // On any failure (LUID mismatch, D3D11 device create, OpenShared
    // Resource, swapchain create), returns the failure HRESULT and
    // leaves the engine visual NOT attached. Caller logs
    // [COMP-engine-fail] and continues with composition mode intact
    // (chrome works in composition mode; viewport area is empty).
    // Sub-plan §3.8 documents the explicit no-chain-into-F8 design.
    //
    // Engine-side cross-device sync (D3D9 event query) is owned by
    // Engine; host orchestrates the spin between engine->Render() and
    // CompositeEngineFrame() — see Engine::IssueEndFrameQuery /
    // WaitEndFrameQuery and sub-plan §3.3 path (b).
    //
    // 4a stub: returns S_OK and logs a single line; no D3D11/DXGI/
    // DComp resources are created. Real implementation in 4b.
    HRESULT AttachEngineVisual(HANDLE sharedTexture,
                               int    w,
                               int    h) noexcept;

    // Per-frame composite step. Called from HostWindow's RenderD3D9
    // path AFTER engine->Render() + engine->WaitEndFrameQuery() under
    // composition mode. Sequence:
    //   1. Lazy (handle, w, h) check against the cached AttachEngineVisual
    //      tuple — re-open via RefreshEngineSharedHandle if changed.
    //   2. D3D11 immediate context: CopyResource(backBuffer, alias).
    //   3. swapChain->Present1(0, 0, &emptyParams).
    //
    // Returns S_OK on success; S_FALSE when no engine visual is
    // attached (Stage 3 baseline state, or AttachEngineVisual-failed
    // state per §3.8 — chrome works, viewport empty).
    //
    // 4a stub: returns S_FALSE unconditionally. Real implementation
    // in 4c.
    HRESULT CompositeEngineFrame() noexcept;

    // Drop the D3D11 alias and re-open against a fresh shared handle.
    // Called implicitly by CompositeEngineFrame's lazy check on
    // (handle, w, h) mismatch (the AlphaCompositor::Resize path
    // invalidates the shared HANDLE each call — every resize creates
    // a new handle). Exposed publicly so HostWindow can trigger eager
    // re-open if the lazy detection ever falls behind. Stage 4 ships
    // with lazy-only (D4); the explicit path is dormant until 4d/
    // beyond.
    //
    // 4a stub: returns S_OK without doing anything. Real impl in 4d.
    HRESULT RefreshEngineSharedHandle(HANDLE sharedTexture,
                                      int    w,
                                      int    h) noexcept;

    // ---------------------------------------------------------------

    // Diagnostic accessors. IsReady() returns true after
    // AttachWebView2 has committed the tree at least once.
    bool IsReady() const noexcept;
    HWND HostHwnd() const noexcept;

private:
    // pImpl — keeps dcomp.h / d3d11.h / dxgi1_2.h out of this header.
    struct Impl;
    std::unique_ptr<Impl> m_impl;
};

} // namespace host

#endif // HOST_COMPOSITOR_H
