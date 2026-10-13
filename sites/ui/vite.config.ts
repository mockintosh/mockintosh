import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

const root = dirname(fileURLToPath(import.meta.url));
const repo = resolve(root, "../..");
const kit = resolve(repo, "packages");

export default defineConfig({
  appType: "spa",
  optimizeDeps: {
    exclude: ["@mockintosh/ui", "@mockintosh/quickdraw"],
  },
  server: {
    allowedHosts: true,
    fs: {
      allow: [root, kit, resolve(repo, "public/fonts/library")],
    },
    watch: {
      ignored: ["!**/node_modules/@mockintosh/**"],
    },
  },
  plugins: [
    solid({
      include: [/src\/.*\.[tj]sx?$/, /packages\/ui\/(?!src\/primitives\/).*\.[tj]sx?$/],
      solid: {
        generate: "universal",
        moduleName: "@mockintosh/ui/renderer",
      },
    }),
  ],
  esbuild: {
    keepNames: true,
  },
  resolve: {
    alias: [
      { find: /^solid-js$/, replacement: resolve(repo, "node_modules/solid-js/dist/solid.js") },
    ],
  },
});
