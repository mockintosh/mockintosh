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

/** The modules an app shares with the OS, by the specifier it imports them with. */
export type SharedModules = Readonly<Record<string, Record<string, unknown>>>;

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

export function createAppLoader(options: LoaderOptions): (source: AppSource) => Promise<LoadedModule | undefined> {
  let shims: Record<string, string> | null = null;
  const shimUrls = (): Record<string, string> => {
    if (shims) return shims;
    (globalThis as Record<string, unknown>)[GLOBAL] = options.shared;
    shims = Object.fromEntries(
      Object.entries(options.shared).map(([specifier, exports]) => [specifier, options.blobUrl(shimSource(specifier, exports, GLOBAL))]),
    );
    return shims;
  };

  return async (source) => {
    switch (source.kind) {
      case "bundled":
        return (await options.bundled(source.id)) as LoadedModule | undefined;
      case "url": {
        const code = rewriteImports(await options.fetchText(source.url), shimUrls(), source.url);
        return (await options.importUrl(options.blobUrl(code))) as LoadedModule;
      }
      case "code": {
        const code = rewriteImports(source.code, shimUrls());
        return (await options.importUrl(options.blobUrl(code))) as LoadedModule;
      }
    }
  };
}
