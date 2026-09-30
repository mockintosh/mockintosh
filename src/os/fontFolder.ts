/**
 * System Folder › Fonts: every suitcase, TrueType / OpenType file and
 * `.fnt` strike in it is installed with the Font Manager at boot, and again
 * whenever the folder changes (drag a font in and it's in the Font menu).
 *
 * Loose outline files join a family by their own family name and style
 * bits, the way System 7.5 accepted loose `'sfnt'` files; a `.fnt` names its
 * family and size in its file name (`futura-12.fnt`).
 */
import { createSignal } from "solid-js";
import { MIME, extensionOf, type FileSystem, type FSNode } from "@mockintosh/fs";
import {
  decodeSuitcase,
  encodeSuitcase,
  familyKey,
  installSuitcase,
  registerFont,
  registerOutlineFace,
  suitcaseKey,
  unregisterFamily,
  type FontSuitcase,
} from "@mockintosh/ui";

export interface FontFolderProblem {
  fileName: string;
  message: string;
}

export interface FontFolder {
  /** Family keys installed from the folder. Reactive. */
  families(): readonly string[];
  /** Files that couldn't be read as fonts. Reactive. */
  problems(): readonly FontFolderProblem[];
  /** Write a suitcase into the folder (replacing one for the same family); resolves once installed. */
  install(suitcase: FontSuitcase): Promise<string>;
  /** Resolves once pending folder changes have been read. */
  settled(): Promise<void>;
  shutdown(): void;
}

const OUTLINE_EXTENSIONS = new Set(["ttf", "otf", "ttc"]);

/** A suitcase file name for a family: its name, minus characters file names can't have. */
export function suitcaseFileName(suitcase: FontSuitcase): string {
  return `${suitcase.family.replace(/[/:]/g, "-").trim() || suitcaseKey(suitcase)}.suit`;
}

/** `family-12.fnt` / `Family 12.fnt` → family key and point size. */
export function strikeFileSpec(name: string): { family: string; size: number } | null {
  const match = /^(.*?)[\s_-]*(\d{1,3})\.fnt$/i.exec(name);
  if (!match || !match[1]) return null;
  return { family: familyKey(match[1]), size: Number(match[2]) };
}

function isFontFile(node: FSNode): boolean {
  if (node.kind !== "file") return false;
  const ext = extensionOf(node.name);
  return ext === "suit" || ext === "fnt" || OUTLINE_EXTENSIONS.has(ext);
}

export async function createFontFolder(fs: FileSystem): Promise<FontFolder> {
  const [families, setFamilies] = createSignal<string[]>([]);
  const [problems, setProblems] = createSignal<FontFolderProblem[]>([]);
  const folder = () => fs.locate("fonts");
  let installed: string[] = [];
  let observed = "";
  let stopped = false;
  let pending: Promise<void> = Promise.resolve();

  async function load(node: FSNode): Promise<string[]> {
    const ext = extensionOf(node.name);
    if (ext === "suit") return [installSuitcase(decodeSuitcase((await fs.readText(node.id)) ?? ""))];
    if (ext === "fnt") {
      const spec = strikeFileSpec(node.name);
      if (!spec) throw new Error("Name strikes family-size.fnt, like futura-12.fnt.");
      registerFont(spec.family, ((await fs.readText(node.id)) ?? "").trim(), spec.size);
      return [spec.family];
    }
    const bytes = await fs.readBytes(node.id);
    if (!bytes) throw new Error("The file is empty.");
    return [registerOutlineFace(bytes).family];
  }

  async function refresh(): Promise<void> {
    const dir = folder();
    const nodes = dir ? fs.children(dir.id).filter(isFontFile) : [];
    // Suitcases first, so loose files add faces to a suitcase's family.
    nodes.sort((a, b) => Number(extensionOf(b.name) === "suit") - Number(extensionOf(a.name) === "suit") || a.name.localeCompare(b.name));
    const key = nodes.map((n) => `${n.id}:${n.revision}`).join(",");
    if (key === observed || stopped) return;
    observed = key;
    for (const family of installed) unregisterFamily(family);
    const found = new Set<string>();
    const broken: FontFolderProblem[] = [];
    for (const node of nodes) {
      try {
        for (const family of await load(node)) found.add(family);
      } catch (error) {
        broken.push({ fileName: node.name, message: error instanceof Error ? error.message : String(error) });
      }
    }
    installed = [...found];
    setFamilies(installed);
    setProblems(broken);
    for (const problem of broken) console.warn(`Fonts: couldn't install ${problem.fileName}: ${problem.message}`);
  }

  const unsubscribe = fs.subscribe(() => {
    pending = pending.then(refresh);
  });
  pending = refresh();
  await pending;

  return {
    families,
    problems,
    async install(suitcase) {
      const dir = folder();
      if (!dir) throw new Error("The Fonts folder is missing");
      const name = suitcaseFileName(suitcase);
      await fs.writeFile(dir.id, name, encodeSuitcase(suitcase), { type: MIME.suitcase });
      await fs.flush();
      pending = pending.then(refresh);
      await pending;
      return suitcaseKey(suitcase);
    },
    settled: () => pending,
    shutdown() {
      stopped = true;
      unsubscribe();
    },
  };
}
