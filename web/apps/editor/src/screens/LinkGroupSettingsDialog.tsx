// LinkGroupSettingsDialog — Screen 4 Batch B1.
//
// MT-10 surface in the new UI. On open, fetches the link-group's
// current exempt-field set via `linkGroups/list-exempt-fields` and
// renders a checkbox-per-field list. OK commits the toggles via
// `linkGroups/set-exempt-fields`; Cancel discards. Reset All sets all
// checkboxes off in local state (caller still has to OK to commit —
// matches the legacy "edit-locally, OK-to-confirm" pattern).
//
// Checkbox semantics: checked = SHARED across the group (propagates
// on edit). Unchecked = EXEMPT (per-emitter, no propagation). This is
// the opposite of the underlying `LinkExemptFlags` data model — the
// flag is named "exempt" so true=per-emitter. The wire / dialog
// inverts before crossing the data/UI boundary, matching legacy
// `LinkGroupSettings_PopulateChecks` at [src/UI/EmitterList.cpp:2466].
//
// The full legacy table (kLinkSettingsFields at
// [src/UI/EmitterList.cpp:2381]) covers ~50 fields grouped by
// category. The new-UI dialog uses the same wire-name set as the C++
// host's `kLinkFieldTable` in BridgeDispatcher.cpp; the list of names
// is rendered in fetch order so the host owns the canonical column
// list (a future field addition lands on both sides with one host
// change).
//
// Driven by the `tree-context` atom with `targetLinkGroupId` carrying
// the group ID.

import { useEffect, useState } from "react";
import type { Bridge } from "@particle-editor/bridge-schema";
import { Modal } from "@/components/Modal";
import { useTreeContextStore } from "@/lib/tree-context";

// Display labels for the wire-name field set. Names not in this map
// fall back to the wire name itself so a future field addition still
// renders (just without a friendly label). Mirrors the labels in the
// legacy `kLinkSettingsFields` table at [src/UI/EmitterList.cpp:2381].
const FIELD_LABELS: Readonly<Record<string, string>> = {
  colorTexture:            "Color texture",
  normalTexture:           "Normal texture",
  trackIndex:              "Atlas index curve",
  trackRed:                "Red curve",
  trackGreen:              "Green curve",
  trackBlue:               "Blue curve",
  trackAlpha:              "Alpha curve",
  trackScale:              "Scale curve",
  trackRotationSpeed:      "Rotation speed curve",
  lifetime:                "Lifetime",
  initialDelay:            "Initial delay",
  burstDelay:              "Burst delay",
  nBursts:                 "Number of bursts",
  nParticlesPerBurst:      "Particles per burst",
  nParticlesPerSecond:     "Particles per second",
  useBursts:               "Use bursts",
  gravity:                 "Gravity",
  acceleration:            "Acceleration",
  inwardSpeed:             "Inward speed",
  inwardAcceleration:      "Inward acceleration",
  bounciness:              "Bounciness",
  groundBehavior:          "Ground behavior",
  objectSpaceAcceleration: "Object-space acceleration",
  affectedByWind:          "Affected by wind",
  blendMode:               "Blend mode",
  textureSize:             "Texture size",
  nTriangles:              "Triangles per particle",
  randomScalePerc:         "Random scale %",
  randomLifetimePerc:      "Random lifetime %",
  hasTail:                 "Has tail",
  tailSize:                "Tail size",
  noDepthTest:             "No depth test",
  randomColors:            "Random colors",
  isWeatherParticle:       "Weather particle",
  weatherCubeSize:         "Weather cube size",
  weatherCubeDistance:     "Weather cube distance",
  weatherFadeoutDistance:  "Weather fadeout distance",
  randomRotation:          "Random rotation",
  randomRotationDirection: "Random rotation direction",
  randomRotationAverage:   "Random rotation average",
  randomRotationVariance:  "Random rotation variance",
  linkToSystem:            "Link to system",
  parentLinkStrength:      "Parent link strength",
  doColorAddGrayscale:     "Color-add grayscale",
  isHeatParticle:          "Heat particle",
  isWorldOriented:         "World-oriented",
  freezeTime:              "Freeze time",
  skipTime:                "Skip time",
  emitFromMesh:            "Emit from mesh",
  emitFromMeshOffset:      "Emit from mesh offset",
  groupSpeed:              "Speed params (random box)",
  groupLifetime:           "Lifetime params (random box)",
  groupPosition:           "Position params (random box)",
};

// Canonical column order — matches the legacy table's grouping. Fields
// returned by the host that aren't in this list get appended at the
// end (forward-compat with field additions).
const FIELD_ORDER: readonly string[] = [
  "colorTexture", "normalTexture",
  "trackIndex", "trackRed", "trackGreen", "trackBlue",
  "trackAlpha", "trackScale", "trackRotationSpeed",
  "lifetime", "initialDelay", "burstDelay", "nBursts",
  "nParticlesPerBurst", "nParticlesPerSecond", "useBursts",
  "gravity", "acceleration", "inwardSpeed", "inwardAcceleration",
  "bounciness", "groundBehavior", "objectSpaceAcceleration",
  "affectedByWind",
  "blendMode", "textureSize", "nTriangles", "randomScalePerc",
  "randomLifetimePerc", "hasTail", "tailSize", "noDepthTest",
  "randomColors",
  "isWeatherParticle", "weatherCubeSize", "weatherCubeDistance",
  "weatherFadeoutDistance",
  "randomRotation", "randomRotationDirection",
  "randomRotationAverage", "randomRotationVariance",
  "linkToSystem", "parentLinkStrength", "doColorAddGrayscale",
  "isHeatParticle", "isWorldOriented", "freezeTime", "skipTime",
  "emitFromMesh", "emitFromMeshOffset",
  "groupSpeed", "groupLifetime", "groupPosition",
];

type Props = {
  bridge: Bridge;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; exempt: Set<string> }
  | { kind: "error"; message: string };

export function LinkGroupSettingsDialog({ bridge }: Props) {
  const open = useTreeContextStore((s) => s.open === "link-group");
  const groupId = useTreeContextStore((s) => s.targetLinkGroupId);
  const close = useTreeContextStore((s) => s.close);

  const [state, setState] = useState<LoadState>({ kind: "loading" });

  // Fetch the current exempt set when the dialog opens. Each open is a
  // fresh fetch so external edits (legacy --legacy-ui session writing
  // through MT-10) are reflected immediately.
  useEffect(() => {
    if (!open || groupId === null) {
      setState({ kind: "loading" });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    bridge
      .request({ kind: "linkGroups/list-exempt-fields", params: { groupId } })
      .then((r) => {
        if (cancelled) return;
        setState({ kind: "loaded", exempt: new Set(r.fields) });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, open, groupId]);

  const toggleField = (field: string, sharedNext: boolean) => {
    setState((cur) => {
      if (cur.kind !== "loaded") return cur;
      const next = new Set(cur.exempt);
      // sharedNext === true means checked → SHARED → not exempt.
      if (sharedNext) next.delete(field);
      else next.add(field);
      return { kind: "loaded", exempt: next };
    });
  };

  const resetAll = () => {
    setState((cur) => {
      if (cur.kind !== "loaded") return cur;
      // Reset = all SHARED (no fields exempt). The user must still
      // click OK to commit — matches legacy "edit-locally, OK to
      // confirm" pattern.
      return { kind: "loaded", exempt: new Set() };
    });
  };

  const handleOk = () => {
    if (groupId === null) return;
    if (state.kind !== "loaded") return;
    void bridge.request({
      kind: "linkGroups/set-exempt-fields",
      params: { groupId, fields: Array.from(state.exempt) },
    });
    close();
  };

  // Build the rendered field list. Canonical order first, then any
  // unrecognised field names appended at the bottom (forward-compat).
  const fieldList: string[] =
    state.kind === "loaded"
      ? [
          ...FIELD_ORDER,
          ...Array.from(state.exempt).filter((f) => !FIELD_ORDER.includes(f)),
        ]
      : [];

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      title={`Link Group ${groupId ?? ""} Settings`}
      size="md"
    >
      <Modal.Body>
        {state.kind === "loading" && (
          <div className="text-sm text-text-2">Loading…</div>
        )}
        {state.kind === "error" && (
          <div data-testid="link-group-error" className="text-sm text-red-400">
            Could not load exempt fields: {state.message}
          </div>
        )}
        {state.kind === "loaded" && (
          <div className="flex flex-col gap-1 text-sm">
            <p className="mb-2 text-[11px] leading-relaxed text-text-3">
              Checked fields are <em>shared</em> across the link group —
              edits propagate to every member. Unchecked fields are{" "}
              <em>per-emitter</em>.
            </p>
            <div className="max-h-[40vh] overflow-y-auto">
              {fieldList.map((field) => {
                const shared = !state.exempt.has(field);
                return (
                  <label
                    key={field}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-panel-2"
                  >
                    <input
                      type="checkbox"
                      data-field={field}
                      checked={shared}
                      onChange={(e) => toggleField(field, e.target.checked)}
                    />
                    <span className="text-xs text-text">
                      {FIELD_LABELS[field] ?? field}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <button
          type="button"
          onClick={resetAll}
          disabled={state.kind !== "loaded"}
          className="mr-auto rounded border border-border-2 bg-panel-2 px-3 py-1 text-xs text-text hover:bg-panel-3 outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reset All
        </button>
        <Modal.CancelButton>Cancel</Modal.CancelButton>
        <Modal.OkButton
          onClick={handleOk}
          disabled={state.kind !== "loaded"}
        >
          OK
        </Modal.OkButton>
      </Modal.Footer>
    </Modal>
  );
}
