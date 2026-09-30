import type { FontRasterOptions, FontRasterService } from "@mockintosh/sdk";
import { SCALER_MODES, rasterizeWithScaler } from "./raster";

/** Rasterizing without a host font engine: the Font Manager's own scaler. */
export function createOutlineFontRasterService(): FontRasterService {
  return {
    modes: () => SCALER_MODES,
    async rasterize(bytes, options: FontRasterOptions) {
      return rasterizeWithScaler(bytes, options.mode === "hinted" ? { ...options, mode: "auto" } : options);
    },
  };
}
