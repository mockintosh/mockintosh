import { describe, expect, it } from "vitest";
import { decodeWav, encodeWav } from "../src/audio";
import { readWavChunk, readWavMarkers, setWavChunk, setWavMarkers } from "../src/wav";

function ramp(frames: number): Float32Array {
  return Float32Array.from({ length: frames }, (_, i) => Math.sin(i / 7) * 0.5);
}

describe("WAV markers", () => {
  it("round-trips cue points and leaves the audio untouched", () => {
    const plain = encodeWav([ramp(1000)], 8000);
    expect(readWavMarkers(plain)).toEqual([]);

    const marked = setWavMarkers(plain, [700, 100, 100, 400.4]);
    expect(readWavMarkers(marked)).toEqual([100, 400, 700]);
    expect(decodeWav(marked)!.channels[0]).toEqual(decodeWav(plain)!.channels[0]);
    expect(new TextDecoder().decode(marked.subarray(0, 4))).toBe("RIFF");
    expect(new DataView(marked.buffer).getUint32(4, true)).toBe(marked.length - 8);

    const remarked = setWavMarkers(marked, [250]);
    expect(readWavMarkers(remarked)).toEqual([250]);
    expect(setWavMarkers(remarked, [])).toEqual(plain);
  });

  it("drops marks outside the audio and ignores what isn't a WAVE file", () => {
    const wav = encodeWav([ramp(10), ramp(10)], 8000);
    expect(readWavMarkers(setWavMarkers(wav, [-1, 5, 10, 11]))).toEqual([5, 10]);
    expect(readWavMarkers(new Uint8Array([1, 2, 3]))).toEqual([]);
    expect(() => setWavMarkers(new Uint8Array(20), [1])).toThrow(/WAVE/);
  });

  it("keeps other chunks and drops cue labels with their points", () => {
    const wav = setWavMarkers(encodeWav([ramp(100)], 8000), [10]);
    const extra = (id: string, body: string) => {
      const bytes = new Uint8Array(8 + body.length + (body.length & 1));
      bytes.set(new TextEncoder().encode(id), 0);
      new DataView(bytes.buffer).setUint32(4, body.length, true);
      bytes.set(new TextEncoder().encode(body), 8);
      return bytes;
    };
    const info = extra("LIST", "INFOISFT\u0005\u0000\u0000\u0000TP-7\u0000");
    const labels = extra("LIST", "adtllabl");
    const joined = new Uint8Array(wav.length + info.length + labels.length);
    joined.set(wav);
    joined.set(info, wav.length);
    joined.set(labels, wav.length + info.length);
    new DataView(joined.buffer).setUint32(4, joined.length - 8, true);

    const text = new TextDecoder("latin1").decode(setWavMarkers(joined, [20, 30]));
    expect(text).toContain("INFOISFT");
    expect(text).not.toContain("adtl");
    expect(readWavMarkers(setWavMarkers(joined, [20, 30]))).toEqual([20, 30]);
  });
});

describe("WAV chunks", () => {
  const text = (value: string) => new TextEncoder().encode(value);

  it("adds, replaces and removes an app's chunk around the audio and the markers", () => {
    const plain = setWavMarkers(encodeWav([ramp(500)], 8000), [50]);
    expect(readWavChunk(plain, "app ")).toBeNull();

    const tagged = setWavChunk(plain, "app ", text("odd"));
    expect(new TextDecoder().decode(readWavChunk(tagged, "app ")!)).toBe("odd");
    expect(tagged.length % 2).toBe(0);
    expect(new DataView(tagged.buffer).getUint32(4, true)).toBe(tagged.length - 8);
    expect(decodeWav(tagged)!.channels[0]).toEqual(decodeWav(plain)!.channels[0]);
    expect(readWavMarkers(tagged)).toEqual([50]);

    const retagged = setWavChunk(tagged, "app ", text("even"));
    expect(new TextDecoder().decode(readWavChunk(retagged, "app ")!)).toBe("even");
    expect(retagged.length).toBe(tagged.length);
    expect(setWavChunk(retagged, "app ", null)).toEqual(plain);
  });

  it("won't touch the sound's own chunks, odd ids, or what isn't a WAVE file", () => {
    const wav = encodeWav([ramp(10)], 8000);
    expect(() => setWavChunk(wav, "data", text("x"))).toThrow(/sound itself/);
    expect(() => setWavChunk(wav, "toolong", text("x"))).toThrow(/four/);
    expect(() => setWavChunk(new Uint8Array(20), "app ", text("x"))).toThrow(/WAVE/);
    expect(readWavChunk(new Uint8Array([1, 2, 3]), "app ")).toBeNull();
  });
});
