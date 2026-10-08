/**
 * The bundled apps' modules by app id, loaded on demand: how an app process
 * (`src/platform/web/process/worker.ts`) loads the app it runs. The page
 * imports the same modules itself (`systemApps.ts`). Shell apps (Finder, App
 * Store, Icon Gallery) import `src/os` and are not here: they run on the OS's
 * thread, as does any app missing from this table.
 */
import type { SolidApp } from "@mockintosh/sdk";

export type AppModule = { default: SolidApp<any> };
export type AppModuleLoader = () => Promise<AppModule>;

export const APP_MODULES: Readonly<Record<string, AppModuleLoader>> = {
  testing: () => import("@/apps/Testing"),
  file: () => import("@/apps/FileViewer"),
  preview: () => import("@/apps/Preview"),
  video: () => import("@/apps/VideoPlayer"),
  photobooth: () => import("@/apps/PhotoBooth"),
  safari: () => import("@/apps/Safari"),
  maps: () => import("@/apps/Maps"),
  showreel: () => import("@/apps/Showreel"),
  dither: () => import("@/apps/Dither"),
  trace: () => import("@/apps/Trace"),
  spotify: () => import("@/apps/SpotifyPlayer"),
  macpaint: () => import("@/apps/MacPaint"),
  canvas: () => import("@/apps/Canvas"),
  surface: () => import("@/apps/Surface"),
  foundry: () => import("@/apps/Foundry"),
  synth: () => import("@/apps/Synth"),
  chord: () => import("@/apps/Chord"),
  op1: () => import("@/apps/OP1"),
  tp7: () => import("@/apps/TP7"),
  pchkraft: () => import("@/apps/Pchkraft"),
  visualizer: () => import("@/apps/Visualizer"),
  earth: () => import("@/apps/Earth"),
  terminal: () => import("@/apps/Terminal"),
  source_editor: () => import("@/apps/SourceEditor"),
  assistant: () => import("@/apps/Assistant"),
};
