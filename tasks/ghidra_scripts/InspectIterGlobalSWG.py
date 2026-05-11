# -*- coding: utf-8 -*-
# StarWarsG.exe variant of InspectIterGlobal.py.
# Target global is at a different address in this binary because it's a
# different PE; the loop structure of FUN_140183a30 is byte-identical to
# FUN_1400effc0 in EAW Terrain Editor.exe.
#
# @category Analysis
# @runtime Jython

from __future__ import print_function
from ghidra.app.decompiler import DecompInterface, DecompileOptions
from ghidra.util.task import ConsoleTaskMonitor
from ghidra.program.model.mem import MemoryAccessException
from jarray import array

TARGET = 0x140a129f4

monitor = ConsoleTaskMonitor()
af = currentProgram.getAddressFactory()
mem = currentProgram.getMemory()
fm = currentProgram.getFunctionManager()

target_addr = af.getAddress("%x" % TARGET)
print("Program: %s" % currentProgram.getName())
print("Target : %s" % target_addr)

block = mem.getBlock(target_addr)
print("Block  : name=%s  initialized=%s" % (block.getName(), block.isInitialized()))

print("")
print("--- Initial value ---")
try:
    val_i32 = mem.getInt(target_addr)
    print("  int32 : 0x%08x  (decimal %d)" % (val_i32 & 0xffffffff, val_i32))
    bytes_str = " ".join("%02x" % (mem.getByte(target_addr.add(i)) & 0xff) for i in range(8))
    print("  bytes : %s" % bytes_str)
except MemoryAccessException:
    print("  (uninitialized)")

# Confirm zero writers as we did for the Terrain Editor
writes = []
reads = []
for r in getReferencesTo(target_addr):
    if r.getReferenceType().isWrite():
        writes.append(r)
    elif r.getReferenceType().isRead():
        reads.append(r)
print("")
print("Writers via xref : %d" % len(writes))
print("Readers via xref : %d" % len(reads))
for r in reads:
    a = r.getFromAddress()
    f = fm.getFunctionContaining(a)
    fn = (f.getName() + " @ " + str(f.getEntryPoint())) if f else ""
    print("  READ %s  in %s" % (a, fn))
