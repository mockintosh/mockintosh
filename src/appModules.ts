/**
 * The bundled apps' modules by app id, loaded on demand. The main thread uses
 * it for App Store listings; an app process (`src/platform/web/appProcess.worker.ts`)
 * uses it to load the app it runs. Shell apps (Finder, App Store, Icon Gallery)
 * import `src/os` and are not here: they run on the OS's thread.
 */
import type { SolidApp } from "@mockintosh/sdk";
import { alternateFileTypes, MIME } from "@mockintosh/sdk";

export type AppModule = { default: SolidApp<any> };
export type AppModuleLoader = () => Promise<AppModule>;

/**
 * The same app, opened as a twin that always runs in a process and shows the
 * Worker menu, to compare with the app on the OS's thread. Retired when
 * processes become the default (docs/worker-apps-plan.md, step 7).
 */
function processTwin(load: AppModuleLoader, overrides: Partial<SolidApp<any>> & { id: string; title: string }): AppModuleLoader {
  return async () => {
    const { default: app } = await load();
    return { default: { ...app, ...overrides, runtime: "worker", processStats: true } as SolidApp<any> };
  };
}

const canvas: AppModuleLoader = () => import("@/apps/Canvas");
const op1: AppModuleLoader = () => import("@/apps/OP1");
const showreel: AppModuleLoader = () => import("@/apps/Showreel");

export const APP_MODULES: Readonly<Record<string, AppModuleLoader>> = {
  testing: () => import("@/apps/Testing"),
  file: () => import("@/apps/FileViewer"),
  preview: () => import("@/apps/Preview"),
  video: () => import("@/apps/VideoPlayer"),
  photobooth: () => import("@/apps/PhotoBooth"),
  safari: () => import("@/apps/Safari"),
  showreel,
  dither: () => import("@/apps/Dither"),
  trace: () => import("@/apps/Trace"),
  spotify: () => import("@/apps/SpotifyPlayer"),
  macpaint: () => import("@/apps/MacPaint"),
  canvas,
  surface: () => import("@/apps/Surface"),
  foundry: () => import("@/apps/Foundry"),
  synth: () => import("@/apps/Synth"),
  chord: () => import("@/apps/Chord"),
  op1,
  tp7: () => import("@/apps/TP7"),
  pchkraft: () => import("@/apps/Pchkraft"),
  visualizer: () => import("@/apps/Visualizer"),
  "canvas-worker": processTwin(canvas, {
    id: "canvas-worker",
    title: "Canvas Webworker",
    fileTypes: alternateFileTypes([MIME.canvas]),
  }),
  "op1-worker": processTwin(op1, { id: "op1-worker", title: "OP-1 Webworker" }),
  "showreel-worker": processTwin(showreel, { id: "showreel-worker", title: "Showreel Webworker" }),
};
