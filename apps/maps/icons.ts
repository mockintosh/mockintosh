import { fromGrid, type Sprite } from "@mockintosh/sdk";

/** A folded street map, its middle panel in shadow, pinned. `#` black, `o` white, `.` clear. */
export const APP_ICON: Sprite = fromGrid(32, 32, [
  "................................",
  "................................",
  "................................",
  "..........###...........ooo..##.",
  ".......####o####......oo###ooo#.",
  "....###ooo##o#o####...o#####oo#.",
  ".###oooooo#o#o#o#o###o##oo###o#.",
  ".#oooooooo##o#o#o#o##o##o####o#.",
  ".#oooooooo#o#o#o#o#o#o#######o#.",
  ".#oooooooo##o#o#o#o##oo#####oo#.",
  ".#oooooooo#o#o#o#o#o#ooo###ooo#.",
  ".#oooooooo##o#o#o#o##ooooooooo#.",
  ".#oooooooo#o#o#o#o#o#oooo#oooo#.",
  ".#oooooooo####o#o#o##oooo#ooo##.",
  ".#ooooo####oo####o#o#oooo#o##o#.",
  ".#oo###ooo#ooooo#####oo#o#oooo#.",
  ".###oooooo###oooooo####oooooo##.",
  ".#ooooo#####o###oooo#ooooo###o#.",
  ".#oo###ooo#o#o#o###o#oo###oooo#.",
  ".###ooo#####o#o#o#o####ooooooo#.",
  ".#oo###ooo#o#o#o#o#o#ooooooooo#.",
  ".###oooo####o#o#o#o##ooooooooo#.",
  ".#oo##oooo#o#o#o#o#o#ooooooooo#.",
  ".###ooo##o##o#o#o#o##ooooooooo#.",
  ".#ooo##ooo###o#o#o#o#oooooooo##.",
  ".##oooo###...###o#o##ooooo###...",
  ".#oo###.........###o#oo###......",
  ".###...............####.........",
  "................................",
  "................................",
  "................................",
  "................................",
]);

/** The folded map for the application menu: the shadowed panel solid, a pin, one road across. */
export const APP_ICON_16: Sprite = fromGrid(16, 16, [
  "................",
  "................",
  "....##........##",
  "..##oo##....##o#",
  "##oooo######ooo#",
  "#ooooo####o###o#",
  "#ooooo####o#o#o#",
  "#ooooo####o###o#",
  "#oooo#####oo#oo#",
  "#oo##o####ooooo#",
  "###ooo####oo####",
  "#ooooo######ooo#",
  "#ooo######oooo##",
  "#o##..####oo##..",
  "##......####....",
  "................",
]);

/** Travel modes for the directions panel, 16 × 11: a car, a walker, a bicycle. */
const CAR = [
  "................",
  "....########....",
  "...#...#....#...",
  "..#....#.....#..",
  ".##############.",
  "#..............#",
  "#.##........##.#",
  "#.##........##.#",
  "################",
  ".###........###.",
  ".###........###.",
];
const WALK = [
  ".......##.......",
  ".......##.......",
  "................",
  "......####......",
  ".....#.##.#.....",
  "....#..##..#....",
  ".......##.......",
  "......#..#......",
  "......#..#......",
  ".....#....#.....",
  "....##....##....",
];
const BIKE = [
  "................",
  "..........###...",
  ".....###...#....",
  "......######....",
  "..####.#..####..",
  ".#...#.#..#.#.#.",
  "#...#.#.##..#..#",
  "#..#######..#..#",
  "#.....#..#.....#",
  ".#...#....#...#.",
  "..###......###..",
];
/** Swap the start and the end. */
const SWAP = [
  "..#......",
  ".###.....",
  "#.#.#....",
  "..#......",
  "..#...#..",
  "..#...#..",
  "......#..",
  "....#.#.#",
  ".....###.",
  "......#..",
];
/** The start of a route, as the map rings it, and its end, as the pin's head. */
const START = [
  "..#####..",
  ".##ooo##.",
  "##ooooo##",
  "#ooooooo#",
  "#ooooooo#",
  "#ooooooo#",
  "##ooooo##",
  ".##ooo##.",
  "..#####..",
];
const END = [
  "..#####..",
  ".#######.",
  "###ooo###",
  "##ooooo##",
  "##ooooo##",
  "##ooooo##",
  "###ooo###",
  ".#######.",
  "..#####..",
];

/** Show a route's steps: an i in a circle, 11 × 11. */
const INFO = [
  "...#####...",
  "..#.....#..",
  ".#...#...#.",
  "#.........#",
  "#...##....#",
  "#....#....#",
  "#....#....#",
  "#...###...#",
  ".#.......#.",
  "..#.....#..",
  "...#####...",
];
/** Back to the routes, 5 × 9. */
const BACK = [
  "....#",
  "...#.",
  "..#..",
  ".#...",
  "#....",
  ".#...",
  "..#..",
  "...#.",
  "....#",
];

/** Close a panel: a thin X, 7 × 7, like Safari's tab close. */
const CLOSE = [
  "#.....#",
  ".#...#.",
  "..#.#..",
  "...#...",
  "..#.#..",
  ".#...#.",
  "#.....#",
];
/**
 * The search field's magnifying glass, 11 × 10: the 8-pixel lens, its
 * handle a two-pixel diagonal leaving from the lens's lower-right corner.
 */
const SEARCH = [
  "..####.....",
  ".#....#....",
  "#......#...",
  "#......#...",
  "#......#...",
  "#......#...",
  ".#....#....",
  "..####.##..",
  "........##.",
  ".........##",
];

const grid = (rows: string[]): Sprite => fromGrid(rows[0]!.length, rows.length, rows);
/** White on black, for a selected segment. */
const inverted = (rows: string[]): Sprite => grid(rows.map((row) => row.replace(/#/g, "o")));

export const sprites: Record<string, Sprite> = {
  "maps/icon": APP_ICON,
  "maps/icon-16x16": APP_ICON_16,
  "maps/car": grid(CAR),
  "maps/car-selected": inverted(CAR),
  "maps/foot": grid(WALK),
  "maps/foot-selected": inverted(WALK),
  "maps/bike": grid(BIKE),
  "maps/bike-selected": inverted(BIKE),
  "maps/swap": grid(SWAP),
  "maps/start": grid(START),
  "maps/end": grid(END),
  "maps/info": grid(INFO),
  "maps/info-selected": inverted(INFO),
  "maps/back": grid(BACK),
  "maps/close": grid(CLOSE),
  "maps/close-pressed": inverted(CLOSE),
  "maps/search": grid(SEARCH),
};
