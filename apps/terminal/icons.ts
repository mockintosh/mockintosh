import { fromGrid, type Sprite } from "@mockintosh/sdk";

/** A modern terminal: a rounded black screen in a white bezel with a ">_" prompt, shadowed right and bottom. `#` ink, `o` paper, `.` clear. */
export const APP_ICON: Sprite = fromGrid(32, 32, [
  "................................",
  "................................",
  "....#######################.....",
  "...#ooooooooooooooooooooooo#....",
  "..#ooooooooooooooooooooooooo#...",
  ".#ooo#####################ooo#..",
  ".#oo#######################oo##.",
  ".#oo#######################oo##.",
  ".#oo#######################oo##.",
  ".#oo###oo##################oo##.",
  ".#oo####oo#################oo##.",
  ".#oo#####oo################oo##.",
  ".#oo######oo###############oo##.",
  ".#oo######oo###############oo##.",
  ".#oo#####oo################oo##.",
  ".#oo####oo###ooooooo#######oo##.",
  ".#oo###oo####ooooooo#######oo##.",
  ".#oo#######################oo##.",
  ".#oo#######################oo##.",
  ".#oo#######################oo##.",
  ".#oo#######################oo##.",
  ".#oo#######################oo##.",
  ".#oo#######################oo##.",
  ".#oo#######################oo##.",
  ".#oo#######################oo##.",
  ".#ooo#####################ooo##.",
  "..#ooooooooooooooooooooooooo###.",
  "...#ooooooooooooooooooooooo###..",
  "....#########################...",
  ".....#######################....",
  "................................",
  "................................",
]);

/** The terminal for the application menu: the black screen and its ">_" prompt in 1px strokes. */
export const APP_ICON_16: Sprite = fromGrid(16, 16, [
  "................",
  ".#############..",
  "#ooooooooooooo#.",
  "#o###########o##",
  "#o###########o##",
  "#o##o########o##",
  "#o###o#######o##",
  "#o####o######o##",
  "#o###o#######o##",
  "#o##o##oooo##o##",
  "#o###########o##",
  "#o###########o##",
  "#o###########o##",
  "#ooooooooooooo##",
  ".###############",
  "..#############.",
]);

export const sprites: Record<string, Sprite> = {
  "terminal/icon": APP_ICON,
  "terminal/icon-16x16": APP_ICON_16,
};
