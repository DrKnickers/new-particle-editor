# Lessons learned

Living file. After any user correction, append a rule that prevents the
same mistake. Each rule states the rule, the trigger, and the source
incident.

---

## L-001 — Don't infer binary provenance from bitness + timestamp alone

**Rule.** When inspecting a third-party binary, do not infer
"community recompile" from bitness + recent timestamp. The vendor may
have shipped the modernization themselves long after launch.

**Trigger.** Any time you find a binary that "should be" 32-bit /
"should be" old but is 64-bit / recent. Verify provenance via the
vendor's release notes / press coverage / signed-binary metadata
*before* asserting authorship.

**Source incident (2026-05-11).** While planning the bloom-iteration
RE work, I noted the EaW/FoC binaries were x64 with 2025 timestamps
and concluded "community recompile" — which would have made me caveat
the RE results as non-canonical. User corrected: Petroglyph themselves
shipped a 64-bit patch as a community-support gesture
(see `memory/project_petroglyph_64bit_patch.md`). The binaries are
canonical. The miscaveat would have polluted the CHANGELOG entry and
created false uncertainty about whether the discovered iteration count
was the "real" engine value.

---

## L-002 — Root `.gitignore` has `**/packages/*` (NuGet boilerplate) — silently eats `web/packages/` source

**Rule.** When adding any new top-level directory that contains a
`packages/` subdirectory (monorepo workspaces, npm/pnpm/yarn workspaces,
module folders), check the repo-root `.gitignore` *before* committing.
A `**/packages/*` rule (inherited from Visual Studio / NuGet project
templates) will silently exclude every file under any `packages/`
directory in the tree.

**Trigger.** Creating a new directory whose layout includes a
`packages/` segment. Examples that would trip this:
`web/packages/<name>/...`, `services/packages/<name>/...`,
`libs/packages/<name>/...`. The footgun: `git add web/packages/x` reports
success but stages nothing; the first sign of trouble is `git status`
showing fewer files than expected.

**How to apply.**
- Before staging, run `git check-ignore -v web/packages/<file>` (or
  equivalent path) to verify nothing's swallowing the path.
- If the root rule is load-bearing for the Visual Studio side, add
  scoped negation rules to the new directory's `.gitignore`:
  ```
  !packages/
  !packages/**
  ```
  Scoped to the subtree, won't accidentally un-ignore NuGet restore
  folders elsewhere.

**Source incident (2026-05-16).** During LT-4 Task 0.4 (web/ monorepo
bootstrap), the implementer was about to commit `web/packages/design-tokens/`
when they noticed `git add` had silently dropped the new source files.
Diagnosed via `git check-ignore -v` and patched `web/.gitignore` with
negation rules before committing. The root `.gitignore`'s
`**/packages/*` is inherited from the Visual Studio C++ project's
NuGet package-restore boilerplate — it's load-bearing for that side
and shouldn't be removed. Scoped negation is the right fix.
