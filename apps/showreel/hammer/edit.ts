/**
 * The edit sheet for "A Lot Like 1984": which stretches of the 1984 ad play
 * when, and the timings of everything Mockintosh lays over them. Everything
 * is in reel seconds unless it says "source".
 */
import type { Cut } from "../footage";
import type { ReelFootage } from "../reels";

/** The ad's own rate (29.97, near enough), so every picture of it is shown. */
export const HAMMER_FPS = 30;
export const HAMMER_DURATION = 50;

/**
 * Two cuts: the tube, then one unbroken run from the boots to the windswept
 * audience, so Big Brother's speech and the score are never chopped. It
 * stops before Apple's own "On January 24th" titles and narration.
 */
export const CUTS: readonly Cut[] = [
  { at: 0, range: { from: 0.3, to: 4.3 } },
  { at: 4, range: { from: 11.2, to: 48.9 } },
];

/** Reel time of a moment in the long second cut, given on the source's clock. */
function src(source: number): number {
  const cut = CUTS[1]!;
  return cut.at + source - cut.range.from;
}

export const FOOTAGE: ReelFootage = {
  url: "/1984.mp4",
  ranges: CUTS.map((c) => c.range),
  fps: HAMMER_FPS,
  width: 320,
  height: 180,
  chroma: true,
  sound: true,
};

/** Shots of the ad, where they fall on the reel. */
export const SHOTS = {
  tube: { from: 0, to: 4 },
  boots: { from: 4, to: src(15.96) },
  glimpse: { from: src(15.96), to: src(16.46) },
  hall: { from: src(16.46), to: src(20.17) },
  approach: { from: src(20.17), to: src(22.4) },
  faceOne: { from: src(25.3), to: src(27.45) },
  aisle: { from: src(29.92), to: src(32.79) },
  faceTwo: { from: src(33.79), to: src(37.71) },
  swing: { from: src(37.71), to: src(39.75) },
  faceThree: { from: src(39.75), to: src(41.63) },
  release: { from: src(41.63), to: src(43.21) },
  flight: { from: src(43.21), to: src(45.04) },
  faceLast: { from: src(45.04), to: src(46.08) },
} as const;

/** The hammer hits the screen: the ad's own flash. */
export const IMPACT = src(46.08);
/** Our card takes over from the footage. */
export const CARD_AT = 41.7;

/** Shots the runner is in, where the key may pick her out. */
export const RUNNER_SHOTS = [SHOTS.glimpse, SHOTS.approach, SHOTS.aisle, SHOTS.swing, SHOTS.release] as const;

// —— The feed's alerts, over Big Brother ——————————————————————————————

export interface AlertCue {
  at: number;
  until: number;
  lines: readonly string[];
  buttons: readonly string[];
  /** Cascade step from the first alert of its shot. */
  step: number;
}

export const ALERTS: readonly AlertCue[] = [
  { at: SHOTS.faceOne.from + 0.45, until: SHOTS.faceOne.to, lines: ["Your settings have been updated."], buttons: ["OK"], step: 0 },
  {
    at: SHOTS.faceTwo.from + 0.35,
    until: SHOTS.faceTwo.to,
    lines: ['Allow "Big Brother" to send', "you notifications?"],
    buttons: ["Allow", "Allow"],
    step: 0,
  },
  { at: SHOTS.faceTwo.from + 1.25, until: SHOTS.faceTwo.to, lines: ["Accept all cookies?"], buttons: ["Accept All"], step: 1 },
  {
    at: SHOTS.faceTwo.from + 2.15,
    until: SHOTS.faceTwo.to,
    lines: ["An update to Everything", "is ready to install."],
    buttons: ["Tonight", "Now"],
    step: 2,
  },
  { at: SHOTS.faceTwo.from + 3.0, until: SHOTS.faceTwo.to, lines: ["Sixteen million colours.", "One opinion."], buttons: ["OK"], step: 3 },
];

export interface BannerCue {
  at: number;
  text: string;
}

const BANNER_TEXT = [
  "You have 1,984 unread.",
  "Every pixel a notification.",
  "Your feed missed you.",
  "Trending: Obedience.",
  "Scroll to continue.",
  "Now in 16 million colours.",
  "Nothing is offline.",
  "Accept all. Forever.",
  "Rate your experience.",
  "Big Brother liked this.",
];

/** A flood of notifications, faster and faster, while he rants. */
export const BANNERS: readonly BannerCue[] = BANNER_TEXT.map((text, i) => ({
  at: SHOTS.faceThree.from + 0.15 + 1.5 * (1 - (1 - i / BANNER_TEXT.length) ** 1.6),
  text,
}));
export const BANNERS_UNTIL = SHOTS.faceThree.to;

/** Big Brother, crashed. */
export const CRASH = { at: IMPACT + 0.55, until: CARD_AT - 0.35 } as const;

// —— The card ——————————————————————————————————————————————————————

export const CARD_LINES: readonly (readonly [at: number, until: number, lines: readonly string[]])[] = [
  [CARD_AT + 0.5, CARD_AT + 2.7, ["On September 28th, Mockintosh", "will introduce Mockintosh."]],
  [CARD_AT + 3.0, CARD_AT + 5.2, ["And you'll see why 2026", 'will look a lot like "1984".']],
];
export const LOGO_AT = CARD_AT + 5.5;
export const LOGO_UNTIL = HAMMER_DURATION - 0.8;
