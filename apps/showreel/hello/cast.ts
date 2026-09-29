/**
 * The film's cast: the machine's own icons, looked up by name through the
 * reel's assets, with the generic application icon standing in for any this
 * machine doesn't have.
 */
import type { Sprite } from "@mockintosh/sdk";
import type { ReelAssets } from "../reels";
import { GENERIC_APP } from "../desktop";

export interface CastApp {
  label: string;
  icon: Sprite;
}

export interface Cast {
  happy: Sprite;
  hd: Sprite;
  trash: Sprite;
  stop: Sprite;
  apps: readonly CastApp[];
}

/** The bundled apps, in the order they parade. */
const APP_ROSTER: readonly (readonly [label: string, sprite: string])[] = [
  ["MacPaint", "macpaint/icon"],
  ["Synthesizer", "synth/icon"],
  ["Showreel", "showreel/icon"],
  ["Photo Booth", "icon/photobooth-smr-32"],
  ["Dither", "dither/icon"],
  ["Surface", "surface/icon"],
  ["Trace", "trace/icon"],
  ["Canvas", "canvas/icon"],
  ["Safari", "icon/safari"],
  ["ChatGippity", "icon/chat"],
  ["App Store", "icon/appstore-smr-32x32"],
  ["Spotify", "icon/spotify"],
  ["1984.mp4", "icon/MacFlim"],
  ["Icon Gallery", "icon-gallery/icon"],
  ["Terminal", "icon/computer"],
];

export function castFrom(assets: ReelAssets): Cast {
  const get = (name: string) => assets.sprite(name) ?? GENERIC_APP;
  return {
    happy: get("icon/happy"),
    hd: get("icon/hd"),
    trash: get("icon/trash"),
    stop: get("icon/stop"),
    apps: APP_ROSTER.map(([label, sprite]) => ({ label, icon: get(sprite) })),
  };
}
