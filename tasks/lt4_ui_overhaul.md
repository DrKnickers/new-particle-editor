# LT-4 — UI Overhaul (WebView2 + React hybrid) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Phases 0–2 are fully detailed and TDD-style; Phase 3 is a per-screen *template* applied iteratively as design settles; Phase 4 is cutover/cleanup.

**Goal:** Replace AloParticleEditor's Win32 chrome (~18 KLOC of `main.cpp` + `src/UI/*`) with a WebView2-hosted React UI that talks to the existing C++ engine and data layer over a JSON message bridge. The D3D9 viewport stays a native sibling HWND positioned by React's layout. The 8201-line `main.cpp` collapses to a thin host (window class, WebView2 init, D3D9 device, bridge dispatcher, message loop). The plan front-loads the foundation so design iteration can happen entirely in a browser with hot reload, *decoupled from native rebuilds*.

**Architecture:** Three-layer split.
1. **C++ core (unchanged)** — `Engine`, `ParticleSystem(Instance)`, `Emitter(Instance)`, `LinkGroup`, `UndoStack`, `ChunkReader/Writer`, `FileManager`, `Autosave`, `Rescale`. Already independent of Win32.
2. **C++ host (new, replaces `main.cpp` + `src/UI/*`)** — owns the top-level HWND, the D3D9 viewport child HWND, a WebView2 control sibling, and a bridge dispatcher that exposes the core to JS over `chrome.webview.postMessage`.
3. **React UI (new)** — Vite + React + TypeScript + Tailwind + shadcn/ui. Builds two ways:
   - **`pnpm dev`** runs the React app in a regular browser against a TypeScript mock bridge that replays canned `.alo` data and logs writes. Design iteration happens here, hot-reload, no native rebuild.
   - **Production build** outputs static assets that WebView2 loads via `SetVirtualHostNameToFolderMapping`. The bridge implementation is the real C++ bridge.

The mock and real bridges implement the same TypeScript `Bridge` interface, sharing one schema source of truth — `packages/bridge-schema/` types are imported by *both* the React app and (via JSON schema codegen) the C++ host. This is the lever that lets design iterate without native code churn.

**Tech Stack:** WebView2 (Evergreen runtime), C++17 (existing), Vite 5, React 19, TypeScript 5.x, Tailwind 4, shadcn/ui, Zustand for client state, Vitest for React unit tests, Playwright for browser-mode UI smoke. Bridge wire format: JSON over `chrome.webview.postMessage`, request/response with correlation IDs + a pub/sub stream for engine events.

**Scope.**
- **In**: replace every screen, dialog, menu, toolbar, status bar, custom control (`EmitterList`, `CurveEditor`, `TrackEditor`, `Spinner`, `ColorButton`, `TexturePalette`, `RandomParam`) with a React equivalent. Keep file-open/save dialogs as native `GetOpenFileName` calls invoked over the bridge (no upside to re-implementing inside WebView2). Keep accelerator pass-through so Ctrl+S/Ctrl+Z/Shift-click viewport behaviour matches today.
- **Out**: any change to the `.alo` format, the D3D9 renderer, the undo model, the file manager, the spawner, or the autosave system. The engine is canonical. The plan rewrites *the chrome* and nothing else.
- **Out — deferred**: German localisation parity. Ship English-only first; i18n hook (i18next) wired in but only `en.json` populated. The existing `.de.h` resource file becomes the second populated locale post-cutover. Reason: localisation is a translation pass, not architecture, and we don't want it gating the rewrite.
- **Out — deferred**: design polish on screens we haven't iterated yet. Each screen has its own design checkpoint (see Phase 3); we do not pre-commit to a final look.
- **Out — explicit decision**: cubemap skydomes, "skydome contributes to bloom" toggle, skydome → sun-direction coupling (handoff §"Open questions / deferrals"). Out unless the user re-prioritises.

---

## What the codebase already gives us

Verified by reading [src/engine.h](src/engine.h:1-422), [src/main.cpp:1-120](src/main.cpp:1-120), and surveying `src/` + `src/UI/` listings.

| Capability | Where | Notes |
|---|---|---|
| Particle data model | [src/ParticleSystem.h](src/ParticleSystem.h:1), [src/Effect.h](src/Effect.h:1) | UI-independent. Used by both engine and serialisation. |
| Emitter clone via memory buffer | `Emitter::write(copy=true)` + `Emitter(ChunkReader&)` via `MemoryFile` | LT-3 proved this works for cross-document import. The bridge will use the same pattern for clipboard/duplicate operations. |
| Undo stack | [src/UndoStack.h](src/UndoStack.h:1) | C++ owns it. React triggers `Undo`/`Redo`, then re-fetches state. |
| File I/O + mod resolution | [src/files.h](src/files.h:1), `IFileManager` | `Engine` constructor already takes `IFileManager&` — the bridge dispatcher can call through it for thumbnails, asset listing, mod-aware texture lookups. |
| Engine model surface | [src/engine.h:96-256](src/engine.h:96-256) | `Get*`/`Set*` pairs for camera, ground, skydome, bloom, lights, ambient, shadow, gravity, wind. Already the API the bridge needs — no refactor required. |
| Autosave | [src/Autosave.h](src/Autosave.h:1) | Driven by a timer; bridge will need to expose its "dirty" signal to React for the title bar's `*` indicator. |
| Rescale | [src/Rescale.h](src/Rescale.h:1) | Standalone batch op; one bridge command. |
| Spawner | [src/SpawnerDriver.h](src/SpawnerDriver.h:1) | Continuous spawning preview mode. Bridge exposes start/stop + parameters. |

What's *not* given us: any prior Win32→Web bridge work, any TypeScript anywhere in the repo, any package manager (no `package.json`, no `node_modules`). All of this is greenfield in `web/` and `src/host/`. The MSBuild `.vcxproj` will need a new project (or a custom target in the existing one) that runs `pnpm build` and packages `web/dist/` into the binary's runtime directory.

The 8201-line `main.cpp` is the *only* file that has to die for this overhaul to work. The 7 custom controls in `src/UI/` die with it — they're each replaced by a React component. The `src/Resources/*.rc` menu/dialog templates mostly die too; the `.bmp`/`.dds`/`.ico` assets stay as plain files referenced from React.

---

## Architecture / implementation approach

### Layer responsibilities

```
┌─────────────────────────────────────────────────────────────┐
│ ParticleEditor.exe (single binary)                          │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ C++ host (src/host/, replaces main.cpp + src/UI/)    │   │
│  │  - WinMain, top-level window class                   │   │
│  │  - D3D9 device + viewport child HWND                 │   │
│  │  - WebView2 control sibling HWND                     │   │
│  │  - BridgeDispatcher: dispatches inbound JSON to      │   │
│  │    command handlers, serialises outbound events      │   │
│  │  - LayoutBroker: receives "place viewport at         │   │
│  │    (x,y,w,h)" from React, calls SetWindowPos on the  │   │
│  │    viewport HWND                                     │   │
│  │  - AcceleratorBridge: intercepts WM_KEYDOWN/         │   │
│  │    WM_SYSKEYDOWN before WebView2 swallows them; the  │   │
│  │    bridge forwards to React for shortcut dispatch    │   │
│  └──────────────────────────────────────────────────────┘   │
│                       │                                      │
│                       │ chrome.webview.postMessage (JSON)    │
│                       ▼                                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ WebView2 (Evergreen runtime, OS-provided)            │   │
│  │  loads web/dist/index.html via                       │   │
│  │  SetVirtualHostNameToFolderMapping                   │   │
│  └──────────────────────────────────────────────────────┘   │
│                       │                                      │
│                       ▼                                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ React app (web/, new Vite project)                   │   │
│  │  - Bridge interface (TS)                             │   │
│  │  - NativeBridge impl (chrome.webview.postMessage)    │   │
│  │  - MockBridge impl (fixtures + in-memory state)      │   │
│  │  - <ViewportSlot> publishes its rect to the bridge   │   │
│  │    via ResizeObserver → LayoutBroker positions the   │   │
│  │    sibling D3D9 HWND inside the visual hole          │   │
│  │  - Screens (EmitterTree, CurveEditor, TrackEditor,   │   │
│  │    ColorPicker, TexturePalette, Spinner …)           │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ C++ core (unchanged): Engine, ParticleSystem(Instance),│  │
│  │  Emitter, LinkGroup, UndoStack, ChunkReader/Writer,  │   │
│  │  FileManager, Autosave, Rescale, SpawnerDriver.       │   │
│  │  Bridge command handlers call into here.             │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Bridge contract (the single most important interface)

One source of truth, three consumers (TypeScript app, TypeScript mock, C++ host).

```ts
// web/packages/bridge-schema/src/index.ts
export type RequestId = string;  // UUID v4

// Requests: JS → host (host returns a response).
export type Request =
  | { kind: "file/open";              params: { path?: string } }   // path undef = native picker
  | { kind: "file/save";              params: { path?: string } }   // path undef = native picker
  | { kind: "file/recent/list";       params: {} }
  | { kind: "engine/state/snapshot";  params: {} }                 // full read for first paint
  | { kind: "engine/set/ground-z";    params: { z: number } }
  | { kind: "engine/set/background";  params: { rgb: number } }
  | { kind: "engine/set/skydome";     params: { slot: number } }
  // ... one variant per Engine setter, named by domain
  | { kind: "emitters/list";          params: {} }                  // returns EmitterTreeDto
  | { kind: "emitters/select";        params: { id: number | null } }
  | { kind: "emitters/update";        params: { id: number; patch: EmitterPatchDto } }
  | { kind: "emitters/import-from-file"; params: { path: string; selected: number[] } }
  | { kind: "undo/perform";           params: { direction: "undo" | "redo" } }
  | { kind: "layout/viewport-rect";   params: { x: number; y: number; w: number; h: number } }
  | { kind: "spawner/start";          params: SpawnerParamsDto }
  | { kind: "spawner/stop";           params: {} }
  ;

// Events: host → JS (host pushes, JS subscribes).
export type Event =
  | { kind: "engine/state/changed";   payload: EngineStateDto }     // full state after any setter
  | { kind: "emitters/tree/changed";  payload: EmitterTreeDto }
  | { kind: "emitters/selected";      payload: { id: number | null } }
  | { kind: "stats/tick";             payload: { fps: number; emitters: number; particles: number; instances: number } }  // 4 Hz
  | { kind: "dirty/changed";          payload: { dirty: boolean } }
  | { kind: "undo/changed";           payload: { canUndo: boolean; canRedo: boolean; label?: string } }
  | { kind: "accelerator/pressed";    payload: { combo: string } }  // host-detected, before WebView2 sees it
  | { kind: "spawner/active-count";   payload: { count: number } }
  ;

export interface Bridge {
  request<R extends Request>(req: R): Promise<ResponseFor<R>>;
  on<K extends Event["kind"]>(kind: K, h: (e: Extract<Event, { kind: K }>) => void): () => void;
}
```

The C++ side parses `Request`, dispatches on `kind`, calls into `Engine`/`ParticleSystem`/etc, returns a JSON response. It also emits `Event` messages on its own schedule (state changes, stats tick).

### Why a "mock bridge" is non-negotiable

Native rebuilds are slow and design churn is high — the user explicitly said the Designer mockup was wrong. If every design tweak required `msbuild` + relaunch, iteration cycles would be 30–60 s each. With a mock bridge driving the same React app from a regular `pnpm dev` server, iteration is sub-second HMR.

The mock isn't a toy. It implements the full `Bridge` interface, owns an in-memory `EngineStateDto`, mutates it on writes, fires the corresponding `engine/state/changed` event, and loads fixture `.alo` data from JSON. It also has a debug panel that lets the user inject latency, force-error specific commands, or replay scripted scenarios. That's all there for design iteration to *feel* like talking to the real thing.

### Viewport composition strategy

WebView2 can host child HWNDs only awkwardly (it owns its own composition tree). The proven pattern is: the **top-level window has two child HWNDs** — a WebView2 host control and a `STATIC` (or owner-drawn) class hosting the D3D9 viewport. React renders a `<ViewportSlot>` `<div>` in its layout that takes up exactly the visual area the viewport should occupy. A `ResizeObserver` on that div fires whenever the layout changes; the bridge sends `layout/viewport-rect` with the div's screen-space rect; the C++ `LayoutBroker` calls `SetWindowPos` on the viewport child to match. Z-order is fixed at window creation (viewport above WebView2 in z, with `WS_CLIPSIBLINGS` so it punches a hole).

This is **the single biggest technical risk**, so Phase 1 includes a hard-gate proof-of-concept before any other work begins.

### Accelerator handling

Today's editor handles `WM_KEYDOWN` directly. WebView2 swallows most input when focused. Solution: in the host's pre-translate path (`ICoreWebView2AcceleratorKeyPressedEventArgs`), intercept and either:
1. Pass through to standard handling (typing in inputs, Tab navigation),
2. Or, for known shortcuts, dispatch as an `accelerator/pressed` event so React reacts.

The set of "known shortcuts" is defined in TypeScript and pushed to the host at startup via a `register-accelerators` request. This way React owns the shortcut dictionary; the host is dumb.

### State sync model

Two channels:
- **Snapshots** (request `engine/state/snapshot`, response `EngineStateDto`): first paint and any time React suspects drift.
- **Events** (push `engine/state/changed`, fine-grained `emitters/tree/changed`, high-frequency `stats/tick`): the C++ side fires these whenever its model mutates. React's Zustand store reduces them into observable slices.

No optimistic UI for engine writes. React sends `engine/set/*`, the host writes, the host re-broadcasts state, React reflects. Round-trip is sub-millisecond inside one process, so the user perceives no lag.

### How files end up in the binary

`web/dist/` (Vite output) gets copied next to `ParticleEditor.exe` by a post-build step. WebView2's `SetVirtualHostNameToFolderMapping("app.local", "<exe-dir>/web", CORS_ALLOW_ALL)` exposes them at `https://app.local/`. Production navigates there; dev navigates to `http://localhost:5173`. A `--dev-ui` flag flips the host between the two.

Hot reload during native dev: run `pnpm dev` in one terminal, launch `ParticleEditor.exe --dev-ui` in another. Edit a `.tsx` file, see it reload inside the running editor. Same React build runs in browser-only mode for design iteration.

### Legacy UI cohabitation

The new host gets a `--legacy-ui` flag during Phases 1–3 that launches the old `main.cpp` UI instead. This keeps the editor fully usable throughout the migration. Phase 4 deletes the legacy path.

---

## Risks named up front + mitigations

This is a ★★★★★ item. Walking through hazards before coding.

1. **WebView2 + D3D9 sibling-HWND composition is the hard gate.** If it doesn't work — if the viewport flickers, z-order fights, or the GPU device contexts collide — the whole approach is dead. Mitigation: **Phase 1 Task 1 is a proof-of-concept binary** (`viewport_poc.exe`) that does *nothing* but open a top-level window, embed WebView2 with a one-page React shell containing a coloured `<div>` as the viewport slot, and render a D3D9 clear-colour-to-blue viewport as a sibling child positioned to match. Acceptance: the blue D3D9 area moves and resizes correctly as the React `<div>` reflows (resize the window; the viewport tracks the div without flicker). If this fails, plan stops and we revisit the architecture (most likely fallback: render D3D9 to a shared DXGI texture and composite via WebView2's `addHostObject` + `<canvas>` upload — but that's a separate, much more complex spike).

2. **Bridge schema drift between mock and real.** Easy failure mode: mock bridge implements a command differently from the host. Mitigation: **`web/packages/bridge-schema/` is the single source of truth**, imported by both bridges. CI runs `tsc --noEmit` on the whole monorepo. Additionally a `bridge-contract.test.ts` runs both bridges through the same sequence of commands and asserts identical observable outputs for stateless reads; for stateful writes, asserts that emitted events match shape.

3. **Custom-control behavioural parity (esp. `CurveEditor`, `TrackEditor`, `EmitterList`).** Each of these is a non-trivial 2D interactive editor with click/drag/keyboard logic. Mitigation: **migrate one screen at a time** with a design checkpoint per screen. The plan does not commit to specific React implementations of these controls up front — Phase 3 defines a *template* and applies it screen-by-screen. The simpler screens (toolbar buttons, the Lighting dialog) go first to validate the bridge before tackling `CurveEditor`.

4. **WebView2 Evergreen runtime availability.** Win11 has it pre-installed. Win10 builds older than 1809 do not. Mitigation: detect at startup with `GetAvailableCoreWebView2BrowserVersionString`; if missing, show a single dialog with a download link and exit. Bundle the bootstrapper (`MicrosoftEdgeWebview2Setup.exe`, ~2 MB) in the release zip alongside `d3dx9_43.dll`. Update install instructions in `README.md` and release notes.

5. **Keyboard accelerators / focus.** Editor depends on Ctrl+S, Ctrl+Z, Ctrl+Shift+Z, Delete, arrow keys (camera), Shift+click (viewport spawn), drag-and-drop file open. Mitigation: explicit accelerator pass-through (see "Accelerator handling" above). Phase 1's smoke test includes a checklist of every existing shortcut, verified working in the hybrid. Drag-and-drop is handled by the host on the top-level window's `WM_DROPFILES`, forwarded to React as a `file/dropped` event.

6. **Undo across the bridge.** Round-trips are cheap in-process, but if the bridge serialises a full state snapshot on every undo step that's 50–500 KB of JSON per Ctrl+Z. Mitigation: undo emits a *delta* event (`engine/state/changed` with a `changedFields` whitelist) when feasible; full snapshot only for batch ops (Import Emitters, Rescale). Measure with the spawner stress fixture; if a Ctrl+Z still takes >16 ms (one frame), shrink the event payload.

7. **Two-process dev mode confusion.** `pnpm dev` in one terminal, `ParticleEditor.exe --dev-ui` in another. Engineers will forget to start the dev server. Mitigation: when the editor launches with `--dev-ui`, it pings `http://localhost:5173` first; if no response, shows a clear "did you forget to run `pnpm dev`?" dialog with the command to copy.

8. **Scope creep / never-ships syndrome.** Multi-week rewrites die when they try to land in one PR. Mitigation: **each screen ships as its own feature behind its own flag**, with the legacy UI still reachable via `--legacy-ui`. The hybrid is usable from the end of Phase 2 (host + bridge + one screen). Every subsequent screen is independently mergeable. The user can call "we're done" at any point and ship a partial migration.

9. **CHANGELOG / ROADMAP discipline across many PRs.** This plan probably produces 8–20 PRs. Mitigation: each PR follows the existing feature + docs-backfill pattern. Maintain a single `LT-4` umbrella tag in `ROADMAP.md` until the final cutover — only at cutover does LT-4 strikethrough and move to §5 Shipped. Intermediate PRs reference LT-4 in their commit message but don't claim the tag.

10. **Existing `tasks/find_bloom_iterations.md` lesson — keyboard focus on child controls.** The same trap applies to WebView2 vs. accelerator pre-translate. Mitigation: explicit smoke test in Phase 1 covers focus traversal (Tab, Shift+Tab, Esc, Enter on form fields).

11. **Repo bloat from `node_modules`.** `pnpm` produces a flat-ish store but `web/` still pulls in 100+ MB of dev deps. Mitigation: `web/node_modules/` is gitignored; CI installs fresh. `pnpm-lock.yaml` is committed. The release zip ships only `web/dist/` (production build, ~200 KB minified).

12. **Existing CLAUDE.md "surgical changes" guidance vs. this overhaul.** Apparent conflict. Resolution: this *is* the surgical answer — replace exactly the UI layer and nothing else. We don't touch engine, model, undo, file manager, autosave, spawner, or rescale. Surgery is *targeted*, not *small*. The plan's explicit out-of-scope list keeps it honest.

---

## Testing & verification

Verification is split by phase. Each phase has its own acceptance gate; the plan does not advance until the gate is green.

### Phase 0 — Audit & design seed

- [ ] `tasks/lt4_ui_overhaul_audit.md` exists and lists every `WM_COMMAND` ID in `src/main.cpp` along with the source file / dialog template that defines it, plus a 1-line behaviour summary.
- [ ] `tasks/lt4_ui_overhaul_audit.md` lists every Engine setter currently called from `main.cpp` and the UI affordance that triggers it.
- [ ] `tasks/lt4_design_parking_lot.md` exists with one section per screen (8 screens listed in Phase 3) ready for the user to drop sketches/mockups/notes into.
- [ ] `web/packages/design-tokens/src/tokens.ts` exists with starter values for color / spacing / typography / density — *placeholder only*, the user iterates them in Phase 3.

### Phase 1 — Hybrid host scaffolding (the hard gate)

- [ ] **Viewport composition PoC**: `out/viewport_poc.exe` opens a window with WebView2 hosting a coloured-div React shell and a sibling D3D9 child rendering a known-solid colour. Resize / maximise / drag / minimise / restore — the D3D9 area tracks the div without flicker, without z-order glitches, without leaving rendering artefacts on the WebView2 surface.
- [ ] **HMR loop verified**: `pnpm dev` running, edit a `.tsx`, the change reflects inside the running `ParticleEditor.exe --dev-ui` without restart.
- [ ] **Accelerator pre-translate verified**: pressing `Ctrl+S` in the editor (focus in WebView2) fires an `accelerator/pressed` event in React. Verified via a `[Accel]` debug printf gated by `#ifndef NDEBUG` (per CLAUDE.md debug-instrumentation conventions).
- [ ] **WebView2 runtime detection**: launching on a VM with the runtime removed shows the install dialog and exits cleanly. (Use the WebView2 "Evergreen Runtime Test Installer" or a Win10 sandbox image.)

### Phase 2 — Bridge surface + one end-to-end screen

- [ ] **Bridge schema package builds**: `web/packages/bridge-schema/` produces type defs; both `web/apps/editor/` and the C++ codegen step consume it.
- [ ] **Mock bridge passes contract suite**: `pnpm test bridge-contract` exercises every command in `Request` against the mock and asserts the response shapes match the schema.
- [ ] **Native bridge passes contract suite**: same suite runs against the real host via Playwright driving WebView2. (Playwright supports WebView2 in headed mode via Edge connect.)
- [ ] **First screen — Background picker — works end-to-end in hybrid**: open the editor, click the Background button, the React picker opens, clicking a skydome slot triggers `engine/set/skydome`, the D3D9 viewport changes background, the picker thumbnail updates, Undo reverts. Verified by manual smoke + Playwright script.
- [ ] **Legacy UI still launches** with `--legacy-ui`. Round-trip: load a file in legacy, save, close, reopen in hybrid — same file appears unchanged.

### Phase 3 — Per-screen migration (template, applied N times)

Per screen, the design checkpoint must be green before native wire-up begins, and the wire-up gate must be green before merging:

- [ ] Design checkpoint: user reviews the screen in browser-mode (`pnpm dev` against mock bridge) and signs off in `tasks/lt4_design_parking_lot.md`. **Skipping this step is the most expensive failure mode in the plan.**
- [ ] Wire-up gate: native build of the screen passes a per-screen Playwright smoke (defined per screen).
- [ ] Old `main.cpp` code path for that screen is *deleted* in the same PR (no zombie code).
- [ ] No regressions in `--legacy-ui` for screens not yet migrated (still launchable).

### Phase 4 — Cutover

- [ ] Every screen in `tasks/lt4_design_parking_lot.md` is checked off as "design complete + wired up".
- [ ] `--legacy-ui` flag and the residual `main.cpp` legacy chrome are deleted in one PR.
- [ ] `src/UI/*` is deleted (or moved to `src/_legacy/` if anything still references types from it; clean delete is the goal).
- [ ] `ROADMAP.md`: LT-4 strikethrough → ✅ Shipped, moved to §5 Shipped, source-tier renumbered.
- [ ] `CHANGELOG.md`: cutover entry describing the new architecture, the migration arc, and any unexpected gotchas.

### Debug instrumentation

Phase 1+ adds these `#ifndef NDEBUG` printfs (matching project convention; tag prefix for grep):

- `[Bridge] inbound: <kind> id=<rid>` — every Request received by host
- `[Bridge] outbound: <kind>` — every Event emitted by host
- `[Viewport] rect: x=<x> y=<y> w=<w> h=<h>` — every `layout/viewport-rect` applied
- `[Accel] combo=<combo>` — every accelerator pre-translate match
- `[WV2] runtime version=<ver>` — once at startup

These stay in the binary in Debug builds; release builds elide them via the `#ifndef NDEBUG` guard.

---

## Per-screen migration scope

The chrome breaks down into approximately these screens / surfaces. Each is one Phase 3 cycle:

| # | Screen / surface | Replaces | Complexity | Notes |
|---|---|---|---|---|
| 1 | App shell (window frame, status bar, FPS counter, title-dirty `*`) | `WinMain`, status-bar code in `main.cpp` | low | First screen after Phase 2 background-picker validates the bridge. |
| 2 | Main menu (File/Edit/View/Tools/Help) | Menu resource + `WM_COMMAND` dispatch | low-medium | Native menu via `SetMenu` is an option; React-rendered menu bar is also fine. Decision belongs to the design checkpoint. |
| 3 | Toolbar (Open/Save/Undo/Redo/Pause/Step/etc.) | Toolbar bitmaps + button states | low | Icons stay as the existing `toolbar*.bmp` assets, served as static files. |
| 4 | Emitter tree | `src/UI/EmitterList.cpp` (4955 LOC!) | **high** | The single biggest chunk. Drag-and-drop reordering, checkboxes, multi-select, context menu, link-group glyph badges. Plan one full week minimum. |
| 5 | Curve editor | `src/UI/CurveEditor.cpp` | high | SVG- or canvas-based 2D editor. Interactive bezier handles, keyboard nudges, snap modes. |
| 6 | Track editor | `src/UI/TrackEditor.cpp` | medium | Per-channel keyframe editing. Likely shares primitives with #5. |
| 7 | Spinner + RandomParam + ColorButton + TexturePalette | rest of `src/UI/` | medium | These are the form-field building blocks. shadcn/ui has near-equivalents (Number input, Color picker, Tabs); custom RandomParam is unique. |
| 8 | Dialogs (Lighting, Background picker, Ground picker, Import Emitters, Rescale, Preferences) | various `…DialogProc` in `main.cpp` | medium | Each is small individually; total is significant. Background picker is the Phase 2 validator. |

Screens 1–3 should land first to flush out the bridge. Screen 4 (emitter tree) is the load-bearing risk — if it ships, the rest is engineering, not invention.

---

## Tasks

### Phase 0 — Audit & design seed

#### Task 0.1: Inventory the WM_COMMAND surface

**Files:**
- Create: `tasks/lt4_ui_overhaul_audit.md`

- [ ] **Step 1**: Grep `src/main.cpp` for every `case ID_` inside `WM_COMMAND` handlers. For each ID, record:
  - the source resource header (`resource.en.h` / `resource.de.h`)
  - the menu / toolbar / accelerator that triggers it
  - the handler function (or inline block) — file:line
  - a one-line behaviour summary
  - the destination screen number from the table above
- [ ] **Step 2**: Cross-reference accelerator table (look for `LoadAccelerators` + `WM_KEYDOWN` direct handlers).
- [ ] **Step 3**: Write `tasks/lt4_ui_overhaul_audit.md` with sections: *Commands*, *Accelerators*, *Dialogs*, *Custom controls*. One row per item.
- [ ] **Step 4**: Commit.

```bash
git add tasks/lt4_ui_overhaul_audit.md
git commit -m "docs(LT-4): WM_COMMAND + accelerator + dialog audit for UI overhaul"
```

#### Task 0.2: Inventory the Engine API surface used by UI

**Files:**
- Modify: `tasks/lt4_ui_overhaul_audit.md` (new section)

- [ ] **Step 1**: Grep `src/main.cpp` for `engine->`, `engine.`, and `m_engine->` to enumerate every Engine method called from UI code.
- [ ] **Step 2**: For each, note the method signature, the UI affordance that calls it, and whether it's a get (push to React on state event) or set (Request from React).
- [ ] **Step 3**: Append a *"Bridge command candidates"* section listing one prospective `Request` variant per setter and the events that should fire on each.
- [ ] **Step 4**: Commit.

#### Task 0.3: Seed the design parking lot

**Files:**
- Create: `tasks/lt4_design_parking_lot.md`

- [ ] **Step 1**: Write `tasks/lt4_design_parking_lot.md` with one section per screen from the 8-row table above. Each section has placeholders for: *Current behaviour* (1-2 sentences), *Design notes / sketches* (empty, user fills in), *Design checkpoint status* (empty: `🟡 pending`), *Wire-up checklist* (empty: `🟡 pending`).
- [ ] **Step 2**: Commit.

```bash
git add tasks/lt4_design_parking_lot.md
git commit -m "docs(LT-4): seed per-screen design parking lot for iteration"
```

#### Task 0.4: Add design-token starter file

**Files:**
- Create: `web/packages/design-tokens/src/tokens.ts`
- Create: `web/packages/design-tokens/package.json`
- Create: `web/pnpm-workspace.yaml`
- Create: `web/.gitignore` (ignore `node_modules`, `dist`)
- Create: `web/package.json` (workspace root)

- [ ] **Step 1**: Initialise the `web/` monorepo: `cd web && pnpm init`. Add `pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

- [ ] **Step 2**: Create `web/packages/design-tokens/src/tokens.ts` with starter values:

```ts
// Design tokens — placeholders. Iterate in browser mode against
// tasks/lt4_design_parking_lot.md mockups before locking in.
export const tokens = {
  color: {
    bg: { app: "#0F1115", panel: "#16191F", surface: "#1C2028" },
    fg: { primary: "#E6E8EB", muted: "#8A9099", subtle: "#4A4F58" },
    accent: { primary: "#5BA3F5", danger: "#F56A6A", success: "#6AD08A" },
    border: { subtle: "#262A33", strong: "#3A3F4A" },
  },
  space: { 0: "0px", 1: "4px", 2: "8px", 3: "12px", 4: "16px", 6: "24px", 8: "32px" },
  radius: { sm: "4px", md: "6px", lg: "10px" },
  type: {
    family: { ui: "'Inter', system-ui, sans-serif", mono: "'JetBrains Mono', monospace" },
    size: { xs: "11px", sm: "12px", md: "13px", lg: "15px", xl: "18px" },
    weight: { regular: 400, medium: 500, semibold: 600 },
  },
  density: { rowHeight: { tight: "22px", default: "26px", loose: "32px" } },
} as const;

export type Tokens = typeof tokens;
```

- [ ] **Step 3**: `pnpm install` to lock the workspace.
- [ ] **Step 4**: Commit.

```bash
git add web/
git commit -m "feat(LT-4): seed web/ monorepo + design tokens placeholder"
```

### Phase 1 — Hybrid host scaffolding (HARD GATE)

#### Task 1.1: Add WebView2 SDK + minimal viewport PoC

**Files:**
- Create: `src/host/viewport_poc.cpp` (standalone exe, gated by a new `.vcxproj` configuration)
- Modify: `ParticleEditor.sln` (add `viewport_poc` project)
- Create: `src/host/viewport_poc.vcxproj`
- Create: `web/apps/viewport-poc/index.html` + `web/apps/viewport-poc/src/main.tsx`
- Create: `web/apps/viewport-poc/vite.config.ts`

- [ ] **Step 1**: Install WebView2 SDK via NuGet (`Microsoft.Web.WebView2`) and the WebView2 Loader for native projects.
- [ ] **Step 2**: Bootstrap `web/apps/viewport-poc/` as a Vite + React + TS project (`pnpm create vite viewport-poc --template react-ts`). Add a single `<div id="viewport-slot" style="background:hotpink;width:60vw;height:60vh;">VIEWPORT</div>` with a `ResizeObserver` that posts the rect to `window.chrome.webview.postMessage(JSON.stringify({ kind: "layout/viewport-rect", x, y, w, h }))`.
- [ ] **Step 3**: Write `src/host/viewport_poc.cpp` that:
  - creates a top-level window with `WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN`
  - creates a WebView2 control as a child filling the client area
  - creates a `STATIC` child HWND for the D3D9 viewport
  - initialises D3D9 with `D3DCREATE_HARDWARE_VERTEXPROCESSING` clearing each frame to `D3DCOLOR_XRGB(0, 100, 200)` (solid blue)
  - listens for `WebMessageReceived`, parses JSON, on `layout/viewport-rect` calls `SetWindowPos(hViewport, HWND_TOP, x, y, w, h, SWP_NOACTIVATE)`
- [ ] **Step 4**: Build `viewport_poc.exe`. Run it. **Acceptance**: maximize, restore, drag-resize the window; the blue D3D9 area tracks the pink-bordered React `<div>` perfectly. No flicker, no z-order glitches.
- [ ] **Step 5**: If acceptance fails, **STOP**. Re-plan around the alternative composition strategy noted in Risk #1.
- [ ] **Step 6**: Commit.

#### Task 1.2: Bootstrap the real `web/apps/editor/` React app

**Files:**
- Create: `web/apps/editor/` (Vite + React + TS, Tailwind, shadcn/ui)
- Create: `web/apps/editor/src/bridge/types.ts` — re-exports from `bridge-schema`
- Create: `web/apps/editor/src/bridge/mock.ts` — `MockBridge` impl (initially empty; just types)
- Create: `web/apps/editor/src/bridge/native.ts` — `NativeBridge` impl over `chrome.webview.postMessage`
- Create: `web/apps/editor/src/App.tsx` — placeholder shell with a `<ViewportSlot>` div

- [ ] **Step 1**: `pnpm create vite editor --template react-ts` inside `web/apps/`.
- [ ] **Step 2**: Install Tailwind v4, run `pnpm dlx shadcn@latest init` with project-default settings, wire `tokens.ts` into Tailwind config (`tailwind.config.ts` reads from `@particle-editor/design-tokens`).
- [ ] **Step 3**: Create `bridge-schema` package at `web/packages/bridge-schema/` with the `Request` / `Event` / `Bridge` types from the architecture section (copy verbatim, that's the contract).
- [ ] **Step 4**: Create `MockBridge` skeleton (returns `Promise.reject("not implemented")` for every command); `NativeBridge` skeleton sending messages via `window.chrome.webview?.postMessage`.
- [ ] **Step 5**: Create `App.tsx` that renders a top bar (placeholder "AloParticleEditor" title) + sidebar (placeholder "Emitters") + main viewport-slot div + bottom status bar (placeholder "FPS: --"). `<ViewportSlot>` posts its rect via `ResizeObserver`.
- [ ] **Step 6**: `pnpm dev` — verify it opens in browser with placeholder UI.
- [ ] **Step 7**: Commit.

#### Task 1.3: New `src/host/` skeleton (replaces `WinMain` lifecycle, behind `--new-ui` flag)

**Files:**
- Create: `src/host/HostWindow.cpp/.h` — top-level window class, WebView2 + viewport children
- Create: `src/host/BridgeDispatcher.cpp/.h` — JSON message dispatcher
- Create: `src/host/LayoutBroker.cpp/.h` — applies `layout/viewport-rect`
- Create: `src/host/AcceleratorBridge.cpp/.h` — pre-translate hook
- Modify: `src/main.cpp` — at top of `WinMain`, parse `--new-ui` flag and branch into `host::Run()` instead of legacy chrome

- [ ] **Step 1**: Define `host::Run(HINSTANCE, int nCmdShow)` in `src/host/HostWindow.cpp` that does what the PoC did, plus: creates the `Engine` with managers, instantiates `BridgeDispatcher` with a reference to the engine.
- [ ] **Step 2**: `BridgeDispatcher` exposes `void Dispatch(const std::string& jsonRequest)` and `void Emit(const std::string& jsonEvent)`. Hook `BridgeDispatcher::Dispatch` to `WebMessageReceived`.
- [ ] **Step 3**: Implement `layout/viewport-rect` end-to-end (already covered by PoC; lift the code into `LayoutBroker`).
- [ ] **Step 4**: Implement `engine/state/snapshot` Request — returns a `EngineStateDto` with ground, background, skydome slot, camera, gravity, wind, lights, bloom. JSON-encode using a thin local serialiser (no third-party JSON lib needed if we keep DTOs flat; or pull in `nlohmann/json` via vcpkg — vote: `nlohmann/json`, it's worth the ~30 ms compile-time hit for the readability win).
- [ ] **Step 5**: Modify `WinMain` to parse `--new-ui` / `--legacy-ui` (`--legacy-ui` is default during Phases 1–3). With `--new-ui`, branch into `host::Run()` and skip the legacy chrome.
- [ ] **Step 6**: Build + smoke. `ParticleEditor.exe --new-ui --dev-ui` opens with the Vite dev server's React UI, viewport renders blue (or current engine clear colour), `engine/state/snapshot` round-trips correctly (verify by adding a temporary `console.log` of the response in React).
- [ ] **Step 7**: `ParticleEditor.exe` (no flag) still launches the legacy UI unchanged.
- [ ] **Step 8**: Commit.

#### Task 1.4: HMR + dev-server detection

**Files:**
- Modify: `src/host/HostWindow.cpp` (`--dev-ui` flag handling)

- [ ] **Step 1**: When `--dev-ui` is passed, before navigating to `http://localhost:5173`, do a `WinHttpOpen` request to `http://localhost:5173/`. If it times out or returns non-2xx, show a `MessageBox` with: *"Dev UI mode requested but no dev server detected at http://localhost:5173. Did you forget to run `pnpm dev` in `web/apps/editor/`?"* and exit.
- [ ] **Step 2**: Without `--dev-ui`, navigate to `https://app.local/index.html` (after `SetVirtualHostNameToFolderMapping("app.local", <exe-dir>/web, CORS_ALLOW_ALL)`).
- [ ] **Step 3**: Smoke: edit `App.tsx`, see HMR inside the running editor.
- [ ] **Step 4**: Commit.

#### Task 1.5: WebView2 runtime detection at startup

**Files:**
- Modify: `src/host/HostWindow.cpp`

- [ ] **Step 1**: Before creating the WebView2 environment, call `GetAvailableCoreWebView2BrowserVersionString(nullptr, &version)`. If it returns `HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND)` or empty version, show a `MessageBox`:
  *"AloParticleEditor requires the Microsoft Edge WebView2 Runtime. Install it from https://aka.ms/webview2 and relaunch."*
  with a "Download" button that calls `ShellExecuteW(nullptr, L"open", L"https://aka.ms/webview2", …)`. Exit on close.
- [ ] **Step 2**: Test on a VM with the runtime removed (or simulate by setting `WEBVIEW2_RELEASE_CHANNEL_PREFERENCE=99` and `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER=` to force "not found").
- [ ] **Step 3**: Commit.

#### Task 1.6: Accelerator pre-translate

**Files:**
- Modify: `src/host/AcceleratorBridge.cpp/.h`
- Modify: `web/apps/editor/src/bridge/native.ts` — surface `accelerator/pressed` event

- [ ] **Step 1**: Add a `register-accelerators` Request handler. React sends a list of combos (e.g. `["Ctrl+S", "Ctrl+Z", "Ctrl+Shift+Z", "Delete", "F5"]`) at startup.
- [ ] **Step 2**: Subscribe to `ICoreWebView2Controller2::AcceleratorKeyPressed`. On match against the registered list, set `Handled = TRUE` and emit `accelerator/pressed` with the combo string.
- [ ] **Step 3**: Add a temporary React handler that `console.log`s every received combo. Test: focus a `<input>`, press Ctrl+S. Verify the bridge fires and the form doesn't get Ctrl+S as a literal char.
- [ ] **Step 4**: Commit.

#### Phase 1 acceptance checkpoint

- [ ] **Hand off to user**: post the test pass with screenshots (viewport tracking the div on resize, HMR working, accelerator event in DevTools console). User signs off before Phase 2.

### Phase 2 — Bridge surface + Background picker (first real screen)

#### Task 2.1: Flesh out `EngineStateDto` and `engine/set/*` Requests

**Files:**
- Modify: `web/packages/bridge-schema/src/index.ts`
- Modify: `src/host/BridgeDispatcher.cpp`

- [ ] **Step 1**: Define `EngineStateDto` covering every getter on `Engine` (ground, skydome, bloom, lights, ambient, shadow, gravity, wind, camera). Use plain types; no classes.
- [ ] **Step 2**: For each `Set*` method on `Engine`, define the matching `engine/set/<thing>` Request. Names match the table in the audit doc.
- [ ] **Step 3**: In `BridgeDispatcher::Dispatch`, add cases for every command; each calls the Engine setter then emits `engine/state/changed` with the new full state.
- [ ] **Step 4**: Add `bridge-contract.test.ts` (Vitest) that exercises each command against `MockBridge` and asserts the response shape parses against the schema.
- [ ] **Step 5**: Implement `MockBridge` for every command — store state in a Zustand store, mutate on writes, fire events synchronously.
- [ ] **Step 6**: Commit.

#### Task 2.2: Native bridge contract test via Playwright

**Files:**
- Create: `web/apps/editor/tests/bridge-native.spec.ts` — Playwright spec using `chromium.launch({ channel: "msedge" })` to drive WebView2-like behaviour
- Modify: `ParticleEditor.vcxproj` — add a `TestHost` configuration that exposes a debug HTTP port

- [ ] **Step 1**: Add a debug mode (`--test-host`) to the host that exposes the WebView2 over CDP (set `CoreWebView2Environment` with `--remote-debugging-port=9222`).
- [ ] **Step 2**: Write a Playwright spec that connects to `:9222`, evaluates `await window.bridge.request({kind:"engine/state/snapshot",params:{}})`, asserts a valid shape.
- [ ] **Step 3**: Add a second spec that calls `engine/set/ground-z` and asserts the next `engine/state/changed` event reflects the new value.
- [ ] **Step 4**: Wire `pnpm test:native` to launch `ParticleEditor.exe --new-ui --test-host` in the background and run the spec.
- [ ] **Step 5**: Commit.

#### Task 2.3: First screen — Background picker — design checkpoint

**Files:**
- Modify: `tasks/lt4_design_parking_lot.md` (Background picker section)

- [ ] **Step 1**: In browser mode (`pnpm dev`), the user iterates on the Background picker UI. The MockBridge already serves 12 skydome slots from a fixture file.
- [ ] **Step 2**: Once happy, user updates the parking lot: status `✅ design complete`, paste final visual references / token overrides / behaviour notes.
- [ ] **Step 3**: Commit.

#### Task 2.4: First screen — Background picker — native wire-up

**Files:**
- Modify: `web/apps/editor/src/screens/BackgroundPicker.tsx` (use the design-complete component, no changes needed beyond toggling the bridge)
- Modify: `src/host/BridgeDispatcher.cpp` — confirm `engine/set/skydome` calls `Engine::SetSkydomeSlot` and emits the changed event
- Add: `web/apps/editor/tests/background-picker.spec.ts` — Playwright smoke (open picker, click slot 3, assert snapshot matches engine state)

- [ ] **Step 1**: Toggle React to use `NativeBridge` when `window.chrome?.webview` is defined, else `MockBridge`. (Already wired in Phase 1; just verify.)
- [ ] **Step 2**: Run `ParticleEditor.exe --new-ui --dev-ui` with `pnpm dev`. Open the Background picker, click slot 3. Viewport background changes.
- [ ] **Step 3**: Press Ctrl+Z. `accelerator/pressed` fires. React sends `undo/perform`. Bridge calls `UndoStack::undo`. Engine state rolls back. `engine/state/changed` fires. Picker reverts to slot 0.
- [ ] **Step 4**: Add the Playwright smoke.
- [ ] **Step 5**: Commit + open PR.

#### Phase 2 acceptance checkpoint

- [ ] **Hand off to user**: hybrid editor opens, Background picker works end-to-end against the real engine. Undo works across the bridge. Legacy UI still launches with `--legacy-ui`.

### Phase 3 — Per-screen migration (template, applied per screen)

For each of the remaining 7 screens (App shell, Main menu, Toolbar, Emitter tree, Curve editor, Track editor, Form-field primitives, Remaining dialogs):

#### Template Task 3.N.1: Define bridge needs for the screen

**Files:**
- Modify: `web/packages/bridge-schema/src/index.ts` (add Request/Event variants for this screen's needs)
- Modify: `tasks/lt4_design_parking_lot.md` (parking-lot section: "Bridge surface" subsection)

- [ ] List every Request this screen will issue (e.g. for Emitter tree: `emitters/list`, `emitters/select`, `emitters/update`, `emitters/move`, `emitters/duplicate`, `emitters/delete`, `emitters/import-from-file`).
- [ ] List every Event this screen subscribes to.
- [ ] Implement the new variants in `MockBridge` with fixture data.
- [ ] Commit.

#### Template Task 3.N.2: Design checkpoint in browser mode

**Files:**
- Modify: `web/apps/editor/src/screens/<ScreenName>.tsx` (build the React component)
- Modify: `tasks/lt4_design_parking_lot.md` (record the iteration outcome)

- [ ] User runs `pnpm dev`, iterates on the design with hot reload. Mock bridge serves realistic fixtures.
- [ ] **Acceptance**: user toggles parking-lot status to `✅ design complete` with notes on any token / density / behaviour overrides for this screen.
- [ ] **No native code touched in this task.** That's the whole point of the dual-mode build.
- [ ] Commit the design-complete component.

#### Template Task 3.N.3: Native bridge wire-up

**Files:**
- Modify: `src/host/BridgeDispatcher.cpp` (add handlers for this screen's Requests)
- Modify: `src/host/handlers/<DomainHandler>.cpp/.h` (one handler-pair per domain — `engine`, `emitters`, `file`, `undo`, `spawner`)

- [ ] Implement each Request handler. Cite Engine / ParticleSystem / UndoStack method calls in the handler. Capture-before-batch + single event-emit for batch ops (mirrors LT-3's import-emitters pattern).
- [ ] Emit the corresponding events on state mutation.
- [ ] Smoke: run `ParticleEditor.exe --new-ui`, exercise every affordance on the screen against the real engine.
- [ ] **Acceptance**: user toggles parking-lot status to `✅ wired up + smoke green`. Old `main.cpp` code path for the screen is **deleted in this same PR**.
- [ ] Commit + open PR.

#### Template Task 3.N.4: Per-screen Playwright smoke

**Files:**
- Create: `web/apps/editor/tests/<screen-name>.spec.ts`

- [ ] Drive the screen against the real bridge via `--test-host`. Cover happy path + one edge case + undo round-trip.
- [ ] Commit.

#### Template Task 3.N.5: Update CHANGELOG + ROADMAP-note (umbrella LT-4 not yet shipped)

**Files:**
- Modify: `CHANGELOG.md` (entry for this screen under an open `LT-4: UI overhaul (in progress)` parent section)
- *Don't* strike LT-4 in ROADMAP until cutover.

- [ ] Per the existing convention: *What ships* / *How we tackled it* / *Issues encountered and resolutions* for this screen.
- [ ] Commit.

### Phase 4 — Cutover

#### Task 4.1: Final acceptance run

- [ ] Every parking-lot section is `✅ design complete + wired up + smoke green`.
- [ ] Manual smoke against a representative `.alo` from each EaW mod era. Compare hybrid vs `--legacy-ui` for identical behaviour. Differences must be intentional and recorded in the parking lot.
- [ ] German locale: verify i18next switches at least one screen — full parity deferred (out-of-scope reminder).

#### Task 4.2: Delete legacy chrome

**Files:**
- Delete: `src/UI/` (entire directory)
- Modify: `src/main.cpp` — strip `WinMain` down to a thin wrapper that calls `host::Run`. The legacy chrome is gone. Most of `main.cpp` becomes empty; consider renaming to `src/host/main.cpp` and removing the original `src/main.cpp`.
- Modify: `src/ParticleEditor.vcxproj` — remove deleted file refs.
- Modify: `src/Resources/ParticleEditor.rc` — remove unreferenced dialog templates / menus.

- [ ] Delete the files. Build. The binary should still work — the React UI is now the *only* UI.
- [ ] Commit.

#### Task 4.3: ROADMAP + CHANGELOG ship entry

- [ ] `ROADMAP.md`: strike LT-4 title, append `✅ Shipped (#NN)`, add `*Actual:* N weeks` line, move entry to §5 Shipped, renumber.
- [ ] `CHANGELOG.md`: top-of-section entry summarising the whole arc. *What ships* (the new UI, the design tokens, the bridge architecture). *How we tackled it* (WebView2 + dual-mode React app + bridge schema as single source of truth). *Issues encountered and resolutions* (whatever bit us — viewport composition gotchas, accelerator race conditions, Win10 runtime install flow).
- [ ] Commit.

#### Task 4.4: Release zip update

**Files:**
- Modify: build/packaging script (whichever produces the release zip)

- [ ] Include `MicrosoftEdgeWebview2Setup.exe` in the zip alongside `d3dx9_43.dll`.
- [ ] Include `web/` directory next to the `.exe`.
- [ ] Update `README.md` install instructions to mention WebView2 runtime (auto-installs on first launch if missing).
- [ ] Commit.

---

## Open questions to resolve mid-flight (do NOT silently decide)

- **Menu strategy** (Task 3 — Main menu): native Win32 menu via `SetMenu` (familiar Windows look, free Alt-key handling) vs. React-rendered menu bar (full design control, harder accessibility). Decide at the menu-screen design checkpoint.
- **Curve editor canvas vs. SVG**: SVG is easier for selection / interaction state; canvas is faster for hundreds of keyframes. Profile against a real fireworks `.alo` before committing.
- **Single-window vs. modeless tool windows**: MT-4's Lighting dialog is a modeless tool window today. Hybrid could either embed it as a docked panel inside the main React app, or render it as a separate top-level WebView2 instance. Decide at the Lighting-dialog design checkpoint.
- **Undo granularity**: currently one undo per `WM_COMMAND`. With React, a single user gesture might fire multiple bridge writes (e.g., dragging a curve handle = 60 writes). Need to coalesce on the host side. Decide at the curve-editor wire-up.

---

## What the design parking lot looks like (for reference)

`tasks/lt4_design_parking_lot.md` is the user's iteration surface. Skeleton:

```markdown
# LT-4 — Design parking lot

Per-screen design notes for the UI overhaul. Iterate in browser mode
(`pnpm dev`) against the MockBridge. Lock a screen by setting its
status to ✅ before wiring it to the native bridge.

## Tokens (global)

Status: 🟡 iterating
Notes:
  - [user fills in]

## Screen 1 — App shell

Status: 🟡 pending design checkpoint
Current behaviour: top-level window with menu/toolbar/status bar.
Design notes:
  - [user fills in]
Bridge surface:
  - [defined in 3.1.1]
Wire-up checklist:
  - [filled in at 3.1.3]

## Screen 2 — Main menu

[...same shape...]

[...one section per screen...]
```

The user updates this file during Phase 3 iterations. Claude reads it before starting any 3.N.2 design-checkpoint task to know what the user has already specified.

---

## Phase summary table

| Phase | Goal | Duration estimate | Risk | Gate |
|---|---|---|---|---|
| 0 | Audit + design seed | 1–2 days | low | Audit docs exist, parking lot seeded |
| 1 | Hybrid host scaffolding | 2–3 days | **high (composition PoC)** | PoC accepted by user |
| 2 | Bridge surface + Background picker | 3–5 days | medium | One end-to-end screen works |
| 3 | Per-screen migration (×7 screens) | 1–4 weeks (varies) | medium per screen | Each screen acceptance |
| 4 | Cutover & cleanup | 1–2 days | low | LT-4 shipped |

Total optimistic: ~3 weeks. Realistic: ~5–6 weeks. Pessimistic (if composition PoC needs rework): ~8 weeks.

The plan is structured so the user can call "good enough, ship it" at any phase boundary and have a usable editor (legacy + partial hybrid behind a flag).
