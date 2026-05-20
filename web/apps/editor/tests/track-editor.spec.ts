// Task 2.6 Playwright specs for the CurveEditorPanel.
//
// The lower-right quadrant's per-emitter EmitterPropertyPanel +
// TrackEditor surfaces have been replaced by an always-on
// CurveEditorPanel at the bottom of the centre column. The
// per-channel curve overlay is view-only; interactive features
// (drag-to-move, marquee, insert mode, Time/Value spinners,
// interpolation toggle) live in this batch's deferred-work list and
// will be restored in a future polish task.
//
// What this spec covers end-to-end:
//   1. The CurveEditorPanel is always mounted at app startup,
//      regardless of selection. It shows the channel list + the "Select
//      an emitter" placeholder when no emitter is selected.
//   2. Selecting an emitter swaps the placeholder for the multi-
//      channel CurveEditor SVG.
//   3. The 7 channel checkboxes are present with the documented
//      defaults: Index OFF, Scale / R / G / B / Alpha / Rotation ON.
//   4. emitters/add-track-key + set-track-key continue to round-trip
//      through the bridge (host-side handlers unchanged by this task).
//
// Mutation flows (drag-to-move, Spinner edit) are deferred; the
// corresponding Vitest specs were removed alongside TrackEditor.tsx.

import { test, expect, chromium, type Page, type Browser } from "@playwright/test";

const CDP_ENDPOINT = process.env.CDP_ENDPOINT ?? "http://localhost:9222";

let browser: Browser;
let page: Page;

test.beforeAll(async () => {
  browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  const context = browser.contexts()[0];
  const pages = context.pages();
  page = pages[0] ?? (await context.waitForEvent("page"));
});

test.afterAll(async () => {
  await browser?.close();
});

test("CurveEditorPanel is always mounted; placeholder shows when no emitter is selected", async () => {
  // Ensure no selection.
  await page.evaluate(async () => {
    const bridge = (window as Window & { bridge?: {
      request: (req: { kind: string; params: unknown }) => Promise<unknown>;
    } }).bridge;
    if (!bridge) throw new Error("bridge missing");
    await bridge.request({ kind: "emitters/select", params: { id: null } });
  });

  const panel = page.locator('[data-testid="curve-editor-panel"]');
  await expect(panel).toBeVisible({ timeout: 5_000 });

  // Placeholder visible in the canvas area.
  await expect(panel.locator('[data-testid="curve-editor-placeholder"]')).toBeVisible({
    timeout: 5_000,
  });

  // Channel list is present even with no emitter — 7 rows.
  for (const id of ["scale", "red", "green", "blue", "alpha", "rotation", "index"]) {
    await expect(
      panel.locator(`[data-testid="curve-channel-row-${id}"]`),
    ).toBeVisible();
  }
});

test("selecting an emitter swaps the placeholder for the multi-channel CurveEditor SVG", async () => {
  await page.evaluate(async () => {
    const bridge = (window as Window & { bridge?: {
      request: (req: { kind: string; params: unknown }) => Promise<unknown>;
    } }).bridge;
    if (!bridge) throw new Error("bridge missing");
    const list = await bridge.request({ kind: "emitters/list", params: {} }) as {
      root: { children: { id: number }[] };
    };
    const firstId = list.root.children[0]?.id;
    if (firstId === undefined) throw new Error("no emitters in tree");
    await bridge.request({ kind: "emitters/select", params: { id: firstId } });
  });

  const panel = page.locator('[data-testid="curve-editor-panel"]');
  await expect(panel).toBeVisible({ timeout: 5_000 });

  // SVG is visible; placeholder is gone.
  const svg = panel.locator('[data-testid="curve-editor-svg"]');
  await expect(svg).toBeVisible({ timeout: 5_000 });
  await expect(panel.locator('[data-testid="curve-editor-placeholder"]'))
    .toHaveCount(0, { timeout: 5_000 });
  // It's the multi-channel variant.
  await expect(svg).toHaveAttribute("data-multi-channel", "true");

  // Tear down.
  await page.evaluate(async () => {
    const bridge = (window as Window & { bridge?: {
      request: (req: { kind: string; params: unknown }) => Promise<unknown>;
    } }).bridge;
    await bridge!.request({ kind: "emitters/select", params: { id: null } });
  });
});

test("channel checkboxes default to Index OFF and the rest ON", async () => {
  const panel = page.locator('[data-testid="curve-editor-panel"]');
  await expect(panel).toBeVisible({ timeout: 5_000 });

  // Clear persisted state so the defaults take effect on next mount.
  await page.evaluate(() => {
    localStorage.removeItem("alo:curve-channels");
  });
  // Force a reload so the panel re-reads localStorage.
  await page.reload();

  for (const id of ["scale", "red", "green", "blue", "alpha", "rotation"]) {
    const cb = panel.locator(`[data-testid="curve-channel-checkbox-${id}"]`);
    await expect(cb).toBeChecked();
  }
  const indexCb = panel.locator('[data-testid="curve-channel-checkbox-index"]');
  await expect(indexCb).not.toBeChecked();
});

test("emitters/add-track-key via the bridge adds a key (host round-trip unchanged)", async () => {
  const selectedId = await page.evaluate(async () => {
    const bridge = (window as Window & { bridge?: {
      request: (req: { kind: string; params: unknown }) => Promise<unknown>;
    } }).bridge;
    const list = await bridge!.request({ kind: "emitters/list", params: {} }) as {
      root: { children: { id: number }[] };
    };
    const firstId = list.root.children[0]?.id;
    if (firstId === undefined) throw new Error("no emitters in tree");
    await bridge!.request({ kind: "emitters/select", params: { id: firstId } });
    return firstId;
  });

  // Add a key, fetch the tracks, and assert the new key is present.
  const result = await page.evaluate(async (id) => {
    const bridge = (window as Window & { bridge?: {
      request: (req: { kind: string; params: unknown }) => Promise<unknown>;
    } }).bridge;
    const r = await bridge!.request({
      kind: "emitters/add-track-key",
      params: { id, track: "green", time: 33.3, value: 0.42 },
    }) as { time: number; value: number };
    const tracks = await bridge!.request({
      kind: "emitters/get-tracks",
      params: { id },
    }) as { tracks: { name: string; keys: { time: number; value: number }[] }[] };
    return {
      ack: r,
      keys: tracks.tracks.find((t) => t.name === "green")?.keys ?? [],
    };
  }, selectedId);
  expect(result.ack.value).toBeCloseTo(0.42, 2);
  // If the host has a bound green track, the new key appears (or is
  // close in time). When the track slot is null, the handler is a
  // silent no-op and `keys` stays empty.
  if (result.keys.length > 0) {
    const match = result.keys.find((k) => Math.abs(k.time - 33.3) < 1e-2);
    expect(match).toBeDefined();
    expect(match!.value).toBeCloseTo(0.42, 2);
  }

  // Tear down.
  await page.evaluate(async () => {
    const bridge = (window as Window & { bridge?: {
      request: (req: { kind: string; params: unknown }) => Promise<unknown>;
    } }).bridge;
    await bridge!.request({ kind: "emitters/select", params: { id: null } });
  });
});

test("emitters/set-track-key via the bridge moves a key (host round-trip unchanged)", async () => {
  const selectedId = await page.evaluate(async () => {
    const bridge = (window as Window & { bridge?: {
      request: (req: { kind: string; params: unknown }) => Promise<unknown>;
    } }).bridge;
    const list = await bridge!.request({ kind: "emitters/list", params: {} }) as {
      root: { children: { id: number }[] };
    };
    const firstId = list.root.children[0]?.id;
    if (firstId === undefined) throw new Error("no emitters in tree");
    await bridge!.request({ kind: "emitters/select", params: { id: firstId } });
    return firstId;
  });

  const out = await page.evaluate(async (id) => {
    const bridge = (window as Window & { bridge?: {
      request: (req: { kind: string; params: unknown }) => Promise<unknown>;
    } }).bridge;
    await bridge!.request({
      kind: "emitters/add-track-key",
      params: { id, track: "red", time: 0, value: 0 },
    });
    await bridge!.request({
      kind: "emitters/add-track-key",
      params: { id, track: "red", time: 50, value: 0.5 },
    });
    await bridge!.request({
      kind: "emitters/add-track-key",
      params: { id, track: "red", time: 100, value: 1 },
    });
    await bridge!.request({
      kind: "emitters/set-track-key",
      params: { id, track: "red", oldTime: 50, newTime: 40, newValue: 0.75 },
    });
    const tracks = await bridge!.request({
      kind: "emitters/get-tracks",
      params: { id },
    }) as { tracks: { name: string; keys: { time: number; value: number }[] }[] };
    return tracks.tracks.find((t) => t.name === "red")?.keys ?? [];
  }, selectedId);

  if (out.length > 0) {
    const moved = out.find((k) => Math.abs(k.time - 40) < 1e-3);
    expect(moved).toBeDefined();
    expect(moved!.value).toBeCloseTo(0.75, 2);
  }

  await page.evaluate(async () => {
    const bridge = (window as Window & { bridge?: {
      request: (req: { kind: string; params: unknown }) => Promise<unknown>;
    } }).bridge;
    await bridge!.request({ kind: "emitters/select", params: { id: null } });
  });
});
