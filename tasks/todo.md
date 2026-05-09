# Plan: Persist view settings across sessions

## Goal

Three view-state values currently reset to defaults on every launch:

- **Background color** (`Engine::m_background`, default `RGB(0x14,0x08,0x34)`)
- **Ground plane visibility** (`Engine::m_showGround`, default `true`)
- **ChooseColor custom-colors palette** — the 16 user-defined slots in
  the system color picker dialog
  ([`src/UI/ColorButton.cpp:78`](src/UI/ColorButton.cpp:78), currently
  a function-local `static COLORREF CustomColors[16] = {0}` reset on
  every launch).

Persist all three to the existing `HKCU\Software\AloParticleEditor\`
registry key so they round-trip across sessions. Plus a **View → Reset
View Settings** menu item that clears all three back to defaults.

---

## Existing pattern to mirror

The codebase already persists `LastMod`, `ModNicknames`, and
`GameDataPath` under that same key. The convention
([`src/main.cpp:1889-1918`](src/main.cpp:1889)) is:

- One `Read*()` + one `Write*()` static helper per setting.
- **Write on every change**, not on app exit. Avoids exit-path bugs.
- `RegOpenKeyEx` on read; `RegCreateKeyEx(REG_OPTION_NON_VOLATILE)` on
  write.
- No central settings struct — each setting is open-coded at its use
  site.

---

## Steps

### 1. New helpers in `src/main.cpp`

```cpp
static COLORREF ReadBackgroundColor(COLORREF defaultValue);
static void     WriteBackgroundColor(COLORREF color);
static bool     ReadShowGround(bool defaultValue);
static void     WriteShowGround(bool show);
```

Storage choice: `REG_DWORD` for both. `COLORREF` is already a 32-bit
packed value (`0x00BBGGRR`); a bool is one bit. REG_DWORD reads/writes
cleanly with `RegSetValueEx(..., REG_DWORD, (BYTE*)&v, sizeof(DWORD))`.

Value names under `HKCU\Software\AloParticleEditor`:
- `BackgroundColor` — REG_DWORD
- `ShowGround` — REG_DWORD (0 / 1)

The Read helpers take a `defaultValue` so callers can pass the
engine's existing defaults — keeps the "no registry value" path
behavior-identical to today.

### 2. Wire reads on engine init

[`src/main.cpp:2376`](src/main.cpp:2376) creates the engine. Right
after construction, override the engine's defaults from registry:

```cpp
info->engine = new Engine(...);
info->engine->SetBackground(ReadBackgroundColor(info->engine->GetBackground()));
info->engine->SetGround(    ReadShowGround   (info->engine->GetGround()));
ColorButton_SetColor(info->hBackgroundBtn, info->engine->GetBackground());
```

Toolbar / menu checkmarks for ground need the same `TB_CHECKBUTTON` /
`CheckMenuItem` updates the toggle handler does — easiest is to lift
that two-line block into a tiny helper called from both sites.

### 3. Wire writes on user change

- **Background color** — [`src/main.cpp:1381`](src/main.cpp:1381),
  inside the `CBN_CHANGE` branch where `SetBackground` already runs:
  ```cpp
  info->engine->SetBackground(ColorButton_GetColor(hControl));
  WriteBackgroundColor(info->engine->GetBackground());
  RedrawWindow(...);
  ```
- **Ground toggle** — [`src/main.cpp:945`](src/main.cpp:945), inside
  the `ID_VIEW_SHOWGROUND` handler:
  ```cpp
  info->engine->SetGround(!info->engine->GetGround());
  WriteShowGround(info->engine->GetGround());
  SendMessage(info->hToolbar, TB_CHECKBUTTON, ...);
  ```

### 4. Test plan

- Fresh registry (delete `Software\AloParticleEditor\BackgroundColor`
  and `\ShowGround`): editor uses today's defaults.
- Change background → relaunch → color persists.
- Toggle ground → relaunch → toggle state persists.
- Garbage value (manually `reg add` a string into `BackgroundColor`):
  `RegQueryValueEx` returns wrong type, helper returns default, no
  crash.

### 5. CHANGELOG

Single entry under the new reverse-chronological format. No ROADMAP
update needed — this isn't currently on the roadmap; it's a small
self-contained polish item.

---

## Suggestions worth considering

Flagging these but **not** including them in the v1 unless you say
otherwise:

1. **Persist the heat-debug toggle too** (`Engine::m_showHeatDebug`,
   `ID_VIEW_DEBUGHEAT` / `Ctrl+H`). It's right next to
   `ID_VIEW_SHOWGROUND` in the same handler block and follows the
   same pattern. Trivial to fold in; if it's also session-state that
   should stick, easy add. *Recommendation: yes, fold in — same code
   shape, almost-zero extra work, consistent UX.*

2. **Persist the ChooseColor "custom colors" array.** When the user
   opens the color picker, Windows shows 16 user-customizable color
   slots that reset every launch. The picker accepts a `COLORREF[16]`
   to seed those slots. Worth persisting if you find yourself
   re-picking the same custom colors often. *Recommendation: skip
   v1; add only if asked.*

3. **"Reset View Settings" menu item.** Tucked under View, it would
   delete the persisted values so the editor falls back to defaults.
   Useful when someone changes the bg color to something illegible
   and wants to revert. *Recommendation: skip v1; only add if a user
   actually hits this.*

4. **Camera position + zoom**, viewport size, recently-opened-files
   list — all things that could plausibly persist across sessions.
   Each is a separate scope decision; not what you asked for. *Skip
   for now.*

5. **Should background color be per-`.alo` instead of global?** Some
   particles look right against black, some against a light scene.
   Per-file persistence would mean storing the color in the `.alo`
   file format itself — a much larger change (file format compat).
   *Skip; you asked for global session state, which matches what
   most editors do.*

---

## Recommendation

Ship v1 = exactly what you asked (background color + ground toggle),
plus suggestion (1) — heat-debug toggle — folded in, since it costs
near-zero and groups naturally. Skip the rest unless you want them.

Awaiting confirmation before starting step 1.
