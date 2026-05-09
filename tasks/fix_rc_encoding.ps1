# Repair mojibake in both .rc files and re-encode as UTF-8 with BOM.
# - Reads file as cp1252 (so legitimate high bytes 0xB0/0xB1/0xB2 decode correctly).
# - Mojibake "EF BF BD" decodes under cp1252 to the 3-char sequence "ï¿½".
# - Applies ordered word-level replacements (longest/most-specific first).
# - Switches `#pragma code_page(1252)` to 65001.
# - Writes UTF-8 with BOM.

$ErrorActionPreference = 'Stop'

# 3-char sequence that mojibake bytes EF BF BD decode to under cp1252.
$M = [char]0xEF + [char]0xBF + [char]0xBD

function Repair-File {
    param(
        [string]$Path,
        # Array of @(pattern, replacement) pairs. Order matters; case-sensitive.
        [object[]]$Replacements
    )

    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $cp1252 = [System.Text.Encoding]::GetEncoding(1252)
    $text = $cp1252.GetString($bytes)

    foreach ($pair in $Replacements) {
        $text = $text.Replace($pair[0], $pair[1])
    }

    # Switch pragma to UTF-8.
    $text = $text.Replace('#pragma code_page(1252)', '#pragma code_page(65001)')

    # Verify no mojibake remains.
    if ($text.Contains($M)) {
        throw "U+FFFD sequence still present in $Path after replacements"
    }

    # Write UTF-8 with BOM.
    $utf8Bom = New-Object System.Text.UTF8Encoding($true)
    [System.IO.File]::WriteAllText($Path, $text, $utf8Bom)
}

# Build ordered replacement list for de.rc as (pattern, replacement) pairs.
# Order matters: longer / more-specific patterns first so they match before
# shorter substrings (e.g. "Größenänderung" before "Größe").
# Case-sensitive: a list of pairs is used because PowerShell hashtables and
# [ordered]@{} are case-insensitive and would collide "Einfügen" / "einfügen".
$deReplacements = @(
    # Long compound words and unique multi-umlaut forms first.
    ,@("Gr${M}${M}en${M}nderung",      "Größenänderung")
    ,@("Ausl${M}uferl${M}nge",         "Ausläuferlänge")
    ,@("W${M}rfelgr${M}${M}e",         "Würfelgröße")
    ,@("Erzeugungsverz${M}gerung",     "Erzeugungsverzögerung")
    ,@("St${M}${M}verz${M}gerung",     "Stößverzögerung")
    ,@("zur${M}ckgesetzt",             "zurückgesetzt")
    ,@("zur${M}cksetzen",              "zurücksetzen")
    ,@("ge${M}ffnet",                  "geöffnet")
    ,@("ver${M}ndert",                 "verändert")

    # Medium-length distinctive words.
    ,@("Ausl${M}ufer",                 "Ausläufer")
    ,@("Oberfl${M}che",                "Oberfläche")
    ,@("Unsch${M}rfe",                 "Unschärfe")
    ,@("Zuf${M}llige",                 "Zufällige")
    ,@("${M}berspringen",              "überspringen")
    ,@("${M}bermitteln",               "übermitteln")
    ,@("ausw${M}hlen",                 "auswählen")

    # Capitalized mnemonics — must run before lowercase generic ones.
    ,@("&${M}ffnen",                   "&Öffnen")
    ,@("&${M}ber",                     "&Über")
    ,@("${M}nderungen",                "Änderungen")

    # Einfügen / Löschen / Lösche / Verändere variants. Mnemonic-& placement
    # varies: "E&infügen" has the & between E and inf, so needs its own pattern.
    ,@("E&inf${M}gen",                 "E&infügen")
    ,@("Einf${M}gen",                  "Einfügen")
    ,@("einf${M}gen",                  "einfügen")
    ,@("L${M}schen",                   "Löschen")
    ,@("l${M}schen",                   "löschen")
    ,@("L${M}sche ",                   "Lösche ")
    ,@("Ver&${M}ndere",                "Ver&ändere")

    # Short common words.
    ,@("L${M}nge",                     "Länge")
    ,@("H${M}he",                      "Höhe")
    ,@("St${M}${M}e",                  "Stöße")
    ,@("Gr${M}${M}e",                  "Größe")
    ,@("Gr${M}n",                      "Grün")
    ,@("Dr${M}cke",                    "Drücke")
    ,@("W${M}rfel",                    "Würfel")
    ,@("/s${M}",                       "/s²")
    # Generic lowercase ?ffnen — only legitimate remaining match is "Partikelsystem öffnen".
    ,@("${M}ffnen",                    "öffnen")
)

# en.rc only needs the s² fix.
$enReplacements = @(
    ,@("units/s${M}",                  "units/s²")
)

$root = "C:\Modding\Particle Editor\.claude\worktrees\thirsty-noyce-6a9a52"
Repair-File -Path "$root\src\ParticleEditor.en.rc" -Replacements $enReplacements
Repair-File -Path "$root\src\ParticleEditor.de.rc" -Replacements $deReplacements

Write-Host "Done."
