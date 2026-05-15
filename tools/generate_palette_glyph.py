"""Generate a 16x16 24-bit BMP icon of a painter's palette for the Texture
Palette button on the Appearance tab.

Why this lives in tools/ as a regenerable script rather than a checked-in
binary the user authored by hand: the icon is small, deterministic, and
cheap to regenerate; if the design ever needs tweaking, it's one diff to
this script. The output BMP is committed to src/Resources/.

Background colour is COLOR_BTNFACE (RGB 240,240,240) so the icon blends
seamlessly with the default Win32 button face. A magenta colour-key would
also work but adds the LoadImage(LR_LOADTRANSPARENT) round-trip; matching
the button face is simpler.

Run: python tools/generate_palette_glyph.py
Writes: src/Resources/palette_glyph.bmp
"""

import struct
from pathlib import Path

# Colour palette (BGR for BMP)
BG = (240, 240, 240)   # COLOR_BTNFACE — invisible against button background
OUTLINE = (40, 65, 100)   # dark brown palette outline (BGR)
BODY = (130, 180, 220)    # warm tan palette body (BGR)
THUMB = (240, 240, 240)   # thumb hole — same as background
RED = (40, 40, 215)
GRN = (70, 175, 60)
BLU = (220, 110, 50)
YEL = (60, 220, 235)

# 16x16 grid, top row first (we'll flip when writing).
# Characters:
#   .  background
#   T  outline
#   t  body (tan)
#   h  thumb hole (background-coloured, inside the body)
#   R G B Y  paint blobs
PIXELS = [
    "................",
    ".....TTTTTT.....",
    "...TTttttttTT...",
    "..TtttRRttGGttT.",
    "..TtttRRttGGtTT.",
    ".TttttttttttttT.",
    ".TtBBttttttYYttT",
    ".TtBBttthhtYYttT",
    ".Ttttttthhttttth",
    ".Ttttttttttttth.",
    "..TtttttttttthT.",
    "..TTttttttttth..",
    "...TTttttttth...",
    ".....TTTTThh....",
    "................",
    "................",
]

CHAR_TO_BGR = {
    ".": BG,
    "T": OUTLINE,
    "t": BODY,
    "h": THUMB,
    "R": RED,
    "G": GRN,
    "B": BLU,
    "Y": YEL,
}


def encode_bmp(pixels_top_first):
    width = 16
    height = 16
    # 24-bit: 3 bytes per pixel. Row stride padded to 4 bytes.
    # 16 * 3 = 48 — already aligned, no padding needed.
    row_bytes = width * 3
    pixel_data_size = row_bytes * height

    # BMP rows are stored bottom-up.
    rows_bottom_first = list(reversed(pixels_top_first))
    pixel_bytes = bytearray()
    for row in rows_bottom_first:
        for ch in row:
            b, g, r = CHAR_TO_BGR[ch]
            pixel_bytes.extend((b, g, r))
    assert len(pixel_bytes) == pixel_data_size

    file_header_size = 14
    info_header_size = 40
    pixel_offset = file_header_size + info_header_size
    file_size = pixel_offset + pixel_data_size

    # BITMAPFILEHEADER
    file_header = struct.pack(
        "<2sIHHI",
        b"BM",          # signature
        file_size,
        0, 0,           # reserved
        pixel_offset,
    )
    # BITMAPINFOHEADER (40 bytes)
    info_header = struct.pack(
        "<IiiHHIIiiII",
        info_header_size,
        width,
        height,         # positive — bottom-up
        1,              # planes
        24,             # bits per pixel
        0,              # BI_RGB
        pixel_data_size,
        2835, 2835,     # 72 DPI in pixels-per-metre
        0, 0,
    )
    return file_header + info_header + bytes(pixel_bytes)


def main():
    out = Path(__file__).resolve().parent.parent / "src" / "Resources" / "palette_glyph.bmp"
    out.write_bytes(encode_bmp(PIXELS))
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
