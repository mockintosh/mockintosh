import { defineSprite, fromGrid, type Sprite } from "@mockintosh/sdk";

/**
 * Adobe Type Manager 4.0.2 installer ICN# 6208 — Mac OS 8 catalog.
 * Serif “A” in a rounded square; the catalogs have no suitcase / FONT ICN#.
 */
export const APP_ICON: Sprite = defineSprite(
  32,
  32,
  "VVVVVVVVVVWqqqqqqqqqqlVVVVVVVVVVqqqqqqqqqqpVVVVVVVWVlaqqqqqqqlWqVVVVVVVZVZWqqqqqqqVVqlVVVVVVlVWVqqqqqqpVVapVVVVVWVVVlaqqqqqlVVWqVVVVVZVVVZWqqqqqVVVVqlVVVVlVWVWVqqqqpVVpVapVVVWVVZlVlaqqqlVWqVWqVVVZVVlZVZWqqqVVaqlVqlVVlVVVVVWVqqpVVVVVVapVWVVVVVVVlaqlVWqqqVWqVZVVlVVZVZWqVVaqqqlVqllVWVVVWVWVpVVqqqqpVaqVVZVVVVlVlaqqqqqqqqqqVVVVVVVVVVWqqqqqqqqqqg==",
);

/** The 16×16 for the application menu: the white A as an outlined set square on the stripes, with its counter and crossbar. */
export const APP_ICON_16: Sprite = fromGrid(16, 16, [
  ".oooooooooo#ooo.",
  "############o###",
  "ooooooooo#o#oooo",
  "##########o#o###",
  "oooooooo#oo#oooo",
  "########ooo#o###",
  "oooooo#oo#o#oooo",
  "#######o##o#o###",
  "ooooo#oo##o#oooo",
  "#####oo###o#o###",
  "ooo#ooooooo#oooo",
  "###oooooooo#o###",
  "oo#o########oooo",
  "##ooooooooo#o###",
  "############oooo",
  "################",
]);

export const sprites: Record<string, Sprite> = {
  "foundry/icon": APP_ICON,
  "foundry/icon-16x16": APP_ICON_16,
};
