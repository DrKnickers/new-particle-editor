# Plan: Programmable particle spawner for the preview

ROADMAP entry: long-term, ★★★★★ (5/5), 15-25 hours estimated.

## Goal

Replace the "hold Shift, click in viewport, spawn one instance" preview
flow with a **configurable test driver** that emits instances over time:

- Adjustable spawn rate (steady, pulsed, one-shot).
- Initial velocity vector inherited by each spawn.
- Motion path for the spawn point (stationary, line, arc, user-drawn curve).
- Optional jitter / randomization on each axis.

This dramatically tightens the iteration loop for any particle whose look
depends on motion: rocket trails, debris, projectile impacts.

Per the roadmap, **session state, not saved into `.alo`**. The config
should also persist across launches via the registry pattern we just
established (`BackgroundColor` / `ShowGround` / `CustomColors`) — same
ergonomic argument.

---

## What the codebase already gives us

From the architecture survey:

- **`Engine::SpawnParticleSystem(const ParticleSystem& sys, Object3D* parent)`**
  ([`engine.cpp:43-48`](src/engine.cpp:43)) — already does exactly the
  thing the spawner needs to call repeatedly. Returns
  `ParticleSystemInstance*`.
- **Instance follows its `Object3D` parent** until `Detach()` is called
  — at which point it lives until particles die naturally
  ([`engine.cpp:171-173`](src/engine.cpp:171)).
- **Position + velocity are inherited from the parent at spawn time**
  ([`ParticleSystemInstance.cpp:115-128`](src/ParticleSystemInstance.cpp:115)).
  So if we set parent.position + parent.velocity, then `SpawnParticleSystem`,
  then `Detach`, we get a "fire and forget" emission stamped with the
  current path-point and inherited velocity.
- **Per-frame update hook**: [`Render(info)`](src/main.cpp:1003) calls
  `info->engine->Update()` before `Render()`. We tick the spawner right
  before that.
- **Cursor-to-3D unprojection** already exists at
  [`main.cpp:1554-1567`](src/main.cpp:1554) — useful later for the
  "draw the path with the mouse" feature.
- **View state vs. particle data are cleanly separated** — the spawner
  config rides on `APPLICATION_INFO`, never touches `ParticleSystem`.

---

## Scope: cut into v1 + v2

The roadmap spec is ambitious. Trying to land it all in one PR is a
recipe for a stalled long-running branch. I'll split:

### v1 (this PR; ~10–13 hours total — redesigned mid-flight)

The first build shipped with a single STEADY mode. Replaced before
merge with a richer two-mode model:

- **Modes**: **Manual** ("Spawn on command", on-demand single burst)
  and **Auto** ("Spawn at regular intervals", continuous). Radio-
  selected.
- **Burst structure** (both modes): a *burst* fires `(b)` instances
  spaced `(c)` seconds apart. Auto repeats with `(d)` seconds between
  bursts.
  - Burst size **(b)**: 1–10 instances; spinner. Capped at 10 to keep
    a single burst small relative to the 50-instance live cap (a
    maxed burst still leaves headroom for in-flight instances from
    earlier bursts).
  - Spacing within burst **(c)**: 0.0–10.0 s; spinner. `c=0` means
    all instances spawn the same frame (subject to per-frame cap).
  - Interval between bursts **(d)**: 0.0–60.0 s; spinner; greyed in
    Manual mode.
- **Pulses/sec readout (a)**: read-only label in Auto mode showing
  the derived rate `1 / (b·c + d)`. Greyed/blank in Manual.
- **Manual mode trigger**: a "Spawn now" button in the dialog plus a
  global `Shift+Space` hotkey so you can fire without focusing the
  dialog. Manual has no "Enable" checkbox — fires only on demand.
  `Shift+Space` doesn't collide with the existing
  hold-Shift-in-viewport spawn mechanic (that runs in `WM_KEYDOWN`,
  not the accelerator table).
- **Skip rule**: if a burst takes longer than `(d)` (so the next
  one would start before this one finishes), the next burst delays
  until the current one completes. No overlap. Cleaner mental model;
  could become a "Allow overlap" checkbox in v2 if anyone needs it.
- **Path**: STATIONARY (fixed point in world space) + LINE
  (start → end, configurable duration, optional loop). Unchanged.
  - Manual mode resets path-T to 0 on each trigger (each burst is a
    fresh sweep).
  - Auto mode advances path continuously regardless of burst gaps.
- **Velocity**: 3-axis XYZ spinners. Unchanged.
- **Jitter**: 3-axis position + 3-axis velocity. Unchanged.
- **UI**: modeless **Spawner** dialog opened via `Emitters → Spawner…`
  (mnemonic Alt+M, S) or **F7**. Live-applies on every change.
- **Persistence**: REG_BINARY blob `SpawnerConfig` under the existing
  registry key. Schema bumped `'SPN1'` → `'SPN2'` so mid-flight
  upgrades just discard the old payload and start fresh — no
  migration logic.

**Naming convention** in the UI / code (avoids "pulse" overloading):

- *Burst* = group of `(b)` instances spaced `(c)` apart.
- *Spacing* = `(c)`.
- *Interval* = `(d)`, the gap between bursts in Auto mode.
- *Bursts/sec* = the derived `(a)`, shown read-only in Auto mode.

**Mode switch behavior**:

- Manual → Auto: any in-flight burst finishes; auto schedule starts
  fresh from t=0.
- Auto → Manual: any in-flight burst finishes; further auto firing
  stops; user takes over with the trigger.
- Switching mode is a config change like any other — written to the
  registry on the spot.

**Limits unchanged from the original v1 design**:

| Limit | Value | Why |
|---|---|---|
| Max active spawner-emitted instances | 50 | Bounds every downstream cost |
| Per-frame emission burst | ≤ 5 spawns | Survives stutter without storming |
| Path duration min | 0.05 s | Numerical stability |
| Jitter range | ±10000 world units | UI sanity |

The 5/frame cap applies *across* a burst when `(c)` is small enough
that multiple instances want the same frame. Surplus is dropped.

**Default config** for a fresh registry: Auto mode, `b=1`, `c=0`,
`d=0.2 s` — equivalent to the old "steady 5/sec" default, so users
who liked the old behavior get it without touching anything.

### Resource limits (v1)

Wired in at the controller / UI layer to keep framerate bounded
regardless of what the user types in:

| Limit | Value | Enforcement site |
|---|---|---|
| Max active spawner-emitted instances | **50** | `SpawnerDriver::Tick` checks `engine->ActiveSpawnerInstanceCount() >= 50` and drops the spawn if so |
| Rate spinner range | **0.1 – 100 Hz** | Rate spinner `MinValue` / `MaxValue` |
| Per-frame emission burst | **≤ 5 spawns** | Loop guard inside `Tick`; on overflow, reset `m_accumSpawn = 0` (drop surplus, don't queue) |
| Path duration floor | **0.05 seconds** | Duration spinner `MinValue` |
| Jitter spinner range | **±10000 world units** | Per-axis spinner clamp |

When the active-instance cap is hit, the status bar's spawner cell
displays `Spawner: 50/50 (limited)` so the user knows why new spawns
aren't appearing. Below the cap it shows `Spawner: N active` with the
current live count (only counting instances the spawner emitted, not
all instances in the engine).

The 50-cap means tracking which instances came from the spawner
specifically. Two clean ways to do this:

1. **Tag at spawn time** — extend `SpawnParticleSystem` (or add a sibling
   API) that flags the resulting `ParticleSystemInstance` as
   spawner-owned. The engine maintains a counter that increments on
   spawn and decrements on the existing self-destruct path.
2. **Track on the SpawnerDriver side** — driver holds a
   `std::vector<ParticleSystemInstance*>` of "currently alive
   spawner-emitted" pointers, walks it once per tick to drop ones the
   engine has destroyed (compare against engine's `m_instances` list).

Approach (1) is cleaner; approach (2) avoids touching the engine. I'll
go with (1) — the engine already has a uniform `m_instances` list, and
flipping a bool on `ParticleSystemInstance` plus a getter is a tiny
intrusion compared to the cross-list reconciliation in (2).

### v2 (deferred to a separate roadmap item; ~5–9 hours)

The original v2 plan included pulsed/one-shot modes, user-drawn
curve paths, and a draw-in-viewport interactive mode. The mode
work folded into v1 (Manual + Auto). User-curve paths and the
draw-in-viewport mode are **dropped** — too much UX complexity for
the value they add.

Remaining v2 scope:

- **ARC paths** — rotate the spawn point around an axis by a
  configurable angle over `pathDuration`. Adds an axis-vector input
  + angle spinner to the dialog when Path = Arc.
- **Velocity shorthand** — alongside XYZ, accept magnitude +
  azimuth + elevation. Useful when "I want 100 units/sec going up
  at 45°" is easier to express than the XYZ math.
- **Named presets** — save a config under a name, recall later.
  Useful when iterating between two test setups (e.g. "rocket
  trail" vs. "explosion debris"). Stored as additional REG_BINARY
  blobs `SpawnerPreset_<name>`.
- **Path visualization in the preview** — render the path as a thin
  teal line and the current spawn anchor as a marker. Deferred from
  v1 because the engine has no simple-line draw helper today;
  needs a small render-state-aware helper. Spike-required to
  estimate accurately.

I'll file these as a single roadmap entry once v1 lands.

---

## Implementation steps

### 1. SpawnerConfig + SpawnerDriver

New header `src/SpawnerDriver.h` + impl `src/SpawnerDriver.cpp`.

```cpp
struct SpawnerConfig {
    bool   enabled       = false;
    float  rateHz        = 5.0f;        // STEADY: instances/second

    enum class Path { Stationary, Line } path = Path::Stationary;
    D3DXVECTOR3 pathStart = D3DXVECTOR3(0, 0, 0);
    D3DXVECTOR3 pathEnd   = D3DXVECTOR3(0, 100, 0);   // LINE only
    float  pathDuration   = 2.0f;       // LINE only (seconds)
    bool   pathLoop       = true;       // LINE only

    D3DXVECTOR3 velocity       = D3DXVECTOR3(0, 0, 0);
    D3DXVECTOR3 jitterPosition = D3DXVECTOR3(0, 0, 0);
    D3DXVECTOR3 jitterVelocity = D3DXVECTOR3(0, 0, 0);
};

class SpawnerDriver {
public:
    SpawnerDriver();

    void SetConfig(const SpawnerConfig& cfg);  // also resets time / path-t
    const SpawnerConfig& GetConfig() const;

    // Called once per frame from main.cpp before engine->Update().
    void Tick(float dtSeconds, const ParticleSystem* sys, Engine* engine);

    // For the path-line visualization; main.cpp's render path queries.
    bool        IsActive() const;
    D3DXVECTOR3 CurrentSpawnPoint() const;

private:
    SpawnerConfig m_cfg;
    Object3D      m_anchor;       // position + velocity stamped per spawn
    float         m_pathT;        // 0..1 for LINE, ignored for STATIONARY
    float         m_accumSpawn;   // time accumulator for STEADY rate
};
```

`Tick` advances `m_pathT` by `dt / pathDuration` (wrapping when
`pathLoop`), accumulates `m_accumSpawn += dt`, and while
`m_accumSpawn >= 1/rateHz` emits one instance: stamp the anchor's
position + velocity, call `engine->SpawnParticleSystem(*sys, &m_anchor)`,
**immediately Detach** the returned instance so it doesn't follow the
moving anchor on subsequent ticks. Subtract `1/rateHz` from
`m_accumSpawn` and loop. Tiny dt's that don't trigger a spawn: nothing
happens, accumulator carries over. Spike-friendly.

Jitter: each spawn, perturb stamped position + velocity by
`uniform(-jitter, +jitter)` per axis.

### 2. Wire into the render loop

In [`main.cpp:1003-1019`](src/main.cpp:1003) (`Render`), keep a
`static SpawnerDriver* driver` on `APPLICATION_INFO`. Compute `dt`
from `GetTickCount64()` deltas (look at how the engine already does it
— likely already tracking `currentTime`). Call:

```cpp
if (info->spawner != nullptr && info->particleSystem != nullptr) {
    info->spawner->Tick(dt, info->particleSystem, info->engine);
}
info->engine->Update();
info->engine->Render();
```

Edge case: when `info->particleSystem` is replaced (file open / new),
the spawner's `m_anchor` keeps its world coords; existing live
instances are unaffected. The next spawn just uses the newly-loaded
system. **Handled automatically** by passing `info->particleSystem`
into `Tick` rather than caching it.

### 3. Emitters → Spawner… modeless dialog

Menu placement: **Emitters menu** (the existing `POPUP "E&mitters"` at
[`src/ParticleEditor.en.rc:361`](src/ParticleEditor.en.rc:361)), not
View — the spawner is a particle-testing tool, conceptually adjacent
to "New Emitter" / "Rescale Emitter" rather than to view-state
settings like background color. Slot it at the bottom of the menu,
below "Hide All Emitters", separated by `MENUITEM SEPARATOR`:

```
Emitters
├── New Emitter
│   ├── Root Emitter
│   ├── Child Emitter (Lifetime)
│   └── Child Emitter (on Death)
├── Rename Emitter        F2
├── Rescale Emitter
├── Toggle Emitter Visibility
├── ──────────────────────────
├── Show All Emitters
├── Hide All Emitters
├── ──────────────────────────  ← new separator
└── Spawner…              F7    ← new item; check-mark when visible
```

Mnemonic: `&Spawner` (Alt+M, S) — unique within the Emitters menu.
German equivalent in `de.rc`: `&Spawner…\tF7` (same mnemonic; English
loanword fits naturally and avoids inventing a translation for a
domain term).

Keyboard accelerator: **F7**. Unused, slots next to F5 (Reload
Textures) / F6 (Reload Shaders), easy one-handed reach. Both the menu
item and F7 toggle the same `ShowSpawnerDialog(info)` helper that
opens the dialog if hidden, focuses it if open, hides it if focused +
visible. Same "show or focus" pattern modal-ish dialogs typically use.

New `IDD_SPAWNER` dialog in both `.rc` files. Layout:

- **Enabled** checkbox at the top.
- **Rate group**: spinner for instances/second.
- **Path group**: dropdown (Stationary / Line). When Line: 6 spinners
  for start (X/Y/Z) and end (X/Y/Z), 1 spinner for duration, 1
  checkbox for loop. Stationary: just the 3 start spinners.
- **Velocity group**: 3 spinners.
- **Jitter group**: 6 spinners (3 position + 3 velocity).

Modeless because the user wants to tweak settings while watching the
preview update in real time.

Each control's change handler updates `info->spawner->SetConfig(...)`
+ `WriteSpawnerConfig(...)` so changes round-trip on every tweak,
matching the existing background-color pattern.

**Keyboard + menu entry points.**

- **`Emitters → Spawner…`** menu item (Alt+M, S mnemonic) — primary
  discoverable path. Check-mark next to the menu item when the
  dialog is visible.
- **F7** global accelerator — same toggle, one-keystroke. Wired in
  `IDR_ACCELERATOR1` next to F5/F6 in both `.rc` files. Unused
  today; slots naturally next to the View → Reload F5/F6 family.
- Inside the dialog: **Esc** closes; **Tab** cycles controls; the
  existing `Spinner` controls keep their scroll-wheel + Shift/Ctrl
  modifiers from PR #16.

**Closing and restoring the dialog.**

The dialog is a modeless `CreateDialog`-style child of the main
window — created **lazily on first show** rather than at startup.
Lifetime + state on `APPLICATION_INFO`:

```cpp
HWND hSpawnerDlg = NULL;   // NULL means "not created yet"
bool spawnerVisible = false;
RECT spawnerWindowRect = {0};   // last-known position+size for restore
```

The single toggle helper:

```cpp
static void ToggleSpawnerDialog(APPLICATION_INFO* info)
{
    if (info->hSpawnerDlg == NULL)
    {
        // Lazy create. Position from registry on first ever launch,
        // or from the last-known rect within this session.
        info->hSpawnerDlg = CreateDialogParam(
            info->hInstance,
            MAKEINTRESOURCE(IDD_SPAWNER),
            info->hMainWnd,        // owner; not parent — modeless on top
            SpawnerDlgProc,
            (LPARAM)info);

        if (info->spawnerWindowRect.right != 0)
        {
            // Restore prior position (this session OR from registry).
            SetWindowPos(info->hSpawnerDlg, NULL,
                         info->spawnerWindowRect.left,
                         info->spawnerWindowRect.top, 0, 0,
                         SWP_NOSIZE | SWP_NOZORDER);
        }
    }

    if (info->spawnerVisible)
    {
        // Visible → hide. Capture position first so a re-show
        // restores it. Don't destroy — preserves all field values.
        GetWindowRect(info->hSpawnerDlg, &info->spawnerWindowRect);
        ShowWindow(info->hSpawnerDlg, SW_HIDE);
        info->spawnerVisible = false;
    }
    else
    {
        ShowWindow(info->hSpawnerDlg, SW_SHOW);
        SetForegroundWindow(info->hSpawnerDlg);
        info->spawnerVisible = true;
    }

    // Sync the menu check-mark.
    CheckMenuItem(GetMenu(info->hMainWnd), ID_EMITTER_SPAWNER,
                  MF_BYCOMMAND | (info->spawnerVisible ? MF_CHECKED : MF_UNCHECKED));
}
```

Why hide rather than destroy: dialog state (which control has
focus, scroll position of any spinners, ephemeral things like an
in-progress edit in a spinner field) survives a hide/show round
trip. Destroying it on close + re-creating on open is correct but
flickers and loses transient state.

**Window-position persistence across sessions.**

Registry value `SpawnerDialogPos` (REG_BINARY, 16 bytes = packed
`RECT`). Read once on startup and stashed into
`info->spawnerWindowRect`; written whenever the dialog is hidden or
the app exits. Garbage / wrong-size payload → ignored, dialog
appears at the system default `CW_USEDEFAULT` position.

If the saved position is now off-screen (user disconnected a second
monitor), clamp it back into the primary monitor's work area before
applying — `MonitorFromRect(MONITOR_DEFAULTTONULL)` returns NULL
when the rect is fully off-screen, in which case fall back to
default position.

**Closing the dialog by other paths.**

- Clicking the dialog's window-frame X button (`WM_CLOSE` /
  `IDCANCEL`): same as the toggle helper's hide branch. Don't
  destroy.
- Main window closing (app exit): the dialog destroys with its
  owner. Final position write happens in `WM_CLOSE` of the main
  window, before the dialog gets torn down.
- File close / particle-system swap: dialog stays open and visible.
  Spawner config is independent of the loaded file.

### 4. Path visualization

New small render pass in [`engine.cpp Render`](src/engine.cpp) before
the particle pass — the existing engine doesn't have a primitive line
helper, but D3DX9 ships `D3DXLINE` (or we use `IDirect3DDevice9::DrawPrimitiveUP`
with `D3DPT_LINESTRIP` and a tiny vertex array). Pen color: a
distinct teal that contrasts with the dark default background.

The current spawn anchor (`CurrentSpawnPoint()`) renders as a tiny
3-axis cross or sphere so the user can see where the next emission
will be.

Toggle: only renders when `info->spawner->IsActive()`.

Risk: if the engine's current shader/state machinery doesn't have a
"draw simple line" path, this is more work than I'm budgeting. **First
spike of the implementation phase: confirm we can render a line
strip.** If it turns out to be a multi-hour shader-management chore,
defer the visualization to v2 and ship v1 without it (with a
README note: "spawner is active even though invisible, watch the
particles").

### 5. Registry persistence

Mirror the `BackgroundColor` / `ShowGround` pattern in
[`main.cpp`](src/main.cpp):

- `static SpawnerConfig ReadSpawnerConfig(SpawnerConfig defaults)`
- `static void WriteSpawnerConfig(const SpawnerConfig& cfg)`
- Reset View Settings (already added) gets a new "...and the spawner
  config" line in its confirmation prompt + clears `SpawnerConfig`
  from the registry.

Stored as REG_BINARY of the entire struct, with a leading 4-byte magic
number (`'SPN1'` for the v1 schema) so future schema changes can
discard incompatible payloads cleanly.

### 6. UI cleanup on file change + mod swap

When `info->particleSystem` becomes `nullptr` (file close), the
spawner's `Tick` no-ops (already handled). When it changes (open /
new), in-flight instances of the *old* system continue to live until
their particles die — that's the existing behavior for Shift-spawn
too, so no special handling needed.

### 7. Test plan

- **Steady rate**, stationary path: instances appear at a constant
  position with constant cadence; rate spinner adjusts cadence live.
- **Line path with loop**: spawn point ping-pongs along the line
  (or wraps from end to start, depending on loop semantics — match
  the user's expectation; "loop" means restart from start).
- **Velocity**: spawned particles move in the configured direction.
  Verify by dropping rate to 1/sec and watching individual instances
  drift.
- **Jitter**: rate=many/sec, jitter=large; should produce a cloud
  rather than a stream.
- **Disable**: toggle off → no new spawns; live ones die naturally.
- **Persistence**: relaunch → config restored; relaunch with garbage
  in registry → defaults used, no crash.
- **Reset View Settings**: clears spawner config too.
- **Mod swap mid-spawn**: in-flight instances unaffected; new
  instances reflect the new mod's textures (since they sample
  `m_textureManager` at render time, not spawn time).

### 8. Documentation

- CHANGELOG entry (top of changelog, new convention).
- ROADMAP: move "Programmable particle spawner for the preview" to
  the **Shipped** section with PR # and *Actual* line. **Add a new
  long-term item**: "Programmable particle spawner v2 (pulsed,
  one-shot, arc, drawn-in-viewport curves, presets)" so the cut
  scope is captured.

---

## Open questions / assumptions worth flagging

1. **Detach immediately after spawn — does it produce the right
   look?** I believe so based on how Shift-spawn ends (Shift release
   → StopSpawning → Detach), but the precise frame-by-frame behavior
   between "spawned but not yet detached" and "spawned and detached"
   needs a quick eyeball test in the spike phase.

2. **The path-line visualization may be more work than estimated.**
   If the engine's render plumbing makes simple-line drawing painful
   (no helper, shader required, state-machine flush issues), I'll
   ship v1 *without* visualization and add it in v2. Will spike this
   first.

3. **Rate during load spikes.** If the editor stutters (loading a
   texture, hot-reload), `dt` could be 200ms and the spawner would
   try to emit a burst. Cap the per-frame emission count at
   `min(rateHz * dt, 20)` to avoid storms during stutters.

4. **Coordinate space.** Path coords are world-space, matching how
   the existing `mouseCursor.SetPosition(D3DXVECTOR3)` works. The
   user enters values in world units, same as every other position
   field in the editor.

---

## Recommendation

Proceed with **v1 scope** as listed above. Spike step 4 (line
visualization) first — if it's clean, it stays in v1; if not, defer
and ship v1 without it. File v2 as a follow-up roadmap entry on
ship.

Estimated **8–10 hours** for v1 vs the roadmap's 15-25h for the full
spec. The cut roughly halves scope while still delivering the core
value: turning "click once, watch one instance" into "set up a
sustained stream and iterate on the look in motion."

Awaiting confirmation before starting.
