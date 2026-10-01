import {diskPath} from "./projects/paths";
/**
 * Openers — which app opens which file.
 *
 * Apps declare the MIME types they handle (`SolidApp.fileTypes`), each as a
 * default or an alternate; the Finder asks `resolveOpenAction` what a
 * double-click should do. Directories and app shortcuts are handled by the
 * OS itself.
 */
import { MIME, type FSNode, type FileSystem } from "@mockintosh/fs";
import type { Capability, FileDocumentProps, FileOpener } from "@mockintosh/sdk";
import { getAllApps, getApp, getUnavailableApp } from "./apps";
import { openerTable, openersAmong } from "./openerTable";

export type OpenAction =
  | { kind: "folder"; directoryId: string; title: string }
  | { kind: "launch"; appId: string; props: Record<string, unknown> }
  | { kind: "none"; reason: "unknown-type" | "not-found" | "unreadable" }
  /** A shortcut or manifest names an app that is not registered (e.g. removed from the OS). */
  | { kind: "none"; reason: "unknown-app"; appId: string }
  /** The app is installed but needs capabilities this platform lacks. */
  | { kind: "none"; reason: "unavailable"; appId: string; title: string; missing: Capability[] };

/** Every app that opens `type`: defaults first, then alternates, each in registration order. */
export function openersForFileType(type: string): FileOpener[] {
  return openersAmong(openerTable(getAllApps()), type);
}

/** The app a double-click opens `type` in, if any. */
export function appForFileType(type: string): string | undefined {
  return openersForFileType(type)[0]?.appId;
}

export async function resolveOpenAction(fs: FileSystem, nodeId: string): Promise<OpenAction> {
  const node: FSNode | undefined = fs.node(nodeId);
  if (!node) return { kind: "none", reason: "not-found" };

  if (node.kind === "directory") {
    const project = fs.child(node.id, "mockintosh.json");
    if (project?.kind === "file") {
      const manifest = await fs.readJSON<{id?: string}>(project.id);
      if (manifest?.id && getApp(manifest.id)) return launchIfRegistered(manifest.id);
      return {kind: "launch", appId: "source_editor", props: {path: diskPath(fs, node.id)}};
    }
    return { kind: "folder", directoryId: node.id, title: node.name };
  }

  if (node.type === MIME.appShortcut) {
    const shortcut = await fs.readJSON<{ appId?: string }>(node.id);
    if (!shortcut?.appId) return { kind: "none", reason: "unreadable" };
    return launchIfRegistered(shortcut.appId);
  }

  // An installed app's manifest: launch the app it describes.
  if (node.type === MIME.app) {
    const manifest = await fs.readJSON<{ id?: string }>(node.id);
    if (!manifest?.id) return { kind: "none", reason: "unreadable" };
    return launchIfRegistered(manifest.id);
  }

  const appId = appForFileType(node.type);
  if (!appId) return { kind: "none", reason: "unknown-type" };
  const docProps: FileDocumentProps = { fileId: node.id, title: node.name };
  return { kind: "launch", appId, props: docProps as unknown as Record<string, unknown> };
}

function launchIfRegistered(appId: string): OpenAction {
  if (getApp(appId)) return { kind: "launch", appId, props: {} };
  const skipped = getUnavailableApp(appId);
  if (skipped) {
    return { kind: "none", reason: "unavailable", appId, title: skipped.title, missing: skipped.missing };
  }
  return { kind: "none", reason: "unknown-app", appId };
}
