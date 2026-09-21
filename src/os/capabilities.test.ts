import { describe, expect, it } from "vitest";
import { describeMissingCapabilities, missingCapabilities, platformCapabilities } from "./capabilities";
import { createHeadlessPlatform } from "../platform/headless";

describe("capabilities", () => {
  it("derives service capabilities from the platform's services", () => {
    const bare = createHeadlessPlatform({ width: 8, height: 8 });
    expect([...platformCapabilities(bare)]).toEqual(["fonts"]);

    const connected = {
      ...bare,
      fetch: async () => ({}) as never,
      camera: { open: async () => ({ frame: () => null, width: 0, height: 0, close() {} }) },
    };
    expect([...platformCapabilities(connected)].sort()).toEqual(["camera", "fonts", "network"]);

    const withDownload = { ...bare, download: { save: async () => {} } };
    expect([...platformCapabilities(withDownload)].sort()).toEqual(["download", "fonts"]);

    const withSpeaker = createHeadlessPlatform({ width: 8, height: 8, audioSampleRate: 48000 });
    expect([...platformCapabilities(withSpeaker)].sort()).toEqual(["audio", "fonts"].sort());

    const withMicrophone = createHeadlessPlatform({ width: 8, height: 8, microphoneSampleRate: 48000 });
    expect([...platformCapabilities(withMicrophone)].sort()).toEqual(["microphone", "fonts"].sort());
    expect(describeMissingCapabilities("TP-7", ["microphone"])).toBe(
      '"TP-7" needs a microphone, which this Macintosh does not have.'
    );

    const agentRuntime = { engine: "scripted", createSession: async () => ({}) as never };
    const withAgents = createHeadlessPlatform({ width: 8, height: 8, agentRuntime });
    expect([...platformCapabilities(withAgents)].sort()).toEqual(["agent-runtime", "fonts"].sort());
    expect(describeMissingCapabilities("fx", ["agent-runtime"])).toBe(
      '"fx" needs a way to run AI agents, which this Macintosh does not have.'
    );
  });

  it("lists what is missing, in declaration order", () => {
    const caps = new Set(["network"] as const);
    expect(missingCapabilities(["camera", "network", "video"], caps)).toEqual(["camera", "video"]);
    expect(missingCapabilities(undefined, caps)).toEqual([]);
  });

  it("explains the gap in plain words", () => {
    expect(describeMissingCapabilities("Photo Booth", ["camera"])).toBe(
      '"Photo Booth" needs a camera, which this Macintosh does not have.'
    );
    expect(describeMissingCapabilities("Spotify", ["network", "browser"])).toBe(
      '"Spotify" needs a network connection and a web browser, which this Macintosh does not have.'
    );
    expect(describeMissingCapabilities("X", ["network", "camera", "video"])).toBe(
      '"X" needs a network connection, a camera and video playback, which this Macintosh does not have.'
    );
    expect(describeMissingCapabilities("Foundry", ["fonts"])).toBe(
      '"Foundry" needs TrueType rasterizing, which this Macintosh does not have.',
    );
  });
});
