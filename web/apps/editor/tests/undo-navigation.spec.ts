// VPT-2 undo navigation contract specs.
//
// Regression coverage for the head-of-history auto-capture in
// BridgeDispatcher's `undo/perform`. The auto-cap exists because the
// new-UI captures undo snapshots PRE-mutation (legacy captured POST),
// so the live state sits one step ahead of the stack tip after a fresh
// edit and must be snapshotted before the first Undo() steps back.
//
// BUG (this spec): the auto-cap condition was `Cursor() == Depth()`,
// which is ALSO true immediately after a Redo() (redo to the tip leaves
// cursor == size). After a redo the live state is already in sync with
// the tip, so the auto-cap was spurious — it captured a duplicate and
// the following Undo() returned that duplicate, silently swallowing the
// undo. User-visible: undo → redo → undo loses the second undo.
//
// Talks to the host's real ParticleSystem + UndoStack via window.bridge
// (no mocks) over the --test-host CDP endpoint.

import { test, expect, chromium, type Page, type Browser } from "@playwright/test";

const CDP_ENDPOINT = process.env.CDP_ENDPOINT ?? "http://localhost:9222";

let browser: Browser;
let page: Page;

test.beforeAll(async () => {
  browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  const context = browser.contexts()[0];
  if (!context) throw new Error("CDP: no browser contexts attached");
  const pages = context.pages();
  // Pick the page that actually has window.bridge (skip DevTools targets).
  let found: Page | null = null;
  for (const p of pages) {
    try {
      if (await p.evaluate(() => typeof (window as { bridge?: unknown }).bridge !== "undefined")) {
        found = p;
        break;
      }
    } catch {
      /* page not evaluable (e.g. devtools) — skip */
    }
  }
  page = found ?? pages[0] ?? (await context.waitForEvent("page"));
  await page.waitForFunction(
    () => typeof (window as { bridge?: unknown }).bridge !== "undefined",
    null,
    { timeout: 15_000 },
  );
});

test.afterAll(async () => {
  await browser?.close();
});

// Property-edit coalescing is time-windowed (UndoStack COALESCE_WINDOW_MS =
// 1500ms). Wait out the window before each test so the first edit always
// starts a fresh undo entry rather than folding into a prior test's
// same-emitter edit — makes the time-dependent behaviour deterministic.
test.beforeEach(async () => {
  await page.waitForTimeout(1600);
});

// Bridge helpers — all run inside the page against the real host.
type BridgeReq = { kind: string; params: unknown };
async function req<T = unknown>(kind: string, params: unknown = {}): Promise<T> {
  return page.evaluate(
    ({ kind, params }: BridgeReq) =>
      (window as unknown as { bridge: { request: (r: BridgeReq) => Promise<unknown> } }).bridge.request({ kind, params }),
    { kind, params } as BridgeReq,
  ) as Promise<T>;
}
async function firstEmitterId(): Promise<number> {
  const list = await req<{ root: { children: { id: number }[] } }>("emitters/list");
  const id = list.root.children[0]?.id;
  if (id === undefined) throw new Error("no emitters in tree");
  return id;
}
async function getProps(id: number): Promise<{ lifetime: number; gravity: number }> {
  const r = await req<{ properties: { lifetime: number; gravity: number } }>(
    "emitters/get-properties",
    { id },
  );
  return r.properties;
}
async function getLifetime(id: number): Promise<number> {
  return (await getProps(id)).lifetime;
}
const setLifetime = (id: number, v: number) =>
  req("emitters/set-properties", { id, patch: { lifetime: v } });
const setProp = (id: number, patch: Record<string, number>) =>
  req("emitters/set-properties", { id, patch });
const undo = () => req<{ applied: boolean }>("undo/perform", { direction: "undo" });
const redo = () => req<{ applied: boolean }>("undo/perform", { direction: "redo" });

test("a single edit undoes and redoes (auto-cap round-trip)", async () => {
  const id = await firstEmitterId();
  await req("emitters/select", { id });
  const p0 = await getLifetime(id);
  const target = Number((p0 + 3).toFixed(3));

  await setLifetime(id, target);
  expect(await getLifetime(id)).toBeCloseTo(target, 4);

  await undo();
  expect(await getLifetime(id)).toBeCloseTo(p0, 4);

  await redo();
  expect(await getLifetime(id)).toBeCloseTo(target, 4);

  // restore
  await undo();
  expect(await getLifetime(id)).toBeCloseTo(p0, 4);
});

test("undo after a redo steps back to the pre-edit state (no spurious auto-cap)", async () => {
  const id = await firstEmitterId();
  await req("emitters/select", { id });
  const p0 = await getLifetime(id);
  const target = Number((p0 + 7).toFixed(3));

  await setLifetime(id, target); // edit
  await undo();                  // -> p0
  expect(await getLifetime(id)).toBeCloseTo(p0, 4);

  await redo();                  // -> target (cursor back at tip)
  expect(await getLifetime(id)).toBeCloseTo(target, 4);

  // THE REGRESSION: this undo must return to p0, not stay at target.
  await undo();
  expect(await getLifetime(id)).toBeCloseTo(p0, 4);
});

test("a full undo/redo/undo cycle is stable across repeats", async () => {
  const id = await firstEmitterId();
  await req("emitters/select", { id });
  const p0 = await getLifetime(id);
  const target = Number((p0 + 2).toFixed(3));

  await setLifetime(id, target);
  for (let i = 0; i < 3; i++) {
    await undo();
    expect(await getLifetime(id)).toBeCloseTo(p0, 4);
    await redo();
    expect(await getLifetime(id)).toBeCloseTo(target, 4);
  }
  // leave at the pre-edit value
  await undo();
  expect(await getLifetime(id)).toBeCloseTo(p0, 4);
});

test("a rapid burst of same-emitter edits coalesces into ONE undo step (wheel scroll)", async () => {
  const id = await firstEmitterId();
  await req("emitters/select", { id });
  const p0 = await getLifetime(id);

  // Simulate a scroll-wheel gesture: 4 rapid edits to the same field. Each is
  // a separate emitters/set-properties (one per wheel notch), all landing
  // inside the coalesce window.
  for (let i = 1; i <= 4; i++) await setLifetime(id, Number((p0 + i).toFixed(3)));
  expect(await getLifetime(id)).toBeCloseTo(p0 + 4, 4);

  // ONE undo must revert the WHOLE burst — not just the last tick.
  await undo();
  expect(await getLifetime(id)).toBeCloseTo(p0, 4);

  // ONE redo must reapply the whole burst.
  await redo();
  expect(await getLifetime(id)).toBeCloseTo(p0 + 4, 4);

  // restore
  await undo();
  expect(await getLifetime(id)).toBeCloseTo(p0, 4);
});

test("rapid edits to DIFFERENT fields are SEPARATE undo steps (per-field coalescing)", async () => {
  const id = await firstEmitterId();
  await req("emitters/select", { id });
  const { lifetime: lt0, gravity: gv0 } = await getProps(id);
  const lt1 = Number((lt0 + 3).toFixed(3));
  const gv1 = Number((gv0 + 2).toFixed(3));

  // Two rapid edits to DIFFERENT fields on the same emitter, within the
  // coalesce window. Per-FIELD coalescing keeps these as separate steps;
  // per-emitter coalescing (the prior behaviour) would fold them into one.
  await setProp(id, { lifetime: lt1 });
  await setProp(id, { gravity: gv1 });
  expect((await getProps(id)).lifetime).toBeCloseTo(lt1, 4);
  expect((await getProps(id)).gravity).toBeCloseTo(gv1, 4);

  // ONE undo reverts only the LAST field (gravity); lifetime is untouched.
  await undo();
  let p = await getProps(id);
  expect(p.gravity).toBeCloseTo(gv0, 4);
  expect(p.lifetime).toBeCloseTo(lt1, 4);

  // A SECOND undo reverts the earlier field (lifetime).
  await undo();
  p = await getProps(id);
  expect(p.lifetime).toBeCloseTo(lt0, 4);
  expect(p.gravity).toBeCloseTo(gv0, 4);
});

test("a same-field burst still coalesces under per-field keying", async () => {
  // The per-field key must stay stable across ticks of one field.
  const id = await firstEmitterId();
  await req("emitters/select", { id });
  const p0 = await getLifetime(id);
  for (let i = 1; i <= 3; i++) await setLifetime(id, Number((p0 + i).toFixed(3)));
  await undo();
  expect(await getLifetime(id)).toBeCloseTo(p0, 4); // one undo reverts all 3
});
