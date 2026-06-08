# Plan: lt-4 → master integration, steps 2 + 3 (session 26)

*Scope confirmed by user 2026-06-08: do steps 2 (default-flip) and 3
(scaffolding docs + About attribution) on the session branch, FF-push to
`lt-4`, then **STOP before step 4** (`merge -s ours` + PR — needs explicit
OK). Full integration plan: `tasks/lt-4-master-integration-proposal.md`.*

## 1. Goal + scope

**Goal.** After this session, launching the x64 editor with **no flag** runs
the new WebView2/React UI; legacy chrome becomes opt-out via a net-new
`--legacy` flag. The public repo also gains standard scaffolding docs, and the
new-UI About dialog carries the same upstream attribution master's legacy About
already shows.

**In:**
- Step 2 — `src/main.cpp` default-flip: x64-gated `newUi` default-true, net-new
  `--legacy` opt-out, stale-comment + README updates.
- Step 3 — add-only `CONTRIBUTING.md`, `SECURITY.md`,
  `.github/ISSUE_TEMPLATE/bug_report.md`, `DEVELOPMENT_LOG.md`; port
  "Forked from Mike.NL's GlyphX Particle Editor v1.5" into `AboutDialog.tsx`
  (+ its test).
- CHANGELOG entry for the default-flip.

**Out (deferred, with reason):**
- Step 4 `merge -s ours` + PR into master — **separate gate, needs explicit
  user OK** (CLAUDE.md: never to master without it).
- `--legacy` smoke of F12/F16 — the user's lane (L-033, arch-A visuals the
  new-UI harness can't exercise); pending-user item, not blocking.
- Re-applying master's F1–F5 — already on lt-4 in parallel form; the supersede
  handles the rest. Do NOT double-apply.

## 2. What the codebase already gives us

- Arg-parse block at `src/main.cpp:8056-8116`: `bool newUi = false;` (8058),
  flag loop (8084-8112), `--new-ui → newUi = true` (8086). Adding `--legacy`
  is one line in the loop + one `if (legacy) newUi = false;` after it.
- Dispatch at `src/main.cpp:8197-8230`: `if (newUi) { #ifdef _WIN64 …host… #else
  return -1 #endif }`. The `#else` -1 is the x86 safety net — leave verbatim.
- Stale comments to fix: header `src/main.cpp:31-37` ("--new-ui flag
  dispatches…"), block comment `src/main.cpp:8050-8055` ("Without the flag,
  behaviour is unchanged").
- `AboutDialog.tsx` (`web/apps/editor/src/screens/`) — credits block at lines
  43-48; add the fork-attribution line. Test: `AboutDialog.test.tsx`.
- README.md is minimal (no flags section) and already credits Mike.NL; add a
  short Usage note documenting `--legacy`.
- Master's attribution literal (verified via `git show origin/master`):
  "Forked from Mike.NL's GlyphX Particle Editor v1.5"; fork version 0.2.0.

## 3. Implementation approach

**Step 2 — the x64 gate is at the declaration, not the dispatch.**
```cpp
#ifdef _WIN64
        bool newUi = true;   // new UI is the default on x64
#else
        bool newUi = false;  // x86 has no host; legacy only (see #else at dispatch)
#endif
        bool legacy = false;
```
In the flag loop add `if (argv[i] == L"--legacy") legacy = true;`. After the
loop (near the existing `--capture implies newUi` clamp at 8115) add
`if (legacy) newUi = false;`. `--new-ui` stays as a now-redundant no-op
(harness passes it; keep it harmless). Dispatch block unchanged.

**Step 3 — add-only docs + one TSX edit + test.** Docs are net-new files (lt-4
lacks them; zero conflict with the eventual supersede). AboutDialog gains a
`text-text-3` line under the credits paragraph; the test asserts the new text
renders.

## 4. Risks + mitigations

1. **x86 default regression (the sharp one).** A flat `newUi = true` makes every
   no-flag x86 launch hit the dispatch `#else` and `return -1`. *Mitigation:*
   gate the initializer with `#ifdef _WIN64`; verify the guards by inspection
   (the `.sln` is x64-only, so x86 is a preprocessor/compile reasoning check,
   not a full run).
2. **Harness regression from the no-op `--new-ui`.** The native harness passes
   `--new-ui --test-host`; post-flip `--new-ui` is a no-op and `--test-host`
   alone still enters the host on x64. *Mitigation:* re-run `test:native` →
   174/0 after the edit.
3. **AboutDialog test drift.** Adding text without updating the test fails
   `tsc`/vitest. *Mitigation:* update `AboutDialog.test.tsx` in the same edit;
   run vitest + `tsc -b`.
4. **Double-applying F1–F5 / F12–F16.** Already on lt-4. *Mitigation:* not in
   scope this session; the supersede (step 4) handles history.

## 5. Testing & verification

- [ ] **Build:** MSBuild Debug x64 clean.
- [ ] **x86 reasoning check:** confirm the `#else` legacy default + the dispatch
      `#else` guards are correct (x86 not in `.sln`).
- [ ] **Web:** vitest still green; `tsc -b` → 0.
- [ ] **Native harness:** `pnpm --filter @particle-editor/editor test:native`
      → 174/0 (re-run once on an L-066/L-071 phantom).
- [ ] **Arg-logic walk:** no flag → newUi (x64); `--legacy` → newUi false;
      `--new-ui --legacy` → legacy wins (order-independent, post-loop clamp);
      `--new-ui` alone → newUi (no-op).
- [ ] **Docs present:** the four scaffolding files exist; About renders the
      fork-attribution line.
- [ ] **CHANGELOG** entry added (default-flip), reverse-chron, date-line format.

## Progress

- ✅ Green pre-flight baseline confirmed before edits: git 0/0 clean, vitest
  510, `tsc -b` 0, native build clean, native harness **174/0**.
- ✅ Step 2 default-flip in `src/main.cpp`: x64-gated `newUi` default-true,
  `--legacy` + `--legacy-ui` alias opt-out, `if (legacy) newUi = false;` before
  the `--capture` clamp, stale comments + README updated.
- ✅ Step 3 scaffolding: `CONTRIBUTING.md` / `SECURITY.md` /
  `.github/ISSUE_TEMPLATE/bug_report.md` / `DEVELOPMENT_LOG.md` ported
  byte-identical from master (matching blob hashes); About attribution
  "Forked from Mike.NL's GlyphX Particle Editor v1.5" added to `AboutDialog.tsx`
  + test + regenerated a11y golden.
- ✅ CHANGELOG entry added (default-flip, provisional TODO hash/PR).

## Review

**Scope delivered (steps 2 + 3; stopped before step 4 merge as agreed).**

What changed: `src/main.cpp` (default-flip + dual legacy flag), `README.md`
(usage), `CHANGELOG.md` (entry), `AboutDialog.tsx` + test + golden (attribution),
4 add-only scaffolding docs.

**Two findings surfaced during the work (both real, both handled):**
1. *Native a11y golden drift.* Adding the About attribution line broke
   `dialog-about.composition.golden.yaml` — the native harness caught it (the
   vitest assertion alone wasn't enough; the visible-text change also moves the
   a11y tree). Regenerated surgically via `a11y:update --grep "dialog-about"`;
   `git diff` confirmed the only change is the added text node.
2. *`--legacy-ui` was never a parsed flag.* The codebase's comments/docs use
   `--legacy-ui` (mirror of `--new-ui`), but it only ever "worked" because
   legacy was the default — post-flip it would silently give the new UI. Per
   user decision, accepted **both** `--legacy` and `--legacy-ui` as aliases.

**Verification:** clean Debug x64 build (×2, incl. after the alias edit); vitest
**511/511** (+1 About test); `tsc -b` 0; native harness **174/0** (after golden
regen). Arg-logic walk: no-flag→newUi (x64) · `--legacy`/`--legacy-ui`→legacy ·
`--new-ui --legacy`→legacy (post-loop clamp) · `--capture --legacy`→host
(capture clamp wins) · x86→legacy by gate · fixture-gen paths return before
dispatch (unaffected).

**Not done (deferred, as agreed):** step 4 (`merge -s ours master` + PR +
CHANGELOG/ROADMAP backfill) — needs explicit user OK. Pending user smoke:
`--legacy` F12/F16 visual paths (L-033, the user's lane).

**Open question for step 4 / user:** master's ported `CONTRIBUTING.md` links to
`.github/PULL_REQUEST_TEMPLATE.md`, which exists on neither branch (a dangling
link inherited from upstream). Left verbatim for a faithful port; worth creating
the PR template (or fixing the link) before/at the public-facing merge.
