# [LT-4 feature-parity] Appearance-tab texture Browse picker (sub-feature A)

**Context:** Feature-parity front of the "make arch-C daily-drivable"
program. Texture-selection parity decomposes into **(A) Browse picker**
(this plan) and **(B) frequently-used texture palette** (separate later
cycle). Design approved 2026-05-29 via the brainstorming flow.

**Target branch:** `lt-4`  **Difficulty:** ★★ (2/5)
**Effort:** ~half-day. Bridge request + host dialog handler (~1h),
mock (~15m), React `TexturePickerField` + wiring (~1.5h), vitest +
manual smoke + docs (~1.5h).

---

## 1. Goal + scope

**When this ships:** Each texture field in the emitter Appearance tab
(Color texture, Bump texture) gets a **Browse…** button that opens a
native file dialog in the active mod's texture folder, filtered to
`*.tga;*.dds`. Picking a file fills the field with the basename and
applies it through the existing commit path — so you can change an
emitter's textures without typing filenames, matching legacy
(`src/UI/Emitter.cpp` IDC_BUTTON1/2 → `LoadTexture`).

**In scope:**
- New bridge request `textures/browse { slot } → { filename }`.
- Host handler: `GetOpenFileNameW` (nested loop, like `file/open`),
  initial dir = active mod's `Data\Art\Textures` (fallbacks below),
  returns basename or `""` on cancel.
- Mock dispatcher: returns `""` (no native dialog in browser).
- React `TexturePickerField` component (text input + Browse button),
  replacing the two raw `FieldText` texture inputs in
  `EmitterPropertyTabs.tsx`.
- vitest for the component; CHANGELOG entry.

**Out of scope (deferred, with reason):**
- **Frequently-used palette** (pins/recents, thumbnails, color/bump
  filter, usage tracking) — sub-feature B, its own cycle. The
  `TexturePickerField` is structured to receive the palette button
  later, but no palette work here.
- **Texture enumeration / `textures/list`** — only needed by B's
  palette; the native dialog enumerates the folder itself.
- **MEG-packed texture browsing** — the native dialog only sees loose
  files (same limit as legacy). Confirmed acceptable: EaWX particle
  textures are loose on disk. Packed-archive picking, if ever wanted,
  belongs with B's palette (which tracks by name regardless of source).
- **Texture-reload-on-change correctness** — assumed already handled by
  the existing `emitters/set-properties` path the text input uses
  (Browse reuses it). If typing a texture name doesn't rebind/reload
  today, that's a pre-existing separate bug; verify, don't fix here.

## 2. What the codebase already gives us

- **`file/open` host dialog precedent** — `BridgeDispatcher.cpp`
  (~`file/open` handler near [`:1572`](../src/host/BridgeDispatcher.cpp))
  already runs `GetOpenFileNameW` in a nested message loop while the JS
  caller awaits. Mirror its shape for `textures/browse`.
- **Emitter texture fields** — `colorTexture` / `normalTexture`
  (`std::string` basenames) on the Emitter
  ([`ParticleSystem.h:141-142`](../src/ParticleSystem.h)), mirrored in
  `EmitterPropertiesDto`
  ([`bridge-schema/src/index.ts:408-409`](../web/packages/bridge-schema/src/index.ts)).
- **New-UI texture inputs already commit** — `EmitterPropertyTabs.tsx`
  ([`:920-955`](../web/apps/editor/src/screens/EmitterPropertyTabs.tsx))
  has `FieldText` "Color texture:" / "Bump texture:" bound to those
  fields, committing via `emitters/set-properties` on blur. Browse
  reuses this exact commit. There's an explicit `TODO(MT-1)` there for
  the palette popup — this plan is the first half.
- **Active mod path** — `ModManager::GetSelectedModPath()`
  ([`ModManager.h:102`](../src/ModManager.h)); the dispatcher already
  reads it (`BridgeDispatcher.cpp:1058, 3730`). Use it for the initial
  dir.
- **Legacy reference** — `src/UI/Emitter.cpp:83-104` (`LoadTexture`:
  `GetOpenFileNameA`, `*.tga;*.dds`, basename via `strrchr`), the
  behaviour to match.
- **Bridge request pattern** — requests are a discriminated union in
  `bridge-schema` + a `kind ==` branch in `BridgeDispatcher::Dispatch*`
  + a mock case. Follow the existing shape (e.g. `file/open`).

## 3. Architecture / implementation approach

**Bridge request** (`bridge-schema/src/index.ts`):
```ts
// request
{ kind: "textures/browse"; slot: "color" | "bump" }
// response
{ filename: string }   // basename, or "" if cancelled
```
`slot` drives only the dialog title here; it also future-proofs B's
usage tracking. No behavioural branch on it in A.

**Host handler** (`BridgeDispatcher.cpp`, new `kind == "textures/browse"`
branch):
1. Initial dir: `<mod>\Data\Art\Textures` if it exists, else `<mod>`,
   else first game root, else none. `<mod>` = `GetSelectedModPath()`.
2. `OPENFILENAMEW` with `lpstrFilter = "Textures (*.tga;*.dds)\0*.tga;*.dds\0All Files\0*.*\0"`,
   `Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR`,
   `lpstrTitle` from slot. Nested-loop modal (host pump pauses; JS
   awaits — same as `file/open`).
3. On OK: strip to basename (last `\` or `/`); `sendOk({filename})`.
   On cancel: `sendOk({filename: ""})`.

**Mock** (the browser/mock dispatcher that mirrors host requests):
return `{ filename: "" }` — browser has no native dialog, so Browse is
a no-op there; keeps Playwright/browser runs clean.

**React** (`web/apps/editor/src/`):
- New `TexturePickerField` component: props `{ label, value, slot,
  onCommit }`. Renders the existing text input + a small **Browse…**
  button. On Browse: `await bridge.request("textures/browse", {slot})`;
  if `filename` non-empty, call `onCommit(filename)` (same commit the
  text input fires on blur).
- In `EmitterPropertyTabs.tsx`, replace the two `FieldText` texture
  inputs with `TexturePickerField` (slot `"color"` → `colorTexture`,
  `"bump"` → `normalTexture`), passing the existing commit callback.

**Data flow:** Browse click → `textures/browse {slot}` → host dialog in
mod texture folder → basename → `onCommit` → `emitters/set-properties
{colorTexture|normalTexture}` → engine rebinds (existing path). Cancel →
no commit.

## 4. Risks named up front + mitigations

1. **Native dialog blocks the host pump.** `GetOpenFileNameW` runs a
   nested message loop. *Mitigation:* this is exactly what `file/open`
   does and is fine — the JS caller awaits; composition/DComp just
   pauses for the dialog's life. Mirror that handler precisely.
2. **No active mod / missing texture folder.** *Mitigation:* initial-dir
   fallback chain (mod texture dir → mod root → game root → none); the
   dialog still opens with no initial dir if all are empty.
3. **Browse commit doesn't reload the texture.** If `set-properties`
   on `colorTexture` doesn't trigger a rebind, Browse "succeeds" but the
   viewport doesn't update. *Mitigation:* this is the *existing* text-
   input path — verify typing-a-name updates the render first; if it
   doesn't, that's a pre-existing bug filed separately, not this plan's.
4. **Path vs basename mismatch.** Storing a full path instead of the
   basename would break texture resolution (fields expect basenames).
   *Mitigation:* strip to basename host-side (as legacy does); unit-
   verify the returned value has no separators.
5. **Slot enum drift.** `slot` strings must match across schema/host/
   React. *Mitigation:* `"color"`/`"bump"` literal union in the schema;
   host treats unknown as color (title only). Low blast radius.

## 5. Testing & verification

- [ ] **vitest** (`TexturePickerField.test.tsx`): renders label + text
      input + Browse button; clicking Browse dispatches
      `textures/browse {slot}`; a returned non-empty filename calls
      `onCommit` with it; a returned `""` does NOT commit. Bridge mocked.
- [ ] **vitest**: `EmitterPropertyTabs` renders two `TexturePickerField`s
      (color + bump) bound to `colorTexture` / `normalTexture`; existing
      text-commit behaviour preserved.
- [ ] **MSBuild Debug + Release x64** clean (host handler compiles).
- [ ] **Native (Playwright)**: the native dialog can't be driven —
      assert the Browse button exists + is wired (dispatch fires). The
      actual file-pick is manual smoke. No regression to existing
      property-tab specs.
- [ ] **Manual smoke** (via the `--capture` build or a live launch):
      select EaWX, open an effect, click Browse on Color texture →
      dialog opens in the mod's texture folder → pick a `.dds` → field
      fills with the basename → viewport rebinds to the new texture.
      Repeat for Bump. Cancel → no change.
- [ ] **Mock/browser**: Browse is a clean no-op (returns `""`); no
      console errors; vitest suite stays green.

## Review

**Shipped — Browse picker (sub-feature A).** Five files:
- `bridge-schema/src/index.ts` — `textures/browse { slot } → { filename }`.
- `BridgeDispatcher.cpp` — host handler: `GetOpenFileNameW` (nested loop,
  like `file/open`), initial dir = active mod's `Data\Art\Textures` →
  mod root → none, filter `*.tga;*.dds`, returns basename or `""`.
- `bridge/mock.ts` — `textures/browse` → `{ filename: "" }` (browser no-op).
- `EmitterPropertyTabs.tsx` — new exported `TexturePickerField` (reuses
  `FieldText` wide + a FolderOpen Browse button); replaces the two raw
  texture `FieldText`s in `AppearanceTab`; `onBrowseTexture` helper
  (calls the bridge) wired from the top-level component through
  `AppearanceTab` (prop made optional w/ no-op default so existing tests
  pass) to `TexturePickerField`.
- `styles/components.css` — `.form-row-texture` (label + input + button
  grid) + `.btn-texture-browse`.
- `__tests__/TexturePickerField.test.tsx` — 3 specs (renders label+input
  +button; commits on non-empty pick w/ slot; no commit on cancel).

**Verification:**
- `tsc --noEmit` clean; **vitest 350 passed** (was 347; +3 new, existing
  `AppearanceTab` suite unaffected).
- MSBuild Debug + Release x64 clean (preexisting LIBCMTD warning only).
- Mock/browser: Browse is a clean no-op (returns `""`).
- **Manual native-dialog smoke: PASSED (user-verified).** Browse opens
  the dialog, picking a `.dds` fills the field and rebinds the texture
  in the viewport (Risk 3 cleared — the existing set-properties path
  reloads the texture).

**Two post-smoke fixes (user feedback):**
1. *Dialog initial dir* — verified (runtime diagnostic) that the handler
   resolves `…\<mod>\Data\Art\Textures` when a mod is selected; the
   dialog opens there. The earlier "didn't default" was a no-mod-selected
   session (empty `GetSelectedModPath` → fell back to last-used folder).
   No code change — confirmed working once EaWX is selected. Shipped at
   `ab1d340` (logic was already correct).
2. *Field stretch* — the input now stretches with the inspector pane
   (`.form-row-texture`: `96px minmax(0,1fr) auto`). Shipped at `3bcdd55`.

**Shipped to `origin/lt-4`** (`ef0a898..3bcdd55`): plan `e7c6318`,
feature `ab1d340`, CHANGELOG backfill `a3a1a6a`, stretch fix `3bcdd55`.

**Next (sub-feature B):** frequently-used texture palette — bridge over
the existing `TexturePalette::Store` + a React popup added to
`TexturePickerField` (structured to receive it).
