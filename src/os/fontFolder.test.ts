import { describe, expect, it } from "vitest";
import { FileSystem, InMemoryBackend, MIME, ROOT_ID } from "@mockintosh/fs";
import {
  decodeSuitcase,
  deckerFontFromDraft,
  encodeDeckerFont,
  encodeSuitcase,
  getFont,
  listFontFamilies,
  type FontSuitcase,
} from "@mockintosh/ui";
import { bootstrapFileSystem } from "./fsBootstrap";
import { createFontFolder, strikeFileSpec, suitcaseFileName } from "./fontFolder";
import { testFontBytes } from "../../packages/ui/tests/truetype/testFont";

async function bootedFS() {
  const fs = await FileSystem.open({ backend: new InMemoryBackend(), persistDelayMs: 0 });
  await bootstrapFileSystem(fs);
  return fs;
}

function strike(size: number): string {
  return encodeDeckerFont(
    deckerFontFromDraft({
      family: "x",
      size,
      maxWidth: 3,
      glyphHeight: size,
      spacing: 0,
      glyphs: [{ ordinal: 72, width: 3, pixels: new Uint8Array(3 * size).fill(1) }],
    }),
  );
}

describe("Fonts folder", () => {
  it("names strikes and suitcases like the Mac did", () => {
    expect(strikeFileSpec("Futura-12.fnt")).toEqual({ family: "futura", size: 12 });
    expect(strikeFileSpec("New York 9.fnt")).toEqual({ family: "newyork", size: 9 });
    expect(strikeFileSpec("futura.fnt")).toBeNull();
    expect(suitcaseFileName({ family: "Test: Sans", strikes: [], outlines: [] })).toBe("Test- Sans.suit");
  });

  it("installs loose TrueType files at boot and removes them when deleted", async () => {
    const fs = await bootedFS();
    const fonts = fs.locate("fonts")!;
    const file = await fs.writeFile(fonts.id, "Loose.ttf", testFontBytes({ family: "Loose Sans" }), { type: MIME.truetype });
    const folder = await createFontFolder(fs);
    expect(folder.families()).toEqual(["loosesans"]);
    expect(getFont("loosesans", 15)?.outline).toBeDefined();
    expect(listFontFamilies().some((f) => f.name === "loosesans" && f.scalable)).toBe(true);

    await fs.remove(file.id);
    await folder.settled();
    expect(folder.families()).toEqual([]);
    expect(listFontFamilies().some((f) => f.name === "loosesans")).toBe(false);
    folder.shutdown();
  });

  it("installs a suitcase with its strikes and styled outlines, and reports broken files", async () => {
    const fs = await bootedFS();
    const folder = await createFontFolder(fs);
    const suitcase: FontSuitcase = {
      family: "Case Sans",
      strikes: [{ size: 12, style: 0, data: strike(12) }],
      outlines: [
        { style: 0, bytes: testFontBytes({ family: "Case Sans" }) },
        { style: 1, bytes: testFontBytes({ family: "Case Sans", subfamily: "Bold", weightClass: 700 }) },
      ],
      settings: { kerning: false },
    };
    expect(decodeSuitcase(encodeSuitcase(suitcase)).outlines[1]!.bytes).toEqual(suitcase.outlines[1]!.bytes);
    expect(await folder.install(suitcase)).toBe("casesans");
    const saved = fs.child(fs.locate("fonts")!.id, "Case Sans.suit");
    expect(saved?.kind === "file" && saved.type).toBe(MIME.suitcase);
    expect(getFont("casesans", 12)?.outline).toBeUndefined();
    expect(getFont("casesans", 13)?.outline).toBeDefined();
    const info = listFontFamilies().find((f) => f.name === "casesans")!;
    expect(info.sizes).toEqual([12]);
    expect(info.displayName).toBe("Case Sans");

    await fs.writeFile(fs.locate("fonts")!.id, "Broken.ttf", new Uint8Array([1, 2, 3]), { type: MIME.truetype });
    await folder.settled();
    expect(folder.problems().map((p) => p.fileName)).toEqual(["Broken.ttf"]);
    expect(folder.families()).toEqual(["casesans"]);
    folder.shutdown();
  });

  it("adopts a Fonts folder the user made before the OS knew the role", async () => {
    const fs = await FileSystem.open({ backend: new InMemoryBackend(), persistDelayMs: 0 });
    // An older disk: System Folder exists, and the user made a plain "Fonts" in it.
    const hd = fs.mkdir(ROOT_ID, "Mockintosh HD", { role: "volume" });
    const system = fs.mkdir(hd.id, "System Folder", { role: "system" });
    const plain = fs.mkdir(system.id, "Fonts");
    await fs.writeFile(plain.id, "Kept.ttf", testFontBytes({ family: "Kept Sans" }), { type: MIME.truetype });
    await bootstrapFileSystem(fs);
    expect(fs.locate("fonts")?.id).toBe(plain.id);
    const folder = await createFontFolder(fs);
    expect(folder.families()).toEqual(["keptsans"]);
    folder.shutdown();
  });
});
