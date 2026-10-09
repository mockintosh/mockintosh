/**
 * Media transport glyphs, 16 × 16, for any app that plays something:
 * `transport/play`, `transport/pause`, `transport/previous`, `transport/next`.
 * Apps reach them with `getSprite`. All four share a centre line (row 7);
 * play and pause are 11 rows tall, previous and next 9, as in Apple's own.
 */
import { fromGrid, type Sprite } from "@mockintosh/ui";

/**
 * The play triangle, 8 wide and 11 tall: it widens by one pixel, then two, in
 * turn, ending on one so the tip is blunt rather than a needle. Its base sits
 * a column right of centre, where a triangle's weight puts it on the centre.
 */
const PLAY = fromGrid(16, 16, [
  "................",
  "................",
  ".....#..........",
  ".....##.........",
  ".....####.......",
  ".....#####......",
  ".....#######....",
  ".....########...",
  ".....#######....",
  ".....#####......",
  ".....####.......",
  ".....##.........",
  ".....#..........",
  "................",
  "................",
  "................",
]);

/** Two bars, 3 wide with 2 between, as tall as play. */
const PAUSE = fromGrid(16, 16, [
  "................",
  "................",
  "....###..###....",
  "....###..###....",
  "....###..###....",
  "....###..###....",
  "....###..###....",
  "....###..###....",
  "....###..###....",
  "....###..###....",
  "....###..###....",
  "....###..###....",
  "....###..###....",
  "................",
  "................",
  "................",
]);

/** Two narrower triangles nose to tail, as Apple Music draws next. */
const NEXT_ROWS = [
  "................",
  "................",
  "................",
  "...#....#.......",
  "...##...##......",
  "...###..###.....",
  "...####.####....",
  "...##########...",
  "...####.####....",
  "...###..###.....",
  "...##...##......",
  "...#....#.......",
  "................",
  "................",
  "................",
  "................",
];

const NEXT = fromGrid(16, 16, NEXT_ROWS);
/** Next, facing back. */
const PREVIOUS = fromGrid(16, 16, NEXT_ROWS.map((row) => [...row].reverse().join("")));

export const transportSprites: Record<string, Sprite> = {
  "transport/play": PLAY,
  "transport/pause": PAUSE,
  "transport/previous": PREVIOUS,
  "transport/next": NEXT,
};
