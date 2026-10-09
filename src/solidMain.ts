/**
 * Browser entry point: build the web platform, register the apps bundled with
 * the web build, and boot the OS on it.
 */
import "./systemApps";
import { DEFAULT_SCREEN, createWebPlatform, guardUnload } from "./platform/web";
import { installCompanionUI } from "./platform/web/companion";
import { bootOS } from "./os/boot";

bootOS(
  createWebPlatform({
    root: document.getElementById("root")!,
    width: DEFAULT_SCREEN.width,
    height: DEFAULT_SCREEN.height,
  })
).then(os => {
  // Only the Finder running is nothing to lose: the disk keeps itself. Not in
  // development, where Vite reloads the page itself.
  if (!import.meta.env.DEV) guardUnload(() => (os.services.instances?.list().length ?? 0) > 0);
  if (import.meta.env.DEV) installCompanionUI(os);
}).catch(console.error);
