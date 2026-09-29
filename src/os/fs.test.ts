import { describe, it, expect } from "vitest";
import { FileSystem, InMemoryBackend, MIME, ROOT_ID } from "@mockintosh/fs";
import { bootstrapFileSystem, STARTUP_VOLUME_NAME } from "./fsBootstrap";
import { createAppStorage } from "./appStorage";

async function bootedFS() {
  const fs = await FileSystem.open({ backend: new InMemoryBackend(), persistDelayMs: 0 });
  await bootstrapFileSystem(fs);
  return fs;
}

describe("bootstrapFileSystem", () => {
  it("creates the startup volume with every role folder and the desktop shortcuts", async () => {
    const fs = await bootedFS();
    const hd = fs.locate("volume")!;
    expect(hd.name).toBe(STARTUP_VOLUME_NAME);
    for (const role of ["desktop", "trash", "applications", "system", "preferences", "pictures", "extensions", "printer-drivers"] as const) {
      expect(fs.locate(role, hd.id), role).toBeDefined();
    }
    expect(fs.pathOf(fs.locate("preferences")!.id)).toBe(`/${STARTUP_VOLUME_NAME}/System Folder/Preferences`);
    expect(fs.pathOf(fs.locate("pictures")!.id)).toBe(`/${STARTUP_VOLUME_NAME}/Pictures`);
    expect(fs.pathOf(fs.locate("printer-drivers")!.id)).toBe(
      `/${STARTUP_VOLUME_NAME}/System Folder/Extensions/Printer Drivers`,
    );
    const shortcuts = fs.children(fs.locate("desktop")!.id);
    expect(shortcuts.length).toBeGreaterThan(0);
    expect(shortcuts.every((n) => n.kind === "file" && n.type === MIME.appShortcut)).toBe(true);
  });

  it("erase() then bootstrap yields a first-boot desktop including Canvas", async () => {
    const fs = await bootedFS();
    const desktop = fs.locate("desktop")!;
    await fs.writeJSON(desktop.id, "scratch", { n: 1 }, { type: MIME.json });
    expect(fs.child(desktop.id, "scratch")).toBeDefined();

    await fs.erase();
    expect(fs.volumes()).toEqual([]);
    await bootstrapFileSystem(fs);

    const names = fs.children(fs.locate("desktop")!.id).map((n) => n.name);
    expect(names).toContain("Canvas");
    expect(names).toContain("MacPaint");
    expect(names).toContain("Dither");
    expect(names).toContain("Trace");
    expect(names).not.toContain("scratch");
    expect(fs.locate("volume")?.name).toBe(STARTUP_VOLUME_NAME);
  });

  it("repairs missing role folders without touching user renames", async () => {
    const fs = await bootedFS();
    const trash = fs.locate("trash")!;
    fs.rename(trash.id, "Bin");
    await fs.remove(fs.locate("system")!.id);
    await bootstrapFileSystem(fs);
    expect(fs.locate("trash")?.name).toBe("Bin");
    expect(fs.locate("system")).toBeDefined();
    expect(fs.locate("preferences")).toBeDefined();
  });

  it("adds a Dither shortcut to an existing desktop that lacks one", async () => {
    const fs = await FileSystem.open({ backend: new InMemoryBackend(), persistDelayMs: 0 });
    const hd = fs.mkdir(ROOT_ID, STARTUP_VOLUME_NAME, { role: "volume" });
    fs.mkdir(hd.id, "Desktop Folder", { role: "desktop" });
    fs.mkdir(hd.id, "Trash", { role: "trash" });
    fs.mkdir(hd.id, "Applications", { role: "applications" });
    const system = fs.mkdir(hd.id, "System Folder", { role: "system" });
    fs.mkdir(system.id, "Preferences", { role: "preferences" });
    await bootstrapFileSystem(fs);
    const dither = fs.child(fs.locate("desktop")!.id, "Dither");
    expect(dither).toMatchObject({
      kind: "file",
      type: MIME.appShortcut,
    });
    expect(fs.attributes(dither!.id).icon).toBe("dither/icon");
    const trace = fs.child(fs.locate("desktop")!.id, "Trace");
    expect(trace).toMatchObject({ kind: "file", type: MIME.appShortcut });
    expect(fs.attributes(trace!.id).icon).toBe("trace/icon");
  });

  it("updates a camera-icon Dither shortcut to Scanned Art", async () => {
    const fs = await bootedFS();
    const desktop = fs.locate("desktop")!;
    const dither = fs.child(desktop.id, "Dither")!;
    fs.setAttributes(dither.id, { icon: "icon/camera" });
    await bootstrapFileSystem(fs);
    expect(fs.attributes(dither.id).icon).toBe("dither/icon");
  });
});

describe("createAppStorage", () => {
  it("keeps each app's keys in its own Preferences folder", async () => {
    const fs = await bootedFS();
    const a = createAppStorage(fs, "alpha");
    const b = createAppStorage(fs, "beta");

    expect(await a.read("settings.json")).toBeNull();
    await a.write("settings.json", '{"x":1}');
    await a.write("notes", "hello");
    await b.write("settings.json", '{"x":2}');

    expect(await a.read("settings.json")).toBe('{"x":1}');
    expect(await b.read("settings.json")).toBe('{"x":2}');
    expect((await a.list()).sort()).toEqual(["notes", "settings.json"]);

    const prefs = fs.locate("preferences")!;
    expect(fs.children(prefs.id).map((n) => n.name)).toEqual(["alpha", "beta"]);
    const folder = fs.child(prefs.id, "alpha")!;
    expect(fs.child(folder.id, "settings.json")).toMatchObject({ kind: "file", type: MIME.json });
    expect(fs.child(folder.id, "notes")).toMatchObject({ kind: "file", type: MIME.text });

    await a.remove("notes");
    expect(await a.list()).toEqual(["settings.json"]);
    await a.remove("missing"); // no-op
  });

  it("keeps bytes as they were written, typed by the key's extension", async () => {
    const fs = await bootedFS();
    const storage = createAppStorage(fs, "alpha");
    expect(await storage.readBytes("take.wav")).toBeNull();
    const bytes = new Uint8Array([0, 1, 254, 255, 128]);
    await storage.writeBytes("take.wav", bytes);
    expect(await storage.readBytes("take.wav")).toEqual(bytes);
    const folder = fs.child(fs.locate("preferences")!.id, "alpha")!;
    expect(fs.child(folder.id, "take.wav")).toMatchObject({ kind: "file", type: "audio/wav" });
  });
});
