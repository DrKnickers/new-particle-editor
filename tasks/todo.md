# [MT-3 rework] Merge the Background button and the Skydome picker

**Status (2026-05-15):** plan draft, awaiting user approval. Target branch: `feat/mt3-skydome` (continues PR #73 — additional commits on top of `8623e46`, **not** a fresh PR).

This rework supersedes the design that landed in commits `250cfa7` → `8623e46`. The shipped engine work (skydome render pass, FX shader, sphere mesh, RCDATA bundle, registry helpers) is untouched; only the **entry surface** changes — one toolbar button instead of two, with the picker reached through the existing Background button.

---

## 1. Goal + scope

**Goal.** Replace the two-button toolbar surface (`Background:` ColorButton + standalone Skydome preview) with a **single Background button** that previews the current background state — a colour swatch when the skydome is off, a thumbnail when a skydome is active — and that opens the existing MT-3 picker dialog with slot 0 reframed as **Solid colour**. Click slot 0 in the picker → opens the `ChooseColor` dialog (mirroring MT-2's ground-picker solid-colour slot exactly). Click slots 1–11 → loads a skydome.

**Why this is structurally cheap.** All engine-side MT-3 work is preserved. The skydome render pass, shader, sphere mesh, RCDATA assets, registry persistence, and the picker dialog's *internals* (ListView subclass, thumbnail builder, custom-path handling) all stay. The deltas are in `main.cpp`'s toolbar wiring and a small slice of the picker's slot-0 behaviour.

**In scope.**
- Delete the standalone Skydome preview button (`hSkydomePreview`, `ID_SKYDOME_PREVIEW`, its WM_DRAWITEM branch, its BN_CLICKED branch, its WM_SIZE positioning).
- Change `hBackgroundBtn` from the custom `ColorButton` class to a plain `BS_OWNERDRAW BUTTON`. Owner-draw: when `SkydomeIndex == 0` paint a colour swatch (current background colour); otherwise paint the current skydome's thumbnail. Border + focus rect identical to the skydome preview.
- Move `hBackgroundBtn`'s click handler from `CBN_CHANGE` to `BN_CLICKED`. Click → open the picker (renamed `ShowBackgroundPicker` in source, dialog ID stays internal but string-table entries refresh).
- Reframe slot 0 in the picker: thumbnail is the current solid-colour swatch (not the "Off" × glyph). Label becomes `Solid colour` (was `Off`). Clicking slot 0 → call new `BackgroundPicker_PickSolidColor` helper (cloned from `GroundTexturePicker_PickSolidColor` at [src/main.cpp:3726](src/main.cpp:3726)): opens `ChooseColor`, on commit updates `Engine::m_background`, persists via `WriteBackgroundColor`, refreshes the picker's thumbnail and the toolbar preview.
- Preserve the existing 16-slot custom-colour palette persistence (`ReadCustomColors` / `WriteCustomColors`) — move the `WriteCustomColors` call from the deleted `CBN_CHANGE` block into `BackgroundPicker_PickSolidColor`.
- Update header-strip WM_SIZE math at [src/main.cpp:2661](src/main.cpp:2661) and the layout comment.
- Update strings: `IDS_SKYDOME_OFF` → `Solid colour` (en + de placeholder). Picker title string may change from `Skydome` to `Background` (TBD with user — see Open questions).
- Refresh CHANGELOG and ROADMAP entries for MT-3 to reflect the new design.
- Refresh the PR #73 description on GitHub.

**Out of scope.**
- Engine render path. `Engine::Render` and `Skydome.fx` are unchanged. Reason: the behaviour the engine implements is correct; only the UI surface changes.
- Registry key names (`BackgroundColor`, `SkydomeIndex`, `SkydomeCustomSlot{9,10,11}`). Renaming them would orphan existing user preferences across the upgrade. Reason: no user benefit, real cost.
- Bundling `Background:` + `Skydome` into a single registry key. They remain independent so "remember last solid colour across a skydome switch" works for free.
- New skydome content. Reason: separate ROADMAP entry if user-driven.
- Touching the `ColorButton` class itself. We stop *using* it for the background button but leave the class in place — other places may rely on it later (currently it has no other call sites, but removing the class is a separate cleanup PR if anyone cares).
- Reset View Settings semantics. `BackgroundColor` stays user-data, not view-data, same as today. `SkydomeIndex` stays view-data and gets wiped by reset, same as today.

---

## 2. What the codebase already gives us

| Need | Existing artefact | Location |
|---|---|---|
| Pattern: owner-drawn 24×24 toolbar preview button | `hSkydomePreview` create + WM_DRAWITEM + WM_SIZE | [src/main.cpp:2012](src/main.cpp:2012), [src/main.cpp:2249](src/main.cpp:2249) |
| Pattern: clicking a picker slot to open `ChooseColor` | `GroundTexturePicker_PickSolidColor` | [src/main.cpp:3726](src/main.cpp:3726) |
| Pattern: refreshing toolbar preview after engine state change | `RebuildGroundTexturePreviewBitmap` + `InvalidateRect` calls inside `GroundTexturePicker_PickSolidColor` | [src/main.cpp:3743](src/main.cpp:3743) |
| Picker dialog chrome (modeless tool window) | `ShowSkydomePicker` | [src/main.cpp:5265](src/main.cpp:5265) |
| ListView subclass + slot painting | `SkydomeLVSubclassProc`, `SkydomeLV_PaintAll` | [src/main.cpp:5217](src/main.cpp:5217) |
| Thumbnail builder (slot 0 = ×, slots 1–8 = RCDATA, slots 9–11 = custom) | `MakeSkydomeSlotThumbnail` | [src/main.cpp:4537](src/main.cpp:4537) |
| Custom-colour palette persistence | `Read/WriteCustomColors`, `ColorButton_GetCustomColors` | grep for `CustomColors` |
| Background colour engine state | `Engine::SetBackground` / `GetBackground` + `Read/WriteBackgroundColor` | [src/main.cpp:3138](src/main.cpp:3138), [src/main.cpp:3154](src/main.cpp:3154) |
| Skydome registry helpers | `Read/WriteSkydomeIndex`, `Read/WriteSkydomeCustomPath` | [src/main.cpp:5381](src/main.cpp:5381) onward |

Nothing on the engine side needs new APIs. On the UI side, one new helper (`BackgroundPicker_PickSolidColor`) is a near-verbatim clone of the ground analog; everything else is rewiring and string changes.

---

## 3. Architecture / implementation approach

### 3.1 Toolbar surface (single button)

**Before:**
```
[Skydome preview][24px gap][Ground tex label][Ground tex preview]  …  [Background label][Background btn(ColorButton)]
```

**After:**
```
[Ground tex label][Ground tex preview]  …  [Background label][Background btn(BS_OWNERDRAW BUTTON)]
```

Background button now does the job of both. Same 24×24 footprint, same position (`width - 28, top + 4`). Owner-draw logic:

```cpp
// WM_DRAWITEM, dis->CtlID == ID_BACKGROUND_PREVIEW (renamed from existing ColorButton id)
if (engine->GetSkydomeIndex() == 0) {
    // Flat swatch — paint dis->rcItem with engine->GetBackground().
    FillRect(dis->hDC, &dis->rcItem, hBgBrush);
} else {
    // Thumbnail — same path as the deleted hSkydomePreview owner-draw.
    DrawBitmap(dis->hDC, &dis->rcItem, info->hBackgroundPreviewBitmap);
}
DrawEdge + focus rect as today.
```

The owner-draw cached bitmap (`hBackgroundPreviewBitmap`) is rebuilt by a `RebuildBackgroundPreviewBitmap` helper — identical to `RebuildSkydomePreviewBitmap` but it short-circuits to NULL when `SkydomeIndex == 0` (so the owner-draw falls through to the swatch path).

### 3.2 Click → picker

`hBackgroundBtn`'s `BN_CLICKED` branch (where `hSkydomePreview`'s lived) calls `ShowBackgroundPicker(hWnd, info)`. That function is the renamed `ShowSkydomePicker` — same internals, same dialog template `IDD_SKYDOME_PICKER` (rename inside the .rc only if the user wants — see Open questions).

### 3.3 Picker slot 0 = Solid colour

**Thumbnail.** `MakeSkydomeSlotThumbnail(slot=0)` currently paints a dark background + large × glyph. After: paint a flat fill of the current `engine->GetBackground()` colour, with a subtle 1-px inner border so a black background is still visible against the slot's own background. Mirrors how `MakeGroundSlotThumbnail` paints its slot-4 solid-colour preview.

**Label.** String table `IDS_SKYDOME_OFF` (value 230) renamed semantically to `IDS_SKYDOME_SOLID_COLOR`, text changes from `Off` → `Solid colour`. (German placeholder stays English-equivalent per project convention.)

**Click behaviour.** Add a check at the front of the slot-0 path inside `SkydomeLVSubclassProc`'s click handler:

```cpp
if (clickedSlot == 0) {
    // Mirrors GroundTexturePicker_PickSolidColor exactly.
    BackgroundPicker_PickSolidColor(hDlg, data);
    // Also commit selection to slot 0 (no skydome).
    SetSkydomeIndex(0);
    return;
}
```

New helper `BackgroundPicker_PickSolidColor` is a verbatim clone of `GroundTexturePicker_PickSolidColor`, but:
- `engine->GetGroundSolidColor` → `engine->GetBackground`.
- `WriteGroundSolidColor` → `WriteBackgroundColor`.
- `RebuildGroundTexturePreviewBitmap` → `RebuildBackgroundPreviewBitmap`.
- After commit also calls `WriteCustomColors` (carrying forward the palette-persistence behaviour that lived in the deleted `CBN_CHANGE` handler).

### 3.4 Files touched

- `src/main.cpp` — all UI deltas.
- `src/Resources/resource.en.h` / `resource.de.h` — `IDS_SKYDOME_OFF` rename (text change only; ID number stays).
- `src/Resources/resource.h` — likely untouched (skydome RCDATA + shader IDs unchanged).
- `src/ParticleEditor.en.rc` / `.de.rc` — only if we rename the dialog title string (Open question).
- `CHANGELOG.md` — rewrite the MT-3 entry to describe the merged design.
- `ROADMAP.md` — update the MT-3 shipped entry's body to match.

### 3.5 No new resource IDs

`ID_SKYDOME_PREVIEW` is deleted from `resource.en.h` / `resource.de.h`. The Background button's existing ID stays (it's the click target now, not the ColorButton's hidden internal). `IDC_SKYDOME_PICKER_*` ids stay; the dialog template stays; only one string ID gets renamed.

---

## 4. Risks named up front + mitigations

1. **Risk: the owner-draw paint path for the Background button picks the wrong source state.** If `Engine::GetSkydomeIndex()` returns 0 but `hBackgroundPreviewBitmap` is still pointing at a cached thumbnail (stale across a Reset View Settings call), the swatch path won't fire and the button will show the old skydome thumbnail.
   - **Mitigation:** `RebuildBackgroundPreviewBitmap` is called from *every* state-changing site: picker commit (skydome slot), `BackgroundPicker_PickSolidColor` (solid-colour edit), Reset View Settings, startup. The owner-draw branch keys off `engine->GetSkydomeIndex()` directly, not the bitmap pointer, so even a stale bitmap is correctly bypassed when the index is 0. Code-level intervention: a single `if (engine->GetSkydomeIndex() == 0)` gate at the top of the WM_DRAWITEM branch.

2. **Risk: deleting the `CBN_CHANGE` handler breaks colour-palette persistence.** The handler at [src/main.cpp:2432](src/main.cpp:2432) currently calls `WriteCustomColors` so the user's 16 custom-palette slots survive a restart. Deleting that block without re-homing the call drops the feature.
   - **Mitigation:** the new `BackgroundPicker_PickSolidColor` calls `WriteCustomColors` immediately after `ChooseColor` returns OK. Pre-handoff verification step explicitly checks: open background picker → click slot 0 → define a custom colour in ChooseColor's "Add to Custom Colors" → cancel → restart editor → re-open ChooseColor via the picker → the custom slot persists.

3. **Risk: the "click slot 0 always opens ChooseColor" UX is annoying when the user just wants to *select* solid-colour mode without re-editing the colour.** Today the Background button click immediately opens ChooseColor (single click); the change preserves that latency. But if the user is *currently* on a skydome slot and wants to revert to "use the previously-saved solid colour" without re-choosing, they're forced through ChooseColor.
   - **Mitigation:** add a Cancel path. If `ChooseColor` returns FALSE (user pressed Cancel), still commit `SkydomeIndex = 0` so the skydome is turned off but the existing `BackgroundColor` is preserved. That matches the MT-2 ground-picker behaviour for slot 4 today — verify in code before claiming the analog. **Verification step in §5 confirms this.**

4. **Risk: changing the Background button's window class from `ColorButton` to `BUTTON` invalidates any `SendMessage` calls that target ColorButton-specific messages.** Any caller doing `ColorButton_GetColor(info->hBackgroundBtn)` or `ColorButton_SetColor(...)` on the button HWND will silently no-op or worse.
   - **Mitigation:** grep for all `ColorButton_*` calls on `hBackgroundBtn` before deleting the ColorButton wiring. Each call site gets either deleted (if it was reading the ColorButton-stored colour, which is now in `engine->GetBackground()` directly) or replaced with the engine-side getter. Known call sites from the earlier grep: [src/main.cpp:1660](src/main.cpp:1660), [src/main.cpp:7229](src/main.cpp:7229), [src/main.cpp:2435](src/main.cpp:2435), [src/main.cpp:2444](src/main.cpp:2444). All four are auditable in one pass.

5. **Risk: PR #73's existing approvals / spec compliance reviews are invalidated.** The original design was per-task spec-reviewed; the rework hasn't been.
   - **Mitigation:** explicit code-quality review pass on the rework before merge. The skydome engine work doesn't change so the existing engine-side approval is still valid; the new review focuses on the UI rewiring deltas. Document in the PR description that the engine work is unchanged from the original reviews.

6. **Accepted risk: layout shift may be visually jarring for someone who already saw the two-button version.** The header strip is ~28 px narrower of controls. Not worth designing around — the new design is the design we're shipping.

---

## 5. Testing & verification

**Build.**
- Debug + Release x64 clean (0 errors, 0 warnings on the touched TU).

**Happy paths.**
- Launch editor → top-right toolbar shows one button labelled `Background:` next to a 24×24 owner-drawn preview. No standalone skydome button. Layout doesn't visibly jump.
- Initial state with `SkydomeIndex == 0`: preview shows the current background colour as a flat swatch.
- Click preview → picker opens. Slot 0 shows the current background colour as its thumbnail; slots 1–8 show bundled skydome thumbnails; slots 9–11 show "Empty / set custom…" or assigned custom thumbnails.
- Click slot 1 (Day) → picker closes (or stays per existing behaviour — match MT-2's pattern), engine renders the skydome, toolbar preview swaps to show the Day thumbnail.
- Click preview again → picker re-opens, slot 1 highlighted as active.
- Click slot 0 → ChooseColor opens. Pick a new colour, click OK. Picker thumbnail for slot 0 updates to the new colour, engine clears with the new colour, toolbar preview updates.
- Click slot 0 with ChooseColor → Cancel. Skydome is turned off (revert to flat colour), but the colour itself is unchanged. **Verify this matches MT-2 ground-picker slot-4 behaviour before claiming the analog holds.**
- Custom slots 9–11 unchanged: right-click → assign DDS/TGA → thumbnail loads.

**Edge cases.**
- First-run (no registry entries) → defaults to solid-colour mode with `RGB(0x14,0x08,0x34)` (the deep-purple default seen at [src/main.cpp:1652](src/main.cpp:1652)).
- Reset View Settings → wipes `SkydomeIndex`, leaves `BackgroundColor` intact. Toolbar preview reverts to swatch.
- Open picker, then *delete the current mod* mid-session → picker doesn't dereference stale info pointer (existing modeless-tool-window discipline applies).
- Open picker, switch mod, picker still alive → custom slots refresh (or stay; match existing behaviour).
- Rapid double-click on slot 0 → only one ChooseColor opens at a time.

**Persistence round-trip.**
- Pick a skydome → close editor → re-launch → preview shows the same skydome thumbnail, engine renders it.
- Pick a custom colour with "Add to Custom Colors" → close editor → re-launch → click slot 0 → ChooseColor opens with the same custom-palette slot defined.

**Code-quality static checks.**
- All `ColorButton_*` references to `hBackgroundBtn` are gone (grep clean).
- `ID_SKYDOME_PREVIEW` is gone from both `resource.*.h` files (grep clean).
- `hSkydomePreview` is gone from `MAIN_WND_INFO` struct (grep clean).
- WM_SIZE comment at [src/main.cpp:2661](src/main.cpp:2661) updated to match the new layout.

**Debug instrumentation.**
- `#ifndef NDEBUG`: a printf in the owner-draw branch — `BG: paint mode=%s (skydome=%d, bgcolor=#%06X)\n` — to confirm the right path fires on state changes. Tag prefix `BG:` for grep. Remove or gate before ship.

**Pre-handoff smoke run.**
- Cold launch x64 Debug from worktree → process alive → click preview → picker opens → click slot 1 → render shows skydome → close → re-launch → state preserved.

---

## Task breakdown (execution order)

1. **Audit `ColorButton` call sites on `hBackgroundBtn`.** Grep all four known references, decide deletion vs replacement per site. ~5 min.
2. **Replace the Background button creation.** Change class from `ColorButton` to `BUTTON` + `BS_OWNERDRAW`. Add `hBackgroundPreviewBitmap` field to `MAIN_WND_INFO`. ~15 min.
3. **Add WM_DRAWITEM branch for the new button.** Two-path owner-draw: swatch vs thumbnail. ~20 min.
4. **Add `RebuildBackgroundPreviewBitmap` helper.** Mirrors `RebuildSkydomePreviewBitmap`, short-circuits to NULL when `SkydomeIndex == 0`. ~15 min.
5. **Move click handler.** Delete the `CBN_CHANGE` block; add a `BN_CLICKED` branch that calls `ShowBackgroundPicker`. ~10 min.
6. **Single rename**: `RebuildSkydomePreviewBitmap` → `RebuildBackgroundPreviewBitmap`. Its target HBITMAP + target HWND + short-circuit-when-SkydomeIndex-zero behaviour all change, so the rename signals contract change, not pure churn. All other picker-internal `Skydome*` symbols stay — they correctly describe what the picker shows (11 of 12 slots are skydomes). ~5 min.
7. **Clone `GroundTexturePicker_PickSolidColor` → `BackgroundPicker_PickSolidColor`.** Substitute the four engine/registry/bitmap helpers per §3.3. ~15 min.
8. **Wire slot 0 in the picker.** Add the slot-0 click branch that calls `BackgroundPicker_PickSolidColor` then commits `SkydomeIndex = 0`. ~10 min.
9. **Update `MakeSkydomeSlotThumbnail(slot=0)`** to paint a flat colour swatch instead of the × glyph. ~15 min.
10. **Delete the standalone skydome button.** Remove `hSkydomePreview`, `ID_SKYDOME_PREVIEW`, its WM_DRAWITEM branch, its BN_CLICKED branch, its WM_SIZE positioning, the layout comment fragment. ~15 min.
11. **Rename `IDS_SKYDOME_OFF` text to `Solid colour`** in both `.rc` files (en + de). ~5 min.
12. **Build Debug x64.** Fix errors. ~5 min loop.
13. **Build Release x64.** Confirm clean. ~5 min.
14. **Smoke-launch and walk every test row in §5.** Document results in the PR comment. ~20 min.
15. **Update CHANGELOG MT-3 entry + ROADMAP MT-3 entry.** Rewrite to describe the merged design. ~10 min.
16. **Update PR #73 description on GitHub.** Replace the two-button narrative with the single-button narrative; preserve the engine-work description; add a note that the rework is a follow-up redesign on the same branch. ~10 min.
17. **Commit + push.** Two commits: one for the UI rework (steps 2–12), one for the docs rewrite (step 15). ~5 min.

Total: ~3 hours assuming no surprises in the WM_DRAWITEM path.

---

## Resolved decisions (2026-05-15, before implementation)

1. **Picker dialog title:** `Background`.
2. **Close-on-commit:** stay open (sticky), unchanged from current MT-3 behaviour.
3. **Slot 0 click:** always opens `ChooseColor`. Cancel-out still commits `SkydomeIndex = 0` so the skydome is turned off and the existing colour is preserved.
