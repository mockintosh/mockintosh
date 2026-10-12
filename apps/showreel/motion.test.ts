import { describe, expect, it } from "vitest";
import { motionReel, type MotionDocument } from "./motion";

describe("motion documents", () => {
  it("name the reel they were written for", () => {
    const doc: MotionDocument = { version: 1, reel: "keeper" };
    expect(motionReel(JSON.parse(JSON.stringify(doc)))).toBe("keeper");
  });

  it("name no reel when the file isn't one", () => {
    for (const raw of [null, "keeper", 3, {}, { reel: "" }, { reel: 7 }]) expect(motionReel(raw)).toBeNull();
  });
});
