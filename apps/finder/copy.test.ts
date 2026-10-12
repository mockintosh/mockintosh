import { describe, expect, it } from "vitest";
import { FileSystem, InMemoryBackend, MIME } from "@mockintosh/fs";
import { bootstrapFileSystem } from "../../src/os/fsBootstrap";
import { TOUR_DISK_ID, mountTourDisk } from "../../src/os/tourDisk";
import { copyIcons, dropCopies } from "./copy";

async function withTour() {
  const fs = await FileSystem.open({ backend: new InMemoryBackend(), persistDelayMs: 0 });
  await bootstrapFileSystem(fs);
  mountTourDisk(fs, async () => new Uint8Array([7, 7]));
  return fs;
}

describe("dropping icons from the Tour disk", () => {
  it("copies rather than moves off a locked disk, and moves within the hard disk", async () => {
    const fs = await withTour();
    const desktop = fs.locate("desktop")!;
    const pictures = fs.locate("pictures")!;
    expect(dropCopies(fs, `${TOUR_DISK_ID}Read Me`, desktop.id)).toBe(true);
    const note = await fs.writeFile(desktop.id, "note.txt", "hi", { type: MIME.text });
    expect(dropCopies(fs, note.id, pictures.id)).toBe(false);
  });

  it("copies a folder with everything in it, placed where it was dropped", async () => {
    const fs = await withTour();
    const desktop = fs.locate("desktop")!;
    await copyIcons(fs, desktop.id, [{ nodeId: `${TOUR_DISK_ID}Reels`, position: { x: 10, y: 20 } }]);
    const reels = fs.child(desktop.id, "Reels")!;
    expect(reels.kind).toBe("directory");
    expect(fs.isLocked(reels.id)).toBe(false);
    expect(fs.attributes(reels.id).position).toEqual({ x: 10, y: 20 });
    const files = fs.children(reels.id);
    expect(files).toHaveLength(4);
    expect(await fs.readJSON(files.find((f) => f.name === "One Bit.motion")!.id)).toEqual({ version: 1, reel: "one-bit" });
    // The original stays on the Tour disk.
    expect(fs.childCount(`${TOUR_DISK_ID}Reels`)).toBe(4);
  });

  it("copies a lazily read file's bytes, and takes a free name on a clash", async () => {
    const fs = await withTour();
    const desktop = fs.locate("desktop")!;
    await copyIcons(fs, desktop.id, [{ nodeId: `${TOUR_DISK_ID}1984.mp4`, position: undefined }]);
    await copyIcons(fs, desktop.id, [{ nodeId: `${TOUR_DISK_ID}1984.mp4`, position: undefined }]);
    expect(await fs.readBytes(fs.child(desktop.id, "1984.mp4")!.id)).toEqual(new Uint8Array([7, 7]));
    // The copy still streams, so Movie Player plays it.
    expect(fs.file(fs.child(desktop.id, "1984.mp4")!.id)?.url).toBe("/1984.mp4");
    expect(fs.child(desktop.id, "1984 2.mp4")).toBeDefined();
  });
});
