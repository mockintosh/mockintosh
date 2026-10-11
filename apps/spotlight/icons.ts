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

/**
 * The same glass for the application menu and the menubar, without the glint:
 * the lens is QuickDraw's own 10×10 oval (`FrameOval`, inside filled by
 * `PaintOval`), and the handle a 3px staircase down the lens's diagonal, so
 * the icon mirrors across that diagonal.
 */
const ICON_16 = fromGrid(16, 16, [
  "................",
  "....####........",
  "..##oooo##......",
  "..#oooooo#......",
  ".#oooooooo#.....",
  ".#oooooooo#.....",
  ".#oooooooo#.....",
  ".#oooooooo#.....",
  "..#oooooo#......",
  "..##oooo###.....",
  "....####.###....",
  "..........###...",
  "...........###..",
  "............###.",
  ".............##.",
  "................",
]);

/** The search field's glyph: a light outline glass before the text. */
const SEARCH_FIELD = fromGrid(13, 13, [
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
  "spotlight/search-field": SEARCH_FIELD,
};
