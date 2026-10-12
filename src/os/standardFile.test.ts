import { describe, expect, it } from "vitest";
import { FileSystem, InMemoryBackend, MIME } from "@mockintosh/fs";
import { bootstrapFileSystem } from "./fsBootstrap";
import { TOUR_DISK_ID, mountTourDisk } from "./tourDisk";
import { DESKTOP, listPlace, parentPlace, placeName, placeOf, placePath, typeSelect, type SFPlace } from "./standardFile";

async function bootedFS() {
  const fs = await FileSystem.open({ backend: new InMemoryBackend(), persistDelayMs: 0 });
  await bootstrapFileSystem(fs);
  mountTourDisk(fs, async () => new Uint8Array());
  const desktop = fs.locate("desktop")!;
  const tropical = fs.mkdir(desktop.id, "Tropical");
  for (const name of ["Ackees", "Bananas"]) await fs.writeFile(tropical.id, name, "", { type: MIME.text });
  return fs;
}

const names = (fs: FileSystem, place: SFPlace, types?: string[]) => listPlace(fs, place, types).map((e) => e.name);

describe("Standard File places", () => {
  it("lists the volumes and the desktop's folders and files at the Desktop, without app shortcuts", async () => {
    const fs = await bootedFS();
    const desktop = fs.locate("desktop")!;
    await fs.writeFile(desktop.id, "notes.txt", "hi", { type: MIME.text });
    expect(names(fs, DESKTOP)).toEqual(["Mockintosh HD", "Mockintosh Tour", "notes.txt", "Tropical"]);
    expect(listPlace(fs, DESKTOP).slice(0, 2).map((e) => e.kind)).toEqual(["volume", "volume"]);
  });

  it("keeps the Desktop Folder and Trash out of the volume's list", async () => {
    const fs = await bootedFS();
    const hd = fs.locate("volume")!;
    expect(names(fs, { kind: "folder", id: hd.id })).toEqual(["Applications", "Pictures", "System Folder"]);
  });

  it("shows every folder but only files of the asked-for types", async () => {
    const fs = await bootedFS();
    const desktop = fs.locate("desktop")!;
    await fs.writeFile(desktop.id, "notes.txt", "hi", { type: MIME.text });
    expect(names(fs, DESKTOP, [MIME.motion])).toEqual(["Mockintosh HD", "Mockintosh Tour", "Tropical"]);
    const reels = placeOf(fs, `${TOUR_DISK_ID}Reels`);
    expect(names(fs, reels, [MIME.motion])).toHaveLength(4);
    expect(names(fs, reels, [MIME.text])).toEqual([]);
  });

  it("goes up from a desktop folder to the Desktop, and from a volume's folder to the volume", async () => {
    const fs = await bootedFS();
    const tropical = placeOf(fs, fs.child(fs.locate("desktop")!.id, "Tropical")!.id);
    expect(placePath(fs, tropical).map((p) => placeName(fs, p))).toEqual(["Tropical", "Desktop"]);
    const reels = placeOf(fs, `${TOUR_DISK_ID}Reels`);
    expect(placePath(fs, reels).map((p) => placeName(fs, p))).toEqual(["Reels", "Mockintosh Tour", "Desktop"]);
    const prefs = placeOf(fs, fs.locate("preferences")!.id);
    expect(placePath(fs, prefs).map((p) => placeName(fs, p))).toEqual([
      "Preferences",
      "System Folder",
      "Mockintosh HD",
      "Desktop",
    ]);
    expect(parentPlace(fs, DESKTOP)).toBeNull();
  });

  it("opens to a file's folder", async () => {
    const fs = await bootedFS();
    const tropical = fs.child(fs.locate("desktop")!.id, "Tropical")!;
    const file = fs.children(tropical.id)[0]!;
    expect(placeOf(fs, file.id)).toEqual({ kind: "folder", id: tropical.id });
    expect(placeOf(fs, fs.locate("desktop")!.id)).toEqual(DESKTOP);
  });
});

describe("typeSelect", () => {
  const entries = ["Alpha", "beta", "Gamma", "Motion", "Zed"].map((name, i) => ({ id: String(i), name, kind: "file" as const }));

  it("selects the first name with the typed prefix, ignoring case", () => {
    expect(typeSelect(entries, "m")).toBe(3);
    expect(typeSelect(entries, "B")).toBe(1);
  });

  it("selects the next name when none starts with the prefix, or the last past the end", () => {
    expect(typeSelect(entries, "h")).toBe(3);
    expect(typeSelect(entries, "zz")).toBe(4);
  });
});
