/**
 * First-boot layout of the file system, and repair of the well-known folders
 * on every boot. Everything the OS needs to find later is created with a
 * `role`, never looked up by name.
 */
import { MIME, ROOT_ID, type FileSystem, type FSDirectory, type NodeRole } from "@mockintosh/fs";

export const STARTUP_VOLUME_NAME = "Mockintosh HD";

interface DesktopShortcut {
  name: string;
  appId: string;
  icon: string;
}

/**
 * Icons on a new desktop. Optional apps (MacPaint, the instruments, …) are
 * not here: a new user installs those from the App Store.
 */
const DESKTOP_SHORTCUTS: readonly DesktopShortcut[] = [
  { name: "Photo Booth",  appId: "photobooth",   icon: "icon/photobooth-smr-32" },
  { name: "1984.mp4",     appId: "video",        icon: "icon/MacFlim" },
  { name: "Safari",       appId: "safari",       icon: "icon/safari" },
  { name: "App Store",    appId: "appstore",     icon: "icon/appstore-smr-32x32" },
  { name: "Icon Gallery", appId: "icon_gallery", icon: "icon-gallery/icon" },
  { name: "Showreel",     appId: "showreel",     icon: "showreel/icon" },
];

/** Create the startup volume and its standard folders on a fresh disk; repair them otherwise. */
export async function bootstrapFileSystem(fs: FileSystem): Promise<void> {
  const fresh = fs.volumes().length === 0;
  const hd = fs.locate("volume") ?? fs.mkdir(ROOT_ID, STARTUP_VOLUME_NAME, { role: "volume" });

  ensureRoleFolder(fs, hd, "desktop", "Desktop Folder");
  ensureRoleFolder(fs, hd, "trash", "Trash");
  ensureRoleFolder(fs, hd, "applications", "Applications");
  ensureRoleFolder(fs, hd, "pictures", "Pictures");
  const system = ensureRoleFolder(fs, hd, "system", "System Folder");
  ensureRoleFolder(fs, system, "preferences", "Preferences");
  const extensions = ensureRoleFolder(fs, system, "extensions", "Extensions");
  ensureRoleFolder(fs, extensions, "printer-drivers", "Printer Drivers");

  const desktop = fs.locate("desktop", hd.id)!;
  if (fresh) {
    for (const s of DESKTOP_SHORTCUTS) {
      await writeDesktopShortcut(fs, desktop.id, s);
    }
  } else {
    await ensureDesktopShortcut(fs, desktop, "showreel");
  }
  await fs.flush();
}

async function ensureDesktopShortcut(
  fs: FileSystem,
  desktop: { id: string },
  appId: string,
): Promise<void> {
  const spec = DESKTOP_SHORTCUTS.find((shortcut) => shortcut.appId === appId);
  if (!spec) return;
  const existing = fs.child(desktop.id, spec.name);
  if (!existing) await writeDesktopShortcut(fs, desktop.id, spec);
}

async function writeDesktopShortcut(
  fs: FileSystem,
  desktopId: string,
  s: DesktopShortcut,
): Promise<void> {
  await fs.writeJSON(desktopId, s.name, { appId: s.appId }, {
    type: MIME.appShortcut,
    attributes: { icon: s.icon },
  });
}

/** Find a role folder on the parent's volume, or create it under `parent`. */
function ensureRoleFolder(
  fs: FileSystem,
  parent: FSDirectory,
  role: Exclude<NodeRole, "root" | "volume">,
  defaultName: string
): FSDirectory {
  const volume = fs.volumeOf(parent.id);
  return fs.locate(role, volume?.id) ?? fs.mkdir(parent.id, defaultName, { role });
}
