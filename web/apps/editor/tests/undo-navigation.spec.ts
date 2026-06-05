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
async function getLifetime(id: number): Promise<number> {
  const r = await req<{ properties: { lifetime: number } }>("emitters/get-properties", { id });
  return r.properties.lifetime;
}
const setLifetime = (id: number, v: number) =>
  req("emitters/set-properties", { id, patch: { lifetime: v } });
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
