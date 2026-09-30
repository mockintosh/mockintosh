import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";
import { mockintoshManifest } from "@mockintosh/sdk/vite";

export default defineConfig({
  plugins: [
    solid({
      solid: {
        generate: "universal",
        moduleName: "@mockintosh/ui/renderer",
      },
    }),
    // dist/manifest.json: mockintosh.json plus what the app declares, so the OS can show it before running it.
    mockintoshManifest(),
  ],
  build: {
    lib: {
      entry: "src/index.tsx",
      formats: ["es"],
      fileName: "index",
    },
    rolldownOptions: {
      // The OS serves these through an import map so one runtime is shared.
      // Includes subpaths — JSX compiles to `@mockintosh/ui/renderer`.
      external: (id) => /^(@mockintosh\/(sdk|ui|quickdraw)|solid-js)(\/|$)/.test(id),
    },
  },
});
