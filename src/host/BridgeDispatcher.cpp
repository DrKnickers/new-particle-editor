#include "BridgeDispatcher.h"

#include "AcceleratorBridge.h"
#include "LayoutBroker.h"
#include "third_party/nlohmann/json.hpp"

#include "../engine.h"
#include "../files.h"
#include "../ChunkFile.h"
#include "../LinkGroup.h"
#include "../ModManager.h"
#include "../ParticleSystem.h"
#include "../ParticleSystemIO.h"
#include "../Rescale.h"
#include "../SpawnerDriver.h"
#include "../UndoStack.h"

#include <algorithm>
#include <cstdio>
#include <string>
#include <utility>
#include <vector>
#include <windows.h>
#include <commdlg.h>

using nlohmann::json;

// Defined in src/UI/EmitterList.cpp; reused by the new-UI Phase 3
// Screen 4 Batch B1 emitter-mutation handlers. Stays non-static so the
// host's dispatcher can link against it without a header dependency on
// EmitterList.cpp (which still belongs to the legacy --legacy-ui chrome).
extern std::string GenerateDuplicateName(const ParticleSystem* system,
                                          const std::string&     sourceName);

namespace host {

namespace {

// Build a `res` envelope with ok:true and given data payload.
std::string BuildOkResponse(const std::string& id, const json& data)
{
    json env = {
        {"type", "res"},
        {"id",   id},
        {"ok",   true},
        {"data", data},
    };
    return env.dump();
}

// Build a `res` envelope with ok:false and given error string.
std::string BuildErrResponse(const std::string& id, const std::string& error)
{
    json env = {
        {"type",  "res"},
        {"id",    id},
        {"ok",    false},
        {"error", error},
    };
    return env.dump();
}

// UTF-8 ↔ UTF-16 helpers — kept local because the bridge only needs them
// for the handful of `engine/*/custom-path` setters and the snapshot's
// path arrays. Mirrors the equivalents in HostWindow.cpp.
std::wstring Utf8ToWide(const std::string& s)
{
    if (s.empty()) return {};
    int len = MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
    std::wstring out(static_cast<size_t>(len), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), out.data(), len);
    return out;
}

std::string WideToUtf8(const std::wstring& w)
{
    if (w.empty()) return {};
    int len = WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()),
                                  nullptr, 0, nullptr, nullptr);
    std::string out(static_cast<size_t>(len), '\0');
    WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()),
                        out.data(), len, nullptr, nullptr);
    return out;
}

// Serialise a D3DXVECTOR3/4 / Engine::Camera / Engine::Light into the
// EngineStateDto-compatible JSON shape.
json Vec3ToJson(const D3DXVECTOR3& v)
{
    return json::array({v.x, v.y, v.z});
}

json Vec4ToJson(const D3DXVECTOR4& v)
{
    return json::array({v.x, v.y, v.z, v.w});
}

json CameraToJson(const Engine::Camera& c)
{
    return json{
        {"position", Vec3ToJson(c.Position)},
        {"target",   Vec3ToJson(c.Target)},
        {"up",       Vec3ToJson(c.Up)},
    };
}

json LightToJson(const Engine::Light& l)
{
    return json{
        {"diffuse",   Vec4ToJson(l.Diffuse)},
        {"specular",  Vec4ToJson(l.Specular)},
        {"position",  Vec4ToJson(l.Position)},
        {"direction", Vec4ToJson(l.Direction)},
    };
}

// Parse a JSON array of 3 numbers into a D3DXVECTOR3. Defaults to zero
// on malformed input (better than crashing on a stray non-array param).
D3DXVECTOR3 JsonToVec3(const json& j)
{
    if (j.is_array() && j.size() >= 3)
        return D3DXVECTOR3(j[0].get<float>(), j[1].get<float>(), j[2].get<float>());
    return D3DXVECTOR3(0, 0, 0);
}

D3DXVECTOR4 JsonToVec4(const json& j)
{
    if (j.is_array() && j.size() >= 4)
        return D3DXVECTOR4(j[0].get<float>(), j[1].get<float>(), j[2].get<float>(), j[3].get<float>());
    return D3DXVECTOR4(0, 0, 0, 0);
}

Engine::LightType ParseLightWhich(const std::string& s)
{
    if (s == "fill1") return Engine::LT_FILL1;
    if (s == "fill2") return Engine::LT_FILL2;
    return Engine::LT_SUN;  // default / "sun"
}

// Recent-files registry helpers. Phase 3 Screen 8 Batch 3.
//
// Storage layout matches legacy's `AddToHistory` / `GetHistory` in
// src/main.cpp:650-768 — values under `HKCU\Software\AloParticleEditor`
// keyed by filename, with the FILETIME payload encoded as REG_BINARY.
// The list is ordered most-recent-first by reading the FILETIME values
// and sorting descending. Cap of 9 matches `NUM_HISTORY_ITEMS` at
// src/main.cpp:47. Legacy and new-UI share the same registry path, so
// the recent-files menu stays consistent across both UI modes.

constexpr int kMaxRecentFiles = 9;
constexpr const wchar_t* kRegistryKeyPath = L"Software\\AloParticleEditor";

// Read the registry-backed history into a vector ordered most-recent
// first. Mirrors the loop in legacy GetHistory. Silently returns an
// empty vector when the key does not exist (first-run case).
std::vector<std::wstring> ReadRecentFiles()
{
    std::vector<std::pair<ULONGLONG, std::wstring>> entries;

    HKEY hKey;
    if (RegOpenKeyExW(HKEY_CURRENT_USER, kRegistryKeyPath, 0,
                      KEY_READ, &hKey) != ERROR_SUCCESS)
    {
        return {};
    }

    for (int i = 0;; ++i)
    {
        wchar_t name[1024] = {};
        DWORD nameLen = static_cast<DWORD>(std::size(name));
        DWORD type = 0, size = 0;
        LONG err = RegEnumValueW(hKey, i, name, &nameLen, nullptr,
                                 &type, nullptr, &size);
        if (err != ERROR_SUCCESS) break;

        if (type == REG_BINARY && size == sizeof(FILETIME))
        {
            FILETIME ft = {};
            DWORD sz = sizeof(ft);
            if (RegQueryValueExW(hKey, name, nullptr, &type,
                                 reinterpret_cast<BYTE*>(&ft),
                                 &sz) == ERROR_SUCCESS)
            {
                ULARGE_INTEGER ull;
                ull.LowPart  = ft.dwLowDateTime;
                ull.HighPart = ft.dwHighDateTime;
                entries.emplace_back(ull.QuadPart, std::wstring(name));
            }
        }
    }
    RegCloseKey(hKey);

    // Sort by timestamp descending (most recent first).
    std::sort(entries.begin(), entries.end(),
              [](const auto& a, const auto& b) { return a.first > b.first; });

    std::vector<std::wstring> out;
    out.reserve(entries.size());
    for (auto& e : entries) out.push_back(std::move(e.second));
    // Cap to kMaxRecentFiles.
    if (out.size() > static_cast<size_t>(kMaxRecentFiles))
    {
        out.resize(kMaxRecentFiles);
    }
    return out;
}

// Add (or move-to-top) `path` in the registry. Mirrors legacy
// AddToHistory: writes the FILETIME for "now" under the path-as-key,
// then trims entries beyond the cap by deleting the oldest. Returns
// the resulting list (most-recent-first).
std::vector<std::wstring> WriteRecentFile(const std::wstring& path)
{
    FILETIME ft;
    SYSTEMTIME st;
    GetSystemTime(&st);
    SystemTimeToFileTime(&st, &ft);

    HKEY hKey;
    if (RegCreateKeyExW(HKEY_CURRENT_USER, kRegistryKeyPath, 0, nullptr,
                        REG_OPTION_NON_VOLATILE, KEY_READ | KEY_WRITE,
                        nullptr, &hKey, nullptr) == ERROR_SUCCESS)
    {
        // Set the value — if the key already exists, this updates the
        // FILETIME so the path moves to the top of the most-recent list.
        RegSetValueExW(hKey, path.c_str(), 0, REG_BINARY,
                       reinterpret_cast<const BYTE*>(&ft), sizeof(ft));
        RegCloseKey(hKey);
    }

    // Re-read and trim. Legacy does this lazily inside GetHistory; we
    // do it eagerly here so the React side sees the post-trim list.
    auto list = ReadRecentFiles();

    // Trim by deleting any entries that fall off the end of the cap.
    if (list.size() > static_cast<size_t>(kMaxRecentFiles))
    {
        HKEY hTrim;
        if (RegOpenKeyExW(HKEY_CURRENT_USER, kRegistryKeyPath, 0,
                          KEY_READ | KEY_WRITE, &hTrim) == ERROR_SUCCESS)
        {
            for (size_t i = kMaxRecentFiles; i < list.size(); ++i)
            {
                RegDeleteValueW(hTrim, list[i].c_str());
            }
            RegCloseKey(hTrim);
        }
        list.resize(kMaxRecentFiles);
    }
    return list;
}

// LT-4 host-state plumbing — JSON ↔ SpawnerConfig converters. The
// schema's SpawnerParamsDto (web/packages/bridge-schema/src/index.ts:60)
// is value-for-value compatible with the native SpawnerConfig (lines in
// src/SpawnerDriver.h:18) except for the `mode` field which is a
// string in JSON but an enum on the native side.

SpawnerConfig JsonToSpawnerConfig(const json& j)
{
    SpawnerConfig cfg;
    if (!j.is_object()) return cfg;

    std::string mode = j.value("mode", std::string("auto"));
    cfg.mode = (mode == "manual")
        ? SpawnerConfig::Mode::Manual
        : SpawnerConfig::Mode::Auto;

    cfg.enabled        = j.value("enabled", false);
    cfg.burstSize      = j.value("burstSize", 1);
    cfg.spacingSec     = j.value("spacingSec", 0.0f);
    cfg.intervalSec    = j.value("intervalSec", 10.0f);
    cfg.position       = JsonToVec3(j.value("position", json::array()));
    cfg.velocity       = JsonToVec3(j.value("velocity", json::array()));
    cfg.maxLifetimeSec = j.value("maxLifetimeSec", 5.0f);
    cfg.jitterPosition = JsonToVec3(j.value("jitterPosition", json::array()));
    cfg.jitterVelocity = JsonToVec3(j.value("jitterVelocity", json::array()));
    return cfg;
}

json SpawnerConfigToJson(const SpawnerConfig& cfg)
{
    return json{
        {"mode",           cfg.mode == SpawnerConfig::Mode::Manual ? "manual" : "auto"},
        {"enabled",        cfg.enabled},
        {"burstSize",      cfg.burstSize},
        {"spacingSec",     cfg.spacingSec},
        {"intervalSec",    cfg.intervalSec},
        {"position",       Vec3ToJson(cfg.position)},
        {"velocity",       Vec3ToJson(cfg.velocity)},
        {"maxLifetimeSec", cfg.maxLifetimeSec},
        {"jitterPosition", Vec3ToJson(cfg.jitterPosition)},
        {"jitterVelocity", Vec3ToJson(cfg.jitterVelocity)},
    };
}

// Screen 4 Batch B1 — wire-name ↔ LinkExemptFlags::member mapping.
// Mirrors the legacy field table at [src/UI/EmitterList.cpp:2381]
// (kLinkSettingsFields), but uses camelCase field names that match the
// schema's wire surface. Excludes `name` (intrinsically exempt;
// settings dialog doesn't display it) and the `unknownXX` set (no
// inspector representation). The dispatcher converts the wire's
// `string[]` of exempt field names into a LinkExemptFlags bitfield by
// looking each name up in this table.
struct LinkFieldEntry
{
    const char*               name;
    bool LinkExemptFlags::*   flag;
};

static const LinkFieldEntry kLinkFieldTable[] = {
    // Textures.
    { "colorTexture",            &LinkExemptFlags::colorTexture },
    { "normalTexture",           &LinkExemptFlags::normalTexture },
    // Curves.
    { "trackIndex",              &LinkExemptFlags::trackIndex },
    { "trackRed",                &LinkExemptFlags::trackRed },
    { "trackGreen",              &LinkExemptFlags::trackGreen },
    { "trackBlue",               &LinkExemptFlags::trackBlue },
    { "trackAlpha",              &LinkExemptFlags::trackAlpha },
    { "trackScale",              &LinkExemptFlags::trackScale },
    { "trackRotationSpeed",      &LinkExemptFlags::trackRotationSpeed },
    // Lifetime / spawning.
    { "lifetime",                &LinkExemptFlags::lifetime },
    { "initialDelay",            &LinkExemptFlags::initialDelay },
    { "burstDelay",              &LinkExemptFlags::burstDelay },
    { "nBursts",                 &LinkExemptFlags::nBursts },
    { "nParticlesPerBurst",      &LinkExemptFlags::nParticlesPerBurst },
    { "nParticlesPerSecond",     &LinkExemptFlags::nParticlesPerSecond },
    { "useBursts",               &LinkExemptFlags::useBursts },
    // Physics.
    { "gravity",                 &LinkExemptFlags::gravity },
    { "acceleration",            &LinkExemptFlags::acceleration },
    { "inwardSpeed",             &LinkExemptFlags::inwardSpeed },
    { "inwardAcceleration",      &LinkExemptFlags::inwardAcceleration },
    { "bounciness",              &LinkExemptFlags::bounciness },
    { "groundBehavior",          &LinkExemptFlags::groundBehavior },
    { "objectSpaceAcceleration", &LinkExemptFlags::objectSpaceAcceleration },
    { "affectedByWind",          &LinkExemptFlags::affectedByWind },
    // Appearance.
    { "blendMode",               &LinkExemptFlags::blendMode },
    { "textureSize",             &LinkExemptFlags::textureSize },
    { "nTriangles",              &LinkExemptFlags::nTriangles },
    { "randomScalePerc",         &LinkExemptFlags::randomScalePerc },
    { "randomLifetimePerc",      &LinkExemptFlags::randomLifetimePerc },
    { "hasTail",                 &LinkExemptFlags::hasTail },
    { "tailSize",                &LinkExemptFlags::tailSize },
    { "noDepthTest",             &LinkExemptFlags::noDepthTest },
    { "randomColors",            &LinkExemptFlags::randomColors },
    // Weather.
    { "isWeatherParticle",       &LinkExemptFlags::isWeatherParticle },
    { "weatherCubeSize",         &LinkExemptFlags::weatherCubeSize },
    { "weatherCubeDistance",     &LinkExemptFlags::weatherCubeDistance },
    { "weatherFadeoutDistance",  &LinkExemptFlags::weatherFadeoutDistance },
    // Rotation.
    { "randomRotation",          &LinkExemptFlags::randomRotation },
    { "randomRotationDirection", &LinkExemptFlags::randomRotationDirection },
    { "randomRotationAverage",   &LinkExemptFlags::randomRotationAverage },
    { "randomRotationVariance",  &LinkExemptFlags::randomRotationVariance },
    // Misc.
    { "linkToSystem",            &LinkExemptFlags::linkToSystem },
    { "parentLinkStrength",      &LinkExemptFlags::parentLinkStrength },
    { "doColorAddGrayscale",     &LinkExemptFlags::doColorAddGrayscale },
    { "isHeatParticle",          &LinkExemptFlags::isHeatParticle },
    { "isWorldOriented",         &LinkExemptFlags::isWorldOriented },
    { "freezeTime",              &LinkExemptFlags::freezeTime },
    { "skipTime",                &LinkExemptFlags::skipTime },
    { "emitFromMesh",            &LinkExemptFlags::emitFromMesh },
    { "emitFromMeshOffset",      &LinkExemptFlags::emitFromMeshOffset },
    { "groupSpeed",              &LinkExemptFlags::groupSpeed },
    { "groupLifetime",           &LinkExemptFlags::groupLifetime },
    { "groupPosition",           &LinkExemptFlags::groupPosition },
};

constexpr size_t kLinkFieldCount =
    sizeof(kLinkFieldTable) / sizeof(kLinkFieldTable[0]);

// Translate a LinkExemptFlags bitfield to the wire's `string[]` of
// exempt field names.
json LinkExemptFlagsToJsonArray(const LinkExemptFlags& flags)
{
    json arr = json::array();
    for (size_t i = 0; i < kLinkFieldCount; ++i)
    {
        if (flags.*(kLinkFieldTable[i].flag))
            arr.push_back(kLinkFieldTable[i].name);
    }
    return arr;
}

// Translate a `string[]` wire payload to a LinkExemptFlags bitfield.
// Unknown names are silently ignored (forward-compat with newer
// schemas adding fields the host doesn't yet recognise).
LinkExemptFlags LinkExemptFlagsFromJsonArray(const json& arr)
{
    LinkExemptFlags out;  // default-constructed = v1 defaults
    // Clear the table-mapped fields; we want to honor only what the
    // wire specifies. `name` + unknowns are left at their defaults
    // (intrinsic per-emitter for name; defaults for the unknowns).
    for (size_t i = 0; i < kLinkFieldCount; ++i)
        out.*(kLinkFieldTable[i].flag) = false;

    if (!arr.is_array()) return out;
    for (const auto& v : arr)
    {
        if (!v.is_string()) continue;
        const std::string s = v.get<std::string>();
        for (size_t i = 0; i < kLinkFieldCount; ++i)
        {
            if (s == kLinkFieldTable[i].name)
            {
                out.*(kLinkFieldTable[i].flag) = true;
                break;
            }
        }
    }
    return out;
}

// LT-4: walk a ParticleSystem and build an EmitterTreeNode-shaped JSON
// tree. Mirrors the schema definition at
// web/packages/bridge-schema/src/index.ts:91. Children are computed
// from each emitter's `spawnDuringLife` / `spawnOnDeath` indices in
// the same order as legacy `ImportEmitters_AddTreeItem` (during-life
// before on-death) so the import dialog tree matches.
//
// Screen 4 Batch A: extended with `role` / `linkGroup` / `visible`.
// `role` is derived from how this emitter is attached to its parent's
// spawn slot (lifetime vs death); top-level emitters return "root".
// The sentinel for "no spawn child" is `(size_t)-1` — matches the
// legacy EmitterList.cpp usage at e.g. [src/UI/EmitterList.cpp:1349].
json BuildEmitterTreeNode(const ParticleSystem* sys, size_t idx)
{
    if (sys == nullptr || idx >= sys->getEmitters().size()) return json::object();
    const ParticleSystem::Emitter& emit = sys->getEmitter(idx);
    json children = json::array();
    if (emit.spawnDuringLife != static_cast<size_t>(-1))
        children.push_back(BuildEmitterTreeNode(sys, emit.spawnDuringLife));
    if (emit.spawnOnDeath != static_cast<size_t>(-1))
        children.push_back(BuildEmitterTreeNode(sys, emit.spawnOnDeath));

    // Role: walk to parent's spawn slots. If parent is null we're a
    // top-level root. Otherwise check whether parent's lifetime slot
    // or death slot points at our index. Default to "lifetime" if
    // somehow neither matches (shouldn't happen — every non-root must
    // be referenced by exactly one slot — but treats the case as the
    // less-disruptive fallback).
    const char* role = "root";
    if (emit.parent != nullptr)
    {
        if (emit.parent->spawnOnDeath == idx)         role = "death";
        else if (emit.parent->spawnDuringLife == idx) role = "lifetime";
        else                                          role = "lifetime";
    }

    return json{
        {"id",        static_cast<int>(idx)},
        {"name",      emit.name},
        {"role",      role},
        {"linkGroup", static_cast<unsigned int>(emit.linkGroup)},
        {"visible",   emit.visible},
        {"children",  children},
    };
}

// Phase 3 Screen 8 Batch 4 — default spawner-config JSON. Mirrors the
// `SpawnerConfig()` initialiser at [src/SpawnerDriver.h:18]. Used to
// seed the dispatcher's cached config on construction so the first
// snapshot returns a populated `spawner` field even before any
// `spawner/start` has been dispatched.
json DefaultSpawnerConfigJson()
{
    return json{
        {"mode",            "auto"},
        {"enabled",         false},
        {"burstSize",       1},
        {"spacingSec",      0.0},
        {"intervalSec",     10.0},
        {"position",        json::array({0.0, 0.0, 0.0})},
        {"velocity",        json::array({0.0, 0.0, 0.0})},
        {"maxLifetimeSec",  5.0},
        {"jitterPosition",  json::array({0.0, 0.0, 0.0})},
        {"jitterVelocity",  json::array({0.0, 0.0, 0.0})},
    };
}

// Forward declaration so BuildEngineStateSnapshot can read editor-level
// state from the dispatcher when serialising the snapshot.

// Reads every getter on Engine into a JSON object whose shape matches
// `EngineStateDto` in web/packages/bridge-schema/src/index.ts.
//
// Coupling note: any new field added to `EngineStateDto` MUST also be
// added here, otherwise the React UI will read `undefined` for it.
json BuildEngineStateSnapshot(Engine* engine,
                              const std::wstring& currentFilePath,
                              bool dirty,
                              const json& spawnerConfig,
                              int selectedEmitterId,
                              const std::wstring& activeModPath,
                              bool leaveParticles)
{
    if (!engine) return json::object();

    // Ground slot custom paths — kGroundTextureCount entries.
    json groundPaths = json::array();
    for (int i = 0; i < Engine::kGroundTextureCount; ++i)
        groundPaths.push_back(WideToUtf8(engine->GetGroundSlotCustomPath(i)));

    // Skydome custom paths — only slots 9..11 are user-customisable.
    // The DTO exposes them as a flat array indexed 0..2.
    json skyPaths = json::array();
    for (int i = Engine::kSkydomeFirstCustomSlot; i < Engine::kSkydomeSlotCount; ++i)
        skyPaths.push_back(WideToUtf8(engine->GetSkydomeCustomPath(i)));

    json lights = {
        {"sun",   LightToJson(engine->GetLight(Engine::LT_SUN))},
        {"fill1", LightToJson(engine->GetLight(Engine::LT_FILL1))},
        {"fill2", LightToJson(engine->GetLight(Engine::LT_FILL2))},
    };

    // currentFilePath as JSON: null when untitled, string otherwise.
    // JSON null is correct semantically — the schema's
    // `currentFilePath: string | null` discriminates by presence.
    json filePathField = currentFilePath.empty()
        ? json(nullptr)
        : json(WideToUtf8(currentFilePath));

    return json{
        // Editor-level state (Screen 8 Batch 3).
        {"currentFilePath",       filePathField},
        {"dirty",                 dirty},

        // Ground
        {"ground",                engine->GetGround()},
        {"groundZ",               engine->GetGroundZ()},
        {"groundTexture",         engine->GetGroundTexture()},
        {"groundSolidColor",      static_cast<unsigned int>(engine->GetGroundSolidColor())},
        {"groundSlotCustomPaths", groundPaths},

        // Skydome
        {"skydomeSlot",           engine->GetSkydomeSlot()},
        {"skydomeCustomPaths",    skyPaths},

        // Background (COLORREF; low byte = blue)
        {"background",            static_cast<unsigned int>(engine->GetBackground())},

        // Lights / ambient / shadow
        {"lights",                lights},
        {"ambient",               Vec4ToJson(engine->GetAmbient())},
        {"shadow",                Vec4ToJson(engine->GetShadow())},

        // Bloom
        {"bloom",                 engine->GetBloom()},
        {"bloomAvailable",        engine->IsBloomAvailable()},
        {"bloomStrength",         engine->GetBloomStrength()},
        {"bloomCutoff",           engine->GetBloomCutoff()},
        {"bloomSize",             engine->GetBloomSize()},

        // Task 2.7 — leave particles after instance death. Read from
        // the active ParticleSystem (passed in by caller); defaults true
        // when no system is bound.
        {"leaveParticles",        leaveParticles},

        // Debug
        {"heatDebug",             engine->GetHeatDebug()},

        // View state (preview clock). IsPreviewPaused() is a free
        // function declared in engine.h — not a method on Engine.
        {"paused",                IsPreviewPaused()},

        // Camera
        {"camera",                CameraToJson(engine->GetCamera())},

        // Wind / gravity — read-only via DTO for now (no setter binding).
        {"wind",                  Vec3ToJson(engine->GetWind())},
        {"gravity",               Vec3ToJson(engine->GetGravity())},

        // Spawner (Phase 3 Screen 8 Batch 4) — cached on the dispatcher.
        // Host doesn't yet own a SpawnerDriver*; the cache is what
        // spawner/start writes into and what subsequent snapshots read
        // back. Empty object when never set (shouldn't happen because
        // the constructor seeds it from DefaultSpawnerConfigJson()).
        {"spawner",               spawnerConfig.is_null() || spawnerConfig.empty()
                                      ? DefaultSpawnerConfigJson()
                                      : spawnerConfig},

        // Screen 4 Batch A — selected emitter (editor state). Serialise
        // -1 as JSON null so the schema's `number | null` discriminator
        // works without a sentinel-aware client.
        {"selectedEmitterId",     selectedEmitterId < 0
                                      ? json(nullptr)
                                      : json(selectedEmitterId)},

        // LT-4 D6 — active mod path. Empty wstring serialises as JSON
        // null so the React side treats "Unmodded" and "no mod state
        // yet" the same way. ModManager owns the canonical state;
        // BridgeDispatcher reads through and serialises here.
        {"activeModPath",         activeModPath.empty()
                                      ? json(nullptr)
                                      : json(WideToUtf8(activeModPath))},
    };
}

} // namespace

BridgeDispatcher::BridgeDispatcher(Engine* engine, LayoutBroker& layout,
                                    AcceleratorBridge& accel, EmitFn emit)
    : m_engine(engine), m_layout(layout), m_accel(accel), m_emit(std::move(emit))
{
    // Seed the recent-files list from the registry at construction so
    // the first React-side `file/recent/list` request already has data
    // (avoids the React menu rendering "(none)" momentarily on first
    // mount even when the user has prior history).
    m_recentFiles = ReadRecentFiles();

    // Phase 3 Screen 8 Batch 4: seed the spawner-config cache from the
    // shared default JSON so the first snapshot returns the same struct
    // a freshly-constructed `SpawnerConfig()` would. Subsequent
    // spawner/start requests overwrite this in DispatchInternal.
    m_spawnerConfig = DefaultSpawnerConfigJson();
}

void BridgeDispatcher::Dispatch(const std::string& jsonRequest)
{
    json parsed;
    try
    {
        parsed = json::parse(jsonRequest);
    }
    catch (const json::exception& e)
    {
        // No correlation id — log and drop. React will time out on its
        // side; better than emitting a malformed envelope.
        fprintf(stderr, "[host] BridgeDispatcher: parse error: %s\n", e.what());
        return;
    }

    // We only handle `type: "req"` from React in this dispatcher. Events
    // and responses originating from React aren't part of the contract.
    const auto typeIt = parsed.find("type");
    if (typeIt == parsed.end() || !typeIt->is_string() || typeIt->get<std::string>() != "req")
    {
        return;
    }

    json res = DispatchInternal(parsed);
    // Drop responses that have no id (malformed request, can't correlate).
    if (m_emit && res.contains("id") && res["id"].is_string())
    {
        m_emit(res.dump());
    }
}

std::string BridgeDispatcher::DispatchSync(const std::string& jsonRequest)
{
    json parsed;
    try
    {
        parsed = json::parse(jsonRequest);
    }
    catch (const json::exception& e)
    {
        // Host-object channel — return a well-formed error envelope so
        // the JS side can JSON.parse it without throwing.
        json err = {
            {"type",  "res"},
            {"id",    nullptr},
            {"ok",    false},
            {"error", std::string("parse error: ") + e.what()},
        };
        return err.dump();
    }

    const auto typeIt = parsed.find("type");
    if (typeIt == parsed.end() || !typeIt->is_string() || typeIt->get<std::string>() != "req")
    {
        json err = {
            {"type",  "res"},
            {"id",    nullptr},
            {"ok",    false},
            {"error", "expected type: \"req\""},
        };
        return err.dump();
    }

    return DispatchInternal(parsed).dump();
}

json BridgeDispatcher::DispatchInternal(const nlohmann::json& parsed)
{
    std::string id;
    if (auto it = parsed.find("id"); it != parsed.end() && it->is_string())
    {
        id = it->get<std::string>();
    }
    std::string kind;
    if (auto it = parsed.find("kind"); it != parsed.end() && it->is_string())
    {
        kind = it->get<std::string>();
    }
    const json params = parsed.value("params", json::object());

    // Response envelope built by the kind-handler ladder. Setting
    // `responseSet` causes the ladder to fall through to return; the
    // default (no kind matched) becomes the "not implemented" branch.
    // Response envelope built by the kind-handler ladder. `sendOk` /
    // `sendErr` write into `res`, then handlers `return res`.
    json res;

    auto setRes = [&](json env)
    {
        res = std::move(env);
        if (!id.empty()) res["id"] = id; else res["id"] = nullptr;
    };
    auto sendOk = [&](const json& data) {
        setRes(json{{"type","res"},{"ok",true},{"data",data}});
    };
    auto sendErr = [&](const std::string& msg) {
        setRes(json{{"type","res"},{"ok",false},{"error",msg}});
    };

    if (kind.empty())
    {
        sendErr("missing kind");
        return res;
    }

    // Every engine/* handler routes through this guard: if the engine
    // isn't yet constructed (or has been torn down), refuse the request
    // with a structured error instead of crashing on a null deref.
    auto requireEngine = [&](const char* what) -> bool {
        if (m_engine) return true;
        sendErr(std::string("engine not constructed (") + what + ")");
        return false;
    };

    // Phase 3 Screen 8 Batch 3: every mutating engine/set/* and
    // engine/action/* (the destructive ones) ends with a SetDirty(true)
    // so the dirty flag + dirty/changed event fire after the parameter
    // change. SetDirty itself debounces (no-op when already dirty), so
    // repeated mutations don't spam the event channel.
    auto markDirty = [&]() { SetDirty(true); };

    // -------- layout/viewport-rect --------
    if (kind == "layout/viewport-rect")
    {
        int x = params.value("x", 0);
        int y = params.value("y", 0);
        int w = params.value("w", 0);
        int h = params.value("h", 0);
        m_layout.Apply(x, y, w, h);
        sendOk(json::object());
        return res;
    }

    // -------- viewport/occlude --------
    // Register/clear a chrome-rectangle that overlaps the viewport
    // popup. FD9b: LayoutBroker translates the main-client rect to
    // popup-client coords and forwards to AlphaCompositor, which
    // per-frame stamps a smoothstep-feathered alpha hole into the
    // layered popup's DIB before UpdateLayeredWindow. Chrome HTML
    // (menus, panels) underneath shows through with soft edges.
    if (kind == "viewport/occlude")
    {
        const std::string id = params.value("id", std::string{});
        if (id.empty())
        {
            sendErr("viewport/occlude requires a non-empty id");
            return res;
        }
        if (params.contains("rect") && params["rect"].is_object())
        {
            const auto& r = params["rect"];
            int x = r.value("x", 0);
            int y = r.value("y", 0);
            int w = r.value("w", 0);
            int h = r.value("h", 0);
            int feather = params.value("feather", 0);
            printf("[Occlude] SET id=%s rect=(%d,%d,%d,%d) feather=%d\n",
                   id.c_str(), x, y, w, h, feather); fflush(stdout);
            m_layout.SetOcclusion(id, x, y, w, h, feather);
        }
        else
        {
            printf("[Occlude] CLEAR id=%s\n", id.c_str()); fflush(stdout);
            // rect=null or missing → remove the occlusion.
            m_layout.RemoveOcclusion(id);
        }
        sendOk(json::object());
        return res;
    }

    // -------- viewport/capture-snapshot --------
    // B1.3.1.1: React's Modal primitive calls this on open to grab a
    // frozen image of the engine viewport. It then renders the PNG as
    // an <img> portaled into the WebView2 viewport DOM and full-occludes
    // the engine popup — so Dialog.Overlay's `backdrop-blur-sm` can
    // blur engine + panels uniformly without any popup-boundary seam.
    // The compositor caches the most-recent pre-stamp frame, so the
    // capture sees the raw engine output without chrome cut-outs and
    // without any modal-mask dim that might already be active.
    //
    // Returns `{ pngBase64, w, h }`. When the compositor has no frame
    // yet (engine never composited, device just reset), returns an
    // empty string + zero dims so the React side can short-circuit
    // its <img> render.
    if (kind == "viewport/capture-snapshot")
    {
        std::string pngBase64;
        int w = 0;
        int h = 0;
        if (m_layout.CaptureSnapshotPng(pngBase64, w, h))
        {
            sendOk(json{{"pngBase64", std::move(pngBase64)}, {"w", w}, {"h", h}});
        }
        else
        {
            sendOk(json{{"pngBase64", ""}, {"w", 0}, {"h", 0}});
        }
        return res;
    }

    // -------- register-accelerators --------
    if (kind == "register-accelerators")
    {
        auto combos = params.value("combos", std::vector<std::string>{});
        m_accel.RegisterCombos(combos);
        fprintf(stderr, "[host] AcceleratorBridge registered %zu combo(s)\n", combos.size());
        sendOk(json::object());
        return res;
    }

    // -------- app/quit -----------------------------------------------
    //
    // FD10 (Group D): React File → Exit dispatches this after the
    // dirty-prompt clears. PostMessage WM_CLOSE so the existing
    // DefWindowProc → DestroyWindow → WM_DESTROY shutdown chain
    // (compositor + engine teardown, WM_QUIT post) runs unchanged.
    // Using PostMessage (not SendMessage) so the response envelope
    // gets emitted before the message pump processes WM_CLOSE.
    if (kind == "app/quit")
    {
        sendOk(json::object());
        if (m_hostHwnd != nullptr)
        {
            PostMessage(m_hostHwnd, WM_CLOSE, 0, 0);
        }
        return res;
    }

    // -------- mods/list, mods/select, mods/refresh (LT-4 D6) --------
    //
    // Three thin wrappers around ModManager. ModManager owns the
    // canonical state (mods vector + selectedModPath) and the
    // side-effect chain on selection (FileManager swap, registry
    // persist, palette swap, thumbnail cache clear, engine shader/
    // texture reload). The dispatcher's job is JSON in / JSON out plus
    // a single engine/state/changed emit on `select` so subscribed
    // React components see the new activeModPath without a separate
    // request.
    //
    // Helper closure for serialising a mods/list payload (used by both
    // mods/list and mods/refresh — same response shape).
    auto buildModsListPayload = [this]() -> json {
        json arr = json::array();
        const auto& mods = m_modManager->GetMods();
        for (const auto& m : mods)
        {
            arr.push_back(json{
                {"path",       WideToUtf8(m.path)},
                {"folderName", WideToUtf8(m.folderName)},
                {"nickname",   WideToUtf8(m.nickname)},
                {"isFoC",      m.isFoC},
            });
        }
        const std::wstring& sel = m_modManager->GetSelectedModPath();
        return json{
            {"mods",       arr},
            {"activePath", sel.empty() ? json(nullptr) : json(WideToUtf8(sel))},
        };
    };

    if (kind == "mods/list")
    {
        if (!m_modManager)
        {
            sendOk(json{
                {"mods", json::array()},
                {"activePath", json(nullptr)},
            });
            return res;
        }
        sendOk(buildModsListPayload());
        return res;
    }

    if (kind == "mods/refresh")
    {
        if (!m_modManager)
        {
            sendOk(json{
                {"mods", json::array()},
                {"activePath", json(nullptr)},
            });
            return res;
        }
        m_modManager->DiscoverMods();
        // ModManager keeps selectedModPath as-is on refresh; if the
        // path no longer exists on disk the React UI will see a
        // "ghost" selection until the user picks something else. This
        // matches the legacy WM_COMMAND ID_MOD_REFRESH branch in
        // main.cpp which has the same behaviour for symmetry.
        sendOk(buildModsListPayload());
        return res;
    }

    if (kind == "mods/select")
    {
        if (!m_modManager)
        {
            sendOk(json{{"ok", false}, {"error", "ModManager not bound"}});
            return res;
        }
        // params.path is `string | null` — JSON null means Unmodded.
        // Treat missing / non-string as Unmodded too (defensive).
        std::wstring path;
        auto pit = params.find("path");
        if (pit != params.end() && pit->is_string())
        {
            path = Utf8ToWide(pit->get<std::string>());
        }
        bool ok = m_modManager->SelectMod(path);
        // Whether shader-reload failed or not, the FileManager + registry
        // + palette updates have rolled forward — broadcast the new
        // active path so the menu re-ticks even if shaders complain.
        EmitEngineStateChanged();
        const std::wstring& sel = m_modManager->GetSelectedModPath();
        sendOk(json{
            {"ok",         ok},
            {"activePath", sel.empty() ? json(nullptr) : json(WideToUtf8(sel))},
        });
        return res;
    }

    // -------- engine/state/snapshot --------
    if (kind == "engine/state/snapshot")
    {
        if (!requireEngine("snapshot")) return res;
        // Spawner field: prefer the live driver config (LT-4
        // host-state plumbing), fall back to the JSON cache from
        // Batch 4 when no driver is bound (e.g. unit tests, partial
        // wiring during construction).
        json spawnerJson = m_spawnerDriver
            ? SpawnerConfigToJson(m_spawnerDriver->GetConfig())
            : m_spawnerConfig;
        const std::wstring& activeModPath = m_modManager ? m_modManager->GetSelectedModPath() : std::wstring();
        const bool leaveParticles = (m_pParticleSystem != nullptr && *m_pParticleSystem)
            ? (*m_pParticleSystem)->getLeaveParticles()
            : true;
        sendOk(BuildEngineStateSnapshot(m_engine, m_currentFilePath, m_dirty, spawnerJson, m_selectedEmitterId, activeModPath, leaveParticles));
        return res;
    }

    // -------- engine/set/* (17 handlers) --------
    if (kind == "engine/set/ground")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->SetGround(params.value("enabled", false));
        sendOk(json::object());
        markDirty();
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/ground-z")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->SetGroundZ(params.value("z", 0.0f));
        sendOk(json::object());
        markDirty();
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/ground-texture")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->SetGroundTexture(params.value("slot", 0));
        sendOk(json::object());
        markDirty();
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/ground-solid-color")
    {
        if (!requireEngine(kind.c_str())) return res;
        unsigned int rgb = params.value("rgb", 0u);
        m_engine->SetGroundSolidColor(static_cast<COLORREF>(rgb));
        sendOk(json::object());
        markDirty();
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/ground-slot-custom-path")
    {
        if (!requireEngine(kind.c_str())) return res;
        int slot = params.value("slot", -1);
        std::string p = params.value("path", std::string{});
        m_engine->SetGroundSlotCustomPath(slot, Utf8ToWide(p));
        sendOk(json::object());
        markDirty();
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/skydome-slot")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->SetSkydomeSlot(params.value("slot", 0));
        sendOk(json::object());
        markDirty();
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/skydome-custom-path")
    {
        if (!requireEngine(kind.c_str())) return res;
        int slot = params.value("slot", -1);
        std::string p = params.value("path", std::string{});
        m_engine->SetSkydomeCustomPath(slot, Utf8ToWide(p));
        sendOk(json::object());
        markDirty();
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/background")
    {
        if (!requireEngine(kind.c_str())) return res;
        unsigned int rgb = params.value("rgb", 0u);
        m_engine->SetBackground(static_cast<COLORREF>(rgb));
        sendOk(json::object());
        markDirty();
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/bloom")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->SetBloom(params.value("enabled", false));
        sendOk(json::object());
        markDirty();
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/bloom-strength")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->SetBloomStrength(params.value("v", 0.0f));
        sendOk(json::object());
        markDirty();
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/bloom-cutoff")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->SetBloomCutoff(params.value("v", 0.0f));
        sendOk(json::object());
        markDirty();
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/bloom-size")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->SetBloomSize(params.value("v", 0.0f));
        sendOk(json::object());
        markDirty();
        EmitEngineStateChanged();
        return res;
    }
    // Task 2.7 — leave particles after instance death. Persisted with
    // the ParticleSystem (chunk-serialised at [ParticleSystem.cpp:948])
    // so dirty must flip. Engine::KillParticleSystem honors the flag at
    // [src/engine.cpp:197].
    if (kind == "engine/set/leave-particles")
    {
        bool enabled = params.value("enabled", true);
        if (m_pParticleSystem != nullptr && *m_pParticleSystem)
        {
            (*m_pParticleSystem)->setLeaveParticles(enabled);
            sendOk(json::object());
            markDirty();
            EmitEngineStateChanged();
        }
        else
        {
            sendOk(json{{"ok", false}, {"error", "no particle system bound"}});
        }
        return res;
    }
    if (kind == "engine/set/heat-debug")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->SetHeatDebug(params.value("enabled", false));
        sendOk(json::object());
        // LT-4: heat-debug is a view-only debug overlay. Don't mark dirty.
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/camera")
    {
        if (!requireEngine(kind.c_str())) return res;
        Engine::Camera cam;
        cam.Position = JsonToVec3(params.value("position", json::array()));
        cam.Target   = JsonToVec3(params.value("target",   json::array()));
        cam.Up       = JsonToVec3(params.value("up",       json::array()));
        m_engine->SetCamera(cam);
        sendOk(json::object());
        markDirty();
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/light")
    {
        if (!requireEngine(kind.c_str())) return res;
        std::string which = params.value("which", std::string{"sun"});
        Engine::Light l;
        l.Diffuse   = JsonToVec4(params.value("diffuse",   json::array()));
        l.Specular  = JsonToVec4(params.value("specular",  json::array()));
        l.Position  = JsonToVec4(params.value("position",  json::array()));
        l.Direction = JsonToVec4(params.value("direction", json::array()));
        m_engine->SetLight(ParseLightWhich(which), l);
        sendOk(json::object());
        markDirty();
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/ambient")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->SetAmbient(JsonToVec4(params.value("color", json::array())));
        sendOk(json::object());
        markDirty();
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/shadow")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->SetShadow(JsonToVec4(params.value("color", json::array())));
        sendOk(json::object());
        markDirty();
        EmitEngineStateChanged();
        return res;
    }
    // View state (preview clock). SetPreviewPaused is a free function in
    // engine.h — sibling to IsPreviewPaused/StepPreviewFrames. Doesn't
    // touch Engine state, but the snapshot reads paused so a broadcast
    // keeps any subscriber's mirror in sync.
    if (kind == "engine/set/paused")
    {
        SetPreviewPaused(params.value("paused", false));
        sendOk(json::object());
        // LT-4: paused is a view-only toggle (preview clock). Don't mark dirty.
        EmitEngineStateChanged();
        return res;
    }

    // -------- engine/action/reset-view-settings ----------------------
    //
    // FD10 (Group D): cascade reset for the View → Reset View Settings
    // menu. Mirrors legacy main.cpp:1733-1808: pushes engine defaults
    // for background, ground (visibility + Z + texture), bloom (off +
    // canonical strength/cutoff/size), and skydome (Off slot). Lighting
    // reset rides with D4 (separate handler around Force Align).
    //
    // Defaults match the Engine constructor (engine.cpp:1690-1715) —
    // kept in sync by hand because there's only one canonical value
    // each. Editor state (current path, dirty bit, selection) is left
    // alone since it isn't a "view setting."
    if (kind == "engine/action/reset-view-settings")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->SetBackground(RGB(0x14, 0x08, 0x34));
        m_engine->SetGround(true);
        m_engine->SetGroundZ(0.0f);
        m_engine->SetGroundTexture(0);
        m_engine->SetBloom(false);
        m_engine->SetBloomStrength(0.00f);
        m_engine->SetBloomCutoff (0.90f);
        m_engine->SetBloomSize   (0.10f);
        m_engine->SetSkydomeSlot(0);  // "Off"
        sendOk(json::object());
        // No markDirty — these are view settings, not particle-system
        // mutations. The user-visible cascade is communicated by a
        // single state-changed broadcast.
        EmitEngineStateChanged();
        return res;
    }

    // -------- engine/action/* --------
    if (kind == "engine/action/clear")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->Clear();
        sendOk(json::object());
        markDirty();
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/action/reload-shaders")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->ReloadShaders();
        sendOk(json::object());
        // No dirty: reload-shaders re-reads disk; user state is unchanged.
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/action/reload-textures")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->ReloadTextures();
        sendOk(json::object());
        // No dirty: reload-textures re-reads disk; user state is unchanged.
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/action/on-particle-system-changed")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->OnParticleSystemChanged(params.value("track", 0));
        sendOk(json::object());
        // No engine/state/changed broadcast — engine re-renders next frame.
        return res;
    }
    // Advance the preview clock by N frames. The free function is a
    // no-op when not paused, so the React Toolbar disables the button in
    // that state; no need to guard it here. Don't broadcast a state
    // change — the action emits zero or more state ticks via the normal
    // render loop, and an immediate broadcast would misleadingly suggest
    // a sync-time mutation.
    if (kind == "engine/action/step-frames")
    {
        StepPreviewFrames(params.value("frames", 1));
        sendOk(json::object());
        return res;
    }
    // Rescale the active particle system by a duration / size percentage.
    // LT-4 host-state plumbing: real implementation. Iterates over every
    // emitter in the live ParticleSystem and applies the helper from
    // src/Rescale.cpp. UndoStack capture is best-effort — Phase 3 emitter
    // work hasn't seeded the stack baseline yet (see undo/perform notes
    // below), so a Capture here lands in an empty stack with no
    // pre-existing redo to clear; that's correct, it just means undo
    // remains a no-op until the broader capture wiring lands.
    if (kind == "engine/action/rescale-system")
    {
        float durPct  = params.value("durationScalePercent", 100.0f);
        float sizePct = params.value("sizeScalePercent",     100.0f);
        if (m_pParticleSystem == nullptr || !*m_pParticleSystem)
        {
            sendErr("particle system not bound");
            return res;
        }
        ParticleSystem* sys = m_pParticleSystem->get();
        const float timeScale = durPct  / 100.0f;
        const float sizeScale = sizePct / 100.0f;
        // Walk every emitter, not just roots — DoRescaleEmitter only
        // touches per-emitter scalar fields and doesn't recurse, so we
        // need to iterate the flat list. Mirrors the loop at
        // src/Rescale.cpp:181 used by RescaleParticleSystem.
        auto& emitters = sys->getEmitters();
        for (size_t i = 0; i < emitters.size(); ++i)
        {
            if (emitters[i] != nullptr)
                DoRescaleEmitter(emitters[i], timeScale, sizeScale);
        }
        sendOk(json::object());
        markDirty();
        EmitEngineStateChanged();
        // Emitter parameters changed → notify the React tree so the
        // sidebar re-fetches via emitters/list.
        EmitEmittersTreeChanged();
        return res;
    }

    // -------- engine/query/* --------
    if (kind == "engine/query/ground-slot-empty")
    {
        if (!requireEngine(kind.c_str())) return res;
        sendOk(json(m_engine->IsGroundSlotEmpty(params.value("slot", -1))));
        return res;
    }
    if (kind == "engine/query/skydome-slot-empty")
    {
        if (!requireEngine(kind.c_str())) return res;
        sendOk(json(m_engine->IsSkydomeSlotEmpty(params.value("slot", -1))));
        return res;
    }
    if (kind == "engine/query/bloom-available")
    {
        if (!requireEngine(kind.c_str())) return res;
        sendOk(json(m_engine->IsBloomAvailable()));
        return res;
    }

    // -------- undo/perform --------
    //
    // Task 2.4: the bridge surface for undo/redo is reachable, but the
    // new-UI mutation handlers above don't yet *capture* into m_undo —
    // Phase 3 emitter work will wrap each mutating Request with a
    // Capture() call. Until then the stack will be empty and
    // CanUndo/CanRedo return false, so `applied` is false. The handler
    // still routes through the real UndoStack so a future capture
    // surfaces immediately without touching this code.
    if (kind == "undo/perform")
    {
        std::string dir = params.value("direction", std::string("undo"));
        bool applied = false;
        if (m_undo)
        {
            const std::vector<char>* snap = nullptr;
            size_t selIdx = 0;
            if (dir == "undo" && m_undo->CanUndo())
            {
                applied = m_undo->Undo(&snap, &selIdx);
            }
            else if (dir == "redo" && m_undo->CanRedo())
            {
                applied = m_undo->Redo(&snap, &selIdx);
            }
            // NOTE: when Phase 3 begins capturing into m_undo, the
            // ParticleSystem swap-and-restore lives here — Deserialize
            // the snapshot, hand it to the engine, fire
            // EmitEngineStateChanged. Today's stack stays empty so
            // there's nothing to apply.
        }
        sendOk(json{{"applied", applied}});
        if (applied) EmitEngineStateChanged();
        return res;
    }

    // -------- file/* (Phase 3 Screen 8 Batch 3) ----------------------
    //
    // The new-UI host doesn't yet own a ParticleSystem* (emitter / file-
    // load wiring is later-batch work in Phase 3+). So the file handlers
    // perform the *editor-level* side of the operation — currentFilePath
    // tracking, dirty flag, recent-files registry, native picker
    // round-trip — but skip the engine-level ParticleSystem read/write
    // until that pointer exists. Same forward-compatible no-op pattern
    // as engine/action/rescale-system in Batch 1. Legacy `DoNewFile` /
    // `DoOpenFile` / `DoSaveFile` at [src/main.cpp:1289-1393] continue
    // to serve `--legacy-ui` unchanged — they're coupled to
    // `APPLICATION_INFO*` which doesn't exist in --new-ui mode, so
    // calling them directly from here isn't possible.

    // -------- file/new --------
    // LT-4: replace the host-owned ParticleSystem with a fresh empty
    // one + one root emitter (mirrors legacy DoNewFile at
    // src/main.cpp:1289). Clear editor path / dirty.
    if (kind == "file/new")
    {
        // LT-4 shift-click-to-spawn: if the user is mid-Shift-hold when
        // they hit file/new, kill the cursor-bound instance before
        // dropping the ParticleSystem it was spawned from. Mirrors the
        // legacy DoNewFile teardown sequence for `attachedParticleSystem`
        // at src/main.cpp:1289-1305.
        if (m_ppAttachedParticleSystem && *m_ppAttachedParticleSystem && m_engine)
        {
            m_engine->KillParticleSystem(*m_ppAttachedParticleSystem);
            *m_ppAttachedParticleSystem = nullptr;
        }
        if (m_pParticleSystem)
        {
            *m_pParticleSystem = std::make_unique<ParticleSystem>();
            (*m_pParticleSystem)->addRootEmitter();
        }
        // LT-4 render loop: notify Engine that the ParticleSystem pointer
        // it knows about is now stale. Mirrors legacy DoNewFile at
        // src/main.cpp:1207 (Clear() then OnParticleSystemChanged(-1))
        // so the engine drops cached instances + per-emitter state.
        if (m_engine)
        {
            m_engine->Clear();
            m_engine->OnParticleSystemChanged(-1);
        }
        m_currentFilePath.clear();
        sendOk(json::object());
        SetDirty(false);
        EmitEngineStateChanged();
        // B1.3.1 polish round 3: React's EmitterTree subscribes to
        // emitters/tree/changed; without this emit the tree stays on
        // its pre-file/new state even after the ParticleSystem has
        // been swapped under it.
        EmitEmittersTreeChanged();
        return res;
    }

    // -------- file/open --------
    //
    // Two modes:
    //   - If `params.path` is provided (Recent Files / drag-drop / Open
    //     dialog already resolved on the React side), use it directly.
    //   - Otherwise pop GetOpenFileNameW. The native dialog runs a
    //     nested message loop; host pump pauses for the dialog's
    //     lifetime, which is fine because the JS caller is awaiting.
    //
    // Both modes commit the path into m_currentFilePath, push to
    // recents, fire recent/changed + engine/state/changed, and clear
    // dirty. Actual ParticleSystem load is forward-deferred.
    if (kind == "file/open")
    {
        std::wstring path;
        if (auto pit = params.find("path"); pit != params.end() && pit->is_string())
        {
            path = Utf8ToWide(pit->get<std::string>());
        }
        // Resolve optional filter discriminator. Default "alo" keeps
        // File→Open / recents / drag-drop behaviour unchanged; the
        // picker panels pass "skydome" / "ground" so the dialog
        // defaults to the texture filter the user actually needs AND
        // the post-pick load path is skipped (textures aren't .alo
        // files).
        std::string filterId = "alo";
        if (auto fit = params.find("filter"); fit != params.end() && fit->is_string())
        {
            filterId = fit->get<std::string>();
        }

        if (path.empty())
        {
            const wchar_t* lpstrFilter = L"Particle Files (*.alo)\0*.alo\0All Files (*.*)\0*.*\0\0";
            const wchar_t* lpstrTitle  = L"Open particle system";
            if (filterId == "skydome")
            {
                lpstrFilter = L"Texture Files (*.dds;*.tga)\0*.dds;*.tga\0All Files (*.*)\0*.*\0\0";
                lpstrTitle  = L"Open skydome texture";
            }
            else if (filterId == "ground")
            {
                lpstrFilter = L"Texture Files (*.dds;*.tga)\0*.dds;*.tga\0All Files (*.*)\0*.*\0\0";
                lpstrTitle  = L"Open ground texture";
            }

            wchar_t buf[MAX_PATH] = {};
            OPENFILENAMEW ofn = {};
            ofn.lStructSize = sizeof(ofn);
            ofn.hwndOwner   = m_hostHwnd;
            ofn.lpstrFile   = buf;
            ofn.nMaxFile    = MAX_PATH;
            ofn.lpstrFilter = lpstrFilter;
            ofn.lpstrTitle  = lpstrTitle;
            ofn.Flags       = OFN_PATHMUSTEXIST | OFN_FILEMUSTEXIST | OFN_NOCHANGEDIR;

            if (!GetOpenFileNameW(&ofn))
            {
                // User cancelled / dialog failure.
                sendOk(json{{"ok", false}, {"error", "user-cancelled"}});
                return res;
            }
            path = buf;
        }

        // Texture-picker variants short-circuit here: just return the
        // path so the React side can route it through the appropriate
        // engine setter (engine/set/skydome-custom-path or
        // engine/set/ground-slot-custom-path). Don't touch
        // m_currentFilePath / recents / engine state — those belong to
        // the "open particle system" semantics of the .alo path below.
        if (filterId != "alo")
        {
            sendOk(json{{"ok", true}, {"path", WideToUtf8(path)}});
            return res;
        }

        // LT-4: actually load the .alo into the host-owned slot.
        std::string err;
        std::unique_ptr<ParticleSystem> loaded = LoadParticleSystem(path, &err);
        if (!loaded)
        {
            // Don't touch m_currentFilePath / recents on failure —
            // matches legacy LoadFile behaviour (history append only
            // happens after a successful parse).
            sendOk(json{{"ok", false}, {"error", err.empty() ? std::string("load failed") : err}});
            return res;
        }
        // LT-4 shift-click-to-spawn: kill any cursor-bound instance
        // attached to the about-to-be-replaced ParticleSystem before
        // swapping. Same reasoning as the file/new branch above.
        if (m_ppAttachedParticleSystem && *m_ppAttachedParticleSystem && m_engine)
        {
            m_engine->KillParticleSystem(*m_ppAttachedParticleSystem);
            *m_ppAttachedParticleSystem = nullptr;
        }
        if (m_pParticleSystem)
        {
            *m_pParticleSystem = std::move(loaded);
        }
        // LT-4 render loop: same notification sequence as file/new —
        // the engine's cached per-instance / per-emitter state is now
        // stale and must be cleared. Matches legacy DoOpenFile path
        // at src/main.cpp:1341.
        if (m_engine)
        {
            m_engine->Clear();
            m_engine->OnParticleSystemChanged(-1);
            // B1.3.1 polish round 3: legacy DoOpenFile relies on
            // first-render lazy texture binding via per-instance
            // construction; in --new-ui mode the host's WebView2
            // composition timing produces white-fallback particles
            // unless we explicitly invalidate the cache. ReloadTextures
            // is the same operation View → Reload Textures already
            // does on demand; calling it here makes file/open
            // self-sufficient.
            m_engine->ReloadTextures();
        }
        m_currentFilePath = path;
        m_recentFiles = WriteRecentFile(path);
        sendOk(json{{"ok", true}, {"path", WideToUtf8(path)}});
        SetDirty(false);
        EmitRecentChanged();
        EmitEngineStateChanged();
        // B1.3.1 polish round 3: React's EmitterTree subscribes to
        // emitters/tree/changed; without this emit the tree stays on
        // the previous file's emitters even though the engine now
        // holds the new file's ParticleSystem.
        EmitEmittersTreeChanged();
        return res;
    }

    // -------- file/save --------
    //
    // If `params.path` provided, use it. Else if m_currentFilePath is
    // set (named document), save there. Else pop GetSaveFileNameW.
    // Matches legacy `DoSaveFile(info, /*saveas=*/false)`.
    if (kind == "file/save")
    {
        std::wstring path;
        if (auto pit = params.find("path"); pit != params.end() && pit->is_string())
        {
            path = Utf8ToWide(pit->get<std::string>());
        }
        if (path.empty()) path = m_currentFilePath;
        if (path.empty())
        {
            // No remembered path → pop save-as picker.
            wchar_t buf[MAX_PATH] = {};
            OPENFILENAMEW ofn = {};
            ofn.lStructSize = sizeof(ofn);
            ofn.hwndOwner   = m_hostHwnd;
            ofn.lpstrFile   = buf;
            ofn.nMaxFile    = MAX_PATH;
            ofn.lpstrFilter = L"Particle Files (*.alo)\0*.alo\0All Files (*.*)\0*.*\0\0";
            ofn.lpstrDefExt = L"alo";
            ofn.lpstrTitle  = L"Save particle system";
            ofn.Flags       = OFN_PATHMUSTEXIST | OFN_OVERWRITEPROMPT | OFN_NOCHANGEDIR;

            if (!GetSaveFileNameW(&ofn))
            {
                sendOk(json{{"ok", false}, {"error", "user-cancelled"}});
                return res;
            }
            path = buf;
        }

        // LT-4: actually write the host-owned ParticleSystem to disk.
        if (m_pParticleSystem == nullptr || !*m_pParticleSystem)
        {
            sendOk(json{{"ok", false}, {"error", "particle system not bound"}});
            return res;
        }
        std::string err;
        if (!SaveParticleSystem(m_pParticleSystem->get(), path, &err))
        {
            sendOk(json{{"ok", false}, {"error", err.empty() ? std::string("save failed") : err}});
            return res;
        }
        m_currentFilePath = path;
        m_recentFiles = WriteRecentFile(path);
        sendOk(json{{"ok", true}, {"path", WideToUtf8(path)}});
        SetDirty(false);
        EmitRecentChanged();
        EmitEngineStateChanged();
        return res;
    }

    // -------- file/save-as --------
    //
    // ALWAYS pops GetSaveFileNameW. Matches legacy
    // `DoSaveFile(info, /*saveas=*/true)`. Same path-commit / recents /
    // dirty side effects as file/save.
    if (kind == "file/save-as")
    {
        wchar_t buf[MAX_PATH] = {};
        // Seed with the current filename so the dialog opens at the
        // existing path's directory — matches legacy save-as ergonomics.
        if (!m_currentFilePath.empty() &&
            m_currentFilePath.size() < MAX_PATH)
        {
            wcscpy_s(buf, MAX_PATH, m_currentFilePath.c_str());
        }
        OPENFILENAMEW ofn = {};
        ofn.lStructSize = sizeof(ofn);
        ofn.hwndOwner   = m_hostHwnd;
        ofn.lpstrFile   = buf;
        ofn.nMaxFile    = MAX_PATH;
        ofn.lpstrFilter = L"Particle Files (*.alo)\0*.alo\0All Files (*.*)\0*.*\0\0";
        ofn.lpstrDefExt = L"alo";
        ofn.lpstrTitle  = L"Save particle system as";
        ofn.Flags       = OFN_PATHMUSTEXIST | OFN_OVERWRITEPROMPT | OFN_NOCHANGEDIR;

        if (!GetSaveFileNameW(&ofn))
        {
            sendOk(json{{"ok", false}, {"error", "user-cancelled"}});
            return res;
        }

        std::wstring path = buf;
        // LT-4: actually write to disk.
        if (m_pParticleSystem == nullptr || !*m_pParticleSystem)
        {
            sendOk(json{{"ok", false}, {"error", "particle system not bound"}});
            return res;
        }
        std::string err;
        if (!SaveParticleSystem(m_pParticleSystem->get(), path, &err))
        {
            sendOk(json{{"ok", false}, {"error", err.empty() ? std::string("save failed") : err}});
            return res;
        }
        m_currentFilePath = path;
        m_recentFiles = WriteRecentFile(path);
        sendOk(json{{"ok", true}, {"path", WideToUtf8(path)}});
        SetDirty(false);
        EmitRecentChanged();
        EmitEngineStateChanged();
        return res;
    }

    // -------- file/recent/list --------
    //
    // Re-reads the registry on every call. Cheap (≤ 9 entries) and
    // means the list stays in lockstep with legacy AppendHistory writes
    // that happen in --legacy-ui sessions.
    if (kind == "file/recent/list")
    {
        m_recentFiles = ReadRecentFiles();
        json paths = json::array();
        for (const auto& w : m_recentFiles) paths.push_back(WideToUtf8(w));
        sendOk(json{{"paths", paths}});
        return res;
    }

    // -------- spawner/* (Phase 3 Screen 8 Batch 4) -------------------
    //
    // The new-UI host doesn't yet own a SpawnerDriver* (matches Batch 3
    // for ParticleSystem*). The handlers do the *editor-level* side of
    // the work: cache the incoming config in m_spawnerConfig so a
    // subsequent engine/state/snapshot returns it, log the request for
    // diagnostics, and broadcast engine/state/changed so React sees the
    // updated config land. When SpawnerDriver wiring happens in a later
    // batch, the cached config can be passed directly into
    // `m_spawnerDriver->SetConfig(...)` from these same handlers.
    //
    // Note: spawner config is session state (matches legacy: "never
    // written into the .alo" per SpawnerDriver.h:16). It deliberately
    // does NOT set dirty=true.
    if (kind == "spawner/start")
    {
        // LT-4: cache + commit to the real driver. The cache is kept
        // updated so snapshot reads still work when no driver is bound
        // (Vitest / partial-wiring paths).
        m_spawnerConfig = params;
        if (m_spawnerDriver)
        {
            SpawnerConfig cfg = JsonToSpawnerConfig(params);
            ClampSpawnerConfig(cfg);
            m_spawnerDriver->SetConfig(cfg);
        }
        sendOk(json::object());
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "spawner/trigger")
    {
        // LT-4: real trigger. Note that without per-frame Tick wiring
        // the burst-state machine doesn't advance — Trigger schedules
        // a burst that won't actually fire instances until a later
        // batch wires SpawnerDriver::Tick into the render loop. That's
        // the documented out-of-scope item for this batch.
        if (m_spawnerDriver
            && m_pParticleSystem
            && *m_pParticleSystem
            && m_engine)
        {
            m_spawnerDriver->Trigger(m_pParticleSystem->get(), m_engine);
        }
        sendOk(json::object());
        return res;
    }
    if (kind == "spawner/stop")
    {
        // LT-4: flip enabled=false on the live driver. Auto-mode
        // bursts stop scheduling; manual triggers still work.
        if (m_spawnerDriver)
        {
            SpawnerConfig cfg = m_spawnerDriver->GetConfig();
            cfg.enabled = false;
            m_spawnerDriver->SetConfig(cfg);
        }
        // Keep the JSON cache in sync so snapshots without a bound
        // driver also reflect the stop.
        if (m_spawnerConfig.is_object())
        {
            m_spawnerConfig["enabled"] = false;
        }
        sendOk(json::object());
        EmitEngineStateChanged();
        return res;
    }

    // -------- emitters/preview-from-file ----------------------------
    //
    // LT-4: actually load the .alo into a temporary ParticleSystem and
    // build the EmitterTreeNode tree. The temporary system drops at
    // scope exit. Note we wrap the real roots under a synthetic
    // `id: 0, name: "root"` node to match the MockBridge response
    // shape — the schema's EmitterTreeNode is single-rooted but a
    // ParticleSystem can have multiple root emitters.
    if (kind == "emitters/preview-from-file")
    {
        std::string path8 = params.value("path", std::string{});
        if (path8.empty())
        {
            sendOk(json{{"ok", false}, {"error", "missing path"}});
            return res;
        }
        std::wstring path = Utf8ToWide(path8);
        std::string err;
        std::unique_ptr<ParticleSystem> tmp = LoadParticleSystem(path, &err);
        if (!tmp)
        {
            sendOk(json{
                {"ok",    false},
                {"error", err.empty() ? std::string("could not load file") : err},
            });
            return res;
        }
        // Build the synthetic root + per-actual-root children.
        json children = json::array();
        const auto& emitters = tmp->getEmitters();
        for (size_t i = 0; i < emitters.size(); ++i)
        {
            if (emitters[i] != nullptr && emitters[i]->parent == nullptr)
            {
                children.push_back(BuildEmitterTreeNode(tmp.get(), i));
            }
        }
        // Synthetic root carries id 0 (legacy convention for preview)
        // but uses the new shape fields (role / linkGroup / visible)
        // so consumers don't see undefined when the schema is read
        // strictly.
        json tree = {
            {"id",        0},
            {"name",      "root"},
            {"role",      "root"},
            {"linkGroup", 0},
            {"visible",   true},
            {"children",  children},
        };
        sendOk(json{{"ok", true}, {"tree", tree}});
        return res;
    }

    // -------- emitters/list -----------------------------------------
    //
    // Screen 4 Batch A — real implementation. Walks the live particle
    // system and returns a synthetic-root wrapper whose children are
    // the real top-level emitters. Returns an empty wrapper if no
    // system is bound (e.g. tests that haven't wired BindHostState).
    if (kind == "emitters/list")
    {
        json children = json::array();
        if (m_pParticleSystem != nullptr && *m_pParticleSystem)
        {
            const ParticleSystem* sys = m_pParticleSystem->get();
            const auto& emitters = sys->getEmitters();
            for (size_t i = 0; i < emitters.size(); ++i)
            {
                if (emitters[i] != nullptr && emitters[i]->parent == nullptr)
                {
                    children.push_back(BuildEmitterTreeNode(sys, i));
                }
            }
        }
        json tree = {
            {"id",        -1},
            {"name",      ""},
            {"role",      "root"},
            {"linkGroup", 0},
            {"visible",   true},
            {"children",  children},
        };
        sendOk(json{{"root", tree}});
        return res;
    }

    // -------- emitters/select ---------------------------------------
    //
    // Screen 4 Batch A — selection state lives on the dispatcher (it's
    // editor state, not engine state). Update the scalar, emit the
    // narrow `emitters/selected` event (subscribed to by EmitterTree)
    // and a follow-up engine/state/changed so any snapshot consumer
    // sees the new selectedEmitterId.
    if (kind == "emitters/select")
    {
        // params.id is `number | null` on the wire. Null deserialises
        // to a JSON null; we store as -1 internally and re-serialise
        // as JSON null on the way out (in BuildEngineStateSnapshot).
        int newId = -1;
        if (params.contains("id") && !params["id"].is_null())
            newId = params["id"].get<int>();

        // Validate against the live tree when bound — selecting an
        // index that isn't a real emitter resets to no-selection. This
        // matches the MockBridge's behaviour and keeps the snapshot
        // honest. When no system is bound we accept the id as-is so
        // tests without BindHostState still round-trip.
        if (newId >= 0 && m_pParticleSystem != nullptr && *m_pParticleSystem)
        {
            const auto& emitters = (*m_pParticleSystem)->getEmitters();
            if (static_cast<size_t>(newId) >= emitters.size() || emitters[newId] == nullptr)
                newId = -1;
        }

        m_selectedEmitterId = newId;
        sendOk(json::object());

        // emitters/selected event — narrow payload for components that
        // care only about the selection scalar (EmitterTree).
        if (m_emit)
        {
            json env = {
                {"type",    "evt"},
                {"kind",    "emitters/selected"},
                {"payload", json{{"id", newId < 0 ? json(nullptr) : json(newId)}}},
            };
            m_emit(env.dump());
        }

        // engine/state/changed so the snapshot's selectedEmitterId is
        // observable through the standard snapshot channel too.
        EmitEngineStateChanged();
        return res;
    }

    // -------- emitters/get-tracks (Screen 6 Batch A) ----------------
    //
    // Read-only. Serialises the named emitter's 7 tracks (Red, Green,
    // Blue, Alpha, Scale, Index, RotationSpeed in fixed order). Each
    // track's `keys` are emitted in ascending-time order (the source
    // `std::multiset<Key>` already orders by `time` via Key::operator<).
    // Interpolation enum maps as documented in
    // `bridge-schema/src/index.ts`:
    //   IT_LINEAR (0) → "linear"
    //   IT_SMOOTH (1) → "smooth"
    //   IT_STEP   (2) → "step"
    // IT_UNKNOWN (-1) is coerced to "linear" before sending so the
    // wire never carries the sentinel.
    //
    // Unknown id (or no system bound) returns 7 empty tracks rather
    // than ok:false — the React panel renders a "no data" stub instead
    // of an error toast on transient mismatches (e.g. selection lands
    // on an id that was just deleted).
    if (kind == "emitters/get-tracks")
    {
        static const char* kTrackNames[ParticleSystem::NUM_TRACKS] = {
            "red", "green", "blue", "alpha",
            "scale", "index", "rotationSpeed",
        };
        auto interpToString = [](ParticleSystem::Emitter::Track::InterpolationType it) -> const char* {
            switch (it)
            {
                case ParticleSystem::Emitter::Track::IT_LINEAR: return "linear";
                case ParticleSystem::Emitter::Track::IT_SMOOTH: return "smooth";
                case ParticleSystem::Emitter::Track::IT_STEP:   return "step";
                default: return "linear";
            }
        };

        int id = params.value("id", -1);
        json tracksArr = json::array();
        const ParticleSystem::Emitter* emit = nullptr;
        if (id >= 0 && m_pParticleSystem != nullptr && *m_pParticleSystem)
        {
            const auto& emitters = (*m_pParticleSystem)->getEmitters();
            if (static_cast<size_t>(id) < emitters.size() && emitters[id] != nullptr)
            {
                emit = emitters[id];
            }
        }
        for (int i = 0; i < ParticleSystem::NUM_TRACKS; i++)
        {
            json keysArr = json::array();
            const char* interp = "linear";
            if (emit != nullptr)
            {
                const ParticleSystem::Emitter::Track* t = emit->tracks[i];
                if (t != nullptr)
                {
                    // KeyMap is `std::multiset<Key>` ordered by time —
                    // a straight iteration emits keys in ascending
                    // time order.
                    for (const auto& k : t->keys)
                    {
                        keysArr.push_back(json{
                            {"time",  k.time},
                            {"value", k.value},
                        });
                    }
                    interp = interpToString(t->interpolation);
                }
            }
            // lockedTo: detect by pointer identity per the legacy
            // model — channel i is locked to channel j when
            // `tracks[i] == &trackContents[j]` (or transitively
            // `tracks[i] == tracks[j]`, which collapses to the same
            // pointer after the engine's file-load consolidation
            // pass). Only RGBA participate; other channels always
            // report null. Self-pointer (tracks[i] == &trackContents[i])
            // means "not locked" and also reports null.
            const char* lockedToName = nullptr;
            if (emit != nullptr && i < 4)
            {
                for (int j = 0; j < 4; j++)
                {
                    if (j == i) continue;
                    if (emit->tracks[i] == &emit->trackContents[j]
                        || emit->tracks[i] == emit->tracks[j])
                    {
                        // Only "earlier channel" locks are valid per
                        // the schema. If we matched a later channel
                        // via transitive equality, skip it — the
                        // earlier channel will be the canonical lock
                        // target when we hit it in this loop.
                        if (j < i)
                        {
                            lockedToName = kTrackNames[j];
                            break;
                        }
                    }
                }
            }
            tracksArr.push_back(json{
                {"name",          kTrackNames[i]},
                {"keys",          keysArr},
                {"interpolation", interp},
                {"lockedTo",      lockedToName == nullptr
                                      ? json(nullptr)
                                      : json(lockedToName)},
            });
        }
        sendOk(json{{"tracks", tracksArr}});
        return res;
    }

    // -------- Screen 4 Batch B1 — emitter mutations -----------------
    //
    // Each handler validates the target emitter, captures an undo
    // snapshot before mutating (best-effort — the UndoStack baseline
    // is still empty pre-Phase-3 capture wiring), mutates via the
    // ParticleSystem API, then emits `emitters/tree/changed` + dirty.

    // Lookup helper: find an emitter pointer by integer index. Returns
    // nullptr on out-of-range / no-system / null-slot. Used by all
    // emitter-mutation handlers below.
    auto getEmitterById = [&](int id) -> ParticleSystem::Emitter* {
        if (id < 0) return nullptr;
        if (m_pParticleSystem == nullptr || !*m_pParticleSystem) return nullptr;
        const auto& emitters = (*m_pParticleSystem)->getEmitters();
        if (static_cast<size_t>(id) >= emitters.size()) return nullptr;
        return emitters[id];
    };

    // Capture-undo helper. Wraps the dispatcher's m_undo with the
    // current selection index so a future undo restores the
    // pre-mutation state. coalesceKey=0 disables coalescing
    // (structural ops should never fold).
    auto captureUndo = [&]() {
        if (m_undo == nullptr || m_pParticleSystem == nullptr || !*m_pParticleSystem) return;
        const ParticleSystem* sys = m_pParticleSystem->get();
        size_t selIdx = SIZE_MAX;
        if (m_selectedEmitterId >= 0
            && static_cast<size_t>(m_selectedEmitterId) < sys->getEmitters().size())
        {
            selIdx = static_cast<size_t>(m_selectedEmitterId);
        }
        m_undo->Capture(*sys, selIdx, 0);
    };

    // -------- emitters/get-properties (Phase 4.1 Fix dispatch 1) ----
    //
    // Walks every editable Basic + Appearance + Physics field on the
    // named emitter and serialises into an EmitterPropertiesDto. The
    // `groups: GroupDto[]` field surfaces the 3 Group entries (NUM_GROUPS).
    // Unknown id / no system returns ok:false; the React panel
    // tolerates the failure by rendering the placeholder branch.
    if (kind == "emitters/get-properties")
    {
        int id = params.value("id", -1);
        const ParticleSystem::Emitter* emit = getEmitterById(id);
        if (emit == nullptr)
        {
            sendErr("emitter not found");
            return res;
        }

        // Helper: pack a Vec3 from three scalars.
        auto vec3 = [](float x, float y, float z) {
            return json::array({x, y, z});
        };

        json groupsArr = json::array();
        for (int g = 0; g < ParticleSystem::NUM_GROUPS; g++)
        {
            const auto& gr = emit->groups[g];
            groupsArr.push_back(json{
                {"type",            static_cast<int>(gr.type)},
                {"min",             vec3(gr.minX, gr.minY, gr.minZ)},
                {"max",             vec3(gr.maxX, gr.maxY, gr.maxZ)},
                {"sideLength",      gr.sideLength},
                {"sphereRadius",    gr.sphereRadius},
                {"sphereEdge",      static_cast<int>(gr.sphereEdge)},
                {"cylinderRadius",  gr.cylinderRadius},
                {"cylinderEdge",    static_cast<int>(gr.cylinderEdge)},
                {"cylinderHeight",  gr.cylinderHeight},
                {"val",             vec3(gr.valX, gr.valY, gr.valZ)},
            });
        }

        json props = {
            // ── Basic ───────────────────────────────────────────────
            {"name",                     emit->name},
            {"lifetime",                 emit->lifetime},
            {"initialDelay",             emit->initialDelay},
            {"useBursts",                emit->useBursts},
            {"nBursts",                  static_cast<int>(emit->nBursts)},
            {"burstDelay",               emit->burstDelay},
            {"nParticlesPerBurst",       static_cast<int>(emit->nParticlesPerBurst)},
            {"nParticlesPerSecond",      static_cast<int>(emit->nParticlesPerSecond)},
            {"randomLifetimePerc",       emit->randomLifetimePerc},
            {"randomScalePerc",          emit->randomScalePerc},
            {"randomRotation",           emit->randomRotation},
            {"randomRotationDirection",  emit->randomRotationDirection},
            {"randomRotationAverage",    emit->randomRotationAverage},
            {"randomRotationVariance",   emit->randomRotationVariance},
            {"freezeTime",               emit->freezeTime},
            {"skipTime",                 emit->skipTime},
            {"linkToSystem",             emit->linkToSystem},
            {"parentLinkStrength",       emit->parentLinkStrength},
            {"index",                    static_cast<int>(emit->index)},

            // ── Appearance ─────────────────────────────────────────
            {"colorTexture",             emit->colorTexture},
            {"normalTexture",            emit->normalTexture},
            {"blendMode",                static_cast<int>(emit->blendMode)},
            {"textureSize",              static_cast<int>(emit->textureSize)},
            {"nTriangles",               static_cast<int>(emit->nTriangles)},
            {"doColorAddGrayscale",      emit->doColorAddGrayscale},
            {"randomColors",             json::array({
                emit->randomColors[0], emit->randomColors[1],
                emit->randomColors[2], emit->randomColors[3],
            })},
            {"hasTail",                  emit->hasTail},
            {"tailSize",                 emit->tailSize},
            {"isHeatParticle",           emit->isHeatParticle},
            {"isWorldOriented",          emit->isWorldOriented},
            {"noDepthTest",              emit->noDepthTest},
            {"affectedByWind",           emit->affectedByWind},

            // ── Physics ────────────────────────────────────────────
            {"acceleration",             vec3(emit->acceleration[0],
                                              emit->acceleration[1],
                                              emit->acceleration[2])},
            {"gravity",                  emit->gravity},
            {"inwardSpeed",              emit->inwardSpeed},
            {"inwardAcceleration",       emit->inwardAcceleration},
            {"objectSpaceAcceleration",  emit->objectSpaceAcceleration},
            {"bounciness",               emit->bounciness},
            {"groundBehavior",           static_cast<int>(emit->groundBehavior)},
            {"emitFromMesh",             emit->emitFromMesh},
            {"emitFromMeshOffset",       emit->emitFromMeshOffset},
            {"isWeatherParticle",        emit->isWeatherParticle},
            {"weatherCubeSize",          emit->weatherCubeSize},
            {"weatherCubeDistance",      emit->weatherCubeDistance},
            {"weatherFadeoutDistance",   emit->weatherFadeoutDistance},

            {"groups",                   groupsArr},
        };
        sendOk(json{{"properties", props}});
        return res;
    }

    // -------- emitters/set-properties (Phase 4.1 Fix dispatch 1) ----
    //
    // Batch patch: iterate over each key present in `patch` and apply
    // it directly to the target emitter's struct field. Captures undo
    // once, emits state/changed + tree/changed once, marks dirty once
    // per call regardless of how many fields the patch touched.
    //
    // Field type guards: nlohmann::json's `.value(key, fallback)` reads
    // through `get<T>`, which throws on type mismatch. Each branch uses
    // `is_*` checks before assignment so a stray null / wrong-type
    // field is a silent skip rather than a hard fault.
    if (kind == "emitters/set-properties")
    {
        int id = params.value("id", -1);
        ParticleSystem::Emitter* emit = getEmitterById(id);
        if (emit == nullptr)
        {
            sendErr("emitter not found");
            return res;
        }
        if (!params.contains("patch") || !params["patch"].is_object())
        {
            sendErr("missing patch");
            return res;
        }
        const json& patch = params["patch"];

        captureUndo();

        // Helper macros — keep the per-field branch concise. Each
        // branch reads through `at()` only after a `contains()` check
        // so missing keys are a no-op.
        auto getBool = [&](const char* key, bool fallback) -> bool {
            if (patch.contains(key) && patch.at(key).is_boolean()) return patch.at(key).get<bool>();
            return fallback;
        };
        auto getFloat = [&](const char* key, float fallback) -> float {
            if (patch.contains(key) && patch.at(key).is_number()) return patch.at(key).get<float>();
            return fallback;
        };
        auto getInt = [&](const char* key, int fallback) -> int {
            if (patch.contains(key) && patch.at(key).is_number_integer()) return patch.at(key).get<int>();
            if (patch.contains(key) && patch.at(key).is_number()) return static_cast<int>(patch.at(key).get<double>());
            return fallback;
        };
        auto getString = [&](const char* key, const std::string& fallback) -> std::string {
            if (patch.contains(key) && patch.at(key).is_string()) return patch.at(key).get<std::string>();
            return fallback;
        };

        // ── Basic ───────────────────────────────────────────────────
        if (patch.contains("name"))                    emit->name = getString("name", emit->name);
        if (patch.contains("lifetime"))                emit->lifetime = getFloat("lifetime", emit->lifetime);
        if (patch.contains("initialDelay"))            emit->initialDelay = getFloat("initialDelay", emit->initialDelay);
        if (patch.contains("useBursts"))               emit->useBursts = getBool("useBursts", emit->useBursts);
        if (patch.contains("nBursts"))                 emit->nBursts = static_cast<unsigned long>(getInt("nBursts", static_cast<int>(emit->nBursts)));
        if (patch.contains("burstDelay"))              emit->burstDelay = getFloat("burstDelay", emit->burstDelay);
        if (patch.contains("nParticlesPerBurst"))      emit->nParticlesPerBurst = static_cast<unsigned long>(getInt("nParticlesPerBurst", static_cast<int>(emit->nParticlesPerBurst)));
        if (patch.contains("nParticlesPerSecond"))     emit->nParticlesPerSecond = static_cast<unsigned long>(getInt("nParticlesPerSecond", static_cast<int>(emit->nParticlesPerSecond)));
        if (patch.contains("randomLifetimePerc"))      emit->randomLifetimePerc = getFloat("randomLifetimePerc", emit->randomLifetimePerc);
        if (patch.contains("randomScalePerc"))         emit->randomScalePerc = getFloat("randomScalePerc", emit->randomScalePerc);
        if (patch.contains("randomRotation"))          emit->randomRotation = getBool("randomRotation", emit->randomRotation);
        if (patch.contains("randomRotationDirection")) emit->randomRotationDirection = getBool("randomRotationDirection", emit->randomRotationDirection);
        if (patch.contains("randomRotationAverage"))   emit->randomRotationAverage = getFloat("randomRotationAverage", emit->randomRotationAverage);
        if (patch.contains("randomRotationVariance"))  emit->randomRotationVariance = getFloat("randomRotationVariance", emit->randomRotationVariance);
        if (patch.contains("freezeTime"))              emit->freezeTime = getFloat("freezeTime", emit->freezeTime);
        if (patch.contains("skipTime"))                emit->skipTime = getFloat("skipTime", emit->skipTime);
        if (patch.contains("linkToSystem"))            emit->linkToSystem = getBool("linkToSystem", emit->linkToSystem);
        if (patch.contains("parentLinkStrength"))      emit->parentLinkStrength = getFloat("parentLinkStrength", emit->parentLinkStrength);
        if (patch.contains("index"))                   emit->index = static_cast<size_t>(getInt("index", static_cast<int>(emit->index)));

        // ── Appearance ─────────────────────────────────────────────
        if (patch.contains("colorTexture"))            emit->colorTexture = getString("colorTexture", emit->colorTexture);
        if (patch.contains("normalTexture"))           emit->normalTexture = getString("normalTexture", emit->normalTexture);
        if (patch.contains("blendMode"))               emit->blendMode = static_cast<unsigned long>(getInt("blendMode", static_cast<int>(emit->blendMode)));
        if (patch.contains("textureSize"))             emit->textureSize = static_cast<unsigned long>(getInt("textureSize", static_cast<int>(emit->textureSize)));
        if (patch.contains("nTriangles"))              emit->nTriangles = static_cast<unsigned long>(getInt("nTriangles", static_cast<int>(emit->nTriangles)));
        if (patch.contains("doColorAddGrayscale"))     emit->doColorAddGrayscale = getBool("doColorAddGrayscale", emit->doColorAddGrayscale);
        if (patch.contains("randomColors") && patch.at("randomColors").is_array() && patch.at("randomColors").size() == 4)
        {
            for (int i = 0; i < 4; i++)
            {
                if (patch.at("randomColors")[i].is_number())
                    emit->randomColors[i] = patch.at("randomColors")[i].get<float>();
            }
        }
        if (patch.contains("hasTail"))                 emit->hasTail = getBool("hasTail", emit->hasTail);
        if (patch.contains("tailSize"))                emit->tailSize = getFloat("tailSize", emit->tailSize);
        if (patch.contains("isHeatParticle"))          emit->isHeatParticle = getBool("isHeatParticle", emit->isHeatParticle);
        if (patch.contains("isWorldOriented"))         emit->isWorldOriented = getBool("isWorldOriented", emit->isWorldOriented);
        if (patch.contains("noDepthTest"))             emit->noDepthTest = getBool("noDepthTest", emit->noDepthTest);
        if (patch.contains("affectedByWind"))          emit->affectedByWind = getBool("affectedByWind", emit->affectedByWind);

        // ── Physics ────────────────────────────────────────────────
        if (patch.contains("acceleration") && patch.at("acceleration").is_array() && patch.at("acceleration").size() == 3)
        {
            for (int i = 0; i < 3; i++)
            {
                if (patch.at("acceleration")[i].is_number())
                    emit->acceleration[i] = patch.at("acceleration")[i].get<float>();
            }
        }
        if (patch.contains("gravity"))                 emit->gravity = getFloat("gravity", emit->gravity);
        if (patch.contains("inwardSpeed"))             emit->inwardSpeed = getFloat("inwardSpeed", emit->inwardSpeed);
        if (patch.contains("inwardAcceleration"))      emit->inwardAcceleration = getFloat("inwardAcceleration", emit->inwardAcceleration);
        if (patch.contains("objectSpaceAcceleration")) emit->objectSpaceAcceleration = getBool("objectSpaceAcceleration", emit->objectSpaceAcceleration);
        if (patch.contains("bounciness"))              emit->bounciness = getFloat("bounciness", emit->bounciness);
        if (patch.contains("groundBehavior"))          emit->groundBehavior = static_cast<unsigned long>(getInt("groundBehavior", static_cast<int>(emit->groundBehavior)));
        if (patch.contains("emitFromMesh"))            emit->emitFromMesh = getInt("emitFromMesh", emit->emitFromMesh);
        if (patch.contains("emitFromMeshOffset"))      emit->emitFromMeshOffset = getFloat("emitFromMeshOffset", emit->emitFromMeshOffset);
        if (patch.contains("isWeatherParticle"))       emit->isWeatherParticle = getBool("isWeatherParticle", emit->isWeatherParticle);
        if (patch.contains("weatherCubeSize"))         emit->weatherCubeSize = getFloat("weatherCubeSize", emit->weatherCubeSize);
        if (patch.contains("weatherCubeDistance"))     emit->weatherCubeDistance = getFloat("weatherCubeDistance", emit->weatherCubeDistance);
        if (patch.contains("weatherFadeoutDistance"))  emit->weatherFadeoutDistance = getFloat("weatherFadeoutDistance", emit->weatherFadeoutDistance);

        // ── Groups (NUM_GROUPS=3) ──────────────────────────────────
        if (patch.contains("groups") && patch.at("groups").is_array())
        {
            const json& gs = patch.at("groups");
            const int n = std::min<int>(ParticleSystem::NUM_GROUPS,
                                        static_cast<int>(gs.size()));
            for (int gi = 0; gi < n; gi++)
            {
                const json& g = gs[gi];
                if (!g.is_object()) continue;
                auto& dst = emit->groups[gi];
                if (g.contains("type") && g.at("type").is_number_integer())
                    dst.type = static_cast<unsigned int>(g.at("type").get<int>());
                if (g.contains("min") && g.at("min").is_array() && g.at("min").size() == 3)
                {
                    dst.minX = g.at("min")[0].get<float>();
                    dst.minY = g.at("min")[1].get<float>();
                    dst.minZ = g.at("min")[2].get<float>();
                }
                if (g.contains("max") && g.at("max").is_array() && g.at("max").size() == 3)
                {
                    dst.maxX = g.at("max")[0].get<float>();
                    dst.maxY = g.at("max")[1].get<float>();
                    dst.maxZ = g.at("max")[2].get<float>();
                }
                if (g.contains("sideLength") && g.at("sideLength").is_number())
                    dst.sideLength = g.at("sideLength").get<float>();
                if (g.contains("sphereRadius") && g.at("sphereRadius").is_number())
                    dst.sphereRadius = g.at("sphereRadius").get<float>();
                if (g.contains("sphereEdge") && g.at("sphereEdge").is_number_integer())
                    dst.sphereEdge = static_cast<unsigned int>(g.at("sphereEdge").get<int>());
                if (g.contains("cylinderRadius") && g.at("cylinderRadius").is_number())
                    dst.cylinderRadius = g.at("cylinderRadius").get<float>();
                if (g.contains("cylinderEdge") && g.at("cylinderEdge").is_number_integer())
                    dst.cylinderEdge = static_cast<unsigned int>(g.at("cylinderEdge").get<int>());
                if (g.contains("cylinderHeight") && g.at("cylinderHeight").is_number())
                    dst.cylinderHeight = g.at("cylinderHeight").get<float>();
                if (g.contains("val") && g.at("val").is_array() && g.at("val").size() == 3)
                {
                    dst.valX = g.at("val")[0].get<float>();
                    dst.valY = g.at("val")[1].get<float>();
                    dst.valZ = g.at("val")[2].get<float>();
                }
            }
        }

        sendOk(json::object());
        markDirty();
        EmitEngineStateChanged();
        EmitEmittersTreeChanged();
        return res;
    }

    // -------- emitters/duplicate -------------------------------------
    //
    // Mirrors legacy `EmitterList_DuplicateEmitter` at
    // [src/UI/EmitterList.cpp:4707]. Round-trips the source through
    // the chunk serializer so the duplicate starts with empty
    // m_instances (a direct copy-construct would shallow-copy that
    // std::set and double-free on later deletion). The duplicate
    // becomes a root via `insertEmitterAfter`.
    if (kind == "emitters/duplicate")
    {
        int id = params.value("id", -1);
        ParticleSystem::Emitter* source = getEmitterById(id);
        if (source == nullptr)
        {
            sendOk(json{{"ok", false}, {"error", "emitter not found"}});
            return res;
        }

        captureUndo();

        ParticleSystem* sys = m_pParticleSystem->get();
        ParticleSystem::Emitter* dup = nullptr;
        MemoryFile* memfile = new MemoryFile;
        try
        {
            ChunkWriter writer(memfile);
            source->copy(writer);

            memfile->seek(0);
            ChunkReader reader(memfile);
            ParticleSystem::Emitter cleanCopy(reader);

            // Auto-suffix the name to avoid collisions; mirrors the
            // legacy convention from EmitterList.cpp:4731.
            cleanCopy.name = GenerateDuplicateName(sys, source->name);

            dup = sys->insertEmitterAfter(source, cleanCopy);
        }
        catch (...)
        {
            memfile->Release();
            sendOk(json{{"ok", false}, {"error", "emitter copy failed"}});
            return res;
        }
        memfile->Release();

        if (dup == nullptr)
        {
            sendOk(json{{"ok", false}, {"error", "insertEmitterAfter returned null"}});
            return res;
        }
        const int newId = static_cast<int>(dup->index);
        sendOk(json{{"ok", true}, {"newId", newId}});
        markDirty();
        EmitEngineStateChanged();
        EmitEmittersTreeChanged();
        return res;
    }

    // -------- emitters/delete ---------------------------------------
    //
    // Mirrors legacy `EmitterList_DeleteEmitter` at
    // [src/UI/EmitterList.cpp:4651]. ParticleSystem::deleteEmitter
    // recursively deletes a subtree. If the deleted id matches the
    // selection scalar, clear it and emit emitters/selected { id: null }.
    if (kind == "emitters/delete")
    {
        int id = params.value("id", -1);
        ParticleSystem::Emitter* target = getEmitterById(id);
        if (target == nullptr)
        {
            // No-op delete still returns success — matches the
            // mock's permissive behaviour.
            sendOk(json::object());
            return res;
        }

        captureUndo();

        ParticleSystem* sys = m_pParticleSystem->get();
        const bool wasSelected = (m_selectedEmitterId == id);
        sys->deleteEmitter(target);

        if (wasSelected)
        {
            m_selectedEmitterId = -1;
            if (m_emit)
            {
                json env = {
                    {"type",    "evt"},
                    {"kind",    "emitters/selected"},
                    {"payload", json{{"id", json(nullptr)}}},
                };
                m_emit(env.dump());
            }
        }

        sendOk(json::object());
        markDirty();
        EmitEngineStateChanged();
        EmitEmittersTreeChanged();
        return res;
    }

    // -------- emitters/rename ---------------------------------------
    //
    // Legacy uses an inline tree-view edit (EmitterList_RenameEmitter
    // at line 4814 → TreeView_EditLabel). The new-UI flow uses a modal,
    // dispatched here as a plain setName. Capture-undo guards against
    // mid-edit Ctrl-Z weirdness.
    if (kind == "emitters/rename")
    {
        int id = params.value("id", -1);
        std::string name = params.value("name", std::string{});
        ParticleSystem::Emitter* target = getEmitterById(id);
        if (target == nullptr)
        {
            sendErr("emitter not found");
            return res;
        }

        captureUndo();
        target->name = name;

        sendOk(json::object());
        markDirty();
        EmitEmittersTreeChanged();
        return res;
    }

    // -------- emitters/delete-track-keys + set-track-interpolation --
    //
    // Screen 5 / Screen 6 Batch B-α track mutations. Both handlers
    // resolve the emitter by id, look up the named track on `tracks[]`
    // (the slot pointer aliasing — see the comment block in
    // ParticleSystem.h:148), then mutate the underlying multiset /
    // enum directly. Border keys (first + last in time order on the
    // multiset, which is already ordered by Key::operator<) are
    // silently skipped by delete-track-keys per legacy semantics;
    // they define the track's [0, 100] time range and aren't
    // deletable.
    //
    // Both mutations capture undo, mark the editor dirty, and emit
    // engine/state/changed + emitters/tree/changed so the React
    // panel re-fetches via `emitters/get-tracks`.
    auto trackNameToIndex = [](const std::string& name) -> int {
        if (name == "red")           return ParticleSystem::TRACK_RED_CHANNEL;
        if (name == "green")         return ParticleSystem::TRACK_GREEN_CHANNEL;
        if (name == "blue")          return ParticleSystem::TRACK_BLUE_CHANNEL;
        if (name == "alpha")         return ParticleSystem::TRACK_ALPHA_CHANNEL;
        if (name == "scale")         return ParticleSystem::TRACK_SCALE;
        if (name == "index")         return ParticleSystem::TRACK_INDEX;
        if (name == "rotationSpeed") return ParticleSystem::TRACK_ROTATION_SPEED;
        return -1;
    };

    if (kind == "emitters/delete-track-keys")
    {
        int id = params.value("id", -1);
        std::string trackName = params.value("track", std::string{});
        const json& timesJson = params.contains("times") ? params["times"] : json::array();

        ParticleSystem::Emitter* target = getEmitterById(id);
        if (target == nullptr)
        {
            sendErr("emitter not found");
            return res;
        }

        int trackIdx = trackNameToIndex(trackName);
        if (trackIdx < 0)
        {
            sendErr("unknown track");
            return res;
        }

        ParticleSystem::Emitter::Track* track = target->tracks[trackIdx];
        if (track == nullptr || track->keys.empty())
        {
            // Nothing to delete — return success silently to match the
            // mock's no-op semantics. Don't emit; nothing changed.
            sendOk(json::object());
            return res;
        }

        // Border keys = first + last in the multiset (ordered by
        // Key::operator< on `time`). std::multiset::begin / rbegin
        // are the cheapest way to grab them; cache the time values
        // for the skip check below.
        const float firstTime = track->keys.begin()->time;
        const float lastTime  = track->keys.rbegin()->time;

        // Capture undo BEFORE any erase — if every requested time is
        // a border-key no-op we'll discover that in the loop and
        // the capture is a wasted snapshot, but Undo coalescing
        // handles that gracefully and the alternative (capture-late)
        // can't restore the half-mutated multiset if iteration aborts.
        captureUndo();

        int removed = 0;
        for (const auto& t : timesJson)
        {
            if (!t.is_number()) continue;
            float timeVal = t.get<float>();
            // Silent-skip border keys.
            if (timeVal == firstTime || timeVal == lastTime) continue;
            // std::multiset::find takes a `Key` constructed from the
            // time alone; operator< compares only on time so the
            // probe value's `value` field is irrelevant.
            ParticleSystem::Emitter::Track::Key probe(timeVal, 0.0f);
            auto it = track->keys.find(probe);
            if (it != track->keys.end())
            {
                track->keys.erase(it);
                removed++;
            }
        }

        sendOk(json::object());
        if (removed > 0)
        {
            markDirty();
            EmitEmittersTreeChanged();
            EmitEngineStateChanged();
        }
        return res;
    }

    if (kind == "emitters/set-track-interpolation")
    {
        int id = params.value("id", -1);
        std::string trackName  = params.value("track",         std::string{});
        std::string interpName = params.value("interpolation", std::string{});

        ParticleSystem::Emitter* target = getEmitterById(id);
        if (target == nullptr)
        {
            sendErr("emitter not found");
            return res;
        }

        int trackIdx = trackNameToIndex(trackName);
        if (trackIdx < 0)
        {
            sendErr("unknown track");
            return res;
        }

        ParticleSystem::Emitter::Track* track = target->tracks[trackIdx];
        if (track == nullptr)
        {
            // No track slot bound — silent no-op (matches the wire
            // contract which never surfaces a refusal envelope).
            sendOk(json::object());
            return res;
        }

        ParticleSystem::Emitter::Track::InterpolationType next;
        if      (interpName == "linear") next = ParticleSystem::Emitter::Track::IT_LINEAR;
        else if (interpName == "smooth") next = ParticleSystem::Emitter::Track::IT_SMOOTH;
        else if (interpName == "step")   next = ParticleSystem::Emitter::Track::IT_STEP;
        else
        {
            sendErr("unknown interpolation");
            return res;
        }

        if (track->interpolation == next)
        {
            // No-op — don't capture undo or fire events.
            sendOk(json::object());
            return res;
        }

        captureUndo();
        track->interpolation = next;

        sendOk(json::object());
        markDirty();
        EmitEmittersTreeChanged();
        EmitEngineStateChanged();
        return res;
    }

    // -------- emitters/set-track-lock ------------------------------
    //
    // Per-channel track lock. The legacy combo at
    // [TrackEditor.cpp:90-110](src/UI/TrackEditor.cpp:90) and the
    // file-load consolidation at [ParticleSystem.cpp:428] use the
    // *pointer identity* of `emit->tracks[i]` as the source of
    // truth for lock state: `tracks[i] == &trackContents[j]` (with
    // `i != j`) means channel `i` is read-only and displays
    // channel `j`'s key data.
    //
    // Locking rules (mirror legacy):
    //   - Only the first four channels (RGBA) participate.
    //   - Channel can only lock to an *earlier* channel (Green→Red,
    //     Blue→Red/Green, Alpha→Red/Green/Blue). Other combinations
    //     silently become "unlock" — UI surface already restricts
    //     options so this is defensive only.
    //   - `lockTo: null` restores `tracks[i] = &trackContents[i]`
    //     (channel owns its keys again; previous trackContents[i]
    //     is preserved because the lock didn't touch it).
    if (kind == "emitters/set-track-lock")
    {
        int id = params.value("id", -1);
        std::string channelName = params.value("channel", std::string{});
        // lockTo is `string | null` per the schema; nlohmann's
        // `value<string>` would throw on null, so check explicitly.
        std::string lockToName;
        bool lockToIsNull = !params.contains("lockTo") || params["lockTo"].is_null();
        if (!lockToIsNull) lockToName = params["lockTo"].get<std::string>();

        ParticleSystem::Emitter* target = getEmitterById(id);
        if (target == nullptr)
        {
            sendErr("emitter not found");
            return res;
        }

        int channelIdx = trackNameToIndex(channelName);
        if (channelIdx < 0)
        {
            sendErr("unknown channel");
            return res;
        }

        // Only RGBA participate. Silently accept and no-op for the
        // other three — keeps the React side simple (it can always
        // dispatch without first checking which channel it's on).
        if (channelIdx >= 4)
        {
            sendOk(json::object());
            return res;
        }

        ParticleSystem::Emitter::Track* desired = nullptr;
        if (lockToIsNull)
        {
            desired = &target->trackContents[channelIdx];
        }
        else
        {
            int targetIdx = trackNameToIndex(lockToName);
            // Reject invalid targets (must be 0..3 AND earlier than us)
            // by falling back to self-pointer = unlock.
            if (targetIdx >= 0 && targetIdx < 4 && targetIdx < channelIdx)
            {
                desired = &target->trackContents[targetIdx];
            }
            else
            {
                desired = &target->trackContents[channelIdx];
            }
        }

        if (target->tracks[channelIdx] == desired)
        {
            // No-op — don't capture undo or fire events.
            sendOk(json::object());
            return res;
        }

        captureUndo();
        target->tracks[channelIdx] = desired;

        sendOk(json::object());
        markDirty();
        EmitEmittersTreeChanged();
        EmitEngineStateChanged();
        return res;
    }

    // -------- emitters/set-track-key (Screen 6 Batch B-β) ----------
    //
    // Drag-to-move + Spinner edit commit. Erases the key at
    // `oldTime` from the multiset and inserts `(newTime, newValue)`.
    // Border keys (first + last in time order on the multiset) have
    // their `newTime` silently overridden to `oldTime` — only the
    // value moves. This mirrors the React-side drag clamping; the
    // host is the source of truth.
    //
    // `std::multiset<Key>::find` accepts a Key constructed from the
    // time alone — operator< compares only on `time`, so the probe
    // Key's `value` field is irrelevant. Erase + insert is the
    // ordered-key idiom (no in-place mutation of the ordering key).
    if (kind == "emitters/set-track-key")
    {
        int id = params.value("id", -1);
        std::string trackName = params.value("track", std::string{});
        float oldTime  = params.value("oldTime",  0.0f);
        float newTime  = params.value("newTime",  0.0f);
        float newValue = params.value("newValue", 0.0f);

        ParticleSystem::Emitter* target = getEmitterById(id);
        if (target == nullptr)
        {
            sendErr("emitter not found");
            return res;
        }

        int trackIdx = trackNameToIndex(trackName);
        if (trackIdx < 0)
        {
            sendErr("unknown track");
            return res;
        }

        ParticleSystem::Emitter::Track* track = target->tracks[trackIdx];
        if (track == nullptr || track->keys.empty())
        {
            // Nothing to move — silent ok.
            sendOk(json::object());
            return res;
        }

        // Identify border keys before any mutation.
        const float firstTime = track->keys.begin()->time;
        const float lastTime  = track->keys.rbegin()->time;
        const bool isBorder = (oldTime == firstTime || oldTime == lastTime);
        if (isBorder)
        {
            // Border keys: time fixed.
            newTime = oldTime;
        }

        ParticleSystem::Emitter::Track::Key probe(oldTime, 0.0f);
        auto it = track->keys.find(probe);
        if (it == track->keys.end())
        {
            // Key not found at oldTime — silent ok (matches the
            // overlay's read-modify-write semantics).
            sendOk(json::object());
            return res;
        }

        captureUndo();
        track->keys.erase(it);
        track->keys.insert(ParticleSystem::Emitter::Track::Key(newTime, newValue));

        sendOk(json::object());
        markDirty();
        EmitEmittersTreeChanged();
        EmitEngineStateChanged();
        return res;
    }

    // -------- emitters/add-track-key (Screen 6 Batch B-β) ----------
    //
    // Click-to-add (Insert mode) commit. Inserts a new key into the
    // multiset. If a key at the exact `time` already exists, bumps
    // `time` by 0.001 until unique so the multiset doesn't accumulate
    // ambiguously-ordered duplicates (the dedupe is mirrored by the
    // mock at `addTrackKeyInOverlay`). Returns the actual inserted
    // (time, value) so the React side can auto-select the new key.
    if (kind == "emitters/add-track-key")
    {
        int id = params.value("id", -1);
        std::string trackName = params.value("track", std::string{});
        float time  = params.value("time",  0.0f);
        float value = params.value("value", 0.0f);

        ParticleSystem::Emitter* target = getEmitterById(id);
        if (target == nullptr)
        {
            sendErr("emitter not found");
            return res;
        }

        int trackIdx = trackNameToIndex(trackName);
        if (trackIdx < 0)
        {
            sendErr("unknown track");
            return res;
        }

        ParticleSystem::Emitter::Track* track = target->tracks[trackIdx];
        if (track == nullptr)
        {
            // No track slot bound — silent ok with the request shape.
            sendOk(json{{"time", time}, {"value", value}});
            return res;
        }

        // Dedupe-by-epsilon: bump until the time is unique. Bounded
        // by 1000 iterations as a defensive safety net so a pathological
        // dataset can't lock the dispatch thread.
        ParticleSystem::Emitter::Track::Key probe(time, 0.0f);
        int safety = 1000;
        while (track->keys.find(probe) != track->keys.end() && safety-- > 0)
        {
            time += 0.001f;
            probe = ParticleSystem::Emitter::Track::Key(time, 0.0f);
        }

        captureUndo();
        track->keys.insert(ParticleSystem::Emitter::Track::Key(time, value));

        sendOk(json{{"time", time}, {"value", value}});
        markDirty();
        EmitEmittersTreeChanged();
        EmitEngineStateChanged();
        return res;
    }

    // -------- emitters/duplicate-with-index-increment ---------------
    //
    // Legacy `EmitterList_DuplicateEmitter(hWnd, indexDelta)` at
    // [src/UI/EmitterList.cpp:4707]. Duplicate first (same path as
    // above), then shift the TRACK_INDEX track on the duplicate by
    // `delta` via `ShiftIndexTrack` (legacy helper at
    // [src/UI/EmitterList.cpp:2307]). The shift adds `delta` to every
    // keyframe value; if the track is empty, inserts a single key at
    // t=0 with value=delta.
    if (kind == "emitters/duplicate-with-index-increment")
    {
        int id = params.value("id", -1);
        float delta = params.value("delta", 0.0f);
        ParticleSystem::Emitter* source = getEmitterById(id);
        if (source == nullptr)
        {
            sendErr("emitter not found");
            return res;
        }

        captureUndo();

        ParticleSystem* sys = m_pParticleSystem->get();
        ParticleSystem::Emitter* dup = nullptr;
        MemoryFile* memfile = new MemoryFile;
        try
        {
            ChunkWriter writer(memfile);
            source->copy(writer);
            memfile->seek(0);
            ChunkReader reader(memfile);
            ParticleSystem::Emitter cleanCopy(reader);
            cleanCopy.name = GenerateDuplicateName(sys, source->name);
            dup = sys->insertEmitterAfter(source, cleanCopy);
        }
        catch (...)
        {
            memfile->Release();
            sendErr("emitter copy failed");
            return res;
        }
        memfile->Release();

        if (dup == nullptr)
        {
            sendErr("insertEmitterAfter returned null");
            return res;
        }

        // Mirror legacy ShiftIndexTrack at [src/UI/EmitterList.cpp:2307].
        // The set's iterators are const, so rebuild via a temporary
        // vector + clear + reinsert.
        if (delta != 0.0f)
        {
            ParticleSystem::Emitter::Track* track =
                dup->tracks[ParticleSystem::TRACK_INDEX];
            if (track->keys.empty())
            {
                track->keys.insert(
                    ParticleSystem::Emitter::Track::Key(0.0f, delta));
            }
            else
            {
                std::vector<ParticleSystem::Emitter::Track::Key> tmp(
                    track->keys.begin(), track->keys.end());
                track->keys.clear();
                for (size_t i = 0; i < tmp.size(); ++i)
                {
                    track->keys.insert(
                        ParticleSystem::Emitter::Track::Key(
                            tmp[i].time, tmp[i].value + delta));
                }
            }
        }

        const int newId = static_cast<int>(dup->index);
        sendOk(json{{"newId", newId}});
        markDirty();
        EmitEngineStateChanged();
        EmitEmittersTreeChanged();
        return res;
    }

    // -------- engine/action/rescale-emitter -------------------------
    //
    // Per-emitter rescale (vs `engine/action/rescale-system` which
    // walks every emitter). Mirrors the inner loop body of legacy
    // `RescaleEmitter` at src/Rescale.cpp; here we just call
    // DoRescaleEmitter once on the chosen emitter.
    if (kind == "engine/action/rescale-emitter")
    {
        int id = params.value("id", -1);
        float durPct  = params.value("durationScalePercent", 100.0f);
        float sizePct = params.value("sizeScalePercent",     100.0f);
        ParticleSystem::Emitter* target = getEmitterById(id);
        if (target == nullptr)
        {
            sendErr("emitter not found");
            return res;
        }

        captureUndo();
        DoRescaleEmitter(target, durPct / 100.0f, sizePct / 100.0f);

        sendOk(json::object());
        markDirty();
        EmitEngineStateChanged();
        EmitEmittersTreeChanged();
        return res;
    }

    // -------- linkGroups/list-exempt-fields -------------------------
    //
    // Read the per-group LinkExemptFlags via
    // `ParticleSystem::getLinkExemptFlags`. Unknown groups return the
    // v1 default exempt set (handled inside getLinkExemptFlags).
    if (kind == "linkGroups/list-exempt-fields")
    {
        if (m_pParticleSystem == nullptr || !*m_pParticleSystem)
        {
            sendErr("particle system not bound");
            return res;
        }
        uint32_t groupId =
            params.value("groupId", static_cast<uint32_t>(0));
        const LinkExemptFlags& flags =
            (*m_pParticleSystem)->getLinkExemptFlags(groupId);
        sendOk(json{{"fields", LinkExemptFlagsToJsonArray(flags)}});
        return res;
    }

    // -------- linkGroups/set-exempt-fields --------------------------
    //
    // Write the per-group exempt set. ParticleSystem normalises an
    // all-default value back out of the map (see
    // [src/ParticleSystem.h:351]); calling with the v1 default fields
    // therefore leaves the on-disk chunk untouched, matching legacy
    // save behaviour.
    if (kind == "linkGroups/set-exempt-fields")
    {
        if (m_pParticleSystem == nullptr || !*m_pParticleSystem)
        {
            sendErr("particle system not bound");
            return res;
        }
        uint32_t groupId =
            params.value("groupId", static_cast<uint32_t>(0));
        const json& fieldsJson =
            params.contains("fields") ? params["fields"] : json::array();
        LinkExemptFlags flags = LinkExemptFlagsFromJsonArray(fieldsJson);

        captureUndo();
        (*m_pParticleSystem)->setLinkExemptFlags(groupId, flags);

        sendOk(json::object());
        markDirty();
        EmitEmittersTreeChanged();
        return res;
    }

    // -------- linkGroups/reset-exempt-fields ------------------------
    //
    // Reset = set to v1 defaults. ParticleSystem normalises that back
    // out of the map, so this effectively erases the per-group entry.
    if (kind == "linkGroups/reset-exempt-fields")
    {
        if (m_pParticleSystem == nullptr || !*m_pParticleSystem)
        {
            sendErr("particle system not bound");
            return res;
        }
        uint32_t groupId =
            params.value("groupId", static_cast<uint32_t>(0));

        captureUndo();
        (*m_pParticleSystem)->setLinkExemptFlags(groupId, LinkExemptFlags{});

        sendOk(json::object());
        markDirty();
        EmitEmittersTreeChanged();
        return res;
    }

    // -------- Screen 4 Batch B2 — add child / move / link-group memb -

    // -------- emitters/add-lifetime-child ---------------------------
    //
    // Wraps `ParticleSystem::addLifetimeEmitter(parent, Emitter())`.
    // The engine refuses (returns NULL) when the parent's lifetime
    // slot is already filled — surface that as `newId: -1`. Otherwise
    // return the new emitter's index in getEmitters().
    if (kind == "emitters/add-lifetime-child")
    {
        int parentId = params.value("parentId", -1);
        ParticleSystem::Emitter* parent = getEmitterById(parentId);
        if (parent == nullptr || m_pParticleSystem == nullptr || !*m_pParticleSystem)
        {
            sendOk(json{{"newId", -1}});
            return res;
        }
        captureUndo();
        ParticleSystem::Emitter* child =
            (*m_pParticleSystem)->addLifetimeEmitter(parent);
        if (child == nullptr)
        {
            sendOk(json{{"newId", -1}});
            return res;
        }
        sendOk(json{{"newId", static_cast<int>(child->index)}});
        markDirty();
        EmitEngineStateChanged();
        EmitEmittersTreeChanged();
        return res;
    }

    // -------- emitters/add-root --------------------------------------
    //
    // Phase 4.1 Fix dispatch 5 — wraps `ParticleSystem::addRootEmitter()`
    // for the new top-level Emitters → New Emitter → Root menu item.
    // The engine always succeeds (no max-roots cap); the only failure
    // path is a missing particle-system pointer, surfaced as
    // `newId: -1` for parity with the add-child handlers.
    if (kind == "emitters/add-root")
    {
        if (m_pParticleSystem == nullptr || !*m_pParticleSystem)
        {
            sendOk(json{{"newId", -1}});
            return res;
        }
        captureUndo();
        ParticleSystem::Emitter* child =
            (*m_pParticleSystem)->addRootEmitter();
        if (child == nullptr)
        {
            sendOk(json{{"newId", -1}});
            return res;
        }
        sendOk(json{{"newId", static_cast<int>(child->index)}});
        markDirty();
        EmitEngineStateChanged();
        EmitEmittersTreeChanged();
        return res;
    }

    // -------- emitters/add-death-child -------------------------------
    if (kind == "emitters/add-death-child")
    {
        int parentId = params.value("parentId", -1);
        ParticleSystem::Emitter* parent = getEmitterById(parentId);
        if (parent == nullptr || m_pParticleSystem == nullptr || !*m_pParticleSystem)
        {
            sendOk(json{{"newId", -1}});
            return res;
        }
        captureUndo();
        ParticleSystem::Emitter* child =
            (*m_pParticleSystem)->addDeathEmitter(parent);
        if (child == nullptr)
        {
            sendOk(json{{"newId", -1}});
            return res;
        }
        sendOk(json{{"newId", static_cast<int>(child->index)}});
        markDirty();
        EmitEngineStateChanged();
        EmitEmittersTreeChanged();
        return res;
    }

    // -------- emitters/move ------------------------------------------
    //
    // Reorder the emitter among its siblings. Wraps
    // `ParticleSystem::moveEmitter(emitter, direction)`. The engine
    // already enforces "root-only" and "no-op at the edges" — a
    // refused move returns false and is a silent no-op here (the React
    // side disables the menu item at the edges; reaching this path with
    // a refusal is defensive). Always sends `{}` to match the schema.
    if (kind == "emitters/move")
    {
        int id = params.value("id", -1);
        std::string dirStr = params.value("direction", std::string{"up"});
        int dir = (dirStr == "down") ? +1 : -1;
        ParticleSystem::Emitter* target = getEmitterById(id);
        if (target == nullptr || m_pParticleSystem == nullptr || !*m_pParticleSystem)
        {
            sendOk(json::object());
            return res;
        }
        captureUndo();
        const bool moved = (*m_pParticleSystem)->moveEmitter(target, dir);
        sendOk(json::object());
        if (moved)
        {
            markDirty();
            EmitEngineStateChanged();
            EmitEmittersTreeChanged();
        }
        return res;
    }

    // -------- emitters/set-visible -----------------------------------
    //
    // FD10 (Group A): per-emitter visibility toggle for the EmitterTree
    // panel toolbar's [👁] button. Sets `Emitter::visible` for the
    // target only — children are untouched. `visible` is editor-only
    // state (not persisted to the .alo file), so this handler does NOT
    // markDirty. Still emits tree-changed + state-changed so the engine
    // re-renders and any open inspector reflects the new flag.
    if (kind == "emitters/set-visible")
    {
        int  id      = params.value("id", -1);
        bool visible = params.value("visible", true);
        ParticleSystem::Emitter* target = getEmitterById(id);
        if (target == nullptr)
        {
            sendOk(json::object());
            return res;
        }
        target->visible = visible;
        sendOk(json::object());
        EmitEngineStateChanged();
        EmitEmittersTreeChanged();
        return res;
    }

    // -------- emitters/set-all-visible -------------------------------
    //
    // FD10 (Group A): bulk Show All / Hide All from the EmitterTree
    // panel toolbar. Walks the entire emitter array (the engine stores
    // all emitters flat with parent pointers — no recursion needed)
    // and sets `visible` uniformly. Same editor-only semantic as
    // set-visible above; no markDirty.
    if (kind == "emitters/set-all-visible")
    {
        bool visible = params.value("visible", true);
        if (m_pParticleSystem == nullptr || !*m_pParticleSystem)
        {
            sendOk(json::object());
            return res;
        }
        const auto& emitters = (*m_pParticleSystem)->getEmitters();
        for (ParticleSystem::Emitter* e : emitters)
        {
            if (e != nullptr) e->visible = visible;
        }
        sendOk(json::object());
        EmitEngineStateChanged();
        EmitEmittersTreeChanged();
        return res;
    }

    // -------- linkGroups/set-membership ------------------------------
    //
    // Walk `ids` and assign each emitter's `linkGroup` to the resolved
    // group:
    //   - groupId === null OR === 0 → 0 (leave the group)
    //   - groupId  >  0             → groupId
    //   - groupId === -1            → create a new group (smallest
    //                                 unused positive uint32_t)
    //
    // For the "new group" branch we scan every existing emitter for
    // the highest current linkGroup; the new group is `max + 1`. This
    // matches the legacy convention from MT-5 and avoids reusing a
    // recently-vacated id.
    if (kind == "linkGroups/set-membership")
    {
        if (m_pParticleSystem == nullptr || !*m_pParticleSystem)
        {
            sendErr("particle system not bound");
            return res;
        }
        const json& idsJson =
            params.contains("ids") ? params["ids"] : json::array();
        // `groupId` may be a JSON number or null. The default-when-
        // absent value matches "leave" (null → 0).
        int groupIdRaw = 0;
        if (params.contains("groupId") && !params["groupId"].is_null())
        {
            groupIdRaw = params["groupId"].get<int>();
        }

        ParticleSystem* sys = m_pParticleSystem->get();
        uint32_t resolved = 0;
        if (groupIdRaw == -1)
        {
            // Scan all emitters for the max existing linkGroup; new is
            // max + 1.
            uint32_t maxGroup = 0;
            const auto& emitters = sys->getEmitters();
            for (size_t i = 0; i < emitters.size(); ++i)
            {
                if (emitters[i] != nullptr
                    && emitters[i]->linkGroup > maxGroup)
                {
                    maxGroup = emitters[i]->linkGroup;
                }
            }
            resolved = maxGroup + 1;
        }
        else if (groupIdRaw > 0)
        {
            resolved = static_cast<uint32_t>(groupIdRaw);
        }
        // else: resolved stays 0 (leave).

        captureUndo();
        for (const auto& v : idsJson)
        {
            int id = v.get<int>();
            ParticleSystem::Emitter* e = getEmitterById(id);
            if (e == nullptr) continue;
            e->linkGroup = resolved;
        }
        sendOk(json::object());
        markDirty();
        EmitEngineStateChanged();
        EmitEmittersTreeChanged();
        return res;
    }

    // -------- emitters/drop (Screen 4 Batch B3) ----------------------
    //
    // Drag-and-drop reorder + reparent. Tagged-union on params.mode:
    //   - "reorder":  wraps `ParticleSystem::moveEmitterToRootIndex`.
    //                 `rootIndex` is the gap index in the rendered root
    //                 list (gap K = "land before position K"). The
    //                 engine refuses non-root sources, out-of-range
    //                 gaps, and no-op gaps (sourceIdx and sourceIdx+1)
    //                 by returning false; surface that as
    //                 `{ ok: false, error: "reorder refused" }`.
    //   - "reparent": wraps `ParticleSystem::reparentEmitter`. The
    //                 engine itself checks cycle, same-parent, and
    //                 slot-full — refusal returns false; surface as
    //                 `{ ok: false, error: "reparent refused" }`.
    //
    // React side resolves slot before calling (auto-pick: both free →
    // "lifetime"; only one free → that one; both filled → no bridge
    // call). The wire shape never carries "auto".
    if (kind == "emitters/drop")
    {
        if (m_pParticleSystem == nullptr || !*m_pParticleSystem)
        {
            sendOk(json{{"ok", false}, {"error", "particle system not bound"}});
            return res;
        }
        std::string mode = params.value("mode", std::string{});
        int id = params.value("id", -1);
        ParticleSystem::Emitter* source = getEmitterById(id);
        if (source == nullptr)
        {
            sendOk(json{{"ok", false}, {"error", "source emitter not found"}});
            return res;
        }
        captureUndo();
        if (mode == "reorder")
        {
            int rootIndex = params.value("rootIndex", -1);
            if (rootIndex < 0)
            {
                sendOk(json{{"ok", false}, {"error", "invalid rootIndex"}});
                return res;
            }
            const bool ok = (*m_pParticleSystem)->moveEmitterToRootIndex(
                source, static_cast<size_t>(rootIndex));
            if (!ok)
            {
                sendOk(json{{"ok", false}, {"error", "reorder refused"}});
                return res;
            }
            sendOk(json{{"ok", true}});
            markDirty();
            EmitEngineStateChanged();
            EmitEmittersTreeChanged();
            return res;
        }
        if (mode == "reparent")
        {
            int targetId = params.value("targetId", -1);
            std::string slot = params.value("slot", std::string{"lifetime"});
            ParticleSystem::Emitter* target = getEmitterById(targetId);
            if (target == nullptr)
            {
                sendOk(json{{"ok", false}, {"error", "target emitter not found"}});
                return res;
            }
            const bool useDuringLife = (slot != "death");
            const bool ok = (*m_pParticleSystem)->reparentEmitter(
                source, target, useDuringLife);
            if (!ok)
            {
                sendOk(json{{"ok", false}, {"error", "reparent refused"}});
                return res;
            }
            sendOk(json{{"ok", true}});
            markDirty();
            EmitEngineStateChanged();
            EmitEmittersTreeChanged();
            return res;
        }
        sendOk(json{{"ok", false}, {"error", "unknown mode"}});
        return res;
    }

    // -------- emitters/copy / cut / paste (Screen 4 Batch C) --------
    //
    // Process-local clipboard. We reuse the existing LT-3 import-from-
    // file serialise pattern: per emitter, allocate a MemoryFile, wrap
    // it with a ChunkWriter, call `Emitter::copy(writer)` (which is
    // `write(writer, true)` — preserves identity-less form), then
    // snapshot the bytes into a `std::vector<uint8_t>`. Paste reverses
    // the round-trip via `Emitter(ChunkReader&)`. One buffer per copied
    // subtree so each can be deserialised independently (multi-id paste
    // produces multiple new roots).
    //
    // Cut = copy + delete. Single undo capture at the start, single
    // tree-changed at the end — the user sees one atomic step in undo.
    // Descending-id delete order keeps lower indices valid through the
    // loop (deleteEmitter shifts everything above the deleted index
    // down by one).
    if (kind == "emitters/copy" || kind == "emitters/cut")
    {
        if (m_pParticleSystem == nullptr || !*m_pParticleSystem)
        {
            sendOk(json::object());
            return res;
        }
        // Pull the id list from params.ids (an array of numbers).
        std::vector<int> ids;
        if (params.contains("ids") && params["ids"].is_array())
        {
            for (const auto& v : params["ids"])
            {
                if (v.is_number_integer()) ids.push_back(v.get<int>());
            }
        }
        // Clear the clipboard before refilling — every copy/cut
        // replaces the entire contents.
        m_emitterClipboard.clear();
        for (int id : ids)
        {
            ParticleSystem::Emitter* source = getEmitterById(id);
            if (source == nullptr) continue;
            MemoryFile* memfile = new MemoryFile;
            try
            {
                ChunkWriter writer(memfile);
                source->copy(writer);
                std::vector<uint8_t> buf(memfile->size());
                memfile->seek(0);
                if (!buf.empty())
                {
                    memfile->read(buf.data(), static_cast<unsigned long>(buf.size()));
                }
                m_emitterClipboard.push_back(std::move(buf));
            }
            catch (...)
            {
                // Best-effort: skip this id and continue with the rest.
            }
            memfile->Release();
        }
        if (kind == "emitters/copy")
        {
            // Read-only — no undo, no dirty, no tree-changed.
            sendOk(json::object());
            return res;
        }
        // ---- cut: delete the originals atomically ----
        captureUndo();
        // Sort ids descending so the iteration is robust against any
        // mid-loop index reshuffling. We also re-resolve each id via
        // getEmitterById inside the loop because the legacy
        // `deleteEmitter` shifts subsequent slots down, invalidating
        // raw pointers across calls.
        std::sort(ids.begin(), ids.end(), std::greater<int>());
        ParticleSystem* sys = m_pParticleSystem->get();
        bool clearedSelection = false;
        for (int id : ids)
        {
            ParticleSystem::Emitter* target = getEmitterById(id);
            if (target == nullptr) continue;
            if (m_selectedEmitterId == id) clearedSelection = true;
            sys->deleteEmitter(target);
        }
        if (clearedSelection)
        {
            m_selectedEmitterId = -1;
            if (m_emit)
            {
                json env = {
                    {"type",    "evt"},
                    {"kind",    "emitters/selected"},
                    {"payload", json{{"id", json(nullptr)}}},
                };
                m_emit(env.dump());
            }
        }
        sendOk(json::object());
        markDirty();
        EmitEngineStateChanged();
        EmitEmittersTreeChanged();
        return res;
    }
    if (kind == "emitters/paste")
    {
        if (m_pParticleSystem == nullptr || !*m_pParticleSystem)
        {
            sendOk(json{{"newIds", json::array()}});
            return res;
        }
        if (m_emitterClipboard.empty())
        {
            // Nothing to paste — silent no-op, no dirty, no undo.
            sendOk(json{{"newIds", json::array()}});
            return res;
        }
        // Optional `afterId` — the root the paste should land directly
        // after. When omitted or not a current root, paste at the end
        // of the root list.
        int afterId = -1;
        if (params.contains("afterId") && !params["afterId"].is_null())
        {
            afterId = params.value("afterId", -1);
        }
        captureUndo();
        ParticleSystem* sys = m_pParticleSystem->get();
        json newIds = json::array();
        ParticleSystem::Emitter* prevAnchor = (afterId >= 0)
            ? getEmitterById(afterId)
            : nullptr;
        // Track failure separately so a partial paste still emits one
        // tree-changed and returns the ids that *did* land.
        for (auto& buf : m_emitterClipboard)
        {
            if (buf.empty()) continue;
            MemoryFile* memfile = new MemoryFile;
            ParticleSystem::Emitter* pasted = nullptr;
            try
            {
                memfile->write(buf.data(),
                               static_cast<unsigned long>(buf.size()));
                memfile->seek(0);
                ChunkReader reader(memfile);
                ParticleSystem::Emitter staging(reader);
                staging.name = GenerateDuplicateName(sys, staging.name);
                if (prevAnchor != nullptr)
                {
                    pasted = sys->insertEmitterAfter(prevAnchor, staging);
                }
                else
                {
                    pasted = sys->addRootEmitter(staging);
                }
            }
            catch (...)
            {
                // Skip this entry; continue with the rest.
            }
            memfile->Release();
            if (pasted != nullptr)
            {
                newIds.push_back(static_cast<int>(pasted->index));
                // Chain subsequent pastes after this one so multi-id
                // paste keeps clipboard order.
                prevAnchor = pasted;
            }
        }
        sendOk(json{{"newIds", newIds}});
        if (!newIds.empty())
        {
            markDirty();
            EmitEngineStateChanged();
            EmitEmittersTreeChanged();
        }
        return res;
    }

    // -------- everything else (emitters/* etc.) ---------------------
    sendErr("not implemented yet (Phase 3+)");
    return res;
}

void BridgeDispatcher::EmitAcceleratorPressed(const std::string& combo)
{
    if (!m_emit) return;
    json env = {
        {"type",    "evt"},
        {"kind",    "accelerator/pressed"},
        {"payload", {{"combo", combo}}},
    };
    m_emit(env.dump());
}

void BridgeDispatcher::EmitCursorPosition3D(float x, float y, float z)
{
    if (!m_emit) return;
    json env = {
        {"type",    "evt"},
        {"kind",    "cursor/position-3d"},
        {"payload", {{"x", x}, {"y", y}, {"z", z}}},
    };
    m_emit(env.dump());
}

void BridgeDispatcher::EmitEmittersTreeChanged()
{
    if (!m_emit) return;
    // Build the synthetic root + per-actual-root children, matching the
    // shape returned by `emitters/list`.
    json children = json::array();
    if (m_pParticleSystem != nullptr && *m_pParticleSystem)
    {
        const ParticleSystem* sys = m_pParticleSystem->get();
        const auto& emitters = sys->getEmitters();
        for (size_t i = 0; i < emitters.size(); ++i)
        {
            if (emitters[i] != nullptr && emitters[i]->parent == nullptr)
            {
                children.push_back(BuildEmitterTreeNode(sys, i));
            }
        }
    }
    json tree = {
        {"id",        -1},
        {"name",      ""},
        {"role",      "root"},
        {"linkGroup", 0},
        {"visible",   true},
        {"children",  children},
    };
    json env = {
        {"type",    "evt"},
        {"kind",    "emitters/tree/changed"},
        {"payload", json{{"root", tree}}},
    };
    m_emit(env.dump());
}

void BridgeDispatcher::EmitEngineStateChanged()
{
    if (!m_emit || !m_engine) return;
    json spawnerJson = m_spawnerDriver
        ? SpawnerConfigToJson(m_spawnerDriver->GetConfig())
        : m_spawnerConfig;
    const std::wstring& activeModPath = m_modManager ? m_modManager->GetSelectedModPath() : std::wstring();
    const bool leaveParticles = (m_pParticleSystem != nullptr && *m_pParticleSystem)
        ? (*m_pParticleSystem)->getLeaveParticles()
        : true;
    json env = {
        {"type",    "evt"},
        {"kind",    "engine/state/changed"},
        {"payload", BuildEngineStateSnapshot(m_engine, m_currentFilePath, m_dirty, spawnerJson, m_selectedEmitterId, activeModPath, leaveParticles)},
    };
    m_emit(env.dump());
}

void BridgeDispatcher::SetDirty(bool dirty)
{
    if (m_dirty == dirty) return;  // debounce — no-op if already in target state
    m_dirty = dirty;
    EmitDirtyChanged();
    // Don't broadcast engine/state/changed here. Callers that
    // SetDirty(true) at the END of an engine setter already emitted a
    // state/changed for the parameter change; the dirty bit ride-alongs
    // via the dedicated dirty/changed event channel + the next
    // snapshot read. Callers that SetDirty(false) (file/new, file/open,
    // file/save success) emit their own state/changed.
}

void BridgeDispatcher::EmitDirtyChanged()
{
    if (!m_emit) return;
    json env = {
        {"type",    "evt"},
        {"kind",    "dirty/changed"},
        {"payload", {{"dirty", m_dirty}}},
    };
    m_emit(env.dump());
}

void BridgeDispatcher::EmitRecentChanged()
{
    if (!m_emit) return;
    json paths = json::array();
    for (const auto& w : m_recentFiles)
    {
        paths.push_back(WideToUtf8(w));
    }
    json env = {
        {"type",    "evt"},
        {"kind",    "recent/changed"},
        {"payload", {{"paths", paths}}},
    };
    m_emit(env.dump());
}

void BridgeDispatcher::EmitStatsTick(float fps, int emitters,
                                     int particles, int instances)
{
    if (!m_emit) return;
    json env = {
        {"type",    "evt"},
        {"kind",    "stats/tick"},
        {"payload", {
            {"fps",       fps},
            {"emitters",  emitters},
            {"particles", particles},
            {"instances", instances},
        }},
    };
    m_emit(env.dump());
}

void BridgeDispatcher::EmitSpawnerActiveCount(int count)
{
    if (!m_emit) return;
    json env = {
        {"type",    "evt"},
        {"kind",    "spawner/active-count"},
        {"payload", {{"count", count}}},
    };
    m_emit(env.dump());
}

} // namespace host
