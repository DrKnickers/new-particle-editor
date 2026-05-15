# [MT-4] Adjustable environment lighting in the preview

**Status (2026-05-15):** plan draft v2 (revised to emulate the Petroglyph map editor's Sun/Fill panel), awaiting user approval. Target PR: `feat/mt4-env-lighting`.

Follows the planning conventions established for MT-1 / MT-2: Context block, per-artefact Architecture subsections, named tripwires per risk, verifier-first Verification where each row says *what regression it catches*.

---

## Status of the surrounding work

- ✅ **[MT-1]** Frequently-used textures palette — [#69](https://github.com/DrKnickers/new-particle-editor/pull/69), docs [#70](https://github.com/DrKnickers/new-particle-editor/pull/70)
- ✅ **[MT-2]** Selectable ground texture — [#67](https://github.com/DrKnickers/new-particle-editor/pull/67)
- 🚧 **[MT-4]** Adjustable environment lighting — **this plan**.

Medium-term queue after MT-4: MT-3 (skydome — note the map editor's Sky Dome controls are visible in the reference screenshot but are out-of-scope for MT-4 and will be covered by MT-3).

---

## Context

The engine maintains three directional `Light` structs ([engine.h:75-81](src/engine.h:75)) — `LT_SUN`, `LT_FILL1`, `LT_FILL2` — plus a separate ambient `D3DXVECTOR4` ([engine.h:294](src/engine.h:294)) and a declared-but-never-implemented `SetShadow(D3DXVECTOR4)` ([engine.h:185](src/engine.h:185), no body in [engine.cpp](src/engine.cpp) and no `m_shadow` member). The shader effect binds `hGlobalAmbient`, `hDirLightVec0`, `hDirLightDiffuse`, `hDirLightSpecular` per frame ([engine.cpp:528-532](src/engine.cpp:528), handles declared in [Effect.h:37-41](src/Effect.h:37)). There is **no shader handle for shadow color** — the dangling `SetShadow` API was a piece of unfinished engine plumbing.

Today there is **no way for the user to adjust any of these values**. They are hardcoded at engine construction ([engine.cpp:1384-1400](src/engine.cpp:1384)) to `Sun = white diffuse + zero specular along +X`, `Fill1/Fill2 = all zero`, `Ambient = (0,0,0,0)`. The ROADMAP entry's claim that "values from the loaded particle system can adjust them" is **inaccurate** — `.alo` files don't carry lighting data, and the editor never overrides the hardcoded defaults.

MT-4 surfaces a **View → Lighting…** modeless dialog that mirrors the Petroglyph map editor's Sun/Fill panel (reference screenshot supplied by the user, fog and sky-dome sections omitted). The Bloom dialog ([main.cpp:4867-5013](src/main.cpp:4867)) is the canonical template for modeless-tool-window lifecycle — lazy-created on first open, hides on close, position persisted to `HKCU\Software\AloParticleEditor`, `WM_USER` reseed-from-engine after Reset View Settings. MT-4 clones this shape and fills in the controls.

**Why now**: smallest unshipped medium-term item (4–6 h estimate, on track for ~5 h given the bloom-dialog clone path). Clears MT-4 out of the queue and leaves only MT-3 (skydome, ~8–14 h) ahead in medium-term. Touches no rendering pipeline code beyond exposing two getters and implementing the dangling `SetShadow` stub — risk is contained to UI plumbing.

---

## Goal + scope

A new **View → Lighting…** menu entry opens a modeless dialog `IDD_LIGHTING`. Layout emulates the supplied Petroglyph map-editor screenshot:

```
┌─────────────────────────────────────────────────┐
│ Sun Settings                                    │
│   Intensity  [0.50]   Z Angle  [0.00]°   Tilt [45.00]° │
│   Ambient Color  [swatch]                       │
│   Specular Color [swatch]                       │
│   Diffuse Color  [swatch]                       │
│   Shadow Color   [swatch]                       │
│   [✓] Force Fill Light Alignment                │
│                                                 │
│ Fill Light Settings                             │
│   Intensity 1  [0.50]  Z Angle 1 [120.00]° Tilt 1 [-10.00]° │
│   Diffuse Color  [swatch]                       │
│   [Mirror Sun]                                  │
│   Intensity 2  [0.50]  Z Angle 2 [210.00]° Tilt 2 [-10.00]° │
│   Diffuse Color  [swatch]                       │
│                                                 │
│              [Reset to defaults]                │
└─────────────────────────────────────────────────┘
```

**Controls per light:**

- **Sun:** Intensity spinner, Z Angle spinner, Tilt Angle spinner, Ambient ColorButton, Specular ColorButton, Diffuse ColorButton, Shadow ColorButton.
- **Fill 1 / Fill 2:** Intensity spinner, Z Angle spinner, Tilt Angle spinner, Diffuse ColorButton. (No specular, no ambient, no shadow — they're scene-global properties living in the Sun group.)

**Two binding controls** (not per-light):

- **Force Fill Light Alignment** (checkbox, default **ON**): when checked, the four fill-light angle spinners (Z1, Z2, Tilt1, Tilt2) are **disabled and auto-computed** from the sun's Z angle:
  - `Fill1.Z = Sun.Z + 120°` (mod 360)
  - `Fill2.Z = Sun.Z + 210°` (mod 360)
  - `Fill1.Tilt = Fill2.Tilt = -10°` (fixed)
  The "alignment" keeps the classic 3-light triangle (key + two flanks 120°/210° apart) rotating together as the sun moves. Unchecking enables independent fill-angle editing; values that were last user-set are preserved (or, if never set, snap to the auto-computed values at the moment of unchecking).
- **Mirror Sun** (button, in the Fill Light group): one-shot. Copies the Sun's **Diffuse Color** to both fills' Diffuse Color. Does *not* touch intensity or angles. Disabled when Force Fill Light Alignment is ON (because alignment + mirror together becomes "do everything", which is more than the map editor exposes — keep them orthogonal). One-shot, not a binding mode — clicking it once does the copy and that's it.

**UI ⇄ engine conversion:**

- **Direction (Z Angle + Tilt) ⇄ engine `Light.Position`:**
  - `Position.x = cos(tilt) · cos(z)`
  - `Position.y = cos(tilt) · sin(z)`
  - `Position.z = sin(tilt)`
  - Z Angle is azimuth in degrees, range `0–360°` (wraps).
  - Tilt is elevation in degrees, range `-90 to +90°` (clamps).
  - `Engine::SetLight` normalizes Position and negates into Direction internally ([engine.cpp:1074-1076](src/engine.cpp:1074)) — we don't have to.
- **Intensity + Diffuse Color ⇄ engine `Light.Diffuse`:**
  - `Diffuse = (R/255 · I, G/255 · I, B/255 · I, 1.0)` where (R,G,B) is the 8-bit color and I is intensity.
- **Intensity + Specular Color ⇄ engine `Light.Specular`** (Sun only):
  - `Specular = (R/255 · I, G/255 · I, B/255 · I, 1.0)` using the **specular** color picker, with the *same* sun intensity multiplier.
  - Fills get `Specular = (0,0,0,0)` — they have no specular color picker, consistent with the map editor.
- **Ambient Color ⇄ engine `m_ambient`** (scene-global, lives in Sun group visually):
  - `m_ambient = (R/255, G/255, B/255, 0.0)`. No intensity multiplier — ambient is meant as a low-magnitude floor light, not something you crank. `w=0` preserves the current `m_ambient = (0,0,0,0)` convention ([engine.cpp:1292](src/engine.cpp:1292)).
- **Shadow Color ⇄ engine `m_shadow`** (scene-global, lives in Sun group visually):
  - `m_shadow = (R/255, G/255, B/255, 0.0)`. **Stored only.** The dangling `Engine::SetShadow` stub gets a real implementation that writes `m_shadow`, but no shader handle binds it today — see R3.

**Defaults — match the screenshot exactly:**

| Setting | Default | Engine effect |
|---|---|---|
| Sun Intensity | `0.50` | scales Diffuse + Specular |
| Sun Z Angle | `0.00°` | Position azimuth |
| Sun Tilt Angle | `45.00°` | Position elevation |
| Sun Ambient Color | `RGB(40, 40, 50)` (dark blue-grey) | `m_ambient = (0.157, 0.157, 0.196, 0)` |
| Sun Specular Color | `RGB(190, 190, 200)` (light grey) | scaled by intensity |
| Sun Diffuse Color | `RGB(180, 180, 190)` (light grey-blue) | scaled by intensity |
| Shadow Color | `RGB(100, 100, 110)` (medium grey) | `m_shadow` stored, currently unbound |
| Force Fill Light Alignment | **ON** | fills auto-compute from sun |
| Fill 1 Intensity | `0.50` | scales Diffuse |
| Fill 1 Z Angle | `120.00°` *(auto)* | Position azimuth |
| Fill 1 Tilt Angle | `-10.00°` *(auto)* | Position elevation |
| Fill 1 Diffuse Color | `RGB(60, 80, 160)` (slate blue) | scaled by intensity |
| Fill 2 Intensity | `0.50` | scales Diffuse |
| Fill 2 Z Angle | `210.00°` *(auto)* | Position azimuth |
| Fill 2 Tilt Angle | `-10.00°` *(auto)* | Position elevation |
| Fill 2 Diffuse Color | `RGB(60, 80, 160)` (slate blue, same as Fill 1) | scaled by intensity |

The exact RGB values are eyeballed from the screenshot; the implementation should pin them down by sampling the screenshot or, ideally, by checking the Petroglyph map editor's source/binary for the canonical Alamo defaults. Treat the table above as **structurally correct, numerically approximate** — the implementation can pick precise hexes during the resource-file pass.

**This changes the default visual** from the current pre-MT-4 baseline. Currently the editor opens with Sun white at Z=0°/Tilt=0° (Diffuse=(1,1,1,1), Position=(1,0,0)), fills off, ambient (0,0,0,0). The new defaults give a softer 3-light setup right out of the box, matching what map authors are used to seeing in the map editor. This is **intentional** and the headline visual change of the PR — note prominently in CHANGELOG.

**In:**

- **New `IDD_LIGHTING` dialog template** in [src/ParticleEditor.en.rc:144](src/ParticleEditor.en.rc:144) area (after `IDD_BLOOM`), roughly `240×320 px`, `WS_POPUP | WS_CAPTION | WS_SYSMENU`, centered on owner on first open. Final pixel dimensions sized to fit content during implementation.
- **New menu entry** `View → Lighting…` (`ID_VIEW_LIGHTING = 40117`, next free) in [src/ParticleEditor.en.rc:516](src/ParticleEditor.en.rc:516).
- **New control IDs** in [src/Resources/resource.en.h](src/Resources/resource.en.h):
  - Sun: `IDC_LIGHTING_SUN_{INTENSITY,ZANGLE,TILT,AMBIENT,SPECULAR,DIFFUSE,SHADOW}` (7 IDs)
  - Per fill (×2): `IDC_LIGHTING_FILL{1,2}_{INTENSITY,ZANGLE,TILT,DIFFUSE}` (8 IDs)
  - Bindings: `IDC_LIGHTING_FORCE_ALIGN` (checkbox), `IDC_LIGHTING_MIRROR_SUN` (button)
  - `IDC_LIGHTING_RESET` (reset button)
  - **18 control IDs total.**
- **`LightingDlgProc` + `ToggleLightingDialog`** in [src/main.cpp](src/main.cpp) after `BloomDlgProc` and `ToggleBloomDialog`, mirroring their lifecycle exactly: lazy-create on first toggle, hide on close, save position to registry, `WM_USER` reseed-from-engine after Reset View Settings.
- **`APPLICATION_INFO.hLightingDlg`** field added next to `hBloomDlg` ([main.cpp:586](src/main.cpp:586)).
- **Engine getters** `Engine::GetLight(LightType) const → const Light&`, `Engine::GetAmbient() const → const D3DXVECTOR4&`, and `Engine::GetShadow() const → const D3DXVECTOR4&` added to [engine.h:184](src/engine.h:184) area. Setters either exist (`SetLight`, `SetAmbient`) or get a new minimal implementation (`SetShadow`).
- **Implement the dangling `SetShadow`** in [engine.cpp](src/engine.cpp): add `m_shadow` member, store the vec4 in `SetShadow`, expose `GetShadow`. **Does not bind to a shader handle** — see R3.
- **Registry I/O** under `HKCU\Software\AloParticleEditor`, following bloom's `WriteBloomFloat` / `ReadBloomFloat` pattern:
  - **Sun:** `LightSun{Intensity, ZAngle, Tilt}` (REG_BINARY float, 3 keys), `LightSun{Ambient, Specular, Diffuse, Shadow}Color` (REG_DWORD COLORREF, 4 keys). **7 keys.**
  - **Fill1, Fill2:** `Light{Fill1,Fill2}{Intensity, ZAngle, Tilt}` (REG_BINARY float, 6 keys), `Light{Fill1,Fill2}DiffuseColor` (REG_DWORD COLORREF, 2 keys). **8 keys.**
  - **Bindings:** `LightingForceFillAlignment` (REG_DWORD bool). **1 key.**
  - **Dialog:** `LightingDialogPos` (REG_BINARY RECT). **1 key.**
  - **Total: 17 new registry keys** under the existing app key.
- **Startup restore**: in `WinMain` after engine construction, before the first frame, read all 16 lighting keys (each with a sensible default if absent) and push them through `SetLight` × 3 + `SetAmbient` + `SetShadow`. Same code path as bloom's `ReadBloomEnabled` / `ReadBloomFloat` calls ([main.cpp:4943-4960](src/main.cpp:4943)).
- **Reset View Settings integration**: the existing handler ([main.cpp:1593-1642](src/main.cpp:1593)) gains:
  - Wipe the 17 lighting registry keys via `RegDeleteValue` (loop over a constant array).
  - Push hardcoded defaults to engine via `SetLight` / `SetAmbient` / `SetShadow`.
  - Post `WM_USER` to `hLightingDlg` if open → dialog reseeds spinners/colorbuttons/checkbox from engine state.
  - Update the prompt's MessageBox text to include "lighting".
- **In-panel Reset button** writes the same defaults to engine + registry + UI controls. Confirmation prompt: "Reset all lighting to defaults?" `MB_YESNO | MB_ICONQUESTION`.
- **Esc handling** in the dialog: pressing Esc when the dialog or one of its child controls has focus closes the dialog (saves position, hides). Standard `WM_COMMAND IDCANCEL` route.
- **Debug instrumentation** under `#ifndef NDEBUG`: `[Lighting] set sun int=%.2f z=%.1f tilt=%.1f`, `[Lighting] set fill%d int=%.2f z=%.1f tilt=%.1f color=#%06x`, `[Lighting] set ambient #%06x`, `[Lighting] set shadow #%06x (engine stores only; no shader binding)`, `[Lighting] force-align toggled %s`, `[Lighting] mirror sun: copied diffuse #%06x to both fills`, `[Lighting] reset to defaults source=%s` (panel / view-menu), `[Lighting] dialog show pos=(%d,%d)`, `[Lighting] dialog hide pos=(%d,%d)`, `[Lighting] startup restore loaded=%d missing=%d`.

**Out:**

- **Per-light Enable checkboxes.** *Reason: explicitly rejected — the map editor doesn't have them; setting intensity to 0 is the documented "off" gesture.*
- **Fog settings (start, end, color, enabled).** *Reason: explicitly omitted per user. The engine has fog handles wired (`hFogVals`) so this could be a small follow-up if anyone asks.*
- **Sky Dome controls.** *Reason: that's MT-3's scope, separately tracked. The map-editor screenshot shows them in the same panel but we keep MT-3 as its own item.*
- **Shadow color shader binding.** *Reason: no `hShadow` handle exists in `Effect.h` and no current shader references one. We implement `SetShadow` to store the value (so the API stops being dangling) and persist the picker's value, but the preview doesn't visually change when you adjust shadow color. CHANGELOG entry must call this out plainly.*
- **Visual gizmo for direction** (drag a dot on a hemisphere). *Reason: ~200 LOC of custom paint, blows the estimate.*
- **Per-`.alo`-file lighting overrides.** *Reason: file format doesn't carry lighting; sidecar design is separate scope.*
- **Lighting presets** (save / load named configurations). *Reason: out of scope for v1; short follow-up that reuses the registry I/O if requested.*
- **Animated lights / time-of-day slider.** *Reason: separate feature.*
- **Tabbed or compact layout.** *Reason: emulating the screenshot, which uses a single tall panel.*
- **Force Fill Light Alignment as a *binding* mode** that re-applies on every Sun-Z change after un-checking. *Reason: explicitly one-shot semantics — Force is either ON (alignment active, spinners disabled) or OFF (free editing). No middle "auto-recompute once when you change sun" mode.*
- **Mirror Sun for diffuse + specular + intensity.** *Reason: scoping it to just diffuse color matches what the screenshot looks like (one button, simple action). Promoting to a full multi-field copy is a follow-up if it's missed.*
- **Localized (German) string translations.** *Reason: project's German strings are perennially behind English; the German `.de.rc` mirrors structure with English placeholders, consistent with MT-1.*

---

## What we already have

| Piece | File:line |
|---|---|
| `Light` struct (Diffuse/Specular/Position/Direction vec4s) | [src/engine.h:75-81](src/engine.h:75) |
| `LightType` enum (`LT_SUN`/`LT_FILL1`/`LT_FILL2`) | [src/engine.h:68-72](src/engine.h:68) |
| `Engine::SetLight(LightType, const Light&)` — normalizes Position → Direction, recalculates SH matrices | [src/engine.cpp:1062-1081](src/engine.cpp:1062) |
| `Engine::SetAmbient(D3DXVECTOR4)` | [src/engine.cpp:1083-1090](src/engine.cpp:1083) |
| `Engine::SetShadow(D3DXVECTOR4)` declared, **never implemented** — we add the body | [src/engine.h:185](src/engine.h:185) |
| `m_lights[3]` array (SUN=0, FILL1=1, FILL2=2) | [src/engine.h:295](src/engine.h:295) |
| `m_ambient` vec4 (defaults `(0,0,0,0)`) | [src/engine.h:294](src/engine.h:294), [src/engine.cpp:1292](src/engine.cpp:1292) |
| Hardcoded light defaults at engine construction | [src/engine.cpp:1384-1400](src/engine.cpp:1384) |
| Effect handles (no shadow handle present) | [src/Effect.h:37-46](src/Effect.h:37) |
| Per-frame shader binds | [src/engine.cpp:528-532](src/engine.cpp:528) |
| `BloomDlgProc` (modeless dialog procedure to clone) | [src/main.cpp:4867-4959](src/main.cpp:4867) |
| `ToggleBloomDialog` (lazy-create + show/hide + position save) | [src/main.cpp:4961-5013](src/main.cpp:4961) |
| `WriteBloomFloat` / `ReadBloomFloat` (REG_BINARY float helpers) | [src/main.cpp:4439-4467](src/main.cpp:4439) |
| `WriteBloomEnabled` / `ReadBloomEnabled` (REG_DWORD bool helpers) | [src/main.cpp:4414-4437](src/main.cpp:4414) |
| Bloom dialog position persistence pattern | [src/main.cpp:4944-4998](src/main.cpp:4944) |
| `Reset View Settings` handler (the integration point) | [src/main.cpp:1593-1642](src/main.cpp:1593) |
| Spinner control (numeric edit + up/down) | [src/UI/Spinner.cpp](src/UI/Spinner.cpp); usage example [src/ParticleEditor.en.rc:152](src/ParticleEditor.en.rc:152) |
| ColorButton control (color swatch + Win32 color picker) | [src/UI/ColorButton.cpp](src/UI/ColorButton.cpp) |
| `APPLICATION_INFO` struct (the per-app singleton) | [src/main.cpp:586](src/main.cpp:586) area — add `HWND hLightingDlg` next to `hBloomDlg` |
| View menu entries | [src/ParticleEditor.en.rc:516-532](src/ParticleEditor.en.rc:516) |
| WM_USER dialog reseed pattern (used by bloom after Reset View Settings) | [src/main.cpp:1620](src/main.cpp:1620) area + BloomDlgProc's WM_USER case |

**Not yet in the codebase — to add:**

- **`Engine::GetLight(LightType which) const`**, **`Engine::GetAmbient() const`**, **`Engine::GetShadow() const`** — single-line inline accessors in [src/engine.h:184](src/engine.h:184) area. Used by `WM_USER` reseed and by the in-panel Reset to write values back.
- **`Engine::SetShadow` implementation** in [src/engine.cpp](src/engine.cpp) (currently linker-dangling): two-line body that writes `m_shadow = color`. No SH recalc, no shader bind.
- **`Engine::m_shadow`** vec4 member in [src/engine.h](src/engine.h), initialized to the default shadow color `(100/255, 100/255, 110/255, 0)` in the engine constructor.
- **`LightingDlgProc(HWND, UINT, WPARAM, LPARAM)`** in `main.cpp` after `BloomDlgProc`. ~200 LOC including per-control change handlers, force-align enable/disable logic, mirror-sun handler.
- **`ToggleLightingDialog(APPLICATION_INFO*)`** in `main.cpp` after `ToggleBloomDialog`. ~30 LOC mirroring the bloom version.
- **`InitializeLightingFromRegistry(Engine*)`** in `main.cpp` — called once at startup, after engine construction, before the first frame. Reads 16 lighting registry keys with defaults; calls `SetLight` × 3 + `SetAmbient` + `SetShadow`. ~70 LOC.
- **`ApplyLightingDefaults(Engine*, HWND hDlgOrNull)`** in `main.cpp` — used by both the in-panel Reset button and the View → Reset View Settings handler. Writes defaults to engine, wipes registry keys, posts `WM_USER` to dialog if open. ~40 LOC.
- **Spherical-coordinate conversion helpers** (file-local `static`): `DirectionFromZTilt(float z_deg, float tilt_deg) → D3DXVECTOR4`. ~5 LOC.
- **Force-align computation helper**: `ComputeAlignedFill(int which, float sunZ_deg) → (z_deg, tilt_deg)`. Returns `(sunZ + 120, -10)` for Fill1, `(sunZ + 210, -10)` for Fill2.
- **17 registry keys + 1 menu ID + 1 dialog template + 18 control IDs.** Localized in both `.en.rc` + `.de.rc` (German with English placeholders).

*(All design questions resolved — see "Resolved decisions" at the bottom of the spec.)*

---

## Architecture / implementation approach

### A. Data flow

```
                  ┌──── Registry (HKCU\Software\AloParticleEditor)
                  │       17 keys (LightSun*, LightFill{1,2}*,
                  │                LightingForceFillAlignment, LightingDialogPos)
                  │
       startup    │   WM_COMMAND               in-panel Reset                   View > Reset View Settings
       ────────   │   (spinner SN_CHANGE,      button                           menu handler
       Init…      │    color picker,           ────────                         ────────────────
       FromReg    │    checkbox, mirror btn)   ApplyLightingDefaults            ApplyLightingDefaults
       ────────   │   ────────                 ────────                         ────────────────
                  ↓        ↓                        ↓                                   ↓
            ┌─────────────────────────────────────────────────────────────────────────────┐
            │                                                                             │
            │     LightingDlgProc — owns conversion math, alignment, and registry write   │
            │                                                                             │
            │     z, tilt → DirectionFromZTilt → Position vec4                            │
            │     Force-align ON → recompute fill Z/Tilt from sun on every sun change     │
            │     Color × Intensity → Diffuse / Specular vec4                             │
            │                                                                             │
            └────────────────────────────┬────────────────────────────────────────────────┘
                                         │
                                         ↓
                              Engine::SetLight / SetAmbient / SetShadow
                                         │
                                         ↓
                              recalc SPH matrices, set shader vectors next frame
                                         │
                                         ↓
                              InvalidateRect(viewport) → WM_PAINT → render
```

Three callers feed the same engine-write path: dialog per-control change, in-panel Reset, View → Reset View Settings. The dialog owns the UI representation; the engine owns the rendering representation; conversion happens at the boundary in `LightingDlgProc`.

### B. Registry schema

All keys under `HKCU\Software\AloParticleEditor`. Existing keys (Bloom, GroundSolidColor, LastMod, etc.) untouched.

| Key | Type | Default | Notes |
|---|---|---|---|
| `LightSunIntensity` | REG_BINARY (float) | `0.50` | scales Diffuse + Specular |
| `LightSunZAngle` | REG_BINARY (float) | `0.0` | degrees, 0–360 wrap |
| `LightSunTilt` | REG_BINARY (float) | `45.0` | degrees, −90 to +90 clamp |
| `LightSunAmbientColor` | REG_DWORD | `RGB(40,40,50)` | scene-global ambient |
| `LightSunSpecularColor` | REG_DWORD | `RGB(190,190,200)` | scaled by sun intensity |
| `LightSunDiffuseColor` | REG_DWORD | `RGB(180,180,190)` | scaled by sun intensity |
| `LightSunShadowColor` | REG_DWORD | `RGB(100,100,110)` | scene-global; **stored only** (R3) |
| `LightingForceFillAlignment` | REG_DWORD | `1` (ON) | binding mode for fill angles |
| `LightFill1Intensity` | REG_BINARY (float) | `0.50` | scales Diffuse |
| `LightFill1ZAngle` | REG_BINARY (float) | `120.0` | only written when force-align OFF; while ON, computed from sun |
| `LightFill1Tilt` | REG_BINARY (float) | `-10.0` | same |
| `LightFill1DiffuseColor` | REG_DWORD | `RGB(60,80,160)` | scaled by fill 1 intensity |
| `LightFill2Intensity` | REG_BINARY (float) | `0.50` | |
| `LightFill2ZAngle` | REG_BINARY (float) | `210.0` | |
| `LightFill2Tilt` | REG_BINARY (float) | `-10.0` | |
| `LightFill2DiffuseColor` | REG_DWORD | `RGB(60,80,160)` | |
| `LightingDialogPos` | REG_BINARY (RECT) | (none — center on owner) | screen coords |

**Note on the force-align interaction with persistence:** when alignment is ON, the fill Z/Tilt registry values are *not* live-rewritten as the sun rotates — they're the "last manually set" values, restored when alignment is turned OFF. This means the registry can hold a stale (Fill1 Z = 120, Sun Z = 0) pair that doesn't match what the renderer sees. That's intentional and matches the map editor: the persisted values represent the user's previous *free-edit* state, ready to be re-activated when alignment is unchecked.

### C. Dialog template (rough resource sketch)

```rc
IDD_LIGHTING DIALOGEX 0, 0, 240, 320
STYLE DS_SETFONT | WS_POPUP | WS_CAPTION | WS_SYSMENU
CAPTION "Lighting"
FONT 8, "MS Shell Dlg"
BEGIN
    GROUPBOX     "Sun Settings",         IDC_STATIC,            8,   4, 224, 156

      LTEXT      "Intensity",             IDC_STATIC,           18,  18,  40,  10
      CONTROL    "",                      IDC_LIGHTING_SUN_INTENSITY, "Spinner", WS_TABSTOP, 18, 28, 50, 14
      LTEXT      "Z Angle",               IDC_STATIC,           78,  18,  40,  10
      CONTROL    "",                      IDC_LIGHTING_SUN_ZANGLE,    "Spinner", WS_TABSTOP, 78, 28, 50, 14
      LTEXT      "Tilt Angle",            IDC_STATIC,          138,  18,  50,  10
      CONTROL    "",                      IDC_LIGHTING_SUN_TILT,      "Spinner", WS_TABSTOP, 138, 28, 50, 14

      LTEXT      "Ambient Color",         IDC_STATIC,           18,  50,  60,  10
      CONTROL    "",                      IDC_LIGHTING_SUN_AMBIENT,   "ColorButton", WS_TABSTOP, 78, 48, 40, 14
      LTEXT      "Specular Color",        IDC_STATIC,          122,  50,  60,  10
      CONTROL    "",                      IDC_LIGHTING_SUN_SPECULAR,  "ColorButton", WS_TABSTOP, 184, 48, 40, 14

      LTEXT      "Diffuse Color",         IDC_STATIC,           18,  72,  60,  10
      CONTROL    "",                      IDC_LIGHTING_SUN_DIFFUSE,   "ColorButton", WS_TABSTOP, 78, 70, 40, 14
      LTEXT      "Shadow Color",          IDC_STATIC,          122,  72,  60,  10
      CONTROL    "",                      IDC_LIGHTING_SUN_SHADOW,    "ColorButton", WS_TABSTOP, 184, 70, 40, 14

      AUTOCHECKBOX "Force Fill Light Alignment", IDC_LIGHTING_FORCE_ALIGN, 18, 100, 140, 12

    GROUPBOX     "Fill Light Settings",   IDC_STATIC,            8, 166, 224, 130

      LTEXT      "Intensity 1",           IDC_STATIC,           18, 180,  44, 10
      CONTROL    "",                      IDC_LIGHTING_FILL1_INTENSITY, "Spinner", WS_TABSTOP, 18, 190, 50, 14
      LTEXT      "Z Angle 1",             IDC_STATIC,           78, 180,  44, 10
      CONTROL    "",                      IDC_LIGHTING_FILL1_ZANGLE,    "Spinner", WS_TABSTOP, 78, 190, 50, 14
      LTEXT      "Tilt 1",                IDC_STATIC,          138, 180,  44, 10
      CONTROL    "",                      IDC_LIGHTING_FILL1_TILT,      "Spinner", WS_TABSTOP, 138, 190, 50, 14
      LTEXT      "Diffuse",               IDC_STATIC,           18, 210,  44, 10
      CONTROL    "",                      IDC_LIGHTING_FILL1_DIFFUSE,   "ColorButton", WS_TABSTOP, 78, 208, 40, 14
      PUSHBUTTON "Mirror Sun",            IDC_LIGHTING_MIRROR_SUN,     150, 208, 60, 14

      LTEXT      "Intensity 2",           IDC_STATIC,           18, 234,  44, 10
      CONTROL    "",                      IDC_LIGHTING_FILL2_INTENSITY, "Spinner", WS_TABSTOP, 18, 244, 50, 14
      LTEXT      "Z Angle 2",             IDC_STATIC,           78, 234,  44, 10
      CONTROL    "",                      IDC_LIGHTING_FILL2_ZANGLE,    "Spinner", WS_TABSTOP, 78, 244, 50, 14
      LTEXT      "Tilt 2",                IDC_STATIC,          138, 234,  44, 10
      CONTROL    "",                      IDC_LIGHTING_FILL2_TILT,      "Spinner", WS_TABSTOP, 138, 244, 50, 14
      LTEXT      "Diffuse",               IDC_STATIC,           18, 268,  44, 10
      CONTROL    "",                      IDC_LIGHTING_FILL2_DIFFUSE,   "ColorButton", WS_TABSTOP, 78, 266, 40, 14

    PUSHBUTTON   "Reset to defaults",     IDC_LIGHTING_RESET,         76, 300, 88, 14
END
```

Exact pixel coords are sized during implementation. The structural layout matches the supplied screenshot.

### D. Message routing

| Message | Action |
|---|---|
| `WM_INITDIALOG` | Read current values from engine via `GetLight`/`GetAmbient`/`GetShadow`; decompose into intensity/Z/tilt/color quadruples; populate all controls; apply force-align disabled state to fill angle spinners and mirror-sun button; resize-to-saved-pos via `LightingDialogPos`. |
| `WM_USER` (from `Reset View Settings`) | Same as `WM_INITDIALOG`'s seeding step — read engine, refresh all controls. No registry I/O (registry was already updated by the reset handler). |
| `WM_COMMAND` `SN_CHANGE` on `IDC_LIGHTING_SUN_INTENSITY/_DIFFUSE/_SPECULAR/_AMBIENT/_SHADOW` change | Recompute the corresponding vec4; call `SetLight(LT_SUN, ...)` and/or `SetAmbient` / `SetShadow`; write the changed key; redraw. **Intensity changes also recompute Specular** (since they share intensity). |
| `WM_COMMAND` `SN_CHANGE` on `IDC_LIGHTING_SUN_ZANGLE/_TILT` | Recompute Sun Position; `SetLight(LT_SUN, ...)`; write the key; redraw. **If force-align is ON, also recompute and re-apply both Fill1 and Fill2 directions** without writing their registry keys. |
| `WM_COMMAND` `SN_CHANGE` on `IDC_LIGHTING_FILL1_*`/`FILL2_*` | Recompute the fill Light vec4; `SetLight(LT_FILL{1,2}, ...)`; write the key; redraw. (Angle spinners are disabled while force-align ON, so this only fires from intensity or diffuse changes in that mode.) |
| `WM_COMMAND` `BN_CLICKED` on `IDC_LIGHTING_FORCE_ALIGN` | Read checkbox state; enable/disable Fill Z/Tilt spinners; enable/disable Mirror Sun button; if newly ON, immediately recompute fill directions from sun (no registry write); if newly OFF, restore registry-stored fill Z/Tilt values to the spinners (and `SetLight` to apply); write the `LightingForceFillAlignment` key. |
| `WM_COMMAND` `BN_CLICKED` on `IDC_LIGHTING_MIRROR_SUN` | Read Sun diffuse color; write it to both Fill1 and Fill2 diffuse color pickers; update engine via `SetLight` × 2; write the two `Light{Fill1,Fill2}DiffuseColor` registry keys; redraw. |
| `WM_COMMAND` `BN_CLICKED` on `IDC_LIGHTING_RESET` | Confirm via `MessageBox`; on YES call `ApplyLightingDefaults`; refresh all controls. |
| `WM_COMMAND` `IDCANCEL` (Esc) | Save position; hide. |
| `WM_CLOSE` | Save position; hide. |

### E. Per-control conversion details

```cpp
// Per-light vec4 builder
static Engine::Light MakeLight(float z_deg, float tilt_deg,
                               COLORREF diffuseColor, COLORREF specularColor,
                               float intensity)
{
    Engine::Light L = {};
    L.Position = DirectionFromZTilt(z_deg, tilt_deg);

    float dR = GetRValue(diffuseColor)  / 255.0f * intensity;
    float dG = GetGValue(diffuseColor)  / 255.0f * intensity;
    float dB = GetBValue(diffuseColor)  / 255.0f * intensity;
    L.Diffuse = D3DXVECTOR4(dR, dG, dB, 1.0f);

    float sR = GetRValue(specularColor) / 255.0f * intensity;
    float sG = GetGValue(specularColor) / 255.0f * intensity;
    float sB = GetBValue(specularColor) / 255.0f * intensity;
    L.Specular = D3DXVECTOR4(sR, sG, sB, 1.0f);

    return L;
}

// Fills pass specularColor = RGB(0,0,0) so Specular comes out zero.
```

`DirectionFromZTilt` does the standard `(cos(tilt)cos(z), cos(tilt)sin(z), sin(tilt))` conversion with degrees-to-radians. The engine's `SetLight` handles normalization + Direction derivation.

### F. Touch points by file

| File | Change |
|---|---|
| `src/engine.h` | Add `GetLight(LightType) const`, `GetAmbient() const`, `GetShadow() const` inline accessors; add `D3DXVECTOR4 m_shadow` member. |
| `src/engine.cpp` | Implement `SetShadow` (store-only); initialize `m_shadow` in constructor. |
| `src/main.cpp` | Add constants for defaults, `DirectionFromZTilt` + `ComputeAlignedFill` helpers, `LightingDlgProc`, `ToggleLightingDialog`, `InitializeLightingFromRegistry`, `ApplyLightingDefaults`, `hLightingDlg` field in `APPLICATION_INFO`, hook into Reset View Settings, hook startup init, register `ID_VIEW_LIGHTING` in the main menu switch. |
| `src/ParticleEditor.en.rc` | Add `IDD_LIGHTING` template; add `View → Lighting…` to View menu. |
| `src/ParticleEditor.de.rc` | Mirror structure with placeholder strings. |
| `src/Resources/resource.en.h` | Add `ID_VIEW_LIGHTING = 40117`; add 18 control IDs (`IDC_LIGHTING_*`). |
| `src/Resources/resource.de.h` | Same IDs as English. |

Notably absent: **no shader changes, no engine state-machine changes, no file-format changes, no UndoStack hooks.**

---

## Risks named up front + mitigations

1. **R1 — New defaults visibly change the editor's appearance on every existing user's next launch.** Pre-MT-4: white sun pointing along +X, no fills, no ambient. Post-MT-4: 3-light setup with grey ambient, slate-blue fills, sun tilted 45° up. Every existing screenshot in CHANGELOG / docs / community wikis showing the editor's render will look different from a fresh launch after this ships. **Tripwire:** users open a familiar particle effect and the lighting looks different; some will read this as a regression.
   **Mitigation:** make this the **headline visual change** of the CHANGELOG entry, with a side-by-side before/after. The new defaults match the Petroglyph map editor, which is the canonical reference for what a finished effect should look like in-game — so this is a *step toward authenticity*, not a regression. Reset View Settings restores these new defaults (not the pre-MT-4 white-sun-along-X). If anyone strongly objects, the defaults table is a one-place change.

2. **R2 — Direction convention (which axis is "up")** isn't called out in `engine.cpp`'s lighting code. The current default sun Position `(1,0,0)` is along +X. If the engine treats +Y or +Z as "up" in world space, then "Tilt Angle" measured around the wrong axis won't match user intuition. **Tripwire:** user sets Tilt to 45° expecting the sun to move halfway up the sky; instead it moves sideways or down.
   **Mitigation:** during implementation, manually test the formula `Position = (cos·cos, cos·sin, sin)` by setting (z=0,tilt=0)/(z=90,tilt=0)/(z=0,tilt=90)/(z=0,tilt=−90) and visually confirming the sun moves through east→north→zenith→nadir semantics in the viewport. If the visual is wrong, swap two axes in `DirectionFromZTilt`. **This is a 2-minute check, but it absolutely must happen before merge** — *do not* trust the formula on paper.

3. **R3 — Shadow Color is a no-op control.** Engine has no shader handle for shadow color; the supposed `SetShadow` API has never been implemented. We're implementing it as a store-only stub. **Tripwire:** user changes shadow color, expects something to visually shift (e.g. the ground in shadowed regions tints), sees no change, thinks the editor is broken.
   **Mitigation:** **explicit UI affordance.** Either (a) the tooltip on the Shadow Color picker says "Shadow color is stored and persists, but the preview renderer does not currently use it." Or (b) we omit it from the panel entirely. Recommend (a) for fidelity with the map editor's layout, with the tooltip + a CHANGELOG note. If reviewers prefer (b), removing the control is a 4-line patch (delete the static label, the ColorButton, the registry key, and the conversion code).

4. **R4 — Force Fill Light Alignment's enabled/disabled state cycles** through several modes that can confuse the UI. ON at startup → spinners disabled, mirror-sun disabled. User unchecks → spinners enable to last-persisted values, mirror-sun enables. User edits Fill1 Z. User re-checks → spinners disable, *and the engine snaps fills back to (Sun Z + 120, -10)*, but the registry still holds the user's edited Fill1 Z. **Tripwire:** user un-checks force-align again expecting their previous edit to come back; if our restore-from-registry path reads stale state or the wrong source, they get the auto-computed values instead.
   **Mitigation:** **registry is the only source of truth for fill Z/Tilt.** When force-align is ON, we never write the fill Z/Tilt registry keys — we only push computed values to the engine. When force-align goes OFF, we read the registry values back into the spinners (and to the engine). When force-align goes ON, we recompute and push to engine but leave registry untouched. This guarantees the "uncheck → restore" path works regardless of cycle count.

5. **R5 — Mirror Sun button overwrites both fills with no undo.** User has carefully tuned fill diffuse colors, accidentally clicks Mirror Sun, loses them. **Tripwire:** angry user.
   **Mitigation:** confirmation prompt before applying? *No — too noisy for a one-click button.* Alternative: the button is positioned in the Fill Light *Settings* group, not somewhere they'd hit by mistake while editing the Sun. The map-editor screenshot positions it the same way. Document in the tooltip: "Copy Sun's Diffuse Color to both fill lights." If users complain, we can add a single-level undo (one button click of "Undo Mirror Sun" that restores the prior two fill colors); easy follow-up.

6. **R6 — Dialog position lands off-screen after monitor topology change.** Same hazard as MT-1's popup. **Tripwire:** dialog opens, isn't visible anywhere, menu shows it as open.
   **Mitigation:** validate position via `MonitorFromPoint(MONITOR_DEFAULTTONULL)` on show; fall back to centering on owner if invalid. **Verify bloom dialog handles this today** — if not, copy the new validation logic back into `ToggleBloomDialog` as a freebie fix.

7. **R7 — Reset View Settings prompt text drift.** The current prompt enumerates what gets reset; we're adding lighting. **Tripwire:** prompt still says "background, ground, bloom" but resets lighting too — confusing for users; especially confusing because **the reset now changes the visible scene lighting**, which is much more noticeable than e.g. resetting the bloom strength.
   **Mitigation:** update the prompt string in the resource file. Single-word change; verify the German variant gets the same treatment.

8. **R8 — Registry I/O ordering on startup.** If `InitializeLightingFromRegistry` runs before the engine is fully constructed, `SetLight` calls may fault. **Tripwire:** crash on first launch after upgrade.
   **Mitigation:** call `InitializeLightingFromRegistry` after `info->engine = new Engine(...)` and before the message loop starts, in the same scope where `ReadBloomEnabled` runs ([main.cpp:4943-4960](src/main.cpp:4943)). Bloom's working ordering is the template — clone it exactly.

9. **R9 — Force-align math mismatch with map-editor semantics.** I'm inferring that "Force Fill Light Alignment" means `Fill1.Z = Sun.Z + 120°, Fill2.Z = Sun.Z + 210°, Fill.Tilt = -10°`. The screenshot is consistent with that interpretation but I haven't confirmed against Petroglyph's source. **Tripwire:** the panel "feels off" because aligned fills don't move with the sun in the same way the map editor does.
   **Mitigation:** the math is in `ComputeAlignedFill` — a single 3-line function. If observed map-editor behavior differs (e.g. tilt also tracks sun's tilt by some formula), it's a one-place fix. Worth manually opening the Petroglyph map editor side-by-side during implementation testing and verifying the Sun-Z-changes-fill-Z behavior empirically before merging.

10. **R10 — Color values eyeballed from the screenshot won't match the map editor's exact defaults.** The default-table RGBs in this plan are approximations. **Tripwire:** user opens the particle editor and the lighting "almost but not quite" matches what they're seeing in the map editor.
    **Mitigation:** during implementation, sample the screenshot with a pixel picker to refine the colors, OR (better) inspect the Petroglyph map editor's binary / configuration file for the actual stored Alamo defaults. The RGB table is a single block in `main.cpp` — refining it is trivial. Acceptable to ship with eyeballed values and refine in a follow-up if the binary inspection is more work than expected.

---

## Testing & verification

Manual checklist. Each item names *what regression it catches*. Debug instrumentation: prefix `[Lighting]` — `grep '\[Lighting\]'` in stderr captures all events.

### A. Menu, dialog open/close, position memory

| # | Check | Catches |
|---|---|---|
| A1 | View menu shows "Lighting…" between "Bloom…" and the separator. Click it. Dialog opens centered on the main window (first run). | Menu entry missing / handler unwired |
| A2 | Move dialog to (100, 100). Click X. Reopen via menu. Dialog opens at (100, 100). | Position memory broken |
| A3 | Press Esc with focus inside the dialog. Closes same as X. Reopen — position preserved. | Esc handler missing |
| A4 | Close main editor with dialog open at (X, Y). Restart. Open dialog via menu. Opens at (X, Y). | Position not flushed |
| A5 | Manually set `LightingDialogPos` registry to (99999, 99999). Restart. Open dialog. Snaps to center-on-owner default. | R6 — off-screen recovery |
| A6 | Build Release. All `[Lighting]` debug lines absent from stderr. | Debug instrumentation leaked |

### B. Sun controls

| # | Check | Catches |
|---|---|---|
| B1 | Fresh install. Open dialog. Sun shows intensity 0.50, Z 0.00, Tilt 45.00, Ambient ≈ dark grey, Specular ≈ light grey, Diffuse ≈ light grey-blue, Shadow ≈ medium grey, Force-align CHECKED. | Default seeding wrong |
| B2 | Set Sun intensity to 1.0. Particle visibly brighter. Set to 0.0 — only ambient lights it. | Intensity multiplier broken |
| B3 | Set Sun Z to 90°. Viewport lighting rotates by 90° in the horizontal plane. | Direction Z/azimuth conversion wrong |
| B4 | Set Sun Tilt to 90° (zenith). Sun overhead — top of particle lit, sides dimmer. | R2 — wrong axis convention; revisit DirectionFromZTilt |
| B5 | Set Sun Tilt to -90° (nadir). Sun below — particle dark except ambient. | Tilt clamp + sign |
| B6 | Open Sun Diffuse Color picker; pick red. Particle's lit side goes red-tinted. | Diffuse color → Light.Diffuse conversion |
| B7 | Open Sun Specular Color picker; pick green. *Shader-dependent*: on shaders that use specular, highlights tint green. On shaders without specular (the majority), no visible change. | Specular color → Light.Specular conversion; documents the "many shaders don't use specular" expectation |
| B8 | Open Sun Ambient Color picker; pick warm orange. Whole scene gets a warm wash even on the unlit side of particles. | Ambient color → m_ambient |
| B9 | Open Sun Shadow Color picker; pick bright pink. **No visible change** in viewport. Tooltip on the picker explains this. | R3 — shadow color is store-only |

### C. Fill light controls

| # | Check | Catches |
|---|---|---|
| C1 | With Force Fill Light Alignment ON (default), Fill1 Z/Tilt spinners are visibly disabled and grayed. Mirror Sun button is disabled. | Force-align disable wiring missing |
| C2 | Uncheck Force-align. Fill1 Z/Tilt spinners become editable, showing 120.0 / -10.0. Mirror Sun button enables. | Force-align state transition (ON→OFF) wrong |
| C3 | With Force-align OFF, set Fill1 Z to 270°. Fill1's contribution rotates. | Fill direction wiring independent of Force-align gate |
| C4 | Re-check Force-align. Fill1 Z spinner becomes grayed and shows 120.0 again (recomputed from Sun Z=0°). | Force-align state transition (OFF→ON) wrong |
| C5 | With Force-align OFF + Fill1 Z at 270°, uncheck Force-align again. Spinner shows 270° (the *user's last manual value*, restored from registry). | R4 — registry truth for Fill1 Z lost across cycle |
| C6 | With Force-align ON, set Sun Z to 90°. Viewport: both fills rotate in lock-step (Fill1 visually at Z=210, Fill2 at Z=300). | Force-align live-recompute wiring broken |
| C7 | Set Fill1 Intensity to 0.0. Fill1 contribution disappears. Set back to 0.5. Returns. | Per-fill intensity wiring |
| C8 | Set Fill1 Diffuse Color to bright magenta. Fill1's contribution tints magenta. | Per-fill diffuse wiring |
| C9 | Confirm Fill1 has no specular control. Confirm Fill1's contribution shows no specular highlight regardless of shader. | Spec scope creep — fills should never have specular |
| C10 | Click Mirror Sun (with Force-align OFF). Both Fill diffuse pickers update to the Sun's current diffuse color. Viewport reflects. | Mirror Sun action broken |
| C11 | Try to click Mirror Sun with Force-align ON — button is disabled. Cannot click. | Mirror Sun + Force-align orthogonality |

### D. Persistence

| # | Check | Catches |
|---|---|---|
| D1 | Configure non-default values for Sun and Fill1. Close editor. Restart. Reopen Lighting. Values restored. | Registry write or startup read broken |
| D2 | With Force-align OFF, edit Fill1 Z to 250°. Re-check Force-align. Close editor. Restart. Open dialog: Force-align is ON, Fill1 Z spinner shows 250° (grayed). Uncheck → 250° still there. | R4 — registry persistence under Force-align cycle |
| D3 | Delete the entire `AloParticleEditor` registry key. Restart. All defaults loaded. Sun=0.5/0/45, Force-align ON, fills at 120/210, slate-blue. No crash. | Full-fresh-install path; R10 — defaults match the table |
| D4 | Manually delete `LightSunDiffuseColor`. Restart. Dialog opens with default Sun diffuse color (light grey-blue from the table). Editor doesn't crash. | Per-key default-on-miss fallback |

### E. Reset behaviors

| # | Check | Catches |
|---|---|---|
| E1 | Configure non-default lighting. Click in-panel Reset. Confirm Yes. All controls snap to defaults. Viewport updates immediately. Force-align goes back to ON. | Reset button doesn't refresh UI / doesn't reset force-align |
| E2 | Configure non-default lighting. Click in-panel Reset. Confirm **No**. Nothing changes. | Confirmation can be cancelled |
| E3 | Configure non-default lighting. View → Reset View Settings. Confirm. Lighting (with bloom/ground/background) resets. Open Lighting dialog refreshes. | R7 — Reset View Settings doesn't hit lighting; WM_USER reseed broken |
| E4 | Close Lighting dialog. View → Reset View Settings. Confirm. Reopen Lighting dialog. Defaults shown. | Registry actually wiped, not just in-memory |
| E5 | Reset View Settings prompt text mentions lighting (alongside background, ground, bloom). | R7 — prompt drift |

### F. Engine integration

| # | Check | Catches |
|---|---|---|
| F1 | Inspect `m_lights[0]` after startup: Diffuse ≈ (0.353, 0.353, 0.373, 1.0) (180×0.5/255 etc.), Specular ≈ (0.373, 0.373, 0.392, 1.0), Position normalized from (cos45·cos0, cos45·sin0, sin45) = (0.707, 0, 0.707). | Defaults wiring + conversion math |
| F2 | Inspect `m_ambient` after startup: ≈ (0.157, 0.157, 0.196, 0). w=0 preserves the convention. | Ambient conversion |
| F3 | Inspect `m_shadow` after startup: ≈ (0.392, 0.392, 0.431, 0). | R3 — m_shadow is stored even though unbound |
| F4 | With Force-align ON and Sun Z=0°, inspect `m_lights[1].Position` (Fill1): normalized from (cos(-10)·cos(120), cos(-10)·sin(120), sin(-10)). | Force-align computation wired into engine push |
| F5 | Change Sun Z to 45°. Inspect `m_lights[1]`: Position now reflects (Fill1.Z = 165°, Tilt -10°). | Force-align live recompute wires to engine |

### G. Edge cases

| # | Check | Catches |
|---|---|---|
| G1 | Z Angle wrap: set Sun Z to 359°, increment → either 360° (with engine modulo 360) or 0°. Document the behavior. | Wrap convention undefined |
| G2 | Tilt clamp: set Sun Tilt to 91° — clamps to 90°. -91° — clamps to -90°. | Clamp missing |
| G3 | Intensity clamp: -0.5 → 0.0. 5.0 → ? (decide a max — recommend 3.0 like the original plan). | Range enforcement |
| G4 | Open Lighting dialog. Open Emitter properties simultaneously. Both work; no interference. | Modeless dialog independence |
| G5 | Open Lighting dialog. Switch mods. Lighting values are session-global — they don't change. | Lighting incorrectly scoped to mod |
| G6 | Open Lighting dialog. Open a different `.alo`. Lighting unchanged. | Lighting incorrectly scoped to particle file |
| G7 | Open Lighting dialog. Open Bloom dialog. Adjust both. Each works; no WM_USER cross-talk. | R9-equivalent — bloom/lighting WM_USER collision |

### H. Localization parity

| # | Check | Catches |
|---|---|---|
| H1 | Compile both `.en.rc` and `.de.rc`. Both succeed. | German variant missing IDs |
| H2 | German variant has the new dialog with English placeholder strings (per project convention). | German variant skipped entirely |

### I. Cleanup

| # | Check | Catches |
|---|---|---|
| I1 | Quit editor. No leaks reported. | Dialog HWND not destroyed on app close |
| I2 | Open / close Lighting dialog 20 times. Memory stable. | Resource leak per show/hide |

---

## Resolved decisions

All open design questions are resolved. Recording the answers and reasoning so reviewers can see the trail:

1. **Layout** — emulate the Petroglyph map editor's Sun/Fill panel (reference screenshot). Single tall panel; Sun Settings group on top with Ambient/Specular/Diffuse/Shadow color pickers + Force Fill Light Alignment checkbox; Fill Light Settings group below with per-fill Intensity/Z/Tilt/Diffuse + Mirror Sun button. ~240×320 px.
2. **No per-light Enable toggles** — explicitly rejected. Setting intensity to 0 is the documented way to mute a light. Matches the map editor.
3. **Fog settings omitted** — out of scope. Engine has fog handles wired (`hFogVals`) if a follow-up wants them.
4. **Sky Dome controls omitted** — that's MT-3.
5. **Direction input** — Z Angle (azimuth 0–360°, wraps) + Tilt Angle (-90 to +90°, clamps), two spinners per light. Internal conversion to `Position` via `(cos·cos, cos·sin, sin)`.
6. **Specular handling** — Sun has independent Specular Color picker (no longer derived from Diffuse). Same Intensity multiplier as Diffuse. Fills have no specular (always zero). Most shaders ignore specular anyway, but the panel is honest about exposing it.
7. **Ambient + Shadow** — both are scene-global vec4s exposed in the Sun Settings group (matching the map editor's grouping). No intensity multiplier on either. **Shadow Color is stored-only**: `Engine::SetShadow` gets a real implementation that writes `m_shadow`, but no shader handle binds it today. Tooltip on the picker calls this out.
8. **Force Fill Light Alignment** — checkbox in Sun Settings; default ON. When ON, fill Z/Tilt spinners disable and engine receives auto-computed values: `Fill1 = (Sun.Z + 120°, -10°)`, `Fill2 = (Sun.Z + 210°, -10°)`. When OFF, fills are free-edit; registry holds the last manually-set values.
9. **Mirror Sun** — one-shot button; copies Sun's Diffuse Color to both fills' Diffuse Color pickers. Disabled when Force-align is ON (orthogonality with alignment). Does not affect intensity or angles.
10. **Persistence** — registry under `HKCU\Software\AloParticleEditor`, same shape as Bloom. 17 keys total. Persists across sessions. Reset View Settings wipes them.
11. **Defaults** — map editor defaults from the screenshot, baked in:
    - Sun: intensity 0.50, Z 0°, Tilt 45°, Ambient `RGB(40,40,50)`, Specular `RGB(190,190,200)`, Diffuse `RGB(180,180,190)`, Shadow `RGB(100,100,110)`.
    - Fills: intensity 0.50 each, Diffuse `RGB(60,80,160)`. Z/Tilt auto-computed.
    - Force-align: ON.
    - This **changes** the editor's default appearance from the current "white sun along +X, no fills" baseline. Documented as the headline visual change of the PR.
12. **UI is source of truth** — registry stores UI representation (R, G, B per color, intensity, Z, tilt, force-align bool). Conversion to engine `Light` vec4s happens at write time. No decomposition of engine state into UI.
13. **Reset semantics** — both the in-panel Reset button and View → Reset View Settings restore all values to the table above. Force-align goes back to ON.
14. **No `.alo`-file lighting** — out of scope. Lighting stays session-global per registry.
15. **No localized translations** — German variant gets the new dialog template + IDs with English placeholder strings, consistent with MT-1.
16. **Phasing** — single PR. Scope is bounded (~5–6 h estimate given the expanded control surface), clone-of-bloom path is well-trodden.
