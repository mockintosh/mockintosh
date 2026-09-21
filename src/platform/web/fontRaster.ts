import type { FontRasterMode, FontRasterOptions, FontRasterService } from "@mockintosh/sdk";
import type { FontStrikeDraft, FontStrikeGlyph } from "@mockintosh/ui";
import { defaultRasterCharset, deckerOrdinalForCharCode } from "@mockintosh/ui";
import { peekFontFamily } from "../fontRaster/parseTtf";
import { clampStrikeSize, downsampleThreshold, rasterizeOutline, sanitizeFamily } from "../fontRaster/raster";

function coverageFromImage(data: ImageData): Uint8Array {
  const cover = new Uint8Array(data.width * data.height);
  const rgba = data.data;
  for (let i = 0, p = 0; i < cover.length; i++, p += 4) {
    cover[i] = 255 - rgba[p]!;
  }
  return cover;
}

async function rasterizeHinted(
  bytes: Uint8Array,
  options: FontRasterOptions,
  oversample: number,
): Promise<FontStrikeDraft> {
  const size = clampStrikeSize(options.size);
  const ppem = size * oversample;
  const fontId = `foundry-${Math.random().toString(36).slice(2)}`;
  const face = new FontFace(fontId, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  await face.load();
  document.fonts.add(face);
  try {
    const probe = new OffscreenCanvas(8, 8);
    const pctx = probe.getContext("2d");
    if (!pctx) throw new Error("Could not rasterize this font.");
    pctx.font = `${ppem}px "${fontId}"`;
    pctx.textBaseline = "alphabetic";
    const metrics = pctx.measureText("Hg");
    const ascent = Math.max(1, Math.ceil(metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent || ppem * 0.8));
    const descent = Math.max(0, Math.ceil(metrics.fontBoundingBoxDescent || metrics.actualBoundingBoxDescent || ppem * 0.2));
    const srcH = ascent + descent;
    const chars = options.chars ?? defaultRasterCharset();
    const glyphs: FontStrikeGlyph[] = [];
    let maxWidth = 1;

    for (const ch of chars) {
      const cp = ch.codePointAt(0);
      if (cp === undefined) continue;
      const ordinal = deckerOrdinalForCharCode(cp);
      if (ordinal === 255) continue;
      const m = pctx.measureText(ch);
      const advance = Math.max(1, Math.round(m.width));
      const left = Math.ceil(m.actualBoundingBoxLeft || 0);
      const right = Math.ceil(m.actualBoundingBoxRight || advance);
      const padL = Math.max(0, left);
      const srcW = Math.max(advance, right) + padL;
      const canvas = new OffscreenCanvas(srcW, srcH);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Could not rasterize this font.");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, srcW, srcH);
      ctx.font = `${ppem}px "${fontId}"`;
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#000000";
      ctx.fillText(ch, padL, ascent);
      const cover = coverageFromImage(ctx.getImageData(0, 0, srcW, srcH));
      const binary =
        oversample === 1
          ? {
              width: srcW,
              height: srcH,
              pixels: Uint8Array.from(cover, (v) => (v >= options.threshold ? 1 : 0)),
            }
          : downsampleThreshold(cover, srcW, srcH, oversample, options.threshold);
      maxWidth = Math.max(maxWidth, binary.width);
      glyphs.push({ ordinal, width: binary.width, pixels: binary.pixels });
    }

    return {
      family: sanitizeFamily(peekFontFamily(bytes)),
      size,
      maxWidth,
      glyphHeight: oversample === 1 ? srcH : Math.max(1, Math.ceil(srcH / oversample)),
      spacing: Math.max(0, Math.round(options.spacing)),
      glyphs,
    };
  } finally {
    document.fonts.delete(face);
  }
}

export function createWebFontRasterService(): FontRasterService {
  const modes: readonly FontRasterMode[] = ["hinted", "outline", "x2", "x3"];
  return {
    modes: () => modes,
    async rasterize(bytes, options) {
      if (options.mode === "outline") {
        return rasterizeOutline(bytes, {
          size: options.size,
          threshold: options.threshold,
          spacing: options.spacing,
          chars: options.chars,
          oversample: 1,
        });
      }
      const oversample = options.mode === "x3" ? 3 : options.mode === "x2" ? 2 : 1;
      try {
        return await rasterizeHinted(bytes, options, oversample);
      } catch (err) {
        if (options.mode === "hinted") throw err;
        return rasterizeOutline(bytes, {
          size: options.size,
          threshold: options.threshold,
          spacing: options.spacing,
          chars: options.chars,
          oversample,
        });
      }
    },
  };
}
