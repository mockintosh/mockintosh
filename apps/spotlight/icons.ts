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

/** The light outline glass: the search field's glyph, and the menubar's icon. */
const GLASS = [
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
];

/** The search field's glyph, before the text. */
const SEARCH_FIELD = fromGrid(13, 13, GLASS);

/** The same pixels on a 16×16 canvas, for the menubar and the application menu: a pixel in from the top left. */
const ICON_16 = fromGrid(16, 16, [
  "................",
  ...GLASS.map((row) => `.${row}..`),
  "................",
  "................",
]);

export const sprites: Record<string, Sprite> = {
  "spotlight/icon": ICON,
  "spotlight/icon-16x16": ICON_16,
  "spotlight/search-field": SEARCH_FIELD,
};
