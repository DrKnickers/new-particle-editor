// Phase 3 Screen 8 Batch 2 contract tests: modeless tool windows
// (Lighting / Bloom Settings / Ground Texture) wired against the real
// native bridge inside ParticleEditor.exe --new-ui --test-host. Same
// CDP-attach harness as sibling specs.
//
// What the six specs cover:
//   1. Tools → Lighting opens the panel.
//   2. Opening Background closes Lighting (mutual exclusion via the
//      Zustand atom — single-open semantics).
//   3. View → Bloom Settings… opens the panel.
//   4. Toggling Enable in the Bloom panel fires engine/set/bloom,
//      observed via the engine/state/changed event.
//   5. View → Ground Texture… opens the panel.
//   6. Clicking a bundled ground slot updates the snapshot's
//      groundTexture.

import { test, expect, chromium, type Page, type Browser } from "@playwright/test";

const CDP_ENDPOINT = process.env.CDP_ENDPOINT ?? "http://localhost:9222";

let browser: Browser;
let page: Page;

test.beforeAll(async () => {
  browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  const context = browser.contexts()[0];
  if (!context) throw new Error("CDP: no browser contexts attached");
  const pages = context.pages();
  page = pages[0] ?? (await context.waitForEvent("page"));

  await page.waitForFunction(
    () => typeof (window as { bridge?: unknown }).bridge !== "undefined",
    null,
    { timeout: 15_000 },
  );
});

test.afterAll(async () => {
  await browser?.close();
});

// Helper — open a menu by name and click an item by its visible text.
// Radix portals the content so the selector matches against [role="menu"]
// at the document root, not inside [role="menubar"].
async function openMenuItem(p: Page, menu: string, item: string) {
  await p.keyboard.press("Escape").catch(() => {});
  const trigger = p.locator(`[role="menubar"] >> text=${menu}`).first();
  await trigger.click();
  await p.waitForSelector('[role="menu"]', { timeout: 2000 });
  await p.locator(`[role="menuitem"]:has-text("${item}")`).first().click();
}

// Helper — wait for a ToolPanel with the given title to mount. ToolPanel
// uses role="dialog" with the title as aria-label; the BackgroundPicker
// uses "Background picker" as its title, the new panels use "Lighting",
// "Bloom Settings", and "Ground Texture".
async function waitForPanel(p: Page, title: string) {
  await p.waitForSelector(`[role="dialog"][aria-label="${title}"]`, {
    timeout: 2000,
  });
}

async function closeAnyPanel(p: Page) {
  // The close glyph in any open ToolPanel carries aria-label="Close".
  // Background picker uses the same title so this selector is unique
  // per-panel scoped via the dialog ancestor.
  const dialog = p.locator('[role="dialog"]:not([data-state])').first();
  if (await dialog.count()) {
    const closeBtn = dialog.locator('button[aria-label="Close"]').first();
    if (await closeBtn.count()) {
      await closeBtn.click().catch(() => {});
    }
  }
}

test("Tools → Lighting opens the Lighting panel", async () => {
  await closeAnyPanel(page);
  await openMenuItem(page, "Tools", "Lighting");
  await waitForPanel(page, "Lighting");
});

test("Opening Background closes the Lighting panel (mutual exclusion)", async () => {
  // Ensure Lighting is the currently-open panel.
  await closeAnyPanel(page);
  await openMenuItem(page, "Tools", "Lighting");
  await waitForPanel(page, "Lighting");

  // Click the Background pill in the top bar. Its aria-label is "Background".
  await page.locator('button[aria-label="Background"]').first().click();

  // The Background picker should mount and Lighting should unmount.
  await waitForPanel(page, "Background picker");
  const stillLighting = await page
    .locator('[role="dialog"][aria-label="Lighting"]')
    .count();
  expect(stillLighting).toBe(0);

  // Cleanup so the next test starts from a clean slate.
  await closeAnyPanel(page);
});

test("View → Bloom Settings… opens the Bloom Settings panel", async () => {
  await closeAnyPanel(page);
  await openMenuItem(page, "View", "Bloom Settings");
  await waitForPanel(page, "Bloom Settings");
});

test("Toggling Enable Bloom fires engine/set/bloom (observed via state/changed)", async () => {
  await closeAnyPanel(page);
  await openMenuItem(page, "View", "Bloom Settings");
  await waitForPanel(page, "Bloom Settings");

  // Subscribe to engine/state/changed and capture the bloom flag from
  // each payload. The React panel commits Enable changes directly to
  // the bridge; the host emits state/changed in response.
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (w.__bloomUnsub) w.__bloomUnsub();
    w.__bloomChanges = [] as boolean[];
    w.__bloomUnsub = w.bridge.on("engine/state/changed", (e: { payload: { bloom: boolean } }) => {
      w.__bloomChanges.push(e.payload.bloom);
    });
  });

  const before = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = (window as any).bridge;
    const snap = await b.request({ kind: "engine/state/snapshot", params: {} });
    return snap.bloom as boolean;
  });

  // Flip the checkbox.
  await page.locator('input[aria-label="Enable bloom"]').first().click();

  // Wait for the host to emit the resulting state/changed.
  await page.waitForTimeout(300);

  const changes = await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__bloomChanges as boolean[],
  );
  // At least one event with the flipped value should have arrived.
  expect(changes).toContain(!before);

  // Restore previous state to keep the test idempotent.
  await page.evaluate(async (orig) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = (window as any).bridge;
    await b.request({ kind: "engine/set/bloom", params: { enabled: orig } });
  }, before);

  await closeAnyPanel(page);
});

test("View → Ground Texture… opens the Ground Texture panel", async () => {
  await closeAnyPanel(page);
  await openMenuItem(page, "View", "Ground Texture");
  await waitForPanel(page, "Ground Texture");
});

test("Clicking a bundled ground slot updates groundTexture in the snapshot", async () => {
  await closeAnyPanel(page);
  await openMenuItem(page, "View", "Ground Texture");
  await waitForPanel(page, "Ground Texture");

  const before = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = (window as any).bridge;
    const s = await b.request({ kind: "engine/state/snapshot", params: {} });
    return s.groundTexture as number;
  });

  // Pick a slot different from the current selection so the change is
  // observable. Grass (slot 1) and Sand (slot 2) are both bundled and
  // safe to switch to without affecting any custom paths.
  const targetName = before === 1 ? "Sand" : "Grass";
  const targetSlot = targetName === "Grass" ? 1 : 2;

  await page
    .locator(`[role="dialog"][aria-label="Ground Texture"] button[aria-label="${targetName}"]`)
    .click();

  await page.waitForTimeout(300);

  const after = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = (window as any).bridge;
    const s = await b.request({ kind: "engine/state/snapshot", params: {} });
    return s.groundTexture as number;
  });
  expect(after).toBe(targetSlot);

  // Restore.
  await page.evaluate(async (orig) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = (window as any).bridge;
    await b.request({ kind: "engine/set/ground-texture", params: { slot: orig } });
  }, before);

  await closeAnyPanel(page);
});
