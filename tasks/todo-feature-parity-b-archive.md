# [LT-4 feature-parity] Frequently-used texture palette (sub-feature B)

**Context:** Second half of texture-selection parity on the
"make arch-C daily-drivable" program. **(A) Browse picker** shipped
(`ab1d340`); **(B) this plan** exposes the legacy per-mod pinned/recent
texture palette to the new UI. Design approved 2026-05-29 via the
brainstorming flow (visual companion). **Path A chosen:** legacy-parity
per-mod palette with thumbnails; base-game palette + `.meg` content
browser deferred to their own future items.

**Target branch:** `lt-4`  **Difficulty:** ★★★ (3/5)
**Effort:** ~1–1.5 days. Bridge surface + host handlers + thumbnail PNG
helper (~half day), React popover + field wiring + usage tracking
(~half day), vitest + Playwright + live smoke + docs (~half day).

---

## 1. Goal + scope

**When this ships:** Each texture field in the emitter Appearance tab
(Color texture, Bump texture) gets a **palette button** beside Browse
that opens a Radix Popover showing this mod's **Pinned** and **Recent**
textures as a thumbnail grid, filtered by **Color/Bump**. Clicking a
thumbnail applies that texture to the field; a star pins/unpins it;
pins and recents persist per-mod across restarts (the existing
`%APPDATA%\AloParticleEditor\texture-palettes.ini`). Any texture you
commit — via Browse, the palette, or typing a name — is recorded as a
recent, so your go-to textures stay one click away. Matches the legacy
0.2 palette popup.

**In scope:**
- Four new bridge requests over the existing `TexturePalette::Store`:
  `textures/palette/list`, `.../thumbnail`, `.../toggle-pin`,
  `.../touch-recent`.
- Host-side thumbnail decode → PNG (base64 data URI), reusing the
  legacy decode technique; host cache cleared on mod switch.
- React `TexturePalettePopover` + a palette button on
  `TexturePickerField`; Radix Popover mirroring `BackgroundPicker`.
- **Slot-aware filter default:** opening from the Color field starts
  the filter on Color; from Bump, on Bump. Last choice still persists
  per-mod as the fallback.
- **Usage tracking parity:** every `TexturePickerField` commit (Browse
  result, palette click, manual blur) fires `touch-recent` with the
  field's slot.
- **Honest no-mod state:** with no active mod the popover shows an
  empty-state hint ("No mod selected — the palette tracks textures per
  mod") instead of appearing broken.
- Mock dispatcher entries (empty lists / null thumbnails / no-op
  mutations) so browser mode + vitest pass.

**Out of scope (deliberate):**
- **Base-game / unmodded palette** — the Store is per-mod and inert
  unmodded by design (`TouchRecent`/`TogglePin` early-return on no
  active mod). Path A keeps that; a reserved "base game" Store section
  is a *separate future item* (touches the tested Store + INI schema).
- **`.meg` content browser** — picking a texture from inside a `.meg`
  archive needs a virtual file browser over `MegaFile::getNumFiles()`/
  `getFilename(i)`. Feasible but a standalone feature; its own
  brainstorm/plan. (Note: thumbnailing `.meg`-packed textures already
  works for free — `FileManager::getFile` resolves them.)
- **`Store::Remove` UI gesture** — no legacy popup binding found; the
  star (pin toggle) is the only entry mutation. Recents self-evict at
  the 12 cap (LRU). Out unless requested.
- **"Reset View Settings" / `ClearActiveMod`** entry point — no new-UI
  surface for it yet. Out.
- **Popup-position persistence** (`Store::GetPopupPos`/`SetPopupPos`) —
  N/A for an anchored Radix Popover.
- **Grid keyboard navigation** beyond Radix Popover defaults (focus
  trap, Esc-close). Arrow-key cell traversal: out.

---

## 2. What the codebase already gives us

- **`TexturePalette::Store` (data layer) — built + tested.**
  [src/UI/TexturePalette.h:58](src/UI/TexturePalette.h:58),
  [src/UI/PaletteStore.cpp](src/UI/PaletteStore.cpp:179). Per-mod
  pinned + recent (LRU), `SlotMask` (`SLOT_COLOR=1`, `SLOT_BUMP=2`),
  persisted to INI. Methods used here: `TouchRecent(filename, usedAs)`,
  `TogglePin(filename) → bool` (false if pins full), `Pins(filter)`,
  `Recents(filter)`, `ActiveFilter()`, `SetActiveFilter(filter)`,
  `HasActiveMod()`. Caps `MAX_PINS = MAX_RECENTS = 12`
  ([TexturePalette.h:55](src/UI/TexturePalette.h:55)).
- **Active mod is synced for free.** `ModManager::SelectMod` already
  calls `Store::SetActiveMod(...)`
  ([src/ModManager.cpp:213,233](src/ModManager.cpp:213)). The new UI
  drives the same `ModManager` via the Mods menu, so handlers just call
  `Store::Instance()` — **no new mod-lifecycle wiring**. `SetActiveMod("")`
  deactivates without wiping ([PaletteStore.cpp:181](src/UI/PaletteStore.cpp:181)).
- **Thumbnail decoder already exists.** Legacy `DecodeThumbnail`
  ([TexturePalette.cpp:233](src/UI/TexturePalette.cpp:233)):
  `D3DXCreateTextureFromFileInMemoryEx` → `A8R8G8B8` `D3DPOOL_SCRATCH`
  → `LockRect` → BGRA DIB. `OpenTextureFile`
  ([TexturePalette.cpp:205](src/UI/TexturePalette.cpp:205)) does the
  resolution: `Data\Art\Textures\` prefix + uppercase + `.DDS`-swap
  fallback. We reuse the *technique* (not the popup's file-static
  functions) so the legacy popup stays untouched.
- **`.meg` resolution is transparent.** `FileManager::getFile`
  ([managers.cpp:13,47](src/managers.cpp:13)) tries loose then every
  mounted `MegaFile`; base-game `.meg` mount from `Data\MegaFiles.xml`
  regardless of mod. So the decoder thumbnails packed textures by name.
- **GDI+ PNG encode pattern.** The `--capture` tool's
  `CaptureWindowToPng` / `AlphaCompositor::CaptureSnapshotToFile`
  ([src/host/HostWindow.cpp](src/host/HostWindow.cpp)) encode a bitmap
  to PNG via GDI+; reuse the encoder + PNG CLSID.
- **BridgeDispatcher reach.** Holds `m_fileManager` (`IFileManager*`)
  and `m_engine` (`Engine*`, for the D3D9 device) and `m_modManager`
  ([src/host/BridgeDispatcher.h:263,278,289](src/host/BridgeDispatcher.h:263)).
- **Bridge pattern (template = `textures/browse` from A).** Request
  union + `ResponseFor` in
  [bridge-schema/src/index.ts:473,775](web/packages/bridge-schema/src/index.ts:473);
  C++ `if (kind == ...)` handler with `sendOk(json{...})` in
  [BridgeDispatcher.cpp:1570](src/host/BridgeDispatcher.cpp:1570);
  mock `case` in [mock.ts:534](web/apps/editor/src/bridge/mock.ts:534).
- **React integration points.** `TexturePickerField`
  ([EmitterPropertyTabs.tsx:690](web/apps/editor/src/screens/EmitterPropertyTabs.tsx:690))
  pre-structured for the palette button (TODO at
  [:1004](web/apps/editor/src/screens/EmitterPropertyTabs.tsx:1004)).
  `BackgroundPicker.tsx`
  ([web/apps/editor/src/screens/BackgroundPicker.tsx](web/apps/editor/src/screens/BackgroundPicker.tsx))
  is the Radix Popover reference. Bridge via `useBridge()` context
  (NOT `window.bridge` — L-012).

---

## 3. Architecture / implementation approach

### 3a. Bridge surface (`bridge-schema/src/index.ts`)

```ts
// Frequently-used texture palette (per-mod pinned + recent). [LT-4 sub-feature B]
type PaletteEntry = { filename: string; pinned: boolean; slotMask: number };

| { kind: "textures/palette/list";        params: { slot: "color" | "bump" } }
| { kind: "textures/palette/thumbnail";   params: { filename: string } }
| { kind: "textures/palette/toggle-pin";  params: { filename: string } }
| { kind: "textures/palette/touch-recent";params: { filename: string; slot: "color" | "bump" } }

// Responses
R extends { kind: "textures/palette/list" }
  ? { filter: "color" | "bump"; pins: PaletteEntry[]; recents: PaletteEntry[] } :
R extends { kind: "textures/palette/thumbnail" }
  ? { dataUri: string | null } :          // null = missing/broken → React placeholder
R extends { kind: "textures/palette/toggle-pin" }
  ? { ok: true; pinned: boolean } | { ok: false; reason: "pins-full" } :
R extends { kind: "textures/palette/touch-recent" }
  ? { ok: true } :
```

`slot → SlotMask`: `"color" → SLOT_COLOR`, `"bump" → SLOT_BUMP`.

### 3b. Host handlers (`BridgeDispatcher.cpp`)

All call `TexturePalette::Store::Instance()` (already mod-synced).

- **`list`** — `SetActiveFilter(slotMask)` (the slot-aware default,
  which also persists), then return `Pins(filter)`/`Recents(filter)`
  mapped to `PaletteEntry`. With `!HasActiveMod()` both are empty
  (React renders the no-mod hint).
- **`thumbnail`** — `EncodeThumbnailPng(filename)` (3c); on non-empty
  bytes return a `data:image/png;base64,...` URI, else `{ dataUri: null }`.
- **`toggle-pin`** — `TogglePin(filename)`; `false` → `{ ok:false,
  reason:"pins-full" }`, else `{ ok:true, pinned: <new state> }`.
  (Re-read pinned state from `Pins()` membership for the response.)
- **`touch-recent`** — `TouchRecent(filename, slotMask)` → `{ ok:true }`
  (no-op host-side if no active mod or malformed; harmless).

### 3c. Thumbnail PNG helper (new TU `src/UI/PaletteThumbs.cpp`, decl in `TexturePalette.h`)

```cpp
// Decode a texture (by basename) to a PNG byte buffer for the new-UI
// palette bridge. Reuses the legacy DecodeThumbnail technique
// (D3DXCreateTextureFromFileInMemoryEx → LockRect → BGRA) then GDI+
// PNG-encodes. Returns empty on missing file or decode failure (the
// bridge maps empty → { dataUri: null }, React shows a placeholder).
// THUMB_PNG_PX-square (128). Self-contained so the legacy popup TU is
// untouched.
namespace TexturePalette {
  std::vector<uint8_t> EncodeThumbnailPng(const std::wstring& filename,
                                          IFileManager* fileManager,
                                          IDirect3DDevice9* device);
  void ClearBridgeThumbCache();   // called on mods/select
}
```

Host cache: `std::unordered_map<std::wstring, std::vector<uint8_t>>`
keyed by filename, inside the TU; `ClearBridgeThumbCache()` wiped from
the **`mods/select`** handler so same-named textures don't leak across
mods (L-029 territory). Device obtained from `m_engine` (verify the
getter name during impl); files from `m_fileManager`.

### 3d. React (`TexturePalettePopover.tsx` + `TexturePickerField` edits)

- **Palette button** (grid glyph) added to `TexturePickerField` beside
  Browse → opens `<TexturePalettePopover slot=... onApply=... />` as a
  Radix Popover (mirror `BackgroundPicker`).
- **On open:** `textures/palette/list { slot }`. Render Color/Bump
  filter (toggle re-queries `list` with the chosen slot), a "Pinned"
  4×3 grid + "Recent" 4×3 grid (12-cap), ~120px thumbs with filename
  strips. Empty `pins`+`recents` → no-mod / empty hint.
- **Thumbnails (lazy per cell):** each cell calls
  `textures/palette/thumbnail { filename }`, result cached in a
  component `Map<string,string|null>`; placeholder box until resolved;
  `null` → broken/missing placeholder.
- **Apply:** click a thumb → `onApply(filename)` (commits to the field,
  which funnels through the touch-recent wrapper) → close popover.
- **Pin:** star → optimistic toggle + `toggle-pin`; on
  `reason:"pins-full"` revert + show inline status text.
- **Usage tracking:** `TexturePickerField` wraps its `onCommit` so any
  non-empty commit (manual blur, Browse, palette) also fires
  `textures/palette/touch-recent { filename, slot }`. Single funnel =
  parity with legacy's three `TouchRecent` sites
  ([Emitter.cpp:392,402,470,717](src/UI/Emitter.cpp:392)). Bridge via
  `useBridge()`.

### 3e. Mock (`mock.ts`)

`list → { filter: <slot>, pins: [], recents: [] }`; `thumbnail →
{ dataUri: null }`; `toggle-pin → { ok:true, pinned:false }`;
`touch-recent → { ok:true }`. Field stays fully usable via Browse/manual.

---

## 4. Risks named up front + mitigations

1. **Stale thumbnails across mods (same-named files).** Two mods can
   each ship `p_smoke_atlas.dds` with different art; a host cache keyed
   on bare filename would serve mod A's thumbnail under mod B.
   *Mitigation:* `ClearBridgeThumbCache()` invoked from the
   `mods/select` handler (mirrors legacy `ClearThumbnailCache`). The
   cache key stays the filename because the active mod is implicit in
   `getFile`'s resolution at decode time — clearing on switch is what
   keeps it correct.

2. **`D3DPOOL_SCRATCH` lock + device access off the render path.** The
   decode runs inside a synchronous bridge call, not the render loop.
   `D3DPOOL_SCRATCH` textures are system memory (no device dependency
   for the lock) — the legacy popup decodes the same way outside its
   paint, so this is proven. *Mitigation:* reuse the exact pool/flags
   from `DecodeThumbnail`; confirm `m_engine` exposes a device getter
   before wiring (fallback: thread the device in via `BindHostState`,
   like `SetServices` does for the popup).

3. **Base64 PNG payload size.** Up to 24 thumbnails, lazily fetched.
   Each ~128² PNG ≈ a few KB → tens of KB base64; lazy + host-cached
   means one decode per unique file per mod session, re-opens instant.
   *Mitigation:* lazy-per-cell (not one fat `list` payload) keeps every
   message small (cf. L-015 base64-in-payload sizing). If perf ever
   bites, batch is a drop-in follow-up.

4. **`window.bridge` is the wrong instance (L-012).** A deep consumer
   reaching for `window.bridge` may get the broken `TestHostBridge`.
   *Mitigation:* `TexturePalettePopover` + the `TexturePickerField`
   touch-recent wrapper get the bridge via `useBridge()` context.

5. **Optimistic pin desync.** Optimistic star toggle then a
   `pins-full` rejection (or a race) leaves the UI ahead of the Store.
   *Mitigation:* on `ok:false` revert the optimistic state and surface
   the inline status; treat the `list`/`toggle-pin` response as
   authoritative (re-query `list` after a successful pin toggle so
   section membership — pinned vs recent — is correct).

6. **Touch-recent firing on empty/no-op commits.** Wrapping `onCommit`
   could fire `touch-recent` with `""` or on a no-change blur.
   *Mitigation:* skip empty filenames React-side; host `TouchRecent`
   also guards (`FilenameOk`, slot check, no-active-mod early-return),
   so it's defence-in-depth.

7. **CRLF / golden drift on any new committed test fixtures (L-026).**
   If a Playwright golden or snapshot is added, it needs `text eol=lf`.
   *Mitigation:* prefer assertion-based specs over byte-exact goldens
   for this feature; if a golden is unavoidable, add the
   `.gitattributes` rule in the same commit.

---

## 5. Testing & verification

**Build (per L-025):** MSBuild via **PowerShell** against the `.sln`
(Debug + Release x64); verify `x64\Debug\ParticleEditor.exe` exists —
never trust exit 0 alone. Rebuild `dist/` (`pnpm --filter
@particle-editor/editor build`) after React changes (L-004: `pnpm build`
is the type-check truth gate, not `pnpm test`).

**vitest — `TexturePalettePopover.test.tsx` (new):**
- [ ] Renders Pinned + Recent grids from a mocked `list` response.
- [ ] Slot-aware: opening with `slot="bump"` requests `list { slot:"bump" }`.
- [ ] Filter toggle re-queries `list` with the new slot.
- [ ] Click a thumbnail → calls `onApply(filename)` and closes.
- [ ] Star → `toggle-pin`; `pins-full` reverts + shows inline status.
- [ ] Thumbnail cell renders placeholder for `dataUri: null`.
- [ ] No-mod (empty pins+recents) → empty-state hint visible.

**vitest — `TexturePickerField.test.tsx` (extend):**
- [ ] Palette button present beside Browse; opens the popover.
- [ ] Commit via manual blur fires `touch-recent { filename, slot }`.
- [ ] Commit via Browse result fires `touch-recent`.
- [ ] Empty commit ("") does NOT fire `touch-recent`.

**Playwright native (`pnpm test:native`) — real `Store`:**
- [ ] `list` returns the mod's pins/recents after seeding via `touch-recent`.
- [ ] `toggle-pin` round-trips (pin → appears in `pins`; unpin → recents).
- [ ] `thumbnail` returns a non-null `dataUri` for a real mod texture.
- [ ] Apply via palette updates the emitter's `colorTexture`/`normalTexture`.
- [ ] Slot-aware filter reflected in the `list` response.

**Live smoke (`x64\Release\ParticleEditor.exe --new-ui`) — mod selected
(L-029):**
- [ ] Select the mod via Mods menu first (textures resolve).
- [ ] Open palette on Color field → filter starts on Color; on Bump → Bump.
- [ ] Real thumbnails render (not placeholders) for mod textures.
- [ ] Pin a texture, restart, reopen → pin persists (INI round-trip).
- [ ] Commit a new texture via Browse → it appears in Recents.
- [ ] No-mod case: deselect mod → popover shows empty-state hint, no crash.
- [ ] Mod switch → thumbnails reflect the new mod (no stale cross-mod art).

**Debug instrumentation:** reuse the Store's existing `[Palette]`
`DbgPrintf` lines; add `[palette-thumb]` `#ifndef NDEBUG` logging in
`EncodeThumbnailPng` (filename, resolved? , decode HRESULT, PNG byte
count) for fidelity diagnosis.

---

## Review

**Shipped as designed.** Per-mod pinned/recent texture palette in the new
UI: a Radix Popover anchored to a palette button beside Browse on each
texture field, Color/Bump filter, Pinned + Recent thumbnail grids
(12-cap), click-to-apply, star pin/unpin with pins-full status, slot-aware
filter default, usage tracking on every commit (Browse/palette/manual),
honest no-mod hint. Thumbnails reuse the legacy decode technique and
resolve `.meg`-packed textures for free.

**Files.** Schema: [`bridge-schema/src/index.ts`](web/packages/bridge-schema/src/index.ts)
(4 requests + `PaletteEntry` + `hasMod`). Mock:
[`mock.ts`](web/apps/editor/src/bridge/mock.ts). React:
[`TexturePalettePopover.tsx`](web/apps/editor/src/screens/TexturePalettePopover.tsx)
(new) + palette button / touch-recent funnel in
[`EmitterPropertyTabs.tsx`](web/apps/editor/src/screens/EmitterPropertyTabs.tsx)
+ `.texture-btns` CSS. Host: new
[`PaletteThumbs.cpp`](src/UI/PaletteThumbs.cpp) (`GetThumbnailDataUri` +
`ClearBridgeThumbCache`), decl in
[`TexturePalette.h`](src/UI/TexturePalette.h), 4 handlers +
`mods/select` cache-clear in
[`BridgeDispatcher.cpp`](src/host/BridgeDispatcher.cpp), vcxproj(+filters).

**Verification.** vitest **362/362** (15 new across the two TDD specs);
`pnpm build` (tsc) clean; MSBuild **Debug + Release** x64 clean (exe
present); cold-launch smoke (no startup crash); native Playwright suite
**157 passed / 31 skipped** (baseline, no regression); user live smoke
confirmed real thumbnails + slot-aware open + pin/recent behaviour.

**Deltas from the plan.**
- Added `hasMod` to the `list` response so the no-mod hint is honest
  (distinguishes "no mod" from "mod with empty palette").
- Placement fix post-smoke: the palette button initially wrapped to its
  own row (4th child in a 3-col grid); wrapped Browse + palette in a
  `.texture-btns` flex cell so they sit inline, same size.
- Complexity landed at the low end of ★★★ — the legacy decoder reuse
  made the host side small.

**a11y goldens — no change needed (and a near-miss).** The palette
buttons render only inside the emitter inspector's texture fields, which
require a *selected emitter*. No captured a11y surface selects one
(`property-tabs-appearance` shows the "select an emitter" placeholder),
so the feature is golden-neutral. A blanket `pnpm a11y:update` was run
first and showed all 21 composition goldens "drifting" — but that was
**pre-existing environmental pollution** (theme + Spawner-toggle state
in the *shared* WebView2 profile, dirtied by the live smoke), not the
feature. Reverted; goldens left canonical. See [L-030](lessons.md#l-030).

**Deferred (per Path A, deliberate):** base-game/unmodded palette,
`.meg` content browser, `Store::Remove` UI gesture, native Playwright
palette specs (vitest + live smoke cover the behaviour; native specs
would need a textured-mod fixture). The a11y harness profile-isolation
gap (L-030) is a separate infra follow-up.
