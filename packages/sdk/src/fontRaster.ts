import type { FontFamilyInfo, FontStrikeDraft, FontSuitcase } from "@mockintosh/ui";

/**
 * - `auto`    the Font Manager's scaler with its 1-bit autohinter (every platform)
 * - `outline` the same scaler, unhinted
 * - `x2`/`x3` unhinted at 2× / 3×, box-filtered down at `threshold`
 * - `hinted`  the host browser's rasterizer, running the font's own hints (web only)
 */
export type FontRasterMode = "auto" | "hinted" | "outline" | "x2" | "x3";

export interface FontRasterOptions {
  size: number;
  mode: FontRasterMode;
  threshold: number;
  spacing: number;
  chars?: string;
}

export interface FontRasterService {
  rasterize(bytes: Uint8Array, options: FontRasterOptions): Promise<FontStrikeDraft>;
  modes(): readonly FontRasterMode[];
}

export interface FontRegistryService {
  /** Install a Decker strike for this boot only (Font/DA Mover). */
  register(name: string, data: string, size?: number): void;
  list(): FontFamilyInfo[];
  /** Call `listener` after any family is installed or removed; returns an unsubscribe. */
  onChange(listener: () => void): () => void;
  /**
   * Save a suitcase into System Folder › Fonts: every app gets the family,
   * and it's still there after a restart. Resolves to the family key.
   */
  install?(suitcase: FontSuitcase): Promise<string>;
}
