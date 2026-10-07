import { describe, expect, it } from "vitest";
import { DEFAULT_BOOKMARKS, addBookmark, parseBookmarks, removeBookmark, serializeBookmarks } from "./bookmarks";

describe("bookmarks", () => {
  it("are the defaults until the file exists, and whatever it lists after", () => {
    expect(parseBookmarks(null)).toEqual(DEFAULT_BOOKMARKS);
    expect(parseBookmarks("[]")).toEqual([]);
    const saved = serializeBookmarks([{ title: "Example", url: "https://example.com/" }]);
    expect(parseBookmarks(saved)).toEqual([{ title: "Example", url: "https://example.com/" }]);
  });

  it("drop entries a hand-edited file broke, and name the ones left nameless", () => {
    const text = JSON.stringify([{ title: "Bad", url: "javascript:alert(1)" }, { url: "https://www.example.com/a" }, 7, { title: "Ok", url: "http://ok.test/" }]);
    expect(parseBookmarks(text)).toEqual([
      { title: "example.com", url: "https://www.example.com/a" },
      { title: "Ok", url: "http://ok.test/" },
    ]);
    expect(parseBookmarks("{not json")).toEqual(DEFAULT_BOOKMARKS);
  });

  it("add at the end, and rename one already at that address", () => {
    const one = addBookmark([], { title: "  A  ", url: "https://a.test/" });
    expect(one).toEqual([{ title: "A", url: "https://a.test/" }]);
    const two = addBookmark(one, { title: "B", url: "https://b.test/" });
    expect(addBookmark(two, { title: "", url: "https://a.test/" })).toEqual([
      { title: "a.test", url: "https://a.test/" },
      { title: "B", url: "https://b.test/" },
    ]);
    expect(removeBookmark(two, "https://a.test/")).toEqual([{ title: "B", url: "https://b.test/" }]);
  });
});
