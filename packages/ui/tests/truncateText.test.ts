import { describe, expect, it } from "vitest";
import { measureText, truncateText } from "../src";

describe("truncateText", () => {
  it("leaves text that fits alone", () => {
    expect(truncateText("Desktop", measureText("Desktop", "menu"), "menu")).toBe("Desktop");
  });

  it("cuts at the end to the widest prefix that fits with an ellipsis", () => {
    const width = measureText("Mockintosh…", "menu");
    expect(truncateText("Mockintosh HD", width, "menu")).toBe("Mockintosh…");
    expect(truncateText("Mockintosh HD", width - 1, "menu")).toBe("Mockintos…");
  });

  it("drops a space before the ellipsis", () => {
    expect(truncateText("Hello, Mockintosh", measureText("Hello,…", "menu"), "menu")).toBe("Hello,…");
  });

  it("gives nothing when not even one character and the ellipsis fit", () => {
    expect(truncateText("Mockintosh", 3, "menu")).toBe("");
  });
});
