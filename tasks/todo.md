# P8b — Texture thumbnails: broken-vs-missing (PAL-14)

**Status:** PLAN — scope + visual ("softer tinted + icon") confirmed by user (2026-06-04).
**Branch:** `claude/practical-moore-1a19a1` (FF into `lt-4`). HEAD = `df7dcda` (P8a).
**Baseline:** vitest 463, build/tsc clean. Native toolchain ABSENT (L-058); nuget cache
PRESENT → robocopy WebView2 1.0.3967.48 + MSBuild Debug x64 needed for the host compile.

## 1. Goal + scope
**Goal.** Restore the legacy distinction between a **broken** thumbnail (file present but
won't decode → reddish-tinted cell + icon + "broken") and a **missing** one (file not found
→ grey-tinted cell + icon + "missing"). Arch-C currently flattens both (and loading) to one
blank block, so a user can't tell "I typo'd the path" from "the .dds is corrupt".

**In:** schema `status` field; host 3-state classification threaded through decode→cache→
bridge; React distinct placeholders (softer tinted + icon + label); both mocks; native
Debug x64 rebuild to confirm compile. **Out:** the magenta/grey *literal* legacy style
(user chose softer); any change to the apply/pin gestures (KEEP list); loading spinner
(neutral block stays).

## 2. What the codebase gives us
- Host already *computes* the distinction: `DecodeToPngBytes` returns `false` for both
  `OpenTextureFile==null` (missing, [PaletteThumbs.cpp:136](src/UI/PaletteThumbs.cpp:136))
  and decode/size failures (broken) — just doesn't surface which. `GetThumbnailDataUri`
  ([:213](src/UI/PaletteThumbs.cpp:213)) caches `filename→string`; one caller
  (BridgeDispatcher.cpp:1894).
- Legacy reference: `GetBrokenPlaceholder`/`GetMissingPlaceholder`
  ([TexturePalette.cpp:189](src/UI/TexturePalette.cpp:189)).
- React `PaletteCell` ([TexturePalettePopover.tsx:203](web/apps/editor/src/screens/TexturePalettePopover.tsx:203))
  with the existing `palette-thumb-placeholder-${filename}` testid (keep it).
- Test mock `makeBridge` (TexturePalettePopover.test.tsx) + dev MockBridge (mock.ts:563).

## 3. Implementation approach
- **Schema:** `{ dataUri: string | null }` → `{ dataUri: string | null; status: "ok" |
  "missing" | "broken" }`. `dataUri` non-null iff `status==="ok"`.
- **Host** (TexturePalette.h + PaletteThumbs.cpp + BridgeDispatcher.cpp):
  - `enum class ThumbStatus { Ok, Missing, Broken };`
    `struct ThumbnailResult { std::string dataUri; ThumbStatus status; };`
  - `DecodeToPngBytes` returns `ThumbStatus` (Ok fills `outPng`). Missing = fm/device null
    OR file-not-found; Broken = size 0 / decode / lock / encode failure.
  - Replace `GetThumbnailDataUri` with `ThumbnailResult GetThumbnail(...)`; cache becomes
    `unordered_map<wstring, ThumbnailResult>` (still caches failures — don't re-decode).
  - Bridge emits `{dataUri, status}` (status string from the enum).
- **React** `PaletteCell`: state `{dataUri, status}|undefined` (undefined=loading). Render:
  `status==="ok"` (dataUri) → `<img>`; `"broken"` → reddish cell (`bg-red-950/40`
  border-red) + broken-image glyph + "broken"; `"missing"` → grey cell + glyph + "missing";
  loading → neutral block. Keep the `palette-thumb-placeholder-${filename}` testid on the
  placeholder wrapper + add `data-thumb-status`. `catch` → treat as `broken` (transport/
  decode failure is the closest visual).
- **Mocks:** test `makeBridge` gains `thumbnailStatus`; dev mock returns
  `{dataUri:null, status:"missing"}`.

## 4. Risks + mitigations
1. **Backward-compat of the existing null-placeholder test.** It asserts the testid with a
   mock returning `{dataUri:null}` (no status). *Mitigation:* keep the testid on the wrapper;
   default `status ?? "missing"` so an absent status still renders a placeholder → existing
   test stays green.
2. **Cache type change.** `g_bridgeThumbCache` value `string→ThumbnailResult`.
   `ClearBridgeThumbCache` unaffected. Low risk; compile-checked.
3. **Native rebuild required (L-039/L-046).** Host C++ change → must compile Debug x64.
   *Mitigation:* robocopy WebView2 from nuget cache (NOT `Copy-Item -Recurse $src\*`) +
   MSBuild `ParticleEditor.sln` (repo root). Confirm clean compile; hand visual verify to user.
4. **`catch`→broken.** A transport failure isn't a corrupt texture. *Mitigation:* rare;
   broken is the closest honest signal; comment it.

## 5. Testing & verification
- **TDD (web):** extend TexturePalettePopover.test.tsx — `status:"broken"` →
  `data-thumb-status="broken"` + "broken" label; `status:"missing"` → "missing"; `status:"ok"`
  → `<img>`; existing null-placeholder test still green. Update `makeBridge`.
- vitest (expect 463 + ~3), build, `tsc` clean.
- **a11y goldens:** the palette popover isn't a captured surface (popover, like the color
  picker) — grep-confirm zero capture; no re-baseline expected.
- **Host:** native Debug x64 compiles clean (toolchain bring-up first).
- **User's lane (native):** point a slot at (a) a non-existent file → grey "missing"; (b) a
  corrupt/zero-byte .dds → reddish "broken"; a valid texture → thumbnail.

## Review

**Shipped (2026-06-04).** PAL-14 across all layers, "softer tinted + icon" style.

- **Schema** — `textures/palette/thumbnail` response gains `status: "ok"|"missing"|"broken"`.
- **Host** ([PaletteThumbs.cpp](src/UI/PaletteThumbs.cpp), [TexturePalette.h](src/UI/TexturePalette.h),
  [BridgeDispatcher.cpp](src/host/BridgeDispatcher.cpp)) — `enum ThumbStatus` +
  `struct ThumbnailResult`; `DecodeToPngBytes` now returns the 3-state status (Missing =
  device/FM null or file-not-found; Broken = empty / decode / encode failure);
  `GetThumbnailDataUri`→`GetThumbnail` (cache now `filename→ThumbnailResult`); bridge emits
  `{dataUri, status}`.
- **React** ([TexturePalettePopover.tsx](web/apps/editor/src/screens/TexturePalettePopover.tsx)) —
  `PaletteCell` branches on status: reddish cell + ⚠ + "broken", grey cell + ? + "missing",
  neutral block while loading, `<img>` on ok. Kept the `palette-thumb-placeholder-*` testid;
  added `data-thumb-status`. `catch`→broken.
- **Mocks** — test `makeBridge` gains `thumbnailStatus`; dev MockBridge returns
  `{dataUri:null, status:"missing"}`.

**Verification:**
- vitest **466** (was 463; +3: broken/missing/ok). TDD: watched broken+missing fail RED
  (no `data-thumb-status`), then GREEN; "ok" passed via the existing img branch.
- `pnpm build` clean; `tsc --noEmit` exit 0.
- **Native Debug x64 compiles + links clean** (`MSBUILD EXIT=0` → `x64\Debug\ParticleEditor.exe`)
  after robocopy WebView2 restore (L-039) + MSBuild (L-046). LNK4098 is pre-existing/benign.
- **Zero golden change** (grep — palette popover not a captured surface).

**User's lane (native, L-033/L-057):** open the texture palette in `--new-ui` and confirm a
non-existent path shows grey "missing", a corrupt/zero-byte .dds shows reddish "broken", and
a valid texture still thumbnails. (MockBridge can't exercise this — no engine/files.)

---

# P8a — Color picker live-preview + cancel/revert (PAL-2 / PAL-3)

**Status:** PLAN — scope + dismiss-model confirmed by user (2026-06-04). Ready to execute.
**Branch:** `claude/practical-moore-1a19a1` (FF into `lt-4` at session end).
**Baseline verified:** git clean (HEAD = origin/lt-4 = `8f783b6`, 0/0), vitest **454/49**,
`pnpm build` clean, `tsc --noEmit` exit 0. `node_modules` reinstalled (fresh worktree, L-058).
Native build NOT present and **NOT needed** for P8a (proven web-only — see §4 risk 5).

> P8 splits into **P8a (this plan — PAL-2/3, pure web, TDD)** and **P8b (PAL-14 thumbnails,
> host C++ + native rebuild)**. P8a ships + FFs first; P8b is a separate follow-up commit.

---

## 1. Goal + scope

**Goal.** Restore the legacy color-picker's two-phase transaction so an exploratory color
edit is both *live* and *reversible*. After this ships: dragging an RGB slider (or typing a
hex, or clicking a swatch) updates the 3D scene **live** as you go (PAL-2), and an explicit
**Cancel** (or Escape) snaps the engine back to the color the picker opened with (PAL-3) —
the safety net the new commit-as-you-go picker lost, made more important by the inert undo
(VPT-2). Faithful port of `src/UI/ColorButton.cpp` (legacy `CustomHookProc` fires
`CBN_CHANGE` per R/G/B change; `WM_LBUTTONUP` snapshots `original` and reverts on Cancel).

**In:**
- **PAL-2 (MED)** — live preview: fire `onChange` on every in-flight edit (slider tick,
  valid hex parse, swatch click), not just on slider release.
- **PAL-3 (MED)** — Cancel/revert: snapshot `originalColor` on open; **OK + click-outside
  keep** (consistent with new-UI commit-on-blur, SPN-9, KEEP list); **Cancel button +
  Escape revert** to `originalColor`. New `Cancel | OK` footer row.
- Fix a latent staleness bug surfaced by the rework: `pickerColor` is currently
  `useState(value)` (initialized once at mount, never re-synced) — the open-edge snapshot
  re-syncs it each open.
- **UX extras (user-approved 2026-06-04):**
  - **Before/After preview swatch** — show `originalColor` next to `pickerColor` by the
    OK/Cancel row (native-ChooseColor-style), making Cancel discoverable. Display-only.
  - **Editable R/G/B inputs** — the read-only R/G/B value spans become `type="number"`
    inputs (clamp 0–255, live `onChange`), narrowing the PAL-1 gap.
  - **Enter-in-hex = OK** — Enter in the hex field commits *and* closes.

**Out (with reasons):**
- **PAL-14** thumbnails (broken-vs-missing) — separate P8b commit; needs host C++ + native
  bring-up; native-only verification; LOW sev. Deferred by explicit scope decision.
- **PAL-9** single-click texture apply, **PAL-1** custom picker, **PAL-4** registry
  persistence, **PAL-8** popover-not-toolwindow — all on the KEEP list (intentional new-UI).
- **rAF/throttle coalescing** of live onChange — not now (YAGNI; legacy didn't throttle and
  the bridge is async fire-and-forget). Revisit only if the user reports drag lag (Risk 1).
- **No new host command / schema / mock change** — `onChange` already flows to the engine
  via existing call-site bridge requests.

## 2. What the codebase already gives us

- **`ColorButton.tsx`** ([primitives/ColorButton.tsx](web/apps/editor/src/primitives/ColorButton.tsx)) —
  the only behaviour file. Already has `pickerColor` state, `handleSelectColor` (fires
  `onChange`, keeps popover open), `handleSliderChange` (currently *suppresses* onChange,
  ColorButton.tsx:106), `handleSliderCommit` (onMouseUp/onKeyUp → onChange), hex
  handlers, Radix `Popover.Root` (currently **uncontrolled**).
- **Call sites** forward `onChange` to thin setters that do `setState` +
  `void bridge.request(...)` — e.g. `updateSun`/`updateAmbient`
  ([LightingPanel.tsx:239,290](web/apps/editor/src/screens/LightingPanel.tsx:239)),
  plus `GroundTexturePanel`, `ToolPanel`, `PrimitivesGallery`. No undo push (VPT-2 inert),
  nothing heavy per call. **No call-site edits needed** — they just fire more often (= the
  live preview we want).
- **Legacy reference** `src/UI/ColorButton.cpp:97-110` (snapshot `original`; OK keeps,
  Cancel sets `rgbResult = original` + fires final change) + `CustomHookProc:40-45` (per-
  change `CBN_CHANGE`).
- **Existing tests** `__tests__/ColorButton.test.tsx` (3 cases: popover opens, basic color
  fires onChange, Add-to-custom) — extend, keep green.

## 3. Implementation approach

**Single primitive, CONTROLLED popover via a single `onOpenChange` funnel.** (The
Enter-in-hex=OK extra needs programmatic close, which uncontrolled can't do cleanly;
controlled also makes OK/Cancel trivial. Desync risk is contained by funnelling every
open/close — and the open-snapshot — through one `onOpenChange`.)

- **Controlled open:** `const [open, setOpen] = useState(false);`
  ```
  <Popover.Root open={open} onOpenChange={(o) => {
    if (o && !open) {                 // open transition → snapshot pre-edit truth
      setOriginalColor(value);
      setPickerColor(value);
      setHexText(rgbToHex(value).slice(1).toUpperCase());
    }
    setOpen(o);                       // single funnel: trigger / outside-click / Escape all land here
  }}>
  ```
  New state: `const [originalColor, setOriginalColor] = useState<RgbColor>(value);`
  (Also fixes the latent `pickerColor` staleness — re-synced each open.)
- **PAL-2 live preview:**
  - `handleSliderChange` → set state **and** `onChange(next)` (delete the suppress comment;
    **remove** `handleSliderCommit` + the now-dead `onMouseUp/onKeyUp` on the ranges).
  - `handleHexChange` → on a *valid* `hexToRgb`, also `onChange(rgb)` (live). Invalid input
    still only updates the text (no onChange). Keep `handleHexCommit` for invalid-text cleanup.
  - `handleSelectColor` (swatch) → unchanged (already fires onChange, keeps open).
- **PAL-3 keep/revert** (`handleCancel` shared by the Cancel button + Escape):
  ```
  const handleCancel = () => {
    onChange(originalColor);              // re-commit the pre-edit color (engine has no undo)
    setPickerColor(originalColor);
    setHexText(rgbToHex(originalColor).slice(1).toUpperCase());
  };
  ```
  - **OK button** → plain `<button onClick={() => setOpen(false)}>OK</button>`. **No
    `onChange`** — `pickerColor` is provably in sync with the last `onChange` (slider/hex/
    swatch set both together; invalid hex sets neither). "Keep" = just close.
  - **Cancel button** → `<button onClick={() => { handleCancel(); setOpen(false); }}>`.
  - **Escape** → `Popover.Content onEscapeKeyDown={handleCancel}` (revert; Radix then funnels
    `onOpenChange(false)` → `setOpen(false)`). Verified reachable via document keydown
    (Modal.test.tsx:36-48).
  - **Outside-click / re-click trigger** → funnel closes, no revert; **keep**.
- **UX extras:**
  - **Before/After swatch:** in the footer, two squares — `originalColor` (label "Original",
    `data-testid="color-original"`) and `pickerColor` (label "New") — so the user sees what
    Cancel restores.
  - **Editable R/G/B inputs:** replace each read-only value `<span>` with
    `<input type="number" min={0} max={255} value={pickerColor[ch]}
    onChange={(e) => { const n = parseInt(e.target.value,10); if (!Number.isNaN(n))
    handleSliderChange(ch, n); }} aria-label={`${ch.toUpperCase()} value`} />`. Reuses
    `handleSliderChange` (clamps + live onChange). NaN-guard ignores transient-empty;
    select-replace + spinner arrows still work (controlled-numeric quirk, accepted).
  - **Enter-in-hex = OK:** the hex `onKeyDown` Enter branch → `handleHexCommit();
    setOpen(false);` (commit + close).
- **Footer layout:** `[Original|New swatches] … [Cancel] [OK]` row, then "Add to custom
  colors" below. Distinct `aria-label`s on every button/input for the tests.

**Data flow:** open → snapshot original=value → user edits stream `onChange` → engine live →
close path decides: keep (just close) or revert (`onChange(original)`). The engine has no
undo, so revert *is* a re-commit of the old value — exactly the legacy model.

**Forward synergy (note for VPT-2 undo, out of scope):** the `originalColor` open-snapshot
is exactly the hook a future undo-capture wants — capture ONE undo entry per picker session
(open→commit), not one per live tick. Flag in the handoff so VPT-2 coalesces.

## 4. Risks + mitigations

1. **Live-onChange bridge flood.** Per slider tick = one async `bridge.request`. *Mitigation:*
   matches legacy `CBN_CHANGE`-per-change; requests are `void`-fire-and-forget (non-blocking);
   engine tolerated this natively for years. **Accepted.** rAF-coalescing is a deferred
   follow-up only if the user reports drag lag — not designed-around now.
2. **`value` echo vs in-flight state.** Live `onChange` updates the parent → re-renders
   ColorButton with a new `value` (for lighting, round-tripped through 0-1 float via
   `rgbToVec4`). *Mitigation:* `originalColor`/`pickerColor` are snapshotted **only on the
   open edge**, never re-derived from `value` per render — so echoes can't fight the drag.
   The closed swatch/label reading live `value` is correct (shows the live color).
3. **8-bit revert precision.** Lighting colors are 0-1 floats; the picker is 0-255 ints, so
   `originalColor` is the 8-bit-accurate open value and revert restores *that*, not sub-8-bit
   float precision. *Mitigation:* inherent to an 8-bit picker and identical to legacy
   COLORREF — **accepted, faithful.** (L-057-adjacent but not a regression.)
4. **Controlled-open desync.** A scattered `setOpen` could fight Radix's own dismiss.
   *Mitigation:* every open/close + the snapshot funnels through ONE `onOpenChange`; OK/
   Cancel/Enter only ever call `setOpen(false)`. Trigger-toggle, outside-click, and Escape
   all land in the funnel. Explicit reopen + swatch-stays-open tests guard it.
5. **Golden/a11y.** New OK/Cancel live inside the popover content (mounts only when open);
   trigger markup byte-unchanged. **Verified:** `grep` of `*.golden.{yaml,json}` for
   "Basic colors / Add to custom / Hex color input / Pick color" = **no matches** → no
   scenario captures an open color popover → **zero golden change, no native harness
   needed.** (Re-grep after coding to reconfirm.)

## 5. Testing & verification

**TDD — write red first, then implement.** Extend `ColorButton.test.tsx`:

*Happy paths (PAL-2 live):*
- [ ] Slider drag fires `onChange` per change (`fireEvent.change` on the R range →
  `onChange` called with the new RGB *before* any mouseUp).
- [ ] Typing a valid hex fires `onChange` live; typing an invalid hex does **not**.
- [ ] Basic-swatch click still fires `onChange` + popover stays open (existing, keep green).

*Cancel/revert (PAL-3):*
- [ ] Open (value=red) → drag to blue (onChange blue) → click **Cancel** → last `onChange` = red.
- [ ] Open (red) → drag to blue → **Escape** via `fireEvent.keyDown(document, {key:"Escape",
  code:"Escape"})` → last `onChange` = red. (Repo-proven Radix-escape mechanism, Modal.test.)

*Keep:*
- [ ] Open (red) → drag to blue → click **OK** → last `onChange` = blue (no revert fired).
- [ ] **No outside-click-dismiss test** — Radix `pointerDownOutside` is jsdom-flaky
  (Modal.test.tsx:165 avoids it). "Keep" is the default no-revert path, already proven by
  the OK-keeps case; final click-away behaviour is the user's native lane.

*UX extras:*
- [ ] Editable R/G/B input: `fireEvent.change(R-value-input, {value:"100"})` → `onChange`
  fires with `r:100` (live); out-of-range clamps to 0–255.
- [ ] Before/After swatch: after dragging, `color-original` swatch still shows the open
  color (style backgroundColor) while "New" shows the dragged color.
- [ ] Enter-in-hex closes: type a valid hex + Enter → `onChange` fired AND popover content
  gone (`queryByText("Basic colors")` is null).

*Lifecycle / edge:*
- [ ] Reopen after external `value` change re-snapshots the fresh original (rerender with a
  new value, reopen, Cancel → reverts to the *new* value, not the stale mount value).
- [ ] `disabled` → trigger doesn't open (existing behaviour, no regression).
- [ ] Existing 3 tests stay green (popover opens, basic-color fires onChange, Add-to-custom).

*Suite-level:*
- [ ] `pnpm --filter @particle-editor/editor test` → was 454; expect 454 + new cases.
- [ ] `pnpm --filter @particle-editor/editor build` clean; `lint` (`tsc --noEmit`) exit 0.
- [ ] Re-grep goldens to reconfirm zero capture → no `a11y:update` (web-only, L-052/L-053).

*User's lane (L-033/L-057 — native, hand off):*
- [ ] In faithful `--new-ui`: drag a Lighting color slider → scene updates live (PAL-2).
- [ ] Cancel/Escape snaps the scene back to the open color (PAL-3); OK/click-away keep.

## Review

**Shipped (2026-06-04).** PAL-2 + PAL-3 + all three user-approved UX extras, one file
([primitives/ColorButton.tsx](web/apps/editor/src/primitives/ColorButton.tsx)) + its test.

- **PAL-2 live preview** — `handleSliderChange` and valid-`handleHexChange` now fire
  `onChange` per change (deleted the suppress comment + the dead `handleSliderCommit` /
  `onMouseUp/onKeyUp`).
- **PAL-3 cancel/revert** — controlled `open` via a single `onOpenChange` funnel that
  snapshots `originalColor` on the open edge; `handleCancel` re-commits it. **OK +
  click-outside keep**; **Cancel button + `onEscapeKeyDown` revert**.
- **UX extras** — Original/New before-after swatches; editable R/G/B `type=number` inputs
  (reuse `handleSliderChange`, NaN-guarded); Enter-in-hex commits + closes.
- **Latent bug fixed** — `pickerColor` now re-syncs each open (was mount-only).

**Verification (web lane — fully mine, L-057):**
- vitest **463** (was 454; +9 ColorButton cases). Watched all 9 fail RED first, then GREEN.
- `pnpm build` clean; `tsc --noEmit` exit 0.
- **Zero golden change** — re-grepped `*.golden.{yaml,json}` for the new strings: no match
  (no scenario captures an open color popover). No native a11y harness needed.
- **Browser preview (real app + MockBridge)** — drove the Sun-diffuse picker: live slider/
  number preview updates the trigger; Original swatch holds the open color; **Cancel** and
  **Escape** both revert + close; **OK** keeps + closes; console error-free. (Reads taken in
  a tick *after* each event — synchronous post-event reads see pre-React-flush DOM; see
  L-062.)

**User's lane (native, L-033/L-057):** confirm the live preview drives the actual 3D scene
colour and that Cancel/Escape snaps the scene back, in the faithful `--new-ui`.
