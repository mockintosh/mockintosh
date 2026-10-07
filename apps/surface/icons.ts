import { defineSprite, fromGrid, type Sprite } from "@mockintosh/sdk";

/** Rendered by `apps/surface/render.ts`: exp(-1.2r²) on a 6×6 hidden-line mesh. */
export const APP_ICON: Sprite = defineSprite(
  32,
  32,
  "AAAAAqAAAAAAAAAKaAAAAAAAACZYAAAAAAAAmVoAAAAAAAKZVoAAAAAAAllWgAAAAAAKZVWgAAAAABZlVqgAAAAAJqlWaoAAAABZlllmoAAAAaWVmWmaAAAKZZVlWZWAACWVlWlZZaAAlZZVmVZqaAKmVlWWVppYClqqlZWaVloJVlZqVZmWlilZWVZVZZWWaVlZVqapZaWZWVlZWVllZWVZZVlaWllqZWVlWWZWWUipZWVlZpaWoAKlZWVllZIAAAqVZWWlqAAAAKGVlWUgAAAACqWVaoAAAAAACpVYAAAAAAAAJUgAAAAAAAAJYAAAAAAAAAkgAAAAAAAAAoAAAA==",
);

/** The 16×16 for the application menu: the bump's peak and silhouette with the two front mesh ridges and one cross line. */
export const APP_ICON_16: Sprite = fromGrid(16, 16, [
  "................",
  ".......##.......",
  "......#oo#......",
  "......#oo#......",
  ".....#o##o#.....",
  ".....#o##o#.....",
  "....#o####o#....",
  "....#o#oo#o#....",
  "..##o##oo##o##..",
  ".#ooo#oooo#ooo#.",
  "##oo##oooo##oo##",
  ".##o########o##.",
  "..###oooooo###..",
  "...###oooo###...",
  ".....##oo##.....",
  "......####......",
]);

export const sprites: Record<string, Sprite> = {
  "surface/icon": APP_ICON,
  "surface/icon-16x16": APP_ICON_16,
};
