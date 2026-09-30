import type { DeckerFont } from "./font";
import { decodeDeckerFont } from "./codec";
import {
  createOutlineStrike,
  parsePageFaceKey,
  type FamilyScalerSettings,
} from "./outlineStrike";
import { DEFAULT_SCALER_OPTIONS, OutlineFace } from "./truetype/scaler";
import { applyExtraGlyphs } from "./extraGlyphs";
import {
  BAKED_STYLE_ALIASES,
  BUILTIN_STRIKES,
  FAMILY_DEFAULTS,
  LISTED_FONT_NAMES,
  ROLE_ALIASES,
  familyDisplayName,
  type FontFamilyInfo,
} from "./families";

let strikes: Map<string, Map<number, DeckerFont>> | undefined;
let pendingStrikes: Map<string, Map<number, string>> | undefined;
let pendingBaked: Map<string, { family: string; size: number; data: string }> | undefined;
let aliases: Map<string, { family: string; size: number }> | undefined;
let defaults: Map<string, number> | undefined;
let infoByKey: Map<string, RegisteredFontInfo> | undefined;
let bakedByName: Map<string, DeckerFont> | undefined;

function strikeMap(): Map<string, Map<number, DeckerFont>> {
  return (strikes ??= new Map());
}
function pendingStrikeMap(): Map<string, Map<number, string>> {
  return (pendingStrikes ??= new Map());
}
function pendingBakedMap(): Map<string, { family: string; size: number; data: string }> {
  return (pendingBaked ??= new Map());
}
function aliasMap(): Map<string, { family: string; size: number }> {
  return (aliases ??= new Map(Object.entries(ROLE_ALIASES)));
}
function defaultMap(): Map<string, number> {
  return (defaults ??= new Map(Object.entries(FAMILY_DEFAULTS)));
}
function infoMap(): Map<string, RegisteredFontInfo> {
  return (infoByKey ??= new Map());
}
function bakedMap(): Map<string, DeckerFont> {
  return (bakedByName ??= new Map());
}

export interface RegisteredFontInfo {
  ascent: number;
  descent: number;
  leading: number;
}

let builtInsInitialized = false;

export function fontInfoKey(family: string, size: number): string {
  return `${family}/${size}`;
}

export function lookupFontInfo(font: DeckerFont): RegisteredFontInfo | undefined {
  if (font.fontInfo) return font.fontInfo;
  if (font.size != null) {
    const sized = infoMap().get(fontInfoKey(font.name, font.size));
    if (sized) return sized;
  }
  return infoMap().get(font.name);
}

function rememberInfo(family: string, size: number, info: RegisteredFontInfo | undefined): void {
  if (!info) return;
  infoMap().set(fontInfoKey(family, size), info);
}

function loadStrike(family: string, size: number, data: string): DeckerFont {
  const font = decodeDeckerFont(data, family);
  font.size = size;
  return applyExtraGlyphs(font);
}

function putStrike(family: string, size: number, font: DeckerFont): void {
  let bySize = strikeMap().get(family);
  if (!bySize) {
    bySize = new Map();
    strikeMap().set(family, bySize);
  }
  bySize.set(size, font);
  if (!defaultMap().has(family)) defaultMap().set(family, size);
}

function nearestSize(sizes: Iterable<number>, requested: number): number {
  let best: number | undefined;
  let bestDist = Infinity;
  for (const size of sizes) {
    const dist = Math.abs(size - requested);
    if (dist < bestDist || (dist === bestDist && best !== undefined && size > best)) {
      best = size;
      bestDist = dist;
    }
  }
  if (best === undefined) throw new Error("nearestSize called with no sizes");
  return best;
}

function knownSizes(family: string): number[] {
  const decoded = strikeMap().get(family);
  const pending = pendingStrikeMap().get(family);
  const sizes = new Set<number>();
  if (decoded) for (const size of decoded.keys()) sizes.add(size);
  if (pending) for (const size of pending.keys()) sizes.add(size);
  return [...sizes];
}

function ensureStrike(family: string, size: number): DeckerFont | null {
  const have = strikeMap().get(family)?.get(size);
  if (have) return have;
  const data = pendingStrikeMap().get(family)?.get(size);
  if (!data) return null;
  const font = loadStrike(family, size, data);
  putStrike(family, size, font);
  pendingStrikeMap().get(family)?.delete(size);
  return font;
}

function ensureBaked(name: string): DeckerFont | null {
  const have = bakedMap().get(name);
  if (have) return have;
  const pending = pendingBakedMap().get(name);
  if (!pending) return null;
  const font = loadFont(name, pending.data);
  font.size = pending.size;
  bakedMap().set(name, font);
  pendingBakedMap().delete(name);
  return font;
}

export function resolveFaceRef(name: string = "body", size?: number): { family: string; size: number } {
  initBuiltinFonts();
  if (bakedMap().has(name) || pendingBakedMap().has(name)) {
    const baked = ensureBaked(name);
    return { family: name, size: baked?.size ?? size ?? 0 };
  }
  const alias = aliasMap().get(name);
  const family = alias?.family ?? name;
  const sizes = knownSizes(family);
  const outline = outlineFamilyMap().get(family);
  if (outline) {
    const requested = size ?? alias?.size ?? defaultMap().get(family) ?? 12;
    return { family, size: clampScaledSize(requested) };
  }
  if (sizes.length === 0) {
    return { family, size: size ?? alias?.size ?? defaultMap().get(family) ?? 12 };
  }
  const requested = size ?? alias?.size ?? defaultMap().get(family) ?? sizes[0]!;
  return { family, size: nearestSize(sizes, requested) };
}

/** Decode a Decker font record and patch in Mockintosh's extra symbol glyphs for that name. */
function loadFont(name: string, data: string): DeckerFont {
  return applyExtraGlyphs(decodeDeckerFont(data, name));
}

export function initBuiltinFonts(): void {
  if (builtInsInitialized) return;
  for (const strike of BUILTIN_STRIKES) {
    let bySize = pendingStrikeMap().get(strike.family);
    if (!bySize) {
      bySize = new Map();
      pendingStrikeMap().set(strike.family, bySize);
    }
    bySize.set(strike.size, strike.data);
    rememberInfo(strike.family, strike.size, strike.info);
  }
  for (const [name, alias] of Object.entries(BAKED_STYLE_ALIASES)) {
    pendingBakedMap().set(name, alias);
    rememberInfo(name, alias.size, infoMap().get(fontInfoKey(alias.family, alias.size)));
    infoMap().set(name, infoMap().get(fontInfoKey(alias.family, alias.size)) ?? { ascent: 10, descent: 2, leading: 0 });
  }
  builtInsInitialized = true;
}

/**
 * Register a custom font from a %%FNT0 / %%FNT1 data block string.
 * Custom fonts can override built-in names. Extra symbol glyphs (see `extraGlyphs.ts`)
 * are applied when a drawing exists for `name`, so overriding `menu` keeps ⌘ / ✓ / • working.
 */
export function registerFont(name: string, data: string, size?: number): DeckerFont {
  initBuiltinFonts();
  const alias = aliasMap().get(name);
  const family = alias?.family ?? name;
  const point = size ?? alias?.size ?? defaultMap().get(family) ?? 12;
  const font = loadStrike(family, point, data);
  putStrike(family, point, font);
  defaultMap().set(family, point);
  fontsChanged();
  return font;
}

export function getFont(name: string = "body", size?: number): DeckerFont | null {
  initBuiltinFonts();
  if (size === undefined && (bakedMap().has(name) || pendingBakedMap().has(name))) {
    return ensureBaked(name);
  }
  const paged = parsePageFaceKey(name);
  if (paged.page > 0) {
    const ref = resolveFaceRef(paged.family, size);
    return outlineStrike(ref.family, 0, ref.size, paged.page);
  }
  const ref = resolveFaceRef(name, size);
  if (bakedMap().has(ref.family) || pendingBakedMap().has(ref.family)) {
    return ensureBaked(ref.family);
  }
  const outline = outlineFamilyMap().get(ref.family);
  if (outline) {
    const exact = !outline.settings.preferOutline ? ensureStrike(ref.family, ref.size) : null;
    if (exact) return exact;
    if (outline.faces.has(0)) return outlineStrike(ref.family, 0, ref.size, 0);
    const sizes = knownSizes(ref.family);
    if (sizes.length) return ensureStrike(ref.family, nearestSize(sizes, ref.size));
    const any = [...outline.faces.keys()][0]!;
    return outlineStrike(ref.family, any, ref.size, 0);
  }
  return ensureStrike(ref.family, ref.size);
}

/**
 * The closest **real** face for a style request, as the Font Manager's
 * style matching does it: italic weighs 8, bold 4, and only styles the
 * caller asked for count. `covered` is what the face supplies; QuickDraw
 * synthesizes the rest (smear bold, shear italic). `bits`: 1 bold, 2 italic.
 */
export function getRealFace(
  name: string = "body",
  bits: number,
  size?: number,
): { font: DeckerFont; covered: number } | null {
  initBuiltinFonts();
  const want = bits & (STYLE_BOLD | STYLE_ITALIC);
  if (want) {
    const paged = parsePageFaceKey(name);
    const ref = resolveFaceRef(paged.family, size);
    for (const style of [want, want & STYLE_ITALIC, want & STYLE_BOLD]) {
      if (!style) continue;
      if (paged.page === 0) {
        const bitmap = ensureStrike(strikeKey(ref.family, style), ref.size);
        if (bitmap) return { font: bitmap, covered: style };
      }
      const outline = outlineFamilyMap().get(ref.family);
      if (outline?.faces.has(style)) {
        return { font: outlineStrike(ref.family, style, ref.size, paged.page), covered: style };
      }
    }
  }
  const font = getFont(name, size);
  return font ? { font, covered: 0 } : null;
}

/**
 * Bitmap source for a QuickDraw request QuickDraw will stretch, in the
 * Font Manager's order: 2× the size (scale down), ½ (scale up), then the
 * next larger, then the next smaller. Outline families and exact sizes
 * come back unscaled.
 */
export function getFontForScaling(name: string = "body", size?: number): DeckerFont | null {
  initBuiltinFonts();
  if (size === undefined || size <= 0) return getFont(name, size);
  const paged = parsePageFaceKey(name);
  const alias = aliasMap().get(paged.family);
  const family = alias?.family ?? paged.family;
  if (paged.page > 0 || outlineFamilyMap().has(family) || bakedMap().has(name) || pendingBakedMap().has(name)) {
    return getFont(name, size);
  }
  const sizes = knownSizes(family).sort((a, b) => a - b);
  if (sizes.length === 0) return getFont(name, size);
  const pick =
    sizes.find((s) => s === size) ??
    sizes.find((s) => s === size * 2) ??
    sizes.find((s) => s * 2 === size) ??
    sizes.find((s) => s > size) ??
    sizes[sizes.length - 1]!;
  return ensureStrike(family, pick);
}

export function requireFont(name: string = "body", size?: number): DeckerFont {
  const font = getFont(name, size);
  if (!font) throw new Error(`Unknown font: "${name}"${size != null ? ` ${size}` : ""}`);
  return font;
}

export function listFonts(): string[] {
  initBuiltinFonts();
  const extra = new Set<string>();
  for (const name of strikeMap().keys()) if (!name.includes(STYLE_MARK)) extra.add(name);
  for (const name of pendingStrikeMap().keys()) if (!name.includes(STYLE_MARK)) extra.add(name);
  for (const name of outlineFamilyMap().keys()) extra.add(name);
  const listed = LISTED_FONT_NAMES as readonly string[];
  const extras = [...extra].filter((name) => !listed.includes(name));
  extras.sort();
  return [...listed, ...extras];
}

export function listFontSizes(name: string): number[] {
  initBuiltinFonts();
  const { family } = resolveFaceRef(name);
  return knownSizes(family).sort((a, b) => a - b);
}

export function listFontFamilies(): FontFamilyInfo[] {
  initBuiltinFonts();
  return listFonts()
    .filter((name) => !ROLE_ALIASES[name])
    .map((name) => {
      const sizes = listFontSizes(name);
      const outline = outlineFamilyMap().get(name);
      return {
        name,
        defaultSize: defaultMap().get(name) ?? sizes[0] ?? 12,
        sizes,
        scalable: Boolean(outline),
        builtIn: !outline && BUILTIN_STRIKES.some((s) => s.family === name),
        displayName: outline?.displayName ?? familyDisplayName(name),
      };
    });
}

export function defaultFontSize(name: string = "body"): number {
  return resolveFaceRef(name).size;
}

export type { FontFamilyInfo };

// --- Outline families (TrueType / OpenType) --------------------------------

const STYLE_BOLD = 1;
const STYLE_ITALIC = 2;
const STYLE_MARK = "\u0002s";
/** Scaled sizes stay inside Decker's one-byte cell. */
const MIN_SCALED_SIZE = 4;
const MAX_SCALED_SIZE = 127;
/** Glyph bytes the scaled-strike cache may hold before evicting the oldest. */
const SCALED_CACHE_BUDGET = 8 * 1024 * 1024;

export const DEFAULT_FAMILY_SETTINGS: Readonly<FamilyScalerSettings> = {
  ...DEFAULT_SCALER_OPTIONS,
  kerning: true,
  preferOutline: false,
};

interface OutlineFamily {
  displayName: string;
  /** Style bits (1 bold, 2 italic) → face. */
  faces: Map<number, OutlineFace>;
  settings: FamilyScalerSettings;
}

let outlineFamilies: Map<string, OutlineFamily> | undefined;
let scaledStrikes: Map<string, DeckerFont> | undefined;
let scaledBytes = 0;
let version = 0;
const listeners = new Set<() => void>();

function outlineFamilyMap(): Map<string, OutlineFamily> {
  return (outlineFamilies ??= new Map());
}
function scaledMap(): Map<string, DeckerFont> {
  return (scaledStrikes ??= new Map());
}

function strikeKey(family: string, bits: number): string {
  return bits ? `${family}${STYLE_MARK}${bits}` : family;
}

function clampScaledSize(size: number): number {
  return Math.max(MIN_SCALED_SIZE, Math.min(MAX_SCALED_SIZE, Math.round(size)));
}

function outlineStrike(family: string, bits: number, size: number, page: number): DeckerFont {
  const entry = outlineFamilyMap().get(family)!;
  const face = entry.faces.get(bits) ?? entry.faces.get(0) ?? [...entry.faces.values()][0]!;
  const ppem = clampScaledSize(size);
  const key = `${family}|${bits}|${ppem}|${page}`;
  const cache = scaledMap();
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const font = createOutlineStrike({
    family,
    face,
    ppem,
    page,
    settings: entry.settings,
    pageStrike: (p) => (outlineFamilyMap().get(family) ? outlineStrike(family, bits, ppem, p) : null),
  });
  cache.set(key, font);
  scaledBytes += font.glyphData.byteLength;
  for (const [oldKey, old] of cache) {
    if (scaledBytes <= SCALED_CACHE_BUDGET || old === font) break;
    cache.delete(oldKey);
    scaledBytes -= old.glyphData.byteLength;
  }
  return font;
}

function dropScaled(family: string): void {
  const cache = scaledMap();
  for (const [key, font] of cache) {
    if (!key.startsWith(`${family}|`)) continue;
    cache.delete(key);
    scaledBytes -= font.glyphData.byteLength;
  }
}

function fontsChanged(): void {
  version++;
  for (const listener of [...listeners]) listener();
}

/** Bumped whenever a family is installed or removed. */
export function fontsVersion(): number {
  return version;
}

/** Call `listener` after fonts are installed or removed; returns an unsubscribe. */
export function onFontsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Registry key for a family name: lowercase letters and digits, as Foundry names strikes. */
export function familyKey(name: string): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return cleaned.slice(0, 24) || "untitled";
}

export interface OutlineFaceRegistration {
  /** Registry key (see {@link familyKey}); defaults to the font's own family name. */
  family?: string;
  bold?: boolean;
  italic?: boolean;
  settings?: Partial<FamilyScalerSettings>;
}

/**
 * Install a TrueType / OpenType face into a family (the `'sfnt'` half of a
 * FOND). Bold / italic default to the font's own `OS/2` / `head` style bits.
 * Returns the family key and the style bits it filled.
 */
export function registerOutlineFace(
  source: Uint8Array | OutlineFace,
  options: OutlineFaceRegistration = {},
): { family: string; bits: number } {
  initBuiltinFonts();
  const face = source instanceof OutlineFace ? source : new OutlineFace(source);
  const family = options.family ?? familyKey(face.familyName);
  const bold = options.bold ?? face.font.bold;
  const italic = options.italic ?? face.font.italic;
  const bits = (bold ? STYLE_BOLD : 0) | (italic ? STYLE_ITALIC : 0);
  let entry = outlineFamilyMap().get(family);
  if (!entry) {
    entry = { displayName: face.familyName, faces: new Map(), settings: { ...DEFAULT_FAMILY_SETTINGS } };
    outlineFamilyMap().set(family, entry);
  }
  entry.faces.set(bits, face);
  if (options.settings) entry.settings = { ...entry.settings, ...options.settings };
  if (!defaultMap().has(family)) defaultMap().set(family, 12);
  dropScaled(family);
  fontsChanged();
  return { family, bits };
}

/** Install a bitmap strike for a styled face (`bits`: 1 bold, 2 italic) of `family`. */
export function registerStyledStrike(family: string, size: number, data: string, bits: number): DeckerFont {
  if (!bits) return registerFont(family, data, size);
  initBuiltinFonts();
  const key = strikeKey(family, bits);
  const font = loadStrike(key, size, data);
  font.name = family;
  putStrike(key, size, font);
  fontsChanged();
  return font;
}

/** Change a family's scaler switches (kerning, hinting, PreserveGlyph, …). */
export function setFamilySettings(family: string, settings: Partial<FamilyScalerSettings>): void {
  const entry = outlineFamilyMap().get(family);
  if (!entry) return;
  entry.settings = { ...entry.settings, ...settings };
  dropScaled(family);
  fontsChanged();
}

export function familySettings(family: string): FamilyScalerSettings | undefined {
  return outlineFamilyMap().get(family)?.settings;
}

/**
 * Remove a family installed at run time (strikes, styled strikes, outlines).
 * Built-in strikes are restored on the next {@link initBuiltinFonts}; this
 * only drops what was registered.
 */
export function unregisterFamily(family: string): void {
  outlineFamilyMap().delete(family);
  dropScaled(family);
  for (const key of [...strikeMap().keys()]) {
    if (key === family || key.startsWith(`${family}${STYLE_MARK}`)) strikeMap().delete(key);
  }
  for (const key of [...pendingStrikeMap().keys()]) {
    if (key.startsWith(`${family}${STYLE_MARK}`)) pendingStrikeMap().delete(key);
  }
  const builtin = BUILTIN_STRIKES.filter((s) => s.family === family);
  for (const strike of builtin) {
    let bySize = pendingStrikeMap().get(family);
    if (!bySize) {
      bySize = new Map();
      pendingStrikeMap().set(family, bySize);
    }
    bySize.set(strike.size, strike.data);
  }
  if (builtin.length === 0) defaultMap().delete(family);
  fontsChanged();
}
