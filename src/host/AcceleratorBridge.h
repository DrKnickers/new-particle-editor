// AcceleratorBridge — pre-translates accelerator key combos before
// WebView2 swallows them in its child HWND. Full implementation lands
// in Task 1.6; for Task 1.3 this is a stub so HostWindow can declare
// a member without #ifdef churn.
#ifndef HOST_ACCELERATOR_BRIDGE_H
#define HOST_ACCELERATOR_BRIDGE_H

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <string>

namespace host {

class AcceleratorBridge
{
public:
    AcceleratorBridge() = default;

    // TODO Task 1.6: register a combo such as "Ctrl+Z" or "Ctrl+Shift+Z"
    // and emit an `accelerator/pressed` event when the matching keystroke
    // reaches the host's message pump (before being forwarded to WebView2).
    void RegisterCombo(const std::string& /*combo*/) { /* stub */ }

    // TODO Task 1.6: called from the host pump before TranslateMessage
    // to decide whether to swallow / forward the keystroke.
    bool PreTranslate(MSG* /*msg*/) { return false; }
};

} // namespace host

#endif // HOST_ACCELERATOR_BRIDGE_H
