/**
 * Foundry's bake path on top of the Font Manager's scaler
 * (`@mockintosh/ui` › `fonts/truetype`), so a baked strike and a live
 * scaled one come out pixel-identical.
 */
import type { FontRasterMode } from "@mockintosh/sdk";
import { bakeOutlineStrike, clampBakeSize, familyKey, type FontStrikeDraft } from "@mockintosh/ui";

export const DEFAULT_THRESHOLD = 96;

export const clampStrikeSize = clampBakeSize;
export const sanitizeFamily = familyKey;

/** The scaler's modes: everything but the browser's `hinted`. */
export const SCALER_MODES: readonly FontRasterMode[] = ["auto", "outline", "x2", "x3"];

export function rasterizeWithScaler(
  bytes: Uint8Array,
  options: { size: number; mode: FontRasterMode; threshold: number; spacing: number; chars?: string },
): FontStrikeDraft {
  const oversample = options.mode === "x3" ? 3 : options.mode === "x2" ? 2 : 1;
  return bakeOutlineStrike(bytes, {
    size: options.size,
    spacing: options.spacing,
    chars: options.chars,
    hint: options.mode === "auto",
    oversample,
    threshold: options.threshold,
  });
}
