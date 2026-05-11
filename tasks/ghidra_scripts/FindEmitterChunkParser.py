# -*- coding: utf-8 -*-
# Find the emitter spawn-link chunk parser (chunk 0x36, mini-chunks 0x37 and 0x39)
# in a stripped EaW/FoC binary.
#
# Question we want answered:
#   - When the engine parses chunk 0x36 under an emitter, how does it handle
#     mini-chunks 0x37 (spawnOnDeath) and 0x39 (spawnDuringLife)?
#   - Specifically: if multiple 0x39 mini-chunks appear, does the parser
#     accept-and-list, last-wins, or hard-fail?
#   - In the runtime emitter struct, is the during-life child a single int
#     or a collection?
#   - At particle-spawn time, is the field read once or iterated?
#
# Anchor strategy (unlike BloomIteration there are no string anchors):
#   1. Find every function whose instruction stream uses BOTH 0x37 AND 0x39
#      as scalar immediates. This is a strong filter -- the spawn-link parser
#      compares the result of nextMini() against both.
#   2. Score each candidate: + for containing 0x36 too, + for containing the
#      sentinel 0xFFFFFFFF, + for size in a sensible parser range (50-2000 bytes).
#   3. Decompile the top scorers and print them. A human (or follow-up grep)
#      then reads the decompilation to identify the parser shape.
#
# @category Analysis
# @runtime Jython

from ghidra.app.decompiler import DecompInterface, DecompileOptions
from ghidra.util.task import ConsoleTaskMonitor

# Mini-chunk IDs from src/ParticleSystem.cpp:278-279
LIFE_ID  = 0x39  # spawnDuringLife
DEATH_ID = 0x37  # spawnOnDeath
BLOCK_ID = 0x36  # parent spawn-link block
SENTINEL = 0xFFFFFFFF

monitor = ConsoleTaskMonitor()
fm = currentProgram.getFunctionManager()
listing = currentProgram.getListing()

print("=" * 72)
print("Program: %s  (%s, %d bytes)" % (
    currentProgram.getName(),
    currentProgram.getLanguage().getProcessor().toString(),
    currentProgram.getMemory().getSize()))
print("Searching for chunk-0x36 spawn-link parser.")
print("=" * 72)

# 1) For each function, collect the distinct scalar immediates seen in its
#    instruction stream. We only care about a handful of values, so keep
#    a small per-function set rather than a full histogram.
WATCH = set([BLOCK_ID, DEATH_ID, LIFE_ID, SENTINEL])

fn_hits = {}  # fn -> set of WATCH values it contains
fn_addrs = {} # fn -> list of (addr, imm) pairs for those hits (for printing)

func_iter = fm.getFunctions(True)
total = 0
for f in func_iter:
    total += 1
    body = f.getBody()
    seen = set()
    addrs = []
    for ins in listing.getInstructions(body, True):
        n = ins.getNumOperands()
        for i in range(n):
            for obj in ins.getOpObjects(i):
                # Scalars come through as ghidra.program.model.scalar.Scalar
                try:
                    v = obj.getUnsignedValue()
                except AttributeError:
                    continue
                if v in WATCH:
                    if v not in seen:
                        seen.add(v)
                        addrs.append((ins.getAddress(), v))
    if seen:
        fn_hits[f] = seen
        fn_addrs[f] = addrs

print("")
print("Scanned %d functions." % total)
print("Functions touching any of {0x36,0x37,0x39,0xFFFFFFFF}: %d" % len(fn_hits))

# 2) Filter to functions that contain BOTH 0x37 AND 0x39 (the strong signal),
#    then score.
both_37_and_39 = [f for f, s in fn_hits.items()
                  if DEATH_ID in s and LIFE_ID in s]

print("Functions containing BOTH 0x37 and 0x39 as immediates: %d" %
      len(both_37_and_39))

def score(f):
    s = fn_hits[f]
    sc = 0
    if BLOCK_ID in s: sc += 3
    if SENTINEL in s: sc += 2
    sz = f.getBody().getNumAddresses()
    if 50 <= sz <= 4000: sc += 1
    return sc

ranked = sorted(both_37_and_39,
                key=lambda f: (-score(f), f.getBody().getNumAddresses()))

print("")
print("--- Ranked candidates (containing both 0x37 and 0x39) ---")
for f in ranked:
    s = fn_hits[f]
    print("  score=%d  size=%d  imms=%s  %s @ %s" % (
        score(f),
        f.getBody().getNumAddresses(),
        sorted(["0x%x" % v for v in s]),
        f.getName(), f.getEntryPoint()))
    for a, v in fn_addrs[f]:
        print("      0x%02x @ %s" % (v, a))

# 3) Decompile the top N (cap to keep output sane).
TOP_N = 6
print("")
print("=" * 72)
print("DECOMPILING TOP %d CANDIDATES" % min(TOP_N, len(ranked)))
print("=" * 72)

decomp = DecompInterface()
opts = DecompileOptions()
decomp.setOptions(opts)
decomp.toggleCCode(True)
decomp.toggleSyntaxTree(True)
decomp.openProgram(currentProgram)

for f in ranked[:TOP_N]:
    name = f.getName()
    ep = f.getEntryPoint()
    print("")
    print("-" * 72)
    print("FUNCTION %s @ %s   score=%d   size=%d" % (
        name, ep, score(f), f.getBody().getNumAddresses()))
    print("immediates in body: %s" % sorted(["0x%x" % v for v in fn_hits[f]]))
    print("-" * 72)
    res = decomp.decompileFunction(f, 90, monitor)
    if res is None or not res.decompileCompleted():
        msg = res.getErrorMessage() if res is not None else "no result"
        print("(decompilation failed: %s)" % msg)
        continue
    c = res.getDecompiledFunction().getC()
    print(c)

print("")
print("=" * 72)
print("DONE -- look for a switch/while pattern with case 0x37 and case 0x39")
print("writing to two adjacent struct fields. If 0x39 case writes to an")
print("array index that increments, the engine supports >1 life-child.")
print("If it writes to a single fixed offset, it's last-wins / hardwired-one.")
print("=" * 72)
