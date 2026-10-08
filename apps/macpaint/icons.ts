/**
 * MacPaint's Finder sprites. Split out of the app so the App Store can show
 * the icon, and existing documents can keep theirs, before the app is installed.
 */
import { fromGrid, type Sprite } from "@mockintosh/sdk";
import { APP_ICON, DOCUMENT_ICON } from "./art";

/** The application diamond and hand, with MacPaint's black brush handle across the top. */
export const APP_ICON_16: Sprite = fromGrid(16, 16, [
  ".......##.......",
  "......####......",
  ".....##oo##.....",
  "....##oo#o##....",
  "...##oo###o##...",
  "..##oo###ooo##..",
  ".##oo###ooooo##.",
  "##o###oo#####o##",
  "##oooooo#ooo####",
  ".##oooo###ooo###",
  "..##oooo#ooo###.",
  "...##ooo#######.",
  "....##oooo##....",
  ".....##oo##.....",
  "......####......",
  ".......##.......",
]);

/** A MacPaint document for 16×16 views: the page, a brush at its left and a splash of paint. */
const DOCUMENT_ICON_16 = fromGrid(16, 16, [
  "..########......",
  "..#oooooo##.....",
  "..#oo#ooo#o#....",
  "..#oo#ooo#oo#...",
  "..#oo#ooo#####..",
  "..#oo#ooooooo#..",
  "..#oo#ooooooo#..",
  "..#o###oooooo#..",
  "..#o###oooooo#..",
  "..#o###oooooo#..",
  "..#oo#ooo##oo#..",
  "..#ooooo####o#..",
  "..#oooo#####o#..",
  "..#ooooo###oo#..",
  "..#oooooooooo#..",
  "..############..",
]);

export const sprites: Record<string, Sprite> = {
  "macpaint/icon": APP_ICON,
  "macpaint/icon-16x16": APP_ICON_16,
  "macpaint/document": DOCUMENT_ICON,
  "macpaint/document-16x16": DOCUMENT_ICON_16,
};
