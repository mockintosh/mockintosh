import { createSignal } from "solid-js";
import type { FileSystem } from "@mockintosh/fs";
import { defineOperation, type Kernel } from "./index";
import { ServiceError } from "./errors";
import * as s from "./schema";
import { desktopPatternRecord } from "../resourceCatalog/catalog";
export const desktopPatternName = "desktop-pattern";
export type NamedDesktopPattern = "checker" | "white" | "black";
/** Named 1-bit solids, a custom 8×8 `pat:<hex>`, or a System 7.5 Desktop Patterns `ppat` id. */
export type DesktopPattern = NamedDesktopPattern | `pat:${string}` | `ppat:${number}`;
const NAMED_PATTERNS = new Set<string>(["checker", "white", "black"]);

export function parseDesktopPattern(body: string): DesktopPattern {
  const value = body.replace(/\r?\n$/, "");
  if (NAMED_PATTERNS.has(value)) return value as NamedDesktopPattern;
  const custom = /^pat:([0-9a-fA-F]{16})$/.exec(value);
  if (custom) return `pat:${custom[1].toLowerCase()}` as DesktopPattern;
  const match = /^ppat:(-?\d+)$/.exec(value);
  if (match && desktopPatternRecord(Number(match[1]))) return value as DesktopPattern;
  throw new ServiceError("invalid-argument", "Expected checker, white, black, pat:<16 hex>, or ppat:<id>");
}
export async function createDesktopSettings(fs: FileSystem) {
  const located = fs.locate("preferences");
  if (!located) throw new ServiceError("missing-resource", "Preferences folder is missing");
  const preferences = located;
  const name = desktopPatternName;
  const [pattern, setPattern] = createSignal<DesktopPattern>("checker");
  const [diagnostic, setDiagnostic] = createSignal<string | null>(null);
  let observed = "",
    sequence = 0,
    stopped = false;
  let pending: Promise<void> = Promise.resolve();
  const writes = new Set<Promise<unknown>>();
  async function refresh() {
    const node = fs.child(preferences.id, name);
    const key = node ? `${node.id}:${node.revision}` : "missing";
    if (key === observed) return;
    observed = key;
    const current = ++sequence;
    let value: DesktopPattern = "checker",
      error: string | null = null;
    try {
      if (!node || node.kind !== "file") throw new Error("Desktop preference is missing; using checker");
      value = parseDesktopPattern((await fs.readText(node.id)) ?? "");
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (!stopped && current === sequence) {
      setPattern(value);
      setDiagnostic(error);
    }
  }
  const unsubscribe = fs.subscribe(() => {
    pending = pending.then(refresh);
  });
  await refresh();
  return {
    pattern,
    diagnostic,
    set(body: string) {
      const value = parseDesktopPattern(body);
      const write = (async () => {
        await fs.writeFile(preferences.id, name, value + "\n", {
          type: "text/plain"
        });
        await fs.flush();
        await pending;
        return {
          pattern: pattern(),
          diagnostic: diagnostic()
        };
      })();
      writes.add(write);
      void write.finally(() => writes.delete(write)).catch(() => {});
      return write;
    },
    async settled() {
      await Promise.all([...writes]);
      await pending;
    },
    shutdown() {
      stopped = true;
      sequence++;
      unsubscribe();
    }
  };
}
export type DesktopSettings = Awaited<ReturnType<typeof createDesktopSettings>>;

export function registerDesktopSettings(kernel: Kernel, settings: DesktopSettings) {
  kernel.register(defineOperation(
    "desktop_pattern",
    "Read or set the persistent desktop pattern (checker, white, black, pat:<16 hex>, or ppat:<id>)",
    { value: s.string },
    [],
    s.object({ pattern: s.string, diagnostic: s.string }),
    async (a) => {
      if (a.value !== undefined) await settings.set(a.value);
      return { pattern: settings.pattern(), diagnostic: settings.diagnostic() ?? "" };
    },
  ));
}
