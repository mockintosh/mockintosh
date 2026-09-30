/**
 * An app as data: everything the OS reads from a `defineApp` declaration
 * before the app runs (title, icon, sprites, what it requires, the files it
 * opens, its window's defaults) and nothing that is code. The page registers
 * apps that run in processes from their declarations, so it never loads
 * their code: bundled apps from `apps/declarations.generated.json`,
 * installed bundles and OS builds from a process that loaded them
 * (`process/describe.ts`).
 */
import { defineSprite, encodeSprite, type Sprite } from "@mockintosh/ui";
import type { SolidApp } from "./apps";

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
  windowKind?: SolidApp["windowKind"];
  scrollable?: boolean;
  resizable?: boolean;
  minSize?: { width: number; height: number };
  singleInstance?: boolean;
  fileTypes?: SolidApp["fileTypes"];
  /** The About box's text; `custom` when the app draws its own. */
  about?: { version?: string; description?: string; size?: { width: number; height: number }; custom?: boolean };
  /** The app's sprites, encoded (`encodeSprite`). */
  sprites?: Record<string, { width: number; height: number; data: string }>;
}

/** The declaration of a loaded app. */
export function declarationOf(app: SolidApp): AppDeclaration {
  const declaration: AppDeclaration = { id: app.id, title: app.title, icon: app.icon, defaultSize: { ...app.defaultSize } };
  const copy = <K extends keyof AppDeclaration>(key: K, value: AppDeclaration[K] | undefined) => {
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

function decodeSprites(sprites: AppDeclaration["sprites"]): Record<string, Sprite> | undefined {
  if (!sprites) return undefined;
  return Object.fromEntries(Object.entries(sprites).map(([name, s]) => [name, defineSprite(s.width, s.height, s.data)]));
}

/** Stands in for the code of an app registered from its declaration; the OS loads the module before it would render. */
function NotLoaded(): never {
  throw new Error("This app's code isn't loaded on the OS's thread");
}

/**
 * The app the OS registers from a declaration. `load` fetches its code for
 * the times it must run on the OS's thread; a process loads it itself.
 */
export function declaredApp(declaration: AppDeclaration, load: () => Promise<{ default: SolidApp }>): SolidApp {
  const { sprites, about, ...rest } = declaration;
  return {
    ...rest,
    about: about && { version: about.version, description: about.description, size: about.size },
    customAbout: about?.custom === true,
    sprites: decodeSprites(sprites),
    Component: NotLoaded,
    load,
  };
}
