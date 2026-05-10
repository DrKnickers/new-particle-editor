# Extend src/Resources/toolbar1.bmp from 5 icons (80x16) to 7 icons
# (112x16). Adds Undo (icon 5) and Redo (icon 6) glyphs.
#
# Format: 4bpp paletted BMP. Palette index 6 = RGB(0,128,128) = chroma
# key matched by ImageList_AddMasked. Palette index 0 = black = foreground.
#
# Bitmap rows are stored bottom-up (last storage row = top of image).
# 4bpp packs 2 pixels per byte (high nibble = first pixel).
#
# Mirrors the pattern of tasks/extend_toolbar_bitmap.ps1, which extended
# toolbar2.bmp for Move Up / Move Down.

$ErrorActionPreference = 'Stop'

$src = "src\Resources\toolbar1.bmp"
$old = [IO.File]::ReadAllBytes($src)

$oldPixOff = [BitConverter]::ToInt32($old, 10)
$oldW = 80
$oldH = 16
$oldRowBytes = 40   # 80 / 2 = 40
$newW = 112
$newRowBytes = 56   # 112 / 2 = 56, already 4-aligned
$newH = 16

# Display order top -> bottom. '0' = black foreground, '6' = chroma key.
# Each row is exactly 16 chars (= 16 px).
#
# Undo: horizontal arrow pointing left at row 8, with a vertical "tail"
# at column 10 rising from row 8 up to row 3. Reads as "go back-and-up".
$undoRows = @(
    "6666666666666666",  # 0
    "6666666666666666",  # 1
    "6666666666666666",  # 2
    "6666666666060666",  # 3  - top of vertical tail
    "6666666666060666",  # 4
    "6660666666060666",  # 5  - upper arrowhead diag
    "6606666666060666",  # 6
    "6066666666060666",  # 7
    "0000000000060666",  # 8  - arrowhead tip + horizontal shaft
    "6066666666666666",  # 9
    "6606666666666666",  # 10 - lower arrowhead diag
    "6660666666666666",  # 11
    "6666666666666666",  # 12
    "6666666666666666",  # 13
    "6666666666666666",  # 14
    "6666666666666666"   # 15
)

# Redo: horizontal mirror of undo.
$redoRows = @(
    "6666666666666666",  # 0
    "6666666666666666",  # 1
    "6666666666666666",  # 2
    "6660606666666666",  # 3
    "6660606666666666",  # 4
    "6660606666666666",  # 5
    "6660606666666666",  # 6
    "6660606666666666",  # 7
    "6660600000000000",  # 8
    "6666666666666660",  # 9
    "6666666666666606",  # 10
    "6666666666666066",  # 11
    "6666666666666666",  # 12
    "6666666666666666",  # 13
    "6666666666666666",  # 14
    "6666666666666666"   # 15
)

# Sanity check.
foreach ($r in $undoRows + $redoRows) {
    if ($r.Length -ne 16) { throw "row '$r' is not 16 chars" }
}
if ($undoRows.Count -ne $newH) { throw "undo: expected $newH rows, got $($undoRows.Count)" }
if ($redoRows.Count -ne $newH) { throw "redo: expected $newH rows, got $($redoRows.Count)" }

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

# Pixel data: copy each row's existing 40 bytes, then append 8 bytes
# Undo row + 8 bytes Redo row.
for ($storageRow = 0; $storageRow -lt $newH; $storageRow++) {
    $srcRowOff = $oldPixOff + $storageRow * $oldRowBytes
    $dstRowOff = 118 + $storageRow * $newRowBytes
    [Array]::Copy($old, $srcRowOff, $new, $dstRowOff, $oldRowBytes)

    $displayRow = $newH - 1 - $storageRow
    $undoBytes = Pack-Row $undoRows[$displayRow]
    $redoBytes = Pack-Row $redoRows[$displayRow]

    [Array]::Copy($undoBytes, 0, $new, $dstRowOff + $oldRowBytes,     8)
    [Array]::Copy($redoBytes, 0, $new, $dstRowOff + $oldRowBytes + 8, 8)
}

[IO.File]::WriteAllBytes($src, $new)
Write-Host "Wrote ${src}: $($new.Length) bytes (was $($old.Length))"
