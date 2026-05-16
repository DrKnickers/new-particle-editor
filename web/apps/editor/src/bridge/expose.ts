// Expose the bridge instance to `window.bridge` so external tooling
// (DevTools console under --test-host, eventually CDP-driven Playwright
// specs) can issue requests without going through React's component
// tree.
//
// This is a diagnostic surface, not load-bearing: no production code
// path reads `window.bridge`. It's attached unconditionally — DevTools
// is gated behind the host's --test-host flag in WebView2 settings, so
// production users have no path to reach the global.
//
// NOTE: as of Task 2.2, calling `window.bridge.request(...)` from a CDP
// `Runtime.evaluate` does NOT deliver to the host. WebView2 silently
// drops `chrome.webview.postMessage` calls that originate while a CDP
// debugger is attached (verified empirically — no WebMessageReceived
// event fires, even for setInterval-scheduled calls running in the
// page's main JS thread). The unblock path is to expose a host object
// via `ICoreWebView2::AddHostObjectToScript` and route test traffic
// through that channel; tracked separately. Until then this global is
// only useful from F12 DevTools, where postMessage delivery works.

import type { Bridge } from "@particle-editor/bridge-schema";

declare global {
  interface Window {
    bridge?: Bridge;
  }
}

export function exposeBridgeForTests(bridge: Bridge): void {
  (window as { bridge?: Bridge }).bridge = bridge;
}
