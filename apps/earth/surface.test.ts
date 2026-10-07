import { describe, expect, it } from "vitest";
import { SEA, landTone } from "./surface";

const DEG = Math.PI / 180;
const at = (lat: number, lon: number) => landTone(lat * DEG, lon * DEG);

describe("surface", () => {
  it("reads the Blue Marble: deserts pale, rainforest dark, ice white", () => {
    const sahara = at(23, 10);
    const congo = at(0, 22);
    const amazon = at(-4, -62);
    expect(sahara).toBeGreaterThan(congo + 0.25);
    expect(sahara).toBeGreaterThan(amazon + 0.25);
    expect(at(-80, 0)).toBeGreaterThan(0.85); // Antarctica
    expect(at(72, -40)).toBeGreaterThan(0.85); // Greenland
  });

  it("keeps all land brighter than the sea", () => {
    for (const [lat, lon] of [[0, 22], [60, 100], [-4, -62], [45, -90]] as const) expect(at(lat, lon)).toBeGreaterThan(SEA);
  });
});
