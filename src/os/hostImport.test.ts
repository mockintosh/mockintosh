import { describe, expect, it } from "vitest";
import { FileSystem, InMemoryBackend } from "@mockintosh/fs";
import { bootstrapFileSystem } from "./fsBootstrap";
import {
  importHostFile,
  isImportableFont,
  isImportableHostFile,
  isImportableImage,
  resolveImportTarget,
} from "./hostImport";
import type { OSWindow } from "./state";

async function bootedFS() {
  const fs = await FileSystem.open({ backend: new InMemoryBackend(), persistDelayMs: 0 });
  await bootstrapFileSystem(fs);
  return fs;
}

function folderWindow(directoryId: string): OSWindow {
  return {
    id: "w1",
    appId: "finder",
    title: "Folder",
    x: 40,
    y: 40,
    width: 200,
    height: 120,
    kind: "finder-folder",
    props: { directoryId },
    scrollY: 0,
    scrollX: 0,
    contentHeight: 120,
    contentWidth: 200,
    scrollable: true,
    resizable: true,
  };
}

describe("hostImport", () => {
  it("isImportableImage accepts host MIME or a known extension", () => {
    expect(isImportableImage({ name: "a", type: "image/png", bytes: new Uint8Array() })).toBe(true);
    expect(isImportableImage({ name: "shot.JPEG", type: "", bytes: new Uint8Array() })).toBe(true);
    expect(isImportableImage({ name: "notes.txt", type: "text/plain", bytes: new Uint8Array() })).toBe(false);
  });

  it("isImportableFont accepts ttf/otf and rejects a random text file", () => {
    expect(isImportableFont({ name: "Garamond.ttf", type: "font/ttf", bytes: new Uint8Array() })).toBe(true);
    expect(isImportableFont({ name: "Face.OTF", type: "", bytes: new Uint8Array() })).toBe(true);
    expect(isImportableFont({ name: "notes.txt", type: "text/plain", bytes: new Uint8Array() })).toBe(false);
    expect(isImportableHostFile({ name: "notes.txt", type: "text/plain", bytes: new Uint8Array() })).toBe(false);
  });

  it("writes the image on the desktop with a camera icon", async () => {
    const fs = await bootedFS();
    const desktop = fs.locate("desktop")!;
    const file = await importHostFile(
      fs,
      desktop.id,
      { name: "portrait.png", type: "image/png", bytes: new Uint8Array([9, 8, 7]) },
      { x: 12, y: 24 },
    );
    expect(file.type).toBe("image/png");
    expect(file.size).toBe(3);
    expect(fs.attributes(file.id)).toMatchObject({
      icon: "icon/picture",
      position: { x: 12, y: 24 },
    });
    expect(await fs.readBytes(file.id)).toEqual(new Uint8Array([9, 8, 7]));
  });

  it("resolveImportTarget prefers a Finder folder under the pointer", async () => {
    const fs = await bootedFS();
    const apps = fs.locate("applications")!;
    const target = resolveImportTarget(fs, [folderWindow(apps.id)], 80, 80, 20);
    expect(target?.parentId).toBe(apps.id);
    expect(target?.openIn).toBeUndefined();
  });

  it("writes a dropped TTF on the desktop with the Foundry icon", async () => {
    const fs = await bootedFS();
    const desktop = fs.locate("desktop")!;
    const file = await importHostFile(
      fs,
      desktop.id,
      { name: "garamond.ttf", type: "font/ttf", bytes: new Uint8Array([0, 1, 0, 0]) },
      { x: 8, y: 16 },
    );
    expect(file.type).toBe("font/ttf");
    expect(file.size).toBe(4);
    expect(fs.attributes(file.id)).toMatchObject({
      icon: "foundry/icon",
      position: { x: 8, y: 16 },
    });
    expect(await fs.readBytes(file.id)).toEqual(new Uint8Array([0, 1, 0, 0]));
  });

  it("resolveImportTarget opens Dither when the drop hits its window", async () => {
    const fs = await bootedFS();
    const desktop = fs.locate("desktop")!;
    const dither: OSWindow = {
      id: "d1",
      appId: "dither",
      title: "Dither",
      x: 10,
      y: 30,
      width: 200,
      height: 160,
      kind: "document",
      props: {},
      scrollY: 0,
      scrollX: 0,
      contentHeight: 160,
      contentWidth: 200,
      scrollable: false,
      resizable: true,
    };
    const target = resolveImportTarget(fs, [dither], 40, 80, 20);
    expect(target?.parentId).toBe(desktop.id);
    expect(target?.openIn).toBe("dither");
  });

  it("resolveImportTarget opens Trace when the drop hits its window", async () => {
    const fs = await bootedFS();
    const desktop = fs.locate("desktop")!;
    const trace: OSWindow = {
      id: "t1",
      appId: "trace",
      title: "Trace",
      x: 10,
      y: 30,
      width: 200,
      height: 160,
      kind: "document",
      props: {},
      scrollY: 0,
      scrollX: 0,
      contentHeight: 160,
      contentWidth: 200,
      scrollable: false,
      resizable: true,
    };
    const target = resolveImportTarget(fs, [trace], 40, 80, 20);
    expect(target?.parentId).toBe(desktop.id);
    expect(target?.openIn).toBe("trace");
  });

  it("resolveImportTarget opens Foundry when the drop hits its window", async () => {
    const fs = await bootedFS();
    const desktop = fs.locate("desktop")!;
    const foundry: OSWindow = {
      id: "f1",
      appId: "foundry",
      title: "Foundry",
      x: 10,
      y: 30,
      width: 200,
      height: 160,
      kind: "document",
      props: {},
      scrollY: 0,
      scrollX: 0,
      contentHeight: 160,
      contentWidth: 200,
      scrollable: false,
      resizable: true,
    };
    const target = resolveImportTarget(fs, [foundry], 40, 80, 20);
    expect(target?.parentId).toBe(desktop.id);
    expect(target?.openIn).toBe("foundry");
  });
});
