import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function walk(dir: string, visit: (abs: string) => void): void {
  for (const name of readdirSync(dir)) {
    // chatProtocol.ts names the removed APIs to tell the agent not to use them.
    if (name === "node_modules" || name === "dist" || name === "mockintosh-context.generated.ts" || name === "chatProtocol.ts") continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, visit);
    else if (/\.(ts|tsx)$/.test(name)) visit(abs);
  }
}

const BANNED = [
  { name: "solid-js/store", pattern: /from ["']solid-js\/store["']/ },
  { name: "solid-js/universal", pattern: /from ["']solid-js\/universal["']/ },
  { name: "onMount", pattern: /\bonMount\s*[\(,]/ },
  { name: "ErrorBoundary", pattern: /\bErrorBoundary\b/ },
  { name: "Context.Provider", pattern: /\.\s*Provider\b/ },
  { name: "@babel/standalone", pattern: /from ["']@babel\/standalone["']/ },
  { name: "babel-preset-solid", pattern: /from ["']babel-preset-solid["']/ },
  { name: "vite-plugin-solid", pattern: /from ["']vite-plugin-solid["']/ },
];

describe("Solid 2 source contract", () => {
  it("has no Solid 1 package paths or removed APIs", () => {
    const hits: string[] = [];
    for (const root of ["src", "packages", "apps", "scripts", "templates"]) {
      walk(join(ROOT, root), (abs) => {
        const text = readFileSync(abs, "utf8");
        for (const { name, pattern } of BANNED) {
          if (abs.endsWith("solid2.test.ts")) continue;
        if (pattern.test(text)) hits.push(`${abs.slice(ROOT.length)}: ${name}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });
});
