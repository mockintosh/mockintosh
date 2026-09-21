import type { FontRasterMode, FontRasterOptions, FontRasterService } from "@mockintosh/sdk";
import { rasterizeOutline } from "./raster";

export function createOutlineFontRasterService(): FontRasterService {
  return {
    modes: () => ["outline", "x2", "x3"] as const,
    async rasterize(bytes, options: FontRasterOptions) {
      const oversample = options.mode === "x3" ? 3 : options.mode === "x2" ? 2 : 1;
      return rasterizeOutline(bytes, {
        size: options.size,
        threshold: options.threshold,
        spacing: options.spacing,
        chars: options.chars,
        oversample,
      });
    },
  };
}

export const OUTLINE_MODES: readonly FontRasterMode[] = ["outline", "x2", "x3"];
