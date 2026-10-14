import { beforeAll, describe, expect, it } from "vitest";
import { clusterEndAfter, clusterStartBefore, clusters, isTypedKey } from "../src/fonts/emojiClusters";
import { EMOJI_FAMILY, emojiFace, loadEmoji } from "../src/fonts/emoji";
import { forEachGlyph, glyphAdvance, textAdvance, type PlacedGlyph } from "../src/fonts/font";
import { fontsVersion, listFonts, requireFont } from "../src/fonts/registry";
import { hostSwapFont, fontFamilyId, uiTextRuns } from "../src/fonts/strike";
import { charIndexAtX } from "../src/fonts/textLayout";
import { underlineSpans } from "../src/fonts/underline";
import { editingKey } from "../src/textEditing";

const FAMILY = "👨‍👩‍👧";
const FLAG = "🇸🇪";
const KEYCAP = "1️⃣";
const SCOTLAND = "🏴󠁧󠁢󠁳󠁣󠁴󠁿";

function glyphs(font: string, size: number, text: string): PlacedGlyph[] {
  const out: PlacedGlyph[] = [];
  forEachGlyph(requireFont(font, size), text, (glyph) => out.push(glyph));
  return out;
}

const pieces = (text: string) => [...clusters(text)].map(([a, b]) => text.slice(a, b));

describe("emoji clusters", () => {
  it("keeps sequences whole", () => {
    expect(pieces(`a${FAMILY}b`)).toEqual(["a", FAMILY, "b"]);
    expect(pieces(`${FLAG}${FLAG}`)).toEqual([FLAG, FLAG]);
    expect(pieces(`${KEYCAP}👍🏽❤️${SCOTLAND}`)).toEqual([KEYCAP, "👍🏽", "❤️", SCOTLAND]);
    expect(pieces("🇸")).toEqual(["🇸"]);
  });

  it("moves the caret over a whole character", () => {
    const text = `x${FAMILY}y`;
    expect(clusterEndAfter(text, 1)).toBe(1 + FAMILY.length);
    expect(clusterStartBefore(text, 1 + FAMILY.length)).toBe(1);
    // From inside a cluster, to its ends.
    expect(clusterEndAfter(text, 3)).toBe(1 + FAMILY.length);
    expect(clusterStartBefore(text, 3)).toBe(1);
    expect(clusterStartBefore("ab", 2)).toBe(1);
    expect(clusterStartBefore(`a\n${FLAG}`, 2 + FLAG.length)).toBe(2);
  });

  it("types an emoji key like a letter", () => {
    for (const key of ["a", "é", "😀", FAMILY, FLAG]) expect(isTypedKey(key), key).toBe(true);
    for (const key of ["Enter", "ArrowLeft", "Dead", "F1", "😀😀"]) expect(isTypedKey(key), key).toBe(false);
  });

  it("deletes and steps over an emoji at once", () => {
    const value = `hi ${FAMILY}`;
    const end = { value, anchor: value.length, caret: value.length };
    const none = { shift: false, alt: false, meta: false, ctrl: false };
    expect(editingKey(end, "Backspace", none).state?.value).toBe("hi ");
    expect(editingKey(end, "ArrowLeft", none).state?.caret).toBe(3);
    const start = { value, anchor: 3, caret: 3 };
    expect(editingKey(start, "Delete", none).state?.value).toBe("hi ");
    expect(editingKey(start, "ArrowRight", none).state?.caret).toBe(value.length);
  });
});

describe("the Emoji family", () => {
  beforeAll(() => loadEmoji());

  it("stays out of font menus", () => {
    expect(listFonts()).not.toContain(EMOJI_FAMILY);
  });

  it("falls back to the largest strike that fits the cell", () => {
    expect(emojiFace(requireFont("body").glyphHeight)?.size).toBe(10);
    expect(emojiFace(requireFont("menu").glyphHeight)?.size).toBe(12);
    expect(emojiFace(requireFont("monaco", 12).glyphHeight)?.size).toBe(14);
    expect(emojiFace(requireFont("geneva", 24).glyphHeight)?.size).toBe(24);
    expect(emojiFace(4)?.size).toBe(10);
  });

  it("draws emoji a face lacks, plain, at the emoji strike's size", () => {
    const font = requireFont("menu");
    const [glyph] = glyphs("menu", 12, "😀");
    expect(glyph?.emoji).toBe(true);
    expect(textAdvance(font, "😀")).toBe(13 + font.spacing);
    const runs = uiTextRuns(font, "Hi 😀!");
    expect(runs.map((run) => run.emojiSize)).toEqual([undefined, 12, undefined]);
    expect(runs[1]!.faceKey).toBe(`emoji\u0001p${0x1f6 + 1}~s${font.spacing}`);
    expect(runs[2]!.x).toBe(textAdvance(font, "Hi 😀"));
  });

  it("hands QuickDraw the emoji strike unscaled", () => {
    const run = uiTextRuns(requireFont("menu"), "😀")[0]!;
    const out = hostSwapFont({
      family: fontFamilyId(run.faceKey!),
      size: run.emojiSize!,
      face: 0,
      needBits: true,
      device: 0,
      numer: { h: 1, v: 1 },
      denom: { h: 1, v: 1 },
    });
    expect(out.numer).toEqual(out.denom);
    expect(out.ascent).toBe(12);
  });

  it("draws sequences as one glyph", () => {
    for (const seq of [FAMILY, FLAG, KEYCAP, SCOTLAND, "❤️‍🔥", "🏳️‍🌈"]) {
      expect(glyphs("body", 9, seq), seq).toHaveLength(1);
      expect(glyphs("body", 9, seq)[0]!.emoji, seq).toBe(true);
    }
    // Noto draws no skin tones: the base emoji, not the base and a swatch.
    expect(textAdvance(requireFont("body"), "👍🏽")).toBe(textAdvance(requireFont("body"), "👍"));
  });

  it("draws an unknown sequence as its parts", () => {
    expect(glyphs("body", 9, "😀‍😀")).toHaveLength(2);
    expect(glyphs("body", 9, "🇦🇦")).toHaveLength(2);
  });

  it("takes no room for joiners and selectors on their own", () => {
    const font = requireFont("body");
    expect(textAdvance(font, "a‍b️")).toBe(textAdvance(font, "ab"));
  });

  it("keeps a face's own glyph unless emoji presentation is asked for", () => {
    expect(glyphs("menu", 12, "™")[0]!.emoji).toBe(false);
    expect(glyphs("menu", 12, "™️")[0]!.emoji).toBe(true);
    expect(glyphs("menu", 12, "©︎")[0]!.emoji).toBe(false);
  });

  it("puts a click before or after a whole emoji, never inside", () => {
    const font = requireFont("body");
    const text = `a${FAMILY}b`;
    const a = textAdvance(font, "a");
    const family = textAdvance(font, FAMILY);
    expect(charIndexAtX(font, text, a + 1)).toBe(1);
    expect(charIndexAtX(font, text, a + family - 1)).toBe(1 + FAMILY.length);
  });

  it("underlines around the emoji's ink", () => {
    const font = requireFont("body");
    const width = textAdvance(font, "😀");
    const covered = underlineSpans(font, "😀").reduce((sum, span) => sum + span.right - span.left, 0);
    expect(covered).toBeLessThan(width);
  });

  it("loads once", async () => {
    const before = fontsVersion();
    await loadEmoji();
    expect(fontsVersion()).toBe(before);
    expect(glyphAdvance(emojiFace(10)!, 0)).toBeGreaterThan(0);
  });
});
