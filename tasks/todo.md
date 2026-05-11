# Plan: NT-3 — Pause / frame-step the preview

ROADMAP entry: near-term (new), ★★☆☆☆ (2/5), 2–4 hours estimated.

## 1. Goal + scope

Let the user freeze the preview so in-flight particles can be analysed
against a still frame, and step the simulation forward by one or five
frames at a time to watch behaviour in slow motion. The motivating
use case is debugging — a burst of sparks that's "almost right" can be
inspected at any point in its arc; a curve track whose tangents go
wrong at *t≈0.3 s* can be paused on that exact tick and stepped
forwards.

**Decisive design choice: pause at the `GetTimeF()` source**, not at
the render or update loop. Every consumer of "simulation now" already
funnels through that one function ([`src/engine.cpp:37`](src/engine.cpp:37)) —
emitter spawn time, particle Update dt, the shader `hTime` uniform,
and the `SpawnerDriver::Tick` dt. Freezing time at that single site
freezes the whole simulation while `Engine::Render()` keeps drawing,
which is exactly the analysis behaviour we want. No wrapping of
`Update`, no per-frame `if (paused)` branches scattered across the
codebase.

**In scope:**

- New free functions in `engine.{h,cpp}`: `SetPreviewPaused(bool)`,
  `IsPreviewPaused()`, `StepPreviewFrames(int n)`. Implemented via
  a wall-time accumulator (`g_pauseOffset`) so pause / resume cycles
  produce *no* time-warp pop — particles see continuous simulated
  time across a 10-minute pause.
- **F8** toggles pause. **F9** steps 1 frame; **Shift+F9** steps 10
  frames. All three are function-key bindings — immune to text-entry
  collisions in Spinners and rename fields.
- Stepping is a no-op when not paused.
- **Spawner manual-fire moves from `Shift+Space` to `Ctrl+Space`.**
  Not strictly required by the pause feature, but the user wants the
  rebind ridden along with this PR: `Ctrl+<key>` is more idiomatic for
  a discrete editor action than `Shift+<key>` (which traditionally
  modifies a continuous gesture), and frees `Shift+Space` for any
  future "burst spawn" or "spawn modifier" semantics.
- View menu entries: *Pause Preview\tF8*, *Step 1 Frame\tF9*,
  *Step 10 Frames\tShift+F9* — the two step entries are greyed when
  not paused.
- Toolbar: one new check-button (pause icon, BTNS_CHECK like the
  existing Show Ground / Bloom toggles).
- Status bar pane 2 (the FPS pane) suffixes " · PAUSED" when paused
  so the state is glanceable. No new pane needed.
- No persistence — pause always starts OFF on launch.
- German .rc gets the same menu strings; accelerators are identical
  in both languages (matches existing convention).

**Out:**

- *Reverse step / scrub bar.* Genuinely useful for analysis but
  requires history buffers (particle state snapshots) we don't keep.
  Separate ROADMAP entry if anyone asks.
- *Adjustable step size in ms.* Per-frame stepping with two fixed
  granularities (1 and 5) is enough for the analysis use case. A
  "step N ms" dialog is scope creep.
- *Persist last-paused state across sessions.* User asked for no
  persistence; reset on launch.
- *Pause auto-engaging on focus loss.* Tempting (the spawner is
  session-only too) but the user might want the preview to keep
  running while they tab over to Ghidra. Out by default.

## 2. What the codebase already gives us

- **`GetTimeF()` is the single time source.** Every simulation-time
  call site routes through it — verified by `grep`:
  [`src/engine.cpp:37`](src/engine.cpp:37) (definition + Update),
  [`src/engine.cpp:466`](src/engine.cpp:466) (shader `hTime`),
  [`src/EmitterInstance.cpp:719`](src/EmitterInstance.cpp:719) (track
  cursor reload), [`src/ParticleSystemInstance.cpp:155`](src/ParticleSystemInstance.cpp:155)
  (instance ctor "now"), [`src/main.cpp:1532`](src/main.cpp:1532) (spawner
  driver dt). One edit, one freeze.
- **Toolbar check-button pattern.** The Show Ground / Bloom toggles at
  [`src/main.cpp:1632–1634`](src/main.cpp:1632) are the template — one
  bitmap cell, one TBBUTTON entry, `TB_CHECKBUTTON` to mirror the
  engine state. The accompanying menu item at
  [`src/ParticleEditor.en.rc:462,464`](src/ParticleEditor.en.rc:462) follows
  the standard `&L&etter\tAccel` form.
- **Accelerator pattern.** [`src/ParticleEditor.en.rc:366–385`](src/ParticleEditor.en.rc:366)
  for en, [`src/ParticleEditor.de.rc:44`](src/ParticleEditor.de.rc:44) for
  de. The existing F5/F6/F7 function-key cluster (reload textures /
  shaders / spawner dialog) is the template — F8/F9 join it cleanly.
- **WM_COMMAND dispatch.** `MainWndProc → ProcessCommand` at
  [`src/main.cpp:1390`](src/main.cpp:1390) is where `ID_VIEW_BLOOM_TOGGLE`
  / `ID_SPAWNER_TRIGGER` live; new IDs slot in as additional cases.
- **Spawner manual-fire rebind**: existing `Shift+Space` line at
  [`src/ParticleEditor.en.rc:380`](src/ParticleEditor.en.rc:380) (and
  the de.rc twin) flips the modifier from `SHIFT` to `CONTROL`. The
  dialog button label at
  [`src/ParticleEditor.en.rc:106`](src/ParticleEditor.en.rc:106) gets
  `(Shift+Space)` → `(Ctrl+Space)`. Existing CHANGELOG mention at
  line 228 stays accurate (it documents the shipped behaviour at the
  time); a new CHANGELOG entry for this PR notes the rebind.
- **Status-bar pane assembly.** Pane 2 (FPS) is rebuilt every frame at
  [`src/main.cpp:1552`](src/main.cpp:1552) via `LoadString(IDS_STATUS_FPS, …)`.
  Easiest hook: append " · PAUSED" in the call site when paused. No
  resource-string change needed.
- **Toolbar bitmap extension.** The existing pattern is documented in
  `tasks/extend_toolbar1_bmp.ps1` and `tasks/extend_toolbar1_bmp_bloom.ps1`
  (referenced at [`src/main.cpp:1615`](src/main.cpp:1615)). The pause icon
  becomes cell 8, the toolbar bitmap grows by 16 px.

## 3. Architecture / implementation approach

### 3.1 The clock-offset model

`GetTimeF()` becomes:

```cpp
TimeF GetTimeF()
{
    static auto start = GetTickCount();
    TimeF wall = (GetTickCount() - start) / 1000.0f;
    if (g_paused) return g_pauseAnchor;
    return wall - g_pauseOffset;
}
```

State is three statics in `engine.cpp`:

- `g_paused` — bool, false at startup.
- `g_pauseAnchor` — `TimeF`, the simulation time at which we paused.
  While paused, `GetTimeF()` returns this verbatim; frame-step bumps
  it forward.
- `g_pauseOffset` — `TimeF`, cumulative seconds the clock has been
  frozen. On resume, we add `(wall_at_resume - wall_at_pause)` so
  post-resume wall time minus offset == anchor. Result: continuous
  simulation time across pause boundaries.

The three new free functions:

```cpp
// engine.h — public alongside GetTimeF
void  SetPreviewPaused(bool paused);
bool  IsPreviewPaused();
void  StepPreviewFrames(int frames);   // no-op if not paused
```

Implementation (engine.cpp):

```cpp
void SetPreviewPaused(bool paused)
{
    if (paused == g_paused) return;
    TimeF wall = WallTime();   // shared helper
    if (paused) {
        g_pauseAnchor = wall - g_pauseOffset;
    } else {
        g_pauseOffset += wall - (g_pauseAnchor + g_pauseOffset);
        // ↑ simplified algebra: pauseOffset += wall_now - wall_at_pause
    }
    g_paused = paused;
}

bool IsPreviewPaused() { return g_paused; }

void StepPreviewFrames(int frames)
{
    if (!g_paused || frames <= 0) return;
    g_pauseAnchor += frames / 60.0f;
}
```

The 1/60 s step is a fixed virtual frame; the actual measured FPS
varies but we want deterministic step granularity so a "1 frame" step
behaves the same regardless of the GPU's mood. `60.0f` matches the
typical present rate.

### 3.2 Dt-on-resume edge

`SpawnerDriver::Tick` computes `dt = now - lastFrameTime` with a
static `lastFrameTime` in [`src/main.cpp:1527`](src/main.cpp:1527).
With the clock-offset model, `now` is continuous across pause, so
`dt` after resume is the *single* frame interval — no synthetic burst
of catch-up updates. Verified by walking the algebra in §3.1.

### 3.3 UI plumbing

**Resource header (`resource.en.h` / `resource.de.h` / shared block):**

```
#define ID_VIEW_PAUSE_PREVIEW       40114
#define ID_VIEW_STEP_1_FRAME        40115
#define ID_VIEW_STEP_10_FRAMES      40116
```

**Accelerator table** (`ParticleEditor.en.rc` + `.de.rc`):

```
VK_SPACE, ID_SPAWNER_TRIGGER,    VIRTKEY, CONTROL, NOINVERT   ; was SHIFT
VK_F8,    ID_VIEW_PAUSE_PREVIEW, VIRTKEY,          NOINVERT
VK_F9,    ID_VIEW_STEP_1_FRAME,  VIRTKEY,          NOINVERT
VK_F9,    ID_VIEW_STEP_10_FRAMES,VIRTKEY, SHIFT,   NOINVERT
```

**Menu** under `&View`, between *Debug Heat* and *Bloom*:

```
MENUITEM "&Pause Preview\tF8",         ID_VIEW_PAUSE_PREVIEW
MENUITEM "Step &1 Frame\tF9",          ID_VIEW_STEP_1_FRAME
MENUITEM "Step 1&0 Frames\tShift+F9",  ID_VIEW_STEP_10_FRAMES
MENUITEM SEPARATOR
```

**Menu state** — refresh in `WM_INITMENUPOPUP` (or before
displaying): check `ID_VIEW_PAUSE_PREVIEW` when paused, grey the two
step items when not paused.

**Toolbar** — extend `IDR_TOOLBAR1` by one 16×16 cell (cell index 8).
Use a stock-looking pause glyph (two vertical bars). New TBBUTTON
entry at [`src/main.cpp:1635`](src/main.cpp:1635), button count bumps
from 11 → 12.

**WM_COMMAND handler** — three new cases adjacent to
`ID_VIEW_BLOOM_TOGGLE` at [`src/main.cpp:1388`](src/main.cpp:1388):

```cpp
case ID_VIEW_PAUSE_PREVIEW:
{
    bool newState = !IsPreviewPaused();
    SetPreviewPaused(newState);
    SendMessage(info->hToolbar, TB_CHECKBUTTON, ID_VIEW_PAUSE_PREVIEW,
                MAKELONG(newState ? TRUE : FALSE, 0));
    break;
}
case ID_VIEW_STEP_1_FRAME:   StepPreviewFrames(1);  break;
case ID_VIEW_STEP_10_FRAMES: StepPreviewFrames(10); break;
```

**Status-bar suffix** — modify [`src/main.cpp:1552`](src/main.cpp:1552) to
append " · PAUSED" when `IsPreviewPaused()`. One line.

**Spawner dialog button label** — replace `(Shift+Space)` with
`(Ctrl+Space)` in both `.rc` files.

## 4. Risks named up front + mitigations

1. **`hTime` shader uniform freezing might look wrong on
   distortion-shader effects.** Some particles drive a per-frame UV
   scroll off `hTime`; freezing it could expose a banding artifact
   that's normally hidden by motion. This is *correct* behaviour for
   an analysis tool — the user wants to see the frozen state — but
   worth confirming the freeze doesn't crash or NaN any shader.
   **Mitigation:** during testing, load a particle that uses the
   distortion shader and pause it; visually confirm the frozen frame
   renders without artifacts.

2. **10-frame step is one big dt, not ten small ones.** Particle
   integration sees a single ~167 ms tick instead of ten ~16 ms ticks.
   For stiff integrations (springs, fast tracks) that's a different
   trajectory. **Mitigation:** the underlying engine uses simple
   forward-Euler / track-cursor stepping that's roughly linear in dt
   over short intervals. If a user reports surprises, change
   `StepPreviewFrames(10)` to loop `Update` ten times internally —
   that's a follow-up if needed, not a v1 concern. *Risk explicitly
   accepted with a clear remediation path.*

3. **Toolbar bitmap extension is fiddly.** Past extensions (Show
   Ground, Bloom) required PowerShell scripts to append a 16-px cell
   without corrupting the BMP header. **Mitigation:** reuse the
   `tasks/extend_toolbar1_bmp.ps1` pattern; produce one new cell
   (pause = two vertical bars on the standard background colour
   `RGB(0,128,128)` so `ImageList_AddMasked` punches it transparent).

4. **Function-key collision with existing bindings.** F5 / F6 / F7
   are already taken (reload textures / shaders / spawner dialog).
   F8 / F9 are unbound — confirmed by `grep` over the en.rc and de.rc
   accelerator tables. **Mitigation:** none required; just stay
   aware that future function-key additions need to skip F8/F9.

5. **`Ctrl+Space` collides with IME / control reserved bindings on
   non-US keyboards.** On some IMEs (Chinese, Japanese, Korean),
   Ctrl+Space toggles input mode. **Mitigation:** the spawner trigger
   is a power-user feature; if a user's IME swallows the chord, the
   "Spawn now" button still works. Document the new chord in the
   CHANGELOG. *Risk explicitly accepted.*

## 5. Testing & verification

Manual checklist organised by category. Engine has no test suite; each
line is a visual / behavioural claim verified by hand.

**Happy paths**

- [ ] Launch editor, load a steady-emit particle (fire / smoke).
      Press F8 → particles freeze on screen, FPS pane shows
      " · PAUSED".
- [ ] Press F8 again → particles resume from the frozen state
      with no visible time-warp jump (no synthetic burst, no
      missing frames).
- [ ] Click View → Pause Preview → confirms parity with F8.
- [ ] Click toolbar pause button → toggle stays in sync with menu /
      keyboard state.
- [ ] F9 steps 1 frame: pause, press `F9` → particles advance
      one small step, then freeze again. Repeated presses produce
      smooth slow-motion.
- [ ] Shift+F9 steps 10 frames: pause, press `Shift+F9` → ~167 ms of
      simulation elapses then freezes. Ten `F9` presses ≈ one
      `Shift+F9` press visually.
- [ ] Step buttons are greyed (menu disabled state) when not paused.

**Spawner interaction**

- [ ] Open Spawner dialog (F7), set Manual mode. Pause the preview.
      Press Ctrl+Space → manual burst still fires onto the frozen
      scene (instances appear at their spawn pose with zero
      progression). Unpause → instances animate from their frozen
      spawn pose forward.
- [ ] Auto mode + paused: auto bursts stall (no new instances appear
      during the pause).
- [ ] Spawner dialog button label reads "Spawn now (Ctrl+Space)".
- [ ] Old `Shift+Space` chord no longer fires a manual burst (the
      shortcut has actually moved, not been duplicated).

**No-pop verification**

- [ ] Load a particle with a long track (e.g. lifetime > 5 s).
      Pause at t=1 s, wait 10 wall seconds, unpause. Confirm the
      particle continues from where it was, *not* from t=11 s
      (no pop). Confirm by reading the track cursor visually
      (alpha / color / size matches pre-pause).
- [ ] Pause, step 10 frames, unpause. Confirm the stepped frames
      persist after resume (track cursor is in the stepped-forward
      state, not snapped back).

**Edge cases**

- [ ] F8 / F9 / Shift+F9 inside the emitter-rename edit (F2): the
      function keys still fire the accelerator (function keys never
      collide with text entry, so this is the expected behaviour —
      verify nothing surprising happens).
- [ ] F8 with focus on a Spinner: pauses correctly; the Spinner's
      WM_CHAR / digit input is untouched.
- [ ] Pause across an .alo file open: pause state is reset to OFF
      by `Clear()` / system reload semantics. (Decision: keep the
      pause state intact across file open, since the user is
      analysing — they likely want consecutive files to obey the
      same pause toggle. Document either way.)
- [ ] Pause state resets to OFF on app relaunch (no persistence).
- [ ] Bloom enabled + paused: the frozen frame renders bloom
      correctly (no shader NaN from the frozen `hTime`).
- [ ] Distortion shader enabled + paused: frozen frame renders
      without artifacts.

**Cleanup / regressions**

- [ ] Resize the render window while paused → window resizes,
      simulation stays frozen.
- [ ] Ctrl+G (Show Ground), Ctrl+B (Bloom) still work while paused.
- [ ] Camera drag (Right-click + mouse) still works while paused
      — purely a view operation.
- [ ] Shift-click to spawn an instance: still works while paused
      (matches the spawner manual-fire behaviour above).

**Localisation**

- [ ] German build: View menu shows the pause/step items (English
      strings are fine for v1; matches the existing pattern where
      `.de.rc` has been only partially localised).

---

## Review

Shipped as NT-3 in ~2 hours, on the lower end of the estimate. The
single-time-source freeze worked exactly as the plan called it — one
small block of state next to `GetTimeF()` in [`src/engine.cpp`](src/engine.cpp:37)
covers emitter spawn, particle Update, shader `hTime`, and the
spawner driver dt without any other call-site changes.

**Two bugs caught and fixed pre-merge.**

1. *Initial clock-offset model lost frame-stepping on resume* —
   accumulating `g_pauseOffset += (wall_at_resume - wall_at_pause)`
   ignored anchor bumps from `StepPreviewFrames` during the pause.
   Fixed by re-deriving `g_pauseOffset = wall - anchor` at resume,
   reading the *current* anchor. Caught by walking the algebra
   after writing the first draft.

2. *First cut of step-10 left a visible gap in the trail of
   spawner-driven moving instances* — calling
   `StepPreviewFrames(10)` once advances the simulation clock by
   167 ms in a single tick, which moves the projectile by
   `velocity × 0.167 s` in one shot and gives the smoke emitter
   only one spawn opportunity at the post-jump location. Caught by
   user testing against `p_projectile_magma01.ALO`. Fixed by
   replacing the one-shot call with a `DoStepFrames(info, N)`
   helper in [`src/main.cpp`](src/main.cpp) that loops N times
   calling `StepPreviewFrames(1)` + `spawner->Tick(1/60)` +
   `engine->Update()`. The plan had flagged this exact risk in
   §4 #2 and named the same remediation; the lesson recorded for
   next time is "if the plan says a risk is accepted with a
   clear remediation path, prefer to land the remediation up front
   unless it has a real complexity cost." A 12-line loop wasn't a
   real cost.

**Two design tweaks during implementation.**

- *Shift+F9 → F10 for the 10-frame step*, with toolbar buttons
  added for both step actions next to the pause cell. User-driven
  changes mid-implementation; both were small and slotted in
  cleanly. The F10 binding overrides Win32's default
  menu-activation behaviour, mirrored in CHANGELOG; menu remains
  reachable via `Alt+<letter>` mnemonics so no UX regression.
- *Spawner manual-fire moved from `Shift+Space` to `Ctrl+Space`*
  alongside the pause work — same PR, same user-driven request.
  Frees `Shift+Space` for any future "modify gesture" semantics
  and uses the more idiomatic Win32 `Ctrl` for "trigger discrete
  action."

**What didn't slip.** The plan's §4 risk list named the trail-gap
risk explicitly; the bug it described materialized exactly as
predicted on real content. Pre-merge plans pay off when the risks
they name show up in testing — score one for the structured-plan
discipline in CLAUDE.md.
