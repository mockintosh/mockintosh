import { createEffect, createSignal, onSettled } from "solid-js";
import { CopyBits, srcCopy, type BitMap } from "@mockintosh/quickdraw";
import {
  defineApp,
  heldModifiers,
  readPaintFile,
  useApp,
  writePaintFile,
  MIME,
  type AppContext,
  type MenubarDefinition,
  type MenubarItemDef,
  type PaintDocument,
} from "@mockintosh/sdk";
import {
  fontFamilyId,
  listFontFamilies,
  useUIServices,
  type CursorSpec,
  type JSX,
  type Modifiers,
  type UIClipboard,
} from "@mockintosh/ui";
import { sprites } from "./macpaint/icons";
import { pixelTrue, pt, rect, newBits, ptInRect, insetRect } from "./macpaint/bits";
import type { PaintMenu } from "./macpaint/commands";
import { aboutButtonRect, drawAboutBox, PAINT_DLOG } from "./macpaint/dialogs";
import { PaintProgram } from "./macpaint/program";
import { DOC_HEIGHT, DOC_WIDTH, newWindowPort, type PaintFileRef, type PaintHost } from "./macpaint/state";
import type { EventModifiers, MacWindow } from "./macpaint/toolbox";

const DOC_WINDOW_WIDTH = 416;
const DOC_WINDOW_HEIGHT = 240;
/** `dBoxProc`: 1px frame, 2px white, 2px band — its content sits 5px in. */
const DBOX_INSET = 5;

/** One running MacPaint: the program, and the host windows showing its MacWindows. */
interface Session {
  program: PaintProgram;
  revision(win: MacWindow): number;
  menus(): MenubarDefinition[];
  cursor(): CursorSpec;
  docTitle(): string;
  dialog(id: string): MacWindow | undefined;
}

let current: Session | null = null;

function fileRef(props: Record<string, unknown>): PaintFileRef | null {
  if (typeof props.fileId !== "string") return null;
  return { id: props.fileId, name: typeof props.title === "string" ? props.title : "untitled" };
}

function eventModifiers(m: Modifiers): EventModifiers {
  return { shift: m.shift, option: m.alt, command: m.meta };
}

/** A key as `keyDown`'s `message` carries it; `null` for keys the Mac keyboard didn't have. */
function macKey(key: string): string | null {
  if (key.length === 1) return key;
  if (key === "Backspace") return "\b";
  if (key === "Enter") return "\r";
  return null;
}

function toMenubar(program: PaintProgram, menus: PaintMenu[]): MenubarDefinition[] {
  return menus.map((menu) => ({
    label: menu.title,
    items: menu.items.map((entry, index): MenubarItemDef => {
      if (!entry) return { type: "separator" };
      const def: MenubarItemDef = {
        label: entry.label,
        disabled: !entry.enabled,
        checked: entry.checked,
        onClick: () => program.menu(menu.id, index + 1),
      };
      if (entry.shortcut) def.shortcut = entry.shortcut;
      return def;
    }),
  }));
}

/** The PNTG files `SFGetFile` would list: on the desktop, in Pictures, and beside the open document. */
function paintFiles(app: AppContext, near: PaintFileRef | null): PaintFileRef[] {
  const dirs = new Set<string>();
  const desktop = app.fs.locate("desktop");
  if (desktop) dirs.add(desktop.id);
  const pictures = app.fs.locate("pictures");
  if (pictures) dirs.add(pictures.id);
  const parent = near ? app.fs.node(near.id)?.parentId : null;
  if (parent) dirs.add(parent);
  const files: PaintFileRef[] = [];
  for (const dir of dirs) {
    for (const node of app.fs.children(dir)) {
      if (node.kind === "file" && node.type === MIME.paint) files.push({ id: node.id, name: node.name });
    }
  }
  return files;
}

function pageImage(page: BitMap): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(DOC_WIDTH * DOC_HEIGHT);
  for (let v = 0; v < DOC_HEIGHT; v++) {
    for (let h = 0; h < DOC_WIDTH; h++) data[v * DOC_WIDTH + h] = pixelTrue(h, v, page) ? 1 : 0;
  }
  return { width: DOC_WIDTH, height: DOC_HEIGHT, data };
}

function startSession(app: AppContext, screenWidth: number, screenHeight: number, file: PaintFileRef | null, clipboard: UIClipboard | undefined): Session {
  const [changes, setChanges] = createSignal(0);
  const [menus, setMenus] = createSignal<MenubarDefinition[]>([]);
  const [cursor, setCursor] = createSignal<CursorSpec>("arrow");
  const [docTitle, setDocTitle] = createSignal("");
  const revisions = new Map<MacWindow, number>();
  const dialogs = new Map<string, { win: MacWindow; windowId: string }>();
  let docWindowId: string | null = null;
  let nextDialog = 0;
  let lastMenus = "";

  const openDocWindow = (): void => {
    if (docWindowId) return;
    docWindowId = app.openWindow({
      kind: "document",
      title: docTitle(),
      position: { x: 79, y: 28 },
      size: { width: DOC_WINDOW_WIDTH + 2, height: DOC_WINDOW_HEIGHT },
      movable: false,
      resizable: false,
      scrollable: false,
      onGoAway: () => program.goAway(),
      Component: DocWindow,
    });
  };

  const host: PaintHost = {
    openDialog(win, { modal }) {
      const id = `dialog-${nextDialog++}`;
      const width = win.bits.bounds.right - win.bits.bounds.left;
      const height = win.bits.bounds.bottom - win.bits.bounds.top;
      const windowId = app.openWindow({
        kind: "alert",
        modal,
        title: "",
        position: { x: win.origin.h - DBOX_INSET, y: win.origin.v - DBOX_INSET },
        size: { width: width + 2 * DBOX_INSET, height },
        Component: DialogWindow,
        props: { dialogId: id },
      });
      dialogs.set(id, { win, windowId });
      return id;
    },
    closeDialog(id) {
      const entry = dialogs.get(id);
      if (!entry) return;
      dialogs.delete(id);
      app.os.closeWindow(entry.windowId);
    },
    showDocWindow(show) {
      if (show) openDocWindow();
      else if (docWindowId) {
        app.os.closeWindow(docWindowId);
        docWindowId = null;
      }
    },
    setDocTitle: setDocTitle,
    beep() {},
    quit() {
      app.quit();
    },
    async alertDialog(message, buttons, icon) {
      const label = await app.os.showDialog({ message, buttons: [...buttons], variant: icon });
      const index = label === null ? buttons.indexOf("Cancel") : buttons.indexOf(label);
      return index < 0 ? buttons.length : index + 1;
    },
    systemFont: () => fontFamilyId("menu"),
    clipboardText: async () => (clipboard ? clipboard.readText() : null),
    heldModifiers: () => eventModifiers(heldModifiers()),
    async getFile() {
      const files = paintFiles(app, program.paint.docFile);
      if (files.length === 0) {
        await app.os.showDialog({ message: "There are no MacPaint documents on the desktop.", variant: "note" });
        return null;
      }
      if (files.length <= 6) {
        const label = await app.os.showDialog({
          message: "MacPaint documents on disk",
          buttons: [...files.map((f) => f.name), "Cancel"],
          variant: "note",
        });
        return files.find((f) => f.name === label) ?? null;
      }
      const typed = await app.os.showDialog({
        message: `MacPaint documents on disk: ${files.map((f) => f.name).join(", ")}`,
        buttons: ["Cancel", "Open"],
        showInput: true,
        variant: "note",
      });
      const name = typed?.trim();
      return name ? (files.find((f) => f.name === name) ?? null) : null;
    },
    async putFile(message, defaultName) {
      const typed = await app.os.showDialog({
        message,
        buttons: ["Cancel", "Save"],
        showInput: true,
        inputDefault: defaultName,
        variant: "note",
      });
      const name = typed?.trim();
      return name ? name : null;
    },
    readDocument: (f) => readPaintFile(app.fs, f.id),
    async writeDocument(name, doc: PaintDocument, near) {
      const parentId = (near && app.fs.node(near.id)?.parentId) || app.fs.locate("desktop")?.id;
      if (!parentId) throw new Error("MacPaint: no desktop to save on");
      const written = await writePaintFile(app.fs, parentId, name, doc);
      return { id: written.id, name: written.name };
    },
    async printPage(page) {
      await app.print?.printPicture(pageImage(page));
    },
    fontNames: () => listFontFamilies().map((f) => f.name),
    fontLabel: (name) => listFontFamilies().find((f) => f.name === name)?.displayName,
    fontNumber: (name) => fontFamilyId(name),
    applicationFont: () => "geneva",
  };

  const program = new PaintProgram(host, () => app.scheduler.now(), rect(0, 0, screenWidth, screenHeight), file);

  program.subscribe((changed) => {
    for (const win of changed) revisions.set(win, (revisions.get(win) ?? 0) + 1);
    if (changed.size > 0) setChanges((n) => n + 1);
    const model = program.menus();
    const key = JSON.stringify(model);
    if (key !== lastMenus) {
      lastMenus = key;
      setMenus(toMenubar(program, model));
    }
    setCursor(() => program.cursor());
  });

  let cancelFrame: (() => void) | null = null;
  const frame = (): void => {
    if (program.done) return;
    program.step();
    cancelFrame = app.scheduler.requestFrame(frame);
  };

  const session: Session = {
    program,
    revision(win) {
      changes();
      return revisions.get(win) ?? 0;
    },
    menus,
    cursor,
    docTitle,
    dialog: (id) => dialogs.get(id)?.win,
  };

  const stopFontWatch = app.fonts.onChange(() => program.refreshFonts());

  app.onCleanup?.(() => {
    stopFontWatch();
    cancelFrame?.();
    if (current === session) current = null;
  });

  onSettled(() => {
    openDocWindow();
    cancelFrame = app.scheduler.requestFrame(frame);
  });
  return session;
}

/** A MacWindow's pixels, with its mouse and keys going to the program. */
function PaintRaster(props: { session: Session; win: MacWindow; autoFocus?: boolean }): JSX.Element {
  const { session, win } = props;
  const b = win.bits.bounds;
  const width = b.right - b.left;
  const height = b.bottom - b.top;
  const program = session.program;
  const mods = (): EventModifiers => eventModifiers(heldModifiers());
  return (
    <raster
      width={width}
      height={height}
      revision={session.revision(win)}
      cursor={session.cursor()}
      tabIndex={0}
      autoFocus={props.autoFocus ?? true}
      onPaint={(surface) => {
        const { x, y } = surface.rect;
        CopyBits(win.bits, surface.port.portBits, b, rect(x, y, x + width, y + height), srcCopy, null);
      }}
      onMouseDown={(x, y) => program.mouseDown(win, pt(x, y), mods())}
      onMouseMove={(x, y) => program.mouseMove(win, pt(x, y))}
      onDrag={(x, y) => program.mouseMove(win, pt(x, y))}
      onMouseUp={(x, y) => program.mouseUp(win, pt(x, y), mods())}
      onKeyDown={(key, modifiers) => {
        const ch = macKey(key);
        if (ch !== null) program.keyDown(ch, eventModifiers(modifiers));
      }}
    />
  );
}

function useSessionMenus(session: Session): void {
  const app = useApp();
  createEffect(
    () => session.menus(),
    (menus) => app.setMenus(menus),
  );
}

/** The desk: gray, with the tool, line and pattern palettes. MacPaint's `deskWind`. */
function Desk(props: Record<string, unknown>): JSX.Element {
  const app = useApp();
  const { clipboard } = useUIServices();
  const session = current ?? startSession(app, app.window.width(), app.window.height(), fileRef(props), clipboard);
  current = session;
  useSessionMenus(session);
  return <PaintRaster session={session} win={session.program.paint.deskWind} autoFocus={false} />;
}

/** The document window, `myWind`: 416×240 of the page. */
function DocWindow(): JSX.Element {
  const app = useApp();
  const session = current!;
  useSessionMenus(session);
  createEffect(
    () => session.docTitle(),
    (title) => app.window.setTitle(title),
  );
  return <PaintRaster session={session} win={session.program.paint.myWind} />;
}

function DialogWindow(props: { dialogId: string }): JSX.Element {
  const session = current!;
  useSessionMenus(session);
  const win = session.dialog(props.dialogId);
  if (!win) return <box />;
  return <PaintRaster session={session} win={win} />;
}

/** The About box: `PAINT_DLOG`, dismissed by its OK button. */
function About(): JSX.Element {
  const app = useApp();
  const b = PAINT_DLOG.bounds;
  const width = b.right - b.left;
  const height = b.bottom - b.top;
  const bits = newBits(rect(0, 0, width, height));
  const port = newWindowPort(bits);
  drawAboutBox(port, fontFamilyId("menu"));
  const ok = aboutButtonRect();
  const [pressed, setPressed] = createSignal(false);
  let down = false;
  return (
    <raster
      width={width}
      height={height}
      revision={pressed() ? 1 : 0}
      onPaint={(surface) => {
        const { x, y } = surface.rect;
        CopyBits(bits, surface.port.portBits, bits.bounds, rect(x, y, x + width, y + height), srcCopy, null);
        if (pressed()) {
          const r = insetRect(ok, 1, 1);
          for (let v = r.top; v < r.bottom; v++) {
            for (let h = r.left; h < r.right; h++) surface.setPixel(x + h, y + v, pixelTrue(h, v, bits) ? 0 : 1);
          }
        }
      }}
      onMouseDown={(x, y) => {
        down = ptInRect(pt(x, y), ok);
        setPressed(down);
      }}
      onDrag={(x, y) => setPressed(down && ptInRect(pt(x, y), ok))}
      onMouseUp={(x, y) => {
        setPressed(false);
        if (down && ptInRect(pt(x, y), ok)) app.window.close();
        down = false;
      }}
      tabIndex={0}
      autoFocus
      onKeyDown={(key) => {
        if (key === "Enter") app.window.close();
      }}
    />
  );
}

export default defineApp({
  id: "macpaint",
  title: "MacPaint",
  icon: "macpaint/icon",
  smallIcon: "macpaint/icon-16x16",
  defaultSize: { width: DOC_WINDOW_WIDTH, height: DOC_WINDOW_HEIGHT },
  resizable: false,
  scrollable: false,
  singleInstance: true,
  sprites,
  fileTypes: [MIME.paint],
  about: {
    Component: About,
    size: { width: PAINT_DLOG.bounds.right - PAINT_DLOG.bounds.left, height: PAINT_DLOG.bounds.bottom - PAINT_DLOG.bounds.top },
  },
  Component: Desk,
  onOpen(app, props) {
    const file = fileRef(props);
    if (current) {
      if (file) current.program.open(file);
      return;
    }
    app.openWindow({ kind: "desk", title: "", props });
  },
});
