import { decodeBase64, defineSprite, type Sprite } from "@mockintosh/ui";
import type { CatalogFamilyRecord, IconFamily } from "./types";

function bitAt(raw: Uint8Array, rowBytes: number, x: number, y: number): number {
  const byte = raw[y * rowBytes + (x >> 3)];
  return (byte >> (7 - (x & 7))) & 1;
}

function bitmapToSprite(
  bits: Uint8Array,
  maskBits: Uint8Array | undefined,
  width: number,
  height: number
): Sprite {
  const rowBytes = (width + 7) >> 3;
  const data = new Uint8Array(width * height);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      data[i] = bitAt(bits, rowBytes, x, y);
      mask[i] = maskBits ? bitAt(maskBits, rowBytes, x, y) : 1;
    }
  }
  return { width, height, data, mask };
}

/** ICN# — 32×32 1-bit icon + mask (256 bytes). */
export function spriteFromIcnSharp(raw: Uint8Array): Sprite {
  if (raw.length < 256) throw new Error("ICN# must be 256 bytes");
  return bitmapToSprite(raw.subarray(0, 128), raw.subarray(128, 256), 32, 32);
}

/** ics# — 16×16 1-bit icon + mask (64 bytes). */
export function spriteFromIcsSharp(raw: Uint8Array): Sprite {
  if (raw.length < 64) throw new Error("ics# must be 64 bytes");
  return bitmapToSprite(raw.subarray(0, 32), raw.subarray(32, 64), 16, 16);
}

/** ICON — 32×32 1-bit, no mask (128 bytes). */
export function spriteFromIcon(raw: Uint8Array): Sprite {
  if (raw.length < 128) throw new Error("ICON must be 128 bytes");
  return bitmapToSprite(raw.subarray(0, 128), undefined, 32, 32);
}

function sprite2(width: number, height: number, b64: string | undefined): Sprite | undefined {
  return b64 ? defineSprite(width, height, b64) : undefined;
}

function rawBytes(b64: string | undefined): Uint8Array | undefined {
  return b64 ? decodeBase64(b64) : undefined;
}

export function familyFromRecord(rec: CatalogFamilyRecord): IconFamily {
  return {
    source: rec.source,
    group: rec.group,
    id: rec.id,
    name: rec.name,
    icn: sprite2(32, 32, rec.icn),
    ics: sprite2(16, 16, rec.ics),
    icon: sprite2(32, 32, rec.icon),
    sicn: rec.sicn?.map((b64) => defineSprite(16, 16, b64)),
    icl4: rawBytes(rec.icl4),
    icl8: rawBytes(rec.icl8),
    ics4: rawBytes(rec.ics4),
    ics8: rawBytes(rec.ics8),
  };
}

/** The 1-bit sprite the 1-bit port should draw for this family. */
export function familyPreview(family: IconFamily): Sprite | undefined {
  return family.icn ?? family.icon ?? family.ics ?? family.sicn?.[0];
}

export type IconMemberKind = "ICN#" | "ics#" | "ICON" | "SICN" | "icl8" | "icl4" | "ics8" | "ics4";

/** One resource in a family — same icon, one size and depth. */
export interface IconFamilyMember {
  kind: IconMemberKind;
  width: number;
  height: number;
  depth: "1-bit" | "4-bit" | "8-bit";
  sprite?: Sprite;
  /** SICN resources can hold several 16×16 frames. */
  frame?: number;
}

export function familyMembers(family: IconFamily): IconFamilyMember[] {
  const out: IconFamilyMember[] = [];
  if (family.icn) out.push({ kind: "ICN#", width: 32, height: 32, depth: "1-bit", sprite: family.icn });
  if (family.ics) out.push({ kind: "ics#", width: 16, height: 16, depth: "1-bit", sprite: family.ics });
  if (family.icon) out.push({ kind: "ICON", width: 32, height: 32, depth: "1-bit", sprite: family.icon });
  family.sicn?.forEach((sprite, i) => {
    out.push({ kind: "SICN", width: 16, height: 16, depth: "1-bit", sprite, frame: i + 1 });
  });
  if (family.icl8) out.push({ kind: "icl8", width: 32, height: 32, depth: "8-bit" });
  if (family.icl4) out.push({ kind: "icl4", width: 32, height: 32, depth: "4-bit" });
  if (family.ics8) out.push({ kind: "ics8", width: 16, height: 16, depth: "8-bit" });
  if (family.ics4) out.push({ kind: "ics4", width: 16, height: 16, depth: "4-bit" });
  return out;
}
