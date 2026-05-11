# -*- coding: utf-8 -*-
# Build a "dual-0x39" .alo fixture from an existing well-formed particle file.
#
# Takes a source .alo with one parent emitter + one life-child + one death-child,
# and patches the parent emitter's chunk-0x36 spawn-link block to contain TWO
# 0x39 mini-chunks instead of one. The two life-child indices point at the
# original life-child and at the death-child respectively, so the runtime
# difference between "list-append", "last-wins" and "hard-fail" is visually
# obvious when loaded:
#
#   - list-append: both child emitters fire on the parent's lifetime
#   - last-wins:   only one (whichever comes second in the file) fires
#   - hard-fail:   the file refuses to load
#
# Wire format reminders (see src/ChunkFile.h):
#   - Big chunk header: u32 type, u32 size. High bit of size set => data chunk
#     (leaf, contains mini-chunks or raw bytes). High bit clear => container.
#   - Mini-chunk header: u8 type, u8 size. Mini-chunks live inside data chunks.
#
# Particle-system file structure (see src/ParticleSystem.cpp:644 onward):
#   0x0900 (container)
#     0x0000 name
#     0x0001 ignored u32
#     0x0800 (container of emitters)
#       0x0700 (container, one per emitter)
#         0x0002 properties (mini-chunks)
#         0x0003 colorTexture
#         0x0016 name
#         0x0029 groups
#         0x0001 tracks
#         0x0036 (data chunk, mini-chunks)
#           0x37 u32 spawnOnDeath
#           0x39 u32 spawnDuringLife
#         0x0045 normalTexture (optional)
#     0x0002 leaveParticles
#
# Usage:
#   python build_dual_life_fixture.py <input.alo> <output.alo>
#
# Modifies the FIRST emitter found that has a 0x36 block; duplicates its
# spawnDuringLife mini-chunk so the file has two of them. Recomputes the
# size of the 0x36 chunk and every ancestor container chunk's size on the
# way up so the file remains parseable by the editor's own chunk reader.

import sys, struct

CHUNK_HDR = struct.Struct("<II")  # type, size
SIZE_FLAG_DATA = 0x80000000


def find_first_0x36(data):
    """Walk the chunk tree and return (offset_of_0x36_hdr, offset_after_data).
    Also returns the chain of ancestor (hdr_offset, hdr_size_field_offset)
    so the caller can patch sizes on the way back up.
    """
    ancestors = []  # list of (hdr_off, end_off) for containers we're inside
    off = 0
    end = len(data)

    def walk(start, finish, path):
        cur = start
        while cur < finish:
            t, sz = CHUNK_HDR.unpack_from(data, cur)
            is_data = bool(sz & SIZE_FLAG_DATA)
            payload_size = sz & ~SIZE_FLAG_DATA
            payload = cur + CHUNK_HDR.size
            after = payload + payload_size
            if t == 0x36 and is_data:
                return cur, after, list(path)
            if not is_data:
                # container -- descend
                res = walk(payload, after, path + [cur])
                if res is not None:
                    return res
            cur = after
        return None

    return walk(0, end, [])


def main():
    if len(sys.argv) != 3:
        sys.stderr.write("usage: %s <input.alo> <output.alo>\n" % sys.argv[0])
        sys.exit(2)
    inp, outp = sys.argv[1], sys.argv[2]

    with open(inp, "rb") as f:
        buf = bytearray(f.read())

    res = find_first_0x36(buf)
    if res is None:
        sys.stderr.write("error: no 0x36 chunk found in %s\n" % inp)
        sys.exit(1)
    hdr_off, after_off, ancestors = res

    # Sanity-check existing mini-chunks: expect 0x37/u32, 0x39/u32, total 12 bytes
    payload_off = hdr_off + CHUNK_HDR.size
    if after_off - payload_off != 12:
        sys.stderr.write("error: 0x36 payload is %d bytes, expected 12\n" %
                         (after_off - payload_off))
        sys.exit(1)
    if buf[payload_off]   != 0x37 or buf[payload_off+1]   != 4:
        sys.stderr.write("error: first mini-chunk is not 0x37/4\n")
        sys.exit(1)
    if buf[payload_off+6] != 0x39 or buf[payload_off+7]   != 4:
        sys.stderr.write("error: second mini-chunk is not 0x39/4\n")
        sys.exit(1)

    death_idx, = struct.unpack_from("<I", buf, payload_off + 2)
    life_idx,  = struct.unpack_from("<I", buf, payload_off + 8)
    print("found 0x36 at offset 0x%x" % hdr_off)
    print("  spawnOnDeath    = 0x%08x" % death_idx)
    print("  spawnDuringLife = 0x%08x" % life_idx)

    if death_idx == 0xFFFFFFFF:
        sys.stderr.write("error: source needs a death-child for the dual-life "
                         "swap to point at something distinct\n")
        sys.exit(1)
    if life_idx == 0xFFFFFFFF:
        sys.stderr.write("error: source needs a life-child to duplicate\n")
        sys.exit(1)

    # Build the new 0x36 payload: 0x37=DEATH, 0x39=LIFE (original), 0x39=DEATH
    # (second life slot points at the death-child's index, so both render
    # distinguishably). The death slot we set to 0xFFFFFFFF (sentinel) so the
    # parent has no death-child in the new file -- the death-child emitter
    # becomes the second life-child via the extra 0x39.
    new_payload = (
        bytes([0x37, 4]) + struct.pack("<I", 0xFFFFFFFF) +
        bytes([0x39, 4]) + struct.pack("<I", life_idx)   +
        bytes([0x39, 4]) + struct.pack("<I", death_idx)
    )
    assert len(new_payload) == 18  # 3 mini-chunks * (2 hdr + 4 data)

    old_payload_len = 12
    new_payload_len = 18
    delta = new_payload_len - old_payload_len

    # Patch in the new payload bytes (grow the buffer by `delta`)
    buf[payload_off:after_off] = new_payload

    # Update 0x36 chunk header's size field (keep the data flag set)
    new_36_size = new_payload_len | SIZE_FLAG_DATA
    struct.pack_into("<I", buf, hdr_off + 4, new_36_size)

    # Update every ancestor container's size field by +delta
    for anc_hdr_off in ancestors:
        anc_t, anc_sz = CHUNK_HDR.unpack_from(buf, anc_hdr_off)
        # Ancestor is a container, so the size flag must NOT be set
        assert not (anc_sz & SIZE_FLAG_DATA), \
            "ancestor 0x%x at offset 0x%x has data flag" % (anc_t, anc_hdr_off)
        struct.pack_into("<I", buf, anc_hdr_off + 4, anc_sz + delta)

    with open(outp, "wb") as f:
        f.write(buf)
    print("wrote %s (%d bytes; +%d vs input)" % (outp, len(buf), delta))


if __name__ == "__main__":
    main()
