import { describe, expect, it, vi } from "vitest";
import { flush } from "solid-js";
import type { FSNode } from "@mockintosh/fs";
import { createFsMirror } from "./fsMirror";

const dir = (id: string, parentId: string | null, name: string, extra: Partial<FSNode> = {}): FSNode =>
  ({ id, name, kind: "directory", parentId, createdAt: 0, modifiedAt: 0, revision: 1, ...extra }) as FSNode;

function setup() {
  const notify = vi.fn();
  const mirror = createFsMirror(async () => null, notify);
  mirror.update({
    rootId: "root",
    nodes: [
      dir("root", null, ""),
      dir("hd", "root", "Mockintosh HD", { role: "volume" }),
      dir("desk", "hd", "Desktop Folder", { role: "desktop" }),
      dir("docs", "hd", "Documents"),
    ],
  });
  flush();
  return { fs: mirror.fs, notify };
}

describe("the process's file system mirror", () => {
  it("makes a folder at once, with an id the OS will use too", () => {
    const { fs, notify } = setup();
    const made = fs.mkdir("hd", "TP-7");
    flush();
    expect(fs.child("hd", "TP-7")?.id).toBe(made.id);
    expect(notify).toHaveBeenCalledWith("fs.mkdir", "hd", "TP-7", { id: made.id });
  });

  it("answers mkdir for an existing folder with that folder, and refuses a name a file has", () => {
    const { fs, notify } = setup();
    expect(fs.mkdir("hd", "Documents").id).toBe("docs");
    expect(notify).not.toHaveBeenCalled();
    expect(() => fs.mkdir("hd", "a/b")).toThrow(/Invalid file name/);
  });

  it("renames and moves at once, and refuses what the real file system would", () => {
    const { fs, notify } = setup();
    fs.rename("docs", "Papers");
    flush();
    expect(fs.node("docs")?.name).toBe("Papers");
    expect(() => fs.rename("docs", "Desktop Folder")).toThrow(/already exists/);
    fs.move("docs", "desk");
    flush();
    expect(fs.children("desk").map((n) => n.id)).toEqual(["docs"]);
    expect(() => fs.move("desk", "docs")).toThrow(/into itself/);
    expect(notify).toHaveBeenCalledWith("fs.rename", "docs", "Papers");
    expect(notify).toHaveBeenCalledWith("fs.move", "docs", "desk");
  });

  it("finds a role on the member's home disk first, and keeps the startup disk as the volume", () => {
    const notify = vi.fn();
    const mirror = createFsMirror(async () => null, notify);
    mirror.update({
      rootId: "root",
      nodes: [
        dir("root", null, ""),
        dir("home", "root", "Ada", { role: "volume", home: "member-1" } as Partial<FSNode>),
        dir("homeDesk", "home", "Desktop Folder", { role: "desktop" }),
        dir("hd", "root", "Mockintosh HD", { role: "volume" }),
        dir("desk", "hd", "Desktop Folder", { role: "desktop" }),
        dir("prefs", "hd", "Preferences", { role: "preferences" }),
      ],
    });
    flush();
    expect(mirror.fs.volumes().map((v) => v.id)).toEqual(["hd", "home"]);
    expect(mirror.fs.locate("volume")?.id).toBe("hd");
    expect(mirror.fs.locate("desktop")?.id).toBe("homeDesk");
    expect(mirror.fs.locate("preferences")?.id).toBe("prefs");
  });
});
