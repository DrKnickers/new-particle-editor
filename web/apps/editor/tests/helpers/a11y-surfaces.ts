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

// ─── T6: dialog surfaces ──────────────────────────────────────────────
//
// Every dialog captured here renders through `<Modal>` (Radix Dialog
// primitives) or `<ToolPanel>` (a self-rendered `role="dialog"`
// container). The two share enough structural a11y semantics — a
// labelled, dismissable, role="dialog" container with an X close
// glyph — that they can sit alongside each other in one surface list.
//
// Trigger discovery:
//   - Menu-triggered dialogs: click the Menubar.Trigger, then click
//     the Menubar.Item by visible text. The menu items render
//     `role="menuitem"` via Radix.
//   - Context-menu-triggered dialogs (tree-context atom): right-click
//     the first emitter-tree row to open the row's ContextMenu, then
//     click the item. Assumes the T9 fixture loads at least one root
//     emitter (a11y-base-state.alo).
//   - mod-nickname: no menu trigger in production. The `?demo=mod-
//     nickname` route auto-fires `promptModNickname()` so the dialog
//     is visible at first paint. Captured by navigating to the demo
//     route — works without the full AppShell.
//
// Deferred surfaces (see tasks/a11y-deferred-surfaces.md for reasoning):
//   - dialog-save-changes (needs a dirty in-memory document)
//   - dialog-link-group-settings (needs an emitter with linkGroup > 0)
//   - background-picker / ground-texture (no longer Modal — replaced
//     by toolbar Popovers in NT-5/D6)
//   - primitives-gallery (separate ?demo=primitives route, full-page
//     replacement — not a dialog overlay)
//   - spawner (always-on right column, not a dialog)
//
// Teardown: most dialogs close on Esc. The tree-context dialogs close
// via Esc too (Radix Dialog handles it), then a second Esc clears any
// lingering context-menu state for safety. The ?demo=mod-nickname
// surface navigates back to the editor root to restore AppShell for
// subsequent captures.

export const DIALOG_SURFACES: SurfaceCapture[] = [
  // ── Menu-triggered Modal dialogs ─────────────────────────────────
  {
    id: "dialog-about",
    setup: async (page) => {
      await page.locator('button:has-text("Help")').click();
      await page.locator('[role="menuitem"]:has-text("About")').click();
      await page.waitForSelector('[role="dialog"]');
    },
    teardown: async (page) => { await dismissModals(page); },
  },
  {
    id: "dialog-rescale-system",
    setup: async (page) => {
      await page.locator('button:has-text("Edit")').click();
      await page.locator('[role="menuitem"]:has-text("Rescale")').click();
      await page.waitForSelector('[role="dialog"]');
    },
    teardown: async (page) => { await dismissModals(page); },
  },
  {
    id: "dialog-reset-view-settings",
    setup: async (page) => {
      await page.locator('button:has-text("View")').click();
      await page.locator('[role="menuitem"]:has-text("Reset View Settings")').click();
      await page.waitForSelector('[role="dialog"]');
    },
    teardown: async (page) => { await dismissModals(page); },
  },
  {
    id: "dialog-import-emitters",
    setup: async (page) => {
      // Modal opens with body in its "no file picked" state — the
      // Browse… button is the only enabled control. We capture this
      // state, not the post-preview tree state (which needs a real
      // file/open round-trip).
      await page.locator('button:has-text("File")').click();
      await page.locator('[role="menuitem"]:has-text("Import Emitters")').click();
      await page.waitForSelector('[role="dialog"]');
    },
    teardown: async (page) => { await dismissModals(page); },
  },

  // ── Menu-triggered ToolPanel dialogs (role="dialog" container) ───
  {
    id: "dialog-lighting",
    setup: async (page) => {
      await page.locator('button:has-text("View")').click();
      await page.locator('[role="menuitem"]:has-text("Lighting")').click();
      // ToolPanel renders `<div role="dialog" aria-label="Lighting">`
      // — not portalled like Modal, but still queryable as a dialog.
      await page.waitForSelector('[role="dialog"][aria-label="Lighting"]');
    },
    teardown: async (page) => {
      // ToolPanel does NOT close on Esc by design (modeless tool
      // window). Click its X glyph instead.
      await page
        .locator('[role="dialog"][aria-label="Lighting"] [aria-label="Close"]')
        .click();
    },
  },
  {
    id: "dialog-bloom-settings",
    setup: async (page) => {
      await page.locator('button:has-text("View")').click();
      await page.locator('[role="menuitem"]:has-text("Bloom Settings")').click();
      await page.waitForSelector('[role="dialog"][aria-label="Bloom Settings"]');
    },
    teardown: async (page) => {
      await page
        .locator('[role="dialog"][aria-label="Bloom Settings"] [aria-label="Close"]')
        .click();
    },
  },

  // ── Demo-route auto-open ─────────────────────────────────────────
  {
    id: "dialog-mod-nickname",
    setup: async (page) => {
      // The ?demo=mod-nickname route mounts ModNicknameDemo, which
      // fires promptModNickname() on mount, so the dialog is visible
      // immediately after navigation completes.
      await page.goto("/?demo=mod-nickname");
      await page.waitForSelector('[role="dialog"]');
    },
    teardown: async (page) => {
      // Dismiss the dialog, then return to the editor root so the next
      // surface (if any) sees AppShell again. T9's beforeEach re-loads
      // the base fixture per surface, so this just clears the URL.
      await page.keyboard.press("Escape");
      await page.goto("/");
    },
  },

  // ── Tree-context (right-click) Modal dialogs ─────────────────────
  // Each requires the fixture to have at least one root emitter so
  // `[data-testid="emitter-tree"] [role="treeitem"]` resolves to a
  // clickable row. The tree-context atom in lib/tree-context.ts is
  // driven by the row's onSelect handlers, which call
  // openDialog(<kind>, emitterId).
  {
    id: "dialog-increment-index",
    setup: async (page) => {
      const firstRow = page
        .locator('[data-testid="emitter-tree"] [role="treeitem"]')
        .first();
      await firstRow.click({ button: "right" });
      await page.locator('[role="menuitem"]:has-text("Increment Index")').click();
      await page.waitForSelector('[role="dialog"]');
    },
    teardown: async (page) => { await dismissModals(page); },
  },
  {
    id: "dialog-rescale-emitter",
    setup: async (page) => {
      const firstRow = page
        .locator('[data-testid="emitter-tree"] [role="treeitem"]')
        .first();
      await firstRow.click({ button: "right" });
      await page.locator('[role="menuitem"]:has-text("Rescale Emitter")').click();
      await page.waitForSelector('[role="dialog"]');
    },
    teardown: async (page) => { await dismissModals(page); },
  },
  {
    id: "dialog-set-link-group",
    setup: async (page) => {
      const firstRow = page
        .locator('[data-testid="emitter-tree"] [role="treeitem"]')
        .first();
      await firstRow.click({ button: "right" });
      await page.locator('[role="menuitem"]:has-text("Set Link Group")').click();
      await page.waitForSelector('[role="dialog"]');
    },
    teardown: async (page) => { await dismissModals(page); },
  },
];

// ─── T7: keyboard / interaction surfaces ──────────────────────────────
//
// These drivers are mode-agnostic — the same setup/teardown recipes are
// consumed by the HWND UIA specs (T9) and the composition DOM-snapshot
// specs (T10). No menu or dialog is left open by any driver here, so
// dismissModals() is not needed; teardowns are either a single Escape
// (cancel rename) or no-op.
//
// Assumption: kbd-emitter-rename-mode assumes the loaded fixture exposes
// at least one root emitter and that F2 on the focused row enters rename
// mode. Whether rename-mode actually appears in the captured UIA tree is
// validated in T9 when goldens are generated.

export const KEYBOARD_SURFACES: SurfaceCapture[] = [
  {
    id: "kbd-tab-cycle-stop-1",
    setup: async (page) => {
      await page.locator('[data-testid="app-shell"]').focus();
      await page.keyboard.press("Tab");
    },
    teardown: async (_page) => { /* no-op */ },
  },
  {
    id: "kbd-tab-cycle-stop-2",
    setup: async (page) => {
      await page.locator('[data-testid="app-shell"]').focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
    },
    teardown: async (_page) => { /* no-op */ },
  },
  {
    id: "kbd-emitter-rename-mode",
    setup: async (page) => {
      await page.locator('[data-testid="emitter-tree"] [role="treeitem"]').first().click();
      await page.keyboard.press("F2");
    },
    teardown: async (page) => { await page.keyboard.press("Escape"); },
  },
  {
    id: "kbd-arrow-tree-expanded",
    setup: async (page) => {
      await page.locator('[data-testid="emitter-tree"] [role="treeitem"]').first().focus();
      await page.keyboard.press("ArrowRight");
    },
    teardown: async (_page) => { /* no-op */ },
  },
];
