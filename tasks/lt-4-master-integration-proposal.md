# Plan: integrating `lt-4` → `master` (new-UI as default)

*Drafted 2026-06-08, revised same day after a 5-agent git-forensics pass ·
`master` = `ab120d0` · `lt-4` = `f6ba926` · Greenlit end-state: **new UI becomes
the default**, legacy → opt-out.*

> **STATUS (2026-06-08):** Step 1 of 4 — the **audit-P2 fixes (F12–F16)** — is
> **✅ shipped on `lt-4`** (`f6ba926`; verified clean `/WX` build + native 174/0
> + approved review). Remaining: **(2)** default-flip, **(3)** scaffolding docs +
> About attribution, **(4)** `merge -s ours` supersede + PR + CHANGELOG/ROADMAP
> backfill. See §6 for the per-step plan.

## TL;DR (revised — much more tractable than the raw numbers implied)

The scary-looking divergence (2017 merge-base, 239-vs-721 commits) is **~95% a
git history-rewrite artifact**, not real divergence. The branches share
byte-identical content up to a **2026-05-15** fork; the genuine delta is **35
master-only vs 517 lt-4-only commits**. **`lt-4` is a functional *superset* of
`master`** — every feature plus the whole new UI plus superset build infra. So
the integration is **not** a multi-day conflict slog: take `lt-4` as the trunk,
forward-port a **small, verified punch-list** (four audit-P2 C++ correctness
fixes + public-repo docs + optional About attribution), do the **default-flip**
(a localized `src/main.cpp` edit), and use a **`merge -s ours`** strategy that
**sidesteps all 25 spurious merge conflicts**.

## 1. The divergence is mostly a rewrite artifact (forensics, high confidence)

- A **git-filter-repo email redaction** (personal email → GitHub-noreply) was
  applied to `master` **after** `lt-4` forked (fork ≈ 2026-05-15; rewrite
  ≈ 2026-05-16). It changed metadata + every hash, **zero file content**. (The
  commits `7141efc`/`7b403e4` just *repaired* hash links afterward — they aren't
  the rewrite.)
- Proof: the fork-point twins `master:711fd5e` and `lt-4:ba19b1a` have the
  **identical whole-repo tree `50b18f9`**; `git diff` between them is empty.
- The 2017 merge-base (`be73117`) is therefore a **mirage** — Git can't match
  `master`'s renumbered copies of the shared 2017→2026 history to `lt-4`'s
  originals, so it falls back to the last hash both still share (2017).
- Real divergence: **35 master-only** new commits (`711fd5e..master`) vs **517
  lt-4-only** (`ba19b1a..lt-4`). The 204 "shared base" commits on each side are
  the same content under different hashes.

**Implication:** never drive the merge from the 2017 merge-base — it forces a
wasteful 3-way against ancient code and manufactures conflicts. Anchor at the
2026-05-15 fork, or better, supersede (see §5).

## 2. `lt-4` is a superset — the must-port list is tiny (verified)

Every marquee feature on `master` (skydome, bloom, spawner, undo/redo, autosave,
link groups, multi-select, palette, selectable ground, env lighting, **LT-3
import-emitters**) is **already on `lt-4`**, re-integrated behind the new UI.
LT-3 import is literally the *same commit* (`master:7647f1b` ≡ `lt-4:7fc3277`,
identical `patch-id`) plus lt-4 went further (shared `ImportEmittersFrom` +
bridge handler + React dialog). Build infra/CI on `lt-4` is a strict superset.

**Genuinely master-only work that must be carried (the whole punch-list):**

1. **Four audit-P2 C++ correctness fixes — live bugs on `lt-4` today** (I
   independently verified each against `lt-4` source; lt-4's own
   `tasks/post-audit-followups.md:62-65` confirms they're open):
   - **F12** — `RenderWindowProc` `WM_PAINT` lacks `BeginPaint`/`EndPaint`
     (paint-storm); `lt-4 main.cpp:~2895` still `Render(info); break;`. Affects
     the shared 3D viewport the new UI also drives.
   - **F13/F14** — `IFile*` leak + `delete file;` on a refcounted `IFile*`
     (abstraction violation) + ignored partial reads; no `ReadAndRelease`
     helper on `lt-4` (`TexturePalette.cpp:~251`, texture/shader managers).
   - **F15** — `Emitter` copy-ctor doesn't `m_instances.clear()`, so a clone
     aliases the source's live particle instances (dangling-pointer latent
     bug). Confirmed **absent** on `lt-4`.
   - **F16** — blend-mode `case 6` falls through into `case 7` (missing
     `break;`) → wrong rendering. Confirmed **absent** on `lt-4`
     (`EmitterInstance.cpp:728→733`, no `break`).
2. **Public-repo scaffolding docs** (add-only, no conflict — `lt-4` lacks them):
   `CONTRIBUTING.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/bug_report.md`,
   `DEVELOPMENT_LOG.md`.
3. **About attribution (optional)** — `master`'s About gained "Forked from
   Mike.NL's GlyphX Particle Editor" + fork-version. The new default UI is the
   React `AboutDialog.tsx`, which has *no* upstream attribution. Port the text
   there if attribution parity matters (the legacy `.rc` change only shows under
   opt-out legacy mode).

**Already on `lt-4` — do NOT double-apply** (would conflict/regress): audit P1
**F1–F5** (parallel commits `24edaa2`/`9a3e368`/`4f43525`/`ede76ce`; e.g. F4 =
`ValidateEmitterGraph`, F5 = `kMaxParticleIndex` cap — verified present),
Ground-Z session-reset, LT-3 import, all features, all infra. *(Slice B of the
forensics wrongly flagged F4/F5 as missing via a case-sensitive grep; direct
inspection confirms they're present — F1–F5 need no action.)*

## 3. The conflict surface (if you merged naively) — and why we won't

`git merge-tree --write-tree master lt-4` (read-only preview) reports **25
conflicted files** (13 content, 12 add/add) — but this *overstates* the work:
the 12 add/add conflicts (`UndoStack`, `TexturePalette`, `CHANGELOG`, `CLAUDE`,
`ROADMAP`, `tasks/*`) are pure 2017-merge-base/rewrite artifacts (no common
ancestor), and the genuine C++ divergence between the tips is only **~2,609
lines, almost all additive arch-C host hooks** where the answer is "keep
`lt-4`". Only `src/main.cpp` (≈34 small hunks + one diff-alignment mega-block
that is *two non-overlapping additions*, not a real clash) needs eyeballing.
**We avoid all of this with the supersede strategy in §5.**

## 4. The default-flip — localized, one real constraint (forensics §E)

Today the default with no flag is **legacy**; `--new-ui` opts in
(`src/main.cpp` arg block ~8021-8077). To flip:

1. **Default `newUi` true — but x64-gated.** A flat `bool newUi = true;` would
   **break x86**: the x86 `#else` branch (~8189) hard-`return -1`s with
   *"--new-ui is only available in the x64 build"* instead of falling back. So
   default-true must be `#ifdef _WIN64`; **x86 always defaults to legacy** (the
   host project isn't even built for x86 in the `.sln`). **This is the one true
   correctness constraint.**
2. **Add a net-new `--legacy` opt-out flag** (none exists today) + after the arg
   loop, `if (legacy) newUi = false;`.
3. **Keep the x64 guards at ~8164/8189 verbatim** — they're what guarantee x86
   stays legacy.
4. Update stale comments (`main.cpp:8015-8020`), `README` (add `--legacy` note),
   and a CHANGELOG entry.

**Harness is unaffected:** `run-native-tests.mjs` passes `--new-ui --test-host`;
post-flip `--new-ui` is a harmless no-op and `--test-host` alone enters the host
on x64. No persisted UI-mode preference exists to update.

## 5. Recommended git strategy — supersede, don't merge-into-master

Because `lt-4` is a content superset and the 2017 base manufactures conflicts,
**do not** `git merge lt-4` into `master`. Instead:

1. **Do the substantive work on `lt-4` first** (it's already the new-UI trunk):
   port the four F12–F16 fixes (with regression tests), do the default-flip, add
   the scaffolding docs + About attribution. Each is a normal lt-4 commit,
   verified by the existing native + web lanes.
2. **Record the supersede:** on `lt-4`, `git merge -s ours master` — this makes a
   merge commit whose **tree is `lt-4`'s** but with `master` as a second parent,
   so `master`'s history is preserved as an ancestor and **zero conflicts**
   surface. (master's 35 unique commits stay in history; their *content* that
   matters has been forward-ported in step 1; the rest is rewrite-dupes/docs that
   lt-4 supersedes.)
3. **Update `master` via PR**, not a direct push, so `build.yml` (x86 **and**
   x64) runs before it lands. Backfill the provisional CHANGELOG/ROADMAP hashes
   and move the lt-4-only ROADMAP §5 entries to their master slots.

## 6. The actual work (scoped — this is the real size)

| Step | Effort | Verify |
|---|---|---|
| Port F12/F13-F14/F15/F16 to `lt-4` (4 C++ correctness fixes + tests) | ~0.5–1 day | native harness, targeted repro tests, legacy + new-UI smoke |
| Default-flip in `src/main.cpp` (x64-gated default + `--legacy`) | ~1–2 hrs | x64 launch → new UI; `--legacy` → legacy; **x86 build → legacy, no `-1`** |
| Scaffolding docs + About attribution | ~1 hr | files present; About shows attribution |
| `merge -s ours` supersede + PR + CHANGELOG/ROADMAP backfill | ~0.5 day | `build.yml` x86+x64 green; PR review |

**Total ≈ 1.5–2 focused days**, dominated by the four C++ fixes (each is a known
bug with a known fix on `master` to mirror) — not the conflict reconciliation the
raw numbers implied.

## 7. Risks

1. **x86 default regression (the sharp one).** Get the x64-gate wrong and every
   no-flag x86 launch errors `-1`. Mitigation: x64-gated default + an explicit
   x86 build/launch test in the verify step.
2. **Legacy regression for your daily-driver.** You still run legacy day-to-day.
   Mitigation: the supersede keeps `lt-4`'s legacy path intact; verify `--legacy`
   launches and round-trips a real `.alo` before the PR lands. (Your lane, L-033.)
3. **Double-applying F1–F5.** They're already on `lt-4` in parallel form; the
   supersede prevents re-applying master's versions. Don't hand-port them.
4. **`build.yml` x86 leg post-merge.** It builds x86; the host is x64-only in the
   `.sln`, so x86 builds legacy only — expected green, but the PR is the gate
   that proves it.
5. **History/attribution.** The `merge -s ours` preserves `master`'s history;
   confirm the public repo's commit-link conventions still resolve post-merge.

## 8. Recommendation

Proceed in this order on `lt-4`: (1) the four audit-P2 fixes — they're real live
bugs the new default would otherwise ship, and they're the bulk of the value;
(2) the default-flip; (3) scaffolding + attribution; (4) the `merge -s ours`
supersede via PR. This is a ~2-day effort, not the multi-day reconciliation the
divergence numbers suggested. The four C++ fixes are independently worth doing
*regardless* of the merge (they're live bugs), so they're a safe first move even
if the merge timing slips.
