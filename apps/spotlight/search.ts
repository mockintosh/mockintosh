/**
 * How Spotlight matches and ranks: every source (apps, files, System, the App
 * Store) offers candidates, each is scored against the query by its name
 * (and keywords), and the results come back in sections — the Top Hit first,
 * then each category in Spotlight's order with its best few.
 */
import type { Sprite } from "@mockintosh/sdk";

export type Category =
  | "calculator"
  | "applications"
  | "system"
  | "documents"
  | "folders"
  | "images"
  | "appstore"
  | "web";

/** Section order, top to bottom, and how many of each are listed. */
export const CATEGORIES: readonly { id: Category; label: string; limit: number }[] = [
  { id: "calculator", label: "Calculator", limit: 1 },
  { id: "applications", label: "Applications", limit: 5 },
  { id: "system", label: "System", limit: 3 },
  { id: "documents", label: "Documents", limit: 6 },
  { id: "folders", label: "Folders", limit: 4 },
  { id: "images", label: "Images", limit: 4 },
  { id: "appstore", label: "App Store", limit: 4 },
  { id: "web", label: "Web", limit: 1 },
];

export const TOP_HIT_LABEL = "Top Hit";

/** Categories that are never the Top Hit: suggestions, not things on this Macintosh. */
const NEVER_TOP: ReadonlySet<Category> = new Set(["appstore", "web"]);

/** A thing Spotlight can find. */
export interface Candidate {
  /** Unique across all sources. */
  key: string;
  title: string;
  category: Category;
  /** Other words it answers to ("settings" for the Control Panel). */
  keywords?: readonly string[];
  /** Sprite name of its icon, or the sprite itself when the OS doesn't have it. */
  icon?: string;
  iconSprite?: Sprite;
  /** The preview's second line: "Application", "Folder", "PNG image"… */
  kind: string;
  /** The preview's further lines. */
  details?: readonly string[];
  /** Breaks ties between equal matches: more recent first. */
  modifiedAt?: number;
  /** Fixed score for answers that don't match by name (the calculator, the web search). */
  score?: number;
  open(): void;
  /** Show it in the Finder (⌘Return), when it is a file or folder. */
  reveal?(): void;
}

export interface Hit extends Candidate {
  score: number;
}

export interface Section {
  label: string;
  hits: Hit[];
}

/** Lowercase without accents: "Café" finds "cafe". */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function words(text: string): string[] {
  return text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** The initials of `text`'s words and of its CamelCase humps: "Photo Booth" → "pb", "MacPaint" → "mp". */
function initials(text: string): string {
  return text
    .split(/[^\p{L}\p{N}]+|(?<=\p{Ll})(?=\p{Lu})/u)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toLowerCase();
}

/**
 * How well `query` matches `title` (0: not at all). Whole name, then the
 * start of the name, the start of a word, every query word starting a word,
 * the initials, and last anywhere in the name. Shorter names win ties, so
 * "Mac" puts MacPaint above "Macintosh HD Backup Notes".
 */
export function scoreTitle(query: string, title: string, keywords: readonly string[] = []): number {
  const q = fold(query.trim());
  if (!q) return 0;
  const t = fold(title);
  const brevity = Math.max(0, 40 - t.length) / 4;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 800 + brevity;
  const titleWords = words(t);
  if (titleWords.some((w) => w.startsWith(q))) return 600 + brevity;
  const queryWords = words(q);
  if (queryWords.length > 1 && queryWords.every((qw) => titleWords.some((w) => w.startsWith(qw)))) return 500 + brevity;
  if (q.length >= 2 && initials(title).startsWith(q)) return 450 + brevity;
  const keywordWords = keywords.flatMap((k) => words(fold(k)));
  if (keywordWords.some((w) => w.startsWith(q))) return 350;
  if (q.length >= 2 && t.includes(q)) return 200 + brevity;
  return 0;
}

/** Applications win ties with documents of the same name, as in Spotlight. */
const CATEGORY_BONUS: Partial<Record<Category, number>> = { applications: 40, system: 20, folders: 5 };

/** Score every candidate, keep the matches, and lay them out in sections, Top Hit first. */
export function search(query: string, candidates: Iterable<Candidate>): Section[] {
  const hits: Hit[] = [];
  for (const candidate of candidates) {
    const match = candidate.score ?? scoreTitle(query, candidate.title, candidate.keywords);
    if (match <= 0) continue;
    hits.push({ ...candidate, score: match + (CATEGORY_BONUS[candidate.category] ?? 0) });
  }
  hits.sort((a, b) => b.score - a.score || (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0) || a.title.localeCompare(b.title));

  const sections: Section[] = [];
  const top = hits.find((hit) => !NEVER_TOP.has(hit.category) && hit.score >= 450);
  if (top) sections.push({ label: TOP_HIT_LABEL, hits: [top] });
  for (const category of CATEGORIES) {
    const inCategory = hits.filter((hit) => hit.category === category.id && hit !== top).slice(0, category.limit);
    if (inCategory.length > 0) sections.push({ label: category.label, hits: inCategory });
  }
  return sections;
}

/** The hits in list order, as the selection moves through them. */
export function flatten(sections: readonly Section[]): Hit[] {
  return sections.flatMap((section) => section.hits);
}

/** Where ⌘↓ / ⌘↑ goes from `index`: the first hit of the next or previous section. */
export function sectionJump(sections: readonly Section[], index: number, direction: -1 | 1): number {
  const starts: number[] = [];
  let at = 0;
  for (const section of sections) {
    starts.push(at);
    at += section.hits.length;
  }
  if (starts.length === 0) return index;
  if (direction > 0) return starts.find((start) => start > index) ?? starts.at(-1)!;
  const current = [...starts].reverse().find((start) => start <= index) ?? 0;
  if (current < index) return current;
  return [...starts].reverse().find((start) => start < index) ?? 0;
}
