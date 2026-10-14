import { describe, expect, it } from "vitest";
import { EMOJI_FAMILY, emojiFace, emojiSequence, loadEmoji } from "../src/fonts/emoji";
import { listFontSizes } from "../src/fonts/registry";

// Its own file: the Emoji module's loaded strikes are per test file.
describe("loading the Emoji family", () => {
  it("loads only the sizes text needs, with the sequences", async () => {
    expect(emojiFace(13)).toBeUndefined();
    await loadEmoji([12]);
    expect(emojiFace(13)?.size).toBe(12);
    expect(listFontSizes(EMOJI_FAMILY)).toEqual([12]);
    expect(emojiSequence("🇸🇪")).toBeDefined();
    expect(emojiFace(10)).toBeUndefined();
  });
});
