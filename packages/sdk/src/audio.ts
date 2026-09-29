/**
 * Sound output, in the spirit of the Sound Manager's free-form synthesizer:
 * an app opens a stream and fills blocks of samples; the platform plays them.
 *
 * The contract is PCM, not a node graph, so the same app runs wherever there
 * is a speaker — Web Audio in the browser, an I2S DAC on a board, a capture
 * buffer in tests. Synthesis is ordinary TypeScript the app owns.
 */

/**
 * How far ahead of the speaker the OS asks a stream to render.
 *
 * - `interactive` — tens of milliseconds; for instruments played live
 * - `playback`    — a larger cushion; for music that is only listened to
 */
export type AudioLatency = "interactive" | "playback";

/** One block to fill. Every channel arrives zeroed and holds exactly `frames` samples. */
export interface AudioRenderBlock {
  readonly sampleRate: number;
  readonly frames: number;
  /** One array per channel (planar); samples are −1…1. */
  readonly channels: readonly Float32Array[];
  /**
   * The stream frame of the block's first sample: the stream's sample clock,
   * which advances by `frames` every block. Compare it with
   * {@link AudioStream.playbackPosition} to draw in time with the sound.
   */
  readonly position: number;
}

export interface AudioStreamOptions {
  /** 1 or 2 (the default). Mono streams play from both speakers. */
  channels?: 1 | 2;
  /** Default `interactive`. */
  latency?: AudioLatency;
  /**
   * Fill `block`. Called ahead of playback, as the platform needs samples —
   * not on the display's clock — so keep it allocation-free and quick. A
   * throw closes the stream.
   */
  render(block: AudioRenderBlock): void;
}

/**
 * `suspended` until the host lets sound start (on the web, the user's first
 * click or key press), `running` while playing, `closed` after `close`.
 */
export type AudioStreamState = "suspended" | "running" | "closed";

export interface AudioStream {
  readonly sampleRate: number;
  readonly channels: 1 | 2;
  /** Seconds from `render` to the speaker, roughly. */
  readonly latency: number;
  /** The stream frame reaching the speaker now; never ahead of what `render` produced. */
  playbackPosition(): number;
  state(): AudioStreamState;
  /** Returns an unsubscribe function. */
  onStateChange(listener: (state: AudioStreamState) => void): () => void;
  /** Stop rendering and release the output. The OS also closes streams when their app quits. */
  close(): void;
}

/**
 * A tap on the speaker: every stream on this Macintosh, mixed, as it reaches
 * the listener — a meter on the output bus. It holds only the latest moment,
 * so read it on the display's clock. A monitor makes no sound and never
 * keeps the speaker awake.
 */
export interface AudioMonitor {
  readonly sampleRate: number;
  /** The most frames one `read` fills. */
  readonly capacity: number;
  /**
   * Fill `left` and `right` with the frames the listener heard last, oldest
   * first and ending now. Mono streams appear in both. A longer array than
   * `capacity` gets zeros at its start; a silent or suspended speaker reads
   * as zeros throughout.
   */
  read(left: Float32Array, right: Float32Array): void;
  /** Release the tap. The OS also closes monitors when their app quits. */
  close(): void;
}

export interface AudioService {
  /**
   * Open an output stream. It may start `suspended`: on the web sound begins
   * with the user's first click or key press, so opening from one is best.
   */
  open(options: AudioStreamOptions): Promise<AudioStream>;
  /**
   * Listen to everything the speaker plays, every app's streams mixed, for
   * meters and visualizers. Absent on a speaker whose mix can't be read back.
   */
  monitor?(): Promise<AudioMonitor>;
}

/** Equal-tempered frequency of a MIDI note (A4 = 69 = 440 Hz). */
export function midiToFrequency(note: number, a4 = 440): number {
  return a4 * Math.pow(2, (note - 69) / 12);
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/** "C4", "F#2", … — middle C is MIDI 60, C4. */
export function noteName(note: number): string {
  const n = Math.round(note);
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

/**
 * Encode planar float channels as a 16-bit PCM RIFF/WAVE file
 * (`audio/wav`). Samples outside −1…1 are clipped.
 */
export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Uint8Array {
  const count = channels.length;
  if (count === 0) throw new Error("encodeWav needs at least one channel");
  const frames = channels[0]!.length;
  const blockAlign = count * 2;
  const dataBytes = frames * blockAlign;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      const s = Math.max(-1, Math.min(1, channels[c]![i]!));
      view.setInt16(offset, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
      offset += 2;
    }
  }
  return bytes;
}

/** Sound read from a WAVE file: planar channels, −1…1. */
export interface DecodedWav {
  sampleRate: number;
  channels: Float32Array[];
}

/**
 * Decode a RIFF/WAVE file: integer PCM of 8, 16, 24 or 32 bits, or 32-bit
 * float. Returns `null` for anything else, or for bytes that aren't a WAVE file.
 */
export function decodeWav(bytes: Uint8Array): DecodedWav | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.length < 12 || ascii(0) !== "RIFF" || ascii(8) !== "WAVE") return null;
  let format: { tag: number; count: number; sampleRate: number; bits: number } | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = ascii(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt " && size >= 16) {
      let tag = view.getUint16(body, true);
      // WAVE_FORMAT_EXTENSIBLE keeps the real format in its sub-format GUID.
      if (tag === 0xfffe && size >= 26) tag = view.getUint16(body + 24, true);
      format = { tag, count: view.getUint16(body + 2, true), sampleRate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) };
    } else if (id === "data" && format) {
      const { tag, count, sampleRate, bits } = format;
      const width = bits / 8;
      const float = tag === 3 && bits === 32;
      if (count < 1 || sampleRate < 1 || !(float || (tag === 1 && [8, 16, 24, 32].includes(bits)))) return null;
      const frames = Math.floor(Math.min(size, bytes.length - body) / (width * count));
      const channels = Array.from({ length: count }, () => new Float32Array(frames));
      let at = body;
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < count; c++, at += width) {
          let s: number;
          if (float) s = view.getFloat32(at, true);
          else if (bits === 8) s = (bytes[at]! - 128) / 128;
          else if (bits === 16) s = view.getInt16(at, true) / 0x8000;
          else if (bits === 24) s = ((bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16)) << 8 >> 8) / 0x800000;
          else s = view.getInt32(at, true) / 0x80000000;
          channels[c]![i] = s;
        }
      }
      return { sampleRate, channels };
    }
    offset = body + size + (size & 1);
  }
  return null;
}
