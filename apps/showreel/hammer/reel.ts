/**
 * "A Lot Like 1984": the 1984 ad itself, re-cut and dithered to one bit,
 * with Mockintosh taking over its screens — the feed's alerts pile up on Big
 * Brother, the runner is selected in marching ants, and when the hammer
 * lands his system crashes and the card is ours.
 */
import type { Sprite, VideoExcerpt, VideoPicture } from "@mockintosh/sdk";
import { hash, seg } from "../ease";
import { PictureDither, editAt, keyBox, pictureAt, type EditPoint, type Grade, type KeyBox } from "../footage";
import { Painter, fitStage, stageRect, type Frame, type Stage } from "../painter";
import type { ReelAssets, ReelChapter, ReelDefinition, ReelPlayer } from "../reels";
import { Screen } from "../screen";
import { CARD_AT, CUTS, FOOTAGE, HAMMER_DURATION, HAMMER_FPS, IMPACT, RUNNER_SHOTS, SHOTS } from "./edit";
import { alerts, awaitingFootage, banners, card, crash, marquee, shatter } from "./overlays";
import { hammerScore } from "./score";

export const HAMMER_CHAPTERS: readonly ReelChapter[] = [
  { number: 1, title: "The Tube", start: 0, end: SHOTS.hall.from },
  { number: 2, title: "Big Brother", start: SHOTS.hall.from, end: SHOTS.aisle.from },
  { number: 3, title: "The Runner", start: SHOTS.aisle.from, end: SHOTS.release.from },
  { number: 4, title: "The Hammer", start: SHOTS.release.from, end: IMPACT },
  { number: 5, title: "Impact", start: IMPACT, end: CARD_AT },
  { number: 6, title: "Introducing", start: CARD_AT, end: HAMMER_DURATION },
];

/** The ad is dark and blue-grey; open it up so the dither has something to hold. */
const GRADE: Grade = { black: 0.05, white: 0.82, gamma: 0.95 };

/** Her red shorts: strongly red, and not blue. */
const isShorts = (cb: number, cr: number) => cr > 158 && cb < 122;

/** Pictures either side averaged into the runner's box, so the ants don't jitter. */
const KEY_SPREAD = 4;

/** Up from black at the start, down to black for the card. */
function exposureAt(t: number): number {
  return Math.min(seg(t, 0, 0.8), 1 - seg(t, CARD_AT - 0.5, CARD_AT));
}

/** The picture judders for a moment when the hammer lands. */
function shaken(stage: Stage, t: number, exposure: number): Stage {
  const k = 1 - seg(t, IMPACT, IMPACT + 0.6);
  if (t < IMPACT || k <= 0) return stage;
  const jolt = 6 * k * stage.scale;
  return { ...stage, x: stage.x + (hash(exposure, 91) - 0.5) * jolt, y: stage.y + (hash(exposure, 92) - 0.5) * jolt };
}

/** Holds each frame, so a 60 Hz display doesn't redraw it. */
class HammerPlayer implements ReelPlayer {
  private readonly happy: Sprite | undefined;
  private readonly stop: Sprite | undefined;
  private readonly bomb: Sprite | undefined;
  private readonly footage: VideoExcerpt | undefined;
  private readonly dither = new PictureDither();
  private readonly keys = new Map<VideoPicture, KeyBox | null>();
  private cache: Uint8Array | null = null;
  private cacheKey = "";

  constructor(assets: ReelAssets) {
    this.happy = assets.sprite("icon/happy");
    this.stop = assets.sprite("icon/stop");
    this.bomb = assets.sprite("showreel/bomb") ?? this.stop;
    this.footage = assets.footage;
  }

  render(frame: Frame, time: number): void {
    const t = ((time % HAMMER_DURATION) + HAMMER_DURATION) % HAMMER_DURATION;
    const exposure = Math.floor(t * HAMMER_FPS + 1e-6);
    const key = `${exposure}:${frame.width}x${frame.height}`;
    if (this.cache && key === this.cacheKey) {
      frame.pixels.set(this.cache);
      return;
    }
    this.paint(frame, exposure / HAMMER_FPS, exposure);
    if (this.cache?.length !== frame.pixels.length) this.cache = new Uint8Array(frame.pixels.length);
    this.cache.set(frame.pixels);
    this.cacheKey = key;
  }

  private paint(frame: Frame, t: number, exposure: number): void {
    frame.pixels.fill(1);
    const stage = fitStage(frame.width, frame.height);
    const clip = stageRect(stage);
    const p = new Painter(frame, stage, clip);
    const sc = new Screen(frame, stage, clip);
    if (t >= CARD_AT) return card(p, sc, t, this.happy);

    const footage = this.footage;
    const point = editAt(CUTS, t);
    if (!footage || !point) return awaitingFootage(sc);
    const picture = pictureAt(footage, point);
    if (!picture) return awaitingFootage(sc);
    this.dither.draw(frame, shaken(stage, t, exposure), clip, footage, picture, { ...GRADE, exposure: exposureAt(t) });

    const runner = this.runnerAt(footage, point, t);
    if (runner) marquee(sc, runner, Math.floor(t * 12));
    alerts(sc, t, this.stop);
    banners(sc, t);
    shatter(p, t);
    crash(sc, t, this.bomb);
  }

  private shortsIn(footage: VideoExcerpt, picture: VideoPicture): KeyBox | null {
    let box = this.keys.get(picture);
    if (box === undefined) {
      box = keyBox(footage, picture, isShorts);
      this.keys.set(picture, box);
    }
    return box;
  }

  /** The runner's whole figure, grown from where her shorts are, in the shots she's in. */
  private runnerAt(footage: VideoExcerpt, point: EditPoint, t: number): KeyBox | null {
    if (!RUNNER_SHOTS.some((s) => t >= s.from && t < s.to)) return null;
    let n = 0;
    const sum = { x0: 0, y0: 0, x1: 0, y1: 0, area: 0 };
    for (let step = -KEY_SPREAD; step <= KEY_SPREAD; step++) {
      const picture = pictureAt(footage, point, step);
      const box = picture && this.shortsIn(footage, picture);
      if (!box) continue;
      n++;
      sum.x0 += box.x0;
      sum.y0 += box.y0;
      sum.x1 += box.x1;
      sum.y1 += box.y1;
      sum.area += box.area;
    }
    if (n < 2 || !this.shortsIn(footage, pictureAt(footage, point)!)) return null;
    const x0 = sum.x0 / n;
    const x1 = sum.x1 / n;
    const y0 = sum.y0 / n;
    const y1 = sum.y1 / n;
    const h = y1 - y0;
    const half = Math.max((x1 - x0) * 0.8, h * 0.85);
    const cx = (x0 + x1) / 2;
    return { x0: cx - half, x1: cx + half, y0: y0 - h * 2.3, y1: y1 + h * 1.9, area: sum.area / n };
  }
}

/** Reel four: Mockintosh introduced the way the Macintosh was — in the very same footage. */
export const HAMMER_REEL: ReelDefinition = {
  id: "hammer",
  title: "A Lot Like 1984",
  duration: HAMMER_DURATION,
  fps: HAMMER_FPS,
  chapters: HAMMER_CHAPTERS,
  footage: FOOTAGE,
  createPlayer: (assets) => new HammerPlayer(assets),
  createSoundtrack: (assets) => hammerScore(assets.footage),
};
