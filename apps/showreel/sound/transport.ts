/**
 * The transport ties reel time to the audio stream's sample clock. Play,
 * pause and seek take effect from the next block the stream renders; the
 * picture reads the time back at the frame the listener is hearing, so what
 * you see is what you hear rather than what was rendered ahead.
 */
import type { AudioRenderBlock } from "@mockintosh/sdk";
import type { ReelSoundtrack } from "../reels";

/** From stream frame `frame` on, the reel plays (or holds) from `time`. */
interface Cue {
  frame: number;
  time: number;
  playing: boolean;
}

export interface TransportTime {
  time: number;
  /** A non-looping reel has played past its end. */
  ended: boolean;
}

/** Headroom before the soft clipper, so a dense mix bends instead of cracking. */
const MASTER = 0.8;
const KEPT_CUES = 16;

export class Transport {
  private readonly cues: Cue[] = [];
  /** The next stream frame `render` will produce. */
  private head = 0;
  muted = false;

  constructor(
    readonly sampleRate: number,
    public duration: number,
    public looping = true,
  ) {}

  /** Play or hold from `time`, starting with the next rendered block. */
  cue(time: number, playing: boolean): void {
    const last = this.cues[this.cues.length - 1];
    if (last && last.frame === this.head) {
      last.time = time;
      last.playing = playing;
      return;
    }
    this.cues.push({ frame: this.head, time, playing });
    if (this.cues.length > KEPT_CUES) this.cues.shift();
  }

  /**
   * The reel time the listener hears at stream frame `frame`. Until the sound
   * reaches the newest cue the picture holds at that cue, so a seek shows at
   * once and a start waits for its first sound.
   */
  timeAt(frame: number): TransportTime {
    const cue = this.cues[this.cues.length - 1];
    if (!cue) return { time: 0, ended: false };
    const raw = cue.playing && frame > cue.frame ? cue.time + (frame - cue.frame) / this.sampleRate : cue.time;
    return this.wrap(raw);
  }

  /** Fill `block` with the soundtrack at the times the cues put there. */
  render(block: AudioRenderBlock, soundtrack: ReelSoundtrack | null): void {
    const { position, frames, channels } = block;
    const sr = block.sampleRate;
    this.head = position + frames;
    let cue: Cue | undefined;
    for (const c of this.cues) if (c.frame <= position) cue = c;
    if (!cue || !cue.playing || this.muted || !soundtrack) return;

    const halfSample = 0.5 / sr;
    let i = 0;
    while (i < frames) {
      // Measured from the cue in whole frames each time, so rounding never accumulates.
      const t = cue.time + (position + i - cue.frame) / sr;
      let local = t;
      if (this.looping) {
        local = wrapTime(t, this.duration);
        if (this.duration - local < halfSample) local = 0;
      } else if (t >= this.duration - halfSample) break;
      const n = Math.min(frames - i, Math.max(1, Math.round((this.duration - local) * sr)));
      soundtrack.render(channels, i, n, local, sr);
      i += n;
    }
    for (const ch of channels) {
      for (let k = 0; k < frames; k++) {
        const x = Math.max(-1, Math.min(1, ch[k]! * MASTER));
        ch[k] = 1.5 * x - 0.5 * x * x * x;
      }
    }
  }

  private wrap(raw: number): TransportTime {
    if (this.looping)
      return {
        time: ((raw % this.duration) + this.duration) % this.duration,
        ended: false,
      };
    if (raw >= this.duration) return { time: this.duration, ended: true };
    return { time: raw, ended: false };
  }
}

/** `t` folded into 0…duration; exact for times already inside. */
function wrapTime(t: number, duration: number): number {
  return t - Math.floor(t / duration) * duration;
}
