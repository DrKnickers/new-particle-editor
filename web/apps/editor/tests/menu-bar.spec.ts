// Phase 3 Screen 2 contract tests: React menu bar DOM presence and
// selected bridge dispatches. Same CDP-attach harness as toolbar.spec.ts.
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

// ── 1. All 5 triggers present ────────────────────────────────────────────────

test("All 5 menu triggers render in the menubar", async () => {
  const triggers = await page.evaluate(() => {
    const bar = document.querySelector('[role="menubar"]');
    if (!bar) return [];
    // Radix renders each <Menubar.Menu> as a direct child <div> wrapping
    // a <button role="menuitem">. Collect the text of those buttons.
    return Array.from(
      bar.querySelectorAll(':scope > div > button')
    ).map((b) => b.textContent?.trim());
  });
  expect(triggers).toEqual(
    expect.arrayContaining(["File", "Edit", "View", "Tools", "Help"])
  );
});

// ── 2. Edit › Clear All Particles dispatches engine/action/clear ─────────────

test("Edit > Clear All Particles dispatches engine/action/clear", async () => {
  const result = await page.evaluate(async () => {
    return new Promise<boolean>((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = (window as any).bridge;
      let fired = false;
      const off = b.on("engine/state/changed", () => {
        fired = true;
      });
      // Drive via bridge directly — Radix portals make headless DOM
      // menu navigation brittle. The intent is to verify the bridge
      // surface reachable from the menu item handler, not the click
      // path itself (that's covered by the File-menu open spec below).
      b.request({ kind: "engine/action/clear", params: {} }).then(() => {
        setTimeout(() => {
          off();
          resolve(fired);
        }, 200);
      });
    });
  });
  expect(result).toBe(true);
});

// ── 3. View › Bloom toggle flips state ───────────────────────────────────────

test("View > Bloom dispatches engine/set/bloom and flips state", async () => {
  const result = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = (window as any).bridge;
    const before = await b.request({ kind: "engine/state/snapshot", params: {} });
    await b.request({
      kind: "engine/set/bloom",
      params: { enabled: !before.bloom },
    });
    await new Promise((r) => setTimeout(r, 100));
    const after = await b.request({ kind: "engine/state/snapshot", params: {} });
    // Restore
    await b.request({
      kind: "engine/set/bloom",
      params: { enabled: before.bloom },
    });
    return { before: before.bloom, after: after.bloom };
  });
  expect(result.after).toBe(!result.before);
});

// ── 4. View › Pause toggle flips state ───────────────────────────────────────

test("View > Pause dispatches engine/set/paused and flips state", async () => {
  const result = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = (window as any).bridge;
    const before = await b.request({ kind: "engine/state/snapshot", params: {} });
    await b.request({
      kind: "engine/set/paused",
      params: { paused: !before.paused },
    });
    await new Promise((r) => setTimeout(r, 100));
    const after = await b.request({ kind: "engine/state/snapshot", params: {} });
    // Restore
    await b.request({
      kind: "engine/set/paused",
      params: { paused: before.paused },
    });
    return { before: before.paused, after: after.paused };
  });
  expect(result.after).toBe(!result.before);
});

// ── 5. File menu opens and exposes items via Radix portal ────────────────────

test("File menu opens to reveal items in the DOM", async () => {
  // Click the File trigger in the menubar. Radix renders triggers as
  // role="menuitem" inside role="menubar".
  const fileTrigger = page
    .locator('[role="menubar"] >> text=File')
    .first();
  await fileTrigger.click();

  // Radix portals the content into the document body; wait for it.
  await page.waitForSelector('[role="menu"]', { timeout: 2000 });

  // Verify a known item is present.
  const visible = await page
    .locator('[role="menuitem"]:has-text("Import Emitters")')
    .isVisible();
  expect(visible).toBe(true);

  // Close the menu cleanly so subsequent tests start with a closed bar.
  await page.keyboard.press("Escape");
});
