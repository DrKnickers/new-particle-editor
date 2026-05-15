#ifndef TEXTUREPALETTE_H
#define TEXTUREPALETTE_H

// MT-1 — frequently-used textures palette.
//
// PaletteStore is a process-global singleton holding the per-mod palette
// state (pinned + recent texture filenames, last-used Color/Bump filter)
// and the popup window position. Persisted to %APPDATA%\AloParticleEditor\
// texture-palettes.ini, with one [mod=<crc32-of-path>] section per mod
// plus a single [ui] section for cross-mod popup state.
//
// This header declares the data layer only. The popup window class and
// content owner-draw control are wired in a follow-up commit.

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <string>
#include <vector>
#include <unordered_map>
#include <cstdint>

namespace TexturePalette {

// Which texture slot an entry has been used for. Bit-flags so a single
// entry can be flagged for both (e.g., a master texture used as the
// color slot on one emitter and the bump slot on another).
enum SlotMask : uint8_t
{
    SLOT_NONE  = 0,
    SLOT_COLOR = 1 << 0,
    SLOT_BUMP  = 1 << 1,
};

// One palette entry. Filenames are basenames as stored in
// ParticleSystem::Emitter::colorTexture / normalTexture (8-bit ANSI).
// We hold them as wstring internally so INI round-trip via
// WritePrivateProfileStringW is lossless for non-ASCII names; the
// touch/commit boundary converts to/from UTF-8 ANSI.
struct Entry
{
    std::wstring filename;
    bool         isPinned;        // true = pins row, false = recents row
    uint8_t      slotMask;        // bit-flags from SlotMask
    uint64_t     lastUsedNs;      // QueryPerformanceCounter snapshot; recents LRU sort key
};

// Capacity caps. Hard-coded for v1; raising them is a one-line change.
static const size_t MAX_PINS    = 8;
static const size_t MAX_RECENTS = 8;

class Store
{
public:
    static Store& Instance();

    // Mod lifecycle. Loads/saves the matching INI section. Switching
    // mods flushes the previous mod's state to disk before reading
    // the new one.
    void              SetActiveMod(const std::wstring& modPath);
    void              ClearActiveMod();   // wipes the current mod's INI section (Reset View Settings)
    const std::wstring& ActiveMod() const { return m_activeMod; }
    bool              HasActiveMod() const { return !m_activeMod.empty(); }

    // Filter (per-mod). Defaults to SLOT_COLOR.
    SlotMask          ActiveFilter() const;
    void              SetActiveFilter(SlotMask filter);

    // Mutations. Each writes to disk before returning — INI is small
    // and writes are infrequent enough that debouncing isn't worth it.
    // TouchRecent: if `filename` already exists in this mod's entries,
    // bumps its lastUsedNs and OR's `usedAs` into its slotMask. Otherwise
    // adds a new recent. If recents are full (MAX_RECENTS), the oldest
    // recent is evicted.
    void              TouchRecent(const std::wstring& filename, SlotMask usedAs);
    // TogglePin: flips pinned state. Returns false if pinning would
    // exceed MAX_PINS (caller should show "pins full" status feedback).
    bool              TogglePin(const std::wstring& filename);
    // Remove an entry entirely (from pins or recents).
    void              Remove(const std::wstring& filename);

    // Read access for the popup's WM_PAINT. Returns entries matching
    // the given filter, in display order:
    //   - Pins: insertion order, oldest first.
    //   - Recents: most-recently-used first.
    std::vector<Entry> Pins   (SlotMask filter) const;
    std::vector<Entry> Recents(SlotMask filter) const;

    // Popup window position (cross-mod, persisted in [ui]).
    // GetPopupPos returns `fallback` if no position has ever been saved.
    POINT             GetPopupPos(POINT fallback) const;
    void              SetPopupPos(POINT pos);

private:
    Store();
    ~Store();
    Store(const Store&)            = delete;
    Store& operator=(const Store&) = delete;

    struct ModPalette
    {
        std::vector<Entry> entries;   // pins first (insertion order), then recents (insertion order)
        SlotMask           filter;
    };

    // Loads a mod section from INI on demand; cached in m_byMod.
    ModPalette&       LoadOrInit(const std::wstring& modPath);
    void              FlushMod  (const std::wstring& modPath, const ModPalette& mp) const;
    void              FlushUi   () const;

    // INI path under %APPDATA%\AloParticleEditor\.
    std::wstring      IniPath() const;
    // Section name for a mod path: "mod=<8-hex-crc32>".
    std::wstring      SectionFor(const std::wstring& modPath) const;

    std::wstring                                       m_activeMod;
    std::unordered_map<std::wstring, ModPalette>       m_byMod;        // keyed by lowercased mod path
    POINT                                              m_popupPos;
    bool                                               m_popupPosLoaded;
    mutable bool                                       m_iniPathChecked;
    mutable std::wstring                               m_iniPathCache;
};

} // namespace TexturePalette

#endif
