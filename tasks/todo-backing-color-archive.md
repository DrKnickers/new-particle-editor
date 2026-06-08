# tasks/todo.md — Theme-colored composition backing (kill the dark corner wedges)

Branch: `claude/sleepy-easley-16645f` (off `lt-4`). Started 2026-05-30 (session 3).

---

## 1. Goal + scope

**Goal.** When the editor's rounded panels meet the engine viewport (or sit over
any transparent gap), their corner wedges currently reveal the **host
composition backing**, which today is dark (pure black where DComp is
transparent; the dark-purple class brush `RGB(0x14,0x08,0x34)` only in transient
resize frames). Make that backing the **current theme background colour**
(`--bg`: `#111111` dark / `#ececec` light) so every transparent gap, splitter
seam, and rounded-corner wedge blends into the app shell instead of showing a
black/odd triangle. Rounded corners stay rounded (user's explicit choice).

This is the **root-cause** fix (user-chosen over the web-only per-panel CSS
backing): one theme-colored layer behind everything fixes all current *and
future* transparent-region seams at once, including the curve-editor top corners,
the left-pane outer corners, the spawner, and any panel added later.

**In:**
- A solid-colour **backing visual** at the rear of the DComp tree (behind the
  engine visual), filling the full host client, recolourable at runtime.
- A new bridge request `host/backing-color` (color string) wired host-side to
  recolour that visual.
- A web-side sync that pushes the resolved `--bg` to the host on first paint and
  on every theme change.

**Out (with reasons):**
- **Removing the dark-purple class brush** (`RGB(0x14,0x08,0x34)`) — it still
  serves the transient resize-exposed-region case (HostWindow.cpp:2586-2593) and
  is a separate concern; optionally retune to match `--bg` in a follow-up, not
  required for this fix. *(Deferred — could matter cosmetically during a fast
  resize storm; accept for now.)*
- **The spawner's nested double-panel** (`<aside bg-panel>` wrapping an inner
  `.panel` — PanelLayout.tsx:368 + SpawnerPanel.tsx:167). It's a structural
  redundancy that contributes to the spawner looking "off," but it shows
  `bg-panel` (same colour family), not the black backing — out of scope for the
  backing fix. *(Separate cleanup — flag as a spawn-a-task candidate.)*
- **Legacy arch-A (`VITE_HOSTING_MODE=legacy`)** path. Arch-A uses the
  AlphaCompositor DIB, not the DComp tree; it has no black-backing problem in the
  same way. The backing visual is arch-C-only. *(Gated behind MT-13 arch-A
  deletion anyway.)*
- **Engine clear-colour / clip rework.** An alternative fix (drop the engine
  visual's scene-rect clip and clear the off-scene RT region to `--bg`) is more
  elegant in theory but couples to the deferred-clip resize machinery
  (Compositor.cpp:817+). Rejected as higher-risk than an independent rear visual.

---

## 2. What the codebase already gives us

- **DComp tree** (`Compositor.cpp`): `root → [engineVisual (rear, AddVisual(…,TRUE,
  nullptr)), webviewVisual (front)]`. `AttachEngineVisual` (Compositor.cpp:696-733)
  shows the exact "insert behind all siblings" idiom we mirror for the backing.
- **`m_impl->d3d11Device` / `d3d11Context`** already exist (engine shared-texture
  alias) — reusable to clear a small backing surface to a solid colour. No new
  device needed.
- **`Compositor::SetSize(w,h)`** (Compositor.h:106) already fires on host-client
  resize — the hook to keep the backing sized to the full client.
- **`SetEngineVisualTransform`** (Compositor.h:193-243) is the model for a
  visual-level offset/clip/Commit method; the backing's resize follows the same
  shape (a scale transform on a 1×1 surface, or SetClip to full client).
- **Bridge request plumbing**: `layout/scene-rect` end-to-end is the template —
  declared in `web/packages/bridge-schema/src/index.ts:721` (union) + `:920`
  (response → `Record<string, never>`); handled in
  `BridgeDispatcher.cpp` `DispatchInternal` (`if (kind == "layout/scene-rect")`
  at :832). We add a sibling `host/backing-color`.
- **Theme application**: `ThemeToggle.tsx:22-24` sets `document.documentElement.
  dataset.theme`; tokens.css:17/57 define `--bg` as plain hex per theme. Resolved
  value readable via `getComputedStyle(documentElement).getPropertyValue("--bg")`.
- **`MockBridge`** (browser dev) silently no-ops unknown requests, so a new
  request kind is safe in `pnpm dev`.

---

## 3. Architecture / implementation approach

**(a) Host — Compositor backing visual.** Add to `Compositor`:
```cpp
// Recolour the rear backing visual. color is 0x00RRGGBB (COLORREF-style,
// alpha forced opaque). Idempotent on an unchanged colour. Creates the
// backing visual + surface lazily on first call; safe before/after
// AttachEngineVisual. Commits.
HRESULT SetBackingColor(COLORREF color) noexcept;
```
- Impl: lazily create `backingVisual` (IDCompositionVisual) + a small
  IDCompositionSurface (e.g. 1×1 or 8×8). On colour change: `BeginDraw` →
  IDXGISurface → D3D11 RTV → `ClearRenderTargetView(opaque color)` → `EndDraw`;
  `backingVisual->SetContent(surface)`. Insert **once** as the rearmost child via
  `rootVisual->AddVisual(backingVisual, TRUE, nullptr)` *before* the engine visual
  (engine is currently inserted with the same "behind all" call, so order the
  inserts so backing ends up behind engine — verify the children-list order with
  a `[COMP-backing]` log line).
- Stretch the 1×1 surface to the full client with a scale transform; re-apply in
  `SetSize`. (Solid colour ⇒ interpolation is irrelevant.)
- Failure mode: any HRESULT failure logs `[COMP-backing-fail] …` and leaves the
  tree intact (falls back to today's black backing — no worse than current).

**(b) Bridge — new request.** `bridge-schema/src/index.ts`:
```ts
| { kind: "host/backing-color"; params: { color: string } }   // CSS hex or rgb()
// response map:
R extends { kind: "host/backing-color" } ? Record<string, never> :
```
`BridgeDispatcher.cpp` `DispatchInternal`: `if (kind == "host/backing-color")` →
parse `params.color` (hex `#rrggbb` or `rgb(r,g,b)`) → `COLORREF` →
`m_compositor->SetBackingColor(c)` → return `{}`. Parse defensively (bad string
⇒ log + ignore, no throw — wrap per the existing json::exception guards).

**(c) Web — theme→host sync.** New hook `useBackingColorSync(bridge)` mounted in
`AppShell`:
- On mount and whenever `data-theme` changes (MutationObserver on
  `documentElement` `attributes`/`data-theme`), read
  `getComputedStyle(documentElement).getPropertyValue("--bg").trim()` and
  `void bridge.request({ kind:"host/backing-color", params:{ color } }).catch(()=>{})`.
- Mount it high so the first push races in before/at first composite; the
  dark-purple class brush covers any sub-frame gap.

**Data flow:** ThemeToggle sets `data-theme` → MutationObserver fires →
read `--bg` → bridge request → BridgeDispatcher → `Compositor::SetBackingColor`
→ rear visual recoloured → Commit → next DWM cycle shows theme-bg in every
transparent region.

---

## 4. Risks named up front + mitigations

1. **DComp child-order: backing must end up BEHIND the engine visual.** Both use
   `AddVisual(…, TRUE, nullptr)` ("prepend = behind all siblings"). If we add the
   backing after the engine is already prepended, the backing lands in front of
   the engine and the viewport scene is hidden. *Mitigation:* add the backing as
   the rearmost child with explicit ordering — either insert it before
   AttachEngineVisual runs, or use `AddVisual(backing, FALSE, engineVisual)`
   (insert below a reference). Verify with a one-shot `[COMP-backing]` log that
   prints the children order, and smoke-test that the viewport still renders.

2. **First-paint flash.** If the backing is created/coloured after the first
   composite, the user sees one frame of black/purple. *Mitigation:* push the
   colour from the web side as early as AppShell mount; the class brush
   (`0x140834`) already covers the transient resize case, so worst case is a
   sub-frame flicker indistinguishable from today.

3. **Colour-string parse.** `getComputedStyle` may return `#ececec` or a
   normalized `rgb(236,236,236)`. *Mitigation:* host parser accepts both forms;
   on any parse failure, log `[backing] bad color "<s>"` and keep the prior
   colour (never throw into the dispatch path — honour the json::exception guard
   pattern).

4. **a11y golden impact.** The backing shows only in *transparent* regions, which
   are outside every captured a11y surface (panels are opaque and captured as
   themselves). Expectation: **zero golden drift** (same class as session 2's
   CSS-token/engine changes per L-030). *Mitigation:* confirm by running the
   suites; if any golden moves, investigate before regenerating.

5. **I cannot visually verify locally.** My worktree's arch-C instance fails to
   alpha-clip the engine to the scene rect (engine fills the whole window, panels
   transparent) — a local compositing quirk, not present in the user's build
   (their screenshot composites correctly). *Mitigation:* verify everything I can
   without the visual (clean build, vitest, goldens, host.log `[COMP-backing]`
   lines proving the visual attached + recoloured, a CDP read of the pushed
   `--bg` value), then **hand the visual confirmation to the user** — state this
   limitation explicitly in the handoff. Do NOT claim the wedges are gone from my
   own screenshot.

6. **Bridge-schema is shared TS.** Adding a union arm touches the typed surface;
   a missing response-map arm is a type error. *Mitigation:* add both the union
   arm and the `R extends …` response arm; `pnpm build` (tsc -b) catches a miss.

---

## 5. Testing & verification

**Build / static:**
- [ ] `pnpm --filter @particle-editor/editor build` — tsc clean (proves the
      bridge-schema arms are consistent) + vite dist.
- [ ] Release x64 builds clean via MSBuild against the `.sln` (L-023/L-025).
- [ ] Debug x64 builds clean (for any host.log inspection).

**Unit:**
- [ ] `pnpm --filter @particle-editor/editor test` — **367** still pass.
- [ ] Add a focused test for `useBackingColorSync` (or the colour-read helper):
      applying `data-theme="light"` → bridge.request called with the light `--bg`;
      toggling to dark → called with the dark value. (jsdom: stub
      getComputedStyle / set the token.)

**a11y goldens:**
- [ ] Run both lanes serially (L-031). Expect **zero** mismatches (backing is
      outside captured surfaces). If non-zero, investigate — do not blanket regen.

**Host instrumentation (Debug):**
- [ ] `[COMP-backing] children order: [backing, engine, webview]` (or equivalent)
      printed once at attach — proves the backing is rearmost.
- [ ] `[COMP-backing] recolor #ececec → COLORREF 0x00ececec` on each push;
      confirm one fires at startup and one per theme toggle (drive via the
      Sun/Moon buttons).
- [ ] `--test-host` CDP read: `getComputedStyle(documentElement)
      .getPropertyValue('--bg')` matches what the host logged it received.

**User-side (the part I can't self-verify):**
- [ ] User confirms the curve-editor top corners, left-pane outer corners, and
      spawner no longer show dark/odd wedges — wedges now read as the app-shell
      grey, in **both** light and dark themes (toggle the Moon/Sun).

**Cleanup / regression:**
- [ ] Viewport still renders the engine scene (backing didn't occlude it).
- [ ] Splitter drag / window resize: no black strip; transient resize-exposed
      area is either class-brush or backing colour, both acceptable.

---

## Review

**Shipped.** Theme-coloured composition backing, exactly as planned (rear DComp
visual recoloured to `--bg`; corners stay rounded).

**What landed:**
- Host: `Compositor::SetBackingColor` + a rearmost 1×1-swapchain backing visual on
  its own D3D11 device (engine device/LUID path untouched), kept rearmost via
  `InsertBackingRearmost` after each engine attach, rescaled in `SetSize`,
  deferred-applied at the end of `AttachWebView2`.
- Bridge: `host/backing-color` request (schema + response arm + MockBridge no-op +
  `BridgeDispatcher` handler with a defensive `#rrggbb`/`#rgb`/`rgb()` parser) →
  `LayoutBroker::SetBackingColor` → compositor.
- Web: `useBackingColorSync(bridge)` hook (reads resolved `--bg`, pushes on mount +
  on `data-theme` change), mounted in `AppShell`.

**Verification done (me):**
- `vitest` **370** pass (44 files) — +3 new `backing-color-sync` tests.
- `pnpm build` — tsc clean (bridge-schema arms consistent) + dist composition.
- Release **and** Debug x64 built clean (NuGet restored per-config in the fresh
  worktree; Debug `LNK4098 LIBCMTD` is the pre-existing benign warning).
- `host.log` proved the path: backing created **rearmost (behind engine)**;
  recolor `#ECECEC` (light) and `#111111` (dark) on a live CDP theme toggle; single
  engine-attach ⇒ my `AttachEngineVisual` reorder was a no-op this run; web→host
  colour matches the `--bg` tokens exactly.

**Verification deferred to user (stated upfront):**
- The on-screen result (wedges now `--bg`, both themes). The dev machine runs the
  engine at ~4 FPS with broken GPU compositing (engine fills the window in manual
  launches), so the composite can't be eyeballed locally.

**a11y goldens:** arch-C lane = 148 pass / 30 skip / **9 fail**, all classified
NOT-mine and NOT regenerated (per L-030, degraded env): 4× `splitters` (known
L-014), 3× `dxgi-*` (the ~4 FPS env; `dxgi-perf` reported 4.3 FPS vs 30 floor),
2× `a11y-*-composition` (zero-DOM change can't alter the UIA tree; known
non-deterministic goldens per L-024, timing-sensitive at 4 FPS). Legacy lane not
run — the backing is arch-C-only (`SetBackingColor` no-ops when no DComp
compositor is attached), so arch-A is unaffected by construction. **CI / a healthy
machine is the golden authority.**

**Follow-up spawned:** remove the spawner's redundant nested `.panel` (separate
task; unrelated to the backing fix).
