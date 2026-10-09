import { fromGrid, type Sprite } from "@mockintosh/sdk";

/** A magnifying glass: a 2px lens ring with a glint, and a heavy handle to the bottom right. */
const ICON = fromGrid(32, 32, [
  "................................",
  "................................",
  "........##########..............",
  ".......############.............",
  ".....####oooooooo####...........",
  "....###oooooooooooo###..........",
  "....##ooooo#oooooooo##..........",
  "...##ooooo#oooooooooo##.........",
  "..###oooo#ooooooooooo###........",
  "..##oooo#ooooooooooooo##........",
  "..##ooo#oooooooooooooo##........",
  "..##oo#ooooooooooooooo##........",
  "..##oooooooooooooooooo##........",
  "..##oooooooooooooooooo##........",
  "..##oooooooooooooooooo##........",
  "..##oooooooooooooooooo##........",
  "..##oooooooooooooooooo##........",
  "..###oooooooooooooooo###........",
  "...##oooooooooooooooo##.........",
  "....##oooooooooooooo###.........",
  "....###oooooooooooo#####........",
  ".....####oooooooo########.......",
  ".......###################......",
  "........##########.########.....",
  "....................########....",
  ".....................########...",
  "......................########..",
  ".......................#######..",
  "........................######..",
  ".........................####...",
  "................................",
  "................................",
]);

/** The same glass for the application menu: a 1px ring and the handle. */
const ICON_16 = fromGrid(16, 16, [
  "...#####........",
  ".##ooooo##......",
  ".#oo#oooo#......",
  "#oo#oooooo#.....",
  "#ooooooooo#.....",
  "#ooooooooo#.....",
  "#ooooooooo#.....",
  "#ooooooooo#.....",
  ".#ooooooo#......",
  ".##ooooo###.....",
  "...#####.###....",
  "..........###...",
  "...........###..",
  "............###.",
  ".............###",
  "..............##",
]);

/** The menubar's glyph: a light outline glass that sits with the menu titles. */
const MENUBAR = fromGrid(13, 13, [
  "...#####.....",
  ".##.....##...",
  ".#.......#...",
  "#.........#..",
  "#.........#..",
  "#.........#..",
  "#.........#..",
  "#.........#..",
  ".#.......#...",
  ".##.....###..",
  "...#####.###.",
  "..........###",
  "...........##",
]);

export const sprites: Record<string, Sprite> = {
  "spotlight/icon": ICON,
  "spotlight/icon-16x16": ICON_16,
  "spotlight/menubar": MENUBAR,
};
