# Extend src/Resources/toolbar1.bmp from 8 icons (128x16) to 9 icons
# (144x16). Adds a Pause-toggle glyph in cell 8 (zero-based) — two
# 3-pixel-wide vertical bars with a 2-pixel gap, centered in the cell.
#
# Format: 4bpp paletted BMP. Palette index 6 = RGB(0,128,128) = chroma
# key matched by ImageList_AddMasked. Palette index 0 = black = foreground.
#
# Bitmap rows are stored bottom-up (last storage row = top of image).
# 4bpp packs 2 pixels per byte (high nibble = first pixel).
#
# Mirrors tasks/extend_toolbar1_bmp.ps1 (5->7 Undo/Redo) and
# tasks/extend_toolbar1_bmp_bloom.ps1 (7->8 Bloom).

$ErrorActionPreference = 'Stop'

$src = "src\Resources\toolbar1.bmp"
$old = [IO.File]::ReadAllBytes($src)

$oldPixOff = [BitConverter]::ToInt32($old, 10)
$oldW = 128
$oldH = 16
$oldRowBytes = 64   # 128 / 2 = 64, already 4-aligned
$newW = 144
$newRowBytes = 72   # 144 / 2 = 72, already 4-aligned
$newH = 16

# Display order top -> bottom. '0' = black foreground, '6' = chroma key.
# Each row is exactly 16 chars (= 16 px).
#
# Two vertical bars: cols 4-6 (left bar) and cols 9-11 (right bar),
# spanning rows 3-12 (10 px tall). Layout per bar row:
#   "6666" + "000" + "66" + "000" + "6666" = 16
$pauseRows = @(
    "6666666666666666",  # 0
    "6666666666666666",  # 1
    "6666666666666666",  # 2
    "6666000660006666",  # 3  - bars top
    "6666000660006666",  # 4
    "6666000660006666",  # 5
    "6666000660006666",  # 6
    "6666000660006666",  # 7
    "6666000660006666",  # 8
    "6666000660006666",  # 9
    "6666000660006666",  # 10
    "6666000660006666",  # 11
    "6666000660006666",  # 12 - bars bottom
    "6666666666666666",  # 13
    "6666666666666666",  # 14
    "6666666666666666"   # 15
)

# Sanity check.
foreach ($r in $pauseRows) {
    if ($r.Length -ne 16) { throw "row '$r' is not 16 chars" }
}
if ($pauseRows.Count -ne $newH) { throw "expected $newH rows, got $($pauseRows.Count)" }

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

# Pixel data: copy each row's existing 64 bytes, then append 8 bytes
# for the pause icon cell.
for ($storageRow = 0; $storageRow -lt $newH; $storageRow++) {
    $srcRowOff = $oldPixOff + $storageRow * $oldRowBytes
    $dstRowOff = 118 + $storageRow * $newRowBytes
    [Array]::Copy($old, $srcRowOff, $new, $dstRowOff, $oldRowBytes)

    $displayRow = $newH - 1 - $storageRow
    $pauseBytes = Pack-Row $pauseRows[$displayRow]

    [Array]::Copy($pauseBytes, 0, $new, $dstRowOff + $oldRowBytes, 8)
}

[IO.File]::WriteAllBytes($src, $new)
Write-Host "Wrote ${src}: $($new.Length) bytes (was $($old.Length))"
