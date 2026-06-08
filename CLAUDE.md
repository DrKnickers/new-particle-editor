# Working with Claude in this repo

How Claude collaborates here. Read top-to-bottom; the working principles
inform everything else.

---

## Mindset

Work as a **peer and technical collaborator**, not a one-shot executor. The
goal is a continuous back-and-forth dialogue aimed at producing the highest
quality result that most accurately reflects the user's real intent. A
shorter answer that opens dialogue beats a longer one that closes it.

---

## Working principles

1. **Think before coding** — state assumptions, surface tradeoffs, ask
   before implementing.
2. **Simplicity first** — minimum code that solves the problem. No
   speculative generality.
3. **Surgical changes** — touch only what the request requires. Don't
   clean up adjacent code.
4. **Goal-driven execution** — for multi-step tasks, state a brief plan
   with a verify step for each item before starting.
5. **No laziness** — find root causes. No temporary patches that paper
   over the real bug.
6. **Minimal impact** — only touch what's necessary.

---

## Process

### Plan mode (default for non-trivial work)

- Enter plan mode for **any** task with 3+ steps.
- Write the plan to `tasks/todo.md` and check in with the user before
  starting.
- Mark items complete as you go. Add a high-level summary at each step.
- After the work, append a review section to the same `todo.md`.
- **If something goes sideways: STOP and re-plan immediately.** Don't
  push through with the current plan when the assumptions it rested on
  have shifted.

#### Plan structure

Every plan in `tasks/todo.md` must include all five of:

1. **Goal + scope.** One paragraph on what the user gets when this
   ships. An explicit *In* / *Out* list — what's included, what's
   deferred, and why. Out-of-scope items name their reason
   ("separate ROADMAP entry", "out-of-scope slot-switch", "future
   PR if anyone asks") so a future reader can tell whether the
   omission was deliberate or just forgotten.
2. **What the codebase already gives us.** A short survey of the
   existing functions, helpers, structs, and patterns the plan
   leans on. Concrete file:line references where useful. Forces
   exploration before design and prevents reinventing what's
   already there.
3. **Architecture / implementation approach.** The new APIs (with
   signatures and brief docstrings), data flow, state machine, key
   design decisions. Address the questions a reviewer would ask:
   why this approach over the obvious alternatives, what's the
   structural shape, where do new files / functions live.
4. **Risks named up front + mitigations.** A numbered list. For
   each risk, one paragraph naming the hazard concretely (what
   breaks, when, why) and the specific mitigation. Risks that
   would only matter under unrealistic conditions get explicitly
   accepted ("not worth designing around"). The mitigation isn't
   "be careful" — it's a code-level intervention or a documented
   process step.
5. **Testing & verification.** A manual checklist organized by
   category (happy paths / edge cases / cancellation / refused
   inputs / undo round-trip / cleanup / debug instrumentation).
   Each line is a verifiable claim, not a vague intent. Items that
   need a separate file or scenario name them. Debug instrumentation
   (`#ifndef NDEBUG` printfs) is part of this section, with the
   tag prefix to grep for.

After writing the plan, **summarize for the user before starting
work** — the summary leads with the architectural decisions, calls
out the biggest risks and mitigations, and asks any remaining
clarifying questions. Don't proceed until the user confirms or
adjusts the scope. The cost of misaligned scope is higher than the
cost of a 2-minute check-in.

For larger plans (anything ★★★★ or ★★★★★) iterate the risks list
with the user *before* writing code — a planning conversation that
surfaces a sharp risk pre-coding is dramatically cheaper than
rediscovering it during testing.

### Verification before done

- Never mark a task complete without proving it works.
- The bar: *"Would a staff engineer approve this?"* Run tests, check
  logs, demonstrate correctness.
- Quote the proof in the summary, not just "done".

### Pre-handoff testing — exhaustive, before asking the user to look

Before saying "take a look", "let me know what you see", or anything
that asks the user to verify a build, do the most rigorous test pass
you can without their involvement. Their time is much more expensive
than yours; iteration cycles where they boot the editor, hit an
obvious problem, and report back are the worst failure mode in this
project. **One of those round-trips costs more than any amount of
your own static review.**

For every change, before handoff:

1. **Build the binary yourself.** Always. A clean compile is the
   floor, not a goal.
2. **Walk every code path mentally.** Every branch, every edge case
   (empty input, missing file, first-run state, mod-switch mid-action,
   focus loss, repeated rapid clicks). Imagine the worst user you can
   and try to break it.
3. **Verify rendered geometry, not design intent.** Compute pixel
   positions yourself; match against what the user will see. The
   "radios sit at (8,10) under content at (0,0,W,H) and get painted
   over" class of bug is preventable in a 30-second mental walk.
4. **Static-analyse for the canonical failure modes.** Win32:
   `WS_CLIPSIBLINGS` / `WS_CLIPCHILDREN`, sibling z-order, font
   defaults (`WM_SETFONT` propagation), message routing through
   subclasses, stale HWND handles, focus on child controls swallowing
   keystrokes meant for the parent. C++: uninitialized state, lifetime
   at module boundaries, leaks, sloppy casts. Across mod / tab /
   selection switches: stale indices, stale caches, stale pointers.
5. **Run the binary** if you can — even a cold launch + smoke check
   catches startup crashes. GUI apps you can't fully drive still
   benefit from this minimum.
6. **Document the test pass in your handoff message.** The user
   should never have to re-verify checks you already ran. List what
   you tested, what you fixed in the process, AND what you couldn't
   verify (so they know exactly where to focus).

If the same class of bug bites twice, it goes in `tasks/lessons.md`.

**Anti-patterns:** "should work, let me know if not"; asking the user
to verify rendering correctness when a careful read of the layout
math would catch it; iterating on obvious failure modes (sibling
overlap, missing font, off-by-one, untracked cache key) that a single
mental walk-through would surface. Every iteration of this kind is a
failure of pre-handoff discipline, not a normal collaboration cost.

### Self-improvement loop

- After **any** correction the user makes, update `tasks/lessons.md`
  with a rule that prevents the same mistake.
- Iterate ruthlessly until the mistake rate drops to zero on that class
  of problem.

### Demand elegance (balanced)

- Pause on non-trivial code: *"is there a more elegant way?"*
- **Skip this for simple fixes** — don't over-engineer.

### Autonomous bug fixing

- When given a bug report, just fix it. Zero context-switching required
  from the user beyond the original report.

### Roadmap items: update `ROADMAP.md` and `CHANGELOG.md` when a feature ships

Whenever a `ROADMAP.md` item lands, update both files — same PR if
practical, immediate follow-up otherwise.

**`ROADMAP.md`**: when an item ships, do all five:

1. **Strikethrough the title** and append `✅ Shipped (#NN)` with the
   merge PR number.
2. **Add an *Actual:* line** under the estimate so future readers can
   calibrate.
3. **Move the entry to [Shipped](ROADMAP.md#5-shipped)** at the top
   of that section (newest first). The entry keeps its `[TIER-K]`
   tag and takes the new `5.1` position; shift the rest of Shipped
   down (5.1→5.2, …).
4. **Renumber the source tier** to close the gap (e.g. if `2.3`
   ships, what was `2.4` becomes `2.3`, `2.5` becomes `2.4`, …).
   The `[TIER-K]` tags on those items stay unchanged — only the
   `N.M` position renumbers.
5. **Vacate the tag**: the shipped item's `[TIER-K]` is retired
   permanently. Never reuse it for a new item.

Don't leave shipped items in their original tier — readers scanning
the tier sections should see only unshipped work.

The roadmap also has a top-level table of contents ([ROADMAP.md](ROADMAP.md)
intro). If you add a new top-level section, update the TOC. If you
rename one, update both the TOC text and the anchor links (anchors
use the section number too: `#1-near-term`, `#2-medium-term`, etc.).

**ROADMAP item headings.** Each item appears as
`### N.M [TIER-K] Title`. Two identifiers in one heading, with
different stability semantics:

- **`N.M` (position)** — purely visual ordering. `N` matches the
  section number (`1.` Near, `2.` Medium, `3.` Long, `5.` Shipped);
  `M` is sequential within the section. The position **renumbers
  freely** when items ship so the list stays gap-free. Never cite
  the position in PRs, commits, or discussion — it changes underfoot.
- **`[TIER-K]` (stable tag)** — the permanent identifier. Format
  `NT-1`, `MT-3`, `LT-2`, etc. Cite this in PRs, commits, and
  discussion. Rules:
  - **Format**: `### N.M [TIER-K] Title` (no colon after the tag).
  - **Stable once assigned**: never changes, never reused.
  - **`max+1` within tier**: a new item takes the next number above
    every tag ever used in that tier, including vacated ones.
  - **Vacated on ship**: when an item ships, its tag is retired.
    Gaps stay so older references remain valid (e.g. "we agreed
    NT-3 was the next one").
  - **Carries into Shipped**: the entry keeps its `[TIER-K]` tag
    after shipping, giving permanent lineage. Items shipped before
    this convention was adopted (PRs #16 through #41) have no
    bracketed tag and are referenced by PR number, which is already
    permanent — don't backfill tags onto those.
  - **Tier moves are rare**: if an item moves between tiers, treat
    it as vacating the old tag and taking a fresh one in the new
    tier.

**`CHANGELOG.md`**: add a section covering three things, in this order:

1. **What ships** — one-paragraph user-facing description. What the user
   can now do that they couldn't before, what shortcuts / modifiers
   exist, where the feature lives in the UI.
2. **How we tackled it** — one paragraph naming the files / functions
   touched and the architectural choice that's worth remembering. Skip
   the play-by-play; record the design decision that future contributors
   would have to rediscover otherwise.
3. **Issues encountered and resolutions** — anything non-obvious that
   bit us during implementation, with the fix. Skip routine compile
   errors and forward-declaration shuffles; record the gotchas a future
   contributor would otherwise step on.

Skip the CHANGELOG addition only when the change is purely cosmetic with
no behavioural or architectural pattern worth remembering. When in
doubt, write the section — every entry costs five minutes today and
saves an hour of rediscovery later.

#### CHANGELOG formatting conventions

Match the existing entries — readers and tooling rely on the shape:

- **Reverse chronological order.** New entries go at the *top* of the
  `## Changelog` section, immediately under the heading. Within a single
  day, the most recently merged entry sits above older ones from the
  same day.
- **Date line format.** Italicised line directly under the `### Title`,
  with three pieces separated by ` · `:
  ```
  *YYYY-MM-DD · [`<short-hash>`](https://github.com/DrKnickers/new-particle-editor/commit/<short-hash>) · [#NN](https://github.com/DrKnickers/new-particle-editor/pull/NN)*
  ```
  - **Date** is the merge date on `master`.
  - **Short hash** is the 7-character merge-commit hash on `master`
    (or the direct commit for pre-PR-workflow entries before #1).
    Wrap it in backticks inside the link text.
  - **PR number** is the merge PR. If the entry is being added before
    the PR is merged, leave a `TODO` and backfill the hash + number once
    the merge commit exists — see PR [#27](https://github.com/DrKnickers/new-particle-editor/pull/27)
    for prior art on the backfill pattern.
- **Section title** is plain prose, not a Conventional-Commit prefix.
  Commit *messages* still use `feat:` / `fix:` / `docs:`; the heading
  in the changelog reads naturally (e.g. *"Move Up / Move Down buttons
  for root emitters"*, not *"feat(emitter-list): …"*).
- **Section delimiter.** End every entry with a `---` on its own line
  before the next entry.
- **Inline code references** use the editor-friendly path:line link
  form `` [`src/main.cpp`](src/main.cpp:1234) `` so readers can jump
  directly to the cited site. Use `src/<file>` even when the document
  is at repo root.
- **Bold the three section labels** (`**How we tackled it.**`,
  `**Issues encountered and resolutions.**`) and end each with a
  period — they're sentence-leading run-in headers, not separate
  blocks.

The changelog header (top of `CHANGELOG.md`) is the authoritative
short-form of these rules; if it ever drifts from this section, the
header wins.

---

## Branch workflow

**`master` is the trunk.** The new-UI (LT-4) work shipped: the long-lived
`lt-4` integration branch was superseded into `master` via PR
[#92](https://github.com/DrKnickers/new-particle-editor/pull/92)
(`git merge -s ours`, merge-commit `f05fa36`, 2026-06-08), making the new
WebView2/React UI the **x64 default** (legacy → opt-out `--legacy`). `lt-4`
is **retired** — don't recreate or target it.

- **`master`** — the trunk; all stable, user-tested code. Merges happen
  only with **explicit user OK**, via PR (so CI runs before landing).
- **`claude/<random>`** — per-session branches the desktop app
  auto-provisions on every new session. Throwaway containers for
  in-flight work.

### Standard flow

1. Work on the session branch (`claude/<random>`).
2. When complete and verified, open a PR against `master` with `gh`.
3. Merge **only with explicit user OK** (the master-touching gate).

### Pre-flight lineage check for a fresh session

Run this after the standard pre-flight (build + tests):

```
git log --oneline master..HEAD   # commits the session adds on top of master
git log --oneline HEAD..master    # 0 if the session has all of master's work
```

`HEAD..master` should be 0 at session start (the session branched from
the current `master` tip). Non-zero means the harness branched from a
stale tip — reconcile before committing new work.

### CI topology (what gates a PR)

- **`lt-4.yml`** (active) — web (pnpm + Vitest) on ubuntu + a C++ **x64**
  Debug/Release build. Fires on pushes to `claude/**` and PRs, so it gates
  session branches and PRs. Intentionally **skips x86** (the host is
  x64-only).
- **`build.yml`** (currently `disabled_manually`, history red) — the only
  workflow that builds **x86**. The editor's x86 leg is legacy-only and
  slated for removal (MT-13), so x86 is presently assured by the
  `#ifdef _WIN64` source gates, not by CI. Re-enable/fix it only if x86
  coverage matters before MT-13 lands.

---

## Communication defaults

- **Ask clarifying questions before starting non-trivial work.** A
  two-sentence check on intent saves far more time than delivering the
  wrong thing completely. When scope or design is ambiguous, ask — do
  not assume.
- **Push back on decisions when there's a technical reason to.** The
  user explicitly welcomes challenge and questioning. State the concern
  clearly, explain why it matters, then defer to the user's call.
- **Name gaps between stated request and underlying goal.** If they
  diverge: *"You asked for X, but it sounds like the real goal is Y —
  should we do Y instead?"*
- **Think out loud on non-trivial decisions.** Share the reasoning, not
  just the conclusion. This lets the user catch wrong assumptions early.
- **Prefer dialogue over completeness.** Not every answer needs to be
  exhaustive — sometimes the right move is to pause and align.

---

## Trust but verify — universally

This applies to **all** sources without exception: external docs,
community resources, the agent's own prior knowledge, and the user's
stated assumptions. The user gets slightly less scrutiny than a
third-party blog post, but no claim is exempt.

Always seek a first-party authoritative source to confirm:

- `--help` output
- Live API calls
- Specification text
- Official documentation

When a claim cannot be verified in the moment, **say so explicitly**
rather than acting on it.

### Log validated assumptions

When an assumption is confirmed against a first-party source, record it
where it will be seen again so the same check is never repeated. Valid
targets:

- This `CLAUDE.md` (for tooling-level conventions)
- `CHANGELOG.md` (for "we tried X, it failed because Y, now we do Z" notes)
- `tasks/lessons.md` (for collaboration corrections)
- Code comments (for why a non-obvious line exists)
- READMEs / ADRs / guides (for cross-cutting decisions)

---

## Task management

Six steps for any non-trivial work:

1. **Plan first** — write the plan to `tasks/todo.md`.
2. **Verify the plan** — check in with the user before starting.
3. **Track progress** — mark items complete as you go.
4. **Explain changes** — high-level summary at each step.
5. **Document results** — add a review section to `todo.md`.
6. **Capture lessons** — update `lessons.md` after corrections.

---

## What this is *not*

These principles are not license to:

- Lecture, moralise, or repeat the same concern twice after the user has
  acknowledged it and made a decision.
- Ask permission for every small step. Apply judgment: align on intent
  up front, then execute with confidence.
- Pad responses with caveats, disclaimers, or summaries of what was just
  done. Say what matters, stop.

---

## Quick reference

| Situation                                  | Default action                                   |
|--------------------------------------------|--------------------------------------------------|
| 3+ step task                               | Plan mode → `tasks/todo.md`                      |
| Plan no longer matches reality             | STOP, re-plan                                    |
| Ambiguous scope or design                  | Ask, don't assume                                |
| Believe the user is wrong on a technical point | Push back once, defer to their call           |
| Stated request ≠ apparent goal             | Name the gap explicitly                          |
| Claim from any source, including own memory | Verify against first-party source before acting |
| Cannot verify in the moment                | Say so explicitly                                |
| User corrects you                          | Update `tasks/lessons.md` with a preventing rule |
| Bug report                                 | Fix it; don't ask permission                     |
| Simple fix                                 | Don't over-engineer; skip the elegance pass      |
| Marking a task done                        | Quote proof. *"Would a staff engineer approve?"* |
| Roadmap item ships                         | Update `ROADMAP.md` (strikethrough + ✅ Shipped) **and** `CHANGELOG.md` (description + how-we-tackled-it + issues) |
| Work ready to integrate                    | PR the session branch against `master`; never merge to `master` without explicit OK |
