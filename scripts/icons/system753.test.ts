import { describe, expect, it } from "vitest";
import { searchIcons } from "./search";
import { system753Family, system753Records } from "./system753";

describe("system753Records", () => {
  const records = system753Records();

  it("gives every family its own file", () => {
    expect(new Set(records.map((r) => r.file)).size).toBe(records.length);
  });

  it("finds the Trash with Apple's 32×32 and hand-drawn 16×16", () => {
    const [hit] = searchIcons(records, "trash");
    expect(hit.icon.name).toBe("Trash");
    const family = system753Family(hit.icon.file);
    expect(family?.large?.width).toBe(32);
    expect(family?.small?.width).toBe(16);
  });
});
