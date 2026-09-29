/**
 * pchkraft: a groovebox and looper in a cassette shell. Four keys play the
 * chords a song uses most, or drums. Humming snaps to the scale, and each
 * beat of the melody becomes the chord that fits it. Arm record and the
 * first note starts the loop.
 *
 * Keys A S D F (or 1–4) play. M listens, R records, Space runs the tape,
 * K switches to drums, arrows change key and scale, [ ] nudge the tempo.
 */
import {
  createEffect,
  createMemo,
  createSignal,
  defineApp,
  onCleanup,
  onSettled,
  useApp,
  type AudioStream,
  type AudioStreamState,
  type MicrophoneInput,
} from "@mockintosh/sdk";
import type { JSX } from "@mockintosh/ui";
import { CassetteEngine } from "./pchkraft/engine";
import {
  BORDER,
  GAP,
  KEY_H,
  PAD,
  Pad,
  Reel,
  SCREEN_H,
  Screw,
  SHELL_H,
  SHELL_W,
  Screen,
  TRANSPORT_H,
  Transport,
} from "./pchkraft/faceplate";
import { sprites } from "./pchkraft/icons";
import { DRUM_LABELS, DRUM_LANES, barOf, createLoop, describeStep, sanitizeLoop, stepsIn, type Bars, type Loop } from "./pchkraft/loop";
import { PitchTracker, type PitchReading } from "./pchkraft/pitch";
import {
  KEY_NAMES,
  SCALES,
  chordLabel,
  noteName,
  padForTriad,
  snapToScale,
  usesFlats,
  type Scale,
} from "./pchkraft/theory";

const HINTS = ["A", "S", "D", "F"] as const;
const PAD_KEYS: Readonly<Record<string, number>> = {
  "1": 0, "2": 1, "3": 2, "4": 3,
  a: 0, s: 1, d: 2, f: 3,
};

const TEMPO_MIN = 60;
const TEMPO_MAX = 180;
const SESSION_KEY = "session.json";
/** Quiet windows in a row before a hum counts as a breath. */
const HUM_HANG = 3;
/** A reading vaguer than this is noise, not a note. */
const HUM_CLARITY = 0.7;

type Mode = "chords" | "drums";
type HumState = "off" | "opening" | "on";
type OutputStatus = "opening" | "failed" | AudioStreamState;

interface Session {
  key: number;
  scale: number;
  tempo: number;
  loop: Loop;
}

const clampTempo = (value: number) => Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, Math.round(value)));

function sanitizeSession(value: unknown): Session | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const key = typeof record.key === "number" && record.key >= 0 && record.key < 12 ? Math.round(record.key) : 0;
  const scale = typeof record.scale === "number" && record.scale >= 0 && record.scale < SCALES.length ? Math.round(record.scale) : 0;
  const tempo = typeof record.tempo === "number" && Number.isFinite(record.tempo) ? clampTempo(record.tempo) : 100;
  return { key, scale, tempo, loop: sanitizeLoop(record.loop) ?? createLoop(1) };
}

function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isRefusal(error: unknown): boolean {
  const name = typeof error === "object" && error !== null && "name" in error ? (error as { name: unknown }).name : null;
  return name === "NotAllowedError" || name === "SecurityError";
}

function Pchkraft(): JSX.Element {
  const app = useApp();
  const engine = new CassetteEngine();

  const [key, setKey] = createSignal(0);
  const [scaleIndex, setScaleIndex] = createSignal(0);
  const [tempo, setTempo] = createSignal(100);
  const [bars, setBars] = createSignal<Bars>(1);
  const [mode, setMode] = createSignal<Mode>("chords");
  const [playing, setPlaying] = createSignal(false);
  const [recording, setRecording] = createSignal(false);
  const [humming, setHumming] = createSignal<HumState>("off");
  const [tracker, setTracker] = createSignal(false);
  const [humChord, setHumChord] = createSignal<number | null>(null);
  const [heardStep, setHeardStep] = createSignal(-1);
  const [reel, setReel] = createSignal(0);
  const [take, setTake] = createSignal(0);
  const [lit, setLit] = createSignal<readonly boolean[]>([false, false, false, false]);
  const [banner, setBanner] = createSignal<string | null>(null);
  const [output, setOutput] = createSignal<OutputStatus>(app.audio ? "opening" : "failed");

  const scale = (): Scale => SCALES[scaleIndex()] ?? SCALES[0]!;
  const flats = () => usesFlats(key());

  let stream: AudioStream | null = null;
  let mic: MicrophoneInput | null = null;
  let pitch: PitchTracker | null = null;
  let latched: number | null = null;
  let quiet = 0;
  let humToken = 0;
  let loaded = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let bannerTimer: ReturnType<typeof setTimeout> | null = null;
  const keyDown = new Set<string>();
  const pointerDown = [false, false, false, false];

  const showBanner = (text: string) => {
    setBanner(text);
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => {
      bannerTimer = null;
      setBanner(null);
    }, 1600);
  };

  // ---------------------------------------------------------------------------
  // The four keys
  // ---------------------------------------------------------------------------

  const padHeld = (index: number) => {
    if (pointerDown[index]) return true;
    for (const held of keyDown) if (PAD_KEYS[held] === index) return true;
    return false;
  };

  const syncPad = (index: number) => {
    const next = padHeld(index);
    if (lit()[index] === next) return;
    setLit((flags) => flags.map((on, i) => (i === index ? next : on)));
    if (mode() === "drums") {
      if (next) engine.tapDrum(DRUM_LANES[index]!);
      return;
    }
    if (next) engine.pressChord(index);
    else engine.releaseChord(index);
  };

  const releasePads = () => {
    for (let i = 0; i < 4; i++) {
      pointerDown[i] = false;
      if (lit()[i] && mode() === "chords") engine.releaseChord(i);
    }
    for (const held of [...keyDown]) if (PAD_KEYS[held] !== undefined) keyDown.delete(held);
    setLit([false, false, false, false]);
  };

  const toggleMode = () => {
    releasePads();
    setMode((current) => (current === "chords" ? "drums" : "chords"));
  };

  // ---------------------------------------------------------------------------
  // Tape, tempo, hum
  // ---------------------------------------------------------------------------

  const togglePlay = () => {
    engine.togglePlay();
    setPlaying(engine.playing);
  };

  const toggleRecord = () => {
    engine.setRecording(!recording());
    setRecording(engine.recording);
  };

  const clearLoop = () => {
    engine.clear();
    setTake(engine.generation);
  };

  const setLoopBars = (next: Bars) => {
    engine.setBars(next);
    setBars(next);
  };

  const cycleBars = () => setLoopBars(bars() === 1 ? 2 : bars() === 2 ? 4 : 1);

  const stopHum = () => {
    humToken++;
    pitch = null;
    latched = null;
    quiet = 0;
    mic?.close();
    mic = null;
    engine.hear(null);
    setHumming("off");
  };

  const hear = (reading: PitchReading) => {
    if (reading.kind === "unsure") return;
    if (reading.kind === "silence") {
      if (++quiet >= HUM_HANG) {
        quiet = 0;
        latched = null;
        engine.hear(null);
      }
      return;
    }
    if (reading.clarity < HUM_CLARITY) return;
    quiet = 0;
    const snapped = snapToScale(reading.note, engine.key, engine.scale.steps, latched);
    latched = snapped;
    engine.hear(snapped);
  };

  const toggleHum = () => {
    if (humming() !== "off") {
      stopHum();
      return;
    }
    const microphone = app.microphone;
    if (!microphone) {
      showBanner("No microphone");
      return;
    }
    const token = ++humToken;
    setHumming("opening");
    void microphone
      .open({
        channels: 1,
        capture(block) {
          if (token !== humToken) return;
          const channel = block.channels[0];
          if (!channel) return;
          pitch ??= new PitchTracker(block.sampleRate);
          const reading = pitch.push(channel);
          if (reading) hear(reading);
        },
      })
      .then((input) => {
        if (token !== humToken) {
          input.close();
          return;
        }
        mic = input;
        setHumming("on");
      })
      .catch((err: unknown) => {
        if (token !== humToken) return;
        setHumming("off");
        showBanner(isRefusal(err) ? "Microphone blocked" : "No microphone");
      });
  };

  const onKeyDown = (raw: string) => {
    const keyName = raw.length === 1 ? raw.toLowerCase() : raw;
    if (keyDown.has(keyName)) return;
    const pad = PAD_KEYS[keyName];
    if (pad !== undefined) {
      keyDown.add(keyName);
      syncPad(pad);
      return;
    }
    keyDown.add(keyName);
    if (keyName === "m") toggleHum();
    else if (keyName === "r") toggleRecord();
    else if (keyName === " ") togglePlay();
    else if (keyName === "k") toggleMode();
    else if (keyName === "Backspace") clearLoop();
    else if (keyName === "l") cycleBars();
    else if (keyName === "t") setTracker((on) => !on);
    else if (keyName === "ArrowLeft") setKey((k) => (k + 11) % 12);
    else if (keyName === "ArrowRight") setKey((k) => (k + 1) % 12);
    else if (keyName === "ArrowUp") setScaleIndex((s) => Math.min(SCALES.length - 1, s + 1));
    else if (keyName === "ArrowDown") setScaleIndex((s) => Math.max(0, s - 1));
    else if (keyName === "[") setTempo((t) => clampTempo(t - 1));
    else if (keyName === "]") setTempo((t) => clampTempo(t + 1));
  };

  const onKeyUp = (raw: string) => {
    const keyName = raw.length === 1 ? raw.toLowerCase() : raw;
    keyDown.delete(keyName);
    const pad = PAD_KEYS[keyName];
    if (pad !== undefined) syncPad(pad);
  };

  // ---------------------------------------------------------------------------
  // What the window says
  // ---------------------------------------------------------------------------

  const title = () => `${KEY_NAMES[key()] ?? "C"} ${scale().name}`;

  const names = () =>
    mode() === "drums" ? DRUM_LABELS.join(" ") : scale().chords.map((chord) => chordLabel(key(), chord)).join(" ");

  const statusLine = () => {
    const message = banner();
    if (message) return message;
    if (output() === "failed") return "No sound output";
    if (output() === "suspended") return "Click or press a key for sound";
    const parts = [playing() ? "PLAY" : "STOP"];
    if (recording()) parts.push("REC");
    if (humming() === "on") parts.push("HUM");
    else if (humming() === "opening") parts.push("MIC");
    const chord = heardChord();
    if (chord) parts.push(chord);
    parts.push(`${tempo()} BPM`);
    const step = heardStep();
    parts.push(bars() > 1 && step >= 0 ? `BAR ${barOf(step, bars()) + 1}/${bars()}` : bars() === 1 ? "1 BAR" : `${bars()} BARS`);
    return parts.join(" ");
  };

  const summary = () => `${title()} | ${names()} | ${statusLine()}`;

  const heardChord = () => {
    const degree = humChord();
    if (degree === null) return null;
    const chord = scale().triads[degree];
    return chord ? chordLabel(key(), chord) : null;
  };

  const aside = () => heardChord() ?? `${tempo()} BPM`;

  const trackerText = () => {
    const loop = engine.loop;
    const step = heardStep();
    const start = step < 0 ? 0 : Math.floor(step / 4) * 4;
    const scaleNow = scale();
    const lines: string[] = [];
    const n = stepsIn(loop.bars);
    for (let i = 0; i < 4; i++) {
      const at = (start + i) % n;
      const degree = loop.chords[at] ?? -1;
      const triad = scaleNow.triads[degree];
      const chord = degree < 0 || !triad ? "—" : chordLabel(key(), triad);
      const lead = loop.lead[at] ?? -1;
      const leadText = lead < 0 ? "" : noteName(lead, flats());
      lines.push(describeStep(loop, at, step, chord, leadText));
    }
    return lines.join("\n");
  };

  let paints = 0;
  const revision = createMemo(() => {
    reel();
    take();
    heardStep();
    bars();
    recording();
    tracker();
    return ++paints;
  });

  // ---------------------------------------------------------------------------
  // Keep the engine with the knobs, and remember the tape
  // ---------------------------------------------------------------------------

  createEffect(
    () => ({ key: key(), scale: scale() }),
    ({ key: nextKey, scale: nextScale }) => engine.setHarmony(nextKey, nextScale),
  );

  createEffect(
    () => tempo(),
    (next) => {
      engine.tempo = next;
    },
  );

  createEffect(
    (): Session => {
      take();
      bars();
      return { key: key(), scale: scaleIndex(), tempo: tempo(), loop: engine.loop };
    },
    (session) => {
      if (!loaded) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = null;
        void app.storage.write(SESSION_KEY, JSON.stringify(session));
      }, 800);
    },
  );

  const hearing = () => (stream ? stream.playbackPosition() : engine.position);

  let cancelFrame: (() => void) | null = null;
  const frame = () => {
    cancelFrame = app.scheduler.requestFrame(frame);
    const at = hearing();
    const step = engine.steps.at(at);
    if (step !== heardStep()) setHeardStep(step);
    const angle = engine.reelAngle(at);
    if (angle !== reel()) setReel(angle);
    if (engine.generation !== take()) setTake(engine.generation);
    if (engine.playing !== playing()) setPlaying(engine.playing);
    if (engine.humDegree !== humChord()) setHumChord(engine.humDegree);
  };

  onSettled(() => {
    cancelFrame = app.scheduler.requestFrame(frame);
    void (async () => {
      const session = sanitizeSession(parseJson(await app.storage.read(SESSION_KEY)));
      if (session) {
        engine.loop = session.loop;
        engine.tempo = session.tempo;
        engine.setHarmony(session.key, SCALES[session.scale] ?? SCALES[0]!);
        setKey(session.key);
        setScaleIndex(session.scale);
        setTempo(session.tempo);
        setBars(session.loop.bars);
      }
      loaded = true;
    })();

    const audio = app.audio;
    if (!audio) return;
    void audio
      .open({ channels: 2, latency: "interactive", render: (block) => engine.render(block) })
      .then((opened) => {
        stream = opened;
        setOutput(opened.state());
        opened.onStateChange(setOutput);
      })
      .catch((err: unknown) => {
        console.error("pchkraft: couldn't open sound output", err);
        setOutput("failed");
      });
  });

  onCleanup(() => {
    cancelFrame?.();
    stopHum();
    stream?.close();
    if (saveTimer) clearTimeout(saveTimer);
    if (bannerTimer) clearTimeout(bannerTimer);
  });

  createEffect(
    () => ({
      key: key(),
      scale: scaleIndex(),
      bars: bars(),
      mode: mode(),
      playing: playing(),
      recording: recording(),
      humming: humming(),
      tracker: tracker(),
    }),
    (state) => {
      const radio = (value: string, items: { label: string; value: string }[], onValueChange: (value: string) => void) => ({
        type: "radiogroup" as const,
        value,
        onValueChange,
        items,
      });
      app.setMenus([
        {
          label: "File",
          items: [
            { label: "Clear Loop", onClick: clearLoop },
            { type: "separator" },
            { label: "Quit", shortcut: "Q", onClick: () => app.quit() },
          ],
        },
        {
          label: "Key",
          items: [
            radio(String(state.key), KEY_NAMES.map((label, i) => ({ label, value: String(i) })), (value) => setKey(Number(value))),
            { type: "separator" },
            radio(
              String(state.scale),
              SCALES.map((item, i) => ({ label: item.menu, value: String(i) })),
              (value) => setScaleIndex(Number(value)),
            ),
          ],
        },
        {
          label: "Tape",
          items: [
            { label: state.playing ? "Stop" : "Play", onClick: togglePlay },
            { label: "Record", checked: state.recording, onClick: toggleRecord },
            { label: "Hum", checked: state.humming !== "off", onClick: toggleHum },
            { type: "separator" },
            radio(String(state.bars), [
              { label: "1 Bar", value: "1" },
              { label: "2 Bars", value: "2" },
              { label: "4 Bars", value: "4" },
            ], (value) => {
              const next = Number(value);
              if (next === 1 || next === 2 || next === 4) setLoopBars(next);
            }),
            { label: "Tempo Up", onClick: () => setTempo((t) => clampTempo(t + 1)) },
            { label: "Tempo Down", onClick: () => setTempo((t) => clampTempo(t - 1)) },
            { type: "separator" },
            radio(state.mode, [
              { label: "Chords", value: "chords" },
              { label: "Drums", value: "drums" },
            ], (value) => {
              if (value === "drums" || value === "chords") {
                if (value !== mode()) toggleMode();
              }
            }),
            { label: "Tracker", checked: state.tracker, onClick: () => setTracker((on) => !on) },
          ],
        },
      ]);
    },
  );

  const captions = () =>
    mode() === "drums" ? (["1", "2", "3", "4"] as const) : scale().chords.map((chord) => chord.numeral);
  const padTitles = () =>
    mode() === "drums" ? DRUM_LABELS : scale().chords.map((chord) => chordLabel(key(), chord));

  return (
    <box
      width={SHELL_W}
      height={SHELL_H}
      padding={PAD}
      borderWidth={BORDER}
      borderColor={1}
      borderRadius={8}
      gap={GAP}
      flexDirection="column"
      background={0}
      tabIndex={0}
      autoFocus
      semantic={{ name: "pchkraft", role: "application" }}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={releasePads}
    >
      <box position="absolute" left={2} top={2}><Screw /></box>
      <box position="absolute" right={2} top={2}><Screw /></box>
      <box position="absolute" left={2} bottom={2}><Screw /></box>
      <box position="absolute" right={2} bottom={2}><Screw /></box>

      <box flexDirection="row" gap={GAP} height={SCREEN_H} alignItems="center" justifyContent="space-between">
        <Reel name="reel-left" angle={reel()} hot={recording()} revision={revision()} />
        <Screen
          title={title()}
          aside={aside()}
          status={statusLine()}
          summary={summary()}
          tape={() => engine.loop}
          step={heardStep()}
          tracker={tracker() ? trackerText() : null}
          revision={revision()}
        />
        <Reel name="reel-right" angle={reel() + Math.PI} hot={recording()} revision={revision()} />
      </box>

      <box flexDirection="row" gap={GAP} height={TRANSPORT_H}>
        <Transport name="hum" label="HUM" lit={humming() === "on"} onPress={toggleHum} />
        <Transport name="mode" label={mode() === "drums" ? "DRUM" : "CHORD"} lit={mode() === "drums"} onPress={toggleMode} />
        <Transport name="record" label="REC" lit={recording()} onPress={toggleRecord} />
        <Transport name="play" label={playing() ? "STOP" : "PLAY"} lit={playing()} onPress={togglePlay} />
        <Transport name="clear" label="CLEAR" lit={false} onPress={clearLoop} />
      </box>

      <box flexDirection="row" gap={GAP} height={KEY_H}>
        {[0, 1, 2, 3].map((index) => (
          <Pad
            index={index}
            caption={captions()[index] ?? ""}
            title={padTitles()[index] ?? ""}
            hint={HINTS[index] ?? ""}
            lit={(lit()[index] ?? false) || (mode() === "chords" && padForTriad(scale(), humChord()) === index)}
            onPress={() => {
              pointerDown[index] = true;
              syncPad(index);
            }}
            onLift={() => {
              pointerDown[index] = false;
              syncPad(index);
            }}
          />
        ))}
      </box>
    </box>
  );
}

const ABOUT =
  "A pocket groovebox and looper in the manner of the Vorimo pchkraft. Hum a melody or play the four keys; each beat of a hum becomes the chord that fits it, and the loop starts at once. Keys A S D F play, M listens, R records, Space runs the tape.";

export default defineApp({
  id: "pchkraft",
  title: "pchkraft",
  icon: "pchkraft/icon",
  sprites,
  requires: ["audio"],
  about: { version: "1.0", description: ABOUT },
  defaultSize: { width: SHELL_W, height: SHELL_H },
  resizable: false,
  scrollable: false,
  Component: Pchkraft,
});
