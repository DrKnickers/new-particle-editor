# Open-file name in the titlebar + "Particle Editor" rebrand — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The OS window title always shows the open `.alo` document (`● plasma_blast.alo — Particle Editor`), and every user-visible surface says "Particle Editor" instead of "AloParticleEditor", with the redundant header brand label removed.

**Architecture:** The web already computes the title from `useFileState()` and sets `document.title` ([App.tsx:116-129](../../../web/apps/editor/src/App.tsx)); we extract that format into a pure, unit-tested helper and add ONE host handler (`DocumentTitleChanged` → `SetWindowTextW`) so the Win32 titlebar mirrors it — single source of truth stays in React. The rebrand is an enumerated 8-site change (spec §3.3), **never** a find-and-replace: registry/log/autosave paths and window-class names keep `AloParticleEditor` (spec §1 Out — renaming them orphans user settings).

**Tech Stack:** React 19 + Zustand (web), Vitest/jsdom (unit), WebView2 COM (`ICoreWebView2::add_DocumentTitleChanged`) + Win32 (host), Playwright-style native harness + UIA goldens (end-to-end).

**Spec:** [docs/superpowers/specs/2026-06-11-open-file-titlebar-rebrand-design.md](../specs/2026-06-11-open-file-titlebar-rebrand-design.md)

---

## File structure

| File | Action | Responsibility |
| --- | --- | --- |
| `web/apps/editor/src/lib/window-title.ts` | **Create** | Pure title formatter: `formatWindowTitle(path, dirty)` + `APP_NAME` + `UNTITLED_DOC` constants |
| `web/apps/editor/src/lib/__tests__/window-title.test.ts` | **Create** | Unit tests for all four format cases + basename edge cases |
| `web/apps/editor/src/App.tsx` | Modify (~:105-129, :159) | Title effect delegates to the helper; header brand `<span>` removed |
| `web/apps/editor/index.html` | Modify (:14) | Static `<title>` → `Particle Editor` |
| `web/apps/editor/src/screens/AboutDialog.tsx` | Modify (:29, :35) | Dialog title + name line |
| `web/apps/editor/src/screens/PrimitivesGallery.tsx` | Modify (:78) | Dev-gallery header span (mimics app header) |
| `src/host/HostWindow.cpp` | Modify (:394 region, ~:1354, ~:2613 region, :3255, :3330, :3423) | `docTitleTok` member; `DocumentTitleChanged` mirror handler + teardown unsubscribe; 3 brand strings |
| `web/apps/editor/tests/file-ops.spec.ts` | Modify (:181-221) | Native title assertions → new conventions + untitled case |
| `web/apps/editor/tests/a11y-goldens/**` | Regenerate (full) | Brand/title text + removed header span |
| `CHANGELOG.md` | Modify (top) | New entry (hash TODO until merge) |

Out of scope (do NOT touch — spec §1): `kRegistryKeyPath`, `%LOCALAPPDATA%\AloParticleEditor\host.log` paths, `%TEMP%\AloParticleEditor*` dirs, `kHostWindowClassName`, `AloHostViewport`, the `AloParticleEditor-DevProbe` user-agent, `src/main.cpp` legacy chrome, `src/host/spike/*`, `viewport_poc.cpp`, the "GlyphX Particle Editor v1.5" credit line, `a11y-normalizer.test.ts` fixture data (arbitrary sample names, not UI).

---

## Task 0: Pre-flight (fresh worktree)

Skip any step whose artifact already exists. All commands from the worktree root unless noted; MSBuild via PowerShell, never Git-Bash (L-046).

- [ ] **Step 1: Lineage check**

```powershell
git fetch origin master; git log --oneline master..HEAD; git log --oneline HEAD..master
```

Expected: `HEAD..master` count 0 (plus this branch's spec/plan commits in `master..HEAD`).

- [ ] **Step 2: NuGet package materialisation (L-039)**

If `packages\Microsoft.Web.WebView2.1.0.3967.48\build\native\Microsoft.Web.WebView2.targets` is missing, copy the global cache:

```powershell
Copy-Item -Recurse "$env:USERPROFILE\.nuget\packages\microsoft.web.webview2\1.0.3967.48\*" "packages\Microsoft.Web.WebView2.1.0.3967.48\"
```

(Version source of truth: `src/packages.config` — re-check if the copy fails.)

- [ ] **Step 3: Web install + dist build (L-040)**

```powershell
cd web; pnpm install; pnpm --filter @particle-editor/editor build
```

Expected: install clean, vite build clean.

- [ ] **Step 4: Baseline web suite + types**

```powershell
cd web; pnpm --filter @particle-editor/editor test
cd web; pnpm --filter @particle-editor/editor exec tsc -b
```

Expected: **800 passed**, tsc exit 0. (Never run vitest and vite build concurrently — L-046.)

- [ ] **Step 5: Baseline host build (Debug x64)**

```powershell
& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" ParticleEditor.sln -p:Configuration=Debug -p:Platform=x64 -m
```

Expected: 0 errors (benign LNK4098 warning is normal).

---

## Task 1: `formatWindowTitle` pure helper (TDD)

**Files:**
- Create: `web/apps/editor/src/lib/window-title.ts`
- Create: `web/apps/editor/src/lib/__tests__/window-title.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// window-title.test.ts — title format contract for the Win32 titlebar
// mirror (spec §3.2). Four cases: clean/dirty × named/untitled, plus
// basename handling for both path separator styles.
import { describe, expect, test } from "vitest";
import { formatWindowTitle } from "../window-title";

describe("formatWindowTitle", () => {
  test("clean + named: basename — app name", () => {
    expect(formatWindowTitle("C:\\Mods\\fx\\plasma_blast.alo", false)).toBe(
      "plasma_blast.alo — Particle Editor",
    );
  });

  test("dirty + named: leading ● before basename", () => {
    expect(formatWindowTitle("C:\\Mods\\fx\\plasma_blast.alo", true)).toBe(
      "● plasma_blast.alo — Particle Editor",
    );
  });

  test("clean + untitled: Untitled.alo placeholder", () => {
    expect(formatWindowTitle(null, false)).toBe(
      "Untitled.alo — Particle Editor",
    );
  });

  test("dirty + untitled: ● Untitled.alo", () => {
    expect(formatWindowTitle(null, true)).toBe(
      "● Untitled.alo — Particle Editor",
    );
  });

  test("forward-slash paths split correctly", () => {
    expect(formatWindowTitle("C:/Temp/title-test.alo", false)).toBe(
      "title-test.alo — Particle Editor",
    );
  });

  test("bare filename (no separator) passes through", () => {
    expect(formatWindowTitle("loose.alo", false)).toBe(
      "loose.alo — Particle Editor",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```powershell
cd web; pnpm --filter @particle-editor/editor test -- window-title
```

Expected: FAIL — cannot resolve `../window-title`.

- [ ] **Step 3: Write the implementation**

```ts
// window-title.ts — pure formatter for the document/window title.
//
// The titlebar pipeline: this string is assigned to `document.title` by
// App.tsx's title effect; the host mirrors it into the Win32 titlebar
// via ICoreWebView2 DocumentTitleChanged → SetWindowTextW
// (src/host/HostWindow.cpp, FinishWebView2ControllerSetup). Keeping the
// format here — not in C++ — preserves a single source of truth and
// keeps it unit-testable.
//
// Format (spec 2026-06-11-open-file-titlebar-rebrand §3.2):
//   - Clean, named    : `foo.alo — Particle Editor`
//   - Dirty, named    : `● foo.alo — Particle Editor`
//   - Clean, untitled : `Untitled.alo — Particle Editor`
//   - Dirty, untitled : `● Untitled.alo — Particle Editor`

export const APP_NAME = "Particle Editor";
export const UNTITLED_DOC = "Untitled.alo";

export function formatWindowTitle(
  currentFilePath: string | null,
  dirty: boolean,
): string {
  const doc = currentFilePath ? basename(currentFilePath) : UNTITLED_DOC;
  return `${dirty ? "● " : ""}${doc} — ${APP_NAME}`;
}

// Same split MenuBar's Recent Files uses; duplicated 3-liner rather than
// exporting from a component module.
function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```powershell
cd web; pnpm --filter @particle-editor/editor test -- window-title
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```powershell
git add web/apps/editor/src/lib/window-title.ts web/apps/editor/src/lib/__tests__/window-title.test.ts
git commit -m "feat(title): formatWindowTitle helper — ● dirty marker, Untitled.alo, Particle Editor brand"
```

---

## Task 2: App.tsx — wire the helper, drop the header brand span

**Files:**
- Modify: `web/apps/editor/src/App.tsx:105-129` (title effect) and `:156-167` (header)

- [ ] **Step 1: Replace the title effect**

Current code at `App.tsx:105-129` (comment block + effect). Replace the whole block with:

```tsx
  // Window title — single source of truth for the titlebar. The host
  // mirrors document.title into the Win32 titlebar (DocumentTitleChanged
  // → SetWindowTextW in HostWindow.cpp), so this effect drives the OS
  // title, taskbar, and Alt-Tab text. Format cases live (tested) in
  // lib/window-title.ts.
  const { currentFilePath, dirty } = useFileState();
  useEffect(() => {
    document.title = formatWindowTitle(currentFilePath, dirty);
  }, [currentFilePath, dirty]);
```

Add the import next to the existing `useFileState` import:

```tsx
import { formatWindowTitle } from "@/lib/window-title";
```

- [ ] **Step 2: Remove the header brand span**

At `App.tsx:158-159`, the header currently opens:

```tsx
          <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-bg px-4 text-sm">
            <span className="font-semibold">AloParticleEditor</span>
```

Delete the `<span className="font-semibold">AloParticleEditor</span>` line only — `<MenuBar …>` becomes the header's first child, so the menu row starts at **File**.

Coverage note (conscious spec §5 deviation): no jsdom app-shell test exists to assert the span's absence — verified by grep, App.tsx has no unit-test harness. The a11y goldens (both lanes capture the header region) are the regression net; their Task 6 diff must show the span node disappearing.

- [ ] **Step 3: Run the web suite + types**

```powershell
cd web; pnpm --filter @particle-editor/editor test
cd web; pnpm --filter @particle-editor/editor exec tsc -b
```

Expected: 806 passed (800 baseline + 6 from Task 1), tsc exit 0. Nothing in the jsdom lane asserts the old title format or the header span (verified by grep), so no existing test should break.

- [ ] **Step 4: Commit**

```powershell
git add web/apps/editor/src/App.tsx
git commit -m "feat(title): App title effect uses formatWindowTitle; drop header brand span"
```

---

## Task 3: Remaining web brand strings

**Files:**
- Modify: `web/apps/editor/index.html:14`
- Modify: `web/apps/editor/src/screens/AboutDialog.tsx:29,35`
- Modify: `web/apps/editor/src/screens/PrimitivesGallery.tsx:78`

- [ ] **Step 1: index.html static title**

`<title>AloParticleEditor</title>` → `<title>Particle Editor</title>`

(This is the title `DocumentTitleChanged` first fires with, before React mounts — it must agree with the host's `CreateWindowExW` brand from Task 4.)

- [ ] **Step 2: AboutDialog**

- `:29` — `title="About AloParticleEditor"` → `title="About Particle Editor"`
- `:35` — name line `AloParticleEditor` → `Particle Editor`

Leave `:44` ("Forked from Mike.NL's GlyphX Particle Editor v1.5") unchanged — it names the fork source.

- [ ] **Step 3: PrimitivesGallery header span**

`:78` — `<span className="font-semibold">AloParticleEditor</span>` → `<span className="font-semibold">Particle Editor</span>` (dev gallery; keeps its span since it's a standalone page header, only the brand text changes).

- [ ] **Step 4: Run targeted tests + full suite**

```powershell
cd web; pnpm --filter @particle-editor/editor test -- AboutDialog
cd web; pnpm --filter @particle-editor/editor test
```

Expected: AboutDialog tests pass (they assert the GlyphX credit, which is unchanged); full suite 806.

- [ ] **Step 5: Commit**

```powershell
git add web/apps/editor/index.html web/apps/editor/src/screens/AboutDialog.tsx web/apps/editor/src/screens/PrimitivesGallery.tsx
git commit -m "feat(rebrand): Particle Editor in index.html title, About dialog, primitives gallery"
```

---

## Task 4: Host — DocumentTitleChanged mirror + brand strings

**Files:**
- Modify: `src/host/HostWindow.cpp` — member at `:394` region, handler in `FinishWebView2ControllerSetup` (after the AcceleratorKeyPressed registration, ~`:1354`), unsubscribe in the teardown block (~`:2613` region), brand strings at `:3255`, `:3330`, `:3423`

- [ ] **Step 1: Add the registration-token member**

Next to the existing token at `:394`:

```cpp
    EventRegistrationToken          accelKeyTok = {};
```

add:

```cpp
    EventRegistrationToken          docTitleTok = {};
```

- [ ] **Step 2: Register the title mirror**

In `FinishWebView2ControllerSetup`, immediately after the `add_AcceleratorKeyPressed` registration + its log line (~`:1354`), insert:

```cpp
    // Mirror the web document title into the Win32 titlebar. React owns
    // the title format (dirty ● + basename + app name — see
    // web/apps/editor/src/lib/window-title.ts); the host just reflects
    // document.title so the titlebar, taskbar, and Alt-Tab always show
    // the open .alo file. Fires once for index.html's static <title> at
    // navigation, then on every document.title assignment.
    if (webView)
    {
        webView->add_DocumentTitleChanged(
            Callback<ICoreWebView2DocumentTitleChangedEventHandler>(
                [this](ICoreWebView2* sender, IUnknown* /*args*/) -> HRESULT
                {
                    LPWSTR title = nullptr;
                    if (SUCCEEDED(sender->get_DocumentTitle(&title)) && title)
                    {
                        SetWindowTextW(hMain, title);
                        CoTaskMemFree(title);
                    }
                    return S_OK;
                }).Get(),
            &docTitleTok);
        Log("[host] DocumentTitleChanged handler registered\n");
    }
```

(`LPWSTR` + `CoTaskMemFree` is the file's established idiom for WebView2 string getters — see `:1401-1465`. `ICoreWebView2DocumentTitleChangedEventHandler` is in `WebView2.h`, already included.)

- [ ] **Step 3: Unsubscribe in teardown**

In the teardown block where `accelKeyTok` is removed (~`:2613`):

```cpp
            if (accelKeyTok.value != 0)
            {
                webController->remove_AcceleratorKeyPressed(accelKeyTok);
                accelKeyTok = {};
```

add the same pattern for the new token, guarded on `webView` (the handler hangs off `ICoreWebView2`, not the controller):

```cpp
            if (docTitleTok.value != 0 && webView)
            {
                webView->remove_DocumentTitleChanged(docTitleTok);
                docTitleTok = {};
            }
```

Place it adjacent to the accelKeyTok removal, matching the surrounding brace style.

- [ ] **Step 4: Brand strings (3 sites)**

- `:3330` — `CreateWindowExW(0, kHostWindowClassName, L"AloParticleEditor", …)` → `L"Particle Editor"` (kills the pre-WebView2 brand flash; `kHostWindowClassName` itself unchanged).
- `:3255` — dialog text `L"AloParticleEditor requires the Microsoft Edge WebView2 Runtime.\n\n"` → `L"Particle Editor requires the Microsoft Edge WebView2 Runtime.\n\n"` (the `L"WebView2 Runtime Required"` caption at `:3259` stays).
- `:3423` — `MessageBoxW(hMain, msg, L"AloParticleEditor", MB_ICONERROR)` → `L"Particle Editor"`.

- [ ] **Step 5: Build Debug x64**

```powershell
& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" ParticleEditor.sln -p:Configuration=Debug -p:Platform=x64 -m
```

Expected: 0 errors (benign LNK4098 ok).

- [ ] **Step 6: Commit**

```powershell
git add src/host/HostWindow.cpp
git commit -m "feat(title): mirror document.title into the Win32 titlebar; Particle Editor brand in host strings"
```

---

## Task 5: Native title spec — new conventions + untitled case

**Files:**
- Modify: `web/apps/editor/tests/file-ops.spec.ts:181-221`

- [ ] **Step 1: Rebuild dist first (L-040 — native lane serves `dist/`)**

```powershell
cd web; pnpm --filter @particle-editor/editor build
```

(Run alone — never concurrent with vitest, L-046.)

- [ ] **Step 2: Update the existing title test + add the untitled case**

Replace the test body at `:183-221` with exact-match assertions (NB: `toContain("Particle Editor")` would be a tautology — it's a substring of `AloParticleEditor`; assert with `toBe`):

```ts
test("Window title reflects dirty + currentFilePath", async () => {
  // Pre-seed a path so the title's basename branch is exercised.
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = (window as any).bridge;
    await b.request({
      kind: "file/save",
      params: { path: "C:/Temp/title-test.alo" },
    });
  });

  // Give React a tick to react to the snapshot event + update title.
  await page.waitForFunction(
    () => /title-test\.alo/.test(document.title),
    null,
    { timeout: 3000 },
  );

  // Clean + named — exact match (NOT toContain: "Particle Editor" is a
  // substring of the old "AloParticleEditor", so contains-checks can't
  // prove the rebrand).
  const cleanTitle = await page.title();
  expect(cleanTitle).toBe("title-test.alo — Particle Editor");

  // Now mutate and assert the ● prefix appears.
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = (window as any).bridge;
    await b.request({ kind: "engine/set/ground-z", params: { z: 5 } });
  });
  await page.waitForFunction(
    () => document.title.startsWith("● "),
    null,
    { timeout: 3000 },
  );
  const dirtyTitle = await page.title();
  expect(dirtyTitle).toBe("● title-test.alo — Particle Editor");
});

// ── 5. Untitled state: file/new resets the title to the placeholder ────────

test("Window title shows Untitled.alo after file/new", async () => {
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = (window as any).bridge;
    await b.request({ kind: "file/new", params: {} });
  });
  await page.waitForFunction(
    () => document.title === "Untitled.alo — Particle Editor",
    null,
    { timeout: 3000 },
  );
});
```

Also update the section comment at `:181` from `document.title reflects dirty + currentFilePath` numbering if needed (cosmetic).

- [ ] **Step 3: Run the file-ops specs in isolation**

```powershell
cd web/apps/editor; node ./scripts/run-native-tests.mjs --grep "Window title"
```

(Invoke the runner via `node` directly — `pnpm … a11y -- --grep X` mangles the `--`, per session-38 handoff.)

Expected: 2 passed (the runner's SIGTERM teardown line at exit is normal).

- [ ] **Step 4: Commit**

```powershell
git add web/apps/editor/tests/file-ops.spec.ts
git commit -m "test(title): native title assertions — ● marker, Particle Editor, Untitled.alo case"
```

---

## Task 6: a11y golden regen (full) + native harness

**Files:**
- Regenerate: `web/apps/editor/tests/a11y-goldens/**` (full regen ONLY — a `--grep` partial regen captures wrong context, L-081)

- [ ] **Step 1: Full golden regen**

```powershell
cd web/apps/editor; node ./scripts/run-native-tests.mjs --update
```

- [ ] **Step 2: Review the golden diff — the merge gate**

```powershell
git diff --stat web/apps/editor/tests/a11y-goldens/
git diff web/apps/editor/tests/a11y-goldens/
```

The diff must contain ONLY two classes of change:
1. Brand/title text substitutions — `AloParticleEditor` → `Particle Editor`, including the root window Name becoming the dynamic mirrored title (e.g. `a11y-base-state.alo — Particle Editor`) — this root-Name change **is the end-to-end proof that the SetWindowTextW mirror works**.
2. The header brand span node disappearing (one `text: AloParticleEditor` / static-text node per affected golden).

Any structural diff beyond those two classes = STOP, investigate before committing (spec §4 risk 1).

- [ ] **Step 3: Full native harness**

```powershell
cd web/apps/editor; node ./scripts/run-native-tests.mjs
```

Expected: ~180 passed, 0 failed. L-066 escape hatch: if ONLY `preview-overload` specs fail with SIGTERM at the tail, re-run them in isolation (`node ./scripts/run-native-tests.mjs --grep "overload"` → 5 passed) before suspecting this change — it's cumulative Debug-host pressure, not a regression.

- [ ] **Step 4: Commit**

```powershell
git add web/apps/editor/tests/a11y-goldens/
git commit -m "test(a11y): regen goldens — Particle Editor rebrand + dynamic window title + header span removal"
```

---

## Task 7: Full verification + CHANGELOG

- [ ] **Step 1: Full gate, serialized (L-046)**

```powershell
cd web; pnpm --filter @particle-editor/editor test
cd web; pnpm --filter @particle-editor/editor exec tsc -b
cd web; pnpm --filter @particle-editor/editor build
& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" ParticleEditor.sln -p:Configuration=Debug -p:Platform=x64 -m
& "C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Current\Bin\MSBuild.exe" ParticleEditor.sln -p:Configuration=Release -p:Platform=x64 -m
```

Expected: 806 web, tsc 0, vite clean, both host configs 0 errors.

- [ ] **Step 2: Cold-launch smoke (agent-driven; the user does the real feel pass — L-033)**

Launch `x64\Release\ParticleEditor.exe`, verify it reaches the UI without crashing, and check `%LOCALAPPDATA%\AloParticleEditor\host.log` for the `DocumentTitleChanged handler registered` line. If a screenshot is possible, confirm the titlebar reads `Untitled.alo — Particle Editor` (not the bare brand, not `AloParticleEditor`).

- [ ] **Step 3: CHANGELOG entry**

Add at the top of `## Changelog` in `CHANGELOG.md`, following the house format (title in plain prose; date line `*2026-06-12 · TODO-hash · TODO-PR*` with a TODO to backfill hash + PR number at merge; the three bold run-in sections **What ships** is implicit in the opening paragraph / **How we tackled it.** / **Issues encountered and resolutions.**; `---` terminator). Content to cover:
- What ships: titlebar shows the open `.alo` (● dirty marker, `Untitled.alo` placeholder, filename-only), visible in taskbar/Alt-Tab; app rebranded "Particle Editor" across visible surfaces; header brand label next to File removed.
- How we tackled it: web keeps the single source of truth (`lib/window-title.ts` + the App.tsx effect); host mirrors via `DocumentTitleChanged` → `SetWindowTextW` in `FinishWebView2ControllerSetup` with token + teardown unsubscribe; rebrand bounded to 8 enumerated user-visible sites — storage identifiers (registry, log, autosave, window classes) deliberately keep `AloParticleEditor` to avoid orphaning user state.
- Issues: (fill from actual implementation experience; if none beyond the plan, note the `toContain("Particle Editor")` tautology trap — it's a substring of the old name, exact-match assertions required.)

- [ ] **Step 4: Commit**

```powershell
git add CHANGELOG.md
git commit -m "docs(changelog): open-file titlebar + Particle Editor rebrand entry (hash backfill at merge)"
```

- [ ] **Step 5: Hand off for the user feel test**

Summarize the test pass per CLAUDE.md pre-handoff discipline (what was tested, what was fixed, what couldn't be verified — i.e., the live titlebar feel across open/edit/save/Save-As/New, which is the user's pass). PR against `master` only after the user's explicit OK.

---

## Plan self-review (done at write time)

- **Spec coverage:** §3.1 host mirror → Task 4; §3.2 format → Tasks 1-2; §3.3 inventory (8 rows) → Task 2 (2 rows: App effect + span), Task 3 (3 rows / 4 string edits: index.html, AboutDialog ×2 strings, PrimitivesGallery), Task 4 (3 rows: CreateWindow, runtime-missing text, MessageBox caption) — 2+3+3 = 8, tallies with the spec table; §5 unit → Task 1; §5 native → Tasks 5-6; §5 manual/build → Task 7. Spec's "header span absence" unit test is consciously downgraded to golden coverage (no app-shell jsdom harness exists) — noted inline in Task 2.
- **Placeholder scan:** CHANGELOG "Issues" bullet intentionally defers to real implementation experience (it documents what *happened*, unknowable at plan time); all code steps carry complete code.
- **Type consistency:** `formatWindowTitle(currentFilePath: string | null, dirty: boolean)` used identically in Tasks 1, 2; `docTitleTok` consistent across Task 4 steps 1-3.
