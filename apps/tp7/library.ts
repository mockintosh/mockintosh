/**
 * The TP-7's memos: WAV files in a "TP-7" folder at the top of the startup
 * disk, so the Finder shows them, other apps can open them, and they can be
 * renamed, moved to the Trash or copied off like any file.
 *
 * Marks live inside each file (its `cue ` chunk), not in preferences, so a
 * memo keeps them wherever it goes. The folder id is remembered in the app's
 * preferences, so a rename in the Finder still finds the same folder.
 */
import {
  MIME,
  decodeWav,
  encodeWav,
  readWavMarkers,
  setWavMarkers,
  type AppFileSystem,
  type AppStorage,
  type FSDirectory,
  type FSFile,
} from "@mockintosh/sdk";
import { makeTape, mixToMono, type Tape } from "./engine";

export const LIBRARY_NAME = "TP-7";
export const WAV = "audio/wav";
export const MEMO_ICON = "tp7/memo";
const LIBRARY_ID_KEY = "library";
const MEMO_NAME = /^memo (\d+)/i;

/** A memo read from disk, ready for the tape transport. */
export interface LoadedMemo {
  fileId: string;
  /** The file's revision when it was read. */
  revision: number;
  tape: Tape;
  markers: number[];
}

/** The disk the Desktop is on: where the library lives. */
function startupVolume(fs: AppFileSystem): FSDirectory | undefined {
  const desktop = fs.locate("desktop");
  return desktop ? fs.volumeOf(desktop.id) : undefined;
}

/** The library folder if it already exists. Does not create one. */
export async function findLibrary(fs: AppFileSystem, storage: AppStorage): Promise<FSDirectory | null> {
  const saved = await storage.read(LIBRARY_ID_KEY);
  if (saved) {
    const remembered = fs.directory(saved);
    if (remembered && !isInTrash(fs, remembered.id)) return remembered;
  }
  const volume = startupVolume(fs);
  const named = volume ? fs.child(volume.id, LIBRARY_NAME) : undefined;
  if (named?.kind !== "directory") return null;
  await storage.write(LIBRARY_ID_KEY, named.id);
  return named;
}

/** The library folder, created the first time something is recorded. */
export async function ensureLibrary(fs: AppFileSystem, storage: AppStorage): Promise<FSDirectory> {
  const existing = await findLibrary(fs, storage);
  if (existing) return existing;
  const volume = startupVolume(fs);
  if (!volume) throw new Error("This Macintosh has no startup disk.");
  if (fs.child(volume.id, LIBRARY_NAME)) throw new Error(`"${LIBRARY_NAME}" on the startup disk is not a folder.`);
  const folder = fs.mkdir(volume.id, LIBRARY_NAME);
  await storage.write(LIBRARY_ID_KEY, folder.id);
  return folder;
}

function isInTrash(fs: AppFileSystem, id: string): boolean {
  const trash = fs.locate("trash");
  if (!trash) return false;
  for (let node = fs.node(id); node; node = node.parentId ? fs.node(node.parentId) : undefined) {
    if (node.id === trash.id) return true;
  }
  return false;
}

/** WAV files in the library, oldest first. Reactive: call inside a memo. */
export function listMemos(fs: AppFileSystem, folderId: string): FSFile[] {
  return fs
    .children(folderId)
    .filter((node): node is FSFile => node.kind === "file" && node.type === WAV)
    .sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name));
}

/** "Memo 007.wav": one past the highest memo number in the folder. */
export function nextMemoName(fs: AppFileSystem, folderId: string): string {
  let highest = 0;
  for (const node of fs.children(folderId)) {
    const match = MEMO_NAME.exec(node.name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  let n = highest + 1;
  while (fs.child(folderId, memoFileName(n))) n++;
  return memoFileName(n);
}

function memoFileName(n: number): string {
  return `Memo ${String(n).padStart(3, "0")}.wav`;
}

/** How a memo is named on the display: no extension, capitals. */
export function displayName(fileName: string): string {
  return fileName.replace(/\.wav$/i, "").toUpperCase();
}

export async function storeMemo(
  fs: AppFileSystem,
  folderId: string,
  samples: Float32Array,
  sampleRate: number,
  markers: readonly number[],
): Promise<FSFile> {
  const bytes = encodeWav([samples], sampleRate);
  return fs.writeFile(folderId, nextMemoName(fs, folderId), markers.length > 0 ? setWavMarkers(bytes, markers) : bytes, {
    type: WAV,
    attributes: { icon: MEMO_ICON },
  });
}

/** Read and decode a memo. `null` when the file is gone or isn't a WAVE file this can play. */
export async function loadMemo(fs: AppFileSystem, fileId: string): Promise<LoadedMemo | null> {
  const file = fs.file(fileId);
  if (!file) return null;
  const bytes = await fs.readBytes(fileId);
  if (!bytes) return null;
  const wav = decodeWav(bytes);
  if (!wav || wav.channels.length === 0) return null;
  return {
    fileId,
    revision: file.revision,
    tape: makeTape(mixToMono(wav.channels), wav.sampleRate),
    markers: readWavMarkers(bytes),
  };
}

/** Rewrite a memo's marks into its file, leaving the audio byte for byte as it was. */
export async function saveMarkers(fs: AppFileSystem, fileId: string, markers: readonly number[]): Promise<FSFile | null> {
  const file = fs.file(fileId);
  if (!file?.parentId) return null;
  const bytes = await fs.readBytes(fileId);
  if (!bytes) return null;
  return fs.writeFile(file.parentId, file.name, setWavMarkers(bytes, markers), { type: file.type || MIME.binary });
}
