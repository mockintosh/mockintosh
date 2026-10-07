import {
  createEffect,
  createMemo,
  createSignal,
  decodeWav,
  defineApp,
  onCleanup,
  onSettled,
  uniqueChildName,
  useApp,
  type AudioStream,
  type AudioStreamState,
  type MenubarItemDef,
  type MicrophoneInput,
} from "@mockintosh/sdk";
import type { JSX } from "@mockintosh/ui";
import { Knob } from "./synth/Knob";
import { numberParam } from "./synth/params";
import { SECONDS_PER_TURN, Tp7Engine, makeTape } from "./tp7/engine";
import {
  Grille,
  MicHole,
  REEL_SIZE,
  Reel,
  SIDE_KEY_W,
  SMALL_KEY_H,
  Screen,
  SideKey,
  SmallKey,
} from "./tp7/faceplate";
import { sprites } from "./tp7/icons";
import { WAV, displayName, ensureLibrary, findLibrary, listMemos, loadMemo, saveMarkers, storeMemo } from "./tp7/library";
import {
  SCREEN_H,
  SCREEN_W,
  formatCounter,
  formatDuration,
  type ListView,
  type ScreenView,
  type TapeView,
  type TransportStatus,
} from "./tp7/screen";

const PAD = 10;
const GAP = 14;
const BEZEL = 2;
const LEFT_W = SCREEN_W + 2 * BEZEL;
const H = 236;
const SIDE_GAP = 8;
const SIDE_KEY_H = Math.floor((H - 2 * PAD - 2 * SIDE_GAP) / 3);
const W = PAD + LEFT_W + GAP + REEL_SIZE + GAP + SIDE_KEY_W + PAD;
const LOWER_H = H - 2 * PAD - (SCREEN_H + 2 * BEZEL) - SMALL_KEY_H - 2 * 8;

const VOLUME = numberParam("volume", "VOL", "VOLUME", 0, 1, 0.8, (v) => `${Math.round(v * 100)}`);
const SESSION_KEY = "session.json";
/** How long a message holds the title line. */
const MESSAGE_MS = 1600;
/** Shorter takes are thrown away: a slip of the finger, not a memo. */
const MIN_TAKE_SECONDS = 0.2;
/** Reel turn per step through the memo list. */
const LIST_STEP_RADIANS = Math.PI / 8;
/** Tape a scroll-wheel notch on the reel moves. */
const NUDGE_SECONDS = 0.25;
/** Held `[` / `]` turn the shuttle ring this far. */
const KEY_SHUTTLE = 0.6;
/** A mark this close to the head is the one the mark key removes. */
const MARK_REACH_SECONDS = 0.15;
/** Previous-mark within this much of a mark goes to the one before, as a CD player's back button does. */
const MARK_BACK_SECONDS = 0.4;

type View = "tape" | "list";
type OutputStatus = "opening" | "failed" | AudioStreamState;
type MicStatus = "off" | "opening" | "listening";

/** What the TP-7 remembers between launches. The memos themselves are files. */
interface Session {
  volume: number;
  memoId: string | null;
}

const STATUS_WORDS: Record<TransportStatus, string> = {
  record: "REC",
  arming: "MIC",
  play: "PLAY",
  stop: "STOP",
  scrub: "SCRUB",
  forward: "FWD",
  rewind: "REW",
};

function sanitizeSession(value: unknown): Session | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  return {
    volume: typeof r.volume === "number" && Number.isFinite(r.volume) ? Math.max(0, Math.min(1, r.volume)) : VOLUME.default,
    memoId: typeof r.memoId === "string" ? r.memoId : null,
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The user (or the host's policy) said no to the microphone. */
function isRefusal(error: unknown): boolean {
  const name = typeof error === "object" && error !== null && "name" in error ? (error as { name: unknown }).name : null;
  return name === "NotAllowedError" || name === "SecurityError";
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function Tp7(props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const fs = app.fs;
  const engine = new Tp7Engine();

  const [view, setView] = createSignal<View>("tape");
  const [folderId, setFolderId] = createSignal<string | null>(null);
  const [currentId, setCurrentId] = createSignal<string | null>(null);
  const [markers, setMarkers] = createSignal<readonly number[]>([]);
  const [cursor, setCursor] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [recording, setRecording] = createSignal(false);
  const [micStatus, setMicStatus] = createSignal<MicStatus>("off");
  const [output, setOutput] = createSignal<OutputStatus>(app.audio ? "opening" : "failed");
  const [volume, setVolume] = createSignal(VOLUME.default);
  const [message, setMessage] = createSignal<string | null>(null);
  const [durations, setDurations] = createSignal<ReadonlyMap<string, number>>(new Map());
  const [tick, setTick] = createSignal(0);
  const [angle, setAngle] = createSignal(0);

  const memos = createMemo(() => {
    const id = folderId();
    return id ? listMemos(fs, id) : [];
  });

  let stream: AudioStream | null = null;
  let mic: MicrophoneInput | null = null;
  let loaded = false;
  /** Bumped to abandon a memo load or a microphone that is still opening. */
  let loadToken = 0;
  let armToken = 0;
  /** Extra reel turn from spinning it through the memo list. */
  let listAngle = 0;
  let listTurn = 0;

  const repaint = () => setTick((n) => n + 1);

  createEffect(volume, (next) => {
    engine.volume = next;
  });

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  let messageTimer: ReturnType<typeof setTimeout> | null = null;
  const flash = (text: string) => {
    setMessage(text);
    if (messageTimer) clearTimeout(messageTimer);
    messageTimer = setTimeout(() => {
      messageTimer = null;
      setMessage(null);
    }, MESSAGE_MS);
  };

  // ---------------------------------------------------------------------------
  // Where the tape is, as heard
  // ---------------------------------------------------------------------------

  /** The head as the listener hears it: the stream's clock lags what was rendered. */
  const headNow = (): number => {
    if (engine.take) return engine.take.length;
    if (stream && output() === "running") return engine.headAt(stream.playbackPosition());
    return engine.head;
  };

  const tapeRate = () => engine.take?.sampleRate ?? engine.tape?.sampleRate ?? 48000;

  const syncTransport = () => {
    setPlaying(engine.playing);
    setRecording(engine.take !== null);
  };

  // ---------------------------------------------------------------------------
  // Memos
  // ---------------------------------------------------------------------------

  const rememberDuration = (fileId: string, seconds: number) =>
    setDurations((map) => new Map(map).set(fileId, seconds));

  const openMemo = async (fileId: string, options: { play?: boolean } = {}) => {
    const token = ++loadToken;
    const memo = await loadMemo(fs, fileId);
    if (token !== loadToken || engine.take) return;
    if (!memo) {
      flash("CAN'T READ MEMO");
      return;
    }
    engine.load(memo.tape);
    setCurrentId(fileId);
    setMarkers(memo.markers);
    rememberDuration(fileId, memo.tape.samples.length / memo.tape.sampleRate);
    if (options.play) engine.play();
    syncTransport();
    repaint();
  };

  /** Read durations for the list, one file at a time, in the background. */
  let unmeasured: readonly string[] = [];
  let measuring = false;
  const measure = async () => {
    if (measuring) return;
    measuring = true;
    try {
      while (unmeasured.length > 0) {
        const [id, ...rest] = unmeasured;
        unmeasured = rest;
        const bytes = await fs.readBytes(id!);
        const wav = bytes ? decodeWav(bytes) : null;
        rememberDuration(id!, wav && wav.channels[0] ? wav.channels[0].length / wav.sampleRate : Number.NaN);
      }
    } finally {
      measuring = false;
    }
  };

  createEffect(
    () => {
      if (view() !== "list") return [];
      const known = durations();
      return memos().filter((file) => !known.has(file.id)).map((file) => file.id);
    },
    (pending) => {
      unmeasured = pending;
      if (pending.length > 0) void measure();
    },
  );

  const stepMemo = (by: number) => {
    const list = memos();
    if (list.length === 0 || engine.take) return;
    if (view() === "list") {
      setCursor((c) => clamp(c + by, 0, list.length - 1));
      return;
    }
    const at = list.findIndex((file) => file.id === currentId());
    const next = at < 0 ? (by > 0 ? 0 : list.length - 1) : clamp(at + by, 0, list.length - 1);
    if (next === at) return;
    void openMemo(list[next]!.id, { play: engine.playing });
  };

  const toggleList = () => {
    if (view() === "list") {
      setView("tape");
      return;
    }
    if (engine.take || micStatus() === "opening") return;
    const list = memos();
    const at = list.findIndex((file) => file.id === currentId());
    setCursor(at >= 0 ? at : Math.max(0, list.length - 1));
    listTurn = 0;
    setView("list");
  };

  /** Play the memo under the list's cursor. */
  const playCursor = () => {
    const file = memos()[cursor()];
    setView("tape");
    if (!file) return;
    if (file.id === currentId() && engine.tape) {
      engine.play();
      syncTransport();
      return;
    }
    void openMemo(file.id, { play: true });
  };

  const deleteMemo = async () => {
    const id = currentId();
    const file = id ? fs.file(id) : undefined;
    if (!id || !file || engine.take) return;
    const answer = await app.os.showDialog({
      message: `Move "${file.name}" to the Trash?`,
      buttons: ["Cancel", "Move to Trash"],
      variant: "caution",
    });
    if (answer !== "Move to Trash") return;
    const list = memos();
    const at = list.findIndex((f) => f.id === id);
    loadToken++;
    engine.load(null);
    setCurrentId(null);
    setMarkers([]);
    syncTransport();
    try {
      const trash = fs.locate("trash");
      if (trash) {
        const name = uniqueChildName(fs, trash.id, file.name);
        if (name !== file.name) fs.rename(id, name);
        fs.move(id, trash.id);
      } else {
        await fs.remove(id);
      }
    } catch (err) {
      void app.os.showDialog({ message: `Couldn't move the memo to the Trash: ${errorText(err)}` });
      return;
    }
    const next = list[at + 1] ?? list[at - 1];
    if (next && next.id !== id) void openMemo(next.id);
    repaint();
  };

  const exportMemo = async () => {
    const download = app.download;
    const id = currentId();
    const file = id ? fs.file(id) : undefined;
    if (!download || !id || !file) return;
    const bytes = await fs.readBytes(id);
    if (!bytes) return;
    download.save({ name: file.name, type: WAV, bytes }).catch((err: unknown) => {
      void app.os.showDialog({ message: `Couldn't export the memo: ${errorText(err)}` });
    });
  };

  // ---------------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------------

  const togglePlay = () => {
    if (engine.take || micStatus() === "opening") return;
    if (view() === "list") {
      playCursor();
      return;
    }
    if (!engine.tape) {
      const last = memos()[memos().length - 1];
      if (last) void openMemo(last.id, { play: true });
      else flash("NOTHING TO PLAY");
      return;
    }
    if (engine.playing) engine.stop();
    else engine.play();
    syncTransport();
  };

  const startRecording = async () => {
    const microphone = app.microphone;
    if (!microphone) {
      flash("NO MICROPHONE");
      return;
    }
    engine.stop();
    engine.release();
    engine.shuttle(0);
    setView("tape");
    setMicStatus("opening");
    syncTransport();
    const token = ++armToken;
    try {
      const input = await microphone.open({ channels: 1, capture: (block) => engine.capture(block) });
      if (token !== armToken) {
        input.close();
        return;
      }
      mic = input;
      loadToken++;
      engine.startRecording(input.sampleRate);
      setMicStatus("listening");
      input.onStateChange((state) => {
        if (state !== "closed" || mic !== input) return;
        mic = null;
        setMicStatus("off");
        if (engine.take) void finishRecording("MIC LOST");
      });
      syncTransport();
    } catch (err) {
      if (token !== armToken) return;
      setMicStatus("off");
      flash(isRefusal(err) ? "MIC NOT ALLOWED" : "NO MICROPHONE");
    }
  };

  const finishRecording = async (reason?: string) => {
    const take = engine.stopRecording();
    const input = mic;
    mic = null;
    input?.close();
    setMicStatus("off");
    syncTransport();
    if (!take) return;
    if (take.length < take.sampleRate * MIN_TAKE_SECONDS) {
      flash("TOO SHORT");
      return;
    }
    const samples = take.samples();
    const tape = makeTape(samples, take.sampleRate);
    const takeMarkers = [...take.markers];
    engine.load(tape, 0);
    setCurrentId(null);
    setMarkers(takeMarkers);
    flash(reason ?? "SAVING");
    repaint();
    try {
      const folder = await ensureLibrary(fs, app.storage);
      setFolderId(folder.id);
      const file = await storeMemo(fs, folder.id, samples, take.sampleRate, takeMarkers);
      rememberDuration(file.id, samples.length / take.sampleRate);
      if (engine.tape === tape) {
        setCurrentId(file.id);
        if (markers() !== takeMarkers) scheduleMarkerSave();
      }
      flash(reason ?? `SAVED ${displayName(file.name)}`);
    } catch (err) {
      void app.os.showDialog({ message: `The TP-7 couldn't save the recording: ${errorText(err)}` });
    }
  };

  const toggleRecord = () => {
    if (engine.take) void finishRecording();
    else if (micStatus() === "off") void startRecording();
  };

  /** Stop; stopped already, back to the start. */
  const stopTransport = () => {
    if (engine.take) {
      void finishRecording();
      return;
    }
    if (micStatus() === "opening") {
      armToken++;
      setMicStatus("off");
      return;
    }
    if (engine.playing) engine.stop();
    else engine.seek(0);
    syncTransport();
    repaint();
  };

  // ---------------------------------------------------------------------------
  // Marks
  // ---------------------------------------------------------------------------

  let markerTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleMarkerSave = () => {
    if (markerTimer) clearTimeout(markerTimer);
    markerTimer = setTimeout(() => {
      markerTimer = null;
      const id = currentId();
      if (!id) return;
      saveMarkers(fs, id, markers()).catch((err: unknown) => {
        void app.os.showDialog({ message: `Couldn't save the marks: ${errorText(err)}` });
      });
    }, 500);
  };

  /** Drop a mark at the head, or lift the one it is sitting on. */
  const toggleMark = () => {
    const take = engine.take;
    if (take) {
      take.markers.push(take.length);
      flash(`MARK ${take.markers.length}`);
      repaint();
      return;
    }
    const tape = engine.tape;
    if (!tape || view() !== "tape") return;
    const head = Math.round(headNow());
    const list = markers();
    const near = list.find((m) => Math.abs(m - head) < tape.sampleRate * MARK_REACH_SECONDS);
    if (near !== undefined) {
      setMarkers(list.filter((m) => m !== near));
      flash("MARK REMOVED");
    } else {
      const next = [...list, head].sort((a, b) => a - b);
      setMarkers(next);
      flash(`MARK ${next.indexOf(head) + 1}`);
    }
    scheduleMarkerSave();
    repaint();
  };

  const clearMarks = () => {
    if (!engine.tape || markers().length === 0) return;
    setMarkers([]);
    scheduleMarkerSave();
    repaint();
  };

  const jumpMark = (direction: 1 | -1) => {
    const tape = engine.tape;
    if (!tape || engine.take) return;
    const head = headNow();
    const list = markers();
    const end = tape.samples.length - 1;
    let target: number;
    if (direction > 0) {
      target = list.find((m) => m > head + 1) ?? end;
    } else {
      target = [...list].reverse().find((m) => m < head - tape.sampleRate * MARK_BACK_SECONDS) ?? 0;
    }
    engine.seek(target);
    const index = list.indexOf(target);
    flash(index >= 0 ? `MARK ${index + 1}` : target === 0 ? "START" : "END");
    repaint();
  };

  // ---------------------------------------------------------------------------
  // The reel
  // ---------------------------------------------------------------------------

  const onGrab = () => {
    listTurn = 0;
    if (view() === "tape" && !engine.take) engine.grab();
    repaint();
  };

  const onTurn = (radians: number) => {
    if (view() === "list") {
      listAngle += radians;
      listTurn += radians;
      while (Math.abs(listTurn) >= LIST_STEP_RADIANS) {
        const step = Math.sign(listTurn);
        stepMemo(step);
        listTurn -= step * LIST_STEP_RADIANS;
      }
      repaint();
      return;
    }
    if (engine.take || !engine.tape) return;
    engine.turnPlatter((radians / (2 * Math.PI)) * SECONDS_PER_TURN * engine.tape.sampleRate);
  };

  const onRelease = () => {
    engine.release();
    repaint();
  };

  const onShuttle = (deflection: number) => {
    if (view() === "list" || engine.take) return;
    engine.shuttle(deflection);
    repaint();
  };

  const onNudge = (ticks: number) => {
    if (view() === "list") {
      stepMemo(ticks);
      return;
    }
    if (engine.take || !engine.tape) return;
    engine.seek(engine.head + ticks * NUDGE_SECONDS * engine.tape.sampleRate);
    repaint();
  };

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  const held = new Set<string>();

  const onKeyDown = (rawKey: string, mods: { meta: boolean; ctrl: boolean; alt: boolean }) => {
    if (mods.meta || mods.ctrl || mods.alt) return;
    const key = rawKey.length === 1 ? rawKey.toLowerCase() : rawKey;
    if (held.has(key)) return;
    held.add(key);
    if (key === " ") togglePlay();
    else if (key === "r") toggleRecord();
    else if (key === "s") stopTransport();
    else if (key === "m") toggleMark();
    else if (key === "l") toggleList();
    else if (key === "ArrowLeft") jumpMark(-1);
    else if (key === "ArrowRight") jumpMark(1);
    else if (key === "ArrowUp") stepMemo(-1);
    else if (key === "ArrowDown") stepMemo(1);
    else if (key === "Enter" && view() === "list") playCursor();
    else if (key === "Backspace" || key === "Delete") void deleteMemo();
    else if (key === "[" || key === "]") onShuttle(key === "[" ? -KEY_SHUTTLE : KEY_SHUTTLE);
  };

  const onKeyUp = (rawKey: string) => {
    const key = rawKey.length === 1 ? rawKey.toLowerCase() : rawKey;
    held.delete(key);
    if (key === "[" || key === "]") onShuttle(0);
  };

  const onBlur = () => {
    held.clear();
    engine.shuttle(0);
    engine.release();
  };

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  createEffect(
    (): Session => ({ volume: volume(), memoId: currentId() }),
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
  // Sound, and the frame loop that follows the tape
  // ---------------------------------------------------------------------------

  let cancelFrame: (() => void) | null = null;
  let wasLive = false;
  const frame = () => {
    cancelFrame = app.scheduler.requestFrame(frame);
    if (engine.take?.full) void finishRecording("TAPE FULL");
    if (engine.ended) engine.ended = false;
    if (engine.playing !== playing() || (engine.take !== null) !== recording()) syncTransport();

    const turns = headNow() / tapeRate() / SECONDS_PER_TURN;
    const next = turns * 2 * Math.PI + listAngle;
    if (next !== angle()) setAngle(next);

    const live =
      engine.take !== null ||
      engine.playing ||
      engine.drive !== "motor" ||
      Math.abs(engine.rate) > 1e-3 ||
      engine.outputLevel > 1e-3 ||
      engine.inputLevel > 1e-3 ||
      micStatus() === "opening";
    if (live || wasLive) repaint();
    wasLive = live;
  };

  onSettled(() => {
    cancelFrame = app.scheduler.requestFrame(frame);
    void (async () => {
      const session = sanitizeSession(parseJson(await app.storage.read(SESSION_KEY)));
      if (session) setVolume(session.volume);
      const folder = await findLibrary(fs, app.storage);
      if (folder) setFolderId(folder.id);
      loaded = true;
      const opened = typeof props.fileId === "string" ? props.fileId : null;
      const list = memos();
      const resume = session?.memoId && list.some((f) => f.id === session.memoId) ? session.memoId : null;
      const first = opened ?? resume ?? list[list.length - 1]?.id ?? null;
      if (first) await openMemo(first);
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
        console.error("TP-7: couldn't open sound output", err);
        setOutput("failed");
      });
  });

  onCleanup(() => {
    cancelFrame?.();
    stream?.close();
    mic?.close();
    for (const timer of [saveTimer, messageTimer, markerTimer]) if (timer) clearTimeout(timer);
  });

  // ---------------------------------------------------------------------------
  // Menus
  // ---------------------------------------------------------------------------

  createEffect(
    () => ({
      memos: memos().map((f) => ({ id: f.id, name: displayName(f.name) })),
      current: currentId(),
      playing: playing(),
      recording: recording(),
      hasTape: engine.tape !== null || currentId() !== null,
      hasMarks: markers().length > 0,
      list: view() === "list",
      canDownload: app.download !== undefined,
    }),
    (state) => {
      const fileItems: MenubarItemDef[] = [];
      if (state.canDownload) {
        fileItems.push({ label: "Export Memo…", shortcut: "E", disabled: !state.current, onClick: () => void exportMemo() });
      }
      fileItems.push(
        { label: "Move to Trash…", disabled: !state.current || state.recording, onClick: () => void deleteMemo() },
        { type: "separator" },
        { label: "Quit", shortcut: "Q", onClick: () => app.quit() },
      );

      const memoItems: MenubarItemDef[] = [
        { label: state.list ? "Hide Memo List" : "Show Memo List", shortcut: "L", onClick: toggleList },
        { label: "Previous Memo", disabled: state.memos.length === 0, onClick: () => stepMemo(-1) },
        { label: "Next Memo", disabled: state.memos.length === 0, onClick: () => stepMemo(1) },
      ];
      if (state.memos.length > 0) {
        memoItems.push(
          { type: "separator" },
          {
            type: "radiogroup",
            value: state.current ?? "",
            onValueChange: (id) => {
              if (!state.recording) void openMemo(id, { play: state.playing });
            },
            items: state.memos.map((m) => ({ label: m.name, value: m.id })),
          },
        );
      }

      app.setMenus([
        { label: "File", items: fileItems },
        {
          label: "Transport",
          items: [
            { label: state.recording ? "Stop Recording" : "Record", shortcut: "R", onClick: toggleRecord },
            { label: state.playing ? "Pause" : "Play", disabled: state.recording, onClick: togglePlay },
            { label: "Stop", onClick: stopTransport },
            { type: "separator" },
            { label: "Mark", disabled: !state.hasTape && !state.recording, onClick: toggleMark },
            { label: "Previous Mark", disabled: !state.hasTape, onClick: () => jumpMark(-1) },
            { label: "Next Mark", disabled: !state.hasTape, onClick: () => jumpMark(1) },
            { label: "Clear Marks", disabled: !state.hasMarks || state.recording, onClick: clearMarks },
          ],
        },
        { label: "Memos", items: memoItems },
      ]);
    },
  );

  // ---------------------------------------------------------------------------
  // The display
  // ---------------------------------------------------------------------------

  const status = (): TransportStatus => {
    if (micStatus() === "opening") return "arming";
    if (engine.take) return "record";
    if (engine.drive === "platter") return "scrub";
    if (engine.drive === "ring") return engine.rate >= 0 ? "forward" : "rewind";
    return engine.playing ? "play" : "stop";
  };

  const tapeView = (): TapeView => {
    const take = engine.take;
    const tape = engine.tape;
    const rate = tapeRate();
    const length = take ? take.length : tape?.samples.length ?? 0;
    const id = currentId();
    const file = id ? fs.file(id) : undefined;
    const now = status();
    const shuttling = now === "forward" || now === "rewind";
    const marks = take ? take.markers : markers();

    let detail = "";
    if (!take && tape && (output() === "failed" || output() === "closed")) detail = "NO SOUND OUTPUT";
    else if (!take && tape && output() === "suspended") detail = "CLICK FOR SOUND";
    else if (marks.length > 0) detail = `${marks.length} MARK${marks.length === 1 ? "" : "S"}`;

    let empty = "";
    if (micStatus() === "opening") empty = "OPENING MICROPHONE";
    else if (!take && !tape) empty = memos().length > 0 ? "PRESS PLAY" : "PRESS RECORD";

    return {
      kind: "tape",
      status: now,
      peaks: take ? take.peaks : tape?.peaks ?? null,
      length,
      sampleRate: rate,
      head: headNow(),
      span: take ? take.capacity : length,
      markers: marks,
      level: take ? engine.inputLevel : engine.outputLevel,
      clip: take !== null && engine.clipHold > 0,
      blink: Math.floor(app.scheduler.now() / 250) % 2 === 0,
      statusText: shuttling ? `${STATUS_WORDS[now]} ${Math.abs(engine.rate).toFixed(1)}X` : STATUS_WORDS[now],
      title: message() ?? (take ? "NEW MEMO" : file ? displayName(file.name) : tape ? "UNSAVED" : ""),
      total: take ? `${formatDuration((take.capacity - take.length) / rate)} LEFT` : tape ? `/ ${formatCounter(length / rate)}` : "",
      detail,
      empty,
    };
  };

  const listView = (): ListView => {
    const list = memos();
    const known = durations();
    return {
      kind: "list",
      cursor: cursor(),
      title: message() ?? (list.length > 0 ? `${cursor() + 1} OF ${list.length}` : ""),
      rows: list.map((file) => {
        const seconds = known.get(file.id);
        return {
          name: displayName(file.name),
          duration: seconds !== undefined && Number.isFinite(seconds) ? formatDuration(seconds) : "",
          loaded: file.id === currentId(),
        };
      }),
    };
  };

  const screen = createMemo((): ScreenView => {
    tick();
    playing();
    recording();
    return view() === "list" ? listView() : tapeView();
  });

  const summary = () => {
    const s = screen();
    if (s.kind === "list") return `MEMOS | ${s.rows[s.cursor]?.name ?? "EMPTY"}`;
    return `${s.statusText} | ${s.title}${s.empty ? ` | ${s.empty}` : ""}`;
  };

  // ---------------------------------------------------------------------------
  // The faceplate
  // ---------------------------------------------------------------------------

  return (
    <box
      width={W}
      height={H}
      padding={PAD}
      flexDirection="row"
      background={0}
      tabIndex={0}
      autoFocus
      semantic={{ name: "tp-7", role: "application" }}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={onBlur}
    >
      <box width={LEFT_W} flexDirection="column" gap={8}>
        <box padding={BEZEL} borderRadius={6} background={1}>
          <Screen view={screen()} revision={tick()} summary={summary()} />
        </box>
        <box flexDirection="row" justifyContent="space-between" width={LEFT_W}>
          <SmallKey name="list" icon="list" lit={view() === "list"} onPress={toggleList} />
          <SmallKey name="mark" icon="mark" onPress={toggleMark} />
          <SmallKey name="previous" icon="previous" onPress={() => jumpMark(-1)} />
          <SmallKey name="next" icon="next" onPress={() => jumpMark(1)} />
        </box>
        <box flexDirection="row" height={LOWER_H} gap={10} alignItems="center">
          <Grille width={112} height={LOWER_H} />
          <box flexDirection="column" flexGrow={1} height={LOWER_H} justifyContent="space-between" alignItems="flex-end">
            <box flexDirection="row" gap={6} alignItems="center">
              <text font="body" color={1} nowrap>
                MIC
              </text>
              <MicHole listening={micStatus() === "listening"} />
            </box>
            <Knob def={VOLUME} value={volume()} onChange={setVolume} />
            <text font="menu" spacing={1} color={1} nowrap>
              TP-7
            </text>
          </box>
        </box>
      </box>

      <box width={GAP + REEL_SIZE + GAP} height={H - 2 * PAD} alignItems="center" justifyContent="center">
        <Reel
          angle={angle()}
          revision={tick()}
          onGrab={onGrab}
          onTurn={onTurn}
          onRelease={onRelease}
          onShuttle={onShuttle}
          onNudge={onNudge}
        />
      </box>

      <box width={SIDE_KEY_W} flexDirection="column" gap={SIDE_GAP}>
        <SideKey name="record" icon="record" height={SIDE_KEY_H} lit={recording() || micStatus() === "opening"} onPress={toggleRecord} />
        <SideKey name="play" icon="play" height={SIDE_KEY_H} lit={playing()} onPress={togglePlay} />
        <SideKey name="stop" icon="stop" height={SIDE_KEY_H} onPress={stopTransport} />
      </box>
    </box>
  );
}

export default defineApp({
  id: "tp7",
  title: "TP-7",
  icon: "tp7/icon",
  smallIcon: "tp7/icon-16x16",
  sprites,
  requires: ["audio"],
  fileTypes: [WAV],
  about: {
    version: "1.0",
    description:
      "A field recorder in the manner of the Teenage Engineering TP-7. Record memos from the microphone, then hold the reel to stop the tape, spin it to scrub, or turn the ring around it to wind. Memos are WAV files in the TP-7 folder on your disk; marks are kept inside them.",
  },
  defaultSize: { width: W, height: H },
  resizable: false,
  scrollable: false,
  Component: Tp7,
});
