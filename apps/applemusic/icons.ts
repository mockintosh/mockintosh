/**
 * Sprites for the Apple Music app. Owned by the app and registered through
 * `SolidApp.sprites`.
 */
import { fromGrid, type Sprite } from "@mockintosh/sdk";

/** Apple Music's beamed pair of notes, cut in paper from a rounded ink tile. `#` ink, `o` paper, `.` clear. */
const ICON_APPLE_MUSIC = fromGrid(32, 32, [
  "................................",
  "......####################......",
  "....########################....",
  "...##########################...",
  "..############################..",
  "..############################..",
  ".######################ooo#####.",
  ".##################ooooooo#####.",
  ".##############ooooooooooo#####.",
  ".############ooooooooooooo#####.",
  ".############ooooooooooooo#####.",
  ".############ooooooo####oo#####.",
  ".############ooo########oo#####.",
  ".############oo#########oo#####.",
  ".############oo#########oo#####.",
  ".############oo#########oo#####.",
  ".############oo#########oo#####.",
  ".############oo#########oo#####.",
  ".############oo#####ooooooo####.",
  ".############oo####oooooooo####.",
  ".#########ooooo###ooooooooo####.",
  ".#######ooooooo###ooooooooo####.",
  ".######oooooooo####ooooooo#####.",
  ".######oooooooo######ooo#######.",
  ".#######ooooooo################.",
  ".#########ooo##################.",
  "..############################..",
  "..############################..",
  "...##########################...",
  "....########################....",
  "......####################......",
  "................................",
]);

/** The 16×16 for the application menu: the tile and the two notes in 1px strokes. */
const ICON_APPLE_MUSIC_16: Sprite = fromGrid(16, 16, [
  "................",
  "..############..",
  ".##############.",
  ".#########oo###.",
  ".#######oooo###.",
  ".#####oooo#o###.",
  ".#####oo###o###.",
  ".#####o####o###.",
  ".#####o####o###.",
  ".#####o####o###.",
  ".#####o####o###.",
  ".###ooo##ooo###.",
  ".##oooo#oooo###.",
  ".###oo###oo####.",
  "..############..",
  "................",
]);

export const sprites: Record<string, Sprite> = {
  "applemusic/icon": ICON_APPLE_MUSIC,
  "applemusic/icon-16x16": ICON_APPLE_MUSIC_16,
};
