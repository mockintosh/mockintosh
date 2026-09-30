import { afterEach, describe, expect, it, vi } from "vitest";
import { FileSystem, InMemoryBackend, MIME } from "@mockintosh/fs";
import type { AppManifest } from "@mockintosh/sdk";
import type { InspectionNode } from "@mockintosh/ui";
import AppStore from "../../apps/AppStore";
import { bootOS, type BootedOS } from "./boot";
import { createHeadlessPlatform } from "../platform/headless";
import { getWindows } from "./state";
import { getApp, registerApp } from "./apps";
import { registerBundledApp, bundledManifest, type BundledAppListing } from "./bundledApps";
import { bootstrapFileSystem } from "./fsBootstrap";
import {
  createAppInstaller,
  installedAppIds,
  migrateBundledDesktopShortcuts,
  readInstalledManifests,
} from "./installedApps";
import { SpriteRegistry } from "./sprites";

function toyListing(id = "toy"): BundledAppListing {
  return {
    id,
    title: "Toy",
    description: "A toy.",
    icon: "toy/icon",
    load: async () => ({
      default: {
        id,
        title: "Toy",
        icon: "toy/icon",
        defaultSize: { width: 10, height: 10 },
        Component: () => null,
      },
    }),
  };
}

const remoteManifest: AppManifest = {
  id: "remote",
  title: "Remote",
  description: "Elsewhere.",
  icon: "icon/computer",
  author: "Someone",
  version: "1.0",
  sdk: "3",
  permissions: [],
  entry: "https://example.com/remote.js",
};

async function disk() {
  const fs = await FileSystem.open({ backend: new InMemoryBackend(), persistDelayMs: 0 });
  await bootstrapFileSystem(fs);
  return fs;
}

describe("AppInstaller", () => {
  it("loads a bundled entry from the registry and leaves a desktop shortcut", async () => {
    const listing = toyListing();
    registerBundledApp(listing);
    const fs = await disk();
    let fetched = 0;
    const installer = createAppInstaller({
      fs,
      sprites: new SpriteRegistry(),
      capabilities: new Set(),
      loadModule: async () => {
        fetched++;
        return {};
      },
    });

    await installer.install(bundledManifest(listing));

    expect(fetched).toBe(0);
    expect(getApp("toy")?.title).toBe("Toy");
    expect(installedAppIds(fs)).toEqual(["toy"]);
    const manifests = await readInstalledManifests(fs);
    expect(manifests).toEqual([expect.objectContaining({ id: "toy", entry: "bundled:toy", sdk: "3" })]);
    const shortcut = fs.child(fs.locate("desktop")!.id, "Toy");
    expect(shortcut).toMatchObject({ kind: "file", type: MIME.appShortcut });
    expect(fs.attributes(shortcut!.id).icon).toBe("toy/icon");
    expect(await fs.readJSON(shortcut!.id)).toEqual({ appId: "toy" });

    await installer.install(bundledManifest(listing));
    const toys = fs.children(fs.locate("desktop")!.id).filter((n) => n.name === "Toy");
    expect(toys).toHaveLength(1);
  });

  it("refuses a bundle URL when the platform cannot load modules", async () => {
    const fs = await disk();
    const installer = createAppInstaller({
      fs,
      sprites: new SpriteRegistry(),
      capabilities: new Set(),
    });
    await expect(installer.install(remoteManifest)).rejects.toThrow(/cannot load app bundles/);
    await expect(installer.install({ ...remoteManifest, id: "gone", entry: "bundled:gone" })).rejects.toThrow(
      /No bundled app/,
    );
  });

  it("loads a bundle URL through the platform", async () => {
    const fs = await disk();
    const loadModule = vi.fn(async () => ({
      default: {
        id: "remote",
        title: "Remote",
        icon: "icon/computer",
        defaultSize: { width: 8, height: 8 },
        Component: () => null,
      },
    }));
    const installer = createAppInstaller({
      fs,
      sprites: new SpriteRegistry(),
      capabilities: new Set(),
      loadModule,
    });

    await installer.install(remoteManifest);

    expect(loadModule).toHaveBeenCalledWith(remoteManifest.entry);
    expect(getApp("remote")?.title).toBe("Remote");
    expect(fs.child(fs.locate("desktop")!.id, "Remote")).toMatchObject({ type: MIME.appShortcut });
  });
});

describe("migrateBundledDesktopShortcuts", () => {
  it("installs a bundled app that already has a desktop shortcut, once", async () => {
    const listing = toyListing("kept");
    registerBundledApp(listing);
    const fs = await disk();
    const desktop = fs.locate("desktop")!;
    await fs.writeJSON(desktop.id, "Kept", { appId: "kept" }, {
      type: MIME.appShortcut,
      attributes: { icon: "toy/icon" },
    });
    const installer = createAppInstaller({
      fs,
      sprites: new SpriteRegistry(),
      capabilities: new Set(),
    });

    await migrateBundledDesktopShortcuts(fs, installer, [listing]);

    expect(installedAppIds(fs)).toEqual(["kept"]);
    expect(fs.attributes(fs.locate("applications")!.id).bundledAppsMigrated).toBe(true);
    expect(
      fs.children(desktop.id).filter((n) => n.kind === "file" && n.type === MIME.appShortcut && n.name === "Kept"),
    ).toHaveLength(1);

    await fs.remove(fs.child(fs.locate("applications")!.id, "Toy")!.id);
    await migrateBundledDesktopShortcuts(fs, installer, [listing]);
    expect(installedAppIds(fs)).toEqual([]);
  });

  it("leaves a desktop without those shortcuts alone, and does not come back for a shortcut added later", async () => {
    const listing = toyListing("later");
    registerBundledApp(listing);
    const fs = await disk();
    const installer = createAppInstaller({
      fs,
      sprites: new SpriteRegistry(),
      capabilities: new Set(),
    });

    await migrateBundledDesktopShortcuts(fs, installer, [listing]);

    expect(installedAppIds(fs)).toEqual([]);
    expect(fs.attributes(fs.locate("applications")!.id).bundledAppsMigrated).toBe(true);

    await fs.writeJSON(fs.locate("desktop")!.id, "Later", { appId: "later" }, { type: MIME.appShortcut });
    await migrateBundledDesktopShortcuts(fs, installer, [listing]);
    expect(installedAppIds(fs)).toEqual([]);
    expect(getApp("later")).toBeUndefined();
  });
});

describe("App Store window", () => {
  let os: BootedOS;

  afterEach(() => {
    os?.shutdown();
    vi.useRealTimers();
  });

  it("lists a bundled app offline and installs it onto the desktop", async () => {
    vi.useFakeTimers();
    registerBundledApp({
      id: "shelf",
      title: "Shelf",
      description: "Sits on a shelf.",
      icon: "toy/icon",
      load: async () => ({
        default: {
          id: "shelf",
          title: "Shelf",
          icon: "toy/icon",
          defaultSize: { width: 10, height: 10 },
          Component: () => null,
        },
      }),
    });
    const platform = createHeadlessPlatform({ width: 640, height: 480 });
    os = await bootOS(platform);
    vi.advanceTimersByTime(1000);
    platform.tick();
    registerApp(AppStore);
    os.services.openApp("appstore");
    platform.tick();

    const window = getWindows().find((w) => w.appId === "appstore")!;
    const caller = os.kernel.createSession();
    const inspect = () =>
      os.kernel.invoke(caller, "inspect", { window: window.id }) as Promise<InspectionNode[]>;
    const text = (nodes: InspectionNode[]) => nodes.map((node) => node.text).join("\n");

    const beforeNodes = await inspect();
    const before = text(beforeNodes);
    expect(before).toContain("Mockintosh Apps");
    expect(before).toContain("Shelf");
    expect(before).not.toContain("Sits on a shelf.");
    expect(before).not.toContain("From the Registry");
    expect(beforeNodes.some((node) => node.name === "app-shelf")).toBe(true);
    expect(beforeNodes.some((node) => node.name === "install-shelf")).toBe(false);

    await os.kernel.invoke(caller, "click", { name: "app-shelf", window: window.id });
    platform.tick();
    const opened = text(await inspect());
    expect(opened).toContain("Shelf");
    expect(opened).toContain("Sits on a shelf.");
    expect(opened).not.toContain("Mockintosh Apps");

    await os.kernel.invoke(caller, "click", { name: "install-shelf", window: window.id });
    await vi.waitFor(async () => {
      platform.tick();
      expect(text(await inspect())).toContain("Installed Shelf.");
    });

    expect(installedAppIds(os.services.fs)).toEqual(["shelf"]);
    expect(getApp("shelf")?.title).toBe("Shelf");
    const shortcut = os.services.fs.child(os.services.fs.locate("desktop")!.id, "Shelf");
    expect(shortcut).toMatchObject({ kind: "file", type: MIME.appShortcut });
    expect((await inspect()).some((node) => node.name === "open-shelf")).toBe(true);

    await os.kernel.invoke(caller, "click", { name: "app-back", window: window.id });
    platform.tick();
    const list = text(await inspect());
    expect(list).toContain("Mockintosh Apps");
    expect(list).toContain("Shelf");
    expect(list).not.toContain("Sits on a shelf.");
  });
});
