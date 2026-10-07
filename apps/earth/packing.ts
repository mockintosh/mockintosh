/**
 * Numbers packed into string literals for the `*.generated.ts` files: each
 * non-negative integer written five bits at a time, low bits first, one
 * character each, with a sixth bit set while more follow. Signed values go
 * through zigzag first.
 *
 * Lines (`geography.generated.ts`) are in hundredths of a degree: each line a
 * point count, then its points as zigzag deltas from the point before (the
 * last line's last point, for a line's first).
 */

/** Degrees per unit. */
export const QUANTUM = 0.01;

/** Sixty-four characters that need no escaping in a string literal. */
export const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export const zigzag = (n: number): number => (n < 0 ? -2 * n - 1 : 2 * n);
export const unzigzag = (n: number): number => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

/** Non-negative integers, packed. */
export function encode(values: readonly number[]): string {
  let out = "";
  for (const value of values) {
    let v = value;
    do {
      const bits = v & 31;
      v = Math.floor(v / 32);
      out += ALPHABET[bits | (v > 0 ? 32 : 0)];
    } while (v > 0);
  }
  return out;
}

/** The integers `encode` packed. */
export function decode(packed: string): number[] {
  const digits = new Uint8Array(128);
  for (let i = 0; i < ALPHABET.length; i++) digits[ALPHABET.charCodeAt(i)] = i;
  const values: number[] = [];
  let value = 0;
  let scale = 1;
  for (let at = 0; at < packed.length; at++) {
    const digit = digits[packed.charCodeAt(at)]!;
    value += (digit & 31) * scale;
    if (digit < 32) {
      values.push(value);
      value = 0;
      scale = 1;
    } else scale *= 32;
  }
  return values;
}

/** A packed layer, unpacked: every line's points as `[lon, lat, lon, lat, …]` degrees. */
export function unpack(packed: string): Float64Array[] {
  const values = decode(packed);
  const lines: Float64Array[] = [];
  let at = 0;
  let x = 0;
  let y = 0;
  while (at < values.length) {
    const count = values[at++]!;
    const line = new Float64Array(count * 2);
    for (let i = 0; i < count; i++) {
      x += unzigzag(values[at++]!);
      y += unzigzag(values[at++]!);
      line[i * 2] = x * QUANTUM;
      line[i * 2 + 1] = y * QUANTUM;
    }
    lines.push(line);
  }
  return lines;
}
