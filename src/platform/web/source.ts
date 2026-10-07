/**
 * Web source volume: non-eager Vite glob of the same packages the compiler
 * typechecks, plus bundled apps and the two docs the agent should read.
 */
import { APP_SIBLING_DIRS, isSdkClean } from "../../../apps/sdkClean";
import type { SourceFile, SourceProvider } from "../types";

const loaders = import.meta.glob<string>([
  "/packages/*/src/**/*.ts",
  "/packages/*/src/**/*.tsx",
  "!/packages/**/*.test.ts",
  "/apps/**/*.ts",
  "/apps/**/*.tsx",
  "!/apps/**/*.test.ts",
  "/ARCHITECTURE.md",
  "/packages/sdk/docs/APP_DEV_GUIDE.md",
], { query: "?raw", import: "default", eager: false, exhaustive: true });

function relPath(key: string): string {
  return key.replace(/^\//, "");
}

function sdkCleanFlag(path: string): boolean | undefined {
  if (!path.startsWith("apps/")) return undefined;
  const rest = path.slice("apps/".length);
  if (isSdkClean(rest)) return true;
  const dir = rest.split("/")[0];
  for (const [entry, dirs] of Object.entries(APP_SIBLING_DIRS)) {
    if (dirs?.includes(dir)) return isSdkClean(entry);
  }
  return false;
}

export function createWebSourceProvider(): SourceProvider {
  let cached: { commit: string; files: SourceFile[] } | undefined;
  return {
    async manifest() {
      if (cached) return cached;
      const files: SourceFile[] = [];
      for (const key of Object.keys(loaders)) {
        const path = relPath(key);
        files.push({ path, size: 0, sdkClean: sdkCleanFlag(path) });
      }
      files.sort((a, b) => a.path.localeCompare(b.path));
      cached = {
        commit: (import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA as string | undefined) ?? "local",
        files,
      };
      return cached;
    },
    async read(path) {
      const key = path.startsWith("/") ? path : `/${path}`;
      const load = loaders[key] ?? loaders[path];
      if (!load) throw new Error(`No shipped source at ${path}`);
      return load();
    },
  };
}

