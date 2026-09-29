/**
 * The cue sheet: when things happen in Hello, shared by the picture and the
 * score so a click is heard on the frame it is seen.
 */

/** The hello window zooms open. */
export const HELLO_OPENS = 4.56;
/** The storm's windows open one after another from here. */
export const STORM_OPEN = 4.62;
export const STORM_GAP = 0.15;
/** Windows fly into the Trash, topmost first. */
export const CLOSE_START = 6.35;
export const CLOSE_GAP = 0.05;

export interface Card {
  at: number;
  text: string;
  font: string;
  size: number;
  inverse: boolean;
  deco?: "dimensions" | "grid";
}

/** Full-screen cards, one per menu item, on a 0.35 s beat. */
export const CARDS: readonly Card[] = [
  {
    at: 7.8,
    text: "512 x 342",
    font: "chicago",
    size: 12,
    inverse: false,
    deco: "dimensions",
  },
  { at: 8.15, text: "One Bit", font: "newYork", size: 24, inverse: true },
  {
    at: 8.5,
    text: "Every Pixel",
    font: "sanFrancisco",
    size: 18,
    inverse: false,
    deco: "grid",
  },
  { at: 8.85, text: "On Purpose", font: "venice", size: 14, inverse: true },
];

/** "Mockintosh" strobes through the system fonts. */
export const FLICKER = ["london", "sanFrancisco", "venice", "athens", "toronto", "newYork", "losAngeles", "geneva", "chicago"] as const;
export const FLICKER_AT = 9.2;
export const FLICKER_STEP = 1 / 15;

/** App icons land in snake order. */
export const LAND_AT = 9.95;
export const LAND_GAP = 0.07;

export const WORDMARK = "Mockintosh";
export const TAGLINE = "The Macintosh that never was.";
