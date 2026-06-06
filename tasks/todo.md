# VPT-6/7/8 — Status-bar parity grab-bag

## Goal + scope
Restore the three legacy status-bar elements the new UI dropped, so the new
dark status bar reaches parity with legacy's 5-pane bar.

**In:**
- **VPT-6** — persistent "⇧ Shift: spawn instance" hint, far-right, always on
  (shortened from legacy "Press SHIFT to spawn an instance", main.cpp:2036).
- **VPT-7** — "PAUSED" indicator shown only while the preview is paused.
- **VPT-8** — cursor readout `toFixed(1)` → `toFixed(2)` (legacy was 2dp).

**Out:**
- Pane order / "Cursor" rename / ~30Hz throttle (VPT-5 — intentional keep).
- Contextual hint logic (user chose always-on).
- Any host/bridge change (all three are web-only render changes).

## What the codebase already gives us
- `StatusBar.tsx` — 5 cells (FPS·Emitters·Particles·Instances·Cursor),
  subscribes to `stats/tick`, `cursor/position-3d`, `stats/frozen-changed`.
- `Toolbar.tsx:37-48` — the pause signal: `engine/state/snapshot` +
  `engine/state/changed` → `EngineStateDto.paused`. Reuse verbatim in StatusBar.
- `EngineStateDto.paused` in bridge-schema (`// IsPreviewPaused()`).

## Implementation
1. StatusBar subscribes to `engine/state/changed` (+ initial snapshot) for `paused`.
2. Render a "PAUSED" cell ONLY when `paused` (amber, near the right).
3. Append an always-on far-right hint cell "⇧ Shift: spawn instance"
   (`ml-auto` to push it to the right edge).
4. Cursor `toFixed(2)`.

## Risks
1. **a11y golden cascade.** VPT-6 adds a permanent node → re-baseline needed
   (native build). Mitigation: native lane restored this session; `a11y:update`
   + `git diff` review (L-053) to confirm ONLY the hint cell changes. Cursor
   stays `—` placeholder in capture → VPT-8 should NOT move goldens; PAUSED only
   when paused → fixtures aren't paused → no PAUSED node expected.
2. **PAUSED leaking into goldens.** Verify via diff; expect zero PAUSED nodes.

## Testing & verification
- [ ] Unit: hint cell always rendered; PAUSED hidden when playing, shown when
      paused (drive `engine/state/changed`); cursor renders 2dp.
- [ ] `tsc --noEmit` 0; full vitest green.
- [ ] Browser preview: hint visible; drive paused → PAUSED appears.
- [ ] `pnpm a11y:update` → `git diff` surgical (hint cell only) → review.
- [ ] Native harness `pnpm test:native` (re-run on catastrophic, L-066).

## Review
Shipped all three (web-only render changes in `StatusBar.tsx`):
- **VPT-6** — always-on "⇧ Shift: spawn instance" hint, pinned right via `ml-auto`.
- **VPT-7** — amber "PAUSED" shown only while paused, off the same
  `engine/state` signal the Toolbar uses (no new bridge command).
- **VPT-8** — cursor readout `toFixed(2)`.

**Verification.** vitest 500/0 (+3 new StatusBar tests, TDD red→green); `tsc` 0;
browser-live-verified (hint always on; PAUSED toggles via the toolbar Play/Pause;
no console errors; screenshot captured). Native harness 168/0; a11y re-baseline
touched 19 composition goldens — one identical `contentinfo` text delta each
(`… Cursor — PAUSED ⇧ Shift: spawn instance`); the capture spec pauses for
determinism so PAUSED is correctly present (free VPT-7 golden coverage).

**Gotcha (→ L-068).** `a11y:update --rebuild` rebuilds dist only on a hosting-MODE
mismatch, not on source change — the first run served a stale dist and falsely
passed with zero golden diff. Fixed by `pnpm build` before the harness.
