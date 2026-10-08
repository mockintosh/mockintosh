import { fromGrid, type Sprite } from "@mockintosh/sdk";

/** A landscape photo over a second one, with a loupe at its lower right, after the modern Preview icon. `#` ink, `o` paper, `.` clear. */
export const APP_ICON: Sprite = fromGrid(32, 32, [
  "................................",
  "........#######################.",
  "........#ooooooooooooooooooooo#.",
  "........#ooooooooooooooooooooo#.",
  "........#ooooooooooooooooooooo#.",
  "........#ooooooooooooooooooooo#.",
  ".#######################oooooo#.",
  ".#ooooooooooooooooooooo#oooooo#.",
  ".#ooooooooooooooooooooo#oooooo#.",
  ".#oooooooooooooo####ooo#oooooo#.",
  ".#oooooooooooooo####ooo#oooooo#.",
  ".#oooooooooooooo####ooo#oooooo#.",
  ".#oooooooooooooo####ooo#oooooo#.",
  ".#ooooooooooooooooooooo#oooooo#.",
  ".#ooooooo#ooooooooooooo#oooooo#.",
  ".#oooooo###oooooooooooo#oooooo#.",
  ".#oooooo###ooooooooo######oooo#.",
  ".#ooooo#####ooooooo########ooo#.",
  ".#oooo#######ooooo###oooo###oo#.",
  ".#oooo#######ooo###oooooooo####.",
  ".#ooo#########o####o##ooooo###..",
  ".#ooo#########o###oo#ooooooo##..",
  ".#oo##############oooooooooo##..",
  ".#o###############oooooooooo##..",
  ".#o###############oooooooooo##..",
  ".##################oooooooo###..",
  ".##################oooooooo##...",
  "..................###oooo####...",
  "...................###########..",
  "....................######..###.",
  ".............................##.",
  "................................",
]);

/** The photo, its mountain and sun, and the loupe, for the application menu. */
export const APP_ICON_16: Sprite = fromGrid(16, 16, [
  "....############",
  "....#oooooooooo#",
  "....#oooooooooo#",
  "############ooo#",
  "#oooooooooo#ooo#",
  "#oooooo##oo#ooo#",
  "#oooooo##oo#ooo#",
  "#oooooooooo#ooo#",
  "#ooo#ooooo###oo#",
  "#oo###ooo#ooo###",
  "#oo###oo#ooooo#.",
  "#o#####o#ooooo#.",
  "#o#####o#ooooo#.",
  "########o#ooo#..",
  "#############.##",
  "..............##",
]);

export const sprites: Record<string, Sprite> = {
  "preview/icon": APP_ICON,
  "preview/icon-16x16": APP_ICON_16,
};
