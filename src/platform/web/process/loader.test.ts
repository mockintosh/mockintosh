import { describe, expect, it } from "vitest";
import { createAppLoader, rewriteImports, shimSource } from "./loader";

describe("loading an app's code in a process", () => {
  it("makes a shim that re-exports a shared module from a global", () => {
    const source = shimSource("solid-js", { createSignal: () => 0, "not-an-id": 1, default: 2 }, "__shared");
    expect(source).toContain('const m = globalThis["__shared"]["solid-js"];');
    expect(source).toContain('export const createSignal = m["createSignal"];');
    expect(source).toContain("export default m.default;");
    expect(source).not.toContain("not-an-id");
  });

  it("points shared imports at shims and relative ones at the bundle's URL", () => {
    const code = [
      'import { createSignal } from "solid-js";',
      "import { useApp } from '@mockintosh/sdk';",
      'export * from "@mockintosh/ui";',
      'const lazy = () => import("./chunk.js");',
      'import "./side-effect.js";',
      'import { other } from "@mockintosh/uikit";',
    ].join("\n");
    const shims = { "solid-js": "blob:s", "@mockintosh/sdk": "blob:k", "@mockintosh/ui": "blob:u" };
    const out = rewriteImports(code, shims, "https://apps.example/counter/index.js");
    expect(out).toContain('from "blob:s"');
    expect(out).toContain("from 'blob:k'");
    expect(out).toContain('export * from "blob:u"');
    expect(out).toContain('import("https://apps.example/counter/chunk.js")');
    expect(out).toContain('import "https://apps.example/counter/side-effect.js"');
    // Only exact shared specifiers are rewritten.
    expect(out).toContain('from "@mockintosh/uikit"');
  });

  it("imports a build through the shims and returns its default export", async () => {
    const blobs: string[] = [];
    const load = createAppLoader({
      shared: { "solid-js": { createSignal: () => 0 } },
      bundled: async () => undefined,
      fetchText: async () => "",
      blobUrl: (code) => {
        blobs.push(code);
        return `blob:${blobs.length}`;
      },
      importUrl: async (url) => ({ default: { loadedFrom: url, code: blobs[Number(url.slice(5)) - 1] } }),
    });
    const module = await load({ kind: "code", code: 'import { createSignal } from "solid-js"; export default 1;', identity: "b1" });
    const app = module!.default as { code: string };
    expect(app.code).toBe('import { createSignal } from "blob:1"; export default 1;');
  });
});
