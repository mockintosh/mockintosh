import { describe, expect, it } from "vitest";
import { createHeadlessAudio } from "./audio";

describe("headless speaker monitor", () => {
  it("reads back the mix of every stream, mono in both sides", async () => {
    const audio = createHeadlessAudio(48000);
    await audio.open({ channels: 1, render: ({ channels }) => channels[0]!.fill(0.25) });
    await audio.open({
      channels: 2,
      render: ({ channels }) => {
        channels[0]!.fill(0.5);
        channels[1]!.fill(-0.125);
      },
    });
    const monitor = await audio.monitor();
    audio.advance(256);
    const left = new Float32Array(64);
    const right = new Float32Array(64);
    monitor.read(left, right);
    expect([...new Set(left)]).toEqual([0.75]);
    expect([...new Set(right)]).toEqual([0.125]);
  });

  it("pads the start with silence when less has played than was asked for", async () => {
    const audio = createHeadlessAudio(48000);
    await audio.open({ channels: 1, render: ({ channels }) => channels[0]!.fill(1) });
    const monitor = await audio.monitor();
    audio.advance(10);
    const left = new Float32Array(16);
    const right = new Float32Array(16);
    monitor.read(left, right);
    expect([...left.subarray(0, 6)]).toEqual([0, 0, 0, 0, 0, 0]);
    expect([...left.subarray(6)].every((v) => v === 1)).toBe(true);
  });

  it("keeps only the latest frames and hears nothing once closed", async () => {
    const audio = createHeadlessAudio(48000);
    let sample = 0;
    await audio.open({
      channels: 1,
      render: ({ channels, frames }) => {
        for (let i = 0; i < frames; i++) channels[0]![i] = sample++;
      },
    });
    const monitor = await audio.monitor();
    audio.advance(10000);
    const left = new Float32Array(4);
    const right = new Float32Array(4);
    monitor.read(left, right);
    expect([...left]).toEqual([9996, 9997, 9998, 9999]);
    monitor.close();
    monitor.read(left, right);
    expect([...left]).toEqual([0, 0, 0, 0]);
  });
});
