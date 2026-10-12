import { describe, expect, it } from "vitest";
import { FileSystem, InMemoryBackend, MIME } from "@mockintosh/fs";
import { REELS } from "@/apps/showreel/catalog";
import { bootstrapFileSystem } from "./fsBootstrap";
import { REEL_FILES, TOUR_DISK_ID, TOUR_DISK_NAME, mountTourDisk, noteTourDiskEjected, tourDiskEjected } from "./tourDisk";

const fetchBytes = async () => new Uint8Array([0]);

async function booted(backend = new InMemoryBackend()) {
  const fs = await FileSystem.open({ backend, persistDelayMs: 0 });
  await bootstrapFileSystem(fs);
  return fs;
}

describe("the Tour disk", () => {
  it("mounts beside the hard disk, locked and ejectable", async () => {
    const fs = await booted();
    mountTourDisk(fs, fetchBytes);
    expect(fs.volumes().map((v) => v.name)).toEqual(["Mockintosh HD", TOUR_DISK_NAME]);
    expect(fs.directory(TOUR_DISK_ID)).toMatchObject({ locked: true, ejectable: true });
    expect(fs.children(TOUR_DISK_ID).map((n) => n.name)).toEqual(["Reels", "1984.mp4", "Read Me"]);
  });

  it("holds a motion file for every reel Showreel plays", async () => {
    const fs = await booted();
    mountTourDisk(fs, fetchBytes);
    const reels = fs.child(TOUR_DISK_ID, "Reels")!;
    const files = fs.children(reels.id);
    expect(files.map((n) => n.name).sort()).toEqual(REEL_FILES.map((f) => f.name).sort());
    expect(files.every((n) => n.kind === "file" && n.type === MIME.motion)).toBe(true);
    const named = await Promise.all(files.map((n) => fs.readJSON<{ reel: string }>(n.id)));
    expect(named.map((doc) => doc!.reel).sort()).toEqual(REELS.map((r) => r.id).sort());
  });

  it("has the film as a movie that streams from its address", async () => {
    const fs = await booted();
    mountTourDisk(fs, fetchBytes);
    expect(fs.file(`${TOUR_DISK_ID}1984.mp4`)).toMatchObject({ type: "video/mp4", url: "/1984.mp4" });
  });

  it("stays out once ejected, across restarts, until it is inserted again", async () => {
    const backend = new InMemoryBackend();
    const fs = await booted(backend);
    mountTourDisk(fs, fetchBytes);
    fs.unmount(TOUR_DISK_ID);
    noteTourDiskEjected(fs);
    await fs.flush();

    const restarted = await booted(backend);
    mountTourDisk(restarted, fetchBytes);
    expect(restarted.node(TOUR_DISK_ID)).toBeUndefined();
    expect(tourDiskEjected(restarted)).toBe(true);

    mountTourDisk(restarted, fetchBytes, { insert: true });
    expect(restarted.node(TOUR_DISK_ID)).toBeDefined();
    expect(tourDiskEjected(restarted)).toBe(false);
  });

  it("comes back on an erased disk", async () => {
    const fs = await booted();
    mountTourDisk(fs, fetchBytes);
    fs.unmount(TOUR_DISK_ID);
    noteTourDiskEjected(fs);
    await fs.erase();
    await bootstrapFileSystem(fs);
    mountTourDisk(fs, fetchBytes);
    expect(fs.node(TOUR_DISK_ID)).toBeDefined();
  });
});
