#include "BridgeDispatcher.h"

#include "AcceleratorBridge.h"
#include "LayoutBroker.h"
#include "third_party/nlohmann/json.hpp"

#include "../engine.h"
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

// LT-4: walk a ParticleSystem and build an EmitterTreeNode-shaped JSON
// tree. Mirrors the schema definition at
// web/packages/bridge-schema/src/index.ts:91. Children are computed
// from each emitter's `spawnDuringLife` / `spawnOnDeath` indices in
// the same order as legacy `ImportEmitters_AddTreeItem` (during-life
// before on-death) so the import dialog tree matches.
json BuildEmitterTreeNode(const ParticleSystem* sys, size_t idx)
{
    if (sys == nullptr || idx >= sys->getEmitters().size()) return json::object();
    const ParticleSystem::Emitter& emit = sys->getEmitter(idx);
    json children = json::array();
    if (emit.spawnDuringLife != static_cast<size_t>(-1))
        children.push_back(BuildEmitterTreeNode(sys, emit.spawnDuringLife));
    if (emit.spawnOnDeath != static_cast<size_t>(-1))
        children.push_back(BuildEmitterTreeNode(sys, emit.spawnOnDeath));
    return json{
        {"id",       static_cast<int>(idx)},
        {"name",     emit.name},
        {"children", children},
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
                              const json& spawnerConfig)
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

    // -------- register-accelerators --------
    if (kind == "register-accelerators")
    {
        auto combos = params.value("combos", std::vector<std::string>{});
        m_accel.RegisterCombos(combos);
        fprintf(stderr, "[host] AcceleratorBridge registered %zu combo(s)\n", combos.size());
        sendOk(json::object());
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
        sendOk(BuildEngineStateSnapshot(m_engine, m_currentFilePath, m_dirty, spawnerJson));
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
    if (kind == "engine/set/heat-debug")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->SetHeatDebug(params.value("enabled", false));
        sendOk(json::object());
        markDirty();
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
        markDirty();
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
        // Emitter parameters changed → notify the React tree (Phase 3
        // emitter UI subscribes to this event). Payload is intentionally
        // an empty tree for now; the full emitter-tree DTO lands when
        // Screen 4 ships the list panel. Sending the event with an
        // empty payload still lets Playwright assert the event fires.
        if (m_emit)
        {
            json env = {
                {"type",    "evt"},
                {"kind",    "emitters/tree/changed"},
                {"payload", json{{"root", json{{"id", 0}, {"name", "root"}, {"children", json::array()}}}}},
            };
            m_emit(env.dump());
        }
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
        if (m_pParticleSystem)
        {
            *m_pParticleSystem = std::make_unique<ParticleSystem>();
            (*m_pParticleSystem)->addRootEmitter();
        }
        m_currentFilePath.clear();
        sendOk(json::object());
        SetDirty(false);
        EmitEngineStateChanged();
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
        if (path.empty())
        {
            wchar_t buf[MAX_PATH] = {};
            OPENFILENAMEW ofn = {};
            ofn.lStructSize = sizeof(ofn);
            ofn.hwndOwner   = m_hostHwnd;
            ofn.lpstrFile   = buf;
            ofn.nMaxFile    = MAX_PATH;
            ofn.lpstrFilter =
                L"Alo files\0*.alo\0All files\0*.*\0";
            ofn.lpstrTitle  = L"Open particle system";
            ofn.Flags       = OFN_PATHMUSTEXIST | OFN_FILEMUSTEXIST | OFN_NOCHANGEDIR;

            if (!GetOpenFileNameW(&ofn))
            {
                // User cancelled / dialog failure.
                sendOk(json{{"ok", false}, {"error", "user-cancelled"}});
                return res;
            }
            path = buf;
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
        if (m_pParticleSystem)
        {
            *m_pParticleSystem = std::move(loaded);
        }
        m_currentFilePath = path;
        m_recentFiles = WriteRecentFile(path);
        sendOk(json{{"ok", true}, {"path", WideToUtf8(path)}});
        SetDirty(false);
        EmitRecentChanged();
        EmitEngineStateChanged();
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
            ofn.lpstrFilter = L"Alo files\0*.alo\0All files\0*.*\0";
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
        ofn.lpstrFilter = L"Alo files\0*.alo\0All files\0*.*\0";
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
        json tree = {
            {"id",       0},
            {"name",     "root"},
            {"children", children},
        };
        sendOk(json{{"ok", true}, {"tree", tree}});
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

void BridgeDispatcher::EmitEngineStateChanged()
{
    if (!m_emit || !m_engine) return;
    json spawnerJson = m_spawnerDriver
        ? SpawnerConfigToJson(m_spawnerDriver->GetConfig())
        : m_spawnerConfig;
    json env = {
        {"type",    "evt"},
        {"kind",    "engine/state/changed"},
        {"payload", BuildEngineStateSnapshot(m_engine, m_currentFilePath, m_dirty, spawnerJson)},
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

} // namespace host
