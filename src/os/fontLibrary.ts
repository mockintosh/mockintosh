/**
 * The font library: suitcases that don't ship with the system, hosted beside
 * the site in `public/fonts/library/` (`npm run fonts:library` builds them).
 * The App Store lists `index.json`; installing one downloads its `.suit` and
 * writes it into System Folder › Fonts, which installs it like any suitcase.
 */
import type { FetchFunction } from "@mockintosh/sdk";
import { decodeSuitcase, familyKey } from "@mockintosh/ui";
import type { FontFolder } from "./fontFolder";

const LIBRARY_URL = "/fonts/library/";

export interface LibraryFont {
  /** Family name, as font menus show it. */
  family: string;
  /** Suitcase file in the library. */
  file: string;
  designer: string;
  description: string;
  license: string;
  licenseFile?: string;
  sizes: number[];
  styles: string[];
  /** Size of the suitcase download. */
  bytes: number;
}

let catalog: Promise<LibraryFont[]> | undefined;

/** The library's fonts, fetched once per boot of the page; a failed fetch is tried again next time. */
export function loadFontLibrary(fetch: FetchFunction): Promise<LibraryFont[]> {
  catalog ??= (async () => {
    const response = await fetch(`${LIBRARY_URL}index.json`);
    if (!response.ok) throw new Error(`Font library: HTTP ${response.status}`);
    const data = (await response.json()) as { fonts?: LibraryFont[] };
    return data.fonts ?? [];
  })().catch((error: unknown) => {
    catalog = undefined;
    throw error;
  });
  return catalog;
}

/** Registry key the font installs under. */
export function libraryFontKey(font: LibraryFont): string {
  return familyKey(font.family);
}

/** Download a library font into the Fonts folder; resolves once it's in the Font menus. */
export async function installLibraryFont(fetch: FetchFunction, font: LibraryFont, folder: FontFolder): Promise<string> {
  const response = await fetch(`${LIBRARY_URL}${encodeURIComponent(font.file)}`);
  if (!response.ok) throw new Error(`Couldn't download ${font.family} (HTTP ${response.status}).`);
  return folder.install(decodeSuitcase(await response.text()));
}
