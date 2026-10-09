import { describe, expect, it } from "vitest";
import { evaluate, formatNumber } from "./calculator";
import { flatten, scoreTitle, search, sectionJump, TOP_HIT_LABEL, type Candidate } from "./search";

function candidate(title: string, category: Candidate["category"], extra: Partial<Candidate> = {}): Candidate {
  return { key: `${category}:${title}`, title, category, kind: category, open: () => {}, ...extra };
}

describe("scoreTitle", () => {
  it("ranks whole name, then prefix, word start, initials, substring", () => {
    const exact = scoreTitle("safari", "Safari");
    const prefix = scoreTitle("saf", "Safari");
    const word = scoreTitle("booth", "Photo Booth");
    const acronym = scoreTitle("pb", "Photo Booth");
    const inside = scoreTitle("oot", "Photo Booth");
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(acronym);
    expect(acronym).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(0);
  });

  it("ignores case and accents, and matches CamelCase humps", () => {
    expect(scoreTitle("cafe", "Café Notes")).toBeGreaterThan(0);
    expect(scoreTitle("mp", "MacPaint")).toBeGreaterThan(0);
  });

  it("matches every query word at a word start, in any order", () => {
    expect(scoreTitle("notes trip", "Trip Notes 1987")).toBeGreaterThan(0);
    expect(scoreTitle("notes moon", "Trip Notes 1987")).toBe(0);
  });

  it("finds keywords", () => {
    expect(scoreTitle("settings", "Control Panel", ["settings", "preferences"])).toBeGreaterThan(0);
  });
});

describe("search", () => {
  const items = [
    candidate("MacPaint", "applications"),
    candidate("MacPaint Notes", "documents"),
    candidate("Macintosh HD", "folders"),
    candidate("Mac Synth", "appstore"),
    candidate("Read Me", "documents"),
  ];

  it("puts the best match up as the Top Hit and leaves it out of its own section", () => {
    const sections = search("macp", items);
    expect(sections[0].label).toBe(TOP_HIT_LABEL);
    expect(sections[0].hits[0].title).toBe("MacPaint");
    expect(sections.map((s) => s.label)).toEqual([TOP_HIT_LABEL, "Documents"]);
  });

  it("prefers an app to a document of the same name", () => {
    expect(search("macpaint", items)[0].hits[0].category).toBe("applications");
  });

  it("never makes an App Store suggestion the Top Hit", () => {
    const sections = search("mac s", items);
    expect(sections.find((s) => s.label === TOP_HIT_LABEL)).toBeUndefined();
    expect(flatten(sections).map((h) => h.title)).toContain("Mac Synth");
  });

  it("returns nothing for an empty query", () => {
    expect(search("  ", items)).toEqual([]);
  });

  it("jumps between sections", () => {
    const sections = search("mac", items);
    const sizes = sections.map((s) => s.hits.length);
    expect(sizes.length).toBeGreaterThan(2);
    expect(sectionJump(sections, 0, 1)).toBe(sizes[0]);
    expect(sectionJump(sections, sizes[0] + sizes[1], -1)).toBe(sizes[0]);
    expect(sectionJump(sections, sizes[0], -1)).toBe(0);
  });
});

describe("calculator", () => {
  it("evaluates arithmetic with precedence, powers, percent and functions", () => {
    expect(evaluate("2+2")).toBe(4);
    expect(evaluate("2 + 3 * 4")).toBe(14);
    expect(evaluate("(2+3)*4")).toBe(20);
    expect(evaluate("2^10")).toBe(1024);
    expect(evaluate("2**3**2")).toBe(512);
    expect(evaluate("50%")).toBe(0.5);
    expect(evaluate("sqrt(16)")).toBe(4);
    expect(evaluate("3x4")).toBe(12);
    expect(evaluate("10 ÷ 4")).toBe(2.5);
    expect(evaluate("-3 + 1")).toBe(-2);
    expect(evaluate("2pi + 1")).toBeCloseTo(2 * Math.PI + 1);
  });

  it("leaves searches alone", () => {
    expect(evaluate("42")).toBeNull();
    expect(evaluate("pi")).toBeNull();
    expect(evaluate("safari")).toBeNull();
    expect(evaluate("2 +")).toBeNull();
    expect(evaluate("1/0")).toBeNull();
    expect(evaluate("taxes 2024")).toBeNull();
  });

  it("formats without float noise", () => {
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(1 / 3)).toBe("0.3333333333");
    expect(formatNumber(1024)).toBe("1024");
  });
});
