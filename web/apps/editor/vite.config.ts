import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Build-time constants for the About dialog. Hand-bumped to match the
// canonical version constants in src/main.cpp:43-44
// (VERSION_MAJOR / VERSION_MINOR). When those change, update the string
// here too — it's two ints, not worth a codegen step. Vite injects these
// into `import.meta.env` via the `define` block below.
const APP_VERSION = "1.5";
const BUILD_DATE = new Date().toISOString().slice(0, 10);

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
