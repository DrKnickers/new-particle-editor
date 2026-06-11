# Curve Lock — Airtight Read-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **L-081 applies:** one tree-touching agent at a time in this worktree; reviewers are read-and-run-tests only.

**Goal:** Make a curve channel locked to another channel (Green/Blue → Red) genuinely read-only — closing every mutation path (drag, insert, Delete key, spinners, context menu, cut) — and render it as a dashed line in its own colour with hollow markers plus a toolbar lock glyph.

**Architecture:** The lock stays a host-side pointer alias (live one-way mirror). All enforcement is web-side: the panel withholds the renderer's interactive handlers and guards every commit-site handler on `focusLocked`; the renderer derives `focusReadOnly` from the focus track's `lockedTo` DTO field and renders the dashed/hollow treatment + inert gesture machinery. The mock bridge gains derive-at-read lock views so master edits mirror to followers exactly like the native alias.

**Tech Stack:** React 18 + TypeScript (Vitest + Testing Library), SVG renderer, Zustand mock overlay. No native/C++ change, no bridge-schema change.

**Spec:** [`docs/superpowers/specs/2026-06-10-curve-lock-readonly-design.md`](../specs/2026-06-10-curve-lock-readonly-design.md)

**Verified code facts this plan rests on** (re-verify if the tree has moved):
- `focusLocked` is declared at `CurveEditorPanel.tsx:1076` — AFTER `handleDelete` (:763) and the spinner handlers (:946, :987). Tasks 2–3 must **move the declaration up** before first use.
- `handleCutKeys` (:1107) routes through `handleDelete`, so the cut leg is covered by the `handleDelete` guard — no separate cut guard needed.
- The multi-channel focus layer's border keys already render plain (the slate/sky anchor styling was removed; comment at `CurveEditor.tsx:1861-1868`) — the hollow treatment applies uniformly, nothing special for borders.
- The renderer's `startDrag` / marquee machinery runs even with no commit handlers wired (it would show a drag preview that snaps back, and a marquee rectangle that selects nothing) — Task 1 adds renderer-side gates so locked gestures are inert, not just uncommitted.
- Mock: `setTrackLockInOverlay` (mock-state.ts:1234) copies master keys at lock time only; the four track mutators don't re-mirror followers. Task 6 replaces copy-at-lock with derive-at-read (`get-tracks` choke point at mock.ts:776). No existing test pins the old behavior (verified by grep).
- Panel tests use a **stub bridge** (`makeStubBridge` + `fixtureTracks()` in CurveEditorPanel.test.tsx) — `lockedTo` is controlled per-test via the fixture; the mid-test refetch trick is `bridge` re-resolving `emitters/get-tracks` with a new fixture + firing the captured `emitters/selected` listener.

---

### Task 1: Renderer — `focusReadOnly` treatment + inert gestures

**Files:**
- Modify: `web/apps/editor/src/screens/CurveEditor.tsx` (MultiChannelCurves only; single-track branch untouched)
- Test: `web/apps/editor/src/screens/__tests__/CurveEditor.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `CurveEditor.test.tsx` (reuse the file's existing multi-channel render helpers/fixtures; the key change is `lockedTo: "red"` on the green track):

```tsx
describe("locked focus channel (read-only mirror)", () => {
  const lockedTracks: TrackDto[] = [
    { name: "red",   keys: [{ time: 0, value: 0 }, { time: 50, value: 0.5 }, { time: 100, value: 1 }], interpolation: "linear", lockedTo: null },
    { name: "green", keys: [{ time: 0, value: 0 }, { time: 50, value: 0.5 }, { time: 100, value: 1 }], interpolation: "linear", lockedTo: "red" },
  ];
  const channels: ChannelDef[] = [
    { id: "red",   label: "Red",   color: "#e2504a", defaultOn: true, trackName: "red" },
    { id: "green", label: "Green", color: "#7bc043", defaultOn: true, trackName: "green" },
  ];
  const visible = { red: true, green: true };

  it("renders the locked focus curve dashed with hollow markers and data-readonly", () => {
    render(
      <CurveEditor tracks={lockedTracks} channels={channels} visibleChannels={visible}
        focusChannel="green" width={600} height={300} />,
    );
    const layer = document.querySelector('[data-channel-id="green"][data-focus="true"]')!;
    expect(layer.getAttribute("data-readonly")).toBe("true");
    const line = layer.querySelector('[data-testid="curve-polyline"]')!;
    expect(line.getAttribute("stroke-dasharray")).toBe("7 5");
    const marker = layer.querySelector(".curve-key-marker")!;
    expect(marker.getAttribute("fill")).toBe("none");
    expect(marker.getAttribute("stroke")).toBe("#7bc043");
  });

  it("renders an unlocked focus curve solid with filled markers", () => {
    const unlocked = lockedTracks.map((t) => ({ ...t, lockedTo: null }));
    render(
      <CurveEditor tracks={unlocked} channels={channels} visibleChannels={visible}
        focusChannel="green" width={600} height={300} />,
    );
    const layer = document.querySelector('[data-channel-id="green"][data-focus="true"]')!;
    expect(layer.getAttribute("data-readonly")).toBe("false");
    const line = layer.querySelector('[data-testid="curve-polyline"]')!;
    expect(line.getAttribute("stroke-dasharray")).toBeNull();
    const marker = layer.querySelector(".curve-key-marker")!;
    expect(marker.getAttribute("fill")).toBe("#7bc043");
  });

  it("does not start a drag on a locked focus key (no preview, no drag-end)", () => {
    const onKeyDragEnd = vi.fn();
    const onKeyDragStart = vi.fn();
    render(
      <CurveEditor tracks={lockedTracks} channels={channels} visibleChannels={visible}
        focusChannel="green" width={600} height={300}
        onKeyDragStart={onKeyDragStart} onKeyDragEnd={onKeyDragEnd} />,
    );
    const pad = document.querySelector('[data-testid="curve-key"][data-key-time="50"]')!;
    const svg = document.querySelector('[data-testid="curve-editor-svg"]')!;
    fireEvent.pointerDown(pad, { button: 0, pointerId: 1, clientX: 300, clientY: 150 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 340, clientY: 100 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 340, clientY: 100 });
    expect(onKeyDragStart).not.toHaveBeenCalled();
    expect(onKeyDragEnd).not.toHaveBeenCalled();
  });

  it("does not start a marquee on a locked focus canvas (and click-to-clear still fires)", () => {
    const onCanvasMarqueeSelect = vi.fn();
    const onCanvasClick = vi.fn();
    render(
      <CurveEditor tracks={lockedTracks} channels={channels} visibleChannels={visible}
        focusChannel="green" width={600} height={300}
        onCanvasMarqueeSelect={onCanvasMarqueeSelect} onCanvasClick={onCanvasClick} />,
    );
    const backdrop = document.querySelector('[data-testid="curve-canvas-backdrop"]')!;
    const svg = document.querySelector('[data-testid="curve-editor-svg"]')!;
    fireEvent.pointerDown(backdrop, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 250, clientY: 200 });
    expect(document.querySelector('[data-testid="curve-marquee"]')).toBeNull();
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 250, clientY: 200 });
    expect(onCanvasMarqueeSelect).not.toHaveBeenCalled();
    fireEvent.click(backdrop);
    expect(onCanvasClick).toHaveBeenCalled();
  });
});
```

Note: jsdom lacks `getBoundingClientRect` sizing — the file's existing pointer tests already handle this (measurement falls back to the 600×300 props). Match whatever event-coordinate idiom the existing drag specs in this file use.

- [ ] **Step 2: Run to verify the new tests fail**

Run from `web/`: `pnpm --filter @particle-editor/editor test -- --run CurveEditor.test`
Expected: the 4 new tests FAIL (`data-readonly` null, no dasharray, drag/marquee still active).

- [ ] **Step 3: Implement in `MultiChannelCurves`**

(a) Derive the flag right after `focusLayer` (CurveEditor.tsx ~:1191):

```tsx
const focusEnabled = focusLayer !== null;
// Read-only mirror: the focus channel is locked to another channel.
// Derived from the DTO (lockedTo) — no prop threaded from the panel.
const focusReadOnly = focusLayer !== null && focusLayer.track.lockedTo != null;
```

(b) Gate `startDrag` (first line of the multi-channel `startDrag`):

```tsx
if (focusReadOnly) return;
```

(c) Gate the marquee start in `onCanvasPointerDown`'s Select branch (after the `insertMode` branch, before `setPointerCapture`/`setMarquee`):

```tsx
// Read-only mirror: no marquee — selection is meaningless and is the
// gateway to Delete/spinner edits. Plain clicks still reach the
// backdrop's onClick → onCanvasClick (clear-selection UX preserved).
if (focusReadOnly) return;
```

(d) Gate the imperative gutter handle — in the `useImperativeHandle` for `marqueeRef`, first line of `startMarquee`: `if (focusReadOnly) return;`

(e) Focus-layer `<g>` gains `data-readonly={focusReadOnly ? "true" : "false"}`.

(f) The three focus stroke elements (`curve-path` smooth, `curve-polyline` step, `curve-polyline` linear) gain:

```tsx
strokeDasharray={focusReadOnly ? "7 5" : undefined}
```

(g) The visible marker circle (the `.curve-key-marker` in the (hit-pad, visible) pair) becomes hollow when read-only:

```tsx
fill={focusReadOnly ? "none" : fill}
stroke={focusReadOnly ? channel.color : stroke}
strokeWidth={focusReadOnly ? 2 : strokeWidth}
```

The gradient `curve-fill` under the curve stays unchanged (still part of "emphasized"). The hit-pad circles stay rendered (their handlers are inert via (b) and the panel's handler omission in Task 2).

- [ ] **Step 4: Run the file's full spec**

Run: `pnpm --filter @particle-editor/editor test -- --run CurveEditor.test`
Expected: ALL pass (new 4 + zero regressions in the existing drag/marquee specs — they run unlocked fixtures).

- [ ] **Step 5: Commit**

```bash
git add web/apps/editor/src/screens/CurveEditor.tsx web/apps/editor/src/screens/__tests__/CurveEditor.test.tsx
git commit -m "feat(curve-lock): dashed/hollow read-only treatment + inert gestures on locked focus channel"
```

---

### Task 2: Panel — withhold interactive handlers + gate the gutter marquee

**Files:**
- Modify: `web/apps/editor/src/components/CurveEditorPanel.tsx:1493-1525` (CurveEditor render), `:1486-1490` (gutter), `:1076` (move `focusLocked` up)
- Test: `web/apps/editor/src/components/__tests__/CurveEditorPanel.test.tsx`

- [ ] **Step 1: Move `focusLocked` up.** Cut the declaration at :1076 (`const focusLocked = focusedTrack !== null && focusedTrack.lockedTo !== null;`) and paste it immediately after `focusedTrack` is computed (before `handleKeyDragEnd` at ~:674) — Tasks 2–3 reference it from handlers declared earlier in the body. Run `pnpm --filter @particle-editor/editor exec tsc -b` to confirm no TDZ/use-before-declare error.

- [ ] **Step 2: Write the failing tests**

```tsx
function lockedFixtureTracks(): TrackDto[] {
  // Green locked to red; both share identical keys (mirror semantics).
  return fixtureTracks().map((t) =>
    t.name === "green" ? { ...t, lockedTo: "red" as const } : t,
  );
}

describe("locked focus channel — panel gating", () => {
  it("commits no mutating track command from drag, insert-click, or marquee on a locked focus", async () => {
    const { bridge } = makeStubBridge(1);
    (bridge.request as ReturnType<typeof vi.fn>).mockImplementation((req: { kind: string }) => {
      if (req.kind === "engine/state/snapshot")
        return Promise.resolve({ ...makeDefaultEngineState(), selectedEmitterId: 1 });
      if (req.kind === "emitters/get-tracks")
        return Promise.resolve({ tracks: lockedFixtureTracks() });
      return Promise.resolve({});
    });
    render(<CurveEditorPanel bridge={bridge} />);
    // Focus green (the locked channel).
    fireEvent.click(await screen.findByTestId("ce-channel-row-green"));
    await waitFor(() => {
      expect(document.querySelector('[data-channel-id="green"][data-focus="true"]')).not.toBeNull();
    });
    const svg = document.querySelector('[data-testid="curve-editor-svg"]')!;
    const pad = document.querySelector('[data-testid="curve-key"][data-key-time="0"]')!;
    // Drag attempt.
    fireEvent.pointerDown(pad, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 60, clientY: 60 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 60, clientY: 60 });
    // Context-menu attempt: no menu mounts.
    fireEvent.contextMenu(pad);
    expect(screen.queryByTestId("ce-key-context-menu-delete")).toBeNull();
    const mutating = (bridge.request as ReturnType<typeof vi.fn>).mock.calls
      .map(([r]: [{ kind: string }]) => r.kind)
      .filter((k: string) =>
        ["emitters/set-track-key", "emitters/add-track-key", "emitters/delete-track-keys"].includes(k));
    expect(mutating).toEqual([]);
  });
});
```

(Adapt `ce-channel-row-green` to the panel's real channel-row testid — check the file's existing focus-switch tests for the exact query; everything else is exact.)

- [ ] **Step 3: Run to verify the gating test fails** (context menu currently mounts; drags currently commit when fixture allows movement). `pnpm --filter @particle-editor/editor test -- --run CurveEditorPanel.test`

- [ ] **Step 4: Implement the handler gate**

Just above the `return (` of the panel component, build the conditional prop set:

```tsx
// Read-only mirror (spec §2.1): a locked focus channel gets NO
// interactive handlers — drag, insert, key-click, marquee, and the
// key context menu are all selection/mutation gateways. onCanvasClick
// and onCanvasContextMenu stay wired (clear-selection / mode-drop UX).
const interactiveHandlers = focusLocked
  ? {}
  : {
      onKeyClick: handleKeyClick,
      insertMode: mode === "insert",
      onCanvasAdd: handleCanvasAdd,
      onKeyContextMenu: (time: number, isBorder: boolean, x: number, y: number) =>
        setKeyContextMenu({ time, isBorder, x, y }),
      onKeyDragEnd: handleKeyDragEnd,
      onKeyDragStart: handleKeyDragStart,
      onKeyDragMove: handleKeyDragMove,
      onKeyDragCancel: handleKeyDragCancel,
      onGroupDragEnd: handleGroupDragEnd,
      onCanvasMarqueeSelect: handleCanvasMarqueeSelect,
    };
```

In the `<CurveEditor>` element (:1493-1525): delete those ten props from the JSX and spread `{...interactiveHandlers}` instead, keeping `marqueeRef`, `tracks`, `channels`, `visibleChannels`, `focusChannel`, `valueRange`, `selectedKeyTimes`, `onCanvasClick`, `onCanvasContextMenu` as-is. (`insertMode` omitted ⇒ `undefined` ⇒ falsy — equivalent to `insertMode={false}`.)

Gutter (:1488): `if (mode === "select" && !focusLocked) { curveRef.current?.startMarquee(...); }`

- [ ] **Step 5: Run the panel spec** — the Step-2 test passes; existing specs (which run unlocked fixtures) stay green.

- [ ] **Step 6: Commit**

```bash
git add web/apps/editor/src/components/CurveEditorPanel.tsx web/apps/editor/src/components/__tests__/CurveEditorPanel.test.tsx
git commit -m "fix(curve-lock): withhold interactive handlers + gutter marquee on a locked focus channel"
```

---

### Task 3: Panel — commit-site guards (Delete, spinners) incl. the mid-gesture lock race

**Files:**
- Modify: `web/apps/editor/src/components/CurveEditorPanel.tsx:763` (handleDelete), `:936` (spinnersDisabled), `:946` + `:987` (spinner handlers)
- Test: `web/apps/editor/src/components/__tests__/CurveEditorPanel.test.tsx`

- [ ] **Step 1: Write the failing race test** — selection established while unlocked, lock lands via refetch, Delete/spinner refuse:

```tsx
it("refuses Delete and spinner commits when the lock lands under an existing selection (risk-2 race)", async () => {
  const { bridge } = makeStubBridge(1);
  let tracks = fixtureTracks(); // green UNLOCKED initially
  const selectedListeners: SelectionListener[] = [];
  (bridge.request as ReturnType<typeof vi.fn>).mockImplementation((req: { kind: string }) => {
    if (req.kind === "engine/state/snapshot")
      return Promise.resolve({ ...makeDefaultEngineState(), selectedEmitterId: 1 });
    if (req.kind === "emitters/get-tracks") return Promise.resolve({ tracks });
    return Promise.resolve({});
  });
  (bridge.on as ReturnType<typeof vi.fn>).mockImplementation(
    (kind: string, h: SelectionListener) => {
      if (kind === "emitters/selected") selectedListeners.push(h);
      return () => {};
    });
  render(<CurveEditorPanel bridge={bridge} />);
  fireEvent.click(await screen.findByTestId("ce-channel-row-green"));
  // Select a key while unlocked (interior key if the fixture has one;
  // border keys still select — Delete filters them, so use the spinner
  // VALUE path for the assertion if only borders exist).
  const pad = await waitFor(() =>
    document.querySelector('[data-testid="curve-key"][data-key-time="0"]')!);
  fireEvent.click(pad);
  // Lock lands "underneath": flip the fixture, force a refetch.
  tracks = lockedFixtureTracks();
  selectedListeners.forEach((h) => h({ payload: { id: 1 } }));
  await waitFor(() => {
    expect(screen.getByTestId("ce-lock-to-trigger").getAttribute("data-locked")).toBe("true");
  });
  (bridge.request as ReturnType<typeof vi.fn>).mockClear();
  // Delete keydown refuses.
  fireEvent.keyDown(window, { key: "Delete" });
  // Spinner commit refuses (fire the value spinner's commit input).
  // Use the file's existing spinner-edit idiom for this dispatch.
  const mutating = (bridge.request as ReturnType<typeof vi.fn>).mock.calls
    .map(([r]: [{ kind: string }]) => r.kind)
    .filter((k: string) => ["emitters/set-track-key", "emitters/delete-track-keys"].includes(k));
  expect(mutating).toEqual([]);
});
```

(The spinner-commit dispatch must reuse the file's existing spinner test idiom — find the spec that edits the Value spinner and copy its fire pattern.)

- [ ] **Step 2: Run to verify it fails** — `handleDelete` currently fires `delete-track-keys`.

- [ ] **Step 3: Implement the guards**

`handleDelete` (:763): first line `if (selectedId === null) return;` → `if (selectedId === null || focusLocked) return;` + add `focusLocked` to its dep array. (Covers: window Delete keydown, context-menu Delete, toolbar button belt-and-braces, and `handleCutKeys`' delete leg.)

`spinnersDisabled` (:936): append `|| focusLocked`.

`handleTimeSpinner` (:946): `if (selectedId === null || focusedTrack === null) return;` → append `|| focusLocked`; add to deps.
`handleValueSpinner` (:987): `if (selectedId === null) return;` → append `|| focusLocked`; add to deps.

- [ ] **Step 4: Run the panel spec** — race test green, no regressions.

- [ ] **Step 5: Commit**

```bash
git add web/apps/editor/src/components/CurveEditorPanel.tsx web/apps/editor/src/components/__tests__/CurveEditorPanel.test.tsx
git commit -m "fix(curve-lock): commit-site focusLocked guards (Delete, spinners) close the mid-gesture lock race"
```

---

### Task 4: Panel — mode reset + tool toggle disable

**Files:**
- Modify: `web/apps/editor/src/components/CurveEditorPanel.tsx:408` (mode state, add effect nearby), `:1196-1232` (tool buttons)
- Test: `web/apps/editor/src/components/__tests__/CurveEditorPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("forces Insert mode back to Select when the focus channel is locked, and disables the toggle", async () => {
  // Same flip-the-fixture setup as the risk-2 race test (reuse the helper
  // if Step 1 of Task 3 extracted one).
  // 1. Focus green unlocked → click ce-tool-insert → expect data-state "on".
  // 2. Flip fixture to lockedFixtureTracks() + fire the selected listener.
  // 3. await: Insert button has data-state "off" AND disabled; Select button disabled.
  // 4. Canvas pointer-down commits no emitters/add-track-key.
});
```

Write it concretely with the Task-3 setup (it's the same scaffold; extract a `renderLockedAfterSelection()` helper in the test file if both tests share >10 lines).

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

Effect (next to the `mode` state at :408):

```tsx
// Read-only mirror: never leave Insert active on a locked focus —
// covers lock-while-insert AND focus-switch-onto-locked (spec §3.3).
useEffect(() => {
  if (focusLocked && mode === "insert") setMode("select");
}, [focusLocked, mode]);
```

Both tool buttons (:1200, :1217): add `disabled={focusLocked}` and append `disabled:cursor-not-allowed disabled:opacity-40` to BOTH className branches of each button.

- [ ] **Step 4: Run the panel spec.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/apps/editor/src/components/CurveEditorPanel.tsx web/apps/editor/src/components/__tests__/CurveEditorPanel.test.tsx
git commit -m "feat(curve-lock): Select/Insert toggle disables + mode resets to Select on a locked focus"
```

---

### Task 5: Panel — lock glyph + Tip

**Files:**
- Modify: `web/apps/editor/src/components/CurveEditorPanel.tsx` (toolbar, after the Lock-to `Select.Root` closes ~:1310)
- Test: `web/apps/editor/src/components/__tests__/CurveEditorPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("shows the lock glyph with master-naming aria-label only while locked", async () => {
  // Locked fixture from the start (lockedFixtureTracks), focus green.
  // expect(screen.getByTestId("ce-lock-glyph").getAttribute("aria-label"))
  //   .toBe("Green is locked to Red — read-only");
  // Unlocked fixture render: expect(screen.queryByTestId("ce-lock-glyph")).toBeNull();
});
```

Write both halves concretely with the existing render scaffolds.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — insert after the Lock-to `Select.Root` close:

```tsx
{focusLocked && (
  <Tip
    content={`${focusedChannel.label} is locked to ${lockToValue} and shows ${lockToValue}'s curve. Unlock to edit.`}
    occlusionId="tip:curve:lock"
  >
    <span
      data-testid="ce-lock-glyph"
      role="img"
      aria-label={`${focusedChannel.label} is locked to ${lockToValue} — read-only`}
      className="inline-flex h-6 items-center text-accent"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    </span>
  </Tip>
)}
```

(`Tip` is already imported at :55; `focusedChannel.label` and `lockToValue` already exist. If the toolbar uses a different inline-SVG icon idiom, match it — the padlock path above is the fallback.)

- [ ] **Step 4: Run the panel spec.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/apps/editor/src/components/CurveEditorPanel.tsx web/apps/editor/src/components/__tests__/CurveEditorPanel.test.tsx
git commit -m "feat(curve-lock): toolbar lock glyph + tooltip names the master channel"
```

---

### Task 6: Mock parity — derive lock views at read time

**Files:**
- Modify: `web/apps/editor/src/bridge/mock-state.ts:1234-1284` (setTrackLockInOverlay), new export `deriveLockViews`
- Modify: `web/apps/editor/src/bridge/mock.ts:776` (get-tracks)
- Test: `web/apps/editor/src/bridge/__tests__/bridge-contract.test.ts`

Why: native lock is a pointer alias, so master edits are instantly visible through followers and unlock restores the follower's preserved curve. The mock copies keys once at lock time — master edits don't re-mirror, unlock keeps the master's copy, and chained locks (Blue→Green while Green→Red) mirror the wrong content. Derive-at-read fixes all three with one mechanism: the overlay keeps each channel's CANONICAL keys; the read boundary presents the master's canonical keys for locked channels.

- [ ] **Step 1: Write the failing contract tests**

```ts
describe("emitters/set-track-lock — read aliasing (native parity)", () => {
  it("mirrors master edits to the locked follower at read time", async () => {
    const bridge = makeMockBridge(); // the file's existing factory
    await bridge.request({ kind: "emitters/set-track-lock",
      params: { id: 1, channel: "green", lockTo: "red" } });
    await bridge.request({ kind: "emitters/add-track-key",
      params: { id: 1, track: "red", time: 42, value: 0.42 } });
    const { tracks } = await bridge.request({ kind: "emitters/get-tracks", params: { id: 1 } });
    const red = tracks.find((t: TrackDto) => t.name === "red")!;
    const green = tracks.find((t: TrackDto) => t.name === "green")!;
    expect(green.lockedTo).toBe("red");
    expect(green.keys).toEqual(red.keys);
    expect(green.keys.some((k: { time: number }) => k.time === 42)).toBe(true);
  });

  it("restores the follower's own curve on unlock", async () => {
    const bridge = makeMockBridge();
    const before = await bridge.request({ kind: "emitters/get-tracks", params: { id: 1 } });
    const greenBefore = before.tracks.find((t: TrackDto) => t.name === "green")!.keys;
    await bridge.request({ kind: "emitters/set-track-lock",
      params: { id: 1, channel: "green", lockTo: "red" } });
    await bridge.request({ kind: "emitters/set-track-lock",
      params: { id: 1, channel: "green", lockTo: null } });
    const after = await bridge.request({ kind: "emitters/get-tracks", params: { id: 1 } });
    expect(after.tracks.find((t: TrackDto) => t.name === "green")!.keys).toEqual(greenBefore);
  });

  it("chained lock presents the intermediate channel's CANONICAL keys (native trackContents semantics)", async () => {
    const bridge = makeMockBridge();
    await bridge.request({ kind: "emitters/set-track-lock",
      params: { id: 1, channel: "green", lockTo: "red" } });
    await bridge.request({ kind: "emitters/set-track-lock",
      params: { id: 1, channel: "blue", lockTo: "green" } });
    const { tracks } = await bridge.request({ kind: "emitters/get-tracks", params: { id: 1 } });
    const blue = tracks.find((t: TrackDto) => t.name === "blue")!;
    // Native: tracks[blue] = &trackContents[green] — green's PRESERVED
    // content, not the red mirror green currently displays.
    const greenCanonicalFixture = /* the fixture's unlocked green keys —
      derive from a fresh mock's get-tracks before any lock */ null!;
    expect(blue.keys).toEqual(greenCanonicalFixture);
  });
});
```

(Fill `greenCanonicalFixture` by capturing green's keys from a pre-lock `get-tracks` in the test body. Match the file's existing mock-factory + reset-between-tests idiom — check its `beforeEach`.)

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @particle-editor/editor test -- --run bridge-contract`. Expected: mirror-after-edit FAILS (stale copy), unlock-restore FAILS (keeps mirror).

- [ ] **Step 3: Implement**

mock-state.ts — `setTrackLockInOverlay` lock branch stops copying; both branches collapse to a `lockedTo`-only write:

```ts
// Lock/unlock writes ONLY the lockedTo field. The channel's canonical
// keys are preserved either way; the mirrored VIEW is derived at the
// get-tracks read boundary (deriveLockViews) — matching the native
// pointer-alias semantics: master edits are instantly visible through
// followers, unlock restores the preserved canonical curve, and a
// chained lock presents the intermediate channel's canonical content.
nextTracks = cur.map((t, i) =>
  i === channelIdx ? { ...t, lockedTo: resolvedLockTo } : t,
);
```

(Delete the old lock-branch copy + its comment; `resolvedLockTo` computation stays.)

New export beside it:

```ts
/** Present locked channels as views of their master's CANONICAL
 *  content — the mock equivalent of the native pointer alias
 *  (tracks[i] = &trackContents[j]). Pure; applied at the get-tracks
 *  read boundary ONLY. Mutators must keep operating on canonical
 *  overlay data — deriving inside read() would bake mirrors into
 *  canonical on the next read-modify-write. */
export function deriveLockViews(tracks: TrackDto[]): TrackDto[] {
  return tracks.map((t, i) => {
    if (i >= 4 || t.lockedTo == null) return t;
    const src = tracks.find((s) => s.name === t.lockedTo);
    if (src === undefined) return t;
    return {
      ...t,
      keys: src.keys.map((k) => ({ ...k })),
      interpolation: src.interpolation,
    };
  });
}
```

mock.ts:776:

```ts
return { tracks: deriveLockViews(useMockTrackOverlay.getState().read(node.id)) };
```

(+ add `deriveLockViews` to the existing mock-state import.)

- [ ] **Step 4: Run bridge-contract + the full web suite** — the three new tests pass; nothing else regresses (no existing test pins copy-at-lock, verified at plan time).

- [ ] **Step 5: Commit**

```bash
git add web/apps/editor/src/bridge/mock-state.ts web/apps/editor/src/bridge/mock.ts web/apps/editor/src/bridge/__tests__/bridge-contract.test.ts
git commit -m "fix(mock): derive lock views at read time — master edits mirror, unlock restores, chains match native"
```

---

### Task 7: CHANGELOG + full gates

**Files:**
- Modify: `CHANGELOG.md` (new entry at the top of `## Changelog`)
- No code changes — verification only.

- [ ] **Step 1: CHANGELOG entry** per the repo's three-section format (What ships / How we tackled it / Issues encountered), title ~"Locked curve channels are now genuinely read-only (dashed mirror treatment)". Date line: `*2026-06-10 · TODO-hash · TODO-PR*` (backfill after merge, the #27 pattern). Cover: the marquee→Delete/spinner gateway discovery, the commit-site-guard posture (mid-gesture lock race), derive-at-read mock parity, dashed/hollow + glyph treatment. End with `---`.

- [ ] **Step 2: Full gates** (capture exit codes explicitly — L-080: never gate on a piped tail):

```
cd web && pnpm --filter @particle-editor/editor test   # expect 700 + ~12 new, 0 fail
pnpm -w exec tsc -b                                     # expect exit 0
pnpm --filter @particle-editor/editor build             # vite clean
```

Native harness + host Debug x64 (fresh-worktree: L-039 NuGet materialise + L-040 `pnpm build` first; MSBuild VS18 per L-046): expect 180/0 and a clean build. No a11y golden drift expected — the toolbar changes (glyph, disabled attrs) only manifest when a track is locked, and no a11y spec locks tracks; if a golden DOES drift, regenerate from the FULL suite only (L-081) and hand-review.

- [ ] **Step 3: Commit CHANGELOG**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): locked-curve read-only entry (TODO hash backfill)"
```

- [ ] **Step 4: PR** — `gh pr create` against `master` per the standard flow; merge only on explicit user OK, AFTER the user's feel pass (next step).

**User feel pass (L-033 — user-launched, before merge):** lock Green→Red and Blue→Red in the real host; try to drag / insert / marquee / Delete / spinner-edit the locked curves (all refuse); dashed-over-dimmed-red + hollow markers + glyph read clearly in both themes; editing Red carries the followers live; unlock restores solid line + filled markers + tools.

---

## Self-review notes (done at plan time)

- **Spec coverage:** §2.1 → Task 2; §2.1b → Task 3 (cut covered via handleDelete); §2.2 → Task 4; §2.3 → Task 5; §2.4 → Task 1; §4 mock-parity check → executed at plan time, gap CONFIRMED → Task 6; §4 suites/feel → Task 7. Renderer gesture gates (Task 1 b–d) slightly exceed the spec's "render treatment only" renderer scope — required so locked gestures are inert rather than preview-then-snap-back; flagged to the user in the plan summary.
- **Border keys:** spec's "border keys included" is automatically satisfied — focus-mode anchor styling no longer exists (CurveEditor.tsx:1861-1868).
- **Type consistency:** `focusReadOnly` (renderer-internal), `focusLocked` (panel), `deriveLockViews` (mock) — names used consistently across tasks; `interactiveHandlers` only in Task 2.
- **Known soft spots for the executor:** exact channel-row testid (Task 2 Step 2), the spinner-commit fire idiom (Task 3 Step 1), the mock factory/reset idiom (Task 6 Step 1) — each says where to copy the existing pattern from.
