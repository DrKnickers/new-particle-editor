// Entry point for the LT-4 new-UI host. Invoked from WinMain when the
// `--new-ui` command-line flag is present. Constructs the hybrid
// WebView2 + D3D9 composition window, owns the Engine instance for
// the session, and runs the host message pump.
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
        IFileManager&    fileManager);

} // namespace host

#endif // HOST_RUN_H
