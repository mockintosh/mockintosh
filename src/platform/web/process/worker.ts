/**
 * An app process on the web: a module Worker running one app instance. The
 * OS starts it (`createWebAppProcesses`) and sends `start` naming the app's
 * code. Installed bundles and OS builds share this worker's Solid, UI kit,
 * QuickDraw and SDK through `loader.ts`.
 */
import * as solid from "solid-js";
import * as sdk from "@mockintosh/sdk";
import * as ui from "@mockintosh/ui";
import * as renderer from "@mockintosh/ui/renderer";
import * as quickdraw from "@mockintosh/quickdraw";
import * as agent from "@mockintosh/agent";
import type { SolidApp, Sprite } from "@mockintosh/sdk";
import { APP_MODULES } from "../../../appModules";
import { createAppLoader } from "./loader";
import { runProcess, type ProcessScope } from "./runtime";

const load = createAppLoader({
  shared: {
    "solid-js": solid,
    "@mockintosh/sdk": sdk,
    "@mockintosh/ui": ui,
    "@mockintosh/ui/renderer": renderer,
    "@mockintosh/quickdraw": quickdraw,
    "@mockintosh/agent": agent,
    "@mockintosh/terminal": () => import("@mockintosh/terminal"),
    "@mockintosh/terminal/view": () => import("@mockintosh/terminal/view"),
    "@mockintosh/terminal/bash": () => import("@mockintosh/terminal/bash"),
    "@mockintosh/terminal/wasi": () => import("@mockintosh/terminal/wasi"),
  },
  bundled: async (id) => APP_MODULES[id]?.(),
  fetchText: async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Couldn't load ${url} (${response.status})`);
    return response.text();
  },
  importUrl: (url) => import(/* @vite-ignore */ url),
  blobUrl: (code) => URL.createObjectURL(new Blob([code], { type: "text/javascript" })),
});

runProcess(self as unknown as ProcessScope, async (source) => {
  const module = await load(source);
  const app = module?.default as SolidApp | undefined;
  // A bundle's exported sprites are the app's, as the OS registers them.
  return app && module?.sprites ? { ...app, sprites: { ...app.sprites, ...(module.sprites as Record<string, Sprite>) } } : app;
});
