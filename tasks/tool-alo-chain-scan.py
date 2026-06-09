"""Scan extracted EaW/FoC .alo files for PARTICLE systems (top chunk 0x0900)
and report emitter spawn-link chains (a child emitter that itself has a child,
i.e. tree depth >= 3). Chunk format per src/ParticleSystem.cpp:
  chunk header: uint32 type, uint32 size (high bit set = container)
  emitter list: 0x0900 -> 0x0800 -> 0x0700 per emitter
  spawn links:  leaf chunk 0x0036 inside 0x0700, mini-chunks:
                0x37 = spawnOnDeath uint32, 0x39 = spawnDuringLife uint32,
                0xFFFFFFFF = none.
"""
import os, struct, sys

ROOT = r"C:\Modding\DATA"

def walk_children(buf, start, end):
    """Yield (type, payload_start, payload_end, is_container) for chunks in [start,end)."""
    pos = start
    while pos + 8 <= end:
        ctype, size = struct.unpack_from("<II", buf, pos)
        is_container = bool(size & 0x80000000)
        size &= 0x7FFFFFFF
        payload = pos + 8
        if payload + size > end:
            return  # malformed; stop
        yield ctype, payload, payload + size, is_container
        pos = payload + size

def parse_minis(buf, start, end):
    """Yield (mini_type, bytes) for mini-chunks (byte type, byte size)."""
    pos = start
    while pos + 2 <= end:
        mtype = buf[pos]; msize = buf[pos + 1]
        payload = pos + 2
        if payload + msize > end:
            return
        yield mtype, buf[payload:payload + msize]
        pos = payload + msize

def scan_particle(buf, p_start, p_end):
    """Return list of (death, life) per emitter, or None if no 0x0800 found."""
    emitters = []
    for ctype, cs, ce, cont in walk_children(buf, p_start, p_end):
        if ctype == 0x0800 and cont:
            for etype, es, ee, econt in walk_children(buf, cs, ce):
                if etype != 0x0700:
                    continue
                death = life = 0xFFFFFFFF
                for ftype, fs, fe, fcont in walk_children(buf, es, ee):
                    if ftype == 0x0036 and not fcont:
                        for mtype, mdata in parse_minis(buf, fs, fe):
                            if len(mdata) >= 4:
                                v = struct.unpack_from("<I", mdata)[0]
                                if mtype == 0x37: death = v
                                elif mtype == 0x39: life = v
                emitters.append((death, life))
    return emitters

def chains_in(emitters):
    """Depth>=3 chains: an emitter that is somebody's child AND has a child."""
    n = len(emitters)
    is_child = set()
    for d, l in emitters:
        if d != 0xFFFFFFFF and d < n: is_child.add(d)
        if l != 0xFFFFFFFF and l < n: is_child.add(l)
    out = []
    for i in (sorted(is_child)):
        d, l = emitters[i]
        kids = [v for v in (d, l) if v != 0xFFFFFFFF and v < n]
        if kids:
            out.append((i, kids))
    return out

total = particles = with_children = with_chains = 0
chain_files = []
max_depth_seen = 0

def depth_of(emitters):
    n = len(emitters)
    children = {}
    is_child = set()
    for i, (d, l) in enumerate(emitters):
        kids = [v for v in (d, l) if v != 0xFFFFFFFF and v < n]
        children[i] = kids
        is_child.update(kids)
    roots = [i for i in range(n) if i not in is_child]
    seen = set()
    def dive(i, depth):
        if i in seen:  # cycle guard
            return depth
        seen.add(i)
        return max([depth] + [dive(k, depth + 1) for k in children.get(i, [])])
    return max([0] + [dive(r, 1) for r in roots])

for dirpath, _, files in os.walk(ROOT):
    for f in files:
        if not f.lower().endswith(".alo"):
            continue
        total += 1
        path = os.path.join(dirpath, f)
        try:
            with open(path, "rb") as fh:
                buf = fh.read()
        except OSError:
            continue
        if len(buf) < 8:
            continue
        ctype, size = struct.unpack_from("<II", buf, 0)
        if ctype != 0x0900:
            continue  # not a particle file (models are 0x0200 etc.)
        particles += 1
        cont = bool(size & 0x80000000)
        end = min(8 + (size & 0x7FFFFFFF), len(buf))
        emitters = scan_particle(buf, 8, end)
        if not emitters:
            continue
        ch = chains_in(emitters)
        anykids = any(d != 0xFFFFFFFF or l != 0xFFFFFFFF for d, l in emitters)
        if anykids:
            with_children += 1
        if ch:
            with_chains += 1
            dep = depth_of(emitters)
            max_depth_seen = max(max_depth_seen, dep)
            chain_files.append((os.path.relpath(path, ROOT), len(emitters), dep, ch[:4]))

print(f"alo files scanned:        {total}")
print(f"particle files (0x0900):  {particles}")
print(f"  with any child links:   {with_children}")
print(f"  with CHAINS (depth>=3): {with_chains}")
print(f"  max tree depth seen:    {max_depth_seen}")
print()
for relpath, n, dep, ch in sorted(chain_files, key=lambda t: -t[2])[:25]:
    desc = ", ".join(f"emitter {i} -> children {k}" for i, k in ch)
    print(f"depth {dep}  {relpath}  ({n} emitters; {desc})")
