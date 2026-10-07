import { describe, it, expect } from "vitest";
import { createRoot, createMemo, createEffect, flush, resolve } from "solid-js";
import { FileSystem, InMemoryBackend, ROOT_ID, MIME, FSError, type FSBackend } from "../src";

let idCounter = 0;
const nextId = () => `n${++idCounter}`;

async function openFS(backend = new InMemoryBackend()) {
  const fs = await FileSystem.open({ backend, persistDelayMs: 0, generateId: nextId, now: () => 1000 });
  return { fs, backend };
}

/** A typical boot layout: one volume with the well-known folders. */
async function openMac() {
  const { fs, backend } = await openFS();
  const hd = fs.mkdir(ROOT_ID, "Mockintosh HD", { role: "volume" });
  const desktop = fs.mkdir(hd.id, "Desktop Folder", { role: "desktop" });
  const trash = fs.mkdir(hd.id, "Trash", { role: "trash" });
  return { fs, backend, hd, desktop, trash };
}

describe("FileSystem — catalog", () => {
  it("starts with a root directory", async () => {
    const { fs } = await openFS();
    const root = fs.directory(ROOT_ID);
    expect(root?.role).toBe("root");
    expect(fs.children(ROOT_ID)).toEqual([]);
  });

  it("mkdir is idempotent for an existing folder and rejects a clashing file", async () => {
    const { fs, hd } = await openMac();
    const a = fs.mkdir(hd.id, "Docs");
    expect(fs.mkdir(hd.id, "Docs").id).toBe(a.id);
    await fs.writeFile(hd.id, "notes.txt", "hi");
    expect(() => fs.mkdir(hd.id, "notes.txt")).toThrow(FSError);
  });

  it("mkdir uses an id it's given, and refuses one that's taken", async () => {
    const { fs, hd } = await openMac();
    const made = fs.mkdir(hd.id, "From a process", { id: "chosen" });
    expect(made.id).toBe("chosen");
    expect(fs.child(hd.id, "From a process")?.id).toBe("chosen");
    expect(() => fs.mkdir(hd.id, "Another", { id: "chosen" })).toThrow(FSError);
  });

  it("children are folders first, then files, alphabetical", async () => {
    const { fs, hd } = await openMac();
    await fs.writeFile(hd.id, "b.txt", "");
    await fs.writeFile(hd.id, "a.txt", "");
    fs.mkdir(hd.id, "Zeta");
    expect(fs.children(hd.id).map((n) => n.name)).toEqual([
      "Desktop Folder",
      "Trash",
      "Zeta",
      "a.txt",
      "b.txt",
    ]);
  });

  it("writeFile infers a MIME type, stores byte size and keeps the id on overwrite", async () => {
    const { fs, hd } = await openMac();
    const f1 = await fs.writeFile(hd.id, "readme.md", "héllo");
    expect(f1.type).toBe(MIME.markdown);
    expect(f1.size).toBe(6); // é is two bytes
    const f2 = await fs.writeFile(hd.id, "readme.md", "x");
    expect(f2.id).toBe(f1.id);
    expect(f2.size).toBe(1);
    expect(await fs.readText(f1.id)).toBe("x");
    expect(fs.children(hd.id).filter((n) => n.name === "readme.md")).toHaveLength(1);
  });

  it("an explicit type survives overwrite without a type", async () => {
    const { fs, desktop } = await openMac();
    const f = await fs.writeJSON(desktop.id, "Photo Booth", { appId: "photobooth" }, { type: MIME.appShortcut });
    await fs.writeFile(desktop.id, "Photo Booth", "{}");
    expect(fs.file(f.id)?.type).toBe(MIME.appShortcut);
    expect(await fs.readJSON<{ appId?: string }>(f.id)).toEqual({});
  });

  it("availableName numbers clashes and keeps the extension last", async () => {
    const { fs, hd } = await openMac();
    expect(fs.availableName(hd.id, "untitled folder")).toBe("untitled folder");
    fs.mkdir(hd.id, "untitled folder");
    fs.mkdir(hd.id, "untitled folder 2");
    expect(fs.availableName(hd.id, "untitled folder")).toBe("untitled folder 3");
    await fs.writeFile(hd.id, "a.txt", "");
    expect(fs.availableName(hd.id, "a.txt")).toBe("a 2.txt");
  });

  it("resolve / pathOf round-trip", async () => {
    const { fs, desktop } = await openMac();
    expect(fs.resolve("/Mockintosh HD/Desktop Folder")?.id).toBe(desktop.id);
    expect(fs.pathOf(desktop.id)).toBe("/Mockintosh HD/Desktop Folder");
    expect(fs.resolve("/Nope")).toBeUndefined();
    expect(fs.pathOf(ROOT_ID)).toBe("/");
  });

  it("locate finds well-known folders by role, not name", async () => {
    const { fs, hd, trash } = await openMac();
    fs.rename(trash.id, "Wastebasket");
    expect(fs.locate("trash")?.id).toBe(trash.id);
    expect(fs.locate("trash", hd.id)?.id).toBe(trash.id);
    expect(fs.locate("applications")).toBeUndefined();
    expect(fs.volumes().map((v) => v.id)).toEqual([hd.id]);
    expect(fs.volumeOf(trash.id)?.id).toBe(hd.id);
  });

  it("usedBytes sums every file under a directory, nested folders and the Trash included", async () => {
    const { fs, hd, desktop, trash } = await openMac();
    expect(fs.usedBytes(hd.id)).toBe(0);
    await fs.writeFile(desktop.id, "a.txt", "hello");
    const docs = fs.mkdir(hd.id, "Docs");
    await fs.writeFile(fs.mkdir(docs.id, "Deep").id, "b.bin", new Uint8Array(1000));
    await fs.writeFile(trash.id, "c.txt", "xyz");
    expect(fs.usedBytes(docs.id)).toBe(1000);
    expect(fs.usedBytes(hd.id)).toBe(1008);
  });

  it("roles are indexed anywhere in a volume, are unique per volume, and follow moves", async () => {
    const { fs, hd } = await openMac();
    const system = fs.mkdir(hd.id, "System Folder", { role: "system" });
    const prefs = fs.mkdir(system.id, "Preferences", { role: "preferences" });
    expect(fs.locate("preferences")?.id).toBe(prefs.id);
    expect(() => fs.mkdir(hd.id, "Another", { role: "trash" })).toThrow(/already has/);
    expect(() => fs.mkdir(hd.id, "Disk", { role: "volume" })).toThrow(FSError);

    const other = fs.mkdir(ROOT_ID, "Other Disk", { role: "volume" });
    fs.move(system.id, other.id);
    expect(fs.locate("preferences", hd.id)).toBeUndefined();
    expect(fs.locate("preferences", other.id)?.id).toBe(prefs.id);

    await fs.remove(system.id);
    expect(fs.locate("preferences")).toBeUndefined();
  });

  it("rename rejects clashes and invalid names, and re-infers an inferred type", async () => {
    const { fs, hd } = await openMac();
    const f = await fs.writeFile(hd.id, "a.txt", "");
    await fs.writeFile(hd.id, "b.txt", "");
    expect(() => fs.rename(f.id, "b.txt")).toThrow(/already exists/);
    expect(() => fs.rename(f.id, "x/y")).toThrow(FSError);
    fs.rename(f.id, "a.md");
    expect(fs.file(f.id)?.type).toBe(MIME.markdown);
  });

  it("move updates both directories and refuses cycles and clashes", async () => {
    const { fs, hd, trash } = await openMac();
    const docs = fs.mkdir(hd.id, "Docs");
    const inner = fs.mkdir(docs.id, "Inner");
    const f = await fs.writeFile(hd.id, "a.txt", "");
    fs.move(f.id, docs.id);
    expect(fs.children(hd.id).some((n) => n.id === f.id)).toBe(false);
    expect(fs.node(f.id)?.parentId).toBe(docs.id);
    expect(() => fs.move(docs.id, inner.id)).toThrow(/into itself/);
    await fs.writeFile(trash.id, "a.txt", "");
    expect(() => fs.move(f.id, trash.id)).toThrow(/already exists/);
    expect(() => fs.move(ROOT_ID, docs.id)).toThrow(FSError);
  });

  it("remove deletes a subtree, its attributes and its blobs", async () => {
    const { fs, backend, hd } = await openMac();
    const docs = fs.mkdir(hd.id, "Docs");
    const f = await fs.writeFile(docs.id, "a.txt", "aaa");
    fs.setAttributes(f.id, { position: { x: 1, y: 2 } });
    await fs.remove(docs.id);
    expect(fs.node(docs.id)).toBeUndefined();
    expect(fs.node(f.id)).toBeUndefined();
    expect(fs.attributes(f.id)).toEqual({});
    expect(backend.blobIds()).toEqual([]);
    expect(fs.children(hd.id).map((n) => n.name)).toEqual(["Desktop Folder", "Trash"]);
  });

  it("attributes merge and null deletes a key", async () => {
    const { fs, hd } = await openMac();
    fs.setAttributes(hd.id, { icon: "icon/hd", zOrder: 3 });
    fs.setAttributes(hd.id, { zOrder: null });
    expect(fs.attributes(hd.id)).toEqual({ icon: "icon/hd" });
    expect(() => fs.setAttributes("nope", { a: 1 })).toThrow(FSError);
  });
});

describe("FileSystem — reactivity", () => {
  it("a memo over children() re-runs only when that directory changes", async () => {
    const { fs, hd, desktop, trash } = await openMac();
    let desktopRuns = 0;
    let trashRuns = 0;
    await new Promise<void>((done) =>
      createRoot(async (dispose) => {
        const desktopNames = createMemo(() => {
          desktopRuns++;
          return fs.children(desktop.id).map((n) => n.name);
        });
        createMemo(() => {
          trashRuns++;
          return fs.children(trash.id).length;
        });
        expect(desktopNames()).toEqual([]);

        await fs.writeFile(desktop.id, "a.txt", "");
        flush();
        await resolve(() => desktopNames());
        expect(desktopNames()).toEqual(["a.txt"]);
        expect(desktopRuns).toBe(2);
        expect(trashRuns).toBe(1);

        fs.mkdir(hd.id, "Unrelated");
        flush();
        expect(desktopRuns).toBe(2);

        fs.rename(fs.child(desktop.id, "a.txt")!.id, "b.txt");
        flush();
        await resolve(() => desktopNames());
        expect(desktopNames()).toEqual(["b.txt"]);
        expect(trashRuns).toBe(1);
        dispose();
        done();
      })
    );
  });

  it("batch() still persists once while each mutation is visible immediately", async () => {
    const { fs, hd } = await openMac();
    let runs = 0;
    createRoot(() => {
      createEffect(
        () => { fs.children(hd.id); },
        () => { runs++; },
      );
    });
    flush();
    expect(runs).toBe(1);
    fs.batch(() => {
      fs.mkdir(hd.id, "A");
      fs.mkdir(hd.id, "B");
      fs.mkdir(hd.id, "C");
    });
    flush();
    // commit() flushes the store after every mutation so mkdir/writeFile
    // return live nodes. batch() only coalesces catalog persistence.
    expect(runs).toBe(4);
  });
});

describe("FileSystem — persistence", () => {
  it("flush writes a v2 catalog that reloads identically", async () => {
    const { fs, backend, hd } = await openMac();
    const f = await fs.writeFile(hd.id, "a.txt", "abc");
    fs.setAttributes(f.id, { icon: "icon/file" });
    await fs.flush();
    const raw = await backend.readCatalog();
    expect(raw).toContain('"version":3');

    const reopened = await FileSystem.open({ backend, persistDelayMs: 0 });
    expect(reopened.pathOf(f.id)).toBe("/Mockintosh HD/a.txt");
    expect(reopened.attributes(f.id)).toEqual({ icon: "icon/file" });
    expect(reopened.locate("desktop")?.name).toBe("Desktop Folder");
    expect(await reopened.readText(f.id)).toBe("abc");
  });

  it("erase() formats the disk and a reopen sees only the root", async () => {
    const { fs, backend, hd } = await openMac();
    const file = await fs.writeFile(hd.id, "secret.txt", "keep out");
    await fs.flush();
    expect(backend.blobIds()).toContain(file.id);

    await fs.erase();
    expect(fs.volumes()).toEqual([]);
    expect(fs.children(ROOT_ID)).toEqual([]);
    expect(backend.blobIds()).toEqual([]);
    expect(await backend.readCatalog()).toContain(`"${ROOT_ID}"`);

    const reopened = await FileSystem.open({ backend, persistDelayMs: 0 });
    expect(reopened.volumes()).toEqual([]);
    expect(reopened.node(file.id)).toBeUndefined();
  });

  it("writes the body before the catalog entry appears", async () => {
    const events: string[] = [];
    const inner = new InMemoryBackend();
    const spy: FSBackend = {
      init: () => inner.init(),
      readCatalog: () => inner.readCatalog(),
      writeCatalog: (j) => { events.push("catalog"); return inner.writeCatalog(j); },
      readBlob: (id) => inner.readBlob(id),
      writeBlob: (id, b) => { events.push("blob"); return inner.writeBlob(id, b); },
      deleteBlob: (id) => { events.push("delete"); return inner.deleteBlob(id); },
      clear: () => { events.push("clear"); return inner.clear(); },
    };
    const fs = await FileSystem.open({ backend: spy, persistDelayMs: 0 });
    await fs.flush();
    events.length = 0;

    const p = fs.writeFile(ROOT_ID, "a.txt", "x");
    expect(fs.child(ROOT_ID, "a.txt")).toBeUndefined(); // not yet visible
    const f = await p;
    expect(events[0]).toBe("blob");
    await fs.flush();
    expect(events).toContain("catalog");

    events.length = 0;
    await fs.remove(f.id);
    // Catalog removal is persisted before the blob is deleted.
    expect(fs.node(f.id)).toBeUndefined();
    expect(events).toEqual(["catalog", "delete"]);
  });

  it("migrates a v1 FileManager catalog: roles, MIME types, attributes", async () => {
    const v1 = {
      version: 1,
      nodes: {
        __root__: { id: "__root__", name: "/", kind: "directory", parentId: null, createdAt: 1, modifiedAt: 1 },
        hd: { id: "hd", name: "Mockintosh HD", kind: "directory", parentId: "__root__", createdAt: 2, modifiedAt: 2, icon: "icon/hd" },
        dt: { id: "dt", name: "Desktop Folder", kind: "directory", parentId: "hd", createdAt: 3, modifiedAt: 3 },
        tr: { id: "tr", name: "Trash", kind: "directory", parentId: "hd", createdAt: 3, modifiedAt: 3 },
        ap: { id: "ap", name: "Applications", kind: "directory", parentId: "hd", createdAt: 3, modifiedAt: 3 },
        sc: { id: "sc", name: "Photo Booth", kind: "file", parentId: "dt", createdAt: 4, modifiedAt: 4,
              fileType: "app-shortcut", size: 22, icon: "icon/photobooth-smr-32", position: { x: 10, y: 20 }, zOrder: 5 },
        md: { id: "md", name: "README.md", kind: "file", parentId: "hd", createdAt: 4, modifiedAt: 4, fileType: "text", size: 3 },
        dk: { id: "dk", name: "Cards.deck", kind: "file", parentId: "hd", createdAt: 4, modifiedAt: 4, fileType: "text", size: 3 },
        im: { id: "im", name: "Photo 1", kind: "file", parentId: "dt", createdAt: 4, modifiedAt: 4, fileType: "image", size: 3 },
        orphan: { id: "orphan", name: "lost", kind: "file", parentId: "gone", createdAt: 4, modifiedAt: 4, fileType: "text", size: 0 },
      },
    };
    const backend = new InMemoryBackend(JSON.stringify(v1));
    const fs = await FileSystem.open({ backend, persistDelayMs: 0 });

    expect(fs.directory("hd")?.role).toBe("volume");
    expect(fs.locate("desktop")?.id).toBe("dt");
    expect(fs.locate("trash")?.id).toBe("tr");
    expect(fs.locate("applications")?.id).toBe("ap");
    expect(fs.file("sc")?.type).toBe(MIME.appShortcut);
    expect(fs.file("md")?.type).toBe(MIME.markdown);
    expect(fs.file("dk")?.type).toBe(MIME.deck);
    expect(fs.file("im")?.type).toBe(MIME.sprite);
    expect(fs.attributes("sc")).toEqual({ icon: "icon/photobooth-smr-32", position: { x: 10, y: 20 }, zOrder: 5 });
    expect(fs.attributes("hd")).toEqual({ icon: "icon/hd" });
    expect(fs.node("orphan")).toBeUndefined();

    await fs.flush();
    expect(await backend.readCatalog()).toContain('"version":3');
  });

  it("a corrupt catalog yields a fresh root instead of throwing", async () => {
    const fs = await FileSystem.open({ backend: new InMemoryBackend("{not json"), persistDelayMs: 0 });
    expect(fs.directory(ROOT_ID)).toBeDefined();
  });
});
