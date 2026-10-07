/** One icon in the slim ryOS classic-Mac catalog. */
export interface IconRecord {
  file: string;
  name: string;
  collection: string;
  category: string;
  themes: string[];
  vibes: string[];
  description: string;
}

export type CatalogRow = [
  file: string,
  name: string,
  collection: string,
  category: string,
  themes: string[],
  vibes: string[],
  description: string,
];

export interface CatalogFile {
  source: string;
  ref: string;
  count: number;
  fields: readonly string[];
  icons: CatalogRow[];
}

export type ConvertMode = "threshold" | "dither";

export interface ConvertedSprite {
  width: number;
  height: number;
  /** Base64 2 bpp, same payload as `defineSprite`. */
  b64: string;
  data: Uint8Array;
  mask: Uint8Array;
  blackPixels: number;
  opaquePixels: number;
}

export interface SearchHit {
  score: number;
  /** 3 = exact name, 2 = name prefix, 1 = name contains, 0 = other fields only. */
  nameRank: number;
  /** How many query tokens hit. */
  matched: number;
  icon: IconRecord;
  /** True when threshold conversion would be almost all white. */
  washout: boolean;
}

export const CATALOG_FIELDS = [
  "file",
  "name",
  "collection",
  "category",
  "themes",
  "vibes",
  "description",
] as const;

export const UPSTREAM_REPO = "ryokun6/ryos";
export const UPSTREAM_REF = "main";
export const UPSTREAM_CATALOG_ROOT = `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${UPSTREAM_REF}/public/resources/classic-mac-icon-catalogs`;
export const UPSTREAM_ERAS = ["system-7", "mac-os-8"] as const;

/** Resource types that are native 1-bit (not icl8 / ics8 / cicn color). */
export const NATIVE_1BIT_KINDS = new Set(["ICN#", "ics#", "SICN"]);
