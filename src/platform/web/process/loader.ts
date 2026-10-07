/**
 * Loading an app's code in a process. Bundled apps come from the module
 * table. Installed bundles and OS builds import `solid-js`, `@mockintosh/ui`
 * and the SDK by bare name, which the page resolves through its import map.
 * A worker has no import map, so those imports are rewritten to shim modules
 * that re-export this worker's own copies, and the code is imported from a
 * Blob URL. A bundle's relative imports are resolved against its URL; a
 * bundle split into chunks that themselves import shared modules isn't
 * supported (the OS's builder emits one file).
 */
import type { AppSource } from "../../../os/process/protocol";

/**
 * The modules an app shares with the OS, by the specifier it imports them
 * with: loaded already, or loaded the first time an app's code imports them
 * (a terminal's emulator and shell needn't weigh on every process).
 */
export type SharedModules = Readonly<Record<string, Record<string, unknown> | (() => Promise<Record<string, unknown>>)>>;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"']+)\2/g;

/** A module whose exports are `shared`'s, read from a global the worker sets. */
export function shimSource(specifier: string, exports: Record<string, unknown>, globalName: string): string {
  const lines = [`const m = globalThis[${JSON.stringify(globalName)}][${JSON.stringify(specifier)}];`];
  for (const name of Object.keys(exports)) {
    if (name === "default" || !IDENTIFIER.test(name)) continue;
    lines.push(`export const ${name} = m[${JSON.stringify(name)}];`);
  }
  if ("default" in exports) lines.push("export default m.default;");
  return lines.join("\n");
}

/** Point shared imports at their shims and relative imports at `base`. */
export function rewriteImports(code: string, shims: Readonly<Record<string, string>>, base?: string): string {
  return code.replace(SPECIFIER, (match, keyword: string, quote: string, specifier: string) => {
    const shim = shims[specifier];
    if (shim) return `${keyword}${quote}${shim}${quote}`;
    if (base && (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/"))) {
      return `${keyword}${quote}${new URL(specifier, base).href}${quote}`;
    }
    return match;
  });
}

export interface LoaderOptions {
  shared: SharedModules;
  bundled: (id: string) => Promise<{ default: unknown } | undefined>;
  fetchText: (url: string) => Promise<string>;
  importUrl: (url: string) => Promise<unknown>;
  blobUrl: (code: string) => string;
}

const GLOBAL = "__mockintoshShared";

/** An app module: its `defineApp` result, and sprites it exports beside it. */
export interface LoadedModule {
  default?: unknown;
  sprites?: Record<string, unknown>;
}

/** The bare specifiers `code` imports. */
export function importedSpecifiers(code: string): Set<string> {
  const found = new Set<string>();
  for (const match of code.matchAll(SPECIFIER)) found.add(match[3]!);
  return found;
}

export function createAppLoader(options: LoaderOptions): (source: AppSource) => Promise<LoadedModule | undefined> {
  const shims: Record<string, string> = {};
  const loaded: Record<string, Record<string, unknown>> = {};
  (globalThis as Record<string, unknown>)[GLOBAL] = loaded;
  /** Shims for the shared modules `code` imports, loading any not yet loaded. */
  const shimUrls = async (code: string): Promise<Record<string, string>> => {
    for (const specifier of importedSpecifiers(code)) {
      const shared = options.shared[specifier];
      if (!shared || shims[specifier]) continue;
      const exports = typeof shared === "function" ? await shared() : shared;
      loaded[specifier] = exports;
      shims[specifier] = options.blobUrl(shimSource(specifier, exports, GLOBAL));
    }
    return shims;
  };

  return async (source) => {
    switch (source.kind) {
      case "bundled":
        return (await options.bundled(source.id)) as LoadedModule | undefined;
      case "url": {
        const text = await options.fetchText(source.url);
        const code = rewriteImports(text, await shimUrls(text), source.url);
        return (await options.importUrl(options.blobUrl(code))) as LoadedModule;
      }
      case "code": {
        const code = rewriteImports(source.code, await shimUrls(source.code));
        return (await options.importUrl(options.blobUrl(code))) as LoadedModule;
      }
    }
  };
}
