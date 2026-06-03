# P6-rest — Curve-editor parity fixes (CRV-2 / CRV-7 / CRV-8)

**Status:** PLAN — awaiting scope confirmation before execution.
**Branch:** `claude/elastic-dirac-a978aa` (FF into `lt-4` at session end).
**Baseline verified:** git clean (HEAD = origin/lt-4 = ad4ceca), vitest 428/49,
`pnpm build` clean.

---

## 1. Goal + scope

**Goal.** Close the three remaining P6 curve-editor deltas so the new curve
editor matches the legacy `CurveEditor.cpp` interaction contract for key
clipboard, right-click, and time granularity.

**In:**
- **CRV-2 (HIGH)** — Copy / Cut / Paste of selected curve keys via Ctrl+C / X / V,
  matching legacy `CopyKeys`/`PasteKeys` ([src/UI/CurveEditor.cpp:414-470](src/UI/CurveEditor.cpp:414)).
- **CRV-7 (MED)** — Right-click on the empty curve canvas in **Select** mode clears
  the selection (legacy `WM_RBUTTONDOWN` → `CM_SELECT` branch,
  [src/UI/CurveEditor.cpp:563-582](src/UI/CurveEditor.cpp:563)). Insert-mode
  right-click keeps dropping to Select mode (already correct).
- **CRV-8 (LOW)** — Time spinner step `1`→`0.1` so the wheel/arrows nudge in tenths
  of a percent (legacy granularity); display picks up the app-wide 2 dp default
  (L-056) for consistency with the sibling Value spinner.

**Out (deferred, with reasons):**
- Curve **marquee-from-the-axis-margins** (separate deferred-polish item — needs the
  canvas viewBox reworked; not a P6 defect).
- P7 link-groups / P8 color-texture — next plan after P6-rest lands + is confirmed.
- A host-side / cross-process curve-key clipboard — the legacy used a Win32
  `RegisterClipboardFormat`; in the web app we keep an **in-app module store**
  (mirrors `emitter-clipboard.ts`). Cross-*application* paste was never a real
  workflow here; cross-*track* and cross-*emitter* paste within the editor session
  is preserved.
- Right-click **on a key** stays the existing Delete context menu (CRV-5, an
  intentional new-only feature on the KEEP list) — untouched.
- Moving the window-scoped **Delete** handler — it works and isn't in scope;
  leaving it avoids churn (surgical-changes principle).

---

## 2. What the codebase already gives us

- **`CurveEditorPanel.tsx`** owns selection (`selectedKeyTimes` by TIME), the
  Time/Value spinners, the focus channel, `focusedTrack`, `borderKeyTimes`, the
  window-scoped **Delete** keydown effect ([CurveEditorPanel.tsx:990](web/apps/editor/src/components/CurveEditorPanel.tsx:990)),
  `handleDelete` (border-filtered), and `handleCanvasAdd` (adds a key + auto-selects
  the returned time). These are the exact primitives Copy/Cut/Paste compose from.
- **`emitters/add-track-key`** dedupes by epsilon (bumps +0.001 until the time is
  unique) and **returns the actual inserted `{time, value}`**
  ([bridge-schema index.ts:647](web/packages/bridge-schema/src/index.ts:647),
  mock `addTrackKeyInOverlay` [mock-state.ts:1371](web/apps/editor/src/bridge/mock-state.ts:1371)).
  → paste-at-original-time is **safe even into the same track**; we select the
  returned times.
- **`TrackKey = { time, value }`** ([bridge-schema index.ts:329](web/packages/bridge-schema/src/index.ts:329)) —
  interpolation is **per-track**, not per-key, so the clipboard only needs
  `{time, value}[]`.
- **`emitter-clipboard.ts`** is the prior-art pattern: a tiny zustand store +
  imperative setter + reactive `hasContent` hook. We add a sibling
  **`curve-key-clipboard.ts`** that actually stores the keys (not just a flag),
  since there is no host buffer for curve keys.
- **`onCanvasContextMenu`** is already wired (`() => setMode("select")`,
  [CurveEditorPanel.tsx:1371](web/apps/editor/src/components/CurveEditorPanel.tsx:1371))
  and the renderer already calls it + `preventDefault`s the native menu on the
  empty backdrop ([CurveEditor.tsx:1607](web/apps/editor/src/screens/CurveEditor.tsx:1607)).
  CRV-7 only needs the callback to branch on `mode`.
- **Tree clipboard scoping precedent:** the emitter tree's Ctrl+C/X/V live on the
  tree container's `onKeyDown` (focus-scoped, [EmitterTree.tsx:1474](web/apps/editor/src/screens/EmitterTree.tsx:1474)).
  The curve panel's Delete is **window-scoped** on purpose — clicking an SVG key
  doesn't move DOM focus into the panel, so a focus-scoped handler would never fire.

---

## 3. Architecture / implementation approach

### CRV-8 (smallest — do first)
`CurveEditorPanel.tsx` Time spinner ([:1229](web/apps/editor/src/components/CurveEditorPanel.tsx:1229)):
`step={1}` → `step={0.1}`; drop `decimals={0}` so it inherits the Spinner's 2 dp
default (matches the Value spinner's `decimals={sb.step >= 1 ? 0 : undefined}`
idiom). `min/max/unit` unchanged. **Touches a composition golden** (toolbar Time
spinner now reads e.g. `45.00` not `45`).

### CRV-7
Change the `onCanvasContextMenu` prop ([:1371](web/apps/editor/src/components/CurveEditorPanel.tsx:1371)) to branch on the
panel's `mode`:
```ts
onCanvasContextMenu={() => {
  if (mode === "insert") { setMode("select"); return; }   // legacy CM_INSERT branch
  // legacy CM_SELECT branch — clear the selection
  setOptimisticSelected(null);
  setSelectedKeyTimes((prev) => (prev.size === 0 ? prev : new Set()));
}}
```
No renderer change (it already calls the callback + suppresses the native menu).

### CRV-2 — new `lib/curve-key-clipboard.ts`
```ts
// Module store of copied curve keys (in-app; no host buffer exists for keys).
type CopiedKey = { time: number; value: number };
useCurveKeyClipboardStore: zustand<{ keys: CopiedKey[]; setKeys(k): void }>
export function setCurveKeysClipboard(keys: CopiedKey[]): void
export function getCurveKeysClipboard(): CopiedKey[]
export function useCurveKeyClipboardHasContent(): boolean   // for future menu gating
```
Then in `CurveEditorPanel.tsx`, a **window-scoped** keydown effect (sibling to the
Delete effect) handling Ctrl/Cmd + C / X / V:
- **Guards (bail early):** target inside a `TYPING_TAGS` element (existing pattern);
  **target inside the emitter tree** (`(e.target as HTMLElement).closest('[data-testid="emitter-tree"]')`)
  — the tree owns its own clipboard, so this prevents a double-fire when the tree
  is focused. This is the central collision mitigation.
- **Copy (`c`):** if `selectedKeyTimes.size === 0` bail; gather
  `focusedTrack.keys.filter(k => selectedKeyTimes.has(k.time))` → `setCurveKeysClipboard`.
  Copies ALL selected keys incl. borders (legacy copies the whole selection).
- **Cut (`x`):** Copy (above); if nothing copied, bail; then `handleDelete()`
  (border-filtered server-side, matching legacy WM_CLEAR).
- **Paste (`v`):** bail if clipboard empty, `selectedId === null`, or `focusLocked`;
  for each clipboard key fire `emitters/add-track-key {time, value}` on the focus
  track; collect the returned `{time}`; `setSelectedKeyTimes(new Set(returnedTimes))`
  (mirrors `handleCanvasAdd`'s auto-select-returned-time path, incl. its no-fround
  convention). Clears `optimisticSelected` first.

`useCallback` handlers `handleCopyKeys` / `handleCutKeys` / `handlePasteKeys`; the
effect depends on them + `selectedKeyTimes` (same shape as the Delete effect).

---

## 4. Risks named up front + mitigations

1. **Clipboard collision with the emitter tree (Ctrl+C/V double-fire).** The curve
   handler is window-scoped (must be — SVG clicks don't focus the panel) while the
   tree handler is focus-scoped but still bubbles to window. With a tree emitter AND
   curve keys both selected, one Ctrl+C could set both clipboards.
   **Mitigation:** the curve handler bails when `e.target.closest('[data-testid="emitter-tree"]')`
   is non-null — the tree, when focused, owns the gesture. Copy/Cut additionally
   require `selectedKeyTimes.size > 0`. Tested with a synthetic tree-origin target.
2. **Paste at a colliding time corrupts the multiset / breaks selection-by-time.**
   **Mitigation:** none needed — `add-track-key` already dedupes by epsilon and
   returns the real time; we select the returned times, never the requested ones.
   This is the same guarantee `handleCanvasAdd` relies on.
3. **Paste into a locked channel writes to a read-only alias.**
   **Mitigation:** Paste bails on `focusLocked` (same guard the Delete/Insert
   affordances already use).
4. **CRV-8 silently breaks a composition a11y golden.** The toolbar Time spinner's
   rendered text changes (`45` → `45.00`).
   **Mitigation:** expected + planned — re-baseline the composition lane only
   (`pnpm a11y:update`, L-052), legacy `.json` untouched. Diff the golden to confirm
   ONLY the Time-spinner value-format changed.
5. **float32 drift on pasted-key selection (L-057).** Native paste returns float32;
   selecting the requested double would miss the highlight.
   **Mitigation:** select the **returned** time from the bridge response (not the
   requested), exactly as `handleCanvasAdd` does. Hand final native paste-highlight
   verification to the user (preview stores exact doubles — L-057 caveat).

---

## 5. Testing & verification

**Web (vitest — `CurveEditorPanel.test.tsx`, mirrors the Delete-handler tests):**
- [ ] Ctrl+C with 2 keys selected → `curve-key-clipboard` holds those 2 `{time,value}`.
- [ ] Ctrl+V → fires `add-track-key` once per clipboard key on the focus track;
      selection becomes the returned times.
- [ ] Ctrl+X → copies then fires `delete-track-keys` (border filtered).
- [ ] Copy with empty selection → no clipboard write, no throw.
- [ ] Paste with empty clipboard / no emitter / locked focus → no `add-track-key`.
- [ ] Ctrl+C fired from inside an `<input>` (TYPING_TAGS) → no clipboard write.
- [ ] Ctrl+C fired from a target inside `[data-testid="emitter-tree"]` → no curve
      clipboard write (collision guard).
- [ ] Cross-track paste: copy on Red, switch focus to Green, paste → keys land on Green.
- [ ] **CRV-7:** right-click empty canvas in Select mode with a selection →
      `selectedKeyTimes` cleared; in Insert mode → mode flips to select, selection
      untouched. (Renderer-level: `onCanvasContextMenu` fires + `preventDefault`.)
- [ ] **CRV-8:** Time spinner renders `step="0.1"`; displayed value shows 2 dp.

**Composition a11y:** re-baseline curve-panel golden(s) touched by CRV-8; diff to
confirm only the Time-spinner format changed. (L-052: composition lane only.)

**Build/full suite:** `pnpm build` clean; `pnpm test` green (428 + new).

**Native (hand to user — L-057):** launch faithful `--new-ui`; select an emitter,
marquee a few curve keys, Ctrl+C, click empty, Ctrl+V → pasted keys appear + are
selected; Ctrl+X removes selected non-border keys; right-click empty in Select mode
clears the selection; Time spinner nudges in 0.1 steps.

---

## 6. Review

**Shipped — all three items, TDD (red→green per item):**
- **CRV-8** — Time spinner `step={1} decimals={0}` → `step={0.1}` + inherit 2dp
  default ([CurveEditorPanel.tsx:1234](web/apps/editor/src/components/CurveEditorPanel.tsx:1234)).
  2 new tests (2dp display + 0.1 ArrowUp nudge); updated the existing F8 line-877
  assertion (`"50"` → `"50.00"`).
- **CRV-7** — `onCanvasContextMenu` branches on `mode`
  ([CurveEditorPanel.tsx:1371](web/apps/editor/src/components/CurveEditorPanel.tsx:1371)):
  Insert → drop to Select; Select → clear selection. 2 new tests.
- **CRV-2** — new [lib/curve-key-clipboard.ts](web/apps/editor/src/lib/curve-key-clipboard.ts)
  (in-app zustand store, `{time,value}[]`) + window-scoped Ctrl/Cmd+C/X/V effect +
  `handleCopyKeys`/`handleCutKeys`/`handlePasteKeys`. 8 new tests (copy, paste,
  cut, empty-selection, empty-clipboard, TYPING_TAGS guard, tree-origin guard,
  cross-track paste).

**Verification (web lane — green):**
- vitest **440** (was 428; +12). `pnpm build` clean. `pnpm lint` (`tsc --noEmit`) exit 0.
- Composition a11y golden `curve-editor-focused.composition.golden.yaml:122` updated
  by hand (`"0"` → `"0.00"`) — the one deterministic line CRV-8 touches. Legacy `.json`
  provably unaffected (Edit nodes carry `children: []`; no spinner value captured).
  CRV-7/CRV-2 add no rendered DOM, so no other golden drifts.

**Could NOT verify here (handed to user — L-033/L-057):**
- Native a11y CDP harness + engine-pixel / drag-feel / keyboard-in-WebView checks.
  This is a FRESH worktree: no `packages/` (NuGet), no `x64/Debug/ParticleEditor.exe`
  — the handoff's "already built" was the prior worktree's (binaries aren't committed).
  Standing up the native toolchain for one deterministic golden line is
  disproportionate; native verification is the user's lane. → see new lesson L-058.

**User native checklist:** select an emitter → marquee/Ctrl-click several curve keys →
Ctrl+C, click empty, Ctrl+V (pasted keys appear + selected) → Ctrl+X (removes selected
non-border keys, keeps them on the clipboard) → right-click empty in Select mode (clears
selection) → right-click empty in Insert mode (drops to Select, keeps selection) → Time
spinner nudges by 0.1 and reads 2 dp. Cross-track: copy on one channel, focus another,
paste.
