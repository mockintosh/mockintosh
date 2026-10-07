/**
 * An app as data: what the OS reads from a `defineApp` declaration without
 * running the app — its title and icon for the desktop and the App Store, the
 * files it opens, what it requires, its window's defaults — and nothing that
 * is code. Publishers ship it beside the bundle (`manifest.json`, emitted by
 * `mockintoshManifest()` from `@mockintosh/sdk/vite`), so the OS can list,
 * draw and route to an app that it has never loaded.
 */
import { encodeSprite } from "@mockintosh/ui";
import type { SolidApp } from "./index";

/** A sprite in a declaration: its size and 2 bpp pixels (`encodeSprite`). */
export interface EncodedSprite {
  width: number;
  height: number;
  data: string;
}

export interface AppDeclaration {
  id: string;
  title: string;
  icon: string;
  smallIcon?: string;
  requires?: SolidApp["requires"];
  permissions?: SolidApp["permissions"];
  signIn?: SolidApp["signIn"];
  runtime?: SolidApp["runtime"];
  defaultSize: { width: number; height: number };
  windowKind?: string;
  scrollable?: boolean;
  resizable?: boolean;
  growBox?: SolidApp["growBox"];
  minSize?: { width: number; height: number };
  singleInstance?: boolean;
  fileTypes?: SolidApp["fileTypes"];
  /** The About box's text; `custom` when the app draws its own. */
  about?: { version?: string; description?: string; size?: { width: number; height: number }; custom?: boolean };
  /** The app's sprites, its icon among them. */
  sprites?: Record<string, EncodedSprite>;
}

/** The declaration of a loaded app. */
export function appDeclaration(app: SolidApp<any>): AppDeclaration {
  const declaration: AppDeclaration = { id: app.id, title: app.title, icon: app.icon, defaultSize: { ...app.defaultSize } };
  const copy = <K extends keyof AppDeclaration>(key: K, value: unknown) => {
    if (value !== undefined) declaration[key] = JSON.parse(JSON.stringify(value)) as AppDeclaration[K];
  };
  copy("smallIcon", app.smallIcon);
  copy("requires", app.requires);
  copy("permissions", app.permissions);
  copy("signIn", app.signIn);
  copy("runtime", app.runtime);
  copy("windowKind", app.windowKind);
  copy("scrollable", app.scrollable);
  copy("resizable", app.resizable);
  copy("growBox", app.growBox);
  copy("minSize", app.minSize);
  copy("singleInstance", app.singleInstance);
  copy("fileTypes", app.fileTypes);
  if (app.about) {
    const { version, description, size, Component } = app.about;
    declaration.about = JSON.parse(JSON.stringify({ version, description, size, custom: Component ? true : undefined }));
  }
  if (app.sprites) {
    declaration.sprites = Object.fromEntries(
      Object.entries(app.sprites).map(([name, sprite]) => [name, { width: sprite.width, height: sprite.height, data: encodeSprite(sprite) }]),
    );
  }
  return declaration;
}
