import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Vercel bundles edge functions, but compiles a Node function file by file
 * and runs it as a native ES module, where `./_web/fetch` is not found: the
 * specifier needs its `.js`, and a workspace package whose entry is
 * TypeScript (`@mockintosh/protocol`) can't load at all. It also calls a
 * default-exported function as Node's `(req, res)` and ignores the
 * `Response` it returns; a Web handler is `export default { fetch }`.
 * These all run fine under Vite and tsx, so only a deploy shows the crash.
 */

const API = resolve(import.meta.dirname, ".");
const ROOT = resolve(API, "..");
/** The Computer Club's functions, its own Vercel project (`sites/club`). */
const CLUB_API = resolve(ROOT, "sites/club/api");

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

/** Specifiers the module loads at runtime (`import type` is erased). */
function runtimeImports(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(/^(import|export)(?!\s+type\b)[^;]*?\sfrom\s+"([^"]+)"/gm)) {
    specifiers.push(match[2]!);
  }
  return specifiers;
}

const relativeImports = (source: string) => runtimeImports(source).filter((specifier) => specifier.startsWith("."));

/** Every relative import reachable from `entry`, as `file → specifier`. */
function reachableImports(entry: string): Array<{ from: string; specifier: string }> {
  const seen = new Set<string>();
  const found: Array<{ from: string; specifier: string }> = [];
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of runtimeImports(readFileSync(file, "utf8"))) {
      found.push({ from: relative(ROOT, file), specifier });
      if (specifier.startsWith(".") && specifier.endsWith(".js")) visit(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
    }
  };
  visit(entry);
  return found;
}

describe("Node API functions", () => {
  const entries = [...sourceFiles(API), ...sourceFiles(CLUB_API)].filter((file) => !isEdge(readFileSync(file, "utf8")));

  it("finds the Node functions", () => {
    expect(entries.map((file) => relative(ROOT, file))).toEqual(
      expect.arrayContaining(["api/browse.ts", "api/web-image.ts", "sites/club/api/chat.ts", "sites/club/api/auth/[...all].ts"]),
    );
  });

  it.each(entries.map((file) => [relative(ROOT, file), file]))("%s imports relative modules with their .js", (_name, file) => {
    const bare = reachableImports(file).filter(({ specifier }) => specifier.startsWith(".") && !specifier.endsWith(".js"));
    expect(bare).toEqual([]);
  });

  it.each(entries.map((file) => [relative(ROOT, file), file]))("%s loads no TypeScript-only workspace package", (_name, file) => {
    const workspace = reachableImports(file).filter(({ specifier }) => specifier.startsWith("@mockintosh/"));
    expect(workspace).toEqual([]);
  });

  // `mockintosh-context*.ts` sit in `api/` without a handler; only files with a default export are functions.
  const handlers = entries.filter((file) => /^export default /m.test(readFileSync(file, "utf8")));

  it.each(handlers.map((file) => [relative(ROOT, file), file]))("%s exports a Web handler, not a (req, res) function", (_name, file) => {
    expect(readFileSync(file, "utf8")).toMatch(/^export default \{ fetch/m);
  });
});
