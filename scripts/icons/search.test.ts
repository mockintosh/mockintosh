import { describe, expect, it } from "vitest";
import { scoreIcon, searchIcons } from "./search";
import type { IconRecord } from "./types";

function icon(partial: Partial<IconRecord> & Pick<IconRecord, "file" | "name">): IconRecord {
  return {
    collection: "",
    category: "object",
    themes: [],
    vibes: [],
    description: "",
    ...partial,
  };
}

describe("scoreIcon", () => {
  it("ranks an exact display name above a theme hit", () => {
    const caution = icon({
      file: "Icon Collection--Caution.png",
      name: "Caution",
      category: "symbol",
      themes: ["warning"],
    });
    const themed = icon({
      file: "other--tape.png",
      name: "Hazard Tape",
      themes: ["caution", "warning"],
    });
    expect(scoreIcon(caution, "caution").nameRank).toBeGreaterThan(
      scoreIcon(themed, "caution").nameRank
    );
  });

  it("counts the query tokens that hit, so extra synonyms do not hide a match", () => {
    const stop = icon({
      file: "Icon Collection--App Stop.png",
      name: "App Stop",
      description: "octagonal stop sign",
    });
    expect(scoreIcon(stop, "stop").matched).toBe(1);
    expect(scoreIcon(stop, "stop banana").score).toBeGreaterThan(0);
    expect(scoreIcon(stop, "stop sign banana").matched).toBe(2);
    expect(scoreIcon(stop, "banana").score).toBe(0);
  });
});

describe("searchIcons", () => {
  const catalog = [
    icon({
      file: "Icon Collection--Caution.png",
      name: "Caution",
      category: "symbol",
      themes: ["alert", "warning"],
    }),
    icon({
      file: "Icon Collection--Bomb.png",
      name: "Bomb",
      category: "symbol",
      description: "classic system error bomb",
    }),
    icon({
      file: "edibles--juicy.png",
      name: "Juicy",
      category: "food",
    }),
  ];

  it("ranks icons that match more tokens first", () => {
    const hits = searchIcons(catalog, "warning alert bomb");
    expect(hits.map((hit) => hit.icon.name)).toEqual(["Caution", "Bomb"]);
  });

  it("filters by category and respects limit", () => {
    const hits = searchIcons(catalog, "bomb caution juicy", { category: "symbol" });
    expect(hits.map((hit) => hit.icon.name)).not.toContain("Juicy");
    const bomb = searchIcons(catalog, "bomb", { category: "symbol", limit: 1 });
    expect(bomb).toHaveLength(1);
    expect(bomb[0].icon.name).toBe("Bomb");
  });
});
