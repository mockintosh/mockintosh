/**
 * The Standard File Package's Open dialog (`StandardGetFile`): a folder
 * pop-up over a scrolling list of folders and documents, the disk on the
 * right with Eject and Desktop, then Open and Cancel. Apps reach it through
 * `AppContext.os.showOpenDialog`; what it lists is `../standardFile`.
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import type { JSX } from "@mockintosh/ui";
import { DialogButton, PopUpFace, measureText, smallIcon, truncateText, type Sprite } from "@mockintosh/ui";
import type { FSFile } from "@mockintosh/fs";
import { useOS } from "../context";
import { useWindow } from "../windowContext";
import { SCROLL_BAR_WIDTH as SB_W, ScrollBar } from "./ScrollBar.solid";
import { windowFrame, windowSizeForContent } from "../windowGeometry";
import { iconForNode } from "../../../apps/finder/attributes";
import {
  DESKTOP,
  TYPE_SELECT_TIMEOUT_MS,
  listPlace,
  parentPlace,
  placeName,
  placePath,
  typeSelect,
  type SFEntry,
  type SFPlace,
} from "../standardFile";

export interface OpenDialogProps {
  types?: readonly string[];
  start: SFPlace;
  /** The chosen file, or null on Cancel, and where the dialog was left. */
  resolve: (file: FSFile | null, place: SFPlace) => void;
}

// Every rect is Apple's DITL -6042 (Inside Macintosh: Files, listing 3-6) in
// dialog coordinates, (left, top, width, height); details inside the items
// are measured off Apple's 1-bit Figure 3-1.

/** DLOG -6042: the dialog's content. */
const DIALOG = { width: 344, height: 166 };
/** dBoxProc puts the content 8px in: the window's frame, then white. */
const INSET = 8 - windowFrame({ kind: "alert" });
export const OPEN_DIALOG_SIZE = windowSizeForContent(
  { kind: "alert" },
  { width: DIALOG.width + 2 * INSET, height: DIALOG.height + 2 * INSET },
);

const ROW_H = 16;
const ROWS = 8;
const ICON = 16;

/** Item 7: the list with its scroll bar inside, framed on the rect's edge. */
const LIST = { left: 12, top: 29, width: 218, height: 130 };
/** Item 8: the directory pop-up, centred in this rect and as wide as its label. */
const POPUP = { left: 12, top: 6, width: 218, height: 18 };
/** Item 4: the volume's icon and name. */
const VOLUME = { left: 235, top: 8, right: 337, iconLeft: 259 };
/** Between the disk icon and the pen for its name. */
const VOLUME_GAP = 3;
const BUTTON = { left: 252, width: 80 };
const EJECT_TOP = 32;
const DESKTOP_TOP = 60;
const CANCEL_TOP = 104;
const OPEN_TOP = 135;
/** Item 9: PICT 11, a dotted line. */
const DIVIDER = { left: 251, right: 333, top: 91 };

/** Inside a list row: where the small icon and the name go. */
const ROW_ICON_X = 2;
const ROW_TEXT_X = 21;
/** Inside the pop-up box, from its left edge: icon, name, then room for `PopUpFace`'s triangle. */
const POPUP_ICON_X = 4;
const POPUP_TEXT_X = 23;
/** From the end of the name to the box's right edge: a 5px gap, the 11px triangle, 6px. */
const POPUP_TRIANGLE_ROOM = 5 + 11 + 6;

/** A sprite's 16×16: its own drawing when it has one, else the reduction. */
function small(sprites: ReturnType<typeof useOS>["sprites"], name: string): Sprite | undefined {
  const own = sprites.get(`${name}-16x16`);
  if (own) return own;
  const big = sprites.get(name);
  return big ? smallIcon(big) : undefined;
}

export function OpenDialog(props: OpenDialogProps): JSX.Element {
  const os = useOS();
  const win = useWindow();
  const fs = os.fs;

  const [place, setPlace] = createSignal<SFPlace>(props.start);
  const entries = createMemo(() => listPlace(fs, place(), props.types));
  // The list opens with its first entry selected.
  const [selectedId, setSelectedId] = createSignal<string | null>(listPlace(fs, props.start, props.types)[0]?.id ?? null);
  const [top, setTop] = createSignal(0);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [menuHover, setMenuHover] = createSignal(-1);
  let typed = "";
  let typedAt = 0;

  const selectedIndex = () => entries().findIndex((e) => e.id === selectedId());
  const selected = (): SFEntry | undefined => entries()[selectedIndex()];
  const maxTop = () => Math.max(0, entries().length - ROWS);
  const path = createMemo(() => placePath(fs, place()));
  const volume = createMemo(() => {
    const p = place();
    return p.kind === "desktop" ? fs.volumes()[0] : fs.volumeOf(p.id);
  });

  /** A disk's small icon: the floppy for one that ejects, Standard File's hard disk otherwise. */
  function diskIcon(id: string): Sprite | undefined {
    return fs.directory(id)?.ejectable ? small(os.sprites, "icon/floppy-disk") : os.sprites.get("sf/hard-disk");
  }

  /** A row's icon: Standard File's own SICNs for disks and plain documents, else the Finder's small icon. */
  function iconOf(e: SFEntry): Sprite | undefined {
    if (e.kind === "volume") return diskIcon(e.id);
    if (e.kind === "folder") return small(os.sprites, "icon/folder");
    const node = fs.node(e.id);
    if (!node) return undefined;
    const icon = iconForNode(fs, node);
    return icon === "icon/file" ? os.sprites.get("sf/document") : small(os.sprites, icon);
  }

  /** The pop-up's icon: an open folder, the disk at a volume, the Mac at the Desktop. */
  function placeIcon(p: SFPlace): Sprite | undefined {
    if (p.kind === "desktop") return small(os.sprites, "icon/computer");
    return fs.directory(p.id)?.role === "volume" ? diskIcon(p.id) : os.sprites.get("sf/open-folder");
  }

  // Solid defers signal writes, so a handler that writes one passes the new
  // values on rather than reading them back.

  /** Select row `index` of `list`, scrolled from `from` just far enough to show it. */
  function selectIn(list: readonly SFEntry[], index: number, from: number): void {
    if (list.length === 0) {
      setSelectedId(null);
      setTop(0);
      return;
    }
    const i = Math.max(0, Math.min(list.length - 1, index));
    setSelectedId(list[i]!.id);
    setTop(i < from ? i : i >= from + ROWS ? i - ROWS + 1 : from);
  }

  function select(index: number): void {
    selectIn(entries(), index, top());
  }

  /** Show `next`, selecting `child` when it is one of its entries, else the first. */
  function go(next: SFPlace, child?: string): void {
    setPlace(next);
    const list = listPlace(fs, next, props.types);
    const at = child ? list.findIndex((e) => e.id === child) : -1;
    selectIn(list, at < 0 ? 0 : at, 0);
  }

  function goUp(): void {
    const p = place();
    const up = parentPlace(fs, p);
    if (up) go(up, p.kind === "folder" ? p.id : undefined);
  }

  function finish(file: FSFile | null): void {
    props.resolve(file, place());
    win.close();
  }

  /** Open: enter a folder or volume, or hand back a document. */
  function open(): void {
    const e = selected();
    if (!e) return;
    if (e.kind !== "file") {
      go({ kind: "folder", id: e.id });
      return;
    }
    const file = fs.file(e.id);
    if (file) finish(file);
  }

  function scrollBy(rows: number): void {
    setTop((t) => Math.max(0, Math.min(maxTop(), t + rows)));
  }

  function onKey(key: string, mods: { meta: boolean; ctrl: boolean }): void {
    const command = mods.meta || mods.ctrl;
    if (key === "Escape" || (command && key === ".")) return finish(null);
    if (key === "Enter") return open();
    if (command && key === "ArrowUp") return goUp();
    if (command && key === "ArrowDown") return open();
    if (key === "ArrowUp") return select(selectedIndex() < 0 ? entries().length - 1 : selectedIndex() - 1);
    if (key === "ArrowDown") return select(selectedIndex() + 1);
    if (key.length === 1 && !command) {
      const now = Date.now();
      typed = now - typedAt > TYPE_SELECT_TIMEOUT_MS ? key : typed + key;
      typedAt = now;
      const at = typeSelect(entries(), typed);
      if (at >= 0) select(at);
    }
  }

  /** The pop-up box hugs its label and centres in its item; a label too long for the item is cut. */
  const popupBox = createMemo(() => {
    const chrome = POPUP_TEXT_X + POPUP_TRIANGLE_ROOM;
    const label = truncateText(placeName(fs, place()), POPUP.width - chrome, "menu");
    const width = chrome + measureText(label, "menu");
    return { left: POPUP.left + Math.floor((POPUP.width - width) / 2), width, label };
  });

  /** The volume's icon at its place in item 4, moved left when a long name needs the room, and the name cut to fit. */
  const volumeLabel = createMemo(() => {
    const name = truncateText(volume()?.name ?? "", VOLUME.right - VOLUME.left - ICON - VOLUME_GAP, "menu");
    const width = ICON + VOLUME_GAP + measureText(name, "menu");
    return { name, left: Math.max(VOLUME.left, Math.min(VOLUME.iconLeft, VOLUME.right - width)) };
  });

  function menuRowAt(ly: number): number {
    const row = Math.floor((ly - POPUP.height) / ROW_H);
    return row >= 0 && row < path().length ? row : -1;
  }

  const menuItemW = () => Math.max(popupBox().width, ...path().map((p) => POPUP_TEXT_X + measureText(placeName(fs, p), "menu") + 8));

  return (
    <box
      width={win.width()}
      height={win.height()}
      tabIndex={0}
      autoFocus
      onKeyDown={onKey}
      semantic={{ name: "open-dialog", role: "dialog" }}
    >
      <box position="absolute" left={INSET} top={INSET} width={DIALOG.width} height={DIALOG.height}>
        {/* ── The list: rows of folders and documents, and its scroll bar ── */}
        <box
          position="absolute"
          left={LIST.left}
          top={LIST.top}
          width={LIST.width}
          height={LIST.height}
          borderColor={1}
          borderWidth={1}
          background={0}
          onScroll={(dy) => scrollBy(Math.sign(dy) * Math.max(1, Math.round(Math.abs(dy) / ROW_H)))}
        >
          <For each={entries().slice(top(), top() + ROWS)}>
            {(e, i) => {
              const on = () => e.id === selectedId();
              return (
                <box
                  position="absolute"
                  left={0}
                  top={i() * ROW_H}
                  width={LIST.width - SB_W - 1}
                  height={ROW_H}
                  background={on() ? 1 : 0}
                  semantic={{ name: `file-${e.name}`, role: "option", value: on() ? "selected" : "" }}
                  onMouseDown={() => setSelectedId(e.id)}
                  onDoubleClick={open}
                >
                  <Show when={iconOf(e)}>
                    {(s) => <image position="absolute" left={ROW_ICON_X} top={0} width={ICON} height={ICON} src={s()} mode={on() ? "inverted" : "normal"} />}
                  </Show>
                  <text position="absolute" left={ROW_TEXT_X} top={0} height={ROW_H} font="menu" nowrap verticalAlign="middle" color={on() ? 0 : 1}>
                    {truncateText(e.name, LIST.width - SB_W - 1 - ROW_TEXT_X - 2, "menu")}
                  </text>
                </box>
              );
            }}
          </For>

          {/* The scroll bar shares the list's frame on three sides. */}
          <ScrollBar
            orientation="vertical"
            left={LIST.width - SB_W - 1}
            top={-1}
            length={LIST.height}
            value={top()}
            max={maxTop()}
            onStep={scrollBy}
            onPage={(dir) => scrollBy(dir * (ROWS - 1))}
            onDrag={setTop}
          />
        </box>

        {/* ── Directory pop-up: icon, name and triangle in a box with a drop
            shadow. After the list, so its menu draws over it. ── */}
        <box
          position="absolute"
          left={popupBox().left}
          top={POPUP.top}
          width={popupBox().width + 1}
          height={POPUP.height + 1}
          semantic={{ name: "folder-popup", role: "button", value: placeName(fs, place()) }}
          onMouseDown={() => {
            setMenuOpen(true);
            setMenuHover(-1);
          }}
          onDrag={(_lx, ly) => setMenuHover(menuRowAt(ly))}
          onMouseUp={(_lx, ly) => {
            const row = menuRowAt(ly);
            setMenuOpen(false);
            const target = path()[row];
            const below = path()[row - 1];
            if (target && row > 0) go(target, below?.kind === "folder" ? below.id : undefined);
          }}
        >
          <PopUpFace width={popupBox().width} height={POPUP.height} open={menuOpen()}>
            <Show when={placeIcon(place())}>
              {(s) => <image position="absolute" left={POPUP_ICON_X - 1} top={1} width={ICON} height={ICON} src={s()} mode={menuOpen() ? "inverted" : "normal"} />}
            </Show>
            <text position="absolute" left={POPUP_TEXT_X - 1} top={1} height={ROW_H} font="menu" nowrap verticalAlign="middle" color={menuOpen() ? 0 : 1}>
              {popupBox().label}
            </text>
          </PopUpFace>
          {/* The menu: this folder and every place above it, top down. */}
          <Show when={menuOpen()}>
            <box position="absolute" left={1} top={POPUP.height + 1} width={menuItemW()} height={path().length * ROW_H + 2} background={1} />
            <box
              position="absolute"
              left={0}
              top={POPUP.height}
              width={menuItemW()}
              height={path().length * ROW_H + 2}
              background={0}
              borderColor={1}
              borderWidth={1}
            >
              <For each={path()}>
                {(p, i) => (
                  <box position="absolute" left={0} top={i() * ROW_H} width={menuItemW() - 2} height={ROW_H} background={menuHover() === i() ? 1 : 0}>
                    <Show when={placeIcon(p)}>
                      {(s) => <image position="absolute" left={POPUP_ICON_X - 1} top={0} width={ICON} height={ICON} src={s()} mode={menuHover() === i() ? "inverted" : "normal"} />}
                    </Show>
                    <text position="absolute" left={POPUP_TEXT_X - 1} top={0} height={ROW_H} font="menu" nowrap verticalAlign="middle" color={menuHover() === i() ? 0 : 1}>
                      {placeName(fs, p)}
                    </text>
                  </box>
                )}
              </For>
            </box>
          </Show>
        </box>

        {/* ── The volume ── */}
        <Show when={volume() && diskIcon(volume()!.id)}>
          {(s) => <image position="absolute" left={volumeLabel().left} top={VOLUME.top} width={ICON} height={ICON} src={s()} />}
        </Show>
        <text position="absolute" left={volumeLabel().left + ICON + VOLUME_GAP} top={VOLUME.top} height={ROW_H} font="menu" nowrap verticalAlign="middle">
          {volumeLabel().name}
        </text>

        {/* ── Buttons, down the right: Eject, Desktop, the divider, Cancel, Open ── */}
        <box position="absolute" left={BUTTON.left} top={EJECT_TOP}>
          <DialogButton
            name="eject"
            label="Eject"
            width={BUTTON.width}
            disabled={!volume()?.ejectable}
            onClick={() => {
              const disk = volume();
              if (!disk?.ejectable) return;
              os.ejectDisk(disk.id);
              go(DESKTOP);
            }}
          />
        </box>
        <box position="absolute" left={BUTTON.left} top={DESKTOP_TOP}>
          <DialogButton name="desktop" label="Desktop" width={BUTTON.width} disabled={place().kind === "desktop"} onClick={() => go(DESKTOP)} />
        </box>
        <For each={Array.from({ length: Math.ceil((DIVIDER.right - DIVIDER.left) / 2) }, (_, i) => DIVIDER.left + 2 * i)}>
          {(x) => <box position="absolute" left={x} top={DIVIDER.top} width={1} height={1} background={1} />}
        </For>
        <box position="absolute" left={BUTTON.left} top={CANCEL_TOP}>
          <DialogButton name="cancel" label="Cancel" width={BUTTON.width} onClick={() => finish(null)} />
        </box>
        <box position="absolute" left={BUTTON.left} top={OPEN_TOP}>
          <DialogButton name="open" label="Open" width={BUTTON.width} default disabled={!selected()} onClick={open} />
        </box>
      </box>
    </box>
  );
}
