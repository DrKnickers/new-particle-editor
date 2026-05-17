// Phase 3 Screen 8 Batch 1 contract tests: Help → About + Edit → Rescale…
// sub-dialogs. Same CDP-attach harness as sibling specs. Verifies that
// menu triggers render the React modal and that the rescale OK click
// dispatches the new `engine/action/rescale-system` bridge call.

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
    { timeout: 15_000 }
  );
});

test.afterAll(async () => {
  await browser?.close();
});

// ── 1. Help → About renders modal with version text ─────────────────────────
//
// Selector note: the BackgroundPicker panel also uses role="dialog" (it's a
// non-modal slide-in), so we can't filter by role alone. Radix Dialog
// content carries the `data-radix-dialog-content` attribute (or the
// canonical `data-state="open"` plus aria-labelledby pointing at the
// Radix title). Target via `[role="dialog"][data-state]` which only
// matches the Radix Modal content, not the BackgroundPicker shell.

const RADIX_DIALOG = '[role="dialog"][data-state="open"]';

test("Help → About opens the modal and displays /Version \\d+/", async () => {
  // Make sure we're starting from a clean menu state.
  await page.keyboard.press("Escape").catch(() => {});

  // Click the Help trigger in the menubar.
  const helpTrigger = page
    .locator('[role="menubar"] >> text=Help')
    .first();
  await helpTrigger.click();

  // Radix portals the menu content; wait for it to mount.
  await page.waitForSelector('[role="menu"]', { timeout: 2000 });

  // Click the About item.
  await page.locator('[role="menuitem"]:has-text("About")').first().click();

  // The Modal is portalled into the body. Wait for the Radix dialog.
  await page.waitForSelector(RADIX_DIALOG, { timeout: 2000 });

  // The body should contain a "Version N(.N)?" line.
  const versionText = await page
    .locator(RADIX_DIALOG)
    .locator("text=/Version \\d+(\\.\\d+)?/")
    .first()
    .textContent();
  expect(versionText).toBeTruthy();
  expect(versionText).toMatch(/Version \d+/);

  // Close the dialog cleanly.
  await page.keyboard.press("Escape");
  // Wait for the dialog to disappear so the next test starts clean.
  await page.waitForSelector(RADIX_DIALOG, { state: "detached", timeout: 2000 });
});

// ── 2. Edit → Rescale… dispatches engine/action/rescale-system ──────────────

test("Edit → Rescale… → OK fires engine/action/rescale-system observable via state/changed", async () => {
  // The React Rescale dialog uses NativeBridge (not window.bridge —
  // window.bridge is the TestHostBridge swap under --test-host).
  // Monkey-patching window.bridge.request can't intercept the call, so
  // we observe the side-effect instead: the C++ rescale-system handler
  // emits engine/state/changed for parity with MockBridge. Subscribe
  // via window.bridge.on (which is unaffected by the request channel
  // split) and assert the event arrives. Event delivery proves the
  // round-trip (React → postMessage → host → emit → page) worked.
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__stateChangedCount = 0;
    if (w.__stateChangedUnsub) w.__stateChangedUnsub();
    w.__stateChangedUnsub = w.bridge.on("engine/state/changed", () => {
      w.__stateChangedCount += 1;
    });
  });

  const beforeCount = await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__stateChangedCount as number
  );

  // Click Edit → Rescale… via the DOM.
  const editTrigger = page
    .locator('[role="menubar"] >> text=Edit')
    .first();
  await editTrigger.click();
  await page.waitForSelector('[role="menu"]', { timeout: 2000 });
  await page.locator('[role="menuitem"]:has-text("Rescale")').first().click();

  // Wait for the modal.
  await page.waitForSelector(RADIX_DIALOG, { timeout: 2000 });

  // Click OK. The dialog defaults to 100/100; the dispatch is what we
  // care about, not the values (host-side params are logged via
  // stderr in --test-host mode and visible during the run).
  await page.locator(RADIX_DIALOG).getByRole("button", { name: "OK" }).click();

  // The dialog should close.
  await page.waitForSelector(RADIX_DIALOG, { state: "detached", timeout: 2000 });

  // Give the host a moment to emit + the page a tick to receive the
  // state/changed event.
  await page.waitForTimeout(300);

  const afterCount = await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__stateChangedCount as number
  );
  // At least one new state/changed event should have arrived as a
  // direct consequence of the rescale-system dispatch.
  expect(afterCount).toBeGreaterThan(beforeCount);
});
