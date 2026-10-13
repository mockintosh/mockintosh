import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FileSystem, InMemoryBackend } from "@mockintosh/fs";
import type { FetchFunction, FetchResponse } from "@mockintosh/sdk";
import { getFont, listFontFamilies } from "@mockintosh/ui";
import { bootstrapFileSystem } from "./fsBootstrap";
import { createFontFolder } from "./fontFolder";
import { installLibraryFont, libraryFontKey, loadFontLibrary } from "./fontLibrary";

const PUBLIC = resolve(__dirname, "../../public");

/** Serves `public/` the way the site does. */
const servePublic: FetchFunction = async (url) => {
  let body: string | undefined;
  try {
    body = readFileSync(resolve(PUBLIC, decodeURIComponent(url.replace(/^\//, ""))), "utf8");
  } catch {
    body = undefined;
  }
  const response: FetchResponse = {
    ok: body !== undefined,
    status: body !== undefined ? 200 : 404,
    headers: { get: () => null },
    text: async () => body ?? "",
    json: async () => JSON.parse(body ?? "null") as unknown,
    arrayBuffer: async () => new TextEncoder().encode(body ?? "").buffer as ArrayBuffer,
  };
  return response;
};

describe("font library", () => {
  it("installs a font into System Folder › Fonts, where it joins the font menus", async () => {
    const fs = await FileSystem.open({ backend: new InMemoryBackend(), persistDelayMs: 0 });
    await bootstrapFileSystem(fs);
    const folder = await createFontFolder(fs);
    const fonts = await loadFontLibrary(servePublic);
    const lisa = fonts.find((f) => f.family === "Lisa")!;
    expect(getFont(libraryFontKey(lisa))).toBeNull();

    expect(await installLibraryFont(servePublic, lisa, folder)).toBe("lisa");
    expect(fs.children(fs.locate("fonts")!.id).map((n) => n.name)).toContain("Lisa.suit");
    expect(folder.families()).toContain("lisa");
    expect(listFontFamilies().find((f) => f.name === "lisa")?.displayName).toBe("Lisa");
    expect(getFont("lisa")?.glyphHeight).toBe(12);
    folder.shutdown();
  });

  it("says when a download fails", async () => {
    const fs = await FileSystem.open({ backend: new InMemoryBackend(), persistDelayMs: 0 });
    await bootstrapFileSystem(fs);
    const folder = await createFontFolder(fs);
    const missing = { family: "Nope", file: "nope.suit", designer: "", description: "", license: "", sizes: [], styles: [], bytes: 0 };
    await expect(installLibraryFont(servePublic, missing, folder)).rejects.toThrow("Couldn't download Nope (HTTP 404).");
    folder.shutdown();
  });
});
