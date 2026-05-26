// Custom Playwright matcher `expect(x).toMatchJSONGolden(path, opts)` for
// MT-11 a11y goldens.
//
// Behavior:
//   - String `received`: write as-is, no transformation. Used by the
//     composition lane (T10), which captures Playwright's
//     `locator.ariaSnapshot()` YAML output. Goldens end in `.golden.yaml`.
//   - Object `received`: serialize as `JSON.stringify(value, null, 2) + "\n"`
//     and compare byte-for-byte. Used by the HWND lane (T9), which
//     captures the normalized UIA tree from `uia_inspector.exe`. Goldens
//     end in `.golden.json`.
//   - With env `UPDATE_A11Y_GOLDENS=1`: write the serialized value to the
//     golden path instead of comparing. The matcher always reports `pass`
//     in update mode so a full spec run can refresh every golden in one
//     pass without spurious failures.
//   - On mismatch with `options.rawForDebug`, dump the raw pre-normalization
//     value (JSON-stringified) to `tests/a11y-failures/<basename>.raw.json`
//     (gitignored) so the developer can tell whether a diff originated
//     from the normalizer or from the underlying UIA / DOM tree.
//
// Despite the name, the matcher handles BOTH JSON (HWND lane) and YAML
// strings (composition lane). The "JSON" naming is historic; renaming
// would churn 4 HWND specs unnecessarily.
//
// Imported (side-effect) by every spec that uses `toMatchJSONGolden` — the
// `expect.extend` call and the global type augmentation only take effect
// once the module is loaded. T9/T10 spec templates include the import at
// the top of each file.

import { expect, type MatcherReturnType } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ESM-equivalent of __dirname (package is "type": "module").
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const UPDATE = process.env.UPDATE_A11Y_GOLDENS === "1";
// __dirname is .../tests/helpers, so FAILURE_DIR resolves to .../tests/a11y-failures.
const FAILURE_DIR = path.join(__dirname, "..", "a11y-failures");

expect.extend({
  toMatchJSONGolden(
    received: unknown,
    goldenPath: string,
    options?: { rawForDebug?: unknown },
  ): MatcherReturnType {
    // goldenPath is relative to tests/, e.g. "a11y-goldens/menubar.golden.json"
    // or "a11y-goldens/menubar.composition.golden.yaml" (composition lane).
    const absPath = path.resolve(__dirname, "..", goldenPath);
    // String inputs (composition lane, ariaSnapshot YAML) are written as-is;
    // object inputs (HWND lane, UIA tree) are JSON-stringified with 2-space
    // indent + trailing newline. Both end with "\n" so the golden file is
    // text-editor-friendly.
    const serialized = typeof received === "string"
      ? (received.endsWith("\n") ? received : received + "\n")
      : JSON.stringify(received, null, 2) + "\n";

    if (UPDATE) {
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, serialized, "utf8");
      return {
        pass: true,
        message: () => `wrote golden: ${goldenPath}`,
      };
    }

    if (!fs.existsSync(absPath)) {
      return {
        pass: false,
        message: () =>
          `A11y golden missing: ${goldenPath}\n` +
          `  Hint: run \`pnpm a11y:update\` to create it.`,
      };
    }

    const expected = fs.readFileSync(absPath, "utf8");
    const pass = expected === serialized;
    if (!pass && options?.rawForDebug !== undefined) {
      fs.mkdirSync(FAILURE_DIR, { recursive: true });
      // Strip the trailing extension regardless of which lane (.json / .yaml).
      const base = path.basename(goldenPath).replace(/\.golden\.(json|yaml)$/, "");
      fs.writeFileSync(
        path.join(FAILURE_DIR, `${base}.raw.json`),
        JSON.stringify(options.rawForDebug, null, 2) + "\n",
        "utf8",
      );
    }

    return {
      pass,
      message: () => {
        if (pass) return `Matched: ${goldenPath}`;
        const base = path.basename(goldenPath).replace(/\.golden\.(json|yaml)$/, "");
        return (
          `A11y golden mismatch: ${goldenPath}\n` +
          `  Expected (committed) vs Received (current run) differ.\n` +
          `  Hint: if intended, run \`pnpm a11y:update --grep "<surface>"\`\n` +
          (options?.rawForDebug
            ? `  Raw pre-normalization written to a11y-failures/${base}.raw.json\n`
            : "")
        );
      },
    };
  },
});

// Type augmentation — Playwright extends matchers via the global
// PlaywrightTest.Matchers interface (see playwright/types/test.d.ts:8551).
// `declare module "@playwright/test"` does NOT work because the public
// .d.ts re-exports from "playwright/test" and never declares a `Matchers`
// interface in its own module namespace.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace PlaywrightTest {
    interface Matchers<R> {
      toMatchJSONGolden(
        goldenPath: string,
        options?: { rawForDebug?: unknown },
      ): R;
    }
  }
}
