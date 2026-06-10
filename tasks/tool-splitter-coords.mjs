// [resize-perf] companion to tool-splitter-drag-probe.mjs — prints the
// left<->center separator center + viewport center (CSS px) and the DPR
// as JSON, for a SendInput-based REAL-mouse drag from PowerShell.
import { createRequire } from "node:module";
const editorRequire = createRequire(
  new URL("../web/apps/editor/package.json", import.meta.url),
);
const { chromium } = editorRequire("@playwright/test");

const browser = await chromium.connectOverCDP(process.env.CDP_ENDPOINT ?? "http://localhost:9222");
const page = browser.contexts()[0].pages()[0];
await page.locator('[data-testid="quadrant-viewport"]').waitFor({ state: "visible", timeout: 15000 });
const out = await page.evaluate(() => {
  const sep = Array.from(document.querySelectorAll("[data-separator]"))
    .filter(s => s.className.includes("ce-splitter-v"))[0];
  const r = sep.getBoundingClientRect();
  const vp = document.querySelector('[data-testid="quadrant-viewport"]').getBoundingClientRect();
  return {
    sep: { x: r.x + r.width / 2, y: r.y + r.height / 2 },
    vp:  { x: vp.x + vp.width / 2, y: vp.y + vp.height / 2, w: vp.width },
    dpr: window.devicePixelRatio || 1,
  };
});
console.log(JSON.stringify(out));
await browser.close();
