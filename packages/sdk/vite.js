// @ts-check
/**
 * `mockintoshManifest()`: a Vite plugin for Mockintosh app bundles. After the
 * build it writes `manifest.json` beside the bundle: the publisher's fields
 * from `mockintosh.json`, the bundle's `entry`, and the app's `declaration`
 * (icon, sprites, window defaults, file types; see `AppDeclaration`), so the
 * OS can list, draw and route to the app without running it.
 *
 * Plain JavaScript: Vite loads config plugins with Node, which won't run
 * TypeScript from `node_modules`.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const DECLARATION_ID = "\0mockintosh-declaration";

/**
 * @param {{ manifest?: string; entry?: string; fileName?: string }} [options]
 *   `manifest`: the publisher's fields (default `mockintosh.json`).
 *   `entry`: the app's source entry (default `build.lib.entry`).
 *   `fileName`: the built bundle's name in the output directory (default `index.js`).
 * @returns {import("vite").Plugin}
 */
export function mockintoshManifest(options = {}) {
  /** @type {import("vite").ResolvedConfig} */
  let config;
  return {
    name: "mockintosh-manifest",
    apply: "build",
    configResolved(resolved) {
      config = resolved;
    },
    async closeBundle() {
      const root = config.root;
      const publisher = JSON.parse(await readFile(join(root, options.manifest ?? "mockintosh.json"), "utf8"));
      const lib = config.build.lib;
      const entry = resolve(root, options.entry ?? (lib && typeof lib.entry === "string" ? lib.entry : "src/index.tsx"));
      // The app's own module, run the way Vite builds it (JSX and all), in Node: only to read what it declares.
      const { createServer } = await import("vite");
      const server = await createServer({
        configFile: config.configFile,
        root,
        logLevel: "error",
        appType: "custom",
        server: { middlewareMode: true, hmr: false, ws: false },
        // The Mockintosh packages ship TypeScript source; Vite compiles them. Everything else loads as Node would.
        ssr: { noExternal: [/^@mockintosh\//] },
        plugins: [
          {
            name: "mockintosh-declaration",
            resolveId: (id) => (id === DECLARATION_ID ? id : undefined),
            load: (id) =>
              id === DECLARATION_ID
                ? [
                    `import * as module from ${JSON.stringify(entry)};`,
                    `import { appDeclaration } from "@mockintosh/sdk";`,
                    `const app = module.default;`,
                    `export default appDeclaration({ ...app, sprites: { ...app.sprites, ...module.sprites } });`,
                  ].join("\n")
                : undefined,
          },
        ],
      });
      try {
        const { default: declaration } = await server.ssrLoadModule(DECLARATION_ID);
        if (declaration.id !== publisher.id) {
          throw new Error(`mockintosh.json says "${publisher.id}", but the app's defineApp says "${declaration.id}"`);
        }
        const manifest = { ...publisher, entry: `./${options.fileName ?? "index.js"}`, declaration };
        await writeFile(join(resolve(root, config.build.outDir), "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
      } finally {
        await server.close();
      }
    },
  };
}
