// G1 — emitters/import-from-file native handler contract spec.
//
// Drives the REAL host (window.bridge over CDP — no mocks). Verifies:
//   1. emitters/preview-from-file returns the source file's emitter tree.
//   2. emitters/import-from-file clones the selected source emitters into
//      the live system: the live emitter count grows by exactly the number
//      imported, and the response reports `imported === selected.length`.
//
// Source fixture: a11y-base-state.alo (multi-emitter). Importing every
// source index exercises the full clone + spawn-rebind + ValidateEmitterGraph
// + link-group recreation path (legacy ImportEmitters_Execute parity).
//
// NOTE: helper funcs are defined INSIDE each page.evaluate — that body runs
// in the browser/host page context, where module-scope helpers don't exist.

import { test, expect, chromium, type Page, type Browser } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CDP_ENDPOINT = process.env.CDP_ENDPOINT ?? "http://localhost:9222";

// Host accepts forward slashes on Windows; avoids backslash-escaping noise.
const SOURCE_ALO = resolve(__dirname, "fixtures", "a11y-base-state.alo").replace(/\\/g, "/");

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

test("preview-from-file returns the source file's emitter tree", async () => {
  const { ok, count } = await page.evaluate(async (path) => {
    type TreeNode = { id: number; name: string; children?: TreeNode[] };
    const countNodes = (node: TreeNode | undefined): number =>
      (node?.children ?? []).reduce((n, c) => n + 1 + countNodes(c), 0);
    // Keep the bridge object — request() relies on `this` (its pending-id
    // map); destructuring the method loses the binding.
    const bridge = (window as unknown as {
      bridge: { request: (r: { kind: string; params: unknown }) =>
        Promise<{ ok?: boolean; tree?: TreeNode }> };
    }).bridge;
    const r = await bridge.request({ kind: "emitters/preview-from-file", params: { path } });
    return { ok: r.ok === true, count: countNodes(r.tree) };
  }, SOURCE_ALO);
  expect(ok).toBe(true);
  expect(count).toBeGreaterThan(0);
});

test("import-from-file clones the selected emitters into the live system", async () => {
  const result = await page.evaluate(async (path) => {
    type TreeNode = { id: number; name: string; children?: TreeNode[] };
    const countNodes = (node: TreeNode | undefined): number =>
      (node?.children ?? []).reduce((n, c) => n + 1 + countNodes(c), 0);
    const collectIds = (node: TreeNode | undefined): number[] =>
      (node?.children ?? []).flatMap((c) => [c.id, ...collectIds(c)]);
    // Keep the bridge object — request() relies on `this`.
    const bridge = (window as unknown as {
      bridge: { request: (r: { kind: string; params: unknown }) =>
        Promise<{ ok?: boolean; imported?: number; tree?: TreeNode; root?: TreeNode; error?: string }> };
    }).bridge;

    // 1. Preview the source → flatten all source indices to import.
    // (preview-from-file returns the tree under `tree`.)
    const preview = await bridge.request({ kind: "emitters/preview-from-file", params: { path } });
    const selected = collectIds(preview.tree);

    // 2. Baseline live emitter count. (emitters/list returns it under `root`.)
    const before = await bridge.request({ kind: "emitters/list", params: {} });
    const beforeCount = countNodes(before.root);

    // 3. Import every source emitter.
    const imp = await bridge.request({ kind: "emitters/import-from-file", params: { path, selected } });

    // 4. Live count after.
    const after = await bridge.request({ kind: "emitters/list", params: {} });
    const afterCount = countNodes(after.root);

    // 5. Undo — the import is one atomic unit, so a single undo reverts
    //    the whole thing. Also restores the shared host state so this
    //    test leaves no residue for later specs.
    await bridge.request({ kind: "undo/perform", params: { direction: "undo" } });
    const undone = await bridge.request({ kind: "emitters/list", params: {} });
    const undoneCount = countNodes(undone.root);

    return {
      selectedLen: selected.length,
      importOk: imp.ok === true,
      imported: imp.imported ?? null,
      importError: imp.error ?? null,
      beforeCount,
      afterCount,
      undoneCount,
    };
  }, SOURCE_ALO);

  expect(result.selectedLen).toBeGreaterThan(0);
  expect(result.importOk).toBe(true);
  expect(result.imported).toBe(result.selectedLen);
  expect(result.afterCount).toBe(result.beforeCount + result.selectedLen);
  // Atomic single-undo reverts the entire import.
  expect(result.undoneCount).toBe(result.beforeCount);
});
