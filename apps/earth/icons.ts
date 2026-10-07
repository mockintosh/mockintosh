import type { Sprite } from "@mockintosh/sdk";
import { fromGrid } from "@mockintosh/sdk";

/** The globe over Africa and Europe, land in paper on an ink sea, drawn from the app's own coastlines. `#` ink, `o` paper, `.` clear. */
const GLOBE = [
  "................................",
  "...........##########...........",
  "........###oooooooooo###........",
  ".......##oo#oo#####oooo##.......",
  "......#oo##o#######oooooo#......",
  ".....#ooo######ooooooooooo#.....",
  "....#oo########o#oooooooooo#....",
  "...#oo#######ooooooooooooooo#...",
  "..##o########oooooo#o#oooooo##..",
  "..#o########oo###oooooooooooo#..",
  "..#o########ooo#####ooooooooo#..",
  ".#o########ooooo#ooooooooooooo#.",
  ".#o#######ooooooooooooo###oo#o#.",
  ".#o######oooooooooooooooo##o#o#.",
  ".#o######oooooooooooo#oo###o#o#.",
  ".#o######oooooooooooooo######o#.",
  ".#oo######oooooooooooooo#####o#.",
  ".#oo##########ooooooooo######o#.",
  ".#ooo##########ooooooo#######o#.",
  ".#oooo#########ooooooo#######o#.",
  ".#ooo###########oooooo#######o#.",
  "..#ooo##########oooooo######o#..",
  "..#oo##########oooooo#o#####o#..",
  "..##o###########oooo##o####o##..",
  "...#oo##########oooo######oo#...",
  "....#o###########oo#######o#....",
  ".....#oo################oo#.....",
  "......#oo##############oo#......",
  ".......##oo##########oo##.......",
  "........###oooooooooo###........",
  "...........##########...........",
  "................................",
];

export const sprites: Record<string, Sprite> = {
  "earth/icon": fromGrid(32, 32, GLOBE),
};
