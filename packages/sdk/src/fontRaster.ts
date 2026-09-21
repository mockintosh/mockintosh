import type { FontFamilyInfo, FontStrikeDraft } from "@mockintosh/ui";

export type FontRasterMode = "hinted" | "outline" | "x2" | "x3";

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
  register(name: string, data: string, size?: number): void;
  list(): FontFamilyInfo[];
}
