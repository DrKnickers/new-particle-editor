# [MT-10] Configurable exempt set per link group

**Status (2026-05-14):** ✅ implementation complete on branch `feat/mt10-configurable-exempts` (worktree `.claude/worktrees/exciting-easley-6a20e4`). Awaiting interactive verification + PR. See [§Review (end of file)](#review) for the per-milestone summary, what to test live, and known gaps.

Follows the planning conventions established for MT-9: Context block, per-artefact Architecture subsections, named tripwires per risk, verifier-first Verification where each row says *what regression it catches*. See [CLAUDE.md](../CLAUDE.md) for the repo-wide plan structure.

---

## Status of the surrounding work

- ✅ **[MT-7]** Linked emitters — shipped ([#58](https://github.com/DrKnickers/new-particle-editor/pull/58)). Group membership, propagation, hard-coded 4-field exempt set, undo/redo, file format `0x0100` chunk at emitter level.
- ✅ **[MT-8]** Tree multi-select — shipped ([#60](https://github.com/DrKnickers/new-particle-editor/pull/60)).
- ✅ **[MT-9]** Visual link-group bracket — shipped ([#63](https://github.com/DrKnickers/new-particle-editor/pull/63)).
- 🚧 **[MT-10]** Configurable exempt set per link group — **this plan**.

---

## Context

MT-7 hard-codes the exempt set to four fields: `colorTexture`, `normalTexture`, the `TRACK_INDEX` curve, and `name`. That's the right default for the user's canonical use case — atlas variants where textures and identifiers differ but motion is shared. It's the wrong default for:

- **Inverse cases** — fire_a/fire_b sharing texture *and* atlas curve, differing only in lifetime or burst rate.
- **Per-group calibration** — group X shares blendMode but group Y wants per-emitter blendMode (e.g. mixing additive and alpha-blend smoke in one effect).
- **Authored variants** — designer locks every parameter except gravity and acceleration on five "wind layer" emitters.

MT-10 makes the exempt set **user-configurable per link group**. v1's four-field set becomes the default for new groups and for files saved before this feature exists. Every emitter field that can sensibly be per-emitter becomes a toggle in a per-group settings dialog.

After MT-10 the link-group feature is complete for the original ROADMAP scope. There's a follow-on for per-emitter overrides (kept explicitly out of scope — see [§Goal+scope](#goal--scope)), but that's a separate item if the demand surfaces.

**Why now**: MT-9 closed the UI ergonomics gap (selection, visual bracket). MT-10 closes the data-model gap. Both are pure additions on top of MT-7's data layer — neither rewrites the propagation hook or the persistence chunk. Shipping them in sequence means the user's mental model of "link group" picks up the full UX and customisation surface in close succession.

---

## Goal + scope

Per-group `LinkExemptFlags` storage on `ParticleSystem`, a new editor-only system-body chunk for persistence, a per-group settings dialog reached from the right-click menu on a linked emitter, and a disagreement-resolver dialog for the case where un-exempting a field would silently overwrite divergent member values.

**In:**

- **`LinkExemptFlags` grows** from 4 bools to one bool per emitter field that can be exempt. ~42 entries: every scalar/bool/array field in `Emitter`, every curve track (except TRACK_INDEX which gets its own dedicated flag), the three random-param `groups[]` arrays. Stays POD; no virtual dispatch.
- **Per-group storage on `ParticleSystem`**: `std::map<uint32_t, LinkExemptFlags> m_linkExempts`. A group not present in the map gets the v1 default exempt set via `getLinkExemptFlags(groupId)` — backwards-compatible for files predating this feature.
- **New right-click menu item** `Group settings…` on the right-click menu when the selected emitter is in a link group. Inserted into the existing dynamic menu builder ([src/UI/EmitterList.cpp](src/UI/EmitterList.cpp) `NM_RCLICK` handler).
- **Dialog `IDD_LINK_GROUP_SETTINGS`**: SysListView32 with `LVS_REPORT | LVS_EX_CHECKBOXES`, columns "Field" + "Category", rows grouped by category (Textures / Identity / Curves / Lifetime / Physics / Appearance / Weather / Rotation / Misc). Reset-to-defaults button. OK / Cancel.
- **Sync-when-unexempting** dialog: at OK time, for every field where (a) the exempt flag was cleared AND (b) group members currently disagree, collect the disagreement into a single summary dialog with one radio group per affected field ("Which value should govern?"). Single Apply.
- **Persistence**: new editor-only system-body chunk type ID `0x0003`, sibling to the existing `0x0002` leaveParticles inside the `0x0900` system envelope. Format: count + per-group (groupId, flagsByteCount, flagsBytes). Game engine skips unknown system-level chunks (already established via `0x0002`).
- **Backwards compat both directions**: files saved by pre-MT-10 editors load with no `0x0003` chunk → every group uses v1 defaults. Files saved by MT-10 with non-default exempts load in pre-MT-10 editors as if no overrides existed (which is correct because the pre-MT-10 reader skips the unknown chunk).
- **Propagation hook update** at [src/main.cpp:802](src/main.cpp:802) (`CaptureUndo`) consults `info->particleSystem->getLinkExemptFlags(linkGroup)` instead of the static `GetLinkExemptFlags()`. Same change in `CreateLinkGroup` and `JoinLinkGroup` at [src/LinkGroup.cpp](src/LinkGroup.cpp).
- **`copySharedParamsFrom` extension**: today restores 4 exempt fields manually. MT-10 needs to restore one field per flag. Refactored to a field-table approach (or per-flag if/else, depending on which reads cleaner) so adding a flag in the future = adding one entry.
- **`DiffNonExemptParams` extension**: today consults the static exempt set. MT-10 takes a `const LinkExemptFlags&` parameter so the menu's confirm-dialog path can use the per-group flags.
- **Undo coverage**: opening the settings dialog and clicking OK fires `ELN_LISTCHANGED` → `CaptureUndo` (existing chokepoint). Because the undo system snapshots the entire `ParticleSystem`, exempt-flag changes ride the snapshot naturally — no special multi-step undo plumbing needed. Cancelling the dialog leaves no undo entry.
- **Debug instrumentation**: `[Link] exempt set group=N flags=...`, `[Link] exempt dialog: disagreements=N`, shared `[Link]` prefix with MT-7/9.

**Out:**

- **Per-emitter exempt overrides** ("link everything except *this one's* lifetime"). *Reason: separate ROADMAP entry if friction proves real. v1's per-group model covers the stated 95% case. Per-emitter overrides need a separate per-field flag layer on top of the per-group baseline; the data model can extend additively when the time comes, but designing for it now bloats v1.*
- **Saved exempt presets** ("save these toggles as a named preset, recall on a different group"). *Reason: incremental value over the dialog itself is small; the dialog already takes ~30 seconds to use. Add only if usage shows the same exempt-shape repeating across many groups.*
- **Cross-file exempt sharing.** *Reason: link group IDs are local to a particle system; their exempt sets are local too. No clean semantic for "copy exempts from system A's group 3 to system B's group 5".*
- **Bulk "set all exempt" / "set all shared" buttons.** *Reason: the Reset-to-defaults button already covers the 90% bulk-op case. Add only if testing surfaces a real workflow.*
- **Re-running propagation when an exempt is cleared but members already agree.** *Reason: nothing to propagate when values match. Tripwire: the disagreement dialog only fires when at least one disagreement exists; if all agree, OK is silent.*
- **Dialog field labels in German** (and other localizations). *Reason: matches existing convention — DiffNonExemptParams returns English strings; the German `.rc` re-uses the same field names. If a contributor wants to localize, they can add translations later without touching the data model.*
- **"name" as a configurable exempt.** *Reason: per-emitter identity is intrinsic. There's no sensible workflow where every group member shares a name. Keep mandatory-exempt; do not surface in the dialog. Same for TRACK_INDEX — actually, MT-10 *does* surface TRACK_INDEX as a configurable so atlas-variants vs. uniform-frame use cases are both supported.*
- **Toolbar button for the settings dialog.** *Reason: right-click menu is the established entry point for every group operation (Link, Dissolve, Add, Remove). Adding a toolbar button doubles the surface area for marginal discoverability gain.*

---

## What we already have

| Piece | File:line |
|---|---|
| `LinkExemptFlags` struct (current 4 bools) | [src/LinkGroup.h:33](src/LinkGroup.h:33) |
| `GetLinkExemptFlags()` static accessor | [src/LinkGroup.cpp:7](src/LinkGroup.cpp:7) |
| `Emitter::copySharedParamsFrom` (consumes exempt flags) | [src/ParticleSystem.cpp:555](src/ParticleSystem.cpp:555) |
| `DiffNonExemptParams` (consumes exempt flags; enumerates every field) | [src/LinkGroup.cpp:174](src/LinkGroup.cpp:174) |
| `CreateLinkGroup` / `JoinLinkGroup` (call sites that pass exempt flags) | [src/LinkGroup.cpp:54](src/LinkGroup.cpp:54), [src/LinkGroup.cpp:85](src/LinkGroup.cpp:85) |
| Propagation hook (consults exempt flags in `CaptureUndo`) | [src/main.cpp:802](src/main.cpp:802) |
| System-level write at chunk `0x0900` (envelope) with `0x0002` as the existing optional sibling | [src/ParticleSystem.cpp:743](src/ParticleSystem.cpp:743), [src/ParticleSystem.cpp:766](src/ParticleSystem.cpp:766) |
| System-level read at `0x0900` with `0x0002` optional-skip pattern | [src/ParticleSystem.cpp:778](src/ParticleSystem.cpp:778), [src/ParticleSystem.cpp:809](src/ParticleSystem.cpp:809) |
| Right-click menu builder (where `Group settings…` will be inserted) | [src/UI/EmitterList.cpp](src/UI/EmitterList.cpp) `NM_RCLICK` handler — see `ID_DISSOLVE_LINK_GROUP` / `ID_LEAVE_LINK_GROUP` neighbours |
| Dialog resource pattern + dialog class registration in `.rc` files | [src/ParticleEditor.en.rc](src/ParticleEditor.en.rc), [src/ParticleEditor.de.rc](src/ParticleEditor.de.rc) (search for `IDD_` entries) |
| Resource ID allocation range for new dialog | [src/Resources/resource.en.h](src/Resources/resource.en.h), [src/Resources/resource.de.h](src/Resources/resource.de.h) — MT-7 added IDs at 40119–40159 |
| Emitter field surface (every non-exempt field listed in `DiffNonExemptParams`) | [src/LinkGroup.cpp:185](src/LinkGroup.cpp:185) onward — 38 explicit `CHECK_FIELD` calls + arrays + groups + tracks |

**Not yet in the codebase — must be added:**

- `ParticleSystem::m_linkExempts` (private), `getLinkExemptFlags(groupId)`, `setLinkExemptFlags(groupId, flags)` accessors.
- `0x0003` chunk writer + reader inside `0x0900` envelope, between `0x0800` (emitter list) and `0x0002` (leaveParticles) for predictable on-disk ordering.
- `IDD_LINK_GROUP_SETTINGS` dialog resource + dialog proc.
- `IDD_LINK_GROUP_DISAGREEMENT` dialog resource + dialog proc.
- `BuildFieldDisagreement(system, groupId, fieldId)` helper for the disagreement dialog.
- `ApplyFieldValue(system, groupId, fieldId, sourceMember)` helper for the disagreement-resolution Apply.

**Unknown to confirm before coding:**

1. **Chunk ID `0x0003` is unused at system level.** Spec says `0x0000` (name), `0x0001` (unused int), `0x0002` (leaveParticles), `0x0800` (emitter envelope), `0x0900` (system envelope). `0x0003` is the natural next ID. Need to grep the game engine reader (if accessible) or empirically confirm no conflict — but the optional-skip pattern means an unknown chunk is safe even if reused. **Action**: pick `0x0003` and document; if a conflict surfaces in testing (engine refuses to load), switch to `0x0901` (above the envelope range, less likely to collide).
2. **Whether per-emitter `unknownXX` fields** (`unknown06`, `unknown11`, `unknown15`, `unknown2b`, `unknown3f`, `unknown44`, `unknown49`) should be exempt-toggleable. They're persisted to disk but no UI exposes them. **Action**: include them in the data-model flags so the on-disk representation is complete, but hide them from the dialog UI. If a future feature exposes them, no schema change needed.
3. **`emitFromMeshOffset` and `weatherFadeoutDistance` are floats but rarely-edited.** Verify these have UI representation in the inspector. **Action**: yes, every documented float has an inspector spinner — include all in the dialog with their inspector labels.

---

## Architecture

Six pieces. Each is local to one file or one resource pair. No cross-cutting refactors.

### A. Data model — `LinkExemptFlags` grows + per-group storage

`LinkExemptFlags` becomes a struct of ~42 bools, one per exempt-eligible field. Stays POD; no virtual dispatch. Default constructor sets the v1 four (`colorTexture`, `normalTexture`, `trackIndex`, `name`) to `true`, every other to `false`.

```cpp
// In LinkGroup.h:
struct LinkExemptFlags
{
    // Categories follow the dialog grouping for readability.
    // Textures + identity (default exempt):
    bool colorTexture;
    bool normalTexture;
    bool name;
    bool trackIndex;            // TRACK_INDEX curve (atlas-frame)

    // Curves (default shared except trackIndex):
    bool trackRed;
    bool trackGreen;
    bool trackBlue;
    bool trackAlpha;
    bool trackScale;
    bool trackRotationSpeed;

    // Lifetime / spawning:
    bool lifetime;
    bool initialDelay;
    bool burstDelay;
    bool nBursts;
    bool nParticlesPerBurst;
    bool nParticlesPerSecond;
    bool useBursts;

    // Physics:
    bool gravity;
    bool acceleration;
    bool inwardSpeed;
    bool inwardAcceleration;
    bool bounciness;
    bool groundBehavior;
    bool objectSpaceAcceleration;
    bool affectedByWind;

    // Appearance:
    bool blendMode;
    bool textureSize;
    bool nTriangles;
    bool randomScalePerc;
    bool randomLifetimePerc;
    bool hasTail;
    bool tailSize;
    bool noDepthTest;
    bool randomColors;

    // Weather:
    bool isWeatherParticle;
    bool weatherCubeSize;
    bool weatherCubeDistance;
    bool weatherFadeoutDistance;

    // Rotation:
    bool randomRotation;
    bool randomRotationDirection;
    bool randomRotationAverage;
    bool randomRotationVariance;

    // Misc:
    bool linkToSystem;
    bool parentLinkStrength;
    bool doColorAddGrayscale;
    bool isHeatParticle;
    bool isWorldOriented;
    bool freezeTime;
    bool skipTime;
    bool emitFromMesh;
    bool emitFromMeshOffset;
    bool groups[3];             // SPEED / LIFETIME / POSITION random-param boxes

    // Unknown fields (data-model complete, hidden in UI):
    bool unknown06, unknown11, unknown15, unknown2b, unknown3f, unknown44, unknown49;

    LinkExemptFlags();          // sets v1 defaults
};
```

`GetLinkExemptFlags()` in [src/LinkGroup.cpp:7](src/LinkGroup.cpp:7) is renamed `GetDefaultLinkExemptFlags()` and remains the single source of truth for v1 defaults.

Per-group storage on `ParticleSystem`:

```cpp
// In ParticleSystem.h (private):
std::map<uint32_t, LinkExemptFlags> m_linkExempts;

// Public accessors:
const LinkExemptFlags& getLinkExemptFlags(uint32_t groupId) const;
void                   setLinkExemptFlags(uint32_t groupId,
                                          const LinkExemptFlags& flags);
```

`getLinkExemptFlags(groupId)`: if `groupId` is in `m_linkExempts`, returns the entry; else returns the v1 defaults from `GetDefaultLinkExemptFlags()`. The reference is to long-lived storage (either the map entry or the static default), so callers can hold it across short scopes.

`setLinkExemptFlags(groupId, flags)`: if `flags == GetDefaultLinkExemptFlags()`, removes any map entry for `groupId` (keeps the on-disk representation minimal). Otherwise inserts/updates.

### B. Serialisation — new system-body chunk `0x0003`

Writer in [src/ParticleSystem.cpp:743](src/ParticleSystem.cpp:743), inserted between the existing `0x0800` (emitter envelope) and `0x0002` (leaveParticles) — keeps related editor-only chunks adjacent.

```cpp
// In ParticleSystem::write, between the 0x0800 and 0x0002 chunks:
if (!m_linkExempts.empty())
{
    writer.beginChunk(0x0003);
    writeInteger(writer, (uint32_t)m_linkExempts.size());
    for (auto& kv : m_linkExempts)
    {
        writeInteger(writer, kv.first);                       // groupId
        writeInteger(writer, (uint32_t)sizeof(LinkExemptFlags));
        writer.write(&kv.second, sizeof(LinkExemptFlags));    // raw POD blob
    }
    writer.endChunk();
}
```

The `sizeof(LinkExemptFlags)` written before each blob lets future versions add flags safely: a newer reader sees a larger blob and reads the bytes it knows, ignores the rest. An older reader (already deployed) just skips the unknown `0x0003` chunk entirely.

Reader: in the optional-skip section of [src/ParticleSystem.cpp:808](src/ParticleSystem.cpp:808), add a case for `0x0003` parallel to the existing `0x0002` handling:

```cpp
type = reader.next();
while (type != -1)
{
    if (type == 0x0002)
    {
        Verify(reader.size() == 1);
        m_leaveParticles = readBool(reader);
    }
    else if (type == 0x0003)
    {
        uint32_t count = readInteger(reader);
        for (uint32_t i = 0; i < count; ++i)
        {
            uint32_t groupId      = readInteger(reader);
            uint32_t flagsSize    = readInteger(reader);
            LinkExemptFlags flags = GetDefaultLinkExemptFlags();
            uint32_t toRead = (flagsSize <= sizeof(LinkExemptFlags))
                            ? flagsSize : (uint32_t)sizeof(LinkExemptFlags);
            reader.read(&flags, toRead);
            if (flagsSize > sizeof(LinkExemptFlags))
                reader.skip(flagsSize - sizeof(LinkExemptFlags));
            m_linkExempts[groupId] = flags;
        }
    }
    else
    {
        // Unknown future chunk — skip
        reader.skip(reader.size());
    }
    type = reader.next();
}
```

The existing read loop is a simple `if (type == 0x0002) { ... } type = reader.next(); Verify(type == -1);` pattern. MT-10 generalizes that to a small while-loop that handles both `0x0002` and `0x0003` and tolerantly skips anything else. Subtle but worth flagging in code review: the change from "verify next is -1" to "tolerantly drain optional chunks" is a forward-compat improvement that pays for every future system-body addition.

### C. `copySharedParamsFrom` extension

Today's implementation ([src/ParticleSystem.cpp:555](src/ParticleSystem.cpp:555)) hand-restores 4 exempt fields. With ~42 flags, hand-restoring each one is a 100-line if-ladder. Refactor to a field-table approach:

```cpp
// In ParticleSystem.cpp, file-scope static or method-local:
struct ExemptFieldOp
{
    // Save the field from `*this` into a generic buffer, then restore
    // it from the buffer after the bulk copy.
    bool         (LinkExemptFlags::*flag);     // pointer-to-member
    void         (*save)(const Emitter& src, void* buf);
    void         (*restore)(Emitter& dst, const void* buf);
    size_t       bufSize;
};

// Static table of all exempt-eligible fields. ~42 entries.
static const ExemptFieldOp kExemptFields[] = {
    { &LinkExemptFlags::colorTexture, SaveString, RestoreString,
      offsetof(Emitter, colorTexture) ... },
    ...
};
```

Alternative if the pointer-to-member-with-offsetof gymnastics gets ugly: a parallel `if (exempt.fieldName) restore = oldValue;` block for each field — repetitive but obvious. Pick whichever reads cleaner to a reviewer; both are tractable for ~42 entries. The current hand-restoration is the right pattern to extend; don't over-engineer.

Decide pre-coding: pointer-to-member field table vs. flat if-ladder. The if-ladder is ~84 lines of save+restore; the field table is ~42 entries plus ~8 generic save/restore helpers. The field table wins for future-extensibility; the if-ladder wins for first-read clarity. **Default: if-ladder, mirroring the existing structure**, since the field table introduces a layer of indirection that's mostly value only when the field count grows past ~50.

### D. Dialog UI — `IDD_LINK_GROUP_SETTINGS`

New resource in both `.en.rc` and `.de.rc`:

- **Size**: ~400 px × 500 px (fits ~20 visible list rows; user scrolls for the rest).
- **Title**: `"Link group N settings"` — dynamic, set at `WM_INITDIALOG` based on the group ID passed via `lParam`.
- **Controls**:
  - `IDC_LINK_EXEMPT_LIST`: `SysListView32`, `WS_BORDER | LVS_REPORT | LVS_SHOWSELALWAYS | LVS_NOSORTHEADER`. Set `LVS_EX_CHECKBOXES` via `ListView_SetExtendedListViewStyle` at `WM_INITDIALOG`.
  - Two columns: "Field" (250 px), "Category" (120 px).
  - `IDC_LINK_EXEMPT_RESET`: button labeled "Reset to defaults".
  - `IDOK` / `IDCANCEL`: standard OK / Cancel.
- **Rows**: every flag in `LinkExemptFlags` *except* the `unknownXX` fields and `name`. ~33 visible rows. Hand-grouped by category for readability:
  - Textures (2): colorTexture, normalTexture
  - Curves (6): red, green, blue, alpha, scale, rotation speed, trackIndex (special-named "Atlas index curve")
  - Lifetime / spawning (7): lifetime, initialDelay, burstDelay, nBursts, nParticlesPerBurst, nParticlesPerSecond, useBursts
  - Physics (8): gravity, acceleration, inwardSpeed, inwardAcceleration, bounciness, groundBehavior, objectSpaceAcceleration, affectedByWind
  - Appearance (9): blendMode, textureSize, nTriangles, randomScalePerc, randomLifetimePerc, hasTail, tailSize, noDepthTest, randomColors
  - Weather (4): isWeatherParticle, weatherCubeSize, weatherCubeDistance, weatherFadeoutDistance
  - Rotation (4): randomRotation, randomRotationDirection, randomRotationAverage, randomRotationVariance
  - Misc (10): linkToSystem, parentLinkStrength, doColorAddGrayscale, isHeatParticle, isWorldOriented, freezeTime, skipTime, emitFromMesh, emitFromMeshOffset, groups[SPEED]/groups[LIFETIME]/groups[POSITION]
- **Dialog proc** handles: `WM_INITDIALOG` (populate list, check current flags), `LVN_ITEMCHANGED` (update local flags struct on each toggle), `IDC_LINK_EXEMPT_RESET` (restore defaults to local struct, refresh checkboxes), `IDOK` (apply via the sync-when-unexempting flow described next), `IDCANCEL` (close, no save).

Resource IDs added to both `resource.en.h` and `resource.de.h` in the 40160–40199 range (above MT-7's 40119–40159, leaving 40190 as a marker for the next feature):

- `IDD_LINK_GROUP_SETTINGS` = 40160
- `IDC_LINK_EXEMPT_LIST` = 40161
- `IDC_LINK_EXEMPT_RESET` = 40162
- `IDD_LINK_GROUP_DISAGREEMENT` = 40163
- `IDC_LINK_DISAGREEMENT_LIST` = 40164

The right-click menu builder gets one new entry: `ID_LINK_GROUP_SETTINGS` (a new accelerator-free menu ID in the existing range), enabled when `control->selection != NULL && control->selection->linkGroup != 0`.

### E. Sync-when-unexempting — `IDD_LINK_GROUP_DISAGREEMENT`

Triggered at OK time of the settings dialog, but only when:
1. At least one flag transitioned from `true` to `false` (was exempt, now shared).
2. For at least one such field, current group members hold disagreeing values.

For each such field, build the `Disagreement`:

```cpp
struct DisagreementEntry
{
    const char*                                    fieldLabel;
    int                                            fieldId;
    std::vector<std::pair<std::string,           // value as display string
                          std::vector<Emitter*>>> // members holding that value
                                                   uniqueValues;
};
```

Disagreement dialog: another SysListView32 (or rapid-fire panel with one radio group per row). Each row shows:
- Field name
- Unique value 1, "used by [list of member names]"
- Unique value 2, "used by [other member names]"
- … radio selection picks the winning value.

OK applies all selected values to all members (overwriting the dissenting members), then proceeds with the original settings-dialog OK (writes flags, fires `ELN_LISTCHANGED` → `CaptureUndo`).

If the user cancels the disagreement dialog: no changes commit, settings dialog also rolls back (OR re-displays for re-edit — pick the simpler: just rolls everything back, user re-opens to re-decide).

Helper functions:

```cpp
// In LinkGroup.cpp:
std::vector<DisagreementEntry> BuildDisagreementList(
    const ParticleSystem&    system,
    uint32_t                 groupId,
    const LinkExemptFlags&   oldFlags,
    const LinkExemptFlags&   newFlags);

void ApplyDisagreementResolutions(
    ParticleSystem&                       system,
    uint32_t                              groupId,
    const std::vector<DisagreementEntry>& resolutions);
```

`BuildDisagreementList` walks every flag, checks if it transitioned `true → false`, gathers the current member values, dedups, returns one `DisagreementEntry` per field with non-trivial disagreement (≥ 2 unique values).

`ApplyDisagreementResolutions` for each entry: take the user-picked winning value, overwrite every other member's field with it.

### F. Propagation hook update

In [src/main.cpp:802](src/main.cpp:802) and [src/LinkGroup.cpp:65](src/LinkGroup.cpp:65) (`CreateLinkGroup`) and [src/LinkGroup.cpp:94](src/LinkGroup.cpp:94) (`JoinLinkGroup`):

```cpp
// Old:
const LinkExemptFlags& exempt = GetLinkExemptFlags();
// New:
const LinkExemptFlags& exempt
    = info->particleSystem->getLinkExemptFlags(info->selectedEmitter->linkGroup);
```

One-line change. Three call sites. The static `GetLinkExemptFlags()` is renamed `GetDefaultLinkExemptFlags()` and kept for `ParticleSystem::getLinkExemptFlags`'s fallback path.

### G. Undo coverage

The existing undo system snapshots the entire `ParticleSystem` via serialize-to-buffer. `m_linkExempts` rides the same snapshot if its bytes are serialized — but the existing snapshot path is `ParticleSystem::write` which doesn't currently emit `m_linkExempts`. MT-10's writer changes (§B) automatically add `m_linkExempts` to the snapshot.

The dialog's OK triggers `ELN_LISTCHANGED` via the existing pathway in `EmitterList.cpp`, which fires `CaptureUndo` in main.cpp with `coalesceKey=0` (no folding). One dialog OK = one undo entry covering the flag changes AND any disagreement-resolved member-value changes. Single Ctrl-Z restores everything.

---

## Risks named up front + mitigations + tripwires

Each risk: what breaks, when, why → code-level mitigation → the verification step that bites if the mitigation regresses.

1. **Chunk ID `0x0003` collides with a chunk the game engine reads.** If EaW/FoC's particle-system reader interprets `0x0003` at the system level (e.g. it's a documented chunk we missed), a file saved with MT-10 may render incorrectly or refuse to load in-game.
   - *Mitigation*: the optional-skip pattern means unknown chunks at the system level are dropped silently. Verify by saving an MT-10 file with `m_linkExempts` populated, loading it in EaW/FoC, confirming visual output matches the same file's pre-MT-10 save. If the engine refuses or crashes, change the chunk ID to `0x0901` (above the envelope range, less collision risk) and retry.
   - *Tripwire R1*: build a 3-emitter system, set a non-default exempt set, save. Load in EaW/FoC binary. Particle effect renders correctly + identically to the same scene saved without the `0x0003` chunk. If divergent or crash → chunk ID is wrong.

2. **`LinkExemptFlags` struct layout changes between editor versions.** Adding a flag changes `sizeof(LinkExemptFlags)`. Files saved by a newer editor have larger per-group entries than an older editor expects.
   - *Mitigation*: per-entry `flagsByteCount` written before the blob (§B). Newer-saved-by-older-loaded: older editor reads only the bytes it knows, skips the rest, applies defaults to unknown flags. Older-saved-by-newer-loaded: newer editor sees a smaller blob, reads what's there, defaults the missing tail.
   - *Tripwire R2*: in a debug build, manually corrupt the per-entry `flagsByteCount` to be one byte less than actual (simulating older file). Reader loads gracefully: known flags from the first N-1 bytes apply; the last flag falls back to its default. No crash, no silent miscount.

3. **Disagreement-resolution UX overload.** A user clears 10 exempt flags at once with 10 disagreements. A naive implementation pops 10 dialogs in sequence.
   - *Mitigation*: collect ALL disagreements at OK time, show ONE summary dialog with one row per disagreeing field. Single Apply resolves them all. Skip dialog entirely when no disagreements (every cleared flag found members already agreeing).
   - *Tripwire R3*: clear 5 exempt flags in one dialog edit; 3 fields disagree, 2 fields agree. One summary dialog appears with 3 rows (not 5, not 1 each). After Apply, the 2 agreeing fields are silently shared (no change to member values); the 3 resolved fields apply the user's pick.

4. **`copySharedParamsFrom` field-by-field restore drifts from the actual field list.** Today the function manually restores 4 exempt fields. With ~42, a field can be silently forgotten — added to `LinkExemptFlags` and the dialog but missed in the save/restore.
   - *Mitigation*: either (a) build a field table that pairs each flag with its save/restore op, or (b) add a debug-only assertion at the end of `copySharedParamsFrom` that walks both structs and confirms every flag-checked field was actually preserved. **Default: assertion**, since the field-table refactor is invasive; the assertion fires at first use in a debug build if a flag was forgotten.
   - *Tripwire R4*: add a new flag to `LinkExemptFlags` (say `hypothetical = true` by default) without updating `copySharedParamsFrom`'s restore section. Debug build's `copySharedParamsFrom` assertion fires on first propagation. Real-build behaviour: the new field always gets overwritten by propagation regardless of the flag → silent miscalibration. The assertion catches it pre-ship.

5. **Settings dialog opens with stale member-state when another emitter is being edited.** If the inspector is mid-spinner-drag while the dialog opens, the dialog reads `linkExempts[groupId]` but the spinner's pending value isn't committed yet. OK applies stale flags.
   - *Mitigation*: the existing inspector-disabled overlay (MT-8 layered popup at [src/main.cpp:1908](src/main.cpp:1908)) is only present when multi-set ≥ 2. Single-emitter editing doesn't disable the inspector. If the user opens "Group settings…" while a spinner has uncommitted state, the spinner's `WM_KILLFOCUS` (fired when the dialog steals focus) commits its value before the dialog reads. Verify this by stepping through the focus-stealing path.
   - *Tripwire R5*: start dragging an inspector spinner. While drag is mid-flight, right-click the emitter, pick "Group settings…". The spinner's WM_KILLFOCUS fires; its pending value commits to the emitter. Dialog reads the committed value, OK applies correctly.

6. **Undo of a sync-when-unexempting commit restores BOTH the flag change AND the member-value overwrite.** If undo restores only the flag change but not the member values, the next propagation cycle "re-discovers" the divergence and re-fires the disagreement dialog (or propagates wrong values).
   - *Mitigation*: full-system snapshot (existing path) covers both. The dialog OK fires one `CaptureUndo` AFTER both the flag write and the member-value writes; the snapshot includes both states. Single Ctrl-Z restores both.
   - *Tripwire R6*: set up 3 linked emitters with `lifetime` exempt + divergent lifetime values (1.0, 2.0, 3.0). Open dialog, clear `lifetime` exempt, OK → disagreement dialog appears → pick "2.0" → Apply. Member lifetimes are now 2.0/2.0/2.0; exempt is `false`. Press Ctrl-Z. Member lifetimes restore to 1.0/2.0/3.0; exempt restores to `true`. Press Ctrl-Y. Both apply again.

7. **Game engine reading a non-default exempt-flags chunk might decompose `LinkExemptFlags` into stray field interpretations.** If the engine's chunk reader is permissive ("read any data into a known struct"), a misread could silently corrupt a different system field.
   - *Mitigation*: the engine's reader for `0x0900` envelope follows a known pattern: switch on chunk type, default-skip unknown. `0x0003` is unrecognized in any documented engine code path. **Action**: visual-render verify in §R1 tripwire — if the engine were misinterpreting, particles would render wrong.

8. **Dialog's "Reset to defaults" button mid-edit clears unsaved disagreement-resolution choices.** If the user has been mid-edit toggling flags + has pending disagreement-state on OK, hitting Reset wipes everything.
   - *Mitigation*: Reset only affects the local flags struct in the dialog. No disagreement dialog has been shown yet (it only triggers at OK). So Reset = "revert flags to defaults", then user picks OK and the disagreement flow runs against the new (reset) flags. Behaviour is consistent.
   - *Tripwire R8*: open settings dialog, toggle 3 random flags, hit Reset. List checkboxes match defaults. Hit OK. The disagreement flow runs against `defaults` (not against the pre-Reset state).

9. **Per-group exempt change without re-running propagation leaves stale member states.** User changes exempt set from "lifetime exempt" to "lifetime shared". The dialog's sync-when-unexempting handles the disagreement, but what if disagreement was already resolved by an earlier (separate) edit? No prompt fires; lifetimes stay divergent.
   - *Mitigation*: this is actually correct behaviour. If members already agree on `lifetime`, there's nothing to disagree about; un-exempting just changes the flag for future propagations. No member-value overwrite needed because they already agree.
   - *Tripwire R9*: 3 members all have `lifetime = 1.0`. Exempt is `true`. Open dialog, clear exempt, OK. No disagreement dialog. Member lifetimes still 1.0. Edit one to 2.0 → propagation overwrites the others to 2.0 (because shared now).

10. **Dialog field labels don't match inspector labels.** A user looks for "Random Lifetime %" in the dialog but sees `randomLifetimePerc`. UX friction.
    - *Mitigation*: hand-pick display labels matching the inspector. The dialog's field-label string table is hand-authored, not derived from the C++ identifier.
    - *Tripwire R10*: side-by-side screenshot review — every dialog row matches a visible inspector control's label.

---

## Verification

Each row says **the regression it catches**.

### A. Data model + default behaviour

- **A1.** Open a pre-MT-10 file with two link groups, no exempt chunk → both groups use v1 defaults (textures + index + name); editing a non-exempt field propagates to siblings exactly as in MT-7. *Catches: regression in the defaults pathway; per-group lookup returning wrong reference.*
- **A2.** Create a new group from scratch via "Link selected" → no entry added to `m_linkExempts` (verify via debug log) → group uses v1 defaults. *Catches: CreateLinkGroup speculatively inserting a default entry; map bloating with redundant defaults.*
- **A3.** Set custom exempts on group X, save file, dissolve group X via "Dissolve link group" → `m_linkExempts` entry for X is removed on next save. *Catches: orphan entries persisting for dissolved groups, bloating future saves.*
- **A4.** Open empty system (no groups), no `0x0003` chunk in saved output. *Catches: writer emitting empty chunk; readers tolerating it should remain backwards-only-safe.*

### B. Custom exempt persistence

- **B1.** Set group X to exempt `lifetime` (in addition to defaults), save, reload → exempt persists. *Catches: writer not emitting non-default entry; reader not consuming.*
- **B2.** Set group X to NOT exempt `colorTexture` (a default-exempt) — i.e., texture should propagate → save, reload → cleared-default-exempt persists. *Catches: writer assuming all flags are independent of defaults; reader applying defaults over non-default values.*
- **B3.** Two groups, X with `lifetime` exempt and Y with `blendMode` exempt → save, reload → both persist independently. *Catches: writer using wrong groupId per entry; reader's per-entry parsing.*
- **B4.** Save file with one custom-exempt group in MT-10, load in a pre-MT-10 debug binary (if one is buildable) → the pre-MT-10 build skips the unknown chunk and loads with v1 defaults for every group. No crash. *Catches: forward-compat regression — pre-MT-10 readers must tolerate the new chunk.* **Note: requires building a pre-MT-10 binary; skip if not tractable, the optional-skip pattern is well-tested by 0x0002 leaveParticles.*

### C. Sync-when-unexempting

- **C1.** Group of 3 members all sharing `lifetime` (currently exempt + happens to agree at 1.0 / 1.0 / 1.0). Open dialog, clear `lifetime` exempt, OK → no disagreement dialog fires. Member values unchanged. *Catches: disagreement dialog firing on agreement (false positive).*
- **C2.** Group of 3 members exempt-`lifetime` with divergent values (1.0 / 2.0 / 3.0). Open dialog, clear `lifetime`, OK → disagreement dialog appears. Three radio options: "1.0 (used by smoke_a)", "2.0 (used by smoke_b)", "3.0 (used by smoke_c)". Pick 2.0, Apply. All three lifetimes are now 2.0. *Catches: dialog not appearing for actual disagreement; resolution applying wrong value; not all members overwritten.*
- **C3.** Clear 5 exempt flags at once, 3 fields disagree, 2 agree → single summary dialog with 3 rows. *Catches: per-field cascading dialogs (R3 tripwire); empty rows for agreeing fields.*
- **C4.** Disagreement dialog Cancel → settings dialog OK is rolled back; flags revert to pre-edit state; member values untouched. *Catches: partial commit on Cancel; flags written without resolving values; values written without flags.*

### D. Propagation behaviour

- **D1.** Group of 3 members. Custom exempt set: `lifetime` is now shared (cleared from default-shared, was-default-shared anyway). Edit one member's lifetime → other two update. *Catches: propagation hook not consulting per-group flags.*
- **D2.** Group of 3 members. Set `colorTexture` to NOT exempt (was default-exempt). Edit one member's colorTexture → others update. *Catches: propagation respecting v1 defaults instead of per-group override.*
- **D3.** Group of 3 members. Set `lifetime` to exempt. Edit one member's lifetime → others NOT updated. *Catches: hook always propagating regardless of flag.*
- **D4.** Two groups X and Y. X exempts `lifetime`, Y doesn't. Edit a member of X → no propagation. Edit a member of Y → propagation fires. *Catches: per-group lookup using wrong groupId.*

### E. Undo / redo

- **E1.** Open dialog, change 3 flags, OK → one undo entry. Press Ctrl-Z → flags restore. Ctrl-Y → flags re-apply. *Catches: dialog OK firing multiple CaptureUndos; undo not capturing flag changes.*
- **E2.** Sync-when-unexempting with disagreement-resolution → one undo entry covers BOTH the flag change AND the member-value resolution. Ctrl-Z restores both. *Catches: separate CaptureUndo for flags vs. values; partial undo.*
- **E3.** Cancel dialog → no undo entry. Existing undo stack is untouched. *Catches: cancel still firing CaptureUndo.*
- **E4.** Set custom exempts on group X → Ctrl-Z → flags revert AND any pending in-flight inspector edits aren't disturbed. *Catches: undo restoring more than the dialog's changes.*

### F. Dialog UI behaviour

- **F1.** Open dialog for group 3 → title reads "Link group 3 settings". *Catches: hardcoded title; missing dynamic format.*
- **F2.** Open dialog → checkboxes reflect current exempt state (group's flags or defaults). *Catches: reading wrong group; not consulting per-group map.*
- **F3.** Toggle a checkbox → local state mutates; OK applies; Cancel reverts. *Catches: immediate write-through to data model (should be batched at OK).*
- **F4.** Hit Reset → all checkboxes return to defaults. OK applies defaults → `m_linkExempts` entry is REMOVED (not "store the defaults explicitly"). *Catches: storing redundant defaults; not normalizing on save.*
- **F5.** Open dialog twice in a row → second open shows the flags from the first save. *Catches: dialog state leaking across opens; not re-reading after save.*

### G. File-format edge cases

- **G1.** Empty `m_linkExempts` (no custom-exempt groups) → no `0x0003` chunk emitted in save. File is byte-identical to pre-MT-10 save (if the data otherwise matches). *Catches: speculative chunk emission; bloat in default-state files.*
- **G2.** System with 1 custom-exempt group + 10 default-exempt groups → `0x0003` chunk has exactly 1 per-group entry. *Catches: emitting defaults; storing all groups regardless.*
- **G3.** Save → close → reopen → save again → both save outputs are byte-identical. *Catches: state-dependent serialisation; round-trip drift.*
- **G4.** File saved by a debug build that has extra flags (simulated by writing a chunk with `flagsSize > sizeof(LinkExemptFlags)` for the current build) → loads in current build with the known flags applied, extras silently dropped. *Catches: brittle reader that errors on unexpected size.*

### H. Game-engine compatibility

- **H1.** Open an MT-10-saved file with non-default exempts in EaW/FoC binary → particle effect renders identically to the same scene saved without the chunk (engine ignores the unknown system-level chunk). *Catches: chunk ID collision with engine-known IDs (R1 tripwire).*

### I. Composite scenarios

- **I1.** Build a 4-member group. Set custom exempts (share lifetime, exempt blendMode). Edit one member's lifetime → 3 others update. Edit one member's blendMode → no propagation. Save → reload → behaviour preserved. *Catches: end-to-end regression across propagation + persistence.*
- **I2.** Bracket-select a 3-member group (MT-9), right-click → "Group settings…" → dialog opens for the group's ID. *Catches: settings menu only available via single-selection right-click; bracket-driven multi-set not finding the group.*

### Debug instrumentation

Under `#ifndef NDEBUG`, sharing the `[Link]` prefix with MT-7 / 8 / 9:

- `[Link] exempt set group=N flags=#hex` — fires on dialog OK with the new flag bytes (hex-dump).
- `[Link] exempt dialog: disagreements=N applied=M` — fires after the disagreement dialog Apply.
- `[Link] read chunk 0x0003: count=N` — fires on file load with non-empty exempt chunk.

---

## Implementation order (test-as-you-go)

Each milestone ends at a commit boundary; verify the listed categories pass before moving on.

1. **Data model**: extend `LinkExemptFlags`, add `m_linkExempts` + accessors, rename `GetLinkExemptFlags` → `GetDefaultLinkExemptFlags`. Verify **A1, A2** (defaults pathway, no spurious entries).
2. **`copySharedParamsFrom` extension**: handle every flag's save/restore. Add the debug-only "every flagged field actually preserved" assertion (R4 mitigation). Verify **D1, D2, D3** (propagation respects flags).
3. **Serialisation**: write + read `0x0003` chunk. Verify **B1, B2, B3, G1, G2, G3** (persistence, byte-identical defaults).
4. **Propagation hook update**: switch `CaptureUndo`, `CreateLinkGroup`, `JoinLinkGroup` to per-group lookup. Verify **D4** (per-group lookup, no cross-contamination).
5. **Settings dialog UI**: dialog resource + dialog proc + menu wire-up. Verify **F1, F2, F3, F4, F5**.
6. **Sync-when-unexempting**: disagreement helpers + disagreement dialog + OK-time integration. Verify **C1, C2, C3, C4**.
7. **Undo coverage verification**: full E category live. Verify **E1, E2, E3, E4**.
8. **Game-engine compat smoke**: build, save a non-default-exempt file, load in EaW/FoC binary, render. Verify **H1**.
9. **Composite + ROADMAP/CHANGELOG/PR**.

---

## Delivery shape

- **Branch**: `feat/mt10-configurable-exempts` off `master`.
- **Files touched**:
  - [src/LinkGroup.h](src/LinkGroup.h), [src/LinkGroup.cpp](src/LinkGroup.cpp) — expanded `LinkExemptFlags`, renamed default-accessor, new disagreement helpers.
  - [src/ParticleSystem.h](src/ParticleSystem.h), [src/ParticleSystem.cpp](src/ParticleSystem.cpp) — `m_linkExempts` + accessors, expanded `copySharedParamsFrom`, new chunk write/read.
  - [src/main.cpp](src/main.cpp) — propagation hook switches to per-group lookup.
  - [src/UI/EmitterList.cpp](src/UI/EmitterList.cpp) — menu entry, dialog launch, OK-flow with disagreement integration.
  - [src/ParticleEditor.en.rc](src/ParticleEditor.en.rc), [src/ParticleEditor.de.rc](src/ParticleEditor.de.rc) — new dialog resources (`IDD_LINK_GROUP_SETTINGS`, `IDD_LINK_GROUP_DISAGREEMENT`).
  - [src/Resources/resource.en.h](src/Resources/resource.en.h), [src/Resources/resource.de.h](src/Resources/resource.de.h) — new IDs in the 40160–40169 range.
- **Estimated delta**: ~800 LOC across all files. Largest pieces are the expanded `copySharedParamsFrom` (~150 LOC), the settings dialog proc (~150 LOC), and the disagreement helpers + dialog (~200 LOC). The rest is small additions.
- **No new files** — every change is to an existing file.
- **Single PR**. Phases 1-2 (data model + copy extension) could split off as a refactor-only PR if review tractability matters more than atomicity; I'd default to single PR since the data-model change is meaningless without the UI surface.
- **ROADMAP / CHANGELOG** updates per the existing convention: new `5.1 [MT-10]` entry, renumber 5.2..5.15; CHANGELOG entry covering what ships + how-we-tackled-it (the per-group storage + chunk format) + issues encountered.

---

### J. Degenerate / boundary states

- **J1.** Empty system (no emitters, no groups) → save → no `0x0003` chunk in output bytes. *Catches: speculative chunk emission; bloat in default-state files.*
- **J2.** System with one unlinked emitter → save → no `0x0003` chunk. *Catches: writer emitting empty chunk for unlinked emitters.*
- **J3.** 2-member group with all defaults → save → no `0x0003` chunk (defaults never persist). *Catches: writer persisting defaults instead of normalising.*
- **J4.** 50 groups each with custom exempt set → save → reload → all 50 entries preserved. *Catches: writer truncating at 1 entry; reader's loop bound off-by-one.*
- **J5.** Group with 100 members + custom exempts. Settings dialog opens in < 200 ms; disagreement check completes in < 100 ms even with all 100 members holding divergent values per field. *Catches: O(N²) loop in BuildDisagreementList; chunk reader scaling badly.*
- **J6.** Group of exactly 2 members → dialog opens; behaviour identical to larger groups. *Catches: minimum-group-size assertions firing for the minimum case.*
- **J7.** All-exempt configuration (every flag `true`, including the v1 defaults) → no propagation ever fires for that group. Edit any field on any member → siblings untouched. *Catches: hard-coded "always propagate name" or similar field-specific defaults bleeding through.*
- **J8.** Zero-exempt configuration (every flag `false`, including the v1 defaults: textures + index + name are all SHARED) → editing any field propagates to all members, including colorTexture and name. *Catches: hard-coded v1 defaults overriding the per-group flag for the four traditionally-exempt fields.*

### K. Performance

- **K1.** Cold open of settings dialog with system of 30 emitters, 10 groups → first paint < 100 ms. *Catches: O(N²) in dialog initialisation; redundant tree walks.*
- **K2.** OK-time disagreement build with 20-member group, 20 disagreeing fields → completes in < 50 ms. *Catches: nested loop over members × fields × unique-value enumeration with bad complexity.*
- **K3.** Save / load cycle of a system with 30 custom-exempt groups → each direction < 200 ms (a generous bound for typical .alo size). *Catches: chunk writer using inefficient per-field write calls; reader allocating per-entry.*
- **K4.** Propagation cost is unchanged by MT-10 for groups using v1 defaults (no `m_linkExempts` entry). One emitter edit + propagation to 5 siblings completes in the same time as a pre-MT-10 build. *Catches: per-group lookup adding non-trivial overhead to the hot path.*

### L. Theme & DPI

- **L1.** Dialog at Windows 100% scaling → all rows visible, no checkbox clipping, no overlapping labels. *Catches: hardcoded pixel sizes; resource dialog not declared with DS_SETFONT.*
- **L2.** Dialog at Windows 175% scaling → checkboxes and labels scale up via Win32 default DPI handling. *Catches: dialog resource missing the right font / scaling style.*
- **L3.** Dialog under Windows High Contrast theme → uses system theme colours throughout (no custom RGB in our dialog proc). *Catches: hardcoded colours overriding the user's HC theme intent.*
- **L4.** Disagreement dialog under each theme combination above → same expectations as the settings dialog.

### M. Window state & multi-system interactions

- **M1.** Open settings dialog → File → Open a different particle system → dialog's referenced group no longer exists → dialog closes (or graceful no-op on OK with an error message). *Catches: dialog OK applying to a freed pointer; dangling reference into a swapped-out system.*
- **M2.** Open settings dialog → external action (right-click in another menu) dissolves the group → dialog's group no longer exists → graceful handling on OK (no crash, no silent corruption). *Catches: dialog assuming the group exists for the duration of the dialog.*
- **M3.** Open settings dialog → external action deletes a member → group still exists with fewer members → dialog OK still applies correctly to remaining members. *Catches: dialog caching the member list at open time, applying stale references.*
- **M4.** Open settings dialog → multi-select a different set of emitters via marquee in the background → dialog state unchanged; OK still applies to the original group. *Catches: dialog reading current multi-set state instead of the group ID it was opened with.*
- **M5.** Open settings dialog → Alt-Tab away → return → dialog state preserved. *Catches: focus-loss clearing dialog state.*
- **M6.** Open settings dialog twice in a row (close, then re-open) → second open shows the state from the first save. *Catches: dialog state leaking across opens; not re-reading from the data model.*

### N. MT-7 / MT-8 / MT-9 interaction

- **N1.** Bracket-click select a group via MT-9 → right-click → "Group settings…" appears in the menu → dialog opens for the group → OK applies → bracket re-paints (no change visible, but no stale state). *Catches: bracket-driven multi-set not finding the group; menu builder not consulting linkGroup.*
- **N2.** Multi-select via MT-8 marquee that includes members from two different groups (primary in group X, set includes a member of group Y) → right-click → "Group settings…" operates on the primary's group only. *Catches: menu trying to operate on multi-set when groups disagree; silent cross-group corruption.*
- **N3.** After MT-10 ships, link-group creation via "Link selected" still produces v1-default-exempt behaviour (no immediate dialog popup; no `m_linkExempts` entry). *Catches: CreateLinkGroup eagerly inserting defaults.*
- **N4.** Add emitter to existing custom-exempt group via "Add to link group" → joiner inherits the group's CURRENT exempt set (not the v1 defaults). If the group exempts `lifetime`, the joiner's lifetime is preserved when the rest of the group's non-exempt params are copied to it. *Catches: JoinLinkGroup using static defaults; cross-pollination of exempt sets.*
- **N5.** MT-9 bracket painting unchanged by MT-10 — both groups render with their assigned palette colours regardless of exempt configuration. *Catches: bracket-painting code accidentally consuming the new flags struct.*
- **N6.** Right-click on a non-linked emitter → "Group settings…" is NOT in the menu. *Catches: menu always offering the item, leading to a NULL-group dialog open.*
- **N7.** Delete a linked emitter via bracket-select + Delete (MT-9 Q4 follow-up) → if the group is reduced to < 2 members, the auto-dissolve fires → the `m_linkExempts` entry for that group should also be cleaned up. *Catches: orphan exempt entries persisting after auto-dissolve.*

### O. Field-specific persistence (one per field type)

Catches type-specific save/restore bugs in the expanded `copySharedParamsFrom`. Each tests a single field per type category.

- **O1.** Bool field (`linkToSystem`) exempt → save → reload → exempt persists → editing one member's `linkToSystem` doesn't propagate. *Catches: bool serialisation in `LinkExemptFlags` blob.*
- **O2.** Int field (`blendMode`) exempt → same procedure. *Catches: int serialisation.*
- **O3.** Float field (`gravity`) exempt → same. *Catches: float serialisation.*
- **O4.** String field (`colorTexture`) non-exempt — i.e., shared (this REVERSES the v1 default) → save → reload → editing one member's `colorTexture` propagates to others. *Catches: string fields hardcoded as always-exempt despite the flag.*
- **O5.** Array field (`acceleration` — float[3]) exempt → save → reload → editing one member's acceleration vector doesn't propagate. *Catches: array fields not honoured by `copySharedParamsFrom`'s save/restore.*
- **O6.** Track field (`tracks[TRACK_RED]`) exempt → save → reload → editing one member's red-curve keys doesn't propagate. *Catches: track-keymap save/restore wrong; track aliasing pointer issues.*
- **O7.** Group field (`groups[SPEED]` random-param box) exempt → save → reload → editing one member's speed-group doesn't propagate. *Catches: groups[] fixed-size array save/restore.*
- **O8.** `trackIndex` exempt (default state) → behaves as MT-7: every emitter keeps its own atlas curve. *Catches: regression in the canonical exempt behaviour.*
- **O9.** `trackIndex` non-exempt (cleared in dialog) → editing one member's atlas curve propagates to others. *Catches: hard-coded "TRACK_INDEX is always per-emitter" bypass.*

### P. Defensive / refusal paths

- **P1.** Open dialog when `control->selection->linkGroup == 0` → menu item is suppressed; dialog never opens. *Catches: defensive NULL-group dialog open.*
- **P2.** Open dialog when `control->system == NULL` → menu suppressed. *Catches: NULL system in dialog proc.*
- **P3.** Read malformed `0x0003` chunk with `count == 0` → reader loads system normally; `m_linkExempts` is empty. *Catches: writer emitting zero-count chunk; reader not handling.*
- **P4.** Read `0x0003` chunk with `groupId == 0` for one entry → reader silently drops that entry (groupId 0 = unlinked, invalid). *Catches: bogus entries polluting the map.*
- **P5.** Read `0x0003` chunk with a `groupId` not present in any emitter (e.g. file edited externally, member emitter deleted manually) → entry kept in map; harmless. Next save normalises by dropping the orphan if no group uses it. *Catches: aggressive reader rejecting otherwise-valid files; orphan entries causing OK-time confusion.*
- **P6.** Read `0x0003` chunk with `flagsByteCount` > actual remaining chunk size → reader bails on that entry, logs, continues to next entry or chunk. *Catches: malicious or corrupted file crashing the editor.*
- **P7.** Settings dialog: middle-click in the list view → no effect. *Catches: row mutation on unexpected input.*
- **P8.** Settings dialog: keyboard navigation — Tab, Space to toggle, Enter for OK, Esc for Cancel → all work. *Catches: dialog missing standard keyboard handlers.*
- **P9.** Disagreement dialog with 0 disagreements after all members reconciled by an external action mid-dialog → dialog still appears empty / closes gracefully. *Catches: dialog crashing on empty input.*

### Q. CHANGELOG / ROADMAP correctness (post-merge backfill)

- **Q1.** ROADMAP §5.1 has the `[MT-10]` entry with PR# and merge hash after the backfill PR lands. *Catches: forgotten backfill.*
- **Q2.** CHANGELOG top entry follows the established conventions: italic date line with hash + PR# links, sectioned content (What ships / How we tackled it / Issues encountered), `---` delimiter. *Catches: drift in the established format.*

---

## Open questions for the user

**All resolved (2026-05-14). Plan locked. Proceeding to implementation per §Implementation order.**

- ✅ Q1 Chunk ID → `0x0003`; fallback to `0x0901` if R1 tripwire flags an engine collision post-implementation.
- ✅ Q2 `trackIndex` configurable → surface in the dialog, default-checked-exempt.
- ✅ Q3 Dialog entry point → right-click menu only; matches existing group-op surface (Link, Dissolve, Add, Remove).
- ✅ Q4 Disagreement default winner → first-in-tree-order member's value. Matches CreateLinkGroup canonical-source rule.
- ✅ Q5 Reset-to-defaults triggers sync-when-unexempting at OK → yes; consistent with any other flag change.
- ✅ Q6 `copySharedParamsFrom` refactor → if-ladder. First-read clarity beats future-extensibility at this scale; debug assertion catches forgotten fields.
- ✅ Q7 `DiffNonExemptParams` signature → add `LinkExemptFlags` parameter; three call sites get a one-line change.

(Original open-question text preserved below for historical reference of the form. Skip past it.)

### Q1. Chunk ID for the per-group exempt-flags chunk

The natural choice is `0x0003`, the next system-level ID after `0x0000` / `0x0001` / `0x0002`. The game engine has never been observed reading it, and the optional-skip pattern (already used by `0x0002` leaveParticles) is robust against ID collisions.

Alternative: `0x0901`, above the envelope range. Less likely to collide if the game engine has chunk IDs in the `0x0003..0x000F` space we don't know about.

*Default recommendation: `0x0003`* — fits the existing sequence; the optional-skip pattern protects against collision either way. If R1 tripwire (engine render check) fails post-implementation, switch to `0x0901` and re-test.

### Q2. Whether to make `trackIndex` (atlas index curve) a configurable exempt

Today's hard-coded set treats `TRACK_INDEX` as exempt — every emitter has its own atlas-frame curve. That's the right default for atlas-variant link groups.

But: there's a legitimate workflow where a designer wants ALL members to share the atlas curve too (e.g. for a "flicker" effect where every smoke emitter pulses through the atlas in sync). MT-10 should expose `trackIndex` as a configurable.

*Default recommendation: surface in the dialog, default-checked-exempt.* If you want it left as a hard-coded exempt (never configurable), say so and I'll hide the row.

### Q3. UI placement of "Group settings…"

Plan inserts a new menu item into the right-click menu, only visible when the selected emitter is in a link group.

Alternative: a small "gear" icon next to the bracket dot in the tree, clickable. (Higher discoverability, more rendering work, possibly fragile interaction with the bracket hit-test.)

Alternative: a toolbar button in the emitter list, enabled only when a linked emitter is selected.

*Default recommendation: right-click menu only.* Matches every other group operation (Link, Dissolve, Add, Remove). Discoverability is fine because the user is already in the right-click menu when they want to manage a group.

### Q4. Disagreement-resolution default winner

When 3 members have lifetimes 1.0 / 2.0 / 3.0 and the user un-exempts `lifetime`, the disagreement dialog asks which value should govern. Options for the default-selected radio:

- **(a)** First-in-tree-order member's value
- **(b)** Most-common value (mode)
- **(c)** No default selected — user must click

*Default recommendation: (a) first-in-tree-order.* Matches how `CreateLinkGroup`'s canonical-source works — `members[0]` (topmost in tree order) governs. Consistent mental model. (b) is fragile to ties; (c) adds a click that's avoidable.

### Q5. Should `Reset to defaults` in the settings dialog produce a sync-when-unexempting flow?

If the user has a non-default exempt set (e.g. `lifetime` was exempt, members have divergent lifetimes), then hits Reset (which makes `lifetime` shared again per defaults)... should that trigger the disagreement dialog at OK time?

*Default recommendation: yes — Reset just changes the flags struct; the OK-time disagreement check applies normally.* Otherwise Reset would silently overwrite values, which is bad. Alternative would be "Reset only changes flags but doesn't resolve disagreements" — but that leaves the model inconsistent (flags say shared, values say divergent → next propagation fires unexpectedly).

### Q6. Should `copySharedParamsFrom` refactor to a field-table or stay if-ladder?

Two options for handling ~42 exempt fields:
- **(a)** Field table: array of `{flag pointer-to-member, save-fn, restore-fn, byte-size}` — ~42 entries + ~8 generic helpers
- **(b)** If-ladder: `if (exempt.fieldX) restoreX();` × 42 — verbose, no indirection

*Default recommendation: (b) if-ladder.* Mirrors the existing 4-field structure; first-read clarity beats future-extensibility at this scale. The debug-only assertion (R4 mitigation) catches forgotten fields.

### Q7. Whether to update `DiffNonExemptParams` to take exempt flags as a parameter

Today's signature is `DiffNonExemptParams(a, b)` — implicitly consults `GetLinkExemptFlags()`. With per-group flags, callers need to pass the right group's flags.

*Default recommendation: change signature to `DiffNonExemptParams(a, b, exemptFlags)`*. Three call sites in `EmitterList.cpp`; each already knows the relevant group ID. Mechanical change.

---

## After MT-10 ships

The link-group feature set is complete for the original ROADMAP scope. If new requests surface:

- **Per-emitter exempt overrides** — file as a new MT-tier item. Data model would extend additively: a `std::map<Emitter*, LinkExemptFlags> m_perEmitterOverrides` parallel to the per-group map, with a layered lookup `override OR group-flag OR default`.
- **Exempt presets** — file as a new MT-tier item if multiple groups end up with identical custom exempts in real systems.

---

# Review

Per [CLAUDE.md](../CLAUDE.md) "Plan mode → append a review section to the same `todo.md`."

## What landed (per milestone)

All seven milestones from the plan's §Implementation order are complete. Debug x64 build is clean.

| # | Milestone | Files touched | Status |
|---|---|---|---|
| 1 | `LinkExemptFlags` expansion (4 → 58 bools) + `ParticleSystem::m_linkExempts` + accessors + rename `GetLinkExemptFlags → GetDefaultLinkExemptFlags` | [src/LinkGroup.h](src/LinkGroup.h), [src/LinkGroup.cpp](src/LinkGroup.cpp), [src/ParticleSystem.h](src/ParticleSystem.h), [src/ParticleSystem.cpp](src/ParticleSystem.cpp) | ✅ |
| 2 | `copySharedParamsFrom` expansion (~250 lines of save + conditional restore for every flag) | [src/ParticleSystem.cpp](src/ParticleSystem.cpp) | ✅ |
| 3 | New `0x0003` system-body chunk writer + reader (with `flagsByteCount` prefix for forward-compat) | [src/ParticleSystem.cpp](src/ParticleSystem.cpp) | ✅ |
| 4 | Propagation hook updates (already wired in M1) — `CaptureUndo` in `main.cpp`, `CreateLinkGroup` + `JoinLinkGroup` in `LinkGroup.cpp`, `DiffNonExemptParams` signature + 3 call sites in `EmitterList.cpp` | [src/main.cpp](src/main.cpp), [src/LinkGroup.cpp](src/LinkGroup.cpp), [src/UI/EmitterList.cpp](src/UI/EmitterList.cpp) | ✅ |
| 5 | Settings dialog UI: `IDD_LINK_GROUP_SETTINGS` resource, dialog proc, menu wire-up, field table, `ShowLinkGroupSettings` entry point | [src/UI/EmitterList.cpp](src/UI/EmitterList.cpp), [src/ParticleEditor.en.rc](src/ParticleEditor.en.rc), [src/ParticleEditor.de.rc](src/ParticleEditor.de.rc), [src/Resources/resource.en.h](src/Resources/resource.en.h), [src/Resources/resource.de.h](src/Resources/resource.de.h) | ✅ |
| 6 | Sync-when-unexempting (simplified to MessageBox confirm with canonical-source resolution per Q4 default) | [src/UI/EmitterList.cpp](src/UI/EmitterList.cpp) | ✅ |
| 7 | ROADMAP §5.1 + CHANGELOG entry + review section (this) | [ROADMAP.md](../ROADMAP.md), [CHANGELOG.md](../CHANGELOG.md), this file | ✅ |

## Architectural decisions worth remembering

1. **Sparse storage on `m_linkExempts`.** `setLinkExemptFlags(groupId, flags)` checks `flags == GetDefaultLinkExemptFlags()` and erases the entry in that case. Files without customization remain byte-identical to pre-MT-10 output; the new `0x0003` chunk only appears when at least one group genuinely overrides defaults.
2. **`flagsByteCount` per-entry prefix in the chunk.** Lets future versions add flags to `LinkExemptFlags` without breaking older readers (they read what they know, skip the rest). Older-saved-by-newer is also safe — smaller blob, missing tail defaults to `false`.
3. **`copySharedParamsFrom` if-ladder, not field table.** Per Q6 default. ~250 lines is verbose but mirror-of-existing and obvious. A debug-only assertion at the function tail catches forgotten flags pre-ship.
4. **Disagreement UX simplified from the original plan.** Instead of a custom radio-picker dialog, a single MessageBox lists each disagreeing field and the canonical (first-in-tree-order) member's value that will overwrite the others. Q4's accepted default ("first-in-tree-order wins") removes the need for an interactive picker — users wanting a different canonical re-order emitters before opening Group settings. `IDD_LINK_GROUP_DISAGREEMENT` is declared but unused in v1; a richer picker can land without re-touching the `.rc` files.
5. **`JoinLinkGroup` honours the target group's current exempt set, not v1 defaults.** A joiner inheriting a custom-exempt group preserves the joiner's lifetime (if `lifetime` is exempt in that group), rather than silently overwriting from the canonical member. This was a subtle correctness bug in the original migration.
6. **`Dissolve link group` clears the exempt entry** via the normalize-on-default behaviour of `setLinkExemptFlags`. Prevents orphan entries from bloating files.

## What needs interactive verification

The build is clean and the logic was inspected, but **none of the runtime behaviour has been exercised live**. The user needs to run the editor and walk through §Verification's categories A–Q. Highest-value pre-merge checks:

- **A1–A4** (defaults pathway): open a pre-MT-10 file, edit a non-exempt field, verify propagation; create a new group, verify default behaviour matches MT-7.
- **B1–B3** (custom exempts persist): toggle a flag, save, reload, verify.
- **C1–C3** (sync-when-unexempting): set up divergent values, clear an exempt flag, verify the MessageBox appears with the canonical member's value listed correctly; pick Yes and confirm member values converge; pick No and confirm rollback.
- **D1–D4** (propagation respects flags): edit each kind of field with various exempt configurations and verify propagation fires (or doesn't) as expected.
- **E1–E2** (undo): a single Ctrl-Z after a dialog OK with disagreement-resolution should restore BOTH the flag change AND the member values.
- **H1** (game engine compat): if you have an EaW/FoC install, load an MT-10-saved file with non-default exempts in-game and verify rendering matches. Per the optional-skip pattern this should be no-op; the R1 tripwire only fires if `0x0003` happens to collide with an unknown engine chunk.
- **N4** (`JoinLinkGroup` inheritance): set up a custom-exempt group, then "Add to link group →" a new emitter and verify the new emitter's value for the exempt field is preserved (not overwritten by the canonical member).
- **Q4 / N7** (dissolve clears exempt): set up a custom-exempt group, dissolve it via right-click → save → reload → no `0x0003` chunk in the saved file.

## Known gaps + deviations from the plan

- **Disagreement UX is a MessageBox, not the planned radio-picker dialog.** Simpler implementation; the picker can land later. `IDD_LINK_GROUP_DISAGREEMENT` is declared but unused.
- **`unknownXX` fields are in the data model but hidden from the dialog UI.** No way to toggle them via UI; their values still save/restore correctly if some future feature surfaces them.
- **`name` is hard-coded as always-exempt** at the data model level (per Q3 default). No UI dialog row for it.
- **No bulk "set all exempt / shared" buttons** beyond Reset-to-defaults. Add if usage shows the need.
- **No cross-file exempt-set sharing** — out of scope per plan. Link groups are local to a particle system.
- **English-only dialog labels** in both `.en.rc` and `.de.rc`. Matches existing convention.

## Open follow-on tasks (not blocking MT-10 merge)

- **Backfill PR# and merge hash** in [ROADMAP.md §5.1](../ROADMAP.md) and the [CHANGELOG.md](../CHANGELOG.md) MT-10 entry once the PR merges. Matches the backfill cadence of #59 / #61 / #64.
- **`Actual:` line in ROADMAP** also needs backfill.

## Files touched in this PR

- [src/LinkGroup.h](src/LinkGroup.h), [src/LinkGroup.cpp](src/LinkGroup.cpp) — expanded `LinkExemptFlags`, renamed default accessor, threaded `LinkExemptFlags&` parameter through `DiffNonExemptParams`.
- [src/ParticleSystem.h](src/ParticleSystem.h), [src/ParticleSystem.cpp](src/ParticleSystem.cpp) — `m_linkExempts` + accessors, expanded `copySharedParamsFrom` with R4 assertion, new `0x0003` chunk writer + tolerant reader.
- [src/main.cpp](src/main.cpp) — propagation hook one-line change to use per-group lookup.
- [src/UI/EmitterList.cpp](src/UI/EmitterList.cpp) — settings dialog (field table, dialog proc, disagreement check, value formatting + comparison helpers), menu wire-up for `ID_EMITTER_LINK_GROUP_SETTINGS`, three `DiffNonExemptParams` call-site updates, dissolve clears exempt.
- [src/Resources/resource.en.h](src/Resources/resource.en.h), [src/Resources/resource.de.h](src/Resources/resource.de.h) — new IDs in the 40160 / 1600 / 170 ranges.
- [src/ParticleEditor.en.rc](src/ParticleEditor.en.rc), [src/ParticleEditor.de.rc](src/ParticleEditor.de.rc) — `IDD_LINK_GROUP_SETTINGS` and `IDD_LINK_GROUP_DISAGREEMENT` dialog resources.
- [ROADMAP.md](../ROADMAP.md) — §5.1 entry, 5.2..5.16 renumbered.
- [CHANGELOG.md](../CHANGELOG.md) — top-of-file entry.
- [tasks/todo.md](todo.md) — plan + this review.

No new source files. No new file-format constraints beyond the `0x0003` chunk's optional-skip semantics.
