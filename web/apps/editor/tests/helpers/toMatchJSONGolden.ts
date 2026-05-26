// Custom Playwright matcher `expect(x).toMatchJSONGolden(path, opts)` for
// MT-11 a11y goldens.
//
// Behavior:
//   - Default: serialize `received` as `JSON.stringify(value, null, 2) + "\n"`
//     and compare byte-for-byte against the committed golden file.
//   - With env `UPDATE_A11Y_GOLDENS=1`: write the serialized value to the
//     golden path instead of comparing. The matcher always reports `pass`
//     in update mode so a full spec run can refresh every golden in one
//     pass without spurious failures.
//   - On mismatch with `options.rawForDebug`, dump the raw pre-normalization
//     JSON to `tests/a11y-failures/<basename>.raw.json` (gitignored) so the
//     developer can tell whether a diff originated from the normalizer or
//     from the underlying UIA / DOM tree.
//
// Imported (side-effect) by every spec that uses `toMatchJSONGolden` — the
// `expect.extend` call and the global type augmentation only take effect
// once the module is loaded. T9's spec template includes the import at the
// top of each file.

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
    // goldenPath is relative to tests/, e.g. "a11y-goldens/menubar.golden.json".
    const absPath = path.resolve(__dirname, "..", goldenPath);
    const serialized = JSON.stringify(received, null, 2) + "\n";

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
      const base = path.basename(goldenPath, ".json");
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
        return (
          `A11y golden mismatch: ${goldenPath}\n` +
          `  Expected (committed) vs Received (current run) differ.\n` +
          `  Hint: if intended, run \`pnpm a11y:update --grep "<surface>"\`\n` +
          (options?.rawForDebug
            ? `  Raw pre-normalization JSON written to a11y-failures/${path.basename(
                goldenPath,
                ".json",
              )}.raw.json\n`
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
