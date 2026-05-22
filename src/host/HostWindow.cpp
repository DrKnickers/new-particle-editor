// HostWindow — see HostWindow.h for the design overview.
//
// Most of this file is a port of src/host/viewport_poc.cpp, split into
// instance methods on a singleton-style HostWindow + Impl pair. The PoC
// proved the composition pattern (WebView2 surface set transparent, D3D9
// sibling child HWND layered on top, layout/viewport-rect drives
// SetWindowPos). We carry those decisions forward verbatim.
//
// IMPORTANT: this TU upgrades _WIN32_WINNT to 0x0A00 (Windows 10) before
// including windows.h. The rest of the project targets XP-era APIs;
// WebView2 + DPI awareness need a modern target.
#define _WIN32_WINNT 0x0A00
#undef WINVER
#define WINVER 0x0A00

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <wrl.h>
#include <wrl/implements.h>
#include <d3d9.h>
#include <winhttp.h>
#pragma comment(lib, "winhttp.lib")
#include "WebView2.h"
#include "WebView2EnvironmentOptions.h"

#include <atomic>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "HostWindow.h"
#include "Run.h"

#include "AcceleratorBridge.h"
#include "AlphaCompositor.h"

#include <objbase.h>
#include <gdiplus.h>
#include "BridgeDispatcher.h"
#include "HostBridgeProxy.h"
#include "LayoutBroker.h"

#include "../engine.h"
#include "../managers.h"
#include "../ModManager.h"
#include "../MouseCursor.h"
#include "../ParticleSystem.h"
#include "../ParticleSystemInstance.h"
#include "../SpawnerDriver.h"
#include "../UndoStack.h"

using namespace Microsoft::WRL;

namespace host {

namespace {

constexpr wchar_t kHostWindowClassName[]     = L"AloHostMain";
constexpr wchar_t kHostViewportClassName[]   = L"AloHostViewport";
constexpr int     kInitialWidth              = 1280;
constexpr int     kInitialHeight             = 800;
constexpr wchar_t kVirtualHostName[]         = L"app.local";
constexpr INTERNET_PORT kDevServerPort       = 5174;
constexpr UINT_PTR    kStatsTimerId          = 0x100;  // 4 Hz stats broadcast

// FPSMeasurer — ring-buffer of the last 32 frame timestamps. Originally
// ported from the legacy src/main.cpp `FPSMeasurer` (lines 56-99), but
// FD10 swapped GetTickCount() for QueryPerformanceCounter so the math
// stays meaningful in FD9b's uncapped (no-vsync) UpdateLayeredWindow
// rendering regime. GetTickCount's ~15.6 ms resolution is too coarse
// when the renderer pegs at hundreds of FPS: 32 frames can fit inside
// 0–2 ticks, producing fps readings that snap between 0 (zero-diff
// guard) and 1024 (32 frames / 0.03 s). QPC has sub-microsecond
// resolution and is free.
class FPSMeasurer
{
    static const int MAX_FRAMES = 32;
    LONGLONG m_frames[MAX_FRAMES];   // QPC tick values
    LONGLONG m_qpcFrequency;          // ticks per second
    size_t   m_iFrame;
    size_t   m_nFrames;
    size_t   m_lastFrame;
    size_t   m_firstFrame;
public:
    float getFPS()
    {
        if (m_nFrames > 0 && m_qpcFrequency > 0)
        {
            const LONGLONG diff = m_frames[m_lastFrame] - m_frames[m_firstFrame];
            if (diff > 0)
                return static_cast<float>(m_nFrames) * static_cast<float>(m_qpcFrequency) / static_cast<float>(diff);
        }
        return 0.0f;
    }
    void measure()
    {
        LARGE_INTEGER t;
        QueryPerformanceCounter(&t);
        m_lastFrame        = m_iFrame;
        m_frames[m_iFrame] = t.QuadPart;
        m_nFrames          = m_nFrames < MAX_FRAMES ? m_nFrames + 1 : MAX_FRAMES;
        m_iFrame           = (m_iFrame + 1) % MAX_FRAMES;
        if (m_iFrame == m_firstFrame)
            m_firstFrame = (m_firstFrame + 1) % MAX_FRAMES;
    }
    FPSMeasurer() : m_qpcFrequency(0), m_iFrame(0), m_nFrames(0), m_lastFrame(0), m_firstFrame(0)
    {
        memset(m_frames, 0, sizeof(m_frames));
        LARGE_INTEGER freq;
        if (QueryPerformanceFrequency(&freq)) m_qpcFrequency = freq.QuadPart;
    }
};

// Probe the installed WebView2 Evergreen runtime. Returns true if
// GetAvailableCoreWebView2BrowserVersionString succeeds and returns a
// non-empty version string. Call AFTER CoInitializeEx so that
// ShellExecuteW works cleanly in the error branch, but BEFORE any
// window creation so the dialog is the only visible artifact when the
// runtime is absent.
static bool WebView2RuntimeInstalled()
{
    LPWSTR versionInfo = nullptr;
    HRESULT hr = GetAvailableCoreWebView2BrowserVersionString(nullptr, &versionInfo);
    bool installed = SUCCEEDED(hr) && versionInfo != nullptr && versionInfo[0] != L'\0';
    if (versionInfo) CoTaskMemFree(versionInfo);
    return installed;
}

// Probe the Vite dev server at http://localhost:5174/. Used when
// --dev-ui is active to verify the server is listening before
// navigating. Returns true only if a 2xx response is received.
// Short timeouts (≤2 s total) so startup never hangs.
bool ProbeDevServer()
{
    HINTERNET hSession = WinHttpOpen(L"AloParticleEditor-DevProbe",
        WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
        WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!hSession) return false;

    // resolve: 1 s, connect: 1 s, send: 1.5 s, receive: 1.5 s
    WinHttpSetTimeouts(hSession, 1000, 1000, 1500, 1500);

    HINTERNET hConnect = WinHttpConnect(hSession, L"localhost", kDevServerPort, 0);
    if (!hConnect) { WinHttpCloseHandle(hSession); return false; }

    HINTERNET hRequest = WinHttpOpenRequest(hConnect, L"GET", L"/",
        nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, 0);
    if (!hRequest)
    {
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        return false;
    }

    bool ok = false;
    BOOL sent = WinHttpSendRequest(hRequest,
        WINHTTP_NO_ADDITIONAL_HEADERS, 0,
        WINHTTP_NO_REQUEST_DATA, 0, 0, 0);
    if (sent && WinHttpReceiveResponse(hRequest, nullptr))
    {
        DWORD statusCode = 0, len = sizeof(statusCode);
        if (WinHttpQueryHeaders(hRequest,
                WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                WINHTTP_HEADER_NAME_BY_INDEX, &statusCode, &len,
                WINHTTP_NO_HEADER_INDEX))
        {
            ok = (statusCode >= 200 && statusCode < 300);
        }
    }

    WinHttpCloseHandle(hRequest);
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);
    return ok;
}

// Walk up from x64/<Config>/ParticleEditor.exe to the repo root, then
// descend to web/apps/editor/dist (Vite's build output). Same pattern as
// viewport_poc, just a different sub-path.
std::wstring ComputeEditorDistPath()
{
    wchar_t exePath[MAX_PATH];
    GetModuleFileNameW(nullptr, exePath, MAX_PATH);
    std::filesystem::path p(exePath);
    auto root = p.parent_path().parent_path().parent_path();
    return (root / L"web" / L"apps" / L"editor" / L"dist").wstring();
}

// WebView2 user-data folder under %LOCALAPPDATA%. We use a stable,
// production-quality location (not %TEMP%) so the runtime can persist
// IndexedDB / cache across launches.
std::wstring ComputeUserDataFolder()
{
    PWSTR localAppData = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &localAppData))
        && localAppData)
    {
        std::wstring folder = localAppData;
        CoTaskMemFree(localAppData);
        folder += L"\\AloParticleEditor\\WebView2";
        SHCreateDirectoryExW(nullptr, folder.c_str(), nullptr); // best-effort
        return folder;
    }
    // Fallback to temp.
    wchar_t tempDir[MAX_PATH] = {};
    GetTempPathW(MAX_PATH, tempDir);
    return std::wstring(tempDir) + L"AloParticleEditor_WebView2";
}

// Log file under %LOCALAPPDATA%\AloParticleEditor\host.log — handy for
// diagnostics when there's no debugger attached.
std::wstring ComputeHostLogPath()
{
    PWSTR localAppData = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &localAppData))
        && localAppData)
    {
        std::wstring path = localAppData;
        CoTaskMemFree(localAppData);
        path += L"\\AloParticleEditor";
        SHCreateDirectoryExW(nullptr, path.c_str(), nullptr);
        return path + L"\\host.log";
    }
    wchar_t tempDir[MAX_PATH] = {};
    GetTempPathW(MAX_PATH, tempDir);
    return std::wstring(tempDir) + L"AloParticleEditor_host.log";
}

// Convert UTF-16 → UTF-8 via WideCharToMultiByte. Used to hand WebView2
// strings to BridgeDispatcher, and to hand the Win32 EXEPATH to
// ComputeEditorDistPath's spdlog-style debug printf.
std::string Utf16ToUtf8(const std::wstring& w)
{
    if (w.empty()) return {};
    int len = WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()),
                                  nullptr, 0, nullptr, nullptr);
    std::string out(static_cast<size_t>(len), '\0');
    WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()),
                        out.data(), len, nullptr, nullptr);
    return out;
}

std::wstring Utf8ToUtf16(const std::string& s)
{
    if (s.empty()) return {};
    int len = MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()),
                                  nullptr, 0);
    std::wstring out(static_cast<size_t>(len), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()),
                        out.data(), len);
    return out;
}

LRESULT CALLBACK HostMainWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp);
LRESULT CALLBACK HostViewportWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp);

} // namespace

// -----------------------------------------------------------------------------
// Impl
// -----------------------------------------------------------------------------

// File-scope pointer chased by the WndProc thunks below. Set by
// HostWindowImpl::Run before any window is created, cleared after the
// message loop returns. Single-instance is fine because Task 1.3
// only ever runs one host window per process.
struct HostWindowImpl;
HostWindowImpl* g_self = nullptr;

struct HostWindowImpl
{
    HINSTANCE        hInstance;
    HWND             hMain         = nullptr;
    HWND             hViewport     = nullptr;

    // LT-4 render loop: the host no longer maintains its own placeholder
    // D3D9 device. The Engine constructs the live device internally (via
    // its `(hFocus, hDevice)` ctor) and we render through `engine->Render()`.
    // Running two D3D9 devices targeting the same HWND was a structural
    // hazard; dropping the placeholder is the cleanest option since Engine
    // is constructed unconditionally in WM_CREATE.

    ComPtr<ICoreWebView2Controller> webController;
    ComPtr<ICoreWebView2>           webView;
    EventRegistrationToken          accelKeyTok = {};

    ITextureManager& textureManager;
    IShaderManager&  shaderManager;
    IFileManager&    fileManager;
    std::unique_ptr<Engine> engine;

    // FD9b: layered-window alpha compositor. Constructed after the
    // Engine (needs its D3D9 device), torn down before the Engine in
    // WM_DESTROY so Engine never dereferences a freed compositor.
    std::unique_ptr<host::AlphaCompositor> alphaCompositor;

    // LT-4 host-state plumbing — the new-UI host owns the live
    // ParticleSystem (replaced on file/new and file/open) and a single
    // SpawnerDriver (config mutated via SetConfig). The BridgeDispatcher
    // gets pointer-to-pointer access via BindHostState so its handlers
    // can read/write through the host's owned slots.
    //
    // Render loop wiring: RenderD3D9 drives SpawnerDriver::Tick and
    // engine->Update / engine->Render per frame; file/new and file/open
    // call engine->Clear + engine->OnParticleSystemChanged(-1) after
    // swapping the unique_ptr so the engine drops cached per-instance
    // state for the old system.
    std::unique_ptr<ParticleSystem> particleSystem;
    std::unique_ptr<SpawnerDriver>  spawnerDriver;

    // Undo / redo stack. Task 2.4: constructed here so BridgeDispatcher
    // can service `undo/perform` requests. Captures are not yet wired
    // through the new-UI bridge surface (Phase 3 emitter work), so the
    // stack stays empty for now and `undo/perform` resolves with
    // `applied: false`. The plumbing exists so Phase 3 wraps the
    // engine setter handlers in Capture() without re-touching this file.
    UndoStack                          undoStack;

    LayoutBroker                       layout;
    AcceleratorBridge                  accelerator;
    std::unique_ptr<BridgeDispatcher>  dispatcher;
    FPSMeasurer                        fpsMeasurer;

    // LT-4 D6: mod state shared with React. ModManager constructed in
    // the impl ctor (DiscoverMods + RestoreLastSelectedMod run before
    // any UI shows); SetEngine called in WM_CREATE once the Engine
    // exists. Passed to BridgeDispatcher via SetModManager.
    std::unique_ptr<::ModManager>      modManager;

    // LT-4 render loop bookkeeping. m_lastRenderTime drives dt for the
    // per-frame SpawnerDriver::Tick — matches the legacy
    // `g_spawnerLastFrameTime` flow in src/main.cpp:1572. First frame
    // sees dt == 0 (sentinel value 0.0f means "not yet rendered"), same
    // as the legacy first-frame initialisation.
    //
    // m_lastEmittedActiveCount debounces the spawner/active-count event:
    // we only emit when Engine::GetNumInstances() actually changes,
    // since the source is polled every render frame and we don't want
    // to flood WebMessage. -1 forces an initial emit on first non-zero
    // change.
    float                              m_lastRenderTime        = 0.0f;
    int                                m_lastEmittedActiveCount = -1;

    // LT-4 viewport interaction (camera controls). Mirror of legacy
    // src/main.cpp:2920-3060 drag-state. On WM_LBUTTONDOWN /
    // WM_RBUTTONDOWN we snapshot the camera + cursor XY, then
    // WM_MOUSEMOVE deltas are applied relative to the snapshot
    // (matches legacy "drag relative to start" feel — releasing and
    // re-pressing resets the reference frame). NONE means no drag in
    // progress; the wheel handler only fires when dragMode == NONE.
    enum class DragMode { NONE, MOVE, ROTATE, ZOOM };
    DragMode        m_dragMode      = DragMode::NONE;
    Engine::Camera  m_dragStartCam  = {};
    int             m_dragStartX    = 0;
    int             m_dragStartY    = 0;

    // LT-4 shift-click-to-spawn. Mirror of legacy
    // `info->mouseCursor` + `info->attachedParticleSystem` at
    // src/main.cpp:369-399 / 2945-2966.
    //
    // m_mouseCursor: Object3D whose position is set from screen-space
    // mouse moves (WM_MOUSEMOVE → GetCursorPos3D unproject) and whose
    // velocity is derived from QueryPerformanceCounter deltas in
    // UpdateVelocity() (called once per RenderD3D9).
    //
    // m_attachedParticleSystem: non-null between Shift-press (spawn) and
    // Shift-release (kill). Engine returns a pointer we keep until we
    // KillParticleSystem it.
    //
    // m_lastCursorX/Y: cache of the most recent (x,y) seen by
    // WM_MOUSEMOVE. Used as the spawn coords on WM_KEYDOWN VK_SHIFT
    // because WM_KEYDOWN's lParam is NOT cursor coords (legacy bug at
    // src/main.cpp:2960 passes garbage). Fallback if the cache is
    // stale: GetCursorPos + ScreenToClient.
    MouseCursor             m_mouseCursor;
    ParticleSystemInstance* m_attachedParticleSystem = nullptr;
    int                     m_lastCursorX = 0;
    int                     m_lastCursorY = 0;
    // FD10 (Group A): last GetTickCount() at which we pushed a
    // `cursor/position-3d` event. Throttled to ~30 Hz so the
    // WebView2 message channel isn't saturated by WM_MOUSEMOVE
    // (which fires per-pixel). The legacy status bar updates per
    // WM_MOUSEMOVE since SendMessage is free in-process; over the
    // bridge a 33 ms minimum interval is a good compromise.
    DWORD                   m_lastCursorEmitTick = 0;

    bool        useDevUi   = false;  // --dev-ui: navigate to Vite HMR server
    bool        useTestHost = false; // --test-host: CDP :9222 + DevTools
    FILE*       logFile = nullptr;
    std::mutex  logMutex;

    HostWindowImpl(HINSTANCE inst,
                   ITextureManager& tex,
                   IShaderManager&  shd,
                   IFileManager&    fil,
                   const std::vector<std::wstring>& gameRoots_,
                   bool devUi    = false,
                   bool testHost = false)
        : hInstance(inst)
        , textureManager(tex)
        , shaderManager(shd)
        , fileManager(fil)
        , useDevUi(devUi)
        , useTestHost(testHost)
        , layout(nullptr)
        , accelerator()
        , modManager(std::make_unique<ModManager>(&fil, gameRoots_))
    {
        // LT-4 D6: discover installed mods and restore the
        // previously-active one from the registry before any UI shows.
        // Both calls are quick; they don't touch GPU / WebView2 state.
        // Engine pointer is bound later via SetEngine() in WM_CREATE.
        modManager->DiscoverMods();
        modManager->RestoreLastSelectedMod();
    }

    void Log(const char* fmt, ...);
    void OpenLog();
    void CloseLog();

    // LT-4: InitD3D9 dropped; the Engine owns the live D3D9 device. The
    // viewport HWND is handed to Engine's ctor in WM_CREATE.
    void RenderD3D9();

    HRESULT InitWebView2();
    void    ResizeWebViewToClient();

    void OnWebMessage(const std::wstring& json);

    LRESULT MainWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp);
    LRESULT ViewportWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp);

    int Run(int nCmdShow);
};

// ---------- logging ----------

void HostWindowImpl::OpenLog()
{
    std::wstring path = ComputeHostLogPath();
    _wfopen_s(&logFile, path.c_str(), L"w");
    if (logFile) Log("[host] === --new-ui session started ===\n");
}

void HostWindowImpl::CloseLog()
{
    std::lock_guard<std::mutex> lock(logMutex);
    if (logFile)
    {
        fputs("[host] === --new-ui session ending ===\n", logFile);
        fclose(logFile);
        logFile = nullptr;
    }
}

void HostWindowImpl::Log(const char* fmt, ...)
{
    char buf[2048];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);
    OutputDebugStringA(buf);
    std::lock_guard<std::mutex> lock(logMutex);
    if (logFile)
    {
        fputs(buf, logFile);
        fflush(logFile);
    }
}

// ---------- D3D9 ----------

// LT-4 render loop + per-frame spawner tick. Replaces the prior
// placeholder clear-to-background path. The per-frame sequence here
// mirrors the legacy `Render` in src/main.cpp:1882 verbatim:
//
//   - Compute dt from the previous frame's timestamp (GetTimeF).
//   - Tick the SpawnerDriver — emits any due burst instances into the
//     Engine.
//   - Engine::Update() advances per-instance state.
//   - Engine::Render() does the actual D3D9 draw + Present.
//   - fpsMeasurer.measure() ticks the FPS ring buffer.
//
// After rendering, compare Engine::GetNumInstances() against the
// last-emitted active-count and broadcast spawner/active-count when it
// changes. The SpawnerPanel badge subscribes to that event unchanged.
void HostWindowImpl::RenderD3D9()
{
    if (!engine) return;

    float now = GetTimeF();
    float dt  = (m_lastRenderTime > 0.0f) ? (now - m_lastRenderTime) : 0.0f;
    m_lastRenderTime = now;

    if (spawnerDriver && particleSystem)
        spawnerDriver->Tick(dt, particleSystem.get(), engine.get());

    // LT-4 shift-click-to-spawn: refresh cursor velocity from
    // QueryPerformanceCounter deltas before the engine sees it. The
    // attached ParticleSystemInstance reads MouseCursor::GetVelocity
    // through its Object3D parent chain during Update. Mirrors legacy
    // src/main.cpp:1904 — the legacy render loop calls UpdateVelocity
    // unconditionally each frame whether or not a system is attached.
    m_mouseCursor.UpdateVelocity();

    engine->Update();
    engine->Render();
    fpsMeasurer.measure();

    // spawner/active-count: emit when GetNumInstances() differs from the
    // last emitted value. Polled per-frame, debounced to avoid WebMessage
    // spam. The SpawnerPanel badge subscription doesn't change — only
    // the source flips from MockBridge timer to real engine state.
    if (dispatcher)
    {
        int instances = engine->GetNumInstances();
        if (instances != m_lastEmittedActiveCount)
        {
            m_lastEmittedActiveCount = instances;
            dispatcher->EmitSpawnerActiveCount(instances);
        }
    }
}

// ---------- WebView2 ----------

void HostWindowImpl::ResizeWebViewToClient()
{
    if (!webController) return;
    RECT r;
    GetClientRect(hMain, &r);
    webController->put_Bounds(r);
    // FD8: when main resizes, the viewport popup's screen position
    // may need to change too (the main HWND's client origin shifted
    // in screen space). React will re-send a layout/viewport-rect
    // once its ResizeObserver fires, which is the authoritative
    // source. Just nudge the screen position from the cached client
    // rect in the meantime so the viewport doesn't lag visually.
    layout.RefreshScreenPosition();
}

void HostWindowImpl::OnWebMessage(const std::wstring& json)
{
    Log("[host] WebMsg (%zu chars)\n", json.size());
    if (dispatcher)
        dispatcher->Dispatch(Utf16ToUtf8(json));
}

HRESULT HostWindowImpl::InitWebView2()
{
    std::wstring userDataFolder = ComputeUserDataFolder();
    Log("[host] WebView2 user-data folder: %ls\n", userDataFolder.c_str());

    // Task 2.2: when --test-host is set, pass --remote-debugging-port=9222
    // to the underlying Chromium runtime so Playwright (and any CDP client)
    // can attach. Opt-in only: production launches use nullptr options.
    // CoreWebView2EnvironmentOptions is the SDK's ready-made implementation
    // (WebView2EnvironmentOptions.h) — it correctly defaults the
    // TargetCompatibleBrowserVersion to the SDK's compiled version, which
    // a hand-rolled class would have to know explicitly.
    ComPtr<ICoreWebView2EnvironmentOptions> envOptions;
    if (useTestHost)
    {
        Log("[host] test-host: enabling CDP on :9222 via AdditionalBrowserArguments\n");
        auto opts = Microsoft::WRL::Make<CoreWebView2EnvironmentOptions>();
        if (opts)
        {
            opts->put_AdditionalBrowserArguments(L"--remote-debugging-port=9222");
            opts.As(&envOptions);
        }
    }

    HRESULT envCreateHr = CreateCoreWebView2EnvironmentWithOptions(
        nullptr, userDataFolder.c_str(), envOptions.Get(),
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [this](HRESULT envHr, ICoreWebView2Environment* env) -> HRESULT
            {
                if (FAILED(envHr) || !env)
                {
                    Log("[host] WebView2 env failed 0x%08lx\n", envHr);
                    return E_FAIL;
                }
                env->CreateCoreWebView2Controller(
                    hMain,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [this](HRESULT ctlHr, ICoreWebView2Controller* controller) -> HRESULT
                        {
                            if (FAILED(ctlHr) || !controller)
                            {
                                Log("[host] WebView2 controller failed 0x%08lx\n", ctlHr);
                                return E_FAIL;
                            }
                            webController = controller;
                            controller->get_CoreWebView2(&webView);

                            // PROVEN FIX (PoC visual gate, polish 4b23425):
                            // Force the WebView2 surface to fully transparent so
                            // the sibling D3D9 child HWND is visible through the
                            // viewport slot's transparent <div>.
                            ComPtr<ICoreWebView2Controller2> ctrl2;
                            if (SUCCEEDED(controller->QueryInterface(IID_PPV_ARGS(&ctrl2))))
                            {
                                COREWEBVIEW2_COLOR transparent = {};
                                transparent.A = 0;
                                transparent.R = 0;
                                transparent.G = 0;
                                transparent.B = 0;
                                ctrl2->put_DefaultBackgroundColor(transparent);
                                Log("[host] WebView2 bg => transparent\n");
                            }

                            // Task 2.2: test-host mode enables DevTools (F12) so
                            // CDP debugging is fully functional for Playwright. No
                            // effect in normal launches — production users don't
                            // see DevTools unless they explicitly pass --test-host.
                            if (useTestHost && webView)
                            {
                                ComPtr<ICoreWebView2Settings> settings;
                                if (SUCCEEDED(webView->get_Settings(&settings)) && settings)
                                {
                                    settings->put_AreDevToolsEnabled(TRUE);
                                    Log("[host] test-host: DevTools enabled (F12)\n");
                                }
                            }

                            // Task 2.2.1: expose hostBridge via AddHostObjectToScript
                            // (--test-host only). WebView2 drops postMessage under
                            // CDP attachment (lessons.md L-003); the host-object
                            // channel is on a separate marshalling path and works,
                            // so Playwright drives request/response via this object
                            // instead. Never exposed in production — gated on
                            // useTestHost.
                            if (useTestHost && webView)
                            {
                                ComPtr<HostBridgeProxy> proxy;
                                HRESULT phr = Microsoft::WRL::MakeAndInitialize<HostBridgeProxy>(
                                    &proxy,
                                    [this](const std::string& req) -> std::string {
                                        if (!dispatcher) {
                                            return R"({"type":"res","ok":false,"error":"dispatcher not ready"})";
                                        }
                                        return dispatcher->DispatchSync(req);
                                    });
                                if (SUCCEEDED(phr) && proxy)
                                {
                                    VARIANT proxyVar;
                                    VariantInit(&proxyVar);
                                    proxyVar.vt = VT_DISPATCH;
                                    proxyVar.pdispVal = proxy.Get();
                                    proxyVar.pdispVal->AddRef();

                                    HRESULT ahr = webView->AddHostObjectToScript(
                                        L"hostBridge", &proxyVar);
                                    Log("[host] test-host: AddHostObjectToScript(hostBridge) hr=0x%08lx\n",
                                        ahr);

                                    // VariantClear releases the AddRef above; the
                                    // host-object map inside WebView2 keeps its
                                    // own reference, so the proxy stays alive for
                                    // the lifetime of the page.
                                    VariantClear(&proxyVar);
                                }
                                else
                                {
                                    Log("[host] test-host: HostBridgeProxy init failed hr=0x%08lx\n", phr);
                                }
                            }

                            // Task 1.6: intercept registered accelerator keys before
                            // WebView2 routes them to the page. ICoreWebView2Controller
                            // exposes add_AcceleratorKeyPressed for exactly this purpose;
                            // we only set Handled=TRUE when the combo matches the
                            // dictionary registered by React via `register-accelerators`.
                            controller->add_AcceleratorKeyPressed(
                                Callback<ICoreWebView2AcceleratorKeyPressedEventHandler>(
                                    [this](ICoreWebView2Controller* /*sender*/,
                                           ICoreWebView2AcceleratorKeyPressedEventArgs* args) -> HRESULT
                                    {
                                        COREWEBVIEW2_KEY_EVENT_KIND kind = {};
                                        args->get_KeyEventKind(&kind);
                                        // Only react on key-down events; KEY_UP events are
                                        // intentionally ignored (no repeat firing).
                                        if (kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN &&
                                            kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN)
                                        {
                                            return S_OK;
                                        }
                                        UINT vk = 0;
                                        args->get_VirtualKey(&vk);

                                        // GetKeyState is synchronous and reliable in an
                                        // event handler context — reads the current physical
                                        // key state at the moment of the event.
                                        bool ctrl  = (GetKeyState(VK_CONTROL) & 0x8000) != 0;
                                        bool shift = (GetKeyState(VK_SHIFT)   & 0x8000) != 0;
                                        bool alt   = (GetKeyState(VK_MENU)    & 0x8000) != 0;

                                        bool matched = accelerator.TryDispatch(vk, ctrl, shift, alt,
                                            [this](const std::string& combo)
                                            {
                                                Log("[Accel] combo=%s\n", combo.c_str());
                                                if (dispatcher)
                                                    dispatcher->EmitAcceleratorPressed(combo);
                                            });

                                        if (matched)
                                            args->put_Handled(TRUE);

                                        return S_OK;
                                    }).Get(),
                                &accelKeyTok);
                            Log("[host] AcceleratorKeyPressed handler registered\n");

                            // Fit to client.
                            RECT bounds;
                            GetClientRect(hMain, &bounds);
                            controller->put_Bounds(bounds);

                            // FD8: viewport is now a top-level WS_POPUP
                            // owned by hMain (created in WM_CREATE). DWM
                            // composites top-level popups as their own
                            // layer in screen space, above any child HWND's
                            // DComp surface (including WebView2). No
                            // SetWindowRgn cut-out is required, no z-order
                            // promotion is needed — owned popups naturally
                            // stay above their owner.

                            // Production mode: map app.local → web/apps/editor/dist
                            // so the React app loads from a stable virtual origin.
                            // Dev mode (--dev-ui): skip the mapping; Vite's own
                            // dev server serves everything from localhost:5174.
                            if (!useDevUi)
                            {
                                ComPtr<ICoreWebView2_3> wv3;
                                webView.As(&wv3);
                                if (wv3)
                                {
                                    std::wstring distPath = ComputeEditorDistPath();
                                    Log("[host] editor dist: %ls\n", distPath.c_str());
                                    wv3->SetVirtualHostNameToFolderMapping(
                                        kVirtualHostName, distPath.c_str(),
                                        COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
                                }
                            }

                            // Subscribe to JS → host messages.
                            EventRegistrationToken tok;
                            webView->add_WebMessageReceived(
                                Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                                    [this](ICoreWebView2*,
                                           ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT
                                    {
                                        LPWSTR raw = nullptr;
                                        HRESULT hr1 = args->TryGetWebMessageAsString(&raw);
                                        if (SUCCEEDED(hr1) && raw)
                                        {
                                            OnWebMessage(raw);
                                            CoTaskMemFree(raw);
                                        }
                                        else
                                        {
                                            // Fall back: maybe the page posted a JSON value
                                            // (chrome.webview.postMessage(obj) rather than
                                            // postMessage(JSON.stringify(obj))). Surface a
                                            // dedicated log so we can tell the difference
                                            // between "no event" and "event but parse failed".
                                            LPWSTR json = nullptr;
                                            HRESULT hr2 = args->get_WebMessageAsJson(&json);
                                            if (SUCCEEDED(hr2) && json)
                                            {
                                                Log("[host] WMR JSON-only (%zu chars), hr1=0x%08lx\n",
                                                    wcslen(json), hr1);
                                                OnWebMessage(json);
                                                CoTaskMemFree(json);
                                            }
                                            else
                                            {
                                                Log("[host] WMR empty: hr1=0x%08lx hr2=0x%08lx\n",
                                                    hr1, hr2);
                                            }
                                        }
                                        return S_OK;
                                    }).Get(), &tok);

                            // Navigate to the React app.
                            if (useDevUi)
                            {
                                Log("[host] dev-ui: Navigate to Vite dev server\n");
                                webView->Navigate(L"http://localhost:5174/");
                            }
                            else
                            {
                                webView->Navigate(L"https://app.local/index.html");
                            }
                            Log("[host] Navigate dispatched\n");
                            return S_OK;
                        }).Get());
                return S_OK;
            }).Get());
    Log("[host] CreateCoreWebView2EnvironmentWithOptions returned 0x%08lx (testHost=%d)\n",
        envCreateHr, useTestHost ? 1 : 0);
    return envCreateHr;
}

// ---------- WndProc dispatch ----------

LRESULT HostWindowImpl::MainWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
    switch (msg)
    {
    case WM_CREATE:
    {
        // FD8: viewport is a top-level WS_POPUP window OWNED by main
        // (not a WS_CHILD). DWM composites top-level popups as their
        // own layer in screen space, above any child HWND's DComp
        // surface — including WebView2's. WS_EX_NOACTIVATE prevents
        // the popup from stealing focus on click (camera drag still
        // works because mouse capture is explicit in ViewportWndProc).
        // WS_EX_TOOLWINDOW keeps the popup out of the taskbar.
        //
        // Ownership semantics: an owned popup follows the owner's
        // minimize/restore state, gets destroyed when the owner is
        // destroyed, and stays z-ordered above the owner. Position
        // is in SCREEN coords; LayoutBroker translates from main-
        // client coords via ClientToScreen.
        // FD9b: WS_EX_LAYERED + UpdateLayeredWindow(ULW_ALPHA) replaces
        // FD7/FD8's SetWindowRgn cut-out. The AlphaCompositor pushes a
        // pre-multiplied ARGB bitmap each tick, the OS composites the
        // popup onto the WebView2 underneath, and software alpha stamps
        // (T4) carve soft-edged holes for chrome occlusion rects.
        hViewport = CreateWindowExW(
            WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_LAYERED,
            kHostViewportClassName, L"",
            WS_POPUP | WS_VISIBLE,
            16, 16, 320, 240, hwnd /* owner */, nullptr,
            hInstance, nullptr);
        if (!hViewport)
        {
            Log("[host] CreateWindowExW viewport failed (gle=%lu)\n", GetLastError());
            return -1;
        }
        layout.SetViewport(hViewport);

        // LT-4: no host-owned D3D9 device. The Engine constructs the
        // live device internally below, targeting this viewport HWND.

        // Construct the Engine now that both HWNDs exist. hFocus = parent,
        // hDevice = viewport child — same wiring as legacy main.cpp.
        try
        {
            engine = std::make_unique<Engine>(
                hwnd, hViewport, textureManager, shaderManager, fileManager);
            if (dispatcher) dispatcher->SetEngine(engine.get());
            layout.SetEngine(engine.get());
            // LT-4 D6: bind engine to ModManager so subsequent
            // SelectMod() calls can hot-swap shaders + textures.
            if (modManager) modManager->SetEngine(engine.get());
            Log("[host] Engine constructed OK\n");
        }
        catch (const std::exception& e)
        {
            Log("[host] Engine construction threw: %s\n", e.what());
            MessageBoxA(hwnd, e.what(), "Engine init failed", MB_ICONERROR);
            // Continue — viewport will still clear, just without engine state.
        }
        catch (...)
        {
            Log("[host] Engine construction threw unknown exception\n");
            // Continue without engine; snapshot will return ok:false.
        }

        // FD9b: stand up the alpha compositor against the Engine's D3D9
        // device. The Engine's Reset() resizes the off-screen RT on
        // layout changes; we still bootstrap a non-degenerate size now
        // so the very first Render finds a valid RT to target.
        if (engine && engine->GetDevice())
        {
            try
            {
                alphaCompositor = std::make_unique<host::AlphaCompositor>(engine->GetDevice());
                RECT vrc{};
                GetClientRect(hViewport, &vrc);
                alphaCompositor->Resize(vrc.right - vrc.left, vrc.bottom - vrc.top);
                engine->SetAlphaCompositor(alphaCompositor.get());
                layout.SetAlphaCompositor(alphaCompositor.get());
                Log("[host] AlphaCompositor up (%ldx%ld)\n",
                    vrc.right - vrc.left, vrc.bottom - vrc.top);
            }
            catch (const std::exception& e)
            {
                Log("[host] AlphaCompositor init failed: %s — falling back to legacy Present\n", e.what());
                alphaCompositor.reset();
            }
        }

        // Seed the first paint (suppresses white-flash on startup; see
        // PoC visual gate notes in the task brief).
        InvalidateRect(hViewport, nullptr, FALSE);

        // Start the 4 Hz stats timer. Fires every 250 ms and emits a
        // stats/tick event to React so the status bar stays live.
        SetTimer(hwnd, kStatsTimerId, 250, nullptr);
        return 0;
    }

    case WM_TIMER:
        if (wp == kStatsTimerId && dispatcher)
        {
            float fps      = fpsMeasurer.getFPS();
            int emitters   = engine ? engine->GetNumEmitters()  : 0;
            int particles  = engine ? engine->GetNumParticles() : 0;
            int instances  = engine ? engine->GetNumInstances() : 0;
            dispatcher->EmitStatsTick(fps, emitters, particles, instances);
        }
        return 0;

    case WM_SIZE:
        ResizeWebViewToClient();
        return 0;

    case WM_MOVE:
        // FD8: when main moves, the viewport popup follows. Position
        // changes only — size stays cached.
        layout.RefreshScreenPosition();
        return 0;

    case WM_WINDOWPOSCHANGED:
        // FD8 polish: WM_WINDOWPOSCHANGED fires for every position/
        // size change BEFORE WM_SIZE / WM_MOVE / WM_PAINT.
        //
        // (1) PredictAndApply resizes the popup synchronously to
        //     match main's new client extent, using cached layout
        //     offsets.
        // (2) RenderD3D9 forces a Present after the swap chain is
        //     Reset. Without this, Windows' modal resize loop holds
        //     my PeekMessage idle pump and D3D9 never gets to render
        //     fresh — the popup just stretches the LAST presented
        //     frame, so a wider/taller resize reveals dark purple
        //     where the ground plane should be.
        if (hViewport)
        {
            layout.PredictAndApply();
            RenderD3D9();
        }
        break;  // fall through so DefWindowProc continues processing

    // FD8 polish: during the modal sizemove loop, WM_SIZE/WM_MOVE
    // fire continuously. Each one calls RefreshScreenPosition so
    // the popup tracks main's new position. The cached client-coord
    // rect from the last layout/viewport-rect message is the source
    // — React's ResizeObserver will fire AFTER the sizemove loop
    // exits, sending a fresh layout/viewport-rect, but in the
    // meantime the popup at least stays anchored to roughly the
    // right place via owner-client translation. No
    // WM_ENTERSIZEMOVE/EXITSIZEMOVE handling: hiding the popup
    // during resize just exposes the bare WebView2 transparent
    // region (which paints white through the parent's null brush),
    // which is worse than a slightly-stale-sized popup.

    case WM_DESTROY:
        KillTimer(hwnd, kStatsTimerId);
        if (webController)
        {
            // Unregister the accelerator hook before closing the controller
            // so the callback lambda (which captures `this`) is never invoked
            // after HostWindowImpl starts destructing.
            if (accelKeyTok.value != 0)
            {
                webController->remove_AcceleratorKeyPressed(accelKeyTok);
                accelKeyTok = {};
            }
            webController->Close();
            webController.Reset();
        }
        webView.Reset();
        // FD9b: detach the compositor from Engine BEFORE either is
        // destroyed so Render() (if scheduled before WM_QUIT drains
        // the queue) can't dereference a freed compositor. Drop the
        // compositor first since Engine owns the D3D9 device the
        // compositor's resources are bound to.
        if (engine) engine->SetAlphaCompositor(nullptr);
        layout.SetAlphaCompositor(nullptr);
        alphaCompositor.reset();
        // LT-4: engine owns its D3D9 device; just drop the engine and it
        // tears the device down in its destructor.
        engine.reset();
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProc(hwnd, msg, wp, lp);
}

LRESULT HostWindowImpl::ViewportWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
    switch (msg)
    {
    case WM_PAINT:
    {
        // LT-4: rendering happens on the main-loop idle path
        // (PeekMessage-drain → render). WM_PAINT just validates the
        // invalid region so Windows doesn't keep firing it. Same pattern
        // as legacy src/main.cpp's main loop, where WM_PAINT also does
        // nothing visible and the idle render owns the pipeline.
        PAINTSTRUCT ps;
        BeginPaint(hwnd, &ps);
        EndPaint(hwnd, &ps);
        return 0;
    }
    case WM_ERASEBKGND:
        // Suppress GDI erase — D3D9 owns the surface.
        return 1;

    // ---------------------------------------------------------------
    // LT-4 viewport interaction — camera controls.
    //
    // Mirrors the legacy handler at src/main.cpp:2917-3060. The math
    // for MOVE / ROTATE / ZOOM is lifted verbatim from legacy so the
    // user's muscle-memory carries over: drag delta scales /2.0f for
    // rotate (full-window-width drag ≈ 180°), distance/1000 for
    // MOVE multiplier, sqrt(olddist)-based scaling for ZOOM.
    //
    // Scope: camera only. The shift-click-to-spawn path
    // (legacy 2956) depends on the MouseCursor Object3D port and is
    // explicitly deferred. The status-bar mouse-coord push
    // (legacy 3041) is a Screen 1 polish item.
    //
    // Engine state emission: SetCamera bypasses the dispatcher
    // setter ladder, so we must call EmitEngineStateChanged()
    // ourselves after each mutation to keep React subscribers in
    // sync. View state is not file content — no markDirty here
    // (matches legacy, which never calls SetFileChanged for camera).
    // ---------------------------------------------------------------
    case WM_LBUTTONDOWN:
    {
        if (!engine) return 0;
        SetFocus(hwnd);
        // LT-4 polish: Shift+LMB also triggers cursor-bound spawn. The
        // legacy keydown-only path (case WM_KEYDOWN below) requires the
        // viewport HWND to have focus when Shift is pressed, but
        // WebView2 holds focus from the React UI by default — the
        // user's typical "shift-then-click" gesture swallows the
        // initial WM_KEYDOWN in WebView2 and the spawn never fires.
        // By trapping the click while MK_SHIFT is set, we provide a
        // click-based entry point that doesn't depend on WM_KEYDOWN
        // routing. Skip the camera drag so the spawn doesn't compete
        // with a MOVE drag. Release on Shift-keyup or LBUTTONUP — the
        // existing WM_KEYUP handler kills the attached instance.
        if ((wp & MK_SHIFT) && particleSystem && !particleSystem->getEmitters().empty()
            && m_attachedParticleSystem == nullptr)
        {
            int cx = (short)LOWORD(lp);
            int cy = (short)HIWORD(lp);
            m_lastCursorX = cx;
            m_lastCursorY = cy;
            D3DXVECTOR3 pos;
            GetCursorPos3D(engine.get(), (short)cx, (short)cy, pos);
            m_mouseCursor.SetPosition(pos);
            m_attachedParticleSystem =
                engine->SpawnParticleSystem(*particleSystem, &m_mouseCursor);
            return 0;
        }
        m_dragMode     = (wp & MK_CONTROL) ? DragMode::ZOOM : DragMode::MOVE;
        m_dragStartCam = engine->GetCamera();
        m_dragStartX   = (short)LOWORD(lp);
        m_dragStartY   = (short)HIWORD(lp);
        SetCapture(hwnd);
        return 0;
    }
    case WM_RBUTTONDOWN:
    {
        if (!engine) return 0;
        m_dragMode     = (wp & MK_CONTROL) ? DragMode::ZOOM : DragMode::ROTATE;
        m_dragStartCam = engine->GetCamera();
        m_dragStartX   = (short)LOWORD(lp);
        m_dragStartY   = (short)HIWORD(lp);
        SetCapture(hwnd);
        SetFocus(hwnd);
        return 0;
    }
    case WM_LBUTTONUP:
    case WM_RBUTTONUP:
    {
        m_dragMode = DragMode::NONE;
        ReleaseCapture();
        return 0;
    }
    case WM_CAPTURECHANGED:
    {
        // Capture lost (Alt-Tab away mid-drag, foreign SetCapture, etc.).
        // Drop drag state so the next mouse-move doesn't ride a stale
        // start camera.
        m_dragMode = DragMode::NONE;
        return 0;
    }
    case WM_MOUSEMOVE:
    {
        if (!engine) return 0;

        // LT-4 shift-click-to-spawn: always-update cursor block, regardless
        // of drag mode. Mirrors legacy src/main.cpp:2982-2987 — without
        // this, the attached ParticleSystemInstance (parented to
        // m_mouseCursor via Object3D) wouldn't track the mouse during
        // Shift-hold. Cache the (x,y) so WM_KEYDOWN can use it for the
        // spawn coords (WM_KEYDOWN's lParam is NOT mouse coords; legacy
        // bug at src/main.cpp:2960).
        int mx = (short)LOWORD(lp);
        int my = (short)HIWORD(lp);
        m_lastCursorX = mx;
        m_lastCursorY = my;
        D3DXVECTOR3 cursorWorld;
        GetCursorPos3D(engine.get(), (short)mx, (short)my, cursorWorld);
        m_mouseCursor.SetPosition(cursorWorld);

        // FD10 (Group A): push the world-space cursor to the React
        // status bar, throttled. 33 ms ≈ 30 Hz — fast enough to read,
        // slow enough that the bridge channel doesn't bottleneck.
        const DWORD now = GetTickCount();
        if (dispatcher && (now - m_lastCursorEmitTick) >= 33u)
        {
            m_lastCursorEmitTick = now;
            dispatcher->EmitCursorPosition3D(cursorWorld.x, cursorWorld.y, cursorWorld.z);
        }

        if (m_dragMode == DragMode::NONE) return 0;

        long x = mx - m_dragStartX;
        long y = my - m_dragStartY;

        Engine::Camera camera = m_dragStartCam;
        D3DXVECTOR3    orthVec;
        D3DXVECTOR3    diff = m_dragStartCam.Position - m_dragStartCam.Target;

        // Orthogonal vector in the camera plane (legacy line 2997-2998).
        D3DXVec3Cross(&orthVec, &diff, &camera.Up);
        D3DXVec3Normalize(&orthVec, &orthVec);

        if (m_dragMode == DragMode::ROTATE)
        {
            // Orbit Position around Target. Z rotation around camera-up
            // axis (horizontal drag); XY rotation around orthVec
            // (vertical drag). /2.0f keeps a full-window drag at ~180°.
            D3DXMATRIX rotateXY, rotateZ, rotate;
            D3DXMatrixRotationZ(&rotateZ, -D3DXToRadian(x / 2.0f));
            D3DXMatrixRotationAxis(&rotateXY, &orthVec, D3DXToRadian(y / 2.0f));
            D3DXMatrixMultiply(&rotate, &rotateXY, &rotateZ);
            D3DXVec3TransformCoord(&camera.Position, &diff, &rotate);
            camera.Position += camera.Target;
        }
        else if (m_dragMode == DragMode::MOVE)
        {
            // Translate Target (Position rides along). Multiplier scales
            // with distance so a far camera moves proportionally faster —
            // legacy comment: "Large distance: move a lot, small
            // distance: move a little".
            D3DXVECTOR3 Up;
            D3DXVec3Cross(&Up, &orthVec, &diff);
            D3DXVec3Normalize(&Up, &Up);

            float multiplier = D3DXVec3Length(&diff) / 1000;

            camera.Target  += (float)x * multiplier * orthVec;
            camera.Target  += (float)y * multiplier * Up;
            camera.Position = diff + camera.Target;
        }
        else if (m_dragMode == DragMode::ZOOM)
        {
            // Scale (Position - Target) by a sqrt(distance)-based
            // factor. Floor at 1.0f to prevent flipping through the
            // target. -y so dragging up zooms in (matches legacy).
            float olddist = D3DXVec3Length(&diff);
            float newdist = max(1.0f, olddist - sqrtf(olddist) * (float)-y);
            D3DXVec3Scale(&camera.Position, &diff, newdist / olddist);
            camera.Position += camera.Target;
        }

        engine->SetCamera(camera);
        if (dispatcher) dispatcher->EmitEngineStateChanged();
        return 0;
    }
    // -----------------------------------------------------------------
    // LT-4 shift-click-to-spawn — cursor-bound particle system.
    //
    // Hold Shift over the viewport to spawn an instance of the active
    // ParticleSystem parented to m_mouseCursor. Drag the mouse to fling
    // it around; release Shift to kill it. Matches legacy
    // src/main.cpp:2945-2966.
    //
    // Cursor-coords-on-KEYDOWN: WM_KEYDOWN's lParam is repeat-count +
    // scan-code + flags — NOT mouse coords. Legacy reads `LOWORD(lParam),
    // HIWORD(lParam)` and gets garbage; instead we use m_lastCursorX/Y
    // cached from WM_MOUSEMOVE. Fallback (cache stale or zero at boot):
    // GetCursorPos + ScreenToClient.
    // -----------------------------------------------------------------
    case WM_KEYDOWN:
    {
        if (wp != VK_SHIFT || !engine) break;
        // Filter auto-repeats. WM_KEYDOWN sets bit 30 of lParam on
        // repeat presses; clear bit 30 means initial press. Legacy
        // `(~lParam & 0x40000000)` test.
        if (lp & 0x40000000) return 0;
        // Spawn precondition: a non-empty ParticleSystem and no
        // attached instance already. Empty-system guard goes beyond
        // legacy's `particleSystem != NULL` to also require >= 1
        // root emitter — SpawnParticleSystem on an emitter-less system
        // misbehaves.
        if (m_attachedParticleSystem != nullptr) return 0;
        if (!particleSystem || particleSystem->getEmitters().empty()) return 0;

        // Resolve cursor coords. Prefer the cached MOUSEMOVE position;
        // fall back to GetCursorPos+ScreenToClient if the cache hasn't
        // been seeded (e.g. user pressed Shift before moving the mouse
        // over the viewport at all).
        int cx = m_lastCursorX;
        int cy = m_lastCursorY;
        if (cx == 0 && cy == 0)
        {
            POINT pt = {};
            if (GetCursorPos(&pt))
            {
                ScreenToClient(hwnd, &pt);
                cx = pt.x;
                cy = pt.y;
            }
        }

        D3DXVECTOR3 pos;
        GetCursorPos3D(engine.get(), (short)cx, (short)cy, pos);
        m_mouseCursor.SetPosition(pos);
        m_attachedParticleSystem =
            engine->SpawnParticleSystem(*particleSystem, &m_mouseCursor);
        return 0;
    }
    case WM_KEYUP:
    {
        if (wp != VK_SHIFT) break;
        if (m_attachedParticleSystem && engine)
        {
            engine->KillParticleSystem(m_attachedParticleSystem);
            m_attachedParticleSystem = nullptr;
        }
        return 0;
    }
    case WM_KILLFOCUS:
    {
        // Defensive: if the viewport loses focus while Shift is held
        // (Alt-Tab away, foreign focus steal), WM_KEYUP may never arrive
        // and the attached instance leaks. Drop it here.
        if (m_attachedParticleSystem && engine)
        {
            engine->KillParticleSystem(m_attachedParticleSystem);
            m_attachedParticleSystem = nullptr;
        }
        return 0;
    }
    case WM_DESTROY:
    {
        // Viewport HWND is going away. Defensively drop any attached
        // instance before the Engine tears down (Engine reset happens
        // on the main window's WM_DESTROY which fires after this).
        if (m_attachedParticleSystem && engine)
        {
            engine->KillParticleSystem(m_attachedParticleSystem);
            m_attachedParticleSystem = nullptr;
        }
        return 0;
    }

    case WM_MOUSEWHEEL:
    {
        // Wheel-zoom only when no drag is in progress (legacy line 3046).
        // wParam high word is the wheel delta in WHEEL_DELTA units (120).
        if (m_dragMode != DragMode::NONE || !engine) return 0;

        Engine::Camera camera = engine->GetCamera();
        D3DXVECTOR3    diff   = camera.Position - camera.Target;

        float olddist = D3DXVec3Length(&diff);
        float wheel   = (float)((SHORT)HIWORD(wp)) / (float)WHEEL_DELTA;
        float newdist = max(1.0f, olddist - sqrtf(olddist) * wheel);
        D3DXVec3Scale(&camera.Position, &diff, newdist / olddist);
        camera.Position += camera.Target;

        engine->SetCamera(camera);
        if (dispatcher) dispatcher->EmitEngineStateChanged();
        return 0;
    }
    }
    return DefWindowProc(hwnd, msg, wp, lp);
}

namespace {

LRESULT CALLBACK HostMainWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
    if (auto* self = reinterpret_cast<HostWindowImpl*>(g_self))
        return self->MainWndProc(hwnd, msg, wp, lp);
    return DefWindowProc(hwnd, msg, wp, lp);
}

LRESULT CALLBACK HostViewportWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
    if (auto* self = reinterpret_cast<HostWindowImpl*>(g_self))
        return self->ViewportWndProc(hwnd, msg, wp, lp);
    return DefWindowProc(hwnd, msg, wp, lp);
}

} // namespace

// ---------- Run ----------

int HostWindowImpl::Run(int nCmdShow)
{
    OpenLog();

    if (useTestHost)
    {
        Log("[host] === --test-host MODE: CDP on :9222 + DevTools enabled ===\n");
    }

    // LT-4 Task 1.4: when --dev-ui is requested, verify the Vite dev server
    // is reachable before proceeding. A missing server is a common mistake
    // (forgot to run `pnpm dev`) — fail fast with a clear message rather than
    // navigating to an empty page.
    if (useDevUi)
    {
        Log("[host] dev-ui: probing http://localhost:5174/ ...\n");
        if (!ProbeDevServer())
        {
            Log("[host] dev-ui: probe failed — server not reachable\n");
            CloseLog();
            MessageBoxW(nullptr,
                L"Dev UI mode requested but no dev server detected at http://localhost:5174.\n\n"
                L"Did you forget to run `pnpm dev` in `web/apps/editor/`?\n\n"
                L"Start the dev server in one terminal:\n"
                L"    cd web/apps/editor\n"
                L"    pnpm dev\n\n"
                L"Then relaunch ParticleEditor.exe --new-ui --dev-ui.",
                L"Dev UI server not detected",
                MB_OK | MB_ICONERROR);
            return 1;
        }
        Log("[host] dev-ui: probe OK — navigating to Vite server\n");
    }

    // DPI awareness — PMv2 so child-window coords are physical pixels and
    // match what React sends from getBoundingClientRect under WebView2.
    // The PoC ran with this and the visual gate passed.
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

    // COM init — WebView2 needs an STA. main.cpp doesn't call
    // CoInitializeEx before invoking host::Run, so we do it here.
    HRESULT coHr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    Log("[host] CoInitializeEx hr=0x%08lx\n", coHr);

    // LT-4 Task 1.5: verify the WebView2 Evergreen runtime is present before
    // creating any window. If missing the dialog is the only visible artifact.
    if (!WebView2RuntimeInstalled())
    {
        Log("[host] WebView2 runtime not found — showing install dialog\n");
        int r = MessageBoxW(nullptr,
            L"AloParticleEditor requires the Microsoft Edge WebView2 Runtime.\n\n"
            L"Install it from https://aka.ms/webview2 and relaunch.\n\n"
            L"Click OK to open the download page in your browser.\n"
            L"Click Cancel to exit.",
            L"WebView2 Runtime Required",
            MB_OKCANCEL | MB_ICONERROR);
        if (r == IDOK)
        {
            ShellExecuteW(nullptr, L"open", L"https://aka.ms/webview2",
                          nullptr, nullptr, SW_SHOWNORMAL);
        }
        CoUninitialize();
        CloseLog();
        return 1;
    }
    Log("[host] WebView2 runtime detected — proceeding\n");

    // B1.3.1.1: GDI+ init for AlphaCompositor::CaptureSnapshotPng (the
    // modal frosted-glass backdrop). One-time per process; matching
    // Gdiplus::GdiplusShutdown runs right before CoUninitialize at the
    // bottom of this function. The two earlier early-return paths
    // (CreateWindowEx failure, InitWebView2 failure) skip shutdown
    // because the process is dying anyway and the leaked allocation
    // is bounded.
    Gdiplus::GdiplusStartupInput gdiplusStartupInput;
    ULONG_PTR gdiplusToken = 0;
    Gdiplus::GdiplusStartup(&gdiplusToken, &gdiplusStartupInput, nullptr);

    g_self = this;

    WNDCLASSEXW wc{};
    wc.cbSize        = sizeof(wc);
    wc.lpfnWndProc   = HostMainWndProc;
    wc.hInstance     = hInstance;
    wc.hCursor       = LoadCursor(nullptr, IDC_ARROW);
    // IDI_LOGO == 109 in src/Resources/resource.h. Fall back to the
    // generic application icon if the resource isn't linked in (e.g.
    // running the host TU as part of a stripped-down test binary).
    wc.hIcon         = LoadIconW(hInstance, MAKEINTRESOURCEW(109));
    if (!wc.hIcon) wc.hIcon = LoadIconW(nullptr, IDI_APPLICATION);
    wc.lpszClassName = kHostWindowClassName;
    wc.style         = CS_HREDRAW | CS_VREDRAW;
    // FD8 polish: paint the parent in the same dark purple as the
    // D3D9 viewport's clear color (engine.cpp m_background default).
    // When the popup is briefly mispositioned during a window resize
    // — the popup tracks main on each WM_SIZE but its cached size
    // lags React's ResizeObserver — the uncovered area paints in
    // dark purple instead of the WebView2 transparent-region's white
    // default. Smoothly indistinguishable from the actual viewport
    // until React resends the rect.
    wc.hbrBackground = (HBRUSH)CreateSolidBrush(RGB(0x14, 0x08, 0x34));
    RegisterClassExW(&wc);

    WNDCLASSEXW vc{};
    vc.cbSize        = sizeof(vc);
    vc.lpfnWndProc   = HostViewportWndProc;
    vc.hInstance     = hInstance;
    vc.lpszClassName = kHostViewportClassName;
    vc.hbrBackground = nullptr;  // D3D9 owns the surface
    // Without an explicit hCursor on the popup's class, Windows
    // leaves whatever cursor was active when the pointer left the
    // previous window — so the main HWND's resize-edge cursor
    // would persist while hovering inside the viewport popup if
    // the user crossed in from the right border.
    vc.hCursor       = LoadCursor(nullptr, IDC_ARROW);
    RegisterClassExW(&vc);

    hMain = CreateWindowExW(
        0, kHostWindowClassName, L"AloParticleEditor",
        WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN,
        CW_USEDEFAULT, CW_USEDEFAULT, kInitialWidth, kInitialHeight,
        nullptr, nullptr, hInstance, nullptr);
    if (!hMain)
    {
        Log("[host] CreateWindowEx parent failed (gle=%lu)\n", GetLastError());
        g_self = nullptr;
        CoUninitialize();
        CloseLog();
        return 1;
    }

    // Construct dispatcher AFTER hMain exists (it captures the WebView2
    // pointer-to-PostWebMessageAsString via its EmitFn). engine ptr is
    // wired in WM_CREATE when the Engine is built.
    auto emitFn = [this](const std::string& js)
    {
        if (!webView) return;
        std::wstring w = Utf8ToUtf16(js);
        webView->PostWebMessageAsJson(w.c_str());
    };
    dispatcher = std::make_unique<BridgeDispatcher>(/*engine*/nullptr, layout, accelerator, emitFn);
    dispatcher->SetUndoStack(&undoStack);
    dispatcher->SetHostHwnd(hMain);
    // LT-4 D6: ModManager is already discovered + restored in the impl
    // ctor. Bind it so the dispatcher can service `mods/list`,
    // `mods/select`, `mods/refresh` and include `activeModPath` in
    // snapshots.
    dispatcher->SetModManager(modManager.get());

    // WM_CREATE fired during CreateWindowEx; viewport + engine now exist.
    // Wire the engine into the dispatcher (it was null when we constructed
    // the dispatcher because hMain hadn't been created yet). LayoutBroker
    // already received the engine inside WM_CREATE; re-binding here is a
    // defensive no-op for symmetry with the dispatcher path.
    if (engine)
    {
        dispatcher->SetEngine(engine.get());
        layout.SetEngine(engine.get());
    }

    // LT-4 host-state plumbing: construct the live ParticleSystem +
    // SpawnerDriver and hand pointer-to-pointer access to the
    // dispatcher. file/new and file/open below will swap the
    // particleSystem unique_ptr; the dispatcher reads through
    // `*m_pParticleSystem` to always see the current instance.
    // Mirrors legacy seed: DoNewFile() at src/main.cpp:1289 starts
    // with an empty ParticleSystem + one root emitter, so do the
    // same here for parity with the React UI's "fresh untitled" state.
    particleSystem = std::make_unique<ParticleSystem>();
    particleSystem->addRootEmitter();
    spawnerDriver  = std::make_unique<SpawnerDriver>();
    dispatcher->BindHostState(&particleSystem, spawnerDriver.get(), &fileManager);
    // LT-4 shift-click-to-spawn: expose the attached-system slot so
    // file/new + file/open can kill any in-flight cursor-bound instance
    // before swapping the ParticleSystem under it.
    dispatcher->BindAttachedSystem(&m_attachedParticleSystem);
    Log("[host] LT-4 host state bound (particleSystem + spawnerDriver)\n");

    HRESULT hr = InitWebView2();
    if (FAILED(hr))
    {
        wchar_t msg[256];
        swprintf(msg, 256,
                 L"WebView2 initialisation failed (0x%08lx).\n"
                 L"Is the Evergreen runtime installed?", hr);
        MessageBoxW(hMain, msg, L"AloParticleEditor", MB_ICONERROR);
        DestroyWindow(hMain);
        g_self = nullptr;
        CoUninitialize();
        CloseLog();
        return 1;
    }

    // B1.4 [NT-8] T4c: size the popup HWND to the main window's
    // full client rect just before showing the window. Without this,
    // the popup is stuck at CreateWindowExW's bootstrap rect
    // (screen 16,16,320,240) and renders as a tiny preview at the
    // monitor's top-left until the user first resizes. By this
    // point WM_CREATE has completed, the engine + AlphaCompositor +
    // particleSystem are fully bound, and Engine::Reset can handle
    // the resize cleanly.
    layout.ApplyFullClient();

    ShowWindow(hMain, nCmdShow);
    UpdateWindow(hMain);

    // LT-4 main loop: switched from blocking GetMessage to PeekMessage
    // idle-render. The blocking variant produces no continuous WM_PAINT
    // events, so the per-frame spawner tick + engine render had no driver.
    // Now: drain queued messages, then render once on idle, loop until
    // WM_QUIT. Mirrors legacy src/main.cpp:8023.
    //
    // No IsDialogMessage routing — the host has no modeless Win32
    // dialogs; tool panels live in React under WebView2 (which has its
    // own input routing and doesn't need TranslateAccelerator either).
    MSG m = {};
    bool quit = false;
    while (!quit)
    {
        while (PeekMessage(&m, nullptr, 0, 0, PM_REMOVE))
        {
            TranslateMessage(&m);
            DispatchMessage(&m);
            if (m.message == WM_QUIT)
            {
                quit = true;
            }
        }
        if (quit) break;

        // Idle: render one frame. Cheap enough to always run (Engine has
        // its own paused / IsPreviewPaused gates that skip the simulation
        // step when set; render still presents to keep the surface valid).
        if (engine)
        {
            RenderD3D9();
        }
        else
        {
            // No engine yet — yield rather than spin so WebView2 / WM_TIMER
            // get pump cycles. WM_TIMER will arrive in the PeekMessage
            // drain above (stats timer is 250ms).
            WaitMessage();
        }
    }

    g_self = nullptr;
    // B1.3.1.1: matching shutdown for the GdiplusStartup above. Safe
    // here because the message pump has drained: no dispatcher
    // handlers (CaptureSnapshotPng et al) can run after WM_QUIT.
    if (gdiplusToken) Gdiplus::GdiplusShutdown(gdiplusToken);
    CoUninitialize();
    CloseLog();
    return static_cast<int>(m.wParam);
}

// -----------------------------------------------------------------------------
// HostWindow public surface
// -----------------------------------------------------------------------------

HostWindow::HostWindow(HINSTANCE hInstance,
                       ITextureManager& textureManager,
                       IShaderManager&  shaderManager,
                       IFileManager&    fileManager,
                       const std::vector<std::wstring>& gameRoots,
                       bool useDevUi,
                       bool useTestHost)
    : m_impl(new HostWindowImpl(hInstance, textureManager, shaderManager, fileManager,
                                gameRoots, useDevUi, useTestHost))
{
}

HostWindow::~HostWindow()
{
    delete static_cast<HostWindowImpl*>(m_impl);
    m_impl = nullptr;
}

int HostWindow::Run(int nCmdShow)
{
    return static_cast<HostWindowImpl*>(m_impl)->Run(nCmdShow);
}

// -----------------------------------------------------------------------------
// host::Run entry point
// -----------------------------------------------------------------------------

int Run(HINSTANCE hInstance,
        int nCmdShow,
        ITextureManager& textureManager,
        IShaderManager&  shaderManager,
        IFileManager&    fileManager,
        const std::vector<std::wstring>& gameRoots,
        bool useDevUi,
        bool useTestHost)
{
    HostWindow host(hInstance, textureManager, shaderManager, fileManager,
                    gameRoots, useDevUi, useTestHost);
    return host.Run(nCmdShow);
}

} // namespace host
