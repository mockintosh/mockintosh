/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import solid from "@solidjs/vite-plugin";

const __dirname = dirname(fileURLToPath(import.meta.url));

const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

function sharedRuntimeImportMap(): Plugin {
  return {
    name: "mockintosh-shared-runtime-importmap",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        if (!ctx.bundle) return html;
        const chunkFile = (name: string): string | undefined => {
          for (const [file, info] of Object.entries(ctx.bundle)) {
            if (info.type === "chunk" && info.name === name) return `/${file}`;
          }
          return undefined;
        };
        const ui = chunkFile("ui-runtime");
        const renderer = chunkFile("ui-renderer-runtime");
        const sdk = chunkFile("sdk-runtime");
        const quickdraw = chunkFile("quickdraw-runtime");
        const solidJs = chunkFile("solid-runtime");
        if (!ui || !renderer || !sdk || !quickdraw) return html;
        const map = {
          imports: {
            "solid-js": solidJs ?? "/node_modules/solid-js/dist/solid.js",
            "@mockintosh/ui": ui,
            // Third-party JSX compiles to calls into the universal renderer.
            "@mockintosh/ui/renderer": renderer,
            "@mockintosh/sdk": sdk,
            // One QuickDraw: thePort, the Font Manager and the cursor are globals.
            "@mockintosh/quickdraw": quickdraw,
            "@mockintosh/agent": chunkFile("agent-runtime") ?? "/packages/agent/src/index.ts",
            "@mockintosh/terminal": chunkFile("terminal-runtime") ?? "/packages/terminal/src/index.ts",
            "@mockintosh/terminal/view": chunkFile("terminal-view-runtime") ?? "/packages/terminal/src/view/index.ts",
            "@mockintosh/terminal/bash": chunkFile("terminal-bash-runtime") ?? "/packages/terminal/src/bash/index.ts",
            "@mockintosh/terminal/wasi": chunkFile("terminal-wasi-runtime") ?? "/packages/terminal/src/wasi/index.ts",
          },
        };
        return html.replace(
          /<script type="importmap">[\s\S]*?<\/script>/,
          `<script type="importmap">${JSON.stringify(map)}</script>`
        );
      },
    },
  };
}

/**
 * Only transform files in packages/ui and apps that use Solid JSX.
 * Must use "universal" generate mode so JSX compiles to the custom
 * CanvasNode renderer instead of the DOM. The page and the app-process
 * worker both need it; Vite bundles workers with their own plugin list.
 */
function solidJsx(): Plugin[] {
  return [
    solid({
      include: [
        /packages\/ui\/(?!src\/primitives\/).*\.[tj]sx?$/,
        /packages\/sdk\/.*\.[tj]sx?$/,
        /packages\/terminal\/src\/view\/.*\.[tj]sx?$/,
        /apps\/.*\.[tj]sx?$/,
        /src\/os\/.*\.[tj]sx?$/,
        // The app-process runtime: the worker half of an app, which mounts it with JSX.
        /src\/platform\/web\/process\/.*\.[tj]sx?$/,
      ],
      solid: {
        generate: "universal",
        moduleName: "@mockintosh/ui/renderer",
      },
    }),
  ];
}

export default defineConfig({
  optimizeDeps: {
    exclude: ["@rollup/browser", "@solidjs/compiler-wasm32-wasi", "libfx"],
    include: ["solid-js", "solid-js/refresh", "@solidjs/universal", "typescript"],
  },
  // The Oxc WASM loader uses top-level await and nested workers; IIFE
  // worker bundles reject both. Keep the compiler worker as ESM so the
  // 5.8 MB .wasm stays out of the desktop entry.
  worker: {
    format: "es",
    plugins: () => solidJsx(),
  },
  plugins: [
    solidJsx(),
    sharedRuntimeImportMap(),
  ],
  resolve: {
    alias: [
      // Exact specifier only — `solid-js/refresh` must keep the package export
      // (Vite's string alias is a prefix match and would look for solid.js/refresh).
      { find: /^solid-js$/, replacement: resolve(__dirname, "node_modules/solid-js/dist/solid.js") },
      { find: /^@\//, replacement: __dirname + "/" },
      { find: "@mockintosh/quickdraw/bits", replacement: resolve(__dirname, "packages/quickdraw/src/bits.ts") },
      { find: "@mockintosh/quickdraw", replacement: resolve(__dirname, "packages/quickdraw/src/index.ts") },
      { find: "@mockintosh/ui/renderer", replacement: resolve(__dirname, "packages/ui/src/renderer.ts") },
      { find: "@mockintosh/ui/web", replacement: resolve(__dirname, "packages/ui/src/web/index.ts") },
      { find: "@mockintosh/ui/primitives", replacement: resolve(__dirname, "packages/ui/src/primitives/index.ts") },
      { find: "@mockintosh/ui/vite", replacement: resolve(__dirname, "packages/ui/src/vite/ditherPlugin.ts") },
      { find: "@mockintosh/ui", replacement: resolve(__dirname, "packages/ui/src/index.ts") },
      { find: "@mockintosh/protocol", replacement: resolve(__dirname, "packages/protocol/src/index.ts") },
      { find: "@mockintosh/agent", replacement: resolve(__dirname, "packages/agent/src/index.ts") },
      { find: "@mockintosh/sdk", replacement: resolve(__dirname, "packages/sdk/src/index.ts") },
      { find: "@mockintosh/print", replacement: resolve(__dirname, "packages/print/src/index.ts") },
      { find: "@mockintosh/terminal/view", replacement: resolve(__dirname, "packages/terminal/src/view/index.ts") },
      { find: "@mockintosh/terminal/bash", replacement: resolve(__dirname, "packages/terminal/src/bash/index.ts") },
      { find: "@mockintosh/terminal/wasi", replacement: resolve(__dirname, "packages/terminal/src/wasi/index.ts") },
      { find: /^@mockintosh\/terminal$/, replacement: resolve(__dirname, "packages/terminal/src/index.ts") },
      // The package's "module" field names a file it doesn't ship; take its ES build.
      { find: /^@xterm\/headless$/, replacement: resolve(__dirname, "node_modules/@xterm/headless/lib-headless/xterm-headless.mjs") },
      // mdast's default Vite `browser` condition reads `document` at import time.
      {
        find: "decode-named-character-reference",
        replacement: resolve(
          __dirname,
          "node_modules/decode-named-character-reference/index.js"
        ),
      },
    ],
  },
  ssr: {
    resolve: {
      alias: [
        { find: /^solid-js$/, replacement: resolve(__dirname, "node_modules/solid-js/dist/solid.js") },
      ],
    },
  },
  test: {
    environment: "node",
    server: {
      deps: {
        inline: ["solid-js", "@solidjs/universal", "@solidjs/signals"],
      },
    },
    setupFiles: ["scripts/vitest-setup.ts"],
    include: [
      "packages/quickdraw/tests/**/*.test.ts",
      "packages/ui/tests/**/*.test.ts",
      "packages/ui/tests/**/*.test.tsx",
      "packages/agent/src/**/*.test.ts",
      "packages/fs/tests/**/*.test.ts",
      "packages/print/tests/**/*.test.ts",
      "packages/sdk/tests/**/*.test.ts",
      "packages/terminal/tests/**/*.test.ts",
      "packages/terminal/tests/**/*.test.tsx",
      "src/os/**/*.test.ts",
      "src/platform/**/*.test.ts",
      "src/platform/**/*.test.tsx",
      "src/runtime/**/*.test.ts",
      "src/shared/**/*.test.ts",
      "scripts/**/*.test.ts",
      "api/**/*.test.ts",
      "apps/**/*.test.ts",
      "sites/ui/src/**/*.test.ts",
    ],
  },
  build: {
    target: "esnext",
    outDir: "dist",
    rolldownOptions: {
      // The *-runtime entries are served to third-party bundles through the
      // import map, so their public export names must survive minification.
      preserveEntrySignatures: "strict",
      input: {
        main: resolve(__dirname, "index.html"),
        "3d": resolve(__dirname, "3d.html"),
        "ui-runtime": resolve(__dirname, "packages/ui/src/index.ts"),
        "ui-renderer-runtime": resolve(__dirname, "packages/ui/src/renderer.ts"),
        "sdk-runtime": resolve(__dirname, "packages/sdk/src/index.ts"),
        "quickdraw-runtime": resolve(__dirname, "packages/quickdraw/src/index.ts"),
        "agent-runtime": resolve(__dirname, "packages/agent/src/index.ts"),
        "terminal-runtime": resolve(__dirname, "packages/terminal/src/index.ts"),
        "terminal-view-runtime": resolve(__dirname, "packages/terminal/src/view/index.ts"),
        "terminal-bash-runtime": resolve(__dirname, "packages/terminal/src/bash/index.ts"),
        "terminal-wasi-runtime": resolve(__dirname, "packages/terminal/src/wasi/index.ts"),
        "solid-runtime": resolve(__dirname, "node_modules/solid-js/dist/solid.js"),
      },
    },
  },
  server: {
    headers: isolationHeaders,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  preview: {
    headers: isolationHeaders,
  },
});
