/**
 * An app as data: everything the OS reads from a `defineApp` declaration
 * before the app runs (title, icon, sprites, what it requires, the files it
 * opens, its window's defaults) and nothing that is code. The page registers
 * apps that run in processes from their declarations, so it never loads
 * their code: bundled apps from `apps/declarations.generated.json`,
 * installed bundles and OS builds from a process that loaded them
 * (`process/describe.ts`).
 */
import { defineSprite, type Sprite } from "@mockintosh/ui";
import { appDeclaration, type AppDeclaration, type SolidApp as SDKSolidApp } from "@mockintosh/sdk";
import type { SolidApp } from "./apps";

export type { AppDeclaration };

/** The declaration of a loaded app. */
export function declarationOf(app: SolidApp): AppDeclaration {
  return appDeclaration(app as unknown as SDKSolidApp);
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
  const { sprites, about, windowKind, ...rest } = declaration;
  return {
    ...rest,
    windowKind: windowKind as SolidApp["windowKind"],
    about: about && { version: about.version, description: about.description, size: about.size },
    customAbout: about?.custom === true,
    sprites: decodeSprites(sprites),
    Component: NotLoaded,
    load,
  };
}
