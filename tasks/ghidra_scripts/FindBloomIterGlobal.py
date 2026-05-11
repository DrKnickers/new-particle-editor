# -*- coding: utf-8 -*-
# Find all references (especially writes) to DAT_140f09244 -- the global that
# stores the bloom-blur iteration count read by FUN_1400effc0.
#
# We want to know:
#   - Every site that reads the value (callers of the bloom render path).
#   - Every site that writes the value (initialization / config / quality).
#   - The immediate(s) being written so we know the default(s).
#
# @category Analysis
# @runtime Jython

from ghidra.app.decompiler import DecompInterface, DecompileOptions
from ghidra.util.task import ConsoleTaskMonitor
from ghidra.program.model.symbol import RefType

TARGET = 0x140f09244

monitor = ConsoleTaskMonitor()
fm = currentProgram.getFunctionManager()
af = currentProgram.getAddressFactory()
listing = currentProgram.getListing()

target_addr = af.getAddress("%x" % TARGET)
print("=" * 70)
print("Target global: %s" % target_addr)
print("=" * 70)

# Gather all references
reads = []
writes = []
others = []
for r in getReferencesTo(target_addr):
    rt = r.getReferenceType()
    if rt.isWrite():
        writes.append(r)
    elif rt.isRead():
        reads.append(r)
    else:
        others.append(r)

def describe(r):
    a = r.getFromAddress()
    f = fm.getFunctionContaining(a)
    fn = f.getName() + " @ " + str(f.getEntryPoint()) if f else "(no func)"
    instr = listing.getInstructionAt(a)
    return "%s  %s   in %s   ::  %s" % (
        r.getReferenceType().getName(), a, fn,
        instr.toString() if instr else "?")

print("")
print("--- WRITES (%d) ---" % len(writes))
for r in writes: print("  " + describe(r))
print("")
print("--- READS (%d) ---" % len(reads))
for r in reads: print("  " + describe(r))
print("")
print("--- OTHER (%d) ---" % len(others))
for r in others: print("  " + describe(r))

# Decompile every function that writes to this global -- those are the
# initialization/config sites we care about.
print("")
print("=" * 70)
print("DECOMPILED WRITER FUNCTIONS")
print("=" * 70)

writer_funcs = set()
for r in writes:
    f = fm.getFunctionContaining(r.getFromAddress())
    if f: writer_funcs.add(f)

decomp = DecompInterface()
decomp.setOptions(DecompileOptions())
decomp.toggleCCode(True)
decomp.openProgram(currentProgram)

for f in sorted(writer_funcs, key=lambda x: x.getEntryPoint().getOffset()):
    print("")
    print("-" * 70)
    print("FUNCTION %s @ %s  body=%d bytes" % (
        f.getName(), f.getEntryPoint(), f.getBody().getNumAddresses()))
    print("-" * 70)
    res = decomp.decompileFunction(f, 90, monitor)
    if res is None or not res.decompileCompleted():
        print("(decompilation failed)")
        continue
    print(res.getDecompiledFunction().getC())
