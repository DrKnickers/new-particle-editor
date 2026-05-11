# -*- coding: utf-8 -*-
# Find every function that reads or writes the emitter's lifeChild pointer
# slot at struct offset 0x1110 (or deathChild at 0x1108). Discovered via
# the writer FUN_140134b50 (Terrain Editor) which stores:
#   *(emitter + 0x1108) = deathChild* (single)
#   *(emitter + 0x1110) = lifeChild*  (single, 8 bytes after)
#
# We want to confirm:
#   - The parser (read side) writes to the same single slot, not a list.
#   - The spawn-time code reads from a single slot, not iterates a list.
#
# Strategy: scan every instruction for an immediate displacement of 0x1110
# or 0x1108 (these would appear as the "+offset" in things like
# MOV RAX, [RBX + 0x1110]). For each function that touches the offset,
# decompile it.
#
# Note: this is best-effort; struct offsets that large should be uncommon
# enough to not generate too much noise.
#
# @category Analysis
# @runtime Jython

from ghidra.app.decompiler import DecompInterface, DecompileOptions
from ghidra.util.task import ConsoleTaskMonitor

LIFE_OFF  = 0x1110
DEATH_OFF = 0x1108

monitor = ConsoleTaskMonitor()
fm = currentProgram.getFunctionManager()
listing = currentProgram.getListing()

print("=" * 72)
print("Searching for code touching emitter+0x%x or emitter+0x%x" %
      (LIFE_OFF, DEATH_OFF))
print("=" * 72)

fn_hits = {}  # fn -> {LIFE_OFF: [addr], DEATH_OFF: [addr]}

for f in fm.getFunctions(True):
    body = f.getBody()
    for ins in listing.getInstructions(body, True):
        n = ins.getNumOperands()
        for i in range(n):
            for obj in ins.getOpObjects(i):
                try:
                    v = obj.getUnsignedValue()
                except AttributeError:
                    continue
                if v in (LIFE_OFF, DEATH_OFF):
                    fn_hits.setdefault(f, {}).setdefault(v, []).append(
                        ins.getAddress())

print("")
print("Functions touching emitter+0x1108 or emitter+0x1110: %d" % len(fn_hits))
print("")
for f, hits in sorted(fn_hits.items(),
                       key=lambda kv: kv[0].getEntryPoint().getOffset()):
    tags = []
    if LIFE_OFF  in hits: tags.append("life@0x%x x%d"  % (LIFE_OFF,  len(hits[LIFE_OFF])))
    if DEATH_OFF in hits: tags.append("death@0x%x x%d" % (DEATH_OFF, len(hits[DEATH_OFF])))
    print("  %s @ %s  size=%d  %s" % (
        f.getName(), f.getEntryPoint(),
        f.getBody().getNumAddresses(), "  ".join(tags)))

# Decompile a few. The writer FUN_140134b50 is already known; cap at top 8.
TOP_N = 8
print("")
print("=" * 72)
print("DECOMPILING UP TO %d CANDIDATES" % TOP_N)
print("=" * 72)

decomp = DecompInterface()
opts = DecompileOptions()
decomp.setOptions(opts)
decomp.toggleCCode(True)
decomp.toggleSyntaxTree(True)
decomp.openProgram(currentProgram)

# Prefer functions that touch BOTH slots (those are likely struct ctor /
# dtor / serializer / deserializer); list them first.
def both_score(kv):
    f, hits = kv
    has_both = int(LIFE_OFF in hits and DEATH_OFF in hits)
    return (-has_both, f.getBody().getNumAddresses())

for f, hits in sorted(fn_hits.items(), key=both_score)[:TOP_N]:
    name = f.getName()
    ep = f.getEntryPoint()
    print("")
    print("-" * 72)
    print("FUNCTION %s @ %s   size=%d" % (
        name, ep, f.getBody().getNumAddresses()))
    print("touches: %s" % ", ".join(
        ["0x%x x%d" % (k, len(v)) for k, v in hits.items()]))
    print("-" * 72)
    res = decomp.decompileFunction(f, 90, monitor)
    if res is None or not res.decompileCompleted():
        msg = res.getErrorMessage() if res is not None else "no result"
        print("(decompilation failed: %s)" % msg)
        continue
    print(res.getDecompiledFunction().getC())
