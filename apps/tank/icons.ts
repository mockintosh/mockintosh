import type { Sprite } from "@mockintosh/sdk";
import { fromGrid } from "@mockintosh/sdk";

/** A tank side-on, gun to the right, its hull in a light shade pattern. `#` ink, `o` paper, `.` clear. */
const TANK = [
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
  "..............####..............",
  "............########............",
  "............#oooooo#............",
  "...........#oooooooo############",
  "...........#oooooooo#oooooooooo#",
  "..........#oooooooooo###########",
  "..........#oooooooooo#..........",
  ".........##############.........",
  ".....####################.......",
  "....#o#ooo#ooo#ooo#ooo#oo#......",
  "...##ooo#ooo#ooo#ooo#ooo#o#.....",
  "...#oo#ooo#ooo#ooo#ooo#ooo##....",
  "...##ooo#ooo#ooo#ooo#ooo#oo#....",
  "...#########################....",
  "..oo########################oo..",
  "..o#oooooooooooooooooooooooo#o..",
  "..#oo###oo###oo###oo###oo###o#..",
  "..#oo#o#oo#o#oo#o#oo#o#oo#o#o#..",
  "..#oo###oo###oo###oo###oo###o#..",
  "..o#oooooooooooooooooooooooo#o..",
  "..oo########################oo..",
  "................................",
  ".#.#.#.#.#.#.#.#.#.#.#.#.#.#.#..",
  "................................",
  "................................",
  "................................",
];

/** The 16×16 for the application menu: turret and gun, a solid hull, the track with four road wheels. */
const TANK_16: Sprite = fromGrid(16, 16, [
  "................",
  "................",
  "......####......",
  ".....#oooo#.....",
  ".....#oooo######",
  "....#oooooo#....",
  "...##########...",
  "..############..",
  "..############..",
  ".##############.",
  "#oooooooooooooo#",
  "#o##o##oo##o##o#",
  "#o##o##oo##o##o#",
  "#oooooooooooooo#",
  ".##############.",
  "................",
]);

export const sprites: Record<string, Sprite> = {
  "tank/icon": fromGrid(32, 32, TANK),
  "tank/icon-16x16": TANK_16,
};
