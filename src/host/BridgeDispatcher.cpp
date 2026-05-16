#include "BridgeDispatcher.h"

#include "LayoutBroker.h"
#include "third_party/nlohmann/json.hpp"

#include "../engine.h"

#include <cstdio>

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

} // namespace

BridgeDispatcher::BridgeDispatcher(Engine* engine, LayoutBroker& layout, EmitFn emit)
    : m_engine(engine), m_layout(layout), m_emit(std::move(emit))
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

    if (kind.empty())
    {
        if (m_emit && !id.empty())
            m_emit(BuildErrResponse(id, "missing kind"));
        return;
    }

    // -------- layout/viewport-rect --------
    if (kind == "layout/viewport-rect")
    {
        int x = params.value("x", 0);
        int y = params.value("y", 0);
        int w = params.value("w", 0);
        int h = params.value("h", 0);
        m_layout.Apply(x, y, w, h);
        if (m_emit && !id.empty())
            m_emit(BuildOkResponse(id, json::object()));
        return;
    }

    // -------- engine/state/snapshot --------
    if (kind == "engine/state/snapshot")
    {
        if (!m_engine)
        {
            if (m_emit && !id.empty())
                m_emit(BuildErrResponse(id, "engine not initialized"));
            return;
        }
        // Minimal EngineStateDto for Task 1.3. The full surface (ground,
        // skydomeCustomPaths, bloom, camera, etc.) lands in Task 2.1.
        json data = {
            {"groundZ",     m_engine->GetGroundZ()},
            {"background",  static_cast<unsigned int>(m_engine->GetBackground())},
            {"skydomeSlot", m_engine->GetSkydomeSlot()},
        };
        if (m_emit && !id.empty())
            m_emit(BuildOkResponse(id, data));
        return;
    }

    // -------- everything else --------
    if (m_emit && !id.empty())
        m_emit(BuildErrResponse(id, "not implemented yet (Task 2.1+)"));
}

void BridgeDispatcher::EmitEngineStateChanged()
{
    // Stub — Task 2.1 will broadcast the full snapshot.
}

void BridgeDispatcher::EmitStatsTick(int /*fps*/, int /*emitters*/,
                                     int /*particles*/, int /*instances*/)
{
    // Stub — Task 2.4 will hook this to the host render loop's 4 Hz tick.
}

} // namespace host
