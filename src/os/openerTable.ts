/**
 * The file types each app claims, and which apps open a given type. Pure, so
 * an app process answers `os.openersFor` from the table the OS sends it
 * (docs/worker-apps-plan.md), with the same order as the OS's own answer.
 */
import type { FileOpener, FileTypeClaim, SolidApp } from "@mockintosh/sdk";

/** One app's file type claims, without the rest of the app. */
export interface OpenerEntry {
  appId: string;
  title: string;
  claims: FileTypeClaim[];
}

/** The claims of every app in `apps` that opens any file type, in registration order. */
export function openerTable(apps: Iterable<Pick<SolidApp<any>, "id" | "title" | "fileTypes">>): OpenerEntry[] {
  const table: OpenerEntry[] = [];
  for (const app of apps) {
    if (!app.fileTypes?.length) continue;
    const claims = app.fileTypes.map((entry): FileTypeClaim => (typeof entry === "string" ? { type: entry, rank: "default" } : entry));
    table.push({ appId: app.id, title: app.title, claims });
  }
  return table;
}

/** Every app in `table` that opens `type`: defaults first, then alternates, each in table order. */
export function openersAmong(table: readonly OpenerEntry[], type: string): FileOpener[] {
  const defaults: FileOpener[] = [];
  const alternates: FileOpener[] = [];
  for (const { appId, title, claims } of table) {
    const rank = claims.find((claim) => claim.type === type)?.rank;
    if (!rank) continue;
    (rank === "default" ? defaults : alternates).push({ appId, title, rank });
  }
  return [...defaults, ...alternates];
}
