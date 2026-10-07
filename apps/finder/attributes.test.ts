import { describe, it, expect } from "vitest";
import { FileSystem, InMemoryBackend, ROOT_ID } from "@mockintosh/fs";
import { iconForNode } from "./attributes";

describe("iconForNode", () => {
  it("shows the full Trash while the Trash holds anything", async () => {
    const fs = await FileSystem.open({ backend: new InMemoryBackend(), persistDelayMs: 0 });
    const hd = fs.mkdir(ROOT_ID, "HD", { role: "volume" });
    const trash = fs.mkdir(hd.id, "Trash", { role: "trash" });
    expect(iconForNode(fs, trash)).toBe("icon/trash");

    const junk = fs.mkdir(hd.id, "Junk");
    fs.move(junk.id, trash.id);
    expect(iconForNode(fs, trash)).toBe("icon/trash-full");

    fs.move(junk.id, hd.id);
    expect(iconForNode(fs, trash)).toBe("icon/trash");
  });
});
