# Open-file name in the titlebar + "Particle Editor" rebrand — design

**Date:** 2026-06-11 (session 39)
**Status:** Approved direction (Option A — titlebar), spec pending user review
**User request:** *"I want the UI to display somewhere (potentially the titlebar) the
name of the particle file that is currently open."* Follow-ups during brainstorm:
titlebar chosen over a StatusBar cell; leading `●` dirty marker; filename only
(no path); `Untitled.alo` for a never-saved document; **and** rename the
user-visible app name from `AloParticleEditor` to `Particle Editor` throughout
the UI, including removing the brand label that sits next to **File** in the
header.

---

## 1. Goal + scope

When this ships, the OS window title always reflects the open document —
`plasma_blast.alo — Particle Editor`, with a leading `●` when there are unsaved
changes and `Untitled.alo` when no file is open — and every user-visible
surface says **Particle Editor** instead of **AloParticleEditor**. The
redundant brand label in the menu header row is removed, so the menu bar
starts at **File**.

**In:**

- Titlebar mirrors the document title via a new WebView2
  `DocumentTitleChanged` → `SetWindowTextW` handler in the host.
- Title format reworked in the web's existing title effect:
  - Clean, named: `plasma_blast.alo — Particle Editor`
  - Dirty, named: `● plasma_blast.alo — Particle Editor`
  - Clean, untitled: `Untitled.alo — Particle Editor`
  - Dirty, untitled: `● Untitled.alo — Particle Editor`
- Rebrand of user-visible strings (exact inventory in §3.3): web title
  effect, `index.html` `<title>`, AboutDialog, PrimitivesGallery header,
  host `CreateWindow` title, the WebView2-runtime-missing dialog text, and
  the WebView2-init-failed `MessageBoxW` caption.
- Remove the `<span>AloParticleEditor</span>` header brand label next to
  the MenuBar.
- Full a11y golden regen + updates to the existing title assertions.

**Out:**

- **All storage identifiers keep `AloParticleEditor`** — registry key
  `HKCU\Software\AloParticleEditor`, log path
  `%LOCALAPPDATA%\AloParticleEditor\host.log`, autosave + WebView2
  user-data dirs under `%TEMP%\AloParticleEditor*`. Renaming these would
  silently orphan every existing user's settings, recent files, autosaves,
  and cached WebView2 state. Deliberately excluded; revisit only if a
  migration story is ever wanted (no current reason).
- Internal non-visible identifiers: window class names
  (`kHostWindowClassName`, `AloHostViewport`), the `AloParticleEditor-DevProbe`
  WinHTTP user-agent. Not user-visible; the test harness finds the window
  by class.
- Legacy UI (`--legacy`, `src/main.cpp` chrome) — slated for removal
  (MT-13); not worth rebranding.
- Dev scaffolding: `src/host/spike/*`, `viewport_poc.cpp` ("PoC" captions).
- The "Forked from Mike.NL's GlyphX Particle Editor v1.5" credit — names
  the fork source, not this app; unchanged.
- A StatusBar filename cell (Option B from the brainstorm) — user chose
  the titlebar; the StatusBar echo can be a future ask if wanted.
- Repo/binary/product-internal names (`AloParticleEditor.exe`, repo name,
  bridge-schema comments) — not UI.

## 2. What the codebase already gives us

- **The title string is already computed.** The web's title effect
  ([`App.tsx:116-129`](../../../web/apps/editor/src/App.tsx)) derives
  `* foo.alo — AloParticleEditor` from `useFileState()` and sets
  `document.title`. The file path + dirty flag arrive via the established
  [`file-state.ts`](../../../web/apps/editor/src/lib/file-state.ts) Zustand
  atom (seeded from the snapshot, kept live by `dirty/changed` +
  `engine/state/changed`). The host is the source of truth
  (`m_currentFilePath` / `m_dirty` in `BridgeDispatcher`).
- **The gap is purely host-side:** `document.title` never reaches the OS
  window. The Win32 title is set once at `CreateWindowExW`
  ([`HostWindow.cpp:3329-3331`](../../../src/host/HostWindow.cpp)) and there
  is no `DocumentTitleChanged` subscription.
- **The natural wiring point exists:** `FinishWebView2ControllerSetup`
  ([`HostWindow.cpp:1221`](../../../src/host/HostWindow.cpp)) is where the
  host wires WebView2 events (`add_AcceleratorKeyPressed` precedent at
  `:1316`); `webView` (ComPtr) and `hMain` (HWND) are both members in scope.
- **Native coverage exists for the title:** the file-ops native spec
  ([`tests/file-ops.spec.ts:183-221`](../../../web/apps/editor/tests/file-ops.spec.ts))
  asserts `document.title` for the clean-named and dirty cases. The UIA
  HWND-lane goldens capture the top-level window Name (currently the
  static `AloParticleEditor`), so they will capture — and prove — the
  mirrored dynamic title.
- A `basename()` precedent lives in
  [`MenuBar.tsx:159`](../../../web/apps/editor/src/components/MenuBar.tsx)
  (Recent Files), and the title effect already does the same split inline.

## 3. Design

### 3.1 Title mirror (host)

One handler added in `FinishWebView2ControllerSetup`, beside the existing
event wiring:

```cpp
// Mirror the web document title into the Win32 titlebar. The web owns
// the title format (dirty marker + basename + app name) in App.tsx;
// the host just reflects it, so there is exactly one source of truth.
webView->add_DocumentTitleChanged(
    Callback<ICoreWebView2DocumentTitleChangedEventHandler>(
        [this](ICoreWebView2* sender, IUnknown*) -> HRESULT
        {
            wil::unique_cotaskmem_string title;   // or LPWSTR + CoTaskMemFree
            if (SUCCEEDED(sender->get_DocumentTitle(&title)) && title)
                SetWindowTextW(hMain, title.get());
            return S_OK;
        }).Get(), nullptr);
```

(Exact smart-pointer idiom to match whatever the file already uses for
returned strings; the codebase uses raw `ComPtr` + manual patterns, the
implementer follows local convention.)

`DocumentTitleChanged` is on the base `ICoreWebView2` interface, so it
works identically in composition and HWND hosting modes. It fires once
for `index.html`'s static `<title>` at navigation and then on every
`document.title` assignment from React.

The `CreateWindowExW` initial title changes to `L"Particle Editor"` so the
pre-WebView2 titlebar is already correct (no `AloParticleEditor` flash);
`index.html`'s `<title>` becomes `Particle Editor` for the same reason.
All three stages (CreateWindow → index.html → React effect) agree on the
app name; the document part (`Untitled.alo — `) arrives with React's
first title effect, milliseconds after mount.

### 3.2 Title format (web)

The existing effect in `App.tsx` is reworked (same hook, same inputs):

```
const APP_NAME = "Particle Editor";
const docName  = currentFilePath ? basename(currentFilePath) : "Untitled.alo";
document.title = `${dirty ? "● " : ""}${docName} — ${APP_NAME}`;
```

Notes:

- The document part is now **always present** (`Untitled.alo` replaces the
  old bare-app-name untitled form). `Untitled.alo` keeps the extension so
  the slot reads as a real document.
- Dirty marker is `"● "` (U+25CF + space), leading — per the approved
  mockup. `document.title` and `SetWindowTextW` are both UTF-16; no
  encoding concern.
- The inline basename split already in the effect stays (or is shared
  with MenuBar's `basename()` if the implementer prefers — either is
  fine; no new module is warranted for three lines).

### 3.3 Rebrand inventory (user-visible strings only)

| Site | Change |
| --- | --- |
| [`App.tsx`](../../../web/apps/editor/src/App.tsx) title effect `APP_NAME` | `"AloParticleEditor"` → `"Particle Editor"` |
| [`App.tsx:159`](../../../web/apps/editor/src/App.tsx) header `<span>AloParticleEditor</span>` | **Removed** (menu bar starts at File) |
| [`index.html`](../../../web/apps/editor/index.html) `<title>` | → `Particle Editor` |
| [`AboutDialog.tsx`](../../../web/apps/editor/src/screens/AboutDialog.tsx) modal title + name line | `About Particle Editor` / `Particle Editor` |
| [`PrimitivesGallery.tsx:78`](../../../web/apps/editor/src/screens/PrimitivesGallery.tsx) header span | → `Particle Editor` (dev gallery mimics the app header) |
| [`HostWindow.cpp:3330`](../../../src/host/HostWindow.cpp) `CreateWindowExW` title | → `L"Particle Editor"` |
| [`HostWindow.cpp:3255`](../../../src/host/HostWindow.cpp) WebView2-runtime-missing dialog text | "Particle Editor requires the Microsoft Edge WebView2 Runtime." |
| [`HostWindow.cpp:3423`](../../../src/host/HostWindow.cpp) `MessageBoxW` caption | → `L"Particle Editor"` |

Everything else that greps for `AloParticleEditor` is storage, internal
identifier, comment, legacy, or dev scaffolding — unchanged (§1 Out).

## 4. Risks + mitigations

1. **Golden churn masks a real regression.** The full `pnpm a11y:update`
   regen (L-081 — never a `--grep` partial) will touch every golden that
   embeds the window name, the document-title node, or the header span.
   *Mitigation:* the review gate is that the golden diff contains **only**
   (a) brand/title text substitutions and (b) the removed header-span
   node. Any structural diff beyond those two classes blocks the merge.
2. **Title-based window lookup breaking.** Checked: the UIA capture
   helper finds the window by **class** (`FindWindow("AloHostViewport",
   null)` → parent walk, [`tests/helpers/uia.ts:80-98`](../../../web/apps/editor/tests/helpers/uia.ts));
   nothing in the harness or host matches on the title string. Window
   classes are out of scope. *Accepted as resolved — no mitigation needed.*
3. **Settings/autosave orphaning via over-eager rename.** The sharpest
   hazard of "rename throughout": registry/log/autosave paths are
   load-bearing identity. *Mitigation:* §1 Out makes the boundary explicit;
   the plan's rebrand task enumerates the eight §3.3 sites rather than a
   find-and-replace.
4. **`DocumentTitleChanged` not firing in composition mode.** It is a base
   `ICoreWebView2` event, hosting-mode-independent; and the a11y goldens
   would catch a silent failure (root window Name would stay
   `Particle Editor` instead of `a11y-base-state.alo — Particle Editor`).
   *Mitigation:* covered by the golden assertion; plus a manual launch in
   the feel test.
5. **Non-deterministic golden titles.** The root window Name now varies
   with file state at capture time. The goldens already capture the
   dynamic document-title node (`a11y-base-state.alo — AloParticleEditor`),
   so determinism of file state at capture is established practice — the
   root simply joins it. *Accepted.*

## 5. Testing & verification

**Unit (web, jsdom):**
- Title effect: all four format cases (clean/dirty × named/untitled),
  including the `●` prefix and the em-dash separator. (New or extended
  tests near the existing App/file-state coverage.)
- AboutDialog test updated for `About Particle Editor`.
- Header: assert the app shell no longer renders the brand span (MenuBar
  is the header's first content).

**Native (real host + WebView2):**
- [`file-ops.spec.ts`](../../../web/apps/editor/tests/file-ops.spec.ts)
  title test updated: `● ` prefix instead of `* `, `Particle Editor`
  instead of `AloParticleEditor`, plus an untitled-state assertion
  (`Untitled.alo — Particle Editor` after `file/new`).
- UIA goldens (full regen): root window Name =
  `a11y-base-state.alo — Particle Editor` — this **is** the end-to-end
  proof that `SetWindowTextW` mirroring works.
- Full native harness green (~180 specs; L-066 — if only
  `preview-overload` specs fail with SIGTERM at the tail, re-run them in
  isolation before suspecting this change).

**Manual (pre-handoff, then user feel test):**
- Cold launch: titlebar reads `Untitled.alo — Particle Editor` from first
  paint (no `AloParticleEditor` flash).
- Open a file → name appears; edit → `●` appears; save → `●` clears;
  Save As → name updates; File → New → back to `Untitled.alo`.
- Alt-Tab + taskbar show the same title.
- Header row starts at **File**; About dialog shows the new name.

**Build:** host Debug x64 clean; web `tsc -b` 0; full web suite green
(800 + new).
