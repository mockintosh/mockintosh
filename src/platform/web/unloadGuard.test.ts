import { describe, expect, it } from "vitest";
import { guardUnload, leaveOnPurpose } from "./unloadGuard";

const unload = (target: EventTarget) => {
  const event = new Event("beforeunload", { cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
};

describe("guardUnload", () => {
  it("asks before leaving only while busy, and never on Restart", () => {
    const page = new EventTarget();
    let busy = false;
    guardUnload(() => busy, page);
    expect(unload(page)).toBe(false);
    busy = true;
    expect(unload(page)).toBe(true);
    leaveOnPurpose();
    expect(unload(page)).toBe(false);
  });
});
