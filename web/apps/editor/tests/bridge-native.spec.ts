// Task 2.2 contract tests: drive the *real* native bridge inside
// ParticleEditor.exe --new-ui --test-host via CDP. These specs exist to
// catch schema drift between the TypeScript MockBridge (covered by
// Vitest in Task 2.1) and the C++ BridgeDispatcher — the failure mode
// the LT-4 plan called out as Risk #2.
//
// CURRENTLY BLOCKED (Task 2.2 self-review):
//   WebView2 silently drops chrome.webview.postMessage calls when a CDP
//   debugger is attached. Verified empirically — no WebMessageReceived
//   event fires on the host side, even when bridge.request() is invoked
//   from a page-internal setInterval (not directly from CDP eval). The
//   six WebMsg log lines on startup come from App.tsx's mount-time
//   useEffects that fire before CDP attaches; nothing after that point
//   delivers.
//
//   The unblock path is to expose a host object via
//   ICoreWebView2::AddHostObjectToScript and route test traffic through
//   that channel instead of chrome.webview.postMessage. That's tracked
//   as a follow-up — the C++ host-side plumbing exists for it (an
//   IDispatch object with a Dispatch(json) → promise<json> method), but
//   wasn't built in Task 2.2 because the design was scoped to
//   AdditionalBrowserArguments + Playwright connectOverCDP only.
//
//   The tests are kept as `.fixme` rather than removed so the contract
//   they encode (shape of EngineStateDto, ground-z round-trip, COLORREF
//   round-trip, query-typing) is preserved — once the host-object IPC
//   lands, dropping .fixme should flip them green without rewriting the
//   assertions.
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

  // The WebView2 navigation is async vs. the host launch; wait until
  // `window.bridge` is attached by App.tsx before any spec runs.
  await page.waitForFunction(
    () => typeof (window as { bridge?: unknown }).bridge !== "undefined",
    null,
    { timeout: 15_000 }
  );
});

test.afterAll(async () => {
  await browser?.close();
});

test("CDP connect + window.bridge is attached (smoke)", async () => {
  // Positive smoke: the host's --test-host plumbing came up, WebView2's
  // CDP endpoint is reachable, the React app navigated, App.tsx ran and
  // attached the bridge to window. Catches every regression except the
  // postMessage-from-CDP one that .fixme'd specs cover.
  const probe = await page.evaluate(() => {
    const b = (window as { bridge?: { constructor: { name: string } } }).bridge;
    return {
      hasBridge: typeof b !== "undefined",
      hasRequest: typeof (b as { request?: unknown })?.request === "function",
      hasOn: typeof (b as { on?: unknown })?.on === "function",
      hasWebview: typeof (window as { chrome?: { webview?: unknown } }).chrome?.webview === "object",
    };
  });
  expect(probe.hasBridge).toBe(true);
  expect(probe.hasRequest).toBe(true);
  expect(probe.hasOn).toBe(true);
  expect(probe.hasWebview).toBe(true);
});

test.fixme("engine/state/snapshot returns a valid EngineStateDto shape", async () => {
  const dto = (await page.evaluate(async () => {
    const b = (window as { bridge?: { request(r: { kind: string; params: object }): Promise<unknown> } })
      .bridge;
    if (!b) throw new Error("window.bridge not attached");
    return b.request({ kind: "engine/state/snapshot", params: {} });
  })) as Record<string, unknown>;

  expect(dto).toHaveProperty("ground");
  expect(dto).toHaveProperty("groundZ");
  expect(dto).toHaveProperty("groundTexture");
  expect(dto).toHaveProperty("skydomeSlot");
  expect(dto).toHaveProperty("background");
  expect(dto).toHaveProperty("bloom");
  expect(dto).toHaveProperty("bloomAvailable");
  expect(dto).toHaveProperty("lights");
  expect(dto).toHaveProperty("camera");
  expect(typeof dto.groundZ).toBe("number");
  expect(typeof dto.bloomAvailable).toBe("boolean");
});

test.fixme("engine/set/ground-z mutates state and fires engine/state/changed", async () => {
  const result = await page.evaluate(async () => {
    type AnyBridge = {
      request(r: { kind: string; params: object }): Promise<unknown>;
      on(kind: string, h: (e: { payload: unknown }) => void): () => void;
    };
    const b = (window as { bridge?: AnyBridge }).bridge;
    if (!b) throw new Error("window.bridge not attached");

    return new Promise<{
      before: number;
      after: number;
      event: { groundZ: number } | null;
    }>((resolve, reject) => {
      let event: { groundZ: number } | null = null;
      const off = b.on("engine/state/changed", (e) => {
        event = e.payload as { groundZ: number };
      });
      b.request({ kind: "engine/state/snapshot", params: {} })
        .then(async (before) => {
          const newZ = 17.5;
          await b.request({ kind: "engine/set/ground-z", params: { z: newZ } });
          await new Promise((r) => setTimeout(r, 50));
          const after = (await b.request({
            kind: "engine/state/snapshot",
            params: {},
          })) as { groundZ: number };
          off();
          resolve({
            before: (before as { groundZ: number }).groundZ,
            after: after.groundZ,
            event,
          });
        })
        .catch(reject);
    });
  });

  expect(result.after).toBeCloseTo(17.5, 5);
  expect(result.event).not.toBeNull();
  expect(result.event!.groundZ).toBeCloseTo(17.5, 5);
});

test.fixme("engine/set/background round-trips a COLORREF", async () => {
  const result = await page.evaluate(async () => {
    const b = (window as { bridge?: { request(r: { kind: string; params: object }): Promise<unknown> } })
      .bridge;
    if (!b) throw new Error("window.bridge not attached");
    const rgb = 0x00808080;
    await b.request({ kind: "engine/set/background", params: { rgb } });
    const snap = (await b.request({
      kind: "engine/state/snapshot",
      params: {},
    })) as { background: number };
    return snap.background;
  });
  expect(result).toBe(0x00808080);
});

test.fixme("engine/query/ground-slot-empty returns boolean", async () => {
  const r = await page.evaluate(async () => {
    const b = (window as { bridge?: { request(r: { kind: string; params: object }): Promise<unknown> } })
      .bridge;
    if (!b) throw new Error("window.bridge not attached");
    return b.request({ kind: "engine/query/ground-slot-empty", params: { slot: 0 } });
  });
  expect(typeof r).toBe("boolean");
});
