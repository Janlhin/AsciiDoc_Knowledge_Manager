import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("./src/core", import.meta.url)),
      "@features": fileURLToPath(new URL("./src/features", import.meta.url)),
      "@app": fileURLToPath(new URL("./src/app", import.meta.url)),
      "@compat": fileURLToPath(new URL("./src/compat", import.meta.url)),
    },
  },
  clearScreen: false,
  // SAB needs a cross-origin isolated context: COOP + COEP on dev and preview.
  // The app bundles all assets same-origin (no CDN / cross-origin embeds), so
  // `require-corp` does not break any existing resource.
  server: {
    port: 1420,
    strictPort: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
