# -*- coding: utf-8 -*-
# Inspect DAT_140f09244 deeper:
#   - Read the raw initial bytes at that address (.data init value).
#   - Show the memory block / section it lives in (.data vs .bss).
#   - Search the entire program for byte sequences containing this address
#     (in case it's referenced by a dispatch table / XML-name map / RTTI).
#   - Decompile FUN_1400effc0 itself fully so we can see the loop bound site.
#
# @category Analysis
# @runtime Jython

from __future__ import print_function
from ghidra.app.decompiler import DecompInterface, DecompileOptions
from ghidra.util.task import ConsoleTaskMonitor
from ghidra.program.model.address import AddressSet
from ghidra.program.model.mem import MemoryAccessException
from jarray import array, zeros

TARGET = 0x140f09244

monitor = ConsoleTaskMonitor()
af = currentProgram.getAddressFactory()
mem = currentProgram.getMemory()
listing = currentProgram.getListing()
fm = currentProgram.getFunctionManager()

target_addr = af.getAddress("%x" % TARGET)
print("Target: %s" % target_addr)

block = mem.getBlock(target_addr)
print("Memory block: name=%s  start=%s  end=%s  perms=r%s/w%s/x%s  initialized=%s" % (
    block.getName(), block.getStart(), block.getEnd(),
    "1" if block.isRead() else "0",
    "1" if block.isWrite() else "0",
    "1" if block.isExecute() else "0",
    block.isInitialized()))

# Read 16 bytes at target -- the int32 default lives at +0
print("")
print("--- Initial value at %s ---" % target_addr)
try:
    val_i32 = mem.getInt(target_addr)
    print("  int32  : 0x%08x  (decimal %d)" % (val_i32 & 0xffffffff, val_i32))
    bytes_str = " ".join("%02x" % (mem.getByte(target_addr.add(i)) & 0xff) for i in range(16))
    print("  bytes  : %s" % bytes_str)
except MemoryAccessException as e:
    print("  (uninitialized -- treated as zero)")
    val_i32 = 0

# Search the entire program for any byte sequence matching the QWORD form of
# this address (Ghidra-internal representation for absolute pointers).
def to_java_bytes(int_list):
    # Java byte is signed; convert 0-255 to -128..127 for jarray
    return array([((b + 128) & 0xff) - 128 for b in int_list], 'b')

def search_pattern(pat_ints, label):
    print("")
    print("--- Searching for %s ---" % label)
    print("  pattern: %s" % " ".join("%02x" % b for b in pat_ints))
    jb = to_java_bytes(pat_ints)
    hits = []
    end_a = mem.getMaxAddress()
    cur = mem.getMinAddress()
    while True:
        match_addr = mem.findBytes(cur, jb, None, True, monitor)
        if match_addr is None: break
        blk = mem.getBlock(match_addr)
        bn = blk.getName() if blk else "?"
        func = fm.getFunctionContaining(match_addr)
        fn = (func.getName() + " @ " + str(func.getEntryPoint())) if func else ""
        print("  hit @ %s  block=%s  %s" % (match_addr, bn, fn))
        hits.append(match_addr)
        if len(hits) > 50: print("  (stopping at 50)"); break
        cur = match_addr.add(1)
        if cur.compareTo(end_a) > 0: break
    return hits

qword_le = []
v = TARGET
for i in range(8):
    qword_le.append(v & 0xff); v >>= 8
dword_le = qword_le[:4]

search_pattern(qword_le, "QWORD LE absolute (8 bytes)")
search_pattern(dword_le, "DWORD LE low 32 bits (4 bytes)")

# Decompile the bloom render function once more for completeness
print("")
print("=" * 70)
print("FUN_1400effc0 (bloom render) full decompile")
print("=" * 70)
decomp = DecompInterface()
decomp.setOptions(DecompileOptions())
decomp.toggleCCode(True)
decomp.openProgram(currentProgram)
f = fm.getFunctionAt(af.getAddress("1400effc0"))
res = decomp.decompileFunction(f, 90, monitor)
if res and res.decompileCompleted():
    print(res.getDecompiledFunction().getC())
else:
    print("(decompile failed)")
