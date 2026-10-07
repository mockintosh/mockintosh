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

/** The 16×16 for the application menu: the globe with Africa and Europe in paper on an ink sea. */
const GLOBE_16: Sprite = fromGrid(16, 16, [
  "................",
  ".....######.....",
  "...#####ooo##...",
  "..######ooooo#..",
  ".######oooooo##.",
  ".#o###oooooooo#.",
  ".#o###oooooooo#.",
  ".#o##oooooo##o#.",
  ".#o###oooo###o#.",
  ".#o####ooo###o#.",
  ".#o####ooo###o#.",
  ".#######oo#####.",
  "..#######o####..",
  "...##########...",
  ".....######.....",
  "................",
]);

export const sprites: Record<string, Sprite> = {
  "earth/icon": fromGrid(32, 32, GLOBE),
  "earth/icon-16x16": GLOBE_16,
};
