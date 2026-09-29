/**
 * The Keeper: a silent short in one continuous shot. The camera looks up at
 * the moon, tilts down to the lighthouse, sinks under the waves past a whale,
 * and rises back into the beam, which flares the picture out to the last card.
 *
 * Animated on twos — twelve drawings a second — so the lines boil the way
 * they do on paper; the player's 24 fps timecode just sees every drawing twice.
 */
import { easeInCubic, easeInOutCubic, easeOutCubic, hash, lerp, seg } from "../ease";
import { Painter, fitStage, stageRect, type Frame, type Stage } from "../painter";
import type { ReelChapter, ReelDefinition, ReelPlayer } from "../reels";
import { finCard, titleCard } from "./cards";
import { filmPass } from "./film";
import { keeperScore } from "./score";
import { paintWorld, type Beam, type Camera } from "./world";

export const KEEPER_DURATION = 15;
export const KEEPER_FPS = 24;
/** Drawings per second. */
const DRAWINGS = 12;

export const KEEPER_CHAPTERS: readonly ReelChapter[] = [
  { number: 1, title: "Title Card", start: 0, end: 2.3 },
  { number: 2, title: "Moonrise", start: 2.3, end: 5.4 },
  { number: 3, title: "Lighthouse", start: 5.4, end: 7 },
  { number: 4, title: "Below", start: 7, end: 10.8 },
  { number: 5, title: "The Beam", start: 10.8, end: 13 },
  { number: 6, title: "Fin", start: 13, end: KEEPER_DURATION },
];

const MOON_VIEW = -148;
const LIGHTHOUSE_VIEW = -46;
const DEEP_VIEW = 100;

/** The one camera move, as a world point at the stage centre. */
function cameraAt(t: number): Camera {
  let y = MOON_VIEW + seg(t, 0, 3.3) * 6;
  y = lerp(y, LIGHTHOUSE_VIEW, easeInOutCubic(seg(t, 3.3, 5.4)));
  y = lerp(y, DEEP_VIEW, easeInOutCubic(seg(t, 7, 8.9)));
  y = lerp(y, LIGHTHOUSE_VIEW, easeInOutCubic(seg(t, 10.8, 12.4)));
  // A slow hand-cranked drift, and a push toward the lamp at the end.
  // Below, it slides off the rock into open water and back.
  const drift = 160 + 9 * Math.sin(t * 0.35);
  const open = easeInOutCubic(seg(t, 7, 8.9)) - easeInOutCubic(seg(t, 10.8, 12.4));
  const x = drift + open * 80 + lerp(0, -58, easeInOutCubic(seg(t, 11.2, 12.9)));
  return { x, y };
}

/** The lamp turns: we see it swing right, fade as it faces away, swing left… then turn to us. */
function beamAt(t: number): Beam {
  // Full on, pointing right, while the lighthouse holds the frame.
  const turn = (t - 6.1) * 1.15;
  const c = Math.cos(turn);
  const facing = easeInCubic(seg(t, 11.9, 12.9));
  return {
    angle: c >= 0 ? 0.03 : Math.PI - 0.03,
    intensity: Math.max(Math.pow(Math.abs(c), 0.7), facing),
    spread: lerp(0.12 + 0.14 * (1 - Math.abs(c)), Math.PI / 2, facing),
  };
}

/** Where the picture starts and ends: an iris onto the title, and closing on the last card. */
function irisAt(t: number): number {
  if (t < 1) return lerp(0, 200, easeOutCubic(seg(t, 0.08, 0.85)));
  if (t > 14) return lerp(200, 0, easeInOutCubic(seg(t, 14.2, 14.92)));
  return Infinity;
}

class KeeperPlayer implements ReelPlayer {
  private cache: Frame | null = null;
  private cacheKey = "";

  render(frame: Frame, time: number): void {
    const t = ((time % KEEPER_DURATION) + KEEPER_DURATION) % KEEPER_DURATION;
    // Frame times like 62/24 land a hair under their drawing in floating point.
    const exposure = Math.floor(t * DRAWINGS + 1e-6);
    const key = `${exposure}:${frame.width}x${frame.height}`;
    if (this.cache && key === this.cacheKey) {
      frame.pixels.set(this.cache.pixels);
      return;
    }
    paintKeeperFrame(frame, exposure / DRAWINGS, exposure);
    this.cache ??= { width: 0, height: 0, pixels: new Uint8Array(0) };
    if (this.cache.pixels.length !== frame.pixels.length) this.cache.pixels = new Uint8Array(frame.pixels.length);
    this.cache.pixels.set(frame.pixels);
    this.cacheKey = key;
  }
}

/** One drawing of the film, at `t` held to its exposure. */
function paintKeeperFrame(frame: Frame, t: number, exposure: number): void {
  const fitted = fitStage(frame.width, frame.height);
  const rect = stageRect(fitted);
  // Gate weave: the whole picture shifts a hair from exposure to exposure.
  const stage: Stage = {
    ...fitted,
    x: fitted.x + (hash(exposure, 51) - 0.5) * 0.9 * fitted.scale,
    y: fitted.y + (hash(exposure, 52) - 0.5) * 0.9 * fitted.scale,
  };
  frame.pixels.fill(1);
  const p = new Painter(frame, stage, rect);
  const flicker = (hash(exposure, 53) - 0.5) * 0.07;

  if (t < 1.6) {
    titleCard(p, t, exposure);
    filmPass(frame, stage, rect, { exposure, iris: irisAt(t), vignette: true });
    return;
  }
  if (t >= 13) {
    finCard(p, t - 13, exposure);
    filmPass(frame, stage, rect, { exposure, iris: irisAt(t), vignette: true });
    return;
  }

  // The card's ink gives way to the night as the world is engraved in.
  const engrave = easeInOutCubic(seg(t, 1.6, 2.3));
  // The beam turns to camera and burns the picture out to white paper.
  const flare = easeInCubic(seg(t, 12.2, 12.95));
  paintWorld(frame, stage, rect, {
    t,
    exposure,
    camera: cameraAt(t),
    beam: beamAt(t),
    flicker,
    ink: Math.min(engrave, 1 - flare),
  });
  if (t < 2.3) {
    // The title's letters linger, then crumble away.
    const card = new Uint8Array(frame.pixels.length).fill(0);
    const cardFrame: Frame = { width: frame.width, height: frame.height, pixels: card };
    titleCard(new Painter(cardFrame, stage, rect), 1.6, exposure);
    for (let y = rect.y0; y < rect.y1; y++) {
      for (let x = rect.x0; x < rect.x1; x++) {
        const i = y * frame.width + x;
        if (card[i] && hash(x >> 1, (y >> 1) * 7 + 3) > engrave) frame.pixels[i] = 1;
      }
    }
  }
  filmPass(frame, stage, rect, { exposure, iris: Infinity, vignette: false });
}

/** Reel two: engraved, lyrical, one continuous shot on twos. */
export const KEEPER_REEL: ReelDefinition = {
  id: "keeper",
  title: "The Keeper",
  duration: KEEPER_DURATION,
  fps: KEEPER_FPS,
  chapters: KEEPER_CHAPTERS,
  createPlayer: () => new KeeperPlayer(),
  createSoundtrack: keeperScore,
};
