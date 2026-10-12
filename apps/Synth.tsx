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
import { SynthEngine } from "./synth/engine";
import { sprites } from "./synth/icons";
import { Keyboard } from "./synth/Keyboard";
import { Display, KnobRow, PanelButton, Section, TITLE_H } from "./synth/panel";
import {
  ARP_MODES,
  PARAMS,
  PERFORMANCE_PARAMS,
  VOICE_MODES,
  formatParam,
  sanitizePatch,
  sanitizePerformance,
  type ParamDef,
  type Patch,
  type PatchKey,
  type Performance,
  type PerformanceKey,
} from "./synth/params";
import { DEMO_SONGS, FACTORY_PATCHES, findPatch, surprisePatch, type DemoSong, type PatchPreset } from "./synth/presets";
import { Scope, SCOPE_MODES, type ScopeMode, type ScopeSource } from "./synth/Scope";
import {
  clonePattern,
  emptyPattern,
  mutatePattern,
  rollPattern,
  rotatePattern,
  sanitizePattern,
  transposePattern,
  type Pattern,
} from "./synth/sequencer";
import { StepGrid, STEP_W } from "./synth/StepGrid";
import { KNOB_HEIGHT } from "./synth/Knob";

const W = 500;
const H = 296;
const PAD = 3;
const GAP = 3;
const INNER_W = W - 2 * PAD;
/** A section of one knob row: border, title band, padding, knob and caption. */
const ROW_H = 2 + TITLE_H + 2 + KNOB_HEIGHT + 1;
const GRID_H = 44;
const SEQ_H = 2 + TITLE_H + 2 + GRID_H + 1;
const DISPLAY_W = 146;
const SCOPE_W = 130;
const KEYS_LOW = 36;
const KEYS_OCTAVES = 5;
const KEYS_H = H - 2 * PAD - 4 * GAP - 3 * ROW_H - SEQ_H;

const MIN_OCTAVE = 2;
const MAX_OCTAVE = 5;

/** Two rows of the computer keyboard as a piano, from C: the home row is white, the row above black. */
const COMPUTER_KEYS: Readonly<Record<string, number>> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ";": 16, "'": 17,
};

const SESSION_KEY = "session.json";
const PATCHES_KEY = "patches.json";

/** What the synth remembers between launches. */
interface Session {
  patch: Patch;
  patchName: string;
  edited: boolean;
  performance: Performance;
  pattern: Pattern;
  octave: number;
  scope: ScopeMode;
}

type StreamStatus = "opening" | "failed" | AudioStreamState;

const patchDefs = (...keys: PatchKey[]) => keys.map((key) => PARAMS[key]);
const perfDefs = (...keys: PerformanceKey[]) => keys.map((key) => PERFORMANCE_PARAMS[key]);

const isPatchKey = (key: string): key is PatchKey => key in PARAMS;

function sanitizeUserPatches(value: unknown): PatchPreset[] {
  const list = value && typeof value === "object" ? (value as { patches?: unknown }).patches : undefined;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object") return [];
    const { name, patch } = entry as { name?: unknown; patch?: unknown };
    return typeof name === "string" && name.trim() ? [{ name: name.trim(), patch: sanitizePatch(patch) }] : [];
  });
}

function sanitizeSession(value: unknown): Session | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const octave = typeof record.octave === "number" ? Math.round(record.octave) : 3;
  return {
    patch: sanitizePatch(record.patch),
    patchName: typeof record.patchName === "string" ? record.patchName : "Untitled",
    edited: record.edited === true,
    performance: sanitizePerformance(record.performance),
    pattern: sanitizePattern(record.pattern),
    octave: Math.max(MIN_OCTAVE, Math.min(MAX_OCTAVE, octave)),
    scope: SCOPE_MODES.find((mode) => mode === record.scope) ?? "WAVE",
  };
}

function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function formatTake(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Synth(): JSX.Element {
  const app = useApp();
  const engine = new SynthEngine();
  const firstSong = DEMO_SONGS[0]!;

  const [patch, setPatch] = createSignal<Patch>(findPatch(firstSong.patch)?.patch ?? sanitizePatch(null));
  const [patchName, setPatchName] = createSignal(firstSong.patch);
  const [edited, setEdited] = createSignal(false);
  const [performance, setPerformance] = createSignal<Performance>(firstSong.performance);
  const [pattern, setPattern] = createSignal<Pattern>(clonePattern(firstSong.pattern));
  const [octave, setOctave] = createSignal(3);
  const [scopeMode, setScopeMode] = createSignal<ScopeMode>("WAVE");
  const [userPatches, setUserPatches] = createSignal<PatchPreset[]>([]);
  const [playing, setPlaying] = createSignal(false);
  const [inspected, setInspected] = createSignal<ParamDef | null>(null);
  const [streamStatus, setStreamStatus] = createSignal<StreamStatus>(app.audio ? "opening" : "failed");
  const [recording, setRecording] = createSignal<number | null>(null);
  const [pressed, setPressed] = createSignal<ReadonlySet<number>>(new Set());
  const [heardTick, setHeardTick] = createSignal(0);
  const [scopeTick, setScopeTick] = createSignal(0);
  const [playingStep, setPlayingStep] = createSignal(-1);

  let stream: AudioStream | null = null;
  let loaded = false;
  let takes = 0;

  // ---------------------------------------------------------------------------
  // State → engine
  // ---------------------------------------------------------------------------

  createEffect(patch, (next) => {
    engine.patch = next;
  });
  createEffect(performance, (next) => {
    if (next.arpMode !== engine.performance.arpMode) releaseAllKeys();
    engine.performance = next;
  });
  createEffect(pattern, (next) => {
    engine.pattern = next;
  });

  const editPatch = (key: PatchKey, value: number) => {
    setPatch((prev) => ({ ...prev, [key]: value }));
    setEdited(true);
  };
  const editPerformance = (key: PerformanceKey, value: number) => setPerformance((prev) => ({ ...prev, [key]: value }));

  const loadPatch = (preset: PatchPreset) => {
    setPatch(preset.patch);
    setPatchName(preset.name);
    setEdited(false);
  };

  const loadSong = (song: DemoSong) => {
    const preset = findPatch(song.patch);
    if (preset) loadPatch(preset);
    setPattern(clonePattern(song.pattern));
    setPerformance(song.performance);
  };

  const random = () => Math.random();
  const setPlay = (on: boolean) => {
    engine.setPlaying(on);
    setPlaying(on);
  };

  // ---------------------------------------------------------------------------
  // Playing notes: mouse on the keyboard and the computer keys
  // ---------------------------------------------------------------------------

  const heldKeys = new Map<string, number>();
  const mouseNotes = new Set<number>();

  const refreshPressed = () => setPressed(new Set([...heldKeys.values(), ...mouseNotes]));

  function releaseAllKeys(): void {
    heldKeys.clear();
    mouseNotes.clear();
    engine.releaseKeys();
    refreshPressed();
  }

  const keysBase = () => 12 * (octave() + 1);

  const onKeyDown = (rawKey: string, mods: { meta: boolean; ctrl: boolean; alt: boolean }) => {
    if (mods.meta || mods.ctrl || mods.alt) return;
    const key = rawKey.length === 1 ? rawKey.toLowerCase() : rawKey;
    if (heldKeys.has(key)) return;
    if (key === " ") {
      setPlay(!engine.playing);
      return;
    }
    if (key === "z" || key === "x") {
      setOctave((o) => Math.max(MIN_OCTAVE, Math.min(MAX_OCTAVE, o + (key === "z" ? -1 : 1))));
      return;
    }
    const offset = COMPUTER_KEYS[key];
    if (offset === undefined) return;
    const note = keysBase() + offset;
    heldKeys.set(key, note);
    engine.noteOn(note, 0.8);
    refreshPressed();
  };

  const onKeyUp = (rawKey: string) => {
    const key = rawKey.length === 1 ? rawKey.toLowerCase() : rawKey;
    const note = heldKeys.get(key);
    if (note === undefined) return;
    heldKeys.delete(key);
    if (![...heldKeys.values()].includes(note) && !mouseNotes.has(note)) engine.noteOff(note);
    refreshPressed();
  };

  // ---------------------------------------------------------------------------
  // Recording
  // ---------------------------------------------------------------------------

  const toggleRecording = () => {
    if (!engine.recordingActive) {
      engine.startRecording();
      setRecording(0);
      return;
    }
    const take = engine.stopRecording();
    setRecording(null);
    const download = app.download;
    if (!take || !download || take[0]!.length === 0) return;
    takes++;
    const bytes = encodeWav(take, engine.sampleRate);
    download.save({ name: `Synth Take ${takes}.wav`, type: "audio/wav", bytes }).catch((err: unknown) => {
      void app.os.showDialog({ message: `Couldn't save the take: ${err instanceof Error ? err.message : String(err)}` });
    });
  };

  // ---------------------------------------------------------------------------
  // Patches
  // ---------------------------------------------------------------------------

  const writeUserPatches = (list: PatchPreset[]) => {
    setUserPatches(list);
    void app.storage.write(PATCHES_KEY, JSON.stringify({ patches: list }));
  };

  const savePatchAs = async () => {
    const typed = await app.os.showDialog({
      message: "Save this patch as:",
      showInput: true,
      inputDefault: patchName(),
      variant: "note",
    });
    const name = typed?.trim();
    if (!name) return;
    const current = patch();
    const list = [...userPatches().filter((p) => p.name !== name), { name, patch: current }];
    list.sort((a, b) => a.name.localeCompare(b.name));
    writeUserPatches(list);
    setPatchName(name);
    setEdited(false);
  };

  const deleteUserPatch = async () => {
    const name = patchName();
    const answer = await app.os.showDialog({
      message: `Delete the patch "${name}"? The sound stays loaded until you pick another.`,
      buttons: ["Cancel", "Delete"],
      variant: "caution",
    });
    if (answer !== "Delete") return;
    writeUserPatches(userPatches().filter((p) => p.name !== name));
    setEdited(true);
  };

  const revertPatch = () => {
    const preset = userPatches().find((p) => p.name === patchName()) ?? findPatch(patchName());
    if (preset) loadPatch(preset);
  };

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  createEffect(
    (): Session => ({
      patch: patch(),
      patchName: patchName(),
      edited: edited(),
      performance: performance(),
      pattern: pattern(),
      octave: octave(),
      scope: scopeMode(),
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
  // Sound, and the frame loop that shows what the speaker is playing
  // ---------------------------------------------------------------------------

  const heard = new Set<number>();
  let heardKey = "";
  let scopeLive = false;
  const hearing = () => (stream ? stream.playbackPosition() : engine.position);

  const scopeSource: ScopeSource = {
    left: engine.scopeL,
    right: engine.scopeR,
    now: hearing,
    sampleRate: () => engine.sampleRate,
    fundamental: () => {
      if (heard.size === 0) return null;
      return noteHz(Math.min(...heard) + 12 * engine.patch.osc1Octave);
    },
  };

  let cancelFrame: (() => void) | null = null;
  const frame = () => {
    cancelFrame = app.scheduler.requestFrame(frame);
    const now = hearing();

    engine.notes.at(now, heard);
    const key = [...heard].sort((a, b) => a - b).join(",");
    if (key !== heardKey) {
      heardKey = key;
      setHeardTick((n) => n + 1);
    }

    const step = engine.steps.at(now);
    if (step !== playingStep()) setPlayingStep(step);

    const live = now - engine.lastSoundFrame < engine.sampleRate * 0.3;
    if (live || scopeLive) setScopeTick((n) => n + 1);
    scopeLive = live;

    if (engine.recordingActive) {
      const seconds = Math.floor(engine.recordedSeconds);
      if (seconds !== recording()) setRecording(seconds);
    } else if (recording() !== null) {
      setRecording(null);
    }
  };

  onSettled(() => {
    cancelFrame = app.scheduler.requestFrame(frame);
    void (async () => {
      const [sessionText, patchesText] = await Promise.all([app.storage.read(SESSION_KEY), app.storage.read(PATCHES_KEY)]);
      const session = sanitizeSession(parseJson(sessionText));
      if (session) {
        setPatch(session.patch);
        setPatchName(session.patchName);
        setEdited(session.edited);
        setPerformance(session.performance);
        setPattern(session.pattern);
        setOctave(session.octave);
        setScopeMode(session.scope);
      }
      setUserPatches(sanitizeUserPatches(parseJson(patchesText)));
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
        console.error("Synthesizer: couldn't open sound output", err);
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
    () => ({
      name: patchName(),
      edited: edited(),
      user: userPatches(),
      playing: playing(),
      recording: recording() !== null,
      scope: scopeMode(),
      canDownload: app.download !== undefined,
    }),
    (state) => {
      const isUser = state.user.some((p) => p.name === state.name);
      const patchValue = isUser ? `user:${state.name}` : `factory:${state.name}`;
      const choosePatch = (value: string) => {
        const [kind, ...rest] = value.split(":");
        const name = rest.join(":");
        const preset = kind === "user" ? state.user.find((p) => p.name === name) : findPatch(name);
        if (preset) loadPatch(preset);
      };

      const fileItems: MenubarItemDef[] = [];
      if (state.canDownload) {
        fileItems.push(
          { label: state.recording ? "Stop Recording" : "Start Recording", shortcut: "R", onClick: toggleRecording },
          { type: "separator" },
        );
      }
      fileItems.push({ label: "Quit", shortcut: "Q", onClick: () => app.quit() });

      const patchItems: MenubarItemDef[] = [
        {
          type: "submenu",
          label: "Factory",
          items: [
            {
              type: "radiogroup",
              value: patchValue,
              onValueChange: choosePatch,
              items: FACTORY_PATCHES.map((p) => ({ label: p.name, value: `factory:${p.name}` })),
            },
          ],
        },
      ];
      if (state.user.length > 0) {
        patchItems.push({
          type: "radiogroup",
          value: patchValue,
          onValueChange: choosePatch,
          items: state.user.map((p) => ({ label: p.name, value: `user:${p.name}` })),
        });
      }
      patchItems.push(
        { type: "separator" },
        { label: "Save Patch…", shortcut: "S", onClick: () => void savePatchAs() },
        { label: "Delete Patch…", disabled: !isUser, onClick: () => void deleteUserPatch() },
        { label: "Revert to Saved", disabled: !state.edited, onClick: revertPatch },
        { type: "separator" },
        {
          label: "Surprise Me",
          shortcut: "U",
          onClick: () => {
            setPatch(surprisePatch(random));
            setPatchName("Surprise");
            setEdited(true);
          },
        },
      );

      const scale = () => performance().scale;
      app.setMenus([
        { label: "File", items: fileItems },
        { label: "Patch", items: patchItems },
        {
          label: "Sequencer",
          items: [
            { label: state.playing ? "Stop" : "Play", onClick: () => setPlay(!engine.playing) },
            { type: "separator" },
            { label: "Roll the Dice", shortcut: "D", onClick: () => setPattern(rollPattern(random, scale())) },
            { label: "Mutate", shortcut: "⇧M", onClick: () => setPattern((p) => mutatePattern(p, random, scale())) },
            { label: "Clear", onClick: () => setPattern(emptyPattern()) },
            { type: "separator" },
            { label: "Shift Left", shortcut: "[", onClick: () => setPattern((p) => rotatePattern(p, -1)) },
            { label: "Shift Right", shortcut: "]", onClick: () => setPattern((p) => rotatePattern(p, 1)) },
            { label: "Transpose Up", onClick: () => setPattern((p) => transposePattern(p, 1, scale())) },
            { label: "Transpose Down", onClick: () => setPattern((p) => transposePattern(p, -1, scale())) },
            { type: "separator" },
            {
              type: "submenu",
              label: "Demo Songs",
              items: DEMO_SONGS.map((song) => ({
                label: song.name,
                onClick: () => {
                  loadSong(song);
                  setPlay(true);
                },
              })),
            },
          ],
        },
        {
          label: "View",
          items: [
            {
              type: "radiogroup",
              value: state.scope,
              onValueChange: (value) => setScopeMode(SCOPE_MODES.find((mode) => mode === value) ?? "WAVE"),
              items: [
                { label: "Waveform", value: "WAVE" },
                { label: "Spectrum", value: "SPECTRUM" },
                { label: "Stereo Field", value: "STEREO" },
              ],
            },
            { type: "separator" },
            {
              label: "All Notes Off",
              shortcut: ".",
              onClick: () => {
                setPlay(false);
                heldKeys.clear();
                mouseNotes.clear();
                refreshPressed();
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

  const valueOf = (def: ParamDef): number =>
    isPatchKey(def.key) ? patch()[def.key] : performance()[def.key as PerformanceKey];

  const title = () => `${patchName()}${edited() ? "*" : ""}`;
  const detail = () => {
    const def = inspected();
    if (def) return `${def.name} ${formatParam(def, valueOf(def))}`;
    return `${VOICE_MODES[patch().voiceMode] ?? ""} • KEYS ${noteName(keysBase())} • ${Math.round(performance().tempo)} BPM`;
  };
  const status = () => {
    const state = streamStatus();
    if (state === "failed") return "No sound output";
    if (state === "opening") return "Warming up...";
    if (state === "closed") return "Sound off";
    if (state === "suspended") return "Click or press a key for sound";
    const take = recording();
    if (take !== null) return `• REC ${formatTake(take)}`;
    const perf = performance();
    if (playing()) {
      const step = Math.max(0, playingStep()) + 1;
      return `SEQ ${String(step).padStart(2, "0")}/${Math.round(perf.length)}`;
    }
    if (perf.arpMode > 0) return `ARP ${ARP_MODES[perf.arpMode] ?? ""} • ${Math.round(perf.arpOctaves)} OCT`;
    return "Keys A-K • Z/X octave • Space";
  };

  let keyPaints = 0;
  const keysRevision = createMemo(() => {
    pressed();
    heardTick();
    octave();
    return ++keyPaints;
  });
  const isLit = (note: number) => pressed().has(note) || heard.has(note);

  let gridPaints = 0;
  const gridRevision = createMemo(() => {
    pattern();
    performance();
    playingStep();
    return ++gridPaints;
  });

  const reach = () => {
    const low = keysBase();
    return { low, high: low + 17 };
  };

  const cycleScope = () => {
    const index = SCOPE_MODES.indexOf(scopeMode());
    setScopeMode(SCOPE_MODES[(index + 1) % SCOPE_MODES.length]!);
  };

  const knobs = (defs: readonly ParamDef<PatchKey>[]) => (
    <KnobRow defs={defs} values={patch()} onChange={editPatch} onInspect={setInspected} />
  );
  const perfKnobs = (defs: readonly ParamDef<PerformanceKey>[]) => (
    <KnobRow defs={defs} values={performance()} onChange={editPerformance} onInspect={setInspected} />
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
      semantic={{ name: "synthesizer", role: "application" }}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={releaseAllKeys}
    >
      <box flexDirection="row" gap={GAP} height={ROW_H}>
        <Display width={DISPLAY_W} height={ROW_H} title={title()} detail={detail()} status={status()} />
        <box width={SCOPE_W} height={ROW_H} borderWidth={1} borderColor={1} borderRadius={2}>
          <Scope
            width={SCOPE_W - 2}
            height={ROW_H - 2}
            mode={scopeMode()}
            source={scopeSource}
            revision={scopeTick()}
            onClick={cycleScope}
          />
        </box>
        <Section title="EFFECTS" flexGrow={1}>
          {knobs(patchDefs("drive", "lofi", "chorus", "delayTime", "delayFeedback", "delayMix", "reverb", "volume"))}
        </Section>
      </box>

      <box flexDirection="row" gap={GAP} height={ROW_H}>
        <Section title="OSC 1" flexGrow={1}>
          {knobs(patchDefs("osc1Wave", "osc1Octave", "pulseWidth"))}
        </Section>
        <Section title="OSC 2" flexGrow={1}>
          {knobs(patchDefs("osc2Wave", "osc2Semi", "osc2Fine"))}
        </Section>
        <Section title="MIXER" flexGrow={1}>
          {knobs(patchDefs("osc1Level", "osc2Level", "subLevel", "noiseLevel", "fm"))}
        </Section>
        <Section title="FILTER" flexGrow={1}>
          {knobs(patchDefs("cutoff", "resonance", "filterEnv", "keyTrack", "filterType"))}
        </Section>
      </box>

      <box flexDirection="row" gap={GAP} height={ROW_H}>
        <Section title="FILTER ENV" flexGrow={1}>
          {knobs(patchDefs("fAttack", "fDecay", "fSustain", "fRelease"))}
        </Section>
        <Section title="AMP ENV" flexGrow={1}>
          {knobs(patchDefs("attack", "decay", "sustain", "release"))}
        </Section>
        <Section title="LFO" flexGrow={1}>
          {knobs(patchDefs("lfoRate", "lfoWave", "lfoPitch", "lfoFilter", "lfoPwm"))}
        </Section>
        <Section title="VOICE" flexGrow={1}>
          {knobs(patchDefs("voiceMode", "glide", "spread"))}
          {perfKnobs(perfDefs("arpMode", "arpOctaves"))}
        </Section>
      </box>

      <box flexDirection="row" height={SEQ_H}>
        <Section title="SEQUENCER" flexGrow={1}>
          <box flexDirection="column" gap={1} width={40}>
            <PanelButton name="play" label={playing() ? "STOP" : "PLAY"} width={40} lit={playing()} onPress={() => setPlay(!engine.playing)} />
            <PanelButton name="dice" label="DICE" width={40} onPress={() => setPattern(rollPattern(random, performance().scale))} />
            <PanelButton name="clear" label="CLEAR" width={40} onPress={() => setPattern(emptyPattern())} />
          </box>
          <box flexDirection="row" gap={2}>
            {perfKnobs(perfDefs("tempo", "swing", "length", "gate", "root", "scale", "seqOctave"))}
          </box>
          <box width={STEP_W * 16}>
            <StepGrid
              pattern={pattern()}
              scale={performance().scale}
              length={Math.round(performance().length)}
              playingStep={playingStep}
              revision={gridRevision()}
              height={GRID_H}
              onChange={setPattern}
            />
          </box>
        </Section>
      </box>

      <Keyboard
        width={INNER_W}
        height={KEYS_H}
        low={KEYS_LOW}
        octaves={KEYS_OCTAVES}
        isLit={isLit}
        revision={keysRevision()}
        reach={reach()}
        onNoteOn={(note) => {
          mouseNotes.add(note);
          engine.noteOn(note, 0.8);
          refreshPressed();
        }}
        onNoteOff={(note) => {
          mouseNotes.delete(note);
          if (![...heldKeys.values()].includes(note)) engine.noteOff(note);
          refreshPressed();
        }}
      />
    </box>
  );
}

export default defineApp({
  id: "synth",
  title: "Synthesizer",
  icon: "synth/icon",
  smallIcon: "synth/icon-16x16",
  sprites,
  requires: ["audio"],
  about: {
    version: "1.0",
    description:
      "A polyphonic analog-style synthesizer with a 16-step sequencer, arpeggiator and effects. Play it with the mouse or the keys A to K.",
  },
  defaultSize: { width: W, height: H },
  resizable: false,
  scrollable: false,
  Component: Synth,
});