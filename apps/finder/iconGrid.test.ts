import { describe, expect, it } from "vitest";
import { arrangeIcons, cleanUpIcons, desktopGrid, folderGrid, type GridIcon } from "./iconGrid";

// The classic 512×342 screen less its 20px menubar.
const W = 512;
const H = 322;

describe("desktop grid", () => {
  const grid = desktopGrid(W, H);

  it("lines up with System 6: icon centres at 24 + 64n, the right column 40px from the edge", () => {
    const centres = [...new Set(grid.slots.map((s) => s.x + 32))].sort((a, b) => a - b);
    expect(centres).toEqual([24, 88, 152, 216, 280, 344, 408, 472]);
  });

  it("fills the rightmost column top to bottom, then the next column left", () => {
    expect(grid.slots.slice(0, 6)).toEqual([
      { x: 440, y: 8 }, { x: 440, y: 72 }, { x: 440, y: 136 }, { x: 440, y: 200 }, { x: 440, y: 264 },
      { x: 376, y: 8 },
    ]);
    expect(grid.slots).toHaveLength(8 * 5);
  });

  it("keeps the bottom-right slot for the Trash", () => {
    const icons: GridIcon[] = [
      { id: "hd" }, { id: "a" }, { id: "b" }, { id: "c" }, { id: "d" },
      { id: "trash", home: grid.trashSlot },
    ];
    const { positions } = arrangeIcons(icons, grid);
    expect(positions.get("trash")).toEqual({ x: 440, y: 264 });
    expect(positions.get("hd")).toEqual({ x: 440, y: 8 });
    expect(positions.get("c")).toEqual({ x: 440, y: 200 });
    expect(positions.get("d")).toEqual({ x: 376, y: 8 });
  });

  it("never moves a saved icon when a new one arrives", () => {
    const saved: GridIcon[] = [
      { id: "hd", position: { x: 440, y: 8 } },
      { id: "dragged", position: { x: 300, y: 100 } },
      { id: "trash", position: { x: 440, y: 264 } },
    ];
    const before = arrangeIcons(saved, grid).positions;
    const after = arrangeIcons([{ id: "new" }, ...saved], grid);
    for (const icon of saved) expect(after.positions.get(icon.id)).toEqual(before.get(icon.id));
    expect(after.placed).toEqual(new Map([["new", { x: 440, y: 72 }]]));
  });

  it("puts a new icon in a slot no other icon overlaps", () => {
    // Loose icon straddling the first two slots of the right column.
    const { positions } = arrangeIcons([{ id: "loose", position: { x: 432, y: 40 } }, { id: "new" }], grid);
    expect(positions.get("new")).toEqual({ x: 440, y: 136 });
  });

  it("lets a Trash that was moved give up its corner", () => {
    const icons: GridIcon[] = [
      { id: "trash", position: { x: -8, y: 8 } },
      { id: "a", position: { x: 440, y: 8 } }, { id: "b", position: { x: 440, y: 72 } },
      { id: "c", position: { x: 440, y: 136 } }, { id: "d", position: { x: 440, y: 200 } },
      { id: "new" },
    ];
    expect(arrangeIcons(icons, grid).placed.get("new")).toEqual({ x: 440, y: 264 });
  });

  it("draws an icon left off a smaller screen on screen, without forgetting where it was saved", () => {
    const { positions, placed } = arrangeIcons([{ id: "far", position: { x: 900, y: 500 } }], grid);
    expect(positions.get("far")).toEqual({ x: 440, y: 264 });
    expect(placed.size).toBe(0);
  });
});

describe("folder grid", () => {
  it("fills rows left to right from the top", () => {
    const icons: GridIcon[] = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
    const { positions } = arrangeIcons(icons, folderGrid(400, icons));
    expect([...positions.values()]).toEqual([
      { x: 16, y: 16 }, { x: 96, y: 16 }, { x: 176, y: 16 }, { x: 256, y: 16 },
      { x: 16, y: 72 },
    ]);
  });

  it("has rows to reach an icon far down the window", () => {
    const icons: GridIcon[] = [{ id: "low", position: { x: 20, y: 1000 } }];
    const cleaned = cleanUpIcons([{ id: "low", position: { x: 20, y: 1000 } }], folderGrid(400, icons));
    expect(cleaned.get("low")).toEqual({ x: 16, y: 1024 });
  });
});

describe("Clean Up", () => {
  const grid = desktopGrid(W, H);

  it("moves each icon to its nearest slot", () => {
    const cleaned = cleanUpIcons(
      [{ id: "a", position: { x: 10, y: 20 } }, { id: "b", position: { x: 130, y: 140 } }],
      grid,
    );
    expect(cleaned.get("a")).toEqual({ x: -8, y: 8 });
    expect(cleaned.get("b")).toEqual({ x: 120, y: 136 });
  });

  it("gives a contested slot to the nearer icon and the other its next nearest", () => {
    const cleaned = cleanUpIcons(
      [{ id: "far", position: { x: 20, y: 30 } }, { id: "near", position: { x: 2, y: 10 } }],
      grid,
    );
    expect(cleaned.get("near")).toEqual({ x: -8, y: 8 });
    expect(cleaned.get("far")).toEqual({ x: 56, y: 8 });
  });

  it("leaves icons already in slots alone", () => {
    const icons = [{ id: "hd", position: { x: 440, y: 8 } }, { id: "trash", position: { x: 440, y: 264 } }];
    const cleaned = cleanUpIcons(icons, grid);
    for (const icon of icons) expect(cleaned.get(icon.id)).toEqual(icon.position);
  });
});
