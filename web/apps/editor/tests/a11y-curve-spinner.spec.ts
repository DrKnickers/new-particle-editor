import { test, expect, chromium, type Page, type Browser } from "@playwright/test";
import * as path from "node:path";
import { captureUIA, discoverHostHwnd } from "./helpers/uia";
import { normalize } from "./helpers/a11y-normalizer";
import { CUSTOM_PRIMITIVE_SURFACES } from "./helpers/a11y-surfaces";
import allowlist from "./helpers/a11y-allowlist.json";
import "./helpers/toMatchJSONGolden";

const CDP_ENDPOINT = process.env.CDP_ENDPOINT ?? "http://localhost:9222";
const COMPOSITION_MODE = process.env.ALO_WEBVIEW2_HOSTING === "composition";
// Absolute path because the editor's CWD is repo-root (per run-native-tests.mjs:66),
// not the tests dir — a relative path here would resolve to <repo>/tests/fixtures/...
// which doesn't exist. Resolve from this spec's __dirname instead. See T9.0 pre-flight.
const FIXTURE_PATH = path.resolve(__dirname, "fixtures/a11y-base-state.alo");

let browser: Browser;
let page: Page;
let hostHwnd: bigint;

test.beforeAll(async () => {
  if (COMPOSITION_MODE) return;  // skip body; per-test skip handles individual tests
  browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  const context = browser.contexts()[0];
  if (!context) throw new Error("CDP: no browser contexts attached");
  page = context.pages()[0] ?? (await context.waitForEvent("page"));
  await page.waitForFunction(
    () => typeof (window as { bridge?: unknown }).bridge !== "undefined",
    null,
    { timeout: 15_000 }
  );
  hostHwnd = await discoverHostHwnd();
});

test.afterAll(async () => {
  await browser?.close();
});

test.beforeEach(async ({}, testInfo) => {
  // Post-T0 re-plan: HWND-mode spec auto-skips under composition.
  // Composition coverage is via T10's a11y-*-composition.spec.ts using
  // page.accessibility.snapshot() (Win32 UIA can't reach the React tree
  // in composition mode — see tasks/phase-0-a11y-cross-mode-probe.md).
  if (COMPOSITION_MODE) {
    testInfo.annotations.push({
      type: "skip-reason",
      description:
        "ALO_WEBVIEW2_HOSTING == 'composition' — HWND Win32 UIA spec " +
        "auto-skips in composition mode. Use a11y-curve-spinner-composition.spec.ts " +
        "(DOM snapshot) for the composition lane."
    });
    test.skip();
  }
  // Reset to known-clean state — close any open menus / dialogs left by
  // the previous test. Cheaper than relaunching the binary.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  // Load deterministic base state from fixture. Absolute path resolves from
  // this spec's __dirname (see FIXTURE_PATH comment above).
  await page.evaluate(
    async (fixturePath) => {
      const bridge = (window as { bridge: { request: (k: string, p: unknown) => Promise<unknown> } }).bridge;
      await bridge.request("file/open", { path: fixturePath });
    },
    FIXTURE_PATH
  );
});

test.describe("a11y/curve-spinner [hwnd]", () => {
  for (const surface of CUSTOM_PRIMITIVE_SURFACES) {
    test(`${surface.id} [hwnd]`, async () => {
      try {
        await surface.setup(page);
        const raw = await captureUIA(hostHwnd, surface.id);
        const normalized = normalize(raw, allowlist);
        expect(normalized).toMatchJSONGolden(
          `a11y-goldens/${surface.id}.golden.json`,
          { rawForDebug: raw }
        );
      } finally {
        await surface.teardown(page);
      }
    });
  }
});
