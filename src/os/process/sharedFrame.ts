/**
 * A window's pictures in shared memory. The worker writes each new picture
 * into the slot the OS isn't reading, then publishes it; the OS looks at the
 * counter as it starts each frame of its own. Nothing waits in a message
 * queue: after an input event the browser renders before it delivers other
 * messages, so a picture that was ready in time would otherwise still miss the
 * frame.
 *
 * Layout: an `Int32Array` header, then two picture slots of `slotBytes`. The
 * header holds the publish count, the front slot, and each slot's width,
 * height, row bytes and the input `seq` it shows.
 */
import type { BitMap } from "@mockintosh/quickdraw";
import { rowBytesFor } from "@mockintosh/quickdraw/bits";

const COUNT = 0;
const FRONT = 1;
/** Per slot: width, height, rowBytes, seq. */
const SLOT_FIELDS = 4;
const slotField = (slot: number, field: number) => 2 + slot * SLOT_FIELDS + field;
const HEADER_BYTES = (2 + 2 * SLOT_FIELDS) * 4;

/** Bytes of shared memory for pictures up to `width` × `height`. */
export function sharedFrameBytes(width: number, height: number): number {
  return HEADER_BYTES + 2 * rowBytesFor(width) * height;
}

function slotBytes(buffer: SharedArrayBuffer): number {
  return (buffer.byteLength - HEADER_BYTES) / 2;
}

/** Worker: publish a packed picture. It must fit the buffer's slots. */
export function publishSharedFrame(
  buffer: SharedArrayBuffer,
  picture: Uint8Array,
  width: number,
  height: number,
  rowBytes: number,
  seq: number,
): void {
  const header = new Int32Array(buffer, 0, HEADER_BYTES / 4);
  const back = 1 - Atomics.load(header, FRONT);
  const size = slotBytes(buffer);
  new Uint8Array(buffer, HEADER_BYTES + back * size, picture.length).set(picture);
  header[slotField(back, 0)] = width;
  header[slotField(back, 1)] = height;
  header[slotField(back, 2)] = rowBytes;
  header[slotField(back, 3)] = seq;
  Atomics.store(header, FRONT, back);
  Atomics.add(header, COUNT, 1);
}

/** OS: the publish count, to tell whether there's anything new. */
export function sharedFrameCount(buffer: SharedArrayBuffer): number {
  return Atomics.load(new Int32Array(buffer, 0, 1), COUNT);
}

/** OS: copy out the front picture. */
export function readSharedFrame(buffer: SharedArrayBuffer): { bits: BitMap; seq: number; bytes: number } {
  const header = new Int32Array(buffer, 0, HEADER_BYTES / 4);
  const front = Atomics.load(header, FRONT);
  const width = header[slotField(front, 0)]!;
  const height = header[slotField(front, 1)]!;
  const rowBytes = header[slotField(front, 2)]!;
  const bytes = rowBytes * height;
  const baseAddr = new Uint8Array(buffer, HEADER_BYTES + front * slotBytes(buffer), bytes).slice();
  return { bits: { baseAddr, rowBytes, bounds: { top: 0, left: 0, bottom: height, right: width } }, seq: header[slotField(front, 3)]!, bytes };
}
