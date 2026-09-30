import { describe, expect, it, vi } from "vitest";
import { defineSprite, encodeSprite } from "@mockintosh/ui";
import type { SolidApp } from "./apps";
import { declarationOf, declaredApp } from "./appDeclaration";

const icon = defineSprite(2, 2, encodeSprite({ width: 2, height: 2, data: new Uint8Array([1, 0, 0, 1]) }));

const app: SolidApp = {
  id: "decl",
  title: "Declared",
  icon: "decl/icon",
  requires: ["audio"],
  defaultSize: { width: 100, height: 80 },
  minSize: { width: 50, height: 40 },
  resizable: true,
  fileTypes: ["text/plain"],
  sprites: { "decl/icon": icon },
  about: { version: "2.0", description: "An app.", Component: () => null },
  menus: [{ label: "File", items: [{ label: "Quit", onClick: () => {} }] }],
  Component: () => null,
  onOpen: () => {},
};

describe("app declarations", () => {
  it("keep what the OS reads before an app runs, as plain data, and none of its code", () => {
    const declaration = declarationOf(app);
    expect(JSON.parse(JSON.stringify(declaration))).toEqual(declaration);
    expect(declaration).toMatchObject({
      id: "decl",
      requires: ["audio"],
      defaultSize: { width: 100, height: 80 },
      fileTypes: ["text/plain"],
      about: { version: "2.0", description: "An app.", custom: true },
    });
    expect(declaration).not.toHaveProperty("menus");
  });

  it("register an app whose code loads only when it's asked for", async () => {
    const load = vi.fn(async () => ({ default: app }));
    const registered = declaredApp(declarationOf(app), load);
    expect(registered.title).toBe("Declared");
    expect(registered.customAbout).toBe(true);
    expect(registered.about?.Component).toBeUndefined();
    expect(Array.from(registered.sprites!["decl/icon"]!.data)).toEqual([1, 0, 0, 1]);
    expect(() => registered.Component({})).toThrow(/isn't loaded/);
    expect(load).not.toHaveBeenCalled();
    expect((await registered.load!()).default).toBe(app);
  });
});
