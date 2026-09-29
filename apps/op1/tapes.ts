/**
 * Tapes, the way the OP-1 field keeps several and switches between them.
 * One tape is on the machine at a time: a demo, bounced from its song; one
 * of the user's, read from its file; or a new, blank one. Demos can be
 * played and recorded over, but they are only kept under a name of the
 * user's own.
 *
 * A kept tape is one WAVE file in the app's storage, `<name>.tape.wav`: the
 * four tracks as four channels of 16-bit sound — at half level, so
 * overdubs that build past full scale survive — with the tape and mixer
 * settings in an `op1t` chunk that other players skip. Any audio app can
 * open it.
 */
import { decodeWav, encodeWav, readWavChunk, setWavChunk } from "@mockintosh/sdk";
import { defaultQuad, sanitizeQuad, type Quad } from "./params";
import { bounceSong, songLevels, songPans, songTapeSettings, type Song } from "./song";
import { DEMO_SONGS } from "./songs";
import { MIXER_DEFS, PAN_DEFS, TAPE_DEFS, TAPE_TRACKS } from "./tape";

/** What the tape and mixer pages are set to; it goes with the tape. */
export interface TapeMix {
  settings: Quad;
  levels: Quad;
  pans: Quad;
}

/** What is on a tape. */
export interface TapeContents {
  mix: TapeMix;
  /** Per track, what is recorded from the start of the tape; null for a blank track. */
  tracks: readonly (Float32Array | null)[];
  sampleRate: number;
}

/** Which tape is on the machine. */
export type TapeRef = { kind: "demo"; name: string } | { kind: "saved"; name: string } | { kind: "new" };

export const DEMO_NAMES: readonly string[] = DEMO_SONGS.map((song) => song.name);
/** The tape the OP-1 starts with. */
export const DEFAULT_TAPE: TapeRef = { kind: "demo", name: DEMO_SONGS[0]!.name };
export const UNTITLED_TAPE = "Untitled Tape";
export const MAX_TAPE_NAME = 31;

export const TAPE_SUFFIX = ".tape.wav";
const CHUNK = "op1t";
/** Tracks are kept at 1/HEADROOM of their level. */
const HEADROOM = 2;

export function defaultMix(): TapeMix {
  return { settings: defaultQuad(TAPE_DEFS), levels: defaultQuad(MIXER_DEFS), pans: defaultQuad(PAN_DEFS) };
}

export function sameMix(a: TapeMix, b: TapeMix): boolean {
  const same = (x: Quad, y: Quad) => x.every((v, i) => v === y[i]);
  return same(a.settings, b.settings) && same(a.levels, b.levels) && same(a.pans, b.pans);
}

export function tapeName(ref: TapeRef): string {
  return ref.kind === "new" ? UNTITLED_TAPE : ref.name;
}

export function blankTape(sampleRate: number): TapeContents {
  return { mix: defaultMix(), tracks: Array.from({ length: TAPE_TRACKS }, () => null), sampleRate };
}

/** A demo song bounced onto a tape, with its mix. */
export function demoTape(song: Song, sampleRate: number): TapeContents {
  const tracks: (Float32Array | null)[] = bounceSong(song, sampleRate);
  while (tracks.length < TAPE_TRACKS) tracks.push(null);
  return { mix: { settings: songTapeSettings(song), levels: songLevels(song), pans: songPans(song) }, tracks, sampleRate };
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

export const tapeKey = (name: string): string => `${name}${TAPE_SUFFIX}`;

/** The names of the tapes among the app's storage keys, in order. */
export function tapeNames(keys: readonly string[]): string[] {
  return keys
    .filter((key) => key.endsWith(TAPE_SUFFIX) && key.length > TAPE_SUFFIX.length)
    .map((key) => key.slice(0, -TAPE_SUFFIX.length))
    .sort((a, b) => a.localeCompare(b));
}

/** Why a tape can't be kept under `name`, or null if it can. Replacing another of the user's tapes is up to them. */
export function tapeNameProblem(name: string): string | null {
  if (name === "") return "A tape needs a name.";
  if (name.length > MAX_TAPE_NAME) return `A tape's name can be at most ${MAX_TAPE_NAME} characters long.`;
  if (name.includes("/") || name === "." || name === "..") return `A tape can't be called “${name}”.`;
  const demo = DEMO_NAMES.find((d) => d.toLowerCase() === name.toLowerCase());
  if (demo) return `“${demo}” is a demo tape. Save your version under a name of its own.`;
  return null;
}

/** What Save As offers to call a tape. */
export function suggestedName(ref: TapeRef): string {
  if (ref.kind === "demo") return `${ref.name} copy`.slice(0, MAX_TAPE_NAME);
  return tapeName(ref);
}

/** A tape reference from untrusted JSON, or null. Whether that tape still exists is for the caller to find out. */
export function sanitizeTapeRef(value: unknown): TapeRef | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (r.kind === "new") return { kind: "new" };
  if ((r.kind === "demo" || r.kind === "saved") && typeof r.name === "string" && r.name !== "") return { kind: r.kind, name: r.name };
  return null;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

interface TapeChunk {
  version: 1;
  headroom: number;
  tape: number[];
  levels: number[];
  pans: number[];
}

export function encodeTape(contents: TapeContents): Uint8Array {
  const frames = Math.max(0, ...contents.tracks.map((track) => track?.length ?? 0));
  const channels = Array.from({ length: TAPE_TRACKS }, (_, t) => {
    const channel = new Float32Array(frames);
    const track = contents.tracks[t];
    if (track) for (let i = 0; i < track.length; i++) channel[i] = track[i]! / HEADROOM;
    return channel;
  });
  const chunk: TapeChunk = {
    version: 1,
    headroom: HEADROOM,
    tape: [...contents.mix.settings],
    levels: [...contents.mix.levels],
    pans: [...contents.mix.pans],
  };
  return setWavChunk(encodeWav(channels, contents.sampleRate), CHUNK, new TextEncoder().encode(JSON.stringify(chunk)));
}

function readChunk(bytes: Uint8Array): Record<string, unknown> {
  const body = readWavChunk(bytes, CHUNK);
  if (!body) return {};
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(body));
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * A tape from WAVE bytes, at `sampleRate`: each channel a track, up to four.
 * A WAVE file of any other making reads as its channels at full level, with
 * the mix at its defaults. Null if the bytes aren't a WAVE file.
 */
export function decodeTape(bytes: Uint8Array, sampleRate: number): TapeContents | null {
  const wav = decodeWav(bytes);
  if (!wav) return null;
  const chunk = readChunk(bytes);
  const headroom = typeof chunk.headroom === "number" && chunk.headroom > 0 && chunk.headroom <= 16 ? chunk.headroom : 1;
  const tracks = Array.from({ length: TAPE_TRACKS }, (_, t) => {
    const channel = wav.channels[t];
    if (!channel || !channel.some((s) => s !== 0)) return null;
    const track = resample(channel, wav.sampleRate, sampleRate);
    for (let i = 0; i < track.length; i++) track[i] = track[i]! * headroom;
    return track;
  });
  return {
    mix: { settings: sanitizeQuad(TAPE_DEFS, chunk.tape), levels: sanitizeQuad(MIXER_DEFS, chunk.levels), pans: sanitizeQuad(PAN_DEFS, chunk.pans) },
    tracks,
    sampleRate,
  };
}

/** `data` at `to` Hz, read linearly between its samples; a copy either way. */
function resample(data: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return data.slice();
  const out = new Float32Array(Math.round((data.length * to) / from));
  const ratio = from / to;
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const j = Math.floor(x);
    const a = data[j] ?? 0;
    const b = data[j + 1] ?? a;
    out[i] = a + (b - a) * (x - j);
  }
  return out;
}
