// Entry point for the LT-4 new-UI host. Invoked from WinMain when the
// `--new-ui` command-line flag is present. Constructs the hybrid
// WebView2 + D3D9 composition window, owns the Engine instance for
// the session, and runs the host message pump.
//
// useDevUi — when true, probe http://localhost:5174 (Vite dev server)
// and navigate there instead of the bundled app.local build. If the
// probe fails the function shows a MessageBox and returns 1 immediately.
//
// useTestHost — when true (Task 2.2), pass
// `--remote-debugging-port=9222` to WebView2 via the environment's
// AdditionalBrowserArguments and enable DevTools (F12). This exposes a
// CDP endpoint for Playwright contract tests. Opt-in only: production
// launches (no flag) never expose the port.
//
// Returns the WM_QUIT wParam (process exit code).
#ifndef HOST_RUN_H
#define HOST_RUN_H

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

class ITextureManager;
class IShaderManager;
class IFileManager;

namespace host {

int Run(HINSTANCE hInstance,
        int nCmdShow,
        ITextureManager& textureManager,
        IShaderManager&  shaderManager,
        IFileManager&    fileManager,
        bool useDevUi   = false,
        bool useTestHost = false);

} // namespace host

#endif // HOST_RUN_H
