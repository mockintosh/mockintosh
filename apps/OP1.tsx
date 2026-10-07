import {
  createEffect,
  createMemo,
  createSignal,
  defineApp,
  encodeWav,
  noteName,
  onCleanup,
  onSettled,
  useApp,
  type AudioStream,
  type AudioStreamState,
  type MenubarItemDef,
} from "@mockintosh/sdk";
import type { JSX } from "@mockintosh/ui";
import { noteHz } from "./synth/dsp";
import { Knob } from "./synth/Knob";
import { formatParam, numberParam } from "./synth/params";
import type { ScopeSource } from "./synth/Scope";
import { KIT_DEFS, PAD_CHOICE, PAD_COUNT, PAD_DEFS, PADS } from "./op1/drums";
import { Op1Engine } from "./op1/engine";
import { BUTTON_H, ENCODER_SIZE, Encoder, EncoderStrip, FaceButton, Keyboard, Screen, Speaker, type IconName } from "./op1/faceplate";
import { FX } from "./op1/fx";
import { sprites } from "./op1/icons";
import { COMPUTER_KEYS, LOW_NOTE } from "./op1/keys";
import { ENCODERS, defaultQuad, isDetented, nudge, percent, withValue, type EncoderIndex, type Quad, type QuadDefs } from "./op1/params";
import { SAMPLE_SECONDS, samplePeaks } from "./op1/sampler";
import { useSampling } from "./op1/sampling";
import {
  COLUMN_W,
  SAMPLE_COLUMNS,
  SCREEN_H,
  STRIP_W,
  patternHit,
  patternPage,
  type PatternView,
  type SampleView,
  type ScreenArt,
  type StripView,
  type TapeView,
} from "./op1/screen";
import {
  GATE_DEF,
  LENGTH_DEF,
  MAX_HOLD,
  MAX_STEPS,
  PAGE_STEPS,
  STEP_DEF,
  SWING_DEF,
  clearPattern,
  clearStep,
  doublePattern,
  emptyPattern,
  setAccent,
  setHold,
  toggleStep,
  wrapStep,
  type Pattern,
} from "./op1/sequencer";
import {
  DEFAULT_VOLUME,
  DRUM_PAGES,
  MIXER_PAGES,
  MAX_OCTAVE,
  MIN_OCTAVE,
  SESSION_KEY,
  SYNTH_PAGES,
  parseJson,
  sanitizeSession,
  type Mode,
  type Session,
} from "./op1/session";
import { ENV_DEFS, FACTORY_SOUNDS, LFO_DEFS, LFO_SHAPES, SLOT_COUNT, defaultKit, factorySound, type DrumKit, type SynthSound } from "./op1/sounds";
import { SAMPLER_ENGINE, SYNTHS, samplerLoops } from "./op1/synths";
import { MIXER_DEFS, PAN_DEFS, TAPE_DEFS } from "./op1/tape";
import { useTapeLibrary } from "./op1/tapeLibrary";
import { DEFAULT_TAPE, DEMO_NAMES, tapeName, type TapeMix, type TapeRef } from "./op1/tapes";

const W = 496;
const PAD = 4;
const GAP = 4;
const INNER_W = W - 2 * PAD;
const SIDE_W = 44;
const KEYS_H = 60;
const H = 2 * PAD + SCREEN_H + BUTTON_H + KEYS_H + 2 * GAP;

/** How long the display shows the value of the encoder last turned. */
const READOUT_MS = 1500;
/** How long a struck pad stays lit, in seconds. */
const PAD_FLASH = 0.15;
type Instrument = "synth" | "drum";
const MODES: readonly { mode: Mode; icon: IconName; label: string }[] = [
  { mode: "synth", icon: "synth", label: "Synth" },
  { mode: "drum", icon: "drum", label: "Drum" },
  { mode: "tape", icon: "tape", label: "Tape" },
  { mode: "mixer", icon: "mixer", label: "Mixer" },
];

const VOLUME = numberParam("volume", "VOL", "VOLUME", 0, 1, DEFAULT_VOLUME, percent);

/** What the encoders are turning now. */
interface Page {
  title: string;
  defs: QuadDefs;
  values: Quad;
  set(index: EncoderIndex, value: number): void;
}

type StreamStatus = "opening" | "failed" | AudioStreamState;

function replaceAt<T>(list: readonly T[], index: number, value: T): T[] {
  return list.map((item, i) => (i === index ? value : item));
}

function formatTime(seconds: number): string {
  const tenths = Math.floor(seconds * 10);
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, "0")}.${tenths % 10}`;
}

function Op1(): JSX.Element {
  const app = useApp();
  const engine = new Op1Engine();
  const tape = engine.tape;

  const [mode, setModeValue] = createSignal<Mode>("synth");
  const [instrument, setInstrument] = createSignal<Instrument>("synth");
  const [synthPage, setSynthPage] = createSignal(0);
  const [drumPage, setDrumPage] = createSignal(0);
  const [sounds, setSounds] = createSignal<readonly SynthSound[]>(FACTORY_SOUNDS);
  const [slot, setSlot] = createSignal(0);
  const [kit, setKit] = createSignal<DrumKit>(defaultKit());
  const [pad, setPad] = createSignal(0);
  const [tapeSettings, setTapeSettings] = createSignal<Quad>(defaultQuad(TAPE_DEFS));
  const [levels, setLevels] = createSignal<Quad>(defaultQuad(MIXER_DEFS));
  const [pans, setPans] = createSignal<Quad>(defaultQuad(PAN_DEFS));
  const [mixerPage, setMixerPage] = createSignal(0);
  const [mutes, setMutes] = createSignal<readonly boolean[]>([false, false, false, false]);
  const [track, setTrack] = createSignal(0);
  const [reverse, setReverse] = createSignal(false);
  const [playing, setPlaying] = createSignal(false);
  const [recording, setRecording] = createSignal(false);
  const [octave, setOctave] = createSignal(0);
  const [volume, setVolume] = createSignal(VOLUME.default);
  const [active, setActive] = createSignal<EncoderIndex | null>(null);
  const [pressed, setPressed] = createSignal<ReadonlySet<number>>(new Set());
  const [streamStatus, setStreamStatus] = createSignal<StreamStatus>(app.audio ? "opening" : "failed");
  const [screenTick, setScreenTick] = createSignal(0);
  const [keysTick, setKeysTick] = createSignal(0);
  const [tapeTenths, setTapeTenths] = createSignal(0);
  const [sequencer, setSequencer] = createSignal(false);
  const [synthPattern, setSynthPattern] = createSignal<Pattern>(emptyPattern());
  const [drumPattern, setDrumPattern] = createSignal<Pattern>(emptyPattern());
  const [synthCursor, setSynthCursor] = createSignal(0);
  const [drumCursor, setDrumCursor] = createSignal(0);

  const showMessage = (message: string) => void app.os.showDialog({ message });
  const sampling = useSampling({ storage: app.storage, audio: app.audio, engine, onError: showMessage });
  const library = useTapeLibrary({
    storage: app.storage,
    os: app.os,
    tape,
    mix: (): TapeMix => ({ settings: tapeSettings(), levels: levels(), pans: pans() }),
    setMix: (mix) => {
      setTapeSettings(mix.settings);
      setLevels(mix.levels);
      setPans(mix.pans);
    },
    onChange: () => {
      syncTransport();
      setScreenTick((n) => n + 1);
    },
  });

  let stream: AudioStream | null = null;
  let loaded = false;

  const sound = () => sounds()[slot()] ?? factorySound(slot());
  const updateSound = (change: (s: SynthSound) => SynthSound) => {
    const at = slot();
    setSounds((list) => replaceAt(list, at, change(list[at] ?? factorySound(at))));
  };

  const instrumentMode = () => mode() === "synth" || mode() === "drum";
  /** The sequencer page is showing: an instrument mode with the pattern up. */
  const showingPattern = () => sequencer() && instrumentMode();
  const drumming = () => instrument() === "drum";
  const sampleActive = () => sampling.state() !== "idle";

  // ---------------------------------------------------------------------------
  // State → engine
  // ---------------------------------------------------------------------------

  createEffect(sound, (next) => {
    engine.sound = next;
  });
  createEffect(kit, (next) => {
    engine.kit = next;
  });
  createEffect(tapeSettings, (next) => {
    tape.settings = next;
  });
  createEffect(levels, (next) => {
    tape.levels = next;
  });
  createEffect(pans, (next) => {
    tape.pans = next;
  });
  createEffect(mutes, (next) => {
    tape.mutes = [next[0] === true, next[1] === true, next[2] === true, next[3] === true];
  });
  createEffect(track, (next) => {
    tape.track = next;
    if (tape.recording) tape.setRecording(true);
  });
  createEffect(reverse, (next) => {
    tape.reverse = next;
  });
  createEffect(volume, (next) => {
    engine.volume = next;
  });
  createEffect(synthPattern, (next) => {
    engine.synthSequencer.pattern = next;
  });
  createEffect(drumPattern, (next) => {
    engine.drumSequencer.pattern = next;
  });
  createEffect(
    () => sampling.sampleFor(slot()),
    (next) => {
      engine.sample = next;
    },
  );

  // ---------------------------------------------------------------------------
  // The pattern of the instrument in hand
  // ---------------------------------------------------------------------------

  const pattern = () => (drumming() ? drumPattern() : synthPattern());
  const editPattern = (change: (p: Pattern) => Pattern) => (drumming() ? setDrumPattern : setSynthPattern)(change);
  const cursor = () => (drumming() ? drumCursor() : synthCursor());
  const setCursor = (step: number) => (drumming() ? setDrumCursor : setSynthCursor)(step);
  const moveCursor = (by: number) => setCursor(wrapStep(pattern(), cursor() + by));
  const sequencerOf = () => (drumming() ? engine.drumSequencer : engine.synthSequencer);

  // ---------------------------------------------------------------------------
  // Pages and encoders
  // ---------------------------------------------------------------------------

  const fxPage = (fx: number, values: Quad, set: (index: EncoderIndex, value: number) => void): Page => ({
    title: FX[fx]?.name ?? "EFFECT",
    defs: FX[fx]!.defs,
    values,
    set,
  });

  const sequencerPage = (): Page => {
    const drum = drumming();
    const p = pattern();
    return {
      title: p.running ? "PATTERN" : "PATTERN OFF",
      defs: [STEP_DEF, LENGTH_DEF, SWING_DEF, drum ? PAD_CHOICE : GATE_DEF],
      values: [cursor() + 1, p.length, p.swing, drum ? pad() : p.gate],
      set: (i, v) => {
        if (i === 0) {
          setCursor(wrapStep(p, Math.round(v) - 1));
        } else if (i === 1) {
          const length = Math.max(1, Math.min(MAX_STEPS, Math.round(v)));
          editPattern((prev) => ({ ...prev, length }));
          setCursor(Math.min(cursor(), length - 1));
        } else if (i === 2) {
          editPattern((prev) => ({ ...prev, swing: v }));
        } else if (drum) {
          setPad(Math.round(v));
        } else {
          editPattern((prev) => ({ ...prev, gate: v }));
        }
      },
    };
  };

  const page = (): Page => {
    const m = mode();
    if (showingPattern()) return sequencerPage();
    if (m === "tape") {
      return { title: "TAPE", defs: TAPE_DEFS, values: tapeSettings(), set: (i, v) => setTapeSettings((q) => withValue(q, i, v)) };
    }
    if (m === "mixer") {
      if (mixerPage() === 1) return { title: "PAN", defs: PAN_DEFS, values: pans(), set: (i, v) => setPans((q) => withValue(q, i, v)) };
      return { title: "MIXER", defs: MIXER_DEFS, values: levels(), set: (i, v) => setLevels((q) => withValue(q, i, v)) };
    }
    if (m === "drum") {
      const k = kit();
      const p = drumPage();
      if (p === 1) {
        return { title: "KIT", defs: KIT_DEFS, values: k.kit, set: (i, v) => setKit((prev) => ({ ...prev, kit: withValue(prev.kit, i, v) })) };
      }
      if (p === 2) {
        return fxPage(k.fx, k.fxParams[k.fx]!, (i, v) =>
          setKit((prev) => ({ ...prev, fxParams: replaceAt(prev.fxParams, prev.fx, withValue(prev.fxParams[prev.fx]!, i, v)) })),
        );
      }
      const n = pad();
      return {
        title: PADS[n]?.name ?? "PAD",
        defs: PAD_DEFS,
        values: k.pads[n]!,
        set: (i, v) => setKit((prev) => ({ ...prev, pads: replaceAt(prev.pads, n, withValue(prev.pads[n]!, i, v)) })),
      };
    }
    const s = sound();
    const p = synthPage();
    if (p === 1) {
      return { title: "ENVELOPE", defs: ENV_DEFS, values: s.env, set: (i, v) => updateSound((x) => ({ ...x, env: withValue(x.env, i, v) })) };
    }
    if (p === 2) {
      return fxPage(s.fx, s.fxParams[s.fx]!, (i, v) =>
        updateSound((x) => ({ ...x, fxParams: replaceAt(x.fxParams, x.fx, withValue(x.fxParams[x.fx]!, i, v)) })),
      );
    }
    if (p === 3) {
      return {
        title: `LFO ${LFO_SHAPES[Math.round(s.lfo[2])] ?? ""}`,
        defs: LFO_DEFS,
        values: s.lfo,
        set: (i, v) => updateSound((x) => ({ ...x, lfo: withValue(x.lfo, i, v) })),
      };
    }
    return {
      title: SYNTHS[s.synth]?.name ?? "ENGINE",
      defs: SYNTHS[s.synth]!.defs,
      values: s.engines[s.synth]!,
      set: (i, v) => updateSound((x) => ({ ...x, engines: replaceAt(x.engines, x.synth, withValue(x.engines[x.synth]!, i, v)) })),
    };
  };

  let readoutTimer: ReturnType<typeof setTimeout> | null = null;
  const touch = (index: EncoderIndex) => {
    setActive(index);
    if (readoutTimer) clearTimeout(readoutTimer);
    readoutTimer = setTimeout(() => {
      readoutTimer = null;
      setActive(null);
    }, READOUT_MS);
  };

  const turn = (index: EncoderIndex, ticks: number) => {
    const current = page();
    current.set(index, nudge(current.defs[index], current.values[index], ticks));
    touch(index);
  };

  const resetEncoder = (index: EncoderIndex) => {
    const current = page();
    current.set(index, current.defs[index].default);
    touch(index);
  };

  // ---------------------------------------------------------------------------
  // Modes and the T1–T4 keys
  // ---------------------------------------------------------------------------

  const cycle = (value: number, count: number, by = 1) => (((value + by) % count) + count) % count;

  /** On the page it already shows, a T key steps through what that page can be. */
  const cycleSynthPage = (t: number) => {
    if (t === 0) updateSound((s) => ({ ...s, synth: cycle(s.synth, SYNTHS.length) }));
    else if (t === 2) updateSound((s) => ({ ...s, fx: cycle(s.fx, FX.length) }));
    else if (t === 3) updateSound((s) => ({ ...s, lfo: withValue(s.lfo, 2, cycle(Math.round(s.lfo[2]), LFO_SHAPES.length)) }));
  };

  const togglePatternRunning = () => editPattern((p) => ({ ...p, running: !p.running }));

  /** Hold the step being entered one step longer or shorter. */
  const stretchEntry = (by: number) => {
    if (!entry) return;
    const { step } = entry;
    editPattern((p) => setHold(p, step, (p.holds[step] ?? 1) + by));
  };

  /**
   * On the pattern page the T keys step back and on, clear the step, and
   * pause the pattern. While synth keys are held into a step, back and on
   * shorten and lengthen it instead.
   */
  const patternKey = (t: number) => {
    if (entry && !drumming() && t < 2) stretchEntry(t === 0 ? -1 : 1);
    else if (t === 0) moveCursor(-1);
    else if (t === 1) moveCursor(1);
    else if (t === 2) editPattern((p) => clearStep(p, cursor()));
    else togglePatternRunning();
  };

  const pressT = (t: number) => {
    const m = mode();
    if (showingPattern()) {
      patternKey(t);
    } else if (m === "tape") {
      setTrack(t);
    } else if (m === "mixer") {
      setMutes((list) => list.map((muted, i) => (i === t ? !muted : muted)));
    } else if (m === "drum") {
      if (t >= DRUM_PAGES.length) return;
      if (drumPage() === t && t === 2) setKit((prev) => ({ ...prev, fx: cycle(prev.fx, FX.length) }));
      setDrumPage(t);
    } else {
      if (synthPage() === t) cycleSynthPage(t);
      setSynthPage(t);
    }
    setActive(null);
  };

  const tLit = (t: number) => {
    const m = mode();
    if (showingPattern()) return t === 3 && pattern().running;
    if (m === "tape") return track() === t;
    if (m === "mixer") return !mutes()[t];
    if (m === "drum") return drumPage() === t;
    return synthPage() === t;
  };

  // ---------------------------------------------------------------------------
  // Playing: the keys, from the mouse and the computer keyboard
  // ---------------------------------------------------------------------------

  /** What each hand is holding: "mouse", or a computer key. */
  const held = new Map<string, { key: number; note: number | null }>();
  const refreshPressed = () => setPressed(new Set([...held.values()].map((h) => h.key)));
  /** Keys are going into this step; the cursor moves past it once they are all let go. */
  let entry: { step: number } | null = null;

  /** Play a key; on the pattern page with the tape stopped, enter it at the cursor, accented if asked. */
  const keyDown = (source: string, key: number, accent = false) => {
    let value: number;
    if (drumming()) {
      value = key;
      engine.hitPad(key);
      setPad(key);
      held.set(source, { key, note: null });
    } else {
      value = LOW_NOTE + 12 * octave() + key;
      engine.noteOn(value);
      held.set(source, { key, note: value });
    }
    if (showingPattern() && !tape.playing) {
      entry ??= { step: cursor() };
      const { step } = entry;
      editPattern((p) => {
        const next = toggleStep(p, step, value);
        return accent && (next.steps[step]?.length ?? 0) > 0 ? setAccent(next, step, true) : next;
      });
    }
    refreshPressed();
  };

  const keyUp = (source: string) => {
    const hand = held.get(source);
    if (!hand) return;
    held.delete(source);
    if (hand.note !== null && ![...held.values()].some((other) => other.note === hand.note)) engine.noteOff(hand.note);
    if (held.size === 0 && entry) {
      const { step } = entry;
      entry = null;
      const p = pattern();
      setCursor(wrapStep(p, step + (drumming() ? 1 : (p.holds[step] ?? 1))));
    }
    refreshPressed();
  };

  const releaseEverything = () => {
    for (const hand of held.values()) if (hand.note !== null) engine.noteOff(hand.note);
    held.clear();
    entry = null;
    refreshPressed();
  };

  const setMode = (next: Mode) => {
    if ((next === "synth" || next === "drum") && next !== instrument()) {
      releaseEverything();
      setInstrument(next);
    }
    setModeValue(next);
    setActive(null);
  };

  /** A mode button: pressed again in the mixer, it turns between levels and pans. */
  const pressMode = (next: Mode) => {
    if (next === "mixer" && mode() === "mixer") setMixerPage((p) => cycle(p, MIXER_PAGES.length));
    setMode(next);
  };

  /** Show or hide the pattern; from the tape or mixer, go to the instrument's pattern. */
  const toggleSequencer = () => {
    if (!instrumentMode()) {
      setMode(instrument());
      setSequencer(true);
    } else {
      setSequencer((on) => !on);
    }
    setActive(null);
  };

  const stepOctave = (by: number) => setOctave((o) => Math.max(MIN_OCTAVE, Math.min(MAX_OCTAVE, o + by)));
  const stepSlot = (by: number) => {
    releaseEverything();
    setSlot((s) => cycle(s, SLOT_COUNT, by));
  };

  /** A click on the pattern: synth steps are picked, drum cells toggled. */
  const pressScreen = (x: number, y: number) => {
    if (!showingPattern()) return;
    const drum = drumming();
    const hit = patternHit(x, y, drum);
    if (!hit) return;
    const p = pattern();
    const shown = patternPage({ cursor: cursor(), playhead: tape.playing ? sequencerOf().played.at(hearing()) : -1 });
    const step = shown * PAGE_STEPS + hit.step;
    if (step >= p.length) return;
    setCursor(step);
    if (!drum) return;
    const target = hit.pad ?? pad();
    setPad(target);
    editPattern((prev) => toggleStep(prev, step, target));
  };

  // ---------------------------------------------------------------------------
  // Tape transport, and the record key
  // ---------------------------------------------------------------------------

  const syncTransport = () => {
    setPlaying(tape.playing);
    setRecording(tape.recording);
  };
  const togglePlay = () => {
    if (tape.playing) tape.stop();
    else tape.play();
    syncTransport();
  };
  /** Stop; stopped already, back to the start. */
  const stopTape = () => {
    if (tape.playing) tape.stop();
    else tape.rewind();
    syncTransport();
    setScreenTick((n) => n + 1);
  };
  const toggleRecord = () => {
    if (tape.recording) {
      tape.setRecording(false);
    } else {
      tape.setRecording(true);
      library.markEdited();
      if (!tape.playing) tape.play();
    }
    syncTransport();
  };

  const onSamplerPage = () => mode() === "synth" && !sequencer() && sound().synth === SAMPLER_ENGINE;
  const toggleSampling = () => {
    if (sampleActive()) sampling.stop();
    else void sampling.start(slot());
  };
  /** Record samples on the sampler's page, and records onto the tape everywhere else. */
  const pressRecord = () => {
    if (sampleActive() || onSamplerPage()) toggleSampling();
    else toggleRecord();
  };

  const clearTrack = () => {
    tape.clearTrack(track());
    library.markEdited();
    setScreenTick((n) => n + 1);
  };

  const clearTape = async () => {
    const answer = await app.os.showDialog({
      message: "Erase all four tracks? This can't be undone.",
      buttons: ["Cancel", "Erase"],
      variant: "caution",
    });
    if (answer !== "Erase") return;
    tape.clearAll();
    library.markEdited();
    setScreenTick((n) => n + 1);
  };

  // ---------------------------------------------------------------------------
  // Tapes: demos bounce on in one go under the watch, kept ones are read back
  // ---------------------------------------------------------------------------

  /** Put a tape on from the menu, in tape mode; a demo plays once it's on, any other waits at the start. */
  const openTape = async (ref: TapeRef) => {
    const opened = await library.open(ref, {
      onEject: () => {
        setReverse(false);
        setMutes([false, false, false, false]);
        setTapeTenths(0);
        setMode("tape");
        syncTransport();
        setScreenTick((n) => n + 1);
      },
    });
    if (!opened || ref.kind !== "demo") return;
    tape.play();
    syncTransport();
  };

  /** At launch, the tape that was on last time, or the default one; it waits, stopped. */
  const reopenTape = async (ref: TapeRef | null) => {
    const gone = (ref?.kind === "saved" && !library.saved().includes(ref.name)) || (ref?.kind === "demo" && !DEMO_NAMES.includes(ref.name));
    const reopen = gone ? null : ref;
    const onEject = () => setMutes([false, false, false, false]);
    if (await library.open(reopen ?? DEFAULT_TAPE, { ask: false, onEject })) return;
    if (reopen) await library.open(DEFAULT_TAPE, { ask: false, onEject });
  };

  const quit = async () => {
    if (await library.confirmDiscard()) app.quit();
  };

  let exports = 0;
  const exportTape = () => {
    const download = app.download;
    if (!download) return;
    const mix = tape.mixdown();
    if (mix[0].length === 0 || !mix.some((side) => side.some((s) => s !== 0))) {
      showMessage("The tape is empty. Record something onto it first.");
      return;
    }
    exports++;
    const bytes = encodeWav(mix, tape.sampleRate);
    download.save({ name: `OP-1 Tape ${exports}.wav`, type: "audio/wav", bytes }).catch((err: unknown) => {
      showMessage(`Couldn't export the tape: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  const down = new Set<string>();

  const onKeyDown = (rawKey: string, mods: { meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }) => {
    if (mods.meta || mods.ctrl || mods.alt) return;
    const key = rawKey.length === 1 ? rawKey.toLowerCase() : rawKey;
    if (down.has(key)) return;
    down.add(key);
    const note = COMPUTER_KEYS[key];
    if (note !== undefined) {
      keyDown(key, note, mods.shift);
      return;
    }
    if (key === " ") togglePlay();
    else if (key === "z" || key === "x") stepOctave(key === "z" ? -1 : 1);
    else if (key === "[" || key === "]") stepSlot(key === "[" ? -1 : 1);
    else if (key >= "1" && key <= "4") pressT(Number(key) - 1);
    else if (key === "q") toggleSequencer();
    else if (showingPattern() && (key === "ArrowLeft" || key === "ArrowRight")) patternKey(key === "ArrowLeft" ? 0 : 1);
    else if (showingPattern() && (key === "Backspace" || key === "Delete")) editPattern((p) => clearStep(p, cursor()));
  };

  const onKeyUp = (rawKey: string) => {
    const key = rawKey.length === 1 ? rawKey.toLowerCase() : rawKey;
    down.delete(key);
    keyUp(key);
  };

  const onBlur = () => {
    down.clear();
    releaseEverything();
  };

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  createEffect(
    (): Session => ({
      sounds: [...sounds()],
      slot: slot(),
      kit: kit(),
      openTape: library.current(),
      octave: octave(),
      volume: volume(),
      mode: mode(),
      synthPage: synthPage(),
      drumPage: drumPage(),
      mixerPage: mixerPage(),
      pad: pad(),
      sequencer: sequencer(),
      synthPattern: synthPattern(),
      drumPattern: drumPattern(),
      sampleSource: sampling.source(),
    }),
    (session) => {
      if (!loaded) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        void app.storage.write(SESSION_KEY, JSON.stringify(session));
      }, 800);
    },
  );

  // ---------------------------------------------------------------------------
  // Sound, and the frame loop that follows what the speaker is playing
  // ---------------------------------------------------------------------------

  const hearing = () => (stream ? stream.playbackPosition() : engine.position);
  const heard = new Set<number>();
  let heardKey = "";
  let lastHead = -1;
  let wasLive = false;

  const padLit = (p: number) => {
    const since = hearing() - engine.padFrames[p]!;
    return since >= 0 && since < PAD_FLASH * engine.sampleRate;
  };

  const scopeSource: ScopeSource = {
    left: engine.scopeL,
    right: engine.scopeR,
    now: hearing,
    sampleRate: () => engine.sampleRate,
    fundamental: () => (heard.size === 0 ? null : noteHz(Math.min(...heard))),
  };

  let cancelFrame: (() => void) | null = null;
  const frame = (timeMs: number) => {
    cancelFrame = app.scheduler.requestFrame(frame);
    const now = hearing();
    sampling.frame(timeMs);

    let lit = "";
    if (instrument() === "synth") {
      engine.notes.at(now, heard);
      lit = [...heard].sort((a, b) => a - b).join(",");
    } else {
      heard.clear();
      for (let p = 0; p < PAD_COUNT; p++) if (padLit(p)) lit += `${p},`;
    }
    if (lit !== heardKey) {
      heardKey = lit;
      setKeysTick((n) => n + 1);
    }

    if (tape.playing !== playing() || tape.recording !== recording()) syncTransport();
    const head = tape.heads.at(now);
    const tenths = Math.floor((head / tape.sampleRate) * 10);
    if (tenths !== tapeTenths()) setTapeTenths(tenths);

    const live = now - engine.lastSoundFrame < engine.sampleRate * 0.4 || lit !== "";
    const moving = (mode() === "synth" && synthPage() === 3) || sampleActive();
    if (live || wasLive || head !== lastHead || tape.playing || moving) setScreenTick((n) => n + 1);
    wasLive = live;
    lastHead = head;
  };

  onSettled(() => {
    cancelFrame = app.scheduler.requestFrame(frame);
    const audio = app.audio;
    // A tape goes on at the stream's rate: the engine wipes the tape when its rate changes.
    const opening = audio
      ? audio
          .open({ channels: 2, latency: "interactive", render: (block) => engine.render(block) })
          .then((opened) => {
            engine.setSampleRate(opened.sampleRate);
            stream = opened;
            setStreamStatus(opened.state());
            opened.onStateChange(setStreamStatus);
          })
          .catch((err: unknown) => {
            console.error("OP-1: couldn't open sound output", err);
            setStreamStatus("failed");
          })
      : Promise.resolve();

    void (async () => {
      const [text] = await Promise.all([app.storage.read(SESSION_KEY), sampling.load(), library.refresh(), opening]);
      const session = sanitizeSession(parseJson(text));
      if (session) {
        setSounds(session.sounds);
        setSlot(session.slot);
        setKit(session.kit);
        setMixerPage(session.mixerPage);
        setOctave(session.octave);
        setVolume(session.volume);
        setSynthPage(session.synthPage);
        setDrumPage(session.drumPage);
        setPad(session.pad);
        setSynthPattern(session.synthPattern);
        setDrumPattern(session.drumPattern);
        setSequencer(session.sequencer);
        sampling.setSource(session.sampleSource === "speaker" && sampling.canHearSpeaker ? "speaker" : "op1");
        setMode(session.mode);
      }
      await reopenTape(session?.openTape ?? null);
      loaded = true;
    })();
  });

  onCleanup(() => {
    cancelFrame?.();
    sampling.cancel();
    stream?.close();
    if (saveTimer) clearTimeout(saveTimer);
    if (readoutTimer) clearTimeout(readoutTimer);
  });

  // ---------------------------------------------------------------------------
  // Menus
  // ---------------------------------------------------------------------------

  createEffect(
    () => ({
      names: sounds().map((s) => s.name),
      slot: slot(),
      synth: sound().synth,
      fx: sound().fx,
      drumFx: kit().fx,
      playing: playing(),
      recording: recording(),
      reverse: reverse(),
      track: track(),
      canDownload: app.download !== undefined,
      sequencer: showingPattern(),
      instrument: instrument(),
      running: pattern().running,
      length: pattern().length,
      stepFilled: (pattern().steps[cursor()]?.length ?? 0) > 0,
      accent: pattern().accents[cursor()] === true,
      hold: pattern().holds[cursor()] ?? 1,
      sampling: sampleActive(),
      source: sampling.source(),
      hasSample: sampling.samples()[slot()] !== null,
      openTape: library.current(),
      savedTapes: library.saved(),
    }),
    (state) => {
      const radio = (value: number, labels: readonly string[], onChange: (index: number) => void): MenubarItemDef => ({
        type: "radiogroup",
        value: String(value),
        onValueChange: (v) => onChange(Number(v)),
        items: labels.map((label, i) => ({ label, value: String(i) })),
      });
      const title = (name: string) => name[0] + name.slice(1).toLowerCase();
      const which = state.instrument === "drum" ? "Drum" : "Synth";

      const on = state.openTape;
      const tapeItem = (ref: TapeRef & { name: string }): MenubarItemDef => ({
        label: ref.name,
        checked: on !== null && on.kind !== "new" && on.kind === ref.kind && on.name === ref.name,
        onClick: () => void openTape(ref),
      });
      const savedItems: MenubarItemDef[] =
        state.savedTapes.length > 0
          ? state.savedTapes.map((name) => tapeItem({ kind: "saved", name }))
          : [{ label: "No Saved Tapes", disabled: true }];
      const fileItems: MenubarItemDef[] = [
        { label: "New Tape", shortcut: "N", onClick: () => void openTape({ kind: "new" }) },
        {
          type: "submenu",
          label: "Open Tape",
          items: [...DEMO_NAMES.map((name) => tapeItem({ kind: "demo", name })), { type: "separator" }, ...savedItems],
        },
        { type: "separator" },
        { label: "Save Tape", shortcut: "S", disabled: state.openTape === null, onClick: () => void library.save() },
        { label: "Save Tape As…", disabled: state.openTape === null, onClick: () => void library.saveAs() },
        { label: "Delete Tape…", disabled: state.openTape?.kind !== "saved", onClick: () => void library.remove() },
        { type: "separator" },
      ];
      if (state.canDownload) fileItems.push({ label: "Export Tape…", shortcut: "E", onClick: exportTape }, { type: "separator" });
      fileItems.push({ label: "Quit", shortcut: "Q", onClick: () => void quit() });

      app.setMenus([
        { label: "File", items: fileItems },
        {
          label: "Mode",
          items: [
            ...MODES.map((m, i): MenubarItemDef => ({ label: m.label, shortcut: String(i + 1), onClick: () => pressMode(m.mode) })),
            { type: "separator" },
            { label: state.sequencer ? "Hide Pattern" : "Show Pattern", shortcut: "5", onClick: toggleSequencer },
            { type: "separator" },
            { label: "Octave Up", onClick: () => stepOctave(1) },
            { label: "Octave Down", onClick: () => stepOctave(-1) },
          ],
        },
        {
          label: "Sound",
          items: [
            radio(state.slot, state.names.map((name, i) => `${i + 1}  ${title(name)}`), (i) => {
              releaseEverything();
              setSlot(i);
            }),
            { type: "separator" },
            { type: "submenu", label: "Engine", items: [radio(state.synth, SYNTHS.map((s) => title(s.name)), (i) => updateSound((s) => ({ ...s, synth: i })))] },
            { type: "submenu", label: "Effect", items: [radio(state.fx, FX.map((f) => title(f.name)), (i) => updateSound((s) => ({ ...s, fx: i })))] },
            {
              type: "submenu",
              label: "Sampler",
              items: [
                { label: state.sampling ? "Stop Sampling" : "Start Sampling", onClick: toggleSampling },
                { type: "separator" },
                {
                  type: "radiogroup",
                  value: state.source,
                  onValueChange: (v) => sampling.setSource(v === "speaker" ? "speaker" : "op1"),
                  items: [
                    { label: "From the OP-1", value: "op1" },
                    { label: "From the Speaker", value: "speaker", disabled: !sampling.canHearSpeaker },
                  ],
                },
                { type: "separator" },
                { label: "Erase Sample", disabled: !state.hasSample, onClick: () => sampling.erase(slot()) },
              ],
            },
            { type: "separator" },
            { label: "Next Sound", shortcut: "]", onClick: () => stepSlot(1) },
            { label: "Previous Sound", shortcut: "[", onClick: () => stepSlot(-1) },
            { label: "Revert to Factory Sound", onClick: () => updateSound(() => factorySound(slot())) },
            { type: "separator" },
            {
              label: "All Notes Off",
              shortcut: ".",
              onClick: () => {
                releaseEverything();
                engine.panic();
              },
            },
          ],
        },
        {
          label: "Drum",
          items: [
            { type: "submenu", label: "Effect", items: [radio(state.drumFx, FX.map((f) => title(f.name)), (i) => setKit((k) => ({ ...k, fx: i })))] },
            { type: "separator" },
            { label: "Reset Pad", onClick: () => setKit((k) => ({ ...k, pads: replaceAt(k.pads, pad(), defaultQuad(PAD_DEFS)) })) },
            { label: "Reset Kit", onClick: () => setKit(defaultKit()) },
          ],
        },
        {
          label: "Pattern",
          items: [
            { label: state.running ? `Pause ${which} Pattern` : `Run ${which} Pattern`, onClick: togglePatternRunning },
            { type: "separator" },
            { label: "Clear Step", onClick: () => editPattern((p) => clearStep(p, cursor())) },
            {
              label: "Accent Step",
              checked: state.accent,
              disabled: !state.stepFilled,
              onClick: () => editPattern((p) => setAccent(p, cursor(), !p.accents[cursor()])),
            },
            {
              label: "Hold Step Longer",
              disabled: !state.stepFilled || state.instrument === "drum" || state.hold >= MAX_HOLD,
              onClick: () => editPattern((p) => setHold(p, cursor(), (p.holds[cursor()] ?? 1) + 1)),
            },
            {
              label: "Hold Step Shorter",
              disabled: !state.stepFilled || state.instrument === "drum" || state.hold <= 1,
              onClick: () => editPattern((p) => setHold(p, cursor(), (p.holds[cursor()] ?? 1) - 1)),
            },
            { type: "separator" },
            { label: `Clear ${which} Pattern`, onClick: () => editPattern(clearPattern) },
            { label: "Double Length", disabled: state.length >= MAX_STEPS, onClick: () => editPattern(doublePattern) },
          ],
        },
        {
          label: "Tape",
          items: [
            { label: state.playing ? "Stop" : "Play", onClick: togglePlay },
            { label: state.recording ? "Stop Recording" : "Record", shortcut: "R", onClick: toggleRecord },
            { label: state.reverse ? "Play Forwards" : "Play Backwards", onClick: () => setReverse((r) => !r) },
            {
              label: "Rewind",
              onClick: () => {
                tape.rewind();
                setScreenTick((n) => n + 1);
              },
            },
            { type: "separator" },
            radio(state.track, ["Track 1", "Track 2", "Track 3", "Track 4"], setTrack),
            { type: "separator" },
            { label: `Erase Track ${state.track + 1}`, onClick: clearTrack },
            { label: "Erase Tape…", onClick: () => void clearTape() },
          ],
        },
      ]);
    },
  );

  createEffect(
    () => {
      const ref = library.current();
      return ref ? `OP-1: ${tapeName(ref)}${library.edited() ? " •" : ""}` : "OP-1";
    },
    (title) => app.window.setTitle(title),
  );

  // ---------------------------------------------------------------------------
  // The faceplate
  // ---------------------------------------------------------------------------

  const title = () => {
    const m = mode();
    if (m === "tape") return `TAPE${reverse() ? " REV" : ""}${recording() ? " • REC" : ""}`;
    if (sampleActive() && m === "synth") return `SAMPLER • ${sampling.state() === "armed" ? "ARM" : "REC"}`;
    return page().title;
  };

  /** What's on the step under the cursor, briefly. */
  const describeStep = () => {
    const p = pattern();
    const step = cursor();
    const values = p.steps[step] ?? [];
    if (values.length === 0) return "";
    const accent = p.accents[step] ? " !" : "";
    if (drumming()) return `${PADS[values[0]!]?.name ?? ""}${values.length > 1 ? ` +${values.length - 1}` : ""}${accent}`;
    const hold = p.holds[step] ?? 1;
    return values.slice(0, 3).map(noteName).join(" ") + (values.length > 3 ? " …" : "") + (hold > 1 ? ` x${hold}` : "") + accent;
  };

  const info = () => {
    const index = active();
    if (index !== null) {
      const current = page();
      return `${current.defs[index].name} ${formatParam(current.defs[index], current.values[index])}`;
    }
    const state = streamStatus();
    if (state === "failed") return "NO SOUND OUTPUT";
    if (state === "opening") return "WARMING UP";
    if (state === "closed") return "SOUND OFF";
    if (state === "suspended") return "CLICK FOR SOUND";
    const m = mode();
    if (sampleActive() && m === "synth") {
      if (sampling.state() === "armed") return sampling.source() === "speaker" ? "WAITING FOR SPEAKER" : "WAITING FOR SOUND";
      const seconds = sampling.recorder.length / sampling.recorder.sampleRate;
      return `${seconds.toFixed(1)} / ${SAMPLE_SECONDS} S`;
    }
    if (showingPattern()) return `STEP ${cursor() + 1}/${pattern().length}  ${describeStep()}`;
    const oct = octave();
    if (m === "synth") return `${slot() + 1} ${sound().name}  OCT ${oct > 0 ? "+" : ""}${oct}`;
    if (m === "drum") return `DRUM ${DRUM_PAGES[drumPage()] ?? ""}`;
    if (m === "tape") {
      const loop = tape.loopLength();
      const seconds = tapeTenths() / 10;
      const bar = loop > 0 ? `  BAR ${Math.floor((seconds * tape.sampleRate) / tape.barFrames()) + 1}` : "";
      return `T${track() + 1}  ${formatTime(seconds)}${bar}`;
    }
    return `VOLUME ${Math.round(volume() * 100)}`;
  };

  const blink = (now: number, seconds: number) => Math.floor(now / (engine.sampleRate * seconds)) % 2 === 0;

  const tapeView = (): TapeView => {
    const now = hearing();
    return {
      head: tape.heads.at(now),
      capacity: tape.capacity,
      loop: tape.loopLength(),
      sampleRate: tape.sampleRate,
      peaks: tape.peaks,
      track: track(),
      mutes: mutes(),
      recording: recording(),
      blink: blink(now, 0.25),
    };
  };

  const patternView = (): PatternView => ({
    drum: drumming(),
    pattern: pattern(),
    cursor: cursor(),
    playhead: tape.playing ? sequencerOf().played.at(hearing()) : -1,
    pad: pad(),
  });

  const shownPeaks = createMemo(() => samplePeaks(sampling.sampleFor(slot()), SAMPLE_COLUMNS));
  const sampleView = (): SampleView => {
    const values = sound().engines[SAMPLER_ENGINE]!;
    const state = sampling.state();
    return {
      peaks: shownPeaks(),
      start: values[0],
      end: values[1],
      loop: samplerLoops(values[2]),
      head: sound().synth === SAMPLER_ENGINE ? engine.samplerHead : -1,
      take:
        state === "idle"
          ? null
          : { data: sampling.recorder.data, length: sampling.recorder.length, armed: state === "armed", blink: blink(hearing(), 0.3) },
    };
  };

  const art = (): ScreenArt => {
    const m = mode();
    if (showingPattern()) return { kind: "pattern", view: patternView() };
    if (m === "tape") return { kind: "tape", tape: tapeView() };
    if (m === "mixer" && mixerPage() === 1) return { kind: "pan", pans: pans(), mutes: mutes() };
    if (m === "mixer") return { kind: "mixer", levels: levels(), mutes: mutes(), meters: tape.meters };
    if (m === "drum") {
      if (drumPage() === 2) return { kind: "fx", fx: kit().fx, values: page().values };
      return { kind: "pads", selected: pad(), lit: (p) => padLit(p) || pressed().has(p) };
    }
    const s = sound();
    const p = synthPage();
    if (sampleActive() || (p === 0 && s.synth === SAMPLER_ENGINE)) return { kind: "sample", view: sampleView() };
    if (p === 1) return { kind: "envelope", env: s.env, level: engine.envLevel };
    if (p === 2) return { kind: "fx", fx: s.fx, values: s.fxParams[s.fx]! };
    if (p === 3) return { kind: "lfo", values: s.lfo, value: engine.lfoValue };
    return { kind: "wave", source: scopeSource };
  };

  const strip = (): StripView => {
    const current = page();
    return { defs: current.defs, values: current.values, active: active() };
  };

  let screenPaints = 0;
  const screenRevision = createMemo(() => {
    screenTick();
    page();
    active();
    mutes();
    track();
    recording();
    pressed();
    sampling.state();
    shownPeaks();
    return ++screenPaints;
  });

  let stripPaints = 0;
  const stripRevision = createMemo(() => {
    page();
    active();
    return ++stripPaints;
  });

  let keyPaints = 0;
  const keysRevision = createMemo(() => {
    pressed();
    keysTick();
    octave();
    instrument();
    return ++keyPaints;
  });
  const keyLit = (key: number) => {
    if (pressed().has(key)) return true;
    if (instrument() === "drum") return padLit(key);
    return heard.has(LOW_NOTE + 12 * octave() + key);
  };

  return (
    <box
      width={W}
      height={H}
      padding={PAD}
      gap={GAP}
      flexDirection="column"
      background={0}
      tabIndex={0}
      autoFocus
      semantic={{ name: "op-1", role: "application" }}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={onBlur}
    >
      <box flexDirection="row" gap={GAP} height={SCREEN_H}>
        <box width={SIDE_W} flexDirection="column" alignItems="center" gap={6} paddingTop={2}>
          <Speaker size={40} />
          <Knob def={VOLUME} value={volume()} onChange={setVolume} />
        </box>
        <box borderRadius={4} background={1}>
          <Screen title={title()} info={info()} art={art} revision={screenRevision()} onPress={pressScreen} />
        </box>
        <box width={STRIP_W} flexDirection="column" gap={GAP}>
          <box flexDirection="row" height={ENCODER_SIZE}>
            {ENCODERS.map((index) => (
              <box width={COLUMN_W} alignItems="center">
                <Encoder
                  index={index}
                  name={page().defs[index].name}
                  value={formatParam(page().defs[index], page().values[index])}
                  detented={isDetented(page().defs[index])}
                  onTurn={(ticks) => turn(index, ticks)}
                  onReset={() => resetEncoder(index)}
                />
              </box>
            ))}
          </box>
          <box borderRadius={4} background={1}>
            <EncoderStrip labels={page().defs.map((def) => def.label)} strip={strip} revision={stripRevision()} />
          </box>
        </box>
      </box>

      <box flexDirection="row" height={BUTTON_H} justifyContent="space-between" width={INNER_W}>
        <box flexDirection="row" gap={2}>
          {MODES.map((m) => (
            <FaceButton name={`mode-${m.mode}`} icon={m.icon} lit={mode() === m.mode} onPress={() => pressMode(m.mode)} />
          ))}
          <FaceButton name="sequencer" icon="seq" lit={showingPattern()} onPress={toggleSequencer} />
        </box>
        <box flexDirection="row" gap={2}>
          {[0, 1, 2, 3].map((t) => (
            <FaceButton
              name={`t${t + 1}`}
              label={String(t + 1)}
              lit={tLit(t)}
              disabled={mode() === "drum" && !showingPattern() && t >= DRUM_PAGES.length}
              onPress={() => pressT(t)}
            />
          ))}
        </box>
        <box flexDirection="row" gap={2}>
          <FaceButton name="record" icon="record" lit={recording() || sampleActive()} onPress={pressRecord} />
          <FaceButton name="play" icon="play" lit={playing()} onPress={togglePlay} />
          <FaceButton name="stop" icon="stop" onPress={stopTape} />
          <FaceButton name="reverse" icon="reverse" lit={reverse()} onPress={() => setReverse((r) => !r)} />
        </box>
        <box flexDirection="row" gap={2}>
          <FaceButton name="octave-down" icon="down" lit={octave() < 0} onPress={() => stepOctave(-1)} />
          <FaceButton name="octave-up" icon="up" lit={octave() > 0} onPress={() => stepOctave(1)} />
        </box>
      </box>

      <Keyboard
        width={INNER_W}
        height={KEYS_H}
        isLit={keyLit}
        reach={Object.keys(COMPUTER_KEYS).length}
        revision={keysRevision()}
        onKeyDown={(key) => keyDown("mouse", key)}
        onKeyUp={() => keyUp("mouse")}
      />
    </box>
  );
}

export default defineApp({
  id: "op1",
  title: "OP-1",
  icon: "op1/icon",
  smallIcon: "op1/icon-16x16",
  sprites,
  requires: ["audio"],
  about: {
    version: "1.2",
    description:
      "A portable synthesizer workstation in the manner of the Teenage Engineering OP-1: seven synth engines including a sampler, a drum kit, a pattern sequencer for each, a four-track tape and a mixer, all on four encoders. Play the keys A to ' ; Space runs the tape, Q shows the pattern. It starts with the Sunday Tape on; File › Open Tape has the other demos and the tapes you've saved.",
  },
  defaultSize: { width: W, height: H },
  resizable: false,
  scrollable: false,
  Component: Op1,
});
