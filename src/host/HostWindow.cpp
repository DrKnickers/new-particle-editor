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
#include "BridgeDispatcher.h"
#include "HostBridgeProxy.h"
#include "LayoutBroker.h"

#include "../engine.h"
#include "../managers.h"
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
    IDirect3D9*      d3d           = nullptr;
    IDirect3DDevice9* device       = nullptr;

    ComPtr<ICoreWebView2Controller> webController;
    ComPtr<ICoreWebView2>           webView;
    EventRegistrationToken          accelKeyTok = {};

    ITextureManager& textureManager;
    IShaderManager&  shaderManager;
    IFileManager&    fileManager;
    std::unique_ptr<Engine> engine;

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

    bool        useDevUi   = false;  // --dev-ui: navigate to Vite HMR server
    bool        useTestHost = false; // --test-host: CDP :9222 + DevTools
    FILE*       logFile = nullptr;
    std::mutex  logMutex;

    HostWindowImpl(HINSTANCE inst,
                   ITextureManager& tex,
                   IShaderManager&  shd,
                   IFileManager&    fil,
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
    {
    }

    void Log(const char* fmt, ...);
    void OpenLog();
    void CloseLog();

    bool InitD3D9();
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

bool HostWindowImpl::InitD3D9()
{
    d3d = Direct3DCreate9(D3D_SDK_VERSION);
    if (!d3d)
    {
        Log("[host] Direct3DCreate9 failed\n");
        return false;
    }

    D3DPRESENT_PARAMETERS pp = {};
    pp.Windowed              = TRUE;
    pp.SwapEffect            = D3DSWAPEFFECT_DISCARD;
    pp.BackBufferFormat      = D3DFMT_UNKNOWN;
    pp.hDeviceWindow         = hViewport;
    pp.PresentationInterval  = D3DPRESENT_INTERVAL_IMMEDIATE;
    pp.EnableAutoDepthStencil = FALSE;

    HRESULT hr = d3d->CreateDevice(
        D3DADAPTER_DEFAULT, D3DDEVTYPE_HAL, hViewport,
        D3DCREATE_HARDWARE_VERTEXPROCESSING, &pp, &device);
    if (FAILED(hr))
    {
        Log("[host] CreateDevice HWVP failed 0x%08lx, trying MIXED\n", hr);
        hr = d3d->CreateDevice(
            D3DADAPTER_DEFAULT, D3DDEVTYPE_HAL, hViewport,
            D3DCREATE_MIXED_VERTEXPROCESSING, &pp, &device);
    }
    if (FAILED(hr))
    {
        Log("[host] CreateDevice MIXED failed 0x%08lx, trying SOFTWARE\n", hr);
        hr = d3d->CreateDevice(
            D3DADAPTER_DEFAULT, D3DDEVTYPE_HAL, hViewport,
            D3DCREATE_SOFTWARE_VERTEXPROCESSING, &pp, &device);
    }
    if (FAILED(hr))
    {
        Log("[host] CreateDevice all paths failed 0x%08lx\n", hr);
        d3d->Release();
        d3d = nullptr;
        return false;
    }
    Log("[host] D3D9 device created OK\n");
    return true;
}

void HostWindowImpl::RenderD3D9()
{
    if (!device) return;

    // For Task 1.3 we don't run the engine's render loop yet (Phase 3
    // wiring). Clear to the engine's current background colour so the
    // viewport visibly carries Engine state — a quick eyeball check that
    // the snapshot path is reading the right data.
    DWORD clear = 0xFF101820u; // dark slate fallback
    if (engine)
    {
        COLORREF bg = engine->GetBackground();      // 0x00BBGGRR
        BYTE r = GetRValue(bg);
        BYTE g = GetGValue(bg);
        BYTE b = GetBValue(bg);
        clear = D3DCOLOR_XRGB(r, g, b);
    }
    device->Clear(0, nullptr, D3DCLEAR_TARGET, clear, 1.0f, 0);
    device->BeginScene();
    device->EndScene();
    device->Present(nullptr, nullptr, nullptr, nullptr);
}

// ---------- WebView2 ----------

void HostWindowImpl::ResizeWebViewToClient()
{
    if (!webController) return;
    RECT r;
    GetClientRect(hMain, &r);
    webController->put_Bounds(r);
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
        // Create the D3D9 viewport child sibling. Initial size 320×240 so
        // the visual is non-degenerate even before React's first layout
        // message arrives. SetWindowPos with HWND_TOP after creation puts
        // it above WebView2 in z-order, so it composes on top of the
        // transparent slot.
        hViewport = CreateWindowExW(
            0, kHostViewportClassName, L"",
            WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS,
            16, 16, 320, 240, hwnd, nullptr,
            hInstance, nullptr);
        if (!hViewport)
        {
            Log("[host] CreateWindowExW viewport failed (gle=%lu)\n", GetLastError());
            return -1;
        }
        layout.SetViewport(hViewport);

        if (!InitD3D9())
        {
            MessageBoxW(hwnd, L"Direct3D 9 initialisation failed.",
                        L"AloParticleEditor", MB_ICONERROR);
            return -1;
        }

        SetWindowPos(hViewport, HWND_TOP, 0, 0, 0, 0,
                     SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);

        // Construct the Engine now that both HWNDs exist. hFocus = parent,
        // hDevice = viewport child — same wiring as legacy main.cpp.
        try
        {
            engine = std::make_unique<Engine>(
                hwnd, hViewport, textureManager, shaderManager, fileManager);
            if (dispatcher) dispatcher->SetEngine(engine.get());
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

        // Seed the first paint (suppresses white-flash on startup; see
        // PoC visual gate notes in the task brief).
        InvalidateRect(hViewport, nullptr, FALSE);
        return 0;
    }

    case WM_SIZE:
        ResizeWebViewToClient();
        return 0;

    case WM_DESTROY:
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
        if (device)  { device->Release();  device = nullptr; }
        if (d3d)     { d3d->Release();     d3d    = nullptr; }
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
        PAINTSTRUCT ps;
        BeginPaint(hwnd, &ps);
        RenderD3D9();
        EndPaint(hwnd, &ps);
        return 0;
    }
    case WM_ERASEBKGND:
        // Suppress GDI erase — D3D9 owns the surface.
        return 1;
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
    wc.hbrBackground = nullptr;
    RegisterClassExW(&wc);

    WNDCLASSEXW vc{};
    vc.cbSize        = sizeof(vc);
    vc.lpfnWndProc   = HostViewportWndProc;
    vc.hInstance     = hInstance;
    vc.lpszClassName = kHostViewportClassName;
    vc.hbrBackground = nullptr;
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

    // WM_CREATE fired during CreateWindowEx; viewport + engine now exist.
    // Wire the engine into the dispatcher (it was null when we constructed
    // the dispatcher because hMain hadn't been created yet).
    if (engine) dispatcher->SetEngine(engine.get());

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

    ShowWindow(hMain, nCmdShow);
    UpdateWindow(hMain);

    MSG m;
    while (GetMessage(&m, nullptr, 0, 0))
    {
        TranslateMessage(&m);
        DispatchMessage(&m);
    }

    g_self = nullptr;
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
                       bool useDevUi,
                       bool useTestHost)
    : m_impl(new HostWindowImpl(hInstance, textureManager, shaderManager, fileManager,
                                useDevUi, useTestHost))
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
        bool useDevUi,
        bool useTestHost)
{
    HostWindow host(hInstance, textureManager, shaderManager, fileManager,
                    useDevUi, useTestHost);
    return host.Run(nCmdShow);
}

} // namespace host
