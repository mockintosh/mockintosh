import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Vercel bundles edge functions, but compiles a Node function file by file
 * and runs it as a native ES module, where `./_web/fetch` is not found: the
 * specifier needs its `.js`. These run fine under Vite and tsx, so only a
 * deploy shows the crash.
 */

const API = resolve(import.meta.dirname, ".");
const ROOT = resolve(API, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name.startsWith("_") ? [] : sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.startsWith("_") ? [path] : [];
  });
}

function isEdge(source: string): boolean {
  return /export const config = \{[^}]*runtime: "edge"/.test(source);
}

/** Relative specifiers the module loads at runtime (`import type` is erased). */
function relativeImports(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(/^(import|export)(?!\s+type\b)[^;]*?\sfrom\s+"(\.{1,2}\/[^"]+)"/gm)) {
    specifiers.push(match[2]!);
  }
  return specifiers;
}

/** Every relative import reachable from `entry`, as `file → specifier`. */
function reachableImports(entry: string): Array<{ from: string; specifier: string }> {
  const seen = new Set<string>();
  const found: Array<{ from: string; specifier: string }> = [];
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of relativeImports(readFileSync(file, "utf8"))) {
      found.push({ from: relative(ROOT, file), specifier });
      if (specifier.endsWith(".js")) visit(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
    }
  };
  visit(entry);
  return found;
}

describe("Node API functions", () => {
  const entries = sourceFiles(API).filter((file) => !isEdge(readFileSync(file, "utf8")));

  it("finds the Node functions", () => {
    expect(entries.map((file) => relative(API, file))).toEqual(expect.arrayContaining(["browse.ts", "web-image.ts"]));
  });

  it.each(entries.map((file) => [relative(API, file), file]))("%s imports relative modules with their .js", (_name, file) => {
    const bare = reachableImports(file).filter(({ specifier }) => !specifier.endsWith(".js"));
    expect(bare).toEqual([]);
  });
});
