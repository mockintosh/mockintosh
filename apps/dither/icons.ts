import { defineSprite, fromGrid, type Sprite } from "@mockintosh/sdk";

/**
 * HyperCard "Scanned Art2" ICON — System 7.5.3 catalog, Icon Gallery
 * "ICON 32 / Scanned Art".
 */
export const APP_ICON: Sprite = defineSprite(
  32,
  32,
  "qqqqqqqqqqqqqqqqmqVVVqqpqpqpqlVWqqqqqmqapVaqqqpqpqqpVqqqqqqqaqpaqpqpVqWppWqqqqllpVqlqqqqalVpVpWmqqqmlVVVlaqqmqlVVVVlmqqpqmVVWlWqqqqmlVVVlaaqqqpVVWVlaqqqWmlWWmWqpqmmlVallZqqmqqWWqWVaqmqWWVZqlVqqmpqZVqqqWaqpaZWWqqpqqmqqVVVqaqqqpqZZaWpqpqqqalqppaaqqaqqVaqVqqqqpqllVZqaaqpqqWaVWqqpqqqmlqpmqaqqmmlpqqpqqqqqqVVVqqqapqqmlVaamqmqmmpZVqqqqqqqqqqqqqqqg==",
);

/** The scanned portrait: the pale figure on its black field, a few dither specks, rounded corners. */
export const APP_ICON_16: Sprite = fromGrid(16, 16, [
  ".##############.",
  "###########oooo#",
  "############ooo#",
  "#####ooo#oo##o##",
  "##o###oooooooo##",
  "######oooooooo##",
  "######oooooooo##",
  "######oooooooo##",
  "######ooo##oooo#",
  "######ooo####o##",
  "###o#ooooo#o####",
  "#####oo###oo####",
  "#####oooooo##o##",
  "##o##oo#########",
  "#####oooo#######",
  ".##############.",
]);

export const sprites: Record<string, Sprite> = {
  "dither/icon": APP_ICON,
  "dither/icon-16x16": APP_ICON_16,
};
