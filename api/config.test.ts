import { describe, expect, it } from "vitest";
import { DEFAULT_HOST_CONFIG, parseHostConfig } from "../src/shared/hostConfig";
import { hostConfig } from "./config";

describe("host config", () => {
  it("uses our Club on a deployment, and the local one in development, unless named", () => {
    expect(hostConfig({ VERCEL: "1" })).toEqual({ club: "https://club.mockintosh.com", ai: "club" });
    expect(hostConfig({})).toEqual({ club: "http://localhost:3002", ai: "club" });
    expect(hostConfig({ VERCEL: "1", CLUB_URL: "https://club.example.com/" })).toEqual({ club: "https://club.example.com", ai: "club" });
  });

  it("has no Club when CLUB_URL is empty, and each user's key pays unless the deployment's may", () => {
    expect(hostConfig({ VERCEL: "1", CLUB_URL: "" })).toEqual({ club: null, ai: "key" });
    expect(hostConfig({ VERCEL: "1", CLUB_URL: "", AI_ACCESS: "open" })).toEqual({ club: null, ai: "open" });
  });

  it("reads a config from the wire, falling back to the default for nonsense", () => {
    expect(parseHostConfig({ club: "https://club.example.com", ai: "club" })).toEqual({ club: "https://club.example.com", ai: "club" });
    expect(parseHostConfig({ club: null, ai: "open" })).toEqual({ club: null, ai: "open" });
    expect(parseHostConfig({ club: null, ai: "club" })).toEqual({ club: null, ai: "key" });
    expect(parseHostConfig({ club: "javascript:alert(1)" })).toEqual(DEFAULT_HOST_CONFIG);
    expect(parseHostConfig("nope")).toEqual(DEFAULT_HOST_CONFIG);
  });
});
