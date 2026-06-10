# RESOLVED: emitter chains (children of children) WORK in the real game

_**RESOLVED 2026-06-10 (session 33): depth-3 chains spawn correctly in
`StarWarsG.exe`.** The v3 test fired in-game; the user observed all three
generations (sparkles → highlight flecks → smoke puffs). Decision-matrix row
"Smoke anywhere": chains work, the v1 crash was the combinatorial particle
bomb, **no editor depth-guard needed**. The mod file is RESTORED to vanilla —
nothing is planted anymore. Verdict + corollaries recorded in
[`multi_child_emitter_investigation.md`](multi_child_emitter_investigation.md)
(addendum). One open design question, unscheduled: a soft warning when a
chain's per-particle multiplication explodes. Historical notes below._

## The question

The editor (both UIs, by design) lets a child emitter have its own children —
the user built `default → default_1 → default_3 → default_2` and asked whether
the game even supports that. If the game crashes or silently ignores depth ≥ 3,
the editor must guard against authoring chains (reparent-onto, Add
Lifetime/Death Child, paste-as-child onto child targets).

## Live state (CLEAN as of 2026-06-10)

- **`P_S_ASSAULTCONC.ALO` is RESTORED to vanilla** — the v3 test was fired
  (smoke confirmed) and the planted file removed. Nothing in the user's mod
  is ours anymore.
  - Mod repo: `D:\SteamLibrary\steamapps\common\Star Wars Empire at War\corruption\Mods\EmpireAtWarExpanded`
  - Restore: `git -C <mod> checkout -- Data/Art/Models/P_S_ASSAULTCONC.ALO`
  - Re-plant: rebuild with `tests/build_make_chain_test_alo.bat`, then
    `tests\make_chain_test_alo.exe <vanilla.alo> <out.alo>` and copy over —
    no byte patching needed (see v3 below).
  - The mod repo also carries PRE-EXISTING unrelated modifications
    (`.gitignore`, `P_EXPLOSION_GODDAMNHUGE00.ALO`) — NOT ours, do not touch.
- `P_CONCUSSION.ALO` (the v1 test) was already restored to vanilla.

## v2 result (2026-06-10): SPARKLES ONLY — inconclusive, root starved

The user fired v2 and saw **sparkles only, no highlights** — decision-matrix
row 1: gen-2 never fired, so the test says nothing about depth-3. Root cause
of the dud: the v2 chain hung off `flash`, which is a near-zero-output
single-burst emitter (nBursts=1, perBurst=1) — a child emitter spawns *per
parent particle*, so the chain was starved at gen-1. (The sparkles seen were
the untouched `default` controls + flash's own particle.) v2 restored;
superseded by v3.

## The v3 test (FIRED 2026-06-10 — smoke confirmed, chains work)

Authored with the **editor's own data model** instead of byte patches —
[`tests/make_chain_test_alo.cpp`](../tests/make_chain_test_alo.cpp) (build:
[`tests/build_make_chain_test_alo.bat`](../tests/build_make_chain_test_alo.bat))
loads vanilla via `ParticleSystem(IFile*)`, rewires with the editor's
validated `reparentEmitter`, clamps spawn rates, writes with `ps.write()`,
then **reloads its own output and asserts the chain round-tripped** (all
checks green). Layout:

```
default (#2, W_SPARKLE1, 4/sec, life 0.70)   gen 1 — PROVEN to fire (v2 sparkles)
└─ life → detail (#1, W_NemSmoke_Highlight, clamped 200→6/sec, life 0.08)  gen 2
   └─ life → Smoke (#0, w_smoke, clamped 100→30/sec, life 1.20)           gen 3
default ×2 (#3, #4) + flash (#5)             untouched roots = controls
```

Design notes: the root is a `default` sparkle emitter because v2 proved those
fire in-game; all three textures are proven visible (in vanilla all six
emitters are ROOTS and the user has seen the full effect). Smoke's clamp is
deliberately higher (30/sec, not single digits): its instances ride detail
particles that live only 0.08 s, so a low rate could emit zero gen-3
particles and read as a false "depth stops at 2". Expected volume ~tens of
particles per volley — no v1-style particle bomb. Expected look if chains
work: sparkles + brief highlight flecks off the chain-root's sparkles + soft
smoke puffs (~1.2 s) trailing the highlights.

## Evidence so far

1. **Game binary RE** ([multi_child_emitter_investigation.md](multi_child_emitter_investigation.md),
   from `StarWarsG.exe`): every emitter struct has its own two child pointers
   (`deathChild` +0x1108, `lifeChild` +0x1110) — recursive by construction, no
   depth field. That investigation *recorded chains as the workaround* for the
   one-child-per-slot limit.
2. **Asset scan** ([tool-alo-chain-scan.py](tool-alo-chain-scan.py) over
   `C:\Modding\DATA`): 1,383 alo files, 409 particle files, 21 use child links,
   **all exactly depth 2 — zero chains in Petroglyph's shipped assets.**
3. **Editor preview engine** spawns recursively
   ([`EmitterInstance.cpp:356`](../src/EmitterInstance.cpp:356) life,
   [`:647`](../src/EmitterInstance.cpp:647) death) — chains render in-editor.
4. **v1 in-game test: CRASHED on firing.** P_CONCUSSION.ALO patched to a
   depth-6 full chain of all 6 emitters → game crashed when the projectile
   fired. **Confounded**: every generation spawns a child emitter per
   particle, so a 6-deep full-rate chain is a combinatorial particle bomb —
   the crash can't distinguish "chains illegal" from "millions of instances".
   No exception dump was written (only session lifecycle in
   `corruption\log\PGCrashCollector.txt`).

## The v2 test (HISTORICAL — fired 2026-06-10, sparkles only; superseded by v3 above)

Depth-3, low-count, texture-unambiguous chain in `P_S_ASSAULTCONC.ALO`:

```
flash (W_SPARKLE1, ~single burst)   gen 1 root, tiny count
└─ detail (W_NemSmoke_Highlight)    gen 2 — unique texture, only at depth 2
   └─ Smoke (w_smoke)               gen 3 — unique texture, ONLY at depth 3
default ×3 (W_SPARKLE1)             untouched roots = control group
```

**⚠ Re-plant warning:** the v2 selective layout was applied with **ad-hoc
`struct.pack_into` edits** (via the tool's *inspect* offsets), NOT with the
committed tool's `--patch` mode. `tool-alo-chain-patch.py --patch` writes a
**full all-emitter chain** (`life := i+1` for every emitter, the confounded
v1 design) — rerunning it on this 6-emitter file would destroy the control
group and recreate the particle bomb that crashed v1. To re-plant v2 after a
restore, write exactly: emitter 5 (`flash`) life→1, emitter 1 (`detail`)
life→0, all other links `0xFFFFFFFF` (offsets from the tool's inspect mode;
4-byte LE uint32 values inside each emitter's `0x0036` chunk minis
`0x37`=death/`0x39`=life). File format: `0x0900 → 0x0800 → 0x0700` per
emitter, name chunk `0x0016`, texture `0x0003`. Byte-size stays identical.
The patched file load-checks clean in our editor's C++ loader (launch with
the file as a CLI arg — `ParticleEditor.exe --new-ui <path>`).

## Decision matrix when the user fires it

| Observation | Conclusion | Editor action |
|---|---|---|
| Sparkles only, no highlights | gen-2 didn't fire from `flash` — inconclusive, re-root the chain on a sparkle emitter | retest |
| Highlights, no smoke | depth stops at 2 (silently ignored) | add depth guard |
| Smoke anywhere | chains work; v1 crash was the particle bomb | document in multi_child doc; no guard; consider a soft warning about per-particle multiplication |
| Crash again | chains crash even tiny/depth-3 | **hard guard required**: refuse reparent/add-child/paste-as-child creating depth ≥ 3 (+ consider sanitizing chains on load, since the editor must not author game-crashing files) |

## Depth-guard sketch (only if needed)

Web: `resolveDropIntent`'s onto branch + the Add Lifetime/Death Child menu
enablement + paste-as-child refuse targets whose depth ≥ 2 (target is already
a child). Host: mirror in `reparentEmitter` / add-child handlers. Mock parity.
The existing `default → default_1 → default_3 → default_2` class of tree also
needs a load-time decision (sanitize vs warn) — discuss with the user first.
