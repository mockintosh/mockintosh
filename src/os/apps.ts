/**
 * Solid app registry — every window content is a registered SolidApp.
 */

import type { Capability, SolidApp as SDKSolidApp } from "@mockintosh/sdk";
import { setAppMenus, type OSWindowKind } from "./state";

/**
 * A registered app. Same contract third-party apps declare with `defineApp`
 * (`@mockintosh/sdk`), widened for the shell: any window kind (the Finder's
 * folder windows). `menus` is the app-level menubar; apps whose menus change
 * at runtime call `useApp().setMenus` for the current window.
 */
export interface SolidApp<P extends Record<string, unknown> = Record<string, unknown>>
  extends Omit<SDKSolidApp<P>, "windowKind"> {
  windowKind?: OSWindowKind;
  /**
   * Set when the app was registered from its declaration (`appDeclaration.ts`)
   * and its code isn't loaded: the OS calls it before running the app on its
   * own thread. A process loads the code itself.
   */
  load?: () => Promise<{ default: SolidApp<any> }>;
  /** The app draws its own About box, in its own code (so, when registered from a declaration, in its process). */
  customAbout?: boolean;
}

let apps: Map<string, SolidApp<any>> | undefined;
function appMap(): Map<string, SolidApp<any>> {
  return (apps ??= new Map());
}

export function registerApp<P extends Record<string, unknown>>(app: SolidApp<P>): void {
  appMap().set(app.id, app);
  setAppMenus(app.id, app.menus ?? []);
}

export function getApp(id: string): SolidApp<any> | undefined {
  return appMap().get(id);
}

export function getAllApps(): SolidApp<any>[] {
  return Array.from(appMap().values());
}

/** An installed app the OS knows about but did not load, because this platform cannot run it. */
export interface UnavailableApp {
  id: string;
  title: string;
  missing: Capability[];
}

let unavailable: Map<string, UnavailableApp> | undefined;
function unavailableMap(): Map<string, UnavailableApp> {
  return (unavailable ??= new Map());
}

export function registerUnavailableApp(app: UnavailableApp): void {
  unavailableMap().set(app.id, app);
}

export function getUnavailableApp(id: string): UnavailableApp | undefined {
  return unavailableMap().get(id);
}

export function unregisterApp(id: string): void { appMap().delete(id); setAppMenus(id, []); }
