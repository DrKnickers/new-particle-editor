#include "LayoutBroker.h"

namespace host {

void LayoutBroker::Apply(int x, int y, int w, int h)
{
    if (!m_viewport) return;
    if (w <= 0 || h <= 0)
    {
        // Slot collapsed (e.g. sidebar fully expanded over viewport).
        // Move the viewport off-screen-ish but keep it valid so the next
        // non-degenerate rect re-shows it cleanly.
        SetWindowPos(m_viewport, HWND_TOP, x, y, 1, 1,
                     SWP_NOACTIVATE);
        return;
    }
    SetWindowPos(m_viewport, HWND_TOP, x, y, w, h, SWP_NOACTIVATE);
    InvalidateRect(m_viewport, nullptr, FALSE);
}

} // namespace host
