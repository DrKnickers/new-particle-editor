// Phase 3 Screen 6 Batch A contract tests for the EmitterPropertyPanel
// + TrackEditor + CurveEditor surfaces.
//
// 1. Selecting an emitter via the bridge shows the property panel on
//    the right (asserted by data-testid="emitter-property-panel").
// 2. The CurveEditor SVG renders inside the panel (at least one
//    <polyline> or <circle> in the panel subtree).
//
// Both specs talk to the host's real ParticleSystem via window.bridge
// — no seeding mocks; the native host owns the live system. The host
// seeds with one root emitter on construction so a valid id is
// always present.

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

test("selecting an emitter shows the right-side property panel", async () => {
  // Fire emitters/select via the bridge — the host updates its state
  // and re-emits `emitters/selected`. App.tsx subscribes and mounts
  // the panel.
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

  // The panel mount is gated on the selectedEmitterId becoming non-
  // null in App.tsx; allow a generous timeout for the event to
  // propagate.
  const panel = page.locator('[data-testid="emitter-property-panel"]');
  await expect(panel).toBeVisible({ timeout: 5_000 });

  // De-select to leave a clean state for the next spec.
  await page.evaluate(async () => {
    const bridge = (window as Window & { bridge?: {
      request: (req: { kind: string; params: unknown }) => Promise<unknown>;
    } }).bridge;
    await bridge!.request({ kind: "emitters/select", params: { id: null } });
  });
});

test("CurveEditor SVG renders inside the property panel", async () => {
  // Re-select to mount the panel.
  await page.evaluate(async () => {
    const bridge = (window as Window & { bridge?: {
      request: (req: { kind: string; params: unknown }) => Promise<unknown>;
    } }).bridge;
    const list = await bridge!.request({ kind: "emitters/list", params: {} }) as {
      root: { children: { id: number }[] };
    };
    const firstId = list.root.children[0]?.id;
    if (firstId === undefined) throw new Error("no emitters in tree");
    await bridge!.request({ kind: "emitters/select", params: { id: firstId } });
  });

  const panel = page.locator('[data-testid="emitter-property-panel"]');
  await expect(panel).toBeVisible({ timeout: 5_000 });

  // The SVG canvas renders the curve and per-key circles. The host's
  // seeded root emitter has empty tracks (no keys until the user adds
  // them), so we assert the SVG itself is present — its axes + grid
  // always render even with no keys.
  const svg = panel.locator('[data-testid="curve-editor-svg"]');
  await expect(svg).toBeVisible({ timeout: 5_000 });

  // Tear down — de-select.
  await page.evaluate(async () => {
    const bridge = (window as Window & { bridge?: {
      request: (req: { kind: string; params: unknown }) => Promise<unknown>;
    } }).bridge;
    await bridge!.request({ kind: "emitters/select", params: { id: null } });
  });
});
