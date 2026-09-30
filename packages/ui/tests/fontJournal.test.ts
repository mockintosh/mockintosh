import { describe, expect, it } from "vitest";
import { BUILTIN_STRIKES } from "../src/fonts/families";
import {
  fontRegistrations,
  getFont,
  onFontRegistration,
  registerFont,
  replayFontRegistration,
  unregisterFamily,
  type FontRegistration,
} from "../src/fonts/registry";

const strike = BUILTIN_STRIKES[0]!;

describe("the font registration journal", () => {
  it("records what was installed after boot, so another registry can replay it", () => {
    const heard: FontRegistration[] = [];
    const stop = onFontRegistration((r) => heard.push(r));
    registerFont("journaltest", strike.data, strike.size);
    stop();
    expect(heard).toEqual([{ op: "font", name: "journaltest", data: strike.data, size: strike.size }]);
    expect(fontRegistrations()).toContainEqual(heard[0]);
    expect(getFont("journaltest", strike.size)).not.toBeNull();
  });

  it("forgets a family's registrations when it's removed, and tells listeners", () => {
    registerFont("journalgone", strike.data, strike.size);
    const heard: FontRegistration[] = [];
    const stop = onFontRegistration((r) => heard.push(r));
    unregisterFamily("journalgone");
    stop();
    expect(heard).toEqual([{ op: "unregister", family: "journalgone" }]);
    expect(fontRegistrations().some((r) => r.op === "font" && r.name === "journalgone")).toBe(false);
  });

  it("replays a registration", () => {
    replayFontRegistration({ op: "font", name: "journalreplay", data: strike.data, size: strike.size });
    expect(getFont("journalreplay", strike.size)).not.toBeNull();
  });
});
