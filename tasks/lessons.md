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
canonical. The miscaveat would have polluted the development-log entry and
created false uncertainty about whether the discovered iteration count
was the "real" engine value.
