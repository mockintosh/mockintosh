/**
 * Optional apps that ship inside this build but are not on the desktop until
 * the user installs them from the App Store.
 *
 * The host (`systemApps.ts`) registers each one. Metadata and icon sprites are
 * available at boot; the app module itself stays behind `load`, so the OS can
 * list it without pulling its code into the boot bundle. Installing writes an
 * ordinary `.app` manifest whose `entry` is `bundled:<id>` — the installer
 * resolves that from this registry instead of fetching a URL.
 */
import type { AppManifest, Capability, Sprite } from "@mockintosh/sdk";

export const BUNDLED_ENTRY_PREFIX = "bundled:";

export interface BundledAppListing {
  id: string;
  title: string;
  description: string;
  icon: string;
  /** Icon (and document) sprites, registered at boot so they draw before install. */
  sprites?: Record<string, Sprite>;
  requires?: Capability[];
  permissions?: string[];
  /** The app module: a `defineApp` default export, same shape as a third-party bundle. */
  load: () => Promise<unknown>;
  /**
   * The app's declaration, so installing and launching it in a process never
   * loads its code on the OS's thread (`apps/declarations.generated.json`).
   */
  declaration?: import("./appDeclaration").AppDeclaration;
}

let listings: Map<string, BundledAppListing> | undefined;
function listingMap(): Map<string, BundledAppListing> {
  return (listings ??= new Map());
}

export function registerBundledApp(listing: BundledAppListing): void {
  listingMap().set(listing.id, listing);
}

export function getBundledApp(id: string): BundledAppListing | undefined {
  return listingMap().get(id);
}

/** Registration order — the order the App Store shows. */
export function bundledApps(): BundledAppListing[] {
  return Array.from(listingMap().values());
}

/** The id inside a `bundled:` entry, or undefined when `entry` is a bundle URL. */
export function bundledIdFromEntry(entry: string): string | undefined {
  if (!entry.startsWith(BUNDLED_ENTRY_PREFIX)) return undefined;
  const id = entry.slice(BUNDLED_ENTRY_PREFIX.length);
  return id.length > 0 ? id : undefined;
}

/** The manifest `AppInstaller.install` writes for a listing. */
export function bundledManifest(listing: BundledAppListing): AppManifest {
  return {
    id: listing.id,
    title: listing.title,
    description: listing.description,
    icon: listing.icon,
    author: "Mockintosh",
    version: "1.0",
    sdk: "3",
    permissions: listing.permissions ?? [],
    entry: BUNDLED_ENTRY_PREFIX + listing.id,
    requires: listing.requires,
  };
}
