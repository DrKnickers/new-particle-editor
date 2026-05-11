# Extend src/Resources/toolbar1.bmp from 9 icons (144x16) to 11 icons
# (176x16). Adds two glyphs:
#   - cell 9  = "step 1 frame":  single right-pointing triangle + bar
#   - cell 10 = "step 10 frames": two right-pointing triangles + bar
#
# Format: 4bpp paletted BMP. Palette index 6 = RGB(0,128,128) = chroma
# key matched by ImageList_AddMasked. Palette index 0 = black = foreground.
#
# Bitmap rows are stored bottom-up (last storage row = top of image).
# 4bpp packs 2 pixels per byte (high nibble = first pixel).
#
# Mirrors tasks/extend_toolbar1_bmp.ps1 (5->7 Undo/Redo),
# tasks/extend_toolbar1_bmp_bloom.ps1 (7->8 Bloom), and
# tasks/extend_toolbar1_bmp_pause.ps1 (8->9 Pause).

$ErrorActionPreference = 'Stop'

$src = "src\Resources\toolbar1.bmp"
$old = [IO.File]::ReadAllBytes($src)

$oldPixOff = [BitConverter]::ToInt32($old, 10)
$oldW = 144
$oldH = 16
$oldRowBytes = 72   # 144 / 2 = 72, already 4-aligned
$newW = 176
$newRowBytes = 88   # 176 / 2 = 88, already 4-aligned
$newH = 16

# Display order top -> bottom. '0' = black foreground, '6' = chroma key.
# Each row is exactly 16 chars (= 16 px).
#
# Step 1: one triangle (cols 3-7, widening rows 3-7, narrowing rows 8-12)
#         + vertical bar at col 9, rows 3-12.
$step1Rows = @(
    "6666666666666666",  # 0
    "6666666666666666",  # 1
    "6666666666666666",  # 2
    "6660666660666666",  # 3  - triangle col 3 + bar col 9
    "6660066660666666",  # 4
    "6660006660666666",  # 5
    "6660000660666666",  # 6
    "6660000060666666",  # 7  - widest
    "6660000060666666",  # 8  - widest
    "6660000660666666",  # 9
    "6660006660666666",  # 10
    "6660066660666666",  # 11
    "6660666660666666",  # 12
    "6666666666666666",  # 13
    "6666666666666666",  # 14
    "6666666666666666"   # 15
)

# Step 10: two triangles separated by a 1-px gap, plus bar at col 13.
#   T1 at cols 1-5, gap at col 6, T2 at cols 7-11, gap at col 12, bar col 13.
$step10Rows = @(
    "6666666666666666",  # 0
    "6666666666666666",  # 1
    "6666666666666666",  # 2
    "6066666066666066",  # 3  - row-3 cols of each triangle, plus bar
    "6006666006666066",  # 4
    "6000666000666066",  # 5
    "6000066000066066",  # 6
    "6000006000006066",  # 7  - widest
    "6000006000006066",  # 8  - widest
    "6000066000066066",  # 9
    "6000666000666066",  # 10
    "6006666006666066",  # 11
    "6066666066666066",  # 12
    "6666666666666666",  # 13
    "6666666666666666",  # 14
    "6666666666666666"   # 15
)

# Sanity check.
foreach ($r in $step1Rows + $step10Rows) {
    if ($r.Length -ne 16) { throw "row '$r' is not 16 chars" }
}
if ($step1Rows.Count -ne $newH)  { throw "step1: expected $newH rows" }
if ($step10Rows.Count -ne $newH) { throw "step10: expected $newH rows" }

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

# Pixel data: copy each row's existing 72 bytes, then append 8 bytes
# for step1 (cell 9) and 8 bytes for step10 (cell 10).
for ($storageRow = 0; $storageRow -lt $newH; $storageRow++) {
    $srcRowOff = $oldPixOff + $storageRow * $oldRowBytes
    $dstRowOff = 118 + $storageRow * $newRowBytes
    [Array]::Copy($old, $srcRowOff, $new, $dstRowOff, $oldRowBytes)

    $displayRow = $newH - 1 - $storageRow
    $step1Bytes  = Pack-Row $step1Rows[$displayRow]
    $step10Bytes = Pack-Row $step10Rows[$displayRow]

    [Array]::Copy($step1Bytes,  0, $new, $dstRowOff + $oldRowBytes,     8)
    [Array]::Copy($step10Bytes, 0, $new, $dstRowOff + $oldRowBytes + 8, 8)
}

[IO.File]::WriteAllBytes($src, $new)
Write-Host "Wrote ${src}: $($new.Length) bytes (was $($old.Length))"
