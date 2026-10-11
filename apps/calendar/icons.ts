/**
 * Sprites for the Calendar app. Owned by the app and registered through
 * `SolidApp.sprites`. `#` ink, `o` paper, `.` clear.
 */
import { fromGrid, type Sprite } from "@mockintosh/sdk";

/** A desk calendar's page on its rings: the month across the top, the day below. */
const ICON = fromGrid(32, 32, [
  "................................",
  ".......##.............##........",
  ".......##.............##........",
  "...#########################....",
  "..############################..",
  "..#####oo#ooo#ooo#ooo#oo######..",
  "..#####oo#o#o#o####o##oo######..",
  "..########o#o#o####o##########..",
  "..########o#o#o####o##########..",
  "..########ooo#ooo##o##########..",
  "..############################..",
  "..#ooooooooooooooooooooooooo##..",
  "..#ooooooooooooooooooooooooo##..",
  "..#ooooooooooooooooooooooooo##..",
  "..#ooooooo##oooo#######ooooo##..",
  "..#oooooo###oooo#######ooooo##..",
  "..#ooooo####ooooooooo##ooooo##..",
  "..#ooooooo##oooooooo##oooooo##..",
  "..#ooooooo##oooooooo##oooooo##..",
  "..#ooooooo##ooooooo##ooooooo##..",
  "..#ooooooo##ooooooo##ooooooo##..",
  "..#ooooooo##oooooo##oooooooo##..",
  "..#ooooooo##oooooo##oooooooo##..",
  "..#ooooooo##oooooo##oooooooo##..",
  "..#ooooo######oooo##oooooooo##..",
  "..#ooooooooooooooooooooooooo##..",
  "..#ooooooooooooooooooooooooo##..",
  "..#ooooooooooooooooooooooooo##..",
  "...###########################..",
  "....#########################...",
  "................................",
  "................................",
]);

/** The 16×16 for the application menu: the page, its rings, and the day. */
const ICON_16: Sprite = fromGrid(16, 16, [
  "....#.....#.....",
  "....#.....#.....",
  "..###########...",
  ".###o#####o####.",
  ".##############.",
  ".##############.",
  ".#ooooooooooo##.",
  ".#ooo#oo###oo##.",
  ".#oo##oooo#oo##.",
  ".#ooo#oooo#oo##.",
  ".#ooo#ooo#ooo##.",
  ".#ooo#ooo#ooo##.",
  ".#ooo#ooo#ooo##.",
  "..#############.",
  "...###########..",
  "................",
]);

/** The toolbar's Previous and Next, drawn at the height of a button label. */
const PREVIOUS = fromGrid(5, 7, [
  "...##",
  "..##.",
  ".##..",
  "##...",
  ".##..",
  "..##.",
  "...##",
]);

const NEXT = fromGrid(5, 7, [
  "##...",
  ".##..",
  "..##.",
  "...##",
  "..##.",
  ".##..",
  "##...",
]);

export const sprites: Record<string, Sprite> = {
  "calendar/icon": ICON,
  "calendar/icon-16x16": ICON_16,
  "calendar/previous": PREVIOUS,
  "calendar/next": NEXT,
};
