/**
 * The tape library: which tape is on the machine, whether it has changed
 * since it went on or was last kept, and putting tapes on and keeping
 * them — the File menu's New, Open, Save, Save As and Delete. A tape is
 * edited when something is recorded onto or erased from it, or when its
 * tape and mixer settings differ from the ones it was kept with.
 */
import { createMemo, createSignal, type AppServices, type AppStorage } from "@mockintosh/sdk";
import { DEMO_SONGS } from "./songs";
import type { TapeMachine } from "./tape";
import {
  blankTape,
  decodeTape,
  demoTape,
  encodeTape,
  sameMix,
  suggestedName,
  tapeKey,
  tapeName,
  tapeNameProblem,
  tapeNames,
  type TapeContents,
  type TapeMix,
  type TapeRef,
} from "./tapes";

export interface TapeLibraryOptions {
  storage: AppStorage;
  os: Pick<AppServices["os"], "showDialog" | "busy">;
  tape: TapeMachine;
  /** The tape and mixer pages' settings. */
  mix(): TapeMix;
  setMix(mix: TapeMix): void;
  /** A tape has gone on, or a kept one has changed name: refresh what shows it. */
  onChange(): void;
}

export interface OpenTapeOptions {
  /** Offer to keep unsaved changes first; on unless the tape on the machine doesn't matter. */
  ask?: boolean;
  /** Once the old tape is off the machine, stopped and blank, and before the new one is read. */
  onEject?(): void;
}

export interface TapeLibrary {
  /** The tape on the machine; null until the first goes on. */
  current(): TapeRef | null;
  /** The user's kept tapes, by name. */
  saved(): readonly string[];
  /** Whether the tape has changed since it went on or was last kept. */
  edited(): boolean;
  /** Something was recorded onto, or erased from, the tape. */
  markEdited(): void;
  /** Find out which tapes are kept. */
  refresh(): Promise<void>;
  /** Put a tape on the machine; true once it is. */
  open(ref: TapeRef, options?: OpenTapeOptions): Promise<boolean>;
  /** Keep the tape under its name — asking for one if it has none of the user's. */
  save(): Promise<boolean>;
  /** Keep the tape under a new name, which it then goes by. */
  saveAs(): Promise<boolean>;
  /** Throw away the kept file of the tape on the machine; the tape stays on, untitled. */
  remove(): Promise<void>;
  /** Offer to keep unsaved changes before they're lost; true to go ahead. */
  confirmDiscard(): Promise<boolean>;
}

export function useTapeLibrary(options: TapeLibraryOptions): TapeLibrary {
  const { storage, os, tape } = options;
  const [current, setCurrent] = createSignal<TapeRef | null>(null);
  const [saved, setSaved] = createSignal<readonly string[]>([]);
  const [keptMix, setKeptMix] = createSignal<TapeMix | null>(null);
  const [recordedOver, setRecordedOver] = createSignal(false);
  const edited = createMemo(() => {
    const kept = keptMix();
    return recordedOver() || (kept !== null && !sameMix(options.mix(), kept));
  });
  let opening = false;

  const kept = (ref: TapeRef, mix: TapeMix) => {
    setCurrent(ref);
    setKeptMix(mix);
    setRecordedOver(false);
    options.onChange();
  };

  const refresh = async () => {
    setSaved(tapeNames(await storage.list()));
  };

  const read = async (ref: TapeRef, sampleRate: number): Promise<TapeContents | null> => {
    if (ref.kind === "new") return blankTape(sampleRate);
    if (ref.kind === "demo") {
      const song = DEMO_SONGS.find((s) => s.name === ref.name);
      return song ? os.busy(() => demoTape(song, sampleRate)) : null;
    }
    const bytes = await storage.readBytes(tapeKey(ref.name));
    return bytes ? os.busy(() => decodeTape(bytes, sampleRate)) : null;
  };

  const open = async (ref: TapeRef, { ask = true, onEject }: OpenTapeOptions = {}) => {
    if (opening) return false;
    opening = true;
    try {
      if (ask && !(await confirmDiscard())) return false;
      tape.stop();
      tape.clearAll();
      tape.rewind();
      onEject?.();
      const contents = await read(ref, tape.sampleRate);
      if (!contents) {
        put({ kind: "new" }, blankTape(tape.sampleRate));
        await os.showDialog({ message: `The tape “${tapeName(ref)}” couldn't be read.`, variant: "note" });
        await refresh();
        return false;
      }
      put(ref, contents);
      return true;
    } finally {
      opening = false;
    }
  };

  const put = (ref: TapeRef, contents: TapeContents) => {
    contents.tracks.forEach((data, t) => (data ? tape.load(t, data) : tape.clearTrack(t)));
    options.setMix(contents.mix);
    kept(ref, contents.mix);
  };

  const write = async (name: string) => {
    const mix = options.mix();
    const bytes = await os.busy(() =>
      encodeTape({ mix, tracks: [0, 1, 2, 3].map((t) => tape.recorded(t)), sampleRate: tape.sampleRate }),
    );
    try {
      await storage.writeBytes(tapeKey(name), bytes);
    } catch (err) {
      await os.showDialog({ message: `Couldn't save the tape: ${err instanceof Error ? err.message : String(err)}` });
      return false;
    }
    kept({ kind: "saved", name }, mix);
    await refresh();
    return true;
  };

  const saveAs = async (): Promise<boolean> => {
    const ref = current();
    if (!ref) return false;
    let suggestion = suggestedName(ref);
    for (;;) {
      const typed = await os.showDialog({
        message: "Save this tape as:",
        buttons: ["Cancel", "Save"],
        showInput: true,
        inputDefault: suggestion,
        variant: "note",
      });
      if (typed === null) return false;
      const name = typed.trim();
      const problem = tapeNameProblem(name);
      if (problem) {
        await os.showDialog({ message: problem, variant: "note" });
        suggestion = name || suggestion;
        continue;
      }
      const replacing = saved().includes(name) && !(ref.kind === "saved" && ref.name === name);
      if (replacing) {
        const answer = await os.showDialog({
          message: `Replace the tape “${name}”? What's on it now will be lost.`,
          buttons: ["Cancel", "Replace"],
          variant: "caution",
        });
        if (answer !== "Replace") {
          suggestion = name;
          continue;
        }
      }
      return write(name);
    }
  };

  const save = async () => {
    const ref = current();
    if (ref?.kind === "saved") return write(ref.name);
    return saveAs();
  };

  const remove = async () => {
    const ref = current();
    if (ref?.kind !== "saved") return;
    const answer = await os.showDialog({
      message: `Delete the tape “${ref.name}”? It stays on the OP-1, untitled, until you put on another.`,
      buttons: ["Cancel", "Delete"],
      variant: "caution",
    });
    if (answer !== "Delete") return;
    await storage.remove(tapeKey(ref.name));
    setCurrent({ kind: "new" });
    setRecordedOver(true);
    options.onChange();
    await refresh();
  };

  const confirmDiscard = async () => {
    const ref = current();
    if (!ref || !edited()) return true;
    const answer = await os.showDialog({
      message: `Save the changes to the tape “${tapeName(ref)}”?`,
      buttons: ["Cancel", "Don't Save", "Save"],
      variant: "caution",
    });
    if (answer === "Save") return save();
    return answer === "Don't Save";
  };

  return {
    current,
    saved,
    edited,
    markEdited: () => setRecordedOver(true),
    refresh,
    open,
    save,
    saveAs,
    remove,
    confirmDiscard,
  };
}
