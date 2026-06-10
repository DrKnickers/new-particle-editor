// [resize-perf] Splitter-drag traffic probe — drives a real splitter drag
// in the RUNNING host (launched with --new-ui --test-host, CDP on :9222)
// via dispatched PointerEvents, so the host's per-kind [resize-perf]
// bridge probe can attribute the message flood observed during the
// user's live drags (~104/s of non-scene-rect traffic). Run from
// web/apps/editor:  node ../../../tasks/tool-splitter-drag-probe.mjs
import { createRequire } from "node:module";
// Resolve @playwright/test from the editor workspace regardless of where
// this script lives (tasks/ has no node_modules).
const editorRequire = createRequire(
  new URL("../web/apps/editor/package.json", import.meta.url),
);
const { chromium } = editorRequire("@playwright/test");

const CDP = process.env.CDP_ENDPOINT ?? "http://localhost:9222";

const browser = await chromium.connectOverCDP(CDP);
const page = browser.contexts()[0].pages()[0];
await page.locator('[data-testid="quadrant-viewport"]').waitFor({ state: "visible", timeout: 15000 });

// Drag a separator with dispatched PointerEvents at ~60 Hz for `ms`,
// oscillating +-ampl px along the drag axis.
async function dragSeparator(which, ms, ampl) {
  await page.evaluate(async ({ which, ms, ampl }) => {
    const seps = Array.from(document.querySelectorAll("[data-separator]"));
    const sep = which === "leftCenter"
      ? seps.filter(s => s.className.includes("ce-splitter-v"))[0]
      : seps.filter(s => s.className.includes("ce-splitter-h"))
            .find(s => s.closest("[data-group]")?.querySelector('[data-testid="quadrant-viewport"]'));
    if (!sep) throw new Error("separator not found: " + which);
    const r = sep.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const horizontalDrag = which === "leftCenter"; // vertical sep moves in x
    const opts = (x, y, buttons) => ({
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      pointerId: 1, pointerType: "mouse", button: 0, buttons, isPrimary: true,
    });
    sep.dispatchEvent(new PointerEvent("pointerdown", opts(cx, cy, 1)));
    const t0 = performance.now();
    let i = 0;
    while (performance.now() - t0 < ms) {
      const phase = Math.sin((i++ / 30) * Math.PI * 2) * ampl;
      const x = horizontalDrag ? cx + phase : cx;
      const y = horizontalDrag ? cy : cy + phase;
      document.dispatchEvent(new PointerEvent("pointermove", opts(x, y, 1)));
      await new Promise(res => setTimeout(res, 16));
    }
    document.dispatchEvent(new PointerEvent("pointerup", opts(cx, cy, 0)));
  }, { which, ms, ampl });
}

console.log("[probe] dragging left<->center separator 3s ...");
await dragSeparator("leftCenter", 3000, 80);
await new Promise(res => setTimeout(res, 1200));
console.log("[probe] dragging viewport<->curve separator 3s ...");
await dragSeparator("viewportCurve", 3000, 60);
await new Promise(res => setTimeout(res, 1200));
console.log("[probe] done");
await browser.close();
