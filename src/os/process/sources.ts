/**
 * Where each app's code came from, so a process can load the same code. The
 * OS records it as it loads an app; an app with no record is a bundled one.
 */
import type { AppSource } from "./protocol";

const sources = new Map<string, AppSource>();

export function setAppSource(appId: string, source: AppSource): void {
  sources.set(appId, source);
}

export function appSource(appId: string): AppSource {
  return sources.get(appId) ?? { kind: "bundled", id: appId };
}
