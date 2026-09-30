/**
 * Installed apps live in the file system: each is a `MIME.app` file in the
 * Applications folder whose body is the `AppManifest`. Opening one from the
 * Finder launches the app; trashing it uninstalls. Installing also leaves a
 * shortcut on the desktop.
 *
 * A manifest's `entry` is either a bundle URL, loaded through
 * `Platform.loadModule`, or `bundled:<id>`, loaded from the host's bundled-app
 * registry. A platform without `loadModule` can still install bundled apps.
 */
import { MIME, type FileSystem, type FSFile } from "@mockintosh/fs";
import { setAppSource } from "./process/sources";
import type { AppManifest, Capability } from "@mockintosh/sdk";
import type { Sprite } from "@mockintosh/ui";
import type { ModuleLoader } from "../platform/types";
import { getApp, registerApp, registerUnavailableApp, type SolidApp } from "./apps";
import { bundledApps, bundledIdFromEntry, bundledManifest, getBundledApp, type BundledAppListing } from "./bundledApps";
import { missingCapabilities, type CapabilitySet } from "./capabilities";
import type { SpriteRegistry } from "./sprites/registry";

/**
 * What an app bundle's entry module must export. A `defineApp` result is
 * structurally the OS's `SolidApp`; the loader only checks shape at runtime.
 */
interface AppModule {
  default: SolidApp<any>;
  sprites?: Record<string, Sprite>;
}

export interface AppInstaller {
  /** Load an app's bundle and register it; then record the install in the file system. */
  install(manifest: AppManifest): Promise<void>;
  /** Load every installed app this platform can run; record the rest as unavailable. */
  loadInstalled(): Promise<void>;
}

export interface AppInstallerOptions {
  fs: FileSystem;
  sprites: SpriteRegistry;
  capabilities: CapabilitySet;
  /** Absent on hosts that cannot fetch a bundle URL. Bundled apps still install. */
  loadModule?: ModuleLoader;
}

function sdkMajor(sdk: string | undefined): number {
  const m = sdk?.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

export function createAppInstaller(options: AppInstallerOptions): AppInstaller {
  const { fs, sprites, capabilities, loadModule } = options;
  const loaded = new Set<string>();

  async function load(manifest: AppManifest): Promise<SolidApp<any>> {
    if (sdkMajor(manifest.sdk) < 3) {
      throw new Error(
        `"${manifest.title}" was built for SDK ${manifest.sdk || "2"}. Rebuild the project for SDK 3.`,
      );
    }
    if (loaded.has(manifest.id)) {
      const existing = getApp(manifest.id);
      if (existing) return existing;
    }

    const module = validateModule(manifest.id, await loadEntry(manifest, loadModule));
    const bundledId = bundledIdFromEntry(manifest.entry);
    setAppSource(manifest.id, bundledId !== undefined ? { kind: "bundled", id: bundledId } : { kind: "url", url: manifest.entry });
    if (module.sprites) sprites.registerAll(module.sprites);
    registerApp(module.default);
    loaded.add(manifest.id);
    return module.default;
  }

  return {
    async install(manifest) {
      await load(manifest);
      await writeManifest(fs, manifest);
      await ensureDesktopShortcut(fs, manifest);
    },

    async loadInstalled() {
      const loadable: AppManifest[] = [];
      for (const manifest of await readInstalledManifests(fs)) {
        const missing: Capability[] = missingCapabilities(manifest.requires, capabilities);
        if (sdkMajor(manifest.sdk) < 3) {
          registerUnavailableApp({ id: manifest.id, title: manifest.title, missing: [] });
          continue;
        }
        if (missing.length === 0) loadable.push(manifest);
        else registerUnavailableApp({ id: manifest.id, title: manifest.title, missing });
      }
      const results = await Promise.allSettled(loadable.map(load));
      results.forEach((result, i) => {
        if (result.status === "rejected") {
          console.error(`Failed to load installed app "${loadable[i].id}":`, result.reason);
        }
      });
    },
  };
}

async function loadEntry(manifest: AppManifest, loadModule: ModuleLoader | undefined): Promise<unknown> {
  const bundledId = bundledIdFromEntry(manifest.entry);
  if (bundledId !== undefined) {
    const listing = getBundledApp(bundledId);
    if (!listing) throw new Error(`No bundled app "${bundledId}".`);
    return listing.load();
  }
  if (!loadModule) throw new Error("This Macintosh cannot load app bundles.");
  return loadModule(manifest.entry);
}

/**
 * One-time. A desktop that already had shortcuts to bundled apps keeps them
 * working: each such shortcut with no manifest becomes an install. The marker
 * on the Applications folder means a later uninstall stays uninstalled.
 * `listings` defaults to everything the host registered.
 */
export async function migrateBundledDesktopShortcuts(
  fs: FileSystem,
  installer: AppInstaller,
  listings: readonly BundledAppListing[] = bundledApps(),
): Promise<void> {
  const apps = fs.locate("applications");
  if (!apps || fs.attributes(apps.id).bundledAppsMigrated === true) return;

  const installed = new Set(installedAppIds(fs));
  const shortcutIds = await desktopShortcutAppIds(fs);
  let failed = false;
  for (const listing of listings) {
    if (!shortcutIds.has(listing.id) || installed.has(listing.id)) continue;
    try {
      await installer.install(bundledManifest(listing));
    } catch (err) {
      failed = true;
      console.error(`Failed to install bundled app "${listing.id}":`, err);
    }
  }
  if (failed) return;
  fs.setAttributes(apps.id, { bundledAppsMigrated: true });
  await fs.flush();
}

export function validateModule(appId: string, module: unknown): AppModule {
  const m = module as Partial<AppModule> | null;
  const app = m?.default;
  if (!app || typeof app !== "object") {
    throw new Error(`Invalid app bundle for "${appId}": no default export`);
  }
  if (app.id !== appId || typeof app.Component !== "function") {
    throw new Error(`Invalid app bundle for "${appId}": expected defineApp({ Component })`);
  }
  if (!app.title || !app.icon || !app.defaultSize) {
    throw new Error(`Invalid app bundle for "${appId}": missing title, icon, or defaultSize`);
  }
  return {
    default: app,
    sprites: m.sprites && typeof m.sprites === "object" ? m.sprites : undefined,
  };
}

function manifestFiles(fs: FileSystem): FSFile[] {
  const apps = fs.locate("applications");
  if (!apps) return [];
  return fs.children(apps.id).filter((n): n is FSFile => n.kind === "file" && n.type === MIME.app);
}

function isManifest(v: unknown): v is AppManifest {
  const m = v as Partial<AppManifest> | null;
  return !!m && typeof m.id === "string" && typeof m.entry === "string" && typeof m.title === "string";
}

/** Manifests of every installed app (reactive: tracks the Applications folder). */
export async function readInstalledManifests(fs: FileSystem): Promise<AppManifest[]> {
  const parsed = await Promise.all(manifestFiles(fs).map((f) => fs.readJSON<unknown>(f.id)));
  return parsed.filter(isManifest);
}

/** The app id a manifest file installs, kept as an attribute so it can be read synchronously. */
function installedAppId(fs: FileSystem, file: FSFile): string | undefined {
  const id = fs.attributes(file.id).appId;
  return typeof id === "string" ? id : undefined;
}

/** Ids of installed apps (reactive) — what the App Store needs for its checkmarks. */
export function installedAppIds(fs: FileSystem): string[] {
  return manifestFiles(fs).flatMap((f) => installedAppId(fs, f) ?? []);
}

async function writeManifest(fs: FileSystem, manifest: AppManifest): Promise<FSFile> {
  const apps = fs.locate("applications");
  if (!apps) throw new Error("File system has no Applications folder");
  // Replace any earlier install of the same app, whatever it was named.
  for (const f of manifestFiles(fs)) {
    if (installedAppId(fs, f) === manifest.id && f.name !== manifest.title) await fs.remove(f.id);
  }
  return fs.writeJSON(apps.id, manifest.title, manifest, {
    type: MIME.app,
    attributes: { icon: manifest.icon, appId: manifest.id },
  });
}

async function desktopShortcutAppIds(fs: FileSystem): Promise<Set<string>> {
  const ids = new Set<string>();
  const desktop = fs.locate("desktop");
  if (!desktop) return ids;
  for (const node of fs.children(desktop.id)) {
    if (node.kind !== "file" || node.type !== MIME.appShortcut) continue;
    const shortcut = await fs.readJSON<{ appId?: string }>(node.id);
    if (shortcut?.appId) ids.add(shortcut.appId);
  }
  return ids;
}

/** A Finder icon for an install, unless the desktop already has one for this app. */
async function ensureDesktopShortcut(fs: FileSystem, manifest: AppManifest): Promise<void> {
  const desktop = fs.locate("desktop");
  if (!desktop) return;
  if ((await desktopShortcutAppIds(fs)).has(manifest.id)) return;
  if (fs.child(desktop.id, manifest.title)) return;
  await fs.writeJSON(desktop.id, manifest.title, { appId: manifest.id }, {
    type: MIME.appShortcut,
    attributes: { icon: manifest.icon },
  });
}
