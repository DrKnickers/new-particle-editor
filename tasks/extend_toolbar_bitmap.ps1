# Extend src/Resources/toolbar2.bmp from 5 icons (80x15) to 7 icons (112x15).
# Adds up-arrow (icon 5) and down-arrow (icon 6) glyphs.
#
# Format: 4bpp paletted BMP. Palette index 6 = RGB(0,128,128) = chroma key
# matched by ImageList_AddMasked. Palette index 0 = black = arrow color.
#
# Bitmap rows are stored bottom-up (row 14 = top of image stored last).
# 4bpp packs 2 pixels per byte (high nibble = first pixel).

$ErrorActionPreference = 'Stop'

$src = "src\Resources\toolbar2.bmp"
$old = [IO.File]::ReadAllBytes($src)

$oldPixOff = [BitConverter]::ToInt32($old, 10)
$oldW = 80
$oldH = 15
$oldRowBytes = 40   # 80 px / 2 pixels per byte = 40
$newW = 112
$newRowBytes = 56   # 112 / 2 = 56, already 4-aligned
$newH = 15

# Up-arrow rows in display order (top → bottom). '0' = black (palette 0),
# '6' = chroma key (palette 6). Each string is exactly 16 chars (= 16 px).
$upRows = @(
    "6666666666666666",  # row  0 (top)
    "6666666006666666",  # row  1
    "6666660000666666",  # row  2
    "6666600000066666",  # row  3
    "6666000000006666",  # row  4
    "6660000000000666",  # row  5
    "6600000000000066",  # row  6
    "6666660000666666",  # row  7  (stem)
    "6666660000666666",  # row  8
    "6666660000666666",  # row  9
    "6666660000666666",  # row 10
    "6666660000666666",  # row 11
    "6666660000666666",  # row 12
    "6666666666666666",  # row 13
    "6666666666666666"   # row 14 (bottom)
)

$downRows = @(
    "6666666666666666",  # row  0 (top)
    "6666666666666666",  # row  1
    "6666660000666666",  # row  2  (stem)
    "6666660000666666",  # row  3
    "6666660000666666",  # row  4
    "6666660000666666",  # row  5
    "6666660000666666",  # row  6
    "6666660000666666",  # row  7
    "6600000000000066",  # row  8
    "6660000000000666",  # row  9
    "6666000000006666",  # row 10
    "6666600000066666",  # row 11
    "6666660000666666",  # row 12
    "6666666006666666",  # row 13
    "6666666666666666"   # row 14 (bottom)
)

function Pack-Row($rowStr) {
    if ($rowStr.Length -ne 16) { throw "row string must be 16 chars" }
    $out = New-Object byte[] 8
    for ($i = 0; $i -lt 8; $i++) {
        $hi = [int][string]$rowStr[$i*2]
        $lo = [int][string]$rowStr[$i*2 + 1]
        $out[$i] = ($hi -shl 4) -bor $lo
    }
    return ,$out
}

# Build the new file.
$new = New-Object byte[] (14 + 40 + 64 + ($newRowBytes * $newH))

# File header (14 bytes).
[Array]::Copy($old, 0, $new, 0, 14)
# Update file size at offset 2.
[BitConverter]::GetBytes([uint32]$new.Length).CopyTo($new, 2)
# Pixel data offset stays 0x76 (118). Already correct from Copy above.

# Info header (40 bytes).
[Array]::Copy($old, 14, $new, 14, 40)
# Update Width at offset 18.
[BitConverter]::GetBytes([int32]$newW).CopyTo($new, 18)
# Height at offset 22 stays 15.
# BiSizeImage at offset 34 — set to new pixel data size (or 0 is also legal).
[BitConverter]::GetBytes([uint32]($newRowBytes * $newH)).CopyTo($new, 34)

# Palette (64 bytes = 16 colors × 4 bytes BGRA). Copy verbatim.
[Array]::Copy($old, 14 + 40, $new, 14 + 40, 64)

# Pixel data: for each of 15 rows, copy the old 40 bytes then append 8 bytes
# for up-arrow + 8 bytes for down-arrow.
for ($storageRow = 0; $storageRow -lt $newH; $storageRow++) {
    $srcRowOff = $oldPixOff + $storageRow * $oldRowBytes
    $dstRowOff = 118 + $storageRow * $newRowBytes
    [Array]::Copy($old, $srcRowOff, $new, $dstRowOff, $oldRowBytes)

    # Display row index: storage is bottom-up, so display row = 14 - storage.
    $displayRow = $newH - 1 - $storageRow

    $upBytes   = Pack-Row $upRows[$displayRow]
    $downBytes = Pack-Row $downRows[$displayRow]

    [Array]::Copy($upBytes,   0, $new, $dstRowOff + $oldRowBytes,     8)
    [Array]::Copy($downBytes, 0, $new, $dstRowOff + $oldRowBytes + 8, 8)
}

[IO.File]::WriteAllBytes($src, $new)
Write-Host "Wrote ${src}: ${($new.Length)} bytes (was $($old.Length))"
