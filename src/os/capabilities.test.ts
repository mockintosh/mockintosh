import { describe, expect, it } from "vitest";
import { describeMissingCapabilities, missingCapabilities, platformCapabilities } from "./capabilities";
import { createHeadlessPlatform } from "../platform/headless";

describe("capabilities", () => {
  it("derives service capabilities from the platform's services", () => {
    const bare = createHeadlessPlatform({ width: 8, height: 8 });
    expect([...platformCapabilities(bare)]).toEqual([]);

    const connected = {
      ...bare,
      fetch: async () => ({}) as never,
      camera: { open: async () => ({ frame: () => null, width: 0, height: 0, close() {} }) },
    };
    expect([...platformCapabilities(connected)].sort()).toEqual(["camera", "network"]);

    const withDownload = { ...bare, download: { save: async () => {} } };
    expect([...platformCapabilities(withDownload)]).toEqual(["download"]);

    const withSpeaker = createHeadlessPlatform({ width: 8, height: 8, audioSampleRate: 48000 });
    expect([...platformCapabilities(withSpeaker)]).toEqual(["audio"]);

    const withMicrophone = createHeadlessPlatform({ width: 8, height: 8, microphoneSampleRate: 48000 });
    expect([...platformCapabilities(withMicrophone)]).toEqual(["microphone"]);
    expect(describeMissingCapabilities("TP-7", ["microphone"])).toBe(
      '"TP-7" needs a microphone, which this Macintosh does not have.'
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
  });
});
