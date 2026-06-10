"""Inspect + patch P_CONCUSSION.ALO to chain its emitters (depth test for
children-of-children in the real game). Patches ONLY the 4-byte uint32 values
inside each emitter's 0x0036 chunk minis (0x37 = spawnOnDeath, 0x39 =
spawnDuringLife) — no chunk resizing, byte-count identical, git-restorable.

Usage:
  python tool-alo-chain-patch.py <path>           # inspect only
  python tool-alo-chain-patch.py <path> --patch   # chain 0->1->2->... via life slot

WARNING: --patch writes a FULL all-emitter chain (the confounded v1 test
design -- a combinatorial particle bomb on multi-emitter files). The selective
v2 layout in tasks/next-emitter-chain-investigation.md was applied with
manual struct.pack_into edits using this tool's inspect offsets; do NOT
re-run --patch to re-plant it.
"""
import struct, sys

def walk_children(buf, start, end):
    pos = start
    while pos + 8 <= end:
        ctype, size = struct.unpack_from("<II", buf, pos)
        cont = bool(size & 0x80000000)
        size &= 0x7FFFFFFF
        payload = pos + 8
        if payload + size > end:
            return
        yield ctype, payload, payload + size, cont
        pos = payload + size

def parse_minis_with_offsets(buf, start, end):
    pos = start
    while pos + 2 <= end:
        mtype = buf[pos]; msize = buf[pos + 1]
        payload = pos + 2
        if payload + msize > end:
            return
        yield mtype, payload, msize
        pos = payload + msize

def read_string_chunk(buf, s, e):
    # Alamo strings: null-terminated ASCII (sometimes UTF-16 for some chunks,
    # but emitter name/texture are ASCII in this format per the editor source).
    raw = buf[s:e]
    return raw.split(b"\x00")[0].decode("ascii", "replace")

def inspect(buf):
    ctype, size = struct.unpack_from("<II", buf, 0)
    assert ctype == 0x0900, f"not a particle file (top chunk {ctype:#x})"
    end = min(8 + (size & 0x7FFFFFFF), len(buf))
    emitters = []  # dicts: name, tex, death, life, off37, off39
    for t, s, e, c in walk_children(buf, 8, end):
        if t != 0x0800 or not c:
            continue
        for et, es, ee, ec in walk_children(buf, s, e):
            if et != 0x0700:
                continue
            info = {"name": "?", "tex": "?", "death": None, "life": None,
                    "off37": None, "off39": None}
            for ft, fs, fe, fc in walk_children(buf, es, ee):
                if ft == 0x0016:
                    info["name"] = read_string_chunk(buf, fs, fe)
                elif ft == 0x0003:
                    info["tex"] = read_string_chunk(buf, fs, fe)
                elif ft == 0x0036 and not fc:
                    for mt, moff, msz in parse_minis_with_offsets(buf, fs, fe):
                        if msz >= 4:
                            v = struct.unpack_from("<I", buf, moff)[0]
                            if mt == 0x37:
                                info["death"], info["off37"] = v, moff
                            elif mt == 0x39:
                                info["life"], info["off39"] = v, moff
            emitters.append(info)
    return emitters

def show(emitters, title):
    print(f"--- {title} ---")
    none = 0xFFFFFFFF
    for i, em in enumerate(emitters):
        d = "-" if em["death"] in (None, none) else str(em["death"])
        l = "-" if em["life"] in (None, none) else str(em["life"])
        print(f"  [{i}] {em['name']!r:28s} tex={em['tex']!r:26s} death->{d:3s} life->{l}")

def main():
    path = sys.argv[1]
    do_patch = "--patch" in sys.argv
    buf = bytearray(open(path, "rb").read())
    emitters = inspect(buf)
    show(emitters, "current")
    if not do_patch:
        return
    n = len(emitters)
    assert n >= 3, "need >= 3 emitters for a depth>=3 chain"
    for i, em in enumerate(emitters):
        assert em["off37"] is not None and em["off39"] is not None, \
            f"emitter {i} has no physical 0x36 chunk; in-place patch impossible"
    # Chain via the LIFE slot: 0 -> 1 -> 2 -> ... -> n-1; clear all death links.
    for i, em in enumerate(emitters):
        struct.pack_into("<I", buf, em["off37"], 0xFFFFFFFF)
        struct.pack_into("<I", buf, em["off39"], i + 1 if i + 1 < n else 0xFFFFFFFF)
    open(path, "wb").write(buf)
    print(f"\npatched ({len(buf)} bytes, size unchanged)")
    show(inspect(bytes(buf)), "after patch")

if __name__ == "__main__":
    main()
