import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { execSync } from "node:child_process";

// Build-time constants for the About dialog. Hand-bumped to match the
// canonical version constants in src/main.cpp:43-44
// (VERSION_MAJOR / VERSION_MINOR). When those change, update the string
// here too — it's two ints, not worth a codegen step. Vite injects these
// into `import.meta.env` via the `define` block below.
const APP_VERSION = "1.5";

// BUILD_DATE: the committer date of HEAD in YYYY-MM-DD form. Stable
// across rebuilds of the same commit, so the About dialog's
// "Build date" reflects when the code was actually committed rather
// than when somebody happened to run `pnpm build`. Using `new Date()`
// here was the source of HANDOFF item 16's lone real golden-drift
// surface (dialog-about) — every rebuild on a different day shifted
// the value and broke the a11y golden.
//
// Fallback path: if we can't reach git (release tarball, detached
// build environment without .git/), fall back to today's date so the
// dialog still renders. The fallback is acceptable because the only
// place anyone reads BUILD_DATE is the About dialog; the goldens
// only matter inside a git checkout, where the primary path runs.
const BUILD_DATE = (() => {
  try {
    return execSync("git show -s --format=%cs HEAD", {
      encoding: "utf8",
      cwd: __dirname,
    }).trim();
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
})();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  base: "./",
  server: {
    port: 5174,        // 5173 is used by viewport-poc; pick a fresh port for the real app
    strictPort: true,
  },
  build: { outDir: "dist", emptyOutDir: true },
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(APP_VERSION),
    "import.meta.env.VITE_BUILD_DATE": JSON.stringify(BUILD_DATE),
  },
});
