# -*- coding: utf-8 -*-
# Find the bloom blur-iteration loop in a stripped EaW/FoC binary.
#
# Anchor: the literal strings BloomIteration / BloomStrength / Engine\SceneBloom
# (all confirmed present in the .rdata of the target via raw byte scan).
#
# Strategy:
#   1. Find each anchor string in defined data.
#   2. Collect xrefs to those strings (the call sites that load the param name).
#   3. Walk one level up the call graph (binder may be a thin wrapper).
#   4. Decompile every candidate function and print it.
#
# A human (or grep) then reads the decompiled output to identify the
# for-loop whose body sets BloomIteration each step. The loop bound is
# the answer.
#
# @category Analysis
# @runtime Jython

from ghidra.app.decompiler import DecompInterface, DecompileOptions
from ghidra.util.task import ConsoleTaskMonitor

ANCHORS = ["BloomIteration", "BloomStrength", "BloomCutoff", "BloomSize",
           "Engine\\SceneBloom", "SceneBloom"]

monitor = ConsoleTaskMonitor()
fm = currentProgram.getFunctionManager()
listing = currentProgram.getListing()

print("=" * 70)
print("Program: %s  (%s, %d bytes)" % (
    currentProgram.getName(),
    currentProgram.getLanguage().getProcessor().toString(),
    currentProgram.getMemory().getSize()))
print("=" * 70)

# 1) find string addresses
anchor_addrs = {}
for data in listing.getDefinedData(True):
    val = data.getValue()
    if val is None:
        continue
    try:
        s = str(val)  # Jython str() raises UnicodeEncodeError on non-ASCII
    except (UnicodeEncodeError, UnicodeDecodeError):
        continue
    for a in ANCHORS:
        if s == a or s.endswith(a):
            anchor_addrs.setdefault(a, []).append(data.getAddress())

print("")
print("--- Anchor strings located ---")
for a in ANCHORS:
    addrs = anchor_addrs.get(a, [])
    if addrs:
        print("  %-22s : %d hit(s) @ %s" % (a, len(addrs),
              ", ".join(str(x) for x in addrs)))
    else:
        print("  %-22s : NOT FOUND in defined data" % a)

# 2) collect xref-source functions
candidate_funcs = {}
for anchor, addrs in anchor_addrs.items():
    for a in addrs:
        for r in getReferencesTo(a):
            f = fm.getFunctionContaining(r.getFromAddress())
            if f is not None:
                candidate_funcs.setdefault(f, set()).add(anchor)

print("")
print("--- Functions that reference any anchor (level 0) ---")
for f, tags in sorted(candidate_funcs.items(), key=lambda kv: kv[0].getEntryPoint().getOffset()):
    print("  %s @ %s   anchors=%s" % (f.getName(), f.getEntryPoint(), sorted(tags)))

# 3) extend up one call-graph level
extended = dict(candidate_funcs)
for f in list(candidate_funcs.keys()):
    for caller in f.getCallingFunctions(monitor):
        extended.setdefault(caller, set()).add("(caller of %s)" % f.getName())

print("")
print("--- Plus their direct callers (level 1) ---  total=%d" % len(extended))
for f, tags in sorted(extended.items(), key=lambda kv: kv[0].getEntryPoint().getOffset()):
    print("  %s @ %s" % (f.getName(), f.getEntryPoint()))

# 4) decompile and print
print("")
print("=" * 70)
print("DECOMPILED CANDIDATES")
print("=" * 70)

decomp = DecompInterface()
opts = DecompileOptions()
decomp.setOptions(opts)
decomp.toggleCCode(True)
decomp.toggleSyntaxTree(True)
decomp.openProgram(currentProgram)

for f, tags in sorted(extended.items(), key=lambda kv: kv[0].getEntryPoint().getOffset()):
    name = f.getName()
    ep = f.getEntryPoint()
    print("")
    print("-" * 70)
    print("FUNCTION %s @ %s" % (name, ep))
    print("anchors: %s" % sorted(tags))
    print("body-size: %d bytes" % f.getBody().getNumAddresses())
    print("-" * 70)
    res = decomp.decompileFunction(f, 90, monitor)
    if res is None or not res.decompileCompleted():
        msg = res.getErrorMessage() if res is not None else "no result"
        print("(decompilation failed: %s)" % msg)
        continue
    c = res.getDecompiledFunction().getC()
    print(c)

print("")
print("=" * 70)
print("DONE -- search the output above for a for/while loop whose body")
print("calls SetFloat / SetValue with the BloomIteration handle. The")
print("upper bound is what we want.")
print("=" * 70)
