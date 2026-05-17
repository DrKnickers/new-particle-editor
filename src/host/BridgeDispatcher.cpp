#include "BridgeDispatcher.h"

#include "AcceleratorBridge.h"
#include "LayoutBroker.h"
#include "third_party/nlohmann/json.hpp"

#include "../engine.h"
#include "../UndoStack.h"

#include <cstdio>
#include <string>
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

// Reads every getter on Engine into a JSON object whose shape matches
// `EngineStateDto` in web/packages/bridge-schema/src/index.ts.
//
// Coupling note: any new field added to `EngineStateDto` MUST also be
// added here, otherwise the React UI will read `undefined` for it.
json BuildEngineStateSnapshot(Engine* engine)
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

    return json{
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
    };
}

} // namespace

BridgeDispatcher::BridgeDispatcher(Engine* engine, LayoutBroker& layout,
                                    AcceleratorBridge& accel, EmitFn emit)
    : m_engine(engine), m_layout(layout), m_accel(accel), m_emit(std::move(emit))
{
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
        sendOk(BuildEngineStateSnapshot(m_engine));
        return res;
    }

    // -------- engine/set/* (17 handlers) --------
    if (kind == "engine/set/ground")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->SetGround(params.value("enabled", false));
        sendOk(json::object());
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/ground-z")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->SetGroundZ(params.value("z", 0.0f));
        sendOk(json::object());
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/ground-texture")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->SetGroundTexture(params.value("slot", 0));
        sendOk(json::object());
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/ground-solid-color")
    {
        if (!requireEngine(kind.c_str())) return res;
        unsigned int rgb = params.value("rgb", 0u);
        m_engine->SetGroundSolidColor(static_cast<COLORREF>(rgb));
        sendOk(json::object());
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
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/skydome-slot")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->SetSkydomeSlot(params.value("slot", 0));
        sendOk(json::object());
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
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/background")
    {
        if (!requireEngine(kind.c_str())) return res;
        unsigned int rgb = params.value("rgb", 0u);
        m_engine->SetBackground(static_cast<COLORREF>(rgb));
        sendOk(json::object());
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/bloom")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->SetBloom(params.value("enabled", false));
        sendOk(json::object());
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/bloom-strength")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->SetBloomStrength(params.value("v", 0.0f));
        sendOk(json::object());
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/bloom-cutoff")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->SetBloomCutoff(params.value("v", 0.0f));
        sendOk(json::object());
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/bloom-size")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->SetBloomSize(params.value("v", 0.0f));
        sendOk(json::object());
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/heat-debug")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->SetHeatDebug(params.value("enabled", false));
        sendOk(json::object());
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
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/ambient")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->SetAmbient(JsonToVec4(params.value("color", json::array())));
        sendOk(json::object());
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/set/shadow")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->SetShadow(JsonToVec4(params.value("color", json::array())));
        sendOk(json::object());
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
        EmitEngineStateChanged();
        return res;
    }

    // -------- engine/action/* --------
    if (kind == "engine/action/clear")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->Clear();
        sendOk(json::object());
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/action/reload-shaders")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->ReloadShaders();
        sendOk(json::object());
        EmitEngineStateChanged();
        return res;
    }
    if (kind == "engine/action/reload-textures")
    {
        if (!requireEngine(kind.c_str())) return res;
        m_engine->ReloadTextures();
        sendOk(json::object());
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

    // -------- file/open --------
    //
    // Task 2.4: only the skydome-custom-path flow drives this. Future
    // file/open consumers (alo open, texture import) will reuse the
    // same handler — the `params.path` hint is currently ignored, but
    // a future revision could use it as an initial directory.
    //
    // GetOpenFileNameW runs a nested message loop, so the host's main
    // pump pauses for the dialog's lifetime. That's fine for this
    // Request because the JS caller is awaiting the response and the
    // dialog is a user gesture.
    if (kind == "file/open")
    {
        wchar_t buf[MAX_PATH] = {};
        OPENFILENAMEW ofn = {};
        ofn.lStructSize = sizeof(ofn);
        ofn.hwndOwner   = m_hostHwnd;
        ofn.lpstrFile   = buf;
        ofn.nMaxFile    = MAX_PATH;
        ofn.lpstrFilter =
            L"Skydome textures\0*.dds;*.png;*.jpg;*.tga\0All files\0*.*\0";
        ofn.lpstrTitle  = L"Select skydome texture";
        ofn.Flags       = OFN_PATHMUSTEXIST | OFN_FILEMUSTEXIST | OFN_NOCHANGEDIR;

        if (GetOpenFileNameW(&ofn))
        {
            sendOk(json{{"ok", true}, {"path", WideToUtf8(buf)}});
        }
        else
        {
            // User cancelled — distinguishable from "no dialog could be
            // shown" by CommDlgExtendedError() returning 0. Keep the
            // message generic; React only branches on `ok`.
            sendOk(json{{"ok", false}, {"error", "user-cancelled"}});
        }
        return res;
    }

    // -------- everything else (emitters/* / file/save / file/recent / spawner/*) --------
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
    json env = {
        {"type",    "evt"},
        {"kind",    "engine/state/changed"},
        {"payload", BuildEngineStateSnapshot(m_engine)},
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
