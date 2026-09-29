import { describe, expect, it } from "vitest";
import { createFrame } from "../showreel/painter";
import { SCENES, SCENE_GROUPS, stepGroup, stepScene } from "./catalog";
import { Listener, WINDOW } from "./listen";

const RATE = 48000;
const FPS = 60;

/** A little song: a kick on every beat under a pad that walks A, C#, E. */
function song(t: number): [number, number] {
  const beat = t % 0.5;
  const kick = 0.6 * Math.exp(-beat * 18) * Math.sin(2 * Math.PI * (55 + 80 * Math.exp(-beat * 40)) * beat);
  const hz = [220, 277.18, 329.63][((Math.floor(t) % 3) + 3) % 3]!;
  const pad = 0.2 * Math.sin(2 * Math.PI * hz * t) + 0.08 * Math.sin(2 * Math.PI * hz * 2.01 * t);
  return [kick + pad, kick + pad * 0.8];
}

function feed(listener: Listener, frameIndex: number, silent: boolean): void {
  const left = new Float32Array(WINDOW);
  const right = new Float32Array(WINDOW);
  const now = frameIndex / FPS;
  for (let i = 0; i < WINDOW; i++) {
    const [l, r] = silent ? [0, 0] : song(now - (WINDOW - i) / RATE);
    left[i] = l;
    right[i] = r;
  }
  listener.hear(left, right, 1 / FPS);
}

describe("visualizer scenes", () => {
  it("have unique ids, and the arrows reach every one", () => {
    expect(new Set(SCENES.map((scene) => scene.id)).size).toBe(SCENES.length);
    let scene = SCENES[0]!;
    const seen = new Set<string>();
    for (let k = 0; k < SCENES.length; k++) {
      seen.add(scene.id);
      scene = stepScene(scene, 1);
    }
    expect(seen.size).toBe(SCENES.length);
    expect(stepScene(SCENES[0]!, -1)).toBe(SCENES[SCENES.length - 1]);
    expect(stepGroup(SCENES[0]!, 1)).toBe(SCENE_GROUPS[1]!.scenes[0]);
    expect(stepGroup(SCENES[0]!, -1)).toBe(SCENE_GROUPS[SCENE_GROUPS.length - 1]!.scenes[0]);
  });

  it.each(SCENES.map((scene) => [scene.title, scene] as const))("%s paints to music, silence and a resize", (_title, definition) => {
    const scene = definition.create();
    const listener = new Listener(RATE);
    const small = createFrame(320, 200);
    const large = createFrame(512, 342);
    let busiest = 0;
    const started = performance.now();
    for (let f = 1; f <= 150; f++) {
      feed(listener, f, false);
      const frame = f % 50 === 0 ? large : small;
      scene.render(frame, listener);
      if (f > 60) {
        let white = 0;
        for (const px of frame.pixels) if (px === 0) white++;
        const mixed = Math.min(white, frame.pixels.length - white) / frame.pixels.length;
        busiest = Math.max(busiest, mixed);
      }
    }
    const perFrame = (performance.now() - started) / 150;
    for (let f = 151; f <= 200; f++) {
      feed(listener, f, true);
      scene.render(small, listener);
    }
    // Something on screen besides one flat colour, and quick enough for 60 fps-ish.
    expect(busiest).toBeGreaterThan(0.005);
    expect(perFrame).toBeLessThan(40);
    expect(small.pixels.every((px) => px === 0 || px === 1)).toBe(true);
  });
});
