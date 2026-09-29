import { describe, expect, it } from "vitest";
import { Op1Engine } from "./engine";
import {
  ACCENT_VELOCITY,
  MAX_HOLD,
  MAX_STEPS,
  STEP_VALUES,
  StepSequencer,
  clearPattern,
  doublePattern,
  emptyPattern,
  hasSteps,
  sanitizePattern,
  setAccent,
  setHold,
  toggleStep,
  VELOCITY,
  type Pattern,
  type SequencerTarget,
} from "./sequencer";

interface Event {
  kind: "on" | "off";
  value: number;
  frame: number;
}

function recorder(): { target: SequencerTarget; events: Event[] } {
  const events: Event[] = [];
  return {
    events,
    target: {
      noteOn: (value, _velocity, frame) => events.push({ kind: "on", value, frame }),
      noteOff: (value, frame) => events.push({ kind: "off", value, frame }),
    },
  };
}

/** Run `seq` for `steps` steps of `stepFrames` frames, `chunk` frames at a time. */
function run(seq: StepSequencer, target: SequencerTarget, steps: number, stepFrames = 100, chunk = 16): void {
  const frames = steps * stepFrames;
  for (let at = 0; at < frames; at += chunk) {
    const n = Math.min(chunk, frames - at);
    seq.advance(n / stepFrames, at, n, target);
  }
}

const pattern = (length: number, steps: Record<number, number[]>, extra: Partial<Pattern> = {}): Pattern => ({
  ...emptyPattern(),
  length,
  steps: emptyPattern().steps.map((_, i) => steps[i] ?? []),
  ...extra,
});

describe("pattern editing", () => {
  it("toggles values on a step, sorted, keeping the highest when full", () => {
    let p = toggleStep(emptyPattern(), 3, 64);
    p = toggleStep(p, 3, 60);
    expect(p.steps[3]).toEqual([60, 64]);
    p = toggleStep(p, 3, 64);
    expect(p.steps[3]).toEqual([60]);
    for (let n = 0; n < STEP_VALUES + 2; n++) p = toggleStep(p, 5, 50 + n);
    expect(p.steps[5]).toHaveLength(STEP_VALUES);
    expect(p.steps[5]![STEP_VALUES - 1]).toBe(50 + STEP_VALUES + 1);
  });

  it("doubles a pattern into a copy of itself and clears it", () => {
    const p = doublePattern(pattern(4, { 0: [36], 2: [38] }));
    expect(p.length).toBe(8);
    expect(p.steps[4]).toEqual([36]);
    expect(p.steps[6]).toEqual([38]);
    expect(hasSteps(p)).toBe(true);
    expect(hasSteps(clearPattern(p))).toBe(false);
    expect(doublePattern({ ...p, length: MAX_STEPS }).length).toBe(MAX_STEPS);
  });

  it("sanitizes stored patterns", () => {
    const p = sanitizePattern({ length: 999, steps: [[3, 3, 1, 99, -1, 2.5, "x"]], swing: 7, gate: 0, running: false }, 24);
    expect(p.length).toBe(MAX_STEPS);
    expect(p.steps[0]).toEqual([1, 3]);
    expect(p.steps).toHaveLength(MAX_STEPS);
    expect(p.swing).toBe(1);
    expect(p.gate).toBe(0.05);
    expect(p.running).toBe(false);
    expect(sanitizePattern(null, 24)).toEqual(emptyPattern());
  });

  it("holds and accents a filled step, and forgets both when it empties", () => {
    let p = toggleStep(emptyPattern(), 2, 60);
    p = setAccent(setHold(p, 2, 4), 2, true);
    expect(p.holds[2]).toBe(4);
    expect(p.accents[2]).toBe(true);
    expect(setHold(p, 2, 99).holds[2]).toBe(MAX_HOLD);
    expect(setHold(p, 2, 0).holds[2]).toBe(1);
    p = toggleStep(p, 2, 60);
    expect(p.holds[2]).toBe(1);
    expect(p.accents[2]).toBe(false);
  });

  it("doubles and clears holds and accents with the notes", () => {
    const p = doublePattern(setAccent(setHold(pattern(4, { 1: [60] }), 1, 3), 1, true));
    expect(p.holds[5]).toBe(3);
    expect(p.accents[5]).toBe(true);
    const cleared = clearPattern(p);
    expect(cleared.holds.every((h) => h === 1)).toBe(true);
    expect(cleared.accents.some(Boolean)).toBe(false);
  });

  it("sanitizes stored holds and accents, and fills them in for old patterns", () => {
    const p = sanitizePattern({ length: 4, steps: [[60], [62]], holds: [40, 2.6, -3, "x"], accents: [true, "yes", 1] }, 128);
    expect(p.holds.slice(0, 4)).toEqual([MAX_HOLD, 3, 1, 1]);
    expect(p.accents.slice(0, 3)).toEqual([true, false, false]);
    expect(p.holds).toHaveLength(MAX_STEPS);
    const old = sanitizePattern({ length: 4, steps: [[60]], swing: 0, gate: 0.5, running: true }, 128);
    expect(old.holds).toEqual(emptyPattern().holds);
    expect(old.accents).toEqual(emptyPattern().accents);
  });
});

describe("StepSequencer", () => {
  it("strikes each step on time and lets go after the gate", () => {
    const seq = new StepSequencer();
    seq.pattern = pattern(4, { 0: [60], 2: [64, 67] }, { gate: 0.5 });
    const { target, events } = recorder();
    seq.start(0, 0);
    run(seq, target, 4);
    expect(events).toEqual([
      { kind: "on", value: 60, frame: 0 },
      { kind: "off", value: 60, frame: 50 },
      { kind: "on", value: 64, frame: 200 },
      { kind: "on", value: 67, frame: 200 },
      { kind: "off", value: 64, frame: 250 },
      { kind: "off", value: 67, frame: 250 },
    ]);
    expect(seq.played.at(199)).toBe(1);
    expect(seq.played.at(200)).toBe(2);
  });

  it("wraps at the pattern's length", () => {
    const seq = new StepSequencer();
    seq.pattern = pattern(3, { 0: [1] });
    const { target, events } = recorder();
    seq.start(0, 0);
    run(seq, target, 7);
    expect(events.filter((e) => e.kind === "on").map((e) => e.frame)).toEqual([0, 300, 600]);
  });

  it("pushes off-beats late by the swing", () => {
    const seq = new StepSequencer();
    seq.pattern = pattern(4, { 0: [1], 1: [1], 2: [1], 3: [1] }, { swing: 1, gate: 0.1 });
    const { target, events } = recorder();
    seq.start(0, 0);
    run(seq, target, 4);
    expect(events.filter((e) => e.kind === "on").map((e) => e.frame)).toEqual([0, 150, 200, 350]);
  });

  it("releases a held note before striking it again", () => {
    const seq = new StepSequencer();
    seq.pattern = pattern(2, { 0: [60], 1: [60] }, { gate: 1, swing: 0 });
    const { target, events } = recorder();
    seq.start(0, 0);
    run(seq, target, 2);
    const at100 = events.filter((e) => e.frame === 100).map((e) => e.kind);
    expect(at100).toEqual(["off", "on"]);
  });

  it("holds a note over the steps after it, letting go after the gate of the last", () => {
    const seq = new StepSequencer();
    seq.pattern = setHold(pattern(8, { 1: [60], 2: [64] }, { gate: 0.5 }), 1, 3);
    const { target, events } = recorder();
    seq.start(0, 0);
    run(seq, target, 8);
    expect(events).toEqual([
      { kind: "on", value: 60, frame: 100 },
      { kind: "on", value: 64, frame: 200 },
      { kind: "off", value: 64, frame: 250 },
      { kind: "off", value: 60, frame: 350 },
    ]);
  });

  it("strikes accented steps harder", () => {
    const seq = new StepSequencer();
    seq.pattern = setAccent(pattern(2, { 0: [60], 1: [62] }), 1, true);
    const velocities: number[] = [];
    const target: SequencerTarget = { noteOn: (_value, velocity) => velocities.push(velocity), noteOff: () => {} };
    seq.start(0, 0);
    run(seq, target, 2);
    expect(velocities).toEqual([VELOCITY, ACCENT_VELOCITY]);
    expect(ACCENT_VELOCITY).toBeGreaterThan(VELOCITY);
  });

  it("starts part-way through, and lets go of everything when stopped", () => {
    const seq = new StepSequencer();
    seq.pattern = pattern(4, { 1: [48], 2: [50] }, { gate: 1 });
    const { target, events } = recorder();
    seq.start(1.5, 0);
    seq.advance(1, 0, 100, target);
    expect(events).toEqual([{ kind: "on", value: 50, frame: 50 }]);
    seq.stop(target, 100);
    expect(events.at(-1)).toEqual({ kind: "off", value: 50, frame: 100 });
    expect(seq.playing).toBe(false);
  });

  it("keeps time but stays quiet when not running", () => {
    const seq = new StepSequencer();
    seq.pattern = pattern(2, { 0: [1] }, { running: false });
    const { target, events } = recorder();
    seq.start(0, 0);
    run(seq, target, 4);
    expect(events).toEqual([]);
    expect(seq.played.at(350)).toBe(1);
  });
});

describe("sequencers in the engine", () => {
  const SR = 8000;
  const render = (engine: Op1Engine, frames: number) => {
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    engine.render({ sampleRate: SR, frames, channels: [left, right], position: engine.position });
    return left;
  };

  it("run with the tape and are silent without it", () => {
    const engine = new Op1Engine(SR);
    engine.tape.settings = [120, 0, 1, 0];
    engine.drumSequencer.pattern = pattern(16, { 0: [0], 4: [2], 8: [0], 12: [2] });
    const idle = render(engine, 4000);
    expect(idle.some((s) => s !== 0)).toBe(false);

    engine.tape.play();
    render(engine, 8000);
    // A step is 1000 frames at 120 BPM and 8 kHz: pads on steps 0, 4 fell at 0 and 4000.
    expect(engine.drumSequencer.played.at(engine.position - 1)).toBe(7);
    expect(engine.padFrames[0]).toBe(4000);
    expect(Math.abs(engine.padFrames[2]! - 8000)).toBeLessThanOrEqual(1);

    engine.tape.stop();
    render(engine, 160);
    expect(engine.drumSequencer.playing).toBe(false);
  });

  it("start from where the tape is", () => {
    const engine = new Op1Engine(SR);
    engine.tape.settings = [120, 0, 1, 0];
    engine.synthSequencer.pattern = pattern(16, { 4: [60] });
    engine.tape.head = 3500;
    engine.tape.play();
    render(engine, 1200);
    // Struck at 500, let go half a step (500 frames) later.
    const held = new Set<number>();
    engine.notes.at(900, held);
    expect(held).toEqual(new Set([60]));
    engine.notes.at(1000, held);
    expect(held).toEqual(new Set());
    // Step 4 is at 4000 frames; the tape started at 3500.
    expect(engine.synthSequencer.played.at(engine.position - 1)).toBe(4);
    expect(engine.synthSequencer.played.at(400)).toBe(-1);
  });
});
