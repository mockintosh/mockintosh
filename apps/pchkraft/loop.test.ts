/**
 * The tape: lengthening it keeps what was recorded, and a row reads back.
 */
import { describe, expect, it } from "vitest";
import { createLoop, describeStep, sanitizeLoop, withBars } from "./loop";

describe("loop", () => {
  it("grows without dropping the first bar", () => {
    const loop = createLoop(1);
    loop.kick[0] = 1;
    loop.chords[4] = 2;
    loop.lead[7] = 64;
    const longer = withBars(loop, 4);
    expect(longer.bars).toBe(4);
    expect(longer.kick).toHaveLength(64);
    expect(longer.kick[0]).toBe(1);
    expect(longer.chords[4]).toBe(2);
    expect(longer.lead[7]).toBe(64);
    expect(longer.chords[20]).toBe(-1);
    expect(withBars(longer, 4)).toBe(longer);
  });

  it("describes a step with the playhead marked", () => {
    const loop = createLoop(1);
    loop.kick[0] = 0.9;
    loop.hat[0] = 0.5;
    const row = describeStep(loop, 0, 0, "C", "E4");
    expect(row).toBe(">01 K.H. C E4");
    expect(describeStep(loop, 1, 0, "—", "")).toBe(" 02 .... —");
  });

  it("rejects a loop whose lanes don't match its length", () => {
    expect(sanitizeLoop(null)).toBeNull();
    const loop = createLoop(1);
    expect(sanitizeLoop({ ...loop, bars: 2 })).toBeNull();
    const kept = sanitizeLoop(loop);
    expect(kept?.chords[3]).toBe(-1);
    expect(sanitizeLoop({ ...loop, chords: loop.chords.map(() => 6) })?.chords[0]).toBe(6);
    expect(sanitizeLoop({ ...loop, chords: loop.chords.map(() => 9) })?.chords[0]).toBe(-1);
  });
});
