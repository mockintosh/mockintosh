/**
 * What the App Store shares with the rest of the shell: the registry it lists
 * beside the bundled apps, and a way to open it on one app's page, as a
 * search result in Spotlight does. Both are shell apps on the OS's thread, so
 * the request is a signal the App Store's window takes: an open window turns
 * to the page, and a new one opens on it.
 */
import { createSignal } from "solid-js";
import type { AppDeclaration } from "@mockintosh/sdk";
import type { OSServices } from "./context";

export const APP_STORE_ID = "appstore";

const REGISTRY_URL = "https://raw.githubusercontent.com/mockintosh/app-registry/main/registry.json";

export interface RegistryEntry {
  id: string;
  title: string;
  author: string;
  version: string;
  sdk: string;
  description: string;
  icon?: string;
  permissions?: string[];
  entry: string | null;
  /**
   * The publisher's declaration (their `manifest.json`): the icon's pixels,
   * so the listing shows the real icon, and what installing needs to know.
   */
  declaration?: AppDeclaration;
}

function sdkMajor(sdk: string): number {
  const m = sdk.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

let registry: Promise<RegistryEntry[]> | undefined;

/** The registry's SDK v3 apps, fetched once per boot of the page; a failed fetch is tried again next time. */
export function loadRegistry(fetch: NonNullable<OSServices["fetch"]>): Promise<RegistryEntry[]> {
  registry ??= (async () => {
    const r = await fetch(REGISTRY_URL);
    const data = (await r.json()) as { apps?: RegistryEntry[] };
    return (data.apps ?? []).filter((e) => sdkMajor(e.sdk) >= 3);
  })().catch((error: unknown) => {
    registry = undefined;
    throw error;
  });
  return registry;
}

const [requestedPage, setRequestedPage] = createSignal<{ appId: string } | null>(null, { ownedWrite: true });

/** The page the App Store has been asked to show and hasn't yet; reading it with `take` clears it. */
export function pendingPage(): { appId: string } | null {
  return requestedPage();
}

export function takePendingPage(): void {
  setRequestedPage(null);
}

/** Open the App Store, or bring it forward, on the page of `appId`. */
export function showInAppStore(os: Pick<OSServices, "openApp">, appId: string): void {
  setRequestedPage({ appId });
  os.openApp(APP_STORE_ID);
}
