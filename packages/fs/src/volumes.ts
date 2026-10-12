/**
 * How volumes are ordered, shared by `FileSystem` and app processes' mirror
 * of it. A Computer Club member's home disk (`FSDirectory.home`) mounts next
 * to the startup disk; ejected volumes are left out everywhere.
 */
import type { FSDirectory } from "./types";

/** Mounted volumes as the desktop shows them: startup disks first, then home disks, then locked ones. */
export function mountedVolumes(volumes: readonly FSDirectory[]): FSDirectory[] {
  const mounted = volumes.filter((v) => !v.ejected);
  return [
    ...mounted.filter((v) => !v.home && !v.locked),
    ...mounted.filter((v) => v.home),
    ...mounted.filter((v) => !v.home && v.locked),
  ];
}

/**
 * The order `locate(role)` searches mounted volumes in: home disks first, so
 * a new file meant for the Desktop or Pictures lands on the member's disk.
 * Roles a home disk lacks (the System Folder, Preferences, Applications)
 * fall through to the startup disk.
 */
export function roleSearchOrder(mounted: readonly FSDirectory[]): FSDirectory[] {
  return [...mounted.filter((v) => v.home), ...mounted.filter((v) => !v.home)];
}
