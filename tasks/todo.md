# Shift-click-to-spawn — LT-4 follow-up (2026-05-17)

## Goal & scope

**In:** Port legacy shift-hold-to-spawn-cursor-bound-particle-system flow
into the `--new-ui` host viewport. Factor `MouseCursor` and
`GetCursorPos3D` into headers shared with `--legacy-ui`.

**Out:** Wireframe cursor render (deferred polish), multi-spawn-per-hold
(defer until usage confirmed), status-bar cursor coord push.

## Approach

1. New `src/MouseCursor.h` — class + `GetCursorPos3D` verbatim, `#include "engine.h"`.
2. Strip `src/main.cpp` static class/fn; `#include "MouseCursor.h"`.
3. Register in vcxproj/filters.
4. HostWindowImpl gets `m_mouseCursor`, `m_attachedParticleSystem`, `m_lastCursorX/Y`.
5. ViewportWndProc: WM_KEYDOWN/UP VK_SHIFT (cache-based coords), WM_MOUSEMOVE always-update, WM_KILLFOCUS cleanup.
6. RenderD3D9: `m_mouseCursor.UpdateVelocity()` before `engine->Update()`.
7. WM_DESTROY: kill attached if present.
8. BridgeDispatcher: `BindAttachedSystem(ParticleSystemInstance**)` so file/new + file/open can null/kill.

## Verification

- `pnpm build` exits 0.
- `pnpm test` — 74 Vitest unchanged.
- MSBuild Debug x64 exits 0.
- `pnpm test:native` — 48 Playwright unchanged.
