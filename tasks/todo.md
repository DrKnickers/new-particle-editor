# D5 — Parameterise `file/open` with a filter discriminator

**Status:** in-progress
**Started:** 2026-05-19
**Approach:** Option A from the design walkthrough — add
`filter?: "alo" | "skydome" | "ground"` to the existing `file/open`
request rather than introducing new bridge kinds. Fixes the skydome
custom-slot UX and unblocks ground-texture custom slots in one motion.

(Previous plan content for FD10 Group A is preserved in the git
history of this file — the FD10 work shipped and is documented in
CHANGELOG.md.)

---

## 1. Goal + scope

### Goal

When a user clicks an empty Custom slot in the Background picker or the
Ground Texture panel, the native `GetOpenFileNameW` dialog opens
defaulting to a `*.dds;*.tga` filter (and a relevant title bar), so the
user can immediately browse to a texture file without manually flipping
the filter dropdown to "All files." File → Open is unchanged: it
continues to default to `*.alo` and the existing recents/load chain.

A successful pick on a Ground Texture custom slot now writes the path
into the engine and activates the slot (previously a no-op).

### In

1. Add `filter?: "alo" | "skydome" | "ground"` to `file/open` request
   params in `web/packages/bridge-schema/src/index.ts`. Default `"alo"`
   for back-compat — every existing caller continues to behave
   identically with zero changes.
2. C++ dispatcher reads the field and switches `lpstrFilter` +
   `lpstrTitle` accordingly. Both `"skydome"` and `"ground"` use the
   same `*.dds;*.tga` filter (only the title differs).
3. `BackgroundPicker` passes `filter: "skydome"` when invoking the
   picker for slots 9/10/11. Stale header comment refreshed.
4. `GroundTexturePanel` wires the full pick → `set/ground-slot-custom-path`
   → `set/ground-texture { slot }` chain (mirrors BackgroundPicker)
   with `filter: "ground"`. Stale TODO refreshed.
5. New vitest specs cover both panels' chain behaviour.
6. Mock + bridge-contract comments refreshed; mock behaviour
   intentionally unchanged.
7. CHANGELOG entry + HANDOFF refresh.

### Out

- New bridge kinds (Option B was rejected for surface-area + lost
  composability).
- A separate `file/open-texture` primitive (Option C was rejected as
  near-duplicate of `file/open` with no current filter divergence).
- Persisting last-used directory across pickers — future polish.
- Force Align registry parity, mods menu (D6), or any other handoff
  backlog item — explicitly deferred.

---

## 2. What the codebase already gives us

- **`file/open` schema** declared at
  [bridge-schema/src/index.ts:362](web/packages/bridge-schema/src/index.ts:362),
  response shape at line 586.
- **C++ dispatcher case** at
  [BridgeDispatcher.cpp:1239-1266](src/host/BridgeDispatcher.cpp:1239) —
  parses `params.path`, falls through to `GetOpenFileNameW` if absent.
- **`GetOpenFileNameW` invocation** at
  [BridgeDispatcher.cpp:1259](src/host/BridgeDispatcher.cpp:1259) with
  hardcoded `lpstrFilter = L"Alo files\0*.alo\0All files\0*.*\0"`.
- **MockBridge handler** at
  [mock.ts:430-442](web/apps/editor/src/bridge/mock.ts:430) — returns
  `{ ok: false, error: "browser-mode" }` when no path is supplied.
- **BackgroundPicker chain** already in place at
  [BackgroundPicker.tsx:104-122](web/apps/editor/src/screens/BackgroundPicker.tsx:104).
  Stale "deferred" header comment at lines 5–6.
- **GroundTexturePanel no-op handler** at
  [GroundTexturePanel.tsx:125-135](web/apps/editor/src/screens/GroundTexturePanel.tsx:125)
  with TODO comment at lines 21–25.
- **Engine setters** for ground custom paths declared at
  [bridge-schema/src/index.ts:375](web/packages/bridge-schema/src/index.ts:375)
  (`engine/set/ground-slot-custom-path`) — already exists, just unused
  from React today.
- **Existing GroundTexturePanel test** at
  [GroundTexturePanel.test.tsx](web/apps/editor/src/screens/__tests__/GroundTexturePanel.test.tsx) —
  one spec for bundled slot dispatch; we'll extend.
- **Mock contract test** at
  [bridge-contract.test.ts:328](web/apps/editor/src/bridge/__tests__/bridge-contract.test.ts:328) —
  asserts `file/open` with no path resolves to `{ ok: false, error: "browser-mode" }`.
  Still passes; we'll add filter-aware cousins if needed.

---

## 3. Architecture / implementation approach

### Schema delta (one optional field, fully back-compatible)

```ts
| {
    kind: "file/open";
    params: {
      path?: string;
      filter?: "alo" | "skydome" | "ground";
    };
  }
```

Response shape unchanged. Existing TypeScript callers without `filter`
type-check cleanly — `filter` is optional.

### Dispatcher delta

```cpp
std::string filterId = "alo";
if (auto fit = params.find("filter"); fit != params.end() && fit->is_string()) {
    filterId = fit->get<std::string>();
}

const wchar_t* lpstrFilter = L"Alo files\0*.alo\0All files\0*.*\0";
const wchar_t* lpstrTitle  = L"Open particle system";
if (filterId == "skydome") {
    lpstrFilter = L"Texture files\0*.dds;*.tga\0All files\0*.*\0";
    lpstrTitle  = L"Open skydome texture";
} else if (filterId == "ground") {
    lpstrFilter = L"Texture files\0*.dds;*.tga\0All files\0*.*\0";
    lpstrTitle  = L"Open ground texture";
}
ofn.lpstrFilter = lpstrFilter;
ofn.lpstrTitle  = lpstrTitle;
```

Defensive parse (default `"alo"` on missing or non-string field) keeps
existing callers safe.

### BackgroundPicker delta

```ts
const r = await bridge.request({
  kind: "file/open",
  params: { filter: "skydome" },
});
```

Single-field addition. Rest of the chain unchanged.

### GroundTexturePanel delta

Replace the current no-op:

```ts
const handleCustomClick = (slot: number, isEmpty: boolean) => {
  if (isEmpty) {
    void (async () => {
      const r = await bridge.request({
        kind: "file/open",
        params: { filter: "ground" },
      });
      if (!r.ok || !r.path) return;
      await bridge.request({
        kind: "engine/set/ground-slot-custom-path",
        params: { slot, path: r.path },
      });
      await bridge.request({
        kind: "engine/set/ground-texture",
        params: { slot },
      });
    })();
    return;
  }
  handleSelectSlot(slot);
};
```

Mirrors BackgroundPicker's chain shape exactly. Engine setters already
exist on the bridge.

### Mock + comment refresh

MockBridge behaviour unchanged. Comment at
[mock.ts:432-434](web/apps/editor/src/bridge/mock.ts:432) refreshed to
note that `filter` is accepted but ignored (browser mode has no native
picker).

Stale header comments in both screens rewritten to describe what the
code actually does.

---

## 4. Risks & mitigations

1. **Existing callers without `filter`.** Risk: any existing call that
   doesn't pass `filter` could regress to a non-default behaviour.
   *Mitigation:* `filter` is optional with default `"alo"` on both sides
   (TypeScript optional + C++ defaults to `"alo"` when the field is
   absent or non-string). Grep verifies only BackgroundPicker, the
   MenuBar's File → Open, and the recents/drag-drop paths invoke
   `file/open`; only BackgroundPicker is touched.

2. **`lpstrDefExt` not set for texture pickers.** Risk: GetOpenFileName
   without `lpstrDefExt` might surprise users typing a bare filename.
   *Mitigation:* this is an *open* dialog (`OFN_FILEMUSTEXIST`),
   not a save dialog — `lpstrDefExt` only affects save dialogs per the
   Win32 OPENFILENAME docs. Existing `file/open` for `.alo` also doesn't
   set it. No-op.

3. **Test coverage gap for the dispatcher's filter switch.** Risk: the
   C++ filter switch could regress to `.alo` for skydome/ground.
   *Mitigation:* the modal can't be driven from Playwright (no DOM
   surface). Accept the gap; cover by (a) a vitest spec asserting the
   React side sends `filter: "skydome"` / `"ground"`, and (b) a manual
   smoke pass in the verification checklist below. The dispatcher
   change is small and code-review-grade.

4. **Stale comments still claim the work is deferred.** Risk: future
   contributors trust the header text and pursue a phantom fix.
   *Mitigation:* refresh both screens' header comments + the mock case
   comment in the same diff. Update HANDOFF.md to reflect D5 closure.

5. **MockBridge browser-mode UX change.** Risk: a dev clicking an empty
   Custom slot in browser mode now still sees nothing happen (mock
   returns ok:false). Previously: in BackgroundPicker, same. In
   GroundTexturePanel, an actual no-op. The new behaviour is "silently
   no-op in browser mode," which matches the existing Background flow.
   *Mitigation:* documented as intentional in the GroundTexturePanel
   header comment. Browser mode is not for end users.

---

## 5. Testing & verification

### Vitest (new specs target +4, taking 183 → 187)

**BackgroundPicker** (`web/apps/editor/src/screens/__tests__/BackgroundPicker.test.tsx`, new file):

- [ ] Clicking an empty Custom slot dispatches `file/open` with
      `params.filter === "skydome"`.
- [ ] When `file/open` resolves `{ ok: true, path: "C:/x.dds" }`, the
      handler dispatches `engine/set/skydome-custom-path` (with slot +
      path) then `engine/set/skydome-slot` (with slot), in order.
- [ ] When `file/open` resolves `{ ok: false, ... }`, the chain
      aborts — no follow-up dispatches.

**GroundTexturePanel** (extend
`web/apps/editor/src/screens/__tests__/GroundTexturePanel.test.tsx`):

- [ ] Clicking an empty Custom slot (e.g. slot 5) dispatches `file/open`
      with `params.filter === "ground"`.
- [ ] When `file/open` resolves with a path, the chain dispatches
      `engine/set/ground-slot-custom-path` then `engine/set/ground-texture`.

### Manual native smoke (post-build)

- [ ] `ParticleEditor.exe --new-ui`, open Background → click empty
      Custom slot. Dialog title reads "Open skydome texture", filter
      dropdown defaults to "Texture files (\*.dds;\*.tga)". Cancel.
- [ ] Pick a real `.dds` from `Data/Art/Skydomes/` or similar — verify
      the slot tile updates with the basename and the skydome renders.
- [ ] View → Ground Texture → click empty Custom slot. Dialog title
      reads "Open ground texture", same filter default.
- [ ] Pick a `.dds` — slot tile updates, ground plane renders with the
      texture.
- [ ] File → Open (menu or `Ctrl+O`) — dialog title still reads "Open
      particle system", filter defaults to "Alo files (\*.alo)".
      Regression check.

### Gate counts

- [ ] `pnpm build` clean (0 TS errors).
- [ ] Vitest **187 / 187**.
- [ ] `pnpm test:native` **77 / 77**.
- [ ] MSBuild Debug x64 clean (preexisting LIBCMTD warning OK).

### Debug instrumentation

None planned — the filter switch is small and easily code-reviewable.

---

## Implementation steps (mirrored in TaskList)

1. Schema: add `filter?` to `file/open`.
2. Dispatcher: parse `filter`, switch `lpstrFilter` + `lpstrTitle`.
3. BackgroundPicker: pass `filter: "skydome"`; refresh header comment.
4. GroundTexturePanel: wire chain; refresh header comment.
5. Mock + bridge-contract: refresh comment (no behaviour change).
6. New BackgroundPicker.test.tsx with 3 specs.
7. Extend GroundTexturePanel.test.tsx with 2 specs.
8. Verify gates (`pnpm build` → `pnpm test` → MSBuild → `pnpm test:native`).
9. CHANGELOG entry.
10. HANDOFF.md refresh (close out D5 from "What's left").
11. Commit.

---

## Review

**Shipped as designed.** Option A (parameterised filter) implemented in
~50 LOC delta across schema, dispatcher, two React panels, mock, and
two test files. All gates green:

- `pnpm build`: 0 TS errors, vite bundle rebuilt clean.
- Vitest: **188 / 188** (+5 from baseline 183 — plan target was 187 but
  BackgroundPicker landed 3 specs not 2; the third covers the
  cancel-path abort, which is worth keeping).
- MSBuild Debug x64: clean (preexisting LIBCMTD warning only).
- `pnpm test:native`: **77 / 77** (no regression).

### Surprises

1. **The handoff doc was stale about what D5 even was.** It described
   skydome Custom slots as "no-ops" — in reality they were chained but
   mis-filtered. The actual no-op surface was the ground-texture
   custom slots. Option A turned out to solve both surfaces with one
   schema delta. This is exactly the "trust but verify" pattern in
   CLAUDE.md — the code shape disagreed with the documentation.

2. **The post-pick `.alo` loader was load-bearing.** The first cut of
   the dispatcher edit only changed `lpstrFilter` / `lpstrTitle` and
   left the load chain intact, which would have routed picked `.dds`
   paths through `LoadParticleSystem` and surfaced "load failed."
   Caught mid-implementation via mental walk-through of the dispatcher
   case before testing. Fix: pull filter resolution above the
   `if (path.empty())` block, add a `if (filterId != "alo") { return
   path; }` gate immediately after the pick. The gate is defensive
   beyond the immediate need — it protects future callers that pass
   `path` + non-`"alo"` filter explicitly.

3. **Test count went +5, not +4 as planned.** The BackgroundPicker
   test added a third spec covering the cancellation path
   (`{ ok: false }` aborts the chain with no follow-ups). Worth
   keeping — symmetric with the resolved-path spec.

### Lessons logged

None new. L-006 (sticky optimistic state) wasn't relevant here. The
"verify dispatcher invariants before extending the schema" pattern is
already implicit in CLAUDE.md's pre-handoff walk-through discipline
and was caught by it.

### What's now possible

- File → Open still does the right thing (default `.alo` filter,
  loads and commits as the current file).
- Background panel custom slots open the texture picker with the
  right filter and chain through cleanly.
- Ground texture custom slots WORK for the first time (previously
  no-op).
- Future texture-pick surfaces (particle textures, decals, etc.) can
  add a new value to the `filter` enum without growing the bridge
  surface. The schema is genuinely extensible.

### Deferred (deliberately, no follow-up needed yet)

- Persisting last-used directory across pickers — small UX polish; ask
  if anyone trips over it.
- A separate `file/open-texture` primitive — re-evaluate only if
  skydome and ground filters need to diverge (e.g., skydome supports
  `.hdr`, ground supports `.png`).
- Force Align registry parity, D6 mods menu — separate items.

### Manual native smoke

Not yet run by Claude — the picker is a native modal that needs human
verification of the dialog title + default filter. Listed in the
testing checklist for the user to confirm on next launch.
