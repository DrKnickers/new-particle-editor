# Deferred: do emitter chains (children of children) work in the real game?

_Deferred 2026-06-09 (session 32) at the user's request, mid-experiment. The
**v2 test file is still planted in the user's mod** — see "Live state" below
before doing anything else._

## The question

The editor (both UIs, by design) lets a child emitter have its own children —
the user built `default → default_1 → default_3 → default_2` and asked whether
the game even supports that. If the game crashes or silently ignores depth ≥ 3,
the editor must guard against authoring chains (reparent-onto, Add
Lifetime/Death Child, paste-as-child onto child targets).

## Live state (handle FIRST on resume)

- **`P_S_ASSAULTCONC.ALO` in the user's mod is the patched v2 test file**
  (depth-3 chain), UNTESTED — the user deferred before firing it.
  - Mod repo: `D:\SteamLibrary\steamapps\common\Star Wars Empire at War\corruption\Mods\EmpireAtWarExpanded`
  - Restore: `git -C <mod> checkout -- Data/Art/Models/P_S_ASSAULTCONC.ALO`
  - The mod repo also carries PRE-EXISTING unrelated modifications
    (`.gitignore`, `P_EXPLOSION_GODDAMNHUGE00.ALO`) — NOT ours, do not touch.
- `P_CONCUSSION.ALO` (the v1 test) was already restored to vanilla.

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

## The v2 test (planted, unfired)

Depth-3, low-count, texture-unambiguous chain in `P_S_ASSAULTCONC.ALO`:

```
flash (W_SPARKLE1, ~single burst)   gen 1 root, tiny count
└─ detail (W_NemSmoke_Highlight)    gen 2 — unique texture, only at depth 2
   └─ Smoke (w_smoke)               gen 3 — unique texture, ONLY at depth 3
default ×3 (W_SPARKLE1)             untouched roots = control group
```

Patched with [tool-alo-chain-patch.py](tool-alo-chain-patch.py) (rewrites only
the 4-byte values in each emitter's `0x0036` chunk minis `0x37`/`0x39`;
byte-size identical; format: `0x0900 → 0x0800 → 0x0700` per emitter, name
chunk `0x0016`, texture `0x0003`, `0xFFFFFFFF` = no link). The patched file
load-checks clean in our editor's C++ loader (launched with the file as CLI
arg — `ParticleEditor.exe --new-ui <path>`).

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
