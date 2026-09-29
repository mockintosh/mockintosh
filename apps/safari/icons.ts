import type { Sprite } from "@mockintosh/sdk";

/** `#` is black, `.` is white, a space is transparent. Every row has the same length. */
export function art(rows: readonly string[]): Sprite {
  const width = rows[0].length;
  const height = rows.length;
  const data = new Uint8Array(width * height);
  const mask = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`icon row ${y} is ${row.length} wide, not ${width}`);
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      data[at] = row[x] === "#" ? 1 : 0;
      mask[at] = row[x] === " " ? 0 : 1;
    }
  });
  return { width, height, data, mask };
}

/** Nearest-neighbour enlarge. `n` is an integer ≥ 1. */
export function scaled(sprite: Sprite, n: number): Sprite {
  if (n < 1 || !Number.isInteger(n)) throw new Error(`scale must be an integer ≥ 1, got ${n}`);
  if (n === 1) return sprite;
  const width = sprite.width * n;
  const height = sprite.height * n;
  const data = new Uint8Array(width * height);
  const mask = sprite.mask ? new Uint8Array(width * height) : undefined;
  for (let y = 0; y < sprite.height; y++) {
    for (let x = 0; x < sprite.width; x++) {
      const src = y * sprite.width + x;
      const bit = sprite.data[src];
      const covered = sprite.mask?.[src] ?? 1;
      for (let dy = 0; dy < n; dy++) {
        for (let dx = 0; dx < n; dx++) {
          const at = (y * n + dy) * width + (x * n + dx);
          data[at] = bit;
          if (mask) mask[at] = covered;
        }
      }
    }
  }
  return mask ? { width, height, data, mask } : { width, height, data };
}

function mirrored(rows: readonly string[]): string[] {
  return rows.map((row) => [...row].reverse().join(""));
}

/**
 * Every other pixel along each line: how a control that can't be used
 * looks. Pixels on a vertical run alternate by row, the rest (horizontal
 * runs and diagonals) by column. A plain checkerboard would keep or drop
 * whole diagonals of a one-pixel outline.
 */
export function dimmed(sprite: Sprite): Sprite {
  const { width, height } = sprite;
  const black = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height && sprite.data[y * width + x] === 1;
  const data = sprite.data.map((bit, at) => {
    if (!bit) return 0;
    const x = at % width;
    const y = Math.floor(at / width);
    const vertical = (black(x, y - 1) || black(x, y + 1)) && !black(x - 1, y) && !black(x + 1, y);
    return (vertical ? y : x) % 2 === 0 ? 1 : 0;
  });
  return { ...sprite, data };
}

const BACK_ROWS = [
  "      #        ",
  "     ##        ",
  "    # #        ",
  "   #  #########",
  "  #           #",
  " #            #",
  "#             #",
  " #            #",
  "  #           #",
  "   #  #########",
  "    # #        ",
  "     ##        ",
  "      #        ",
];

export const backIcon = art(BACK_ROWS);
export const forwardIcon = art(mirrored(BACK_ROWS));

/** A box with an arrow leaving it: send this page somewhere. */
export const shareIcon = art([
  "      #      ",
  "     ###     ",
  "    # # #    ",
  "   #  #  #   ",
  "      #      ",
  "####  #  ####",
  "#     #     #",
  "#     #     #",
  "#           #",
  "#           #",
  "#           #",
  "#           #",
  "#############",
]);

/** Two windows, one in front of the other. */
export const windowsIcon = art([
  "    #########",
  "    #.......#",
  "    #.......#",
  "#########...#",
  "#.......#...#",
  "#.......#...#",
  "#.......#...#",
  "#.......#...#",
  "#.......#####",
  "#.......#    ",
  "#.......#    ",
  "#########    ",
]);

export const plusIcon = art([
  "    #    ",
  "    #    ",
  "    #    ",
  "    #    ",
  "#########",
  "    #    ",
  "    #    ",
  "    #    ",
  "    #    ",
]);

/** Shown in the address field for `https` pages. */
export const lockIcon = art([
  "  ###  ",
  " #   # ",
  " #   # ",
  "#######",
  "###.###",
  "###.###",
  "#######",
  "#######",
]);

/** The Octocat, white on a black disc. */
export const githubIcon = art([
  "    ######    ",
  "  ##########  ",
  " ############ ",
  " ##.######.## ",
  "###..####..###",
  "###........###",
  "##..........##",
  "##..........##",
  "##..........##",
  "###........###",
  "####......####",
  " ####....#### ",
  "  ###....###  ",
  "    #....#    ",
]);

/** Hacker News' Y, white on a black square. */
export const hackerNewsIcon = art([
  "##############",
  "##############",
  "##############",
  "##..######..##",
  "###..####..###",
  "####..##..####",
  "#####....#####",
  "######..######",
  "######..######",
  "######..######",
  "######..######",
  "######..######",
  "##############",
  "##############",
]);
