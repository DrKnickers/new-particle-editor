// Vitest config — point at the in-process contract tests under src/.
// Excludes the Playwright spec tree under tests/, which is driven by
// the test:native harness (different runner, different transport).
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    include: ["src/**/__tests__/**/*.{test,spec}.ts"],
    exclude: ["node_modules/**", "dist/**", "tests/**"],
  },
});
