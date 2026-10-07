import { describe, expect, it } from "vitest";
import { FileSystem, InMemoryBackend, MAX_NAME_LENGTH, ROOT_ID, fitName, fitNameWithSuffix, isFSError, uniqueChildName } from "../src";

describe("uniqueChildName", () => {
  it("adds a numeric suffix before the extension", async () => {
    const fs = await FileSystem.open({ backend: new InMemoryBackend(), persistDelayMs: 0 });
    const hd = fs.mkdir(ROOT_ID, "HD", { role: "volume" });
    expect(uniqueChildName(fs, hd.id, "face.png")).toBe("face.png");
    await fs.writeFile(hd.id, "face.png", new Uint8Array([1]));
    expect(uniqueChildName(fs, hd.id, "face.png")).toBe("face 2.png");
    await fs.writeFile(hd.id, "face 2.png", new Uint8Array([1]));
    expect(uniqueChildName(fs, hd.id, "face.png")).toBe("face 3.png");
  });

  it("numbers names without an extension and names blanks", async () => {
    const fs = await FileSystem.open({ backend: new InMemoryBackend(), persistDelayMs: 0 });
    const hd = fs.mkdir(ROOT_ID, "HD", { role: "volume" });
    await fs.writeJSON(hd.id, "Surface Plot", {});
    expect(uniqueChildName(fs, hd.id, "Surface Plot")).toBe("Surface Plot 2");
    expect(uniqueChildName(fs, hd.id, "  ")).toBe("untitled");
  });
});

describe("name length", () => {
  const long = "my extraordinarily long folder name";

  it("refuses to create or rename to a name over the limit", async () => {
    const fs = await FileSystem.open({ backend: new InMemoryBackend(), persistDelayMs: 0 });
    const hd = fs.mkdir(ROOT_ID, "HD", { role: "volume" });
    const ok = "x".repeat(MAX_NAME_LENGTH);
    const tooLong = ok + "x";
    expect(fs.mkdir(hd.id, ok).name).toBe(ok);
    expect(() => fs.mkdir(hd.id, tooLong)).toThrow(/at most 28 characters/);
    await expect(fs.writeFile(hd.id, tooLong, "")).rejects.toSatisfy((e) => isFSError(e, "invalid-name"));
    const file = await fs.writeFile(hd.id, "a.txt", "");
    expect(() => fs.rename(file.id, tooLong)).toThrow(/at most 28 characters/);
  });

  it("keeps names saved before the limit usable", async () => {
    const backend = new InMemoryBackend();
    const old = await FileSystem.open({ backend, persistDelayMs: 0 });
    const hd = old.mkdir(ROOT_ID, "HD", { role: "volume" });
    const legacy = "a legacy name from before the limit";
    // Saved by an older build: write the catalog without the check.
    const dir = old.mkdir(hd.id, "x");
    const file = await old.writeFile(hd.id, "y.txt", "1");
    (old as unknown as { commit(f: (s: { nodes: Record<string, { name: string }> }) => void): void })
      .commit((s) => { s.nodes[dir.id].name = legacy; s.nodes[file.id].name = legacy + ".txt"; });
    expect(old.mkdir(hd.id, legacy).id).toBe(dir.id);
    expect((await old.writeFile(hd.id, legacy + ".txt", "2")).id).toBe(file.id);
    expect(() => old.rename(dir.id, legacy)).not.toThrow();
  });

  it("counts characters, not UTF-16 units", async () => {
    const fs = await FileSystem.open({ backend: new InMemoryBackend(), persistDelayMs: 0 });
    const hd = fs.mkdir(ROOT_ID, "HD", { role: "volume" });
    const emoji = "🍎".repeat(MAX_NAME_LENGTH);
    expect(fs.mkdir(hd.id, emoji).name).toBe(emoji);
    expect(fitName("🍎".repeat(40))).toBe(emoji);
  });

  it("shortens a long name, keeping its extension", () => {
    expect(fitName(long)).toBe("my extraordinarily long fold");
    expect(fitName("Screenshot 2026-10-07 at 12.42.27.png")).toBe("Screenshot 2026-10-07 at.png");
    expect(fitName("short.txt")).toBe("short.txt");
    expect(fitNameWithSuffix("Photo 2026-10-07 14.03.05", " bitmap")).toBe("Photo 2026-10-07 14.0 bitmap");
  });

  it("makes room for the number on a clash", async () => {
    const fs = await FileSystem.open({ backend: new InMemoryBackend(), persistDelayMs: 0 });
    const hd = fs.mkdir(ROOT_ID, "HD", { role: "volume" });
    const first = uniqueChildName(fs, hd.id, long + ".png");
    expect(first).toBe("my extraordinarily long.png");
    await fs.writeFile(hd.id, first, "");
    const second = fs.availableName(hd.id, long + ".png");
    expect(second).toBe("my extraordinarily lon 2.png");
    expect(second.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
  });
});
