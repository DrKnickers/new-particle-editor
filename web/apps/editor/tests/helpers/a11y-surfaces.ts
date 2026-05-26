import type { Page } from "@playwright/test";

// Each surface is a "drive the app to this state" recipe shared by the
// HWND UIA specs (T9, captures via uia_inspector) and the composition
// DOM-snapshot specs (T10, captures via page.accessibility.snapshot()).
// id matches the golden filename: a11y-goldens/<id>.golden.json
//                                 a11y-goldens/<id>.composition.golden.json
export type SurfaceCapture = {
  id: string;
  setup: (page: Page) => Promise<void>;
  teardown: (page: Page) => Promise<void>;
};

async function dismissModals(page: Page) {
  // Coarse cleanup — closes any open menu / dialog. If a test leaves
  // the editor mid-rename or mid-IME, this won't recover; surface that
  // through R6 follow-ups if it bites.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
}

// Note (T5): EmitterPropertyTabs.tsx already exposes
// `data-testid="emitter-property-tabs"` on its Tabs.Root (used by
// existing vitest + Playwright property-tabs specs). The T5 plan
// asked for a new `property-tabs` testid, but adding a duplicate
// would require either wrapping Tabs.Root in an otherwise-pointless
// div or renaming the existing testid (scope creep — 5+ active
// callers). Reusing the existing testid here is the surgical fix.
// MenuBar triggers are Radix Menubar.Trigger which renders as
// `<button>` with the menu name as direct text, so `button:has-text`
// selectors work as the plan expects.

export const CHROME_SURFACES: SurfaceCapture[] = [
  {
    id: "menubar-closed",
    setup: async (page) => {
      await page.locator('[data-testid="app-shell"]').focus();
    },
    teardown: async (page) => { await dismissModals(page); },
  },
  {
    id: "menubar-file-open",
    setup: async (page) => {
      await page.locator('button:has-text("File")').click();
      await page.waitForSelector('[role="menu"]');
    },
    teardown: async (page) => { await dismissModals(page); },
  },
  {
    id: "menubar-edit-open",
    setup: async (page) => {
      await page.locator('button:has-text("Edit")').click();
      await page.waitForSelector('[role="menu"]');
    },
    teardown: async (page) => { await dismissModals(page); },
  },
  {
    id: "menubar-emitters-open",
    setup: async (page) => {
      await page.locator('button:has-text("Emitters")').click();
      await page.waitForSelector('[role="menu"]');
    },
    teardown: async (page) => { await dismissModals(page); },
  },
  {
    id: "menubar-mods-open",
    setup: async (page) => {
      await page.locator('button:has-text("Mods")').click();
      await page.waitForSelector('[role="menu"]');
    },
    teardown: async (page) => { await dismissModals(page); },
  },
  {
    id: "menubar-view-open",
    setup: async (page) => {
      await page.locator('button:has-text("View")').click();
      await page.waitForSelector('[role="menu"]');
    },
    teardown: async (page) => { await dismissModals(page); },
  },
  {
    id: "menubar-help-open",
    setup: async (page) => {
      await page.locator('button:has-text("Help")').click();
      await page.waitForSelector('[role="menu"]');
    },
    teardown: async (page) => { await dismissModals(page); },
  },
  {
    id: "toolbar",
    setup: async (page) => {
      await page.locator('[data-testid="toolbar"]').focus();
    },
    teardown: async (_page) => { /* no-op */ },
  },
  {
    id: "emitter-tree",
    setup: async (page) => {
      // Assumes fixture has at least one root emitter loaded.
      await page.locator('[data-testid="emitter-tree"]').focus();
    },
    teardown: async (_page) => { /* no-op */ },
  },
  {
    id: "property-tabs-basic",
    setup: async (page) => {
      await page.locator('[role="tab"]:has-text("Basic")').click();
    },
    teardown: async (_page) => { /* no-op */ },
  },
  {
    id: "property-tabs-appearance",
    setup: async (page) => {
      await page.locator('[role="tab"]:has-text("Appearance")').click();
    },
    teardown: async (_page) => { /* no-op */ },
  },
  {
    id: "property-tabs-physics",
    setup: async (page) => {
      await page.locator('[role="tab"]:has-text("Physics")').click();
    },
    teardown: async (_page) => { /* no-op */ },
  },
  {
    id: "viewport-pill",
    setup: async (page) => {
      await page.locator('[data-testid="viewport-pill"]').focus();
    },
    teardown: async (_page) => { /* no-op */ },
  },
];
