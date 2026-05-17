// Phase 3 Screen 3 contract tests: Toolbar DOM presence and bridge
// round-trips for the four-group toolbar (File / Edit / View / Render).
// Sibling of app-shell.spec.ts and background-picker.spec.ts — same
// CDP-attach harness, same window.bridge host-object channel.
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

test("Toolbar renders all 10 buttons", async () => {
  const labels = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button[aria-label]'))
      .map((b) => b.getAttribute("aria-label"))
      .filter((l): l is string =>
        l !== null
        && !["Background", "Solid colour", "Close background picker"].some((skip) => l.startsWith(skip))
        && !l.includes("Skydome")
        && !["Storm", "Murky Clouds", "Smog Clouds", "Blue Horizon", "Blue Sky", "Orange Horizon", "Orange Sky", "Volcanic Storm"].includes(l)
        && !l.startsWith("Custom slot"));
  });
  expect(labels).toEqual(expect.arrayContaining([
    expect.stringContaining("New"),
    expect.stringContaining("Open"),
    expect.stringContaining("Save"),
    expect.stringContaining("Undo"),
    expect.stringContaining("Redo"),
    expect.stringMatching(/Pause|Resume/),
    expect.stringContaining("Step"),
    expect.stringMatching(/^Bloom/),
    expect.stringContaining("Reload shaders"),
    expect.stringContaining("Reload textures"),
  ]));
});

test("engine/set/paused mutates state and flips Pause button", async () => {
  const result = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = (window as any).bridge;
    await bridge.request({ kind: "engine/set/paused", params: { paused: true } });
    await new Promise((r) => setTimeout(r, 100));
    const snap = await bridge.request({ kind: "engine/state/snapshot", params: {} });
    const btn = Array.from(document.querySelectorAll('button[aria-label]'))
      .find((b) => /Pause|Resume/.test(b.getAttribute("aria-label")!));
    return {
      paused: snap.paused,
      ariaLabel: btn?.getAttribute("aria-label") ?? null,
      ariaPressed: btn?.getAttribute("aria-pressed") ?? null,
    };
  });
  expect(result.paused).toBe(true);
  expect(result.ariaLabel).toMatch(/Resume/);
  expect(result.ariaPressed).toBe("true");

  // Cleanup — un-pause for the next test.
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).bridge.request({ kind: "engine/set/paused", params: { paused: false } });
  });
});

test("engine/action/step-frames is dispatched without error", async () => {
  const result = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = (window as any).bridge;
    // Pause first so step-frames isn't a complete no-op host-side.
    await bridge.request({ kind: "engine/set/paused", params: { paused: true } });
    const r = await bridge.request({ kind: "engine/action/step-frames", params: { frames: 1 } });
    await bridge.request({ kind: "engine/set/paused", params: { paused: false } });
    return r;
  });
  expect(result).toEqual({});
});

test("engine/set/bloom flips Bloom button aria-pressed", async () => {
  const result = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = (window as any).bridge;
    const before = await bridge.request({ kind: "engine/state/snapshot", params: {} });
    await bridge.request({ kind: "engine/set/bloom", params: { enabled: !before.bloom } });
    // Wait for the engine/state/changed broadcast to round-trip through
    // WebView2 (async on the native host) and the React re-render to flush.
    await new Promise((r) => setTimeout(r, 250));
    const after = await bridge.request({ kind: "engine/state/snapshot", params: {} });
    const btn = Array.from(document.querySelectorAll('button[aria-label]'))
      .find((b) => /^Bloom/.test(b.getAttribute("aria-label")!));
    // Read aria-pressed *before* the restore. The engine/state/changed
    // broadcast that drives React re-renders is async on the native host
    // (WebView2 postMessage), so the restore would race with the read.
    const ariaPressed = btn?.getAttribute("aria-pressed") ?? null;
    // Restore the pre-test value so downstream specs aren't affected.
    await bridge.request({ kind: "engine/set/bloom", params: { enabled: before.bloom } });
    return {
      beforeBloom: before.bloom,
      afterBloom: after.bloom,
      ariaPressed,
    };
  });
  expect(result.afterBloom).toBe(!result.beforeBloom);
  expect(result.ariaPressed).toBe(String(!result.beforeBloom));
});
