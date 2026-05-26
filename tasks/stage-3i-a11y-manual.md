# Stage 3i — A11y manual verification checklist

**One-time confidence pass, executed at ship. Re-run on demand if
suspicion arises.**

> **2026-05-26 — Narrator-speech section deferred.** The Narrator
> is a UIA client; the 29 UIA goldens at
> [`web/apps/editor/tests/a11y-goldens/`](../web/apps/editor/tests/a11y-goldens/)
> already pin every surface's `Name` + `ControlType` + state, so the
> per-surface Narrator-speech pass is largely redundant with automated
> coverage. The bits that goldens *don't* cover are Narrator's
> speech-shaping layer — image alt-text handling, "1 of 7" list-position
> synthesis, punctuation/symbol announcement, group/landmark traversal
> voiceover. That's filed as a follow-up in
> [`tasks/HANDOFF.md`](HANDOFF.md) "Known follow-ups" and not gating
> Phase 3 close-out. The Narrator-speech section below is kept intact
> so it can be re-activated by ticking through it + recording the .mp4
> at any later sit-down; just remove this notice when doing so.

The automated Playwright gates (HWND lane via Win32 UIA inspector +
composition lane via `page.accessibility.snapshot()`) cover the
structural a11y tree for every surface listed in
[`web/apps/editor/tests/a11y-goldens/`](../web/apps/editor/tests/a11y-goldens/).
This checklist covers the *interactive* behaviours and the
*Narrator-speech* layer that the goldens can't assert: keyboard
navigation flow, focus trap correctness, IME composition,
and that screen-reader output matches what the UIA tree promises.

---

## Prerequisite Narrator config

Set these in **Windows Settings → Accessibility → Narrator** before
starting. Capture a screenshot of the Narrator Settings panel as the
opening frame of the Narrator-speech recording (T14) so future
operators can reproduce the config without guessing.

- **Verbosity level:** 1 (default)
- **Default voice:** Microsoft David / Zira / equivalent (whichever
  is installed default — capture which one)
- **Read by character mode:** OFF
- **Hear advanced detail (control type / state):** ON (default)
- **Echo characters / words as you type:** default
- **Narrator key:** default (Caps Lock or Insert)

If Narrator is not already enabled, **Ctrl+Win+Enter** toggles it.

---

## Tab cycle (each mode)

Run the full Tab walk under default HWND mode first; repeat under
`ALO_WEBVIEW2_HOSTING=composition` (rebuild dist/ with matching
`VITE_*` pair per HANDOFF.md "How to run composition mode locally").

- [ ] Launch editor in HWND mode. From app load, press **Tab**
      without clicking anywhere first.
- [ ] Walk every interactive element with Tab: menubar items →
      toolbar buttons → emitter tree → property tab list → first
      focused input in each property tab → spawner controls →
      viewport pill → ... cycle back to menubar. Verify at each
      stop:
  - [ ] Focus indicator is visible (outline / ring / highlight)
  - [ ] No silent Tab traps — focus eventually returns to menubar
  - [ ] No phantom Tab stops on non-interactive elements
        (decorative icons, status text, etc.)
- [ ] **Shift+Tab** the entire cycle in reverse. Same checks.
- [ ] Open each modal dialog from the surface list below; verify
      Tab cycles **within the dialog only** (focus trap correct,
      no escape into chrome behind it).
- [ ] Repeat the entire pass under composition mode.

---

## F2 inline rename

- [ ] Select an emitter in the tree (single click or arrow-key).
- [ ] Press **F2**. Verify: edit mode enters, cursor is in the
      field, existing name is selected as the initial selection.
- [ ] Type a new name. Press **Enter** → commit; the tree row shows
      the new name; the document is dirty.
- [ ] Press **F2** again. Type a different name. Press **Escape**
      → cancel; the tree row reverts to the previous name; the
      document is *not* dirtied.

---

## Escape close

- [ ] Open any menubar menu via mouse. Press **Escape** → menu
      closes; focus returns to the originating menubar button.
- [ ] Open the Save Changes prompt (File → New on a dirty document).
      Press **Escape** → dialog closes; treated as Cancel; the
      pending action does not fire.
- [ ] Open any modal dialog from the surface list below. Press
      **Escape** → dialog closes; focus returns to the chrome
      element that opened it.
- [ ] **Escape on an empty app state** (no menu / no dialog / no
      rename in progress) → no-op; the editor does not exit, no
      side effects.

---

## Arrow-key tree navigation

- [ ] Click the emitter tree to give it focus.
- [ ] **Up/Down arrows** — navigate sibling rows; the focused row
      changes, the selected emitter changes (preview updates if a
      preview is visible).
- [ ] **Right arrow on a collapsed node** — expands the node;
      focus stays on the parent.
- [ ] **Right arrow on an already-expanded node** — moves focus to
      the first child.
- [ ] **Left arrow on an expanded node** — collapses; focus stays
      on the parent.
- [ ] **Left arrow on a collapsed node** (or root with no parent)
      — moves focus to the parent (or no-op at root).
- [ ] **Right arrow on a leaf** — no-op.
- [ ] **Home / End** — jump to first / last visible row.

---

## IME compose smoke

Requires a Japanese (or other CJK) IME installed:
**Windows Settings → Time & Language → Language & region → Add a
language → 日本語**.

- [ ] Open the **Mod Nickname** dialog (Mods menu → Set Nickname…,
      or whichever path is current).
- [ ] Switch IME on (Win+Space or language-bar selection).
- [ ] Type a Hiragana sequence (e.g. `konnichiwa` → こんにちは).
- [ ] Composition popup appears under the cursor in the input
      field, not displaced or behind chrome.
- [ ] Press **Space** → IME suggests Kanji conversions in a
      candidate list.
- [ ] Select a candidate (arrow keys + Enter, or click). The
      composition commits to the field as the selected Kanji.
- [ ] Press **Enter** in the field → the dialog accepts; the
      committed Kanji is the new nickname.

---

## Narrator-speech pass

For each surface below, launch the editor with Narrator running per
**Prerequisite** above, navigate to the surface (HWND mode for the
recording — composition mode coverage is structural via DOM-snapshot
goldens), and verify Narrator's announcement matches the surface's
UIA tree (`Name` + `ControlType` + state) per the committed golden
at `web/apps/editor/tests/a11y-goldens/<surface>.golden.json`.

The recording (T14) covers the same surfaces; this checklist is the
written log to tick off as you go.

### Chrome (3)

- [ ] **menubar-closed** — app-shell focused, menubar visible,
      no menu open. Narrator announces the focused menubar button.
- [ ] **toolbar** — toolbar focused. Narrator walks the toolbar
      buttons in order (Open, Save, dropdowns…).
- [ ] **viewport-pill** — viewport pill focused. Narrator
      announces the pill's role + any badge text.

### Menubar (7) — one per menu open

- [ ] **menubar-file-open**
- [ ] **menubar-edit-open**
- [ ] **menubar-emitters-open**
- [ ] **menubar-mods-open**
- [ ] **menubar-view-open**
- [ ] **menubar-help-open**

For each: open the menu (click or Alt+letter). Narrator announces
each menu-item's `Name` + enabled/disabled state as you arrow-key
through it. Confirm separators are not announced as items.

### Trees + tabs (4)

- [ ] **emitter-tree** — tree focused with at least one root
      emitter. Narrator announces the row's name + level + expanded
      state as you arrow-key.
- [ ] **property-tabs-basic** — Basic tab active. Narrator
      announces "Basic, tab, selected" then walks the form fields
      with Tab.
- [ ] **property-tabs-appearance** — Appearance tab active. Same.
- [ ] **property-tabs-physics** — Physics tab active. Same.

### Dialogs (10)

- [ ] **dialog-about** — Help → About.
- [ ] **dialog-bloom-settings** — View / Render menu → Bloom…
- [ ] **dialog-import-emitters** — File → Import Emitters from
      File… (LT-3 entry point).
- [ ] **dialog-increment-index** — Emitter → Duplicate (Increment
      Index)… (or equivalent).
- [ ] **dialog-lighting** — View / Render menu → Lighting…
- [ ] **dialog-mod-nickname** — Mods → Set Nickname…
- [ ] **dialog-rescale-emitter** — Emitter → Rescale…
- [ ] **dialog-rescale-system** — Edit / System → Rescale System…
- [ ] **dialog-reset-view-settings** — View → Reset View
      Settings…
- [ ] **dialog-set-link-group** — Emitter context-menu → Link
      Group Settings… (requires a linked emitter — load any
      fixture with a multi-member link group).

For each dialog: open via the path above, focus traps to the
dialog, Narrator announces the dialog title + first focused
control. Tab walks the controls in order. Escape returns focus
to the chrome.

### Keyboard scenarios (4)

These capture transient UI states the structural goldens already
snapshot — the manual pass confirms Narrator reads them coherently.

- [ ] **kbd-tab-cycle-stop-1** — first Tab stop from app load.
- [ ] **kbd-tab-cycle-stop-2** — second Tab stop.
- [ ] **kbd-emitter-rename-mode** — F2 edit mode active on a
      tree row. Narrator announces "edit mode" or equivalent.
- [ ] **kbd-arrow-tree-expanded** — tree row expanded via Right
      arrow. Narrator announces the new expanded state.

### Focused inputs (2)

- [ ] **curve-editor-focused** — curve editor receives focus
      (Tab into the bottom curve panel). Narrator announces the
      canvas / SVG role.
- [ ] **spinner-focused** — any drag-to-scrub number spinner
      receives focus. Narrator announces the spinner role +
      current value + min/max.

---

## Recording artefact

Screen+audio capture of the entire Narrator-speech pass goes to
**`tasks/stage-3i-narrator-recording.mp4`** (committed via T14).
Open with the Narrator Settings panel visible so the config used is
self-evident; walk the surfaces in the order listed above so the
recording is greppable against this checklist.

Target length ~5 minutes (one short read-aloud per surface is
enough; no need to exhaustively explore every nested control —
that's what the goldens are for).
