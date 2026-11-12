import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { resolve } from "node:path";

const target = process.env.TARGET ?? "main";
const polyfills = nodePolyfills({ globals: { Buffer: true, global: true, process: true } });

// main: popup + background (ES module). page: content/provider, mỗi file là IIFE độc lập.
export default defineConfig(
  target === "web"
    ? {
        plugins: [react(), polyfills],
        publicDir: "public",
        build: {
          outDir: "dist-web",
          emptyOutDir: true,
          target: "es2022",
          commonjsOptions: { strictRequires: true },
          rollupOptions: { input: { index: resolve(__dirname, "web.html") } },
        },
      }
    : target === "main"
    ? {
        plugins: [react(), polyfills],
        base: "./",
        build: {
          outDir: "dist",
          emptyOutDir: true,
          target: "es2022",
          commonjsOptions: { strictRequires: true },
          rollupOptions: {
            input: { popup: resolve(__dirname, "popup.html"), background: resolve(__dirname, "src/background/index.ts") },
            output: { entryFileNames: "[name].js", chunkFileNames: "chunks/[name]-[hash].js", assetFileNames: "assets/[name]-[hash][extname]" },
          },
        },
      }
    : {
        build: {
          outDir: "dist",
          emptyOutDir: false,
          target: "es2022",
          lib: { entry: resolve(__dirname, `src/inject/${target}.ts`), formats: ["iife"], name: `w_${target}`, fileName: () => `${target}.js` },
        },
      },
);
