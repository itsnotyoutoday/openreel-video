import { cpSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import { stripFfmpegPlugin } from "./vite-plugins/strip-ffmpeg";
import { scopeRootCss } from "./vite-plugins/scope-root-css";

/**
 * Library build: `dist-lib/openreel-editor.js` (ESM) and
 * `dist-lib/openreel-editor.css`, which a host application imports to call
 * `mountEditor`. React is bundled, so the host needs nothing besides the files.
 * Run with `pnpm --filter @openreel/web build:lib`.
 */
export default defineConfig({
  // Relative URLs: workers and wasm are located from the bundle's own URL, so
  // the files work from any path they are copied to.
  base: "./",
  publicDir: false,
  // Library mode does not replace these the way an app build does, and some
  // dependencies read them at load time.
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env": "{}",
  },
  plugins: [
    react(),
    stripFfmpegPlugin(false),
    {
      name: "openreel-copy-public-fonts",
      closeBundle() {
        // The 3D text renderer loads these through assetUrl("fonts/...").
        cpSync(
          path.resolve(__dirname, "public/fonts"),
          path.resolve(__dirname, "dist-lib/fonts"),
          { recursive: true },
        );
      },
    },
  ],
  css: {
    postcss: {
      plugins: [tailwindcss(), autoprefixer(), scopeRootCss({ scopeAll: true, prefixNames: "openreel-" })],
    },
  },
  assetsInclude: ["**/*.wasm"],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      react: path.resolve(__dirname, "./node_modules/react"),
      "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
      "@": path.resolve(__dirname, "./src"),
      "@openreel/core": path.resolve(__dirname, "../../packages/core/src"),
      "@openreel/agent": path.resolve(__dirname, "../../packages/agent/src"),
      "@openreel/ui": path.resolve(__dirname, "../../packages/ui/src"),
    },
  },
  worker: { format: "es" },
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util", "@ffmpeg/core", "@ffmpeg/core-mt"],
  },
  build: {
    target: "esnext",
    outDir: "dist-lib",
    emptyOutDir: true,
    sourcemap: false,
    lib: {
      entry: path.resolve(__dirname, "src/embed/library.ts"),
      formats: ["es"],
      fileName: () => "openreel-editor.js",
    },
    rollupOptions: {
      output: {
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: (asset) =>
          asset.name === "style.css"
            ? "openreel-editor.css"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
});
