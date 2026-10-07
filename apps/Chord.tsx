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
} from "@mockintosh/sdk";
import type { JSX } from "@mockintosh/ui";
import { ChordEngine } from "./chord/engine";
import { ChordButton, Grille, Joystick, Lcd } from "./chord/faceplate";
import { sprites } from "./chord/icons";
import { RHYTHMS } from "./chord/drums";
import { SETTINGS, STYLES, defaultSettings, sanitizeSettings, type ChordSettings, type SettingKey } from "./chord/settings";
import { SOUNDS, soundPatch } from "./chord/sounds";
import {
  JOYSTICK,
  KEY_NAMES,
  MODES,
  MODIFIER_LABELS,
  diatonicChord,
  directionOf,
  romanNumeral,
  spellNote,
  voiceChord,
  type Chord,
  type Direction,
  type Voicing,
} from "./chord/theory";
import { KnobRow, PanelButton, Section, TITLE_H } from "./synth/panel";
import { KNOB_HEIGHT } from "./synth/Knob";
import { formatParam, type ParamDef } from "./synth/params";

const W = 392;
const PAD = 3;
const GAP = 3;
const INNER_W = W - 2 * PAD;
const TOP_H = 58;
const CELL_W = 24;
const CELL_H = 18;
const GRILLE = TOP_H - 2;
const LCD_W = INNER_W - (3 * CELL_W + 2) - GRILLE - 2 * GAP;
const BUTTON_H = 54;
const BUTTON_W = Math.floor((INNER_W - 6 * GAP) / 7);
const ROW_H = 2 + TITLE_H + 2 + KNOB_HEIGHT + 1;
const H = 2 * PAD + TOP_H + BUTTON_H + ROW_H + 2 * GAP;

/** Middle of the octave the chords are voiced in, before the Octave knob. */
const VOICING_CENTER = 60;

/** Two ways to reach the seven chords: the number row, and the home row. */
const CHORD_KEYS: Readonly<Record<string, number>> = {
  "1": 0, "2": 1, "3": 2, "4": 3, "5": 4, "6": 5, "7": 6,
  a: 0, s: 1, d: 2, f: 3, g: 4, h: 5, j: 6,
};
const ARROWS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const;
type Arrow = (typeof ARROWS)[number];
const isArrow = (key: string): key is Arrow => (ARROWS as readonly string[]).includes(key);

const SESSION_KEY = "session.json";

/** What the instrument remembers between launches. */
interface Session {
  settings: ChordSettings;
  hold: boolean;
}

type StreamStatus = "opening" | "failed" | AudioStreamState;

const defs = (...keys: SettingKey[]) => keys.map((key) => SETTINGS[key]);

function sanitizeSession(value: unknown): Session | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return { settings: sanitizeSettings(record.settings), hold: record.hold === true };
}

function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

const sameVoicing = (a: Voicing | null, b: Voicing | null) =>
  a === b || (a !== null && b !== null && a.bass === b.bass && a.notes.join() === b.notes.join());

function PocketChord(): JSX.Element {
  const app = useApp();
  const engine = new ChordEngine();

  const [settings, setSettings] = createSignal<ChordSettings>(defaultSettings());
  const [hold, setHold] = createSignal(false);
  const [latched, setLatched] = createSignal<Direction>("C");
  const [arrows, setArrows] = createSignal<ReadonlySet<Arrow>>(new Set());
  const [pressed, setPressed] = createSignal<readonly number[]>([]);
  /** The degree sounding: the newest button held, or the last one played while Hold is on. */
  const [sounding, setSounding] = createSignal<number | null>(null);
  /** The degree the display describes; stays after the chord is let go. */
  const [shown, setShown] = createSignal<number | null>(null);
  const [rhythmOn, setRhythmOn] = createSignal(false);
  const [inspected, setInspected] = createSignal<ParamDef | null>(null);
  const [streamStatus, setStreamStatus] = createSignal<StreamStatus>(app.audio ? "opening" : "failed");
  const [heardStep, setHeardStep] = createSignal(-1);

  let stream: AudioStream | null = null;
  let loaded = false;

  // ---------------------------------------------------------------------------
  // Chords
  // ---------------------------------------------------------------------------

  const direction = (): Direction => {
    const held = arrows();
    const pushed = directionOf(held.has("ArrowUp"), held.has("ArrowDown"), held.has("ArrowLeft"), held.has("ArrowRight"));
    return pushed === "C" ? latched() : pushed;
  };
  const modifier = () => JOYSTICK[direction()];

  const chordOn = (degree: number): Chord => {
    const s = settings();
    return diatonicChord(s.key, s.mode, degree, modifier());
  };
  const voicingOf = (degree: number): Voicing => {
    const s = settings();
    return voiceChord(chordOn(degree), VOICING_CENTER + 12 * s.octave, s.bass === 1);
  };

  let sent: Voicing | null = null;
  const send = (voicing: Voicing | null, retrigger: boolean) => {
    if (voicing === null) engine.release();
    else engine.play(voicing, retrigger);
    sent = voicing;
  };

  const pressDegree = (degree: number) => {
    setPressed((list) => [...list.filter((d) => d !== degree), degree]);
    setSounding(degree);
    setShown(degree);
    send(voicingOf(degree), true);
  };

  const liftDegree = (degree: number) => {
    const before = pressed();
    if (!before.includes(degree)) return;
    const after = before.filter((d) => d !== degree);
    setPressed(after);
    if (before[before.length - 1] !== degree) return;
    const next = after[after.length - 1];
    if (next !== undefined) {
      setSounding(next);
      setShown(next);
      send(voicingOf(next), true);
    } else if (!hold()) {
      setSounding(null);
      send(null, false);
    }
  };

  /** Let go of everything the hands are on; a held chord keeps ringing if Hold is on. */
  const releaseHands = () => {
    setArrows(new Set<Arrow>());
    const list = pressed();
    if (list.length === 0) return;
    setPressed([]);
    if (!hold()) {
      setSounding(null);
      send(null, false);
    }
  };

  const stopSound = () => {
    setPressed([]);
    setSounding(null);
    sent = null;
    engine.release();
  };

  const toggleHold = () => {
    const next = !hold();
    setHold(next);
    if (!next && pressed().length === 0) stopSound();
  };

  const setRhythm = (on: boolean) => {
    engine.setRhythm(on);
    setRhythmOn(on);
  };

  // The joystick, key, octave or bass moved under a sounding chord: move the notes that changed.
  createEffect(
    () => {
      const degree = sounding();
      return degree === null ? null : voicingOf(degree);
    },
    (voicing) => {
      if (voicing === null || sameVoicing(voicing, sent)) return;
      send(voicing, false);
    },
  );

  // ---------------------------------------------------------------------------
  // Settings → engine
  // ---------------------------------------------------------------------------

  createEffect(settings, (s) => {
    engine.patch = soundPatch(s);
    engine.tempo = s.tempo;
    engine.rhythm = s.rhythm;
    engine.style = s.style;
  });

  const edit = (key: SettingKey, value: number) => setSettings((prev) => ({ ...prev, [key]: value }));
  const step = (key: SettingKey, by: number) => {
    const def = SETTINGS[key];
    const count = def.kind === "choice" ? def.options.length : 0;
    setSettings((prev) => {
      const value = count > 0 ? (((prev[key] + by) % count) + count) % count : prev[key] + by;
      return { ...prev, [key]: def.kind === "number" ? Math.max(def.min, Math.min(def.max, value)) : value };
    });
  };

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  const heldKeys = new Set<string>();

  const onKeyDown = (rawKey: string, mods: { meta: boolean; ctrl: boolean; alt: boolean }) => {
    if (mods.meta || mods.ctrl || mods.alt) return;
    const key = rawKey.length === 1 ? rawKey.toLowerCase() : rawKey;
    if (heldKeys.has(key)) return;
    heldKeys.add(key);
    if (isArrow(key)) {
      setArrows((prev) => new Set([...prev, key]));
      return;
    }
    if (key === " ") {
      setRhythm(!engine.playingRhythm);
      return;
    }
    if (key === "z" || key === "x") {
      step("octave", key === "z" ? -1 : 1);
      return;
    }
    const degree = CHORD_KEYS[key];
    if (degree !== undefined) pressDegree(degree);
  };

  const onKeyUp = (rawKey: string) => {
    const key = rawKey.length === 1 ? rawKey.toLowerCase() : rawKey;
    heldKeys.delete(key);
    if (isArrow(key)) {
      setArrows((prev) => new Set([...prev].filter((k) => k !== key)));
      return;
    }
    const degree = CHORD_KEYS[key];
    if (degree === undefined) return;
    const stillHeld = [...heldKeys].some((k) => CHORD_KEYS[k] === degree);
    if (!stillHeld) liftDegree(degree);
  };

  const onBlur = () => {
    heldKeys.clear();
    releaseHands();
  };

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  createEffect(
    (): Session => ({ settings: settings(), hold: hold() }),
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
  // Sound, and the frame loop that follows the beat the speaker is playing
  // ---------------------------------------------------------------------------

  const hearing = () => (stream ? stream.playbackPosition() : engine.position);

  let cancelFrame: (() => void) | null = null;
  const frame = () => {
    cancelFrame = app.scheduler.requestFrame(frame);
    const heard = engine.steps.at(hearing());
    if (heard !== heardStep()) setHeardStep(heard);
  };

  onSettled(() => {
    cancelFrame = app.scheduler.requestFrame(frame);
    void (async () => {
      const session = sanitizeSession(parseJson(await app.storage.read(SESSION_KEY)));
      if (session) {
        setSettings(session.settings);
        setHold(session.hold);
      }
      loaded = true;
    })();

    const audio = app.audio;
    if (!audio) return;
    void audio
      .open({ channels: 2, latency: "interactive", render: (block) => engine.render(block) })
      .then((opened) => {
        stream = opened;
        setStreamStatus(opened.state());
        opened.onStateChange(setStreamStatus);
      })
      .catch((err: unknown) => {
        console.error("Pocket Chord: couldn't open sound output", err);
        setStreamStatus("failed");
      });
  });

  onCleanup(() => {
    cancelFrame?.();
    stream?.close();
    if (saveTimer) clearTimeout(saveTimer);
  });

  // ---------------------------------------------------------------------------
  // Menus
  // ---------------------------------------------------------------------------

  createEffect(
    () => ({ s: settings(), hold: hold(), rhythm: rhythmOn() }),
    ({ s, hold: holding, rhythm }) => {
      const radio = (key: SettingKey, labels: readonly string[]) => ({
        type: "radiogroup" as const,
        value: String(s[key]),
        onValueChange: (value: string) => edit(key, Number(value)),
        items: labels.map((label, i) => ({ label, value: String(i) })),
      });
      app.setMenus([
        { label: "File", items: [{ label: "Quit", shortcut: "Q", onClick: () => app.quit() }] },
        {
          label: "Key",
          items: [
            radio("key", KEY_NAMES),
            { type: "separator" },
            radio("mode", MODES.map((m) => `${m.name[0]}${m.name.slice(1).toLowerCase()}`)),
            { type: "separator" },
            { label: "Octave Up", onClick: () => step("octave", 1) },
            { label: "Octave Down", onClick: () => step("octave", -1) },
          ],
        },
        {
          label: "Sound",
          items: [
            radio("sound", SOUNDS.map((sound) => sound.name[0] + sound.name.slice(1).toLowerCase())),
            { type: "separator" },
            { type: "submenu", label: "Play Style", items: [radio("style", STYLES)] },
            { label: s.bass === 1 ? "Bass Note Off" : "Bass Note On", onClick: () => edit("bass", s.bass === 1 ? 0 : 1) },
            { label: holding ? "Stop Holding Chords" : "Hold Chords", shortcut: "L", onClick: toggleHold },
          ],
        },
        {
          label: "Rhythm",
          items: [
            { label: rhythm ? "Stop" : "Start", onClick: () => setRhythm(!rhythm) },
            { type: "separator" },
            radio("rhythm", RHYTHMS.map((r) => r.name)),
            { type: "separator" },
            { label: "Faster", shortcut: "=", onClick: () => step("tempo", 5) },
            { label: "Slower", shortcut: "-", onClick: () => step("tempo", -5) },
            { type: "separator" },
            {
              label: "All Notes Off",
              shortcut: ".",
              onClick: () => {
                setRhythm(false);
                stopSound();
                engine.panic();
              },
            },
          ],
        },
      ]);
    },
  );

  // ---------------------------------------------------------------------------
  // The faceplate
  // ---------------------------------------------------------------------------

  const title = () => {
    const degree = shown();
    if (degree === null) {
      const s = settings();
      return `${KEY_NAMES[s.key]} ${(MODES[s.mode]?.name ?? "").toLowerCase()}`;
    }
    return chordOn(degree).name;
  };

  const detail = () => {
    const def = inspected();
    if (def) return `${def.name} ${formatParam(def, settings()[def.key as SettingKey])}`;
    const s = settings();
    const degree = shown();
    if (degree === null) return `${SOUNDS[s.sound]?.name ?? ""} • ${STYLES[s.style] ?? ""}`;
    const chord = chordOn(degree);
    const label = MODIFIER_LABELS[modifier()];
    const numeral = romanNumeral(s.key, s.mode, degree);
    const notes = chord.intervals.map((i) => spellNote(chord.root + i, s.key, s.mode)).join(" ");
    return `${numeral}${label ? ` ${label}` : ""} • ${notes}`;
  };

  const status = () => {
    const state = streamStatus();
    if (state === "failed") return "No sound output";
    if (state === "opening") return "Warming up...";
    if (state === "closed") return "Sound off";
    if (state === "suspended") return "Click or press a key for sound";
    const s = settings();
    const extras = hold() ? " • HOLD" : "";
    if (rhythmOn()) return `${RHYTHMS[s.rhythm]?.name ?? ""} • ${Math.round(s.tempo)} BPM${extras}`;
    return `Keys 1-7 • Arrows bend • Space beat${extras}`;
  };

  let beatPaints = 0;
  const beatRevision = createMemo(() => {
    heardStep();
    return ++beatPaints;
  });

  const isLit = (degree: number) => pressed().includes(degree) || (hold() && sounding() === degree);

  const knobs = (list: readonly ParamDef<SettingKey>[]) => (
    <KnobRow defs={list} values={settings()} onChange={edit} onInspect={setInspected} />
  );

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
      semantic={{ name: "pocket-chord", role: "application" }}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={onBlur}
    >
      <box flexDirection="row" gap={GAP} height={TOP_H} alignItems="center">
        <Lcd
          width={LCD_W}
          height={TOP_H}
          chord={title()}
          detail={detail()}
          status={status()}
          step={heardStep()}
          beatRevision={beatRevision()}
        />
        <Joystick cellWidth={CELL_W} cellHeight={CELL_H} direction={direction()} latched={latched()} onLatch={setLatched} />
        <Grille size={GRILLE} />
      </box>

      <box flexDirection="row" height={BUTTON_H} justifyContent="space-between">
        {[0, 1, 2, 3, 4, 5, 6].map((degree) => (
          <ChordButton
            degree={degree}
            numeral={romanNumeral(settings().key, settings().mode, degree)}
            chord={chordOn(degree).name}
            hint={String(degree + 1)}
            width={BUTTON_W}
            height={BUTTON_H}
            lit={isLit(degree)}
            onPress={() => pressDegree(degree)}
            onLift={() => liftDegree(degree)}
          />
        ))}
      </box>

      <box flexDirection="row" gap={GAP} height={ROW_H}>
        <Section title="KEY" flexGrow={1}>
          {knobs(defs("key", "mode", "octave"))}
        </Section>
        <Section title="SOUND" flexGrow={1}>
          {knobs(defs("sound", "tone", "space", "volume"))}
        </Section>
        <Section title="PLAY" flexGrow={1}>
          <box paddingTop={8}>
            <PanelButton name="hold" label="HOLD" width={34} lit={hold()} onPress={toggleHold} />
          </box>
          {knobs(defs("style", "bass"))}
        </Section>
        <Section title="RHYTHM" flexGrow={1}>
          <box paddingTop={8}>
            <PanelButton name="rhythm" label={rhythmOn() ? "STOP" : "START"} width={34} lit={rhythmOn()} onPress={() => setRhythm(!rhythmOn())} />
          </box>
          {knobs(defs("rhythm", "tempo"))}
        </Section>
      </box>
    </box>
  );
}

export default defineApp({
  id: "chord",
  title: "Pocket Chord",
  icon: "chord/icon",
  smallIcon: "chord/icon-16x16",
  sprites,
  requires: ["audio"],
  about: {
    version: "1.0",
    description:
      "A pocket chord instrument. Seven buttons play the chords of a key; the joystick adds sevenths, suspensions and more. Strum, arpeggiate or pulse over a built-in rhythm box.",
  },
  defaultSize: { width: W, height: H },
  resizable: false,
  scrollable: false,
  Component: PocketChord,
});
