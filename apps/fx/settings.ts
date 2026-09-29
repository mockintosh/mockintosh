import type { AppStorage } from "@mockintosh/sdk";

/** What fx keeps between launches, in its preferences folder. */
export interface FxSettings {
  /** The user's Vercel AI Gateway key. */
  apiKey?: string;
}

const SETTINGS_KEY = "settings.json";

export async function readSettings(storage: AppStorage): Promise<FxSettings> {
  const raw = await storage.read(SETTINGS_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const apiKey = (parsed as { apiKey?: unknown }).apiKey;
    return typeof apiKey === "string" && apiKey ? { apiKey } : {};
  } catch {
    return {};
  }
}

export async function writeSettings(storage: AppStorage, settings: FxSettings): Promise<void> {
  await storage.write(SETTINGS_KEY, JSON.stringify(settings));
}

/** "…a1b2": enough to recognise a key without showing it. */
export function maskKey(key: string): string {
  return `…${key.slice(-4)}`;
}
