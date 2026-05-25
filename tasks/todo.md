# Post-[MT-11] Phase 3 dispatch — lessons retro-doc (L-019/L-020/L-021/L-022) + HANDOFF correction

> **Active plan.** Post-[MT-11] Phase 3 close-out hygiene work. Phase 3
> shipped on `origin/lt-4` at `65da3d4` (all 5 stages). The Phase 3
> plan that previously lived in `tasks/todo.md` is archived at
> [`todo-mt-11-phase-3-archive.md`](todo-mt-11-phase-3-archive.md).

**Difficulty:** ★★ (2/5) — docs-only, low-risk, four new lessons.md
entries plus a HANDOFF correction note retracting one stale claim. No
code changes. No test changes.

**Effort estimate:** ~3 hours (drafting + format + verification + FF).

**Owner:** this session (`claude/festive-hoover-6abdbf`).

**Target:** fast-forward into `lt-4` and push to `origin/lt-4` at end.

**Status:** plan drafted 2026-05-25 after pre-flight surfaced Option C
(`ResetParameters` projection-push fix) as a non-bug. Option C
replaced with new lesson L-022. **Awaiting user OK before any
`lessons.md` / HANDOFF / CHANGELOG edits.**

---

## 1. Goal + scope

**Goal.** Formalize three lesson patterns that Stage 4 and Stage 5 surfaced
but never landed as `tasks/lessons.md` entries (L-019 DXSDK linker-twin,
L-020 spike-vs-production const audit, L-021 verify rendered geometry —
combined-math edition), plus a fourth (L-022) discovered during this
session's pre-flight: handoff claims about latent bugs require fresh
first-party code verification before they enter a dispatch's plan.

The four lessons close out Phase 3 documentation hygiene. Future sessions
inheriting Phase 3 territory get fully-formed rules in lessons.md instead
of having to re-derive them from CHANGELOG paragraphs and HANDOFF prose.

**In:**

- New `tasks/lessons.md` entry **L-019** — DXSDK linker-twin
  (`CreateDXGIFactory2` `LNK2019` → `CreateDXGIFactory1` + QI to
  `IDXGIFactory2`). Linker-side parallel to L-016's header-side
  pattern. Source incident: Stage 4b first-build `LNK2019 unresolved
  external CreateDXGIFactory2`.
- New `tasks/lessons.md` entry **L-020** — When porting a spike to
  production, audit every const/enum the spike picked against the
  production workload's actual data flow. Source incident: Stage 4d.1
  `DXGI_ALPHA_MODE` PREMULTIPLIED → IGNORE pivot.
- New `tasks/lessons.md` entry **L-021** — Verify rendered geometry,
  combined-math edition. Sub-plans describing independent components
  correctly can still produce broken combined math if the combined math
  isn't walked pixel-by-pixel. Source incident: Stage 5 T6 Iter 1
  scene-rect displacement bug.
- New `tasks/lessons.md` entry **L-022** — Handoff-claim verification
  against current code. When a HANDOFF or next-session-prompt describes a
  "latent bug" or carries a TODO from a prior session, verify the claim
  against current code BEFORE planning a fix. Prior-session reasoning
  may have been correct when written and stale now, or wrong from the
  start (reasoning by analogy without re-reading the cited site).
  Source incident: this session's pre-flight, where the prompt's claim
  of a latent `ResetParameters` projection-not-pushed bug dissolved on
  reading [`src/engine.cpp:1734`](../src/engine.cpp:1734) (`ResetParameters`
  ends with `SetCamera(m_eye)` which pushes the projection — has done
  since Initial import `0d352ae`).
- **HANDOFF.md correction** retracting the spurious "latent
  `ResetParameters` projection-push bug" claim (currently in "Known
  follow-ups (out of scope for Stage 5)" item 2). Remove the item;
  renumber 3/4/5 → 2/3/4; add a short Retractions sub-section citing
  L-022 + the verification finding.
- **CHANGELOG entry** per CLAUDE.md "Roadmap items: update `ROADMAP.md`
  and `CHANGELOG.md` when a feature ships." Lessons-retro-doc and a
  HANDOFF correction are NOT a feature ship — but CLAUDE.md's CHANGELOG
  guidance applies to "anything non-cosmetic worth remembering."
  Single short entry; not a full feature-style entry. The L-022
  incident in particular is worth a paragraph in changelog so a future
  contributor doesn't re-derive the same "the prompt was wrong"
  finding.
- **End-of-session FF flow** per CLAUDE.md branch workflow: `git switch
  lt-4` → `git merge --ff-only claude/festive-hoover-6abdbf` →
  `git push`. Lineage already confirmed clean at session start.

**Out:**

- Option C (`ResetParameters` projection-push fix) — dissolved during
  pre-flight as a non-bug. No code edit to make. The L-022 lesson is
  the replacement deliverable.
- Option A (Phase 3 close-out a11y suite + final acceptance smoke) —
  awaiting user gate on whether still wanted. Surfaced to user at
  session start; not started this dispatch.
- Option D (next roadmap item / post-audit P1 drainage) — separate
  dispatch. Roadmap doc explicitly redirects to
  [`post-audit-followups.md`](post-audit-followups.md) for P1s before
  fresh roadmap work, which is its own non-trivial planning exercise.
- L-022's broader scope (e.g. "every doc file should be verified") —
  the rule is scoped to handoff claims about latent bugs and similar
  carry-forward TODOs. Broader doc-rot is not in scope.

## 2. What the codebase already gives us

- [`tasks/lessons.md`](lessons.md) — 18 existing entries with stable
  format. The **Rule / Trigger / How to apply / Source incident /
  Cross-reference** shape is set by L-001 through L-018. L-016 (Stage 3a
  DXSDK header shadowing) is the natural sibling for L-019 (the
  linker-side twin) — cross-reference the two.
- [`CHANGELOG.md`](../CHANGELOG.md) Stage 4 entry — "Issues encountered
  and resolutions" section already has the long-form context for L-019
  (`LNK2019` → `CreateDXGIFactory1` + QI) and L-020 (PREMULTIPLIED →
  IGNORE alpha pivot). The retro-doc work is **distillation** of that
  prose into the Rule / Trigger / How to apply form, not investigation.
- `CHANGELOG.md` Stage 5 entry — "Issues encountered and resolutions"
  has the four T6 iteration bugs documented in detail; Iter 1
  (displacement) is the source for L-021.
- [`tasks/stage-5-smoke-result.md`](stage-5-smoke-result.md) — the
  iter-by-iter bug log referenced by the Stage 5 CHANGELOG. Worth
  pulling specific phrasing for the L-021 source-incident paragraph.
- [`tasks/HANDOFF.md`](HANDOFF.md) "Known follow-ups (out of scope for
  Stage 5)" item 2 — the claim we need to retract.
- [`src/engine.cpp:1654`](../src/engine.cpp:1654) (`ResetParameters`) —
  the file:line citation for the L-022 source incident.
- [`src/engine.cpp:998`](../src/engine.cpp:998) (`SetCamera`) — the
  file:line citation showing the projection push that the "latent bug"
  claim missed.
- `git log -S "SetCamera(m_eye)"` outputs `0d352ae Initial import` —
  the evidence that this is not a recent regression.

## 3. Architecture / implementation approach

Four lesson entries + one HANDOFF correction + one short CHANGELOG
entry. Each lesson uses the baseline shape from L-001/L-017/L-018:
**Rule / Trigger / How to apply / Source incident (date, context) /
Cross-reference**. L-016's more elaborated shape (Two-part fix, Also
requires) is the exception, not the rule — only adopted if a lesson
genuinely needs the elaboration.

**Drafting order** (each independent — sequential keeps the lessons.md
diff coherent and lets the L-022 incident verification anchor the rest):

1. **L-019 — DXSDK linker-twin.** Title: *"Legacy DXSDK June 2010 also
   shadows Win10 SDK link libraries — `LNK2019 CreateDXGIFactory2`-class
   failures resolve via `CreateDXGIFactory1` + QI, not linker-path
   surgery."* Key points:
   - Rule: DXSDK first in `<AdditionalLibraryDirectories>` ships a
     pre-Win8 `dxgi.lib` missing `CreateDXGIFactory2` and similar
     Win8+ entrypoints. No per-file `<AdditionalLibraryDirectories>`
     exists in MSBuild (link is per-project), so L-016's header-side
     isolation doesn't extend to the linker.
   - How to apply: use `CreateDXGIFactory1` (DXSDK-compatible since
     Win7) and QI for `IDXGIFactory2` / `IDXGIFactory4` etc. as
     needed. Modern-DXGI capability detection becomes a single QI
     chokepoint per `IDXGIFactory*` consumer.
   - Source: distilled from CHANGELOG Stage 4 "Issues encountered"
     §Iter 1.
   - Cross-ref: L-016 (header-side twin) + Compositor.cpp's
     factory-creation code + Stage 4 sub-plan.

2. **L-020 — Spike-vs-production const/enum audit.** Title: *"When
   porting a spike to production, audit every const/enum the spike
   picked against the production workload's actual data flow — spike
   correctness is not transitive."* Key points:
   - Rule: Spikes validate transport/topology under a synthetic
     workload (typically `D3DClear` to solid color, no shaders, no
     blending). Constants the spike picked are correct for that
     workload, not automatically correct for production.
   - How to apply: for each const, ask "What invariant in the spike's
     workload justified this value? Does production hold the same
     invariant?" Cheap audit pass beats user-surfaced visual
     regressions.
   - Source: Stage 4d.1 PREMULTIPLIED → IGNORE alpha pivot.
   - Cross-ref: Compositor.cpp swapchain-desc + Stage 4 sub-plan §3.5.

3. **L-021 — Verify rendered geometry, combined-math edition.** Title:
   *"CLAUDE.md's 'verify rendered geometry, not design intent' rule
   applies to *combined* math across components, not just per-component
   math — walk the pixel path end-to-end before declaring a
   multi-component layout correct."* Key points:
   - Rule: Sub-plans describing Component A and Component B correctly
     individually can still produce broken geometry when the two
     compose, if no one walks the pixel path end-to-end. Per-component
     review catches local errors; combined-math walk catches composition
     errors.
   - How to apply: at sub-plan time, pick a concrete pixel and walk
     it through every component. State the assumed coord space at each
     stage. A 30-second walk-through with sample pixel `(100, 100)`
     and scene-rect `(50, 30, 800, 600)` would have caught Stage 5
     Iter 1.
   - Source: Stage 5 T6 Iter 1 displacement bug — Compositor's local-
     coords-post-offset design and Engine's render-at-scene-rect
     design each correct, combined produced double-offset.
   - Cross-ref: CLAUDE.md "Verify rendered geometry, not design intent"
     + Stage 5 sub-plan + Compositor::SetEngineVisualTransform.

4. **L-022 — Handoff-claim verification against current code.** Title:
   *"Handoff notes and next-session prompts carry claims, not facts —
   verify against current code before any claim enters a dispatch's
   plan."* Key points:
   - Rule: Carry-forward TODO claims in HANDOFF.md or next-session-
     prompts ("latent bug at X", "deferred fix for Y", "should follow
     up on Z") are claims to verify. Prior-session reasoning may have
     been correct when written and stale now (sibling session closed
     the gap), wrong from the start (reasoning by analogy without
     re-reading the cited site), or correct but mis-located (line
     numbers shifted).
   - How to apply: for each carry-forward claim entering the active
     plan — read the cited code at the cited line (find by name if
     lines shifted); trace the data flow; if real, plan the fix; if
     not, retract the claim in HANDOFF.md (don't silently drop it —
     future sessions inheriting the same docs need the retraction).
   - Source: this session, post-[MT-11] Phase 3 dispatch.
     Next-session-prompt and HANDOFF.md described "latent projection-
     not-pushed bug in `ResetParameters`" at `engine.cpp:1518`.
     Pre-flight verification: `ResetParameters` now at
     `engine.cpp:1654` (lines shifted ~136 by Stage 5 additions);
     ends with `SetCamera(m_eye)` at line 1734; `SetCamera` at line
     1014 unconditionally pushes `SetTransform(D3DTS_PROJECTION,
     &m_projection)` and recomputes `m_viewProjection`. `git log -S
     "SetCamera(m_eye)" -- src/engine.cpp` reports the call dates
     to `0d352ae` (Initial import). The "latent bug" was a phantom:
     prior-session author reasoned by analogy from the genuine Stage
     5 `SetSceneViewport` bug without re-reading `ResetParameters`.
     Discovery cost: ~15 min. Hypothetical un-verified cost: a
     duplicate `SetTransform(PROJECTION)` would have shipped right
     before the existing `SetCamera` push — likely harmless,
     possibly a redundant device-state push per resize, contributing
     noise to future readers.
   - Cross-ref: L-018 (AI-audit verification) is the external-source
     parallel; L-022 is the internal-handoff parallel. CLAUDE.md
     "Trust but verify — universally" is the parent principle.

5. **HANDOFF.md correction.** Remove item 2 ("latent
   `ResetParameters` projection-push bug") from "Known follow-ups
   (out of scope for Stage 5)". Renumber 3/4/5 → 2/3/4. Add a new
   "Retractions" sub-section (placed after "Known follow-ups", before
   "Stage 5 commits") with one paragraph citing L-022 + the
   verification finding. Don't strikethrough or comment-out the
   removed item — it's removed cleanly, with the structural lesson
   captured in lessons.md.

6. **CHANGELOG.md entry.** One short entry under the existing date
   2026-05-25, inserted at the top of `## Changelog` (above Stage 5).
   Section title plain prose: *"Lessons retro-doc for [MT-11] Phase 3
   — L-019/L-020/L-021/L-022 formalized; HANDOFF latent-bug claim
   retracted."* Date line with TODO-HASH/TODO-PR placeholders matching
   Stage 5's still-pending hash. Two short paragraphs:
   - **What ships.** Four new lessons.md entries + HANDOFF retraction
     of the spurious `ResetParameters` latent-bug claim.
   - **How we tackled it.** Three of the four lessons were
     distillation from CHANGELOG Stage 4 / Stage 5 prose. The fourth
     (L-022) emerged during pre-flight verification of a carry-forward
     claim that turned out not to hold against current code.
   - Skip "Issues encountered" — docs distillation has no notable
     issues.

7. **End-of-session FF.** Lineage re-check before merge:
   `git fetch origin lt-4 --quiet` → `git log --oneline
   origin/lt-4..HEAD` (should show ~1-2 docs commits from this
   session) → `git log --oneline HEAD..origin/lt-4` (should be 0).
   Then: `git switch lt-4` → `git merge --ff-only
   claude/festive-hoover-6abdbf` → `git push`. If FF fails, STOP per
   CLAUDE.md.

## 4. Risks named up front + mitigations

1. **Risk — L-019/L-020/L-021 source-incident paragraphs misquote
   CHANGELOG prose, drifting from the actual incident.**
   *Mitigation:* before writing each Source incident section, re-read
   the corresponding CHANGELOG paragraph in full. Cite the same dates
   and same line-by-line claims. Don't summarize — quote the
   structural facts (file:line citations, error messages, fix sites)
   verbatim where they appear in CHANGELOG.

2. **Risk — L-022 framed as blame-the-prior-session note instead of a
   structural rule.** The prior session's author wasn't careless; the
   failure mode (reasoning by analogy from a genuine bug to a
   parallel that doesn't hold) is one this collaboration's process
   has hit before (L-018 is the external-input parallel).
   *Mitigation:* write L-022 framed as a process rule, not as
   criticism. The Source incident describes what happened structurally
   (line numbers shifted, analogy not re-verified) without naming the
   session branch or making it about the person. The rule reads as
   "claims-in-docs need verification" the same way L-018 reads as
   "claims-from-AI need verification" — same shape, different source.

3. **Risk — HANDOFF correction goes stale itself when the next
   dispatch reads it.** If we leave a long retraction paragraph
   inline in "Known follow-ups", a future reader has to parse the
   retraction to know item 2 is not actionable. *Mitigation:* remove
   the spurious item entirely from "Known follow-ups", renumber the
   rest, and add a short "Retractions" sub-section citing L-022 as the
   structural lesson. More honest than a strikethrough AND avoids
   future cargo-culting of the false claim.

4. **Risk — CHANGELOG entry's date placement is wrong.** CHANGELOG
   convention is "reverse chronological order, newest at top of
   `## Changelog`." Current top is Stage 5 (`2026-05-25`). This
   entry's date is also 2026-05-25 — "most recently merged sits above
   older ones from the same day." This entry merges AFTER Stage 5, so
   sits ABOVE Stage 5. *Mitigation:* insert directly under the
   `## Changelog` heading, above Stage 5's section. Verify placement
   before committing.

5. **Risk — Cross-references to commits use placeholders we never
   backfill.** Stage 4 and Stage 5 CHANGELOG entries both have
   `TODO-HASH` placeholders. *Mitigation:* match the existing pattern
   — use `TODO-HASH`/`TODO-PR` placeholders. The backfill happens at
   merge-to-master (none of these LT-4 entries have backfilled hashes
   yet); not in scope here.

6. **Risk — Format drift across the four lesson entries.** L-016 is
   slightly more elaborated than L-017/L-018. *Mitigation:* use the
   baseline 5-section shape for L-019/L-020/L-021/L-022. No
   elaborated sub-headings unless a lesson genuinely needs them
   (e.g. L-019's linker-side detail might benefit from a short "Why
   no per-file fix" subsection — judgment call at draft time, biased
   toward simpler).

7. **Risk — Risk of finding another non-bug in the carry-forward TODO
   list mid-dispatch.** L-022's discovery raises the possibility that
   other claims in HANDOFF's "Known follow-ups" are also stale or
   wrong. *Mitigation:* explicitly NOT in scope here. The five other
   items (canvas-architecture fixme, Stage 4e ClearRTV guard, test
   harness env-var check, lessons-retro-doc itself) are not being
   verified in this dispatch. If a future dispatch picks any of them
   up, L-022's rule kicks in then. Flagged in the dispatch summary
   as "audit candidate for a future dispatch."

## 5. Testing & verification

Docs-only dispatch; verification is format + factual + post-edit
pre-flight.

**Format checks (per lesson entry):**

- [ ] L-NNN heading uses `## L-NNN — Title sentence` format
- [ ] All four sections present in order: Rule / Trigger / How to apply
      / Source incident (date, context) / Cross-reference
- [ ] Bold section labels (`**Rule.**`, `**Trigger.**`, etc.) end with a
      period
- [ ] Each entry followed by `---` separator before the next
- [ ] Inline file:line links use markdown form
      `[file](src/path:NNNN)` so readers can jump

**Factual checks (per lesson entry):**

- [ ] L-019 source-incident matches CHANGELOG Stage 4 "Issues
      encountered" §Iter 1 verbatim on file names, line numbers,
      error messages
- [ ] L-020 source-incident matches CHANGELOG Stage 4 "Issues
      encountered" §4d.1
- [ ] L-021 source-incident matches CHANGELOG Stage 5 "Issues
      encountered" §Iter 1 + the displacement-bug pixel math
- [ ] L-022 source-incident matches the actual pre-flight finding
      (line numbers, `git log` commit hash `0d352ae`, function names)
      — re-read [`src/engine.cpp:1654`](../src/engine.cpp:1654) and
      [`src/engine.cpp:998`](../src/engine.cpp:998) once before
      finalizing the paragraph
- [ ] Each Cross-reference link resolves (file path exists, line
      number is plausibly stable)

**HANDOFF correction:**

- [ ] Item 2 ("latent `ResetParameters` projection-not-pushed bug")
      removed from "Known follow-ups (out of scope for Stage 5)"
- [ ] Items 3/4/5 renumbered to 2/3/4 in the same section
- [ ] New "Retractions" sub-section added with one paragraph citing
      L-022 + the verification finding
- [ ] No other HANDOFF content changed (cumulative)

**CHANGELOG entry:**

- [ ] Inserted at top of `## Changelog`, above the Stage 5 entry
- [ ] Date line matches established format with TODO-HASH/TODO-PR
- [ ] Two paragraphs ("What ships" + "How we tackled it" — labels
      bolded with period); no "Issues encountered"
- [ ] Ends with `---` separator before Stage 5's entry

**Pre-handoff smoke (CLAUDE.md "Pre-handoff testing — exhaustive"):**

- [ ] `git status` clean working tree before each commit
- [ ] `git diff --stat` matches what the dispatch claims to touch
      (only `tasks/lessons.md`, `tasks/HANDOFF.md`, `CHANGELOG.md`,
      `tasks/todo.md`, plus the rename
      `tasks/todo.md → tasks/todo-mt-11-phase-3-archive.md`)
- [ ] `pnpm -w test` (vitest) — **338 / 338** unchanged (sanity, no
      React/web touched)
- [ ] `pnpm -w typecheck` (`tsc -b`) — 0 errors (sanity)
- [ ] MSBuild Debug + Release x64 clean — no C++ changes (sanity)
- [ ] Lineage re-check before FF: `git log origin/lt-4..HEAD` shows
      only this session's docs commits; `git log HEAD..origin/lt-4`
      empty

**Manual review pass (post-edit, pre-commit):**

- [ ] Open the new `tasks/lessons.md` in raw form and verify the
      four new entries render without GFM formatting issues (no
      broken tables, no truncated code blocks)
- [ ] Re-read the L-022 source-incident paragraph specifically —
      this one is auto-meta-referential (a lesson about
      verification written from a verification finding) and the
      language risks sounding self-congratulatory. Should read as
      "structural finding worth a process rule," not "I caught
      a thing."
- [ ] Sanity-check the CHANGELOG entry is parseable by the existing
      tooling (matches the date-line regex `\*YYYY-MM-DD · ...\*`)

**Commit boundary.**

Two commits total:

1. **Archive of prior todo.md.** Pure rename
   (`tasks/todo.md` → `tasks/todo-mt-11-phase-3-archive.md`) + this
   new file. Subject: `docs(LT-4): archive Phase 3 todo + draft post-
   Phase 3 dispatch plan`.

2. **Lessons + retraction.** `tasks/lessons.md` additions +
   `tasks/HANDOFF.md` correction + `CHANGELOG.md` entry +
   `tasks/todo.md` review section. Subject: `docs(LT-4): [MT-11]
   Phase 3 lessons retro-doc — L-019/L-020/L-021/L-022 + HANDOFF
   retraction`.

**FF + push:**

- `git switch lt-4`
- `git merge --ff-only claude/festive-hoover-6abdbf`
- If FF fails, STOP and reconcile per CLAUDE.md branch workflow.
- `git push`

---

## Review (filled in as work progresses)

(To be filled in after each todo item completes; final review section
at end of dispatch.)
