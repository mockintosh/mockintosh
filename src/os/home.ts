/**
 * The Computer Club member's home disk: a volume named after them that
 * mounts next to Mockintosh HD while they're signed in, and ejects when they
 * sign out. Its Desktop Folder, Pictures and Documents are found before the
 * startup disk's (`FileSystem.locate`), so new files go to it; the Finder
 * shows every disk's Desktop Folder and Trash together. On mounting, files a
 * guest left on Mockintosh HD can move to it. See docs/club-storage-plan.md.
 */
import { createEffect, createRoot } from "solid-js";
import { MIME, ROOT_ID, fitName, fitNameWithSuffix, type FileSystem, type FSDirectory, type FSNode, type NodeRole } from "@mockintosh/fs";
import type { ClubMember } from "../platform/types";
import type { SystemClub } from "./club";
import type { OSServices } from "./context";
import { getWindows } from "./state";

/** The folders every home disk has, by role. */
const HOME_FOLDERS: ReadonlyArray<{ role: Exclude<NodeRole, "root" | "volume">; name: string }> = [
  { role: "desktop", name: "Desktop Folder" },
  { role: "trash", name: "Trash" },
  { role: "documents", name: "Documents" },
  { role: "pictures", name: "Pictures" },
];

/** When the guest files on Mockintosh HD were last offered to the member: an attribute on their disk. */
const GUEST_CHECKED = "guestCheckedAt";
/** An account this young was made on this Mac moments ago, so the guest's files are its owner's. */
const NEW_ACCOUNT_MS = 60 * 60 * 1000;

const MOVE = "Move";
const KEEP = "Don't Move";

/** What a member's disk is called: their username. */
export function homeDiskName(member: ClubMember): string {
  return fitName(member.username || member.name || member.email.split("@")[0] || "Home");
}

/**
 * Mount `member`'s disk with its folders, renamed if their username changed.
 * `created` when this Mac had never seen it.
 */
export function mountHomeDisk(fs: FileSystem, member: ClubMember): { volume: FSDirectory; created: boolean } {
  const created = !fs.homeVolume(member.id);
  const name = homeDiskName(member);
  const volume = fs.mountHome(member.id, name);
  if (volume.name !== name && !fs.child(ROOT_ID, name)) fs.rename(volume.id, name);
  fs.batch(() => {
    for (const { role, name } of HOME_FOLDERS) {
      if (!fs.locate(role, volume.id)) fs.mkdir(volume.id, fs.availableName(volume.id, name), { role });
    }
  });
  return { volume: fs.directory(volume.id)!, created };
}

/**
 * Eject every mounted home disk but `keep`'s. Its desktop place is given up,
 * as a guest's icons may take it; it gets a free one when it mounts again.
 */
export function ejectHomeDisks(fs: FileSystem, keep?: string): void {
  for (const volume of fs.volumes()) {
    if (!volume.home || volume.home === keep) continue;
    fs.setAttributes(volume.id, { position: null });
    fs.eject(volume.id);
  }
}

/** What the guest left on Mockintosh HD: desktop items other than app shortcuts, and Pictures. */
export function guestItems(fs: FileSystem, since = 0): FSNode[] {
  const startup = fs.locate("volume");
  if (!startup || startup.home) return [];
  const items: FSNode[] = [];
  const desktop = fs.locate("desktop", startup.id);
  if (desktop) {
    // App shortcuts belong to the Mac: the built-in ones, and App Store installs.
    items.push(...fs.children(desktop.id).filter((n) => !(n.kind === "file" && n.type === MIME.appShortcut)));
  }
  const pictures = fs.locate("pictures", startup.id);
  if (pictures) items.push(...fs.children(pictures.id));
  return items.filter((n) => Math.max(n.createdAt, n.modifiedAt) > since);
}

/**
 * Move the guest's items to `home`: desktop items to its Desktop Folder (at
 * the same positions), Pictures to its Pictures. One catalog change; a name
 * the home disk already has gets " (this Mac)".
 */
export function moveGuestItems(fs: FileSystem, home: FSDirectory, items: readonly FSNode[]): void {
  const startup = fs.locate("volume");
  if (!startup) return;
  const destination = (item: FSNode): FSDirectory | undefined => {
    const fromPictures = fs.locate("pictures", startup.id)?.id === item.parentId;
    return fs.locate(fromPictures ? "pictures" : "desktop", home.id);
  };
  fs.batch(() => {
    for (const item of items) {
      const target = destination(item);
      if (!target || !fs.node(item.id)) continue;
      if (fs.child(target.id, item.name)) {
        const dot = item.kind === "file" ? item.name.lastIndexOf(".") : -1;
        const [stem, ext] = dot > 0 ? [item.name.slice(0, dot), item.name.slice(dot)] : [item.name, ""];
        fs.rename(item.id, fs.availableName(target.id, fitNameWithSuffix(stem, ` (this Mac)${ext}`)));
      }
      fs.move(item.id, target.id);
    }
  });
}

/**
 * Offer the guest's files to the member whose disk just mounted. A new
 * account gets Move as the default; an existing one, maybe on someone
 * else's computer, gets Keep. Asks again only about files made since.
 */
export async function offerGuestItems(
  os: Pick<OSServices, "fs" | "showDialog">,
  member: ClubMember,
  home: FSDirectory,
  created: boolean,
  now = Date.now(),
): Promise<"moved" | "kept" | "none"> {
  const checked = os.fs.attributes(home.id)[GUEST_CHECKED];
  const items = guestItems(os.fs, typeof checked === "number" ? checked : 0);
  if (items.length === 0) return "none";
  const startup = os.fs.locate("volume")?.name ?? "this Mac's disk";
  const fresh = created && now - member.since < NEW_ACCOUNT_MS;
  const what = items.length === 1 ? `"${items[0].name}"` : `${items.length} items`;
  const answer = await os.showDialog({
    message: fresh
      ? items.length === 1
        ? `Move ${what}, which you made before joining, to your disk "${home.name}"?`
        : `Move the ${what} you made before joining to your disk "${home.name}"? They're on the desktop and in Pictures on ${startup}.`
      : items.length === 1
        ? `${what} is on ${startup}, not on your disk "${home.name}". Move it there?`
        : `${startup} has ${what} on its desktop and in Pictures that aren't on your disk "${home.name}". Move them there?`,
    buttons: fresh ? [KEEP, MOVE] : [MOVE, KEEP],
    variant: "note",
  });
  // The disk may have ejected while the question was up.
  const mounted = os.fs.directory(home.id);
  if (mounted) os.fs.setAttributes(home.id, { [GUEST_CHECKED]: now });
  if (answer !== MOVE || !mounted) return "kept";
  moveGuestItems(os.fs, mounted, items);
  return "moved";
}

/** Close Finder windows whose folder is gone (on an ejected disk). */
function closeVanishedFolders(os: Pick<OSServices, "fs" | "closeWindow">): void {
  for (const win of getWindows()) {
    const dir = win.props?.directoryId;
    if (win.kind === "finder-folder" && typeof dir === "string" && !os.fs.exists(dir)) os.closeWindow(win.id);
  }
}

/**
 * Follow the Club's member: mount their disk when they're signed in, eject
 * it when they sign out (not when the Club is merely unreachable). Returns
 * the stop function.
 */
/**
 * Run `work` after the current reactive update: file-system changes made
 * while effects apply aren't readable until it finishes, and mounting reads
 * back the folders it makes.
 */
function later(work: () => void): void {
  queueMicrotask(() => {
    try {
      work();
    } catch (error) {
      console.error("Home disk:", error);
    }
  });
}

export function startHomeDisks(os: Pick<OSServices, "fs" | "showDialog" | "closeWindow">, club: SystemClub): () => void {
  return createRoot((dispose) => {
    let mounted: string | null = null;
    createEffect(
      () => {
        const member = club.member();
        if (member) return member;
        // Unknown yet, or unreachable: keep whatever is mounted.
        return member === null && !club.offline() ? null : undefined;
      },
      (member) => {
        if (member === undefined) return;
        if (member === null) {
          // Also a disk left mounted by the last session, when its member signed out elsewhere.
          mounted = null;
          later(() => {
            ejectHomeDisks(os.fs);
            closeVanishedFolders(os);
          });
          return;
        }
        if (mounted === member.id) return;
        mounted = member.id;
        later(() => {
          ejectHomeDisks(os.fs, member.id);
          closeVanishedFolders(os);
          const { volume, created } = mountHomeDisk(os.fs, member);
          void offerGuestItems(os, member, volume, created).catch((error) => console.error("Home disk:", error));
        });
      },
    );
    return dispose;
  });
}
