# Extend src/Resources/toolbar1.bmp from 7 icons (112x16) to 8 icons
# (128x16). Adds a Bloom-toggle glyph in cell 7 (zero-based) — a small
# sunburst (filled 6x4 disk with 8 single-pixel rays radiating out).
#
# Format: 4bpp paletted BMP. Palette index 6 = RGB(0,128,128) = chroma
# key matched by ImageList_AddMasked. Palette index 0 = black = foreground.
#
# Bitmap rows are stored bottom-up (last storage row = top of image).
# 4bpp packs 2 pixels per byte (high nibble = first pixel).
#
# Mirrors tasks/extend_toolbar1_bmp.ps1 which did 5->7 (Undo/Redo) and
# tasks/extend_toolbar_bitmap.ps1 which did toolbar2.bmp Move Up/Down.

$ErrorActionPreference = 'Stop'

$src = "src\Resources\toolbar1.bmp"
$old = [IO.File]::ReadAllBytes($src)

$oldPixOff = [BitConverter]::ToInt32($old, 10)
$oldW = 112
$oldH = 16
$oldRowBytes = 56   # 112 / 2 = 56, already 4-aligned
$newW = 128
$newRowBytes = 64   # 128 / 2 = 64, already 4-aligned
$newH = 16

# Display order top -> bottom. '0' = black foreground, '6' = chroma key.
# Each row is exactly 16 chars (= 16 px).
#
# Sunburst: 6x4 central "disk" surrounded by 8 single-pixel rays
# (N, S, E, W full-width; NW, NE, SW, SE diagonal three-pixel rays).
$bloomRows = @(
    "6666666666666666",  # 0
    "6666666006666666",  # 1  - N ray cap
    "6066666006666606",  # 2  - N + NW/NE outer
    "6606666006666066",  # 3  - N + NW/NE
    "6660666666660666",  # 4  - NW/NE
    "6666066666606666",  # 5  - NW/NE inner
    "6666600000066666",  # 6  - disk top
    "0000600000060000",  # 7  - W ray + disk row + E ray
    "0000600000060000",  # 8  - W ray + disk row + E ray
    "6666600000066666",  # 9  - disk bottom
    "6666066666606666",  # 10 - SW/SE inner
    "6660666666660666",  # 11 - SW/SE
    "6606666006666066",  # 12 - S + SW/SE
    "6066666006666606",  # 13 - S + SW/SE outer
    "6666666006666666",  # 14 - S ray cap
    "6666666666666666"   # 15
)

# Sanity check.
foreach ($r in $bloomRows) {
    if ($r.Length -ne 16) { throw "row '$r' is not 16 chars" }
}
if ($bloomRows.Count -ne $newH) { throw "expected $newH rows, got $($bloomRows.Count)" }

function Pack-Row($rowStr) {
    $out = New-Object byte[] 8
    for ($i = 0; $i -lt 8; $i++) {
        $hi = [int][string]$rowStr[$i*2]
        $lo = [int][string]$rowStr[$i*2 + 1]
        $out[$i] = ($hi -shl 4) -bor $lo
    }
    return ,$out
}

# Build the new file: 14-byte file header + 40-byte info header
# + 64-byte palette + pixel data.
$pixDataSize = $newRowBytes * $newH
$new = New-Object byte[] (14 + 40 + 64 + $pixDataSize)

# File header.
[Array]::Copy($old, 0, $new, 0, 14)
[BitConverter]::GetBytes([uint32]$new.Length).CopyTo($new, 2)
# Pixel data offset (118) is unchanged.

# Info header.
[Array]::Copy($old, 14, $new, 14, 40)
[BitConverter]::GetBytes([int32]$newW).CopyTo($new, 18)
# Height stays 16.
[BitConverter]::GetBytes([uint32]$pixDataSize).CopyTo($new, 34)

# Palette (16 colors x 4 bytes BGRA).
[Array]::Copy($old, 14 + 40, $new, 14 + 40, 64)

# Pixel data: copy each row's existing 56 bytes, then append 8 bytes
# for the bloom icon cell.
for ($storageRow = 0; $storageRow -lt $newH; $storageRow++) {
    $srcRowOff = $oldPixOff + $storageRow * $oldRowBytes
    $dstRowOff = 118 + $storageRow * $newRowBytes
    [Array]::Copy($old, $srcRowOff, $new, $dstRowOff, $oldRowBytes)

    $displayRow = $newH - 1 - $storageRow
    $bloomBytes = Pack-Row $bloomRows[$displayRow]

    [Array]::Copy($bloomBytes, 0, $new, $dstRowOff + $oldRowBytes, 8)
}

[IO.File]::WriteAllBytes($src, $new)
Write-Host "Wrote ${src}: $($new.Length) bytes (was $($old.Length))"
