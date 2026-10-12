import { describe, expect, it } from "vitest";
import { FileSystem, InMemoryBackend, MIME, ROOT_ID, isFSError, type VolumeImage } from "../src";

async function withStartupDisk() {
  const backend = new InMemoryBackend();
  const fs = await FileSystem.open({ backend, persistDelayMs: 0 });
  const hd = fs.mkdir(ROOT_ID, "Zed HD", { role: "volume" });
  fs.mkdir(hd.id, "Desktop Folder", { role: "desktop" });
  return { fs, backend, hd };
}

let reads = 0;
const TOUR: VolumeImage = {
  key: "tour",
  name: "Tour",
  ejectable: true,
  entries: [
    { kind: "directory", name: "Reels", entries: [{ kind: "file", name: "One.motion", type: MIME.motion, content: '{"version":1,"reel":"one-bit"}' }] },
    { kind: "file", name: "Movie.mp4", type: "video/mp4", size: 3, url: "/movie.mp4", read: async () => (reads++, new Uint8Array([1, 2, 3])) },
  ],
  attributes: { icon: "icon/floppy-disk" },
};

describe("mounted disks", () => {
  it("show as a locked volume after the user's disks, with stable ids", async () => {
    const { fs, hd } = await withStartupDisk();
    const tour = fs.mount(TOUR);
    expect(tour).toMatchObject({ id: "tour:", locked: true, ejectable: true, role: "volume" });
    expect(fs.volumes().map((v) => v.name)).toEqual(["Zed HD", "Tour"]);
    expect(fs.locate("volume")?.id).toBe(hd.id);
    const reels = fs.child(tour.id, "Reels")!;
    expect(reels.id).toBe("tour:Reels");
    expect(fs.child(reels.id, "One.motion")?.id).toBe("tour:Reels/One.motion");
    expect(fs.attributes(tour.id).icon).toBe("icon/floppy-disk");
  });

  it("read bodies from the image, fetching lazily", async () => {
    const { fs } = await withStartupDisk();
    fs.mount(TOUR);
    expect(await fs.readJSON("tour:Reels/One.motion")).toEqual({ version: 1, reel: "one-bit" });
    reads = 0;
    expect(fs.file("tour:Movie.mp4")).toMatchObject({ size: 3, url: "/movie.mp4", type: "video/mp4" });
    expect(reads).toBe(0);
    expect(await fs.readBytes("tour:Movie.mp4")).toEqual(new Uint8Array([1, 2, 3]));
    expect(reads).toBe(1);
  });

  it("refuse every change, but keep the Finder's attributes in memory", async () => {
    const { fs, hd } = await withStartupDisk();
    const tour = fs.mount(TOUR);
    const locked = (fn: () => unknown) => {
      try { fn(); } catch (err) { return isFSError(err, "locked"); }
      return false;
    };
    expect(locked(() => fs.rename("tour:Reels", "Mine"))).toBe(true);
    expect(locked(() => fs.mkdir(tour.id, "New"))).toBe(true);
    expect(locked(() => fs.move("tour:Movie.mp4", hd.id))).toBe(true);
    expect(locked(() => fs.move(fs.locate("desktop")!.id, tour.id))).toBe(true);
    await expect(fs.writeFile(tour.id, "x.txt", "x")).rejects.toMatchObject({ code: "locked" });
    await expect(fs.remove("tour:Movie.mp4")).rejects.toMatchObject({ code: "locked" });
    fs.setAttributes("tour:Reels", { position: { x: 4, y: 5 } });
    expect(fs.attributes("tour:Reels").position).toEqual({ x: 4, y: 5 });
    expect(fs.isLocked("tour:Reels/One.motion")).toBe(true);
    expect(fs.isLocked(hd.id)).toBe(false);
  });

  it("are never persisted", async () => {
    const { fs, backend } = await withStartupDisk();
    fs.mount(TOUR);
    fs.setAttributes("tour:Reels", { position: { x: 4, y: 5 } });
    await fs.flush();
    const reopened = await FileSystem.open({ backend, persistDelayMs: 0 });
    expect(reopened.volumes().map((v) => v.name)).toEqual(["Zed HD"]);
    expect(reopened.node("tour:Reels")).toBeUndefined();
  });

  it("eject: unmount takes the disk and everything on it away", async () => {
    const { fs, hd } = await withStartupDisk();
    const tour = fs.mount(TOUR);
    fs.unmount(tour.id);
    expect(fs.volumes().map((v) => v.name)).toEqual(["Zed HD"]);
    expect(fs.node("tour:Reels/One.motion")).toBeUndefined();
    expect(await fs.readBytes("tour:Movie.mp4")).toBeNull();
    expect(() => fs.unmount(hd.id)).toThrow();
    expect(fs.mount(TOUR).id).toBe("tour:");
  });
});
