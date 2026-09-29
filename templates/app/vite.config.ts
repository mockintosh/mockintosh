import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

export default defineConfig({
  plugins: [
    solid({
      solid: {
        generate: "universal",
        moduleName: "@mockintosh/ui/renderer",
      },
    }),
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
