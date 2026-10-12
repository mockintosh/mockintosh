/**
 * The Mockintosh Tour disk: the demos the system ships — Showreel's reels and
 * the 1984 film — on a locked disk the Finder shows beside the hard disk, as
 * the Mac came with *A Guided Tour of Macintosh*. It is mounted at boot from
 * this image rather than written to the user's disk, so it never needs
 * seeding or repair, and its files load only when opened. Eject it and it
 * stays out until Special › Insert Tour Disk.
 */
import { MIME, type FileSystem, type VolumeImage } from "@mockintosh/fs";

export const TOUR_DISK_NAME = "Mockintosh Tour";
const TOUR_KEY = "tour";
/** The tour disk's volume id (`FileSystem.mount` derives it from the image key). */
export const TOUR_DISK_ID = `${TOUR_KEY}:`;

/** Set on the startup volume while the user has the tour disk ejected, so it stays out across restarts. */
const EJECTED_ATTRIBUTE = "tourDiskEjected";

/** One motion file per reel Showreel knows, named for the reel; opening one plays it. */
export const REEL_FILES: readonly { name: string; reel: string }[] = [
  { name: "One Bit.motion",           reel: "one-bit" },
  { name: "The Keeper.motion",        reel: "keeper" },
  { name: "Hello, Mockintosh.motion", reel: "hello" },
  { name: "A Lot Like 1984.motion",   reel: "hammer" },
];

const FILM = { name: "1984.mp4", url: "/1984.mp4", size: 2_482_992 };

const READ_ME = `Mockintosh Tour

This disk holds the demos that come with Mockintosh. It's locked: drag anything you'd like to keep onto your hard disk to copy it.

Reels
Double-click a reel to watch it in Showreel. Each draws itself in one bit, with its own score.

1984.mp4
The 1984 commercial, played as a movie.

To eject the disk, select it and choose Eject Disk from the Special menu, or drag it to the Trash. Special › Insert Tour Disk puts it back.
`;

/** Where a folder window shows an icon: two to a row, two grid cells apart, so long names don't run together. */
function slot(index: number): { x: number; y: number } {
  return { x: 40 + (index % 2) * 160, y: 16 + Math.floor(index / 2) * 56 };
}

/** The disk's contents. `fetchBytes` reads the film when it's first opened as bytes. */
export function tourDiskImage(fetchBytes: (url: string) => Promise<Uint8Array>): VolumeImage {
  return {
    key: TOUR_KEY,
    name: TOUR_DISK_NAME,
    ejectable: true,
    attributes: { icon: "icon/floppy-disk" },
    entries: [
      {
        kind: "directory",
        name: "Reels",
        attributes: { position: slot(0) },
        entries: REEL_FILES.map((file, index) => ({
          kind: "file",
          name: file.name,
          type: MIME.motion,
          content: JSON.stringify({ version: 1, reel: file.reel }),
          attributes: { position: slot(index) },
        })),
      },
      {
        kind: "file",
        name: FILM.name,
        type: "video/mp4",
        url: FILM.url,
        size: FILM.size,
        read: () => fetchBytes(FILM.url),
        attributes: { position: slot(1) },
      },
      { kind: "file", name: "Read Me", type: MIME.text, content: READ_ME, attributes: { position: slot(2) } },
    ],
  };
}

export function tourDiskEjected(fs: FileSystem): boolean {
  const startup = fs.locate("volume");
  return !!startup && fs.attributes(startup.id)[EJECTED_ATTRIBUTE] === true;
}

/** Mount the tour disk unless the user ejected it (or it is in already). Call after `bootstrapFileSystem`. */
export function mountTourDisk(fs: FileSystem, fetchBytes: (url: string) => Promise<Uint8Array>, options: { insert?: boolean } = {}): void {
  if (fs.node(TOUR_DISK_ID)) return;
  if (!options.insert && tourDiskEjected(fs)) return;
  fs.mount(tourDiskImage(fetchBytes));
  const startup = fs.locate("volume");
  if (options.insert && startup) fs.setAttributes(startup.id, { [EJECTED_ATTRIBUTE]: null });
}

/** Remember that the user ejected the tour disk. */
export function noteTourDiskEjected(fs: FileSystem): void {
  const startup = fs.locate("volume");
  if (startup) fs.setAttributes(startup.id, { [EJECTED_ATTRIBUTE]: true });
}
