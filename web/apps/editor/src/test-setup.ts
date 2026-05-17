// Vitest setup file: extend expect with jest-dom matchers.
// Imported by all test suites via vitest.config.ts setupFiles.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Automatically clean up the DOM after each test, matching Jest/jsdom
// default behaviour. Without this, multiple renders in the same test file
// accumulate in the shared jsdom body and cause "found multiple elements"
// errors on the second and later tests.
afterEach(() => {
  cleanup();
});

// jsdom doesn't implement ResizeObserver — Radix Popover uses it internally.
// Stub it with a no-op implementation so Popover mounts without throwing.
if (typeof ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom doesn't implement Element.prototype.scrollIntoView (used by
// Radix Select's focus management). Stub it so Select renders without error.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

// jsdom doesn't implement window.PointerEvent fully. Radix Select uses
// pointer events for its interaction model. Provide a basic stub.
if (!globalThis.PointerEvent) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).PointerEvent = class PointerEvent extends MouseEvent {
    public pointerId: number;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
    }
  };
}

// HTMLElement.prototype.hasPointerCapture / setPointerCapture —
// required by Radix for pointer-capture interactions.
if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
}
if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = vi.fn();
}
if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = vi.fn();
}
