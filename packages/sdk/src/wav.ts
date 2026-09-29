/**
 * What RIFF/WAVE files carry besides their sound. Markers travel in the
 * file's `cue ` chunk, where DAWs and field recorders keep them, so a marked
 * recording stays marked wherever it goes; an app's own data can ride along
 * in a chunk of its own, which other readers skip. `encodeWav` / `decodeWav`
 * (in `./audio`) handle the sound.
 */

const HEADER_BYTES = 12;
const CUE_POINT_BYTES = 24;

interface Chunk {
  id: string;
  /** Where the chunk's body starts. */
  offset: number;
  size: number;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let text = "";
  for (let i = 0; i < length; i++) text += String.fromCharCode(bytes[offset + i]!);
  return text;
}

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
}

function isWave(bytes: Uint8Array): boolean {
  return bytes.length >= HEADER_BYTES && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE";
}

/** The file's chunks in order. A size running past the end is cut to the bytes present. */
function readChunks(bytes: Uint8Array): Chunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Chunk[] = [];
  let at = HEADER_BYTES;
  while (at + 8 <= bytes.length) {
    const offset = at + 8;
    const size = Math.min(view.getUint32(at + 4, true), bytes.length - offset);
    chunks.push({ id: ascii(bytes, at, 4), offset, size });
    at = offset + size + (size & 1);
  }
  return chunks;
}

/** Frames of audio in the file, from its `fmt ` block size and `data` length. */
function frameCount(bytes: Uint8Array, chunks: readonly Chunk[]): number {
  const fmt = chunks.find((c) => c.id === "fmt ");
  const data = chunks.find((c) => c.id === "data");
  if (!fmt || !data || fmt.size < 16) return 0;
  const blockAlign = new DataView(bytes.buffer, bytes.byteOffset + fmt.offset, fmt.size).getUint16(12, true);
  return blockAlign > 0 ? Math.floor(data.size / blockAlign) : 0;
}

function tidy(markers: readonly number[], frames: number): number[] {
  const whole = markers.map((m) => Math.round(m)).filter((m) => Number.isFinite(m) && m >= 0 && m <= frames);
  return [...new Set(whole)].sort((a, b) => a - b);
}

function cueChunk(markers: readonly number[]): Uint8Array {
  const body = new Uint8Array(4 + markers.length * CUE_POINT_BYTES);
  const view = new DataView(body.buffer);
  view.setUint32(0, markers.length, true);
  markers.forEach((frame, i) => {
    const at = 4 + i * CUE_POINT_BYTES;
    view.setUint32(at, i + 1, true);
    view.setUint32(at + 4, frame, true);
    writeAscii(body, at + 8, "data");
    view.setUint32(at + 20, frame, true);
  });
  return body;
}

/** The frame offsets of a WAVE file's cue points, ascending and within the audio. `[]` for anything else. */
export function readWavMarkers(bytes: Uint8Array): number[] {
  if (!isWave(bytes)) return [];
  const chunks = readChunks(bytes);
  const cue = chunks.find((c) => c.id === "cue ");
  if (!cue || cue.size < 4) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset + cue.offset, cue.size);
  const count = Math.min(view.getUint32(0, true), Math.floor((cue.size - 4) / CUE_POINT_BYTES));
  const markers: number[] = [];
  for (let i = 0; i < count; i++) markers.push(view.getUint32(4 + i * CUE_POINT_BYTES + 20, true));
  return tidy(markers, frameCount(bytes, chunks));
}

/**
 * The same WAVE file with its cue points replaced by `markers` (frame
 * offsets). Every other chunk — the audio included — is copied byte for
 * byte, so marking a file never re-encodes it. Cue labels (`LIST`/`adtl`)
 * go with the old points.
 */
export function setWavMarkers(bytes: Uint8Array, markers: readonly number[]): Uint8Array {
  if (!isWave(bytes)) throw new Error("Not a WAVE file");
  const chunks = readChunks(bytes);
  const kept = chunks
    .filter((c) => c.id !== "cue " && !(c.id === "LIST" && c.size >= 4 && ascii(bytes, c.offset, 4) === "adtl"))
    .map((c) => ({ id: c.id, body: bytes.subarray(c.offset, c.offset + c.size) }));
  const points = tidy(markers, frameCount(bytes, chunks));
  if (points.length > 0) kept.push({ id: "cue ", body: cueChunk(points) });
  return writeWave(kept);
}

function assertChunkId(id: string): void {
  if (!/^[\x20-\x7e]{4}$/.test(id)) throw new Error(`A chunk id is four printable ASCII characters, not "${id}"`);
}

/** The body of a WAVE file's first chunk called `id` (four characters, e.g. `"LIST"`), or null if it has none. */
export function readWavChunk(bytes: Uint8Array, id: string): Uint8Array | null {
  assertChunkId(id);
  if (!isWave(bytes)) return null;
  const chunk = readChunks(bytes).find((c) => c.id === id);
  return chunk ? bytes.slice(chunk.offset, chunk.offset + chunk.size) : null;
}

/**
 * The same WAVE file with its chunk `id` holding `body` — in place of the
 * one it had, or added at the end — or without it when `body` is null.
 * Every other chunk is copied byte for byte. `fmt ` and `data` are the
 * sound itself and can't be set this way.
 */
export function setWavChunk(bytes: Uint8Array, id: string, body: Uint8Array | null): Uint8Array {
  assertChunkId(id);
  if (id === "fmt " || id === "data") throw new Error(`The "${id}" chunk is the sound itself`);
  if (!isWave(bytes)) throw new Error("Not a WAVE file");
  const chunks: { id: string; body: Uint8Array }[] = [];
  let placed = body === null;
  for (const c of readChunks(bytes)) {
    if (c.id !== id) chunks.push({ id: c.id, body: bytes.subarray(c.offset, c.offset + c.size) });
    else if (!placed) {
      chunks.push({ id, body: body! });
      placed = true;
    }
  }
  if (!placed) chunks.push({ id, body: body! });
  return writeWave(chunks);
}

function writeWave(kept: readonly { id: string; body: Uint8Array }[]): Uint8Array {
  const total = kept.reduce((sum, c) => sum + 8 + c.body.length + (c.body.length & 1), HEADER_BYTES);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  writeAscii(out, 0, "RIFF");
  view.setUint32(4, total - 8, true);
  writeAscii(out, 8, "WAVE");
  let at = HEADER_BYTES;
  for (const chunk of kept) {
    writeAscii(out, at, chunk.id);
    view.setUint32(at + 4, chunk.body.length, true);
    out.set(chunk.body, at + 8);
    at += 8 + chunk.body.length + (chunk.body.length & 1);
  }
  return out;
}
