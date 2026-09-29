import { describe, expect, it } from "vitest";
import { fileText, sortEntries, type DirEntry } from "./api";
import { commitSubject, formatAge, formatBytes, formatCount } from "./format";

describe("repository page formatting", () => {
  it("compacts star counts the way the header does", () => {
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1000)).toBe("1k");
    expect(formatCount(1234)).toBe("1.2k");
    expect(formatCount(15_200)).toBe("15k");
  });

  it("formats file sizes and commit age", () => {
    expect(formatBytes(12)).toBe("12 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    const now = Date.parse("2026-09-24T12:00:00Z");
    expect(formatAge("2026-09-24T10:00:00Z", now)).toBe("2h ago");
    expect(commitSubject("Fix the header\n\nLonger body")).toBe("Fix the header");
  });

  it("lists directories before files", () => {
    const entries: DirEntry[] = [
      { name: "README.md", path: "README.md", type: "file", size: 1 },
      { name: "src", path: "src", type: "dir", size: 0 },
      { name: "lib", path: "lib", type: "dir", size: 0 },
    ];
    expect(sortEntries(entries).map((entry) => entry.name)).toEqual(["lib", "src", "README.md"]);
  });

  it("decodes a text file and refuses a binary one", () => {
    expect(fileText(btoa("hello"), "base64", 5)).toEqual({ text: "hello", note: "" });
    expect(fileText(btoa("a\0b"), "base64", 3).text).toBeNull();
  });
});
