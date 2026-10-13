/**
 * Photo Booth's picture strip, stored as sprite files in Pictures/Photo Booth.
 *
 * The folder id is remembered in the app's preferences so a rename in the
 * Finder still finds the same pictures. Pictures itself is a volume role.
 */
import {
  MIME,
  readSpriteFile,
  writeSpriteFile,
  type AppFileSystem,
  type AppStorage,
  type FSDirectory,
  type FSFile,
} from "@mockintosh/sdk";

export const PHOTO_LIBRARY_NAME = "Photo Booth";
/** Earlier builds kept the strip in a desktop folder with this name. */
const LEGACY_DESKTOP_NAME = "Photo Booth Pictures";
const LIBRARY_ID_KEY = "library";
const PHOTO_ICON = "icon/photobooth-smr-32";

/** A picture that already has a file in the library. */
export interface StoredPhoto {
  fileId: string;
  pixels: Uint8Array;
  width: number;
  height: number;
  /** `createdAt` of the sprite file. */
  timestamp: number;
}

/** The library folder if it already exists. Does not create one. */
export async function findPhotoLibrary(
  fs: AppFileSystem,
  storage: AppStorage,
): Promise<FSDirectory | null> {
  const saved = await storage.read(LIBRARY_ID_KEY);
  const pictures = fs.locate("pictures");
  if (saved) {
    const remembered = fs.directory(saved);
    // A library on another disk (Mockintosh HD, while a member's disk is mounted) stays there; new pictures go to this one's.
    if (remembered && (!pictures || fs.volumeOf(remembered.id)?.id === fs.volumeOf(pictures.id)?.id)) return remembered;
  }
  if (!pictures) return null;
  const named = fs.child(pictures.id, PHOTO_LIBRARY_NAME);
  if (named?.kind !== "directory") return null;
  await storage.write(LIBRARY_ID_KEY, named.id);
  return named;
}

/**
 * A desktop folder from the first library layout, moved under Pictures and
 * renamed. Returns null when there is nothing to adopt.
 */
function adoptLegacyLibrary(fs: AppFileSystem, picturesId: string): FSDirectory | null {
  const desktop = fs.locate("desktop");
  const legacy = desktop ? fs.child(desktop.id, LEGACY_DESKTOP_NAME) : undefined;
  if (legacy?.kind !== "directory") return null;
  if (fs.child(picturesId, PHOTO_LIBRARY_NAME)) return null;
  fs.move(legacy.id, picturesId);
  fs.rename(legacy.id, PHOTO_LIBRARY_NAME);
  return fs.directory(legacy.id) ?? null;
}

/** The library folder, created in Pictures the first time a picture is kept. */
export async function ensurePhotoLibrary(
  fs: AppFileSystem,
  storage: AppStorage,
): Promise<FSDirectory> {
  const existing = await findPhotoLibrary(fs, storage);
  if (existing) return existing;
  const pictures = fs.locate("pictures");
  if (!pictures) throw new Error("This Macintosh has no Pictures folder.");
  const adopted = adoptLegacyLibrary(fs, pictures.id);
  if (!adopted && fs.child(pictures.id, PHOTO_LIBRARY_NAME)) {
    throw new Error(`"${PHOTO_LIBRARY_NAME}" is not a folder.`);
  }
  const folder = adopted ?? fs.mkdir(pictures.id, PHOTO_LIBRARY_NAME);
  await storage.write(LIBRARY_ID_KEY, folder.id);
  return folder;
}

/** Sprite files in the library, oldest first. Unreadable files are skipped. */
export async function listStoredPhotos(fs: AppFileSystem, folderId: string): Promise<StoredPhoto[]> {
  const files = fs
    .children(folderId)
    .filter((node): node is FSFile => node.kind === "file" && node.type === MIME.sprite)
    .sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name));
  const photos: StoredPhoto[] = [];
  for (const file of files) {
    const sprite = await readSpriteFile(fs, file.id);
    if (!sprite) continue;
    photos.push({
      fileId: file.id,
      pixels: sprite.data,
      width: sprite.width,
      height: sprite.height,
      timestamp: file.createdAt,
    });
  }
  return photos;
}

/** File name for a picture. Seconds resolution; collisions get a numeric suffix. */
export function photoFileName(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `Photo ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
}

function unusedName(fs: AppFileSystem, folderId: string, base: string): string {
  if (!fs.child(folderId, base)) return base;
  let n = 2;
  while (fs.child(folderId, `${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** Write one picture into the library folder. */
export async function storePhoto(
  fs: AppFileSystem,
  folderId: string,
  photo: { pixels: Uint8Array; width: number; height: number; timestamp: number },
): Promise<StoredPhoto> {
  const file = await writeSpriteFile(
    fs,
    folderId,
    unusedName(fs, folderId, photoFileName(photo.timestamp)),
    { width: photo.width, height: photo.height, data: photo.pixels },
    { attributes: { icon: PHOTO_ICON } },
  );
  return {
    fileId: file.id,
    pixels: photo.pixels,
    width: photo.width,
    height: photo.height,
    timestamp: file.createdAt,
  };
}
