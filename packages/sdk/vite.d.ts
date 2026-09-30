import type { Plugin } from "vite";

/**
 * Write `manifest.json` beside the built bundle: `mockintosh.json`'s fields,
 * the bundle's `entry`, and the app's `declaration`, so the OS can list,
 * draw and route to the app without running it.
 */
export function mockintoshManifest(options?: {
  /** The publisher's fields. Default `mockintosh.json`. */
  manifest?: string;
  /** The app's source entry. Default `build.lib.entry`. */
  entry?: string;
  /** The built bundle's file name. Default `index.js`. */
  fileName?: string;
}): Plugin;
