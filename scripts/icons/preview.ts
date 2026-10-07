import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { pngBufferToSprite, isWashout } from "./convert";
import { fetchIconPng } from "./fetchIcon";
import { slugKey } from "./iconsModule";
import { previewRoot } from "./paths";
import { writeIconSheets, type SheetIcon } from "./sheet";
import { isSystem753File, system753Family } from "./system753";
import type { ConvertMode, SearchHit } from "./types";

export interface PreviewResult {
  index: number;
  file: string;
  name: string;
  collection: string;
  category: string;
  description: string;
  score: number;
  /** The contact sheet page that shows this hit. */
  sheet: string;
  /** Sizes the hit has: a System 7.5.3 family may have both. */
  sizes: string[];
  washout: boolean;
  suggestedKey: string;
}

function sessionDir(query: string): string {
  const slug = query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "search";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(previewRoot(), `${slug}-${stamp}`);
}

const PER_PAGE = 6;

/** The hit's sprites: a System 7.5.3 family locally, a ryOS PNG fetched and thresholded. */
async function hitIcon(hit: SearchHit, label: string, mode: ConvertMode): Promise<SheetIcon> {
  if (isSystem753File(hit.icon.file)) {
    const family = system753Family(hit.icon.file);
    return { label, large: family?.large, small: family?.small };
  }
  const sprite = await pngBufferToSprite(await fetchIconPng(hit.icon.file), mode);
  hit.washout = isWashout(sprite);
  return sprite.width <= 16 ? { label, small: sprite } : { label, large: sprite };
}

export async function writeSearchPreviews(
  query: string,
  hits: SearchHit[],
  mode: ConvertMode = "threshold"
): Promise<{ dir: string; sheets: string[]; results: PreviewResult[] }> {
  const dir = sessionDir(query);
  await mkdir(dir, { recursive: true });
  const icons: SheetIcon[] = [];
  for (let i = 0; i < hits.length; i++) {
    icons.push(await hitIcon(hits[i], `${i + 1}. ${hits[i].icon.name || hits[i].icon.file}  [${hits[i].icon.collection}]`, mode));
  }
  const sheets = await writeIconSheets(icons, join(dir, "sheet.png"), PER_PAGE);
  const results = hits.map(({ icon, score, washout }, i): PreviewResult => ({
    index: i + 1,
    file: icon.file,
    name: icon.name,
    collection: icon.collection,
    category: icon.category,
    description: icon.description,
    score,
    sheet: sheets[Math.floor(i / PER_PAGE)],
    sizes: [icons[i].large && "32x32", icons[i].small && "16x16"].filter(Boolean) as string[],
    washout,
    suggestedKey: `icon/${slugKey(icon.name, icon.file)}`,
  }));
  await writeFile(join(dir, "results.json"), JSON.stringify({ query, mode, sheets, results }, null, 2));
  return { dir, sheets, results };
}
