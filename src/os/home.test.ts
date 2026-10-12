import { describe, expect, it, vi } from "vitest";
import { createSignal, flush } from "solid-js";
import { FileSystem, InMemoryBackend, MIME } from "@mockintosh/fs";
import type { DialogOptions } from "@mockintosh/sdk";
import type { ClubMember } from "../platform/types";
import type { SystemClub } from "./club";
import { bootstrapFileSystem, STARTUP_VOLUME_NAME } from "./fsBootstrap";
import { guestItems, mountHomeDisk, moveGuestItems, offerGuestItems, startHomeDisks } from "./home";

const NOW = 1_800_000_000_000;
const ADA: ClubMember = { id: "member-1", name: "Ada Lovelace", username: "Ada", email: "ada@example.com", since: NOW - 60_000 };

async function bootedFS() {
  const fs = await FileSystem.open({ backend: new InMemoryBackend(), persistDelayMs: 0 });
  await bootstrapFileSystem(fs);
  return fs;
}

/** A guest's things on Mockintosh HD: a note on the desktop and a picture. */
async function withGuestFiles(fs: FileSystem) {
  const hd = fs.locate("volume")!;
  const note = await fs.writeFile(fs.locate("desktop", hd.id)!.id, "Note", "hi", { attributes: { position: { x: 40, y: 60 } } });
  const picture = await fs.writeFile(fs.locate("pictures", hd.id)!.id, "Sunset", "pixels");
  return { note, picture };
}

function dialogAnswering(answer: string | null) {
  return vi.fn(async (_options: DialogOptions) => answer);
}

describe("home disks", () => {
  it("mounts a member's disk with its folders, after Mockintosh HD", async () => {
    const fs = await bootedFS();
    const { volume, created } = mountHomeDisk(fs, ADA);
    expect(created).toBe(true);
    expect(fs.volumes().map((v) => v.name)).toEqual([STARTUP_VOLUME_NAME, "Ada"]);
    for (const role of ["desktop", "trash", "documents", "pictures"] as const) expect(fs.locate(role, volume.id), role).toBeDefined();
    // New files go to the member's disk; settings stay on the Mac's.
    expect(fs.volumeOf(fs.locate("desktop")!.id)!.id).toBe(volume.id);
    expect(fs.volumeOf(fs.locate("preferences")!.id)!.name).toBe(STARTUP_VOLUME_NAME);
    expect(mountHomeDisk(fs, ADA).created).toBe(false);
  });

  it("names the disk after the username, and follows a new one", async () => {
    const fs = await bootedFS();
    const { volume } = mountHomeDisk(fs, ADA);
    expect(volume.name).toBe("Ada");
    expect(mountHomeDisk(fs, { ...ADA, username: "countess" }).volume.id).toBe(volume.id);
    expect(fs.directory(volume.id)!.name).toBe("countess");
  });

  it("counts the guest's files but not the Mac's app shortcuts", async () => {
    const fs = await bootedFS();
    const { note, picture } = await withGuestFiles(fs);
    expect(guestItems(fs).map((n) => n.id).sort()).toEqual([note.id, picture.id].sort());
  });

  it("moves the guest's files in one change, keeping desktop positions and naming clashes apart", async () => {
    const fs = await bootedFS();
    const { note, picture } = await withGuestFiles(fs);
    const { volume } = mountHomeDisk(fs, ADA);
    await fs.writeFile(fs.locate("desktop", volume.id)!.id, "Note", "already here");

    moveGuestItems(fs, volume, guestItems(fs));
    expect(fs.node(note.id)!.parentId).toBe(fs.locate("desktop", volume.id)!.id);
    expect(fs.node(note.id)!.name).toBe("Note (this Mac)");
    expect(fs.attributes(note.id).position).toEqual({ x: 40, y: 60 });
    expect(fs.node(picture.id)!.parentId).toBe(fs.locate("pictures", volume.id)!.id);
    expect(guestItems(fs)).toEqual([]);
    // The Mac's shortcuts stay.
    expect(fs.children(fs.locate("desktop", fs.locate("volume")!.id)!.id).every((n) => n.kind === "file" && n.type === MIME.appShortcut)).toBe(true);
  });

  it("offers a new member's guest files with Move as the default", async () => {
    const fs = await bootedFS();
    await withGuestFiles(fs);
    const { volume, created } = mountHomeDisk(fs, ADA);
    const showDialog = dialogAnswering("Move");
    expect(await offerGuestItems({ fs, showDialog }, ADA, volume, created, NOW)).toBe("moved");
    expect(showDialog.mock.calls[0][0].buttons).toEqual(["Don't Move", "Move"]);
    expect(guestItems(fs)).toEqual([]);
  });

  it("offers an existing member's guest files with Keep as the default, and asks only about newer ones after", async () => {
    const fs = await bootedFS();
    await withGuestFiles(fs);
    const longAgo = { ...ADA, since: NOW - 30 * 24 * 60 * 60 * 1000 };
    const { volume, created } = mountHomeDisk(fs, longAgo);
    const showDialog = dialogAnswering("Don't Move");
    expect(await offerGuestItems({ fs, showDialog }, longAgo, volume, created, NOW)).toBe("kept");
    expect(showDialog.mock.calls[0][0].buttons).toEqual(["Move", "Don't Move"]);
    expect(guestItems(fs)).toHaveLength(2);
    expect(await offerGuestItems({ fs, showDialog }, longAgo, volume, false, NOW + 1)).toBe("none");
    expect(showDialog).toHaveBeenCalledTimes(1);
  });

  it("mounts on sign-in, ejects on sign-out, and keeps the disk while the Club is unreachable", async () => {
    const fs = await bootedFS();
    const [member, setMember] = createSignal<ClubMember | null | undefined>(undefined, { ownedWrite: true });
    const [offline, setOffline] = createSignal(false, { ownedWrite: true });
    const club = { member, offline } as unknown as SystemClub;
    const stop = startHomeDisks({ fs, showDialog: dialogAnswering(null), closeWindow: vi.fn() }, club);
    const names = () => fs.volumes().map((v) => v.name);
    const settle = async () => {
      flush();
      await Promise.resolve();
    };

    setMember(ADA);
    await settle();
    expect(names()).toEqual([STARTUP_VOLUME_NAME, "Ada"]);

    setOffline(true);
    setMember(null);
    await settle();
    expect(names()).toEqual([STARTUP_VOLUME_NAME, "Ada"]);

    setOffline(false);
    await settle();
    expect(names()).toEqual([STARTUP_VOLUME_NAME]);

    setMember(ADA);
    await settle();
    expect(names()).toEqual([STARTUP_VOLUME_NAME, "Ada"]);
    expect(fs.children(fs.locate("volume", fs.homeVolume(ADA.id)!.id)!.id).filter((n) => n.name === "Desktop Folder")).toHaveLength(1);
    stop();
  });
});
