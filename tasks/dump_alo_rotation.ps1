# Dump rotation-related fields for every emitter in an .alo file.
# Targets P_hp_imperial_damage.alo (Chelmod), specifically "Fire Small".

$ErrorActionPreference = 'Stop'

$path = $args[0]
if (-not $path) { throw "Usage: dump_alo_rotation.ps1 <alo-path>" }

$bytes = [IO.File]::ReadAllBytes($path)
$pos = 0
$fileLen = $bytes.Length

function Read-U32 {
    $v = [BitConverter]::ToUInt32($bytes, $script:pos)
    $script:pos += 4
    return $v
}
function Read-U8 {
    $v = $bytes[$script:pos]; $script:pos += 1; return $v
}
function Read-Float {
    $v = [BitConverter]::ToSingle($bytes, $script:pos)
    $script:pos += 4
    return $v
}
function Read-StringNul {
    param([int]$len)
    $end = $script:pos + $len
    $s = ""
    while ($script:pos -lt $end -and $bytes[$script:pos] -ne 0) {
        $s += [char]$bytes[$script:pos]
        $script:pos += 1
    }
    $script:pos = $end
    return $s
}

# Walk top-level chunks until we find 0x0900, then drill in.
function Walk-Container {
    param([int]$endPos, [int]$depth)
    $emitterIdx = -1
    while ($script:pos -lt $endPos) {
        $hdrPos = $script:pos
        $type = Read-U32
        $rawSize = Read-U32
        $isContainer = ($rawSize -band 0x80000000) -ne 0
        $size = $rawSize -band 0x7FFFFFFF
        $childEnd = $script:pos + $size

        $indent = "  " * $depth
        $tHex = "0x{0:X4}" -f $type

        if ($isContainer) {
            # Drill into containers we care about.
            if ($type -eq 0x0900 -or $type -eq 0x0800 -or $type -eq 0x0700) {
                if ($type -eq 0x0700) {
                    $script:emitterCount++
                    Write-Host ""
                    Write-Host "${indent}=== Emitter #$($script:emitterCount-1) [chunk $tHex] ==="
                }
                Walk-Container -endPos $childEnd -depth ($depth + 1)
            } elseif ($type -eq 0x0001 -and $depth -ge 3) {
                Write-Host "${indent}[$tHex] Tracks block:"
                Walk-Tracks -endPos $childEnd -indent ("$indent  ")
            } else {
                $script:pos = $childEnd
            }
        } else {
            # Data chunk.
            switch ($type) {
                0x0000 {
                    # Particle system name (top-level name)
                    if ($depth -eq 1) {
                        $name = Read-StringNul -len $size
                        Write-Host "${indent}[$tHex] PS name: '$name'"
                    } else { $script:pos = $childEnd }
                }
                0x0003 {
                    $name = Read-StringNul -len $size
                    Write-Host "${indent}[$tHex] Color texture: '$name'"
                }
                0x0045 {
                    $name = Read-StringNul -len $size
                    Write-Host "${indent}[$tHex] Normal texture: '$name'"
                }
                0x0016 {
                    # Emitter name
                    $name = Read-StringNul -len $size
                    Write-Host "${indent}[$tHex] Emitter name: '$name'"
                    $script:currentEmitterName = $name
                }
                0x0002 {
                    # Properties (mini-chunks) — only when nested in 0x0700, not the top-level 0x0002
                    if ($depth -ge 3) {
                        Write-Host "${indent}[$tHex] Properties (mini-chunks):"
                        Walk-MiniChunks -endPos $childEnd -indent ("$indent  ")
                    } else { $script:pos = $childEnd }
                }
                0x0001 {
                    # Tracks chunk inside emitter (depth >= 3). Top-level 0x0001 (depth 1) is the "irrelevant" int.
                    if ($depth -ge 3) {
                        Write-Host "${indent}[$tHex] Tracks block:"
                        Walk-Tracks -endPos $childEnd -indent ("$indent  ")
                    } else { $script:pos = $childEnd }
                }
                default { $script:pos = $childEnd }
            }
        }
        $script:pos = $childEnd
    }
}

function Walk-MiniChunks {
    param([int]$endPos, [string]$indent)
    while ($script:pos -lt $endPos) {
        $type = Read-U8
        $size = Read-U8
        $end = $script:pos + $size
        $tHex = "0x{0:X2}" -f $type
        # Highlight rotation-related minis.
        switch ($type) {
            0x05 { Write-Host "${indent}mini[$tHex] nTriangles+1 = $((Read-U32) + 1)" }
            0x0F { Write-Host "${indent}mini[$tHex] lifetime = $(Read-Float)" }
            0x17 { Write-Host "${indent}mini[$tHex] randomRotationVariance = $(Read-Float)" }
            0x23 { Write-Host "${indent}mini[$tHex] randomRotationDirection = $(Read-U8)" }
            0x2E { Write-Host "${indent}mini[$tHex] isWorldOriented = $(Read-U8)" }
            0x3B { Write-Host "${indent}mini[$tHex] isHeatParticle = $(Read-U8)" }
            0x3D { Write-Host "${indent}mini[$tHex] isWeatherParticle = $(Read-U8)" }
            0x41 { Write-Host "${indent}mini[$tHex] hasTail = $(Read-U8)" }
            0x42 { Write-Host "${indent}mini[$tHex] tailSize = $(Read-Float)" }
            0x48 { Write-Host "${indent}mini[$tHex] randomRotation = $(Read-U8)" }
            default { }
        }
        $script:pos = $end
    }
}

function Walk-Tracks {
    param([int]$endPos, [string]$indent)
    # Tracks: 4 byte-channel tracks (0x00 first/last bytes 0..255) then 3 float tracks (scale, index, rotation-speed).
    # Each track is a pair: 0x00 (header data chunk) + 0x01 (keys data chunk).
    # Track index 6 = TRACK_ROTATION_SPEED, that's the 7th pair.
    $trackIdx = 0
    while ($script:pos -lt $endPos) {
        $type = Read-U32
        $rawSize = Read-U32
        $isContainer = ($rawSize -band 0x80000000) -ne 0
        $size = $rawSize -band 0x7FFFFFFF
        $childEnd = $script:pos + $size

        if ($type -eq 0x00) {
            # Header data chunk: minis 0x02 (first), 0x03 (last), 0x04 (interp)
            $isFloatTrack = ($trackIdx -ge 4)  # tracks 4,5,6 are float
            $first = $null; $last = $null; $interp = $null
            while ($script:pos -lt $childEnd) {
                $mt = Read-U8; $ms = Read-U8; $me = $script:pos + $ms
                switch ($mt) {
                    0x02 { if ($isFloatTrack) { $first = Read-Float } else { $first = (Read-U8) / 255.0 } }
                    0x03 { if ($isFloatTrack) { $last  = Read-Float } else { $last  = (Read-U8) / 255.0 } }
                    0x04 { $interp = Read-U32 }
                    default { }
                }
                $script:pos = $me
            }
            if ($trackIdx -eq 6) {
                Write-Host "${indent}TRACK 6 (rotation-speed) header: first=$first last=$last interp=$interp"
            }
            $script:pos = $childEnd
        }
        elseif ($type -eq 0x01) {
            # Keys data chunk: stream of mini 0x05 entries.
            $keys = @()
            while ($script:pos -lt $childEnd) {
                $mt = Read-U8; $ms = Read-U8; $me = $script:pos + $ms
                if ($mt -eq 0x05) {
                    if ($trackIdx -lt 4) {
                        $val = Read-U32  # byte tracks store value as uint32 / 255
                        $valF = $val / 255.0
                        $time = Read-Float
                        $keys += "(t=$time,v=$valF)"
                    } else {
                        $val = Read-Float
                        $time = Read-Float
                        $keys += "(t=$time,v=$val)"
                    }
                }
                $script:pos = $me
            }
            if ($trackIdx -eq 6) {
                Write-Host "${indent}TRACK 6 (rotation-speed) keys: $($keys -join ' ')"
            }
            $script:pos = $childEnd
            $trackIdx++
        }
        else {
            $script:pos = $childEnd
        }
    }
}

$script:emitterCount = 0
$script:currentEmitterName = ""

Walk-Container -endPos $fileLen -depth 0

Write-Host ""
Write-Host "Total emitters: $($script:emitterCount)"
